use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault};

const MAX_HOLDERS: usize = 20;
const MAX_ACTIONS: u32 = 200;
const MAX_GRANTS: usize = 100;
const VESTING_BOUNDARIES: usize = 49;

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Holding {
    pub units: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Grant {
    pub id: u64,
    pub recipient: AccountId,
    pub original_units: u128,
    pub entitlement_cap: u128,
    pub issued_units: u128,
    pub boundaries: Vec<u64>, // UTC seconds; index 0 is the grant start
    pub cancelled_at: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct GrantView {
    pub id: u64,
    pub recipient: AccountId,
    pub original_units: U128,
    pub entitlement_cap: U128,
    pub issued_units: U128,
    pub vested_units: U128,
    pub claimable_units: U128,
    pub boundaries: Vec<u64>,
    pub cancelled_at: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HoldingView {
    pub account_id: AccountId,
    pub issued_units: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LedgerView {
    pub dao_id: AccountId,
    pub authorized_units: U128,
    pub issued_total: U128,
    pub pool_available: U128,
    pub grant_reserved: U128,
    pub fully_diluted_total: U128,
    pub unallocated_units: U128,
    pub ledger_revision: u64,
    pub holder_count: u32,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Company {
    dao_id: AccountId,
    authorized_units: u128,
    issued_total: u128,
    pool_available: u128,
    grant_reserved: u128,
    ledger_revision: u64,
    holders: LookupMap<AccountId, Holding>,
    holder_ids: Vec<AccountId>,
    processed_actions: LookupMap<String, Vec<u8>>,
    action_count: u32,
    grants: LookupMap<u64, Grant>,
    grant_ids: Vec<u64>,
    grant_action_ids: LookupMap<String, u64>,
}

#[near_bindgen]
impl Company {
    #[init]
    pub fn new(dao_id: AccountId, authorized_units: U128) -> Self {
        assert!(authorized_units.0 > 0, "authorized units must be positive");
        Self {
            dao_id,
            authorized_units: authorized_units.0,
            issued_total: 0,
            pool_available: 0,
            grant_reserved: 0,
            ledger_revision: 0,
            holders: LookupMap::new(b"h"),
            holder_ids: Vec::new(),
            processed_actions: LookupMap::new(b"a"),
            action_count: 0,
            grants: LookupMap::new(b"g"),
            grant_ids: Vec::new(),
            grant_action_ids: LookupMap::new(&b"ga"[..]),
        }
    }

    pub fn create_grant(
        &mut self,
        action_id: String,
        expected_revision: u64,
        recipient: AccountId,
        units: U128,
        boundaries: Vec<u64>,
    ) -> u64 {
        self.assert_dao();
        let digest = env::sha256(
            &near_sdk::borsh::to_vec(&(
                "create_grant",
                &action_id,
                expected_revision,
                &recipient,
                units.0,
                &boundaries,
            ))
            .expect("serialize grant action"),
        );
        if self.was_processed(&action_id, &digest) {
            return self
                .grant_action_ids
                .get(&action_id)
                .expect("missing grant action");
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(units.0 <= self.pool_available, "insufficient pool units");
        assert!(self.grant_ids.len() < MAX_GRANTS, "grant limit reached");
        assert_eq!(
            boundaries.len(),
            VESTING_BOUNDARIES,
            "expected 49 boundaries"
        );
        assert!(boundaries[0] > 0, "invalid grant start");
        assert!(
            boundaries.windows(2).all(|p| p[0] < p[1]),
            "boundaries must increase"
        );
        let id = self.grant_ids.len() as u64;
        self.grants.insert(
            &id,
            &Grant {
                id,
                recipient: recipient.clone(),
                original_units: units.0,
                entitlement_cap: units.0,
                issued_units: 0,
                boundaries,
                cancelled_at: None,
            },
        );
        self.grant_ids.push(id);
        self.pool_available -= units.0;
        self.grant_reserved = self
            .grant_reserved
            .checked_add(units.0)
            .expect("reserved overflow");
        self.ledger_revision = self
            .ledger_revision
            .checked_add(1)
            .expect("revision overflow");
        self.record_action(action_id.clone(), digest);
        self.grant_action_ids.insert(&action_id, &id);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"grant_created\",\"data\":[{{\"grant_id\":{},\"recipient\":\"{}\",\"units\":\"{}\",\"revision\":{}}}]}}", id, recipient, units.0, self.ledger_revision));
        id
    }

    pub fn cancel_unvested(&mut self, action_id: String, grant_id: u64) {
        self.assert_dao();
        let digest = env::sha256(
            &near_sdk::borsh::to_vec(&("cancel_unvested", &action_id, grant_id))
                .expect("serialize cancellation"),
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut grant = self.grants.get(&grant_id).expect("grant not found");
        assert!(grant.cancelled_at.is_none(), "grant already cancelled");
        let now = env::block_timestamp_ms() / 1000;
        let vested = Self::vested_at(&grant, now);
        let released = grant.entitlement_cap - vested;
        grant.entitlement_cap = vested;
        grant.cancelled_at = Some(now);
        self.grant_reserved -= released;
        self.pool_available = self
            .pool_available
            .checked_add(released)
            .expect("pool overflow");
        self.grants.insert(&grant_id, &grant);
        self.ledger_revision = self
            .ledger_revision
            .checked_add(1)
            .expect("revision overflow");
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"grant_cancelled\",\"data\":[{{\"grant_id\":{},\"released_units\":\"{}\",\"revision\":{}}}]}}", grant_id, released, self.ledger_revision));
    }

    pub fn claim_vested(&mut self, grant_id: u64) -> U128 {
        let mut grant = self.grants.get(&grant_id).expect("grant not found");
        let caller = env::predecessor_account_id();
        assert_eq!(caller, grant.recipient, "grant recipient only");
        let vested = Self::vested_at(&grant, env::block_timestamp_ms() / 1000);
        let claimable = vested
            .checked_sub(grant.issued_units)
            .expect("grant accounting error");
        assert!(claimable > 0, "nothing to claim");
        let old_units = self.holders.get(&caller).map_or(0, |h| h.units);
        if old_units == 0 {
            assert!(self.holder_ids.len() < MAX_HOLDERS, "holder limit reached");
            self.holder_ids.push(caller.clone());
        }
        let new_units = old_units.checked_add(claimable).expect("holder overflow");
        self.issued_total = self
            .issued_total
            .checked_add(claimable)
            .expect("total overflow");
        self.grant_reserved -= claimable;
        grant.issued_units += claimable;
        self.grants.insert(&grant_id, &grant);
        self.holders.insert(&caller, &Holding { units: new_units });
        self.ledger_revision = self
            .ledger_revision
            .checked_add(1)
            .expect("revision overflow");
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"grant_claimed\",\"data\":[{{\"grant_id\":{},\"units\":\"{}\",\"revision\":{}}}]}}", grant_id, claimable, self.ledger_revision));
        U128(claimable)
    }

    pub fn get_grant(&self, grant_id: u64) -> Option<GrantView> {
        self.grants
            .get(&grant_id)
            .map(|grant| Self::grant_view(grant, env::block_timestamp_ms() / 1000))
    }

    pub fn list_grants(&self, from_index: u32, limit: u32) -> Vec<GrantView> {
        assert!(limit <= 20, "page limit exceeded");
        self.grant_ids
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .map(|id| self.get_grant(*id).expect("missing grant"))
            .collect()
    }

    pub fn issue_founder_units(
        &mut self,
        action_id: String,
        expected_revision: u64,
        recipient: AccountId,
        units: U128,
    ) {
        self.assert_dao();
        let digest = Self::action_digest(
            "issue_founder_units",
            &action_id,
            expected_revision,
            &recipient,
            units.0,
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(
            units.0 <= self.unallocated(),
            "insufficient unallocated units"
        );

        let old_units = self.holders.get(&recipient).map_or(0, |h| h.units);
        if old_units == 0 {
            assert!(self.holder_ids.len() < MAX_HOLDERS, "holder limit reached");
            self.holder_ids.push(recipient.clone());
        }
        let new_units = old_units.checked_add(units.0).expect("holder overflow");
        let new_total = self
            .issued_total
            .checked_add(units.0)
            .expect("total overflow");
        self.holders
            .insert(&recipient, &Holding { units: new_units });
        self.issued_total = new_total;
        self.ledger_revision = self
            .ledger_revision
            .checked_add(1)
            .expect("revision overflow");
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"founder_issued\",\"data\":[{{\"recipient\":\"{}\",\"units\":\"{}\",\"revision\":{}}}]}}", recipient, units.0, self.ledger_revision));
    }

    pub fn increase_pool(&mut self, action_id: String, expected_revision: u64, units: U128) {
        self.assert_dao();
        let digest = Self::action_digest(
            "increase_pool",
            &action_id,
            expected_revision,
            &self.dao_id,
            units.0,
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(
            units.0 <= self.unallocated(),
            "insufficient unallocated units"
        );
        self.pool_available = self
            .pool_available
            .checked_add(units.0)
            .expect("pool overflow");
        self.ledger_revision = self
            .ledger_revision
            .checked_add(1)
            .expect("revision overflow");
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"pool_increased\",\"data\":[{{\"units\":\"{}\",\"revision\":{}}}]}}", units.0, self.ledger_revision));
    }

    pub fn get_totals(&self) -> LedgerView {
        LedgerView {
            dao_id: self.dao_id.clone(),
            authorized_units: U128(self.authorized_units),
            issued_total: U128(self.issued_total),
            pool_available: U128(self.pool_available),
            grant_reserved: U128(self.grant_reserved),
            fully_diluted_total: U128(self.fully_diluted()),
            unallocated_units: U128(self.unallocated()),
            ledger_revision: self.ledger_revision,
            holder_count: self.holder_ids.len() as u32,
        }
    }

    pub fn get_holding(&self, account_id: AccountId) -> U128 {
        U128(self.holders.get(&account_id).map_or(0, |h| h.units))
    }

    pub fn list_holdings(&self, from_index: u32, limit: u32) -> Vec<HoldingView> {
        assert!(limit <= MAX_HOLDERS as u32, "page limit exceeded");
        self.holder_ids
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .map(|account_id| HoldingView {
                account_id: account_id.clone(),
                issued_units: self.get_holding(account_id.clone()),
            })
            .collect()
    }

    pub fn get_processed_action(&self, action_id: String) -> Option<Vec<u8>> {
        self.processed_actions.get(&action_id)
    }
}

