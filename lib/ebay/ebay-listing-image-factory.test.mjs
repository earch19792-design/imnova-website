import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  buildSafeOpenAiBackgroundPlatePlan,
  composeAuthorizedEbayListingImageSet,
  EBAY_LISTING_IMAGE_SLOTS,
  getListingImageFactoryConfiguration,
  requestSafeOpenAiBackgroundPlate,
  validateListingImageFactoryInput,
} from "./ebay-listing-image-factory.ts"

function input() {
  return {
    identityFingerprint: `sha256:${"a".repeat(64)}`,
    facts: {
      manufacturerBrand: "Lysol",
      normalizedProductName: "Lysol disinfecting wipes lemon",
      packCount: 3,
      unitCount: 15,
      size: "15 count",
      color: "yellow",
      scent: "lemon",
      variant: "disinfecting wipes",
      condition: "new",
    },
    briefs: EBAY_LISTING_IMAGE_SLOTS.map((slot) => ({
      slot,
      objective: `Verified objective for ${slot}`,
      overlayText: null,
      preserveOriginalPackage: true,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
    })),
  }
}

async function authorizedFixture() {
  return sharp({
    create: { width: 900, height: 900, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600">' +
      '<rect x="20" y="20" width="460" height="560" rx="30" fill="#f6d146"/>' +
      '<text x="250" y="270" text-anchor="middle" font-size="72" font-family="Arial">SOURCE</text>' +
      '<text x="250" y="360" text-anchor="middle" font-size="42" font-family="Arial">3 × 15</text>' +
      '</svg>',
    ),
    left: 200,
    top: 150,
  }]).jpeg().toBuffer()
}

test("composes exactly six JPEG assets from one authorized source", async () => {
  const source = await authorizedFixture()
  const assets = await composeAuthorizedEbayListingImageSet(source, input())
  assert.deepEqual(assets.map((asset) => asset.slot), EBAY_LISTING_IMAGE_SLOTS)
  assert.equal(new Set(assets.map((asset) => asset.outputSha256)).size, 6)
  assert.equal(new Set(assets.map((asset) => asset.sourceSha256)).size, 1)
  for (const asset of assets) {
    const metadata = await sharp(asset.output).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, 1600)
    assert.equal(metadata.height, 1600)
    assert.equal(asset.transformation.competitorImageUsed, false)
    assert.equal(asset.transformation.originalPackagePixelsPreserved, true)
    assert.equal(asset.qa.humanApprovalRequired, true)
  }
})

test("main image has pure-white corners and no promotional overlay", async () => {
  const assets = await composeAuthorizedEbayListingImageSet(
    await authorizedFixture(),
    input(),
  )
  const main = assets[0]
  const pixel = await sharp(main.output).extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw().toBuffer()
  assert.deepEqual([...pixel.slice(0, 3)], [255, 255, 255])
  assert.equal(main.slot, "MAIN_WHITE_BACKGROUND")
  assert.equal(main.qa.mainBackground, "PURE_WHITE")
})

test("rejects duplicated or missing image slots", () => {
  const value = input()
  value.briefs[5] = { ...value.briefs[5], slot: "PACK_AND_COUNT" }
  assert.throws(
    () => validateListingImageFactoryInput(value),
    /EBAY_IMAGE_SET_SLOTS_DUPLICATED/,
  )
})

test("rejects unapproved source policy and package-redraw briefs", () => {
  const unsafe = input()
  unsafe.briefs[0] = {
    ...unsafe.briefs[0],
    preserveOriginalPackage: false,
    sourcePolicy: "COMPETITOR_IMAGE",
  }
  assert.throws(() => validateListingImageFactoryInput(unsafe))
})

test("sanitized configuration never returns an OpenAI key", () => {
  const configuration = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "secret-that-must-not-be-returned",
    OPENAI_IMAGE_FACTORY_ENABLED: "false",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  })
  assert.equal(configuration.deterministicComposition, "READY")
  assert.equal(configuration.aiGeneration, "DISABLED")
  assert.equal(configuration.openAiKey, "PRESENT")
  assert.equal(JSON.stringify(configuration).includes("secret-that"), false)
  assert.equal(configuration.ebayWrites, 0)
})

test("safe background plan sends no product identity, brand, pack, URL, or pixels", () => {
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const normalized = plan.prompt.toLowerCase()
  assert.equal(normalized.includes("lysol"), false)
  assert.equal(normalized.includes("disinfecting wipes"), false)
  assert.equal(normalized.includes("lemon"), false)
  assert.equal(normalized.includes("yellow"), false)
  assert.equal(normalized.includes("http"), false)
  assert.equal(normalized.includes("base64"), false)
  assert.equal(plan.sendsProductBytes, false)
  assert.equal(plan.sendsProductUrl, false)
  assert.equal(plan.sendsCompetitorData, false)
  assert.equal(plan.imageCount, 1)
  assert.equal(plan.quality, "low")
  assert.match(plan.requestHash, /^[0-9a-f]{64}$/)
})

