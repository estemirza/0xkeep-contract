import { ethers } from "hardhat";
async function main() {
  const Token = await ethers.getContractFactory("ERC20Mock");
  const token = await Token.deploy();
  await token.waitForDeployment();
  console.log("MOCK TOKEN:", await token.getAddress());
}
main();