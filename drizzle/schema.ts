import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  decimal,
  json,
  boolean,
  date,
  pgEnum,
  index,
  uniqueIndex,
  unique,
  bigint,
  real,
  uuid,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 */
export const roleEnum = pgEnum("role", ["user", "admin", "customs_officer", "inspector", "finance", "oga_officer", "security"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  company: varchar("company", { length: 255 }),
  country: varchar("country", { length: 2 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
  mfaSecret: varchar("mfa_secret", { length: 255 }),
  failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"),
  refreshTokenVersion: integer("refresh_token_version").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Trader profiles (KYC-lite)
 */
export const traderProfiles = pgTable("trader_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  tin: varchar("tin", { length: 64 }).notNull().unique(),
  licenseNumber: varchar("license_number", { length: 128 }),
  country: varchar("country", { length: 2 }).notNull(),
  address: text("address"),
  contactEmail: varchar("contact_email", { length: 320 }),
  contactPhone: varchar("contact_phone", { length: 32 }),
  aeoStatus: varchar("aeo_status", { length: 32 }).default("none"),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  kycVerifiedAt: timestamp("kyc_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TraderProfile = typeof traderProfiles.$inferSelect;
export type InsertTraderProfile = typeof traderProfiles.$inferInsert;

/**
 * Declarations
 */
export const declarationTypeEnum = pgEnum("declaration_type", ["import", "export", "transit", "re_export"]);
export const declarationStatusEnum = pgEnum("declaration_status", [
  "draft", "submitted", "under_assessment", "docs_required", "payment_pending",
  "under_examination", "examination_complete", "cleared", "rejected", "cancelled"
]);
export const riskLaneEnum = pgEnum("risk_lane", ["green", "yellow", "red", "blue"]);

export const declarations = pgTable("declarations", {
  id: serial("id").primaryKey(),
  declarationNumber: varchar("declaration_number", { length: 64 }).notNull().unique(),
  ucr: varchar("ucr", { length: 64 }).unique(),
  traderId: integer("trader_id").notNull().references(() => users.id),
  declarationType: declarationTypeEnum("declaration_type").notNull(),
  status: declarationStatusEnum("status").default("draft").notNull(),
  riskLane: riskLaneEnum("risk_lane"),
  riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
  hsCode: varchar("hs_code", { length: 12 }),
  goodsDescription: text("goods_description"),
  countryOfOrigin: varchar("country_of_origin", { length: 2 }),
  countryOfDestination: varchar("country_of_destination", { length: 2 }),
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
  assignedOfficerId: integer("assigned_officer_id").references(() => users.id),
  aiExplanation: json("ai_explanation"),
  sanctionsFlags: json("sanctions_flags"),
  submittedAt: timestamp("submitted_at"),
  clearedAt: timestamp("cleared_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_declarations_trader").on(table.traderId),
  index("idx_declarations_status").on(table.status),
  index("idx_declarations_risk_lane").on(table.riskLane),
  index("idx_declarations_submitted").on(table.submittedAt),
  index("idx_declarations_hs_code").on(table.hsCode),
]);

export type Declaration = typeof declarations.$inferSelect;
export type InsertDeclaration = typeof declarations.$inferInsert;

/**
 * Tariff codes
 */
export const tariffCodes = pgTable("tariff_codes", {
  id: serial("id").primaryKey(),
  hsCode: varchar("hs_code", { length: 12 }).notNull().unique(),
  description: text("description").notNull(),
  chapter: varchar("chapter", { length: 2 }).notNull(),
  heading: varchar("heading", { length: 4 }).notNull(),
  subheading: varchar("subheading", { length: 6 }),
  dutyRate: decimal("duty_rate", { precision: 5, scale: 2 }).notNull(),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).default("15").notNull(),
  levyRate: decimal("levy_rate", { precision: 5, scale: 2 }).default("0").notNull(),
  ecowasRate: decimal("ecowas_rate", { precision: 5, scale: 2 }),
  isProhibited: boolean("is_prohibited").default(false).notNull(),
  requiresPermit: boolean("requires_permit").default(false).notNull(),
  permitAgency: varchar("permit_agency", { length: 128 }),
  unitOfMeasure: varchar("unit_of_measure", { length: 16 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TariffCode = typeof tariffCodes.$inferSelect;
export type InsertTariffCode = typeof tariffCodes.$inferInsert;

/**
 * Payments
 */
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "processing", "completed", "failed", "refunded"]);
export const paymentMethodEnum = pgEnum("payment_method", ["card", "bank_transfer", "mobile_money", "cash"]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentReference: varchar("payment_reference", { length: 64 }).notNull().unique(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  status: paymentStatusEnum("status").default("pending").notNull(),
  method: paymentMethodEnum("method"),
  gatewayReference: varchar("gateway_reference", { length: 255 }),
  gatewayResponse: json("gateway_response"),
  paidAt: timestamp("paid_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_payments_declaration").on(table.declarationId),
  index("idx_payments_trader").on(table.traderId),
  index("idx_payments_status").on(table.status),
]);

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Permits (OGA)
 */
export const permitStatusEnum = pgEnum("permit_status", ["requested", "approved", "rejected", "expired", "not_required"]);

export const ogaPermits = pgTable("oga_permits", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  agencyCode: varchar("agency_code", { length: 32 }).notNull(),
  agencyName: varchar("agency_name", { length: 128 }).notNull(),
  permitType: varchar("permit_type", { length: 64 }).notNull(),
  status: permitStatusEnum("status").default("requested").notNull(),
  permitNumber: varchar("permit_number", { length: 128 }),
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  rejectionReason: text("rejection_reason"),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_permits_declaration").on(table.declarationId),
  index("idx_permits_status").on(table.status),
]);

export type OgaPermit = typeof ogaPermits.$inferSelect;
export type InsertOgaPermit = typeof ogaPermits.$inferInsert;

/**
 * Inspections
 */
export const inspectionStatusEnum = pgEnum("inspection_status", ["scheduled", "in_progress", "completed", "cancelled"]);
export const inspectionOutcomeEnum = pgEnum("inspection_outcome", ["pass", "fail", "conditional"]);

export const inspections = pgTable("inspections", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  inspectorId: integer("inspector_id").references(() => users.id),
  scheduledAt: timestamp("scheduled_at").notNull(),
  location: varchar("location", { length: 255 }),
  status: inspectionStatusEnum("status").default("scheduled").notNull(),
  outcome: inspectionOutcomeEnum("outcome"),
  notes: text("notes"),
  findings: json("findings"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_inspections_declaration").on(table.declarationId),
  index("idx_inspections_inspector").on(table.inspectorId),
  index("idx_inspections_status").on(table.status),
]);

export type Inspection = typeof inspections.$inferSelect;
export type InsertInspection = typeof inspections.$inferInsert;

/**
 * Documents
 */
export const documentTypeEnum = pgEnum("document_type", [
  "invoice", "bill_of_lading", "packing_list", "certificate_of_origin", "permit", "other"
]);

export const declarationDocuments = pgTable("declaration_documents", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  documentType: documentTypeEnum("document_type").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 1024 }).notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: varchar("mime_type", { length: 128 }),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_documents_declaration").on(table.declarationId),
]);

export type DeclarationDocument = typeof declarationDocuments.$inferSelect;
export type InsertDeclarationDocument = typeof declarationDocuments.$inferInsert;

/**
 * Risk assessments
 */
export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  lane: riskLaneEnum("lane").notNull(),
  factors: json("factors"),
  explanation: text("explanation"),
  modelVersion: varchar("model_version", { length: 64 }),
  assessedBy: varchar("assessed_by", { length: 32 }).default("ai").notNull(),
  overriddenBy: integer("overridden_by").references(() => users.id),
  overriddenAt: timestamp("overridden_at"),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_risk_declaration").on(table.declarationId),
]);

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = typeof riskAssessments.$inferInsert;

/**
 * Sanction entities
 */
export const sanctionEntities = pgTable("sanction_entities", {
  id: serial("id").primaryKey(),
  entityName: varchar("entity_name", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 32 }),
  aliases: json("aliases"),
  listSource: varchar("list_source", { length: 64 }).notNull(),
  country: varchar("country", { length: 2 }),
  identifier: varchar("identifier", { length: 255 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SanctionEntity = typeof sanctionEntities.$inferSelect;
export type InsertSanctionEntity = typeof sanctionEntities.$inferInsert;

/**
 * Audit events
 */
export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  actorId: integer("actor_id"),
  actorType: varchar("actor_type", { length: 32 }),
  previousState: json("previous_state"),
  newState: json("new_state"),
  metadata: json("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_entity").on(table.entityType, table.entityId),
  index("idx_audit_actor").on(table.actorId),
  index("idx_audit_created").on(table.createdAt),
]);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;

/**
 * Notifications
 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "declaration_submitted", "declaration_cleared", "declaration_rejected",
  "document_required", "declaration_status_change",
  "payment_received", "payment_failed", "payment_success",
  "permit_approved", "permit_rejected",
  "inspection_scheduled", "inspection_completed",
  "system_alert", "trade_update"
]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  entityType: varchar("entity_type", { length: 64 }),
  entityId: integer("entity_id"),
  isRead: boolean("is_read").default(false).notNull(),
  sentEmail: boolean("sent_email").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
  index("idx_notifications_read").on(table.isRead),
]);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * User notifications (Notification Centre)
 */
export const userNotifications = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  declarationId: integer("declaration_id").references(() => declarations.id),
  paymentId: integer("payment_id"),
  isRead: boolean("is_read").default(false).notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_user_notifications_user").on(table.userId),
  index("idx_user_notifications_read").on(table.isRead),
]);

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;

