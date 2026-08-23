import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

const autopilot = await import("./ebay-daily-dollar-radar-autopilot-v1.ts")
const frontierSubject = await import("./ebay-prelinked-profitability-frontier-v1.ts")
const profileSubject = await import(
  "./ebay-prelinked-target-product-profile-and-luna-fit-v1.ts")

const { buildSellerOsDailyDollarRadarAutopilotV1 } = autopilot
const { calculateSellerOsProfitabilityFrontierV1 } = frontierSubject
const { buildSellerOsTargetProductProfileWithAuthorityV1 } = profileSubject

const START = "2026-08-23T06:00:00.000Z"
const OBSERVED = "2026-08-23T07:00:00.000Z"
const END = "2026-08-23T07:30:00.000Z"
const NOW = "2026-08-23T08:00:00.000Z"
const D = (character) => `sha256:${character.repeat(64)}`
const familyId = (character) => `market-family-v1:${D(character)}`
const caseId = (character) => `opportunity-case-v1:${D(character)}`
const observationId = (character) => `family-market-observation-v1:${D(character)}`
const candidateId = (character) => `prelinked-candidate-v1:${D(character)}`
const configurationId = (character) => `launch-configuration-v1:${D(character)}`

function economicEvidence(authorityClass, reference, character = "a") {
  return { authorityClass, reference, evidenceDigest: D(character),
    observedAt: OBSERVED, maximumAgeSeconds: 86_400 }
}

function profileFor(character) {
  return buildSellerOsTargetProductProfileWithAuthorityV1({
    familyId: familyId(character),
    opportunityCaseId: caseId(character),
    currentMarketObservationId: observationId(character),
    attributes: [{
      key: "core function",
      expectedValue: `function-${character}`,
      attributeClassification: "PROVEN_ATTRIBUTE",
      requirement: "REQUIRED",
      matchMode: "EXACT_NORMALIZED",
      componentIdentityId: null,
      authority: economicEvidence("DIRECT_OBSERVATION",
        `capture:profile-${character}`, character),
    }],
    buyerIntentTerms: [`intent ${character}`],
  })
}

function frontierFor(character, overrides = {}) {
  const suffix = character.charCodeAt(0)
  return calculateSellerOsProfitabilityFrontierV1({
    configurationId: overrides.configurationId ?? configurationId(character),
    familyId: overrides.familyId ?? familyId(character),
    familyName: overrides.familyName ?? `Family ${character.toUpperCase()}`,
    familyDemandStatus: overrides.familyDemandStatus ?? "FAMILY_DEMAND_PROVEN",
    lunaProductId: overrides.lunaProductId ?? String(9_220_000_000_000 + suffix),
    lunaVariantId: overrides.lunaVariantId ?? String(48_800_000_000_000 + suffix),
    lunaSku: overrides.lunaSku ?? `LUNA-${character.toUpperCase()}`,
    productFit: overrides.productFit ?? "STRONG",
    components: [{
      componentId: "component:primary",
      unitCostUsd: overrides.unitCostUsd ?? 10.96,
      supplierQuantityRequired: 1,
      costEvidence: economicEvidence("DIRECT_OBSERVATION",
        `luna:cost-${character}`, character),
      quantityEvidence: economicEvidence("DURABLY_PERSISTED_FACT",
        `luna:quantity-${character}`, character),
    }],
    marketPrices: {
      low: { valueUsd: 17, support: "SUPPORTED",
        evidence: economicEvidence("DIRECT_OBSERVATION",
          `market:low-${character}`, character) },
      median: { valueUsd: 27.17, support: "SUPPORTED",
        evidence: economicEvidence("DIRECT_OBSERVATION",
          `market:median-${character}`, character) },
      high: { valueUsd: 40, support: "SUPPORTED",
        evidence: economicEvidence("DIRECT_OBSERVATION",
          `market:high-${character}`, character) },
    },
    shipping: { status: "SHIPPING_PROVISIONAL_RESERVE", valueUsd: 6.99,
      evidence: economicEvidence("PROVISIONAL_ASSUMPTION",
        `policy:shipping-${character}`, character) },
    complianceStatus: "PASS",
    currentHardBlockers: overrides.currentHardBlockers ?? [],
    evidenceAcquisitionCost: "LOW",
    evaluatedAt: NOW,
  })
}

