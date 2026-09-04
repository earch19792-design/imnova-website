import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

const { projectQuickPickMinimumTruthfulReadinessV1 } = await import(
  "./ebay-quick-pick-minimum-readiness-continuation-v1.ts")

const preflight = (overrides = {}) => ({
  status: "CONSULTADO",
  officialStatus: "AVAILABLE",
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  marketplaceId: "EBAY_US",
  categoryId: "29946",
  evidenceDigest: `sha256:${"a".repeat(64)}`,
  aspects: [{ name: "Brand", required: true, usage: "RECOMMENDED",
    mode: "FREE_TEXT", cardinality: "SINGLE", maxLength: 65,
    dataType: "STRING", values: [], valuesComplete: true,
    constraintsComplete: true }],
  resolvedAspects: {},
  unprovenRequiredAspectNames: ["Brand"],
  ...overrides,
})

function opportunity(overrides = {}) {
  const candidateKey = `sha256:${"b".repeat(64)}`
  return {
    id: "11111111-1111-4111-8111-111111111111",
    candidate_key: candidateKey,
    supplier_product_id: "9220000000001",
    supplier_variant_id: "48800000000001",
    supplier_sku: "ITEM3177",
    supplier_available: true,
    supplier_price: 12.5,
    supplier_inventory_quantity: null,
    assessment: {
      radarFactoryCandidateV1: {
        contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
        authority: "SELLER_OS_DETERMINISTIC_FACTORY",
        candidateId: candidateKey,
      },
      radarAutomaticLunaShippingContinuationV1: {
        shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
      },
      productTruth: { evidenceDigest: `sha256:${"c".repeat(64)}`,
        lunaProductId: "9220000000001",
        lunaVariantId: "48800000000001", supplierSku: "ITEM3177" },
      sellerOsDeterministicFactory: {
        decisionPackageId: null,
        blockers: ["WAITING_FOR_EBAY_CAPABILITY",
          "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand"],
        stageStatuses: { DEMAND_READY: "READY", ECONOMICS_READY: "READY",
          PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY" },
      },
      quickPickRequiredSpecificsContinuationV1: {
        exactUnresolvedFields: ["Brand"],
        residualOwnerActions: [{ productField: "Brand",
          bestProposal: null, proposalEvidence: "NONE" }],
      },
      canonicalMarketplaceReadinessV1: {
        categoryReady: true, conditionReady: true, listingPolicyReady: true,
        taxonomyPreflight: preflight(),
        blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand",
          "WAITING_FOR_EBAY_CAPABILITY"],
        productIdentifiersReady: false,
        productIdentifierPolicy: { safe: false, exactPolicyFound: false,
          policies: [], missingRequiredIdentifiers: [],
          blocker: "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE",
          source: "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY",
          httpStatus: 0 },
      },
      ...overrides,
    },
  }
}

const listingPackage = {
  id: "22222222-2222-4222-8222-222222222222",
  opportunity_id: "11111111-1111-4111-8111-111111111111",
  candidate_key: `sha256:${"b".repeat(64)}`,
}

test("the persisted official required residual is the only owner action", () => {
  const result = projectQuickPickMinimumTruthfulReadinessV1({
    opportunity: opportunity(), listingPackage,
    evaluatedAt: "2026-09-03T12:00:00.000Z",
  })
  assert.equal(result.requiredToListCount, 1)
  assert.equal(result.ownerLastMileActions.length, 1)
  assert.equal(result.ownerLastMileActions[0].specificName, "Brand")
  assert.deepEqual(result.blockers, ["BLOCKED_REQUIRED_FACT:Brand",
    "WAITING_FOR_EBAY_CAPABILITY"])
  assert.equal(result.gateStates.demand, "UNPROVEN_MARKET_TEST_ALLOWED")
  assert.equal(result.previousGateReexecution.soldResearch, false)
  assert.equal(result.previousGateReexecution.visualMatching, false)
})

test("a product with no owner residual waits only for identifier policy", () => {
  const row = opportunity({
    quickPickRequiredSpecificsContinuationV1: {
      exactUnresolvedFields: [], residualOwnerActions: [],
    },
    canonicalMarketplaceReadinessV1: {
      ...opportunity().assessment.canonicalMarketplaceReadinessV1,
      taxonomyPreflight: preflight({ resolvedAspects: { Brand: "Acme" },
        unprovenRequiredAspectNames: [] }),
      blockers: ["WAITING_FOR_EBAY_CAPABILITY"],
    },
  })
  const result = projectQuickPickMinimumTruthfulReadinessV1({
    opportunity: row, listingPackage,
    evaluatedAt: "2026-09-03T12:00:00.000Z",
  })
  assert.equal(result.ownerLastMileActions.length, 0)
  assert.deepEqual(result.blockers, ["WAITING_FOR_EBAY_CAPABILITY"])
  assert.equal(result.minimumTruthfulListingReady, false)
})

test("systemic route does not rerun exhausted research and exposes owner UI", async () => {
  const [route, page, capture, continuation] = await Promise.all([
    readFile("app/api/admin/ebay/luna-quick-pick/route.ts", "utf8"),
    readFile("app/admin/ebay/quick-pick/page.tsx", "utf8"),
    readFile("lib/ebay/ebay-quick-pick-owner-fact-capture-v1.ts", "utf8"),
    readFile("lib/ebay/ebay-luna-quick-pick-required-specifics-v1.ts", "utf8"),
  ])
  assert.match(route, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(continuation, /continueLunaQuickPickRequiredSpecificsV1/)
  assert.match(route, /OWNER_FACT_CAPTURE/)
  assert.match(route, /auth\.accessRole !== SELLER_OS_ACCESS_ROLES\.owner/)
  assert.match(route, /explicitCandidateScope/)
  assert.match(page, /productos necesitan tu atención/)
  assert.match(page, /Guardar y continuar/)
  assert.match(page, /únicamente los datos que eBay exige/)
  assert.match(page, /Corregir datos que confirmaste/)
  assert.match(capture, /taxonomyFromPersistedPreflightV1/)
  assert.match(capture, /cachedIdentifierReaderV1/)
  assert.match(capture, /sellerWideTradingCalls: 0/)
  assert.doesNotMatch(capture,
    /getEbayTaxonomyListingIntelligence|searchEbay|GetSellerList|GetMyeBaySelling/)
})
