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
  diagnoseInstalledEbayInventoryConsumer,
  diagnoseRegistryCoverageRuntime,
  getEbayCommercialMonitorLiveReadonly,
  hashEbayMonitorEvidenceIdentifier,
  previewEbayRegistryRepairRuntime,
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

async function withEnvironment(values, work) {
  const previous = new Map(Object.keys(values).map((key) =>
    [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value
    return await work()
  } finally {
    for (const [key, value] of previous) {
      if (typeof value === "undefined") delete process.env[key]
      else process.env[key] = value
    }
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

function xmlWithRejectedText(value) {
  const response = xml(value)
  Object.defineProperty(response, "text", {
    value: async () => {
      throw new TypeError("private-text-stream-error-test-only")
    },
  })
  return response
}

function sellerPage({
  page = 1,
  totalPages = 1,
  hasMore = null,
  site = "US",
  totalEntries = 1,
} = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack><ActiveList><PaginationResult>
        <TotalNumberOfPages>${totalPages}</TotalNumberOfPages>
        <TotalNumberOfEntries>${totalEntries}</TotalNumberOfEntries>
      </PaginationResult><HasMoreItems>${hasMore ?? page < totalPages}</HasMoreItems>
      <ItemArray><Item><ItemID>123456789012</ItemID>
        <Title>Live listing sanitized</Title><SKU>LIVE-SKU</SKU>${site ? `<Site>${site}</Site>` : ""}
        <ListingType>FixedPriceItem</ListingType><Quantity>4</Quantity>
        <SellingStatus><QuantitySold>1</QuantitySold>
          <CurrentPrice currencyID="USD">19.95</CurrentPrice></SellingStatus>
      </Item></ItemArray></ActiveList>
    </GetMyeBaySellingResponse>`
}

function sellerItemsWithoutSite(itemCount) {
  const items = Array.from({ length: itemCount }, (_, index) => `
    <Item><ItemID>${String(123456789012 + index)}</ItemID>
      <Title>Live listing ${index + 1}</Title><SKU>LIVE-SKU-${index + 1}</SKU>
      <ListingType>FixedPriceItem</ListingType><Quantity>1</Quantity>
      <SellingStatus><QuantitySold>0</QuantitySold>
        <CurrentPrice currencyID="USD">19.95</CurrentPrice></SellingStatus>
    </Item>`).join("")
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>${itemCount}</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray>${items}</ItemArray>
  </ActiveList></GetMyeBaySellingResponse>`
}

function getItemMarketplaceResponse(itemId, options = {}) {
  if (options.ackFailure) {
    return `<GetItemResponse><Ack>Failure</Ack><Errors>
      <ErrorCode>safe-test-only</ErrorCode></Errors></GetItemResponse>`
  }
  const returnedItemId = options.itemIdMismatch
    ? "999999999999"
    : itemId
  return `<GetItemResponse><Ack>Success</Ack><Item>
    <ItemID>${returnedItemId}</ItemID>
    ${options.missingSite ? "" : `<Site>${options.site ?? "US"}</Site>`}
  </Item></GetItemResponse>`
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

function sellerItemWithConflictingSitesPage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray><Item>
      <ItemID>123456789012</ItemID><SKU>LIVE-SKU</SKU>
      <Site>US</Site><Site>Germany</Site>
    </Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`
}

function sellerItemWithCrossRowMarketplaceConflictPage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray>
      <Item><ItemID>123456789012</ItemID><Site>US</Site><Variations>
        <Variation><SKU>BLUE-SKU</SKU><VariationSpecifics><NameValueList>
          <Name>Color</Name><Value>Blue</Value>
        </NameValueList></VariationSpecifics></Variation>
      </Variations></Item>
      <Item><ItemID>123456789012</ItemID><Site>Germany</Site><Variations>
        <Variation><SKU>RED-SKU</SKU><VariationSpecifics><NameValueList>
          <Name>Color</Name><Value>Red</Value>
        </NameValueList></VariationSpecifics></Variation>
      </Variations></Item>
    </ItemArray></ActiveList></GetMyeBaySellingResponse>`
}

function sellerInvalidIdentityWithZeroTotalPage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>0</TotalNumberOfPages>
      <TotalNumberOfEntries>0</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray><Item>
      <ItemID>invalid</ItemID><Site>US</Site>
    </Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`
}

function variationsWithoutSitePage() {
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
      <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
    <HasMoreItems>false</HasMoreItems><ItemArray><Item>
      <ItemID>123456789012</ItemID><Title>Certified once per Item</Title>
      <Variations>
        <Variation><SKU>BLUE-SKU</SKU><VariationSpecifics><NameValueList>
          <Name>Color</Name><Value>Blue</Value>
        </NameValueList></VariationSpecifics></Variation>
        <Variation><SKU>RED-SKU</SKU><VariationSpecifics><NameValueList>
          <Name>Color</Name><Value>Red</Value>
        </NameValueList></VariationSpecifics></Variation>
      </Variations>
    </Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`
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
  const telemetry = {
    getItemInFlight: 0,
    getItemMaxConcurrency: 0,
  }
  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url)
    const headers = new Headers(init.headers)
    const body = init.body instanceof URLSearchParams
      ? init.body.toString()
      : String(init.body ?? "")
    calls.push({
      method: init.method,
      path: parsedUrl.pathname,
      search: parsedUrl.search,
      tradingCall: headers.get("X-EBAY-API-CALL-NAME"),
      itemId: body.match(/<ItemID>(\d{9,20})<\/ItemID>/)?.[1] ?? null,
      marketplaceHeader: headers.get("X-EBAY-C-MARKETPLACE-ID"),
      authorizationKind: headers.get("Authorization")?.startsWith("Bearer ")
        ? "BEARER"
        : headers.get("Authorization")?.startsWith("Basic ")
          ? "BASIC"
          : "NONE",
      oauthScope: parsedUrl.pathname === "/identity/v1/oauth2/token"
        ? new URLSearchParams(body).get("scope")
        : null,
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
      if (scope.includes("sell.inventory.readonly") &&
          options.inventoryOauthError) {
        if (options.inventoryOauthMalformedBody) {
          return new Response("not-json-private-oauth-test-only", {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        }
        return json({
          error: options.inventoryOauthError,
          error_description: "private-oauth-description-test-only",
        }, 400)
      }
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
      const fourScopeControl = scope.includes("sell.account.readonly") &&
        scope.includes("sell.inventory.readonly") &&
        scope.includes("sell.analytics.readonly")
      const extraReturnedScope = fourScopeControl
        ? options.fourScopeExtraReturnedScope
        : options.subsetExtraReturnedScope
      const finalReturnedScope = extraReturnedScope
        ? `${isolatedReturnedScope} ${extraReturnedScope}`.trim()
        : isolatedReturnedScope
      const scopeMetadataOmitted = fourScopeControl
        ? options.fourScopeMetadataOmitted
        : options.subsetScopeMetadataOmitted
      const scopeMetadataValueKey = fourScopeControl
        ? "fourScopeMetadataValue"
        : "subsetScopeMetadataValue"
      const tokenPayload = {
        access_token: fourScopeControl
          ? "ephemeral-four-scope-access-token-test-only"
          : "ephemeral-access-token-test-only",
        expires_in: 7200,
      }
      if (!scopeMetadataOmitted) {
        tokenPayload.scope = Object.hasOwn(options, scopeMetadataValueKey)
          ? options[scopeMetadataValueKey]
          : finalReturnedScope
      }
      return json(tokenPayload)
    }
    if (parsedUrl.pathname === "/ws/api.dll" &&
        headers.get("X-EBAY-API-CALL-NAME") === "GetUser") {
      const responseBody = `<GetUserResponse><Ack>Success</Ack><User>
        <UserID>${options.accountMismatch ? "other-seller" : USER_ID}</UserID>
        ${options.getUserSiteOmitted
          ? ""
          : `<Site>${options.getUserSite ?? "US"}</Site>`}
        <Email>private@example.invalid</Email>
      </User></GetUserResponse>`
      return options.getUserTextFailure
        ? xmlWithRejectedText(responseBody)
        : xml(responseBody)
    }
    if (parsedUrl.pathname === "/ws/api.dll" &&
        headers.get("X-EBAY-API-CALL-NAME") === "GetItem") {
      const requestedItemId =
        body.match(/<ItemID>(\d{9,20})<\/ItemID>/)?.[1] ?? ""
      telemetry.getItemInFlight += 1
      telemetry.getItemMaxConcurrency = Math.max(
        telemetry.getItemMaxConcurrency,
        telemetry.getItemInFlight,
      )
      try {
        if (options.getItemDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.getItemDelayMs))
        }
        if (options.getItemNetworkFailure) {
          throw new TypeError("private-network-error-test-only")
        }
        if (options.getItemHttpFailure) {
          return xml("<GetItemResponse><Ack>Failure</Ack></GetItemResponse>", 503)
        }
        if (options.getItemMalformedXml) {
          return xml("<GetItemResponse><Ack>Success</Ack><Item>")
        }
        return xml(getItemMarketplaceResponse(
          requestedItemId,
          {
            site: options.getItemSite,
            missingSite: options.getItemMissingSite ||
              options.getItemMissingSiteIds?.includes(requestedItemId),
            itemIdMismatch: options.getItemMismatch,
            ackFailure: options.getItemAckFailure,
          },
        ))
      } finally {
        telemetry.getItemInFlight -= 1
      }
    }
    if (parsedUrl.pathname === "/ws/api.dll") {
      const page = Number(body.match(/<PageNumber>(\d+)<\/PageNumber>/)?.[1])
      if (options.discoverySecondPageFails && page === 2) {
        return xml("<Failure />", 503)
      }
      if (options.discoveryTextFailure) {
        return xmlWithRejectedText(sellerPage({ page }))
      }
      if (options.ambiguousVariations) return xml(ambiguousVariationPage())
      if (options.repeatedItemWithoutVariationIdentity) {
        return xml(repeatedItemWithoutVariationIdentityPage())
      }
      if (options.sellerSiteConflict) {
        return xml(sellerItemWithConflictingSitesPage())
      }
      if (options.sellerCrossRowMarketplaceConflict) {
        return xml(sellerItemWithCrossRowMarketplaceConflictPage())
      }
      if (options.invalidItemIdentityWithZeroTotal) {
        return xml(sellerInvalidIdentityWithZeroTotalPage())
      }
      if (options.variationsWithoutSite) {
        return xml(variationsWithoutSitePage())
      }
      if (options.sellerItemsWithoutSite) {
        return xml(sellerItemsWithoutSite(options.sellerItemsWithoutSite))
      }
      if (options.zeroReportedItems) {
        return xml(`<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
          <PaginationResult><TotalNumberOfPages>0</TotalNumberOfPages>
            <TotalNumberOfEntries>0</TotalNumberOfEntries></PaginationResult>
          <HasMoreItems>false</HasMoreItems><ItemArray></ItemArray>
        </ActiveList></GetMyeBaySellingResponse>`)
      }
      return xml(sellerPage({
        page,
        totalPages: options.discoverySecondPageFails ? 2 : 1,
        totalEntries: options.sellerReportedTotal ?? 1,
        hasMore: options.paginationMetadataConflict && page === 1
          ? true
          : null,
        site: options.sellerSiteOmitted
          ? null
          : options.nonUsListing ? "Germany" : "US",
      }))
    }
    if (parsedUrl.pathname === "/sell/inventory/v1/inventory_item") {
      const bearer = headers.get("Authorization") ?? ""
      const fourScopeControl = bearer ===
        "Bearer ephemeral-four-scope-access-token-test-only"
      const matrixVariant = fourScopeControl
        ? "FOUR_SCOPE_CONTROL"
        : parsedUrl.search === "?limit=50&offset=0" &&
            headers.get("X-EBAY-C-MARKETPLACE-ID") === "EBAY_US"
          ? "A"
          : parsedUrl.search === "?limit=50&offset=0" &&
              headers.get("X-EBAY-C-MARKETPLACE-ID") === null
            ? "B"
            : parsedUrl.search === "?limit=50" &&
                headers.get("X-EBAY-C-MARKETPLACE-ID") === null
              ? "C"
              : parsedUrl.search === "" &&
                  headers.get("X-EBAY-C-MARKETPLACE-ID") === null
                ? "D"
                : null
      const matrixStatus = matrixVariant
        ? options.inventoryMatrixStatuses?.[matrixVariant]
        : undefined
      if (Number.isSafeInteger(matrixStatus)) {
        if (matrixStatus >= 200 && matrixStatus < 300) {
          if (matrixStatus === 204) {
            return new Response(null, {
              status: matrixStatus,
              headers: { "Content-Type": "application/json" },
            })
          }
          return json({ total: 0, inventoryItems: [] }, matrixStatus)
        }
        return json({
          errors: [{
            errorId: 25709,
            domain: "API_INVENTORY",
            category: "REQUEST",
            message: "private-inventory-error-message-test-only",
            longMessage: "private-inventory-error-long-message-test-only",
            inputRefIds: ["private-input-ref-test-only"],
            outputRefIds: ["private-output-ref-test-only"],
            parameters: [
              { name: "marketplaceId", value: "private-marketplace-value-test-only" },
              { name: "offset", value: "private-offset-value-test-only" },
            ],
          }],
        }, matrixStatus)
      }
      if (options.inventoryTimeout) {
        throw new DOMException("private-timeout-test-only", "TimeoutError")
      }
      if (options.inventoryNetworkFailure) {
        throw new TypeError("private-inventory-network-error-test-only")
      }
      if (options.inventoryHttpStatus) {
        return json({
          errors: [{ message: "private-inventory-error-test-only" }],
        }, options.inventoryHttpStatus)
      }
      if (options.inventoryOmittedEmpty) {
        return json({
          href: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=0",
          limit: 50,
          size: 0,
          total: 0,
        })
      }
      if (options.inventoryBareTotal) return json({ total: 0 })
      if (options.inventoryMalformedEmpty) {
        return json({ total: 0, size: 1 })
      }
      if (options.inventoryNonJsonContentType) {
        return new Response(JSON.stringify({ total: 0 }), {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      }
      if (options.inventoryCompatibilitySku) {
        return json({
          total: 1,
          inventoryItems: [{ sku: "ＬＩＶＥ－ＳＫＵ" }],
        })
      }
      if (options.inventoryExtraPublishedOffer) {
        return json({
          total: 2,
          inventoryItems: [{ sku: "LIVE-SKU" }, { sku: "EXTRA-SKU" }],
        })
      }
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
              next: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=1",
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
          next: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=1",
          inventoryItems: Array.from({ length: 50 }, () => ({
            sku: "LIVE-SKU",
          })),
        })
      }
      if (options.inventoryNextConflict) {
        return json({
          total: 1,
          next: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=2",
          inventoryItems: [{ sku: "LIVE-SKU" }],
        })
      }
      return json({ total: 0, inventoryItems: [] })
    }
    if (parsedUrl.pathname === "/sell/inventory/v1/offer") {
      if (options.inventoryCompatibilitySku) {
        return json({
          total: 1,
          offers: [{
            status: "PUBLISHED",
            marketplaceId: "EBAY_US",
            sku: "ＬＩＶＥ－ＳＫＵ",
            listing: { listingId: "123456789012" },
          }],
        })
      }
      if (options.inventoryExtraPublishedOffer) {
        const sku = parsedUrl.searchParams.get("sku")
        return json({
          total: 1,
          offers: [{
            status: "PUBLISHED",
            marketplaceId: "EBAY_US",
            sku,
            listing: {
              listingId: sku === "LIVE-SKU"
                ? "123456789012"
                : "123456789099",
            },
          }],
        })
      }
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
      if (options.analyticsOpaqueWarning) {
        payload.warnings = [{
          errorId: "opaque-private-warning-marker-test-only",
        }]
      }
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
  return { calls, fetchImpl, fulfillmentRefreshTokens, telemetry }
}

function assertMarketplacePartition(certification) {
  assert.equal(
    certification.sellerWideItemsParsed,
    certification.sellerWideItemsMarketplaceCertifiedUs +
      certification.sellerWideItemsMarketplaceCertifiedNonUs +
      certification.sellerWideItemsMarketplaceUnresolved +
      certification.sellerWideItemsMarketplaceError +
      certification.sellerWideItemsMarketplaceBudgetExhausted +
      certification.sellerWideItemsMarketplaceItemIdMismatch,
    "cada Item parseado pertenece a exactamente un bucket terminal",
  )
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
      let syncKeyFilter = null
      const query = {
        select() { return query },
        eq() { return query },
        in(column, values) {
          if (column === "sync_key") syncKeyFilter = new Set(values)
          return query
        },
        order() { return query },
        limit() { return query },
        then(resolve) {
          const tableRows = rows[table] ?? []
          return Promise.resolve(resolve({
            data: syncKeyFilter
              ? tableRows.filter((row) => syncKeyFilter.has(row.sync_key))
              : tableRows,
            error: errors[table] ?? null,
          }))
        },
      }
      return query
    },
  }
}

function activeRegistryRow({
  itemId = "123456789012",
  sku = "LIVE-SKU",
  variationKey = null,
  at = "2026-08-08T15:00:00.000Z",
} = {}) {
  return {
    id: `registry-${itemId}-${sku ?? "none"}`,
    account_key: ACCOUNT_KEY,
    source: "EBAY_INVENTORY_API",
    sync_key: `registry-test:${itemId}:${sku}`,
    ebay_item_id: itemId,
    ebay_sku: sku,
    ebay_variation_key: variationKey,
    listing_status: "active",
    title: "Stored listing",
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

test("diagnóstico de cobertura Registry en runtime no ejecuta llamadas con configuración ausente", async () => {
  let fetchCalls = 0
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {},
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error("FETCH_SHOULD_NOT_RUN")
    },
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(fetchCalls, 0)
  assert.equal(result.REGISTRY_RUNTIME_CONFIG, "MISSING")
  assert.equal(result.SUPABASE_URL_PRESENT, "NO")
  assert.equal(result.SUPABASE_SERVICE_ROLE_PRESENT, "NO")
  assert.equal(result.REGISTRY_SOURCE_RUNTIME_STATUS, "CONFIGURATION_MISSING")
  assert.equal(result.LIVE_ENUMERATION_RUNTIME_STATUS, "AUTH_UNAVAILABLE")
  assert.equal(result.MANUAL_LISTING_RUNTIME_AUTODISCOVERY, "PARTIAL")
  assert.equal(result.REGISTRY_RECORD_COUNT, "UNPROVEN")
  assert.equal(result.LIVE_EBAY_LISTING_COUNT, "UNPROVEN")
})

test("preview Registry falla cerrado sin evidencia y conserva cero escrituras", async () => {
  let fetchCalls = 0
  const result = await previewEbayRegistryRepairRuntime({
    environment: {},
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error("FETCH_SHOULD_NOT_RUN")
    },
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(fetchCalls, 0)
  assert.equal(result.EVIDENCE_STATUS, "UNPROVEN")
  assert.equal(result.REPAIR_EXISTING_COUNT, "UNPROVEN")
  assert.equal(result.CREATE_NEW_COUNT, "UNPROVEN")
  assert.equal(result.MARK_STALE_COUNT, "UNPROVEN")
  assert.equal(result.HUMAN_REVIEW_COUNT, "UNPROVEN")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "UNPROVEN")
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.UNPROVEN_COMPONENT, "EVIDENCE_UNAVAILABLE")
  assert.equal(result.UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_TOTAL_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_STATE_GUARD_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_SOURCE_READ_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_OTHER_COUNT, "UNPROVEN")
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "SOURCE_READ")
  assert.equal(result.RAW_UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_REASON_SOURCE_EVIDENCE, "UNPROVEN")
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "SOURCE_EVIDENCE")
  assert.equal(result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT, "UNPROVEN")
  assert.equal(result.CREATE_IDENTITY_DETERMINISTIC_COUNT, "UNPROVEN")
  assert.equal(result.CREATE_MATERIALIZATION_PASS_COUNT, "UNPROVEN")
  assert.equal(result.CREATE_ABSENCE_CAS_PASS_COUNT, "UNPROVEN")
  assert.equal(result.OTHER_SUBTYPE_COUNTS.CREATE_PAYLOAD_REQUIREMENT,
    "UNPROVEN")
  assert.equal(result.ABSENCE_PROOF_UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE, "UNPROVEN")
  assert.equal(result.LIFECYCLE_UNPROVEN_ACTION, "UNPROVEN")
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.FINAL_REJECTION_REASON, "UNPROVEN")
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.equal(result.REGISTRY_MUTATIONS, 0)
  assert.equal(result.EBAY_WRITES, 0)
  assert.equal(result.PRODUCT_CASE_MUTATIONS, 0)
})

