import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  authoritativeRealizedTransactionPrice,
  deduplicateOfficialSoldEvidence,
  oneClickSoldEvidenceNoValidRowsCode,
  officialSoldEvidenceComparablesForTarget,
  officialSoldEvidenceCoverage,
  officialSoldPackIntelligenceForTarget,
  parseOfficialSoldEvidenceImport,
  soldEvidenceNoValidRowsDiagnostic,
  soldPriceEvidenceForPositioning,
} from "./ebay-official-sold-evidence-import.ts"
import { classifyWinnerComparable, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"

const now = new Date("2026-07-17T12:00:00.000Z")

function csvRow(overrides = {}) {
  return {
    itemId: "366543596425",
    observedAt: "2026-07-16T00:00:00.000Z",
    quantitySold: "4",
    price: "39.99",
    shippingCost: "0",
    brand: "Lysol",
    upc: "012345678905",
    title: "Lysol Lemon Wipes 15 Count Three Pack Original Listing Title",
    packCount: "3",
    unitCount: "15",
    size: "15 ct",
    scent: "Lemon",
    condition: "New",
    imageCount: "6",
    fullPackVisible: "true",
    ...overrides,
  }
}

function csv(rows) {
  const headers = Object.keys(rows[0])
  return [headers.join(","), ...rows.map((row) => headers.map((key) => row[key] ?? "").join(","))]
    .join("\n")
}

test("imports reviewed official sold rows without retaining titles, listing IDs, images, sellers or PII", () => {
  const title = "Lysol Lemon Wipes 15 Count Three Pack Original Listing Title"
  const result = parseOfficialSoldEvidenceImport({
    format: "CSV",
    sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow(), csvRow({ itemId: "366543596426", title })]),
    now,
  })
  assert.equal(result.rowCount, 2)
  assert.equal(result.sourceRowCount, 2)
  assert.equal(result.evidenceScope, "MARKET_WIDE_SOLD_EVIDENCE")
  assert.equal(result.confirmedSaleCount, 2)
  assert.equal(result.completedWithoutSaleCount, 0)
  assert.equal(result.observations.length, 2)
  assert.equal(result.rawFileStored, false)
  assert.equal(result.competitorTitlesStored, false)
  assert.equal(result.sellerIdentitiesStored, false)
  assert.equal(result.competitorImageUrlsStored, false)
  assert.equal(result.piiStored, false)
  const stored = JSON.stringify(result.observations)
  assert.doesNotMatch(stored, new RegExp(title))
  assert.doesNotMatch(stored, /366543596425/)
  assert.equal(result.observations[0].normalizedIdentity.normalizedProductName, null)
  assert.match(result.observations[0].sourceListingReferenceHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(result.observations[0].visualEvidence.fullPackVisible, true)
})

test("duplicate rows in one broad export are counted once before persistence", () => {
  const parsed = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow(), csvRow()]), now,
  })
  const deduplicated = deduplicateOfficialSoldEvidence(parsed.observations)
  assert.equal(deduplicated.observations.length, 1)
  assert.equal(deduplicated.duplicateCount, 1)
})

test("source semantics keep Seller Hub own-account unless its schema proves a market-wide export", () => {
  const productResearch = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow()]), now,
  })
  const marketplaceInsights = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_MARKETPLACE_INSIGHTS_EXPORT",
    content: csv([csvRow()]), now,
  })
  const sellerHub = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: csv([csvRow()]), now,
  })
  const sellerHubProductResearch = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: csv([csvRow({ reportType: "eBay Product Research" })]), now,
  })
  assert.equal(productResearch.evidenceScope, "MARKET_WIDE_SOLD_EVIDENCE")
  assert.equal(marketplaceInsights.evidenceScope, "MARKET_WIDE_SOLD_EVIDENCE")
  assert.equal(sellerHub.evidenceScope, "OWN_ACCOUNT_SOLD_EVIDENCE")
  assert.equal(sellerHub.marketWideSchemaConfirmed, false)
  assert.equal(sellerHubProductResearch.evidenceScope, "MARKET_WIDE_SOLD_EVIDENCE")
  assert.equal(sellerHubProductResearch.marketWideSchemaConfirmed, true)
})

