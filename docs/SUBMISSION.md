# Captab: your company's cap table on NEAR, from day zero to unicorn

**Live app:** [captab.xyz](https://captab.xyz) · **Source:** [github.com/mayohalo/captab](https://github.com/mayohalo/captab) · **For agents:** [captab.xyz/llms.txt](https://captab.xyz/llms.txt) · **Video:** [84-second demo](demo/captab-demo-84s.mp4)

## One line

Captab keeps a company's cap table, the record of who owns what, in a NEAR smart contract run by a DAO board, so founders, employees, and investors can verify their own stake, and money moves in the same transaction as the ownership it pays for.

## Why it matters

A cap table decides who gets paid at an exit, how much each investor dilutes everyone else, and whether an employee's equity has vested. Today it lives in spreadsheets and paid platforms, approvals arrive by email, investor money and payouts are reconciled by hand, and every holder trusts whoever keeps the file. Captab replaces the file with a contract: the board votes on-chain, the rules are code, and payments and ownership move together.

## What is built and working

Every stage of a company's life runs on NEAR testnet today:

1. **Found:** the charter, the founder split with its agreement's SHA-256, founder vesting.
2. **Hire:** a pool and vesting grants with any cliff; contributors sign their terms on-chain and claim with zero NEAR through a sponsored relayer.
3. **Raise:** priced rounds; each investor's payment issues their units in the same transaction or is refunded, and the money lands in the DAO treasury.
4. **Operate:** replay-safe board votes, corrections, lost-wallet recovery, a cap table export carrying its SHA-256.
5. **Liquidity:** secondary sales and buybacks; a unit moves only with the board's approval and the holder's signature.
6. **Pay holders:** payouts that sum exactly to the budget and pay each holder once, retry-safe.
7. **Exit:** a preference waterfall paid as an explicit payout list, accelerated vesting, and a closed ledger.

The live company [`captab-company-0d07df99e1bb0e44.testnet`](https://testnet.nearblocks.io/address/captab-company-0d07df99e1bb0e44.testnet) holds 7,145,000 units across 6 holders after 17 executed DAO proposals, a seed round, a secondary sale, a buyback, and a payout list paid to every holder. An earlier MVP deployment proved browser-signed DAO votes, a zero-NEAR sponsored claim, and a failed-then-retried payout.

## Check it yourself

| Time | Command | What it proves |
| --- | --- | --- |
| 1 minute, nothing to install | Open [captab.xyz](https://captab.xyz) | The live cap table, deals, payouts, and board actions, read from chain |
| 1 minute, Node only | `node apps/web/scripts/verify-evidence.mjs` | All 17 recorded DAO proposals executed, 3 deals settled, the payout list fully paid, totals and treasury exact |
| 5 minutes, Node and Rust | `pnpm install && pnpm demo:sandbox` | The whole lifecycle on a local NEAR chain through real DAO votes and token transfers, including close |
| A few minutes | `pnpm test:contract`, `pnpm test:sandbox`, `pnpm test:e2e` | 74 Rust, 9 Sandbox, and 26 browser tests |

The [evidence page](EVIDENCE.md) maps every guarantee to the code that enforces it, the tests that prove it, and the testnet transaction that shows it.

## How it uses NEAR

A pinned Sputnik DAO is the board and the only caller allowed to change the ledger. NEP-141 `ft_transfer_call` settles investor and buyer payments atomically with the units. Promises and callbacks make payouts retry-safe without double payment. NEP-366 meta-transactions let contributors claim with zero NEAR. NEP-413 signed messages gate private profiles. NEP-297 events record every ledger change.

## Transparency and privacy

Holdings, grants, rounds, deals, payouts, and votes are public and verifiable. The names and emails behind accounts stay off-chain behind wallet sign-in. Agreements stay with the company; only their SHA-256 goes on chain. Amounts are public today; confidential balances are on the roadmap.

## What comes next

Restricted share tokens per class, migrated once from the ledger ([design](TOKENIZATION_PLAN.md)); one-click company deployment through a factory contract; third-party wallet signing for the deal flows; confidential amounts; options, SAFEs, and convertible notes; and AI agents as operators or council members, held to the same DAO rules as people.

## Who it helps

Founders anywhere who need an auditable cap table with built-in payouts and no equity-software bill; contributors who can verify their own vesting and reach liquidity; investors who settle with nothing to reconcile; and DAOs, open-source projects, and co-ops that want equity-like units governed by their own council.

## Honest limits

NEAR testnet only, with fictional holders and a demo token; units are ledger records, not legal shares. Closing a company is proven in NEAR Sandbox, not on the live company. A third-party wallet (Meteor Wallet) signed a grant acceptance, a claim, and an NEP-413 sign-in on captab.xyz ([accept](https://testnet.nearblocks.io/txns/GzpcBV1oLdp2suupsWdKYJEdB5bvb3oFMsk8ibxoKLWj), [claim](https://testnet.nearblocks.io/txns/z8Z4BK38ny7ttDScvrZBH2SxbabDiu2UXTeyzfV73md)); the other live actions used local test keys. The activity history covers app-submitted transactions; contract views are the source of truth. This repository contains no private keys or local database files.
