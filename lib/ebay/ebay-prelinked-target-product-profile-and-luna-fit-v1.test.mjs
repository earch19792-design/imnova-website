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

const subject = await import(
  "./ebay-prelinked-target-product-profile-and-luna-fit-v1.ts"
)
const {
  buildSellerOsListingResearchReadinessV1,
  buildSellerOsLunaProductFitReceiptV1,
  buildSellerOsProvisionalEconomicsReceiptV1,
  buildSellerOsTargetProductProfileWithAuthorityV1,
  evaluateSellerOsCompetitionGateV1,
  evaluateSellerOsI02uFinalistGateV1,
  runSellerOsI02uTransactionalFinalistCanaryV1,
  selectSellerOsI02uFirstListingBuildCandidateV1,
} = subject

const NOW = "2026-08-22T20:00:00.000Z"
const HOUR_AGO = "2026-08-22T19:00:00.000Z"
const OLD = "2026-08-20T19:00:00.000Z"
const D = (character) => `sha256:${character.repeat(64)}`
const FAMILY_ID = `market-family-v1:${D("1")}`
const CASE_ID = `opportunity-case-v1:${D("2")}`
const OBSERVATION_ID = `family-market-observation-v1:${D("3")}`
const CANDIDATE_ID = `prelinked-candidate-v1:${D("4")}`
const SECOND_CANDIDATE_ID = `prelinked-candidate-v1:${D("5")}`
const CONFIGURATION_ID = `launch-configuration-v1:${D("6")}`
const COMPONENT_ID = `launch-component-v1:${D("7")}`
const SECOND_COMPONENT_ID = `launch-component-v1:${D("8")}`

function authority(overrides = {}) {
  return {
    authorityClass: "DIRECT_OBSERVATION",
    reference: "evidence:luna:snapshot-1",
    evidenceDigest: D("a"),
    observedAt: HOUR_AGO,
    maximumAgeSeconds: 24 * 60 * 60,
    ...overrides,
  }
}

function profile(overrides = {}) {
  return buildSellerOsTargetProductProfileWithAuthorityV1({
    familyId: FAMILY_ID,
    opportunityCaseId: CASE_ID,
    currentMarketObservationId: OBSERVATION_ID,
    attributes: [{
      key: "connector",
      expectedValue: "NEMA 14-30",
      attributeClassification: "PROVEN_ATTRIBUTE",
      requirement: "REQUIRED",
      matchMode: "TOKEN_SUBSET",
      componentIdentityId: null,
      authority: authority({ reference: "market:attribute:connector" }),
    }],
    buyerIntentTerms: ["Tesla mobile connector", "EV charging adapter"],
    ...overrides,
  })
}

function component(overrides = {}) {
  const expected = {
    lunaProductId: "9220800000001",
    lunaVariantId: "48809000000001",
    lunaSku: "LUNA-NEMA-1430",
    supplierQuantityRequired: 1,
    ...(overrides.expected ?? {}),
  }
  const observed = {
    sourceStatus: "AVAILABLE",
    lunaProductId: expected.lunaProductId,
    lunaVariantId: expected.lunaVariantId,
    lunaSku: expected.lunaSku,
    structuredAttributes: { connector: "Tesla NEMA 14-30 adapter" },
    ...(overrides.observed ?? {}),
  }
  return {
    componentIdentityId: overrides.componentIdentityId ?? COMPONENT_ID,
    expected,
    observed,
    targetResolutionAuthority: overrides.targetResolutionAuthority ??
      "SERVER_RESOLVED_CANONICAL_LUNA_CATALOG",
    canonicalSourceHost: overrides.canonicalSourceHost ?? "www.lunaportex.com",
    evidence: authority({
      reference: overrides.componentIdentityId === SECOND_COMPONENT_ID
        ? "luna:identity:component-2" : "luna:identity:component-1",
      ...(overrides.evidence ?? {}),
    }),
  }
}

