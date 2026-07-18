import assert from "node:assert/strict"
import test from "node:test"

import {
  canonicalizeActiveListingProtectionRows,
  projectActiveListingProtectionMonitorHealth,
  resolveExactUniqueCurrentLunaVariant,
} from "./ebay-active-listing-protection-domain.ts"

function row(overrides) {
  return {
    id: "listing-base",
    account_key: "official:abc",
    source: "EBAY_TRADING_GET_ITEM_READONLY",
    ebay_item_id: "123456789012",
    ebay_sku: "IMNOVA-ABC",
    listing_status: "active",
    last_ebay_sync_at: "2026-07-13T10:00:00.000Z",
    ...overrides,
  }
}

test("deduplica cuenta + item + SKU y prefiere Inventory sin perder Trading", () => {
  const groups = canonicalizeActiveListingProtectionRows([
    row({ id: "trading", source: "EBAY_TRADING_GET_ITEM_READONLY" }),
    row({
      id: "inventory",
      source: "EBAY_SELL_INVENTORY_READONLY",
      last_ebay_sync_at: "2026-07-13T09:00:00.000Z",
    }),
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].listing.id, "inventory")
  assert.deepEqual(groups[0].memberListingIds, ["inventory", "trading"])
  assert.deepEqual(
    groups[0].observations.map((observation) => observation.source),
    ["EBAY_SELL_INVENTORY_READONLY", "EBAY_TRADING_GET_ITEM_READONLY"],
  )
})

test("normaliza SKU vacío y lo asocia sólo cuando hay un único SKU concreto", () => {
  const groups = canonicalizeActiveListingProtectionRows([
    row({ id: "trading-null", ebay_sku: "  " }),
    row({
      id: "inventory",
      source: "EBAY_SELL_INVENTORY_READONLY",
      ebay_sku: "  IMNOVA-ABC  ",
    }),
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].ebaySku, "IMNOVA-ABC")
  assert.equal(groups[0].observations[1].ebaySku, null)
})

test("un SKU ausente no se mezcla con variaciones ambiguas", () => {
  const groups = canonicalizeActiveListingProtectionRows([
    row({ id: "trading-null", ebay_sku: null }),
    row({
      id: "inventory-a",
      source: "EBAY_SELL_INVENTORY_READONLY",
      ebay_sku: "VAR-A",
    }),
    row({
      id: "inventory-b",
      source: "EBAY_SELL_INVENTORY_READONLY",
      ebay_sku: "VAR-B",
    }),
  ])

  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((group) => group.ebaySku).sort((left, right) =>
      String(left).localeCompare(String(right))
    ),
    [null, "VAR-A", "VAR-B"],
  )
})

test("conserva exactamente el status de la fuente preferida", () => {
  const groups = canonicalizeActiveListingProtectionRows([
    row({ id: "trading", listing_status: "active" }),
    row({
      id: "inventory",
      source: "EBAY_SELL_INVENTORY_READONLY",
      listing_status: "ended",
    }),
  ])

  assert.equal(groups[0].listing.listing_status, "ended")
  assert.deepEqual(
    groups[0].observations.map(({ listingId, listingStatus }) => ({
      listingId,
      listingStatus,
    })),
    [
      { listingId: "inventory", listingStatus: "ended" },
      { listingId: "trading", listingStatus: "active" },
    ],
  )
})

test("no mezcla cuentas ni SKUs que sólo difieren por mayúsculas", () => {
  const groups = canonicalizeActiveListingProtectionRows([
    row({ id: "upper", ebay_sku: "VAR-A" }),
    row({ id: "lower", ebay_sku: "var-a" }),
    row({ id: "other-account", account_key: "other:abc", ebay_sku: "VAR-A" }),
  ])

  assert.equal(groups.length, 3)
})

const current = (overrides = {}) => ({
  product_id: "11111111-1111-4111-8111-111111111111",
  source_key: "lunaportex",
  supplier_variant_id: "48809640722656",
  sku: "ITEM3995",
  ...overrides,
})

test("exact Luna SKU and variant resolve one current identity", () => {
  assert.deepEqual(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "ITEM3995",
    supplierVariantId: "48809640722656",
  }, [current()]), {
    status: "resolved",
    productId: "11111111-1111-4111-8111-111111111111",
    supplierVariantId: "48809640722656",
    supplierSku: "ITEM3995",
  })
})

test("supplier SKU matching is case-sensitive", () => {
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "item3995",
    supplierVariantId: "48809640722656",
  }, [current()]).status, "missing")
})

test("an exact variant can safely disambiguate a repeated SKU", () => {
  const second = current({
    product_id: "22222222-2222-4222-8222-222222222222",
    supplier_variant_id: "second-variant",
  })
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "ITEM3995",
    supplierVariantId: "48809640722656",
  }, [current(), second]).status, "resolved")
})

test("multiple current product variants for a SKU remain ambiguous", () => {
  const second = current({
    product_id: "22222222-2222-4222-8222-222222222222",
    supplier_variant_id: "second-variant",
  })
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "ITEM3995",
    supplierVariantId: null,
  }, [current(), second]).status, "ambiguous")
})

