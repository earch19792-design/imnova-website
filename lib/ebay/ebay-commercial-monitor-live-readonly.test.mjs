import assert from "node:assert/strict"
import test from "node:test"

import {
  assertEbayMonitorReadonlyRequest,
  normalizeLiveDiscoveryCoverage,
  parseEbayTradingGetMyeBaySellingPage,
  parseEbayTradingGetUser,
  sanitizeLiveEbayOrders,
} from "./ebay-commercial-monitor-live-readonly-domain.ts"
import { canonicalizeActiveListingProtectionRows } from
  "./ebay-active-listing-protection-domain.ts"
import { normalizeEbaySellerTrafficRows } from
  "./ebay-seller-traffic-report.ts"

test("la allowlist acepta sólo endpoints y operaciones eBay read-only exactos", () => {
  assert.equal(assertEbayMonitorReadonlyRequest({
    operation: "TRADING_GET_MY_EBAY_SELLING",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetMyeBaySelling",
    tradingHeaderCallName: "GetMyeBaySelling",
    tradingBody: "<GetMyeBaySellingRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\" />",
  }), true)
  assert.equal(assertEbayMonitorReadonlyRequest({
    operation: "ANALYTICS_GET_TRAFFIC_REPORT",
    method: "GET",
    url: "https://api.ebay.com/sell/analytics/v1/traffic_report?dimension=LISTING",
  }), true)
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "TRADING_GET_MY_EBAY_SELLING",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "AddItem",
    tradingHeaderCallName: "AddItem",
    tradingBody: "<AddItemRequest />",
  }), /EBAY_MONITOR_BLOCKED_TRADING_OPERATION/)
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "TRADING_GET_USER",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetUser",
    tradingHeaderCallName: "ReviseItem",
    tradingBody: "<GetUserRequest />",
  }), /EBAY_MONITOR_BLOCKED_TRADING_OPERATION/)
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "TRADING_GET_USER",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetUser",
    tradingHeaderCallName: "GetUser",
    tradingBody: "<EndItemRequest />",
  }), /EBAY_MONITOR_BLOCKED_TRADING_OPERATION/)
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "INVENTORY_GET_ITEMS",
    method: "POST",
    url: "https://api.ebay.com/sell/inventory/v1/inventory_item",
  }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "FULFILLMENT_GET_ORDERS",
    method: "GET",
    url: "https://api.ebay.com/sell/fulfillment/v1/order/order-safe/create_shipping_fulfillment",
  }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
})

test("GetUser sólo expone identidad necesaria para binding", () => {
  const result = parseEbayTradingGetUser(`
    <GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <User><UserID>seller-safe-id</UserID><Site>US</Site><Email>private@example.invalid</Email></User>
    </GetUserResponse>
  `)
  assert.deepEqual(result, {
    accepted: true,
    userId: "seller-safe-id",
    site: "US",
  })
  assert.equal("email" in result, false)
  assert.equal(parseEbayTradingGetUser(`
    <GetUserResponse><Ack>Warning</Ack><User>
      <UserID>seller-safe-id</UserID><Site>US</Site>
    </User></GetUserResponse>
  `).accepted, false)
})

