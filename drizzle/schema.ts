import {
  pgTable, pgEnum, serial, text, timestamp, varchar,
  integer, decimal, boolean, json, bigint, index, unique, real
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
