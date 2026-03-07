# Pramanik — Project Context for Coding Agent

## What Is This

**Pramanik** is a privacy-preserving KYC oracle system built on Chainlink CRE (Chainlink Runtime Environment).
The core idea: users request KYC verification on-chain, a CRE workflow picks up the event, calls a KYC provider API **inside a TEE** (so PII never leaves the enclave), and writes only a hashed attestation (tier + expiry + hashes) to an on-chain `EligibilityRegistry`. DeFi vaults then gate deposits based on that registry.

---

## Repository Structure

```
ChainLink/
├── .addresses.json              # Deployed contract addresses (Tenderly VT)
├── .env                         # Root env: RPC URLs, contract addresses, private key
├── contracts/                   # Hardhat project (Solidity contracts + deploy scripts)
│   ├── contracts/
│   │   ├── KYCGate.sol          # User entry point — emits KYCRequested event
│   │   ├── EligibilityRegistry.sol  # Oracle-written attestation store
│   │   ├── PermissionedVault.sol    # ERC-4626 vault with KYC tier gate on deposit
│   │   ├── MockERC20.sol        # Test USDC (6 decimals)
│   │   └── interfaces/
│   │       └── IEligibilityRegistry.sol
│   ├── scripts/
│   │   ├── deploy.ts            # Deploys all contracts, writes .addresses.json
│   │   └── triggerKYC.ts        # Calls requestKYC("US") to emit KYCRequested event
│   └── hardhat.config.ts        # Network: tenderly (chainId 73571, Tenderly VT RPC)
├── cre-workflow/                # CRE project root
│   ├── project.yaml             # Maps ethereum-testnet-sepolia → Tenderly VT RPC
│   ├── secrets.yaml             # { secretsNames: { KYC_API_KEY: [KYC_API_KEY] } }
│   ├── .env                     # KYC_API_KEY=mock-bearer-token-123, CRE_ETH_PRIVATE_KEY=...
│   ├── contracts/
│   │   ├── KYCGate.ts           # CRE-side binding: logTriggerKYCRequested() via evmClient.logTrigger()
│   │   └── EligibilityRegistry.ts  # CRE-side binding: getActiveAddresses(), setAttestation(), revokeAttestation()
│   ├── src/
│   │   ├── adapters/
│   │   │   ├── mock.ts          # MockAdapter: calls /kyc/verify with { address, jurisdiction, provider }
│   │   │   ├── jumio.ts         # JumioAdapter (stub)
│   │   │   └── onfido.ts        # OnfidoAdapter (stub)
│   │   └── utils/
│   │       └── eligibility.ts   # extractEligibility(): strips PII, returns { tier, expiresAt, hashes }
│   ├── kyc-workflow/            # KYC CRE workflow
│   │   ├── main.ts              # Runner.newRunner({ configSchema }).run(initWorkflow)
│   │   ├── workflow.ts          # Handler + initWorkflow
│   │   ├── workflow.yaml        # workflow-name: pramanik-kyc-verification
│   │   ├── config.json          # Runtime config (kycApiUrl, kycGateAddress, registryAddress, etc.)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── sanctions-workflow/      # Sanctions screening CRE workflow
│       ├── main.ts
│       ├── workflow.ts          # Cron trigger, batch screens via /sanctions/batch-check
│       ├── workflow.yaml
│       ├── config.json          # kycApiUrl, chainSelectorName, registryAddress
│       ├── package.json
│       └── tsconfig.json
└── mock-api/                    # Express mock KYC API
    └── src/
        └── routes/
            └── kyc.ts           # POST /kyc/verify, POST /sanctions/batch-check
```

---

## Deployed Contracts (Tenderly Virtual TestNet)

Chain ID: `73571` (fork of Sepolia)
RPC: `https://virtual.sepolia.eu.rpc.tenderly.co/7cf3f7bc-78fc-4378-9b7f-3a81f887283f`

| Contract | Address |
|---|---|
| MockERC20 (mUSDC) | `0x6982631017F49d558dca85D845AB0A8c3200Ba99` |
| EligibilityRegistry | `0x1cdDB0056d4B01267a1b683423046d80180C8eE5` |
| KYCGate | `0x6e414E0BF40196c021A2Af959e9183f254862F59` |
| VaultRetail | `0xE08cD0eC0a803d282935B16a9eF2f57fCD68ed15` |
| VaultAccredited | `0x4AC8f3A6Af8a0B951686Eedc4CE1799691327A4D` |
| VaultInstitutional | `0xDFf01eD53CbbBfF448a7f9B76342bc1Ae5d467a3` |

