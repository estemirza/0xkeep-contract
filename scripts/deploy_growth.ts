import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────
// GROWTH-PHASE INSTANCE (low / zero fee)
//
// Same V12 contract, different constructor fees. The 0.03 / 0.02 instances
// stay deployed as the future "established" version.
//
// Usage (on Mirza's Mac, after moving the key off plaintext .env):
//   GROWTH_LOCK_FEE=0 GROWTH_VESTING_FEE=0 CONFIRM_DEPLOY=yes \
//     npx hardhat run scripts/deploy_growth.ts --network base
//
// Fees are in ETH. Default is 0 (free). Fees are IMMUTABLE once deployed.
// Saves to deployments/<network>-growth.json and refuses to overwrite it,
// so the original deployments/<network>.json record is never touched.
// ─────────────────────────────────────────────

async function main() {
  const net = network.name;
  const outFile = path.join(__dirname, "../deployments", `${net}-growth.json`);

  if (fs.existsSync(outFile)) {
    throw new Error(`❌ ${outFile} already exists. A growth instance is already deployed on ${net}. Aborting.`);
  }

  const LOCK_FEE    = ethers.parseEther(process.env.GROWTH_LOCK_FEE    ?? "0");
  const VESTING_FEE = ethers.parseEther(process.env.GROWTH_VESTING_FEE ?? "0");

  const [deployer] = await ethers.getSigners();
  // Fee receiver defaults to the deployer; override with FEE_RECEIVER=0x...
  const FEE_RECEIVER = process.env.FEE_RECEIVER ?? deployer.address;
  if (!ethers.isAddress(FEE_RECEIVER)) throw new Error("❌ FEE_RECEIVER is not a valid address.");

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("\n──────────── GROWTH INSTANCE — DRY SUMMARY ────────────");
  console.log("Network:      ", net, `(chainId ${network.config.chainId})`);
  console.log("Deployer:     ", deployer.address);
  console.log("Balance:      ", ethers.formatEther(balance), "ETH");
  console.log("Lock fee:     ", ethers.formatEther(LOCK_FEE), "ETH  (immutable)");
  console.log("Vesting fee:  ", ethers.formatEther(VESTING_FEE), "ETH  (immutable)");
  console.log("Fee receiver: ", FEE_RECEIVER, " (immutable)");
  console.log("───────────────────────────────────────────────────────\n");

  if (process.env.CONFIRM_DEPLOY !== "yes") {
    console.log("Nothing deployed. Re-run with CONFIRM_DEPLOY=yes if the summary above is right.");
    return;
  }
  if (balance < ethers.parseEther("0.002")) {
    throw new Error("❌ Balance too low for deployment gas.");
  }

  const Factory = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await Factory.deploy(LOCK_FEE, VESTING_FEE, FEE_RECEIVER);
  console.log("⏳ Waiting for confirmation...");
  await locker.waitForDeployment();
  const contractAddress = await locker.getAddress();
  const deployTx = locker.deploymentTransaction();

  // Save the address FIRST, so a later RPC hiccup can never lose it.
  const record: Record<string, unknown> = {
    network: net.toUpperCase(),
    instance: "growth",
    chainId: network.config.chainId,
    contractAddress,
    feeReceiver: FEE_RECEIVER,
    lockFee: ethers.formatEther(LOCK_FEE),
    vestingFee: ethers.formatEther(VESTING_FEE),
    deployTx: deployTx?.hash,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log(`✅ Deployed at ${contractAddress}`);
  console.log(`💾 Saved to deployments/${net}-growth.json`);

  // Read fees back from chain. Load-balanced RPCs can lag a block or two
  // behind the one that confirmed the deploy (returns "0x"), so retry.
  for (let i = 1; i <= 6; i++) {
    try {
      const lf = await locker.LOCK_FEE();
      const vf = await locker.VESTING_FEE();
      console.log(`🔎 On-chain fees: lock ${ethers.formatEther(lf)} ETH, vesting ${ethers.formatEther(vf)} ETH`);
      break;
    } catch {
      if (i === 6) console.log("⚠️  Could not read fees back yet. Check them on Basescan (Read Contract).");
      else await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log("⏳ Waiting 20s before verification...");
  await new Promise((r) => setTimeout(r, 20000));
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [LOCK_FEE, VESTING_FEE, FEE_RECEIVER],
    });
    console.log("✅ Verified.");
  } catch (err: any) {
    console.log("⚠️  Verification did not complete:", err.message);
    console.log(`   Manual: npx hardhat verify --network ${net} ${contractAddress} ${LOCK_FEE} ${VESTING_FEE} ${FEE_RECEIVER}`);
  }

  console.log(`\nNEXT: put ${contractAddress} in frontend/lib/contract.ts under chainId ${network.config.chainId}.`);
}

main().catch((e) => {
  console.error("\n❌ Growth deploy failed:", e.message);
  process.exitCode = 1;
});
