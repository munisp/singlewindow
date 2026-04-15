/**
 * seed-comprehensive.mjs
 * TradeGateway NGSWTP — Comprehensive Production Seed Script
 * Seeds ALL database tables with realistic, industry-accurate data.
 * Column names match the actual PostgreSQL schema exactly.
 * Usage: DATABASE_URL="postgresql://..." node scripts/seed-comprehensive.mjs
 */
import pg from "pg";
import crypto from "crypto";

const LOCAL_PG = "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_PG;

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
});

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function uuid() { return crypto.randomUUID(); }

const HS_CODES = [
  { code: "8703.23", desc: "Motor vehicles for transport of persons (1500-3000cc)", duty: 35 },
  { code: "8704.21", desc: "Motor vehicles for goods transport (diesel)", duty: 20 },
  { code: "2710.19", desc: "Petroleum oils and preparations", duty: 5 },
  { code: "1001.99", desc: "Wheat and meslin, other", duty: 5 },
  { code: "8471.30", desc: "Portable automatic data processing machines", duty: 0 },
  { code: "8517.12", desc: "Telephones for cellular networks (smartphones)", duty: 10 },
  { code: "3004.90", desc: "Medicaments for therapeutic/prophylactic use", duty: 0 },
  { code: "7208.51", desc: "Flat-rolled products of iron, hot-rolled", duty: 10 },
  { code: "4011.10", desc: "New pneumatic tyres for motor cars", duty: 20 },
  { code: "0901.11", desc: "Coffee, not roasted, not decaffeinated", duty: 5 },
  { code: "2204.21", desc: "Wine of fresh grapes in containers ≤2L", duty: 20 },
  { code: "6110.20", desc: "Jerseys, pullovers of cotton", duty: 35 },
  { code: "9403.20", desc: "Metal furniture, other", duty: 20 },
  { code: "8544.42", desc: "Electrical conductors, fitted with connectors", duty: 10 },
  { code: "3901.10", desc: "Polyethylene having specific gravity < 0.94", duty: 5 },
];

const CORRIDORS = [
  { origin: "CHN", destination: "NGA", port: "APAPA" },
  { origin: "USA", destination: "NGA", port: "TINCAN" },
  { origin: "DEU", destination: "NGA", port: "APAPA" },
  { origin: "IND", destination: "NGA", port: "ONNE" },
  { origin: "GBR", destination: "NGA", port: "APAPA" },
  { origin: "NGA", destination: "GHA", port: "TEMA" },
  { origin: "NGA", destination: "CMR", port: "DOUALA" },
  { origin: "BEL", destination: "NGA", port: "APAPA" },
];

const VESSEL_NAMES = [
  "MSC CELESTINO", "EVER GIVEN", "COSCO SHIPPING ARIES", "MAERSK ELBA",
  "CMA CGM MARCO POLO", "HAPAG-LLOYD BERLIN", "ONE INNOVATION", "YANG MING WITNESS",
  "EVERGREEN EVER ACE", "OOCL HONG KONG", "MSC GULSUN", "MADRID MAERSK",
];

const COMPANY_NAMES = [
  "Dangote Industries Ltd", "BUA Group", "Flour Mills of Nigeria", "Nigerian Breweries",
  "Nestle Nigeria", "Unilever Nigeria", "Total Energies Nigeria", "Coscharis Motors",
  "Innoson Vehicle Manufacturing", "Zenith Bank", "Access Bank", "GTBank",
];

const TRADER_NAMES = [
  { first: "Amara", last: "Diallo", company: "Diallo Trading Co." },
  { first: "Tunde", last: "Adeyemi", company: "Adeyemi Imports Ltd" },
  { first: "Chioma", last: "Okonkwo", company: "Okonkwo Global Logistics" },
  { first: "Kwame", last: "Asante", company: "Asante Brothers Ltd" },
  { first: "Fatou", last: "Sow", company: "Sow Commodities" },
];

const OFFICER_NAMES = [
  { first: "Chukwuemeka", last: "Okafor", role: "admin" },
  { first: "Fatima", last: "Bello", role: "admin" },
  { first: "Ngozi", last: "Eze", role: "user" },
];

