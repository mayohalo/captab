use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};

const MAX_HOLDERS: usize = 20;
const MAX_ACTIONS: u32 = 200;
const MAX_GRANTS: usize = 100;
const VESTING_BOUNDARIES: usize = 49;
const MAX_DISTRIBUTIONS: usize = 20;
const MAX_AUTHORIZED_UNITS: u128 = 1_000_000_000_000_000;
const MAX_DISTRIBUTION_BUDGET: u128 = 1_000_000_000_000_000_000;

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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Entitlement {
    pub account_id: AccountId,
    pub units: u128,
    pub amount: u128,
    pub payment_status: PaymentStatus,
    pub attempt_id: u64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PaymentStatus {
    Ready,
    InFlight,
    Failed,
    Paid,
    Zero,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Distribution {
    pub id: u64,
    pub snapshot_revision: u64,
    pub snapshot_timestamp: u64,
    pub snapshot_block_height: u64,
    pub token_id: AccountId,
    pub budget: u128,
    pub expires_at: u64,
    pub schedule_hash: Vec<u8>,
    pub approved: bool,
    pub cancelled: bool,
    pub funded: bool,
    pub paid_total: u128,
    pub in_flight_total: u128,
    pub available_escrow: u128,
    pub entitlements: Vec<Entitlement>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EntitlementView {
    pub account_id: AccountId,
    pub units: U128,
    pub amount: U128,
    pub payment_status: PaymentStatus,
    pub attempt_id: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DistributionView {
    pub id: u64,
    pub snapshot_revision: u64,
    pub snapshot_timestamp: u64,
    pub snapshot_block_height: u64,
    pub token_id: AccountId,
    pub budget: U128,
    pub expires_at: u64,
    pub schedule_hash: Vec<u8>,
    pub approved: bool,
    pub cancelled: bool,
    pub funded: bool,
    pub paid_total: U128,
    pub in_flight_total: U128,
    pub available_escrow: U128,
    pub entitlements: Vec<EntitlementView>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct FundingMessage {
    distribution_id: u64,
    schedule_hash: Vec<u8>,
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

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CompanyConfigView {
    pub dao_id: AccountId,
    pub snapshot_operator_id: AccountId,
    pub settlement_token_id: AccountId,
    pub authorized_units: U128,
    pub paused: bool,
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
    ledger_revision: u64,
    holders: LookupMap<AccountId, Holding>,
    holder_ids: Vec<AccountId>,
    processed_actions: LookupMap<String, Vec<u8>>,
    action_count: u32,
    grants: LookupMap<u64, Grant>,
    grant_ids: Vec<u64>,
    grant_action_ids: LookupMap<String, u64>,
    distributions: LookupMap<u64, Distribution>,
    distribution_ids: Vec<u64>,
    paused: bool,
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
        assert!(
            authorized_units.0 <= MAX_AUTHORIZED_UNITS,
            "authorized unit limit exceeded"
        );
        Self {
            dao_id,
            snapshot_operator_id,
            settlement_token_id,
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
            distributions: LookupMap::new(b"d"),
            distribution_ids: Vec::new(),
            paused: false,
        }
    }

    pub fn set_paused(&mut self, action_id: String, paused: bool) {
        self.assert_dao();
        let digest = env::sha256(
            &near_sdk::borsh::to_vec(&("set_paused", &action_id, paused)).expect("serialize pause"),
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.paused = paused;
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"pause_changed\",\"data\":[{{\"paused\":{}}}]}}", paused));
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn get_config(&self) -> CompanyConfigView {
        CompanyConfigView {
            dao_id: self.dao_id.clone(),
            snapshot_operator_id: self.snapshot_operator_id.clone(),
            settlement_token_id: self.settlement_token_id.clone(),
            authorized_units: U128(self.authorized_units),
            paused: self.paused,
        }
    }

    pub fn prepare_distribution(
        &mut self,
        expected_revision: u64,
        budget: U128,
        expires_at: u64,
    ) -> u64 {
        self.assert_active();
        assert_eq!(
            env::predecessor_account_id(),
            self.snapshot_operator_id,
            "snapshot operator only"
        );
        self.assert_revision(expected_revision);
        assert!(self.issued_total > 0, "no issued units");
        assert!(
            budget.0 > 0 && budget.0 <= MAX_DISTRIBUTION_BUDGET,
            "invalid budget"
        );
        assert!(
            expires_at > env::block_timestamp_ms() / 1000,
            "snapshot already expired"
        );
        assert!(
            self.distribution_ids.len() < MAX_DISTRIBUTIONS,
            "distribution limit reached"
        );
        let id = self.distribution_ids.len() as u64;
        let mut rows: Vec<(Entitlement, u128)> = self
            .holder_ids
            .iter()
            .map(|account_id| {
                let units = self.holders.get(account_id).expect("missing holding").units;
                let numerator = budget
                    .0
                    .checked_mul(units)
                    .expect("distribution multiplication overflow");
                (
                    Entitlement {
                        account_id: account_id.clone(),
                        units,
                        amount: numerator / self.issued_total,
                        payment_status: PaymentStatus::Ready,
                        attempt_id: 0,
                    },
                    numerator % self.issued_total,
                )
            })
            .collect();
        let allocated = rows
            .iter()
            .try_fold(0u128, |sum, (row, _)| sum.checked_add(row.amount))
            .expect("distribution total overflow");
        let leftover = budget
            .0
            .checked_sub(allocated)
            .expect("distribution allocation error");
        let mut rank: Vec<usize> = (0..rows.len()).collect();
        rank.sort_by(|&a, &b| {
            rows[b]
                .1
                .cmp(&rows[a].1)
                .then_with(|| rows[a].0.account_id.cmp(&rows[b].0.account_id))
        });
        assert!((leftover as usize) <= rank.len(), "rounding error");
        for index in rank.into_iter().take(leftover as usize) {
            rows[index].0.amount += 1;
        }
        let mut entitlements: Vec<Entitlement> = rows
            .into_iter()
            .map(|(mut row, _)| {
                if row.amount == 0 {
                    row.payment_status = PaymentStatus::Zero;
                }
                row
            })
            .collect();
        entitlements.sort_by(|a, b| a.account_id.cmp(&b.account_id));
        let now = env::block_timestamp_ms() / 1000;
        let block_height = env::block_height();
        let immutable_rows: Vec<_> = entitlements
            .iter()
            .map(|e| (&e.account_id, e.units, e.amount))
            .collect();
        let payload = (
            "near:testnet/captable.distribution.v1",
            env::current_account_id(),
            id,
            self.ledger_revision,
            now,
            block_height,
            &self.settlement_token_id,
            budget.0,
            expires_at,
            &immutable_rows,
        );
        let schedule_hash =
            env::sha256(&near_sdk::borsh::to_vec(&payload).expect("serialize schedule"));
        self.distributions.insert(
            &id,
            &Distribution {
                id,
                snapshot_revision: self.ledger_revision,
                snapshot_timestamp: now,
                snapshot_block_height: block_height,
                token_id: self.settlement_token_id.clone(),
                budget: budget.0,
                expires_at,
                schedule_hash,
                approved: false,
                cancelled: false,
                funded: false,
                paid_total: 0,
                in_flight_total: 0,
                available_escrow: 0,
                entitlements,
            },
        );
        self.distribution_ids.push(id);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"distribution_prepared\",\"data\":[{{\"distribution_id\":{},\"revision\":{}}}]}}", id, self.ledger_revision));
        id
    }

    pub fn approve_distribution(
        &mut self,
        action_id: String,
        distribution_id: u64,
        schedule_hash: Vec<u8>,
    ) {
        self.assert_dao();
        self.assert_active();
        let digest = env::sha256(
            &near_sdk::borsh::to_vec(&(
                "approve_distribution",
                &action_id,
                distribution_id,
                &schedule_hash,
            ))
            .expect("serialize approval"),
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut distribution = self
            .distributions
            .get(&distribution_id)
            .expect("distribution not found");
        assert!(
            !distribution.approved && !distribution.cancelled,
            "distribution closed"
        );
        assert!(
            env::block_timestamp_ms() / 1000 < distribution.expires_at,
            "distribution expired"
        );
        assert_eq!(
            distribution.schedule_hash, schedule_hash,
            "schedule hash mismatch"
        );
        distribution.approved = true;
        self.distributions.insert(&distribution_id, &distribution);
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"distribution_approved\",\"data\":[{{\"distribution_id\":{}}}]}}", distribution_id));
    }

    pub fn cancel_unfunded_distribution(&mut self, action_id: String, distribution_id: u64) {
        self.assert_dao();
        let digest = env::sha256(
            &near_sdk::borsh::to_vec(&(
                "cancel_unfunded_distribution",
                &action_id,
                distribution_id,
            ))
            .expect("serialize cancellation"),
        );
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut d = self
            .distributions
            .get(&distribution_id)
            .expect("distribution not found");
        assert!(
            !d.funded && !d.cancelled,
            "distribution cannot be cancelled"
        );
        d.cancelled = true;
        self.distributions.insert(&distribution_id, &d);
        self.record_action(action_id, digest);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"distribution_cancelled\",\"data\":[{{\"distribution_id\":{}}}]}}", distribution_id));
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if self.paused {
            return amount;
        }
        if env::predecessor_account_id() != self.settlement_token_id || sender_id != self.dao_id {
            return amount;
        }
        let Ok(message) = near_sdk::serde_json::from_str::<FundingMessage>(&msg) else {
            return amount;
        };
        let Some(mut distribution) = self.distributions.get(&message.distribution_id) else {
            return amount;
        };
        if !distribution.approved
            || distribution.cancelled
            || distribution.funded
            || distribution.token_id != self.settlement_token_id
            || env::block_timestamp_ms() / 1000 >= distribution.expires_at
            || distribution.schedule_hash != message.schedule_hash
            || distribution.budget != amount.0
        {
            return amount;
        }
        distribution.funded = true;
        distribution.available_escrow = amount.0;
        self.distributions
            .insert(&message.distribution_id, &distribution);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"distribution_funded\",\"data\":[{{\"distribution_id\":{},\"amount\":\"{}\"}}]}}", message.distribution_id, amount.0));
        U128(0)
    }

    pub fn pay_recipient(&mut self, distribution_id: u64, recipient_id: AccountId) -> Promise {
        self.assert_active();
        let mut distribution = self
            .distributions
            .get(&distribution_id)
            .expect("distribution not found");
        assert!(
            distribution.funded && !distribution.cancelled,
            "distribution not funded"
        );
        let row = distribution
            .entitlements
            .iter_mut()
            .find(|e| e.account_id == recipient_id)
            .expect("recipient not in snapshot");
        assert!(
            matches!(
                row.payment_status,
                PaymentStatus::Ready | PaymentStatus::Failed
            ),
            "payment not retryable"
        );
        assert!(row.amount > 0, "zero entitlement");
        assert!(
            row.amount <= distribution.available_escrow,
            "insufficient distribution escrow"
        );
        row.attempt_id = row.attempt_id.checked_add(1).expect("attempt overflow");
        row.payment_status = PaymentStatus::InFlight;
        let amount = row.amount;
        let attempt_id = row.attempt_id;
        distribution.available_escrow -= amount;
        distribution.in_flight_total = distribution
            .in_flight_total
            .checked_add(amount)
            .expect("in-flight overflow");
        self.distributions.insert(&distribution_id, &distribution);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"payment_started\",\"data\":[{{\"distribution_id\":{},\"recipient\":\"{}\",\"attempt_id\":{},\"amount\":\"{}\"}}]}}", distribution_id, recipient_id, attempt_id, amount));
        let args = near_sdk::serde_json::json!({"receiver_id": recipient_id, "amount": amount.to_string()}).to_string().into_bytes();
        let callback_args = near_sdk::serde_json::json!({"distribution_id": distribution_id, "recipient_id": recipient_id, "attempt_id": attempt_id}).to_string().into_bytes();
        Promise::new(self.settlement_token_id.clone())
            .function_call(
                "ft_transfer".into(),
                args,
                NearToken::from_yoctonear(1),
                Gas::from_tgas(15),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_payment_result".into(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(15),
            ))
    }

    #[private]
    pub fn on_payment_result(
        &mut self,
        distribution_id: u64,
        recipient_id: AccountId,
        attempt_id: u64,
    ) {
        let mut distribution = self
            .distributions
            .get(&distribution_id)
            .expect("distribution not found");
        let row = distribution
            .entitlements
            .iter_mut()
            .find(|e| e.account_id == recipient_id)
            .expect("recipient not found");
        assert_eq!(row.attempt_id, attempt_id, "stale attempt");
        assert_eq!(
            row.payment_status,
            PaymentStatus::InFlight,
            "attempt not in flight"
        );
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        distribution.in_flight_total -= row.amount;
        if success {
            row.payment_status = PaymentStatus::Paid;
            distribution.paid_total = distribution
                .paid_total
                .checked_add(row.amount)
                .expect("paid overflow");
        } else {
            row.payment_status = PaymentStatus::Failed;
            distribution.available_escrow = distribution
                .available_escrow
                .checked_add(row.amount)
                .expect("escrow overflow");
        }
        self.distributions.insert(&distribution_id, &distribution);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"captable\",\"version\":\"1.0.0\",\"event\":\"payment_result\",\"data\":[{{\"distribution_id\":{},\"recipient\":\"{}\",\"attempt_id\":{},\"success\":{}}}]}}", distribution_id, recipient_id, attempt_id, success));
    }

    pub fn get_distribution(&self, distribution_id: u64) -> Option<DistributionView> {
        self.distributions
            .get(&distribution_id)
            .map(|d| DistributionView {
                id: d.id,
                snapshot_revision: d.snapshot_revision,
                snapshot_timestamp: d.snapshot_timestamp,
                snapshot_block_height: d.snapshot_block_height,
                token_id: d.token_id,
                budget: U128(d.budget),
                expires_at: d.expires_at,
                schedule_hash: d.schedule_hash,
                approved: d.approved,
                cancelled: d.cancelled,
                funded: d.funded,
                paid_total: U128(d.paid_total),
                in_flight_total: U128(d.in_flight_total),
                available_escrow: U128(d.available_escrow),
                entitlements: d
                    .entitlements
                    .into_iter()
                    .map(|e| EntitlementView {
                        account_id: e.account_id,
                        units: U128(e.units),
                        amount: U128(e.amount),
                        payment_status: e.payment_status,
                        attempt_id: e.attempt_id,
                    })
                    .collect(),
            })
    }

    pub fn list_distributions(&self, from_index: u32, limit: u32) -> Vec<DistributionView> {
        assert!(limit <= 20, "page limit exceeded");
        self.distribution_ids
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .map(|id| self.get_distribution(*id).expect("missing distribution"))
            .collect()
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
        self.assert_active();
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
        self.assert_active();
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
        self.assert_active();
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
        self.assert_active();
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
        self.assert_active();
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
    fn assert_active(&self) {
        assert!(!self.paused, "company paused");
    }
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
