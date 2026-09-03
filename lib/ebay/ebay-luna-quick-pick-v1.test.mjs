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

const {
  classifyLunaQuickPickDemandDiscoveryV1,
  collectLunaQuickPickInputsV1,
  isRehydratableQuickPickOperationV1,
  normalizeLunaQuickPickUrlsV1,
  readLunaQuickPickProgressV1,
  reconcileLunaQuickPickCardLivenessV1,
  resolveLunaQuickPickInputV1,
} = await import("./ebay-luna-quick-pick-v1.ts")
const { buildSellerOsOnDemandCapabilityGapFallbackV1 } = await import(
  "./ebay-demand-first-broad-net-orchestrator-v1.ts")
const { buildRadarRevenueFactoryCandidateBatchV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts")

const url = "https://www.lunaportex.com/products/test-product"

function row(variantId, sku, available = true) {
  return {
    product_id: "100",
    supplier_product_id: "100",
    supplier_variant_id: variantId,
    sku,
    title: "Exact test product",
    variant_title: `Variant ${variantId}`,
    product_type: "home kitchen",
    tags: [], metadata: {}, price: 12.5,
    available, inventory_quantity: available ? 4 : 0,
    product_url: url, image_urls: [], barcode: null,
    captured_at: "2026-08-31T12:00:00.000Z",
  }
}

test("canonicalizes duplicate multiline input and preserves distinct variants", () => {
  assert.deepEqual(normalizeLunaQuickPickUrlsV1(`${url}\n${url}/\n${url}?variant=2`),
    [url, `${url}?variant=2`])
})

test("batch receipt counts raw, canonical unique and rejected inputs separately", () => {
  const collected = collectLunaQuickPickInputsV1([
    url, `${url}/`, `${url}?variant=2`, "https://example.com/not-luna",
  ])
  assert.equal(collected.rawInputCount, 4)
  assert.equal(collected.urls.length, 2)
  assert.equal(collected.invalid.length, 1)
})

test("rejects malformed Luna input at the canonical normalization boundary", () => {
  assert.throws(() => normalizeLunaQuickPickUrlsV1(`${url}\nhttps://example.com/x`),
    /LUNA_QUICK_PICK_URL_INVALID/)
})

test("requires a selector when multiple eligible variants lack exact intent", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")] })
  assert.equal(result.selected, null)
  assert.equal(result.blocker, "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED")
  assert.equal(result.variants.length, 2)
})

test("cross-checks an explicit URL variant and never picks the first row", async () => {
  const result = await resolveLunaQuickPickInputV1({
    sourceUrl: `${url}?variant=2`,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")],
  })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.selected?.supplierSku, "SKU2")
  assert.equal(result.blocker, null)
})

test("auto-selects the sole eligible variant while preserving unavailable choices", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1", false), row("2", "SKU2", true)] })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.variants.length, 2)
})

test("preserves canonical available stock when quantity is not explicitly supplied", async () => {
  const exact = row("53002139205856", "FL-NHPF3369737")
  exact.inventory_quantity = null
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [exact] })
  assert.equal(result.selected?.available, true)
})

