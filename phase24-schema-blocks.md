# Phase 24 — schema.ts pgTable blocks (TEMPORARY — lead will merge into drizzle/schema.ts and delete this file)

Migration files already on this branch: `0077_phase24_cen_alerts.sql`, `0078_phase24_free_zones.sql`,
`0079_phase24_mojaloop_payment_state.sql`, `0080_phase24_temporal_query_projection.sql` (journal idx 77–80).

## 1. NEW table `cen_alerts` (migration 0077, cen-service)

```ts
export const cenAlerts = pgTable("cen_alerts", {
  id: text("id").primaryKey(),
  direction: varchar("direction", { length: 16 }).notNull(),
  partnerCode: varchar("partner_code", { length: 16 }).notNull(),
  alertType: varchar("alert_type", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  traderRef: varchar("trader_ref", { length: 128 }).notNull().default(""),
  ucr: varchar("ucr", { length: 64 }).notNull().default(""),
  hsCode: varchar("hs_code", { length: 16 }).notNull().default(""),
  riskScore: doublePrecision("risk_score").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull(),
  xmlPayload: text("xml_payload").notNull().default(""),
  correlatedWith: jsonb("correlated_with").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_cen_alerts_status").on(t.status),
  index("idx_cen_alerts_severity").on(t.priority),
  index("idx_cen_alerts_direction").on(t.direction),
  index("idx_cen_alerts_created").on(t.createdAt),
]);
export type CenAlert = typeof cenAlerts.$inferSelect;
export type InsertCenAlert = typeof cenAlerts.$inferInsert;
```

## 2. NEW tables `free_zones` + `freezone_goods` (migration 0078, freezone-service)

Note: goods records were NOT mapped onto the existing `free_zone_operations` table —
that table models approval operations (operation_number/type, approvals), not inventory
with duty/transfer state; a dedicated table preserves all route shapes with less change.

```ts
export const freeZones = pgTable("free_zones", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 32 }).notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  operatorName: varchar("operator_name", { length: 255 }).notNull(),
  licenceNumber: varchar("licence_number", { length: 64 }).notNull(),
  zoneType: varchar("zone_type", { length: 32 }).notNull(),
  capacityM3: doublePrecision("capacity_m3").notNull().default(0),
  usedM3: doublePrecision("used_m3").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_free_zones_status").on(t.status),
  index("idx_free_zones_code").on(t.code),
]);
export type FreeZone = typeof freeZones.$inferSelect;
export type InsertFreeZone = typeof freeZones.$inferInsert;

export const freezoneGoods = pgTable("freezone_goods", {
  id: text("id").primaryKey(),
  zoneId: text("zone_id").notNull(),
  ucr: varchar("ucr", { length: 64 }).notNull().default(""),
  traderRef: varchar("trader_ref", { length: 128 }).notNull().default(""),
  hsCode: varchar("hs_code", { length: 16 }).notNull().default(""),
  description: text("description").notNull().default(""),
  originCountry: varchar("origin_country", { length: 2 }).notNull().default(""),
  grossWeightKg: doublePrecision("gross_weight_kg").notNull().default(0),
  volumeM3: doublePrecision("volume_m3").notNull().default(0),
  invoiceValue: doublePrecision("invoice_value").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default(""),
  dutyRate: doublePrecision("duty_rate").notNull().default(0),
  dutyOwed: doublePrecision("duty_owed").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("ADMITTED"),
  currentZoneId: text("current_zone_id").notNull().default(""),
  exitDestination: varchar("exit_destination", { length: 16 }).notNull().default(""),
  exitDutyPaid: doublePrecision("exit_duty_paid").notNull().default(0),
  admittedAt: timestamp("admitted_at", { withTimezone: true }).defaultNow().notNull(),
  exitedAt: timestamp("exited_at", { withTimezone: true }),
  transferHistory: jsonb("transfer_history").notNull().default([]),
}, (t) => [
  index("idx_freezone_goods_status").on(t.status),
  index("idx_freezone_goods_current_zone").on(t.currentZoneId),
  index("idx_freezone_goods_zone").on(t.zoneId),
  index("idx_freezone_goods_ucr").on(t.ucr),
]);
export type FreezoneGoods = typeof freezoneGoods.$inferSelect;
export type InsertFreezoneGoods = typeof freezoneGoods.$inferInsert;
```

## 3. ALTER existing `mojaloopPayments` (migration 0079, mojaloop-gateway becomes writer)

Add these fields into the EXISTING `mojaloopPayments` pgTable def, and change
`traderId` / `payerFsp` to nullable (migration drops their NOT NULL; gateway writes
external string refs into `declarationRef` / `traderRef` instead of the FK integers):

```ts
  // Phase 24 additions (0079):
  declarationRef: varchar("declaration_ref", { length: 128 }),
  traderRef: varchar("trader_ref", { length: 128 }),
  fulfilment: text("fulfilment"),
  quote: jsonb("quote"),
  steps: jsonb("steps").notNull().default([]),
  assessmentId: varchar("assessment_id", { length: 64 }),
  tbPendingId: varchar("tb_pending_id", { length: 64 }),
  tbPostedAt: timestamp("tb_posted_at", { withTimezone: true }),
  errorCode: varchar("error_code", { length: 64 }),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  // changed: traderId: integer("trader_id").references(() => users.id),  // .notNull() removed
  // changed: payerFsp: varchar("payer_fsp", { length: 64 }),              // .notNull() removed
```

and add to its indexes array:

```ts
  index("idx_mj_payments_declaration_ref").on(t.declarationRef),
  index("idx_mj_payments_transfer_id").on(t.transferId),
```

## 4. ALTER existing `temporalWorkflowRuns` (migration 0080, temporal-query-service reads projection)

Add these fields into the EXISTING `temporalWorkflowRuns` pgTable def:

```ts
  // Phase 24 additions (0080):
  declarationRef: varchar("declaration_ref", { length: 64 }),
  traderRef: varchar("trader_ref", { length: 256 }),
  riskLane: varchar("risk_lane", { length: 16 }),
  currentStep: integer("current_step"),
  totalSteps: integer("total_steps"),
  activities: jsonb("activities"),
```

and add to its indexes array:

```ts
  index("idx_temporal_runs_declaration_ref").on(t.declarationRef),
```
