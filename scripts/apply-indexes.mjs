/**
 * apply-indexes.mjs — Apply performance indexes directly to the database.
 * Run: node scripts/apply-indexes.mjs
 *
 * Uses CREATE INDEX IF NOT EXISTS so it is safe to run multiple times.
 */
import mysql from "/home/ubuntu/tradegateway-ngswtp/node_modules/.pnpm/mysql2@3.19.1_@types+node@24.7.0/node_modules/mysql2/promise.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse the DATABASE_URL and add SSL options properly
const conn = await mysql.createConnection({
  uri: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const indexes = [
  // payments — composite indexes for revenue queries
  `CREATE INDEX IF NOT EXISTS idx_pay_trader_id ON payments(trader_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_created_at ON payments(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_status_created_at ON payments(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_trader_status ON payments(trader_id, status)`,
  // audit_events — actor and timestamp queries
  `CREATE INDEX IF NOT EXISTS idx_ae_actor_id ON audit_events(actor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ae_created_at ON audit_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ae_entity_created_at ON audit_events(entity_type, entity_id, created_at)`,
  // declarations — date range queries for analytics
  `CREATE INDEX IF NOT EXISTS idx_decl_created_at ON declarations(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_decl_cleared_at ON declarations(cleared_at)`,
  `CREATE INDEX IF NOT EXISTS idx_decl_hs_code ON declarations(hs_code)`,
  `CREATE INDEX IF NOT EXISTS idx_decl_status_created_at ON declarations(status, created_at)`,
  // notifications — unread count query
  `CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, read)`,
  // user_notifications — unread per user
  `CREATE INDEX IF NOT EXISTS idx_un_user_read ON user_notifications(user_id, read)`,
  // vessel_tracking_events — port + time range
  `CREATE INDEX IF NOT EXISTS idx_vte_port_code ON vessel_tracking_events(port_code)`,
  `CREATE INDEX IF NOT EXISTS idx_vte_recorded_at ON vessel_tracking_events(recorded_at)`,
  // mojaloop_transactions — status + time
  `CREATE INDEX IF NOT EXISTS idx_mjtx_status_created_at ON mojaloop_transactions(status, created_at)`,
  // api_usage_logs — key + time
  `CREATE INDEX IF NOT EXISTS idx_aul_api_key_id ON api_usage_logs(api_key_id)`,
  `CREATE INDEX IF NOT EXISTS idx_aul_created_at ON api_usage_logs(created_at)`,
];

async function run() {
  let ok = 0, fail = 0;
  for (const idx of indexes) {
    const name = idx.match(/idx_\w+/)?.[0] ?? "unknown";
    try {
      await conn.execute(idx);
      console.log(`  ✓ ${name}`);
      ok++;
    } catch (e) {
      // MySQL uses 1061 for duplicate index
      if (e.errno === 1061 || String(e.message).includes("Duplicate key name")) {
        console.log(`  ~ ${name} (already exists)`);
        ok++;
      } else {
        console.error(`  ✗ ${name}: ${e.message}`);
        fail++;
      }
    }
  }
  console.log(`\nDone: ${ok} created/existing, ${fail} failed`);
  await conn.end();
}

run().catch(e => { console.error(e); process.exit(1); });
