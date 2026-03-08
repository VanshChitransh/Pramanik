import { ethers } from "hardhat";

async function main() {
  await ethers.provider.send("evm_increaseTime", [7200]);
  await ethers.provider.send("evm_mine", []);
  console.log("Time advanced 2 hours, block mined");
}

main().catch(console.error);
