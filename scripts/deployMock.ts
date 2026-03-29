import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const networkName = network.name.toUpperCase();
  console.log(`\n🚀 Deploying test token on ${networkName}...`);

  const [deployer] = await ethers.getSigners();
  console.log("👨‍💻 Deploying with account:", deployer.address);

  const Token = await ethers.getContractFactory("ERC20Mock");
  const token = await Token.deploy();
  await token.waitForDeployment();
  // Wait 2 extra seconds for the node to index the deployment
  await new Promise(resolve => setTimeout(resolve, 2000));

  const tokenAddress = await token.getAddress();
  const balance = await token.balanceOf(deployer.address);

  console.log("\n──────────────────────────────────────────");
  console.log(`✅ Test token deployed on ${networkName}`);
  console.log("📜 Token Address:", tokenAddress);
  console.log("💰 Your balance:", ethers.formatEther(balance), "MOCK");
  console.log("──────────────────────────────────────────\n");

  // Save to file
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const filePath = path.join(deploymentsDir, `${network.name}-mocktoken.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    network: networkName,
    tokenAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`💾 Address saved to: deployments/${network.name}-mocktoken.json`);
}

main().catch((error) => {
  console.error("\n❌ Failed:", error.message);
  process.exitCode = 1;
});