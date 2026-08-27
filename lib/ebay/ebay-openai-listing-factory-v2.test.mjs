import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildListingAiInputHash,
  buildListingAiInputFromDecisionPackage,
  assertListingAiRevisionFactPackageCurrent,
  buildListingAiPrompt,
  createFakeListingAiAdapter,
  createFakeListingAiModelOutput,
  createRealOpenAiListingAdapter,
  evaluateListingAiBudget,
  finalizeListingAiOutput,
  getListingAiConfiguration,
  getListingAiPromptDefinition,
  LISTING_AI_DEFAULT_PROMPT_VERSION,
  listingAiCacheDisposition,
  listingAiCanonicalOutputSchema,
  assessListingAiDecisionPackage,
  validateListingAiModelOutput,
} from "./ebay-openai-listing-factory-v2.ts"
import { buildListingAiEvidenceDistillation } from "./ebay-openai-listing-evidence-distillation.ts"
import { buildListingAiPackStrategy } from "./ebay-openai-listing-pack-strategy.ts"
import {
  AUTHORITATIVE_FACT_SOURCE_POLICY,
  OPENAI_FACTS_INPUT_VERSION,
  productFactsHash,
} from "./ebay-product-facts-readiness.ts"

const now = new Date("2026-07-16T20:00:00.000Z")

function authoritativeFactsPackage(extraFacts = []) {
  const fact = (scope, key, value, sourceTypes = ["LUNA_EXACT_VARIANT"],
    verificationStatus = "VERIFIED", resolutionRule = "FIELD_AUTHORITY_MATRIX") => ({
    scope, key, value, unit: null, verificationStatus, sourceTypes, resolutionRule,
  })
  const facts = [
    fact("PRODUCT_UNIT", "exactProductName", "lysol disinfecting wipes lemon"),
    fact("PRODUCT_UNIT", "brand", "lysol"), fact("PRODUCT_UNIT", "condition", "new"),
    fact("PRODUCT_UNIT", "gtin", "036000291452"), fact("PRODUCT_UNIT", "mpn", "lemon-15"),
    fact("PRODUCT_UNIT", "model", "wipes-lemon"), fact("PRODUCT_UNIT", "unitCount", 15),
    fact("PRODUCT_UNIT", "netContent", "15 count"), fact("PRODUCT_UNIT", "color", "yellow"),
    fact("PRODUCT_UNIT", "scent", "lemon"), fact("PRODUCT_UNIT", "variant", "disinfecting wipes"),
    fact("OFFER_PACK", "offerPackCount", 3), fact("OFFER_PACK", "unitsPerPack", 1),
    fact("OFFER_PACK", "totalUnitCount", 45, ["INTERNAL_DERIVATION"],
      "DERIVED_VERIFIED", "AUTHORIZED_DERIVATION"), ...extraFacts,
  ].sort((left, right) => `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`))
  const hashInput = { version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, facts }
  return { ready: true, facts, version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY,
    factPackageHash: productFactsHash(hashInput), openAiCalls: 0, blockedReason: null }
}

