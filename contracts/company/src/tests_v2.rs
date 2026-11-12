//! Schema v2: Phase B ledger extensions and Phase C rounds, deals, and explicit payouts.
use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const DOC: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_DOC: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MONTH: u64 = 2_592_000;
const START: u64 = 1_000;

fn aid(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn at(caller: &str, seconds: u64) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(aid("company.testnet"));
    context.predecessor_account_id(aid(caller));
    context.block_timestamp(seconds * 1_000_000_000);
    testing_env!(context.build());
}

fn by(caller: &str) {
    at(caller, START);
}

fn callback(result: PromiseResult) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(aid("company.testnet"));
    context.predecessor_account_id(aid("company.testnet"));
    context.block_timestamp(START * 1_000_000_000);
    testing_env!(context.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn doc() -> Option<String> {
    Some(DOC.to_string())
}

fn months(count: u64) -> Vec<u64> {
    (0..=count).map(|m| START + m * MONTH).collect()
}

/// Founders A (600) and B (400), pool 1,000, authorized 10,000, revision 3.
fn company() -> Company {
    by("deployer.testnet");
    let mut c = Company::new(aid("board.testnet"), aid("operator.testnet"), aid("testusd.testnet"), U128(10_000));
    by("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("founder-a.testnet"), U128(600), doc());
    c.issue_founder_units("b".into(), 1, aid("founder-b.testnet"), U128(400), None);
    c.increase_pool("p".into(), 2, U128(1_000), None);
    c
}

fn rev(c: &Company) -> u64 {
    c.get_totals().ledger_revision
}

fn assert_ledger(c: &Company) {
    let totals = c.get_totals();
    let holdings = c.list_holdings(0, MAX_HOLDERS as u32);
    let mut grants = Vec::new();
    let mut offset = 0;
    loop {
        let page = c.list_grants(offset, 20);
        if page.is_empty() {
            break;
        }
        offset += page.len() as u32;
        grants.extend(page);
    }
    let issued: u128 = holdings.iter().map(|h| h.issued_units.0).sum();
    let reserved: u128 = grants.iter().map(|g| g.entitlement_cap.0 - g.issued_units.0).sum();
    let open_issue: u128 = c.list_deals(0, 50).iter()
        .filter(|d| d.kind == DealKind::Issue && d.status == DealStatus::Approved)
        .map(|d| d.units.0).sum();
    assert_eq!(holdings.len() as u32, totals.holder_count);
    assert_eq!(issued, totals.issued_total.0);
    assert_eq!(reserved, totals.grant_reserved.0);
    assert_eq!(open_issue, totals.deal_reserved.0);
    assert_eq!(issued + totals.pool_available.0 + reserved, totals.fully_diluted_total.0);
    assert_eq!(totals.authorized_units.0 - totals.fully_diluted_total.0 - totals.deal_reserved.0, totals.unallocated_units.0);
    for holding in holdings {
        assert!(holding.locked_units.0 <= holding.issued_units.0);
    }
}

fn logged(event: &str) -> bool {
    get_logs().iter().any(|line| line.contains(&format!("\"event\":\"{event}\"")))
}

// ---------- Phase B: ledger ----------

#[test]
fn doc_hashes_are_validated_recorded_and_bound_to_the_action() {
    let mut c = company();
    let r = rev(&c);
    c.issue_founder_units("doc-issue".into(), r, aid("founder-c.testnet"), U128(5), doc());
    assert!(get_logs().iter().any(|line| line.contains("\"event\":\"founder_issued\"") && line.contains(DOC)));
    c.issue_founder_units("doc-issue".into(), r, aid("founder-c.testnet"), U128(5), doc());
    assert_eq!(c.get_holding(aid("founder-c.testnet")).0, 5, "an identical replay changes nothing");
}

#[test]
#[should_panic(expected = "action id reused with different arguments")]
fn the_same_action_with_a_different_document_is_rejected() {
    let mut c = company();
    c.issue_founder_units("x".into(), 3, aid("c.testnet"), U128(5), doc());
    c.issue_founder_units("x".into(), 3, aid("c.testnet"), U128(5), Some(OTHER_DOC.into()));
}

#[test]
#[should_panic(expected = "doc_hash must be 64 lowercase hex characters")]
fn malformed_doc_hash_is_rejected() {
    let mut c = company();
    c.increase_pool("bad".into(), 3, U128(1), Some("ABC".into()));
}

#[test]
fn authorized_capacity_can_rise() {
    let mut c = company();
    assert_eq!(c.get_totals().unallocated_units.0, 8_000);
    c.increase_authorized("amend".into(), 3, U128(20_000), doc());
    assert_eq!(c.get_totals().unallocated_units.0, 18_000);
    assert!(logged("authorized_increased"));
    c.issue_founder_units("big".into(), 4, aid("founder-a.testnet"), U128(15_000), None);
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "authorized units can only increase")]
fn authorized_capacity_never_falls() {
    let mut c = company();
    c.increase_authorized("down".into(), 3, U128(9_000), None);
}

#[test]
fn decrease_pool_returns_units_to_unallocated() {
    let mut c = company();
    c.decrease_pool("shrink".into(), 3, U128(400), None);
    let totals = c.get_totals();
    assert_eq!(totals.pool_available.0, 600);
    assert_eq!(totals.unallocated_units.0, 8_400);
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "insufficient pool units")]
fn decrease_pool_cannot_exceed_the_pool() {
    let mut c = company();
    c.decrease_pool("too-much".into(), 3, U128(1_001), None);
}