function fit(overrides = {}) {
  return buildSellerOsLunaProductFitReceiptV1({
    launchCandidateId: overrides.launchCandidateId ?? CANDIDATE_ID,
    configurationIdentity: overrides.configurationIdentity ?? CONFIGURATION_ID,
    targetProfile: overrides.targetProfile ?? profile(),
    components: overrides.components ?? [component()],
    evaluatedAt: overrides.evaluatedAt ?? NOW,
  })
}

function competition(overrides = {}) {
  const targetProfile = overrides.targetProfile ?? profile()
  return evaluateSellerOsCompetitionGateV1({
    targetProfile,
    familyId: targetProfile.familyId,
    currentMarketObservationId: targetProfile.currentMarketObservationId,
    familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
    sourceStatus: "AVAILABLE",
    competitionState: "MODERATE",
    activeComparableCount: 12,
    sellerDiversity: 6,
    evidence: authority({ reference: "market:competition:window-1",
      evidenceDigest: D("b") }),
    evaluatedAt: NOW,
    ...overrides,
    targetProfile,
  })
}

function economics(overrides = {}) {
  return buildSellerOsProvisionalEconomicsReceiptV1({
    launchCandidateId: CANDIDATE_ID,
    configurationIdentity: CONFIGURATION_ID,
    sourceStatus: "AVAILABLE",
    salePrice: 79.99,
    componentCosts: [{ componentIdentityId: COMPONENT_ID,
      unitCostUsd: 20, supplierQuantityRequired: 1 }],
    outboundShippingCostUsd: 5,
    evidence: authority({ reference: "economics:source-1",
      evidenceDigest: D("c") }),
    evaluatedAt: NOW,
    ...overrides,
  })
}

function listing(overrides = {}) {
  return buildSellerOsListingResearchReadinessV1({
    launchCandidateId: CANDIDATE_ID,
    configurationIdentity: CONFIGURATION_ID,
    sourceStatus: "AVAILABLE",
    productFactsComplete: true,
    authorizedAssetsAvailable: true,
    categoryResolved: true,
    requiredAspectsComplete: true,
    policyBlockers: [],
    evidence: authority({ reference: "listing:readiness-1",
      evidenceDigest: D("d") }),
    evaluatedAt: NOW,
    ...overrides,
  })
}

const SCORE = Object.freeze({
  familyDemandQuality: 80,
  productFit: 90,
  pricePositioning: 75,
  competition: 70,
  economics: 85,
  evidenceFreshness: 95,
  listingReadiness: 90,
  visualAssetReadiness: 80,
})

function finalist(overrides = {}) {
  const targetProfile = overrides.targetProfile ?? profile()
  return evaluateSellerOsI02uFinalistGateV1({
    productFit: overrides.productFit ?? fit({ targetProfile,
      launchCandidateId: overrides.launchCandidateId }),
    competition: overrides.competition ?? competition({ targetProfile }),
    economics: overrides.economics ?? economics({
      launchCandidateId: overrides.launchCandidateId ?? CANDIDATE_ID,
    }),
    listingReadiness: overrides.listingReadiness ?? listing({
      launchCandidateId: overrides.launchCandidateId ?? CANDIDATE_ID,
    }),
    supplyStatus: overrides.supplyStatus ??
      "PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED",
    complianceStatus: overrides.complianceStatus ?? "PASS",
    liveSkuCollision: overrides.liveSkuCollision ?? false,
    configurationConflict: overrides.configurationConflict ?? false,
    bomConflict: overrides.bomConflict ?? false,
    policyBlockers: overrides.policyBlockers ?? [],
    exactProductDemandStatus: overrides.exactProductDemandStatus ?? "UNPROVEN",
    scoreInputs: overrides.scoreInputs ?? SCORE,
    evaluatedAt: overrides.evaluatedAt ?? NOW,
  })
}

