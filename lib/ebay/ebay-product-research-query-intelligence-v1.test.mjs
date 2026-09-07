import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  buildProductResearchCommercialQueryStrategyV1,
  canonicalizeComparableEvidenceByItemIdV1,
  classifyCommercialComparableV1,
  evaluateProductResearchQueryQualityV1,
  extractProductResearchEntityV1,
} from "./ebay-product-research-query-intelligence-v1.ts"

const migration = fs.readFileSync(new URL(
  "../../supabase/migrations/20260907090415_product_research_query_intelligence_systemic_v1.sql",
  import.meta.url,
), "utf8")

test("PASS_PRODUCT_NOUN_PRESERVED", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Acme 3 Piece Set - Silicone Heat Resistant Spatulas with Wooden Handles",
    brand: "Acme",
  })
  assert.equal(entity.productNoun, "spatulas")
  assert.match(entity.productFamilyCandidate ?? "", /spatulas/)
})

test("PASS_NO_POSITIONAL_TRUNCATION_DESTROYS_PRODUCT_ENTITY", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Professional Premium Stainless Steel Round Fine Perforated Colanders",
  })
  assert.ok(result.queries.every((query) => query.query.includes("colanders")))
  assert.doesNotMatch(result.queries.map((query) => query.query).join(" "),
    /professional|premium/)
})

test("PASS_EXACT_PRODUCT_QUERY_INTENT", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Acme 2 Piece Cotton Quilted Oven Mitts with Hanging Loops",
    brand: "Acme",
  })
  const exact = result.queries.find((query) => query.intent === "EXACT_PRODUCT_QUERY")
  assert.ok(exact)
  assert.match(exact.query, /mitts/)
  assert.ok(exact.evidenceBasis.every((entry) => entry.sourceAuthority))
})

test("PASS_CORE_FAMILY_QUERY_INTENT", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "2 Piece Cotton Quilted Oven Mitts with Hanging Loops",
  })
  const core = result.queries.find((query) => query.intent === "CORE_FAMILY_QUERY")
  assert.ok(core)
  assert.match(core.query, /mitts/)
  assert.doesNotMatch(core.query, /\b2\b|hanging|loops/)
})

test("PASS_SEMANTIC_EXPANSION_REQUIRES_EVIDENCE", () => {
  const without = buildProductResearchCommercialQueryStrategyV1({
    productName: "Glass Beverage Pitcher with Handle",
  })
  assert.equal(without.queries.some((query) =>
    query.intent === "SEMANTIC_EXPANSION_QUERY"), false)
  const withEvidence = buildProductResearchCommercialQueryStrategyV1({
    productName: "Glass Beverage Pitcher with Handle",
    marketplaceTerms: [{ term: "carafe", titleFrequency: 4,
      sellerDiversity: 3, relevance: "FAMILY", evidenceIds: ["e1", "e2"] }],
  })
  assert.equal(withEvidence.queries.some((query) =>
    query.intent === "SEMANTIC_EXPANSION_QUERY"), true)
})

test("PASS_GENERIC_ATTRIBUTE_FALSE_POSITIVE_REJECTED", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Stainless Steel Fine Mesh Colanders",
  })
  const result = classifyCommercialComparableV1({ entity,
    title: "Stainless Steel Round Kitchen Trash Can" })
  assert.equal(result.classification, "FALSE_POSITIVE")
})

test("PASS_LOW_PRECISION_QUERY_AUTO_REFORMULATES", () => {
  const quality = evaluateProductResearchQueryQualityV1([
    "FALSE_POSITIVE", "FALSE_POSITIVE", "ADJACENT_BUT_NOT_COMPARABLE",
  ])
  assert.equal(quality.status, "LOW_PRECISION_REFORMULATION_REQUIRED")
  assert.match(migration, /BOUNDED_TYPED_QUERY_REFORMULATION/)
  assert.match(migration, /addedQueryCount/)
})

test("PASS_BOUNDED_QUERY_ATTEMPTS", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Stoneware Rectangular Baking Dishes with Side Handles",
    marketplaceTerms: [
      { term: "roaster", titleFrequency: 8, sellerDiversity: 4,
        relevance: "FAMILY", evidenceIds: ["e1"] },
      { term: "casserole", titleFrequency: 7, sellerDiversity: 4,
        relevance: "FAMILY", evidenceIds: ["e2"] },
      { term: "pan", titleFrequency: 6, sellerDiversity: 4,
        relevance: "FAMILY", evidenceIds: ["e3"] },
    ],
  })
  assert.ok(result.queries.length <= 3)
})

test("PASS_NO_EVIDENCE_REMAINS_UNPROVEN", () => {
  const quality = evaluateProductResearchQueryQualityV1([])
  assert.equal(quality.status, "NO_EVIDENCE_UNPROVEN")
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Default Title",
  })
  assert.equal(result.entity.status, "UNPROVEN")
})

test("PASS_ITEM_ID_DEDUPLICATION", () => {
  const rows = canonicalizeComparableEvidenceByItemIdV1([
    { itemId: "123456789012", queryProvenance: "q1", soldQuantity: 4 },
    { itemId: "123456789012", queryProvenance: "q1", soldQuantity: 4 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].soldQuantity, 4)
})

test("PASS_MULTI_QUERY_ITEM_PROVENANCE_WITHOUT_DOUBLE_COUNT", () => {
  const rows = canonicalizeComparableEvidenceByItemIdV1([
    { itemId: "123456789012", queryProvenance: "exact", soldQuantity: 7 },
    { itemId: "123456789012", queryProvenance: "family", soldQuantity: 7 },
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].queryProvenances, ["exact", "family"])
  assert.equal(rows.reduce((sum, row) => sum + row.soldQuantity, 0), 7)
})

test("PASS_EXISTING_LOW_QUALITY_RESEARCH_RECOVERABLE", () => {
  assert.match(migration,
    /RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT/)
  assert.match(migration, /status = 'ACTIVE', completed_at = null/)
  assert.doesNotMatch(migration,
    /delete\s+from\s+public\.marketplace_product_research/i)
})
