import { createHash } from "node:crypto"

import {
  buildSellerOsTargetProductProfileV1,
  buildSellerOsMarketFamilyDefinitionVersionIdV1,
  buildSellerOsMarketFamilyIdV1,
  buildSellerOsOpportunityCaseIdV1,
  type SellerOsFamilyMarketObservationV1,
  type SellerOsMarketFamilyDefinitionV1,
  type SellerOsMarketFamilyIdentityV1,
} from "./ebay-prelinked-family-market-observation-v1"

export const SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_VERSION =
  "SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_V1" as const
export const SELLER_OS_LAUNCH_SCORE_VERSION =
  "SELLER_OS_LAUNCH_SCORE_V1" as const

const MAX_SHADOW_CANDIDATES = 20
const MAX_FAMILY_QUERIES = 8
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const NUMERIC_ID = /^[0-9]{1,30}$/

export type SellerOsFamilyDemandStatusV1 =
  | "FAMILY_DEMAND_PROVEN"
  | "FAMILY_DEMAND_SUPPORTED"
  | "FAMILY_DEMAND_UNPROVEN"
  | "FAMILY_DEMAND_UNAVAILABLE"

export type SellerOsExactProductDemandStatusV1 =
  | "EXACT_PRODUCT_DEMAND_PROVEN"
  | "EXACT_PRODUCT_DEMAND_SUPPORTED"
  | "EXACT_PRODUCT_DEMAND_UNPROVEN"
  | "EXACT_PRODUCT_DEMAND_UNAVAILABLE"

export type SellerOsProductFitV1 = "STRONG" | "MEDIUM" | "WEAK" | "UNPROVEN"
export type SellerOsProvisionalEconomicsStatusV1 =
  | "ECONOMICS_PROVISIONAL_PASS"
  | "ECONOMICS_PROVISIONAL_FAIL"
  | "ECONOMICS_UNPROVEN"
export type SellerOsFastLaneSupplyStatusV1 =
  | "SUPPLY_IDENTITY_READY"
  | "SUPPLY_EVIDENCE_AVAILABLE"
  | "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED"
  | "SUPPLY_BLOCKED"
  | "SUPPLY_UNPROVEN"

type EvidenceAuthority =
  | "OFFICIAL_EXTERNAL_FACT"
  | "DIRECT_OBSERVATION"
  | "DURABLY_PERSISTED_FACT"
  | "DERIVED_FACT"
  | "INFERENCE"
  | "UNPROVEN"
  | "UNAVAILABLE"

export type SellerOsFamilyMarketEvidenceV1 = Readonly<{
  familyId: string
  observationId: string
  upstreamEvidenceIdentity: string
  reference: string
  evidenceDigest: string
  sourceContractVersion: string
  authorityClass: EvidenceAuthority
  evidenceKind:
    | "CONFIRMED_SOLD"
    | "ACTIVE_LISTINGS"
    | "SEARCH_RESULT_COUNT"
    | "TITLE_FREQUENCY"
  subjectScope: "FAMILY" | "EXACT_PRODUCT"
  configurationId: string | null
  aggregationSemantics: "WINDOW_DELTA" | "CUMULATIVE_SNAPSHOT"
  sourceStatus: "AVAILABLE" | "UNAVAILABLE"
  observedAt: string
  maximumAgeSeconds: number
  comparableCount: number
  confirmedSoldUnits: number
  sellerCount: number | null
  medianBuyerPrice: number | null
}>

export type SellerOsLaunchFamilyDefinitionV1 = Readonly<{
  canonicalIdentity: SellerOsMarketFamilyIdentityV1
  familyName: SellerOsMarketFamilyDefinitionV1["familyName"]
  familyQuerySet: SellerOsMarketFamilyDefinitionV1["familyQuerySet"]
  keyProductAttributes: SellerOsMarketFamilyDefinitionV1["keyProductAttributes"]
  keyBuyerIntentTerms: SellerOsMarketFamilyDefinitionV1["keyBuyerIntentTerms"]
  adapterContract: string
  adapterVersion: string
  currentMarketObservation: SellerOsFamilyMarketObservationV1
  candidateIds: readonly string[]
  evidence: readonly SellerOsFamilyMarketEvidenceV1[]
}>

