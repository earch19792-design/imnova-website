import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_BLOCKED_IDENTITY_ITEM_IDS_V1,
  SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1,
  SELLER_OS_ENDED_ITEM_IDS_EXCLUDED_V1,
  SELLER_OS_HUMAN_APPROVED_BUNDLE_V1,
  SELLER_OS_HUMAN_APPROVED_CURRENT_LINKAGES_V1,
  assertSellerOsAuthoritativeCurrentLiveCohortV1,
  assertSellerOsHumanApprovedLinkageEvidenceV1,
  buildPostPublishStockguardAttachmentV1,
  classifySellerOsCurrentListingStockguardReadinessV1,
  evaluatePublishWithStockguardContractV1,
  revalidateMaterializedPublishWithStockguardContractV1,
} from "./ebay-current-future-listing-stockguard-wiring-v1.ts"

const exactUrl = "https://lunaportex.com/products/exact-product"
const component = (overrides = {}) => ({ productId: "9220837933280",
  variantId: "48809649504480", supplierSku: "ITEM1",
  canonicalLunaUrl: exactUrl, quantityRequiredPerBundle: 1,
  identityCertified: true, stockIdentityResolved: true,
  stockState: "IN_STOCK", sourceHealth: "HEALTHY",
  freshness: "FRESH", safeCapacity: 3, ...overrides })

test("A authoritative cohort is the exact bounded 17", () => {
  const result = assertSellerOsAuthoritativeCurrentLiveCohortV1(
    SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1)
  assert.equal(result.liveCount, 17)
  assert.equal(result.authoritative, true)
})

test("B and C ended OOS and accidental ItemIDs remain excluded", () => {
  assert.deepEqual(SELLER_OS_ENDED_ITEM_IDS_EXCLUDED_V1,
    ["366569086086", "366581670145"])
  for (const ended of SELLER_OS_ENDED_ITEM_IDS_EXCLUDED_V1) {
    assert.equal(SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1.includes(ended), false)
    assert.throws(() => assertSellerOsAuthoritativeCurrentLiveCohortV1(
      [...SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1, ended]))
  }
})

test("D approved simple linkage evidence is exact and deterministic", () => {
  const approval = SELLER_OS_HUMAN_APPROVED_CURRENT_LINKAGES_V1[0]
  const evidence = approval.components.map((value) => ({ ...value,
    canonicalUrl: exactUrl, observedAt: "2026-08-24T06:00:00.000Z" }))
  const first = assertSellerOsHumanApprovedLinkageEvidenceV1({ approval,
    observedComponents: evidence })
  const replay = assertSellerOsHumanApprovedLinkageEvidenceV1({ approval,
    observedComponents: evidence })
  assert.deepEqual(first, replay)
})

test("E bundle BOM requires every mandatory exact identity", () => {
  const one = [{ ...SELLER_OS_HUMAN_APPROVED_BUNDLE_V1.components[0],
    canonicalUrl: exactUrl, observedAt: "2026-08-24T06:00:00.000Z" }]
  assert.throws(() => assertSellerOsHumanApprovedLinkageEvidenceV1({
    approval: SELLER_OS_HUMAN_APPROVED_BUNDLE_V1,
    observedComponents: one,
  }), /EXACT_EVIDENCE_REQUIRED/)
})

test("F and G unresolved identities and Lysol guard remain blocked", () => {
  assert.ok(SELLER_OS_BLOCKED_IDENTITY_ITEM_IDS_V1.includes("366543596425"))
  assert.ok(SELLER_OS_BLOCKED_IDENTITY_ITEM_IDS_V1.includes("366597780377"))
  assert.equal(classifySellerOsCurrentListingStockguardReadinessV1({
    currentLive: true, exactItemSkuIdentity: true, linkageCertified: false,
    compositionComplete: false, sourceHealth: "UNPROVEN",
    freshness: "UNPROVEN", stockState: "STOCK_UNKNOWN",
    canonicalProjectionAvailable: false,
  }), "STOCKGUARD_BLOCKED_IDENTITY")
})

test("H and I public OOS is safe zero; in-stock without quantity invents none", () => {
  const oos = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component({ stockState: "CERTIFIED_OOS", safeCapacity: 0 })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  assert.equal(oos.stockguardReady, true)
  assert.equal(oos.publishAllowed, false)
  const available = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component({ safeCapacity: null })], expectedComponentCount: 1,
    economicsReady: true, monitorEnrollmentIntentPrepared: true })
  assert.equal(available.stockguardReady, true)
  assert.equal(available.publishAllowed, true)
  assert.equal(available.attachmentIntent.sellerSku, "IMNOVA1")
  assert.equal(available.attachmentIntent.components.length, 1)
})

test("J bundle capacity readiness is fail closed on an unknown component", () => {
  const result = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component(), component({ productId: "2", variantId: "3",
      supplierSku: "ITEM2", stockState: "STOCK_UNKNOWN",
      sourceHealth: "UNAVAILABLE", freshness: "UNPROVEN", safeCapacity: null })],
    expectedComponentCount: 2, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  assert.equal(result.stockguardReady, false)
  assert.equal(result.publishAllowed, false)
})