#[test]
fn governance_actions_are_not_capped_and_resume_always_works() {
    let mut c = company();
    for i in 0..250 {
        by("board.testnet");
        c.set_paused(format!("toggle-{i}"), i % 2 == 0);
    }
    assert!(!c.is_paused(), "the 250th action resumed the company");
    assert_eq!(c.get_config().limits.max_actions, None);
}

#[test]
fn custom_schedule_and_cliff_vest_on_their_own_months() {
    let mut c = company();
    let schedule = months(24);
    let id = c.create_grant("g".into(), 3, aid("emp.testnet"), U128(240), schedule.clone(), doc(),
        Some(GrantTerms { cliff_index: Some(6), source: None }));
    at("emp.testnet", schedule[5]);
    assert_eq!(c.get_grant(id).unwrap().vested_units.0, 0);
    at("emp.testnet", schedule[6]);
    assert_eq!(c.get_grant(id).unwrap().vested_units.0, 60);
    at("emp.testnet", schedule[24]);
    assert_eq!(c.claim_vested(id).0, 240);
    at("board.testnet", schedule[24]);
    let later: Vec<u64> = (0..=12).map(|m| schedule[24] + m * MONTH).collect();
    let no_cliff = c.create_grant("g2".into(), rev(&c), aid("adv.testnet"), U128(120), later.clone(), None,
        Some(GrantTerms { cliff_index: Some(0), source: None }));
    at("adv.testnet", later[1]);
    assert_eq!(c.get_grant(no_cliff).unwrap().vested_units.0, 10);
    assert_eq!(c.get_grant(no_cliff).unwrap().cliff_index, 0);
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "cliff must fall within the schedule")]
fn cliff_beyond_the_schedule_is_rejected() {
    let mut c = company();
    c.create_grant("g".into(), 3, aid("emp.testnet"), U128(10), months(6), None, Some(GrantTerms { cliff_index: Some(7), source: None }));
}

#[test]
fn founder_vesting_draws_from_unallocated_and_returns_there_on_cancel() {
    let mut c = company();
    let schedule = months(48);
    let id = c.create_grant("founder-grant".into(), 3, aid("founder-c.testnet"), U128(4_800), schedule.clone(), doc(),
        Some(GrantTerms { cliff_index: Some(12), source: Some(GrantSource::Unallocated) }));
    let totals = c.get_totals();
    assert_eq!(totals.pool_available.0, 1_000, "the contributor pool is untouched");
    assert_eq!(totals.unallocated_units.0, 3_200);
    assert_eq!(c.get_grant(id).unwrap().source, GrantSource::Unallocated);
    at("board.testnet", schedule[24]);
    c.cancel_unvested("leave".into(), id, doc());
    let totals = c.get_totals();
    assert_eq!(totals.grant_reserved.0, 2_400, "half vested stays claimable");
    assert_eq!(totals.pool_available.0, 1_000);
    assert_eq!(totals.unallocated_units.0, 5_600, "unvested half returns to unallocated");
    assert_ledger(&c);
}

