#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$root/.cache/sputnik"
revision="5434a59dec23ee0c49df8c8c4350c208a7e75b0b"
expected_sha256="a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722"
wasm="$source_dir/target/wasm32-unknown-unknown/release/sputnikdao2.wasm"

if [[ ! -d "$source_dir/.git" ]]; then
  mkdir -p "$source_dir"
  git -C "$source_dir" init -q
  git -C "$source_dir" remote add origin https://github.com/near-daos/sputnik-dao-contract.git
fi
if [[ "$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true)" != "$revision" ]]; then
  git -C "$source_dir" fetch --depth 1 origin "$revision"
  git -C "$source_dir" checkout -q --detach FETCH_HEAD
fi
cargo +1.88.0 build --manifest-path "$source_dir/Cargo.toml" -p sputnikdao2 --target wasm32-unknown-unknown --release --locked
actual_sha256="$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  # Rust embeds absolute build paths and host-specific code layout in the WASM, so a build on another OS or
  # architecture produces different bytes from the pinned macOS (arm64) build. In that case, take the pinned
  # bytes from the live testnet DAOs that run them, and accept them only if their SHA-256 equals the pin.
  echo "Local Sputnik build differs from the pinned bytes ($actual_sha256); fetching the pinned WASM from testnet" >&2
  node --input-type=module - "$wasm" "$expected_sha256" <<'NODE'
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const [wasm, expected] = process.argv.slice(2);
const accounts = ["captab-dao-0d07df99e1bb0e44.testnet", "captab-dao-101e85b169dd3522.testnet"];
const rpcs = [process.env.NEAR_RPC_URL, "https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"].filter(Boolean);
for (const rpc of rpcs) for (const account of accounts) {
  try {
    const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_code", finality: "final", account_id: account } }) });
    const body = await response.json();
    const bytes = Buffer.from(body.result?.code_base64 ?? "", "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== expected) continue;
    await writeFile(wasm, bytes);
    console.error(`Pinned Sputnik WASM taken from ${account} via ${rpc}`);
    process.exit(0);
  } catch {}
}
console.error("Could not obtain the pinned Sputnik WASM");
process.exit(1);
NODE
  actual_sha256="$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "Sputnik WASM hash mismatch: $actual_sha256" >&2
    exit 1
  fi
fi
echo "Pinned Sputnik DAO WASM: $wasm ($actual_sha256)"
