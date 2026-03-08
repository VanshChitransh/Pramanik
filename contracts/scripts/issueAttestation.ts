import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const REGISTRY_ABI = [
  "function setAttestation(address user, uint8 tier, uint64 expiresAt, bytes32 jurisdiction, bytes32 providerHash, bytes32 oracleRef) external",
  "function isEligible(address user) external view returns (bool)",
];

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../.addresses.json"), "utf8"),
  ).tenderly;

  const [deployer] = await ethers.getSigners();
  const registry = await ethers.getContractAt(REGISTRY_ABI, addresses.EligibilityRegistry, deployer);

  const expiresAt   = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const jurisdiction = ethers.keccak256(ethers.toUtf8Bytes("US"));
  const providerHash = ethers.keccak256(ethers.toUtf8Bytes("mock-kyc-v1"));
  const oracleRef    = ethers.keccak256(ethers.toUtf8Bytes("demo-request-001"));

  const tx = await (registry as any).setAttestation(
    deployer.address,
    1, // RETAIL
    expiresAt,
    jurisdiction,
    providerHash,
    oracleRef,
  );
  await tx.wait();

  const eligible = await (registry as any).isEligible(deployer.address);
  console.log(`Attestation issued for ${deployer.address}`);
  console.log(`isEligible: ${eligible}`);
}

main().catch(console.error);
