import assert from "node:assert/strict"
import test from "node:test"

import {
  assertEbayMonitorReadonlyRequest,
  normalizeLiveDiscoveryCoverage,
  parseEbayInventoryItemsPage,
  parseSafeEbayInventoryErrorMetadata,
  parseEbayTradingGetItemMarketplace,
  parseEbayTradingGetMyeBaySellingPage,
  parseEbayTradingGetSellerListPage,
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
    operation: "TRADING_GET_ITEM_MARKETPLACE",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetItem",
    tradingHeaderCallName: "GetItem",
    tradingBody: "<GetItemRequest><ItemID>123456789012</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector><OutputSelector>Item.GalleryURL</OutputSelector><OutputSelector>Item.PictureDetails.PictureURL</OutputSelector></GetItemRequest>",
  }), true)
  assert.equal(assertEbayMonitorReadonlyRequest({
    operation: "TRADING_GET_SELLER_LIST",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetSellerList",
    tradingHeaderCallName: "GetSellerList",
    tradingBody: "<GetSellerListRequest><EndTimeFrom>2026-08-21T00:00:00.000Z</EndTimeFrom><EndTimeTo>2026-12-18T00:00:00.000Z</EndTimeTo><GranularityLevel>Fine</GranularityLevel><IncludeVariations>true</IncludeVariations><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerListRequest>",
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
    operation: "TRADING_GET_ITEM_MARKETPLACE",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetItem",
    tradingHeaderCallName: "GetItem",
    tradingBody: "<GetItemRequest><ItemID>123456789012</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>",
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
    operation: "TRADING_GET_ITEM_MARKETPLACE",
    method: "POST",
    url: "https://api.ebay.com/ws/api.dll",
    tradingCallName: "GetItem",
    tradingHeaderCallName: "GetItem",
    tradingBody: "<GetItemRequest><ItemID>123456789012</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector><OutputSelector>Item.Seller</OutputSelector></GetItemRequest>",
  }), /EBAY_MONITOR_BLOCKED_TRADING_OPERATION/)
  for (const tradingBody of [
    "<GetItemRequest><ItemID>123456789012</ItemID><ItemID>123456789013</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector></GetItemRequest>",
    "<GetItemRequest><Container><ItemID>123456789012</ItemID></Container><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector></GetItemRequest>",
    "<GetItemRequest><ItemID>123456789012</ItemID><Container><OutputSelector>Item.ItemID</OutputSelector></Container><OutputSelector>Item.Site</OutputSelector></GetItemRequest>",
    "<GetItemRequest><ItemID>123456789012</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector></GetItemRequest><GetItemRequest><ItemID>123456789013</ItemID><OutputSelector>Item.ItemID</OutputSelector><OutputSelector>Item.Site</OutputSelector></GetItemRequest>",
  ]) {
    assert.throws(() => assertEbayMonitorReadonlyRequest({
      operation: "TRADING_GET_ITEM_MARKETPLACE",
      method: "POST",
      url: "https://api.ebay.com/ws/api.dll",
      tradingCallName: "GetItem",
      tradingHeaderCallName: "GetItem",
      tradingBody,
    }), /EBAY_MONITOR_BLOCKED_TRADING_OPERATION/)
  }
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "INVENTORY_GET_ITEMS",
    method: "POST",
    url: "https://api.ebay.com/sell/inventory/v1/inventory_item",
  }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
  assert.equal(assertEbayMonitorReadonlyRequest({
    operation: "INVENTORY_GET_ITEMS",
    method: "GET",
    url: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=0",
    marketplaceIdHeader: "EBAY_US",
    requestHeaderNames: ["authorization", "x-ebay-c-marketplace-id"],
  }), true)
  for (const url of [
    "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50",
    "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=200&offset=0",
    "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=0&sku=PRIVATE",
  ]) {
    assert.throws(() => assertEbayMonitorReadonlyRequest({
      operation: "INVENTORY_GET_ITEMS",
      method: "GET",
      url,
      marketplaceIdHeader: "EBAY_US",
      requestHeaderNames: ["authorization", "x-ebay-c-marketplace-id"],
    }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
  }
  assert.throws(() => assertEbayMonitorReadonlyRequest({
    operation: "FULFILLMENT_GET_ORDERS",
    method: "GET",
    url: "https://api.ebay.com/sell/fulfillment/v1/order/order-safe/create_shipping_fulfillment",
  }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
})

test("la matriz Inventory A-D conserva allowlists dedicadas exactas", () => {
  const endpoint =
    "https://api.ebay.com/sell/inventory/v1/inventory_item"
  const variants = [{
    operation: "INVENTORY_GET_ITEMS_MATRIX_A",
    url: `${endpoint}?limit=50&offset=0`,
    marketplaceIdHeader: "EBAY_US",
    requestHeaderNames: ["x-ebay-c-marketplace-id", "authorization"],
  }, {
    operation: "INVENTORY_GET_ITEMS_MATRIX_B",
    url: `${endpoint}?limit=50&offset=0`,
    marketplaceIdHeader: null,
    requestHeaderNames: ["authorization"],
  }, {
    operation: "INVENTORY_GET_ITEMS_MATRIX_C",
    url: `${endpoint}?limit=50`,
    marketplaceIdHeader: null,
    requestHeaderNames: ["authorization"],
  }, {
    operation: "INVENTORY_GET_ITEMS_MATRIX_D",
    url: endpoint,
    marketplaceIdHeader: null,
    requestHeaderNames: ["authorization"],
  }, {
    operation: "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",
    url: endpoint,
    marketplaceIdHeader: null,
    requestHeaderNames: ["authorization"],
  }]

  for (const variant of variants) {
    assert.equal(assertEbayMonitorReadonlyRequest({
      ...variant,
      method: "GET",
    }), true)
  }

  const blockedVariants = [{
    ...variants[0],
    marketplaceIdHeader: null,
  }, {
    ...variants[0],
    requestHeaderNames: [
      "accept", "authorization", "x-ebay-c-marketplace-id",
    ],
  }, {
    ...variants[0],
    url: `${endpoint}?limit=50`,
  }, {
    ...variants[0],
    url: `${endpoint}?limit=50&offset=1`,
  }, {
    ...variants[1],
    marketplaceIdHeader: "EBAY_US",
    requestHeaderNames: ["authorization", "x-ebay-c-marketplace-id"],
  }, {
    ...variants[1],
    requestHeaderNames: ["authorization", "content-language"],
  }, {
    ...variants[1],
    url: `${endpoint}?limit=50&offset=1`,
  }, {
    ...variants[2],
    url: `${endpoint}?limit=50&offset=0`,
  }, {
    ...variants[2],
    requestHeaderNames: ["authorization", "content-type"],
  }, {
    ...variants[3],
    url: `${endpoint}?limit=50`,
  }, {
    ...variants[3],
    requestHeaderNames: ["accept", "authorization"],
  }, {
    ...variants[4],
    url: `${endpoint}?offset=0`,
  }]
  for (const variant of blockedVariants) {
    assert.throws(() => assertEbayMonitorReadonlyRequest({
      ...variant,
      method: "GET",
    }), /EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST/)
  }
})

test("el error Inventory conserva sólo metadata estructural segura", () => {
  const forbiddenValues = [
    "PRIVATE_MESSAGE_VALUE",
    "PRIVATE_LONG_MESSAGE_VALUE",
    "PRIVATE_INPUT_REFERENCE",
    "PRIVATE_OUTPUT_REFERENCE",
    "PRIVATE_PARAMETER_VALUE",
  ]
  const classified = parseSafeEbayInventoryErrorMetadata({
    errors: [{
      errorId: 25702,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: forbiddenValues[0],
      longMessage: forbiddenValues[1],
      inputRefIds: [forbiddenValues[2]],
      outputRefIds: [forbiddenValues[3]],
      parameters: [{
        name: "sku",
        value: forbiddenValues[4],
      }, {
        name: "request.headers[0]",
      }],
    }, {
      errorId: 1001,
      domain: "API_INVENTORY",
      category: "BUSINESS",
      parameters: [{ name: "sku" }],
    }],
  })
  assert.deepEqual(classified, {
    status: "CLASSIFIED",
    errorObjectCount: 2,
    errorIds: ["1001", "25702"],
    domains: ["API_INVENTORY"],
    categories: ["BUSINESS", "REQUEST"],
    parameterNames: ["request.headers[0]", "sku"],
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: "OTHER",
    MESSAGE_SUFFIX_CLASS: "OTHER",
    MESSAGE_LENGTH_BUCKET: "0_31",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
  })
  const serialized = JSON.stringify(classified)
  for (const forbidden of forbiddenValues) {
    assert.doesNotMatch(serialized, new RegExp(forbidden))
  }
  for (const forbiddenField of [
    "message", "longMessage", "inputRefIds", "outputRefIds", "value",
  ]) {
  assert.equal(Object.hasOwn(classified, forbiddenField), false)
  }

  assert.deepEqual(parseSafeEbayInventoryErrorMetadata({
    errorId: 7,
    domain: "API_INVENTORY",
    category: "REQUEST",
  }), {
    status: "CLASSIFIED",
    errorObjectCount: 1,
    errorIds: ["7"],
    domains: ["API_INVENTORY"],
    categories: ["REQUEST"],
    parameterNames: [],
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: "OTHER",
    MESSAGE_SUFFIX_CLASS: "OTHER",
    MESSAGE_LENGTH_BUCKET: "0_31",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
  })

  const unproven = {
    status: "UNPROVEN",
    errorObjectCount: null,
    errorIds: [],
    domains: [],
    categories: [],
    parameterNames: [],
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: "OTHER",
    MESSAGE_SUFFIX_CLASS: "OTHER",
    MESSAGE_LENGTH_BUCKET: "0_31",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
  }
  for (const payload of [
    null,
    [],
    {},
    { errors: [] },
    { errors: [{
      errorId: 7,
      domain: "API_INVENTORY",
      category: "REQUEST",
    }], unexpected: true },
    { errorId: "7", domain: "API_INVENTORY", category: "REQUEST" },
    { errorId: 2_147_483_648, domain: "API_INVENTORY", category: "REQUEST" },
    { errorId: 7, domain: "unsafe domain", category: "REQUEST" },
    { errorId: 7, domain: "API_INVENTORY", category: "REQUEST", raw: true },
    { errorId: 7, domain: "API_INVENTORY", category: "REQUEST",
      parameters: {} },
    { errorId: 7, domain: "API_INVENTORY", category: "REQUEST",
      parameters: [{ value: "PRIVATE_PARAMETER_VALUE" }] },
    { errorId: 7, domain: "API_INVENTORY", category: "REQUEST",
      parameters: [{ name: "unsafe parameter name" }] },
    { errors: Array.from({ length: 11 }, (_, index) => ({
      errorId: index + 1,
      domain: "API_INVENTORY",
      category: "REQUEST",
    })) },
  ]) {
    assert.deepEqual(parseSafeEbayInventoryErrorMetadata(payload), unproven)
  }
})

test("clasifica errorId 25709 por plantilla de mensaje sin exponer texto", () => {
  const fixture = {
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
  }
  assert.deepEqual(parseSafeEbayInventoryErrorMetadata({
    ...fixture,
    message: "Invalid value for offset.",
  }), {
    status: "CLASSIFIED",
    errorObjectCount: 1,
    errorIds: ["25709"],
    domains: ["API_INVENTORY"],
    categories: ["REQUEST"],
    parameterNames: [],
    ERROR_25709_FIELD_NAME: "offset",
    ERROR_25709_MESSAGE_FORM: "SUBSTITUTED_FIELD",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "YES",
    ERROR_25709_SAFE_FIELD_CLASS: "OFFSET",
    MESSAGE_PREFIX_CLASS: "EXACT_INVALID_VALUE_FOR",
    MESSAGE_SUFFIX_CLASS: "PERIOD",
    MESSAGE_LENGTH_BUCKET: "0_31",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "YES",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "YES",
  })
  const serialized = JSON.stringify(parseSafeEbayInventoryErrorMetadata({
    ...fixture,
    message: "Invalid value for offset.",
  }))
  assert.equal(serialized.includes("Invalid value for offset."), false)
})

test("clasifica mensajes de error 25709 por forma", () => {
  const cases = [
    {
      message: "Invalid value for offset.",
      expectedField: "offset",
      expectedForm: "SUBSTITUTED_FIELD",
      expectedExtracted: "YES",
    },
    {
      message: "Invalid value for limit.",
      expectedField: "limit",
      expectedForm: "SUBSTITUTED_FIELD",
      expectedExtracted: "YES",
    },
    {
      message: "Invalid value for Content-Language.",
      expectedField: "Content-Language",
      expectedForm: "SUBSTITUTED_FIELD",
      expectedExtracted: "YES",
    },
    {
      message: "Invalid value for {fieldName}.",
      expectedField: "UNPROVEN",
      expectedForm: "LITERAL_PLACEHOLDER",
      expectedExtracted: "NO",
    },
    {
      message: "Invalid value for offset and limit.",
      expectedField: "UNPROVEN",
      expectedForm: "OTHER",
      expectedExtracted: "NO",
    },
    {
      message: "Invalid value for \"offset\".",
      expectedField: "UNPROVEN",
      expectedForm: "OTHER",
      expectedExtracted: "NO",
    },
    {
      message: "Invalid value for <offset>.",
      expectedField: "UNPROVEN",
      expectedForm: "OTHER",
      expectedExtracted: "NO",
    },
    {
      message: "Invalid value for %offset.",
      expectedField: "UNPROVEN",
      expectedForm: "OTHER",
      expectedExtracted: "NO",
    },
  ]
  for (const testCase of cases) {
    const output = parseSafeEbayInventoryErrorMetadata({
      errorId: 25709,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: testCase.message,
    })
    assert.equal(output.ERROR_25709_FIELD_NAME, testCase.expectedField)
    assert.equal(output.ERROR_25709_MESSAGE_FORM, testCase.expectedForm)
    assert.equal(
      output.FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE,
      testCase.expectedExtracted,
    )
    assert.equal(typeof output.ERROR_25709_SAFE_FIELD_CLASS, "string")
    assert.equal(typeof output.MESSAGE_PREFIX_CLASS, "string")
    assert.equal(typeof output.MESSAGE_SUFFIX_CLASS, "string")
    assert.equal(typeof output.MESSAGE_LENGTH_BUCKET, "string")
    assert.equal(
      ["EXACT_INVALID_VALUE_FOR", "INVALID_VALUE_VARIANT", "OTHER"]
        .includes(output.MESSAGE_PREFIX_CLASS),
      true,
    )
  }
})

test("clasifica UNKNOWN fieldName a UNRECOGNIZED y conserva enums cerrados", () => {
  const unknown = parseSafeEbayInventoryErrorMetadata({
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
    message: "Invalid value for unknownField.",
  })
  assert.equal(unknown.ERROR_25709_FIELD_NAME, "UNPROVEN")
  assert.equal(unknown.ERROR_25709_MESSAGE_FORM, "SUBSTITUTED_FIELD")
  assert.equal(unknown.FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE, "YES")
  assert.equal(unknown.ERROR_25709_SAFE_FIELD_CLASS, "UNRECOGNIZED")
  assert.equal(unknown.MESSAGE_PREFIX_CLASS, "EXACT_INVALID_VALUE_FOR")
  assert.equal(unknown.MESSAGE_SUFFIX_CLASS, "PERIOD")
  assert.equal(unknown.MESSAGE_LENGTH_BUCKET, "0_31")
  assert.equal(unknown.MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX, "YES")
  assert.equal(unknown.MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN, "NO")
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 25709,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: "Invalid value for limit.",
    }).ERROR_25709_SAFE_FIELD_CLASS,
    "LIMIT",
  )
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 25709,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: "Invalid value for {fieldName}.",
    }).ERROR_25709_SAFE_FIELD_CLASS,
    "LITERAL_FIELDNAME_PLACEHOLDER",
  )
})

