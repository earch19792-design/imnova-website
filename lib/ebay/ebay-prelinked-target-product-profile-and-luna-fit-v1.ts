import { createHash } from "node:crypto"

import {
  calculateEbayUnitEconomics,
  type EbayUnitEconomicsConfig,
} from "./ebay-unit-economics"

export const SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION =
  "SELLER_OS_TARGET_PRODUCT_PROFILE_WITH_AUTHORITY_V1" as const
export const SELLER_OS_PRELINKED_LUNA_PRODUCT_FIT_RECEIPT_VERSION =
  "SELLER_OS_PRELINKED_LUNA_PRODUCT_FIT_RECEIPT_V1" as const
export const SELLER_OS_PRELINKED_COMPETITION_GATE_VERSION =
  "SELLER_OS_PRELINKED_COMPETITION_GATE_V1" as const
export const SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_VERSION =
  "SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_V1" as const
export const SELLER_OS_PRELINKED_LISTING_RESEARCH_READINESS_VERSION =
  "SELLER_OS_PRELINKED_LISTING_RESEARCH_READINESS_V1" as const
export const SELLER_OS_PRELINKED_FINALIST_GATE_VERSION =
  "SELLER_OS_PRELINKED_FINALIST_GATE_V1" as const
export const SELLER_OS_PRELINKED_FINALIST_CANARY_VERSION =
  "SELLER_OS_PRELINKED_TRANSACTIONAL_FINALIST_CANARY_V1" as const

const SHA256 = /^sha256:[0-9a-f]{64}$/
const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const OBSERVATION_ID = /^family-market-observation-v1:sha256:[0-9a-f]{64}$/
const CANDIDATE_ID = /^prelinked-candidate-v1:sha256:[0-9a-f]{64}$/
const CONFIGURATION_ID = /^launch-configuration-v1:sha256:[0-9a-f]{64}$/
const COMPONENT_ID = /^launch-component-v1:sha256:[0-9a-f]{64}$/
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,119}$/
const LUNA_ID = /^\d{1,30}$/
const LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const MAXIMUM_ATTRIBUTES = 64
const MAXIMUM_COMPONENTS = 20

export type SellerOsEvidenceAuthorityClassV1 =
  | "OFFICIAL_EXTERNAL_FACT"
  | "DIRECT_OBSERVATION"
  | "DURABLY_PERSISTED_FACT"

export type SellerOsTargetAttributeClassificationV1 =
  | "PROVEN_ATTRIBUTE"
  | "SUPPORTED_ATTRIBUTE"
  | "INFERRED_ATTRIBUTE"
  | "UNPROVEN_ATTRIBUTE"

export type SellerOsTargetAttributeProvenanceClassV1 =
  | SellerOsEvidenceAuthorityClassV1
  | "DERIVED_FACT"
  | "INFERENCE"
  | "UNPROVEN"

export type SellerOsBoundedEvidenceAuthorityV1 = Readonly<{
  authorityClass: SellerOsEvidenceAuthorityClassV1
  reference: string
  evidenceDigest: string
  observedAt: string
  maximumAgeSeconds: number
}>

export type SellerOsTargetProductAttributeV1 = Readonly<{
  key: string
  expectedValue: string
  attributeClassification: SellerOsTargetAttributeClassificationV1
  requirement: "REQUIRED" | "PREFERRED"
  matchMode: "EXACT_NORMALIZED" | "TOKEN_SUBSET" | "NUMERIC_EXACT"
  componentIdentityId: string | null
  authority: Readonly<{
    authorityClass: SellerOsTargetAttributeProvenanceClassV1
    reference: string
    evidenceDigest: string
    observedAt: string
    maximumAgeSeconds: number
  }>
}>

export type SellerOsTargetProductProfileWithAuthorityV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION
  familyId: string
  opportunityCaseId: string
  currentMarketObservationId: string
  attributes: readonly SellerOsTargetProductAttributeV1[]
  buyerIntentTerms: readonly string[]
  profileDigest: string
  authority: "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION"
}>

export type SellerOsResolvedLunaIdentityComponentV1 = Readonly<{
  componentIdentityId: string
  expected: Readonly<{
    lunaProductId: string
    lunaVariantId: string
    lunaSku: string
    supplierQuantityRequired: number
  }>
  observed: Readonly<{
    sourceStatus: "AVAILABLE" | "UNAVAILABLE" | "FAILED"
    lunaProductId: string | null
    lunaVariantId: string | null
    lunaSku: string | null
    structuredAttributes: Readonly<Record<string, string>>
  }>
  targetResolutionAuthority: "SERVER_RESOLVED_CANONICAL_LUNA_CATALOG"
  canonicalSourceHost: "lunaportex.com" | "www.lunaportex.com"
  evidence: SellerOsBoundedEvidenceAuthorityV1
}>

export type SellerOsProductFitV1 = "STRONG" | "MEDIUM" | "WEAK" | "UNPROVEN"

export type SellerOsLunaProductFitReceiptV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_LUNA_PRODUCT_FIT_RECEIPT_VERSION
  launchCandidateId: string
  configurationIdentity: string
  familyId: string
  opportunityCaseId: string
  currentMarketObservationId: string
  targetProfileDigest: string
  exactIdentity: boolean
  productFit: SellerOsProductFitV1
  componentResults: readonly Readonly<{
    componentIdentityId: string
    exactProductId: boolean
    exactVariantId: boolean
    exactSku: boolean
    fresh: boolean
    evidenceReference: string
    evidenceDigest: string
  }>[]
  attributeResults: readonly Readonly<{
    key: string
    componentIdentityId: string | null
    attributeClassification: SellerOsTargetAttributeClassificationV1
    requirement: "REQUIRED" | "PREFERRED"
    outcome: "MATCH" | "MISSING" | "CONFLICT" | "UNPROVEN"
    authorityReference: string
  }>[]
  hardBlockers: readonly string[]
  evidenceReferences: readonly string[]
  evaluatedAt: string
  receiptDigest: string
  rawSourceIncluded: false
  stockFactsUsed: false
  titleSimilarityUsed: false
}>

export type SellerOsCompetitionGateV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_COMPETITION_GATE_VERSION
  familyId: string
  currentMarketObservationId: string
  targetProfileDigest: string
  familyDemandStatus:
    | "FAMILY_DEMAND_PROVEN"
    | "FAMILY_DEMAND_SUPPORTED"
    | "FAMILY_DEMAND_UNPROVEN"
    | "FAMILY_DEMAND_UNAVAILABLE"
  competitionState: "LOW" | "MODERATE" | "HIGH" | "SATURATING" | "UNPROVEN"
  competitionClassification:
    | "FAVORABLE"
    | "ACCEPTABLE"
    | "DIFFICULT"
    | "UNPROVEN"
  activeComparableCount: number | null
  sellerDiversity: number | null
  gate: "PASS" | "BLOCKED" | "UNPROVEN"
  blockerCodes: readonly string[]
  evidenceReference: string
  evidenceDigest: string
  evaluatedAt: string
}>