test("OpenAI request generates exactly one low-quality empty plate without an input image", async () => {
  const generated = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#dce5ef" },
  }).jpeg().toBuffer()
  let capturedUrl = ""
  let capturedInit
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const plate = await requestSafeOpenAiBackgroundPlate({
    plan,
    apiKey: "sk-test_only_123456789",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({
        data: [{ b64_json: generated.toString("base64") }],
        usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_safe_fixture",
        },
      })
    },
  })
  assert.equal(capturedUrl, "https://api.openai.com/v1/images/generations")
  const body = JSON.parse(String(capturedInit.body))
  assert.deepEqual(body, {
    model: "gpt-image-2",
    prompt: plan.prompt,
    n: 1,
    size: "1024x1024",
    quality: "low",
    output_format: "jpeg",
    output_compression: 85,
    background: "opaque",
    moderation: "auto",
  })
  const serialized = JSON.stringify(body).toLowerCase()
  assert.equal(serialized.includes("lysol"), false)
  assert.equal(serialized.includes("sourceurl"), false)
  assert.equal(serialized.includes("input_image"), false)
  assert.equal(serialized.includes("b64_json"), false)
  assert.equal(plate.providerRequestId, "req_safe_fixture")
  assert.deepEqual(plate.usage, {
    inputTokens: 12,
    outputTokens: 34,
    totalTokens: 46,
  })
  assert.match(plate.outputSha256, /^[0-9a-f]{64}$/)
  assert.equal((await sharp(plate.output).metadata()).width, 1600)
})

test("OpenAI request rejects a caller-modified prompt before any network call", async () => {
  const safePlan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  let calls = 0
  await assert.rejects(
    requestSafeOpenAiBackgroundPlate({
      plan: { ...safePlan, prompt: `${safePlan.prompt} Add a branded package.` },
      apiKey: "sk-test_only_123456789",
      fetchImpl: async () => {
        calls += 1
        return new Response("{}")
      },
    }),
    /EBAY_IMAGE_OPENAI_PLAN_NOT_ALLOWED/,
  )
  assert.equal(calls, 0)
})

test("AI plate changes only the context slot; exact authorized main remains deterministic", async () => {
  const source = await authorizedFixture()
  const deterministic = await composeAuthorizedEbayListingImageSet(source, input())
  const plateOutput = await sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#b9cadb" },
  }).jpeg().toBuffer()
  const plan = buildSafeOpenAiBackgroundPlatePlan(input(), "gpt-image-2")
  const withContext = await composeAuthorizedEbayListingImageSet(source, input(), {
    output: plateOutput,
    outputSha256: "b".repeat(64),
    providerRequestId: "req_context_fixture",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    plan,
  })
  assert.equal(withContext[0].slot, "MAIN_WHITE_BACKGROUND")
  assert.equal(withContext[0].outputSha256, deterministic[0].outputSha256)
  assert.equal(withContext[0].transformation.generativeAiUsed, false)
  const generatedSlots = withContext.filter((asset) =>
    asset.transformation.generativeAiUsed
  )
  assert.equal(generatedSlots.length, 1)
  assert.equal(generatedSlots[0].slot, "USE_CONTEXT")
  assert.equal(generatedSlots[0].qa.automaticStatus, "PARTIAL")
  assert.equal(generatedSlots[0].qa.humanApprovalRequired, true)
  assert.equal(generatedSlots[0].transformation.competitorImageUsed, false)
  assert.equal(
    generatedSlots[0].transformation.backgroundPlateRequestHash,
    plan.requestHash,
  )
})

test("AI context is Preview/staging-only, separately flagged, and call-budget capped", () => {
  const ready = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    OPENAI_IMAGE_DAILY_CALL_LIMIT: "999",
  })
  assert.equal(ready.aiGeneration, "READY")
  assert.equal(ready.dailyCallLimit, 20)
  assert.equal(ready.maxContextPlatesPerSet, 1)
  const production = getListingImageFactoryConfiguration({
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
  })
  assert.notEqual(production.aiGeneration, "READY")
  const otherPreviewBranch = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "main",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "sk-test_only_123456789",
    OPENAI_IMAGE_FACTORY_ENABLED: "true",
    OPENAI_IMAGE_CONTEXT_PLATE_ENABLED: "true",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
  })
  assert.equal(otherPreviewBranch.aiGeneration, "BLOCKED_ENVIRONMENT")
})

test("route and migration enforce durable idempotency, budget, review, and zero raw images", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/images/route.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260718050000_control_safe_openai_image_context_runs.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const atomicMigration = readFileSync(
    new URL(
      "../../supabase/migrations/20260718051000_atomic_safe_openai_image_sets.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /approvedGenerationForPackage/)
  assert.match(route, /validateImageRightsEvidence/)
  assert.match(route, /claim_ebay_openai_image_context_run/)
  assert.match(route, /complete_ebay_openai_image_context_run/)
  assert.match(route, /backgroundPlate\.output\.fill\(0\)/)
  assert.match(route, /providerRequestDispatched = true[\s\S]*?requestSafeOpenAiBackgroundPlate/)
  assert.match(route, /p_retryable: !providerRequestDispatched/)
  assert.match(route, /ebay_create_pending_listing_image_set/)
  assert.match(route, /EBAY_IMAGE_PARTIAL_SET_CLEANUP_REQUIRED/)
  assert.match(route, /status: "PENDING_HUMAN_REVIEW"/)
  assert.match(route, /ebayWrites: 0/)
  assert.match(migration, /EBAY_IMAGE_OPENAI_DAILY_BUDGET_EXHAUSTED/)
  assert.match(migration, /idempotency_key_hash/)
  assert.match(migration, /product_byte_count_sent = 0/)
  assert.match(migration, /product_url_count_sent = 0/)
  assert.match(migration, /competitor_image_count = 0/)
  assert.match(migration, /production_changed = false/)
  assert.match(migration, /enable row level security/)
  assert.doesNotMatch(migration, /\b(image_url|base64|raw_response|image_bytes)\s+(text|bytea|jsonb)/i)
  assert.match(atomicMigration, /enforce_ebay_openai_image_context_scope/)
  assert.match(atomicMigration, /decision\.supplier_sku = opportunity\.supplier_sku/)
  assert.match(atomicMigration, /ebay_create_pending_listing_image_set/)
  assert.match(atomicMigration, /jsonb_array_length\(p_assets\)/)
  assert.match(atomicMigration, /grant execute[\s\S]*to service_role/)
})
