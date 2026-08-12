import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  assertSanitizedLunaBrowserCaptureV1,
  buildLunaAuthenticatedBrowserAgentRequestV1,
  buildLunaAuthenticatedHttpRequestV1,
  buildLunaWatcherApprovalPersistenceContractV1,
  buildLunaWatcherAutomaticResponseV1,
  buildLunaWatcherBatchPlanV1,
  evaluateLunaAuthenticatedBrowserCaptureV1,
  parseLunaAuthenticatedHttpCaptureV1,
  readLunaWatcherHumanApprovalContractV1,
  resolveLunaWatcherSourcePriorityV1,
  scheduleLunaWatcherObservationV1,
} from "./ebay-luna-supplier-stock-watcher-v1.ts"

const observedAt = "2026-08-12T15:00:00.000Z"

function link(overrides = {}) {
  return {
    accountKey: "protected-account",
    ebayItemId: "366581876813",
    ebaySku: "EBAY-NECK-FAN-1",
    listingTitle: "Portable Neck Fan",
    supplierProductId: "1001",
    supplierVariantId: "2002",
    supplierSku: "LUNA-EXACT-2002",
    canonicalSourceUrl: "https://lunaportex.com/products/portable-neck-fan",
    currency: "USD",
    classification: "EXACT_PROVEN",
    humanApproved: true,
    approvedAt: "2026-08-12T14:55:00.000Z",
    approvalProvenance: "HUMAN_APPROVED_LUNA_ACTIVATION_PREVIEW",
    ...overrides,
  }
}

function response(status, body, overrides = {}) {
  return { status, body, location: null, contentType: "text/html", ...overrides }
}

function httpCapture(overrides = {}) {
  const request = buildLunaAuthenticatedHttpRequestV1(link())
  return parseLunaAuthenticatedHttpCaptureV1({
    request,
    protectedSessionValuePresent: true,
    htmlResponse: response(200,
      '<script>{"customerId":123}</script><meta property="og:price:currency" content="USD">'),
    productResponse: response(200, JSON.stringify({
      id: 1001,
      handle: "portable-neck-fan",
      variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: true,
        inventory_quantity: 2, price: 1999, compare_at_price: 2499 }],
    }), { contentType: "application/json" }),
    observedAt,
    ...overrides,
  })
}

test("the first watcher link must be exact and human approved", () => {
  assert.equal(buildLunaAuthenticatedHttpRequestV1(link()).transportPolicy.serverOnly, true)
  const persistence = buildLunaWatcherApprovalPersistenceContractV1(link())
  assert.deepEqual(persistence.seller_os_luna_watcher_v1, {
    contractVersion: "LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12",
    classification: "EXACT_PROVEN",
    humanApproved: true,
    ebayItemId: "366581876813",
    supplierProductId: "1001",
    supplierVariantId: "2002",
    supplierSku: "LUNA-EXACT-2002",
    canonicalSourceUrl: "https://lunaportex.com/products/portable-neck-fan",
    approvedAt: "2026-08-12T14:55:00.000Z",
    approvalProvenance: "HUMAN_APPROVED_LUNA_ACTIVATION_PREVIEW",
  })
  assert.equal(readLunaWatcherHumanApprovalContractV1({
    rawPayload: persistence,
    ebayItemId: "366581876813",
    supplierVariantId: "2002",
    supplierSku: "LUNA-EXACT-2002",
  })?.supplierProductId, "1001")
  assert.equal(readLunaWatcherHumanApprovalContractV1({
    rawPayload: persistence,
    ebayItemId: "366581876999",
    supplierVariantId: "2002",
    supplierSku: "LUNA-EXACT-2002",
  }), null)
  for (const unsafe of [
    link({ humanApproved: false }),
    link({ classification: "STRONG_CANDIDATE_HUMAN_REVIEW" }),
    link({ supplierVariantId: "" }),
    link({ approvalProvenance: "" }),
    link({ canonicalSourceUrl: "https://lunaportex.com.attacker.test/products/example" }),
    link({ canonicalSourceUrl: "https://lunaportex.com/products/example?token=forbidden" }),
  ]) assert.throws(() => buildLunaAuthenticatedBrowserAgentRequestV1(unsafe),
    /LUNA_WATCHER_EXACT_HUMAN_LINK_REQUIRED/)
})

