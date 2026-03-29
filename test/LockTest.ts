import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ZeroXKeepLocker, ERC20Mock } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const ONE_DAY    = 86400;
const ONE_YEAR   = ONE_DAY * 365;
const LOCK_FEE   = ethers.parseEther("0.03");
const VEST_FEE   = ethers.parseEther("0.02");
const AMOUNT     = ethers.parseEther("1000");

async function deploy() {
  const [owner, user1, user2, feeRecv] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ERC20Mock");
  const token = await Token.deploy() as ERC20Mock;

  const Locker = await ethers.getContractFactory("ZeroXKeepLocker");
  const locker = await Locker.deploy(LOCK_FEE, VEST_FEE, feeRecv.address) as ZeroXKeepLocker;

  // Give user1 tokens and approve the locker
  await token.transfer(user1.address, ethers.parseEther("100000"));
  await token.connect(user1).approve(await locker.getAddress(), ethers.MaxUint256);

  return { locker, token, owner, user1, user2, feeRecv };
}

// ─────────────────────────────────────────────
// 1. DEPLOYMENT
// ─────────────────────────────────────────────

describe("1. Deployment", function () {
  it("Sets correct fee values and fee receiver", async function () {
    const { locker, feeRecv } = await deploy();
    expect(await locker.LOCK_FEE()).to.equal(LOCK_FEE);
    expect(await locker.VESTING_FEE()).to.equal(VEST_FEE);
    expect(await locker.feeReceiver()).to.equal(feeRecv.address);
  });

  it("Stores correct chain ID", async function () {
    const { locker } = await deploy();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    expect(await locker.CHAIN_ID()).to.equal(chainId);
  });

  it("Starts with zero locks and vestings", async function () {
    const { locker } = await deploy();
    expect(await locker.allLocksCount()).to.equal(0);
    expect(await locker.allVestingsCount()).to.equal(0);
  });

  it("Rejects zero address as fee receiver", async function () {
    const Locker = await ethers.getContractFactory("ZeroXKeepLocker");
    await expect(
      Locker.deploy(LOCK_FEE, VEST_FEE, ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid fee receiver");
  });
});

// ─────────────────────────────────────────────
// 2. STANDARD LOCK — HAPPY PATH
// ─────────────────────────────────────────────

describe("2. Standard Lock — happy path", function () {
  it("Locks tokens and stores correct data", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;

    await locker.connect(user1).lockToken(
      await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE }
    );

    const lock = await locker.locks(0);
    expect(lock.owner).to.equal(user1.address);
    expect(lock.amount).to.equal(AMOUNT);
    expect(lock.unlockTime).to.equal(unlockTime);
    expect(lock.withdrawn).to.equal(false);
  });

  it("Increments allLocksCount", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    expect(await locker.allLocksCount()).to.equal(2);
  });

  it("Adds lock to user's list", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    const ids = await locker.getUserLocks(user1.address);
    expect(ids.length).to.equal(1);
    expect(ids[0]).to.equal(0);
  });

  it("Transfers tokens into contract", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    const contractAddr = await locker.getAddress();
    const before = await token.balanceOf(contractAddr);
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    expect(await token.balanceOf(contractAddr)).to.equal(before + AMOUNT);
  });

  it("Forwards fee to feeReceiver", async function () {
    const { locker, token, user1, feeRecv } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    const before = await ethers.provider.getBalance(feeRecv.address);
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    expect(await ethers.provider.getBalance(feeRecv.address)).to.equal(before + LOCK_FEE);
  });

  it("Refunds excess ETH sent by user", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    const overpay = ethers.parseEther("0.05"); // send 0.05, fee is 0.03
    const before = await ethers.provider.getBalance(user1.address);
    const tx = await locker.connect(user1).lockToken(
      await token.getAddress(), AMOUNT, unlockTime, { value: overpay }
    );
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(user1.address);
    // User should only have lost LOCK_FEE + gas, not the full overpay
    expect(before - after - gasCost).to.equal(LOCK_FEE);
  });
});

// ─────────────────────────────────────────────
// 3. STANDARD LOCK — VALIDATIONS
// ─────────────────────────────────────────────

