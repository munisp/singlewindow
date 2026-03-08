/**
 * seed-ports.mjs
 * Seed real African and global port data into portLocations,
 * portCongestionEvents, and vesselTrackingEvents tables.
 *
 * Usage: node scripts/seed-ports.mjs
 */
import pg from "pg";
const { Pool } = pg;

// ─── CONNECTION ───────────────────────────────────────────────────────────────
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";

const pool = new Pool({ connectionString: DB_URL });

// ─── PORT DATA ────────────────────────────────────────────────────────────────
// 25 real ports: 18 African + 7 global comparators
const PORTS = [
  // ── WEST AFRICA ──────────────────────────────────────────────────────────
  {
    portCode: "GHTEM",
    portName: "Tema Port",
    country: "GHA",
    latitude: 5.6333,
    longitude: -0.0167,
    portType: "seaport",
    metadata: {
      operator: "Ghana Ports & Harbours Authority",
      annualTEU: 900000,
      berths: 12,
      maxDraft: 12.5,
      website: "https://www.ghanaports.gov.gh",
    },
  },
  {
    portCode: "NGLAG",
    portName: "Apapa Port (Lagos)",
    country: "NGA",
    latitude: 6.4474,
    longitude: 3.3903,
    portType: "seaport",
    metadata: {
      operator: "Nigerian Ports Authority",
      annualTEU: 1200000,
      berths: 22,
      maxDraft: 13.0,
      website: "https://www.nigerianports.gov.ng",
    },
  },
  {
    portCode: "NGTIN",
    portName: "Tin Can Island Port (Lagos)",
    country: "NGA",
    latitude: 6.4280,
    longitude: 3.3450,
    portType: "seaport",
    metadata: {
      operator: "Nigerian Ports Authority",
      annualTEU: 800000,
      berths: 14,
      maxDraft: 11.5,
    },
  },
  {
    portCode: "CIABJ",
    portName: "Port of Abidjan",
    country: "CIV",
    latitude: 5.2743,
    longitude: -4.0226,
    portType: "seaport",
    metadata: {
      operator: "Port Autonome d'Abidjan",
      annualTEU: 1100000,
      berths: 18,
      maxDraft: 14.0,
      website: "https://www.paa-ci.org",
    },
  },
  {
    portCode: "SNDKR",
    portName: "Port of Dakar",
    country: "SEN",
    latitude: 14.6928,
    longitude: -17.4467,
    portType: "seaport",
    metadata: {
      operator: "Port Autonome de Dakar",
      annualTEU: 450000,
      berths: 10,
      maxDraft: 12.0,
    },
  },
  {
    portCode: "BJANB",
    portName: "Port of Cotonou",
    country: "BEN",
    latitude: 6.3600,
    longitude: 2.4200,
    portType: "seaport",
    metadata: {
      operator: "Port Autonome de Cotonou",
      annualTEU: 350000,
      berths: 8,
      maxDraft: 11.0,
    },
  },
  {
    portCode: "CMDLE",
    portName: "Port of Douala",
    country: "CMR",
    latitude: 4.0511,
    longitude: 9.7085,
    portType: "seaport",
    metadata: {
      operator: "Port Autonome de Douala",
      annualTEU: 400000,
      berths: 9,
      maxDraft: 10.5,
    },
  },
  // ── EAST AFRICA ──────────────────────────────────────────────────────────
  {
    portCode: "KENYB",
    portName: "Port of Mombasa",
    country: "KEN",
    latitude: -4.0435,
    longitude: 39.6682,
    portType: "seaport",
    metadata: {
      operator: "Kenya Ports Authority",
      annualTEU: 1400000,
      berths: 21,
      maxDraft: 13.5,
      website: "https://www.kpa.co.ke",
    },
  },
  {
    portCode: "TZDAR",
    portName: "Port of Dar es Salaam",
    country: "TZA",
    latitude: -6.8235,
    longitude: 39.2895,
    portType: "seaport",
    metadata: {
      operator: "Tanzania Ports Authority",
      annualTEU: 800000,
      berths: 11,
      maxDraft: 11.0,
    },
  },
  {
    portCode: "TZZAN",
    portName: "Port of Zanzibar",
    country: "TZA",
    latitude: -6.1630,
    longitude: 39.1900,
    portType: "seaport",
    metadata: {
      operator: "Tanzania Ports Authority",
      annualTEU: 80000,
      berths: 4,
      maxDraft: 8.5,
    },
  },
  {
    portCode: "ETADD",
    portName: "Addis Ababa Dry Port",
    country: "ETH",
    latitude: 9.0320,
    longitude: 38.7469,
    portType: "inland_port",
    metadata: {
      operator: "Ethiopian Shipping & Logistics Services Enterprise",
      annualTEU: 500000,
      note: "Landlocked — uses Djibouti Port for sea access",
    },
  },
  {
    portCode: "DJJIB",
    portName: "Port of Djibouti",
    country: "DJI",
    latitude: 11.5892,
    longitude: 43.1456,
    portType: "seaport",
    metadata: {
      operator: "Djibouti Port & Free Zone Authority",
      annualTEU: 1000000,
      berths: 15,
      maxDraft: 14.5,
      note: "Gateway for Ethiopia, South Sudan, landlocked Horn of Africa",
    },
  },
  // ── SOUTHERN AFRICA ──────────────────────────────────────────────────────
  {
    portCode: "ZADRB",
    portName: "Port of Durban",
    country: "ZAF",
    latitude: -29.8587,
    longitude: 31.0218,
    portType: "seaport",
    metadata: {
      operator: "Transnet National Ports Authority",
      annualTEU: 2800000,
      berths: 57,
      maxDraft: 16.0,
      website: "https://www.transnet.net",
      note: "Largest container port in Africa",
    },
  },
  {
    portCode: "ZACPT",
    portName: "Port of Cape Town",
    country: "ZAF",
    latitude: -33.9249,
    longitude: 18.4241,
    portType: "seaport",
    metadata: {
      operator: "Transnet National Ports Authority",
      annualTEU: 900000,
      berths: 18,
      maxDraft: 14.0,
    },
  },
  {
    portCode: "MZMPM",
    portName: "Port of Maputo",
    country: "MOZ",
    latitude: -25.9692,
    longitude: 32.5732,
    portType: "seaport",
    metadata: {
      operator: "Maputo Port Development Company",
      annualTEU: 250000,
      berths: 7,
      maxDraft: 11.5,
    },
  },
  // ── NORTH AFRICA ─────────────────────────────────────────────────────────
  {
    portCode: "EGPSD",
    portName: "Port Said East",
    country: "EGY",
    latitude: 31.2565,
    longitude: 32.2841,
    portType: "seaport",
    metadata: {
      operator: "Suez Canal Container Terminal",
      annualTEU: 4500000,
      berths: 24,
      maxDraft: 17.0,
      note: "Largest container port in Africa by TEU",
    },
  },
  {
    portCode: "MAPTM",
    portName: "Tanger Med",
    country: "MAR",
    latitude: 35.8847,
    longitude: -5.5028,
    portType: "seaport",
    metadata: {
      operator: "Tanger Med Port Authority",
      annualTEU: 7400000,
      berths: 30,
      maxDraft: 18.0,
      website: "https://www.tangermed.ma",
      note: "Largest port in Africa and Mediterranean",
    },
  },
  // ── CENTRAL AFRICA ───────────────────────────────────────────────────────
  {
    portCode: "RWAKG",
    portName: "Kigali Inland Container Depot",
    country: "RWA",
    latitude: -1.9441,
    longitude: 30.0619,
    portType: "inland_port",
    metadata: {
      operator: "Rwanda Revenue Authority",
      annualTEU: 120000,
      note: "Rwanda Electronic Single Window (ReSW) hub",
    },
  },
  // ── GLOBAL COMPARATORS ───────────────────────────────────────────────────
  {
    portCode: "SGSIN",
    portName: "Port of Singapore (PSA)",
    country: "SGP",
    latitude: 1.2655,
    longitude: 103.8198,
    portType: "seaport",
    metadata: {
      operator: "PSA International",
      annualTEU: 37600000,
      berths: 67,
      maxDraft: 20.0,
      website: "https://www.singaporepsa.com",
      note: "Singapore NTP reference platform",
    },
  },
  {
    portCode: "AEDXB",
    portName: "Jebel Ali Port (Dubai)",
    country: "ARE",
    latitude: 25.0118,
    longitude: 55.0694,
    portType: "seaport",
    metadata: {
      operator: "DP World",
      annualTEU: 14000000,
      berths: 67,
      maxDraft: 17.0,
    },
  },
  {
    portCode: "CNSHA",
    portName: "Port of Shanghai (Yangshan)",
    country: "CHN",
    latitude: 30.6340,
    longitude: 122.0700,
    portType: "seaport",
    metadata: {
      operator: "Shanghai International Port Group",
      annualTEU: 47300000,
      berths: 96,
      maxDraft: 17.0,
      note: "World's busiest container port",
    },
  },
  {
    portCode: "NLRTM",
    portName: "Port of Rotterdam",
    country: "NLD",
    latitude: 51.9225,
    longitude: 4.4792,
    portType: "seaport",
    metadata: {
      operator: "Port of Rotterdam Authority",
      annualTEU: 14800000,
      berths: 85,
      maxDraft: 24.0,
      note: "Largest port in Europe",
    },
  },
  {
    portCode: "USNYC",
    portName: "Port of New York & New Jersey",
    country: "USA",
    latitude: 40.6892,
    longitude: -74.0445,
    portType: "seaport",
    metadata: {
      operator: "Port Authority of NY & NJ",
      annualTEU: 9500000,
      berths: 40,
      maxDraft: 15.5,
    },
  },
  {
    portCode: "GBFXT",
    portName: "Port of Felixstowe",
    country: "GBR",
    latitude: 51.9530,
    longitude: 1.3510,
    portType: "seaport",
    metadata: {
      operator: "Hutchison Ports",
      annualTEU: 3700000,
      berths: 34,
      maxDraft: 16.0,
      note: "UK's largest container port",
    },
  },
  {
    portCode: "INNSV",
    portName: "Jawaharlal Nehru Port (Mumbai)",
    country: "IND",
    latitude: 18.9500,
    longitude: 72.9500,
    portType: "seaport",
    metadata: {
      operator: "Jawaharlal Nehru Port Trust",
      annualTEU: 5800000,
      berths: 18,
      maxDraft: 14.5,
      note: "India's largest container port",
    },
  },
];

