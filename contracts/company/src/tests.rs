use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
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

#[test]
fn distribution_hash_matches_typescript_vector() {
    set_caller("operator.testnet");
    let rows = [
        (aid("contributor.testnet"), 25_000u128, 0u128),
        (aid("founder-a.testnet"), 3_600_000u128, 60u128),
        (aid("founder-b.testnet"), 2_400_000u128, 40u128),
    ];
    let immutable_rows: Vec<_> = rows.iter().map(|(account, units, amount)| (account, *units, *amount)).collect();
    let payload = (
        "near:testnet/captable.distribution.v1",
        aid("company.testnet"),
        1u64,
        4u64,
        1_790_000_001u64,
        124u64,
        aid("testusd.testnet"),
        100u128,
        1_900_000_000u64,
        &immutable_rows,
    );
    let digest = env::sha256(&near_sdk::borsh::to_vec(&payload).unwrap());
    let hex = digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    assert_eq!(hex, "ecd5b5989bcf9bf50485085e99f4425d7e973842edcaaecf5cc000bd1fce22eb");

    let mut company = company();
    set_caller("board.testnet");
    company.issue_founder_units("a".into(), 0, aid("founder-a.testnet"), U128(3_600_000));
    company.issue_founder_units("b".into(), 1, aid("founder-b.testnet"), U128(2_400_000));
    company.issue_founder_units("c".into(), 2, aid("contributor.testnet"), U128(25_000));
    company.increase_pool("p".into(), 3, U128(1_000_000));
    let mut context = VMContextBuilder::new();
    context.current_account_id(aid("company.testnet"));
    context.predecessor_account_id(aid("operator.testnet"));
    context.block_timestamp(1_790_000_001_000_000_000);
    context.block_height(124);
    testing_env!(context.build());
    let id = company.prepare_distribution(4, U128(100), 1_900_000_000);
    let hash = company.get_distribution(id).unwrap().schedule_hash;
    let hex = hash.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    assert_eq!(hex, "6e0c40b35adae6decb3ce471e540fc42cbd0935abd4e3d37af2fe9d4ed491a5c");
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

fn assert_accounting_from_views(company: &Company) {
    let totals = company.get_totals();
    let mut holdings = Vec::new();
    let mut grants = Vec::new();
    for offset in (0..totals.holder_count).step_by(20) {
        holdings.extend(company.list_holdings(offset, 20));
    }
    let mut offset = 0;
    loop {
        let page = company.list_grants(offset, 20);
        if page.is_empty() {
            break;
        }
        offset += page.len() as u32;
        grants.extend(page);
    }
    let issued: u128 = holdings.iter().map(|holding| holding.issued_units.0).sum();
    let reserved: u128 = grants
        .iter()
        .map(|grant| grant.entitlement_cap.0 - grant.issued_units.0)
        .sum();
    let diluted = issued + totals.pool_available.0 + reserved;
    assert_eq!(holdings.len() as u32, totals.holder_count);
    assert_eq!(issued, totals.issued_total.0);
    assert_eq!(reserved, totals.grant_reserved.0);
    assert_eq!(diluted, totals.fully_diluted_total.0);
    assert_eq!(totals.authorized_units.0 - diluted, totals.unallocated_units.0);
    assert!(diluted <= totals.authorized_units.0);
    for grant in grants {
        assert!(grant.issued_units.0 <= grant.entitlement_cap.0);
        assert!(grant.entitlement_cap.0 <= grant.original_units.0);
    }
}

#[test]
fn mixed_ledger_operations_preserve_accounting_after_every_step() {
    let mut company = company();
    set_caller("board.testnet");
    company.increase_pool("initial-pool".into(), 0, U128(2_000_000));
    company.issue_founder_units("initial-founder".into(), 1, aid("holder-0.testnet"), U128(100_000));
    let mut random = 0x84c1_6e4d_39b2_07a5u64;
    let mut created_grants = Vec::new();
    let mut claims = 0;
    let mut cancellations = 0;
    let schedule = boundaries();
    for step in 0..120 {
        random = random.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        let operation = (random >> 32) % 5;
        let units = 100 + ((random >> 16) % 9_900) as u128;
        let now = 1_000 + step * 2_592_000;
        set_caller_at("board.testnet", now);
        let revision = company.get_totals().ledger_revision;
        let action = format!("mixed-{step}");
        match operation {
            0 => company.issue_founder_units(action, revision, aid(&format!("holder-{}.testnet", random % 5)), U128(units)),
            1 => company.increase_pool(action, revision, U128(units)),
            2 if company.get_totals().pool_available.0 >= units => {
                let id = company.create_grant(action, revision, aid(&format!("holder-{}.testnet", random % 5)), U128(units), schedule.clone());
                created_grants.push(id);
            }
            3 => {
                if let Some(grant) = created_grants.iter().filter_map(|id| company.get_grant(*id)).find(|grant| grant.claimable_units.0 > 0) {
                    set_caller_at(grant.recipient.as_str(), now);
                    company.claim_vested(grant.id);
                    claims += 1;
                }
            }
            4 => {
                if let Some(grant) = created_grants.iter().filter_map(|id| company.get_grant(*id)).find(|grant| grant.cancelled_at.is_none()) {
                    company.cancel_unvested(action, grant.id);
                    cancellations += 1;
                }
            }
            _ => {}
        }
        assert_accounting_from_views(&company);
    }
    assert!(!created_grants.is_empty());
    assert!(claims > 0 && cancellations > 0);
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
fn tiny_budget_marks_zero_entitlements_non_payable() {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("a".into(), 0, aid("alice.testnet"), U128(1));
    c.issue_founder_units("b".into(), 1, aid("bob.testnet"), U128(1));
    c.issue_founder_units("c".into(), 2, aid("carol.testnet"), U128(1));
    set_caller("operator.testnet");
    let id = c.prepare_distribution(3, U128(1), 10_000);
    let distribution = c.get_distribution(id).unwrap();
    assert_eq!(distribution.entitlements[0].amount.0, 1);
    assert_eq!(
        distribution.entitlements[0].payment_status,
        PaymentStatus::Ready
    );
    for row in &distribution.entitlements[1..] {
        assert_eq!(row.amount.0, 0);
        assert_eq!(row.payment_status, PaymentStatus::Zero);
    }
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

fn approved_distribution() -> (Company, u64, Vec<u8>) {
    let mut c = company();
    set_caller("board.testnet");
    c.issue_founder_units("founder".into(), 0, aid("alice.testnet"), U128(100));
    set_caller("operator.testnet");
    let id = c.prepare_distribution(1, U128(1_000), 10_000);
    let hash = c.get_distribution(id).unwrap().schedule_hash;
    set_caller("board.testnet");
    c.approve_distribution("approve".into(), id, hash.clone());
    (c, id, hash)
}

#[test]
fn only_exact_dao_token_funding_is_accepted_once() {
    let (mut c, id, hash) = approved_distribution();
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    set_caller("fake-token.testnet");
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg.clone())
            .0,
        1_000
    );
    set_caller("testusd.testnet");
    assert_eq!(
        c.ft_on_transfer(aid("attacker.testnet"), U128(1_000), msg.clone())
            .0,
        1_000
    );
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(999), msg.clone())
            .0,
        999
    );
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_001), msg.clone())
            .0,
        1_001
    );
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), "not-json".into())
            .0,
        1_000
    );
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), "{}".into())
            .0,
        1_000
    );
    let mut wrong_hash = hash.clone();
    wrong_hash[0] ^= 1;
    assert_eq!(
        c.ft_on_transfer(
            aid("board.testnet"),
            U128(1_000),
            near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":wrong_hash}).to_string(),
        ).0,
        1_000
    );
    assert!(!c.get_distribution(id).unwrap().funded);
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg.clone())
            .0,
        0
    );
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg).0,
        1_000
    );
    assert_eq!(c.get_distribution(id).unwrap().available_escrow.0, 1_000);
}