test("preview Registry compara dos snapshots independientes del mismo request", async () => {
  const observedAt = "2026-08-08T16:00:00.000Z"
  const listing = (itemId, sku) => ({
    itemId,
    sku,
    customLabel: sku,
    variationKey: null,
    title: "Sensitive listing title",
    listingState: "ACTIVE",
    listingFormat: "FixedPriceItem",
    startTime: "2026-07-01T00:00:00.000Z",
    availableQuantity: 1,
    price: 10,
    currency: "USD",
    marketplaceSite: "US",
    marketplaceCertification: {
      status: "US_CERTIFIED",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      observedAt,
    },
    identityAmbiguous: false,
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt,
  })
  const snapshots = [
    {
      accountKey: ACCOUNT_KEY,
      observedAt,
      liveListings: [listing("700000000001", "PRIVATE-SKU-1")],
      registryRows: [],
      syncKeyLookupStatus: "AVAILABLE",
      existingRegistrySyncKeys: [],
    },
    {
      accountKey: ACCOUNT_KEY,
      observedAt,
      liveListings: [
        listing("700000000001", "PRIVATE-SKU-1"),
        listing("700000000002", "PRIVATE-SKU-1"),
      ],
      registryRows: [],
      syncKeyLookupStatus: "AVAILABLE",
      existingRegistrySyncKeys: [],
    },
  ]
  let snapshotReads = 0
  const result = await previewEbayRegistryRepairRuntime({
    startedAt: Date.parse(observedAt),
    readRegistryRepairEvidenceSnapshot: async () => {
      const snapshot = snapshots[snapshotReads]
      snapshotReads += 1
      return snapshot === undefined ? undefined : structuredClone(snapshot)
    },
  })
  assert.equal(snapshotReads, 2)
  assert.equal(result.CURRENT_LIVE_COUNT, 2)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 0)
  assert.equal(result.CREATE_NEW_COUNT, 2)
  assert.equal(result.DRY_RUN_REJECTION_REASON,
    "STATE_CHANGED_DURING_SAME_REQUEST")
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.UNPROVEN_COMPONENT, "SAME_REQUEST_STATE")
  assert.equal(result.UNPROVEN_COUNT, 1)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 1)
  assert.equal(result.UNPROVEN_STATE_GUARD_COUNT, 1)
  assert.equal(result.UNPROVEN_SOURCE_READ_COUNT, 0)
  assert.equal(result.UNPROVEN_OTHER_COUNT, 0)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "STATE_GUARD")
  assert.equal(result.RAW_CREATE_NEW_COUNT, 2)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT, 2)
  assert.equal(result.CREATE_IDENTITY_DETERMINISTIC_COUNT, 2)
  assert.equal(result.CREATE_MATERIALIZATION_PASS_COUNT, 2)
  assert.equal(result.CREATE_ABSENCE_CAS_PASS_COUNT, 2)
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "NONE")
  assert.equal(result.ABSENCE_PROOF_UNPROVEN_COUNT, 1)
  assert.equal(result.ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY, 1)
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE,
    "SECOND_READ_INCONSISTENCY")
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, 1)
  assert.equal(result.FINAL_REJECTION_REASON,
    "STATE_CHANGED_DURING_SAME_REQUEST")
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.doesNotMatch(JSON.stringify(result),
    /700000000001|700000000002|PRIVATE-SKU|Sensitive listing title/)
  assert.equal(result.REGISTRY_MUTATIONS, 0)
  assert.equal(result.EBAY_WRITES, 0)
  assert.equal(result.PRODUCT_CASE_MUTATIONS, 0)

  let stableSnapshotReads = 0
  const stable = await previewEbayRegistryRepairRuntime({
    startedAt: Date.parse(observedAt),
    readRegistryRepairEvidenceSnapshot: async () => {
      stableSnapshotReads += 1
      return structuredClone(snapshots[1])
    },
  })
  assert.equal(stableSnapshotReads, 2)
  assert.equal(stable.CURRENT_LIVE_COUNT, 2)
  assert.equal(stable.CREATE_NEW_COUNT, 2)
  assert.equal(stable.DRY_RUN_REJECTION_REASON, null)
  assert.equal(stable.AMBIGUITY_CLASS, "NONE")
  assert.equal(stable.UNPROVEN_COMPONENT, "NONE")
  assert.equal(stable.UNPROVEN_COUNT, 0)
  assert.equal(stable.UNPROVEN_TOTAL_COUNT, 0)
  assert.equal(stable.UNPROVEN_STATE_GUARD_COUNT, 0)
  assert.equal(stable.UNPROVEN_SOURCE_READ_COUNT, 0)
  assert.equal(stable.UNPROVEN_OTHER_COUNT, 0)
  assert.equal(stable.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "NONE")
  assert.equal(stable.RAW_CREATE_NEW_COUNT, 2)
  assert.equal(stable.RAW_UNPROVEN_COUNT, 0)
  assert.equal(stable.RAW_CREATE_IDENTITY_CANDIDATE_COUNT, 2)
  assert.equal(stable.CREATE_IDENTITY_DETERMINISTIC_COUNT, 2)
  assert.equal(stable.CREATE_MATERIALIZATION_PASS_COUNT, 2)
  assert.equal(stable.CREATE_ABSENCE_CAS_PASS_COUNT, 2)
  assert.equal(stable.ABSENCE_PROOF_UNPROVEN_COUNT, 0)
  assert.equal(stable.ABSENCE_PROOF_PRIMARY_CAUSE, "NONE")
  assert.equal(stable.LIFECYCLE_UNPROVEN_ACTION, "NONE")
  assert.equal(stable.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(stable.FINAL_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(stable.FINAL_REJECTION_REASON, null)
  assert.equal(stable.UNPROVEN_PRIMARY_REASON, "NONE")
  assert.equal(stable.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(stable.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("diagnóstico de cobertura Registry reporta error de lectura cuando readRegistry falla", async () => {
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {
      ...environment(),
      EBAY_CLIENT_ID: "",
      EBAY_CLIENT_SECRET: "",
      EBAY_SELLER_REFRESH_TOKEN: "",
      EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN: "",
      EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_KEY,
      NEXT_PUBLIC_SUPABASE_URL: "https://preview.test-only",
      SUPABASE_SERVICE_ROLE_KEY: "role-key-test-only",
    },
    supabaseClient: fakeSupabase({}, {
      ebay_active_listings: { message: "registry-read-error" },
    }),
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(result.REGISTRY_RUNTIME_CONFIG, "AVAILABLE")
  assert.equal(result.REGISTRY_SOURCE_RUNTIME_STATUS, "READ_FAILED")
  assert.equal(result.LIVE_ENUMERATION_RUNTIME_STATUS, "AUTH_UNAVAILABLE")
  assert.equal(result.MANUAL_LISTING_RUNTIME_AUTODISCOVERY, "FAIL")
  assert.equal(result.REGISTRY_RECORD_COUNT, "UNPROVEN")
  assert.equal(result.LIVE_EBAY_LISTING_COUNT, "UNPROVEN")
  assert.equal(result.LIVE_PARTITION_VALID, "NO")
  assert.equal(result.REGISTRY_PARTITION_VALID, "NO")
})

test("diagnóstico de cobertura Registry completa y conciliado en runtime", async () => {
  const fake = fakeEbay()
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {
      ...environment(),
      NEXT_PUBLIC_SUPABASE_URL: "https://preview.test-only",
      SUPABASE_SERVICE_ROLE_KEY: "role-key-test-only",
      EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_KEY,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
    },
    fetchImpl: fake.fetchImpl,
    supabaseClient: fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(result.REGISTRY_RUNTIME_CONFIG, "AVAILABLE")
  assert.equal(result.SUPABASE_URL_PRESENT, "YES")
  assert.equal(result.SUPABASE_SERVICE_ROLE_PRESENT, "YES")
  assert.equal(result.REGISTRY_SOURCE_RUNTIME_STATUS, "AVAILABLE")
  assert.equal(result.LIVE_ENUMERATION_RUNTIME_STATUS, "AVAILABLE")
  assert.equal(result.REGISTRY_RECORD_COUNT, 1)
  assert.equal(result.LIVE_EBAY_LISTING_COUNT, 1)
  assert.equal(result.REGISTRY_MATCHED_COUNT, 1)
  assert.equal(result.REGISTRY_MISSING_COUNT, 0)
  assert.equal(result.REGISTRY_ORPHANED_COUNT, 0)
  assert.equal(result.REGISTRY_AMBIGUOUS_COUNT, 0)
  assert.equal(result.REGISTRY_COVERAGE_PERCENT, 100)
  assert.equal(result.LIVE_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_PARTITION_VALID, "YES")
  assert.equal(result.MANUAL_LISTING_RUNTIME_AUTODISCOVERY, "PASS")
})

test("captura Registry entrega al planner sólo evidencia marketplace certificada", async () => {
  const fake = fakeEbay()
  const captured = []
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {
      ...environment(),
      NEXT_PUBLIC_SUPABASE_URL: "https://preview.test-only",
      SUPABASE_SERVICE_ROLE_KEY: "role-key-test-only",
      EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_KEY,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
    },
    fetchImpl: fake.fetchImpl,
    supabaseClient: fakeSupabase({
      ebay_active_listings: [activeRegistryRow()],
    }),
    captureRegistryRepairEvidence: (evidence) => {
      captured.push(evidence)
    },
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(result.LIVE_ENUMERATION_RUNTIME_STATUS, "AVAILABLE")
  assert.equal(captured.length, 1)
  assert.equal(captured[0].liveListings.length,
    result.LIVE_EBAY_LISTING_COUNT)
  assert.equal(captured[0].liveListings.every((listing) =>
    listing.marketplaceCertification.status === "US_CERTIFIED"), true)
})

test("diagnóstico de cobertura Registry identifica desajuste de itemId vs SKUs en 26↔7", async () => {
  const liveOptions = { sellerItemsWithoutSite: 26 }
  const fake = fakeEbay(liveOptions)
  const registryRows = Array.from({ length: 7 }, (_, index) =>
    activeRegistryRow({
      itemId: String(123456789012 + index),
      sku: `WRONG-SKU-${index + 1}`,
    })
  )
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {
      ...environment(),
      NEXT_PUBLIC_SUPABASE_URL: "https://preview.test-only",
      SUPABASE_SERVICE_ROLE_KEY: "role-key-test-only",
      EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_KEY,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
    },
    fetchImpl: fake.fetchImpl,
    supabaseClient: fakeSupabase({ ebay_active_listings: registryRows }),
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(result.LIVE_EBAY_LISTING_COUNT, 26)
  assert.equal(result.REGISTRY_RECORD_COUNT, 7)
  assert.equal(result.REGISTRY_MATCHED_COUNT, 0)
  assert.equal(result.REGISTRY_MISSING_COUNT, 26)
  assert.equal(result.REGISTRY_ORPHANED_COUNT, 7)
  assert.equal(result.REGISTRY_AMBIGUOUS_COUNT, 0)
  assert.equal(result.LIVE_WITH_ITEM_ID_COUNT, 26)
  assert.equal(result.LIVE_WITH_SKU_COUNT, 26)
  assert.equal(result.LIVE_WITH_VARIATION_KEY_COUNT, 0)
  assert.equal(result.LIVE_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT, 26)
  assert.equal(result.REGISTRY_WITH_ITEM_ID_COUNT, 7)
  assert.equal(result.REGISTRY_WITH_SKU_COUNT, 7)
  assert.equal(result.REGISTRY_WITH_VARIATION_KEY_COUNT, 0)
  assert.equal(result.REGISTRY_WITH_COMPLETE_COMPOSITE_IDENTITY_COUNT, 7)
  assert.equal(result.ITEM_ID_EXACT_OVERLAP_COUNT, 7)
  assert.equal(result.SKU_EXACT_OVERLAP_COUNT, 0)
  assert.equal(result.VARIATION_KEY_EXACT_OVERLAP_COUNT, 0)
  assert.equal(result.ITEM_ID_PLUS_SKU_OVERLAP_COUNT, 0)
  assert.equal(result.ITEM_ID_PLUS_VARIATION_OVERLAP_COUNT, 0)
  assert.equal(result.SKU_PLUS_VARIATION_OVERLAP_COUNT, 0)
  assert.equal(result.FULL_COMPOSITE_OVERLAP_COUNT, 0)
  assert.equal(result.REGISTRY_CURRENT_IDENTITY_COUNT, 7)
  assert.equal(result.REGISTRY_LEGACY_IDENTITY_COUNT, 0)
  assert.equal(result.REGISTRY_INCOMPLETE_IDENTITY_COUNT, 0)
  assert.equal(result.REGISTRY_HISTORICAL_ONLY_COUNT, 0)
  assert.equal(result.REGISTRY_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_IDENTITY_ROOT_CAUSE, "ITEM_ID_MISMATCH")
  assert.equal(result.SAFE_BACKFILL_WITHOUT_DUPLICATION, "NO")
  assert.equal(result.LIVE_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_PARTITION_VALID, "YES")
})

test("diagnóstico de cobertura Registry clasifica filas históricas sin superposición estable", async () => {
  const fake = fakeEbay({ sellerItemsWithoutSite: 26 })
  const registryRows = Array.from({ length: 7 }, () =>
    activeRegistryRow({
      itemId: "",
      sku: "",
      variationKey: null,
    })
  )
  const result = await diagnoseRegistryCoverageRuntime({
    environment: {
      ...environment(),
      NEXT_PUBLIC_SUPABASE_URL: "https://preview.test-only",
      SUPABASE_SERVICE_ROLE_KEY: "role-key-test-only",
      EBAY_SELLER_ACCOUNT_KEY: ACCOUNT_KEY,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
    },
    fetchImpl: fake.fetchImpl,
    supabaseClient: fakeSupabase({ ebay_active_listings: registryRows }),
    startedAt: Date.parse("2026-08-08T16:00:00.000Z"),
  })
  assert.equal(result.REGISTRY_RECORD_COUNT, 7)
  assert.equal(result.REGISTRY_HISTORICAL_ONLY_COUNT, 7)
  assert.equal(result.REGISTRY_CURRENT_IDENTITY_COUNT, 0)
  assert.equal(result.REGISTRY_LEGACY_IDENTITY_COUNT, 0)
  assert.equal(result.REGISTRY_INCOMPLETE_IDENTITY_COUNT, 0)
  assert.equal(result.REGISTRY_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_IDENTITY_ROOT_CAUSE, "REGISTRY_ROWS_HISTORICAL_ONLY")
  assert.equal(result.SAFE_BACKFILL_WITHOUT_DUPLICATION, "YES")
  assert.equal(result.ITEM_ID_EXACT_OVERLAP_COUNT, 0)
  assert.equal(result.SKU_EXACT_OVERLAP_COUNT, 0)
  assert.equal(result.FULL_COMPOSITE_OVERLAP_COUNT, 0)
  assert.equal(result.LIVE_WITH_ITEM_ID_COUNT, 26)
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

test("listing Trading live sin objeto Inventory conserva existencia y separa representación", async () => {
  const live = await run(fakeEbay())
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )

  assert.equal(live.discovery.inventory.status, "AVAILABLE")
  assert.deepEqual(live.discovery.inventoryRepresentation, {
    status: "COMPLETE",
    classificationGrain: "ITEM_SKU",
    representedCount: 0,
    notRepresentedCount: 1,
    identityUnresolvedCount: 0,
    sourceUnprovenCount: 0,
  })
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.liveEnumeration.status,
    "COMPLETE")
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryCapability.status,
    "AVAILABLE")
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryRepresentation
    .status, "COMPLETE")
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "INVENTORY_RECONCILIATION_UNAVAILABLE",
  ), false)
  assert.equal(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "INVENTORY_RECONCILIATION_UNAVAILABLE",
  ), false)
  assert.equal(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "TRADING_LISTING_NOT_IN_INVENTORY_API_EXPECTED_MODEL_GAP",
  ), true)
  assert.equal(monitor.discoveryCoverage.accountAlertReasons?.some((reason) =>
    reason.includes("HISTORICAL_DISCOVERY_EVIDENCE")), false)
  assert.equal(monitor.accountDataQualityIssues.some((entry) =>
    entry.code === "LISTING_DISCOVERY_INCOMPLETE"), false)
  assert.equal(monitor.listings[0].discovery.livePresence.status, "LIVE_ACTIVE")
  assert.equal(monitor.listings[0].discovery.coverage.status, "COMPLETE")
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId === null).length, 1)
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId !== null).length, 0)
  const unmanaged = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(unmanaged.listings[0].discovery.registryStatus,
    "UNREGISTERED_DISCOVERY")
  assert.equal(unmanaged.listings[0].blockers.some((blocker) =>
    blocker.code === "REGISTRY_RECONCILIATION_FAILED"), true)
})

