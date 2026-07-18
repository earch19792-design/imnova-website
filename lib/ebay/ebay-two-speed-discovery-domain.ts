import { createHash } from "node:crypto"

export const TWO_SPEED_DISCOVERY_VERSION = "EBAY-TWO-SPEED-DISCOVERY-V2"
export const SCORE_V2_VERSION = "EBAY-COMMERCIAL-PRIORITY-SCORE-V2"

export type CanonicalCandidateClassification =
  | "RECOMMENDED_FOR_REVIEW"
  | "PRELIMINARY_POTENTIAL"
  | "NEW_LUNA_SIGNAL"
  | "BLOCKED"
  | "REJECTED"

export type EvidenceTier =
  | "CONFIRMED_SOLD_EXACT"
  | "CONFIRMED_SOLD_RELATED_PACK"
  | "CONFIRMED_SOLD_RELATED_SIZE"
  | "ACTIVE_EXACT"
  | "ACTIVE_RELATED"
  | "ESTIMATED_SIGNAL"
  | "BROAD_SEARCH_ONLY"

type FamilyIdentity = {
  brand?: string | null
  productLine?: string | null
  mpn?: string | null
  model?: string | null
  normalizedName?: string | null
  baseVariant?: string | null
  categoryId?: string | null
  unitSize?: string | null
  scent?: string | null
  formulation?: string | null
  packCount?: number | null
}

function normalized(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim()
    : ""
}

/** A non-reconstructive hash used to share one lightweight query safely. */
export function buildEbayFamilyFingerprint(value: FamilyIdentity) {
  const identity = [
    value.brand,
    value.productLine,
    value.mpn || value.model,
    value.normalizedName,
    value.baseVariant,
    value.categoryId,
    value.unitSize,
    value.scent,
    value.formulation,
    value.packCount,
  ].map(normalized).join("|")
  return createHash("sha256").update(identity).digest("hex")
}

export function sameCompatibleFamily(left: FamilyIdentity, right: FamilyIdentity) {
  const conflict = (a: unknown, b: unknown) => normalized(a) && normalized(b) && normalized(a) !== normalized(b)
  return !conflict(left.scent, right.scent) &&
    !conflict(left.formulation, right.formulation) &&
    !conflict(left.model || left.mpn, right.model || right.mpn) &&
    !conflict(left.unitSize, right.unitSize) &&
    !conflict(left.packCount, right.packCount)
}

