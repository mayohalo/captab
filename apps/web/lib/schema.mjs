// Company contract schemas the app can read. v1 is the deployed testnet demo; v2 adds rounds, deals,
// explicit payout lists, configurable vesting, and uncapped governance actions.
export const LIMITS_BY_SCHEMA = {
  1: { max_holders: 20, max_grants: 100, max_distributions: 20, max_actions: 200, vesting_boundaries: 49 },
  2: { max_holders: 100, max_grants: 200, max_distributions: 50, max_deals: 200, max_rounds: 20, max_payout_rows: 100,
    max_actions: null, vesting_boundaries: 49, max_vesting_boundaries: 121 },
};

export function supportedSchema(config) {
  const expected = LIMITS_BY_SCHEMA[config?.schema_version];
  return Boolean(expected) && Object.entries(expected).every(([key, value]) => config.limits?.[key] === value);
}

export function isV2(config) {
  return config?.schema_version === 2;
}