#[test]
fn acceleration_counts_extra_months_and_crosses_the_cliff() {
    let mut c = company();
    let schedule = months(48);
    let id = c.create_grant("g".into(), 3, aid("emp.testnet"), U128(480), schedule.clone(), None, None);
    at("board.testnet", schedule[6]);
    c.accelerate_grant("acq".into(), id, 6, doc());
    assert_eq!(c.get_grant(id).unwrap().vested_units.0, 120, "6 + 6 months reaches the 12-month cliff");
    c.accelerate_grant("full".into(), id, 100, None);
    assert_eq!(c.get_grant(id).unwrap().accelerated_months, 48);
    assert_eq!(c.get_grant(id).unwrap().vested_units.0, 480);
    assert!(logged("grant_accelerated"));
}

#[test]
fn recipient_accepts_grant_terms_matching_the_board_document() {
    let mut c = company();
    let id = c.create_grant("g".into(), 3, aid("emp.testnet"), U128(10), months(48), doc(), None);
    by("emp.testnet");
    c.accept_grant(id, DOC.into());
    assert!(logged("grant_accepted"));
    c.accept_grant(id, DOC.into());
    assert_eq!(c.get_grant(id).unwrap().accepted_terms_hash.as_deref(), Some(DOC));
}

#[test]
#[should_panic(expected = "terms hash differs from the approved grant document")]
fn accepting_different_terms_is_rejected() {
    let mut c = company();
    let id = c.create_grant("g".into(), 3, aid("emp.testnet"), U128(10), months(48), doc(), None);
    by("emp.testnet");
    c.accept_grant(id, OTHER_DOC.into());
}

#[test]
#[should_panic(expected = "grant recipient only")]
fn only_the_recipient_can_accept_a_grant() {
    let mut c = company();
    let id = c.create_grant("g".into(), 3, aid("emp.testnet"), U128(10), months(48), None, None);
    by("mallory.testnet");
    c.accept_grant(id, DOC.into());
}

#[test]
fn retire_units_reduces_issued_and_drops_an_emptied_holder() {
    let mut c = company();
    c.retire_units("repurchase".into(), 3, aid("founder-b.testnet"), U128(400), doc());
    let totals = c.get_totals();
    assert_eq!(totals.issued_total.0, 600);
    assert_eq!(totals.holder_count, 1);
    assert_eq!(totals.unallocated_units.0, 8_400);
    assert_eq!(c.get_holding(aid("founder-b.testnet")).0, 0);
    assert_ledger(&c);
}

#[test]
fn reassign_moves_units_and_open_grants_but_not_finished_ones() {
    let mut c = company();
    let schedule = months(48);
    let open = c.create_grant("g1".into(), 3, aid("founder-b.testnet"), U128(480), schedule.clone(), None, None);
    let done = c.create_grant("g2".into(), 4, aid("founder-b.testnet"), U128(48), months(1),
        None, Some(GrantTerms { cliff_index: Some(0), source: None }));
    at("founder-b.testnet", schedule[1]);
    c.claim_vested(done);
    at("board.testnet", schedule[1]);
    c.reassign_holding("lost-wallet".into(), rev(&c), aid("founder-b.testnet"), aid("founder-b2.testnet"), doc());
    assert_eq!(c.get_holding(aid("founder-b.testnet")).0, 0);
    assert_eq!(c.get_holding(aid("founder-b2.testnet")).0, 448);
    assert_eq!(c.get_grant(open).unwrap().recipient, aid("founder-b2.testnet"));
    assert_eq!(c.get_grant(done).unwrap().recipient, aid("founder-b.testnet"), "fully issued grant stays as history");
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "account has an unpaid distribution entitlement")]
fn reassign_is_blocked_by_an_unpaid_entitlement() {
    let mut c = company();
    by("operator.testnet");
    c.prepare_distribution(3, U128(100), START + MONTH);
    by("board.testnet");
    c.reassign_holding("move".into(), 3, aid("founder-b.testnet"), aid("new.testnet"), None);
}

