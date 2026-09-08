import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  classifyProductResearchEvidenceSemanticsV1,
  extractProductResearchStructuralEvidenceV1,
  summarizeProductResearchEvidenceSemanticsV1,
} from "./ebay-product-research-evidence-semantics-v1.ts"

const targetTitle =
  "U.S. Kitchen 4 Piece Set - Stainless Steel Round Mesh Strainers With Wide Ears"
const targetEvidence =
  'Fine mesh kitchen strainers. Sizes included: 3", 4", 5.5", and 8". Wide ear design.'

function classify(observedTitle, overrides = {}) {
  return classifyProductResearchEvidenceSemanticsV1({
    targetTitle,
    targetSupportingEvidence: targetEvidence,
    observedTitle,
    quantitySold: 1,
    legacyAmbiguousPrice: 79.96,
    ...overrides,
  })
}

test("PASS_TITLE_COUNT_EXTRACTION", () => {
  for (const [title, expected] of [
    ["2pc fine mesh strainers", 2],
    ["3-Piece fine mesh strainer set", 3],
    ["set of 5 fine mesh strainers", 5],
  ]) {
    const extracted = extractProductResearchStructuralEvidenceV1({ title })
    assert.equal(extracted.count.status, "PROVEN")
    assert.equal(extracted.count.value, expected)
  }
})

test("PASS_TITLE_SIZE_EXTRACTION", () => {
  const extracted = extractProductResearchStructuralEvidenceV1({
    title: 'Strainer set 3", 4", 5.5", 8" kitchen',
  })
  assert.equal(extracted.sizeSet.status, "PROVEN")
  assert.deepEqual(extracted.sizeSet.value, ["3 in", "4 in", "5.5 in", "8 in"])
})

test("PASS_ARCHITECTURE_INCOMPATIBILITY", () => {
  for (const title of [
    "Vremi 13 Piece Mixing Bowl Set Colorful Kitchen Bowls Colander Mesh Strainer",
    "U.S. Kitchen Fine Twill Mesh Stainless Steel Conical Strainer Set Chinois",
    "Pampered Chef Stainless Steel Mesh Colander Set 3-Piece Kitchen Strainers",
  ]) {
    const result = classify(title)
    assert.equal(result.classification, "ADJACENT_BUT_NOT_COMPARABLE")
    assert.equal(result.compatibility.architectureCompatible, false)
  }
})

test("PASS_USE_INCOMPATIBILITY", () => {
  const result = classify(
    "2 Set Kitchen Sink Strainer Drain Basket Stopper Stainless Steel Mesh Filter",
  )
  assert.equal(result.classification, "ADJACENT_BUT_NOT_COMPARABLE")
  assert.equal(result.compatibility.useCompatible, false)
})

test("PASS_EXACT_REQUIRES_ALL_PROVEN_DISCRIMINATORS", () => {
  const result = classify(
    '4-Piece Stainless Steel Fine Mesh Strainer Set, 3", 4", 5.5", 8", Kitchen',
  )
  assert.notEqual(result.classification, "EXACT_PRODUCT_COMPARABLE")
  assert.equal(result.compatibility.allExactDiscriminatorsProven, false)
})

test("PASS_CLOSE_VARIANT_FROM_TITLE_COUNT_DIFF", () => {
  for (const count of [2, 3, 5]) {
    const result = classify(`${count}pc Stainless Steel Fine Mesh Strainer Set Kitchen`)
    assert.equal(result.classification, "CLOSE_VARIANT_COMPARABLE")
    assert.equal(result.compatibility.explicitCountDifference, true)
  }
})

test("PASS_CORE_FAMILY_REQUIRES_STRUCTURAL_COMPATIBILITY", () => {
  const compatible = classify("Stainless Steel Fine Mesh Kitchen Strainers with Wide Ears")
  assert.equal(compatible.classification, "CORE_FAMILY_COMPARABLE")
  const incompatible = classify("Kitchen Sink Drain Strainer Stainless Steel Mesh Basket")
  assert.notEqual(incompatible.classification, "CORE_FAMILY_COMPARABLE")
})

