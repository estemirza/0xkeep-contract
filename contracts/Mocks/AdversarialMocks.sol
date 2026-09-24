// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILocker {
    function withdrawLock(uint256 _lockId) external;
    function claimVesting(uint256 _vestingId) external;
    function lockToken(address _token, uint256 _amount, uint256 _unlockTime) external payable;
}

interface IERC20Min { function approve(address s, uint256 a) external returns (bool); }

/// Fee-on-transfer ("tax") token. Burns feeBps on every transfer.
contract FeeOnTransferToken is ERC20 {
    uint256 public feeBps; // 1000 = 10%
    constructor(uint256 _feeBps) ERC20("FeeToken", "FEE") {
        feeBps = _feeBps;
        _mint(msg.sender, 1_000_000 ether);
    }
    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;
        if (fee > 0) super._transfer(from, address(0xdead), fee);
        super._transfer(from, to, net);
    }
}

/// Rebasing token: owner can shrink any account balance (downward rebase).
contract RebasingToken is ERC20 {
    constructor() ERC20("RebaseToken", "RBS") { _mint(msg.sender, 1_000_000 ether); }
    function adminBurn(address who, uint256 amount) external { _burn(who, amount); }
    function mintTo(address who, uint256 amount) external { _mint(who, amount); }
}

/// Token that can mint an arbitrarily huge supply (to exceed uint96).
contract HugeToken is ERC20 {
    constructor() ERC20("HugeToken", "HUGE") {}
    function mintTo(address who, uint256 amount) external { _mint(who, amount); }
}

/// Zero-decimals token.
contract ZeroDecimalsToken is ERC20 {
    constructor() ERC20("ZeroDec", "ZDC") { _mint(msg.sender, 1_000_000); }
    function decimals() public pure override returns (uint8) { return 0; }
}

/// decimals() reverts — exercises _tryGetDecimals catch (defaults to 18).
contract RevertingDecimalsToken is ERC20 {
    constructor() ERC20("RevDec", "RVD") { _mint(msg.sender, 1_000_000 ether); }
    function decimals() public pure override returns (uint8) { revert("no decimals"); }
}

/// USDT-style: transfer / transferFrom return NOTHING. SafeERC20 must cope.
contract NoReturnToken {
    string public name = "NoReturn"; string public symbol = "NRT"; uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor() { totalSupply = 1_000_000 ether; balanceOf[msg.sender] = totalSupply; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external { balanceOf[msg.sender] -= a; balanceOf[to] += a; }
    function transferFrom(address f, address to, uint256 a) external {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a;
    }
}

/// Reentrant token: on transfer OUT from the locker it re-enters once. The reentrant
/// call must revert (nonReentrant); we swallow it so the outer call completes, then the
/// test asserts no double-spend and records that the guard fired.
contract ReentrantToken is ERC20 {
    address public locker;
    uint256 public attackLockId;
    uint256 public attackVestingId;
    bool public attackWithdraw;
    bool public attackClaim;
    bool private entered;
    bool public reentrancyReverted;

    constructor() ERC20("Reentrant", "REE") { _mint(msg.sender, 1_000_000 ether); }
    function arm(address _locker, uint256 _lockId, uint256 _vestId, bool _w, bool _c) external {
        locker = _locker; attackLockId = _lockId; attackVestingId = _vestId;
        attackWithdraw = _w; attackClaim = _c;
    }
    function _transfer(address from, address to, uint256 amount) internal override {
        super._transfer(from, to, amount);
        if (!entered && from == locker) {
            entered = true;
            if (attackWithdraw) {
                try ILocker(locker).withdrawLock(attackLockId) {} catch { reentrancyReverted = true; }
            }
            if (attackClaim) {
                try ILocker(locker).claimVesting(attackVestingId) {} catch { reentrancyReverted = true; }
            }
            entered = false;
        }
    }
}

/// Rejects ETH — used (a) as feeReceiver to prove locks brick, and (b) as a caller that
/// sends excess ETH and rejects the refund, to hit the refund-revert branch.
contract RejectsEth {
    function armAndLock(address _locker, address token, uint256 amount, uint256 unlock) external payable {
        IERC20Min(token).approve(_locker, amount);
        ILocker(_locker).lockToken{value: msg.value}(token, amount, unlock);
    }
    receive() external payable { revert("no eth"); }
}
