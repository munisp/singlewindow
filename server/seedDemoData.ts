/**
 * TradeGateway™ NGSWTP — Demo Data Seeder
 * Seeds bonded_warehouses, bonded_inventory, ex_bond_permits, cep_patterns, and cost_records
 * with realistic data on first startup. All inserts are idempotent (skip if data already exists).
 */
import { getDb, getPool } from "./db";

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Ensure the pool is initialized
  await getDb();
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

// ─── Bonded Warehouses ────────────────────────────────────────────────────────

const DEMO_WAREHOUSES = [
  {
    name: "Apapa Free Port Bonded Store A",
    operator_name: "NPA Logistics Ltd",
    operator_tin: "TIN-NPA-001",
    address: "Apapa Port Complex, Apapa, Lagos",
    port_code: "NGAPP",
    capacity_cbm: 5000,
    bond_amount: 50000000,
    bond_expiry_days: 365,
    status: "active",
  },
  {
    name: "Tin Can Island Bonded Warehouse 1",
    operator_name: "Meridian Freight Services",
    operator_tin: "TIN-MFS-002",
    address: "Tin Can Island Port, Apapa, Lagos",
    port_code: "NGTCI",
    capacity_cbm: 3500,
    bond_amount: 35000000,
    bond_expiry_days: 365,
    status: "active",
  },
  {
    name: "Onne Port CFS Bonded Zone",
    operator_name: "Onne Port Authority",
    operator_tin: "TIN-OPA-003",
    address: "Federal Ocean Terminal, Onne, Rivers State",
    port_code: "NGONN",
    capacity_cbm: 8000,
    bond_amount: 80000000,
    bond_expiry_days: 730,
    status: "active",
  },
  {
    name: "Kano Inland Dry Port Bonded Facility",
    operator_name: "Kano IDP Operations",
    operator_tin: "TIN-KDP-004",
    address: "Kano Inland Dry Port, Kano State",
    port_code: "NGKAN",
    capacity_cbm: 2000,
    bond_amount: 20000000,
    bond_expiry_days: 365,
    status: "active",
  },
  {
    name: "Calabar Port Bonded Warehouse",
    operator_name: "Cross River Port Services",
    operator_tin: "TIN-CRP-005",
    address: "Calabar Free Trade Zone, Cross River State",
    port_code: "NGCBQ",
    capacity_cbm: 1500,
    bond_amount: 15000000,
    bond_expiry_days: 365,
    status: "active",
  },
  {
    name: "Lagos Airport Cargo Bonded Store",
    operator_name: "FAAN Cargo Services",
    operator_tin: "TIN-FCS-006",
    address: "Murtala Muhammed Airport, Ikeja, Lagos",
    port_code: "NGLOS",
    capacity_cbm: 1200,
    bond_amount: 12000000,
    bond_expiry_days: 180,
    status: "active",
  },
];

