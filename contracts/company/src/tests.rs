use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn aid(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn set_caller(name: &str) {
    let mut context = VMContextBuilder::new();
    context.predecessor_account_id(aid(name));
    testing_env!(context.build());
}

fn set_caller_at(name: &str, seconds: u64) {
    let mut context = VMContextBuilder::new();
    context.predecessor_account_id(aid(name));
    context.block_timestamp(seconds * 1_000_000_000);
    testing_env!(context.build());
}

fn boundaries() -> Vec<u64> {
    (0..=48).map(|m| 1_000 + m * 2_592_000).collect()
}

fn company() -> Company {
    set_caller("deployer.testnet");
    Company::new(
        aid("board.testnet"),
        aid("operator.testnet"),
        aid("testusd.testnet"),
        U128(10_000_000),
    )
}

#[test]
fn founder_issuance_pool_and_denominators() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(3_600_000));
    c.issue_founder_units("b".into(), 1, aid("bob.testnet"), U128(2_400_000));
    c.increase_pool("c".into(), 2, U128(2_000_000));
    let totals = c.get_totals();
    assert_eq!(totals.issued_total.0, 6_000_000);
    assert_eq!(totals.pool_available.0, 2_000_000);
    assert_eq!(totals.fully_diluted_total.0, 8_000_000);
    assert_eq!(totals.unallocated_units.0, 2_000_000);
    assert_eq!(totals.ledger_revision, 3);
    assert_eq!(c.list_holdings(0, 20).len(), 2);
}

#[test]
fn identical_replay_is_idempotent_even_after_revision_changes() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(100));
    c.increase_pool("b".into(), 1, U128(100));
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(100));
    assert_eq!(c.get_holding(aid("alice.testnet")).0, 100);
    assert_eq!(c.get_totals().ledger_revision, 2);
}

#[test]
#[should_panic(expected = "DAO only")]
fn non_dao_cannot_issue() {
    let mut c = company();
    set_caller("attacker.testnet");
    c.issue_founder_units("a".into(), 0, aid("attacker.testnet"), U128(100));
}

#[test]
#[should_panic(expected = "stale ledger revision")]
fn stale_revision_rejected() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("a".into(), 0, U128(100));
    c.increase_pool("b".into(), 0, U128(100));
}

#[test]
#[should_panic(expected = "action id reused with different arguments")]
fn action_id_cannot_be_repurposed() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("a".into(), 0, U128(100));
    c.increase_pool("a".into(), 0, U128(101));
}

#[test]
#[should_panic(expected = "insufficient unallocated units")]
fn cannot_exceed_authorized_supply() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("a".into(), 0, U128(9_000_000));
    c.issue_founder_units("b".into(), 1, aid("alice.testnet"), U128(1_000_001));
}

#[test]
#[should_panic(expected = "holder limit reached")]
fn holder_limit_is_enforced() {
    let mut c = company();
    set_caller("board.testnet");
    for i in 0..20 {
        c.issue_founder_units(
            format!("action-{i}"),
            i,
            aid(&format!("holder-{i}.testnet")),
            U128(1),
        );
    }
    c.issue_founder_units("overflow".into(), 20, aid("extra.testnet"), U128(1));
}

#[test]
fn pagination_and_repeat_issuance_do_not_duplicate_holders() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(10));
    c.issue_founder_units("b".into(), 1, aid("bob.testnet"), U128(20));
    c.issue_founder_units("c".into(), 2, aid("alice.testnet"), U128(30));
    assert_eq!(c.get_totals().holder_count, 2);
    let page = c.list_holdings(1, 1);
    assert_eq!(page[0].account_id, aid("bob.testnet"));
    assert_eq!(c.get_holding(aid("alice.testnet")).0, 40);
}

#[test]
fn grant_reservation_cliff_claim_and_full_vesting() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("pool".into(), 0, U128(2_000_000));
    let schedule = boundaries();
    let id = c.create_grant(
        "grant".into(),
        1,
        aid("employee.testnet"),
        U128(100_000),
        schedule.clone(),
    );
    assert_eq!(id, 0);
    assert_eq!(
        c.create_grant(
            "grant".into(),
            1,
            aid("employee.testnet"),
            U128(100_000),
            schedule.clone()
        ),
        id
    );
    assert_eq!(c.get_totals().pool_available.0, 1_900_000);
    assert_eq!(c.get_totals().grant_reserved.0, 100_000);

    set_caller_at("employee.testnet", schedule[12] - 1);
    assert_eq!(c.get_grant(id).unwrap().claimable_units.0, 0);
    set_caller_at("employee.testnet", schedule[12]);
    assert_eq!(c.get_grant(id).unwrap().claimable_units.0, 25_000);
    assert_eq!(c.claim_vested(id).0, 25_000);
    assert_eq!(c.get_holding(aid("employee.testnet")).0, 25_000);
    assert_eq!(c.get_totals().grant_reserved.0, 75_000);

    set_caller_at("employee.testnet", schedule[48]);
    assert_eq!(c.claim_vested(id).0, 75_000);
    assert_eq!(c.get_holding(aid("employee.testnet")).0, 100_000);
    assert_eq!(c.get_totals().grant_reserved.0, 0);
    assert_eq!(c.get_totals().fully_diluted_total.0, 2_000_000);
}