export type SellerOsLaunchCandidateInputV1 = Readonly<{
  launchCandidateId: string
  configurationId: string
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  configurationMode: "SINGLE_COMPONENT" | "SIMPLE_MULTIPLIER" | "MULTI_COMPONENT_BOM"
  supplierQuantityRequired: number | null
  componentCount: number
  componentIdentityComplete: boolean
  currentIdentity: Readonly<{
    sourceStatus: "AVAILABLE" | "UNAVAILABLE"
    observedAt: string | null
    maximumAgeSeconds: number
    exactProductId: boolean
    exactVariantId: boolean
    exactSku: boolean
    configurationComplete: boolean
    featureCoveragePercent: number | null
    conflictingRepresentation: boolean
  }>
  economics: Readonly<{
    sourceStatus: "AVAILABLE" | "UNAVAILABLE"
    calculatedAt: string | null
    maximumAgeSeconds: number
    salePrice: number | null
    supplierCost: number | null
    shippingCost: number | null
    feesAndReserves: number | null
    netProfit: number | null
    netMarginPercent: number | null
    passesMinimums: boolean | null
  }>
  listingReadiness: Readonly<{
    productFactsComplete: boolean
    authorizedAssetsAvailable: boolean
    categoryResolved: boolean
    requiredAspectsComplete: boolean
    policyBlockers: readonly string[]
  }>
  supplyStatus: SellerOsFastLaneSupplyStatusV1
  skuCollision: boolean
  configurationConflict: boolean
  variantConflict: boolean
  bomConflict: boolean
  scoreInputs: Readonly<{
    demandQuality: number
    productFit: number
    pricePositioning: number
    competition: number
    economics: number
    evidenceFreshness: number
    listingReadiness: number
    visualAssetReadiness: number
  }>
}>

function fail(code: string): never { throw new Error(code) }
function integer(value: number, code: string, minimum = 0, maximum = 1_000_000) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(code)
  return value
}
function score(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) fail(code)
  return value
}
function safeId(value: string, code: string) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(code)
  return value
}
function safeText(value: string, code: string, maximum = 240) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim() : ""
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}
function iso(value: string | null, code: string) {
  if (!value || !Number.isFinite(Date.parse(value))) fail(code)
  return new Date(value).toISOString()
}
function unique(values: readonly string[]) { return [...new Set(values)] }
function digest(lines: readonly string[]) {
  return `sha256:${createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")}`
}
function fresh(observedAt: string, maximumAgeSeconds: number, evaluatedAt: string) {
  const observed = Date.parse(observedAt)
  const evaluated = Date.parse(evaluatedAt)
  return Number.isFinite(observed) && Number.isFinite(evaluated) &&
    observed <= evaluated + 5 * 60_000 &&
    evaluated - observed <= maximumAgeSeconds * 1_000
}

export function buildSellerOsLaunchFamilyIdV1(input:
  SellerOsMarketFamilyIdentityV1 | SellerOsLaunchFamilyDefinitionV1) {
  return buildSellerOsMarketFamilyIdV1("canonicalIdentity" in input
    ? input.canonicalIdentity : input)
}

