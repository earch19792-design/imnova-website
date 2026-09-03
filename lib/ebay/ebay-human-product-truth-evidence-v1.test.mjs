import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  applyHumanConfirmedProductTruthEvidenceV1,
  buildHumanConfirmedProductTruthEvidenceV1,
  buildOwnerExplicitProductFactV1,
  applyOwnerExplicitProductFactV1,
  humanConfirmedProductTruthValuesV1,
  ownerExplicitProductTruthFactsV1,
  ownerExplicitProductTruthValuesV1,
} = await import("./ebay-human-product-truth-evidence-v1.ts")
const {
  buildEbayCategoryResolverProductTruthV1,
} = await import("./ebay-category-resolver-v1.ts")
const {
  buildEbayListingTaxonomyPreflightV1,
} = await import("./ebay-listing-taxonomy-preflight-v1.ts")

const opportunity = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  candidate_key: "smart-stocking:EBAY_US:generic-cotton-cover",
  supplier_product_id: "9220000000001",
  supplier_variant_id: "48800000000001",
  supplier_sku: "GENERIC101",
  gtin: "740111111111",
  product_title: "Decorative Pillow Cover",
  updated_at: "2026-08-28T10:00:00.000Z",
  assessment: {
    productTruth: {
      evidenceDigest: `sha256:${"a".repeat(64)}`,
      title: "Decorative Pillow Cover",
      productType: "Pillow Cover",
      normalizedProductFamily: "decorative pillow covers",
      lunaProductId: "9220000000001",
      lunaVariantId: "48800000000001",
      supplierSku: "GENERIC101",
      gtin: "740111111111",
      sourceUrl: "https://www.lunaportex.com/products/decorative-pillow-cover",
    },
    candidate: { gtin: "740111111111" },
    listingIntelligencePackage: {
      itemSpecifics: { supplierConfirmed: { Type: "Pillow Cover" } },
    },
  },
  ...overrides,
})

const materialAspect = {
  name: "Material",
  required: true,
  mode: "SELECTION_ONLY",
  valuesComplete: true,
  values: [{ value: "Cotton" }, { value: "Polyester" }],
}

function evidence(input = {}) {
  return buildHumanConfirmedProductTruthEvidenceV1({
    opportunity: opportunity(),
    listingPackageId: "22222222-2222-4222-8222-222222222222",
    marketplaceId: "EBAY_US",
    actorId: "33333333-3333-4333-8333-333333333333",
    aspect: materialAspect,
    normalizedValue: "cotton",
    evidenceStatement: "Official Luna product page states cotton material.",
    confirmedAt: "2026-08-28T10:15:00.000Z",
    ...input,
  })
}

test("generic required aspect evidence is identity-bound and normalized", () => {
  const result = evidence()
  assert.equal(result.aspectName, "Material")
  assert.equal(result.normalizedValue, "Cotton")
  assert.equal(result.sourceClass, "LUNA_OFFICIAL_PRODUCT_PAGE")
  assert.equal(result.sourceReference,
    "https://www.lunaportex.com/products/decorative-pillow-cover")
  assert.equal(result.provenance,
    "OPERATOR_CONFIRMED_EXACT_SUPPLIER_EVIDENCE")
  assert.equal(result.marketplaceWrites, 0)
  assert.match(result.evidenceDigest, /^sha256:[0-9a-f]{64}$/)
})

