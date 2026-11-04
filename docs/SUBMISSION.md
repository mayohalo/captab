# CapTable NEAR testnet MVP package

The deployed fictional ownership demo is at `captab-company-101e85b169dd3522.testnet`, governed by `captab-dao-101e85b169dd3522.testnet`, with `captab-token-101e85b169dd3522.testnet` as the six-decimal TESTUSD settlement fixture. The source, contracts, tests, and run commands are in this repository. No private keys or local database files are included.

Review the [deployment manifest](deployment-manifest.testnet.json), [live payout and retry evidence](testnet-rehearsal.json), [browser-driven governance and sponsored-claim evidence](testnet-browser-rehearsal.json), and [31-second live-chain walkthrough](demo/live-testnet.webm). The [release audit](RELEASE_STATUS.md) tracks completed and open gates, while the [runbook](RUNBOOK.md) explains setup, verification, recovery, and the guarded final freeze.

The browser test wallet signs in a local Node process using test-only keys that remain in ignored files. It proved browser request construction and live signed NEAR outcomes, including a sponsored claim, but it has not established compatibility with a third-party wallet extension. The company deployment key also remains on chain pending the final irreversible key-removal decision. The app uses a single-host SQLite worker and app-submitted history coverage; ownership units and TESTUSD are fictional.

For a fresh review, run `pnpm install`, the checks in the runbook, `pnpm verify:testnet`, and `pnpm freeze:company` as a read-only preflight. An external submission destination has not been specified.