/**
 * KYC verifications
 */
export const kycStatusEnum = pgEnum("kyc_status", ["PENDING", "IN_REVIEW", "APPROVED", "REJECTED"]);

export const kycVerifications = pgTable("kyc_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  documentType: varchar("document_type", { length: 64 }).notNull(),
  documentNumber: varchar("document_number", { length: 128 }).notNull(),
  documentUrl: varchar("document_url", { length: 1024 }),
  status: kycStatusEnum("status").default("PENDING").notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_kyc_user").on(table.userId),
  index("idx_kyc_status").on(table.status),
]);

export type KycVerification = typeof kycVerifications.$inferSelect;
export type InsertKycVerification = typeof kycVerifications.$inferInsert;

/**
 * Clearance certificates
 */
export const clearanceCertificates = pgTable("clearance_certificates", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  traderId: integer("trader_id").notNull().references(() => users.id),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: varchar("file_url", { length: 1024 }).notNull(),
  declarationRef: varchar("declaration_ref", { length: 64 }).notNull(),
  goodsDescription: text("goods_description"),
  totalDutyPaid: varchar("total_duty_paid", { length: 32 }),
  currency: varchar("currency", { length: 3 }).default("USD"),
  clearedAt: timestamp("cleared_at").notNull(),
  generatedBy: integer("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_certs_declaration").on(table.declarationId),
  index("idx_certs_trader").on(table.traderId),
]);

export type ClearanceCertificate = typeof clearanceCertificates.$inferSelect;
export type InsertClearanceCertificate = typeof clearanceCertificates.$inferInsert;

/**
 * Bulk exports
 */
export const bulkExports = pgTable("bulk_exports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  declarationIds: json("declaration_ids").notNull(),
  declarationCount: integer("declaration_count").notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  s3Url: varchar("s3_url", { length: 1024 }).notNull(),
  s3Key: varchar("s3_key", { length: 512 }).notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  label: varchar("label", { length: 256 }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_bulk_exports_user").on(table.userId),
]);

