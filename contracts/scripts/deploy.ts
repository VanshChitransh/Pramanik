import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy MockERC20 (test USDC, 6 decimals)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  await mockUSDC.waitForDeployment();
  console.log("MockERC20 deployed to:", await mockUSDC.getAddress());

  // 2. Deploy EligibilityRegistry (deployer as placeholder oracle)
  const EligibilityRegistry = await ethers.getContractFactory("EligibilityRegistry");
  const registry = await EligibilityRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("EligibilityRegistry deployed to:", await registry.getAddress());

  // 3. Deploy KYCGate
  const KYCGate = await ethers.getContractFactory("KYCGate");
  const kycGate = await KYCGate.deploy();
  await kycGate.waitForDeployment();
  console.log("KYCGate deployed to:", await kycGate.getAddress());

  // 4. Deploy three PermissionedVault instances
  const PermissionedVault = await ethers.getContractFactory("PermissionedVault");
  const registryAddress = await registry.getAddress();
  const usdcAddress = await mockUSDC.getAddress();

  const TIER_RETAIL       = 1; // Tier.RETAIL
  const TIER_ACCREDITED   = 2; // Tier.ACCREDITED
  const TIER_INSTITUTIONAL = 3; // Tier.INSTITUTIONAL

  const vaultRetail = await PermissionedVault.deploy(
    usdcAddress, registryAddress, TIER_RETAIL,
    "Pramanik Retail Pool", "prRETAIL"
  );
  await vaultRetail.waitForDeployment();
  console.log("VaultRetail deployed to:", await vaultRetail.getAddress());

  const vaultAccredited = await PermissionedVault.deploy(
    usdcAddress, registryAddress, TIER_ACCREDITED,
    "Pramanik Accredited Pool", "prACCRED"
  );
  await vaultAccredited.waitForDeployment();
  console.log("VaultAccredited deployed to:", await vaultAccredited.getAddress());

  const vaultInstitutional = await PermissionedVault.deploy(
    usdcAddress, registryAddress, TIER_INSTITUTIONAL,
    "Pramanik Institutional Pool", "prINST"
  );
  await vaultInstitutional.waitForDeployment();
  console.log("VaultInstitutional deployed to:", await vaultInstitutional.getAddress());

  // 5. Save all addresses to .addresses.json
  const addresses = {
    tenderly: {
      MockERC20:            await mockUSDC.getAddress(),
      EligibilityRegistry:  await registry.getAddress(),
      KYCGate:              await kycGate.getAddress(),
      VaultRetail:          await vaultRetail.getAddress(),
      VaultAccredited:      await vaultAccredited.getAddress(),
      VaultInstitutional:   await vaultInstitutional.getAddress(),
    },
  };

  const addressesPath = path.join(__dirname, "../../.addresses.json");
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to .addresses.json");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
