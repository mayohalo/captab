use base64::{engine::general_purpose::STANDARD, Engine as _};
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountDetailsPatch, Contract};
use serde_json::{json, Value};

#[tokio::test]
async fn zero_balance_contributor_claims_through_signed_delegate(
) -> Result<(), Box<dyn std::error::Error>> {
    let wasm = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/wasm32-unknown-unknown/release/captab_company.wasm"))?;
    let worker = near_workspaces::sandbox().await?;
    let company = worker.dev_deploy(&wasm).await?;
    let dao = worker.dev_create_account().await?;
    let operator = worker.dev_create_account().await?;
    let contributor = worker.dev_create_account().await?;
    let relayer = worker.dev_create_account().await?;
    let token = worker.dev_create_account().await?;
    assert!(company.call("new").args_json(json!({
        "dao_id": dao.id(), "snapshot_operator_id": operator.id(),
        "settlement_token_id": token.id(), "authorized_units": "1000"
    })).transact().await?.is_success());
    assert!(dao.call(company.id(), "increase_pool").args_json(json!({
        "action_id": "sponsor-pool", "expected_revision": 0, "units": "100"
    })).transact().await?.is_success());
    let boundaries: Vec<u64> = (0..=48).map(|month| 1_000 + month * 2_592_000).collect();
    assert!(dao.call(company.id(), "create_grant").args_json(json!({
        "action_id": "sponsor-grant", "expected_revision": 1,
        "recipient": contributor.id(), "units": "100", "boundaries": boundaries
    })).transact().await?.is_success());
    worker.patch(contributor.id()).account_from_current(|details| {
        AccountDetailsPatch::from(details).balance(NearToken::from_yoctonear(0))
    }).transact().await?;
    assert_eq!(worker.view_account(contributor.id()).await?.balance, NearToken::from_yoctonear(0));

    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/web/scripts/sandbox-sponsored-claim.mjs");
    let output = std::process::Command::new("node")
        .arg(script)
        .env("SANDBOX_RPC_URL", worker.rpc_addr())
        .env("SANDBOX_COMPANY_ID", company.id().as_str())
        .env("SANDBOX_CONTRIBUTOR_ID", contributor.id().as_str())
        .env("SANDBOX_CONTRIBUTOR_KEY", contributor.secret_key().to_string())
        .env("SANDBOX_RELAYER_ID", relayer.id().as_str())
        .env("SANDBOX_RELAYER_KEY", relayer.secret_key().to_string())
        .output()?;
    assert!(output.status.success(), "delegate script failed: {}", String::from_utf8_lossy(&output.stderr));
    let holding: Value = company.view("get_holding").args_json(json!({"account_id": contributor.id()})).await?.json()?;
    assert_eq!(holding, "100");
    Ok(())
}

#[tokio::test]
async fn dao_ownership_and_snapshot_run_on_chain() -> Result<(), Box<dyn std::error::Error>> {
    let wasm_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-unknown-unknown/release/captab_company.wasm"
    );
    let wasm = std::fs::read(wasm_path)?;
    let worker = near_workspaces::sandbox().await?;
    let company = worker.dev_deploy(&wasm).await?;
    let dao = worker.dev_create_account().await?;
    let operator = worker.dev_create_account().await?;
    let founder = worker.dev_create_account().await?;
    let outsider = worker.dev_create_account().await?;
    let token = worker.dev_create_account().await?;

    let init = company
        .call("new")
        .args_json(json!({
            "dao_id": dao.id(),
            "snapshot_operator_id": operator.id(),
            "settlement_token_id": token.id(),
            "authorized_units": "1000"
        }))
        .transact()
        .await?;
    assert!(init.is_success(), "initialization: {init:?}");
    let config: Value = company.view("get_config").await?.json()?;
    assert_eq!(config["dao_id"], dao.id().as_str());
    assert_eq!(config["snapshot_operator_id"], operator.id().as_str());
    assert_eq!(config["settlement_token_id"], token.id().as_str());

    let unauthorized = outsider
        .call(company.id(), "issue_founder_units")
        .args_json(json!({
            "action_id": "founder-1",
            "expected_revision": 0,
            "recipient": founder.id(),
            "units": "600"
        }))
        .transact()
        .await?;
    assert!(!unauthorized.is_success(), "outsider issued units");

    let issue = dao
        .call(company.id(), "issue_founder_units")
        .args_json(json!({
            "action_id": "founder-1",
            "expected_revision": 0,
            "recipient": founder.id(),
            "units": "600"
        }))
        .transact()
        .await?;
    assert!(issue.is_success(), "DAO issuance: {issue:?}");

    let stale = dao
        .call(company.id(), "issue_founder_units")
        .args_json(json!({
            "action_id": "founder-stale",
            "expected_revision": 0,
            "recipient": outsider.id(),
            "units": "10"
        }))
        .transact()
        .await?;
    assert!(!stale.is_success(), "stale revision issued units");

    let holding: Value = company
        .view("get_holding")
        .args_json(json!({"account_id": founder.id()}))
        .await?
        .json()?;
    assert_eq!(holding, "600");

    let snapshot = operator
        .call(company.id(), "prepare_distribution")
        .args_json(json!({
            "expected_revision": 1,
            "budget": "120",
            "expires_at": 4_102_444_800u64
        }))
        .transact()
        .await?;
    assert!(snapshot.is_success(), "snapshot: {snapshot:?}");
    let distribution: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(distribution["snapshot_revision"], 1);
    assert_eq!(distribution["budget"], "120");
    assert_eq!(
        distribution["entitlements"][0]["account_id"],
        founder.id().as_str()
    );
    assert_eq!(distribution["entitlements"][0]["amount"], "120");
    Ok(())
}