#[test]
fn cancellation_releases_only_unvested_units() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("pool".into(), 0, U128(100_000));
    let schedule = boundaries();
    let id = c.create_grant(
        "grant".into(),
        1,
        aid("employee.testnet"),
        U128(100_000),
        schedule.clone(),
    );
    set_caller_at("board.testnet", schedule[18]);
    c.cancel_unvested("cancel".into(), id);
    assert_eq!(c.get_totals().pool_available.0, 62_500);
    assert_eq!(c.get_totals().grant_reserved.0, 37_500);
    set_caller_at("employee.testnet", schedule[48]);
    assert_eq!(c.claim_vested(id).0, 37_500);
    assert_eq!(c.get_totals().grant_reserved.0, 0);
    assert_eq!(c.get_totals().fully_diluted_total.0, 100_000);
}

#[test]
#[should_panic(expected = "grant recipient only")]
fn another_account_cannot_claim() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("pool".into(), 0, U128(100_000));
    let schedule = boundaries();
    let id = c.create_grant(
        "grant".into(),
        1,
        aid("employee.testnet"),
        U128(100_000),
        schedule.clone(),
    );
    set_caller_at("attacker.testnet", schedule[12]);
    c.claim_vested(id);
}

#[test]
#[should_panic(expected = "boundaries must increase")]
fn schedule_must_be_monotonic() {
    let mut c = company();
    set_caller("board.testnet");
    c.increase_pool("pool".into(), 0, U128(100_000));
    let mut schedule = boundaries();
    schedule[12] = schedule[11];
    c.create_grant(
        "grant".into(),
        1,
        aid("employee.testnet"),
        U128(100_000),
        schedule,
    );
}

#[test]
fn snapshot_rounds_exactly_and_survives_later_issuance() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(3_600_000));
    c.issue_founder_units("b".into(), 1, aid("bob.testnet"), U128(2_400_000));
    c.increase_pool("pool".into(), 2, U128(2_000_000));
    let schedule = boundaries();
    let grant_id = c.create_grant(
        "grant".into(),
        3,
        aid("employee.testnet"),
        U128(100_000),
        schedule.clone(),
    );
    set_caller_at("employee.testnet", schedule[12]);
    c.claim_vested(grant_id);
    set_caller_at("operator.testnet", schedule[12]);
    let id = c.prepare_distribution(5, U128(10_000_000_000), schedule[48]);
    let before = c.get_distribution(id).unwrap();
    assert_eq!(
        before.entitlements.iter().map(|e| e.amount.0).sum::<u128>(),
        10_000_000_000
    );
    assert_eq!(
        before
            .entitlements
            .iter()
            .find(|e| e.account_id == aid("alice.testnet"))
            .unwrap()
            .amount
            .0,
        5_975_103_734
    );
    assert_eq!(
        before
            .entitlements
            .iter()
            .find(|e| e.account_id == aid("bob.testnet"))
            .unwrap()
            .amount
            .0,
        3_983_402_490
    );
    assert_eq!(
        before
            .entitlements
            .iter()
            .find(|e| e.account_id == aid("employee.testnet"))
            .unwrap()
            .amount
            .0,
        41_493_776
    );
    set_caller_at("board.testnet", schedule[12]);
    c.issue_founder_units("late".into(), 5, aid("late.testnet"), U128(100));
    c.approve_distribution("approve".into(), id, before.schedule_hash.clone());
    let after = c.get_distribution(id).unwrap();
    assert!(after.approved);
    assert_eq!(after.entitlements.len(), 3);
    assert_eq!(after.schedule_hash, before.schedule_hash);
}

#[test]
#[should_panic(expected = "schedule hash mismatch")]
fn approval_rejects_modified_hash() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(100));
    set_caller("operator.testnet");
    let id = c.prepare_distribution(1, U128(100), 1000);
    set_caller("board.testnet");
    c.approve_distribution("approve".into(), id, vec![0; 32]);
}

#[test]
#[should_panic(expected = "snapshot operator only")]
fn non_operator_cannot_prepare_snapshot() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(100));
    set_caller("attacker.testnet");
    c.prepare_distribution(1, U128(100), 1000);
}