test("durable JSON replay preserves evidence and feeds Product Truth", () => {
  const source = opportunity()
  const applied = applyHumanConfirmedProductTruthEvidenceV1({
    opportunity: source,
    evidence: evidence(),
  })
  const replay = JSON.parse(JSON.stringify({
    ...source,
    assessment: applied.assessment,
  }))
  assert.deepEqual(humanConfirmedProductTruthValuesV1(replay), {
    Material: "Cotton",
  })
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: replay,
  })
  assert.equal(productTruth.provenProductValues.Material, "Cotton")
  const taxonomyAspect = {
    ...materialAspect,
    enabledForVariations: false,
    usage: "REQUIRED",
    cardinality: "SINGLE",
    maxLength: null,
    dataType: "STRING",
    format: null,
    advancedDataType: null,
    expectedRequiredByDate: null,
    suggestedValues: [],
    constraintsComplete: true,
  }
  const preflight = buildEbayListingTaxonomyPreflightV1({
    taxonomy: {
      status: "AVAILABLE",
      categoryTreeId: "0",
      categoryTreeVersion: "142",
      categoryId: "12345",
      categoryName: "Pillow Covers",
      taxonomyMarketplaceId: "EBAY_US",
      observedAt: "2026-08-28T10:16:00.000Z",
      aspects: [taxonomyAspect],
      requiredAspects: [taxonomyAspect],
      recommendedAspects: [],
      categoryResolution: "KNOWN_CATEGORY",
      failureCode: null,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    },
    expectedCategoryId: "12345",
    context: {
      marketplaceId: "EBAY_US",
      listingPackageId: "22222222-2222-4222-8222-222222222222",
      opportunityId: replay.id,
      candidateKey: replay.candidate_key,
    },
    existingAspects: {},
    provenProductValues: productTruth.provenProductValues,
    knownUnknownAspectNames: productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements:
      productTruth.unprovenAspectEvidenceRequirements,
  })
  assert.equal(preflight.resolvedAspects.Material, "Cotton")
  assert.deepEqual(preflight.unprovenRequiredAspectNames, [])
})

test("naked claims, unsupported official values and source mismatch fail closed", () => {
  assert.throws(() => evidence({ evidenceStatement: "Cotton" }),
    /HUMAN_PRODUCT_TRUTH_EVIDENCE_INVALID/)
  assert.throws(() => evidence({ normalizedValue: "Silk" }),
    /HUMAN_PRODUCT_TRUTH_EVIDENCE_INVALID/)
  assert.throws(() => evidence({
    opportunity: opportunity({
      assessment: {
        ...opportunity().assessment,
        productTruth: {
          ...opportunity().assessment.productTruth,
          sourceUrl: "https://example.com/product",
        },
      },
    }),
  }), /HUMAN_PRODUCT_TRUTH_EVIDENCE_INVALID/)
})

test("evidence from another exact product cannot be replayed", () => {
  const foreign = opportunity({
    candidate_key: "smart-stocking:EBAY_US:foreign-product",
  })
  assert.throws(() => applyHumanConfirmedProductTruthEvidenceV1({
    opportunity: foreign,
    evidence: evidence(),
  }), /HUMAN_PRODUCT_TRUTH_EVIDENCE_IDENTITY_MISMATCH/)
})

test("a conflicting value cannot silently overwrite durable Product Truth", () => {
  const source = opportunity()
  const applied = applyHumanConfirmedProductTruthEvidenceV1({
    opportunity: source,
    evidence: evidence(),
  })
  const withCotton = { ...source, assessment: applied.assessment }
  const polyester = buildHumanConfirmedProductTruthEvidenceV1({
    opportunity: withCotton,
    listingPackageId: "22222222-2222-4222-8222-222222222222",
    marketplaceId: "EBAY_US",
    actorId: "33333333-3333-4333-8333-333333333333",
    aspect: materialAspect,
    normalizedValue: "Polyester",
    evidenceStatement: "Official Luna product page states polyester material.",
    confirmedAt: "2026-08-28T10:20:00.000Z",
  })
  assert.throws(() => applyHumanConfirmedProductTruthEvidenceV1({
    opportunity: withCotton,
    evidence: polyester,
  }), /HUMAN_PRODUCT_TRUTH_EVIDENCE_CONFLICT/)
})

