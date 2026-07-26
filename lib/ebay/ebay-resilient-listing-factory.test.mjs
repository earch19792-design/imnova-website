import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildEffectIdempotencyKey,
  canReplayFromCheckpoint,
  canTransitionFactoryState,
  detectMaterialDrift,
  evaluateCommercialSignal,
  InMemoryCircuitBreaker,
  InMemoryClaimLedger,
  reconcileExternalPublication,
  runResilientBatchDryRun,
  SAFE_FACTORY_POLICY,
  selectPriceComparables,
  selectUniqueBatchCandidates,
  sha256Hex,
  validateDossier,
} from "./ebay-resilient-listing-factory-domain.ts"
const traceability = [
  "identity", "supplier.costUsd", "supplier.stock",
  "economics.recommendedPriceUsd", "listing.categoryId", "listing.title",
  "listing.payloadHash", "visual.main",
].map((field) => ({
  field,
  source: "AUTHORIZED_FIXTURE_FOR_TEST_ONLY",
  observedAt: "2026-07-25T12:00:00.000Z",
  freshness: "FRESH",
  confidence: 95,
  evidenceRef: `fixture:${field}`,
  normalizationVersion: "v1",
  decisionRef: `decision:${field}`,
}))

const validDossier = (index, overrides = {}) => {
  const payloadHash = sha256Hex(`payload-${index}`)
  const dossier = {
    productId: `product-${index}`,
    marketRadarProductId: `radar-${index}`,
    sku: `IMNOVATEST${String(index).padStart(16, "0")}`,
    version: 1,
    identity: {
      exactMatch: true, supplierSku: `LUNA-${index}`, brand: "Acme",
      model: `M-${index}`, variant: "Standard", color: "Blue", size: "One Size",
      condition: "NEW", packCount: 1, identifiers: { mpn: `M-${index}` },
      confidence: 96, verificationMethod: "AUTHORIZED_FIXTURE",
    },
    supplier: {
      sourceKind: "AUTHORIZED_SUPPLIER", source: "LUNA_AUTHORIZED_FIXTURE",
      isFixture: false, costUsd: 10, stock: 20, available: true,
      observedAt: "2026-07-25T12:00:00.000Z", fresh: true,
      weightKnown: true, dimensionsKnown: true, exactPackageKnown: true,
      imageRightsVerified: true,
    },
    market: {
      marketplace: "EBAY_US", evidenceClass: "SOLD_CONFIRMED",
      confirmedSales: 3, activeListings: 2, observedAt: "2026-07-25T12:00:00.000Z",
      fresh: true, comparables: [],
    },
    economics: {
      source: "EBAY_UNIT_ECONOMICS_CANONICAL",
      policyVersion: "CANONICAL_V1", costsComplete: true,
      recommendedPriceUsd: 29.99, landedPriceUsd: 29.99, safeFloorUsd: 24.5,
      netProfitUsd: 7.5, marginPercent: 25, roiPercent: 75,
      passesCanonicalPolicy: true,
    },
    listing: {
      categoryOfficial: true, categoryId: "1234", requiredAspectsComplete: true,
      titleVerified: true, descriptionVerified: true, claimsVerified: true,
      intellectualPropertyAllowed: true, policiesComplete: true,
      merchantLocationResolved: true, quantity: 3, noSkuCollision: true,
      payloadFrozen: true, payloadHash,
    },
    visual: {
      strategy: "VISUAL_STRATEGY_V3", immutableManifest: true,
      exactIdentityPreserved: true, approvedImageCount: 7,
      mainImageApproved: true, secondaryImagesApproved: 6,
      referencesRecorded: true, promptsRecorded: true, hashesRecorded: true,
    },
    runtime: {
      accountBound: true, marketplaceBound: true, credentialsAvailable: true,
      quotasAvailable: true, ledgerPrepared: true, preflightFresh: true,
    },
    traceability,
  }
  return {
    ...dossier,
    ...overrides,
    identity: { ...dossier.identity, ...(overrides.identity ?? {}) },
    supplier: { ...dossier.supplier, ...(overrides.supplier ?? {}) },
    market: { ...dossier.market, ...(overrides.market ?? {}) },
    economics: { ...dossier.economics, ...(overrides.economics ?? {}) },
    listing: { ...dossier.listing, ...(overrides.listing ?? {}) },
    visual: { ...dossier.visual, ...(overrides.visual ?? {}) },
    runtime: { ...dossier.runtime, ...(overrides.runtime ?? {}) },
  }
}

