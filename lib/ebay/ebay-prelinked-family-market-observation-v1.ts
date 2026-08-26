import { createHash } from "node:crypto"

export const SELLER_OS_MARKET_FAMILY_ID_VERSION =
  "SELLER_OS_MARKET_FAMILY_ID_V1" as const
export const SELLER_OS_FAMILY_MARKET_OBSERVATION_VERSION =
  "SELLER_OS_FAMILY_MARKET_OBSERVATION_V1" as const
export const SELLER_OS_FAMILY_MARKET_MOMENTUM_VERSION =
  "SELLER_OS_FAMILY_MARKET_MOMENTUM_V1" as const
export const SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_VERSION =
  "SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_V1" as const
export const SELLER_OS_OPPORTUNITY_CASE_ID_VERSION =
  "SELLER_OS_OPPORTUNITY_CASE_ID_V1" as const
export const SELLER_OS_DEMAND_KEYWORD_DNA_VERSION =
  "SELLER_OS_DEMAND_KEYWORD_DNA_V1" as const

const SHA256 = /^sha256:[0-9a-f]{64}$/
const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const OBSERVATION_ID = /^family-market-observation-v1:sha256:[0-9a-f]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const MAX_ARRAY = 100

export type SellerOsMarketFamilyIdentityV1 = Readonly<{
  productFunction: string
  buyerUseCase: string
  category: string
  structuredDefinition: Readonly<Record<string, string>>
}>

export type SellerOsDemandKeywordDnaV1 = Readonly<{
  contractVersion: typeof SELLER_OS_DEMAND_KEYWORD_DNA_VERSION
  primaryDemandKeyword: string
  soldWeightedTerms: readonly Readonly<{
    term: string
    familyType: "CORE" | "FORM_FACTOR" | "FEATURE" | "USE_CASE" |
      "BENEFIT" | "PACK_FORMAT" | "AUDIENCE" | "ATTRIBUTE"
    soldListingsObserved: number
    soldQuantityObserved: number
    weightRank: number
    evidenceReferences: readonly string[]
  }>[]
  highIntentModifiers: readonly string[]
  attributeTerms: readonly string[]
  useCaseTerms: readonly string[]
  compatibilityTerms: readonly string[]
  titleTokenStructure: readonly Readonly<{
    tokens: readonly string[]
    soldQuantityObserved: number
    evidenceReferences: readonly string[]
  }>[]
  keywordDemandConfidence: Readonly<{
    scope: "FAMILY_LEVEL"
    status: "PROVEN" | "SUPPORTED"
    exactProductDemandClaimed: false
  }>
  keywordEvidenceClass: "OFFICIAL_SOLD_EVIDENCE"
  keywordEvidenceDigest: string
  keywordEvidenceReferences: readonly string[]
  keywordEvidenceObservedAt: string
  keywordEvidenceFreshness: Readonly<{
    statusAtObservation: "FRESH"
    maximumAgeSeconds: number
  }>
}>

export type SellerOsMarketFamilyDefinitionV1 = Readonly<{
  identity: SellerOsMarketFamilyIdentityV1
  familyName: string
  familyQuerySet: readonly string[]
  keyProductAttributes: readonly string[]
  keyBuyerIntentTerms: readonly string[]
  demandKeywordDna?: SellerOsDemandKeywordDnaV1 | null
  adapterContract: string
  adapterVersion: string
}>

export type SellerOsFamilyDemandStatusV1 =
  | "FAMILY_DEMAND_PROVEN"
  | "FAMILY_DEMAND_SUPPORTED"
  | "FAMILY_DEMAND_UNPROVEN"
  | "FAMILY_DEMAND_UNAVAILABLE"

export type SellerOsFamilyMarketObservationV1 = Readonly<{
  contractVersion: typeof SELLER_OS_FAMILY_MARKET_OBSERVATION_VERSION
  familyId: string
  familyDefinitionVersionId: string
  opportunityCaseId: string
  observationId: string
  observationWindowStart: string
  observationWindowEnd: string
  familyDemandStatus: SellerOsFamilyDemandStatusV1
  demandEvidenceClass:
    | "OFFICIAL_SOLD_EVIDENCE"
    | "DIRECT_MARKET_OBSERVATION"
    | "DERIVED_NON_SALES_SIGNAL"
    | "UNPROVEN"
    | "UNAVAILABLE"
  sourceStatus: "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  aggregationSemantics: "WINDOW_DELTA" | "CUMULATIVE_SNAPSHOT"
  demandEvidenceReferences: readonly string[]
  demandEvidenceDigest: string
  soldComparableCount: number | null
  soldQuantityEvidence: Readonly<{
    quantity: number
    authorityClass: "OFFICIAL_EXTERNAL_FACT"
    evidenceReferences: readonly string[]
  }> | null
  activeComparableCount: number | null
  sellerDiversity: number | null
  priceBand: Readonly<{
    currency: "USD"
    minimum: number
    maximum: number
  }> | null
  priceMedian: number | null
  priceDistributionEvidence: readonly string[]
  competitionState: "LOW" | "MODERATE" | "HIGH" | "UNPROVEN"
  buyerIntentTerms: readonly string[]
  keywordState: "AVAILABLE" | "UNPROVEN" | "UNAVAILABLE"
  demandKeywordDna: SellerOsDemandKeywordDnaV1 | null
  attributeProfile: Readonly<Record<string, string>>
  opportunityTypes: readonly string[]
  evidenceObservedAt: string
  sourceUpdatedAt: string | null
  maximumAgeSeconds: number
  provenance: Readonly<{
    sourceAdapter: string
    sourceContractVersion: string
    authority: "CANONICAL_SOURCE_REFERENCES_ONLY"
    rawMarketFactsDuplicated: false
    phase7Authority: "FUTURE_CANONICAL_AUTHORITY"
  }>
  limitations: readonly string[]
}>

