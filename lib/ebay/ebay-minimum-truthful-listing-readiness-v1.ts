import { createHash } from "node:crypto"

export const MINIMUM_TRUTHFUL_LISTING_READINESS_V1 =
  "MINIMUM_TRUTHFUL_LISTING_READINESS_V1" as const

export type EbayRequirementClassV1 =
  | "REQUIRED_TO_LIST"
  | "CONDITIONALLY_REQUIRED"
  | "RECOMMENDED"
  | "OPTIONAL"
  | "UNPROVEN_CAPABILITY"

export type MinimumTruthfulGateStateV1 =
  | "PASS"
  | "FAIL"
  | "UNPROVEN"

type JsonRecord = Record<string, unknown>

const AI_SEMANTIC_FIELDS = new Set([
  "type",
  "form factor",
  "department",
  "style",
  "features",
  "connectivity",
  "compatible brand",
])

const STRICT_PRODUCT_FACTS = new Set([
  "brand",
  "model",
  "upc",
  "ean",
  "mpn",
  "dimensions",
  "dimension",
  "size",
  "material",
  "voltage",
  "condition",
])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function key(value: unknown) {
  return text(value, 120).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function officialTaxonomySnapshot(value: unknown) {
  const preflight = record(value)
  return preflight.status === "CONSULTADO"
    && preflight.officialStatus === "AVAILABLE"
    && preflight.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && preflight.marketplaceId === "EBAY_US"
    && /^\d{1,20}$/.test(text(preflight.categoryId, 20))
    && /^sha256:[0-9a-f]{64}$/.test(text(preflight.evidenceDigest, 80))
    && Array.isArray(preflight.aspects)
}

/**
 * Requirement authority is intentionally limited to the official Taxonomy
 * snapshot. `aspectUsage=RECOMMENDED` never weakens `aspectRequired=true`.
 * A future conditional classification is accepted only when an official
 * adapter persists both the class and its machine-evaluable condition.
 */
export function classifyOfficialEbayRequirementV1(input: Readonly<{
  taxonomyPreflight: unknown
  aspect: unknown
}>): EbayRequirementClassV1 {
  if (!officialTaxonomySnapshot(input.taxonomyPreflight)) {
    return "UNPROVEN_CAPABILITY"
  }
  const aspect = record(input.aspect)
  if (!text(aspect.name, 120)) return "UNPROVEN_CAPABILITY"
  if (aspect.required === true) return "REQUIRED_TO_LIST"
  const officialConditional = record(aspect.officialConditionalRequirement)
  if (
    officialConditional.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && officialConditional.machineEvaluable === true
  ) return "CONDITIONALLY_REQUIRED"
  return text(aspect.usage, 40).toUpperCase() === "RECOMMENDED"
    ? "RECOMMENDED" : "OPTIONAL"
}

export function aiAutonomousMarketplaceResolutionAllowedV1(
  specificName: unknown,
) {
  const normalized = key(specificName)
  return AI_SEMANTIC_FIELDS.has(normalized)
    && !STRICT_PRODUCT_FACTS.has(normalized)
}

export function buildOfficialEbayRequirementClassificationV1(input:
Readonly<{
  taxonomyPreflight: unknown
  ownerProposals?: readonly JsonRecord[]
  specificNames?: readonly string[]
}>) {
  const preflight = record(input.taxonomyPreflight)
  const official = officialTaxonomySnapshot(preflight)
  const resolved = record(preflight.resolvedAspects)
  const proposals = input.ownerProposals ?? []
  const scope = input.specificNames
    ? new Set(input.specificNames.map(key).filter(Boolean)) : null
  const classifications = official ? rows(preflight.aspects).flatMap((aspect) => {
    const name = text(aspect.name, 120)
    if (!name || (scope && !scope.has(key(name)))) return []
    const requirementClass = classifyOfficialEbayRequirementV1({
      taxonomyPreflight: preflight,
      aspect,
    })
    const currentValue = Object.entries(resolved).find(([candidate]) =>
      key(candidate) === key(name))?.[1]
    const currentFactStatus = text(currentValue, 500)
      ? "RESOLVED" as const : "MISSING" as const
    const conditional = record(aspect.officialConditionalRequirement)
    const conditionEvaluation = requirementClass === "CONDITIONALLY_REQUIRED"
      ? conditional.evaluation === "APPLIES"
        ? "APPLIES" as const
        : conditional.evaluation === "DOES_NOT_APPLY"
          ? "DOES_NOT_APPLY" as const : "UNPROVEN" as const
      : null
    const blocks = currentFactStatus === "MISSING" && (
      requirementClass === "REQUIRED_TO_LIST"
      || (requirementClass === "CONDITIONALLY_REQUIRED"
        && conditionEvaluation === "APPLIES")
    )
    const waitsForCapability = requirementClass === "UNPROVEN_CAPABILITY"
      || (requirementClass === "CONDITIONALLY_REQUIRED"
        && conditionEvaluation === "UNPROVEN")
    const proposal = proposals.find((entry) =>
      key(entry.productField) === key(name))
    return [Object.freeze({
      specificName: name,
      requirementClass,
      officialPolicySource: "EBAY_TAXONOMY_OFFICIAL_READONLY" as const,
      officialPolicyEvidenceDigest: text(preflight.evidenceDigest, 80),
      officialAspectRequired: aspect.required === true,
      officialAspectUsage: text(aspect.usage, 40) || null,
      conditionEvaluation,
      currentFactStatus,
      currentValue: text(currentValue, 500) || null,
      aiAutonomousResolutionAllowed:
        (requirementClass === "REQUIRED_TO_LIST"
          || requirementClass === "CONDITIONALLY_REQUIRED")
        && aiAutonomousMarketplaceResolutionAllowedV1(name),
      ownerInputRequired: blocks,
      blocksMinimumTruthfulListing: blocks,
      waitsForCapability,
      postPublishEnrichmentOpportunity: currentFactStatus === "MISSING"
        && ["RECOMMENDED", "OPTIONAL"].includes(requirementClass),
      mode: text(aspect.mode, 40) || "FREE_TEXT",
      cardinality: text(aspect.cardinality, 40) || "SINGLE",
      maxLength: Number.isInteger(Number(aspect.maxLength))
        && Number(aspect.maxLength) > 0 ? Number(aspect.maxLength) : null,
      dataType: text(aspect.dataType, 40) || "STRING",
      valuesComplete: aspect.valuesComplete === true,
      allowedValues: rows(aspect.values).map((entry) =>
        text(entry.value, 500)).filter(Boolean),
      bestProposal: text(proposal?.bestProposal, 500) || null,
      proposalEvidence: text(proposal?.proposalEvidence, 500) || null,
      factInvented: false as const,
    })]
  }) : [Object.freeze({
    specificName: "OFFICIAL_EBAY_CATEGORY_REQUIREMENTS",
    requirementClass: "UNPROVEN_CAPABILITY" as const,
    officialPolicySource: null,
    officialPolicyEvidenceDigest: null,
    officialAspectRequired: null,
    officialAspectUsage: null,
    conditionEvaluation: null,
    currentFactStatus: "UNPROVEN" as const,
    currentValue: null,
    aiAutonomousResolutionAllowed: false,
    ownerInputRequired: false,
    blocksMinimumTruthfulListing: false,
    waitsForCapability: true,
    postPublishEnrichmentOpportunity: false,
    mode: null,
    cardinality: null,
    maxLength: null,
    dataType: null,
    valuesComplete: false,
    allowedValues: [] as string[],
    bestProposal: null,
    proposalEvidence: null,
    factInvented: false as const,
  })]
  const count = (classification: EbayRequirementClassV1) =>
    classifications.filter((entry) =>
      entry.requirementClass === classification).length
  const blocking = classifications.filter((entry) =>
    entry.blocksMinimumTruthfulListing)
  const waiting = classifications.filter((entry) => entry.waitsForCapability)
  const opportunities = classifications.filter((entry) =>
    entry.postPublishEnrichmentOpportunity)
  return Object.freeze({
    officialRequirementClassification: official,
    classifications: Object.freeze(classifications),
    requiredToListCount: count("REQUIRED_TO_LIST"),
    conditionallyRequiredCount: count("CONDITIONALLY_REQUIRED"),
    recommendedCount: count("RECOMMENDED"),
    optionalCount: count("OPTIONAL"),
    unprovenRequirementCount: count("UNPROVEN_CAPABILITY"),
    blockingRequiredFacts: Object.freeze(blocking),
    waitingRequirementCapabilities: Object.freeze(waiting),
    postPublishEnrichmentOpportunities: Object.freeze(opportunities),
    factInvented: false as const,
  })
}

export function buildMinimumTruthfulListingReadinessV1(input: Readonly<{
  candidateKey: string
  opportunityId: string
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  listingPackageId: string
  taxonomyPreflight: unknown
  ownerProposals?: readonly JsonRecord[]
  residualSpecificNames?: readonly string[]
  identity: MinimumTruthfulGateStateV1
  duplicate: MinimumTruthfulGateStateV1
  stock: MinimumTruthfulGateStateV1
  demand: "PASS" | "UNPROVEN_MARKET_TEST_ALLOWED" | "FAIL"
  shipping: MinimumTruthfulGateStateV1
  economics: MinimumTruthfulGateStateV1
  productTruthMaterial: MinimumTruthfulGateStateV1
  category: MinimumTruthfulGateStateV1
  condition: MinimumTruthfulGateStateV1
  productIdentifiers: "PASS" | "BLOCKED_REQUIRED_FACT" |
    "UNPROVEN_CAPABILITY"
  listingPolicy: MinimumTruthfulGateStateV1
  compliance: MinimumTruthfulGateStateV1
  evaluatedAt?: string
}>) {
  const requirement = buildOfficialEbayRequirementClassificationV1({
    taxonomyPreflight: input.taxonomyPreflight,
    ownerProposals: input.ownerProposals,
    specificNames: input.residualSpecificNames,
  })
  const blockers = unique([
    ...(input.identity !== "PASS" ? ["IDENTITY_NOT_READY"] : []),
    ...(input.duplicate !== "PASS" ? ["DUPLICATE_GUARD_NOT_READY"] : []),
    ...(input.stock !== "PASS" ? ["STOCK_NOT_READY"] : []),
    ...(input.demand === "FAIL" ? ["DEMAND_NOT_READY"] : []),
    ...(input.shipping !== "PASS" ? ["SHIPPING_NOT_READY"] : []),
    ...(input.economics !== "PASS" ? ["ECONOMICS_NOT_READY"] : []),
    ...(input.productTruthMaterial !== "PASS"
      ? ["PRODUCT_TRUTH_MATERIAL_NOT_READY"] : []),
    ...(input.category !== "PASS" ? ["MARKETPLACE_CATEGORY_NOT_READY"] : []),
    ...(input.condition !== "PASS" ? ["MARKETPLACE_CONDITION_NOT_READY"] : []),
    ...requirement.blockingRequiredFacts.map((entry) =>
      `BLOCKED_REQUIRED_FACT:${entry.specificName}`),
    ...(requirement.waitingRequirementCapabilities.length
      ? ["WAITING_FOR_EBAY_CAPABILITY"] : []),
    ...(input.productIdentifiers === "UNPROVEN_CAPABILITY"
      ? ["WAITING_FOR_EBAY_CAPABILITY"] : []),
    ...(input.productIdentifiers === "BLOCKED_REQUIRED_FACT"
      ? ["BLOCKED_REQUIRED_PRODUCT_IDENTIFIER"] : []),
    ...(input.listingPolicy !== "PASS"
      ? ["LISTING_POLICY_NOT_READY"] : []),
    ...(input.compliance !== "PASS"
      ? ["COMPLIANCE_OR_MATERIAL_FALSEHOOD_BLOCKER"] : []),
  ])
  const minimumTruthfulListingReady = blockers.length === 0
  const marketTestReady = minimumTruthfulListingReady
    && input.demand === "UNPROVEN_MARKET_TEST_ALLOWED"
  const listingReady = minimumTruthfulListingReady && input.demand === "PASS"
  const ownerLastMilePrerequisitesReady = input.identity === "PASS"
    && input.duplicate === "PASS" && input.stock === "PASS"
    && input.demand !== "FAIL" && input.shipping === "PASS"
    && input.economics === "PASS" && input.productTruthMaterial === "PASS"
    && input.category === "PASS" && input.condition === "PASS"
    && input.listingPolicy === "PASS" && input.compliance === "PASS"
  const ownerLastMileActions = ownerLastMilePrerequisitesReady
    ? requirement.blockingRequiredFacts : []
  const core = {
    contractVersion: MINIMUM_TRUTHFUL_LISTING_READINESS_V1,
    authority: "SELLER_OS_MINIMUM_TRUTHFUL_LISTING_EVALUATOR",
    marketplaceId: "EBAY_US",
    candidateKey: input.candidateKey,
    opportunityId: input.opportunityId,
    supplierProductId: input.supplierProductId,
    supplierVariantId: input.supplierVariantId,
    supplierSku: input.supplierSku,
    listingPackageId: input.listingPackageId,
    officialRequirementClassification:
      requirement.officialRequirementClassification,
    requirementClassifications: requirement.classifications,
    requiredToListCount: requirement.requiredToListCount,
    conditionallyRequiredCount: requirement.conditionallyRequiredCount,
    recommendedCount: requirement.recommendedCount,
    optionalCount: requirement.optionalCount,
    unprovenRequirementCount: requirement.unprovenRequirementCount,
    trueRequiredFactsStillMissing: requirement.blockingRequiredFacts,
    ownerLastMileActions,
    ownerLastMilePrerequisitesReady,
    postPublishEnrichmentOpportunities:
      requirement.postPublishEnrichmentOpportunities,
    residualFactsRemovedFromBlockingPath:
      requirement.postPublishEnrichmentOpportunities.length,
    trueRequiredFactsStillMissingCount:
      requirement.blockingRequiredFacts.length,
    gateStates: {
      identity: input.identity,
      duplicate: input.duplicate,
      stock: input.stock,
      demand: input.demand,
      shipping: input.shipping,
      economics: input.economics,
      productTruthMaterial: input.productTruthMaterial,
      category: input.category,
      condition: input.condition,
      productIdentifiers: input.productIdentifiers,
      listingPolicy: input.listingPolicy,
      compliance: input.compliance,
    },
    blockers,
    minimumTruthfulListingReady,
    marketTestReady,
    listingReady,
    demandProven: input.demand === "PASS",
    ownerDataEntryAsDefault: false,
    ownerOnlySeesTruePublicationBlockers: true,
    newListingPublishOwnerOnly: true,
    missingSpecificNoLongerEqualsBlocked: true,
    optionalSpecificsDoNotBlock: true,
    recommendedSpecificsDoNotBlock: true,
    requiredFactsRemainFailClosed: true,
    unprovenPolicyRemainsWaiting: true,
    aiAutonomousMarketplaceMapping: true,
    aiMayNotInventStrictFacts: true,
    ownerPolicyDefaultsReusedFirst: true,
    ownerFactProvenancePreserved: true,
    futureQuickPickSystemic: true,
    skuSpecialCases: 0,
    historicalBatchSpecialCase: false,
    safeResumeFrom: "PRODUCT_TRUTH_REQUIRED_SPECIFICS_IDENTIFIER_POLICY_MARKETPLACE_READINESS",
    previousGateReexecution: {
      identity: false,
      duplicate: false,
      demand: false,
      stock: false,
      shipping: false,
      economics: false,
      category: false,
      soldResearch: false,
      browse: false,
      visualMatching: false,
    },
    factInvented: false,
    newOperationCount: 0,
    duplicateOperationCount: 0,
    soldResearchRerunCount: 0,
    visualRerunCount: 0,
    sellerWideTradingCalls: 0,
    marketplaceWrites: 0,
    listingPublications: 0,
    listingMutations: 0,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
  }
  return Object.freeze({ ...core, evidenceDigest: digest(core) })
}
