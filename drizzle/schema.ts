import {
  pgTable, pgEnum, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, jsonb, bigint, index, unique, real, uuid
} from "drizzle-orm/pg-core";

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "customs_officer", "oga_officer", "inspector", "finance"]);

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
  // Sprint 25 composite indexes for query performance
  index("idx_decl_trader_status").on(t.traderId, t.status),
  index("idx_decl_submitted_at").on(t.submittedAt),
  index("idx_decl_risk_lane_status").on(t.riskLane, t.status),
  index("idx_decl_assigned_officer").on(t.assignedOfficerId),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_dv_owner_id").on(t.ownerId),
  index("idx_dv_declaration_id").on(t.declarationId),
  index("idx_dv_status").on(t.status),
  index("idx_dv_category").on(t.category),
  index("idx_dv_owner_status").on(t.ownerId, t.status),
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
  "drawback_credit", "refund", "adjustment",
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