Deployer / current oracle placeholder: `0x4cFFe5dd6d181bE5617F9D5afE42bF01978f11D3`
Private key in `.env` as `DEPLOYER_PRIVATE_KEY` (no 0x prefix).

> **Important:** `EligibilityRegistry` was deployed with `deployer.address` as the oracle placeholder.
> After CRE workflow deployment, call `setOracleAddress(cre_workflow_address)` as the deployer.

---

## Mock KYC API

Running locally on `localhost:3001`, exposed via ngrok.
**Current ngrok URL:** `https://2396-103-180-45-40.ngrok-free.app` *(changes every ngrok restart — update `cre-workflow/kyc-workflow/config.json` and `sanctions-workflow/config.json` when it changes)*

Start the mock API:
```bash
cd mock-api && npm run dev   # or yarn dev / bun dev
```

Start ngrok:
```bash
ngrok http 3001
```

Key routes:
- `POST /kyc/verify` — body: `{ address, jurisdiction, provider }`, auth: `Bearer mock-bearer-token-123`
- `POST /sanctions/batch-check` — body: `{ addresses: string[] }`, returns `[{ address, sanctioned }]`

The `jurisdiction` field expects a human-readable string like `"US"`, NOT a bytes32 hash.

---

## CRE CLI

Version: `1.3.0`
Logged in as: `vansh` (check with `cre whoami`)

### Simulation commands (both pass as of last session)

```bash
cd cre-workflow

# KYC workflow — needs a real tx hash from Tenderly
cre workflow simulate kyc-workflow -T staging-settings \
  --evm-tx-hash 0x8a4baa1902edaba15e92ef7c05c2da7625d0ece26af420d7e87b9e0e43ff2a34 \
  --evm-event-index 0 --non-interactive --trigger-index 0
# Result: "issued:0x4cffe5dd6d181be5617f9d5afe42bf01978f11d3:tier=1"

# Sanctions workflow — cron, no tx hash needed
cre workflow simulate sanctions-workflow -T staging-settings --non-interactive --trigger-index 0
# Result: "screened:0:revoked:0"
```

To emit a new KYCRequested event on Tenderly (to get a new tx hash for simulation):
```bash
cd contracts
npx hardhat run scripts/triggerKYC.ts --network tenderly
```

### Deploy access
- Requested via `cre account access` — **pending Chainlink team approval**
- Will receive email when approved
- Deploy commands (for when access is granted):
```bash
cre workflow deploy kyc-workflow -T staging-settings
cre workflow deploy sanctions-workflow -T staging-settings
```

---

## Key Architecture Decisions & Gotchas

### CRE SDK patterns (v1.1.4)
- Entry point: `Runner.newRunner({ configSchema }).run(initWorkflow)`
- Workflow init: `initWorkflow(config)` returns `[cre.handler(trigger, handlerFn)]`
- Log trigger: `evmClient.logTrigger({ addresses, topics: [{ values: [topic0] }] })`
- Cron trigger: `new cre.capabilities.CronCapability()` then `.trigger({ schedule: '...' })`
- HTTP client: `new ConfidentialHTTPClient()` then `.sendRequest(runtime, { request: { url, method, bodyString, multiHeaders } }).result()`
- Secret: `runtime.getSecret({ id: 'KEY_NAME' }).result().value`
- EVM read: `evmClient.callContract(runtime, { call: encodeCallMsg({...}), blockNumber: LAST_FINALIZED_BLOCK_NUMBER }).result()`
- EVM write: `runtime.report(prepareReportRequest(callData)).result()` then `evmClient.writeReport(runtime, { receiver, report }).result()`
- EVMClient takes **bigint** chain selector: `cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia']`

### Known simulation quirk
`log.data` is an **empty Uint8Array** in CRE simulation even though the real on-chain log has data. Non-indexed event fields (like `jurisdiction` bytes32) must be decoded from `log.data` with a fallback. The KYC workflow handles this: if `log.data` is empty, it falls back to the `"US"` bytes32 default, then resolves the string by matching `keccak256(key)` against config keys.

### Zod URL validation fails in WASM
`z.string().url()` rejects ngrok URLs inside the CRE WASM runtime. Use `z.string().min(1)` instead. Both workflow configs already have this fix.

### Jurisdiction encoding
On-chain: `KYCGate.sol` stores jurisdiction as `keccak256(bytes("US"))` — a bytes32 hash.
Off-chain: Mock API expects `"US"` (plain string, 2-10 chars).
The KYC workflow resolves the string by matching `keccak256(toBytes(key))` against config `jurisdictionRules` keys, with fallback to first key.