function withFrontierDecision(frontier, overrides) {
  return Object.freeze({ ...frontier, ...overrides,
    frontierDigest: overrides.frontierDigest ?? D("f") })
}

function family(character, overrides = {}) {
  const profile = overrides.targetProfile ?? profileFor(character)
  const frontier = overrides.frontier ?? frontierFor(character, overrides)
  const match = {
    candidateId: overrides.candidateId ?? candidateId(character),
    configurationId: frontier.configurationId,
    lunaIdentity: { productId: frontier.lunaProductId,
      variantId: frontier.lunaVariantId, sku: frontier.lunaSku },
    identityMatchClass: overrides.identityMatchClass ??
      "EXACT_PRODUCT_AND_VARIANT",
    exactProductId: overrides.exactProductId ?? true,
    exactVariantId: overrides.exactVariantId ?? true,
    exactSku: overrides.exactSku ?? true,
    productFit: overrides.productFit ?? frontier.productFit,
    targetProfileDigest: profile.profileDigest,
    identityEvidence: economicEvidence("DIRECT_OBSERVATION",
      `luna:identity-${character}`, character),
    frontier,
  }
  return {
    discoveryStatus: overrides.discoveryStatus,
    radar: {
      familyId: frontier.familyId,
      familyName: frontier.familyName,
      opportunityCaseId: caseId(character),
      currentMarketObservationId: observationId(character),
      familyDemandStatus: frontier.familyDemandStatus,
      competitionStatus: overrides.competitionStatus ?? "UNPROVEN",
      evidenceObservedAt: OBSERVED,
      maximumAgeSeconds: 86_400,
      evidenceDigest: D(character),
      demandEvidenceSummary: {
        demandEvidenceClass: frontier.familyDemandStatus === "FAMILY_DEMAND_PROVEN"
          ? "OFFICIAL_SOLD_EVIDENCE" : "DIRECT_MARKET_OBSERVATION",
        soldComparableCount: 3,
        soldQuantityEvidence: 5,
        priceMedianUsd: 27.17,
        limitations: ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
      },
      momentumStatus: "INSUFFICIENT_HISTORY",
    },
    targetProfile: profile,
    keywordSource: {
      sourceContractVersion: "SELLER_OS_KEYWORD_PACKAGE_SOURCE_V1",
      authorityClass: "DURABLY_PERSISTED_FACT",
      reference: `capture:keyword-${character}`,
      evidenceDigest: D(character),
      observedAt: OBSERVED,
      maximumAgeSeconds: 86_400,
      terms: [`Term ${character}`, `term ${character}`],
    },
    lunaMatches: overrides.lunaMatches ?? [match],
  }
}

function input(families, overrides = {}) {
  return {
    logicalWindow: { startAt: START, endAt: END },
    evidenceCutoffAt: overrides.evidenceCutoffAt ?? END,
    evaluatedAt: NOW,
    maxQueueEntries: overrides.maxQueueEntries ?? 5,
    families,
  }
}

