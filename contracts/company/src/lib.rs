//! Captab company contract, schema v2.
//!
//! A Sputnik DAO governs one company's ownership ledger: issuance, the contributor pool, vesting grants,
//! snapshot distributions, investor rounds, and settled share deals. Units are integer ledger records.
//! Module layout: `ledger` (capacity, issuance, retirement, wallet replacement, close), `grants`
//! (vesting), `distributions` (snapshots, explicit payouts, payment attempts), `deals` (rounds, primary
//! issuance, secondary sales, buybacks).
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, Vector};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault};

mod deals;
mod distributions;
mod grants;
mod ledger;

pub use deals::*;
pub use distributions::*;
pub use grants::*;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_HOLDERS: u64 = 100;
pub const MAX_GRANTS: u64 = 200;
pub const MAX_DISTRIBUTIONS: u64 = 50;
pub const MAX_DEALS: u64 = 200;
pub const MAX_ROUNDS: u64 = 20;
pub const MAX_PAYOUT_ROWS: usize = 100;
pub const DEFAULT_VESTING_BOUNDARIES: usize = 49;
pub const DEFAULT_CLIFF_INDEX: u32 = 12;
pub const MAX_VESTING_BOUNDARIES: usize = 121;
pub const MAX_AUTHORIZED_UNITS: u128 = 1_000_000_000_000_000;
pub const MAX_TOKEN_AMOUNT: u128 = 1_000_000_000_000_000_000;
const EVENT_VERSION: &str = "2.0.0";