export type SellerOsProvisionalEconomicsReceiptV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_VERSION
  launchCandidateId: string
  configurationIdentity: string
  status:
    | "ECONOMICS_PROVISIONAL_PASS"
    | "ECONOMICS_PROVISIONAL_FAIL"
    | "ECONOMICS_UNPROVEN"
  salePrice: number | null
  supplierProductCost: number | null
  outboundShippingCost: number | null
  estimatedFeesAndReserves: number | null
  estimatedNetProfit: number | null
  estimatedNetMarginPercent: number | null
  blockerCodes: readonly string[]
  evidenceReference: string
  evidenceDigest: string
  evaluatedAt: string
  phase6AuthorityClaimed: false
  unknownShippingTreatedAsZero: false
}>

export type SellerOsListingResearchReadinessV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_LISTING_RESEARCH_READINESS_VERSION
  launchCandidateId: string
  configurationIdentity: string
  status: "PASS" | "BLOCKED" | "UNPROVEN"
  blockerCodes: readonly string[]
  evidenceReference: string
  evidenceDigest: string
  evaluatedAt: string
}>

export type SellerOsI02uFinalistEvaluationV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_FINALIST_GATE_VERSION
  launchCandidateId: string
  configurationIdentity: string
  familyId: string
  opportunityCaseId: string
  currentMarketObservationId: string
  targetProfileDigest: string
  complianceStatus: "PASS" | "BLOCKED" | "UNPROVEN"
  exactProductDemandStatus: "PROVEN" | "SUPPORTED" | "UNPROVEN" | "UNAVAILABLE"
  commercialLabel: "TEST_LAUNCH_CANDIDATE"
  provenWinnerClaimed: false
  launchClassification: "READY_FOR_TEST_LAUNCH" | "NOT_READY_TO_TEST_LAUNCH"
  launchScore: number | null
  scoreVersion: "SELLER_OS_LAUNCH_SCORE_V1" | null
  hardBlockers: readonly string[]
  prePublishRequirements: readonly string[]
  productFitReceiptDigest: string
  competitionEvidenceDigest: string
  economicsEvidenceDigest: string
  listingReadinessEvidenceDigest: string
  evaluatedAt: string
  publishAllowed: false
  marketplaceWriteAllowed: false
  p2MutationAllowed: false
  scoreCanOverrideHardBlocker: false
}>

function fail(code: string): never { throw new Error(code) }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function text(value: unknown, code: string, maximum = 240) {
  if (typeof value !== "string") fail(code)
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}

function reference(value: unknown, code: string) {
  const normalized = text(value, code)
  if (!SAFE_REFERENCE.test(normalized)) fail(code)
  return normalized
}

function safeDigest(value: unknown, code: string) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code)
  return value
}

function timestamp(value: unknown, code: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(code)
  return new Date(value).toISOString()
}

function positiveInteger(value: unknown, code: string, maximum = 31_536_000) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    fail(code)
  }
  return Number(value)
}

function nonNegativeInteger(value: unknown, code: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    fail(code)
  }
  return Number(value)
}

function finiteNonNegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function finitePositive(value: unknown) {
  const parsed = finiteNonNegative(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function boundedScore(value: unknown, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    fail(code)
  }
  return value
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en-US"))
}

function code(value: unknown, failure = "BLOCKER_CODE_INVALID") {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) fail(failure)
  return value
}

function normalizeComparable(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ").trim()
}

function evidenceAuthority(
  value: SellerOsBoundedEvidenceAuthorityV1,
  codePrefix: string,
): SellerOsBoundedEvidenceAuthorityV1 {
  if (!value || ![
    "OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
  ].includes(value.authorityClass)) fail(`${codePrefix}_AUTHORITY_INVALID`)
  return Object.freeze({
    authorityClass: value.authorityClass,
    reference: reference(value.reference, `${codePrefix}_REFERENCE_INVALID`),
    evidenceDigest: safeDigest(value.evidenceDigest, `${codePrefix}_DIGEST_INVALID`),
    observedAt: timestamp(value.observedAt, `${codePrefix}_OBSERVED_AT_INVALID`),
    maximumAgeSeconds: positiveInteger(value.maximumAgeSeconds,
      `${codePrefix}_MAXIMUM_AGE_INVALID`),
  })
}

function targetAttributeAuthority(
  value: SellerOsTargetProductAttributeV1["authority"],
  classification: SellerOsTargetAttributeClassificationV1,
) {
  if (!value) fail("TARGET_PROFILE_ATTRIBUTE_AUTHORITY_INVALID")
  const factual = ["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION",
    "DURABLY_PERSISTED_FACT"]
  const allowed = classification === "PROVEN_ATTRIBUTE" ||
      classification === "SUPPORTED_ATTRIBUTE" ? factual
    : classification === "INFERRED_ATTRIBUTE" ? ["DERIVED_FACT", "INFERENCE"]
      : ["UNPROVEN"]
  if (!allowed.includes(value.authorityClass)) {
    fail("TARGET_PROFILE_ATTRIBUTE_AUTHORITY_INVALID")
  }
  return Object.freeze({
    authorityClass: value.authorityClass,
    reference: reference(value.reference, "TARGET_PROFILE_ATTRIBUTE_REFERENCE_INVALID"),
    evidenceDigest: safeDigest(value.evidenceDigest,
      "TARGET_PROFILE_ATTRIBUTE_DIGEST_INVALID"),
    observedAt: timestamp(value.observedAt,
      "TARGET_PROFILE_ATTRIBUTE_OBSERVED_AT_INVALID"),
    maximumAgeSeconds: positiveInteger(value.maximumAgeSeconds,
      "TARGET_PROFILE_ATTRIBUTE_MAXIMUM_AGE_INVALID"),
  })
}

function isFresh(
  authority: Readonly<{ observedAt: string; maximumAgeSeconds: number }>,
  evaluatedAt: string,
) {
  const age = Date.parse(evaluatedAt) - Date.parse(authority.observedAt)
  return age >= -5 * 60_000 && age <= authority.maximumAgeSeconds * 1_000
}

function exactId(value: unknown, pattern: RegExp, code: string) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code)
  return value
}

function attributes(value: Readonly<Record<string, string>>, codePrefix: string) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length > MAXIMUM_ATTRIBUTES) fail(`${codePrefix}_INVALID`)
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    text(key, `${codePrefix}_KEY_INVALID`, 80),
    text(entry, `${codePrefix}_VALUE_INVALID`, 240),
  ]).sort(([left], [right]) => left.localeCompare(right, "en-US"))))
}