export function evaluateLocalDiscoveryGates(input: {
  available?: boolean | null
  supplierCost?: number | null
  supplierSku?: string | null
  identityConfidence?: number | null
  regulatedWithoutPath?: boolean
  optimisticMarginPercent?: number | null
  duplicateFamilyVariant?: boolean
  lunaObservedAt?: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const observed = Date.parse(input.lunaObservedAt ?? "")
  const blockers = [
    input.available === false ? "LUNA_OUT_OF_STOCK" : "",
    !(Number(input.supplierCost) > 0) ? "LUNA_COST_MISSING" : "",
    !normalized(input.supplierSku) ? "SUPPLIER_SKU_MISSING" : "",
    Number(input.identityConfidence ?? 0) < 35 ? "IDENTITY_INSUFFICIENT" : "",
    input.regulatedWithoutPath ? "REGULATORY_PATH_MISSING" : "",
    input.optimisticMarginPercent !== null && input.optimisticMarginPercent !== undefined && input.optimisticMarginPercent <= 0
      ? "IMPOSSIBLE_MARGIN" : "",
    input.duplicateFamilyVariant ? "DUPLICATE_FAMILY_VARIANT" : "",
    !Number.isFinite(observed) || now.getTime() - observed > 72 * 60 * 60_000 ? "LUNA_RECORD_STALE" : "",
  ].filter(Boolean)
  return { eligible: blockers.length === 0, blockers }
}

export function classifyTwoSpeedCandidate(input: {
  rejected?: boolean
  blockers?: string[]
  lunaOnly?: boolean
  exactIdentityConfirmed?: boolean
  identityConfidence?: number
  exactComparableCount?: number
  compatibleSellerCount?: number
  soldExactCount?: number
  economicsAvailable?: boolean
  stockAvailable?: boolean
  evidenceFresh?: boolean
  evidenceConfidence?: number
  broadResultCount?: number
}): CanonicalCandidateClassification {
  if (input.rejected) return "REJECTED"
  if (input.blockers?.length || input.stockAvailable === false) return "BLOCKED"
  if (input.lunaOnly) return "NEW_LUNA_SIGNAL"
  const strongIdentity = input.exactIdentityConfirmed === true || Number(input.identityConfidence ?? 0) >= 85
  const exactActive = Number(input.exactComparableCount ?? 0) > 0
  const strongMarket = Number(input.soldExactCount ?? 0) > 0 || Number(input.compatibleSellerCount ?? 0) >= 3
  const recommendable = strongIdentity && exactActive && strongMarket &&
    input.economicsAvailable === true && input.stockAvailable === true &&
    input.evidenceFresh === true && Number(input.evidenceConfidence ?? 0) >= 70
  if (recommendable) return "RECOMMENDED_FOR_REVIEW"
  const compatibleSignal = exactActive || Number(input.compatibleSellerCount ?? 0) > 0
  if (compatibleSignal) return "PRELIMINARY_POTENTIAL"
  // A broad result count is discovery context, never demand evidence.
  if (Number(input.broadResultCount ?? 0) > 0) return "NEW_LUNA_SIGNAL"
  return "NEW_LUNA_SIGNAL"
}

export function calculateCommercialPriorityScoreV2(input: {
  eligible: boolean
  confirmedExactSold: number
  economicsAndMargin: number
  competitionAndSellThrough: number
  lunaAvailability: number
  temporalTrend: number
  operationalReadiness: number
  identityConfidence: number
  evidenceConfidence: number
  freshnessConfidence: number
  broadOnly?: boolean
}) {
  if (!input.eligible || input.broadOnly) return 0
  const commercialPotential =
    input.confirmedExactSold * .35 + input.economicsAndMargin * .25 +
    input.competitionAndSellThrough * .15 + input.lunaAvailability * .10 +
    input.temporalTrend * .10 + input.operationalReadiness * .05
  const multiplier = [input.identityConfidence, input.evidenceConfidence, input.freshnessConfidence]
    .reduce((product, value) => product * Math.max(0, Math.min(100, value)) / 100, 1)
  return Math.round(Math.max(0, Math.min(100, commercialPotential * multiplier)) * 100) / 100
}

export function simulateTwoSpeedQuota(input: {
  variants: number
  families: number
  deepCandidates: number
  cacheHitRate: number
  detailCalls?: number
  dailyBrowseLimit?: number
  protectedMonitorBudget?: number
}) {
  const oldCalls = input.variants * 7
  const misses = Math.ceil(input.families * (1 - Math.max(0, Math.min(1, input.cacheHitRate))))
  const lightCalls = misses
  const promoted = Math.min(input.deepCandidates, input.families)
  const deepSearchCalls = promoted
  const deepCalls = promoted * (input.detailCalls ?? 2)
  const protectedBudget = input.protectedMonitorBudget ?? 500
  const availableDiscoveryBudget = Math.max(0, (input.dailyBrowseLimit ?? 5_000) - protectedBudget)
  return {
    oldCalls,
    lightCalls,
    deepDetailCalls: deepCalls,
    deepSearchCalls,
    totalCalls: lightCalls + deepSearchCalls + deepCalls,
    protectedMonitorBudget: protectedBudget,
    availableDiscoveryBudget,
    withinDiscoveryBudget: lightCalls + deepSearchCalls + deepCalls <= availableDiscoveryBudget,
    duplicateCallsPrevented: Math.max(0, input.variants - misses),
  }
}
