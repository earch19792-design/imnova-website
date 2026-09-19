import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  buildProductResearchCommercialQueryStrategyV1,
  canonicalizeComparableEvidenceByItemIdV1,
  classifyCommercialComparableV1,
  evaluateProductResearchQueryQualityV1,
  extractProductResearchEntityV1,
  summarizeProductResearchComparableEvidenceV1,
} from "./ebay-product-research-query-intelligence-v1.ts"

const migration = fs.readFileSync(new URL(
  "../../supabase/migrations/20260907090415_product_research_query_intelligence_systemic_v1.sql",
  import.meta.url,
), "utf8")
const annotationAuthorityFix = fs.readFileSync(new URL(
  "../../supabase/migrations/20260907094800_product_research_commercial_annotation_authority_fix.sql",
  import.meta.url,
), "utf8")
const semanticPrecisionMigration = fs.readFileSync(new URL(
  "../../supabase/migrations/20260907104500_product_research_semantic_comparable_precision_v2.sql",
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
  assert.deepEqual(core.query.split(" ").sort(),
    core.evidenceBasis.map((entry) => entry.term).sort())
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

test("PASS_COMMERCIAL_DOMAIN_QUALIFIER_IS_NOT_DROPPED_AS_GENERIC_NOISE", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Outdoor 4 Piece Aluminum Folding Chairs with Cup Holders",
  })
  assert.ok(entity.definingFamilyQualifiers.includes("outdoor"))
  assert.match(entity.productFamilyCandidate ?? "", /outdoor.*chairs/)
})

test("PASS_SAME_HEAD_NOUN_WITH_GENERIC_OVERLAP_IS_ADJACENT", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Outdoor 4 Piece Aluminum Folding Chairs with Cup Holders",
  })
  const result = classifyCommercialComparableV1({ entity,
    title: "4 Pack Aluminum Chair Leg Floor Protectors for Outdoor Furniture",
    detectedCount: 4 })
  assert.equal(result.classification, "ADJACENT_BUT_NOT_COMPARABLE")
})

test("PASS_CORE_FAMILY_REQUIRES_ENTITY_STRUCTURE_NOT_ATTRIBUTES_ONLY", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Outdoor 4 Piece Aluminum Folding Chairs with Cup Holders",
  })
  const result = classifyCommercialComparableV1({ entity,
    title: "Outdoor Aluminum Folding Chair Replacement Accessory" })
  assert.equal(result.classification, "ADJACENT_BUT_NOT_COMPARABLE")
  assert.ok(result.reasons.includes("GENERIC_ATTRIBUTE_OVERLAP_ONLY"))
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

test("PASS_COMMERCIAL_QUALITY_ANNOTATION_USES_BOUNDED_DEFINER_AUTHORITY", () => {
  assert.match(annotationAuthorityFix,
    /annotate_product_research_capture_commercial_v1[\s\S]*security definer/i)
  assert.match(annotationAuthorityFix,
    /is_seller_os_service_role_request_v1\(\)/)
  assert.match(annotationAuthorityFix,
    /PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_SCOPE_INVALID/)
  assert.match(annotationAuthorityFix,
    /v_updated <> v_expected/)
  assert.doesNotMatch(annotationAuthorityFix,
    /grant update on table public\.marketplace_product_research_capture/i)
})

test("PASS_CURRENT_STRATEGY_EVIDENCE_DOES_NOT_INHERIT_OLD_FALSE_SUFFICIENCY", () => {
  assert.match(semanticPrecisionMigration,
    /task\.strategy_version = v_intelligence_contract_version/)
  assert.match(semanticPrecisionMigration,
    /task\.strategy_version = plan\.intelligence_contract_version/)
  assert.doesNotMatch(semanticPrecisionMigration, /delete\s+from/i)
})

