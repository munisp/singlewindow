import {
  pgTable, pgEnum, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, jsonb, bigint, index, unique, uniqueIndex, real, uuid, date, check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "customs_officer", "oga_officer", "inspector", "finance"]);

export const stakeholderTypeEnum = pgEnum("stakeholder_type", [
  "trader", "customs_officer", "oga_officer", "freight_forwarder",
  "shipping_line", "shipping_company", "airline_gha",
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

export const regulatoryRestrictionTypeEnum = pgEnum("regulatory_restriction_type", [
  "prohibition", "restriction"
]);

export const declarationFormalityStatusEnum = pgEnum("declaration_formality_status", [
  "required", "satisfied", "blocked"
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer", "mobile_money", "card", "bond"
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending", "processing", "confirmed", "failed", "refunded"
]);

export const auditEntityEnum = pgEnum("audit_entity", [
  "declaration", "user", "payment", "permit", "document",
  "aeo_application", "kyc_verification"
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
  "duty_payment_due", "clearance_complete", "general"
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

// ─── NSW PARTY REGISTRATIONS & AGENT MANDATES ────────────────────────────────

export const stakeholderRegistrations = pgTable("stakeholder_registrations", {
  id: serial("id").primaryKey(),
  referenceNumber: varchar("reference_number", { length: 32 }).notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  stakeholderType: stakeholderTypeEnum("stakeholder_type").notNull(),
  organizationName: varchar("organization_name", { length: 255 }).notNull(),
  organizationCode: varchar("organization_code", { length: 64 }),
  licenseNumber: varchar("license_number", { length: 128 }),
  licenseExpiresAt: timestamp("license_expires_at"),
  taxId: varchar("tax_id", { length: 64 }),
  country: varchar("country", { length: 2 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  kycDocumentIds: json("kyc_document_ids").$type<number[]>().default([]),
  status: profileStatusEnum("status").default("pending").notNull(),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_stakeholder_reg_user_id").on(t.userId),
  index("idx_stakeholder_reg_status").on(t.status),
  index("idx_stakeholder_reg_type").on(t.stakeholderType),
]);

export type StakeholderRegistration = typeof stakeholderRegistrations.$inferSelect;
export type InsertStakeholderRegistration = typeof stakeholderRegistrations.$inferInsert;

export const stakeholderMandates = pgTable("stakeholder_mandates", {
  id: serial("id").primaryKey(),
  referenceNumber: varchar("reference_number", { length: 32 }).notNull().unique(),
  principalUserId: integer("principal_user_id").notNull().references(() => users.id),
  agentUserId: integer("agent_user_id").notNull().references(() => users.id),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedBy: integer("revoked_by").references(() => users.id),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_stakeholder_mandate_principal").on(t.principalUserId),
  index("idx_stakeholder_mandate_agent").on(t.agentUserId),
  index("idx_stakeholder_mandate_window").on(t.validFrom, t.validUntil),
]);

export type StakeholderMandate = typeof stakeholderMandates.$inferSelect;
export type InsertStakeholderMandate = typeof stakeholderMandates.$inferInsert;

// ─── DECLARATIONS ────────────────────────────────────────────────────────────

export const declarations = pgTable("declarations", {
  id: serial("id").primaryKey(),
  declarationNumber: varchar("declaration_number", { length: 32 }).notNull().unique(),
  ucr: varchar("ucr", { length: 64 }).unique(),
  traderId: integer("trader_id").notNull(),
  principalId: integer("principal_id").references(() => users.id),
  actingAgentId: integer("acting_agent_id").references(() => users.id),
  billOfLadingId: integer("bill_of_lading_id").references(() => billsOfLading.id, { onDelete: "set null" }),
  billOfLadingNumber: varchar("bill_of_lading_number", { length: 64 }),
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
  // Sprint 25 composite indexes for query performance
  index("idx_decl_trader_status").on(t.traderId, t.status),
  index("idx_decl_submitted_at").on(t.submittedAt),
  index("idx_decl_risk_lane_status").on(t.riskLane, t.status),
  index("idx_decl_assigned_officer").on(t.assignedOfficerId),
  index("idx_decl_bill_of_lading_id").on(t.billOfLadingId),
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
  hsCode: varchar("hs_code", { length: 12 }),
  origin: varchar("origin", { length: 3 }),
  destination: varchar("destination", { length: 3 }),
  consigneeId: integer("consignee_id").references(() => users.id),
  permittedQuantity: decimal("permitted_quantity", { precision: 18, scale: 3 }),
  usedQuantity: decimal("used_quantity", { precision: 18, scale: 3 }).default("0").notNull(),
  validFrom: timestamp("valid_from"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_oga_declaration_id").on(t.declarationId),
  index("idx_oga_status").on(t.status),
]);

// ─── REGULATORY OBLIGATIONS (SW4/SW5/SW6) ────────────────────────────────────

export const regulatoryFormalities = pgTable("regulatory_formalities", {
  id: serial("id").primaryKey(),
  hsCodePrefix: varchar("hs_code_prefix", { length: 12 }).notNull(),
  origin: varchar("origin", { length: 3 }),
  destination: varchar("destination", { length: 3 }),
  regime: varchar("regime", { length: 32 }),
  agencyCode: varchar("agency_code", { length: 32 }).notNull(),
  agencyName: varchar("agency_name", { length: 128 }).notNull(),
  permitType: varchar("permit_type", { length: 128 }).notNull(),
  requiredQuantity: decimal("required_quantity", { precision: 18, scale: 3 }).default("1").notNull(),
  quantityUnit: varchar("quantity_unit", { length: 32 }),
  legalInstrument: text("legal_instrument").notNull(),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_reg_formality_match").on(t.hsCodePrefix, t.origin, t.destination, t.regime),
  index("idx_reg_formality_dates").on(t.validFrom, t.validUntil),
]);

export const regulatoryRestrictions = pgTable("regulatory_restrictions", {
  id: serial("id").primaryKey(),
  hsCodePrefix: varchar("hs_code_prefix", { length: 12 }).notNull(),
  origin: varchar("origin", { length: 3 }),
  regime: varchar("regime", { length: 32 }),
  restrictionType: regulatoryRestrictionTypeEnum("restriction_type").notNull(),
  description: text("description").notNull(),
  legalInstrument: text("legal_instrument").notNull(),
  agencyCode: varchar("agency_code", { length: 32 }),
  agencyName: varchar("agency_name", { length: 128 }),
  permitType: varchar("permit_type", { length: 128 }),
  requiredQuantity: decimal("required_quantity", { precision: 18, scale: 3 }).default("1").notNull(),
  quantityUnit: varchar("quantity_unit", { length: 32 }),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_reg_restriction_match").on(t.hsCodePrefix, t.origin, t.regime),
  index("idx_reg_restriction_dates").on(t.validFrom, t.validUntil),
]);

export const declarationFormalities = pgTable("declaration_formalities", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id, { onDelete: "cascade" }),
  formalityId: integer("formality_id").references(() => regulatoryFormalities.id),
  restrictionId: integer("restriction_id").references(() => regulatoryRestrictions.id),
  agencyCode: varchar("agency_code", { length: 32 }),
  agencyName: varchar("agency_name", { length: 128 }),
  permitType: varchar("permit_type", { length: 128 }),
  legalInstrument: text("legal_instrument").notNull(),
  requiredQuantity: decimal("required_quantity", { precision: 18, scale: 3 }).notNull(),
  satisfiedQuantity: decimal("satisfied_quantity", { precision: 18, scale: 3 }).default("0").notNull(),
  satisfiedByPermitId: integer("satisfied_by_permit_id").references(() => ogaPermits.id),
  status: declarationFormalityStatusEnum("status").default("required").notNull(),
  evaluatedAt: timestamp("evaluated_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_decl_formality_declaration").on(t.declarationId),
  index("idx_decl_formality_status").on(t.status),
]);

export const tariffQuotas = pgTable("tariff_quotas", {
  id: serial("id").primaryKey(),
  quotaCode: varchar("quota_code", { length: 64 }).notNull().unique(),
  hsCodePrefix: varchar("hs_code_prefix", { length: 12 }).notNull(),
  origin: varchar("origin", { length: 3 }),
  regime: varchar("regime", { length: 32 }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalQuantity: decimal("total_quantity", { precision: 18, scale: 3 }).notNull(),
  quantityUnit: varchar("quantity_unit", { length: 32 }).notNull(),
  ledgerAccountId: varchar("ledger_account_id", { length: 128 }).notNull(),
  legalInstrument: text("legal_instrument").notNull(),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tariff_quota_match").on(t.hsCodePrefix, t.origin, t.regime),
  index("idx_tariff_quota_period").on(t.periodStart, t.periodEnd),
]);

export const tariffQuotaAllocations = pgTable("tariff_quota_allocations", {
  id: serial("id").primaryKey(),
  quotaId: integer("quota_id").notNull().references(() => tariffQuotas.id),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  quantity: decimal("quantity", { precision: 18, scale: 3 }).notNull(),
  transferId: varchar("transfer_id", { length: 128 }).notNull().unique(),
  reversedAt: timestamp("reversed_at"),
  reversalTransferId: varchar("reversal_transfer_id", { length: 128 }).unique(),
  allocatedAt: timestamp("allocated_at").defaultNow().notNull(),
  allocatedBy: integer("allocated_by").notNull().references(() => users.id),
}, (t) => [
  uniqueIndex("uq_tariff_active_declaration").on(t.quotaId, t.declarationId)
    .where(sql`${t.reversedAt} IS NULL`),
  index("idx_tariff_allocation_quota").on(t.quotaId),
  index("idx_tariff_allocation_declaration").on(t.declarationId),
]);

// ─── PAYMENTS ────────────────────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull(),
  actingAgentId: integer("acting_agent_id").references(() => users.id),
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
  // R4 FIX: Tamper-evident hash chain — each entry hashes its own content + prevHash
  entryHash: varchar("entry_hash", { length: 64 }),  // SHA-256 hex of this row's content
  prevHash: varchar("prev_hash", { length: 64 }),    // entryHash of the previous row for this entity
}, (t) => [
  index("idx_ae_entity").on(t.entityType, t.entityId),
  index("idx_ae_entry_hash").on(t.entryHash),
]);

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

// ─── KYC / KYB ───────────────────────────────────────────────────────────────

export const kycDocumentTypeEnum = pgEnum("kyc_document_type", [
  "national_id", "passport", "drivers_license",
  "business_registration", "tax_certificate",
  "bank_statement", "utility_bill", "certificate_of_incorporation",
  "memorandum_of_association", "board_resolution", "other",
]);

export const kycDocumentStatusEnum = pgEnum("kyc_document_status", [
  "PENDING_ANALYSIS", "ANALYSED", "REJECTED", "EXPIRED",
]);

export const kycVerificationTypeEnum = pgEnum("kyc_verification_type", [
  "INDIVIDUAL", "BUSINESS",
]);

export const kycVerificationStatusEnum = pgEnum("kyc_verification_status", [
  "PENDING_REVIEW", "APPROVED", "REJECTED", "MORE_INFO_REQUIRED", "EXPIRED",
]);

export const kycDocuments = pgTable("kyc_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  documentType: kycDocumentTypeEnum("document_type").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
  status: kycDocumentStatusEnum("status").default("PENDING_ANALYSIS").notNull(),
  analysisResult: json("analysis_result"),
  ocrConfidence: real("ocr_confidence"),
  authenticityScore: real("authenticity_score"),
  authenticityVerdict: varchar("authenticity_verdict", { length: 32 }),
  analysedAt: timestamp("analysed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kyc_doc_user_id").on(t.userId),
  index("idx_kyc_doc_status").on(t.status),
]);

export const kycVerifications = pgTable("kyc_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  verificationType: kycVerificationTypeEnum("verification_type").notNull(),
  primaryDocumentId: integer("primary_document_id").references(() => kycDocuments.id),
  secondaryDocumentId: integer("secondary_document_id").references(() => kycDocuments.id),
  selfieDocumentId: integer("selfie_document_id").references(() => kycDocuments.id),
  status: kycVerificationStatusEnum("status").default("PENDING_REVIEW").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  rejectionReason: text("rejection_reason"),
  metadata: json("metadata"),
  submittedAt: timestamp("submitted_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kyc_ver_user_id").on(t.userId),
  index("idx_kyc_ver_status").on(t.status),
]);

// ─── VISION ANALYSIS ─────────────────────────────────────────────────────────

export const visionAnalysisTypeEnum = pgEnum("vision_analysis_type", [
  "container_inspection", "seal_verification", "cargo_manifest_match",
  "damage_assessment", "prohibited_goods_screening",
]);

export const visionRiskLevelEnum = pgEnum("vision_risk_level", [
  "GREEN", "YELLOW", "RED",
]);

export const visionAnalyses = pgTable("vision_analyses", {
  id: serial("id").primaryKey(),
  reportId: varchar("report_id", { length: 64 }).notNull().unique(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  analysisType: visionAnalysisTypeEnum("analysis_type").notNull(),
  imageUrl: text("image_url").notNull(),
  imageKey: varchar("image_key", { length: 512 }).notNull(),
  detections: json("detections"),
  containerAnalysis: json("container_analysis"),
  manifestMatch: json("manifest_match"),
  riskScore: integer("risk_score"),
  riskLevel: visionRiskLevelEnum("risk_level"),
  recommendedAction: varchar("recommended_action", { length: 32 }),
  vlmDescription: text("vlm_description"),
  processingTimeMs: integer("processing_time_ms"),
  modelVersions: json("model_versions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_va_declaration_id").on(t.declarationId),
  index("idx_va_risk_level").on(t.riskLevel),
  index("idx_va_requested_by").on(t.requestedBy),
]);


// --- VISION BATCH JOBS (v122) ---
export const visionBatchJobStatusEnum = pgEnum("vision_batch_job_status", [
  "queued", "processing", "completed", "failed", "cancelled"
]);
export const visionBatchJobs = pgTable("vision_batch_jobs", {
  id: serial("id").primaryKey(),
  batchId: varchar("batch_id", { length: 64 }).notNull().unique(),
  submittedBy: integer("submitted_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  declarationId: integer("declaration_id").references(() => declarations.id),
  totalDocuments: integer("total_documents").default(0).notNull(),
  processedDocuments: integer("processed_documents").default(0).notNull(),
  status: visionBatchJobStatusEnum("status").default("queued").notNull(),
  priority: varchar("priority", { length: 16 }).default("normal").notNull(),
  documents: json("documents"),
  results: json("results"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_vbj_submitted_by").on(t.submittedBy),
  index("idx_vbj_status").on(t.status),
  index("idx_vbj_batch_id").on(t.batchId),
]);
export type VisionBatchJob = typeof visionBatchJobs.$inferSelect;
export type InsertVisionBatchJob = typeof visionBatchJobs.$inferInsert;

// ─── GEOSPATIAL DATA ─────────────────────────────────────────────────────────

export const portCongestionStatusEnum = pgEnum("port_congestion_status", [
  "clear", "moderate", "congested", "critical"
]);

export const portLocations = pgTable("port_locations", {
  id: serial("id").primaryKey(),
  portCode: varchar("port_code", { length: 16 }).notNull().unique(),
  portName: varchar("port_name", { length: 128 }).notNull(),
  country: varchar("country", { length: 3 }).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  portType: varchar("port_type", { length: 32 }).default("seaport"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const portCongestionEvents = pgTable("port_congestion_events", {
  id: serial("id").primaryKey(),
  portCode: varchar("port_code", { length: 16 }).notNull(),
  congestionStatus: portCongestionStatusEnum("congestion_status").notNull(),
  vesselCount: integer("vessel_count").default(0),
  waitTimeHours: real("wait_time_hours").default(0),
  declarationBacklog: integer("declaration_backlog").default(0),
  inspectionQueueSize: integer("inspection_queue_size").default(0),
  metadata: json("metadata"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pce_port_code").on(t.portCode),
  index("idx_pce_recorded_at").on(t.recordedAt),
]);

export const vesselTrackingEvents = pgTable("vessel_tracking_events", {
  id: serial("id").primaryKey(),
  mmsi: varchar("mmsi", { length: 16 }).notNull(),
  vesselName: varchar("vessel_name", { length: 128 }),
  imoNumber: varchar("imo_number", { length: 16 }),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  speed: real("speed"),
  heading: real("heading"),
  destinationPort: varchar("destination_port", { length: 64 }),
  eta: timestamp("eta"),
  cargoType: varchar("cargo_type", { length: 64 }),
  flagCountry: varchar("flag_country", { length: 3 }),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("idx_vte_mmsi").on(t.mmsi),
  index("idx_vte_recorded_at").on(t.recordedAt),
]);

export type PortLocation = typeof portLocations.$inferSelect;
export type PortCongestionEvent = typeof portCongestionEvents.$inferSelect;
export type VesselTrackingEvent = typeof vesselTrackingEvents.$inferSelect;

// ─── POST-CLEARANCE AUDIT ─────────────────────────────────────────────────────
export const auditStatusEnum = pgEnum("audit_status", [
  "scheduled", "in_progress", "completed", "escalated", "closed"
]);
export const auditOutcomeEnum = pgEnum("audit_outcome", [
  "compliant", "minor_discrepancy", "major_discrepancy", "fraud_suspected", "pending"
]);
export const postClearanceAudits = pgTable("post_clearance_audits", {
  id: serial("id").primaryKey(),
  auditNumber: varchar("audit_number", { length: 32 }).notNull().unique(),
  declarationId: integer("declaration_id").notNull(),
  declarationNumber: varchar("declaration_number", { length: 32 }).notNull(),
  traderId: integer("trader_id").notNull(),
  assignedOfficerId: integer("assigned_officer_id"),
  status: auditStatusEnum("status").default("scheduled").notNull(),
  outcome: auditOutcomeEnum("outcome").default("pending").notNull(),
  triggerReason: text("trigger_reason"),
  declaredValue: decimal("declared_value", { precision: 15, scale: 2 }),
  auditedValue: decimal("audited_value", { precision: 15, scale: 2 }),
  valueDifference: decimal("value_difference", { precision: 15, scale: 2 }),
  additionalDutyAssessed: decimal("additional_duty_assessed", { precision: 15, scale: 2 }),
  penaltyAmount: decimal("penalty_amount", { precision: 15, scale: 2 }),
  findings: text("findings"),
  officerNotes: text("officer_notes"),
  supportingDocuments: json("supporting_documents"),
  scheduledDate: timestamp("scheduled_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pca_declaration_id").on(t.declarationId),
  index("idx_pca_trader_id").on(t.traderId),
  index("idx_pca_status").on(t.status),
  index("idx_pca_outcome").on(t.outcome),
]);
export type PostClearanceAudit = typeof postClearanceAudits.$inferSelect;
export type InsertPostClearanceAudit = typeof postClearanceAudits.$inferInsert;

// ─── DUTY DRAWBACK ────────────────────────────────────────────────────────────
export const drawbackStatusEnum = pgEnum("drawback_status", [
  "draft", "submitted", "under_review", "approved", "rejected", "paid"
]);
export const drawbackTypeEnum = pgEnum("drawback_type", [
  "manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"
]);
export const dutyDrawbackClaims = pgTable("duty_drawback_claims", {
  id: serial("id").primaryKey(),
  claimNumber: varchar("claim_number", { length: 32 }).notNull().unique(),
  traderId: integer("trader_id").notNull(),
  importDeclarationId: integer("import_declaration_id").notNull(),
  importDeclarationNumber: varchar("import_declaration_number", { length: 32 }).notNull(),
  exportDeclarationId: integer("export_declaration_id"),
  exportDeclarationNumber: varchar("export_declaration_number", { length: 32 }),
  drawbackType: drawbackTypeEnum("drawback_type").notNull(),
  status: drawbackStatusEnum("status").default("draft").notNull(),
  originalDutyPaid: decimal("original_duty_paid", { precision: 15, scale: 2 }).notNull(),
  claimedAmount: decimal("claimed_amount", { precision: 15, scale: 2 }).notNull(),
  approvedAmount: decimal("approved_amount", { precision: 15, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 15, scale: 2 }),
  hsCode: varchar("hs_code", { length: 12 }),
  goodsDescription: text("goods_description"),
  importQuantity: decimal("import_quantity", { precision: 12, scale: 3 }),
  exportQuantity: decimal("export_quantity", { precision: 12, scale: 3 }),
  quantityUnit: varchar("quantity_unit", { length: 16 }),
  reExportEvidence: json("re_export_evidence"),
  manufacturingEvidence: json("manufacturing_evidence"),
  reviewerNotes: text("reviewer_notes"),
  rejectionReason: text("rejection_reason"),
  reviewedBy: integer("reviewed_by"),
  importDate: timestamp("import_date"),
  exportDate: timestamp("export_date"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ddc_trader_id").on(t.traderId),
  index("idx_ddc_status").on(t.status),
  index("idx_ddc_import_decl").on(t.importDeclarationId),
]);
export type DutyDrawbackClaim = typeof dutyDrawbackClaims.$inferSelect;
export type InsertDutyDrawbackClaim = typeof dutyDrawbackClaims.$inferInsert;

// ─── FRAUD CASES ──────────────────────────────────────────────────────────────

export const fraudCaseStatusEnum = pgEnum("fraud_case_status", [
  "open", "under_review", "escalated", "closed_confirmed", "closed_cleared", "referred_prosecution"
]);

export const fraudCasePriorityEnum = pgEnum("fraud_case_priority", [
  "low", "medium", "high", "critical"
]);

export const fraudCases = pgTable("fraud_cases", {
  id: serial("id").primaryKey(),
  caseNumber: varchar("case_number", { length: 32 }).notNull().unique(),
  traderId: integer("trader_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: fraudCaseStatusEnum("status").default("open").notNull(),
  priority: fraudCasePriorityEnum("priority").default("medium").notNull(),
  assignedTo: integer("assigned_to"),
  createdBy: integer("created_by").notNull(),
  linkedDeclarationIds: json("linked_declaration_ids").$type<number[]>().default([]),
  riskScore: real("risk_score"),
  severity: varchar("severity", { length: 16 }).default("medium"),
  estimatedLoss: decimal("estimated_loss", { precision: 15, scale: 2 }),
  closureReason: text("closure_reason"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_fc_trader_id").on(t.traderId),
  index("idx_fc_status").on(t.status),
  index("idx_fc_assigned_to").on(t.assignedTo),
  index("idx_fc_created_by").on(t.createdBy),
]);
export type FraudCase = typeof fraudCases.$inferSelect;
export type InsertFraudCase = typeof fraudCases.$inferInsert;

export const fraudCaseNotes = pgTable("fraud_case_notes", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => fraudCases.id),
  authorId: integer("author_id").notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("idx_fcn_case_id").on(t.caseId)]);
export type FraudCaseNote = typeof fraudCaseNotes.$inferSelect;

export const fraudCaseEvidence = pgTable("fraud_case_evidence", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => fraudCases.id),
  uploadedBy: integer("uploaded_by").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_fce_case_id").on(t.caseId)]);
export type FraudCaseEvidence = typeof fraudCaseEvidence.$inferSelect;

// --- FRAUD CASE LINKS (v123) ---
export const fraudCaseLinkTypeEnum = pgEnum("fraud_case_link_type", [
  "same_trader", "same_vessel", "same_route", "same_method", "related_network"
]);
export const fraudCaseLinks = pgTable("fraud_case_links", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => fraudCases.id, { onDelete: "cascade" }),
  linkedCaseId: integer("linked_case_id").notNull().references(() => fraudCases.id, { onDelete: "cascade" }),
  linkType: fraudCaseLinkTypeEnum("link_type").notNull(),
  confidence: real("confidence").default(0.8),
  notes: text("notes"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_fcl_case_id").on(t.caseId),
  index("idx_fcl_linked_case_id").on(t.linkedCaseId),
]);
export type FraudCaseLink = typeof fraudCaseLinks.$inferSelect;
export type InsertFraudCaseLink = typeof fraudCaseLinks.$inferInsert;

// ─── NIGHTLY RISK SCAN RESULTS ────────────────────────────────────────────────

export const riskScanResults = pgTable("risk_scan_results", {
  id: serial("id").primaryKey(),
  scanRunAt: timestamp("scan_run_at").defaultNow().notNull(),
  totalDeclarationsScanned: integer("total_declarations_scanned").default(0).notNull(),
  highRiskCount: integer("high_risk_count").default(0).notNull(),
  newCasesCreated: integer("new_cases_created").default(0).notNull(),
  thresholdUsed: real("threshold_used").notNull(),
  scanPeriodHours: integer("scan_period_hours").notNull(),
  flaggedDeclarationIds: json("flagged_declaration_ids").$type<number[]>().default([]),
  notificationSent: boolean("notification_sent").default(false).notNull(),
  runBy: integer("run_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_rsr_scan_run_at").on(t.scanRunAt)]);
export type RiskScanResult = typeof riskScanResults.$inferSelect;

// ─── CLEARANCE CERTIFICATES ───────────────────────────────────────────────────
export const clearanceCertificates = pgTable("clearance_certificates", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: text("file_url").notNull(),
  declarationRef: varchar("declaration_ref", { length: 64 }).notNull(),
  goodsDescription: text("goods_description"),
  totalDutyPaid: decimal("total_duty_paid", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("USD"),
  clearedAt: timestamp("cleared_at"),
  generatedBy: integer("generated_by").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cc_trader_id").on(t.traderId),
  index("idx_cc_declaration_id").on(t.declarationId),
]);
export type ClearanceCertificate = typeof clearanceCertificates.$inferSelect;

// ─── USER NOTIFICATIONS ───────────────────────────────────────────────────────
export const userNotifications = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull().default("general"),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  isRead: boolean("is_read").default(false).notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_un_user_id").on(t.userId),
  index("idx_un_user_unread").on(t.userId, t.isRead),
  index("idx_un_created_at").on(t.createdAt),
]);
export type UserNotification = typeof userNotifications.$inferSelect;

// ─── NOTIFICATION PREFERENCES ─────────────────────────────────────────────────
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationType: notificationTypeEnum("notification_type").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_np_user_id").on(t.userId),
  // Each user can have at most one preference row per notification type
]);
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// ─── NOTIFICATION DIGEST SETTINGS ─────────────────────────────────────────────
// One row per user; stores their preferred digest frequency.
// digestFrequency: "none" = no digest, "daily" = every day at 08:00 UTC,
//                  "weekly" = every Monday at 08:00 UTC
export const digestFrequencyEnum = pgEnum("digest_frequency", ["none", "daily", "weekly"]);
export const notificationDigestSettings = pgTable("notification_digest_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  digestFrequency: digestFrequencyEnum("digest_frequency").default("none").notNull(),
  lastDigestSentAt: timestamp("last_digest_sent_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_nds_user_id").on(t.userId),
  index("idx_nds_frequency").on(t.digestFrequency),
]);
export type NotificationDigestSettings = typeof notificationDigestSettings.$inferSelect;

// ─── NOTIFICATION CHANNEL PREFERENCES ────────────────────────────────────────
// v113: Per-user, per-notification-type channel preferences.
// Allows users to select which delivery channels (email, sms, push, webhook)
// they want for each notification type. Missing rows default to email-only.
export const notificationChannelEnum = pgEnum("notification_channel", ["email", "sms", "push", "webhook", "in_app"]);
export const notificationChannelPreferences = pgTable("notification_channel_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationType: notificationTypeEnum("notification_type").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ncp_user_id").on(t.userId),
  index("idx_ncp_type_channel").on(t.notificationType, t.channel),
]);
export type NotificationChannelPreference = typeof notificationChannelPreferences.$inferSelect;
export type InsertNotificationChannelPreference = typeof notificationChannelPreferences.$inferInsert;

// ─── PORT CONGESTION ALERT TRACKING ───────────────────────────────────────────
// Tracks the last-notified congestion status per port to avoid duplicate alerts.
// When a port transitions to "critical" and the last-notified status was not
// "critical", a notification is fired for all admin/customs_officer users.
export const portCongestionAlerts = pgTable("port_congestion_alerts", {
  id: serial("id").primaryKey(),
  portCode: varchar("port_code", { length: 16 }).notNull().unique(),
  lastNotifiedStatus: portCongestionStatusEnum("last_notified_status").default("clear").notNull(),
  lastAlertSentAt: timestamp("last_alert_sent_at"),
  /** Set when an admin/officer acknowledges the critical alert */
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pca_port_code").on(t.portCode),
]);
export type PortCongestionAlert = typeof portCongestionAlerts.$inferSelect;

// ─── DOCUMENT VAULT ───────────────────────────────────────────────────────────
// Sprint 25: S3-backed (RustFS) document storage for traders and customs officers.
// Files are stored in RustFS (port 9000); this table holds metadata + S3 key.

export const documentVaultCategoryEnum = pgEnum("document_vault_category", [
  "commercial_invoice", "bill_of_lading", "packing_list",
  "certificate_of_origin", "phytosanitary_cert", "import_permit",
  "export_permit", "insurance_cert", "customs_bond",
  "kyc_identity", "kyc_business", "aeo_supporting",
  "post_clearance", "correspondence", "other"
]);

export const documentVaultAccessEnum = pgEnum("document_vault_access", [
  "private", "shared_with_customs", "shared_with_oga", "public"
]);

export const documentVaultStatusEnum = pgEnum("document_vault_status", [
  "active", "revoked", "expired"
]);

export const documentVault = pgTable("document_vault", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  url: text("url").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  category: documentVaultCategoryEnum("category").notNull(),
  accessLevel: documentVaultAccessEnum("access_level").default("private").notNull(),
  status: documentVaultStatusEnum("status").default("active").notNull(),
  description: text("description"),
  revokedBy: integer("revoked_by").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  expiresAt: timestamp("expires_at"),
  expiryNotifiedAt: timestamp("expiry_notified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_dv_owner_id").on(t.ownerId),
  index("idx_dv_declaration_id").on(t.declarationId),
  index("idx_dv_status").on(t.status),
  index("idx_dv_category").on(t.category),
  index("idx_dv_owner_status").on(t.ownerId, t.status),
  index("idx_dv_expires_at").on(t.expiresAt),
]);

export type DocumentVault = typeof documentVault.$inferSelect;
export type InsertDocumentVault = typeof documentVault.$inferInsert;

// ─── Document Shares ─────────────────────────────────────────────────────────
// Time-limited presigned share links with optional bcrypt password protection.
export const documentShares = pgTable("document_shares", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documentVault.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 128 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 256 }),  // null = no password
  expiresAt: timestamp("expires_at").notNull(),
  maxDownloads: integer("max_downloads"),                    // null = unlimited
  downloadCount: integer("download_count").default(0).notNull(),
  label: varchar("label", { length: 255 }),                 // optional description for the share
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ds_token").on(t.token),
  index("idx_ds_document_id").on(t.documentId),
  index("idx_ds_created_by").on(t.createdBy),
  index("idx_ds_expires_at").on(t.expiresAt),
]);
export type DocumentShare = typeof documentShares.$inferSelect;
export type InsertDocumentShare = typeof documentShares.$inferInsert;

