import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
  POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
  attributeOrderLineToListingV1,
  buildCanonicalOrderEventIngestionV1,
  buildCommercialSaleLearningEventV1,
  buildMonitorCoverageTransparencyV1,
  buildOrderSourceHealthV1,
  buildSaleTriggeredStockRecheckV1,
  buyerMessageIdempotencyKeyV1,
  evaluateBuyerMessageEligibilityV1,
  evaluateWhatsappSaleNotificationEligibilityV1,
  orderEventIdempotencyKeyV1,
  resolveMonitorCoverageForItemV1,
  saleEventIdempotencyKeyV1,
  whatsappSaleNotificationIdempotencyKeyV1,
} = await import("./ebay-sales-order-event-foundation-v1.ts")
const { stableCommercialKey } = await import(
  "../marketplace/commercial-monitor-domain.ts")

const ACCOUNT = "EBAY_US:SELLER_PRIMARY"
const CAPTURED_AT = "2026-08-13T15:30:00.000Z"
const HEARING_AIDS_ITEM_ID = "366575102453"

function line(overrides = {}) {
  return {
    ebayOrderId: "ORDER-100",
    lineItemId: "LINE-100",
    listingId: HEARING_AIDS_ITEM_ID,
    sku: "IMN-LST-000020",
    title:
      "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
    quantity: 1,
    lineItemAmount: 29.99,
    currency: "USD",
    shipByDate: "2026-08-15T23:59:59.000Z",
    ...overrides,
  }
}

function order(overrides = {}) {
  const ebayOrderId = overrides.ebayOrderId ?? "ORDER-100"
  const lineItems = overrides.lineItems ?? [line({ ebayOrderId })]
  return {
    ebayOrderId,
    creationDate: "2026-08-13T14:04:00.000Z",
    lastModifiedDate: "2026-08-13T14:05:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    totalAmount: 29.99,
    currency: "USD",
    marketplaceId: "EBAY_US",
    ...overrides,
    lineItems,
  }
}

function identity(overrides = {}) {
  return {
    listingKey: `EBAY_US:${HEARING_AIDS_ITEM_ID}`,
    itemId: HEARING_AIDS_ITEM_ID,
    sku: "IMN-LST-000020",
    title:
      "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
    currentLive: true,
    source: "CANONICAL_CURRENT_LIVE_COHORT",
    evidenceReference: `EBAY_ITEM:${HEARING_AIDS_ITEM_ID}`,
    ...overrides,
  }
}

function ingest(overrides = {}) {
  return buildCanonicalOrderEventIngestionV1({
    accountKey: ACCOUNT,
    sourceStatus: "AVAILABLE",
    observedAt: CAPTURED_AT,
    orders: [order()],
    listingIdentities: [identity()],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    ...overrides,
  })
}

function provenSale() {
  const result = ingest()
  assert.equal(result.saleEvents.length, 1)
  return result.saleEvents[0]
}