test("target profile is deterministic across attribute and intent order", () => {
  const first = profile({
    attributes: [{ key: "connector", expectedValue: "NEMA 14-30",
      attributeClassification: "PROVEN_ATTRIBUTE",
      requirement: "REQUIRED", matchMode: "TOKEN_SUBSET",
      componentIdentityId: null,
      authority: authority({ reference: "market:attribute:connector" }) },
    { key: "color", expectedValue: "Black", requirement: "PREFERRED",
      attributeClassification: "SUPPORTED_ATTRIBUTE",
      matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
      authority: authority({ reference: "market:attribute:color" }) }],
    buyerIntentTerms: ["Tesla mobile connector", "EV charging adapter"],
  })
  const second = profile({ attributes: [...first.attributes].reverse(),
    buyerIntentTerms: [...first.buyerIntentTerms].reverse() })
  assert.equal(first.profileDigest, second.profileDigest)
  assert.equal(first.authority, "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION")
})

test("target attributes require bounded factual authority", () => {
  assert.throws(() => profile({ attributes: [{ key: "connector",
    expectedValue: "NEMA 14-30", requirement: "REQUIRED",
    attributeClassification: "PROVEN_ATTRIBUTE",
    matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
    authority: authority({ authorityClass: "INFERENCE" }) }] }),
  /TARGET_PROFILE_ATTRIBUTE_AUTHORITY_INVALID/)
})

test("supported attributes preserve their factual classification", () => {
  const result = profile({ attributes: [{ key: "connector",
    expectedValue: "NEMA 14-30", requirement: "REQUIRED",
    attributeClassification: "SUPPORTED_ATTRIBUTE",
    matchMode: "TOKEN_SUBSET", componentIdentityId: null,
    authority: authority({ authorityClass: "DURABLY_PERSISTED_FACT" }) }] })
  assert.equal(result.attributes[0].attributeClassification,
    "SUPPORTED_ATTRIBUTE")
})

test("inferred attributes require bounded inference provenance", () => {
  assert.throws(() => profile({ attributes: [{ key: "connector",
    expectedValue: "NEMA 14-30", requirement: "REQUIRED",
    attributeClassification: "INFERRED_ATTRIBUTE",
    matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
    authority: authority({ authorityClass: "DIRECT_OBSERVATION" }) }] }),
  /TARGET_PROFILE_ATTRIBUTE_AUTHORITY_INVALID/)
})

test("duplicate target attribute grain fails closed", () => {
  const item = { key: "connector", expectedValue: "NEMA 14-30",
    attributeClassification: "PROVEN_ATTRIBUTE",
    requirement: "REQUIRED", matchMode: "EXACT_NORMALIZED",
    componentIdentityId: null,
    authority: authority({ reference: "market:attribute:connector" }) }
  assert.throws(() => profile({ attributes: [item, item] }),
    /TARGET_PROFILE_ATTRIBUTE_DUPLICATE/)
})

test("forged target profile digest is rejected before fit", () => {
  const valid = profile()
  assert.throws(() => fit({ targetProfile: { ...valid,
    profileDigest: D("f") } }), /PRODUCT_FIT_TARGET_PROFILE_DIGEST_MISMATCH/)
})

test("exact current Luna identity and required attributes produce STRONG fit", () => {
  const result = fit()
  assert.equal(result.productFit, "STRONG")
  assert.equal(result.exactIdentity, true)
  assert.equal(result.stockFactsUsed, false)
  assert.equal(result.titleSimilarityUsed, false)
})

test("wrong Luna product is a conflicting WEAK fit", () => {
  const result = fit({ components: [component({ observed: {
    lunaProductId: "9220800000002",
  } })] })
  assert.equal(result.productFit, "WEAK")
  assert.ok(result.hardBlockers.includes("LUNA_PRODUCT_ID_CONFLICT"))
})

test("wrong Luna variant is a conflicting WEAK fit", () => {
  const result = fit({ components: [component({ observed: {
    lunaVariantId: "48809000000002",
  } })] })
  assert.equal(result.productFit, "WEAK")
  assert.ok(result.hardBlockers.includes("LUNA_VARIANT_ID_CONFLICT"))
})