test("new Quick Pick capability gap continues as demand unproven", () => {
  const catalogRow = row("53002139205856", "FL-NHPF3369737")
  catalogRow.product_id = "9878493888736"
  catalogRow.supplier_product_id = "9878493888736"
  catalogRow.title = "Clear Over the Door Shoe Organizer with 24 Fabric Pockets"
  catalogRow.product_type = "Bags & Storage"
  catalogRow.tags = ["Category: Bags & Storage"]
  const discovery = buildSellerOsOnDemandCapabilityGapFallbackV1({
    lunaCatalogRow: catalogRow,
    reasonCode: "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED",
  })
  assert.equal(discovery.status, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(discovery.demandNegativeEvidencePresent, false)
  assert.equal(classifyLunaQuickPickDemandDiscoveryV1(discovery),
    "CONTINUE_DEMAND_UNPROVEN")
  const genericFamily = {
    ...discovery.marketTestRadarFamily,
    familyId: `market-family-v1:sha256:${"e".repeat(64)}`,
    opportunityCaseId: `opportunity-case-v1:sha256:${"f".repeat(64)}`,
    exactSupplierIdentity: undefined,
    observationSeries: [{
      ...discovery.marketTestRadarFamily.observationSeries[0],
      familyDemandStatus: "FAMILY_DEMAND_PROVEN",
      soldComparableCount: 3,
      soldQuantity: 4,
      limitations: [],
      attributeProfile: {
        "category id": "123",
        "product family": "shoe organizer",
      },
    }],
  }
  const batch = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: { status: "AVAILABLE",
      families: [genericFamily, discovery.marketTestRadarFamily] },
    frontierPayload: { frontiers: [] },
    lunaCatalogRows: [catalogRow],
    allowUnprovenMarketTest: true,
  })
  assert.equal(batch.candidates.length, 1)
  assert.equal(batch.candidates[0].marketTestPath, true)
  assert.equal(batch.candidates[0].lineage.familyDemandStatus,
    "FAMILY_DEMAND_UNPROVEN")
  assert.equal(batch.candidates[0].familyId,
    discovery.marketTestRadarFamily.familyId)
  assert.equal(batch.candidates[0].readyForEconomics, false)
})

test("explicit negative demand evidence remains blocked", () => {
  assert.equal(classifyLunaQuickPickDemandDiscoveryV1({
    status: "FAMILY_DEMAND_UNPROVEN",
    soldComparableCount: 0,
    familyBindingCreatedOrReused: false,
    familyId: null,
    familyName: null,
    exactProductDemandClaimed: false,
    reasonCode: "EXPLICIT_NEGATIVE_DEMAND_EVIDENCE",
    demandNegativeEvidencePresent: true,
    marketTestRadarFamily: {},
  }), "BLOCK_NEGATIVE_DEMAND")
})

test("RUNNING without active execution projects a recoverable waiting state", () => {
  const current = reconcileLunaQuickPickCardLivenessV1({
    sourceUrl: url, canonicalUrl: url, sourceSku: "ITEM3177",
    lunaProductId: "9220840030432", lunaVariantId: "48809651568864",
    candidateId: null, opportunityId: null, candidateKey: null,
    listingPackageId: null, title: "3 in 1 Wireless Clip-on Microphones",
    state: "RUNNING", lastStage: "SHIPPING",
    disposition: "PARKED_ECONOMICS", exactBlocker: "ACTUAL_LUNA_SHIPPING",
    exactBlockers: ["ACTUAL_LUNA_SHIPPING"], variantSelectionRequired: false,
    variants: [], alreadyLive: false, linkedLiveItemIds: [],
    durableFamilyHit: false, onDemandDemandDiscoveryRequired: false,
    onDemandDemandDiscoveryExecuted: false, soldComparableCount: 0,
    familyDemandStatus: null, familyBindingCreatedOrReused: false,
    demandEvidenceClass: null, demandNegativeEvidencePresent: false,
    marketTestPathEligible: false, marketTestReady: false,
    marketTestReview: null, requiredItemSpecificsCount: null,
    requiredItemSpecificsSatisfied: null, requiredItemSpecificsReady: null,
    unresolvedRequiredAspects: [], deterministicResolvedCount: 0,
    marketplaceFallbackResolvedCount: 0, aiCallCount: 0,
    aiAspectsResolvedCount: 0, factInvented: false,
    automaticResolutionExhausted: false,
    automaticResolutionContractCurrent: false,
    exactUnresolvedFields: [], ownerResidualActions: [], nextOwnerAction: null,
    marketplaceReadinessReady: false, conditionReady: null,
    shippingUsd: null, rehydrated: true, updatedAt: null,
    stages: { IDENTITY: "PASS", DUPLICATE: "PASS", STOCK: "PASS",
      DEMAND: "PASS", SHIPPING: "RUNNING", ECONOMICS: "BLOCKED",
      PRODUCT_TRUTH: "BLOCKED", LISTING_PACKAGE: "BLOCKED",
      REQUIRED_SPECIFICS: "BLOCKED", MARKETPLACE_READINESS: "BLOCKED",
      LISTING_READY: "BLOCKED" }, dollarCheck: null, listingReview: null,
    overnightEnrichmentPending: false, overnightEnrichmentStatus: null,
    overnightEnrichmentLastRunAt: null, elapsedMs: 0,
  })
  assert.equal(current.state, "WAITING")
  assert.equal(current.disposition, "WAITING_FOR_SHIPPING_WORKER")
  assert.equal(current.stages.SHIPPING, "WAITING")
  assert.equal(current.exactBlocker, null)
})

