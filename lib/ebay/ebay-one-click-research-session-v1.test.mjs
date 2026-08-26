import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  EBAY_ONE_CLICK_RESEARCH_BOUNDS,
  buildEbayOneClickResearchLease,
  buildEbayOneClickResearchPlan,
  validateEbayOneClickResearchCompletion,
} from "./ebay-one-click-research-session-v1.ts"
import { adaptMainSearchSoldCaptureForCanonicalImport } from
  "./ebay-main-search-sold-capture-adapter-v1.ts"

const now = new Date("2026-08-26T12:00:00.000Z")

test("the existing query-plan authority produces one bounded automatic expansion session", () => {
  const plan = buildEbayOneClickResearchPlan({
    status: "ACTIVE",
    tasks: [
      { id: "task-b", ordinal: 2, search_query: "Tesla NEMA adapter",
        category_id: "177702", candidate_count: 2, status: "PENDING" },
      { id: "task-a", ordinal: 1, search_query: "Lysol wipes lemon",
        category_id: "180000", candidate_count: 3, status: "PENDING" },
      { id: "captured", ordinal: 3, search_query: "already done",
        category_id: null, candidate_count: 1, status: "CAPTURED" },
    ],
  })
  assert.equal(plan.tasks.length, 2)
  assert.deepEqual(plan.tasks.map((task) => task.ordinal), [1, 2])
  assert.deepEqual(plan.missionMix, {
    newDiscovery: 0,
    strongFamilyExpansion: 2,
    staleDemandRefresh: 0,
    economicsRescue: 0,
    totalQueries: 2,
  })
  assert.match(plan.coverageLimitation, /NEW_DISCOVERY_REFRESH_AND_ECONOMICS_RESCUE_NOT_YET_EXPOSED/)
  assert.equal(EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxRuntimeMs, 15 * 60_000)
  assert.equal(EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxQueries, 15)
  assert.equal(EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxRows, 200)
  assert.equal(EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxPagesPerQuery, 2)
  assert.equal(EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxRetries, 1)
})

test("the ephemeral lease and completion gate fail closed", () => {
  const lease = buildEbayOneClickResearchLease({
    sessionId: "11111111-1111-4111-8111-111111111111",
    now,
  })
  assert.equal(lease.scope, "EBAY_RESEARCH_CAPTURE_ONLY")
  assert.equal(lease.marketplace, "EBAY_US")
  assert.equal(lease.expiresAt - lease.issuedAt, 15 * 60_000)
  assert.equal(lease.marketplaceWrites, 0)
  assert.deepEqual(validateEbayOneClickResearchCompletion({
    sessionStatus: "COMPLETED",
    freshSoldRows: 7,
    evidenceMaxAgeDays: 4.25,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  }), {
    status: "PASS",
    freshSoldRows: 7,
    evidenceMaxAgeDays: 4.25,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  })
  assert.throws(() => validateEbayOneClickResearchCompletion({
    sessionStatus: "COMPLETED",
    freshSoldRows: 0,
    evidenceMaxAgeDays: 0,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  }), /ONE_CLICK_RESEARCH_COMPLETION_NOT_PROVEN/)
})

test("visible Main Search Sold rows reuse official Browse identity and preserve price ambiguity", async () => {
  const result = await adaptMainSearchSoldCaptureForCanonicalImport({
    now,
    rows: [{
      itemId: "366543596425",
      title: "Lysol Lemon Wipes Pack of 3",
      soldAt: "2026-08-25T12:00:00.000Z",
      capturedAt: "2026-08-26T11:59:00.000Z",
      queryOrResearchIdentity: "lysol lemon wipes",
      displayedSoldPriceAmount: 39.99,
      bestOfferStatus: "EXPLICIT_PRESENT",
      visibleShippingAmount: 6.99,
      shippingStatus: "OBSERVED",
    }],
    officialItemReader: async (itemId) => ({
      itemId: `v1|${itemId}|0`,
      source: "EBAY_BROWSE_ACTIVE_LISTING",
      brand: "Lysol",
      gtin: "012345678905",
      mpn: "LWL-15",
      model: "Lemon Wipes",
      lotSize: 3,
      size: "15 ct",
      color: null,
    }),
  })
  assert.equal(result.browseItemLookupsAttempted, 1)
  assert.equal(result.browseItemLookupsSucceeded, 1)
  assert.equal(result.freshRowCount, 1)
  assert.equal(result.evidenceMaxAgeDays, 1)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(result.secretsExposed, false)
  const row = result.rows[0]
  assert.equal(row.manufacturerBrand, "Lysol")
  assert.equal(row.packCount, 3)
  assert.equal(row.displayedSoldPriceAmount, 39.99)
  assert.equal(row.realizedTransactionPriceAmount, null)
  assert.equal(row.realizedPriceStatus, "UNPROVEN")
  assert.equal(row.bestOfferStatus, "EXPLICIT_PRESENT")
  assert.equal(row.visibleShippingAmount, 6.99)
})

