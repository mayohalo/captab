# Testnet demo runbook

This runbook deploys the testnet ownership prototype. All ownership units and TESTUSD balances are fictional. Use new testnet accounts and keep deployment keys in `apps/web/.env.local`, which Git ignores. Never paste keys into a proposal, issue, or deployment manifest.

## 1. Build and verify locally

Install Node 22.23+, pnpm 10.16.1, Rust 1.88.0, and the `wasm32-unknown-unknown` target. From the repository root:

```sh
pnpm install
pnpm test:contract
pnpm test:auth
pnpm test:dao
pnpm test:planning
pnpm test:health
pnpm test:hash
pnpm test:sponsor
pnpm test:payments
pnpm test:receipts
pnpm test:vesting
pnpm test:deployment
pnpm test:network
pnpm test:observation
pnpm test:release
pnpm test:e2e
pnpm test:sandbox
pnpm --dir apps/web build
pnpm test:worker-restart
```

Install Chromium once with `pnpm --filter @captab/web exec playwright install chromium` before `pnpm test:e2e`. Browser tests use fixture contract views and a development-only wallet adapter to inspect proposal, vote, claim, and snapshot requests; they do not produce cryptographic signatures or submit to testnet. The Sandbox suite builds a pinned Sputnik DAO and both local contracts, then exercises two-vote governance, funding, payout failure/retry, a zero-balance sponsored claim, and the complete seeded demo amounts on a real local chain. It also builds a separate, test-only company WASM that deliberately fails a callback after a successful token transfer; the normal release WASM is built separately, and deployment checks reject the fault-injection artifact. A local key-removal case exercises the same signing helper as `pnpm freeze:company --apply` on a disposable Sandbox account and confirms the contract remains readable afterward. The seeded demo test leaves the contributor unregistered for the first payout, registers them, and verifies the second attempt pays the exact remaining amount once. After the production web build, `pnpm test:worker-restart` starts the fixture RPC, production server, and one-pass reconciliation worker, restarts the server and worker against the same SQLite database, and confirms a stale claim remains in review while another payment stays queued. Stop if any check fails. `scripts/build-sputnik.sh` verifies the exact Sputnik WASM SHA-256 before deployment.

## 2. Prepare accounts and local configuration

Create and fund separate testnet accounts for three council members, the DAO, company, token, snapshot operator, payout executor, and sponsor relayer. The company, DAO, and token accounts must be pre-created with full-access deployment keys. The three council keys stay in member wallets. The DAO holds the initial TESTUSD supply; the company needs enough NEAR for contract storage and token registration. The executor and relayer need enough NEAR for transaction fees.

For a fresh, separate set of testnet-only accounts, run `pnpm accounts:testnet --init` once. It generates keys and writes `apps/web/.env.local` plus `apps/web/.data/testnet-accounts.json` with owner-only permissions; both paths are ignored by Git. The root account funds the operator, executor, relayer, council, and demo-recipient subaccounts. The company, DAO, and token each use their own faucet-funded account because contract storage needs several NEAR. Provision them in this order:

```sh
pnpm accounts:testnet --faucet-root
pnpm accounts:testnet --faucet-role dao
pnpm accounts:testnet --faucet-role company
pnpm accounts:testnet --faucet-role token
pnpm accounts:testnet --create-subaccounts
pnpm accounts:testnet --fund-council
pnpm accounts:testnet --verify
```

The provisioner checks each account before a write and verifies public keys and finalized balances afterward. If a command reports an uncertain transaction, inspect its hash and rerun only after checking the on-chain account; the creation and council-funding commands skip already completed work. Back up the ignored key bundle securely. Import the three council keys into separate testnet wallet profiles for browser signing; the provisioner creates the on-chain accounts but cannot import keys into a user's wallet session. Never send a private key in chat or commit either local file.

