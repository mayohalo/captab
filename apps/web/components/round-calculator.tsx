"use client";

import { useMemo, useState } from "react";
import type { Holding, Totals } from "../lib/near";
import { formatBps, formatCents, formatMicros, modelRound, parseMoneyCents, parsePercentBps } from "../lib/round-model";

export function RoundCalculator({ totals, holdings }: { totals: Totals; holdings: Holding[] }) {
  const [preMoney, setPreMoney] = useState("8000000");
  const [investment, setInvestment] = useState("2000000");
  const [poolTarget, setPoolTarget] = useState("10");
  const [investor, setInvestor] = useState("Seed investor");
  const outcome = useMemo(() => {
    const preMoneyCents = parseMoneyCents(preMoney);
    const investmentCents = parseMoneyCents(investment);
    const targetPoolBps = poolTarget.trim() === "" ? 0n : parsePercentBps(poolTarget);
    if (preMoneyCents === null || investmentCents === null) return { error: "Enter amounts as whole or two-decimal numbers." };
    if (targetPoolBps === null) return { error: "Enter the pool target as a percentage below 100, with up to two decimals." };
    try { return { result: modelRound({ holdings, totals, preMoneyCents, investmentCents, targetPoolBps, investorLabel: investor }) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "Unable to model this round." }; }
  }, [preMoney, investment, poolTarget, investor, holdings, totals]);
  const result = "result" in outcome ? outcome.result : null;

  return <section id="round-calculator" aria-labelledby="round-calculator-title">
    <h2 id="round-calculator-title">Model a priced round</h2>
    <p>Projection only: nothing is proposed or signed. Uses current fully diluted units, with any pool top-up issued before the round so it dilutes existing holders, not the investor.</p>
    <div className="governance-form">
      <label>Pre-money valuation (USD)<input inputMode="decimal" value={preMoney} onChange={event => setPreMoney(event.target.value)} /></label>
      <label>Investment (USD)<input inputMode="decimal" value={investment} onChange={event => setInvestment(event.target.value)} /></label>
      <label>Available pool after the round (% of fully diluted)<input inputMode="decimal" value={poolTarget} onChange={event => setPoolTarget(event.target.value)} /></label>
      <label>Investor label<input value={investor} onChange={event => setInvestor(event.target.value)} /></label>
    </div>
    {"error" in outcome && <p role="alert">{outcome.error}</p>}
    {result && <>
      <p data-testid="round-summary">Post-money {formatCents(result.postMoneyCents)} · price per unit {formatMicros(result.pricePerUnitMicros)} ·
        new investor units {result.investorUnits.toLocaleString("en-US")} · pool top-up {result.poolTopUp.toLocaleString("en-US")}</p>
      {result.exceedsAuthorized
        ? <p role="alert">This round needs {result.newUnitsNeeded.toLocaleString("en-US")} new units but only {result.unallocatedBefore.toLocaleString("en-US")} are unallocated. The company&apos;s authorized units would have to increase first, which the current contract does not support.</p>
        : <p>Fits within unallocated capacity: {result.newUnitsNeeded.toLocaleString("en-US")} of {result.unallocatedBefore.toLocaleString("en-US")} units.</p>}
      <div className="table-scroll" role="region" aria-label="Round pro forma table" tabIndex={0}><table>
        <thead><tr><th>Stakeholder</th><th>Units before</th><th>Fully diluted before</th><th>Units after</th><th>Fully diluted after</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={`${row.kind}:${row.label}`}><td>{row.label}</td><td>{row.before.toLocaleString("en-US")}</td>
          <td>{formatBps(row.before, result.beforeFullyDiluted)}</td><td>{row.after.toLocaleString("en-US")}</td><td>{formatBps(row.after, result.afterFullyDiluted)}</td></tr>)}
          <tr><td><strong>Fully diluted total</strong></td><td>{result.beforeFullyDiluted.toLocaleString("en-US")}</td><td>100.00%</td>
            <td>{result.afterFullyDiluted.toLocaleString("en-US")}</td><td>100.00%</td></tr></tbody>
      </table></div>
      <p>Executing a round needs investor issuance and round records in the contract, which are on the roadmap. Today, the board can only issue founder units.</p>
    </>}
  </section>;
}
