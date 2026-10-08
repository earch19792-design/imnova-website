import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  parseSellerOsSelfhostRuntimeStatusV1,
  readSellerOsSelfhostRuntimeStatusV1,
} from "../seller-os/selfhost-runtime-status-v1.ts"

const statusFixture = {
  contractVersion: "SELLER_OS_SELFHOST_RUNTIME_STATUS_V1",
  observedAt: "2026-10-08T17:45:00.000Z",
  runtimeStatus: "ONLINE",
  heartbeatAgeSeconds: 12,
  session: {
    startedAt: "2026-10-08T17:44:30.000Z",
    priorHeartbeatAt: "2026-10-08T12:00:00.000Z",
    lastHeartbeatAt: "2026-10-08T17:44:48.000Z",
    resumeGapSeconds: 20_670,
    resumedFromGap: true,
    catchUpCandidateCount: 3,
  },
  jobs: [{
    name: "commercial-monitor",
    scheduledSlot: 29_860_665,
    triggerKind: "CATCH_UP",
    status: "SUCCEEDED",
    attemptCount: 1,
    startedAt: "2026-10-08T17:44:32.000Z",
    completedAt: "2026-10-08T17:44:34.000Z",
    httpStatus: 200,
    outcomeCode: "HTTP_SUCCESS",
    elapsedMs: 2_000,
  }],
  counts: { running: 0, stale: 0, failedLast24Hours: 0 },
  safety: { readOnly: true, credentialsIncluded: false,
    environmentValuesIncluded: false, marketplaceWrites: 0,
    databaseBusinessMutations: 0 },
}

test("self-host status parser preserves bounded resume and job evidence", () => {
  const parsed = parseSellerOsSelfhostRuntimeStatusV1(statusFixture)
  assert.equal(parsed.runtimeStatus, "ONLINE")
  assert.equal(parsed.session?.resumedFromGap, true)
  assert.equal(parsed.session?.catchUpCandidateCount, 3)
  assert.equal(parsed.jobs[0]?.status, "SUCCEEDED")
  assert.equal(parsed.jobs[0]?.outcomeCode, "HTTP_SUCCESS")
})

test("self-host status parser fails closed if secret or write safety changes", () => {
  assert.throws(() => parseSellerOsSelfhostRuntimeStatusV1({
    ...statusFixture,
    safety: { ...statusFixture.safety, credentialsIncluded: true },
  }), /SELFHOST_RUNTIME_STATUS_INVALID/)
  assert.throws(() => parseSellerOsSelfhostRuntimeStatusV1({
    ...statusFixture,
    safety: { ...statusFixture.safety, marketplaceWrites: 1 },
  }), /SELFHOST_RUNTIME_STATUS_INVALID/)
})

test("self-host status reader uses only the service RPC", async () => {
  const calls = []
  const result = await readSellerOsSelfhostRuntimeStatusV1({
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: statusFixture, error: null }
    },
  })
  assert.equal(result.runtimeStatus, "ONLINE")
  assert.deepEqual(calls, [{
    name: "get_seller_os_selfhost_runtime_status_v1", args: undefined,
  }])
})

test("self-host control plane is RLS forced, service-only, and idempotent", () => {
  const migration = readFileSync(
    "supabase/migrations/20261008173053_seller_os_selfhost_resume_control_plane_v1.sql",
    "utf8",
  )
  assert.match(migration,
    /unique \(job_name, scheduled_slot\)/)
  assert.match(migration,
    /seller_os_selfhost_runtime_sessions_v1[\s\S]*force row level security/)
  assert.match(migration,
    /seller_os_selfhost_runtime_job_runs_v1[\s\S]*force row level security/)
  assert.match(migration,
    /revoke all on table public\.seller_os_selfhost_runtime_sessions_v1[\s\S]*authenticated, service_role/)
  assert.match(migration,
    /grant execute on function public\.start_seller_os_selfhost_runtime_v1/)
  assert.match(migration,
    /public\.is_seller_os_service_role_request_v1\(\)/)
  const retry = readFileSync(
    "supabase/migrations/20261008174721_retry_failed_selfhost_runtime_jobs_v1.sql",
    "utf8",
  )
  assert.match(retry, /status = 'FAILED'/)
  assert.match(retry, /completed_at <= v_now - interval '60 seconds'/)
  assert.match(retry, /attempt_count < 20/)
  const superseded = readFileSync(
    "supabase/migrations/20261008184500_reclaim_jobs_from_superseded_sessions_v1.sql",
    "utf8",
  )
  assert.match(superseded, /prior_session\.status = 'SUPERSEDED'/)
  assert.match(superseded, /run\.lease_expires_at <= v_now/)
  assert.match(superseded,
    /is_seller_os_service_role_request_v1\(\)/)
  const deferrals = readFileSync(
    "supabase/migrations/20261008180635_reclassify_selfhost_policy_deferrals_v1.sql",
    "utf8",
  )
  assert.match(deferrals, /outcome_code = 'DEFERRED_POLICY_GATE'/)
  assert.match(deferrals, /job_name = 'commercial-monitor'/)
  assert.match(deferrals, /http_status = 423/)
})

test("local scheduler requires durable claims and heartbeat before productive jobs", () => {
  const scheduler = readFileSync("tools/selfhost-scheduler.mjs", "utf8")
  assert.match(scheduler, /STARTUP/)
  assert.match(scheduler, /CLAIM_JOB/)
  assert.match(scheduler, /COMPLETE_JOB/)
  assert.match(scheduler, /HEARTBEAT/)
  assert.match(scheduler, /CATCH_UP/)
  assert.match(scheduler, /catchUpCandidateCount/)
  assert.match(scheduler, /runtimeSessionId/)
  assert.match(scheduler, /attempt <= 3/)
  assert.match(scheduler, /DEFERRED_POLICY_GATE/)
  assert.match(scheduler,
    /response\.status === 409 \|\| response\.status === 423/)
  assert.match(scheduler, /x-seller-os-runtime-outcome/)
  assert.match(scheduler,
    /running\.has\("quick-pick-runtime-recovery"\)/)
})

test("Quick Pick wake-up recovery is incremental and reports business deferrals", () => {
  const route = readFileSync(
    "app/api/cron/quick-pick-runtime-recovery/route.ts", "utf8")
  const keyword = readFileSync(
    "lib/seller-os/current-keyword-continuation-v2-1.ts", "utf8")
  assert.match(route, /SELFHOST_RECOVERY_BATCH_SIZE = 3/)
  assert.match(route, /maximumPackages: SELFHOST_RECOVERY_BATCH_SIZE/)
  assert.match(route, /maximumReconciliations: SELFHOST_RECOVERY_BATCH_SIZE/)
  assert.match(route, /maximumRecoveryClaims: SELFHOST_RECOVERY_BATCH_SIZE/)
  assert.match(route, /maximumRecoveryRows: SELFHOST_RECOVERY_BATCH_SIZE/)
  assert.match(route, /QUICK_PICK_RECOVERY_PARTIAL/)
  assert.match(keyword, /order\("updated_at", \{ ascending: true \}\)/)
})