describe("3. Standard Lock — validations", function () {
  it("Rejects zero address token", async function () {
    const { locker, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await expect(
      locker.connect(user1).lockToken(ethers.ZeroAddress, AMOUNT, unlockTime, { value: LOCK_FEE })
    ).to.be.revertedWith("Invalid token");
  });

  it("Rejects zero amount", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await expect(
      locker.connect(user1).lockToken(await token.getAddress(), 0, unlockTime, { value: LOCK_FEE })
    ).to.be.revertedWith("Amount > 0");
  });

  it("Rejects unlock time in the past", async function () {
    const { locker, token, user1 } = await deploy();
    const pastTime = (await time.latest()) - 1;
    await expect(
      locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, pastTime, { value: LOCK_FEE })
    ).to.be.revertedWith("Time in past");
  });

  it("Rejects unlock time beyond uint32 max (date overflow guard)", async function () {
    const { locker, token, user1 } = await deploy();
    // Note: uint32 max (~year 2106) is reached before the 100-year cap from today.
    // The "Date overflow" check correctly fires first. Both guards work as intended.
    const uint32Max = 4294967295n;
    await expect(
      locker.connect(user1).lockToken(
        await token.getAddress(), AMOUNT, uint32Max + 1n, { value: LOCK_FEE }
      )
    ).to.be.revertedWith("Date overflow");
  });

  it("Rejects insufficient fee", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await expect(
      locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: 0 })
    ).to.be.revertedWith("Insufficient fee");
  });
});

// ─────────────────────────────────────────────
// 4. LOCK — EXTEND & TRANSFER
// ─────────────────────────────────────────────

describe("4. Lock — extend and transfer", function () {
  async function createLock() {
    const ctx = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await ctx.locker.connect(ctx.user1).lockToken(
      await ctx.token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE }
    );
    return { ...ctx, unlockTime };
  }

  it("Owner can extend lock", async function () {
    const { locker, user1, unlockTime } = await createLock();
    const newTime = unlockTime + ONE_YEAR;
    await locker.connect(user1).extendLock(0, newTime);
    const lock = await locker.locks(0);
    expect(lock.unlockTime).to.equal(newTime);
  });

  it("Cannot extend to earlier time", async function () {
    const { locker, user1, unlockTime } = await createLock();
    await expect(
      locker.connect(user1).extendLock(0, unlockTime - 1)
    ).to.be.revertedWith("Must increase time");
  });

  it("Non-owner cannot extend", async function () {
    const { locker, user2, unlockTime } = await createLock();
    await expect(
      locker.connect(user2).extendLock(0, unlockTime + ONE_YEAR)
    ).to.be.revertedWith("Not owner");
  });

  it("Owner can transfer lock ownership", async function () {
    const { locker, user1, user2 } = await createLock();
    await locker.connect(user1).transferLockOwnership(0, user2.address);
    const lock = await locker.locks(0);
    expect(lock.owner).to.equal(user2.address);
  });

  it("Cannot transfer to zero address", async function () {
    const { locker, user1 } = await createLock();
    await expect(
      locker.connect(user1).transferLockOwnership(0, ethers.ZeroAddress)
    ).to.be.revertedWith("Zero address");
  });

  it("Old owner loses lock from their list after transfer", async function () {
    const { locker, user1, user2 } = await createLock();
    await locker.connect(user1).transferLockOwnership(0, user2.address);
    const ids = await locker.getUserLocks(user1.address);
    expect(ids.length).to.equal(0);
  });

  it("New owner gains lock in their list after transfer", async function () {
    const { locker, user1, user2 } = await createLock();
    await locker.connect(user1).transferLockOwnership(0, user2.address);
    const ids = await locker.getUserLocks(user2.address);
    expect(ids.length).to.equal(1);
  });
});

// ─────────────────────────────────────────────
// 5. LOCK — WITHDRAW
// ─────────────────────────────────────────────

describe("5. Lock — withdraw", function () {
  async function createLock() {
    const ctx = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await ctx.locker.connect(ctx.user1).lockToken(
      await ctx.token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE }
    );
    return { ...ctx, unlockTime };
  }

  it("Cannot withdraw before unlock time", async function () {
    const { locker, user1 } = await createLock();
    await expect(
      locker.connect(user1).withdrawLock(0)
    ).to.be.revertedWith("Still locked");
  });

  it("Cannot withdraw if not owner", async function () {
    const { locker, user2, unlockTime } = await createLock();
    await time.increaseTo(unlockTime + 1);
    await expect(
      locker.connect(user2).withdrawLock(0)
    ).to.be.revertedWith("Not owner");
  });

  it("Withdraws tokens to owner after unlock time", async function () {
    const { locker, token, user1, unlockTime } = await createLock();
    await time.increaseTo(unlockTime + 1);
    const before = await token.balanceOf(user1.address);
    await locker.connect(user1).withdrawLock(0);
    expect(await token.balanceOf(user1.address)).to.equal(before + AMOUNT);
  });

  it("Cannot withdraw twice", async function () {
    const { locker, user1, unlockTime } = await createLock();
    await time.increaseTo(unlockTime + 1);
    await locker.connect(user1).withdrawLock(0);
    await expect(
      locker.connect(user1).withdrawLock(0)
    ).to.be.revertedWith("Already withdrawn");
  });

  it("Removes lock from user array after withdrawal (fix M1)", async function () {
    const { locker, user1, unlockTime } = await createLock();
    await time.increaseTo(unlockTime + 1);
    await locker.connect(user1).withdrawLock(0);
    const ids = await locker.getUserLocks(user1.address);
    expect(ids.length).to.equal(0);
  });
});