test("PASS_STRUCTURED_IDENTITY_FAMILY_SURVIVES_EVERY_QUERY", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Pink Butterfly Memorial Necklace – My Mind Still Talks to You Silver Chain, 21 Inches",
    sourceField: "identity_result.queryPlan",
    sourceAuthority: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
    structuredIdentity: {
      version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
      productFamily: "JEWELRY_NECKLACE",
      canonicalFamilyPhrase: "Necklace",
      identitySufficient: true,
      color: "PINK",
      formFactors: ["butterfly"],
      functionalDifferentiators: ["memorial"],
      queryPlan: { exactStrong: "necklace pink butterfly memorial",
        nearExactFamily: "necklace pink", functionalFamily: "necklace memorial",
        broadFallback: "necklace", progression: ["necklace pink butterfly memorial",
          "necklace pink", "necklace memorial", "necklace"] },
    },
  })
  assert.ok(result.queries.length > 0)
  assert.ok(result.queries.every((query) => /\bnecklace\b/.test(query.query)))
  assert.doesNotMatch(result.queries.map((query) => query.query).join(" | "),
    /21 inches you chain|you chain inches/)
})

test("PASS_PET_TRAINING_DOORBELL_COMPOUND_GETS_BOUNDED_FAMILY_VARIANTS", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "2-Pack Pet Training Doorbells for Dogs & Cats",
    sourceField: "identity_result.queryPlan",
    sourceAuthority: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
    structuredIdentity: {
      version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
      productFamily: "2_PACK_PET_TRAINING_DOORBELLS",
      canonicalFamilyPhrase: "2-pack Pet Training Doorbells",
      identitySufficient: true,
      model: "2-PACK",
      formFactors: ["2-pack pet training doorbells"],
      queryPlan: {
        exactStrong: "2-pack pet training doorbells",
        nearExactFamily: "2-pack pet training doorbells",
        functionalFamily: "2-pack pet training doorbells",
        broadFallback: "2-pack pet training doorbells",
        progression: ["2-pack pet training doorbells"],
      },
    },
  })
  const queries = result.queries.map((entry) => entry.query)
  assert.deepEqual(queries, [
    "2 pack pet training doorbells",
    "2 pack pet training door bell",
    "2pack dog training door bell",
  ])
  const titleTokens = (value) => value.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const stem = (value) => value.length > 4 && value.endsWith("s")
    ? value.slice(0, -1) : value
  const queryMatches = (query, title) => {
    const titleTerms = titleTokens(title).map(stem)
    return titleTokens(query).map(stem).every((term) => titleTerms.includes(term))
  }
  assert.equal(queries.some((query) => queryMatches(query,
    "Pet Training Bells, 2 Pack Dogs Bell for Door Potty Training")), true)
  assert.equal(queries.some((query) => queryMatches(query,
    "2Pack Dog Training Bells for Door Potty Training Dogs Cats")), true)
  assert.ok(queries.every((query) => /training/.test(query) &&
    /(?:pet|dog|cat)/.test(query) && /bell/.test(query) &&
    /(?:2 pack|2pack)/.test(query)))
  assert.equal(queries.includes("bell"), false)
})

test("PASS_USAGE_CONTEXT_AFTER_CONNECTOR_IS_NOT_STRUCTURAL_IDENTITY", () => {
  const rawEntity = extractProductResearchEntityV1({
    productName: "Stone Dish Drying Mat for Kitchen Counter (15 1/2 X 11 1/2)",
  })
  assert.deepEqual(rawEntity.featureQualifiers, [])
  assert.ok(rawEntity.materialQualifiers.includes("stone"))

  const strategy = buildProductResearchCommercialQueryStrategyV1({
    productName: "Stone Dish Drying Mat for Kitchen Counter",
    sourceField: "identity_result.queryPlan",
    sourceAuthority: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
    structuredIdentity: {
      version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
      productFamily: "STONE_DISH_DRYING_MAT",
      canonicalFamilyPhrase: "stone dish drying mat",
      identitySufficient: true,
      formFactors: ["stone dish drying mat for kitchen counter"],
      evidence: [{ field: "MATERIAL", value: "stone" }],
      queryPlan: {
        exactStrong: "stone dish drying mat",
        nearExactFamily: "dish drying mat stone",
      },
    },
  })
  assert.equal(strategy.entity.featureQualifiers.includes("counter"), false)
  assert.equal(strategy.entity.featureQualifiers.includes("kitchen"), false)
  const result = classifyCommercialComparableV1({ entity: strategy.entity,
    title: "Large Diatomaceous Earth Stone Dish Drying Mat 12x16 Kitchen" })
  assert.equal(result.classification, "EXACT_PRODUCT_COMPARABLE")

  for (const context of ["kitchen", "bathroom", "desk"]) {
    const contextual = extractProductResearchEntityV1({
      productName: `Storage Organizer for ${context}`,
    })
    assert.equal(contextual.featureQualifiers.includes(context), false)
  }
  const defining = extractProductResearchEntityV1({
    productName: "Bathroom Counter Organizer",
  })
  assert.ok(defining.definingFamilyQualifiers.includes("bathroom"))
  assert.ok(defining.definingFamilyQualifiers.includes("counter"))
})

