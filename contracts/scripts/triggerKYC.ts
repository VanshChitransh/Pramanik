// Calls requestKYC on the deployed KYCGate contract to emit KYCRequested event.
// Run: npx hardhat run scripts/triggerKYC.ts --network tenderly
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../.addresses.json"), "utf8")
  );
  const kycGateAddress = addresses.tenderly.KYCGate;

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const KYCGate = await ethers.getContractAt(
    [
      "function requestKYC(string jurisdiction) external",
      "event KYCRequested(address indexed user, bytes32 jurisdiction, uint256 indexed requestId, uint64 timestamp)"
    ],
    kycGateAddress,
    signer
  );

  const tx = await KYCGate.requestKYC("US");
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("\nUse this tx hash for cre workflow simulate:");
  console.log(`  cre workflow simulate kyc-workflow -T staging-settings --evm-tx-hash ${tx.hash}`);
}

main().catch(console.error);