test("wrong Luna SKU is a conflicting WEAK fit", () => {
  const result = fit({ components: [component({ observed: {
    lunaSku: "WRONG-SKU",
  } })] })
  assert.equal(result.productFit, "WEAK")
  assert.ok(result.hardBlockers.includes("LUNA_SKU_CONFLICT"))
})

test("unavailable identity source remains UNPROVEN", () => {
  const result = fit({ components: [component({ observed: {
    sourceStatus: "UNAVAILABLE", lunaProductId: null,
    lunaVariantId: null, lunaSku: null,
  } })] })
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes("LUNA_IDENTITY_SOURCE_UNAVAILABLE"))
})

test("stale Luna identity remains UNPROVEN", () => {
  const result = fit({ components: [component({ evidence: {
    observedAt: OLD, maximumAgeSeconds: 60,
  } })] })
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes("LUNA_IDENTITY_EVIDENCE_STALE"))
})

test("stale target-attribute authority cannot produce STRONG", () => {
  const targetProfile = profile({ attributes: [{ key: "connector",
    expectedValue: "NEMA 14-30", requirement: "REQUIRED",
    attributeClassification: "PROVEN_ATTRIBUTE",
    matchMode: "TOKEN_SUBSET", componentIdentityId: null,
    authority: authority({ reference: "market:attribute:connector",
      observedAt: OLD, maximumAgeSeconds: 60 }) }] })
  const result = fit({ targetProfile })
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes(
    "TARGET_PROFILE_ATTRIBUTE_EVIDENCE_STALE"))
})

test("missing required attribute remains UNPROVEN", () => {
  const result = fit({ components: [component({ observed: {
    structuredAttributes: {},
  } })] })
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes(
    "REQUIRED_PRODUCT_ATTRIBUTE_UNPROVEN"))
})

test("conflicting required attribute is WEAK", () => {
  const result = fit({ components: [component({ observed: {
    structuredAttributes: { connector: "NEMA 5-15" },
  } })] })
  assert.equal(result.productFit, "WEAK")
  assert.ok(result.hardBlockers.includes(
    "REQUIRED_PRODUCT_ATTRIBUTE_CONFLICT"))
})

test("inferred required exact text never promotes product fit", () => {
  const targetProfile = profile({ attributes: [{ key: "connector",
    expectedValue: "Tesla NEMA 14-30 adapter", requirement: "REQUIRED",
    attributeClassification: "INFERRED_ATTRIBUTE",
    matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
    authority: authority({ authorityClass: "INFERENCE",
      reference: "research:inference:connector" }) }] })
  const result = fit({ targetProfile })
  assert.equal(result.attributeResults[0].outcome, "UNPROVEN")
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes(
    "REQUIRED_PRODUCT_ATTRIBUTE_UNPROVEN"))
})

test("unproven required exact text never promotes product fit", () => {
  const targetProfile = profile({ attributes: [{ key: "connector",
    expectedValue: "Tesla NEMA 14-30 adapter", requirement: "REQUIRED",
    attributeClassification: "UNPROVEN_ATTRIBUTE",
    matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
    authority: authority({ authorityClass: "UNPROVEN",
      reference: "research:unproven:connector" }) }] })
  const result = fit({ targetProfile })
  assert.equal(result.attributeResults[0].outcome, "UNPROVEN")
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes(
    "REQUIRED_PRODUCT_ATTRIBUTE_UNPROVEN"))
})

test("unproven preferred attribute degrades exact fit to MEDIUM", () => {
  const targetProfile = profile({ attributes: [profile().attributes[0], {
    key: "color", expectedValue: "black", requirement: "PREFERRED",
    attributeClassification: "SUPPORTED_ATTRIBUTE",
    matchMode: "EXACT_NORMALIZED", componentIdentityId: null,
    authority: authority({ reference: "market:attribute:color" }),
  }] })
  const result = fit({ targetProfile })
  assert.equal(result.productFit, "MEDIUM")
})

