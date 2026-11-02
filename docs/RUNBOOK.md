# Testnet demo runbook

This runbook deploys the testnet ownership prototype. All ownership units and TESTUSD balances are fictional. Use new testnet accounts and keep deployment keys in `apps/web/.env.local`, which Git ignores. Never paste keys into a proposal, issue, or deployment manifest.

## 1. Build and verify locally

Install Node 22.23+, pnpm 10.16.1, Rust 1.88.0, and the `wasm32-unknown-unknown` target. From the repository root:

```sh
pnpm install
pnpm test:contract
pnpm test:auth
pnpm test:dao
pnpm test:health
pnpm test:hash
pnpm test:sponsor
pnpm test:payments
pnpm test:receipts
pnpm test:vesting
pnpm test:e2e
pnpm test:sandbox
pnpm --dir apps/web build
```

Install Chromium once with `pnpm --filter @captab/web exec playwright install chromium` before `pnpm test:e2e`. Browser tests use fixture contract views and a development-only wallet adapter to inspect proposal, vote, claim, and snapshot requests; they do not produce cryptographic signatures or submit to testnet. The Sandbox suite builds a pinned Sputnik DAO and both local contracts, then exercises two-vote governance, funding, payout failure/retry, a zero-balance sponsored claim, and the complete seeded demo amounts on a real local chain. The seeded demo test leaves the contributor unregistered for the first payout, registers them, and verifies the second attempt pays the exact remaining amount once. Stop if any check fails. `scripts/build-sputnik.sh` verifies the exact Sputnik WASM SHA-256 before deployment.

## 2. Prepare accounts and local configuration

Create and fund separate testnet accounts for three council members, the DAO, company, token, snapshot operator, payout executor, and sponsor relayer. The company, DAO, and token accounts must be pre-created with full-access deployment keys. The three council keys stay in member wallets. The DAO holds the initial TESTUSD supply; the company needs enough NEAR for contract storage and token registration. The executor and relayer need enough NEAR for transaction fees.

Copy `apps/web/.env.example` to `apps/web/.env.local`. Set the actual account IDs and keys, `CAPTAB_COUNCIL_ACCOUNTS`, and `CAPTAB_AUTH_ORIGIN` to the browser's exact origin. Set `CAPTAB_WORKER_SECRET` to a random value. `CAPTAB_TOKEN_SUPPLY` is in six-decimal token base units; the sample `100000000000` is 100,000 TESTUSD. `CAPTAB_AUTHORIZED_UNITS=10000000` matches the demo cap. Deployment scripts load `.env.local` without printing secrets.

## 3. Bootstrap the DAO, token, and company

Run each read-only preflight and review the printed account IDs, code hashes, council, token metadata, and action. Each command refuses a non-testnet RPC endpoint or incompatible code already on an account.

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

The first command deploys and initializes pinned Sputnik with exactly three council accounts and a two-vote policy. The second deploys the six-decimal TESTUSD fixture with its initial supply assigned to the DAO. The third deploys and initializes the company, registers it with TESTUSD, and writes `docs/deployment-manifest.testnet.json`. It verifies company schema version 1 and the 20-holder, 100-grant, 20-distribution, 200-action, 49-boundary limits and records them in the manifest. Each command checks existing code and initialization before writing, so a repeat run verifies the same deployment rather than replacing code. If a transaction fails or its result is uncertain, inspect the chain transaction and code/config views before rerunning.

After deployment, copy `company.codeHash` from the manifest into `CAPTAB_COMPANY_CODE_HASH` in `apps/web/.env.local` and restart the app and worker. This is the on-chain NEAR code hash, not the hexadecimal SHA-256. The app leaves ledger views readable but disables proposals, claims, sponsorship, and payment execution until the deployed company code matches this value. The deployment script checks any configured value against its local WASM before writing.

After issuance, `pnpm deploy:testnet --apply` can reverify an already initialized, token-registered company without its deployment key. It preserves the deployment and initialization transaction hashes already recorded in the manifest while refreshing the on-chain code, configuration, access-key list, and verification time. A key is still required if deployment, initialization, or token storage registration remains unfinished.

Open `/setup?company=<company-account>` and confirm the DAO, operator, token, code hash, initial totals, and the explicit pinned-Sputnik two-of-three verification message. The app refuses governance and council-only private-data access if the DAO code or policy differs. Set `NEXT_PUBLIC_COMPANY_CONTRACT_ID` to the deployed company account, then start the app and worker in separate terminals:

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

To halt new activity, use the approvals screen to submit a DAO **Pause company** proposal and obtain two council votes. Pause blocks new claims, snapshots, funding acceptance, and payout attempts but lets in-flight callbacks settle. The same screen offers **Resume company** while paused and **Cancel unfunded distribution** for an unused schedule; cancellation cannot withdraw a funded escrow. Verify the resulting contract state and receipts before resuming the demo.

## 5. Review and recovery

The contract is authoritative. Reconnect by reading `get_totals`, every page of `list_grants`, `list_distributions`, and each `get_distribution`; the SQLite states are observations. `GET /api/companies/<company-account>` compares all bounded holdings, grants, and payout states with on-chain totals and shows the last periodic worker audit. Retry an inconclusive audit after the ledger stops changing. Finalized `add_proposal` submissions are mapped to DAO proposal IDs and action IDs in the activity page; the worker checks their later DAO status and flags a changed payload, while execution still requires company receipt or state evidence. A payment job in `Submitted` waits for final receipt reconciliation. A worker claim left in `Claimed` for two minutes is marked `NeedsReview`, shown on the activity page, and continues blocking the queue. An in-flight entitlement after a final transaction or ambiguous submission also stays `NeedsReview`. Never reset or retry an uncertain payment by timeout. Record the transaction hash, final receipts, token balance, entitlement attempt ID, and callback outcome for investigation. There is intentionally no automatic repair method for a token transfer whose callback failed.

The sponsor relayer stores a digest before submission. A duplicate signed delegate cannot be relayed again by this API. A `NeedsReview` sponsor outcome requires inspecting the outer transaction and contributor holding before a new signed request is obtained. Never reuse the old signature to guess whether it succeeded.

The company contract has no upgrade method, but its deployment full-access key can redeploy code until removed. After the final rehearsal, compare `docs/deployment-manifest.testnet.json` with on-chain code/config and explicitly remove that key only as part of a reviewed release step. Keep DAO member keys in wallets. A new contract version should use a new company account. Direct token deposits outside an approved distribution are not credited by the ownership ledger and may be stranded.
