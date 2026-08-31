// Package workflows — shared type definitions used by both the workflow
// orchestration layer and the activity implementations.
//
// PRA-129 remediation: these are type ALIASES of the canonical definitions in
// the activities package (single source of truth). The previous standalone
// duplicates drifted from the activity implementations and masked the fact
// that the workflow file referenced activities that only existed in the
// activities package.
package workflows

import "github.com/tradegateway/ngswtp/workflow-service/activities"

type SanctionsInput = activities.SanctionsInput
type SanctionsResult = activities.SanctionsResult

type RiskInput = activities.RiskInput
type RiskScoringResult = activities.RiskScoringResult

type OGARoutingInput = activities.OGARoutingInput
type OGARoutingResult = activities.OGARoutingResult

type OGAApprovalInput = activities.OGAApprovalInput
type OGAApprovalResult = activities.OGAApprovalResult

type InspectionInput = activities.InspectionInput
type InspectionResult = activities.InspectionResult

type DutyInput = activities.DutyInput
type DutyCalculationResult = activities.DutyCalculationResult

type StatusUpdateInput = activities.StatusUpdateInput

type PermitInput = activities.PermitInput
type PermitResult = activities.PermitResult
