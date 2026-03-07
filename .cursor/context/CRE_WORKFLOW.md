# Pramanik — CRE Workflow Specifications

## Runtime Requirements

- Runtime: Bun (NOT Node.js)
- Language: TypeScript
- SDK: @chainlink/cre-sdk (latest)
- No Node.js built-ins — no node:crypto, no Buffer, no fs, no path
- No axios, no node-fetch — use SDK's ConfidentialHTTPClient
- No async/await — use .result() pattern everywhere
- Hashing/encoding: viem utilities only (WASM-compatible)
- Validation: Zod for all external data

## Project Structure

```
cre-workflow/
|-- src/
|   |-- kyc-verification.ts      Workflow 1 — KYC verification
|   |-- sanctions-screening.ts   Workflow 2 — sanctions cron
|   |-- adapters/
|   |   |-- mock.ts              Mock KYC provider adapter
|   |   |-- jumio.ts             Jumio adapter (maps Jumio response to KYCResult)
|   |   `-- onfido.ts            Onfido adapter (maps Onfido response to KYCResult)
|   `-- utils/
|       `-- eligibility.ts       extractEligibility() pure function
|-- abi/
|   |-- EligibilityRegistry.json Contract ABI
|   `-- KYCGate.json             Contract ABI
|-- config.json                  Runtime config (URLs, addresses, rules)
|-- config.schema.ts             Zod schema for config validation
`-- package.json
```

---

## Config Schema

```typescript
// config.schema.ts
import { z } from "zod"

export const configSchema = z.object({
  kycApiUrl:         z.string().url(),
  chainSelectorName: z.string(),
  kycGateAddress:    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registryAddress:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  provider:          z.enum(["mock", "jumio", "onfido"]),
  jurisdictionRules: z.record(z.object({
    minTier:    z.enum(["RETAIL", "ACCREDITED", "INSTITUTIONAL"]),
    ttlDays:    z.number().positive(),
    sanctions:  z.array(z.string()),
  })),
})

export type Config = z.infer<typeof configSchema>
```

```json
// config.json (example values)
{
  "kycApiUrl": "https://[railway-app].railway.app",
  "chainSelectorName": "tenderly-virtual-sepolia",
  "kycGateAddress": "0x...",
  "registryAddress": "0x...",
  "provider": "mock",
  "jurisdictionRules": {
    "US": { "minTier": "ACCREDITED", "ttlDays": 365, "sanctions": ["OFAC_SDN"] },
    "EU": { "minTier": "RETAIL",     "ttlDays": 180, "sanctions": ["EU_CONSOLIDATED"] },
    "SG": { "minTier": "ACCREDITED", "ttlDays": 365, "sanctions": ["MAS"] }
  }
}
```

---

## KYC Result Type

All provider adapters must return this exact type:

```typescript
type KYCResult = {
  // Safe fields — these will exit the TEE
  eligible:     boolean
  tier:         "RETAIL" | "ACCREDITED" | "INSTITUTIONAL" | "BLOCKED"
  jurisdiction: string
  provider:     string
  responseId:   string
  ttlDays:      number
  sanctionsHit: boolean
  pepFlag:      boolean
  adverseMedia: boolean

  // PII fields — used ONLY inside extractEligibility(), never stored/returned
  firstName:      string
  lastName:       string
  dateOfBirth:    string
  documentType:   string
  documentNumber: string
  issuingCountry: string
  documentExpiry: string
  amlRiskScore:   number
}
```

---

## Provider Adapter Interface

```typescript
interface KYCProvider {
  check(
    address: string,
    jurisdiction: string,
    runtime: NodeRuntime<Config>
  ): KYCResult
}
```

### MockAdapter

Calls our Express mock API. Response schema exactly matches KYCResult.

### JumioAdapter (P1)

Calls Jumio v4 API: POST /v4/accounts/workflow/execution
Maps Jumio response to KYCResult standard schema.

### OnfidoAdapter (P1)

Calls Onfido v3.6 API: POST /v3.6/workflow_runs
Maps Onfido response to KYCResult standard schema.

---

## Workflow 1: kyc-verification.ts

### Trigger
EVM Log — KYCRequested event on KYCGate.sol

### Event Signature
```solidity
event KYCRequested(
  address indexed user,
  bytes32 jurisdiction,
  uint256 indexed requestId,
  uint64  timestamp
)
```

### Full Execution Flow

```typescript
import { cre } from "@chainlink/cre-sdk"
import { ConfidentialHTTPClient } from "@chainlink/cre-sdk"
import { decodeEventLog, keccak256, toUtf8Bytes } from "viem"
import { configSchema } from "./config.schema"
import { extractEligibility } from "./utils/eligibility"
import { MockAdapter, JumioAdapter, OnfidoAdapter } from "./adapters"
import REGISTRY_ABI from "../abi/EligibilityRegistry.json"
import KYCGATE_ABI from "../abi/KYCGate.json"