export function buildSellerOsTargetProductProfileWithAuthorityV1(input: Readonly<{
  familyId: string
  opportunityCaseId: string
  currentMarketObservationId: string
  attributes: readonly SellerOsTargetProductAttributeV1[]
  buyerIntentTerms: readonly string[]
}>) : SellerOsTargetProductProfileWithAuthorityV1 {
  const familyId = exactId(input.familyId, FAMILY_ID, "TARGET_PROFILE_FAMILY_ID_INVALID")
  const opportunityCaseId = exactId(input.opportunityCaseId, CASE_ID,
    "TARGET_PROFILE_OPPORTUNITY_CASE_ID_INVALID")
  const currentMarketObservationId = exactId(input.currentMarketObservationId,
    OBSERVATION_ID, "TARGET_PROFILE_OBSERVATION_ID_INVALID")
  if (!Array.isArray(input.attributes) || input.attributes.length < 1 ||
      input.attributes.length > MAXIMUM_ATTRIBUTES) fail("TARGET_PROFILE_ATTRIBUTES_INVALID")
  const normalizedAttributes = input.attributes.map((item) => {
    if (!item || !["PROVEN_ATTRIBUTE", "SUPPORTED_ATTRIBUTE",
      "INFERRED_ATTRIBUTE", "UNPROVEN_ATTRIBUTE"]
      .includes(item.attributeClassification) ||
        !["REQUIRED", "PREFERRED"].includes(item.requirement) ||
        !["EXACT_NORMALIZED", "TOKEN_SUBSET", "NUMERIC_EXACT"]
          .includes(item.matchMode)) fail("TARGET_PROFILE_ATTRIBUTE_CONTRACT_INVALID")
    return Object.freeze({
      key: text(item.key, "TARGET_PROFILE_ATTRIBUTE_KEY_INVALID", 80),
      expectedValue: text(item.expectedValue,
        "TARGET_PROFILE_ATTRIBUTE_VALUE_INVALID", 240),
      attributeClassification: item.attributeClassification,
      requirement: item.requirement,
      matchMode: item.matchMode,
      componentIdentityId: item.componentIdentityId === null ? null : exactId(
        item.componentIdentityId, COMPONENT_ID,
        "TARGET_PROFILE_ATTRIBUTE_COMPONENT_INVALID"),
      authority: targetAttributeAuthority(item.authority,
        item.attributeClassification),
    })
  }).sort((left, right) => [left.componentIdentityId ?? "", left.key]
    .join("\n").localeCompare([right.componentIdentityId ?? "", right.key]
      .join("\n"), "en-US"))
  const grains = normalizedAttributes.map((item) =>
    `${item.componentIdentityId ?? "CONFIGURATION"}:${normalizeComparable(item.key)}`)
  if (new Set(grains).size !== grains.length) fail("TARGET_PROFILE_ATTRIBUTE_DUPLICATE")
  const buyerIntentTerms = unique(input.buyerIntentTerms.map((term) =>
    text(term, "TARGET_PROFILE_BUYER_INTENT_INVALID", 120)))
  const profileDigest = digest({
    contractVersion: SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION,
    familyId, opportunityCaseId, currentMarketObservationId,
    attributes: normalizedAttributes, buyerIntentTerms,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION,
    familyId, opportunityCaseId, currentMarketObservationId,
    attributes: Object.freeze(normalizedAttributes),
    buyerIntentTerms: Object.freeze(buyerIntentTerms), profileDigest,
    authority: "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION",
  })
}

function attributeOutcome(
  item: SellerOsTargetProductAttributeV1,
  actualValue: string | undefined,
) {
  if (["INFERRED_ATTRIBUTE", "UNPROVEN_ATTRIBUTE"]
    .includes(item.attributeClassification)) return "UNPROVEN" as const
  if (actualValue === undefined) return "MISSING" as const
  const expected = normalizeComparable(item.expectedValue)
  const actual = normalizeComparable(actualValue)
  if (!actual) return "MISSING" as const
  if (item.matchMode === "NUMERIC_EXACT") {
    const expectedNumber = Number(expected)
    const actualNumber = Number(actual)
    return Number.isFinite(expectedNumber) && Number.isFinite(actualNumber) &&
        expectedNumber === actualNumber ? "MATCH" as const : "CONFLICT" as const
  }
  if (item.matchMode === "TOKEN_SUBSET") {
    const actualTokens = new Set(actual.split(" ").filter(Boolean))
    const expectedTokens = expected.split(" ").filter(Boolean)
    return expectedTokens.length > 0 && expectedTokens.every((token) =>
      actualTokens.has(token)) ? "MATCH" as const : "CONFLICT" as const
  }
  return expected === actual ? "MATCH" as const : "CONFLICT" as const
}

