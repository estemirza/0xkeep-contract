import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const networkName = network.name.toUpperCase();

  console.log(`\n🚀 Starting deployment to ${networkName}...`);

  // ─────────────────────────────────────────────
  // SAFETY CHECKS
  // ─────────────────────────────────────────────
  if (!process.env.PRIVATE_KEY) {
    throw new Error("❌ PRIVATE_KEY not set in .env. Aborting.");
  }

  const [deployer] = await ethers.getSigners();
  console.log("👨‍💻 Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("❌ Balance too low. Add ETH to your deployer wallet first.");
  }

  // ─────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────
  const LOCK_FEE    = ethers.parseEther("0.03"); // 0.03 ETH per lock
  const VESTING_FEE = ethers.parseEther("0.02"); // 0.02 ETH per vesting
  const FEE_RECEIVER = deployer.address;
  // ⚠️  Before going live with real users, update FEE_RECEIVER to a
  //     hardware wallet address. Example:
  //     const FEE_RECEIVER = "0xYourHardwareWalletAddress";

  console.log("\n──────────────────────────────────────────");
  console.log("🔒 Lock Fee:        ", ethers.formatEther(LOCK_FEE), "ETH");
  console.log("📉 Vesting Fee:     ", ethers.formatEther(VESTING_FEE), "ETH");
  console.log("💸 Fee Receiver:    ", FEE_RECEIVER);
  console.log("🌐 Network:         ", networkName);
  console.log("──────────────────────────────────────────\n");

  // ─────────────────────────────────────────────
  // DEPLOY
  // ─────────────────────────────────────────────
  console.log("⏳ Deploying ZeroXKeepLocker V12...");

  const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await LockerFactory.deploy(LOCK_FEE, VESTING_FEE, FEE_RECEIVER);

  console.log("⏳ Waiting for confirmation...");
  await locker.waitForDeployment();

  const contractAddress = await locker.getAddress();

  console.log("\n──────────────────────────────────────────");
  console.log(`✅ ${networkName} DEPLOYMENT SUCCESS`);
  console.log("──────────────────────────────────────────");
  console.log("📜 Contract Address:", contractAddress);

  // ─────────────────────────────────────────────
  // SAVE ADDRESS TO FILE (never lose it again)
  // ─────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const deploymentData = {
    network: networkName,
    chainId: network.config.chainId,
    contractAddress,
    feeReceiver: FEE_RECEIVER,
    lockFee: ethers.formatEther(LOCK_FEE),
    vestingFee: ethers.formatEther(VESTING_FEE),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const filePath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Address saved to: deployments/${network.name}.json`);

  // ─────────────────────────────────────────────
  // VERIFY (wait a few blocks first so explorer indexes it)
  // ─────────────────────────────────────────────
  console.log("\n⏳ Waiting 20 seconds before verification...");
  await new Promise((resolve) => setTimeout(resolve, 20000));

  console.log("🔍 Verifying on block explorer...");
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [LOCK_FEE, VESTING_FEE, FEE_RECEIVER],
    });
    console.log("✅ Contract verified successfully.");
  } catch (err: any) {
    if (err.message.includes("Already Verified")) {
      console.log("✅ Already verified.");
    } else {
      console.log("⚠️  Verification failed. Run manually:");
      console.log(
        `npx hardhat verify --network ${network.name} ${contractAddress} ${LOCK_FEE} ${VESTING_FEE} ${FEE_RECEIVER}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // NEXT STEPS
  // ─────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────");
  console.log("NEXT STEPS:");
  console.log(`1. Copy ${contractAddress} into frontend/lib/contract.ts`);
  console.log(`   under chainId: ${network.config.chainId}`);
  console.log("2. Deploy to the next chain when ready.");
  console.log("3. Update frontend contract addresses for all chains.");
  console.log("──────────────────────────────────────────\n");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error.message);
  process.exitCode = 1;
});