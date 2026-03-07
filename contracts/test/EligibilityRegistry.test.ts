import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { EligibilityRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("EligibilityRegistry", () => {
  let registry: EligibilityRegistry;
  let oracle: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  const TIER_BLOCKED       = 0;
  const TIER_RETAIL        = 1;
  const TIER_ACCREDITED    = 2;
  const TIER_INSTITUTIONAL = 3;

  const SANCTIONS_HIT = ethers.keccak256(ethers.toUtf8Bytes("SANCTIONS_HIT"));
  const jurisUS       = ethers.keccak256(ethers.toUtf8Bytes("US"));
  const providerHash  = ethers.keccak256(ethers.toUtf8Bytes("mock-kyc-v1resp_001"));
  const oracleRef     = ethers.keccak256(ethers.toUtf8Bytes("1"));

  const ONE_YEAR = 365 * 24 * 60 * 60;

  beforeEach(async () => {
    [owner, oracle, user, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("EligibilityRegistry", owner);
    registry = await Factory.deploy(oracle.address);
    await registry.waitForDeployment();
  });

  // ---------------------------------------------------------------------------
  // setAttestation
  // ---------------------------------------------------------------------------

  it("setAttestation: stores correct values", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    const a = await registry.getAttestation(user.address);
    expect(a.tier).to.equal(TIER_RETAIL);
    expect(a.jurisdiction).to.equal(jurisUS);
    expect(a.revoked).to.be.false;
  });

  it("setAttestation: reverts for non-oracle caller", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await expect(
      registry.connect(attacker).setAttestation(
        user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
      )
    ).to.be.revertedWithCustomError(registry, "NotOracle");
  });

  it("setAttestation: emits AttestationIssued on first issuance", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await expect(
      registry.connect(oracle).setAttestation(
        user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
      )
    ).to.emit(registry, "AttestationIssued").withArgs(user.address, TIER_RETAIL, expiresAt, oracleRef);
  });

  it("setAttestation: emits AttestationRenewed on re-issuance", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    const newExpiry = expiresAt + BigInt(ONE_YEAR);
    await expect(
      registry.connect(oracle).setAttestation(
        user.address, TIER_ACCREDITED, newExpiry, jurisUS, providerHash, oracleRef
      )
    ).to.emit(registry, "AttestationRenewed").withArgs(user.address, TIER_ACCREDITED, newExpiry);
  });

  it("setAttestation: preserves history after renewal", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    await registry.connect(oracle).setAttestation(
      user.address, TIER_ACCREDITED, expiresAt, jurisUS, providerHash, oracleRef
    );
    const history = await registry.getAttestationHistory(user.address);
    expect(history.length).to.equal(1);
    expect(history[0].tier).to.equal(TIER_RETAIL);
  });

  // ---------------------------------------------------------------------------
  // isEligible
  // ---------------------------------------------------------------------------

  it("isEligible: returns true for valid attestation", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    expect(await registry.isEligible(user.address)).to.be.true;
  });

  it("isEligible: returns false for BLOCKED tier", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_BLOCKED, expiresAt, jurisUS, providerHash, oracleRef
    );
    expect(await registry.isEligible(user.address)).to.be.false;
  });

  it("isEligible: returns false for revoked attestation", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    await registry.connect(oracle).revokeAttestation(user.address, SANCTIONS_HIT);
    expect(await registry.isEligible(user.address)).to.be.false;
  });

  it("isEligible: returns false for expired attestation", async () => {
    const expiresAt = BigInt(await time.latest() + 100);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    await time.increase(200);
    expect(await registry.isEligible(user.address)).to.be.false;
  });

  it("isEligible: returns true for non-expiring attestation (expiresAt=0)", async () => {
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, 0n, jurisUS, providerHash, oracleRef
    );
    await time.increase(ONE_YEAR * 2);
    expect(await registry.isEligible(user.address)).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // isEligibleForTier
  // ---------------------------------------------------------------------------

  it("isEligibleForTier: INSTITUTIONAL tier satisfies RETAIL check", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_INSTITUTIONAL, expiresAt, jurisUS, providerHash, oracleRef
    );
    expect(await registry.isEligibleForTier(user.address, TIER_RETAIL)).to.be.true;
  });

  it("isEligibleForTier: RETAIL tier fails ACCREDITED check", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    expect(await registry.isEligibleForTier(user.address, TIER_ACCREDITED)).to.be.false;
  });

  // ---------------------------------------------------------------------------
  // revokeAttestation / batchRevoke
  // ---------------------------------------------------------------------------

  it("revokeAttestation: has immediate effect", async () => {
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    await registry.connect(oracle).setAttestation(
      user.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
    );
    expect(await registry.isEligible(user.address)).to.be.true;
    await registry.connect(oracle).revokeAttestation(user.address, SANCTIONS_HIT);
    expect(await registry.isEligible(user.address)).to.be.false;
  });

  it("batchRevoke: revokes all provided addresses", async () => {
    const [, , user2, user3] = await ethers.getSigners();
    const expiresAt = BigInt(await time.latest() + ONE_YEAR);
    for (const u of [user, user2, user3]) {
      await registry.connect(oracle).setAttestation(
        u.address, TIER_RETAIL, expiresAt, jurisUS, providerHash, oracleRef
      );
    }
    await registry.connect(oracle).batchRevoke(
      [user.address, user2.address, user3.address], SANCTIONS_HIT
    );
    for (const u of [user, user2, user3]) {
      expect(await registry.isEligible(u.address)).to.be.false;
    }
  });

  it("revokeAttestation: reverts for unauthorized caller", async () => {
    await expect(
      registry.connect(attacker).revokeAttestation(user.address, SANCTIONS_HIT)
    ).to.be.revertedWithCustomError(registry, "NotOracleOrAdmin");
  });

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  it("setOracleAddress: updates oracle and only callable by owner", async () => {
    await registry.connect(owner).setOracleAddress(attacker.address);
    expect(await registry.oracle()).to.equal(attacker.address);
  });

  it("setOracleAddress: reverts for non-owner", async () => {
    await expect(
      registry.connect(attacker).setOracleAddress(attacker.address)
    ).to.be.revertedWithCustomError(registry, "NotOwner");
  });
});