export type SellerOsFamilyMarketMomentumStateV1 =
  | "INSUFFICIENT_HISTORY"
  | "NEW"
  | "STRENGTHENING"
  | "STABLE"
  | "WEAKENING"
  | "SATURATING"

export type SellerOsOpportunityReviewConditionV1 =
  | "TIME_WINDOW_ELAPSED"
  | "NEW_SOLD_EVIDENCE"
  | "PRICE_SHIFT"
  | "COMPETITOR_SHIFT"
  | "KEYWORD_SHIFT"
  | "ATTRIBUTE_SHIFT"
  | "PRODUCT_LAUNCHED"
  | "OUTCOME_WINDOW_COMPLETE"

export const SELLER_OS_PRELINKED_POST_PUBLISH_HANDOFF_POLICY_V1 =
  Object.freeze({
    contractVersion: "SELLER_OS_PRELINKED_POST_PUBLISH_HANDOFF_V1",
    opCareEnrollmentRequiresEbayItemId: true,
    p2LinkageRequiresEbayItemId: true,
    p2StockEnrollmentRequiresCertifiedP2Gate: true,
    prePublicationEbayItemIdAllowed: false,
    prePublicationP2LinkageIdAllowed: false,
    marketplaceMutationAuthority: false,
  } as const)

function fail(code: string): never { throw new Error(code) }

function canonicalText(value: string, code: string, maximum = 240) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US")
    : ""
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}

function displayText(value: string, code: string, maximum = 240) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim()
    : ""
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}

function safeId(value: string, code: string) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(code)
  return value
}

function integer(value: number, code: string, minimum = 0,
  maximum = 1_000_000) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(code)
  return value
}

function numeric(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) fail(code)
  return Number(value)
}

function instant(value: string, code: string) {
  if (!value || !Number.isFinite(Date.parse(value))) fail(code)
  return new Date(value).toISOString()
}

function digest(lines: readonly string[]) {
  return `sha256:${createHash("sha256").update(lines.join("\n"), "utf8")
    .digest("hex")}`
}