function normalizeEvidence(input: SellerOsFamilyMarketEvidenceV1) {
  if (!/^market-family-v1:sha256:[0-9a-f]{64}$/.test(input.familyId)) {
    fail("MARKET_EVIDENCE_FAMILY_ID_INVALID")
  }
  if (!/^family-market-observation-v1:sha256:[0-9a-f]{64}$/.test(
    input.observationId)) fail("MARKET_EVIDENCE_OBSERVATION_ID_INVALID")
  safeId(input.upstreamEvidenceIdentity,
    "MARKET_EVIDENCE_UPSTREAM_IDENTITY_INVALID")
  safeId(input.reference, "MARKET_EVIDENCE_REFERENCE_INVALID")
  if (!SHA256.test(input.evidenceDigest)) fail("MARKET_EVIDENCE_DIGEST_INVALID")
  safeId(input.sourceContractVersion, "MARKET_EVIDENCE_CONTRACT_INVALID")
  const observedAt = iso(input.observedAt, "MARKET_EVIDENCE_TIME_INVALID")
  const maximumAgeSeconds = integer(input.maximumAgeSeconds,
    "MARKET_EVIDENCE_MAXIMUM_AGE_INVALID", 60, 365 * 24 * 60 * 60)
  integer(input.comparableCount, "MARKET_COMPARABLE_COUNT_INVALID")
  integer(input.confirmedSoldUnits, "MARKET_SOLD_UNITS_INVALID")
  if (input.sellerCount !== null) integer(input.sellerCount,
    "MARKET_SELLER_COUNT_INVALID")
  if (input.medianBuyerPrice !== null &&
      (!Number.isFinite(input.medianBuyerPrice) || input.medianBuyerPrice < 0)) {
    fail("MARKET_PRICE_INVALID")
  }
  if (input.subjectScope === "EXACT_PRODUCT" &&
      (input.configurationId === null || !SAFE_ID.test(input.configurationId))) {
    fail("EXACT_PRODUCT_EVIDENCE_CONFIGURATION_REQUIRED")
  }
  if (input.subjectScope === "FAMILY" && input.configurationId !== null) {
    fail("FAMILY_EVIDENCE_CONFIGURATION_FORBIDDEN")
  }
  return Object.freeze({ ...input, observedAt, maximumAgeSeconds })
}

function demandClassification(
  evidence: readonly SellerOsFamilyMarketEvidenceV1[],
  evaluatedAt: string,
  subjectScope: "FAMILY" | "EXACT_PRODUCT",
  familyId: string,
  observationId: string,
  configurationId: string,
) {
  const normalized = evidence.map(normalizeEvidence)
  const foreign = normalized.find((item) => item.familyId !== familyId ||
    item.observationId !== observationId ||
    (item.subjectScope === "EXACT_PRODUCT" &&
      item.configurationId !== configurationId))
  if (foreign) fail("MARKET_EVIDENCE_SUBJECT_BINDING_MISMATCH")
  const byUpstream = new Map<string, SellerOsFamilyMarketEvidenceV1>()
  for (const item of normalized) {
    const previous = byUpstream.get(item.upstreamEvidenceIdentity)
    if (previous && previous.evidenceDigest !== item.evidenceDigest) {
      fail("MARKET_EVIDENCE_REPLAY_CONFLICT")
    }
    if (!previous) byUpstream.set(item.upstreamEvidenceIdentity, item)
  }
  const scoped = [...byUpstream.values()].filter((item) =>
    item.subjectScope === subjectScope)
  const officialSold = scoped.filter((item) =>
    item.evidenceKind === "CONFIRMED_SOLD" &&
    item.authorityClass === "OFFICIAL_EXTERNAL_FACT" &&
    item.sourceStatus === "AVAILABLE" &&
    fresh(item.observedAt, item.maximumAgeSeconds, evaluatedAt) &&
    item.comparableCount > 0 && item.confirmedSoldUnits > 0)
  const deltas = officialSold.filter((item) =>
    item.aggregationSemantics === "WINDOW_DELTA")
  const snapshots = officialSold.filter((item) =>
    item.aggregationSemantics === "CUMULATIVE_SNAPSHOT")
  const comparableCount = deltas.reduce((sum, item) =>
    sum + item.comparableCount, 0) + Math.max(0,
      ...snapshots.map((item) => item.comparableCount))
  const confirmedSoldUnits = deltas.reduce((sum, item) =>
    sum + item.confirmedSoldUnits, 0) + Math.max(0,
      ...snapshots.map((item) => item.confirmedSoldUnits))
  const sellerCounts = officialSold.flatMap((item) =>
    item.sellerCount === null ? [] : [item.sellerCount])
  const sellerCount = sellerCounts.length ? Math.max(...sellerCounts) : null
  const unavailable = scoped.length > 0 && scoped.every((item) =>
    item.sourceStatus === "UNAVAILABLE")
  const status = officialSold.length === 0
    ? unavailable ? "UNAVAILABLE" as const : "UNPROVEN" as const
    : comparableCount >= 5 && confirmedSoldUnits >= 10
      ? "PROVEN" as const : "SUPPORTED" as const
  return Object.freeze({ status, comparableCount, confirmedSoldUnits,
    sellerCount, evidenceReferences: Object.freeze(officialSold
      .map((item) => item.reference).sort()),
    evidenceSetDigest: digest(scoped.map((item) =>
      `${item.upstreamEvidenceIdentity}:${item.evidenceDigest}`).sort()),
    observedAt: officialSold.map((item) => item.observedAt).sort().at(-1) ?? null,
    activeListingsCannotProveDemand: true as const,
    searchResultCountCannotProveDemand: true as const,
    titleFrequencyCannotProveDemand: true as const })
}

