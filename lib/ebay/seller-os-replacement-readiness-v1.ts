import { createHash } from "node:crypto"

import { goldenDigest } from "./commercial-golden-path-domain-v1"
import { SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
  SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2,
  sellerOsRoiMarginPolicyContractV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

export const SELLER_OS_REPLACEMENT_READINESS_VERSION =
  "SELLER_OS_REPLACEMENT_READINESS_V1" as const
/** @deprecated Policy V2 has no monetary profit floor. */
export const SELLER_OS_REPLACEMENT_MINIMUM_NET_PROFIT_USD = 0 as const

type JsonRecord = Record<string, unknown>

export type SellerOsReplacementTargetV1 = Readonly<{
  itemId: string
  sku: string | null
  currentOpportunityId: string | null
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  reasonCode: string
  headline: string
  rationale: string
}>

export type SellerOsReplacementCandidateRowV1 = Readonly<{
  id?: unknown
  candidate_key?: unknown
  supplier_product_id?: unknown
  supplier_variant_id?: unknown
  supplier_sku?: unknown
  product_title?: unknown
  market_family_id?: unknown
  commercial_lifecycle_stage?: unknown
  commercial_decision?: unknown
  commercial_next_best_evidence?: unknown
  commercial_evidence_freshness?: unknown
  commercial_blockers?: unknown
  commercial_evaluation_receipt_id?: unknown
  commercial_memory_digest?: unknown
  commercial_memory?: unknown
  memory_contract_version?: unknown
  memory_canonical_result_version?: unknown
  memory_digest_projection?: unknown
  memory_candidate?: unknown
  memory_demand?: unknown
  memory_product_fit?: unknown
  memory_shipping?: unknown
  memory_economics?: unknown
  memory_duplicate_gate?: unknown
  memory_compliance?: unknown
  memory_decision_provenance?: unknown
  commercial_observed_at?: unknown
  commercial_updated_at?: unknown
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim() &&
      value.trim().length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() : null
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value : null
}

function stringArray(value: unknown, maximum = 100) {
  return Array.isArray(value) ? [...new Set(value.flatMap((entry) => {
    const normalized = text(entry, 200)
    return normalized ? [normalized] : []
  }))].slice(0, maximum) : []
}

function fresh(value: unknown, now: Date) {
  const freshUntil = text(record(value).freshUntil, 48)
  return Boolean(freshUntil && Number.isFinite(Date.parse(freshUntil)) &&
    Date.parse(freshUntil) > now.getTime())
}

function provenProductFit(value: unknown) {
  return ["PROVEN", "CORE_PROVEN", "CORE_PLUS_AUTONOMOUS_ENRICHMENT"]
    .includes(String(record(value).status ?? ""))
}

function provenAuthority(value: unknown) {
  return ["PROVEN", "PROVISIONAL_OWNER_POLICY"]
    .includes(String(record(value).status ?? ""))
}

function allowedLiveBlocker(value: string) {
  return /(?:EBAY|ANALYTICS|UPSTREAM|OFFICIAL_LIVE|DUPLICATE).*(?:UNAVAILABLE|UNPROVEN|LIMIT|QUOTA|TIMEOUT|REQUIRED|COHORT|LINKAGE)/
    .test(value) || /(?:DUPLICATE|OFFICIAL_LIVE)/.test(value)
}

function candidateProjection(row: SellerOsReplacementCandidateRowV1,
  now: Date, liveOpportunityIds: ReadonlySet<string>) {
  const opportunityId = text(row.id, 100)
  const familyId = text(row.market_family_id, 160)
  const storedMemory = record(row.commercial_memory)
  const hasFullMemory = Object.keys(storedMemory).length > 0
  const memory = hasFullMemory ? storedMemory : {
    contractVersion: row.memory_contract_version,
    canonicalResultVersion: row.memory_canonical_result_version,
    memoryDigest: row.memory_digest_projection,
    candidate: row.memory_candidate,
    demand: row.memory_demand,
    productFit: row.memory_product_fit,
    shipping: row.memory_shipping,
    economics: row.memory_economics,
    duplicateGate: row.memory_duplicate_gate,
    compliance: row.memory_compliance,
    decisionProvenance: row.memory_decision_provenance,
  }
  const memoryCandidate = record(memory.candidate)
  const economics = record(memory.economics)
  const demand = record(memory.demand)
  const duplicate = record(memory.duplicateGate)
  const fee = record(economics.feeAuthority)
  const compliance = record(memory.compliance)
  const shipping = record(memory.shipping)
  const memoryDigest = text(row.commercial_memory_digest, 80)
  const { memoryDigest: _storedMemoryDigest, ...memoryWithoutDigest } = memory
  const expectedNetProfit = finite(economics.expectedNetProfit)
  const contributionMarginPercent = finite(economics.marginPercent)
  const estimatedRoiPercent = finite(economics.roiPercent)
  const economicPolicyReady = contributionMarginPercent !== null &&
    contributionMarginPercent >=
      SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2 &&
    estimatedRoiPercent !== null && estimatedRoiPercent >=
      SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2
  const blockers = stringArray(row.commercial_blockers)
  const nonLiveBlockers = blockers.filter((blocker) =>
    !allowedLiveBlocker(blocker))
  const identityMatches = text(memoryCandidate.productId, 100) ===
      text(row.supplier_product_id, 100) &&
    text(memoryCandidate.variantId, 100) ===
      text(row.supplier_variant_id, 100) &&
    text(memoryCandidate.supplierSku, 160) === text(row.supplier_sku, 160)
  const durableMemory = memory.contractVersion ===
      "SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1" &&
    memory.canonicalResultVersion ===
      "CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12" &&
    text(memory.memoryDigest, 80) === memoryDigest &&
    (!hasFullMemory || goldenDigest(memoryWithoutDigest) === memoryDigest) &&
    Boolean(text(row.commercial_evaluation_receipt_id, 100)) &&
    identityMatches
  const internalEvidenceReady = durableMemory && demand.status === "PROVEN" &&
    provenProductFit(memory.productFit) && shipping.status === "PROVEN" &&
    fresh(shipping, now) && provenAuthority(economics) &&
    expectedNetProfit !== null && economicPolicyReady &&
    provenAuthority(fee) && fresh(fee, now) &&
    compliance.status === "PROVEN" && fresh(compliance, now) &&
    nonLiveBlockers.length === 0
  const duplicateStatus = text(duplicate.status, 80) ?? "UNPROVEN"
  const alreadyLive = opportunityId ? liveOpportunityIds.has(opportunityId) : true
  const rejectedByDuplicate = ["DUPLICATE", "FAIL"].includes(duplicateStatus)
  if (!opportunityId || !familyId || alreadyLive || rejectedByDuplicate ||
      !internalEvidenceReady) return null
  return Object.freeze({ opportunityId,
    candidateKey: text(row.candidate_key, 300), familyId,
    productId: text(row.supplier_product_id, 100),
    variantId: text(row.supplier_variant_id, 100),
    supplierSku: text(row.supplier_sku, 160),
    title: text(row.product_title, 500) ?? text(memoryCandidate.title, 500),
    lifecycleStage: text(row.commercial_lifecycle_stage, 80) ?? "HOLD",
    decision: text(row.commercial_decision, 80) ?? "UNPROVEN",
    nextBestEvidence: text(row.commercial_next_best_evidence, 100) ??
      "RESOLVE_BLOCKER",
    evidenceFreshness: text(row.commercial_evidence_freshness, 40) ??
      "UNPROVEN",
    expectedNetProfit, contributionMarginPercent, estimatedRoiPercent,
    soldQuantity: finite(demand.soldQuantity), duplicateStatus,
    evaluationReceiptId: text(row.commercial_evaluation_receipt_id, 100),
    memoryDigest, observedAt: text(row.commercial_observed_at, 48),
    updatedAt: text(row.commercial_updated_at, 48), blockers,
  })
}

function pairId(itemId: string, opportunityId: string) {
  return `replacement-pair-v1:sha256:${createHash("sha256")
    .update(JSON.stringify({ itemId, opportunityId })).digest("hex")}`
}

const priorityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

export function buildSellerOsReplacementReadinessV1(input: Readonly<{
  targets: readonly SellerOsReplacementTargetV1[]
  opportunityFamilies: readonly Readonly<{
    opportunityId: string; familyId: string | null
  }>[]
  candidates: readonly SellerOsReplacementCandidateRowV1[]
  liveOpportunityIds: readonly string[]
  currentLiveState: "CURRENT_FRESH" | "CURRENT_UNAVAILABLE"
  sourceStatus?: "AVAILABLE" | "UNAVAILABLE"
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const sourceStatus = input.sourceStatus ?? "AVAILABLE"
  const familyByOpportunity = new Map(input.opportunityFamilies
    .flatMap((entry) => entry.opportunityId && entry.familyId
      ? [[entry.opportunityId, entry.familyId] as const] : []))
  const liveOpportunityIds = new Set(input.liveOpportunityIds)
  const candidates = sourceStatus === "AVAILABLE"
    ? input.candidates.flatMap((row) => {
      const projected = candidateProjection(row, now, liveOpportunityIds)
      return projected ? [projected] : []
    }).sort((left, right) =>
      Number(right.decision === "GO") - Number(left.decision === "GO") ||
      (right.expectedNetProfit ?? 0) - (left.expectedNetProfit ?? 0) ||
      (right.soldQuantity ?? 0) - (left.soldQuantity ?? 0) ||
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")) ||
      left.opportunityId.localeCompare(right.opportunityId)) : []
  const availableByFamily = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const family = availableByFamily.get(candidate.familyId) ?? []
    family.push(candidate)
    availableByFamily.set(candidate.familyId, family)
  }
  const used = new Set<string>()
  const pairs: JsonRecord[] = []
  const unpaired: JsonRecord[] = []
  const targets = [...input.targets].sort((left, right) =>
    priorityRank[right.priority] - priorityRank[left.priority] ||
    left.itemId.localeCompare(right.itemId))
  for (const target of targets) {
    const familyId = target.currentOpportunityId
      ? familyByOpportunity.get(target.currentOpportunityId) ?? null : null
    const candidate = familyId
      ? (availableByFamily.get(familyId) ?? []).find((entry) =>
        !used.has(entry.opportunityId) &&
        entry.opportunityId !== target.currentOpportunityId) ?? null : null
    if (!candidate) {
      unpaired.push(Object.freeze({ listing: Object.freeze({ ...target,
        familyId }), status: sourceStatus === "AVAILABLE"
          ? "UNPAIRED" : "UNAVAILABLE",
      reasonCode: sourceStatus === "UNAVAILABLE"
        ? "REPLACEMENT_AUTHORITY_READ_UNAVAILABLE"
        : familyId ? "NO_SAME_FAMILY_CANDIDATE_READY"
          : "LISTING_MARKET_FAMILY_UNPROVEN",
      nextAction: sourceStatus === "UNAVAILABLE" ? "WAIT_UPSTREAM"
        : familyId ? "BUILD_SAME_FAMILY_CANDIDATE"
          : "LINK_LISTING_TO_MARKET_FAMILY" }))
      continue
    }
    used.add(candidate.opportunityId)
    const liveProven = input.currentLiveState === "CURRENT_FRESH"
    const duplicateProven = candidate.duplicateStatus === "PASS"
    const go = candidate.decision === "GO"
    const readiness = liveProven && duplicateProven && go
      ? "READY_FOR_OWNER_REVIEW" as const : "PREPARED_UNPROVEN" as const
    const unprovenReasons = [
      ...(liveProven ? [] : ["CURRENT_LIVE_EBAY_UNAVAILABLE"]),
      ...(duplicateProven ? [] : ["LIVE_DUPLICATE_GATE_UNPROVEN"]),
      ...(go ? [] : ["FINAL_GO_DECISION_UNPROVEN"]),
    ]
    pairs.push(Object.freeze({ pairId: pairId(target.itemId,
      candidate.opportunityId), readiness,
    listing: Object.freeze({ ...target, familyId }),
    replacement: candidate,
    unprovenReasons: Object.freeze(unprovenReasons),
    nextAction: readiness === "READY_FOR_OWNER_REVIEW"
      ? "OWNER_REVIEW_REPLACEMENT" : "WAIT_EBAY_LIVE_VALIDATION",
    oneToOne: true as const, automaticListingEndAllowed: false as const,
    automaticPublicationAllowed: false as const, marketplaceWrites: 0 as const }))
  }
  return Object.freeze({
    contractVersion: SELLER_OS_REPLACEMENT_READINESS_VERSION,
    status: sourceStatus,
    generatedAt: now.toISOString(),
    currentLiveValidation: input.currentLiveState,
    minimumNetProfitUsd: SELLER_OS_REPLACEMENT_MINIMUM_NET_PROFIT_USD,
    economicPolicy: sellerOsRoiMarginPolicyContractV2(),
    targetCount: targets.length,
    preparedCount: pairs.length,
    readyForOwnerReviewCount: pairs.filter((entry) =>
      entry.readiness === "READY_FOR_OWNER_REVIEW").length,
    preparedUnprovenCount: pairs.filter((entry) =>
      entry.readiness === "PREPARED_UNPROVEN").length,
    pairs: Object.freeze(pairs), unpaired: Object.freeze(unpaired),
    safety: Object.freeze({ readOnly: true as const,
      noFalseZeroWhenUpstreamUnavailable: true as const,
      sameFamilyRequired: true as const, oneCandidatePerListing: true as const,
      minimumNetProfitUsd: SELLER_OS_REPLACEMENT_MINIMUM_NET_PROFIT_USD,
      economicPolicy: sellerOsRoiMarginPolicyContractV2(),
      marketplaceWrites: 0 as const, listingEnds: 0 as const,
      publications: 0 as const, repricing: 0 as const }),
  })
}
