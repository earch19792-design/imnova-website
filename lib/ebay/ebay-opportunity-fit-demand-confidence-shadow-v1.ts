export const SELLER_OS_OPPORTUNITY_FIT_SHADOW_VERSION =
  "SELLER_OS_OPPORTUNITY_FIT_DEMAND_CONFIDENCE_SHADOW_V1" as const

export type OpportunityFitStatusV1 = "STRONG" | "SUPPORTED" | "UNPROVEN"
export type SupplierIdentityStatusV1 = "STRONG" | "UNPROVEN"
export type DemandConfidenceV1 =
  | "D1_EXACT_PRODUCT_DEMAND_PROVEN"
  | "D2_EXACT_SUBTYPE_DEMAND_PROVEN"
  | "D3_FAMILY_DEMAND_PROVEN_OPPORTUNITY_FIT_STRONG"
  | "D4_FAMILY_DEMAND_SUPPORTED"
  | "D5_DEMAND_UNPROVEN"
export type ShadowPolicyDecisionV1 =
  | "NEW_STANDARD"
  | "NEW_BOUNDED_MARKET_TEST"
  | "NEW_RESEARCH_REQUIRED"
  | "NEW_BLOCKED"
  | "NEW_REJECTED"
export type OldPolicyDecisionV1 =
  | "OLD_STANDARD_READY"
  | "OLD_BLOCKED_EXACT_DEMAND"
  | "OLD_RESEARCH_REQUIRED"
  | "OLD_REJECTED"

type GateStatus = "PASS" | "UNPROVEN" | "BLOCKED"
type EconomicsStatus = "PASS" | "PROVEN_UNPROFITABLE" | "UNPROVEN"

export type OpportunityFitEvidenceV1 = Readonly<{
  sameCustomerProblem: boolean
  sameFunctionalUseCase: boolean
  sameProductClass: boolean
  compatibleSubtype: boolean
  requiredFeatureCoveragePercent: number | null
  categoryCompatibility: boolean
  titleOnlyInference: boolean
  evidenceReferences: readonly string[]
}>

export type SupplierIdentityEvidenceV1 = Readonly<{
  exactLunaProductId: boolean
  exactLunaVariantId: boolean
  exactSupplierSku: boolean
  variantCompatibility: boolean
  colorSizePackCompatibility: boolean
  titleOnlyInference: boolean
  unresolvedAmbiguity: boolean
  durableAuthoritativeEvidence: boolean
}>

export type ShadowCandidateInputV1 = Readonly<{
  candidateId: string
  productName: string
  familyName: string
  opportunityFitEvidence: OpportunityFitEvidenceV1
  supplierIdentityEvidence: SupplierIdentityEvidenceV1
  familyDemandStatus: "PROVEN" | "SUPPORTED" | "UNPROVEN"
  exactProductDemandStatus: "PROVEN" | "UNPROVEN"
  exactSubtypeDemandStatus: "PROVEN" | "UNPROVEN" | "NOT_APPLICABLE"
  currentHardBlockers: readonly string[]
  upstreamRejected: boolean
  upstreamRejectReason: string | null
  freshStock: GateStatus
  authoritativeShipping: GateStatus
  economics: EconomicsStatus
  compliance: GateStatus
  commercialPriority: Readonly<{
    expectedContributionProfitUsd: number | null
    contributionMarginPercent: number | null
    evidenceQuality: number | null
    competitionEvidence: number | null
    stockFreshness: number | null
    operationalComplexity: number | null
    complianceRisk: number | null
  }>
}>

function fail(code: string): never {
  throw new Error(code)
}

function uniqueCodes(values: readonly string[]) {
  return Object.freeze([...new Set(values.filter((value) =>
    /^[A-Z0-9_]{1,120}$/.test(value)))])
}