test("clasifica mensajes no clasificables para 25709", () => {
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 1001,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: "Invalid value for offset.",
    }).ERROR_25709_FIELD_NAME, "UNPROVEN",
  )
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 1001,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: "Invalid value for offset.",
    }).ERROR_25709_MESSAGE_FORM, "OTHER",
  )
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 25709,
      domain: "API_INVENTORY",
      category: "REQUEST",
    }).ERROR_25709_MESSAGE_FORM,
    "NO_MESSAGE",
  )
  assert.equal(
    parseSafeEbayInventoryErrorMetadata({
      errorId: 25709,
      domain: "API_INVENTORY",
      category: "REQUEST",
      message: "Invalid value for offset.",
    }).ERROR_25709_SAFE_FIELD_CLASS,
    "OFFSET",
  )
  const serialized = JSON.stringify(parseSafeEbayInventoryErrorMetadata({
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
    message: "Invalid value for limit.",
  }))
  assert.equal(serialized.includes("Invalid value for limit."), false)
  const rawSerialized = JSON.stringify(parseSafeEbayInventoryErrorMetadata({
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
    message: `Invalid value for ${"x".repeat(40)}.`,
  }))
  assert.equal(rawSerialized.includes(`Invalid value for ${"x".repeat(40)}.`), false)
})

