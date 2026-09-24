# 0xKeep — integration kit for security scanners

For teams that flag whether a token's liquidity is locked (GoPlus, DEX Screener, DEXTools, De.Fi, Token Sniffer and similar). Everything below is public and read-only.

## What 0xKeep is

An immutable, non-custodial locker for ERC-20 tokens, including Uniswap v2-style and Aerodrome classic LP tokens, plus linear token vesting with an optional cliff.

- No owner, no admin role, no pause, no proxy, no upgrade path. Only the lock owner can withdraw, and only after `unlockTime`.
- It does not lock Uniswap v3/v4 NFT positions.
- Source verified on Sourcify. Not audited by a third party; internal review plus 91 public tests: https://0x-keep.xyz/security.html

## Contracts (version V12, same bytecode on every chain)

| Chain | Chain ID | Locker address | Fee (lock / vesting) |
|---|---|---|---|
| Base | 8453 | `0x048d1326B3b0531A5d043984F4e495285B07af4B` | 0 / 0 ETH |
| Arbitrum One | 42161 | `0xDC9bFb15C28486590Cbf58F3FEA9ADbEB9B0334c` | 0.03 / 0.02 ETH |
| Optimism | 10 | `0x1Ecf87D69c4a5c8D10ffb7D73e8ABB415043f866` | 0.03 / 0.02 ETH |

Unused instances on Base (no app traffic, same code): `0x49bF4Ded143402B2fD89d8d284e477Dfdc9fa02B`, `0x6D729a7bda1E9Da1c8e74351fd8C242316381Efd`. Safe to include if your list is address-based.

ABI: https://0x-keep.xyz/abi/ZeroXKeepLocker.json

## Option A — one HTTP call (easiest)

```
GET https://app.0x-keep.xyz/api/token/{chainId}/{tokenAddress}
```

Returns every active lock and vesting schedule for that token, the share of total supply locked, and a block already in your `lp_holders[].locked_detail` shape:

```json
"goplus": {
  "address": "0x048d1326B3b0531A5d043984F4e495285B07af4B",
  "is_locked": 1,
  "locked_detail": [
    { "amount": "1234.5", "end_time": "2027-01-01T00:00:00.000Z", "opt_time": "2026-09-25T10:00:00.000Z" }
  ]
}
```

No key needed, open CORS, cached ~30 s at the edge. Single lock: `GET /api/lock/0xK-BL-0`; single vesting: `GET /api/vesting/0xK-BV-0`.

## Option B — read the chain directly

Holder check: if an LP token's holder is one of the addresses above, that balance is held by 0xKeep. Use the per-lock detail below to see how much of it is still time-locked (locks past their unlock time but not yet withdrawn are still held, but no longer locked).

**Events**

```
Locked(uint256 indexed lockId, address indexed token, address indexed owner,
       uint256 amount, uint256 unlockTime, uint256 chainId)
LockExtended(uint256 indexed lockId, uint256 newUnlockTime)          // only ever later
LockTransferred(uint256 indexed lockId, address indexed oldOwner, address indexed newOwner)
LockWithdrawn(uint256 indexed lockId, address indexed token, address indexed owner, uint256 amount)
VestingCreated(uint256 indexed vestingId, address indexed token, address indexed owner,
               uint256 amount, uint256 cliff, uint256 duration, uint256 chainId)
VestingClaimed(uint256 indexed vestingId, address indexed token, address indexed owner, uint256 amount)
VestingTransferred(uint256 indexed vestingId, address indexed oldOwner, address indexed newOwner)
VestingCompleted(uint256 indexed vestingId, address indexed owner)
```

Filter `Locked` by the `token` topic to get lock IDs and lock time (`opt_time` = block timestamp).

**Current state**

```
allLocksCount() → uint256
locks(uint256 id) → (address token, uint96 amount, address owner, uint8 decimals,
                     bool withdrawn, uint32 unlockTime, uint256 id)
allVestingsCount() → uint256
vestings(uint256 id) → (address token, uint96 totalAmount, address owner, uint8 decimals,
                        uint96 claimedAmount, uint32 startTime, uint32 cliffDuration,
                        uint32 duration, uint256 id)
```

A lock counts as locked when `withdrawn == false` and `block.timestamp < unlockTime`. `amount` is the amount actually received (fee-on-transfer tokens are recorded net). Vesting releases linearly from `startTime + cliffDuration` over `duration`; locked remainder = `totalAmount − claimedAmount − vested`.

## Guarantees you can rely on

- `unlockTime` can only move later (`extendLock` requires a strictly later time). New locks are capped at 100 years; extensions are capped by uint32 (year 2106).
- No function lets anyone except the owner move a locked balance, and not before `unlockTime`.
- No admin, pause or upgrade path exists, so these rules cannot change after deployment.

## Contact

Mirza (founder) · X: https://x.com/0xkeep_official · GitHub: https://github.com/estemirza/0xkeep-contract · Site: https://0x-keep.xyz
