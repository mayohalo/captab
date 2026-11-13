# Company contract storage limits

## Schema v2

The NEAR Sandbox stress test `bounded_storage_still_allows_payment_callback_at_demo_limits` fills one company with 100 holders, 200 grants (each with 49 monthly vesting boundaries), and 50 pro-rata distributions of 100 rows each, then records more than 350 governance actions. It rejects the next holder, grant, and distribution, pauses and resumes after the old 200-action limit, reads the last page of distributions, and confirms that funding and a payout callback still settle at those limits.

Measured company account storage usage with the v2 release WASM (681,003 bytes, SHA-256 `bcc1ea8771f8e685c34691c9e4b6e04b78aefa01dd39428cc9844e257a926256`):

| State | Storage bytes | Added since deployment |
| --- | ---: | ---: |
| Deployed contract, before initialization | 681,185 | 0 |
| Initialized and 100 holders | 713,612 | 32,427 |
| 200 grants | 858,684 | 177,499 |
| All holder, grant, and distribution limits filled | 1,822,766 | 1,141,581 |

The most expensive 100-holder snapshot burned 35.8 Tgas. The test asserts that state growth stays below 3,000,000 bytes and that a snapshot stays below 150 Tgas. Deals and rounds are not filled by this test; `pnpm deploy:testnet` adds a 108,419-byte allowance for 200 deals and 20 rounds on top of the measured 1,141,581 bytes, plus the usual 100,000-byte buffer and 1 NEAR for fees. At 10^19 yoctoNEAR per byte, a v2 company at its limits needs roughly 21 NEAR of storage staking.

## Schema v1 (deployed testnet demo)

The same test against the v1 release WASM filled 20 holders, 100 grants, 20 distributions, and 200 privileged action IDs:

| State | Storage bytes | Added since deployment |
| --- | ---: | ---: |
| Deployed contract, before initialization | 404,158 | 0 |
| Initialized and 20 holders | 408,383 | 4,225 |
| 100 grants | 480,655 | 76,497 |
| All demo object/action limits filled | 518,478 | 114,320 |

These are measurements for the pinned contracts and test data, not a promise that future revisions or account-ID lengths have the same footprint. Re-run `pnpm test:sandbox` after contract changes and fund the company account with enough NEAR for its actual storage plus transaction headroom.
