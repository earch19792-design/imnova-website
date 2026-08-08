import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") &&
        !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try {
        return nextResolve(`${value}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  getEbayCommercialMonitorLiveReadonly,
  hashEbayMonitorEvidenceIdentifier,
} = await import("./ebay-commercial-monitor-live-readonly.ts")
const { ebayProductionAccountFingerprint } = await import(
  "./ebay-seller-account-scope.ts"
)
const { getCommercialMonitorReadonly } = await import(
  "./commercial-monitor-readonly-service.ts"
)

const NOW = new Date("2026-08-08T16:00:00.000Z")
const USER_ID = "seller-certified-test"
const ACCOUNT_ALIAS = "seller-test"
const FINGERPRINT = ebayProductionAccountFingerprint(USER_ID)
const ACCOUNT_KEY = `${ACCOUNT_ALIAS}:${FINGERPRINT}`

function environment() {
  return {
    EBAY_CLIENT_ID: "client-id-test-only",
    EBAY_CLIENT_SECRET: "client-secret-test-only",
    EBAY_SELLER_REFRESH_TOKEN: "seller-refresh-test-only",
    EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN: "orders-refresh-test-only",
    EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_ALIAS,
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function xml(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/xml" },
  })
}

function sellerPage({
  page = 1,
  totalPages = 1,
  hasMore = null,
  site = "US",
} = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack><ActiveList><PaginationResult>
        <TotalNumberOfPages>${totalPages}</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries>
      </PaginationResult><HasMoreItems>${hasMore ?? page < totalPages}</HasMoreItems>
      <ItemArray><Item><ItemID>123456789012</ItemID>
        <Title>Live listing sanitized</Title><SKU>LIVE-SKU</SKU><Site>${site}</Site>
        <ListingType>FixedPriceItem</ListingType><Quantity>4</Quantity>
        <SellingStatus><QuantitySold>1</QuantitySold>
          <CurrentPrice currencyID="USD">19.95</CurrentPrice></SellingStatus>
      </Item></ItemArray></ActiveList>
    </GetMyeBaySellingResponse>`
}

function ambiguousVariationPage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray><Item>
      <ItemID>123456789012</ItemID><Title>Ambiguous variants</Title>
      <Site>US</Site><Variations><Variation></Variation><Variation></Variation></Variations>
    </Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`
}

function repeatedItemWithoutVariationIdentityPage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray>
      <Item><ItemID>123456789012</ItemID><SKU>BLUE-SKU</SKU><Site>US</Site></Item>
      <Item><ItemID>123456789012</ItemID><SKU>RED-SKU</SKU><Site>US</Site></Item>
    </ItemArray></ActiveList></GetMyeBaySellingResponse>`
}

function analyticsPayload() {
  const keys = [
    "TOTAL_IMPRESSION_TOTAL",
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_SOURCE_OFF_EBAY",
    "LISTING_VIEWS_TOTAL",
    "CLICK_THROUGH_RATE",
    "TRANSACTION",
    "SALES_CONVERSION_RATE",
  ]
  return {
    header: {
      dimensionKeys: [{ key: "LISTING" }],
      metrics: keys.map((key) => ({ key })),
    },
    startDate: "2026-07-09",
    endDate: "2026-08-07",
    lastUpdatedDate: "2026-08-07",
    records: [{
      dimensionValues: [{ value: "123456789012" }],
      metricValues: [10, 5, 1, 2, 3, 0.2, 0, 0].map((value) => ({
        value,
        applicable: true,
      })),
    }],
  }
}