#[tokio::test]
async fn funded_payout_failure_and_retry_follow_token_receipts(
) -> Result<(), Box<dyn std::error::Error>> {
    let company_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-unknown-unknown/release/captab_company.wasm"
    ))?;
    let token_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-unknown-unknown/release/captab_test_token.wasm"
    ))?;
    let worker = near_workspaces::sandbox().await?;
    let company = worker.dev_deploy(&company_wasm).await?;
    let token = worker.dev_deploy(&token_wasm).await?;
    let dao = worker.dev_create_account().await?;
    let operator = worker.dev_create_account().await?;
    let paid_holder = worker.dev_create_account().await?;
    let retry_holder = worker.dev_create_account().await?;

    assert!(token
        .call("new")
        .args_json(json!({"owner_id": dao.id(), "total_supply": "1000"}))
        .transact()
        .await?
        .is_success());
    for account_id in [company.id(), paid_holder.id()] {
        let registration = dao
            .call(token.id(), "storage_deposit")
            .args_json(json!({"account_id": account_id, "registration_only": true}))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?;
        assert!(
            registration.is_success(),
            "token registration: {registration:?}"
        );
    }
    assert!(company
        .call("new")
        .args_json(json!({
            "dao_id": dao.id(),
            "snapshot_operator_id": operator.id(),
            "settlement_token_id": token.id(),
            "authorized_units": "1000"
        }))
        .transact()
        .await?
        .is_success());
    for (index, (recipient, units)) in [(paid_holder.id(), "600"), (retry_holder.id(), "400")]
        .into_iter()
        .enumerate()
    {
        let issue = dao
            .call(company.id(), "issue_founder_units")
            .args_json(json!({
                "action_id": format!("issue-{index}"),
                "expected_revision": index,
                "recipient": recipient,
                "units": units
            }))
            .transact()
            .await?;
        assert!(issue.is_success(), "issuance: {issue:?}");
    }
    let snapshot = operator
        .call(company.id(), "prepare_distribution")
        .args_json(json!({
            "expected_revision": 2,
            "budget": "100",
            "expires_at": 4_102_444_800u64
        }))
        .transact()
        .await?;
    assert!(snapshot.is_success(), "snapshot: {snapshot:?}");
    let prepared: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    let hash = prepared["schedule_hash"].clone();
    let approval = dao
        .call(company.id(), "approve_distribution")
        .args_json(json!({
            "action_id": "approve-0",
            "distribution_id": 0,
            "schedule_hash": hash
        }))
        .transact()
        .await?;
    assert!(approval.is_success(), "approval: {approval:?}");

    let funding = dao
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": company.id(),
            "amount": "100",
            "msg": json!({"distribution_id": 0, "schedule_hash": hash}).to_string()
        }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(funding.is_success(), "funding: {funding:?}");
    let funded: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(funded["funded"], true);
    assert_eq!(funded["available_escrow"], "100");

    let spoofed_callback = retry_holder
        .call(company.id(), "on_payment_result")
        .args_json(json!({"distribution_id": 0, "recipient_id": retry_holder.id(), "attempt_id": 1}))
        .transact()
        .await?;
    assert!(!spoofed_callback.is_success(), "external caller invoked private payment callback");

    let first = operator
        .call(company.id(), "pay_recipient")
        .args_json(json!({"distribution_id": 0, "recipient_id": paid_holder.id()}))
        .max_gas()
        .transact()
        .await?;
    assert!(first.is_success(), "first payout: {first:?}");

    let failed = operator
        .call(company.id(), "pay_recipient")
        .args_json(json!({"distribution_id": 0, "recipient_id": retry_holder.id()}))
        .max_gas()
        .transact()
        .await?;
    assert!(
        failed.is_success(),
        "callback should settle failed FT: {failed:?}"
    );
    let after_failed: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(after_failed["paid_total"], "60");
    assert_eq!(after_failed["available_escrow"], "40");
    let failed_row = after_failed["entitlements"]
        .as_array()
        .expect("entitlements")
        .iter()
        .find(|row| row["account_id"] == retry_holder.id().as_str())
        .expect("retry holder entitlement");
    assert_eq!(failed_row["payment_status"], "Failed");

    let registration = dao
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id": retry_holder.id(), "registration_only": true}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?;
    assert!(
        registration.is_success(),
        "retry holder registration: {registration:?}"
    );
    let retry = operator
        .call(company.id(), "pay_recipient")
        .args_json(json!({"distribution_id": 0, "recipient_id": retry_holder.id()}))
        .max_gas()
        .transact()
        .await?;
    assert!(retry.is_success(), "retry: {retry:?}");
    let settled: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(settled["paid_total"], "100");
    assert_eq!(settled["available_escrow"], "0");
    assert_eq!(settled["in_flight_total"], "0");
    let settled_row = settled["entitlements"]
        .as_array()
        .expect("entitlements")
        .iter()
        .find(|row| row["account_id"] == retry_holder.id().as_str())
        .expect("retry holder entitlement");
    assert_eq!(settled_row["payment_status"], "Paid");
    assert_eq!(settled_row["attempt_id"], 2);
    let retry_balance: Value = token
        .view("ft_balance_of")
        .args_json(json!({"account_id": retry_holder.id()}))
        .await?
        .json()?;
    assert_eq!(retry_balance, "40");
    Ok(())
}

