const PINNED_DAO_SOURCE = "5434a59dec23ee0c49df8c8c4350c208a7e75b0b";
const PINNED_DAO_SHA256 = "a6055ab340bb5b9909ce4ff4bc7d2ae365b77d7b4b74d481fc2d2ee97c8a0722";
const DEMO_LIMITS = { max_holders: 20, max_grants: 100, max_distributions: 20, max_actions: 200, vesting_boundaries: 49 };
const CALLBACK_FAULT_MARKER = Buffer.from("sandbox-injected payment callback failure");

export function assertReleaseCompanyWasm(bytes) {
  if (Buffer.from(bytes).includes(CALLBACK_FAULT_MARKER)) {
    throw new Error("Fault-injection company WASM cannot be deployed or verified as a release artifact.");
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function assessRelease({ manifest, artifacts, chain, funding, requireFrozen = false }) {
  const issues = [];
  const check = (condition, message) => { if (!condition) issues.push(message); };
  check(manifest?.network === "testnet", "Manifest network is not testnet.");
  check(manifest?.dao?.sourceCommit === PINNED_DAO_SOURCE && manifest?.dao?.sha256 === PINNED_DAO_SHA256,
    "Manifest does not identify the pinned Sputnik source and build.");
  for (const name of ["company", "dao", "token"]) {
    check(Boolean(manifest?.[name]?.sha256 && manifest[name].sha256 === artifacts?.[name]?.sha256), `${name} local WASM differs from manifest SHA-256.`);
    check(Boolean(manifest?.[name]?.codeHash && manifest[name].codeHash === artifacts?.[name]?.codeHash), `${name} local WASM code hash differs from manifest.`);
    check(Boolean(manifest?.[name]?.codeHash && manifest[name].codeHash === chain?.[`${name}CodeHash`]), `${name} deployed code differs from manifest.`);
  }
  const council = chain?.policy?.roles?.find(role => role.name === "council");
  const members = council?.kind?.Group;
  check(Array.isArray(members) && members.length === 3 && new Set(members).size === 3 &&
    canonicalJson([...members].sort()) === canonicalJson([...(manifest?.dao?.council ?? [])].sort()) &&
    council.permissions?.includes("*:VoteApprove") && Object.keys(council.vote_policy ?? {}).length === 0,
  "DAO council or permissions differ from the frozen three-member policy.");
  const vote = chain?.policy?.default_vote_policy;
  check(vote?.weight_kind === "RoleWeight" && String(vote?.quorum) === "0" &&
    canonicalJson(vote?.threshold?.Ratio) === "[1,2]" && canonicalJson(vote) === canonicalJson(manifest?.dao?.defaultVotePolicy),
  "DAO voting policy differs from the frozen two-of-three policy.");
  check(Boolean(manifest?.dao?.policy) && canonicalJson(chain?.policy) === canonicalJson(manifest.dao.policy),
    "DAO full policy differs from the frozen manifest.");
  check(chain?.tokenMetadata?.spec === "ft-1.0.0" && chain.tokenMetadata.symbol === "TESTUSD" &&
    chain.tokenMetadata.decimals === 6 && manifest?.token?.symbol === "TESTUSD" && manifest.token.decimals === 6,
  "Settlement token metadata differs from the six-decimal TESTUSD fixture.");
  check(typeof manifest?.token?.totalSupply === "string" && /^[1-9][0-9]*$/.test(manifest.token.totalSupply) &&
    String(chain?.tokenSupply) === manifest.token.totalSupply,
  "Settlement token total supply differs from the frozen manifest.");
  const config = chain?.config;
  check(config?.schema_version === 1 && manifest?.company?.schemaVersion === 1 &&
    config?.dao_id === manifest?.daoId && config?.snapshot_operator_id === manifest?.operatorId &&
    config?.settlement_token_id === manifest?.tokenId && String(config?.authorized_units) === String(manifest?.company?.authorizedUnits) &&
    Object.entries(DEMO_LIMITS).every(([key, value]) => config?.limits?.[key] === value && manifest?.company?.limits?.[key] === value),
  "Company configuration or limits differ from the frozen manifest.");
  try {
    const totals = chain.totals;
    const issued = BigInt(totals.issued_total);
    const pool = BigInt(totals.pool_available);
    const reserved = BigInt(totals.grant_reserved);
    const authorized = BigInt(totals.authorized_units);
    check(totals.dao_id === manifest?.daoId && authorized === BigInt(manifest?.company?.authorizedUnits) &&
      issued + pool + reserved === BigInt(totals.fully_diluted_total) &&
      authorized - issued - pool - reserved === BigInt(totals.unallocated_units),
    "Company supply accounting does not reconcile.");
  } catch { issues.push("Company supply accounting is unavailable or invalid."); }
  check(manifest?.token?.storageRegistration === "registered" && Boolean(chain?.storageBalance),
    "Company is not confirmed registered with the settlement token.");
  const expectedKeys = manifest?.company?.remainingAccessKeys;
  check(typeof manifest?.company?.deploymentPublicKey === "string" && /^(ed25519|secp256k1):/.test(manifest.company.deploymentPublicKey),
    "Company deployment key identity is missing from the manifest.");
  check(Array.isArray(expectedKeys) && canonicalJson([...expectedKeys].sort((a, b) => a.publicKey.localeCompare(b.publicKey))) ===
    canonicalJson([...(chain?.accessKeys ?? [])].sort((a, b) => a.publicKey.localeCompare(b.publicKey))),
  "Company access keys differ from the manifest; review key rotation or removal.");
  if (manifest?.company?.frozen !== true) {
    check(Array.isArray(chain?.accessKeys) && chain.accessKeys.some(key =>
      key.publicKey === manifest?.company?.deploymentPublicKey && key.permission === "FullAccess"),
    "Company deployment key is absent but the manifest is not frozen.");
  }
  if (requireFrozen || manifest?.company?.frozen === true) {
    check(manifest?.company?.frozen === true, "Company has not been marked frozen after deployment-key removal.");
    check(Array.isArray(chain?.accessKeys) && !chain.accessKeys.some(key => key.permission === "FullAccess"),
      "Frozen company still has a full-access key.");
    check(Array.isArray(chain?.accessKeys) && !chain.accessKeys.some(key => key.publicKey === manifest?.company?.deploymentPublicKey),
      "Company deployment key remains on-chain.");
  }
  check(funding?.funded === true, "Company balance is below projected storage and fee headroom.");
  return issues;
}