function decisionRow(overrides = {}) {
  const fingerprint = "sha256:" + "b".repeat(64)
  const packageHash = "sha256:" + "a".repeat(64)
  const payload = {
    packageVersion: "LOOP1_PACKAGE_V_TEST",
    packageHash,
    generatedAt: "2026-07-16T19:00:00.000Z",
    marketplace: "EBAY_US",
    candidateId: "00000000-0000-4000-8000-000000000001",
    productIdentity: {
      fingerprint,
      identity: {
        manufacturerBrand: "lysol",
        gtin: "036000291452",
        gtinValid: true,
        mpn: "lemon-15",
        model: "wipes-lemon",
        normalizedProductName: "lysol disinfecting wipes lemon",
        packCount: 3,
        unitCount: 15,
        size: "15 count",
        color: "yellow",
        scent: "lemon",
        variant: "disinfecting wipes",
        condition: "new",
      },
    },
    economics: {
      viable: true,
      supplierPackageCost: 16,
      minimumSafePrice: 28.99,
      idealSafePrice: 31.99,
      aggressiveLaunchPrice: 30.99,
      competitivePrice: 31.99,
      targetPrice: 32.99,
      premiumPrice: 34.99,
      weightedSoldMedian: 32.5,
      activeMarketMedian: 31.99,
      totalBaseCost: 21,
      marketSupportsMinimumSafePrice: true,
      targetEconomics: {
        estimatedProfit: 7.2,
        estimatedRoiPercent: 45,
        estimatedNetMarginPercent: 22,
        estimatedMarketplaceFees: 5.1,
      },
    },
    inventoryEvidence: {
      stockAvailable: 20,
      stockObservedAt: "2026-07-16T19:00:00.000Z",
      costObservedAt: "2026-07-16T19:00:00.000Z",
    },
    comparables: {
      counts: { activeExact: 3, soldOrCompletedExact: 2, estimatedDemandSignals: 1 },
      classified: [
        {
          source: "EBAY_BROWSE_ACTIVE_LISTING", classification: "EXACT_MATCH",
          cohort: "ACTIVE_EXACT_MATCHES", observedAt: "2026-07-16T18:00:00.000Z",
          identity: { packCount: 3, unitCount: 15, variant: "disinfecting wipes" },
          pricing: { landedPrice: 31.99, shippingCost: 0 },
          keywords: ["lysol wipes", "3 pack", "active value"],
          patterns: { shipping: "free shipping", returns: "returns accepted" },
          visualEvidence: { usable: true, observableVisualRisks: [] },
          competitorTitleStored: false,
        },
        {
          source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY", classification: "EXACT_MATCH",
          cohort: "SOLD_OR_COMPLETED_EXACT_MATCHES", observedAt: "2026-07-15T18:00:00.000Z",
          identity: { packCount: 3, unitCount: 15, variant: "disinfecting wipes" },
          pricing: { landedPrice: 32.5, shippingCost: 0 }, confirmedSoldQuantity: 4,
          keywords: ["lysol wipes", "3 pack", "sold proven"],
          patterns: { shipping: "free shipping", returns: "returns accepted" },
          visualEvidence: { usable: true, observableVisualRisks: [] },
        },
        {
          source: "EBAY_BROWSE_ACTIVE_LISTING", classification: "DIFFERENT_PACK",
          cohort: null, observedAt: "2026-07-16T18:00:00.000Z",
          identity: { packCount: 6, unitCount: 15, variant: "disinfecting wipes" },
          pricing: { landedPrice: 57.99, shippingCost: 4 },
          keywords: ["lysol wipes", "6 pack"], patterns: { shipping: "paid shipping" },
          visualEvidence: { usable: true, observableVisualRisks: ["PACK_COUNT_HARD_TO_READ"] },
        },
        {
          source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY", classification: "DIFFERENT_PACK",
          cohort: null, observedAt: "2026-07-14T18:00:00.000Z",
          identity: { packCount: 6, unitCount: 15, variant: "disinfecting wipes" },
          pricing: { landedPrice: 59.99, shippingCost: 0 }, confirmedSoldQuantity: 2,
          keywords: ["lysol wipes", "6 pack"], patterns: { shipping: "free shipping" },
          visualEvidence: { usable: true, observableVisualRisks: [] },
        },
        {
          source: "EBAY_BROWSE_ACTIVE_LISTING", classification: "DIFFERENT_VARIANT",
          cohort: null, identity: { packCount: 3, unitCount: 15, variant: "lavender" },
          pricing: { landedPrice: 29.99, shippingCost: 0 }, keywords: ["lavender wipes"],
        },
      ],
    },
    visualEvidenceAnalysis: {
      status: "AVAILABLE",
      visualPatternConfidence: { level: "MEDIUM", sampleSize: 5 },
      visualEvidenceSummary: { activeExactSampleSize: 3, soldOrCompletedExactSampleSize: 2 },
      mainImagePatterns: [{
        pattern: "FULL_PACK_VISIBLE",
        soldOrCompletedExactMatches: { percent: 100 },
        activeExactMatches: { percent: 50 },
        interpretation: "PATTERN_ASSOCIATED_MORE_WITH_SOLD_OR_COMPLETED_EXACT_MATCHES",
      }],
      secondaryImagePatterns: [{
        pattern: "CONTENTS_IMAGE",
        soldOrCompletedExactMatches: { percent: 100 },
        activeExactMatches: { percent: 25 },
        interpretation: "PATTERN_ASSOCIATED_MORE_WITH_SOLD_OR_COMPLETED_EXACT_MATCHES",
      }],
      differentiationOpportunities: [{ opportunity: "ORIGINAL_CONTENTS_LAYOUT" }],
      recommendedSixImageStrategy: [
        { slot: "MAIN_WHITE_BACKGROUND", strategy: "White background main image", evidenceAssociation: ["FULL_PACK_VISIBLE"] },
        { slot: "PACK_AND_COUNT", strategy: "Verified pack count with all three packs visible", evidenceAssociation: ["FULL_PACK_VISIBLE"] },
        { slot: "KEY_FEATURES", strategy: "Verified product facts", evidenceAssociation: ["CONTENTS_IMAGE"] },
        { slot: "SIZE_AND_CONTENT", strategy: "Verified size and contents", evidenceAssociation: ["CONTENTS_IMAGE"] },
        { slot: "USE_CONTEXT", strategy: "Truthful use context", evidenceAssociation: ["USE_CONTEXT_IMAGE"] },
        { slot: "PACKAGE_CONTENTS", strategy: "Exact package contents", evidenceAssociation: ["CONTENTS_IMAGE"] },
      ],
    },
    scores: { demandConfidence: 70, competitionPressure: 40, keywordOpportunity: 65 },
    compliance: { findings: [] },
    decision: { verdict: "GO", blockers: [] },
    safety: { canPublish: false, ebayWrites: 0 },
    listingAiIntake: {
      approvedKeywords: ["lysol wipes", "lemon wipes", "15 count", "3 pack", "active value", "sold proven"],
      category: { id: "261041", name: "Household Cleaning Products" },
      requiredAspects: [
        { name: "Brand", value: "Lysol" },
        { name: "Scent", value: "Lemon" },
      ],
      optionalAspects: [{ name: "Color", value: "Yellow" }],
      pricingScenarioName: "TARGET_PRICE",
      includedContents: ["3 packs of 15 wipes"],
      complianceRestrictions: ["No medical claims"],
      blockedClaims: ["kills 99.9%"],
      allowedImageFacts: ["3 pack", "15 wipes per pack", "lemon scent"],
      locale: "en-US",
    },
    packStrategyEvidence: {
      offers: [
        {
          packCount: 3, unitCountPerItem: 15, exactContents: ["3 packs of 15 wipes"],
          shippingCost: 5, packageWeight: 3.2,
          packageDimensions: { length: 10, width: 8, height: 6, unit: "in" },
          stockRequired: 1, stockAvailable: 20, offerGtinVerified: false,
        },
        {
          packCount: 6, unitCountPerItem: 15, exactContents: ["6 packs of 15 wipes"],
          cost: 32, shippingCost: 9, fees: 9, minimumSafePrice: 55,
          idealSafePrice: 58, competitivePrice: 58.99, targetPrice: 59.99,
          premiumPrice: 62, estimatedProfit: 8, estimatedRoiPercent: 25,
          estimatedNetMarginPercent: 13, packageWeight: 6.4,
          packageDimensions: { length: 14, width: 10, height: 9, unit: "in" },
          stockRequired: 6, stockAvailable: 20,
        },
      ],
    },
  }
  return {
    id: "00000000-0000-4000-8000-000000000010",
    candidate_id: "00000000-0000-4000-8000-000000000001",
    package_version: payload.packageVersion,
    package_hash: packageHash,
    product_identity_fingerprint: fingerprint,
    verdict: "GO",
    status: "APPROVED",
    package_payload: payload,
    approved_at: "2026-07-16T19:30:00.000Z",
    ...overrides,
  }
}

function factoryInput(overrides = {}) {
  const row = decisionRow()
  const input = buildListingAiInputFromDecisionPackage(row, now, { integrityVerified: true,
    authoritativeFactsPackage: authoritativeFactsPackage() })
  return { ...input, ...overrides }
}

test("OpenAI input requires the bound authoritative package and ignores competitor-like decision facts", () => {
  const row = decisionRow()
  row.package_payload.productIdentity.identity.model = "COMPETITOR-ONLY-MODEL"
  row.package_payload.productIdentity.identity.variant = "COMPETITOR-ONLY-VARIANT"
  assert.throws(() => buildListingAiInputFromDecisionPackage(row, now, { integrityVerified: true }),
    /AUTHORITATIVE_FACT_PACKAGE_REQUIRED/)
  const input = buildListingAiInputFromDecisionPackage(row, now, { integrityVerified: true,
    authoritativeFactsPackage: authoritativeFactsPackage() })
  assert.equal(input.productFacts.model, "wipes-lemon")
  assert.equal(input.productFacts.variant, "disinfecting wipes")
  assert.doesNotMatch(JSON.stringify(input.productFacts), /COMPETITOR-ONLY/)
  assert.match(input.authoritativeFactPackageHash, /^sha256:/)
})

