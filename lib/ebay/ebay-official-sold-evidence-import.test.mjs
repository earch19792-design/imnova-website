import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  deduplicateOfficialSoldEvidence,
  officialSoldEvidenceComparablesForTarget,
  officialSoldEvidenceCoverage,
  parseOfficialSoldEvidenceImport,
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
    content: csv([csvRow({ upc: "123456789012", brand: "", packCount: "" })]), now,
  }), /SOLD_EVIDENCE_NO_VALID_ROWS/)
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
})

test("Top 20 consumes reviewed imports and reanalyzes the same run without OpenAI or eBay writes", () => {
  const service = readFileSync("lib/ebay/ebay-listing-ai-approval-queue-service.ts", "utf8")
  const route = readFileSync("app/api/admin/ebay/listing-ai/sold-evidence/route.ts", "utf8")
  assert.match(service, /readReviewedOfficialSoldEvidence/)
  assert.match(service, /officialSoldEvidenceComparablesForTarget/)
  assert.match(service, /soldEvidenceNeedsReanalysis/)
  assert.match(service, /sold_evidence_applied_version/)
  assert.match(route, /sameRunResumed: true/)
  assert.match(route, /openAiCalls: 0, ebayWrites: 0, canPublish: false/)
  assert.doesNotMatch(route, /shipping_fulfillment|publishOffer|createOffer/)
})
