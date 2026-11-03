# Fixture-backed fallback walkthrough

The [short walkthrough video](fixture-walkthrough.webm) and six screenshots show the local browser fixture for setup, ownership, grants, approvals, distributions, and a contributor view. The captured pages carry a **fixture walkthrough** label because the displayed chain responses are deterministic fixtures and the browser does not create live wallet signatures. These artifacts demonstrate the interface; they are not evidence of a testnet deployment or completed payments.

Recreate them from the repository root with `pnpm demo:fallback`. This starts the local fixture RPC and Next.js development server, captures the six pages, and saves the video here. The NEAR Sandbox suite (`pnpm test:sandbox`) separately proves the real local-chain governance, claim, funding, failed payout, and retry path. The live testnet rehearsal and its receipt links remain separate release gates in [the runbook](../RUNBOOK.md).

Screenshots: [setup](setup.png), [ownership](ownership.png), [grants](grants.png), [approvals](approvals.png), [distributions](distributions.png), [personal view](personal.png).
