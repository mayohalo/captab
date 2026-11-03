import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ensureCompany, openDatabase } from "../lib/db.ts";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "captab-worker-server-restart-"));
const filename = join(directory, "captab.sqlite");
const secret = "local-restart-rehearsal-secret";
let rpc;
let server;
let worker;

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolveClose, rejectClose) => listener.close(error => error ? rejectClose(error) : resolveClose()));
  return port;
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: webDir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-4000); });
  child.output = () => output;
  return child;
}

async function waitReady(url, child) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Service exited before readiness: ${child.output()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Wait for the listener. */ }
    await delay(100);
  }
  throw new Error(`Service did not become ready: ${child.output()}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timer;
  await Promise.race([once(child, "exit"), new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, 5000); })]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

function inspectJobs() {
  const db = openDatabase(filename);
  try {
    return db.prepare("SELECT recipient_id, attempt_id, submission_state, tx_hash FROM payment_jobs ORDER BY recipient_id").all();
  } finally { db.close(); }
}

async function runWorker(baseUrl) {
  worker = start(process.execPath, ["scripts/reconcile-worker.mjs", "--once"], {
    CAPTAB_BASE_URL: baseUrl, CAPTAB_WORKER_SECRET: secret,
  });
  let timer;
  const [code] = await Promise.race([once(worker, "exit"), new Promise((_, rejectTimeout) => {
    timer = setTimeout(() => rejectTimeout(new Error(`Worker timed out: ${worker.output()}`)), 30_000);
  })]).finally(() => clearTimeout(timer));
  assert.equal(code, 0, worker.output());
  worker = undefined;
}

try {
  const db = openDatabase(filename);
  try {
    const companyId = ensureCompany(db, "company.testnet", "board.testnet");
    db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state, updated_at)
      VALUES (?, 0, 'contributor.testnet', 2, 'Claimed', datetime('now', '-121 seconds'))`).run(companyId);
    db.prepare(`INSERT INTO payment_jobs (company_id, distribution_id, recipient_id, attempt_id, submission_state)
      VALUES (?, 0, 'founder-a.testnet', 2, 'Queued')`).run(companyId);
  } finally { db.close(); }

  const rpcPort = await freePort();
  let webPort = await freePort();
  while (webPort === rpcPort) webPort = await freePort();
  rpc = start(process.execPath, ["--experimental-strip-types", "e2e/fixture-rpc.mjs"], { CAPTAB_FIXTURE_RPC_PORT: String(rpcPort) });
  await waitReady(`http://127.0.0.1:${rpcPort}/health`, rpc);
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const webEnv = { NEAR_RPC_URL: `http://127.0.0.1:${rpcPort}`, CAPTAB_DB_PATH: filename,
    CAPTAB_WORKER_SECRET: secret, CAPTAB_COMPANY_CODE_HASH: "fixture-company-code-hash",
    CAPTAB_EXECUTOR_PRIVATE_KEY: "" };
  const nextBin = resolve(webDir, "node_modules/next/dist/bin/next");
  const startWeb = () => start(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(webPort)], webEnv);

  server = startWeb();
  await waitReady(baseUrl, server);
  await runWorker(baseUrl);
  await stop(server);
  server = undefined;
  assert.deepEqual(inspectJobs(), [
    { recipient_id: "contributor.testnet", attempt_id: 2, submission_state: "NeedsReview", tx_hash: null },
    { recipient_id: "founder-a.testnet", attempt_id: 2, submission_state: "Queued", tx_hash: null },
  ]);

  server = startWeb();
  await waitReady(baseUrl, server);
  await runWorker(baseUrl);
  assert.deepEqual(inspectJobs(), [
    { recipient_id: "contributor.testnet", attempt_id: 2, submission_state: "NeedsReview", tx_hash: null },
    { recipient_id: "founder-a.testnet", attempt_id: 2, submission_state: "Queued", tx_hash: null },
  ]);
  console.log("Worker/server restart rehearsal passed: stale claim remains under review and blocks queued payments.");
} finally {
  await stop(worker);
  await stop(server);
  await stop(rpc);
  rmSync(directory, { recursive: true, force: true });
}
