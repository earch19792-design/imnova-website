import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  detectProductResearchOfferFacts,
  parseProductResearchBrowserCapture,
  productResearchCapturePersistenceRows,
  targetFromVerifiedActiveListingLink,
} from "./ebay-product-research-browser-capture.ts"

const target = {
  id: "queue-pilot",
  queueItemId: "queue-pilot",
  supplierVariantId: "luna-item3995",
  productName: "Lysol Disinfecting Wipes Lemon",
  identity: {
    manufacturerBrand: "Lysol",
    gtin: "012345678905",
    productName: "Lysol Disinfecting Wipes Lemon",
    packCount: 3,
    unitCount: 15,
    size: "15 ct",
    scent: "lemon",
    variant: "lemon",
    condition: "new",
  },
}

function row(overrides = {}) {
  return {
    temporaryTitle: "Lysol Disinfecting Wipes Lemon 3 x 15 ct",
    listingId: "366543596425",
    averageSoldPrice: 19.98,
    averageShipping: 0,
    totalSold: 8,
    itemSales: 159.84,
    lastSoldDate: "2026-07-16",
    listingFormat: "Fixed Price",
    freeShippingPercent: 100,
    bids: 0,
    visibleImageCount: 1,
    detectedOfferPackCount: 3,
    detectedUnitCount: 15,
    detectedSize: "15 ct",
    detectedVariant: "lemon",
    ...overrides,
  }
}

function capture(rows = [row()], overrides = {}) {
  return {
    source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    captureId: "1f537cd5-b302-47bc-8491-2c9a63bb7777",
    listingSite: "www.ebay.com",
    pagePath: "/sh/research",
    searchQuery: "Lysol disinfecting wipes",
    dateRange: { label: "Last 30 days" },
    capturedAt: new Date().toISOString(),
    visibleResultCount: rows.length,
    visibleColumns: ["Title", "Average sold price", "Average shipping", "Total sold", "Last sold date"],
    rows,
    ...overrides,
  }
}

test("the controlled Lysol 6 x 80 ct sold row is pack/size intelligence, never an exact 3 x 15 ct comparable", () => {
  const result = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes Lemon Lot of 6 80 ct per pack",
    listingId: "123456789012",
    averageSoldPrice: 29.98,
    averageShipping: 0,
    totalSold: 18,
    itemSales: 539.64,
    lastSoldDate: "2026-07-16",
    detectedOfferPackCount: 6,
    detectedUnitCount: 80,
    detectedSize: "80 ct",
  })]), targets: [target] })
  assert.equal(result.matchCounts.exactLuna, 0)
  assert.equal(result.matchCounts.differentPack, 1)
  assert.equal(result.rows[0].matchClassification, "SAME_PRODUCT_DIFFERENT_PACK")
  assert.ok(result.rows[0].matchReasons.includes("PACK_COUNT_MISMATCH"))
  assert.ok(result.rows[0].matchReasons.includes("UNIT_COUNT_MISMATCH"))
  assert.ok(result.rows[0].matchReasons.includes("SIZE_MISMATCH"))
  assert.equal(result.rows[0].totalSold, 18)
  assert.equal(result.rows[0].averageSoldPrice, 29.98)
  assert.equal(result.rows[0].averageShipping, 0)
})

test("an exact strong Luna identity can enter confirmed sold evidence", () => {
  const result = parseProductResearchBrowserCapture({ capture: capture(), targets: [target] })
  assert.equal(result.matchCounts.exactLuna, 1)
  assert.equal(result.rows[0].matchClassification, "EXACT_LUNA_MATCH")
  assert.equal(result.rows[0].normalizedIdentity.packCount, 3)
  assert.equal(result.rows[0].normalizedIdentity.unitCount, 15)
})

test("a verified active listing link can classify pack intelligence but cannot manufacture an exact match", () => {
  const linkedTarget = targetFromVerifiedActiveListingLink({
    link: {
      id: "link-pilot",
      supplier_variant_id: "48809640722656",
      supplier_sku: "ITEM3995",
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
    },
    opportunity: {
      supplier_product_id: "9220829970656",
      product_title: "Lysol Disinfecting Wipes To-Go Pack, Lemon Scent",
      variant_title: "3 Pack · Default Title",
      gtin: null,
      assessment: { identity: { exactIdentityConfirmed: true } },
    },
  })
  assert.ok(linkedTarget)
  assert.equal(linkedTarget.officialLinkVerified, true)
  assert.equal(linkedTarget.identity.packCount, 3)
  assert.equal(linkedTarget.identity.gtin, null)

  const differentPack = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes To-Go Lemon Lot of 6 80 ct per pack",
    listingId: "123456789012",
    averageSoldPrice: 29.98,
    averageShipping: 0,
    totalSold: 18,
    lastSoldDate: "2026-07-16",
    detectedOfferPackCount: 6,
    detectedUnitCount: 80,
    detectedSize: "80 ct",
  })]), targets: [linkedTarget] })
  assert.equal(differentPack.rows[0].matchClassification, "SAME_PRODUCT_DIFFERENT_PACK")
  assert.equal(differentPack.matchCounts.exactLuna, 0)

  const samePack = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes To-Go Lemon 3 x 15 ct",
  })]), targets: [linkedTarget] })
  assert.equal(samePack.rows[0].matchClassification, "AMBIGUOUS")
  assert.equal(samePack.matchCounts.exactLuna, 0)
})