function compareUtf8C(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function uniqueSorted(values: readonly string[], code: string,
  maximum = MAX_ARRAY) {
  if (!Array.isArray(values) || values.length > maximum) fail(code)
  const normalized = values.map((value) => displayText(value, code))
  if (new Set(normalized).size !== normalized.length) fail(code)
  return Object.freeze([...normalized].sort(compareUtf8C))
}

function canonicalRecord(input: Readonly<Record<string, string>>, code: string) {
  const entries = Object.entries(input ?? {})
  if (!entries.length || entries.length > 32) fail(code)
  const normalized = entries.map(([key, value]) => [
    canonicalText(key, code, 80), canonicalText(value, code, 180),
  ] as const).sort(([a], [b]) => compareUtf8C(a, b))
  if (new Set(normalized.map(([key]) => key)).size !== normalized.length) fail(code)
  return Object.freeze(Object.fromEntries(normalized))
}

export function normalizeSellerOsDemandKeywordDnaV1(
  input: SellerOsDemandKeywordDnaV1,
) : SellerOsDemandKeywordDnaV1 {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      input.contractVersion !== SELLER_OS_DEMAND_KEYWORD_DNA_VERSION ||
      input.keywordEvidenceClass !== "OFFICIAL_SOLD_EVIDENCE" ||
      !SHA256.test(input.keywordEvidenceDigest)) {
    fail("DEMAND_KEYWORD_DNA_CONTRACT_INVALID")
  }
  if (!Array.isArray(input.soldWeightedTerms) ||
      input.soldWeightedTerms.length < 1 || input.soldWeightedTerms.length > 30 ||
      !Array.isArray(input.titleTokenStructure) ||
      input.titleTokenStructure.length < 1 || input.titleTokenStructure.length > 20) {
    fail("DEMAND_KEYWORD_DNA_BOUNDS_INVALID")
  }
  const evidenceReferences = uniqueSorted(input.keywordEvidenceReferences,
    "DEMAND_KEYWORD_DNA_EVIDENCE_REFERENCES_INVALID", 100)
  if (!evidenceReferences.length) fail("DEMAND_KEYWORD_DNA_EVIDENCE_REQUIRED")
  const evidenceSet = new Set(evidenceReferences)
  const familyTypes = new Set(["CORE", "FORM_FACTOR", "FEATURE", "USE_CASE",
    "BENEFIT", "PACK_FORMAT", "AUDIENCE", "ATTRIBUTE"])
  const soldWeightedTerms = input.soldWeightedTerms.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !familyTypes.has(entry.familyType) || entry.weightRank !== index + 1) {
      fail("DEMAND_KEYWORD_DNA_SOLD_WEIGHT_INVALID")
    }
    const references = uniqueSorted(entry.evidenceReferences,
      "DEMAND_KEYWORD_DNA_TERM_REFERENCES_INVALID", 100)
    if (!references.length || references.some((reference) =>
      !evidenceSet.has(reference))) fail("DEMAND_KEYWORD_DNA_TERM_EVIDENCE_INVALID")
    return Object.freeze({
      term: canonicalText(entry.term, "DEMAND_KEYWORD_DNA_TERM_INVALID", 120),
      familyType: entry.familyType,
      soldListingsObserved: integer(entry.soldListingsObserved,
        "DEMAND_KEYWORD_DNA_SOLD_LISTINGS_INVALID", 1),
      soldQuantityObserved: integer(entry.soldQuantityObserved,
        "DEMAND_KEYWORD_DNA_SOLD_QUANTITY_INVALID", 1),
      weightRank: index + 1,
      evidenceReferences: references,
    })
  })
  if (new Set(soldWeightedTerms.map((entry) => entry.term)).size !==
      soldWeightedTerms.length) fail("DEMAND_KEYWORD_DNA_TERM_DUPLICATE")
  const primaryDemandKeyword = canonicalText(input.primaryDemandKeyword,
    "DEMAND_KEYWORD_DNA_PRIMARY_INVALID", 120)
  if (soldWeightedTerms[0]?.term !== primaryDemandKeyword) {
    fail("DEMAND_KEYWORD_DNA_PRIMARY_WEIGHT_MISMATCH")
  }
  const soldTerms = new Set(soldWeightedTerms.map((entry) => entry.term))
  const evidenceBackedTerms = (values: readonly string[], code: string) => {
    const normalized = uniqueSorted(values, code, 30)
    if (normalized.some((term) => !soldTerms.has(term))) fail(code)
    return normalized
  }
  const titleTokenStructure = input.titleTokenStructure.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !Array.isArray(entry.tokens) || entry.tokens.length < 1 ||
        entry.tokens.length > 30) fail("DEMAND_KEYWORD_DNA_TITLE_STRUCTURE_INVALID")
    const references = uniqueSorted(entry.evidenceReferences,
      "DEMAND_KEYWORD_DNA_TITLE_REFERENCES_INVALID", 100)
    if (!references.length || references.some((reference) =>
      !evidenceSet.has(reference))) fail("DEMAND_KEYWORD_DNA_TITLE_EVIDENCE_INVALID")
    return Object.freeze({
      tokens: Object.freeze(entry.tokens.map((token: string) => canonicalText(token,
        "DEMAND_KEYWORD_DNA_TITLE_TOKEN_INVALID", 60))),
      soldQuantityObserved: integer(entry.soldQuantityObserved,
        "DEMAND_KEYWORD_DNA_TITLE_SOLD_QUANTITY_INVALID", 1),
      evidenceReferences: references,
    })
  })
  if (!input.keywordDemandConfidence ||
      input.keywordDemandConfidence.scope !== "FAMILY_LEVEL" ||
      !["PROVEN", "SUPPORTED"].includes(input.keywordDemandConfidence.status) ||
      input.keywordDemandConfidence.exactProductDemandClaimed !== false ||
      input.keywordEvidenceFreshness?.statusAtObservation !== "FRESH") {
    fail("DEMAND_KEYWORD_DNA_EVIDENCE_SEMANTICS_INVALID")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_DEMAND_KEYWORD_DNA_VERSION,
    primaryDemandKeyword,
    soldWeightedTerms: Object.freeze(soldWeightedTerms),
    highIntentModifiers: evidenceBackedTerms(input.highIntentModifiers,
      "DEMAND_KEYWORD_DNA_HIGH_INTENT_INVALID"),
    attributeTerms: evidenceBackedTerms(input.attributeTerms,
      "DEMAND_KEYWORD_DNA_ATTRIBUTE_TERMS_INVALID"),
    useCaseTerms: evidenceBackedTerms(input.useCaseTerms,
      "DEMAND_KEYWORD_DNA_USE_CASE_TERMS_INVALID"),
    compatibilityTerms: evidenceBackedTerms(input.compatibilityTerms,
      "DEMAND_KEYWORD_DNA_COMPATIBILITY_TERMS_INVALID"),
    titleTokenStructure: Object.freeze(titleTokenStructure),
    keywordDemandConfidence: Object.freeze({ scope: "FAMILY_LEVEL" as const,
      status: input.keywordDemandConfidence.status,
      exactProductDemandClaimed: false as const }),
    keywordEvidenceClass: "OFFICIAL_SOLD_EVIDENCE" as const,
    keywordEvidenceDigest: input.keywordEvidenceDigest,
    keywordEvidenceReferences: evidenceReferences,
    keywordEvidenceObservedAt: instant(input.keywordEvidenceObservedAt,
      "DEMAND_KEYWORD_DNA_OBSERVED_AT_INVALID"),
    keywordEvidenceFreshness: Object.freeze({ statusAtObservation: "FRESH" as const,
      maximumAgeSeconds: integer(input.keywordEvidenceFreshness.maximumAgeSeconds,
        "DEMAND_KEYWORD_DNA_FRESHNESS_INVALID", 60, 366 * 24 * 60 * 60) }),
  })
}