test("BOM profile attribute without component scope fails closed", () => {
  const second = component({ componentIdentityId: SECOND_COMPONENT_ID,
    expected: { lunaProductId: "9220800000002",
      lunaVariantId: "48809000000002", lunaSku: "SECOND-SKU" },
    observed: { structuredAttributes: { connector: "NEMA 14-30" } } })
  const result = fit({ components: [component(), second] })
  assert.equal(result.productFit, "UNPROVEN")
  assert.ok(result.hardBlockers.includes("BOM_ATTRIBUTE_SCOPE_UNPROVEN"))
})

test("asset-only or arbitrary Luna host cannot become identity target", () => {
  assert.throws(() => fit({ components: [component({
    canonicalSourceHost: "cdn.shopify.com",
  })] }), /PRODUCT_FIT_CANONICAL_LUNA_HOST_REQUIRED/)
})

test("non-server-resolved identity target is rejected", () => {
  assert.throws(() => fit({ components: [component({
    targetResolutionAuthority: "CALLER_PROVIDED",
  })] }), /PRODUCT_FIT_SERVER_RESOLVED_TARGET_REQUIRED/)
})

test("competition gate accepts bounded current evidence", () => {
  const result = competition()
  assert.equal(result.gate, "PASS")
  assert.equal(result.competitionClassification, "ACCEPTABLE")
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_SUPPORTED")
})

test("LOW competition maps to FAVORABLE and remains eligible", () => {
  const result = competition({ competitionState: "LOW" })
  assert.equal(result.competitionClassification, "FAVORABLE")
  assert.equal(result.gate, "PASS")
})

test("HIGH competition maps to DIFFICULT and blocks finalist readiness", () => {
  const targetProfile = profile()
  const market = competition({ targetProfile, competitionState: "HIGH" })
  assert.equal(market.competitionClassification, "DIFFICULT")
  assert.equal(market.gate, "BLOCKED")
  assert.ok(market.blockerCodes.includes("COMPETITION_HIGH"))
  const result = finalist({ targetProfile, competition: market })
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
  assert.ok(result.hardBlockers.includes("COMPETITION_GATE_BLOCKED"))
})

test("active competition evidence alone never proves family demand", () => {
  const result = finalist({ competition: competition({
    familyDemandStatus: "FAMILY_DEMAND_UNPROVEN",
  }) })
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
  assert.ok(result.hardBlockers.includes("FAMILY_DEMAND_GATE_NOT_PROVEN"))
})

test("saturating competition is a hard blocker", () => {
  const result = competition({ competitionState: "SATURATING" })
  assert.equal(result.gate, "BLOCKED")
  assert.equal(result.competitionClassification, "DIFFICULT")
  assert.ok(result.blockerCodes.includes("COMPETITION_SATURATING"))
})

test("UNPROVEN competition maps exactly to UNPROVEN and cannot pass", () => {
  const result = competition({ competitionState: "UNPROVEN" })
  assert.equal(result.competitionClassification, "UNPROVEN")
  assert.equal(result.gate, "UNPROVEN")
})

test("stale competition evidence remains UNPROVEN", () => {
  const result = competition({ evidence: authority({ reference:
    "market:competition:window-old", observedAt: OLD, maximumAgeSeconds: 60 }) })
  assert.equal(result.gate, "UNPROVEN")
})

test("missing active-comparable count keeps competition UNPROVEN", () => {
  const result = competition({ activeComparableCount: null })
  assert.equal(result.gate, "UNPROVEN")
})

test("provisional economics wraps canonical calculator and exact shipping", () => {
  const result = economics()
  assert.equal(result.status, "ECONOMICS_PROVISIONAL_PASS")
  assert.equal(result.outboundShippingCost, 5)
  assert.equal(result.phase6AuthorityClaimed, false)
})

