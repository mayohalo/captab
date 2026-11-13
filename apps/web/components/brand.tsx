import Link from "next/link";

/**
 * The Captab mark: a unicorn horn built from four cap-table bands (founders, team, investors, exit),
 * twisted like a spiral, with a spark at the tip. Same geometry as the motion demo's logo.
 */
const BAND_COLORS = ["var(--mint)", "var(--blue)", "var(--violet)", "var(--gold)"];
const CUTS: [number, number][] = [[94, 94], [79, 69], [59, 49], [39, 29]]; // [left y, right y]; slanted cuts read as a spiral
const GAP = 2.6;
const left = (y: number) => 50 - (17 * (y - 6)) / 88;
const right = (y: number) => 50 + (17 * (y - 6)) / 88;

const BANDS = CUTS.map(([l0, r0], index) => {
  const points: [number, number][] = [[left(l0), l0], [right(r0), r0]];
  if (index < CUTS.length - 1) {
    const [l1, r1] = CUTS[index + 1];
    points.push([right(r1 + GAP), r1 + GAP], [left(l1 + GAP), l1 + GAP]);
  } else points.push([50, 6]);
  return points.map(point => point.map(value => value.toFixed(2)).join(",")).join(" ");
});

function star(x: number, y: number, r: number) {
  return `M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z`;
}

export function HornLogo({ size = 32, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  return <svg className={["horn", animated ? "horn-animated" : "", className ?? ""].join(" ").trim()} width={size} height={size}
    viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <g transform="rotate(22 50 55)">
      {BANDS.map((points, index) => <polygon key={index} className="band" style={{ ["--i" as string]: index }} points={points}
        fill={BAND_COLORS[index]} stroke={BAND_COLORS[index]} strokeWidth="1.2" strokeLinejoin="round" />)}
    </g>
    <path className="spark" d={star(85, 20, 10)} fill="var(--spark)" />
    <path className="spark spark-small" d={star(90, 38, 4.5)} fill="var(--spark)" opacity=".8" />
  </svg>;
}

export function TopBar() {
  return <header className="topbar">
    <Link className="brand" href="/" aria-label="Captab home"><HornLogo size={30} /><span>Captab</span></Link>
    <span className="network-pill"><i aria-hidden="true" />NEAR testnet</span>
  </header>;
}

type Tone = "good" | "info" | "warn" | "bad" | "muted";

const TONES: Record<string, Tone> = {
  Paid: "good", Settled: "good", Funded: "good", Active: "good", Delivered: "good", Closed: "muted", Open: "info",
  InFlight: "info", Ready: "warn", Accepted: "info", Approved: "info", Pending: "warn", Unpaid: "warn", Failed: "bad", Cancelled: "muted",
  Expired: "muted", Zero: "muted", Rejected: "bad", InProgress: "warn", Removed: "muted",
};

/** A status label with a color from the theme. Unknown states render neutral. */
export function Pill({ status, tone }: { status: string; tone?: Tone }) {
  return <span className="pill" data-tone={tone ?? TONES[status] ?? "muted"}>{status}</span>;
}