export function classifyOpportunityFitV1(
  evidence: OpportunityFitEvidenceV1,
): OpportunityFitStatusV1 {
  const coverage = evidence.requiredFeatureCoveragePercent
  if (coverage !== null && (!Number.isFinite(coverage) || coverage < 0 || coverage > 100)) {
    fail("OPPORTUNITY_FIT_FEATURE_COVERAGE_INVALID")
  }
  if (evidence.titleOnlyInference || evidence.evidenceReferences.length === 0) {
    return "UNPROVEN"
  }
  const required = evidence.sameCustomerProblem && evidence.sameFunctionalUseCase &&
    evidence.sameProductClass && evidence.compatibleSubtype &&
    evidence.categoryCompatibility && coverage !== null && coverage >= 70
  if (required) return "STRONG"
  const supportedSignals = [evidence.sameCustomerProblem,
    evidence.sameFunctionalUseCase, evidence.sameProductClass,
    evidence.compatibleSubtype, evidence.categoryCompatibility]
    .filter(Boolean).length
  return supportedSignals >= 3 ? "SUPPORTED" : "UNPROVEN"
}

export function classifySupplierIdentityV1(
  evidence: SupplierIdentityEvidenceV1,
): SupplierIdentityStatusV1 {
  return evidence.exactLunaProductId && evidence.exactLunaVariantId &&
    evidence.exactSupplierSku && evidence.variantCompatibility &&
    evidence.colorSizePackCompatibility && !evidence.titleOnlyInference &&
    !evidence.unresolvedAmbiguity && evidence.durableAuthoritativeEvidence
    ? "STRONG" : "UNPROVEN"
}

export function classifyDemandConfidenceV1(input: Readonly<{
  familyDemandStatus: ShadowCandidateInputV1["familyDemandStatus"]
  exactProductDemandStatus: ShadowCandidateInputV1["exactProductDemandStatus"]
  exactSubtypeDemandStatus: ShadowCandidateInputV1["exactSubtypeDemandStatus"]
  opportunityFit: OpportunityFitStatusV1
}>): DemandConfidenceV1 {
  if (input.exactProductDemandStatus === "PROVEN") {
    return "D1_EXACT_PRODUCT_DEMAND_PROVEN"
  }
  if (input.exactSubtypeDemandStatus === "PROVEN") {
    return "D2_EXACT_SUBTYPE_DEMAND_PROVEN"
  }
  if (input.familyDemandStatus === "PROVEN" && input.opportunityFit === "STRONG") {
    return "D3_FAMILY_DEMAND_PROVEN_OPPORTUNITY_FIT_STRONG"
  }
  if (input.familyDemandStatus === "SUPPORTED" ||
      input.familyDemandStatus === "PROVEN") {
    return "D4_FAMILY_DEMAND_SUPPORTED"
  }
  return "D5_DEMAND_UNPROVEN"
}

function exactDemandBlocked(blockers: readonly string[]) {
  return blockers.some((code) => code === "EXACT_PRODUCT_DEMAND_UNPROVEN" ||
    code === "EXACT_SUBTYPE_DEMAND_UNPROVEN")
}

function oldPolicyDecision(input: ShadowCandidateInputV1,
  demandConfidence: DemandConfidenceV1): Readonly<{
    decision: OldPolicyDecisionV1
    reason: string
  }> {
  if (input.upstreamRejected) return Object.freeze({ decision: "OLD_REJECTED",
    reason: input.upstreamRejectReason ?? "UPSTREAM_REJECTED" })
  if (input.economics === "PROVEN_UNPROFITABLE") {
    return Object.freeze({ decision: "OLD_REJECTED",
      reason: "REJECTED_ECONOMICS" })
  }
  if (exactDemandBlocked(input.currentHardBlockers) ||
      demandConfidence === "D3_FAMILY_DEMAND_PROVEN_OPPORTUNITY_FIT_STRONG") {
    return Object.freeze({ decision: "OLD_BLOCKED_EXACT_DEMAND",
      reason: input.currentHardBlockers.includes("EXACT_SUBTYPE_DEMAND_UNPROVEN")
        ? "EXACT_SUBTYPE_DEMAND_UNPROVEN" : "EXACT_PRODUCT_DEMAND_UNPROVEN" })
  }
  const allHardGatesPass = classifySupplierIdentityV1(
    input.supplierIdentityEvidence) === "STRONG" && input.freshStock === "PASS" &&
    input.authoritativeShipping === "PASS" && input.economics === "PASS" &&
    input.compliance === "PASS"
  if (allHardGatesPass && (demandConfidence === "D1_EXACT_PRODUCT_DEMAND_PROVEN" ||
      demandConfidence === "D2_EXACT_SUBTYPE_DEMAND_PROVEN")) {
    return Object.freeze({ decision: "OLD_STANDARD_READY", reason: "ALL_GATES_PASS" })
  }
  return Object.freeze({ decision: "OLD_RESEARCH_REQUIRED",
    reason: "REMAINING_EVIDENCE_REQUIRED" })
}

