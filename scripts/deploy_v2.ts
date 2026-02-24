import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting V2 Deployment (POLO + Vault)...");

  const [deployer] = await ethers.getSigners();
  console.log("👨‍💻 Deploying with account:", deployer.address);

  // 1. DEPLOY MOCK TOKEN (POLO)
  console.log("----------------------------------------------------");
  console.log("1️⃣  Deploying POLO Token...");
  const TokenFactory = await ethers.getContractFactory("ERC20Mock");
  const token = await TokenFactory.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ POLO Token Deployed to:", tokenAddress);

  // 2. DEPLOY VAULT (LOCKER)
  console.log("----------------------------------------------------");
  console.log("2️⃣  Deploying 0xKeep Vault...");
  const LOCK_FEE = ethers.parseEther("0.05");
  const VESTING_FEE = ethers.parseEther("0.02");
  
  const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await LockerFactory.deploy(LOCK_FEE, VESTING_FEE, deployer.address);
  await locker.waitForDeployment();
  const lockerAddress = await locker.getAddress();
  console.log("✅ 0xKeep Vault Deployed to:", lockerAddress);

  console.log("----------------------------------------------------");
  console.log("🎉 SYSTEM READY!");
  console.log("----------------------------------------------------");
  console.log("COPY THESE FOR YOUR FRONTEND:");
  console.log("Token (POLO): ", tokenAddress);
  console.log("Vault (Contract):", lockerAddress);
  console.log("----------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});