export function buildSellerOsLunaProductFitReceiptV1(input: Readonly<{
  launchCandidateId: string
  configurationIdentity: string
  targetProfile: SellerOsTargetProductProfileWithAuthorityV1
  components: readonly SellerOsResolvedLunaIdentityComponentV1[]
  evaluatedAt: string
}>) : SellerOsLunaProductFitReceiptV1 {
  const launchCandidateId = exactId(input.launchCandidateId, CANDIDATE_ID,
    "PRODUCT_FIT_CANDIDATE_ID_INVALID")
  const configurationIdentity = exactId(input.configurationIdentity, CONFIGURATION_ID,
    "PRODUCT_FIT_CONFIGURATION_ID_INVALID")
  const evaluatedAt = timestamp(input.evaluatedAt, "PRODUCT_FIT_EVALUATED_AT_INVALID")
  const suppliedProfile = input.targetProfile
  if (!suppliedProfile || suppliedProfile.contractVersion !==
      SELLER_OS_PRELINKED_TARGET_PRODUCT_PROFILE_VERSION ||
      suppliedProfile.authority !==
        "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION" ||
      !SHA256.test(suppliedProfile.profileDigest)) {
    fail("PRODUCT_FIT_TARGET_PROFILE_INVALID")
  }
  // Rebuild the complete profile from its authoritative inputs. A structurally
  // plausible object cannot smuggle a caller-selected profile digest into fit.
  const profile = buildSellerOsTargetProductProfileWithAuthorityV1({
    familyId: suppliedProfile.familyId,
    opportunityCaseId: suppliedProfile.opportunityCaseId,
    currentMarketObservationId: suppliedProfile.currentMarketObservationId,
    attributes: suppliedProfile.attributes,
    buyerIntentTerms: suppliedProfile.buyerIntentTerms,
  })
  if (profile.profileDigest !== suppliedProfile.profileDigest) {
    fail("PRODUCT_FIT_TARGET_PROFILE_DIGEST_MISMATCH")
  }
  if (!Array.isArray(input.components) || input.components.length < 1 ||
      input.components.length > MAXIMUM_COMPONENTS) fail("PRODUCT_FIT_COMPONENTS_INVALID")
  const normalizedComponents = input.components.map((component) => {
    const componentIdentityId = exactId(component.componentIdentityId, COMPONENT_ID,
      "PRODUCT_FIT_COMPONENT_ID_INVALID")
    if (component.targetResolutionAuthority !==
        "SERVER_RESOLVED_CANONICAL_LUNA_CATALOG") {
      fail("PRODUCT_FIT_SERVER_RESOLVED_TARGET_REQUIRED")
    }
    if (!LUNA_HOSTS.has(component.canonicalSourceHost)) {
      fail("PRODUCT_FIT_CANONICAL_LUNA_HOST_REQUIRED")
    }
    const expected = Object.freeze({
      lunaProductId: exactId(component.expected.lunaProductId, LUNA_ID,
        "PRODUCT_FIT_EXPECTED_PRODUCT_ID_INVALID"),
      lunaVariantId: exactId(component.expected.lunaVariantId, LUNA_ID,
        "PRODUCT_FIT_EXPECTED_VARIANT_ID_INVALID"),
      lunaSku: text(component.expected.lunaSku, "PRODUCT_FIT_EXPECTED_SKU_INVALID", 120),
      supplierQuantityRequired: positiveInteger(
        component.expected.supplierQuantityRequired,
        "PRODUCT_FIT_SUPPLIER_QUANTITY_INVALID", 10_000),
    })
    if (!["AVAILABLE", "UNAVAILABLE", "FAILED"].includes(
      component.observed.sourceStatus)) fail("PRODUCT_FIT_SOURCE_STATUS_INVALID")
    const observed = Object.freeze({
      sourceStatus: component.observed.sourceStatus,
      lunaProductId: component.observed.lunaProductId === null ? null : exactId(
        component.observed.lunaProductId, LUNA_ID,
        "PRODUCT_FIT_OBSERVED_PRODUCT_ID_INVALID"),
      lunaVariantId: component.observed.lunaVariantId === null ? null : exactId(
        component.observed.lunaVariantId, LUNA_ID,
        "PRODUCT_FIT_OBSERVED_VARIANT_ID_INVALID"),
      lunaSku: component.observed.lunaSku === null ? null : text(
        component.observed.lunaSku, "PRODUCT_FIT_OBSERVED_SKU_INVALID", 120),
      structuredAttributes: attributes(component.observed.structuredAttributes,
        "PRODUCT_FIT_OBSERVED_ATTRIBUTES"),
    })
    return Object.freeze({ componentIdentityId, expected, observed,
      targetResolutionAuthority: component.targetResolutionAuthority,
      canonicalSourceHost: component.canonicalSourceHost,
      evidence: evidenceAuthority(component.evidence, "PRODUCT_FIT_IDENTITY") })
  }).sort((left, right) => left.componentIdentityId.localeCompare(
    right.componentIdentityId, "en-US"))
  if (new Set(normalizedComponents.map((item) => item.componentIdentityId)).size !==
      normalizedComponents.length) fail("PRODUCT_FIT_COMPONENT_DUPLICATE")

  const blockers: string[] = []
  const componentResults = normalizedComponents.map((component) => {
    const fresh = isFresh(component.evidence, evaluatedAt)
    const exactProductId = component.observed.lunaProductId ===
      component.expected.lunaProductId
    const exactVariantId = component.observed.lunaVariantId ===
      component.expected.lunaVariantId
    const exactSku = component.observed.lunaSku === component.expected.lunaSku
    if (component.observed.sourceStatus !== "AVAILABLE") {
      blockers.push("LUNA_IDENTITY_SOURCE_UNAVAILABLE")
    } else if (!fresh) blockers.push("LUNA_IDENTITY_EVIDENCE_STALE")
    if (component.observed.sourceStatus === "AVAILABLE" &&
        component.observed.lunaProductId !== null && !exactProductId) {
      blockers.push("LUNA_PRODUCT_ID_CONFLICT")
    }
    if (component.observed.sourceStatus === "AVAILABLE" &&
        component.observed.lunaVariantId !== null && !exactVariantId) {
      blockers.push("LUNA_VARIANT_ID_CONFLICT")
    }
    if (component.observed.sourceStatus === "AVAILABLE" &&
        component.observed.lunaSku !== null && !exactSku) {
      blockers.push("LUNA_SKU_CONFLICT")
    }
    if (!exactProductId || !exactVariantId || !exactSku) {
      blockers.push("EXACT_LUNA_IDENTITY_UNPROVEN")
    }
    return Object.freeze({
      componentIdentityId: component.componentIdentityId,
      exactProductId, exactVariantId, exactSku, fresh,
      evidenceReference: component.evidence.reference,
      evidenceDigest: component.evidence.evidenceDigest,
    })
  })

  const attributeResults = profile.attributes.map((item) => {
    const authorityFresh = isFresh(item.authority, evaluatedAt)
    let component: typeof normalizedComponents[number] | undefined
    if (item.componentIdentityId !== null) {
      component = normalizedComponents.find((candidate) =>
        candidate.componentIdentityId === item.componentIdentityId)
    } else if (normalizedComponents.length === 1) component = normalizedComponents[0]
    const outcome = !authorityFresh || !component ? "UNPROVEN" as const
      : attributeOutcome(item, component.observed.structuredAttributes[item.key])
    if (item.requirement === "REQUIRED") {
      if (outcome === "CONFLICT") blockers.push("REQUIRED_PRODUCT_ATTRIBUTE_CONFLICT")
      else if (outcome !== "MATCH") blockers.push("REQUIRED_PRODUCT_ATTRIBUTE_UNPROVEN")
    } else if (outcome !== "MATCH") blockers.push("PREFERRED_PRODUCT_ATTRIBUTE_UNPROVEN")
    if (!authorityFresh) blockers.push("TARGET_PROFILE_ATTRIBUTE_EVIDENCE_STALE")
    if (!component && normalizedComponents.length > 1 &&
        item.componentIdentityId === null) blockers.push("BOM_ATTRIBUTE_SCOPE_UNPROVEN")
    return Object.freeze({ key: item.key,
      componentIdentityId: item.componentIdentityId,
      attributeClassification: item.attributeClassification,
      requirement: item.requirement, outcome,
      authorityReference: item.authority.reference })
  })
  const uniqueBlockers = Object.freeze(unique(blockers))
  const exactIdentity = componentResults.every((component) =>
    component.exactProductId && component.exactVariantId && component.exactSku &&
    component.fresh) && normalizedComponents.every((component) =>
      component.observed.sourceStatus === "AVAILABLE")
  const identityConflict = uniqueBlockers.some((item) => [
    "LUNA_PRODUCT_ID_CONFLICT", "LUNA_VARIANT_ID_CONFLICT", "LUNA_SKU_CONFLICT",
  ].includes(item))
  const requiredConflict = attributeResults.some((item) =>
    item.requirement === "REQUIRED" && item.outcome === "CONFLICT")
  const requiredUnproven = attributeResults.some((item) =>
    item.requirement === "REQUIRED" && item.outcome !== "MATCH")
  const preferredUnproven = attributeResults.some((item) =>
    item.requirement === "PREFERRED" && item.outcome !== "MATCH")
  const productFit: SellerOsProductFitV1 = identityConflict || requiredConflict
    ? "WEAK" : !exactIdentity || requiredUnproven ? "UNPROVEN"
      : preferredUnproven ? "MEDIUM" : "STRONG"
  const evidenceReferences = unique([
    ...normalizedComponents.map((item) => item.evidence.reference),
    ...profile.attributes.map((item) => item.authority.reference),
  ])
  const receiptBody = {
    contractVersion: SELLER_OS_PRELINKED_LUNA_PRODUCT_FIT_RECEIPT_VERSION,
    launchCandidateId, configurationIdentity, familyId: profile.familyId,
    opportunityCaseId: profile.opportunityCaseId,
    currentMarketObservationId: profile.currentMarketObservationId,
    targetProfileDigest: profile.profileDigest, exactIdentity, productFit,
    componentResults, attributeResults, hardBlockers: uniqueBlockers,
    evidenceReferences, evaluatedAt,
  }
  return Object.freeze({ ...receiptBody, receiptDigest: digest(receiptBody),
    rawSourceIncluded: false, stockFactsUsed: false,
    titleSimilarityUsed: false })
}