test("PASS_AMBIGUOUS_PRICE_FAILS_CLOSED", () => {
  const result = classify("Stainless Steel Fine Mesh Kitchen Strainers")
  assert.equal(result.price.unitSoldPrice.status, "UNPROVEN")
  assert.equal(result.price.unitSoldPrice.value, null)
  assert.equal(result.price.priceSource, "LEGACY_AMBIGUOUS_PRODUCT_RESEARCH_PRICE")
})

test("PASS_UNIT_PRICE_SEPARATED_FROM_CUMULATIVE_VALUE", () => {
  const result = classify("Stainless Steel Fine Mesh Kitchen Strainers", {
    unitSoldPrice: 19.99,
    cumulativeSalesValue: 719.64,
    currency: "USD",
    priceSource: "EXPLICIT_SEPARATE_SOURCE_COLUMNS",
  })
  assert.equal(result.price.unitSoldPrice.value, 19.99)
  assert.equal(result.price.cumulativeSalesValue.value, 719.64)
})

test("PASS_MISSING_SHIPPING_NOT_ZERO", () => {
  const result = classify("Stainless Steel Fine Mesh Kitchen Strainers", {
    unitSoldPrice: 19.99,
    currency: "USD",
    priceSource: "EXPLICIT_UNIT_PRICE_COLUMN",
  })
  assert.equal(result.price.shipping.status, "SHIPPING_UNPROVEN")
  assert.equal(result.price.shipping.price, null)
  assert.equal(result.price.totalDeliveredPrice.status, "UNPROVEN")
})

test("PASS_SELLER_DIVERSITY_NOT_FABRICATED", () => {
  const result = classify("Stainless Steel Fine Mesh Kitchen Strainers")
  const summary = summarizeProductResearchEvidenceSemanticsV1([result])
  assert.equal(result.seller.status, "UNPROVEN")
  assert.equal(summary.distinctSellerCount, null)
  assert.equal(summary.sellerDiversityStatus, "UNPROVEN")
  assert.equal(summary.sellerDiversityPass, true)
})

test("PASS_EXISTING_RECEIPTS_IMMUTABLE", () => {
  const source = Object.freeze({ title: "Stainless Steel Fine Mesh Kitchen Strainers" })
  classifyProductResearchEvidenceSemanticsV1({
    targetTitle,
    targetSupportingEvidence: targetEvidence,
    observedTitle: source.title,
    legacyAmbiguousPrice: 99.95,
  })
  assert.deepEqual(source, { title: "Stainless Steel Fine Mesh Kitchen Strainers" })
})

test("PASS_EXISTING_COHORT_RECLASSIFIABLE", () => {
  const rows = [
    classify("3pc Stainless Steel Fine Mesh Strainer Set Kitchen"),
    classify("Stainless Steel Fine Mesh Kitchen Strainers with Wide Ears"),
    classify("Kitchen Sink Drain Strainer Stainless Steel Mesh Basket"),
  ]
  const summary = summarizeProductResearchEvidenceSemanticsV1(rows)
  assert.equal(summary.canonicalUniqueItems, 3)
  assert.equal(summary.closeVariant, 1)
  assert.equal(summary.coreFamily, 1)
  assert.equal(summary.adjacent, 1)
  assert.equal(summary.structurallyIncompatibleCoreFamilyCount, 0)
  assert.equal(summary.comparableClassificationContractPass, true)
})

test("persistence is additive, versioned, and reuses canonical evidence", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260907234441_product_research_evidence_semantics_v1.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /evidence_semantics_versions jsonb not null/)
  assert.match(migration, /seller_os_product_research_canonical_evidence_v1 canonical/)
  assert.match(migration, /evidence_semantics_versions=evidence_semantics_versions \|\|/)
  assert.match(migration, /PRODUCT_RESEARCH_EVIDENCE_VERSION_IMMUTABILITY_CONFLICT/)
  assert.doesNotMatch(migration,
    /set\s+(?:average_sold_price|average_shipping|item_sales|commercial_comparable_classification)\s*=/i)
  assert.doesNotMatch(migration, /336697290775|ITEM1046|Golden|Owner|Teo/i)
  const correction = await readFile(new URL(
    "../../supabase/migrations/20260907235511_product_research_evidence_semantics_v2.sql",
    import.meta.url,
  ), "utf8")
  assert.match(correction, /PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07/)
  assert.doesNotMatch(correction, /336697290775|ITEM1046|Golden|Owner|Teo/i)
})