test("NO_GO is rejected while GO and GO_WITH_CHANGES are accepted", () => {
  const noGo = decisionRow({ verdict: "NO_GO" })
  noGo.package_payload.decision.verdict = "NO_GO"
  const noGoAssessment = assessListingAiDecisionPackage(noGo, now, { integrityVerified: true })
  assert.equal(noGoAssessment.eligible, false)
  assert.ok(noGoAssessment.reasons.includes("LOOP1_VERDICT_NOT_ELIGIBLE"))

  const go = assessListingAiDecisionPackage(decisionRow(), now, { integrityVerified: true })
  assert.equal(go.eligible, true)

  const conditional = decisionRow({ verdict: "GO_WITH_CHANGES" })
  conditional.package_payload.decision.verdict = "GO_WITH_CHANGES"
  assert.equal(assessListingAiDecisionPackage(
    conditional, now, { integrityVerified: true },
  ).eligible, true)
})

test("eligibility requires strong identity, viable economics, recent stock/cost and canPublish false", () => {
  const weak = decisionRow()
  weak.package_payload.productIdentity.identity.gtinValid = false
  weak.package_payload.productIdentity.identity.manufacturerBrand = null
  assert.ok(assessListingAiDecisionPackage(weak, now, { integrityVerified: true })
    .reasons.includes("PRODUCT_IDENTITY_NOT_STRONG"))

  const stale = decisionRow()
  stale.package_payload.inventoryEvidence.stockObservedAt = "2026-07-14T00:00:00.000Z"
  assert.ok(assessListingAiDecisionPackage(stale, now, { integrityVerified: true })
    .reasons.includes("STOCK_EVIDENCE_STALE"))

  const unsafe = decisionRow()
  unsafe.package_payload.safety.canPublish = true
  assert.ok(assessListingAiDecisionPackage(unsafe, now, { integrityVerified: true })
    .reasons.includes("LOOP1_CAN_PUBLISH_MUST_BE_FALSE"))
})

test("input contract excludes competitor copy, URLs, PII and secrets", () => {
  const input = factoryInput()
  const serialized = JSON.stringify(input)
  assert.doesNotMatch(serialized, /buyerName|buyerAddress|emailAddress|phoneNumber|accessToken|refreshToken|clientSecret/i)
  assert.doesNotMatch(serialized, /competitor title text|competitor description text|https?:\/\/|sellerUsername/i)
  assert.equal(input.evidenceDistillation.audit.competitorTitlesIncluded, false)
  assert.equal(input.evidenceDistillation.audit.competitorDescriptionsIncluded, false)
  assert.equal(input.marketplace, "EBAY_US")
  assert.equal(input.locale, "en-US")
  assert.equal(input.minimumSafePrice, 28.99)
})