test("builds a bounded evidence-first queue without executing effects", () => {
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([family("a")]))
  assert.equal(result.queueCount, 1)
  assert.equal(result.queueContractVersion, "MORNING_DOLLAR_OPPORTUNITY_QUEUE_V1")
  assert.equal(result.queue[0].dollarPriorityRank, 1)
  assert.equal(result.queue[0].demandStatus, "FAMILY_DEMAND_PROVEN")
  assert.equal(result.queue[0].demandEvidenceSummary.soldComparableCount, 3)
  assert.equal(result.queue[0].frontierInterpretation, "PASSTHROUGH_I02V")
  const expectedQueueEntryHash = createHash("sha256").update(
    `SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1\n${result.queue[0].familyId}\n${result.queue[0].configurationId}\n${result.queue[0].frontierDigest}`,
    "utf8").digest("hex")
  assert.equal(result.queue[0].queueEntryId,
    `morning-dollar-queue-entry-v1:sha256:${expectedQueueEntryHash}`)
  assert.equal(result.queue[0].shipping.status, "SHIPPING_PROVISIONAL_RESERVE")
  assert.equal(result.queue[0].shipping.provisionalReserveUsd, 6.99)
  assert.equal(result.queue[0].shipping.provisionalReserveClaimedAsObserved, false)
  assert.equal(result.frontierRecalculationCount, 0)
  assert.equal(result.searchVolumeClaimed, false)
  assert.equal(result.soldMomentumClaimed, false)
  assert.deepEqual(result.quotaCounters, { externalReads: 0, ebayTradingCalls: 0,
    ebaySellCalls: 0, ebayMarketplaceApiCalls: 0, ebayBrowseCalls: 0,
    ebayMarketplaceInsightsCalls: 0, lunaReads: 0 })
  assert.deepEqual(result.effects, { databaseWrites: 0, marketplaceWrites: 0,
    lunaMutations: 0, p2Mutations: 0, skuReservations: 0,
    listingPublications: 0 })
  assert.equal(result.t0Writes, 0)
  assert.equal(result.t1Writes, 0)
  assert.deepEqual(result.queue[0].buyerIntentTerms, ["intent a"])
  assert.deepEqual(result.queue[0].primaryKeywords, ["intent a"])
  assert.deepEqual(result.queue[0].secondaryKeywords, ["term a"])
  assert.equal(result.queue[0].targetProductProfileSummary.authority,
    "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION")
  assert.equal(result.queue[0].targetProductProfileSummary.requiredAttributes[0]
    .authorityClass, "DIRECT_OBSERVATION")
  assert.deepEqual(result.queue[0].hardBlockers, [])
  assert.deepEqual(result.queue[0].currentHardBlockers, [])
  assert.equal(result.queue[0].topLunaProductId, result.queue[0].lunaProductId)
  assert.equal(result.queue[0].topLunaVariantId, result.queue[0].lunaVariantId)
  assert.equal(result.queue[0].productFit, "STRONG")
  assert.equal(result.queue[0].competitionStatus, "UNPROVEN")
  assert.equal(result.queue[0].contributionPathSummary.authority,
    "CANONICAL_I02V_FRONTIER_PASSTHROUGH")
  assert.equal(result.queue[0].needsFreshEbayVerification, false)
  assert.equal(result.queue[0].nextAction, result.queue[0].nextBestEvidence)
  assert.equal(result.queue[0].nextBestAction, result.queue[0].nextBestEvidence)
  assert.equal(result.discoveryUniverse.boundToCurrentFive, false)
  assert.equal(result.discoveryUniverse.boundToShadow20, false)
  assert.equal(result.familiesEvaluated, 1)
  assert.equal(result.newFamiliesDiscovered, 0)
  assert.equal(result.demandProvenCount, 1)
  assert.equal(result.demandSupportedCount, 0)
  assert.equal(result.lunaMatchCount, 1)
  assert.equal(result.productFitStrongCount, 1)
  assert.equal(result.morningQueueCount, 1)
  assert.equal(result.ebayApiCalls, 0)
  assert.deepEqual(result.runMetrics, {
    familiesEvaluated: 1,
    newFamiliesDiscovered: 0,
    demandProvenCount: 1,
    demandSupportedCount: 0,
    lunaMatchCount: 1,
    productFitStrongCount: 1,
    economicallyDeadCount: 0,
    economicallyRecoverableCount: 1,
    economicallyPromisingCount: 0,
    economicsUnprovenCount: 0,
    morningQueueCount: 1,
    needsFreshEbayVerificationCount: 0,
    ebayApiCalls: 0,
  })
})

test("orders HIGH before MEDIUM before LOW before NEAR_ZERO before score", () => {
  const values = [["a", "NEAR_ZERO", 100], ["b", "LOW", 100],
    ["c", "MEDIUM", 99], ["d", "HIGH", 1]]
  const families = values.map(([character, nextEvidenceValue, score]) => {
    const base = frontierFor(character)
    return family(character, { frontier: withFrontierDecision(base, {
      nextEvidenceValue, dollarPriorityScore: score,
      frontierDigest: D(character),
    }) })
  })
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input(families))
  assert.deepEqual(result.queue.map((entry) => entry.nextEvidenceValue),
    ["HIGH", "MEDIUM", "LOW", "NEAR_ZERO"])
  assert.deepEqual(result.queue.map((entry) => entry.dollarPriorityScore),
    [1, 99, 100, 100])
})