#[cfg(test)]
mod tests;

impl Company {
    fn vested_at(grant: &Grant, now: u64) -> u128 {
        let months = grant
            .boundaries
            .iter()
            .skip(1)
            .take_while(|&&t| t <= now)
            .count();
        if months < 12 {
            return 0;
        }
        let vested = grant
            .original_units
            .checked_mul(months as u128)
            .expect("vesting overflow")
            / 48;
        vested.min(grant.entitlement_cap)
    }

    fn grant_view(grant: Grant, now: u64) -> GrantView {
        let vested = Self::vested_at(&grant, now);
        GrantView {
            id: grant.id,
            recipient: grant.recipient,
            original_units: U128(grant.original_units),
            entitlement_cap: U128(grant.entitlement_cap),
            issued_units: U128(grant.issued_units),
            vested_units: U128(vested),
            claimable_units: U128(vested - grant.issued_units),
            boundaries: grant.boundaries,
            cancelled_at: grant.cancelled_at,
        }
    }
    fn assert_dao(&self) {
        assert_eq!(env::predecessor_account_id(), self.dao_id, "DAO only");
    }

    fn assert_revision(&self, expected: u64) {
        assert_eq!(expected, self.ledger_revision, "stale ledger revision");
    }

    fn fully_diluted(&self) -> u128 {
        self.issued_total
            .checked_add(self.pool_available)
            .and_then(|v| v.checked_add(self.grant_reserved))
            .expect("supply overflow")
    }

    fn unallocated(&self) -> u128 {
        self.authorized_units
            .checked_sub(self.fully_diluted())
            .expect("supply exceeds authorization")
    }

    fn action_digest(
        method: &str,
        action_id: &str,
        revision: u64,
        recipient: &AccountId,
        units: u128,
    ) -> Vec<u8> {
        let payload = (
            method.to_string(),
            action_id.to_string(),
            revision,
            recipient.clone(),
            units,
        );
        env::sha256(&near_sdk::borsh::to_vec(&payload).expect("serialize action"))
    }

    fn was_processed(&self, action_id: &str, digest: &[u8]) -> bool {
        assert!(
            !action_id.is_empty() && action_id.len() <= 80,
            "invalid action id"
        );
        if let Some(previous) = self.processed_actions.get(&action_id.to_string()) {
            assert_eq!(
                previous, digest,
                "action id reused with different arguments"
            );
            true
        } else {
            false
        }
    }

    fn record_action(&mut self, action_id: String, digest: Vec<u8>) {
        assert!(self.action_count < MAX_ACTIONS, "action limit reached");
        self.processed_actions.insert(&action_id, &digest);
        self.action_count += 1;
    }
}