const DEMO_INVENTORY = [
  { ucr: "NGR2026-001-APAPA", hs_code: "8471.30.00", description: "Laptop computers and accessories", quantity_kg: 5000, volume_cbm: 25, declared_value: 15000000, origin_country: "CN", status: "in_bond", days_until_expiry: 45 },
  { ucr: "NGR2026-002-APAPA", hs_code: "3004.90.00", description: "Pharmaceutical products - antibiotics", quantity_kg: 2000, volume_cbm: 8, declared_value: 8000000, origin_country: "IN", status: "in_bond", days_until_expiry: 60 },
  { ucr: "NGR2026-003-APAPA", hs_code: "8703.23.00", description: "Passenger motor vehicles (1500-3000cc)", quantity_kg: 45000, volume_cbm: 180, declared_value: 120000000, origin_country: "JP", status: "in_bond", days_until_expiry: 30 },
  { ucr: "NGR2026-004-TINCI", hs_code: "7208.51.00", description: "Hot-rolled steel sheets", quantity_kg: 80000, volume_cbm: 40, declared_value: 25000000, origin_country: "CN", status: "in_bond", days_until_expiry: 90 },
  { ucr: "NGR2026-005-TINCI", hs_code: "2710.19.00", description: "Petroleum oils and preparations", quantity_kg: 200000, volume_cbm: 250, declared_value: 180000000, origin_country: "AE", status: "in_bond", days_until_expiry: 15 },
  { ucr: "NGR2026-006-ONNE", hs_code: "8429.51.00", description: "Front-end shovel loaders", quantity_kg: 35000, volume_cbm: 120, declared_value: 95000000, origin_country: "US", status: "in_bond", days_until_expiry: 120 },
  { ucr: "NGR2026-007-ONNE", hs_code: "2523.29.00", description: "Portland cement (bulk)", quantity_kg: 500000, volume_cbm: 350, declared_value: 12000000, origin_country: "CN", status: "in_bond", days_until_expiry: 75 },
  { ucr: "NGR2026-008-KANO", hs_code: "5208.11.00", description: "Woven cotton fabrics", quantity_kg: 8000, volume_cbm: 30, declared_value: 6000000, origin_country: "PK", status: "in_bond", days_until_expiry: 50 },
  { ucr: "NGR2026-009-KANO", hs_code: "1006.30.00", description: "Semi-milled or wholly milled rice", quantity_kg: 25000, volume_cbm: 35, declared_value: 9000000, origin_country: "TH", status: "in_bond", days_until_expiry: 20 },
  { ucr: "NGR2026-010-CALB", hs_code: "4407.10.00", description: "Coniferous wood sawn lengthwise", quantity_kg: 60000, volume_cbm: 200, declared_value: 18000000, origin_country: "BR", status: "in_bond", days_until_expiry: 100 },
  { ucr: "NGR2026-011-APAPA", hs_code: "8544.42.00", description: "Electric conductors for 80V-1000V", quantity_kg: 12000, volume_cbm: 20, declared_value: 22000000, origin_country: "CN", status: "ex_bonded", days_until_expiry: 0 },
  { ucr: "NGR2026-012-TINCI", hs_code: "3901.10.00", description: "Polyethylene having specific gravity < 0.94", quantity_kg: 40000, volume_cbm: 55, declared_value: 35000000, origin_country: "SA", status: "ex_bonded", days_until_expiry: 0 },
  { ucr: "NGR2026-013-ONNE", hs_code: "8802.40.00", description: "Aeroplanes and other powered aircraft", quantity_kg: 15000, volume_cbm: 500, declared_value: 850000000, origin_country: "FR", status: "in_bond", days_until_expiry: 180 },
  { ucr: "NGR2026-014-APAPA", hs_code: "2204.21.00", description: "Wine of fresh grapes in containers ≤2L", quantity_kg: 3000, volume_cbm: 5, declared_value: 4500000, origin_country: "FR", status: "in_bond", days_until_expiry: 8 },
  { ucr: "NGR2026-015-CALB", hs_code: "9403.20.00", description: "Other metal furniture", quantity_kg: 18000, volume_cbm: 80, declared_value: 11000000, origin_country: "CN", status: "in_bond", days_until_expiry: 55 },
  { ucr: "NGR2026-016-LAGOS", hs_code: "9018.90.00", description: "Medical instruments and appliances", quantity_kg: 800, volume_cbm: 4, declared_value: 28000000, origin_country: "DE", status: "in_bond", days_until_expiry: 40 },
  { ucr: "NGR2026-017-APAPA", hs_code: "8517.12.00", description: "Telephones for cellular networks", quantity_kg: 2500, volume_cbm: 12, declared_value: 45000000, origin_country: "CN", status: "in_bond", days_until_expiry: 65 },
  { ucr: "NGR2026-018-TINCI", hs_code: "7601.10.00", description: "Unwrought aluminium, not alloyed", quantity_kg: 90000, volume_cbm: 35, declared_value: 72000000, origin_country: "AE", status: "re_exported", days_until_expiry: 0 },
  { ucr: "NGR2026-019-KANO", hs_code: "0901.11.00", description: "Coffee, not roasted, not decaffeinated", quantity_kg: 5000, volume_cbm: 8, declared_value: 3500000, origin_country: "ET", status: "in_bond", days_until_expiry: 35 },
  { ucr: "NGR2026-020-ONNE", hs_code: "8411.12.00", description: "Turbo-jet engines, thrust > 25kN", quantity_kg: 8000, volume_cbm: 30, declared_value: 420000000, origin_country: "US", status: "in_bond", days_until_expiry: 200 },
];

