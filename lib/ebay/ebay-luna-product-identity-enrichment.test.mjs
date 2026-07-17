import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  automaticQualification,
  buildEbayCatalogIdentityEvidence,
  buildExactComparableConsensus,
  buildLunaStructuredIdentityEvidence,
  canonicalContentsFromPack,
  classifyComparableAgainstLunaSupply,
  conservativeLogistics,
  resolveProductIdentity,
  selectCatalogIdentityMatches,
} from "./ebay-luna-product-identity-enrichment.ts"

const observedAt = "2026-07-16T20:00:00.000Z"

function comparable(overrides = {}) {
  return {
    listingIdentifier: `listing-${Math.random()}`,
    sellerIdentifier: `seller-${Math.random()}`,
    productName: "Acme Citrus Cleaner 16 oz 3 Pack",
    brand: "Acme", manufacturer: "Acme Corp", gtin: "036000291452",
    mpn: "AC16", model: "AC16", packCount: 3, unitCount: 16,
    size: "16 oz", color: "yellow", scent: "citrus", variant: "spray",
    condition: "new", categoryId: "123", aspects: [], ...overrides,
  }
}

test("Luna remains supply source and vendor is never promoted to brand", () => {
  const rows = buildLunaStructuredIdentityEvidence({ sourceIdentifier: "luna:1", observedAt,
    title: "Acme Citrus Cleaner 16 oz", variantTitle: "3 Pack", vendor: "Luna Portex",
    barcode: null, metadata: {}, weight: 2, weightUnit: "lb" })
  assert.equal(rows.some((row) => row.attribute === "brand" && row.normalizedValue === "Luna Portex"), false)
  assert.equal(rows.find((row) => row.attribute === "packCount")?.normalizedValue, 3)
})

test("invalid GTIN is retained only as INVALID provenance and never canonical", () => {
  const rows = buildLunaStructuredIdentityEvidence({ sourceIdentifier: "luna:2", observedAt,
    title: "Acme Cleaner", variantTitle: "Single", barcode: "036000291453",
    metadata: { brand: "Acme", packCount: 1 }, weight: 1, weightUnit: "lb" })
  const result = resolveProductIdentity(rows)
  assert.equal(result.identity.validGtin, null)
  assert.equal(rows.find((row) => row.attribute === "validGtin")?.conflictStatus, "INVALID")
})

test("ambiguous numbers do not become multipack evidence", () => {
  const rows = buildLunaStructuredIdentityEvidence({ sourceIdentifier: "luna:3", observedAt,
    title: "Acme Cleaner Model 900 16 oz", variantTitle: "Default", barcode: null,
    metadata: {}, weight: 1, weightUnit: "lb" })
  const pack = rows.find((row) => row.attribute === "packCount")
  assert.equal(pack?.normalizedValue, 1)
  assert.equal(pack?.verifiedByRule, "LUNA_SINGLE_SUPPLIER_OFFER_NO_MULTIPACK_SIGNAL")
})

test("unit GTIN is not inherited by a multipack without independent verification", () => {
  const luna = buildLunaStructuredIdentityEvidence({ sourceIdentifier: "luna:4", observedAt,
    title: "Acme Cleaner 3 Pack", variantTitle: "3 Pack", barcode: "036000291452",
    metadata: { brand: "Acme", packCount: 3 }, weight: 3, weightUnit: "lb" })
  assert.equal(resolveProductIdentity(luna).identity.validGtin, null)
})

test("different pack and variant are excluded before attribute inheritance", () => {
  assert.equal(classifyComparableAgainstLunaSupply({ supplyTitle: "Acme Citrus Cleaner 16 oz",
    supplyVariant: "spray", supplyPackCount: 3 }, comparable({ packCount: 6 })).classification,
  "DIFFERENT_PACK")
  assert.equal(classifyComparableAgainstLunaSupply({ supplyTitle: "Acme Citrus Cleaner 16 oz",
    supplyVariant: "spray", supplyPackCount: 3 }, comparable({ variant: "wipes" })).classification,
  "DIFFERENT_VARIANT")
})

test("unknown Luna pack never inherits a multipack from eBay", () => {
  assert.equal(classifyComparableAgainstLunaSupply({
    supplyTitle: "Vaseline Blue Seal Baby 50ml", supplyVariant: null, supplyPackCount: null,
  }, comparable({ productName: "Vaseline Blue Seal Baby 50ml 6 Pack", packCount: 6,
    size: "50ml", variant: null })).classification, "NEAR_MATCH")
  assert.equal(classifyComparableAgainstLunaSupply({
    supplyTitle: "Vaseline Blue Seal Baby 50ml", supplyVariant: null, supplyPackCount: 1,
  }, comparable({ productName: "Vaseline Blue Seal Baby 50ml 6 Pack", packCount: 6,
    size: "50ml", variant: null })).classification, "DIFFERENT_PACK")
})

test("a Luna single offer can match an eBay listing with no multipack signal", () => {
  assert.equal(classifyComparableAgainstLunaSupply({
    supplyTitle: "Lever 2000 Bar Soap Original 3.75 oz", supplyVariant: null,
    supplyPackCount: 1, supplySize: "3.75 oz",
  }, comparable({ productName: "Lever 2000 Bar Soap Original 3.75 oz", packCount: null,
    size: "3.75 oz", variant: null })).classification, "EXACT_MATCH")
})

test("exact contents never multiply a supplier title that already names its pack", () => {
  assert.deepEqual(canonicalContentsFromPack({
    productName: "2 Pack Reusable Oven Liners", packCount: 2,
  }), ["2 Pack Reusable Oven Liners"])
  assert.deepEqual(canonicalContentsFromPack({
    productName: "Acme Cleaner", packCount: 3,
  }), ["3 x Acme Cleaner"])
})