export function evaluateSellerOsCompetitionGateV1(input: Readonly<{
  targetProfile: SellerOsTargetProductProfileWithAuthorityV1
  familyId: string
  currentMarketObservationId: string
  familyDemandStatus: SellerOsCompetitionGateV1["familyDemandStatus"]
  sourceStatus: "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  competitionState: SellerOsCompetitionGateV1["competitionState"]
  activeComparableCount: number | null
  sellerDiversity: number | null
  evidence: SellerOsBoundedEvidenceAuthorityV1
  evaluatedAt: string
}>) : SellerOsCompetitionGateV1 {
  const evaluatedAt = timestamp(input.evaluatedAt,
    "COMPETITION_EVALUATED_AT_INVALID")
  if (input.familyId !== input.targetProfile.familyId ||
      input.currentMarketObservationId !==
        input.targetProfile.currentMarketObservationId) {
    fail("COMPETITION_TARGET_PROFILE_BINDING_INVALID")
  }
  if (!["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED",
    "FAMILY_DEMAND_UNPROVEN", "FAMILY_DEMAND_UNAVAILABLE"]
    .includes(input.familyDemandStatus)) fail("COMPETITION_DEMAND_STATUS_INVALID")
  if (!["AVAILABLE", "UNAVAILABLE", "FAILED"].includes(input.sourceStatus) ||
      !["LOW", "MODERATE", "HIGH", "SATURATING", "UNPROVEN"]
        .includes(input.competitionState)) fail("COMPETITION_STATE_INVALID")
  const evidence = evidenceAuthority(input.evidence, "COMPETITION")
  const activeComparableCount = input.activeComparableCount === null ? null
    : nonNegativeInteger(input.activeComparableCount,
      "COMPETITION_ACTIVE_COUNT_INVALID")
  const sellerDiversity = input.sellerDiversity === null ? null
    : nonNegativeInteger(input.sellerDiversity,
      "COMPETITION_SELLER_DIVERSITY_INVALID")
  const blockers: string[] = []
  let gate: SellerOsCompetitionGateV1["gate"] = "PASS"
  const competitionClassification:
    SellerOsCompetitionGateV1["competitionClassification"] =
    input.competitionState === "LOW" ? "FAVORABLE"
      : input.competitionState === "MODERATE" ? "ACCEPTABLE"
        : ["HIGH", "SATURATING"].includes(input.competitionState)
          ? "DIFFICULT" : "UNPROVEN"
  if (input.sourceStatus !== "AVAILABLE") {
    gate = "UNPROVEN"; blockers.push("COMPETITION_SOURCE_UNAVAILABLE")
  } else if (!isFresh(evidence, evaluatedAt)) {
    gate = "UNPROVEN"; blockers.push("COMPETITION_EVIDENCE_STALE")
  } else if (input.competitionState === "UNPROVEN" ||
      activeComparableCount === null) {
    gate = "UNPROVEN"; blockers.push("COMPETITION_EVIDENCE_UNPROVEN")
  } else if (competitionClassification === "DIFFICULT") {
    gate = "BLOCKED"; blockers.push("COMPETITION_DIFFICULT")
    if (input.competitionState === "SATURATING") {
      blockers.push("COMPETITION_SATURATING")
    } else blockers.push("COMPETITION_HIGH")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_COMPETITION_GATE_VERSION,
    familyId: input.familyId,
    currentMarketObservationId: input.currentMarketObservationId,
    targetProfileDigest: input.targetProfile.profileDigest,
    familyDemandStatus: input.familyDemandStatus,
    competitionState: input.competitionState,
    competitionClassification,
    activeComparableCount, sellerDiversity, gate,
    blockerCodes: Object.freeze(unique(blockers)),
    evidenceReference: evidence.reference,
    evidenceDigest: evidence.evidenceDigest, evaluatedAt,
  })
}