const candidate = (index, extra = {}) => ({
  id: `candidate-${index}`,
  sku: `IMNOVATEST${String(index).padStart(16, "0")}`,
  dossier: validDossier(index),
  ...extra,
})

test("1. five valid products complete independently in one dry-run", async () => {
  const result = await runResilientBatchDryRun({
    candidates: Array.from({ length: 5 }, (_, index) => candidate(index + 1)),
  })
  assert.equal(result.status, "COMPLETED")
  assert.equal(result.completed, 5)
  assert.equal(result.externalWrites, 0)
})

test("2. unknown failure in product three quarantines only that product", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(index + 1))
  candidates[2].fault = {
    atState: "SUPPLY_VERIFIED", code: "UNEXPECTED_SHAPE_X",
    dependency: "UNKNOWN", unexpected: true,
  }
  const result = await runResilientBatchDryRun({ candidates })
  assert.equal(result.quarantined, 1)
  assert.equal(result.completed, 4)
  assert.equal(result.results.filter((row) => row.quarantined)[0].candidateId,
    "candidate-3")
})

test("3. a reserve replaces the quarantined slot without deleting the original", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(index + 1))
  candidates[2].fault = {
    atState: "SUPPLY_VERIFIED", code: "POISON_PRODUCT",
    dependency: "UNKNOWN", unexpected: true,
  }
  const result = await runResilientBatchDryRun({
    candidates, reserves: [candidate(6)],
  })
  assert.equal(result.status, "COMPLETED_WITH_QUARANTINE")
  assert.equal(result.completed, 5)
  assert.equal(result.processed, 6)
  assert.equal(result.replacements, 1)
  assert.ok(result.results.some((row) =>
    row.candidateId === "candidate-3" && row.quarantined))
})

test("4. resume starts after the last completed checkpoint", async () => {
  const result = await runResilientBatchDryRun({
    candidates: [
      candidate(1, { resumeFrom: "ECONOMICS_PASSED" }),
      ...Array.from({ length: 4 }, (_, index) => candidate(index + 2)),
    ],
  })
  const resumed = result.results.find((row) => row.candidateId === "candidate-1")
  assert.equal(resumed.transitions[0].previousState, "ECONOMICS_PASSED")
  assert.equal(resumed.transitions[0].nextState, "CATEGORY_AND_COMPLIANCE_PASSED")
  assert.ok(!resumed.transitions.some((row) => row.nextState === "MARKET_RESEARCH"))
})

test("5. two workers cannot claim the same product", () => {
  const ledger = new InMemoryClaimLedger()
  assert.ok(ledger.claim("candidate-1", "worker-a"))
  assert.equal(ledger.claim("candidate-1", "worker-b"), null)
})

test("6. duplicate cron execution produces one logical effect", () => {
  const key = buildEffectIdempotencyKey({
    marketplaceAccountKey: "account:key", marketplace: "EBAY_US",
    productId: "p1", sku: "IMNOVA0000000000000001", generation: 1,
    action: "CREATE_OFFER", dossierVersion: 1, payloadHash: sha256Hex("payload"),
  })
  const ledger = new InMemoryClaimLedger()
  const token = ledger.claim(key, "cron-a")
  assert.ok(token)
  assert.equal(ledger.claim(key, "cron-b"), null)
  assert.equal(ledger.complete(key, "cron-a", token), true)
  assert.equal(ledger.claim(key, "cron-b"), null)
})

test("7. timeout after eBay receives publication never retries blindly", () => {
  const result = reconcileExternalPublication({
    sent: true, responseTimedOut: true, remoteFound: false,
    expectedSku: "SKU", remoteSku: null,
    expectedPayloadHash: sha256Hex("payload"), remotePayloadHash: null,
    offerId: null, listingId: null,
  })
  assert.deepEqual(result, { status: "UNKNOWN_OUTCOME", blindRetryAllowed: false })
})

test("8. exact read reconciliation finds listing and prevents duplication", () => {
  const hash = sha256Hex("payload")
  assert.deepEqual(reconcileExternalPublication({
    sent: true, responseTimedOut: true, remoteFound: true,
    expectedSku: "SKU", remoteSku: "SKU",
    expectedPayloadHash: hash, remotePayloadHash: hash,
    offerId: "offer-1", listingId: "1234567890",
  }), { status: "RECONCILED", blindRetryAllowed: false })
})

