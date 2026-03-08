import {
  pgTable, pgEnum, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, bigint, index, unique
} from "drizzle-orm/pg-core";

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

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
  "import", "export", "transit", "re_export"
]);

export const declarationStatusEnum = pgEnum("declaration_status", [
  "draft", "submitted", "under_assessment", "docs_required",
  "payment_pending", "payment_confirmed", "under_examination",
  "examination_complete", "cleared", "rejected", "cancelled"
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
  "declaration", "user", "payment", "permit", "document"
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
  "document_required", "aeo_status_update", "security_alert", "system"
]);

// ─── USERS & AUTH ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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

// ─── DECLARATIONS ────────────────────────────────────────────────────────────

export const declarations = pgTable("declarations", {
  id: serial("id").primaryKey(),
  declarationNumber: varchar("declaration_number", { length: 32 }).notNull().unique(),
  ucr: varchar("ucr", { length: 64 }).unique(),
  traderId: integer("trader_id").notNull(),
  declarationType: declarationTypeEnum("declaration_type").notNull(),
  status: declarationStatusEnum("status").default("draft").notNull(),
  riskLane: riskLaneEnum("risk_lane").default("green"),
  riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
  hsCode: varchar("hs_code", { length: 12 }),
  goodsDescription: text("goods_description"),
  countryOfOrigin: varchar("country_of_origin", { length: 3 }),
  countryOfDestination: varchar("country_of_destination", { length: 3 }),
  portOfEntry: varchar("port_of_entry", { length: 64 }),
  grossWeight: decimal("gross_weight", { precision: 12, scale: 3 }),
  netWeight: decimal("net_weight", { precision: 12, scale: 3 }),
  numberOfPackages: integer("number_of_packages"),
  invoiceValue: decimal("invoice_value", { precision: 15, scale: 2 }),
  invoiceCurrency: varchar("invoice_currency", { length: 3 }),
  dutyAmount: decimal("duty_amount", { precision: 15, scale: 2 }),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }),
  levyAmount: decimal("levy_amount", { precision: 15, scale: 2 }),
  totalDue: decimal("total_due", { precision: 15, scale: 2 }),
  assignedOfficerId: integer("assigned_officer_id"),
  aiExplanation: json("ai_explanation"),
  sanctionsFlags: json("sanctions_flags"),
  submittedAt: timestamp("submitted_at"),
  clearedAt: timestamp("cleared_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_decl_trader_id").on(t.traderId),
  index("idx_decl_status").on(t.status),
  index("idx_decl_risk_lane").on(t.riskLane),
]);

export type Declaration = typeof declarations.$inferSelect;

// ─── DECLARATION DOCUMENTS ───────────────────────────────────────────────────

export const declarationDocuments = pgTable("declaration_documents", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  documentType: documentTypeEnum("document_type").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 512 }),
  mimeType: varchar("mime_type", { length: 128 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  ocrExtracted: boolean("ocr_extracted").default(false),
  ocrData: json("ocr_data"),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at"),
  status: documentStatusEnum("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_dd_declaration_id").on(t.declarationId)]);

// ─── OGA PERMITS ─────────────────────────────────────────────────────────────

export const ogaPermits = pgTable("oga_permits", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  agencyCode: varchar("agency_code", { length: 32 }).notNull(),
  agencyName: varchar("agency_name", { length: 128 }).notNull(),
  permitType: varchar("permit_type", { length: 128 }),
  status: permitStatusEnum("status").default("pending").notNull(),
  assignedOfficerId: integer("assigned_officer_id"),
  reviewNotes: text("review_notes"),
  permitNumber: varchar("permit_number", { length: 64 }),
  expiresAt: timestamp("expires_at"),
  slaDeadline: timestamp("sla_deadline"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_oga_declaration_id").on(t.declarationId),
  index("idx_oga_status").on(t.status),
]);

// ─── PAYMENTS ────────────────────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  status: paymentStatusEnum("status").default("pending").notNull(),
  mojalooopTransferId: varchar("mojaloop_transfer_id", { length: 128 }),
  tigerBeetleAccountId: varchar("tigerbeetle_account_id", { length: 64 }),
  reference: varchar("reference", { length: 128 }),
  confirmedAt: timestamp("confirmed_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("idx_pay_declaration_id").on(t.declarationId)]);

// ─── AUDIT EVENTS ────────────────────────────────────────────────────────────

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  entityType: auditEntityEnum("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  actorId: integer("actor_id"),
  actorType: varchar("actor_type", { length: 64 }),
  previousState: json("previous_state"),
  newState: json("new_state"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_ae_entity").on(t.entityType, t.entityId)]);

// ─── SECURITY ALERTS ─────────────────────────────────────────────────────────

export const securityAlerts = pgTable("security_alerts", {
  id: serial("id").primaryKey(),
  alertId: varchar("alert_id", { length: 64 }).notNull().unique(),
  severity: alertSeverityEnum("severity").notNull(),
  category: alertCategoryEnum("category").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  sourceIp: varchar("source_ip", { length: 45 }),
  targetService: varchar("target_service", { length: 128 }),
  ruleId: varchar("rule_id", { length: 32 }),
  ruleDescription: text("rule_description"),
  rawEvent: json("raw_event"),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: integer("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sa_severity").on(t.severity),
  index("idx_sa_category").on(t.category),
]);

// ─── SANCTIONS CHECKS ────────────────────────────────────────────────────────

export const sanctionsChecks = pgTable("sanctions_checks", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  entityName: varchar("entity_name", { length: 255 }).notNull(),
  entityType: sanctionsEntityEnum("entity_type").notNull(),
  checkResult: sanctionsResultEnum("check_result").notNull(),
  listsChecked: json("lists_checked"),
  matchDetails: json("match_details"),
  checkedBy: integer("checked_by"),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_sc_declaration_id").on(t.declarationId)]);

// ─── AEO APPLICATIONS ────────────────────────────────────────────────────────

export const aeoApplications = pgTable("aeo_applications", {
  id: serial("id").primaryKey(),
  traderId: integer("trader_id").notNull(),
  applicationNumber: varchar("application_number", { length: 32 }).notNull().unique(),
  tier: aeoTierEnum("tier").default("standard").notNull(),
  status: aeoAppStatusEnum("status").default("draft").notNull(),
  selfAssessmentScore: integer("self_assessment_score"),
  complianceScore: integer("compliance_score"),
  financialStandingScore: integer("financial_standing_score"),
  securityScore: integer("security_score"),
  reviewerNotes: text("reviewer_notes"),
  assignedReviewerId: integer("assigned_reviewer_id"),
  inspectionDate: timestamp("inspection_date"),
  certificateNumber: varchar("certificate_number", { length: 64 }),
  certificateIssuedAt: timestamp("certificate_issued_at"),
  certificateExpiresAt: timestamp("certificate_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("idx_aeo_trader_id").on(t.traderId)]);

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  entityType: varchar("entity_type", { length: 64 }),
  entityId: integer("entity_id"),
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_notif_user_id").on(t.userId),
  index("idx_notif_read").on(t.read),
]);