Alternatively, create and fund accounts manually, then copy `apps/web/.env.example` to `apps/web/.env.local`. Set the actual account IDs and keys, `CAPTAB_COUNCIL_ACCOUNTS`, and `CAPTAB_AUTH_ORIGIN` to the browser's exact origin. Set `CAPTAB_WORKER_SECRET` to a random value. `CAPTAB_TOKEN_SUPPLY` is in six-decimal token base units; the sample `100000000000` is 100,000 TESTUSD. `CAPTAB_AUTHORIZED_UNITS=10000000` matches the demo cap. Deployment scripts load `.env.local` without printing secrets. The default RPC is FastNear testnet because the former public NEAR endpoint returned a deprecation error during this release.

### Deployment profiles (a second deployment beside the first)

Every deployment script reads `CAPTAB_DEPLOYMENT`. Unset, it uses the original files (`apps/web/.env.local`, `apps/web/.data/testnet-accounts.json`, `docs/deployment-manifest.testnet.json`), which belong to the live schema v1 demo. `CAPTAB_DEPLOYMENT=v2` uses `apps/web/.env.v2.local`, `apps/web/.data/testnet-accounts.v2.json`, and `docs/deployment-manifest.v2.testnet.json`, so a v2 deployment never reads or overwrites the v1 keys or manifest. Prefix each command in this runbook with the profile, for example `CAPTAB_DEPLOYMENT=v2 pnpm accounts:testnet --init`. The v2 bundle adds investor and angel accounts. A v2 company at its full limits needs about 21.3 NEAR of storage staking, more than one faucet account provides; the deploy preflight prints the shortfall. After deploying, `CAPTAB_DEPLOYMENT=v2 pnpm verify:testnet` checks the v2 release, and `pnpm rehearse:v2` runs the live v2 rehearsal (round, secondary sale, buyback, explicit payout) and writes `docs/testnet-v2-rehearsal.json`. To run the app against v2, export the variables from `.env.v2.local` before `next start`; process environment values take precedence over `.env.local`.

## 3. Bootstrap the DAO, token, and company

Run each read-only preflight and review the printed account IDs, code hashes, council, token metadata, and action. The company preflight also prints the current account balance and a conservative storage funding estimate based on the live protocol storage price, the release WASM, measured demo state growth, a 100,000-byte buffer, and 1 NEAR of transaction headroom. Fund any printed shortfall before `--apply`; the script refuses deployment writes when the company account is underfunded. Each command refuses a non-testnet RPC endpoint or incompatible code already on an account.

```sh
pnpm bootstrap:dao
pnpm bootstrap:token
pnpm deploy:testnet
```

When the preflight is correct, apply in dependency order:

```sh
pnpm bootstrap:dao --apply
pnpm bootstrap:token --apply
pnpm deploy:testnet --apply
```

The first command deploys and initializes pinned Sputnik with exactly three council accounts and a two-vote policy. The second deploys the six-decimal TESTUSD fixture with its initial supply assigned to the DAO. The third deploys and initializes the company, registers it with TESTUSD, and writes `docs/deployment-manifest.testnet.json`. It verifies the company schema built from this tree (version 2 on `main`: 100 holders, 200 grants, 50 distributions, 200 deals, 20 rounds, no action cap) and records the limits in the manifest. The live v1 demo was deployed with schema 1 (20 holders, 100 grants, 20 distributions, 200 actions). The preflights also check the complete TESTUSD supply in base units; the release manifest freezes that supply. Each command checks existing code and initialization before writing, so a repeat run verifies the same deployment rather than replacing code. If a transaction fails or its result is uncertain, inspect the chain transaction and code/config views before rerunning.

After deployment, copy `company.codeHash` from the manifest into `CAPTAB_COMPANY_CODE_HASH` in `apps/web/.env.local` and restart the app and worker. This is the on-chain NEAR code hash, not the hexadecimal SHA-256. The app leaves ledger views readable but disables proposals, claims, sponsorship, and payment execution until the deployed company code matches this value. The deployment script checks any configured value against its local WASM before writing.

After issuance, `pnpm deploy:testnet --apply` can reverify an already initialized, token-registered company without its deployment key. It preserves the deployment and initialization transaction hashes already recorded in the manifest while refreshing the on-chain code, configuration, access-key list, and verification time. A key is still required if deployment, initialization, or token storage registration remains unfinished.