export function normalizeSellerOsMarketFamilyIdentityV1(
  input: SellerOsMarketFamilyIdentityV1,
) {
  return Object.freeze({
    productFunction: canonicalText(input.productFunction,
      "FAMILY_PRODUCT_FUNCTION_INVALID", 120),
    buyerUseCase: canonicalText(input.buyerUseCase,
      "FAMILY_BUYER_USE_CASE_INVALID", 160),
    category: canonicalText(input.category, "FAMILY_CATEGORY_INVALID", 120),
    structuredDefinition: canonicalRecord(input.structuredDefinition,
      "FAMILY_STRUCTURED_DEFINITION_INVALID"),
  })
}

export function buildSellerOsMarketFamilyIdV1(
  input: SellerOsMarketFamilyIdentityV1,
) {
  const identity = normalizeSellerOsMarketFamilyIdentityV1(input)
  const structured = Object.entries(identity.structuredDefinition)
    .map(([key, value]) => `${key}=${value}`).join("\n")
  return `market-family-v1:${digest([
    SELLER_OS_MARKET_FAMILY_ID_VERSION,
    identity.productFunction,
    identity.buyerUseCase,
    identity.category,
    structured,
  ])}`
}

export function buildSellerOsMarketFamilyDefinitionVersionIdV1(
  input: SellerOsMarketFamilyDefinitionV1,
) {
  const familyId = buildSellerOsMarketFamilyIdV1(input.identity)
  const querySet = uniqueSorted(input.familyQuerySet, "FAMILY_QUERY_SET_INVALID", 16)
  const attributes = uniqueSorted(input.keyProductAttributes,
    "FAMILY_ATTRIBUTE_SET_INVALID", 32)
  const intent = uniqueSorted(input.keyBuyerIntentTerms,
    "FAMILY_INTENT_SET_INVALID", 32)
  const name = displayText(input.familyName, "FAMILY_NAME_INVALID", 120)
  const keywordDna = input.demandKeywordDna === undefined ||
      input.demandKeywordDna === null ? null :
    normalizeSellerOsDemandKeywordDnaV1(input.demandKeywordDna)
  return `market-family-definition-v1:${digest([
    "SELLER_OS_MARKET_FAMILY_DEFINITION_V1", familyId, name,
    JSON.stringify(querySet), JSON.stringify(attributes), JSON.stringify(intent),
    safeId(input.adapterContract, "FAMILY_ADAPTER_CONTRACT_INVALID"),
    safeId(input.adapterVersion, "FAMILY_ADAPTER_VERSION_INVALID"),
    ...(keywordDna ? [keywordDna.contractVersion,
      keywordDna.keywordEvidenceDigest] : []),
  ])}`
}

export function buildSellerOsOpportunityCaseIdV1(input: Readonly<{
  familyId: string
}>) {
  if (!FAMILY_ID.test(input.familyId)) fail("OPPORTUNITY_CASE_FAMILY_ID_INVALID")
  return `opportunity-case-v1:${digest([
    SELLER_OS_OPPORTUNITY_CASE_ID_VERSION, input.familyId,
    "demand-first-test-launch",
  ])}`
}

