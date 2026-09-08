import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"

const workload = await import(
  "../seller-os/background-workload-optimization-v1.ts")

const migration = readFileSync(
  "supabase/migrations/20260908142459_seller_os_background_workload_optimization_v1_phase_a.sql",
  "utf8")
const researchRunner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const researchFallback = readFileSync(
  "app/admin/product-research-autonomous-acquisition-v1.tsx", "utf8")
const researchRoute = readFileSync(
  "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
const shippingControl = readFileSync(
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  "utf8")
const shippingRoute = readFileSync(
  "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
const researchClaim = readFileSync(
  "supabase/migrations/20260907072000_browser_worker_first_attempt_fairness_v1.sql",
  "utf8")
const shippingClaim = readFileSync(
  "supabase/migrations/20260905015920_seller_os_luna_shipping_job_claims_v1.sql",
  "utf8")
const monitoringWorkflow = readFileSync(
  ".github/workflows/ebay-commercial-preview-monitor.yml", "utf8")
const pilotWorkflow = readFileSync(
  ".github/workflows/ebay-same-day-pilot-preview.yml", "utf8")

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}

class FakeLockManager {
  active = false
  queue = []

  request(_name, options, callback) {
    if (options?.ifAvailable) {
      return Promise.resolve(callback(this.active ? null : {}))
    }
    return new Promise((resolve, reject) => {
      const execute = () => {
        if (options?.signal?.aborted) {
          reject(options.signal.reason ?? new Error("ABORTED"))
          return
        }
        this.active = true
        Promise.resolve(callback({})).then(resolve, reject).finally(() => {
          this.active = false
          this.queue.shift()?.()
        })
      }
      if (this.active) this.queue.push(execute)
      else execute()
    })
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function controller(options = {}) {
  return workload.createSellerOsBackgroundWorkloadControllerV1({
    producer: "PRODUCT_RESEARCH",
    storage: new MemoryStorage(),
    random: () => .5,
    ...options,
  })
}

test("SINGLE_BROWSER_LEADER_PASS", async () => {
  const locks = new FakeLockManager()
  const firstDone = deferred()
  const secondDone = deferred()
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const entered = []
  const first = workload.holdSellerOsCrossTabBrowserLeaderV1({
    scope: "PRODUCT_RESEARCH", signal: firstAbort.signal, locks,
    run: async () => { entered.push("first"); await firstDone.promise },
  })
  const second = workload.holdSellerOsCrossTabBrowserLeaderV1({
    scope: "PRODUCT_RESEARCH", signal: secondAbort.signal, locks,
    run: async () => { entered.push("second"); await secondDone.promise },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(entered, ["first"])
  firstDone.resolve()
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(entered, ["first", "second"])
  secondDone.resolve()
  await second
})

test("SECOND_TAB_NO_DUPLICATE_CLAIM_PASS", async () => {
  const locks = new FakeLockManager()
  const active = deferred()
  const abort = new AbortController()
  const leader = workload.holdSellerOsCrossTabBrowserLeaderV1({
    scope: "LUNA_SHIPPING", signal: abort.signal, locks,
    run: () => active.promise,
  })
  await new Promise((resolve) => setImmediate(resolve))
  let claims = 0
  const follower = await workload.trySellerOsCrossTabBrowserLeaderV1({
    scope: "LUNA_SHIPPING", locks,
    run: async () => { claims += 1 },
  })
  assert.equal(follower.acquired, false)
  assert.equal(claims, 0)
  active.resolve()
  await leader
})

test("LEADER_TAKEOVER_PASS", async () => {
  const locks = new FakeLockManager()
  const firstDone = deferred()
  const secondDone = deferred()
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  let leader = "NONE"
  const first = workload.holdSellerOsCrossTabBrowserLeaderV1({
    scope: "PRODUCT_RESEARCH", signal: firstAbort.signal, locks,
    onLeaderState: (state) => { if (state === "BROWSER_LEADER") leader = "A" },
    run: () => firstDone.promise,
  })
  const second = workload.holdSellerOsCrossTabBrowserLeaderV1({
    scope: "PRODUCT_RESEARCH", signal: secondAbort.signal, locks,
    onLeaderState: (state) => { if (state === "BROWSER_LEADER") leader = "B" },
    run: () => secondDone.promise,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(leader, "A")
  firstDone.resolve()
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(leader, "B")
  secondDone.resolve()
  await second
})

test("MULTI_PROFILE_SERVER_LEASE_PASS", () => {
  assert.match(migration,
    /primary key \(marketplace_account_key, worker_family\)/i)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(/i)
  assert.match(migration,
    /where lease\.leader_session_id = excluded\.leader_session_id[\s\S]*?or lease\.lease_expires_at <= v_now/i)
  assert.match(researchRoute,
    /verifySellerOsBrowserWorkloadLeaseV1\([\s\S]*?PRODUCT_RESEARCH/)
  assert.match(shippingRoute,
    /verifySellerOsBrowserWorkloadLeaseV1\([\s\S]*?LUNA_SHIPPING/)
})

test("EMPTY_POLL_BACKOFF_PASS", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((ordinal) =>
    workload.sellerOsEmptyPollBackoffMsV1(ordinal, () => .5)),
  [60_000, 120_000, 240_000, 480_000, 900_000, 900_000])
  const gate = controller()
  assert.equal(gate.acquirePollPermit().allowed, true)
  assert.equal(gate.recordEmptyPoll(), 60_000)
  assert.equal(gate.acquirePollPermit().allowed, true)
  assert.equal(gate.recordEmptyPoll(), 120_000)
})

test("BACKOFF_RESET_ON_REAL_WORK_PASS", () => {
  const gate = controller()
  gate.acquirePollPermit()
  gate.recordEmptyPoll()
  gate.acquirePollPermit()
  gate.recordEmptyPoll()
  gate.acquirePollPermit()
  gate.recordClaimedJobs(1)
  assert.equal(gate.metrics().currentBackoffMs, 0)
  assert.equal(gate.metrics().claimedJobs, 1)
})

test("JITTER_PASS", () => {
  const low = workload.sellerOsEmptyPollBackoffMsV1(1, () => 0)
  const high = workload.sellerOsEmptyPollBackoffMsV1(1, () => 1)
  assert.equal(low, 54_000)
  assert.equal(high, 66_000)
  assert.ok(workload.sellerOsEmptyPollBackoffMsV1(5, () => 1) <=
    workload.SELLER_OS_BACKGROUND_MAX_CATCHUP_MS)
})

test("HEARTBEAT_TTL_PRESERVED_PASS", () => {
  assert.equal(workload.SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS, 60_000)
  assert.equal(workload.SELLER_OS_BACKGROUND_CAPABILITY_TTL_MS, 300_000)
  assert.match(migration, /p_ttl_seconds integer default 300/)
  assert.match(migration,
    /record_seller_os_browser_worker_heartbeat_v1\([\s\S]*?p_ttl_seconds/)
  assert.match(researchRunner,
    /SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS/)
  assert.match(shippingControl,
    /SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS/)
})

test("DB_DEGRADED_CIRCUIT_BREAKER_PASS", () => {
  let now = 1_000_000
  const gate = controller({ now: () => now })
  gate.acquirePollPermit()
  gate.recordFailure({ httpStatus: 522, errorCode: "HTTP_522" }, now)
  assert.equal(gate.metrics().circuitBreakerState, "OPEN")
  assert.equal(gate.acquirePollPermit(now + 1).allowed, false)
  now += 60_000
  assert.equal(gate.acquirePollPermit(now).halfOpenProbe, true)
  gate.recordProbeSuccess(25, now)
  assert.equal(gate.metrics().circuitBreakerState, "CLOSED")
})

test("DB_DEGRADED_CIRCUIT_BACKOFF_SEQUENCE_PASS", () => {
  let now = 3_000_000
  const gate = controller({ now: () => now })
  const expected = [60_000, 120_000, 300_000, 900_000]
  gate.acquirePollPermit()
  for (const delay of expected) {
    assert.equal(gate.recordFailure({ errorCode: "STATEMENT_TIMEOUT" }, now),
      delay)
    now += delay
    assert.equal(gate.acquirePollPermit(now).halfOpenProbe, true)
  }
})

test("HALF_OPEN_SINGLE_PROBE_PASS", () => {
  let now = 2_000_000
  const gate = controller({ now: () => now })
  gate.acquirePollPermit()
  gate.recordFailure({ httpStatus: 524 }, now)
  now += 60_000
  assert.equal(gate.acquirePollPermit(now).allowed, true)
  const duplicate = gate.acquirePollPermit(now)
  assert.equal(duplicate.allowed, false)
  assert.equal(duplicate.reason, "HALF_OPEN_PROBE_IN_FLIGHT")
})

test("LOST_WAKEUP_CATCHUP_PASS", () => {
  const gate = controller()
  for (let ordinal = 0; ordinal < 12; ordinal += 1) {
    gate.acquirePollPermit()
    gate.recordEmptyPoll()
  }
  assert.equal(gate.nextDelayMs(), 900_000)
  assert.equal(workload.SELLER_OS_BACKGROUND_MAX_CATCHUP_MS, 900_000)
  assert.doesNotMatch(researchRunner, /Realtime.*required|event.only/i)
})

test("LEASE_EXPIRY_RECOVERY_PASS", () => {
  assert.match(migration, /lease_expires_at <= v_now/)
  assert.match(migration, /lease_generation \+ 1/)
  assert.match(migration, /p_claim_authority_lease_seconds not between 120 and 180/)
  assert.doesNotMatch(migration, /pg_advisory_lock\(/i)
})

test("NO_DUPLICATE_JOB_PROCESSING_PASS", () => {
  assert.match(researchClaim, /for update[\s\S]*skip locked/i)
  assert.match(researchClaim, /pg_advisory_xact_lock/i)
  assert.match(shippingClaim, /primary key \(account_key, candidate_id\)/i)
  assert.match(researchRoute, /suppressedDuplicatePoll: true/)
  assert.match(shippingRoute, /NONE_SERVER_LEADER_SUPPRESSED/)
  assert.doesNotMatch(migration,
    /create or replace function public\.claim_next_live_listing_product_research_v2/)
  assert.doesNotMatch(migration,
    /create or replace function public\.claim_seller_os_luna_shipping_job_v1/)
})

test("ROLLBACK_SAFETY_PASS", () => {
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.doesNotMatch(migration, /pg_advisory_lock\(/)
  assert.doesNotMatch(migration, /disable trigger|drop trigger|truncate/i)
  assert.match(migration,
    /A failure anywhere in this RPC rolls both writes back/)
  assert.match(migration,
    /revoke all on function public\.record_seller_os_browser_worker_heartbeat_v2[\s\S]*?from public, anon, authenticated/)
})

test("LOCAL_PRODUCER_METRICS_PASS", () => {
  const published = []
  const gate = controller({ publish: (metrics) => published.push(metrics) })
  gate.setLeaderState("BROWSER_LEADER")
  gate.acquirePollPermit()
  gate.recordEmptyPoll()
  gate.suppressDuplicatePoll()
  const metrics = gate.metrics()
  assert.equal(metrics.polls, 1)
  assert.equal(metrics.emptyPolls, 1)
  assert.equal(metrics.claimedJobs, 0)
  assert.equal(metrics.suppressedDuplicatePolls, 1)
  assert.equal(metrics.currentBackoffMs, 60_000)
  assert.equal(metrics.leaderState, "BROWSER_LEADER")
  assert.equal(metrics.circuitBreakerState, "CLOSED")
  assert.ok(published.length >= 3)
})

test("CRON_STAGGERING_PHASE_A_PASS", () => {
  for (const schedule of [
    "1-59/5 * * * *", "2-59/5 * * * *", "3-59/5 * * * *",
    "4-59/5 * * * *", "5-59/15 * * * *", "7-59/15 * * * *",
    "9-59/15 * * * *", "12-59/15 * * * *", "2 9 * * *",
    "6 9 * * *",
  ]) assert.match(migration, new RegExp(schedule.replaceAll("*", "\\*")))
  assert.match(monitoringWorkflow, /cron: "1-59\/5 \* \* \* \*"/)
  assert.match(monitoringWorkflow, /cron: "3-59\/5 \* \* \* \*"/)
  assert.match(monitoringWorkflow, /cron: "4-59\/5 \* \* \* \*"/)
  assert.match(pilotWorkflow, /cron: "0-59\/5 \* \* \* \*"/)
  assert.doesNotMatch(migration, /cron\.unschedule/)
})

test("PHASE_A_CALLERS_USE_THE_SHARED_GATE", () => {
  assert.match(researchRunner, /holdSellerOsCrossTabBrowserLeaderV1/)
  assert.match(researchFallback, /trySellerOsCrossTabBrowserLeaderV1/)
  assert.match(researchFallback, /controller\.recordEmptyPoll/)
  assert.match(shippingControl, /holdSellerOsCrossTabBrowserLeaderV1/)
  assert.match(shippingControl, /workloadController\.recordEmptyPoll/)
  assert.match(shippingControl, /workloadController\.recordFailure/)
  assert.match(shippingControl, /serverClaimLeaderRef/)
})

test("SERVER_LEASE_CAS_AND_ROLLBACK_EXECUTE_LOCALLY", async () => {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema cron;
    create table cron.job(jobid bigint primary key, jobname text);
    create function cron.alter_job(job_id bigint, schedule text)
      returns void language sql as $$ select; $$;
    create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql stable as $$ select true; $$;
    create function public.record_seller_os_browser_worker_heartbeat_v1(
      p_marketplace_account_key text,
      p_worker_family text,
      p_worker_instance_id text,
      p_extension_version text,
      p_extension_identity_match boolean,
      p_worker_state text,
      p_observed_at timestamptz,
      p_ttl_seconds integer default 300
    ) returns jsonb language sql as $$
      select jsonb_build_object(
        'heartbeatSource', 'INDEPENDENT_WORKER_LIVENESS',
        'capabilityFresh', true,
        'marketplaceWrites', 0,
        'observedAt', p_observed_at,
        'freshUntil', p_observed_at + make_interval(secs => p_ttl_seconds)
      );
    $$;
    create table public.seller_os_post_runtime_scheduler_v1(
      lane text primary key,
      schedule text not null,
      updated_at timestamptz not null default clock_timestamp()
    );
  `)
  await db.exec(migration)
  const account = "account:sha256:0000000000000000000000000000000000000000000000000000000000000000"
  const workerA = "product-research-browser:11111111-1111-4111-8111-111111111111"
  const workerB = "product-research-browser:22222222-2222-4222-8222-222222222222"
  const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const heartbeat = async (worker, session) => (await db.query(`
    select public.record_seller_os_browser_worker_heartbeat_v2(
      $1, 'PRODUCT_RESEARCH', $2, '1.0.0', true, 'IDLE',
      clock_timestamp(), $3::uuid, 300, 150
    ) as receipt
  `, [account, worker, session])).rows[0].receipt
  const first = await heartbeat(workerA, sessionA)
  const competing = await heartbeat(workerB, sessionB)
  assert.equal(first.claimAuthorityGranted, true)
  assert.equal(competing.claimAuthorityGranted, false)
  assert.equal(first.claimAuthorityLeaseGeneration, 1)

  const verify = (worker, session) => db.query(`
    select public.verify_seller_os_browser_workload_lease_v1(
      $1, 'PRODUCT_RESEARCH', $2, $3::uuid, clock_timestamp()
    ) as receipt
  `, [account, worker, session])
  assert.equal((await verify(workerA, sessionA)).rows[0]
    .receipt.claimAuthorityGranted, true)
  assert.equal((await verify(workerB, sessionB)).rows[0]
    .receipt.claimAuthorityGranted, false)

  await db.query(`update public.seller_os_browser_workload_leases_v1
    set acquired_at = clock_timestamp() - interval '4 minutes',
        renewed_at = clock_timestamp() - interval '3 minutes',
        lease_expires_at = clock_timestamp() - interval '1 second'
    where marketplace_account_key = $1 and worker_family = 'PRODUCT_RESEARCH'`,
  [account])
  const takeover = await heartbeat(workerB, sessionB)
  assert.equal(takeover.claimAuthorityGranted, true)
  assert.equal(takeover.claimAuthorityLeaseGeneration, 2)

  const rollbackAccount = `${account}:rollback`
  await db.exec("begin")
  await heartbeat(workerA, sessionA).then(async () => {
    await db.query(`update public.seller_os_browser_workload_leases_v1
      set marketplace_account_key = $1
      where marketplace_account_key = $2`, [rollbackAccount, account])
  })
  await db.exec("rollback")
  const rolledBack = await db.query(`select count(*)::integer as count
    from public.seller_os_browser_workload_leases_v1
    where marketplace_account_key = $1`, [rollbackAccount])
  assert.equal(rolledBack.rows[0].count, 0)
  await db.close()
})