Open `/setup?company=<company-account>` and confirm the DAO, operator, token, code hash, initial totals, and the pinned-Sputnik verification message with the council approval rule (2 of 3 for the demo DAO). The app refuses governance and council-only private-data access if the DAO code differs, if any role besides the council can vote on proposals, or if fewer than a majority of the council can approve. Set `NEXT_PUBLIC_COMPANY_CONTRACT_ID` to the deployed company account, then start the app and worker in separate terminals:

```sh
pnpm --filter @captab/web dev
pnpm --filter @captab/web reconcile:worker
```

The worker and SQLite database require a persistent single-host process. Keep `.data/captab.sqlite` and its WAL files together during backups. Do not run two independent app instances against separate databases: payment-job serialization depends on one shared database.

## 4. Seed and rehearse the demo

Use the company page's typed governance controls; each DAO action is a real proposal requiring two of three council votes. The member who proposes pays the proposal bond. Follow this sequence and verify each receipt before the next action:

1. Issue 3,600,000 units to founder A and 2,400,000 to founder B. Confirm `issued_total=6000000`.
2. Increase the contributor pool by 2,000,000. Confirm `pool_available=2000000` and `unallocated_units=2000000`.
3. Create a 100,000-unit contributor grant with 49 anchored UTC month boundaries and a 12-month cliff. For an immediate rehearsal, use a historical start date; for a live vesting demonstration, wait until the cliff. The app previews the schedule.
4. At the cliff, claim 25,000 units from `/me` using either the contributor wallet or a supported delegated-action wallet with the sponsor relayer. Confirm `issued_total=6025000`, `pool_available=1900000`, `grant_reserved=75000`, and `fully_diluted_total=8000000`.
5. The operator prepares a distribution with budget `10000000000` token base units (10,000.000000 TESTUSD) and a future UTC expiry. Review the frozen schedule and hash. The proposal API independently recomputes that hash before returning an approval or funding action. Council members approve the schedule through Sputnik, then approve the exact `ft_transfer_call` funding proposal from the DAO treasury.
6. Confirm `funded=true` and `available_escrow=10000000000`. A verified council member queues recipients on the company page. The worker submits one payout at a time and reconciles final receipts.
7. To demonstrate ordinary failure/retry, leave the contributor unregistered with TESTUSD for the first attempt, confirm that their entitlement becomes `Failed`, register the contributor with TESTUSD, and queue the remaining failed recipient again. Confirm `Paid` once, no duplicate payment, and zero remaining escrow.

The final expected amounts are 5,975.103734 TESTUSD for founder A, 3,983.402490 for founder B, and 41.493776 for the contributor. Confirm these against on-chain entitlements and `ft_balance_of`, not only the activity page. The activity page currently includes app-submitted transactions; external activity may be absent.

The local-key testnet rehearsal can be repeated stage by stage against the configured accounts: `pnpm rehearse:testnet --seed-equity`, `--grant-claim`, `--snapshot-fund`, `--payment-prep`, `--retry-contributor`, then `--verify-payouts`. Between the payment-prep and retry stages, run `pnpm --filter @captab/web reconcile:worker --once` until the first contributor attempt is `Failed` and both founders are `Settled`; after retry, run it until the contributor is `Settled`. Start the built web server before `--payment-prep`. `--verify-payouts` compares chain balances and worker jobs and writes public receipt evidence to `docs/testnet-rehearsal.json`. This script signs with the test-only local key bundle.

For a browser-driven pass using those same accounts without importing keys into Chrome, run `CAPTAB_LIVE_TESTNET=1 pnpm test:live-browser`. It builds a temporary loopback-only test-wallet bundle, runs Playwright against the production server, signs DAO pause/resume actions and a contributor delegated claim in the local Node test process, then rebuilds the normal release bundle. The test is opt-in because it submits real testnet transactions and changes the demo ledger. The browser never receives private keys, but this bridge does not prove compatibility with a third-party wallet extension. [Public receipt evidence](testnet-browser-rehearsal.json) records the completed pass.