export function buildSellerOsFamilyMarketObservationV1(input: Readonly<{
  familyDefinition: SellerOsMarketFamilyDefinitionV1
  observationWindowStart: string
  observationWindowEnd: string
  familyDemandStatus: SellerOsFamilyDemandStatusV1
  demandEvidenceClass: SellerOsFamilyMarketObservationV1["demandEvidenceClass"]
  sourceStatus: SellerOsFamilyMarketObservationV1["sourceStatus"]
  aggregationSemantics: SellerOsFamilyMarketObservationV1["aggregationSemantics"]
  demandEvidenceReferences: readonly string[]
  demandEvidenceDigest: string
  soldComparableCount: number | null
  soldQuantityEvidence: SellerOsFamilyMarketObservationV1["soldQuantityEvidence"]
  activeComparableCount: number | null
  sellerDiversity: number | null
  priceBand: SellerOsFamilyMarketObservationV1["priceBand"]
  priceMedian: number | null
  priceDistributionEvidence: readonly string[]
  competitionState: SellerOsFamilyMarketObservationV1["competitionState"]
  buyerIntentTerms: readonly string[]
  keywordState: SellerOsFamilyMarketObservationV1["keywordState"]
  demandKeywordDna?: SellerOsDemandKeywordDnaV1 | null
  attributeProfile: Readonly<Record<string, string>>
  opportunityTypes: readonly string[]
  evidenceObservedAt: string
  sourceUpdatedAt: string | null
  maximumAgeSeconds: number
  sourceAdapter: string
  sourceContractVersion: string
  limitations: readonly string[]
}>) {
  const familyId = buildSellerOsMarketFamilyIdV1(input.familyDefinition.identity)
  const familyDefinitionVersionId =
    buildSellerOsMarketFamilyDefinitionVersionIdV1(input.familyDefinition)
  const opportunityCaseId = buildSellerOsOpportunityCaseIdV1({ familyId })
  const start = instant(input.observationWindowStart,
    "OBSERVATION_WINDOW_START_INVALID")
  const end = instant(input.observationWindowEnd,
    "OBSERVATION_WINDOW_END_INVALID")
  if (Date.parse(start) >= Date.parse(end) ||
      Date.parse(end) - Date.parse(start) > 366 * 24 * 60 * 60_000) {
    fail("OBSERVATION_WINDOW_INVALID")
  }
  const evidenceObservedAt = instant(input.evidenceObservedAt,
    "OBSERVATION_EVIDENCE_TIME_INVALID")
  if (Date.parse(evidenceObservedAt) > Date.parse(end) + 5 * 60_000) {
    fail("OBSERVATION_EVIDENCE_AFTER_WINDOW")
  }
  const sourceUpdatedAt = input.sourceUpdatedAt === null ? null :
    instant(input.sourceUpdatedAt, "OBSERVATION_SOURCE_UPDATED_AT_INVALID")
  const maximumAgeSeconds = integer(input.maximumAgeSeconds,
    "OBSERVATION_MAXIMUM_AGE_INVALID", 60, 366 * 24 * 60 * 60)
  const demandKeywordDna = input.demandKeywordDna === undefined ||
      input.demandKeywordDna === null ? null :
    normalizeSellerOsDemandKeywordDnaV1(input.demandKeywordDna)
  if (demandKeywordDna && (
      demandKeywordDna.keywordEvidenceObservedAt !== evidenceObservedAt ||
      demandKeywordDna.keywordEvidenceFreshness.maximumAgeSeconds !==
        maximumAgeSeconds)) {
    fail("DEMAND_KEYWORD_DNA_OBSERVATION_BINDING_INVALID")
  }
  if (!SHA256.test(input.demandEvidenceDigest)) {
    fail("OBSERVATION_EVIDENCE_DIGEST_INVALID")
  }
  const demandEvidenceReferences = uniqueSorted(input.demandEvidenceReferences,
    "OBSERVATION_EVIDENCE_REFERENCES_INVALID")
  if (!demandEvidenceReferences.length) {
    fail("OBSERVATION_EVIDENCE_REFERENCES_REQUIRED")
  }
  const priceDistributionEvidence = uniqueSorted(input.priceDistributionEvidence,
    "OBSERVATION_PRICE_EVIDENCE_INVALID")
  const soldComparableCount = input.soldComparableCount === null ? null :
    integer(input.soldComparableCount, "OBSERVATION_SOLD_COUNT_INVALID")
  const activeComparableCount = input.activeComparableCount === null ? null :
    integer(input.activeComparableCount, "OBSERVATION_ACTIVE_COUNT_INVALID")
  const sellerDiversity = input.sellerDiversity === null ? null :
    integer(input.sellerDiversity, "OBSERVATION_SELLER_DIVERSITY_INVALID")
  let soldQuantityEvidence: SellerOsFamilyMarketObservationV1["soldQuantityEvidence"] = null
  if (input.soldQuantityEvidence !== null) {
    if (input.soldQuantityEvidence.authorityClass !== "OFFICIAL_EXTERNAL_FACT") {
      fail("OBSERVATION_SOLD_QUANTITY_AUTHORITY_INVALID")
    }
    soldQuantityEvidence = Object.freeze({
      quantity: integer(input.soldQuantityEvidence.quantity,
        "OBSERVATION_SOLD_QUANTITY_INVALID"),
      authorityClass: "OFFICIAL_EXTERNAL_FACT" as const,
      evidenceReferences: uniqueSorted(input.soldQuantityEvidence.evidenceReferences,
        "OBSERVATION_SOLD_QUANTITY_REFERENCES_INVALID"),
    })
  }
  const authoritativeDemand = ["FAMILY_DEMAND_PROVEN",
    "FAMILY_DEMAND_SUPPORTED"].includes(input.familyDemandStatus)
  if (authoritativeDemand && (input.demandEvidenceClass !==
      "OFFICIAL_SOLD_EVIDENCE" || soldComparableCount === null ||
      soldComparableCount <= 0 || soldQuantityEvidence === null ||
      soldQuantityEvidence.quantity <= 0)) {
    fail("ACTIVE_OR_NON_SALES_EVIDENCE_CANNOT_PROVE_DEMAND")
  }
  if (input.demandEvidenceClass === "UNAVAILABLE" &&
      (input.familyDemandStatus !== "FAMILY_DEMAND_UNAVAILABLE" ||
        input.sourceStatus !== "UNAVAILABLE")) {
    fail("UNAVAILABLE_EVIDENCE_STATUS_MISMATCH")
  }
  let priceBand: SellerOsFamilyMarketObservationV1["priceBand"] = null
  if (input.priceBand !== null) {
    const minimum = numeric(input.priceBand.minimum, "OBSERVATION_PRICE_MIN_INVALID")
    const maximum = numeric(input.priceBand.maximum, "OBSERVATION_PRICE_MAX_INVALID")
    if (input.priceBand.currency !== "USD" || minimum > maximum) {
      fail("OBSERVATION_PRICE_BAND_INVALID")
    }
    priceBand = Object.freeze({ currency: "USD" as const, minimum, maximum })
  }
  const priceMedian = input.priceMedian === null ? null :
    numeric(input.priceMedian, "OBSERVATION_PRICE_MEDIAN_INVALID")
  if (priceBand && priceMedian !== null &&
      (priceMedian < priceBand.minimum || priceMedian > priceBand.maximum)) {
    fail("OBSERVATION_PRICE_MEDIAN_OUTSIDE_BAND")
  }
  const observationId = `family-market-observation-v1:${digest([
    SELLER_OS_FAMILY_MARKET_OBSERVATION_VERSION, familyId, start, end,
  ])}`
  return Object.freeze({
    contractVersion: SELLER_OS_FAMILY_MARKET_OBSERVATION_VERSION,
    familyId, familyDefinitionVersionId, opportunityCaseId, observationId,
    observationWindowStart: start, observationWindowEnd: end,
    familyDemandStatus: input.familyDemandStatus,
    demandEvidenceClass: input.demandEvidenceClass,
    sourceStatus: input.sourceStatus,
    aggregationSemantics: input.aggregationSemantics,
    demandEvidenceReferences,
    demandEvidenceDigest: input.demandEvidenceDigest,
    soldComparableCount, soldQuantityEvidence, activeComparableCount,
    sellerDiversity, priceBand, priceMedian, priceDistributionEvidence,
    competitionState: input.competitionState,
    buyerIntentTerms: uniqueSorted(input.buyerIntentTerms,
      "OBSERVATION_BUYER_INTENT_INVALID", 32),
    keywordState: input.keywordState,
    demandKeywordDna,
    attributeProfile: canonicalRecord(input.attributeProfile,
      "OBSERVATION_ATTRIBUTE_PROFILE_INVALID"),
    opportunityTypes: uniqueSorted(input.opportunityTypes,
      "OBSERVATION_OPPORTUNITY_TYPES_INVALID", 16),
    evidenceObservedAt, sourceUpdatedAt, maximumAgeSeconds,
    provenance: Object.freeze({
      sourceAdapter: safeId(input.sourceAdapter,
        "OBSERVATION_SOURCE_ADAPTER_INVALID"),
      sourceContractVersion: safeId(input.sourceContractVersion,
        "OBSERVATION_SOURCE_CONTRACT_INVALID"),
      authority: "CANONICAL_SOURCE_REFERENCES_ONLY" as const,
      rawMarketFactsDuplicated: false as const,
      phase7Authority: "FUTURE_CANONICAL_AUTHORITY" as const,
    }),
    limitations: uniqueSorted(input.limitations,
      "OBSERVATION_LIMITATIONS_INVALID", 64),
  })
}