// ─── CONGESTION DATA ──────────────────────────────────────────────────────────
// Realistic congestion status based on known port performance
const CONGESTION_PROFILES = {
  GHTEM: { status: "moderate", vesselCount: 28, waitHours: 18, backlog: 145, inspQueue: 22 },
  NGLAG: { status: "critical", vesselCount: 52, waitHours: 72, backlog: 380, inspQueue: 65 },
  NGTIN: { status: "congested", vesselCount: 38, waitHours: 48, backlog: 220, inspQueue: 40 },
  CIABJ: { status: "moderate", vesselCount: 31, waitHours: 24, backlog: 160, inspQueue: 28 },
  SNDKR: { status: "clear", vesselCount: 14, waitHours: 6, backlog: 45, inspQueue: 8 },
  BJANB: { status: "moderate", vesselCount: 18, waitHours: 16, backlog: 90, inspQueue: 15 },
  CMDLE: { status: "congested", vesselCount: 22, waitHours: 36, backlog: 130, inspQueue: 25 },
  KENYB: { status: "congested", vesselCount: 44, waitHours: 42, backlog: 290, inspQueue: 48 },
  TZDAR: { status: "moderate", vesselCount: 26, waitHours: 20, backlog: 120, inspQueue: 18 },
  TZZAN: { status: "clear", vesselCount: 6, waitHours: 4, backlog: 20, inspQueue: 3 },
  ETADD: { status: "moderate", vesselCount: 0, waitHours: 12, backlog: 85, inspQueue: 12 },
  DJJIB: { status: "moderate", vesselCount: 35, waitHours: 22, backlog: 175, inspQueue: 30 },
  ZADRB: { status: "congested", vesselCount: 68, waitHours: 36, backlog: 420, inspQueue: 72 },
  ZACPT: { status: "clear", vesselCount: 22, waitHours: 8, backlog: 75, inspQueue: 12 },
  MZMPM: { status: "clear", vesselCount: 9, waitHours: 5, backlog: 30, inspQueue: 5 },
  EGPSD: { status: "moderate", vesselCount: 88, waitHours: 12, backlog: 520, inspQueue: 85 },
  MAPTM: { status: "clear", vesselCount: 95, waitHours: 4, backlog: 180, inspQueue: 20 },
  RWAKG: { status: "clear", vesselCount: 0, waitHours: 2, backlog: 15, inspQueue: 3 },
  SGSIN: { status: "clear", vesselCount: 240, waitHours: 1, backlog: 50, inspQueue: 8 },
  AEDXB: { status: "clear", vesselCount: 180, waitHours: 2, backlog: 80, inspQueue: 10 },
  CNSHA: { status: "moderate", vesselCount: 320, waitHours: 8, backlog: 1200, inspQueue: 95 },
  NLRTM: { status: "clear", vesselCount: 195, waitHours: 3, backlog: 120, inspQueue: 15 },
  USNYC: { status: "moderate", vesselCount: 85, waitHours: 14, backlog: 350, inspQueue: 45 },
  GBFXT: { status: "clear", vesselCount: 72, waitHours: 5, backlog: 90, inspQueue: 12 },
  INNSV: { status: "moderate", vesselCount: 110, waitHours: 18, backlog: 480, inspQueue: 60 },
};

