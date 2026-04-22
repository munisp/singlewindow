/**
 * seed-all-tables.mjs
 * Seeds all previously empty tables with realistic production-grade data.
 * Run: node scripts/seed-all-tables.mjs
 */
import pg from "pg";
import crypto from "crypto";

const LOCAL_PG = "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_PG;
const sslConfig = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: sslConfig, max: 5 });

function uuid() { return crypto.randomUUID(); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

async function seed() {
  const client = await pool.connect();
  try {
    const { rows: users } = await client.query("SELECT id, role FROM users LIMIT 15");
    const adminUsers = users.filter(u => u.role === 'admin');
    const userIds = users.map(u => u.id);
    const adminIds = adminUsers.map(u => u.id);
    const { rows: decls } = await client.query("SELECT id FROM declarations LIMIT 20");
    const declIds = decls.map(d => d.id);
    console.log(`Found ${users.length} users, ${decls.length} declarations`);

    // ── TENANTS ───────────────────────────────────────────────────────────────
    console.log("Seeding tenants...");
    const tenantData = [
      { name: "Nigeria Customs Service", slug: "ncs", plan: "enterprise", country: "NGA" },
      { name: "Ghana Revenue Authority", slug: "gra", plan: "enterprise", country: "GHA" },
      { name: "Rwanda Revenue Authority", slug: "rra", plan: "professional", country: "RWA" },
      { name: "Kenya Revenue Authority", slug: "kra", plan: "professional", country: "KEN" },
      { name: "Côte d'Ivoire DGD", slug: "dgd-ci", plan: "starter", country: "CIV" },
    ];
    for (const t of tenantData) {
      await client.query(
        `INSERT INTO tenants (id, name, slug, plan, country_code, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'active',NOW(),NOW()) ON CONFLICT (slug) DO NOTHING`,
        [uuid(), t.name, t.slug, t.plan, t.country]);
    }

    // ── MOJALOOP_TRANSACTIONS ─────────────────────────────────────────────────
    console.log("Seeding mojaloop_transactions...");
    const fspIds = ["ZENITH-BANK-NG", "ACCESS-BANK-NG", "GTB-NG", "NCS-TREASURY"];
    const txStatuses = ["committed", "committed", "committed", "reserved", "aborted"];
    for (let i = 0; i < 30; i++) {
      const amount = (rand(5000, 500000) / 100).toFixed(2);
      await client.query(
        `INSERT INTO mojaloop_transactions
         (id, transfer_id, payer_fsp_id, payee_fsp_id, payer_fsp_type, payee_fsp_type,
          amount, currency, status, ilp_packet, condition, declaration_id, initiated_by, created_at, updated_at)
         VALUES ($1,$2,$3,'NCS-TREASURY','bank','bank',$4,'NGN',$5,$6,$7,$8,$9,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [uuid(), uuid(), pick(fspIds), amount, pick(txStatuses),
         `ILP_${crypto.randomBytes(16).toString('hex')}`,
         `COND_${crypto.randomBytes(32).toString('hex')}`,
         declIds.length ? pick(declIds) : null,
         userIds.length ? pick(userIds) : null]);
    }

    // ── PAYMENT_ACCOUNTS ──────────────────────────────────────────────────────
    console.log("Seeding payment_accounts...");
    const acctTypes = ["trader_wallet", "customs_escrow", "duty_collection", "drawback_reserve"];
    for (let i = 0; i < 12; i++) {
      const credits = BigInt(rand(100000, 50000000));
      const debits = BigInt(rand(50000, Number(credits)));
      await client.query(
        `INSERT INTO payment_accounts
         (id, account_id, account_type, ledger_id, currency, credits_posted, debits_posted,
          shard_key, owner_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'NGN',$5,$6,$7,$8,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), `ACC-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
         pick(acctTypes), `LEDGER-${rand(1,5)}`, credits.toString(), debits.toString(),
         rand(0, 7), userIds.length ? pick(userIds) : null]);
    }

    // ── PAYMENT_QUEUE ─────────────────────────────────────────────────────────
    console.log("Seeding payment_queue...");
    const qStatuses = ["committed", "committed", "committed", "failed", "dead_letter"];
    for (let i = 0; i < 20; i++) {
      const amount = (rand(10000, 2000000) / 100).toFixed(2);
      const status = pick(qStatuses);
      await client.query(
        `INSERT INTO payment_queue
         (id, idempotency_key, payer_account_id, payee_account_id, amount, currency,
          status, attempt_count, max_attempts, next_retry_at, declaration_id, metadata, created_at, updated_at)
         VALUES ($1,$2,$3,'ACC-NCS-TREASURY',$4,'NGN',$5,$6,5,$7,$8,$9,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [uuid(), `IK-${crypto.randomBytes(16).toString('hex')}`,
         `ACC-PAYER-${rand(1,5)}`, amount, status, status === "committed" ? 1 : rand(2,5),
         status === "committed" ? null : daysFromNow(rand(0,2)),
         declIds.length ? pick(declIds) : null,
         JSON.stringify({ channel: pick(["web","mobile","api"]), ref: `REF-${rand(10000,99999)}` })]);
    }

    // ── PAYMENT_IDEMPOTENCY_KEYS ──────────────────────────────────────────────
    console.log("Seeding payment_idempotency_keys...");
    for (let i = 0; i < 15; i++) {
      await client.query(
        `INSERT INTO payment_idempotency_keys (id, key_hash, transfer_id, response_body, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), crypto.createHash('sha256').update(`key-${i}-${Date.now()}`).digest('hex'),
         uuid(), JSON.stringify({ status: "committed", amount: rand(1000,100000) }), daysFromNow(1)]);
    }

    // ── PAYMENT_ARCHIVAL_JOBS ─────────────────────────────────────────────────
    console.log("Seeding payment_archival_jobs...");
    const archTiers = ["hot","warm","cold"];
    const archStatuses = ["completed","completed","running","failed"];
    for (let i = 0; i < 8; i++) {
      const rows = rand(500, 50000);
      await client.query(
        `INSERT INTO payment_archival_jobs
         (id, tier, status, rows_archived, bytes_written, started_at, completed_at, error_message, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), pick(archTiers), pick(archStatuses), rows, BigInt(rows * rand(512,2048)).toString(),
         daysAgo(rand(1,30)), daysAgo(rand(0,29))]);
    }

    // ── WEBHOOK_SUBSCRIPTIONS ─────────────────────────────────────────────────
    console.log("Seeding webhook_subscriptions...");
    const evTypes = ["declaration.submitted","declaration.cleared","payment.completed","permit.approved","risk.flagged"];
    for (let i = 0; i < 8; i++) {
      await client.query(
        `INSERT INTO webhook_subscriptions (id, user_id, url, secret, event_types, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), userIds.length ? pick(userIds) : null,
         `https://webhook.example.com/tg-${rand(1000,9999)}`,
         `whsec_${crypto.randomBytes(24).toString('hex')}`,
         JSON.stringify([pick(evTypes), pick(evTypes)])]);
    }

    // ── ONBOARDING_PROGRESS ───────────────────────────────────────────────────
    console.log("Seeding onboarding_progress...");
    const steps = ["profile_complete","kyc_submitted","kyc_approved","first_declaration","payment_method_added"];
    for (const userId of userIds.slice(0,10)) {
      for (const step of steps.slice(0, rand(1, steps.length))) {
        await client.query(
          `INSERT INTO onboarding_progress (id, user_id, step, status, completed_at, created_at)
           VALUES ($1,$2,$3,'completed',$4,NOW()) ON CONFLICT DO NOTHING`,
          [uuid(), userId, step, daysAgo(rand(1,60))]);
      }
    }

    // ── KYC_VERIFICATIONS ─────────────────────────────────────────────────────
    console.log("Seeding kyc_verifications...");
    const kycStatuses = ["approved","approved","pending","rejected"];
    const kycTypes = ["identity","address","business_registration","tax_clearance"];
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO kyc_verifications
         (id, user_id, verification_type, status, provider, provider_ref, verified_at, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'manual_review',$5,$6,$7,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), userId, pick(kycTypes), pick(kycStatuses),
         `KYC-REF-${rand(100000,999999)}`,
         Math.random() > 0.3 ? daysAgo(rand(1,90)) : null,
         "Verified against NIMC/CAC records"]);
    }

    // ── ORIGIN_CERTIFICATES ───────────────────────────────────────────────────
    console.log("Seeding origin_certificates...");
    const certTypes = ["form_a","eur1","certificate_of_origin","afcfta"];
    const certStatuses = ["issued","issued","pending","revoked"];
    for (let i = 0; i < 15; i++) {
      await client.query(
        `INSERT INTO origin_certificates
         (id, certificate_number, declaration_id, applicant_id, cert_type, status, origin_country,
          goods_description, hs_code, issued_at, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'NGA',$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), `OC-${new Date().getFullYear()}-${String(i+1).padStart(6,'0')}`,
         declIds.length ? pick(declIds) : null, userIds.length ? pick(userIds) : null,
         pick(certTypes), pick(certStatuses),
         pick(["Motor vehicles","Electronic goods","Petroleum products","Agricultural produce"]),
         pick(["8703.23","8471.30","2710.19","1001.99","6110.20"]),
         daysAgo(rand(1,60)), daysFromNow(rand(180,365))]);
    }

    // ── NOTIFICATION_PREFERENCES ──────────────────────────────────────────────
    console.log("Seeding notification_preferences...");
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO notification_preferences
         (id, user_id, email_enabled, sms_enabled, push_enabled, digest_frequency, created_at, updated_at)
         VALUES ($1,$2,true,false,true,'daily',NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), userId]);
    }

    // ── VISION_ANALYSES ───────────────────────────────────────────────────────
    console.log("Seeding vision_analyses...");
    const vTypes = ["cargo_scan","document_ocr","seal_verification","container_damage"];
    const riskLevels = ["low","low","medium","high"];
    for (let i = 0; i < 15; i++) {
      await client.query(
        `INSERT INTO vision_analyses
         (id, declaration_id, analysis_type, image_url, risk_level, confidence_score,
          findings, reviewed_by, reviewed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), declIds.length ? pick(declIds) : null, pick(vTypes),
         `https://storage.example.com/scans/${uuid()}.jpg`,
         pick(riskLevels), (0.7 + Math.random() * 0.29).toFixed(4),
         JSON.stringify({ detected_items: rand(1,5), anomalies: Math.random() > 0.7 ? ["seal_tampered"] : [] }),
         adminIds.length ? pick(adminIds) : null, daysAgo(rand(0,14))]);
    }

    // ── PILOT_REPORTS ─────────────────────────────────────────────────────────
    console.log("Seeding pilot_reports...");
    for (let i = 0; i < 8; i++) {
      await client.query(
        `INSERT INTO pilot_reports
         (id, report_date, declarations_processed, avg_clearance_hours, green_lane_pct,
          yellow_lane_pct, red_lane_pct, revenue_collected, issues_reported, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), daysAgo(i * 7).toISOString().split('T')[0],
         rand(50,200), (rand(2,24)/10).toFixed(1),
         rand(60,80), rand(15,25), rand(5,15),
         (rand(5000000,50000000)/100).toFixed(2), rand(0,5)]);
    }

    // ── SETTINGS_AUDIT_LOG ────────────────────────────────────────────────────
    console.log("Seeding settings_audit_log...");
    const settingKeys = ["max_declaration_value","risk_threshold_green","aeo_auto_approve","payment_timeout_seconds"];
    for (let i = 0; i < 10; i++) {
      await client.query(
        `INSERT INTO settings_audit_log (id, key, old_value, new_value, changed_by, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uuid(), pick(settingKeys), String(rand(100,1000)), String(rand(100,1000)),
         adminIds.length ? pick(adminIds) : null,
         pick(["Compliance requirement","Performance tuning","Security hardening"]),
         daysAgo(rand(0,60))]);
    }

    // ── TIGERBEETLE_LEDGER_ENTRIES ────────────────────────────────────────────
    console.log("Seeding tigerbeetle_ledger_entries...");
    const tbStatuses = ["posted","posted","pending","voided"];
    for (let i = 0; i < 25; i++) {
      const amount = BigInt(rand(100000, 50000000));
      await client.query(
        `INSERT INTO tigerbeetle_ledger_entries
         (id, tb_id, debit_account_id, credit_account_id, amount, currency, entry_type,
          status, reference, declaration_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'NGN',$6,$7,$8,$9,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [uuid(), BigInt(rand(1000000,9999999)).toString(),
         `TB-ACC-${rand(1,10)}`, `TB-ACC-${rand(11,20)}`,
         amount.toString(), pick(["credit","debit"]), pick(tbStatuses),
         `TB-REF-${rand(100000,999999)}`, declIds.length ? pick(declIds) : null]);
    }

    console.log("\n✅ All tables seeded successfully!");
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error("Seed failed:", err); process.exit(1); });
