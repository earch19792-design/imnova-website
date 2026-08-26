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
  validateEbayOneClickNoValidSoldEvidenceOutcome,
  validateEbayOneClickResearchCompletion,
} from "./ebay-one-click-research-session-v1.ts"
import { adaptMainSearchSoldCaptureForCanonicalImport } from
  "./ebay-main-search-sold-capture-adapter-v1.ts"

const now = new Date("2026-08-26T12:00:00.000Z")
const canonicalAdminOrigin =
  "https://imnova-website-z1qh-canonical-preview.vercel.app"

function createAdminBridgeHarness({ contextActive = true } = {}) {
  const listeners = new Set()
  const posted = []
  const window = {
    location: { origin: canonicalAdminOrigin, pathname: "/admin/ebay/mobile-review" },
    addEventListener: (type, listener) => {
      if (type === "message") listeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      if (type === "message") listeners.delete(listener)
    },
    postMessage: (data, targetOrigin) => {
      posted.push(structuredClone(data))
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({
          source: window, origin: targetOrigin, data,
        })
      })
    },
  }
  window.top = window
  const chrome = {
    runtime: {
      id: "konedcelblnjpeeonbejdklpbkdpiopd",
      getManifest: () => ({ version: "1.2.22" }),
      sendMessage: (command) => {
        if (!contextActive) throw new Error("EXTENSION_CONTEXT_INVALIDATED")
        assert.equal(command.type, "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1")
        return Promise.resolve({ success: true, ready: true,
          extensionId: "konedcelblnjpeeonbejdklpbkdpiopd",
          extensionVersion: "1.2.22", persistentCredential: false,
          cookieAccess: false, marketplaceWrites: 0 })
      },
    },
  }
  runInNewContext(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/admin-bridge.js", "utf8",
  ), { chrome, Promise, window })
  return {
    posted,
    listenerCount: () => listeners.size,
    probe: async (requestId) => {
      const response = new Promise((resolve) => {
        const receive = (event) => {
          if (event.data?.type !== "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1" ||
            event.data.requestId !== requestId) return
          window.removeEventListener("message", receive)
          resolve(event.data)
        }
        window.addEventListener("message", receive)
      })
      window.postMessage({
        type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1",
        requestId,
        command: { type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1" },
      }, canonicalAdminOrigin)
      return response
    },
  }
}

function productResearchDiagnostic(overrides = {}) {
  return {
    contentScriptBootId: "11111111-1111-4111-8111-111111111111",
    contentScriptBooted: true,
    authState: "AUTHENTICATED_PRODUCT_RESEARCH",
    queryStateMatch: true,
    categoryStateMatch: true,
    resultsContainerFound: true,
    resultsLoading: false,
    resultsReady: true,
    guidedQueryStatePresent: true,
    guidedQueryMatch: true,
    resultIdentityState: "SOLD_ITEM_IDS",
    resultIdentityCount: 1,
    resultFingerprintChanged: true,
    previousResultsFingerprintPresent: false,
    resultStateBoundToCurrentQuery: true,
    readinessRejectionReason: "READY",
    zeroResultsState: "NOT_PROVEN",
    externalEbayBlocker: "NONE",
    ...overrides,
  }
}

