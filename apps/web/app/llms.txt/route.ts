import { DEPLOYMENTS, LIVE_STEPS, TEST_COUNTS, accountUrl, txUrl } from "../../lib/evidence";

export const dynamic = "force-static";

/** A plain-text summary for language-model agents (https://llmstxt.org): what Captab is, what is built, and where the evidence is. */
export function GET() {
  const v2 = DEPLOYMENTS.v2;
  const body = `# Captab

> Captab keeps a company's cap table (who owns what) in a NEAR smart contract governed by a DAO board. It covers founding, vesting grants, priced investor rounds, secondary sales, buybacks, exact payouts, and exit. NEAR testnet prototype; units are on-chain ledger records, not legal shares or tokens.

## What it does
- Board: a Sputnik DAO council (2 of 3 on testnet) votes on every issuance, grant, round, deal, and payout. The company contract accepts ledger changes only from the DAO.
- Rules in code: supply never exceeds authorized units; vesting follows monthly boundaries with any cliff; actions are replay-safe; no unit moves without the holder's signature.
- Money moves with ownership: an investor pays with NEP-141 ft_transfer_call and the units are issued in the same receipt, or the payment is refunded. Payouts sum exactly to the budget and pay each holder once, retry-safe.
- Privacy: holdings, grants, deals, payouts, and votes are public on chain. Names and emails stay off-chain behind NEP-413 wallet sign-in (council sees all; holders see their own). Documents are stored only as SHA-256 fingerprints. Amounts are public today.
- Tokenization: built today is a restricted on-chain ownership ledger. Next is one restricted NEP-141 token per share class migrated from a hashed export; legal-share wrappers are future work.

## Live deployment (NEAR testnet, schema v2)
- Company contract: ${v2.company} (${accountUrl(v2.company)})
- DAO board: ${v2.dao} (${accountUrl(v2.dao)})
- Settlement token (TESTUSD, 6 decimals): ${v2.token} (${accountUrl(v2.token)})
- Earlier MVP (schema v1): ${DEPLOYMENTS.v1.company}

## Evidence: live testnet transactions
${LIVE_STEPS.map(step => `- ${step.stage}: ${step.what}. ${step.links.map(link => `${link.label} ${txUrl(link.tx)}`).join("; ")}`).join("\n")}

## Tests
${TEST_COUNTS.map(test => `- ${test.value} ${test.label}: ${test.detail}`).join("\n")}

## How it is built
- Rust company contract on near-sdk 5.17 (modules: ledger, grants, distributions, deals)
- Pinned Sputnik DAO (commit 5434a59, WASM SHA-256 verified)
- NEP-141 payments, NEP-366 sponsored (zero-NEAR) claims, NEP-413 sign-in, NEP-297 events
- Next.js app with a SQLite receipt and payment worker

## Limits
- Testnet only; fictional holders; TESTUSD is a demo token.
- close_company is proven on a local NEAR Sandbox chain, not on the live company.
- Signing used local test keys; third-party wallet extensions are not yet verified.
- An IPO itself happens off-chain; Captab provides a verifiable export, pays proceeds, and closes the ledger.

## Pages
- /company/${v2.company}: live overview with stage tracker
- /company/${v2.company}/deals: rounds, issuance, secondary sales, buybacks
- /api/companies/${v2.company}/export?format=csv: cap table export with ledger revision and SHA-256 headers
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