test("rehydrates marked operations and the bounded legacy market-test lineage", () => {
  const durableFamily = `market-family-v1:sha256:${"a".repeat(64)}`
  const syntheticFamily = `market-family-v1:sha256:${"b".repeat(64)}`
  assert.equal(isRehydratableQuickPickOperationV1({
    assessment: { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    } }, durableFamilyIds: new Set([durableFamily]),
  }), true)
  assert.equal(isRehydratableQuickPickOperationV1({ assessment: {
    radarFactoryCandidateV1: { familyId: syntheticFamily },
    radarAutomaticLunaShippingContinuationV1: {
      contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
    },
  }, durableFamilyIds: new Set([durableFamily]) }), true)
  assert.equal(isRehydratableQuickPickOperationV1({ assessment: {
    radarFactoryCandidateV1: { familyId: durableFamily },
    radarAutomaticLunaShippingContinuationV1: {
      contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
    },
  }, durableFamilyIds: new Set([durableFamily]) }), false)
})

class ReadQuery {
  constructor(data) { this.data = data }
  select() { return this }
  eq() { return this }
  in() { return this }
  order() { return this }
  limit() { return Promise.resolve({ data: this.data, error: null }) }
}

test("durable progress projects every Scan Reader blocker at its real stage", async () => {
  const candidateKey = `sha256:${"3".repeat(64)}`
  const queueRow = {
    id: "d348a69b-e44a-4b4d-9215-c8e9a9f39f44",
    candidate_key: candidateKey,
    supplier_product_id: "9220840456416",
    supplier_variant_id: "48809652158688",
    supplier_sku: "Alibaba-ScanReader-DigitalPen-B0CPHN5395",
    product_title: "Scan Reader Pen",
    queue_status: "review",
    decision: "FACTORY_PREPARED",
    updated_at: "2026-09-01T03:14:19.511Z",
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
        sourceUrl: `${url}?variant=48809652158688`,
        canonicalUrl: url,
      },
      sellerOsDeterministicFactory: {
        blockers: [
          "MARKETPLACE_CONDITION_NOT_READY",
          "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:MPN|Brand",
        ],
        stageStatuses: {
          DEMAND_READY: "READY", ECONOMICS_READY: "READY",
          PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY",
        },
      },
      radarAutomaticLunaShippingContinuationV1: {
        shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
        firstBlocker: "MARKETPLACE_CATEGORY_NOT_READY",
      },
      canonicalMarketplaceReadinessV1: {
        conditionReady: false,
        ready: false,
        requiredItemSpecificsCount: 2,
        requiredItemSpecificsSatisfied: 0,
        requiredItemSpecificsReady: false,
        unsupportedRequiredSpecifics: ["MPN", "Brand"],
      },
    },
  }
  const supabase = {
    from(table) {
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_listing_packages") return new ReadQuery([])
      if (table === "market_radar_latest_variants") return new ReadQuery([{
        supplier_product_id: queueRow.supplier_product_id,
        supplier_variant_id: queueRow.supplier_variant_id,
        sku: queueRow.supplier_sku,
        product_url: url,
      }])
      if (table === "seller_os_luna_linkage_decisions" ||
          table === "ebay_active_listings") return new ReadQuery([])
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    rpc() { return Promise.resolve({ data: { frontiers: [] }, error: null }) },
  }
  const [card] = await readLunaQuickPickProgressV1({
    supabase, candidateKeys: [candidateKey], accountKey: "seller:test",
  })
  assert.equal(card.lastStage, "REQUIRED_SPECIFICS")
  assert.equal(card.stages.REQUIRED_SPECIFICS, "BLOCKED")
  assert.equal(card.stages.MARKETPLACE_READINESS, "BLOCKED")
  assert.deepEqual(card.exactBlockers, [
    "MARKETPLACE_CONDITION_NOT_READY",
    "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:MPN|Brand",
  ])
  assert.equal(card.requiredItemSpecificsCount, 2)
  assert.equal(card.requiredItemSpecificsSatisfied, 0)
  assert.equal(card.requiredItemSpecificsReady, false)
  assert.deepEqual(card.unresolvedRequiredAspects, ["MPN", "Brand"])
  assert.equal(card.conditionReady, false)
})