export function buildSellerOsProvisionalEconomicsReceiptV1(input: Readonly<{
  launchCandidateId: string
  configurationIdentity: string
  sourceStatus: "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  salePrice: number | null
  componentCosts: readonly Readonly<{
    componentIdentityId: string
    unitCostUsd: number | null
    supplierQuantityRequired: number
  }>[]
  outboundShippingCostUsd: number | null
  evidence: SellerOsBoundedEvidenceAuthorityV1
  evaluatedAt: string
  economicsConfig?: Partial<EbayUnitEconomicsConfig>
}>) : SellerOsProvisionalEconomicsReceiptV1 {
  const launchCandidateId = exactId(input.launchCandidateId, CANDIDATE_ID,
    "ECONOMICS_CANDIDATE_ID_INVALID")
  const configurationIdentity = exactId(input.configurationIdentity,
    CONFIGURATION_ID, "ECONOMICS_CONFIGURATION_ID_INVALID")
  const evaluatedAt = timestamp(input.evaluatedAt, "ECONOMICS_EVALUATED_AT_INVALID")
  const evidence = evidenceAuthority(input.evidence, "ECONOMICS")
  if (!["AVAILABLE", "UNAVAILABLE", "FAILED"].includes(input.sourceStatus)) {
    fail("ECONOMICS_SOURCE_STATUS_INVALID")
  }
  if (!Array.isArray(input.componentCosts) || input.componentCosts.length < 1 ||
      input.componentCosts.length > MAXIMUM_COMPONENTS) {
    fail("ECONOMICS_COMPONENT_COSTS_INVALID")
  }
  const costs = input.componentCosts.map((component) => ({
    componentIdentityId: exactId(component.componentIdentityId, COMPONENT_ID,
      "ECONOMICS_COMPONENT_ID_INVALID"),
    unitCostUsd: finiteNonNegative(component.unitCostUsd),
    supplierQuantityRequired: positiveInteger(component.supplierQuantityRequired,
      "ECONOMICS_COMPONENT_QUANTITY_INVALID", 10_000),
  }))
  if (new Set(costs.map((item) => item.componentIdentityId)).size !== costs.length) {
    fail("ECONOMICS_COMPONENT_DUPLICATE")
  }
  const salePrice = finitePositive(input.salePrice)
  const outboundShippingCost = finiteNonNegative(input.outboundShippingCostUsd)
  const blockers: string[] = []
  if (input.sourceStatus !== "AVAILABLE") blockers.push("ECONOMICS_SOURCE_UNAVAILABLE")
  if (!isFresh(evidence, evaluatedAt)) blockers.push("ECONOMICS_EVIDENCE_STALE")
  if (salePrice === null) blockers.push("SALE_PRICE_UNPROVEN")
  if (costs.some((item) => item.unitCostUsd === null)) {
    blockers.push("SUPPLIER_COST_UNPROVEN")
  }
  // Null/unknown shipping is rejected before the canonical calculator. It is
  // never allowed to pass through Number(null) or a zero/default fallback.
  if (outboundShippingCost === null) blockers.push("OUTBOUND_SHIPPING_COST_UNPROVEN")
  const supplierProductCost = costs.every((item) => item.unitCostUsd !== null)
    ? Number(costs.reduce((total, item) => total +
      Number(item.unitCostUsd) * item.supplierQuantityRequired, 0).toFixed(2))
    : null
  if (blockers.length) return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_VERSION,
    launchCandidateId, configurationIdentity,
    status: "ECONOMICS_UNPROVEN", salePrice,
    supplierProductCost, outboundShippingCost,
    estimatedFeesAndReserves: null, estimatedNetProfit: null,
    estimatedNetMarginPercent: null,
    blockerCodes: Object.freeze(unique(blockers)),
    evidenceReference: evidence.reference,
    evidenceDigest: evidence.evidenceDigest, evaluatedAt,
    phase6AuthorityClaimed: false, unknownShippingTreatedAsZero: false,
  })
  const result = calculateEbayUnitEconomics({ salePrice,
    supplierCost: supplierProductCost }, {
    ...(input.economicsConfig ?? {}),
    estimatedOutboundShipping: outboundShippingCost!,
  })
  const estimatedFeesAndReserves = result.ready ? Number((
    Number(result.estimatedEbayFees) + Number(result.returnsReserve) +
    Number(result.promotedListingsReserve)).toFixed(2)) : null
  const status = result.ready && result.passesProfitGate
    ? "ECONOMICS_PROVISIONAL_PASS" as const
    : "ECONOMICS_PROVISIONAL_FAIL" as const
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_VERSION,
    launchCandidateId, configurationIdentity, status,
    salePrice: result.salePrice,
    supplierProductCost: result.supplierCost,
    outboundShippingCost: result.estimatedOutboundShipping,
    estimatedFeesAndReserves,
    estimatedNetProfit: result.estimatedNetProfit,
    estimatedNetMarginPercent: result.estimatedNetMarginPercent,
    blockerCodes: Object.freeze(status === "ECONOMICS_PROVISIONAL_PASS"
      ? [] : ["ECONOMICS_PROVISIONAL_MINIMUMS_FAILED"]),
    evidenceReference: evidence.reference,
    evidenceDigest: evidence.evidenceDigest, evaluatedAt,
    phase6AuthorityClaimed: false, unknownShippingTreatedAsZero: false,
  })
}

export function buildSellerOsListingResearchReadinessV1(input: Readonly<{
  launchCandidateId: string
  configurationIdentity: string
  sourceStatus: "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  productFactsComplete: boolean
  authorizedAssetsAvailable: boolean
  categoryResolved: boolean
  requiredAspectsComplete: boolean
  policyBlockers: readonly string[]
  evidence: SellerOsBoundedEvidenceAuthorityV1
  evaluatedAt: string
}>) : SellerOsListingResearchReadinessV1 {
  const launchCandidateId = exactId(input.launchCandidateId, CANDIDATE_ID,
    "LISTING_READINESS_CANDIDATE_ID_INVALID")
  const configurationIdentity = exactId(input.configurationIdentity,
    CONFIGURATION_ID, "LISTING_READINESS_CONFIGURATION_ID_INVALID")
  const evaluatedAt = timestamp(input.evaluatedAt,
    "LISTING_READINESS_EVALUATED_AT_INVALID")
  const evidence = evidenceAuthority(input.evidence, "LISTING_READINESS")
  const blockers = input.policyBlockers.map((item) => code(item,
    "LISTING_READINESS_POLICY_BLOCKER_INVALID"))
  let status: SellerOsListingResearchReadinessV1["status"] = "PASS"
  if (input.sourceStatus !== "AVAILABLE" || !isFresh(evidence, evaluatedAt)) {
    status = "UNPROVEN"
    blockers.push(input.sourceStatus === "AVAILABLE"
      ? "LISTING_READINESS_EVIDENCE_STALE" : "LISTING_READINESS_SOURCE_UNAVAILABLE")
  }
  if (!input.productFactsComplete) blockers.push("PRODUCT_FACTS_INCOMPLETE")
  if (!input.authorizedAssetsAvailable) blockers.push("AUTHORIZED_ASSETS_UNAVAILABLE")
  if (!input.categoryResolved) blockers.push("CATEGORY_UNRESOLVED")
  if (!input.requiredAspectsComplete) blockers.push("REQUIRED_ASPECTS_INCOMPLETE")
  if (status !== "UNPROVEN" && blockers.length) status = "BLOCKED"
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_LISTING_RESEARCH_READINESS_VERSION,
    launchCandidateId, configurationIdentity, status,
    blockerCodes: Object.freeze(unique(blockers)),
    evidenceReference: evidence.reference,
    evidenceDigest: evidence.evidenceDigest, evaluatedAt,
  })
}

