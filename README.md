# Pramanik — Privacy-Preserving KYC Oracle

> Sanskrit: प्रामाणिक — *"authentic, verified, certified"*

Pramanik is a decentralized KYC oracle built on **Chainlink CRE** that lets DeFi protocols verify user identity on-chain without exposing any personal data.

**"Prove you are who you say you are — on-chain, without revealing anything about who you are."**

Built for **Chainlink Convergence 2026 — Privacy Track**.

---

## The Problem

Public blockchains are transparent by design. Financial regulations (GDPR, MiFID II, FATF) require identity data to remain confidential. These two requirements directly contradict each other — locking $4.5 trillion in institutional assets out of DeFi.

## The Solution

Route all KYC verification through Chainlink TEEs (Trusted Execution Environments). Raw identity data is fetched from real KYC providers **inside a hardware-isolated enclave**. The enclave extracts only `{ tier, expiresAt }` and destroys everything else. Only that minimal result reaches the blockchain.

---

## Architecture

```
User Wallet
    │
    │  requestKYC("US")
    ▼
KYCGate.sol ──── emits KYCRequested ────► CRE EVM Log Trigger
                                                   │
                                         ┌─────────▼─────────┐
                                         │   TEE Enclave      │
                                         │  - Fetch API key   │
                                         │  - Call KYC API    │
                                         │  - Strip all PII   │
                                         │  - Only tier exits │
                                         └─────────┬─────────┘
                                                   │  setAttestation()
                                                   ▼
PermissionedVault.sol ◄── isEligible() ── EligibilityRegistry.sol
    │
    │  deposit accepted / IneligibleDepositor revert
    ▼
User Wallet
```

**Three layers:**
- **Layer 1 — Contracts:** `KYCGate.sol`, `EligibilityRegistry.sol`, `PermissionedVault.sol`, `AttestationSBT.sol`
- **Layer 2 — CRE Oracle:** Two workflows running in Chainlink TEEs
- **Layer 3 — KYC API:** Mock server simulating Jumio/Onfido/Chainalysis

---

## Live Demo

**Testnet:** Tenderly Virtual TestNet (Mainnet fork, Chain ID `9991`)

**Explorer:** https://dashboard.tenderly.co/1nsh/pramanik/testnet/3bb5794e-660f-4076-98fd-dddae819e8d3

**Frontend:** Open `frontend/index.html` in any browser with MetaMask

---

## Deployed Contracts

Chain ID: `9991` · Network: Tenderly Virtual TestNet

| Contract | Address |
|---|---|
| MockERC20 (mUSDC) | `0x6982631017F49d558dca85D845AB0A8c3200Ba99` |
| EligibilityRegistry | `0x1cdDB0056d4B01267a1b683423046d80180C8eE5` |
| KYCGate | `0x6e414E0BF40196c021A2Af959e9183f254862F59` |
| VaultRetail (Tier 1) | `0xE08cD0eC0a803d282935B16a9eF2f57fCD68ed15` |
| VaultAccredited (Tier 2) | `0x4AC8f3A6Af8a0B951686Eedc4CE1799691327A4D` |
| VaultInstitutional (Tier 3) | `0xDFf01eD53CbbBfF448a7f9B76342bc1Ae5d467a3` |
| AttestationSBT | `0x6091Da9c46F890FCADC5ee3828CEcea6A1b2D0d3` |

---

## Chainlink CRE Files

All files using `@chainlink/cre-sdk`:

| File | Purpose |
|---|---|
| [cre-workflow/kyc-workflow/main.ts](cre-workflow/kyc-workflow/main.ts) | KYC workflow entry point — `Runner.newRunner().run()` |
| [cre-workflow/kyc-workflow/workflow.ts](cre-workflow/kyc-workflow/workflow.ts) | KYC handler — EVM log trigger, ConfidentialHTTPClient, EVMClient write |
| [cre-workflow/sanctions-workflow/main.ts](cre-workflow/sanctions-workflow/main.ts) | Sanctions workflow entry point |
| [cre-workflow/sanctions-workflow/workflow.ts](cre-workflow/sanctions-workflow/workflow.ts) | Sanctions handler — cron trigger, batch screening, revocation |
| [cre-workflow/contracts/KYCGate.ts](cre-workflow/contracts/KYCGate.ts) | CRE binding — `logTrigger` for KYCRequested events |
| [cre-workflow/contracts/EligibilityRegistry.ts](cre-workflow/contracts/EligibilityRegistry.ts) | CRE binding — `setAttestation`, `revokeAttestation`, `getActiveAddresses` |
| [cre-workflow/src/adapters/mock.ts](cre-workflow/src/adapters/mock.ts) | Mock KYC provider adapter |
| [cre-workflow/src/utils/eligibility.ts](cre-workflow/src/utils/eligibility.ts) | `extractEligibility()` — the privacy boundary, pure function |

