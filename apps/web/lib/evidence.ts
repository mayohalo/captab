/** Public facts the landing page and llms.txt cite. Every link is a finalized testnet transaction or account. */

export const NEARBLOCKS = "https://testnet.nearblocks.io";

export const DEPLOYMENTS = {
  v2: {
    label: "Schema v2 (full lifecycle)",
    company: "captab-company-0d07df99e1bb0e44.testnet",
    dao: "captab-dao-0d07df99e1bb0e44.testnet",
    token: "captab-token-0d07df99e1bb0e44.testnet",
  },
  v1: {
    label: "Schema v1 (MVP)",
    company: "captab-company-101e85b169dd3522.testnet",
    dao: "captab-dao-101e85b169dd3522.testnet",
    token: "captab-token-101e85b169dd3522.testnet",
  },
} as const;

export type EvidenceStep = { stage: string; what: string; links: { label: string; tx: string }[] };

/** The live v2 rehearsal (docs/testnet-v2-rehearsal.json); every board action passed a two-of-three DAO vote. */
export const LIVE_STEPS: EvidenceStep[] = [
  { stage: "Found", what: "Charter amended to 12,000,000 authorized units, with the document's SHA-256",
    links: [{ label: "proposal", tx: "JBCCbvP4YtmZFAmhcAxHaiPXC5Jy3W2iP9oW9pxzdVSn" }] },
  { stage: "Hire", what: "A contributor signs the grant terms on-chain, then claims 25,000 vested units at the cliff",
    links: [{ label: "accept terms", tx: "CE4y23r3fiRcM81FrCk9eDgpQadM6i8BWxKNHxyrMEba" }, { label: "claim", tx: "FyFBrAFfkQz1DLPTS9JQR5AsTVEf13Ecm5Q2FHZecmdf" }] },
  { stage: "Hire", what: "From a real Meteor Wallet on this site, a holder accepts a board grant's terms and claims 5,000 vested units",
    links: [{ label: "accept", tx: "GzpcBV1oLdp2suupsWdKYJEdB5bvb3oFMsk8ibxoKLWj" }, { label: "claim", tx: "z8Z4BK38ny7ttDScvrZBH2SxbabDiu2UXTeyzfV73md" }] },
  { stage: "Raise", what: "Seed round: a wrong amount and a wrong payer are refunded; the investor's exact 10,000 TESTUSD issues 1,000,000 units in the same transaction",
    links: [{ label: "refund", tx: "38fDEUrTUDA2jeHMUvqrnv4JSqJs4XsYnwyhjFTrsYNE" }, { label: "payment", tx: "DGY7VapS6G9b8XCzaT8y3LnMpXbb1mUpRUVydX184Jmd" }] },
  { stage: "Liquidity", what: "Secondary sale: the seller locks units, the buyer pays, held proceeds are delivered by a public retry",
    links: [{ label: "seller accepts", tx: "FKfosRrYSo94ao94dWxDhRhaqqbtstYmH8hyu6HEEqSd" }, { label: "buyer pays", tx: "9gBWG3pbnz2yfSNwrZ6vZDN4QnDRjdgT2sv62aFYCGE9" }, { label: "retry", tx: "EGuQtscaKtLKcaEb1qiByeQGdG7ajRxJDNcJFpmB5KY6" }] },
  { stage: "Liquidity", what: "Buyback: the holder accepts, the DAO pays through a proposal, 5,000 units are retired",
    links: [{ label: "accept", tx: "7JuZfuvezp9AwLAeWZMr9rf7PDRxgSDSdbDp5PfP1XTo" }, { label: "DAO pays", tx: "EtXZJ5Egqj8mZqKZb3NoWmBvrdsci6gK6sT7v6apj9oj" }] },
  { stage: "Exit", what: "A board-set payout list of 2,000 TESTUSD, funded exactly once and paid to five holders",
    links: [{ label: "funding", tx: "HVefYMr38JD72oebKw7gCR7BFb8vaTx61ThZ8Y9GQqCf" }, { label: "first payment", tx: "9SZVkKe9RKhe8wMHF3j4v4c1djzucKBP1MREwCsg6cCb" }] },
];

export const TEST_COUNTS = [
  { value: "74", label: "Rust unit tests", detail: "supply invariants, vesting, replay safety, deals, payouts" },
  { value: "9", label: "NEAR Sandbox tests", detail: "real Sputnik DAO votes, token payments, retries, close" },
  { value: "26", label: "browser tests", detail: "every screen against fixture chain views" },
] as const;

export const txUrl = (hash: string) => `${NEARBLOCKS}/txns/${hash}`;
export const accountUrl = (account: string) => `${NEARBLOCKS}/address/${account}`;
