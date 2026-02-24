// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ZeroXKeepLocker
 * @notice Trustless Token Locker & Vesting with Full Ownership Controls.
 */

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ZeroXKeepLocker is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    // --- METADATA & CONFIG ---
    string public constant VERSION = "0xKeep V8";
    uint256 public immutable CHAIN_ID;
    uint256 public immutable LOCK_FEE;
    uint256 public immutable VESTING_FEE;
    address payable public immutable feeReceiver;

    // --- STRUCTS ---
    struct LockInfo {
        uint256 id;
        address token;
        uint8 decimals;
        address owner;
        uint256 amount;
        uint256 unlockTime;
        bool withdrawn;
    }

    struct VestingInfo {
        uint256 id;
        address token;
        uint8 decimals;
        address owner;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 duration;
    }

    // --- STORAGE ---
    uint256 public allLocksCount; 
    uint256 public allVestingsCount;

    mapping(uint256 => LockInfo) public locks;
    mapping(uint256 => VestingInfo) public vestings;

    mapping(address => uint256[]) private userLockIds;
    mapping(address => uint256[]) private userVestingIds;

    // --- EVENTS ---
    event Locked(uint256 indexed lockId, address indexed token, address indexed owner, uint256 amount, uint256 unlockTime, uint256 chainId);
    event LockExtended(uint256 indexed lockId, uint256 newUnlockTime);
    event LockTransferred(uint256 indexed lockId, address indexed oldOwner, address indexed newOwner);
    event LockWithdrawn(uint256 indexed lockId, address indexed token, address indexed owner, uint256 amount);

    event VestingCreated(uint256 indexed vestingId, address indexed token, address indexed owner, uint256 amount, uint256 cliff, uint256 duration, uint256 chainId);
    event VestingClaimed(uint256 indexed vestingId, address indexed token, address indexed owner, uint256 amount);
    event VestingTransferred(uint256 indexed vestingId, address indexed oldOwner, address indexed newOwner); // NEW V8
    event VestingCompleted(uint256 indexed vestingId, address indexed owner);

    constructor(uint256 _lockFee, uint256 _vestingFee, address _feeReceiver) {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        LOCK_FEE = _lockFee;
        VESTING_FEE = _vestingFee;
        feeReceiver = payable(_feeReceiver);
        CHAIN_ID = block.chainid;
    }

    // ==========================================
    // 1. STANDARD LOCK
    // ==========================================
    
    function lockToken(address _token, uint256 _amount, uint256 _unlockTime) external payable nonReentrant {
        require(_token != address(0), "Invalid token");
        require(msg.value >= LOCK_FEE, "Insufficient Fee");
        require(_amount > 0, "Amount > 0");
        require(_unlockTime > block.timestamp, "Time in past");
        require(_unlockTime < block.timestamp + 36500 days, "Max 100 years");

        _payFee();
        uint256 actualAmount = _transferTokensIn(_token, _amount);
        uint8 tokenDecimals = _tryGetDecimals(_token);

        uint256 lockId = allLocksCount++;
        
        locks[lockId] = LockInfo({
            id: lockId,
            token: _token,
            decimals: tokenDecimals,
            owner: msg.sender,
            amount: actualAmount,
            unlockTime: _unlockTime,
            withdrawn: false
        });

        userLockIds[msg.sender].push(lockId);
        emit Locked(lockId, _token, msg.sender, actualAmount, _unlockTime, CHAIN_ID);
    }

    function extendLock(uint256 _lockId, uint256 _newUnlockTime) external nonReentrant {
        LockInfo storage lock = locks[_lockId];
        require(msg.sender == lock.owner, "Not owner");
        require(!lock.withdrawn, "Already withdrawn");
        require(_newUnlockTime > lock.unlockTime, "Must increase time");
        require(_newUnlockTime < block.timestamp + 36500 days, "Max 100 years");

        lock.unlockTime = _newUnlockTime;
        emit LockExtended(_lockId, _newUnlockTime);
    }

    function transferLockOwnership(uint256 _lockId, address _newOwner) external nonReentrant {
        LockInfo storage lock = locks[_lockId];
        require(msg.sender == lock.owner, "Not owner");
        require(_newOwner != address(0), "Zero address");
        require(!lock.withdrawn, "Already withdrawn");

        address oldOwner = lock.owner;
        lock.owner = _newOwner;
        userLockIds[_newOwner].push(_lockId);
        emit LockTransferred(_lockId, oldOwner, _newOwner);
    }

    function withdrawLock(uint256 _lockId) external nonReentrant {
        LockInfo storage lock = locks[_lockId];
        require(msg.sender == lock.owner, "Not owner");
        require(!lock.withdrawn, "Already withdrawn");
        require(block.timestamp >= lock.unlockTime, "Still locked");

        lock.withdrawn = true;
        uint256 amount = lock.amount;
        lock.amount = 0;

        IERC20Metadata(lock.token).safeTransfer(msg.sender, amount);
        emit LockWithdrawn(_lockId, lock.token, msg.sender, amount);
    }

    // ==========================================
    // 2. VESTING
    // ==========================================

    function createVesting(address _token, uint256 _amount, uint256 _cliffSeconds, uint256 _durationSeconds) external payable nonReentrant {
        require(_token != address(0), "Invalid token");
        require(msg.value >= VESTING_FEE, "Insufficient Fee");
        require(_amount > 0, "Amount > 0");
        require(_durationSeconds > 0, "Duration > 0");
        require(_cliffSeconds < 3650 days, "Cliff too long");

        _payFee();
        uint256 actualAmount = _transferTokensIn(_token, _amount);
        uint8 tokenDecimals = _tryGetDecimals(_token);

        uint256 vestingId = allVestingsCount++;

        vestings[vestingId] = VestingInfo({
            id: vestingId,
            token: _token,
            decimals: tokenDecimals,
            owner: msg.sender,
            totalAmount: actualAmount,
            claimedAmount: 0,
            startTime: block.timestamp,
            cliffDuration: _cliffSeconds,
            duration: _durationSeconds
        });

        userVestingIds[msg.sender].push(vestingId);
        emit VestingCreated(vestingId, _token, msg.sender, actualAmount, _cliffSeconds, _durationSeconds, CHAIN_ID);
    }

    function claimVesting(uint256 _vestingId) external nonReentrant {
        VestingInfo storage vest = vestings[_vestingId];
        require(msg.sender == vest.owner, "Not owner");
        require(vest.totalAmount > vest.claimedAmount, "Fully claimed");

        if (block.timestamp < vest.startTime + vest.cliffDuration) {
            revert("Cliff not reached");
        }
        
        uint256 timePassed = block.timestamp - (vest.startTime + vest.cliffDuration);
        uint256 totalUnlocked;
        
        if (timePassed >= vest.duration) {
            totalUnlocked = vest.totalAmount;
        } else {
            totalUnlocked = (vest.totalAmount * timePassed) / vest.duration;
        }

        uint256 claimable = totalUnlocked - vest.claimedAmount;
        require(claimable > 0, "Nothing to claim");

        vest.claimedAmount += claimable;

        IERC20Metadata(vest.token).safeTransfer(msg.sender, claimable);
        emit VestingClaimed(_vestingId, vest.token, msg.sender, claimable);

        if (vest.claimedAmount == vest.totalAmount) {
            emit VestingCompleted(_vestingId, msg.sender);
        }
    }

    // NEW V8 FUNCTION: TRANSFER VESTING
    function transferVestingOwnership(uint256 _vestingId, address _newOwner) external nonReentrant {
        VestingInfo storage vest = vestings[_vestingId];
        require(msg.sender == vest.owner, "Not owner");
        require(_newOwner != address(0), "Zero address");
        require(vest.claimedAmount < vest.totalAmount, "Fully claimed");

        address oldOwner = vest.owner;
        vest.owner = _newOwner;
        userVestingIds[_newOwner].push(_vestingId);
        emit VestingTransferred(_vestingId, oldOwner, _newOwner);
    }

    // ==========================================
    // 3. HELPERS
    // ==========================================

    function getCertificateHash(uint256 _lockId) external view returns (bytes32) {
        LockInfo memory lock = locks[_lockId];
        return keccak256(abi.encodePacked(lock.id, lock.token, lock.amount, lock.unlockTime, lock.owner, CHAIN_ID));
    }

    function _payFee() internal {
        (bool success, ) = feeReceiver.call{value: msg.value}("");
        require(success, "Fee transfer failed");
    }

    function _transferTokensIn(address _token, uint256 _amount) internal returns (uint256) {
        IERC20Metadata token = IERC20Metadata(_token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), _amount);
        uint256 balanceAfter = token.balanceOf(address(this));
        uint256 actualAmount = balanceAfter - balanceBefore;
        require(actualAmount > 0, "No tokens received");
        return actualAmount;
    }

    function _tryGetDecimals(address _token) internal view returns (uint8) {
        try IERC20Metadata(_token).decimals() returns (uint8 d) { return d; } catch { return 18; }
    }

    function getUserLocks(address _user) external view returns (uint256[] memory) { return userLockIds[_user]; }
    function getUserVestings(address _user) external view returns (uint256[] memory) { return userVestingIds[_user]; }
}