test("unknown shipping is UNPROVEN and never converted to zero", () => {
  const result = economics({ outboundShippingCostUsd: null })
  assert.equal(result.status, "ECONOMICS_UNPROVEN")
  assert.equal(result.outboundShippingCost, null)
  assert.equal(result.unknownShippingTreatedAsZero, false)
  assert.ok(result.blockerCodes.includes("OUTBOUND_SHIPPING_COST_UNPROVEN"))
})

test("unknown supplier cost remains UNPROVEN", () => {
  const result = economics({ componentCosts: [{ componentIdentityId: COMPONENT_ID,
    unitCostUsd: null, supplierQuantityRequired: 1 }] })
  assert.equal(result.status, "ECONOMICS_UNPROVEN")
  assert.ok(result.blockerCodes.includes("SUPPLIER_COST_UNPROVEN"))
})

test("unprofitable economics produces PROVISIONAL_FAIL", () => {
  const result = economics({ salePrice: 20,
    componentCosts: [{ componentIdentityId: COMPONENT_ID,
      unitCostUsd: 18, supplierQuantityRequired: 1 }],
    outboundShippingCostUsd: 5 })
  assert.equal(result.status, "ECONOMICS_PROVISIONAL_FAIL")
})

test("economics preserves multiplier and BOM component quantities", () => {
  const result = economics({ componentCosts: [
    { componentIdentityId: COMPONENT_ID, unitCostUsd: 5,
      supplierQuantityRequired: 3 },
    { componentIdentityId: SECOND_COMPONENT_ID, unitCostUsd: 2,
      supplierQuantityRequired: 2 },
  ] })
  assert.equal(result.supplierProductCost, 19)
})

test("complete listing research evidence passes", () => {
  assert.equal(listing().status, "PASS")
})

test("missing required aspects blocks listing research", () => {
  const result = listing({ requiredAspectsComplete: false })
  assert.equal(result.status, "BLOCKED")
  assert.ok(result.blockerCodes.includes("REQUIRED_ASPECTS_INCOMPLETE"))
})

test("stale listing evidence remains UNPROVEN", () => {
  const result = listing({ evidence: authority({ reference: "listing:old",
    observedAt: OLD, maximumAgeSeconds: 60 }) })
  assert.equal(result.status, "UNPROVEN")
})

test("all hard gates produce one scored READY evaluation", () => {
  const result = finalist()
  assert.equal(result.launchClassification, "READY_FOR_TEST_LAUNCH")
  assert.equal(result.complianceStatus, "PASS")
  assert.ok(result.launchScore > 0)
  assert.equal(result.publishAllowed, false)
  assert.equal(result.p2MutationAllowed, false)
})

test("proven family with exact-product demand unproven may remain a test candidate", () => {
  const targetProfile = profile()
  const result = finalist({ targetProfile,
    competition: competition({ targetProfile,
      familyDemandStatus: "FAMILY_DEMAND_PROVEN" }),
    exactProductDemandStatus: "UNPROVEN" })
  assert.equal(result.launchClassification, "READY_FOR_TEST_LAUNCH")
  assert.equal(result.exactProductDemandStatus, "UNPROVEN")
  assert.equal(result.commercialLabel, "TEST_LAUNCH_CANDIDATE")
  assert.equal(result.provenWinnerClaimed, false)
  assert.ok(result.launchScore > 0)
})

test("exact-product demand state is independent and validated", () => {
  const supported = finalist({ exactProductDemandStatus: "SUPPORTED" })
  assert.equal(supported.exactProductDemandStatus, "SUPPORTED")
  assert.equal(supported.provenWinnerClaimed, false)
  assert.throws(() => finalist({ exactProductDemandStatus: "PROVEN_WINNER" }),
    /FINALIST_EXACT_PRODUCT_DEMAND_STATUS_INVALID/)
})

test("BLOCKED compliance is an independent hard gate", () => {
  const result = finalist({ complianceStatus: "BLOCKED" })
  assert.equal(result.launchScore, null)
  assert.ok(result.hardBlockers.includes("COMPLIANCE_GATE_BLOCKED"))
})

