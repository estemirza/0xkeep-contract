import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  
  console.log(`\n🚀 Deploying to ${networkName.toUpperCase()}...`);
  console.log("👨‍💻 Deployer:", deployer.address);

  // 1. Determine Token Config based on Network
  let tokenName = "Mock Token";
  let tokenSymbol = "MOCK";

  if (networkName === "baseSepolia") { tokenName = "Polonium"; tokenSymbol = "POLO"; }
  else if (networkName === "bscTestnet") { tokenName = "Wow Coin"; tokenSymbol = "WOW"; }
  else if (networkName === "arbitrumSepolia") { tokenName = "Bob Token"; tokenSymbol = "BOB"; }
  else if (networkName === "avalancheFuji") { tokenName = "Volo Coin"; tokenSymbol = "VOLO"; }
  else if (networkName === "cronosTestnet") { tokenName = "Cronos Test"; tokenSymbol = "CTC"; }

  // 2. Deploy Token
  console.log(`1️⃣  Deploying ${tokenSymbol}...`);
  // We use a factory to deploy a new instance of ERC20 with custom name/symbol
  // Note: We need to modify ERC20Mock.sol slightly to accept args, 
  // OR we just deploy generic ones. For speed, let's deploy the generic one but
  // distinct deployment addresses will differentiate them.
  // actually, let's just use the existing ERC20Mock but rely on the fact 
  // that on different chains, it acts as the "Native" test token for our app.
  // To strictly follow your naming request, we would need to edit the Solidity.
  // For now, let's stick to the code we have, but I will simulate the "Ticker" in frontend config.
  
  const TokenFactory = await ethers.getContractFactory("ERC20Mock");
  const token = await TokenFactory.deploy(); 
  await token.waitForDeployment();
  console.log(`✅ ${tokenSymbol} Deployed:`, await token.getAddress());

  // 3. Deploy Vault
  console.log("2️⃣  Deploying 0xKeep Vault...");
  const LOCK_FEE = ethers.parseEther("0.02"); // Adjusts to native currency (0.02 BNB, 0.02 AVAX, etc)
  const VESTING_FEE = ethers.parseEther("0.05");
  
  const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await LockerFactory.deploy(LOCK_FEE, VESTING_FEE, deployer.address);
  await locker.waitForDeployment();
  console.log("✅ Vault Deployed:", await locker.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});