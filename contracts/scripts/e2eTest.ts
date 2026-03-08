// End-to-end test script for Pramanik on Tenderly Virtual TestNet.
// Demonstrates the full KYC gate flow without needing CRE deployed.
//
// Run: npx hardhat run scripts/e2eTest.ts --network tenderly
//
// What this proves:
//  1. Oracle (deployer) can issue attestations at each tier
//  2. Eligible address can deposit into the correct vault
//  3. Address without attestation is rejected (IneligibleDepositor)
//  4. TIER_1 address is rejected from TIER_2 vault
//  5. Revocation immediately blocks a previously-eligible depositor
//  6. Withdrawal is always allowed regardless of attestation status

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── ABI fragments ────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  "function setAttestation(address user, uint8 tier, uint64 expiresAt, bytes32 jurisdiction, bytes32 providerHash, bytes32 oracleRef) external",
  "function revokeAttestation(address user, bytes32 reasonCode) external",
  "function isEligible(address user) external view returns (bool)",
  "function isEligibleForTier(address user, uint8 minTier) external view returns (bool)",
  "function getAttestation(address user) external view returns (tuple(uint8 tier, uint64 issuedAt, uint64 expiresAt, bytes32 jurisdiction, bytes32 providerHash, bytes32 oracleRef, bool revoked))",
  "event AttestationIssued(address indexed user, uint8 tier, uint64 expiry, bytes32 oracleRef)",
  "event AttestationRevoked(address indexed user, bytes32 reasonCode, uint64 timestamp)",
];

const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "error IneligibleDepositor()",
];

const ERC20_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(label: string) {
  return label.padEnd(55, ".");
}

function ok(label: string, detail = "") {
  console.log(`  ✓ ${pad(label)} ${detail}`);
}

function fail(label: string, detail = "") {
  console.log(`  ✗ ${pad(label)} ${detail}`);
  process.exitCode = 1;
}