test("UNPROVEN compliance can never become READY", () => {
  const result = finalist({ complianceStatus: "UNPROVEN" })
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
  assert.ok(result.hardBlockers.includes("COMPLIANCE_GATE_UNPROVEN"))
})

test("live SKU collision blocks score and READY", () => {
  const result = finalist({ liveSkuCollision: true })
  assert.equal(result.launchScore, null)
  assert.ok(result.hardBlockers.includes("LIVE_SKU_COLLISION"))
})

test("configuration conflict blocks score and READY", () => {
  const result = finalist({ configurationConflict: true })
  assert.equal(result.launchScore, null)
  assert.ok(result.hardBlockers.includes("CONFIGURATION_CONFLICT"))
})

test("BOM conflict blocks score and READY", () => {
  const result = finalist({ bomConflict: true })
  assert.equal(result.launchScore, null)
  assert.ok(result.hardBlockers.includes("BOM_CONFLICT"))
})

test("server-derived policy blockers cannot be overridden by score", () => {
  const result = finalist({ policyBlockers: ["FORBIDDEN_PRODUCT_POLICY"] })
  assert.equal(result.launchScore, null)
  assert.ok(result.hardBlockers.includes("POLICY_BLOCKER_PRESENT"))
  assert.ok(result.hardBlockers.includes("FORBIDDEN_PRODUCT_POLICY"))
})

test("hard blocker prevents scoring even when score input is invalid", () => {
  const result = finalist({ supplyStatus: "SUPPLY_UNPROVEN",
    scoreInputs: { ...SCORE, economics: Number.NaN } })
  assert.equal(result.launchClassification, "NOT_READY_TO_TEST_LAUNCH")
  assert.equal(result.launchScore, null)
  assert.equal(result.scoreCanOverrideHardBlocker, false)
})

test("invalid score fails only after every hard gate passes", () => {
  assert.throws(() => finalist({ scoreInputs: { ...SCORE,
    economics: Number.NaN } }), /FINALIST_SCORE_ECONOMICS_INVALID/)
})

test("foreign candidate economics cannot enter finalist gate", () => {
  assert.throws(() => finalist({ economics: economics({
    launchCandidateId: SECOND_CANDIDATE_ID,
  }) }), /FINALIST_CANDIDATE_EVIDENCE_BINDING_INVALID/)
})

test("receipts from different evaluation clocks cannot be replayed together", () => {
  const targetProfile = profile()
  assert.throws(() => finalist({ targetProfile,
    economics: economics({ evaluatedAt: "2026-08-22T20:00:01.000Z" }) }),
  /FINALIST_EVIDENCE_TIME_BINDING_INVALID/)
})

test("selector returns no finalist when none qualifies", () => {
  const selected = selectSellerOsI02uFirstListingBuildCandidateV1([
    finalist({ supplyStatus: "SUPPLY_UNPROVEN" }),
  ])
  assert.equal(selected.selectedCount, 0)
  assert.equal(selected.firstListingBuildCandidate, null)
})

test("selector returns at most one highest evidence-adjusted finalist", () => {
  const first = finalist()
  const second = finalist({ launchCandidateId: SECOND_CANDIDATE_ID,
    scoreInputs: { ...SCORE, familyDemandQuality: 99 } })
  const selected = selectSellerOsI02uFirstListingBuildCandidateV1([first, second])
  assert.equal(selected.eligibleCount, 2)
  assert.equal(selected.selectedCount, 1)
  assert.equal(selected.firstListingBuildCandidate.launchCandidateId,
    SECOND_CANDIDATE_ID)
})

test("selector rejects conflicting receipts for one candidate", () => {
  const first = finalist()
  const conflicting = Object.freeze({ ...first,
    productFitReceiptDigest: D("f") })
  assert.throws(() => selectSellerOsI02uFirstListingBuildCandidateV1([
    first, conflicting,
  ]), /FINALIST_DUPLICATE_CONFLICT/)
})