// ─── MOJALOOP TRANSACTIONS ────────────────────────────────────────────────────
// Sprint 30: Persistent record of every Mojaloop payment transfer initiated
// through the platform. Linked to payments and declarations for reconciliation.

export const mojaloopTransferStatusEnum = pgEnum("mojaloop_transfer_status", [
  "PENDING", "PROCESSING", "COMMITTED", "ABORTED", "EXPIRED",
]);

export const mojaloopFspTypeEnum = pgEnum("mojaloop_fsp_type", [
  "BANK", "MOBILE_MONEY", "RTGS",
]);

export const mojaloopTransactions = pgTable("mojaloop_transactions", {
  id: serial("id").primaryKey(),
  transferId: varchar("transfer_id", { length: 128 }).notNull().unique(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  paymentId: integer("payment_id").references(() => payments.id, { onDelete: "set null" }),
  initiatedBy: integer("initiated_by").notNull().references(() => users.id),
  fspId: varchar("fsp_id", { length: 64 }).notNull(),
  fspName: varchar("fsp_name", { length: 128 }).notNull(),
  fspType: mojaloopFspTypeEnum("fsp_type").notNull(),
  payerAccount: varchar("payer_account", { length: 128 }).notNull(),
  payerName: varchar("payer_name", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
  status: mojaloopTransferStatusEnum("status").default("PENDING").notNull(),
  ilpPacket: text("ilp_packet"),
  condition: varchar("condition", { length: 128 }),
  fulfilment: varchar("fulfilment", { length: 128 }),
  paymentNote: varchar("payment_note", { length: 128 }),
  expiresAt: timestamp("expires_at"),
  committedAt: timestamp("committed_at"),
  abortedAt: timestamp("aborted_at"),
  failureReason: text("failure_reason"),
  webhookPayload: json("webhook_payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_mjtx_transfer_id").on(t.transferId),
  index("idx_mjtx_declaration_id").on(t.declarationId),
  index("idx_mjtx_initiated_by").on(t.initiatedBy),
  index("idx_mjtx_status").on(t.status),
  index("idx_mjtx_created_at").on(t.createdAt),
]);
export type MojaloopTransaction = typeof mojaloopTransactions.$inferSelect;
export type InsertMojaloopTransaction = typeof mojaloopTransactions.$inferInsert;

// ─── TIGERBEETLE LEDGER ENTRIES ───────────────────────────────────────────────
// Sprint 31: Double-entry ledger records for every duty payment, penalty,
// drawback, and bond transaction. TigerBeetle IDs are 128-bit unsigned integers
// stored as varchar(40) to avoid BigInt overflow in JS.

export const tbEntryTypeEnum = pgEnum("tb_entry_type", [
  "duty_payment", "vat_payment", "levy_payment",
  "penalty", "bond_deposit", "bond_release",
  "drawback_credit", "refund", "adjustment", "excise_stamp_liability",
]);

export const tbEntryStatusEnum = pgEnum("tb_entry_status", [
  "pending", "posted", "voided", "failed",
]);

export const tigerBeetleLedgerEntries = pgTable("tigerbeetle_ledger_entries", {
  id: serial("id").primaryKey(),
  // TigerBeetle transfer ID (128-bit, stored as hex string)
  tbTransferId: varchar("tb_transfer_id", { length: 40 }).notNull().unique(),
  // TigerBeetle account IDs for debit and credit legs
  debitAccountId: varchar("debit_account_id", { length: 40 }).notNull(),
  creditAccountId: varchar("credit_account_id", { length: 40 }).notNull(),
  // Amount in minor currency units (e.g., pesewas for GHS)
  amountMinorUnits: bigint("amount_minor_units", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
  ledger: integer("ledger").default(1).notNull(), // TigerBeetle ledger ID
  entryType: tbEntryTypeEnum("entry_type").notNull(),
  status: tbEntryStatusEnum("status").default("pending").notNull(),
  // Links to business objects
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  paymentId: integer("payment_id").references(() => payments.id, { onDelete: "set null" }),
  mojaloopTransferId: varchar("mojaloop_transfer_id", { length: 128 }),
  // Human-readable reference
  reference: varchar("reference", { length: 128 }),
  description: text("description"),
  metadata: json("metadata"),
  postedAt: timestamp("posted_at"),
  voidedAt: timestamp("voided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tble_tb_transfer_id").on(t.tbTransferId),
  index("idx_tble_declaration_id").on(t.declarationId),
  index("idx_tble_payment_id").on(t.paymentId),
  index("idx_tble_entry_type").on(t.entryType),
  index("idx_tble_status").on(t.status),
  index("idx_tble_created_at").on(t.createdAt),
]);
export type TigerBeetleLedgerEntry = typeof tigerBeetleLedgerEntries.$inferSelect;
export type InsertTigerBeetleLedgerEntry = typeof tigerBeetleLedgerEntries.$inferInsert;

// ─── KEYCLOAK / OIDC CONFIGURATION ───────────────────────────────────────────
// Sprint 32: Single-row configuration table for Keycloak OIDC/SAML integration.
// When enabled, login redirects to Keycloak realm; JWT tokens are validated
// against the realm's JWKS endpoint.

export const keycloakConfig = pgTable("keycloak_config", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  realmUrl: text("realm_url"),           // e.g. https://keycloak.example.com/realms/tradegateway
  clientId: varchar("client_id", { length: 128 }),
  clientSecret: text("client_secret"),   // encrypted at rest in production
  discoveryUrl: text("discovery_url"),   // /.well-known/openid-configuration
  jwksUri: text("jwks_uri"),
  issuer: text("issuer"),
  // Role mapping: Keycloak realm role → TradeGateway role
  roleMappings: json("role_mappings").$type<Record<string, string>>().default({}),
  // Scopes to request from Keycloak
  scopes: json("scopes").$type<string[]>().default(["openid", "profile", "email"]),
  // Whether to fall back to Manus OAuth if Keycloak is unreachable
  fallbackEnabled: boolean("fallback_enabled").default(true).notNull(),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestResult: varchar("last_test_result", { length: 32 }),
  lastTestError: text("last_test_error"),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type KeycloakConfig = typeof keycloakConfig.$inferSelect;
export type InsertKeycloakConfig = typeof keycloakConfig.$inferInsert;

// ─── DEVELOPER PORTAL — API KEYS ─────────────────────────────────────────────
// Sprint 41: API key management for the Open API ecosystem portal.
// Raw keys are never stored; only the HMAC-SHA256 hash is persisted.
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  scopes: text("scopes").notNull(),           // comma-separated scope list
  rateLimit: integer("rate_limit").default(100).notNull(),
  sandboxMode: boolean("sandbox_mode").default(false).notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(), // active | revoked | expired
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_api_keys_user_id").on(t.userId),
  index("idx_api_keys_key_hash").on(t.keyHash),
  index("idx_api_keys_status").on(t.status),
]);
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── DEVELOPER PORTAL — API USAGE LOGS ───────────────────────────────────────
export const apiUsageLogs = pgTable("api_usage_logs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeys.id),
  endpoint: varchar("endpoint", { length: 200 }).notNull(),
  method: varchar("method", { length: 10 }).default("GET").notNull(),
  statusCode: integer("status_code").default(200).notNull(),
  latencyMs: integer("latency_ms"),
  sandboxMode: boolean("sandbox_mode").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_api_usage_key_id").on(t.apiKeyId),
  index("idx_api_usage_created_at").on(t.createdAt),
]);
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type InsertApiUsageLog = typeof apiUsageLogs.$inferInsert;

// ─── MULTI-TENANCY — TENANTS (Sprint 47) ─────────────────────────────────────
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  country: varchar("country", { length: 3 }).notNull(),
  contactEmail: varchar("contact_email", { length: 256 }).notNull(),
  plan: varchar("plan", { length: 32 }).default("standard").notNull(),
  apiPrefix: varchar("api_prefix", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  // ── Caddy On-Demand TLS: custom hostname per tenant ──────────────────────
  // Caddy's `ask` endpoint validates this before issuing an ACME certificate.
  customDomain: varchar("custom_domain", { length: 253 }).unique(),
  domainVerified: boolean("domain_verified").default(false).notNull(),
  domainVerifiedAt: timestamp("domain_verified_at"),
  domainVerificationToken: varchar("domain_verification_token", { length: 64 }),
  // Consecutive DNS verification failure counter — triggers owner notification at 3
  domainVerificationFailCount: integer("domain_verification_fail_count").default(0).notNull(),
  domainLastFailedAt: timestamp("domain_last_failed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tenants_slug").on(t.slug),
  index("idx_tenants_country").on(t.country),
  index("idx_tenants_status").on(t.status),
]);
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ─── MULTI-TENANCY — PER-TENANT KEYCLOAK CONFIG ───────────────────────────────
export const tenantKeycloakConfig = pgTable("tenant_keycloak_config", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  realm: varchar("realm", { length: 64 }).notNull(),
  clientId: varchar("client_id", { length: 128 }).notNull(),
  clientSecret: varchar("client_secret", { length: 256 }),
  discoveryUrl: varchar("discovery_url", { length: 512 }).notNull(),
  roleMappings: json("role_mappings").default({}).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tenant_kc_tenant_id").on(t.tenantId),
]);
export type TenantKeycloakConfig = typeof tenantKeycloakConfig.$inferSelect;
export type InsertTenantKeycloakConfig = typeof tenantKeycloakConfig.$inferInsert;