function newShadowDecision(input: ShadowCandidateInputV1,
  opportunityFit: OpportunityFitStatusV1,
  supplierIdentity: SupplierIdentityStatusV1,
  demandConfidence: DemandConfidenceV1): Readonly<{
    decision: ShadowPolicyDecisionV1
    reason: string
  }> {
  if (input.upstreamRejected) return Object.freeze({ decision: "NEW_REJECTED",
    reason: input.upstreamRejectReason ?? "UPSTREAM_REJECTED" })
  if (input.economics === "PROVEN_UNPROFITABLE") {
    return Object.freeze({ decision: "NEW_REJECTED", reason: "REJECTED_ECONOMICS" })
  }
  if (supplierIdentity !== "STRONG") {
    return Object.freeze({ decision: "NEW_BLOCKED", reason: "BLOCKED_IDENTITY" })
  }
  if (input.freshStock !== "PASS") {
    return Object.freeze({ decision: "NEW_BLOCKED", reason: "BLOCKED_STOCK" })
  }
  if (input.authoritativeShipping !== "PASS") {
    return Object.freeze({ decision: "NEW_BLOCKED",
      reason: "BLOCKED_AUTHORITATIVE_SHIPPING" })
  }
  if (input.economics !== "PASS") {
    return Object.freeze({ decision: "NEW_BLOCKED", reason: "BLOCKED_ECONOMICS" })
  }
  if (input.compliance !== "PASS") {
    return Object.freeze({ decision: "NEW_BLOCKED", reason: "BLOCKED_COMPLIANCE" })
  }
  if (demandConfidence === "D1_EXACT_PRODUCT_DEMAND_PROVEN" ||
      demandConfidence === "D2_EXACT_SUBTYPE_DEMAND_PROVEN") {
    return Object.freeze({ decision: "NEW_STANDARD", reason: "STANDARD_GATES_PASS" })
  }
  if (demandConfidence === "D3_FAMILY_DEMAND_PROVEN_OPPORTUNITY_FIT_STRONG" &&
      opportunityFit === "STRONG") {
    return Object.freeze({ decision: "NEW_BOUNDED_MARKET_TEST",
      reason: "D3_BOUNDED_MARKET_TEST" })
  }
  if (demandConfidence === "D4_FAMILY_DEMAND_SUPPORTED") {
    return Object.freeze({ decision: "NEW_RESEARCH_REQUIRED",
      reason: "DEMAND_RESEARCH_REQUIRED" })
  }
  return Object.freeze({ decision: "NEW_BLOCKED", reason: "DEMAND_UNPROVEN" })
}

