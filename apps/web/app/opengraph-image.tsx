import { ImageResponse } from "next/og";

export const alt = "Captab: cap tables on NEAR, from day zero to unicorn";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CUTS: [number, number][] = [[94, 94], [79, 69], [59, 49], [39, 29]];
const COLORS = ["#5EE6A8", "#7AA7FF", "#B79BFF", "#F5B54A"];
const left = (y: number) => 50 - (17 * (y - 6)) / 88;
const right = (y: number) => 50 + (17 * (y - 6)) / 88;
const BANDS = CUTS.map(([l0, r0], index) => {
  const points: [number, number][] = [[left(l0), l0], [right(r0), r0]];
  if (index < 3) { const [l1, r1] = CUTS[index + 1]; points.push([right(r1 + 2.6), r1 + 2.6], [left(l1 + 2.6), l1 + 2.6]); }
  else points.push([50, 6]);
  return points.map(point => point.map(value => value.toFixed(2)).join(",")).join(" ");
});

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 64, padding: "0 96px", background: "#0A0E13", color: "#ECF1F5" }}>
      <svg width="300" height="300" viewBox="0 0 100 100">
        <g transform="rotate(22 50 55)">{BANDS.map((points, index) => <polygon key={index} points={points} fill={COLORS[index]} />)}</g>
        <path d="M85,10 Q85,20 95,20 Q85,20 85,30 Q85,20 75,20 Q85,20 85,10Z" fill="#FFE7A8" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 30, letterSpacing: 6, color: "#5EE6A8", fontWeight: 700 }}>CAP TABLES ON NEAR</div>
        <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -5, lineHeight: 1 }}>Captab</div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 700, marginTop: 12 }}>From day zero&nbsp;<span style={{ color: "#B79BFF" }}>to unicorn.</span></div>
        <div style={{ fontSize: 28, color: "#8C99A7", marginTop: 24, maxWidth: 640 }}>Who owns what, governed by a DAO board. Found, hire, raise, trade, pay out, exit.</div>
      </div>
    </div>, size);
}