export type BulkExport = typeof bulkExports.$inferSelect;
export type InsertBulkExport = typeof bulkExports.$inferInsert;

/**
 * Payment idempotency keys (migration 0028)
 */
export const paymentIdempotencyKeys = pgTable("payment_idempotency_keys", {
  id: serial("id").primaryKey(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: json("response_body"),
  lockedAt: timestamp("locked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_payment_idem_key").on(table.idempotencyKey),
  index("idx_payment_idem_user").on(table.userId),
]);

export type PaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferSelect;
export type InsertPaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferInsert;

/**
 * Tenants (multi-tenancy, Phase 11)
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 253 }),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

export const tenantUsers = pgTable("tenant_users", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tenant_users_tenant").on(table.tenantId),
  index("idx_tenant_users_user").on(table.userId),
  unique("tenant_users_tenant_user_unique").on(table.tenantId, table.userId),
]);

export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = typeof tenantUsers.$inferInsert;

/**
 * Stakeholder profiles (Phase 12 CRM)
 */
export const stakeholderProfiles = pgTable("stakeholder_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  organizationName: varchar("organization_name", { length: 255 }),
  stakeholderType: varchar("stakeholder_type", { length: 64 }),
  contactEmail: varchar("contact_email", { length: 320 }),
  contactPhone: varchar("contact_phone", { length: 32 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StakeholderProfile = typeof stakeholderProfiles.$inferSelect;
export type InsertStakeholderProfile = typeof stakeholderProfiles.$inferInsert;

/**
 * Temporal workflows
 */
export const temporalWorkflowStatusEnum = pgEnum("temporal_workflow_status", ["RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TERMINATED"]);

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

// ─── Domain Verification Events ───────────────────────────────────────────────
// Audit trail for each DNS TXT verification attempt. The history is retained
// independently of tenant status so operators can diagnose propagation failures.
export const domainVerificationOutcomeEnum = pgEnum("domain_verification_outcome", [
  "success",
  "failure",
  "error",
]);

export const domainVerificationEvents = pgTable("domain_verification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  domain: varchar("domain", { length: 253 }).notNull(),
  outcome: domainVerificationOutcomeEnum("outcome").notNull(),
  errorCode: varchar("error_code", { length: 64 }),
  detail: varchar("detail", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_dve_tenant_id").on(t.tenantId),
  index("idx_dve_domain").on(t.domain),
  index("idx_dve_created_at").on(t.createdAt),
  index("idx_dve_outcome").on(t.outcome),
]);

export type DomainVerificationEvent = typeof domainVerificationEvents.$inferSelect;
export type InsertDomainVerificationEvent = typeof domainVerificationEvents.$inferInsert;

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

// ─── Container OCR Reads (cv.container-code.v1 projection, WP-4) ────────────
// Signed gate-OCR container reads from blueeconomy-cv-service, projected for
// cargo/declaration cross-check. matchStatus:
//   matched      — code matches a declaration's vision-analysis container read
//   unmatched    — no declaration/vision record declares this container
//   invalid_code — ISO 6346 check digit invalid (per producer event)
export const containerOcrReads = pgTable("container_ocr_reads", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 128 }).notNull().unique(),
  cameraId: varchar("camera_id", { length: 64 }).notNull(),
  containerCode: varchar("container_code", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  checkDigitValid: boolean("check_digit_valid").notNull().default(false),
  modelVersion: varchar("model_version", { length: 128 }),
  matchStatus: varchar("match_status", { length: 16 }).notNull(),
  declarationId: integer("declaration_id").references(() => declarations.id),
  occurredAt: timestamp("occurred_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_cor_container_code").on(t.containerCode),
  index("idx_cor_match_status").on(t.matchStatus),
  index("idx_cor_declaration").on(t.declarationId),
]);
export type ContainerOcrRead = typeof containerOcrReads.$inferSelect;
export type InsertContainerOcrRead = typeof containerOcrReads.$inferInsert;

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

// ─── Phase-6 Remediation: Webhook Delivery Dedupe ────────────────────────────
// Records every inbound webhook delivery exactly once so replays can be
// acknowledged without re-applying side effects (see server/webhooks/dedupe.ts).
export const webhookReceipts = pgTable("webhook_receipts", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 32 }).notNull(),
  deliveryKey: varchar("delivery_key", { length: 255 }).notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => [
  unique("webhook_receipts_source_key_unique").on(t.source, t.deliveryKey),
  index("idx_webhook_receipts_source").on(t.source),
]);
export type WebhookReceipt = typeof webhookReceipts.$inferSelect;
export type InsertWebhookReceipt = typeof webhookReceipts.$inferInsert;

// ─── Phase-7 Remediation: Device Push Tokens ─────────────────────────────────
// Primary store for device push tokens (P0-5). The previous implementation
// kept tokens in a process-local Map and ran a MySQL-dialect upsert
// (ON DUPLICATE KEY UPDATE) against PostgreSQL that always threw and was
// swallowed. The DB is now the authoritative store with a PG-native upsert.
export const pushTokens = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull(), // ios | android | web
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, (t) => [
  unique("push_tokens_user_platform_unique").on(t.userId, t.platform),
  index("idx_push_tokens_user").on(t.userId),
]);
export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;

// ─── Phase-7 Remediation: Durable Payment Idempotency ────────────────────────
// P0-6: server/_core/security.ts now uses the EXISTING durable
// `payment_idempotency_keys` table (defined above, migration 0028) instead of
// a process-local Map. No new table was needed.

// ─── Phase-6 Remediation: 4-Eyes (Dual Control) Requests ─────────────────────
// Postgres-backed dual-control approvals for privileged mutations. Consume-on-use:
// a request can authorise exactly one execution of the action it approved.
export const fourEyesRequests = pgTable("four_eyes_requests", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  consumedAt: timestamp("consumed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_four_eyes_action_entity").on(t.action, t.entityType, t.entityId),
]);
export type FourEyesRequest = typeof fourEyesRequests.$inferSelect;
export type InsertFourEyesRequest = typeof fourEyesRequests.$inferInsert;