test("durably separates a displayed sold price from a proven realized transaction price", () => {
  const result = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MARKETPLACE_INSIGHTS_EXPORT", now,
    content: JSON.stringify([{ ...csvRow(),
      displayedSoldPriceAmount: 39.99, displayedSoldPriceCurrency: "USD",
      realizedTransactionPriceAmount: 37.5, realizedTransactionPriceCurrency: "USD",
      realizedPriceStatus: "PROVEN", bestOfferStatus: "EXPLICIT_ABSENT",
      visibleShippingAmount: 6.99, visibleShippingCurrency: "USD",
      shippingStatus: "OBSERVED", priceEvidenceProvenance: "OFFICIAL_API_TRANSACTION",
    }]),
  })
  const row = result.observations[0]
  assert.equal(row.sourceClass, "OFFICIAL_API")
  assert.equal(row.displayedSoldPriceAmount, 39.99)
  assert.equal(row.realizedTransactionPriceAmount, 37.5)
  assert.equal(row.realizedPriceStatus, "PROVEN")
  assert.equal(authoritativeRealizedTransactionPrice({
    source_type: "EBAY_OFFICIAL_JSON_IMPORT", source_class: row.sourceClass,
    source_listing_reference_hash: row.sourceListingReferenceHash,
    normalized_identity: row.normalizedIdentity, confirmed_sold_quantity: 4,
    evidence_scope: row.evidenceScope, sale_confirmation_basis: row.saleConfirmationBasis,
    item_price: row.itemPrice, shipping_cost: row.shippingCost,
    realized_transaction_price_amount: row.realizedTransactionPriceAmount,
    realized_transaction_price_currency: row.realizedTransactionPriceCurrency,
    realized_price_status: row.realizedPriceStatus,
    keyword_signals: [], shipping_pattern: null, returns_pattern: null,
    image_count: null, visual_evidence: {}, observed_at: row.observedAt,
  }), 37.5)
})

test("Main Search Sold preserves displayed price while realized price remains unproven", () => {
  const result = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([{ ...csvRow(), capturedAt: "2026-07-17T11:59:00.000Z",
      queryOrResearchIdentity: "lysol lemon wipes sold",
      displayedSoldPriceAmount: 39.99, displayedSoldPriceCurrency: "USD",
      realizedTransactionPriceAmount: 39.99, realizedTransactionPriceCurrency: "USD",
      realizedPriceStatus: "UNPROVEN", bestOfferStatus: "EXPLICIT_ABSENT",
      visibleShippingAmount: 6.99, visibleShippingCurrency: "USD",
    }]),
  })
  const row = result.observations[0]
  assert.equal(result.sourceType, "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE")
  assert.equal(row.sourceClass, "MAIN_SEARCH_SOLD")
  assert.equal(row.itemId, "366543596425")
  assert.equal(row.itemPrice, null)
  assert.equal(row.realizedTransactionPriceAmount, null)
  assert.equal(row.realizedPriceStatus, "UNPROVEN")
  assert.match(row.queryOrResearchIdentity, /^sha256:[0-9a-f]{64}$/)
  const stored = {
    source_type: result.sourceType, source_class: row.sourceClass,
    source_listing_reference_hash: row.sourceListingReferenceHash,
    normalized_identity: row.normalizedIdentity, confirmed_sold_quantity: 4,
    evidence_scope: row.evidenceScope, sale_confirmation_basis: row.saleConfirmationBasis,
    item_price: null, shipping_cost: null,
    displayed_sold_price_amount: row.displayedSoldPriceAmount,
    displayed_sold_price_currency: row.displayedSoldPriceCurrency,
    realized_transaction_price_amount: null, realized_transaction_price_currency: null,
    realized_price_status: "UNPROVEN", keyword_signals: [], shipping_pattern: null,
    returns_pattern: null, image_count: null, visual_evidence: {}, observed_at: row.observedAt,
  }
  const positioning = soldPriceEvidenceForPositioning(stored)
  assert.deepEqual(positioning, { amount: 39.99, currency: "USD",
    semantics: "DISPLAYED_SOLD_PRICE", authoritativeRealizedPrice: false })
  const comparables = officialSoldEvidenceComparablesForTarget({
    targetIdentity: { manufacturerBrand: "Lysol", gtin: "012345678905",
      productName: "Lysol wipes", packCount: 3 },
    rows: [stored],
  })
  assert.equal(comparables.length, 1)
  assert.equal(comparables[0].itemPrice, null)
  assert.equal(comparables[0].shippingCost, null)
})

