import { createHash } from "node:crypto"

import {
  evaluateSellerOsRadarExpansionFromProfitabilityV1,
  SELLER_OS_PROFITABILITY_FRONTIER_VERSION,
  type SellerOsProfitabilityFrontierV1,
} from "./ebay-prelinked-profitability-frontier-v1"
import {
  buildSellerOsTargetProductProfileWithAuthorityV1,
  SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION,
  type SellerOsTargetProductProfileWithAuthorityV1,
} from "./ebay-prelinked-target-product-profile-and-luna-fit-v1"

export const SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_VERSION =
  "SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_V1" as const
export const SELLER_OS_MORNING_DOLLAR_OPPORTUNITY_QUEUE_VERSION =
  "MORNING_DOLLAR_OPPORTUNITY_QUEUE_V1" as const
export const SELLER_OS_DAILY_DOLLAR_RESEARCH_QUEUE_VERSION =
  SELLER_OS_MORNING_DOLLAR_OPPORTUNITY_QUEUE_VERSION

const MAXIMUM_FAMILIES = 100
const MAXIMUM_MATCHES_PER_FAMILY = 25
const MAXIMUM_QUEUE_ENTRIES = 5
const MAXIMUM_KEYWORDS = 40
const SHA256 = /^sha256:[0-9a-f]{64}$/
const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const OBSERVATION_ID = /^family-market-observation-v1:sha256:[0-9a-f]{64}$/
const CANDIDATE_ID = /^prelinked-candidate-v1:sha256:[0-9a-f]{64}$/
const CONFIGURATION_ID = /^launch-configuration-v1:sha256:[0-9a-f]{64}$/
const LUNA_ID = /^\d{1,30}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/

const EVIDENCE_VALUE_ORDER = Object.freeze({
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NEAR_ZERO: 1,
} as const)

const EBAY_RESEARCH_ACTIONS = Object.freeze({
  BETTER_PRICE_DISTRIBUTION: "EBAY_SOLD_PRICE_DISTRIBUTION_READ",
  CURRENT_EBAY_COMPETITION: "EBAY_ACTIVE_COMPETITION_READ",
  EXACT_SUBTYPE_DEMAND: "EBAY_EXACT_SUBTYPE_SOLD_EVIDENCE_READ",
} as const)

export type SellerOsDailyDollarEvidenceAuthorityV1 =
  | "OFFICIAL_EXTERNAL_FACT"
  | "DIRECT_OBSERVATION"
  | "DURABLY_PERSISTED_FACT"
  | "DERIVED_FACT"
  | "INFERENCE"
  | "UNPROVEN"

export type SellerOsDailyDollarKeywordSourceV1 = Readonly<{
  sourceContractVersion: string
  authorityClass: SellerOsDailyDollarEvidenceAuthorityV1
  reference: string
  evidenceDigest: string
  observedAt: string
  maximumAgeSeconds: number
  terms: readonly string[]
}>

export type SellerOsDailyDollarRadarFamilyV1 = Readonly<{
  familyId: string
  familyName: string
  opportunityCaseId: string
  currentMarketObservationId: string
  familyDemandStatus: "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED"
  competitionStatus: "FAVORABLE" | "ACCEPTABLE" | "DIFFICULT" | "UNPROVEN"
  evidenceObservedAt: string
  maximumAgeSeconds: number
  evidenceDigest: string
  demandEvidenceSummary: Readonly<{
    demandEvidenceClass:
      | "OFFICIAL_SOLD_EVIDENCE"
      | "DIRECT_MARKET_OBSERVATION"
      | "DERIVED_NON_SALES_SIGNAL"
      | "UNPROVEN"
    soldComparableCount: number | null
    soldQuantityEvidence: number | null
    priceMedianUsd: number | null
    limitations: readonly string[]
  }>
  momentumStatus:
    | "INSUFFICIENT_HISTORY"
    | "NEW"
    | "STRENGTHENING"
    | "STABLE"
    | "WEAKENING"
    | "SATURATING"
}>

export type SellerOsDailyDollarLunaIdentityEvidenceV1 = Readonly<{
  authorityClass: SellerOsDailyDollarEvidenceAuthorityV1
  reference: string
  evidenceDigest: string
  observedAt: string
  maximumAgeSeconds: number
}>

export type SellerOsDailyDollarLunaMatchV1 = Readonly<{
  candidateId: string
  configurationId: string
  lunaIdentity: Readonly<{
    productId: string
    variantId: string
    sku: string
  }>
  identityMatchClass:
    | "EXACT_PRODUCT_AND_VARIANT"
    | "TITLE_ONLY"
    | "FUZZY"
    | "CONFLICTING"
    | "UNPROVEN"
  exactProductId: boolean
  exactVariantId: boolean
  exactSku: boolean
  productFit: "STRONG" | "MEDIUM" | "WEAK" | "UNPROVEN"
  targetProfileDigest: string
  identityEvidence: SellerOsDailyDollarLunaIdentityEvidenceV1
  frontier: SellerOsProfitabilityFrontierV1
}>

export type SellerOsDailyDollarRadarAutopilotFamilyInputV1 = Readonly<{
  discoveryStatus?: "EXISTING_MONITORED_FAMILY" | "NEW_FAMILY_DISCOVERY"
  radar: SellerOsDailyDollarRadarFamilyV1
  targetProfile: SellerOsTargetProductProfileWithAuthorityV1
  keywordSource: SellerOsDailyDollarKeywordSourceV1
  lunaMatches: readonly SellerOsDailyDollarLunaMatchV1[]
}>