test("PASS_MULTI_FUNCTION_CONFIGURATION_IS_NOT_A_PHYSICAL_SIZE", () => {
  for (const [title, expected] of [
    ["5-in-1 Microcurrent Facial Device", 5],
    ["5 in 1 Microcurrent Facial Device", 5],
    ["7-in-1 Microcurrent Facial Device", 7],
  ]) {
    const entity = extractProductResearchEntityV1({ productName: title })
    assert.equal(entity.configurationCount, expected)
    assert.equal(entity.sizeOrVariantQualifiers.includes(String(expected)), false)
    assert.equal(entity.sizeOrVariantQualifiers.includes("in"), false)
  }
  const physicalSize = extractProductResearchEntityV1({
    productName: "5 in Round Facial Mirror",
  })
  assert.equal(physicalSize.configurationCount, null)
  assert.deepEqual(physicalSize.sizeOrVariantQualifiers, ["5", "in"])
})

test("PASS_RAW_TITLE_FALLBACK_BOUNDS_MARKETING_TAIL_AND_UNITS", () => {
  const entity = extractProductResearchEntityV1({
    productName: "Butterfly Memorial Pendant — My Heart Talks to You Silver Chain, 21 Inches",
  })
  assert.equal(entity.productNoun, "pendant")
  assert.equal(entity.definingFamilyQualifiers.includes("you"), false)
  assert.equal(entity.definingFamilyQualifiers.includes("inches"), false)
  const unproven = buildProductResearchCommercialQueryStrategyV1({
    productName: "21 inches",
  })
  assert.equal(unproven.queries.length, 0)
  assert.equal(unproven.entity.status, "UNPROVEN")
})

test("PASS_PRESENT_BUT_INVALID_STRUCTURED_IDENTITY_DOES_NOT_USE_RAW_FALLBACK", () => {
  const result = buildProductResearchCommercialQueryStrategyV1({
    productName: "Otherwise Searchable Product Family",
    structuredIdentity: { version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
      productFamily: null, canonicalFamilyPhrase: null,
      identitySufficient: false, queryPlan: { progression: [] } },
  })
  assert.equal(result.entity.status, "UNPROVEN")
  assert.equal(result.queries.length, 0)
})

test("PASS_RAW_SOLD_WITH_ZERO_ACCEPTED_COMPARABLES_FAILS_CLOSED", () => {
  const summary = summarizeProductResearchComparableEvidenceV1([
    { itemId: "123456789012", soldQuantity: 50,
      classification: "ADJACENT_BUT_NOT_COMPARABLE",
      classificationReasons: ["GENERIC_ATTRIBUTE_OVERLAP_ONLY"] },
    { itemId: "123456789013", soldQuantity: 80,
      classification: "FALSE_POSITIVE",
      classificationReasons: ["PRODUCT_NOUN_ABSENT"] },
  ])
  assert.equal(summary.rawObservedSoldQuantity, 130)
  assert.equal(summary.acceptedComparableCount, 0)
  assert.equal(summary.acceptedComparableSoldQuantity, 0)
  assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
  assert.equal(summary.traceEligible, false)
})

test("PASS_REJECTED_IP_BRAND_AND_PREMIUM_ROWS_CANNOT_RAISE_DISPOSITION", () => {
  for (const reason of ["IP_CONTAMINATION", "BRAND_CONTAMINATION",
    "PREMIUM_MATERIAL_CONTAMINATION", "PREMIUM_MATERIAL_MISMATCH"]) {
    const summary = summarizeProductResearchComparableEvidenceV1([{
      itemId: "123456789014", soldQuantity: 25,
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: [reason],
    }])
    assert.equal(summary.acceptedComparableCount, 0)
    assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
  }
})