// ─── Phase-6 Remediation: Free-Zone Reconciliation Runs (SW-21) ──────────────
// Real persisted reconciliation runs — never simulated history.
export const freezoneReconciliationRuns = pgTable("freezone_reconciliation_runs", {
  id: serial("id").primaryKey(),
  zoneId: varchar("zone_id", { length: 64 }).notNull().default("all"),
  tolerancePct: real("tolerance_pct").notNull(),
  totalItems: integer("total_items").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  unmatched: integer("unmatched").notNull().default(0),
  surplus: integer("surplus").notNull().default(0),
  reconciliationRate: real("reconciliation_rate"),
  report: jsonb("report"),
  triggeredBy: integer("triggered_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_fz_recon_zone").on(t.zoneId),
  index("idx_fz_recon_created").on(t.createdAt),
]);
export type FreezoneReconciliationRun = typeof freezoneReconciliationRuns.$inferSelect;
export type InsertFreezoneReconciliationRun = typeof freezoneReconciliationRuns.$inferInsert;

// ─── Phase 8: PCS Trader Portal read models ──────────────────────────────────
// Thin read/projection layer over blueeconomy-port-interoperability (the
// system of record for port calls, bookings, slots, gate scans and billing).
// These tables are PROJECTIONS of ports.*.v1 Kafka events (envelope v1.0,
// EdDSA JWS provenance) — never a system of record. Every row traces to a
// source event id; unverified events are rejected, never projected.
export const pcsMilestoneEnum = pgEnum("pcs_milestone", [
  "pre_arrival", "arrived", "berthed", "ops_started", "discharging",
  "customs_hold", "customs_released", "gate_out", "departed"
]);

