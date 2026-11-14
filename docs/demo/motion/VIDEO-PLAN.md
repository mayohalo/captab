# Captab demo video v2: plan for review

Status: draft for review, 2026-11-14. Nothing rendered or changed yet.

## 1. What the current 30 s video gets wrong now

The video was cut on 2026-11-13 from the v1 MVP. Since then v2 shipped and went live, so the video now contradicts the README, the landing page, and the chain.

| In the video | Reality now |
| --- | --- |
| Roadmap scene: Investors and Share tokens are **ROADMAP** | Raise, Liquidity (secondary sale, buyback), and Exit payouts are **live on testnet** (v2). Only share tokens, the factory, and confidential amounts are next. |
| Fixture numbers: 10,000,000 authorized, founders 3.6M / 2.4M, 10,000 TESTUSD distribution | Live company: 12,000,000 authorized, 7,145,000 issued, 6 holders, 17 board proposals, 3 settled deals, a 2,000 TESTUSD payout list, 72,940 TESTUSD treasury |
| End card: 28 Rust · 8 Sandbox · 18 browser tests | 74 Rust · 9 Sandbox · 26 browser tests |
| Four stages (govern, own, vest, distribute) | The site and README tell a seven-stage story: Found → Hire → Raise → Operate → Liquidity → Pay holders → Exit |
| No live footage | captab.xyz serves the live company; every page loads from chain |

## 2. Docs and site: what to fix (blocking first)

> Update while drafting: `AGENTS.md` was just changed on disk to 17 proposals and 6 holders, and it names **Meteor Wallet** for `captab.testnet` (`accept_grant`, `claim_vested`, NEP-413 sign-in). So items 1, 3 and 4 below are already under way somewhere. Treat them as a checklist for whatever is still missing.

**Blocking: the judges' verifier fails on `main` right now.** `node apps/web/scripts/verify-evidence.mjs` reports 5 failed checks against the committed evidence (4 against the uncommitted working copy). The live company moved after the evidence was recorded: proposal #16 granted 10,000 units to `captab.testnet`, which then accepted and claimed 5,000 (15:14 UTC). Live is now ledger revision 16, 6 holders, 7,145,000 issued, pool 1,790,000, reserved 440,000. AGENTS.md tells judges to run this verifier first and expect every line PASS.

1. Finish the wallet test, then re-record `docs/testnet-v2-rehearsal.json` (final state plus the accept/claim transactions) and commit it together with the modified `rehearse-v2-testnet.mjs`. The verifier must print `All checks passed: 17 DAO proposals, 3 deals, 6 holders.`
2. After that, stop writing to the live company until judging ends. Optionally, make the verifier tolerant of later activity: recorded proposals and deals must still pass, and totals drift would be reported as a note, not a failure.
3. Update the hard-coded live figures (16 proposals → 17, 7,140,000 → 7,145,000, 5 → 6 holders, revision 14 → 16):
   - `README.md` lines 47, 51, 64, 103
   - `docs/SUBMISSION.md` line 25
   - `docs/EVIDENCE.md` lines 9, 28–37 (sample output), 60
   - `AGENTS.md` line 15
   - `llms.txt` lines 26, 34
   - `docs/RELEASE_STATUS.md` line 37
   - `apps/web/app/page.tsx` line 150 ("all 16 board proposals")

   Better: have the landing page derive these counts from the evidence file, as it already does for `LIVE_STEPS`.
4. **Wallets.** If `captab.testnet` signed with a third-party wallet extension, this resolves the "third-party wallets are not yet verified" limit. Name the wallet and link the accept and claim transactions in Honest limits in README, SUBMISSION, the landing page, AGENTS.md ("What is not implemented"), and llms.txt. The video can then say it too.

**For the video itself:**

5. Swap the "30-second video" links for the new cut (README line 9, SUBMISSION line 3, `docs/demo/README.md` line 7). Keep the 30 s file as a teaser, or delete it so nothing stale remains (your call).
6. The landing page has **no video** today. Add one: a `<video>` with a poster in the hero or above "Proof, not promises", served from `apps/web/public/` or YouTube, plus a link in `llms.txt`.
7. Optional UI fix that also helps the video: Deals and Distributions show raw base units ("10,000,000,000 token base units"). Showing TESTUSD with 6 decimals (10,000 TESTUSD) reads far better on screen and for judges.

## 3. Proposed cut: about 80 s, 1080p30, captions + music

Scene boundaries sit on the music's 2 s bars. Acts 1–2 reuse and extend the existing motion scenes, with the live company's real numbers. Act 3 is real captab.xyz footage.