function fakeEbay(options = {}) {
  const calls = []
  const fulfillmentRefreshTokens = []
  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url)
    const headers = new Headers(init.headers)
    const body = init.body instanceof URLSearchParams
      ? init.body.toString()
      : String(init.body ?? "")
    calls.push({
      method: init.method,
      path: parsedUrl.pathname,
      tradingCall: headers.get("X-EBAY-API-CALL-NAME"),
    })
    if (options.malformedJsonPath === parsedUrl.pathname) {
      return new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (parsedUrl.pathname === "/identity/v1/oauth2/token") {
      if (options.invalidFirstOauth && calls.length === 1) {
        return json({ expires_in: 7200 })
      }
      const params = new URLSearchParams(body)
      const scope = params.get("scope") ?? ""
      if (scope.includes("sell.fulfillment.readonly")) {
        fulfillmentRefreshTokens.push(params.get("refresh_token"))
      }
      const returnedScope = options.missingScope
        ? scope.split(" ").filter((entry) =>
            entry !== options.missingScope).join(" ")
        : scope
      const fulfillmentScope =
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly"
      const isolatedReturnedScope = options.crossTokenFulfillmentMismatch
        ? scope.includes(fulfillmentScope)
          ? returnedScope.split(" ").filter((entry) =>
              entry !== fulfillmentScope).join(" ")
          : `${returnedScope} ${fulfillmentScope}`.trim()
        : returnedScope
      return json({
        access_token: "ephemeral-access-token-test-only",
        expires_in: 7200,
        scope: isolatedReturnedScope,
      })
    }
    if (parsedUrl.pathname === "/ws/api.dll" &&
        headers.get("X-EBAY-API-CALL-NAME") === "GetUser") {
      return xml(`<GetUserResponse><Ack>Success</Ack><User>
        <UserID>${options.accountMismatch ? "other-seller" : USER_ID}</UserID>
        <Site>US</Site><Email>private@example.invalid</Email>
      </User></GetUserResponse>`)
    }
    if (parsedUrl.pathname === "/ws/api.dll") {
      const page = Number(body.match(/<PageNumber>(\d+)<\/PageNumber>/)?.[1])
      if (options.discoverySecondPageFails && page === 2) {
        return xml("<Failure />", 503)
      }
      if (options.ambiguousVariations) return xml(ambiguousVariationPage())
      if (options.repeatedItemWithoutVariationIdentity) {
        return xml(repeatedItemWithoutVariationIdentityPage())
      }
      return xml(sellerPage({
        page,
        totalPages: options.discoverySecondPageFails ? 2 : 1,
        hasMore: options.paginationMetadataConflict && page === 1
          ? true
          : null,
        site: options.nonUsListing ? "DE" : "US",
      }))
    }
    if (parsedUrl.pathname === "/sell/inventory/v1/inventory_item") {
      if (options.inventoryBooleanTotal) {
        return json({ total: false, inventoryItems: [] })
      }
      if (options.inventoryRowsExceedTotal) {
        return json({ total: 0, inventoryItems: [{ sku: "LIVE-SKU" }] })
      }
      if (options.offerRowsExceedTotal || options.offerSkuMismatch) {
        return json({ total: 1, inventoryItems: [{ sku: "LIVE-SKU" }] })
      }
      if (options.inventoryTotalDrift) {
        const offset = Number(parsedUrl.searchParams.get("offset") ?? 0)
        return offset === 0
          ? json({
              total: 100,
              next: "https://api.ebay.com/sell/inventory/v1/inventory_item?offset=50",
              inventoryItems: Array.from({ length: 50 }, () => ({
                sku: "LIVE-SKU",
              })),
            })
          : json({
              total: 80,
              inventoryItems: Array.from({ length: 30 }, () => ({
                sku: "LIVE-SKU",
              })),
            })
      }
      if (options.concurrentOfferParseFailure) {
        return json({
          total: 2,
          inventoryItems: [{ sku: "GOOD-SKU" }, { sku: "BAD-SKU" }],
        })
      }
      if (options.inventorySecondPageFails) {
        const offset = Number(parsedUrl.searchParams.get("offset") ?? 0)
        if (offset > 0) return json({ error: "unavailable" }, 503)
        return json({
          total: 100,
          next: "https://api.ebay.com/sell/inventory/v1/inventory_item?offset=50",
          inventoryItems: Array.from({ length: 50 }, () => ({
            sku: "LIVE-SKU",
          })),
        })
      }
      if (options.inventoryNextConflict) {
        return json({
          total: 1,
          next: "https://api.ebay.com/sell/inventory/v1/inventory_item?offset=1",
          inventoryItems: [{ sku: "LIVE-SKU" }],
        })
      }
      return json({ total: 0, inventoryItems: [] })
    }
    if (parsedUrl.pathname === "/sell/inventory/v1/offer") {
      if (options.offerSkuMismatch) {
        return json({
          total: 1,
          offers: [{
            status: "PUBLISHED",
            marketplaceId: "EBAY_US",
            sku: "OTHER-SKU",
            listing: { listingId: "123456789012" },
          }],
        })
      }
      if (options.offerRowsExceedTotal) {
        return json({
          total: 0,
          offers: [{
            status: "PUBLISHED",
            marketplaceId: "EBAY_US",
            sku: "LIVE-SKU",
            listing: { listingId: "123456789012" },
          }],
        })
      }
      if (options.concurrentOfferParseFailure) {
        if (parsedUrl.searchParams.get("sku") === "BAD-SKU") {
          return new Response("{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return json({ total: 0, offers: [] })
      }
      if (options.inventorySecondPageFails) {
        return json({
          total: 1,
          offers: [{
            status: "PUBLISHED",
            marketplaceId: "EBAY_US",
            sku: "LIVE-SKU",
            listing: { listingId: "123456789012" },
          }],
        })
      }
      return json({ total: 0, offers: [] })
    }
    if (parsedUrl.pathname === "/sell/analytics/v1/traffic_report") {
      const payload = analyticsPayload()
      if (options.analyticsReportedLowCalculatedHigh) {
        payload.records[0].metricValues = [
          200, 100, 20, 2, 30, 0.001, 0, 0,
        ].map((value) => ({ value, applicable: true }))
      }
      if (options.analyticsReportedHighCalculatedLow) {
        payload.records[0].metricValues = [
          200, 100, 1, 2, 30, 99, 0, 0,
        ].map((value) => ({ value, applicable: true }))
      }
      if (options.analyticsMissingMetrics) payload.header.metrics = []
      if (options.analyticsDuplicateMetricDefinitions) {
        payload.header.metrics.push({ key: "TOTAL_IMPRESSION_TOTAL" })
        payload.records[0].metricValues.push({ value: 999, applicable: true })
      }
      if (options.analyticsExtraCells) {
        payload.records[0].metricValues.push({ value: 999, applicable: true })
      }
      if (options.analyticsMissingCells) payload.records[0].metricValues = []
      if (options.analyticsMissingApplicable) {
        delete payload.records[0].metricValues[0].applicable
      }
      if (options.analyticsInvalidApplicableValue) {
        payload.records[0].metricValues[0].value = "not-a-number"
      }
      if (options.analyticsBooleanMetric) {
        payload.records[0].metricValues[0].value = false
      }
      if (options.analyticsLastUpdated) {
        payload.lastUpdatedDate = options.analyticsLastUpdated
      }
      if (options.analyticsInvalidDates) {
        payload.startDate = "9999-99-99"
        payload.endDate = "9999-99-99"
        payload.lastUpdatedDate = "9999-99-99"
      }
      if (options.analyticsDuplicateListing) {
        payload.records.push(structuredClone(payload.records[0]))
      }
      if (options.analyticsExtraDimension) {
        payload.header.dimensionKeys.push({ key: "DAY" })
        payload.records[0].dimensionValues.push({ value: "2026-08-07" })
      }
      if (options.analyticsVariationDimension) {
        payload.records[0].dimensionValues[0].value = "v1|123456789012|42"
      }
      if (options.analyticsNarrowWindow) payload.startDate = "2026-07-10"
      return json(payload)
    }
    if (parsedUrl.pathname === "/sell/fulfillment/v1/order") {
      if (options.ordersRowsExceedTotal || options.ordersFulfilledObserved) {
        return json({
          total: 0,
          orders: [{
            orderId: "observed-order-test-only",
            creationDate: "2026-08-08T14:00:00.000Z",
            lastModifiedDate: "2026-08-08T15:00:00.000Z",
            orderPaymentStatus: "PAID",
            orderFulfillmentStatus: options.ordersFulfilledObserved
              ? "FULFILLED"
              : "NOT_STARTED",
            pricingSummary: { total: { value: "19.95", currency: "USD" } },
            lineItems: [{
              lineItemId: "observed-line-test-only",
              legacyItemId: "123456789012",
              listingMarketplaceId: "EBAY_US",
              sku: "LIVE-SKU",
              quantity: 1,
              lineItemCost: { value: "19.95", currency: "USD" },
            }],
          }],
        })
      }
      if (options.ordersOutOfWindow) {
        return json({
          total: 1,
          orders: [{
            orderId: "old-order-test-only",
            creationDate: "2025-01-01T10:00:00.000Z",
            lastModifiedDate: "2025-01-01T11:00:00.000Z",
            orderPaymentStatus: "PAID",
            orderFulfillmentStatus: "NOT_STARTED",
            pricingSummary: { total: { value: "19.95", currency: "USD" } },
            lineItems: [{
              lineItemId: "old-line-test-only",
              legacyItemId: "123456789012",
              listingMarketplaceId: "EBAY_US",
              sku: "LIVE-SKU",
              quantity: 1,
              lineItemCost: { value: "19.95", currency: "USD" },
            }],
          }],
        })
      }
      if (options.ordersSecondPageFails) {
        const offset = Number(parsedUrl.searchParams.get("offset") ?? 0)
        if (offset > 0) return json({ error: "unavailable" }, 503)
        const continuation = new URL(parsedUrl)
        continuation.searchParams.set("offset", "100")
        return json({
          total: 2,
          next: continuation.toString(),
          orders: [{
            orderId: "order-test-only",
            creationDate: "2026-08-08T14:00:00.000Z",
            lastModifiedDate: "2026-08-08T15:00:00.000Z",
            orderPaymentStatus: "PAID",
            orderFulfillmentStatus: "NOT_STARTED",
            pricingSummary: { total: { value: "19.95", currency: "USD" } },
            lineItems: [{
              lineItemId: "line-test-only",
              legacyItemId: "123456789012",
              listingMarketplaceId: "EBAY_US",
              sku: "LIVE-SKU",
              quantity: 1,
              lineItemCost: { value: "19.95", currency: "USD" },
            }],
          }],
        })
      }
      if (options.ordersBroadContinuation) {
        return json({
          total: 1,
          next: "https://api.ebay.com/sell/fulfillment/v1/order?offset=100&limit=100",
          orders: [],
        })
      }
      return json({ total: 0, orders: [] })
    }
    throw new Error("UNEXPECTED_TEST_ENDPOINT")
  }
  return { calls, fetchImpl, fulfillmentRefreshTokens }
}

function run(fake, extra = {}) {
  return getEbayCommercialMonitorLiveReadonly({
    accountKey: ACCOUNT_KEY,
    accountAlias: ACCOUNT_ALIAS,
    environment: environment(),
    fetchImpl: fake.fetchImpl,
    clock: () => new Date(NOW),
    ...extra,
  })
}

function fakeSupabase(rows = {}, errors = {}) {
  return {
    from(table) {
      const query = {
        select() { return query },
        eq() { return query },
        in() { return query },
        order() { return query },
        limit() { return query },
        then(resolve) {
          return Promise.resolve(resolve({
            data: rows[table] ?? [],
            error: errors[table] ?? null,
          }))
        },
      }
      return query
    },
  }
}

test("configuración ausente falla antes de cualquier llamada", async () => {
  let calls = 0
  const result = await getEbayCommercialMonitorLiveReadonly({
    accountKey: null,
    accountAlias: null,
    environment: {},
    fetchImpl: async () => {
      calls += 1
      throw new Error("FETCH_MUST_NOT_RUN")
    },
    clock: () => new Date(NOW),
  })
  assert.equal(calls, 0)
  assert.equal(result.account.status, "BLOCKED")
  assert.equal(result.discovery.coverage, "UNPROVEN")
  assert.equal(result.oauth.tokenReceived, false)
})

test("el coordinador acepta el formato legado alias:huella sin confiar en la huella embebida", async () => {
  const fake = fakeEbay()
  const legacyEnvironment = {
    ...environment(),
    EBAY_SELLER_ACCOUNT_KEY:
      `${ACCOUNT_ALIAS}:UNTRUSTED-LEGACY-SUFFIX`,
  }
  const result = await run(fake, { environment: legacyEnvironment })

  assert.equal(result.account.status, "CERTIFIED")
  assert.equal(result.account.accountAlias, ACCOUNT_ALIAS)
  assert.equal(result.account.bindingMatched, true)
  assert.equal(result.oauth.tokenReceived, true)
  assert.ok(fake.calls.some((call) => call.tradingCall === "GetUser"))
})

test("coordinador produce ledger sólo-read, scopes y DTO sanitizado", async () => {
  const fake = fakeEbay()
  const result = await run(fake)
  assert.equal(result.account.status, "CERTIFIED")
  assert.equal(result.account.bindingMatched, true)
  assert.equal(result.discovery.listings.length, 1)
  assert.equal(result.analytics.status, "CERTIFIED")
  assert.equal(result.orders.status, "CERTIFIED")
  assert.deepEqual(fake.fulfillmentRefreshTokens, [
    "orders-refresh-test-only",
  ])
  assert.equal(result.oauth.scopes.every((scope) =>
    scope.classifications.includes("READ_REQUIRED")), true)
  assert.equal(result.oauth.scopes.every((scope) =>
    scope.classifications.includes("READ_AVAILABLE")), true)
  assert.equal(result.calls.every((call) =>
    call.marketplaceMutation === false && call.persisted === false), true)
  assert.deepEqual(result.safety, {
    marketplaceWrites: 0,
    databaseWrites: 0,
    inventoryWrites: 0,
    listingRevisions: 0,
    listingEnds: 0,
    fulfillmentWrites: 0,
    buyerMessages: 0,
    whatsappCalls: 0,
    tokensReturned: false,
    rawPayloadsReturned: false,
    buyerPiiReturned: false,
  })
  const serialized = JSON.stringify(result)
  for (const forbidden of [
    "ephemeral-access-token-test-only",
    "seller-refresh-test-only",
    "orders-refresh-test-only",
    "private@example.invalid",
    "authorization",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})

test("binding incorrecto detiene discovery y downstream", async () => {
  const fake = fakeEbay({ accountMismatch: true })
  const result = await run(fake)
  assert.equal(result.account.status, "BLOCKED")
  assert.equal(result.discovery.listings.length, 0)
  assert.deepEqual(fake.calls.map((call) => call.tradingCall), [
    null,
    "GetUser",
  ])
})

test("fallo en página posterior conserva evidencia como PARTIAL", async () => {
  const fake = fakeEbay({ discoverySecondPageFails: true })
  const result = await run(fake)
  assert.equal(result.account.status, "CERTIFIED")
  assert.equal(result.discovery.status, "PARTIAL")
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.equal(result.discovery.listings.length, 1)
  assert.equal(result.discovery.pagesRead, 1)
  assert.ok(result.discovery.gapCodes.some((code) =>
    code.includes("DISCOVERY") || code.includes("503")))
})

test("metadata de paginación contradictoria nunca certifica discovery", async () => {
  const fake = fakeEbay({ paginationMetadataConflict: true })
  const result = await run(fake)
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_PAGINATION_METADATA_CONFLICT",
  ))
})

test("variaciones sin identidad no se deduplican como cobertura completa", async () => {
  const fake = fakeEbay({ ambiguousVariations: true })
  const result = await run(fake)
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.equal(result.discovery.listings.length, 1)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS",
  ))
})