// ─── VESSEL DATA ──────────────────────────────────────────────────────────────
// Sample vessel tracking events (AIS-style data)
const VESSELS = [
  { imo: "IMO9780416", name: "MSC GÜLSÜN", flag: "PAN", vesselType: "container_ship", portCode: "SGSIN", lat: 1.2655, lon: 103.8198, speed: 0.2, heading: 180, status: "moored" },
  { imo: "IMO9839430", name: "EVER ACE", flag: "PAN", vesselType: "container_ship", portCode: "MAPTM", lat: 35.8847, lon: -5.5028, speed: 0.0, heading: 90, status: "moored" },
  { imo: "IMO9462033", name: "COSCO SHIPPING UNIVERSE", flag: "CHN", vesselType: "container_ship", portCode: "CNSHA", lat: 30.6340, lon: 122.0700, speed: 0.1, heading: 270, status: "moored" },
  { imo: "IMO9395044", name: "MAERSK ESSEX", flag: "DNK", vesselType: "container_ship", portCode: "ZADRB", lat: -29.8587, lon: 31.0218, speed: 0.0, heading: 0, status: "moored" },
  { imo: "IMO9312870", name: "CMA CGM MARCO POLO", flag: "FRA", vesselType: "container_ship", portCode: "NGLAG", lat: 6.4474, lon: 3.3903, speed: 0.3, heading: 45, status: "at_anchor" },
  { imo: "IMO9702005", name: "OOCL HONG KONG", flag: "HKG", vesselType: "container_ship", portCode: "KENYB", lat: -4.0435, lon: 39.6682, speed: 0.0, heading: 135, status: "moored" },
  { imo: "IMO9534462", name: "MSC OSCAR", flag: "PAN", vesselType: "container_ship", portCode: "EGPSD", lat: 31.2565, lon: 32.2841, speed: 0.5, heading: 315, status: "underway" },
  { imo: "IMO9629879", name: "HAPAG-LLOYD BERLIN", flag: "DEU", vesselType: "container_ship", portCode: "GHTEM", lat: 5.6333, lon: -0.0167, speed: 0.0, heading: 225, status: "moored" },
  { imo: "IMO9741432", name: "YANG MING WITNESS", flag: "TWN", vesselType: "container_ship", portCode: "CIABJ", lat: 5.2743, lon: -4.0226, speed: 0.2, heading: 90, status: "at_anchor" },
  { imo: "IMO9388340", name: "SAFMARINE MAFADI", flag: "ZAF", vesselType: "bulk_carrier", portCode: "TZDAR", lat: -6.8235, lon: 39.2895, speed: 0.0, heading: 180, status: "moored" },
  { imo: "IMO9305128", name: "MV UHURU", flag: "KEN", vesselType: "general_cargo", portCode: "KENYB", lat: -4.0600, lon: 39.6800, speed: 1.2, heading: 200, status: "underway" },
  { imo: "IMO9456789", name: "LOMÉ EXPRESS", flag: "TGO", vesselType: "container_ship", portCode: "BJANB", lat: 6.3600, lon: 2.4200, speed: 0.0, heading: 270, status: "moored" },
  { imo: "IMO9234567", name: "DAKAR TRADER", flag: "SEN", vesselType: "ro_ro", portCode: "SNDKR", lat: 14.6928, lon: -17.4467, speed: 0.0, heading: 90, status: "moored" },
  { imo: "IMO9876543", name: "CAPE AGULHAS", flag: "ZAF", vesselType: "tanker", portCode: "ZACPT", lat: -33.9249, lon: 18.4241, speed: 0.4, heading: 0, status: "at_anchor" },
  { imo: "IMO9345678", name: "DJIBOUTI GATEWAY", flag: "DJI", vesselType: "container_ship", portCode: "DJJIB", lat: 11.5892, lon: 43.1456, speed: 0.0, heading: 135, status: "moored" },
];

