# Captab

**Your company's cap table on NEAR, from day zero to unicorn.**

Captab keeps a company's cap table, the record of who owns what, in a NEAR smart contract run by a DAO board. Founders split ownership, contributors vest and claim, investors pay and receive units in one transaction, early holders sell, holders get paid exactly once, and the books close at exit. Every step is live on NEAR testnet, and you can verify each one yourself.

[![CI](https://github.com/mayohalo/captab/actions/workflows/ci.yml/badge.svg)](https://github.com/mayohalo/captab/actions/workflows/ci.yml)

**[Live app: captab.xyz](https://captab.xyz)** · [Live company](https://captab.xyz/company/captab-company-0d07df99e1bb0e44.testnet) · [84-second demo video](docs/demo/captab-demo-84s.mp4) · [Evidence](docs/EVIDENCE.md) · [Summary for agents](https://captab.xyz/llms.txt)

[![Captab landing page](docs/demo/live-hero.png)](https://captab.xyz)

> NEAR testnet prototype. Ownership units are on-chain ledger records, not legal shares. TESTUSD is a demo token, and all holders are fictional.

## The problem

A cap table decides who gets paid when a company is sold, how much each new investor dilutes everyone else, and whether an employee's equity has vested. Most companies keep it in a spreadsheet or a paid platform. Board approvals arrive by email, investor money is reconciled by hand, payouts are a separate manual process, and every holder has to trust whoever keeps the file.

## What Captab does

| | |
| --- | --- |
| **The board votes on-chain** | The board is a two-of-three council on a [Sputnik DAO](https://github.com/near-daos/sputnik-dao-contract). Every issuance, grant, round, deal, and payout is a proposal it votes on, and the company contract accepts ledger changes only from the DAO. |
| **The rules are code** | Supply never exceeds what is authorized, vesting follows its schedule, an action cannot be replayed, and no unit moves without the holder's signature. |
| **Money moves with ownership** | An investor's payment issues their units in the same transaction, or it is refunded. Payouts sum exactly to the budget and pay each holder once, even when a transfer fails and is retried. |

### From day zero to exit

| Stage | What the company gets | Contract calls | See it live |
| --- | --- | --- | --- |
| **1. Found** | Authorized units, the founder split with its agreement's SHA-256, founder vesting | `increase_authorized`, `issue_founder_units`, `create_grant` | [charter proposal](https://testnet.nearblocks.io/txns/JBCCbvP4YtmZFAmhcAxHaiPXC5Jy3W2iP9oW9pxzdVSn) |
| **2. Hire** | A pool and grants with any cliff and 1–120 monthly steps; contributors sign the terms and claim with **zero NEAR** | `create_grant`, `accept_grant`, `claim_vested` | [accept](https://testnet.nearblocks.io/txns/CE4y23r3fiRcM81FrCk9eDgpQadM6i8BWxKNHxyrMEba), [claim](https://testnet.nearblocks.io/txns/FyFBrAFfkQz1DLPTS9JQR5AsTVEf13Ecm5Q2FHZecmdf); from Meteor Wallet: [accept](https://testnet.nearblocks.io/txns/GzpcBV1oLdp2suupsWdKYJEdB5bvb3oFMsk8ibxoKLWj), [claim](https://testnet.nearblocks.io/txns/z8Z4BK38ny7ttDScvrZBH2SxbabDiu2UXTeyzfV73md) |
| **3. Raise** | Priced rounds; each investor pays and receives units in one transaction, and the money lands in the DAO treasury | `create_round`, `approve_deal`, `ft_transfer_call` | [refund](https://testnet.nearblocks.io/txns/38fDEUrTUDA2jeHMUvqrnv4JSqJs4XsYnwyhjFTrsYNE), [payment](https://testnet.nearblocks.io/txns/DGY7VapS6G9b8XCzaT8y3LnMpXbb1mUpRUVydX184Jmd) |
| **4. Operate** | Board votes with replay protection, corrections, lost-wallet recovery, a CSV/JSON export carrying its SHA-256 | `retire_units`, `reassign_holding` | [export](https://captab.xyz/api/companies/captab-company-0d07df99e1bb0e44.testnet/export?format=csv) |
| **5. Liquidity** | Secondary sales and buybacks; a unit moves only with the board's approval and the holder's signature | `approve_deal`, `accept_deal`, `forward_proceeds` | [sale](https://testnet.nearblocks.io/txns/9gBWG3pbnz2yfSNwrZ6vZDN4QnDRjdgT2sv62aFYCGE9), [retry](https://testnet.nearblocks.io/txns/EGuQtscaKtLKcaEb1qiByeQGdG7ajRxJDNcJFpmB5KY6), [buyback](https://testnet.nearblocks.io/txns/EtXZJ5Egqj8mZqKZb3NoWmBvrdsci6gK6sT7v6apj9oj) |
| **6. Pay holders** | Distributions that sum to the budget exactly, funded once by the DAO, retry-safe per holder | `prepare_distribution`, `pay_recipient` | [v1 payout and retry](docs/testnet-rehearsal.json) |
| **7. Exit** | A preference waterfall paid as an explicit payout list, accelerated vesting, a closed ledger | `prepare_explicit_distribution`, `accelerate_grant`, `close_company` | [funding](https://testnet.nearblocks.io/txns/HVefYMr38JD72oebKw7gCR7BFb8vaTx61ThZ8Y9GQqCf), [payment](https://testnet.nearblocks.io/txns/9SZVkKe9RKhe8wMHF3j4v4c1djzucKBP1MREwCsg6cCb); close in [Sandbox](#3-run-the-whole-lifecycle-yourself-5-minutes) |

The app adds planning tools on top: a priced-round model (price per unit, new units, pool top-up, before and after), an exit waterfall with liquidation preferences whose rows become a payout-list proposal, and a cap table export.

## Try it

### 1. Click through the live app (1 minute, nothing to install)

| Do | See |
| --- | --- |
| Open [captab.xyz](https://captab.xyz) | What Captab is, the live cap table bar, and live figures: 7,145,000 units issued, 6 holders, 3 deals settled, contract and DAO "Verified" |
| Click **Explore the live company** | The stage tracker with Found, Hire, Raise, Liquidity, and Pay holders checked (Exit stays open), and the ownership bar split into issued, grants, pool, and unallocated units |
| Open **[Deals](https://captab.xyz/company/captab-company-0d07df99e1bb0e44.testnet/deals)** | The `seed` round at 1,000,000 units; deal #0 (issuance), #1 (secondary sale), and #2 (buyback), each **Settled** with "Payment … delivered" |
| Open **[Distributions](https://captab.xyz/company/captab-company-0d07df99e1bb0e44.testnet/distributions)** | Distribution #0, an explicit payout list of 2,000 TESTUSD (2,000,000,000 base units), **Funded**, with every recipient **Paid**; below it, the exit-waterfall planner |
| Open **[Approvals](https://captab.xyz/company/captab-company-0d07df99e1bb0e44.testnet/approvals)** | The board actions the app can propose, and the DAO's 17 proposals, all **Approved** |
| Open the **[CSV export](https://captab.xyz/api/companies/captab-company-0d07df99e1bb0e44.testnet/export?format=csv)** | Holdings and grants; the response headers `X-Captab-Ledger-Revision: 16` and `X-Captab-Export-SHA256` |
| Open any transaction link in the table above | The finalized transaction on NearBlocks testnet |

Board actions need a council wallet, so the live app is read-only for visitors. To watch every write happen, use option 3.

### 2. Verify the live chain yourself (1 minute, Node only)

```sh
git clone https://github.com/mayohalo/captab && cd captab
node apps/web/scripts/verify-evidence.mjs
```

This reads NEAR testnet directly. It checks that the deployed company, DAO, and token run the code hashes pinned in the [manifest](docs/deployment-manifest.v2.testnet.json), that the board is the pinned 2-of-3 council, that all 17 recorded DAO proposals executed, the 3 deals settled with proceeds delivered, the payout list was paid in full, and the totals, holdings, and DAO treasury match the recorded end state. It exits nonzero on any mismatch. [Sample output](docs/EVIDENCE.md#check-it-yourself).

### 3. Run the whole lifecycle yourself (5 minutes)

Requires Node 22.23+, pnpm 10.16.1, and Rust 1.88.0 with the `wasm32-unknown-unknown` target (pinned in `rust-toolchain.toml`).

```sh
pnpm install
pnpm demo:sandbox
```

This starts a local NEAR chain, deploys the pinned Sputnik DAO, the token, and the company, and runs the lifecycle through real two-of-three votes and token transfers:

```text
[1/6] Found: the board (2-of-3 Sputnik DAO) amends the charter and issues founder units with a document hash
[2/6] Raise: the board opens a seed round; a wrong payment is refunded, the exact one issues units and pays the DAO
[3/6] Secondary sale: the board approves, the seller locks units, the buyer pays, held proceeds are retried
[4/6] Buyback: the holder accepts, the DAO pays through a proposal, the units are retired
[5/6] Exit payout: the board sets an explicit payout list, funds it exactly, and every holder is paid once
[6/6] Close: with everything settled, the board closes the ledger; later calls are refused
Lifecycle complete: every step above ran on a local NEAR chain through real DAO votes and token transfers
```

### 4. Run all the tests

```sh
pnpm test:contract          # 74 Rust unit tests: supply invariants, vesting, replay safety, deals, payouts, close
pnpm test:sandbox           # 9 NEAR Sandbox tests: zero-NEAR sponsored claim, failed-then-retried payout, lost callback, storage at the limits, v2 lifecycle
pnpm --filter @captab/web exec playwright install chromium
pnpm test:e2e               # 26 browser tests: every screen against fixture chain views, including a schema v2 company
pnpm --filter @captab/web dev   # the app locally, against testnet (copy apps/web/.env.example to apps/web/.env.local first)
```

To deploy your own company, DAO, and token on testnet, follow the [runbook](docs/RUNBOOK.md).

## Proof

| | |
| --- | --- |
| **Live on testnet** | Company [`captab-company-0d07df99e1bb0e44.testnet`](https://testnet.nearblocks.io/address/captab-company-0d07df99e1bb0e44.testnet), board [`captab-dao-0d07df99e1bb0e44.testnet`](https://testnet.nearblocks.io/address/captab-dao-0d07df99e1bb0e44.testnet), token [`captab-token-0d07df99e1bb0e44.testnet`](https://testnet.nearblocks.io/address/captab-token-0d07df99e1bb0e44.testnet). 7,145,000 units across 6 holders, 17 executed DAO proposals, 3 settled deals, 72,940 TESTUSD in the treasury. |
| **Recorded** | Every transaction hash and the final state: [`testnet-v2-rehearsal.json`](docs/testnet-v2-rehearsal.json); code hashes and DAO policy: [`deployment-manifest.v2.testnet.json`](docs/deployment-manifest.v2.testnet.json). |
| **Re-checkable** | `node apps/web/scripts/verify-evidence.mjs` checks deployed code hashes, the DAO policy, and the live state against the records, with no keys and nothing installed. |
| **Real wallet** | Meteor Wallet (browser extension) on `captab.testnet` connected to captab.xyz, accepted a board grant's terms, claimed 5,000 vested units, and signed in with NEP-413: [grant proposal](https://testnet.nearblocks.io/txns/5W4rLwWWMEbSmNMJtaCasVUiozthaV235emLh6i1oxJW), [accept](https://testnet.nearblocks.io/txns/GzpcBV1oLdp2suupsWdKYJEdB5bvb3oFMsk8ibxoKLWj), [claim](https://testnet.nearblocks.io/txns/z8Z4BK38ny7ttDScvrZBH2SxbabDiu2UXTeyzfV73md). |
| **Tested** | 74 Rust unit tests, 9 NEAR Sandbox tests, 26 browser tests, 13 web test suites, all in CI. |
| **Earlier MVP** | Schema v1 ran browser-signed DAO votes, a zero-NEAR sponsored claim, and a failed-then-retried payout. See [From v1 to v2](#from-v1-to-v2). |

The [evidence page](docs/EVIDENCE.md) maps every guarantee to the code that enforces it, the tests that prove it, and the testnet transaction that shows it.

## From v1 to v2

Captab was built in two stages during the hackathon, and both are live on testnet.

| | v1: the MVP (Nov 1–4) | v2: the full lifecycle (Nov 13) |
| --- | --- | --- |
| Covers | Found, hire, pay holders | Found, hire, raise, operate, liquidity, pay holders, exit |
| Grants | Fixed 12-month cliff, 48 months, from the pool | 1–120 months, any cliff, from the pool or unallocated units (founder vesting); recipients sign the terms; acceleration |
| Investors and trading | None | Rounds; issuance, secondary-sale, and buyback deals settled atomically with `ft_transfer_call`; locked units; retryable proceeds |
| Payouts | Pro-rata snapshots | Pro-rata snapshots and board-set explicit payout lists (exit waterfalls) |
| Ledger actions | Issue, pool, grant, cancel, pause | Adds charter amendment, pool reduction, retirement, lost-wallet reassignment, close, and a document SHA-256 on every board action |
| Limits | 20 holders, 100 grants, 20 distributions, 200 actions (pause counted, so a company paused at 200 could never resume) | 100 holders, 200 grants, 50 distributions, 200 deals, 20 rounds, no action cap |
| Code | One `lib.rs` | [`ledger`](contracts/company/src/ledger.rs), [`grants`](contracts/company/src/grants.rs), [`distributions`](contracts/company/src/distributions.rs), [`deals`](contracts/company/src/deals.rs) modules |
| Tests | 28 Rust unit tests | 74 (46 new) |
| Testnet company | [`captab-company-101e85b169dd3522.testnet`](https://testnet.nearblocks.io/address/captab-company-101e85b169dd3522.testnet) | [`captab-company-0d07df99e1bb0e44.testnet`](https://testnet.nearblocks.io/address/captab-company-0d07df99e1bb0e44.testnet) |

**Why a new deployment instead of an upgrade.** The contract has no self-upgrade method, by design, and v2 changes the stored state layout. So v2 runs on fresh accounts with its own DAO and token, and v1 stays live and untouched as a record. The v1 code is tag [`v1-testnet`](https://github.com/mayohalo/captab/tree/v1-testnet); the full change is [`v1-testnet...main`](https://github.com/mayohalo/captab/compare/v1-testnet...main). The hosted app serves v2. Moving a live company between versions is designed in the [tokenization plan](docs/TOKENIZATION_PLAN.md): pause, export at a finalized block, import once, and reconcile.

## Transparent where it matters, private where it should be

| Public and verifiable | Private | Fingerprinted only |
| --- | --- | --- |
| Units per account, grants and vesting, rounds and prices, deals, payouts, and every board vote, on NEAR | The names and emails behind account IDs stay off-chain. Council members see them after a wallet-signed sign-in (NEP-413); every other holder sees only their own. | The charter and grant and purchase agreements stay with the company. Only their SHA-256 goes on chain, so anyone holding a copy can prove it is the approved version. |

Honest limit: amounts are public today; only identities are private. Confidential balances are on the roadmap.

## Ownership ledger today, share tokens next

Real equity cannot trade freely: transfers need the company's consent and the holder's. So Captab starts with an on-chain ledger that enforces those rules, then adds tokens on top.

1. **Built: on-chain ownership ledger.** Issuance, vesting, priced rounds, secondary sales, buybacks, and payouts, each approved by the board and signed by the holder.
2. **Next: restricted share tokens.** One NEP-141 token per share class, visible in wallets, with a transfer guard that enforces the same approvals. The ledger migrates once, from a hashed export ([design](docs/TOKENIZATION_PLAN.md)).
3. **Later: legal shares.** Legal wrappers that make on-chain units the company's source of truth, with confidential amounts.

## How it is built

```mermaid
flowchart LR
  APP[Captab app<br/>Next.js] -->|proposals, votes| DAO[Board<br/>Sputnik DAO 2-of-3]
  DAO -->|only caller| CO[Company contract<br/>ownership ledger, Rust]
  H[Holders<br/>founders, contributors,<br/>investors, buyers] -->|accept terms, claim, accept deals| CO
  H -->|ft_transfer_call: pay for units| FT[Settlement token<br/>NEP-141 TESTUSD]
  FT -->|ft_on_transfer| CO
  CO -->|payouts, proceeds| FT
  H -->|signed zero-NEAR claim| W[Worker and relayer]
  W -->|relay claims, pay out, observe receipts| CO
```

| NEAR primitive | How Captab uses it |
| --- | --- |
| [Sputnik DAO](https://github.com/near-daos/sputnik-dao-contract) (pinned commit `5434a59`, WASM hash verified) | The board. The company contract trusts only the DAO as the immediate caller for ledger changes. |
| [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md) `ft_transfer_call` | Investors and buyers pay for deals, and the DAO funds payouts, in single transfers. Units move in the same receipt, or the token refunds the payment. |
| Promises and callbacks | Each payout is its own transfer with a private callback. A failed transfer can be retried; a lost callback stays locked rather than risking a double payment. |
| [NEP-366](https://github.com/near/NEPs/blob/master/neps/nep-0366.md) meta-transactions | A contributor with zero NEAR signs a `claim_vested` delegate action; a scoped relayer pays the gas. |
| [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) signed messages | Wallet sign-in for private profiles. |
| NEP-297 events | Every ledger change emits a versioned `captable` event. |

| Path | Contents |
| --- | --- |
| [`contracts/company`](contracts/company/src) | The company contract (near-sdk 5.17): [`ledger`](contracts/company/src/ledger.rs), [`grants`](contracts/company/src/grants.rs), [`distributions`](contracts/company/src/distributions.rs), [`deals`](contracts/company/src/deals.rs), with unit and Sandbox tests |
| [`contracts/test-token`](contracts/test-token) | The NEP-141 TESTUSD fixture |
| [`apps/web`](apps/web) | The Next.js app, API routes (proposals, export, sponsor, auth, payouts), the worker, and deploy and verify scripts |
| [`docs`](docs) | [Evidence](docs/EVIDENCE.md), [runbook](docs/RUNBOOK.md), [operations](docs/OPERATIONS.md), [release status](docs/RELEASE_STATUS.md), [storage limits](docs/STORAGE_LIMITS.md), [tokenization plan](docs/TOKENIZATION_PLAN.md), [demo media](docs/demo/README.md) |

## Who it helps

- **Founders anywhere.** An auditable cap table with built-in payouts from one deployable contract, without paying for equity software or waiting on local legal infrastructure.
- **Contributors and employees.** Vesting they can verify themselves, claims that cost them nothing, and a path to cash through board-approved secondary sales.
- **Investors.** A valuation trail for every round and settlement in the same transaction, so there is nothing to reconcile.
- **DAOs, open-source projects, and co-ops.** Equity-like units for contributors, governed by the community's own council and enforced by code.

## What comes next

| | |
| --- | --- |
| **Next** | Sign the deal flows and the sponsored claim from third-party wallets · restricted share tokens per class, migrated from the ledger · one-click company deployment through a factory contract · a history indexer |
| **Future** | Confidential amounts · stock options with an exercise price, SAFEs, and convertible notes · AI agents as operators or council members, held to the same DAO rules as people · legal wrappers |

## Honest limits

- **Testnet prototype.** Units are on-chain records, not legal shares, and TESTUSD is a demo token. An IPO itself happens off-chain: Captab hands the transfer agent or acquirer a verifiable export, pays the proceeds, and closes the ledger.
- **Close is proven in Sandbox.** `close_company` runs in `pnpm demo:sandbox`; the live company stays open as a demo.
- **Wallets.** A third-party browser wallet, Meteor Wallet on `captab.testnet`, signed `accept_grant`, `claim_vested`, and an NEP-413 sign-in on captab.xyz ([accept](https://testnet.nearblocks.io/txns/GzpcBV1oLdp2suupsWdKYJEdB5bvb3oFMsk8ibxoKLWj), [claim](https://testnet.nearblocks.io/txns/z8Z4BK38ny7ttDScvrZBH2SxbabDiu2UXTeyzfV73md)). The other live actions were signed with local test keys; the sponsored zero-NEAR claim and the deal flows have not yet been signed from a third-party wallet.
- **History.** The activity page covers transactions submitted through the app; contract views are always the source of truth.
- **Lost callbacks.** If a token transfer succeeds but its callback fails, the payment stays locked for review, by design; there is no timeout reset.
- **Upgrades.** The contract has no self-upgrade method, and the deployer key is deliberately kept. Key removal is implemented (`pnpm freeze:company`) and proven in Sandbox. A production deployment would give upgrade authority to the DAO.

## Hackathon notes

- **Built at NEAR HACKATHON**, entirely within the event window: the first commit is 2026-11-01 and there is no earlier code. v1 was built Nov 1–4; v2, the hosted app, and the docs Nov 13–14.
- **Libraries.** Contract: `near-sdk` 5.17.2; tests: `near-workspaces` 0.22.1. Board: [Sputnik DAO](https://github.com/near-daos/sputnik-dao-contract) v2 at commit `5434a59`, unmodified. App: Next.js 15, React 19, `near-api-js` 7, `@hot-labs/near-connect`, `better-sqlite3`, `borsh`; browser tests with Playwright. No templates.
- **AI assistance.** Much of the code and documentation was written with AI coding assistants (Claude Code and OpenAI Codex) under the author's direction and review.
- **License:** [MIT](LICENSE).

More: [release status](docs/RELEASE_STATUS.md) · [operations](docs/OPERATIONS.md) · [implementation plan](IMPLEMENTATION_PLAN.md)
