# Evidence

Everything Captab claims is implemented and working, and you can check each claim yourself. This page lists how.

## Check it yourself

| What you check | Command | Needs | Time |
| --- | --- | --- | --- |
| The deployed company, DAO, and token run the code hashes the manifest pins; the board is the pinned 2-of-3 council and policy; and the live company matches the recorded rehearsal: 16 DAO proposals executed, 3 deals settled with proceeds delivered, the payout list fully paid, totals, holdings, and treasury exact | `node apps/web/scripts/verify-evidence.mjs` | Node 22, nothing installed | under 1 min |
| The whole lifecycle on a local NEAR chain with real Sputnik DAO votes and token transfers: charter, founder units, seed round with a refunded wrong payment, secondary sale with a retried payout, buyback, exit payout list, close | `pnpm demo:sandbox` | Node, pnpm, Rust 1.88 | ~5 min first run, 30 s after |
| Contract rules: supply invariants, vesting, replay safety, deals, payouts, close | `pnpm test:contract` | Rust | under 1 min |
| Every Sandbox scenario, including a zero-NEAR sponsored claim, a failed-then-retried payout, a lost callback that stays locked, and storage at the limits | `pnpm test:sandbox` | Rust | a few minutes |
| Every app screen against deterministic chain views | `pnpm test:e2e` | Chromium via Playwright | under 1 min |
| The deployer's full release check: also access keys, token supply, storage funding, and the local WASM build | `CAPTAB_DEPLOYMENT=v2 pnpm verify:testnet` | the deployer's private settings file and the original build host | under 1 min |

Sample `verify-evidence` output (2026-11-14):

```text
Deployed code and board (docs/deployment-manifest.v2.testnet.json)
  PASS  company contract code hash Dhq9ZUxtKVibFyA4CwcmoZVdT5xxVSWfvRAVgdRTWwEd  sha256 bcc1ea8771f8e685…
  PASS  Sputnik DAO code hash CB5QxzaBMy3kArDdQJPX3sEsXSeNdfLW4vx9qMn6uCgq  sha256 a6055ab340bb5b99…, source commit 5434a59
  PASS  full DAO policy unchanged since deployment  a proposal passes with more than 1/2 of the council (2 of 3)
Board actions (Sputnik DAO proposals)
  PASS  # 1 charter-and-founders/amend: Raise authorized units to 12,000,000  Approved  https://testnet.nearblocks.io/txns/JBCCbv...
  ...
  PASS  #15 explicit-payout/funding: Fund the payout list exactly  Approved
Ownership ledger
  PASS  issued_total = 7140000  live 7140000
  PASS  holdings sum to issued units  7140000
Rounds and deals
  PASS  deal #0 Issue: 1000000 units for 10000000000 base units  Settled, pending 0
  PASS  deal #1 Secondary: 100000 units for 1500000000 base units  Settled, pending 0
  PASS  deal #2 Buyback: 5000 units for 60000000 base units  Settled, pending 0
Payouts
  PASS  every recipient paid exactly once; paid total equals the budget  2000000000/2000000000
  PASS  DAO treasury holds 72940000000 TESTUSD base units  live 72940000000
All checks passed: 16 DAO proposals, 3 deals, 5 holders.
```

**About rebuilding the WASM yourself.** Rust embeds absolute build paths and host-specific code layout in a WASM file, so the same source built on another OS or CPU produces different bytes from the deployed macOS (arm64) build. The code hashes above are therefore checked against the chain, not against your rebuild. For the Sandbox tests, `scripts/build-sputnik.sh` builds Sputnik from its pinned commit and, if the bytes differ, takes the pinned WASM from the live testnet DAO and accepts it only if its SHA-256 matches. Docker-based reproducible builds (`cargo near build reproducible-wasm`) are the planned fix.

CI ([workflow](../.github/workflows/ci.yml)) runs the web tests, a production build, the worker restart test, the browser tests, the Rust tests, and the Sandbox lifecycle on every push.

## Live lifecycle on testnet (schema v2)

