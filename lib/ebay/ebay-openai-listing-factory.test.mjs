import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildListingFactoryPrompt,
  createFakeListingFactoryAdapter,
  createFakeListingFactoryOutput,
  createOpenAiListingFactoryAdapter,
  getOpenAiListingFactoryConfiguration,
  listingFactoryOutputSchema,
  OPENAI_LISTING_FACTORY_SCHEMA_VERSION,
  validateListingFactoryOutput,
} from "./ebay-openai-listing-factory.ts"

function factoryInput(overrides = {}) {
  return {
    decisionPackageId: "00000000-0000-4000-8000-000000000001",
    decisionPackageHash: "sha256:" + "a".repeat(64),
    identityFingerprint: "sha256:" + "b".repeat(64),
    verdict: "GO",
    productFacts: {
      manufacturerBrand: "lysol",
      gtin: "036000291452",
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
    economics: {
      minimumSafePrice: 28.99,
      targetPrice: 32.99,
      premiumPrice: 34.99,
      estimatedProfit: 7.5,
      estimatedRoiPercent: 45,
      estimatedNetMarginPercent: 22.7,
    },
    evidence: {
      activeExactCount: 3,
      soldOrCompletedExactCount: 2,
      estimatedDemandSignalCount: 1,
      weightedSoldMedian: 32.5,
      activeMarketMedian: 31.99,
    },
    authorizedKeywords: [
      "lysol wipes", "lemon wipes", "disinfecting wipes", "15 count", "3 pack",
    ],
    category: {
      categoryId: "261041",
      categoryName: "Household Cleaning Products",
      requiredAspects: [
        { name: "Brand", value: "Lysol" },
        { name: "Scent", value: "Lemon" },
      ],
    },
    complianceRestrictions: ["kills 99.9%"],
    shipping: { policyName: "Tracked shipping", handlingTimeDays: 1 },
    returns: { policyName: "30-day returns", returnsAccepted: true, returnPeriodDays: 30 },
    ...overrides,
  }
}

test("fake adapter returns strict, complete JSON with six image briefs", async () => {
  const input = factoryInput()
  const result = await createFakeListingFactoryAdapter().generate(input, {
    promptVersion: "PROMPT_V1",
    revision: 0,
    validationErrors: [],
  })
  const parsed = listingFactoryOutputSchema.parse(result.output)
  assert.equal(parsed.schemaVersion, OPENAI_LISTING_FACTORY_SCHEMA_VERSION)
  assert.equal(parsed.titleCandidates.length, 3)
  assert.equal(parsed.imageBriefs.length, 6)
  assert.equal(new Set(parsed.imageBriefs.map((brief) => brief.slot)).size, 6)
  assert.equal(parsed.imageBriefs.every((brief) => brief.preserveOriginalPackage), true)
  assert.equal(result.provider, "FAKE")
})

test("factual validator preserves identifiers, pack, variant and minimum price", () => {
  const input = factoryInput()
  const output = createFakeListingFactoryOutput(input)
  const validation = validateListingFactoryOutput(input, output)
  assert.equal(validation.valid, true)
  assert.deepEqual(validation.factualErrors, [])
  assert.deepEqual(validation.complianceErrors, [])

  const changedPack = structuredClone(output)
  changedPack.factAssertions.packCount = 2
  assert.ok(validateListingFactoryOutput(input, changedPack).factualErrors.includes(
    "FACT_ASSERTION_PACKCOUNT_MISMATCH",
  ))

  const lowPrice = structuredClone(output)
  lowPrice.pricePresentation.price = 10
  assert.ok(validateListingFactoryOutput(input, lowPrice).factualErrors.includes(
    "PRICE_BELOW_MINIMUM_SAFE_PRICE",
  ))
})

test("compliance validator blocks invented or restricted claims", () => {
  const input = factoryInput()
  const output = createFakeListingFactoryOutput(input)
  output.description += " FDA approved and kills 99.9%."
  const validation = validateListingFactoryOutput(input, output)
  assert.equal(validation.valid, false)
  assert.ok(validation.complianceErrors.includes("BLOCKED_TERM:fda approved"))
  assert.ok(validation.complianceErrors.includes("BLOCKED_TERM:kills 99.9%"))
})

test("prompt is versioned and contains no competitor content channel", () => {
  const prompt = buildListingFactoryPrompt(factoryInput(), {
    promptVersion: "LISTING_PROMPT_2026_07_16",
    revision: 0,
    validationErrors: [],
  })
  assert.equal(prompt.promptVersion, "LISTING_PROMPT_2026_07_16")
  assert.equal(prompt.competitorContentIncluded, false)
  assert.match(prompt.system, /Never copy competitor titles/)
  assert.doesNotMatch(prompt.user, /sellerUsername|competitorTitle|competitorDescription/)
})

test("OpenAI configuration is sanitized and fake adapter remains available", () => {
  const missing = getOpenAiListingFactoryConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
  })
  assert.equal(missing.key, "MISSING")
  assert.equal(missing.realReady, false)
  assert.equal(missing.fakeAdapterReady, true)
  assert.equal(missing.secretsReturnedToBrowser, false)
  const ready = getOpenAiListingFactoryConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "secret-never-returned",
    OPENAI_LISTING_FACTORY_ENABLED: "true",
    OPENAI_LISTING_MODEL: "configured-model",
    OPENAI_LISTING_PROMPT_VERSION: "PROMPT_V1",
  })
  assert.equal(ready.status, "READY")
  assert.equal(JSON.stringify(ready).includes("secret-never-returned"), false)
})