// ─── MULTI-TENANCY — TENANT USERS ─────────────────────────────────────────────
export const tenantUsers = pgTable("tenant_users", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: integer("user_id").notNull().references(() => users.id),
  role: varchar("role", { length: 64 }).default("viewer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tenant_users_tenant_id").on(t.tenantId),
  index("idx_tenant_users_user_id").on(t.userId),
]);
export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = typeof tenantUsers.$inferInsert;

// ─── TENANT WHITE-LABEL BRANDING (v119) ─────────────────────────────────────
export const tenantBranding = pgTable("tenant_branding", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id),
  platformName: varchar("platform_name", { length: 128 }).default("TradeGateway").notNull(),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: varchar("primary_color", { length: 16 }).default("#0A1628"),
  accentColor: varchar("accent_color", { length: 16 }).default("#D4A017"),
  supportEmail: varchar("support_email", { length: 255 }),
  supportPhone: varchar("support_phone", { length: 64 }),
  footerText: text("footer_text"),
  customCss: text("custom_css"),
  loginBannerUrl: text("login_banner_url"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => users.id),
}, (t) => [
  index("idx_tenant_branding_tenant_id").on(t.tenantId),
]);
export type TenantBranding = typeof tenantBranding.$inferSelect;
export type InsertTenantBranding = typeof tenantBranding.$inferInsert;

// ─── TRADER ONBOARDING WIZARD (Sprint 67) ────────────────────────────────────
export const onboardingStepEnum = pgEnum("onboarding_step", [
  "company_profile", "kyc_documents", "bank_account", "test_declaration", "aeo_eligibility"
]);
export const onboardingStepStatusEnum = pgEnum("onboarding_step_status", [
  "pending", "in_progress", "completed", "skipped"
]);

export const onboardingProgress = pgTable("onboarding_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  currentStep: onboardingStepEnum("current_step").default("company_profile").notNull(),
  overallStatus: varchar("overall_status", { length: 32 }).default("in_progress").notNull(),
  completedAt: timestamp("completed_at"),
  stepData: json("step_data").default({}).notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_onboarding_user_id").on(t.userId),
  index("idx_onboarding_status").on(t.overallStatus),
]);
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type InsertOnboardingProgress = typeof onboardingProgress.$inferInsert;

// ─── GEOFENCES (Sprint 73) ────────────────────────────────────────────────────
export const geofenceTypeEnum = pgEnum("geofence_type", ["port_entry", "port_exit", "restricted_zone", "customs_zone"]);
export const geofenceStatusEnum = pgEnum("geofence_status", ["active", "inactive", "draft"]);

export const geofences = pgTable("geofences", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  portCode: varchar("port_code", { length: 16 }),
  geofenceType: geofenceTypeEnum("geofence_type").default("port_entry").notNull(),
  status: geofenceStatusEnum("status").default("active").notNull(),
  polygon: json("polygon").notNull().$type<Array<{ lat: number; lon: number }>>(),
  radiusMeters: integer("radius_meters"),
  alertOnEntry: boolean("alert_on_entry").default(true).notNull(),
  alertOnExit: boolean("alert_on_exit").default(false).notNull(),
  notifyOwnerOnTrigger: boolean("notify_owner_on_trigger").default(true).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_geofences_port_code").on(t.portCode),
  index("idx_geofences_status").on(t.status),
]);
export type Geofence = typeof geofences.$inferSelect;
export type InsertGeofence = typeof geofences.$inferInsert;

export const geofenceEvents = pgTable("geofence_events", {
  id: serial("id").primaryKey(),
  geofenceId: integer("geofence_id").notNull().references(() => geofences.id),
  mmsi: varchar("mmsi", { length: 20 }).notNull(),
  vesselName: varchar("vessel_name", { length: 128 }),
  eventType: varchar("event_type", { length: 16 }).notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  speed: real("speed"),
  notificationSent: boolean("notification_sent").default(false).notNull(),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (t) => [
  index("idx_geofence_events_geofence_id").on(t.geofenceId),
  index("idx_geofence_events_mmsi").on(t.mmsi),
  index("idx_geofence_events_occurred_at").on(t.occurredAt),
]);
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type InsertGeofenceEvent = typeof geofenceEvents.$inferInsert;

// ─── WEBHOOK SUBSCRIPTIONS (Sprint 74) ───────────────────────────────────────
export const webhookEventTypeEnum = pgEnum("webhook_event_type", [
  "declaration.submitted", "declaration.approved", "declaration.rejected", "declaration.released",
  "payment.confirmed", "payment.failed",
  "kyc.approved", "kyc.rejected",
  "permit.issued", "permit.expiring",
  "vessel.geofence_entry", "vessel.geofence_exit",
  "alert.high_risk", "alert.sanctions_hit",
]);

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 128 }).notNull(),
  url: varchar("url", { length: 512 }).notNull(),
  secret: varchar("secret", { length: 256 }).notNull(),
  events: json("events").notNull().$type<string[]>(),
  isActive: boolean("is_active").default(true).notNull(),
  lastDeliveredAt: timestamp("last_delivered_at"),
  failureCount: integer("failure_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_webhook_subs_user_id").on(t.userId),
  index("idx_webhook_subs_active").on(t.isActive),
]);
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type InsertWebhookSubscription = typeof webhookSubscriptions.$inferInsert;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => webhookSubscriptions.id),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: json("payload").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  success: boolean("success").default(false).notNull(),
  attemptCount: integer("attempt_count").default(1).notNull(),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
}, (t) => [
  index("idx_webhook_deliveries_sub_id").on(t.subscriptionId),
  index("idx_webhook_deliveries_success").on(t.success),
]);
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;

// ─── API CHANGELOG (Sprint 74) ────────────────────────────────────────────────
export const apiChangeTypeEnum = pgEnum("api_change_type", ["added", "modified", "deprecated", "removed", "breaking"]);

export const apiChangelog = pgTable("api_changelog", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 32 }).notNull(),
  changeType: apiChangeTypeEnum("change_type").notNull(),
  endpoint: varchar("endpoint", { length: 256 }).notNull(),
  description: text("description").notNull(),
  breakingChange: boolean("breaking_change").default(false).notNull(),
  migrationGuide: text("migration_guide"),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  publishedBy: integer("published_by").references(() => users.id),
}, (t) => [
  index("idx_api_changelog_version").on(t.version),
  index("idx_api_changelog_published_at").on(t.publishedAt),
]);
export type ApiChangelog = typeof apiChangelog.$inferSelect;
export type InsertApiChangelog = typeof apiChangelog.$inferInsert;

// ─── ONBOARDING ANALYTICS (Sprint 72) ────────────────────────────────────────
export const onboardingAnalytics = pgTable("onboarding_analytics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  step: varchar("step", { length: 64 }).notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  timeSpentSeconds: integer("time_spent_seconds"),
  errorCount: integer("error_count").default(0).notNull(),
  metadata: json("metadata").default({}).$type<Record<string, unknown>>(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("idx_onboarding_analytics_user_id").on(t.userId),
  index("idx_onboarding_analytics_step").on(t.step),
  index("idx_onboarding_analytics_recorded_at").on(t.recordedAt),
]);
export type OnboardingAnalytic = typeof onboardingAnalytics.$inferSelect;
export type InsertOnboardingAnalytic = typeof onboardingAnalytics.$inferInsert;

// ─── RULES OF ORIGIN / AfCFTA (Sprint 78) ─────────────────────────────────────
export const originCertStatusEnum = pgEnum("origin_cert_status", [
  "draft", "submitted", "under_review", "approved", "rejected", "expired", "revoked"
]);
export const originCertTypeEnum = pgEnum("origin_cert_type", [
  "form_a", "eur1", "afcfta_co", "comesa_co", "ecowas_co", "bilateral_co"
]);
export const originCriteriaMet = pgEnum("origin_criteria_met", [
  "wholly_obtained", "substantial_transformation", "value_added_rule", "tariff_shift_rule"
]);

export const originCertificates = pgTable("origin_certificates", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  certType: originCertTypeEnum("cert_type").notNull().default("afcfta_co"),
  status: originCertStatusEnum("status").notNull().default("draft"),
  certNumber: varchar("cert_number", { length: 64 }),
  exporterName: varchar("exporter_name", { length: 256 }).notNull(),
  exporterAddress: text("exporter_address").notNull(),
  importerName: varchar("importer_name", { length: 256 }).notNull(),
  importerAddress: text("importer_address").notNull(),
  originCountry: varchar("origin_country", { length: 3 }).notNull(),
  destinationCountry: varchar("destination_country", { length: 3 }).notNull(),
  hsCode: varchar("hs_code", { length: 16 }).notNull(),
  goodsDescription: text("goods_description").notNull(),
  grossWeight: varchar("gross_weight", { length: 64 }),
  netWeight: varchar("net_weight", { length: 64 }),
  quantity: varchar("quantity", { length: 64 }),
  invoiceNumber: varchar("invoice_number", { length: 128 }),
  invoiceDate: timestamp("invoice_date"),
  originCriteria: originCriteriaMet("origin_criteria").notNull().default("substantial_transformation"),
  localValueAddedPct: integer("local_value_added_pct"),
  reviewNotes: text("review_notes"),
  approvedAt: timestamp("approved_at"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  revokedBy: integer("revoked_by").references(() => users.id),
  revocationReason: text("revocation_reason"),
  scanCount: integer("scan_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_origin_certs_trader_id").on(t.traderId),
  index("idx_origin_certs_declaration_id").on(t.declarationId),
  index("idx_origin_certs_status").on(t.status),
  index("idx_origin_certs_cert_number").on(t.certNumber),
]);
export type OriginCertificate = typeof originCertificates.$inferSelect;
export type InsertOriginCertificate = typeof originCertificates.$inferInsert;

// ─── PILOT PROGRAMME (Sprint 78) ──────────────────────────────────────────────
export const pilotScopeEnum = pgEnum("pilot_scope", ["apapa_apmt", "tin_can_island", "both"]);
export const pilotRoleEnum = pgEnum("pilot_role", ["ncs_officer", "trader", "oga_officer", "port_operator"]);

export const pilotParticipants = pgTable("pilot_participants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  pilotRole: pilotRoleEnum("pilot_role").notNull(),
  scope: pilotScopeEnum("scope").notNull().default("both"),
  organisation: varchar("organisation", { length: 256 }),
  contactEmail: varchar("contact_email", { length: 256 }),
  isActive: boolean("is_active").default(true).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  notes: text("notes"),
}, (t) => [
  index("idx_pilot_participants_user_id").on(t.userId),
  index("idx_pilot_participants_role").on(t.pilotRole),
]);
export type PilotParticipant = typeof pilotParticipants.$inferSelect;
export type InsertPilotParticipant = typeof pilotParticipants.$inferInsert;

export const pilotReports = pgTable("pilot_reports", {
  id: serial("id").primaryKey(),
  reportDate: timestamp("report_date").defaultNow().notNull(),
  totalDeclarations: integer("total_declarations").default(0).notNull(),
  greenLane: integer("green_lane").default(0).notNull(),
  yellowLane: integer("yellow_lane").default(0).notNull(),
  redLane: integer("red_lane").default(0).notNull(),
  avgClearanceHoursX100: integer("avg_clearance_hours_x100").default(0).notNull(),
  totalDutyCollectedKobo: bigint("total_duty_collected_kobo", { mode: "number" }).default(0).notNull(),
  activeTraders: integer("active_traders").default(0).notNull(),
  activeOfficers: integer("active_officers").default(0).notNull(),
  systemUptimePctX100: integer("system_uptime_pct_x100").default(10000).notNull(),
  reportPdfUrl: text("report_pdf_url"),
  generatedBy: integer("generated_by").references(() => users.id),
  emailedAt: timestamp("emailed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pilot_reports_date").on(t.reportDate),
]);
export type PilotReport = typeof pilotReports.$inferSelect;
export type InsertPilotReport = typeof pilotReports.$inferInsert;

// ─── AEO RENEWAL REQUESTS ─────────────────────────────────────────────────────
// Tracks trader-initiated renewal requests. Admins process them via AdminAEO.
export const aeoRenewalStatusEnum = pgEnum("aeo_renewal_status", [
  "pending", "approved", "rejected"
]);

export const aeoRenewalRequests = pgTable("aeo_renewal_requests", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => aeoApplications.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  status: aeoRenewalStatusEnum("status").default("pending").notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  processedBy: integer("processed_by").references(() => users.id),
  notes: text("notes"),
  complianceScoreAtRenewal: integer("compliance_score_at_renewal"),
}, (t) => [
  index("idx_aeo_renewal_app_id").on(t.applicationId),
  index("idx_aeo_renewal_trader_id").on(t.traderId),
]);
export type AeoRenewalRequest = typeof aeoRenewalRequests.$inferSelect;
export type InsertAeoRenewalRequest = typeof aeoRenewalRequests.$inferInsert;