test("same normalized input produces one deterministic inputHash and cache hit costs zero", () => {
  const input = factoryInput()
  const left = buildListingAiInputHash(input, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model")
  const right = buildListingAiInputHash(structuredClone(input), LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model")
  assert.equal(left, right)
  assert.equal(listingAiCacheDisposition("GENERATED"), "CACHE_HIT")
  assert.equal(listingAiCacheDisposition("GENERATING"), "IN_PROGRESS")
  assert.equal(listingAiCacheDisposition("FAILED"), "TERMINAL_NO_RETRY")
})

test("authoritative fact package hash is an explicit cache and generation input boundary", () => {
  const left = factoryInput()
  const right = structuredClone(left)
  right.authoritativeFactPackageHash = `sha256:${"e".repeat(64)}`
  assert.deepEqual(right.productFacts, left.productFacts)
  assert.notEqual(
    buildListingAiInputHash(left, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
    buildListingAiInputHash(right, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
  )
})

test("a revision rejects a newer authoritative fact package instead of reusing the old run", () => {
  const original = factoryInput()
  const storedInputHash = buildListingAiInputHash(
    original, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model",
  )
  assert.equal(assertListingAiRevisionFactPackageCurrent({ factoryInput: original,
    storedInputHash, promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION,
    model: "configured-model" }), storedInputHash)

  const refreshedFacts = structuredClone(original)
  refreshedFacts.authoritativeFactPackageHash = `sha256:${"f".repeat(64)}`
  assert.throws(() => assertListingAiRevisionFactPackageCurrent({
    factoryInput: refreshedFacts, storedInputHash,
    promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION, model: "configured-model",
  }), /LISTING_AI_REVISION_FACT_PACKAGE_STALE/)
})

test("fake adapter emits valid canonical output with six image briefs", async () => {
  const input = factoryInput()
  const result = await createFakeListingAiAdapter().generate(input, {
    promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION,
    revisionNumber: 0,
    validationErrors: [],
  })
  const validation = validateListingAiModelOutput(input, result.output)
  assert.equal(validation.valid, true)
  const canonical = finalizeListingAiOutput({
    modelOutput: validation.output,
    provider: result.provider,
    model: result.model,
    revisionNumber: 0,
    usage: result.usage,
    promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION,
    inputHash: buildListingAiInputHash(input, LISTING_AI_DEFAULT_PROMPT_VERSION, result.model),
  })
  assert.equal(canonical.imageBriefs.length, 6)
  assert.equal(canonical.titleCandidates.length, 3)
  assert.match(canonical.outputHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(listingAiCanonicalOutputSchema.safeParse(canonical).success, true)
})

test("factual validator blocks changed brand, pack, variant, invented GTIN and price floor", () => {
  const input = factoryInput()
  const base = createFakeListingAiModelOutput(input)
  const cases = [
    ["FACT_ASSERTION_MANUFACTURERBRAND_MISMATCH", (output) => { output.factAssertions.manufacturerBrand = "other" }],
    ["FACT_ASSERTION_PACKCOUNT_MISMATCH", (output) => { output.factAssertions.packCount = 2 }],
    ["FACT_ASSERTION_VARIANT_MISMATCH", (output) => { output.factAssertions.variant = "lavender" }],
    ["FACT_ASSERTION_GTIN_MISMATCH", (output) => { output.factAssertions.gtin = "12345670" }],
    ["PRICE_BELOW_MINIMUM_SAFE_PRICE", (output) => { output.pricePresentation.price = 10 }],
  ]
  for (const [expected, mutate] of cases) {
    const output = structuredClone(base)
    mutate(output)
    assert.ok(validateListingAiModelOutput(input, output).factualErrors.includes(expected))
  }
})

test("compliance validator blocks invented claims and unsupported claims", () => {
  const input = factoryInput()
  const medical = createFakeListingAiModelOutput(input)
  medical.description += " FDA approved."
  assert.ok(validateListingAiModelOutput(input, medical).complianceErrors
    .includes("BLOCKED_CLAIM:fda approved"))
  const unsupported = createFakeListingAiModelOutput(input)
  unsupported.unsupportedClaims.push("Unverified certification")
  assert.ok(validateListingAiModelOutput(input, unsupported).complianceErrors
    .includes("UNSUPPORTED_CLAIMS_PRESENT"))
})

test("malformed JSON, schema failure, factual failure, compliance failure and unavailable model are simulated", async () => {
  const input = factoryInput()
  for (const scenario of ["MALFORMED_JSON", "SCHEMA_ERROR"]) {
    const result = await createFakeListingAiAdapter({ scenario }).generate(input, {
      promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION, revisionNumber: 0, validationErrors: [],
    })
    assert.equal(validateListingAiModelOutput(input, result.output).valid, false)
  }
  const factual = await createFakeListingAiAdapter({ scenario: "FACTUAL_FAILURE" }).generate(input, {
    promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION, revisionNumber: 0, validationErrors: [],
  })
  assert.equal(validateListingAiModelOutput(input, factual.output).factualErrors.length > 0, true)
  const compliance = await createFakeListingAiAdapter({ scenario: "COMPLIANCE_FAILURE" }).generate(input, {
    promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION, revisionNumber: 0, validationErrors: [],
  })
  assert.equal(validateListingAiModelOutput(input, compliance.output).complianceErrors.length > 0, true)
  await assert.rejects(
    createFakeListingAiAdapter({ scenario: "UNAVAILABLE_MODEL" }).generate(input, {
      promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION, revisionNumber: 0, validationErrors: [],
    }),
    /OPENAI_LISTING_MODEL_UNAVAILABLE/,
  )
})

test("budget warning and hard stop are deterministic and cannot be bypassed by client", () => {
  const warning = evaluateListingAiBudget({
    spentUsd: 4.95, projectedCostUsd: 0.10, warningBudgetUsd: 5, hardStopUsd: 8,
  })
  assert.equal(warning.warningReached, true)
  assert.equal(warning.hardStopReached, false)
  const blocked = evaluateListingAiBudget({
    spentUsd: 7.95, projectedCostUsd: 0.10, warningBudgetUsd: 5, hardStopUsd: 8,
  })
  assert.equal(blocked.hardStopReached, true)
  assert.equal(blocked.clientBypassAllowed, false)
})

test("configuration is Preview/staging-only, missing key is sanitized and max revisions is one", () => {
  const missing = getListingAiConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_LISTING_FACTORY_ENABLED: "true",
    OPENAI_LISTING_MODEL: "configured-model",
    OPENAI_LISTING_MAX_REVISIONS: "99",
  })
  assert.equal(missing.status, "MISSING_API_KEY")
  assert.equal(missing.apiKey, "MISSING")
  assert.equal(missing.maxRevisions, 1)
  assert.equal(JSON.stringify(missing).includes("OPENAI_API_KEY"), false)
  const production = getListingAiConfiguration({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_LISTING_FACTORY_ENABLED: "true",
    OPENAI_API_KEY: "never-returned",
    OPENAI_LISTING_MODEL: "configured-model",
  })
  assert.equal(production.status, "PREVIEW_STAGING_REQUIRED")
  assert.equal(production.realReady, false)
  assert.equal(JSON.stringify(production).includes("never-returned"), false)
})

test("prompts are versioned, reproducible and contain only structured summaries", () => {
  const definition = getListingAiPromptDefinition()
  assert.match(definition.hashes.system, /^sha256:/)
  assert.match(definition.hashes.generation, /^sha256:/)
  assert.match(definition.hashes.revision, /^sha256:/)
  const prompt = buildListingAiPrompt(factoryInput(), {
    promptVersion: definition.promptVersion,
    revisionNumber: 0,
    validationErrors: [],
  })
  assert.equal(prompt.competitorTitlesIncluded, false)
  assert.equal(prompt.competitorDescriptionsIncluded, false)
  assert.equal(prompt.competitorImagesIncluded, false)
  assert.equal(prompt.competitorUrlsIncluded, false)
  assert.doesNotMatch(prompt.structuredInput, /competitor title text|competitor description text|https?:\/\/|sellerUsername/)
})

test("evidence distillation separates sold and active exact evidence and excludes other packs and variants", () => {
  const row = decisionRow()
  const evidence = buildListingAiEvidenceDistillation(row, now)
  assert.equal(evidence.activeMarket.exactCount, 1)
  assert.equal(evidence.soldEvidence.exactCount, 1)
  assert.equal(evidence.audit.includedActiveExactCount, 1)
  assert.equal(evidence.audit.includedSoldOrCompletedExactCount, 1)
  assert.equal(evidence.audit.excludedNonExactCount, 3)
  assert.equal(evidence.audit.differentPacksIncluded, false)
  assert.equal(evidence.audit.differentVariantsIncluded, false)
  assert.equal(evidence.packStrategy.cohortCounts.activeBaseProductPackVariants, 1)
  assert.equal(evidence.packStrategy.cohortCounts.soldBaseProductPackVariants, 1)
  assert.equal(evidence.packStrategy.cohortCounts.invalidPackComparables, 1)
})

test("sold and active evidence influence original titles differently", () => {
  const output = createFakeListingAiModelOutput(factoryInput())
  assert.match(output.titleCandidates[0], /sold proven/i)
  assert.match(output.titleCandidates[1], /active value/i)
  assert.equal(output.evidenceAttribution.find((entry) => entry.outputSection === "TITLES")
    ?.evidenceSources.includes("SOLD_OR_COMPLETED_EXACT_MATCHES"), true)
  assert.equal(output.differentiationStrategy.causalityClaimed, false)
})

test("visual evidence and seller patterns influence briefs and trust presentation without copying content", () => {
  const input = factoryInput()
  const output = createFakeListingAiModelOutput(input)
  const contentsBrief = output.imageBriefs.find((entry) => entry.slot === "PACKAGE_CONTENTS")
  assert.match(contentsBrief.objective, /Exact package contents/i)
  assert.match(output.differentiationStrategy.visualDifferentiation, /ORIGINAL_CONTENTS_LAYOUT/)
  assert.match(output.differentiationStrategy.trustPresentation, /configured fulfillment and return facts/i)
  assert.equal(input.evidenceDistillation.audit.competitorImagesIncluded, false)
  assert.equal(input.evidenceDistillation.packStrategy.safeguards.competitorContentIncluded, false)
})

test("missing sold evidence reduces confidence and never turns estimated signals into confirmed sales", () => {
  const row = decisionRow()
  row.package_payload.comparables.classified = row.package_payload.comparables.classified
    .filter((entry) => entry.source !== "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
  row.package_payload.economics.weightedSoldMedian = null
  const evidence = buildListingAiEvidenceDistillation(row, now)
  assert.equal(evidence.soldEvidence.exactCount, 0)
  assert.equal(evidence.soldEvidence.confidence, "INSUFFICIENT")
  assert.equal(evidence.soldEvidence.estimatedDemandSignalsExcluded, true)
  assert.equal(evidence.audit.estimatedSignalsPresentedAsSold, false)
})

test("compact evidence omits raw comparable content and is smaller for a repeated market sample", () => {
  const row = decisionRow()
  const source = row.package_payload.comparables.classified[0]
  row.package_payload.comparables.classified = Array.from({ length: 40 }, (_, index) => ({
    ...structuredClone(source),
    sourceListingId: `listing-${index}`,
    fullCompetitorTitle: `competitor title text ${index}`,
    competitorDescription: `competitor description text ${index}`,
    imageUrl: `https://competitor.invalid/${index}.jpg`,
  }))
  const evidence = buildListingAiEvidenceDistillation(row, now)
  const serialized = JSON.stringify(evidence)
  assert.ok(serialized.length < JSON.stringify(row.package_payload).length)
  assert.doesNotMatch(serialized, /competitor title text|competitor description text|competitor\.invalid/)
  assert.equal(evidence.audit.rawComparablesIncluded, false)
})

test("stale Loop 1 package blocks generation and package changes alter the cache hash", () => {
  const stale = decisionRow()
  stale.package_payload.generatedAt = "2026-07-14T00:00:00.000Z"
  assert.ok(assessListingAiDecisionPackage(stale, now, { integrityVerified: true })
    .reasons.includes("LOOP1_PACKAGE_STALE"))

  const input = factoryInput()
  const changed = structuredClone(input)
  changed.packageHash = "sha256:" + "c".repeat(64)
  changed.evidenceDistillation.source.packageHash = changed.packageHash
  changed.evidenceDistillation.distillationHash = "sha256:" + "d".repeat(64)
  assert.notEqual(
    buildListingAiInputHash(input, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
    buildListingAiInputHash(changed, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
  )
})

test("pack strategy separates exact offer, larger packs and different variants", () => {
  const strategy = buildListingAiPackStrategy(decisionRow())
  const pack3 = strategy.packMatrix.find((entry) => entry.packCount === 3)
  const pack6 = strategy.packMatrix.find((entry) => entry.packCount === 6)
  assert.equal(pack3.decision, "RECOMMENDED_PACK")
  assert.equal(pack3.evidenceClassification, "EXACT_PACK_COMPARABLE")
  assert.equal(pack6.decision, "NO_GO_PACK")
  assert.equal(pack6.evidenceClassification,
    "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT")
  assert.equal(pack3.soldEvidenceCount, 1)
  assert.equal(pack6.soldEvidenceCount, 1)
  assert.equal(strategy.cohortCounts.invalidPackComparables, 1)
  assert.equal(strategy.safeguards.differentVariantsIncluded, false)
  assert.equal(strategy.safeguards.differentPackUsedForExactPricing, false)
  assert.notEqual(strategy.baseProductFingerprint, strategy.currentOfferPackFingerprint)
})

test("pack-unknown evidence is counted as an unresolved signal and never enters pack pricing", () => {
  const row = decisionRow()
  row.package_payload.comparables.classified.push({
    source: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
    classification: "NEAR_MATCH",
    packEvidenceClassification: "PACK_UNKNOWN",
    cohort: null,
    observedAt: "2026-07-15T18:00:00.000Z",
    identity: { packCount: null, unitCount: 15, variant: "disinfecting wipes" },
    pricing: {
      landedPrice: null,
      shippingCost: null,
      displayedSoldPrice: 33.99,
      priceEvidenceSemantics: "DISPLAYED_SOLD_PRICE",
      realizedPriceStatus: "UNPROVEN",
      bestOfferStatus: "UNKNOWN",
    },
    confirmedSoldQuantity: 1,
    keywords: ["lysol wipes"],
  })
  const strategy = buildListingAiPackStrategy(row)
  assert.equal(strategy.cohortCounts.packUnknownSignals, 1)
  assert.equal(strategy.commercialRecommendation.packUnknownSignalCount, 1)
  assert.equal(strategy.packMatrix.some((entry) => entry.packCount === null), false)
  assert.equal(strategy.packMatrix.some((entry) => entry.medianPricePerUnit === 33.99), false)
  assert.equal(strategy.safeguards.packUnknownUsedForExactPricing, false)
})

test("recent displayed Sold price remains explicit and pack-specific", () => {
  const row = decisionRow()
  row.package_payload.comparables.classified.push({
    source: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
    classification: "DIFFERENT_PACK",
    packEvidenceClassification: "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT",
    cohort: null,
    observedAt: "2026-07-15T18:00:00.000Z",
    identity: { packCount: 6, unitCount: 15, variant: "disinfecting wipes" },
    pricing: {
      landedPrice: null,
      shippingCost: null,
      displayedSoldPrice: 61.99,
      priceEvidenceSemantics: "DISPLAYED_SOLD_PRICE",
      realizedPriceStatus: "UNPROVEN",
      bestOfferStatus: "EXPLICIT_PRESENT",
    },
    confirmedSoldQuantity: 1,
    keywords: ["lysol wipes", "6 pack"],
  })
  const strategy = buildListingAiPackStrategy(row)
  const pack3 = strategy.packMatrix.find((entry) => entry.packCount === 3)
  const pack6 = strategy.packMatrix.find((entry) => entry.packCount === 6)
  assert.equal(pack3.soldEvidenceCount, 1)
  assert.equal(pack6.soldEvidenceCount, 2)
  assert.deepEqual(pack6.recentSoldPrice.semantics,
    ["PRODUCT_RESEARCH_AGGREGATE", "DISPLAYED_SOLD_PRICE"])
  assert.equal(pack6.recentSoldPrice.displayedOnlyCount, 1)
  assert.equal(pack6.recentSoldPrice.authoritativeRealizedCount, 0)
  assert.equal(pack6.recentSoldPrice.median, 60.99)
})

test("family remains commercially alive when the single/current pack fails but a proven pack passes", () => {
  const row = decisionRow()
  row.package_payload.supplierVariantId = "variant-lysol-lemon-15"
  row.package_payload.supplierSku = "SKU-LYSOL-LEMON-15"
  Object.assign(row.package_payload.economics.targetEconomics, {
    estimatedProfit: -1,
    estimatedRoiPercent: -5,
    estimatedNetMarginPercent: -3,
  })
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    estimatedProfit: 12,
    estimatedRoiPercent: 37.5,
    estimatedNetMarginPercent: 21,
  })
  const strategy = buildListingAiPackStrategy(row)
  const current = strategy.packMatrix.find((entry) => entry.packCount === 3)
  const alternative = strategy.packMatrix.find((entry) => entry.packCount === 6)
  assert.equal(current.decision, "NO_GO_PACK")
  assert.equal(alternative.decision, "TEST_AS_SECONDARY_PACK")
  assert.equal(strategy.commercialRecommendation.familyOpportunityPreserved, true)
  assert.equal(strategy.commercialRecommendation.bestCommercialPackConfiguration.packCount, 6)
  assert.equal(strategy.commercialRecommendation.bestCommercialPackConfiguration
    .contributionProfitPerPack, 12)
  assert.equal(alternative.commercialConfiguration.lunaUnitsRequired, 6)
  assert.equal(alternative.commercialConfiguration.lunaSkuOrVariant,
    "variant-lysol-lemon-15")
  assert.equal(alternative.commercialConfiguration.lunaCostPerPack, 32)
  assert.equal(alternative.commercialConfiguration.shippingExposurePerPack, 9)
  assert.equal(alternative.commercialConfiguration.ebayFeesPerPack, 9)
  assert.equal(alternative.commercialConfiguration.defensibleTargetPricePerPack, 59.99)
})

test("unit versus two-pack remains separate and a multipack never inherits the unit UPC", () => {
  const row = decisionRow()
  row.package_payload.productIdentity.identity.packCount = 1
  row.package_payload.listingAiIntake.includedContents = ["1 pack of 15 wipes"]
  row.package_payload.comparables.classified.push({
    source: "EBAY_BROWSE_ACTIVE_LISTING", classification: "DIFFERENT_PACK", cohort: null,
    identity: { packCount: 2, unitCount: 15, variant: "disinfecting wipes" },
    pricing: { landedPrice: 23.99, shippingCost: 0 }, keywords: ["2 pack"],
  })
  row.package_payload.packStrategyEvidence.offers = [{
    packCount: 1, unitCountPerItem: 15, exactContents: ["1 pack of 15 wipes"],
    packageWeight: 1.1, packageDimensions: { length: 8, width: 5, height: 3, unit: "in" },
    stockRequired: 1, stockAvailable: 20,
  }]
  const strategy = buildListingAiPackStrategy(row)
  assert.ok(strategy.packMatrix.some((entry) => entry.packCount === 1))
  assert.ok(strategy.packMatrix.some((entry) => entry.packCount === 2))
  assert.equal(strategy.safeguards.unitGtinUsedAsMultipackGtin, false)
  assert.equal(factoryInput().productFacts.gtin, null)
})

test("verified sold pack demand drives a separate pack-aligned consumable recommendation", () => {
  const row = decisionRow()
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    targetPrice: 62.99,
    estimatedProfit: 12,
    estimatedRoiPercent: 37.5,
    estimatedNetMarginPercent: 21,
  })
  const strategy = buildListingAiPackStrategy(row)
  const plan = strategy.pairedOfferPlan
  assert.equal(plan.applicability, "CONSUMABLE_REPEAT_PURCHASE")
  assert.equal(plan.demandBasis, "VERIFIED_SOLD_OR_COMPLETED_FIRST")
  assert.equal(plan.recommendedMode, "UNIT_PLUS_SEPARATE_PACK")
  assert.equal(plan.primaryCommercialUnit.packCount, 3)
  assert.equal(plan.optionalPackage.packCount, 6)
  assert.equal(plan.optionalPackage.supplierOfferMultiplier, 2)
  assert.equal(plan.optionalPackage.source, "VERIFIED_SOLD_PACK_LEADER")
  assert.equal(plan.automation.autoPrepareOptionalVariant, true)
  assert.equal(plan.automation.autoPublish, false)
  assert.equal(plan.listingAlignment.titlePackCountMustMatch, true)
  assert.equal(plan.listingAlignment.imageVisiblePackCountMustMatch, true)
  assert.equal(plan.analysisReuse.fullProductResearchRerunRequired, false)
  assert.equal(plan.analysisReuse.packSpecificDeltaReviewRequired, true)
})

test("cheap small items recommend the verified pack that dilutes nearly-flat shipping", () => {
  const row = decisionRow()
  row.package_payload.productIdentity.identity.normalizedProductName =
    "small cable organizer clips"
  row.package_payload.listingAiIntake.category.name = "Cable Organizers"
  row.package_payload.economics.supplierPackageCost = 16
  Object.assign(row.package_payload.packStrategyEvidence.offers[0], {
    shippingCost: 5,
    packageDimensions: {
      length: 6,
      width: 4,
      height: 2,
      unit: "in",
    },
  })
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    shippingCost: 6,
    targetPrice: 62.99,
    estimatedProfit: 12,
    estimatedRoiPercent: 37.5,
    estimatedNetMarginPercent: 21,
  })
  const opportunity =
    buildListingAiPackStrategy(row).lowCostSmallItemOpportunity
  assert.equal(opportunity.status, "PACK_RECOMMENDED")
  assert.equal(opportunity.trigger.unitSupplierCostUsd, 5.33)
  assert.equal(opportunity.trigger.unitCostBelowThreshold, true)
  assert.equal(opportunity.trigger.smallItemConfirmed, true)
  assert.deepEqual(opportunity.proposedPackCounts, [6, 9, 12])
  assert.equal(opportunity.shippingComparison.recommendedPackCount, 6)
  assert.equal(
    opportunity.shippingComparison.shippingCostPerBaseItemReductionPercent,
    40,
  )
  assert.equal(opportunity.autoPublish, false)
})

