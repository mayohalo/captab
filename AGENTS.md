# AGENTS.md: guide for coding agents and AI judges

Captab keeps a company's cap table (who owns what) in a NEAR smart contract governed by a Sputnik DAO board. It covers founding, vesting grants, priced investor rounds, secondary sales, buybacks, exact payouts, and closing at exit. It runs on NEAR testnet. Units are on-chain ledger records, not legal shares or tokens.

- Live app: https://captab.xyz (read-only for visitors; serves the schema v2 company)
- Plain-text summary: [`llms.txt`](llms.txt) (also served at https://captab.xyz/llms.txt)
- Human overview: [`README.md`](README.md); every claim mapped to code, tests, and transactions: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

## Verify in this order

All commands run from the repository root. None needs keys, accounts, or funds, and none writes to any chain except a local Sandbox.

| # | Command | Needs | Time | Expected result |
| --- | --- | --- | --- | --- |
| 1 | `node apps/web/scripts/verify-evidence.mjs` | Node 18+ only, no install | < 1 min | Every line `PASS`; last line `All checks passed: 16 DAO proposals, 3 deals, 5 holders.`; exit code 0 |
| 2 | `pnpm install` | Node 22.23+, pnpm 10.16.1 (`corepack enable`) | ~1 min | Installs the workspace |
| 3 | `pnpm test:contract` | Rust 1.88.0 + `wasm32-unknown-unknown` (pinned in `rust-toolchain.toml`) | < 1 min | `test result: ok. 74 passed` |
| 4 | `pnpm demo:sandbox` | as above; downloads a NEAR Sandbox binary | ~5 min first run | Lines `[1/6]` to `[6/6]`, then `Lifecycle complete…` and `test result: ok. 1 passed` |
| 5 | `pnpm test:sandbox` | as above | a few min | `test result: ok. 9 passed` |
| 6 | `pnpm --filter @captab/web exec playwright install chromium && pnpm test:e2e` | Chromium | ~1 min | `26 passed` |
| 7 | `pnpm --filter @captab/web build` | Node | ~1 min | A successful Next.js production build |

CI runs 3, 5, 6, 7, the web unit suites, and a worker-restart test on every push: https://github.com/mayohalo/captab/actions/workflows/ci.yml

Notes for reproducing:
- Step 1 reads public NEAR testnet RPC (`https://rpc.testnet.fastnear.com` by default; set `NEAR_RPC_URL` to use another, e.g. `https://near-testnet.drpc.org`). It retries on rate limits.
- Rust embeds build paths and host-specific layout in WASM, so rebuilding on another machine gives different bytes from the deployed macOS (arm64) build. Step 1 checks the deployed code hashes on chain instead. `scripts/build-sputnik.sh` builds Sputnik from its pinned commit and, if the bytes differ, takes the pinned WASM from the live testnet DAO, accepted only if its SHA-256 matches.
- `pnpm verify:testnet` is the deployer's release check; it needs the deployer's private settings file and is not expected to run for judges.

## Feature → code → test → live evidence

| Feature | Code | Tests | Live testnet evidence |
| --- | --- | --- | --- |
| Board (2-of-3 Sputnik DAO) is the only caller that can change the ledger | `assert_dao` in [`lib.rs`](contracts/company/src/lib.rs) | `non_dao_cannot_issue`; Sandbox `real_sputnik_requires_two_votes_and_funds_company` | `verify-evidence`: DAO policy and 16 executed proposals |
| Charter, founder units with document SHA-256 | [`ledger.rs`](contracts/company/src/ledger.rs) | `authorized_capacity_can_rise`, `authorized_capacity_never_falls`, `doc_hashes_are_validated_recorded_and_bound_to_the_action` | proposals #1–#3 |
| Vesting grants: any cliff, 1–120 months, founder vesting, signed terms, acceleration | [`grants.rs`](contracts/company/src/grants.rs) | `custom_schedule_and_cliff_vest_on_their_own_months`, `founder_vesting_draws_from_unallocated_and_returns_there_on_cancel`, `recipient_accepts_grant_terms_matching_the_board_document`, `acceleration_counts_extra_months_and_crosses_the_cliff` | proposals #5–#7; accept and claim transactions in [`docs/testnet-v2-rehearsal.json`](docs/testnet-v2-rehearsal.json) |
| Zero-NEAR claim (NEP-366 delegate action + relayer) | [`apps/web/lib/sponsor-policy.ts`](apps/web/lib/sponsor-policy.ts), `claim_vested` | Sandbox `zero_balance_contributor_claims_through_signed_delegate`; `pnpm test:sponsor` | v1 [`docs/testnet-browser-rehearsal.json`](docs/testnet-browser-rehearsal.json) |
| Priced round; investor pays and is issued units in one receipt, or is refunded | [`deals.rs`](contracts/company/src/deals.rs), `ft_on_transfer` in `lib.rs` | `investor_issuance_reserves_capacity_settles_on_payment_and_forwards_to_the_dao`, `issuance_price_must_match_the_round` | deal #0 Settled; refund transactions in the rehearsal JSON |
| Secondary sale: board approval + seller signature, retryable proceeds | `deals.rs` | `secondary_sale_needs_the_sellers_signature_then_moves_units_and_pays_the_seller`, `a_seller_cannot_commit_the_same_units_twice`, `stale_forward_callback_cannot_settle_a_newer_attempt` | deal #1 Settled, proceeds delivered by retry |
| Buyback paid by the DAO, units retired | `deals.rs` | `buyback_is_paid_by_the_dao_and_retires_units` | deal #2 Settled |
| Pro-rata payouts: exact sum, funded once, paid once, retry-safe | [`distributions.rs`](contracts/company/src/distributions.rs) | `snapshot_rounds_exactly_and_survives_later_issuance`, `only_exact_dao_token_funding_is_accepted_once`, `failed_payment_releases_reservation_and_retry_pays_once`, `failed_callback_after_successful_transfer_never_unlocks_payment` | v1 [`docs/testnet-rehearsal.json`](docs/testnet-rehearsal.json) |
| Explicit payout list (exit waterfall) | `distributions.rs` | `explicit_distribution_pays_board_set_amounts_to_stakeholders`, `explicit_payouts_must_sum_to_the_budget` | distribution #0 fully paid |
| Corrections, lost-wallet reassignment, close | `ledger.rs` | `retire_units_reduces_issued_and_drops_an_emptied_holder`, `reassign_moves_units_and_open_grants_but_not_finished_ones`, `close_after_settling_obligations`, `a_closed_company_cannot_issue` | close: Sandbox only (`pnpm demo:sandbox` step 6) |
| Cap table export with revision and SHA-256 | [`apps/web/lib/cap-table-export.ts`](apps/web/lib/cap-table-export.ts) | `pnpm test:planning`; browser tests | `https://captab.xyz/api/companies/captab-company-0d07df99e1bb0e44.testnet/export?format=csv` |
| Round model and exit waterfall (planning, browser-side) | [`round-model.ts`](apps/web/lib/round-model.ts), [`waterfall.ts`](apps/web/lib/waterfall.ts) | `pnpm test:planning`; browser tests | ownership and distributions pages |

Unit tests: [`contracts/company/src/tests.rs`](contracts/company/src/tests.rs) (v1, 28) and [`tests_v2.rs`](contracts/company/src/tests_v2.rs) (v2, 46). Sandbox tests: [`contracts/company/tests/sandbox.rs`](contracts/company/tests/sandbox.rs) (9).

## Repository map

| Path | What it is |
| --- | --- |
| `contracts/company/src/` | The company contract: `lib.rs` (state, views, token routing), `ledger.rs`, `grants.rs`, `distributions.rs`, `deals.rs` |
| `contracts/test-token/` | NEP-141 TESTUSD fixture |
| `apps/web/app/` | Next.js pages and API routes; `page.tsx` is the landing page |
| `apps/web/lib/` | Chain reads (`near.ts`), proposal builders, audit, export, planning models, payments worker logic |
| `apps/web/scripts/` | Deploy, verify, rehearse, and `verify-evidence.mjs` |
| `docs/` | Evidence, runbook, operations, manifests, rehearsal records |

## What is not implemented

Legal shares, an IPO itself, SAFEs, convertible notes, options with an exercise price, investor KYC, confidential amounts, and wallet-visible share tokens are not implemented (tokens are designed in [`docs/TOKENIZATION_PLAN.md`](docs/TOKENIZATION_PLAN.md)). `close_company` is proven in Sandbox, not on the live company. Signing with third-party wallet extensions has not been verified; testnet signing used local test keys.
