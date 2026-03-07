import { expect } from "chai";
import { ethers } from "hardhat";
import { EligibilityRegistry, MockERC20, PermissionedVault } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("PermissionedVault", () => {
  let registry: EligibilityRegistry;
  let usdc: MockERC20;
  let vaultRetail: PermissionedVault;
  let vaultAccredited: PermissionedVault;
  let oracle: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let retailUser: HardhatEthersSigner;
  let accreditedUser: HardhatEthersSigner;
  let unverifiedUser: HardhatEthersSigner;

  const TIER_RETAIL      = 1;
  const TIER_ACCREDITED  = 2;
  const SANCTIONS_HIT    = ethers.keccak256(ethers.toUtf8Bytes("SANCTIONS_HIT"));
  const jurisUS          = ethers.keccak256(ethers.toUtf8Bytes("US"));
  const providerHash     = ethers.keccak256(ethers.toUtf8Bytes("mock-kyc-v1resp_001"));
  const oracleRef        = ethers.keccak256(ethers.toUtf8Bytes("1"));
  const ONE_YEAR         = BigInt(365 * 24 * 60 * 60);
  const DEPOSIT_AMOUNT   = ethers.parseUnits("1000", 6); // 1000 USDC

  beforeEach(async () => {
    [owner, oracle, retailUser, accreditedUser, unverifiedUser] = await ethers.getSigners();

    // Deploy MockERC20
    const ERC20Factory = await ethers.getContractFactory("MockERC20", owner);
    usdc = await ERC20Factory.deploy("Mock USDC", "mUSDC", 6);
    await usdc.waitForDeployment();

    // Deploy EligibilityRegistry
    const RegFactory = await ethers.getContractFactory("EligibilityRegistry", owner);
    registry = await RegFactory.deploy(oracle.address);
    await registry.waitForDeployment();

    // Deploy vaults
    const VaultFactory = await ethers.getContractFactory("PermissionedVault", owner);
    const usdcAddr = await usdc.getAddress();
    const regAddr  = await registry.getAddress();

    vaultRetail = await VaultFactory.deploy(
      usdcAddr, regAddr, TIER_RETAIL, "Pramanik Retail Pool", "prRETAIL"
    );
    await vaultRetail.waitForDeployment();

    vaultAccredited = await VaultFactory.deploy(
      usdcAddr, regAddr, TIER_ACCREDITED, "Pramanik Accredited Pool", "prACCRED"
    );
    await vaultAccredited.waitForDeployment();

    // Mint USDC to test users and approve vaults
    const { time } = await import("@nomicfoundation/hardhat-network-helpers");
    const expiresAt = BigInt(await time.latest()) + ONE_YEAR;
    for (const user of [retailUser, accreditedUser, unverifiedUser]) {
      await usdc.mint(user.address, DEPOSIT_AMOUNT * 10n);
    }

    // Grant attestations
    await registry.connect(oracle).setAttestation(
      retailUser.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    await registry.connect(oracle).setAttestation(
      accreditedUser.address, TIER_ACCREDITED, expiresAt, jurisUS, providerHash, oracleRef
    );

    // Approve vaults
    const vaultRetailAddr     = await vaultRetail.getAddress();
    const vaultAccreditedAddr = await vaultAccredited.getAddress();
    for (const user of [retailUser, accreditedUser, unverifiedUser]) {
      await usdc.connect(user).approve(vaultRetailAddr, ethers.MaxUint256);
      await usdc.connect(user).approve(vaultAccreditedAddr, ethers.MaxUint256);
    }
  });

  // ---------------------------------------------------------------------------
  // Deposit tests
  // ---------------------------------------------------------------------------

  it("deposit: RETAIL user can deposit into RETAIL vault", async () => {
    await expect(
      vaultRetail.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address)
    ).to.not.be.reverted;
    expect(await vaultRetail.balanceOf(retailUser.address)).to.be.gt(0n);
  });

  it("deposit: ACCREDITED user can deposit into RETAIL vault (tier >= required)", async () => {
    await expect(
      vaultRetail.connect(accreditedUser).deposit(DEPOSIT_AMOUNT, accreditedUser.address)
    ).to.not.be.reverted;
  });

  it("deposit: unverified user reverts with IneligibleDepositor", async () => {
    await expect(
      vaultRetail.connect(unverifiedUser).deposit(DEPOSIT_AMOUNT, unverifiedUser.address)
    ).to.be.revertedWithCustomError(vaultRetail, "IneligibleDepositor");
  });

  it("deposit: RETAIL user reverts on ACCREDITED vault", async () => {
    await expect(
      vaultAccredited.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address)
    ).to.be.revertedWithCustomError(vaultAccredited, "IneligibleDepositor");
  });

  it("deposit: reverts immediately after attestation is revoked", async () => {
    // First deposit succeeds
    await vaultRetail.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address);
    // Revoke
    await registry.connect(oracle).revokeAttestation(retailUser.address, SANCTIONS_HIT);
    // Second deposit reverts
    await expect(
      vaultRetail.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address)
    ).to.be.revertedWithCustomError(vaultRetail, "IneligibleDepositor");
  });

  it("deposit: ineligible user always gets IneligibleDepositor revert", async () => {
    // Events before revert are discarded by EVM — we verify the revert itself
    await expect(
      vaultRetail.connect(unverifiedUser).deposit(DEPOSIT_AMOUNT, unverifiedUser.address)
    ).to.be.revertedWithCustomError(vaultRetail, "IneligibleDepositor");
  });

  // ---------------------------------------------------------------------------
  // Withdrawal tests — always unrestricted
  // ---------------------------------------------------------------------------

  it("withdraw: always succeeds regardless of attestation status", async () => {
    // Deposit
    await vaultRetail.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address);
    const shares = await vaultRetail.balanceOf(retailUser.address);

    // Revoke
    await registry.connect(oracle).revokeAttestation(retailUser.address, SANCTIONS_HIT);

    // Withdraw still works
    await expect(
      vaultRetail.connect(retailUser).redeem(shares, retailUser.address, retailUser.address)
    ).to.not.be.reverted;
  });

  // ---------------------------------------------------------------------------
  // ERC-4626 math
  // ---------------------------------------------------------------------------

  it("shares are minted on deposit and burned on withdraw", async () => {
    await vaultRetail.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address);
    const shares = await vaultRetail.balanceOf(retailUser.address);
    expect(shares).to.be.gt(0n);

    await vaultRetail.connect(retailUser).redeem(shares, retailUser.address, retailUser.address);
    expect(await vaultRetail.balanceOf(retailUser.address)).to.equal(0n);
  });

  // ---------------------------------------------------------------------------
  // Whitelist
  // ---------------------------------------------------------------------------

  it("whitelist: bypasses tier check for whitelisted address", async () => {
    await vaultAccredited.connect(owner).addToWhitelist(retailUser.address);
    await expect(
      vaultAccredited.connect(retailUser).deposit(DEPOSIT_AMOUNT, retailUser.address)
    ).to.not.be.reverted;
  });
});
