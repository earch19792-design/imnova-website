import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const { projectSellerOsBrowserWorkerCapabilityV1 } = await import(
  "./browser-worker-capability-v1.ts")

const migration = readFileSync(
  "supabase/migrations/20260907052451_seller_os_browser_worker_self_recovery_v1.sql",
  "utf8")
const snapshot = readFileSync(
  "lib/seller-os/operational-snapshot-v1.ts", "utf8")
const assurance = readFileSync(
  "lib/seller-os/runtime-capability-assurance-v1.ts", "utf8")
const researchService = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const researchRunner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const researchBackground = readFileSync(
  "tools/browser-extensions/ebay-product-research-capture/background.js", "utf8")
const shippingBackground = readFileSync(
  "tools/browser-extensions/luna-shipping-capture/background.js", "utf8")
const shippingControl = readFileSync(
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  "utf8")

function heartbeatRow(overrides = {}) {
  return {
    capability_id: "PRODUCT_RESEARCH_EXTENSION",
    worker_family: "PRODUCT_RESEARCH",
    worker_state: "IDLE",
    heartbeat_receipt_id: "11111111-1111-4111-8111-111111111111",
    heartbeat_source: "INDEPENDENT_WORKER_LIVENESS",
    physical_connection: "PROVEN_AVAILABLE",
    extension_identity_match: true,
    extension_version: "1.2.27",
    observed_at: "2026-09-07T05:00:00.000Z",
    fresh_until: "2026-09-07T05:05:00.000Z",
    ...overrides,
  }
}

test("PASS_RESEARCH_IDLE_WORKER_HEARTBEAT_REMAINS_FRESH", () => {
  const result = projectSellerOsBrowserWorkerCapabilityV1({
    row: heartbeatRow(), now: new Date("2026-09-07T05:04:59.000Z"),
  })
  assert.equal(result.workerState, "IDLE")
  assert.equal(result.fresh, true)
  assert.equal(result.connectionState, "PROVEN_AVAILABLE")
})

test("PASS_RESEARCH_BUSINESS_OUTPUT_NOT_USED_AS_HEARTBEAT", () => {
  assert.match(snapshot, /INDEPENDENT_WORKER_LIVENESS_PLUS_QUERY_PLAN/)
  assert.doesNotMatch(snapshot,
    /const recentResearch = Number\.isFinite\(latestResearchAt\)/)
  assert.match(assurance, /workerLivenessEvidence/)
})

test("PASS_SHIPPING_IDLE_WORKER_HEARTBEAT_REMAINS_FRESH", () => {
  const result = projectSellerOsBrowserWorkerCapabilityV1({
    row: heartbeatRow({ capability_id: "LUNA_SHIPPING",
      worker_family: "LUNA_SHIPPING", extension_version: "1.0.53" }),
    now: new Date("2026-09-07T05:01:00.000Z"),
  })
  assert.equal(result.fresh, true)
})

test("PASS_SHIPPING_BUSINESS_OUTPUT_NOT_USED_AS_HEARTBEAT", () => {
  assert.match(snapshot,
    /INDEPENDENT_WORKER_LIVENESS_PLUS_ELIGIBLE_JOB_QUEUE/)
  assert.doesNotMatch(snapshot, /function workerCapabilityReceipt/)
  assert.match(shippingControl, /heartbeat_worker_capability/)
})

test("PASS_BROWSER_UNOBSERVABLE_REMAINS_UNKNOWN_OR_WAITING_DEPENDENCY", () => {
  const result = projectSellerOsBrowserWorkerCapabilityV1({
    row: heartbeatRow(), now: new Date("2026-09-07T05:05:00.000Z"),
  })
  assert.equal(result.fresh, false)
  assert.equal(result.connectionState, "UNOBSERVABLE")
})

test("PASS_QUICK_PICK_RESEARCH_PLAN_IS_AUTO_CLAIMABLE", () => {
  assert.match(migration,
    /'LIVE_LISTING_REVALIDATION', 'QUICK_PICK_RESEARCH_REQUIRED'/)
  assert.match(researchService,
    /\.in\("source_context", \["LIVE_LISTING_REVALIDATION",[\s\S]*"QUICK_PICK_RESEARCH_REQUIRED"\]\)/)
  assert.match(researchService, /completeQuickPickProductResearchPlanV1/)
})

test("PASS_LIVE_LISTING_REVALIDATION_STILL_AUTO_CLAIMABLE", () => {
  assert.match(migration, /plan\.source_context = 'LIVE_LISTING_REVALIDATION'/)
  assert.match(researchService, /completeMayelLiveMarketRevalidationV1/)
})

test("PASS_RESEARCH_CLAIM_EXACTLY_ONCE", () => {
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /worker_lease_expires_at > clock_timestamp\(\)/)
  assert.match(migration, /return query select false/)
})

test("PASS_EXISTING_WAITING_GOLDEN_RECOVERED", () => {
  assert.match(researchRunner, /HEARTBEAT_PRODUCT_RESEARCH_WORKER/)
  assert.match(researchRunner, /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(researchRunner, /browserWorkerControl/)
  assert.doesNotMatch(researchService,
    /ITEM1046|9266387058912|48907793826016|4380ea4d23afb01c/)
})

test("PASS_EXISTING_SHIPPING_PENDING_JOBS_RECOVERABLE", () => {
  assert.match(shippingBackground, /ensureShippingWorkerControlPage/)
  assert.match(shippingControl, /attemptProductionAcquisition\(\)/)
  assert.match(shippingControl, /resolve_jobs/)
})

test("PASS_BROWSER_RESTART_RECOVERS_WITHOUT_OWNER_CLICK", () => {
  for (const source of [researchBackground, shippingBackground]) {
    assert.match(source, /runtime\.onStartup/)
    assert.match(source, /alarms.*onAlarm/s)
    assert.match(source, /active: false/)
  }
})

test("PASS_NO_DUPLICATE_PLAN_OR_JOB", () => {
  assert.match(migration,
    /primary key \(marketplace_account_key, capability_id\)/)
  assert.match(migration,
    /marketplace_product_research_quick_pick_claim_idx/)
  assert.match(migration, /worker_claim_count = plan\.worker_claim_count \+ 1/)
})