export function evaluateSellerOsI02uFinalistGateV1(input: Readonly<{
  productFit: SellerOsLunaProductFitReceiptV1
  competition: SellerOsCompetitionGateV1
  economics: SellerOsProvisionalEconomicsReceiptV1
  listingReadiness: SellerOsListingResearchReadinessV1
  supplyStatus:
    | "SUPPLY_IDENTITY_READY"
    | "SUPPLY_EVIDENCE_AVAILABLE"
    | "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED"
    | "SUPPLY_BLOCKED"
    | "SUPPLY_UNPROVEN"
  complianceStatus: "PASS" | "BLOCKED" | "UNPROVEN"
  exactProductDemandStatus: "PROVEN" | "SUPPORTED" | "UNPROVEN" | "UNAVAILABLE"
  liveSkuCollision: boolean
  configurationConflict: boolean
  bomConflict: boolean
  policyBlockers: readonly string[]
  scoreInputs: Readonly<{
    familyDemandQuality: number
    productFit: number
    pricePositioning: number
    competition: number
    economics: number
    evidenceFreshness: number
    listingReadiness: number
    visualAssetReadiness: number
  }>
  evaluatedAt: string
}>) : SellerOsI02uFinalistEvaluationV1 {
  const fit = input.productFit
  const competition = input.competition
  const economics = input.economics
  const listing = input.listingReadiness
  const evaluatedAt = timestamp(input.evaluatedAt, "FINALIST_EVALUATED_AT_INVALID")
  if (fit.contractVersion !==
      SELLER_OS_PRELINKED_LUNA_PRODUCT_FIT_RECEIPT_VERSION ||
      competition.contractVersion !== SELLER_OS_PRELINKED_COMPETITION_GATE_VERSION ||
      economics.contractVersion !== SELLER_OS_PRELINKED_PROVISIONAL_ECONOMICS_VERSION ||
      listing.contractVersion !==
        SELLER_OS_PRELINKED_LISTING_RESEARCH_READINESS_VERSION ||
      !SHA256.test(fit.receiptDigest) ||
      !SHA256.test(competition.evidenceDigest) ||
      !SHA256.test(economics.evidenceDigest) ||
      !SHA256.test(listing.evidenceDigest)) {
    fail("FINALIST_EVIDENCE_CONTRACT_INVALID")
  }
  // All receipts are evaluated against one server-owned clock boundary. This
  // prevents a once-STRONG receipt from being replayed after its source TTL.
  if ([fit.evaluatedAt, competition.evaluatedAt, economics.evaluatedAt,
    listing.evaluatedAt].some((value) => value !== evaluatedAt)) {
    fail("FINALIST_EVIDENCE_TIME_BINDING_INVALID")
  }
  if (fit.launchCandidateId !== economics.launchCandidateId ||
      fit.launchCandidateId !== listing.launchCandidateId ||
      fit.configurationIdentity !== economics.configurationIdentity ||
      fit.configurationIdentity !== listing.configurationIdentity) {
    fail("FINALIST_CANDIDATE_EVIDENCE_BINDING_INVALID")
  }
  if (fit.familyId !== competition.familyId ||
      fit.currentMarketObservationId !== competition.currentMarketObservationId ||
      fit.targetProfileDigest !== competition.targetProfileDigest) {
    fail("FINALIST_MARKET_EVIDENCE_BINDING_INVALID")
  }
  if (!["PASS", "BLOCKED", "UNPROVEN"].includes(input.complianceStatus)) {
    fail("FINALIST_COMPLIANCE_STATUS_INVALID")
  }
  if (!["PROVEN", "SUPPORTED", "UNPROVEN", "UNAVAILABLE"]
    .includes(input.exactProductDemandStatus)) {
    fail("FINALIST_EXACT_PRODUCT_DEMAND_STATUS_INVALID")
  }
  if (typeof input.liveSkuCollision !== "boolean" ||
      typeof input.configurationConflict !== "boolean" ||
      typeof input.bomConflict !== "boolean" ||
      !Array.isArray(input.policyBlockers)) {
    fail("FINALIST_SERVER_GUARDS_INVALID")
  }
  const policyBlockers = input.policyBlockers.map((item) =>
    code(item, "FINALIST_POLICY_BLOCKER_INVALID"))
  const blockers: string[] = []
  if (!["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
    .includes(competition.familyDemandStatus)) blockers.push("FAMILY_DEMAND_GATE_NOT_PROVEN")
  if (fit.productFit !== "STRONG") blockers.push("PRODUCT_FIT_GATE_NOT_PROVEN")
  blockers.push(...fit.hardBlockers)
  if (competition.gate === "BLOCKED") blockers.push("COMPETITION_GATE_BLOCKED")
  else if (competition.gate !== "PASS") blockers.push("COMPETITION_GATE_UNPROVEN")
  blockers.push(...competition.blockerCodes)
  if (economics.status === "ECONOMICS_PROVISIONAL_FAIL") {
    blockers.push("ECONOMICS_PROVISIONAL_FAILED")
  } else if (economics.status !== "ECONOMICS_PROVISIONAL_PASS") {
    blockers.push("ECONOMICS_GATE_UNPROVEN")
  }
  blockers.push(...economics.blockerCodes)
  if (listing.status === "BLOCKED") blockers.push("LISTING_RESEARCH_READINESS_BLOCKED")
  else if (listing.status !== "PASS") blockers.push("LISTING_RESEARCH_READINESS_UNPROVEN")
  blockers.push(...listing.blockerCodes)
  if (!["SUPPLY_IDENTITY_READY", "SUPPLY_EVIDENCE_AVAILABLE",
    "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED"].includes(input.supplyStatus)) {
    blockers.push("SUPPLY_IDENTITY_NOT_READY")
  }
  if (input.complianceStatus === "BLOCKED") blockers.push("COMPLIANCE_GATE_BLOCKED")
  else if (input.complianceStatus !== "PASS") {
    blockers.push("COMPLIANCE_GATE_UNPROVEN")
  }
  if (input.liveSkuCollision) blockers.push("LIVE_SKU_COLLISION")
  if (input.configurationConflict) blockers.push("CONFIGURATION_CONFLICT")
  if (input.bomConflict) blockers.push("BOM_CONFLICT")
  if (policyBlockers.length) blockers.push("POLICY_BLOCKER_PRESENT", ...policyBlockers)
  const hardBlockers = Object.freeze(unique(blockers))
  const ready = hardBlockers.length === 0
  let launchScore: number | null = null
  if (ready) {
    const values = input.scoreInputs
    for (const [key, value] of Object.entries(values)) {
      boundedScore(value, `FINALIST_SCORE_${key.toUpperCase()}_INVALID`)
    }
    launchScore = Number((values.familyDemandQuality * .22 +
      values.productFit * .20 + values.pricePositioning * .10 +
      values.competition * .10 + values.economics * .16 +
      values.evidenceFreshness * .08 + values.listingReadiness * .08 +
      values.visualAssetReadiness * .06).toFixed(2))
  }
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_FINALIST_GATE_VERSION,
    launchCandidateId: fit.launchCandidateId,
    configurationIdentity: fit.configurationIdentity,
    familyId: fit.familyId, opportunityCaseId: fit.opportunityCaseId,
    currentMarketObservationId: fit.currentMarketObservationId,
    targetProfileDigest: fit.targetProfileDigest,
    complianceStatus: input.complianceStatus,
    exactProductDemandStatus: input.exactProductDemandStatus,
    commercialLabel: "TEST_LAUNCH_CANDIDATE",
    provenWinnerClaimed: false,
    launchClassification: ready ? "READY_FOR_TEST_LAUNCH"
      : "NOT_READY_TO_TEST_LAUNCH",
    launchScore, scoreVersion: ready ? "SELLER_OS_LAUNCH_SCORE_V1" : null,
    hardBlockers,
    prePublishRequirements: Object.freeze([
      "CANONICAL_PRE_PUBLISH_SUPPLY_CONFIRMATION",
      "HUMAN_LISTING_PACKAGE_APPROVAL",
      "P2_LINKAGE_AFTER_EBAY_ITEM_ID",
    ]),
    productFitReceiptDigest: fit.receiptDigest,
    competitionEvidenceDigest: competition.evidenceDigest,
    economicsEvidenceDigest: economics.evidenceDigest,
    listingReadinessEvidenceDigest: listing.evidenceDigest,
    evaluatedAt, publishAllowed: false, marketplaceWriteAllowed: false,
    p2MutationAllowed: false, scoreCanOverrideHardBlocker: false,
  })
}

