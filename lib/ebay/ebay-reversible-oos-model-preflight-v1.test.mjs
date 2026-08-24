import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previousTypeScriptLoader = require.extensions[".ts"]
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022 },
  })
  module._compile(output.outputText, filename)
}

const {
  REVERSIBLE_OOS_TARGET_ITEM_ID,
  REVERSIBLE_OOS_TARGET_SKU,
  runVercelReversibleOosPreflightV1,
} = require("./ebay-reversible-oos-model-preflight-v1.ts")
const { ebayProductionAccountFingerprint } = require(
  "./ebay-seller-account-scope.ts",
)
const USER_ID = "imnova-ebay-us-primary-user"

after(() => {
  if (previousTypeScriptLoader) {
    require.extensions[".ts"] = previousTypeScriptLoader
  } else {
    delete require.extensions[".ts"]
  }
})

function environment() {
  return {
    EBAY_CLIENT_ID: "client-id-test-only",
    EBAY_CLIENT_SECRET: "client-secret-test-only",
    EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN: "orders-refresh-token-test-only",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:
      ebayProductionAccountFingerprint(USER_ID),
  }
}

function xmlResponse(body) {
  return new Response(body, { status: 200,
    headers: { "Content-Type": "text/xml" } })
}

function harness(input = {}) {
  const calls = []
  const oos = input.oos ?? "true"
  const itemId = input.itemId ?? REVERSIBLE_OOS_TARGET_ITEM_ID
  const sku = input.sku ?? REVERSIBLE_OOS_TARGET_SKU
  const listingType = input.listingType ?? "FixedPriceItem"
  const listingDuration = input.listingDuration ?? "GTC"
  const inventoryTrackingMethod = input.inventoryTrackingMethod ?? null
  const inventoryItemStatus = input.inventoryItemStatus ?? 404
  const inventoryItemErrorId = input.inventoryItemErrorId ?? 25717
  const inventoryItemError = input.inventoryItemError ?? null
  const bulkInventoryItemStatus = input.bulkInventoryItemStatus ?? 200
  const bulkInventoryItemResult = input.bulkInventoryItemResult ?? {
    sku: REVERSIBLE_OOS_TARGET_SKU,
    statusCode: 404,
    errors: [{ errorId: 25710 }],
  }
  const inventoryLocationStatus = input.inventoryLocationStatus ?? 200
  const inventoryLocationError = input.inventoryLocationError ?? null
  const offers = input.offers ?? []
  const fetchImpl = async (request, init = {}) => {
    const url = String(request)
    calls.push({ url, method: init.method ?? "GET", body: String(init.body ?? ""),
      headers: Object.fromEntries(new Headers(init.headers).entries()) })
    if (url.endsWith("/identity/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-test-only",
        expires_in: 7200 }), { status: 200,
        headers: { "Content-Type": "application/json" } })
    }
    if (url.endsWith("/ws/api.dll")) {
      const callName = new Headers(init.headers).get("X-EBAY-API-CALL-NAME")
      if (callName === "GetUserPreferences") {
        const preference = oos === "missing" ? "" :
          `<OutOfStockControlPreference>${oos}</OutOfStockControlPreference>`
        return xmlResponse(`<GetUserPreferencesResponse><Ack>Success</Ack>${preference}</GetUserPreferencesResponse>`)
      }
      return xmlResponse(`<GetItemResponse><Ack>Success</Ack><Item>` +
        `<ItemID>${itemId}</ItemID><SKU>${sku}</SKU>` +
        `<Seller><UserID>${USER_ID}</UserID></Seller>` +
        `<ListingType>${listingType}</ListingType>` +
        `<ListingDuration>${listingDuration}</ListingDuration>` +
        `<SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>` +
        `<Quantity>2</Quantity>` +
        (inventoryTrackingMethod
          ? `<InventoryTrackingMethod>${inventoryTrackingMethod}</InventoryTrackingMethod>`
          : "") +
        `</Item></GetItemResponse>`)
    }
    if (url === "https://api.ebay.com/sell/inventory/v1/location") {
      const payload = inventoryLocationStatus === 200
        ? { locations: [{ merchantLocationKey: "must-not-be-returned" }] }
        : { errors: [inventoryLocationError ?? { errorId: 25709,
          domain: "API_INVENTORY", category: "REQUEST" }] }
      return new Response(JSON.stringify(payload), { status: inventoryLocationStatus,
        headers: { "Content-Type": "application/json" } })
    }
    if (url === `https://api.ebay.com/sell/inventory/v1/inventory_item/${REVERSIBLE_OOS_TARGET_SKU}`) {
      const payload = inventoryItemStatus === 200
        ? { sku: REVERSIBLE_OOS_TARGET_SKU, availability: {} }
        : { errors: [inventoryItemError ?? { errorId: inventoryItemErrorId }] }
      return new Response(JSON.stringify(payload), { status: inventoryItemStatus,
        headers: { "Content-Type": "application/json" } })
    }
    if (url === "https://api.ebay.com/sell/inventory/v1/bulk_get_inventory_item") {
      return new Response(JSON.stringify({ responses: [bulkInventoryItemResult] }), {
        status: bulkInventoryItemStatus,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url.startsWith("https://api.ebay.com/sell/inventory/v1/offer")) {
      return new Response(JSON.stringify({ offers, total: offers.length }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error(`UNEXPECTED_URL_${url}`)
  }
  return { calls, fetchImpl }
}

function tradingAccessTokenProvider(fetchImpl) {
  return async () => {
    const response = await fetchImpl(
      "https://api.ebay.com/identity/v1/oauth2/token",
      { method: "POST" },
    )
    const payload = await response.json()
    return payload.access_token
  }
}

async function run(input) {
  const h = input.harness
  return runVercelReversibleOosPreflightV1({
    authorizedPublication: input.authorizedPublication ?? null,
    environment: input.environment ?? environment(),
    fetchImpl: h.fetchImpl,
    tradingAccessTokenProvider: tradingAccessTokenProvider(h.fetchImpl),
  })
}

function exactOffer() {
  return {
    offerId: "offer-target-1",
    sku: REVERSIBLE_OOS_TARGET_SKU,
    marketplaceId: "EBAY_US",
    status: "PUBLISHED",
    listing: { listingId: REVERSIBLE_OOS_TARGET_ITEM_ID },
  }
}

test("OOS true plus exact Trading fixed-price evidence certifies reversible semantics", async () => {
  const h = harness()
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.outOfStockControl, true)
  assert.equal(result.listingManagementModel, "TRADING_FIXED_PRICE")
  assert.equal(result.listingManagementModelProven, true)
  assert.equal(result.reversibleQuantityZeroSemanticsProven, true)
  assert.equal(result.reversibleRestoreSemanticsProven, true)
  assert.equal(result.preservesItemId, true)
  assert.equal(result.targetReversibleProtectPossible, true)
  assert.equal(result.tradingItemReadAttempted, true)
  assert.equal(result.exactSkuReadAttempted, true)
  assert.equal(result.exactSkuReadHttpStatus, 404)
  assert.equal(result.exactSkuExists, false)
  assert.equal(result.inventoryOfferLookupAttempted, false)
  assert.equal(result.exactOfferLookupAttempted, false)
  assert.equal(result.exactOfferFound, false)
  assert.equal(result.safety.ebayWrites, 0)
})

test("project-wide account fingerprint securely binds the observed Trading seller", async () => {
  const h = harness()
  const fingerprintOnly = environment()
  delete fingerprintOnly.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
  fingerprintOnly.EBAY_SELLER_REFRESH_TOKEN =
    "inventory-refresh-token-test-only"
  const result = await run({ harness: h, environment: fingerprintOnly })
  assert.equal(result.outOfStockControlReadAttempted, true)
  assert.equal(result.tradingReadSuccess, true)
  assert.equal(result.listing.sellerAccountMatch, true)
  assert.equal(result.listingManagementModel, "TRADING_FIXED_PRICE")
})

test("exact Inventory item and offer require the exact authorized publication relationship", async () => {
  const h = harness({ inventoryItemStatus: 200, offers: [exactOffer()],
    inventoryTrackingMethod: "SKU" })
  const withInventoryToken = { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" }
  const result = await run({ harness: h,
    authorizedPublication: { listingId: REVERSIBLE_OOS_TARGET_ITEM_ID,
      sku: REVERSIBLE_OOS_TARGET_SKU, offerId: "offer-target-1" },
    environment: withInventoryToken,
  })
  assert.equal(result.listingManagementModel, "INVENTORY_API_MANAGED")
  assert.equal(result.exactSkuExists, true)
  assert.equal(result.exactOfferFound, true)
  assert.equal(result.exactPublicationItemIdMatch, true)
  assert.equal(result.inventoryOfferExactMatch, true)
  assert.equal(result.inventoryPublicationItemIdMatch, true)
})

test("Inventory offer without authorized publication fails model classification closed", async () => {
  const h = harness({ inventoryItemStatus: 200, offers: [exactOffer()],
    inventoryTrackingMethod: "SKU" })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.listingManagementModel, "UNPROVEN")
  assert.equal(result.targetReversibleProtectPossible, false)
  assert.equal(result.limitationCode, "LISTING_MANAGEMENT_MODEL_UNPROVEN")
})

test("missing Inventory token preserves Trading reads and model fails closed", async () => {
  const h = harness()
  const result = await run({ harness: h })
  assert.equal(result.outOfStockControlReadAttempted, true)
  assert.equal(result.outOfStockControl, true)
  assert.equal(result.tradingItemReadAttempted, true)
  assert.equal(result.tradingReadSuccess, true)
  assert.equal(result.inventoryOfferLookupAttempted, false)
  assert.equal(result.listingManagementModel, "UNPROVEN")
  assert.equal(result.targetReversibleProtectPossible, false)
  assert.equal(result.managementEvidenceSource,
    "REVERSIBLE_OOS_EBAY_CREDENTIALS_UNAVAILABLE")
})

test("exact SKU uses the exact path once and only the required read header", async () => {
  const h = harness({ inventoryItemStatus: 200, offers: [] })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  const exactSkuCalls = h.calls.filter((call) =>
    call.url.includes("/inventory_item/IMN-LST-000001"))
  assert.equal(exactSkuCalls.length, 1)
  const exactSkuCall = exactSkuCalls[0]
  assert.ok(exactSkuCall)
  assert.equal(exactSkuCall.method, "GET")
  assert.equal(exactSkuCall.url,
    "https://api.ebay.com/sell/inventory/v1/inventory_item/IMN-LST-000001")
  const exactSkuUrl = new URL(exactSkuCall.url)
  assert.equal(exactSkuUrl.pathname,
    "/sell/inventory/v1/inventory_item/IMN-LST-000001")
  assert.equal(decodeURIComponent(exactSkuUrl.pathname.split("/").at(-1)),
    REVERSIBLE_OOS_TARGET_SKU)
  assert.equal(exactSkuUrl.pathname.includes("%25"), false)
  assert.equal(exactSkuUrl.search, "")
  assert.equal(exactSkuCall.body, "")
  assert.deepEqual(Object.keys(exactSkuCall.headers), ["authorization"])
  assert.equal(exactSkuCall.headers.authorization.startsWith("Bearer "), true)
  const exactOfferCall = h.calls.find((call) =>
    call.url.startsWith("https://api.ebay.com/sell/inventory/v1/offer?"))
  assert.ok(exactOfferCall)
  assert.deepEqual(Object.keys(exactOfferCall.headers).sort(),
    ["accept", "authorization"])
  const exactOfferUrl = new URL(exactOfferCall.url)
  assert.equal(exactOfferUrl.searchParams.get("sku"), REVERSIBLE_OOS_TARGET_SKU)
  assert.equal(exactOfferUrl.searchParams.get("limit"), "100")
  assert.equal(exactOfferUrl.searchParams.has("offset"), false)
  assert.equal(result.exactSkuExists, true)
  assert.equal(result.exactOfferLookupAttempted, true)
  assert.equal(result.listingManagementModel, "TRADING_FIXED_PRICE")
})

test("exact SKU 25709 falls back to the bounded official bulk exact read", async () => {
  const h = harness({ inventoryItemStatus: 400, inventoryItemErrorId: 25709 })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.exactSkuReadAttempted, true)
  assert.equal(result.exactSkuReadHttpStatus, 400)
  assert.equal(result.exactSkuExists, false)
  assert.equal(result.exactSkuErrorId, "25709")
  assert.equal(result.exactSkuSafeErrorClass, "INVALID_REQUEST")
  assert.equal(result.requestContractFixRequired, false)
  assert.equal(result.exactSkuAuthorityOperation, "BULK_GET_INVENTORY_ITEM")
  assert.equal(result.exactSkuBulkFallbackAttempted, true)
  assert.equal(result.exactSkuBulkHttpStatus, 200)
  assert.equal(result.exactOfferLookupAttempted, false)
  assert.equal(result.listingManagementModel, "TRADING_FIXED_PRICE")
  assert.equal(result.targetReversibleProtectPossible, true)
})

test("bulk exact read can prove Inventory identity after single-SKU 25709", async () => {
  const h = harness({
    inventoryItemStatus: 400,
    inventoryItemErrorId: 25709,
    bulkInventoryItemResult: {
      sku: REVERSIBLE_OOS_TARGET_SKU,
      statusCode: 200,
      inventoryItem: { sku: REVERSIBLE_OOS_TARGET_SKU, availability: {} },
    },
    offers: [exactOffer()],
  })
  const result = await run({ harness: h,
    authorizedPublication: { listingId: REVERSIBLE_OOS_TARGET_ITEM_ID,
      sku: REVERSIBLE_OOS_TARGET_SKU, offerId: "offer-target-1" },
    environment: { ...environment(),
      EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" },
  })
  assert.equal(result.exactSkuExists, true)
  assert.equal(result.exactSkuAuthorityOperation, "BULK_GET_INVENTORY_ITEM")
  assert.equal(result.exactOfferLookupAttempted, true)
  assert.equal(result.exactPublicationItemIdMatch, true)
  assert.equal(result.listingManagementModel, "INVENTORY_API_MANAGED")
  const bulkCall = h.calls.find((call) =>
    call.url.endsWith("/sell/inventory/v1/bulk_get_inventory_item"))
  assert.ok(bulkCall)
  assert.equal(bulkCall.method, "POST")
  assert.deepEqual(JSON.parse(bulkCall.body), {
    requests: [{ sku: REVERSIBLE_OOS_TARGET_SKU }],
  })
  assert.deepEqual(Object.keys(bulkCall.headers).sort(),
    ["authorization", "content-type"])
})

test("bulk exact read fails closed when its per-SKU result is not authoritative", async () => {
  const h = harness({
    inventoryItemStatus: 400,
    inventoryItemErrorId: 25709,
    bulkInventoryItemResult: {
      sku: REVERSIBLE_OOS_TARGET_SKU,
      statusCode: 400,
      errors: [{ errorId: 25709 }],
    },
  })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.exactSkuExists, "UNPROVEN")
  assert.equal(result.exactSkuAuthorityOperation, "UNPROVEN")
  assert.equal(result.requestContractFixRequired, true)
  assert.equal(result.listingManagementModel, "UNPROVEN")
  assert.equal(result.targetReversibleProtectPossible, false)
})

test("exact SKU 25709 exposes only allowlisted field-class metadata", async () => {
  const h = harness({ inventoryItemStatus: 400, inventoryItemError: {
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
    message: "Invalid value for Content-Language.",
    parameters: [
      { name: "fieldName", value: "Content-Language" },
      { name: "invalidValue", value: "must-never-be-returned" },
    ],
  } })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.exactSkuErrorDomain, "API_INVENTORY")
  assert.equal(result.exactSkuErrorCategory, "REQUEST")
  assert.deepEqual(result.exactSkuErrorParameterNames, ["fieldname"])
  assert.equal(result.exactSkuFieldNameClass, "CONTENT_LANGUAGE_HEADER")
  assert.equal(result.exactSkuInvalidValueClass, "UNPROVEN")
  assert.equal(result.exactSkuMessageTemplateClass,
    "INVALID_VALUE_FOR_SUBSTITUTED_FIELD")
  assert.equal(JSON.stringify(result).includes("must-never-be-returned"), false)
  assert.equal(JSON.stringify(result).includes("Invalid value for"), false)
})

