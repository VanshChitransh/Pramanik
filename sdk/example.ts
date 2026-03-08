/**
 * Pramanik SDK — Integration Example
 *
 * Shows how any DeFi protocol gates access using the Pramanik KYC oracle.
 * Copy-paste this into your protocol's deposit logic.
 */

import { PramanikClient, Tier, PRAMANIK_ADDRESSES, TENDERLY_RPC } from "./src/index";

const pramanik = new PramanikClient({
  rpcUrl:          TENDERLY_RPC,
  registryAddress: PRAMANIK_ADDRESSES.tenderly.EligibilityRegistry,
});

async function demo() {
  const wallet = "0x4CfFe5Dd6D181bE5617F9d5AFE42bF01978F11D3";

  // ── 1. Simple binary check ─────────────────────────────────────────────────
  const eligible = await pramanik.isEligible(wallet);
  console.log("isEligible:", eligible);

  // ── 2. Tier-specific check (e.g. accredited-only pool) ────────────────────
  const accredited = await pramanik.isEligibleForTier(wallet, Tier.ACCREDITED);
  console.log("isEligibleForTier(ACCREDITED):", accredited);

  // ── 3. Full attestation details ───────────────────────────────────────────
  const attestation = await pramanik.getAttestation(wallet);
  console.log("Attestation:", {
    tier:      Tier[attestation.tier],
    valid:     attestation.valid,
    expiresAt: new Date(Number(attestation.expiresAt) * 1000).toISOString(),
    revoked:   attestation.revoked,
  });

  // ── 4. Batch check ────────────────────────────────────────────────────────
  const batch = await pramanik.batchIsEligible([
    "0x1111000000000000000000000000000000000000", // INSTITUTIONAL
    "0x2222000000000000000000000000000000000000", // ACCREDITED
    "0x3333000000000000000000000000000000000000", // RETAIL
    "0x9999000000000000000000000000000000000000", // BLOCKED
  ]);
  console.log("Batch results:", batch);
}

demo().catch(console.error);
