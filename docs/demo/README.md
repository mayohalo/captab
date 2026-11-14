# Demo media

## Live app

[captab.xyz](https://captab.xyz) serves the schema v2 company read live from NEAR testnet. Screenshots taken from the live site on 2026-11-14: [landing page](live-hero.png), [company overview with the stage tracker](live-overview.png), [rounds and deals](live-deals.png).

The [30-second motion overview](captab-motion-30s.mp4) (with [captions](captab-motion-30s.srt)) explains the product; its source is in [`motion/`](motion/) and re-renders with `node docs/demo/motion/render.mjs`.

## Fixture walkthrough

The [short walkthrough video](fixture-walkthrough.webm) and nine screenshots show the local browser fixture: the home page with the founding-to-exit journey, a schema v2 company overview, setup, ownership, grants, approvals, distributions, v2 rounds and deals, and a contributor view. They use the app's dark theme, built from the motion video's unicorn-horn logo: four band colors (mint for issued units and founders, blue for grants, violet for the pool, gold for deals and exit). The app follows the system light or dark setting. The captured pages carry a **fixture walkthrough** label because the displayed chain responses are deterministic fixtures and the browser does not create live wallet signatures. These artifacts demonstrate the interface; they are not evidence of a testnet deployment or completed payments.

Recreate them from the repository root with `pnpm demo:fallback`. This starts the local fixture RPC and Next.js development server, captures the nine pages, and saves the video here. The NEAR Sandbox suite (`pnpm test:sandbox`) separately proves the real local-chain governance, claim, funding, failed payout, and retry path. The live testnet evidence is separate; see the [payout rehearsal](../testnet-rehearsal.json) and the [browser rehearsal](../testnet-browser-rehearsal.json).

Screenshots: [home](home.png), [v2 overview](overview.png), [setup](setup.png), [ownership](ownership.png), [grants](grants.png), [approvals](approvals.png), [distributions](distributions.png), [v2 deals](deals.png), [personal view](personal.png).

The [live testnet walkthrough](live-testnet.webm) is a separate 31-second read-only recording of the deployed company setup, ownership, grants, approvals, distributions, and activity pages. It was captured from the normal production build after the live governance, payout, and sponsored-claim rehearsals. The [browser receipt evidence](../testnet-browser-rehearsal.json) and [payout evidence](../testnet-rehearsal.json) establish the signed actions and final chain state; the video itself does not show a wallet prompt or a transaction being signed. Recreate the recording with the production server at `http://127.0.0.1:3000` and `node scripts/record-live-demo.mjs` from `apps/web`.