test("duplicate observations of one identity do not create false ambiguity", () => {
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "ITEM3995",
    supplierVariantId: null,
  }, [current(), current()]).status, "resolved")
})

test("another source or a missing SKU never auto-links", () => {
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: "ITEM3995",
    supplierVariantId: null,
  }, [current({ source_key: "other" })]).status, "missing")
  assert.equal(resolveExactUniqueCurrentLunaVariant({
    supplierSku: null,
    supplierVariantId: "48809640722656",
  }, [current()]).status, "missing")
})

const activeListing = (overrides = {}) => ({
  id: "listing-1",
  account_key: "account-1",
  source: "EBAY_SELL_INVENTORY_READONLY",
  ebay_item_id: "366543596425",
  ebay_sku: "ITEM3995",
  listing_status: "active",
  last_ebay_sync_at: "2026-07-18T10:00:00.000Z",
  market_radar_product_id: "11111111-1111-4111-8111-111111111111",
  supplier_variant_id: "48809640722656",
  supplier_sku: "ITEM3995",
  last_radar_review_at: "2026-07-18T10:05:00.000Z",
  ...overrides,
})

test("monitor health needs fresh Luna and protection heartbeats plus exact mapping", () => {
  const health = projectActiveListingProtectionMonitorHealth({
    listings: [activeListing()],
    targetedMonitorLastSuccessAt: "2026-07-18T10:00:00.000Z",
    fullCatalogLastSuccessAt: "2026-07-15T10:00:00.000Z",
    targetedMonitorEnabled: true,
    now: new Date("2026-07-18T12:00:00.000Z"),
  })
  assert.equal(health.status, "ACTIVE")
  assert.deepEqual(health.reasons, [])
  assert.equal(health.luna.targetedMonitor.fresh, true)
  assert.equal(health.luna.fullCatalog.fresh, false)
})

test("a fresh full-catalog snapshot alone is not represented as targeted monitoring", () => {
  const health = projectActiveListingProtectionMonitorHealth({
    listings: [activeListing({
      market_radar_product_id: null,
      last_radar_review_at: null,
    })],
    targetedMonitorLastSuccessAt: null,
    fullCatalogLastSuccessAt: "2026-07-18T10:00:00.000Z",
    targetedMonitorEnabled: true,
    now: new Date("2026-07-18T12:00:00.000Z"),
  })
  assert.equal(health.status, "NOT_MONITORED")
  assert.deepEqual(health.reasons, [
    "ACTIVE_LISTING_LUNA_MAPPING_INCOMPLETE",
    "TARGETED_LUNA_MONITOR_HEARTBEAT_STALE",
    "ACTIVE_LISTING_PROTECTION_HEARTBEAT_STALE",
  ])
  assert.equal(health.luna.fullCatalog.fresh, true)
})

test("a recent targeted run with its feature disabled remains manual", () => {
  const health = projectActiveListingProtectionMonitorHealth({
    listings: [activeListing()],
    targetedMonitorLastSuccessAt: "2026-07-18T10:00:00.000Z",
    fullCatalogLastSuccessAt: null,
    targetedMonitorEnabled: false,
    now: new Date("2026-07-18T12:00:00.000Z"),
  })
  assert.equal(health.status, "MANUAL_RECENT")
  assert.deepEqual(health.reasons, ["TARGETED_LUNA_MONITOR_FEATURE_DISABLED"])
  assert.equal(health.automaticScheduleActive, false)
})

test("an open mapping-broken risk blocks an otherwise populated identity", () => {
  const health = projectActiveListingProtectionMonitorHealth({
    listings: [activeListing()],
    targetedMonitorLastSuccessAt: "2026-07-18T10:00:00.000Z",
    fullCatalogLastSuccessAt: "2026-07-18T10:00:00.000Z",
    targetedMonitorEnabled: true,
    openMappingBrokenListingIds: ["listing-1"],
    now: new Date("2026-07-18T12:00:00.000Z"),
  })
  assert.equal(health.status, "NOT_MONITORED")
  assert.equal(health.exactMappedActiveListings, 0)
  assert.ok(health.reasons.includes("ACTIVE_LISTING_LUNA_MAPPING_INCOMPLETE"))
})

test("a targeted heartbeat is required even when mapping, review and catalog are fresh", () => {
  const health = projectActiveListingProtectionMonitorHealth({
    listings: [activeListing()],
    targetedMonitorLastSuccessAt: null,
    fullCatalogLastSuccessAt: "2026-07-18T10:00:00.000Z",
    targetedMonitorEnabled: true,
    now: new Date("2026-07-18T12:00:00.000Z"),
  })
  assert.equal(health.status, "DEGRADED")
  assert.deepEqual(health.reasons, ["TARGETED_LUNA_MONITOR_HEARTBEAT_STALE"])
  assert.equal(health.luna.targetedMonitor.fresh, false)
  assert.equal(health.luna.fullCatalog.fresh, true)
})
