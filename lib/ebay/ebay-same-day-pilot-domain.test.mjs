import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  assessSameDayResearchIdentityReadiness,
  buildSameDayLocalPreparationPackage,
  buildSameDayProductResearchQuery,
  canStartNextSameDayCandidateCycle,
  evaluateReadyForContent,
  isValidSameDayLunaConfirmation,
  isSameDayCandidateBatchSettled,
  listingQuantityFromLuna,
  projectSameDayProductResearchReconciliationBudget,
  resolveSameDayCommercialEvidenceMode,
  SAME_DAY_MAX_CANDIDATE_CYCLES,
  selectSameDayQueue,
} from "./ebay-same-day-pilot-domain.ts"

const candidate = (index, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  candidateKey: `candidate-${index}`, productTitle: `Safe Product ${index}`,
  variantTitle: "Default", supplierSku: `SKU-${index}`, supplierVariantId: `variant-${index}`,
  supplierProductUrl: `https://lunaportex.com/products/product-${index}`,
  supplierImageUrl: `https://cdn.example.com/luna-product-${index}.jpg`,
  gtin: null, brand: "Acme", mpn: `MODEL-${index}`, nativePackCount: 1,
  supplierPrice: 4,
  supplierAvailable: true, supplierQuantity: 20, exactIdentityConfirmed: true,
  supplierObservedAt: new Date().toISOString(),
  identityConfidence: 92, activeExactCount: 2, soldExactCount: 1,
  compatibleSellerCount: 3, evidenceFresh: true, economicsReady: true,
  estimatedProfit: 8, roiPercent: 50, netMarginPercent: 25,
  score: 80 - index, queueStatus: "review", ...extra,
})

test("one local pass over 1,513 variants creates at most five Today Queue candidates", () => {
  const selected = selectSameDayQueue(Array.from({ length: 1513 }, (_, index) => candidate(index + 1)))
  assert.equal(selected.length, 5)
  assert.equal(selected.reduce((sum, row) => sum + row.callsEstimated, 0), 0)
})

test("a settled blocked cycle permits exactly one next bounded candidate cycle", () => {
  assert.deepEqual(canStartNextSameDayCandidateCycle({
    runStatus: "BLOCKED",
    cycle: 1,
    candidateMachineStates: Array(5).fill("REJECTED"),
    openHumanTasks: 0,
    dueOrLeasedJobs: 0,
    verifiedNewListings: 0,
    targetNewListings: 2,
    activeWorkerLease: false,
    productResearchPlanSettled: true,
  }), {
    allowed: true,
    nextCycle: 2,
    candidatesTerminal: true,
    reason: "NEXT_BOUNDED_CANDIDATE_SET_ALLOWED",
  })
  for (const blocked of [
    { candidateMachineStates: ["REJECTED", "RECONCILING_IDENTITY"] },
    { openHumanTasks: 1 },
    { dueOrLeasedJobs: 1 },
    { activeWorkerLease: true },
    { productResearchPlanSettled: false },
    { verifiedNewListings: 2 },
    { cycle: SAME_DAY_MAX_CANDIDATE_CYCLES },
    { nextCandidateSetExhausted: true },
  ]) {
    const result = canStartNextSameDayCandidateCycle({
      runStatus: "BLOCKED",
      cycle: 1,
      candidateMachineStates: Array(5).fill("REJECTED"),
      openHumanTasks: 0,
      dueOrLeasedJobs: 0,
      verifiedNewListings: 0,
      targetNewListings: 2,
      activeWorkerLease: false,
      productResearchPlanSettled: true,
      ...blocked,
    })
    assert.equal(result.allowed, false)
  }
})

test("a run is not settled while any candidate still has downstream work", () => {
  assert.equal(isSameDayCandidateBatchSettled([
    "REJECTED", "VERIFIED_ACTIVE", "COMPLETED", "BLOCKED",
  ]), true)
  assert.equal(isSameDayCandidateBatchSettled([
    "REJECTED", "WAITING_PRODUCT_RESEARCH_CAPTURE", "VERIFIED_ACTIVE",
  ]), false)
  assert.equal(isSameDayCandidateBatchSettled([
    "VERIFIED_ACTIVE", "CALCULATING_ECONOMICS",
  ]), false)
  assert.equal(isSameDayCandidateBatchSettled([]), false)
})

test("the next cycle excludes previously attempted identity and family even under a new UUID", () => {
  const [attempted] = selectSameDayQueue([candidate(1, {
    candidateKey: "stable-candidate", supplierVariantId: "stable-variant",
    productTitle: "Stable Family", brand: "Acme", mpn: "M1",
  })])
  const selected = selectSameDayQueue([
    candidate(101, {
      candidateKey: "stable-candidate", supplierVariantId: "replacement-variant-id",
      productTitle: "Stable Family", brand: "Acme", mpn: "M1",
    }),
    candidate(2),
  ], new Date(), {
    candidateKeys: [attempted.candidateKey],
    supplierVariantIds: [attempted.supplierVariantId],
    familyFingerprints: [attempted.familyFingerprint],
  })
  assert.deepEqual(selected.map((row) => row.id), [candidate(2).id])
})

test("family grouping prevents duplicate variants and prepares one exact query", () => {
  const selected = selectSameDayQueue([
    candidate(1, { productTitle: "Widget", brand: "Acme", mpn: "M1" }),
    candidate(2, { productTitle: "Widget", brand: "Acme", mpn: "M1" }),
  ])
  assert.equal(selected.length, 1)
  assert.equal(selected[0].queryPlan.strategy, "BRAND_MPN")
})

test("Product Research queries omit Luna's Default Title placeholder", () => {
  const query = buildSameDayProductResearchQuery(candidate(99, {
    gtin: null,
    brand: null,
    mpn: null,
    productTitle: "9001E e-Series Battery Switch, Selector 4 Position, Red",
    variantTitle: "Default Title",
  }))
  assert.equal(query.query, "9001E e Series Battery Switch Selector 4 Position Red")
  assert.doesNotMatch(query.query, /default|title/i)
})

test("a manufacturer-style title uses the marketplace family alias", () => {
  const query = buildSameDayProductResearchQuery(candidate(100, {
    gtin: null,
    brand: "Reston Lloyd",
    mpn: null,
    model: null,
    productTitle: "Calypso Basics by Reston Lloyd Powder Coated Enameled Colander, 1.5 Quart, White",
    variantTitle: "Default Title",
  }))
  assert.equal(query.strategy, "FAMILY_IDENTITY_RECONCILIATION")
  assert.equal(query.query, "Calypso Basics Colander")
  assert.match(query.reason, /forma corta/i)
  assert.doesNotMatch(query.query, /reston|powder|coated|enameled|1[ .]5|white/i)
})

test("identity prefilter accepts only a valid GTIN or brand plus MPN/model", () => {
  assert.equal(assessSameDayResearchIdentityReadiness(candidate(1, {
    gtin: "036000291452", brand: null, mpn: null,
  })).ready, true)
  assert.equal(buildSameDayProductResearchQuery(candidate(1, {
    gtin: "036000291452", brand: null, mpn: null,
  })).strategy, "GTIN")
  assert.equal(assessSameDayResearchIdentityReadiness(candidate(2, {
    gtin: null, brand: "Acme", mpn: "M-2",
  })).ready, true)
})

test("generic title, invalid GTIN and missing native pack are blocked before Product Research", () => {
  const generic = assessSameDayResearchIdentityReadiness(candidate(1, {
    gtin: null, brand: null, mpn: null,
  }))
  assert.equal(generic.ready, false)
  assert.ok(generic.blockers.includes("IDENTITY_QUERY_TOO_GENERIC"))
  assert.equal(selectSameDayQueue([candidate(1, {
    gtin: null, brand: null, mpn: null,
    supplierProductUrl: null,
  })]).length, 0)

  const invalid = assessSameDayResearchIdentityReadiness(candidate(2, {
    gtin: "036000291453", brand: "Acme", mpn: "M-2",
  }))
  assert.equal(invalid.ready, false)
  assert.ok(invalid.blockers.includes("GTIN_INVALID_OR_UNVERIFIED"))

  const missingPack = assessSameDayResearchIdentityReadiness(candidate(3, {
    nativePackCount: null,
  }))
  assert.equal(missingPack.ready, false)
  assert.ok(missingPack.blockers.includes("OFFER_PACK_IDENTITY_MISSING"))
})

test("one Luna gate can verify a specific visible identity and native pack before Product Research", () => {
  const [selected] = selectSameDayQueue([candidate(7, {
    productTitle: "If You Care Paper Snack and Sandwich Bags",
    gtin: null, brand: null, mpn: null, model: null, nativePackCount: null,
    exactIdentityConfirmed: false, identityConfidence: 0,
    queueItemAvailable: true,
  })])
  assert.ok(selected)
  assert.equal(selected.eligibleForQueue, true)
  assert.equal(selected.state, "NEEDS_LUNA_CONFIRMATION")
  assert.equal(selected.lunaIdentityConfirmationRequired, true)
  assert.ok(selected.blockers.includes("LUNA_VISIBLE_IDENTITY_AND_PACK_CONFIRMATION_REQUIRED"))
  assert.equal(selected.queryPlan.strategy, "FAMILY_IDENTITY_RECONCILIATION")
})

test("a visible Luna candidate without a durable queue anchor cannot enter same-day", () => {
  assert.equal(selectSameDayQueue([candidate(8, {
    gtin: null, brand: null, mpn: null, nativePackCount: null,
    queueItemAvailable: false,
  })]).length, 0)
})

test("same-day source never invents a one-unit Luna pack when the pack is unknown", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  assert.doesNotMatch(service,
    /officialDescriptionIdentity\.packCount\)\s*\?\?\s*1/)
  assert.doesNotMatch(service,
    /extractLunaOfficialDescriptionIdentity\([\s\S]{0,160}nativePackCount:\s*1/)
  assert.doesNotMatch(service,
    /relatedPackResults\[0\]\?\.candidatePackCount\)\s*\?\?\s*1/)
})

