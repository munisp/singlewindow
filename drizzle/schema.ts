import {
  pgTable, pgEnum, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, jsonb, bigint, index, unique, uniqueIndex, real, uuid, date, check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "customs_officer", "oga_officer", "inspector", "finance"]);

// Phase 20 (GAP 9): account lifecycle status for offboarding/suspension.
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "offboarded"]);

// Phase 20 (GAP 1): maker-checker lifecycle for privileged role grants.
export const roleRequestStatusEnum = pgEnum("role_request_status", ["pending", "approved", "rejected"]);

// Phase 20 (GAP 4): maker-checker lifecycle for elevated API-key scope grants.
export const apiScopeRequestStatusEnum = pgEnum("api_scope_request_status", ["pending", "approved", "rejected"]);

export const stakeholderTypeEnum = pgEnum("stakeholder_type", [
  "trader", "customs_officer", "oga_officer", "freight_forwarder",
  "bank_officer", "port_authority", "system_admin", "auditor"
]);

export const profileStatusEnum = pgEnum("profile_status", [
  "pending", "under_review", "approved", "suspended", "rejected"
]);

export const aeoStatusEnum = pgEnum("aeo_status", [
  "none", "applied", "certified", "suspended"
]);

export const aeoTierEnum = pgEnum("aeo_tier", ["standard", "silver", "gold"]);

export const declarationTypeEnum = pgEnum("declaration_type", [
  "import", "export", "transit", "re_export", "transshipment"
]);

export const declarationStatusEnum = pgEnum("declaration_status", [
  "draft", "submitted", "under_assessment", "docs_required",
  "payment_pending", "payment_confirmed", "under_examination",
  "examination_complete", "cleared", "rejected", "cancelled",
  "held_sanctions"
]);

export const riskLaneEnum = pgEnum("risk_lane", ["green", "yellow", "red", "blue"]);

export const documentTypeEnum = pgEnum("document_type", [
  "commercial_invoice", "bill_of_lading", "packing_list",
  "certificate_of_origin", "phytosanitary_cert", "import_permit",
  "export_permit", "insurance_cert", "customs_bond", "other"
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending", "verified", "rejected"
]);

export const permitStatusEnum = pgEnum("permit_status", [
  "pending", "under_review", "approved", "rejected", "not_required"
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer", "mobile_money", "card", "bond"
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending", "processing", "confirmed", "failed", "refunded"
]);

export const auditEntityEnum = pgEnum("audit_entity", [
  "declaration", "user", "payment", "permit", "document",
  "aeo_application", "kyc_verification",
  "privileged_action", "four_eyes_request"
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "critical", "high", "medium", "low", "info"
]);

export const alertCategoryEnum = pgEnum("alert_category", [
  "authentication", "network", "integrity", "anomaly", "compliance"
]);

export const sanctionsResultEnum = pgEnum("sanctions_result", [
  "clear", "potential_match", "confirmed_match"
]);

export const sanctionsEntityEnum = pgEnum("sanctions_entity", [
  "individual", "company", "vessel", "aircraft"
]);

export const aeoAppStatusEnum = pgEnum("aeo_app_status", [
  "draft", "submitted", "under_review", "site_inspection_scheduled",
  "site_inspection_done", "approved", "rejected", "suspended"
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "declaration_submitted", "declaration_cleared", "declaration_rejected",
  "payment_confirmed", "permit_approved", "permit_rejected",
  "document_required", "aeo_status_update", "security_alert", "system",
  "declaration_status_change", "permit_expiry_warning", "fraud_case_opened",
  "fraud_case_assigned", "sla_breach", "kyc_approved", "kyc_rejected",
  "duty_payment_due", "clearance_complete", "general",
  // Phase 8 PCS trader portal (R6): event-driven port-community notifications.
  "pcs_booking_confirmed", "pcs_gate_window", "pcs_berth_change", "pcs_invoice_issued"
]);

// ─── USERS & AUTH ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  // Phase 20 (GAP 9): suspended/offboarded accounts are rejected at auth time.
  status: userStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── ROLE REQUESTS (Phase 20, GAP 1) ─────────────────────────────────────────
// Privileged roles (customs_officer, oga_officer, inspector, finance, admin)
// can no longer be self-assigned; they require a maker-checker approval:
// the requester (maker) submits, a DIFFERENT admin (checker) approves/rejects.
export const roleRequests = pgTable("role_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  requestedRole: userRoleEnum("requested_role").notNull(),
  status: roleRequestStatusEnum("status").default("pending").notNull(),
  reason: text("reason"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_role_requests_user_id").on(t.userId),
  index("idx_role_requests_status").on(t.status),
]);
export type RoleRequest = typeof roleRequests.$inferSelect;

// ─── API SCOPE ELEVATION REQUESTS (Phase 20, GAP 4) ──────────────────────────
// Elevated scopes (admin:all) are not self-issuable; they require the same
// maker-checker approval flow, per api-registry.json governance.
export const apiScopeRequests = pgTable("api_scope_requests", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeys.id),
  userId: integer("user_id").notNull().references(() => users.id),
  scope: varchar("scope", { length: 64 }).notNull(),
  status: apiScopeRequestStatusEnum("status").default("pending").notNull(),
  reason: text("reason"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_api_scope_requests_key").on(t.apiKeyId),
  index("idx_api_scope_requests_status").on(t.status),
]);
export type ApiScopeRequest = typeof apiScopeRequests.$inferSelect;



// ─── STAKEHOLDER PROFILES ────────────────────────────────────────────────────

export const stakeholderProfiles = pgTable("stakeholder_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  stakeholderType: stakeholderTypeEnum("stakeholder_type").notNull(),
  organizationName: varchar("organization_name", { length: 255 }),
  organizationCode: varchar("organization_code", { length: 64 }),
  licenseNumber: varchar("license_number", { length: 128 }),
  taxId: varchar("tax_id", { length: 64 }),
  country: varchar("country", { length: 3 }),
  phone: varchar("phone", { length: 32 }),
  status: profileStatusEnum("status").default("pending").notNull(),
  aeoStatus: aeoStatusEnum("aeo_status").default("none").notNull(),
  aeoTier: aeoTierEnum("aeo_tier").default("standard"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sp_user_id").on(t.userId),
  index("idx_sp_status").on(t.status),
]);

export type StakeholderProfile = typeof stakeholderProfiles.$inferSelect;
