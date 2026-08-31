/**
 * generate.ts — schema-driven deterministic row generator.
 *
 * Walks every pgTable exported from drizzle/schema.ts, topologically orders
 * tables by foreign-key dependencies, and synthesises realistic rows.
 * Values are pure functions of (table, rowIndex, column) so reruns produce
 * identical rows and ON CONFLICT DO NOTHING makes them no-ops.
 */
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import {
  Rng, uuidFromSeed, serialId, daysBeforeEpoch, daysAfter, SEED_EPOCH, fnv1a,
} from "./deterministic";
import {
  NG_PORTS, NG_TERMINALS, NG_AGENCIES, VESSEL_NAMES, VesselTypes,
  HS_2022, CARGO_DESC, FIRST_NAMES, LAST_NAMES, COMPANY_SUFFIX,
  COMPANY_WORDS, BANKS_NG, INSURERS_NG, imoWithCheckDigit, mmsiNG,
} from "./domainData";

export interface TableDef {
  name: string;
  table: PgTable;
  /** [propertyKey, column] pairs — propertyKey is what drizzle insert expects. */
  columns: [string, Column][];
  fks: { column: string; refTable: string; refColumn: string }[];
}

/** Registry of all drizzle tables keyed by SQL table name. */
export function buildRegistry(): Map<string, TableDef> {
  const reg = new Map<string, TableDef>();
  for (const exported of Object.values(schema)) {
    if (!(exported instanceof PgTable)) continue;
    const cfg = getTableConfig(exported);
    const fks = cfg.foreignKeys.map((fk) => {
      const r = fk.reference();
      return {
        column: r.columns[0].name,
        refTable: getTableName(r.foreignTable as PgTable),
        refColumn: r.foreignColumns[0].name,
      };
    });
    reg.set(cfg.name, { name: cfg.name, table: exported, columns: Object.entries(getTableColumns(exported)) as [string, Column][], fks });
  }
  return reg;
}

/** Guess the parent table for a logical `*_id` column. */
export function softParentCandidates(colName: string): string[] {
  const m = colName.toLowerCase().match(/^(.+)_id$/) ?? colName.toLowerCase().match(/^(.+?)_?by$/);
  if (!m) return [];
  const base = m[1].replace(/^(assigned|reviewer|approved|created|updated|verified|submitted|registered|initiated|triggered|closed|opened|owned|reported|acted|performed|uploaded|shared|requested|granted)_/, "");
  return [
    `${base}s`, `${base}es`, base.replace(/y$/, "ies"),
    ["trader", "user", "officer", "admin", "reviewer", "inspector", "auditor", "operator"].includes(base) ? "users" : "",
  ].filter(Boolean);
}

