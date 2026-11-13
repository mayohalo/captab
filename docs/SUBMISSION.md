# Captab NEAR testnet package

Captab runs a company's ownership from day zero to exit on NEAR testnet: founder issuance, contributor grants with vesting, priced investor rounds paid and issued in one transaction, secondary sales, buybacks, exact payouts, and a final close. A Sputnik DAO council is the board and approves every change.

Two fictional companies are live:

- **Schema v2 (full lifecycle, code on `main`):** `captab-company-0d07df99e1bb0e44.testnet`, governed by `captab-dao-0d07df99e1bb0e44.testnet`, settled in `captab-token-0d07df99e1bb0e44.testnet` (six-decimal TESTUSD). Its [live rehearsal](testnet-v2-rehearsal.json) ran a charter amendment, signed grant terms, founder vesting with acceleration, a seed round with refunded wrong payments, a secondary sale whose held proceeds were delivered by a retry, a DAO-paid buyback, and an explicit payout list, all through two-of-three DAO votes.
- **Schema v1 (MVP, tag `v1-testnet`):** `captab-company-101e85b169dd3522.testnet` with `captab-dao-101e85b169dd3522.testnet` and `captab-token-101e85b169dd3522.testnet`. Its rehearsals cover [payouts with a failed-then-retried payment](testnet-rehearsal.json) and [browser-driven governance and a zero-NEAR sponsored claim](testnet-browser-rehearsal.json).

Start with the [README](../README.md): its "From day zero to exit" table maps each startup stage to a contract method, and its claims-and-evidence table links each guarantee to its code, test, and testnet transaction. The [release audit](RELEASE_STATUS.md) lists each gate and its evidence, and the [runbook](RUNBOOK.md) explains setup, verification, and recovery. Each [v2](deployment-manifest.v2.testnet.json) and [v1](deployment-manifest.testnet.json) manifest pins code hashes, the DAO policy, and token supply.

Known limits, stated plainly: closing a company is proven in NEAR Sandbox only, so the testnet company stays open as a demo. Browser signing used local test keys kept in ignored files; compatibility with third-party wallet extensions is not yet recorded. The company deployment key is deliberately kept because the contract has no self-upgrade method. The app uses a single-host SQLite worker and records history only for app-submitted transactions. Ownership units and TESTUSD are fictional and are not legal shares.

To review from a fresh checkout: `pnpm install`, the checks in the README, then `CAPTAB_DEPLOYMENT=v2 pnpm verify:testnet`. This repository contains no private keys or local database files.