const DEMO_PERMITS = [
  { permit_number: "EBP-2026-0001", ucr: "NGR2026-011-APAPA", payment_reference: "PAY-2026-EBP-001", exit_reason: "ex_bonded", status: "active", days_until_expiry: 25 },
  { permit_number: "EBP-2026-0002", ucr: "NGR2026-012-TINCI", payment_reference: "PAY-2026-EBP-002", exit_reason: "ex_bonded", status: "active", days_until_expiry: 10 },
  { permit_number: "EBP-2026-0003", ucr: "NGR2026-018-TINCI", payment_reference: "PAY-2026-EBP-003", exit_reason: "re_exported", status: "active", days_until_expiry: 5 },
  { permit_number: "EBP-2026-0004", ucr: "NGR2026-007-ONNE", payment_reference: "PAY-2026-EBP-004", exit_reason: "ex_bonded", status: "active", days_until_expiry: 45 },
  { permit_number: "EBP-2026-0005", ucr: "NGR2026-004-TINCI", payment_reference: "PAY-2026-EBP-005", exit_reason: "ex_bonded", status: "active", days_until_expiry: 60 },
  { permit_number: "EBP-2025-0088", ucr: "NGR2026-002-APAPA", payment_reference: "PAY-2025-EBP-088", exit_reason: "ex_bonded", status: "expired", days_until_expiry: -15 },
  { permit_number: "EBP-2025-0091", ucr: "NGR2026-008-KANO", payment_reference: "PAY-2025-EBP-091", exit_reason: "ex_bonded", status: "expired", days_until_expiry: -30 },
  { permit_number: "EBP-2026-0006", ucr: "NGR2026-016-LAGOS", payment_reference: "PAY-2026-EBP-006", exit_reason: "ex_bonded", status: "active", days_until_expiry: 90 },
  { permit_number: "EBP-2026-0007", ucr: "NGR2026-017-APAPA", payment_reference: "PAY-2026-EBP-007", exit_reason: "ex_bonded", status: "active", days_until_expiry: 75 },
  { permit_number: "EBP-2026-0008", ucr: "NGR2026-014-APAPA", payment_reference: "PAY-2026-EBP-008", exit_reason: "ex_bonded", status: "active", days_until_expiry: 3 },
];

// ─── CEP Patterns ─────────────────────────────────────────────────────────────

const DEMO_CEP_PATTERNS = [
  {
    pattern_id: "CAROUSEL_FRAUD",
    name: "Carousel Fraud Detection",
    description: "Detects circular import/export patterns where goods are repeatedly imported and exported to claim VAT refunds fraudulently. Triggers when same UCR appears in >3 declarations within 30 days.",
    status: "enabled",
    parameters: { threshold: 3, window_days: 30, min_value: 1000000 },
  },
  {
    pattern_id: "SPLIT_CONSIGNMENT",
    name: "Split Consignment Evasion",
    description: "Identifies deliberate splitting of large consignments into smaller shipments to evade duty thresholds. Triggers when same trader submits >5 declarations for same HS chapter within 48 hours.",
    status: "enabled",
    parameters: { max_declarations: 5, window_hours: 48, same_hs_chapter: true },
  },
  {
    pattern_id: "VALUATION_ANOMALY",
    name: "Customs Valuation Anomaly",
    description: "Flags declarations where declared CIF value deviates >40% below WCO reference price for the HS code. Indicates under-invoicing to reduce duty liability.",
    status: "enabled",
    parameters: { deviation_threshold_pct: 40, min_value: 500000, check_wco_price: true },
  },
  {
    pattern_id: "SUSPICIOUS_ROUTING",
    name: "Suspicious Country-of-Origin Routing",
    description: "Detects goods routed through high-risk transshipment hubs to obscure true origin. Triggers when declared origin differs from vessel AIS routing by >2 intermediate ports.",
    status: "enabled",
    parameters: { max_transshipment_ports: 2, high_risk_hubs: ["AEDXB", "SGSIN", "HKHKG"], check_ais: true },
  },
  {
    pattern_id: "RAPID_MULTI_DECL",
    name: "Rapid Multi-Declaration Burst",
    description: "Alerts when a single trader submits >5 declarations within a 1-hour window, which may indicate automated fraud or system abuse.",
    status: "enabled",
    parameters: { max_declarations: 5, window_hours: 1 },
  },
];

