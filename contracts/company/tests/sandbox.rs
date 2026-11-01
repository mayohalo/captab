use serde_json::{json, Value};

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
