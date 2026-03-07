import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { KYCGate } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("KYCGate", () => {
  let gate: KYCGate;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const ONE_HOUR = 3600;

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("KYCGate", owner);
    gate = await Factory.deploy();
    await gate.waitForDeployment();
  });

  it("requestKYC: emits KYCRequested with correct params", async () => {
    const tx = gate.connect(user).requestKYC("US");
    await expect(tx)
      .to.emit(gate, "KYCRequested")
      .withArgs(
        user.address,
        ethers.keccak256(ethers.toUtf8Bytes("US")),
        1n,
        (v: bigint) => v > 0n
      );
  });

  it("requestKYC: creates correct KYCRequest struct", async () => {
    await gate.connect(user).requestKYC("US");
    const req = await gate.requests(1n);
    expect(req.requester).to.equal(user.address);
    expect(req.jurisdiction).to.equal(ethers.keccak256(ethers.toUtf8Bytes("US")));
    expect(req.status).to.equal(0); // PENDING
  });

  it("requestKYC: reverts if a pending request already exists", async () => {
    await gate.connect(user).requestKYC("US");
    await expect(gate.connect(user).requestKYC("US"))
      .to.be.revertedWithCustomError(gate, "PendingRequestExists");
  });

  it("requestKYC: reverts when contract is paused", async () => {
    await gate.connect(owner).pause();
    await expect(gate.connect(user).requestKYC("US"))
      .to.be.revertedWithCustomError(gate, "ContractPaused");
  });

  it("hasPendingRequest: returns true after request, false after clear", async () => {
    await gate.connect(user).requestKYC("US");
    expect(await gate.hasPendingRequest(user.address)).to.be.true;

    await time.increase(ONE_HOUR + 1);
    await gate.clearExpiredRequest(user.address);
    expect(await gate.hasPendingRequest(user.address)).to.be.false;
  });

  it("clearExpiredRequest: allows re-request after 1 hour", async () => {
    await gate.connect(user).requestKYC("US");
    await time.increase(ONE_HOUR + 1);
    await gate.clearExpiredRequest(user.address);
    await expect(gate.connect(user).requestKYC("EU")).to.emit(gate, "KYCRequested");
  });

  it("clearExpiredRequest: reverts if request has not expired", async () => {
    await gate.connect(user).requestKYC("US");
    await expect(gate.clearExpiredRequest(user.address))
      .to.be.revertedWithCustomError(gate, "RequestNotExpired");
  });

  it("clearExpiredRequest: reverts if no pending request", async () => {
    await expect(gate.clearExpiredRequest(user.address))
      .to.be.revertedWithCustomError(gate, "NoPendingRequest");
  });

  it("getRequestStatus: returns PENDING for active request", async () => {
    await gate.connect(user).requestKYC("US");
    expect(await gate.getRequestStatus(1n)).to.equal(0); // PENDING
  });

  it("pause/unpause: only owner can call", async () => {
    await expect(gate.connect(user).pause())
      .to.be.revertedWithCustomError(gate, "NotOwner");
    await gate.connect(owner).pause();
    await gate.connect(owner).unpause();
    await expect(gate.connect(user).requestKYC("US")).to.emit(gate, "KYCRequested");
  });

  it("nextRequestId: increments correctly across multiple requests", async () => {
    await gate.connect(user).requestKYC("US");
    await gate.connect(user2).requestKYC("EU");
    expect(await gate.nextRequestId()).to.equal(3n);
  });
});