test("9. known pre-send failure allows one controlled retry", () => {
  assert.deepEqual(reconcileExternalPublication({
    sent: false, responseTimedOut: false, remoteFound: false,
    expectedSku: "SKU", remoteSku: null,
    expectedPayloadHash: sha256Hex("payload"), remotePayloadHash: null,
    offerId: null, listingId: null,
  }), { status: "SAFE_TO_RETRY", blindRetryAllowed: true })
})

test("10. stock drift invalidates the checkpoint with STOCK_HOLD", () => {
  const result = detectMaterialDrift({
    previousStock: 5, currentStock: 0, previousCostUsd: 10, currentCostUsd: 10,
    previousImageHash: "a", currentImageHash: "a", economicsStillPass: true,
  })
  assert.equal(result.state, "STOCK_HOLD")
})

test("11. cost drift that breaks economics creates MARGIN_HOLD", () => {
  const result = detectMaterialDrift({
    previousStock: 5, currentStock: 5, previousCostUsd: 10, currentCostUsd: 20,
    previousImageHash: "a", currentImageHash: "a", economicsStillPass: false,
  })
  assert.equal(result.state, "MARGIN_HOLD")
})

test("12. changed reference image requires explicit review", () => {
  const result = detectMaterialDrift({
    previousStock: 5, currentStock: 5, previousCostUsd: 10, currentCostUsd: 10,
    previousImageHash: "a", currentImageHash: "b", economicsStillPass: true,
  })
  assert.equal(result.state, "HOLD_BUSINESS_RULE")
})

test("13. missing official required aspect blocks final QA", () => {
  const gate = validateDossier(validDossier(1, {
    listing: { requiredAspectsComplete: false },
  }))
  assert.ok(gate.blockers.includes("REQUIRED_ASPECTS_INCOMPLETE"))
})

test("14. incompatible pack or variant is excluded from price comparables", () => {
  assert.equal(selectPriceComparables([{
    id: "c1", evidenceClass: "SOLD_CONFIRMED", comparabilityScore: 99,
    itemPriceUsd: 20, mandatoryShippingUsd: 5, marketplace: "EBAY_US",
    conditionMatches: true, packMatches: false, variantMatches: true,
    identityMatches: true,
  }]).length, 0)
})

test("15. ACTIVE_ONLY never permits automatic price reduction or promotion", () => {
  assert.deepEqual(evaluateCommercialSignal({
    evidenceClass: "ACTIVE_ONLY", confirmedSales: 0,
    strongComparables: 5, economicsPassed: true,
  }), {
    decision: "OBSERVE", priceChangeAllowed: false, promotionAllowed: false,
    reason: "ACTIVE_ONLY_WITHOUT_CONFIRMED_SALES",
  })
})

test("16. confirmed sold comparable uses total landed price", () => {
  const [comparable] = selectPriceComparables([{
    id: "c1", evidenceClass: "SOLD_CONFIRMED", comparabilityScore: 91,
    itemPriceUsd: 20, mandatoryShippingUsd: 6.5, marketplace: "EBAY_US",
    conditionMatches: true, packMatches: true, variantMatches: true,
    identityMatches: true,
  }])
  assert.equal(comparable.landedPriceUsd, 26.5)
})

test("17. global eBay auth failure pauses dependency without five quarantines", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(index + 1, {
    fault: {
      atState: "MARKET_RESEARCH", code: "EBAY_AUTH_EXPIRED",
      dependency: "EBAY", httpStatus: 401,
    },
  }))
  const result = await runResilientBatchDryRun({ candidates })
  assert.equal(result.status, "PAUSED_BY_GLOBAL_DEPENDENCY")
  assert.equal(result.quarantined, 0)
})

test("18. circuit breaker opens, probes and recovers", () => {
  const breaker = new InMemoryCircuitBreaker()
  breaker.recordFailure("EBAY", true)
  assert.equal(breaker.status("EBAY"), "OPEN")
  breaker.halfOpen("EBAY")
  assert.equal(breaker.status("EBAY"), "HALF_OPEN")
  breaker.recover("EBAY")
  assert.equal(breaker.status("EBAY"), "CLOSED")
})

test("19. poison product does not block the other four slots", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(index + 1))
  candidates[0].fault = {
    atState: "MARKET_RESEARCH", code: "POISON_UNKNOWN",
    dependency: "UNKNOWN", unexpected: true,
  }
  const result = await runResilientBatchDryRun({ candidates })
  assert.equal(result.completed, 4)
  assert.equal(result.results.filter((row) => row.finalState === "DRAFT_READY").length, 4)
})

