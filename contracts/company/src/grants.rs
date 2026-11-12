//! Vesting grants: configurable monthly schedules and cliffs, founder grants from unallocated capacity,
//! board-approved acceleration, recipient acceptance of the grant terms, and claims.
use crate::*;
use near_sdk::serde_json::json;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum GrantSource {
    /// Reserved from the contributor pool; cancelled units return to the pool.
    Pool,
    /// Reserved directly from unallocated capacity (founder vesting); cancelled units return there.
    Unallocated,
}

#[derive(BorshSerialize, Serialize, Deserialize, Clone, Default)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct GrantTerms {
    /// Completed months before anything vests. Defaults to 12. Zero means no cliff.
    pub cliff_index: Option<u32>,
    /// Defaults to `Pool`.
    pub source: Option<GrantSource>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Grant {
    pub id: u64,
    pub recipient: AccountId,
    pub original_units: u128,
    pub entitlement_cap: u128,
    pub issued_units: u128,
    /// UTC seconds; index 0 is the start, each later entry one vesting month.
    pub boundaries: Vec<u64>,
    pub cliff_index: u32,
    pub source: GrantSource,
    pub accelerated_months: u32,
    pub doc_hash: Option<String>,
    pub accepted_terms_hash: Option<String>,
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
    pub cliff_index: u32,
    pub source: GrantSource,
    pub accelerated_months: u32,
    pub doc_hash: Option<String>,
    pub accepted_terms_hash: Option<String>,
    pub cancelled_at: Option<u64>,
}

#[near_bindgen]
impl Company {
    #[allow(clippy::too_many_arguments)]
    pub fn create_grant(
        &mut self,
        action_id: String,
        expected_revision: u64,
        recipient: AccountId,
        units: U128,
        boundaries: Vec<u64>,
        doc_hash: Option<String>,
        terms: Option<GrantTerms>,
    ) -> u64 {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let terms = terms.unwrap_or_default();
        let digest = Self::digest(&("create_grant", &action_id, expected_revision, &recipient, units.0, &boundaries, &doc_hash, &terms));
        if self.was_processed(&action_id, &digest) {
            return self.replayed_result(&action_id);
        }
        self.assert_revision(expected_revision);
        assert!(units.0 > 0, "units must be positive");
        assert!(self.grants.len() < MAX_GRANTS, "grant limit reached");
        assert!(
            (2..=MAX_VESTING_BOUNDARIES).contains(&boundaries.len()),
            "expected 2 to 121 boundaries (start plus up to 120 months)"
        );
        let cliff_index = terms.cliff_index.unwrap_or(DEFAULT_CLIFF_INDEX);
        assert!((cliff_index as usize) < boundaries.len(), "cliff must fall within the schedule");
        assert!(boundaries[0] > 0, "invalid grant start");
        assert!(boundaries.windows(2).all(|p| p[0] < p[1]), "boundaries must increase");
        let source = terms.source.unwrap_or(GrantSource::Pool);
        match source {
            GrantSource::Pool => {
                assert!(units.0 <= self.pool_available, "insufficient pool units");
                self.pool_available -= units.0;
            }
            GrantSource::Unallocated => assert!(units.0 <= self.unallocated(), "insufficient unallocated units"),
        }
        self.grant_reserved = self.grant_reserved.checked_add(units.0).expect("reserved overflow");
        let id = self.grants.len();
        self.grants.push(&Grant {
            id,
            recipient: recipient.clone(),
            original_units: units.0,
            entitlement_cap: units.0,
            issued_units: 0,
            boundaries,
            cliff_index,
            source,
            accelerated_months: 0,
            doc_hash: doc_hash.clone(),
            accepted_terms_hash: None,
            cancelled_at: None,
        });
        self.bump_revision();
        self.record_result(&action_id, digest, id);
        Self::emit("grant_created", json!({"grant_id": id, "recipient": recipient, "units": units, "cliff_index": cliff_index,
            "source": source, "revision": self.ledger_revision, "doc_hash": doc_hash}));
        id
    }

