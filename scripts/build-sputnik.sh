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
  echo "Sputnik WASM hash mismatch: $actual_sha256" >&2
  exit 1
fi
echo "Pinned Sputnik DAO WASM: $wasm ($actual_sha256)"