test("GetMyeBaySelling preserva Item, Custom Label, variaciones y null semántico", () => {
  const observedAt = "2026-08-08T16:00:00.000Z"
  const result = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <ActiveList>
        <PaginationResult>
          <TotalNumberOfPages>1</TotalNumberOfPages>
          <TotalNumberOfEntries>2</TotalNumberOfEntries>
        </PaginationResult>
        <HasMoreItems>false</HasMoreItems>
        <ItemArray>
          <Item>
            <ItemID>123456789012</ItemID>
            <Title>Listing real sanitizable</Title>
            <SKU>EXACT-SKU-1</SKU>
            <ListingType>FixedPriceItem</ListingType>
            <Site>US</Site>
            <Quantity>5</Quantity>
            <SellingStatus><QuantitySold>2</QuantitySold><CurrentPrice currencyID="USD">19.95</CurrentPrice></SellingStatus>
            <ListingDetails><StartTime>2026-08-01T10:00:00.000Z</StartTime></ListingDetails>
          </Item>
          <Item>
            <ItemID>123456789013</ItemID>
            <Title>Listing con variantes</Title>
            <ListingType>FixedPriceItem</ListingType>
            <Site>US</Site>
            <Variations>
              <Variation>
                <SKU>VAR-BLUE</SKU><Quantity>3</Quantity>
                <SellingStatus><QuantitySold>1</QuantitySold></SellingStatus>
                <StartPrice currencyID="USD">24.50</StartPrice>
                <VariationSpecifics><NameValueList><Name>Color</Name><Value>Blue</Value></NameValueList></VariationSpecifics>
              </Variation>
              <Variation>
                <SKU>VAR-RED</SKU><Quantity>2</Quantity>
                <StartPrice currencyID="USD">25.50</StartPrice>
                <VariationSpecifics><NameValueList><Name>Color</Name><Value>Red</Value></NameValueList></VariationSpecifics>
              </Variation>
            </Variations>
          </Item>
        </ItemArray>
      </ActiveList>
    </GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(result.accepted, true)
  assert.equal(result.totalEntries, 2)
  assert.equal(result.totalPages, 1)
  assert.equal(result.hasMoreItems, false)
  assert.equal(result.listings.length, 3)
  assert.deepEqual(result.listings.map((listing) => ({
    itemId: listing.itemId,
    sku: listing.sku,
    variationKey: listing.variationKey,
    quantity: listing.availableQuantity,
    price: listing.price,
    currency: listing.currency,
    site: listing.marketplaceSite,
  })), [
    {
      itemId: "123456789012",
      sku: "EXACT-SKU-1",
      variationKey: null,
      quantity: 3,
      price: 19.95,
      currency: "USD",
      site: "US",
    },
    {
      itemId: "123456789013",
      sku: "VAR-BLUE",
      variationKey: "Color=Blue",
      quantity: 2,
      price: 24.5,
      currency: "USD",
      site: "US",
    },
    {
      itemId: "123456789013",
      sku: "VAR-RED",
      variationKey: "Color=Red",
      quantity: null,
      price: 25.5,
      currency: "USD",
      site: "US",
    },
  ])
  assert.equal(parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Warning</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>0</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt).accepted, false)
  const nonUs = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789099</ItemID><Site>DE</Site>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(nonUs.listings[0].marketplaceSite, "DE")
})

test("variaciones Unicode sin SKU conservan identidades separadas", () => {
  const observedAt = "2026-08-08T16:00:00.000Z"
  const parsed = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789014</ItemID><Title>Variantes</Title><Site>US</Site>
        <Variations>
          <Variation><VariationSpecifics><NameValueList><Name>Tamaño &amp; estilo</Name><Value>Niño (azul) #1</Value></NameValueList></VariationSpecifics></Variation>
          <Variation><VariationSpecifics><NameValueList><Name>Tamaño &amp; estilo</Name><Value>Niña (rojo) #2</Value></NameValueList></VariationSpecifics></Variation>
        </Variations>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(parsed.listings.length, 2)
  assert.equal(parsed.listings.every((listing) => listing.sku === null), true)
  assert.equal(new Set(parsed.listings.map((listing) =>
    listing.variationKey)).size, 2)
  const groups = canonicalizeActiveListingProtectionRows(
    parsed.listings.map((listing, index) => ({
      id: `live-${index}`,
      account_key: "seller:scope",
      source: listing.source,
      ebay_item_id: listing.itemId,
      ebay_sku: listing.sku,
      ebay_variation_key: listing.variationKey,
      listing_status: "active",
      last_ebay_sync_at: listing.observedAt,
    })),
  )
  assert.equal(groups.length, 2)
  assert.equal(groups.every((group) => group.ebaySku === null), true)
})

test("SKU no sustituye una identidad de variación ausente", () => {
  const parsed = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789015</ItemID><Site>US</Site><Variations>
          <Variation><SKU>BLUE-SKU</SKU></Variation>
          <Variation><SKU>RED-SKU</SKU></Variation>
        </Variations>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, "2026-08-08T16:00:00.000Z")
  assert.equal(parsed.listings.length, 2)
  assert.equal(parsed.listings.every((listing) =>
    listing.identityAmbiguous === true), true)
})