test("K and L future publish is blocked without exact linkage or StockGuard", () => {
  const missingLink = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component({ identityCertified: false })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  const missingStock = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component({ sourceHealth: "UNAVAILABLE" })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  assert.equal(missingLink.noExactLunaLinkageNoPublish, true)
  assert.equal(missingLink.publishAllowed, false)
  assert.equal(missingStock.noStockguardReadyNoPublish, true)
  assert.equal(missingStock.publishAllowed, false)
})

test("future publish is blocked without monitor enrollment intent", () => {
  const result = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component()], expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: false })
  assert.equal(result.noMonitorEnrollmentNoPublish, true)
  assert.equal(result.monitorEnrollmentIntentPrepared, false)
  assert.equal(result.publishAllowed, false)
  assert.ok(result.blockers.includes("MONITOR_ENROLLMENT_INTENT_REQUIRED"))
})

test("future publish is blocked until exact stock identity is resolved", () => {
  const result = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component({ stockIdentityResolved: false })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  assert.equal(result.noStockIdentityResolutionNoPublish, true)
  assert.equal(result.publishAllowed, false)
  assert.ok(result.blockers.includes("STOCK_IDENTITY_RESOLUTION_REQUIRED"))
})

test("M and N official ItemID attaches to certified lineage without rediscovery", () => {
  const prePublish = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component()], expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  const attached = buildPostPublishStockguardAttachmentV1({ prePublish,
    sellerSku: "IMNOVA1", officialSellerSku: "IMNOVA1",
    officialItemId: "366999999999", activeObservationVerified: true,
    stockguardEnrollmentPersisted: true, monitorEnrollmentPersisted: true })
  assert.equal(attached.officialItemIdAttached, true)
  assert.equal(attached.stockguardEnrolled, true)
  assert.equal(attached.monitorEnrolled, true)
  assert.equal(attached.manualRediscoveryRequired, false)
  assert.throws(() => buildPostPublishStockguardAttachmentV1({ prePublish,
    sellerSku: "IMNOVA1", officialSellerSku: "IMNOVA1",
    officialItemId: "366999999999", activeObservationVerified: true,
    stockguardEnrollmentPersisted: true, monitorEnrollmentPersisted: false }),
  /POST_PUBLISH_STOCKGUARD_ATTACH_FAILED_CLOSED/)
})

test("O all contracts are marketplace-write free", () => {
  const prePublish = evaluatePublishWithStockguardContractV1({ sellerSku: "IMNOVA1",
    components: [component()], expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true })
  assert.equal(prePublish.marketplaceWrites, 0)
})

test("materialized server contract revalidates without treating output as raw input", () => {
  const materialized = evaluatePublishWithStockguardContractV1({
    sellerSku: "IMNOVA1", components: [component({ safeCapacity: null })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true,
  })
  const revalidated = revalidateMaterializedPublishWithStockguardContractV1(
    JSON.parse(JSON.stringify(materialized)),
  )
  assert.equal(revalidated.publishAllowed, true)
  assert.equal(revalidated.attachmentIntent.components.length, 1)
})

test("materialized StockGuard contract conflicts still fail closed", () => {
  const materialized = evaluatePublishWithStockguardContractV1({
    sellerSku: "IMNOVA1", components: [component({ safeCapacity: null })],
    expectedComponentCount: 1, economicsReady: true,
    monitorEnrollmentIntentPrepared: true,
  })
  for (const forged of [
    { ...materialized, publishAllowed: false },
    { ...materialized, attachmentIntent: {
      ...materialized.attachmentIntent,
      sellerSku: "",
    } },
    { ...materialized, attachmentIntent: {
      ...materialized.attachmentIntent,
      components: materialized.attachmentIntent.components.map((value) => ({
        ...value, canonicalLunaUrl: "https://competitor.example/product",
      })),
    } },
  ]) assert.throws(
    () => revalidateMaterializedPublishWithStockguardContractV1(forged),
    /PUBLISH_WITH_STOCKGUARD_CONTRACT_REQUIRED/,
  )
})

test("future publish and post-publish monitor use the StockGuard contract", () => {
  const readiness = readFileSync(new URL("./ebay-draft-only-readiness.ts",
    import.meta.url), "utf8")
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts", import.meta.url), "utf8")
  const writer = readFileSync(new URL(
    "./ebay-commercial-improvement-action-service.ts", import.meta.url), "utf8")
  assert.match(readiness, /publishWithStockguardContract/)
  assert.match(route,
    /finalPublicationStockguardContract\(record\(context\.approval\.approved_payload\)\)/)
  assert.match(route, /buildPostPublishStockguardAttachmentV1/)
  assert.match(route, /publishWithStockguardContract,/)
  assert.match(route, /persistedStockguard\.monitorEnrollmentIntentPrepared === true/)
  assert.doesNotMatch(route, /stockguardEnrollmentPersisted: true/)
  assert.match(route, /compensateFinalPublicationAttachmentFailure/)
  assert.match(writer, /compensatePublishedListingAttachmentFailureV1/)
  assert.match(writer,
    /marketplaceOperation: "EndFixedPriceItem"[\s\S]*endingReason: "NotAvailable"/)
  assert.match(writer, /officialReadbackNotCurrentLive: true/)
})
