import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"

import {
  EBAY_ONE_CLICK_RESEARCH_BOUNDS,
  EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS,
  buildEbayOneClickResearchLease,
  buildEbayOneClickResearchPlan,
  establishEbayOneClickResearchHandshake,
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

test("the bounded handshake closes both bridge/page race orders and stops after ACK", async () => {
  let bridgeBeforePageAttempts = 0
  const bridgeBeforePage = await establishEbayOneClickResearchHandshake({
    probe: async () => {
      bridgeBeforePageAttempts += 1
      return { extensionId: "extension-runtime-id" }
    },
  })
  assert.deepEqual(bridgeBeforePage, { extensionId: "extension-runtime-id" })
  assert.equal(bridgeBeforePageAttempts, 1)

  let nowMs = 0
  let bridgeListening = false
  let pageBeforeBridgeAttempts = 0
  const pageBeforeBridge = await establishEbayOneClickResearchHandshake({
    probe: async (attemptTimeoutMs) => {
      pageBeforeBridgeAttempts += 1
      assert.ok(attemptTimeoutMs > 0 && attemptTimeoutMs <= 750)
      if (!bridgeListening) throw new Error("ONE_CLICK_RESEARCH_EXTENSION_TIMEOUT")
      return { extensionId: "extension-runtime-id" }
    },
    now: () => nowMs,
    wait: async (delayMs) => {
      nowMs += delayMs
      if (nowMs >= 500) bridgeListening = true
    },
  })
  assert.deepEqual(pageBeforeBridge, { extensionId: "extension-runtime-id" })
  assert.ok(pageBeforeBridgeAttempts > 1)
  assert.ok(nowMs < EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.maxRuntimeMs)

  let repeatedProbeAttempts = 0
  const repeatedProbe = await establishEbayOneClickResearchHandshake({
    probe: async () => {
      repeatedProbeAttempts += 1
      return { extensionId: "extension-runtime-id" }
    },
  })
  assert.deepEqual(repeatedProbe, pageBeforeBridge)
  assert.equal(repeatedProbeAttempts, 1)
})

test("the extension handshake fails closed within eight seconds when no bridge ACK arrives", async () => {
  let nowMs = 0
  let attempts = 0
  await assert.rejects(() => establishEbayOneClickResearchHandshake({
    probe: async () => {
      attempts += 1
      throw new Error("ONE_CLICK_RESEARCH_EXTENSION_TIMEOUT")
    },
    now: () => nowMs,
    wait: async (delayMs) => { nowMs += delayMs },
  }), /ONE_CLICK_RESEARCH_EXTENSION_HANDSHAKE_TIMEOUT/)
  assert.equal(nowMs, EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.maxRuntimeMs)
  assert.ok(attempts > 1 && attempts <= 32)
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
  assert.equal(manifest.version, "1.2.18")
  assert.deepEqual(manifest.permissions, [])
  assert.ok(manifest.host_permissions.includes("https://www.ebay.com/sh/research*"))
  assert.ok(manifest.host_permissions.includes("https://www.ebay.com/sch/*"))
  assert.ok(manifest.host_permissions.includes(
    "https://imnova-website-z1qh-canonical-preview.vercel.app/admin/ebay/mobile-review*",
  ))
  assert.ok(!manifest.host_permissions.some((entry) => /\*\.vercel\.app|<all_urls>/.test(entry)))
  const adminContentScript = manifest.content_scripts.find((entry) =>
    entry.js.includes("admin-bridge.js"))
  assert.equal(adminContentScript.run_at, "document_start")
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

test("the first automated Product Research capture navigates query and category before waiting for READY", async () => {
  const listeners = []
  const createdTabs = []
  const sentMessages = []
  let currentTabUrl = ""
  let clock = Date.parse("2026-08-26T12:00:00.000Z")
  class HarnessDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]))
    }
    static now() { return clock }
  }
  const chrome = {
    runtime: {
      id: "iincmnlkdkpkcingdplnlbbjbaoffecd",
      getManifest: () => ({ version: "1.2.18" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      create: async (input) => {
        currentTabUrl = input.url
        createdTabs.push(input)
        return { id: 41, url: input.url }
      },
      update: async (_tabId, input) => {
        currentTabUrl = input.url
        return { id: 41, url: input.url }
      },
      sendMessage: async (_tabId, message) => {
        sentMessages.push(message)
        if (message.type === "IMNOVA_AUTOMATED_PRODUCT_RESEARCH_CAPTURE_V1") {
          const url = new URL(currentTabUrl)
          const fragment = new URLSearchParams(url.hash.replace(/^#/, ""))
          const queryStateReady = url.pathname === "/sh/research" &&
            url.searchParams.get("marketplace") === "EBAY-US" &&
            url.searchParams.get("keywords") === "one handle posi temp" &&
            url.searchParams.get("categoryId") === "159907" &&
            url.searchParams.get("tabName") === "SOLD" &&
            url.searchParams.get("dayRange") === "90" &&
            fragment.get("seller-os-query-stage") === "AWAITING_RESULTS"
          if (!queryStateReady) return { success: true, status: "PENDING" }
          return { success: true, status: "READY", capture: {
            captureId: "capture-product-research-ready",
            searchQuery: "one handle posi temp",
          } }
        }
        return { success: true, status: "READY", rows: [], soldFilterProven: true,
          nextPageAvailable: false }
      },
      remove: async () => undefined,
    },
  }
  runInNewContext(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/background.js", "utf8",
  ), {
    AbortController, Blob, Date: HarnessDate, Intl, Promise, URL, URLSearchParams,
    chrome, clearTimeout: () => undefined,
    fetch: async () => { throw new Error("UNEXPECTED_NETWORK_CALL") },
    setTimeout: (callback, delay = 0) => {
      clock += Number(delay)
      queueMicrotask(callback)
      return 1
    },
  })
  const lease = {
    version: "EBAY_ONE_CLICK_RESEARCH_SESSION_V1_2026_08_26",
    sessionId: "11111111-1111-4111-8111-111111111111",
    scope: "EBAY_RESEARCH_CAPTURE_ONLY",
    marketplace: "EBAY_US",
    issuedAt: clock,
    expiresAt: clock + 15 * 60_000,
    bounds: { maxRuntimeMs: 15 * 60_000, maxQueries: 15, maxRows: 200,
      maxRowsPerCapture: 200, maxPagesPerQuery: 2, maxRetries: 0 },
    marketplaceWrites: 0,
  }
  const result = await new Promise((resolve, reject) => {
    const message = { type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1", lease,
      task: { ordinal: 1, searchQuery: "one handle posi temp", categoryId: "159907" },
      remainingRows: 200 }
    const sender = { frameId: 0, tab: {
      url: "https://imnova-website-z1qh-canonical-preview.vercel.app/admin/ebay/mobile-review",
    } }
    const accepted = listeners.some((listener) => listener(message, sender, resolve) === true)
    if (!accepted) reject(new Error("ONE_CLICK_BACKGROUND_LISTENER_NOT_REACHED"))
  })
  assert.equal(result.success, true)
  assert.equal(createdTabs.length, 1)
  assert.equal(createdTabs[0].active, false)
  const researchUrl = new URL(createdTabs[0].url)
  assert.equal(researchUrl.searchParams.get("keywords"), "one handle posi temp")
  assert.equal(researchUrl.searchParams.get("categoryId"), "159907")
  assert.equal(researchUrl.searchParams.get("tabName"), "SOLD")
  assert.equal(researchUrl.searchParams.get("dayRange"), "90")
  assert.equal(Number(researchUrl.searchParams.get("endDate")) -
    Number(researchUrl.searchParams.get("startDate")), 90 * 24 * 60 * 60 * 1_000)
  const productMessage = sentMessages.find((message) =>
    message.type === "IMNOVA_AUTOMATED_PRODUCT_RESEARCH_CAPTURE_V1")
  assert.equal(productMessage.categoryId, "159907")
  assert.equal(result.productResearchCapture.captureId, "capture-product-research-ready")
  assert.equal(result.marketplaceWrites, 0)
})

test("the mounted research view actively probes the bridge after installing its response listener", () => {
  const page = readFileSync(
    "app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", "utf8",
  )
  const listener = page.indexOf('window.addEventListener("message", receive)')
  const command = page.indexOf(
    'window.postMessage({ type: EBAY_ONE_CLICK_RESEARCH_COMMAND, requestId, command }',
  )
  assert.ok(listener >= 0 && command > listener)
  assert.match(page, /async function probeOneClickResearchExtension\(\)/)
  assert.match(page, /type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"/)
  assert.match(page,
    /useEffect\(\(\) => \{\s+let active = true\s+void probeOneClickResearchExtension\(\)\.then/)
  assert.match(page, /probe\.extensionId !== probe\.bridgeExtensionId/)
  const passiveProbe = page.indexOf("void probeOneClickResearchExtension().then")
  const sessionStart = page.indexOf("const startOneClickResearch = async")
  assert.ok(passiveProbe >= 0 && sessionStart > passiveProbe)
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
