# CapTable

NEAR company ownership prototype. See [implementation plan](IMPLEMENTATION_PLAN.md).

Current status: repository and frontend scaffold; the company contract implements DAO-governed ownership, contributor grants and vesting claims, immutable distribution snapshots, exact DAO token funding, per-recipient payment attempts, callback settlement, confirmed-failure retries, pause controls, and supply views. DAO/test-token integration tests, frontend workflows, receipt indexing, and sponsored relaying remain to be built.

Rust is pinned to 1.88.0 in `rust-toolchain.toml`. Run contract tests with `cargo test -p captab-company`. Build WASM with `pnpm build:contract`. Install frontend dependencies with `pnpm install`, then run it with `pnpm --filter @captab/web dev`.