test("literal 25709 placeholder remains unproven without leaking message", async () => {
  const h = harness({ inventoryItemStatus: 400, inventoryItemError: {
    errorId: 25709,
    domain: "API_INVENTORY",
    category: "REQUEST",
    message: "Invalid value for {fieldName}.",
  } })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.deepEqual(result.exactSkuErrorParameterNames, [])
  assert.equal(result.exactSkuFieldNameClass, "UNPROVEN")
  assert.equal(result.exactSkuInvalidValueClass, "UNPROVEN")
  assert.equal(result.exactSkuMessageTemplateClass,
    "INVALID_VALUE_FOR_LITERAL_PLACEHOLDER")
  assert.equal(JSON.stringify(result).includes("fieldName"), false)
})

test("successful location control isolates 25709 to inventory item surface", async () => {
  const h = harness({ inventoryItemStatus: 400, inventoryItemError: {
    errorId: 25709, domain: "API_INVENTORY", category: "REQUEST",
  } })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.inventoryLocationReadAttempted, true)
  assert.equal(result.inventoryLocationHttpStatus, 200)
  assert.equal(result.inventoryLocationReadAccepted, true)
  assert.equal(result.inventoryLocationErrorId, null)
  assert.equal(result.inventoryBoundaryClass,
    "INVENTORY_ITEM_SURFACE_SPECIFIC")
  assert.equal(JSON.stringify(result).includes("must-not-be-returned"), false)
  const locationCall = h.calls.find((call) =>
    call.url === "https://api.ebay.com/sell/inventory/v1/location")
  assert.ok(locationCall)
  assert.equal(locationCall.method, "GET")
  assert.equal(locationCall.body, "")
  assert.deepEqual(Object.keys(locationCall.headers), ["authorization"])
})