test("Best Offer ambiguity can never promote a displayed price to realized price", () => {
  const parsed = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([{ ...csvRow(), capturedAt: now.toISOString(),
      queryOrResearchIdentity: "lysol sold", displayedSoldPriceAmount: 39.99,
      bestOfferStatus: "EXPLICIT_PRESENT", realizedTransactionPriceAmount: 35,
      realizedPriceStatus: "UNPROVEN", shippingStatus: "UNAVAILABLE",
    }]),
  })
  assert.equal(parsed.observations[0].bestOfferStatus, "EXPLICIT_PRESENT")
  assert.equal(parsed.observations[0].realizedTransactionPriceAmount, null)
  assert.equal(parsed.observations[0].realizedPriceStatus, "UNPROVEN")
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([{ ...csvRow(), capturedAt: now.toISOString(),
      queryOrResearchIdentity: "lysol sold", displayedSoldPriceAmount: 39.99,
      bestOfferStatus: "EXPLICIT_PRESENT", realizedTransactionPriceAmount: 35,
      realizedPriceStatus: "PROVEN" }]),
  }), /SOLD_EVIDENCE_NO_VALID_ROWS/)
})

test("explicit no-Best-Offer marker does not itself prove realized price and missing shipping stays unavailable", () => {
  const parsed = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([{ ...csvRow(), capturedAt: now.toISOString(),
      queryOrResearchIdentity: "lysol sold", displayedSoldPriceAmount: 39.99,
      bestOfferStatus: "EXPLICIT_ABSENT" }]),
  })
  const row = parsed.observations[0]
  assert.equal(row.bestOfferStatus, "EXPLICIT_ABSENT")
  assert.equal(row.realizedPriceStatus, "UNPROVEN")
  assert.equal(row.realizedTransactionPriceAmount, null)
  assert.equal(row.shippingStatus, "UNAVAILABLE")
  assert.equal(row.visibleShippingAmount, null)
})

test("provenance replay is deterministic and Product Research aggregate semantics remain unchanged", () => {
  const input = { format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow()]), now }
  const first = parseOfficialSoldEvidenceImport(input)
  const replay = parseOfficialSoldEvidenceImport(input)
  assert.equal(first.observations[0].evidenceDigest, replay.observations[0].evidenceDigest)
  assert.equal(first.observations[0].evidenceDeduplicationKey,
    replay.observations[0].evidenceDeduplicationKey)
  assert.equal(first.observations[0].sourceClass, "OFFICIAL_PRODUCT_RESEARCH")
  assert.equal(first.observations[0].itemPrice, 39.99)
  assert.equal(first.observations[0].realizedPriceStatus, "UNAVAILABLE")
})

test("completed without a confirmed sale is reported separately and never becomes sold evidence", () => {
  const result = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow({ quantitySold: "0", status: "Completed" })]), now,
  })
  assert.equal(result.sourceRowCount, 1)
  assert.equal(result.validCount, 1)
  assert.equal(result.confirmedSaleCount, 0)
  assert.equal(result.completedWithoutSaleCount, 1)
  assert.equal(result.rejectedCount, 0)
  assert.equal(result.observations.length, 0)
})

test("an explicit confirmed-sale indicator is accepted without inventing more than one unit", () => {
  const result = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: JSON.stringify({ reportType: "Seller Hub sales", rows: [
      csvRow({ quantitySold: "", saleConfirmed: true }),
    ] }), now,
  })
  assert.equal(result.evidenceScope, "OWN_ACCOUNT_SOLD_EVIDENCE")
  assert.equal(result.observations[0].confirmedSoldQuantity, 1)
  assert.equal(result.observations[0].saleConfirmationBasis,
    "EXPLICIT_CONFIRMED_SALE_MINIMUM_ONE")
})