test("Item repetido sin variationKey queda explícitamente ambiguo", async () => {
  const result = await run(fakeEbay({
    repeatedItemWithoutVariationIdentity: true,
  }))
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.equal(result.discovery.listings.length, 2)
  assert.equal(result.discovery.listings.every((listing) =>
    listing.identityAmbiguous === true), true)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS",
  ))
})

test("listing no-US nunca se proyecta bajo contexto EBAY_US", async () => {
  const fake = fakeEbay({ nonUsListing: true })
  const result = await run(fake)
  assert.equal(result.account.status, "CERTIFIED")
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.equal(result.discovery.listings.length, 0)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_LISTING_MARKETPLACE_UNPROVEN_OR_NON_US",
  ))
})

test("continuación Inventory contradictoria conserva evidencia PARTIAL", async () => {
  const fake = fakeEbay({ inventoryNextConflict: true })
  const result = await run(fake)
  assert.equal(result.discovery.inventory.status, "PARTIAL")
  assert.ok(result.discovery.inventory.gapCodes.includes(
    "INVENTORY_PAGINATION_METADATA_CONFLICT",
  ))
})

test("fallo Inventory posterior conserva listings publicados previos", async () => {
  const fake = fakeEbay({ inventorySecondPageFails: true })
  const result = await run(fake)
  assert.equal(result.discovery.inventory.status, "PARTIAL")
  assert.deepEqual(result.discovery.inventory.publishedListingIds, [
    "123456789012",
  ])
  assert.ok(result.discovery.inventory.gapCodes.some((code) =>
    code.includes("503") || code.includes("PAGE_READ_FAILED")))
})