// ─── SEED FUNCTIONS ───────────────────────────────────────────────────────────
async function seedPorts() {
  console.log("🌍 Seeding port locations...");
  let inserted = 0;
  let skipped = 0;
  for (const port of PORTS) {
    try {
      await pool.query(
        `INSERT INTO port_locations (port_code, port_name, country, latitude, longitude, port_type, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (port_code) DO UPDATE SET
           port_name = EXCLUDED.port_name,
           country = EXCLUDED.country,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           port_type = EXCLUDED.port_type`,
        [
          port.portCode,
          port.portName,
          port.country,
          port.latitude,
          port.longitude,
          port.portType,
        ]
      );
      inserted++;
      console.log(`  ✓ ${port.portCode} — ${port.portName} (${port.country})`);
    } catch (err) {
      console.error(`  ✗ ${port.portCode}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`\n  Ports: ${inserted} upserted, ${skipped} failed\n`);
}

async function seedCongestion() {
  console.log("📊 Seeding port congestion events...");
  let inserted = 0;
  for (const [portCode, profile] of Object.entries(CONGESTION_PROFILES)) {
    // Insert 7 days of hourly snapshots (168 events per port = ~4200 total)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    // Insert one event per 4 hours for 7 days = 42 events per port
    for (let h = 0; h < 168; h += 4) {
      const ts = new Date(now - (168 - h) * hourMs);
      // Add some realistic variation
      const variation = (Math.random() - 0.5) * 0.3; // ±15%
      const vesselCount = Math.max(0, Math.round(profile.vesselCount * (1 + variation)));
      const waitHours = Math.max(0, profile.waitHours * (1 + variation));
      const backlog = Math.max(0, Math.round(profile.backlog * (1 + variation)));
      const inspQueue = Math.max(0, Math.round(profile.inspQueue * (1 + variation)));
      // Determine status based on wait hours
      let congestionStatus = profile.status;
      if (waitHours > 60) congestionStatus = "critical";
      else if (waitHours > 30) congestionStatus = "congested";
      else if (waitHours > 12) congestionStatus = "moderate";
      else congestionStatus = "clear";
      try {
        await pool.query(
          `INSERT INTO port_congestion_events
             (port_code, congestion_status, vessel_count, wait_time_hours, declaration_backlog, inspection_queue_size, metadata, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            portCode,
            congestionStatus,
            vesselCount,
            waitHours.toFixed(1),
            backlog,
            inspQueue,
            JSON.stringify({ source: "seed", hour: h }),
            ts.toISOString(),
          ]
        );
        inserted++;
      } catch (err) {
        console.error(`  ✗ ${portCode} h${h}: ${err.message}`);
      }
    }
    console.log(`  ✓ ${portCode} — ${42} events`);
  }
  console.log(`\n  Congestion events: ${inserted} inserted\n`);
}