// ─── Cost Records ─────────────────────────────────────────────────────────────

const DEMO_COST_RECORDS = [
  // Last 3 months of infrastructure costs
  ...["2026-04", "2026-05", "2026-06"].flatMap((month) => [
    { month, tenant: "platform", namespace: "infra", service: "kubernetes-cluster", category: "compute", amount_usd: 4200 + Math.round(Math.random() * 400) },
    { month, tenant: "platform", namespace: "infra", service: "postgresql", category: "database", amount_usd: 980 + Math.round(Math.random() * 120) },
    { month, tenant: "platform", namespace: "infra", service: "redis", category: "other", amount_usd: 280 + Math.round(Math.random() * 40) },
    { month, tenant: "platform", namespace: "infra", service: "opensearch", category: "other", amount_usd: 650 + Math.round(Math.random() * 80) },
    { month, tenant: "platform", namespace: "infra", service: "kafka", category: "other", amount_usd: 420 + Math.round(Math.random() * 60) },
    { month, tenant: "platform", namespace: "storage", service: "s3-documents", category: "storage", amount_usd: 180 + Math.round(Math.random() * 30) },
    { month, tenant: "platform", namespace: "network", service: "load-balancer", category: "network", amount_usd: 320 + Math.round(Math.random() * 50) },
    { month, tenant: "platform", namespace: "network", service: "cdn", category: "network", amount_usd: 140 + Math.round(Math.random() * 20) },
    { month, tenant: "customs", namespace: "app", service: "declaration-engine", category: "compute", amount_usd: 1200 + Math.round(Math.random() * 150) },
    { month, tenant: "customs", namespace: "app", service: "risk-engine", category: "compute", amount_usd: 800 + Math.round(Math.random() * 100) },
    { month, tenant: "customs", namespace: "app", service: "ai-risk-scorer", category: "compute", amount_usd: 600 + Math.round(Math.random() * 80) },
    { month, tenant: "customs", namespace: "app", service: "cargo-tracking", category: "compute", amount_usd: 400 + Math.round(Math.random() * 60) },
    { month, tenant: "oga", namespace: "app", service: "oga-hub", category: "compute", amount_usd: 350 + Math.round(Math.random() * 50) },
    { month, tenant: "payments", namespace: "app", service: "mojaloop", category: "compute", amount_usd: 900 + Math.round(Math.random() * 120) },
    { month, tenant: "payments", namespace: "app", service: "tigerbeetle-bridge", category: "compute", amount_usd: 250 + Math.round(Math.random() * 40) },
  ]),
];

// ─── Seed Functions ───────────────────────────────────────────────────────────

