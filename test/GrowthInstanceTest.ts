import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Growth-phase instance: the same V12 contract deployed with LOCK_FEE = 0 and
// VESTING_FEE = 0. None of the other suites deploy with a zero fee, so this
// file proves the free instance behaves correctly before it goes on mainnet.
//
// Run: npx hardhat test test/GrowthInstanceTest.ts

describe("0xKeep — Growth instance (zero fee)", function () {
  async function setup() {
    const [owner, alice, feeSink] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ERC20Mock");
    const token: any = await Token.deploy();
    await token.transfer(alice.address, ethers.parseEther("1000"));

    const Locker = await ethers.getContractFactory("ZeroXKeepLocker");
    const locker: any = await Locker.deploy(0, 0, feeSink.address);
    await token.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
    return { owner, alice, feeSink, token, locker };
  }

  it("reports zero fees on-chain", async () => {
    const { locker } = await setup();
    expect(await locker.LOCK_FEE()).to.equal(0n);
    expect(await locker.VESTING_FEE()).to.equal(0n);
  });

  it("lock with no ETH attached succeeds, and withdraw works after unlock", async () => {
    const { alice, token, locker } = await setup();
    const unlock = BigInt(await time.latest()) + 3600n;
    await locker.connect(alice).lockToken(await token.getAddress(), ethers.parseEther("100"), unlock);
    expect(await locker.allLocksCount()).to.equal(1n);
    expect((await locker.locks(0)).amount).to.equal(ethers.parseEther("100"));

    await expect(locker.connect(alice).withdrawLock(0)).to.be.reverted; // still locked
    await time.increaseTo(unlock);
    await locker.connect(alice).withdrawLock(0);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
  });

  it("vesting with no ETH attached succeeds and fully claims at the end", async () => {
    const { alice, token, locker } = await setup();
    await locker.connect(alice).createVesting(await token.getAddress(), ethers.parseEther("100"), 0, 86400);
    expect(await locker.allVestingsCount()).to.equal(1n);
    await time.increase(86400);
    await locker.connect(alice).claimVesting(0);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
  });

  it("ETH sent by mistake is refunded in full; fee receiver gets nothing", async () => {
    const { alice, feeSink, token, locker } = await setup();
    const sinkBefore = await ethers.provider.getBalance(feeSink.address);
    const unlock = BigInt(await time.latest()) + 3600n;
    await locker.connect(alice).lockToken(await token.getAddress(), ethers.parseEther("1"), unlock, {
      value: ethers.parseEther("0.03"),
    });
    expect(await ethers.provider.getBalance(await locker.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(feeSink.address)).to.equal(sinkBefore);
  });
});