test("authenticated HTTP capture preserves explicit stock and sale pricing", () => {
  const capture = httpCapture()
  assert.equal(capture.sourceMode, "AUTHENTICATED_SERVER_HTTP")
  assert.equal(capture.sessionState, "SESSION_OK")
  assert.equal(capture.productId, "1001")
  assert.equal(capture.variantId, "2002")
  assert.equal(capture.supplierSku, "LUNA-EXACT-2002")
  assert.equal(capture.quantity, 2)
  assert.equal(capture.quantityExplicit, true)
  assert.equal(capture.regularPrice, 24.99)
  assert.equal(capture.salePrice, 19.99)
  assert.equal(capture.currency, "USD")
  assert.equal(capture.serverAttestation.rawSessionMaterialExported, false)
  assertSanitizedLunaBrowserCaptureV1(capture)
  const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture, now: observedAt,
  })
  assert.equal(observation.stockState, "LOW_STOCK_CONFIRMED")
  assert.equal(observation.sourceStatus, "SESSION_OK")
})

test("server HTTP keeps Shopify money in minor units and ignores unscoped low-stock banners", () => {
  const request = buildLunaAuthenticatedHttpRequestV1(link())
  const capture = parseLunaAuthenticatedHttpCaptureV1({
    request,
    protectedSessionValuePresent: true,
    htmlResponse: response(200,
      '<script>{"customerId":123}</script><p>Only 1 left</p>'),
    productResponse: response(200, JSON.stringify({
      id: 1001,
      variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: true, price: 85 }],
    }), { contentType: "application/json" }),
    observedAt,
  })
  assert.equal(capture.regularPrice, 0.85)
  assert.equal(capture.explicitLowStock, false)
  assert.equal(evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture, now: observedAt,
  }).stockState, "IN_STOCK_CONFIRMED")
})

test("login redirects, 403, timeout and missing session never become out of stock", () => {
  const request = buildLunaAuthenticatedHttpRequestV1(link())
  const cases = [
    parseLunaAuthenticatedHttpCaptureV1({ request, protectedSessionValuePresent: true,
      htmlResponse: response(302, "", { location: "/account/login" }),
      productResponse: null, observedAt }),
    parseLunaAuthenticatedHttpCaptureV1({ request, protectedSessionValuePresent: true,
      htmlResponse: response(403, "Access Restricted"), productResponse: null, observedAt }),
    parseLunaAuthenticatedHttpCaptureV1({ request, protectedSessionValuePresent: true,
      htmlResponse: null, productResponse: null, observedAt }),
    parseLunaAuthenticatedHttpCaptureV1({ request, protectedSessionValuePresent: false,
      htmlResponse: null, productResponse: null, observedAt }),
  ]
  assert.deepEqual(cases.map((capture) => capture.sessionState), [
    "REAUTH_REQUIRED", "AUTHORIZATION_DENIED", "SOURCE_UNAVAILABLE", "REAUTH_REQUIRED",
  ])
  for (const capture of cases) {
    const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
      link: link(), capture, now: observedAt,
    })
    assert.equal(observation.stockState, "SOURCE_UNAVAILABLE")
    assert.equal(observation.safety.authFailureIsOutOfStock, false)
  }
})