export function classifySellerOsFamilyDemandV1(input: Readonly<{
  evidence: readonly SellerOsFamilyMarketEvidenceV1[]
  evaluatedAt: string
  familyId: string
  observationId: string
  configurationId: string
}>) {
  const evaluatedAt = iso(input.evaluatedAt, "DEMAND_EVALUATED_AT_INVALID")
  const family = demandClassification(input.evidence, evaluatedAt, "FAMILY",
    input.familyId, input.observationId, input.configurationId)
  const exact = demandClassification(input.evidence, evaluatedAt,
    "EXACT_PRODUCT", input.familyId, input.observationId,
    input.configurationId)
  const familyDemandStatus: SellerOsFamilyDemandStatusV1 =
    family.status === "PROVEN" ? "FAMILY_DEMAND_PROVEN"
      : family.status === "SUPPORTED" ? "FAMILY_DEMAND_SUPPORTED"
        : family.status === "UNAVAILABLE" ? "FAMILY_DEMAND_UNAVAILABLE"
          : "FAMILY_DEMAND_UNPROVEN"
  const exactProductDemandStatus: SellerOsExactProductDemandStatusV1 =
    exact.status === "PROVEN" ? "EXACT_PRODUCT_DEMAND_PROVEN"
      : exact.status === "SUPPORTED" ? "EXACT_PRODUCT_DEMAND_SUPPORTED"
        : exact.status === "UNAVAILABLE" ? "EXACT_PRODUCT_DEMAND_UNAVAILABLE"
          : "EXACT_PRODUCT_DEMAND_UNPROVEN"
  return Object.freeze({ familyDemandStatus, exactProductDemandStatus,
    family, exact })
}

function productFit(candidate: SellerOsLaunchCandidateInputV1,
  evaluatedAt: string): SellerOsProductFitV1 {
  const current = candidate.currentIdentity
  const identityFresh = current.sourceStatus === "AVAILABLE" &&
    current.observedAt !== null && fresh(iso(current.observedAt,
      "IDENTITY_OBSERVED_AT_INVALID"), integer(current.maximumAgeSeconds,
      "IDENTITY_MAXIMUM_AGE_INVALID", 60, 365 * 24 * 60 * 60), evaluatedAt)
  if (!identityFresh || !current.exactProductId || !current.exactVariantId ||
      !current.exactSku) return "UNPROVEN"
  if (current.conflictingRepresentation || candidate.configurationConflict ||
      candidate.variantConflict || candidate.bomConflict ||
      !candidate.componentIdentityComplete) return "WEAK"
  if (!current.configurationComplete || current.featureCoveragePercent === null) {
    return "MEDIUM"
  }
  return score(current.featureCoveragePercent, "FEATURE_COVERAGE_INVALID") >= 70
    ? "STRONG" : "MEDIUM"
}

function economics(candidate: SellerOsLaunchCandidateInputV1,
  evaluatedAt: string): SellerOsProvisionalEconomicsStatusV1 {
  const value = candidate.economics
  if (value.sourceStatus !== "AVAILABLE" || value.calculatedAt === null ||
      !fresh(iso(value.calculatedAt, "ECONOMICS_CALCULATED_AT_INVALID"),
        integer(value.maximumAgeSeconds, "ECONOMICS_MAXIMUM_AGE_INVALID",
          60, 365 * 24 * 60 * 60), evaluatedAt)) return "ECONOMICS_UNPROVEN"
  const numbers = [value.salePrice, value.supplierCost, value.shippingCost,
    value.feesAndReserves, value.netProfit, value.netMarginPercent]
  if (numbers.some((item) => item === null || !Number.isFinite(item))) {
    return "ECONOMICS_UNPROVEN"
  }
  return value.passesMinimums === true && (value.netProfit ?? 0) > 0 &&
    (value.netMarginPercent ?? 0) > 0
    ? "ECONOMICS_PROVISIONAL_PASS" : "ECONOMICS_PROVISIONAL_FAIL"
}