test("Inventory vacío omitido certificado conserva live y no fabrica offers", async () => {
  const fake = fakeEbay({ inventoryOmittedEmpty: true })
  const live = await run(fake)
  assert.equal(live.discovery.inventory.status, "AVAILABLE")
  assert.equal(live.discovery.inventory.inventorySkuCount, 0)
  assert.deepEqual(live.discovery.inventory.publishedOffers, [])
  assert.equal(fake.calls.filter((call) =>
    call.path === "/sell/inventory/v1/inventory_item").length, 1)
  assert.equal(fake.calls.filter((call) =>
    call.path === "/sell/inventory/v1/offer").length, 0)
  assert.equal(live.discovery.currentLiveListings.length, 1)
  assert.deepEqual(live.discovery.inventoryRepresentation, {
    status: "COMPLETE",
    classificationGrain: "ITEM_SKU",
    representedCount: 0,
    notRepresentedCount: 1,
    identityUnresolvedCount: 0,
    sourceUnprovenCount: 0,
  })
  assert.equal(live.analytics.analyticsRepresentedItemCount, 1)
})

test("consumer Inventory protegido ejecuta subset refresh, GetUser y matriz A-D exacta", async () => {
  const fake = fakeEbay({ inventoryOmittedEmpty: true })
  const diagnostic = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
    fetchImpl: fake.fetchImpl,
    clock: () => new Date(NOW),
    startedAt: Date.now(),
    }))
  assert.equal(diagnostic.inventoryItemsHttpStatus, 200)
  assert.equal(diagnostic.inventoryItemsAuthorized, true)
  assert.equal(diagnostic.inventoryItemsContentType, "application/json")
  assert.deepEqual(diagnostic.inventoryItemsTopLevelKeys,
    ["href", "limit", "size", "total"])
  assert.equal(diagnostic.inventoryItemsHasArray, false)
  assert.equal(diagnostic.inventoryItemsArrayCount, null)
  assert.equal(diagnostic.inventoryItemsTotalPresent, true)
  assert.equal(diagnostic.inventoryItemsTotal, 0)
  assert.equal(diagnostic.inventoryItemsNextPresent, false)
  assert.equal(diagnostic.inventoryItemsResponseShape,
    "CERTIFIED_EMPTY_OMITTED_ARRAY")
  assert.equal(diagnostic.inventoryCatalogState, "EMPTY")
  assert.equal(diagnostic.inventoryItemsSafeErrorCategory, "NONE")
  assert.equal(diagnostic.variants.currentCanonical.variant,
    "CURRENT_CANONICAL")
  assert.equal(diagnostic.variants.currentCanonical.acceptedByEndpoint, true)
  assert.equal(diagnostic.variants.noMarketplaceHeader.acceptedByEndpoint, true)
  assert.equal(diagnostic.variants.limitOnly.acceptedByEndpoint, true)
  assert.equal(diagnostic.variants.noQuery.acceptedByEndpoint, true)
  assert.equal(diagnostic.firstAcceptedVariant, "CURRENT_CANONICAL")
  assert.equal(diagnostic.minimumDocumentedAcceptedVariant, "NO_QUERY")
  assert.equal(diagnostic.requestContractRootCause,
    "CURRENT_CANONICAL_ACCEPTED")
  assert.deepEqual(diagnostic.scopeControl, {
    subsetScopeRefresh: "AVAILABLE",
    fourScopeRefresh: "NOT_RUN",
    subsetScopeInventoryItemsStatus: 200,
    fourScopeInventoryItemsStatus: null,
    scopeMintingDifferenceCauses400: "NO",
  })
  assert.deepEqual(diagnostic.execution, {
    globalCallsBeforeInventory: 2,
    globalTimeRemainingBeforeInventoryMs:
      diagnostic.execution.globalTimeRemainingBeforeInventoryMs,
    inventoryRefreshExecuted: true,
    inventoryGetUserExecuted: true,
    inventoryGetItemsExecuted: true,
    fourScopeRefreshExecuted: false,
    fourScopeInventoryGetItemsExecuted: false,
    inventoryFailureFromBudget: false,
    externalCalls: 6,
    maximumExternalCalls: 8,
  })
  assert.equal(
    diagnostic.execution.globalTimeRemainingBeforeInventoryMs > 0,
    true,
  )
  assert.deepEqual(diagnostic.calls.map((call) => call.operation), [
    "OAUTH_REFRESH_INVENTORY",
    "TRADING_GET_USER",
    "INVENTORY_GET_ITEMS_MATRIX_A",
    "INVENTORY_GET_ITEMS_MATRIX_B",
    "INVENTORY_GET_ITEMS_MATRIX_C",
    "INVENTORY_GET_ITEMS_MATRIX_D",
  ])
  const inventoryRequests = fake.calls.filter((call) =>
    call.path === "/sell/inventory/v1/inventory_item")
  assert.deepEqual(inventoryRequests.map((call) => ({
    search: call.search,
    marketplaceHeader: call.marketplaceHeader,
    authorizationKind: call.authorizationKind,
  })), [
    {
      search: "?limit=50&offset=0",
      marketplaceHeader: "EBAY_US",
      authorizationKind: "BEARER",
    },
    {
      search: "?limit=50&offset=0",
      marketplaceHeader: null,
      authorizationKind: "BEARER",
    },
    {
      search: "?limit=50",
      marketplaceHeader: null,
      authorizationKind: "BEARER",
    },
    { search: "", marketplaceHeader: null, authorizationKind: "BEARER" },
  ])
  assert.equal(fake.calls.some((call) =>
    call.path === "/sell/inventory/v1/offer"), false)
  assert.equal(diagnostic.execution.externalCalls <=
    diagnostic.execution.maximumExternalCalls, true)
  assert.equal(Object.values(diagnostic.safety).every((value) =>
    value === false || value === 0), true)
  const serialized = JSON.stringify(diagnostic)
  for (const forbidden of [
    "seller-refresh-test-only",
    "ephemeral-access-token-test-only",
    "ephemeral-four-scope-access-token-test-only",
    "private@example.invalid",
    "LIVE-SKU",
    "Bearer ",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})