#[test]
fn reassign_after_the_distribution_is_cancelled() {
    let mut c = company();
    by("operator.testnet");
    let id = c.prepare_distribution(3, U128(100), START + MONTH);
    by("board.testnet");
    c.cancel_unfunded_distribution("cancel".into(), id);
    c.reassign_holding("move".into(), 3, aid("founder-b.testnet"), aid("new.testnet"), None);
    assert_eq!(c.get_holding(aid("new.testnet")).0, 400);
}

#[test]
fn close_after_settling_obligations() {
    let mut c = company();
    by("operator.testnet");
    let id = c.prepare_distribution(3, U128(100), START + MONTH);
    by("board.testnet");
    c.cancel_unfunded_distribution("cancel".into(), id);
    c.close_company("close".into(), doc());
    assert!(c.get_config().closed);
    assert!(logged("company_closed"));
    by("testusd.testnet");
    assert_eq!(c.ft_on_transfer(aid("board.testnet"), U128(5), "{}".into()).0, 5, "a closed company refunds every payment");
}

#[test]
#[should_panic(expected = "every distribution must be paid in full or cancelled")]
fn an_unfunded_distribution_blocks_close() {
    let mut c = company();
    by("operator.testnet");
    c.prepare_distribution(3, U128(100), START + MONTH);
    by("board.testnet");
    c.close_company("close".into(), None);
}

#[test]
#[should_panic(expected = "company closed")]
fn a_closed_company_cannot_resume() {
    let mut c = company();
    c.close_company("close".into(), None);
    c.set_paused("resume".into(), false);
}

#[test]
#[should_panic(expected = "company closed")]
fn a_closed_company_cannot_issue() {
    let mut c = company();
    c.close_company("close".into(), None);
    c.issue_founder_units("i".into(), 4, aid("x.testnet"), U128(1), None);
}

// ---------- Phase C: explicit distributions ----------

#[test]
fn explicit_distribution_pays_board_set_amounts_to_stakeholders() {
    let mut c = company();
    c.create_grant("g".into(), 3, aid("emp.testnet"), U128(100), months(48), None, None);
    let payouts = vec![
        PayoutRow { account_id: aid("founder-a.testnet"), amount: U128(300) },
        PayoutRow { account_id: aid("founder-b.testnet"), amount: U128(650) },
        PayoutRow { account_id: aid("emp.testnet"), amount: U128(50) },
    ];
    let id = c.prepare_explicit_distribution("exit".into(), 4, U128(1_000), START + MONTH, payouts.clone(), Some("exit".into()), doc());
    assert_eq!(c.prepare_explicit_distribution("exit".into(), 4, U128(1_000), START + MONTH, payouts, Some("exit".into()), doc()), id);
    let d = c.get_distribution(id).unwrap();
    assert_eq!(d.kind, DistributionKind::Explicit);
    assert!(d.approved, "preparing it is the board's approval");
    assert_eq!(d.entitlements.iter().map(|e| e.account_id.to_string()).collect::<Vec<_>>(),
        vec!["emp.testnet", "founder-a.testnet", "founder-b.testnet"]);
    assert_eq!(d.entitlements[0].units.0, 0, "a grant recipient without issued units can be paid");

    by("testusd.testnet");
    let msg = json!({"distribution_id": id, "schedule_hash": d.schedule_hash}).to_string();
    assert_eq!(c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg).0, 0);
    by("executor.testnet");
    c.pay_recipient(id, aid("founder-b.testnet"));
    callback(PromiseResult::Successful(vec![]));
    c.on_payment_result(id, aid("founder-b.testnet"), 1);
    let paid = c.get_distribution(id).unwrap();
    assert_eq!(paid.paid_total.0, 650);
    assert_eq!(paid.available_escrow.0, 350);
    assert_eq!(c.list_entitlements(id, 2, 1)[0].payment_status, PaymentStatus::Paid);
}