test("missing exact variant and changed product identity fail closed", () => {
  const request = buildLunaAuthenticatedHttpRequestV1(link())
  const sessionHtml = response(200, '<script>{"customerId":123}</script>')
  const variantMissing = parseLunaAuthenticatedHttpCaptureV1({ request,
    protectedSessionValuePresent: true, htmlResponse: sessionHtml,
    productResponse: response(200, JSON.stringify({ id: 1001, variants: [] })), observedAt })
  const productChanged = parseLunaAuthenticatedHttpCaptureV1({ request,
    protectedSessionValuePresent: true, htmlResponse: sessionHtml,
    productResponse: response(200, JSON.stringify({ id: 9999, variants: [] })), observedAt })
  assert.equal(variantMissing.sessionState, "VARIANT_UNPROVEN")
  assert.equal(productChanged.sessionState, "SOURCE_CHANGED")
  assert.equal(evaluateLunaAuthenticatedBrowserCaptureV1({ link: link(),
    capture: variantMissing, now: observedAt }).stockState, "STOCK_UNKNOWN")
  assert.equal(evaluateLunaAuthenticatedBrowserCaptureV1({ link: link(),
    capture: productChanged, now: observedAt }).stockState, "SOURCE_CHANGED")
  const conflictingStock = parseLunaAuthenticatedHttpCaptureV1({ request,
    protectedSessionValuePresent: true, htmlResponse: sessionHtml,
    productResponse: response(200, JSON.stringify({ id: 1001,
      variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: false,
        inventory_quantity: 4, price: 1999 }] })), observedAt })
  assert.equal(conflictingStock.sessionState, "SOURCE_CHANGED")
  assert.equal(evaluateLunaAuthenticatedBrowserCaptureV1({ link: link(),
    capture: conflictingStock, now: observedAt }).stockState, "SOURCE_CHANGED")
})

test("authenticated web unavailable and numeric zero require two observations", () => {
  const firstCapture = httpCapture({ productResponse: response(200, JSON.stringify({
    id: 1001, variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: false,
      price: 1999 }],
  })) })
  const first = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: firstCapture, now: observedAt,
  })
  assert.equal(first.stockState, "OUT_OF_STOCK_SIGNAL")
  assert.equal(first.outOfStockSignalCount, 1)
  const replay = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: firstCapture, previous: first, now: observedAt,
  })
  assert.equal(replay.stockState, "OUT_OF_STOCK_SIGNAL")
  const secondObservedAt = "2026-08-12T16:00:00.000Z"
  const secondCapture = { ...firstCapture, observedAt: secondObservedAt,
    sourceEvidenceFingerprint: "luna_agent_evidence_aaaaaaaaaaaaaaaaaaaaaaaa" }
  const second = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: secondCapture, previous: first, now: secondObservedAt,
  })
  assert.equal(second.stockState, "OUT_OF_STOCK_CONFIRMED")
  const explicitZero = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: httpCapture({ productResponse: response(200, JSON.stringify({
      id: 1001, variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: false,
        inventory_quantity: 0, price: 1999 }],
    })) }), now: observedAt,
  })
  assert.equal(explicitZero.stockState, "OUT_OF_STOCK_SIGNAL")
  assert.equal(explicitZero.confirmationPolicy,
    "TWO_CONSISTENT_AUTHENTICATED_WEB_OBSERVATIONS")
})

test("stale evidence is not low stock and unknown is not risk", () => {
  const stale = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: httpCapture(), now: "2026-08-15T15:00:00.000Z",
  })
  assert.equal(stale.stockState, "STALE_EVIDENCE")
  assert.equal(stale.safety.staleIsLowStock, false)
  assert.equal(stale.safety.unknownIsRisk, false)
})

test("confirmed out of stock prepares exceptions, hard override and WhatsApp dry-run only", () => {
  const first = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: httpCapture({ productResponse: response(200, JSON.stringify({
      id: 1001, variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: false,
        inventory_quantity: 0, price: 1999 }],
    })) }), now: observedAt,
  })
  const confirmedAt = "2026-08-12T16:00:00.000Z"
  const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: httpCapture({ productResponse: response(200, JSON.stringify({
      id: 1001, variants: [{ id: 2002, sku: "LUNA-EXACT-2002", available: false,
        inventory_quantity: 0, price: 1999 }],
    })), observedAt: confirmedAt }), previous: first, now: confirmedAt,
  })
  const responsePlan = buildLunaWatcherAutomaticResponseV1({
    link: link(), observation, publishedQuantity: 5,
  })
  assert.equal(responsePlan.responseState, "CRITICAL_RESPONSE_PREPARED")
  assert.equal(responsePlan.criticalException.severity, "CRITICAL")
  assert.equal(responsePlan.experimentGuardian.state, "HARD_OVERRIDE")
  assert.equal(responsePlan.publishedExposure.exposedQuantity, 5)
  assert.equal(responsePlan.whatsappStockCriticalDryRun.dispatchAllowed, false)
  assert.equal(responsePlan.whatsappStockCriticalDryRun.realSendAttempted, false)
  assert.equal(responsePlan.stockExceptionCreated, false)
  assert.equal(responsePlan.ebayWriteAttempted, false)
})