test("Inventory Items acepta sólo el sobre vacío certificado y conserva arrays", () => {
  assert.deepEqual(parseEbayInventoryItemsPage({
    href: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=0",
    limit: 50,
    size: 0,
    total: 0,
  }), {
    accepted: true,
    inventoryItems: [],
    total: 0,
    next: null,
    responseShape: "CERTIFIED_EMPTY_OMITTED_ARRAY",
    metadata: {
      topLevelKeys: ["href", "limit", "size", "total"],
      topLevelKeysSafe: true,
      hasArray: false,
      arrayCount: null,
      totalPresent: true,
      nextPresent: false,
    },
  })
  assert.deepEqual(parseEbayInventoryItemsPage({
    inventoryItems: [],
    total: 0,
  }).responseShape, "INVENTORY_ITEMS_ARRAY")
  const legacyArrayWithoutTotal = parseEbayInventoryItemsPage({
    inventoryItems: [],
  })
  assert.equal(legacyArrayWithoutTotal.accepted, true)
  assert.equal(legacyArrayWithoutTotal.total, null)
  assert.equal(parseEbayInventoryItemsPage({ total: 0 }).responseShape,
    "CERTIFIED_EMPTY_OMITTED_ARRAY")
  const rows = parseEbayInventoryItemsPage({
    inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }],
    total: 1,
  })
  assert.equal(rows.accepted, true)
  assert.equal(rows.inventoryItems.length, 1)
  assert.equal(rows.total, 1)

  for (const payload of [
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1, next: {} },
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1, next: "" },
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1,
      next: "https://evil.invalid/sell/inventory/v1/inventory_item?limit=50&offset=1" },
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1, limit: 100 },
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1,
      href: "https://evil.invalid/sell/inventory/v1/inventory_item?limit=50&offset=0" },
    { inventoryItems: [{ sku: "PRIVATE_TEST_SKU" }], total: 1, size: 2 },
  ]) {
    assert.equal(parseEbayInventoryItemsPage(payload).accepted, false)
  }

  for (const payload of [
    {},
    { size: 0 },
    { total: "0" },
    { total: false },
    { total: null },
    { total: 1 },
    { total: 0, inventoryItems: null },
    { total: 0, inventoryItems: {} },
    { total: 0, size: 1 },
    { total: 0, next: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=1" },
    { total: 0, prev: "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=50&offset=0" },
    { total: 0, href: "https://evil.invalid/sell/inventory/v1/inventory_item?limit=50&offset=0" },
    { total: 0, privateUnexpectedKey: "PRIVATE_VALUE" },
    { inventoryItems: [], total: 2 },
    { inventoryItems: [], total: 0, size: 1 },
  ]) {
    assert.equal(parseEbayInventoryItemsPage(payload).accepted, false)
  }
  const contradictory = parseEbayInventoryItemsPage({
    inventoryItems: [],
    total: 2,
  })
  assert.equal(contradictory.metadata.hasArray, true)
  assert.equal(contradictory.metadata.arrayCount, 0)
  assert.equal(contradictory.total, 2)
})

