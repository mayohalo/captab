# MVP release evidence and open issues

This is the current release audit against [the implementation plan](../IMPLEMENTATION_PLAN.md). Passing local checks proves the contract and UI behavior described below; it does not prove a live testnet deployment or wallet compatibility.

| Gate | Evidence in this workspace | Status |
| --- | --- | --- |
| Pinned toolchain | `rustc 1.88.0`, pnpm `10.16.1`, Node `22.23.0` | Verified locally |
| Company accounting, vesting, snapshots, funding, payment locks, callbacks, and pause | `pnpm test:contract`: 27 passing Rust unit tests | Verified locally |
| Real local-chain DAO, token, sponsored claim, seeded payout, failure/retry, and storage at demo limits | `pnpm test:sandbox`: six passing NEAR Sandbox tests with pinned Sputnik WASM | Verified locally |
| Web domain, auth, receipt, sponsor, deployment, and release logic | All 12 pnpm web/domain test commands passed: 34 tests | Verified locally |
| Browser screens and request construction | `pnpm test:e2e`: 18 passing fixture-backed tests, including a 375px layout check | Verified with fixtures; no cryptographic wallet signatures |
| Production bundle | `pnpm --dir apps/web build` completed | Verified locally |
| Cold install and production build | Exact committed tree in an isolated checkout: frozen pnpm install, production web build, and company WASM build passed. A second fresh Cargo target produced the same company WASM SHA-256 (`fbfdf573d050b48f945bb12bb2f33eca097a2d1961d8ccced8896507407f98da`). Build scripts now clear stale WASM target artifacts before compilation. | Verified locally |
| Deploy from fresh accounts | Requires funded testnet accounts and local deployment keys | Open |
| Callback failure and worker crash recovery | Unit tests keep in-flight attempts locked. `pnpm test:payments` now restarts the database recovery path in separate Node processes and confirms a stale claim stays `NeedsReview` with one attempt. An actual successful-transfer/failed-callback receipt and end-to-end worker/server restart rehearsal were not produced. | Partially verified |
| Fallback presentation | [Labeled fixture video and screenshots](demo/README.md); `pnpm demo:fallback` passed | Available; not live-chain evidence |
| Testnet account funding and deployment | `apps/web/.env.local` and `docs/deployment-manifest.testnet.json` are absent | Open |
| Live release hash, DAO policy, token registration, storage, accounting, and key audit | `pnpm verify:testnet` is implemented but has no manifest or deployed accounts to check | Open |
| Wallet-signed browser journeys and sponsored claim | Browser tests use a development fixture adapter; Sandbox signs a delegate action on a local chain | Open on testnet |
| Live payout rehearsal and receipt links | Runbook defines exact founder, grant, distribution, staged failure, and retry sequence; no testnet transaction hashes exist | Open |
| Final key removal, live video, and submission | Require the verified deployment and completed rehearsal | Open |

The remaining live sequence is: prepare funded accounts and local keys; run the three read-only preflights and deployments in [the runbook](RUNBOOK.md); set the deployed company code hash; execute the seeded scenario with three council wallets, contributor and operator wallets, worker, executor, and relayer; inspect final receipt chains and on-chain balances; run `pnpm verify:testnet`; then review deployment-key removal, refresh the manifest, record the live demo, and package the submission. The user has confirmed that funded accounts and keys are not configured yet. Do not put private keys in this file or the manifest.

The MVP deliberately limits history to app-submitted transactions, uses persistent single-host SQLite, has no automatic recovery for a transfer whose callback failed, and treats ownership units and TESTUSD as fictional. These limits remain visible in the [runbook](RUNBOOK.md) and app. A production system would need a separate design for complete indexing, callback recovery, confidentiality, legal ownership, and upgrades.