export type SellerOsDailyDollarRadarAutopilotInputV1 = Readonly<{
  logicalWindow: Readonly<{
    startAt: string
    endAt: string
  }>
  evidenceCutoffAt: string
  evaluatedAt: string
  maxQueueEntries: number
  families: readonly SellerOsDailyDollarRadarAutopilotFamilyInputV1[]
}>

type NormalizedEvidence = Readonly<{
  authorityClass: SellerOsDailyDollarEvidenceAuthorityV1
  reference: string
  evidenceDigest: string
  observedAt: string
  maximumAgeSeconds: number
  fresh: boolean
}>

type NormalizedMatch = Readonly<{
  candidateId: string
  configurationId: string
  lunaIdentity: Readonly<{ productId: string; variantId: string; sku: string }>
  identityMatchClass: SellerOsDailyDollarLunaMatchV1["identityMatchClass"]
  exactProductId: boolean
  exactVariantId: boolean
  exactSku: boolean
  productFit: SellerOsDailyDollarLunaMatchV1["productFit"]
  targetProfileDigest: string
  identityEvidence: NormalizedEvidence
  frontier: SellerOsProfitabilityFrontierV1
  identityGate: "PASS" | "BLOCKED"
  queueEligible: boolean
  blockerCodes: readonly string[]
}>

function fail(code: string): never { throw new Error(code) }

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function text(value: unknown, code: string, maximum = 240) {
  if (typeof value !== "string") fail(code)
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}

function safeId(value: unknown, code: string, pattern = SAFE_ID) {
  const normalized = text(value, code)
  if (!pattern.test(normalized)) fail(code)
  return normalized
}

function instant(value: unknown, code: string) {
  const normalized = text(value, code, 48)
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) fail(code)
  return new Date(parsed).toISOString()
}

function integer(value: unknown, code: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(code)
  }
  return Number(value)
}

function optionalInteger(value: unknown, code: string, maximum = 1_000_000_000) {
  return value === null ? null : integer(value, code, 0, maximum)
}

function optionalMoney(value: unknown, code: string) {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      value > 1_000_000_000) fail(code)
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function uniqueSorted(values: readonly string[]) {
  return Object.freeze([...new Set(values)].sort(compareUtf8))
}

function normalizeEvidence(input: SellerOsDailyDollarLunaIdentityEvidenceV1,
  evaluatedAt: string, evidenceCutoffAt: string, prefix: string): NormalizedEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`${prefix}_INVALID`)
  }
  if (!["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
    "DERIVED_FACT", "INFERENCE", "UNPROVEN"].includes(input.authorityClass)) {
    fail(`${prefix}_AUTHORITY_INVALID`)
  }
  const reference = safeId(input.reference, `${prefix}_REFERENCE_INVALID`)
  if (!SHA256.test(input.evidenceDigest)) fail(`${prefix}_DIGEST_INVALID`)
  const observedAt = instant(input.observedAt, `${prefix}_OBSERVED_AT_INVALID`)
  const maximumAgeSeconds = integer(input.maximumAgeSeconds,
    `${prefix}_MAXIMUM_AGE_INVALID`, 1, 10 * 365 * 24 * 60 * 60)
  if (Date.parse(observedAt) > Date.parse(evidenceCutoffAt)) {
    fail(`${prefix}_AFTER_EVIDENCE_CUTOFF`)
  }
  const age = Date.parse(evaluatedAt) - Date.parse(observedAt)
  return Object.freeze({ authorityClass: input.authorityClass, reference,
    evidenceDigest: input.evidenceDigest, observedAt, maximumAgeSeconds,
    fresh: age >= 0 && age <= maximumAgeSeconds * 1000 })
}

function normalizeKeywordSource(input: SellerOsDailyDollarKeywordSourceV1,
  evaluatedAt: string, evidenceCutoffAt: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("DAILY_RADAR_KEYWORD_SOURCE_INVALID")
  }
  const allowedKeys = new Set(["sourceContractVersion", "authorityClass", "reference",
    "evidenceDigest", "observedAt", "maximumAgeSeconds", "terms"])
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    fail("DAILY_RADAR_KEYWORD_SOURCE_FIELD_FORBIDDEN")
  }
  if (!Array.isArray(input.terms) || input.terms.length < 1 ||
      input.terms.length > MAXIMUM_KEYWORDS) {
    fail("DAILY_RADAR_KEYWORDS_BOUND_EXCEEDED")
  }
  const evidence = normalizeEvidence(input, evaluatedAt, evidenceCutoffAt,
    "DAILY_RADAR_KEYWORD_SOURCE")
  const terms = uniqueSorted(input.terms.map((term) => text(term,
    "DAILY_RADAR_KEYWORD_INVALID", 120).toLocaleLowerCase("en-US")))
  return Object.freeze({
    sourceContractVersion: safeId(input.sourceContractVersion,
      "DAILY_RADAR_KEYWORD_CONTRACT_INVALID"),
    terms,
    authorityClass: evidence.authorityClass,
    evidenceReference: evidence.reference,
    evidenceDigest: evidence.evidenceDigest,
    observedAt: evidence.observedAt,
    maximumAgeSeconds: evidence.maximumAgeSeconds,
    fresh: evidence.fresh,
    searchVolumeClaimed: false as const,
    activeListingsProveDemand: false as const,
    titleFrequencyProvesDemand: false as const,
  })
}

