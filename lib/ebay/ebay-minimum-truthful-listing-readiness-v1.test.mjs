import assert from "node:assert/strict"
import test from "node:test"

import {
  aiAutonomousMarketplaceResolutionAllowedV1,
  buildMinimumTruthfulListingReadinessV1,
  buildOfficialEbayRequirementClassificationV1,
  classifyOfficialEbayRequirementV1,
  MINIMUM_TRUTHFUL_LISTING_READINESS_V1,
} from "./ebay-minimum-truthful-listing-readiness-v1.ts"

const aspect = (name, overrides = {}) => ({
  name,
  required: false,
  usage: "OPTIONAL",
  mode: "FREE_TEXT",
  cardinality: "SINGLE",
  maxLength: 65,
  dataType: "STRING",
  values: [],
  valuesComplete: true,
  constraintsComplete: true,
  ...overrides,
})

const preflight = (overrides = {}) => ({
  schemaVersion: "SELLER_OS_EBAY_LISTING_TAXONOMY_PREFLIGHT_V1",
  status: "CONSULTADO",
  officialStatus: "AVAILABLE",
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  marketplaceId: "EBAY_US",
  categoryId: "29946",
  evidenceDigest: `sha256:${"a".repeat(64)}`,
  aspects: [
    aspect("Brand", { required: true, usage: "RECOMMENDED" }),
    aspect("Type", { usage: "RECOMMENDED" }),
    aspect("Features"),
  ],
  resolvedAspects: {},
  unprovenRequiredAspectNames: ["Brand"],
  ...overrides,
})

const readinessInput = (overrides = {}) => ({
  candidateKey: `sha256:${"b".repeat(64)}`,
  opportunityId: "11111111-1111-4111-8111-111111111111",
  supplierProductId: "9220000000001",
  supplierVariantId: "48800000000001",
  supplierSku: "ITEM3177",
  listingPackageId: "22222222-2222-4222-8222-222222222222",
  taxonomyPreflight: preflight(),
  identity: "PASS",
  duplicate: "PASS",
  stock: "PASS",
  demand: "UNPROVEN_MARKET_TEST_ALLOWED",
  shipping: "PASS",
  economics: "PASS",
  productTruthMaterial: "PASS",
  category: "PASS",
  condition: "PASS",
  productIdentifiers: "PASS",
  listingPolicy: "PASS",
  compliance: "PASS",
  evaluatedAt: "2026-09-03T12:00:00.000Z",
  ...overrides,
})

test("aspectRequired wins over the RECOMMENDED usage label", () => {
  const taxonomy = preflight()
  assert.equal(classifyOfficialEbayRequirementV1({
    taxonomyPreflight: taxonomy,
    aspect: taxonomy.aspects[0],
  }), "REQUIRED_TO_LIST")
  const result = buildOfficialEbayRequirementClassificationV1({
    taxonomyPreflight: taxonomy,
  })
  assert.equal(result.requiredToListCount, 1)
  assert.equal(result.recommendedCount, 1)
  assert.equal(result.optionalCount, 1)
  assert.deepEqual(result.blockingRequiredFacts.map((entry) =>
    entry.specificName), ["Brand"])
})

test("recommended and optional missing specifics become post-publish work", () => {
  const result = buildOfficialEbayRequirementClassificationV1({
    taxonomyPreflight: preflight({
      aspects: [aspect("Type", { usage: "RECOMMENDED" }),
        aspect("Features")],
      unprovenRequiredAspectNames: [],
    }),
  })
  assert.equal(result.blockingRequiredFacts.length, 0)
  assert.deepEqual(result.postPublishEnrichmentOpportunities.map((entry) =>
    [entry.specificName, entry.requirementClass]), [
    ["Type", "RECOMMENDED"], ["Features", "OPTIONAL"],
  ])
})

test("conditional requirements block only when the official condition applies", () => {
  const conditional = aspect("California Prop 65 Warning", {
    officialConditionalRequirement: {
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
      machineEvaluable: true,
      evaluation: "DOES_NOT_APPLY",
    },
  })
  const notApplicable = buildOfficialEbayRequirementClassificationV1({
    taxonomyPreflight: preflight({ aspects: [conditional],
      unprovenRequiredAspectNames: [] }),
  })
  assert.equal(notApplicable.conditionallyRequiredCount, 1)
  assert.equal(notApplicable.blockingRequiredFacts.length, 0)
  const applies = buildOfficialEbayRequirementClassificationV1({
    taxonomyPreflight: preflight({ aspects: [{ ...conditional,
      officialConditionalRequirement: {
        ...conditional.officialConditionalRequirement,
        evaluation: "APPLIES",
      } }], unprovenRequiredAspectNames: [] }),
  })
  assert.equal(applies.blockingRequiredFacts.length, 1)
})

test("a true missing required fact fails closed", () => {
  const result = buildMinimumTruthfulListingReadinessV1(readinessInput())
  assert.equal(result.contractVersion,
    MINIMUM_TRUTHFUL_LISTING_READINESS_V1)
  assert.equal(result.minimumTruthfulListingReady, false)
  assert.equal(result.marketTestReady, false)
  assert.deepEqual(result.blockers, ["BLOCKED_REQUIRED_FACT:Brand"])
  assert.equal(result.ownerLastMileActions.length, 1)
  assert.equal(result.ownerOnlySeesTruePublicationBlockers, true)
  assert.equal(result.factInvented, false)
})

test("unproven official capability waits and is never treated as optional", () => {
  const unavailable = { ...preflight(), status: "UNAVAILABLE" }
  const result = buildMinimumTruthfulListingReadinessV1(readinessInput({
    taxonomyPreflight: unavailable,
    productIdentifiers: "UNPROVEN_CAPABILITY",
  }))
  assert.equal(result.unprovenRequirementCount, 1)
  assert.deepEqual(result.blockers, ["WAITING_FOR_EBAY_CAPABILITY"])
  assert.equal(result.minimumTruthfulListingReady, false)
  assert.equal(result.ownerLastMileActions.length, 0)
})

test("minimum truthful readiness permits an unproven-demand market test", () => {
  const taxonomy = preflight({
    resolvedAspects: { Brand: "Acme" },
    unprovenRequiredAspectNames: [],
  })
  const result = buildMinimumTruthfulListingReadinessV1(readinessInput({
    taxonomyPreflight: taxonomy,
  }))
  assert.equal(result.minimumTruthfulListingReady, true)
  assert.equal(result.marketTestReady, true)
  assert.equal(result.listingReady, false)
  assert.equal(result.demandProven, false)
  assert.equal(result.newListingPublishOwnerOnly, true)
})

test("AI last mile is semantic-only and strict facts remain evidence-gated", () => {
  for (const field of ["Type", "Form Factor", "Department", "Style",
    "Features", "Connectivity", "Compatible Brand"]) {
    assert.equal(aiAutonomousMarketplaceResolutionAllowedV1(field), true)
  }
  for (const field of ["Brand", "Model", "UPC", "EAN", "MPN",
    "Dimensions", "Material", "Voltage", "Condition"]) {
    assert.equal(aiAutonomousMarketplaceResolutionAllowedV1(field), false)
  }
})