export async function seedBondedWarehouses(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM bonded_warehouses");
    if (parseInt(count, 10) > 0) return; // already seeded

    // Insert warehouses and collect their IDs
    const warehouseIds: number[] = [];
    for (let idx = 0; idx < DEMO_WAREHOUSES.length; idx++) {
      const wh = DEMO_WAREHOUSES[idx];
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + wh.bond_expiry_days);
      const licenseNo = `BWL-2026-${String(idx + 1).padStart(4, "0")}`;
      const [row] = await pgQuery<{ id: number }>(
        `INSERT INTO bonded_warehouses
          (license_no, name, operator_name, address, port_code, capacity_cbm, used_cbm,
           bond_amount_usd, bond_expiry, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,NOW(),NOW())
         ON CONFLICT (license_no) DO NOTHING RETURNING id`,
        [licenseNo, wh.name, wh.operator_name, wh.address, wh.port_code, wh.capacity_cbm,
         wh.bond_amount, expiryDate.toISOString(), wh.status]
      );
      if (row) warehouseIds.push(row.id);
    }

    // Insert inventory items spread across warehouses
    const warehouseMap: Record<string, number> = {
      "APAPA": warehouseIds[0],
      "TINCI": warehouseIds[1],
      "ONNE": warehouseIds[2],
      "KANO": warehouseIds[3],
      "CALB": warehouseIds[4],
      "LAGOS": warehouseIds[5],
    };
    const inventoryIdMap: Record<string, number> = {};
    for (const item of DEMO_INVENTORY) {
      const portKey = Object.keys(warehouseMap).find((k) => item.ucr.includes(k)) ?? "APAPA";
      const warehouseId = warehouseMap[portKey] ?? warehouseIds[0];
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + (item.days_until_expiry > 0 ? item.days_until_expiry : 365));
      const [invRow] = await pgQuery<{ id: number }>(
        `INSERT INTO bonded_inventory
          (warehouse_id, declaration_id, ucr, hs_code, description, quantity_kg, volume_cbm,
           invoice_value_usd, duty_liability_usd, origin_country, deposited_at, expiry_date, status, created_at)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,0,$8,NOW(),$9,$10,NOW())
         ON CONFLICT DO NOTHING RETURNING id`,
        [warehouseId, item.ucr, item.hs_code, item.description, item.quantity_kg, item.volume_cbm,
         item.declared_value, item.origin_country, expiryDate.toISOString(), item.status]
      );
      if (invRow) inventoryIdMap[item.ucr] = invRow.id;
      // Update used_cbm for in_bond items
      if (item.status === "in_bond") {
        await pgQuery(
          "UPDATE bonded_warehouses SET used_cbm = used_cbm + $1, updated_at = NOW() WHERE id = $2",
          [item.volume_cbm, warehouseId]
        );
      }
    }

    // Insert permits — requires inventory_id from inventoryIdMap
    for (const permit of DEMO_PERMITS) {
      const portKey = Object.keys(warehouseMap).find((k) => permit.ucr.includes(k)) ?? "APAPA";
      const warehouseId = warehouseMap[portKey] ?? warehouseIds[0];
      const inventoryId = inventoryIdMap[permit.ucr];
      if (!inventoryId) continue; // skip if inventory item wasn't inserted
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + permit.days_until_expiry);
      await pgQuery(
        `INSERT INTO ex_bond_permits
          (permit_no, inventory_id, warehouse_id, requested_by_id, quantity_kg,
           duty_paid_usd, payment_ref, status, issued_at, expires_at, created_at)
         VALUES ($1,$2,$3,NULL,0,0,$4,$5,NOW(),$6,NOW())
         ON CONFLICT (permit_no) DO NOTHING`,
        [permit.permit_number, inventoryId, warehouseId, permit.payment_reference, permit.status, expiryDate.toISOString()]
      );
    }
    console.log("[Seed] bonded_warehouses, bonded_inventory, ex_bond_permits seeded successfully");
  } catch (err) {
    console.warn("[Seed] bondedWarehouses seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

export async function seedCepPatterns(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM cep_patterns");
    if (parseInt(count, 10) > 0) return; // already seeded

    for (const pattern of DEMO_CEP_PATTERNS) {
      await pgQuery(
        `INSERT INTO cep_patterns (pattern_id, name, description, status, parameters, trigger_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,0,NOW(),NOW())
         ON CONFLICT (pattern_id) DO NOTHING`,
        [pattern.pattern_id, pattern.name, pattern.description, pattern.status, JSON.stringify(pattern.parameters)]
      );
    }
    console.log("[Seed] cep_patterns seeded successfully");
  } catch (err) {
    console.warn("[Seed] cepPatterns seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

export async function seedCostRecords(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM cost_records");
    if (parseInt(count, 10) > 0) return; // already seeded

    for (const record of DEMO_COST_RECORDS) {
      // period_date = first day of the month
      const periodDate = `${record.month}-01`;
      const compute = record.category === "compute" ? record.amount_usd : 0;
      const storage = record.category === "storage" ? record.amount_usd : 0;
      const network = record.category === "network" ? record.amount_usd : 0;
      const total = record.amount_usd;
      await pgQuery(
        `INSERT INTO cost_records (tenant_name, namespace, service, category, period_date,
           compute_cost_usd, storage_cost_usd, network_cost_usd, total_cost_usd, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [record.tenant, record.namespace, record.service, record.category, periodDate,
         compute, storage, network, total]
      );
    }
    console.log("[Seed] cost_records seeded successfully");
  } catch (err) {
    console.warn("[Seed] costRecords seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── Port Locations ──────────────────────────────────────────────────────────

const DEMO_PORT_LOCATIONS = [
  { port_code: "NGAPP", port_name: "Apapa Port", country: "NGA", latitude: 6.4281, longitude: 3.3784, port_type: "seaport" },
  { port_code: "NGTCI", port_name: "Tin Can Island Port", country: "NGA", latitude: 6.4392, longitude: 3.3302, port_type: "seaport" },
  { port_code: "NGONN", port_name: "Onne Port", country: "NGA", latitude: 4.7095, longitude: 7.1556, port_type: "seaport" },
  { port_code: "NGKAN", port_name: "Kano Inland Dry Port", country: "NGA", latitude: 12.0022, longitude: 8.5920, port_type: "dry_port" },
  { port_code: "NGCBQ", port_name: "Calabar Port", country: "NGA", latitude: 4.9517, longitude: 8.3220, port_type: "seaport" },
  { port_code: "NGLOS", port_name: "Lagos Airport Cargo", country: "NGA", latitude: 6.5774, longitude: 3.3212, port_type: "airport" },
  { port_code: "NGWAR", port_name: "Warri Port", country: "NGA", latitude: 5.5167, longitude: 5.7500, port_type: "seaport" },
  { port_code: "NGPHE", port_name: "Port Harcourt Port", country: "NGA", latitude: 4.7799, longitude: 7.0134, port_type: "seaport" },
];

export async function seedPortLocations(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM port_locations");
    if (parseInt(count, 10) > 0) return;
    for (const port of DEMO_PORT_LOCATIONS) {
      await pgQuery(
        `INSERT INTO port_locations (port_code, port_name, country, latitude, longitude, port_type, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,NOW())
         ON CONFLICT (port_code) DO NOTHING`,
        [port.port_code, port.port_name, port.country, port.latitude, port.longitude, port.port_type]
      );
    }
    console.log("[Seed] port_locations seeded successfully");
  } catch (err) {
    console.warn("[Seed] portLocations seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── Vessel Tracking Events ──────────────────────────────────────────────────

export async function seedVesselTrackingEvents(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM vessel_tracking_events");
    if (parseInt(count, 10) > 0) return;

    const VESSELS = [
      { mmsi: "636092123", name: "MV APAPA STAR",    imo: "9876543", lat: 6.45,  lon: 3.38,  speed: 0.0,  heading: 0,   dest: "APAPA",   eta: 0,  cargo: "general_cargo",   flag: "NGA" },
      { mmsi: "636091456", name: "MV TINCAN BRIDGE", imo: "9765432", lat: 6.43,  lon: 3.35,  speed: 2.1,  heading: 270, dest: "TINCAN",  eta: 2,  cargo: "container",       flag: "NGA" },
      { mmsi: "566234789", name: "PACIFIC TRADER",   imo: "9654321", lat: 5.20,  lon: 2.80,  speed: 12.4, heading: 85,  dest: "APAPA",   eta: 18, cargo: "bulk_carrier",    flag: "SGP" },
      { mmsi: "477890123", name: "ORIENT EXPRESS",   imo: "9543210", lat: 4.50,  lon: 2.10,  speed: 14.2, heading: 75,  dest: "APAPA",   eta: 36, cargo: "container",       flag: "HKG" },
      { mmsi: "255678901", name: "ATLANTIC VOYAGER", imo: "9432109", lat: 3.80,  lon: 1.50,  speed: 13.8, heading: 80,  dest: "ONNE",    eta: 48, cargo: "tanker",          flag: "PRT" },
      { mmsi: "636093789", name: "MV ONNE PIONEER",  imo: "9321098", lat: 4.30,  lon: 7.15,  speed: 0.0,  heading: 0,   dest: "ONNE",    eta: 0,  cargo: "general_cargo",   flag: "NGA" },
      { mmsi: "636094012", name: "MV CALABAR CHIEF", imo: "9210987", lat: 4.95,  lon: 8.32,  speed: 1.5,  heading: 180, dest: "CALABAR", eta: 4,  cargo: "bulk_carrier",    flag: "NGA" },
      { mmsi: "357123456", name: "GULF CARRIER",     imo: "9109876", lat: 6.80,  lon: 4.20,  speed: 11.0, heading: 200, dest: "APAPA",   eta: 12, cargo: "tanker",          flag: "GBR" },
    ];

    for (const v of VESSELS) {
      const etaDate = new Date();
      etaDate.setHours(etaDate.getHours() + v.eta);
      await pgQuery(
        `INSERT INTO vessel_tracking_events
          (mmsi, vessel_name, imo_number, latitude, longitude, speed, heading, destination_port, eta, cargo_type, flag_country, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [v.mmsi, v.name, v.imo, v.lat, v.lon, v.speed, v.heading, v.dest, v.eta > 0 ? etaDate.toISOString() : null, v.cargo, v.flag]
      );
    }
    console.log("[Seed] vessel_tracking_events seeded successfully");
  } catch (err) {
    console.warn("[Seed] vesselTrackingEvents seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── Port Congestion Events ──────────────────────────────────────────────────

export async function seedPortCongestionEvents(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM port_congestion_events");
    if (parseInt(count, 10) > 0) return;

    const PORT_EVENTS = [
      { code: "NGAPP",  status: "congested", vessels: 42, waitHours: 18.5, backlog: 320, queue: 45 },
      { code: "NGTIN",  status: "moderate",  vessels: 28, waitHours: 8.2,  backlog: 180, queue: 22 },
      { code: "NGONNE", status: "clear",     vessels: 15, waitHours: 3.1,  backlog: 65,  queue: 8 },
      { code: "NGCAL",  status: "clear",     vessels: 9,  waitHours: 2.0,  backlog: 28,  queue: 4 },
      { code: "NGWAR",  status: "moderate",  vessels: 18, waitHours: 6.5,  backlog: 95,  queue: 12 },
      { code: "NGKANO", status: "clear",     vessels: 0,  waitHours: 1.0,  backlog: 12,  queue: 2 },
      { code: "NGABJ",  status: "clear",     vessels: 0,  waitHours: 0.5,  backlog: 8,   queue: 1 },
      { code: "NGLOS",  status: "critical",  vessels: 58, waitHours: 36.0, backlog: 520, queue: 78 },
    ];

    for (const p of PORT_EVENTS) {
      await pgQuery(
        `INSERT INTO port_congestion_events
          (port_code, congestion_status, vessel_count, wait_time_hours, declaration_backlog, inspection_queue_size, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [p.code, p.status, p.vessels, p.waitHours, p.backlog, p.queue]
      );
    }
    console.log("[Seed] port_congestion_events seeded successfully");
  } catch (err) {
    console.warn("[Seed] portCongestionEvents seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── CEP Alerts ──────────────────────────────────────────────────────────

export async function seedCepAlerts(): Promise<void> {
  try {
    const [{ count }] = await pgQuery<{ count: string }>("SELECT COUNT(*) as count FROM cep_alerts");
    if (parseInt(count, 10) > 0) return;

    // Get pattern IDs from DB
    const patterns = await pgQuery<{ pattern_id: string; name: string }>("SELECT pattern_id, name FROM cep_patterns");
    if (patterns.length === 0) return; // no patterns to link to

    const SEVERITIES = ["low", "medium", "high", "critical"] as const;
    const STATUSES = ["open", "open", "open", "investigating", "resolved", "false_positive"] as const;
    const DEMO_ALERTS = [
      { suffix: "001", patternIdx: 0, severity: "critical", status: "open", riskScore: 92,
        details: { ucr: "NG2026-APAPA-001234", hsCode: "8703.23", invoiceValue: 2500000, flagReason: "Invoice value 340% above HS chapter average" } },
      { suffix: "002", patternIdx: 1, severity: "high", status: "open", riskScore: 78,
        details: { ucr: "NG2026-APAPA-001235", hsCode: "2710.19", invoiceValue: 850000, flagReason: "Same trader filed 3 identical declarations in 48 hours" } },
      { suffix: "003", patternIdx: 2, severity: "high", status: "investigating", riskScore: 81,
        details: { ucr: "NG2026-TINCI-000891", hsCode: "8517.12", invoiceValue: 1200000, flagReason: "Declared origin mismatches bill of lading port of loading" } },
      { suffix: "004", patternIdx: 0, severity: "medium", status: "open", riskScore: 65,
        details: { ucr: "NG2026-ONNE-002201", hsCode: "1001.99", invoiceValue: 450000, flagReason: "Invoice value 210% above HS chapter average" } },
      { suffix: "005", patternIdx: 3, severity: "critical", status: "open", riskScore: 95,
        details: { ucr: "NG2026-APAPA-001240", hsCode: "8471.30", invoiceValue: 3800000, flagReason: "Trader on OFAC SDN watchlist match" } },
      { suffix: "006", patternIdx: 1, severity: "medium", status: "open", riskScore: 58,
        details: { ucr: "NG2026-APAPA-001241", hsCode: "4011.10", invoiceValue: 320000, flagReason: "Duplicate UCR detected across 2 declarations" } },
      { suffix: "007", patternIdx: 4, severity: "high", status: "open", riskScore: 74,
        details: { ucr: "NG2026-TINCI-000895", hsCode: "3004.90", invoiceValue: 980000, flagReason: "Declared weight inconsistent with container manifest" } },
      { suffix: "008", patternIdx: 2, severity: "low", status: "resolved", riskScore: 42,
        details: { ucr: "NG2026-ONNE-002205", hsCode: "7208.51", invoiceValue: 180000, flagReason: "Origin certificate issuer not in approved list" } },
      { suffix: "009", patternIdx: 0, severity: "high", status: "open", riskScore: 83,
        details: { ucr: "NG2026-APAPA-001250", hsCode: "8703.23", invoiceValue: 4200000, flagReason: "Invoice value 520% above HS chapter average" } },
      { suffix: "010", patternIdx: 3, severity: "medium", status: "false_positive", riskScore: 51,
        details: { ucr: "NG2026-KANO-000312", hsCode: "1005.90", invoiceValue: 270000, flagReason: "Trader name partial match on watchlist — confirmed legitimate" } },
      { suffix: "011", patternIdx: 1, severity: "critical", status: "open", riskScore: 97,
        details: { ucr: "NG2026-APAPA-001260", hsCode: "2710.19", invoiceValue: 7500000, flagReason: "5 declarations filed within 2 hours with identical consignee" } },
      { suffix: "012", patternIdx: 4, severity: "medium", status: "investigating", riskScore: 67,
        details: { ucr: "NG2026-TINCI-000900", hsCode: "8517.12", invoiceValue: 560000, flagReason: "Container weight 40% below declared net weight" } },
      { suffix: "013", patternIdx: 2, severity: "high", status: "open", riskScore: 79,
        details: { ucr: "NG2026-ONNE-002210", hsCode: "3004.90", invoiceValue: 1100000, flagReason: "Country of origin certificate issued after shipment date" } },
      { suffix: "014", patternIdx: 0, severity: "low", status: "resolved", riskScore: 38,
        details: { ucr: "NG2026-CALB-000145", hsCode: "1001.99", invoiceValue: 95000, flagReason: "Invoice value 150% above average — within acceptable range after review" } },
      { suffix: "015", patternIdx: 3, severity: "critical", status: "open", riskScore: 94,
        details: { ucr: "NG2026-APAPA-001270", hsCode: "8471.30", invoiceValue: 5200000, flagReason: "Entity matches INTERPOL Red Notice database" } },
    ];

    for (let i = 0; i < DEMO_ALERTS.length; i++) {
      const a = DEMO_ALERTS[i];
      const pattern = patterns[a.patternIdx % patterns.length];
      const detectedAt = new Date();
      detectedAt.setDate(detectedAt.getDate() - Math.floor(i * 1.5));
      await pgQuery(
        `INSERT INTO cep_alerts
          (alert_id, pattern_id, pattern_name, severity, status, details, risk_score, detected_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (alert_id) DO NOTHING`,
        [
          `CEP-2026-${a.suffix}`,
          pattern.pattern_id,
          pattern.name,
          a.severity,
          a.status,
          JSON.stringify(a.details),
          a.riskScore,
          detectedAt.toISOString(),
        ]
      );
    }
    console.log("[Seed] cep_alerts seeded successfully");
  } catch (err) {
    console.warn("[Seed] cepAlerts seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

export async function seedAllDemoData(): Promise<void> {
  await Promise.all([
    seedBondedWarehouses(),
    seedCepPatterns(),
    seedCostRecords(),
    seedPortLocations(),
    seedVesselTrackingEvents(),
    seedPortCongestionEvents(),
  ]);
  // cep_alerts must run after cep_patterns
  await seedCepAlerts();
}
