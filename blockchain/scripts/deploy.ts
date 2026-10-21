import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying CertificateRegistry to Polygon Amoy...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "POL");

  if (balance === 0n) {
    throw new Error("Deployer has no POL. Get testnet POL from https://faucet.polygon.technology/");
  }

  const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await CertificateRegistryFactory.deploy();
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  console.log("CertificateRegistry deployed to:", contractAddress);
  console.log("Transaction hash:", registry.deploymentTransaction()?.hash);

  // Save deployment info
  const deploymentInfo = {
    network: "polygon-amoy",
    chainId: 80002,
    contractAddress,
    deployer: deployer.address,
    transactionHash: registry.deploymentTransaction()?.hash,
    deployedAt: new Date().toISOString(),
    explorerUrl: `https://amoy.polygonscan.com/address/${contractAddress}`,
  };

  const outputDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, "amoy.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\nDeployment info saved to deployments/amoy.json");
  console.log("Explorer URL:", deploymentInfo.explorerUrl);

  // Copy ABI to learning-service for runtime use
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "CertificateRegistry.sol",
    "CertificateRegistry.json"
  );

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const abiOutputDir = path.join(__dirname, "..", "..", "services", "learning-service", "src", "config");

    fs.writeFileSync(
      path.join(abiOutputDir, "CertificateRegistry.abi.json"),
      JSON.stringify(artifact.abi, null, 2)
    );

    console.log("ABI copied to services/learning-service/src/config/CertificateRegistry.abi.json");
  }

  console.log("\n✅ Deployment complete!");
  console.log("\nNext steps:");
  console.log(`  1. Set BLOCKCHAIN_CONTRACT_ADDRESS=${contractAddress} in .env`);
  console.log("  2. Set BLOCKCHAIN_ENABLED=true in .env");
  console.log(`  3. Verify contract: npx hardhat verify --network amoy ${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