function listingReady(candidate: SellerOsLaunchCandidateInputV1) {
  const value = candidate.listingReadiness
  return value.productFactsComplete && value.authorizedAssetsAvailable &&
    value.categoryResolved && value.requiredAspectsComplete &&
    value.policyBlockers.length === 0
}

function launchScore(input: SellerOsLaunchCandidateInputV1) {
  const values = input.scoreInputs
  for (const [key, value] of Object.entries(values)) score(value,
    `LAUNCH_SCORE_${key.toUpperCase()}_INVALID`)
  return Number((values.demandQuality * 0.22 + values.productFit * 0.20 +
    values.pricePositioning * 0.10 + values.competition * 0.10 +
    values.economics * 0.16 + values.evidenceFreshness * 0.08 +
    values.listingReadiness * 0.08 + values.visualAssetReadiness * 0.06)
    .toFixed(2))
}

export function evaluateSellerOsFamilyLaunchCandidateV1(input: Readonly<{
  family: SellerOsLaunchFamilyDefinitionV1
  candidate: SellerOsLaunchCandidateInputV1
  evaluatedAt: string
}>) {
  const evaluatedAt = iso(input.evaluatedAt, "EVALUATED_AT_INVALID")
  const candidate = input.candidate
  safeId(candidate.launchCandidateId, "LAUNCH_CANDIDATE_ID_INVALID")
  safeId(candidate.configurationId, "CONFIGURATION_ID_INVALID")
  if (!NUMERIC_ID.test(candidate.lunaProductId) ||
      !NUMERIC_ID.test(candidate.lunaVariantId)) fail("LUNA_IDENTITY_INVALID")
  safeText(candidate.lunaSku, "LUNA_SKU_INVALID", 120)
  integer(candidate.componentCount, "COMPONENT_COUNT_INVALID", 1, 20)
  if (candidate.supplierQuantityRequired !== null) integer(
    candidate.supplierQuantityRequired, "SUPPLIER_QUANTITY_INVALID", 1, 10_000)
  const configurationShapeValid =
    (candidate.configurationMode === "SINGLE_COMPONENT" &&
      candidate.supplierQuantityRequired === 1 && candidate.componentCount === 1) ||
    (candidate.configurationMode === "SIMPLE_MULTIPLIER" &&
      candidate.supplierQuantityRequired !== null &&
      candidate.supplierQuantityRequired > 1 && candidate.componentCount === 1) ||
    (candidate.configurationMode === "MULTI_COMPONENT_BOM" &&
      candidate.supplierQuantityRequired === null && candidate.componentCount >= 2)
  if (!configurationShapeValid) fail("LAUNCH_CONFIGURATION_SHAPE_INVALID")
  if (!input.family.candidateIds.includes(candidate.launchCandidateId)) {
    fail("CANDIDATE_NOT_IN_SERVER_GENERATED_FAMILY")
  }
  if (input.family.familyQuerySet.length < 1 ||
      input.family.familyQuerySet.length > MAX_FAMILY_QUERIES) {
    fail("FAMILY_QUERY_SET_INVALID")
  }
  const familyDefinition: SellerOsMarketFamilyDefinitionV1 = {
    identity: input.family.canonicalIdentity,
    familyName: input.family.familyName,
    familyQuerySet: input.family.familyQuerySet,
    keyProductAttributes: input.family.keyProductAttributes,
    keyBuyerIntentTerms: input.family.keyBuyerIntentTerms,
    adapterContract: input.family.adapterContract,
    adapterVersion: input.family.adapterVersion,
  }
  const familyId = buildSellerOsMarketFamilyIdV1(
    input.family.canonicalIdentity)
  const familyDefinitionVersionId =
    buildSellerOsMarketFamilyDefinitionVersionIdV1(familyDefinition)
  const opportunityCaseId = buildSellerOsOpportunityCaseIdV1({ familyId })
  const observation = input.family.currentMarketObservation
  if (observation.familyId !== familyId ||
      observation.familyDefinitionVersionId !== familyDefinitionVersionId ||
      observation.opportunityCaseId !== opportunityCaseId ||
      !fresh(observation.evidenceObservedAt, observation.maximumAgeSeconds,
        evaluatedAt)) {
    fail("CURRENT_MARKET_OBSERVATION_BINDING_OR_FRESHNESS_INVALID")
  }
  const demand = classifySellerOsFamilyDemandV1({
    evidence: input.family.evidence, evaluatedAt, familyId,
    observationId: observation.observationId,
    configurationId: candidate.configurationId,
  })
  if (demand.familyDemandStatus !== observation.familyDemandStatus ||
      demand.family.evidenceSetDigest !== observation.demandEvidenceDigest) {
    fail("CURRENT_MARKET_OBSERVATION_EVIDENCE_MISMATCH")
  }
  const fit = productFit(candidate, evaluatedAt)
  const economicsStatus = economics(candidate, evaluatedAt)
  const blockers: string[] = []
  const identityGate = candidate.currentIdentity.sourceStatus === "AVAILABLE" &&
    candidate.currentIdentity.exactProductId &&
    candidate.currentIdentity.exactVariantId && candidate.currentIdentity.exactSku &&
    candidate.componentIdentityComplete && !candidate.configurationConflict &&
    !candidate.variantConflict && !candidate.bomConflict
  if (!identityGate) blockers.push("LUNA_IDENTITY_GATE_NOT_PROVEN")
  if (!["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
    .includes(demand.familyDemandStatus)) blockers.push("FAMILY_DEMAND_GATE_NOT_PROVEN")
  if (fit !== "STRONG") blockers.push("PRODUCT_FIT_GATE_NOT_PROVEN")
  if (economicsStatus === "ECONOMICS_PROVISIONAL_FAIL") {
    blockers.push("ECONOMICS_PROVISIONAL_FAILED")
  } else if (economicsStatus !== "ECONOMICS_PROVISIONAL_PASS") {
    blockers.push("ECONOMICS_GATE_UNPROVEN")
  }
  if (!listingReady(candidate)) blockers.push("LISTING_RESEARCH_READINESS_NOT_PROVEN")
  if (candidate.configurationConflict) blockers.push("CONFIGURATION_CONFLICT")
  if (candidate.variantConflict) blockers.push("VARIANT_CONFLICT")
  if (candidate.bomConflict || !candidate.componentIdentityComplete) {
    blockers.push("BOM_CONFLICT_OR_INCOMPLETE")
  }
  if (candidate.skuCollision) blockers.push("LIVE_OR_RESERVED_SKU_COLLISION")
  blockers.push(...candidate.listingReadiness.policyBlockers)
  if (["SUPPLY_BLOCKED", "SUPPLY_UNPROVEN"].includes(candidate.supplyStatus)) {
    blockers.push("SUPPLY_IDENTITY_NOT_READY")
  }
  const hardBlockers = Object.freeze(unique(blockers).sort())
  const ready = hardBlockers.length === 0
  const prePublishRequirements = Object.freeze(unique([
    "CANONICAL_PRE_PUBLISH_SUPPLY_CONFIRMATION",
    "HUMAN_LISTING_PACKAGE_APPROVAL",
    "P2_LINKAGE_AFTER_EBAY_ITEM_ID",
  ]).sort())
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_VERSION,
    launchCandidateId: candidate.launchCandidateId,
    familyId,
    familyDefinitionVersionId,
    opportunityCaseId,
    currentMarketObservationId: observation.observationId,
    currentMarketObservationEvidenceDigest: observation.demandEvidenceDigest,
    targetProductProfile: buildSellerOsTargetProductProfileV1(observation),
    familyName: safeText(input.family.familyName, "FAMILY_NAME_INVALID", 120),
    familyQuerySet: Object.freeze(unique(input.family.familyQuerySet.map((query) =>
      safeText(query, "FAMILY_QUERY_INVALID", 180))).sort()),
    lunaProductId: candidate.lunaProductId,
    lunaVariantId: candidate.lunaVariantId,
    lunaSku: candidate.lunaSku,
    familyDemandStatus: demand.familyDemandStatus,
    exactProductDemandStatus: demand.exactProductDemandStatus,
    productFit: fit,
    economicsStatus,
    supplyStatus: candidate.supplyStatus,
    listingResearchReadiness: listingReady(candidate) ? "PASS" as const : "BLOCKED" as const,
    launchClassification: ready ? "READY_FOR_TEST_LAUNCH" as const
      : "NOT_READY_TO_TEST_LAUNCH" as const,
    launchScore: ready ? launchScore(candidate) : null,
    scoreVersion: ready ? SELLER_OS_LAUNCH_SCORE_VERSION : null,
    hardBlockers,
    prePublishRequirements,
    familyDemandEvidence: demand.family,
    exactProductDemandEvidence: demand.exact,
    evaluatedAt,
    publishAllowed: false as const,
    marketplaceWriteAllowed: false as const,
    p2MutationAllowed: false as const,
    p2I02LiveActivationAllowed: false as const,
    scoreCanOverrideHardBlocker: false as const,
  })
}