---

## Contract Logic Summary

### KYCGate.sol
- `requestKYC(string jurisdiction)` — hashes jurisdiction, emits `KYCRequested(user, bytes32 jurisdiction, requestId, timestamp)`
- Tracks pending requests, 1-hour expiry, auto-expires old requests on new submission

### EligibilityRegistry.sol
- `setAttestation(user, tier, expiresAt, jurisdiction, providerHash, oracleRef)` — `onlyOracle`
- `isEligible(user)` — any tier >= RETAIL, not revoked, not expired
- `isEligibleForTier(user, minTier)` — specific tier check
- `revokeAttestation(user, reasonCode)` — oracle or admin
- `getActiveAddresses()` — returns all ever-attested addresses (for sanctions batch)
- `setOracleAddress(newOracle)` — owner only, needed after CRE deploy

### PermissionedVault.sol (ERC-4626)
- `_deposit()` — calls `eligibilityRegistry.isEligibleForTier(caller, requiredTier)`, reverts with `IneligibleDepositor` if not eligible
- Whitelist override available (`addToWhitelist`)
- `_withdraw()` — always unrestricted
- Three instances deployed: Retail (tier 1), Accredited (tier 2), Institutional (tier 3)

### Tier enum (IEligibilityRegistry.sol)
```
NONE = 0, RETAIL = 1, ACCREDITED = 2, INSTITUTIONAL = 3
```

---

## What Is Left To Do

### Immediate (no deploy access needed)
- [ ] **End-to-end Tenderly test**: Write a Hardhat script that:
  1. Calls `setAttestation(user, RETAIL, 0, ...)` from deployer (who is current oracle)
  2. Mints MockUSDC to user
  3. Approves VaultRetail to spend MockUSDC
  4. Deposits into VaultRetail — should succeed
  5. Tries deposit from unattested address — should revert with `IneligibleDepositor`
  6. Calls `revokeAttestation(user, reasonCode)` from deployer
  7. Tries deposit again — should revert

### After CRE Deploy Access Granted
- [ ] `cre workflow deploy kyc-workflow -T staging-settings`
- [ ] `cre workflow deploy sanctions-workflow -T staging-settings`
- [ ] Get the CRE workflow's on-chain address from deploy output
- [ ] Call `EligibilityRegistry.setOracleAddress(cre_workflow_address)` from deployer wallet
- [ ] Emit a real `KYCRequested` event on Tenderly and watch the live workflow execute

### Nice To Have / Hackathon Polish
- [ ] README.md at repo root with architecture diagram and setup instructions
- [ ] Replace ngrok with a stable deployment for the mock API (e.g. Railway, Render, Fly.io)
- [ ] Add Jumio/Onfido adapter implementations (currently stubs)
- [ ] Add Hardhat tests for PermissionedVault KYC gate logic
- [ ] Consider deploying to real Sepolia (not just Tenderly VT) for the final demo

---

## Environment Variables

### `/Users/vansh/Coding/ChainLink/.env` (root)
```
TENDERLY_RPC_URL=https://virtual.sepolia.eu.rpc.tenderly.co/7cf3f7bc-78fc-4378-9b7f-3a81f887283f
KYC_GATE_ADDRESS=0x6e414E0BF40196c021A2Af959e9183f254862F59
ELIGIBILITY_REGISTRY_ADDRESS=0x1cdDB0056d4B01267a1b683423046d80180C8eE5
VAULT_RETAIL_ADDRESS=0xE08cD0eC0a803d282935B16a9eF2f57fCD68ed15
VAULT_ACCREDITED_ADDRESS=0x4AC8f3A6Af8a0B951686Eedc4CE1799691327A4D
VAULT_INSTITUTIONAL_ADDRESS=0xDFf01eD53CbbBfF448a7f9B76342bc1Ae5d467a3
MOCK_API_URL=https://2396-103-180-45-40.ngrok-free.app
MOCK_API_BEARER_TOKEN=mock-bearer-token-123
DEPLOYER_PRIVATE_KEY=2cf9e6f88099b9b7a7aa40f7895a0b39715c66f63baebe7a748acc07fbce0489
```

### `/Users/vansh/Coding/ChainLink/cre-workflow/.env`
```
KYC_API_KEY=mock-bearer-token-123
CRE_ETH_PRIVATE_KEY=2cf9e6f88099b9b7a7aa40f7895a0b39715c66f63baebe7a748acc07fbce0489
```