test("offer parsing distinguishes pack count, unit count and size", () => {
  assert.deepEqual(detectProductResearchOfferFacts(
    "Lysol Wipes Lemon Lot of 6 80 ct per pack",
  ), { packCount: 6, unitCount: 80, size: "80 ct" })
})

test("capture rejects non-official origins, missing query context and buyer/order fields", () => {
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture(undefined, { listingSite: "example.com" }), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_OFFICIAL_ORIGIN_REQUIRED/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture(undefined, { searchQuery: "" }), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_QUERY_CONTEXT_REQUIRED/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([{ ...row(), buyerEmail: "buyer@example.com" }]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_FORBIDDEN_FIELD/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([{ ...row(), orderId: "private-order" }]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_FORBIDDEN_FIELD/)
})

test("invalid quantities and dates never become sold observations", () => {
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([row({ totalSold: 0, lastSoldDate: "not-a-date" })]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_NO_VALID_SOLD_ROWS/)
})

test("deduplication is stable and persistence drops transient titles and page content", () => {
  const result = parseProductResearchBrowserCapture({
    capture: capture([row(), row()]), targets: [target],
  })
  assert.equal(result.rows.length, 1)
  assert.equal(result.duplicateWithinCaptureCount, 1)
  const stored = JSON.stringify(productResearchCapturePersistenceRows(result.rows))
  assert.doesNotMatch(stored, /Lysol Disinfecting Wipes Lemon 3 x 15 ct/)
  assert.doesNotMatch(stored, /temporaryTitle|pageHtml|imageUrl|buyer|orderId/i)
  assert.match(stored, /title_fingerprint/)
})

test("extension is origin-limited and transfers structured visible rows without network scraping", () => {
  const manifest = JSON.parse(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/manifest.json", "utf8",
  ))
  const content = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  assert.deepEqual(manifest.host_permissions, ["https://www.ebay.com/sh/research*"])
  assert.deepEqual(manifest.permissions, [])
  assert.match(content, /Capturar resultados para Seller OS/)
  assert.match(content, /Product Research · v1\.0\.1/)
  assert.match(content, /let statusElement = null/)
  assert.match(content, /statusElement = status/)
  assert.match(content, /Leyendo la tabla visible de Product Research/)
  assert.match(content, /PRODUCT_RESEARCH_RECEIVER_NOT_READY/)
  assert.doesNotMatch(content, /document\.getElementById\("imnova-product-research-capture-status"\)/)
  assert.equal(manifest.version, "1.0.1")
  assert.match(content, /\^\\\/sh\\\/research/)
  assert.match(content, /postMessage/)
  assert.doesNotMatch(content, /\bfetch\s*\(|document\.cookie|localStorage|outerHTML|innerHTML/)
  assert.doesNotMatch(content, /\.src\b|getAttribute\(["']src/)
  const archive = readFileSync(
    "public/seller-os-tools/ebay-product-research-capture-extension-v1.0.1.zip",
  )
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304")
  assert.ok(archive.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])))
})

test("receiver validates eBay origin and route resumes the same Loop 1 run without Discovery or writes", () => {
  const receiver = readFileSync(
    "app/admin/ebay/mobile-review/product-research-capture/page.tsx", "utf8",
  )
  const route = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8",
  )
  assert.match(receiver, /event\.origin !== EBAY_PRODUCT_RESEARCH_ORIGIN/)
  assert.match(receiver, /event\.source !== opener/)
  assert.doesNotMatch(receiver, /temporaryTitle/)
  assert.match(route, /sameRunResumed: true, discoveryRepeated: false/)
  assert.match(route, /openAiCalls: 0, ebayWrites: 0, canPublish: false/)
  assert.doesNotMatch(route, /publishOffer|createOffer|shipping_fulfillment/)
})

test("migration is additive, append-only, RLS protected and stores no sensitive browser content", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717022000_create_product_research_browser_capture.sql", "utf8",
  )
  assert.doesNotMatch(migration, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all[^;]+anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+update|grant[^;]+delete/i)
  assert.match(migration, /raw_html_stored boolean not null default false/)
  assert.match(migration, /temporary_title_stored boolean not null default false/)
  assert.match(migration, /competitor_image_downloaded boolean not null default false/)
  assert.match(migration, /pii_stored boolean not null default false/)
})