const OGA_AGENCIES = [
  { code: "NAFDAC", name: "National Agency for Food and Drug Administration and Control", type: "food_drugs" },
  { code: "SON", name: "Standards Organisation of Nigeria", type: "standards" },
  { code: "NESREA", name: "National Environmental Standards and Regulations Enforcement Agency", type: "environment" },
  { code: "NIS", name: "Nigeria Immigration Service", type: "immigration" },
  { code: "NSCDC", name: "Nigeria Security and Civil Defence Corps", type: "security" },
  { code: "CBN", name: "Central Bank of Nigeria", type: "finance" },
  { code: "FIRS", name: "Federal Inland Revenue Service", type: "tax" },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log("=== TradeGateway NGSWTP Comprehensive Seed ===\n");
    console.log(`Database: ${DATABASE_URL.replace(/:([^:@]+)@/, ':***@')}\n`);

    // ── 1. Users ──────────────────────────────────────────────────────────────
    console.log("1. Seeding users...");
    const userIds = {};
    const allUsers = [
      ...TRADER_NAMES.map((t, i) => ({
        openId: `trader-${i + 1}-demo`,
        name: `${t.first} ${t.last}`,
        email: `${t.first.toLowerCase()}.${t.last.toLowerCase()}@demo.tradegateway.ng`,
        role: "user",
      })),
      ...OFFICER_NAMES.map((o, i) => ({
        openId: `officer-${i + 1}-demo`,
        name: `${o.first} ${o.last}`,
        email: `${o.first.toLowerCase()}.${o.last.toLowerCase()}@ncs.gov.ng`,
        role: o.role,
      })),
      { openId: "admin-001-demo", name: "System Administrator", email: "admin@tradegateway.ng", role: "admin" },
      // Required demo open_ids for demoAuth.ts role-based login
      { openId: "demo-trader",    name: "Amara Diallo",     email: "amara.diallo@demo.tradegateway.ng",    role: "user"  },
      { openId: "demo-customs",   name: "Kwame Asante",     email: "kwame.asante@demo.customs.gov.ng",     role: "admin" },
      { openId: "demo-oga",       name: "Fatima Al-Hassan", email: "fatima.alhassan@demo.nafdac.gov.ng",   role: "user"  },
      { openId: "demo-admin",     name: "Chidi Okonkwo",    email: "chidi.okonkwo@demo.tradegateway.ng",   role: "admin" },
      { openId: "demo-security",  name: "Ngozi Eze",        email: "ngozi.eze@demo.tradegateway.ng",       role: "admin" },
      { openId: "demo-developer", name: "Tunde Adeyemi",    email: "tunde.adeyemi@demo.devportal.ng",      role: "user"  },
    ];
    for (const u of allUsers) {
      const res = await client.query(
        `INSERT INTO users (open_id, name, email, role, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (open_id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email
         RETURNING id`,
        [u.openId, u.name, u.email, u.role]
      );
      userIds[u.openId] = res.rows[0].id;
    }
    console.log(`   ✓ ${allUsers.length} users`);

    // ── 2. Stakeholder Profiles ───────────────────────────────────────────────
    // Columns: id, user_id, stakeholder_type, organization_name, organization_code,
    //          license_number, tax_id, country, phone, status, aeo_status, aeo_tier,
    //          approved_by, approved_at, rejection_reason, metadata, created_at, updated_at
    console.log("2. Seeding stakeholder profiles...");
    for (let i = 0; i < TRADER_NAMES.length; i++) {
      const t = TRADER_NAMES[i];
      const uid = userIds[`trader-${i + 1}-demo`];
      if (!uid) continue;
      await client.query(
        `INSERT INTO stakeholder_profiles
           (user_id, stakeholder_type, organization_name, organization_code,
            license_number, tax_id, country, phone, status, aeo_status, aeo_tier, created_at, updated_at)
         VALUES ($1,'trader',$2,$3,$4,$5,'NGA',$6,'approved',$7,$8,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [
          uid,
          t.company,
          `ORG-${String(10000 + i).padStart(5, "0")}`,
          `LIC-${String(20000 + i).padStart(6, "0")}`,
          `NG${String(20000001 + i).padStart(8, "0")}`,
          `+234${rand(700, 909)}${rand(1000000, 9999999)}`,
          pick(["none", "none", "applied", "certified"]),
          pick(["standard", "standard", "silver"]),
        ]
      );
    }
    // Officer profiles
    for (let i = 0; i < OFFICER_NAMES.length; i++) {
      const uid = userIds[`officer-${i + 1}-demo`];
      if (!uid) continue;
      await client.query(
        `INSERT INTO stakeholder_profiles
           (user_id, stakeholder_type, organization_name, organization_code,
            license_number, tax_id, country, phone, status, aeo_status, created_at, updated_at)
         VALUES ($1,'customs_officer','Nigeria Customs Service','NCS',
                 $2,$3,'NGA',$4,'approved','none',NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [uid,
         `NCS-OFF-${String(1000 + i).padStart(4, "0")}`,
         `NG-GOV-${String(9000 + i).padStart(6, "0")}`,
         `+234${rand(700, 909)}${rand(1000000, 9999999)}`]
      );
    }
    console.log(`   ✓ ${TRADER_NAMES.length + OFFICER_NAMES.length} stakeholder profiles`);

    // ── 3. Port Locations ─────────────────────────────────────────────────────
    // Columns: id, port_code, port_name, country, latitude, longitude, port_type, is_active, created_at
    console.log("3. Seeding port locations...");
    const ports = [
      ["APAPA", "Apapa Port", "NGA", 6.4474, 3.3903, "seaport"],
      ["TINCAN", "Tin Can Island Port", "NGA", 6.4350, 3.3500, "seaport"],
      ["ONNE", "Onne Port", "NGA", 4.7167, 7.1833, "seaport"],
      ["WARRI", "Warri Port", "NGA", 5.5167, 5.7500, "seaport"],
      ["CALABAR", "Calabar Port", "NGA", 4.9500, 8.3333, "seaport"],
      ["TEMA", "Tema Port", "GHA", 5.6333, -0.0167, "seaport"],
      ["DOUALA", "Douala Port", "CMR", 4.0500, 9.7000, "seaport"],
      ["LAGOS_AIR", "Murtala Muhammed Airport", "NGA", 6.5774, 3.3213, "airport"],
      ["ABJ_AIR", "Nnamdi Azikiwe Airport", "NGA", 9.0068, 7.2632, "airport"],
      ["SEME", "Seme Border", "NGA", 6.3500, 2.7167, "land_border"],
    ];
    for (const [code, name, country, lat, lng, type] of ports) {
      await client.query(
        `INSERT INTO port_locations (port_code, port_name, country, latitude, longitude, port_type, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,NOW()) ON CONFLICT DO NOTHING`,
        [code, name, country, lat, lng, type]
      );
    }
    console.log(`   ✓ ${ports.length} port locations`);

    // ── 4. Declarations (50) ──────────────────────────────────────────────────
    // Columns: id, declaration_number, ucr, trader_id, declaration_type, status, risk_lane,
    //          risk_score, hs_code, goods_description, country_of_origin, country_of_destination,
    //          port_of_entry, gross_weight, net_weight, number_of_packages, invoice_value,
    //          invoice_currency, duty_amount, vat_amount, levy_amount, total_due,
    //          assigned_officer_id, ai_explanation, sanctions_flags, submitted_at, cleared_at,
    //          created_at, updated_at
    console.log("4. Seeding 50 declarations...");
    const statuses = [
      "draft", "submitted", "under_assessment", "docs_required",
      "payment_pending", "cleared", "cleared", "cleared",
      "rejected", "under_examination",
    ];
    const declarationIds = [];
    const traderUserIds = TRADER_NAMES.map((_, i) => userIds[`trader-${i + 1}-demo`]).filter(Boolean);
    const officerUserId = userIds["officer-1-demo"];

    for (let i = 0; i < 50; i++) {
      const hs = pick(HS_CODES);
      const corridor = pick(CORRIDORS);
      const status = pick(statuses);
      const invoiceValue = rand(500000, 50000000);
      const dutyAmount = Math.floor(invoiceValue * hs.duty / 100);
      const vatAmount = Math.floor(invoiceValue * 0.075); // 7.5% VAT
      const levyAmount = Math.floor(invoiceValue * 0.01); // 1% CISS levy
      const totalDue = dutyAmount + vatAmount + levyAmount;
      const lane = status === "cleared" ? pick(["green", "green", "yellow"]) :
                   status === "under_examination" ? "red" :
                   status === "under_assessment" ? "yellow" : null;
      const traderId = pick(traderUserIds);
      const year = new Date().getFullYear();
      const res = await client.query(
        `INSERT INTO declarations
           (declaration_number, ucr, trader_id, declaration_type, status, risk_lane, risk_score,
            hs_code, goods_description, country_of_origin, country_of_destination, port_of_entry,
            gross_weight, net_weight, number_of_packages, invoice_value, invoice_currency,
            duty_amount, vat_amount, levy_amount, total_due, assigned_officer_id,
            ai_explanation, submitted_at, cleared_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),NOW())
         RETURNING id`,
        [
          `NG${year}${String(Date.now() % 1000000 + i).padStart(7, "0")}`,
          `UCR-${year}-${uuid().slice(0, 12).toUpperCase()}`,
          traderId,
          pick(["import", "import", "import", "export", "transit"]),
          status, lane, rand(5, 95),
          hs.code,
          `${hs.desc} — ${pick(COMPANY_NAMES)}`,
          corridor.origin, corridor.destination, corridor.port,
          rand(500, 50000), rand(400, 45000), rand(1, 500),
          invoiceValue, "NGN",
          dutyAmount, vatAmount, levyAmount, totalDue,
          status === "under_examination" ? officerUserId : null,
          JSON.stringify({ summary: `Risk assessment based on WCO SAFE Framework. HS ${hs.code} classified with ${rand(85, 99)}% confidence.`, model: 'deepseek-r1', score: rand(5, 95) }),
          daysAgo(rand(1, 90)),
          status === "cleared" ? daysAgo(rand(0, 30)) : null,
        ]
      );
      declarationIds.push({ id: res.rows[0].id, status, dutyAmount, totalDue, traderId, hsCode: hs.code });
    }
    console.log("   ✓ 50 declarations");

    // ── 5. Payments ───────────────────────────────────────────────────────────
    // Columns: id, declaration_id, trader_id, amount, currency, payment_method, status,
    //          mojaloop_transfer_id, tigerbeetle_account_id, reference, confirmed_at,
    //          failure_reason, created_at, updated_at
    console.log("5. Seeding payments...");
    let payCount = 0;
    for (const decl of declarationIds.filter(d => ["cleared", "payment_pending"].includes(d.status))) {
      const isPaid = decl.status === "cleared";
      await client.query(
        `INSERT INTO payments
           (declaration_id, trader_id, amount, currency, payment_method, status,
            mojaloop_transfer_id, tigerbeetle_account_id, reference, confirmed_at, created_at, updated_at)
         VALUES ($1,$2,$3,'NGN',$4,$5,$6,$7,$8,$9,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          decl.id, decl.traderId, decl.totalDue,
          pick(["bank_transfer", "mobile_money", "card"]),
          isPaid ? "confirmed" : "pending",
          isPaid ? `MJL-${uuid().slice(0, 16).toUpperCase()}` : null,
          isPaid ? `TB-${rand(100000, 999999)}` : null,
          `PAY-${uuid().slice(0, 12).toUpperCase()}`,
          isPaid ? daysAgo(rand(0, 30)) : null,
        ]
      );
      payCount++;
    }
    console.log(`   ✓ ${payCount} payments`);

    // ── 6. OGA Permits ────────────────────────────────────────────────────────
    // Columns: id, declaration_id, agency_code, agency_name, permit_type, status,
    //          assigned_officer_id, review_notes, permit_number, expires_at, sla_deadline,
    //          responded_at, created_at, updated_at
    console.log("6. Seeding OGA permits...");
    let ogaCount = 0;
    const clearedDecls = declarationIds.filter(d => d.status === "cleared").slice(0, 15);
    for (const decl of clearedDecls) {
      const agency = pick(OGA_AGENCIES);
      await client.query(
        `INSERT INTO oga_permits
           (declaration_id, agency_code, agency_name, permit_type, status,
            assigned_officer_id, review_notes, permit_number, expires_at, sla_deadline,
            responded_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'approved',$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          decl.id, agency.code, agency.name, agency.type,
          officerUserId,
          "All documentation verified. Permit approved.",
          `${agency.code}-${new Date().getFullYear()}-${rand(10000, 99999)}`,
          daysFromNow(rand(90, 365)),
          daysAgo(rand(1, 5)),
          daysAgo(rand(0, 3)),
        ]
      );
      ogaCount++;
    }
    console.log(`   ✓ ${ogaCount} OGA permits`);

    // ── 7. Clearance Certificates ─────────────────────────────────────────────
    // Columns: id, declaration_id, trader_id, file_key, file_url, declaration_ref,
    //          goods_description, total_duty_paid, currency, cleared_at, generated_by, generated_at
    console.log("7. Seeding clearance certificates...");
    let certCount = 0;
    for (const decl of clearedDecls.slice(0, 10)) {
      const hs = pick(HS_CODES);
      await client.query(
        `INSERT INTO clearance_certificates
           (declaration_id, trader_id, file_key, file_url, declaration_ref,
            goods_description, total_duty_paid, currency, cleared_at, generated_by, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'NGN',$8,$9,$10) ON CONFLICT DO NOTHING`,
        [
          decl.id, decl.traderId,
          `certs/${uuid()}.pdf`,
          `https://storage.tradegateway.ng/certs/${uuid()}.pdf`,
          `NG${new Date().getFullYear()}${String(1000 + certCount).padStart(6, "0")}`,
          hs.desc,
          decl.totalDue,
          daysAgo(rand(0, 30)),
          officerUserId,
          daysAgo(rand(0, 30)),
        ]
      );
      certCount++;
    }
    console.log(`   ✓ ${certCount} clearance certificates`);

    // ── 8. Vessel Tracking Events ─────────────────────────────────────────────
    // Columns: id, mmsi, vessel_name, imo_number, latitude, longitude, speed, heading,
    //          destination_port, eta, cargo_type, flag_country, recorded_at
    console.log("8. Seeding vessel tracking events...");
    const mmsiBase = 636000000;
    for (let i = 0; i < 20; i++) {
      const vessel = pick(VESSEL_NAMES);
      const port = pick(["APAPA", "TINCAN", "ONNE", "TEMA"]);
      await client.query(
        `INSERT INTO vessel_tracking_events
           (mmsi, vessel_name, imo_number, latitude, longitude, speed, heading,
            destination_port, eta, cargo_type, flag_country, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [
          mmsiBase + i,
          vessel,
          `IMO${rand(1000000, 9999999)}`,
          (6.4 + (Math.random() - 0.5) * 2).toFixed(4),
          (3.4 + (Math.random() - 0.5) * 2).toFixed(4),
          (Math.random() * 20).toFixed(1),
          rand(0, 359),
          port,
          daysFromNow(rand(1, 14)),
          pick(["general_cargo", "container", "bulk", "tanker", "ro_ro"]),
          pick(["NGA", "PAN", "LBR", "MHL", "BHS", "CYP"]),
          daysAgo(rand(0, 2)),
        ]
      );
    }
    console.log("   ✓ 20 vessel tracking events");

    // ── 9. Sanctions Checks ───────────────────────────────────────────────────
    // Columns: id, declaration_id, entity_name, entity_type, check_result, lists_checked,
    //          match_details, checked_by, override_reason, created_at
    console.log("9. Seeding sanctions checks...");
    for (let i = 0; i < 20; i++) {
      const decl = pick(declarationIds);
      await client.query(
        `INSERT INTO sanctions_checks
           (declaration_id, entity_name, entity_type, check_result, lists_checked,
            match_details, checked_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
        [
          decl.id,
          pick(COMPANY_NAMES),
          pick(["company", "individual", "vessel"]),
          pick(["clear", "clear", "clear", "potential_match"]),
          JSON.stringify(["OFAC_SDN", "UN_CONSOLIDATED", "EU_CONSOLIDATED", "INTERPOL"]),
          null,
          officerUserId,
        ]
      );
    }
    console.log("   ✓ 20 sanctions checks");

    // ── 10. AEO Applications ──────────────────────────────────────────────────
    // Columns: id, trader_id, application_number, tier, status, self_assessment_score,
    //          compliance_score, financial_standing_score, security_score, reviewer_notes,
    //          assigned_reviewer_id, inspection_date, certificate_number,
    //          certificate_issued_at, certificate_expires_at, created_at, updated_at
    console.log("10. Seeding AEO applications...");
    for (let i = 0; i < 5; i++) {
      const uid = userIds[`trader-${(i % TRADER_NAMES.length) + 1}-demo`];
      if (!uid) continue;
      const status = pick(["submitted", "under_review", "approved", "rejected"]);
      await client.query(
        `INSERT INTO aeo_applications
           (trader_id, application_number, tier, status, self_assessment_score,
            compliance_score, financial_standing_score, security_score,
            reviewer_notes, assigned_reviewer_id, inspection_date,
            certificate_number, certificate_issued_at, certificate_expires_at,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          uid,
          `AEO-${new Date().getFullYear()}-${String(1000 + i).padStart(4, "0")}`,
          pick(["standard", "silver", "gold"]),
          status,
          rand(60, 100), rand(65, 100), rand(70, 100), rand(75, 100),
          status === "approved" ? "All criteria met. Certificate issued." :
          status === "rejected" ? "Financial standing score below minimum threshold." : null,
          officerUserId,
          daysAgo(rand(10, 30)),
          status === "approved" ? `AEO-CERT-${rand(10000, 99999)}` : null,
          status === "approved" ? daysAgo(rand(1, 10)) : null,
          status === "approved" ? daysFromNow(rand(365, 730)) : null,
        ]
      );
    }
    console.log("   ✓ 5 AEO applications");

    // ── 11. KYC Documents ─────────────────────────────────────────────────────
    // Columns: id, user_id, document_type, filename, file_key, file_url, file_size,
    //          content_type, status, analysis_result, ocr_confidence, authenticity_score,
    //          authenticity_verdict, analysed_at, created_at
    console.log("11. Seeding KYC documents...");
    const kycTypes = ["business_registration", "tax_certificate", "certificate_of_incorporation", "utility_bill", "bank_statement", "passport"];
    let kycCount = 0;
    for (let i = 0; i < TRADER_NAMES.length; i++) {
      const uid = userIds[`trader-${i + 1}-demo`];
      if (!uid) continue;
      for (const docType of kycTypes.slice(0, rand(2, 4))) {
        const confidence = rand(80, 99);
        await client.query(
          `INSERT INTO kyc_documents
             (user_id, document_type, filename, file_key, file_url, file_size,
              content_type, status, analysis_result, ocr_confidence, authenticity_score,
              authenticity_verdict, analysed_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',$7,$8,$9,$10,$11,$12,NOW()) ON CONFLICT DO NOTHING`,
          [
            uid, docType,
            `${docType}-${uuid().slice(0, 8)}.pdf`,
            `kyc/${uid}/${docType}-${uuid().slice(0, 8)}.pdf`,
            `https://storage.tradegateway.ng/kyc/${uid}/${docType}.pdf`,
            rand(50000, 2000000),
            pick(["ANALYSED", "ANALYSED", "PENDING_ANALYSIS"]),
            JSON.stringify({ extracted_fields: { company: TRADER_NAMES[i].company, year: new Date().getFullYear() } }),
            confidence, confidence,
            pick(["authentic", "authentic", "requires_review"]),
            daysAgo(rand(1, 30)),
          ]
        );
        kycCount++;
      }
    }
    console.log(`   ✓ ${kycCount} KYC documents`);

    // ── 12. Fraud Cases ───────────────────────────────────────────────────────
    // Columns: id, case_number, trader_id, title, description, status, priority,
    //          assigned_to, created_by, linked_declaration_ids, risk_score,
    //          closure_reason, closed_at, created_at, updated_at
    console.log("12. Seeding fraud cases...");
    for (let i = 0; i < 5; i++) {
      const decl = pick(declarationIds);
      await client.query(
        `INSERT INTO fraud_cases
           (case_number, trader_id, title, description, status, priority,
            assigned_to, created_by, linked_declaration_ids, risk_score,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          `FC-${new Date().getFullYear()}-${String(1000 + i).padStart(4, "0")}`,
          decl.traderId,
          pick(["Suspected undervaluation", "Misdescription of goods", "Sanctions evasion attempt",
                "Duplicate declaration detected", "False certificate of origin"]),
          "Risk engine flagged anomalous patterns consistent with customs fraud indicators.",
          pick(["open", "under_review", "escalated", "closed_confirmed", "closed_cleared"]),
          pick(["low", "medium", "high", "critical"]),
          officerUserId, officerUserId,
          JSON.stringify([decl.id]),
          rand(60, 95),
        ]
      );
    }
    console.log("   ✓ 5 fraud cases");

    // ── 13. Post-Clearance Audits ─────────────────────────────────────────────
    // Columns: id, audit_number, declaration_id, declaration_number, trader_id,
    //          assigned_officer_id, status, outcome, trigger_reason, declared_value,
    //          audited_value, value_difference, additional_duty_assessed, penalty_amount,
    //          findings, officer_notes, supporting_documents, scheduled_date,
    //          started_at, completed_at, created_at, updated_at
    console.log("13. Seeding post-clearance audits...");
    for (let i = 0; i < 5; i++) {
      const decl = pick(clearedDecls);
      if (!decl) continue;
      const status = pick(["scheduled", "in_progress", "completed"]);
      const outcome = status === "completed" ? pick(["compliant", "minor_discrepancy", "major_discrepancy"]) : "pending";
      await client.query(
        `INSERT INTO post_clearance_audits
           (audit_number, declaration_id, declaration_number, trader_id, assigned_officer_id,
            status, outcome, trigger_reason, declared_value, audited_value, value_difference,
            additional_duty_assessed, penalty_amount, findings, officer_notes,
            scheduled_date, started_at, completed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          `PCA-${new Date().getFullYear()}-${String(1000 + i).padStart(4, "0")}`,
          decl.id,
          `NG${new Date().getFullYear()}${String(1000 + i).padStart(6, "0")}`,
          decl.traderId, officerUserId,
          status, outcome,
          pick(["random_selection", "risk_profile", "intelligence_tip", "value_discrepancy"]),
          decl.totalDue * 10, // declared value
          decl.totalDue * 10 + rand(-500000, 500000), // audited value
          rand(-500000, 500000), // difference
          outcome === "major_discrepancy" ? rand(100000, 500000) : 0,
          outcome === "major_discrepancy" ? rand(50000, 200000) : 0,
          outcome ? pick(["No discrepancies found.", "Minor documentation gap identified.", "Valuation discrepancy confirmed."]) : null,
          "Audit conducted per WCO Post-Clearance Audit guidelines.",
          daysAgo(rand(5, 30)),
          status !== "scheduled" ? daysAgo(rand(3, 10)) : null,
          status === "completed" ? daysAgo(rand(0, 3)) : null,
        ]
      );
    }
    console.log("   ✓ 5 post-clearance audits");

    // ── 14. Duty Drawback Claims ──────────────────────────────────────────────
    // Columns: id, claim_number, trader_id, import_declaration_id, import_declaration_number,
    //          export_declaration_id, export_declaration_number, drawback_type, status,
    //          original_duty_paid, claimed_amount, approved_amount, paid_amount, hs_code,
    //          goods_description, import_quantity, export_quantity, quantity_unit,
    //          re_export_evidence, manufacturing_evidence, reviewer_notes, rejection_reason,
    //          reviewed_by, import_date, export_date, submitted_at, reviewed_at, paid_at,
    //          created_at, updated_at
    console.log("14. Seeding duty drawback claims...");
    for (let i = 0; i < 5; i++) {
      const decl = pick(clearedDecls);
      const uid = userIds[`trader-${(i % TRADER_NAMES.length) + 1}-demo`];
      if (!uid || !decl) continue;
      const status = pick(["submitted", "under_review", "approved", "rejected"]);
      const hs = pick(HS_CODES);
      await client.query(
        `INSERT INTO duty_drawback_claims
           (claim_number, trader_id, import_declaration_id, import_declaration_number,
            export_declaration_number, drawback_type, status, original_duty_paid,
            claimed_amount, approved_amount, paid_amount, hs_code, goods_description,
            import_quantity, export_quantity, quantity_unit, reviewer_notes,
            reviewed_by, import_date, export_date, submitted_at, reviewed_at, paid_at,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          `DDC-${new Date().getFullYear()}-${String(1000 + i).padStart(4, "0")}`,
          uid, decl.id,
          `NG${new Date().getFullYear()}${String(1000 + i).padStart(6, "0")}`,
          `NG${new Date().getFullYear()}EXP${rand(1000, 9999)}`,
          pick(["manufacturing", "unused_merchandise", "substitution"]),
          status,
          decl.dutyAmount, decl.dutyAmount,
          status === "approved" ? decl.dutyAmount : null,
          status === "approved" ? decl.dutyAmount : null,
          hs.code, hs.desc,
          rand(100, 1000), rand(100, 1000), "MT",
          status === "approved" ? "Claim verified. Full drawback approved." :
          status === "rejected" ? "Export evidence insufficient." : null,
          status !== "submitted" ? officerUserId : null,
          daysAgo(rand(60, 180)),
          daysAgo(rand(10, 59)),
          daysAgo(rand(5, 30)),
          status !== "submitted" ? daysAgo(rand(1, 4)) : null,
          status === "approved" ? daysAgo(rand(0, 1)) : null,
        ]
      );
    }
    console.log("   ✓ 5 duty drawback claims");

    // ── 15. Security Alerts ───────────────────────────────────────────────────
    // Columns: id, alert_id, severity, category, title, description, source_ip,
    //          target_service, rule_id, rule_description, raw_event, acknowledged,
    //          acknowledged_by, acknowledged_at, resolved_at, created_at
    console.log("15. Seeding security alerts...");
    for (let i = 0; i < 8; i++) {
      await client.query(
        `INSERT INTO security_alerts
           (alert_id, severity, category, title, description, source_ip,
            target_service, rule_id, rule_description, acknowledged, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT DO NOTHING`,
        [
          `WAZUH-${uuid().slice(0, 12).toUpperCase()}`,
          pick(["low", "medium", "high", "critical"]),
          pick(["authentication", "network", "integrity", "anomaly", "compliance"]),
          pick(["Multiple failed login attempts detected", "Unusual API usage pattern",
                "Sanctions list match detected", "High-risk declaration flagged",
                "Brute force attack mitigated", "Suspicious IP blocked by WAF"]),
          "Automated security monitoring detected anomalous activity requiring review.",
          `${rand(41, 197)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,
          pick(["api-gateway", "auth-service", "declaration-service", "payment-service"]),
          `WCO-RULE-${rand(1000, 9999)}`,
          "WCO SAFE Framework security rule triggered.",
          rand(0, 1) === 1,
        ]
      );
    }
    console.log("   ✓ 8 security alerts");

    // ── 16. Audit Events ──────────────────────────────────────────────────────
    // Columns: id, entity_type, entity_id, action, actor_id, actor_type, previous_state,
    //          new_state, ip_address, user_agent, metadata, created_at
    console.log("16. Seeding audit events...");
    const auditActions = [
      "declaration.submitted", "declaration.status_changed", "payment.completed",
      "user.login", "user.logout", "api_key.created", "permit.approved",
      "aeo.application_submitted", "fraud_case.opened", "document.uploaded",
    ];
    for (let i = 0; i < 30; i++) {
      const uid = pick(Object.values(userIds).filter(Boolean));
      await client.query(
        `INSERT INTO audit_events
           (entity_type, entity_id, action, actor_id, actor_type, ip_address, user_agent, metadata, created_at)
         VALUES ($1,$2,$3,$4,'user',$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [
          pick(["declaration", "payment", "user", "permit", "document"]),
          String(rand(1, 1000)),
          pick(auditActions),
          uid,
          `${rand(41, 197)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,
          "Mozilla/5.0 (compatible; TradeGateway/2.0)",
          JSON.stringify({ session_id: uuid().slice(0, 16) }),
          daysAgo(rand(0, 90)),
        ]
      );
    }
    console.log("   ✓ 30 audit events");

    // ── 17. Notifications ─────────────────────────────────────────────────────
    // Columns: id, user_id, type, title, message, entity_type, entity_id, read, created_at
    console.log("17. Seeding notifications...");
    const notifTypes = [
      "declaration_submitted", "declaration_cleared", "declaration_rejected",
      "payment_confirmed", "permit_approved", "document_required", "aeo_status_update",
    ];
    let notifCount = 0;
    for (const [openId, uid] of Object.entries(userIds)) {
      if (!uid || openId.startsWith("admin")) continue;
      for (let i = 0; i < rand(2, 5); i++) {
        const type = pick(notifTypes);
        await client.query(
          `INSERT INTO notifications
             (user_id, type, title, message, entity_type, entity_id, read, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            uid, type,
            type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            `Your ${type.replace(/_/g, " ")} has been processed successfully.`,
            "declaration", rand(1, 50),
            rand(0, 1) === 1,
            daysAgo(rand(0, 30)),
          ]
        );
        notifCount++;
      }
    }
    console.log(`   ✓ ${notifCount} notifications`);

    // ── 18. Document Vault ────────────────────────────────────────────────────
    // Columns: id, owner_id, declaration_id, file_key, url, filename, mime_type,
    //          size_bytes, category, access_level, status, description,
    //          revoked_by, revoked_at, created_at, updated_at
    console.log("18. Seeding document vault...");
    const docCategories = ["commercial_invoice", "bill_of_lading", "packing_list",
                           "certificate_of_origin", "import_permit", "insurance_cert"];
    let vaultCount = 0;
    for (let i = 0; i < TRADER_NAMES.length; i++) {
      const uid = userIds[`trader-${i + 1}-demo`];
      if (!uid) continue;
      for (const cat of docCategories.slice(0, rand(2, 4))) {
        const fileId = uuid();
        await client.query(
          `INSERT INTO document_vault
             (owner_id, declaration_id, file_key, url, filename, mime_type,
              size_bytes, category, access_level, status, description, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,'private','active',$8,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [
            uid,
            pick(declarationIds.filter(d => d.traderId === uid))?.id ?? null,
            `vault/${uid}/${cat}-${fileId.slice(0, 8)}.pdf`,
            `https://storage.tradegateway.ng/vault/${uid}/${cat}-${fileId.slice(0, 8)}.pdf`,
            `${cat.replace(/_/g, "-")}-${fileId.slice(0, 8)}.pdf`,
            rand(50000, 5000000),
            cat,
            `${cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} - ${new Date().getFullYear()}`,
          ]
        );
        vaultCount++;
      }
    }
    console.log(`   ✓ ${vaultCount} document vault entries`);

    // ── 19. Geofences ─────────────────────────────────────────────────────────
    // Columns: id, name, port_code, geofence_type, status, polygon, radius_meters,
    //          alert_on_entry, alert_on_exit, notify_owner_on_trigger, created_by,
    //          created_at, updated_at
    console.log("19. Seeding geofences...");
    const geofences = [
      ["Apapa Port Zone", "APAPA", 2000],
      ["Tin Can Island Zone", "TINCAN", 1500],
      ["Onne Port Zone", "ONNE", 2500],
      ["Lagos Airport Cargo Zone", "LAGOS_AIR", 1000],
      ["Seme Border Zone", "SEME", 500],
    ];
    for (const [name, port, radius] of geofences) {
      await client.query(
        `INSERT INTO geofences
           (name, port_code, geofence_type, status, polygon, radius_meters,
            alert_on_entry, alert_on_exit, notify_owner_on_trigger, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,'active',$4,$5,true,true,false,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [name, port, pick(['port_entry','port_exit','customs_zone','restricted_zone']),
         JSON.stringify({ type: 'circle', center: [3.39, 6.44], radius }),
         radius, officerUserId]
      );
    }
    console.log(`   ✓ ${geofences.length} geofences`);

    // ── 20. Site Settings ─────────────────────────────────────────────────────
    // Columns: key, value, description, updated_at, updated_by
    console.log("20. Seeding site settings...");
    const siteSettings = [
      ["platform_name", "TradeGateway NGSWTP", "Platform display name"],
      ["platform_version", "2.0.0", "Current platform version"],
      ["maintenance_mode", "false", "Enable/disable maintenance mode"],
      ["max_declaration_value_ngn", "5000000000", "Maximum allowed declaration value in NGN"],
      ["green_lane_threshold", "30", "Risk score below this = GREEN lane"],
      ["red_lane_threshold", "70", "Risk score above this = RED lane"],
      ["aeo_silver_min_declarations", "50", "Minimum declarations for AEO Silver"],
      ["aeo_gold_min_declarations", "200", "Minimum declarations for AEO Gold"],
      ["duty_payment_deadline_hours", "72", "Hours to pay duty after assessment"],
      ["permit_expiry_warning_days", "30", "Days before permit expiry to warn"],
      ["support_email", "support@tradegateway.ng", "Support email address"],
      ["support_phone", "+234-800-TRADE-GW", "Support phone number"],
      ["wco_data_model_version", "3.10", "WCO data model version in use"],
      ["asean_sw_enabled", "true", "ASEAN Single Window connectivity enabled"],
      ["mojaloop_enabled", "true", "Mojaloop payment integration enabled"],
      ["sla_breach_alert_threshold", "5", "Number of SLA breaches before email alert"],
    ];
    for (const [key, value, description] of siteSettings) {
      await client.query(
        `INSERT INTO site_settings (key, value, description, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
        [key, value, description]
      );
    }
    console.log(`   ✓ ${siteSettings.length} site settings`);

    // ── 21. API Changelog ─────────────────────────────────────────────────────
    // Columns: id, version, change_type, endpoint, description, breaking_change,
    //          migration_guide, published_at, published_by
    console.log("21. Seeding API changelog...");
    const changelog = [
      ["v2.0.0", "added", "/api/v2/declarations", "Platform GA Release — full 37 OGA integrations, AEO programme, ASEAN Single Window connectivity.", false],
      ["v1.9.0", "added", "/api/v1/drawback", "Added duty drawback claim submission and tracking for exporters.", false],
      ["v1.8.0", "added", "/api/v1/payments", "Integrated Mojaloop interoperable payment gateway for duty collection.", false],
      ["v1.7.0", "modified", "/api/v1/risk", "Upgraded risk engine to DeepSeek-R1 with 94.7% fraud detection accuracy.", false],
      ["v1.6.0", "added", "/api/v1/vault", "Introduced encrypted document vault with selective sharing.", false],
      ["v1.5.0", "added", "/api/v1/aeo", "AEO programme with Silver/Gold tiers and expedited clearance.", false],
    ];
    for (const [version, type, endpoint, description, breaking] of changelog) {
      await client.query(
        `INSERT INTO api_changelog (version, change_type, endpoint, description, breaking_change, published_at, published_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [version, type, endpoint, description, breaking, daysAgo(rand(1, 180)), officerUserId]
      );
    }
    console.log(`   ✓ ${changelog.length} API changelog entries`);

    // ── 22. API Keys ──────────────────────────────────────────────────────────
    // Columns: id, user_id, name, key_hash, key_prefix, scopes, rate_limit,
    //          sandbox_mode, status, expires_at, last_used_at, created_at
    console.log("22. Seeding API keys...");
    for (let i = 0; i < TRADER_NAMES.length; i++) {
      const uid = userIds[`trader-${i + 1}-demo`];
      if (!uid) continue;
      const keyRaw = `tgw_${uuid().replace(/-/g, "")}`;
      await client.query(
        `INSERT INTO api_keys
           (user_id, name, key_hash, key_prefix, scopes, rate_limit, sandbox_mode, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,NOW()) ON CONFLICT DO NOTHING`,
        [
          uid,
          `${TRADER_NAMES[i].company} Integration Key`,
          crypto.createHash("sha256").update(keyRaw).digest("hex"),
          keyRaw.slice(0, 12),
          JSON.stringify(["declarations:read", "declarations:write", "payments:read"]),
          1000,
          false,
          daysFromNow(365),
        ]
      );
    }
    console.log(`   ✓ ${TRADER_NAMES.length} API keys`);

    console.log("\n=== Comprehensive Seed Complete ===");
    console.log("✓ 22 table groups seeded with production-realistic data");
    console.log("✓ 50 declarations | 5 traders | 3 officers | 1 admin");
    console.log("✓ Payments, OGA permits, clearance certs, KYC, AEO, fraud cases");
    console.log("✓ Vessel tracking, sanctions checks, post-clearance audits");
    console.log("✓ API keys, document vault, geofences, site settings, API changelog");
    console.log("✓ Duty drawback claims, security alerts, audit events, notifications");
    console.log("\nRun `pnpm dev` and login with any demo user to explore the platform.");

  } catch (err) {
    console.error("\nSeed failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