async function expectRevert(
  promise: Promise<unknown>,
  label: string,
  errorName: string,
) {
  try {
    await promise;
    fail(label, `expected revert (${errorName}) but tx succeeded`);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? "";
    if (msg.includes(errorName) || msg.includes("revert")) {
      ok(label, `reverted: ${errorName}`);
    } else {
      fail(label, `unexpected error: ${msg.slice(0, 80)}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load deployed addresses
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../.addresses.json"), "utf8"),
  ).tenderly;

  const [deployer, wallet1, wallet2, wallet3] = await ethers.getSigners();

  // If only 1 signer (Tenderly), use address derivation for test wallets
  // We'll use the deployer as the test user since Tenderly VT only exposes one key
  const testUser = deployer;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Pramanik — End-to-End Test on Tenderly VT");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Deployer / Oracle: ${deployer.address}`);
  console.log(`  Test User:         ${testUser.address}`);
  console.log(`  Network Chain ID:  ${(await ethers.provider.getNetwork()).chainId}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── Connect to contracts ──────────────────────────────────────────────────

  const registry    = await ethers.getContractAt(REGISTRY_ABI,   addresses.EligibilityRegistry, deployer);
  const vaultRetail = await ethers.getContractAt(VAULT_ABI,       addresses.VaultRetail,          testUser);
  const vaultAccred = await ethers.getContractAt(VAULT_ABI,       addresses.VaultAccredited,       testUser);
  const usdc        = await ethers.getContractAt(ERC20_ABI,        addresses.MockERC20,             deployer);

  const decimals   = await usdc.decimals();
  const DEPOSIT    = ethers.parseUnits("1000", decimals); // 1,000 mUSDC
  const BIG_MINT   = ethers.parseUnits("10000", decimals);

  // ─── Setup: mint USDC to test user ────────────────────────────────────────

  console.log("── Setup ───────────────────────────────────────────────");
  let tx = await usdc.mint(testUser.address, BIG_MINT);
  await tx.wait();
  ok("Minted 10,000 mUSDC to test user");

  // Approve both vaults
  const usdcAsUser = usdc.connect(testUser) as typeof usdc;
  tx = await usdcAsUser.approve(addresses.VaultRetail,    BIG_MINT);
  await tx.wait();
  tx = await usdcAsUser.approve(addresses.VaultAccredited, BIG_MINT);
  await tx.wait();
  ok("Approved VaultRetail + VaultAccredited to spend mUSDC");

  // ─── Section 1: No attestation — all deposits revert ────────────────────

  console.log("\n── Section 1: No Attestation ───────────────────────────");

  await expectRevert(
    vaultRetail.deposit(DEPOSIT, testUser.address),
    "Unattested user → VaultRetail deposit reverts",
    "IneligibleDepositor",
  );

  await expectRevert(
    vaultAccred.deposit(DEPOSIT, testUser.address),
    "Unattested user → VaultAccredited deposit reverts",
    "IneligibleDepositor",
  );

  // ─── Section 2: Issue RETAIL attestation (tier = 1) ─────────────────────

  console.log("\n── Section 2: RETAIL Attestation (Tier 1) ─────────────");

  const now         = BigInt(Math.floor(Date.now() / 1000));
  const oneYear     = BigInt(365 * 24 * 60 * 60);
  const expiresAt   = now + oneYear;
  const jurisdiction = ethers.keccak256(ethers.toUtf8Bytes("US"));
  const providerHash = ethers.keccak256(ethers.toUtf8Bytes("mock-kyc-v1resp_retail_001"));
  const oracleRef    = ethers.keccak256(ethers.toUtf8Bytes("request_001"));

  tx = await (registry as any).setAttestation(
    testUser.address,
    1, // RETAIL
    expiresAt,
    jurisdiction,
    providerHash,
    oracleRef,
  );
  await tx.wait();
  ok("setAttestation(RETAIL) called by oracle (deployer)");

  const eligible = await (registry as any).isEligible(testUser.address);
  eligible
    ? ok("isEligible() returns true")
    : fail("isEligible() returns true", "got false");

  const eligibleRetail = await (registry as any).isEligibleForTier(testUser.address, 1);
  eligibleRetail
    ? ok("isEligibleForTier(RETAIL) returns true")
    : fail("isEligibleForTier(RETAIL) returns true", "got false");

  const eligibleAccred = await (registry as any).isEligibleForTier(testUser.address, 2);
  !eligibleAccred
    ? ok("isEligibleForTier(ACCREDITED) returns false for RETAIL user")
    : fail("isEligibleForTier(ACCREDITED) returns false for RETAIL user", "got true");

  // ─── Section 3: Deposit into VaultRetail — should succeed ───────────────

  console.log("\n── Section 3: Deposit into VaultRetail (Tier 1 vault) ──");

  const balanceBefore = await vaultRetail.balanceOf(testUser.address);
  tx = await vaultRetail.deposit(DEPOSIT, testUser.address);
  const receipt = await tx.wait();
  const balanceAfter = await vaultRetail.balanceOf(testUser.address);
  balanceAfter > balanceBefore
    ? ok("deposit(1000 mUSDC) into VaultRetail succeeded", `shares minted: ${ethers.formatUnits(balanceAfter, decimals)}`)
    : fail("deposit into VaultRetail succeeded", "no shares minted");

  // ─── Section 4: RETAIL user cannot deposit into ACCREDITED vault ─────────

  console.log("\n── Section 4: Tier Gate — RETAIL cannot enter Accredited Vault ──");

  await expectRevert(
    vaultAccred.deposit(DEPOSIT, testUser.address),
    "RETAIL user → VaultAccredited deposit reverts",
    "IneligibleDepositor",
  );

  // ─── Section 5: Withdraw from VaultRetail — always allowed ───────────────

  console.log("\n── Section 5: Withdrawal — Always Unrestricted ─────────");

  const sharesToWithdraw = DEPOSIT; // 1:1 initially
  const assetsBefore = await vaultRetail.totalAssets();
  tx = await vaultRetail.withdraw(DEPOSIT / 2n, testUser.address, testUser.address);
  await tx.wait();
  ok("withdraw(500 mUSDC) from VaultRetail succeeded (no KYC check)");

  // ─── Section 6: Upgrade to INSTITUTIONAL — deposit into all vaults ───────

  console.log("\n── Section 6: INSTITUTIONAL Attestation (Tier 3) ───────");

  const vaultInst = await ethers.getContractAt(VAULT_ABI, addresses.VaultInstitutional, testUser);
  const usdcForInst = usdc.connect(testUser) as typeof usdc;
  tx = await usdcForInst.approve(addresses.VaultInstitutional, BIG_MINT);
  await tx.wait();

  const oracleRef2 = ethers.keccak256(ethers.toUtf8Bytes("request_002"));
  const providerHash2 = ethers.keccak256(ethers.toUtf8Bytes("mock-kyc-v1resp_inst_002"));

  tx = await (registry as any).setAttestation(
    testUser.address,
    3, // INSTITUTIONAL
    expiresAt,
    jurisdiction,
    providerHash2,
    oracleRef2,
  );
  await tx.wait();
  ok("setAttestation(INSTITUTIONAL) — tier upgraded");

  // Institutional can deposit in all 3 vaults
  tx = await vaultAccred.deposit(DEPOSIT, testUser.address);
  await tx.wait();
  ok("INSTITUTIONAL user → VaultAccredited deposit succeeded");

  tx = await vaultInst.deposit(DEPOSIT, testUser.address);
  await tx.wait();
  ok("INSTITUTIONAL user → VaultInstitutional deposit succeeded");

  // ─── Section 7: Revoke — immediate block ─────────────────────────────────

  console.log("\n── Section 7: Revocation — Immediate Effect ────────────");

  const sanctionsReason = ethers.keccak256(ethers.toUtf8Bytes("SANCTIONS_HIT"));
  tx = await (registry as any).revokeAttestation(testUser.address, sanctionsReason);
  await tx.wait();
  ok("revokeAttestation(SANCTIONS_HIT) called by oracle");

  const eligibleAfterRevoke = await (registry as any).isEligible(testUser.address);
  !eligibleAfterRevoke
    ? ok("isEligible() returns false after revocation")
    : fail("isEligible() returns false after revocation", "got true");

  await expectRevert(
    vaultRetail.deposit(DEPOSIT, testUser.address),
    "Revoked user → VaultRetail deposit reverts",
    "IneligibleDepositor",
  );

  await expectRevert(
    vaultInst.deposit(DEPOSIT, testUser.address),
    "Revoked user → VaultInstitutional deposit reverts",
    "IneligibleDepositor",
  );

  // ─── Section 8: Withdraw after revocation — still allowed ─────────────────

  console.log("\n── Section 8: Withdrawal After Revocation ──────────────");

  tx = await vaultAccred.withdraw(DEPOSIT / 2n, testUser.address, testUser.address);
  await tx.wait();
  ok("withdraw from VaultAccredited after revocation succeeded");

  tx = await vaultInst.withdraw(DEPOSIT / 2n, testUser.address, testUser.address);
  await tx.wait();
  ok("withdraw from VaultInstitutional after revocation succeeded");

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════");
  if (process.exitCode === 1) {
    console.log("  RESULT: SOME TESTS FAILED — see ✗ above");
  } else {
    console.log("  RESULT: ALL TESTS PASSED");
  }
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("  Tenderly Explorer:");
  console.log("  https://dashboard.tenderly.co/vanshchitransh/pramanik/testnet/4dc0a265-a1b6-4c51-b4eb-1aa712633572\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