test("matching location and exact SKU 25709 proves a common boundary only", async () => {
  const error = { errorId: 25709, domain: "API_INVENTORY",
    category: "REQUEST" }
  const h = harness({ inventoryLocationStatus: 400,
    inventoryLocationError: error, inventoryItemStatus: 400,
    inventoryItemError: error })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.inventoryLocationReadAttempted, true)
  assert.equal(result.inventoryLocationHttpStatus, 400)
  assert.equal(result.inventoryLocationReadAccepted, false)
  assert.equal(result.inventoryLocationErrorId, "25709")
  assert.equal(result.inventoryLocationErrorDomain, "API_INVENTORY")
  assert.equal(result.inventoryLocationErrorCategory, "REQUEST")
  assert.equal(result.inventoryBoundaryClass, "COMMON_INVENTORY_API_BOUNDARY")
  assert.equal(result.inventoryCommonRootCauseProven, false)
  assert.equal(result.inventoryCommonRootCause, "UNPROVEN")
})

test("restore remains gated by fresh healthy evidence and positive safe capacity", async () => {
  const h = harness()
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.restoreRequiresFreshHealthyStock, true)
  assert.equal(result.restoreRequiresPositiveSafeCapacity, true)
  assert.equal(result.inStockWithoutSafeCapacityAutoRestoreAllowed, false)
})