test("durable progress removes an official optional field from the critical path", async () => {
  const candidateKey = `sha256:${"6".repeat(64)}`
  const opportunityId = "66666666-6666-4666-8666-666666666666"
  const queueRow = {
    id: opportunityId, candidate_key: candidateKey,
    supplier_product_id: "9220000000001",
    supplier_variant_id: "48800000000001",
    supplier_sku: "GENERIC-OPTIONAL",
    supplier_available: true, supplier_price: 5.5,
    supplier_inventory_quantity: 4,
    product_title: "Adjustable Black Car Phone Holder",
    queue_status: "review", decision: "FACTORY_PREPARED",
    updated_at: "2026-09-03T12:00:00.000Z",
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
        sourceUrl: `${url}?variant=48800000000001`, canonicalUrl: url,
      },
      sellerOsDeterministicFactory: {
        decisionPackageId: null,
        blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Style"],
        stageStatuses: { DEMAND_READY: "READY", ECONOMICS_READY: "READY",
          PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY" },
      },
      radarAutomaticLunaShippingContinuationV1: {
        shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
      },
      productTruth: { exact: true, evidenceDigest: `sha256:${"7".repeat(64)}`,
        lunaProductId: "9220000000001", lunaVariantId: "48800000000001",
        supplierSku: "GENERIC-OPTIONAL",
        title: "Adjustable Black Car Phone Holder" },
      quickPickMarketTestReviewV1: { finalDecision: "WAITING",
        testPrice: 29.99, supplierCost: 5.5, shipping: 6.99,
        ebayFees: 5.21, profit: 8.29, margin: 27.64, roi: 150.73 },
      quickPickRequiredSpecificsContinuationV1: {
        exactUnresolvedFields: ["Style"], residualOwnerActions: [],
      },
      canonicalMarketplaceReadinessV1: { ready: false,
        categoryReady: true, categoryId: "35190",
        categoryName: "Cell Phone Mounts", conditionReady: true,
        conditionId: "1000", conditionLabel: "New",
        listingPolicyReady: true, productIdentifiersReady: true,
        requiredItemSpecificsReady: false,
        requiredItemSpecificsCount: 1, requiredItemSpecificsSatisfied: 0,
        unsupportedRequiredSpecifics: ["Style"],
        blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Style"],
      },
      minimumTruthfulListingReadinessV1: {
        contractVersion: "MINIMUM_TRUTHFUL_LISTING_READINESS_V1",
        candidateKey, opportunityId,
        minimumTruthfulListingReady: true, marketTestReady: true,
        listingReady: false, blockers: [], ownerLastMileActions: [],
        postPublishEnrichmentOpportunities: [{ specificName: "Style",
          requirementClass: "OPTIONAL" }],
        unprovenRequirementCount: 0,
        gateStates: { demand: "UNPROVEN_MARKET_TEST_ALLOWED",
          productIdentifiers: "PASS" },
        safeResumeFrom:
          "PRODUCT_TRUTH_REQUIRED_SPECIFICS_IDENTIFIER_POLICY_MARKETPLACE_READINESS",
      },
    },
  }
  const listingPackage = { id: "77777777-7777-4777-8777-777777777777",
    opportunity_id: opportunityId, candidate_key: candidateKey,
    package_data: { categoryId: "35190", conditionId: "1000",
      conditionLabel: "New", aspects: {},
      pricing: { supplierCost: 5.5, targetPrice: 29.99 } } }
  const supabase = {
    from(table) {
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_listing_packages") {
        return new ReadQuery([listingPackage])
      }
      if (table === "market_radar_latest_variants") return new ReadQuery([{
        supplier_product_id: queueRow.supplier_product_id,
        supplier_variant_id: queueRow.supplier_variant_id,
        sku: queueRow.supplier_sku, product_url: url,
        title: queueRow.product_title, variant_title: "Black",
        product_type: "Phone Holder", tags: ["adjustable"],
      }])
      if (table === "seller_os_luna_linkage_decisions" ||
          table === "ebay_active_listings") return new ReadQuery([])
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    rpc() { return Promise.resolve({ data: { frontiers: [{ frontier: {
      lunaProductId: queueRow.supplier_product_id,
      lunaVariantId: queueRow.supplier_variant_id,
      lunaSku: queueRow.supplier_sku,
      shippingStatus: "SHIPPING_DURABLY_PERSISTED", shippingValue: 6.99,
      breakEvenSellingPrice: 18.42,
    } }] }, error: null }) },
  }
  const [card] = await readLunaQuickPickProgressV1({ supabase,
    candidateKeys: [candidateKey], accountKey: "seller:test" })
  assert.equal(card.state, "READY")
  assert.equal(card.marketTestReady, true)
  assert.equal(card.minimumTruthfulListingReady, true)
  assert.equal(card.stages.REQUIRED_SPECIFICS, "PASS")
  assert.deepEqual(card.unresolvedRequiredAspects, [])
  assert.deepEqual(card.ownerTruePublicationBlockers, [])
  assert.equal(card.postPublishEnrichmentOpportunities[0].specificName,
    "Style")
  assert.deepEqual(card.exactBlockers, [])
  assert.equal(card.listingReview.finalListingPackageReady, true)
})