test("matriz A-D aísla el header y devuelve sólo metadata estructural sanitizada", async () => {
  const fake = fakeEbay({
    inventoryMatrixStatuses: {
      A: 400,
      B: 200,
      C: 200,
      D: 200,
    },
  })
  const diagnostic = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(diagnostic.requestContractRootCause,
    "MARKETPLACE_HEADER_REJECTED")
  assert.equal(diagnostic.firstAcceptedVariant, "NO_MARKETPLACE_HEADER")
  assert.equal(diagnostic.minimumDocumentedAcceptedVariant, "NO_QUERY")
  assert.equal(diagnostic.variants.currentCanonical.httpStatus, 400)
  assert.equal(diagnostic.variants.currentCanonical.safeErrorCategory,
    "HTTP_4XX")
  assert.deepEqual(diagnostic.variants.currentCanonical.errorMetadata, {
    status: "CLASSIFIED",
    errorObjectCount: 1,
    errorIds: ["25709"],
    domains: ["API_INVENTORY"],
    categories: ["REQUEST"],
    parameterNames: ["marketplaceId", "offset"],
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: "OTHER",
    MESSAGE_SUFFIX_CLASS: "NO_PERIOD",
    MESSAGE_LENGTH_BUCKET: "32_63",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
  })
  assert.equal(diagnostic.variants.noMarketplaceHeader.httpStatus, 200)
  assert.equal(diagnostic.variants.limitOnly.httpStatus, 200)
  assert.equal(diagnostic.variants.noQuery.httpStatus, 200)
  assert.equal(diagnostic.scopeControl.fourScopeRefresh, "NOT_RUN")
  assert.equal(diagnostic.execution.externalCalls, 6)
  assert.equal(diagnostic.execution.fourScopeRefreshExecuted, false)
  assert.equal(diagnostic.execution.fourScopeInventoryGetItemsExecuted, false)
  const serialized = JSON.stringify(diagnostic)
  for (const forbidden of [
    "private-inventory-error-message-test-only",
    "private-inventory-error-long-message-test-only",
    "private-input-ref-test-only",
    "private-output-ref-test-only",
    "private-marketplace-value-test-only",
    "private-offset-value-test-only",
    "seller-refresh-test-only",
    "ephemeral-access-token-test-only",
    "Bearer ",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
  assert.equal(Object.values(diagnostic.safety).every((value) =>
    value === false || value === 0), true)
})

test("sólo HTTP 200 certifica aceptación y A no es variante documentada", async () => {
  const aOnlyFake = fakeEbay({
    inventoryMatrixStatuses: { A: 200, B: 400, C: 400, D: 400 },
  })
  const aOnly = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: aOnlyFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(aOnly.firstAcceptedVariant, "CURRENT_CANONICAL")
  assert.equal(aOnly.minimumDocumentedAcceptedVariant, null)
  assert.equal(aOnly.requestContractRootCause, "CURRENT_CANONICAL_ACCEPTED")
  assert.equal(aOnly.scopeControl.fourScopeRefresh, "NOT_RUN")

  const offContractFake = fakeEbay({
    inventoryMatrixStatuses: { A: 201, B: 204, C: 201, D: 204 },
  })
  const offContract = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: offContractFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(Object.values(offContract.variants).every((variant) =>
    variant.acceptedByEndpoint === false &&
    variant.safeErrorCategory === "RESPONSE_FORMAT_CHANGED" &&
    variant.responseShape === "UNPROVEN"), true)
  assert.equal(offContract.firstAcceptedVariant, null)
  assert.equal(offContract.minimumDocumentedAcceptedVariant, null)
  assert.equal(offContract.requestContractRootCause, "UNPROVEN")
  assert.equal(offContract.scopeControl.fourScopeRefresh, "NOT_RUN")

  const offContractControlFake = fakeEbay({
    inventoryMatrixStatuses: {
      A: 400,
      B: 400,
      C: 400,
      D: 400,
      FOUR_SCOPE_CONTROL: 204,
    },
  })
  const offContractControl = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: offContractControlFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(offContractControl.scopeControl.fourScopeRefresh, "AVAILABLE")
  assert.equal(offContractControl.scopeControl.fourScopeInventoryItemsStatus,
    204)
  assert.equal(offContractControl.scopeControl
    .scopeMintingDifferenceCauses400, "UNPROVEN")
  assert.equal(offContractControl.requestContractRootCause, "UNPROVEN")
})

test("scope metadata distingue omisión real de presencia malformada", async () => {
  const omittedSubsetFake = fakeEbay({
    subsetScopeMetadataOmitted: true,
    inventoryMatrixStatuses: { A: 200, B: 200, C: 200, D: 200 },
  })
  const omittedSubset = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: omittedSubsetFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(omittedSubset.requestContractRootCause,
    "CURRENT_CANONICAL_ACCEPTED")
  assert.equal(omittedSubset.execution.externalCalls, 6)

  const malformedSubsetValues = [
    null,
    7,
    "",
    "   ",
    ["https://api.ebay.com/oauth/api_scope"],
    [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
      `https://api.ebay.com/oauth/api_scope/${"x".repeat(4_000)}`,
    ].join(" "),
  ]
  for (const scope of malformedSubsetValues) {
    const fake = fakeEbay({ subsetScopeMetadataValue: scope })
    const diagnostic = await withEnvironment(environment(), () =>
      diagnoseInstalledEbayInventoryConsumer({
        fetchImpl: fake.fetchImpl,
        clock: () => new Date(NOW),
        startedAt: Date.now(),
      }))
    assert.equal(diagnostic.inventoryItemsSafeErrorCategory,
      "RESPONSE_FORMAT_CHANGED")
    assert.equal(diagnostic.requestContractRootCause, "UNPROVEN")
    assert.equal(diagnostic.execution.externalCalls, 1)
    assert.equal(diagnostic.execution.inventoryGetUserExecuted, false)
    assert.equal(diagnostic.execution.inventoryGetItemsExecuted, false)
  }

  const omittedFourFake = fakeEbay({
    inventoryMatrixStatuses: {
      A: 400,
      B: 400,
      C: 400,
      D: 400,
      FOUR_SCOPE_CONTROL: 200,
    },
    fourScopeMetadataOmitted: true,
  })
  const omittedFour = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: omittedFourFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(omittedFour.requestContractRootCause,
    "SCOPE_MINTING_DIFFERENCE")
  assert.equal(omittedFour.execution.externalCalls, 8)

  for (const scope of [null, "", " ".repeat(4_001)]) {
    const fake = fakeEbay({
      inventoryMatrixStatuses: {
        A: 400,
        B: 400,
        C: 400,
        D: 400,
        FOUR_SCOPE_CONTROL: 200,
      },
      fourScopeMetadataValue: scope,
    })
    const diagnostic = await withEnvironment(environment(), () =>
      diagnoseInstalledEbayInventoryConsumer({
        fetchImpl: fake.fetchImpl,
        clock: () => new Date(NOW),
        startedAt: Date.now(),
      }))
    assert.equal(diagnostic.requestContractRootCause, "UNPROVEN")
    assert.equal(diagnostic.scopeControl.fourScopeRefresh, "FAILED")
    assert.equal(diagnostic.scopeControl.fourScopeInventoryItemsStatus, null)
    assert.equal(diagnostic.execution.externalCalls, 7)
  }
})

test("cuatro HTTP 400 exactos habilitan sólo el control D con unión de cuatro scopes", async () => {
  const fake = fakeEbay({
    inventoryMatrixStatuses: {
      A: 400,
      B: 400,
      C: 400,
      D: 400,
      FOUR_SCOPE_CONTROL: 200,
    },
  })
  const diagnostic = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(diagnostic.requestContractRootCause,
    "SCOPE_MINTING_DIFFERENCE")
  assert.equal(diagnostic.firstAcceptedVariant, null)
  assert.equal(diagnostic.minimumDocumentedAcceptedVariant, null)
  assert.deepEqual(diagnostic.scopeControl, {
    subsetScopeRefresh: "AVAILABLE",
    fourScopeRefresh: "AVAILABLE",
    subsetScopeInventoryItemsStatus: 400,
    fourScopeInventoryItemsStatus: 200,
    scopeMintingDifferenceCauses400: "YES",
  })
  assert.equal(diagnostic.execution.externalCalls, 8)
  assert.equal(diagnostic.execution.maximumExternalCalls, 8)
  assert.equal(diagnostic.execution.fourScopeRefreshExecuted, true)
  assert.equal(diagnostic.execution.fourScopeInventoryGetItemsExecuted, true)
  assert.deepEqual(diagnostic.calls.map((call) => call.operation), [
    "OAUTH_REFRESH_INVENTORY",
    "TRADING_GET_USER",
    "INVENTORY_GET_ITEMS_MATRIX_A",
    "INVENTORY_GET_ITEMS_MATRIX_B",
    "INVENTORY_GET_ITEMS_MATRIX_C",
    "INVENTORY_GET_ITEMS_MATRIX_D",
    "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE",
    "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",
  ])
  const refreshes = fake.calls.filter((call) =>
    call.path === "/identity/v1/oauth2/token")
  assert.deepEqual(refreshes.map((call) => call.oauthScope), [
    [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
    ].join(" "),
    [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
    ].join(" "),
  ])
  assert.equal(refreshes.some((call) =>
    /fulfillment|marketing/.test(call.oauthScope ?? "")), false)
  const inventoryRequests = fake.calls.filter((call) =>
    call.path === "/sell/inventory/v1/inventory_item")
  assert.equal(inventoryRequests.length, 5)
  assert.deepEqual(inventoryRequests.at(-1), {
    ...inventoryRequests.at(-1),
    search: "",
    marketplaceHeader: null,
    authorizationKind: "BEARER",
  })
  assert.equal(Object.values(diagnostic.safety).every((value) =>
    value === false || value === 0), true)
  const serialized = JSON.stringify(diagnostic)
  for (const forbidden of [
    "private-inventory-error-message-test-only",
    "private-inventory-error-long-message-test-only",
    "private-input-ref-test-only",
    "private-output-ref-test-only",
    "private-marketplace-value-test-only",
    "private-offset-value-test-only",
    "seller-refresh-test-only",
    "ephemeral-access-token-test-only",
    "ephemeral-four-scope-access-token-test-only",
    "Bearer ",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
  const safeClasses = [
    diagnostic.variants.currentCanonical.errorMetadata.ERROR_25709_SAFE_FIELD_CLASS,
    diagnostic.variants.noMarketplaceHeader.errorMetadata.ERROR_25709_SAFE_FIELD_CLASS,
    diagnostic.variants.limitOnly.errorMetadata.ERROR_25709_SAFE_FIELD_CLASS,
    diagnostic.variants.noQuery.errorMetadata.ERROR_25709_SAFE_FIELD_CLASS,
  ]
  const uniqueSafeClasses = [...new Set(safeClasses)].sort()
  assert.deepEqual(uniqueSafeClasses, ["UNRECOGNIZED"])
  const sameFieldClassAcrossVariants = safeClasses.every((value) =>
    value === safeClasses[0])
  assert.equal(sameFieldClassAcrossVariants, true)
  assert.equal(safeClasses.some((value) => value === "LIMIT"), false)
})

test("control cuatro-scopes 400 descarta diferencia de minting sin inventar causa", async () => {
  const fake = fakeEbay({
    inventoryMatrixStatuses: {
      A: 400,
      B: 400,
      C: 400,
      D: 400,
      FOUR_SCOPE_CONTROL: 400,
    },
  })
  const diagnostic = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(diagnostic.requestContractRootCause,
    "ALL_DOCUMENTED_VARIANTS_REJECTED")
  assert.deepEqual(diagnostic.scopeControl, {
    subsetScopeRefresh: "AVAILABLE",
    fourScopeRefresh: "AVAILABLE",
    subsetScopeInventoryItemsStatus: 400,
    fourScopeInventoryItemsStatus: 400,
    scopeMintingDifferenceCauses400: "NO",
  })
  assert.equal(diagnostic.execution.externalCalls, 8)
  assert.equal(diagnostic.execution.inventoryFailureFromBudget, false)
  assert.equal(Object.values(diagnostic.safety).every((value) =>
    value === false || value === 0), true)
})

test("control cuatro-scopes falla cerrado por scope faltante o reserva temporal", async () => {
  const statuses = {
    A: 400,
    B: 400,
    C: 400,
    D: 400,
    FOUR_SCOPE_CONTROL: 200,
  }
  const missingScopeFake = fakeEbay({
    inventoryMatrixStatuses: statuses,
    missingScope:
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  })
  const missingScope = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: missingScopeFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(missingScope.requestContractRootCause, "UNPROVEN")
  assert.deepEqual(missingScope.scopeControl, {
    subsetScopeRefresh: "AVAILABLE",
    fourScopeRefresh: "FAILED",
    subsetScopeInventoryItemsStatus: 400,
    fourScopeInventoryItemsStatus: null,
    scopeMintingDifferenceCauses400: "UNPROVEN",
  })
  assert.equal(missingScope.execution.externalCalls, 7)
  assert.equal(missingScope.execution.fourScopeRefreshExecuted, true)
  assert.equal(missingScope.execution.fourScopeInventoryGetItemsExecuted, false)

  const extraScopeFake = fakeEbay({
    inventoryMatrixStatuses: statuses,
    fourScopeExtraReturnedScope:
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  })
  const extraScope = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: extraScopeFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(extraScope.requestContractRootCause, "UNPROVEN")
  assert.equal(extraScope.scopeControl.fourScopeRefresh, "FAILED")
  assert.equal(extraScope.scopeControl.fourScopeInventoryItemsStatus, null)
  assert.equal(extraScope.execution.externalCalls, 7)
  assert.equal(extraScope.execution.fourScopeInventoryGetItemsExecuted, false)

  const timeBoundFake = fakeEbay({ inventoryMatrixStatuses: statuses })
  const timeBound = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: timeBoundFake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now() - 7_000,
    }))
  assert.equal(timeBound.requestContractRootCause, "UNPROVEN")
  assert.equal(timeBound.scopeControl.fourScopeRefresh, "NOT_RUN")
  assert.equal(timeBound.execution.externalCalls, 6)
  assert.equal(timeBound.execution.fourScopeRefreshExecuted, false)
  assert.equal(timeBound.execution.fourScopeInventoryGetItemsExecuted, false)
  assert.equal(timeBound.execution.inventoryFailureFromBudget, true)
  assert.equal(Object.values(timeBound.safety).every((value) =>
    value === false || value === 0), true)
})

test("cualquier variante distinta de 400 suprime el control de cuatro scopes", async () => {
  const fake = fakeEbay({
    inventoryMatrixStatuses: { A: 400, B: 400, C: 400, D: 403 },
  })
  const diagnostic = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(diagnostic.variants.noQuery.safeErrorCategory, "HTTP_403")
  assert.equal(diagnostic.requestContractRootCause, "UNPROVEN")
  assert.deepEqual(diagnostic.scopeControl, {
    subsetScopeRefresh: "AVAILABLE",
    fourScopeRefresh: "NOT_RUN",
    subsetScopeInventoryItemsStatus: 403,
    fourScopeInventoryItemsStatus: null,
    scopeMintingDifferenceCauses400: "UNPROVEN",
  })
  assert.equal(diagnostic.execution.externalCalls, 6)
  assert.equal(diagnostic.execution.fourScopeRefreshExecuted, false)
  assert.equal(diagnostic.execution.fourScopeInventoryGetItemsExecuted, false)
  assert.equal(fake.calls.filter((call) =>
    call.path === "/identity/v1/oauth2/token").length, 1)
  assert.equal(Object.values(diagnostic.safety).every((value) =>
    value === false || value === 0), true)
})

test("causa query exige el prefijo de eliminaciones HTTP 400 exacto", async () => {
  const cases = [{
    statuses: { A: 400, B: 400, C: 200, D: 200 },
    rootCause: "OFFSET_ZERO_REJECTED",
  }, {
    statuses: { A: 400, B: 400, C: 400, D: 200 },
    rootCause: "LIMIT_QUERY_REJECTED",
  }, {
    statuses: { A: 403, B: 400, C: 200, D: 200 },
    rootCause: "UNPROVEN",
  }, {
    statuses: { A: 400, B: 403, C: 400, D: 200 },
    rootCause: "UNPROVEN",
  }]
  for (const testCase of cases) {
    const fake = fakeEbay({ inventoryMatrixStatuses: testCase.statuses })
    const diagnostic = await withEnvironment(environment(), () =>
      diagnoseInstalledEbayInventoryConsumer({
        fetchImpl: fake.fetchImpl,
        clock: () => new Date(NOW),
        startedAt: Date.now(),
      }))
    assert.equal(diagnostic.requestContractRootCause, testCase.rootCause)
    assert.equal(diagnostic.scopeControl.fourScopeRefresh, "NOT_RUN")
    assert.equal(diagnostic.execution.externalCalls, 6)
    assert.equal(Object.values(diagnostic.safety).every((value) =>
      value === false || value === 0), true)
  }
})

test("consumer Inventory distingue formato, auth, timeout, red y presupuesto", async () => {
  const cases = [
    [{ inventoryMalformedEmpty: true }, "RESPONSE_FORMAT_CHANGED", 6],
    [{ inventoryNonJsonContentType: true }, "RESPONSE_FORMAT_CHANGED", 6],
    [{ malformedJsonPath: "/sell/inventory/v1/inventory_item" },
      "RESPONSE_FORMAT_CHANGED", 6],
    [{ inventoryHttpStatus: 401 }, "HTTP_401", 6],
    [{ inventoryHttpStatus: 403 }, "HTTP_403", 6],
    [{ inventoryOauthError: "invalid_scope" }, "INVALID_SCOPE", 1],
    [{ missingScope: "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly" },
      "INVALID_SCOPE", 1],
    [{ missingScope: "https://api.ebay.com/oauth/api_scope" },
      "INVALID_SCOPE", 1],
    [{ subsetExtraReturnedScope:
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly" },
      "INVALID_SCOPE", 1],
    [{ accountMismatch: true }, "ACCOUNT_BINDING_FAILED", 2],
    [{ getUserSite: "GERMANY" }, "ACCOUNT_BINDING_FAILED", 2],
    [{ inventoryTimeout: true }, "TIMEOUT", 6],
    [{ inventoryNetworkFailure: true }, "NETWORK", 6],
  ]
  for (const [options, category, calls] of cases) {
    const fake = fakeEbay(options)
    const diagnostic = await withEnvironment(environment(), () =>
      diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fake.fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
      }))
    assert.equal(diagnostic.inventoryCatalogState, "UNPROVEN")
    assert.equal(diagnostic.inventoryItemsSafeErrorCategory, category)
    if (category === "RESPONSE_FORMAT_CHANGED") {
      assert.equal(diagnostic.inventoryItemsResponseShape, "INVALID")
    }
    assert.equal(diagnostic.execution.externalCalls, calls)
    assert.equal(diagnostic.execution.externalCalls <= 8, true)
    assert.equal(diagnostic.execution.fourScopeRefreshExecuted, false)
    assert.equal(diagnostic.execution.fourScopeInventoryGetItemsExecuted, false)
    if (category === "HTTP_401" || category === "HTTP_403") {
      assert.equal(Object.values(diagnostic.variants).every((variant) =>
        variant.safeErrorCategory === category), true)
      assert.equal(diagnostic.requestContractRootCause, "UNPROVEN")
      assert.equal(diagnostic.scopeControl.fourScopeRefresh, "NOT_RUN")
    }
    assert.equal(diagnostic.safety.ebayWrites, 0)
    assert.equal(diagnostic.safety.inventoryWrites, 0)
  }
  const budget = await withEnvironment(environment(), () =>
    diagnoseInstalledEbayInventoryConsumer({
    fetchImpl: fakeEbay().fetchImpl,
    clock: () => new Date(NOW),
    startedAt: Date.now() - 22_000,
    }))
  assert.equal(budget.inventoryItemsSafeErrorCategory, "BUDGET_EXHAUSTED")
  assert.equal(budget.execution.inventoryFailureFromBudget, true)
  assert.equal(budget.execution.externalCalls, 0)

  const missingTokenEnvironment = {
    ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "",
  }
  const missingToken = await withEnvironment(missingTokenEnvironment, () =>
    diagnoseInstalledEbayInventoryConsumer({
      fetchImpl: fakeEbay().fetchImpl,
      clock: () => new Date(NOW),
      startedAt: Date.now(),
    }))
  assert.equal(missingToken.inventoryItemsSafeErrorCategory,
    "CONFIGURATION_MISSING")
  assert.equal(missingToken.execution.externalCalls, 0)
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

test("GetUser sin Site no hereda marketplace desde listings", async () => {
  const result = await run(fakeEbay({ getUserSiteOmitted: true }))
  assert.equal(result.account.bindingMatched, true)
  assert.equal(result.account.status, "PARTIAL")
  assert.equal(result.account.limitationCode,
    "EBAY_US_MARKETPLACE_BINDING_UNPROVEN")
  assert.equal(result.discovery.listings.length, 1)
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
  assert.equal(result.discovery.sellerWideEnumeration.itemSetComplete, false)
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [activeRegistryRow({
        itemId: "123456789013",
        sku: "PAGE-TWO-SKU",
      })],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    result,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.marketplaceCertification
    .status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.liveEnumeration
    .observedLiveItemCount, 1)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemsNotInSellerWideEnumerationCount, null)
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ), false)
})

