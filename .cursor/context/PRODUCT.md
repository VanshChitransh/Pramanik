# Pramanik — Product Context

## What Is Pramanik?

Pramanik (Sanskrit: प्रामाणिक — "authentic, verified, certified") is a decentralized, privacy-preserving KYC oracle built on Chainlink's Runtime Environment (CRE).

It solves the single largest blocker preventing institutional capital from entering DeFi: the inability to verify user identity and compliance status on-chain without violating financial data privacy regulations.

## The Core Problem

Two requirements directly contradict each other:
- Blockchains are public by design — every transaction is visible to everyone
- Financial regulations (GDPR, MiFID II, CCPA, FATF) require that identity data remain strictly confidential

This contradiction locks $4.5 trillion in institutional assets out of DeFi.

Why can't we just encrypt the data and store it on-chain?
- Encryption keys create centralized trust — whoever holds the key is a single point of failure
- Blockchains are permanent — data stored today can be decrypted by quantum computers in the future
- GDPR's right to be forgotten cannot be satisfied — blockchain data cannot be deleted
- Smart contracts are fully transparent — decrypting on-chain exposes the data publicly
- Key management at scale is a nightmare

## The Solution

Route all KYC verification through Chainlink Trusted Execution Environments (TEEs).

Inside a hardware-isolated secure enclave:
1. Call real KYC providers (Jumio, Onfido, Chainalysis)
2. Receive full identity data: name, passport, DOB, sanctions status
3. Extract ONLY: { eligible: bool, tier: TIER_1/2/3, expiry: timestamp }
4. Destroy everything else — it never leaves the enclave
5. Write only the minimal result on-chain

Zero PII ever reaches the blockchain. The verification is cryptographically attested.

## One-Line Value Proposition

"Prove you are who you say you are, on-chain, without revealing anything about who you are."

## Who Uses Pramanik

| User | Pain | What They Get |
|---|---|---|
| DeFi Protocol Operators | Manual KYC = $15-50/user + no on-chain proof | One registry, one function call: isEligible(wallet) |
| Institutional Investors | Can't access compliant DeFi, miss yield | Single KYC, reusable across all protocols |
| Retail Accredited Investors | Re-KYC to every protocol, privacy risk | Verify once, use everywhere |
| Compliance Officers | No auditable on-chain compliance trail | Immutable audit log on blockchain |
| Regulators | DeFi is unauditable, forces blanket bans | Transparent compliance verification |

## What We Are NOT Building
- A KYC provider (we integrate Jumio/Onfido/Chainalysis, we don't replace them)
- A ZK-proof identity system (TEE-based, not ZK circuits)
- A cross-chain bridge (one testnet: Tenderly VT fork of Sepolia)
- A token or governance system
- A mobile app

## Hackathon Context
- Event: Chainlink Convergence 2026 — Privacy Track
- Prize target: 1st place ($10,000)
- Deadline: March 8, 2026, 11:59 PM ET
- Core tech: Chainlink CRE, Confidential HTTP, Confidential Compute, Solidity
