import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting Deployment to Base Sepolia...");

  // 1. Configuration
  // WE ARE SETTING THE REAL FEES HERE
  const LOCK_FEE = ethers.parseEther("0.02");    // 0.02 ETH
  const VESTING_FEE = ethers.parseEther("0.05"); // 0.05 ETH
  
  const [deployer] = await ethers.getSigners();
  console.log("👨‍💻 Deploying with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");

  // 2. Deploy
  const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
  
  // Arguments: LockFee, VestingFee, FeeReceiver (Your Wallet)
  const locker = await LockerFactory.deploy(LOCK_FEE, VESTING_FEE, deployer.address);

  console.log("⏳ Waiting for transaction blocks...");
  await locker.waitForDeployment();

  const address = await locker.getAddress();
  
  console.log("----------------------------------------------------");
  console.log("✅ DEPLOYMENT SUCCESS!");
  console.log("----------------------------------------------------");
  console.log("📜 Contract Address:", address);
  console.log("----------------------------------------------------");
  console.log("SAVE THIS ADDRESS. You need it for the Website.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});