function percentChange(previous: number, current: number) {
  if (previous === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY
  return (current - previous) / previous
}

export function deriveSellerOsFamilyMarketMomentumV1(input: Readonly<{
  currentObservation: SellerOsFamilyMarketObservationV1
  previousObservation?: SellerOsFamilyMarketObservationV1 | null
  momentumPolicyVersion: string
}>) {
  const current = input.currentObservation
  if (!FAMILY_ID.test(current.familyId) || !CASE_ID.test(current.opportunityCaseId) ||
      !OBSERVATION_ID.test(current.observationId)) fail("MOMENTUM_CURRENT_INVALID")
  const policy = safeId(input.momentumPolicyVersion,
    "MOMENTUM_POLICY_VERSION_INVALID")
  const previous = input.previousObservation ?? null
  let status: SellerOsFamilyMarketMomentumStateV1 = "INSUFFICIENT_HISTORY"
  const evidenceFields: string[] = []
  if (previous !== null) {
    if (previous.familyId !== current.familyId ||
        previous.opportunityCaseId !== current.opportunityCaseId ||
        Date.parse(previous.observationWindowEnd) >
          Date.parse(current.observationWindowStart)) {
      fail("MOMENTUM_OBSERVATIONS_NOT_COMPARABLE")
    }
    const previousDuration = Date.parse(previous.observationWindowEnd) -
      Date.parse(previous.observationWindowStart)
    const currentDuration = Date.parse(current.observationWindowEnd) -
      Date.parse(current.observationWindowStart)
    const durationTolerance = Math.min(24 * 60 * 60_000,
      Math.max(5 * 60_000, previousDuration * 0.10))
    const sameDuration = Math.abs(previousDuration - currentDuration) <=
      durationTolerance
    const sameSeriesContract =
      previous.familyDefinitionVersionId === current.familyDefinitionVersionId &&
      previous.aggregationSemantics === current.aggregationSemantics &&
      previous.provenance.sourceAdapter === current.provenance.sourceAdapter &&
      previous.provenance.sourceContractVersion ===
        current.provenance.sourceContractVersion
    const hasSoldSeries = sameDuration && sameSeriesContract &&
      previous.demandEvidenceClass === "OFFICIAL_SOLD_EVIDENCE" &&
      current.demandEvidenceClass === "OFFICIAL_SOLD_EVIDENCE" &&
      previous.soldComparableCount !== null && current.soldComparableCount !== null &&
      previous.soldQuantityEvidence !== null && current.soldQuantityEvidence !== null
    if (hasSoldSeries) {
      const previousSold = previous.soldQuantityEvidence?.quantity ?? 0
      const currentSold = current.soldQuantityEvidence?.quantity ?? 0
      const soldChange = percentChange(previousSold, currentSold)
      const comparableChange = percentChange(
        previous.soldComparableCount ?? 0,
        current.soldComparableCount ?? 0,
      )
      evidenceFields.push("soldQuantityEvidence.quantity",
        "soldComparableCount", "observationWindowStart", "observationWindowEnd")
      if (previousSold === 0 && currentSold > 0) {
        status = "NEW"
      } else {
        const activeChange = previous.activeComparableCount === null ||
          current.activeComparableCount === null ? null :
          percentChange(previous.activeComparableCount, current.activeComparableCount)
        if (activeChange !== null) evidenceFields.push("activeComparableCount")
        if (((activeChange !== null && activeChange >= 0.25) ||
            comparableChange >= 0.25) && Math.abs(soldChange) <= 0.05) {
          status = "SATURATING"
        } else if (soldChange >= 0.20) {
          status = "STRENGTHENING"
        } else if (soldChange <= -0.20) {
          status = "WEAKENING"
        } else {
          status = "STABLE"
        }
      }
    }
  }
  const previousObservationId = previous?.observationId ?? null
  const momentumId = `family-market-momentum-v1:${digest([
    SELLER_OS_FAMILY_MARKET_MOMENTUM_VERSION, current.familyId,
    previousObservationId ?? "NONE", current.observationId, policy,
  ])}`
  return Object.freeze({
    contractVersion: SELLER_OS_FAMILY_MARKET_MOMENTUM_VERSION,
    momentumId, familyId: current.familyId,
    opportunityCaseId: current.opportunityCaseId,
    previousObservationId,
    currentObservationId: current.observationId,
    momentumStatus: status,
    evidenceFieldsUsed: Object.freeze(evidenceFields),
    momentumPolicyVersion: policy,
    comparableObservationCount: previous === null ? 1 :
      status === "INSUFFICIENT_HISTORY" ? 1 : 2,
    modelOnlyMomentumAllowed: false as const,
    correlationIsCausality: false as const,
  })
}

export function deriveSellerOsOpportunityReviewConditionsV1(input: Readonly<{
  previousObservation: SellerOsFamilyMarketObservationV1
  currentObservation: SellerOsFamilyMarketObservationV1
}>) {
  const previous = input.previousObservation
  const current = input.currentObservation
  if (previous.familyId !== current.familyId ||
      previous.opportunityCaseId !== current.opportunityCaseId ||
      Date.parse(previous.observationWindowEnd) >
        Date.parse(current.observationWindowStart)) {
    fail("OPPORTUNITY_REVIEW_OBSERVATIONS_NOT_COMPARABLE")
  }
  const conditions: SellerOsOpportunityReviewConditionV1[] = []
  if (previous.demandEvidenceDigest !== current.demandEvidenceDigest &&
      current.demandEvidenceClass === "OFFICIAL_SOLD_EVIDENCE") {
    conditions.push("NEW_SOLD_EVIDENCE")
  }
  if (previous.priceMedian !== null && current.priceMedian !== null &&
      Math.abs(percentChange(previous.priceMedian, current.priceMedian)) >= 0.10) {
    conditions.push("PRICE_SHIFT")
  }
  if (previous.competitionState !== current.competitionState) {
    conditions.push("COMPETITOR_SHIFT")
  }
  if (previous.keywordState !== current.keywordState ||
      JSON.stringify(previous.buyerIntentTerms) !==
        JSON.stringify(current.buyerIntentTerms)) {
    conditions.push("KEYWORD_SHIFT")
  }
  if (JSON.stringify(previous.attributeProfile) !==
      JSON.stringify(current.attributeProfile)) {
    conditions.push("ATTRIBUTE_SHIFT")
  }
  return Object.freeze(conditions)
}

export function buildSellerOsTargetProductProfileV1(
  observation: SellerOsFamilyMarketObservationV1,
) {
  if (!FAMILY_ID.test(observation.familyId) ||
      !OBSERVATION_ID.test(observation.observationId)) {
    fail("TARGET_PRODUCT_PROFILE_OBSERVATION_INVALID")
  }
  const profileDigest = digest([
    "SELLER_OS_TARGET_PRODUCT_PROFILE_V1",
    observation.familyId,
    observation.observationId,
    Object.entries(observation.attributeProfile)
      .map(([key, value]) => `${key}=${value}`).join("\n"),
    observation.buyerIntentTerms.join("\n"),
  ])
  return Object.freeze({
    contractVersion: "SELLER_OS_TARGET_PRODUCT_PROFILE_V1" as const,
    familyId: observation.familyId,
    opportunityCaseId: observation.opportunityCaseId,
    currentMarketObservationId: observation.observationId,
    attributeProfile: observation.attributeProfile,
    buyerIntentTerms: observation.buyerIntentTerms,
    profileDigest,
    authority: "DERIVED_FROM_CURRENT_MARKET_OBSERVATION" as const,
  })
}

export function buildSellerOsOpportunityMonitorEnrollmentV1(input: Readonly<{
  familyIdentity: SellerOsMarketFamilyIdentityV1
  monitorPolicyVersion: string
  enrolledAt: string
  status: "ENROLLED" | "PAUSED" | "BLOCKED" | "RETIRED"
  nextReviewCondition: SellerOsOpportunityReviewConditionV1
  nextEligibleReviewAt: string | null
  lastObservationId: string | null
  lastEvaluatedAt: string | null
}>) {
  const familyId = buildSellerOsMarketFamilyIdV1(input.familyIdentity)
  const monitorPolicyVersion = safeId(input.monitorPolicyVersion,
    "MONITOR_POLICY_VERSION_INVALID")
  const enrollmentId = `opportunity-monitor-enrollment-v1:${digest([
    SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_VERSION, familyId,
    monitorPolicyVersion,
  ])}`
  if (input.lastObservationId !== null && !OBSERVATION_ID.test(
    input.lastObservationId)) fail("MONITOR_LAST_OBSERVATION_INVALID")
  return Object.freeze({
    contractVersion: SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_VERSION,
    familyId, enrollmentId,
    enrolledAt: instant(input.enrolledAt, "MONITOR_ENROLLED_AT_INVALID"),
    status: input.status,
    nextReviewCondition: input.nextReviewCondition,
    nextEligibleReviewAt: input.nextEligibleReviewAt === null ? null :
      instant(input.nextEligibleReviewAt, "MONITOR_NEXT_REVIEW_AT_INVALID"),
    lastObservationId: input.lastObservationId,
    lastEvaluatedAt: input.lastEvaluatedAt === null ? null :
      instant(input.lastEvaluatedAt, "MONITOR_LAST_EVALUATED_AT_INVALID"),
    monitorPolicyVersion,
    continuousPollingEnabled: false as const,
    marketplaceMutationAllowed: false as const,
  })
}

export function buildSellerOsFamilyT0PreviewV1(input: Readonly<{
  observation: SellerOsFamilyMarketObservationV1
  familyName: string
  nextReviewCondition: SellerOsOpportunityReviewConditionV1
  momentumPolicyVersion: string
}>) {
  return Object.freeze({
    familyId: input.observation.familyId,
    familyName: displayText(input.familyName, "T0_FAMILY_NAME_INVALID", 120),
    opportunityCaseId: input.observation.opportunityCaseId,
    t0ObservationPreview: input.observation,
    demandStatus: input.observation.familyDemandStatus,
    soldEvidence: Object.freeze({
      comparableCount: input.observation.soldComparableCount,
      quantity: input.observation.soldQuantityEvidence?.quantity ?? null,
      references: input.observation.demandEvidenceReferences,
    }),
    priceBand: input.observation.priceBand,
    competitionState: input.observation.competitionState,
    momentumStatus: deriveSellerOsFamilyMarketMomentumV1({
      currentObservation: input.observation,
      momentumPolicyVersion: input.momentumPolicyVersion,
    }).momentumStatus,
    nextReviewCondition: input.nextReviewCondition,
    realWrite: false as const,
  })
}

export const DISCOVERY_UNIVERSE_BOUND_TO_SHADOW20 = false as const
