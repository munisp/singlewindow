# Phase 28 (W1) — stateOps schema blocks

Merge the following into `drizzle/schema.ts` (suggested location: after the
Phase 24 blocks, or append at end). All imports needed (`pgTable`, `serial`,
`varchar`, `text`, `integer`, `decimal`, `doublePrecision`, `date`,
`timestamp`, `jsonb`, `index`) are already imported at the top of schema.ts.
Migration: `drizzle/migrations/0081_phase28_state_ops.sql`. Delete this file
after merging.

```ts
// ─── Phase 28 (W1): stateOps — state blue-economy revenue module ─────────────
// State licensing, concessions, aquaculture estates and blue-carbon MRV for
// Nigeria's eight coastal states. Migration 0081_phase28_state_ops.
export const stateLicenses = pgTable("state_licenses", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 64 }).notNull(),
  licenseType: varchar("license_type", { length: 32 }).notNull(),
  holderName: varchar("holder_name", { length: 255 }).notNull(),
  holderRef: varchar("holder_ref", { length: 128 }),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  feeAmount: decimal("fee_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_state_licenses_state").on(t.state),
  index("idx_state_licenses_type").on(t.licenseType),
  index("idx_state_licenses_status").on(t.status),
]);
export type StateLicense = typeof stateLicenses.$inferSelect;
export type InsertStateLicense = typeof stateLicenses.$inferInsert;

export const stateConcessions = pgTable("state_concessions", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 64 }).notNull(),
  concessionType: varchar("concession_type", { length: 32 }).notNull(),
  operatorName: varchar("operator_name", { length: 255 }).notNull(),
  annualFee: decimal("annual_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_state_concessions_state").on(t.state),
  index("idx_state_concessions_type").on(t.concessionType),
]);
export type StateConcession = typeof stateConcessions.$inferSelect;
export type InsertStateConcession = typeof stateConcessions.$inferInsert;

export const aquacultureEstates = pgTable("aquaculture_estates", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  hectares: doublePrecision("hectares").notNull().default(0),
  leaseFeeAnnual: decimal("lease_fee_annual", { precision: 14, scale: 2 }).notNull().default("0"),
  operatorName: varchar("operator_name", { length: 255 }),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_aquaculture_estates_state").on(t.state),
]);
export type AquacultureEstate = typeof aquacultureEstates.$inferSelect;
export type InsertAquacultureEstate = typeof aquacultureEstates.$inferInsert;

export const blueCarbonProjects = pgTable("blue_carbon_projects", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  ecosystem: varchar("ecosystem", { length: 32 }).notNull(),
  areaHa: doublePrecision("area_ha").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("PROPOSED"),
  creditsIssued: decimal("credits_issued", { precision: 14, scale: 2 }).notNull().default("0"),
  pricePerTonne: decimal("price_per_tonne", { precision: 10, scale: 2 }),
  registryRef: varchar("registry_ref", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_blue_carbon_projects_state").on(t.state),
  index("idx_blue_carbon_projects_status").on(t.status),
]);
export type BlueCarbonProject = typeof blueCarbonProjects.$inferSelect;
export type InsertBlueCarbonProject = typeof blueCarbonProjects.$inferInsert;

export const mrvEvidence = pgTable("mrv_evidence", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => blueCarbonProjects.id),
  evidenceType: varchar("evidence_type", { length: 32 }).notNull(),
  period: varchar("period", { length: 16 }),
  co2Tonnes: decimal("co2_tonnes", { precision: 14, scale: 2 }).notNull().default("0"),
  documentUri: text("document_uri"),
  verificationHash: varchar("verification_hash", { length: 128 }),
  verifier: varchar("verifier", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_mrv_evidence_project").on(t.projectId),
]);
export type MrvEvidence = typeof mrvEvidence.$inferSelect;
export type InsertMrvEvidence = typeof mrvEvidence.$inferInsert;
```

Note: DB column `currency` is `char(3)` in the migration; the schema block
maps it as `varchar(3)` to avoid adding a new `char` import — functionally
equivalent for reads/writes of a 3-letter code.
