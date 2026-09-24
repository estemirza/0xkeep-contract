# 0xKeep — Liquidity Locker & Linear Vesting (V12)

Immutable, non-custodial ERC-20 locker and linear-vesting contract. No owner, no admin, no pause, no proxy. Fees and fee receiver are fixed at deployment.

App: https://app.0x-keep.xyz · Site: https://0x-keep.xyz · Security page: https://0x-keep.xyz/security.html

## Deployments

| Chain | Chain ID | Address | Lock fee | Vesting fee |
|---|---|---|---|---|
| Base (used by app) | 8453 | `0x048d1326B3b0531A5d043984F4e495285B07af4B` | 0 | 0 |
| Arbitrum One | 42161 | `0xDC9bFb15C28486590Cbf58F3FEA9ADbEB9B0334c` | 0.03 ETH | 0.02 ETH |
| Optimism | 10 | `0x1Ecf87D69c4a5c8D10ffb7D73e8ABB415043f866` | 0.03 ETH | 0.02 ETH |

Also on Base, not used by the app: `0x49bF4Ded143402B2fD89d8d284e477Dfdc9fa02B` (original 0.03 / 0.02 deployment) and `0x6D729a7bda1E9Da1c8e74351fd8C242316381Efd` (identical 0-fee copy, deployed twice by mistake).

Source is verified on Sourcify (`https://repo.sourcify.dev/<chainId>/<address>`). Fee receiver on all chains: `0x28B8cafb1c95E375E349283D63919039eB17c229`.

## Audit status

Not audited by a third-party firm. The contract has had an internal review (no critical/high/medium/low findings, two informational notes) and is covered by the test suite below. An internal review is not an independent audit.

## Tests

```shell
npm install
npx hardhat test
```

| File | What it covers |
|---|---|
| `test/LockTest.ts` | Deployment, lock and vesting happy paths, validations, extend/transfer/withdraw, cliff logic, view functions |
| `test/EdgeCaseTest.ts` | Array integrity across many locks, ownership transfer chains, fee handling, vesting precision, multi-user isolation, uint96 guard, 1-day minimum |
| `test/AdversarialEdgeTest.ts` | Fee-on-transfer, rebasing, uint96/uint32 boundaries, vesting dust, reentrancy, non-standard ERC20s, fee-receiver liveness, refund failure |
| `test/GrowthInstanceTest.ts` | The same contract deployed with zero fees |

## Known limitations

- **Rebasing tokens:** a negative rebase inside the contract makes that lock's withdrawal revert. Don't lock rebasing tokens.
- **Fee receiver:** if the receiver ever rejected ETH, new locks/vestings would revert. Withdrawals and claims don't depend on it.
- **Immutable:** a bug can't be patched, only redeployed.

## Deploying

- `scripts/deploy_mainnet.ts`: original 0.03 / 0.02 deployment.
- `scripts/deploy_growth.ts`: low/zero-fee instance. Prints a dry summary and deploys only with `CONFIRM_DEPLOY=yes`. Writes `deployments/<network>-growth.json` and never overwrites an existing record.

## License

MIT