test("rejects a complete import when buyer, order or contact columns are present", () => {
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: csv([csvRow({ buyerEmail: "buyer@example.com" })]), now,
  }), /SOLD_EVIDENCE_PII_COLUMNS_REJECTED/)
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: JSON.stringify([{ ...csvRow(), orderId: "private-order" }]), now,
  }), /SOLD_EVIDENCE_PII_COLUMNS_REJECTED/)
})

test("invalid identifiers and ambiguous packs never become sold evidence", () => {
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow({ upc: "123", brand: "", mpn: "", model: "", packCount: "" })]), now,
  }), /SOLD_EVIDENCE_NO_VALID_ROWS/)
})

test("zero-valid one-click evidence exposes bounded aggregate reasons without weakening gates", () => {
  let diagnostic = null
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([
      { ...csvRow({ brand: "", upc: "", mpn: "", model: "", packCount: "" }),
        capturedAt: now.toISOString(), queryOrResearchIdentity: "agate stone",
        displayedSoldPriceAmount: 18.99, realizedPriceStatus: "UNPROVEN" },
      { ...csvRow({ brand: "", upc: "", mpn: "", model: "", packCount: "" }),
        itemId: "366543596426", capturedAt: now.toISOString(),
        queryOrResearchIdentity: "agate stone", displayedSoldPriceAmount: 22.99,
        realizedPriceStatus: "UNPROVEN" },
    ]),
  }), (error) => {
    diagnostic = soldEvidenceNoValidRowsDiagnostic(error)
    return error instanceof Error && error.message === "SOLD_EVIDENCE_NO_VALID_ROWS"
  })
  assert.deepEqual(diagnostic, {
    sourceRowCount: 2,
    rejectedCount: 2,
    errorCounts: { STRONG_PRODUCT_IDENTIFIER_REQUIRED: 2 },
  })
  assert.equal(oneClickSoldEvidenceNoValidRowsCode({
    observedCount: 2, parsedCount: 2, diagnostic,
  }), "SOLD_EVIDENCE_NO_VALID_ROWS:OBSERVED_2:PARSED_2:NORMALIZED_2:" +
    "VALID_0:REJECTED_2:DUPLICATE_NOT_REACHED:STRONG_PRODUCT_IDENTIFIER_REQUIRED_2")
})

test("pack-unknown Sold rows preserve a safe commercial signal without becoming exact comparable", () => {
  const parsed = parseOfficialSoldEvidenceImport({
    format: "JSON", sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE", now,
    content: JSON.stringify([{ ...csvRow({ packCount: "" }),
      capturedAt: now.toISOString(), queryOrResearchIdentity: "lysol wipes",
      displayedSoldPriceAmount: 39.99, displayedSoldPriceCurrency: "USD",
      realizedPriceStatus: "UNPROVEN", bestOfferStatus: "EXPLICIT_PRESENT",
    }]),
  })
  assert.equal(parsed.observations.length, 0)
  assert.equal(parsed.commercialPackSignals.length, 1)
  assert.equal(parsed.packSignalsPreservedCount, 1)
  assert.equal(parsed.canonicalComparableCount, 0)
  assert.equal(parsed.validCount, 1)
  assert.equal(parsed.confirmedSaleCount, 1)
  assert.equal(parsed.rejectedCount, 1)
  assert.equal(parsed.hardRejectedCount, 0)
  assert.deepEqual(parsed.errorCounts, { PACK_COUNT_REQUIRED: 1 })
  assert.equal(parsed.commercialPackSignals[0].packEvidenceStatus, "UNKNOWN")
  assert.equal(parsed.commercialPackSignals[0].normalizedIdentity.packCount, null)
  assert.equal(parsed.commercialPackSignals[0].realizedTransactionPriceAmount, null)
  assert.equal(parsed.commercialPackSignals[0].realizedPriceStatus, "UNPROVEN")
})