test("declares bounded official Fulfillment polling without claiming event-driven delivery", () => {
  const health = buildOrderSourceHealthV1({
    status: "AVAILABLE",
    permissionStatus: "PROVEN",
    pollIntervalMinutes: 5,
    observedAt: CAPTURED_AT,
    lastSuccessfulReadAt: CAPTURED_AT,
  })

  assert.equal(health.capability, "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(health.detectionPolicyVersion, "ORDER_DETECTION_POLICY_V1")
  assert.equal(health.detectionMode, "POLLING")
  assert.equal(health.eventDrivenStatus,
    "OFFICIAL_CAPABILITY_UNPROVEN_NOT_CONFIGURED")
  assert.equal(health.pollIntervalMinutes, 5)
  assert.equal(health.bounded, true)
  assert.equal(health.idempotent, true)
  assert.equal(health.incrementalCursor, true)
})

test("attributes with authoritative Item ID and uses SKU only as corroboration", () => {
  const result = attributeOrderLineToListingV1({
    line: line(),
    listingIdentities: [identity()],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "AVAILABLE",
  })

  assert.equal(result.status, "PROVEN")
  assert.equal(result.itemIdAuthority, "EBAY_ORDER_LINE_LEGACY_ITEM_ID")
  assert.equal(result.skuCorroboration, "MATCHED")
  assert.equal(result.currentLiveStatus, "PROVEN_CURRENT_LIVE")
  assert.deepEqual(result.reasonCodes, [
    "AUTHORITATIVE_ITEM_ID_MATCH",
    "ORDER_LINE_SKU_CORROBORATED",
  ])
})

test("does not require SKU when one authoritative Item ID identity exists", () => {
  const result = attributeOrderLineToListingV1({
    line: line({ sku: null }),
    listingIdentities: [identity()],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "AVAILABLE",
  })

  assert.equal(result.status, "PROVEN")
  assert.equal(result.skuCorroboration, "NOT_PROVIDED")
  assert.equal(result.listingKey, `EBAY_US:${HEARING_AIDS_ITEM_ID}`)
})

test("preserves PROVEN Item ID attribution while flagging a local SKU conflict", () => {
  const result = attributeOrderLineToListingV1({
    line: line({ sku: "CONFLICTING-SKU" }),
    listingIdentities: [identity()],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "AVAILABLE",
  })

  assert.equal(result.status, "PROVEN")
  assert.equal(result.localRelationshipStatus, "PARTIAL")
  assert.equal(result.itemId, HEARING_AIDS_ITEM_ID)
  assert.equal(result.skuCorroboration, "CONFLICT")
  assert.ok(result.reasonCodes.includes("SKU_CORROBORATION_CONFLICT"))
})

test("duplicate local identities remain AMBIGUOUS without erasing proven eBay Item ID", () => {
  const duplicate = identity({
    listingKey: `EBAY_US:${HEARING_AIDS_ITEM_ID}:SECONDARY`,
    sku: "OTHER-SKU",
    evidenceReference: "EBAY_ITEM:DUPLICATE",
  })
  const ambiguous = attributeOrderLineToListingV1({
    line: line({ sku: null }),
    listingIdentities: [identity(), duplicate],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "AVAILABLE",
  })
  const disambiguated = attributeOrderLineToListingV1({
    line: line(),
    listingIdentities: [identity(), duplicate],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "AVAILABLE",
  })

  assert.equal(ambiguous.status, "PROVEN")
  assert.equal(ambiguous.localRelationshipStatus, "AMBIGUOUS")
  assert.equal(ambiguous.humanReviewRequired, true)
  assert.equal(disambiguated.status, "PROVEN")
  assert.equal(disambiguated.listingSku, "IMN-LST-000020")
})

test("proves the eBay Item identity while local current-live detail remains partial", () => {
  const result = attributeOrderLineToListingV1({
    line: line(),
    listingIdentities: [],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID],
    listingSourceStatus: "PARTIAL",
  })

  assert.equal(result.status, "PROVEN")
  assert.equal(result.localRelationshipStatus, "PARTIAL")
  assert.equal(result.currentLiveStatus, "PROVEN_CURRENT_LIVE")
  assert.equal(result.listingKey, `EBAY_ITEM:${HEARING_AIDS_ITEM_ID}`)
  assert.ok(result.reasonCodes.includes("LISTING_IDENTITY_DETAIL_UNAVAILABLE"))
})

test("keeps official Item attribution but never invents a local relationship", () => {
  const unavailable = attributeOrderLineToListingV1({
    line: line(),
    listingIdentities: [],
    canonicalCurrentLiveItemIds: [],
    listingSourceStatus: "UNAVAILABLE",
  })
  const unresolved = attributeOrderLineToListingV1({
    line: line(),
    listingIdentities: [],
    canonicalCurrentLiveItemIds: [],
    listingSourceStatus: "AVAILABLE",
  })

  assert.equal(unavailable.status, "PROVEN")
  assert.equal(unavailable.localRelationshipStatus, "UNAVAILABLE")
  assert.equal(unavailable.itemId, HEARING_AIDS_ITEM_ID)
  assert.equal(unavailable.listingKey, `EBAY_ITEM:${HEARING_AIDS_ITEM_ID}`)
  assert.equal(unresolved.status, "PROVEN")
  assert.equal(unresolved.localRelationshipStatus, "UNPROVEN")
  assert.equal(unresolved.humanReviewRequired, true)
})