export const pcsConsignments = pgTable("pcs_consignments", {
  id: serial("id").primaryKey(),
  traderUserId: integer("trader_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  manifestId: integer("manifest_id").references(() => manifests.id, { onDelete: "set null" }),
  // Nullable: port-interop booking events do not carry B/L numbers; the
  // column is populated when a manifest association is established (spec §3
  // keys the read model by bl_number + manifest_id once both are known).
  blNumber: varchar("bl_number", { length: 64 }),
  containerNos: jsonb("container_nos").$type<string[]>().notNull().default([]),
  consignee: varchar("consignee", { length: 256 }),
  portCode: varchar("port_code", { length: 8 }),
  portCallId: varchar("port_call_id", { length: 256 }),
  declarationUrn: varchar("declaration_urn", { length: 128 }),
  lastMilestone: pcsMilestoneEnum("last_milestone"),
  lastMilestoneAt: timestamp("last_milestone_at"),
  sourceEventIds: jsonb("source_event_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pcs_consignments_trader").on(t.traderUserId),
  index("idx_pcs_consignments_bl").on(t.blNumber),
  index("idx_pcs_consignments_port_call").on(t.portCallId),
  unique("pcs_consignments_bl_manifest_unique").on(t.blNumber, t.manifestId),
]);
export type PcsConsignment = typeof pcsConsignments.$inferSelect;
export type InsertPcsConsignment = typeof pcsConsignments.$inferInsert;

// Append-only milestone projection; replay is idempotent via the
// (consignment_id, source_event_id) uniqueness constraint.
export const pcsMilestones = pgTable("pcs_milestones", {
  id: serial("id").primaryKey(),
  consignmentId: integer("consignment_id").notNull().references(() => pcsConsignments.id, { onDelete: "cascade" }),
  milestone: pcsMilestoneEnum("milestone").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  sourceTopic: varchar("source_topic", { length: 64 }).notNull(),
  sourceEventId: uuid("source_event_id").notNull(),
  provenanceSignatureVerified: boolean("provenance_signature_verified").notNull(),
}, (t) => [
  index("idx_pcs_milestones_consignment").on(t.consignmentId),
  unique("pcs_milestones_consignment_event_unique").on(t.consignmentId, t.sourceEventId),
]);
export type PcsMilestone = typeof pcsMilestones.$inferSelect;
export type InsertPcsMilestone = typeof pcsMilestones.$inferInsert;

export const pcsBookingLinks = pgTable("pcs_booking_links", {
  id: serial("id").primaryKey(),
  traderUserId: integer("trader_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bookingId: varchar("booking_id", { length: 128 }).notNull(),
  consignmentId: integer("consignment_id").references(() => pcsConsignments.id, { onDelete: "set null" }),
  createdVia: varchar("created_via", { length: 16 }).notNull(), // pcs | ussd | direct
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pcs_booking_links_trader").on(t.traderUserId),
  unique("pcs_booking_links_booking_unique").on(t.bookingId),
]);
export type PcsBookingLink = typeof pcsBookingLinks.$inferSelect;
export type InsertPcsBookingLink = typeof pcsBookingLinks.$inferInsert;

// Read-only ledger projection — NOT double-entry truth (billing truth stays in
// port-interop's TigerBeetle/Mojaloop). projectionLagMs labels every row so UI
// figures trace to their source event and staleness.
export const pcsBillingSnapshots = pgTable("pcs_billing_snapshots", {
  id: serial("id").primaryKey(),
  bookingId: varchar("booking_id", { length: 128 }).notNull(),
  invoiceId: varchar("invoice_id", { length: 128 }),
  amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  status: varchar("status", { length: 32 }).notNull(),
  receiptId: varchar("receipt_id", { length: 128 }),
  ledgerCommitHash: varchar("ledger_commit_hash", { length: 128 }),
  projectionLagMs: integer("projection_lag_ms"),
  sourceEventId: uuid("source_event_id").notNull().unique(),
  occurredAt: timestamp("occurred_at").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pcs_billing_booking").on(t.bookingId),
]);
export type PcsBillingSnapshot = typeof pcsBillingSnapshots.$inferSelect;
export type InsertPcsBillingSnapshot = typeof pcsBillingSnapshots.$inferInsert;

// ─── MARITIME SINGLE WINDOW (MSW / IMO FAL; Phase 9 WP-C) ────────────────────
// Producing boundary `blueeconomy-singlewindow-msw` for topic maritime.msw.v1.
// Contract: blueeconomy-contracts proto/blueeconomy/msw/v1/msw.proto + docs/msw.md
// (commit eb6b1ae — NORMATIVE). 11 event types; enum wire forms carry NO
// MSW_FORM_TYPE_/MSW_AGENCY_ prefixes; digests are "sha256:<64 lowercase hex>".
// Data minimization: form payloads / instruments / notes are retained HERE in
// the boundary (jsonb/text columns); events carry identifiers + digests only.
// Pratique-first (NPPM 2021) is enforced at the DB level where expressible
// (checks below) and at the service level (server/mswService.ts) for the
// temporal ordering rules (grant-before-schedule, no later refusal, maker-
// checker, version chain) that a static CHECK cannot express.

export const mswVisitStatusEnum = pgEnum("msw_visit_status", [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "CLEARED_TO_ENTER", "IN_PORT",
  "CLEARED_TO_DEPART", "DEPARTED", "CANCELLED",
]);
export const mswFormTypeEnum = pgEnum("msw_form_type", [
  "FAL1", "FAL2", "FAL3", "FAL4", "FAL5", "FAL6", "FAL7", "MDOH",
]);
export const mswAgencyEnum = pgEnum("msw_agency", [
  "PORT_HEALTH", "NIS", "NCS", "NDLEA", "NIMASA", "NPA",
]);
export const mswClearanceKindEnum = pgEnum("msw_clearance_kind", ["ARRIVAL", "DEPARTURE"]);
export const mswDeclarationStatusEnum = pgEnum("msw_declaration_status", [
  "SUBMITTED", "ACCEPTED", "RETURNED",
]);
export const mswPratiqueDecisionEnum = pgEnum("msw_pratique_decision", ["GRANTED", "REFUSED"]);
export const mswBoardingStatusEnum = pgEnum("msw_boarding_status", ["SCHEDULED", "COMPLETED"]);
export const mswClearanceDecisionEnum = pgEnum("msw_clearance_decision", ["GRANTED", "REFUSED"]);

export const mswVisits = pgTable("msw_visits", {
  id: serial("id").primaryKey(),
  // Service-assigned immutable identifier (mswv-000001 style) from a dedicated
  // sequence — never client-supplied.
  visitId: varchar("visit_id", { length: 32 }).notNull().unique(),
  // Port-call identifier owned by the port-interoperability boundary. NULL
  // when unlinked; port-call fields are NEVER duplicated here beyond the id.
  portCallId: varchar("port_call_id", { length: 256 }),
  // True ONLY when the vessel identity was verified against the port-call
  // record at creation time. False is the honest state for unlinked or
  // unverifiable visits (PORT_CALL_UNVERIFIED / PORT_CALL_UNAVAILABLE).
  portCallVerified: boolean("port_call_verified").notNull().default(false),
  vesselImoNumber: varchar("vessel_imo_number", { length: 7 }).notNull(),
  vesselName: varchar("vessel_name", { length: 256 }).notNull(),
  vesselFlagCode: varchar("vessel_flag_code", { length: 2 }).notNull(),
  portCode: varchar("port_code", { length: 5 }).notNull(),
  agentReference: varchar("agent_reference", { length: 128 }).notNull(),
  eta: timestamp("eta").notNull(),
  etd: timestamp("etd"),
  status: mswVisitStatusEnum("status").notNull().default("SUBMITTED"),
  declaredByUserId: integer("declared_by_user_id").notNull().references(() => users.id),
  declaredAt: timestamp("declared_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_msw_visits_port_call").on(t.portCallId),
  index("idx_msw_visits_vessel_imo").on(t.vesselImoNumber),
  index("idx_msw_visits_status").on(t.status),
]);
export type MswVisit = typeof mswVisits.$inferSelect;
export type InsertMswVisit = typeof mswVisits.$inferInsert;

export const mswAgentNominations = pgTable("msw_agent_nominations", {
  id: serial("id").primaryKey(),
  visitPk: integer("visit_pk").notNull().references(() => mswVisits.id, { onDelete: "cascade" }),
  agentReference: varchar("agent_reference", { length: 128 }).notNull(),
  // Digest of the nomination instrument; the instrument itself is retained in
  // the boundary (nomination_document), never emitted on the wire.
  nominationDocumentDigestSha256: varchar("nomination_document_digest_sha256", { length: 80 }).notNull(),
  nominationDocument: jsonb("nomination_document"),
  nominatedByUserId: integer("nominated_by_user_id").notNull().references(() => users.id),
  nominatedAt: timestamp("nominated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_msw_agent_nominations_visit").on(t.visitPk),
]);
export type MswAgentNomination = typeof mswAgentNominations.$inferSelect;
export type InsertMswAgentNomination = typeof mswAgentNominations.$inferInsert;

export const mswDeclarations = pgTable("msw_declarations", {
  id: serial("id").primaryKey(),
  // Service-assigned immutable identifier (mswd-000001 style).
  declarationId: varchar("declaration_id", { length: 32 }).notNull().unique(),
  visitPk: integer("visit_pk").notNull().references(() => mswVisits.id, { onDelete: "cascade" }),
  formType: mswFormTypeEnum("form_type").notNull(),
  // Monotonic per-(visit, form_type), starting at 1 (single-submission
  // principle, UNECE Rec-33): a re-submission is a NEW version chained to the
  // prior submission by digest; returned versions are never edited.
  version: integer("version").notNull(),
  formPayloadDigestSha256: varchar("form_payload_digest_sha256", { length: 80 }).notNull(),
  // Empty on version 1; otherwise the digest of the prior submission.
  priorSubmissionDigestSha256: varchar("prior_submission_digest_sha256", { length: 80 }).notNull().default(""),
  // NDPA PERSONAL category flag (FAL4/FAL5/FAL6/MDOH) — floors the envelope
  // at RESTRICTED on the wire.
  containsPersonalData: boolean("contains_personal_data").notNull(),
  // Schema-validated form payload retained INSIDE the producing boundary;
  // only its digest is emitted.
  formPayload: jsonb("form_payload").notNull(),
  status: mswDeclarationStatusEnum("status").notNull().default("SUBMITTED"),
  submittedByUserId: integer("submitted_by_user_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  // Review (maker-checker) fields — populated on accept/return.
  reviewingAgency: mswAgencyEnum("reviewing_agency"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  returnReasonCode: varchar("return_reason_code", { length: 64 }),
  reviewNote: text("review_note"),
  reviewNoteDigestSha256: varchar("review_note_digest_sha256", { length: 80 }),
  decidedAt: timestamp("decided_at"),
}, (t) => [
  index("idx_msw_declarations_visit").on(t.visitPk),
  index("idx_msw_declarations_form").on(t.visitPk, t.formType),
  unique("msw_declarations_visit_form_version_unique").on(t.visitPk, t.formType, t.version),
]);
export type MswDeclaration = typeof mswDeclarations.$inferSelect;
export type InsertMswDeclaration = typeof mswDeclarations.$inferInsert;

export const mswPratique = pgTable("msw_pratique", {
  id: serial("id").primaryKey(),
  visitPk: integer("visit_pk").notNull().references(() => mswVisits.id, { onDelete: "cascade" }),
  decision: mswPratiqueDecisionEnum("decision").notNull(),
  // Anchored to the Maritime Declaration of Health the decision is based on.
  healthDeclarationPk: integer("health_declaration_pk").notNull().references(() => mswDeclarations.id),
  officerReference: varchar("officer_reference", { length: 128 }).notNull(),
  refusalReasonCode: varchar("refusal_reason_code", { length: 64 }),
  // Digest of the decision record (grant or refusal) computed by the service;
  // boarding completions bind to the GRANT digest (pratique-first invariant).
  pratiqueRecordDigestSha256: varchar("pratique_record_digest_sha256", { length: 80 }).notNull(),
  decidedByUserId: integer("decided_by_user_id").notNull().references(() => users.id),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
}, (t) => [
  index("idx_msw_pratique_visit").on(t.visitPk),
]);
export type MswPratique = typeof mswPratique.$inferSelect;
export type InsertMswPratique = typeof mswPratique.$inferInsert;

export const mswBoardings = pgTable("msw_boardings", {
  id: serial("id").primaryKey(),
  // Service-assigned immutable identifier (mswb-000001 style).
  boardingId: varchar("boarding_id", { length: 32 }).notNull().unique(),
  visitPk: integer("visit_pk").notNull().references(() => mswVisits.id, { onDelete: "cascade" }),
  // Fail-closed agency set (wire enum values). DB CHECK below enforces the
  // pratique-first invariant at COMPLETION: a completed party containing any
  // non-Port-Health agency must carry the antecedent pratique grant digest.
  // The temporal scheduling rule (non-PH parties scheduled only after grant,
  // no later refusal) is service-enforced (server/mswService.ts).
  agencies: jsonb("agencies").$type<string[]>().notNull(),
  scheduledByAgency: mswAgencyEnum("scheduled_by_agency").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  scheduleNoteDigestSha256: varchar("schedule_note_digest_sha256", { length: 80 }).notNull().default(""),
  status: mswBoardingStatusEnum("status").notNull().default("SCHEDULED"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  pratiqueGrantDigestSha256: varchar("pratique_grant_digest_sha256", { length: 80 }).notNull().default(""),
  outcomeDigestSha256: varchar("outcome_digest_sha256", { length: 80 }),
}, (t) => [
  index("idx_msw_boardings_visit").on(t.visitPk),
]);
export type MswBoarding = typeof mswBoardings.$inferSelect;
export type InsertMswBoarding = typeof mswBoardings.$inferInsert;

export const mswClearances = pgTable("msw_clearances", {
  id: serial("id").primaryKey(),
  // Service-assigned immutable identifier (mswc-000001 style).
  clearanceId: varchar("clearance_id", { length: 32 }).notNull().unique(),
  visitPk: integer("visit_pk").notNull().references(() => mswVisits.id, { onDelete: "cascade" }),
  kind: mswClearanceKindEnum("kind").notNull(),
  decision: mswClearanceDecisionEnum("decision").notNull(),
  decidedByAgency: mswAgencyEnum("decided_by_agency").notNull(),
  refusalReasonCode: varchar("refusal_reason_code", { length: 64 }),
  // Digest of the evaluated precondition checklist. Mandatory for a DEPARTURE
  // grant (DB CHECK below); the checklist content is computed by the service
  // (all submitted form versions accepted + pratique granted + joint boarding
  // completed — service-enforced temporal preconditions).
  preconditionChecklistDigestSha256: varchar("precondition_checklist_digest_sha256", { length: 80 }).notNull().default(""),
  conditionsDigestSha256: varchar("conditions_digest_sha256", { length: 80 }).notNull().default(""),
  refusalRecordDigestSha256: varchar("refusal_record_digest_sha256", { length: 80 }).notNull().default(""),
  decidedByUserId: integer("decided_by_user_id").notNull().references(() => users.id),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
}, (t) => [
  index("idx_msw_clearances_visit").on(t.visitPk),
]);
export type MswClearance = typeof mswClearances.$inferSelect;
export type InsertMswClearance = typeof mswClearances.$inferInsert;
// ─── Trade-Finance Consent Evidence (WP-6) ─────────────────────────────────
// Local digest-evidence mirror of consent lifecycle events executed against
// the financial-controls trade-finance rail. Rows carry only digests and
// tokenized references — never raw datasets.
export const tradeFinanceConsentEvidence = pgTable("trade_finance_consent_evidence", {
  id: serial("id").primaryKey(),
  consentId: varchar("consent_id", { length: 128 }).notNull(),
  traderUserId: integer("trader_user_id").notNull().references(() => users.id),
  traderRef: varchar("trader_ref", { length: 256 }).notNull(),
  bankId: varchar("bank_id", { length: 128 }).notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  envelopeDigestSha256: varchar("envelope_digest_sha256", { length: 128 }).notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tfce_trader_user_id").on(t.traderUserId),
  index("idx_tfce_consent_id").on(t.consentId),
]);
export type TradeFinanceConsentEvidence = typeof tradeFinanceConsentEvidence.$inferSelect;
export type InsertTradeFinanceConsentEvidence = typeof tradeFinanceConsentEvidence.$inferInsert;

// ─── Phase 10 WP-3: cross-border MSW exchange foreign drafts ─────────────────
// Inbound IMO Compendium messages (mswExchange.ts ingest) persist as DRAFTS
// here — provenance-stamped, never auto-accepted; they must traverse the
// platform's own submission/maker-checker lifecycle before any agency use.
export const mswForeignDraftStatusEnum = pgEnum("msw_foreign_draft_status", ["DRAFT", "ADMITTED", "REJECTED"]);

export const mswForeignDrafts = pgTable("msw_foreign_drafts", {
  id: serial("id").primaryKey(),
  // Service-assigned immutable identifier (mswfd-<uuid fragment>).
  draftId: varchar("draft_id", { length: 40 }).notNull().unique(),
  formType: mswFormTypeEnum("form_type").notNull(),
  // Provenance stamp (docs/imo-wco-conformance.md §5).
  foreignSender: varchar("foreign_sender", { length: 128 }).notNull(),
  sourceMessageId: varchar("source_message_id", { length: 128 }).notNull(),
  envelopeEventId: varchar("envelope_event_id", { length: 80 }).notNull(),
  // JCS-canonical sha256 digest of the inbound IMO payload (integrity anchor).
  envelopeDigestSha256: varchar("envelope_digest_sha256", { length: 80 }).notNull(),
  // Reverse-mapped platform payload incl. embedded provenance block.
  formPayload: jsonb("form_payload").notNull(),
  // NDPA PERSONAL category flag (FAL4/FAL5/FAL6/MDOH) — floors at RESTRICTED.
  containsPersonalData: boolean("contains_personal_data").notNull(),
  status: mswForeignDraftStatusEnum("status").notNull().default("DRAFT"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => [
  index("idx_msw_foreign_drafts_sender").on(t.foreignSender),
  unique("msw_foreign_drafts_message_unique").on(t.foreignSender, t.sourceMessageId),
]);
export type MswForeignDraft = typeof mswForeignDrafts.$inferSelect;
export type InsertMswForeignDraft = typeof mswForeignDrafts.$inferInsert;

// ─── Phase 12 — Stakeholder-360 CRM: case/ticket workflow (migration 0065) ──
// State machine enforced app-level (server/crm/cases.ts):
//   open → triaged → in_progress → resolved → closed
// Dispute-type cases require maker-checker resolution approval before close.
export const crmCases = pgTable("crm_cases", {
  id: serial("id").primaryKey(),
  caseNumber: varchar("case_number", { length: 24 }).notNull().unique(),
  subject: varchar("subject", { length: 240 }).notNull(),
  description: text("description"),
  caseType: varchar("case_type", { length: 32 }).default("general").notNull(), // general | declaration | payment | verification | dispute
  priority: varchar("priority", { length: 16 }).default("medium").notNull(),   // low | medium | high | critical
  status: varchar("status", { length: 20 }).default("open").notNull(),         // open | triaged | in_progress | resolved | closed
  stakeholderProfileId: integer("stakeholder_profile_id").references(() => stakeholderProfiles.id),
  declarationId: integer("declaration_id").references(() => declarations.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  createdBy: integer("created_by").notNull().references(() => users.id),
  assignedTo: integer("assigned_to").references(() => users.id),
  resolutionSummary: text("resolution_summary"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionApprovedBy: integer("resolution_approved_by").references(() => users.id),
  resolutionApprovedAt: timestamp("resolution_approved_at"),
  slaTriageDue: timestamp("sla_triage_due"),
  slaResolutionDue: timestamp("sla_resolution_due"),
  triagedAt: timestamp("triaged_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_crm_cases_status").on(t.status),
  index("idx_crm_cases_stakeholder").on(t.stakeholderProfileId),
  index("idx_crm_cases_assigned").on(t.assignedTo),
  index("idx_crm_cases_tenant").on(t.tenantId),
  index("idx_crm_cases_created_by").on(t.createdBy),
  index("idx_crm_cases_created_at").on(t.createdAt),
]);
export type CrmCase = typeof crmCases.$inferSelect;
export type InsertCrmCase = typeof crmCases.$inferInsert;

export const crmCaseEvents = pgTable("crm_case_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => crmCases.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 40 }).notNull(), // created | assigned | transition | resolution | resolution_approved | closed | note
  fromStatus: varchar("from_status", { length: 20 }),
  toStatus: varchar("to_status", { length: 20 }),
  actorId: integer("actor_id").notNull().references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_crm_case_events_case").on(t.caseId)]);
export type CrmCaseEvent = typeof crmCaseEvents.$inferSelect;

// ─── Phase 12 — Marketplace monetization tiers (migration 0066) ─────────────
export const marketplaceTiers = pgTable("marketplace_tiers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(), // free | builder | enterprise
  name: varchar("name", { length: 80 }).notNull(),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull(),
  monthlyCallQuota: integer("monthly_call_quota"),           // NULL = unmetered
  pricePerCallUsd: decimal("price_per_call_usd", { precision: 10, scale: 6 }).default("0").notNull(),
  monthlyFeeUsd: decimal("monthly_fee_usd", { precision: 10, scale: 2 }).default("0").notNull(),
  features: json("features"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MarketplaceTier = typeof marketplaceTiers.$inferSelect;

// ─── Phase 16 — Transshipment declaration lane (migration 0069) ─────────────

export const bondedTransferStatusEnum = pgEnum("bonded_transfer_status", [
  "initiated", "in_transit", "arrived_bond", "under_supervision",
  "released", "completed", "cancelled",
]);

/**
 * A transshipment declaration couples ONE inbound and ONE outbound manifest.
 * Validation invariant (enforced in server/routers/transshipment.ts): the
 * inbound manifest's port of discharge must equal the outbound manifest's
 * port of loading — the transshipment port.
 */
export const transshipmentLinks = pgTable("transshipment_links", {
  id: serial("id").primaryKey(),
  declarationId: integer("declaration_id").notNull().unique().references(() => declarations.id),
  inboundManifestId: integer("inbound_manifest_id").notNull().references(() => manifests.id),
  outboundManifestId: integer("outbound_manifest_id").notNull().references(() => manifests.id),
  transshipmentPort: varchar("transshipment_port", { length: 64 }).notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_tsl_inbound_manifest").on(t.inboundManifestId),
  index("idx_tsl_outbound_manifest").on(t.outboundManifestId),
]);
export type TransshipmentLink = typeof transshipmentLinks.$inferSelect;
export type InsertTransshipmentLink = typeof transshipmentLinks.$inferInsert;

/**
 * Append-only bonded transfer tracking: every status transition is a new row
 * (audit trail; never an in-place update).
 */
export const bondedTransfers = pgTable("bonded_transfers", {
  id: serial("id").primaryKey(),
  transshipmentLinkId: integer("transshipment_link_id").notNull().references(() => transshipmentLinks.id),
  fromStatus: bondedTransferStatusEnum("from_status"),
  toStatus: bondedTransferStatusEnum("to_status").notNull(),
  actorId: integer("actor_id").notNull().references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_btr_link").on(t.transshipmentLinkId)]);
export type BondedTransfer = typeof bondedTransfers.$inferSelect;
export type InsertBondedTransfer = typeof bondedTransfers.$inferInsert;

/**
 * Phase 19 (F1/M2): RL queue-policy suggestion EPISODE. Every served shadow
 * suggestion is persisted (policy version, candidate ids, feature snapshot,
 * both orders, served_at) so offline-RL reward joins can attribute a decision
 * to the exact episode and replay the state the policy saw.
 */
export const queuePolicySuggestions = pgTable("queue_policy_suggestions", {
  id: serial("id").primaryKey(),
  policyVersion: varchar("policy_version", { length: 64 }).notNull(),
  /** Declaration ids the policy scored, in request order. */
  candidateIds: json("candidate_ids").notNull().$type<number[]>(),
  /** Feature values per candidate id, exactly as sent to the scorer. */
  featureSnapshot: json("feature_snapshot").notNull().$type<Record<string, Record<string, number>>>(),
  /** Binding FIFO/AEO order at serve time. */
  authoritativeOrder: json("authoritative_order").notNull().$type<number[]>(),
  /** Policy-suggested order (advisory only). */
  suggestedOrder: json("suggested_order").notNull().$type<number[]>(),
  /** Officer the suggestion was served to. */
  servedTo: integer("served_to").references(() => users.id),
  servedAt: timestamp("served_at").defaultNow().notNull(),
}, (t) => [
  index("idx_qps_policy_version").on(t.policyVersion),
  index("idx_qps_served_at").on(t.servedAt),
]);
export type QueuePolicySuggestion = typeof queuePolicySuggestions.$inferSelect;
export type InsertQueuePolicySuggestion = typeof queuePolicySuggestions.$inferInsert;

/**
 * Phase 18: officer decisions on the RL queue-policy SHADOW suggestions.
 * Append-only log for future offline-RL reward joins (accept/override of a
 * suggested queue position vs the authoritative FIFO/AEO order). The
 * suggestion is never auto-applied — this table records what the officer
 * actually did, keyed by the policy version that made the suggestion.
 */
export const queuePolicyDecisions = pgTable("queue_policy_decisions", {
  id: serial("id").primaryKey(),
  officerId: integer("officer_id").notNull().references(() => users.id),
  declarationId: integer("declaration_id").notNull().references(() => declarations.id),
  policyVersion: varchar("policy_version", { length: 64 }).notNull(),
  /** Position (1-based) the shadow policy suggested for this declaration. */
  suggestedPosition: integer("suggested_position").notNull(),
  /** Position (1-based) in the authoritative FIFO/AEO queue at decision time. */
  authoritativePosition: integer("authoritative_position").notNull(),
  decision: varchar("decision", { length: 16 }).notNull(), // 'accepted' | 'overrode'
  /** Suggestion episode this decision answers (Phase 19 F1/M2). */
  suggestionId: integer("suggestion_id").references(() => queuePolicySuggestions.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_qpd_declaration").on(t.declarationId),
  index("idx_qpd_officer").on(t.officerId),
  // M1: one decision per (suggestion episode, declaration, officer) — reward
  // log is insert-idempotent; duplicate submissions hit 23505 and are folded.
  uniqueIndex("uq_qpd_suggestion_declaration_officer")
    .on(t.suggestionId, t.declarationId, t.officerId)
    .where(sql`suggestion_id is not null`),
  // M3: the CHECK constraint 0070 created only in SQL, expressed in schema.
  check("queue_policy_decisions_decision_check", sql`decision IN ('accepted','overrode')`),
]);
export type QueuePolicyDecision = typeof queuePolicyDecisions.$inferSelect;
export type InsertQueuePolicyDecision = typeof queuePolicyDecisions.$inferInsert;

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