    /// Freezes the grant at what has vested now. Unvested units return to their source.
    pub fn cancel_unvested(&mut self, action_id: String, grant_id: u64, doc_hash: Option<String>) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("cancel_unvested", &action_id, grant_id, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut grant = self.grants.get(grant_id).expect("grant not found");
        assert!(grant.cancelled_at.is_none(), "grant already cancelled");
        let now = Self::now();
        let vested = Self::vested_at(&grant, now);
        let released = grant.entitlement_cap - vested;
        grant.entitlement_cap = vested;
        grant.cancelled_at = Some(now);
        self.grant_reserved -= released;
        if grant.source == GrantSource::Pool {
            self.pool_available = self.pool_available.checked_add(released).expect("pool overflow");
        }
        self.grants.replace(grant_id, &grant);
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("grant_cancelled", json!({"grant_id": grant_id, "released_units": U128(released), "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// Board-approved acceleration: counts `months` extra completed months (capped at the schedule end),
    /// for example single- or double-trigger acceleration on an acquisition.
    pub fn accelerate_grant(&mut self, action_id: String, grant_id: u64, months: u32, doc_hash: Option<String>) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("accelerate_grant", &action_id, grant_id, months, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        assert!(months > 0, "months must be positive");
        let mut grant = self.grants.get(grant_id).expect("grant not found");
        assert!(grant.cancelled_at.is_none(), "grant cancelled");
        let total = (grant.boundaries.len() - 1) as u32;
        grant.accelerated_months = grant.accelerated_months.saturating_add(months).min(total);
        self.grants.replace(grant_id, &grant);
        self.bump_revision();
        self.record_action(&action_id, digest);
        Self::emit("grant_accelerated", json!({"grant_id": grant_id, "accelerated_months": grant.accelerated_months,
            "revision": self.ledger_revision, "doc_hash": doc_hash}));
    }

    /// The recipient records that they accept the grant's terms. When the board attached a document
    /// hash, the accepted hash must match it.
    pub fn accept_grant(&mut self, grant_id: u64, terms_hash: String) {
        assert!(!self.closed, "company closed");
        let mut grant = self.grants.get(grant_id).expect("grant not found");
        assert_eq!(env::predecessor_account_id(), grant.recipient, "grant recipient only");
        Self::validate_doc_hash(&Some(terms_hash.clone()));
        if let Some(expected) = &grant.doc_hash {
            assert_eq!(expected, &terms_hash, "terms hash differs from the approved grant document");
        }
        match &grant.accepted_terms_hash {
            Some(previous) => assert_eq!(previous, &terms_hash, "grant already accepted with different terms"),
            None => {
                grant.accepted_terms_hash = Some(terms_hash.clone());
                self.grants.replace(grant_id, &grant);
                Self::emit("grant_accepted", json!({"grant_id": grant_id, "recipient": grant.recipient, "terms_hash": terms_hash}));
            }
        }
    }

    pub fn claim_vested(&mut self, grant_id: u64) -> U128 {
        self.assert_active();
        let mut grant = self.grants.get(grant_id).expect("grant not found");
        let caller = env::predecessor_account_id();
        assert_eq!(caller, grant.recipient, "grant recipient only");
        let vested = Self::vested_at(&grant, Self::now());
        let claimable = vested.checked_sub(grant.issued_units).expect("grant accounting error");
        assert!(claimable > 0, "nothing to claim");
        self.credit(&caller, claimable);
        self.issued_total = self.issued_total.checked_add(claimable).expect("total overflow");
        self.grant_reserved -= claimable;
        grant.issued_units += claimable;
        self.grants.replace(grant_id, &grant);
        self.bump_revision();
        Self::emit("grant_claimed", json!({"grant_id": grant_id, "units": U128(claimable), "revision": self.ledger_revision}));
        U128(claimable)
    }

    pub fn get_grant(&self, grant_id: u64) -> Option<GrantView> {
        self.grants.get(grant_id).map(|grant| Self::grant_view(grant, Self::now()))
    }

    pub fn get_vesting_status(&self, grant_id: u64) -> Option<GrantView> {
        self.get_grant(grant_id)
    }

    pub fn list_grants(&self, from_index: u32, limit: u32) -> Vec<GrantView> {
        assert!(limit <= 20, "page limit exceeded");
        let now = Self::now();
        (from_index as u64..self.grants.len().min(from_index as u64 + limit as u64))
            .map(|id| Self::grant_view(self.grants.get(id).expect("missing grant"), now))
            .collect()
    }
}

impl Company {
    /// vested = 0 before the cliff, else floor(original × completed months / schedule months),
    /// never above the entitlement cap. Acceleration adds completed months.
    pub(crate) fn vested_at(grant: &Grant, now: u64) -> u128 {
        let total = (grant.boundaries.len() - 1) as u32;
        let completed = grant.boundaries.iter().skip(1).take_while(|&&t| t <= now).count() as u32;
        let months = completed.saturating_add(grant.accelerated_months).min(total);
        if months < grant.cliff_index || months == 0 {
            return 0;
        }
        let vested = grant.original_units.checked_mul(months as u128).expect("vesting overflow") / total as u128;
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
            claimable_units: U128(vested.saturating_sub(grant.issued_units)),
            boundaries: grant.boundaries,
            cliff_index: grant.cliff_index,
            source: grant.source,
            accelerated_months: grant.accelerated_months,
            doc_hash: grant.doc_hash,
            accepted_terms_hash: grant.accepted_terms_hash,
            cancelled_at: grant.cancelled_at,
        }
    }
}