#[test]
fn failed_payment_releases_reservation_and_retry_pays_once() {
    let (mut c, id, hash) = approved_distribution();
    set_caller("testusd.testnet");
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    assert_eq!(
        c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg).0,
        0
    );
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    assert!(get_logs()
        .iter()
        .any(|line| line.contains("\"event\":\"payment_started\"")
            && line.contains("\"attempt_id\":1")));
    let pending = c.get_distribution(id).unwrap();
    assert_eq!(pending.available_escrow.0, 0);
    assert_eq!(pending.in_flight_total.0, 1_000);
    assert_eq!(
        pending.entitlements[0].payment_status,
        PaymentStatus::InFlight
    );

    let mut callback = VMContextBuilder::new();
    callback.current_account_id(aid("company.testnet"));
    callback.predecessor_account_id(aid("company.testnet"));
    testing_env!(
        callback.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    c.on_payment_result(id, aid("alice.testnet"), 1);
    let failed = c.get_distribution(id).unwrap();
    assert_eq!(failed.available_escrow.0, 1_000);
    assert_eq!(failed.in_flight_total.0, 0);
    assert_eq!(failed.entitlements[0].payment_status, PaymentStatus::Failed);

    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    let mut callback = VMContextBuilder::new();
    callback.current_account_id(aid("company.testnet"));
    callback.predecessor_account_id(aid("company.testnet"));
    testing_env!(
        callback.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    c.on_payment_result(id, aid("alice.testnet"), 2);
    let paid = c.get_distribution(id).unwrap();
    assert_eq!(paid.paid_total.0, 1_000);
    assert_eq!(paid.in_flight_total.0, 0);
    assert_eq!(paid.available_escrow.0, 0);
    assert_eq!(paid.entitlements[0].payment_status, PaymentStatus::Paid);
    assert_eq!(paid.entitlements[0].attempt_id, 2);
}

#[test]
fn pause_and_distribution_cancellation_emit_structured_events() {
    let (mut c, id, _) = approved_distribution();
    set_caller("board.testnet");
    c.set_paused("pause".into(), true);
    assert!(get_logs().iter().any(
        |line| line.contains("\"event\":\"pause_changed\"") && line.contains("\"paused\":true")
    ));
    c.cancel_unfunded_distribution("cancel".into(), id);
    assert!(get_logs()
        .iter()
        .any(|line| line.contains("\"event\":\"distribution_cancelled\"")
            && line.contains("\"distribution_id\":0")));
}

#[test]
fn pause_rejects_new_funding_but_preserves_in_flight_callback_settlement() {
    let (mut c, id, hash) = approved_distribution();
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    set_caller("board.testnet");
    c.set_paused("pause".into(), true);
    set_caller("testusd.testnet");
    assert_eq!(c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg.clone()).0, 1_000);
    set_caller("board.testnet");
    c.set_paused("resume".into(), false);
    set_caller("testusd.testnet");
    assert_eq!(c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg).0, 0);
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    set_caller("board.testnet");
    c.set_paused("pause-again".into(), true);
    let mut callback = VMContextBuilder::new();
    callback.current_account_id(aid("company.testnet"));
    callback.predecessor_account_id(aid("company.testnet"));
    testing_env!(callback.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(),
        Default::default(), vec![PromiseResult::Successful(vec![])]);
    c.on_payment_result(id, aid("alice.testnet"), 1);
    assert_eq!(c.get_distribution(id).unwrap().paid_total.0, 1_000);
    assert!(c.is_paused());
}