To halt new activity, use the approvals screen to submit a DAO **Pause company** proposal and obtain two council votes. Pause blocks new claims, snapshots, funding acceptance, and payout attempts but lets in-flight callbacks settle. The same screen offers **Resume company** while paused and **Cancel unfunded distribution** for an unused schedule; cancellation cannot withdraw a funded escrow. Verify the resulting contract state and receipts before resuming the demo.

## 5. Review and recovery

The contract is authoritative. Reconnect by reading `get_totals`, every page of `list_grants`, `list_distributions`, and each `get_distribution`; the SQLite states are observations. App contract views and deployment/release checks request finalized chain state. `GET /api/companies/<company-account>` compares all bounded holdings, grants, and payout states with on-chain totals and shows the last periodic worker audit. Retry an inconclusive audit after the ledger stops changing. Finalized `add_proposal` submissions are mapped to DAO proposal IDs and action IDs in the activity page; the worker checks their later DAO status and flags a changed payload, while execution still requires company receipt or state evidence. A payment job in `Submitted` waits for final receipt reconciliation. A worker claim left in `Claimed` for two minutes is marked `NeedsReview`, shown on the activity page, and continues blocking the queue. An in-flight entitlement after a final transaction or ambiguous submission also stays `NeedsReview`. Never reset or retry an uncertain payment by timeout. Record the transaction hash, final receipts, token balance, entitlement attempt ID, and callback outcome for investigation. There is intentionally no automatic repair method for a token transfer whose callback failed.

The sponsor relayer stores a digest before submission. A duplicate signed delegate cannot be relayed again by this API. A `NeedsReview` sponsor outcome requires inspecting the outer transaction and contributor holding before a new signed request is obtained. Never reuse the old signature to guess whether it succeeded.

The company contract has no upgrade method, but its deployment full-access key can redeploy code until removed. After the final rehearsal, run `pnpm verify:testnet` from the built workspace. This read-only command compares the manifest with local WASM hashes, on-chain code, the complete DAO policy, token metadata, total supply and storage registration, company configuration and supply, access keys, and storage funding. It exits nonzero on drift and does not need deployment keys. `pnpm deploy:testnet --apply` also refuses to refresh a manifest if the DAO policy or token supply has changed since the earlier record.

For the reviewed final freeze, run `pnpm freeze:company` as a read-only preflight. It verifies the release, compares the deployment key and complete access-key list with the manifest, and requires that the deployment key be the company's only full-access key. After reviewing that output and the live rehearsal, run `pnpm freeze:company --apply` with the company deployment key available locally. The command removes that key, confirms the finalized chain has no full-access keys, records its transaction hash and remaining keys, and runs `pnpm verify:testnet --require-frozen`. Key removal may make the company permanently unable to upgrade; do not run `--apply` before the final release decision. If deletion succeeds but the process stops before writing the manifest, inspect the successful final key-removal receipt, run `pnpm deploy:testnet --apply` to refresh the key list without a signing key, then record its transaction hash in `transactions.keyRemoval` and set `company.frozen` to `true` in the manifest. Run `pnpm verify:testnet --require-frozen` and stop if any check fails. Keep DAO member keys in wallets. A new contract version should use a new company account. Direct token deposits outside an approved distribution are not credited by the ownership ledger and may be stranded.

Anyone can re-check the live v2 deployment without keys or a Rust build: `node apps/web/scripts/verify-evidence.mjs` compares the deployed code hashes and DAO policy with the v2 manifest and the live ledger with `docs/testnet-v2-rehearsal.json`. `verify:testnet` additionally compares local WASM builds, which match the manifest only on the original build host because Rust embeds absolute paths.

`main` builds schema v2, so the default (v1) `pnpm verify:testnet` run from `main` reports that the local company WASM differs from the v1 manifest; every other v1 check still passes. To verify the v1 release in full, check out the `v1-testnet` tag (commit `e1b9b1c`), whose release build reproduces the manifest's company SHA-256 `56e0b348…e688`, run `pnpm build:contracts`, then `pnpm verify:testnet`. Verify the v2 deployment from `main` with `CAPTAB_DEPLOYMENT=v2 pnpm verify:testnet`.