test("builds the Hearing Aids authoritative canonical order and sale event", () => {
  const result = ingest()

  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.idempotencyPolicyVersion, "ORDER_EVENT_IDEMPOTENCY_V1")
  assert.equal(result.orderCount, 1)
  assert.equal(result.orderLineEventCount, 1)
  assert.equal(result.saleEventCount, 1)
  assert.equal(result.accountTrafficUsedAsOrderEvidence, false)
  assert.equal(result.writesPerformed, 0)
  const event = result.orderLineEvents[0]
  assert.equal(event.orderId, "ORDER-100")
  assert.equal(event.ebayItemId, HEARING_AIDS_ITEM_ID)
  assert.equal(event.quantity, 1)
  assert.equal(event.unitPrice, 29.99)
  assert.equal(event.currency, "USD")
  assert.equal(event.soldAt, "2026-08-13T14:04:00.000Z")
  assert.equal(event.attributionStatus, "PROVEN")
  assert.equal(event.buyerPiiIncluded, false)
  assert.equal(result.saleEvents[0].independentOfAnalytics, true)
  assert.equal(result.saleEvents[0].independentOfSupplierState, true)
  assert.equal(result.saleEvents[0].independentOfNotificationState, true)
})

test("keeps a proven Order event when the independent listing source is unavailable", () => {
  const result = ingest({
    listingIdentities: [],
    listingSourceStatus: "UNAVAILABLE",
  })

  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.orderCount, 1)
  assert.equal(result.saleEventCount, 1)
  assert.equal(result.orderLineEvents[0].orderStatus, "PROVEN")
  assert.equal(result.orderLineEvents[0].attributionStatus, "PROVEN")
  assert.equal(result.orderLineEvents[0].attribution.localRelationshipStatus,
    "UNAVAILABLE")
  assert.equal(result.orderLineEvents[0].ebayItemId, HEARING_AIDS_ITEM_ID)
  assert.equal(result.orderLineEvents[0].listingTitle,
    "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling")
  assert.equal(result.saleEvents[0].status, "PROVEN")
  assert.equal(result.saleEvents[0].attributionStatus, "PROVEN")
})

test("dedupes repeated polling observations and produces one sale per order", () => {
  const first = order()
  const duplicate = order({ lastModifiedDate: "2026-08-13T14:06:00.000Z" })
  const result = ingest({ orders: [first, duplicate] })

  assert.equal(result.orderCount, 1)
  assert.equal(result.orderLineEventCount, 1)
  assert.equal(result.saleEventCount, 1)
  assert.equal(result.duplicateObservationsBlocked, 1)
  assert.equal(result.orderLineEvents[0].duplicateObservationCount, 2)
})

test("aggregates multiple order lines into one sale without losing line identity", () => {
  const secondItemId = "366592919965"
  const result = ingest({
    orders: [order({
      totalAmount: 44.99,
      lineItems: [
        line(),
        line({
          lineItemId: "LINE-200",
          listingId: secondItemId,
          sku: "IMN-LST-000026",
          title: "Second listing",
          quantity: 2,
          lineItemAmount: 15,
        }),
      ],
    })],
    listingIdentities: [identity(), identity({
      listingKey: `EBAY_US:${secondItemId}`,
      itemId: secondItemId,
      sku: "IMN-LST-000026",
      title: "Second listing",
      evidenceReference: `EBAY_ITEM:${secondItemId}`,
    })],
    canonicalCurrentLiveItemIds: [HEARING_AIDS_ITEM_ID, secondItemId],
  })

  assert.equal(result.orderLineEventCount, 2)
  assert.equal(result.saleEventCount, 1)
  assert.equal(result.saleEvents[0].quantity, 3)
  assert.deepEqual(result.saleEvents[0].itemIds, [
    HEARING_AIDS_ITEM_ID,
    secondItemId,
  ].sort())
  assert.deepEqual(result.saleEvents[0].orderLineItemIds, ["LINE-100", "LINE-200"])
})