#[test]
#[should_panic(expected = "company paused")]
fn pause_blocks_new_payment_attempts() {
    let (mut c, id, hash) = approved_distribution();
    set_caller("testusd.testnet");
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg);
    set_caller("board.testnet");
    c.set_paused("pause".into(), true);
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
}

#[test]
#[should_panic(expected = "payment not retryable")]
fn in_flight_attempt_blocks_duplicate_transfer() {
    let (mut c, id, hash) = approved_distribution();
    set_caller("testusd.testnet");
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg);
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    c.pay_recipient(id, aid("alice.testnet"));
}

#[test]
#[should_panic(expected = "payment not retryable")]
fn in_flight_payment_does_not_reset_after_expiry() {
    let (mut c, id, hash) = approved_distribution();
    set_caller("testusd.testnet");
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg);
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    set_caller_at("executor.testnet", 100_000);
    let pending = c.get_distribution(id).unwrap();
    assert_eq!(pending.entitlements[0].payment_status, PaymentStatus::InFlight);
    assert_eq!(pending.in_flight_total.0, 1_000);
    c.pay_recipient(id, aid("alice.testnet"));
}

#[test]
#[should_panic(expected = "stale attempt")]
fn stale_payment_callback_cannot_settle_current_attempt() {
    let (mut c, id, hash) = approved_distribution();
    set_caller("testusd.testnet");
    let msg = near_sdk::serde_json::json!({"distribution_id":id,"schedule_hash":hash}).to_string();
    c.ft_on_transfer(aid("board.testnet"), U128(1_000), msg);
    set_caller("executor.testnet");
    c.pay_recipient(id, aid("alice.testnet"));
    let mut callback = VMContextBuilder::new();
    callback.current_account_id(aid("company.testnet"));
    callback.predecessor_account_id(aid("company.testnet"));
    testing_env!(
        callback.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    c.on_payment_result(id, aid("alice.testnet"), 0);
}
