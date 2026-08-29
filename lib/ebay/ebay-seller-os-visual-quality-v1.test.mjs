import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  analyzeSellerOsHeroImageBytesV1,
  buildSellerOsCurrentLiveVisualQualityV1,
} from "./ebay-seller-os-visual-quality-v1.ts"

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