test("single, two-pack and three-pack Sold evidence remain distinct commercial configurations", () => {
  const target = {
    manufacturerBrand: "Lysol", gtin: "012345678905", productName: "Lysol wipes lemon",
    packCount: 3, unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
  }
  const base = {
    source_type: "EBAY_OFFICIAL_CSV_IMPORT",
    source_class: "OFFICIAL_PRODUCT_RESEARCH",
    confirmed_sold_quantity: 2,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: 30,
    shipping_cost: 0,
    keyword_signals: [],
    shipping_pattern: null,
    returns_pattern: null,
    image_count: null,
    visual_evidence: {},
    observed_at: "2026-07-16T00:00:00.000Z",
  }
  const rows = [1, 2, 3].map((packCount, index) => ({
    ...base,
    source_listing_reference_hash: `sha256:${String(index + 1).repeat(64)}`,
    normalized_identity: normalizeProductIdentity({ ...target, packCount }),
  }))
  const signals = officialSoldPackIntelligenceForTarget({ targetIdentity: target, rows })
  assert.deepEqual(signals.map((signal) => [signal.packCount, signal.classification]), [
    [1, "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT"],
    [2, "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT"],
    [3, "EXACT_PACK_COMPARABLE"],
  ])
  assert.deepEqual(signals.map((signal) => signal.pricePerUnit), [2, 1, 0.67])
})

test("unknown pack cannot produce per-unit price or contaminate exact direct pricing", () => {
  const target = {
    manufacturerBrand: "Lysol", gtin: "012345678905", productName: "Lysol wipes lemon",
    packCount: 3, unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
  }
  const unknown = {
    source_type: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
    source_class: "MAIN_SEARCH_SOLD",
    source_listing_reference_hash: `sha256:${"e".repeat(64)}`,
    normalized_identity: normalizeProductIdentity({ ...target, packCount: null }),
    confirmed_sold_quantity: 1,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: null,
    shipping_cost: null,
    displayed_sold_price_amount: 39.99,
    displayed_sold_price_currency: "USD",
    realized_transaction_price_amount: null,
    realized_transaction_price_currency: null,
    realized_price_status: "UNPROVEN",
    best_offer_status: "UNKNOWN",
    keyword_signals: [], shipping_pattern: null, returns_pattern: null,
    image_count: null, visual_evidence: {}, observed_at: "2026-07-16T00:00:00.000Z",
  }
  const [signal] = officialSoldPackIntelligenceForTarget({ targetIdentity: target, rows: [unknown] })
  assert.equal(signal.classification, "PACK_UNKNOWN")
  assert.equal(signal.pricePerUnit, null)
  assert.equal(signal.recentSoldPrice.semantics, "DISPLAYED_SOLD_PRICE")
  assert.equal(officialSoldEvidenceComparablesForTarget({ targetIdentity: target,
    rows: [unknown] }).length, 0)
})

test("duplicate pack signals replay deterministically without creating a second Sold identity", () => {
  const parsed = parseOfficialSoldEvidenceImport({
    format: "CSV", sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow({ packCount: "" }), csvRow({ packCount: "" })]), now,
  })
  const replay = deduplicateOfficialSoldEvidence(parsed.commercialPackSignals)
  assert.equal(replay.observations.length, 1)
  assert.equal(replay.duplicateCount, 1)
  assert.equal(parsed.commercialPackSignals[0].evidenceDigest,
    parsed.commercialPackSignals[1].evidenceDigest)
})

test("ePID never substitutes for the listing Item ID", () => {
  assert.throws(() => parseOfficialSoldEvidenceImport({
    format: "CSV",
    sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: csv([csvRow({ itemId: "", ePID: "123456789" })]),
    now,
  }), /SOLD_EVIDENCE_NO_VALID_ROWS/)
})

