import { randomBytes } from "node:crypto";
import { accountsPath, envPath } from "./deployment-paths.mjs";
import { mkdir, open, readFile, chmod, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const privateDir = resolve(root, "apps/web/.data");
const credentialsPath = accountsPath;
const rpcUrl = "https://rpc.testnet.fastnear.com";
const faucetUrl = "https://helper.nearprotocol.com/account";
const initialBalances = {
  operator: 700_000_000_000_000_000_000_000n,
  executor: 700_000_000_000_000_000_000_000n,
  relayer: 700_000_000_000_000_000_000_000n,
  council1: 1_000_000_000_000_000_000_000_000n,
  council2: 1_000_000_000_000_000_000_000_000n,
  council3: 1_000_000_000_000_000_000_000_000n,
  foundera: 200_000_000_000_000_000_000_000n,
  founderb: 200_000_000_000_000_000_000_000n,
  contributor: 100_000_000_000_000_000_000_000n,
  investor: 300_000_000_000_000_000_000_000n,
  angel: 300_000_000_000_000_000_000_000n,
};

function keyRecord(accountId) {
  const pair = KeyPair.fromRandom("ed25519");
  return { accountId, publicKey: pair.getPublicKey().toString(), privateKey: pair.toString() };
}

function envLine(name, value) {
  if (/\r|\n/.test(value)) throw new Error(`Invalid ${name}`);
  return `${name}=${value}`;
}

async function initialize() {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const rootId = `captab-${randomBytes(8).toString("hex")}.testnet`;
  const roles = ["dao", "company", "token", "operator", "executor", "relayer", "council1", "council2", "council3", "foundera", "founderb", "contributor", "investor", "angel"];
  const data = {
    network: "testnet",
    root: keyRecord(rootId),
    accounts: Object.fromEntries(roles.map(role => [role, keyRecord(
      ["dao", "company", "token"].includes(role)
        ? `captab-${role}-${rootId.slice(7, -8)}.testnet`
        : `${role}.${rootId}`,
    )])),
  };
  const handle = await open(credentialsPath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`); }
  finally { await handle.close(); }
  await chmod(credentialsPath, 0o600);
  const accounts = data.accounts;
  const env = [
    envLine("NEAR_RPC_URL", "https://rpc.testnet.fastnear.com"),
    envLine("NEXT_PUBLIC_COMPANY_CONTRACT_ID", accounts.company.accountId),
    envLine("CAPTAB_DB_PATH", ".data/captab.sqlite"),
    envLine("CAPTAB_WORKER_SECRET", randomBytes(32).toString("hex")),
    envLine("CAPTAB_EXECUTOR_ACCOUNT_ID", accounts.executor.accountId),
    envLine("CAPTAB_EXECUTOR_PRIVATE_KEY", accounts.executor.privateKey),
    envLine("CAPTAB_RELAYER_ACCOUNT_ID", accounts.relayer.accountId),
    envLine("CAPTAB_RELAYER_PRIVATE_KEY", accounts.relayer.privateKey),
    envLine("CAPTAB_BASE_URL", "http://127.0.0.1:3000"),
    envLine("CAPTAB_AUTH_ORIGIN", "http://127.0.0.1:3000"),
    envLine("CAPTAB_COMPANY_ACCOUNT_ID", accounts.company.accountId),
    envLine("CAPTAB_COMPANY_CODE_HASH", ""),
    envLine("CAPTAB_COMPANY_PRIVATE_KEY", accounts.company.privateKey),
    envLine("CAPTAB_DAO_ACCOUNT_ID", accounts.dao.accountId),
    envLine("CAPTAB_DAO_PRIVATE_KEY", accounts.dao.privateKey),
    envLine("CAPTAB_COUNCIL_ACCOUNTS", [accounts.council1, accounts.council2, accounts.council3].map(value => value.accountId).join(",")),
    envLine("CAPTAB_OPERATOR_ACCOUNT_ID", accounts.operator.accountId),
    envLine("CAPTAB_TOKEN_ACCOUNT_ID", accounts.token.accountId),
    envLine("CAPTAB_TOKEN_PRIVATE_KEY", accounts.token.privateKey),
    envLine("CAPTAB_TOKEN_SUPPLY", "100000000000"),
    envLine("CAPTAB_AUTHORIZED_UNITS", "10000000"),
  ].join("\n") + "\n";
  const envHandle = await open(envPath, "wx", 0o600);
  try { await envHandle.writeFile(env); }
  finally { await envHandle.close(); }
  await chmod(envPath, 0o600);
  console.log(JSON.stringify({ root: rootId, accounts: Object.fromEntries(Object.entries(accounts).map(([role, value]) => [role, value.accountId])), credentialsPath, envPath }, null, 2));
}

async function show() {
  const data = JSON.parse(await readFile(credentialsPath, "utf8"));
  console.log(JSON.stringify({ root: data.root.accountId, accounts: Object.fromEntries(Object.entries(data.accounts).map(([role, value]) => [role, value.accountId])), credentialsPath, envPath }, null, 2));
}

async function faucetAccount(role) {
  const data = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (data.network !== "testnet") throw new Error("Credentials must target testnet");
  const account = role === "root" ? data.root : data.accounts[role];
  if (!account || !["root", "dao", "company", "token"].includes(role)) throw new Error("Faucet only the root or contract accounts");
  if (KeyPair.fromString(account.privateKey).getPublicKey().toString() !== account.publicKey) throw new Error(`${role} key mismatch`);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not testnet");
  const existing = await provider.viewAccount({ accountId: account.accountId, blockQuery: { finality: "final" } }).catch(error => {
    if (/does not exist|unknown account|UNKNOWN_ACCOUNT/i.test(String(error))) return null;
    throw error;
  });
  if (existing) {
    const access = await provider.viewAccessKey({ accountId: account.accountId, publicKey: account.publicKey, finalityQuery: { finality: "final" } });
    if (access.permission !== "FullAccess") throw new Error(`${role} lacks its generated full-access key`);
    console.log(JSON.stringify({ accountId: account.accountId, balanceYocto: String(existing.amount), status: "already exists" }));
    return;
  }
  const response = await fetch(faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: account.accountId, newAccountPublicKey: account.publicKey }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Faucet rejected account creation (${response.status}): ${body.slice(0, 300)}`);
  const created = await provider.viewAccount({ accountId: account.accountId, blockQuery: { finality: "final" } });
  const access = await provider.viewAccessKey({ accountId: account.accountId, publicKey: account.publicKey, finalityQuery: { finality: "final" } });
  if (access.permission !== "FullAccess") throw new Error("Faucet account lacks the generated full-access key");
  console.log(JSON.stringify({ accountId: account.accountId, balanceYocto: String(created.amount), status: "created" }));
}

async function createSubaccounts() {
  const data = JSON.parse(await readFile(credentialsPath, "utf8"));
  const provider = new JsonRpcProvider({ url: rpcUrl });
  if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not testnet");
  const rootAccess = await provider.viewAccessKey({ accountId: data.root.accountId, publicKey: data.root.publicKey, finalityQuery: { finality: "final" } });
  if (rootAccess.permission !== "FullAccess") throw new Error("Root account key lacks full access");
  const rootAccount = new Account(data.root.accountId, provider, data.root.privateKey);
  for (const [role, balance] of Object.entries(initialBalances)) {
    const account = data.accounts[role];
    if (!account) continue; // bundles created before a role existed
    if (KeyPair.fromString(account.privateKey).getPublicKey().toString() !== account.publicKey) throw new Error(`${role} key mismatch`);
    const existing = await provider.viewAccount({ accountId: account.accountId, blockQuery: { finality: "final" } }).catch(error => {
      if (/does not exist|unknown account|UNKNOWN_ACCOUNT/i.test(String(error))) return null;
      throw error;
    });
    if (existing) {
      const access = await provider.viewAccessKey({ accountId: account.accountId, publicKey: account.publicKey, finalityQuery: { finality: "final" } });
      if (access.permission !== "FullAccess") throw new Error(`${role} lacks its generated full-access key`);
      console.log(JSON.stringify({ role, accountId: account.accountId, balanceYocto: String(existing.amount), status: "already exists" }));
      continue;
    }
    const result = await rootAccount.createSubAccount({ accountOrPrefix: account.accountId, publicKey: account.publicKey, nearToTransfer: balance });
    const created = await provider.viewAccount({ accountId: account.accountId, blockQuery: { finality: "final" } });
    await provider.viewAccessKey({ accountId: account.accountId, publicKey: account.publicKey, finalityQuery: { finality: "final" } });
    console.log(JSON.stringify({ role, accountId: account.accountId, balanceYocto: String(created.amount), transaction: result.transaction.hash, status: "created" }));
  }
}

async function verifyAccounts() {
  const data = JSON.parse(await readFile(credentialsPath, "utf8"));
  const provider = new JsonRpcProvider({ url: rpcUrl });
  if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not testnet");
  const env = await readFile(envPath, "utf8");
  const expectedEnv = {
    CAPTAB_DAO_ACCOUNT_ID: data.accounts.dao.accountId,
    CAPTAB_COMPANY_ACCOUNT_ID: data.accounts.company.accountId,
    CAPTAB_TOKEN_ACCOUNT_ID: data.accounts.token.accountId,
    CAPTAB_OPERATOR_ACCOUNT_ID: data.accounts.operator.accountId,
    CAPTAB_EXECUTOR_ACCOUNT_ID: data.accounts.executor.accountId,
    CAPTAB_RELAYER_ACCOUNT_ID: data.accounts.relayer.accountId,
    CAPTAB_COUNCIL_ACCOUNTS: ["council1", "council2", "council3"].map(role => data.accounts[role].accountId).join(","),
  };
  for (const [name, value] of Object.entries(expectedEnv)) {
    if (!env.split("\n").includes(`${name}=${value}`)) throw new Error(`${name} does not match the local key bundle`);
  }
  const privateKeyEnv = {
    CAPTAB_DAO_PRIVATE_KEY: data.accounts.dao.privateKey,
    CAPTAB_COMPANY_PRIVATE_KEY: data.accounts.company.privateKey,
    CAPTAB_TOKEN_PRIVATE_KEY: data.accounts.token.privateKey,
    CAPTAB_EXECUTOR_PRIVATE_KEY: data.accounts.executor.privateKey,
    CAPTAB_RELAYER_PRIVATE_KEY: data.accounts.relayer.privateKey,
  };
  for (const [name, value] of Object.entries(privateKeyEnv)) {
    if (!env.split("\n").includes(`${name}=${value}`)) throw new Error(`${name} does not match the local key bundle`);
  }
  for (const path of [credentialsPath, envPath]) {
    if (((await stat(path)).mode & 0o777) !== 0o600) throw new Error(`${path} must have mode 0600`);
  }
  const entries = [["root", data.root], ...Object.entries(data.accounts)];
  for (let offset = 0; offset < entries.length; offset += 3) {
    const batch = entries.slice(offset, offset + 3);
    const results = await Promise.all(batch.map(async ([role, account]) => {
      if (KeyPair.fromString(account.privateKey).getPublicKey().toString() !== account.publicKey) throw new Error(`${role} private/public key mismatch`);
      const [state, access] = await Promise.all([
        provider.viewAccount({ accountId: account.accountId, blockQuery: { finality: "final" } }),
        provider.viewAccessKey({ accountId: account.accountId, publicKey: account.publicKey, finalityQuery: { finality: "final" } }),
      ]);
      if (access.permission !== "FullAccess") throw new Error(`${role} lacks its generated full-access key`);
      return { role, accountId: account.accountId, balanceYocto: String(state.amount), key: "verified" };
    }));
    for (const result of results) console.log(JSON.stringify(result));
  }
}

async function fundCouncil() {
  const data = JSON.parse(await readFile(credentialsPath, "utf8"));
  const provider = new JsonRpcProvider({ url: rpcUrl });
  if (await provider.getNetworkId() !== "testnet") throw new Error("RPC endpoint is not testnet");
  const source = new Account(data.root.accountId, provider, data.root.privateKey);
  const minimum = 1_500_000_000_000_000_000_000_000n;
  for (const role of ["council1", "council2", "council3"]) {
    const recipientId = data.accounts[role].accountId;
    const state = await provider.viewAccount({ accountId: recipientId, blockQuery: { finality: "final" } });
    const shortfall = minimum > BigInt(state.amount) ? minimum - BigInt(state.amount) : 0n;
    if (shortfall === 0n) {
      console.log(JSON.stringify({ role, accountId: recipientId, balanceYocto: String(state.amount), status: "funded" }));
      continue;
    }
    const result = await source.signAndSendTransaction({ receiverId: recipientId, actions: [actions.transfer(shortfall)], waitUntil: "FINAL" });
    const updated = await provider.viewAccount({ accountId: recipientId, blockQuery: { finality: "final" } });
    if (BigInt(updated.amount) < minimum) throw new Error(`${role} top-up did not finalize; inspect ${result.transaction.hash}`);
    console.log(JSON.stringify({ role, accountId: recipientId, balanceYocto: String(updated.amount), transaction: result.transaction.hash, status: "funded" }));
  }
}

if (process.argv.includes("--init")) await initialize();
else if (process.argv.includes("--faucet-root")) await faucetAccount("root");
else if (process.argv.includes("--faucet-role")) await faucetAccount(process.argv[process.argv.indexOf("--faucet-role") + 1]);
else if (process.argv.includes("--create-subaccounts")) await createSubaccounts();
else if (process.argv.includes("--verify")) await verifyAccounts();
else if (process.argv.includes("--fund-council")) await fundCouncil();
else await show();
