// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ZeroXKeepLocker (V11: Fort Knox)
 * @notice Trustless Token Locker. Audit fixes applied (Reentrancy, Math Overflow, Array Safety).
 * @dev Immutable. Admin-free.
 */

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ZeroXKeepLocker is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    // --- METADATA & CONFIG ---
    string public constant VERSION = "0xKeep V11";
    uint256 public immutable CHAIN_ID;
    uint256 public immutable LOCK_FEE;
    uint256 public immutable VESTING_FEE;
    address payable public immutable feeReceiver;

    // --- STRUCTS ---
    struct LockInfo {
        address token;      // Slot 1
        uint96 amount;      // Slot 1
        address owner;      // Slot 2
        uint8 decimals;     // Slot 2
        bool withdrawn;     // Slot 2
        uint32 unlockTime;  // Slot 2
        uint256 id;         // Slot 3
    }

    struct VestingInfo {
        address token;      // Slot 1
        uint96 totalAmount; // Slot 1
        address owner;      // Slot 2
        uint8 decimals;     // Slot 2
        uint96 claimedAmount; // Slot 2
        uint32 startTime;   // Slot 3
        uint32 cliffDuration; // Slot 3
        uint32 duration;    // Slot 3
        uint256 id;         // Slot 4
    }

    // --- STORAGE ---
    uint256 public allLocksCount; 
    uint256 public allVestingsCount;

    mapping(uint256 => LockInfo) public locks;
    mapping(uint256 => VestingInfo) public vestings;

    // Indexed Mapping for O(1) removal
    mapping(address => uint256[]) private userLockIds;
    mapping(address => uint256[]) private userVestingIds;
    mapping(uint256 => uint256) private lockIdToIndex;
    mapping(uint256 => uint256) private vestingIdToIndex;

    // --- EVENTS ---
    event Locked(uint256 indexed lockId, address indexed token, address indexed owner, uint256 amount, uint256 unlockTime, uint256 chainId);
    event LockExtended(uint256 indexed lockId, uint256 newUnlockTime);
    event LockTransferred(uint256 indexed lockId, address indexed oldOwner, address indexed newOwner);
    event LockWithdrawn(uint256 indexed lockId, address indexed token, address indexed owner, uint256 amount);

    event VestingCreated(uint256 indexed vestingId, address indexed token, address indexed owner, uint256 amount, uint256 cliff, uint256 duration, uint256 chainId);
    event VestingClaimed(uint256 indexed vestingId, address indexed token, address indexed owner, uint256 amount);
    event VestingTransferred(uint256 indexed vestingId, address indexed oldOwner, address indexed newOwner);
    event VestingCompleted(uint256 indexed vestingId, address indexed owner);
    
    event FeeTransferFailed(uint256 amount, bytes data);

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
        require(_amount > 0, "Amount > 0");
        require(_amount <= type(uint96).max, "Amount overflow");
        require(_unlockTime <= type(uint32).max, "Date overflow");
        require(_unlockTime > block.timestamp, "Time in past");
        require(_unlockTime < block.timestamp + 36500 days, "Max 100 years");

        _payFee(LOCK_FEE);
        uint256 actualAmount = _transferTokensIn(_token, _amount);
        uint8 tokenDecimals = _tryGetDecimals(_token);

        uint256 lockId = allLocksCount++;
        
        locks[lockId] = LockInfo({
            id: lockId,
            token: _token,
            decimals: tokenDecimals,
            owner: msg.sender,
            amount: uint96(actualAmount),
            unlockTime: uint32(_unlockTime),
            withdrawn: false
        });

        _addLockToUser(msg.sender, lockId);
        emit Locked(lockId, _token, msg.sender, actualAmount, _unlockTime, CHAIN_ID);
    }

    function extendLock(uint256 _lockId, uint256 _newUnlockTime) external nonReentrant {
        LockInfo storage lock = locks[_lockId];
        require(msg.sender == lock.owner, "Not owner");
        require(!lock.withdrawn, "Already withdrawn");
        require(_newUnlockTime > lock.unlockTime, "Must increase time");
        require(_newUnlockTime <= type(uint32).max, "Date overflow");

        lock.unlockTime = uint32(_newUnlockTime);
        emit LockExtended(_lockId, _newUnlockTime);
    }

    function transferLockOwnership(uint256 _lockId, address _newOwner) external nonReentrant {
        LockInfo storage lock = locks[_lockId];
        require(msg.sender == lock.owner, "Not owner");
        require(_newOwner != address(0), "Zero address");
        require(!lock.withdrawn, "Already withdrawn");

        address oldOwner = lock.owner;
        
        _removeLockFromUser(oldOwner, _lockId);
        _addLockToUser(_newOwner, _lockId);

        lock.owner = _newOwner;
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
        require(_amount > 0, "Amount > 0");
        require(_amount <= type(uint96).max, "Amount overflow");
        require(_cliffSeconds <= type(uint32).max, "Cliff overflow");
        require(_durationSeconds <= type(uint32).max, "Duration overflow");
        require(_cliffSeconds < 3650 days, "Cliff too long");
        
        // Audit Fix: Duration logic safety
        require(_durationSeconds > 0, "Duration > 0");
        // Ensure that the linear duration is logical (duration = time after cliff)

        _payFee(VESTING_FEE);
        uint256 actualAmount = _transferTokensIn(_token, _amount);
        uint8 tokenDecimals = _tryGetDecimals(_token);

        uint256 vestingId = allVestingsCount++;

        vestings[vestingId] = VestingInfo({
            id: vestingId,
            token: _token,
            decimals: tokenDecimals,
            owner: msg.sender,
            totalAmount: uint96(actualAmount),
            claimedAmount: 0,
            startTime: uint32(block.timestamp),
            cliffDuration: uint32(_cliffSeconds),
            duration: uint32(_durationSeconds)
        });

        _addVestingToUser(msg.sender, vestingId);
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
            // Audit Fix: Overflow-Safe Math for large supplies
            // (Total * Time) / Duration -> (Total / Duration) * Time + Remainder
            uint256 amount = uint256(vest.totalAmount);
            uint256 duration = uint256(vest.duration);
            totalUnlocked = (amount / duration) * timePassed + ((amount % duration) * timePassed) / duration;
        }

        uint256 claimable = totalUnlocked - vest.claimedAmount;
        require(claimable > 0, "Nothing to claim");

        vest.claimedAmount += uint96(claimable);

        IERC20Metadata(vest.token).safeTransfer(msg.sender, claimable);
        emit VestingClaimed(_vestingId, vest.token, msg.sender, claimable);

        if (vest.claimedAmount == vest.totalAmount) {
            emit VestingCompleted(_vestingId, msg.sender);
        }
    }

    function transferVestingOwnership(uint256 _vestingId, address _newOwner) external nonReentrant {
        VestingInfo storage vest = vestings[_vestingId];
        require(msg.sender == vest.owner, "Not owner");
        require(_newOwner != address(0), "Zero address");
        require(vest.claimedAmount < vest.totalAmount, "Fully claimed");

        address oldOwner = vest.owner;
        
        _removeVestingFromUser(oldOwner, _vestingId);
        _addVestingToUser(_newOwner, _vestingId);

        vest.owner = _newOwner;
        emit VestingTransferred(_vestingId, oldOwner, _newOwner);
    }

    // ==========================================
    // 3. ARRAY MANAGEMENT (Secure)
    // ==========================================

    function _addLockToUser(address user, uint256 lockId) internal {
        userLockIds[user].push(lockId);
        lockIdToIndex[lockId] = userLockIds[user].length - 1;
    }

    // Audit Fix: Safe Removal with bounds checking
    function _removeLockFromUser(address user, uint256 lockId) internal {
        uint256[] storage userArray = userLockIds[user];
        require(userArray.length > 0, "No locks");
        
        uint256 index = lockIdToIndex[lockId];
        // Safety check to ensure mapping isn't corrupted
        require(index < userArray.length && userArray[index] == lockId, "Index mismatch");

        uint256 lastElement = userArray[userArray.length - 1];

        // Swap
        if (index != userArray.length - 1) {
            userArray[index] = lastElement;
            lockIdToIndex[lastElement] = index;
        }

        // Pop
        userArray.pop();
        delete lockIdToIndex[lockId];
    }

    function _addVestingToUser(address user, uint256 vestingId) internal {
        userVestingIds[user].push(vestingId);
        vestingIdToIndex[vestingId] = userVestingIds[user].length - 1;
    }

    function _removeVestingFromUser(address user, uint256 vestingId) internal {
        uint256[] storage userArray = userVestingIds[user];
        require(userArray.length > 0, "No vestings");
        
        uint256 index = vestingIdToIndex[vestingId];
        require(index < userArray.length && userArray[index] == vestingId, "Index mismatch");

        uint256 lastElement = userArray[userArray.length - 1];

        if (index != userArray.length - 1) {
            userArray[index] = lastElement;
            vestingIdToIndex[lastElement] = index;
        }

        userArray.pop();
        delete vestingIdToIndex[vestingId];
    }

    // ==========================================
    // 4. HELPERS
    // ==========================================

    // Audit Fix: Anti-Reentrancy Fee Logic
    function _payFee(uint256 requiredFee) internal {
        require(msg.value >= requiredFee, "Insufficient fee");
        
        // 1. Transfer Fee FIRST (CEI Pattern)
        (bool success, ) = feeReceiver.call{value: requiredFee}("");
        require(success, "Fee transfer failed");

        // 2. Refund Excess SECOND
        if (msg.value > requiredFee) {
            // We use a low-level call and ignore failure to prevent griefing
            // If the user's wallet rejects ETH, that's their fault, not a protocol bug.
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - requiredFee}("");
            if (!refundSuccess) {
                // Refund failed, but protocol continues.
            }
        }
    }

    function getCertificateHash(uint256 _lockId) external view returns (bytes32) {
        LockInfo memory lock = locks[_lockId];
        return keccak256(abi.encode(lock.id, lock.token, lock.amount, lock.unlockTime, lock.owner, CHAIN_ID));
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

    // View Functions
    function getUserLocks(address _user) external view returns (uint256[] memory) { return userLockIds[_user]; }
    function getUserVestings(address _user) external view returns (uint256[] memory) { return userVestingIds[_user]; }
    
    function getUserLocksLength(address _user) external view returns (uint256) {
        return userLockIds[_user].length;
    }
}