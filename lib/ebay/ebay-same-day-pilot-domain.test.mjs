import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildSameDayLocalPreparationPackage,
  buildSameDayProductResearchQuery,
  evaluateReadyForContent,
  listingQuantityFromLuna,
  selectSameDayQueue,
} from "./ebay-same-day-pilot-domain.ts"

const candidate = (index, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  candidateKey: `candidate-${index}`, productTitle: `Safe Product ${index}`,
  variantTitle: "Default", supplierSku: `SKU-${index}`, supplierVariantId: `variant-${index}`,
  supplierProductUrl: `https://lunaportex.com/products/product-${index}`,
  supplierImageUrl: `https://cdn.example.com/luna-product-${index}.jpg`,
  gtin: `0000000${String(index).padStart(5, "0")}`, supplierPrice: 4,
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

test("family grouping prevents duplicate variants and prepares one exact query", () => {
  const selected = selectSameDayQueue([
    candidate(1, { productTitle: "Widget", brand: "Acme", mpn: "M1" }),
    candidate(2, { productTitle: "Widget", brand: "Acme", mpn: "M1" }),
  ])
  assert.equal(selected.length, 1)
  assert.equal(selected[0].queryPlan.strategy, "GTIN")
})

test("Product Research queries omit Luna's Default Title placeholder", () => {
  const query = buildSameDayProductResearchQuery(candidate(99, {
    gtin: null,
    productTitle: "9001E e-Series Battery Switch, Selector 4 Position, Red",
    variantTitle: "Default Title",
  }))
  assert.equal(query.query, "9001E e Series Battery Switch Selector 4 Position Red")
  assert.doesNotMatch(query.query, /default|title/i)
})

test("broad-only or stale evidence cannot advance and requests one authorized capture", () => {
  const [selected] = selectSameDayQueue([candidate(1, { activeExactCount: 0, soldExactCount: 0, compatibleSellerCount: 0, evidenceFresh: false })])
  assert.equal(selected.state, "NEEDS_PRODUCT_RESEARCH_CAPTURE")
  assert.ok(selected.blockers.includes("FRESH_EXACT_MARKET_EVIDENCE_REQUIRED"))
  assert.equal(selected.callsEstimated, 1)
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
  assert.equal(prepared.product.supplierImageUrl, "https://cdn.example.com/luna-product-1.jpg")
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

test("unknown Luna quantity safely produces listing quantity one and a sale recheck", () => {
  assert.deepEqual(listingQuantityFromLuna(null, true), { quantity: 1, recheckAfterSale: true })
  assert.deepEqual(listingQuantityFromLuna(0, false), { quantity: 0, recheckAfterSale: false })
  assert.throws(() => listingQuantityFromLuna(0, true), /LUNA_AVAILABILITY_QUANTITY_CONFLICT/)
  assert.throws(() => listingQuantityFromLuna(3, false), /LUNA_AVAILABILITY_QUANTITY_CONFLICT/)
})

test("automation is durable, one-click, auto-resuming and has no eBay-write path", async () => {
  const [migration, hardening, stateHardening, leasePreflight, claimSerialization, atomicGates, service, home, capture, cron, workflow, route, handoff] = await Promise.all([
    readFile("supabase/migrations/20260718030000_create_same_day_pilot_orchestrator.sql", "utf8"),
    readFile("supabase/migrations/20260718040000_harden_same_day_pilot_local_continuation.sql", "utf8"),
    readFile("supabase/migrations/20260718043000_harden_same_day_pilot_state_machine.sql", "utf8"),
    readFile("supabase/migrations/20260718043500_preflight_same_day_pilot_job_leases.sql", "utf8"),
    readFile("supabase/migrations/20260718044000_serialize_same_day_pilot_job_claims.sql", "utf8"),
    readFile("supabase/migrations/20260718047000_atomically_complete_same_day_human_gates.sql", "utf8"),
    readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8"),
    readFile("app/admin/today-launch-panel.tsx", "utf8"),
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
  assert.match(service, /promoteNextCandidate/)
  assert.match(service, /market_radar_latest_variants/)
  assert.match(service, /product_url,featured_image_url/)
  assert.match(service, /SAME_DAY_PILOT_LUNA_ANCHOR_READ_FAILED/)
  assert.match(service, /\.eq\("source_key", "lunaportex"\)/)
  assert.match(service, /\.eq\("product_id", opportunity\.market_radar_product_id\)/)
  assert.match(service, /SAME_DAY_PILOT_LUNA_HANDOFF_IDENTITY_MISMATCH/)
  assert.match(service, /local_preparation_package:[\s\S]*supplierProductUrl:[\s\S]*supplierImageUrl:/)
  assert.match(service, /LUNA_CONFIRMED_AUTO_RESUME/)
  assert.match(home, /ABRIR PRODUCTO EXACTO EN LUNA/)
  assert.match(home, /sh\/research#seller-os-query=/)
  assert.doesNotMatch(home, /sh\/research\?[^"`]*keywords=/)
  assert.match(home, /Consulta que Seller OS validará/)
  assert.match(home, /Aplicar y buscar próxima consulta/)
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
  assert.match(capture, /resumeSameDayPilotAfterProductResearchCapture/)
  assert.match(capture, /\.limit\(10\)/)
  assert.doesNotMatch(capture, /reconcileProductResearchObservations\(\{\s*supabase: auth\.supabase, accountKey: auth\.accountKey,\s*\}\)/)
  assert.match(cron, /processSameDayPilotJobs/)
  assert.match(cron, /EBAY_SAME_DAY_PILOT_PREVIEW_WORKER_ENABLED/)
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
  assert.match(atomicGates, /status = 'COMPLETED'/)
  assert.match(atomicGates, /SAME_DAY_PILOT_GATE_PATCH_KEY_BLOCKED/)
  assert.match(service, /completeAndAdvanceHumanGate/)
  assert.doesNotMatch(service, /completeHumanTask/)
  assert.match(service, /advance_same_day_pilot_candidate/)
  assert.match(service, /acquirePilotRunLease/)
  assert.match(service, /status: "RUN_BUSY"/)
  assert.match(service, /finally \{[\s\S]*releasePilotRunLease/)
  assert.match(service, /SAME_DAY_PILOT_STALE_TRANSITION/)
  assert.match(service, /preserveAttempt: rateLimited/)
  assert.match(service, /recoverDeadLetterCandidates/)
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
  assert.match(service, /WAITING_PRODUCT_APPROVAL: "PRODUCT_APPROVAL_REQUIRED"/)
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
  assert.match(home, /ABRIR SELLER HUB Y PUBLICAR/)
  assert.match(home, /Custom Label \/ SKU/)
  assert.match(home, /businessPolicies\.fulfillmentPolicyId/)
  assert.match(home, /shippingText/)
  assert.match(home, /URLs autorizadas en orden/)
  assert.match(handoff, /factsOnly: true/)
  assert.match(handoff, /competitorContentUsed: false/)
  assert.match(handoff, /openAiCalls: 0/)
  assert.match(handoff, /ebayWrites: 0/)
  assert.match(home, /PUBLICADO Y VERIFICADO/)
  assert.match(workflow, /EBAY_SAME_DAY_PILOT_PREVIEW_WORKER_ENABLED/)
  assert.match(workflow, /EBAY_SAME_DAY_PILOT_CRON_SECRET/)
  assert.match(migration, /ebay_writes integer not null default 0 check \(ebay_writes = 0\)/)
  assert.match(migration, /production_changed boolean not null default false check \(not production_changed\)/)
  assert.doesNotMatch(service, /createOffer|publishOffer|bulkCreateOffer/)
})

test("only one candidate is activated initially so failures promote the next without task overload", async () => {
  const service = await readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8")
  assert.match(service, /const first = candidates\?\.\[0\]/)
  assert.match(service, /if \(first\) await bootstrapCandidate/)
  assert.doesNotMatch(service, /for \(const candidate of candidates \?\? \[\]\) await bootstrapCandidate/)
})