test("drift de total Inventory conserva PARTIAL y gap explícito", async () => {
  const fake = fakeEbay({ inventoryTotalDrift: true })
  const result = await run(fake)
  assert.equal(result.discovery.inventory.status, "PARTIAL")
  assert.ok(result.discovery.inventory.gapCodes.includes(
    "INVENTORY_TOTAL_CHANGED_DURING_READ",
  ))
})

test("Analytics rechaza columnas faltantes y grano LISTING duplicado", async () => {
  for (const options of [
    { analyticsMissingMetrics: true },
    { analyticsDuplicateMetricDefinitions: true },
    { analyticsExtraCells: true },
    { analyticsMissingCells: true },
    { analyticsMissingApplicable: true },
    { analyticsInvalidApplicableValue: true },
    { analyticsBooleanMetric: true },
    { analyticsInvalidDates: true },
    { analyticsDuplicateListing: true },
    { analyticsExtraDimension: true },
    { analyticsVariationDimension: true },
  ]) {
    const fake = fakeEbay(options)
    const result = await run(fake)
    assert.equal(result.analytics.status, "UNAVAILABLE")
    assert.equal(result.calls.find((call) =>
      call.operation === "ANALYTICS_GET_TRAFFIC_REPORT")?.status, "FAILED")
  }
})