test("caps the deterministic research queue at five", () => {
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input(
    ["a", "b", "c", "d", "e", "f", "1"].map((value) => family(value))))
  assert.equal(result.queueCount, 5)
  assert.deepEqual(result.queue.map((entry) => entry.rank), [1, 2, 3, 4, 5])
})

test("enforces the family and per-family match input bounds", () => {
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input(
    Array.from({ length: 101 }, () => family("a")))),
  /DAILY_RADAR_FAMILY_BOUND_EXCEEDED/)
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    lunaMatches: Array.from({ length: 26 }, () => subject.lunaMatches[0]),
  }])), /DAILY_RADAR_MATCH_BOUND_EXCEEDED/)
})

test("accepts only PROVEN or SUPPORTED family demand", () => {
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    radar: { ...subject.radar, familyDemandStatus: "FAMILY_DEMAND_UNPROVEN" },
  }])), /DAILY_RADAR_DEMAND_NOT_QUALIFIED/)
})

test("title-only identity never becomes a strong queue entry", () => {
  const subject = family("a", { identityMatchClass: "TITLE_ONLY",
    exactProductId: false, exactVariantId: false, productFit: "STRONG" })
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([subject]))
  assert.equal(result.queueCount, 0)
  assert.equal(result.familyAssessments[0].matches[0].identityGate, "BLOCKED")
  assert(result.familyAssessments[0].matches[0].blockerCodes.includes(
    "TITLE_ONLY_MATCH_CANNOT_BE_STRONG"))
})

test("exact product, variant, SKU and authoritative fresh identity are mandatory", () => {
  const subject = family("a")
  const missingSku = { ...subject.lunaMatches[0], exactSku: false }
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    lunaMatches: [missingSku],
  }]))
  assert.equal(result.queueCount, 0)
  assert(result.familyAssessments[0].matches[0].blockerCodes.includes(
    "EXACT_LUNA_SKU_REQUIRED"))
})

test("rejects keyword packages that attempt to claim search volume", () => {
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    keywordSource: { ...subject.keywordSource, searchVolume: 1000 },
  }])), /DAILY_RADAR_KEYWORD_SOURCE_FIELD_FORBIDDEN/)
})

test("requires a bounded keyword source but never claims search volume", () => {
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    keywordSource: { ...subject.keywordSource, terms: [] },
  }])), /DAILY_RADAR_KEYWORDS_BOUND_EXCEEDED/)
})

test("PROVEN demand requires official sold evidence with positive counts", () => {
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    radar: { ...subject.radar, demandEvidenceSummary: {
      ...subject.radar.demandEvidenceSummary,
      demandEvidenceClass: "DIRECT_MARKET_OBSERVATION",
    } },
  }])), /DAILY_RADAR_PROVEN_DEMAND_EVIDENCE_INCOMPLETE/)
})

test("does not reinterpret or recalculate a canonical I02V frontier", () => {
  const subject = family("a")
  const frontier = subject.lunaMatches[0].frontier
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([subject]))
  assert.equal(result.familyAssessments[0].matches[0].frontier, frontier)
  assert.equal(result.queue[0].frontierDigest, frontier.frontierDigest)
  assert.equal(result.frontierRecalculationCount, 0)
})

