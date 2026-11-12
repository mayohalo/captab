//! Distributions: pro-rata snapshots prepared by the operator, explicit payout lists prepared by the
//! board (exit waterfalls, preferences), exact DAO funding, and per-recipient payment attempts.
//! Payout rows live in their own map, so a payment reads and writes one row, not the whole table.
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{Gas, NearToken, Promise, PromiseResult};
use std::collections::HashSet;

pub(crate) const PRO_RATA_DOMAIN: &str = "near:testnet/captable.distribution.v1";
pub(crate) const EXPLICIT_DOMAIN: &str = "near:testnet/captable.distribution.explicit.v1";

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PaymentStatus {
    Ready,
    InFlight,
    Failed,
    Paid,
    Zero,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum DistributionKind {
    /// Split across issued units at the snapshot, largest-remainder rounding.
    ProRata,
    /// Exact amounts per stakeholder, prepared and approved by the board in one action.
    Explicit,
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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Distribution {
    pub id: u64,
    pub kind: DistributionKind,
    pub label: Option<String>,
    pub doc_hash: Option<String>,
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
    pub row_count: u32,
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
    pub kind: DistributionKind,
    pub label: Option<String>,
    pub doc_hash: Option<String>,
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

#[derive(BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutRow {
    pub account_id: AccountId,
    pub amount: U128,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct FundingMessage {
    pub distribution_id: u64,
    pub schedule_hash: Vec<u8>,
}

#[near_bindgen]
impl Company {
    pub fn prepare_distribution(&mut self, expected_revision: u64, budget: U128, expires_at: u64) -> u64 {
        self.assert_active();
        assert_eq!(env::predecessor_account_id(), self.snapshot_operator_id, "snapshot operator only");
        self.assert_revision(expected_revision);
        assert!(self.issued_total > 0, "no issued units");
        Self::assert_new_distribution(&self.distributions, budget.0, expires_at);
        let issued = self.issued_total;
        let mut rows: Vec<(Entitlement, u128)> = self
            .holders
            .iter()
            .map(|(account_id, holding)| {
                let numerator = budget.0.checked_mul(holding.units).expect("distribution multiplication overflow");
                let entitlement = Entitlement { account_id, units: holding.units, amount: numerator / issued,
                    payment_status: PaymentStatus::Ready, attempt_id: 0 };
                (entitlement, numerator % issued)
            })
            .collect();
        let allocated = rows.iter().try_fold(0u128, |sum, (row, _)| sum.checked_add(row.amount)).expect("distribution total overflow");
        let leftover = budget.0.checked_sub(allocated).expect("distribution allocation error");
        let mut rank: Vec<usize> = (0..rows.len()).collect();
        rank.sort_by(|&a, &b| rows[b].1.cmp(&rows[a].1).then_with(|| rows[a].0.account_id.cmp(&rows[b].0.account_id)));
        assert!((leftover as usize) <= rank.len(), "rounding error");
        for index in rank.into_iter().take(leftover as usize) {
            rows[index].0.amount += 1;
        }
        let entitlements = rows
            .into_iter()
            .map(|(mut row, _)| {
                if row.amount == 0 {
                    row.payment_status = PaymentStatus::Zero;
                }
                row
            })
            .collect();
        let id = self.store_distribution(DistributionKind::ProRata, None, None, budget.0, expires_at, entitlements, false);
        Self::emit("distribution_prepared", json!({"distribution_id": id, "kind": DistributionKind::ProRata, "revision": self.ledger_revision}));
        id
    }

    /// The board sets exact amounts per stakeholder (for example an exit waterfall with liquidation
    /// preferences). Recipients must be current holders or grant recipients; amounts must add up to the
    /// budget exactly. Preparing it is the approval, so the next step is DAO funding.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_explicit_distribution(
        &mut self,
        action_id: String,
        expected_revision: u64,
        budget: U128,
        expires_at: u64,
        payouts: Vec<PayoutRow>,
        label: Option<String>,
        doc_hash: Option<String>,
    ) -> u64 {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        if let Some(text) = &label {
            assert!(!text.is_empty() && text.len() <= 40 && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b' '),
                "label must be 1-40 letters, digits, spaces, or hyphens");
        }
        let digest = Self::digest(&("prepare_explicit_distribution", &action_id, expected_revision, budget.0, expires_at, &payouts, &label, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return self.replayed_result(&action_id);
        }
        self.assert_revision(expected_revision);
        Self::assert_new_distribution(&self.distributions, budget.0, expires_at);
        assert!(!payouts.is_empty() && payouts.len() <= MAX_PAYOUT_ROWS, "expected 1 to 100 payout rows");
        let grant_recipients: HashSet<AccountId> = self.grants.iter().map(|grant| grant.recipient).collect();
        let mut seen = HashSet::new();
        let mut total = 0u128;
        let entitlements = payouts
            .iter()
            .map(|row| {
                assert!(seen.insert(row.account_id.clone()), "duplicate payout recipient");
                let holding = self.holding(&row.account_id);
                assert!(holding.units > 0 || grant_recipients.contains(&row.account_id), "payout recipient is not a stakeholder");
                total = total.checked_add(row.amount.0).expect("payout total overflow");
                Entitlement { account_id: row.account_id.clone(), units: holding.units, amount: row.amount.0,
                    payment_status: if row.amount.0 == 0 { PaymentStatus::Zero } else { PaymentStatus::Ready }, attempt_id: 0 }
            })
            .collect();
        assert_eq!(total, budget.0, "payouts must add up to the budget");
        let id = self.store_distribution(DistributionKind::Explicit, label.clone(), doc_hash.clone(), budget.0, expires_at, entitlements, true);
        self.record_result(&action_id, digest, id);
        Self::emit("distribution_prepared", json!({"distribution_id": id, "kind": DistributionKind::Explicit, "label": label,
            "revision": self.ledger_revision, "doc_hash": doc_hash}));
        id
    }

    pub fn approve_distribution(&mut self, action_id: String, distribution_id: u64, schedule_hash: Vec<u8>) {
        self.assert_dao();
        self.assert_active();
        let digest = Self::digest(&("approve_distribution", &action_id, distribution_id, &schedule_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut distribution = self.distributions.get(distribution_id).expect("distribution not found");
        assert!(!distribution.approved && !distribution.cancelled, "distribution closed");
        assert!(Self::now() < distribution.expires_at, "distribution expired");
        assert_eq!(distribution.schedule_hash, schedule_hash, "schedule hash mismatch");
        distribution.approved = true;
        self.distributions.replace(distribution_id, &distribution);
        self.record_action(&action_id, digest);
        Self::emit("distribution_approved", json!({"distribution_id": distribution_id}));
    }

    pub fn cancel_unfunded_distribution(&mut self, action_id: String, distribution_id: u64) {
        self.assert_dao();
        assert!(!self.closed, "company closed");
        let digest = Self::digest(&("cancel_unfunded_distribution", &action_id, distribution_id));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut distribution = self.distributions.get(distribution_id).expect("distribution not found");
        assert!(!distribution.funded && !distribution.cancelled, "distribution cannot be cancelled");
        distribution.cancelled = true;
        self.distributions.replace(distribution_id, &distribution);
        self.record_action(&action_id, digest);
        Self::emit("distribution_cancelled", json!({"distribution_id": distribution_id}));
    }

    pub fn pay_recipient(&mut self, distribution_id: u64, recipient_id: AccountId) -> Promise {
        self.assert_active();
        let mut distribution = self.distributions.get(distribution_id).expect("distribution not found");
        assert!(distribution.funded && !distribution.cancelled, "distribution not funded");
        let index = self.entitlement_index.get(&(distribution_id, recipient_id.clone())).expect("recipient not in snapshot");
        let mut row = self.entitlements.get(&(distribution_id, index)).expect("missing entitlement");
        assert!(matches!(row.payment_status, PaymentStatus::Ready | PaymentStatus::Failed), "payment not retryable");
        assert!(row.amount > 0, "zero entitlement");
        assert!(row.amount <= distribution.available_escrow, "insufficient distribution escrow");
        row.attempt_id = row.attempt_id.checked_add(1).expect("attempt overflow");
        row.payment_status = PaymentStatus::InFlight;
        distribution.available_escrow -= row.amount;
        distribution.in_flight_total = distribution.in_flight_total.checked_add(row.amount).expect("in-flight overflow");
        self.entitlements.insert(&(distribution_id, index), &row);
        self.distributions.replace(distribution_id, &distribution);
        Self::emit("payment_started", json!({"distribution_id": distribution_id, "recipient": recipient_id,
            "attempt_id": row.attempt_id, "amount": U128(row.amount)}));
        let args = json!({"receiver_id": recipient_id, "amount": U128(row.amount)}).to_string().into_bytes();
        let callback = json!({"distribution_id": distribution_id, "recipient_id": recipient_id, "attempt_id": row.attempt_id})
            .to_string()
            .into_bytes();
        Promise::new(self.settlement_token_id.clone())
            .function_call("ft_transfer".into(), args, NearToken::from_yoctonear(1), Gas::from_tgas(15))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_payment_result".into(), callback, NearToken::from_yoctonear(0), Gas::from_tgas(15)))
    }

    #[private]
    pub fn on_payment_result(&mut self, distribution_id: u64, recipient_id: AccountId, attempt_id: u64) {
        #[cfg(all(feature = "sandbox-failed-callback", target_arch = "wasm32"))]
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            env::panic_str("sandbox-injected payment callback failure");
        }
        let mut distribution = self.distributions.get(distribution_id).expect("distribution not found");
        let index = self.entitlement_index.get(&(distribution_id, recipient_id.clone())).expect("recipient not found");
        let mut row = self.entitlements.get(&(distribution_id, index)).expect("missing entitlement");
        assert_eq!(row.attempt_id, attempt_id, "stale attempt");
        assert_eq!(row.payment_status, PaymentStatus::InFlight, "attempt not in flight");
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        distribution.in_flight_total -= row.amount;
        if success {
            row.payment_status = PaymentStatus::Paid;
            distribution.paid_total = distribution.paid_total.checked_add(row.amount).expect("paid overflow");
        } else {
            row.payment_status = PaymentStatus::Failed;
            distribution.available_escrow = distribution.available_escrow.checked_add(row.amount).expect("escrow overflow");
        }
        self.entitlements.insert(&(distribution_id, index), &row);
        self.distributions.replace(distribution_id, &distribution);
        Self::emit("payment_result", json!({"distribution_id": distribution_id, "recipient": recipient_id,
            "attempt_id": attempt_id, "success": success}));
    }

    pub fn get_distribution(&self, distribution_id: u64) -> Option<DistributionView> {
        self.distributions.get(distribution_id).map(|d| {
            let entitlements = self.entitlement_views(d.id, 0, d.row_count);
            DistributionView {
                id: d.id,
                kind: d.kind,
                label: d.label,
                doc_hash: d.doc_hash,
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
                entitlements,
            }
        })
    }

    pub fn list_entitlements(&self, distribution_id: u64, from_index: u32, limit: u32) -> Vec<EntitlementView> {
        assert!(limit <= MAX_PAYOUT_ROWS as u32, "page limit exceeded");
        let distribution = self.distributions.get(distribution_id).expect("distribution not found");
        let end = distribution.row_count.min(from_index.saturating_add(limit));
        self.entitlement_views(distribution_id, from_index.min(end), end)
    }

    pub fn list_distributions(&self, from_index: u32, limit: u32) -> Vec<DistributionView> {
        assert!(limit <= 20, "page limit exceeded");
        (from_index as u64..self.distributions.len().min(from_index as u64 + limit as u64))
            .map(|id| self.get_distribution(id).expect("missing distribution"))
            .collect()
    }
}

impl Company {
    fn assert_new_distribution(distributions: &Vector<Distribution>, budget: u128, expires_at: u64) {
        assert!(budget > 0 && budget <= MAX_TOKEN_AMOUNT, "invalid budget");
        assert!(expires_at > Self::now(), "snapshot already expired");
        assert!(distributions.len() < MAX_DISTRIBUTIONS, "distribution limit reached");
    }

    /// Sorts rows by account, hashes the immutable schedule, and stores the header and rows.
    #[allow(clippy::too_many_arguments)]
    fn store_distribution(
        &mut self,
        kind: DistributionKind,
        label: Option<String>,
        doc_hash: Option<String>,
        budget: u128,
        expires_at: u64,
        mut entitlements: Vec<Entitlement>,
        approved: bool,
    ) -> u64 {
        entitlements.sort_by(|a, b| a.account_id.cmp(&b.account_id));
        let id = self.distributions.len();
        let now = Self::now();
        let block_height = env::block_height();
        let immutable_rows: Vec<_> = entitlements.iter().map(|e| (&e.account_id, e.units, e.amount)).collect();
        let domain = match kind {
            DistributionKind::ProRata => PRO_RATA_DOMAIN,
            DistributionKind::Explicit => EXPLICIT_DOMAIN,
        };
        let payload = (domain, env::current_account_id(), id, self.ledger_revision, now, block_height,
            &self.settlement_token_id, budget, expires_at, &immutable_rows);
        let schedule_hash = env::sha256(&near_sdk::borsh::to_vec(&payload).expect("serialize schedule"));
        for (index, row) in entitlements.iter().enumerate() {
            self.entitlements.insert(&(id, index as u32), row);
            self.entitlement_index.insert(&(id, row.account_id.clone()), &(index as u32));
        }
        self.distributions.push(&Distribution {
            id,
            kind,
            label,
            doc_hash,
            snapshot_revision: self.ledger_revision,
            snapshot_timestamp: now,
            snapshot_block_height: block_height,
            token_id: self.settlement_token_id.clone(),
            budget,
            expires_at,
            schedule_hash,
            approved,
            cancelled: false,
            funded: false,
            paid_total: 0,
            in_flight_total: 0,
            available_escrow: 0,
            row_count: entitlements.len() as u32,
        });
        id
    }

    fn entitlement_views(&self, distribution_id: u64, from: u32, to: u32) -> Vec<EntitlementView> {
        (from..to)
            .map(|index| {
                let e = self.entitlements.get(&(distribution_id, index)).expect("missing entitlement");
                EntitlementView { account_id: e.account_id, units: U128(e.units), amount: U128(e.amount),
                    payment_status: e.payment_status, attempt_id: e.attempt_id }
            })
            .collect()
    }

    pub(crate) fn fund_distribution(&mut self, message: FundingMessage, sender_id: AccountId, amount: U128) -> U128 {
        if sender_id != self.dao_id {
            return amount;
        }
        let Some(mut distribution) = self.distributions.get(message.distribution_id) else {
            return amount;
        };
        if !distribution.approved
            || distribution.cancelled
            || distribution.funded
            || distribution.token_id != self.settlement_token_id
            || Self::now() >= distribution.expires_at
            || distribution.schedule_hash != message.schedule_hash
            || distribution.budget != amount.0
        {
            return amount;
        }
        distribution.funded = true;
        distribution.available_escrow = amount.0;
        self.distributions.replace(message.distribution_id, &distribution);
        Self::emit("distribution_funded", json!({"distribution_id": message.distribution_id, "amount": amount}));
        U128(0)
    }
}
