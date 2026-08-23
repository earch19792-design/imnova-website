import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const gate = await import("./ebay-prelinked-family-demand-gate-v1.ts")
const market = await import("./ebay-prelinked-family-market-observation-v1.ts")
const {
  buildSellerOsEvidenceFirstLaunchQueueV1,
  buildSellerOsLaunchFamilyIdV1,
  classifySellerOsFamilyDemandV1,
  evaluateSellerOsFamilyLaunchCandidateV1,
} = gate
const {
  buildSellerOsFamilyMarketObservationV1,
  buildSellerOsMarketFamilyIdV1,
} = market

const NOW = "2026-08-22T19:30:00.000Z"
const DAY = 24 * 60 * 60
const D = (character) => `sha256:${character.repeat(64)}`
const candidateId = (character = "a") =>
  `prelinked-candidate-v1:sha256:${character.repeat(64)}`
const CONFIGURATION_ID = `launch-configuration-v1:${D("c")}`
const FAMILY_IDENTITY = Object.freeze({
  productFunction: "adapt an EV mobile connector to a NEMA 14-30 outlet",
  buyerUseCase: "charge a Tesla with a portable mobile connector",
  category: "EV charging adapters",
  structuredDefinition: Object.freeze({
    connector: "NEMA 14-30", compatibility: "Tesla Gen II mobile connector",
  }),
})
const SECOND_FAMILY_IDENTITY = Object.freeze({
  productFunction: "weigh food ingredients",
  buyerUseCase: "portion food in a home kitchen",
  category: "Kitchen scales",
  structuredDefinition: Object.freeze({ measurement: "digital weight" }),
})

function marketEvidence(overrides = {}) {
  return { familyId: "market-family-v1:sha256:" + "0".repeat(64),
    observationId: "family-market-observation-v1:sha256:" + "0".repeat(64),
    upstreamEvidenceIdentity: "product-research:batch-1",
    reference: "product-research:batch-1", evidenceDigest: D("1"),
    sourceContractVersion: "EBAY_PRODUCT_RESEARCH_CAPTURE_V1",
    authorityClass: "OFFICIAL_EXTERNAL_FACT", evidenceKind: "CONFIRMED_SOLD",
    subjectScope: "FAMILY", configurationId: null,
    aggregationSemantics: "CUMULATIVE_SNAPSHOT", sourceStatus: "AVAILABLE",
    observedAt: "2026-08-22T18:00:00.000Z", maximumAgeSeconds: 30 * DAY,
    comparableCount: 10, confirmedSoldUnits: 20, sellerCount: 5,
    medianBuyerPrice: 39.99, ...overrides }
}