test("strict identifiers link sold evidence while pack and variant differences remain classified", () => {
  const target = {
    manufacturerBrand: "Lysol", gtin: "012345678905", productName: "Lysol wipes lemon",
    packCount: 3, unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
  }
  const row = {
    source_type: "EBAY_OFFICIAL_CSV_IMPORT",
    source_listing_reference_hash: `sha256:${"a".repeat(64)}`,
    normalized_identity: normalizeProductIdentity({
      manufacturerBrand: "Lysol", gtin: "012345678905", packCount: 3,
      unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
    }),
    confirmed_sold_quantity: 4,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: 39.99,
    shipping_cost: 0,
    keyword_signals: ["lemon", "wipes"],
    shipping_pattern: "FREE_SHIPPING",
    returns_pattern: null,
    image_count: 6,
    visual_evidence: { imageCount: 6, fullPackVisible: true },
    observed_at: "2026-07-16T00:00:00.000Z",
  }
  const exact = officialSoldEvidenceComparablesForTarget({ targetIdentity: target, rows: [row] })
  assert.equal(exact.length, 1)
  assert.equal(classifyWinnerComparable(target, exact[0].identity).classification, "EXACT_MATCH")
  assert.equal(exact[0].evidenceReviewed, true)
  assert.equal(exact[0].confirmedSoldQuantity, 4)

  const differentPackRow = { ...row, normalized_identity: {
    ...row.normalized_identity, packCount: 6,
  } }
  const differentPack = officialSoldEvidenceComparablesForTarget({
    targetIdentity: target, rows: [differentPackRow],
  })
  assert.equal(differentPack.length, 0)

  const unrelated = officialSoldEvidenceComparablesForTarget({
    targetIdentity: { ...target, gtin: "036000291452", manufacturerBrand: "Other" }, rows: [row],
  })
  assert.equal(unrelated.length, 0)
})

test("browser capture keeps exact sold evidence and different-pack intelligence separate", () => {
  const target = {
    manufacturerBrand: "Lysol", gtin: "012345678905", productName: "Lysol wipes lemon",
    packCount: 3, unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
  }
  const browserRow = {
    source_type: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    source_listing_reference_hash: `sha256:${"c".repeat(64)}`,
    normalized_identity: normalizeProductIdentity(target),
    confirmed_sold_quantity: 18,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: 29.98,
    shipping_cost: 0,
    keyword_signals: ["lysol", "wipes", "lemon"],
    shipping_pattern: "FREE_SHIPPING",
    returns_pattern: null,
    image_count: 1,
    visual_evidence: { imageCount: 1, evidenceLevel: "LOW" },
    observed_at: new Date().toISOString(),
    match_classification: "EXACT_LUNA_MATCH",
    matched_supplier_variant_id: "48809640722656",
  }
  const exact = officialSoldEvidenceComparablesForTarget({
    targetIdentity: target, rows: [browserRow], targetSupplierVariantId: "48809640722656",
  })
  assert.equal(exact.length, 1)
  assert.equal(classifyWinnerComparable(target, exact[0].identity).classification, "EXACT_MATCH")

  const differentPackRow = {
    ...browserRow,
    source_listing_reference_hash: `sha256:${"d".repeat(64)}`,
    normalized_identity: normalizeProductIdentity({ ...target, gtin: null,
      packCount: 6, unitCount: 80, size: "80 ct" }),
    match_classification: "SAME_PRODUCT_DIFFERENT_PACK",
  }
  const packIntelligence = officialSoldEvidenceComparablesForTarget({
    targetIdentity: target, rows: [differentPackRow],
    targetSupplierVariantId: "48809640722656",
  })
  assert.equal(packIntelligence.length, 1)
  assert.equal(classifyWinnerComparable(target, packIntelligence[0].identity).classification,
    "DIFFERENT_PACK")
  assert.equal(packIntelligence[0].confirmedSoldQuantity, 18)

  const wrongSupplier = officialSoldEvidenceComparablesForTarget({
    targetIdentity: target, rows: [differentPackRow], targetSupplierVariantId: "other-variant",
  })
  assert.equal(wrongSupplier.length, 0)
})

