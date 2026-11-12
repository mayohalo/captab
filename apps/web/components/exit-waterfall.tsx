"use client";

import { useMemo, useState } from "react";
import type { Grant, Holding } from "../lib/near";
import { formatCents, parseMoneyCents } from "../lib/round-model";
import { computeWaterfall, parseMultipleBps, type Preference, type UnvestedTreatment } from "../lib/waterfall";

type PreferenceDraft = { accountId: string; invested: string; multiple: string; participating: boolean };

export function ExitWaterfall({ holdings, grants }: { holdings: Holding[]; grants: Grant[] }) {
  const accounts = useMemo(() => holdings.map(holding => holding.account_id).sort(), [holdings]);
  const [proceeds, setProceeds] = useState("10000000");
  const [unvested, setUnvested] = useState<UnvestedTreatment>("accelerate");
  const [drafts, setDrafts] = useState<PreferenceDraft[]>([]);
  const update = (index: number, change: Partial<PreferenceDraft>) =>
    setDrafts(current => current.map((draft, position) => position === index ? { ...draft, ...change } : draft));
  const unused = accounts.find(account => !drafts.some(draft => draft.accountId === account));

  const outcome = useMemo(() => {
    const proceedsCents = parseMoneyCents(proceeds);
    if (proceedsCents === null) return { error: "Enter exit proceeds as a whole or two-decimal number." };
    const preferences: Preference[] = [];
    for (const draft of drafts) {
      const investedCents = parseMoneyCents(draft.invested);
      const multipleBps = parseMultipleBps(draft.multiple);
      if (investedCents === null || multipleBps === null) return { error: `Check the preference amounts for ${draft.accountId}.` };
      preferences.push({ accountId: draft.accountId, investedCents, multipleBps, participating: draft.participating });
    }
    try { return { result: computeWaterfall({ holdings, grants, proceedsCents, unvested, preferences }) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "Unable to compute the waterfall." }; }
  }, [proceeds, unvested, drafts, holdings, grants]);
  const result = "result" in outcome ? outcome.result : null;

  return <section id="exit-waterfall" aria-labelledby="exit-waterfall-title">
    <h2 id="exit-waterfall-title">Preview an exit</h2>
    <p>Projection only. Splits sale proceeds across issued units and grants, after any liquidation preferences you enter. Non-participating holders convert to common when that pays them more.</p>
    <div className="governance-form">
      <label>Exit proceeds (USD)<input inputMode="decimal" value={proceeds} onChange={event => setProceeds(event.target.value)} /></label>
      <label>Unvested grant units<select value={unvested} onChange={event => setUnvested(event.target.value as UnvestedTreatment)}>
        <option value="accelerate">Accelerate: count them as vested</option><option value="cancel">Cancel: count vested units only</option>
      </select></label>
      {drafts.map((draft, index) => <fieldset key={index} className="preference-row">
        <legend>Preference {index + 1}</legend>
        <label>Holder<select value={draft.accountId} onChange={event => update(index, { accountId: event.target.value })}>
          {accounts.filter(account => account === draft.accountId || !drafts.some(other => other.accountId === account))
            .map(account => <option key={account} value={account}>{account}</option>)}
        </select></label>
        <label>Invested (USD)<input inputMode="decimal" value={draft.invested} onChange={event => update(index, { invested: event.target.value })} /></label>
        <label>Multiple<input inputMode="decimal" value={draft.multiple} onChange={event => update(index, { multiple: event.target.value })} /></label>
        <label className="checkbox"><input type="checkbox" checked={draft.participating} onChange={event => update(index, { participating: event.target.checked })} />Participating</label>
        <button type="button" onClick={() => setDrafts(current => current.filter((_, position) => position !== index))}>Remove</button>
      </fieldset>)}
      {unused && <button type="button" onClick={() => setDrafts(current => [...current, { accountId: unused, invested: "2000000", multiple: "1", participating: false }])}>Add liquidation preference</button>}
    </div>
    {"error" in outcome && <p role="alert">{outcome.error}</p>}
    {result && <>
      <div className="table-scroll" role="region" aria-label="Exit waterfall table" tabIndex={0}><table>
        <thead><tr><th>Account</th><th>Units at exit</th><th>Basis</th><th>Payout</th><th>Pro rata, no preferences</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.accountId}><td>{row.accountId}</td><td>{row.units.toLocaleString("en-US")}</td>
          <td>{row.converted ? "Converted to common" : !row.takesPreference ? "Common"
            : `Preference ${formatCents(row.preferenceCents)}${drafts.find(draft => draft.accountId === row.accountId)?.participating ? " + common" : ""}`}</td>
          <td>{formatCents(row.payoutCents)}</td><td>{formatCents(row.proRataCents)}</td></tr>)}
          <tr><td><strong>Total</strong></td><td>{result.totalUnits.toLocaleString("en-US")}</td><td></td>
            <td data-testid="waterfall-total">{formatCents(result.rows.reduce((sum, row) => sum + row.payoutCents, 0n))}</td>
            <td>{formatCents(result.rows.reduce((sum, row) => sum + row.proRataCents, 0n))}</td></tr></tbody>
      </table></div>
      <p>Today the contract pays distributions pro rata to issued units only. Paying this schedule needs a board-approved distribution with an explicit payout list, which is on the roadmap.</p>
    </>}
  </section>;
}
