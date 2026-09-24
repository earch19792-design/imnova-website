import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (String(specifier).startsWith(".") && !/\.(?:ts|mjs|js)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch { /* continue */ }
  }
  return nextResolve(specifier, context)
} })

import { projectSellerOsListingCasesV1 } from "./seller-os-listing-registry-v1.ts"

const accountKey = `seller:${"a".repeat(64)}`
const listing = (itemId, label) => ({ itemId, sku: label,
  customLabel: label, variationKey: null, title: "Never used as identity",
  primaryImageUrl: null, listingState: "ACTIVE", listingFormat: null,
  startTime: null, availableQuantity: 1, price: 10, currency: "USD",
  marketplaceSite: "US", marketplaceCertification: { status: "US_CERTIFIED",
    source: "EBAY_TRADING_GET_ITEM", observedAt: "2026-09-24T00:00:00Z" },
  identityAmbiguous: false, source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
  observedAt: "2026-09-24T00:00:00Z" })
const authority = (itemId, label, id) => ({ authority_id: `authority-${id}`,
  account_key: accountKey, marketplace_id: "EBAY_US", ebay_item_id: itemId,
  ebay_sku: label, seller_os_product_id: `product-${id}`,
  luna_product_id: `1021194207${id}`, luna_variant_id: `5494349486${id}`,
  luna_sku: label, supplier_quantity_required: 1,
  evidence_maximum_age_seconds: 21600, components: [], identity_key: `identity-${id}`,
  linkage_id: `linkage-${id}`, source_decision_id: `decision-${id}`,
  lifecycle_state: "ACTIVE", previous_authority_id: null,
  transition_reason_code: "EXACT", actor_type: "OWNER", actor_reference: "owner",
  identity_preflight_status: "PREFLIGHT_PASS", source_fingerprint: "fingerprint",
  identity_engine_version: null, preflight_contract_version: null,
  activated_at: "2026-09-24T00:00:00Z", ended_at: null,
  created_at: "2026-09-24T00:00:00Z", updated_at: "2026-09-24T00:00:00Z" })

test("native and manual listings use one identity rule; origin does not gate StockGuard", () => {
  const listings = [listing("366634810965", "NATIVE-RED"),
    listing("366643126310", "MANUAL-BLUE")]
  const projected = projectSellerOsListingCasesV1({ accountKey, listings,
    authorities: [authority("366634810965", "NATIVE-RED", "111"),
      authority("366643126310", "MANUAL-BLUE", "222")],
    quarantines: [], manualLinks: [{ ebay_item_id: "366643126310",
      connector_ebay_sku: "MANUAL-BLUE", supplier_sku: "MANUAL-BLUE",
      supplier_variant_id: "222", candidate_key: "luna-portex:111:222",
      opportunity_id: "an-opportunity", verification_status: "verified" }],
    publications: [{ listing_id: "366634810965", opportunity_id: "native-opportunity",
      listing_package_id: "native-package", manual_registration_id: null,
      publish_attempt_count: 1, phase: "monitor_registered" }],
    stockStates: listings.map((row) => ({ itemId: row.itemId,
      stockState: "IN_STOCK_SIGNAL", stockSourceCertified: true })) })
  assert.deepEqual(projected.map((row) => [row.origin, row.identity_status,
    row.stockguard_link_status]), [
    ["SELLER_OS", "LINKED_EXACT", "LINKED_ACTIVE"],
    ["MANUAL_EBAY", "LINKED_EXACT", "LINKED_ACTIVE"],
  ])
})

test("duplicate external SKU and missing Luna identity remain blocked", () => {
  const projected = projectSellerOsListingCasesV1({ accountKey,
    listings: [listing("366672502737", "SHARED"),
      listing("366666581320", "SHARED"), listing("366672501251", null)],
    authorities: [authority("366666581320", "SHARED", "333")],
    quarantines: [], manualLinks: [], publications: [],
    manualImportItemIds: ["366672501251"] })
  assert.deepEqual(projected.map((row) => row.identity_status),
    ["DUPLICATE_IDENTITY", "DUPLICATE_IDENTITY", "MISSING_LUNA_IDENTITY"])
  assert.deepEqual(projected.map((row) => row.stockguard_link_status),
    ["NEEDS_OWNER_REVIEW", "NEEDS_OWNER_REVIEW", "BLOCKED_IDENTITY"])
  assert.equal(projected[2].origin, "MANUAL_EBAY")
  assert.equal(projected[2].luna_product_id, null)
})

test("verified manual opportunity can be linkable without authorizing StockGuard", () => {
  const projected = projectSellerOsListingCasesV1({ accountKey,
    listings: [listing("366643555454", "ITEM-8058-RED-LU-DE")],
    authorities: [], quarantines: [], publications: [], manualLinks: [{
      ebay_item_id: "366643555454", connector_ebay_sku: "ITEM-8058-RED-LU-DE",
      supplier_sku: "ITEM-8058-RED-LU-DE", supplier_variant_id: "54943494865120",
      candidate_key: "luna-portex:10211942072544:54943494865120",
      opportunity_id: "opportunity", verification_status: "verified" }] })
  assert.equal(projected[0].identity_status, "LINKABLE_EXACT")
  assert.equal(projected[0].stockguard_link_status, "BLOCKED_STOCK_SOURCE")
  assert.equal(projected[0].stockguard_authority_id, null)
})

test("multiple variations under one Item ID create one review case", () => {
  const projected = projectSellerOsListingCasesV1({ accountKey,
    listings: [listing("366672505702", "COLOR-RED"),
      listing("366672505702", "COLOR-BLUE")],
    authorities: [], quarantines: [], manualLinks: [], publications: [] })
  assert.equal(projected.length, 1)
  assert.equal(projected[0].identity_status, "AMBIGUOUS")
  assert.equal(projected[0].ebay_custom_label, null)
})