function normalizeProfile(input: SellerOsTargetProductProfileWithAuthorityV1,
  radar: SellerOsDailyDollarRadarFamilyV1, evidenceCutoffAt: string) {
  if (!input || input.contractVersion !==
      SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION) {
    fail("DAILY_RADAR_TARGET_PROFILE_CONTRACT_INVALID")
  }
  const rebuilt = buildSellerOsTargetProductProfileWithAuthorityV1({
    familyId: input.familyId,
    opportunityCaseId: input.opportunityCaseId,
    currentMarketObservationId: input.currentMarketObservationId,
    attributes: input.attributes,
    buyerIntentTerms: input.buyerIntentTerms,
  })
  if (rebuilt.profileDigest !== input.profileDigest ||
      rebuilt.authority !== input.authority) {
    fail("DAILY_RADAR_TARGET_PROFILE_DIGEST_MISMATCH")
  }
  if (rebuilt.familyId !== radar.familyId ||
      rebuilt.opportunityCaseId !== radar.opportunityCaseId ||
      rebuilt.currentMarketObservationId !== radar.currentMarketObservationId) {
    fail("DAILY_RADAR_TARGET_PROFILE_BINDING_MISMATCH")
  }
  if (rebuilt.attributes.some((attribute) =>
    Date.parse(attribute.authority.observedAt) > Date.parse(evidenceCutoffAt))) {
    fail("DAILY_RADAR_TARGET_PROFILE_EVIDENCE_AFTER_CUTOFF")
  }
  return rebuilt
}

