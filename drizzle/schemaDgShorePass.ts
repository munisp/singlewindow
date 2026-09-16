/**
 * schemaDgShorePass.ts — Phase 19 (F5a) drizzle tables, deliberately kept OUT
 * of the central drizzle/schema.ts so concurrent workstreams do not conflict
 * on the shared index file. The physical DDL lives in
 * drizzle/migrations/0071_phase19_imdg_dg_shore_pass.sql (hand-written minimal
 * delta, 0069/0070 precedent).
 *
 * Design note — the DG flag: a declaration is "dangerous-goods flagged" by
 * the EXISTENCE of ≥1 row in declaration_dg_items (derived, never stored),
 * so the flag can never go stale. Officer views join items → declarations.
 */
import {
  pgTable, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, index,
} from "drizzle-orm/pg-core";
import { declarations, users } from "./schema";

// ─── PHASE 19 (F5a): IMDG dangerous-goods line items (A5-B9) ────────────────
// Structural IMDG validation lives in server/_core/imdg.ts; no substance DB.
export const declarationDgItems = pgTable("declaration_dg_items", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  unNumber: varchar("un_number", { length: 4 }).notNull(),
  imoClass: varchar("imo_class", { length: 8 }).notNull(),
  packingGroup: varchar("packing_group", { length: 8 }),
  properShippingName: varchar("proper_shipping_name", { length: 256 }).notNull(),
  flashpointCelsius: decimal("flashpoint_celsius", { precision: 6, scale: 1 }),
  emsCodes: json("ems_codes"),
  marinePollutant: boolean("marine_pollutant").default(false).notNull(),
  quantityDescription: varchar("quantity_description", { length: 256 }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_dg_items_declaration").on(t.declarationId),
  index("idx_dg_items_un_number").on(t.unNumber),
]);
export type DeclarationDgItem = typeof declarationDgItems.$inferSelect;
export type InsertDeclarationDgItem = typeof declarationDgItems.$inferInsert;

// ─── PHASE 19 (F5a): shore-pass / crew-change applications (A5-C5) ──────────
// State machine: SUBMITTED → APPROVED | REJECTED; APPROVED → REVOKED | EXPIRED.
export const shorePassApplications = pgTable("shore_pass_applications", {
  id: serial("id").primaryKey(),
  applicationNumber: varchar("application_number", { length: 32 }).notNull().unique(),
  vesselImoNumber: varchar("vessel_imo_number", { length: 7 }).notNull(),
  voyageNumber: varchar("voyage_number", { length: 64 }).notNull(),
  portCode: varchar("port_code", { length: 5 }).notNull(),
  crewFamilyName: varchar("crew_family_name", { length: 128 }).notNull(),
  crewGivenNames: varchar("crew_given_names", { length: 128 }).notNull(),
  crewNationalityCode: varchar("crew_nationality_code", { length: 2 }).notNull(),
  crewRankOrRating: varchar("crew_rank_or_rating", { length: 64 }).notNull(),
  crewDateOfBirth: varchar("crew_date_of_birth", { length: 10 }).notNull(),
  purpose: text("purpose").notNull(),
  stcwCertificateNumber: varchar("stcw_certificate_number", { length: 64 }),
  /** NOT_REQUESTED | VERIFIED | FAILED | NOT_CONFIGURED — approval is gated on VERIFIED/NOT_REQUESTED. */
  verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("NOT_REQUESTED"),
  verificationOutcome: varchar("verification_outcome", { length: 16 }),
  status: varchar("status", { length: 16 }).notNull().default("SUBMITTED"),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  decidedBy: integer("decided_by").references(() => users.id),
  decisionReason: text("decision_reason"),
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_shore_pass_vessel").on(t.vesselImoNumber, t.voyageNumber),
  index("idx_shore_pass_status").on(t.status),
  index("idx_shore_pass_requested_by").on(t.requestedBy),
]);
export type ShorePassApplication = typeof shorePassApplications.$inferSelect;
export type InsertShorePassApplication = typeof shorePassApplications.$inferInsert;

/** Append-only shore-pass audit trail — every transition writes one row. */
export const shorePassEvents = pgTable("shore_pass_events", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => shorePassApplications.id),
  action: varchar("action", { length: 32 }).notNull(),
  fromStatus: varchar("from_status", { length: 16 }),
  toStatus: varchar("to_status", { length: 16 }),
  actorId: integer("actor_id").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_shore_pass_events_app").on(t.applicationId)]);
export type ShorePassEvent = typeof shorePassEvents.$inferSelect;
export type InsertShorePassEvent = typeof shorePassEvents.$inferInsert;
