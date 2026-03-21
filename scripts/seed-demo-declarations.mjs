/**
 * seed-demo-declarations.mjs
 * Seeds 30 demo declarations for the 6 core demo users (Amara Diallo + Tunde Adeyemi)
 * plus payments and OGA permits for a fully functional demo experience.
 */
import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 5432,
  database: "tradegateway",
  user: "tradegateway",
  password: "tradegateway_secure_2026",
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
  return d;
}

const HS_CODES = [
  { code: "8703.23", desc: "Motor vehicles for transport of persons (1500-3000cc)" },
  { code: "8704.21", desc: "Motor vehicles for goods transport (diesel, ≤5t)" },
  { code: "2710.19", desc: "Petroleum oils and preparations" },
  { code: "1001.99", desc: "Wheat and meslin, other" },
  { code: "8471.30", desc: "Portable automatic data processing machines" },
  { code: "8517.12", desc: "Telephones for cellular networks (smartphones)" },
  { code: "3004.90", desc: "Medicaments for therapeutic/prophylactic use" },
  { code: "7208.51", desc: "Flat-rolled products of iron, hot-rolled, ≥10mm" },
  { code: "4011.10", desc: "New pneumatic tyres for motor cars" },
  { code: "0901.11", desc: "Coffee, not roasted, not decaffeinated" },
];