---

## CRE Workflow Simulation

Both simulations pass:

```bash
cd cre-workflow

# KYC verification workflow (EVM log trigger)
cre workflow simulate kyc-workflow -T staging-settings \
  --evm-tx-hash 0x8a4baa1902edaba15e92ef7c05c2da7625d0ece26af420d7e87b9e0e43ff2a34 \
  --evm-event-index 0 --non-interactive --trigger-index 0
# Output: "issued:0x4cffe5dd6d181be5617f9d5afe42bf01978f11d3:tier=1"

# Sanctions screening workflow (cron trigger)
cre workflow simulate sanctions-workflow -T staging-settings --non-interactive --trigger-index 0
# Output: "screened:0:revoked:0"
```

---

## How It Works — Key Privacy Mechanism

```
KYC API Response (inside TEE):
{
  name: "John Smith",          ← DESTROYED
  passport: "AB1234567",       ← DESTROYED
  dateOfBirth: "1985-06-15",   ← DESTROYED
  eligible: true,
  tier: "ACCREDITED",          ← kept (as number)
  sanctionsHit: false,
}
           │
           ▼  extractEligibility()
           │
On-chain write:
{
  tier: 2,                     ✓ written
  expiresAt: 1790000000,       ✓ written
  jurisdictionHash: 0xabc...,  ✓ written (keccak256, not plaintext)
  providerHash: 0xdef...,      ✓ written (keccak256, not plaintext)
}
```

Zero PII ever reaches the blockchain.

---

## Repository Structure

```
├── contracts/                  # Solidity smart contracts (Hardhat)
│   ├── contracts/
│   │   ├── KYCGate.sol         # Entry point — emits KYCRequested
│   │   ├── EligibilityRegistry.sol  # On-chain attestation store
│   │   ├── PermissionedVault.sol    # ERC-4626 vault gated by KYC tier
│   │   ├── AttestationSBT.sol  # Soulbound token for KYC attestations
│   │   └── interfaces/IEligibilityRegistry.sol
│   └── scripts/
│       ├── deploy.ts
│       ├── issueAttestation.ts
│       └── e2eTest.ts          # Full end-to-end test (20 assertions)
├── cre-workflow/               # Chainlink CRE TypeScript workflows
│   ├── kyc-workflow/           # EVM log trigger → KYC verification
│   ├── sanctions-workflow/     # Cron trigger → sanctions screening
│   ├── contracts/              # CRE contract bindings
│   └── src/
│       ├── adapters/           # KYC provider adapters (mock, jumio, onfido)
│       └── utils/eligibility.ts
├── mock-api/                   # Express mock KYC API (simulates Jumio/Onfido)
│   └── Deployed: https://lobster-app-ieakp.ondigitalocean.app
└── frontend/
    └── index.html              # Single-file demo UI (ethers.js v6, MetaMask)
```

---

## Local Setup

```bash
# 1. Install dependencies
cd contracts && npm install
cd ../cre-workflow && bun install
cd ../mock-api && bun install

# 2. Copy env
cp .env.example .env
# Fill in TENDERLY_RPC_URL and DEPLOYER_PRIVATE_KEY

# 3. Deploy contracts
cd contracts
npx hardhat run scripts/deploy.ts --network tenderly

# 4. Issue demo attestation
npx hardhat run scripts/issueAttestation.ts --network tenderly

# 5. Open frontend/index.html in browser — connect MetaMask to chainId 9991
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Smart Contracts | Solidity ^0.8.24, OpenZeppelin 5.x, Hardhat |
| CRE Workflows | TypeScript, @chainlink/cre-sdk, Bun |
| Encoding | viem 2.x (WASM-compatible) |
| Validation | Zod 3.x |
| Mock API | Express.js 4.x, TypeScript, Digital Ocean App Platform |
| Frontend | Vanilla HTML/JS, ethers.js v6 |
| Testnet | Tenderly Virtual TestNet (Mainnet fork, Chain ID 9991) |