test("Analytics preserva la ventana real y degrada una respuesta truncada", async () => {
  const result = await run(fakeEbay({ analyticsNarrowWindow: true }))
  assert.equal(result.analytics.status, "PARTIAL")
  assert.equal(result.analytics.windowStart, "2026-07-10T00:00:00.000Z")
  assert.equal(result.analytics.observations[0].windowStart,
    "2026-07-10T00:00:00.000Z")
  assert.ok(result.analytics.gapCodes.includes(
    "ANALYTICS_RESPONSE_WINDOW_DIFFERS_FROM_REQUEST",
  ))
})

test("freshness Analytics usa actualización de fuente, no hora de fetch", async () => {
  const fake = fakeEbay({ analyticsLastUpdated: "2026-07-20" })
  const live = await run(fake)
  assert.equal(live.analytics.status, "PARTIAL")
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings[0].metrics.impressions.freshness.status, "STALE")
  assert.equal(
    monitor.listings[0].metrics.impressions.capturedAt,
    "2026-07-20T00:00:00.000Z",
  )
})

test("checkpoint CTR usa sólo porcentaje calculado compatible", async () => {
  const highCalculated = await run(fakeEbay({
    analyticsReportedLowCalculatedHigh: true,
  }))
  const highMonitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    highCalculated,
    NOW,
  )
  assert.equal(highMonitor.listings[0].metrics.ctr_reported.unit,
    "EBAY_API_RATE_RAW")
  assert.equal(highMonitor.listings[0].metrics.ctr_calculated.unit, "PERCENT")
  assert.equal(highMonitor.alertCandidates.some((candidate) =>
    candidate.reasonCode === "HIGH_IMPRESSIONS_LOW_CTR_CHECKPOINT"), false)

  const lowCalculated = await run(fakeEbay({
    analyticsReportedHighCalculatedLow: true,
  }))
  const lowMonitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    lowCalculated,
    NOW,
  )
  assert.equal(lowMonitor.alertCandidates.some((candidate) =>
    candidate.reasonCode === "HIGH_IMPRESSIONS_LOW_CTR_CHECKPOINT"), true)
})

test("scope omitido explícitamente se clasifica MISSING y no se usa", async () => {
  const missing =
    "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly"
  const fake = fakeEbay({ missingScope: missing })
  const result = await run(fake)
  const scope = result.oauth.scopes.find((entry) => entry.scope === missing)
  assert.ok(scope?.classifications.includes("READ_REQUIRED"))
  assert.ok(scope?.classifications.includes("MISSING"))
  assert.equal(scope?.classifications.includes("READ_AVAILABLE"), false)
  assert.equal(result.analytics.status, "UNAVAILABLE")
  assert.equal(result.oauth.status, "PARTIAL")
})

test("un scope de otro grant no certifica Fulfillment dedicado", async () => {
  const result = await run(fakeEbay({ crossTokenFulfillmentMismatch: true }))
  const scope = result.oauth.scopes.find((entry) =>
    entry.scope.endsWith("sell.fulfillment.readonly"))
  assert.equal(result.orders.status, "UNAVAILABLE")
  assert.equal(result.oauth.status, "PARTIAL")
  assert.ok(scope?.classifications.includes("MISSING"))
  assert.equal(scope?.classifications.includes("READ_AVAILABLE"), false)
})