const workflow = cre.workflow({
  trigger: cre.trigger.evmLog({
    contractAddress: (config) => config.kycGateAddress,
    eventSignature:  "KYCRequested(address,bytes32,uint256,uint64)",
  }),

  config: configSchema,

  execute: (runtime) => {
    const config = runtime.getConfig()

    // Step 1: Parse event payload
    const rawPayload = runtime.getTriggerPayload()
    const decoded = decodeEventLog({
      abi:  KYCGATE_ABI,
      data: rawPayload.data,
      topics: rawPayload.topics,
    })
    const { user, jurisdiction, requestId } = decoded.args
    // Zod validate
    // ...

    // Step 2: Select provider
    const provider = {
      mock:   new MockAdapter(),
      jumio:  new JumioAdapter(),
      onfido: new OnfidoAdapter(),
    }[config.provider]

    // Step 3: Call KYC API inside TEE via ConfidentialHTTPClient
    const confClient = new ConfidentialHTTPClient()
    const response = confClient.post(runtime, {
      url:     config.kycApiUrl + "/kyc/verify",
      headers: {
        "Authorization": `Bearer ${runtime.getSecret("KYC_API_KEY")}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ address: user, jurisdiction }),
    }).result()

    if (!response.ok) {
      // Write failure to KYCGate via EVMClient
      // emit KYCFailed event
      return
    }

    const rawKYCData = JSON.parse(response.body) as KYCResult

    // Step 4: Extract eligibility — THIS IS THE PRIVACY BOUNDARY
    // Everything in rawKYCData is destroyed after this call
    const result = extractEligibility(rawKYCData, jurisdiction, config, requestId)

    // Step 5: Write to EligibilityRegistry
    const evmClient = new cre.capabilities.EVMClient(config.chainSelectorName)
    evmClient.writeContract(runtime, {
      address:      config.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "setAttestation",
      args: [
        user,
        result.tier,
        result.expiresAt,
        result.jurisdictionHash,
        result.providerHash,
        result.oracleRef,
      ],
    }).result()
  }
})
```

---

## extractEligibility() — The Privacy Boundary

This is the most critical function in the entire system.
It is a pure function — no side effects, no external calls, deterministic output.
Everything that enters as rawKYCData stays here. Only the return value exits the TEE.

```typescript
// utils/eligibility.ts

export function extractEligibility(
  rawKYCData: KYCResult,
  jurisdiction: string,
  config: Config,
  requestId: string
) {
  const rules = config.jurisdictionRules[jurisdiction]

  // Determine eligibility
  const eligible = rawKYCData.eligible
    && !rawKYCData.sanctionsHit
    && !rawKYCData.pepFlag     // optionally gate PEPs

  // Map to on-chain tier
  const tier = eligible ? mapTier(rawKYCData.tier) : 0 // 0 = BLOCKED

  // Calculate expiry from jurisdiction rules
  const expiresAt = Math.floor(Date.now() / 1000) + (rules.ttlDays * 86400)

  // Hash identifiers — proves computation ran on specific data without revealing data
  const jurisdictionHash = keccak256(toUtf8Bytes(jurisdiction))
  const providerHash     = keccak256(toUtf8Bytes(rawKYCData.provider + rawKYCData.responseId))
  const oracleRef        = keccak256(toUtf8Bytes(String(requestId)))

  // rawKYCData is garbage collected here — name, passport, DOB never leave this scope
  return { tier, expiresAt, jurisdictionHash, providerHash, oracleRef }
}

function mapTier(tier: string): number {
  const map: Record<string, number> = {
    "BLOCKED":       0,
    "RETAIL":        1,
    "ACCREDITED":    2,
    "INSTITUTIONAL": 3,
  }
  return map[tier] ?? 0
}
```

---

## Workflow 2: sanctions-screening.ts

### Trigger
CRE Cron — every 6 hours

### Full Execution Flow

```typescript
const workflow = cre.workflow({
  trigger: cre.trigger.cron({ schedule: "0 */6 * * *" }),
  config:  configSchema,

  execute: (runtime) => {
    const config = runtime.getConfig()

    // Step 1: Read active attestation addresses from Registry
    const evmClient = new cre.capabilities.EVMClient(config.chainSelectorName)
    const activeAddresses = evmClient.readContract(runtime, {
      address:      config.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "getActiveAddresses",  // returns address[]
    }).result()

    // Step 2: Process in batches of 100
    const BATCH_SIZE = 100
    let totalRevoked = 0

    for (let i = 0; i < activeAddresses.length; i += BATCH_SIZE) {
      const batch = activeAddresses.slice(i, i + BATCH_SIZE)

      // Step 3: Call sanctions APIs inside TEE
      const confClient = new ConfidentialHTTPClient()

      const ofacResponse = confClient.post(runtime, {
        url:  config.kycApiUrl + "/sanctions/batch-check",
        body: JSON.stringify({ addresses: batch }),
        headers: { "Authorization": `Bearer ${runtime.getSecret("KYC_API_KEY")}` },
      }).result()

      const sanctionedAddresses = JSON.parse(ofacResponse.body)
        .filter((r: any) => r.sanctioned)
        .map((r: any) => r.address)

      // Step 4: Revoke each sanctioned address
      for (const address of sanctionedAddresses) {
        evmClient.writeContract(runtime, {
          address:      config.registryAddress,
          abi:          REGISTRY_ABI,
          functionName: "revokeAttestation",
          args: [address, keccak256(toUtf8Bytes("SANCTIONS_HIT"))],
        }).result()
        totalRevoked++
      }
    }

    // Step 5: Emit audit event (total screened, total revoked)
    // This is written on-chain via a separate audit contract or event
  }
})
```

---

## Simulation Commands

```bash
# Simulate KYC verification workflow
cre workflow simulate src/kyc-verification.ts

# Simulate sanctions screening workflow
cre workflow simulate src/sanctions-screening.ts

# Deploy workflows (after simulation passes)
cre workflow deploy src/kyc-verification.ts
cre workflow deploy src/sanctions-screening.ts

# Check deployed workflows
cre workflow list

# Set secrets in Vault DON
cre secrets set KYC_API_KEY "mock-bearer-token-123"
```

---

## Common CRE Pitfalls

| Issue | Cause | Fix |
|---|---|---|
| `zsh: command not found: cre` | Shell not reloaded after install | Run: `exec /bin/zsh` |
| WASM compilation error | Using Node.js built-ins | Replace with viem/SDK equivalents |
| Silent failure on writeContract | Oracle address mismatch | Check setOracleAddress() was called with correct CRE oracle address |
| Trigger payload parse error | ABI mismatch | Use viem decodeEventLog() with exact event ABI |
| .result() undefined | Using async/await instead | Replace all awaits with .result() calls |
| ConfidentialHTTPClient error | Testing Confidential HTTP first | Test with standard HTTPClient first, then upgrade |