test("owner last-mile fact preserves the original and marketplace mapping", () => {
  const source = opportunity()
  const ownerFact = buildOwnerExplicitProductFactV1({
    opportunity: source,
    listingPackageId: "22222222-2222-4222-8222-222222222222",
    marketplaceId: "EBAY_US",
    actorId: "33333333-3333-4333-8333-333333333333",
    aspect: { name: "Department", required: true,
      mode: "SELECTION_ONLY", valuesComplete: true,
      values: [{ value: "Unisex Baby & Toddler" }, { value: "Adults" }],
      maxLength: 65, dataType: "STRING" },
    exactValue: "unisex baby & toddler",
    categoryId: "20445",
    officialPolicyEvidenceDigest: `sha256:${"c".repeat(64)}`,
    capturedAt: "2026-09-03T12:00:00.000Z",
  })
  assert.equal(ownerFact.source, "OWNER_EXPLICIT_FACT")
  assert.equal(ownerFact.exactValue, "unisex baby & toddler")
  assert.equal(ownerFact.normalizedMarketplaceValue,
    "Unisex Baby & Toddler")
  assert.equal(ownerFact.boundToExactProductIdentity, true)
  assert.equal(ownerFact.durable, true)
  const applied = applyOwnerExplicitProductFactV1({
    opportunity: source,
    evidence: ownerFact,
  })
  const replay = JSON.parse(JSON.stringify({ ...source,
    assessment: applied.assessment }))
  assert.deepEqual(ownerExplicitProductTruthValuesV1(replay), {
    Department: "Unisex Baby & Toddler",
  })
  assert.equal(ownerExplicitProductTruthFactsV1(replay)[0].exactValue,
    "unisex baby & toddler")
  assert.equal(applied.created, true)
  assert.equal(applied.corrected, false)
})

test("owner correction is version-bound, durable and does not erase history", () => {
  const source = opportunity()
  const initial = buildOwnerExplicitProductFactV1({
    opportunity: source,
    listingPackageId: "22222222-2222-4222-8222-222222222222",
    marketplaceId: "EBAY_US",
    actorId: "33333333-3333-4333-8333-333333333333",
    aspect: { name: "Brand", required: true, mode: "FREE_TEXT",
      valuesComplete: true, values: [], maxLength: 65,
      dataType: "STRING" },
    exactValue: "Acme",
    categoryId: "20445",
    officialPolicyEvidenceDigest: `sha256:${"c".repeat(64)}`,
    capturedAt: "2026-09-03T12:00:00.000Z",
  })
  const first = applyOwnerExplicitProductFactV1({ opportunity: source,
    evidence: initial })
  const withInitial = { ...source, assessment: first.assessment }
  const correction = buildOwnerExplicitProductFactV1({
    opportunity: withInitial,
    listingPackageId: "22222222-2222-4222-8222-222222222222",
    marketplaceId: "EBAY_US",
    actorId: "33333333-3333-4333-8333-333333333333",
    aspect: { name: "Brand", required: true, mode: "FREE_TEXT",
      valuesComplete: true, values: [], maxLength: 65,
      dataType: "STRING" },
    exactValue: "Acme Home",
    categoryId: "20445",
    officialPolicyEvidenceDigest: `sha256:${"c".repeat(64)}`,
    capturedAt: "2026-09-03T12:05:00.000Z",
    supersedesEvidenceDigest: initial.evidenceDigest,
  })
  const corrected = applyOwnerExplicitProductFactV1({
    opportunity: withInitial, evidence: correction,
  })
  const replay = { ...source, assessment: corrected.assessment }
  assert.deepEqual(ownerExplicitProductTruthValuesV1(replay), {
    Brand: "Acme Home",
  })
  assert.equal(corrected.productTruth.ownerExplicitFactEvidenceV1.length, 2)
  assert.equal(corrected.created, false)
  assert.equal(corrected.corrected, true)
  assert.throws(() => applyOwnerExplicitProductFactV1({
    opportunity: withInitial,
    evidence: { ...correction, supersedesEvidenceDigest: null },
  }), /OWNER_EXPLICIT_PRODUCT_FACT_IDENTITY_MISMATCH|CORRECTION_PRECONDITION/)
})

test("workspace and authenticated route expose the reusable evidence path", () => {
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  assert.match(workspace, /Confirmar evidencia Product Truth/)
  assert.match(workspace, /Evidencia observada en Luna/)
  assert.match(workspace, /confirm_product_truth_evidence/)
  assert.match(route, /confirmProductTruthEvidence/)
  assert.match(route, /HUMAN_PRODUCT_TRUTH_EVIDENCE_STALE_VERSION/)
  assert.match(route, /ebay_save_listing_package_guarded/)
  assert.doesNotMatch(`${workspace}\n${route}`, /ITEM3404|175757|\bBlack\b/)
})