test("cheap-item pack proposal waits for exact size and excludes cost exactly USD 6", () => {
  const missingSize = decisionRow()
  missingSize.package_payload.economics.supplierPackageCost = 15
  missingSize.package_payload.packStrategyEvidence.offers[0]
    .packageDimensions = null
  assert.equal(
    buildListingAiPackStrategy(missingSize).lowCostSmallItemOpportunity.status,
    "NEEDS_SIZE_OR_SHIPPING_EVIDENCE",
  )

  const threshold = decisionRow()
  threshold.package_payload.economics.supplierPackageCost = 18
  threshold.package_payload.packStrategyEvidence.offers[0]
    .packageDimensions = {
      length: 6,
      width: 4,
      height: 2,
      unit: "in",
    }
  const opportunity =
    buildListingAiPackStrategy(threshold).lowCostSmallItemOpportunity
  assert.equal(opportunity.trigger.unitSupplierCostUsd, 6)
  assert.equal(opportunity.trigger.unitCostBelowThreshold, false)
  assert.equal(opportunity.status, "NOT_APPLICABLE")
})

test("the optional sold-led pack never leaks into the current listing content", () => {
  const row = decisionRow()
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    targetPrice: 62.99,
    estimatedProfit: 12,
    estimatedRoiPercent: 37.5,
    estimatedNetMarginPercent: 21,
  })
  const input = buildListingAiInputFromDecisionPackage(row, now, {
    integrityVerified: true,
    authoritativeFactsPackage: authoritativeFactsPackage(),
  })
  const output = createFakeListingAiModelOutput(input)
  assert.equal(
    input.evidenceDistillation.packStrategy.pairedOfferPlan.optionalPackage
      .packCount,
    6,
  )
  assert.equal(output.pricePresentation.packCount, 3)
  assert.equal(output.factAssertions.packCount, 3)
  assert.match(
    output.imageBriefs.find((entry) => entry.slot === "PACK_AND_COUNT")
      .objective,
    /exactly 3 pack units/i,
  )
  assert.ok(output.titleCandidates.every((title) => /\b3 Pack\b/i.test(title)))
  assert.ok(output.titleCandidates.every((title) => !/\b6 Pack\b/i.test(title)))
})