test("metadata de paginación contradictoria nunca certifica discovery", async () => {
  const fake = fakeEbay({ paginationMetadataConflict: true })
  const result = await run(fake)
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_PAGINATION_METADATA_CONFLICT",
  ))
})

test("reported versus parsed mismatch conserva partition y gap exacto", async () => {
  const result = await run(fakeEbay({ sellerReportedTotal: 2 }))
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsReported, 2)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsParsed, 1)
  assertMarketplacePartition(result.discovery.marketplaceCertification)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED",
  ))
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.equal(result.discovery.gapCodes.includes(
    "SELLER_WIDE_MARKETPLACE_PARTITION_INVARIANT_FAILED",
  ), false)
  assert.equal(result.discovery.sellerWideEnumeration.itemSetComplete, false)
})

test("variaciones sin identidad no se deduplican como cobertura completa", async () => {
  const fake = fakeEbay({ ambiguousVariations: true })
  const result = await run(fake)
  assert.equal(result.discovery.coverage, "COMPLETE")
  assert.equal(result.discovery.listings.length, 1)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS",
  ))
})

test("Item repetido sin variationKey queda explícitamente ambiguo", async () => {
  const fake = fakeEbay({
    repeatedItemWithoutVariationIdentity: true,
  })
  const result = await run(fake)
  assert.equal(result.discovery.coverage, "COMPLETE")
  assert.equal(result.discovery.listings.length, 2)
  assert.equal(result.discovery.listings.every((listing) =>
    listing.identityAmbiguous === true), true)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS",
  ))
  assert.equal(fake.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 1)
})

test("listing no-US nunca se proyecta bajo contexto EBAY_US", async () => {
  const fake = fakeEbay({ nonUsListing: true, getItemSite: "Germany" })
  const result = await run(fake)
  assert.equal(result.account.status, "CERTIFIED")
  assert.equal(result.discovery.coverage, "COMPLETE")
  assert.equal(result.discovery.listings.length, 0)
  assert.equal(
    result.discovery.marketplaceCertification
      .sellerWideItemsMarketplaceCertifiedNonUs,
    1,
  )
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsRepresented, 0)
  assert.equal(fake.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 1)
  assert.equal(result.analytics.analyticsRequestedItemCount, 0)
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    result,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ), false)
  assert.equal(monitor.discoveryCoverage.reconciliation?.sellerWide
    .representedUsItemCount, 0)
  assert.equal(monitor.listings.length, 1)
  assert.equal(monitor.listings[0].discovery.livePresence.status, "LIVE_ACTIVE")
  assert.equal(monitor.listings[0].discovery.livePresence.status ===
    "STORED_ONLY_NOT_IN_CURRENT_LIVE_ENUMERATION", false)
  assert.equal(monitor.alertCandidates.some((alert) =>
    alert.listingReference.itemId === "123456789012"), false)
})

test("conflicto Site seller-wide exige GetItem y conserva gap aunque se resuelva", async () => {
  const fake = fakeEbay({ sellerSiteConflict: true })
  const result = await run(fake)
  assert.equal(result.discovery.listings.length, 1)
  assert.equal(result.discovery.listings[0].marketplaceCertification.source,
    "EBAY_TRADING_GET_ITEM")
  assert.equal(result.discovery.coverage, "PARTIAL")
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_SOURCE_IDENTITY_CONFLICT",
  ))
  assert.equal(fake.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 1)
})

test("conflicto marketplace entre filas se atribuye al reader seller-wide", async () => {
  const live = await run(fakeEbay({ sellerCrossRowMarketplaceConflict: true }))
  assert.equal(live.discovery.listings.length, 0)
  assert.ok(live.discovery.gapCodes.includes(
    "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT",
  ))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  const sellerWideReader = monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_MY_EBAY_SELLING")
  assert.equal(sellerWideReader?.status, "PARTIAL")
  assert.equal(sellerWideReader?.limitationCode,
    "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT")
})