test("totales REST contradictorios nunca prueban cero ni completitud", async () => {
  const inventory = await run(fakeEbay({ inventoryRowsExceedTotal: true }))
  assert.equal(inventory.discovery.inventory.status, "PARTIAL")
  assert.ok(inventory.discovery.inventory.gapCodes.includes(
    "INVENTORY_TOTAL_COUNT_MISMATCH",
  ))
  const booleanTotal = await run(fakeEbay({ inventoryBooleanTotal: true }))
  assert.equal(booleanTotal.discovery.inventory.status, "PARTIAL")
  assert.ok(booleanTotal.discovery.inventory.gapCodes.includes(
    "INVENTORY_TOTAL_UNPROVEN",
  ))
  const offers = await run(fakeEbay({ offerRowsExceedTotal: true }))
  assert.equal(offers.discovery.inventory.status, "PARTIAL")
  assert.ok(offers.discovery.inventory.gapCodes.includes(
    "INVENTORY_OFFER_TOTAL_COUNT_MISMATCH",
  ))
  const offerSku = await run(fakeEbay({ offerSkuMismatch: true }))
  assert.equal(offerSku.discovery.inventory.status, "PARTIAL")
  assert.ok(offerSku.discovery.inventory.gapCodes.includes(
    "INVENTORY_PUBLISHED_OFFER_IDENTITY_UNPROVEN",
  ))
  const orders = await run(fakeEbay({ ordersRowsExceedTotal: true }))
  assert.equal(orders.orders.status, "PARTIAL")
  assert.ok(orders.orders.gapCodes.includes(
    "FULFILLMENT_PAGINATION_UNPROVEN",
  ))
})

test("JSON 2xx inválido marca FAILED en el ledger sanitizado", async () => {
  for (const path of [
    "/identity/v1/oauth2/token",
    "/sell/inventory/v1/inventory_item",
    "/sell/analytics/v1/traffic_report",
    "/sell/fulfillment/v1/order",
  ]) {
    const fake = fakeEbay({ malformedJsonPath: path })
    const result = await run(fake)
    const matching = result.calls.filter((call) => call.endpoint === path)
    assert.ok(matching.length > 0)
    assert.ok(matching.some((call) => call.status === "FAILED"))
  }
})

test("ledger atribuye fallo al response exacto bajo calls concurrentes", async () => {
  const fake = fakeEbay({ concurrentOfferParseFailure: true })
  const result = await run(fake)
  const offers = result.calls.filter((call) =>
    call.operation === "INVENTORY_GET_OFFERS")
  assert.equal(offers.length, 2)
  assert.equal(offers.filter((call) => call.status === "FAILED").length, 1)
  assert.equal(offers.filter((call) => call.status === "SUCCEEDED").length, 1)
  assert.equal(result.discovery.inventory.status, "PARTIAL")
})

test("fallo Fulfillment posterior conserva órdenes sanitizadas PARTIAL", async () => {
  const fake = fakeEbay({ ordersSecondPageFails: true })
  const result = await run(fake)
  assert.equal(result.orders.status, "PARTIAL")
  assert.equal(result.orders.orders.length, 1)
  assert.equal(result.orders.pagesRead, 1)
  assert.ok(result.orders.gapCodes.some((code) =>
    code.includes("503") || code.includes("PAGE_FAILED")))
})

test("continuación Fulfillment no puede ampliar la ventana autorizada", async () => {
  const fake = fakeEbay({ ordersBroadContinuation: true })
  const result = await run(fake)
  assert.equal(result.orders.status, "PARTIAL")
  assert.ok(result.orders.gapCodes.includes(
    "EBAY_MONITOR_ORDERS_PAGINATION_BLOCKED",
  ))
  assert.equal(result.calls.filter((call) =>
    call.operation === "FULFILLMENT_GET_ORDERS").length, 1)
})

test("Fulfillment excluye filas fuera de la ventana declarada", async () => {
  const fake = fakeEbay({ ordersOutOfWindow: true })
  const result = await run(fake)
  assert.equal(result.orders.status, "PARTIAL")
  assert.equal(result.orders.orders.length, 0)
  assert.ok(result.orders.gapCodes.includes(
    "FULFILLMENT_ORDER_OUTSIDE_REQUESTED_WINDOW",
  ))
})

test("OAuth 200 inválido no declara token recibido", async () => {
  const fake = fakeEbay({ invalidFirstOauth: true })
  const result = await run(fake)
  assert.equal(result.oauth.tokenReceived, false)
  assert.equal(result.oauth.status, "ERROR")
  assert.equal(result.calls.length, 1)
  assert.equal(result.calls[0].status, "FAILED")
})

