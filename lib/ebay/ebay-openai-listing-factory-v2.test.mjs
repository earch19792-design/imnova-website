import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildListingAiInputHash,
  buildListingAiInputFromDecisionPackage,
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

const now = new Date("2026-07-16T20:00:00.000Z")

function decisionRow(overrides = {}) {
  const fingerprint = "sha256:" + "b".repeat(64)
  const packageHash = "sha256:" + "a".repeat(64)
  const payload = {
    packageVersion: "LOOP1_PACKAGE_V_TEST",
    packageHash,
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
      targetPrice: 32.99,
      premiumPrice: 34.99,
      weightedSoldMedian: 32.5,
      activeMarketMedian: 31.99,
    },
    inventoryEvidence: {
      stockAvailable: 20,
      stockObservedAt: "2026-07-16T19:00:00.000Z",
      costObservedAt: "2026-07-16T19:00:00.000Z",
    },
    comparables: {
      counts: { activeExact: 3, soldOrCompletedExact: 2, estimatedDemandSignals: 1 },
    },
    visualEvidenceAnalysis: {
      status: "AVAILABLE",
      visualPatternConfidence: { level: "MEDIUM", sampleSize: 5 },
      visualEvidenceSummary: { activeExactSampleSize: 3, soldOrCompletedExactSampleSize: 2 },
      mainImagePatterns: [{ pattern: "FULL_PACK_VISIBLE" }],
      secondaryImagePatterns: [{ pattern: "CONTENTS_IMAGE" }],
      recommendedSixImageStrategy: [
        { strategy: "White background main image" },
        { strategy: "Verified pack count" },
        { strategy: "Verified product facts" },
        { strategy: "Verified size and contents" },
        { strategy: "Truthful use context" },
        { strategy: "Exact package contents" },
      ],
    },
    scores: { demandConfidence: 70 },
    compliance: { findings: [] },
    decision: { verdict: "GO", blockers: [] },
    safety: { canPublish: false, ebayWrites: 0 },
    listingAiIntake: {
      approvedKeywords: ["lysol wipes", "lemon wipes", "15 count", "3 pack"],
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
  const input = buildListingAiInputFromDecisionPackage(row, now, { integrityVerified: true })
  return { ...input, ...overrides }
}

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
  assert.doesNotMatch(serialized, /buyer|address|email|phone|token|secret/i)
  assert.doesNotMatch(serialized, /competitorTitle|competitorDescription|imageUrl|sellerUsername/i)
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
  assert.doesNotMatch(prompt.structuredInput, /competitorTitle|competitorDescription|sellerUsername/)
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