test("preserves unknown-not-zero semantics when the official Orders source is unavailable", () => {
  const result = ingest({
    sourceStatus: "UNAVAILABLE",
    orders: [],
    listingIdentities: [],
  })

  assert.equal(result.orderCount, null)
  assert.equal(result.orderLineEventCount, null)
  assert.equal(result.saleEventCount, null)
  assert.deepEqual(result.orderLineEvents, [])
  assert.deepEqual(result.saleEvents, [])
  assert.ok(result.limitationCodes.includes("ORDER_SOURCE_UNAVAILABLE"))
})

test("partial Orders keeps entries bounded without an authoritative zero", () => {
  const result = ingest({
    sourceStatus: "PARTIAL",
    orders: [],
    listingIdentities: [],
  })

  assert.equal(result.status, "PARTIAL")
  assert.equal(result.orderCount, null)
  assert.equal(result.orderLineEventCount, null)
  assert.equal(result.saleEventCount, null)
  assert.deepEqual(result.saleEvents, [])
})

test("does not substitute account traffic quantitySold for an Order", () => {
  const result = ingest({ orders: [] })

  assert.equal(result.orderCount, 0)
  assert.equal(result.saleEventCount, 0)
  assert.equal(result.accountTrafficUsedAsOrderEvidence, false)
})

test("uses deterministic line and order idempotency at the intended grains", () => {
  const lineA = orderEventIdempotencyKeyV1(ACCOUNT, "ORDER-100", "LINE-100")
  const lineB = orderEventIdempotencyKeyV1(ACCOUNT, "ORDER-100", "LINE-200")
  const sale = saleEventIdempotencyKeyV1(ACCOUNT, "ORDER-100")
  const buyer = buyerMessageIdempotencyKeyV1(ACCOUNT, "ORDER-100")
  const whatsapp = whatsappSaleNotificationIdempotencyKeyV1(ACCOUNT, "ORDER-100")

  assert.match(lineA, /^commercial-v1:[0-9a-f]{64}$/)
  assert.equal(lineA, stableCommercialKey(
    ACCOUNT,
    "AUTHORITATIVE_ORDER_LINE_OBSERVED",
    "ORDER_EVENT_INGESTION_V1",
    "ORDER-100",
    "LINE-100",
  ))
  assert.notEqual(lineA, lineB)
  assert.notEqual(lineA, sale)
  assert.equal(buyer, buyerMessageIdempotencyKeyV1(ACCOUNT, "ORDER-100"))
  assert.equal(whatsapp, whatsappSaleNotificationIdempotencyKeyV1(
    ACCOUNT,
    "ORDER-100",
  ))
  assert.notEqual(buyer, buyerMessageIdempotencyKeyV1(ACCOUNT, "ORDER-101"))
  assert.notEqual(whatsapp, whatsappSaleNotificationIdempotencyKeyV1(
    ACCOUNT,
    "ORDER-101",
  ))
})

test("approves exactly the versioned buyer message only for a proven eligible order", () => {
  const result = evaluateBuyerMessageEligibilityV1({
    saleEvent: provenSale(),
    buyerOrderContext: "PROVEN",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })

  assert.equal(result.status, "ELIGIBLE")
  assert.equal(result.sendAllowed, true)
  assert.equal(result.templateVersion, POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION)
  assert.equal(result.approvedMessage,
    "Thank you for your purchase! We truly appreciate your business. " +
    "Your order is being processed, and we'll keep you updated with any " +
    "important information. If you have any questions, please feel free " +
    "to message us through eBay.")
  assert.equal(result.approvedMessage, POST_PURCHASE_THANK_YOU_TEMPLATE_V1)
  assert.equal(result.unrelatedMarketplaceWritesAllowed, false)
})