#[derive(BorshDeserialize, BorshSerialize, Clone, Default)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Holding {
    pub units: u128,
    /// Units a holder has committed to an accepted sale or buyback; they stay owned until settlement.
    pub locked: u128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HoldingView {
    pub account_id: AccountId,
    pub issued_units: U128,
    pub locked_units: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LedgerView {
    pub dao_id: AccountId,
    pub authorized_units: U128,
    pub issued_total: U128,
    pub pool_available: U128,
    pub grant_reserved: U128,
    pub deal_reserved: U128,
    pub fully_diluted_total: U128,
    pub unallocated_units: U128,
    pub ledger_revision: u64,
    pub holder_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LimitsView {
    pub max_holders: u32,
    pub max_grants: u32,
    pub max_distributions: u32,
    pub max_deals: u32,
    pub max_rounds: u32,
    pub max_payout_rows: u32,
    /// `null`: governance actions are not capped (only the DAO can record them).
    pub max_actions: Option<u32>,
    pub vesting_boundaries: u32,
    pub max_vesting_boundaries: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CompanyConfigView {
    pub schema_version: u32,
    pub dao_id: AccountId,
    pub snapshot_operator_id: AccountId,
    pub settlement_token_id: AccountId,
    pub authorized_units: U128,
    pub paused: bool,
    pub closed: bool,
    pub limits: LimitsView,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CompanyView {
    pub config: CompanyConfigView,
    pub totals: LedgerView,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Company {
    dao_id: AccountId,
    snapshot_operator_id: AccountId,
    settlement_token_id: AccountId,
    authorized_units: u128,
    issued_total: u128,
    pool_available: u128,
    grant_reserved: u128,
    /// Units reserved by approved, unsettled investor issuance deals.
    deal_reserved: u128,
    ledger_revision: u64,
    holders: UnorderedMap<AccountId, Holding>,
    processed_actions: LookupMap<String, Vec<u8>>,
    /// Object created by an idempotent action (grant, distribution, or deal ID), returned on replay.
    action_results: LookupMap<String, u64>,
    grants: Vector<Grant>,
    distributions: Vector<Distribution>,
    entitlements: LookupMap<(u64, u32), Entitlement>,
    entitlement_index: LookupMap<(u64, AccountId), u32>,
    rounds: UnorderedMap<String, Round>,
    deals: Vector<Deal>,
    paused: bool,
    closed: bool,
}

#[near_bindgen]
impl Company {
    #[init]
    pub fn new(
        dao_id: AccountId,
        snapshot_operator_id: AccountId,
        settlement_token_id: AccountId,
        authorized_units: U128,
    ) -> Self {
        assert!(authorized_units.0 > 0, "authorized units must be positive");
        assert!(authorized_units.0 <= MAX_AUTHORIZED_UNITS, "authorized unit limit exceeded");
        Self {
            dao_id,
            snapshot_operator_id,
            settlement_token_id,
            authorized_units: authorized_units.0,
            issued_total: 0,
            pool_available: 0,
            grant_reserved: 0,
            deal_reserved: 0,
            ledger_revision: 0,
            holders: UnorderedMap::new(b"h"),
            processed_actions: LookupMap::new(b"a"),
            action_results: LookupMap::new(b"r"),
            grants: Vector::new(b"g"),
            distributions: Vector::new(b"d"),
            entitlements: LookupMap::new(b"e"),
            entitlement_index: LookupMap::new(b"x"),
            rounds: UnorderedMap::new(b"o"),
            deals: Vector::new(b"k"),
            paused: false,
            closed: false,
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn get_config(&self) -> CompanyConfigView {
        CompanyConfigView {
            schema_version: SCHEMA_VERSION,
            dao_id: self.dao_id.clone(),
            snapshot_operator_id: self.snapshot_operator_id.clone(),
            settlement_token_id: self.settlement_token_id.clone(),
            authorized_units: U128(self.authorized_units),
            paused: self.paused,
            closed: self.closed,
            limits: LimitsView {
                max_holders: MAX_HOLDERS as u32,
                max_grants: MAX_GRANTS as u32,
                max_distributions: MAX_DISTRIBUTIONS as u32,
                max_deals: MAX_DEALS as u32,
                max_rounds: MAX_ROUNDS as u32,
                max_payout_rows: MAX_PAYOUT_ROWS as u32,
                max_actions: None,
                vesting_boundaries: DEFAULT_VESTING_BOUNDARIES as u32,
                max_vesting_boundaries: MAX_VESTING_BOUNDARIES as u32,
            },
        }
    }

    pub fn get_company(&self) -> CompanyView {
        CompanyView { config: self.get_config(), totals: self.get_totals() }
    }

    pub fn get_totals(&self) -> LedgerView {
        LedgerView {
            dao_id: self.dao_id.clone(),
            authorized_units: U128(self.authorized_units),
            issued_total: U128(self.issued_total),
            pool_available: U128(self.pool_available),
            grant_reserved: U128(self.grant_reserved),
            deal_reserved: U128(self.deal_reserved),
            fully_diluted_total: U128(self.fully_diluted()),
            unallocated_units: U128(self.unallocated()),
            ledger_revision: self.ledger_revision,
            holder_count: self.holders.len() as u32,
        }
    }

    pub fn get_holding(&self, account_id: AccountId) -> U128 {
        U128(self.holders.get(&account_id).map_or(0, |h| h.units))
    }

    pub fn list_holdings(&self, from_index: u32, limit: u32) -> Vec<HoldingView> {
        assert!(limit <= MAX_HOLDERS as u32, "page limit exceeded");
        let keys = self.holders.keys_as_vector();
        let values = self.holders.values_as_vector();
        (from_index as u64..keys.len().min(from_index as u64 + limit as u64))
            .map(|index| {
                let holding = values.get(index).expect("missing holding");
                HoldingView {
                    account_id: keys.get(index).expect("missing holder"),
                    issued_units: U128(holding.units),
                    locked_units: U128(holding.locked),
                }
            })
            .collect()
    }

    pub fn get_processed_action(&self, action_id: String) -> Option<Vec<u8>> {
        self.processed_actions.get(&action_id)
    }

    /// NEP-141 receiver. `msg` selects the purpose: `{"distribution_id", "schedule_hash"}` funds an
    /// approved distribution from the DAO; `{"deal_id"}` pays for an approved deal. Anything that does
    /// not exactly match is returned unused, so the token refunds the sender.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if self.paused || self.closed || env::predecessor_account_id() != self.settlement_token_id {
            return amount;
        }
        let Ok(message) = serde_json::from_str::<Value>(&msg) else {
            return amount;
        };
        if let Some(deal_id) = message.get("deal_id").and_then(Value::as_u64) {
            return self.settle_deal_payment(deal_id, sender_id, amount);
        }
        let Ok(funding) = serde_json::from_value::<FundingMessage>(message) else {
            return amount;
        };
        self.fund_distribution(funding, sender_id, amount)
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v2;

impl Company {
    pub(crate) fn now() -> u64 {
        env::block_timestamp_ms() / 1000
    }

    pub(crate) fn assert_dao(&self) {
        assert_eq!(env::predecessor_account_id(), self.dao_id, "DAO only");
    }

    /// New business actions need an unpaused, open company. Settlement callbacks never call this.
    pub(crate) fn assert_active(&self) {
        assert!(!self.closed, "company closed");
        assert!(!self.paused, "company paused");
    }

    pub(crate) fn assert_revision(&self, expected: u64) {
        assert_eq!(expected, self.ledger_revision, "stale ledger revision");
    }

    pub(crate) fn bump_revision(&mut self) {
        self.ledger_revision = self.ledger_revision.checked_add(1).expect("revision overflow");
    }

    pub(crate) fn fully_diluted(&self) -> u128 {
        self.issued_total
            .checked_add(self.pool_available)
            .and_then(|v| v.checked_add(self.grant_reserved))
            .expect("supply overflow")
    }

    pub(crate) fn unallocated(&self) -> u128 {
        self.authorized_units
            .checked_sub(self.fully_diluted())
            .and_then(|v| v.checked_sub(self.deal_reserved))
            .expect("supply exceeds authorization")
    }

    pub(crate) fn validate_doc_hash(doc_hash: &Option<String>) {
        if let Some(hash) = doc_hash {
            assert!(
                hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "doc_hash must be 64 lowercase hex characters (SHA-256)"
            );
        }
    }

    pub(crate) fn digest<T: BorshSerialize>(payload: &T) -> Vec<u8> {
        env::sha256(&near_sdk::borsh::to_vec(payload).expect("serialize action"))
    }

    /// True when this exact action already ran; panics if the ID was used with different arguments.
    pub(crate) fn was_processed(&self, action_id: &str, digest: &[u8]) -> bool {
        assert!(!action_id.is_empty() && action_id.len() <= 80, "invalid action id");
        match self.processed_actions.get(&action_id.to_string()) {
            Some(previous) => {
                assert_eq!(previous, digest, "action id reused with different arguments");
                true
            }
            None => false,
        }
    }

    pub(crate) fn record_action(&mut self, action_id: &str, digest: Vec<u8>) {
        self.processed_actions.insert(&action_id.to_string(), &digest);
    }

    pub(crate) fn record_result(&mut self, action_id: &str, digest: Vec<u8>, object_id: u64) {
        self.record_action(action_id, digest);
        self.action_results.insert(&action_id.to_string(), &object_id);
    }

    pub(crate) fn replayed_result(&self, action_id: &str) -> u64 {
        self.action_results.get(&action_id.to_string()).expect("missing action result")
    }

    pub(crate) fn holding(&self, account_id: &AccountId) -> Holding {
        self.holders.get(account_id).unwrap_or_default()
    }

    /// Adds units to an account, enforcing the holder limit for a new holder. Does not change totals.
    pub(crate) fn credit(&mut self, account_id: &AccountId, units: u128) {
        let mut holding = self.holders.get(account_id).unwrap_or_else(|| {
            assert!(self.holders.len() < MAX_HOLDERS, "holder limit reached");
            Holding::default()
        });
        holding.units = holding.units.checked_add(units).expect("holder overflow");
        self.holders.insert(account_id, &holding);
    }

    /// Removes units (and optionally the same amount of locked units); drops an emptied holder.
    pub(crate) fn debit(&mut self, account_id: &AccountId, units: u128, from_locked: bool) {
        let mut holding = self.holders.get(account_id).expect("not a holder");
        if from_locked {
            holding.locked = holding.locked.checked_sub(units).expect("locked units underflow");
        } else {
            assert!(holding.units - holding.locked >= units, "insufficient unlocked units");
        }
        holding.units = holding.units.checked_sub(units).expect("holding underflow");
        if holding.units == 0 {
            self.holders.remove(account_id);
        } else {
            self.holders.insert(account_id, &holding);
        }
    }

    pub(crate) fn emit(event: &str, data: Value) {
        let line = json!({"standard": "captable", "version": EVENT_VERSION, "event": event, "data": [data]});
        env::log_str(&format!("EVENT_JSON:{line}"));
    }
}