#[test]
fn explicit_and_pro_rata_schedules_hash_under_different_domains() {
    let mut c = company();
    by("operator.testnet");
    let pro_rata = c.prepare_distribution(3, U128(1_000), START + MONTH);
    by("board.testnet");
    let explicit = c.prepare_explicit_distribution("e".into(), 3, U128(1_000), START + MONTH, vec![
        PayoutRow { account_id: aid("founder-a.testnet"), amount: U128(600) },
        PayoutRow { account_id: aid("founder-b.testnet"), amount: U128(400) },
    ], None, None);
    let a = c.get_distribution(pro_rata).unwrap();
    let b = c.get_distribution(explicit).unwrap();
    assert_eq!(a.entitlements.iter().map(|e| e.amount.0).collect::<Vec<_>>(), vec![600, 400]);
    assert_eq!(b.entitlements.iter().map(|e| e.amount.0).collect::<Vec<_>>(), vec![600, 400]);
    assert_ne!(a.schedule_hash, b.schedule_hash);
}

#[test]
#[should_panic(expected = "payouts must add up to the budget")]
fn explicit_payouts_must_sum_to_the_budget() {
    let mut c = company();
    c.prepare_explicit_distribution("e".into(), 3, U128(1_000), START + MONTH,
        vec![PayoutRow { account_id: aid("founder-a.testnet"), amount: U128(999) }], None, None);
}

#[test]
#[should_panic(expected = "payout recipient is not a stakeholder")]
fn explicit_payouts_only_reach_stakeholders() {
    let mut c = company();
    c.prepare_explicit_distribution("e".into(), 3, U128(10), START + MONTH,
        vec![PayoutRow { account_id: aid("mallory.testnet"), amount: U128(10) }], None, None);
}

#[test]
#[should_panic(expected = "DAO only")]
fn only_the_board_prepares_explicit_payouts() {
    let mut c = company();
    by("operator.testnet");
    c.prepare_explicit_distribution("e".into(), 3, U128(10), START + MONTH,
        vec![PayoutRow { account_id: aid("founder-a.testnet"), amount: U128(10) }], None, None);
}

// ---------- Phase C: rounds and deals ----------

fn seed_round(c: &mut Company) {
    by("board.testnet");
    c.create_round("round".into(), "seed".into(), U128(2_000_000), doc());
}

fn issue_terms(units: u128, price: u128) -> DealTerms {
    DealTerms { kind: DealKind::Issue, seller: None, buyer: Some(aid("investor.testnet")), units: U128(units), price: U128(price),
        expires_at: START + MONTH, round_id: Some("seed".into()), doc_hash: doc() }
}

fn pay(c: &mut Company, payer: &str, amount: u128, deal_id: u64) -> u128 {
    by("testusd.testnet");
    c.ft_on_transfer(aid(payer), U128(amount), json!({"deal_id": deal_id}).to_string()).0
}

#[test]
fn investor_issuance_reserves_capacity_settles_on_payment_and_forwards_to_the_dao() {
    let mut c = company();
    seed_round(&mut c);
    let id = c.approve_deal("deal".into(), issue_terms(500, 1_000_000_000));
    assert_eq!(c.approve_deal("deal".into(), issue_terms(500, 1_000_000_000)), id, "replay returns the same deal");
    assert_eq!(c.get_totals().deal_reserved.0, 500);
    assert_eq!(c.get_totals().unallocated_units.0, 7_500);
    assert_ledger(&c);

    assert_eq!(pay(&mut c, "investor.testnet", 999_999_999, id), 999_999_999, "wrong amount is refunded");
    assert_eq!(pay(&mut c, "mallory.testnet", 1_000_000_000, id), 1_000_000_000, "wrong payer is refunded");
    assert_eq!(c.get_deal(id).unwrap().status, DealStatus::Approved);

    assert_eq!(pay(&mut c, "investor.testnet", 1_000_000_000, id), 0);
    let deal = c.get_deal(id).unwrap();
    assert_eq!(deal.status, DealStatus::Settled);
    assert_eq!(deal.proceeds_recipient, aid("board.testnet"));
    assert_eq!(deal.proceeds_pending.0, 1_000_000_000);
    assert!(deal.forward_in_flight);
    assert_eq!(c.get_holding(aid("investor.testnet")).0, 500);
    let totals = c.get_totals();
    assert_eq!(totals.issued_total.0, 1_500);
    assert_eq!(totals.deal_reserved.0, 0);
    let round = c.get_round("seed".into()).unwrap();
    assert_eq!((round.units_issued.0, round.amount_raised.0, round.deal_count), (500, 1_000_000_000, 1));
    assert_eq!(pay(&mut c, "investor.testnet", 1_000_000_000, id), 1_000_000_000, "a settled deal cannot be paid twice");

    callback(PromiseResult::Successful(vec![]));
    c.on_proceeds_forwarded(id, 1);
    assert_eq!(c.get_deal(id).unwrap().proceeds_pending.0, 0);
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "price must equal units times the round price")]
fn issuance_price_must_match_the_round() {
    let mut c = company();
    seed_round(&mut c);
    c.approve_deal("deal".into(), issue_terms(500, 999_999_999));
}

