# Company contract demo storage limit

The NEAR Sandbox stress test `bounded_storage_still_allows_payment_callback_at_demo_limits` fills one company with 20 holders, 100 grants (each with all 49 monthly vesting boundaries), 20 distribution snapshots, and 200 privileged action IDs. It rejects the next holder, grant, distribution, and action. At those limits, it funds an approved distribution and confirms that a token payment callback settles a recipient without leaving an in-flight amount.

Measured company account storage usage with the release WASM on the local Sandbox:

| State | Storage bytes | Added since deployment |
| --- | ---: | ---: |
| Deployed contract, before initialization | 403,108 | 0 |
| Initialized and 20 holders | 407,333 | 4,225 |
| 100 grants | 479,605 | 76,497 |
| All demo object/action limits filled | 517,428 | 114,320 |

The final 517,428 bytes includes contract code and state. The stress test asserts that state growth stays below 1,000,000 bytes and, more importantly, executes funding and the payout callback after all four object/action limits have been reached. This is a measurement for the pinned contracts and test data, not a promise that all future contract revisions or account-ID lengths have the same footprint. Re-run `pnpm test:sandbox` after contract changes and fund the company account with enough NEAR to cover its actual storage on the target network plus transaction headroom.
