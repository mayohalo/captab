// Renders index.html frame by frame, synthesizes the music bed, and muxes an H.264/AAC MP4 + SRT.
// Usage: node docs/demo/motion/render.mjs [--stills 2,6.5,12 [--stills-dir dir]] [--out path.mp4] [--fps 30]
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { synthesize, writeWav } from "./music.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const fps = Number(opt("--fps", 30));
const out = path.resolve(opt("--out", path.join(here, "../captab-motion-30s.mp4")));
const stills = opt("--stills");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
const { duration, captions, cues, scenes } = await page.evaluate(() =>
  ({ duration: window.DURATION, captions: window.CAPTIONS, cues: window.CUES, scenes: window.SCENES }));

if (stills) {
  const dir = opt("--stills-dir", path.join(here, "stills"));
  mkdirSync(dir, { recursive: true });
  for (const s of stills.split(",").map(Number)) {
    await page.evaluate((t) => window.render(t), s);
    writeFileSync(path.join(dir, `t${s.toFixed(1)}.png`), await page.screenshot({ type: "png" }));
  }
  await browser.close();
  console.log(`stills written to ${dir}`);
  process.exit(0);
}

const work = mkdtempSync(path.join(tmpdir(), "captab-motion-"));
const video = path.join(work, "video.mp4"), audio = path.join(work, "music.wav");
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", video], { stdio: ["pipe", "inherit", "inherit"] });
const total = Math.round(duration * fps);
for (let f = 0; f < total; f++) {
  await page.evaluate((t) => window.render(t), f / fps);
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 150 === 0) console.log(`frame ${f}/${total}`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
await browser.close();

writeWav(audio, synthesize({ duration, scenes, cues }));
const mux = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" });
if (mux.status !== 0) throw new Error("mux failed");

const ts = (s) => { const ms = Math.round(s * 1000); const p = (v, w = 2) => String(v).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
writeFileSync(out.replace(/\.mp4$/, ".srt"), captions.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join("\n"));
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out} (+ .srt)`);