function normalizeRadar(input: SellerOsDailyDollarRadarFamilyV1,
  evaluatedAt: string, evidenceCutoffAt: string) {
  const familyId = safeId(input.familyId, "DAILY_RADAR_FAMILY_ID_INVALID", FAMILY_ID)
  const familyName = text(input.familyName, "DAILY_RADAR_FAMILY_NAME_INVALID", 160)
  const opportunityCaseId = safeId(input.opportunityCaseId,
    "DAILY_RADAR_OPPORTUNITY_CASE_ID_INVALID", CASE_ID)
  const currentMarketObservationId = safeId(input.currentMarketObservationId,
    "DAILY_RADAR_OBSERVATION_ID_INVALID", OBSERVATION_ID)
  if (!["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
    .includes(input.familyDemandStatus)) {
    fail("DAILY_RADAR_DEMAND_NOT_QUALIFIED")
  }
  if (!["FAVORABLE", "ACCEPTABLE", "DIFFICULT", "UNPROVEN"]
    .includes(input.competitionStatus)) {
    fail("DAILY_RADAR_COMPETITION_STATUS_INVALID")
  }
  if (!["INSUFFICIENT_HISTORY", "NEW", "STRENGTHENING", "STABLE", "WEAKENING",
    "SATURATING"].includes(input.momentumStatus)) {
    fail("DAILY_RADAR_MOMENTUM_STATUS_INVALID")
  }
  if (!SHA256.test(input.evidenceDigest)) fail("DAILY_RADAR_EVIDENCE_DIGEST_INVALID")
  if (!input.demandEvidenceSummary ||
      !["OFFICIAL_SOLD_EVIDENCE", "DIRECT_MARKET_OBSERVATION",
        "DERIVED_NON_SALES_SIGNAL", "UNPROVEN"]
        .includes(input.demandEvidenceSummary.demandEvidenceClass) ||
      !Array.isArray(input.demandEvidenceSummary.limitations) ||
      input.demandEvidenceSummary.limitations.length > 20) {
    fail("DAILY_RADAR_DEMAND_EVIDENCE_SUMMARY_INVALID")
  }
  const demandEvidenceSummary = Object.freeze({
    demandEvidenceClass: input.demandEvidenceSummary.demandEvidenceClass,
    soldComparableCount: optionalInteger(
      input.demandEvidenceSummary.soldComparableCount,
      "DAILY_RADAR_SOLD_COMPARABLE_COUNT_INVALID"),
    soldQuantityEvidence: optionalInteger(
      input.demandEvidenceSummary.soldQuantityEvidence,
      "DAILY_RADAR_SOLD_QUANTITY_INVALID"),
    priceMedianUsd: optionalMoney(input.demandEvidenceSummary.priceMedianUsd,
      "DAILY_RADAR_PRICE_MEDIAN_INVALID"),
    limitations: uniqueSorted(input.demandEvidenceSummary.limitations.map((item) =>
      text(item, "DAILY_RADAR_DEMAND_LIMITATION_INVALID", 160))),
    evidenceReference: currentMarketObservationId,
    evidenceDigest: input.evidenceDigest,
  })
  if (input.familyDemandStatus === "FAMILY_DEMAND_PROVEN" &&
      (demandEvidenceSummary.demandEvidenceClass !== "OFFICIAL_SOLD_EVIDENCE" ||
      (demandEvidenceSummary.soldComparableCount ?? 0) < 1 ||
      (demandEvidenceSummary.soldQuantityEvidence ?? 0) < 1)) {
    fail("DAILY_RADAR_PROVEN_DEMAND_EVIDENCE_INCOMPLETE")
  }
  const evidenceObservedAt = instant(input.evidenceObservedAt,
    "DAILY_RADAR_EVIDENCE_OBSERVED_AT_INVALID")
  const maximumAgeSeconds = integer(input.maximumAgeSeconds,
    "DAILY_RADAR_EVIDENCE_MAXIMUM_AGE_INVALID", 1, 10 * 365 * 24 * 60 * 60)
  if (Date.parse(evidenceObservedAt) > Date.parse(evidenceCutoffAt)) {
    fail("DAILY_RADAR_EVIDENCE_AFTER_CUTOFF")
  }
  const age = Date.parse(evaluatedAt) - Date.parse(evidenceObservedAt)
  return Object.freeze({ familyId, familyName, opportunityCaseId,
    currentMarketObservationId, familyDemandStatus: input.familyDemandStatus,
    competitionStatus: input.competitionStatus,
    evidenceObservedAt, maximumAgeSeconds, evidenceDigest: input.evidenceDigest,
    demandEvidenceSummary,
    momentumStatus: input.momentumStatus,
    fresh: age >= 0 && age <= maximumAgeSeconds * 1000 })
}

function normalizeFrontier(frontier: SellerOsProfitabilityFrontierV1,
  family: ReturnType<typeof normalizeRadar>, match: SellerOsDailyDollarLunaMatchV1,
  evaluatedAt: string) {
  if (!frontier || frontier.contractVersion !== SELLER_OS_PROFITABILITY_FRONTIER_VERSION ||
      !SHA256.test(frontier.frontierDigest)) {
    fail("DAILY_RADAR_FRONTIER_CONTRACT_INVALID")
  }
  if (frontier.familyId !== family.familyId ||
      frontier.familyName !== family.familyName ||
      frontier.familyDemandStatus !== family.familyDemandStatus ||
      frontier.configurationId !== match.configurationId ||
      frontier.lunaProductId !== match.lunaIdentity.productId ||
      frontier.lunaVariantId !== match.lunaIdentity.variantId ||
      frontier.lunaSku !== match.lunaIdentity.sku ||
      frontier.productFit !== match.productFit) {
    fail("DAILY_RADAR_FRONTIER_SUBJECT_BINDING_MISMATCH")
  }
  if (Date.parse(frontier.evaluatedAt) > Date.parse(evaluatedAt) ||
      frontier.phase6CanonicalEconomicsAuthority !== false ||
      frontier.unknownShippingTreatedAsZero !== false ||
      frontier.listingAuthorized !== false) {
    fail("DAILY_RADAR_FRONTIER_AUTHORITY_INVALID")
  }
  if (!(frontier.nextEvidenceValue in EVIDENCE_VALUE_ORDER)) {
    fail("DAILY_RADAR_FRONTIER_EVIDENCE_VALUE_INVALID")
  }
  if (frontier.dollarPriorityScore !== null &&
      (!Number.isFinite(frontier.dollarPriorityScore) ||
      frontier.dollarPriorityScore < 0 || frontier.dollarPriorityScore > 100)) {
    fail("DAILY_RADAR_FRONTIER_DOLLAR_SCORE_INVALID")
  }
  if (frontier.shippingStatus === "SHIPPING_PROVISIONAL_RESERVE" &&
      (frontier.provisionalShippingReserve === null ||
      !Number.isFinite(frontier.provisionalShippingReserve))) {
    fail("DAILY_RADAR_PROVISIONAL_SHIPPING_NOT_RETAINED")
  }
  return frontier
}

function normalizeMatch(input: SellerOsDailyDollarLunaMatchV1,
  family: ReturnType<typeof normalizeRadar>, profileDigest: string,
  evaluatedAt: string, evidenceCutoffAt: string): NormalizedMatch {
  const candidateId = safeId(input.candidateId, "DAILY_RADAR_CANDIDATE_ID_INVALID",
    CANDIDATE_ID)
  const configurationId = safeId(input.configurationId,
    "DAILY_RADAR_CONFIGURATION_ID_INVALID", CONFIGURATION_ID)
  const lunaIdentity = Object.freeze({
    productId: safeId(input.lunaIdentity?.productId,
      "DAILY_RADAR_LUNA_PRODUCT_ID_INVALID", LUNA_ID),
    variantId: safeId(input.lunaIdentity?.variantId,
      "DAILY_RADAR_LUNA_VARIANT_ID_INVALID", LUNA_ID),
    sku: safeId(input.lunaIdentity?.sku, "DAILY_RADAR_LUNA_SKU_INVALID", SAFE_SKU),
  })
  if (!["EXACT_PRODUCT_AND_VARIANT", "TITLE_ONLY", "FUZZY", "CONFLICTING",
    "UNPROVEN"].includes(input.identityMatchClass)) {
    fail("DAILY_RADAR_IDENTITY_MATCH_CLASS_INVALID")
  }
  if (!["STRONG", "MEDIUM", "WEAK", "UNPROVEN"].includes(input.productFit)) {
    fail("DAILY_RADAR_PRODUCT_FIT_INVALID")
  }
  if (!SHA256.test(input.targetProfileDigest) ||
      input.targetProfileDigest !== profileDigest) {
    fail("DAILY_RADAR_MATCH_PROFILE_DIGEST_MISMATCH")
  }
  const identityEvidence = normalizeEvidence(input.identityEvidence, evaluatedAt,
    evidenceCutoffAt, "DAILY_RADAR_IDENTITY_EVIDENCE")
  const frontier = normalizeFrontier(input.frontier, family, {
    ...input, candidateId, configurationId, lunaIdentity,
  }, evaluatedAt)
  const blockers: string[] = []
  const exactClass = input.identityMatchClass === "EXACT_PRODUCT_AND_VARIANT"
  if (exactClass !== (input.exactProductId && input.exactVariantId)) {
    fail("DAILY_RADAR_IDENTITY_CLASS_FLAGS_CONFLICT")
  }
  if (!exactClass) blockers.push("EXACT_PRODUCT_VARIANT_IDENTITY_REQUIRED")
  if (!input.exactProductId) blockers.push("EXACT_PRODUCT_ID_REQUIRED")
  if (!input.exactVariantId) blockers.push("EXACT_VARIANT_ID_REQUIRED")
  if (!input.exactSku) blockers.push("EXACT_LUNA_SKU_REQUIRED")
  if (input.identityMatchClass === "TITLE_ONLY" && input.productFit === "STRONG") {
    blockers.push("TITLE_ONLY_MATCH_CANNOT_BE_STRONG")
  }
  if (input.productFit === "STRONG" && !exactClass) {
    blockers.push("STRONG_FIT_REQUIRES_EXACT_PRODUCT_VARIANT")
  }
  if (!["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT"]
    .includes(identityEvidence.authorityClass)) {
    blockers.push("EXACT_IDENTITY_AUTHORITY_UNPROVEN")
  }
  if (!identityEvidence.fresh) blockers.push("LUNA_IDENTITY_EVIDENCE_STALE")
  if (!family.fresh) blockers.push("FAMILY_MARKET_EVIDENCE_STALE")
  if (!frontier.researchEligible) {
    blockers.push(...frontier.researchIneligibilityReasons,
      "I02V_FRONTIER_RESEARCH_INELIGIBLE")
  }
  if (frontier.economicClassification === "ECONOMICALLY_DEAD") {
    blockers.push("I02V_ECONOMICALLY_DEAD")
  }
  if (frontier.nextBestEvidence === "NONE") blockers.push("I02V_NO_NEXT_EVIDENCE")
  if (frontier.dollarPriorityScore === null) blockers.push("I02V_DOLLAR_SCORE_UNAVAILABLE")
  const blockerCodes = uniqueSorted(blockers)
  return Object.freeze({ candidateId, configurationId, lunaIdentity,
    identityMatchClass: input.identityMatchClass,
    exactProductId: input.exactProductId, exactVariantId: input.exactVariantId,
    exactSku: input.exactSku, productFit: input.productFit,
    targetProfileDigest: input.targetProfileDigest, identityEvidence, frontier,
    identityGate: exactClass && input.exactSku && identityEvidence.fresh &&
      ["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT"]
        .includes(identityEvidence.authorityClass) ? "PASS" as const : "BLOCKED" as const,
    queueEligible: blockerCodes.length === 0,
    blockerCodes })
}

function familyCoreDigest(value: Readonly<{
  radar: ReturnType<typeof normalizeRadar>
  targetProfile: SellerOsTargetProductProfileWithAuthorityV1
  keywordPackage: ReturnType<typeof normalizeKeywordSource>
}>) {
  return digest({ radar: value.radar, targetProfile: value.targetProfile,
    keywordPackage: value.keywordPackage })
}

function summarizeTargetProfile(
  profile: SellerOsTargetProductProfileWithAuthorityV1,
) {
  const summarize = (attribute: SellerOsTargetProductProfileWithAuthorityV1[
    "attributes"][number]) => Object.freeze({
      key: attribute.key,
      expectedValue: attribute.expectedValue,
      attributeClassification: attribute.attributeClassification,
      matchMode: attribute.matchMode,
      componentIdentityId: attribute.componentIdentityId,
      authorityClass: attribute.authority.authorityClass,
      evidenceReference: attribute.authority.reference,
      evidenceDigest: attribute.authority.evidenceDigest,
    })
  return Object.freeze({
    contractVersion: profile.contractVersion,
    profileDigest: profile.profileDigest,
    authority: profile.authority,
    requiredAttributes: Object.freeze(profile.attributes
      .filter((attribute) => attribute.requirement === "REQUIRED").map(summarize)),
    preferredAttributes: Object.freeze(profile.attributes
      .filter((attribute) => attribute.requirement === "PREFERRED").map(summarize)),
  })
}

function queueSort(left: NormalizedMatch & { familyId: string },
  right: NormalizedMatch & { familyId: string }) {
  const evidence = EVIDENCE_VALUE_ORDER[right.frontier.nextEvidenceValue] -
    EVIDENCE_VALUE_ORDER[left.frontier.nextEvidenceValue]
  if (evidence) return evidence
  const score = Number(right.frontier.dollarPriorityScore ?? -1) -
    Number(left.frontier.dollarPriorityScore ?? -1)
  if (score) return score
  return compareUtf8(`${left.familyId}\n${left.configurationId}\n${left.candidateId}`,
    `${right.familyId}\n${right.configurationId}\n${right.candidateId}`)
}

function ebayEscalationCapability(action: SellerOsProfitabilityFrontierV1["nextBestEvidence"]) {
  return action in EBAY_RESEARCH_ACTIONS
    ? EBAY_RESEARCH_ACTIONS[action as keyof typeof EBAY_RESEARCH_ACTIONS]
    : null
}

function morningQueueEntryId(familyId: string, configurationId: string,
  frontierDigest: string) {
  const hexadecimal = createHash("sha256").update(
    `SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1\n${familyId}\n${configurationId}\n${frontierDigest}`,
    "utf8").digest("hex")
  return `morning-dollar-queue-entry-v1:sha256:${hexadecimal}`
}

function contributionPathSummary(frontier: SellerOsProfitabilityFrontierV1) {
  return Object.freeze({
    marketPriceMedianUsd: frontier.marketPriceMedian,
    totalProductCostUsd: frontier.totalProductCost,
    shippingStatus: frontier.shippingStatus,
    provisionalShippingReserveUsd: frontier.provisionalShippingReserve,
    contributionProfitAtMarketMedianUsd:
      frontier.contributionProfitAtMarketMedian,
    contributionMarginAtMarketMedianPercent:
      frontier.contributionMarginAtMarketMedian,
    maxShippingAtTargetMarginUsd: frontier.maxShippingAtTargetMargin,
    minSellingPriceAtTargetMarginUsd: frontier.minSellingPriceAtTargetMargin,
    strongRecoverablePath: frontier.strongRecoverablePath,
    authority: "CANONICAL_I02V_FRONTIER_PASSTHROUGH" as const,
  })
}

export function buildSellerOsDailyDollarRadarAutopilotV1(
  input: SellerOsDailyDollarRadarAutopilotInputV1,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("DAILY_RADAR_INPUT_INVALID")
  }
  const startAt = instant(input.logicalWindow?.startAt,
    "DAILY_RADAR_WINDOW_START_INVALID")
  const endAt = instant(input.logicalWindow?.endAt, "DAILY_RADAR_WINDOW_END_INVALID")
  const evidenceCutoffAt = instant(input.evidenceCutoffAt,
    "DAILY_RADAR_EVIDENCE_CUTOFF_INVALID")
  const evaluatedAt = instant(input.evaluatedAt, "DAILY_RADAR_EVALUATED_AT_INVALID")
  if (Date.parse(startAt) >= Date.parse(endAt) ||
      Date.parse(endAt) > Date.parse(evaluatedAt) ||
      Date.parse(evidenceCutoffAt) < Date.parse(startAt) ||
      Date.parse(evidenceCutoffAt) > Date.parse(evaluatedAt)) {
    fail("DAILY_RADAR_WINDOW_ORDER_INVALID")
  }
  const maxQueueEntries = integer(input.maxQueueEntries,
    "DAILY_RADAR_QUEUE_MAXIMUM_INVALID", 0, MAXIMUM_QUEUE_ENTRIES)
  if (!Array.isArray(input.families) || input.families.length > MAXIMUM_FAMILIES) {
    fail("DAILY_RADAR_FAMILY_BOUND_EXCEEDED")
  }

  const familiesById = new Map<string, {
    radar: ReturnType<typeof normalizeRadar>
    targetProfile: SellerOsTargetProductProfileWithAuthorityV1
    keywordPackage: ReturnType<typeof normalizeKeywordSource>
    discoveryStatus: "EXISTING_MONITORED_FAMILY" | "NEW_FAMILY_DISCOVERY"
    coreDigest: string
    rawMatches: SellerOsDailyDollarLunaMatchV1[]
    duplicateInputCount: number
  }>()
  let duplicateFamiliesSuppressed = 0
  for (const familyInput of input.families) {
    if (!familyInput || !Array.isArray(familyInput.lunaMatches) ||
        familyInput.lunaMatches.length > MAXIMUM_MATCHES_PER_FAMILY) {
      fail("DAILY_RADAR_MATCH_BOUND_EXCEEDED")
    }
    const radar = normalizeRadar(familyInput.radar, evaluatedAt, evidenceCutoffAt)
    const targetProfile = normalizeProfile(familyInput.targetProfile, radar,
      evidenceCutoffAt)
    const keywordPackage = normalizeKeywordSource(familyInput.keywordSource,
      evaluatedAt, evidenceCutoffAt)
    const discoveryStatus = familyInput.discoveryStatus ??
      "EXISTING_MONITORED_FAMILY"
    if (!["EXISTING_MONITORED_FAMILY", "NEW_FAMILY_DISCOVERY"]
      .includes(discoveryStatus)) {
      fail("DAILY_RADAR_DISCOVERY_STATUS_INVALID")
    }
    const core = { radar, targetProfile, keywordPackage }
    const coreDigest = digest({ familyCoreDigest: familyCoreDigest(core),
      discoveryStatus })
    const existing = familiesById.get(radar.familyId)
    if (existing) {
      if (existing.coreDigest !== coreDigest) fail("DAILY_RADAR_FAMILY_DUPLICATE_CONFLICT")
      existing.rawMatches.push(...familyInput.lunaMatches)
      existing.duplicateInputCount += 1
      if (existing.rawMatches.length > MAXIMUM_MATCHES_PER_FAMILY) {
        fail("DAILY_RADAR_LOGICAL_FAMILY_MATCH_BOUND_EXCEEDED")
      }
      duplicateFamiliesSuppressed += 1
    } else {
      familiesById.set(radar.familyId, { ...core, discoveryStatus, coreDigest,
        rawMatches: [...familyInput.lunaMatches], duplicateInputCount: 0 })
    }
  }

  const globalCandidateIds = new Map<string, string>()
  const globalConfigurations = new Map<string, string>()
  let duplicateCandidatesSuppressed = 0
  const familyAssessments = [...familiesById.values()]
    .sort((left, right) => compareUtf8(left.radar.familyId, right.radar.familyId))
    .map((family) => {
      const matchesByConfiguration = new Map<string, NormalizedMatch & { semanticDigest: string }>()
      for (const rawMatch of family.rawMatches) {
        const match = normalizeMatch(rawMatch, family.radar,
          family.targetProfile.profileDigest, evaluatedAt, evidenceCutoffAt)
        const semanticDigest = digest(match)
        const existing = matchesByConfiguration.get(match.configurationId)
        if (existing) {
          if (existing.semanticDigest !== semanticDigest ||
              existing.candidateId !== match.candidateId) {
            fail("DAILY_RADAR_CANDIDATE_DUPLICATE_CONFLICT")
          }
          duplicateCandidatesSuppressed += 1
          continue
        }
        const priorCandidateFamily = globalCandidateIds.get(match.candidateId)
        if (priorCandidateFamily && priorCandidateFamily !== family.radar.familyId) {
          fail("DAILY_RADAR_CANDIDATE_CROSS_FAMILY_CONFLICT")
        }
        const priorConfigurationFamily = globalConfigurations.get(match.configurationId)
        if (priorConfigurationFamily && priorConfigurationFamily !== family.radar.familyId) {
          fail("DAILY_RADAR_CONFIGURATION_CROSS_FAMILY_CONFLICT")
        }
        globalCandidateIds.set(match.candidateId, family.radar.familyId)
        globalConfigurations.set(match.configurationId, family.radar.familyId)
        matchesByConfiguration.set(match.configurationId,
          Object.freeze({ ...match, semanticDigest }))
      }
      const matches = Object.freeze([...matchesByConfiguration.values()]
        .sort((left, right) => compareUtf8(left.configurationId, right.configurationId))
        .map(({ semanticDigest: _semanticDigest, ...match }) => Object.freeze(match)))
      const buyerIntentTerms = uniqueSorted(family.targetProfile.buyerIntentTerms)
      const keywordCandidates = uniqueSorted([
        ...buyerIntentTerms.map((term) => term.toLocaleLowerCase("en-US")),
        ...family.keywordPackage.terms,
      ])
      const primaryKeyword = keywordCandidates[0] ?? null
      const primaryKeywords = Object.freeze(primaryKeyword === null
        ? [] : [primaryKeyword])
      const secondaryKeywords = Object.freeze(keywordCandidates.slice(1))
      return Object.freeze({
        familyId: family.radar.familyId,
        familyName: family.radar.familyName,
        opportunityCaseId: family.radar.opportunityCaseId,
        currentMarketObservationId: family.radar.currentMarketObservationId,
        familyDemandStatus: family.radar.familyDemandStatus,
        competitionStatus: family.radar.competitionStatus,
        discoveryStatus: family.discoveryStatus,
        demandEvidenceSummary: family.radar.demandEvidenceSummary,
        momentumStatus: family.radar.momentumStatus,
        radarEvidenceFresh: family.radar.fresh,
        targetProfile: family.targetProfile,
        targetProductProfileSummary: summarizeTargetProfile(family.targetProfile),
        buyerIntentTerms,
        primaryKeyword,
        primaryKeywords,
        secondaryKeywords,
        keywordPackage: family.keywordPackage,
        matches,
        eligibleMatchCount: matches.filter((match) => match.queueEligible).length,
      })
    })

  const queueCandidates = familyAssessments.flatMap((family) => family.matches
    .filter((match) => match.queueEligible)
    .map((match) => Object.freeze({ ...match, familyId: family.familyId,
      familyName: family.familyName, opportunityCaseId: family.opportunityCaseId,
      currentMarketObservationId: family.currentMarketObservationId,
      familyDemandStatus: family.familyDemandStatus,
      competitionStatus: family.competitionStatus,
      demandEvidenceSummary: family.demandEvidenceSummary,
      targetProductProfileSummary: family.targetProductProfileSummary,
      buyerIntentTerms: family.buyerIntentTerms,
      primaryKeyword: family.primaryKeyword,
      primaryKeywords: family.primaryKeywords,
      secondaryKeywords: family.secondaryKeywords })))
    .sort(queueSort)
  const selected = queueCandidates.slice(0, maxQueueEntries)
  const queue = Object.freeze(selected.map((match, index) => {
    const queueEntryId = morningQueueEntryId(match.familyId,
      match.configurationId, match.frontier.frontierDigest)
    const escalationCapability = ebayEscalationCapability(
      match.frontier.nextBestEvidence)
    return Object.freeze({
      rank: index + 1,
      dollarPriorityRank: index + 1,
      queueEntryId,
      familyId: match.familyId,
      familyName: match.familyName,
      demandStatus: match.familyDemandStatus,
      demandEvidenceSummary: match.demandEvidenceSummary,
      opportunityCaseId: match.opportunityCaseId,
      currentMarketObservationId: match.currentMarketObservationId,
      candidateId: match.candidateId,
      configurationId: match.configurationId,
      lunaProductId: match.lunaIdentity.productId,
      lunaVariantId: match.lunaIdentity.variantId,
      topLunaProductId: match.lunaIdentity.productId,
      topLunaVariantId: match.lunaIdentity.variantId,
      lunaSku: match.lunaIdentity.sku,
      exactProductVariantIdentity: true as const,
      productFit: match.productFit,
      competitionStatus: match.competitionStatus,
      targetProfileDigest: match.targetProfileDigest,
      frontierDigest: match.frontier.frontierDigest,
      frontierInterpretation: "PASSTHROUGH_I02V" as const,
      economicClassification: match.frontier.economicClassification,
      nextBestEvidence: match.frontier.nextBestEvidence,
      nextAction: match.frontier.nextBestEvidence,
      nextBestAction: match.frontier.nextBestEvidence,
      nextEvidenceValue: match.frontier.nextEvidenceValue,
      dollarPriorityScore: match.frontier.dollarPriorityScore,
      buyerIntent: match.buyerIntentTerms,
      buyerIntentTerms: match.buyerIntentTerms,
      primaryKeyword: match.primaryKeyword,
      primaryKeywords: match.primaryKeywords,
      secondaryKeywords: match.secondaryKeywords,
      targetProductProfileSummary: match.targetProductProfileSummary,
      contributionPathSummary: contributionPathSummary(match.frontier),
      currentHardBlockers: uniqueSorted([
        ...match.blockerCodes, ...match.frontier.currentHardBlockers,
      ]),
      hardBlockers: uniqueSorted([
        ...match.blockerCodes, ...match.frontier.currentHardBlockers,
      ]),
      shipping: Object.freeze({
        status: match.frontier.shippingStatus,
        provisionalReserveUsd: match.frontier.provisionalShippingReserve,
        provisionalReserveClaimedAsObserved: false as const,
      }),
      researchStatus: "READY_FOR_BOUNDED_EVIDENCE_ACQUISITION" as const,
      ebayEscalationRequired: escalationCapability !== null,
      needsFreshEbayVerification: escalationCapability !== null,
      ebayVerificationReason: escalationCapability === null ? null
        : match.frontier.nextBestEvidence,
      ebayVerificationPriority: escalationCapability === null ? null
        : match.frontier.nextEvidenceValue,
      ebayVerificationExpectedDecisionValue: escalationCapability === null ? null
        : match.frontier.nextEvidenceValue,
      ebayEscalationId: escalationCapability === null ? null
        : `ebay-read-escalation-v1:${digest({ queueEntryId, escalationCapability })}`,
      listingAuthorized: false as const,
      marketplaceWriteAllowed: false as const,
      p2MutationAllowed: false as const,
    })
  }))

  const ebayEscalations = Object.freeze(queue.filter((entry) =>
    entry.ebayEscalationRequired).map((entry) => Object.freeze({
      escalationId: entry.ebayEscalationId as string,
      queueEntryId: entry.queueEntryId,
      familyId: entry.familyId,
      candidateId: entry.candidateId,
      evidenceAction: entry.nextBestEvidence,
      requestedCapability: ebayEscalationCapability(entry.nextBestEvidence) as string,
      status: "RECORD_ONLY_NOT_EXECUTED" as const,
      callerProvidedQueryAccepted: false as const,
      quotaReservationCreated: false as const,
      ebayCalls: 0 as const,
      marketplaceWrites: 0 as const,
    })))
  const frontiers = familyAssessments.flatMap((family) =>
    family.matches.map((match) => match.frontier))
  const i02vExpansion = evaluateSellerOsRadarExpansionFromProfitabilityV1(frontiers)
  const runMetrics = Object.freeze({
    familiesEvaluated: familyAssessments.length,
    newFamiliesDiscovered: familyAssessments.filter((family) =>
      family.discoveryStatus === "NEW_FAMILY_DISCOVERY").length,
    demandProvenCount: familyAssessments.filter((family) =>
      family.familyDemandStatus === "FAMILY_DEMAND_PROVEN").length,
    demandSupportedCount: familyAssessments.filter((family) =>
      family.familyDemandStatus === "FAMILY_DEMAND_SUPPORTED").length,
    lunaMatchCount: familyAssessments.reduce((sum, family) =>
      sum + family.matches.length, 0),
    productFitStrongCount: familyAssessments.reduce((sum, family) =>
      sum + family.matches.filter((match) => match.productFit === "STRONG").length, 0),
    economicallyDeadCount: frontiers.filter((frontier) =>
      frontier.economicClassification === "ECONOMICALLY_DEAD").length,
    economicallyRecoverableCount: frontiers.filter((frontier) =>
      frontier.economicClassification === "ECONOMICALLY_RECOVERABLE").length,
    economicallyPromisingCount: frontiers.filter((frontier) =>
      frontier.economicClassification === "ECONOMICALLY_PROMISING").length,
    economicsUnprovenCount: frontiers.filter((frontier) =>
      frontier.economicClassification === "ECONOMICS_UNPROVEN").length,
    morningQueueCount: queue.length,
    needsFreshEbayVerificationCount: queue.filter((entry) =>
      entry.needsFreshEbayVerification).length,
    ebayApiCalls: 0 as const,
  })
  const outputWithoutDigest = {
    contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_VERSION,
    queueContractVersion: SELLER_OS_DAILY_DOLLAR_RESEARCH_QUEUE_VERSION,
    logicalWindow: Object.freeze({ startAt, endAt }),
    evidenceCutoffAt,
    evaluatedAt,
    inputFamilyCount: input.families.length,
    logicalFamilyCount: familyAssessments.length,
    inputMatchCount: input.families.reduce((sum, family) =>
      sum + family.lunaMatches.length, 0),
    logicalMatchCount: familyAssessments.reduce((sum, family) =>
      sum + family.matches.length, 0),
    duplicateFamiliesSuppressed,
    duplicateCandidatesSuppressed,
    maxQueueEntries,
    queueCount: queue.length,
    ...runMetrics,
    runMetrics,
    emptyQueueValid: true as const,
    familyAssessments: Object.freeze(familyAssessments),
    queue,
    ebayEscalations,
    expansionSignal: Object.freeze({
      ...i02vExpansion,
      source: "CANONICAL_I02V_FRONTIERS_AS_RECEIVED" as const,
      discoveryUniverseBoundToShadow20: false as const,
      discoveryUniverseBoundToCurrentFive: false as const,
      queueEmpty: queue.length === 0,
    }),
    evidenceValueOrdering: Object.freeze(
      ["HIGH", "MEDIUM", "LOW", "NEAR_ZERO"] as const),
    discoveryUniverse: Object.freeze({
      boundToCurrentFive: false as const,
      boundToShadow20: false as const,
      maximumFamiliesPerRun: MAXIMUM_FAMILIES,
      maximumLunaMatchesPerFamily: MAXIMUM_MATCHES_PER_FAMILY,
      serverGeneratedInputOnly: true as const,
    }),
    frontierRecalculationCount: 0 as const,
    searchVolumeClaimed: false as const,
    soldMomentumClaimed: false as const,
    t0Writes: 0 as const,
    t1Writes: 0 as const,
    momentumObservationsCreated: 0 as const,
    quotaCounters: Object.freeze({
      externalReads: 0 as const,
      ebayTradingCalls: 0 as const,
      ebaySellCalls: 0 as const,
      ebayMarketplaceApiCalls: 0 as const,
      ebayBrowseCalls: 0 as const,
      ebayMarketplaceInsightsCalls: 0 as const,
      lunaReads: 0 as const,
    }),
    effects: Object.freeze({
      databaseWrites: 0 as const,
      marketplaceWrites: 0 as const,
      lunaMutations: 0 as const,
      p2Mutations: 0 as const,
      skuReservations: 0 as const,
      listingPublications: 0 as const,
    }),
  }
  return Object.freeze({ ...outputWithoutDigest,
    autopilotDigest: digest(outputWithoutDigest) })
}
