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