test("durable progress rechecks exact LIVE linkage before projecting a ready card", async () => {
  const candidateKey = `sha256:${"4".repeat(64)}`
  const itemId = "366643122092"
  const queueRow = {
    id: "b7087b76-3c03-4892-b99b-421a6f0c545c",
    candidate_key: candidateKey,
    supplier_product_id: "9220873322720",
    supplier_variant_id: "48809689415904",
    supplier_sku: "FL-CUP-PHONE-MOUNT",
    product_title: "Car Windshield Phone Holder",
    queue_status: "ready",
    decision: "MARKET_TEST_READY",
    updated_at: "2026-09-01T22:00:00.000Z",
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
        sourceUrl: `${url}?variant=48809689415904`,
        canonicalUrl: url,
      },
    },
  }
  const supabase = {
    from(table) {
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_listing_packages") return new ReadQuery([{
        id: "d28114ba-01d9-4134-90e4-927035e66255",
        opportunity_id: queueRow.id,
        candidate_key: candidateKey,
      }])
      if (table === "market_radar_latest_variants") return new ReadQuery([{
        supplier_product_id: queueRow.supplier_product_id,
        supplier_variant_id: queueRow.supplier_variant_id,
        sku: queueRow.supplier_sku,
        product_url: url,
      }])
      if (table === "seller_os_luna_linkage_decisions") {
        return new ReadQuery([{
          decision_id: "luna-linkage-decision-v1:sha256:" + "a".repeat(64),
          ebay_item_id: itemId,
          luna_product_id: queueRow.supplier_product_id,
          luna_variant_id: queueRow.supplier_variant_id,
          luna_sku: queueRow.supplier_sku,
          decision: "APPROVE_EXACT_LINKAGE",
          decision_version: 1,
          classification: "EXACT_UNIQUE_MATCH",
          contract_version: "SELLER_OS_LUNA_LINKAGE_DECISION_V1",
        }])
      }
      if (table === "ebay_active_listings") return new ReadQuery([{
        ebay_item_id: itemId,
        listing_status: "active",
      }])
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    rpc() { return Promise.resolve({ data: { frontiers: [] }, error: null }) },
  }
  const [card] = await readLunaQuickPickProgressV1({
    supabase, candidateKeys: [candidateKey], accountKey: "seller:test",
  })
  assert.equal(card.alreadyLive, true)
  assert.deepEqual(card.linkedLiveItemIds, [itemId])
  assert.equal(card.disposition, "EXCLUDED_ALREADY_LIVE")
  assert.equal(card.lastStage, "DUPLICATE")
  assert.equal(card.exactBlocker, "ALREADY_LIVE_EXACT_PRODUCT")
  assert.equal(card.stages.IDENTITY, "PASS")
  assert.equal(card.stages.DUPLICATE, "BLOCKED")
  assert.equal(card.marketTestReady, false)
})