test("GetItem certifica 26 Items sin Site una vez por Item y habilita IDs seguros", async () => {
  const fake = fakeEbay({ sellerItemsWithoutSite: 26, getItemDelayMs: 2 })
  const result = await run(fake)
  const certification = result.discovery.marketplaceCertification
  assert.equal(certification.sellerWideItemsReported, 26)
  assert.equal(certification.sellerWideItemsParsed, 26)
  assert.equal(certification.sellerWideItemsMarketplaceCertifiedUs, 26)
  assert.equal(certification.sellerWideItemsMarketplaceCertifiedNonUs, 0)
  assert.equal(certification.sellerWideItemsMarketplaceUnresolved, 0)
  assert.equal(certification.sellerWideItemsMarketplaceError, 0)
  assert.equal(certification.sellerWideItemsMarketplaceBudgetExhausted, 0)
  assert.equal(certification.sellerWideItemsRepresented, 26)
  assert.equal(new Set(result.discovery.listings.map((listing) =>
    listing.itemId)).size, 26)
  assert.equal(result.discovery.listings.every((listing) =>
    listing.marketplaceCertification.status === "US_CERTIFIED" &&
    listing.marketplaceCertification.source === "EBAY_TRADING_GET_ITEM"), true)
  const getItemCalls = fake.calls.filter((call) =>
    call.tradingCall === "GetItem")
  assert.equal(getItemCalls.length, 26)
  assert.equal(new Set(getItemCalls.map((call) => call.itemId)).size, 26)
  assert.ok(fake.telemetry.getItemMaxConcurrency > 1)
  assert.ok(fake.telemetry.getItemMaxConcurrency <= 4)
  assertMarketplacePartition(certification)
  assert.equal(result.calls.filter((call) =>
    call.operation === "TRADING_GET_ITEM_MARKETPLACE").every((call) =>
      call.status === "SUCCEEDED" && call.marketplaceMutation === false &&
      call.persisted === false), true)
  assert.equal(result.analytics.analyticsRequestedItemCount, 26)
  assert.equal(result.analytics.analyticsRepresentedItemCount, 1)
  assert.equal(result.analytics.analyticsMissingItemCount, 25)
  assert.equal(result.analytics.analyticsCoverageStatus, "PARTIAL")
  assert.equal(result.discovery.inventory.status, "AVAILABLE")
  assert.deepEqual(result.discovery.inventoryRepresentation, {
    status: "COMPLETE",
    classificationGrain: "ITEM_SKU",
    representedCount: 0,
    notRepresentedCount: 26,
    identityUnresolvedCount: 0,
    sourceUnprovenCount: 0,
  })
  assert.equal(result.calls.length < 60, true)
  assert.equal(result.discovery.inventory.gapCodes.some((code) =>
    code.includes("BUDGET_EXHAUSTED")), false)
})

test("hard cap conserva un partition exacto y clasifica excedentes como budget", async () => {
  const fake = fakeEbay({ sellerItemsWithoutSite: 33 })
  const result = await run(fake)
  const certification = result.discovery.marketplaceCertification
  assert.equal(fake.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 32)
  assert.equal(certification.sellerWideItemsReported, 33)
  assert.equal(certification.sellerWideItemsParsed, 33)
  assert.equal(certification.sellerWideItemsMarketplaceCertifiedUs, 32)
  assert.equal(certification.sellerWideItemsMarketplaceBudgetExhausted, 1)
  assert.equal(certification.sellerWideItemsRepresented, 32)
  assertMarketplacePartition(certification)
  assert.equal(result.discovery.coverage, "COMPLETE")
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
  ))
  assert.equal(result.discovery.sellerWideEnumeration.itemSetComplete, true)
  assert.equal(result.discovery.sellerWideEnumeration.identitySetComplete, true)
  assert.equal(result.discovery.sellerWideEnumeration.identities.length, 33)
  assert.equal(result.discovery.sellerWideEnumeration.identities.every((row) =>
    row.representationEligible === false &&
    row.analyticsEligible === false), true)
  assert.equal(result.discovery.gapCodes.includes(
    "SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED",
  ), false)
  assert.equal(result.discovery.gapCodes.includes(
    "UNEXPLAINED_LISTING_RECONCILIATION_GAP",
  ), false)
})

test("GetItem se ejecuta una vez por Item multivariación, no por fila", async () => {
  const fake = fakeEbay({ variationsWithoutSite: true })
  const result = await run(fake)
  assert.equal(result.discovery.listings.length, 2)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceCertifiedUs, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsRepresented, 1)
  assert.equal(fake.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 1)
  assertMarketplacePartition(result.discovery.marketplaceCertification)
})

test("certificación parcial conserva Items US y limita Analytics al subconjunto", async () => {
  const unresolvedId = "123456789013"
  const fake = fakeEbay({
    sellerItemsWithoutSite: 2,
    getItemMissingSiteIds: [unresolvedId],
  })
  const result = await run(fake)
  assert.equal(result.discovery.listings.length, 1)
  assert.equal(result.discovery.listings[0].itemId, "123456789012")
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceCertifiedUs, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceUnresolved, 1)
  assert.equal(result.analytics.status, "PARTIAL")
  assert.equal(result.analytics.analyticsRequestedItemCount, 1)
  assert.equal(result.analytics.analyticsRepresentedItemCount, 1)
  assert.equal(result.analytics.analyticsMissingItemCount, 0)
  assert.equal(result.analytics.analyticsCoverageStatus, "PARTIAL")
  assert.ok(result.analytics.gapCodes.includes(
    "ANALYTICS_LISTING_SCOPE_PARTIAL_DUE_TO_MARKETPLACE_UNPROVEN",
  ))
  const analyticsCall = fake.calls.find((call) =>
    call.path === "/sell/analytics/v1/traffic_report")
  assert.ok(analyticsCall)
  assert.match(analyticsCall.search, /123456789012/)
  assert.doesNotMatch(analyticsCall.search, /123456789013/)

  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [
        activeRegistryRow({ sku: "LIVE-SKU-1" }),
        activeRegistryRow({
          itemId: unresolvedId,
          sku: "LIVE-SKU-2",
        }),
      ],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    result,
    NOW,
  )
  const unresolved = monitor.listings.find((listing) =>
    listing.identity.itemId === unresolvedId)
  assert.equal(monitor.discoveryCoverage.dimensions?.liveEnumeration
    .observedLiveItemCount, 2)
  assert.equal(monitor.discoveryCoverage.dimensions?.marketplaceCertification
    .status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.registryCoverage.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryRepresentation
    .sourceUnprovenCount, 1)
  assert.equal(unresolved?.discovery.livePresence.status, "LIVE_ACTIVE")
  assert.equal(unresolved?.identity.marketplaceCertification.status, "UNPROVEN")
  assert.equal(monitor.alertCandidates.some((alert) =>
    alert.listingReference.itemId === unresolvedId), false)
})

test("GetItem no-US, unresolved, mismatch y fallos conservan accounting PARTIAL", async () => {
  const cases = [
    {
      name: "non-us",
      options: { sellerSiteOmitted: true, getItemSite: "Germany" },
      counter: "sellerWideItemsMarketplaceCertifiedNonUs",
      expected: 1,
      gap: null,
    },
    {
      name: "missing-site",
      options: { sellerSiteOmitted: true, getItemMissingSite: true },
      counter: "sellerWideItemsMarketplaceUnresolved",
      expected: 1,
      gap: "SELLER_WIDE_ITEM_MARKETPLACE_UNRESOLVED",
    },
    {
      name: "item-id-mismatch",
      options: { sellerSiteOmitted: true, getItemMismatch: true },
      counter: "sellerWideItemsMarketplaceItemIdMismatch",
      expected: 1,
      gap: "TRADING_GET_ITEM_IDENTITY_MISMATCH",
    },
    {
      name: "ack-failure",
      options: { sellerSiteOmitted: true, getItemAckFailure: true },
      counter: "sellerWideItemsMarketplaceError",
      expected: 1,
      gap: "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID",
    },
    {
      name: "http-failure",
      options: { sellerSiteOmitted: true, getItemHttpFailure: true },
      counter: "sellerWideItemsMarketplaceError",
      expected: 1,
      gap: "TRADING_GET_ITEM_MARKETPLACE_HTTP_FAILED",
    },
    {
      name: "network-failure",
      options: { sellerSiteOmitted: true, getItemNetworkFailure: true },
      counter: "sellerWideItemsMarketplaceError",
      expected: 1,
      gap: "TRADING_GET_ITEM_MARKETPLACE_READ_FAILED",
    },
    {
      name: "malformed-xml",
      options: { sellerSiteOmitted: true, getItemMalformedXml: true },
      counter: "sellerWideItemsMarketplaceError",
      expected: 1,
      gap: "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID",
    },
  ]
  for (const entry of cases) {
    const fake = fakeEbay(entry.options)
    const result = await run(fake)
    assert.equal(result.discovery.listings.length, 0, entry.name)
    assert.equal(result.discovery.coverage, "COMPLETE", entry.name)
    assert.equal(
      result.discovery.marketplaceCertification[entry.counter],
      entry.expected,
      entry.name,
    )
    const certification = result.discovery.marketplaceCertification
    assertMarketplacePartition(certification)
    assert.equal(result.discovery.gapCodes.includes(
      "SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED",
    ), false, entry.name)
    assert.equal(result.discovery.gapCodes.includes(
      "UNEXPLAINED_LISTING_RECONCILIATION_GAP",
    ), false, entry.name)
    if (entry.gap) {
      assert.ok(result.discovery.gapCodes.includes(entry.gap), entry.name)
    }
    assert.equal(result.analytics.status, "UNAVAILABLE", entry.name)
    assert.equal(result.safety.marketplaceWrites, 0, entry.name)
  }
})

test("presupuesto GetItem conserva enumeración y clasifica el resto sin llamada", async () => {
  const fake = fakeEbay({ sellerSiteOmitted: true })
  const result = await run(fake, {
    readLimits: { maximumCalls: 3, budgetMs: 10_000 },
  })
  assert.equal(result.calls.length, 3)
  assert.equal(fake.calls.some((call) => call.tradingCall === "GetItem"), false)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsReported, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsParsed, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceCertifiedUs, 0)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsRepresented, 0)
  assert.ok(result.discovery.gapCodes.includes(
    "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
  ))

  const timeReserved = fakeEbay({ sellerSiteOmitted: true })
  const timeReservedResult = await run(timeReserved, {
    readLimits: { maximumCalls: 60, budgetMs: 7_000 },
  })
  assert.equal(timeReserved.calls.some((call) =>
    call.tradingCall === "GetItem"), false)
  assert.equal(timeReservedResult.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 1)

  const partiallyCertified = fakeEbay({ sellerItemsWithoutSite: 5 })
  const partiallyCertifiedLive = await run(partiallyCertified, {
    readLimits: { maximumCalls: 16, budgetMs: 30_000 },
  })
  assert.equal(partiallyCertifiedLive.calls.filter((call) =>
    call.operation === "TRADING_GET_ITEM_MARKETPLACE").length, 4)
  assert.equal(partiallyCertifiedLive.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceCertifiedUs, 4)
  assert.equal(partiallyCertifiedLive.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 1)
  assertMarketplacePartition(
    partiallyCertifiedLive.discovery.marketplaceCertification,
  )
  const partiallyCertifiedMonitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    partiallyCertifiedLive,
    NOW,
  )
  assert.equal(partiallyCertifiedMonitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_ITEM")?.status, "PARTIAL")
  assert.equal(partiallyCertifiedMonitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_MY_EBAY_SELLING")?.status, "AVAILABLE")
})

test("fallo GetItem no degrada falsamente el reader seller-wide", async () => {
  const live = await run(fakeEbay({
    sellerSiteOmitted: true,
    getItemHttpFailure: true,
  }))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_MY_EBAY_SELLING")?.status, "AVAILABLE")
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_ITEM")?.status, "ERROR")
})

test("Site seller-wide nunca sustituye GetItem y cero exige enumeración certificada", async () => {
  const explicit = fakeEbay()
  const explicitResult = await run(explicit)
  assert.equal(explicitResult.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceCertifiedUs, 1)
  assert.equal(explicit.calls.filter((call) =>
    call.tradingCall === "GetItem").length, 1)
  assert.equal(explicitResult.discovery.listings[0]
    .marketplaceCertification.source, "EBAY_TRADING_GET_ITEM")

  const zero = fakeEbay({ zeroReportedItems: true })
  const zeroResult = await run(zero)
  assert.equal(zeroResult.discovery.marketplaceCertification
    .sellerWideItemsReported, 0)
  assert.equal(zeroResult.discovery.marketplaceCertification
    .sellerWideItemsParsed, 0)
  assert.equal(zeroResult.discovery.marketplaceCertification
    .sellerWideItemsRepresented, 0)
  assert.equal(zero.calls.some((call) => call.tradingCall === "GetItem"), false)
  assert.equal(zeroResult.discovery.gapCodes.includes(
    "SELLER_WIDE_LISTING_MARKETPLACE_UNPROVEN_OR_NON_US",
  ), false)

  const invalidZero = await run(fakeEbay({
    invalidItemIdentityWithZeroTotal: true,
  }))
  assert.equal(invalidZero.discovery.marketplaceCertification
    .sellerWideItemsReported, 0)
  assert.equal(invalidZero.discovery.coverage, "PARTIAL")
  assert.ok(invalidZero.discovery.gapCodes.includes(
    "SELLER_WIDE_SOURCE_IDENTITY_CONFLICT",
  ))
})

