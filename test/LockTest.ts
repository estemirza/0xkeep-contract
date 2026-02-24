import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("0xKeep V5: Business Features", function () {
  it("Should handle Locks, Extensions, and Ownership Transfer", async function () {
    const [deployer, user1, user2] = await ethers.getSigners();
    
    // 1. Deploy
    const TokenFactory = await ethers.getContractFactory("ERC20Mock");
    const token = await TokenFactory.deploy();
    
    const lockFee = ethers.parseEther("0.02");
    const vestFee = ethers.parseEther("0.05");
    
    const LockerFactory = await ethers.getContractFactory("ZeroXKeepLocker");
    const locker = await LockerFactory.deploy(lockFee, vestFee, deployer.address);

    await token.transfer(user1.address, ethers.parseEther("2000"));
    await token.connect(user1).approve(locker.target, ethers.parseEther("2000"));

    // 2. Lock (User1)
    const initialUnlockTime = (await time.latest()) + 3600; // 1 hour
    
    // Notice: We verify the ID is '0' since it's the first lock
    await locker.connect(user1).lockToken(token.target, ethers.parseEther("100"), initialUnlockTime, { value: lockFee });
    
    const lockId = 0;
    const lockInfo = await locker.locks(lockId);
    expect(lockInfo.owner).to.equal(user1.address);
    console.log("✅ Locked successfully (ID: 0)");

    // 3. Extend Lock (User1)
    const newUnlockTime = initialUnlockTime + 3600; // +1 hour
    await locker.connect(user1).extendLock(lockId, newUnlockTime);
    
    const extendedInfo = await locker.locks(lockId);
    expect(extendedInfo.unlockTime).to.equal(newUnlockTime);
    console.log("✅ Lock Extended successfully");

    // 4. Transfer Ownership (User1 -> User2)
    await locker.connect(user1).transferLockOwnership(lockId, user2.address);
    
    const transferredInfo = await locker.locks(lockId);
    expect(transferredInfo.owner).to.equal(user2.address);
    console.log("✅ Ownership Transferred to User2");

    // 5. Security Check: Old Owner tries to withdraw (Should Fail)
    await time.increase(7300); // Wait for unlock
    
    await expect(
        locker.connect(user1).withdrawLock(lockId)
    ).to.be.revertedWith("Not owner");
    console.log("✅ Security: Old owner cannot withdraw");

    // 6. New Owner Withdraws (Should Success)
    await locker.connect(user2).withdrawLock(lockId);
    console.log("✅ New Owner Withdraw Successful");
  });
});