async function runProductResearchDiagnosticScenario({ getTab, sendMessage }) {
  const listeners = []
  let currentTabUrl = ""
  let clock = Date.parse("2026-08-26T12:00:00.000Z")
  class HarnessDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  const chrome = {
    runtime: {
      id: "iincmnlkdkpkcingdplnlbbjbaoffecd",
      getManifest: () => ({ version: "1.2.22" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      create: async (input) => {
        currentTabUrl = input.url
        return { id: 42, url: input.url, status: "loading" }
      },
      get: async () => getTab?.(currentTabUrl) ??
        ({ id: 42, url: currentTabUrl, status: "complete" }),
      update: async (_tabId, input) => {
        currentTabUrl = input.url
        return { id: 42, url: input.url, status: "loading" }
      },
      sendMessage: async (_tabId, message) => sendMessage(message),
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
  return new Promise((resolve, reject) => {
    const message = { type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1", lease,
      task: { id: "task-one-handle-posi-temp", ordinal: 1,
        searchQuery: "one handle posi temp", categoryId: "159907" },
      remainingRows: 200 }
    const sender = { frameId: 0, tab: {
      url: "https://imnova-website-z1qh-canonical-preview.vercel.app/admin/ebay/mobile-review",
    } }
    const accepted = listeners.some((listener) => listener(message, sender, resolve) === true)
    if (!accepted) reject(new Error("ONE_CLICK_BACKGROUND_LISTENER_NOT_REACHED"))
  })
}

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
    sessionStatus: "COMPLETED",
    noValidSoldEvidenceTasks: 0,
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

test("zero-valid sold validation becomes a bounded terminal task outcome", () => {
  assert.deepEqual(validateEbayOneClickNoValidSoldEvidenceOutcome({
    taskOutcome: "NO_VALID_SOLD_EVIDENCE",
    sourceStatus: "HEALTHY",
    parserStatus: "HEALTHY",
    normalizationStatus: "COMPLETE",
    observedCount: 92,
    parsedCount: 39,
    normalizedCount: 39,
    validCount: 0,
    rejectedCount: 39,
    duplicateStatus: "NOT_REACHED",
    rejectionReasonCounts: {
      STRONG_PRODUCT_IDENTIFIER_REQUIRED: 1,
      PACK_COUNT_REQUIRED: 38,
    },
    exactSoldComparablesCreated: 0,
    marketplaceWrites: 0,
  }), {
    taskOutcome: "NO_VALID_SOLD_EVIDENCE",
    sourceStatus: "HEALTHY",
    parserStatus: "HEALTHY",
    normalizationStatus: "COMPLETE",
    observedCount: 92,
    parsedCount: 39,
    normalizedCount: 39,
    validCount: 0,
    rejectedCount: 39,
    duplicateStatus: "NOT_REACHED",
    rejectionReasonCounts: {
      PACK_COUNT_REQUIRED: 38,
      STRONG_PRODUCT_IDENTIFIER_REQUIRED: 1,
    },
    exactSoldComparablesCreated: 0,
    marketplaceWrites: 0,
  })
  assert.deepEqual(validateEbayOneClickResearchCompletion({
    sessionStatus: "COMPLETED_WITH_REJECTIONS",
    noValidSoldEvidenceTasks: 2,
    freshSoldRows: 58,
    evidenceMaxAgeDays: 10.4,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  }), {
    status: "PASS",
    sessionStatus: "COMPLETED_WITH_REJECTIONS",
    noValidSoldEvidenceTasks: 2,
    freshSoldRows: 58,
    evidenceMaxAgeDays: 10.4,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  })
})

test("no-valid terminal outcomes fail closed unless every validation stage is healthy", () => {
  const valid = {
    taskOutcome: "NO_VALID_SOLD_EVIDENCE",
    sourceStatus: "HEALTHY",
    parserStatus: "HEALTHY",
    normalizationStatus: "COMPLETE",
    observedCount: 2,
    parsedCount: 2,
    normalizedCount: 2,
    validCount: 0,
    rejectedCount: 2,
    duplicateStatus: "NOT_REACHED",
    rejectionReasonCounts: { PACK_COUNT_REQUIRED: 2 },
    exactSoldComparablesCreated: 0,
    marketplaceWrites: 0,
  }
  assert.throws(() => validateEbayOneClickNoValidSoldEvidenceOutcome({
    ...valid, sourceStatus: "SOURCE_FORMAT_CHANGED",
  }), /ONE_CLICK_RESEARCH_NO_VALID_SOLD_OUTCOME_INVALID/)
  assert.throws(() => validateEbayOneClickNoValidSoldEvidenceOutcome({
    ...valid, rejectionReasonCounts: { PACK_COUNT_REQUIRED: 1 },
  }), /ONE_CLICK_RESEARCH_NO_VALID_SOLD_OUTCOME_INVALID/)
  assert.throws(() => validateEbayOneClickResearchCompletion({
    sessionStatus: "COMPLETED",
    noValidSoldEvidenceTasks: 1,
    freshSoldRows: 58,
    evidenceMaxAgeDays: 10.4,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  }), /ONE_CLICK_RESEARCH_COMPLETION_NOT_PROVEN/)
  assert.doesNotThrow(() => validateEbayOneClickResearchCompletion({
    sessionStatus: "COMPLETED_WITH_REJECTIONS",
    noValidSoldEvidenceTasks: 2,
    freshSoldRows: 0,
    evidenceMaxAgeDays: 0,
    durableReadback: "PASS",
    displayedVsRealizedGuard: "PASS",
    bestOfferGuard: "PASS",
    marketplaceWrites: 0,
  }))
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

test("an active document-start bridge recovers when its passive READY preceded the page", async () => {
  const bridge = createAdminBridgeHarness()
  assert.equal(bridge.listenerCount(), 1)
  assert.ok(bridge.posted.some((message) =>
    message.type === "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1" &&
    message.stage === "BRIDGE_LISTENER_REGISTERED"))
  const requestId = "11111111-1111-4111-8111-111111111111"
  const response = await bridge.probe(requestId)
  assert.equal(response.success, true)
  assert.equal(response.extensionId, "konedcelblnjpeeonbejdklpbkdpiopd")
  const lifecycle = bridge.posted.filter((message) => message.requestId === requestId &&
    message.type === "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1")
  assert.deepEqual(lifecycle.map((entry) => entry.stage), [
    "PROBE_RECEIVED_BY_BRIDGE", "ACK_SENT_BY_BRIDGE",
  ])
  assert.equal(lifecycle.at(-1).serviceWorkerResponse, "ACK")
  assert.equal(lifecycle.at(-1).ackEventsSent, 1)
})

test("an invalidated extension context fails closed and a hard-refreshed document boots a new bridge", async () => {
  const invalidated = createAdminBridgeHarness({ contextActive: false })
  const failedRequest = "22222222-2222-4222-8222-222222222222"
  const failed = await invalidated.probe(failedRequest)
  assert.equal(failed.success, false)
  assert.equal(failed.error, "RESEARCH_EXTENSION_BRIDGE_DISCONNECTED")
  assert.ok(invalidated.posted.some((message) => message.requestId === failedRequest &&
    message.stage === "SERVICE_WORKER_RESPONSE_FAILED"))

  const refreshed = createAdminBridgeHarness()
  const response = await refreshed.probe("33333333-3333-4333-8333-333333333333")
  assert.equal(response.success, true)
  assert.equal(response.payload.extensionVersion, "1.2.22")
})

test("mount and remount probes are idempotent and do not retain stale page listeners", async () => {
  const bridge = createAdminBridgeHarness()
  await bridge.probe("44444444-4444-4444-8444-444444444444")
  assert.equal(bridge.listenerCount(), 1)
  await bridge.probe("55555555-5555-4555-8555-555555555555")
  assert.equal(bridge.listenerCount(), 1)
  const acknowledgements = bridge.posted.filter((message) =>
    message.type === "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1" &&
    message.stage === "ACK_SENT_BY_BRIDGE")
  assert.equal(acknowledgements.length, 2)
  assert.deepEqual(acknowledgements.map((entry) => entry.ackEventsSent), [1, 2])
})

test("a missed initial probe is recovered only by the existing bounded retry", async () => {
  let nowMs = 0
  let bridge = null
  let attempts = 0
  const result = await establishEbayOneClickResearchHandshake({
    probe: async () => {
      attempts += 1
      if (!bridge) throw new Error("ONE_CLICK_RESEARCH_EXTENSION_TIMEOUT")
      return bridge.probe("66666666-6666-4666-8666-666666666666")
    },
    now: () => nowMs,
    wait: async (delayMs) => {
      nowMs += delayMs
      bridge = createAdminBridgeHarness()
    },
  })
  assert.equal(result.success, true)
  assert.equal(attempts, 2)
  assert.equal(nowMs, EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.retryDelayMs)
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
  assert.equal(manifest.version, "1.2.22")
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
  assert.match(background, /PRODUCT_RESEARCH_STAGE_TRACE_V2/)
  assert.match(background, /PRODUCT_RESEARCH_TASK_BINDING_V1/)
  assert.match(background, /diagnosticTrace: boundedProductResearchTrace/)
  assert.match(product, /AUTOMATED_CAPTURE_MESSAGE/)
  assert.match(product, /AUTOMATED_DIAGNOSTIC_PING/)
  assert.match(product, /productResearchDiagnostic/)
  assert.match(product, /establishAutomatedGuidedState/)
  assert.match(product, /prepareAutomatedCapture/)
  assert.match(sold, /LH_Sold/)
  assert.match(sold, /LH_Complete/)
  assert.match(sold, /realizedPriceStatus: "UNPROVEN"/)
  assert.match(sold, /EBAY_SOLD_ACCESS_CHALLENGE/)
  assert.match(sold, /EBAY_SOLD_MARKER_OR_DOM_UNAVAILABLE/)
  assert.match(bridge, /event\.source !== window/)
  assert.match(bridge, /chrome\.runtime\.sendMessage/)
  assert.match(bridge, /diagnosticTrace: payload\?\.diagnosticTrace \?\? null/)
  assert.match(bridge, /ONE_CLICK_EXTENSION_HANDSHAKE_TRACE_V1/)
  assert.match(bridge, /PROBE_RECEIVED_BY_BRIDGE/)
  assert.match(bridge, /ACK_SENT_BY_BRIDGE/)
  assert.match(bridge, /Math\.min\(probeEventsReceived, 32\)/)
  assert.doesNotMatch(bridge, /setInterval|document\.documentElement|innerHTML|outerHTML/)
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
      getManifest: () => ({ version: "1.2.22" }),
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
      get: async () => ({ id: 41, url: currentTabUrl, status: "complete" }),
      sendMessage: async (_tabId, message) => {
        sentMessages.push(message)
        if (message.type === "IMNOVA_PRODUCT_RESEARCH_DIAGNOSTIC_PING_V1") {
          return { success: true, status: "READY",
            diagnostic: productResearchDiagnostic() }
        }
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
      task: { id: "task-one-handle-posi-temp", ordinal: 1,
        searchQuery: "one handle posi temp", categoryId: "159907" },
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
  assert.deepEqual({
    version: productMessage.taskBinding.version,
    sessionId: productMessage.taskBinding.sessionId,
    taskId: productMessage.taskBinding.taskId,
    ordinal: productMessage.taskBinding.ordinal,
    expectedQuery: productMessage.taskBinding.expectedQuery,
    expectedCategoryId: productMessage.taskBinding.expectedCategoryId,
    navigationAttested: productMessage.taskBinding.navigationAttested,
    freshTabForTask: productMessage.taskBinding.freshTabForTask,
  }, {
    version: "PRODUCT_RESEARCH_TASK_BINDING_V1",
    sessionId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-one-handle-posi-temp",
    ordinal: 1,
    expectedQuery: "one handle posi temp",
    expectedCategoryId: "159907",
    navigationAttested: true,
    freshTabForTask: true,
  })
  assert.equal(result.productResearchCapture.captureId, "capture-product-research-ready")
  assert.equal(result.productResearchDiagnosticTrace.lastConfirmedStage, "CAPTURE_RESPONSE_RECEIVED")
  assert.equal(result.productResearchDiagnosticTrace.contentScriptPingAck, true)
  assert.equal(result.productResearchDiagnosticTrace.resultsReady, true)
  assert.equal(result.marketplaceWrites, 0)
})

test("a complete Product Research tab without a content script fails with a bounded stage trace", async () => {
  const result = await runProductResearchDiagnosticScenario({
    sendMessage: async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.")
    },
  })
  assert.equal(result.success, false)
  assert.equal(result.error, "PRODUCT_RESEARCH_AUTOMATED_CAPTURE_TIMEOUT")
  assert.deepEqual({
    lastConfirmedStage: result.diagnosticTrace.lastConfirmedStage,
    tabUpdatedComplete: result.diagnosticTrace.tabUpdatedComplete,
    finalUrlStateValid: result.diagnosticTrace.finalUrlStateValid,
    contentScriptPingAck: result.diagnosticTrace.contentScriptPingAck,
    captureRequestSent: result.diagnosticTrace.captureRequestSent,
    externalEbayBlocker: result.diagnosticTrace.externalEbayBlocker,
  }, {
    lastConfirmedStage: "CAPTURE_REQUEST_SENT",
    tabUpdatedComplete: true,
    finalUrlStateValid: true,
    contentScriptPingAck: false,
    captureRequestSent: true,
    externalEbayBlocker: "CONTENT_SCRIPT_MISSING",
  })
  const serialized = JSON.stringify(result.diagnosticTrace)
  assert.doesNotMatch(serialized, /https?:|one handle|159907|cookie|credential|<html/i)
  assert.equal(result.marketplaceWrites, 0)
})

test("query-bound Product Research capture does not require eBay to retain URL representation", async () => {
  const observedTaskBindings = []
  const result = await runProductResearchDiagnosticScenario({
    getTab: (currentTabUrl) => {
      const url = new URL(currentTabUrl)
      url.searchParams.delete("marketplace")
      url.hash = ""
      return { id: 42, url: url.href, status: "complete" }
    },
    sendMessage: async (message) => {
      if (message.taskBinding) observedTaskBindings.push(message.taskBinding)
      if (message.type === "IMNOVA_PRODUCT_RESEARCH_DIAGNOSTIC_PING_V1") {
        return { success: true, status: "READY",
          diagnostic: productResearchDiagnostic() }
      }
      if (message.type === "IMNOVA_AUTOMATED_PRODUCT_RESEARCH_CAPTURE_V1") {
        return { success: true, status: "READY", diagnostic: productResearchDiagnostic(),
          capture: { visibleResultCount: 1 } }
      }
      return { success: true, status: "READY", rows: [], soldFilterProven: true,
        nextPageAvailable: false }
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.productResearchDiagnosticTrace.finalUrlStateValid, false)
  assert.equal(result.productResearchDiagnosticTrace.urlStateClass,
    "QUERY_CATEGORY_MATCH_URL_REPRESENTATION_DIFFERENT")
  assert.equal(result.productResearchDiagnosticTrace.urlQueryState, "MATCH")
  assert.equal(result.productResearchDiagnosticTrace.urlCategoryState, "MATCH")
  assert.equal(result.productResearchDiagnosticTrace.urlMarketplaceState, "ABSENT")
  assert.equal(result.productResearchDiagnosticTrace.urlGuidedQueryState, "ABSENT")
  assert.equal(result.productResearchDiagnosticTrace.resultStateBoundToCurrentQuery, true)
  assert.ok(observedTaskBindings.length >= 2)
  assert.ok(observedTaskBindings.every((binding) =>
    binding.version === "PRODUCT_RESEARCH_TASK_BINDING_V1" &&
    binding.navigationAttested === true && binding.freshTabForTask === true))
  assert.equal(result.marketplaceWrites, 0)
})

test("task-scoped guided binding handles first, repeated, mismatched, and conflicting tasks fail closed", () => {
  const content = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  const start = content.indexOf("function automatedTaskBindingDecision(input)")
  const end = content.indexOf("function establishAutomatedGuidedState(message)")
  assert.ok(start > 0 && end > start)
  const decide = runInNewContext(`
    const PRODUCT_RESEARCH_TASK_BINDING_VERSION = "PRODUCT_RESEARCH_TASK_BINDING_V1";
    const text = (value) => typeof value === "string"
      ? value.normalize("NFKC").trim().replace(/\\s+/g, " ") : "";
    const normalizedQuery = (value) => text(value).toLocaleLowerCase("en-US");
    ${content.slice(start, end)}
    automatedTaskBindingDecision;
  `)
  const taskBinding = {
    version: "PRODUCT_RESEARCH_TASK_BINDING_V1",
    sessionId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-one-handle-posi-temp",
    ordinal: 1,
    expectedQuery: "one handle posi temp",
    expectedCategoryId: "159907",
    navigationAttested: true,
    freshTabForTask: true,
  }
  const current = {
    taskBinding,
    expectedQuery: "one handle posi temp",
    expectedCategoryId: "159907",
    queryStateMatch: true,
    categoryStateMatch: true,
    guidedStatePresent: false,
    guidedQuery: null,
    guidedCategoryId: null,
    existingBindingId: null,
  }
  const first = decide(current)
  assert.equal(first.accepted, true)
  assert.equal(first.reason, "TASK_BINDING_ATTESTED")

  const sameTaskReplay = decide({ ...current, guidedStatePresent: true,
    guidedQuery: current.expectedQuery, guidedCategoryId: current.expectedCategoryId,
    existingBindingId: first.bindingId })
  assert.equal(sameTaskReplay.accepted, true)
  assert.equal(sameTaskReplay.bindingId, first.bindingId)

  const repeatedQueryNewTask = decide({ ...current, taskBinding: {
    ...taskBinding, taskId: "task-one-handle-posi-temp-repeat", ordinal: 2,
  } })
  assert.equal(repeatedQueryNewTask.accepted, true)
  assert.notEqual(repeatedQueryNewTask.bindingId, first.bindingId)

  assert.equal(decide({ ...current, queryStateMatch: false }).reason,
    "QUERY_STATE_MISMATCH")
  assert.equal(decide({ ...current, categoryStateMatch: false }).reason,
    "CATEGORY_STATE_MISMATCH")
  assert.equal(decide({ ...current, guidedStatePresent: true,
    guidedQuery: current.expectedQuery, guidedCategoryId: current.expectedCategoryId,
    existingBindingId: "different-session:different-task:7" }).reason,
  "TASK_BINDING_CONFLICT")
  assert.equal(decide({ ...current, taskBinding: {
    ...taskBinding, expectedQuery: "different query",
  } }).reason, "TASK_BINDING_INVALID")
  assert.equal(decide({ ...current, taskBinding: {
    ...taskBinding, navigationAttested: false,
  } }).reason, "TASK_BINDING_INVALID")
})

test("the bounded trace distinguishes missing guided state from URL canonicalization", async () => {
  const result = await runProductResearchDiagnosticScenario({
    getTab: (currentTabUrl) => {
      const url = new URL(currentTabUrl)
      url.hash = ""
      return { id: 42, url: url.href, status: "complete" }
    },
    sendMessage: async () => ({ success: true, status: "PENDING",
      diagnostic: productResearchDiagnostic({
        resultsReady: false,
        guidedQueryStatePresent: false,
        guidedQueryMatch: false,
        resultIdentityState: "NONE",
        resultIdentityCount: 0,
        resultFingerprintChanged: false,
        resultStateBoundToCurrentQuery: false,
        readinessRejectionReason: "GUIDED_QUERY_STATE_MISSING",
      }) }),
  })
  assert.equal(result.success, false)
  assert.equal(result.error, "PRODUCT_RESEARCH_AUTOMATED_CAPTURE_TIMEOUT")
  assert.equal(result.diagnosticTrace.urlGuidedQueryState, "ABSENT")
  assert.equal(result.diagnosticTrace.urlGuidedStageState, "ABSENT")
  assert.equal(result.diagnosticTrace.guidedQueryStatePresent, false)
  assert.equal(result.diagnosticTrace.readinessRejectionReason,
    "GUIDED_QUERY_STATE_MISSING")
  assert.equal(result.diagnosticTrace.captureResponseState, "PENDING")
  const serialized = JSON.stringify(result.diagnosticTrace)
  assert.doesNotMatch(serialized, /https?:|one handle|159907|cookie|credential|<html/i)
})

test("an authenticated content script with no result shape reports source-format change fail closed", async () => {
  const result = await runProductResearchDiagnosticScenario({
    sendMessage: async (message) => {
      const diagnostic = productResearchDiagnostic({
        resultsContainerFound: false,
        resultsReady: false,
        resultIdentityState: "SOURCE_FORMAT_UNRECOGNIZED",
        resultIdentityCount: 0,
        resultFingerprintChanged: false,
        resultStateBoundToCurrentQuery: false,
        readinessRejectionReason: "SOURCE_FORMAT_UNRECOGNIZED",
      })
      return message.type === "IMNOVA_PRODUCT_RESEARCH_DIAGNOSTIC_PING_V1"
        ? { success: true, status: "READY", diagnostic }
        : { success: true, status: "PENDING", diagnostic }
    },
  })
  assert.equal(result.success, false)
  assert.equal(result.error, "PRODUCT_RESEARCH_AUTOMATED_CAPTURE_TIMEOUT")
  assert.equal(result.diagnosticTrace.contentScriptPingAck, true)
  assert.equal(result.diagnosticTrace.contentScriptBooted, true)
  assert.equal(result.diagnosticTrace.queryStateMatch, true)
  assert.equal(result.diagnosticTrace.categoryStateMatch, true)
  assert.equal(result.diagnosticTrace.captureResponseState, "PENDING")
  assert.equal(result.diagnosticTrace.sourceFormatChanged, true)
  assert.equal(result.diagnosticTrace.externalEbayBlocker, "SOURCE_FORMAT_CHANGED")
  assert.equal(result.diagnosticTrace.rowCount, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("a Product Research login redirect stops before capture and reports the external blocker", async () => {
  let messageCount = 0
  const result = await runProductResearchDiagnosticScenario({
    getTab: () => ({ id: 42, url: "https://signin.ebay.com/signin/", status: "complete" }),
    sendMessage: async () => {
      messageCount += 1
      throw new Error("UNEXPECTED_MESSAGE")
    },
  })
  assert.equal(result.success, false)
  assert.equal(result.error, "PRODUCT_RESEARCH_LOGIN_REDIRECT")
  assert.equal(result.diagnosticTrace.authState, "LOGIN_REQUIRED")
  assert.equal(result.diagnosticTrace.externalEbayBlocker, "LOGIN_REDIRECT")
  assert.equal(result.diagnosticTrace.captureRequestSent, false)
  assert.equal(result.diagnosticTrace.rowCount, 0)
  assert.equal(messageCount, 0)
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
  assert.match(page, /result\.extensionId !== result\.bridgeExtensionId/)
  assert.match(page, /Diagnóstico seguro del handshake/)
  assert.match(page, /probeEventsReceivedByBridge/)
  assert.match(page, /ackEventsReceivedByPage/)
  assert.match(page, /connectedStateCommitted/)
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
  assert.match(page, /safeProductResearchDiagnosticTrace/)
  assert.match(page, /Diagnóstico seguro Product Research/)
  assert.match(page, /Date\.now\(\) >= lease\.expiresAt/)
  assert.match(page, /researchSessionMode: "EBAY_ONE_CLICK_RESEARCH_SESSION_V1"/)
  assert.match(productRoute, /ONE_CLICK_RESEARCH_CAPTURE_ONLY/)
  assert.match(productRoute, /sameDayPilotStarted: false/)
  assert.match(productRoute, /lunaProductFitStarted: false/)
  assert.match(soldRoute, /adaptMainSearchSoldCaptureForCanonicalImport/)
  assert.match(soldRoute, /oneClickSoldEvidenceNoValidRowsCode/)
  assert.match(soldRoute, /taskOutcome: "NO_VALID_SOLD_EVIDENCE"/)
  assert.match(soldRoute, /validateEbayOneClickNoValidSoldEvidenceOutcome/)
  assert.match(soldRoute, /taskOutcome: oneClickResearch \? "DURABLE_SOLD_EVIDENCE" : null/)
  assert.match(soldRoute, /observedCount: captureAdapter\.sourceRowCount/)
  assert.match(soldRoute, /parsedCount: captureAdapter\.freshRowCount/)
  assert.match(soldRoute, /read_marketplace_sold_evidence_v1/)
  assert.match(soldRoute, /displayedVsRealizedGuard: "PASS"/)
  assert.match(soldRoute, /result\.reanalysisRequired && !oneClickResearch/)
  assert.doesNotMatch(soldRoute, /publishOffer|createOffer|shipping_fulfillment/)

  const noValidBranch = page.indexOf(
    'sold.result.taskOutcome === "NO_VALID_SOLD_EVIDENCE"',
  )
  const queryCompletion = page.indexOf("completedQueries += 1", noValidBranch)
  const sessionFailure = page.indexOf('status: "FAILED"', queryCompletion)
  assert.ok(noValidBranch >= 0 && queryCompletion > noValidBranch)
  assert.ok(sessionFailure > queryCompletion)
  assert.match(page, /COMPLETED_WITH_REJECTIONS/)
  assert.match(page, /rejectionReasonCounts/)
})

test("mobile review exposes the existing one-click action through an operator-facing research view", () => {
  const page = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  assert.match(page, /aria-label="Áreas de trabajo Seller OS"/)
  assert.match(page, /onClick=\{\(\) => setView\("loop2"\)\}/)
  assert.match(page, />Research automático<\/button>/)
  assert.match(page, /\{view === "loop2" && <Loop2ListingAiPanel \/>\}/)
})
