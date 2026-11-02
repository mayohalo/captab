import { createServer } from "node:http";
import { distributionHash } from "../lib/distribution-hash.ts";

const port = 14555;
const company = "company.testnet";
const dao = "board.testnet";
const unsafeCompany = "unsafe.testnet";
const unsafeDao = "unsafe-board.testnet";
const token = "testusd.testnet";
const boundaries = Array.from({ length: 49 }, (_, month) => Math.floor(Date.UTC(2025, month, 1) / 1000));
const totals = {
  dao_id: dao, authorized_units: "10000000", issued_total: "6025000",
  pool_available: "1900000", grant_reserved: "75000", fully_diluted_total: "8000000",
  unallocated_units: "2000000", ledger_revision: 4, holder_count: 3,
};
const config = {
  dao_id: dao, snapshot_operator_id: "operator.testnet", settlement_token_id: token,
  authorized_units: "10000000", paused: false,
};
const holdings = [
  { account_id: "founder-a.testnet", issued_units: "3600000" },
  { account_id: "founder-b.testnet", issued_units: "2400000" },
  { account_id: "contributor.testnet", issued_units: "25000" },
];
const grants = [{
  id: 0, recipient: "contributor.testnet", original_units: "100000", entitlement_cap: "100000",
  issued_units: "25000", vested_units: "25000", claimable_units: "0", boundaries, cancelled_at: null,
}, ...Array.from({ length: 20 }, (_, index) => ({
  id: index + 1, recipient: `past-${index + 1}.testnet`, original_units: "1000", entitlement_cap: "0",
  issued_units: "0", vested_units: "0", claimable_units: "0", boundaries, cancelled_at: 1_740_000_000,
}))];
const distributions = [{
  id: 0, snapshot_revision: 4, snapshot_timestamp: 1_790_000_000, snapshot_block_height: 123,
  token_id: token, budget: "10000000000", expires_at: 1_900_000_000,
  schedule_hash: Array.from({ length: 32 }, (_, index) => index),
  approved: true, cancelled: false, funded: true, paid_total: "9958506224",
  in_flight_total: "0", available_escrow: "41493776",
  entitlements: [
    { account_id: "founder-a.testnet", units: "3600000", amount: "5975103734", payment_status: "Paid", attempt_id: 1 },
    { account_id: "founder-b.testnet", units: "2400000", amount: "3983402490", payment_status: "Paid", attempt_id: 1 },
    { account_id: "contributor.testnet", units: "25000", amount: "41493776", payment_status: "Failed", attempt_id: 1 },
  ],
}, {
  id: 1, snapshot_revision: 4, snapshot_timestamp: 1_790_000_001, snapshot_block_height: 124,
  token_id: token, budget: "100", expires_at: 1_900_000_000,
  schedule_hash: [], approved: false, cancelled: false, funded: false,
  paid_total: "0", in_flight_total: "0", available_escrow: "0",
  entitlements: [
    { account_id: "founder-a.testnet", units: "3600000", amount: "60", payment_status: "Ready", attempt_id: 0 },
    { account_id: "founder-b.testnet", units: "2400000", amount: "40", payment_status: "Ready", attempt_id: 0 },
    { account_id: "contributor.testnet", units: "25000", amount: "0", payment_status: "Zero", attempt_id: 0 },
  ],
}];
for (const distribution of distributions) distribution.schedule_hash = distributionHash(company, distribution);
const policy = {
  proposal_bond: "100000000000000000000000", roles: [{ name: "council", kind: { Group: [
    "council-a.testnet", "council-b.testnet", "council-c.testnet",
  ] }, permissions: ["*:VoteApprove"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: { Ratio: [1, 2] } },
};
const methods = new Map([
  [`${company}:get_totals`, totals], [`${company}:get_config`, config],
  [`${company}:list_holdings`, holdings], [`${company}:list_grants`, grants],
  [`${company}:get_grant`, grants], [`${company}:get_distribution`, distributions],
  [`${company}:list_distributions`, distributions], [`${dao}:get_policy`, policy],
  [`${dao}:get_last_proposal_id`, 0], [`${dao}:get_proposals`, []],
  [`${token}:ft_metadata`, { spec: "ft-1.0.0", name: "Test USD", symbol: "TESTUSD", decimals: 6 }],
  [`${unsafeCompany}:get_totals`, { ...totals, dao_id: unsafeDao }],
  [`${unsafeCompany}:get_config`, { ...config, dao_id: unsafeDao }],
  [`${unsafeCompany}:list_holdings`, holdings], [`${unsafeCompany}:list_grants`, grants],
  [`${unsafeCompany}:get_grant`, grants], [`${unsafeCompany}:get_distribution`, distributions],
  [`${unsafeCompany}:list_distributions`, distributions],
  [`${unsafeDao}:get_policy`, policy], [`${unsafeDao}:get_last_proposal_id`, 0],
  [`${unsafeDao}:get_proposals`, []],
]);

createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    const params = rpc.params ?? {};
    if (rpc.method !== "query") throw new Error(`Unsupported RPC method ${rpc.method}`);
    let result;
    if (params.request_type === "view_code" && [company, dao, unsafeDao].includes(params.account_id)) {
      result = { code_base64: "", hash: params.account_id === dao
        ? "CB5QxzaBMy3kArDdQJPX3sEsXSeNdfLW4vx9qMn6uCgq" : "fixture-company-code-hash" };
    } else if (params.request_type === "call_function") {
      const key = `${params.account_id}:${params.method_name}`;
      if (!methods.has(key)) throw new Error(`Unsupported contract method ${key}`);
      const args = params.args_base64 ? JSON.parse(Buffer.from(params.args_base64, "base64").toString()) : {};
      const value = methods.get(key);
      const page = params.method_name === "get_grant" ? value[args.grant_id] ?? null
        : params.method_name === "get_distribution" && args.distribution_id === 2
          ? { ...distributions[1], id: 2 }
        : params.method_name === "get_distribution" ? value[args.distribution_id] ?? null
        : Array.isArray(value) && params.method_name.startsWith("list_")
        ? value.slice(args.from_index ?? 0, (args.from_index ?? 0) + (args.limit ?? value.length)) : value;
      result = { result: [...Buffer.from(JSON.stringify(page))], logs: [] };
    } else throw new Error(`Unsupported query ${params.request_type}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {
      block_hash: "11111111111111111111111111111111", block_height: 123, ...result,
    } }));
  } catch (error) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: "error", error: {
      code: -32603, message: error instanceof Error ? error.message : "Fixture RPC error",
    } }));
  }
}).listen(port, "127.0.0.1", () => console.log(`Fixture NEAR RPC ready on ${port}`));
