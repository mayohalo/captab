//! Authorized capacity, issuance, pool, retirement, wallet replacement, pause, and close.
use crate::*;
use near_sdk::serde_json::json;

#[near_bindgen]
impl Company {
    pub fn set_paused(&mut self, action_id: String, paused: bool) {
        self.assert_dao();
        assert!(!self.closed, "company closed");
        let digest = Self::digest(&("set_paused", &action_id, paused));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.paused = paused;
        self.record_action(&action_id, digest);
        Self::emit("pause_changed", json!({"paused": paused}));
    }

    pub fn issue_founder_units(
        &mut self,
        action_id: String,
        expected_revision: u64,
        recipient: AccountId,
        units: U128,
        doc_hash: Option<String>,
    ) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("issue_founder_units", &action_id, expected_revision, &recipient, units.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(units.0 <= self.unallocated(), "insufficient unallocated units");
        self.credit(&recipient, units.0);
        self.issued_total = self.issued_total.checked_add(units.0).expect("total overflow");
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("founder_issued", json!({"recipient": recipient, "units": units, "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    pub fn increase_pool(&mut self, action_id: String, expected_revision: u64, units: U128, doc_hash: Option<String>) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("increase_pool", &action_id, expected_revision, units.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(units.0 <= self.unallocated(), "insufficient unallocated units");
        self.pool_available = self.pool_available.checked_add(units.0).expect("pool overflow");
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("pool_increased", json!({"units": units, "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Returns unused pool units to unallocated capacity.
    pub fn decrease_pool(&mut self, action_id: String, expected_revision: u64, units: U128, doc_hash: Option<String>) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("decrease_pool", &action_id, expected_revision, units.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(units.0 <= self.pool_available, "insufficient pool units");
        self.pool_available -= units.0;
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("pool_decreased", json!({"units": units, "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Charter amendment: raises the authorized unit ceiling. It can never be lowered.
    pub fn increase_authorized(
        &mut self,
        action_id: String,
        expected_revision: u64,
        authorized_units: U128,
        doc_hash: Option<String>,
    ) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("increase_authorized", &action_id, expected_revision, authorized_units.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(authorized_units.0 > self.authorized_units, "authorized units can only increase");
        assert!(authorized_units.0 <= MAX_AUTHORIZED_UNITS, "authorized unit limit exceeded");
        let previous = self.authorized_units;
        self.authorized_units = authorized_units.0;
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("authorized_increased", json!({"previous": U128(previous), "authorized_units": authorized_units,
            "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Board-approved retirement of issued units (repurchase under a signed agreement, or a correction).
    /// Units committed to an accepted deal cannot be retired. Retired units return to unallocated capacity.
    pub fn retire_units(
        &mut self,
        action_id: String,
        expected_revision: u64,
        account_id: AccountId,
        units: U128,
        doc_hash: Option<String>,
    ) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("retire_units", &action_id, expected_revision, &account_id, units.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        self.debit(&account_id, units.0, false);
        self.issued_total -= units.0;
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("units_retired", json!({"account_id": account_id, "units": units, "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Moves a holder's whole position to a new account they control (lost or rotated wallet).
    /// Unclaimed or unvested grants follow; fully issued grants keep their recipient as history.
    /// Blocked while the old account has an open deal or any unpaid distribution entitlement, so a
    /// frozen payout is never redirected.
    pub fn reassign_holding(
        &mut self,
        action_id: String,
        expected_revision: u64,
        from: AccountId,
        to: AccountId,
        doc_hash: Option<String>,
    ) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("reassign_holding", &action_id, expected_revision, &from, &to, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        self.assert_revision(expected_revision);
        assert_ne!(from, to, "accounts must differ");
        for id in 0..self.distributions.len() {
            let distribution = self.distributions.get(id).expect("missing distribution");
            if distribution.cancelled {
                continue;
            }
            if let Some(index) = self.entitlement_index.get(&(id, from.clone())) {
                let row = self.entitlements.get(&(id, index)).expect("missing entitlement");
                assert!(
                    !matches!(row.payment_status, PaymentStatus::Ready | PaymentStatus::Failed | PaymentStatus::InFlight),
                    "account has an unpaid distribution entitlement"
                );
            }
        }
        for id in 0..self.deals.len() {
            let deal = self.deals.get(id).expect("missing deal");
            if matches!(deal.status, DealStatus::Approved | DealStatus::Accepted) {
                assert!(deal.seller.as_ref() != Some(&from) && deal.buyer.as_ref() != Some(&from), "account has an open deal");
            }
        }
        let units = self.holding(&from).units;
        if units > 0 {
            self.debit(&from, units, false);
            self.credit(&to, units);
        }
        let mut moved_grants = Vec::new();
        for id in 0..self.grants.len() {
            let mut grant = self.grants.get(id).expect("missing grant");
            if grant.recipient == from && grant.entitlement_cap > grant.issued_units {
                grant.recipient = to.clone();
                self.grants.replace(id, &grant);
                moved_grants.push(id);
            }
        }
        assert!(units > 0 || !moved_grants.is_empty(), "nothing to reassign");
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("holding_reassigned", json!({"from": from, "to": to, "units": U128(units), "grant_ids": moved_grants,
            "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Final state after an exit or wind-down. Requires every distribution to be fully paid or
    /// cancelled and every deal to be settled (with proceeds delivered) or cancelled. Afterwards only
    /// views work; nothing can unpause or reopen the company.
    pub fn close_company(&mut self, action_id: String, doc_hash: Option<String>) {
        self.assert_dao();
        assert!(!self.closed, "company closed");
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("close_company", &action_id, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        for distribution in self.distributions.iter() {
            assert!(
                distribution.cancelled || (distribution.funded && distribution.paid_total == distribution.budget),
                "every distribution must be paid in full or cancelled"
            );
        }
        for deal in self.deals.iter() {
            assert!(
                matches!(deal.status, DealStatus::Cancelled)
                    || (matches!(deal.status, DealStatus::Settled) && deal.proceeds_pending == 0 && !deal.forward_in_flight),
                "every deal must be settled with proceeds delivered, or cancelled"
            );
        }
        self.closed = true;
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("company_closed", json!({"revision": self.ledger_revision, "issued_total": U128(self.issued_total), "doc_hash": doc_hash}));
    }
}