Schema v2 extends the ledger from founding and hiring to raising money, secondary sales, buybacks, and exit. It is tested locally, on NEAR Sandbox, and live on testnet as a second deployment beside the v1 MVP ([accounts](#live-on-testnet)). The app reads both.

The live rehearsal (`pnpm rehearse:v2`, [evidence](testnet-v2-rehearsal.json), [manifest](deployment-manifest.v2.testnet.json)) ran every board action through two-of-three Sputnik votes:

| Step on testnet | Transactions |
| --- | --- |
| Charter amendment to 12,000,000 units with a document hash | [proposal 1](https://testnet.nearblocks.io/txns/JBCCbvP4YtmZFAmhcAxHaiPXC5Jy3W2iP9oW9pxzdVSn) |
| Contributor accepts the grant document, then claims 25,000 units at the cliff | [accept](https://testnet.nearblocks.io/txns/CE4y23r3fiRcM81FrCk9eDgpQadM6i8BWxKNHxyrMEba), [claim](https://testnet.nearblocks.io/txns/FyFBrAFfkQz1DLPTS9JQR5AsTVEf13Ecm5Q2FHZecmdf) |
| Founder vesting from unallocated capacity, accelerated 12 months, claimed; pool reduced | DAO proposals 6, 7, 8 |
| Seed round: a wrong amount and a wrong payer are refunded; the investor's exact 10,000 TESTUSD issues 1,000,000 units and reaches the DAO | [refund: amount](https://testnet.nearblocks.io/txns/38fDEUrTUDA2jeHMUvqrnv4JSqJs4XsYnwyhjFTrsYNE), [refund: payer](https://testnet.nearblocks.io/txns/GzNAauqwev72UhRjmWAyJkwvujWAB4jysaBGQudoCmQb), [payment](https://testnet.nearblocks.io/txns/DGY7VapS6G9b8XCzaT8y3LnMpXbb1mUpRUVydX184Jmd) |
| Secondary sale: seller signs, buyer pays, proceeds held for the unregistered seller, then delivered by a public retry | [accept](https://testnet.nearblocks.io/txns/FKfosRrYSo94ao94dWxDhRhaqqbtstYmH8hyu6HEEqSd), [payment](https://testnet.nearblocks.io/txns/9gBWG3pbnz2yfSNwrZ6vZDN4QnDRjdgT2sv62aFYCGE9), [retry](https://testnet.nearblocks.io/txns/EGuQtscaKtLKcaEb1qiByeQGdG7ajRxJDNcJFpmB5KY6) |
| Buyback: contributor signs, the DAO pays through a proposal, 5,000 units retired | [accept](https://testnet.nearblocks.io/txns/7JuZfuvezp9AwLAeWZMr9rf7PDRxgSDSdbDp5PfP1XTo), [DAO payment](https://testnet.nearblocks.io/txns/EtXZJ5Egqj8mZqKZb3NoWmBvrdsci6gK6sT7v6apj9oj) |
| Board-set payout list of 2,000 TESTUSD, funded exactly and paid to five holders | [funding](https://testnet.nearblocks.io/txns/HVefYMr38JD72oebKw7gCR7BFb8vaTx61ThZ8Y9GQqCf), [first payment](https://testnet.nearblocks.io/txns/9SZVkKe9RKhe8wMHF3j4v4c1djzucKBP1MREwCsg6cCb) |

Afterwards the ledger holds 7,140,000 issued units across five holders, the DAO treasury is exactly 72,940 TESTUSD, the app's audit reports **Consistent**, and `CAPTAB_DEPLOYMENT=v2 pnpm verify:testnet` passes. Closing the company is proven in Sandbox only, so the testnet company stays usable as a demo.

| Capability | Contract method | How it works |
|---|---|---|
| Document fingerprints | `doc_hash` on every board action | A SHA-256 of the governing document (charter amendment, grant agreement, purchase agreement) is part of the action's replay digest and its event |
| Charter amendment | `increase_authorized` | Raises authorized units; they can never be lowered |
| Pool management | `decrease_pool` | Returns unused pool units to unallocated capacity |
| Flexible vesting | `create_grant` with `terms` | 1 to 120 monthly boundaries, any cliff (including none), and reservation from the pool or from unallocated capacity (founder vesting) |
| Acceleration | `accelerate_grant` | The board counts extra completed months, for example on an acquisition |
| Grant acceptance | `accept_grant` | The recipient signs the grant document's hash on chain |
| Investor rounds | `create_round`, `close_round` | A round records its price per unit (the valuation trail), units issued, and amount raised |
| Investor issuance, paid atomically | `approve_deal` (`Issue`) + `ft_transfer_call` | The board reserves units for a named investor at the round price. The investor pays with the settlement token, units are issued in the same receipt, and the money is forwarded to the DAO treasury. A wrong amount, payer, or an expired deal is refunded by the token |
| Secondary sales | `approve_deal` (`Secondary`), `accept_deal` | The board approves; the seller signs to lock their units; the buyer pays; units move and the seller is paid. No unit moves without both the board and the holder |
| Buybacks and tender offers | `approve_deal` (`Buyback`) | The seller accepts, the DAO pays through a proposal, and the units are retired |
| Payout delivery | `forward_proceeds` | If a recipient is not registered with the token, the payment is held and anyone can retry; a lost callback stays locked for review |
| Explicit payout lists | `prepare_explicit_distribution` | The board sets exact amounts per stakeholder (an exit waterfall with liquidation preferences), then funds them with the existing exact-funding and per-recipient payment machinery |
| Corrections | `retire_units` | Board-approved retirement of unlocked units |
| Lost wallets | `reassign_holding` | Moves a holding and its open grants to a new account; blocked while the old account has an unpaid payout or an open deal |
| Close after exit | `close_company` | Final state once every distribution is paid or cancelled and every deal is settled or cancelled. Nothing can reopen it |
| Room to grow | limits | 100 holders, 200 grants, 50 distributions, 200 deals, 20 rounds; governance actions are no longer capped, so resume always works. Payout rows live in their own map, so a payment no longer rewrites the whole table |

The app gains a **Deals** page (rounds, deal states, seller acceptance, buyer payment, payout retry), twelve new board actions under Approvals, an "accept grant terms" button, payout lines from the exit preview for an explicit payout proposal, and v2-aware audit, export, and event parsing.

**Evidence:** 74 Rust unit tests (46 for v2, in [`tests_v2.rs`](../contracts/company/src/tests_v2.rs)). Sandbox `v2_round_secondary_buyback_explicit_payout_and_close_through_real_sputnik` runs a charter amendment, a seed round with a refunded wrong payment and a paid allocation, a secondary sale whose unregistered seller is paid by a later retry, a DAO-paid buyback, an explicit exit payout, and the close, all through two-of-three Sputnik votes. The stress test fills every v2 limit: a 100-holder snapshot burns 35.8 Tgas and state grows by 1.14 MB ([measurements](STORAGE_LIMITS.md)). The pro-rata schedule hash is unchanged from v1, and the explicit-list hash is checked against the TypeScript implementation. Contract code is split into [`ledger.rs`](../contracts/company/src/ledger.rs), [`grants.rs`](../contracts/company/src/grants.rs), [`distributions.rs`](../contracts/company/src/distributions.rs), and [`deals.rs`](../contracts/company/src/deals.rs).


## Guarantees, the code that enforces them, and the proof

Each guarantee links to the code that enforces it, the tests that prove it, and, where it applies, a final testnet transaction.

| Claim | Code | Local proof | Testnet proof |
| --- | --- | --- | --- |
| Only the DAO can change ownership | [`assert_dao`](../contracts/company/src/lib.rs#L267) | `non_dao_cannot_issue` | Proposals [6](https://testnet.nearblocks.io/txns/6ekVUH6L7vbsWH4aeSjdG99RCbgKjB8W3hbPLQfdCU7v) and [7](https://testnet.nearblocks.io/txns/CpkKMtFCpVVYGrHAnc1bbApbrPJdUYvQnKtJw1SaMYJU) (pause/resume), each executed after [two](https://testnet.nearblocks.io/txns/9F1KBfKMoMLu7uj86uyG4T7ZD98fcPVbrdHsuQ3GBXJV) [votes](https://testnet.nearblocks.io/txns/GL8m4DFKDoFvBMqVyNUVXkbJXsquUMUSWq5FLCa4giXK) |
| A council majority is required (2 of 3 on testnet) | [`assessDaoPolicy`](../apps/web/lib/dao-policy.ts) | Sandbox `real_sputnik_requires_two_votes_and_funds_company`; `pnpm test:dao` | Same as above |
| Replayed or repurposed actions cannot double-issue | [`was_processed`](../contracts/company/src/lib.rs#L313) | `identical_replay_is_idempotent_even_after_revision_changes`, `action_id_cannot_be_repurposed`, `stale_revision_rejected` | — |
| Supply invariants hold across every operation | [`unallocated`](../contracts/company/src/lib.rs#L292) | `mixed_ledger_operations_preserve_accounting_after_every_step`, `cannot_exceed_authorized_supply` | `pnpm verify:testnet` audits the live ledger |
| Vesting: cliff, monthly steps, cancellation | [`vested_at`](../contracts/company/src/grants.rs#L232) | `grant_reservation_cliff_claim_and_full_vesting`, `cancellation_releases_only_unvested_units`, `another_account_cannot_claim` | — |
| Contributor with zero NEAR claims via sponsored relay | [`claim_vested`](../contracts/company/src/grants.rs#L194), [`apps/web/lib/sponsor-policy.ts`](../apps/web/lib/sponsor-policy.ts) | Sandbox `zero_balance_contributor_claims_through_signed_delegate`; `pnpm test:sponsor` | Grant [proposal 8](https://testnet.nearblocks.io/txns/AHUbthZ5ZtauqMet2GTaQynoYp6xJUwdi2t712ub8GCZ) → [sponsored claim](https://testnet.nearblocks.io/txns/AAeXAhfrj6k76LiCSMDSwCA8f2kpMzAoRhqAZYiKz7Hh) |
| Payouts sum exactly to the budget, and later issuance cannot change them | [`prepare_distribution`](../contracts/company/src/distributions.rs#L116) | `snapshot_rounds_exactly_and_survives_later_issuance`, `distribution_hash_matches_typescript_vector` | 10,000.000000 TESTUSD paid as 5,975.103734 + 3,983.402490 + 41.493776 ([evidence](testnet-rehearsal.json)) |
| Funding is accepted only for the exact approved budget, from the DAO, once | [`ft_on_transfer`](../contracts/company/src/lib.rs#L240), [`fund_distribution`](../contracts/company/src/distributions.rs) | `only_exact_dao_token_funding_is_accepted_once`, `approval_rejects_modified_hash` | Distribution 0 funded, zero escrow left |
| A failed payment can be retried and never pays twice | [`pay_recipient`](../contracts/company/src/distributions.rs#L237), [`on_payment_result`](../contracts/company/src/distributions.rs#L265) | `failed_payment_releases_reservation_and_retry_pays_once`, `in_flight_attempt_blocks_duplicate_transfer`, `stale_payment_callback_cannot_settle_current_attempt`; Sandbox `seeded_demo_lifecycle_settles_exact_amounts_after_retry` | Contributor [attempt 1 failed](https://testnet.nearblocks.io/txns/3LaFRfpVNhoz2mMwFQ24ysNd8eeS8L7BBg7otP2s6ewf) (unregistered) → [attempt 2 paid](https://testnet.nearblocks.io/txns/59XfZEHbBXtFVNWPHQcQSFyQ7DSC4Lm4fgaJuHwPAiQy); founders [A](https://testnet.nearblocks.io/txns/DFj77QurbryvmF47k9EVAS1KWzMyi1JAQq4CH3nWsvYv), [B](https://testnet.nearblocks.io/txns/35NBSJHu9ZapVAkh3MfvEFoCR3Rn3oZzZk5X3i4Cqegj) |
| A lost callback stays locked instead of risking a double payment | [`on_payment_result`](../contracts/company/src/distributions.rs#L265) | `failed_callback_after_successful_transfer_never_unlocks_payment`; Sandbox `successful_token_transfer_with_failed_callback_stays_locked` (fault-injection build) | — |
| Pause stops new actions; in-flight callbacks still settle | [`set_paused`](../contracts/company/src/ledger.rs#L7) | `pause_rejects_new_funding_but_preserves_in_flight_callback_settlement`, `pause_blocks_new_payment_attempts` | Proposals 6 and 7 |
| Storage stays bounded at demo limits | [constants](../contracts/company/src/lib.rs#L24) | Sandbox `bounded_storage_still_allows_payment_callback_at_demo_limits` ([measurements](STORAGE_LIMITS.md)) | Storage preflight in the manifest |
| Worker crash or restart cannot cause a duplicate payout | [`apps/web/lib/payments.ts`](../apps/web/lib/payments.ts) | `pnpm test:payments`, `pnpm test:worker-restart` | — |

Testnet transaction hashes come from the [payout rehearsal](testnet-rehearsal.json) and the [browser rehearsal](testnet-browser-rehearsal.json). Unit test names are in [`tests.rs`](../contracts/company/src/tests.rs) and [`tests_v2.rs`](../contracts/company/src/tests_v2.rs); Sandbox tests are in [`contracts/company/tests/sandbox.rs`](../contracts/company/tests/sandbox.rs).


## Records

| File | What it records |
| --- | --- |
| [deployment-manifest.v2.testnet.json](deployment-manifest.v2.testnet.json) | v2 accounts, code hashes, DAO policy, token supply, storage funding |
| [testnet-v2-rehearsal.json](testnet-v2-rehearsal.json) | Every v2 transaction hash, proposal ID, and the final on-chain state |
| [deployment-manifest.testnet.json](deployment-manifest.testnet.json) | v1 accounts and hashes (code at tag `v1-testnet`) |
| [testnet-rehearsal.json](testnet-rehearsal.json) | v1 payout rehearsal, including a failed-then-retried payment |
| [testnet-browser-rehearsal.json](testnet-browser-rehearsal.json) | v1 browser-signed DAO proposals, votes, and the zero-NEAR sponsored claim |
| [STORAGE_LIMITS.md](STORAGE_LIMITS.md) | Storage and gas measured at every limit |
| [RELEASE_STATUS.md](RELEASE_STATUS.md) | Each release gate and its status |
