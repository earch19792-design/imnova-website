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
  authorizeLunaQuickPickPostActionV1,
  classifyLunaQuickPickDemandDiscoveryV1,
  collectLunaQuickPickInputsV1,
  isRehydratableQuickPickOperationV1,
  LUNA_QUICK_PICK_SERVICE_ROLE_ACTIONS_V1,
  normalizeLunaQuickPickUrlsV1,
  quickPickLivePortfolioPolicyV1,
  readLunaQuickPickBatchRehydrationV1,
  readLunaQuickPickProgressV1,
  reconcileLunaQuickPickCardLivenessV1,
  resolveLunaQuickPickInputV1,
} = await import("./ebay-luna-quick-pick-v1.ts")
const { buildSellerOsOnDemandCapabilityGapFallbackV1 } = await import(
  "./ebay-demand-first-broad-net-orchestrator-v1.ts")
const { buildRadarRevenueFactoryCandidateBatchV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts")

const url = "https://www.lunaportex.com/products/test-product"

test("service role is limited to non-publishing Quick Pick actions", () => {
  const allowedActions = [
    "RECEIVE", "PROCESS", "REHYDRATE", "CONTINUE_FULL_LUNA_EVIDENCE",
  ]
  assert.deepEqual([...LUNA_QUICK_PICK_SERVICE_ROLE_ACTIONS_V1], allowedActions)

  for (const action of allowedActions) {
    const authorization = authorizeLunaQuickPickPostActionV1({
      authenticationMode: "service_role", action,
    })
    assert.equal(authorization.allowed, true, action)
    assert.equal(authorization.marketplaceWrites, 0, action)
    assert.equal(authorization.canPublish, false, action)
  }

  for (const action of ["OWNER_FACT_CAPTURE", "RESOLVE_REQUIRED_UPC",
    "OWNER_REVIEW", "PUBLISH_HANDOFF", "UNKNOWN_ACTION", null]) {
    const authorization = authorizeLunaQuickPickPostActionV1({
      authenticationMode: "service_role", action,
    })
    assert.equal(authorization.allowed, false, String(action))
    assert.equal(authorization.error,
      "LUNA_QUICK_PICK_SERVICE_ROLE_ACTION_FORBIDDEN", String(action))
    assert.equal(authorization.marketplaceWrites, 0, String(action))
    assert.equal(authorization.canPublish, false, String(action))
  }

  assert.equal(authorizeLunaQuickPickPostActionV1({
    authenticationMode: null, action: "RECEIVE",
  }).allowed, false)

  for (const action of ["OWNER_FACT_CAPTURE", "RESOLVE_REQUIRED_UPC",
    "OWNER_REVIEW", "PUBLISH_HANDOFF", "UNKNOWN_ACTION"]) {
    assert.equal(authorizeLunaQuickPickPostActionV1({
      authenticationMode: "admin_user", action,
    }).allowed, true, action)
  }
})

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
    accountKey: "test-account",
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

test("exact Luna identity continues when supplier product type is absent", () => {
  const catalogRow = row("53002139205856", "FL-NHPF3369737")
  catalogRow.product_id = "9878493888736"
  catalogRow.supplier_product_id = "9878493888736"
  catalogRow.title = "Clear Over the Door Shoe Organizer with 24 Fabric Pockets"
  catalogRow.product_type = null
  catalogRow.tags = []
  const discovery = buildSellerOsOnDemandCapabilityGapFallbackV1({
    lunaCatalogRow: catalogRow,
    reasonCode: "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED",
  })
  assert.equal(discovery.status, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(discovery.demandNegativeEvidencePresent, false)
  assert.equal(discovery.marketTestRadarFamily.observationSeries[0]
    .limitations.includes("SUPPLIER_PRODUCT_TYPE_UNPROVEN"), true)
  const batch = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: { status: "AVAILABLE",
      families: [discovery.marketTestRadarFamily] },
    frontierPayload: { frontiers: [] },
    lunaCatalogRows: [catalogRow],
    allowUnprovenMarketTest: true,
  })
  assert.equal(batch.candidates.length, 1)
  assert.equal(batch.candidates[0].marketTestPath, true)
  assert.equal(batch.candidates[0].lunaProductId, "9878493888736")
  assert.equal(batch.candidates[0].lunaVariantId, "53002139205856")
  assert.equal(batch.candidates[0].supplierSku, "FL-NHPF3369737")
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

test("temporary CURRENT LIVE failure blocks publication but not preparation", () => {
  const policy = quickPickLivePortfolioPolicyV1({ status: "UNAVAILABLE",
    reasonCode: "ALREADY_LIVE_OFFICIAL_PORTFOLIO_UNAVAILABLE" })
  assert.equal(policy.preparationAllowed, true)
  assert.equal(policy.duplicateCheckReady, false)
  assert.equal(policy.publicationAllowed, false)
  assert.deepEqual(policy.publicationBlockers,
    ["ALREADY_LIVE_OFFICIAL_PORTFOLIO_UNAVAILABLE"])
  assert.deepEqual(quickPickLivePortfolioPolicyV1({ status: "AVAILABLE",
    reasonCode: null }).publicationBlockers, [])
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

function currentLiveFixture(ids) {
 const observedAt=new Date().toISOString()
 return {current_live_source_state:'CURRENT_FRESH',last_certified_live_scope_id:'current-live:sha256:'+'a'.repeat(64),
 last_certified_live_item_ids:ids,last_certified_live_count:ids.length,last_certified_live_observed_at:observedAt,
 last_certified_live_fresh_until:new Date(Date.now()+600000).toISOString(),
 last_certified_live_source_authority:'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'}
}

class ReadQuery {
  constructor(data) { this.data = data }
  select() { return this }
  eq() { return this }
  contains() { return this }
  in() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return Promise.resolve({data:this.data[0]??null,error:null}) }
  then(yes,no) {return Promise.resolve({data:this.data,error:null}).then(yes,no)}
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
      if (table === "ebay_active_listing_sync_state") return new ReadQuery([currentLiveFixture(typeof itemId === 'undefined' ? [] : [itemId])])
      if (table === "seller_os_listing_product_link_authorities_v1" || table === "seller_os_listing_identity_quarantines_v1") return new ReadQuery([])
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_current_listing_packages_v1") return new ReadQuery([])
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
      if (table === "ebay_active_listing_sync_state") return new ReadQuery([currentLiveFixture(typeof itemId === 'undefined' ? [] : [itemId])])
      if (table === "seller_os_listing_product_link_authorities_v1" || table === "seller_os_listing_identity_quarantines_v1") return new ReadQuery([])
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_current_listing_packages_v1") {
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
      if (table === "ebay_active_listing_sync_state") return new ReadQuery([currentLiveFixture(typeof itemId === 'undefined' ? [] : [itemId])])
      if (table === "seller_os_listing_product_link_authorities_v1" || table === "seller_os_listing_identity_quarantines_v1") return new ReadQuery([])
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_current_listing_packages_v1") return new ReadQuery([{
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

test("durable progress keeps its real stage when current-live authority is unavailable", async () => {
  const candidateKey = `sha256:${"8".repeat(64)}`
  const queueRow = {
    id: "88888888-8888-4888-8888-888888888888",
    candidate_key: candidateKey,
    supplier_product_id: "9220000000008",
    supplier_variant_id: "48800000000008",
    supplier_sku: "STALE-LIVE-AUTHORITY",
    product_title: "Safe blocked projection",
    queue_status: "review",
    decision: "FACTORY_PREPARED",
    updated_at: "2026-09-03T12:00:00.000Z",
    assessment: { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
      sourceUrl: `${url}?variant=48800000000008`,
      canonicalUrl: url,
    } },
  }
  const supabase = {
    from(table) {
      if (table === "ebay_active_listing_sync_state") return new ReadQuery([{
        current_live_source_state: "CURRENT_UNAVAILABLE",
        current_live_last_error_code:
          "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
      }])
      if (table === "seller_os_listing_registry_sweeps_v1" ||
          table === "ebay_current_listing_packages_v1" ||
          table === "market_radar_products") return new ReadQuery([])
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "market_radar_latest_variants") return new ReadQuery([{
        supplier_product_id: queueRow.supplier_product_id,
        supplier_variant_id: queueRow.supplier_variant_id,
        sku: queueRow.supplier_sku,
        product_url: url,
      }])
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    rpc() { return Promise.resolve({ data: { frontiers: [] }, error: null }) },
  }
  const [card] = await readLunaQuickPickProgressV1({
    supabase, candidateKeys: [candidateKey], accountKey: "seller:test",
  })
  assert.equal(card.state, "WAITING")
  assert.equal(card.lastStage, "ECONOMICS")
  assert.equal(card.disposition, "WAITING_FOR_ECONOMICS_CONTINUATION")
  assert.equal(card.exactBlocker, null)
  assert.equal(card.stages.DUPLICATE, "PASS")
  assert.deepEqual(card.publicationBlockers,
    ["ALREADY_LIVE_OFFICIAL_PORTFOLIO_UNAVAILABLE"])
  assert.equal(card.alreadyLive, false)
})

test("rehydration retries legacy cards blocked by transient live authority", async () => {
  const batchId = "99999999-9999-4999-8999-999999999999"
  const variantId = "48800000000009"
  const sourceUrl = `${url}?variant=${variantId}`
  const receipt = {
    id: batchId,
    started_at: "2026-09-03T12:00:00.000Z",
    heartbeat_at: "2026-09-03T12:01:00.000Z",
    metrics: {
      contractVersion: "QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1",
      inputs: [{ canonicalUrl: url, variantId }],
      cards: [{ sourceUrl, canonicalUrl: url,
        lunaProductId: "9220000000009", lunaVariantId: variantId,
        sourceSku: "TRANSIENT-LIVE-RETRY", state: "BLOCKED",
        lastStage: "DUPLICATE", disposition: "BLOCKED_FAIL_CLOSED",
        exactBlocker: "ALREADY_LIVE_OFFICIAL_PORTFOLIO_UNAVAILABLE" }],
    },
  }
  const supabase = { from(table) {
    assert.equal(table, "ebay_seller_automation_runs")
    return new ReadQuery([receipt])
  } }
  const result = await readLunaQuickPickBatchRehydrationV1({ supabase, batchId })
  assert.deepEqual(result.rehydrateUrls, [sourceUrl])
  assert.deepEqual(result.authorityRetryUrls, [sourceUrl])
  assert.equal(result.authorityRetryIdentityKeys.has(
    `9220000000009\n${variantId}\nTRANSIENT-LIVE-RETRY`), true)
  assert.equal(result.capabilityGaps.size, 0)
  assert.equal(result.newOperationCount, 0)
})

test("Quick Pick remains a shared-factory feeder and technical recovery needs no owner click", async () => {
  const source = await readFile(new URL("./ebay-luna-quick-pick-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../../app/api/admin/ebay/luna-quick-pick/route.ts",
    import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/quick-pick/page.tsx",
    import.meta.url), "utf8")
  const ownerReadModel = await readFile(new URL(
    "./seller-os-quick-pick-owner-read-model-v1.ts", import.meta.url), "utf8")
  assert.match(source, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.ok(source.indexOf("const liveGuard = await readAlreadyLiveExactLunaIdentitiesV1") <
    source.search(/let currentBatch = buildRadarRevenueFactoryCandidateBatchV1\(\{\s+accountKey/))
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
  assert.doesNotMatch(page, /window\.setInterval\(\(\) => void poll/)
  assert.match(page, /loadReadModel/)
  assert.match(page, /QUICK_PICK_READ_TIMEOUT_MS = 30_000/)
  assert.match(page,
    /const isReadRequest = \(init\?\.method \?\? "GET"\)\.toUpperCase\(\) === "GET"/)
  assert.match(page,
    /const controller = isReadRequest \? new AbortController\(\) : null/)
  assert.match(page,
    /const readTimeout = controller \? new Promise<never>/)
  assert.ok(page.indexOf("const readTimeout = controller") <
    page.indexOf("supabase.auth.getSession()"))
  assert.match(page,
    /Promise\.race\(\[supabase\.auth\.getSession\(\), readTimeout\]\)/)
  assert.match(page, /SELLER_OS_READ_MODEL_TIMEOUT/)
  assert.match(page,
    /code === "SELLER_OS_READ_MODEL_TIMEOUT" \|\|[\s\S]*?throw initialError/)
  assert.doesNotMatch(page,
    /_READ_FAILED\|_UNAVAILABLE\|_TIMEOUT\|HTTP_50\[234\]/)
  assert.match(page,
    /method: "POST"[\s\S]*?body: JSON\.stringify\(\{ action: "PROCESS"/)
  assert.match(page, /setRehydrating\(false\)/)
  assert.ok(page.indexOf('"\/api\/admin\/ebay\/luna-quick-pick"') <
    page.indexOf("const publisherResult = await publisherResultPromise"))
  assert.match(page, /Recuperando tus Quick Picks guardados/)
  assert.match(page, /Lote recibido/)
  assert.match(page, /No pudimos cargar Quick Pick/)
  assert.match(page, />Reintentar</)
  assert.match(page, /fullLunaBrandEvidenceReviewPending/)
  assert.doesNotMatch(page, /continueAutomaticResolution/)
  assert.doesNotMatch(page, /action: "CONTINUE_FULL_LUNA_EVIDENCE"/)
  assert.doesNotMatch(page, /Continuar resolución automática/)
  assert.match(page, /PUBLICAR \{?/)
  assert.match(page, /batchEligibleCount/)
  assert.match(route, /body\.action === "CONTINUE_FULL_LUNA_EVIDENCE"/)
  assert.match(route, /scopeMode: "EXACT_REQUEST"/)
  assert.doesNotMatch(page, /action: "REHYDRATE"/)
  assert.match(ownerReadModel, /REQUIRED_SPECIFICS/)
  assert.match(route, /body\.action === "RECEIVE"/)
  assert.match(route, /body\.action === "PROCESS"/)
  assert.match(route, /readLunaQuickPickBatchReceiptsV1/)
  assert.match(route, /buildQuickPickOwnerReadModelV1/)
  assert.match(route, /continuationExecuted: false/)
  const getBody = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function POST"))
  const postBody = route.slice(route.indexOf("export async function POST"))
  assert.doesNotMatch(getBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(postBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(route, /authorizeLunaQuickPickPostActionV1/)
  const serviceRoleGateIndex = postBody.indexOf("const actionAuthorization =")
  assert.ok(serviceRoleGateIndex >= 0)
  for (const action of ["RECEIVE", "PROCESS", "REHYDRATE",
    "CONTINUE_FULL_LUNA_EVIDENCE", "OWNER_FACT_CAPTURE",
    "RESOLVE_REQUIRED_UPC", "OWNER_REVIEW", "PUBLISH_HANDOFF"]) {
    assert.ok(serviceRoleGateIndex < postBody.indexOf(`body.action === "${action}"`),
      action)
  }
  assert.match(postBody,
    /!actionAuthorization\.allowed[\s\S]*?marketplaceWrites: actionAuthorization\.marketplaceWrites[\s\S]*?canPublish: actionAuthorization\.canPublish[\s\S]*?}, 403/)
  assert.doesNotMatch(postBody, /if \(!auth\.userId\)/)
  assert.match(source, /LUNA_QUICK_PICK_SERVICE_ROLE_ACTION_FORBIDDEN/)
  for (const action of ["OWNER_FACT_CAPTURE", "RESOLVE_REQUIRED_UPC",
    "OWNER_REVIEW", "PUBLISH_HANDOFF"]) {
    assert.match(postBody,
      new RegExp(`body\\.action === "${action}"[\\s\\S]*?if \\(!ownerUserId\\)`))
  }
  assert.doesNotMatch(route, /ITEM3177|ITEM3355|ITEM3499/)
  assert.match(page, /En ejecución/)
  assert.match(page, /A\. Listos/)
  assert.match(page, /Esperando worker Luna/)
  assert.match(page, /PUBLICAR \{?/)
  assert.doesNotMatch(page, /listing-workspace\?opportunity=/)
})
