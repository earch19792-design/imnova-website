import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(
  new URL("../lib/ebay/ebay-active-listing-readonly-sync.ts", import.meta.url),
  "utf8",
)
const route = readFileSync(
  new URL("../app/api/admin/ebay/active-listings/sync/route.ts", import.meta.url),
  "utf8",
)

test("active listing sync is restricted to official eBay read-only GET endpoints", () => {
  assert.match(service, /sell\.inventory\.readonly/)
  assert.match(service, /method: "GET"/)
  assert.match(service, /BLOCKED_NON_READONLY_EBAY_INVENTORY_REQUEST/)
  assert.doesNotMatch(service, /method: "(?:POST|PUT|PATCH|DELETE)"[\s\S]*sell\/inventory/)
  assert.match(service, /ebayWriteUsed: false/)
  assert.match(service, /tokensReturned: false/)
})

test("active listing sync retries transient reads and reconciles Luna mappings", () => {
  assert.match(service, /\[429, 500, 502, 503, 504\]/)
  assert.match(service, /retry-after/)
  assert.match(service, /EBAY_ACTIVE_LISTING_MAPPING_READ_FAILED/)
  assert.match(service, /market_radar_product_id/)
  assert.match(service, /supplier_variant_id/)
  assert.match(service, /ebay_active_listings/)
})

test("active listing reads offers per SKU and preserves multi-variation identity", () => {
  assert.match(service, /searchParams\.set\("sku", sku\)/)
  assert.match(service, /onConflict: "sync_key"/)
  assert.match(service, /supplier_cost_at_linking/)
  assert.match(service, /previous\?\.market_radar_product_id/)
  assert.match(service, /\.eq\("source", CONNECTOR_SOURCE\)/)
  assert.match(service, /\.eq\("account_key", accountKey\)/)
})

test("active listing status recognizes official Inventory API lifecycle states", () => {
  assert.match(service, /"OUT_OF_STOCK"/)
  assert.match(service, /"INACTIVE"/)
  assert.match(service, /"EBAY_ENDED"/)
  assert.match(service, /"NOT_LISTED"/)
})

test("active listing sync route requires Admin authentication", () => {
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /syncEbayActiveListingsReadonly/)
  assert.match(route, /EBAY_ACTIVE_LISTING_SYNC_FAILED/)
})