test("20. replay requires fresh evidence and never repeats a confirmed effect", () => {
  assert.equal(canReplayFromCheckpoint({
    currentState: "QUARANTINED_UNKNOWN_ERROR", checkpointState: "ECONOMICS_PASSED",
    confirmedPublicationEffect: true, evidenceRevalidated: true,
  }).allowed, false)
  assert.equal(canReplayFromCheckpoint({
    currentState: "QUARANTINED_UNKNOWN_ERROR", checkpointState: "ECONOMICS_PASSED",
    confirmedPublicationEffect: false, evidenceRevalidated: true,
  }).allowed, true)
})

test("21. finalized listings cannot be resurrected", () => {
  assert.equal(canTransitionFactoryState(
    "COMMERCIAL_MONITORING", "MARKET_RESEARCH", "REPLAY_FROM_LAST_CHECKPOINT",
  ), false)
})

test("22. disabled flags produce zero external writes", async () => {
  const result = await runResilientBatchDryRun({
    candidates: Array.from({ length: 5 }, (_, index) => candidate(index + 1)),
    policy: SAFE_FACTORY_POLICY,
  })
  assert.equal(result.externalWrites, 0)
  assert.equal(SAFE_FACTORY_POLICY.externalWritesAllowed, false)
  assert.equal(SAFE_FACTORY_POLICY.killSwitchEngaged, true)
})

test("23. invented or fixture supplier data blocks the listing", () => {
  const gate = validateDossier(validDossier(1, {
    supplier: { sourceKind: "FIXTURE", isFixture: true, stock: 999 },
  }))
  assert.ok(gate.blockers.includes("AUTHORIZED_SUPPLIER_REQUIRED"))
})

test("24. every critical listing field traces to dossier evidence", () => {
  assert.equal(validateDossier(validDossier(1)).draftReady, true)
  const incomplete = validDossier(1)
  incomplete.traceability = incomplete.traceability.filter(
    (entry) => entry.field !== "listing.categoryId",
  )
  assert.ok(validateDossier(incomplete).blockers.includes(
    "CRITICAL_FIELD_TRACEABILITY_INCOMPLETE",
  ))
})

test("25. visual package requires exact V3 identity and seven approvals", () => {
  const gate = validateDossier(validDossier(1, {
    visual: { exactIdentityPreserved: false, approvedImageCount: 6 },
  }))
  assert.ok(gate.blockers.includes("VISUAL_IDENTITY_MISMATCH"))
  assert.ok(gate.blockers.includes("SEVEN_APPROVED_IMAGES_REQUIRED"))
})

test("26. multiple daily batches do not select prior products or SKUs", () => {
  const pool = Array.from({ length: 10 }, (_, index) => ({
    id: `p-${index + 1}`, sku: `sku-${index + 1}`,
  }))
  const first = selectUniqueBatchCandidates(pool)
  const used = new Set(first.flatMap((row) => [row.id, row.sku]))
  const second = selectUniqueBatchCandidates(pool, used)
  assert.equal(first.length, 5)
  assert.equal(second.length, 5)
  assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 10)
})

test("27. batch settles as COMPLETED_WITH_QUARANTINE with recovered slot", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(index + 1))
  candidates[4].fault = {
    atState: "FINAL_QA_PASSED", code: "UNKNOWN_FINAL_QA_SHAPE",
    dependency: "UNKNOWN", unexpected: true,
  }
  const result = await runResilientBatchDryRun({
    candidates, reserves: [candidate(6)],
  })
  assert.equal(result.status, "COMPLETED_WITH_QUARANTINE")
  assert.equal(result.completed, 5)
})