test("continuación Inventory contradictoria falla cerrada", async () => {
  const fake = fakeEbay({ inventoryNextConflict: true })
  const result = await run(fake)
  assert.equal(result.discovery.inventory.status, "UNAVAILABLE")
  assert.ok(result.discovery.inventory.gapCodes.includes(
    "INVENTORY_SOURCE_FORMAT_CHANGED",
  ))
})

test("fallo Inventory posterior conserva listings publicados previos", async () => {
  const fake = fakeEbay({ inventorySecondPageFails: true })
  const result = await run(fake)
  assert.deepEqual(fake.calls.filter((call) =>
    call.path === "/sell/inventory/v1/inventory_item").map((call) =>
      call.search), ["?limit=50&offset=0", "?limit=50&offset=1"])
  assert.equal(result.discovery.inventory.status, "PARTIAL")
  assert.deepEqual(result.discovery.inventory.publishedListingIds, [
    "123456789012",
  ])
  assert.ok(result.discovery.inventory.gapCodes.some((code) =>
    code.includes("503") || code.includes("PAGE_READ_FAILED")))
  assert.equal(result.discovery.inventoryRepresentation.status, "PARTIAL")
  assert.equal(result.discovery.inventoryRepresentation.representedCount, 1)
  assert.equal(result.discovery.inventoryRepresentation.notRepresentedCount,
    null)
  assert.equal(result.discovery.inventoryRepresentation.sourceUnprovenCount, 0)
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    result,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryCapability.status,
    "AVAILABLE")
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryCapability
    .sourceReadStatus, "PARTIAL")
  assert.equal(monitor.accountDataQualityIssues.some((issue) =>
    issue.source === "EBAY_SELL_INVENTORY_READONLY" &&
    issue.code === "SOURCE_UNAVAILABLE"), false)
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

test("Analytics convierte warnings opacos en gap sin exponer su payload", async () => {
  const result = await run(fakeEbay({ analyticsOpaqueWarning: true }))
  assert.equal(result.analytics.status, "PARTIAL")
  assert.equal(result.analytics.analyticsRequestedItemCount, 1)
  assert.equal(result.analytics.analyticsRepresentedItemCount, 1)
  assert.equal(result.analytics.analyticsMissingItemCount, 0)
  assert.equal(result.analytics.analyticsCoverageStatus, "PARTIAL")
  assert.ok(result.analytics.gapCodes.includes(
    "ANALYTICS_SOURCE_WARNING_REPORTED",
  ))
  assert.doesNotMatch(
    JSON.stringify(result),
    /opaque-private-warning-marker-test-only|error_description/i,
  )
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
  assert.equal(inventory.discovery.inventory.status, "UNAVAILABLE")
  assert.ok(inventory.discovery.inventory.gapCodes.includes(
    "INVENTORY_SOURCE_FORMAT_CHANGED",
  ))
  const booleanTotal = await run(fakeEbay({ inventoryBooleanTotal: true }))
  assert.equal(booleanTotal.discovery.inventory.status, "UNAVAILABLE")
  assert.ok(booleanTotal.discovery.inventory.gapCodes.includes(
    "INVENTORY_SOURCE_FORMAT_CHANGED",
  ))
  const wrongContentType = await run(fakeEbay({
    inventoryNonJsonContentType: true,
  }))
  assert.equal(wrongContentType.discovery.inventory.status, "UNAVAILABLE")
  assert.ok(wrongContentType.discovery.inventory.gapCodes.includes(
    "INVENTORY_SOURCE_FORMAT_CHANGED",
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

test("XML 2xx ilegible marca la llamada Trading exacta como FAILED", async () => {
  const getUser = await run(fakeEbay({ getUserTextFailure: true }))
  assert.equal(getUser.calls.find((call) =>
    call.operation === "TRADING_GET_USER")?.status, "FAILED")
  assert.equal(getUser.account.status, "BLOCKED")

  const discovery = await run(fakeEbay({ discoveryTextFailure: true }))
  assert.equal(discovery.calls.find((call) =>
    call.operation === "TRADING_GET_MY_EBAY_SELLING")?.status, "FAILED")
  assert.equal(discovery.account.status, "CERTIFIED")
  assert.equal(discovery.discovery.status, "UNAVAILABLE")
  assert.doesNotMatch(JSON.stringify(discovery),
    /private-text-stream-error-test-only/i)
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

test("OAuth Inventory 400 expone sólo categoría allowlisted y nunca descripción", async () => {
  const cases = [
    ["invalid_scope", "INVALID_SCOPE"],
    ["invalid_grant", "INVALID_GRANT"],
    ["invalid_client", "INVALID_CLIENT"],
    ["invalid_request", "INVALID_REQUEST"],
    ["unsupported_grant_type", "UNSUPPORTED_GRANT_TYPE"],
    ["unexpected_private_error", "OAUTH_ERROR_UNCLASSIFIED"],
  ]
  for (const [error, category] of cases) {
    const fake = fakeEbay({ inventoryOauthError: error })
    const result = await run(fake)
    const expected = `EBAY_MONITOR_OAUTH_REFRESH_INVENTORY_${category}`
    assert.equal(result.discovery.inventory.status, "UNAVAILABLE", error)
    assert.ok(result.discovery.inventory.gapCodes.includes(expected), error)
    assert.equal(result.discovery.listings.length, 1, error)
    assert.equal(result.analytics.status, "CERTIFIED", error)
    const call = result.calls.find((entry) =>
      entry.operation === "OAUTH_REFRESH_INVENTORY")
    assert.equal(call?.status, "FAILED", error)
    assert.equal(call?.httpStatus, 400, error)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /private-oauth-description-test-only/i)
    assert.doesNotMatch(serialized, /error_description/i)
    assert.equal(result.safety.marketplaceWrites, 0)
    assert.equal(result.safety.databaseWrites, 0)
  }

  const malformed = fakeEbay({
    inventoryOauthError: "unexpected_private_error",
    inventoryOauthMalformedBody: true,
  })
  const malformedResult = await run(malformed)
  assert.ok(malformedResult.discovery.inventory.gapCodes.includes(
    "EBAY_MONITOR_OAUTH_REFRESH_INVENTORY_OAUTH_ERROR_UNCLASSIFIED",
  ))
  assert.doesNotMatch(
    JSON.stringify(malformedResult),
    /not-json-private-oauth-test-only/i,
  )
  const invalidScopeLive = await run(fakeEbay({
    inventoryOauthError: "invalid_scope",
  }))
  const invalidScopeMonitor = await getCommercialMonitorReadonly(
    fakeSupabase(),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    invalidScopeLive,
    NOW,
  )
  assert.equal(invalidScopeMonitor.liveCertification.inventory
    .oauthSafeErrorCategory, "INVALID_SCOPE")
  assert.equal(invalidScopeMonitor.alertCandidates.find((alert) =>
    alert.listingReference.itemId === null &&
    alert.reasonCode === "DATA_COVERAGE_FAILURE")?.severity, "HIGH")
  assert.doesNotMatch(
    JSON.stringify(invalidScopeMonitor),
    /private-oauth-description-test-only|error_description/i,
  )
})

test("presupuesto total corta readers downstream sin perder discovery", async () => {
  const fake = fakeEbay()
  const result = await run(fake, {
    readLimits: { maximumCalls: 3, budgetMs: 10_000 },
  })
  assert.equal(result.calls.length, 3)
  assert.equal(result.discovery.listings.length, 0)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsParsed, 1)
  assert.equal(result.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 1)
  assert.equal(result.discovery.sellerWideEnumeration.identities.length, 1)
  assert.equal(result.discovery.sellerWideEnumeration.itemSetComplete, true)
  assert.equal(result.discovery.gapCodes.includes(
    "SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED",
  ), false)
  assert.equal(result.discovery.gapCodes.includes(
    "UNEXPLAINED_LISTING_RECONCILIATION_GAP",
  ), false)
  assert.equal(result.analytics.status, "UNAVAILABLE")
  assert.equal(result.orders.status, "UNAVAILABLE")
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("DTO final conserva live, error SELECT y excluye PII/secretos", async () => {
  const fake = fakeEbay({ sellerSiteOmitted: true })
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
  assert.deepEqual(monitor.listings[0].identity.marketplaceCertification, {
    status: "US_CERTIFIED",
    source: "EBAY_TRADING_GET_ITEM",
    observedAt: NOW.toISOString(),
    grain: "ITEM",
  })
  assert.equal(monitor.listings[0].metrics.impressions.value, 10)
  assert.equal(monitor.listings[0].metrics.impressions.grain, "ITEM")
  assert.equal(monitor.listings[0].productCase.status, "UNPROVEN")
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_ACTIVE_LISTING_REGISTRY")?.status, "ERROR")
  assert.equal(monitor.listings[0].discovery.livePresence.status, "LIVE_ACTIVE")
  assert.equal(monitor.listings[0].discovery.registryStatus, "UNPROVEN")
  assert.equal(monitor.listings[0].blockers.some((blocker) =>
    blocker.code === "REGISTRY_RECONCILIATION_FAILED"), false)
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId !== null).length, 0)
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId === null).length, 1)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry.status,
    "UNPROVEN")
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryIdentitiesNotInSellerWideEnumerationCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedIdentitiesNotInRegistryCount, null)
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "EBAY_TRADING_GET_ITEM")?.status, "AVAILABLE")
  assert.equal(
    monitor.liveCertification.analytics.analyticsRequestedItemCount,
    1,
  )
  assert.equal(
    monitor.liveCertification.analytics.analyticsRepresentedItemCount,
    1,
  )
  assert.equal(monitor.liveCertification.analytics.analyticsMissingItemCount, 0)
  assert.equal(
    monitor.liveCertification.analytics.analyticsCoverageStatus,
    "COMPLETE",
  )
  assert.equal(monitor.liveCertification.inventory.status, "AVAILABLE")
  assert.equal(monitor.liveCertification.inventory.inventorySkuCount, 0)
  assert.equal(monitor.liveCertification.inventory.publishedListingCount, 0)
  assert.equal(monitor.liveCertification.inventory.oauthSafeErrorCategory, null)
  assert.ok(monitor.discoveryCoverage.sources.includes(
    "EBAY_TRADING_GET_ITEM",
  ))
  const serialized = JSON.stringify(monitor)
  assert.doesNotMatch(serialized, /sellerWideEnumeration/)
  assert.doesNotMatch(serialized, /currentLiveListings/)
  assert.doesNotMatch(serialized, /representationEligible/)
  assert.doesNotMatch(serialized, /analyticsEligible/)
  assert.doesNotMatch(serialized, /responseLocalLive/)
  assert.doesNotMatch(serialized, /RESPONSE_LOCAL_LIVE_PRESENCE/)
  for (const forbidden of [
    "private@example.invalid",
    "ephemeral-access-token-test-only",
    "seller-refresh-test-only",
    "orders-refresh-test-only",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})

test("Item enumerado con presupuesto agotado no se vuelve US ni registry-only", async () => {
  const live = await run(fakeEbay(), {
    readLimits: { maximumCalls: 3, budgetMs: 10_000 },
  })
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [activeRegistryRow()],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(live.discovery.listings.length, 0)
  assert.equal(live.analytics.analyticsRequestedItemCount, 0)
  assert.equal(live.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 1)
  assert.ok(live.discovery.gapCodes.includes(
    "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
  ))
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ), false)
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId === null).length, 1)
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId !== null).length, 0)
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ), false)
  assert.deepEqual(monitor.discoveryCoverage.reconciliation?.registry, {
    status: "PARTIAL",
    activeRegistryItemCount: 1,
    activeRegistryIdentityCount: 1,
    activeRegistryItemsNotInSellerWideEnumerationCount: 0,
    liveUsCertifiedItemsNotInRegistryCount: 0,
    activeRegistryIdentitiesNotInSellerWideEnumerationCount: 0,
    liveUsCertifiedIdentitiesNotInRegistryCount: 0,
    itemGrain: "ITEM_ID",
    identityGrain: "ITEM_SKU_VARIATION",
  })
  assert.equal(monitor.discoveryCoverage.reconciliation?.sellerWide
    .reportedParsedInvariant, "PASS")
  assert.equal(monitor.discoveryCoverage.reconciliation?.sellerWide
    .partitionInvariant, "PASS")
  assert.equal(monitor.listings.find((listing) =>
    listing.identity.itemId === "123456789012")?.identity
    .marketplaceCertification.status, "UNPROVEN")
  assert.equal(monitor.liveCertification.inventory.status, "UNAVAILABLE")
  assert.equal(monitor.liveCertification.inventory.inventorySkuCount, null)
  const accountCoverageAlert = monitor.alertCandidates.find((alert) =>
    alert.listingReference.itemId === null &&
    alert.reasonCode === "DATA_COVERAGE_FAILURE")
  assert.equal(accountCoverageAlert?.freshness.status, "UNKNOWN")
  assert.equal(accountCoverageAlert?.freshness.capturedAt, NOW.toISOString())
})

test("identidad ambigua no crea gap exacto pero un Item ausente sí", async () => {
  const live = await run(fakeEbay({
    repeatedItemWithoutVariationIdentity: true,
  }))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [
        activeRegistryRow({ sku: "BLUE-SKU" }),
        activeRegistryRow({
          itemId: "123456789099",
          sku: "REGISTRY-ONLY-SKU",
        }),
      ],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(live.discovery.listings.every((row) =>
    row.identityAmbiguous), true)
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ), false)
  assert.equal(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ), true)
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.registryCoverage.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedItemsNotInRegistryCount, 0)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedIdentitiesNotInRegistryCount, 0)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemsNotInSellerWideEnumerationCount, 1)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryIdentitiesNotInSellerWideEnumerationCount, null)
})

