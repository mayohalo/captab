import { createHash } from "node:crypto";
import type { Distribution } from "./near";

const encoder = new TextEncoder();
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const uint = (value: string | number, width: 8 | 16) => {
  let number = BigInt(value);
  if (number < 0n || number >= 1n << BigInt(width * 8)) throw new Error("Distribution contains an out-of-range integer.");
  const bytes = Buffer.alloc(width);
  for (let index = 0; index < width; index++) {
    bytes[index] = Number(number & 0xffn);
    number >>= 8n;
  }
  return bytes;
};
const string = (value: string) => {
  const bytes = Buffer.from(encoder.encode(value));
  return Buffer.concat([u32(bytes.length), bytes]);
};

/** Mirrors the contract's Borsh tuple in prepare_distribution. */
export function distributionHash(companyId: string, distribution: Distribution): number[] {
  const rows = [...distribution.entitlements].sort((a, b) => a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0);
  const chunks = [
    string("near:testnet/captable.distribution.v1"),
    string(companyId),
    uint(distribution.id, 8),
    uint(distribution.snapshot_revision, 8),
    uint(distribution.snapshot_timestamp, 8),
    uint(distribution.snapshot_block_height, 8),
    string(distribution.token_id),
    uint(distribution.budget, 16),
    uint(distribution.expires_at, 8),
    u32(rows.length),
  ];
  for (const row of rows) chunks.push(string(row.account_id), uint(row.units, 16), uint(row.amount, 16));
  return [...createHash("sha256").update(Buffer.concat(chunks)).digest()];
}

export function assertDistributionHash(companyId: string, distribution: Distribution) {
  const actual = distributionHash(companyId, distribution);
  if (distribution.schedule_hash.length !== 32 || actual.some((value, index) => value !== distribution.schedule_hash[index])) {
    throw new Error("Distribution schedule hash does not match its immutable on-chain fields.");
  }
}
