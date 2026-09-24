import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { Signer } from "ethers";

// Adversarial / hostile-condition edge tests for ZeroXKeepLocker (V12).
// These go beyond the happy path: fee-on-transfer, rebasing, uint96/uint32
// boundaries, vesting dust, reentrancy, non-standard ERC20s, and the
// fee-receiver trust assumption. Mocks live in contracts/Mocks/AdversarialMocks.sol.
//
// Run: npx hardhat test test/AdversarialEdgeTest.ts

const LOCK_FEE = ethers.parseEther("0.03");
const VEST_FEE = ethers.parseEther("0.02");
const U96_MAX = (1n << 96n) - 1n;
const U32_MAX = (1n << 32n) - 1n;

let owner: Signer, alice: Signer, bob: Signer, feeSink: Signer;
let aliceAddr: string, bobAddr: string, feeSinkAddr: string;

async function deploy(name: string, signer: Signer, ...args: any[]): Promise<any> {
  const f = await ethers.getContractFactory(name, signer);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function newLocker(feeReceiver?: string): Promise<any> {
  return deploy("ZeroXKeepLocker", owner, LOCK_FEE, VEST_FEE, feeReceiver ?? feeSinkAddr);
}
async function future(sec: number): Promise<bigint> {
  return BigInt(await time.latest()) + BigInt(sec);
}

describe("0xKeep — Adversarial edge cases", function () {
  this.timeout(120000);

  beforeEach(async () => {
    [owner, alice, bob, feeSink] = await ethers.getSigners();
    aliceAddr = await alice.getAddress();
    bobAddr = await bob.getAddress();
    feeSinkAddr = await feeSink.getAddress();
  });

  // ── A. FEE-ON-TRANSFER ─────────────────────────────
  describe("A. Fee-on-transfer tokens", () => {
    it("records the ACTUAL received amount (post-tax), not the requested amount", async () => {
      const locker = await newLocker();
      const tok = await deploy("FeeOnTransferToken", owner, 1000n); // 10% tax
      await tok.transfer(aliceAddr, ethers.parseEther("10000"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      const amt = ethers.parseEther("1000");
      await locker.connect(alice).lockToken(await tok.getAddress(), amt, await future(3600), { value: LOCK_FEE });
      expect((await locker.locks(0)).amount).to.equal((amt * 9n) / 10n); // 900, no phantom lock
    });

    it("withdrawal is solvent under fee-on-transfer (vault holds exactly the ledger amount)", async () => {
      const locker = await newLocker();
      const tok = await deploy("FeeOnTransferToken", owner, 1000n);
      await tok.transfer(aliceAddr, ethers.parseEther("5000"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1000"), await future(100), { value: LOCK_FEE });
      const recorded = (await locker.locks(0)).amount; // 900
      expect(await tok.balanceOf(await locker.getAddress())).to.equal(recorded); // vault == ledger
      await time.increase(200);
      await expect(locker.connect(alice).withdrawLock(0)).to.not.be.reverted;
      expect(await tok.balanceOf(await locker.getAddress())).to.equal(0n);
    });
  });

  // ── B. REBASING (DOWNWARD) ─────────────────────────
  describe("B. Rebasing tokens (documented brick, C4)", () => {
    it("a downward rebase below the ledger amount bricks that withdrawal", async () => {
      const locker = await newLocker();
      const tok = await deploy("RebasingToken", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("2000"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1000"), await future(100), { value: LOCK_FEE });
      await tok.adminBurn(await locker.getAddress(), ethers.parseEther("500")); // simulate downward rebase
      await time.increase(200);
      await expect(locker.connect(alice).withdrawLock(0)).to.be.reverted; // known limitation, not a code bug
    });
  });

  // ── C. uint96 AMOUNT BOUNDARY ──────────────────────
  describe("C. uint96 amount boundary (C2)", () => {
    it("locking exactly uint96 max succeeds", async () => {
      const locker = await newLocker();
      const tok = await deploy("HugeToken", owner);
      await tok.mintTo(aliceAddr, U96_MAX);
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), U96_MAX, await future(100), { value: LOCK_FEE });
      expect((await locker.locks(0)).amount).to.equal(U96_MAX);
    });

    it("locking uint96 max + 1 reverts (no silent truncation)", async () => {
      const locker = await newLocker();
      const tok = await deploy("HugeToken", owner);
      await tok.mintTo(aliceAddr, U96_MAX + 10n);
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await expect(
        locker.connect(alice).lockToken(await tok.getAddress(), U96_MAX + 1n, await future(100), { value: LOCK_FEE })
      ).to.be.revertedWith("Amount exceeds uint96");
    });
  });

  // ── D. uint32 TIME BOUNDARY ────────────────────────
  describe("D. uint32 unlock-time boundary", () => {
    it("unlock at exactly uint32 max succeeds; +1 reverts", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("10"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), U32_MAX, { value: LOCK_FEE });
      expect((await locker.locks(0)).unlockTime).to.equal(U32_MAX);
      await expect(
        locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), U32_MAX + 1n, { value: LOCK_FEE })
      ).to.be.revertedWith("Date overflow");
    });

    it("extendLock cannot push beyond uint32 max", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("10"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), await future(1000), { value: LOCK_FEE });
      await expect(locker.connect(alice).extendLock(0, U32_MAX + 1n)).to.be.revertedWith("Date overflow");
    });
  });

  // ── E. VESTING DUST / ROUNDING ─────────────────────
  describe("E. Vesting rounding & dust", () => {
    it("sum of many partial claims equals total exactly, never over", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("100"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      const total = 1000003n; // indivisible by duration
      const dur = 90n * 24n * 3600n; // 90 days
      await locker.connect(alice).createVesting(await tok.getAddress(), total, 0, dur, { value: VEST_FEE });
      let claimed = 0n;
      const start = BigInt(await time.latest());
      for (let i = 1; i <= 9; i++) {
        await time.increaseTo(start + (dur * BigInt(i)) / 10n);
        const before = await tok.balanceOf(aliceAddr);
        await locker.connect(alice).claimVesting(0);
        claimed += (await tok.balanceOf(aliceAddr)) - before;
        expect(claimed).to.be.lte(total); // never over-claims
      }
      await time.increaseTo(start + dur + 10n);
      const before = await tok.balanceOf(aliceAddr);
      await locker.connect(alice).claimVesting(0);
      claimed += (await tok.balanceOf(aliceAddr)) - before;
      expect(claimed).to.equal(total); // no dust lost
    });

    it("amount smaller than duration (per-second rate rounds to 0) still fully vests at end", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("1"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      const total = 100n; // wei, << duration
      const dur = 30n * 24n * 3600n;
      await locker.connect(alice).createVesting(await tok.getAddress(), total, 0, dur, { value: VEST_FEE });
      await time.increase(Number(dur) + 10);
      const before = await tok.balanceOf(aliceAddr);
      await locker.connect(alice).claimVesting(0);
      expect((await tok.balanceOf(aliceAddr)) - before).to.equal(total);
    });

    it("claiming 1 second before cliff reverts; at/after cliff works", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("100"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      const cliff = 10n * 24n * 3600n, dur = 100n * 24n * 3600n;
      await locker.connect(alice).createVesting(await tok.getAddress(), ethers.parseEther("100"), cliff, dur, { value: VEST_FEE });
      const start = BigInt(await time.latest());
      await time.increaseTo(start + cliff - 5n);
      await expect(locker.connect(alice).claimVesting(0)).to.be.revertedWith("Cliff not reached");
      await time.increaseTo(start + cliff + 100n);
      await expect(locker.connect(alice).claimVesting(0)).to.not.be.reverted;
    });
  });

  // ── F. REENTRANCY ──────────────────────────────────
  describe("F. Reentrancy (ERC777-style callback)", () => {
    it("withdraw: reentrant withdrawLock is blocked; no double-spend; other users safe", async () => {
      const locker = await newLocker();
      const tok = await deploy("ReentrantToken", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("1000"));
      await tok.transfer(bobAddr, ethers.parseEther("1000"));
      const laddr = await locker.getAddress();
      await tok.connect(alice).approve(laddr, ethers.MaxUint256);
      await tok.connect(bob).approve(laddr, ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("100"), await future(100), { value: LOCK_FEE }); // id 0
      await locker.connect(bob).lockToken(await tok.getAddress(), ethers.parseEther("100"), await future(100), { value: LOCK_FEE });   // id 1
      await tok.arm(laddr, 0, 0, true, false); // reenter withdrawLock(0)
      await time.increase(200);
      const aBefore = await tok.balanceOf(aliceAddr);
      await locker.connect(alice).withdrawLock(0);
      expect(await tok.reentrancyReverted()).to.equal(true); // guard fired
      expect((await tok.balanceOf(aliceAddr)) - aBefore).to.equal(ethers.parseEther("100")); // paid once
      expect((await locker.locks(0)).withdrawn).to.equal(true);
      expect(await tok.balanceOf(laddr)).to.equal(ethers.parseEther("100")); // bob's funds intact
      await time.increase(1);
      await locker.connect(bob).withdrawLock(1);
      expect(await tok.balanceOf(laddr)).to.equal(0n);
    });

    it("claim: reentrant claimVesting is blocked; no double-spend", async () => {
      const locker = await newLocker();
      const tok = await deploy("ReentrantToken", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("1000"));
      const laddr = await locker.getAddress();
      await tok.connect(alice).approve(laddr, ethers.MaxUint256);
      const dur = 10n * 24n * 3600n;
      await locker.connect(alice).createVesting(await tok.getAddress(), ethers.parseEther("100"), 0, dur, { value: VEST_FEE }); // id 0
      await tok.arm(laddr, 0, 0, false, true); // reenter claimVesting(0)
      await time.increase(Number(dur) + 10);
      const aBefore = await tok.balanceOf(aliceAddr);
      await locker.connect(alice).claimVesting(0);
      expect(await tok.reentrancyReverted()).to.equal(true);
      expect((await tok.balanceOf(aliceAddr)) - aBefore).to.equal(ethers.parseEther("100")); // exactly total, not 2x
    });
  });

  // ── G. NON-STANDARD TOKENS ─────────────────────────
  describe("G. Non-standard ERC20s", () => {
    it("USDT-style no-return-value token works via SafeERC20 (lock + withdraw)", async () => {
      const locker = await newLocker();
      const tok = await deploy("NoReturnToken", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("100"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("50"), await future(100), { value: LOCK_FEE });
      await time.increase(200);
      const before = await tok.balanceOf(aliceAddr);
      await locker.connect(alice).withdrawLock(0);
      expect((await tok.balanceOf(aliceAddr)) - before).to.equal(ethers.parseEther("50"));
    });

    it("zero-decimals token caches decimals = 0", async () => {
      const locker = await newLocker();
      const tok = await deploy("ZeroDecimalsToken", owner);
      await tok.transfer(aliceAddr, 1000n);
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), 100n, await future(100), { value: LOCK_FEE });
      expect((await locker.locks(0)).decimals).to.equal(0);
    });

    it("token whose decimals() reverts defaults to 18 (try/catch)", async () => {
      const locker = await newLocker();
      const tok = await deploy("RevertingDecimalsToken", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("10"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), await future(100), { value: LOCK_FEE });
      expect((await locker.locks(0)).decimals).to.equal(18);
    });
  });

  // ── H. FEE RECEIVER BRICK (trust assumption) ───────
  describe("H. Fee receiver liveness", () => {
    it("a feeReceiver that rejects ETH bricks ALL locks (immutable trust assumption)", async () => {
      const bad = await deploy("RejectsEth", owner);
      const locker = await newLocker(await bad.getAddress());
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("10"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await expect(
        locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), await future(100), { value: LOCK_FEE })
      ).to.be.revertedWith("Fee transfer failed");
    });
  });

  // ── I. REFUND-REVERT BRANCH (C1) ───────────────────
  describe("I. Excess-ETH refund", () => {
    it("EOA overpay is refunded (contract keeps 0 ETH)", async () => {
      const locker = await newLocker();
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(aliceAddr, ethers.parseEther("10"));
      await tok.connect(alice).approve(await locker.getAddress(), ethers.MaxUint256);
      await locker.connect(alice).lockToken(await tok.getAddress(), ethers.parseEther("1"), await future(100), {
        value: LOCK_FEE + ethers.parseEther("1"),
      });
      expect(await ethers.provider.getBalance(await locker.getAddress())).to.equal(0n);
    });

    it("caller that rejects the refund reverts the whole tx (C1, no silent loss)", async () => {
      const rejecter = await deploy("RejectsEth", owner);
      const locker = await newLocker(); // feeSink accepts the fee; refund goes back to rejecter
      const tok = await deploy("ERC20Mock", owner);
      await tok.transfer(await rejecter.getAddress(), ethers.parseEther("10"));
      await expect(
        rejecter.armAndLock(await locker.getAddress(), await tok.getAddress(), ethers.parseEther("1"), await future(100), {
          value: LOCK_FEE + 1n,
        })
      ).to.be.revertedWith("Refund failed: use exact fee amount");
    });
  });
});