test("PASS_PACK_CONTAMINATION_CANNOT_COUNT_AS_EXACT_PRODUCT_EVIDENCE", () => {
  const summary = summarizeProductResearchComparableEvidenceV1([{
    itemId: "123456789015", soldQuantity: 12,
    classification: "EXACT_PRODUCT_COMPARABLE",
    classificationReasons: ["PACK_COUNT_MISMATCH"],
  }])
  assert.equal(summary.exactComparableCount, 0)
  assert.equal(summary.acceptedComparableCount, 0)
  assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
})

test("PASS_PACK_CONTAMINATION_CANNOT_COUNT_AS_CLOSE_OR_FAMILY_EVIDENCE", () => {
  for (const [classification, reason] of [
    ["CLOSE_VARIANT_COMPARABLE", "PACK_COUNT_MISMATCH"],
    ["CORE_FAMILY_COMPARABLE", "PACK_STRUCTURE_DIFFERS"],
  ]) {
    const summary = summarizeProductResearchComparableEvidenceV1([{
      itemId: classification === "CLOSE_VARIANT_COMPARABLE"
        ? "123456789021" : "123456789022",
      soldQuantity: 18, classification,
      classificationReasons: classification === "CORE_FAMILY_COMPARABLE"
        ? ["PRODUCT_ENTITY_FAMILY_AND_STRUCTURE_MATCH", reason] : [reason],
    }])
    assert.equal(summary.acceptedComparableCount, 0)
    assert.equal(summary.acceptedComparableSoldQuantity, 0)
    assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
    assert.equal(summary.traceEligible, false)
  }
})

test("PASS_FAMILY_COMPARABLE_REQUIRES_EXPLICIT_POLICY_QUALIFICATION", () => {
  const summary = summarizeProductResearchComparableEvidenceV1([{
    itemId: "123456789020", soldQuantity: 9,
    classification: "CORE_FAMILY_COMPARABLE",
    classificationReasons: ["GENERIC_ATTRIBUTE_OVERLAP_ONLY"],
  }])
  assert.equal(summary.familyComparableCount, 0)
  assert.equal(summary.acceptedComparableCount, 0)
  assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
})

test("PASS_ACCEPTED_EXACT_AND_CLOSE_COMPARABLES_CONTRIBUTE_TO_SCORING", () => {
  const summary = summarizeProductResearchComparableEvidenceV1([
    { itemId: "123456789016", soldQuantity: 4,
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: ["PRODUCT_ENTITY_AND_EXACT_DISCRIMINATORS_MATCH"] },
    { itemId: "123456789017", soldQuantity: 3,
      classification: "CLOSE_VARIANT_COMPARABLE",
      classificationReasons: ["EXACT_VARIANT_QUALIFIER_DIFFERS",
        "PRODUCT_ENTITY_STRUCTURE_MATCHES"] },
  ])
  assert.equal(summary.exactComparableCount, 1)
  assert.equal(summary.closeVariantComparableCount, 1)
  assert.equal(summary.acceptedComparableSoldQuantity, 7)
  assert.equal(summary.result, "PRE_RESEARCH_HIGH")
  assert.equal(summary.traceEligible, true)
})

test("PASS_MULTI_TASK_PLAN_AGGREGATION_DEDUPLICATES_EBAY_ITEM_ID", () => {
  const summary = summarizeProductResearchComparableEvidenceV1([
    { itemId: "123456789018", soldQuantity: 7, queryProvenance: "task-1",
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: ["PRODUCT_ENTITY_AND_EXACT_DISCRIMINATORS_MATCH"] },
    { itemId: "123456789018", soldQuantity: 7, queryProvenance: "task-2",
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: ["PRODUCT_ENTITY_AND_EXACT_DISCRIMINATORS_MATCH"] },
    { itemId: "123456789019", soldQuantity: 2, queryProvenance: "task-2",
      classification: "CORE_FAMILY_COMPARABLE",
      classificationReasons: ["PRODUCT_ENTITY_FAMILY_AND_STRUCTURE_MATCH"] },
  ])
  assert.equal(summary.observedItemCount, 2)
  assert.equal(summary.acceptedComparableCount, 2)
  assert.equal(summary.rawObservedSoldQuantity, 9)
  assert.equal(summary.acceptedComparableSoldQuantity, 9)
})