test("two exact sellers form consensus; one seller alone does not", () => {
  const one = buildExactComparableConsensus({ exactComparables: [comparable({ listingIdentifier: "1",
    sellerIdentifier: "seller-a" })], observedAt })
  assert.equal(one.fields.find((field) => field.attribute === "brand")?.acceptedValue, null)
  const two = buildExactComparableConsensus({ exactComparables: [
    comparable({ listingIdentifier: "1", sellerIdentifier: "seller-a" }),
    comparable({ listingIdentifier: "2", sellerIdentifier: "seller-b" }),
  ], observedAt })
  assert.equal(two.fields.find((field) => field.attribute === "brand")?.acceptedValue, "Acme")
  assert.equal(two.evidence.some((row) => row.attribute === "normalizedProductName"), false)
})

test("one exact listing plus Catalog confirmation forms auditable consensus", () => {
  const catalogProducts = [{ epid: "123", title: "Acme Citrus Cleaner 16 oz 3 Pack",
    brand: "Acme", gtins: ["036000291452"], mpns: ["AC16"],
    aspects: [{ name: "Number in Pack", values: ["3"] }], categoryId: "123" }]
  const catalog = buildEbayCatalogIdentityEvidence(catalogProducts, observedAt)
  const consensus = buildExactComparableConsensus({ exactComparables: [comparable({
    listingIdentifier: "1", sellerIdentifier: "seller-a" })], catalogEvidence: catalog, observedAt })
  assert.equal(consensus.fields.find((field) => field.attribute === "brand")?.catalogConfirmation, true)
  assert.equal(consensus.fields.find((field) => field.attribute === "brand")?.acceptedValue, "Acme")
})

test("critical conflicts are explicit and exclude canonical identity", () => {
  const catalog = buildEbayCatalogIdentityEvidence([
    { epid: "1", title: "Acme Cleaner", brand: "Acme", gtins: [], mpns: ["A"], aspects: [], categoryId: "1" },
    { epid: "2", title: "Other Cleaner", brand: "Other", gtins: [], mpns: ["B"], aspects: [], categoryId: "1" },
  ], observedAt)
  const resolved = resolveProductIdentity(catalog)
  assert.ok(resolved.conflicts.includes("brand"))
  assert.equal(resolved.identity.brand, null)
})

test("Catalog candidate selection accepts exact GTIN and rejects ambiguous titles", () => {
  const products = [
    { epid: "1", title: "Acme Cleaner", brand: "Acme", gtins: ["036000291452"], mpns: [], aspects: [], categoryId: "1" },
    { epid: "2", title: "Acme Cleaner", brand: "Acme", gtins: [], mpns: [], aspects: [], categoryId: "1" },
  ]
  assert.equal(selectCatalogIdentityMatches({ title: "x", gtin: "036000291452", brand: null, mpn: null }, products).matchRule,
    "EXACT_GTIN")
  assert.equal(selectCatalogIdentityMatches({ title: "Acme Cleaner", gtin: null, brand: null, mpn: null }, products).products.length, 0)
  assert.equal(selectCatalogIdentityMatches({ title: "x", gtin: "036000291452", brand: null,
    mpn: null, packCount: 3 }, [{ ...products[0], aspects: [{ name: "Number in Pack", values: ["1"] }] }]).products.length, 0)
})

test("conservative logistics is marked ESTIMATED and must remain economically safe", () => {
  const logistics = conservativeLogistics({ weight: null, dimensions: null, outboundReserveUsd: 8 })
  assert.equal(logistics.status, "ESTIMATED")
  assert.equal(logistics.outboundReserveUsd, 18)
  const identity = { manufacturer: "Acme", brand: "Acme", validGtin: "036000291452",
    mpn: null, model: null, normalizedProductName: "Acme Cleaner", packCount: 3,
    unitCount: 16, totalContents: ["3 x Acme Cleaner"], size: "16 oz", color: null,
    scent: "citrus", variant: "spray", condition: "new", weight: logistics.weight,
    dimensions: logistics.dimensions, categoryId: "123", requiredAspects: [{ name: "Brand", value: "Acme" }] }
  const ready = automaticQualification({ identity, conflicts: [], exactLunaMapping: true,
    exactComparableCount: 2, imageAuthorized: true, currentUrl: true,
    logisticsStatus: "ESTIMATED", conservativeEconomicsSafe: true, safePackStrategy: true,
    complianceBlocked: false, identityConsensusConfirmed: true })
  assert.equal(ready.status, "READY_FOR_PRICE_STOCK_CONFIRMATION")
  const unsafe = automaticQualification({ identity, conflicts: [], exactLunaMapping: true,
    exactComparableCount: 2, imageAuthorized: true, currentUrl: true,
    logisticsStatus: "ESTIMATED", conservativeEconomicsSafe: false, safePackStrategy: true,
    complianceBlocked: false, identityConsensusConfirmed: true })
  assert.equal(unsafe.visibleInTop20, false)
})

test("implementation remains read-only, hides internal rows and does not call OpenAI", () => {
  const service = readFileSync(new URL("./ebay-listing-ai-approval-queue-service.ts", import.meta.url), "utf8")
  const gateway = readFileSync(new URL("./ebay-seller-keyword-demand-gateway.ts", import.meta.url), "utf8")
  assert.match(gateway, /async function getEbayJson[\s\S]*?method:\s*"GET"/)
  assert.doesNotMatch(gateway, /publishOffer|shipping_fulfillment/)
  assert.match(service, /openAiCalls:\s*0/)
  assert.match(service, /currentItems\.filter/)
  assert.doesNotMatch(service, /publishOffer|shipping_fulfillment/)
})
