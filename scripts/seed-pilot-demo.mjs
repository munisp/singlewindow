/**
 * seed-pilot-demo.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Apapa Port 90-Day Pilot — Live-Demo Seed Script
 *
 * Creates:
 *   • 5 NCS (Nigeria Customs Service) officer accounts
 *   • 20 trader accounts (importers / exporters)
 *   • Registers all 25 as pilotParticipants with scope = "apapa_apmt"
 *   • Seeds 30 days of pilot reports (Day -29 → today) with realistic KPI data
 *   • Seeds 15 sample declarations linked to pilot traders
 *   • Seeds 10 confirmed payments linked to those declarations
 *
 * Usage:
 *   node scripts/seed-pilot-demo.mjs
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string (falls back to local dev default)
 */

import pg from "pg";
import crypto from "crypto";

// ── Connection ────────────────────────────────────────────────────────────────
// Use explicit params to avoid SSL/socket confusion with connection strings
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = parseInt(process.env.DB_PORT || "5432");
const DB_NAME = process.env.DB_NAME || "tradegateway";
const DB_USER = process.env.DB_USER || "tradegateway";
const DB_PASS = process.env.DB_PASS || "tradegateway_secure_2026";

const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  ssl: false,
  max: 5,
});

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── NCS Officer data ──────────────────────────────────────────────────────────
const NCS_OFFICERS = [
  { name: "Adeola Fashola",    email: "a.fashola@customs.gov.ng",   badge: "NCS-APT-001" },
  { name: "Emeka Okonkwo",     email: "e.okonkwo@customs.gov.ng",   badge: "NCS-APT-002" },
  { name: "Ngozi Eze",         email: "n.eze@customs.gov.ng",       badge: "NCS-APT-003" },
  { name: "Babatunde Lawal",   email: "b.lawal@customs.gov.ng",     badge: "NCS-APT-004" },
  { name: "Fatima Abdullahi",  email: "f.abdullahi@customs.gov.ng", badge: "NCS-APT-005" },
];

// ── Trader data ───────────────────────────────────────────────────────────────
const TRADERS = [
  { name: "Dangote Industries Ltd",        email: "trade@dangote.com",         rc: "RC-001234" },
  { name: "BUA Group",                     email: "imports@buagroup.com",      rc: "RC-002345" },
  { name: "Flour Mills of Nigeria",        email: "customs@flourmills.ng",     rc: "RC-003456" },
  { name: "Zenith Petroleum Ltd",          email: "ops@zenithpetro.ng",        rc: "RC-004567" },
  { name: "Coscharis Motors",              email: "imports@coscharis.ng",      rc: "RC-005678" },
  { name: "Stallion Group",                email: "trade@stalliongroup.ng",    rc: "RC-006789" },
  { name: "CFAO Nigeria",                  email: "customs@cfao.ng",           rc: "RC-007890" },
  { name: "Olam Nigeria",                  email: "imports@olam.ng",           rc: "RC-008901" },
  { name: "Somotex Nigeria",               email: "trade@somotex.ng",          rc: "RC-009012" },
  { name: "Promasidor Nigeria",            email: "imports@promasidor.ng",     rc: "RC-010123" },
  { name: "Chi Limited",                   email: "customs@chilimited.ng",     rc: "RC-011234" },
  { name: "Nestle Nigeria",                email: "imports@nestle.ng",         rc: "RC-012345" },
  { name: "Nigerian Breweries",            email: "trade@nbplc.ng",            rc: "RC-013456" },
  { name: "Guinness Nigeria",              email: "imports@guinness.ng",       rc: "RC-014567" },
  { name: "Unilever Nigeria",              email: "customs@unilever.ng",       rc: "RC-015678" },
  { name: "PZ Cussons Nigeria",            email: "trade@pzcussons.ng",        rc: "RC-016789" },
  { name: "Honeywell Flour Mills",         email: "imports@honeywell.ng",      rc: "RC-017890" },
  { name: "Vitafoam Nigeria",              email: "customs@vitafoam.ng",       rc: "RC-018901" },
  { name: "Lafarge Africa",                email: "imports@lafarge.ng",        rc: "RC-019012" },
  { name: "Cement Company of Northern NG", email: "trade@ccnn.ng",             rc: "RC-020123" },
];

