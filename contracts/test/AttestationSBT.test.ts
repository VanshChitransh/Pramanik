import { expect } from "chai";
import { ethers } from "hardhat";
import { AttestationSBT, EligibilityRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AttestationSBT", () => {
  let registry: EligibilityRegistry;
  let sbt: AttestationSBT;
  let oracle: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  const TIER_RETAIL        = 1;
  const TIER_ACCREDITED    = 2;
  const TIER_INSTITUTIONAL = 3;

  beforeEach(async () => {
    [owner, oracle, user, user2, attacker] = await ethers.getSigners();

    const RegFactory = await ethers.getContractFactory("EligibilityRegistry", owner);
    registry = await RegFactory.deploy(oracle.address);
    await registry.waitForDeployment();

    const SBTFactory = await ethers.getContractFactory("AttestationSBT", owner);
    sbt = await SBTFactory.deploy(await registry.getAddress(), oracle.address);
    await sbt.waitForDeployment();
  });

  // ---------------------------------------------------------------------------
  // mintSBT
  // ---------------------------------------------------------------------------

  it("mintSBT: mints a token for a new user", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    expect(await sbt.hasSBT(user.address)).to.be.true;
    expect(await sbt.balanceOf(user.address)).to.equal(1n);
  });

  it("mintSBT: emits SBTMinted event", async () => {
    await expect(sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL))
      .to.emit(sbt, "SBTMinted")
      .withArgs(user.address, 1n, TIER_RETAIL);
  });

  it("mintSBT: records the correct tier", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_ACCREDITED);
    expect(await sbt.tierOf(user.address)).to.equal(TIER_ACCREDITED);
  });

  it("mintSBT: burns old token and re-mints on tier upgrade", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const firstTokenId = await sbt.tokenOfAddress(user.address);

    await sbt.connect(oracle).mintSBT(user.address, TIER_ACCREDITED);
    const secondTokenId = await sbt.tokenOfAddress(user.address);

    expect(secondTokenId).to.not.equal(firstTokenId);
    expect(await sbt.tierOf(user.address)).to.equal(TIER_ACCREDITED);
    expect(await sbt.balanceOf(user.address)).to.equal(1n);
  });

  it("mintSBT: emits SBTBurned then SBTMinted on renewal", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const tx = sbt.connect(oracle).mintSBT(user.address, TIER_INSTITUTIONAL);
    await expect(tx).to.emit(sbt, "SBTBurned");
    await expect(tx).to.emit(sbt, "SBTMinted");
  });

  it("mintSBT: reverts for non-oracle caller", async () => {
    await expect(sbt.connect(attacker).mintSBT(user.address, TIER_RETAIL))
      .to.be.revertedWithCustomError(sbt, "NotOracle");
  });

  it("mintSBT: increments token IDs correctly", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    await sbt.connect(oracle).mintSBT(user2.address, TIER_RETAIL);
    const id1 = await sbt.tokenOfAddress(user.address);
    const id2 = await sbt.tokenOfAddress(user2.address);
    expect(id2).to.equal(id1 + 1n);
  });

  // ---------------------------------------------------------------------------
  // revokeSBT
  // ---------------------------------------------------------------------------

  it("revokeSBT: burns the token", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    await sbt.connect(oracle).revokeSBT(user.address);
    expect(await sbt.hasSBT(user.address)).to.be.false;
    expect(await sbt.balanceOf(user.address)).to.equal(0n);
  });

  it("revokeSBT: emits SBTBurned event", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const tokenId = await sbt.tokenOfAddress(user.address);
    await expect(sbt.connect(oracle).revokeSBT(user.address))
      .to.emit(sbt, "SBTBurned")
      .withArgs(user.address, tokenId);
  });

  it("revokeSBT: clears tokenOfAddress mapping", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    await sbt.connect(oracle).revokeSBT(user.address);
    expect(await sbt.tokenOfAddress(user.address)).to.equal(0n);
  });

  it("revokeSBT: reverts if user has no token", async () => {
    await expect(sbt.connect(oracle).revokeSBT(user.address))
      .to.be.revertedWithCustomError(sbt, "NoTokenToRevoke");
  });

  it("revokeSBT: reverts for non-oracle caller", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    await expect(sbt.connect(attacker).revokeSBT(user.address))
      .to.be.revertedWithCustomError(sbt, "NotOracle");
  });

  // ---------------------------------------------------------------------------
  // Soulbound: transfers and approvals forbidden
  // ---------------------------------------------------------------------------

  it("transfer: reverts with SoulboundTransferForbidden", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const tokenId = await sbt.tokenOfAddress(user.address);
    await expect(
      sbt.connect(user).transferFrom(user.address, user2.address, tokenId)
    ).to.be.revertedWithCustomError(sbt, "SoulboundTransferForbidden");
  });

  it("approve: reverts with SoulboundApproveForbidden", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const tokenId = await sbt.tokenOfAddress(user.address);
    await expect(
      sbt.connect(user).approve(user2.address, tokenId)
    ).to.be.revertedWithCustomError(sbt, "SoulboundApproveForbidden");
  });

  it("setApprovalForAll: reverts with SoulboundApproveForbidden", async () => {
    await expect(
      sbt.connect(user).setApprovalForAll(user2.address, true)
    ).to.be.revertedWithCustomError(sbt, "SoulboundApproveForbidden");
  });

  // ---------------------------------------------------------------------------
  // tokenURI
  // ---------------------------------------------------------------------------

  it("tokenURI: returns a non-empty data URI", async () => {
    await sbt.connect(oracle).mintSBT(user.address, TIER_RETAIL);
    const tokenId = await sbt.tokenOfAddress(user.address);
    const uri = await sbt.tokenURI(tokenId);
    expect(uri).to.include("data:application/json;utf8,");
    expect(uri).to.include("Pramanik KYC Attestation");
    expect(uri).to.include("Retail");
  });

  it("tokenURI: includes correct tier name for each tier", async () => {
    const tiers = [
      { tier: TIER_RETAIL,        name: "Retail" },
      { tier: TIER_ACCREDITED,    name: "Accredited" },
      { tier: TIER_INSTITUTIONAL, name: "Institutional" },
    ];
    for (const { tier, name } of tiers) {
      await sbt.connect(oracle).mintSBT(user.address, tier);
      const tokenId = await sbt.tokenOfAddress(user.address);
      const uri = await sbt.tokenURI(tokenId);
      expect(uri).to.include(name);
      // Reset for next iteration
      await sbt.connect(oracle).revokeSBT(user.address);
    }
  });

  it("tokenURI: reverts for non-existent token", async () => {
    await expect(sbt.tokenURI(999n)).to.be.reverted;
  });

  // ---------------------------------------------------------------------------
  // Admin: setOracleAddress
  // ---------------------------------------------------------------------------

  it("setOracleAddress: updates oracle, emits OracleUpdated", async () => {
    await expect(sbt.connect(owner).setOracleAddress(user.address))
      .to.emit(sbt, "OracleUpdated")
      .withArgs(user.address);
    expect(await sbt.oracle()).to.equal(user.address);
  });

  it("setOracleAddress: reverts for non-owner", async () => {
    await expect(sbt.connect(attacker).setOracleAddress(user.address))
      .to.be.revertedWithCustomError(sbt, "NotOwner");
  });

  it("setOracleAddress: reverts for zero address", async () => {
    await expect(sbt.connect(owner).setOracleAddress(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(sbt, "ZeroAddress");
  });

  // ---------------------------------------------------------------------------
  // View helpers
  // ---------------------------------------------------------------------------

  it("hasSBT: returns false for address with no token", async () => {
    expect(await sbt.hasSBT(user.address)).to.be.false;
  });

  it("tierOf: returns NONE (0) for address with no token", async () => {
    expect(await sbt.tierOf(user.address)).to.equal(0);
  });
});