const CORRIDORS = [
  { origin: "CHN", destination: "NGA" },
  { origin: "USA", destination: "NGA" },
  { origin: "DEU", destination: "NGA" },
  { origin: "IND", destination: "NGA" },
  { origin: "GBR", destination: "NGA" },
  { origin: "NGA", destination: "GHA" },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("=== Demo Declarations Seed ===\n");

    // Demo user IDs
    const AMARA_ID = 86;   // demo-trader
    const TUNDE_ID = 91;   // demo-developer
    const KWAME_ID = 87;   // demo-customs (officer)
    const FATIMA_ID = 88;  // demo-oga (OGA officer)

    // Check existing declarations
    const existing = await client.query("SELECT COUNT(*) FROM declarations WHERE trader_id IN ($1, $2)", [AMARA_ID, TUNDE_ID]);
    if (parseInt(existing.rows[0].count) > 0) {
      console.log(`  ↷ ${existing.rows[0].count} declarations already exist for demo traders — skipping`);
      await client.query("ROLLBACK");
      return;
    }

    const declIds = [];

    // Seed 20 declarations for Amara Diallo (demo-trader)
    console.log("Seeding 20 declarations for Amara Diallo (demo-trader)…");
    for (let i = 0; i < 20; i++) {
      const hs = pick(HS_CODES);
      const corridor = pick(CORRIDORS);
      const lanes = ["green", "green", "green", "yellow", "red"];
      const riskLane = pick(lanes);
      const invoiceValue = rand(100_000, 8_000_000);
      const dutyRate = 0.05 + Math.random() * 0.20;
      const dutyAmount = Math.round(invoiceValue * dutyRate);
      const vatAmount = Math.round(invoiceValue * 0.075);
      const statuses = ["cleared", "cleared", "cleared", "payment_pending", "under_examination", "submitted"];
      const status = i < 3 ? "submitted" : pick(statuses);
      const submittedAt = daysAgo(rand(1, 60));
      const clearedAt = status === "cleared" ? new Date(submittedAt.getTime() + rand(2, 8) * 3_600_000) : null;
      const declNumber = `NGSWTP-2026-${String(10000 + i + 1).padStart(5, "0")}`;
      const ucr = `UCR-NGLAG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      await client.query(`SET LOCAL app.current_user_id = '${AMARA_ID}'`);
      await client.query(`SET LOCAL app.current_user_role = 'user'`);

      const res = await client.query(
        `INSERT INTO declarations
           (declaration_number, ucr, trader_id, declaration_type, status, risk_lane,
            risk_score, hs_code, goods_description, country_of_origin, country_of_destination,
            port_of_entry, gross_weight, net_weight, number_of_packages,
            invoice_value, invoice_currency, duty_amount, vat_amount, total_due,
            submitted_at, cleared_at, created_at, updated_at)
         VALUES ($1,$2,$3,'import',$4,$5,$6,$7,$8,$9,$10,'NGLAG',$11,$12,$13,$14,'NGN',$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (declaration_number) DO NOTHING
         RETURNING id`,
        [
          declNumber, ucr, AMARA_ID, status, riskLane,
          (Math.random() * 0.95).toFixed(4),
          hs.code, hs.desc,
          corridor.origin, corridor.destination,
          (rand(500, 50_000) / 10).toFixed(1),
          (rand(400, 45_000) / 10).toFixed(1),
          rand(1, 200),
          invoiceValue.toFixed(2),
          dutyAmount.toFixed(2),
          vatAmount.toFixed(2),
          (dutyAmount + vatAmount).toFixed(2),
          submittedAt, clearedAt, submittedAt, submittedAt,
        ]
      );
      if (res.rows[0]) {
        declIds.push({ id: res.rows[0].id, traderId: AMARA_ID, amount: dutyAmount + vatAmount, status, riskLane });
        console.log(`  ✓ ${declNumber} (${riskLane}, ${status})`);
      }
    }

    // Seed 10 declarations for Tunde Adeyemi (demo-developer)
    console.log("\nSeeding 10 declarations for Tunde Adeyemi (demo-developer)…");
    for (let i = 0; i < 10; i++) {
      const hs = pick(HS_CODES);
      const corridor = pick(CORRIDORS);
      const lanes = ["green", "green", "yellow", "red"];
      const riskLane = pick(lanes);
      const invoiceValue = rand(200_000, 5_000_000);
      const dutyRate = 0.05 + Math.random() * 0.15;
      const dutyAmount = Math.round(invoiceValue * dutyRate);
      const vatAmount = Math.round(invoiceValue * 0.075);
      const statuses = ["cleared", "cleared", "payment_pending", "under_examination"];
      const status = pick(statuses);
      const submittedAt = daysAgo(rand(1, 45));
      const clearedAt = status === "cleared" ? new Date(submittedAt.getTime() + rand(2, 6) * 3_600_000) : null;
      const declNumber = `NGSWTP-2026-${String(10020 + i + 1).padStart(5, "0")}`;
      const ucr = `UCR-NGLAG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      await client.query(`SET LOCAL app.current_user_id = '${TUNDE_ID}'`);
      await client.query(`SET LOCAL app.current_user_role = 'user'`);

      const res = await client.query(
        `INSERT INTO declarations
           (declaration_number, ucr, trader_id, declaration_type, status, risk_lane,
            risk_score, hs_code, goods_description, country_of_origin, country_of_destination,
            port_of_entry, gross_weight, net_weight, number_of_packages,
            invoice_value, invoice_currency, duty_amount, vat_amount, total_due,
            submitted_at, cleared_at, created_at, updated_at)
         VALUES ($1,$2,$3,'import',$4,$5,$6,$7,$8,$9,$10,'NGLAG',$11,$12,$13,$14,'NGN',$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (declaration_number) DO NOTHING
         RETURNING id`,
        [
          declNumber, ucr, TUNDE_ID, status, riskLane,
          (Math.random() * 0.95).toFixed(4),
          hs.code, hs.desc,
          corridor.origin, corridor.destination,
          (rand(500, 30_000) / 10).toFixed(1),
          (rand(400, 28_000) / 10).toFixed(1),
          rand(1, 100),
          invoiceValue.toFixed(2),
          dutyAmount.toFixed(2),
          vatAmount.toFixed(2),
          (dutyAmount + vatAmount).toFixed(2),
          submittedAt, clearedAt, submittedAt, submittedAt,
        ]
      );
      if (res.rows[0]) {
        declIds.push({ id: res.rows[0].id, traderId: TUNDE_ID, amount: dutyAmount + vatAmount, status, riskLane });
        console.log(`  ✓ ${declNumber} (${riskLane}, ${status})`);
      }
    }

    // Seed payments for cleared declarations
    console.log("\nSeeding payments for cleared declarations…");
    const clearedDecls = declIds.filter(d => d.status === "cleared" || d.status === "payment_pending");
    for (const decl of clearedDecls) {
      await client.query(`SET LOCAL app.current_user_id = '${decl.traderId}'`);
      await client.query(`SET LOCAL app.current_user_role = 'user'`);
      const methods = ["bank_transfer", "mobile_money", "card"];
      const method = pick(methods);
      const ref = `PAY-NGLAG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const payStatus = decl.status === "cleared" ? "confirmed" : "pending";
      await client.query(
        `INSERT INTO payments
           (declaration_id, trader_id, amount, currency, payment_method, status,
            reference, confirmed_at, created_at, updated_at)
         VALUES ($1,$2,$3,'NGN',$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [decl.id, decl.traderId, decl.amount.toFixed(2), method, payStatus, ref,
         payStatus === "confirmed" ? new Date() : null]
      );
      console.log(`  ✓ Payment ${ref}: ₦${(decl.amount / 1000).toFixed(1)}K (${method}, ${payStatus})`);
    }

    // Seed OGA permit requests for some declarations
    console.log("\nSeeding OGA permit requests…");
    const ogaDecls = declIds.slice(0, 8);
    const agencies = [
      { code: "NAFDAC", name: "National Agency for Food & Drug Administration" },
      { code: "SON",    name: "Standards Organisation of Nigeria" },
      { code: "NPC",    name: "Nigerian Ports Commission" },
      { code: "NESREA", name: "National Environmental Standards Agency" },
      { code: "DPR",    name: "Department of Petroleum Resources" },
    ];
    const permitTypes = ["import_permit", "phytosanitary_cert", "conformity_assessment", "environmental_clearance"];
    for (const decl of ogaDecls) {
      const agency = pick(agencies);
      const permitType = pick(permitTypes);
      const ogaStatuses = ["pending", "pending", "approved", "approved", "rejected"];
      const ogaStatus = pick(ogaStatuses);
      const slaDeadline = new Date(Date.now() + 3 * 24 * 3_600_000);
      await client.query(
        `INSERT INTO oga_permits
           (declaration_id, agency_code, agency_name, permit_type, status,
            assigned_officer_id, responded_at, sla_deadline, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [
          decl.id, agency.code, agency.name, permitType, ogaStatus,
          ogaStatus !== "pending" ? FATIMA_ID : null,
          ogaStatus !== "pending" ? new Date() : null,
          slaDeadline,
        ]
      );
      console.log(`  ✓ OGA permit: ${agency.code} ${permitType} (${ogaStatus})`);
    }

    await client.query("COMMIT");

    console.log("\n=== Demo seed complete ===");
    console.log(`  Declarations seeded: ${declIds.length}`);
    console.log(`  Payments seeded: ${clearedDecls.length}`);
    console.log(`  OGA permits seeded: ${ogaDecls.length}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed — rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