test("active-only consumable pack evidence becomes an exploratory volume-pricing preview", () => {
  const row = decisionRow()
  row.package_payload.comparables.classified =
    row.package_payload.comparables.classified.filter((entry) =>
      entry.classification !== "DIFFERENT_PACK"
      || entry.source !== "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    targetPrice: 60.99,
    estimatedProfit: 11,
    estimatedRoiPercent: 34,
    estimatedNetMarginPercent: 20.5,
  })
  const plan = buildListingAiPackStrategy(row).pairedOfferPlan
  assert.equal(plan.demandBasis, "ACTIVE_PACK_PATTERN_EXPLORATORY")
  assert.equal(plan.recommendedMode, "UNIT_PLUS_VOLUME_PRICING")
  assert.equal(plan.optionalPackage.packCount, 6)
  assert.equal(plan.volumePricing.status, "READY_FOR_FINAL_RECALCULATION")
  assert.equal(plan.volumePricing.tiers[0].minimumQuantity, 2)
  assert.ok(plan.volumePricing.tiers[0].calculatedDiscountPercent >= 5)
  assert.equal(plan.analysisReuse.activeListingsTreatedAsSales, false)
  assert.equal(plan.automation.autoCreatePromotionPreview, true)
  assert.equal(plan.automation.publications, 0)
})