test("buyer message eligibility fails closed for missing context or capability", () => {
  const saleEvent = provenSale()
  const noContext = evaluateBuyerMessageEligibilityV1({
    saleEvent,
    buyerOrderContext: "UNPROVEN",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })
  const unavailable = evaluateBuyerMessageEligibilityV1({
    saleEvent,
    buyerOrderContext: "PROVEN",
    capability: "UNAVAILABLE",
    previouslySent: "NO",
  })
  const duplicate = evaluateBuyerMessageEligibilityV1({
    saleEvent,
    buyerOrderContext: "PROVEN",
    capability: "AVAILABLE",
    previouslySent: "YES",
  })

  assert.equal(noContext.status, "UNPROVEN")
  assert.equal(noContext.sendAllowed, false)
  assert.equal(unavailable.status, "UNAVAILABLE")
  assert.equal(unavailable.sendAllowed, false)
  assert.equal(duplicate.status, "ALREADY_SENT")
  assert.equal(duplicate.sendAllowed, false)
})

test("historical recovery records the sale but blocks retroactive notifications", () => {
  const saleEvent = provenSale()
  const buyer = evaluateBuyerMessageEligibilityV1({
    saleEvent,
    buyerOrderContext: "PROVEN",
    capability: "AVAILABLE",
    previouslySent: "NO",
    observationDisposition: "HISTORICAL_RECOVERY",
  })
  const whatsapp = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent,
    saleEventCreated: true,
    operatorDestination: "AUTHORIZED",
    capability: "AVAILABLE",
    previouslySent: "NO",
    observationDisposition: "HISTORICAL_RECOVERY",
  })

  assert.equal(buyer.sendAllowed, false)
  assert.ok(buyer.reasonCodes.includes(
    "HISTORICAL_RECOVERY_AUTOMATIC_SEND_BLOCKED"))
  assert.equal(whatsapp.sendAllowed, false)
  assert.ok(whatsapp.reasonCodes.includes(
    "HISTORICAL_RECOVERY_AUTOMATIC_SEND_BLOCKED"))
})

test("buyer and WhatsApp eligibility use proven Item ID despite local SKU conflict", () => {
  const provenItemSale = ingest({
    listingIdentities: [identity({ sku: "CONFLICTING-SKU" })],
  }).saleEvents[0]
  assert.equal(provenItemSale.attributionStatus, "PROVEN")
  assert.equal(provenItemSale.lineEvents[0].attribution.localRelationshipStatus,
    "PARTIAL")

  const buyer = evaluateBuyerMessageEligibilityV1({
    saleEvent: provenItemSale,
    buyerOrderContext: "PROVEN",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })
  const whatsapp = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent: provenItemSale,
    saleEventCreated: true,
    operatorDestination: "AUTHORIZED",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })

  assert.equal(buyer.sendAllowed, true)
  assert.equal(whatsapp.sendAllowed, true)
})

test("authorizes only one internal operator WhatsApp alert per proven order", () => {
  const saleEvent = provenSale()
  const eligible = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent,
    saleEventCreated: true,
    operatorDestination: "AUTHORIZED",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })
  const unavailable = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent,
    saleEventCreated: true,
    operatorDestination: "AUTHORIZED",
    capability: "UNAVAILABLE",
    previouslySent: "NO",
  })
  const unauthorized = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent,
    saleEventCreated: true,
    operatorDestination: "UNAUTHORIZED",
    capability: "AVAILABLE",
    previouslySent: "NO",
  })
  const duplicate = evaluateWhatsappSaleNotificationEligibilityV1({
    saleEvent,
    saleEventCreated: true,
    operatorDestination: "AUTHORIZED",
    capability: "AVAILABLE",
    previouslySent: "YES",
  })

  assert.equal(eligible.status, "ELIGIBLE")
  assert.equal(eligible.sendAllowed, true)
  assert.equal(eligible.channelScope, "INTERNAL_OPERATOR_SALE_ALERT_ONLY")
  assert.equal(eligible.buyerWhatsappAllowed, false)
  assert.equal(unavailable.status, "UNAVAILABLE")
  assert.equal(unavailable.sendAllowed, false)
  assert.equal(unauthorized.status, "UNPROVEN")
  assert.equal(unauthorized.sendAllowed, false)
  assert.equal(duplicate.status, "ALREADY_SENT")
  assert.equal(duplicate.sendAllowed, false)
})

