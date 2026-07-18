import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildSameDayLocalPreparationPackage,
  evaluateReadyForContent,
  listingQuantityFromLuna,
  selectSameDayQueue,
} from "./ebay-same-day-pilot-domain.ts"

const candidate = (index, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  candidateKey: `candidate-${index}`, productTitle: `Safe Product ${index}`,
  variantTitle: "Default", supplierSku: `SKU-${index}`, supplierVariantId: `variant-${index}`,
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
})

test("automation is durable, one-click, auto-resuming and has no eBay-write path", async () => {
  const [migration, hardening, service, home, capture, cron, workflow] = await Promise.all([
    readFile("supabase/migrations/20260718030000_create_same_day_pilot_orchestrator.sql", "utf8"),
    readFile("supabase/migrations/20260718040000_harden_same_day_pilot_local_continuation.sql", "utf8"),
    readFile("lib/ebay/ebay-same-day-pilot-service.ts", "utf8"),
    readFile("app/admin/today-launch-panel.tsx", "utf8"),
    readFile("app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8"),
    readFile("app/api/cron/ebay-same-day-pilot/route.ts", "utf8"),
    readFile(".github/workflows/ebay-same-day-pilot-preview.yml", "utf8"),
  ])
  for (const table of ["ebay_same_day_pilot_transitions", "ebay_same_day_pilot_jobs", "ebay_same_day_pilot_human_tasks"]) assert.match(migration, new RegExp(table))
  for (const state of ["RUN_CREATED", "WAITING_PRODUCT_RESEARCH_CAPTURE", "CALCULATING_ECONOMICS", "READY_FOR_MANUAL_PUBLICATION", "VERIFYING_PUBLISHED_LISTING", "VERIFIED_ACTIVE"]) assert.match(migration, new RegExp(state))
  assert.match(home, /INICIAR LANZAMIENTO DE HOY/)
  assert.equal((home.match(/action: "start"/g) ?? []).length, 1)
  assert.match(service, /promoteNextCandidate/)
  assert.match(service, /market_radar_latest_variants/)
  assert.match(service, /LUNA_CONFIRMED_AUTO_RESUME/)
  assert.match(service, /WAITING_RETRY/)
  assert.match(service, /RECONCILE_PRODUCT_RESEARCH_CAPTURE/)
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
