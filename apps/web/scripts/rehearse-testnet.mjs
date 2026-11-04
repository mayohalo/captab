import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const credentials = JSON.parse(await readFile(resolve(root, "apps/web/.data/testnet-accounts.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, "docs/deployment-manifest.testnet.json"), "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not NEAR testnet");
if (manifest.network !== "testnet" || manifest.companyId !== credentials.accounts.company.accountId ||
  manifest.daoId !== credentials.accounts.dao.accountId || manifest.tokenId !== credentials.accounts.token.accountId) {
  throw new Error("Deployment manifest does not match the local testnet key bundle");
}
const companyId = manifest.companyId;
const daoId = manifest.daoId;
const council = ["council1", "council2", "council3"].map(role => {
  const value = credentials.accounts[role];
  return new Account(value.accountId, provider, value.privateKey);
});
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });

function assertTransaction(result, label) {
  if (!result?.status || typeof result.status !== "object" || !("SuccessValue" in result.status || "SuccessReceiptId" in result.status)) {
    throw new Error(`${label} did not succeed; inspect transaction ${result?.transaction?.hash ?? "unknown"}`);
  }
  return result.transaction.hash;
}

function buildGovernanceProposal(input, context) {
  const { companyId, totals, actionId } = context;
  if (!Number.isSafeInteger(totals.ledger_revision)) throw new Error("Invalid ledger revision");
  if (!["founder", "pool", "grant", "approve", "fund"].includes(input.action)) throw new Error("Unsupported rehearsal action");
  if (["founder", "pool", "grant"].includes(input.action) && !/^[1-9]\d*$/.test(input.units)) throw new Error("Invalid rehearsal units");
  let receiverId = companyId;
  let methodName;
  let args;
  let gas = "40000000000000";
  let deposit = "0";
  if (input.action === "approve") {
    methodName = "approve_distribution";
    args = { action_id: actionId, distribution_id: input.distribution.id, schedule_hash: input.distribution.schedule_hash };
  } else if (input.action === "fund") {
    methodName = "ft_transfer_call";
    receiverId = input.distribution.token_id;
    args = { receiver_id: companyId, amount: input.distribution.budget,
      msg: JSON.stringify({ distribution_id: input.distribution.id, schedule_hash: input.distribution.schedule_hash }) };
    gas = "120000000000000";
    deposit = "1";
  } else {
    methodName = input.action === "founder" ? "issue_founder_units" : input.action === "pool" ? "increase_pool" : "create_grant";
    args = { action_id: actionId, expected_revision: totals.ledger_revision,
      ...(input.action === "founder" || input.action === "grant" ? { recipient: input.recipient } : {}), units: input.units,
      ...(input.action === "grant" ? { boundaries: input.boundaries } : {}) };
    if (input.action === "grant") gas = "80000000000000";
  }
  return { description: `Live rehearsal ${input.action} ${actionId}`,
    kind: { FunctionCall: { receiver_id: receiverId, actions: [{ method_name: methodName,
      args: Buffer.from(JSON.stringify(args)).toString("base64"), gas, deposit }] } } };
}

async function councilProposal(input, actionId) {
  const [totals, policy] = await Promise.all([view(companyId, "get_totals"), view(daoId, "get_policy")]);
  if (policy?.proposal_bond !== "1000000000000000000000000") throw new Error("Unexpected DAO proposal bond");
  const proposal = buildGovernanceProposal(input, { companyId, totals, actionId });
  const first = await council[0].callFunctionRaw({ contractId: daoId, methodName: "add_proposal",
    args: { proposal }, gas: teraToGas(180), deposit: BigInt(policy.proposal_bond), waitUntil: "FINAL" });
  const addHash = assertTransaction(first, "DAO proposal");
  const proposalId = JSON.parse(Buffer.from(first.status.SuccessValue, "base64").toString("utf8"));
  if (!Number.isSafeInteger(proposalId)) throw new Error(`Proposal ID is unavailable; inspect ${addHash}`);
  const votes = [];
  for (const account of council.slice(0, 2)) {
    const vote = await account.callFunctionRaw({ contractId: daoId, methodName: "act_proposal",
      args: { id: proposalId, action: "VoteApprove", proposal: proposal.kind }, gas: teraToGas(220), deposit: 0n, waitUntil: "FINAL" });
    votes.push(assertTransaction(vote, "DAO vote"));
  }
  const state = await view(daoId, "get_proposal", { id: proposalId });
  if (state?.status !== "Approved") throw new Error(`Proposal ${proposalId} did not execute; inspect ${votes.at(-1)}`);
  console.log(JSON.stringify({ action: input.action, proposalId, addHash, votes, status: state.status }));
}

async function seedEquity() {
  const founders = [
    ["foundera", "3600000", "live-founder-a-v1"],
    ["founderb", "2400000", "live-founder-b-v1"],
  ];
  for (const [role, amount, actionId] of founders) {
    const recipient = credentials.accounts[role].accountId;
    const holding = await view(companyId, "get_holding", { account_id: recipient });
    if (String(holding) === amount) {
      console.log(JSON.stringify({ action: "founder", recipient, units: amount, status: "already issued" }));
      continue;
    }
    if (String(holding) !== "0") throw new Error(`${role} holding differs from the demo fixture`);
    await councilProposal({ action: "founder", recipient, units: amount }, actionId);
    const updated = await view(companyId, "get_holding", { account_id: recipient });
    if (String(updated) !== amount) throw new Error(`${role} issuance did not settle`);
  }
  const totals = await view(companyId, "get_totals");
  if (String(totals.pool_available) === "0") {
    await councilProposal({ action: "pool", units: "2000000" }, "live-pool-v1");
  } else if (String(totals.pool_available) !== "2000000") {
    throw new Error("Contributor pool differs from the demo fixture");
  }
  const finalTotals = await view(companyId, "get_totals");
  if (String(finalTotals.issued_total) !== "6000000" || String(finalTotals.pool_available) !== "2000000" ||
    String(finalTotals.unallocated_units) !== "2000000") throw new Error("Seeded equity does not reconcile");
  console.log(JSON.stringify({ status: "equity seeded", totals: finalTotals }));
}

function monthlyBoundaries(startIso) {
  const start = new Date(startIso);
  if (start.toISOString() !== startIso.replace("Z", ".000Z")) throw new Error("Invalid UTC grant start");
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  return Array.from({ length: 49 }, (_, offset) => {
    const lastDay = new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate();
    return Math.floor(Date.UTC(year, month + offset, Math.min(day, lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()) / 1000);
  });
}

async function grantAndClaim() {
  const recipient = credentials.accounts.contributor.accountId;
  const boundaries = monthlyBoundaries("2025-10-01T00:00:00Z");
  const now = Math.floor(Date.now() / 1000);
  if (now < boundaries[12] || now >= boundaries[13]) throw new Error("Demo date is outside the exact one-year cliff window");
  let grant = await view(companyId, "get_grant", { grant_id: 0 });
  if (!grant) {
    const totals = await view(companyId, "get_totals");
    if (String(totals.issued_total) !== "6000000" || String(totals.pool_available) !== "2000000") throw new Error("Seed equity before creating the grant");
    await councilProposal({ action: "grant", recipient, units: "100000", boundaries }, "live-grant-v1");
    grant = await view(companyId, "get_grant", { grant_id: 0 });
  }
  if (grant?.recipient !== recipient || String(grant.original_units) !== "100000" || JSON.stringify(grant.boundaries) !== JSON.stringify(boundaries)) {
    throw new Error("Live grant differs from the demo fixture");
  }
  let holding = await view(companyId, "get_holding", { account_id: recipient });
  if (String(holding) === "0") {
    if (String(grant.claimable_units) !== "25000") throw new Error("Grant claimable amount is not the expected cliff amount");
    const account = new Account(recipient, provider, credentials.accounts.contributor.privateKey);
    const result = await account.callFunctionRaw({ contractId: companyId, methodName: "claim_vested",
      args: { grant_id: 0 }, gas: teraToGas(80), deposit: 0n, waitUntil: "FINAL" });
    console.log(JSON.stringify({ action: "claim", grantId: 0, transaction: assertTransaction(result, "vested claim") }));
    holding = await view(companyId, "get_holding", { account_id: recipient });
  }
  const totals = await view(companyId, "get_totals");
  if (String(holding) !== "25000" || String(totals.issued_total) !== "6025000" ||
    String(totals.pool_available) !== "1900000" || String(totals.grant_reserved) !== "75000" ||
    String(totals.fully_diluted_total) !== "8000000") throw new Error("Live vesting and supply totals do not match the demo fixture");
  console.log(JSON.stringify({ status: "grant claimed", grantId: 0, totals }));
}

async function snapshotAndFund() {
  const totals = await view(companyId, "get_totals");
  if (String(totals.issued_total) !== "6025000" || String(totals.ledger_revision) !== "5") throw new Error("Claimed demo equity must be finalized before snapshot");
  let distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  if (!distribution) {
    const operator = new Account(credentials.accounts.operator.accountId, provider, credentials.accounts.operator.privateKey);
    const result = await operator.callFunctionRaw({ contractId: companyId, methodName: "prepare_distribution",
      args: { expected_revision: totals.ledger_revision, budget: "10000000000", expires_at: 1_893_456_000 },
      gas: teraToGas(120), deposit: 0n, waitUntil: "FINAL" });
    console.log(JSON.stringify({ action: "snapshot", transaction: assertTransaction(result, "distribution snapshot") }));
    distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  }
  if (!distribution || String(distribution.budget) !== "10000000000" || distribution.snapshot_revision !== 5 ||
    distribution.token_id !== manifest.tokenId || distribution.schedule_hash?.length !== 32 || distribution.cancelled) {
    throw new Error("Live distribution differs from the demo fixture");
  }
  const expected = {
    [credentials.accounts.foundera.accountId]: "5975103734",
    [credentials.accounts.founderb.accountId]: "3983402490",
    [credentials.accounts.contributor.accountId]: "41493776",
  };
  for (const row of distribution.entitlements) {
    if (expected[row.account_id] !== String(row.amount)) throw new Error(`Unexpected entitlement for ${row.account_id}`);
    delete expected[row.account_id];
  }
  if (Object.keys(expected).length) throw new Error("Distribution is missing a demo recipient");
  console.log(JSON.stringify({ status: "snapshot amounts verified", distributionId: distribution.id, scheduleHash: distribution.schedule_hash }));
  if (!distribution.approved) {
    await councilProposal({ action: "approve", distribution }, "live-distribution-approval-v1");
    distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  }
  if (!distribution.approved) throw new Error("Distribution approval did not settle");
  if (!distribution.funded) {
    await councilProposal({ action: "fund", distribution }, "live-distribution-funding-v1");
    distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  }
  const tokenBalance = await view(manifest.tokenId, "ft_balance_of", { account_id: companyId });
  if (!distribution.funded || String(distribution.available_escrow) !== "10000000000" || String(tokenBalance) !== "10000000000") {
    throw new Error("Distribution escrow does not match the authorized TESTUSD funding");
  }
  console.log(JSON.stringify({ status: "distribution funded", distributionId: distribution.id, escrow: distribution.available_escrow }));
}

async function preparePayments() {
  const distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  if (!distribution?.funded || String(distribution.available_escrow) !== "10000000000") throw new Error("Fund the demo distribution before payment prep");
  const token = new Account(manifest.tokenId, provider, credentials.accounts.token.privateKey);
  const bounds = await view(manifest.tokenId, "storage_balance_bounds");
  for (const role of ["foundera", "founderb"]) {
    const recipient = credentials.accounts[role].accountId;
    let registration = await view(manifest.tokenId, "storage_balance_of", { account_id: recipient });
    if (!registration) {
      const result = await token.callFunctionRaw({ contractId: manifest.tokenId, methodName: "storage_deposit",
        args: { account_id: recipient, registration_only: true }, gas: teraToGas(30), deposit: BigInt(bounds.min), waitUntil: "FINAL" });
      console.log(JSON.stringify({ action: "register token recipient", recipient, transaction: assertTransaction(result, "TESTUSD registration") }));
      registration = await view(manifest.tokenId, "storage_balance_of", { account_id: recipient });
    }
    if (!registration) throw new Error(`${role} TESTUSD registration is missing`);
  }
  const contributor = credentials.accounts.contributor.accountId;
  const contributorRegistration = await view(manifest.tokenId, "storage_balance_of", { account_id: contributor });
  if (contributorRegistration) throw new Error("Contributor must remain unregistered for the staged first payment failure");
  try { process.loadEnvFile(resolve(root, "apps/web/.env.local")); } catch (error) { throw new Error(`Cannot load local web configuration: ${error}`); }
  const baseUrl = process.env.CAPTAB_BASE_URL ?? "http://127.0.0.1:3000";
  const response = await fetch(new URL("/api/distributions/0/execute", baseUrl), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CAPTAB_WORKER_SECRET}` },
    body: JSON.stringify({ companyId }), signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json();
  if (response.status !== 202) throw new Error(`Payment queue rejected: ${JSON.stringify(body)}`);
  console.log(JSON.stringify({ action: "queue payments", ...body }));
}

async function retryContributor() {
  const contributor = credentials.accounts.contributor.accountId;
  let distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  const expected = {
    [credentials.accounts.foundera.accountId]: "Paid",
    [credentials.accounts.founderb.accountId]: "Paid",
  };
  for (const row of distribution.entitlements) {
    if (expected[row.account_id] && row.payment_status !== expected[row.account_id]) throw new Error(`${row.account_id} is not paid yet`);
  }
  const row = distribution.entitlements.find(item => item.account_id === contributor);
  if (!row || !["Failed", "Paid"].includes(row.payment_status)) throw new Error("Contributor entitlement is not ready for verified retry");
  let registration = await view(manifest.tokenId, "storage_balance_of", { account_id: contributor });
  if (!registration) {
    const bounds = await view(manifest.tokenId, "storage_balance_bounds");
    const token = new Account(manifest.tokenId, provider, credentials.accounts.token.privateKey);
    const result = await token.callFunctionRaw({ contractId: manifest.tokenId, methodName: "storage_deposit",
      args: { account_id: contributor, registration_only: true }, gas: teraToGas(30), deposit: BigInt(bounds.min), waitUntil: "FINAL" });
    console.log(JSON.stringify({ action: "register contributor", transaction: assertTransaction(result, "contributor TESTUSD registration") }));
    registration = await view(manifest.tokenId, "storage_balance_of", { account_id: contributor });
  }
  if (!registration) throw new Error("Contributor registration did not finalize");
  if (row.payment_status === "Paid") {
    console.log(JSON.stringify({ status: "contributor already paid", attemptId: row.attempt_id }));
    return;
  }
  process.loadEnvFile(resolve(root, "apps/web/.env.local"));
  const response = await fetch(new URL("/api/distributions/0/execute", process.env.CAPTAB_BASE_URL ?? "http://127.0.0.1:3000"), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CAPTAB_WORKER_SECRET}` },
    body: JSON.stringify({ companyId }), signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json();
  if (response.status !== 202 || body.queued !== 1) throw new Error(`Expected exactly one retry job: ${JSON.stringify(body)}`);
  console.log(JSON.stringify({ action: "queue contributor retry", ...body }));
}

async function verifyPayouts() {
  const distribution = await view(companyId, "get_distribution", { distribution_id: 0 });
  if (!distribution?.funded || String(distribution.paid_total) !== "10000000000" ||
    String(distribution.available_escrow) !== "0" || String(distribution.in_flight_total) !== "0") {
    throw new Error("Distribution has not fully settled");
  }
  const expected = {
    [credentials.accounts.foundera.accountId]: { amount: "5975103734", attemptId: 1 },
    [credentials.accounts.founderb.accountId]: { amount: "3983402490", attemptId: 1 },
    [credentials.accounts.contributor.accountId]: { amount: "41493776", attemptId: 2 },
  };
  for (const row of distribution.entitlements) {
    const match = expected[row.account_id];
    if (!match || row.payment_status !== "Paid" || String(row.amount) !== match.amount || row.attempt_id !== match.attemptId) {
      throw new Error(`Unexpected final entitlement for ${row.account_id}`);
    }
    const balance = await view(manifest.tokenId, "ft_balance_of", { account_id: row.account_id });
    if (String(balance) !== match.amount) throw new Error(`TESTUSD balance mismatch for ${row.account_id}`);
  }
  const companyBalance = await view(manifest.tokenId, "ft_balance_of", { account_id: companyId });
  if (String(companyBalance) !== "0") throw new Error("Company TESTUSD escrow is not empty");
  process.loadEnvFile(resolve(root, "apps/web/.env.local"));
  const url = new URL("/api/distributions/0/execute", process.env.CAPTAB_BASE_URL ?? "http://127.0.0.1:3000");
  url.searchParams.set("companyId", companyId);
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.CAPTAB_WORKER_SECRET}` }, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Payment job history HTTP ${response.status}`);
  const { jobs } = await response.json();
  if (jobs?.length !== 4 || jobs.filter(job => job.submission_state === "Settled").length !== 3 ||
    jobs.filter(job => job.submission_state === "Failed").length !== 1) throw new Error("Payment worker history does not show three settlements and one staged failure");
  const evidence = { network: "testnet", companyId, tokenId: manifest.tokenId, distributionId: 0,
    checkedAt: new Date().toISOString(), budgetBaseUnits: distribution.budget, paidBaseUnits: distribution.paid_total,
    entitlements: distribution.entitlements.map(row => ({ accountId: row.account_id, amountBaseUnits: row.amount,
      status: row.payment_status, attemptId: row.attempt_id })),
    paymentJobs: jobs.map(job => ({ accountId: job.recipient_id, attemptId: job.attempt_id,
      state: job.submission_state, transactionHash: job.tx_hash,
      explorerUrl: job.tx_hash ? `https://testnet.nearblocks.io/txns/${job.tx_hash}` : null })) };
  const path = resolve(root, "docs/testnet-rehearsal.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ status: "live payouts verified", path, jobs: evidence.paymentJobs }));
}

if (process.argv.includes("--seed-equity")) await seedEquity();
else if (process.argv.includes("--grant-claim")) await grantAndClaim();
else if (process.argv.includes("--snapshot-fund")) await snapshotAndFund();
else if (process.argv.includes("--payment-prep")) await preparePayments();
else if (process.argv.includes("--retry-contributor")) await retryContributor();
else if (process.argv.includes("--verify-payouts")) await verifyPayouts();
else throw new Error("Pass --seed-equity to run the first live rehearsal stage");