test("OutOfStockControl false blocks reversible protection", async () => {
  const h = harness({ oos: "false" })
  const result = await run({ harness: h, environment: { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" } })
  assert.equal(result.outOfStockControl, false)
  assert.equal(result.listingManagementModel, "TRADING_FIXED_PRICE")
  assert.equal(result.targetReversibleProtectPossible, false)
  assert.equal(result.limitationCode, "OUT_OF_STOCK_CONTROL_DISABLED")
})

test("missing preference remains UNPROVEN and never authorizes protection", async () => {
  const h = harness({ oos: "missing" })
  const result = await run({ harness: h })
  assert.equal(result.outOfStockControl, "UNPROVEN")
  assert.equal(result.targetReversibleProtectPossible, false)
})

test("ItemID or SKU mismatch fails closed", async () => {
  const h = harness({ itemId: "366569086087" })
  const result = await run({ harness: h })
  assert.equal(result.tradingReadSuccess, false)
  assert.equal(result.listingManagementModel, "UNPROVEN")
  assert.equal(result.preservesItemId, false)
})

test("non-GTC fixed-price listing does not claim reversible OOS semantics", async () => {
  const h = harness({ listingDuration: "Days_30" })
  const result = await run({ harness: h })
  assert.equal(result.listingManagementModel, "UNPROVEN")
  assert.equal(result.targetReversibleProtectPossible, false)
})

test("unbound account stops before any eBay request", async () => {
  const h = harness()
  const result = await runVercelReversibleOosPreflightV1({
    authorizedPublication: null,
    environment: { EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y",
      EBAY_SELLER_REFRESH_TOKEN: "z" },
    fetchImpl: h.fetchImpl,
    tradingAccessTokenProvider: tradingAccessTokenProvider(h.fetchImpl),
  })
  assert.equal(result.limitationCode, "REVERSIBLE_OOS_ACCOUNT_BINDING_UNPROVEN")
  assert.equal(h.calls.length, 0)
})

test("commercial orders token is the canonical Trading token source", () => {
  const implementation = readFileSync(
    new URL("./ebay-reversible-oos-model-preflight-v1.ts", import.meta.url),
    "utf8",
  )
  assert.match(implementation, /getEbayCommercialOrdersAccessToken/)
  assert.doesNotMatch(implementation,
    /mintToken\(\{ credentials, scopes: \[BASE_SCOPE\]/)
})

test("request boundary is fixed, bounded, read-only and preserves existing admin route", () => {
  const source = readFileSync(
    new URL("../../app/api/admin/ebay/commercial-monitor/route.ts", import.meta.url),
    "utf8",
  )
  const implementation = readFileSync(
    new URL("./ebay-reversible-oos-model-preflight-v1.ts", import.meta.url),
    "utf8",
  )
  assert.match(source, /validateAdminApiRequest\(req\)/)
  assert.match(source, /productionBlocked\(\)/)
  assert.match(source, /preflight_reversible_oos_model/)
  assert.match(source, /Object\.keys\(input\)/)
  assert.match(implementation, /ShowOutOfStockControlPreference/)
  assert.match(implementation, /sell\/inventory\/v1\/offer/)
  assert.match(implementation, /sell\/inventory\/v1\/inventory_item/)
  const exactSkuImplementation = implementation.slice(
    implementation.indexOf("async function exactInventoryItemRead"),
    implementation.indexOf("async function exactInventoryOfferLookup"),
  )
  assert.doesNotMatch(exactSkuImplementation, /Accept:/)
  assert.match(implementation, /REVERSIBLE_OOS_TARGET_ITEM_ID = "366569086086"/)
  assert.match(implementation, /REVERSIBLE_OOS_TARGET_SKU = "IMN-LST-000001"/)
  assert.doesNotMatch(implementation, /EndFixedPriceItem|SetUserPreferences|ReviseFixedPriceItem/)
  assert.doesNotMatch(implementation, /method:\s*"(?:PUT|PATCH|DELETE)"/)
})