// ─────────────────────────────────────────────
// 6. VESTING — HAPPY PATH
// ─────────────────────────────────────────────

describe("6. Vesting — happy path", function () {
  it("Creates vesting and stores correct data", async function () {
    const { locker, token, user1 } = await deploy();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    const vest = await locker.vestings(0);
    expect(vest.owner).to.equal(user1.address);
    expect(vest.totalAmount).to.equal(AMOUNT);
    expect(vest.claimedAmount).to.equal(0);
    expect(vest.cliffDuration).to.equal(0);
    expect(vest.duration).to.equal(ONE_YEAR);
  });

  it("Allows partial claim after some time", async function () {
    const { locker, token, user1 } = await deploy();
    const start = await time.latest();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    // Advance 6 months
    await time.increaseTo(start + ONE_YEAR / 2);
    const before = await token.balanceOf(user1.address);
    await locker.connect(user1).claimVesting(0);
    const claimed = (await token.balanceOf(user1.address)) - before;
    // Should have received roughly half (within 1% tolerance)
    expect(claimed).to.be.gt(AMOUNT / 2n - AMOUNT / 100n);
    expect(claimed).to.be.lt(AMOUNT / 2n + AMOUNT / 100n);
  });

  it("Allows full claim after full duration", async function () {
    const { locker, token, user1 } = await deploy();
    const start = await time.latest();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    await time.increaseTo(start + ONE_YEAR + 1);
    const before = await token.balanceOf(user1.address);
    await locker.connect(user1).claimVesting(0);
    expect(await token.balanceOf(user1.address)).to.equal(before + AMOUNT);
  });

  it("Cannot claim twice for the same period", async function () {
    const { locker, token, user1 } = await deploy();
    const start = await time.latest();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    await time.increaseTo(start + ONE_YEAR + 1);
    await locker.connect(user1).claimVesting(0);
    await expect(
      locker.connect(user1).claimVesting(0)
    ).to.be.revertedWith("Fully claimed");
  });

  it("Adds vesting to user list", async function () {
    const { locker, token, user1 } = await deploy();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    const ids = await locker.getUserVestings(user1.address);
    expect(ids.length).to.equal(1);
  });
});

// ─────────────────────────────────────────────
// 7. VESTING — CLIFF
// ─────────────────────────────────────────────

describe("7. Vesting — cliff logic", function () {
  it("Cannot claim before cliff ends", async function () {
    const { locker, token, user1 } = await deploy();
    const cliff = ONE_YEAR;
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, cliff, ONE_YEAR, { value: VEST_FEE }
    );
    await expect(
      locker.connect(user1).claimVesting(0)
    ).to.be.revertedWith("Cliff not reached");
  });

  it("Can claim after cliff ends", async function () {
    const { locker, token, user1 } = await deploy();
    const start = await time.latest();
    const cliff = ONE_YEAR;
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, cliff, ONE_YEAR, { value: VEST_FEE }
    );
    // Jump past cliff
    await time.increaseTo(start + cliff + 1);
    await expect(
      locker.connect(user1).claimVesting(0)
    ).to.not.be.reverted;
  });
});

// ─────────────────────────────────────────────
// 8. VESTING — VALIDATIONS
// ─────────────────────────────────────────────