const HS_CODES = [
  "8703.23", "8704.21", "2710.19", "1001.99", "1005.90",
  "8471.30", "8517.12", "3004.90", "7208.51", "4011.10",
  "2204.21", "0901.11", "0902.10", "8544.42", "7306.30",
];

const CORRIDORS = [
  { origin: "CHN", destination: "NGA" },
  { origin: "USA", destination: "NGA" },
  { origin: "DEU", destination: "NGA" },
  { origin: "IND", destination: "NGA" },
  { origin: "NGA", destination: "GHA" },
  { origin: "NGA", destination: "CIV" },
];

// ── Main seed function ────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("=== Apapa Port 90-Day Pilot — Live-Demo Seed ===\n");

    // ── 1. Upsert NCS officer users ─────────────────────────────────────────
    console.log("Creating 5 NCS officer accounts…");
    const officerIds = [];
    for (const o of NCS_OFFICERS) {
      const openId = `pilot-ncs-${o.badge.toLowerCase()}`;
      const res = await client.query(
        `INSERT INTO users (open_id, name, email, login_method, role, created_at, updated_at, last_signed_in)
         VALUES ($1, $2, $3, 'pilot_seed', 'customs_officer', NOW(), NOW(), NOW())
         ON CONFLICT (open_id) DO UPDATE
           SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, updated_at = NOW()
         RETURNING id`,
        [openId, o.name, o.email]
      );
      const userId = res.rows[0].id;
      officerIds.push(userId);

      // Upsert stakeholder profile (check first to avoid duplicate)
      const spExisting = await client.query(
        `SELECT id FROM stakeholder_profiles WHERE user_id = $1`, [userId]
      );
      if (spExisting.rows.length === 0) {
        await client.query(
          `INSERT INTO stakeholder_profiles
             (user_id, stakeholder_type, organization_name, organization_code, status, created_at, updated_at)
           VALUES ($1, 'customs_officer', 'Nigeria Customs Service', $2, 'approved', NOW(), NOW())`,
          [userId, o.badge]
        );
      }

      // Register as pilot participant
      const existing = await client.query(
        `SELECT id FROM pilot_participants WHERE user_id = $1`, [userId]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO pilot_participants
             (user_id, pilot_role, scope, organisation, contact_email, is_active, joined_at)
           VALUES ($1, 'ncs_officer', 'apapa_apmt', 'Nigeria Customs Service – Apapa', $2, true, NOW())`,
          [userId, o.email]
        );
      }
      console.log(`  ✓ Officer: ${o.name} (user_id=${userId})`);
    }

    // ── 2. Upsert trader users ──────────────────────────────────────────────
    console.log("\nCreating 20 trader accounts…");
    const traderIds = [];
    for (const t of TRADERS) {
      const openId = `pilot-trader-${t.rc.toLowerCase()}`;
      const res = await client.query(
        `INSERT INTO users (open_id, name, email, login_method, role, created_at, updated_at, last_signed_in)
         VALUES ($1, $2, $3, 'pilot_seed', 'user', NOW(), NOW(), NOW())
         ON CONFLICT (open_id) DO UPDATE
           SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
         RETURNING id`,
        [openId, t.name, t.email]
      );
      const userId = res.rows[0].id;
      traderIds.push(userId);

      // Upsert stakeholder profile (check first to avoid duplicate)
      const spExisting2 = await client.query(
        `SELECT id FROM stakeholder_profiles WHERE user_id = $1`, [userId]
      );
      if (spExisting2.rows.length === 0) {
        await client.query(
          `INSERT INTO stakeholder_profiles
             (user_id, stakeholder_type, organization_name, organization_code, tax_id, status, created_at, updated_at)
           VALUES ($1, 'trader', $2, $3, $3, 'approved', NOW(), NOW())`,
          [userId, t.name, t.rc]
        );
      }

      // Register as pilot participant
      const existing = await client.query(
        `SELECT id FROM pilot_participants WHERE user_id = $1`, [userId]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO pilot_participants
             (user_id, pilot_role, scope, organisation, contact_email, is_active, joined_at)
           VALUES ($1, 'trader', 'apapa_apmt', $2, $3, true, NOW())`,
          [userId, t.name, t.email]
        );
      }
      console.log(`  ✓ Trader: ${t.name} (user_id=${userId})`);
    }

    // ── 3. Seed 30 days of pilot reports ───────────────────────────────────
    console.log("\nSeeding 30 days of pilot reports…");
    const systemOfficer = officerIds[0];
    for (let day = 29; day >= 0; day--) {
      const reportDate = daysAgo(day);

      // Check if report already exists for this date
      const existing = await client.query(
        `SELECT id FROM pilot_reports WHERE DATE(report_date) = DATE($1)`,
        [reportDate]
      );
      if (existing.rows.length > 0) {
        console.log(`  ↷ Report for ${reportDate.toISOString().slice(0, 10)} already exists — skipping`);
        continue;
      }

      // Simulate realistic KPI progression (improving over time)
      const progressFactor = (30 - day) / 30; // 0 at start, 1 at end
      const totalDeclarations = rand(30, 60) + Math.floor(progressFactor * 20);
      const greenPct = 0.55 + progressFactor * 0.20; // 55% → 75%
      const greenLane = Math.floor(totalDeclarations * greenPct);
      const yellowLane = Math.floor(totalDeclarations * 0.25);
      const redLane = totalDeclarations - greenLane - yellowLane;

      // Avg clearance hours: starts at 5.5h, improves to 2.8h
      const avgClearanceHours = 5.5 - progressFactor * 2.7;
      const avgClearanceHoursX100 = Math.round(avgClearanceHours * 100);

      // Duty collected: ₦50M–₦180M per day (in kobo)
      const dutyNaira = (50_000_000 + rand(0, 130_000_000)) * (0.8 + progressFactor * 0.4);
      const totalDutyCollectedKobo = Math.round(dutyNaira * 100);

      // System uptime: 99.5%–99.99%
      const systemUptimePctX100 = rand(9950, 9999);

      await client.query(
        `INSERT INTO pilot_reports
           (report_date, total_declarations, green_lane, yellow_lane, red_lane,
            avg_clearance_hours_x100, total_duty_collected_kobo,
            active_traders, active_officers, system_uptime_pct_x100, generated_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          reportDate,
          totalDeclarations,
          greenLane,
          yellowLane,
          redLane,
          avgClearanceHoursX100,
          totalDutyCollectedKobo,
          rand(12, 20),   // active traders
          rand(3, 5),     // active officers
          systemUptimePctX100,
          systemOfficer,
          reportDate,
        ]
      );
      console.log(
        `  ✓ Report ${reportDate.toISOString().slice(0, 10)}: ` +
        `${totalDeclarations} decls, ${(greenPct * 100).toFixed(0)}% green, ` +
        `${avgClearanceHours.toFixed(1)}h avg, ₦${(dutyNaira / 1_000_000).toFixed(1)}M duty`
      );
    }

    // ── 4. Seed 15 sample declarations linked to pilot traders ─────────────
    console.log("\nSeeding 15 sample declarations…");
    const declIds = [];
    for (let i = 0; i < 15; i++) {
      const traderId = pick(traderIds);
      const corridor = pick(CORRIDORS);
      const hsCode = pick(HS_CODES);
      const lanes = ["green", "green", "green", "yellow", "red"];
      const riskLane = pick(lanes);
      const invoiceValue = rand(50_000, 5_000_000);
      const dutyRate = 0.05 + Math.random() * 0.15;
      const dutyAmount = Math.round(invoiceValue * dutyRate);
      const vatAmount = Math.round(invoiceValue * 0.075);
      const declNumber = `APT-${Date.now()}-${String(i + 1).padStart(3, "0")}`;
      const ucr = `UCR-NGAPP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const statuses = ["cleared", "cleared", "cleared", "payment_confirmed", "under_examination"];
      const status = pick(statuses);
      const submittedAt = daysAgo(rand(1, 28));
      const clearedAt = status === "cleared" ? new Date(submittedAt.getTime() + rand(2, 6) * 3_600_000) : null;

      const res = await client.query(
        `INSERT INTO declarations
           (declaration_number, ucr, trader_id, declaration_type, status, risk_lane,
            risk_score, hs_code, goods_description, country_of_origin, country_of_destination,
            port_of_entry, gross_weight, net_weight, number_of_packages,
            invoice_value, invoice_currency, duty_amount, vat_amount, total_due,
            submitted_at, cleared_at, created_at, updated_at)
         VALUES ($1,$2,$3,'import',$4,$5,$6,$7,$8,$9,$10,'NGAPP',$11,$12,$13,$14,'NGN',$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (declaration_number) DO NOTHING
         RETURNING id`,
        [
          declNumber, ucr, traderId, status, riskLane,
          (Math.random() * 0.9).toFixed(2),
          hsCode,
          `Pilot cargo shipment — HS ${hsCode}`,
          corridor.origin, corridor.destination,
          (rand(500, 50_000) / 10).toFixed(1),   // gross weight
          (rand(400, 45_000) / 10).toFixed(1),   // net weight
          rand(1, 100),                            // packages
          invoiceValue.toFixed(2),
          dutyAmount.toFixed(2),
          vatAmount.toFixed(2),
          (dutyAmount + vatAmount).toFixed(2),
          submittedAt,
          clearedAt,
          submittedAt,
          submittedAt,
        ]
      );
      if (res.rows[0]) {
        declIds.push({ id: res.rows[0].id, traderId, amount: dutyAmount + vatAmount, status });
        console.log(`  ✓ Declaration ${declNumber} (${riskLane} lane, ${status})`);
      }
    }

    // ── 5. Seed 10 confirmed payments ───────────────────────────────────────
    console.log("\nSeeding 10 confirmed payments…");
    const clearedDecls = declIds.filter(d => d.status === "cleared" || d.status === "payment_confirmed");
    for (let i = 0; i < Math.min(10, clearedDecls.length); i++) {
      const decl = clearedDecls[i];
      const methods = ["bank_transfer", "mobile_money", "card"];
      const method = pick(methods);
      const ref = `PAY-APT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      await client.query(
        `INSERT INTO payments
           (declaration_id, trader_id, amount, currency, payment_method, status,
            reference, confirmed_at, created_at, updated_at)
         VALUES ($1,$2,$3,'NGN',$4,'confirmed',$5,NOW(),NOW(),NOW())`,
        [decl.id, decl.traderId, decl.amount.toFixed(2), method, ref]
      );
      console.log(`  ✓ Payment ${ref}: ₦${(decl.amount / 1000).toFixed(1)}K (${method})`);
    }

    await client.query("COMMIT");

    console.log("\n=== Seed complete ===");
    console.log(`  NCS officers created/updated: ${NCS_OFFICERS.length}`);
    console.log(`  Traders created/updated:      ${TRADERS.length}`);
    console.log(`  Pilot participants registered: ${NCS_OFFICERS.length + TRADERS.length}`);
    console.log(`  Pilot reports seeded:          30 days`);
    console.log(`  Sample declarations:           ${declIds.length}`);
    console.log(`  Confirmed payments:            ${Math.min(10, clearedDecls.length)}`);
    console.log("\nThe Pilot Dashboard at /app/pilot will now show real KPI data.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