test("sold pack leader outranks a more common active-only pack", () => {
  const row = decisionRow()
  Object.assign(row.package_payload.packStrategyEvidence.offers[1], {
    targetPrice: 62.99,
    estimatedProfit: 12,
    estimatedRoiPercent: 37.5,
    estimatedNetMarginPercent: 21,
  })
  for (let index = 0; index < 5; index += 1) {
    row.package_payload.comparables.classified.push({
      source: "EBAY_BROWSE_ACTIVE_LISTING",
      classification: "DIFFERENT_PACK",
      cohort: null,
      identity: {
        packCount: 9,
        unitCount: 15,
        variant: "disinfecting wipes",
      },
      pricing: { landedPrice: 89.99, shippingCost: 0 },
      keywords: ["9 pack"],
    })
  }
  row.package_payload.packStrategyEvidence.offers.push({
    packCount: 9,
    unitCountPerItem: 15,
    exactContents: ["9 packs of 15 wipes"],
    cost: 48,
    shippingCost: 12,
    fees: 13,
    minimumSafePrice: 82,
    idealSafePrice: 86,
    competitivePrice: 88,
    targetPrice: 89.99,
    premiumPrice: 92,
    estimatedProfit: 12,
    estimatedRoiPercent: 35,
    estimatedNetMarginPercent: 20,
    packageWeight: 9.6,
    packageDimensions: {
      length: 18,
      width: 12,
      height: 10,
      unit: "in",
    },
    stockRequired: 9,
    stockAvailable: 20,
  })
  const plan = buildListingAiPackStrategy(row).pairedOfferPlan
  assert.equal(plan.optionalPackage.packCount, 6)
  assert.equal(plan.optionalPackage.source, "VERIFIED_SOLD_PACK_LEADER")
  assert.deepEqual(plan.evidencePriority, [
    "VERIFIED_SOLD_OR_COMPLETED",
    "ACTIVE_EXACT_PACK",
    "ESTIMATED_SIGNALS",
  ])
})

test("non-consumables do not enter the paired offer automation", () => {
  const row = decisionRow()
  row.package_payload.productIdentity.identity.normalizedProductName =
    "powder coated enamel colander"
  row.package_payload.listingAiIntake.category.name =
    "Kitchen Colanders"
  const plan = buildListingAiPackStrategy(row).pairedOfferPlan
  assert.equal(plan.applicability, "NOT_APPLICABLE")
  assert.equal(plan.recommendedMode, "UNIT_ONLY")
  assert.ok(plan.blockers.includes(
    "PAIRED_OFFER_NOT_REPEAT_PURCHASE_CONSUMABLE",
  ))
})

test("large pack stock, high shipping and margin-destroying discount are blocked", () => {
  const stock = decisionRow()
  stock.package_payload.packStrategyEvidence.offers[1].stockAvailable = 2
  assert.equal(buildListingAiPackStrategy(stock).packMatrix.find((entry) => entry.packCount === 6)
    .decision, "OPERATIONALLY_UNSAFE")

  const shipping = decisionRow()
  shipping.package_payload.packStrategyEvidence.offers[1].shippingCost = 30
  assert.equal(buildListingAiPackStrategy(shipping).packMatrix.find((entry) => entry.packCount === 6)
    .decision, "OPERATIONALLY_UNSAFE")

  const margin = buildListingAiPackStrategy(decisionRow()).packMatrix.find((entry) => entry.packCount === 6)
  assert.equal(margin.economics.meetsMinimumRoi, false)
  assert.equal(margin.economics.meetsMinimumMargin, false)
  assert.equal(margin.decision, "NO_GO_PACK")
})