#[test]
#[should_panic(expected = "insufficient unallocated units")]
fn issuance_cannot_exceed_unallocated_capacity() {
    let mut c = company();
    seed_round(&mut c);
    c.approve_deal("deal".into(), issue_terms(8_001, 8_001 * 2_000_000));
}

#[test]
fn round_closes_after_its_deals_are_cancelled() {
    let mut c = company();
    seed_round(&mut c);
    let id = c.approve_deal("deal".into(), issue_terms(10, 20_000_000));
    c.cancel_deal(id);
    assert_eq!(c.get_totals().deal_reserved.0, 0);
    c.close_round("close".into(), "seed".into());
    assert!(c.get_round("seed".into()).unwrap().closed_at.is_some());
}

#[test]
#[should_panic(expected = "round has open deals")]
fn a_round_with_open_deals_cannot_close() {
    let mut c = company();
    seed_round(&mut c);
    c.approve_deal("deal".into(), issue_terms(10, 20_000_000));
    c.close_round("close".into(), "seed".into());
}

fn secondary(c: &mut Company) -> u64 {
    by("board.testnet");
    c.approve_deal("sale".into(), DealTerms { kind: DealKind::Secondary, seller: Some(aid("founder-b.testnet")),
        buyer: Some(aid("angel.testnet")), units: U128(100), price: U128(50_000_000), expires_at: START + MONTH, round_id: None, doc_hash: doc() })
}

#[test]
fn secondary_sale_needs_the_sellers_signature_then_moves_units_and_pays_the_seller() {
    let mut c = company();
    let id = secondary(&mut c);
    assert_eq!(pay(&mut c, "angel.testnet", 50_000_000, id), 50_000_000, "unpayable before the seller accepts");
    by("founder-b.testnet");
    c.accept_deal(id);
    assert_eq!(c.list_holdings(0, 10).iter().find(|h| h.account_id == aid("founder-b.testnet")).unwrap().locked_units.0, 100);

    assert_eq!(pay(&mut c, "angel.testnet", 50_000_000, id), 0);
    assert_eq!(c.get_holding(aid("founder-b.testnet")).0, 300);
    assert_eq!(c.get_holding(aid("angel.testnet")).0, 100);
    assert_eq!(c.get_totals().issued_total.0, 1_000, "a secondary sale does not change supply");
    assert_eq!(c.get_deal(id).unwrap().proceeds_recipient, aid("founder-b.testnet"));

    callback(PromiseResult::Failed);
    c.on_proceeds_forwarded(id, 1);
    let failed = c.get_deal(id).unwrap();
    assert_eq!(failed.proceeds_pending.0, 50_000_000, "proceeds stay held after a failed forward");
    assert!(!failed.forward_in_flight);
    by("anyone.testnet");
    c.forward_proceeds(id);
    callback(PromiseResult::Successful(vec![]));
    c.on_proceeds_forwarded(id, 2);
    assert_eq!(c.get_deal(id).unwrap().proceeds_pending.0, 0);
    assert_ledger(&c);
}

#[test]
#[should_panic(expected = "insufficient unlocked units")]
fn locked_units_cannot_be_retired() {
    let mut c = company();
    let deal = secondary(&mut c);
    by("founder-b.testnet");
    c.accept_deal(deal);
    by("board.testnet");
    c.retire_units("r".into(), 3, aid("founder-b.testnet"), U128(301), None);
}