test("real adapter uses Responses structured outputs server-side with store false", async () => {
  const originalFetch = globalThis.fetch
  let requestBody = null
  let authorization = null
  const output = createFakeListingFactoryOutput(factoryInput())
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body))
    authorization = init.headers.Authorization
    return new Response(JSON.stringify({
      id: "resp_private_identifier",
      status: "completed",
      output_text: JSON.stringify(output),
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    }), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    const adapter = createOpenAiListingFactoryAdapter({
      OPENAI_API_KEY: "server-secret",
      OPENAI_LISTING_MODEL: "configured-model",
      OPENAI_LISTING_TIMEOUT_MS: "5000",
      OPENAI_LISTING_MAX_RETRIES: "0",
    })
    const result = await adapter.generate(factoryInput(), {
      promptVersion: "PROMPT_V1",
      revision: 0,
      validationErrors: [],
    })
    assert.equal(requestBody.store, false)
    assert.equal(requestBody.text.format.type, "json_schema")
    assert.equal(requestBody.text.format.strict, true)
    assert.equal(requestBody.model, "configured-model")
    assert.equal(authorization, "Bearer server-secret")
    assert.equal(JSON.stringify(result).includes("server-secret"), false)
    assert.match(result.responseFingerprint, /^sha256:[0-9a-f]{64}$/)
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      estimatedCostUsd: null,
      costStatus: "NOT_CALCULATED",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("route, service and migration enforce human approval, RLS and zero eBay writes", () => {
  const route = readFileSync("app/api/admin/ebay/listing-factory/route.ts", "utf8")
  const service = readFileSync("lib/ebay/ebay-openai-listing-factory-service.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260716141000_create_openai_listing_factory_v1.sql",
    "utf8",
  )
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /approve_decision_package/)
  assert.match(route, /approve_generation/)
  assert.match(service, /status !== "APPROVED"/)
  assert.match(service, /ebayWrites: 0/g)
  assert.match(migration, /enable row level security/gi)
  assert.match(migration, /revoke all.*anon, authenticated, service_role/gi)
  assert.match(migration, /grant select, insert, update.*service_role/i)
  assert.match(migration, /grant select, insert.*generation_attempts.*service_role/i)
  assert.doesNotMatch(migration, /drop\s+table|delete\s+from|truncate/i)
})