async function seedVessels() {
  console.log("🚢 Seeding vessel tracking events...");
  let inserted = 0;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  for (const vessel of VESSELS) {
    // Insert 24 hourly position updates per vessel
    for (let h = 0; h < 24; h++) {
      const ts = new Date(now - (24 - h) * hourMs);
      // Slight position drift to simulate movement
      const latDrift = (Math.random() - 0.5) * 0.01;
      const lonDrift = (Math.random() - 0.5) * 0.01;
      try {
        await pool.query(
          `INSERT INTO vessel_tracking_events
             (mmsi, imo_number, vessel_name, flag_country, latitude, longitude, speed, heading, destination_port, cargo_type, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            vessel.imo.replace('IMO', ''), // use IMO number as MMSI placeholder
            vessel.imo,
            vessel.name,
            vessel.flag,
            (vessel.lat + latDrift).toFixed(6),
            (vessel.lon + lonDrift).toFixed(6),
            vessel.speed.toFixed(1),
            vessel.heading,
            vessel.portCode,
            vessel.vesselType,
            ts.toISOString(),
          ]
        );
        inserted++;
      } catch (err) {
        console.error(`  ✗ ${vessel.imo} h${h}: ${err.message}`);
      }
    }
    console.log(`  ✓ ${vessel.imo} — ${vessel.name} (${vessel.portCode})`);
  }
  console.log(`\n  Vessel events: ${inserted} inserted\n`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("TradeGateway NGSWTP — Port Data Seed Script");
  console.log("=".repeat(60));
  console.log(`Database: ${DB_URL.replace(/:[^:@]+@/, ":***@")}\n`);

  try {
    // Check existing data
    const portCount = await pool.query("SELECT COUNT(*) FROM port_locations");
    const congCount = await pool.query("SELECT COUNT(*) FROM port_congestion_events");
    const vesCount = await pool.query("SELECT COUNT(*) FROM vessel_tracking_events");
    console.log(`Existing data: ${portCount.rows[0].count} ports, ${congCount.rows[0].count} congestion events, ${vesCount.rows[0].count} vessel events\n`);

    await seedPorts();
    await seedCongestion();
    await seedVessels();

    // Final counts
    const finalPorts = await pool.query("SELECT COUNT(*) FROM port_locations");
    const finalCong = await pool.query("SELECT COUNT(*) FROM port_congestion_events");
    const finalVes = await pool.query("SELECT COUNT(*) FROM vessel_tracking_events");
    console.log("=".repeat(60));
    console.log("✅ Seed complete!");
    console.log(`   Port locations:       ${finalPorts.rows[0].count}`);
    console.log(`   Congestion events:    ${finalCong.rows[0].count}`);
    console.log(`   Vessel track events:  ${finalVes.rows[0].count}`);
    console.log("=".repeat(60));
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
