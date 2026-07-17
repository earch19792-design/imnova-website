import assert from "node:assert/strict"
import test from "node:test"

import {
  canonicalizeActiveListingProtectionRows,
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
