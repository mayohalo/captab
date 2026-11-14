/** How the pieces fit: the board (a DAO) is the only caller that can change the company ledger; money moves through the token. */
export function ArchitectureDiagram() {
  const box = (x: number, y: number, w: number, h: number, tone: string, title: string, sub: string, sub2?: string) =>
    <g>
      <rect x={x} y={y} width={w} height={h} rx="14" fill="var(--surface)" stroke={tone} strokeWidth="2" />
      <text x={x + w / 2} y={y + 30} textAnchor="middle" className="dg-title">{title}</text>
      <text x={x + w / 2} y={y + 52} textAnchor="middle" className="dg-sub">{sub}</text>
      {sub2 && <text x={x + w / 2} y={y + 70} textAnchor="middle" className="dg-sub">{sub2}</text>}
    </g>;
  const arrow = (d: string, label: string, lx: number, ly: number, anchor: "start" | "middle" | "end" = "middle") =>
    <g><path d={d} className="dg-line" markerEnd="url(#dg-arrow)" /><text x={lx} y={ly} textAnchor={anchor} className="dg-label">{label}</text></g>;
  return <figure className="diagram">
    <svg viewBox="0 0 900 400" role="img" aria-labelledby="dg-title dg-desc">
      <title id="dg-title">Captab architecture</title>
      <desc id="dg-desc">Council members vote in a Sputnik DAO. Only the DAO can change the company contract, which keeps the ownership ledger.
        Investors and buyers pay through the TESTUSD token, which calls the company contract; payouts flow back through the token.
        The web app prepares proposals and reads the ledger; holders sign their own grants and deals; a worker observes receipts and a relayer pays gas for contributors.</desc>
      <defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" /></marker></defs>
      {box(20, 30, 220, 84, "var(--mint)", "Board", "Sputnik DAO, 2 of 3 council", "votes on every change")}
      {box(340, 30, 220, 84, "var(--blue)", "Company contract", "the ownership ledger (Rust)", "vesting, deals, payouts")}
      {box(660, 30, 220, 84, "var(--gold)", "Settlement token", "NEP-141 (TESTUSD)", "investor money, payouts")}
      {box(20, 260, 220, 84, "var(--line-strong)", "Captab app", "Next.js: read, propose,", "export, plan rounds")}
      {box(340, 260, 220, 84, "var(--violet)", "Holders", "founders, contributors,", "investors, buyers")}
      {box(660, 260, 220, 84, "var(--line-strong)", "Worker and relayer", "observe receipts, pay out,", "sponsor zero-NEAR claims")}
      {arrow("M240,72 L336,72", "only caller", 288, 62)}
      {arrow("M656,60 L564,60", "ft_on_transfer", 610, 50)}
      {arrow("M564,90 L656,90", "payouts", 610, 108)}
      {arrow("M130,256 L130,118", "proposals, votes", 140, 190, "start")}
      {arrow("M220,256 L372,118", "reads", 266, 238, "start")}
      {arrow("M430,256 L430,118", "accept, claim", 440, 170, "start")}
      {arrow("M540,256 L692,118", "pay for units", 626, 200, "start")}
      {arrow("M800,256 L800,118", "pays, observes", 810, 190, "start")}
      {arrow("M656,302 L564,302", "sponsors gas", 610, 292)}
    </svg>
    <figcaption>The company contract accepts ledger changes only from the DAO. Holders sign for their own grants and deals; money moves through the token in the same transaction as the units it pays for.</figcaption>
  </figure>;
}