test("Analytics conserva vacío como null y sólo acepta cero explícito", () => {
  const normalized = normalizeEbaySellerTrafficRows({
    header: {
      dimensionKeys: [{ key: "LISTING" }],
      metrics: [
        { key: "TOTAL_IMPRESSION_TOTAL" },
        { key: "LISTING_VIEWS_TOTAL" },
        { key: "TRANSACTION" },
      ],
    },
    records: [{
      dimensionValues: [{ value: "123456789012" }],
      metricValues: [
        { value: "", applicable: true },
        { value: "   ", applicable: true },
        { value: "0", applicable: true },
      ],
    }],
  })
  assert.deepEqual(normalized.rows[0].metrics, {
    TOTAL_IMPRESSION_TOTAL: null,
    LISTING_VIEWS_TOTAL: null,
    TRANSACTION: 0,
  })
  const missingApplicability = normalizeEbaySellerTrafficRows({
    header: {
      dimensionKeys: [{ key: "LISTING" }],
      metrics: [{ key: "TOTAL_IMPRESSION_TOTAL" }],
    },
    records: [{
      dimensionValues: [{ value: "123456789012" }],
      metricValues: [{ value: "9" }],
    }],
  })
  assert.equal(
    missingApplicability.rows[0].applicability.TOTAL_IMPRESSION_TOTAL,
    false,
  )
})

test("discovery nunca llama COMPLETE si faltan páginas o reconciliación", () => {
  assert.deepEqual(normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: 2,
    reachedPageLimit: false,
    pageFailed: false,
    inventoryCompared: true,
    registryCompared: true,
    unexplainedDifferenceCount: 0,
  }), { status: "COMPLETE", gapCodes: [] })
  const partial = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 2,
    totalEntries: 25000,
    reachedPageLimit: true,
    pageFailed: false,
    inventoryCompared: false,
    registryCompared: false,
    unexplainedDifferenceCount: 1,
  })
  assert.equal(partial.status, "PARTIAL")
  assert.ok(partial.gapCodes.includes("GET_MY_EBAY_SELLING_25000_LIMIT"))
  assert.ok(partial.gapCodes.includes("SELLER_WIDE_PAGINATION_UNPROVEN"))
  assert.ok(partial.gapCodes.includes("INVENTORY_RECONCILIATION_UNAVAILABLE"))
  assert.ok(partial.gapCodes.includes("REGISTRY_RECONCILIATION_UNAVAILABLE"))
  const contradictory = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: 1,
    reachedPageLimit: false,
    pageFailed: false,
    paginationMetadataConflict: true,
    ambiguousVariationIdentity: true,
    marketplaceScopeConflict: true,
    inventoryCompared: true,
    registryCompared: true,
    unexplainedDifferenceCount: 0,
  })
  assert.equal(contradictory.status, "PARTIAL")
  assert.ok(contradictory.gapCodes.includes(
    "SELLER_WIDE_PAGINATION_METADATA_CONFLICT",
  ))
  assert.ok(contradictory.gapCodes.includes(
    "SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS",
  ))
  assert.ok(contradictory.gapCodes.includes(
    "SELLER_WIDE_LISTING_MARKETPLACE_UNPROVEN_OR_NON_US",
  ))
})

test("orders descarta PII, cancelaciones y cantidades no probadas", () => {
  const safe = sanitizeLiveEbayOrders({
    orders: [{
      orderId: "order-safe-1",
      creationDate: "2026-08-08T10:00:00.000Z",
      lastModifiedDate: "2026-08-08T11:00:00.000Z",
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      buyer: {
        username: "private-buyer",
        email: "private@example.invalid",
      },
      fulfillmentStartInstructions: [{
        shippingStep: { shipTo: { fullName: "Private Buyer", phoneNumber: "000" } },
      }],
      pricingSummary: { total: { value: false, currency: "USD" } },
      lineItems: [{
        lineItemId: "line-safe-1",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
        sku: "EXACT-SKU-1",
        quantity: 1,
        title: "No se proyecta",
        lineItemCost: { value: false, currency: "USD" },
      }, {
        lineItemId: "line-missing-quantity",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
      }, {
        lineItemId: "line-other-marketplace",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_DE",
        quantity: 1,
      }],
    }, {
      orderId: "order-cancelled",
      creationDate: "2026-08-08T10:00:00.000Z",
      lastModifiedDate: "2026-08-08T11:00:00.000Z",
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      cancelStatus: { cancelState: "CANCELLED" },
      lineItems: [{
        lineItemId: "line-cancelled",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
        quantity: 1,
      }],
    }],
  })
  assert.equal(safe.length, 1)
  assert.equal(safe[0].lineItems.length, 1)
  assert.equal(safe[0].lineItems[0].quantity, 1)
  assert.equal(safe[0].totalAmount, null)
  assert.equal(safe[0].lineItems[0].lineItemAmount, null)
  const serialized = JSON.stringify(safe)
  for (const forbidden of [
    "buyer", "email", "address", "phone", "fullName", "Private Buyer",
    "private@example.invalid", "title", "raw",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})