test("28. migration is additive, rerunnable, RLS-safe and removes run serialization", async () => {
  const sql = await readFile(
    "supabase/migrations/20260726070000_create_resilient_ebay_listing_factory_batch5.sql",
    "utf8",
  )
  assert.match(sql, /add column if not exists factory_state/)
  assert.match(sql, /create table if not exists public\.ebay_listing_factory_dossiers/)
  assert.match(sql, /create or replace function public\.claim_ebay_listing_factory_candidate_v1/)
  assert.match(sql, /for update skip locked/i)
  assert.match(sql, /drop index if exists public\.ebay_same_day_pilot_one_lease_per_run_idx/)
  assert.match(sql, /force row level security/i)
  assert.match(sql, /UNKNOWN_OUTCOME/)
  assert.match(sql, /recover_expired_ebay_listing_factory_effects_v1/)
  assert.match(sql, /quarantine_ebay_listing_factory_legacy_dead_letter_v1/)
  assert.match(sql, /EFFECT_LEASE_EXPIRED_AFTER_SENT/)
  assert.match(sql, /external_write_authorized boolean not null default false/)
  assert.match(sql, /factory_status text not null default 'ACTIVE'/)
  assert.match(sql, /factory_target_size integer not null default 5/)
  assert.match(sql, /factory_state = 'DRAFT_READY'/)
  assert.match(sql, /claim_ebay_listing_factory_candidate_by_id_v1/)
  assert.match(sql, /release_ebay_listing_factory_candidate_v1/)
  assert.match(sql, /append_ebay_listing_factory_dossier_v1/)
  assert.match(sql, /claim_ebay_listing_factory_circuit_probe_v1/)
  assert.match(sql, /resolve_ebay_listing_factory_circuit_probe_v1/)
  assert.match(sql, /DEPENDENCY_CIRCUIT_RECOVERED/)
  assert.match(sql,
    /factory_marketplace_account_key,\s*factory_marketplace,\s*reserved_sku/)
  assert.doesNotMatch(sql, /set\s+status\s*=\s*v_status/i)
  const transitionFunction = sql.slice(
    sql.indexOf("create or replace function public.transition_ebay_listing_factory_candidate_v1"),
    sql.indexOf("create or replace function public.quarantine_ebay_listing_factory_candidate_v1"),
  )
  assert.doesNotMatch(transitionFunction, /factory_lease_owner\s*=\s*null/)
  const rollback = await readFile(
    "supabase/rollback/20260726070000_create_resilient_ebay_listing_factory_batch5.down.sql",
    "utf8",
  )
  assert.match(rollback, /ROLLBACK_REQUEUED_CONCURRENT_LEASE/)
  assert.match(rollback, /status in \(\s*'ACTIVE','PARTIALLY_READY','READY_FOR_OPERATOR','COMPLETED','BLOCKED'/)
  assert.match(rollback, /target_new_listings between 0 and 2/)
  assert.match(rollback, /ordinal between 1 and 5/)
  const route = await readFile("app/api/admin/ebay/listing-factory/route.ts", "utf8")
  assert.match(route, /EBAY_RESILIENT_LISTING_FACTORY_ENABLED/)
  assert.match(route, /LISTING_FACTORY_FEATURE_DISABLED/)
  assert.match(route, /CLAIM_DEPENDENCY_CIRCUIT_PROBE/)
  assert.match(route, /RESOLVE_DEPENDENCY_CIRCUIT_PROBE/)
  const sameDayService = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )
  assert.match(sameDayService, /registerResilientBatch5Run/)
  assert.match(sameDayService, /handleResilientLegacyJobFailure/)
  assert.match(sameDayService, /isolatedOutcomeCanContinue/)
  assert.match(sameDayService, /bootstrapCandidates = resilientRegistration\.active/)
  assert.match(sameDayService, /Promise\.allSettled/)
  assert.match(sameDayService, /claimResilientCandidateForLegacyJob/)
  assert.match(sameDayService, /releaseResilientCandidateForLegacyJob/)
  assert.match(sameDayService, /synchronized\.enabled && !synchronized\.active/)
  assert.match(sameDayService, /LISTING_FACTORY_BATCH5_REGISTRATION_REQUIRED/)
})

test("29. the controller keeps one lease through its phases and releases it", async () => {
  const service = await readFile(
    "lib/ebay/ebay-resilient-listing-factory-service.ts",
    "utf8",
  )
  const processClaim = service.slice(
    service.indexOf("private async processClaim"),
    service.indexOf("type ResilientBridgeResult"),
  )
  assert.match(processClaim, /await this\.repository\.heartbeat/)
  assert.match(processClaim, /finally \{\s*await this\.repository\.release/)
  assert.match(service, /claim_ebay_listing_factory_candidate_by_id_v1/)
  assert.match(service, /release_ebay_listing_factory_candidate_v1/)
  assert.match(service, /append_ebay_listing_factory_dossier_v1/)
  assert.match(service, /EBAY_LISTING_FACTORY_DOSSIER_V1/)
  assert.match(service, /INSUFFICIENT_EVIDENCE/)
  assert.match(service, /valuesCopiedIntoService: false/)
})