#[test]
#[should_panic(expected = "stale forward attempt")]
fn stale_forward_callback_cannot_settle_a_newer_attempt() {
    let mut c = company();
    let id = secondary(&mut c);
    by("founder-b.testnet");
    c.accept_deal(id);
    pay(&mut c, "angel.testnet", 50_000_000, id);
    callback(PromiseResult::Failed);
    c.on_proceeds_forwarded(id, 1);
    by("anyone.testnet");
    c.forward_proceeds(id);
    callback(PromiseResult::Successful(vec![]));
    c.on_proceeds_forwarded(id, 1);
}

#[test]
fn buyback_is_paid_by_the_dao_and_retires_units() {
    let mut c = company();
    let id = c.approve_deal("buyback".into(), DealTerms { kind: DealKind::Buyback, seller: Some(aid("founder-a.testnet")),
        buyer: None, units: U128(600), price: U128(300_000_000), expires_at: START + MONTH, round_id: None, doc_hash: doc() });
    by("founder-a.testnet");
    c.accept_deal(id);
    assert_eq!(pay(&mut c, "founder-a.testnet", 300_000_000, id), 300_000_000, "only the DAO pays for a buyback");
    assert_eq!(pay(&mut c, "board.testnet", 300_000_000, id), 0);
    let totals = c.get_totals();
    assert_eq!(totals.issued_total.0, 400);
    assert_eq!(totals.holder_count, 1);
    assert_eq!(totals.unallocated_units.0, 8_600);
    assert_eq!(c.get_deal(id).unwrap().proceeds_recipient, aid("founder-a.testnet"));
    assert_ledger(&c);
}

#[test]
fn seller_withdraws_or_anyone_cleans_up_after_expiry() {
    let mut c = company();
    let id = secondary(&mut c);
    by("founder-b.testnet");
    c.accept_deal(id);
    c.cancel_deal(id);
    assert_eq!(c.list_holdings(0, 10).iter().find(|h| h.account_id == aid("founder-b.testnet")).unwrap().locked_units.0, 0);
    assert_eq!(c.get_deal(id).unwrap().status, DealStatus::Cancelled);

    by("board.testnet");
    let second = c.approve_deal("sale-2".into(), short_sale());
    assert_eq!(pay_at(&mut c, START + 10, second), 1, "an expired deal is refunded");
    at("stranger.testnet", START + 10);
    c.cancel_deal(second);
    assert_eq!(c.get_deal(second).unwrap().status, DealStatus::Cancelled);
}

fn short_sale() -> DealTerms {
    DealTerms { kind: DealKind::Secondary, seller: Some(aid("founder-b.testnet")), buyer: Some(aid("angel.testnet")),
        units: U128(10), price: U128(1), expires_at: START + 10, round_id: None, doc_hash: None }
}

#[test]
#[should_panic(expected = "only the DAO or the seller can cancel before expiry")]
fn a_stranger_cannot_cancel_before_expiry() {
    let mut c = company();
    let deal = c.approve_deal("s".into(), short_sale());
    by("stranger.testnet");
    c.cancel_deal(deal);
}

fn pay_at(c: &mut Company, seconds: u64, deal_id: u64) -> u128 {
    at("testusd.testnet", seconds);
    c.ft_on_transfer(aid("angel.testnet"), U128(1), json!({"deal_id": deal_id}).to_string()).0
}

#[test]
#[should_panic(expected = "insufficient unlocked units")]
fn a_seller_cannot_commit_the_same_units_twice() {
    let mut c = company();
    let first = secondary(&mut c);
    let second = c.approve_deal("sale-2".into(), DealTerms { kind: DealKind::Secondary, seller: Some(aid("founder-b.testnet")),
        buyer: Some(aid("other.testnet")), units: U128(301), price: U128(1), expires_at: START + MONTH, round_id: None, doc_hash: None });
    by("founder-b.testnet");
    c.accept_deal(first);
    c.accept_deal(second);
}