export function selectSellerOsI02uFirstListingBuildCandidateV1(
  evaluations: readonly SellerOsI02uFinalistEvaluationV1[],
) {
  const byCandidate = new Map<string, SellerOsI02uFinalistEvaluationV1>()
  for (const evaluation of evaluations) {
    if (evaluation.contractVersion !== SELLER_OS_PRELINKED_FINALIST_GATE_VERSION ||
        !CANDIDATE_ID.test(evaluation.launchCandidateId) ||
        !CONFIGURATION_ID.test(evaluation.configurationIdentity) ||
        !SHA256.test(evaluation.productFitReceiptDigest) ||
        !["PROVEN", "SUPPORTED", "UNPROVEN", "UNAVAILABLE"]
          .includes(evaluation.exactProductDemandStatus) ||
        evaluation.commercialLabel !== "TEST_LAUNCH_CANDIDATE" ||
        evaluation.provenWinnerClaimed !== false ||
        evaluation.publishAllowed !== false ||
        evaluation.marketplaceWriteAllowed !== false ||
        evaluation.p2MutationAllowed !== false ||
        evaluation.scoreCanOverrideHardBlocker !== false) {
      fail("FINALIST_SELECTION_CONTRACT_INVALID")
    }
    const existing = byCandidate.get(evaluation.launchCandidateId)
    if (existing && existing.productFitReceiptDigest !==
        evaluation.productFitReceiptDigest) fail("FINALIST_DUPLICATE_CONFLICT")
    if (!existing || Date.parse(evaluation.evaluatedAt) >
        Date.parse(existing.evaluatedAt)) byCandidate.set(evaluation.launchCandidateId,
      evaluation)
  }
  const ready = [...byCandidate.values()].filter((evaluation) =>
    evaluation.launchClassification === "READY_FOR_TEST_LAUNCH" &&
    evaluation.hardBlockers.length === 0 && evaluation.launchScore !== null)
    .sort((left, right) => Number(right.launchScore) - Number(left.launchScore) ||
      left.launchCandidateId.localeCompare(right.launchCandidateId, "en-US"))
  return Object.freeze({
    contractVersion: "SELLER_OS_I02U_FIRST_LISTING_BUILD_SELECTION_V1" as const,
    eligibleCount: ready.length,
    selectedCount: ready.length ? 1 as const : 0 as const,
    firstListingBuildCandidate: ready[0] ?? null,
    atMostOneSelected: true as const,
  })
}

type CanaryReceipt = Readonly<{ outcome: "CREATED" | "IDEMPOTENT_SUCCESS" }>
export type SellerOsI02uFinalistCanaryTransactionV1 = Readonly<{
  stageEvidencePackage: (
    finalist: SellerOsI02uFinalistEvaluationV1,
  ) => Promise<CanaryReceipt>
  stageLaunchCandidate: (
    finalist: SellerOsI02uFinalistEvaluationV1,
  ) => Promise<CanaryReceipt>
  stageFamilyEvaluation: (
    finalist: SellerOsI02uFinalistEvaluationV1,
  ) => Promise<CanaryReceipt>
  stageSkuReservation: (
    finalist: SellerOsI02uFinalistEvaluationV1,
  ) => Promise<CanaryReceipt>
  stageLineage: (
    finalist: SellerOsI02uFinalistEvaluationV1,
  ) => Promise<CanaryReceipt>
  rollback: () => Promise<void>
  commit?: () => Promise<void>
}>

function assertCanaryReceipt(value: CanaryReceipt) {
  if (!value || !["CREATED", "IDEMPOTENT_SUCCESS"].includes(value.outcome)) {
    fail("FINALIST_CANARY_RECEIPT_INVALID")
  }
}

export async function runSellerOsI02uTransactionalFinalistCanaryV1(input: Readonly<{
  finalist: SellerOsI02uFinalistEvaluationV1
  beginTransaction: () => Promise<SellerOsI02uFinalistCanaryTransactionV1>
}>) {
  const selection = selectSellerOsI02uFirstListingBuildCandidateV1([input.finalist])
  if (selection.selectedCount !== 1 ||
      input.finalist.launchClassification !== "READY_FOR_TEST_LAUNCH" ||
      input.finalist.hardBlockers.length || input.finalist.launchScore === null) {
    fail("FINALIST_CANARY_READY_GATE_REQUIRED")
  }
  const transaction = await input.beginTransaction()
  if (!transaction || typeof transaction.rollback !== "function") {
    fail("FINALIST_CANARY_TRANSACTION_INVALID")
  }
  let stagedOperationCount = 0
  let stageError: unknown = null
  try {
    for (const operation of [
      transaction.stageEvidencePackage,
      transaction.stageFamilyEvaluation,
      transaction.stageLaunchCandidate,
      transaction.stageSkuReservation,
      transaction.stageLineage,
    ]) {
      if (typeof operation !== "function") fail("FINALIST_CANARY_TRANSACTION_INVALID")
      assertCanaryReceipt(await operation(input.finalist))
      stagedOperationCount += 1
    }
  } catch (error) {
    stageError = error
  }
  try {
    await transaction.rollback()
  } catch {
    throw new Error("FINALIST_CANARY_ROLLBACK_FAILED")
  }
  if (stageError) throw new Error("FINALIST_CANARY_STAGE_FAILED")
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_FINALIST_CANARY_VERSION,
    launchCandidateId: input.finalist.launchCandidateId,
    stagedOperationCount,
    rolledBack: true as const,
    committed: false as const,
    commitInvoked: false as const,
    durableWrites: 0 as const,
    marketplaceWrites: 0 as const,
    p2Mutations: 0 as const,
  })
}