/** Kahn topological sort; cycles are broken deterministically by name. */
export function topoSort(reg: Map<string, TableDef>): string[] {
  const deps = new Map<string, Set<string>>();
  for (const [name, def] of reg) {
    const d = new Set(def.fks.map((f) => f.refTable).filter((t) => t !== name && reg.has(t)));
    // Soft edges from logical `*_id` columns keep parents seeded first.
    for (const [, col] of def.columns) {
      for (const cand of softParentCandidates(col.name)) {
        if (cand !== name && reg.has(cand)) {
          d.add(cand);
          break;
        }
      }
    }
    deps.set(name, d);
  }
  const done: string[] = [];
  const remaining = new Set([...reg.keys()].sort());
  while (remaining.size) {
    let progressed = false;
    for (const name of [...remaining]) {
      const unmet = [...deps.get(name)!].filter((d) => remaining.has(d));
      if (unmet.length === 0) {
        done.push(name);
        remaining.delete(name);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cycle: take lexicographically smallest, proceed.
      const name = [...remaining].sort()[0];
      done.push(name);
      remaining.delete(name);
    }
  }
  return done;
}

/** Target row counts per table (defaults to DEFAULT_ROWS). */
export const DEFAULT_ROWS = 6;
export const ROW_COUNTS: Record<string, number> = {
  users: 60,
  stakeholder_profiles: 60,
  tenants: 5,
  tenant_users: 60,
  tenant_branding: 5,
  tenant_keycloak_config: 5,
  port_locations: 12, // 6 ports + 6 anchor terminals as locations
  geofences: 12,
  geofence_events: 40,
  vessel_tracking_events: 400, // 40 vessels × ~10 position reports
  declarations: 500,
  declaration_documents: 800,
  declaration_amendments: 60,
  declaration_risk_history: 500,
  oga_permits: 240, // 8 agencies × 30 permits
  oga_permit_events: 240,
  oga_bulk_actions: 12,
  payments: 450,
  payment_accounts: 12,
  payment_queue: 40,
  payment_risk_scores: 120,
  payment_idempotency_keys: 60,
  tigerbeetle_ledger_entries: 300,
  tigerbeetle_bonds: 30,
  tigerbeetle_penalties: 25,
  tigerbeetle_transit_guarantees: 20,
  audit_events: 600,
  notifications: 400,
  user_notifications: 200,
  manifests: 40, // one per vessel
  bills_of_lading: 160,
  ucrs: 120,
  lpco_records: 90,
  crf_documents: 60,
  msw_visits: 40, // port calls
  msw_declarations: 160,
  msw_clearances: 120,
  msw_boardings: 30,
  msw_pratique: 40,
  msw_agent_nominations: 40,
  msw_foreign_drafts: 24,
  valuation_references: 60,
  hs_classification_cache: HS_2022.flatMap((h) => h.sampleCodes).length,
  sanctions_checks: 200,
  sanctions_entities: 40,
  sanctions_watchlist_alerts: 15,
  security_alerts: 60,
  kyc_verifications: 45,
  kyc_documents: 90,
  kyc_events: 90,
  aeo_applications: 20,
  fraud_cases: 15,
  fraud_case_evidence: 30,
  fraud_case_notes: 30,
  fraud_case_links: 10,
  origin_certificates: 80,
  clearance_certificates: 120,
  duty_drawback_claims: 25,
  bonded_warehouses: 8,
  bonded_inventory: 60,
  ex_bond_permits: 20,
  bond_expiry_alerts: 15,
  free_zone_operations: 30,
  port_congestion_events: 36,
  port_congestion_alerts: 20,
  cost_records: 100,
  kpi_targets: 12,
  officer_workload_snapshots: 40,
  trader_ratings: 50,
  knowledge_graph_nodes: 80,
  knowledge_graph_edges: 120,
  webhook_subscriptions: 12,
  webhook_deliveries: 60,
  webhook_receipts: 40,
  api_keys: 16,
  api_usage_logs: 120,
  cron_run_logs: 40,
  stream_events: 80,
  kafka_event_log: 60,
  onboarding_progress: 30,
  onboarding_analytics: 30,
  checklist_templates: 10,
  post_clearance_audits: 20,
  post_clearance_audit_schedule: 12,
  audit_findings: 30,
  audit_tasks: 30,
  sla_escalations: 15,
  threat_intel_feeds: 8,
  insider_threat_events: 10,
  anomaly_detections: 25,
  risk_scan_results: 40,
  risk_model_configs: 4,
  vision_analyses: 40,
  vision_batch_jobs: 8,
  container_ocr_reads: 60,
  nl_query_templates: 10,
  nl_query_history: 30,
  bulk_exports: 12,
  batch_validation_errors: 20,
  export_schedules: 10,
  export_schedule_deliveries: 20,
  compliance_email_schedule: 6,
  compliance_email_delivery_log: 24,
  mojaloop_transactions: 30,
  mojaloop_payments: 30,
  document_vault: 60,
  document_versions: 80,
  document_shares: 30,
  notification_preferences: 60,
  notification_channel_preferences: 60,
  notification_digest_settings: 24,
  push_tokens: 24,
  keycloak_sessions: 30,
  session_audit_log: 60,
  api_changelog: 12,
  pilot_participants: 12,
  pilot_reports: 8,
  temporal_workflows: 10,
  temporal_workflow_runs: 30,
  trade_finance_consent_evidence: 30,
  schedule_dependencies: 12,
  schedule_delivery_stats: 12,
  system_heartbeat_jobs: 8,
  lakehouse_jobs: 12,
  geoip_cache: 20,
  geoip_seed_jobs: 4,
  fluvio_topic_offsets: 12,
  apisix_route_audit: 20,
  coraza_waf_rules: 10,
  open_appsec_events: 20,
  permify_audit_log: 40,
  domain_verification_events: 10,
  site_settings: 6,
  settings_audit_log: 12,
  threshold_audit_log: 12,
  health_thresholds: 8,
  soc_incidents: 12,
  asean_sw_messages: 16,
  cen_messages: 20,
  cep_patterns: 10,
  cep_alerts: 24,
  cep_suppression_log: 8,
  ab_divergence_log: 20,
  api_key_elevation_requests: 8,
  developer_organisations: 6,
  four_eyes_requests: 16,
  privileged_action_approvals: 16,
  freezone_reconciliation_runs: 8,
  pcs_billing_snapshots: 12,
  pcs_booking_links: 20,
  pcs_consignments: 40,
  pcs_milestones: 80,
  workflow_input_schemas: 8,
};

// ─── value synthesis ────────────────────────────────────────────────────────

export interface GenContext {
  table: string;
  rowIndex: number;
  fkPools: Map<string, unknown[]>; // parentTable -> pk values
  rng: Rng;
}

const DECL_STATUS_WEIGHTS: [string, number][] = [
  ["cleared", 40], ["payment_confirmed", 10], ["submitted", 12],
  ["under_assessment", 10], ["payment_pending", 8], ["under_examination", 6],
  ["examination_complete", 4], ["docs_required", 4], ["draft", 3],
  ["rejected", 2], ["cancelled", 1], ["held_sanctions", 1],
];

function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function companyName(rng: Rng): string {
  return `${rng.pick(COMPANY_WORDS)} ${rng.pick(["Merchants", "Cargo", "Marine", "Freight", "Commodities"])} ${rng.pick(COMPANY_SUFFIX)}`;
}

/** Deterministic value for one column. */
export function valueForColumn(col: Column, ctx: GenContext, fk?: TableDef["fks"][number]): unknown {
  const { rng, table, rowIndex } = ctx;
  const name = col.name.toLowerCase();
  const key = `${table}.${col.name}.${rowIndex}`;

  // 1. Foreign keys — draw from the seeded parent pool (keyed by
  // referenced table + column, since FKs may target non-PK unique columns).
  if (fk) {
    const pool = ctx.fkPools.get(`${fk.refTable}.${fk.refColumn}`) ?? ctx.fkPools.get(fk.refTable) ?? [];
    if (pool.length) return pool[fnv1a(key) % pool.length];
    if (!col.notNull) return null;
    // No parent rows available: fall through to type-based synthesis.
  } else {
    // 1b. Soft foreign keys: many schema relations are logical (`*_id`
    // without a DB-level constraint). Resolve `<entity>_id` against a
    // seeded pool when a matching table exists.
    if (col.columnType === "PgInteger" || col.columnType === "PgUUID" || col.columnType === "PgSerial") {
      for (const cand of softParentCandidates(col.name)) {
        const pool = ctx.fkPools.get(cand);
        if (pool?.length) return pool[fnv1a(key) % pool.length];
      }
      if (!col.notNull) return null;
    }
  }

  // 2. Primary keys — deterministic ids.
  if (col.primary) {
    if (col.columnType === "PgSerial" || col.columnType === "PgInteger" || col.columnType === "PgBigInt53" || col.columnType === "PgBigInt64")
      return serialId(table, rowIndex);
    if (col.columnType === "PgUUID") return uuidFromSeed(key);
    return `seed-${table}-${rowIndex}`;
  }

  // 3. Enum columns.
  if (col.enumValues?.length) {
    if (table === "declarations" && name === "status")
      return rng.weighted(DECL_STATUS_WEIGHTS.filter(([v]) => col.enumValues!.includes(v)));
    if (name === "role" && table === "users")
      return rng.weighted([
        ["user", 55], ["customs_officer", 15], ["oga_officer", 12],
        ["admin", 6], ["inspector", 7], ["finance", 5],
      ].filter(([v]) => col.enumValues!.includes(v)));
    return rng.pick(col.enumValues);
  }

  // 4. Name-based heuristics — text columns only (PgNumeric/PgDate etc.
  // have dataType 'string' too, so gate on the concrete column type).
  if (col.columnType === "PgVarchar" || col.columnType === "PgText" || col.columnType === "PgEnumColumn") {
    return stringValue(col, ctx, name, key) ?? textFallback(col, ctx, name, key);
  }
  return typedValue(col, ctx, name, key);
}

function stringValue(col: Column, ctx: GenContext, name: string, key: string): string | null {
  const { rng, table, rowIndex } = ctx;
  if (/^open_?id/.test(name)) return `seed-openid-${String(rowIndex).padStart(4, "0")}`;
  if (/email/.test(name)) {
    const domain = rowIndex % 3 === 0 ? rng.pick(NG_AGENCIES).domain : "example.ng";
    return `seed.user${rowIndex}@${domain}`;
  }
  if (/company|organisation|organization|operator|importer|exporter|consignee|shipper|agent_name|carrier/.test(name))
    return companyName(rng);
  if (/vessel|ship_?name/.test(name)) return rng.pick(VESSEL_NAMES);
  if (/(^|_)(first_?name|last_?name|full_?name|officer_?name|contact_?name|created_?by_?name)/.test(name) || name === "name" || name.endsWith("_name") && !/file|user_?name|table|column|event|workflow|feed|queue|topic|rule|template|job|type|method|channel/.test(name))
    return personName(rng);
  if (/phone|msisdn/.test(name)) return `+234${rng.pick(["803", "805", "807", "809", "810", "813", "816", "903"])}${String(rng.int(1000000, 9999999))}`;
  if (/imo/.test(name)) return imoWithCheckDigit(String(9000000 + fnv1a(key) % 99999).slice(0, 6).padStart(6, "0"));
  if (/mmsi/.test(name)) return mmsiNG(657000 + (fnv1a(key) % 9999));
  if (/hs_?code|commodity_?code|tariff/.test(name)) return rng.pick(HS_2022.flatMap((h) => h.sampleCodes));
  if (/locode/.test(name)) return rng.pick(NG_PORTS).locode;
  if (/port_?code/.test(name)) return rng.pick(NG_PORTS).locode;
  if (/port|terminal|berth/.test(name) && col.dataType === "string") return rng.pick(rng.chance(0.5) ? NG_PORTS.map((p) => p.name) : NG_TERMINALS.map((t) => t.name));
  if (/agency_?code|org_?code|oga_?code/.test(name)) return rng.pick(NG_AGENCIES).code;
  if (/agency|ministry|authority/.test(name) && col.dataType === "string") return rng.pick(NG_AGENCIES).name;
  if (/bank/.test(name) && col.dataType === "string") return rng.pick(BANKS_NG);
  if (/insur/.test(name) && col.dataType === "string") return rng.pick(INSURERS_NG);
  if (/currency/.test(name)) return "NGN";
  if (/country/.test(name)) return name.includes("code") ? (col.columnType === "PgVarchar" && (col as any).length === 2 ? "NG" : "NGA") : "Nigeria";
  if (/cargo|commodity|goods_?desc/.test(name)) return rng.pick(CARGO_DESC);
  if (/latitude|^lat$/.test(name)) return (4 + rng.float() * 10).toFixed(6);
  if (/longitude|^lng$|^lon$/.test(name)) return (2.5 + rng.float() * 12).toFixed(6);
  if (/ip_?addr|^ip$/.test(name)) return `10.${rng.int(0, 254)}.${rng.int(0, 254)}.${rng.int(1, 254)}`;
  if (/url|website|endpoint|callback/.test(name)) return `https://demo.singlewindow.ng/seed/${table}/${rowIndex}`;
  if (/token|secret|signature|fingerprint|checksum|api_?key|session/.test(name) && col.dataType === "string" && !/type|method|status|id$/.test(name))
    return rng.hex(32);
  if (/hash/.test(name)) return rng.hex(64);
  if (/^bl_?|^bill/.test(name) || /bl_?number|booking/.test(name)) return `BLNG${String(fnv1a(key) % 10 ** 9).padStart(9, "0")}`;
  if (/reference|_ref$|tracking|receipt|invoice|permit_?no|cert(ificate)?_?no|licen[cs]e|reg(istration)?_?no|document_?no|claim_?no|case_?no|_number$|_no$/.test(name))
    return `SW-${table.slice(0, 3).toUpperCase()}-${String(fnv1a(key) % 10 ** 8).padStart(8, "0")}`;
  if (/slug/.test(name)) return `seed-${table}-${rowIndex}`;
  if (/^title$|^subject$|_title$/.test(name)) return `Seed ${table.replace(/_/g, " ")} #${rowIndex}`;
  if (/description|summary|_notes?$|message|details|reason|remarks|comment/.test(name))
    return `Synthetic demo record (${table} #${rowIndex}) — Nigerian single-window seed data, not a real submission.`;
  if (/mmsi|imo/.test(name)) return String(657000000 + (fnv1a(key) % 99999));
  return null;
}

/** Final fallback for text columns. */
function textFallback(col: Column, ctx: GenContext, name: string, key: string): string {
  const { table, rowIndex } = ctx;
  let v = `seed-${table}-${name}-${rowIndex}`;
  const max = (col as unknown as { length?: number }).length;
  if (max && v.length > max) v = v.slice(0, max);
  return v;
}

/** Type-based synthesis for non-text columns. */
function typedValue(col: Column, ctx: GenContext, name: string, key: string): unknown {
  const { rng, table, rowIndex } = ctx;
  switch (col.columnType) {
    case "PgSerial":
      return serialId(table, rowIndex);
    case "PgUUID":
      return uuidFromSeed(key);
    case "PgBoolean":
      return rng.chance(0.7);
    case "PgSmallInt":
    case "PgInteger": {
      if (/count|quantity|qty|number|num_/.test(name)) return rng.int(1, 500);
      if (/year/.test(name)) return rng.int(2019, 2026);
      if (/month/.test(name)) return rng.int(1, 12);
      if (/day/.test(name)) return rng.int(1, 28);
      if (/hour/.test(name)) return rng.int(0, 23);
      if (/minute|second/.test(name)) return rng.int(0, 59);
      if (/percent|rate|score|ratio/.test(name)) return rng.int(1, 100);
      if (/port|_id$/.test(name)) return rng.int(1, 1000);
      return rng.int(1, 10000);
    }
    case "PgBigInt53":
    case "PgBigInt64": {
      // Money-like bigint columns are NGN kobo.
      const naira = rng.bigint(50_000n, 500_000_000n);
      const kobo = naira * 100n;
      return col.columnType === "PgBigInt64" ? kobo : Number(kobo);
    }
    case "PgReal":
      return Number((rng.float() * 100).toFixed(3));
    case "PgNumeric": {
      if (/lat|long|lng|lon/.test(name)) return (4 + rng.float() * 10).toFixed(6);
      if (/confidence|probability|score|ratio|rate|pct|percent/.test(name))
        return (rng.float() * 0.999 + 0.001).toFixed(4);
      if (/amount|duty|value|fee|total|balance|price|cost|penalty|charge/.test(name))
        return (rng.int(50_000, 50_000_000) * 100).toFixed(2); // kobo (NGN 50k–50m)
      const c = col as unknown as { precision?: number; scale?: number };
      if (c.precision) {
        const intDigits = Math.max(1, c.precision - (c.scale ?? 0));
        const max = 10 ** Math.min(intDigits, 8) - 1;
        return (rng.float() * max).toFixed(c.scale ?? 2);
      }
      return (rng.float() * 10000).toFixed(4);
    }
    case "PgTimestamp": {
      const d = /expir|valid_?until|due|end/.test(name)
        ? daysAfter(rng, new Date(SEED_EPOCH), 1, 180)
        : daysBeforeEpoch(rng, 90);
      // timestamp(mode:'string') expects an ISO string driver value.
      return col.dataType === "string" ? d.toISOString() : d;
    }
    case "PgDateString": {
      const d = daysBeforeEpoch(rng, 90);
      return col.dataType === "string" ? d.toISOString().slice(0, 10) : d;
    }
    case "PgJson":
    case "PgJsonb":
      return { seed: true, table, row: rowIndex, source: "scripts/seed" };
    case "PgArray":
      return [];
    default:
      break;
  }

  // 6. String fallback — deterministic.
  if (col.dataType === "string") {
    const max = (col as any).length as number | undefined;
    let v = `seed-${table}-${name}-${rowIndex}`;
    if (max && v.length > max) v = v.slice(0, max);
    return v;
  }
  return null;
}

/** Generate `count` rows for a table definition. */
export function generateRows(def: TableDef, count: number, fkPools: Map<string, unknown[]>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const rng = new Rng(`${def.name}:${i}`);
    const ctx: GenContext = { table: def.name, rowIndex: i, fkPools, rng };
    const row: Record<string, unknown> = {};
    for (const [prop, colRaw] of def.columns) {
      const col = colRaw;
      const c = col as Column & { hasDefault?: boolean };
      const fk = def.fks.find((f) => f.column === col.name);
      let value = valueForColumn(col, ctx, fk);
      // Clamp strings to varchar limits.
      const maxLen = (col as unknown as { length?: number }).length;
      if (typeof value === "string" && maxLen && value.length > maxLen) {
        value = value.slice(0, maxLen);
      }
      if (value === null && !col.notNull) {
        // 25% of nullable non-FK columns are left null for realism.
        if (!fk && rng.chance(0.25)) continue;
      }
      if (value === undefined || (value === null && col.notNull && (c as any).hasDefault)) continue;
      if (value === null && col.notNull && !(c as any).hasDefault) {
        throw new Error(`Cannot synthesise NOT NULL value for ${def.name}.${col.name}`);
      }
      row[prop] = value;
    }
    rows.push(row);
  }
  return rows;
}
