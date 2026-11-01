# CapTable

NEAR company ownership prototype. See [implementation plan](IMPLEMENTATION_PLAN.md).

Current status: repository and frontend scaffold; the company contract implements initialization, DAO-governed founder issuance, pool reservation, bounded holdings, and supply views. Grants, distributions, integration, and relaying remain to be built.

Rust is pinned to 1.88.0 in `rust-toolchain.toml`. Run contract tests with `cargo test -p captab-company`. Build WASM with `pnpm build:contract`. Install frontend dependencies with `pnpm install`, then run it with `pnpm --filter @captab/web dev`.
