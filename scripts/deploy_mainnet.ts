import { ethers, network } from "hardhat";

async function main() {
  // Get the name of the network (base, arbitrum, optimism) to print nice logs
  const networkName = network.name.toUpperCase();
  
  console.log(`🚀 Starting Mainnet Deployment to ${networkName}...`);

  const [deployer] = await ethers.getSigners();
  console.log("👨‍💻 Deploying with account:", deployer.address);

  // Check Balance (Safety Check)
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");

  // --- CONFIGURATION (FINAL CHECK) ---
  // 1. Set Prices
  const LOCK_FEE = ethers.parseEther("0.05");    // 0.05 ETH (Premium)
  const VESTING_FEE = ethers.parseEther("0.02"); // 0.02 ETH (Volume)
  
  // 2. Set Fee Receiver
  // IMPORTANT: By default this is YOU (the deployer). 
  // If you have a Gnosis Safe or hardware wallet address, paste it below stringified.
  // Example: const FEE_RECEIVER = "0xYourMultisigAddress...";
  const FEE_RECEIVER = deployer.address; 

  console.log("----------------------------------------------------");
  console.log("🔒 Lock Fee:", ethers.formatEther(LOCK_FEE), "ETH");
  console.log("📉 Vesting Fee:", ethers.formatEther(VESTING_FEE), "ETH");
  console.log("💸 Revenue Recipient:", FEE_RECEIVER);
  console.log("----------------------------------------------------");

  // --- DEPLOYMENT ---
  console.log("... Deploying ZeroXKeepLocker ...");
  
  const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await LockerFactory.deploy(LOCK_FEE, VESTING_FEE, FEE_RECEIVER);

  console.log("⏳ Waiting for transaction blocks...");
  await locker.waitForDeployment();

  const address = await locker.getAddress();
  
  console.log("----------------------------------------------------");
  console.log(`✅ ${networkName} DEPLOYMENT SUCCESS!`);
  console.log("----------------------------------------------------");
  console.log("📜 Contract Address:", address);
  console.log("----------------------------------------------------");
  console.log("NEXT STEPS:");
  console.log(`1. npx hardhat verify --network ${network.name} ${address} "${LOCK_FEE}" "${VESTING_FEE}" "${FEE_RECEIVER}"`);
  console.log("2. Update src/lib/contract.ts with this address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});