//! Rounds and deals. A deal is a board-approved trade of units for settlement tokens:
//! - `Issue`: the company sells new units to an investor in an open round. The investor pays with
//!   `ft_transfer_call`; units are issued in that receipt and the money is forwarded to the DAO.
//! - `Secondary`: a holder sells to a buyer. The seller accepts (locking the units), the buyer pays,
//!   units move, and the money is forwarded to the seller.
//! - `Buyback`: the company buys units back. The seller accepts, the DAO pays, units are retired.
//! No unit ever moves without both a board approval and, for an existing holder, their own signature.
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{Gas, NearToken, Promise, PromiseResult};

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum DealKind {
    Issue,
    Secondary,
    Buyback,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum DealStatus {
    /// Board approved. Issue deals are payable now; sales and buybacks await the seller.
    Approved,
    /// Seller accepted and their units are locked; payable.
    Accepted,
    Settled,
    Cancelled,
}

#[derive(BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct DealTerms {
    pub kind: DealKind,
    /// The selling holder; omit for `Issue`.
    pub seller: Option<AccountId>,
    /// The paying buyer; omit for `Buyback` (the DAO pays).
    pub buyer: Option<AccountId>,
    pub units: U128,
    /// Total price in settlement-token base units.
    pub price: U128,
    pub expires_at: u64,
    /// Required for `Issue`: the open round whose price per unit applies.
    pub round_id: Option<String>,
    pub doc_hash: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Deal {
    pub id: u64,
    pub kind: DealKind,
    pub seller: Option<AccountId>,
    pub buyer: Option<AccountId>,
    pub units: u128,
    pub price: u128,
    pub expires_at: u64,
    pub round_id: Option<String>,
    pub doc_hash: Option<String>,
    pub status: DealStatus,
    pub settled_at: Option<u64>,
    /// Who receives the payment after settlement: the DAO for issuance, otherwise the seller.
    pub proceeds_recipient: AccountId,
    /// Payment held by the company until a forward to the recipient succeeds.
    pub proceeds_pending: u128,
    pub forward_attempt: u64,
    pub forward_in_flight: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DealView {
    pub id: u64,
    pub kind: DealKind,
    pub seller: Option<AccountId>,
    pub buyer: Option<AccountId>,
    pub units: U128,
    pub price: U128,
    pub expires_at: u64,
    pub round_id: Option<String>,
    pub doc_hash: Option<String>,
    pub status: DealStatus,
    pub settled_at: Option<u64>,
    pub proceeds_recipient: AccountId,
    pub proceeds_pending: U128,
    pub forward_attempt: u64,
    pub forward_in_flight: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Round {
    pub id: String,
    /// Settlement-token base units per ownership unit; the round's recorded valuation.
    pub price_per_unit: u128,
    pub doc_hash: Option<String>,
    pub opened_at: u64,
    pub closed_at: Option<u64>,
    pub units_issued: u128,
    pub amount_raised: u128,
    pub deal_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundView {
    pub id: String,
    pub price_per_unit: U128,
    pub doc_hash: Option<String>,
    pub opened_at: u64,
    pub closed_at: Option<u64>,
    pub units_issued: U128,
    pub amount_raised: U128,
    pub deal_count: u32,
}

#[near_bindgen]
impl Company {
    pub fn create_round(&mut self, action_id: String, round_id: String, price_per_unit: U128, doc_hash: Option<String>) {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&doc_hash);
        let digest = Self::digest(&("create_round", &action_id, &round_id, price_per_unit.0, &doc_hash));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        assert!(
            !round_id.is_empty() && round_id.len() <= 32 && round_id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            "round id must be 1-32 lowercase letters, digits, or hyphens"
        );
        assert!(self.rounds.get(&round_id).is_none(), "round already exists");
        assert!(self.rounds.len() < MAX_ROUNDS, "round limit reached");
        assert!(price_per_unit.0 > 0 && price_per_unit.0 <= MAX_TOKEN_AMOUNT, "invalid price per unit");
        self.rounds.insert(&round_id, &Round { id: round_id.clone(), price_per_unit: price_per_unit.0, doc_hash: doc_hash.clone(),
            opened_at: Self::now(), closed_at: None, units_issued: 0, amount_raised: 0, deal_count: 0 });
        self.record_action(&action_id, digest);
        Self::emit("round_created", json!({"round_id": round_id, "price_per_unit": price_per_unit, "doc_hash": doc_hash}));
    }

    /// Closes a round to new deals. Its open issuance deals must be settled or cancelled first.
    pub fn close_round(&mut self, action_id: String, round_id: String) {
        self.assert_dao();
        assert!(!self.closed, "company closed");
        let digest = Self::digest(&("close_round", &action_id, &round_id));
        if self.was_processed(&action_id, &digest) {
            return;
        }
        let mut round = self.rounds.get(&round_id).expect("round not found");
        assert!(round.closed_at.is_none(), "round already closed");
        assert!(
            !self.deals.iter().any(|d| d.round_id.as_ref() == Some(&round_id) && d.status == DealStatus::Approved),
            "round has open deals"
        );
        round.closed_at = Some(Self::now());
        self.rounds.insert(&round_id, &round);
        self.record_action(&action_id, digest);
        Self::emit("round_closed", json!({"round_id": round_id, "units_issued": U128(round.units_issued), "amount_raised": U128(round.amount_raised)}));
    }

    pub fn approve_deal(&mut self, action_id: String, terms: DealTerms) -> u64 {
        self.assert_dao();
        self.assert_active();
        Self::validate_doc_hash(&terms.doc_hash);
        let digest = Self::digest(&("approve_deal", &action_id, &terms));
        if self.was_processed(&action_id, &digest) {
            return self.replayed_result(&action_id);
        }
        assert!(self.deals.len() < MAX_DEALS, "deal limit reached");
        assert!(terms.units.0 > 0, "units must be positive");
        assert!(terms.price.0 > 0 && terms.price.0 <= MAX_TOKEN_AMOUNT, "invalid price");
        assert!(terms.expires_at > Self::now(), "deal already expired");
        let proceeds_recipient = match terms.kind {
            DealKind::Issue => {
                assert!(terms.seller.is_none(), "issuance has no seller");
                let buyer = terms.buyer.as_ref().expect("issuance needs a buyer");
                assert_ne!(buyer, &env::current_account_id(), "invalid buyer");
                let round_id = terms.round_id.as_ref().expect("issuance needs a round");
                let mut round = self.rounds.get(round_id).expect("round not found");
                assert!(round.closed_at.is_none(), "round closed");
                assert_eq!(
                    Some(terms.price.0),
                    terms.units.0.checked_mul(round.price_per_unit),
                    "price must equal units times the round price"
                );
                assert!(terms.units.0 <= self.unallocated(), "insufficient unallocated units");
                self.deal_reserved = self.deal_reserved.checked_add(terms.units.0).expect("reserved overflow");
                round.deal_count += 1;
                self.rounds.insert(round_id, &round);
                self.bump_revision();
                self.dao_id.clone()
            }
            DealKind::Secondary | DealKind::Buyback => {
                assert!(terms.round_id.is_none(), "only issuance deals belong to a round");
                let seller = terms.seller.as_ref().expect("sale needs a seller");
                assert!(self.holding(seller).units >= terms.units.0, "seller does not hold enough units");
                match terms.kind {
                    DealKind::Secondary => {
                        let buyer = terms.buyer.as_ref().expect("secondary sale needs a buyer");
                        assert_ne!(buyer, seller, "buyer and seller must differ");
                        assert_ne!(buyer, &env::current_account_id(), "invalid buyer");
                    }
                    _ => assert!(terms.buyer.is_none(), "the DAO pays for a buyback; omit buyer"),
                }
                seller.clone()
            }
        };
        let id = self.deals.len();
        self.deals.push(&Deal {
            id,
            kind: terms.kind,
            seller: terms.seller.clone(),
            buyer: terms.buyer.clone(),
            units: terms.units.0,
            price: terms.price.0,
            expires_at: terms.expires_at,
            round_id: terms.round_id.clone(),
            doc_hash: terms.doc_hash.clone(),
            status: DealStatus::Approved,
            settled_at: None,
            proceeds_recipient,
            proceeds_pending: 0,
            forward_attempt: 0,
            forward_in_flight: false,
        });
        self.record_result(&action_id, digest, id);
        Self::emit("deal_approved", json!({"deal_id": id, "kind": terms.kind, "seller": terms.seller, "buyer": terms.buyer,
            "units": terms.units, "price": terms.price, "round_id": terms.round_id, "doc_hash": terms.doc_hash}));
        id
    }

    /// The seller signs the board-approved sale or buyback and locks the units until settlement.
    pub fn accept_deal(&mut self, deal_id: u64) {
        self.assert_active();
        let mut deal = self.deals.get(deal_id).expect("deal not found");
        assert!(matches!(deal.kind, DealKind::Secondary | DealKind::Buyback), "issuance needs no acceptance");
        assert_eq!(deal.status, DealStatus::Approved, "deal not open");
        assert!(Self::now() < deal.expires_at, "deal expired");
        let seller = deal.seller.clone().expect("missing seller");
        assert_eq!(env::predecessor_account_id(), seller, "seller only");
        let mut holding = self.holders.get(&seller).expect("seller holds no units");
        assert!(holding.units - holding.locked >= deal.units, "insufficient unlocked units");
        holding.locked += deal.units;
        self.holders.insert(&seller, &holding);
        deal.status = DealStatus::Accepted;
        self.deals.replace(deal_id, &deal);
        Self::emit("deal_accepted", json!({"deal_id": deal_id, "seller": seller}));
    }

    /// Cancels an unsettled deal and releases locked or reserved units. The DAO may cancel at any time,
    /// the seller may withdraw a sale, and anyone may clean up after expiry.
    pub fn cancel_deal(&mut self, deal_id: u64) {
        let mut deal = self.deals.get(deal_id).expect("deal not found");
        assert!(matches!(deal.status, DealStatus::Approved | DealStatus::Accepted), "deal not open");
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.dao_id || deal.seller.as_ref() == Some(&caller) || Self::now() >= deal.expires_at,
            "only the DAO or the seller can cancel before expiry"
        );
        match deal.kind {
            DealKind::Issue => {
                self.deal_reserved -= deal.units;
                self.bump_revision();
            }
            _ if deal.status == DealStatus::Accepted => {
                let seller = deal.seller.clone().expect("missing seller");
                let mut holding = self.holders.get(&seller).expect("seller holding missing");
                holding.locked -= deal.units;
                self.holders.insert(&seller, &holding);
            }
            _ => {}
        }
        deal.status = DealStatus::Cancelled;
        self.deals.replace(deal_id, &deal);
        Self::emit("deal_cancelled", json!({"deal_id": deal_id, "by": caller}));
    }

    /// Retries delivering held proceeds, for example after the seller registers with the token.
    pub fn forward_proceeds(&mut self, deal_id: u64) -> Promise {
        let mut deal = self.deals.get(deal_id).expect("deal not found");
        assert_eq!(deal.status, DealStatus::Settled, "deal not settled");
        assert!(deal.proceeds_pending > 0, "no proceeds pending");
        assert!(!deal.forward_in_flight, "forward already in flight");
        let promise = self.start_forward(&mut deal);
        self.deals.replace(deal_id, &deal);
        promise
    }

    #[private]
    pub fn on_proceeds_forwarded(&mut self, deal_id: u64, attempt_id: u64) {
        let mut deal = self.deals.get(deal_id).expect("deal not found");
        assert_eq!(deal.forward_attempt, attempt_id, "stale forward attempt");
        assert!(deal.forward_in_flight, "forward not in flight");
        let success = matches!(env::promise_result(0), PromiseResult::Successful(_));
        deal.forward_in_flight = false;
        if success {
            deal.proceeds_pending = 0;
        }
        self.deals.replace(deal_id, &deal);
        Self::emit("proceeds_forwarded", json!({"deal_id": deal_id, "recipient": deal.proceeds_recipient,
            "attempt_id": attempt_id, "success": success}));
    }

    pub fn get_deal(&self, deal_id: u64) -> Option<DealView> {
        self.deals.get(deal_id).map(Self::deal_view)
    }

    pub fn list_deals(&self, from_index: u32, limit: u32) -> Vec<DealView> {
        assert!(limit <= 50, "page limit exceeded");
        (from_index as u64..self.deals.len().min(from_index as u64 + limit as u64))
            .map(|id| Self::deal_view(self.deals.get(id).expect("missing deal")))
            .collect()
    }

    pub fn get_round(&self, round_id: String) -> Option<RoundView> {
        self.rounds.get(&round_id).map(Self::round_view)
    }

    pub fn list_rounds(&self) -> Vec<RoundView> {
        self.rounds.values().map(Self::round_view).collect()
    }
}

impl Company {
    fn refuse(deal_id: u64, reason: &str, amount: U128) -> U128 {
        env::log_str(&format!("deal {deal_id} payment refunded: {reason}"));
        amount
    }

    /// Called from `ft_on_transfer`. Every check happens before any state changes; a refused payment is
    /// returned unused, so the token refunds the payer.
    pub(crate) fn settle_deal_payment(&mut self, deal_id: u64, sender_id: AccountId, amount: U128) -> U128 {
        let Some(mut deal) = self.deals.get(deal_id) else {
            return Self::refuse(deal_id, "unknown deal", amount);
        };
        let payable = match deal.kind {
            DealKind::Issue => deal.status == DealStatus::Approved,
            _ => deal.status == DealStatus::Accepted,
        };
        if !payable {
            return Self::refuse(deal_id, "deal not payable", amount);
        }
        if Self::now() >= deal.expires_at {
            return Self::refuse(deal_id, "deal expired", amount);
        }
        if amount.0 != deal.price {
            return Self::refuse(deal_id, "amount differs from the deal price", amount);
        }
        let expected_payer = match deal.kind {
            DealKind::Buyback => self.dao_id.clone(),
            _ => deal.buyer.clone().expect("missing buyer"),
        };
        if sender_id != expected_payer {
            return Self::refuse(deal_id, "payer is not the deal's buyer", amount);
        }
        if let Some(buyer) = &deal.buyer {
            let seller_exits = deal.seller.as_ref().is_some_and(|seller| self.holding(seller).units == deal.units);
            if self.holders.get(buyer).is_none() && !seller_exits && self.holders.len() >= MAX_HOLDERS {
                return Self::refuse(deal_id, "holder limit reached", amount);
            }
        }

        match deal.kind {
            DealKind::Issue => {
                let buyer = deal.buyer.clone().expect("missing buyer");
                self.deal_reserved -= deal.units;
                self.issued_total = self.issued_total.checked_add(deal.units).expect("total overflow");
                self.credit(&buyer, deal.units);
                let round_id = deal.round_id.clone().expect("missing round");
                let mut round = self.rounds.get(&round_id).expect("round not found");
                round.units_issued += deal.units;
                round.amount_raised = round.amount_raised.checked_add(deal.price).expect("raised overflow");
                self.rounds.insert(&round_id, &round);
            }
            DealKind::Secondary => {
                let seller = deal.seller.clone().expect("missing seller");
                self.debit(&seller, deal.units, true);
                self.credit(&deal.buyer.clone().expect("missing buyer"), deal.units);
            }
            DealKind::Buyback => {
                let seller = deal.seller.clone().expect("missing seller");
                self.debit(&seller, deal.units, true);
                self.issued_total -= deal.units;
            }
        }
        deal.status = DealStatus::Settled;
        deal.settled_at = Some(Self::now());
        deal.proceeds_pending = deal.price;
        self.bump_revision();
        Self::emit("deal_settled", json!({"deal_id": deal_id, "kind": deal.kind, "seller": deal.seller, "buyer": deal.buyer,
            "units": U128(deal.units), "price": U128(deal.price), "revision": self.ledger_revision}));
        // Detached forward: the payment is already accepted. If the forward fails, the proceeds stay held
        // and `forward_proceeds` can retry; a lost callback leaves the forward locked for review.
        let _ = self.start_forward(&mut deal);
        self.deals.replace(deal_id, &deal);
        U128(0)
    }

    fn start_forward(&self, deal: &mut Deal) -> Promise {
        deal.forward_attempt = deal.forward_attempt.checked_add(1).expect("attempt overflow");
        deal.forward_in_flight = true;
        let args = json!({"receiver_id": deal.proceeds_recipient, "amount": U128(deal.proceeds_pending)}).to_string().into_bytes();
        let callback = json!({"deal_id": deal.id, "attempt_id": deal.forward_attempt}).to_string().into_bytes();
        Promise::new(self.settlement_token_id.clone())
            .function_call("ft_transfer".into(), args, NearToken::from_yoctonear(1), Gas::from_tgas(15))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_proceeds_forwarded".into(), callback, NearToken::from_yoctonear(0), Gas::from_tgas(15)))
    }

    fn deal_view(deal: Deal) -> DealView {
        DealView {
            id: deal.id,
            kind: deal.kind,
            seller: deal.seller,
            buyer: deal.buyer,
            units: U128(deal.units),
            price: U128(deal.price),
            expires_at: deal.expires_at,
            round_id: deal.round_id,
            doc_hash: deal.doc_hash,
            status: deal.status,
            settled_at: deal.settled_at,
            proceeds_recipient: deal.proceeds_recipient,
            proceeds_pending: U128(deal.proceeds_pending),
            forward_attempt: deal.forward_attempt,
            forward_in_flight: deal.forward_in_flight,
        }
    }

    fn round_view(round: Round) -> RoundView {
        RoundView {
            id: round.id,
            price_per_unit: U128(round.price_per_unit),
            doc_hash: round.doc_hash,
            opened_at: round.opened_at,
            closed_at: round.closed_at,
            units_issued: U128(round.units_issued),
            amount_raised: U128(round.amount_raised),
            deal_count: round.deal_count,
        }
    }
}