test("recommended pack controls titles, quantity FAQ and image brief without publishing", () => {
  const input = factoryInput()
  const output = createFakeListingAiModelOutput(input)
  assert.equal(output.titleCandidates.every((title) => /3\s*[- ]?pack/i.test(title)), true)
  assert.ok(output.faq.some((entry) => /how many units/i.test(entry.question) && /45 total units/i.test(entry.answer)))
  assert.match(output.imageBriefs.find((entry) => entry.slot === "PACK_AND_COUNT").objective, /3 pack units and 45 total units/)
  assert.equal(validateListingAiModelOutput(input, output).valid, true)
  assert.equal(input.evidenceDistillation.packStrategy.safeguards.ebayWrites, 0)
  assert.equal(input.evidenceDistillation.packStrategy.safeguards.publications, 0)
})

test("pack with no exact evidence returns INSUFFICIENT_EVIDENCE", () => {
  const row = decisionRow()
  row.package_payload.comparables.classified = row.package_payload.comparables.classified
    .filter((entry) => entry.classification !== "EXACT_MATCH")
  const current = buildListingAiPackStrategy(row).packMatrix.find((entry) => entry.packCount === 3)
  assert.equal(current.evidenceConfidence, "INSUFFICIENT")
  assert.equal(current.decision, "INSUFFICIENT_EVIDENCE")
})

test("cache hash changes when pack operations evidence changes", () => {
  const leftRow = decisionRow()
  const rightRow = decisionRow()
  rightRow.package_payload.packStrategyEvidence.offers[0].packageWeight = 3.4
  const left = buildListingAiInputFromDecisionPackage(leftRow, now, { integrityVerified: true,
    authoritativeFactsPackage: authoritativeFactsPackage() })
  const right = buildListingAiInputFromDecisionPackage(rightRow, now, { integrityVerified: true,
    authoritativeFactsPackage: authoritativeFactsPackage() })
  assert.notEqual(left.evidenceDistillation.packStrategy.strategyHash,
    right.evidenceDistillation.packStrategy.strategyHash)
  assert.notEqual(left.evidenceDistillation.distillationHash,
    right.evidenceDistillation.distillationHash)
  assert.notEqual(
    buildListingAiInputHash(left, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
    buildListingAiInputHash(right, LISTING_AI_DEFAULT_PROMPT_VERSION, "configured-model"),
  )
})

test("real adapter uses Responses structured output, store false and never returns key/request id", async () => {
  const originalFetch = globalThis.fetch
  const input = factoryInput()
  const output = createFakeListingAiModelOutput(input)
  let body = null
  let authorization = null
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body))
    authorization = init.headers.Authorization
    return new Response(JSON.stringify({
      id: "resp_private_identifier",
      status: "completed",
      output_text: JSON.stringify(output),
      usage: {
        input_tokens: 120,
        output_tokens: 240,
        input_tokens_details: { cached_tokens: 20 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    const adapter = createRealOpenAiListingAdapter({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
      OPENAI_LISTING_FACTORY_ENABLED: "true",
      OPENAI_API_KEY: "server-secret",
      OPENAI_LISTING_MODEL: "configured-model",
      OPENAI_LISTING_PROMPT_VERSION: LISTING_AI_DEFAULT_PROMPT_VERSION,
      OPENAI_LISTING_MAX_RETRIES: "0",
    })
    const result = await adapter.generate(input, {
      promptVersion: LISTING_AI_DEFAULT_PROMPT_VERSION,
      revisionNumber: 0,
      validationErrors: [],
    })
    assert.equal(body.store, false)
    assert.equal(body.text.format.type, "json_schema")
    assert.equal(body.text.format.strict, true)
    assert.equal(body.model, "configured-model")
    assert.equal(authorization, "Bearer server-secret")
    assert.match(result.sanitizedRequestId, /^sha256:[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(result).includes("server-secret"), false)
    assert.equal(JSON.stringify(result).includes("resp_private_identifier"), false)
    assert.equal(result.usage.cachedInputTokens, 20)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("migration, endpoints and UI enforce RLS, append-only audit, admin auth and zero eBay writes", () => {
  const migration = readFileSync(
    "supabase/migrations/20260716200000_create_openai_listing_factory_v2.sql", "utf8",
  )
  for (const table of [
    "ai_listing_generation_runs", "ai_listing_generation_versions",
    "ai_listing_validation_results", "ai_listing_prompt_versions",
    "ai_listing_budget_usage", "ai_listing_approvals",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`))
  assert.equal((migration.match(/enable row level security/g) ?? []).length, 6)
  assert.match(migration, /revoke all.*authenticated, service_role/i)
  assert.doesNotMatch(migration, /drop\s+table|delete\s+from|truncate/i)
  assert.match(migration, /grant select, insert on table public\.ai_listing_generation_versions to service_role/)
  assert.doesNotMatch(migration, /grant[^;]*update[^;]*ai_listing_generation_versions/i)
  assert.match(migration, /marketplace_account_key, marketplace, input_hash, model, prompt_version/)

  const routes = [
    "app/api/admin/ebay/listing-ai/generate/route.ts",
    "app/api/admin/ebay/listing-ai/status/route.ts",
    "app/api/admin/ebay/listing-ai/generations/[id]/route.ts",
    "app/api/admin/ebay/listing-ai/generations/[id]/approve/route.ts",
    "app/api/admin/ebay/listing-ai/generations/[id]/reject/route.ts",
    "app/api/admin/ebay/listing-ai/generations/[id]/request-revision/route.ts",
  ].map((path) => readFileSync(path, "utf8")).join("\n")
  assert.match(routes, /authorizeListingAiRequest/g)
  assert.match(routes, /enforceListingAiRouteRateLimit/g)
  assert.doesNotMatch(routes, /adapterMode|OPENAI_API_KEY|publishOffer|shipping_fulfillment/)

  const ui = readFileSync(
    "app/admin/ebay/mobile-review/loop2-listing-ai-panel.tsx", "utf8",
  )
  assert.match(ui, /ACTIVE LOOP/)
  assert.match(ui, /LOOP 1 PACKAGE/)
  assert.match(ui, /BACKGROUND MONITOR/)
  assert.match(ui, /Generar listing con IA/)
  assert.match(ui, /Restaurar versión anterior/)
  assert.doesNotMatch(ui, /OPENAI_API_KEY|Publicar|publishOffer/)
  assert.match(ui, /ebayWrites: 0/)
})