#[test]
fn deal_payment_is_refunded_when_the_holder_limit_is_full() {
    let mut c = company();
    for i in 0..(MAX_HOLDERS - 2) {
        by("board.testnet");
        c.issue_founder_units(format!("h-{i}"), rev(&c), aid(&format!("holder-{i}.testnet")), U128(1), None);
    }
    assert_eq!(c.get_totals().holder_count as u64, MAX_HOLDERS);
    seed_round(&mut c);
    let id = c.approve_deal("deal".into(), issue_terms(1, 2_000_000));
    assert_eq!(pay(&mut c, "investor.testnet", 2_000_000, id), 2_000_000);
    assert_eq!(c.get_deal(id).unwrap().status, DealStatus::Approved);
}

#[test]
fn close_waits_for_delivered_proceeds() {
    let mut c = company();
    let id = secondary(&mut c);
    by("founder-b.testnet");
    c.accept_deal(id);
    pay(&mut c, "angel.testnet", 50_000_000, id);
    callback(PromiseResult::Successful(vec![]));
    c.on_proceeds_forwarded(id, 1);
    by("board.testnet");
    c.close_company("close".into(), None);
    assert!(c.get_config().closed);
}

#[test]
#[should_panic(expected = "every deal must be settled with proceeds delivered, or cancelled")]
fn undelivered_proceeds_block_close() {
    let mut c = company();
    let deal = secondary(&mut c);
    by("founder-b.testnet");
    c.accept_deal(deal);
    pay(&mut c, "angel.testnet", 50_000_000, deal);
    by("board.testnet");
    c.close_company("close".into(), None);
}

#[test]
#[should_panic(expected = "account has an open deal")]
fn an_open_deal_blocks_reassignment() {
    let mut c = company();
    secondary(&mut c);
    c.reassign_holding("m".into(), 3, aid("founder-b.testnet"), aid("new.testnet"), None);
}

#[test]
fn deal_and_explicit_events_are_emitted() {
    let mut c = company();
    seed_round(&mut c);
    assert!(logged("round_created"));
    let id = c.approve_deal("deal".into(), issue_terms(5, 10_000_000));
    assert!(logged("deal_approved"));
    pay(&mut c, "investor.testnet", 10_000_000, id);
    assert!(get_logs().iter().any(|line| line.contains("\"event\":\"deal_settled\"") && line.contains("\"version\":\"2.0.0\"")));
}

#[test]
fn explicit_distribution_hash_matches_the_typescript_vector() {
    by("deployer.testnet");
    let mut c = Company::new(aid("board.testnet"), aid("operator.testnet"), aid("testusd.testnet"), U128(10_000_000));
    by("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("founder-a.testnet"), U128(3_600_000), None);
    c.issue_founder_units("b".into(), 1, aid("founder-b.testnet"), U128(2_400_000), None);
    c.issue_founder_units("c".into(), 2, aid("contributor.testnet"), U128(25_000), None);
    c.increase_pool("p".into(), 3, U128(1), None);
    // Distribution 0 is a placeholder so the explicit list gets ID 1, matching the TypeScript fixture.
    by("operator.testnet");
    c.prepare_distribution(4, U128(1), 1_900_000_000);
    let mut context = VMContextBuilder::new();
    context.current_account_id(aid("company.testnet"));
    context.predecessor_account_id(aid("board.testnet"));
    context.block_timestamp(1_790_000_001_000_000_000);
    context.block_height(124);
    testing_env!(context.build());
    let id = c.prepare_explicit_distribution("x".into(), 4, U128(100), 1_900_000_000, vec![
        PayoutRow { account_id: aid("founder-a.testnet"), amount: U128(60) },
        PayoutRow { account_id: aid("founder-b.testnet"), amount: U128(40) },
        PayoutRow { account_id: aid("contributor.testnet"), amount: U128(0) },
    ], None, None);
    assert_eq!(id, 1);
    let hash = c.get_distribution(id).unwrap().schedule_hash;
    let hex = hash.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    assert_eq!(hex, "51cc8f9ff6691a66047262d2e38515567f978524cb951f9032a9b7a0254715a4");
    assert_eq!(c.get_distribution(id).unwrap().entitlements[0].payment_status, PaymentStatus::Zero);
}