function family(overrides = {}) {
  const { observationOverrides = {}, ...plain } = overrides
  const definition = {
    canonicalIdentity: plain.canonicalIdentity ?? FAMILY_IDENTITY,
    familyName: plain.familyName ?? "EV mobile connector adapters",
    familyQuerySet: plain.familyQuerySet ?? ["Tesla NEMA 14-30 Gen II adapter"],
    keyProductAttributes: plain.keyProductAttributes ?? ["NEMA 14-30", "Gen II"],
    keyBuyerIntentTerms: plain.keyBuyerIntentTerms ?? ["mobile connector adapter"],
    adapterContract: plain.adapterContract ?? "MarketEvidenceAdapter",
    adapterVersion: plain.adapterVersion ?? "I02R_V1",
  }
  const marketDefinition = { identity: definition.canonicalIdentity,
    familyName: definition.familyName,
    familyQuerySet: definition.familyQuerySet,
    keyProductAttributes: definition.keyProductAttributes,
    keyBuyerIntentTerms: definition.keyBuyerIntentTerms,
    adapterContract: definition.adapterContract,
    adapterVersion: definition.adapterVersion }
  const provisional = buildSellerOsFamilyMarketObservationV1({
    familyDefinition: marketDefinition,
    observationWindowStart: "2026-07-23T00:00:00.000Z",
    observationWindowEnd: "2026-08-22T00:00:00.000Z",
    familyDemandStatus: "FAMILY_DEMAND_PROVEN",
    demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE",
    sourceStatus: "AVAILABLE", aggregationSemantics: "CUMULATIVE_SNAPSHOT",
    demandEvidenceReferences: ["product-research:batch-1"],
    demandEvidenceDigest: D("f"), soldComparableCount: 10,
    soldQuantityEvidence: { quantity: 20,
      authorityClass: "OFFICIAL_EXTERNAL_FACT",
      evidenceReferences: ["product-research:batch-1"] },
    activeComparableCount: null, sellerDiversity: 5,
    priceBand: { currency: "USD", minimum: 20, maximum: 60 },
    priceMedian: 39.99, priceDistributionEvidence: ["product-research:batch-1"],
    competitionState: "MODERATE", buyerIntentTerms: definition.keyBuyerIntentTerms,
    keywordState: "AVAILABLE", attributeProfile: { connector: "NEMA 14-30" },
    opportunityTypes: ["DEMAND_FIRST_TEST_LAUNCH"],
    evidenceObservedAt: "2026-08-22T00:00:00.000Z", sourceUpdatedAt: null,
    maximumAgeSeconds: 30 * DAY, sourceAdapter: "MarketEvidenceAdapter",
    sourceContractVersion: "EBAY_PRODUCT_RESEARCH_CAPTURE_V1", limitations: [],
  })
  const evidence = (plain.evidence ?? [marketEvidence()]).map((item) => ({
    ...item, familyId: provisional.familyId,
    observationId: provisional.observationId,
    configurationId: item.subjectScope === "EXACT_PRODUCT"
      ? CONFIGURATION_ID : null,
  }))
  const demand = classifySellerOsFamilyDemandV1({ evidence, evaluatedAt: NOW,
    familyId: provisional.familyId, observationId: provisional.observationId,
    configurationId: CONFIGURATION_ID })
  const hasDemand = ["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
    .includes(demand.familyDemandStatus)
  const currentMarketObservation = buildSellerOsFamilyMarketObservationV1({
    familyDefinition: marketDefinition,
    observationWindowStart: "2026-07-23T00:00:00.000Z",
    observationWindowEnd: "2026-08-22T00:00:00.000Z",
    familyDemandStatus: demand.familyDemandStatus,
    demandEvidenceClass: hasDemand ? "OFFICIAL_SOLD_EVIDENCE" :
      demand.familyDemandStatus === "FAMILY_DEMAND_UNAVAILABLE"
        ? "UNAVAILABLE" : "UNPROVEN",
    sourceStatus: demand.familyDemandStatus === "FAMILY_DEMAND_UNAVAILABLE"
      ? "UNAVAILABLE" : "AVAILABLE",
    aggregationSemantics: "CUMULATIVE_SNAPSHOT",
    demandEvidenceReferences: evidence.map((item) => item.reference),
    demandEvidenceDigest: demand.family.evidenceSetDigest,
    soldComparableCount: hasDemand ? demand.family.comparableCount : null,
    soldQuantityEvidence: hasDemand ? { quantity: demand.family.confirmedSoldUnits,
      authorityClass: "OFFICIAL_EXTERNAL_FACT",
      evidenceReferences: demand.family.evidenceReferences } : null,
    activeComparableCount: null, sellerDiversity: demand.family.sellerCount,
    priceBand: hasDemand ? { currency: "USD", minimum: 20, maximum: 60 } : null,
    priceMedian: hasDemand ? 39.99 : null,
    priceDistributionEvidence: hasDemand ? demand.family.evidenceReferences : [],
    competitionState: "MODERATE", buyerIntentTerms: definition.keyBuyerIntentTerms,
    keywordState: "AVAILABLE", attributeProfile: { connector: "NEMA 14-30" },
    opportunityTypes: ["DEMAND_FIRST_TEST_LAUNCH"],
    evidenceObservedAt: "2026-08-22T00:00:00.000Z", sourceUpdatedAt: null,
    maximumAgeSeconds: 30 * DAY, sourceAdapter: "MarketEvidenceAdapter",
    sourceContractVersion: "EBAY_PRODUCT_RESEARCH_CAPTURE_V1", limitations: [],
    ...observationOverrides,
  })
  return { ...definition, currentMarketObservation,
    candidateIds: plain.candidateIds ?? [candidateId()], evidence }
}

function candidate(overrides = {}) {
  return { launchCandidateId: candidateId(), configurationId: CONFIGURATION_ID,
    lunaProductId: "9220832329952",
    lunaVariantId: "48809643376864", lunaSku: "ITEM3760",
    configurationMode: "SINGLE_COMPONENT", supplierQuantityRequired: 1,
    componentCount: 1, componentIdentityComplete: true,
    currentIdentity: { sourceStatus: "AVAILABLE", observedAt: NOW,
      maximumAgeSeconds: DAY, exactProductId: true, exactVariantId: true,
      exactSku: true, configurationComplete: true,
      featureCoveragePercent: 90, conflictingRepresentation: false },
    economics: { sourceStatus: "AVAILABLE", calculatedAt: NOW,
      maximumAgeSeconds: DAY, salePrice: 59.99, supplierCost: 15,
      shippingCost: 7, feesAndReserves: 12, netProfit: 25.99,
      netMarginPercent: 43.32, passesMinimums: true },
    listingReadiness: { productFactsComplete: true,
      authorizedAssetsAvailable: true, categoryResolved: true,
      requiredAspectsComplete: true, policyBlockers: [] },
    supplyStatus: "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED",
    skuCollision: false, configurationConflict: false, variantConflict: false,
    bomConflict: false,
    scoreInputs: { demandQuality: 90, productFit: 95, pricePositioning: 80,
      competition: 75, economics: 85, evidenceFreshness: 95,
      listingReadiness: 90, visualAssetReadiness: 80 }, ...overrides }
}

function evaluate(candidateOverrides = {}, familyOverrides = {}) {
  const value = candidate(candidateOverrides)
  return evaluateSellerOsFamilyLaunchCandidateV1({
    family: family({ candidateIds: [value.launchCandidateId], ...familyOverrides }),
    candidate: value, evaluatedAt: NOW,
  })
}

test("family demand proven can coexist with exact-product demand unproven", () => {
  const result = evaluate()
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_PROVEN")
  assert.equal(result.exactProductDemandStatus, "EXACT_PRODUCT_DEMAND_UNPROVEN")
  assert.equal(result.launchClassification, "READY_FOR_TEST_LAUNCH")
  assert.ok(result.launchScore > 0)
})

test("family demand supported plus strong product fit may reach the test gate", () => {
  const result = evaluate({}, { evidence: [marketEvidence({ comparableCount: 1,
    confirmedSoldUnits: 1 })] })
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_SUPPORTED")
  assert.equal(result.productFit, "STRONG")
  assert.equal(result.launchClassification, "READY_FOR_TEST_LAUNCH")
})

test("active listings, search counts, and title frequency never prove demand", () => {
  for (const evidenceKind of ["ACTIVE_LISTINGS", "SEARCH_RESULT_COUNT",
    "TITLE_FREQUENCY"]) {
    const bound = family({ evidence: [marketEvidence({ evidenceKind,
      comparableCount: 100, confirmedSoldUnits: 500 })] })
    const result = classifySellerOsFamilyDemandV1({ evaluatedAt: NOW,
      evidence: bound.evidence,
      familyId: bound.currentMarketObservation.familyId,
      observationId: bound.currentMarketObservation.observationId,
      configurationId: CONFIGURATION_ID })
    assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
  }
})

test("exact product official sold evidence is classified separately", () => {
  const result = evaluate({}, { evidence: [marketEvidence(), marketEvidence({
    reference: "product-research:exact-1", evidenceDigest: D("2"),
    upstreamEvidenceIdentity: "product-research:exact-1",
    subjectScope: "EXACT_PRODUCT", comparableCount: 6,
    confirmedSoldUnits: 12 })] })
  assert.equal(result.exactProductDemandStatus, "EXACT_PRODUCT_DEMAND_PROVEN")
})

test("family demand unavailable remains fail-closed", () => {
  const result = evaluate({}, { evidence: [marketEvidence({
    sourceStatus: "UNAVAILABLE" })] })
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_UNAVAILABLE")
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
})

test("stale sold evidence is unproven", () => {
  const result = evaluate({}, { evidence: [marketEvidence({
    observedAt: "2026-06-01T00:00:00.000Z", maximumAgeSeconds: 30 * DAY })] })
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
})

test("title-only or stale identity cannot become STRONG", () => {
  const titleOnly = evaluate({ currentIdentity: { ...candidate().currentIdentity,
    exactProductId: false, exactVariantId: false, exactSku: false } })
  assert.equal(titleOnly.productFit, "UNPROVEN")
  const stale = evaluate({ currentIdentity: { ...candidate().currentIdentity,
    observedAt: "2026-08-01T00:00:00.000Z" } })
  assert.equal(stale.productFit, "UNPROVEN")
})

test("exact identity with incomplete configuration is MEDIUM, not STRONG", () => {
  const result = evaluate({ currentIdentity: { ...candidate().currentIdentity,
    configurationComplete: false, featureCoveragePercent: null } })
  assert.equal(result.productFit, "MEDIUM")
  assert.ok(result.hardBlockers.includes("PRODUCT_FIT_GATE_NOT_PROVEN"))
})

test("high score cannot override a hard blocker", () => {
  const result = evaluate({ skuCollision: true,
    scoreInputs: Object.fromEntries(Object.keys(candidate().scoreInputs)
      .map((key) => [key, 100])) })
  assert.equal(result.launchScore, null)
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
  assert.ok(result.hardBlockers.includes("LIVE_OR_RESERVED_SKU_COLLISION"))
})

test("provisional economics failure is a hard blocker", () => {
  const result = evaluate({ economics: { ...candidate().economics,
    netProfit: -5, netMarginPercent: -10, passesMinimums: false } })
  assert.equal(result.economicsStatus, "ECONOMICS_PROVISIONAL_FAIL")
  assert.ok(result.hardBlockers.includes("ECONOMICS_PROVISIONAL_FAILED"))
})

test("unknown shipping keeps economics unproven", () => {
  const result = evaluate({ economics: { ...candidate().economics,
    shippingCost: null } })
  assert.equal(result.economicsStatus, "ECONOMICS_UNPROVEN")
  assert.ok(result.hardBlockers.includes("ECONOMICS_GATE_UNPROVEN"))
})

test("configuration and variant conflicts fail closed", () => {
  assert.ok(evaluate({ configurationConflict: true }).hardBlockers
    .includes("CONFIGURATION_CONFLICT"))
  assert.ok(evaluate({ variantConflict: true }).hardBlockers
    .includes("VARIANT_CONFLICT"))
})

test("BOM conflict and missing component block the whole candidate", () => {
  const conflict = evaluate({ configurationMode: "MULTI_COMPONENT_BOM",
    supplierQuantityRequired: null, componentCount: 3, bomConflict: true })
  assert.ok(conflict.hardBlockers.includes("BOM_CONFLICT_OR_INCOMPLETE"))
  const missing = evaluate({ configurationMode: "MULTI_COMPONENT_BOM",
    supplierQuantityRequired: null, componentCount: 2,
    componentIdentityComplete: false })
  assert.ok(missing.hardBlockers.includes("BOM_CONFLICT_OR_INCOMPLETE"))
})

test("simple multiplier preserves structural quantity", () => {
  const result = evaluate({ configurationMode: "SIMPLE_MULTIPLIER",
    supplierQuantityRequired: 3 })
  assert.equal(result.launchClassification, "READY_FOR_TEST_LAUNCH")
})

test("listing research and policy blockers are hard gates", () => {
  const result = evaluate({ listingReadiness: { ...candidate().listingReadiness,
    categoryResolved: false, policyBlockers: ["FORBIDDEN_PRODUCT_POLICY"] } })
  assert.equal(result.listingResearchReadiness, "BLOCKED")
  assert.ok(result.hardBlockers.includes("FORBIDDEN_PRODUCT_POLICY"))
})

test("server-generated family membership rejects caller regrouping", () => {
  assert.throws(() => evaluateSellerOsFamilyLaunchCandidateV1({
    family: family({ candidateIds: [candidateId("b")] }),
    candidate: candidate(), evaluatedAt: NOW,
  }), /CANDIDATE_NOT_IN_SERVER_GENERATED_FAMILY/)
})

test("same family definition and replay have deterministic identity", () => {
  const forward = buildSellerOsLaunchFamilyIdV1(FAMILY_IDENTITY)
  const reverse = buildSellerOsLaunchFamilyIdV1({
    category: "ev charging adapters",
    buyerUseCase: "CHARGE A TESLA WITH A PORTABLE MOBILE CONNECTOR",
    productFunction: "Adapt an EV mobile connector to a NEMA 14-30 outlet",
    structuredDefinition: { compatibility: "Tesla Gen II mobile connector",
      connector: "nema 14-30" },
  })
  assert.equal(forward, reverse)
})

test("same evidence digest is deduplicated on replay", () => {
  const replay = marketEvidence({ reference: "product-research:replay" })
  const bound = family({ evidence: [marketEvidence(), replay] })
  const result = classifySellerOsFamilyDemandV1({ evaluatedAt: NOW,
    evidence: bound.evidence,
    familyId: bound.currentMarketObservation.familyId,
    observationId: bound.currentMarketObservation.observationId,
    configurationId: CONFIGURATION_ID })
  assert.equal(result.family.comparableCount, 10)
  assert.equal(result.family.confirmedSoldUnits, 20)
})

test("foreign family or observation evidence cannot enter the current gate", () => {
  const current = family()
  assert.throws(() => classifySellerOsFamilyDemandV1({ evaluatedAt: NOW,
    evidence: [{ ...current.evidence[0], familyId:
      `market-family-v1:sha256:${"f".repeat(64)}` }],
    familyId: current.currentMarketObservation.familyId,
    observationId: current.currentMarketObservation.observationId,
    configurationId: CONFIGURATION_ID,
  }), /MARKET_EVIDENCE_SUBJECT_BINDING_MISMATCH/)
})

test("same upstream evidence with a changed digest fails closed", () => {
  const current = family()
  assert.throws(() => classifySellerOsFamilyDemandV1({ evaluatedAt: NOW,
    evidence: [current.evidence[0], { ...current.evidence[0],
      evidenceDigest: D("9") }],
    familyId: current.currentMarketObservation.familyId,
    observationId: current.currentMarketObservation.observationId,
    configurationId: CONFIGURATION_ID,
  }), /MARKET_EVIDENCE_REPLAY_CONFLICT/)
})

test("multiple cumulative snapshots do not inflate family demand totals", () => {
  const current = family({ evidence: [marketEvidence(), marketEvidence({
    upstreamEvidenceIdentity: "product-research:batch-2",
    reference: "product-research:batch-2", evidenceDigest: D("2"),
    comparableCount: 8, confirmedSoldUnits: 12,
  })] })
  const result = classifySellerOsFamilyDemandV1({ evaluatedAt: NOW,
    evidence: current.evidence,
    familyId: current.currentMarketObservation.familyId,
    observationId: current.currentMarketObservation.observationId,
    configurationId: CONFIGURATION_ID,
  })
  assert.equal(result.family.comparableCount, 10)
  assert.equal(result.family.confirmedSoldUnits, 20)
})

test("invalid single, multiplier, and BOM shapes fail before evaluation", () => {
  for (const invalid of [
    { configurationMode: "SINGLE_COMPONENT", supplierQuantityRequired: 2 },
    { configurationMode: "SIMPLE_MULTIPLIER", supplierQuantityRequired: 1 },
    { configurationMode: "MULTI_COMPONENT_BOM", supplierQuantityRequired: null,
      componentCount: 1 },
  ]) assert.throws(() => evaluate(invalid), /LAUNCH_CONFIGURATION_SHAPE_INVALID/)
})

test("queue supports zero, one, or multiple qualifying candidates without quotas", () => {
  const one = candidate()
  const blocked = candidate({ launchCandidateId: candidateId("b"),
    economics: { ...candidate().economics, shippingCost: null } })
  const none = buildSellerOsEvidenceFirstLaunchQueueV1({ evaluatedAt: NOW,
    candidates: [blocked], families: [family({ canonicalIdentity: SECOND_FAMILY_IDENTITY,
      candidateIds: [blocked.launchCandidateId] })] })
  assert.equal(none.readyForTestLaunchCount, 0)
  assert.equal(none.firstListingBuildCandidate, null)
  const oneQueue = buildSellerOsEvidenceFirstLaunchQueueV1({ evaluatedAt: NOW,
    candidates: [one, blocked], families: [family({ candidateIds: [one.launchCandidateId] }),
      family({ canonicalIdentity: SECOND_FAMILY_IDENTITY, familyName: "Second family",
        familyQuerySet: ["second query"], candidateIds: [blocked.launchCandidateId],
        evidence: [marketEvidence({ reference: "evidence:two", evidenceDigest: D("2") })] })] })
  assert.equal(oneQueue.readyForTestLaunchCount, 1)
  assert.equal(oneQueue.firstListingBuildCandidate, one.launchCandidateId)
})

test("multiple finalists rank after hard gates only", () => {
  const a = candidate()
  const b = candidate({ launchCandidateId: candidateId("b"),
    scoreInputs: { ...candidate().scoreInputs, demandQuality: 100 } })
  const queue = buildSellerOsEvidenceFirstLaunchQueueV1({ evaluatedAt: NOW,
    candidates: [a, b], families: [family({ candidateIds: [a.launchCandidateId] }),
      family({ canonicalIdentity: SECOND_FAMILY_IDENTITY, familyName: "Second family",
        familyQuerySet: ["second query"], candidateIds: [b.launchCandidateId],
        evidence: [marketEvidence({ reference: "evidence:two", evidenceDigest: D("2") })] })] })
  assert.equal(queue.readyForTestLaunchCount, 2)
  assert.equal(queue.firstListingBuildCandidate, b.launchCandidateId)
})

test("adapter upgrade does not change candidate identity", () => {
  const original = evaluate()
  const upgraded = evaluate({}, { evidence: [marketEvidence({
    sourceContractVersion: "EBAY_PRODUCT_RESEARCH_CAPTURE_V2",
    evidenceDigest: D("2") })] })
  assert.equal(original.launchCandidateId, upgraded.launchCandidateId)
  assert.equal(original.familyId, upgraded.familyId)
})

test("pre-publication supply confirmation does not mean stock or publication", () => {
  const result = evaluate()
  assert.equal(result.supplyStatus, "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED")
  assert.ok(result.prePublishRequirements.includes(
    "CANONICAL_PRE_PUBLISH_SUPPLY_CONFIRMATION"))
  assert.equal(result.publishAllowed, false)
  assert.equal(result.p2MutationAllowed, false)
  assert.equal(result.p2I02LiveActivationAllowed, false)
})

test("queue preserves lineage and rejects P2/publication bypass", () => {
  const queue = buildSellerOsEvidenceFirstLaunchQueueV1({ evaluatedAt: NOW,
    candidates: [candidate()], families: [family()] })
  assert.equal(queue.listingPublicationAllowed, false)
  assert.equal(queue.marketplaceWrites, 0)
  assert.equal(queue.p2Mutations, 0)
  assert.equal(queue.generativeImageCalls, 0)
})

test("pool is bounded to twenty and one candidate cannot enter two families", () => {
  const candidates = Array.from({ length: 21 }, (_, index) => candidate({
    launchCandidateId: `prelinked-candidate-v1:sha256:${index.toString(16)
      .padStart(64, "0")}`,
  }))
  assert.throws(() => buildSellerOsEvidenceFirstLaunchQueueV1({
    evaluatedAt: NOW, candidates, families: [],
  }), /SHADOW_POOL_LIMIT_EXCEEDED/)
  assert.throws(() => buildSellerOsEvidenceFirstLaunchQueueV1({
    evaluatedAt: NOW, candidates: [candidate()],
    families: [family(), family({ canonicalIdentity: SECOND_FAMILY_IDENTITY })],
  }), /CANDIDATE_ASSIGNED_TO_MULTIPLE_FAMILIES/)
})
