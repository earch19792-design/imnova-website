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
  const offers = input.offers ?? []
  const fetchImpl = async (request, init = {}) => {
    const url = String(request)
    calls.push({ url, method: init.method ?? "GET", body: String(init.body ?? "") })
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
  assert.equal(result.inventoryOfferLookupAttempted, true)
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

test("exact Inventory offer requires the exact authorized publication relationship", async () => {
  const h = harness({ offers: [exactOffer()], inventoryTrackingMethod: "SKU" })
  const withInventoryToken = { ...environment(),
    EBAY_SELLER_REFRESH_TOKEN: "inventory-refresh-token-test-only" }
  const result = await run({ harness: h,
    authorizedPublication: { listingId: REVERSIBLE_OOS_TARGET_ITEM_ID,
      sku: REVERSIBLE_OOS_TARGET_SKU, offerId: "offer-target-1" },
    environment: withInventoryToken,
  })
  assert.equal(result.listingManagementModel, "INVENTORY_API_MANAGED")
  assert.equal(result.inventoryOfferExactMatch, true)
  assert.equal(result.inventoryPublicationItemIdMatch, true)
})

test("Inventory offer without authorized publication fails model classification closed", async () => {
  const h = harness({ offers: [exactOffer()], inventoryTrackingMethod: "SKU" })
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
  assert.match(implementation, /REVERSIBLE_OOS_TARGET_ITEM_ID = "366569086086"/)
  assert.match(implementation, /REVERSIBLE_OOS_TARGET_SKU = "IMN-LST-000001"/)
  assert.doesNotMatch(implementation, /EndFixedPriceItem|SetUserPreferences|ReviseFixedPriceItem/)
  assert.doesNotMatch(implementation, /method:\s*"(?:PUT|PATCH|DELETE)"/)
})
