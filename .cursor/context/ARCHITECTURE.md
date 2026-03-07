# Pramanik — System Architecture

## Three-Layer Architecture

```
LAYER 1 — SMART CONTRACT LAYER (Blockchain, Public, Permanent)
  KYCGate.sol              User entry point — accepts KYC requests, emits events
  EligibilityRegistry.sol  Source of truth — stores all KYC attestations
  PermissionedVault.sol    ERC-4626 vault — enforces KYC on every deposit

LAYER 2 — CRE ORACLE LAYER (Chainlink Runtime Environment)
  kyc-verification.ts      Workflow 1 — triggered by KYCRequested events
  sanctions-screening.ts   Workflow 2 — cron every 6 hours
  TEE Enclave              Hardware-isolated — processes and destroys PII
  20+ DON Nodes            Consensus required on every result

LAYER 3 — EXTERNAL DATA LAYER (Real World APIs)
  Mock KYC API             Simulates Jumio/Onfido/Chainalysis (hackathon)
  Real providers           Swap in for production (URL change in config only)
```

## Layer Interaction Rules

- Layer 3 never talks to Layer 1 directly — TEE is always the gatekeeper
- Layer 1 cannot call external APIs — it is blockchain-isolated
- Only the CRE oracle address can write to EligibilityRegistry
- All private data enters Layer 2 (TEE) and is destroyed there — never reaches Layer 1

## KYC Verification Data Flow

```
Step 1:  User calls KYCGate.requestKYC("US")
         → Emits KYCRequested(user=0xAAA, jurisdiction="US", requestId=42)

Step 2:  CRE EVM Log Trigger detects KYCRequested event
         → All 20+ nodes start workflow simultaneously

Step 3:  TEE fetches API key from Vault DON
         → Threshold-encrypted, reconstructed only inside enclave

Step 4:  TEE calls POST /kyc/verify via ConfidentialHTTPClient
         → Full response: {name, passport, DOB, eligible, tier, sanctionsHit...}

Step 5:  TEE runs extractEligibility()
         → Extracts: {tier, expiresAt, jurisdictionHash, providerHash, oracleRef}
         → Destroys: everything else (name, passport, DOB never leave enclave)

Step 6:  ConsensusIdenticalAggregation
         → All 20+ nodes must agree on identical result
         → KYC is binary, not averaged — exact match required

Step 7:  EVMClient calls EligibilityRegistry.setAttestation()
         → On-chain state: "0xAAA = TIER_2, expires March 2027"
         → Emits: AttestationIssued(0xAAA, TIER_2, expiry, oracleRef)

Step 8:  User calls PermissionedVault.deposit(1000 USDC)
         → Vault checks: isEligibleForTier(0xAAA, TIER_2) → true
         → Deposit accepted
```

## Sanctions Screening Data Flow

```
Step 1:  CRE Cron fires every 6 hours
Step 2:  Read all active addresses from EligibilityRegistry
Step 3:  TEE calls OFAC API + EU Sanctions API (batch of 100 addresses)
Step 4:  Identifies sanctioned addresses
         → Specific list name and match reason stay inside TEE
Step 5:  EVMClient calls revokeAttestation(address, "SANCTIONS_HIT")
Step 6:  isEligible(address) immediately returns false
Step 7:  All integrated vaults block the address on next transaction
Step 8:  Emits SanctionsScreeningCompleted(screened, revoked, timestamp)
```

## Four Attestation Tiers

```
TIER_0 — BLOCKED       On sanctions list or fraud flag. Zero access everywhere.
TIER_1 — RETAIL        Basic KYC pass. Access to retail pools only.
TIER_2 — ACCREDITED    High net worth verified ($1M+ or $200K+ income). Access to institutional pools.
TIER_3 — INSTITUTIONAL Full entity verification + AML screening. Access to all pools.
```

## Attestation Lifecycle

```
ISSUED   → setAttestation() called by oracle
VALID    → not expired, not revoked, tier >= RETAIL
EXPIRED  → block.timestamp > expiresAt (automatic, no transaction needed)
REVOKED  → revokeAttestation() called by oracle or admin
RENEWED  → new setAttestation() overwrites old — history preserved in events
```

## Component Diagram

```
[User Wallet]
     |
     | requestKYC("US")
     v
[KYCGate.sol] ----emits KYCRequested event----> [CRE EVM Log Trigger]
                                                          |
                                                          v
                                               [CRE Workflow — TEE]
                                                  |           |
                                                  |           | ConfidentialHTTP
                                                  |           v
                                                  |     [Mock KYC API]
                                                  |     (Layer 3)
                                                  |
                                                  | setAttestation()
                                                  v
[PermissionedVault.sol] <--isEligible()-- [EligibilityRegistry.sol]
     |
     | deposit accepted/rejected
     v
[User Wallet]
```

## Why This Architecture

### Why TEE Over ZK-Proofs?
ZK-proofs require custom circuits per proof type and KYC provider cooperation. TEEs work with any existing HTTP API — we call Jumio exactly as it is today.

### Why 20+ Oracle Nodes?
Single oracle = single point of failure/corruption. 20+ nodes means: hack one = 19 others override it. Compromise requires majority of independent operators.

### Why Separate Sanctions Workflow?
KYC passes at onboarding. Sanctions can hit any time after. Two separate concerns need two separate workflows. Cron ensures ongoing monitoring, not just point-in-time checks.

### Why ERC-4626 Vault?
Industry standard. Automatically compatible with Aave, Yearn, Morpho, every DeFi aggregator. One implementation, unlimited integrations.
