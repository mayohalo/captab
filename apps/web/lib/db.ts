import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const schema = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'testnet'),
  contract_id TEXT NOT NULL,
  dao_id TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(network, contract_id)
);
CREATE TABLE IF NOT EXISTS stakeholders (
  company_id TEXT NOT NULL REFERENCES companies(id),
  account_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  PRIMARY KEY(company_id, account_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  challenge_nonce_hash TEXT NOT NULL UNIQUE,
  challenge_expires_at TEXT NOT NULL,
  verified_at TEXT,
  session_expires_at TEXT,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS proposals (
  network TEXT NOT NULL,
  dao_id TEXT NOT NULL,
  proposal_id INTEGER NOT NULL,
  action_id TEXT,
  payload_hash TEXT,
  observed_status TEXT NOT NULL,
  last_checked_at TEXT,
  PRIMARY KEY(network, dao_id, proposal_id)
);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  network TEXT NOT NULL CHECK (network = 'testnet'),
  tx_hash TEXT NOT NULL,
  signer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Failed', 'NeedsReview')),
  final_execution_status TEXT,
  outcome_json TEXT,
  check_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observed_at TEXT,
  UNIQUE(network, tx_hash)
);
CREATE TABLE IF NOT EXISTS receipt_observations (
  network TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  block_hash TEXT NOT NULL,
  executor_id TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(network, receipt_id)
);
CREATE TABLE IF NOT EXISTS chain_events (
  network TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  contract_id TEXT NOT NULL,
  event_version TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(network, receipt_id, log_index)
);
CREATE TABLE IF NOT EXISTS payment_jobs (
  company_id TEXT NOT NULL REFERENCES companies(id),
  distribution_id INTEGER NOT NULL,
  recipient_id TEXT NOT NULL,
  attempt_id INTEGER NOT NULL,
  submission_state TEXT NOT NULL,
  tx_hash TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(company_id, distribution_id, recipient_id, attempt_id)
);
CREATE TABLE IF NOT EXISTS sponsor_requests (
  delegate_digest TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  account_id TEXT NOT NULL,
  grant_id INTEGER NOT NULL,
  gas_budget TEXT NOT NULL,
  deposit_budget TEXT NOT NULL,
  outcome TEXT NOT NULL,
  tx_hash TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS operations_pending ON operations(status, created_at);
CREATE INDEX IF NOT EXISTS events_company ON chain_events(company_id, receipt_id);
CREATE INDEX IF NOT EXISTS payment_jobs_state ON payment_jobs(submission_state, updated_at);
CREATE INDEX IF NOT EXISTS sponsor_requests_rate ON sponsor_requests(account_id, created_at);
`;

export function openDatabase(filename: string) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  const columns = db.pragma("table_info(payment_jobs)") as { name: string }[];
  if (!columns.some(column => column.name === "last_error")) db.exec("ALTER TABLE payment_jobs ADD COLUMN last_error TEXT");
  const sponsorColumns = db.pragma("table_info(sponsor_requests)") as { name: string }[];
  if (!sponsorColumns.some(column => column.name === "tx_hash")) db.exec("ALTER TABLE sponsor_requests ADD COLUMN tx_hash TEXT");
  if (!sponsorColumns.some(column => column.name === "last_error")) db.exec("ALTER TABLE sponsor_requests ADD COLUMN last_error TEXT");
  return db;
}

let singleton: ReturnType<typeof openDatabase> | undefined;
export function getDatabase() {
  if (!singleton) singleton = openDatabase(process.env.CAPTAB_DB_PATH ?? join(process.cwd(), ".data", "captab.sqlite"));
  return singleton;
}

export function ensureCompany(db: Database.Database, contractId: string, daoId: string): string {
  db.prepare("INSERT INTO companies (id, network, contract_id, dao_id) VALUES (?, 'testnet', ?, ?) ON CONFLICT(network, contract_id) DO NOTHING")
    .run(randomUUID(), contractId, daoId);
  const row = db.prepare("SELECT id FROM companies WHERE network = 'testnet' AND contract_id = ?").get(contractId) as { id: string };
  return row.id;
}