test("presupuesto total corta readers downstream sin perder discovery", async () => {
  const fake = fakeEbay()
  const result = await run(fake, {
    readLimits: { maximumCalls: 3, budgetMs: 10_000 },
  })
  assert.equal(result.calls.length, 3)
  assert.equal(result.discovery.listings.length, 1)
  assert.equal(result.analytics.status, "UNAVAILABLE")
  assert.equal(result.orders.status, "UNAVAILABLE")
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("DTO final conserva live, error SELECT y excluye PII/secretos", async () => {
  const fake = fakeEbay()
  const live = await run(fake)
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({}, {
      ebay_active_listings: { code: "TEST_READ_ERROR" },
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings.length, 1)
  assert.equal(monitor.listings[0].identity.itemId, "123456789012")
  assert.equal(monitor.listings[0].metrics.impressions.value, 10)
  assert.equal(monitor.listings[0].metrics.impressions.grain, "ITEM")
  assert.equal(monitor.listings[0].productCase.status, "UNPROVEN")
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_ACTIVE_LISTING_REGISTRY")?.status, "ERROR")
  const serialized = JSON.stringify(monitor)
  for (const forbidden of [
    "private@example.invalid",
    "ephemeral-access-token-test-only",
    "seller-refresh-test-only",
    "orders-refresh-test-only",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})

test("reconciliación registry exige identidad Item/SKU/variación exacta", async () => {
  const fake = fakeEbay()
  const live = await run(fake)
  const at = "2026-08-08T15:00:00.000Z"
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [{
        id: "registry-mismatch",
        account_key: ACCOUNT_KEY,
        source: "EBAY_INVENTORY_API",
        ebay_item_id: "123456789012",
        ebay_sku: "WRONG-SKU",
        ebay_variation_key: null,
        listing_status: "active",
        title: "Stored mismatch",
        ebay_quantity: null,
        ebay_price: null,
        currency: null,
        market_radar_product_id: null,
        supplier_variant_id: null,
        supplier_sku: null,
        supplier_cost_at_linking: null,
        last_ebay_sync_at: at,
        raw_payload: {},
        sync_generation: null,
        created_at: at,
        updated_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.ok(monitor.discoveryCoverage.knownGapCodes.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ))
  assert.ok(monitor.discoveryCoverage.knownGapCodes.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ))
})

test("órdenes Item no se duplican sobre variaciones sin SKU", async () => {
  const fake = fakeEbay()
  const baseline = await run(fake)
  const observedAt = "2026-08-08T15:00:00.000Z"
  const live = structuredClone(baseline)
  live.discovery.listings = ["Blue", "Red"].map((color) => ({
    ...baseline.discovery.listings[0],
    sku: null,
    customLabel: null,
    variationKey: `Color=${color}`,
  }))
  live.orders = {
    status: "CERTIFIED",
    observedAt,
    windowStart: "2026-07-09T16:00:00.000Z",
    windowEnd: "2026-08-08T16:00:00.000Z",
    pagesRead: 1,
    rawOrdersDiscardedAfterSanitization: 0,
    observedOrderEvidenceKeys: [],
    gapCodes: ["ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY"],
    orders: [{
      ebayOrderId: "order-sensitive-id",
      creationDate: observedAt,
      lastModifiedDate: observedAt,
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      totalAmount: 25,
      currency: "USD",
      marketplaceId: "EBAY_US",
      lineItems: [{
        ebayOrderId: "order-sensitive-id",
        lineItemId: "line-sensitive-id",
        listingId: "123456789012",
        sku: null,
        quantity: 1,
        lineItemAmount: 25,
        currency: "USD",
        shipByDate: null,
      }],
    }],
  }
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings.length, 2)
  for (const listing of monitor.listings) {
    assert.equal(listing.metrics.orders.value, null)
    assert.equal(
      listing.metrics.orders.limitationCode,
      "ORDER_ITEM_GRAIN_AMBIGUOUS_ACROSS_VARIATIONS",
    )
    assert.ok(listing.dataQualityIssues.some((issue) =>
      issue.code === "METRIC_GRAIN_MISMATCH"))
  }
  assert.doesNotMatch(JSON.stringify(monitor), /order-sensitive-id/)
})

test("órdenes Item no se duplican sobre variaciones con SKU repetido", async () => {
  const fake = fakeEbay()
  const live = structuredClone(await run(fake))
  const observedAt = "2026-08-08T15:00:00.000Z"
  live.discovery.listings = ["Blue", "Red"].map((color) => ({
    ...live.discovery.listings[0],
    sku: "SHARED-SKU",
    customLabel: "SHARED-SKU",
    variationKey: `Color=${color}`,
  }))
  live.orders = {
    status: "CERTIFIED",
    observedAt,
    windowStart: "2026-07-09T16:00:00.000Z",
    windowEnd: "2026-08-08T16:00:00.000Z",
    pagesRead: 1,
    rawOrdersDiscardedAfterSanitization: 0,
    observedOrderEvidenceKeys: [],
    gapCodes: ["ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY"],
    orders: [{
      ebayOrderId: "shared-order-sensitive-id",
      creationDate: observedAt,
      lastModifiedDate: observedAt,
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      totalAmount: 25,
      currency: "USD",
      marketplaceId: "EBAY_US",
      lineItems: [{
        ebayOrderId: "shared-order-sensitive-id",
        lineItemId: "shared-line-sensitive-id",
        listingId: "123456789012",
        sku: "SHARED-SKU",
        quantity: 1,
        lineItemAmount: 25,
        currency: "USD",
        shipByDate: null,
      }],
    }],
  }
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings.length, 2)
  for (const listing of monitor.listings) {
    assert.equal(listing.metrics.orders.value, null)
    assert.equal(
      listing.metrics.orders.limitationCode,
      "ORDER_ITEM_GRAIN_AMBIGUOUS_ACROSS_VARIATIONS",
    )
  }
  assert.doesNotMatch(JSON.stringify(monitor), /shared-order-sensitive-id/)
})

test("link supplier almacenado no cruza variaciones con SKU compartido", async () => {
  const fake = fakeEbay()
  const live = structuredClone(await run(fake))
  live.discovery.listings = ["Blue", "Red"].map((color) => ({
    ...live.discovery.listings[0],
    sku: "SHARED-SKU",
    customLabel: "SHARED-SKU",
    variationKey: `Color=${color}`,
  }))
  const at = "2026-08-08T15:00:00.000Z"
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [{
        id: "stored-blue-link",
        account_key: ACCOUNT_KEY,
        source: "EBAY_INVENTORY_API",
        ebay_item_id: "123456789012",
        ebay_sku: "SHARED-SKU",
        ebay_variation_key: "Color=Blue",
        listing_status: "active",
        title: "Stored blue",
        ebay_quantity: null,
        ebay_price: null,
        currency: null,
        market_radar_product_id: "product-blue",
        supplier_variant_id: "variant-blue",
        supplier_sku: "supplier-blue",
        supplier_cost_at_linking: null,
        last_ebay_sync_at: at,
        raw_payload: { variationKey: "Color=Blue" },
        sync_generation: null,
        created_at: at,
        updated_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  const blue = monitor.listings.find((listing) =>
    listing.identity.variationKey === "Color=Blue")
  const red = monitor.listings.find((listing) =>
    listing.identity.variationKey === "Color=Red")
  assert.ok(blue)
  assert.ok(red)
  assert.equal(blue.dataQualityIssues.some((issue) =>
    issue.code === "SUPPLIER_IDENTITY_CONFLICT"), false)
  assert.equal(red.dataQualityIssues.some((issue) =>
    issue.code === "SUPPLIER_IDENTITY_CONFLICT"), true)
  assert.equal(red.stock.currentSupplierCost.value, null)
})

test("identidad de variación ambigua suprime linkage y Product Truth", async () => {
  const live = structuredClone(await run(fakeEbay({ ambiguousVariations: true })))
  const at = "2026-08-08T15:00:00.000Z"
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [{
        id: "stored-ambiguous-link",
        account_key: ACCOUNT_KEY,
        source: "EBAY_INVENTORY_API",
        ebay_item_id: "123456789012",
        ebay_sku: null,
        ebay_variation_key: null,
        listing_status: "active",
        title: "Stored ambiguous",
        ebay_quantity: null,
        ebay_price: null,
        currency: null,
        market_radar_product_id: "must-not-cross",
        supplier_variant_id: "must-not-cross",
        supplier_sku: "must-not-cross",
        supplier_cost_at_linking: null,
        last_ebay_sync_at: at,
        raw_payload: {},
        sync_generation: null,
        created_at: at,
        updated_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings[0].stock.supplierProductId, null)
  assert.equal(monitor.listings[0].stock.supplierVariantId, null)
  assert.equal(monitor.listings[0].stock.currentSupplierCost.value, null)
  assert.ok(monitor.listings[0].dataQualityIssues.some((entry) =>
    entry.code === "SUPPLIER_IDENTITY_CONFLICT"))
})

test("orden live ya no operativa suprime snapshot abierto almacenado", async () => {
  const live = await run(fakeEbay({ ordersFulfilledObserved: true }))
  const at = "2026-08-08T15:00:00.000Z"
  assert.ok(live.orders.observedOrderEvidenceKeys.includes(
    hashEbayMonitorEvidenceIdentifier("observed-order-test-only"),
  ))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      marketplace_order_snapshots: [{
        marketplace_order_id: "observed-order-test-only",
        order_created_at: at,
        order_modified_at: at,
        payment_status: "PAID",
        fulfillment_status: "NOT_STARTED",
        total_amount: 19.95,
        currency: "USD",
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        observed_at: at,
      }],
      marketplace_order_line_items: [{
        marketplace_order_id: "observed-order-test-only",
        marketplace_line_item_id: "stored-line",
        listing_id: "123456789012",
        sku: "LIVE-SKU",
        pack_quantity: null,
        quantity: 1,
        line_item_amount: 19.95,
        currency: "USD",
        ship_by_at: null,
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        first_observed_at: at,
        last_observed_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings[0].metrics.orders.value, null)
  assert.equal(monitor.alertCandidates.some((entry) =>
    entry.reasonCode === "PAID_ORDER_STOCK_RISK"), false)
})

test("snapshot Analytics live prevalece sobre snapshot SKU almacenado", async () => {
  const live = await run(fakeEbay())
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      listing_commercial_snapshots: [{
        id: "stored-sku-snapshot",
        listing_id: "123456789012",
        sku: "LIVE-SKU",
        listing_status: "active",
        impressions: 999,
        views: 999,
        ctr: 99,
        transactions: 99,
        sales_conversion_rate: 99,
        revenue: null,
        current_watchers: null,
        stock_available: null,
        supplier_cost: null,
        estimated_margin_percent: null,
        observed_at: "2026-07-01T00:00:00.000Z",
        window_start: "2026-06-01T00:00:00.000Z",
        window_end: "2026-06-30T23:59:59.999Z",
        source: { analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" },
        completeness_status: "complete",
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.listings[0].metrics.impressions.value, 10)
  assert.equal(monitor.listings[0].metrics.ebay_views.value, 1)
})

test("alerta Analytics Item no se duplica como evidencia de variación", async () => {
  const live = structuredClone(await run(fakeEbay({
    analyticsReportedHighCalculatedLow: true,
  })))
  live.discovery.listings = ["Blue", "Red"].map((color) => ({
    ...live.discovery.listings[0],
    sku: `SKU-${color}`,
    customLabel: `SKU-${color}`,
    variationKey: `Color=${color}`,
    identityAmbiguous: false,
  }))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  const alerts = monitor.alertCandidates.filter((entry) =>
    entry.reasonCode === "HIGH_IMPRESSIONS_LOW_CTR_CHECKPOINT")
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].listingReference.variationKey, null)
  assert.equal(alerts[0].listingReference.sku, null)
})