test("same-day runtime preserves Luna confirmation and executes the safe related-pack discount preflight", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  assert.match(service, /evaluatePackDiscountScenarios\(\{/)
  assert.match(service, /discountScenarioStatus:/)
  assert.match(service, /approvedBaselinePricePerNativePresentationUsd: null/)
  assert.match(service, /automaticPricingUsed: false/)
  assert.match(service,
    /economics_summary: \{ \.\.\.record\(candidate\.economics_summary\), \.\.\.economics,/)
})

test("the five completed batches cover all 84 rows with a bounded shared-read budget", () => {
  assert.deepEqual(projectSameDayProductResearchReconciliationBudget([7, 2, 29, 9, 37]), {
    batchCount: 5,
    totalObservations: 84,
    observationsCovered: 84,
    allRowsCovered: true,
    decisionReferences: 38,
    maximumOfficialReaderInvocations: { trading: 10, browse: 5, catalog: 5,
      taxonomy: 5, total: 25, unit: "READER_INVOCATIONS_NOT_HTTP_REQUESTS" },
  })
})

test("broad-only or stale evidence cannot advance and requests one authorized capture", () => {
  const [selected] = selectSameDayQueue([candidate(1, { activeExactCount: 0, soldExactCount: 0, compatibleSellerCount: 0, evidenceFresh: false })])
  assert.equal(selected.state, "NEEDS_PRODUCT_RESEARCH_CAPTURE")
  assert.ok(selected.blockers.includes("FRESH_EXACT_MARKET_EVIDENCE_REQUIRED"))
  assert.equal(selected.callsEstimated, 1)
})

test("historical sales and exact identity are separate commercial decisions", () => {
  const validated = resolveSameDayCommercialEvidenceMode({
    historicalMarketCheckCompleted: true,
    confirmedSoldExact: 4,
    identityVerifiedIndependently: true,
    exactOfferPackVerified: true,
  })
  assert.equal(validated.mode, "MARKET_VALIDATED")
  assert.equal(validated.automaticPricingAllowed, false)

  const controlled = resolveSameDayCommercialEvidenceMode({
    historicalMarketCheckCompleted: true,
    confirmedSoldExact: 0,
    identityVerifiedIndependently: true,
    exactOfferPackVerified: true,
  })
  assert.equal(controlled.eligible, true)
  assert.equal(controlled.mode, "CONTROLLED_EXPLORATORY_TEST")
  assert.equal(controlled.forcedListingQuantity, 1)
  assert.equal(controlled.commercialMonitorRequired, true)
})

test("zero exact sales never bypasses identity, pack or related-presentation conflicts", () => {
  for (const unsafe of [
    { identityVerifiedIndependently: false },
    { exactOfferPackVerified: false },
    { relatedPackConflict: true },
    { relatedSizeConflict: true },
  ]) {
    const result = resolveSameDayCommercialEvidenceMode({
      historicalMarketCheckCompleted: true,
      confirmedSoldExact: 0,
      identityVerifiedIndependently: true,
      exactOfferPackVerified: true,
      ...unsafe,
    })
    assert.equal(result.eligible, false)
    assert.equal(result.mode, null)
  }
})

test("today-resolvable identity and shipping gaps stay in the queue without being called ready", () => {
  const [selected] = selectSameDayQueue([candidate(1, {
    exactIdentityConfirmed: false,
    identityConfidence: 83,
    activeExactCount: 2,
    hardGates: ["NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH", "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"],
  })])
  assert.ok(selected)
  assert.equal(selected.eligibleForQueue, true)
  assert.equal(selected.state, "NEEDS_PRODUCT_RESEARCH_CAPTURE")
  assert.ok(selected.blockers.includes("EXACT_OR_STRONG_IDENTITY_REQUIRED"))
})

test("local preparation packages are useful during 429 but explicitly non-publishable", () => {
  const [selected] = selectSameDayQueue([candidate(1, {
    activeExactCount: 0, evidenceFresh: false, economicsReady: false,
  })])
  const prepared = buildSameDayLocalPreparationPackage(selected, "2026-07-17T12:00:00.000Z")
  assert.equal(prepared.status, "BLOCKED_PENDING_VERIFIED_GATES")
  assert.equal(prepared.safety.openAiUsed, false)
  assert.equal(prepared.safety.ebayWriteUsed, false)
  assert.equal(prepared.safety.publishable, false)
  assert.equal(prepared.product.supplierProductUrl, "https://lunaportex.com/products/product-1")
  assert.equal("supplierImageUrl" in prepared.product, false)
  assert.doesNotMatch(JSON.stringify(prepared), /imageUrl|base64|blob|screenshot/i)
  assert.equal(prepared.offer.targetPrice, null)
  assert.ok(prepared.intentionallyOmitted.includes("FINAL_TITLE"))
  assert.equal("exactProductName" in prepared.product, false)
})

test("profit, ROI and margin gates are all enforced", () => {
  const result = evaluateReadyForContent({ exactOrStrongIdentity: true, exactMarketEvidence: true,
    productFactsCompatible: true, requiredAspectsResolved: true, regulatoryAcceptable: true,
    shippingEstimateAvailable: true, estimatedProfit: 4.99, roiPercent: 29, netMarginPercent: 19 })
  assert.equal(result.ready, false)
  assert.deepEqual(result.blockers, ["PROFIT_BELOW_5_USD", "ROI_BELOW_30_PERCENT", "NET_MARGIN_BELOW_20_PERCENT"])
})

test("a controlled test can reach content only after every normal gate passes", () => {
  const ready = evaluateReadyForContent({ exactOrStrongIdentity: true,
    commercialEvidenceMode: "CONTROLLED_EXPLORATORY_TEST",
    historicalMarketCheckCompleted: true,
    productFactsCompatible: true, requiredAspectsResolved: true,
    regulatoryAcceptable: true, shippingEstimateAvailable: true,
    estimatedProfit: 7, roiPercent: 35, netMarginPercent: 24 })
  assert.equal(ready.ready, true)
  assert.equal(ready.forcedListingQuantity, 1)
  assert.equal(ready.commercialMonitorRequired, true)

  const unsafe = evaluateReadyForContent({ exactOrStrongIdentity: true,
    commercialEvidenceMode: "CONTROLLED_EXPLORATORY_TEST",
    historicalMarketCheckCompleted: true,
    productFactsCompatible: true, requiredAspectsResolved: false,
    regulatoryAcceptable: true, shippingEstimateAvailable: true,
    estimatedProfit: 7, roiPercent: 35, netMarginPercent: 24 })
  assert.equal(unsafe.ready, false)
  assert.ok(unsafe.blockers.includes("REQUIRED_ASPECTS_NOT_READY"))
})

test("unknown Luna quantity safely produces listing quantity one and a sale recheck", () => {
  assert.deepEqual(listingQuantityFromLuna(null, true), { quantity: 1, recheckAfterSale: true })
  assert.deepEqual(listingQuantityFromLuna(0, false), { quantity: 0, recheckAfterSale: false })
  assert.throws(() => listingQuantityFromLuna(0, true), /LUNA_AVAILABILITY_QUANTITY_CONFLICT/)
  assert.throws(() => listingQuantityFromLuna(3, false), /LUNA_AVAILABILITY_QUANTITY_CONFLICT/)
})

test("an out-of-stock confirmation does not require a price and advances safely", () => {
  assert.equal(isValidSameDayLunaConfirmation({
    price: null,
    available: false,
    quantity: 0,
  }), true)
  assert.equal(isValidSameDayLunaConfirmation({
    price: null,
    available: true,
    quantity: 1,
  }), false)
  assert.equal(isValidSameDayLunaConfirmation({
    price: 4,
    available: true,
    quantity: 0,
  }), false)
})

test("out-of-stock rejection appends one replacement and never blocks promotion", async () => {
  const [service, route, panel, repairMigration] = await Promise.all([
    readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8"),
    readFile("app/api/admin/ebay/same-day-pilot/route.ts", "utf8"),
    readFile("app/admin/today-launch-panel.tsx", "utf8"),
    readFile("supabase/migrations/20260721020000_preserve_same_day_product_research_plan_scope.sql", "utf8"),
  ])
  assert.match(service, /mode: "OUT_OF_STOCK_REPLACEMENT"/)
  assert.match(service, /finally \{[\s\S]*await promoteNextCandidate/)
  assert.match(service, /SAME_RUN_OUT_OF_STOCK_CANDIDATE_REPLACED/)
  assert.match(service, /activateCandidateProductResearchPlan/)
  assert.match(service, /replacementProductResearchPlanIds/)
  assert.match(service, /skipProductResearchQuery/)
  assert.match(service, /supersedeExisting: !immediateOutOfStockReplacement/)
  assert.match(service, /create_product_research_query_plan_v2/)
  assert.match(repairMigration, /PRODUCT_RESEARCH_PLAN_SCOPE_REPAIRED/)
  assert.match(repairMigration, /currentCandidatePreserved/)
  assert.match(route, /isValidSameDayLunaConfirmation/)
  assert.match(panel, /DESCARTAR Y ANALIZAR REEMPLAZO/)
  assert.match(panel, /No se exige costo/)
})

test("an inconsistent automatic Luna snapshot becomes one confirmation task instead of crashing the batch", () => {
  for (const inconsistent of [
    { supplierAvailable: true, supplierQuantity: 0 },
    { supplierAvailable: false, supplierQuantity: 3 },
  ]) {
    const [selected] = selectSameDayQueue([candidate(71, inconsistent)])
    assert.ok(selected)
    assert.equal(selected.state, "NEEDS_LUNA_CONFIRMATION")
    assert.ok(selected.blockers.includes("LUNA_AVAILABILITY_QUANTITY_CONFLICT"))
    const prepared = buildSameDayLocalPreparationPackage(
      selected,
      "2026-07-19T10:00:00.000Z",
    )
    assert.equal(prepared.offer.listingQuantity, 1)
    assert.equal(prepared.offer.recheckAfterSale, true)
    assert.equal(prepared.safety.publishable, false)
  }

  const [unknownAvailability] = selectSameDayQueue([candidate(72, {
    supplierAvailable: null,
    supplierQuantity: 8,
  })])
  assert.ok(unknownAvailability)
  assert.equal(unknownAvailability.state, "NEEDS_LUNA_CONFIRMATION")
  assert.doesNotThrow(() => buildSameDayLocalPreparationPackage(
    unknownAvailability,
    "2026-07-19T10:00:00.000Z",
  ))
})

test("runtime preserves the controlled-test lane without relaxing canonical Top 20", async () => {
  const [service, facts, home, queue] = await Promise.all([
    readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8"),
    readFile("lib/ebay/ebay-product-facts-enrichment.ts", "utf8"),
    readFile("app/admin/today-launch-panel.tsx", "utf8"),
    readFile("lib/ebay/ebay-listing-ai-approval-queue.ts", "utf8"),
  ])
  assert.match(service, /exactIdentityResults/)
  assert.match(service, /exactSoldObservationIds/)
  assert.match(service, /CONTROLLED_EXPLORATORY_TEST/)
  assert.match(service, /COMPLETED_NO_EXACT_SOLD/)
  assert.match(service, /listingQuantity: input\.available \? 1 : null/)
  assert.match(service, /recheckAfterSale: input\.available/)
  assert.match(service, /confirmedQuantity: input\.quantity/)
  assert.match(service, /commercialMonitorRequired: true/)
  assert.match(service, /automaticPricingAllowed: false/)
  assert.match(facts, /controlledExploratoryTarget/)
  assert.match(facts, /candidateIds\?\.length === 1/)
  assert.match(facts, /PRODUCT_FACT_CONTROLLED_EXPLORATORY_TARGET_INVALID/)
  assert.match(facts, /Fresh supply is enforced later by the/)
  assert.doesNotMatch(facts,
    /lunaConfirmationAgeMs <= 24 \* 60 \* 60_000/)
  assert.match(facts, /luna_match_status", "EXACT_LUNA_MATCH"/)
  assert.match(home, /PRUEBA COMERCIAL CONTROLADA/)
  assert.match(home, /APROBAR PRUEBA CONTROLADA · CANTIDAD 1/)
  assert.match(queue, /EXACT_COMPARABLES_REQUIRED/)
})

test("automation is durable, one-click, auto-resuming and has no eBay-write path", async () => {
  const [migration, hardening, stateHardening, leasePreflight, claimSerialization, atomicGates, candidateCycles, schedulerEndpointPin, enrichment, service, home, liveMonitor, capture, cron, workflow, route, handoff] = await Promise.all([
    readFile("supabase/migrations/20260718030000_create_same_day_pilot_orchestrator.sql", "utf8"),
    readFile("supabase/migrations/20260718040000_harden_same_day_pilot_local_continuation.sql", "utf8"),
    readFile("supabase/migrations/20260718043000_harden_same_day_pilot_state_machine.sql", "utf8"),
    readFile("supabase/migrations/20260718043500_preflight_same_day_pilot_job_leases.sql", "utf8"),
    readFile("supabase/migrations/20260718044000_serialize_same_day_pilot_job_claims.sql", "utf8"),
    readFile("supabase/migrations/20260718047000_atomically_complete_same_day_human_gates.sql", "utf8"),
    readFile("supabase/migrations/20260718052000_allow_bounded_same_day_candidate_cycles.sql", "utf8"),
    readFile("supabase/migrations/20260725001000_pin_same_day_scheduler_to_staging_alias.sql", "utf8"),
    readFile("lib/ebay/ebay-product-facts-enrichment.ts", "utf8"),
    readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8"),
    readFile("app/admin/today-launch-panel.tsx", "utf8"),
    readFile("lib/ebay/ebay-same-day-live-monitor.ts", "utf8"),
    readFile("app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8"),
    readFile("app/api/cron/ebay-same-day-pilot/route.ts", "utf8"),
    readFile(".github/workflows/ebay-same-day-pilot-preview.yml", "utf8"),
    readFile("app/api/admin/ebay/same-day-pilot/route.ts", "utf8"),
    readFile("lib/ebay/ebay-same-day-manual-handoff.ts", "utf8"),
  ])
  for (const table of ["ebay_same_day_pilot_transitions", "ebay_same_day_pilot_jobs", "ebay_same_day_pilot_human_tasks"]) assert.match(migration, new RegExp(table))
  for (const state of ["RUN_CREATED", "WAITING_PRODUCT_RESEARCH_CAPTURE", "CALCULATING_ECONOMICS", "READY_FOR_MANUAL_PUBLICATION", "VERIFYING_PUBLISHED_LISTING", "VERIFIED_ACTIVE"]) assert.match(migration, new RegExp(state))
  assert.match(home, /INICIAR LANZAMIENTO DE HOY/)
  assert.equal((home.match(/action: "start"/g) ?? []).length, 1)
  assert.match(home, /ANALIZAR SIGUIENTES 5 CANDIDATOS/)
  assert.match(home, /REANUDAR 5 CANDIDATOS PREPARADOS/)
  assert.match(home, /no duplica consultas ni requiere repetir capturas/)
  assert.match(home, /No reinicia Discovery ni consulta eBay para las 1,513 variantes/)
  assert.match(home, /aria-describedby=/)
  assert.match(home, /aria-live="polite"/)
  assert.match(home, /Ciclo de revisión/)
  assert.doesNotMatch(home, /BUSCAR CANDIDATOS SEGUROS DE NUEVO|RESET_ALL|REINICIAR/)
  assert.match(service, /promoteNextCandidate/)
  assert.match(service, /promoteNextCandidateAfterPreparedPackage/)
  assert.match(service, /target_new_listings/)
  assert.match(service, /claim_same_day_pilot_cycle_v1/)
  assert.match(service, /CANDIDATE_INSERT_RETRYABLE/)
  assert.match(service, /preparedPlanPreserved/)
  assert.match(service, /candidateInsertFailureCount/)
  assert.match(service, /excludeCandidateKeys/)
  assert.match(service, /excludeSupplierVariantIds/)
  assert.match(service, /excludeFamilyFingerprints/)
  assert.match(service, /NEXT_CANDIDATE_SET_EXHAUSTED/)
  assert.match(service, /cumulativeVerifiedProgress/)
  assert.match(service, /data: datedRun/)
  assert.match(service, /data: carryoverRuns/)
  assert.match(service, /\.in\("status", \[[\s\S]{0,160}"COMPLETED"/)
  assert.match(service, /SAME_DAY_PILOT_CARRYOVER_CANDIDATE_READ_FAILED/)
  assert.match(service, /isSameDayCandidateBatchSettled/)
  assert.match(service, /\.order\("cycle", \{ ascending: false \}\)\.limit\(10\)/)
  assert.match(service, /candidateRun\.status !== "BLOCKED"/)
  assert.match(service, /verified < target/)
  assert.match(service, /nextCandidateSetExhausted !== true/)
  assert.match(service, /SAME_DAY_PILOT_CARRYOVER_RUN_READ_FAILED/)
  assert.match(service, /\.in\("state", \["READY_FOR_MANUAL_PUBLICATION", "PUBLISHED_PENDING_VERIFICATION", "VERIFIED_ACTIVE"\]\)/)
  assert.match(service, /MANUAL_SELLER_HUB_HANDOFF_READY[\s\S]{0,700}promoteNextCandidateAfterPreparedPackage/)
  assert.match(service, /jobEffectAlreadyApplied[\s\S]{0,700}FINALIZE_MANUAL_HANDOFF[\s\S]{0,300}promoteNextCandidateAfterPreparedPackage/)
  assert.match(service, /market_radar_latest_variants/)
  assert.match(service, /product_url,featured_image_url/)
  assert.match(service, /SAME_DAY_PILOT_LUNA_ANCHOR_READ_FAILED/)
  assert.match(service, /\.eq\("source_key", "lunaportex"\)/)
  assert.match(service, /\.eq\("product_id", opportunity\.market_radar_product_id\)/)
  assert.match(service, /SAME_DAY_PILOT_LUNA_HANDOFF_IDENTITY_MISMATCH/)
  assert.match(service, /local_preparation_package:[\s\S]*supplierProductUrl:[\s\S]*supplierImageUrl:/)
  assert.match(service, /supplierImageUrl: safeHttpsUrl\(anchor\.featured_image_url\)/)
  assert.match(service, /LUNA_CONFIRMED_AUTO_RESUME/)
  assert.match(home, /ABRIR PRODUCTO EXACTO EN LUNA/)
  assert.match(home, /sh\/research#seller-os-query=/)
  assert.doesNotMatch(home, /sh\/research\?[^"`]*keywords=/)
  assert.match(home, /function ProductResearchQueueTask/)
  assert.match(home, /productResearchTasks = openTasks\.filter/)
  assert.match(home, /guidance\?\.nextQuery\?\.searchQuery/)
  assert.match(home, /Captura la próxima consulta de Product Research/)
  assert.match(home, /vuelve a Seller OS para verificar el siguiente producto/)
  assert.match(home, /Captura únicamente cuando habilite/)
  assert.match(home, /fallbackQuery=\{productResearchTasks\[0\]\?\.action_schema\?\.query\}/)
  assert.match(home, /const nextQuery = guidedTask \? guidedQuery : durableTaskQuery/)
  assert.match(home, /Productos del lote actual/)
  assert.match(home, /deferredDecisionCount = productResearchTasks\.length > 0 \? decisionTasks\.length/)
  assert.match(home, /Próxima decisión protegida/)
  assert.doesNotMatch(home, /remainingTasks\.map/)
  assert.match(route, /getProductResearchQueryPlanStatus/)
  assert.match(route, /preferredSearchQuery: preferredProductResearchQuery/)
  assert.match(route, /productResearchGuidance = plan \? \{/)
  assert.match(route, /searchQuery: plan\.nextQuery\.searchQuery/)
  assert.doesNotMatch(route, /queryHash:|tasks: plan\.tasks|id: plan\.id/)
  assert.match(home, /quota_snapshot\?\.lanes/)
  assert.match(home, /pausedQuotaLanes/)
  assert.match(home, /evaluateEbayQuotaRetryState/)
  assert.match(home, /evaluateEbayQuotaLaneState/)
  assert.doesNotMatch(home, /pausedJobs = \(pilot\?\.jobs \?\? \[\]\)\.filter/)
  assert.match(service, /projectEffectiveEbayQuotaLane\(lane, now\)/)
  assert.match(service, /commercial_decision_summary/)
  assert.match(service, /activeMarketMedian/)
  assert.match(service, /minimumSafePrice/)
  assert.match(service, /confirmedSoldExact/)
  assert.doesNotMatch(service, /commercial_decision_summary:[\s\S]{0,900}competitor/i)
  assert.match(service, /authorizeSameDayControlledRiskOverride/)
  assert.match(service, /CONTROLLED_RISK_OVERRIDE_AUTHORIZED/)
  assert.match(service, /promotionAllowed: false/)
  assert.match(service, /manualPublicationOnly: false/)
  assert.match(service, /finalHumanAuthorizationRequired: true/)
  assert.match(service, /sellerOsPublicationAfterAuthorization: true/)
  assert.match(service, /unattendedPublicationAllowed: false/)
  assert.match(route, /body\.action === "controlled_risk_override"/)
  assert.match(route, /ebayWrites: 0/)
  assert.match(home, /Piso propio 10%/)
  assert.match(home, /Máximo competitivo/)
  assert.match(handoff, /PROMOTION_MUST_REMAIN_DISABLED/)
  assert.match(service, /expiredQuotaPauses = await releaseExpiredEbayQuotaPauses/)
  assert.match(home, /deriveSameDayLiveMonitor/)
  assert.match(home, /liveMonitor\.businessLabel/)
  assert.match(liveMonitor, /openTasks\.length > 0\) status = "WAITING_OPERATOR"/)
  assert.match(liveMonitor, /input\.quotaPaused === true[\s\S]*status = "PAUSED_EBAY"/)
  assert.match(liveMonitor, /status === "WORKING"/)
  assert.match(liveMonitor, /status === "QUEUED"/)
  assert.match(home, /misma referencia visual durante todo el recorrido/)
  assert.match(home, /IMAGEN LUNA NO DISPONIBLE/)
  assert.match(home, /cantidad 1 y revalidación después de la venta/)
  assert.match(service, /WAITING_RETRY/)
  assert.match(service, /RECONCILE_PRODUCT_RESEARCH_CAPTURE/)
  assert.match(service, /result\.classification === "EXACT_LUNA_MATCH"/)
  assert.match(service, /result\.supplierVariantId === supplierVariantId/)
  assert.match(service, /exactSoldMarketReference\(reconciledExactRows\)/)
  assert.match(service, /exactSoldMarketReferenceSource: "FINAL_IDENTITY_RECONCILIATION"/)
  assert.match(service, /WAIT_FOR_LOOP1_REANALYSIS/)
  assert.match(service, /ENRICH_PRODUCT_FACTS/)
  assert.match(service, /recordPersistentEbayRateLimit/)
  assert.doesNotMatch(service, /\? 3600/)
  assert.match(service, /NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE/)
  const captureResume = service.match(
    /export async function resumeSameDayPilotAfterProductResearchCapture[\s\S]*?\n}\n\nfunction retryable/,
  )?.[0] ?? ""
  assert.doesNotMatch(captureResume, /NO_EXACT_LUNA_MATCH_IN_AUTHORIZED_CAPTURE/)
  assert.doesNotMatch(captureResume,
    /if \([^)]*exact[^)]*<= 0\)[\s\S]*?nextState: "REJECTED"/i)
  assert.match(captureResume, /authorizedObservationCount/)
  assert.match(captureResume, /nextState: "RECONCILING_IDENTITY"/)
  assert.match(captureResume, /job: \{ jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE"/)
  assert.match(capture, /resumeSameDayPilotAfterProductResearchCapture/)
  assert.match(capture, /\.limit\(10\)/)
  assert.doesNotMatch(capture, /reconcileProductResearchObservations\(\{\s*supabase: auth\.supabase, accountKey: auth\.accountKey,\s*\}\)/)
  assert.match(cron, /processSameDayPilotJobChain/)
  assert.match(cron, /EBAY_SAME_DAY_PILOT_PREVIEW_WORKER_ENABLED/)
  assert.match(service, /export async function processSameDayPilotJobChain/)
  assert.match(service, /Math\.min\(30, Math\.trunc\(input\.maximumJobs/)
  assert.match(service, /\["COMPLETED", "EFFECT_ALREADY_APPLIED"\]/)
  assert.match(service, /schedulerFallback: true/)
  assert.match(service, /recursiveHttp: false/)
  assert.match(route, /after\(async \(\) =>/)
  assert.match(route, /SCHEDULED_IMMEDIATE/)
  assert.match(route, /maximumDurationMs: 240_000/)
  assert.match(capture, /scheduleSameDayPilotContinuation/)
  assert.match(capture, /after\(async \(\) =>/)
  assert.match(capture, /processSameDayPilotJobChain/)
  assert.match(hardening, /claim_same_day_pilot_job/)
  assert.match(hardening, /for update skip locked/)
  assert.match(hardening, /requeue_expired_same_day_pilot_jobs/)
  assert.match(stateHardening, /advance_same_day_pilot_candidate/)
  assert.match(stateHardening, /v_current_state not in \(p_expected_previous_state, p_next_state\)/)
  assert.match(stateHardening, /transition_row\.idempotency_key = p_transition_idempotency_key/)
  assert.match(stateHardening, /blocker\.status in \('LEASED', 'DEAD_LETTER'\)/)
  assert.match(stateHardening, /p_job_type is not null/)
  assert.match(stateHardening, /lease_token = gen_random_uuid\(\)/)
  assert.match(stateHardening, /lease_expires_at = p_now \+ interval '6 minutes'/)
  assert.match(stateHardening, /heartbeat_same_day_pilot_job/)
  assert.match(stateHardening, /settle_same_day_pilot_job/)
  assert.match(stateHardening, /lease_owner = p_worker_id/)
  assert.match(stateHardening, /lease_token = p_lease_token/)
  assert.match(leasePreflight, /row_number\(\) over/)
  assert.match(leasePreflight, /partition by job\.run_id/)
  assert.match(leasePreflight, /lease_expires_at desc nulls last/)
  assert.match(leasePreflight, /status = 'WAITING_RETRY'/)
  assert.match(leasePreflight, /lease_owner = null/)
  assert.match(leasePreflight, /lease_token = null/)
  assert.match(leasePreflight, /lease_expires_at = null/)
  assert.match(leasePreflight, /_leasePreflightRecovery/)
  assert.match(leasePreflight, /having count\(\*\) > 1/)
  assert.match(leasePreflight, /SAME_DAY_PILOT_DUPLICATE_LEASE_PREFLIGHT_FAILED/)
  assert.doesNotMatch(leasePreflight, /delete\s+from|truncate|drop\s+(table|column)/i)
  assert.match(claimSerialization, /pg_advisory_xact_lock/)
  assert.match(claimSerialization, /ebay_same_day_pilot_one_lease_per_run_idx/)
  assert.match(claimSerialization, /where status = 'LEASED'/)
  assert.match(claimSerialization, /acquire_same_day_pilot_run_lease/)
  assert.match(claimSerialization, /release_same_day_pilot_run_lease/)
  assert.match(claimSerialization, /worker_lease_token/)
  assert.match(claimSerialization, /ensure_same_day_pilot_human_task/)
  assert.match(claimSerialization, /gate_generation/)
  assert.match(claimSerialization, /ebay_same_day_pilot_one_open_task_per_candidate_idx/)
  assert.match(claimSerialization, /ebay_same_day_pilot_handoffs/)
  assert.match(claimSerialization, /SAME_DAY_PILOT_HANDOFF_APPEND_ONLY/)
  assert.match(claimSerialization, /openai_calls integer not null default 0 check \(openai_calls = 0\)/)
  assert.match(atomicGates, /complete_and_advance_same_day_pilot_gate_v1/)
  assert.match(atomicGates, /p_candidate_patch/)
  assert.match(atomicGates, /p_job_idempotency_key/)
  assert.match(service, /hash\(\{ taskId: input\.taskId,/)
  assert.match(service,
    /`\$\{input\.job\.idempotencyKey\}:GATE:\$\{input\.taskId\}`/)
  assert.match(atomicGates, /status = 'COMPLETED'/)
  assert.match(atomicGates, /SAME_DAY_PILOT_GATE_PATCH_KEY_BLOCKED/)
  assert.match(candidateCycles, /cycle integer not null default 1/)
  assert.match(candidateCycles, /unique \(marketplace_account_key, operation_date, cycle\)/)
  assert.match(candidateCycles, /pg_advisory_xact_lock/)
  assert.match(candidateCycles, /SAME_DAY_PILOT_PREVIOUS_CYCLE_NOT_SETTLED/)
  assert.match(candidateCycles, /SAME_DAY_PILOT_PREVIOUS_RESEARCH_PLAN_PENDING/)
  assert.match(candidateCycles, /worker_lease_expires_at/)
  assert.doesNotMatch(candidateCycles, /delete\s+from|truncate|drop\s+(table|column)/i)
  assert.match(service, /completeAndAdvanceHumanGate/)
  assert.doesNotMatch(service, /completeHumanTask/)
  assert.match(service, /advance_same_day_pilot_candidate/)
  assert.match(service, /acquirePilotRunLease/)
  assert.match(service, /status: "RUN_BUSY"/)
  assert.match(service, /finally \{[\s\S]*releasePilotRunLease/)
  assert.match(service, /SAME_DAY_PILOT_STALE_TRANSITION/)
  assert.match(service, /preserveAttempt: rateLimited/)
  assert.match(service, /productResearchPlannedQueryHash/)
  assert.match(service, /capturedQueryHash = productResearchPlannedQueryHash\(input\.searchQuery\)/)
  assert.doesNotMatch(service, /normalizedQuery = input\.searchQuery\.trim\(\)\.toLowerCase\(\)/)
  assert.match(service, /promoteImmediateSuccessorDuringQuotaPause/)
  assert.equal((service.match(/await promoteImmediateSuccessorDuringQuotaPause\(/g) ?? []).length, 3)
  const quotaSuccessor = service.match(/async function promoteImmediateSuccessorDuringQuotaPause[\s\S]*?\n}\n\nasync function promoteNextCandidateAfterPreparedPackage/)?.[0] ?? ""
  assert.match(quotaSuccessor, /\.gt\("ordinal", ordinal\)\.order\("ordinal"\)\.limit\(1\)/)
  assert.match(quotaSuccessor, /data\.machine_state !== "RUN_CREATED"/)
  assert.doesNotMatch(quotaSuccessor, /\.eq\("machine_state", "RUN_CREATED"\)/)
  const reconciliationJobSpecs = service.match(/jobType: "RECONCILE_PRODUCT_RESEARCH_CAPTURE"[\s\S]{0,500}?ownerLane: "P1_EXACT_VERIFICATION"/g) ?? []
  assert.equal(reconciliationJobSpecs.length, 4)
  for (const spec of reconciliationJobSpecs) {
    assert.match(spec, /apiFamily: "BROWSE"/)
    assert.match(spec, /apiOperation: "EXACT_VERIFICATION"/)
  }
  assert.match(service, /recoverDeadLetterCandidates/)
  const legacyRepair = service.match(
    /async function repairLegacyPrematureProductResearchRejections[\s\S]*?\n}\n\n\/\*\*/,
  )?.[0] ?? ""
  assert.match(legacyRepair, /blockers\.length === 1/)
  assert.match(legacyRepair, /blockers\[0\] === LEGACY_PREMATURE_NO_EXACT_REASON/)
  assert.match(legacyRepair, /\.eq\("status", "COMPLETED"\)/)
  assert.match(legacyRepair, /\.eq\("status", "PROCESSED"\)/)
  assert.match(legacyRepair, /text\(entry\.capture_batch_id\) === captureBatchId/)
  assert.match(legacyRepair, /productResearchPlannedQueryHash\(entry\.search_query\) === queryHash/)
  assert.match(legacyRepair, /text\(queueItem\.supplier_variant_id\) !== supplierVariantId/)
  assert.match(legacyRepair, /previousState: "REJECTED", nextState: "RECONCILING_IDENTITY"/)
  assert.match(legacyRepair, /PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION/)
  assert.match(service, /legacyPrematureRejectionsRepaired/)
  const legacyFactsRepair = service.match(
    /async function repairLegacyProductFactsRejections[\s\S]*?\n}\n\nasync function repairSameDayPilotBootstrap/,
  )?.[0] ?? ""
  assert.match(legacyFactsRepair, /blockers\.length === 1/)
  assert.match(legacyFactsRepair, /LEGACY_PRODUCT_FACTS_REJECTION_REASONS\.has\(blockers\[0\]\)/)
  assert.match(legacyFactsRepair, /state\.tasks\.some\(\(task\) => task\.status === "OPEN"\)/)
  assert.match(legacyFactsRepair, /\.find\(/)
  assert.doesNotMatch(legacyFactsRepair, /startSameDayPilot|previewSameDayPilot/)
  assert.match(legacyFactsRepair, /fullCatalogRescan: false/)
  assert.match(legacyFactsRepair, /previousState: "REJECTED"/)
  assert.match(legacyFactsRepair, /nextState: "ENRICHING_PRODUCT_FACTS"/)
  assert.match(legacyFactsRepair, /PRODUCT_FACTS_ENGINE_VERSION/)
  assert.match(legacyFactsRepair, /createLunaGate\(supabase, state\.run\.id, record\(candidate\), "REJECTED"\)/)
  assert.match(service, /legacyProductFactsRejectionsRepaired/)
  const reconciliationWorker = service.match(
    /if \(leased\.job_type === "RECONCILE_PRODUCT_RESEARCH_CAPTURE"\)[\s\S]*?} else if \(leased\.job_type === "WAIT_FOR_LOOP1_REANALYSIS"\)/,
  )?.[0] ?? ""
  assert.match(reconciliationWorker, /\.eq\("capture_batch_id", batchId\)/)
  assert.match(reconciliationWorker, /\.eq\("evidence_reviewed", true\)/)
  assert.doesNotMatch(reconciliationWorker, /\.eq\("matched_supplier_variant_id"/)
  assert.match(reconciliationWorker,
    /\.limit\(SAME_DAY_RECONCILIATION_DECISION_REFERENCE_LIMIT\)/)
  assert.match(reconciliationWorker,
    /\.limit\(SAME_DAY_RECONCILIATION_COVERAGE_ROW_LIMIT\)/)
  assert.match(reconciliationWorker, /targetSupplierVariantIds: plannedTargetVariantIds/)
  assert.match(reconciliationWorker, /plannedTargetVariantIds\.includes\(supplierVariantId\)/)
  assert.match(reconciliationWorker,
    /tradingObservationIds: decisionObservationIds\.slice\([\s\S]*SAME_DAY_TRADING_DETAIL_READ_LIMIT_PER_BATCH/)
  assert.match(reconciliationWorker, /decisionObservationIdSet\.has\(observationId\)/)
  assert.match(reconciliationWorker, /officialCallBudget: reconciled\.officialCallBudget/)
  assert.match(reconciliationWorker, /eventsProcessed: reconciled\.observationsProcessed/)
  assert.match(service, /jobEffectAlreadyApplied/)
  assert.match(service, /EFFECT_ALREADY_APPLIED/)
  assert.match(service, /productFactsState === "VALIDATING_TAXONOMY"/)
  assert.match(service, /productFactsState === "VALIDATING_REGULATION"/)
  assert.match(service, /productFactsState === "BUILDING_OPENAI_INPUT"/)
  assert.match(service, /CURRENT_PRODUCT_FACT_RUN_INCOMPLETE/)
  assert.match(service, /currentRunBound: true/)
  assert.match(service, /evidenceBinding\.factRunId !== factRun\.runId/)
  assert.match(service, /evidenceBinding\.observationLinks < 1/)
  assert.match(service, /evidenceBinding\.resolutionLinks < 1/)
  assert.match(service, /selectApplicableSafeListingDefaults\(input\.supabase, \{ categoryId, conditionId: conditionContract\.conditionId \}\)/)
  assert.match(service, /SAME_DAY_PILOT_SAFE_DEFAULT_CONDITION_MISMATCH/)
  assert.doesNotMatch(service, /getProductFactsStatus/)
  assert.match(service, /repairSameDayPilotBootstrap/)
  assert.match(service, /restoreDeferredLegacyVisualMarketRecoveryQueryTasks/)
  assert.match(service, /isDeferredLegacyVisualMarketRecovery/)
  assert.match(
    service,
    /function isDeferredLegacyVisualMarketRecovery[\s\S]{0,180}WAITING_PRODUCT_RESEARCH_CAPTURE/,
  )
  assert.match(service, /markProductResearchQueryCaptured\(\{/)
  assert.match(service, /capturedAt,/)
  assert.match(service, /DEFERRED_VISUAL_QUERY_TASK_RESTORED/)
  assert.match(service, /SAME_DAY_IMAGE_CONTROL_NOT_CLAIMED/)
  assert.doesNotMatch(
    service,
    /IMAGE_POST_AI_DETERMINISTIC_HANDOFF_V1_2026_07_24/,
  )
  assert.match(service, /deterministicCloneRecoveryRetired: true/)
  assert.match(service, /IMAGE_SOURCE_OR_QUALITY_CORRECTION_REQUIRED/)
  assert.match(service, /function repairRejectedMarketVisualFallback/)
  assert.match(service, /PROFESSIONAL_MARKET_VISUAL_FALLBACK_ACTIVATED/)
  assert.match(service, /LUNA_PORTEX_AUTHORIZED_PRODUCT_IMAGE/)
  assert.match(service, /professionalFallbackPromptRequired: true/)
  assert.match(service, /competitorEvidenceUsed: false/)
  assert.match(service, /SAME_DAY_PILOT_MARKET_FALLBACK_TASK_DEFER_FAILED/)
  assert.match(service, /deferredLaterTaskIds: laterTaskIds/)
  assert.match(
    service,
    /record\(leased\.checkpoint\)\.forceDeterministicImageFallback === true/,
  )
  assert.match(service, /additionalOpenAiSpendRequired: false/)
  assert.match(service, /historyDeleted: false/)
  assert.match(service, /activateNextDeferredVisualMarketRecovery/)
  assert.match(service, /DEFERRED_VISUAL_CAPTURE_GATE_RECOVERED/)
  assert.match(service, /SAME_DAY_PILOT_DEFERRED_VISUAL_QUERY_RESET_FAILED/)
  assert.match(service, /SAME_DAY_PILOT_DEFERRED_VISUAL_BINDING_REPAIR_FAILED/)
  assert.match(service, /freshProcessedCapture/)
  assert.match(service, /controlledExploratoryFactsCanContinue/)
  assert.match(service, /recoverableBlockedRunIds/)
  assert.match(service,
    /SAME_DAY_PILOT_BLOCKED_RECOVERY_CANDIDATE_READ_FAILED/)
  assert.match(service, /lunaSupplyFreshnessAdvisory/)
  assert.match(service, /repairStaleControlledLunaConfirmationRejection/)
  assert.match(service,
    /STALE_LUNA_ANALYSIS_ADVISORY_RECOVERY_V1_2026_07_24/)
  assert.match(service, /STALE_LUNA_SUPPLY_DOES_NOT_BLOCK_ANALYSIS/)
  assert.match(service, /STALE_LUNA_ANALYSIS_CONTINUED/)
  assert.match(service, /repairStaleSupplyOpenAiInputRejection/)
  assert.match(service,
    /STALE_SUPPLY_OPENAI_INPUT_RECOVERY_V1_2026_07_25/)
  assert.match(service,
    /STALE_SUPPLY_DOES_NOT_EXPIRE_TECHNICAL_FACTS/)
  assert.match(service, /STALE_SUPPLY_TECHNICAL_FACTS_CONTINUED/)
  assert.match(service,
    /state: "READY_FOR_CONTENT",[\s\S]{0,500}lunaSupplyFreshness/)
  assert.match(service, /blocksAnalysis: false/)
  assert.match(service, /blocksPublication: stale/)
  assert.match(enrichment, /durableDecisionBindingReady/)
  assert.match(enrichment,
    /Volatile Luna supply can be stale[\s\S]{0,240}publication and[\s\S]{0,80}purchase/)
  assert.match(home, /Alerta de frescura Luna/)
  assert.match(home, /No bloquea el análisis actual/)
  assert.match(service,
    /PRODUCT_FACT_CONTROLLED_EXPLORATORY_TARGET_INVALID/)
  assert.match(service,
    /\.in\("status", \["DEAD_LETTER", "COMPLETED"\]\)/)
  assert.match(service, /EFFECT_ALREADY_APPLIED_RECOVERED/)
  assert.match(service, /repairProcessedProductResearchCaptureGate/)
  assert.match(service, /\.eq\("status", "PROCESSED"\)/)
  assert.match(service, /\.not\("capture_batch_id", "is", null\)/)
  assert.match(service, /resumeSameDayPilotAfterProductResearchCapture\(\{/)
  assert.match(service, /if \(result\.resumed > 0\) return true/)
  assert.match(capture, /SAME_DAY_PILOT_CAPTURE_RESUME_DEFERRED/)
  assert.match(capture, /The evidence and its query task are already durable/)
  assert.match(capture, /if \(sameDayPilot\.deferred\)[\s\S]*CAPTURE_SAVED_SAME_DAY_RESUME_DEFERRED[\s\S]*else if \(result\.reanalysisRequired\)/)
  assert.match(service, /WAITING_PRODUCT_APPROVAL: "PRODUCT_APPROVAL_REQUIRED"/)
  const bootstrapRepair = service.match(/async function repairSameDayPilotBootstrap[\s\S]*?\n}\n\nasync function createLunaGate/)?.[0] ?? ""
  const durableCaptureRepair = bootstrapRepair.indexOf("repairProcessedProductResearchCaptureGate")
  const openTaskGuard = bootstrapRepair.indexOf('activeState.tasks.some((task) => task.status === "OPEN" &&')
  assert.ok(durableCaptureRepair >= 0 && durableCaptureRepair < openTaskGuard)
  assert.match(bootstrapRepair, /serializeOpenHumanTasksForRun\(supabase, state\.run\.id\)/)
  assert.match(bootstrapRepair, /task\.gate_type !== "CRITICAL_EXCEPTION_REQUIRED"/)
  assert.match(bootstrapRepair, /SAME_DAY_PILOT_QUEUE_PROJECTION_REPAIR_FAILED/)
  assert.match(bootstrapRepair, /queue_count: Math\.min\(5, activeState\.candidates\.length\)/)
  assert.match(bootstrapRepair, /activeState\.candidates\.find/)
  assert.match(bootstrapRepair, /bootstrapStates\.includes\(machineState\)/)
  assert.match(bootstrapRepair, /task\.candidate_id === candidate\.id/)
  assert.match(service, /ensure_same_day_pilot_human_task/)
  assert.doesNotMatch(service, /SAME_DAY_PILOT_HUMAN_TASK_PERSIST_FAILED[\s\S]{0,300}ignoreDuplicates: true/)
  assert.match(service, /FAMILY_CAPTURE_REUSED_AUTOMATICALLY/)
  assert.match(service, /familyEnriched/)
  assert.match(service, /BUILD_MANUAL_SELLER_HUB_HANDOFF/)
  assert.match(service, /FINALIZE_MANUAL_HANDOFF/)
  assert.match(service, /automaticPricingUsed: false/)
  assert.match(service, /SAME_DAY_PILOT_COMPLIANT_FULFILLMENT_BASIS_REQUIRED/)
  assert.match(service, /fulfillmentBasisConfirmedAt/)
  const productDecisionStart = service.indexOf("export async function decideSameDayProduct")
  assert.ok(service.indexOf('input.decision === "REJECT"', productDecisionStart) <
    service.indexOf("normalizeEbayCompliantFulfillmentBasis", productDecisionStart))
  assert.doesNotMatch(service, /salePrice: opportunity\.median_total_buyer_price/)
  assert.match(route, /body\.action === "product_decision"/)
  assert.match(route, /evaluateEbayProductApprovalFulfillmentBasis/)
  assert.match(route, /body\.action === "image_decision"/)
  assert.match(route, /autoResumed: true/)
  assert.match(home, /APROBAR PRODUCTO/)
  assert.match(home, /Inventario propio disponible/)
  assert.match(home, /Acuerdo vigente con proveedor mayorista autorizado/)
  assert.match(home, /APROBAR IMÁGENES/)
  assert.match(home, /REVISAR, AUTORIZAR Y PUBLICAR EN SELLER OS/)
  assert.match(home, /intent=publish#seller-os-final-publication/)
  assert.match(home, /Custom Label \/ SKU/)
  assert.match(home, /businessPolicies\.fulfillmentPolicyId/)
  assert.match(home, /shippingText/)
  assert.match(home, /URLs autorizadas en orden/)
  assert.match(handoff, /factsOnly: true/)
  assert.match(handoff, /competitorContentUsed: false/)
  assert.match(handoff, /openAiCalls: 0/)
  assert.match(handoff, /ebayWrites: 0/)
  assert.match(liveMonitor, /PUBLICADO Y VERIFICADO/)
  assert.match(workflow, /EBAY_SAME_DAY_PILOT_PREVIEW_WORKER_ENABLED/)
  assert.match(workflow, /EBAY_SAME_DAY_PILOT_CRON_SECRET/)
  assert.match(workflow, /x-ebay-same-day-authorization/)
  assert.match(workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/)
  assert.match(workflow,
    /if \[ "\$EVENT_NAME" = "workflow_dispatch" \]; then/)
  assert.match(workflow, /endpoint="\$endpoint\?mode=validate"/)
  assert.doesNotMatch(workflow, /workflow_dispatch:\s*\n\s+inputs:/)
  assert.match(cron, /x-ebay-same-day-authorization/)
  assert.match(cron, /providedHeaders\.some/)
  assert.match(cron, /timingSafeEqual/)
  assert.match(cron, /alternateAuthorizationHeaderPresent/)
  assert.match(cron, /sameDaySecretConfigured/)
  assert.match(cron, /validationSecretConfigured/)
  assert.match(cron, /authorizedBySchedulerVault/)
  assert.match(cron,
    /verify_same_day_pilot_staging_worker_authorization/)
  assert.match(cron, /createHash\("sha256"\)/)
  assert.match(cron, /secretsReturned: false/)
  assert.match(schedulerEndpointPin,
    /https:\/\/imnova-ebay-mobile-preprod\.vercel\.app/)
  assert.match(schedulerEndpointPin,
    /verify_same_day_pilot_staging_worker_authorization/)
  assert.match(schedulerEndpointPin,
    /grant execute[\s\S]*to service_role/)
  assert.match(schedulerEndpointPin,
    /revoke all[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /ebay_writes integer not null default 0 check \(ebay_writes = 0\)/)
  assert.match(migration, /production_changed boolean not null default false check \(not production_changed\)/)
  assert.doesNotMatch(service, /createOffer|publishOffer|bulkCreateOffer/)
})

test("batch5 bootstrap is feature-gated and preserves the single-candidate fallback", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  assert.match(service, /const resilientRegistration = await registerResilientBatch5Run/)
  assert.match(service, /const bootstrapCandidates = resilientRegistration\.active/)
  assert.match(service, /: candidates\?\.slice\(0, 1\) \?\? \[\]/)
  assert.match(service, /Promise\.allSettled\(/)
  assert.match(service, /quarantineResilientBootstrapFailure/)
  assert.match(service, /LISTING_FACTORY_BATCH5_REGISTRATION_REQUIRED/)
  assert.doesNotMatch(service, /for \(const candidate of candidates \?\? \[\]\) await bootstrapCandidate/)
})

test("primary human gates stay serialized while fact corrections coexist and quota promotion is evidence-bound", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  const serializer = service.match(/async function serializeOpenHumanTasksForRun[\s\S]*?\n}\n\nasync function createHumanTask/)?.[0] ?? ""
  assert.match(serializer, /\.eq\("run_id", runId\)/)
  assert.match(serializer, /\.eq\("status", "OPEN"\)/)
  assert.match(serializer, /\.order\("created_at", \{ ascending: true \}\)/)
  assert.match(serializer, /primaryTasks\.slice\(1\)/)
  assert.match(serializer, /correctionTasks/)
  assert.match(serializer, /seenCorrectionCandidates/)
  assert.match(serializer, /status: "SUPERSEDED"/)
  assert.match(serializer, /\.eq\("run_id", runId\)\.eq\("status", "OPEN"\)\.in\("id", duplicateIds\)/)

  const createTask = service.match(/async function createHumanTask[\s\S]*?\n}\n\nasync function completeAndAdvanceHumanGate/)?.[0] ?? ""
  assert.equal((createTask.match(/serializeOpenHumanTasksForRun\(input\.supabase, input\.runId\)/g) ?? []).length, 2)
  assert.match(createTask, /correctionTask = input\.gateType === "CRITICAL_EXCEPTION_REQUIRED"/)
  assert.match(createTask, /before\.primaryOpenTask/)
  assert.match(createTask, /after\.openTasks\.some/)

  const normalPromotion = service.match(/async function promoteNextCandidate[\s\S]*?\n}\n\nasync function promoteImmediateSuccessorDuringQuotaPause/)?.[0] ?? ""
  assert.match(normalPromotion, /serializeOpenHumanTasksForRun\(supabase, runId\)/)
  assert.match(normalPromotion, /if \(serialized\.primaryOpenTask\) return false/)
  assert.match(normalPromotion, /\.in\("machine_state", \["RUN_CREATED", "WAITING_PRODUCT_RESEARCH_CAPTURE"\]\)/)
  assert.match(normalPromotion, /\.order\("ordinal"\)\.limit\(SAME_DAY_QUEUE_LIMIT\)/)
  assert.match(normalPromotion, /for \(const candidate of candidates\)/)
  assert.match(normalPromotion, /evaluateEbayPublishedAcquisitionPolicy/)
  assert.match(normalPromotion, /await bootstrapCandidate\(supabase, runId, candidate\)/)
  assert.doesNotMatch(normalPromotion, /\.eq\("machine_state", "RUN_CREATED"\)/)
  for (const terminalState of ["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"]) {
    assert.doesNotMatch(normalPromotion, new RegExp(`machine_state[^\\n]{0,80}${terminalState}`))
  }

  const quotaPromotion = service.match(/async function promoteImmediateSuccessorDuringQuotaPause[\s\S]*?\n}\n\nasync function promoteNextCandidateAfterPreparedPackage/)?.[0] ?? ""
  assert.match(quotaPromotion, /if \(serialized\.primaryOpenTask\) return false/)
  assert.match(quotaPromotion, /\.eq\("status", "WAITING_RETRY"\)/)
  assert.match(quotaPromotion, /429\|QUOTA_PAUSED/)
  assert.match(quotaPromotion, /data\.machine_state !== "RUN_CREATED"/)
})

test("blocking eBay aspects become provenance-bound exceptions one at a time", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  const route = await readFile("app/api/admin/ebay/same-day-pilot/route.ts", "utf8")
  const home = await readFile("app/admin/today-launch-panel.tsx", "utf8")
  const enrichment = await readFile("lib/ebay/ebay-product-facts-enrichment.ts", "utf8")
  assert.match(service, /recoverableSingleFactException/)
  assert.doesNotMatch(service, /missing\.length > \d+/)
  assert.doesNotMatch(service, /attemptedFields\.size < \d+/)
  assert.match(service, /\["MISSING_BLOCKING", "CONFLICTED_BLOCKING"\]/)
  assert.match(service, /"CONFLICTED_BLOCKING", "OFFER_PACK_FACTS_REQUIRED"/)
  assert.match(service, /selectionOnly: selected\.requirement\.selectionOnly === true/)
  assert.match(service, /allowedValuesComplete: selected\.requirement\.allowedValuesComplete === true/)
  assert.match(service, /schema\.selectionOnly === true && schema\.allowedValuesComplete === true/)
  assert.match(service, /"item length": \{ factKey: "itemLength"/)
  assert.match(service, /"item width": \{ factKey: "itemWidth"/)
  assert.match(service, /type: \{ factKey: "type"/)
  assert.match(service, /style: \{ factKey: "style"/)
  assert.match(service, /if \(singleFactException\)/)
  assert.match(service, /CRITICAL_EXCEPTION_REQUIRED/)
  assert.match(service, /SINGLE_OFFICIAL_LABEL_FACT_EXCEPTION_OPENED/)
  assert.match(service, /source_type: "OFFICIAL_LABEL"/)
  assert.match(service, /source_authority: "MANUFACTURER_OR_LABEL"/)
  assert.match(service, /brandAbsentConfirmed \? "Unbranded"/)
  assert.match(service, /OPERATOR_CONFIRMED_NO_BRAND_VISIBLE/)
  assert.match(service, /nextState: "ENRICHING_PRODUCT_FACTS"/)
  assert.match(service, /fullCatalogRescan: false/)
  assert.match(route, /body\.action === "fact_exception_decision"/)
  assert.match(route, /BLOCKED\|CONFLICT/)
  assert.match(route, /body\.brandAbsentConfirmed === true/)
  assert.match(route, /scheduleImmediateContinuation/)
  assert.match(home, /Sólo falta un dato verificable/)
  assert.match(home, /El producto no muestra marca/)
  assert.match(home, /Usar el valor estándar “Unbranded”/)
  assert.match(home, /task\.action_schema\?\.allowedValues/)
  assert.match(home, /factEvidence\.explicitTitlePackCount/)
  assert.match(home, /offerPackValueConflict/)
  assert.match(home, /El título exacto muestra/)
  assert.match(home, /submissionError/)
  assert.match(service, /explicitTitlePackCount: "explicitTitlePackCount" in exception/)
  assert.match(home, /no uses dimensiones estimadas de envío/)
  assert.match(home, /CONFIRMAR DATO Y CONTINUAR AUTOMÁTICAMENTE/)
  assert.match(home, /NO PUEDO VERIFICARLO · PROBAR SIGUIENTE/)
  assert.match(enrichment, /operatorConfirmedOfficialLabelFacts/)
  assert.match(enrichment, /\.eq\("source_type", "OFFICIAL_LABEL"\)/)
  assert.match(enrichment, /\.eq\("verification_status", "VERIFIED"\)/)
})

test("premature Taxonomy rejections reopen without losing valid approvals", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  assert.match(service, /PREMATURE_TAXONOMY_REJECTION_RECOVERY_V1_2026_07_21/)
  assert.match(service, /async function repairPrematureTaxonomyRejections/)
  assert.match(service, /blocker\.startsWith\("ASPECT_VALUE_NOT_ALLOWED_"\)/)
  assert.match(service, /!blockers\.includes\("LUNA_OUT_OF_STOCK"\)/)
  assert.match(service, /!blockers\.includes\("PRODUCT_REJECTED_BY_OPERATOR"\)/)
  assert.match(service, /productResearchRepeated: false/)
  assert.match(service, /priorApprovalPreserved/)
  assert.match(service, /function reusableOperatorProductApproval/)
  assert.match(service, /VALID_OPERATOR_APPROVAL_PRESERVED_AFTER_TAXONOMY_RECOVERY/)
  assert.match(service, /function resumeReusableOperatorProductApprovalGate/)
  assert.match(service, /DURABLE_PRODUCT_APPROVAL_REUSED_SUPPLY_ALERT_NON_BLOCKING/)
  assert.match(service, /supplyRecheckRequiredAt: supplyAdvisory\.nextRequiredAt/)
  assert.match(service, /Confirma el precio actualizado del producto/)
  assert.match(service, /approvalReviewReason: priorPriceApprovalChanged/)
  assert.match(service, /staleSupplyRecheckAt: "FINAL_PUBLICATION_OR_PURCHASE_GATE"/)
  assert.match(service, /if \(task\) \{[\s\S]{0,100}completeAndAdvanceHumanGate/)
  assert.match(service, /\} else \{[\s\S]{0,100}await transition\(\{/)
  assert.match(service, /const approvalRecorded = Number\.isFinite\(approvedAt\)/)
  assert.doesNotMatch(
    service,
    /function reusableOperatorProductApproval[\s\S]{0,900}approvalFresh/,
  )
  assert.match(service, /approvalRepeated: false/)
  assert.match(service, /await repairPrematureTaxonomyRejections\(input\.supabase, state, now\)/)
})

test("official manufacturer facts run before manual fallback and stale decisions recover selectively", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  const enrichment = await readFile("lib/ebay/ebay-product-facts-enrichment.ts", "utf8")
  const official = await readFile("lib/ebay/ebay-official-manufacturer-facts.ts", "utf8")
  assert.match(enrichment, /fetchOfficialManufacturerFacts/)
  assert.match(enrichment, /manufacturerOfficialObservations/)
  assert.match(enrichment, /sourceType: "MANUFACTURER_OFFICIAL_PUBLIC"/)
  assert.doesNotMatch(enrichment, /manufacturerOfficial: 0/)
  assert.match(official, /redirect: "manual"/)
  assert.match(official, /credentials: "omit"/)
  assert.match(official, /rawHtmlStored: false/)
  assert.match(official, /sourceUrlStored: false/)
  assert.match(service, /repairStaleDecisionProductFactsRejection/)
  assert.match(service, /confirmListingAiQueueLunaObservation/)
  assert.match(service, /SAME_DAY_LUNA_DECISION_REFRESH_VERSION/)
  assert.match(service, /STALE_COMMERCIAL_DECISION_REFRESHED/)
  assert.match(service, /fullCatalogRescan: false, productResearchRepeated: false/)
  assert.match(service, /persistConfirmedOfferPackQueueBinding/)
  assert.match(service, /TOP10_CANONICAL_FACT_RECOVERY_NOT_READY/)
  assert.match(service, /cancelSupersededProductFactsDeadLetters/)
  assert.match(service, /reconcileEnqueuedAuthorityLineageRecoveryDeadLetters/)
  assert.match(service, /SUPERSEDED_BY_PRODUCT_FACT_AUTHORITY_LINEAGE_RECOVERY/)
  assert.match(service, /historyDeleted: false/)
  assert.match(service, /const canonicalRecoveryReady = priorFacts\.currentRunBound === true/)
  assert.match(service, /"EBAY_ASPECTS_READY", "REGULATORY_READY"/)
  assert.match(service, /!text\(queueItem\.decision_package_id\) && !canonicalRecoveryReady/)
  assert.match(service, /Repair at most one durable lane per worker cycle/)
})

test("Product Facts has a sub-five-minute source budget and manual last-resort lanes", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  const enrichment = await readFile("lib/ebay/ebay-product-facts-enrichment.ts", "utf8")
  const home = await readFile("app/admin/today-launch-panel.tsx", "utf8")
  assert.match(enrichment,
    /PRODUCT_FACTS_AUTOMATIC_SEARCH_BUDGET_MS = 4 \* 60 \* 1_000/)
  assert.match(enrichment, /budgetedAutomaticRead/)
  assert.match(enrichment, /PRODUCT_FACTS_AUTOMATIC_SEARCH_BUDGET_EXCEEDED/)
  assert.match(enrichment,
    /const nativePresentationUnitCount = intendedPackCount \?\? integer/)
  assert.match(enrichment, /\.eq\("quality_status", "VALID"\)/)
  assert.match(service, /operatorConfirmableOfficialLabelFact/)
  assert.match(service, /CONFIRM_OFFICIAL_EBAY_CATEGORY/)
  assert.match(service, /recoverableRegulatoryFactException/)
  assert.match(service, /conservativeShippingReserveReady/)
  assert.match(service, /SAME_DAY_PILOT_OFFER_PACK_VISIBLE_COUNT_CONFLICT/)
  assert.match(service, /"identityAndPackConfirmed", "nativePackCount"/)
  assert.match(home, /una compra no significa necesariamente una unidad/)
  assert.match(home, /selector oficial de eBay/)
})

test("safe OpenAI error recovery preserves the failed attempt and allows only one final retry", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721223000_resume_image_after_safe_openai_error_capture.sql",
    "utf8",
  )
  assert.match(migration,
    /resume_same_day_image_after_safe_openai_error_capture_v1/)
  assert.match(migration, /last_error_code <> 'EBAY_IMAGE_OPENAI_HTTP_400'/)
  assert.match(migration, /provider_request_id is not null/)
  assert.match(migration, /asset_ids is not null/)
  assert.match(migration, /set status = 'FAILED_RETRYABLE',\s+openai_calls = 0/)
  assert.match(migration, /previousFailureEventPreserved', true/)
  assert.match(migration, /finalControlledAttempt', 2/)
  assert.match(migration, /status = 'CANCELLED'/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("reconciled OpenAI failure normalization is exact, no-output, and history preserving", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721224000_normalize_reconciled_image_job_for_safe_retry.sql",
    "utf8",
  )
  assert.match(migration, /normalize_reconciled_image_job_for_safe_retry_v1/)
  assert.match(migration, /v_job\.status <> 'COMPLETED'/)
  assert.match(migration, /EFFECT_ALREADY_APPLIED_RECOVERED/)
  assert.match(migration, /v_control\.last_error_code <> 'EBAY_IMAGE_OPENAI_HTTP_400'/)
  assert.match(migration, /v_control\.provider_request_id is not null/)
  assert.match(migration, /set status = 'DEAD_LETTER'/)
  assert.match(migration, /historyPreserved', true/)
  assert.match(migration, /'externalCalls', 0/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("safe OpenAI retry ignores another candidate pending human review without mutating it", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721225000_resume_image_with_parallel_review_lane.sql",
    "utf8",
  )
  assert.match(migration,
    /resume_same_day_image_after_safe_openai_error_capture_v2/)
  assert.match(migration,
    /from public\.ebay_same_day_pilot_image_package_runs control[\s\S]*where control\.run_id = v_run\.id[\s\S]*and control\.candidate_id = p_candidate_id[\s\S]*and control\.id <> p_expected_control_id/)
  assert.match(migration, /p_expected_control_id/)
  assert.match(migration, /status = 'FAILED_RETRYABLE'/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("billing-restored image recovery creates a new handoff and preserves failed controls", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721226000_resume_image_after_openai_billing_restored.sql",
    "utf8",
  )
  assert.match(migration,
    /resume_same_day_image_after_openai_billing_restored_v1/)
  assert.match(migration, /BILLING_HARD_LIMIT_REACHED/)
  assert.match(migration, /v_control\.attempt <> 2/)
  assert.match(migration, /v_control\.provider_request_id is not null/)
  assert.match(migration,
    /insert into public\.ebay_same_day_pilot_handoffs/)
  assert.match(migration, /imageGenerationRecovery/)
  assert.match(migration, /billingRestoredConfirmedByUser', true/)
  assert.match(migration, /previousControlPreserved', true/)
  assert.match(migration, /'externalCalls', 0/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs|delete\s+from|truncate/i)
})

test("Visual Strategy V3 image evidence stays strict and preserves legacy contracts", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721227000_accept_visual_strategy_v3_scene_board.sql",
    "utf8",
  )
  assert.match(migration, /assert_same_day_pilot_image_set_safe/)
  assert.match(migration, /EBAY_OPENAI_BACKGROUND_PLATE_V1/)
  assert.match(migration, /EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2/)
  assert.match(migration, /EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3/)
  assert.match(migration,
    /EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21/)
  assert.match(migration,
    /EBAY_VISUAL_STRATEGY_COMPILER_V2_2026_07_21/)
  assert.match(migration, /v_safe_v3_count = 5/)
  assert.match(migration, /structuralDiversityVerified/)
  assert.match(migration, /deterministicBackgroundSelection/)
  assert.match(migration, /humanApprovalRequired/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("publish-bound image packages require high-quality OpenAI evidence", async () => {
  const [migration, runtime, imageRoute] = await Promise.all([
    readFile(
      "supabase/migrations/20260721229000_require_high_quality_publish_visuals.sql",
      "utf8",
    ),
    readFile("lib/ebay/ebay-same-day-image-package-runtime.ts", "utf8"),
    readFile("app/api/admin/ebay/images/route.ts", "utf8"),
  ])
  assert.match(migration, /backgroundPlateQuality' = 'high'/)
  assert.match(migration, /v_safe_v3_count = 5/)
  assert.match(migration, /humanApprovalRequired/)
  assert.match(migration, /assert_ebay_publish_image_set_high_quality/)
  assert.match(migration, /EBAY_PUBLICATION_HIGH_QUALITY_IMAGES_REQUIRED/)
  assert.match(migration,
    /claim_ebay_authorized_listing_publication[\s\S]*perform public\.assert_ebay_publish_image_set_high_quality/)
  assert.match(migration,
    /alter column requested_quality set default 'high'/)
  assert.match(migration,
    /plate_version = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'[\s\S]*requested_quality = 'high'[\s\S]*requested_size = '1536x1024'/)
  assert.match(runtime, /PUBLISH_OPENAI_IMAGE_QUALITY = "high"/)
  assert.match(runtime,
    /backgroundPlateQuality !== PUBLISH_OPENAI_IMAGE_QUALITY/)
  assert.match(runtime,
    /quality: PUBLISH_OPENAI_IMAGE_QUALITY/)
  assert.match(imageRoute,
    /buildSafeOpenAiBackgroundPlatePlan\([\s\S]*approved\.factoryInput,[\s\S]*aiRuntime\.model,[\s\S]*"high"/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("V3 evidence-validator recovery creates a new handoff and preserves the rejected control", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721228000_resume_image_after_v3_evidence_validator.sql",
    "utf8",
  )
  assert.match(migration,
    /resume_same_day_image_after_v3_evidence_validator_v1/)
  assert.match(migration, /SAME_DAY_IMAGE_SET_EVIDENCE_INVALID/)
  assert.match(migration, /v_control\.attempt <> 1/)
  assert.match(migration, /v_control\.openai_calls <> 1/)
  assert.match(migration,
    /insert into public\.ebay_same_day_pilot_handoffs/)
  assert.match(migration, /imageEvidenceRecovery/)
  assert.match(migration,
    /VISUAL_STRATEGY_V3_DB_VALIDATOR_V1_2026_07_21/)
  assert.match(migration, /previousControlPreserved', true/)
  assert.match(migration, /'externalCalls', 0/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs|delete\s+from|truncate/i)
})

test("white products admit only the strict framed authorized main evidence contract", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721230000_accept_safe_framed_main_visual_evidence.sql",
    "utf8",
  )
  assert.match(migration, /MAIN_WHITE_BACKGROUND_CANONICAL_V3/)
  assert.match(migration, /PRESERVED_FRAMED_SOURCE/)
  assert.match(migration, /FRAMED_AUTHORIZED_SOURCE/)
  assert.match(migration, /JPEG_Q93_444_MOZJPEG_V3/)
  assert.match(migration,
    /AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL/)
  assert.match(migration, /FRAMED_MAIN_BACKGROUND_HUMAN_ACCEPTANCE/)
  assert.match(migration, /foregroundEdgeCoverage/)
  assert.match(migration, /deterministicBackgroundSelection' = 'false'/)
  assert.match(migration,
    /resume_same_day_image_after_framed_main_validator_v1/)
  assert.match(migration, /FRAMED_MAIN_VALIDATOR_V1_2026_07_21/)
  assert.match(migration, /previous failed attempt[\s\S]*remains immutable/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs|delete\s+from|truncate/i)
})

test("framed-main recovery accepts only its exact reconciled transition", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721231000_allow_reconciled_framed_main_recovery_transition.sql",
    "utf8",
  )
  assert.match(migration,
    /v_last_transition\.previous_state = 'PREPARING_IMAGE_PACKAGE'[\s\S]*v_last_transition\.next_state = 'REJECTED'/)
  assert.match(migration,
    /v_last_transition\.previous_state = 'REJECTED'[\s\S]*v_last_transition\.next_state = 'PREPARING_IMAGE_PACKAGE'/)
  assert.match(migration,
    /VISUAL_STRATEGY_V3_EVIDENCE_VALIDATOR_DEPLOYED/)
  assert.match(migration,
    /v_failed_job\.created_at >= v_last_transition\.created_at/)
  assert.match(migration,
    /v_control\.created_at >= v_last_transition\.created_at/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs|delete\s+from|truncate/i)
})

test("foreground compositor V6 is mandatory for approval and final publication", async () => {
  const [migration, runtime, service] = await Promise.all([
    readFile(
      "supabase/migrations/20260721232000_require_verified_foreground_compositor_v6.sql",
      "utf8",
    ),
    readFile("lib/ebay/ebay-same-day-image-package-runtime.ts", "utf8"),
    readFile("lib/ebay/ebay-same-day-image-package-service.ts", "utf8"),
  ])
  assert.match(migration,
    /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21/)
  assert.match(migration,
    /EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21/)
  assert.match(migration, /LOCAL_AUTHORIZED_FOREGROUND/)
  assert.match(migration, /foregroundMatteSha256/)
  assert.match(migration, /foregroundTransparentBorderRatio/)
  assert.match(migration, /foregroundProtectedPixelRetentionRatio/)
  assert.match(migration, /foregroundOpaqueCornerRatio/)
  assert.match(migration, /foregroundMatteValidated/)
  assert.match(migration, /opaqueSourceFrameRemoved/)
  assert.match(migration, /textSafeAreaVerified/)
  assert.match(migration,
    /if p_decision = 'APPROVE' then[\s\S]*assert_same_day_pilot_image_set_current_v6/)
  assert.match(migration,
    /assert_ebay_publish_image_set_high_quality/)
  assert.match(runtime, /SAME_DAY_IMAGE_COMPOSITOR_REGENERATION_REQUIRED/)
  assert.match(service,
    /prepareAuthorizedEbaySecondaryForeground[\s\S]*requestBackgroundPlate/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("V6 approval and publication require verified secondary text glyphs and a copy-free main", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721235000_require_verified_image_text_renderer.sql",
    "utf8",
  )
  assert.match(migration,
    /assert_same_day_pilot_image_set_current_v6\(uuid,uuid,uuid\[\]\)/)
  assert.match(migration,
    /assert_ebay_publish_image_set_high_quality\(uuid,uuid,text\)/)
  assert.match(migration,
    /asset\.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'[\s\S]*asset\.transformation ->> 'textRendererVersion'[\s\S]*= 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'[\s\S]*asset\.qa_result ->> 'textGlyphsValidated' = 'true'/)
  assert.match(migration,
    /asset\.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'[\s\S]*asset\.transformation \? 'textRendererVersion'[\s\S]*asset\.qa_result \? 'textGlyphsValidated'/)
  assert.match(migration,
    /not \(asset\.transformation \? 'textRendererVersion'\)/)
  assert.match(migration,
    /not \(asset\.qa_result \? 'textGlyphsValidated'\)/)
  assert.ok(
    (migration.match(/EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21/g) ?? [])
      .length >= 2,
  )
  assert.ok(
    (migration.match(/textGlyphsValidated/g) ?? []).length >= 4,
  )
  assert.doesNotMatch(migration,
    /insert\s+into|update public\.|delete\s+from|truncate/i)
})

test("opaque V5 set recovery is exact, append-only, and creates a new V6 job", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721233000_requeue_opaque_frame_set_for_compositor_v6.sql",
    "utf8",
  )
  assert.match(migration,
    /requeue_same_day_image_after_opaque_frame_compositor_v6_v1/)
  assert.match(migration, /p_expected_capture_batch_id uuid/)
  assert.match(migration, /p_expected_completed_job_id uuid/)
  assert.match(migration, /p_expected_control_id uuid/)
  assert.match(migration, /p_confirm_project_ref text/)
  assert.match(migration, /vsfthqydfrdzulldbfbe/)
  assert.match(migration, /ab226a81-6d42-4404-a62a-b22d333be398/)
  assert.match(migration, /afd79416-707a-457a-b0d7-ae308eb6589a/)
  assert.match(migration, /21e14946-7b81-4094-8466-58b87977a0bb/)
  assert.match(migration, /94d5cf59-ebe5-4bad-ae22-062fbb297862/)
  assert.match(migration, /88f48603-bc28-4ee7-b9ea-44d749ef4676/)
  assert.match(migration, /environment = 'STAGING'/)
  assert.match(migration, /deployment_scope = 'PREVIEW'/)
  assert.match(migration,
    /EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21/)
  assert.match(migration,
    /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21/)
  assert.match(migration,
    /v_review := public\.review_ebay_same_day_pilot_image_package_set\([\s\S]*'REJECT'/)
  assert.match(migration,
    /insert into public\.ebay_same_day_pilot_handoffs/)
  assert.match(migration,
    /'WAITING_IMAGE_APPROVAL',[\s\S]*'PREPARING_IMAGE_PACKAGE'/)
  assert.match(migration, /'GENERATE_SIX_IMAGE_PACKAGE'/)
  assert.match(migration, /previousCompletedJobPreserved', true/)
  assert.match(migration, /oldEvidencePreserved', true/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.ok(
    migration.indexOf("v_review := public.review_ebay_same_day_pilot_image_package_set") <
      migration.indexOf("set status = 'SUPERSEDED'"),
  )
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_jobs[\s\S]*status\s*=\s*'PENDING'/i)
  assert.doesNotMatch(migration, /delete\s+from|truncate|promoteNextCandidate/i)
})

test("Calypso high-quality timeout recovery preserves reconciled evidence and creates one new lane", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721234000_resume_calypso_after_high_quality_timeout.sql",
    "utf8",
  )
  assert.match(migration,
    /resume_calypso_after_high_quality_timeout_v1/)
  assert.match(migration, /vsfthqydfrdzulldbfbe/)
  assert.match(migration, /ab226a81-6d42-4404-a62a-b22d333be398/)
  assert.match(migration, /afd79416-707a-457a-b0d7-ae308eb6589a/)
  assert.match(migration, /1d955612-2b93-454c-896e-66288f9ab89f/)
  assert.match(migration, /899ece3d-35e6-465c-a084-3223cf2928bc/)
  assert.match(migration, /v_failed_job\.status <> 'COMPLETED'/)
  assert.match(migration, /EFFECT_ALREADY_APPLIED_RECOVERED/)
  assert.match(migration, /v_failed_control\.status <> 'FAILED_FINAL'/)
  assert.match(migration, /EBAY_IMAGE_OPENAI_TIMEOUT/)
  assert.match(migration, /v_failed_control\.openai_calls <> 1/)
  assert.match(migration, /requiredTimeoutMilliseconds', 230000/)
  assert.match(migration,
    /insert into public\.ebay_same_day_pilot_handoffs/)
  assert.match(migration, /CALYPSO_HIGH_QUALITY_TIMEOUT_FAILED_JOB_MUTATED/)
  assert.match(migration, /CALYPSO_HIGH_QUALITY_TIMEOUT_FAILED_CONTROL_MUTATED/)
  assert.match(migration, /'newMaximumOpenAiCalls', 1/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs|delete\s+from|truncate/i)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_jobs[\s\S]*status\s*=/i)
})

test("Calypso tofu-text recovery rejects only the exact set and appends one renderer V2 lane", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721235500_requeue_calypso_after_tofu_text_renderer_v2.sql",
    "utf8",
  )
  assert.match(migration,
    /requeue_calypso_after_tofu_text_renderer_v2_v1/)
  assert.match(migration, /p_confirm_project_ref text/)
  assert.match(migration, /p_expected_capture_batch_id uuid/)
  assert.match(migration, /p_expected_completed_job_id uuid/)
  assert.match(migration, /p_expected_control_id uuid/)
  assert.match(migration, /p_expected_tesla_candidate_id uuid/)
  assert.match(migration, /p_expected_tesla_control_id uuid/)
  for (const id of [
    "vsfthqydfrdzulldbfbe",
    "88f48603-bc28-4ee7-b9ea-44d749ef4676",
    "ab226a81-6d42-4404-a62a-b22d333be398",
    "afd79416-707a-457a-b0d7-ae308eb6589a",
    "081a8928-36f9-4dd1-a3f2-d40af96ecb75",
    "d10383d6-ee63-4ae5-bcb5-15cf2371df95",
    "f285d371-c580-40df-a12e-b5b81637b9b2",
    "4191f0ff-e545-4501-a33c-efd3d36b30d4",
    "9b1d992d-c236-4dac-8908-726fc1eb1e3e",
    "2990cc06-6f7a-4592-9a07-8214b2a75023",
    "39ac7564-2845-4117-8495-78cbefb7bac3",
    "65f460df-a554-4630-bc1d-eb2223d102a4",
    "a22dfdd8-8629-499c-bdf7-52909312c9e5",
    "6613f83c-f189-4a47-a9eb-3262bf6ff6d7",
    "db420ed9-2139-4200-8bbb-fd6edfd0f5e7",
  ]) assert.match(migration, new RegExp(id))
  assert.match(migration, /environment = 'STAGING'/)
  assert.match(migration, /deployment_scope = 'PREVIEW'/)
  assert.match(migration,
    /v_control\.status <> 'PENDING_REVIEW'/)
  assert.match(migration, /v_control\.openai_calls <> 1/)
  assert.match(migration,
    /EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21/)
  assert.match(migration,
    /not \(asset\.transformation \? 'textRendererVersion'\)/)
  assert.match(migration,
    /not \(asset\.qa_result \? 'textGlyphsValidated'\)/)
  assert.match(migration,
    /v_review := public\.review_ebay_same_day_pilot_image_package_set\([\s\S]*'REJECT'/)
  assert.ok(
    migration.indexOf(
      "v_review := public.review_ebay_same_day_pilot_image_package_set",
    ) < migration.indexOf("insert into public.ebay_same_day_pilot_handoffs"),
  )
  assert.match(migration,
    /'WAITING_IMAGE_APPROVAL',[\s\S]*'PREPARING_IMAGE_PACKAGE'/)
  assert.match(migration,
    /EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21/)
  assert.match(migration,
    /requiredBackgroundPlateQuality', 'high'/)
  assert.match(migration, /maximumOpenAiCalls', 1/)
  assert.match(migration, /'GENERATE_SIX_IMAGE_PACKAGE'/)
  assert.match(migration,
    /CALYPSO_TEXT_RENDERER_V2_COMPLETED_JOB_MUTATED/)
  assert.match(migration,
    /CALYPSO_TEXT_RENDERER_V2_ASSET_EVIDENCE_MUTATED/)
  assert.match(migration, /CALYPSO_TEXT_RENDERER_V2_TESLA_MUTATED/)
  assert.match(migration, /to_jsonb\(v_tesla_candidate\)/)
  assert.match(migration, /to_jsonb\(v_tesla_control\)/)
  assert.match(migration, /'teslaUnchanged', true/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_image_package_runs/i)
  assert.doesNotMatch(migration,
    /update public\.ebay_same_day_pilot_jobs[\s\S]*status\s*=/i)
  assert.doesNotMatch(migration,
    /delete\s+from|truncate|promoteNextCandidate|applyApprovedImageRevision|createOrReplaceInventoryItem|createOffer|publishOffer/i)
})

test("invalid Product Research history is quarantined and active candidates return to recapture", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721150000_quarantine_invalid_product_research_capture_evidence.sql",
    "utf8",
  )
  assert.match(migration, /quality_status = 'QUARANTINED'/)
  assert.match(migration, /evidence_reviewed = false/)
  assert.match(migration, /last_sold_date < batch\.captured_at - interval '92 days'/)
  assert.match(migration, /machine_state = 'PRODUCT_RESEARCH_PLAN_READY'/)
  assert.match(migration, /state = 'NEEDS_PRODUCT_RESEARCH_CAPTURE'/)
  assert.match(migration, /CAPTURE_EVIDENCE_QUARANTINED/)
  assert.match(migration, /originalRowsPreserved', true/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("legacy image review can return one exact candidate to Visual Evidence V2 Research", async () => {
  const migration = await readFile(
    "supabase/migrations/20260721180000_requeue_same_day_image_candidate_for_visual_v2_research.sql",
    "utf8",
  )
  assert.match(migration,
    /requeue_same_day_image_candidate_for_visual_v2_research_v1/)
  assert.match(migration, /p_expected_capture_batch_id uuid/)
  assert.match(migration, /p_expected_control_id uuid/)
  assert.match(migration,
    /PRODUCT_RESEARCH_VISUAL_PATTERN_V2_2026_07_21/)
  assert.match(migration, /VISUAL_MARKET_BRIEF_V2_2026_07_21/)
  assert.match(migration,
    /review_ebay_same_day_pilot_image_package_set\([\s\S]*'REJECT'/)
  assert.ok(
    migration.indexOf("review_ebay_same_day_pilot_image_package_set") <
      migration.indexOf("set status = 'SUPERSEDED'"),
  )
  assert.match(migration, /set status = 'PENDING',[\s\S]*capture_batch_id = null/)
  assert.match(migration, /set status = 'ACTIVE',[\s\S]*completed_at = null/)
  assert.match(migration, /state = 'NEEDS_PRODUCT_RESEARCH_CAPTURE'/)
  assert.match(migration, /'PRODUCT_RESEARCH_PLAN_READY'/)
  assert.match(migration, /'productResearchPlanId', v_query_plan\.id/)
  assert.match(migration, /existingProductApprovalRetainedForRevalidation', true/)
  assert.match(migration, /oldEvidencePreserved', true/)
  assert.match(migration, /'openAiCalls', 0/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.match(migration, /'productionChanged', false/)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test("preview source failures expose only an allowlisted source code", async () => {
  const service = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )
  assert.match(
    service,
    /type SameDayPilotPreviewSource =[\s\S]*"OPPORTUNITY"[\s\S]*"QUOTA"[\s\S]*"MONITOR"[\s\S]*"RESEARCH"[\s\S]*"ACTIVE_LISTING"/,
  )
  for (const source of [
    "QUOTA",
    "MONITOR",
    "RESEARCH",
    "ACTIVE_LISTING",
  ]) {
    assert.match(
      service,
      new RegExp(`readSameDayPilotPreviewSource\\(\\s*"${source}"`),
    )
  }
  assert.match(
    service,
    /readEligibleSameDayOpportunities\(\{[\s\S]*?accountKey:\s*input\.accountKey/,
  )
  assert.match(
    service,
    /throw new Error\("SAME_DAY_PILOT_SOURCE_READ_FAILED:OPPORTUNITY"\)/,
  )
  assert.match(
    service,
    /catch \{\s*throw new Error\(`SAME_DAY_PILOT_SOURCE_READ_FAILED:\$\{source\}`\)\s*\}/,
  )
  assert.doesNotMatch(
    service,
    /SAME_DAY_PILOT_SOURCE_READ_FAILED:\$\{(?:error|message|cause|query)\}/,
  )
})

test("cycle claim preserves zero verified progress instead of substituting total active listings", async () => {
  const service = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )

  assert.match(
    service,
    /p_verified_existing_listings:\s*verifiedExistingListings,/,
  )
  assert.doesNotMatch(
    service,
    /p_verified_existing_listings:\s*verifiedExistingListings\s*\|\|\s*preview\.counts\.verifiedExistingListings/,
  )
})

test("listing package recovery adopts legacy scope and preserves prior bindings", async () => {
  const runtime = await readFile(
    "lib/ebay/ebay-same-day-image-package-runtime.ts",
    "utf8",
  )

  assert.match(runtime, /\.is\("account_key", null\)/)
  assert.match(runtime, /sameDayPilotBindingHistory/)
  assert.match(runtime, /TERMINAL_UNPUBLISHED_RUN_REBOUND/)
  assert.match(
    runtime,
    /SAME_DAY_IMAGE_LISTING_PACKAGE_PUBLICATION_RECONCILIATION_REQUIRED/,
  )
  assert.match(runtime, /EBAY_PUBLISH_WRITE_REJECTED/)
})

test("rejected listing package bindings resume from the image checkpoint", async () => {
  const service = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )

  assert.match(service, /LISTING_PACKAGE_BINDING_RECOVERY_V1_2026_07_26/)
  assert.match(service, /repairRejectedListingPackageBinding/)
  assert.match(service, /RECOVER_LISTING_PACKAGE_BINDING/)
  assert.match(service, /previousState: "REJECTED",\s*nextState: "PREPARING_IMAGE_PACKAGE"/)
  assert.match(service, /commercialEvidencePreserved: true/)
  assert.match(service, /historyDeleted: false/)
})

test("a busy exact-sold reanalysis target retries instead of rejecting the candidate", async () => {
  const service = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )

  assert.match(service, /exactSoldObservationIds\.size > 0/)
  assert.match(service, /LOOP1_REANALYSIS_TARGET_BUSY/)
  assert.match(service, /waitingFor: "LOOP1_REANALYSIS_TARGET_AVAILABLE"/)
  assert.match(service, /preserveAttempt: true/)
})