fn dao_function_call(
    receiver_id: &str,
    method_name: &str,
    args: Value,
    gas: &str,
    deposit: &str,
) -> Value {
    json!({"FunctionCall": {
        "receiver_id": receiver_id,
        "actions": [{
            "method_name": method_name,
            "args": STANDARD.encode(serde_json::to_vec(&args).expect("serialize DAO action")),
            "gas": gas,
            "deposit": deposit
        }]
    }})
}

async fn approve_two_of_three(
    dao: &Contract,
    members: &[Account; 3],
    kind: Value,
    description: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let added = members[0]
        .call(dao.id(), "add_proposal")
        .args_json(json!({"proposal": {"description": description, "kind": kind}}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?;
    assert!(added.is_success(), "proposal submission: {added:?}");
    let id: u64 = added.json()?;
    for (index, member) in members.iter().take(2).enumerate() {
        let vote = member
            .call(dao.id(), "act_proposal")
            .args_json(json!({"id": id, "action": "VoteApprove", "proposal": kind}))
            .max_gas()
            .transact()
            .await?;
        assert!(vote.is_success(), "vote {}: {vote:?}", index + 1);
        let proposal: Value = dao
            .view("get_proposal")
            .args_json(json!({"id": id}))
            .await?
            .json()?;
        if index == 0 {
            assert_eq!(proposal["status"], "InProgress");
        } else {
            assert_eq!(proposal["status"], "Approved", "DAO execution: {proposal}");
        }
    }
    Ok(id)
}

#[tokio::test]
async fn real_sputnik_requires_two_votes_and_funds_company(
) -> Result<(), Box<dyn std::error::Error>> {
    let company_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-unknown-unknown/release/captab_company.wasm"
    ))?;
    let token_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-unknown-unknown/release/captab_test_token.wasm"
    ))?;
    let dao_wasm = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../.cache/sputnik/target/wasm32-unknown-unknown/release/sputnikdao2.wasm"
    ))?;
    let worker = near_workspaces::sandbox().await?;
    let dao = worker.dev_deploy(&dao_wasm).await?;
    let company = worker.dev_deploy(&company_wasm).await?;
    let token = worker.dev_deploy(&token_wasm).await?;
    let members = [
        worker.dev_create_account().await?,
        worker.dev_create_account().await?,
        worker.dev_create_account().await?,
    ];
    let operator = worker.dev_create_account().await?;
    let founder = worker.dev_create_account().await?;
    let contributor = worker.dev_create_account().await?;
    let council: Vec<_> = members.iter().map(|account| account.id()).collect();
    let init_dao = dao
        .call("new")
        .args_json(json!({
            "config": {"name": "Captab DAO", "purpose": "Govern test company", "metadata": ""},
            "policy": council
        }))
        .transact()
        .await?;
    assert!(init_dao.is_success(), "DAO initialization: {init_dao:?}");
    let policy: Value = dao.view("get_policy").await?.json()?;
    assert_eq!(policy["proposal_bond"], "1000000000000000000000000");
    let council_role = policy["roles"]
        .as_array()
        .expect("DAO roles")
        .iter()
        .find(|role| role["name"] == "council")
        .expect("council role");
    assert_eq!(council_role["kind"]["Group"].as_array().unwrap().len(), 3);
    assert!(token
        .call("new")
        .args_json(json!({"owner_id": dao.id(), "total_supply": "1000"}))
        .transact()
        .await?
        .is_success());
    for account_id in [company.id(), founder.id()] {
        let registration = members[0]
            .call(token.id(), "storage_deposit")
            .args_json(json!({"account_id": account_id, "registration_only": true}))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?;
        assert!(registration.is_success(), "registration: {registration:?}");
    }
    assert!(company
        .call("new")
        .args_json(json!({
            "dao_id": dao.id(),
            "snapshot_operator_id": operator.id(),
            "settlement_token_id": token.id(),
            "authorized_units": "1000"
        }))
        .transact()
        .await?
        .is_success());

    let issuance = dao_function_call(
        company.id().as_str(),
        "issue_founder_units",
        json!({"action_id": "sputnik-issue", "expected_revision": 0, "recipient": founder.id(), "units": "600"}),
        "40000000000000",
        "0",
    );
    approve_two_of_three(&dao, &members, issuance, "Issue founder units").await?;
    let holding: Value = company
        .view("get_holding")
        .args_json(json!({"account_id": founder.id()}))
        .await?
        .json()?;
    assert_eq!(holding, "600");

    let snapshot = operator
        .call(company.id(), "prepare_distribution")
        .args_json(json!({"expected_revision": 1, "budget": "120", "expires_at": 4_102_444_800u64}))
        .transact()
        .await?;
    assert!(snapshot.is_success(), "snapshot: {snapshot:?}");
    let prepared: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    let hash = prepared["schedule_hash"].clone();
    let approval = dao_function_call(
        company.id().as_str(),
        "approve_distribution",
        json!({"action_id": "sputnik-approve", "distribution_id": 0, "schedule_hash": hash}),
        "40000000000000",
        "0",
    );
    approve_two_of_three(&dao, &members, approval, "Approve distribution schedule").await?;

    let funding = dao_function_call(
        token.id().as_str(),
        "ft_transfer_call",
        json!({
            "receiver_id": company.id(),
            "amount": "120",
            "msg": json!({"distribution_id": 0, "schedule_hash": hash}).to_string()
        }),
        "120000000000000",
        "1",
    );
    approve_two_of_three(&dao, &members, funding, "Fund distribution escrow").await?;
    let funded: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(funded["funded"], true);
    assert_eq!(funded["available_escrow"], "120");

    let pool = dao_function_call(
        company.id().as_str(),
        "increase_pool",
        json!({"action_id": "sputnik-pool", "expected_revision": 1, "units": "200"}),
        "40000000000000",
        "0",
    );
    approve_two_of_three(&dao, &members, pool, "Reserve contributor pool").await?;
    let boundaries: Vec<u64> = (0..=48).map(|month| 1_000 + month * 2_592_000).collect();
    let grant = dao_function_call(
        company.id().as_str(),
        "create_grant",
        json!({
            "action_id": "sputnik-grant",
            "expected_revision": 2,
            "recipient": contributor.id(),
            "units": "100",
            "boundaries": boundaries
        }),
        "80000000000000",
        "0",
    );
    approve_two_of_three(&dao, &members, grant, "Grant contributor units").await?;
    let before_claim: Value = company
        .view("get_grant")
        .args_json(json!({"grant_id": 0}))
        .await?
        .json()?;
    assert_eq!(before_claim["claimable_units"], "100");
    let claim = contributor
        .call(company.id(), "claim_vested")
        .args_json(json!({"grant_id": 0}))
        .transact()
        .await?;
    assert!(claim.is_success(), "contributor claim: {claim:?}");
    let contributor_holding: Value = company
        .view("get_holding")
        .args_json(json!({"account_id": contributor.id()}))
        .await?
        .json()?;
    assert_eq!(contributor_holding, "100");
    let frozen: Value = company
        .view("get_distribution")
        .args_json(json!({"distribution_id": 0}))
        .await?
        .json()?;
    assert_eq!(frozen["entitlements"].as_array().unwrap().len(), 1);
    Ok(())
}
