# Captab NEAR testnet MVP package

The deployed fictional ownership demo is at `captab-company-101e85b169dd3522.testnet`. It is governed by `captab-dao-101e85b169dd3522.testnet` and uses `captab-token-101e85b169dd3522.testnet` as the six-decimal TESTUSD settlement fixture. This repository contains the source, contracts, tests, and run commands. It contains no private keys or local database files.

Start with the [README](../README.md): its claims-and-evidence table links each guarantee to its code, the test that proves it, and the testnet transaction. For the underlying records, see the [deployment manifest](deployment-manifest.testnet.json), the [live payout and retry evidence](testnet-rehearsal.json), the [browser-driven governance and sponsored-claim evidence](testnet-browser-rehearsal.json), and the [31-second live-chain walkthrough](demo/live-testnet.webm). The [release audit](RELEASE_STATUS.md) lists each gate and its evidence, and the [runbook](RUNBOOK.md) explains setup, verification, and recovery.

Browser signing on testnet used a local test wallet whose test-only keys stay in ignored files. It proved browser request construction and live signed NEAR outcomes, including a sponsored claim, but it does not show compatibility with third-party wallet extensions. The company deployment key is deliberately kept: the contract has no self-upgrade method, so removing the key would freeze its code permanently. Key removal is implemented and proven in Sandbox. The app uses a single-host SQLite worker and records history only for app-submitted transactions; ownership units and TESTUSD are fictional.

To review from a fresh checkout, run `pnpm install`, the checks in the README or runbook, `pnpm verify:testnet`, and `pnpm freeze:company` (read-only preflight).