// ─── COMPLIANCE EMAIL SCHEDULE ────────────────────────────────────────────────
// Stores the configurable nightly CSV delivery settings for the revocation log.
// Only one active row is expected (id=1), managed by admins via the UI.
export const complianceEmailSchedule = pgTable("compliance_email_schedule", {
  id: serial("id").primaryKey(),
  recipientEmail: varchar("recipient_email", { length: 256 }).notNull(),
  recipientName: varchar("recipient_name", { length: 256 }),
  isActive: boolean("is_active").default(true).notNull(),
  lastSentAt: timestamp("last_sent_at"),
  lastSentRows: integer("last_sent_rows"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  sendHourLocal: integer("send_hour_local").default(4).notNull(), // 0-23 in the configured timezone
});
export type ComplianceEmailSchedule = typeof complianceEmailSchedule.$inferSelect;
export type InsertComplianceEmailSchedule = typeof complianceEmailSchedule.$inferInsert;

// ─── COMPLIANCE EMAIL DELIVERY LOG ───────────────────────────────────────────
// Immutable audit trail of every nightly revocation CSV email attempt.
export const complianceEmailDeliveryLog = pgTable("compliance_email_delivery_log", {
  id: serial("id").primaryKey(),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  triggeredBy: varchar("triggered_by", { length: 64 }).default("cron").notNull(), // "cron" | "manual:<userId>"
  dateLabel: varchar("date_label", { length: 16 }).notNull(),   // "2026-03-09"
  rowCount: integer("row_count").notNull(),
  recipientCount: integer("recipient_count").notNull(),
  recipients: text("recipients").notNull(),                      // comma-separated emails
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
}, (t) => [
  index("idx_cedl_triggered_at").on(t.triggeredAt),
  index("idx_cedl_success").on(t.success),
]);
export type ComplianceEmailDeliveryLog = typeof complianceEmailDeliveryLog.$inferSelect;
export type InsertComplianceEmailDeliveryLog = typeof complianceEmailDeliveryLog.$inferInsert;

// ─── BULK EXPORT HISTORY ─────────────────────────────────────────────────────
// Records every bulk PDF ZIP export so officers can re-download recent archives.
export const bulkExports = pgTable("bulk_exports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  declarationIds: text("declaration_ids").notNull(),  // JSON array of declaration IDs
  declarationCount: integer("declaration_count").notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  s3Url: text("s3_url").notNull(),
  s3Key: text("s3_key").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  label: varchar("label", { length: 256 }),
}, (t) => [
  index("idx_bulk_exports_user_id").on(t.userId),
  index("idx_bulk_exports_created_at").on(t.createdAt),
]);
export type BulkExport = typeof bulkExports.$inferSelect;
export type InsertBulkExport = typeof bulkExports.$inferInsert;

// ─── SITE SETTINGS ───────────────────────────────────────────────────────────
// Key-value store for configurable platform settings editable by admins.
export const siteSettings = pgTable("site_settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => users.id),
});
export type SiteSetting = typeof siteSettings.$inferSelect;
export type InsertSiteSetting = typeof siteSettings.$inferInsert;

// ─── SETTINGS AUDIT LOG ─────────────────────────────────────────────────────
// Records every change to site_settings for admin accountability.
export const settingsAuditLog = pgTable("settings_audit_log", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key", { length: 128 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  changedBy: integer("changed_by").references(() => users.id),
  changedByName: text("changed_by_name"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  note: text("note"),
});
export type SettingsAuditLog = typeof settingsAuditLog.$inferSelect;

// ─── DOCUMENT VERSIONS ──────────────────────────────────────────────────────
// Soft-archives replaced document uploads so officers can audit version history.
export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  originalDocumentId: integer("original_document_id").notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  category: varchar("category", { length: 64 }).notNull(),
  description: text("description"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 128 }),
  s3Key: text("s3_key").notNull(),
  s3Url: text("s3_url").notNull(),
  replacedAt: timestamp("replaced_at").defaultNow().notNull(),
  replacedBy: integer("replaced_by").references(() => users.id),
  versionNote: text("version_note"),
}, (t) => [
  index("idx_docver_original_doc_id").on(t.originalDocumentId),
  index("idx_docver_declaration_id").on(t.declarationId),
]);
export type DocumentVersion = typeof documentVersions.$inferSelect;

// ─── 1B PAYMENTS/DAY ARCHITECTURE ────────────────────────────────────────────
// Implements the async payment queue pattern from:
// https://backend.how/posts/1b-payments-per-day/
// https://github.com/pratikgajjar/1b-payments

export const paymentQueueStatusEnum = pgEnum("payment_queue_status", [
  "queued", "processing", "committed", "failed", "dead_letter",
]);

export const paymentAccountTypeEnum = pgEnum("payment_account_type", [
  "trader", "customs_duty", "vat", "levy", "bond", "suspense",
]);

export const paymentArchivalTierEnum = pgEnum("payment_archival_tier", [
  "hot", "warm", "cold",
]);

export const paymentArchivalJobStatusEnum = pgEnum("payment_archival_job_status", [
  "pending", "running", "completed", "failed",
]);

