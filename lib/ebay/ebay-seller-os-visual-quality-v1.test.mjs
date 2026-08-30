import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  analyzeSellerOsHeroImageBytesV1,
  buildSellerOsCurrentLiveVisualQualityV1,
  resolveMaximumOfficialEbayImageV1,
} from "./ebay-seller-os-visual-quality-v1.ts"
import {
  createSellerOsVisualVariantsV1,
  MAX_ACTIVE_VARIANTS_PER_LISTING,
  MAX_VARIANTS_PER_REQUEST,
} from "./ebay-seller-os-visual-variant-v1.ts"

async function heroFixture({ background = "#ffffff", size = 260 } = {}) {
  return sharp({ create: { width: 1_000, height: 1_000, channels: 3,
    background } }).composite([{ input: Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="20" fill="#c22d38"/></svg>`),
    left: Math.round((1_000 - size) / 2), top: Math.round((1_000 - size) / 2) }])
    .jpeg({ quality: 94 }).toBuffer()
}

function listing(itemId, imageUrl) {
  return {
    key: `listing:${itemId}`,
    identity: {
      itemId,
      title: "The same title must never become identity",
      primaryImageUrl: imageUrl,
      primaryImageSource: "EBAY_TRADING_GET_ITEM",
      marketplaceCertification: { status: "US_CERTIFIED" },
    },
    discovery: { livePresence: { status: "LIVE_ACTIVE" } },
    metrics: {},
    experiment: { status: "MISSING", lifecycleState: null },
    dataQualityIssues: [], blockers: [], evidenceReferences: [],
    alertCandidateKeys: [],
  }
}

function monitor(listings) {
  return {
    generatedAt: "2026-08-29T12:00:00.000Z",
    listings,
    backend: { livePortfolioIntegrity: { canonicalCohort: {
      itemIds: listings.map((row) => row.identity.itemId),
    } } },
  }
}

test("deterministic hero analysis exposes components and separates observation from hypothesis", async () => {
  const review = await analyzeSellerOsHeroImageBytesV1({
    ebayItemId: "366635285436",
    imageUrl: "https://i.ebayimg.com/images/g/cake/s-l1600.jpg",
    imageSource: "EBAY_TRADING_GET_ITEM",
    bytes: await heroFixture(),
  })
  assert.equal(review.ebayItemId, "366635285436")
  assert.equal(review.signals.imageDimensions.status, "AVAILABLE")
  assert.deepEqual(review.signals.imageDimensions.value,
    { width: 1_000, height: 1_000 })
  assert.equal(review.signals.mainImageWhiteBackgroundStandard.value, true)
  assert.ok(review.signals.productDominance.value < .4)
  assert.equal(review.findings.some((row) =>
    row.findingCode === "LOW_FRAME_UTILIZATION"), true)
  assert.equal(review.findings.every((row) =>
    row.evidenceVsHypothesis === "OBSERVATION_AND_HYPOTHESIS_SEPARATED"), true)
  assert.ok(review.predictedHeroScore.components.length >= 4)
  assert.equal(review.predictedHeroScore.performanceCausalityClaimed, false)
  assert.equal(review.productTruthProtection.generativeChangesAllowed, false)
})

test("non-white backgrounds keep segmentation unproven instead of inventing a visual failure", async () => {
  const review = await analyzeSellerOsHeroImageBytesV1({
    ebayItemId: "100000000001",
    imageUrl: "https://i.ebayimg.com/images/g/context/s-l1600.jpg",
    imageSource: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    bytes: await heroFixture({ background: "#7b8ca0", size: 600 }),
  })
  assert.equal(review.status, "PARTIAL")
  assert.equal(review.signals.productDominance.status, "UNPROVEN")
  assert.equal(review.signals.productDominance.value, null)
  assert.equal(review.signals.multipleProductOrTextOverlaySignal.status, "UNPROVEN")
  assert.equal(review.signals.productRecognition.status, "UNPROVEN")
})

test("CURRENT LIVE analysis uses Item ID, isolates broken images, and makes no AI or marketplace calls", async () => {
  const good = await heroFixture({ size: 720 })
  const listings = [
    listing("100000000001", "https://i.ebayimg.com/images/g/one/s-l1600.jpg"),
    listing("100000000002", "https://i.ebayimg.com/images/g/two/s-l1600.jpg"),
    listing("100000000003", "https://uncertified.example/image.jpg"),
  ]
  let requests = 0
  const result = await buildSellerOsCurrentLiveVisualQualityV1({
    monitor: monitor(listings),
    fetchImage: async (url) => {
      requests += 1
      if (String(url).includes("/two/")) throw new Error("BROKEN_IMAGE")
      return new Response(good, { status: 200,
        headers: { "content-type": "image/jpeg",
          "content-length": String(good.length) } })
    },
  })
  assert.equal(result.currentLiveCount, 3)
  assert.equal(requests, 2)
  assert.deepEqual(result.listings.map((row) => row.ebayItemId),
    ["100000000001", "100000000002", "100000000003"])
  assert.equal(result.visualAnalysisAvailableCount, 1)
  assert.equal(result.unprovenCount, 2)
  assert.equal(result.listings[1].evidenceLimitationCode,
    "IMAGE_EVIDENCE_UNAVAILABLE")
  assert.equal(result.ai.aiCallCount, 0)
  assert.equal(result.ai.imageGenerationCount, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.faultIsolation.imageFailureStopsBatch, false)
})

test("s-l140 evidence is elevated to the maximum official eBay derivative before analysis", async () => {
  const resolution = resolveMaximumOfficialEbayImageV1(
    "https://i.ebayimg.com/images/g/one/s-l140.png")
  assert.equal(resolution.readContractSourceClass, "THUMBNAIL")
  assert.equal(resolution.visualAnalyzerSourceClass, "EBAY_DERIVATIVE")
  assert.equal(resolution.originalReadUrlSizeVariant, "s-l140")
  assert.equal(resolution.analyzedUrlSizeVariant, "s-l1600")
  assert.match(resolution.analyzedUrl, /\/s-l1600\.png$/)
  assert.equal(resolution.originalImageUrlAvailable, false)
  assert.equal(resolution.sourceImageFullResolutionCertified, true)

  const full = await heroFixture({ size: 720 })
  let requestedUrl = ""
  const result = await buildSellerOsCurrentLiveVisualQualityV1({
    monitor: monitor([listing("100000000004",
      "https://i.ebayimg.com/images/g/one/s-l140.png")]),
    fetchImage: async (url) => {
      requestedUrl = String(url)
      return new Response(full, { status: 200,
        headers: { "content-type": "image/png" } })
    },
  })
  assert.match(requestedUrl, /\/s-l1600\.png$/)
  assert.equal(result.listings[0].sourceResolution.fullResolutionFetchAvailable,
    true)
  assert.equal(result.listings[0].sourceResolution
    .sourceImageFullResolutionCertified, true)
  assert.equal(result.listings[0].findings.some((finding) =>
    finding.findingCode === "LOW_SOURCE_RESOLUTION"), false)
})

test("Command Center wires visual authority and human actions without generation", () => {
  const route = readFileSync("app/api/admin/ebay/strategic-review/route.ts", "utf8")
  const page = readFileSync("app/admin/ebay/listing-optimization/page.tsx", "utf8")
  assert.match(route, /buildSellerOsCurrentLiveVisualQualityV1/)
  assert.match(route, /visualQuality/)
  assert.match(page, /Qué vemos y qué conviene probar/)
  assert.match(page, /VER IMAGEN/)
  assert.match(page, /VER POR QUÉ/)
  assert.match(page, /PREPARAR EXPERIMENTO/)
  assert.match(page, /no predice ventas/)
  assert.doesNotMatch(page, /SCORE_LOW[^\n]+AUTO_EDIT/)
})

function fakeVisualVariantSupabase() {
  const inserts = []
  const uploads = []
  const builder = (table) => {
    const state = { table, payload: null, head: false, like: false }
    const query = {
      select(_columns, options) { state.head = options?.head === true; return query },
      eq() { return query }, in() { return query }, gte() { return query },
      order() { return query }, limit() { return query }, contains() { return query },
      like() { state.like = true; return query },
      insert(payload) { state.payload = payload; inserts.push({ table, payload }); return query },
      async maybeSingle() {
        if (table === "seller_os_luna_linkage_decisions") return { data: {
          decision_id: `luna-linkage-decision-v1:sha256:${"a".repeat(64)}`,
          ebay_item_id: "366582586826", decision: "APPROVE_EXACT_LINKAGE",
          luna_product_id: "9220805755104", luna_variant_id: "48809607659744",
          luna_sku: "ITEM5810", components: [{ exactProductIdentity: true,
            exactVariantIdentity: true, exactSupplierSku: true }],
          evidence_digest: `sha256:${"b".repeat(64)}`,
          actor_user_id: "11111111-1111-4111-8111-111111111111",
          decision_version: 1,
        }, error: null }
        return { data: null, error: null }
      },
      async single() {
        if (table === "ebay_listing_image_assets") return { data: {
          id: "22222222-2222-4222-8222-222222222222",
          output_sha256: state.payload.output_sha256,
          created_at: "2026-08-29T12:00:00Z",
        }, error: null }
        return { data: state.payload, error: null }
      },
      then(resolve) {
        if (state.head) return Promise.resolve({ count: 0, error: null }).then(resolve)
        if (table === "ai_listing_budget_usage" && !state.payload) {
          return Promise.resolve({ data: [], error: null }).then(resolve)
        }
        return Promise.resolve({ data: state.payload, error: null }).then(resolve)
      },
    }
    return query
  }
  return {
    from: builder,
    storage: { from: () => ({
      async upload(path, bytes) { uploads.push({ path, bytes: bytes.length });
        return { data: { path }, error: null } },
      async remove() { return { data: [], error: null } },
    }) },
    inserts, uploads,
  }
}

test("bounded visual generation preserves Product Truth and records budget without eBay writes", async () => {
  const source = await sharp({ create: { width: 1_000, height: 1_000,
    channels: 3, background: "white" } }).composite([{ input: Buffer.from(
    '<svg width="500" height="700"><rect width="500" height="700" fill="#2050a0"/></svg>'),
    left: 0, top: 150 }]).png().toBuffer()
  const emptyBackground = await sharp({ create: { width: 1_024, height: 1_024,
    channels: 3, background: "white" } }).png().toBuffer()
  const supabase = fakeVisualVariantSupabase()
  let providerCalls = 0
  const result = await createSellerOsVisualVariantsV1({
    supabase,
    monitor: monitor([listing("366582586826",
      "https://i.ebayimg.com/images/g/edge/s-l140.png")]),
    accountKey: "EBAY_US_PRIMARY", actorId: null,
    ebayItemId: "366582586826", findingCode: "EDGE_CROPPING_RISK",
    variantCount: 1, apiKey: "redacted-test-key-material-long-enough",
    model: "gpt-image-2", now: new Date("2026-08-29T12:00:00Z"),
    fetchImpl: async (url) => {
      if (String(url).includes("api.openai.com")) {
        providerCalls += 1
        return new Response(JSON.stringify({ data: [{
          b64_json: emptyBackground.toString("base64") }],
          usage: { input_tokens: 100, output_tokens: 300 } }), {
          status: 200, headers: { "content-type": "application/json",
            "x-request-id": "req_safe_test" },
        })
      }
      return new Response(source, { status: 200,
        headers: { "content-type": "image/png" } })
    },
  })
  assert.equal(MAX_VARIANTS_PER_REQUEST, 2)
  assert.equal(MAX_ACTIVE_VARIANTS_PER_LISTING, 4)
  assert.equal(providerCalls, 1)
  assert.equal(result.generationReasonProven, true)
  assert.equal(result.variantCount, 1)
  assert.equal(result.productTruthPreserved, true)
  assert.equal(result.sourceImageFullResolutionCertified, true)
  assert.equal(result.aiImageRequestCount, 1)
  assert.equal(result.ebayListingEdits, 0)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(supabase.uploads.length, 1)
  assert.equal(supabase.inserts.some((row) =>
    row.table === "ai_listing_budget_usage"), true)
  const experiment = supabase.inserts.find((row) =>
    row.table === "ebay_listing_experiments_v1")?.payload
  const visual = experiment.baseline_evidence_ref.sellerOsVisualVariant
  assert.equal(experiment.lifecycle_status, "DRAFT")
  assert.equal(visual.variants[0].productTruthPreserved, true)
  assert.equal(visual.variants[0].sourceImageFullResolutionCertified, true)
  assert.equal(visual.marketplaceWrites, 0)
})

test("visual generation rejects unsupported reasons and more than two variants", async () => {
  const supabase = fakeVisualVariantSupabase()
  const base = { supabase, monitor: monitor([]), accountKey: "EBAY_US_PRIMARY",
    actorId: null, ebayItemId: "366582586826",
    apiKey: "redacted-test-key-material-long-enough",
    model: "gpt-image-2", fetchImpl: async () => new Response() }
  await assert.rejects(createSellerOsVisualVariantsV1({ ...base,
    findingCode: "LOW_SOURCE_RESOLUTION", variantCount: 1 }),
  /VISUAL_VARIANT_MATERIAL_REASON_REQUIRED/)
  await assert.rejects(createSellerOsVisualVariantsV1({ ...base,
    findingCode: "EDGE_CROPPING_RISK", variantCount: 3 }),
  /VISUAL_VARIANT_COUNT_OUT_OF_BOUNDS/)
})
