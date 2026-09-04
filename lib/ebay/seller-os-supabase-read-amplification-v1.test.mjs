import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readSellerOsDashboardSnapshotV1,
  resetSellerOsDashboardSnapshotCacheV1,
} from "./seller-os-dashboard-snapshot-cache-v1.ts"
import {
  SELLER_OS_VISIBLE_DASHBOARD_POLL_INTERVAL_MS,
  startSellerOsVisibilityAwarePollingV1,
} from "../seller-os-visibility-aware-polling-v1.ts"
import { buildSellerOsDashboardOpportunityAuthorityV1 } from
  "./seller-os-dashboard-opportunity-authority-v1.ts"

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

test("dashboard polling is >=30s, visibility-aware and single-flight", async () => {
  let visibilityState = "visible"
  let intervalHandler = () => undefined
  let visibilityHandler = () => undefined
  let taskCount = 0
  const first = deferred()
  const polling = startSellerOsVisibilityAwarePollingV1({
    intervalMs: 10_000,
    task: async () => {
      taskCount += 1
      if (taskCount === 1) await first.promise
    },
    pollingWindow: {
      setInterval(handler) { intervalHandler = handler; return 41 },
      clearInterval() {},
      addEventListener(_name, handler) { visibilityHandler = handler },
      removeEventListener() {},
      visibilityState: () => visibilityState,
    },
  })
  await Promise.resolve()
  assert.equal(polling.intervalMs,
    SELLER_OS_VISIBLE_DASHBOARD_POLL_INTERVAL_MS)
  assert.equal(taskCount, 1)
  intervalHandler()
  await Promise.resolve()
  assert.equal(taskCount, 1)
  assert.deepEqual(polling.diagnostics(), {
    requestCount: 1,
    overlappingPollCount: 0,
    singleFlightSuppressedCount: 1,
    hiddenPollSkipCount: 0,
  })
  first.resolve()
  await polling.runNow()

  visibilityState = "hidden"
  intervalHandler()
  await Promise.resolve()
  assert.equal(taskCount, 1)
  assert.equal(polling.diagnostics().hiddenPollSkipCount, 1)

  visibilityState = "visible"
  visibilityHandler()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(taskCount, 2)
  polling.stop()
})

test("dashboard snapshot cache joins concurrent reads and reuses freshness", async () => {
  resetSellerOsDashboardSnapshotCacheV1()
  const pending = deferred()
  let databaseReads = 0
  const load = async () => {
    databaseReads += 1
    await pending.promise
    return { total: 13 }
  }
  const first = readSellerOsDashboardSnapshotV1({ key: "owner:queue", load })
  const second = readSellerOsDashboardSnapshotV1({ key: "owner:queue", load })
  pending.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(databaseReads, 1)
  assert.equal(firstResult.source, "DATABASE_READ")
  assert.equal(secondResult.source, "SINGLE_FLIGHT_JOIN")
  const third = await readSellerOsDashboardSnapshotV1({
    key: "owner:queue", load,
  })
  assert.equal(third.source, "FRESH_SNAPSHOT")
  assert.equal(databaseReads, 1)
})

test("owner dashboard uses one bounded queue projection and no count fan-out", async () => {
  const readModel = await readFile(new URL(
    "./seller-os-dashboard-queue-read-model-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-opportunity-queue/route.ts",
    import.meta.url), "utf8")
  const dashboard = await readFile(new URL(
    "../../app/admin/seller-os-operational-dashboard.tsx",
    import.meta.url), "utf8")
  const legacyDetailedRead = await readFile(new URL(
    "./ebay-first-luna-scan-service.ts", import.meta.url), "utf8")
  assert.match(readModel, /queueDatabaseReadCount: 1/)
  assert.match(readModel, /broadQueuePayloadRead: false/)
  assert.match(readModel, /separateQueueCountQueries: 0/)
  assert.match(readModel,
    /dashboard_is_quick_pick/)
  assert.match(readModel,
    /dashboard_quick_pick_operation_id/)
  assert.doesNotMatch(readModel, /hard_gates,evidence_guards,assessment/)
  assert.match(readModel, /assessmentJsonRead: false/)
  assert.match(route, /ownerDashboardSummary/)
  assert.match(dashboard, /ownerDashboardSummary=1/)
  assert.doesNotMatch(dashboard, /15_000/)
  assert.doesNotMatch(legacyDetailedRead,
    /select\("id", \{ count: "exact", head: true \}\)/)
})

test("read hardening preserves GET and marketplace safety boundaries", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-opportunity-queue/route.ts",
    import.meta.url), "utf8")
  const readModel = await readFile(new URL(
    "./seller-os-dashboard-queue-read-model-v1.ts", import.meta.url), "utf8")
  assert.match(route, /export async function GET/)
  assert.match(readModel, /getReadOnly: true/)
  assert.doesNotMatch(readModel, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
  assert.doesNotMatch(readModel, /publishOffer|createOffer|marketplace.*write/i)
})

test("generated queue fields retain assessment as canonical authority", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260904233840_seller_os_dashboard_queue_read_model_v1.sql",
    import.meta.url), "utf8")
  const authority = await readFile(new URL(
    "./seller-os-dashboard-opportunity-authority-v1.ts", import.meta.url),
  "utf8")
  assert.match(migration, /generated always as/)
  assert.match(migration, /assessment remains canonical/)
  assert.doesNotMatch(migration, /create index/i)
  assert.match(authority, /dashboard_is_quick_pick === true/)
  assert.match(authority, /dashboard_is_radar_candidate === true/)

  const common = { id: "opportunity-1", candidate_key: "candidate-1",
    supplier_product_id: "product-1", supplier_variant_id: "variant-1",
    supplier_sku: "SKU-1", product_title: "Product", queue_status: "review",
    decision: "RADAR_REVIEW" }
  const legacy = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: [{ ...common, assessment: {
      radarFactoryCandidateV1: { status: "READY" },
      radarToQuickPickHandoffV1: { radarFamilyId: "family-1",
        lunaSku: "SKU-1", quickPickOperationId: "operation-1" },
    } }], liveReadStatus: "AVAILABLE", liveMatches: new Map(),
    radarReadStatus: "AVAILABLE", radarEntries: [{ familyId: "family-1",
      familyName: "Family", familyDemandStatus: "FAMILY_DEMAND_PROVEN",
      evidenceFreshness: "FRESH" }],
  })
  const projected = buildSellerOsDashboardOpportunityAuthorityV1({
    queueRows: [{ ...common, dashboard_is_radar_candidate: true,
      dashboard_radar_family_id: "family-1",
      dashboard_radar_luna_sku: "SKU-1",
      dashboard_quick_pick_operation_id: "operation-1" }],
    liveReadStatus: "AVAILABLE", liveMatches: new Map(),
    radarReadStatus: "AVAILABLE", radarEntries: [{ familyId: "family-1",
      familyName: "Family", familyDemandStatus: "FAMILY_DEMAND_PROVEN",
      evidenceFreshness: "FRESH" }],
  })
  assert.deepEqual(projected, legacy)
})