| Time | Scene | On screen | Caption |
| --- | --- | --- | --- |
| **Act 1: why** | | | |
| 0–6 | Title | Horn logo builds, "Captab · From day zero to unicorn", testnet tag | Captab: your company's cap table on NEAR, from day zero to unicorn. |
| 6–12 | Problem (new) | A spreadsheet, approval emails, and manual payouts collapse into one contract + DAO board | Cap tables live in spreadsheets; approvals arrive by email; payouts are reconciled by hand. |
| **Act 2: the journey (live numbers)** | | | |
| 12–18 | 1 Found | Charter to 12,000,000 units with a document SHA-256 chip; founder split; 2-of-3 vote → executes (existing govern scene, condensed) | The board is a 2-of-3 DAO. Every change is a proposal it votes on. |
| 18–24 | 2 Hire | Grant timeline to the cliff; contributor signs terms; zero-NEAR claim (existing vest scene; the live grant #0 already matches: 100,000 granted, 25,000 claimed) | Contributors sign their terms and claim vested units with zero NEAR. |
| 24–30 | 3 Raise (new) | Seed round at 0.01 TESTUSD/unit; a wrong payment bounces back (refund); the exact 10,000 TESTUSD issues 1,000,000 units in the same transaction; money lands in the treasury | An investor's payment issues their units in the same transaction, or it is refunded. |
| 30–36 | 5 Liquidity (new) | Secondary sale: founder B → angel, 100,000 units for 1,500 TESTUSD. Board approves, seller signs, proceeds held → retried → delivered. Buyback: 5,000 units for 60 TESTUSD, retired | Early holders can sell. Nothing moves without the board and the holder's signature. |
| 36–42 | 6–7 Pay & exit | Payout list of 2,000 TESTUSD: investor 1,000 (preference first), founder A 500, founder B 350, angel 100, contributor 50, all PAID; waterfall → payout list; `close_company` chip marked "Sandbox" | Exit proceeds follow the preference waterfall and pay each holder exactly once. |
| 42–48 | Cap table now | Live bar: 12,000,000 authorized · 7,145,000 issued · 440,000 grants · 1,790,000 pool · 2,625,000 free; invariant line | One ledger, always reconciled: supply never exceeds what is authorized. |
| **Act 3: it is already working (real footage)** | | | |
| 48–56 | captab.xyz | Browser frame with the address bar. Landing hero → live cap table bar → the 7-stage journey, smooth scroll | And it is live. This is captab.xyz, read straight from NEAR testnet. |
| 56–64 | Live company | `captab.xyz/company/captab-company-0d07…testnet`: stage tracker (5 checked, Exit open) zooms in; KPI tiles; ownership table with 6 holders; cursor taps Deals | The live company: 6 holders, 3 deals settled, every board vote on chain. |
| 64–70 | Proof cuts | 2 s each: Deals (3 × Settled) → Distributions (all Paid) → Approvals (#16 Approved), each with a highlight box | Every deal settled, every payout paid, every proposal approved. |
| 70–76 | Verify it yourself | Terminal types `node apps/web/scripts/verify-evidence.mjs`; real PASS lines scroll; final `All checks passed: 17 DAO proposals, 3 deals, 6 holders.` | Don't trust the video: one command re-checks it all against the chain. |
| **Act 4: where it goes** | | | |
| 76–80 | Road | 7 stages LIVE (Exit's close marked Sandbox) → NEXT: share tokens, factory deploy, confidential amounts → the unicorn node | Live today, end to end. Next: share tokens and one-click company deploys. |
| 80–84 | End card | Logo, captab.xyz · github.com/mayohalo/captab · 74 Rust · 9 Sandbox · 26 browser tests · disclaimer | Captab. From day zero to unicorn, governed on NEAR. |

Total: 84 s. To land nearer 70 s, merge Problem into Title and cut "Cap table now"; both are marked so they drop cleanly.

## 4. How the live part is made

- **Capture at render time.** A new `capture-live.mjs` uses Playwright to load captab.xyz pages at 1920 px in dark mode and saves full-page PNGs (landing, company overview, deals, distributions, approvals). It also runs `verify-evidence.mjs` and saves its real stdout.
- **Animate deterministically.** The HTML timeline places each capture inside a browser frame and animates scroll, zoom, highlight boxes, and a cursor over the real pixels. Frames stay exact and crisp, unlike a jittery screen recording. A small label in the frame reads "captab.xyz · live · captured 2026-11-14".
- The cursor and clicks are animation over real captures. No wallet prompt is shown, since visitors are read-only, and the captions don't claim one.
- **Live numbers are read at render time** from the company views, so the motion scenes in Act 2 never drift from the footage.
- Optional: a 2 s NearBlocks shot of a settled-deal transaction as third-party proof. It's skipped if the explorer blocks headless capture.

## 5. Sound

Same original synthesized bed, extended: a pad intro (Act 1), the drums enter with the journey (Act 2), a short breakdown and riser into "it is live" at 48 s, then full energy through the proof cuts and an outro on the end card. New cues: a coin tick on each settled payment, a refund "bounce", and soft UI clicks synced to the cursor. Loudness target stays −15 LUFS. Captions are burned in, with an SRT. No voiceover unless you want one.

## 6. Decisions for you

1. Is the Meteor Wallet test on `captab.testnet` finished, so I can snapshot live numbers? Should the Hire scene say "signed from Meteor Wallet"?
2. Length: about 84 s as planned, or trimmed to about 70 s?
3. Keep the 30 s cut as a teaser, or replace it?
4. Fix the verifier and docs (section 2, items 1–4) first? The video's terminal scene needs `All checks passed`.