test("selector rejects a forged ready contract", () => {
  const forged = { ...finalist(), publishAllowed: true }
  assert.throws(() => selectSellerOsI02uFirstListingBuildCandidateV1([forged]),
    /FINALIST_SELECTION_CONTRACT_INVALID/)
})

test("selector rejects a forged PROVEN_WINNER claim", () => {
  const forged = { ...finalist(), commercialLabel: "PROVEN_WINNER",
    provenWinnerClaimed: true }
  assert.throws(() => selectSellerOsI02uFirstListingBuildCandidateV1([forged]),
    /FINALIST_SELECTION_CONTRACT_INVALID/)
})

function canaryTransaction(overrides = {}) {
  const calls = []
  let commitCalls = 0
  const operation = (name) => async () => {
    calls.push(name)
    return { outcome: "CREATED" }
  }
  return {
    calls,
    get commitCalls() { return commitCalls },
    transaction: {
      stageEvidencePackage: operation("evidence"),
      stageLaunchCandidate: operation("candidate"),
      stageFamilyEvaluation: operation("evaluation"),
      stageSkuReservation: operation("sku"),
      stageLineage: operation("lineage"),
      rollback: async () => { calls.push("rollback") },
      commit: async () => { commitCalls += 1 },
      ...overrides,
    },
  }
}

test("transactional finalist canary stages in order, rolls back, and never commits", async () => {
  const controlled = canaryTransaction()
  const result = await runSellerOsI02uTransactionalFinalistCanaryV1({
    finalist: finalist(),
    beginTransaction: async () => controlled.transaction,
  })
  assert.deepEqual(controlled.calls,
    ["evidence", "evaluation", "candidate", "sku", "lineage", "rollback"])
  assert.equal(controlled.commitCalls, 0)
  assert.equal(result.stagedOperationCount, 5)
  assert.equal(result.rolledBack, true)
  assert.equal(result.committed, false)
  assert.equal(result.durableWrites, 0)
})

test("canary stage failure still rolls back and never commits", async () => {
  const controlled = canaryTransaction({
    stageFamilyEvaluation: async () => { throw new Error("TEST_FAILURE") },
  })
  await assert.rejects(() => runSellerOsI02uTransactionalFinalistCanaryV1({
    finalist: finalist(), beginTransaction: async () => controlled.transaction,
  }), /FINALIST_CANARY_STAGE_FAILED/)
  assert.equal(controlled.calls.at(-1), "rollback")
  assert.equal(controlled.commitCalls, 0)
})

test("invalid staged receipt still rolls back", async () => {
  const controlled = canaryTransaction({
    stageSkuReservation: async () => ({ outcome: "COMMITTED" }),
  })
  await assert.rejects(() => runSellerOsI02uTransactionalFinalistCanaryV1({
    finalist: finalist(), beginTransaction: async () => controlled.transaction,
  }), /FINALIST_CANARY_STAGE_FAILED/)
  assert.equal(controlled.calls.at(-1), "rollback")
})

test("rollback failure is explicit and commit remains unused", async () => {
  const controlled = canaryTransaction({
    rollback: async () => { throw new Error("ROLLBACK_FAILED") },
  })
  await assert.rejects(() => runSellerOsI02uTransactionalFinalistCanaryV1({
    finalist: finalist(), beginTransaction: async () => controlled.transaction,
  }), /FINALIST_CANARY_ROLLBACK_FAILED/)
  assert.equal(controlled.commitCalls, 0)
})

test("non-ready finalist is rejected before transaction creation", async () => {
  let begins = 0
  await assert.rejects(() => runSellerOsI02uTransactionalFinalistCanaryV1({
    finalist: finalist({ supplyStatus: "SUPPLY_UNPROVEN" }),
    beginTransaction: async () => { begins += 1; return canaryTransaction().transaction },
  }), /FINALIST_CANARY_READY_GATE_REQUIRED/)
  assert.equal(begins, 0)
})