describe("8. Vesting — validations", function () {
  it("Rejects zero address token", async function () {
    const { locker, user1 } = await deploy();
    await expect(
      locker.connect(user1).createVesting(ethers.ZeroAddress, AMOUNT, 0, ONE_YEAR, { value: VEST_FEE })
    ).to.be.revertedWith("Invalid token");
  });

  it("Rejects duration less than 1 day (fix C3)", async function () {
    const { locker, token, user1 } = await deploy();
    await expect(
      locker.connect(user1).createVesting(
        await token.getAddress(), AMOUNT, 0, ONE_DAY - 1, { value: VEST_FEE }
      )
    ).to.be.revertedWith("Duration minimum 1 day");
  });

  it("Accepts exactly 1 day duration", async function () {
    const { locker, token, user1 } = await deploy();
    await expect(
      locker.connect(user1).createVesting(
        await token.getAddress(), AMOUNT, 0, ONE_DAY, { value: VEST_FEE }
      )
    ).to.not.be.reverted;
  });

  it("Rejects cliff longer than 10 years", async function () {
    const { locker, token, user1 } = await deploy();
    const tooLong = ONE_DAY * 3651;
    await expect(
      locker.connect(user1).createVesting(
        await token.getAddress(), AMOUNT, tooLong, ONE_YEAR, { value: VEST_FEE }
      )
    ).to.be.revertedWith("Cliff too long");
  });

  it("Rejects insufficient fee", async function () {
    const { locker, token, user1 } = await deploy();
    await expect(
      locker.connect(user1).createVesting(
        await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: 0 }
      )
    ).to.be.revertedWith("Insufficient fee");
  });

  it("Non-owner cannot claim", async function () {
    const { locker, token, user1, user2 } = await deploy();
    const start = await time.latest();
    await locker.connect(user1).createVesting(
      await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    await time.increaseTo(start + ONE_YEAR + 1);
    await expect(
      locker.connect(user2).claimVesting(0)
    ).to.be.revertedWith("Not owner");
  });
});

// ─────────────────────────────────────────────
// 9. VESTING — TRANSFER OWNERSHIP
// ─────────────────────────────────────────────

describe("9. Vesting — transfer ownership", function () {
  async function createVesting() {
    const ctx = await deploy();
    await ctx.locker.connect(ctx.user1).createVesting(
      await ctx.token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE }
    );
    return ctx;
  }

  it("Owner can transfer vesting", async function () {
    const { locker, user1, user2 } = await createVesting();
    await locker.connect(user1).transferVestingOwnership(0, user2.address);
    const vest = await locker.vestings(0);
    expect(vest.owner).to.equal(user2.address);
  });

  it("Old owner loses vesting from their list", async function () {
    const { locker, user1, user2 } = await createVesting();
    await locker.connect(user1).transferVestingOwnership(0, user2.address);
    expect((await locker.getUserVestings(user1.address)).length).to.equal(0);
  });

  it("New owner gains vesting in their list", async function () {
    const { locker, user1, user2 } = await createVesting();
    await locker.connect(user1).transferVestingOwnership(0, user2.address);
    expect((await locker.getUserVestings(user2.address)).length).to.equal(0n + 1n);
  });

  it("Non-owner cannot transfer", async function () {
    const { locker, user2 } = await createVesting();
    await expect(
      locker.connect(user2).transferVestingOwnership(0, user2.address)
    ).to.be.revertedWith("Not owner");
  });
});

// ─────────────────────────────────────────────
// 10. VIEW FUNCTIONS
// ─────────────────────────────────────────────

describe("10. View functions", function () {
  it("getUserLocksLength returns correct count", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    expect(await locker.getUserLocksLength(user1.address)).to.equal(2);
  });

  it("getUserVestingsLength returns correct count (fix M2)", async function () {
    const { locker, token, user1 } = await deploy();
    await locker.connect(user1).createVesting(await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE });
    expect(await locker.getUserVestingsLength(user1.address)).to.equal(1);
  });

  it("getCertificateHash returns non-zero bytes32", async function () {
    const { locker, token, user1 } = await deploy();
    const unlockTime = (await time.latest()) + ONE_YEAR;
    await locker.connect(user1).lockToken(await token.getAddress(), AMOUNT, unlockTime, { value: LOCK_FEE });
    const hash = await locker.getCertificateHash(0);
    expect(hash).to.not.equal(ethers.ZeroHash);
  });

  it("getVestingCertificateHash returns non-zero bytes32 (fix M3)", async function () {
    const { locker, token, user1 } = await deploy();
    await locker.connect(user1).createVesting(await token.getAddress(), AMOUNT, 0, ONE_YEAR, { value: VEST_FEE });
    const hash = await locker.getVestingCertificateHash(0);
    expect(hash).to.not.equal(ethers.ZeroHash);
  });
});