test("Inventory Items interpreta offset como número de página", () => {
  const endpoint =
    "https://api.ebay.com/sell/inventory/v1/inventory_item"
  const firstPageItems = Array.from({ length: 50 }, (_, index) => ({
    sku: `SAFE-SKU-${index}`,
  }))
  const firstPage = {
    inventoryItems: firstPageItems,
    href: `${endpoint}?limit=50&offset=0`,
    limit: 50,
    size: 50,
    total: 80,
    next: `${endpoint}?limit=50&offset=1`,
  }
  const parsedFirstPage = parseEbayInventoryItemsPage(firstPage, {
    expectedLimit: 50,
    expectedOffset: 0,
  })
  assert.equal(parsedFirstPage.accepted, true)
  assert.equal(parsedFirstPage.inventoryItems.length, 50)
  assert.equal(parsedFirstPage.next, firstPage.next)

  const secondPage = {
    inventoryItems: Array.from({ length: 30 }, (_, index) => ({
      sku: `SAFE-SKU-${index + 50}`,
    })),
    href: `${endpoint}?limit=50&offset=1`,
    limit: 50,
    size: 30,
    total: 80,
    prev: `${endpoint}?limit=50&offset=0`,
  }
  const parsedSecondPage = parseEbayInventoryItemsPage(secondPage, {
    expectedLimit: 50,
    expectedOffset: 1,
  })
  assert.equal(parsedSecondPage.accepted, true)
  assert.equal(parsedSecondPage.inventoryItems.length, 30)
  assert.equal(parsedSecondPage.next, null)

  assert.equal(parseEbayInventoryItemsPage({
    ...firstPage,
    next: `${endpoint}?limit=50&offset=50`,
  }, {
    expectedLimit: 50,
    expectedOffset: 0,
  }).accepted, false)
  assert.equal(parseEbayInventoryItemsPage({
    ...secondPage,
    prev: `${endpoint}?limit=50&offset=50`,
  }, {
    expectedLimit: 50,
    expectedOffset: 1,
  }).accepted, false)
})