export function evaluateOpportunityFitShadowCandidateV1(
  input: ShadowCandidateInputV1,
) {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.candidateId)) {
    fail("SHADOW_CANDIDATE_ID_INVALID")
  }
  const opportunityFit = classifyOpportunityFitV1(input.opportunityFitEvidence)
  const supplierIdentity = classifySupplierIdentityV1(input.supplierIdentityEvidence)
  const demandConfidence = classifyDemandConfidenceV1({
    familyDemandStatus: input.familyDemandStatus,
    exactProductDemandStatus: input.exactProductDemandStatus,
    exactSubtypeDemandStatus: input.exactSubtypeDemandStatus,
    opportunityFit,
  })
  const oldPolicy = oldPolicyDecision(input, demandConfidence)
  const newShadow = newShadowDecision(input, opportunityFit, supplierIdentity,
    demandConfidence)
  const newlyUnlockedByD3 = oldPolicy.decision === "OLD_BLOCKED_EXACT_DEMAND" &&
    newShadow.decision === "NEW_BOUNDED_MARKET_TEST"
  return Object.freeze({
    contractVersion: SELLER_OS_OPPORTUNITY_FIT_SHADOW_VERSION,
    candidateId: input.candidateId,
    productName: input.productName,
    familyName: input.familyName,
    opportunityFit,
    supplierIdentity,
    demandConfidence,
    oldPolicyDecision: oldPolicy.decision,
    oldPolicyReason: oldPolicy.reason,
    newShadowDecision: newShadow.decision,
    newShadowReason: newShadow.reason,
    newlyUnlockedByD3,
    currentHardBlockers: uniqueCodes(input.currentHardBlockers),
    commercialPriority: Object.freeze({ ...input.commercialPriority }),
    publicationModeShadow: newShadow.decision.replace(/^NEW_/, ""),
    productionPolicyChanged: false as const,
    marketplaceWrites: 0 as const,
  })
}

export function replayOpportunityFitShadowCohortV1(
  candidates: readonly ShadowCandidateInputV1[],
) {
  const evaluations = Object.freeze(candidates.map(
    evaluateOpportunityFitShadowCandidateV1))
  const count = <T extends OldPolicyDecisionV1 | ShadowPolicyDecisionV1>(value: T) =>
    evaluations.filter((entry) => entry.oldPolicyDecision === value ||
      entry.newShadowDecision === value).length
  const newlyUnlocked = evaluations.filter((entry) => entry.newlyUnlockedByD3)
  const viable = Object.freeze(evaluations.filter((entry) =>
    entry.newShadowDecision === "NEW_STANDARD" ||
    entry.newShadowDecision === "NEW_BOUNDED_MARKET_TEST").sort((left, right) => {
      const leftProfit = left.commercialPriority.expectedContributionProfitUsd
      const rightProfit = right.commercialPriority.expectedContributionProfitUsd
      if (leftProfit === null && rightProfit === null) return 0
      if (leftProfit === null) return 1
      if (rightProfit === null) return -1
      return rightProfit - leftProfit
    }))
  const safety = newlyUnlocked.every((entry) =>
    entry.opportunityFit === "STRONG" && entry.supplierIdentity === "STRONG" &&
    entry.newShadowDecision === "NEW_BOUNDED_MARKET_TEST")
  return Object.freeze({
    contractVersion: SELLER_OS_OPPORTUNITY_FIT_SHADOW_VERSION,
    evaluations,
    totalCandidatesReplayed: evaluations.length,
    oldStandardReady: count("OLD_STANDARD_READY"),
    oldBlockedExactDemand: count("OLD_BLOCKED_EXACT_DEMAND"),
    oldResearchRequired: count("OLD_RESEARCH_REQUIRED"),
    oldRejected: count("OLD_REJECTED"),
    newStandard: count("NEW_STANDARD"),
    newBoundedMarketTest: count("NEW_BOUNDED_MARKET_TEST"),
    newResearchRequired: count("NEW_RESEARCH_REQUIRED"),
    newBlocked: count("NEW_BLOCKED"),
    newRejected: count("NEW_REJECTED"),
    newlyUnlockedByD3Count: newlyUnlocked.length,
    topShadowViableCandidates: viable,
    shadowPolicySafety: safety,
    productionPolicyChanged: false as const,
    marketplaceWrites: 0 as const,
  })
}