test("the one-click capture refuses stale rows before Browse or persistence", async () => {
  let lookups = 0
  await assert.rejects(() => adaptMainSearchSoldCaptureForCanonicalImport({
    now,
    rows: [{
      itemId: "366543596425",
      title: "Lysol Lemon Wipes Pack of 3",
      soldAt: "2026-06-01T12:00:00.000Z",
      capturedAt: "2026-08-26T11:59:00.000Z",
      queryOrResearchIdentity: "lysol lemon wipes",
      displayedSoldPriceAmount: 39.99,
      bestOfferStatus: "UNKNOWN",
      visibleShippingAmount: null,
      shippingStatus: "UNAVAILABLE",
    }],
    officialItemReader: async () => {
      lookups += 1
      return null
    },
  }), /MAIN_SEARCH_SOLD_CAPTURE_NO_FRESH_ROWS/)
  assert.equal(lookups, 0)
})

test("the same extension owns a bounded page-authorized Product Research and Sold bridge", () => {
  const manifest = JSON.parse(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/manifest.json", "utf8",
  ))
  const background = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/background.js", "utf8",
  )
  const product = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  const sold = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/sold-content.js", "utf8",
  )
  const bridge = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/admin-bridge.js", "utf8",
  )
  assert.equal(manifest.version, "1.2.17")
  assert.deepEqual(manifest.permissions, [])
  assert.ok(manifest.host_permissions.includes("https://www.ebay.com/sh/research*"))
  assert.ok(manifest.host_permissions.includes("https://www.ebay.com/sch/*"))
  assert.ok(manifest.host_permissions.includes(
    "https://imnova-website-z1qh-canonical-preview.vercel.app/admin/ebay/mobile-review*",
  ))
  assert.ok(!manifest.host_permissions.some((entry) => /\*\.vercel\.app|<all_urls>/.test(entry)))
  assert.match(background, /ONE_CLICK_RUN_QUERY/)
  assert.match(background, /MAX_RUNTIME_MS = 15 \* 60_000/)
  assert.match(background, /MAX_QUERIES = 15/)
  assert.match(background, /MAX_ROWS = 200/)
  assert.match(background, /MAX_PAGES_PER_QUERY = 2/)
  assert.match(background, /marketplaceWrites: 0/)
  assert.match(product, /AUTOMATED_CAPTURE_MESSAGE/)
  assert.match(product, /prepareAutomatedCapture/)
  assert.match(sold, /LH_Sold/)
  assert.match(sold, /LH_Complete/)
  assert.match(sold, /realizedPriceStatus: "UNPROVEN"/)
  assert.match(sold, /EBAY_SOLD_ACCESS_CHALLENGE/)
  assert.match(sold, /EBAY_SOLD_MARKER_OR_DOM_UNAVAILABLE/)
  assert.match(bridge, /event\.source !== window/)
  assert.match(bridge, /chrome\.runtime\.sendMessage/)
  for (const source of [background, product, sold, bridge]) {
    assert.doesNotMatch(source, /document\.cookie|chrome\.cookies|localStorage|sessionStorage|Authorization|Bearer /)
  }
})

test("the authenticated page ingests through existing routes without starting heavy pipelines", () => {
  const page = readFileSync(
    "app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", "utf8",
  )
  const productRoute = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8",
  )
  const soldRoute = readFileSync(
    "app/api/admin/ebay/listing-ai/sold-evidence/route.ts", "utf8",
  )
  assert.match(page, /INICIAR RESEARCH AUTOMÁTICO/)
  assert.match(page, /buildEbayOneClickResearchPlan/)
  assert.match(page, /oneClickResearchInFlight\.current/)
  assert.match(page, /maxRows - capturedSoldRows/)
  assert.match(page, /ONE_CLICK_RESEARCH_CAPTURE_ROW_BOUND_EXCEEDED/)
  assert.match(page, /Date\.now\(\) >= lease\.expiresAt/)
  assert.match(page, /researchSessionMode: "EBAY_ONE_CLICK_RESEARCH_SESSION_V1"/)
  assert.match(productRoute, /ONE_CLICK_RESEARCH_CAPTURE_ONLY/)
  assert.match(productRoute, /sameDayPilotStarted: false/)
  assert.match(productRoute, /lunaProductFitStarted: false/)
  assert.match(soldRoute, /adaptMainSearchSoldCaptureForCanonicalImport/)
  assert.match(soldRoute, /read_marketplace_sold_evidence_v1/)
  assert.match(soldRoute, /displayedVsRealizedGuard: "PASS"/)
  assert.match(soldRoute, /result\.reanalysisRequired && !oneClickResearch/)
  assert.doesNotMatch(soldRoute, /publishOffer|createOffer|shipping_fulfillment/)
})

test("mobile review exposes the existing one-click action through an operator-facing research view", () => {
  const page = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  assert.match(page, /aria-label="Áreas de trabajo Seller OS"/)
  assert.match(page, /onClick=\{\(\) => setView\("loop2"\)\}/)
  assert.match(page, />Research automático<\/button>/)
  assert.match(page, /\{view === "loop2" && <Loop2ListingAiPanel \/>\}/)
})