test("sale-triggered stock recheck requests only a proven or human-approved link", () => {
  const saleEvent = provenSale()
  const proven = buildSaleTriggeredStockRecheckV1({
    saleEvent,
    supplierLinkStatus: "PROVEN",
  })
  const approved = buildSaleTriggeredStockRecheckV1({
    saleEvent,
    supplierLinkStatus: "HUMAN_APPROVED",
  })
  const pending = buildSaleTriggeredStockRecheckV1({
    saleEvent,
    supplierLinkStatus: "UNPROVEN",
  })

  assert.equal(proven.state, "STOCK_REFRESH_REQUEST_READY")
  assert.equal(proven.requestAllowed, true)
  assert.equal(approved.state, "STOCK_REFRESH_REQUEST_READY")
  assert.equal(pending.state, "SUPPLIER_RECHECK_PENDING_LINK")
  assert.equal(pending.requestAllowed, false)
  assert.equal(pending.requestExecuted, false)
  assert.equal(pending.stockInvented, false)
})

test("stock recheck remains blocked when authoritative order identity is invalid", () => {
  const saleEvent = structuredClone(provenSale())
  saleEvent.attributionStatus = "UNPROVEN"
  const result = buildSaleTriggeredStockRecheckV1({
    saleEvent,
    supplierLinkStatus: "HUMAN_APPROVED",
  })

  assert.equal(result.state, "STOCK_RECHECK_BLOCKED_ATTRIBUTION")
  assert.equal(result.requestAllowed, false)
})

test("creates persistence-ready learning evidence without causal claims", () => {
  const result = buildCommercialSaleLearningEventV1({
    saleEvent: provenSale(),
    listingVersions: { [HEARING_AIDS_ITEM_ID]: "listing-version-7" },
    primaryImageVersions: { [HEARING_AIDS_ITEM_ID]: "image-version-2" },
    trafficContext: { window: "LAST_30_DAYS", ctr: 0.21 },
    experimentState: { status: "NONE" },
    supplierState: { status: "UNPROVEN" },
    stockState: { state: "STOCK_UNKNOWN" },
    economicsState: { status: "UNPROVEN" },
  })

  assert.equal(result.persistenceStatus, "PERSISTENCE_READY")
  assert.equal(result.orderId, "ORDER-100")
  assert.equal(result.listingTitles[HEARING_AIDS_ITEM_ID],
    "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling")
  assert.equal(result.causalClaimAllowed, false)
  assert.equal(result.universalRuleAllowed, false)
  assert.equal(result.generalizationStatus, "INSUFFICIENT_FOR_GENERALIZATION")
  assert.equal(result.buyerPiiIncluded, false)
})

test("keeps learning ready for a proven Item while local relationship is ambiguous", () => {
  const duplicate = identity({ listingKey: "duplicate-listing" })
  const saleEvent = ingest({ listingIdentities: [identity(), duplicate] })
    .saleEvents[0]
  const result = buildCommercialSaleLearningEventV1({ saleEvent })

  assert.equal(saleEvent.attributionStatus, "PROVEN")
  assert.equal(saleEvent.lineEvents[0].attribution.localRelationshipStatus,
    "AMBIGUOUS")
  assert.equal(result.persistenceStatus, "PERSISTENCE_READY")
  assert.equal(result.causalClaimAllowed, false)
})