test("coverage reports exact, ambiguous and missing Luna matches without weakening exact pack matching", () => {
  const target = {
    manufacturerBrand: "Lysol", gtin: "012345678905", productName: "Lysol wipes lemon",
    packCount: 3, unitCount: 15, size: "15 ct", scent: "lemon", condition: "new",
  }
  const row = {
    source_type: "EBAY_OFFICIAL_CSV_IMPORT",
    source_listing_reference_hash: `sha256:${"b".repeat(64)}`,
    normalized_identity: normalizeProductIdentity(target),
    confirmed_sold_quantity: 2,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: 39.99, shipping_cost: 0, keyword_signals: [], shipping_pattern: null,
    returns_pattern: null, image_count: null, visual_evidence: {},
    observed_at: "2026-07-16T00:00:00.000Z",
  }
  assert.deepEqual(officialSoldEvidenceCoverage({ rows: [row], targets: [
    { id: "one", identity: target },
  ] }), { exactMatches: 1, ambiguousMatches: 0, withoutLunaMatch: 0,
    top20CandidatesEnriched: 1 })
  assert.equal(officialSoldEvidenceCoverage({ rows: [row], targets: [
    { id: "one", identity: target }, { id: "two", identity: target },
  ] }).ambiguousMatches, 1)
  assert.equal(officialSoldEvidenceCoverage({ rows: [row], targets: [
    { id: "pack-six", identity: { ...target, packCount: 6 } },
  ] }).withoutLunaMatch, 1)
})

test("migration is additive, RLS protected, append-only to clients and stores no raw competitive content", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717020000_create_official_sold_evidence_import.sql", "utf8",
  )
  assert.doesNotMatch(migration, /drop\s+table|delete\s+from|truncate/i)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all[^;]+anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+update|grant[^;]+delete/i)
  assert.match(migration, /competitor_title_stored boolean not null default false/)
  assert.match(migration, /competitor_image_downloaded boolean not null default false/)
  assert.match(migration, /pii_stored boolean not null default false/)
  const clarification = readFileSync(
    "supabase/migrations/20260717021000_classify_official_sold_evidence_sources.sql", "utf8",
  )
  assert.doesNotMatch(clarification, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(clarification, /MARKET_WIDE_SOLD_EVIDENCE/)
  assert.match(clarification, /OWN_ACCOUNT_SOLD_EVIDENCE/)
  assert.match(clarification, /completed_without_sale_count/)
  assert.match(clarification, /import_marketplace_sold_evidence_v2/)
  assert.match(clarification, /revoke all[^;]+public, anon, authenticated/)
  assert.match(clarification, /grant execute[^;]+service_role/)
  const provenance = readFileSync(
    "supabase/migrations/20260826114524_ebay_recent_sold_price_provenance_v1.sql", "utf8",
  )
  assert.doesNotMatch(provenance, /drop\s+table|delete\s+from|truncate/i)
  assert.match(provenance, /displayed_sold_price_amount/)
  assert.match(provenance, /realized_transaction_price_amount/)
  assert.match(provenance, /realized_price_status = 'UNPROVEN'/)
  assert.match(provenance, /best_offer_status <> 'EXPLICIT_PRESENT'/)
  assert.match(provenance, /source_class <> 'MAIN_SEARCH_SOLD'[\s\S]+item_price is null/)
  assert.match(provenance, /import_marketplace_sold_evidence_v3/)
  assert.match(provenance, /revoke all[^;]+public, anon, authenticated/)
  assert.match(provenance, /grant execute[^;]+service_role/)
  assert.doesNotMatch(provenance, /grant[^;]+anon|grant[^;]+authenticated/i)
})

test("Top 20 consumes reviewed imports and reanalyzes the same run without OpenAI or eBay writes", () => {
  const service = readFileSync("lib/ebay/ebay-listing-ai-approval-queue-service.ts", "utf8")
  const route = readFileSync("app/api/admin/ebay/listing-ai/sold-evidence/route.ts", "utf8")
  assert.match(service, /readReviewedOfficialSoldEvidence/)
  assert.match(service, /officialSoldEvidenceComparablesForTarget/)
  assert.match(service, /officialSoldPackIntelligenceComparablesForTarget/)
  assert.match(service, /commercialRecommendation: input\.pack\.commercialRecommendation/)
  assert.match(service, /soldEvidenceNeedsReanalysis/)
  assert.match(service, /sold_evidence_applied_version/)
  assert.match(route, /sameRunResumed: true/)
  assert.match(route, /PASS_PACK_SIGNALS_ONLY/)
  assert.match(route, /taskOutcome: "NO_VALID_SOLD_EVIDENCE"/)
  assert.match(route, /openAiCalls: 0, ebayWrites: 0, canPublish: false/)
  assert.doesNotMatch(route, /shipping_fulfillment|publishOffer|createOffer/)
})