test("adaptive scheduling is priority-aware and batch capture deduplicates dependents", () => {
  const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: link(), capture: httpCapture(), now: observedAt,
  })
  const schedule = scheduleLunaWatcherObservationV1({ observation,
    commercialExposureScore: 90 })
  assert.equal(schedule.priority, "P1_HIGH")
  assert.equal(schedule.controls.maximumConcurrency, 4)
  const lowStockSchedule = scheduleLunaWatcherObservationV1({ observation,
    commercialExposureScore: 0 })
  assert.equal(lowStockSchedule.priority, "P1_HIGH")
  assert.equal(lowStockSchedule.intervalMinutes, 60)
  const secondLink = link({ ebayItemId: "366581876814", ebaySku: "KIT-DEPENDENT" })
  const plan = buildLunaWatcherBatchPlanV1({ now: observedAt, maximumBatchSize: 1,
    maximumConcurrency: 99, records: [
      { link: link(), dependencyKey: "listing:1", latestObservation: observation,
        nextCheckAt: observedAt, commercialExposureScore: 90 },
      { link: secondLink, dependencyKey: "bundle:2", latestObservation: null,
        nextCheckAt: observedAt, commercialExposureScore: 40 },
    ] })
  assert.equal(plan.uniqueExactIdentityCount, 1)
  assert.equal(plan.dependentRecordCount, 2)
  assert.equal(plan.deduplicatedCaptureCount, 1)
  assert.equal(plan.selected[0].dependentEbayItemIds.length, 2)
  assert.equal(plan.controls.maximumConcurrency, 4)
})

test("capture DTOs reject credential-like and raw-page fields", () => {
  const capture = httpCapture()
  assert.throws(() => assertSanitizedLunaBrowserCaptureV1({
    ...capture, authorizationToken: "must-not-cross-boundary",
  }), /LUNA_WATCHER_CREDENTIAL_OR_RAW_PAGE_FIELD_REJECTED/)
  assert.throws(() => assertSanitizedLunaBrowserCaptureV1({
    ...capture, rawHtml: "<html />",
  }), /LUNA_WATCHER_CREDENTIAL_OR_RAW_PAGE_FIELD_REJECTED/)
})

test("server authenticated HTTP is preferred and browser automation stays a fallback", () => {
  assert.equal(resolveLunaWatcherSourcePriorityV1({
    protectedServerSessionPresent: true,
  }).actualMode, "AUTHENTICATED_SERVER_HTTP")
  assert.equal(resolveLunaWatcherSourcePriorityV1({
    protectedServerSessionPresent: false,
  }).actualMode, "AUTHENTICATED_SERVER_HTTP")
  assert.equal(resolveLunaWatcherSourcePriorityV1({
    protectedServerSessionPresent: false,
  }).sourcePriority[1].status, "NOT_EVALUATED_SERVER_HTTP_FIRST")

  const gateway = readFileSync(new URL(
    "./ebay-luna-authenticated-http-watcher-v1.ts", import.meta.url,
  ), "utf8")
  assert.match(gateway, /^import "server-only"/)
  assert.match(gateway, /redirect: "manual"/)
  assert.match(gateway, /lunaCookiePresent:/)
  assert.match(gateway, /lunaCookieServerOnly: present && !clientExposed/)
  assert.match(gateway, /lunaCookieClientExposed:/)
  assert.doesNotMatch(gateway, /console\.(?:log|warn|error)/)
  assert.doesNotMatch(gateway, /NEXT_PUBLIC_LUNAPORTEX_AUTH_COOKIE[^\n]*=/)
})