test("registry stale no se vuelve COMPLETE por evidencia live fresca", async () => {
  const live = await run(fakeEbay())
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [activeRegistryRow({
        at: "2026-07-30T15:00:00.000Z",
      })],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedItemsNotInRegistryCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemsNotInSellerWideEnumerationCount, null)
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.registryCoverage
    .evidenceFreshness, "STALE")
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "REGISTRY_EVIDENCE_STALE_OR_INVALID",
  ))
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ), false)
  assert.equal(monitor.discoveryCoverage.knownGapCodes.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ), false)
})

test("registry con timestamp faltante no produce ausencia autoritativa", async () => {
  const live = await run(fakeEbay())
  const missingTimestamp = activeRegistryRow({
    itemId: "123456789099",
    sku: "UNKNOWN-TIME-SKU",
  })
  missingTimestamp.last_ebay_sync_at = null
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [activeRegistryRow(), missingTimestamp],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemsNotInSellerWideEnumerationCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedItemsNotInRegistryCount, null)
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.registryCoverage
    .evidenceFreshness, "UNKNOWN")
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "REGISTRY_EVIDENCE_STALE_OR_INVALID",
  ))
})

test("frescura histórica exige todas las evidencias y no toma sólo la más nueva", async () => {
  const unavailable = await getEbayCommercialMonitorLiveReadonly({
    accountKey: ACCOUNT_KEY,
    accountAlias: ACCOUNT_ALIAS,
    environment: {},
    fetchImpl: async () => {
      throw new Error("FETCH_MUST_NOT_RUN")
    },
    clock: () => new Date(NOW),
  })
  const verification = (id, itemId, observedAt) => ({
    id,
    listing_id: itemId,
    expected_sku: `SKU-${id}`,
    observed_listing_id: itemId,
    observed_sku: `SKU-${id}`,
    observed_listing_status: "Active",
    item_id_matches: true,
    sku_matches: true,
    active_listing_confirmed: true,
    source: "EBAY_TRADING_GET_ITEM_READONLY",
    error_code: null,
    observed_at: observedAt,
  })
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      marketplace_listing_identity_verifications: [
        verification("fresh", "123456789012", "2026-08-08T15:00:00.000Z"),
        verification("stale", "123456789013", "2026-07-30T15:00:00.000Z"),
      ],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    unavailable,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.dimensions
    ?.historicalDiscoveryEvidence.freshness, "STALE")
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "HISTORICAL_DISCOVERY_EVIDENCE_STALE_OR_INVALID",
  ))
})

test("registry con Item inválido o timestamp futuro permanece no comparable", async () => {
  const live = await run(fakeEbay())
  const invalidIdentity = activeRegistryRow({ sku: "INVALID-ID-SKU" })
  invalidIdentity.ebay_item_id = "invalid-item-id"
  const futureEvidence = activeRegistryRow({
    itemId: "123456789099",
    sku: "FUTURE-SKU",
    at: "2026-08-10T15:00:00.000Z",
  })
  for (const row of [invalidIdentity, futureEvidence]) {
    const monitor = await getCommercialMonitorReadonly(
      fakeSupabase({
        ebay_active_listings: [activeRegistryRow(), row],
      }),
      { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
      live,
      NOW,
    )
    assert.equal(monitor.discoveryCoverage.reconciliation?.registry.status,
      "PARTIAL")
    assert.equal(monitor.discoveryCoverage.reconciliation?.registry
      .activeRegistryItemCount, null)
    assert.equal(monitor.discoveryCoverage.reconciliation?.registry
      .activeRegistryItemsNotInSellerWideEnumerationCount, null)
  }
})

test("discovery live no disponible produce null, nunca cero, contra registry", async () => {
  const live = await getEbayCommercialMonitorLiveReadonly({
    accountKey: ACCOUNT_KEY,
    accountAlias: ACCOUNT_ALIAS,
    environment: {},
    fetchImpl: async () => {
      throw new Error("FETCH_MUST_NOT_RUN")
    },
    clock: () => new Date(NOW),
  })
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedItemsNotInRegistryCount, null)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedIdentitiesNotInRegistryCount, null)
})

test("reconciliación conserva SKU opaco sin colapsar Unicode compatible", async () => {
  const fake = fakeEbay({ inventoryCompatibilitySku: true })
  const live = await run(fake)
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(live.discovery.gapCodes.includes(
    "INVENTORY_PUBLISHED_LISTING_NOT_IN_SELLER_WIDE_RESULT",
  ), true)
  assert.equal(monitor.discoveryCoverage.reconciliation?.inventory
    .inventoryOffersNotInSellerWideEnumerationCount, 1)
  assert.equal(monitor.discoveryCoverage.reconciliation?.inventory
    .liveUsCertifiedNotInInventoryCount, 1)
})

test("oferta Inventory adicional mantiene representación completa pero reconciliación parcial", async () => {
  const live = await run(fakeEbay({ inventoryExtraPublishedOffer: true }))
  assert.deepEqual(live.discovery.inventoryRepresentation, {
    status: "COMPLETE",
    classificationGrain: "ITEM_SKU",
    representedCount: 1,
    notRepresentedCount: 0,
    identityUnresolvedCount: 0,
    sourceUnprovenCount: 0,
  })
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ ebay_active_listings: [activeRegistryRow()] }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.dimensions?.inventoryRepresentation
    .status, "COMPLETE")
  assert.equal(monitor.discoveryCoverage.reconciliation?.inventory.status,
    "PARTIAL")
  assert.equal(monitor.discoveryCoverage.reconciliation?.inventory
    .inventoryOffersNotInSellerWideEnumerationCount, 1)
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "INVENTORY_PUBLISHED_LISTING_NOT_IN_SELLER_WIDE_RESULT",
  ))
  assert.equal(monitor.alertCandidates.filter((alert) =>
    alert.reasonCode === "DATA_COVERAGE_FAILURE" &&
    alert.listingReference.itemId === null).length, 1)
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
        raw_payload: {
          marketplaceSite: "US",
          marketplaceCertification: {
            status: "US_CERTIFIED",
            source: "EBAY_TRADING_GET_ITEM",
            observedAt: at,
            grain: "ITEM",
          },
        },
        sync_generation: null,
        created_at: at,
        updated_at: at,
      }],
      marketplace_listing_identity_verifications: [{
        id: "verification-stored-marketplace-unproven",
        listing_id: "123456789012",
        expected_sku: "WRONG-SKU",
        observed_listing_id: "123456789012",
        observed_sku: "WRONG-SKU",
        variation_key: null,
        observed_listing_status: "Active",
        item_id_matches: true,
        sku_matches: true,
        active_listing_confirmed: true,
        source: "EBAY_TRADING_GET_ITEM_READONLY",
        error_code: null,
        observed_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
  assert.equal(monitor.discoveryCoverage.dimensions?.registryCoverage.status,
    "PARTIAL")
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "LIVE_LISTING_NOT_IN_MANAGED_REGISTRY",
  ))
  assert.ok(monitor.discoveryCoverage.accountAlertReasons?.includes(
    "REGISTRY_LISTING_NOT_IN_LIVE_ACTIVE_ENUMERATION",
  ))
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryItemsNotInSellerWideEnumerationCount, 0)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedItemsNotInRegistryCount, 0)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .activeRegistryIdentitiesNotInSellerWideEnumerationCount, 1)
  assert.equal(monitor.discoveryCoverage.reconciliation?.registry
    .liveUsCertifiedIdentitiesNotInRegistryCount, 1)
  assert.equal(monitor.listings.find((listing) =>
    listing.identity.sku === "WRONG-SKU")?.identity
    .marketplaceCertification.status, "UNPROVEN")
  assert.equal(monitor.listings.find((listing) =>
    listing.identity.sku === "WRONG-SKU")?.discovery.livePresence.status,
  "UNPROVEN")
  assert.equal(monitor.listings.find((listing) =>
    listing.identity.sku === "WRONG-SKU")?.blockers.some((blocker) =>
      blocker.code === "LISTING_IDENTITY_UNPROVEN"), false)
})

test("un ID almacenado colisionante no hereda certificación live de otra identidad", async () => {
  const live = await run(fakeEbay())
  const liveListing = live.discovery.listings[0]
  const collidingId = `LIVE_LISTING:${hashEbayMonitorEvidenceIdentifier(
    JSON.stringify([
      liveListing.itemId,
      liveListing.variationKey,
      liveListing.sku,
      liveListing.observedAt,
    ]),
  )}`
  const storedItemId = "123456789099"
  const storedSku = "COLLISION-SKU"
  const at = "2026-08-08T15:00:00.000Z"
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({
      ebay_active_listings: [{
        id: collidingId,
        account_key: ACCOUNT_KEY,
        source: "EBAY_INVENTORY_API",
        ebay_item_id: storedItemId,
        ebay_sku: storedSku,
        ebay_variation_key: null,
        listing_status: "active",
        title: "Stored collision",
        ebay_quantity: null,
        ebay_price: null,
        currency: null,
        market_radar_product_id: null,
        supplier_variant_id: null,
        supplier_sku: null,
        supplier_cost_at_linking: null,
        last_ebay_sync_at: at,
        raw_payload: {
          marketplaceSite: "US",
          marketplaceCertification: {
            status: "US_CERTIFIED",
            source: "EBAY_TRADING_GET_ITEM",
            observedAt: at,
            grain: "ITEM",
          },
        },
        sync_generation: null,
        created_at: at,
        updated_at: at,
      }],
      marketplace_listing_identity_verifications: [{
        id: "verification-colliding-stored-id",
        listing_id: storedItemId,
        expected_sku: storedSku,
        observed_listing_id: storedItemId,
        observed_sku: storedSku,
        variation_key: null,
        observed_listing_status: "Active",
        item_id_matches: true,
        sku_matches: true,
        active_listing_confirmed: true,
        source: "EBAY_TRADING_GET_ITEM_READONLY",
        error_code: null,
        observed_at: at,
      }],
    }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  const storedListing = monitor.listings.find((listing) =>
    listing.identity.itemId === storedItemId)
  assert.equal(storedListing?.identity.marketplaceCertification.status,
    "UNPROVEN")
  assert.equal(storedListing?.discovery.livePresence.status,
    "STORED_ONLY_NOT_IN_CURRENT_LIVE_ENUMERATION")
  assert.equal(storedListing?.blockers.some((blocker) =>
    blocker.code === "LISTING_IDENTITY_UNPROVEN"), false)
  assert.equal(monitor.alertCandidates.some((alert) =>
    alert.listingReference.itemId === storedItemId), false)
})

test("enumeración seller-wide stale o futura no prueba ausencia de un Item almacenado", async () => {
  const baseline = await run(fakeEbay())
  for (const observedAt of [
    "2026-08-01T00:00:00.000Z",
    "2026-08-10T00:00:00.000Z",
  ]) {
    const live = structuredClone(baseline)
    live.discovery.observedAt = observedAt
    const storedItemId = "123456789099"
    const monitor = await getCommercialMonitorReadonly(
      fakeSupabase({
        ebay_active_listings: [activeRegistryRow({
          itemId: storedItemId,
          sku: "STORED-ONLY-SKU",
        })],
      }),
      { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
      live,
      NOW,
    )
    const stored = monitor.listings.find((listing) =>
      listing.identity.itemId === storedItemId)
    assert.equal(stored?.discovery.livePresence.status, "UNPROVEN")
    assert.equal(stored?.discovery.livePresence.source, null)
    assert.equal(monitor.discoveryCoverage.dimensions?.liveEnumeration.status,
      "PARTIAL")
    assert.equal(monitor.discoveryCoverage.status, "PARTIAL")
    assert.ok(monitor.discoveryCoverage.knownGapCodes.includes(
      "SELLER_WIDE_DISCOVERY_EVIDENCE_STALE_OR_INVALID",
    ))
    assert.equal(monitor.alertCandidates.some((alert) =>
      alert.listingReference.itemId === storedItemId), false)
  }
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
  live.discovery.currentLiveListings = structuredClone(live.discovery.listings)
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
  live.discovery.currentLiveListings = structuredClone(live.discovery.listings)
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
  live.discovery.currentLiveListings = structuredClone(live.discovery.listings)
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

test("snapshot parcial conserva evidencia sin reclasificar su fuente como unavailable", async () => {
  const live = await run(fakeEbay())
  const snapshots = Array.from({ length: 2_001 }, (_, index) => ({
    id: `partial-snapshot-${index}`,
    listing_id: "123456789012",
    sku: "LIVE-SKU",
    listing_status: "active",
    impressions: 1,
    views: 1,
    ctr: 1,
    transactions: 0,
    sales_conversion_rate: 0,
    revenue: null,
    current_watchers: null,
    stock_available: null,
    supplier_cost: null,
    estimated_margin_percent: null,
    observed_at: "2026-08-08T15:00:00.000Z",
    window_start: "2026-08-01T00:00:00.000Z",
    window_end: "2026-08-08T15:00:00.000Z",
    source: { analytics: "READ_ONLY_TEST" },
    completeness_status: "partial",
  }))
  const monitor = await getCommercialMonitorReadonly(
    fakeSupabase({ listing_commercial_snapshots: snapshots }),
    { accountKey: ACCOUNT_KEY, accountAlias: ACCOUNT_ALIAS },
    live,
    NOW,
  )
  assert.equal(monitor.connection.readers.find((reader) =>
    reader.source === "COMMERCIAL_SNAPSHOT_REGISTRY")?.status, "PARTIAL")
  assert.equal(monitor.listings[0].dataQualityIssues.some((issue) =>
    issue.source === "COMMERCIAL_SNAPSHOT_REGISTRY" &&
    issue.code === "SOURCE_UNAVAILABLE"), false)
  assert.equal(monitor.accountDataQualityIssues.some((issue) =>
    issue.source === "COMMERCIAL_SNAPSHOT_REGISTRY" &&
    issue.code === "SOURCE_UNAVAILABLE"), false)
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
