# CapTable

NEAR company ownership prototype. See [implementation plan](IMPLEMENTATION_PLAN.md).

Current status: repository and frontend scaffold; the company contract implements initialization, DAO-governed founder issuance, pool reservation, bounded holdings, and supply views. Grants, distributions, integration, and relaying remain to be built.

Run contract tests with `cargo test -p captab-company`. Build WASM with `npm run build:contract` after installing the `wasm32-unknown-unknown` Rust target. Run the frontend with `npm install` and `npm run dev -w @captab/web`.