export function buildSellerOsEvidenceFirstLaunchQueueV1(input: Readonly<{
  families: readonly SellerOsLaunchFamilyDefinitionV1[]
  candidates: readonly SellerOsLaunchCandidateInputV1[]
  evaluatedAt: string
}>) {
  if (input.candidates.length > MAX_SHADOW_CANDIDATES) fail("SHADOW_POOL_LIMIT_EXCEEDED")
  const candidateIds = input.candidates.map((candidate) => candidate.launchCandidateId)
  if (unique(candidateIds).length !== candidateIds.length) fail("DUPLICATE_LAUNCH_CANDIDATE")
  const familyMemberships = input.families.flatMap((family) => family.candidateIds)
  const familyIds = input.families.map((family) =>
    buildSellerOsMarketFamilyIdV1(family.canonicalIdentity))
  if (unique(familyIds).length !== familyIds.length) {
    fail("DUPLICATE_CANONICAL_FAMILY_IDENTITY")
  }
  if (unique(familyMemberships).length !== familyMemberships.length) {
    fail("CANDIDATE_ASSIGNED_TO_MULTIPLE_FAMILIES")
  }
  if (candidateIds.some((candidateId) => !familyMemberships.includes(candidateId))) {
    fail("CANDIDATE_WITHOUT_SERVER_GENERATED_FAMILY")
  }
  const byId = new Map(input.candidates.map((candidate) =>
    [candidate.launchCandidateId, candidate]))
  const evaluations = input.families.flatMap((family) =>
    family.candidateIds.map((candidateId) => {
      const candidate = byId.get(candidateId)
      if (!candidate) fail("FAMILY_REFERENCES_UNKNOWN_CANDIDATE")
      return evaluateSellerOsFamilyLaunchCandidateV1({ family, candidate,
        evaluatedAt: input.evaluatedAt })
    }))
  const ready = evaluations.filter((candidate) =>
    candidate.launchClassification === "READY_FOR_TEST_LAUNCH")
    .sort((left, right) => (right.launchScore ?? -1) - (left.launchScore ?? -1) ||
      left.launchCandidateId.localeCompare(right.launchCandidateId))
  const familyStatuses = input.families.map((family) =>
    family.currentMarketObservation.familyDemandStatus)
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_VERSION,
    shadowInputCount: input.candidates.length,
    familyCount: input.families.length,
    familyDemandProvenCount: familyStatuses.filter((status) =>
      status === "FAMILY_DEMAND_PROVEN").length,
    familyDemandSupportedCount: familyStatuses.filter((status) =>
      status === "FAMILY_DEMAND_SUPPORTED").length,
    familyDemandUnprovenCount: familyStatuses.filter((status) =>
      status === "FAMILY_DEMAND_UNPROVEN").length,
    familyDemandUnavailableCount: familyStatuses.filter((status) =>
      status === "FAMILY_DEMAND_UNAVAILABLE").length,
    productFitStrongCount: evaluations.filter((candidate) =>
      candidate.productFit === "STRONG").length,
    readyForTestLaunchCount: ready.length,
    firstListingBuildCandidate: ready.at(0)?.launchCandidateId ?? null,
    evaluations: Object.freeze(evaluations),
    readyForTestLaunch: Object.freeze(ready),
    generativeImageCalls: 0 as const,
    marketplaceWrites: 0 as const,
    p2Mutations: 0 as const,
    listingPublicationAllowed: false as const,
    discoveryUniverseBoundToShadow20: false as const,
  })
}