test("Quick Pick remains a shared-factory feeder with bounded AI and no publish path", async () => {
  const source = await readFile(new URL("./ebay-luna-quick-pick-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../../app/api/admin/ebay/luna-quick-pick/route.ts",
    import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/quick-pick/page.tsx",
    import.meta.url), "utf8")
  assert.match(source, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.ok(source.indexOf("readAlreadyLiveExactLunaIdentitiesV1") <
    source.indexOf("buildRadarRevenueFactoryCandidateBatchV1({\n    radarPayload"))
  assert.match(source, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(source, /discoverAndPersistSellerOsOnDemandFamilyDemandV1/)
  assert.match(source, /LUNA_QUICK_PICK_DEMAND_DISCOVERY_CONCURRENCY = 2/)
  assert.match(source, /familyBindingCreatedOrReused/)
  assert.doesNotMatch(source,
    /LUNA_QUICK_PICK_COMPATIBLE_FAMILY_DEMAND_UNAVAILABLE/)
  assert.match(source, /requiredSpecificsAiStages: \[\]/)
  assert.match(source, /continuation owns the one bounded residual AI batch/)
  assert.doesNotMatch(source, /requiredSpecificsAiStages: \["TEXT"\]/)
  assert.match(source, /lunaQuickPickOperationV1/)
  assert.match(source, /QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1/)
  assert.match(source, /fullLunaBrandEvidenceReviewRequired: true/)
  assert.match(source, /fullLunaBrandEvidenceReviewPending/)
  assert.match(source, /QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1/)
  assert.match(source, /from\("ebay_seller_automation_runs"\)/)
  assert.match(source, /run_kind: "manual_acceleration"/)
  assert.match(source, /lanes: \["quick_pick"\]/)
  assert.match(source, /duplicateOperationCount: 0/)
  assert.match(source, /WAITING_FOR_IDENTITY_CONTINUATION/)
  assert.match(source, /WAITING_FOR_SHIPPING_WORKER/)
  assert.match(source, /boundedConcurrency: LUNA_QUICK_PICK_CONCURRENCY/)
  assert.match(source, /EXCLUDED_DUPLICATE_INPUT/)
  assert.match(source, /LUNA_QUICK_PICK_CANONICAL_STOCK_NOT_READY/)
  assert.match(source, /resolutionAttempts\.flatMap/)
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
  assert.match(page, /window\.setInterval\(\(\) => void poll\(\), 2_500\)/)
  assert.match(page, /Recuperando tus Quick Picks guardados/)
  assert.match(page, /Lote recibido/)
  assert.match(page, /No pude cargar el estado del lote · reintentando/)
  assert.match(page, /REQUIRED_SPECIFICS/)
  assert.match(route, /body\.action === "RECEIVE"/)
  assert.match(route, /body\.action === "PROCESS"/)
  assert.match(route, /readLunaQuickPickBatchReceiptsV1/)
  assert.match(route, /materializeSellerOsDeterministicFactoryCandidateV1/)
  assert.match(route, /offset \+= 3/)
  assert.match(route, /card\.stages\.SHIPPING === "PASS"/)
  assert.doesNotMatch(route, /ITEM3177|ITEM3355|ITEM3499/)
  assert.match(page, /En proceso/)
  assert.match(page, /Listos para revisar/)
  assert.match(page, /Esperando worker Luna/)
  assert.match(page, /PUBLICAR EN EBAY/)
  assert.match(page, /listing-workspace\?opportunity=/)
})