test("makes visible priority rows an explicit subset of monitored scope", () => {
  const itemIds = Array.from({ length: 27 }, (_, index) =>
    String(366575102453 + index))
  const visiblePriorityItemIds = itemIds.slice(1, 9)
  const coverage = buildMonitorCoverageTransparencyV1({
    scopeId: "current-live:scope-2026-08-13",
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    observedAt: CAPTURED_AT,
    listingCount: itemIds.length,
    itemIds,
    identityStatus: "CERTIFIED",
    visiblePriorityItemIds,
  })
  const hearingAids = resolveMonitorCoverageForItemV1(
    coverage,
    HEARING_AIDS_ITEM_ID,
  )

  assert.equal(coverage.status, "AVAILABLE")
  assert.equal(coverage.currentLiveScopeCount, 27)
  assert.equal(coverage.visiblePriorityRowCount, 8)
  assert.deepEqual(coverage.visiblePriorityItemIds, visiblePriorityItemIds)
  assert.equal(coverage.monitoredOutsideVisibleCount, 19)
  assert.equal(coverage.visibleRowsEqualMonitoredScope, false)
  assert.equal(coverage.visibleRowsArePresentationSubset, true)
  assert.equal(coverage.notVisibleDoesNotMeanNotMonitored, true)
  assert.equal(hearingAids.currentLive, true)
  assert.equal(hearingAids.monitored, true)
  assert.equal(hearingAids.visibleInPriorityRows, false)
  assert.equal(hearingAids.monitoredOutsideTopN, true)
  assert.equal(hearingAids.status, "MONITORED")
})

test("coverage excludes visible rows outside the canonical current-live cohort", () => {
  const coverage = buildMonitorCoverageTransparencyV1({
    scopeId: "current-live:test",
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    observedAt: CAPTURED_AT,
    listingCount: 2,
    itemIds: [HEARING_AIDS_ITEM_ID, "366592919965"],
    identityStatus: "CERTIFIED",
    visiblePriorityItemIds: [HEARING_AIDS_ITEM_ID, "999999999999"],
  })

  assert.deepEqual(coverage.visiblePriorityItemIds, [HEARING_AIDS_ITEM_ID])
  assert.equal(coverage.visiblePriorityRowCount, 1)
  assert.equal(coverage.monitoredOutsideVisibleCount, 1)
})

test("coverage preserves an unproven count as null rather than zero", () => {
  const coverage = buildMonitorCoverageTransparencyV1({
    scopeId: "current-live:unavailable",
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    observedAt: null,
    listingCount: null,
    itemIds: [],
    identityStatus: "UNPROVEN",
    visiblePriorityItemIds: [],
  })

  assert.equal(coverage.status, "UNPROVEN")
  assert.equal(coverage.currentLiveScopeCount, null)
  assert.equal(coverage.monitoredOutsideVisibleCount, null)
  assert.equal(coverage.visibleRowsEqualMonitoredScope, null)
})

test("coverage suppresses a numeric count when canonical identity is unproven", () => {
  const coverage = buildMonitorCoverageTransparencyV1({
    scopeId: "current-live:identity-unproven",
    scopeType: "CURRENT_LIVE_COHORT_SCOPE",
    observedAt: CAPTURED_AT,
    listingCount: 27,
    itemIds: [],
    identityStatus: "UNPROVEN",
    visiblePriorityItemIds: [],
  })

  assert.equal(coverage.status, "UNPROVEN")
  assert.equal(coverage.currentLiveScopeCount, null)
  assert.equal(coverage.monitoredOutsideVisibleCount, null)
})

test("foundation module is pure and declares no network, persistence, or send path", () => {
  const source = readFileSync(
    new URL("./ebay-sales-order-event-foundation-v1.ts", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /\.from\s*\(/)
  assert.doesNotMatch(source, /\.insert\s*\(/)
  assert.doesNotMatch(source, /\.update\s*\(/)
  assert.doesNotMatch(source, /sendMessage|sendWhatsapp|reviseItem|endItem/i)
  assert.doesNotMatch(source, /buyer(?:Name|Email|Address|Phone)/i)
})
