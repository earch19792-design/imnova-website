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
const generationMigration = readFileSync(
  new URL("../supabase/migrations/20260713074000_harden_ebay_active_listing_sync.sql", import.meta.url),
  "utf8",
)

test("active listing sync is restricted to official eBay read-only GET endpoints", () => {
  assert.match(service, /sell\.inventory\.readonly/)
  assert.match(service, /method: "GET"/)
  assert.match(service, /BLOCKED_NON_READONLY_EBAY_INVENTORY_REQUEST/)
  assert.doesNotMatch(service, /method: "(?:POST|PUT|PATCH|DELETE)"[\s\S]*sell\/inventory/)
  assert.match(service, /ebayWriteUsed: false/)
  assert.match(service, /tokensReturned: false/)
  assert.match(service, /X-EBAY-API-CALL-NAME": "GetUser"/)
  assert.match(service, /ebayProductionAccountFingerprint/)
  assert.match(service, /EBAY_ACTIVE_LISTING_ACCOUNT_IDENTITY_MISMATCH/)
  assert.ok(
    service.indexOf("await assertAuthenticatedSellerAccount(accessToken)") <
      service.indexOf("return await syncEbayActiveListingsWithToken"),
  )
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
  assert.match(service, /begin_ebay_active_listing_sync_generation/)
  assert.match(service, /commit_ebay_active_listing_sync_generation/)
  assert.doesNotMatch(service, /\.upsert\(rows, \{ onConflict: "sync_key" \}\)/)
  assert.match(service, /supplier_cost_at_linking/)
  assert.match(service, /previous\?\.market_radar_product_id/)
  assert.match(service, /\.eq\("source", CONNECTOR_SOURCE\)/)
  assert.match(service, /\.eq\("account_key", accountKey\)/)
  assert.match(service, /getEbaySellerAccountScopeConfiguration/)
  assert.match(service, /EBAY_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED/)
  assert.doesNotMatch(service, /\|\| "default"/)
  assert.match(service, /CANONICAL_LISTING_PACKAGE_SKU/)
  assert.match(service, /RESERVED_UNRESOLVED/)
  assert.match(service, /AMBIGUOUS_SUPPLIER_SKU/)
  assert.match(service, /fallbackSkus = uniqueSkus\.filter\(\(sku\) => !\/\^IMNOVA-\/i\.test\(sku\)\)/)
  assert.match(service, /market_radar_product_id: mapping \? mapping\.productId : null/)
  assert.match(service, /supplier_variant_id: mapping \? mapping\.variantId : null/)
  assert.match(service, /supplier_sku: mapping \? mapping\.supplierSku : null/)
  assert.match(service, /isSameOpportunityIdentity/)
  assert.match(service, /withoutPreviousOpportunityIdentity/)
  assert.match(service, /"supplierCostAtLinking"/)
  assert.doesNotMatch(service, /mapping\?\.productId \?\? previous/)
  assert.doesNotMatch(service, /mapping\?\.variantId \?\? previous/)
  assert.doesNotMatch(service, /mapping\?\.supplierSku \?\? previous/)
})

test("database generations make stale sync commits harmless and writes server-only", () => {
  assert.match(generationMigration, /sync_generation bigint not null default 0/)
  assert.match(generationMigration, /on conflict \(account_key\) do update set[\s\S]*latest_generation = state\.latest_generation \+ 1/)
  assert.match(generationMigration, /p_sync_generation <= v_state\.latest_committed_generation/)
  assert.doesNotMatch(generationMigration, /p_sync_generation < v_state\.latest_committed_generation/)
  assert.match(generationMigration, /target\.sync_generation <= excluded\.sync_generation/)
  assert.match(generationMigration, /target\.sync_generation <= p_sync_generation/)
  assert.match(generationMigration, /EBAY_ACTIVE_LISTING_SYNC_KEY_SCOPE_CONFLICT/)
  assert.match(generationMigration, /revoke insert, update, delete on/)
  assert.match(generationMigration, /to service_role/)
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