test("GetItem certifica marketplace sin aceptar Ack, Site o ItemID ambiguos", () => {
  assert.deepEqual(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Site>US</Site>
    </Item></GetItemResponse>
  `, "123456789012"), {
    status: "US_CERTIFIED",
    itemId: "123456789012",
    marketplaceSite: "US",
  })
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Site>Germany</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "NON_US_CERTIFIED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Site>US</Site><Site>Germany</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "UNRESOLVED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Site>UNRECOGNIZED_FUTURE_OR_CORRUPT</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "UNRESOLVED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID>
    </Item></GetItemResponse>
  `, "123456789012").status, "UNRESOLVED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Variation><Site>US</Site></Variation>
    </Item></GetItemResponse>
  `, "123456789012").status, "UNRESOLVED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><Site>CustomCode</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "UNRESOLVED")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789099</ItemID><Site>US</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "ITEM_ID_MISMATCH")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <ItemID>123456789012</ItemID><ItemID>123456789013</ItemID><Site>US</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "ITEM_ID_MISMATCH")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Success</Ack><Item>
      <Container><ItemID>123456789012</ItemID></Container><Site>US</Site>
    </Item></GetItemResponse>
  `, "123456789012").status, "ITEM_ID_MISMATCH")
  assert.equal(parseEbayTradingGetItemMarketplace(`
    <GetItemResponse><Ack>Failure</Ack><Errors><ErrorCode>safe</ErrorCode></Errors>
    </GetItemResponse>
  `, "123456789012").status, "ERROR")
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
  assert.equal(parseEbayTradingGetUser(`
    <GetUserResponse><Ack>Success</Ack><User>
      <UserID>seller-safe-id</UserID><UserID>other-seller</UserID>
      <Site>US</Site><Site>Germany</Site>
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
            <GalleryURL>https://i.ebayimg.com/images/g/example/s-l1600.jpg</GalleryURL>
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
  assert.equal(result.sourceIdentityConflict, false)
  assert.equal(result.listings.length, 3)
  assert.equal(result.listings[0].primaryImageUrl,
    "https://i.ebayimg.com/images/g/example/s-l1600.jpg")
  assert.equal(result.listings[1].primaryImageUrl, null)
  assert.equal(result.listings.every((listing) =>
    listing.marketplaceCertification.status === "UNRESOLVED" &&
    listing.marketplaceCertification.source === null), true)
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
      quantity: 2,
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
        <ItemID>123456789099</ItemID><Site>Germany</Site>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(nonUs.listings[0].marketplaceSite, "GERMANY")
  const omittedSite = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789098</ItemID><Title>Site omitted by contract</Title>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(omittedSite.listings.length, 1)
  assert.equal(omittedSite.listings[0].marketplaceSite, null)
  assert.deepEqual(omittedSite.listings[0].marketplaceCertification, {
    status: "UNRESOLVED",
    source: null,
    observedAt: null,
  })
  const conflictedSource = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>2</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray>
        <Item><ItemID>123456789096</ItemID><Site>US</Site><Site>Germany</Site></Item>
        <Item><ItemID>123456789095</ItemID><ItemID>123456789094</ItemID><Site>US</Site></Item>
      </ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(conflictedSource.sourceIdentityConflict, true)
  assert.equal(conflictedSource.listings.length, 1)
  assert.equal(conflictedSource.listings[0].marketplaceSite, null)
  const invalidSiteSource = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789093</ItemID><Site>UNRECOGNIZED</Site>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(invalidSiteSource.sourceIdentityConflict, true)
  assert.equal(invalidSiteSource.listings[0].marketplaceSite, null)
  const invalidZeroIdentity = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>0</TotalNumberOfPages>
        <TotalNumberOfEntries>0</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>invalid</ItemID><Site>US</Site>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(invalidZeroIdentity.sourceIdentityConflict, true)
  assert.equal(invalidZeroIdentity.listings.length, 0)
  const conflictingTotals = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>0</TotalNumberOfEntries>
        <TotalNumberOfEntries>26</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(conflictingTotals.totalEntries, null)
  assert.equal(conflictingTotals.paginationMetadataConflict, true)
  const invalidHasMore = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>0</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>maybe</HasMoreItems><ItemArray></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(invalidHasMore.hasMoreItems, null)
  assert.equal(invalidHasMore.paginationMetadataConflict, true)
  const nestedSite = parseEbayTradingGetMyeBaySellingPage(`
    <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789092</ItemID><Variation><Site>US</Site></Variation>
      </Item></ItemArray>
    </ActiveList></GetMyeBaySellingResponse>
  `, observedAt)
  assert.equal(nestedSite.listings[0].marketplaceSite, null)
})

test("GetMyeBaySelling normaliza QuantitySold omitido y cierra cantidades inválidas", () => {
  const quantity = (quantityXml, quantitySoldXml) => {
    const parsed = parseEbayTradingGetMyeBaySellingPage(`
      <GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
          <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
        <HasMoreItems>false</HasMoreItems><ItemArray><Item>
          <ItemID>123456789012</ItemID><Site>US</Site>
          ${quantityXml}
          <SellingStatus>${quantitySoldXml}</SellingStatus>
        </Item></ItemArray>
      </ActiveList></GetMyeBaySellingResponse>
    `, "2026-08-23T12:00:00.000Z")
    return parsed.listings[0].availableQuantity
  }

  assert.equal(quantity("<Quantity>5</Quantity>", ""), 5)
  assert.equal(quantity(
    "<Quantity>5</Quantity>",
    "<QuantitySold>0</QuantitySold>",
  ), 5)
  assert.equal(quantity(
    "<Quantity>5</Quantity>",
    "<QuantitySold>2</QuantitySold>",
  ), 3)
  assert.equal(quantity("<Quantity>0</Quantity>", ""), 0)
  assert.equal(quantity("", ""), null)
  assert.equal(quantity(
    "<Quantity>5</Quantity>",
    "<QuantitySold>invalid</QuantitySold>",
  ), null)
  assert.equal(quantity(
    "<Quantity>5</Quantity>",
    "<QuantitySold>6</QuantitySold>",
  ), null)
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

test("discovery live depende de Trading, no de Inventory o registry", () => {
  assert.deepEqual(normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: 2,
    reachedPageLimit: false,
    pageFailed: false,
  }), { status: "COMPLETE", gapCodes: [] })
  const partial = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 2,
    totalEntries: 25000,
    reachedPageLimit: true,
    pageFailed: false,
  })
  assert.equal(partial.status, "PARTIAL")
  assert.ok(partial.gapCodes.includes("GET_MY_EBAY_SELLING_25000_LIMIT"))
  assert.ok(partial.gapCodes.includes("SELLER_WIDE_PAGINATION_UNPROVEN"))
  assert.equal(partial.gapCodes.some((code) =>
    /INVENTORY|REGISTRY/.test(code)), false)
  const missingTotal = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: null,
    reachedPageLimit: false,
    pageFailed: false,
  })
  assert.equal(missingTotal.status, "PARTIAL")
  assert.ok(missingTotal.gapCodes.includes(
    "SELLER_WIDE_TOTAL_ENTRIES_UNPROVEN",
  ))
  const contradictory = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: 1,
    reachedPageLimit: false,
    pageFailed: false,
    paginationMetadataConflict: true,
    sourceIdentityConflict: true,
  })
  assert.equal(contradictory.status, "PARTIAL")
  assert.ok(contradictory.gapCodes.includes(
    "SELLER_WIDE_PAGINATION_METADATA_CONFLICT",
  ))
  assert.ok(contradictory.gapCodes.includes(
    "SELLER_WIDE_SOURCE_IDENTITY_CONFLICT",
  ))
  assert.equal(contradictory.gapCodes.some((code) =>
    /MARKETPLACE|INVENTORY|REGISTRY/.test(code)), false)
  const countMismatch = normalizeLiveDiscoveryCoverage({
    pagesRead: 1,
    totalPages: 1,
    totalEntries: 2,
    reachedPageLimit: false,
    pageFailed: false,
    reportedItemCountMismatch: true,
  })
  assert.equal(countMismatch.status, "PARTIAL")
  assert.ok(countMismatch.gapCodes.includes(
    "SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED",
  ))
})

test("GetSellerList fallback conserva current-live, variación y paginación", () => {
  const parsed = parseEbayTradingGetSellerListPage(`
    <GetSellerListResponse><Ack>Success</Ack>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>
        <TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>
      <HasMoreItems>false</HasMoreItems><ItemArray><Item>
        <ItemID>123456789012</ItemID><Title>Exact variant</Title><Site>US</Site>
        <Variations><Variation><SKU>BLUE-L</SKU><Quantity>3</Quantity>
          <SellingStatus><QuantitySold>1</QuantitySold></SellingStatus>
          <VariationSpecifics><NameValueList><Name>Color</Name><Value>Blue</Value>
          </NameValueList><NameValueList><Name>Size</Name><Value>L</Value>
          </NameValueList></VariationSpecifics></Variation></Variations>
      </Item></ItemArray>
    </GetSellerListResponse>`, "2026-08-21T12:00:00.000Z")
  assert.equal(parsed.accepted, true)
  assert.equal(parsed.totalEntries, 1)
  assert.equal(parsed.totalPages, 1)
  assert.equal(parsed.hasMoreItems, false)
  assert.equal(parsed.listings.length, 1)
  assert.equal(parsed.listings[0].sku, "BLUE-L")
  assert.equal(parsed.listings[0].variationKey, "Color=Blue|Size=L")
  assert.equal(parsed.listings[0].availableQuantity, 2)
  assert.equal(parsed.sourceIdentityConflict, false)
  assert.equal(parsed.paginationMetadataConflict, false)
})

test("orders descarta PII, cancelaciones y órdenes parcialmente no probadas", () => {
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
  assert.equal(safe.length, 0)
  const serialized = JSON.stringify(safe)
  for (const forbidden of [
    "buyer", "email", "address", "phone", "fullName", "Private Buyer",
    "private@example.invalid", "title", "raw",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"))
})
