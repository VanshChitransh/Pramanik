# Pramanik — Development Master Reference

> Sanskrit: प्रामाणिक — "authentic, verified, certified"
> Privacy-preserving KYC oracle for institutional DeFi on Chainlink CRE

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Repository Structure](#3-repository-structure)
4. [Tech Stack](#4-tech-stack)
5. [Smart Contracts — Layer 1](#5-smart-contracts--layer-1)
6. [CRE Workflows — Layer 2](#6-cre-workflows--layer-2)
7. [Mock KYC API — Layer 3](#7-mock-kyc-api--layer-3)
8. [Build Phases](#8-build-phases)
9. [Environment Setup](#9-environment-setup)
10. [Testing Strategy](#10-testing-strategy)
11. [Deployment Strategy](#11-deployment-strategy)
12. [Feature Priority List](#12-feature-priority-list)
13. [Coding Conventions](#13-coding-conventions)
14. [Key Design Decisions](#14-key-design-decisions)
15. [Submission Checklist](#15-submission-checklist)

---

## 1. Project Overview

### The Problem

Public blockchains are transparent by design — every transaction, every wallet, every data input is publicly visible. Financial regulations (GDPR, MiFID II, CCPA, FATF AML) require that customer identity data (names, passport numbers, credit scores, sanctions status) remain strictly confidential. These two requirements directly contradict each other.

This contradiction locks $4.5 trillion in institutional assets out of DeFi — hedge funds, family offices, asset managers cannot legally participate in on-chain finance without compliant KYC.

### The Solution

Pramanik routes all KYC verification logic through Chainlink Trusted Execution Environments (TEEs). Raw identity data is fetched from real-world compliance APIs inside a hardware-isolated secure enclave. The enclave extracts only a minimal eligibility result — a boolean and a tier classification — and discards everything else. Only that result reaches the blockchain.

### One-Line Value Proposition

> "Prove you are who you say you are, on-chain, without revealing anything about who you are."

### What We Are NOT Building

- A KYC provider (we integrate with Jumio/Onfido/Chainalysis, we do not replace them)
- A ZK-proof identity system (we use TEE-based confidentiality, not ZK circuits)
- A cross-chain bridge (single testnet: Tenderly Virtual TestNet forked from Sepolia)
- A token or governance system
- A mobile app

---

## 2. System Architecture

### Three-Layer Overview

```
LAYER 1 — SMART CONTRACT LAYER (On-Chain, Public, Permanent)
  KYCGate.sol            → User entry point, emits verification requests
  EligibilityRegistry.sol → Source of truth for all KYC attestations
  PermissionedVault.sol  → ERC-4626 vault that enforces KYC on deposits

LAYER 2 — ORACLE / CRE LAYER (Chainlink Runtime Environment)
  kyc-verification.ts    → Triggered by KYCRequested events
  sanctions-screening.ts → Cron job every 6 hours
  TEE Enclave            → Hardware-isolated, processes and destroys PII
  20+ DON Nodes          → Consensus on every result

LAYER 3 — EXTERNAL DATA LAYER (Real World APIs)
  Mock KYC API           → Simulates Jumio/Onfido/Chainalysis (hackathon)
  Real providers         → Swap in for production (config change only)
```

### Complete Data Flow

```
USER calls requestKYC("US") on KYCGate.sol
  |
  | KYCRequested event emitted on-chain
  v
CRE EVM Log Trigger detects event
  |
  | Workflow starts on 20+ nodes simultaneously
  v
TEE ENCLAVE (hardware-isolated):
  - Fetches API key from Vault DON (threshold-encrypted secret)
  - Calls POST /kyc/verify on Mock API (or real Jumio in production)
  - Receives full response: {name, passport, DOB, score, eligible, tier...}
  - Extracts ONLY: {eligible, tier, expiresAt, jurisdiction}
  - DESTROYS everything else
  |
  | Minimal result exits enclave
  v
ConsensusIdenticalAggregation:
  - All 20+ nodes must agree on identical result
  - KYC is binary, not median — either you pass or you don't
  |
  | Single agreed-upon attestation payload
  v
EVMClient writes to EligibilityRegistry.sol:
  setAttestation(user, TIER_2, expiry, jurisdiction, providerHash, oracleRef)
  |
  | AttestationIssued event emitted
  v
USER calls deposit() on PermissionedVault.sol
  |
  | Vault checks isEligibleForTier(user, TIER_2)
  |-- TRUE  → deposit accepted
  |-- FALSE → revert: IneligibleDepositor
```

### Sanctions Flow (Parallel, Ongoing)

```
Every 6 hours — CRE Cron Trigger fires
  |
  | Read all active attestation addresses from Registry
  v
TEE ENCLAVE:
  - Calls OFAC SDN API (mock) with address batch
  - Calls EU Consolidated Sanctions API (mock) with address batch
  - Identifies any matches
  |
  | Only match flags exit enclave (not which list or why)
  v
EVMClient calls revokeAttestation(address, "SANCTIONS_HIT") for each hit
  |
  | AttestationRevoked event emitted
  v
All vaults immediately block the revoked address
```

---

## 3. Repository Structure

```
pramanik/
|
|-- contracts/                    # Hardhat project — Solidity smart contracts
|   |-- contracts/
|   |   |-- EligibilityRegistry.sol
|   |   |-- KYCGate.sol
|   |   |-- PermissionedVault.sol
|   |   |-- AttestationSBT.sol    # P2 — ERC-721 soulbound token
|   |   `-- interfaces/
|   |       `-- IEligibilityRegistry.sol
|   |-- test/
|   |   |-- EligibilityRegistry.test.ts
|   |   |-- KYCGate.test.ts
|   |   `-- PermissionedVault.test.ts
|   |-- scripts/
|   |   `-- deploy.ts
|   |-- hardhat.config.ts
|   `-- package.json
|
|-- cre-workflow/                 # Chainlink CRE — TypeScript workflows
|   |-- src/
|   |   |-- kyc-verification.ts   # Workflow 1: triggered by KYCRequested event
|   |   |-- sanctions-screening.ts # Workflow 2: cron every 6 hours
|   |   |-- adapters/
|   |   |   |-- mock.ts           # Mock KYC provider adapter
|   |   |   |-- jumio.ts          # Jumio adapter (P1)
|   |   |   `-- onfido.ts         # Onfido adapter (P1)
|   |   `-- utils/
|   |       `-- eligibility.ts    # Pure function: extractEligibility()
|   |-- abi/
|   |   |-- EligibilityRegistry.json
|   |   `-- KYCGate.json
|   |-- config.json               # Workflow config (URLs, addresses, rules)
|   |-- config.schema.ts          # Zod schema for config validation
|   `-- package.json
|
|-- mock-api/                     # Express.js mock KYC API server
|   |-- src/
|   |   |-- index.ts
|   |   |-- routes/
|   |   |   |-- kyc.ts
|   |   |   `-- sanctions.ts
|   |   `-- data/
|   |       `-- responses.ts      # Deterministic responses by address prefix
|   |-- package.json
|   `-- railway.json
|
|-- frontend/                     # React + Vite — build LAST
|   |-- src/
|   |   |-- App.tsx
|   |   |-- pages/
|   |   |   |-- KYCRequest.tsx
|   |   |   |-- AttestationStatus.tsx
|   |   |   `-- Vault.tsx
|   |   `-- hooks/
|   |       `-- useKYCStatus.ts
|   `-- package.json
|
|-- .cursor/                      # Cursor AI context files
|-- .addresses.json               # Deployed contract addresses (all environments)
|-- .env.example                  # Environment variable template (never .env itself)
|-- .gitignore
|-- DEVELOPMENT.md                # This file
`-- README.md                     # Hackathon submission README
```

---

## 4. Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Smart Contracts | Solidity | ^0.8.24 | EligibilityRegistry, KYCGate, PermissionedVault |
| Contract Framework | Hardhat + TypeScript | 2.x | Compile, test, deploy |
| Contract Library | OpenZeppelin | 5.x | ERC-4626, ERC-721, Ownable, ReentrancyGuard |
| Contract Testing | Chai + Hardhat | latest | Unit tests for all contract functions |
| EVM Utilities | viem | 2.x | ABI encoding/decoding in CRE (WASM-compatible) |
| CRE Workflow | TypeScript + @chainlink/cre-sdk | latest | Core oracle logic |
| CRE Runtime | Bun | latest | Required for WASM compilation |
| CRE CLI | cre CLI | latest | Simulation, deployment, workflow management |
| Type Validation | Zod | 3.x | Schema validation for workflow config + API responses |
| Mock KYC API | Express.js + TypeScript | 4.x | Mock provider server |
| API Hosting | Railway | free tier | Deploy mock API publicly |
| Testnet | Tenderly Virtual TestNet | latest | Fork of Sepolia, unlimited ETH, contract inspector |
| Frontend | React + Vite + TypeScript | latest | Demo UI |
| Web3 Frontend | wagmi + RainbowKit | 2.x | Wallet connection + contract calls |
| Admin Backend | Express.js | 4.x | REST API for admin dashboard |
| Frontend Hosting | Vercel | free tier | Deploy React app publicly |
| Version Control | GitHub (public) | — | Required for hackathon submission |

---

## 5. Smart Contracts — Layer 1

### 5.1 EligibilityRegistry.sol

The canonical on-chain source of truth for all KYC attestations. Single integration point for any DeFi protocol.

**Enums and Structs:**

```solidity
enum Tier { BLOCKED, RETAIL, ACCREDITED, INSTITUTIONAL }

struct Attestation {
  Tier     tier;
  uint64   issuedAt;      // Unix timestamp
  uint64   expiresAt;     // Unix timestamp — 0 = never expires
  bytes32  jurisdiction;  // keccak256("US"), keccak256("EU"), etc.
  bytes32  providerHash;  // keccak256(providerName + responseHash)
  bytes32  oracleRef;     // DON transaction reference for audit
  bool     revoked;
}
```

**State Variables:**

```
mapping(address => Attestation)   attestations       // current state
mapping(address => Attestation[]) attestationHistory // full history
address oracle    // CRE workflow oracle address — only this can write
address owner     // multi-sig admin
```

**Key Functions:**

| Function | Modifier | Purpose |
|---|---|---|
| `isEligible(address)` | view | Returns true if tier >= RETAIL, not expired, not revoked |
| `isEligibleForTier(address, Tier)` | view | Tier-gated check — vault uses this |
| `getAttestation(address)` | view | Full attestation struct for auditing |
| `setAttestation(address, Tier, uint64, bytes32, bytes32, bytes32)` | onlyOracle | Write new attestation |
| `revokeAttestation(address, bytes32)` | onlyOracleOrAdmin | Revoke with reason code |
| `batchRevoke(address[], bytes32)` | onlyOracleOrAdmin | Emergency bulk revocation |
| `setOracleAddress(address)` | onlyOwner | Update oracle address (upgrade path) |

**Events:**

```
AttestationIssued(address indexed user, Tier tier, uint64 expiry, bytes32 oracleRef)
AttestationRevoked(address indexed user, bytes32 reasonCode, uint64 timestamp)
AttestationRenewed(address indexed user, Tier newTier, uint64 newExpiry)
```

**Validity Logic:**

```
_isValid(Attestation):
  if (revoked)                              return false
  if (expiresAt != 0 && now > expiresAt)   return false
  return true
```

### 5.2 KYCGate.sol

User-facing entry point. Accepts KYC requests and emits the event that triggers the CRE workflow.

**Enums and Structs:**

```solidity
enum RequestStatus { PENDING, FULFILLED, EXPIRED, FAILED }

struct KYCRequest {
  address       requester;
  bytes32       jurisdiction;   // keccak256(jurisdictionString)
  uint256       requestId;
  uint64        createdAt;
  uint64        expiresAt;      // 1 hour after creation
  RequestStatus status;
}
```

**State Variables:**

```
uint256 nextRequestId
mapping(address => uint256)    pendingRequest   // address → active requestId
mapping(uint256 => KYCRequest) requests         // requestId → request details
bool    paused                                  // emergency pause
```

**Key Functions:**

| Function | Purpose |
|---|---|
| `requestKYC(string jurisdiction)` | User initiates verification. Reverts if pending request exists. Emits KYCRequested. |
| `requestKYCForAddress(address, string)` | Relayer requests on behalf of user |
| `hasPendingRequest(address)` | View: does this address have a pending unresolved request? |
| `getRequestStatus(uint256)` | View: what is the status of a specific request? |
| `clearExpiredRequest(address)` | Clear a request that has been pending > 1 hour |
| `pause() / unpause()` | onlyOwner — emergency stop for new requests |

**Events:**

```
KYCRequested(address indexed user, bytes32 jurisdiction, uint256 indexed requestId, uint64 timestamp)
KYCFulfilled(address indexed user, uint256 indexed requestId)
KYCFailed(address indexed user, uint256 indexed requestId, string reason)
```

**Key Rules:**
- One pending request per address at a time — prevents duplicate oracle calls
- Requests expire after 1 hour — user can re-request if oracle is unresponsive
- Fee mechanism: optional ETH fee, default zero for MVP
- Pause only stops NEW requests — existing attestations are unaffected

### 5.3 PermissionedVault.sol

ERC-4626 compliant vault that enforces KYC compliance on every deposit. Demonstrates real DeFi integration.

**Constructor Parameters:**

```
address asset             // ERC-20 token the vault accepts (mock USDC)
address eligibilityRegistry
Tier    requiredTier      // minimum tier for this vault
string  name              // vault name
string  symbol            // vault share token symbol
```

**Three Vault Deployments:**

| Vault | Required Tier | Target Users |
|---|---|---|
| Retail Pool | TIER_1 | Basic KYC users |
| Accredited Pool | TIER_2 | Accredited investors |
| Institutional Pool | TIER_3 | Hedge funds, family offices |

**Key Override:**

```solidity
function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
  internal override {
  require(
    eligibilityRegistry.isEligibleForTier(caller, requiredTier),
    "IneligibleDepositor"
  );
  super._deposit(caller, receiver, assets, shares);
}
```

**Rules:**
- Deposit: requires eligible attestation at or above requiredTier
- Withdraw: ALWAYS allowed — compliance gates entry only, never exit
- Whitelist override: owner can add grandfathered addresses during migration
- Yield simulation: mock 5% APY accrual using block.timestamp

**Events:**

```
DepositRejected(address indexed user, string reason)
```

### 5.4 IEligibilityRegistry.sol (Interface)

Minimal interface for external protocol integration. Any DeFi protocol imports this, not the full contract.

```solidity
interface IEligibilityRegistry {
  function isEligible(address user) external view returns (bool);
  function isEligibleForTier(address user, Tier minTier) external view returns (bool);
}
```

---

## 6. CRE Workflows — Layer 2

### 6.1 Workflow 1: kyc-verification.ts

**Trigger:** EVM Log — listens for `KYCRequested` events on KYCGate.sol

**Runtime Requirements:**
- Bun (not Node.js)
- Only @chainlink/cre-sdk imports
- No Node.js built-ins (no `node:crypto`, no `Buffer`)
- Use viem for all encoding/hashing (WASM-compatible)
- Use `.result()` pattern everywhere — no standard Promises

**Config Schema (Zod):**

```typescript
const configSchema = z.object({
  kycApiUrl:         z.string().url(),
  chainSelectorName: z.string(),
  kycGateAddress:    z.string(),
  registryAddress:   z.string(),
  provider:          z.enum(["mock", "jumio", "onfido"]),
  jurisdictionRules: z.record(z.object({
    minTier:   z.enum(["RETAIL", "ACCREDITED", "INSTITUTIONAL"]),
    ttlDays:   z.number(),
    sanctions: z.array(z.string()),
  })),
})
```

**Execution Steps:**

```
1. Extract user address + jurisdiction from trigger payload
   - Use viem decodeEventLog() with KYCGate ABI
   - Validate with Zod before any processing

2. Fetch API key from Vault DON
   - runtime.getSecret("KYC_API_KEY")
   - Key is threshold-encrypted, only reconstructed inside TEE

3. Select provider adapter based on config.provider
   - mock   → MockAdapter
   - jumio  → JumioAdapter
   - onfido → OnfidoAdapter

4. Call KYC API via ConfidentialHTTPClient
   - confClient.post(runtime, { url, headers, body }).result()
   - Entire HTTP call happens inside TEE
   - Full response: {name, passport, DOB, eligible, tier, sanctionsHit...}

5. Extract eligibility — extractEligibility() pure function
   - Input:  full raw KYC response + jurisdiction + config
   - Output: { tier, expiresAt, jurisdictionHash, providerHash, oracleRef }
   - EVERYTHING else is garbage collected here — never exits TEE

6. Write to EligibilityRegistry via EVMClient
   - evmClient.writeContract(runtime, {
       address: config.registryAddress,
       abi: REGISTRY_ABI,
       functionName: "setAttestation",
       args: [user, tier, expiresAt, jurisdictionHash, providerHash, oracleRef]
     }).result()

7. Error handling
   - KYC API timeout → emit KYCFailed event via writeContract
   - Invalid jurisdiction → emit KYCMismatch event
   - Never silent failures
```

**extractEligibility() — Pure Function:**

```typescript
// This function is the privacy boundary.
// Everything that enters rawKYCData stays here.
// Only the returned object is allowed to leave the enclave.

function extractEligibility(rawKYCData, jurisdiction, config) {
  const rules = config.jurisdictionRules[jurisdiction]
  const eligible = rawKYCData.eligible && !rawKYCData.sanctionsHit
  const tier = eligible ? mapTier(rawKYCData.tier) : Tier.BLOCKED

  return {
    tier,
    expiresAt:        Math.floor(Date.now()/1000) + (rules.ttlDays * 86400),
    jurisdictionHash: keccak256(toUtf8Bytes(jurisdiction)),    // viem
    providerHash:     keccak256(toUtf8Bytes(rawKYCData.provider + rawKYCData.responseId)),
    oracleRef:        keccak256(toUtf8Bytes(String(requestId))),
  }
}
```

### 6.2 Workflow 2: sanctions-screening.ts

**Trigger:** CRE Cron — fires every 6 hours

**Execution Steps:**

```
1. Read all active attestation addresses from EligibilityRegistry
   - EVMClient.readContract() — get all non-revoked, non-expired addresses
   - Process in batches of 100 (avoid TEE timeout)

2. Inside TEE — call sanctions APIs
   - ConfidentialHTTPClient call to mock OFAC API
   - ConfidentialHTTPClient call to mock EU Sanctions API
   - Response: { "0xBBB": "SDN_HIT", ... }

3. For each sanctioned address:
   - EVMClient.writeContract() → revokeAttestation(address, "SANCTIONS_HIT")
   - Note: specific list name (OFAC vs EU) does NOT exit the TEE
   - Only the fact of revocation is written on-chain

4. Emit audit event:
   - SanctionsScreeningCompleted(screened, revoked, timestamp)
```

### 6.3 Provider Adapters

All adapters implement one interface:

```typescript
interface KYCProvider {
  check(address: string, jurisdiction: string): KYCResult
}

type KYCResult = {
  eligible:     boolean
  tier:         "RETAIL" | "ACCREDITED" | "INSTITUTIONAL" | "BLOCKED"
  jurisdiction: string
  provider:     string
  responseId:   string
  ttlDays:      number
  sanctionsHit: boolean
  // PII fields also present — but only used inside extractEligibility()
}
```

Swap providers by changing `config.provider` — zero workflow logic changes.

---

## 7. Mock KYC API — Layer 3

Built with Express.js + TypeScript. Deployed on Railway. Simulates Jumio, Onfido, and Chainalysis.

### Endpoints

**POST /kyc/verify**

Request:
```json
{
  "address": "0x1111...",
  "jurisdiction": "US",
  "provider": "mock-kyc-v1"
}
```

Response:
```json
{
  "eligible": true,
  "tier": "INSTITUTIONAL",
  "jurisdiction": "US",
  "provider": "mock-kyc-v1",
  "responseId": "resp_abc123",
  "verifiedAt": "2026-03-01T10:00:00Z",
  "ttlDays": 365,
  "firstName": "John",
  "lastName": "Smith",
  "dateOfBirth": "1985-06-15",
  "documentType": "PASSPORT",
  "documentNumber": "AB1234567",
  "issuingCountry": "US",
  "documentExpiry": "2030-01-01",
  "amlRiskScore": 12,
  "sanctionsHit": false,
  "pepFlag": false,
  "adverseMedia": false
}
```

**GET /sanctions/check?address=0xBBB**

Response:
```json
{
  "address": "0xBBB",
  "sanctioned": true,
  "list": "OFAC_SDN",
  "matchType": "exact"
}
```

**GET /health**

Response:
```json
{
  "status": "ok",
  "provider": "mock-kyc-v1",
  "timestamp": "2026-03-06T10:00:00Z"
}
```

### Deterministic Responses

```
Address prefix → Response
0x1111...      → TIER_3 INSTITUTIONAL
0x2222...      → TIER_2 ACCREDITED
0x3333...      → TIER_1 RETAIL
0x9999...      → TIER_0 BLOCKED (eligible: false, sanctionsHit: true)
Everything else → TIER_1 RETAIL (default)
```

### Auth + Error Simulation

```
Auth:    Bearer token required (hardcoded: "mock-bearer-token-123")
         Demonstrates Vault DON secret management

Errors:  GET /kyc/verify?forceError=true
         Returns 500 with timeout message
         Tests error handling in CRE workflow
```

---

## 8. Build Phases

### Phase 0 — Environment Setup (First)

```
- Initialize GitHub repo
- Create monorepo folder structure
- Setup Hardhat in /contracts (npx hardhat init)
- Setup Express in /mock-api (bun init)
- Setup CRE workflow in /cre-workflow (cre init)
- Configure Hardhat with Tenderly VT network
- Create Tenderly Virtual TestNet (fork Sepolia)
- Create 4 test wallets in MetaMask
- Fund wallets with Tenderly ETH
- Deploy mock API to Railway (must be public for CRE to reach it)
- cre login — authenticate with CRE
- Save all config to .env

DONE WHEN:
  npx hardhat compile succeeds
  GET https://[railway-url]/health returns 200
  cre whoami shows logged-in user
  Tenderly VT has RPC URL saved in .env
```

### Phase 1 — Core Smart Contracts + P0 (Critical Path)

```
- Write EligibilityRegistry.sol (full spec from section 5.1)
- Write KYCGate.sol (full spec from section 5.2)
- Write PermissionedVault.sol (full spec from section 5.3)
- Write IEligibilityRegistry.sol interface
- Write unit tests for all three contracts
- Deploy all contracts to Tenderly VT
- Save addresses to .addresses.json
- Write CRE workflow skeleton (cron trigger first, not EVM Log)
- Test ConfidentialHTTPClient with GET /health (simplest possible call)
- Implement extractEligibility() pure function
- Write unit tests for extractEligibility()
- Connect EVMClient to EligibilityRegistry
- Run full end-to-end simulation for all 4 test addresses
- Switch trigger from cron to EVM Log

DONE WHEN:
  All 4 test addresses produce correct tier outputs
  setAttestation() visible on Tenderly VT
  Vault deposit: eligible address accepted, ineligible rejected
```

### Phase 2 — Multi-Tier + Jurisdiction + Sanctions (P1)

```
- Implement all 4 tiers in extractEligibility()
- Implement jurisdiction rules config (US, EU, SG)
- Implement provider adapter pattern (mock, jumio-style, onfido-style)
- Test attestation expiry (block.timestamp > expiresAt → false)
- Test attestation revocation (revoked = true → immediate block)
- Test attestation renewal (re-request before expiry)
- Write sanctions-screening.ts workflow
- Add mock OFAC endpoint to mock API (/sanctions/check)
- Test full revocation flow end-to-end

DONE WHEN:
  All 3 jurisdictions produce correct TTLs
  Sanctions hit → vault blocks address within 1 run
  All tier upgrade/downgrade paths work
```

### Phase 3 — Admin API (P1)

```
- Write REST API endpoints:
    GET  /api/attestations/:address
    POST /api/revoke
    GET  /api/stats
    GET  /api/audit-log
- JWT authentication for admin routes
- WebSocket feed for real-time events

DONE WHEN:
  All endpoints return correct data
  JWT auth working
  Revoke from API reflects on-chain
```

### Phase 4 — Frontend (P1 — Last)

```
- Connect wallet (wagmi + RainbowKit)
- KYC Request page
- Attestation Status page (tier badge, expiry)
- Vault page (3 vaults, deposit forms)
- Admin dashboard (attestation table, revoke button)
- Deploy to Vercel

DONE WHEN:
  End-to-end flow works in browser
  Vercel URL is public and accessible
```

### Phase 5 — Polish + Submit

```
- README: architecture diagram, all Chainlink file links, Tenderly URL
- NatSpec comments on all contracts
- Remove all console.logs from contracts
- Zod validation in workflow config
- Practice demo run (full video script)
- Record demo video (3-5 minutes)
- Upload to YouTube (unlisted) or Loom
- Final git push (no .env, no private keys)
- Submit via hackathon form before March 8, 11:59 PM ET
```

---

## 9. Environment Setup

### Required Accounts

```
- GitHub account (public repo)
- Tenderly account (virtual testnet)
- Railway account (mock API hosting)
- Vercel account (frontend hosting — Phase 4)
- CRE account at cre.chain.link
- MetaMask with 4 test wallets
```

### .env Structure

```bash
# Tenderly
TENDERLY_RPC_URL=https://virtual.sepolia.rpc.tenderly.co/xxxxx
TENDERLY_EXPLORER_URL=https://dashboard.tenderly.co/vansh/project/testnet/xxxxx

# Deployed Contract Addresses (filled after Phase 1 deploy)
KYC_GATE_ADDRESS=
ELIGIBILITY_REGISTRY_ADDRESS=
VAULT_RETAIL_ADDRESS=
VAULT_ACCREDITED_ADDRESS=
VAULT_INSTITUTIONAL_ADDRESS=

# Mock API
MOCK_API_URL=https://[railway-app].railway.app
MOCK_API_BEARER_TOKEN=mock-bearer-token-123

# CRE
CRE_ORACLE_ADDRESS=    # filled after cre deploy

# Test Wallets (public addresses only — NEVER private keys in .env)
WALLET_INSTITUTIONAL=0x1111...
WALLET_ACCREDITED=0x2222...
WALLET_RETAIL=0x3333...
WALLET_BLOCKED=0x9999...

# Admin
ADMIN_JWT_SECRET=
```

### .addresses.json Structure

```json
{
  "tenderly": {
    "KYCGate": "0x...",
    "EligibilityRegistry": "0x...",
    "VaultRetail": "0x...",
    "VaultAccredited": "0x...",
    "VaultInstitutional": "0x...",
    "MockERC20": "0x..."
  }
}
```

---

## 10. Testing Strategy

### Smart Contract Tests (Hardhat + Chai)

Every contract must have tests covering:

**EligibilityRegistry:**
```
- setAttestation() stores correct values
- isEligible() returns true for valid attestation
- isEligible() returns false for expired attestation
- isEligible() returns false for revoked attestation
- isEligibleForTier() respects tier hierarchy
- revokeAttestation() sets revoked = true immediately
- batchRevoke() revokes multiple addresses
- setAttestation() reverts for non-oracle caller
- setOracleAddress() only callable by owner
- Full attestation history preserved after renewal
```

**KYCGate:**
```
- requestKYC() emits KYCRequested with correct params
- requestKYC() reverts if pending request exists
- requestKYC() creates correct KYCRequest struct
- Request expires after 1 hour (block.timestamp manipulation)
- clearExpiredRequest() allows re-request after expiry
- pause() blocks new requests
- pause() does not affect existing attestations
```

**PermissionedVault:**
```
- deposit() succeeds for TIER_1 wallet on TIER_1 vault
- deposit() reverts for unverified wallet
- deposit() reverts for TIER_1 wallet on TIER_2 vault
- deposit() reverts for revoked attestation (immediate effect)
- withdraw() always succeeds regardless of attestation status
- Correct shares minted on deposit
- Correct assets returned on withdrawal
```

### CRE Workflow Tests

```
- extractEligibility() unit tests (pure function, easy to test)
  - Returns BLOCKED when sanctionsHit = true
  - Returns correct tier mapping
  - Applies correct TTL per jurisdiction
  - Handles missing jurisdiction gracefully
- Provider adapter tests
  - Mock adapter returns correct response schema
  - Response schema matches KYCResult type
```

### Integration Tests

```
- End-to-end: requestKYC → CRE simulate → attestation on Tenderly VT
- All 4 test wallets produce correct tier outputs
- Revocation flow: attest → sanctions hit → vault blocked
```

---

## 11. Deployment Strategy

### Step 1: Deploy Mock API to Railway

```bash
cd mock-api
railway login
railway init
railway up
# Note the public URL: https://[app].railway.app
```

### Step 2: Deploy Contracts to Tenderly VT

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network tenderly
# Addresses automatically saved to ../.addresses.json
```

### Step 3: Configure CRE Workflow

```bash
cd cre-workflow
# Update config.json with:
#   - registryAddress from .addresses.json
#   - kycGateAddress from .addresses.json
#   - kycApiUrl from Railway deployment
#   - chainSelectorName for Tenderly VT
```

### Step 4: Add Secrets to CRE Vault DON

```bash
cre secrets set KYC_API_KEY "mock-bearer-token-123"
```

### Step 5: Simulate Workflow

```bash
cre workflow simulate kyc-verification.ts
# Must pass with zero errors before deploying
```

### Step 6: Deploy CRE Workflow

```bash
cre workflow deploy kyc-verification.ts
cre workflow deploy sanctions-screening.ts
# Note the oracle address — update EligibilityRegistry with setOracleAddress()
```

### Step 7: Update Oracle Address

```bash
cd contracts
npx hardhat run scripts/setOracle.ts --network tenderly
# Sets the deployed CRE oracle address in EligibilityRegistry
```

---

## 12. Feature Priority List

### P0 — Must Ship (Hackathon Non-Negotiable)

| ID | Feature | Component |
|---|---|---|
| F-01 | Confidential KYC Verification Workflow | cre-workflow/kyc-verification.ts |
| F-03 | Multi-Tier Eligibility System (4 tiers) | EligibilityRegistry.sol |
| F-05 | Attestation Lifecycle (issue, expire, renew, revoke) | EligibilityRegistry.sol |
| F-06 | EligibilityRegistry Smart Contract | EligibilityRegistry.sol |
| F-07 | KYCGate Entry Contract | KYCGate.sol |
| F-08 | PermissionedVault ERC-4626 | PermissionedVault.sol |
| F-10 | Mock KYC API Server | mock-api/ |

### P1 — Should Ship (Score Boost)

| ID | Feature | Component |
|---|---|---|
| F-02 | Multi-Provider KYC Adapter | cre-workflow/adapters/ |
| F-04 | Multi-Jurisdiction Rule Engine | cre-workflow/config.json |
| F-09 | Sanctions Screening Sub-Workflow | cre-workflow/sanctions-screening.ts |
| F-13 | Admin Dashboard & REST API | mock-api/admin routes |
| F-14 | Demo Frontend | frontend/ |

### P2 — Nice To Have (Post-Hackathon)

| ID | Feature | Component |
|---|---|---|
| F-11 | Attestation SBT (ERC-721 Soulbound) | AttestationSBT.sol |
| F-12 | Protocol Integration SDK | npm package |

---

## 13. Coding Conventions

### Solidity

```
- Solidity version: ^0.8.24
- OpenZeppelin 5.x for all standard implementations
- NatSpec on every public function (@param, @return, @dev)
- Custom errors over require strings where possible
- No magic numbers — use named constants
- Events for every state change
- onlyOracle modifier on all write functions
- ReentrancyGuard on all vault functions
```

### TypeScript (CRE Workflow)

```
- Bun runtime only — no Node.js APIs
- Zod validation on all external data (config, API responses)
- .result() pattern for all CRE SDK calls — no async/await
- viem for all encoding/hashing (not ethers, not node:crypto)
- Pure functions where possible — extractEligibility() is pure
- No hardcoded addresses or URLs — everything from config
- Fail loudly — never swallow errors silently
```

### General

```
- No .env files committed (ever)
- No private keys in code (ever)
- Conventional commits: feat:, fix:, chore:, docs:
- No console.log in final code (use events for on-chain logging)
```

---

## 14. Key Design Decisions

### Why TEE Over ZK-Proofs?

ZK-proofs require writing custom circuits for each proof type. They are mathematically complex, hard to audit, and require the KYC provider to support specific proof formats. TEEs work with ANY existing HTTP API — we call Jumio exactly as they are today, with no changes on their side.

### Why ConsensusIdenticalAggregation?

KYC is binary. Either you are or are not an accredited investor. There is no "median" or "average" of an identity check. All nodes must agree on the exact same boolean result — any discrepancy indicates a compromised node or a network issue, not a valid result to average.

### Why EVM Log Trigger (Not Cron) For KYC Workflow?

The user experience must be reactive. When a user requests KYC, the oracle must respond immediately to that specific event — not wait for the next scheduled cron run. EVM Log Trigger provides event-driven architecture: the moment KYCRequested fires, all oracle nodes wake up and process that specific request.

### Why ERC-4626 For The Vault?

ERC-4626 is the standard for tokenized vaults in DeFi. Every major protocol (Aave, Yearn, Morpho) supports it. By building on ERC-4626, our vault is automatically compatible with every DeFi aggregator, wallet, and yield optimizer that exists — without any extra integration work.

### Why Separate Sanctions Workflow?

KYC verification is point-in-time. Someone can pass KYC today and be sanctioned tomorrow. The sanctions workflow runs independently every 6 hours to catch this. If merged with the KYC workflow, sanctions screening would only happen at onboarding — missing post-verification sanctions additions entirely.

### Why The Mock API Mirrors Real Provider Schema Exactly?

The CRE workflow is designed to work with real Jumio responses. The mock API returns the exact same JSON structure that Jumio would return. This means switching to production is a config URL change, not a code change. It also demonstrates to judges that we understand the real-world integration requirements.

---

## 15. Submission Checklist

### Mandatory (All Must Pass)

```
M1: CRE Workflow exists and uses CRE SDK
    → kyc-verification.ts imports @chainlink/cre-sdk

M2: ConfidentialHTTPClient used meaningfully
    → Not standard HTTPClient — must be Confidential variant

M3: cre workflow simulate runs cleanly
    → Zero errors, full end-to-end pass

M4: At least one on-chain write demonstrated
    → setAttestation() visible on Tenderly VT

M5: 3-5 minute publicly viewable video
    → YouTube/Loom URL accessible without login

M6: Public GitHub repository
    → All code pushed, no .env files, no private keys

M7: README with all Chainlink file links
    → Every file using @chainlink/cre-sdk linked

M8: Tenderly VT explorer link in README
    → Shows deployed contracts + transactions

M9: Submitted via hackathon submission form
    → Before March 8, 11:59 PM ET
```

### Quality Polish (Score Boosters)

```
- Two test cases shown: eligible address accepted + ineligible rejected
- Third test case: sanctioned address shows real-time revocation
- NatSpec comments on all smart contract functions
- Workflow config uses Zod schema validation
- README has architecture diagram
- Frontend deployed to Vercel (public URL)
- Multi-tier vault demo: 3 vaults with different tier requirements
- Clean git commit history (conventional commits)
```

---

*Pramanik — Built for Chainlink Convergence 2026, Privacy Track*
*Submission deadline: March 8, 2026, 11:59 PM ET*
