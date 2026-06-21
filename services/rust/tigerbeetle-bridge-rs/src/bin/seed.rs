// bin/seed.rs — Standalone TigerBeetle account seeding binary.
//
// Usage:
//   cargo run --bin seed
//   # or with custom bridge URL:
//   TIGERBEETLE_BRIDGE_URL=http://tb-bridge:4600 cargo run --bin seed
//
// This binary:
//   1. Connects to the TigerBeetle Rust bridge HTTP API
//   2. Creates all 13 system accounts (idempotent — safe to re-run)
//   3. Exits 0 on success, 1 if any account failed to create
//
// Run this once at platform bootstrap, and again after any TigerBeetle data reset.
// It is also safe to run in CI pipelines as part of integration test setup.

use std::process;
use tigerbeetle_bridge_rs::seed::{seed_system_accounts, SeedResult};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

// Re-export the seed module from the library crate
// (We reference it via the crate name since this is a binary in the same crate)
mod seed_import {
    pub use crate::*;
}

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .init();

    let bridge_url = std::env::var("TIGERBEETLE_BRIDGE_URL")
        .unwrap_or_else(|_| "http://localhost:4600".to_string());

    info!(
        "TradeGateway NGSWTP — TigerBeetle Account Seeder",
    );
    info!("Bridge URL: {}", bridge_url);
    info!("Seeding 13 system accounts across 6 WCO GL ledgers...");

    match seed_system_accounts(&bridge_url).await {
        Ok(result) => {
            print_result(&result);
            if result.is_success() {
                info!("Seeding completed successfully");
                process::exit(0);
            } else {
                error!(
                    "Seeding completed with {} failures — check logs above",
                    result.failed
                );
                process::exit(1);
            }
        }
        Err(e) => {
            error!("Seeding failed with fatal error: {}", e);
            process::exit(1);
        }
    }
}

fn print_result(result: &SeedResult) {
    println!("\n╔══════════════════════════════════════════════════╗");
    println!("║   TigerBeetle Account Seeding — Summary          ║");
    println!("╠══════════════════════════════════════════════════╣");
    println!("║  Total accounts:  {:>5}                          ║", result.total);
    println!("║  Created:         {:>5}                          ║", result.created);
    println!("║  Skipped (exist): {:>5}                          ║", result.skipped);
    println!("║  Failed:          {:>5}                          ║", result.failed);
    println!("╠══════════════════════════════════════════════════╣");
    if result.is_success() {
        println!("║  Status: ✓ SUCCESS                               ║");
    } else {
        println!("║  Status: ✗ FAILED — check error logs above       ║");
    }
    println!("╚══════════════════════════════════════════════════╝\n");
}