export const paymentQueue = pgTable("payment_queue", {
  id: serial("id").primaryKey(),
  transferId: varchar("transfer_id", { length: 128 }).notNull().unique(),
  debitAccountId: varchar("debit_account_id", { length: 128 }).notNull(),
  creditAccountId: varchar("credit_account_id", { length: 128 }).notNull(),
  amountMinorUnits: bigint("amount_minor_units", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("GHS"),
  ledger: integer("ledger").notNull().default(1),
  status: paymentQueueStatusEnum("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at"),
  deadLetteredAt: timestamp("dead_lettered_at"),
  committedAt: timestamp("committed_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pq_status_retry").on(t.status, t.nextRetryAt),
  index("idx_pq_transfer_id").on(t.transferId),
  index("idx_pq_created_at").on(t.createdAt),
]);
export type PaymentQueueItem = typeof paymentQueue.$inferSelect;
export type InsertPaymentQueueItem = typeof paymentQueue.$inferInsert;

export const paymentAccounts = pgTable("payment_accounts", {
  id: serial("id").primaryKey(),
  accountId: varchar("account_id", { length: 128 }).notNull().unique(),
  traderId: integer("trader_id").references(() => users.id),
  accountType: paymentAccountTypeEnum("account_type").notNull().default("trader"),
  currency: varchar("currency", { length: 8 }).notNull().default("GHS"),
  ledger: integer("ledger").notNull().default(1),
  shardKey: integer("shard_key").notNull().default(0),
  debitsPosted: bigint("debits_posted", { mode: "bigint" }).notNull().default(sql`0`),
  creditsPosted: bigint("credits_posted", { mode: "bigint" }).notNull().default(sql`0`),
  debitsPending: bigint("debits_pending", { mode: "bigint" }).notNull().default(sql`0`),
  creditsPending: bigint("credits_pending", { mode: "bigint" }).notNull().default(sql`0`),
  lastSyncAt: timestamp("last_sync_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pa_account_id").on(t.accountId),
  index("idx_pa_trader_id").on(t.traderId),
  index("idx_pa_shard_key").on(t.shardKey),
]);
export type PaymentAccount = typeof paymentAccounts.$inferSelect;
export type InsertPaymentAccount = typeof paymentAccounts.$inferInsert;

export const paymentIdempotencyKeys = pgTable("payment_idempotency_keys", {
  id: serial("id").primaryKey(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  transferId: varchar("transfer_id", { length: 128 }).notNull(),
  responseSnapshot: jsonb("response_snapshot"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pik_key_hash").on(t.keyHash),
  index("idx_pik_expires_at").on(t.expiresAt),
]);
export type PaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferSelect;
export type InsertPaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferInsert;

export const paymentArchivalJobs = pgTable("payment_archival_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 128 }).notNull().unique(),
  tier: paymentArchivalTierEnum("tier").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  transfersArchived: integer("transfers_archived").notNull().default(0),
  bytesWritten: bigint("bytes_written", { mode: "bigint" }).notNull().default(sql`0`),
  storageUri: text("storage_uri"),
  status: paymentArchivalJobStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_paj_tier_created").on(t.tier, t.createdAt),
  index("idx_paj_job_id").on(t.jobId),
]);
export type PaymentArchivalJob = typeof paymentArchivalJobs.$inferSelect;
export type InsertPaymentArchivalJob = typeof paymentArchivalJobs.$inferInsert;

// ─── Bonded Warehouse Management ─────────────────────────────────────────────
export const bondedWarehouseStatusEnum = pgEnum("bonded_warehouse_status", [
  "active", "suspended", "revoked", "pending_renewal",
]);
export const bondedInventoryStatusEnum = pgEnum("bonded_inventory_status", [
  "in_bond", "ex_bonded", "re_exported", "destroyed", "seized",
]);
export const exBondPermitStatusEnum = pgEnum("ex_bond_permit_status", [
  "active", "used", "expired", "cancelled",
]);

export const bondedWarehouses = pgTable("bonded_warehouses", {
  id: serial("id").primaryKey(),
  licenseNo: varchar("license_no", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  operatorId: integer("operator_id").references(() => users.id),
  operatorName: varchar("operator_name", { length: 200 }).notNull(),
  country: varchar("country", { length: 3 }).notNull().default("NGA"),
  address: text("address").notNull(),
  portCode: varchar("port_code", { length: 10 }),
  capacityCbm: integer("capacity_cbm").notNull().default(0),
  usedCbm: integer("used_cbm").notNull().default(0),
  bondAmountUsd: bigint("bond_amount_usd", { mode: "number" }).notNull().default(0),
  bondExpiry: timestamp("bond_expiry"),
  status: bondedWarehouseStatusEnum("status").notNull().default("active"),
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_bw_operator").on(t.operatorId),
  index("idx_bw_status").on(t.status),
  index("idx_bw_port").on(t.portCode),
]);
export type BondedWarehouseRow = typeof bondedWarehouses.$inferSelect;

export const bondedInventory = pgTable("bonded_inventory", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull().references(() => bondedWarehouses.id),
  declarationId: integer("declaration_id").references(() => declarations.id),
  ucr: varchar("ucr", { length: 50 }).notNull(),
  hsCode: varchar("hs_code", { length: 20 }).notNull(),
  description: text("description").notNull(),
  quantityKg: integer("quantity_kg").notNull().default(0),
  volumeCbm: integer("volume_cbm").notNull().default(0),
  invoiceValueUsd: bigint("invoice_value_usd", { mode: "number" }).notNull().default(0),
  dutyLiabilityUsd: bigint("duty_liability_usd", { mode: "number" }).notNull().default(0),
  originCountry: varchar("origin_country", { length: 3 }),
  depositedAt: timestamp("deposited_at").defaultNow().notNull(),
  expiryDate: timestamp("expiry_date"),
  status: bondedInventoryStatusEnum("status").notNull().default("in_bond"),
  releasedAt: timestamp("released_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_bi_warehouse").on(t.warehouseId),
  index("idx_bi_declaration").on(t.declarationId),
  index("idx_bi_ucr").on(t.ucr),
  index("idx_bi_status").on(t.status),
]);
export type BondedInventoryRow = typeof bondedInventory.$inferSelect;

export const exBondPermits = pgTable("ex_bond_permits", {
  id: serial("id").primaryKey(),
  permitNo: varchar("permit_no", { length: 50 }).notNull().unique(),
  inventoryId: integer("inventory_id").notNull().references(() => bondedInventory.id),
  warehouseId: integer("warehouse_id").notNull().references(() => bondedWarehouses.id),
  requestedById: integer("requested_by_id").references(() => users.id),
  approvedById: integer("approved_by_id").references(() => users.id),
  quantityKg: integer("quantity_kg").notNull(),
  dutyPaidUsd: bigint("duty_paid_usd", { mode: "number" }).notNull().default(0),
  paymentRef: varchar("payment_ref", { length: 100 }),
  status: exBondPermitStatusEnum("status").notNull().default("active"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ebp_inventory").on(t.inventoryId),
  index("idx_ebp_warehouse").on(t.warehouseId),
  index("idx_ebp_status").on(t.status),
]);
export type ExBondPermitRow = typeof exBondPermits.$inferSelect;

// ─── CEP (Complex Event Processing) Patterns & Alerts ────────────────────────
export const cepPatternStatusEnum = pgEnum("cep_pattern_status", ["enabled", "disabled"]);
export const cepAlertStatusEnum = pgEnum("cep_alert_status", ["open", "investigating", "resolved", "false_positive"]);
export const cepAlertSeverityEnum = pgEnum("cep_alert_severity", ["low", "medium", "high", "critical"]);

export const cepPatterns = pgTable("cep_patterns", {
  id: serial("id").primaryKey(),
  patternId: varchar("pattern_id", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  status: cepPatternStatusEnum("status").notNull().default("enabled"),
  parameters: jsonb("parameters").notNull().default({}),
  triggerCount: integer("trigger_count").notNull().default(0),
  lastTriggeredAt: timestamp("last_triggered_at"),
  dailyAlertThreshold: integer("daily_alert_threshold"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cep_pattern_status").on(t.status),
]);
export type CepPatternRow = typeof cepPatterns.$inferSelect;

export const cepAlerts = pgTable("cep_alerts", {
  id: serial("id").primaryKey(),
  alertId: varchar("alert_id", { length: 100 }).notNull().unique(),
  patternId: varchar("pattern_id", { length: 100 }).notNull(),
  patternName: varchar("pattern_name", { length: 200 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  traderId: integer("trader_id").references(() => users.id),
  severity: cepAlertSeverityEnum("severity").notNull().default("medium"),
  status: cepAlertStatusEnum("status").notNull().default("open"),
  details: jsonb("details").notNull().default({}),
  riskScore: integer("risk_score").notNull().default(0),
  assignedTo: integer("assigned_to").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolutionNote: text("resolution_note"),
  suppressedUntil: timestamp("suppressed_until"),
  suppressedBy: integer("suppressed_by").references(() => users.id),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cep_alert_pattern").on(t.patternId),
  index("idx_cep_alert_status").on(t.status),
  index("idx_cep_alert_severity").on(t.severity),
  index("idx_cep_alert_trader").on(t.traderId),
  index("idx_cep_alert_detected").on(t.detectedAt),
]);
export type CepAlertRow = typeof cepAlerts.$inferSelect;

// ─── CEP Suppression Log ─────────────────────────────────────────────────────
export const cepSuppressionLog = pgTable("cep_suppression_log", {
  id: serial("id").primaryKey(),
  alertId: varchar("alert_id", { length: 100 }).notNull(),
  patternId: varchar("pattern_id", { length: 100 }).notNull(),
  patternName: varchar("pattern_name", { length: 200 }).notNull(),
  suppressedBy: integer("suppressed_by").references(() => users.id),
  suppressedByName: varchar("suppressed_by_name", { length: 200 }),
  suppressedUntil: timestamp("suppressed_until").notNull(),
  hours: integer("hours").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cep_supp_log_alert").on(t.alertId),
  index("idx_cep_supp_log_pattern").on(t.patternId),
  index("idx_cep_supp_log_created").on(t.createdAt),
]);
export type CepSuppressionLogRow = typeof cepSuppressionLog.$inferSelect;

// ─── Cost Records (Kubecost / FinOps) ────────────────────────────────────────
export const costCategoryEnum = pgEnum("cost_category", [
  "compute", "storage", "network", "database", "monitoring", "security", "other",
]);

export const costRecords = pgTable("cost_records", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  tenantName: varchar("tenant_name", { length: 200 }),
  namespace: varchar("namespace", { length: 100 }),
  service: varchar("service", { length: 100 }),
  category: costCategoryEnum("category").notNull().default("compute"),
  periodDate: date("period_date").notNull(),
  computeCostUsd: integer("compute_cost_usd").notNull().default(0),
  storageCostUsd: integer("storage_cost_usd").notNull().default(0),
  networkCostUsd: integer("network_cost_usd").notNull().default(0),
  totalCostUsd: integer("total_cost_usd").notNull().default(0),
  cpuRequestMillicores: integer("cpu_request_millicores"),
  memoryRequestMib: integer("memory_request_mib"),
  cpuUsageMillicores: integer("cpu_usage_millicores"),
  memoryUsageMib: integer("memory_usage_mib"),
  efficiency: integer("efficiency"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cr_tenant").on(t.tenantId),
  index("idx_cr_period").on(t.periodDate),
  index("idx_cr_service").on(t.service),
  index("idx_cr_category").on(t.category),
]);
export type CostRecordRow = typeof costRecords.$inferSelect;

// ─── Declaration Amendments ───────────────────────────────────────────────────
export const amendmentStatusEnum = pgEnum("amendment_status", [
  "pending", "approved", "rejected",
]);
export const declarationAmendments = pgTable("declaration_amendments", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  status: amendmentStatusEnum("status").default("pending").notNull(),
  fieldName: varchar("field_name", { length: 128 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  reason: text("reason").notNull(),
  reviewNotes: text("review_notes"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
}, (t) => [
  index("idx_da_declaration").on(t.declarationId),
  index("idx_da_status").on(t.status),
  index("idx_da_requester").on(t.requestedBy),
]);
export type DeclarationAmendment = typeof declarationAmendments.$inferSelect;

// ─── KPI Targets ─────────────────────────────────────────────────────────────
export const kpiTargets = pgTable("kpi_targets", {
  id: serial("id").primaryKey(),
  metricKey: varchar("metric_key", { length: 128 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  targetValue: decimal("target_value", { precision: 15, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 32 }),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kpi_key").on(t.metricKey),
]);
export type KpiTarget = typeof kpiTargets.$inferSelect;

// ─── TRADER SATISFACTION RATINGS ─────────────────────────────────────────────
import { smallint } from "drizzle-orm/pg-core";
export const traderRatings = pgTable("trader_ratings", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id, { onDelete: "cascade" }),
  traderId: integer("trader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: smallint("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("trader_ratings_decl_trader_unique").on(t.declarationId, t.traderId),
  index("idx_trader_ratings_trader").on(t.traderId),
  index("idx_trader_ratings_created").on(t.createdAt),
]);
export type TraderRating = typeof traderRatings.$inferSelect;

// ─── AUDIT ENGINE TASKS & FINDINGS (v56) ─────────────────────────────────────
export const auditSelectionReasonEnum = pgEnum("audit_selection_reason", [
  "risk_score_high", "random_sample", "trader_tier_review", "value_threshold",
  "hs_chapter_sensitive", "repeat_offender", "post_green_lane",
]);
export const auditTaskStatusEnum = pgEnum("audit_task_status", [
  "pending", "assigned", "in_progress", "findings_submitted", "closed", "appealed",
]);
export const auditFindingTypeEnum = pgEnum("audit_finding_type", [
  "undervaluation", "misclassification", "origin_mismatch", "quantity_discrepancy",
  "prohibited_goods", "documentation_fraud", "duty_evasion", "no_finding",
]);
export const auditTasks = pgTable("audit_tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  declarationId: varchar("declaration_id", { length: 64 }).notNull(),
  declarantName: varchar("declarant_name", { length: 255 }).notNull(),
  hsCode: varchar("hs_code", { length: 20 }),
  declaredValueUsd: decimal("declared_value_usd", { precision: 18, scale: 2 }).notNull(),
  dutyPaidUsd: decimal("duty_paid_usd", { precision: 18, scale: 2 }).notNull(),
  selectionReason: auditSelectionReasonEnum("selection_reason").notNull(),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }).notNull(),
  status: auditTaskStatusEnum("status").default("pending").notNull(),
  assignedOfficerId: varchar("assigned_officer_id", { length: 64 }),
  assignedOfficerName: varchar("assigned_officer_name", { length: 255 }),
  dueAt: timestamp("due_at").notNull(),
  dutyDiscrepancyUsd: decimal("duty_discrepancy_usd", { precision: 18, scale: 2 }).default("0"),
  appealNotes: text("appeal_notes").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
}, (t) => [
  index("idx_audit_tasks_status").on(t.status),
  index("idx_audit_tasks_decl").on(t.declarationId),
  index("idx_audit_tasks_created").on(t.createdAt),
]);
export type AuditTask = typeof auditTasks.$inferSelect;

export const auditFindings = pgTable("audit_findings", {
  id: varchar("id", { length: 64 }).primaryKey(),
  auditTaskId: varchar("audit_task_id", { length: 64 }).notNull().references(() => auditTasks.id, { onDelete: "cascade" }),
  findingType: auditFindingTypeEnum("finding_type").notNull(),
  description: text("description").notNull(),
  amountUsd: decimal("amount_usd", { precision: 18, scale: 2 }).default("0"),
  evidenceUrl: text("evidence_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_audit_findings_task").on(t.auditTaskId),
]);
export type AuditFinding = typeof auditFindings.$inferSelect;

// ─── TEMPORAL WORKFLOW REGISTRY (v56) ────────────────────────────────────────
export const temporalWorkflowStatusEnum = pgEnum("temporal_workflow_status", [
  "RUNNING", "COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED",
]);
export const temporalWorkflows = pgTable("temporal_workflows", {
  id: serial("id").primaryKey(),
  workflowId: varchar("workflow_id", { length: 255 }).notNull().unique(),
  runId: varchar("run_id", { length: 255 }).notNull(),
  workflowType: varchar("workflow_type", { length: 128 }).notNull(),
  declarationId: integer("declaration_id"),
  status: temporalWorkflowStatusEnum("status").default("RUNNING").notNull(),
  startTime: timestamp("start_time").defaultNow().notNull(),
  closeTime: timestamp("close_time"),
  currentStep: varchar("current_step", { length: 128 }),
  steps: jsonb("steps").default([]),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_temporal_wf_decl").on(t.declarationId),
  index("idx_temporal_wf_status").on(t.status),
  index("idx_temporal_wf_type").on(t.workflowType),
]);
export type TemporalWorkflow = typeof temporalWorkflows.$inferSelect;

// ─── NL QUERY HISTORY (v56) ───────────────────────────────────────────────────
export const nlQueryHistory = pgTable("nl_query_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  sql: text("sql"),
  resultCount: integer("result_count"),
  executionMs: integer("execution_ms"),
  success: boolean("success").default(true).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_nl_query_user").on(t.userId),
  index("idx_nl_query_created").on(t.createdAt),
]);
export type NlQueryHistory = typeof nlQueryHistory.$inferSelect;

// ─── NL QUERY TEMPLATES (v121) ───────────────────────────────────────────────
export const nlQueryTemplates = pgTable("nl_query_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  question: text("question").notNull(),
  category: varchar("category", { length: 64 }).default("custom").notNull(),
  useCount: integer("use_count").default(0).notNull(),
  isShared: boolean("is_shared").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_nl_query_templates_user_id").on(t.userId),
  index("idx_nl_query_templates_shared").on(t.isShared),
]);
export type NlQueryTemplate = typeof nlQueryTemplates.$inferSelect;
export type InsertNlQueryTemplate = typeof nlQueryTemplates.$inferInsert;

// ─── OFFICER WORKLOAD SNAPSHOTS (v56) ─────────────────────────────────────────
export const officerWorkloadSnapshots = pgTable("officer_workload_snapshots", {
  id: serial("id").primaryKey(),
  officerId: integer("officer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
  pendingDeclarations: integer("pending_declarations").default(0).notNull(),
  completedToday: integer("completed_today").default(0).notNull(),
  avgClearanceHours: decimal("avg_clearance_hours", { precision: 8, scale: 2 }),
  slaBreachCount: integer("sla_breach_count").default(0).notNull(),
  capacityPct: integer("capacity_pct").default(0),
}, (t) => [
  index("idx_officer_workload_officer").on(t.officerId),
  index("idx_officer_workload_date").on(t.snapshotDate),
]);
export type OfficerWorkloadSnapshot = typeof officerWorkloadSnapshots.$inferSelect;

// ─── SLA ESCALATIONS (v56) ────────────────────────────────────────────────────
export const slaEscalationStatusEnum = pgEnum("sla_escalation_status", [
  "open", "acknowledged", "resolved", "escalated",
]);
export const slaEscalations = pgTable("sla_escalations", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  declarationNumber: varchar("declaration_number", { length: 64 }),
  escalationLevel: integer("escalation_level").default(1).notNull(),
  breachType: varchar("breach_type", { length: 64 }).notNull(),
  breachHours: decimal("breach_hours", { precision: 8, scale: 2 }),
  status: slaEscalationStatusEnum("status").default("open").notNull(),
  assignedTo: integer("assigned_to").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  notes: text("notes"),
  // v124 additions
  reason: text("reason"),
  lane: varchar("lane", { length: 16 }),
  elapsedMs: bigint("elapsed_ms", { mode: "number" }),
  thresholdMs: bigint("threshold_ms", { mode: "number" }),
  resolved: boolean("resolved").default(false).notNull(),
  escalatedBy: integer("escalated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sla_esc_status").on(t.status),
  index("idx_sla_esc_decl").on(t.declarationId),
  index("idx_sla_esc_created").on(t.createdAt),
  index("idx_sla_esc_resolved").on(t.resolved),
]);
export type SlaEscalation = typeof slaEscalations.$inferSelect;

// ─── THREAT INTEL FEEDS (v56) ─────────────────────────────────────────────────
export const threatIntelSeverityEnum = pgEnum("threat_intel_severity", [
  "info", "low", "medium", "high", "critical",
]);
export const threatIntelFeeds = pgTable("threat_intel_feeds", {
  id: serial("id").primaryKey(),
  feedSource: varchar("feed_source", { length: 128 }).notNull(),
  indicatorType: varchar("indicator_type", { length: 64 }).notNull(),
  indicatorValue: text("indicator_value").notNull(),
  severity: threatIntelSeverityEnum("severity").default("medium").notNull(),
  description: text("description"),
  tags: jsonb("tags").default([]),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  relatedDeclarations: jsonb("related_declarations").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_threat_intel_source").on(t.feedSource),
  index("idx_threat_intel_severity").on(t.severity),
  index("idx_threat_intel_active").on(t.isActive),
]);
export type ThreatIntelFeed = typeof threatIntelFeeds.$inferSelect;

// ─── STREAM EVENTS (v56) ──────────────────────────────────────────────────────
export const streamEvents = pgTable("stream_events", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 128 }).notNull(),
  partitionKey: varchar("partition_key", { length: 128 }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  source: varchar("source", { length: 128 }),
  correlationId: varchar("correlation_id", { length: 128 }),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_stream_events_topic").on(t.topic),
  index("idx_stream_events_type").on(t.eventType),
  index("idx_stream_events_created").on(t.createdAt),
  index("idx_stream_events_correlation").on(t.correlationId),
]);
export type StreamEvent = typeof streamEvents.$inferSelect;

// ─── SOC INCIDENTS (v56) ──────────────────────────────────────────────────────
export const socIncidentSeverityEnum = pgEnum("soc_incident_severity", [
  "low", "medium", "high", "critical",
]);
export const socIncidentStatusEnum = pgEnum("soc_incident_status", [
  "open", "investigating", "contained", "resolved", "closed",
]);
export const socIncidents = pgTable("soc_incidents", {
  id: serial("id").primaryKey(),
  incidentNumber: varchar("incident_number", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  severity: socIncidentSeverityEnum("severity").default("medium").notNull(),
  status: socIncidentStatusEnum("status").default("open").notNull(),
  assignedTo: integer("assigned_to").references(() => users.id, { onDelete: "set null" }),
  affectedSystems: jsonb("affected_systems").default([]),
  iocs: jsonb("iocs").default([]),
  timeline: jsonb("timeline").default([]),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_soc_incidents_status").on(t.status),
  index("idx_soc_incidents_severity").on(t.severity),
  index("idx_soc_incidents_created").on(t.createdAt),
]);
export type SocIncident = typeof socIncidents.$inferSelect;

// ─── ASEAN SINGLE WINDOW MESSAGES (v56) ───────────────────────────────────────
export const aseanSwMessageTypeEnum = pgEnum("asean_sw_message_type", [
  "CUSCAR", "CUSRES", "CUSDEC", "IFTMIN", "IFTSTA", "COPARN", "COARRI",
]);
export const aseanSwMessages = pgTable("asean_sw_messages", {
  id: serial("id").primaryKey(),
  messageId: varchar("message_id", { length: 128 }).notNull().unique(),
  messageType: aseanSwMessageTypeEnum("message_type").notNull(),
  senderCountry: varchar("sender_country", { length: 3 }).notNull(),
  receiverCountry: varchar("receiver_country", { length: 3 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 32 }).default("sent").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_asean_sw_type").on(t.messageType),
  index("idx_asean_sw_decl").on(t.declarationId),
  index("idx_asean_sw_sent").on(t.sentAt),
]);
export type AseanSwMessage = typeof aseanSwMessages.$inferSelect;

// ─── FREE ZONE OPERATIONS (v56) ───────────────────────────────────────────────
export const freeZoneOperationTypeEnum = pgEnum("free_zone_operation_type", [
  "admission", "manufacturing", "re_export", "destruction", "transfer",
]);
export const freeZoneOperations = pgTable("free_zone_operations", {
  id: serial("id").primaryKey(),
  operationNumber: varchar("operation_number", { length: 64 }).notNull().unique(),
  operationType: freeZoneOperationTypeEnum("operation_type").notNull(),
  zoneId: varchar("zone_id", { length: 64 }).notNull(),
  zoneName: varchar("zone_name", { length: 255 }),
  traderId: integer("trader_id").references(() => users.id, { onDelete: "set null" }),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  goodsDescription: text("goods_description"),
  quantityKg: decimal("quantity_kg", { precision: 12, scale: 3 }),
  valueUsd: decimal("value_usd", { precision: 18, scale: 2 }),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_free_zone_ops_type").on(t.operationType),
  index("idx_free_zone_ops_zone").on(t.zoneId),
  index("idx_free_zone_ops_trader").on(t.traderId),
  index("idx_free_zone_ops_created").on(t.createdAt),
]);
export type FreeZoneOperation = typeof freeZoneOperations.$inferSelect;

// ─── CEN MESSAGES (v56) ───────────────────────────────────────────────────────
export const cenMessages = pgTable("cen_messages", {
  id: serial("id").primaryKey(),
  messageRef: varchar("message_ref", { length: 128 }).notNull().unique(),
  messageType: varchar("message_type", { length: 64 }).notNull(),
  originCountry: varchar("origin_country", { length: 3 }).notNull(),
  targetCountry: varchar("target_country", { length: 3 }),
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  attachments: jsonb("attachments").default([]),
  priority: varchar("priority", { length: 16 }).default("normal"),
  status: varchar("status", { length: 32 }).default("sent").notNull(),
  relatedDeclarations: jsonb("related_declarations").default([]),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cen_messages_type").on(t.messageType),
  index("idx_cen_messages_origin").on(t.originCountry),
  index("idx_cen_messages_sent").on(t.sentAt),
]);
export type CenMessage = typeof cenMessages.$inferSelect;

// ─── KNOWLEDGE GRAPH NODES & EDGES (v56) ──────────────────────────────────────
export const knowledgeGraphNodes = pgTable("knowledge_graph_nodes", {
  id: serial("id").primaryKey(),
  nodeId: varchar("node_id", { length: 128 }).notNull().unique(),
  nodeType: varchar("node_type", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  properties: jsonb("properties").default({}),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kg_nodes_type").on(t.nodeType),
  index("idx_kg_nodes_label").on(t.label),
]);
export type KnowledgeGraphNode = typeof knowledgeGraphNodes.$inferSelect;

export const knowledgeGraphEdges = pgTable("knowledge_graph_edges", {
  id: serial("id").primaryKey(),
  sourceNodeId: varchar("source_node_id", { length: 128 }).notNull().references(() => knowledgeGraphNodes.nodeId, { onDelete: "cascade" }),
  targetNodeId: varchar("target_node_id", { length: 128 }).notNull().references(() => knowledgeGraphNodes.nodeId, { onDelete: "cascade" }),
  edgeType: varchar("edge_type", { length: 64 }).notNull(),
  weight: decimal("weight", { precision: 8, scale: 4 }).default("1.0"),
  properties: jsonb("properties").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kg_edges_source").on(t.sourceNodeId),
  index("idx_kg_edges_target").on(t.targetNodeId),
  index("idx_kg_edges_type").on(t.edgeType),
]);
export type KnowledgeGraphEdge = typeof knowledgeGraphEdges.$inferSelect;

// ─── RISK MODEL CONFIGURATIONS (v56) ─────────────────────────────────────────
export const riskModelConfigs = pgTable("risk_model_configs", {
  id: serial("id").primaryKey(),
  modelName: varchar("model_name", { length: 128 }).notNull().unique(),
  version: varchar("version", { length: 32 }).notNull(),
  featureWeights: jsonb("feature_weights").notNull(),
  thresholds: jsonb("thresholds").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastTrainedAt: timestamp("last_trained_at"),
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }),
  f1Score: decimal("f1_score", { precision: 5, scale: 4 }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_risk_model_active").on(t.isActive),
  index("idx_risk_model_name").on(t.modelName),
]);
export type RiskModelConfig = typeof riskModelConfigs.$inferSelect;

// ─── INSIDER THREAT EVENTS (v67) ──────────────────────────────────────────────
export const insiderThreatEvents = pgTable("insider_threat_events", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  tbEventCode: integer("tb_event_code").notNull(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorRole: varchar("actor_role", { length: 64 }),
  targetEntityType: varchar("target_entity_type", { length: 64 }),
  targetEntityId: varchar("target_entity_id", { length: 255 }),
  action: varchar("action", { length: 255 }).notNull(),
  description: text("description"),
  ipAddress: varchar("ip_address", { length: 64 }),
  sessionId: varchar("session_id", { length: 255 }),
  chainHash: varchar("chain_hash", { length: 64 }),
  prevChainHash: varchar("prev_chain_hash", { length: 64 }),
  severity: varchar("severity", { length: 16 }).default("LOW").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_insider_events_actor").on(t.actorId),
  index("idx_insider_events_type").on(t.eventType),
  index("idx_insider_events_severity").on(t.severity),
  index("idx_insider_events_created").on(t.createdAt),
  index("idx_insider_events_session").on(t.sessionId),
]);
export type InsiderThreatEvent = typeof insiderThreatEvents.$inferSelect;

// ─── PRIVILEGED ACTION APPROVALS — 4-Eyes Control (v67) ──────────────────────
export const privilegedActionApprovals = pgTable("privileged_action_approvals", {
  id: serial("id").primaryKey(),
  approvalRef: varchar("approval_ref", { length: 128 }).notNull().unique(),
  requesterId: integer("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }).notNull(),
  description: text("description").notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  approverReason: text("approver_reason"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  expiresAt: timestamp("expires_at").notNull(),
  metadata: jsonb("metadata").default({}),
}, (t) => [
  index("idx_paa_requester").on(t.requesterId),
  index("idx_paa_status").on(t.status),
  index("idx_paa_expires").on(t.expiresAt),
  index("idx_paa_ref").on(t.approvalRef),
]);
export type PrivilegedActionApproval = typeof privilegedActionApprovals.$inferSelect;

// ─── SESSION AUDIT LOG (v67) ──────────────────────────────────────────────────
export const sessionAuditLog = pgTable("session_audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
  geoLocation: varchar("geo_location", { length: 128 }),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }).default("0"),
  isSuspicious: boolean("is_suspicious").default(false).notNull(),
  suspicionReason: text("suspicion_reason"),
  forcedByUserId: integer("forced_by_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sal_user").on(t.userId),
  index("idx_sal_session").on(t.sessionId),
  index("idx_sal_event_type").on(t.eventType),
  index("idx_sal_suspicious").on(t.isSuspicious),
  index("idx_sal_created").on(t.createdAt),
]);
export type SessionAuditLogEntry = typeof sessionAuditLog.$inferSelect;

// ─── ANOMALY DETECTIONS (v67) ─────────────────────────────────────────────────
export const anomalyDetections = pgTable("anomaly_detections", {
  id: serial("id").primaryKey(),
  ruleId: varchar("rule_id", { length: 64 }).notNull(),
  ruleName: varchar("rule_name", { length: 255 }).notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  sessionId: varchar("session_id", { length: 255 }),
  severity: varchar("severity", { length: 16 }).notNull(),
  anomalyScore: decimal("anomaly_score", { precision: 8, scale: 6 }),
  description: text("description").notNull(),
  recommendedAction: text("recommended_action"),
  features: jsonb("features").default({}),
  isAcknowledged: boolean("is_acknowledged").default(false).notNull(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at"),
  linkedEventId: integer("linked_event_id").references(() => insiderThreatEvents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_anomaly_user").on(t.userId),
  index("idx_anomaly_severity").on(t.severity),
  index("idx_anomaly_rule").on(t.ruleId),
  index("idx_anomaly_acknowledged").on(t.isAcknowledged),
  index("idx_anomaly_created").on(t.createdAt),
]);
export type AnomalyDetection = typeof anomalyDetections.$inferSelect;

// ─── v77: Missing Schema Tables ──────────────────────────────────────────────

// 1. TigerBeetle bond ledger (import_bond | transit_bond | aeo_bond)
export const bondTypeEnum = pgEnum("bond_type", [
  "import_bond", "transit_bond", "aeo_bond",
]);
export const bondStatusEnum = pgEnum("bond_status", [
  "active", "released", "forfeited", "expired",
]);
export const tigerbeetleBonds = pgTable("tigerbeetle_bonds", {
  id: serial("id").primaryKey(),
  bondId: varchar("bond_id", { length: 40 }).notNull().unique(),
  tbTransferId: varchar("tb_transfer_id", { length: 40 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  traderId: integer("trader_id").references(() => users.id, { onDelete: "set null" }),
  bondType: bondTypeEnum("bond_type").notNull(),
  bondAmount: decimal("bond_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
  status: bondStatusEnum("status").default("active").notNull(),
  expiryDate: timestamp("expiry_date"),
  releasedAt: timestamp("released_at"),
  releaseReason: varchar("release_reason", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tb_bonds_declaration").on(t.declarationId),
  index("idx_tb_bonds_trader").on(t.traderId),
  index("idx_tb_bonds_status").on(t.status),
  index("idx_tb_bonds_type").on(t.bondType),
]);
export type TigerbeetleBond = typeof tigerbeetleBonds.$inferSelect;
export type InsertTigerbeetleBond = typeof tigerbeetleBonds.$inferInsert;

// 2. TigerBeetle penalty ledger
export const penaltyCodeEnum = pgEnum("penalty_code", [
  "UNDER_DECLARATION", "PROHIBITED_GOODS", "LATE_FILING", "MISDESCRIPTION", "SMUGGLING",
]);
export const penaltyStatusEnum = pgEnum("penalty_status", [
  "assessed", "paid", "appealed", "waived", "written_off",
]);
export const tigerbeetlePenalties = pgTable("tigerbeetle_penalties", {
  id: serial("id").primaryKey(),
  penaltyId: varchar("penalty_id", { length: 40 }).notNull().unique(),
  tbTransferId: varchar("tb_transfer_id", { length: 40 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  traderId: integer("trader_id").references(() => users.id, { onDelete: "set null" }),
  officerId: integer("officer_id").references(() => users.id, { onDelete: "set null" }),
  penaltyCode: penaltyCodeEnum("penalty_code").notNull(),
  penaltyAmount: decimal("penalty_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
  status: penaltyStatusEnum("status").default("assessed").notNull(),
  appealDeadline: timestamp("appeal_deadline"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tb_penalties_declaration").on(t.declarationId),
  index("idx_tb_penalties_trader").on(t.traderId),
  index("idx_tb_penalties_code").on(t.penaltyCode),
  index("idx_tb_penalties_status").on(t.status),
]);
export type TigerbeetlePenalty = typeof tigerbeetlePenalties.$inferSelect;
export type InsertTigerbeetlePenalty = typeof tigerbeetlePenalties.$inferInsert;

// 3. Transit guarantees (COMESA / ASEAN cross-border)
export const transitGuaranteeStatusEnum = pgEnum("transit_guarantee_status", [
  "active", "discharged", "forfeited", "expired",
]);
export const tigerbeetleTransitGuarantees = pgTable("tigerbeetle_transit_guarantees", {
  id: serial("id").primaryKey(),
  guaranteeId: varchar("guarantee_id", { length: 40 }).notNull().unique(),
  tbTransferId: varchar("tb_transfer_id", { length: 40 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  traderId: integer("trader_id").references(() => users.id, { onDelete: "set null" }),
  guaranteeAmount: decimal("guarantee_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
  destinationCountry: varchar("destination_country", { length: 2 }).notNull(),
  transitDays: integer("transit_days").notNull(),
  status: transitGuaranteeStatusEnum("status").default("active").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  dischargedAt: timestamp("discharged_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tb_tg_declaration").on(t.declarationId),
  index("idx_tb_tg_trader").on(t.traderId),
  index("idx_tb_tg_status").on(t.status),
  index("idx_tb_tg_valid_until").on(t.validUntil),
]);
export type TigerbeetleTransitGuarantee = typeof tigerbeetleTransitGuarantees.$inferSelect;
export type InsertTigerbeetleTransitGuarantee = typeof tigerbeetleTransitGuarantees.$inferInsert;

// 4. Payment risk scores (from Python payment-risk-scorer)
export const riskTierEnum = pgEnum("risk_tier", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const paymentRiskScores = pgTable("payment_risk_scores", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "cascade" }),
  traderId: integer("trader_id").references(() => users.id, { onDelete: "set null" }),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }).notNull(),
  riskTier: riskTierEnum("risk_tier").notNull(),
  recommendedAction: varchar("recommended_action", { length: 32 }).notNull(), // APPROVE | REVIEW | BLOCK
  flags: jsonb("flags").default([]),
  modelVersion: varchar("model_version", { length: 64 }),
  fspId: varchar("fsp_id", { length: 64 }),
  fspType: varchar("fsp_type", { length: 32 }),
  amount: decimal("amount", { precision: 18, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  scoredAt: timestamp("scored_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_prs_declaration").on(t.declarationId),
  index("idx_prs_trader").on(t.traderId),
  index("idx_prs_tier").on(t.riskTier),
  index("idx_prs_scored_at").on(t.scoredAt),
]);
export type PaymentRiskScore = typeof paymentRiskScores.$inferSelect;
export type InsertPaymentRiskScore = typeof paymentRiskScores.$inferInsert;

// 5. HS code classification cache (from Rust hs-classifier)
export const hsClassificationCache = pgTable("hs_classification_cache", {
  id: serial("id").primaryKey(),
  hsCode: varchar("hs_code", { length: 10 }).notNull(),
  description: text("description").notNull(),
  chapter: varchar("chapter", { length: 2 }).notNull(),
  heading: varchar("heading", { length: 4 }).notNull(),
  subheading: varchar("subheading", { length: 6 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  classifiedBy: varchar("classified_by", { length: 32 }).default("hs-classifier-rust").notNull(),
  modelVersion: varchar("model_version", { length: 64 }),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"),
  hitCount: integer("hit_count").default(0).notNull(),
  lastHitAt: timestamp("last_hit_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_hs_cache_code").on(t.hsCode),
  index("idx_hs_cache_chapter").on(t.chapter),
  index("idx_hs_cache_confidence").on(t.confidence),
]);
export type HsClassificationCache = typeof hsClassificationCache.$inferSelect;
export type InsertHsClassificationCache = typeof hsClassificationCache.$inferInsert;

// 6. A/B model divergence log (from Python insider-threat-svc)
export const abDivergenceLog = pgTable("ab_divergence_log", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 128 }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  productionDecision: varchar("production_decision", { length: 32 }).notNull(), // ALLOW | BLOCK | REVIEW
  shadowDecision: varchar("shadow_decision", { length: 32 }).notNull(),
  productionScore: decimal("production_score", { precision: 5, scale: 4 }),
  shadowScore: decimal("shadow_score", { precision: 5, scale: 4 }),
  diverged: boolean("diverged").notNull(),
  featureVector: jsonb("feature_vector").default({}),
  modelVersionProduction: varchar("model_version_production", { length: 64 }),
  modelVersionShadow: varchar("model_version_shadow", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ab_div_user").on(t.userId),
  index("idx_ab_div_diverged").on(t.diverged),
  index("idx_ab_div_created").on(t.createdAt),
]);
export type AbDivergenceLog = typeof abDivergenceLog.$inferSelect;
export type InsertAbDivergenceLog = typeof abDivergenceLog.$inferInsert;

// ─── v78: Kafka & PostgreSQL Audit — New Tables ──────────────────────────────

/**
 * kyc_events — persists KYC analysis results for audit and compliance.
 * Populated by the kyc-service after each /api/kyc/analyse call.
 */
export const kycEvents = pgTable("kyc_events", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  documentType: varchar("document_type", { length: 64 }).notNull(),
  extractedData: jsonb("extracted_data").default({}),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }),
  riskLevel: varchar("risk_level", { length: 32 }),
  anomaliesDetected: jsonb("anomalies_detected").default([]),
  ocrConfidence: decimal("ocr_confidence", { precision: 5, scale: 4 }),
  processingMs: integer("processing_ms"),
  status: varchar("status", { length: 32 }).notNull().default("completed"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kyc_events_declaration").on(t.declarationId),
  index("idx_kyc_events_user").on(t.userId),
  index("idx_kyc_events_risk_level").on(t.riskLevel),
  index("idx_kyc_events_created").on(t.createdAt),
]);
export type KycEvent = typeof kycEvents.$inferSelect;
export type InsertKycEvent = typeof kycEvents.$inferInsert;

/**
 * kafka_event_log — durable outbox for Kafka domain events.
 * Enables at-least-once delivery guarantees and replay capability.
 */
export const kafkaEventLog = pgTable("kafka_event_log", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 256 }).notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 256 }).notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  publishedAt: timestamp("published_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_kafka_log_topic").on(t.topic),
  index("idx_kafka_log_status").on(t.status),
  index("idx_kafka_log_aggregate").on(t.aggregateId),
  index("idx_kafka_log_created").on(t.createdAt),
]);
export type KafkaEventLog = typeof kafkaEventLog.$inferSelect;
export type InsertKafkaEventLog = typeof kafkaEventLog.$inferInsert;

/**
 * oga_permit_events — event sourcing log for OGA permit state transitions.
 * Each row records a single state change (requested → approved → rejected → expired).
 */
export const ogaPermitEvents = pgTable("oga_permit_events", {
  id: serial("id").primaryKey(),
  permitId: integer("permit_id").references(() => ogaPermits.id, { onDelete: "cascade" }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  agencyCode: varchar("agency_code", { length: 32 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  previousStatus: varchar("previous_status", { length: 32 }),
  newStatus: varchar("new_status", { length: 32 }).notNull(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorType: varchar("actor_type", { length: 32 }).default("system"),
  remarks: text("remarks"),
  metadata: jsonb("metadata").default({}),
  kafkaOffset: bigint("kafka_offset", { mode: "number" }),
  kafkaPartition: integer("kafka_partition"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_oga_permit_events_permit").on(t.permitId),
  index("idx_oga_permit_events_declaration").on(t.declarationId),
  index("idx_oga_permit_events_agency").on(t.agencyCode),
  index("idx_oga_permit_events_type").on(t.eventType),
  index("idx_oga_permit_events_created").on(t.createdAt),
]);
export type OgaPermitEvent = typeof ogaPermitEvents.$inferSelect;
export type InsertOgaPermitEvent = typeof ogaPermitEvents.$inferInsert;

// ─── Middleware Audit Tables ──────────────────────────────────────────────────

export const keycloakSessions = pgTable("keycloak_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sessionId: varchar("session_id", { length: 128 }).unique().notNull(),
  realmId: varchar("realm_id", { length: 64 }).notNull().default("tradegateway"),
  clientId: varchar("client_id", { length: 128 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").default(true).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastAccessAt: timestamp("last_access_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_keycloak_sessions_user").on(t.userId),
  index("idx_keycloak_sessions_session").on(t.sessionId),
  index("idx_keycloak_sessions_active").on(t.isActive),
]);
export type KeycloakSession = typeof keycloakSessions.$inferSelect;
export type InsertKeycloakSession = typeof keycloakSessions.$inferInsert;

export const permifyAuditLog = pgTable("permify_audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  operation: varchar("operation", { length: 32 }).notNull(),
  entity: varchar("entity", { length: 128 }).notNull(),
  relation: varchar("relation", { length: 128 }).notNull(),
  subject: varchar("subject", { length: 128 }).notNull(),
  allowed: boolean("allowed"),
  schemaVersion: varchar("schema_version", { length: 32 }),
  snapToken: varchar("snap_token", { length: 128 }),
  latencyMs: integer("latency_ms"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_permify_audit_actor").on(t.actorId),
  index("idx_permify_audit_entity").on(t.entity),
  index("idx_permify_audit_operation").on(t.operation),
  index("idx_permify_audit_created").on(t.createdAt),
]);
export type PermifyAuditLog = typeof permifyAuditLog.$inferSelect;
export type InsertPermifyAuditLog = typeof permifyAuditLog.$inferInsert;

export const temporalWorkflowRuns = pgTable("temporal_workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: varchar("workflow_id", { length: 256 }).notNull(),
  runId: varchar("run_id", { length: 128 }).unique().notNull(),
  workflowType: varchar("workflow_type", { length: 128 }).notNull(),
  taskQueue: varchar("task_queue", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id, { onDelete: "set null" }),
  input: jsonb("input").default({}),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_temporal_runs_workflow").on(t.workflowId),
  index("idx_temporal_runs_type").on(t.workflowType),
  index("idx_temporal_runs_status").on(t.status),
  index("idx_temporal_runs_declaration").on(t.declarationId),
  index("idx_temporal_runs_started").on(t.startedAt),
]);
export type TemporalWorkflowRun = typeof temporalWorkflowRuns.$inferSelect;
export type InsertTemporalWorkflowRun = typeof temporalWorkflowRuns.$inferInsert;

export const fluvioTopicOffsets = pgTable("fluvio_topic_offsets", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 128 }).notNull(),
  partition: integer("partition").notNull().default(0),
  consumerGroup: varchar("consumer_group", { length: 128 }).notNull(),
  committedOffset: bigint("committed_offset", { mode: "number" }).notNull().default(0),
  latestOffset: bigint("latest_offset", { mode: "number" }).notNull().default(0),
  lagCount: bigint("lag_count", { mode: "number" }).notNull().default(0),
  isHealthy: boolean("is_healthy").default(true).notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_fluvio_offsets_topic").on(t.topic),
  index("idx_fluvio_offsets_group").on(t.consumerGroup),
  index("idx_fluvio_offsets_lag").on(t.lagCount),
]);
export type FluvioTopicOffset = typeof fluvioTopicOffsets.$inferSelect;
export type InsertFluvioTopicOffset = typeof fluvioTopicOffsets.$inferInsert;

export const apisixRouteAudit = pgTable("apisix_route_audit", {
  id: serial("id").primaryKey(),
  routeId: varchar("route_id", { length: 128 }).notNull(),
  routeName: varchar("route_name", { length: 256 }),
  operation: varchar("operation", { length: 32 }).notNull(),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  previousConfig: jsonb("previous_config"),
  newConfig: jsonb("new_config"),
  changeReason: text("change_reason"),
  apisixVersion: varchar("apisix_version", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_apisix_audit_route").on(t.routeId),
  index("idx_apisix_audit_operation").on(t.operation),
  index("idx_apisix_audit_actor").on(t.actorId),
  index("idx_apisix_audit_created").on(t.createdAt),
]);
export type ApisixRouteAudit = typeof apisixRouteAudit.$inferSelect;
export type InsertApisixRouteAudit = typeof apisixRouteAudit.$inferInsert;

export const openAppSecEvents = pgTable("open_appsec_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 128 }).unique(),
  severity: varchar("severity", { length: 16 }).notNull(),
  attackType: varchar("attack_type", { length: 64 }).notNull(),
  sourceIp: varchar("source_ip", { length: 64 }),
  targetPath: text("target_path"),
  httpMethod: varchar("http_method", { length: 16 }),
  requestHeaders: jsonb("request_headers").default({}),
  requestBody: text("request_body"),
  action: varchar("action", { length: 32 }).notNull().default("block"),
  confidence: integer("confidence"),
  waapVersion: varchar("waap_version", { length: 32 }),
  isAcknowledged: boolean("is_acknowledged").default(false).notNull(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_openappsec_severity").on(t.severity),
  index("idx_openappsec_attack").on(t.attackType),
  index("idx_openappsec_ip").on(t.sourceIp),
  index("idx_openappsec_action").on(t.action),
  index("idx_openappsec_created").on(t.createdAt),
]);
export type OpenAppSecEvent = typeof openAppSecEvents.$inferSelect;
export type InsertOpenAppSecEvent = typeof openAppSecEvents.$inferInsert;

export const lakehouseJobs = pgTable("lakehouse_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 128 }).unique().notNull(),
  jobType: varchar("job_type", { length: 64 }).notNull(),
  targetTable: varchar("target_table", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  rowsProcessed: bigint("rows_processed", { mode: "number" }).default(0),
  rowsWritten: bigint("rows_written", { mode: "number" }).default(0),
  errorMessage: text("error_message"),
  sparkJobUrl: text("spark_job_url"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  triggeredBy: varchar("triggered_by", { length: 64 }).default("scheduler"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_lakehouse_jobs_type").on(t.jobType),
  index("idx_lakehouse_jobs_status").on(t.status),
  index("idx_lakehouse_jobs_target").on(t.targetTable),
  index("idx_lakehouse_jobs_created").on(t.createdAt),
]);
export type LakehouseJob = typeof lakehouseJobs.$inferSelect;
export type InsertLakehouseJob = typeof lakehouseJobs.$inferInsert;

// ─── GeoIP Cache (v82) ────────────────────────────────────────────────────────
export const geoipCache = pgTable("geoip_cache", {
  id: serial("id").primaryKey(),
  ip: varchar("ip", { length: 45 }).notNull().unique(),
  country: varchar("country", { length: 64 }),
  countryCode: varchar("country_code", { length: 4 }),
  city: varchar("city", { length: 128 }),
  asn: varchar("asn", { length: 32 }),
  asnOrg: varchar("asn_org", { length: 256 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_geoip_ip").on(t.ip),
  index("idx_geoip_country").on(t.countryCode),
]);
export type GeoipCache = typeof geoipCache.$inferSelect;
export type InsertGeoipCache = typeof geoipCache.$inferInsert;

// ─── GeoIP Seed Jobs ─────────────────────────────────────────────────────────
export const geoipSeedJobs = pgTable("geoip_seed_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 128 }).unique().notNull(),
  filename: varchar("filename", { length: 256 }).notNull(),
  s3Key: text("s3_key"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  rowsInserted: integer("rows_inserted").default(0),
  rowsSkipped: integer("rows_skipped").default(0),
  rowsTotal: integer("rows_total").default(0),
  errorMessage: text("error_message"),
  triggeredBy: varchar("triggered_by", { length: 64 }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_geoip_seed_status").on(t.status),
  index("idx_geoip_seed_created").on(t.createdAt),
]);
export type GeoipSeedJob = typeof geoipSeedJobs.$inferSelect;
export type InsertGeoipSeedJob = typeof geoipSeedJobs.$inferInsert;

// ─── Workflow Input Schemas ───────────────────────────────────────────────────
export const workflowInputSchemas = pgTable("workflow_input_schemas", {
  id: serial("id").primaryKey(),
  workflowType: varchar("workflow_type", { length: 128 }).notNull(),
  version: integer("version").notNull().default(1),
  jsonSchema: jsonb("json_schema").notNull().default({}),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_workflow_schemas_type").on(t.workflowType),
  index("idx_workflow_schemas_active").on(t.isActive),
  unique("uq_workflow_schema_type_version").on(t.workflowType, t.version),
]);
export type WorkflowInputSchema = typeof workflowInputSchemas.$inferSelect;
export type InsertWorkflowInputSchema = typeof workflowInputSchemas.$inferInsert;

// ─── Cron Run Logs ────────────────────────────────────────────────────────────
export const cronRunLogs = pgTable("cron_run_logs", {
  id: serial("id").primaryKey(),
  jobName: varchar("job_name", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("success"), // success | error
  triggeredBy: varchar("triggered_by", { length: 64 }).notNull().default("scheduler"), // scheduler | manual
  durationMs: integer("duration_ms"),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cron_run_logs_job").on(t.jobName),
  index("idx_cron_run_logs_status").on(t.status),
  index("idx_cron_run_logs_started").on(t.startedAt),
]);
export type CronRunLog = typeof cronRunLogs.$inferSelect;
export type InsertCronRunLog = typeof cronRunLogs.$inferInsert;

// ─── Health Thresholds ────────────────────────────────────────────────────────
export const healthThresholds = pgTable("health_thresholds", {
  id: serial("id").primaryKey(),
  componentName: varchar("component_name", { length: 128 }).notNull().unique(),
  degradedMs: integer("degraded_ms").notNull().default(500),
  unhealthyMs: integer("unhealthy_ms").notNull().default(2000),
  updatedBy: varchar("updated_by", { length: 128 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_health_thresholds_component").on(t.componentName),
]);
export type HealthThreshold = typeof healthThresholds.$inferSelect;
export type InsertHealthThreshold = typeof healthThresholds.$inferInsert;

// ─── Threshold Audit Log ──────────────────────────────────────────────────────
export const thresholdAuditLog = pgTable("threshold_audit_log", {
  id: serial("id").primaryKey(),
  componentName: varchar("component_name", { length: 128 }).notNull(),
  changedBy: varchar("changed_by", { length: 128 }).notNull(),
  changedByUserId: integer("changed_by_user_id"),
  fromDegradedMs: integer("from_degraded_ms").notNull(),
  toDegradedMs: integer("to_degraded_ms").notNull(),
  fromUnhealthyMs: integer("from_unhealthy_ms"),
  toUnhealthyMs: integer("to_unhealthy_ms"),
  changeReason: text("change_reason"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
}, (t) => [
  index("idx_threshold_audit_component").on(t.componentName),
  index("idx_threshold_audit_changed_at").on(t.changedAt),
]);
export type ThresholdAuditLog = typeof thresholdAuditLog.$inferSelect;
export type InsertThresholdAuditLog = typeof thresholdAuditLog.$inferInsert;

// ─── Export Schedules ─────────────────────────────────────────────────────────
export const exportSchedules = pgTable("export_schedules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  exportType: varchar("export_type", { length: 64 }).notNull(),
  cadence: varchar("cadence", { length: 32 }).notNull().default("weekly"),
  filterPreset: varchar("filter_preset", { length: 16 }).notNull().default("30"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_export_schedules_user").on(t.userId),
  index("idx_export_schedules_next_run").on(t.nextRunAt),
  index("idx_export_schedules_active").on(t.isActive),
]);
export type ExportSchedule = typeof exportSchedules.$inferSelect;
export type InsertExportSchedule = typeof exportSchedules.$inferInsert;

// ─── AEO Renewals ─────────────────────────────────────────────────────────────
export const aeoRenewals = pgTable("aeo_renewals", {
  id: serial("id").primaryKey(),
  aeoApplicationId: integer("aeo_application_id").notNull(),
  traderId: integer("trader_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  expiryDate: timestamp("expiry_date"),
  renewalDueDate: timestamp("renewal_due_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_aeo_renewals_trader").on(t.traderId),
  index("idx_aeo_renewals_status").on(t.status),
  index("idx_aeo_renewals_due").on(t.renewalDueDate),
]);
export type AeoRenewal = typeof aeoRenewals.$inferSelect;
export type InsertAeoRenewal = typeof aeoRenewals.$inferInsert;

// ─── Bond Expiry Alerts ───────────────────────────────────────────────────────
export const bondExpiryAlerts = pgTable("bond_expiry_alerts", {
  id: serial("id").primaryKey(),
  bondId: integer("bond_id").notNull(),
  traderId: integer("trader_id").notNull(),
  alertType: varchar("alert_type", { length: 32 }).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  notificationId: integer("notification_id"),
}, (t) => [
  index("idx_bond_expiry_alerts_bond").on(t.bondId),
  index("idx_bond_expiry_alerts_trader").on(t.traderId),
]);
export type BondExpiryAlert = typeof bondExpiryAlerts.$inferSelect;
export type InsertBondExpiryAlert = typeof bondExpiryAlerts.$inferInsert;

// ─── Post-Clearance Audit Schedule ───────────────────────────────────────────
export const postClearanceAuditSchedule = pgTable("post_clearance_audit_schedule", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull(),
  traderId: integer("trader_id").notNull(),
  scheduledBy: varchar("scheduled_by", { length: 64 }).notNull().default("system"),
  auditType: varchar("audit_type", { length: 32 }).notNull().default("random"),
  status: varchar("status", { length: 32 }).notNull().default("scheduled"),
  scheduledDate: timestamp("scheduled_date"),
  completedAt: timestamp("completed_at"),
  assignedOfficer: integer("assigned_officer"),
  findings: text("findings"),
  riskScore: integer("risk_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pcas_declaration").on(t.declarationId),
  index("idx_pcas_status").on(t.status),
  index("idx_pcas_scheduled_date").on(t.scheduledDate),
]);
export type PostClearanceAuditSchedule = typeof postClearanceAuditSchedule.$inferSelect;
export type InsertPostClearanceAuditSchedule = typeof postClearanceAuditSchedule.$inferInsert;

// ─── Sanctions Batch Jobs ─────────────────────────────────────────────────────
export const sanctionsBatchJobs = pgTable("sanctions_batch_jobs", {
  id: serial("id").primaryKey(),
  submittedBy: integer("submitted_by").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 512 }),
  totalRows: integer("total_rows").default(0),
  processedRows: integer("processed_rows").default(0),
  matchCount: integer("match_count").default(0),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  errorMessage: text("error_message"),
  resultFileUrl: text("result_file_url"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sanctions_batch_user").on(t.submittedBy),
  index("idx_sanctions_batch_status").on(t.status),
]);
export type SanctionsBatchJob = typeof sanctionsBatchJobs.$inferSelect;
export type InsertSanctionsBatchJob = typeof sanctionsBatchJobs.$inferInsert;

// ─── Risk Score Timeline ──────────────────────────────────────────────────────
export const declarationRiskHistory = pgTable("declaration_risk_history", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull(),
  riskScore: integer("risk_score").notNull(),
  riskLane: varchar("risk_lane", { length: 16 }),
  triggeredBy: varchar("triggered_by", { length: 64 }).notNull().default("system"),
  factors: json("factors"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("idx_drh_declaration").on(t.declarationId),
  index("idx_drh_recorded_at").on(t.recordedAt),
]);
export type DeclarationRiskHistory = typeof declarationRiskHistory.$inferSelect;
export type InsertDeclarationRiskHistory = typeof declarationRiskHistory.$inferInsert;

// ─── OGA Permit Bulk Actions ──────────────────────────────────────────────────
export const ogaBulkActions = pgTable("oga_bulk_actions", {
  id: serial("id").primaryKey(),
  performedBy: integer("performed_by").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  permitIds: json("permit_ids").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_oga_bulk_officer").on(t.performedBy),
]);
export type OgaBulkAction = typeof ogaBulkActions.$inferSelect;
export type InsertOgaBulkAction = typeof ogaBulkActions.$inferInsert;

// ─── AEO Renewal Documents ────────────────────────────────────────────────────
export const aeoRenewalDocuments = pgTable("aeo_renewal_documents", {
  id: serial("id").primaryKey(),
  renewalId: integer("renewal_id").notNull(),
  docType: varchar("doc_type", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  required: boolean("required").notNull().default(true),
  uploadedAt: timestamp("uploaded_at"),
  fileUrl: text("file_url"),
  fileKey: text("file_key"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ard_renewal").on(t.renewalId),
  index("idx_ard_status").on(t.status),
]);
export type AeoRenewalDocument = typeof aeoRenewalDocuments.$inferSelect;
export type InsertAeoRenewalDocument = typeof aeoRenewalDocuments.$inferInsert;

// ─── Export Schedule Deliveries ───────────────────────────────────────────────
export const exportScheduleDeliveries = pgTable("export_schedule_deliveries", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull(),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  rowCount: integer("row_count").notNull().default(0),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default("success"),
  errorMessage: text("error_message"),
  notificationId: integer("notification_id"),
}, (t) => [
  index("idx_esd_schedule").on(t.scheduleId),
  index("idx_esd_delivered_at").on(t.deliveredAt),
]);
export type ExportScheduleDelivery = typeof exportScheduleDeliveries.$inferSelect;
export type InsertExportScheduleDelivery = typeof exportScheduleDeliveries.$inferInsert;

// ─── Sanctions Batch Conflicts ────────────────────────────────────────────────
export const sanctionsBatchConflicts = pgTable("sanctions_batch_conflicts", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  rowIndex: integer("row_index").notNull(),
  entityName: varchar("entity_name", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }),
  existingId: integer("existing_id"),
  incomingData: json("incoming_data").notNull(),
  existingData: json("existing_data"),
  resolution: varchar("resolution", { length: 32 }),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sbc_batch").on(t.batchId),
  index("idx_sbc_resolution").on(t.resolution),
]);
export type SanctionsBatchConflict = typeof sanctionsBatchConflicts.$inferSelect;
export type InsertSanctionsBatchConflict = typeof sanctionsBatchConflicts.$inferInsert;

// ─── v138 Sprint Tables ───────────────────────────────────────────────────────

export const aeoRenewalComments = pgTable("aeo_renewal_comments", {
  id: serial("id").primaryKey(),
  renewalId: integer("renewal_id").notNull(),
  authorId: integer("author_id").notNull(),
  authorRole: varchar("author_role", { length: 20 }).notNull().default("user"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aeoDocumentVersions = pgTable("aeo_document_versions", {
  id: serial("id").primaryKey(),
  renewalDocId: integer("renewal_doc_id").notNull(),
  fileUrl: varchar("file_url", { length: 1024 }).notNull(),
  fileKey: varchar("file_key", { length: 512 }),
  uploadedBy: integer("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  notes: text("notes"),
});

export const checklistTemplates = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  docType: varchar("doc_type", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  required: boolean("required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  expiryDays: integer("expiry_days"),
  createdBy: integer("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const scheduleDeliveryStats = pgTable("schedule_delivery_stats", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull(),
  totalDeliveries: integer("total_deliveries").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  totalRowsExported: integer("total_rows_exported").notNull().default(0),
  totalBytesExported: bigint("total_bytes_exported", { mode: "number" }).notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export const scheduleDependencies = pgTable("schedule_dependencies", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull(),
  dependsOnScheduleId: integer("depends_on_schedule_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sanctionsEntities = pgTable("sanctions_entities", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id"),
  entityName: varchar("entity_name", { length: 512 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  country: varchar("country", { length: 100 }),
  riskScore: integer("risk_score").default(5),
  aliases: text("aliases"),
  metadata: json("metadata"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sanctionsWatchlistAlerts = pgTable("sanctions_watchlist_alerts", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull(),
  sanctionEntityId: integer("sanction_entity_id").notNull(),
  matchedField: varchar("matched_field", { length: 100 }).notNull(),
  matchedValue: varchar("matched_value", { length: 512 }).notNull(),
  riskScore: integer("risk_score").notNull().default(5),
  status: varchar("status", { length: 30 }).notNull().default("open"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const batchValidationErrors = pgTable("batch_validation_errors", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  rowIndex: integer("row_index").notNull(),
  field: varchar("field", { length: 100 }),
  errorCode: varchar("error_code", { length: 50 }).notNull(),
  errorMessage: text("error_message").notNull(),
  rawValue: text("raw_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── CORAZA WAF RULE OVERRIDES (Sprint Caddy) ─────────────────────────────────
// Stores per-rule enable/disable overrides for the Coraza WAF embedded in Caddy.
// The Caddy admin API reads this table via the /api/trpc/openAppSec.getCorazaRules
// endpoint and regenerates the Caddyfile SecRule directives on the fly.
export const corazaWafRules = pgTable("coraza_waf_rules", {
  id: serial("id").primaryKey(),
  ruleId: varchar("rule_id", { length: 32 }).notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  category: varchar("category", { length: 64 }).notNull().default("OWASP-CRS"),
  description: text("description"),
  // CRS metadata added by bulkImportRules
  crsVersion: varchar("crs_version", { length: 32 }),
  paranoiaLevel: integer("paranoia_level").default(1),
  tags: text("tags"),  // JSON array of CRS tag strings
  phase: integer("phase").default(2),
  action: varchar("action", { length: 16 }).default("block"),
  importedAt: timestamp("imported_at"),
  // Who last changed this rule and when
  disabledBy: integer("disabled_by").references(() => users.id, { onDelete: "set null" }),
  disabledAt: timestamp("disabled_at"),
  enabledBy: integer("enabled_by").references(() => users.id, { onDelete: "set null" }),
  enabledAt: timestamp("enabled_at"),
  // Reason for the override (required for audit trail)
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_coraza_rule_id").on(t.ruleId),
  index("idx_coraza_enabled").on(t.enabled),
  index("idx_coraza_severity").on(t.severity),
  index("idx_coraza_category").on(t.category),
]);

export type CorazaWafRule = typeof corazaWafRules.$inferSelect;
export type InsertCorazaWafRule = typeof corazaWafRules.$inferInsert;

// ─── System Heartbeat Jobs ────────────────────────────────────────────────────
// Tracks project-level (§4a) Heartbeat jobs created via the sandbox CLI or
// admin tRPC procedures. Stores the platform-issued taskUid so the job can be
// paused, resumed, or deleted without re-running the CLI.
export const systemHeartbeatJobs = pgTable("system_heartbeat_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  taskUid: varchar("task_uid", { length: 65 }).unique(),
  cronExpression: varchar("cron_expression", { length: 64 }).notNull(),
  callbackPath: varchar("callback_path", { length: 256 }).notNull(),
  description: varchar("description", { length: 512 }),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  lastExecutedAt: timestamp("last_executed_at"),
  nextExecutionAt: timestamp("next_execution_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SystemHeartbeatJob = typeof systemHeartbeatJobs.$inferSelect;
export type InsertSystemHeartbeatJob = typeof systemHeartbeatJobs.$inferInsert;

// ─── UCR — Unique Consignment Reference ──────────────────────────────────────
export const ucrs = pgTable("ucrs", {
  id: serial("id").primaryKey(),
  ucrNumber: varchar("ucr_number", { length: 64 }).notNull().unique(),
  traderId: integer("trader_id").notNull().references(() => users.id),
  ucrType: varchar("ucr_type", { length: 16 }).notNull().default("SINGLE"),
  consigneeRef: varchar("consignee_ref", { length: 128 }).notNull(),
  portOfEntry: varchar("port_of_entry", { length: 64 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  status: varchar("status", { length: 32 }).notNull().default("CREATED"),
  activatedAt: timestamp("activated_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ucrs_trader_id").on(t.traderId),
  index("idx_ucrs_status").on(t.status),
  index("idx_ucrs_declaration_id").on(t.declarationId),
]);
export type UCR = typeof ucrs.$inferSelect;
export type InsertUCR = typeof ucrs.$inferInsert;

// ─── Manifests ────────────────────────────────────────────────────────────────
export const manifests = pgTable("manifests", {
  id: serial("id").primaryKey(),
  manifestNumber: varchar("manifest_number", { length: 64 }).notNull().unique(),
  manifestType: varchar("manifest_type", { length: 8 }).notNull(),
  submittedBy: integer("submitted_by").notNull().references(() => users.id),
  vesselName: varchar("vessel_name", { length: 128 }).notNull(),
  voyageNumber: varchar("voyage_number", { length: 64 }).notNull(),
  mmsi: varchar("mmsi", { length: 16 }),
  imo: varchar("imo", { length: 16 }),
  portOfLoading: varchar("port_of_loading", { length: 64 }).notNull(),
  portOfDischarge: varchar("port_of_discharge", { length: 64 }).notNull(),
  eta: timestamp("eta"),
  ata: timestamp("ata"),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  totalBLs: integer("total_bls").default(0),
  acceptedAt: timestamp("accepted_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_manifests_submitted_by").on(t.submittedBy),
  index("idx_manifests_status").on(t.status),
  index("idx_manifests_type").on(t.manifestType),
  index("idx_manifests_port").on(t.portOfDischarge),
  index("idx_manifests_mmsi").on(t.mmsi),
  index("idx_manifests_imo").on(t.imo),
]);
export type Manifest = typeof manifests.$inferSelect;
export type InsertManifest = typeof manifests.$inferInsert;

// ─── Bills of Lading ─────────────────────────────────────────────────────────
export const billsOfLading = pgTable("bills_of_lading", {
  id: serial("id").primaryKey(),
  manifestId: integer("manifest_id").notNull().references(() => manifests.id),
  blNumber: varchar("bl_number", { length: 64 }).notNull(),
  shipper: varchar("shipper", { length: 256 }).notNull(),
  consignee: varchar("consignee", { length: 256 }).notNull(),
  notifyParty: varchar("notify_party", { length: 256 }),
  description: text("description").notNull(),
  hsCode: varchar("hs_code", { length: 16 }),
  weightKg: decimal("weight_kg", { precision: 12, scale: 2 }),
  numPackages: integer("num_packages"),
  containerNos: text("container_nos").array(),
  status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_bls_manifest_id").on(t.manifestId),
  index("idx_bls_bl_number").on(t.blNumber),
]);
export type BillOfLading = typeof billsOfLading.$inferSelect;
export type InsertBillOfLading = typeof billsOfLading.$inferInsert;

// ─── Valuation References ─────────────────────────────────────────────────────
export const valuationReferences = pgTable("valuation_references", {
  id: serial("id").primaryKey(),
  hsCode: varchar("hs_code", { length: 10 }).notNull(),
  description: text("description").notNull(),
  referencePrice: decimal("reference_price", { precision: 14, scale: 4 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  unit: varchar("unit", { length: 32 }).notNull().default("kg"),
  source: varchar("source", { length: 128 }).notNull().default("NCS"),
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validTo: timestamp("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_valuation_hs_code").on(t.hsCode),
]);
export type ValuationReference = typeof valuationReferences.$inferSelect;
export type InsertValuationReference = typeof valuationReferences.$inferInsert;

// ─── CRF Documents ────────────────────────────────────────────────────────────
export const crfDocuments = pgTable("crf_documents", {
  id: serial("id").primaryKey(),
  crfNumber: varchar("crf_number", { length: 64 }).notNull().unique(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  ucrNumber: varchar("ucr_number", { length: 64 }),
  traderId: integer("trader_id").notNull().references(() => users.id),
  reportingPeriod: varchar("reporting_period", { length: 16 }).notNull(),
  hsCode: varchar("hs_code", { length: 16 }),
  declaredValue: decimal("declared_value", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  countryOfOrigin: varchar("country_of_origin", { length: 2 }),
  portOfEntry: varchar("port_of_entry", { length: 64 }),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  acceptedAt: timestamp("accepted_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_crf_trader_id").on(t.traderId),
  index("idx_crf_status").on(t.status),
  index("idx_crf_period").on(t.reportingPeriod),
]);
export type CRFDocument = typeof crfDocuments.$inferSelect;
export type InsertCRFDocument = typeof crfDocuments.$inferInsert;

// ─── Mojaloop Payments (Go service) ──────────────────────────────────────────
export const mojaloopPayments = pgTable("mojaloop_payments", {
  id: serial("id").primaryKey(),
  paymentRef: varchar("payment_ref", { length: 64 }).notNull().unique(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  paymentType: varchar("payment_type", { length: 32 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  payerFsp: varchar("payer_fsp", { length: 64 }).notNull(),
  quoteId: varchar("quote_id", { length: 64 }),
  transferId: varchar("transfer_id", { length: 64 }),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_mj_payments_trader").on(t.traderId),
  index("idx_mj_payments_status").on(t.status),
  index("idx_mj_payments_declaration").on(t.declarationId),
]);
export type MojaloopPayment = typeof mojaloopPayments.$inferSelect;
export type InsertMojaloopPayment = typeof mojaloopPayments.$inferInsert;

// ─── LPCO Records ─────────────────────────────────────────────────────────────
export const lpcoRecords = pgTable("lpco_records", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  lpcoType: varchar("lpco_type", { length: 64 }).notNull(),
  mda: varchar("mda", { length: 32 }).notNull(),
  referenceNumber: varchar("reference_number", { length: 128 }).notNull(),
  issueDate: timestamp("issue_date"),
  expiryDate: timestamp("expiry_date"),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  validationStatus: varchar("validation_status", { length: 32 }).default("UNVALIDATED"),
  validationMessage: text("validation_message"),
  validatedAt: timestamp("validated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_lpco_declaration_id").on(t.declarationId),
  index("idx_lpco_trader_id").on(t.traderId),
  index("idx_lpco_mda").on(t.mda),
  index("idx_lpco_expiry").on(t.expiryDate),
]);
export type LPCORecord = typeof lpcoRecords.$inferSelect;
export type InsertLPCORecord = typeof lpcoRecords.$inferInsert;

// ─── EXCISE LICENSING AND DIGITAL TAX STAMPS ─────────────────────────────────

export const exciseLicenseeTypeEnum = pgEnum("excise_licensee_type", [
  "manufacturer", "importer", "distributor", "retailer",
]);
export const exciseLicenseStatusEnum = pgEnum("excise_license_status", [
  "pending", "active", "suspended", "expired", "revoked",
]);
export const exciseApprovalStatusEnum = pgEnum("excise_approval_status", [
  "pending", "approved", "rejected",
]);
export const exciseSchemeTypeEnum = pgEnum("excise_scheme_type", [
  "specific", "ad_valorem", "hybrid",
]);
export const exciseOrderStatusEnum = pgEnum("excise_order_status", [
  "ordered", "assessed", "payment", "fulfilment", "delivery", "cancelled",
]);
export const exciseMarkStatusEnum = pgEnum("excise_mark_status", [
  "issued", "active", "retired",
]);
export const exciseRetirementReasonEnum = pgEnum("excise_retirement_reason", [
  "wastage", "spoilage", "destruction", "seizure", "other",
]);
export const exciseAggregateTypeEnum = pgEnum("excise_aggregate_type", [
  "carton", "case", "pallet",
]);
export const exciseMovementTypeEnum = pgEnum("excise_movement_type", [
  "dispatch", "receipt", "export", "re_entry", "seizure", "destruction",
  "disaggregation",
]);
export const exciseScanSourceEnum = pgEnum("excise_scan_source", [
  "public", "enforcement",
]);

export const exciseLicences = pgTable("excise_licences", {
  id: serial("id").primaryKey(),
  licenseNumber: varchar("license_number", { length: 128 }).notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  licenseeType: exciseLicenseeTypeEnum("licensee_type").notNull(),
  economicOperatorId: varchar("economic_operator_id", { length: 64 }).notNull().unique(),
  productCategories: json("product_categories").$type<string[]>().notNull(),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  status: exciseLicenseStatusEnum("status").default("pending").notNull(),
  suspendedBy: integer("suspended_by").references(() => users.id),
  suspendedAt: timestamp("suspended_at"),
  suspensionReason: text("suspension_reason"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  revokedBy: integer("revoked_by").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_licence_user").on(t.userId),
  index("idx_excise_licence_status").on(t.status),
  index("idx_excise_licence_validity").on(t.validFrom, t.validUntil),
]);
export type ExciseLicence = typeof exciseLicences.$inferSelect;
export type InsertExciseLicence = typeof exciseLicences.$inferInsert;

export const exciseLicenceSuspensions = pgTable("excise_licence_suspensions", {
  id: serial("id").primaryKey(),
  licenceId: integer("licence_id").notNull().references(() => exciseLicences.id),
  suspendedBy: integer("suspended_by").notNull().references(() => users.id),
  suspendedAt: timestamp("suspended_at").defaultNow().notNull(),
  reason: text("reason").notNull(),
  liftedAt: timestamp("lifted_at"),
  liftedBy: integer("lifted_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_suspension_licence").on(t.licenceId),
]);

export const exciseFacilities = pgTable("excise_facilities", {
  id: serial("id").primaryKey(),
  licenceId: integer("licence_id").notNull().references(() => exciseLicences.id),
  facilityIdentifier: varchar("facility_identifier", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_facility_licence").on(t.licenceId),
]);
export type ExciseFacility = typeof exciseFacilities.$inferSelect;

export const exciseMarkingMachines = pgTable("excise_marking_machines", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => exciseFacilities.id),
  machineIdentifier: varchar("machine_identifier", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_machine_facility").on(t.facilityId),
]);
export type ExciseMarkingMachine = typeof exciseMarkingMachines.$inferSelect;

export const exciseTaxSchemes = pgTable("excise_tax_schemes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  schemeType: exciseSchemeTypeEnum("scheme_type").notNull(),
  specificAmount: decimal("specific_amount", { precision: 15, scale: 6 }),
  specificUnitOfMeasure: varchar("specific_unit_of_measure", { length: 32 }),
  adValoremRate: decimal("ad_valorem_rate", { precision: 9, scale: 6 }),
  hybridWhicheverGreater: boolean("hybrid_whichever_greater").default(false).notNull(),
  currency: varchar("currency", { length: 3 }),
  active: boolean("active").default(true).notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ExciseTaxScheme = typeof exciseTaxSchemes.$inferSelect;

export const exciseProducts = pgTable("excise_products", {
  id: serial("id").primaryKey(),
  licenceId: integer("licence_id").notNull().references(() => exciseLicences.id),
  sku: varchar("sku", { length: 128 }).notNull().unique(),
  brand: varchar("brand", { length: 255 }).notNull(),
  packSize: integer("pack_size").notNull(),
  unitContent: decimal("unit_content", { precision: 15, scale: 6 }).notNull(),
  unitOfMeasure: varchar("unit_of_measure", { length: 32 }).notNull(),
  strength: decimal("strength", { precision: 15, scale: 6 }),
  schemeId: integer("scheme_id").notNull().references(() => exciseTaxSchemes.id),
  approvalStatus: exciseApprovalStatusEnum("approval_status").default("pending").notNull(),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_product_licence").on(t.licenceId),
  index("idx_excise_product_status").on(t.approvalStatus),
]);
export type ExciseProduct = typeof exciseProducts.$inferSelect;

export const exciseStampOrders = pgTable("excise_stamp_orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("order_number", { length: 64 }).notNull().unique(),
  licenceId: integer("licence_id").notNull().references(() => exciseLicences.id),
  productId: integer("product_id").notNull().references(() => exciseProducts.id),
  facilityId: integer("facility_id").notNull().references(() => exciseFacilities.id),
  declarationId: integer("declaration_id").references(() => declarations.id),
  quantity: integer("quantity").notNull(),
  declaredValue: decimal("declared_value", { precision: 15, scale: 2 }),
  liability: decimal("liability", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: exciseOrderStatusEnum("status").default("ordered").notNull(),
  paymentIdempotencyKey: varchar("payment_idempotency_key", { length: 128 }).unique(),
  ledgerTransferId: varchar("ledger_transfer_id", { length: 128 }),
  assessedAt: timestamp("assessed_at"),
  paidAt: timestamp("paid_at"),
  fulfilledAt: timestamp("fulfilled_at"),
  deliveredAt: timestamp("delivered_at"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_order_licence").on(t.licenceId),
  index("idx_excise_order_declaration").on(t.declarationId),
  index("idx_excise_order_status").on(t.status),
]);
export type ExciseStampOrder = typeof exciseStampOrders.$inferSelect;

export const exciseStampMarks = pgTable("excise_stamp_marks", {
  id: serial("id").primaryKey(),
  uid: varchar("uid", { length: 192 }).notNull().unique(),
  payload: varchar("payload", { length: 128 }).notNull(),
  signature: varchar("signature", { length: 64 }).notNull(),
  keyId: varchar("key_id", { length: 32 }).notNull(),
  orderId: integer("order_id").notNull().references(() => exciseStampOrders.id),
  productId: integer("product_id").notNull().references(() => exciseProducts.id),
  facilityId: integer("facility_id").notNull().references(() => exciseFacilities.id),
  machineId: integer("machine_id").references(() => exciseMarkingMachines.id),
  status: exciseMarkStatusEnum("status").default("issued").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  activatedAt: timestamp("activated_at"),
  retiredAt: timestamp("retired_at"),
  retirementReason: exciseRetirementReasonEnum("retirement_reason"),
  retirementDetails: text("retirement_details"),
}, (t) => [
  index("idx_excise_mark_order").on(t.orderId),
  index("idx_excise_mark_status").on(t.status),
]);
export type ExciseStampMark = typeof exciseStampMarks.$inferSelect;

export const exciseMarkActivations = pgTable("excise_mark_activations", {
  id: serial("id").primaryKey(),
  markId: integer("mark_id").notNull().unique().references(() => exciseStampMarks.id),
  activatedBy: integer("activated_by").notNull().references(() => users.id),
  activatedAt: timestamp("activated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exciseProductionReports = pgTable("excise_production_reports", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => exciseStampOrders.id),
  productId: integer("product_id").notNull().references(() => exciseProducts.id),
  facilityId: integer("facility_id").notNull().references(() => exciseFacilities.id),
  quantity: integer("quantity").notNull(),
  reportedBy: integer("reported_by").notNull().references(() => users.id),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exciseRetirements = pgTable("excise_retirements", {
  id: serial("id").primaryKey(),
  markId: integer("mark_id").notNull().references(() => exciseStampMarks.id),
  reason: exciseRetirementReasonEnum("reason").notNull(),
  details: text("details"),
  retiredBy: integer("retired_by").notNull().references(() => users.id),
  retiredAt: timestamp("retired_at").defaultNow().notNull(),
});

export const exciseAggregates = pgTable("excise_aggregates", {
  id: serial("id").primaryKey(),
  aggregateUid: varchar("aggregate_uid", { length: 192 }).notNull().unique(),
  aggregateType: exciseAggregateTypeEnum("aggregate_type").notNull(),
  licenceId: integer("licence_id").notNull().references(() => exciseLicences.id),
  parentAggregateId: integer("parent_aggregate_id"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exciseAggregateChildren = pgTable("excise_aggregate_children", {
  id: serial("id").primaryKey(),
  aggregateId: integer("aggregate_id").notNull().references(() => exciseAggregates.id),
  childMarkId: integer("child_mark_id").references(() => exciseStampMarks.id),
  childAggregateId: integer("child_aggregate_id").references(() => exciseAggregates.id),
  addedBy: integer("added_by").notNull().references(() => users.id),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  removedBy: integer("removed_by").references(() => users.id),
  removedAt: timestamp("removed_at"),
}, (t) => [
  uniqueIndex("uq_excise_active_child_mark").on(t.childMarkId).where(sql`${t.removedAt} IS NULL`),
  uniqueIndex("uq_excise_active_child_aggregate").on(t.childAggregateId).where(sql`${t.removedAt} IS NULL`),
  index("idx_excise_children_aggregate").on(t.aggregateId),
  check("ck_excise_aggregate_child_exactly_one", sql`(child_mark_id IS NOT NULL) <> (child_aggregate_id IS NOT NULL)`),
]);

export const exciseMovementEvents = pgTable("excise_movement_events", {
  id: serial("id").primaryKey(),
  markId: integer("mark_id").references(() => exciseStampMarks.id),
  aggregateId: integer("aggregate_id").references(() => exciseAggregates.id),
  eventType: exciseMovementTypeEnum("event_type").notNull(),
  actorId: integer("actor_id").notNull().references(() => users.id),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_movement_mark").on(t.markId),
  index("idx_excise_movement_aggregate").on(t.aggregateId),
  index("idx_excise_movement_time").on(t.occurredAt),
  check("ck_excise_movement_subject_exactly_one", sql`(mark_id IS NOT NULL) <> (aggregate_id IS NOT NULL)`),
]);

export const exciseScans = pgTable("excise_scans", {
  id: serial("id").primaryKey(),
  uid: varchar("uid", { length: 192 }).notNull(),
  markId: integer("mark_id").references(() => exciseStampMarks.id),
  source: exciseScanSourceEnum("source").notNull(),
  scannedBy: integer("scanned_by").references(() => users.id),
  localityHash: varchar("locality_hash", { length: 128 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  scannedAt: timestamp("scanned_at").defaultNow().notNull(),
  previousScanId: integer("previous_scan_id"),
  impliedSpeedKmh: decimal("implied_speed_kmh", { precision: 12, scale: 2 }),
  impossibleTravel: boolean("impossible_travel").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_excise_scan_uid").on(t.uid),
  index("idx_excise_scan_mark").on(t.markId),
  index("idx_excise_scan_time").on(t.scannedAt),
]);

export const exciseSeizures = pgTable("excise_seizures", {
  id: serial("id").primaryKey(),
  markId: integer("mark_id").notNull().references(() => exciseStampMarks.id),
  seizedBy: integer("seized_by").notNull().references(() => users.id),
  location: text("location"),
  reason: text("reason").notNull(),
  seizedAt: timestamp("seized_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exciseReconciliationReports = pgTable("excise_reconciliation_reports", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => exciseStampOrders.id),
  issuedQuantity: integer("issued_quantity").notNull(),
  activatedQuantity: integer("activated_quantity").notNull(),
  everActivatedQuantity: integer("ever_activated_quantity").default(0).notNull(),
  retiredQuantity: integer("retired_quantity").notNull(),
  stillIssuedQuantity: integer("still_issued_quantity").notNull(),
  reportedProductionQuantity: integer("reported_production_quantity").notNull(),
  stampVariance: integer("stamp_variance").notNull(),
  productionVariance: integer("production_variance").notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  computedBy: integer("computed_by").notNull().references(() => users.id),
});

export const exciseAnomalies = pgTable("excise_anomalies", {
  id: serial("id").primaryKey(),
  markId: integer("mark_id").references(() => exciseStampMarks.id),
  orderId: integer("order_id").references(() => exciseStampOrders.id),
  anomalyType: varchar("anomaly_type", { length: 64 }).notNull(),
  details: json("details"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});
