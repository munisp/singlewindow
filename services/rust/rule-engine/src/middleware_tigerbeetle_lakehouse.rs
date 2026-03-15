/// tigerbeetle_lakehouse.rs — TigerBeetle financial ledger and Delta Lakehouse
/// integration for the Rust rule-engine service.
///
/// TigerBeetle: Records duty assessments computed by the rule engine as immutable
///              ledger entries via the TigerBeetle HTTP bridge.
///
/// Lakehouse:   Writes rule evaluation results (applied rules, scores, HS code
///              classifications) to the Delta Lake `rule_evaluations` table for
///              compliance analytics and model retraining datasets.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;
use tracing::{info, warn};

// ─── TigerBeetle ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TigerBeetleTransfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub ledger: u32,
    pub code: u16,
    pub user_data: String,
    pub flags: u16,
}

pub struct TigerBeetleClient {
    base_url: String,
    client: Client,
}

impl TigerBeetleClient {
    pub fn new() -> Self {
        let base_url = env::var("TIGERBEETLE_HTTP_URL")
            .unwrap_or_else(|_| "http://tigerbeetle-bridge:8099".to_string());
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("Failed to build TigerBeetle HTTP client");
        Self { base_url, client }
    }

    /// Records a duty assessment transfer when the rule engine computes the final duty amount.
    /// Code 1001 = customs duty, 1002 = penalty, 1003 = VAT, 1004 = levy
    pub async fn record_duty_assessment(
        &self,
        transfer: TigerBeetleTransfer,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "transfers": [transfer]
        });
        let url = format!("{}/transfers", self.base_url);
        let resp = self
            .client
            .post(&url)
            .json(&payload)
            .send()
            .await?;

        if resp.status().is_success() {
            info!(
                transfer_id = %transfer.id,
                amount = transfer.amount,
                code = transfer.code,
                "TigerBeetle duty assessment recorded"
            );
        } else {
            warn!(
                status = %resp.status(),
                "TigerBeetle transfer returned non-2xx"
            );
        }
        Ok(())
    }

    /// Queries the pending duty balance for a trader account.
    pub async fn get_pending_balance(
        &self,
        account_id: &str,
    ) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/accounts/{}/balance", self.base_url, account_id);
        let resp = self.client.get(&url).send().await?;
        let body: serde_json::Value = resp.json().await?;
        let balance = body["credits_posted"].as_u64().unwrap_or(0)
            .saturating_sub(body["debits_posted"].as_u64().unwrap_or(0));
        Ok(balance)
    }
}

// ─── Lakehouse ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuleEvaluationRecord {
    pub evaluation_id: String,
    pub declaration_id: String,
    pub ucr: String,
    pub hs_code: String,
    pub trader_id: String,
    pub rules_applied: Vec<String>,
    pub rules_triggered: Vec<String>,
    pub risk_score: f32,
    pub duty_rate: f32,
    pub duty_amount: f64,
    pub vat_amount: f64,
    pub levy_amount: f64,
    pub total_assessment: f64,
    pub lane_assigned: String,
    pub evaluation_ms: u64,
    pub evaluated_at: String,
    pub partition_date: String,
}

pub struct LakehouseClient {
    base_url: String,
    client: Client,
}

impl LakehouseClient {
    pub fn new() -> Self {
        let base_url = env::var("LAKEHOUSE_HTTP_URL")
            .unwrap_or_else(|_| "http://lakehouse-ingest:8097".to_string());
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to build Lakehouse HTTP client");
        Self { base_url, client }
    }

    /// Ingests a rule evaluation record into the Delta Lake `rule_evaluations` table.
    /// Used for compliance analytics, model retraining, and audit trails.
    pub async fn ingest_rule_evaluation(
        &self,
        mut record: RuleEvaluationRecord,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if record.partition_date.is_empty() {
            record.partition_date = chrono::Utc::now().format("%Y-%m-%d").to_string();
        }
        let payload = serde_json::json!({
            "table": "rule_evaluations",
            "records": [record]
        });
        let url = format!("{}/ingest", self.base_url);
        match self.client.post(&url).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!(
                    evaluation_id = %record.evaluation_id,
                    "Rule evaluation ingested to lakehouse"
                );
            }
            Ok(resp) => {
                warn!(status = %resp.status(), "Lakehouse ingest non-2xx (non-fatal)");
            }
            Err(e) => {
                warn!(error = %e, "Lakehouse ingest failed (non-fatal)");
            }
        }
        Ok(())
    }

    /// Ingests HS code classification results for ML model feedback loops.
    pub async fn ingest_hs_classification(
        &self,
        record: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::json!({
            "table": "hs_classifications",
            "records": [record]
        });
        let url = format!("{}/ingest", self.base_url);
        if let Err(e) = self.client.post(&url).json(&payload).send().await {
            warn!(error = %e, "HS classification lakehouse ingest failed (non-fatal)");
        }
        Ok(())
    }
}
