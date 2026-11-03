# MVP release evidence and open issues

This is the current release audit against [the implementation plan](../IMPLEMENTATION_PLAN.md). Passing local checks proves the contract and UI behavior described below; it does not prove a live testnet deployment or wallet compatibility.

| Gate | Evidence in this workspace | Status |
| --- | --- | --- |
| Pinned toolchain | `rustc 1.88.0`, pnpm `10.16.1`, Node `22.23.0` | Verified locally |
| Company accounting, vesting, snapshots, funding, payment locks, callbacks, and pause | `pnpm test:contract`: 28 passing Rust unit tests | Verified locally |
| Real local-chain DAO, token, sponsored claim, seeded payout, failure/retry, failed callback, key removal, and storage at demo limits | `pnpm test:sandbox`: eight passing NEAR Sandbox tests with pinned Sputnik WASM. The failed-callback case uses a separately built fault-injection company WASM and checks successful token transfer, failed company callback, locked entitlement, and rejected retry. The freeze case deletes a disposable account's last full-access key and confirms the company contract remains readable. | Verified locally |
| Web domain, auth, receipt, sponsor, deployment, and release logic | All 12 pnpm web/domain test commands passed; `pnpm test:payments` now includes a cross-process restart case | Verified locally |
| Browser screens and request construction | `pnpm test:e2e`: 18 passing fixture-backed tests, including a 375px layout check | Verified with fixtures; no cryptographic wallet signatures |
| Production bundle | `pnpm --dir apps/web build` completed | Verified locally |
| Cold install and production build | The committed `9fc3b1c` tree passed a frozen pnpm install, production web build, and normal company WASM build in an isolated checkout. Its WASM SHA-256 matched the workspace's fresh build (`56e0b34873106db4ad6ac2ae81bd43f2aa5a05dea516a76658cbdafa453ee688`). The separate fault-injection artifact has a different hash and is rejected by deployment and release checks. Build scripts clear stale WASM target artifacts before compilation. | Verified locally |
| Deploy from fresh accounts | Requires funded testnet accounts and local deployment keys | Open |
| Callback failure and worker crash recovery | The Sandbox fault-injection case produces a successful token receipt and failed callback receipt; the on-chain entitlement stays in flight and cannot be retried. `pnpm test:worker-restart` restarts the production server and reconciliation worker against persistent SQLite and confirms a stale claim stays `NeedsReview` while another payment remains queued. | Verified locally |
| Fallback presentation | [Labeled fixture video and screenshots](demo/README.md); `pnpm demo:fallback` passed | Available; not live-chain evidence |
| Testnet account funding and deployment | `apps/web/.env.local` and `docs/deployment-manifest.testnet.json` are absent | Open |
| Live release hash, complete DAO policy, token total supply and registration, storage, accounting, and key audit | `pnpm verify:testnet` compares the full recorded DAO policy and TESTUSD supply as well as the named invariants, but has no manifest or deployed accounts to check | Open |
| Wallet-signed browser journeys and sponsored claim | Browser tests use a development fixture adapter; Sandbox signs a delegate action on a local chain | Open on testnet |
| Live payout rehearsal and receipt links | Runbook defines exact founder, grant, distribution, staged failure, and retry sequence; no testnet transaction hashes exist | Open |
| Final key removal, live video, and submission | `pnpm freeze:company` provides a read-only preflight and guarded key-removal path, with its signing helper exercised in Sandbox; the live key removal, recorded video, and submission still require funded accounts and a completed rehearsal | Open |

The remaining live sequence is: prepare funded accounts and local keys; run the three read-only preflights and deployments in [the runbook](RUNBOOK.md); set the deployed company code hash; execute the seeded scenario with three council wallets, contributor and operator wallets, worker, executor, and relayer; inspect final receipt chains and on-chain balances; run `pnpm verify:testnet`; then review deployment-key removal, refresh the manifest, record the live demo, and package the submission. The user has confirmed that funded accounts and keys are not configured yet. Do not put private keys in this file or the manifest.

The MVP deliberately limits history to app-submitted transactions, uses persistent single-host SQLite, has no automatic recovery for a transfer whose callback failed, and treats ownership units and TESTUSD as fictional. These limits remain visible in the [runbook](RUNBOOK.md) and app. A production system would need a separate design for complete indexing, callback recovery, confidentiality, legal ownership, and upgrades.