test("records eBay evidence escalation without making a call", () => {
  const base = frontierFor("a")
  const subject = family("a", { frontier: withFrontierDecision(base, {
    nextBestEvidence: "BETTER_PRICE_DISTRIBUTION",
    nextEvidenceValue: "HIGH",
    frontierDigest: D("e"),
  }) })
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([subject]))
  assert.equal(result.ebayEscalations.length, 1)
  assert.equal(result.ebayEscalations[0].status, "RECORD_ONLY_NOT_EXECUTED")
  assert.equal(result.ebayEscalations[0].requestedCapability,
    "EBAY_SOLD_PRICE_DISTRIBUTION_READ")
  assert.equal(result.ebayEscalations[0].ebayCalls, 0)
  assert.equal(result.quotaCounters.ebayTradingCalls, 0)
  assert.equal(result.queue[0].needsFreshEbayVerification, true)
  assert.equal(result.queue[0].ebayVerificationReason,
    "BETTER_PRICE_DISTRIBUTION")
  assert.equal(result.queue[0].ebayVerificationPriority, "HIGH")
  assert.equal(result.queue[0].ebayVerificationExpectedDecisionValue, "HIGH")
  assert.equal(result.needsFreshEbayVerificationCount, 1)
})

test("preserves canonical I02V hard blockers in the morning queue", () => {
  const subject = family("a", { frontier: frontierFor("a", {
    currentHardBlockers: ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE"],
  }) })
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([subject]))
  assert.equal(result.queueCount, 1)
  assert.deepEqual(result.queue[0].currentHardBlockers,
    ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE"])
})

test("empty queue and an empty discovery input are valid expansion signals", () => {
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([]))
  assert.equal(result.queueCount, 0)
  assert.equal(result.emptyQueueValid, true)
  assert.equal(result.expansionSignal.radarExpansionRequired, "YES")
  assert.equal(result.expansionSignal.discoveryUniverseBoundToShadow20, false)
  assert.equal(result.expansionSignal.discoveryUniverseBoundToCurrentFive, false)
})

test("counts new discovery from explicit input without binding to five families", () => {
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([
    family("a", { discoveryStatus: "NEW_FAMILY_DISCOVERY" }),
    family("b"), family("c"), family("d"), family("e"), family("f"),
  ]))
  assert.equal(result.familiesEvaluated, 6)
  assert.equal(result.newFamiliesDiscovered, 1)
  assert.equal(result.discoveryUniverse.boundToCurrentFive, false)
  assert.equal(result.queueCount, 5)
})

test("suppresses exact family and candidate replay without creating a second T0", () => {
  const subject = family("a")
  const result = buildSellerOsDailyDollarRadarAutopilotV1(input([subject, subject]))
  assert.equal(result.logicalFamilyCount, 1)
  assert.equal(result.logicalMatchCount, 1)
  assert.equal(result.duplicateFamiliesSuppressed, 1)
  assert.equal(result.duplicateCandidatesSuppressed, 1)
  assert.equal(result.t1Writes, 0)
  assert.equal(result.momentumObservationsCreated, 0)
})

test("fails closed for conflicting replay of the same candidate configuration", () => {
  const subject = family("a")
  const altered = { ...subject, lunaMatches: [{ ...subject.lunaMatches[0],
    exactSku: false }] }
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(
    input([subject, altered])), /DAILY_RADAR_CANDIDATE_DUPLICATE_CONFLICT/)
})

test("replay and input order produce the same deterministic digest and queue", () => {
  const left = buildSellerOsDailyDollarRadarAutopilotV1(
    input([family("a"), family("b"), family("c")]))
  const right = buildSellerOsDailyDollarRadarAutopilotV1(
    input([family("c"), family("a"), family("b")]))
  assert.equal(left.autopilotDigest, right.autopilotDigest)
  assert.deepEqual(left.queue.map((entry) => entry.queueEntryId),
    right.queue.map((entry) => entry.queueEntryId))
})

test("validates target profile and frontier subject binding fail closed", () => {
  const subject = family("a")
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    targetProfile: { ...subject.targetProfile, profileDigest: D("f") },
  }])), /DAILY_RADAR_TARGET_PROFILE_DIGEST_MISMATCH/)
  const wrong = withFrontierDecision(subject.lunaMatches[0].frontier, {
    lunaVariantId: "999",
    frontierDigest: D("9"),
  })
  assert.throws(() => buildSellerOsDailyDollarRadarAutopilotV1(input([{ ...subject,
    lunaMatches: [{ ...subject.lunaMatches[0], frontier: wrong }],
  }])), /DAILY_RADAR_FRONTIER_SUBJECT_BINDING_MISMATCH/)
})
