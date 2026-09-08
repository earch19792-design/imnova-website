import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test, { after, before } from "node:test"
import { PGlite } from "@electric-sql/pglite"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const policy = await import(
  "../seller-os/economic-shipping-refresh-reclaim-loop-v1.ts")
const phaseAMigration = readFileSync(
  "supabase/migrations/20260908142459_seller_os_background_workload_optimization_v1_phase_a.sql",
  "utf8")
const migration = readFileSync(
  "supabase/migrations/20260908155651_seller_os_economic_shipping_refresh_reclaim_loop_fix_v1.sql",
  "utf8")
const server = readFileSync(
  "lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
const control = readFileSync(
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  "utf8")
const runtime = readFileSync(
  "lib/seller-os/economic-evidence-refresh-runtime-v1.ts", "utf8")

let db
before(async () => {
  db = new PGlite()
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
    select jsonb_build_object('capabilityFresh', true,
      'observedAt', p_observed_at,
      'freshUntil', p_observed_at + make_interval(secs => p_ttl_seconds));
  $$;
  create table public.seller_os_post_runtime_scheduler_v1(
    lane text primary key,
    schedule text not null,
    updated_at timestamptz not null default clock_timestamp()
  );
  create table public.seller_os_economic_evidence_refresh_jobs_v1(
    job_id uuid primary key,
    idempotency_key text not null unique,
    marketplace_account_key text not null,
    marketplace_id text not null default 'EBAY_US',
    ebay_item_id text not null,
    evidence_type text not null,
    source_identity jsonb not null default '{}'::jsonb,
    status text not null,
    last_evidence_id text,
    failure_class text,
    next_retry_at timestamptz,
    attempt_count integer not null default 0,
    lease_owner text,
    lease_expires_at timestamptz,
    first_detected_at timestamptz not null default clock_timestamp(),
    last_detected_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
  );
  create table public.seller_os_luna_shipping_job_claims(
    account_key text not null,
    candidate_id text not null,
    snapshot_digest text not null,
    runtime_instance_id uuid not null,
    capture_session_id uuid not null unique,
    status text not null,
    claimed_at timestamptz not null,
    lease_expires_at timestamptz not null,
    completed_at timestamptz,
    updated_at timestamptz not null,
    primary key(account_key,candidate_id)
  );
  `)
  await db.exec(phaseAMigration)
  await db.exec(migration)
})
after(async () => db.close())

const ACCOUNT =
  "account:sha256:0000000000000000000000000000000000000000000000000000000000000000"
const WORKER_A = "11111111-1111-4111-8111-111111111111"
const WORKER_B = "22222222-2222-4222-8222-222222222222"
const CANDIDATE_A = `sha256:${"a".repeat(64)}`
const CANDIDATE_B = `sha256:${"b".repeat(64)}`
const SNAPSHOT = `sha256:${"c".repeat(64)}`

let sequence = 1
function uuid() {
  const suffix = String(sequence++).padStart(12, "0")
  return `00000000-0000-4000-8000-${suffix}`
}

async function insertEconomic(overrides = {}) {
  const jobId = overrides.jobId ?? uuid()
  await db.query(`insert into public.seller_os_economic_evidence_refresh_jobs_v1(
    job_id,idempotency_key,marketplace_account_key,ebay_item_id,evidence_type,
    status,attempt_count,first_detected_at,last_detected_at,updated_at
  ) values($1,$2,$3,$4,'LUNA_CURRENT_SHIPPING',$5,$6,
    clock_timestamp()-interval '10 minutes',clock_timestamp(),clock_timestamp())`,
  [jobId, `job:${jobId}`, ACCOUNT, overrides.itemId ?? "123456789012",
    overrides.status ?? "STALE", overrides.attemptCount ?? 0])
  return jobId
}

function generation(jobId, requiredEvidenceAfter = "2026-09-08T12:00:00Z") {
  return policy.economicShippingFreshnessGenerationV1({
    jobId, accountKey: ACCOUNT, ebayItemId: "123456789012",
    lunaProductId: "9266387058912", lunaVariantId: "48907793826016",
    sourceSku: "ITEM1046", requiredEvidenceAfter,
  })
}

async function admit({ jobId, candidate = CANDIDATE_A, worker = WORKER_A,
  freshnessGeneration = generation(jobId), captureSessionId = uuid(),
  reuse = false }) {
  return (await db.query(`select
    public.admit_seller_os_economic_shipping_refresh_v1(
      $1::uuid,$2,$3,$4,$5::uuid,$6,$7::timestamptz,$8,180,5
    ) as receipt`, [jobId, worker, candidate, SNAPSHOT, captureSessionId,
    freshnessGeneration, "2026-09-08T12:00:00Z", reuse])).rows[0].receipt
}

test("COMPLETED_SAME_SNAPSHOT_FRESH_REUSE_PASS", async () => {
  const now = Date.parse("2026-09-08T13:00:00Z")
  assert.equal(policy.reusableEconomicShippingEvidenceV1({
    evidence: { observedAt: "2026-09-08T12:30:00Z",
      maximumAgeSeconds: 21_600 },
    requiredEvidenceAfter: "2026-09-08T12:00:00Z",
    bindingMatches: true, now,
  }), true)
  const jobId = await insertEconomic()
  const receipt = await admit({ jobId, reuse: true })
  assert.equal(receipt.admitted, true)
  assert.equal(receipt.reasonCode, "FRESH_EVIDENCE_REUSE_ADMITTED")
  assert.match(server,
    /reuseFresh[\s\S]*?finish_seller_os_economic_refresh_job_v1/)
})

test("COMPLETED_SAME_SNAPSHOT_STALE_REQUIRES_NEW_GENERATION_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789013" })
  const oldGeneration = `economic-shipping-refresh-v1:sha256:${"1".repeat(64)}`
  await db.query(`insert into public.seller_os_luna_shipping_job_claims(
    account_key,candidate_id,snapshot_digest,runtime_instance_id,
    capture_session_id,status,claimed_at,lease_expires_at,completed_at,
    updated_at,freshness_generation,required_evidence_after
  ) values($1,$2,$3,$4::uuid,$5::uuid,'COMPLETED',clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp(),
    $6,'2026-09-08T11:00:00Z')`,
  [ACCOUNT, CANDIDATE_B, SNAPSHOT, WORKER_A, uuid(), oldGeneration])
  const nextGeneration = generation(jobId)
  const receipt = await admit({ jobId, candidate: CANDIDATE_B,
    freshnessGeneration: nextGeneration })
  assert.equal(receipt.admitted, true)
  const claim = (await db.query(`select status,freshness_generation
    from public.seller_os_luna_shipping_job_claims
    where account_key=$1 and candidate_id=$2`, [ACCOUNT, CANDIDATE_B])).rows[0]
  assert.equal(claim.status, "CLAIMED")
  assert.equal(claim.freshness_generation, nextGeneration)
})

test("SECONDARY_CLAIM_REJECT_DOES_NOT_ABANDON_ECONOMIC_JOB_PASS", async () => {
  const firstJob = await insertEconomic({ itemId: "123456789014" })
  const firstGeneration = generation(firstJob)
  assert.equal((await admit({ jobId: firstJob, candidate: CANDIDATE_A,
    freshnessGeneration: firstGeneration })).admitted, true)
  const secondJob = await insertEconomic({ itemId: "123456789015" })
  const rejected = await admit({ jobId: secondJob, candidate: CANDIDATE_A,
    freshnessGeneration: generation(secondJob), worker: WORKER_B })
  assert.equal(rejected.admitted, false)
  const row = (await db.query(`select status,lease_owner,failure_class
    from public.seller_os_economic_evidence_refresh_jobs_v1 where job_id=$1`,
  [secondJob])).rows[0]
  assert.equal(row.status, "FAILED_RETRYABLE")
  assert.equal(row.lease_owner, null)
  assert.equal(row.failure_class, "ECONOMIC_SHIPPING_EXECUTOR_ADMISSION_CONFLICT")
})

test("IDENTITY_RESOLUTION_FAILURE_CLOSES_DURABLY_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789016" })
  const receipt = (await db.query(`select
    public.close_seller_os_economic_shipping_preclaim_v1(
      $1::uuid,'LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED',false,5
    ) as receipt`, [jobId])).rows[0].receipt
  assert.equal(receipt.status, "FAILED_TERMINAL")
  const row = (await db.query(`select status,dead_letter_at,lease_owner
    from public.seller_os_economic_evidence_refresh_jobs_v1 where job_id=$1`,
  [jobId])).rows[0]
  assert.equal(row.status, "FAILED_TERMINAL")
  assert.ok(row.dead_letter_at)
  assert.equal(row.lease_owner, null)
})

test("EXECUTOR_MISSING_RETRYABLE_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789017" })
  const freshnessGeneration = generation(jobId)
  await admit({ jobId, candidate: `sha256:${"d".repeat(64)}`,
    freshnessGeneration })
  const receipt = (await db.query(`select
    public.fail_seller_os_economic_shipping_refresh_v1(
      $1::uuid,$2,$3,'LUNA_SHIPPING_EXECUTOR_MISSING',true,5
    ) as receipt`, [jobId, WORKER_A, freshnessGeneration])).rows[0].receipt
  assert.equal(receipt.status, "FAILED_RETRYABLE")
  const row = (await db.query(`select lease_owner,next_retry_at
    from public.seller_os_economic_evidence_refresh_jobs_v1 where job_id=$1`,
  [jobId])).rows[0]
  assert.equal(row.lease_owner, null)
  assert.ok(row.next_retry_at)
  const claim = (await db.query(`select lease_expires_at <= clock_timestamp()
      as released from public.seller_os_luna_shipping_job_claims
      where freshness_generation=$1`, [freshnessGeneration])).rows[0]
  assert.equal(claim.released, true)
  assert.match(route, /report_economic_shipping_failure/)
  assert.match(control, /economicFailureCloseStarted/)
})

test("LEASE_EXPIRY_NO_RECLAIM_LOOP_PASS", () => {
  const decision = policy.economicShippingExpiredLeaseDecisionV1({
    attemptCount: 2, leaseExpiresAt: "2026-09-08T12:00:00Z",
    now: Date.parse("2026-09-08T12:01:00Z"),
  })
  assert.equal(decision.status, "FAILED_RETRYABLE")
  assert.equal(decision.backoffMinutes, 2)
  assert.match(runtime,
    /expiredShippingDecision[\s\S]*?ECONOMIC_SHIPPING_EXECUTOR_LEASE_EXPIRED/)
  assert.match(runtime, /expiredShippingDecision\?\.nextRetryAt/)
  assert.match(runtime,
    /expiredShippingDecision[\s\S]*?lease_owner: null, lease_expires_at: null/)
})

test("MAX_ATTEMPTS_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789018",
    attemptCount: 4 })
  const freshnessGeneration = generation(jobId)
  await admit({ jobId, candidate: `sha256:${"e".repeat(64)}`,
    freshnessGeneration })
  const receipt = (await db.query(`select
    public.fail_seller_os_economic_shipping_refresh_v1(
      $1::uuid,$2,$3,'LUNA_SHIPPING_EXECUTOR_MISSING',true,5
    ) as receipt`, [jobId, WORKER_A, freshnessGeneration])).rows[0].receipt
  assert.equal(receipt.status, "FAILED_TERMINAL")
  assert.equal(receipt.deadLetter, true)
})

test("BACKOFF_PASS", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((attemptCount) =>
    policy.economicShippingRetryDecisionV1({ attemptCount,
      now: Date.parse("2026-09-08T12:00:00Z") }).backoffMinutes),
  [1, 2, 4, 8, null])
  assert.match(migration,
    /when p_attempt <= 1 then 1[\s\S]*?when p_attempt = 4 then 8[\s\S]*?else 15/)
})

test("DEAD_LETTER_PASS", () => {
  const result = policy.economicShippingRetryDecisionV1({ attemptCount: 5 })
  assert.equal(result.deadLetter, true)
  assert.equal(result.nextRetryAt, null)
  assert.match(migration, /dead_letter_at/)
  assert.match(migration, /ECONOMIC_SHIPPING_MAX_ATTEMPTS_EXHAUSTED/)
})

test("ONE_JOB_FAILURE_DOES_NOT_BLOCK_BATCH_PASS", async () => {
  assert.equal(policy.SELLER_OS_ECONOMIC_SHIPPING_BATCH_LIMIT_V1, 1)
  assert.match(server,
    /catch \(error\)[\s\S]*?close_seller_os_economic_shipping_preclaim_v1[\s\S]*?claimFailureCount \+= 1/)
  assert.match(server, /for \(const row of rows\)/)
})

test("LEADER_HEARTBEAT_AUTHORITY_PASS", async () => {
  const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const heartbeat = (worker, session) => db.query(`select
    public.record_seller_os_browser_worker_heartbeat_v2(
      $1,'LUNA_SHIPPING',$2,'1.0.0',true,'IDLE',clock_timestamp(),
      $3::uuid,300,150) as receipt`, [ACCOUNT, worker, session])
  assert.equal((await heartbeat("shipping-browser-a", sessionA)).rows[0]
    .receipt.claimAuthorityGranted, true)
  assert.equal((await heartbeat("shipping-browser-b", sessionB)).rows[0]
    .receipt.claimAuthorityGranted, false)
  const leader = (await db.query(`select leader_session_id::text
    from public.seller_os_browser_workload_leader_heartbeats_v1
    where marketplace_account_key=$1 and worker_family='LUNA_SHIPPING'`,
  [ACCOUNT])).rows[0]
  assert.equal(leader.leader_session_id, sessionA)
})

test("NO_DUPLICATE_SHIPPING_CAPTURE_PASS", () => {
  assert.match(migration, /primary key \(marketplace_account_key, worker_family\)/)
  assert.match(migration,
    /on conflict \(account_key, candidate_id\)[\s\S]*?where \(claim\.status = 'COMPLETED'[\s\S]*?freshness_generation is distinct from/)
  assert.match(server,
    /capture_session_id[\s\S]*?freshness_generation[\s\S]*?required_evidence_after/)
  assert.match(server,
    /LUNA_ECONOMIC_SHIPPING_SECONDARY_FINISH_FAILED[\s\S]*?finish_seller_os_economic_refresh_job_v1/)
})

test("NO_LOST_JOB_PASS", async () => {
  const rows = (await db.query(`select status,lease_owner,lease_expires_at
    from public.seller_os_economic_evidence_refresh_jobs_v1
    where status in ('FAILED_RETRYABLE','FAILED_TERMINAL')`)).rows
  assert.ok(rows.length >= 3)
  assert.ok(rows.every((row) => row.lease_owner === null &&
    row.lease_expires_at === null))
  assert.doesNotMatch(migration, /delete from|truncate/i)
})

test("ROLLBACK_SAFETY_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789019" })
  const before = (await db.query(`select row_to_json(job) as value from
    public.seller_os_economic_evidence_refresh_jobs_v1 job where job_id=$1`,
  [jobId])).rows[0].value
  await db.exec("begin")
  const receipt = await admit({ jobId, candidate: `sha256:${"f".repeat(64)}` })
  assert.equal(receipt.admitted, true)
  await db.exec("rollback")
  const afterRollback = (await db.query(`select row_to_json(job) as value from
    public.seller_os_economic_evidence_refresh_jobs_v1 job where job_id=$1`,
  [jobId])).rows[0].value
  assert.deepEqual(afterRollback, before)
  assert.doesNotMatch(migration, /disable trigger|drop trigger|truncate/i)
})

test("CONCURRENT_CREATE_OR_REUSE_PRESERVES_AUTHORITY_PASS", async () => {
  const jobId = await insertEconomic({ itemId: "123456789020" })
  const candidate = `sha256:${"9".repeat(64)}`
  const receipts = await Promise.all([
    admit({ jobId, candidate, worker: WORKER_A }),
    admit({ jobId, candidate, worker: WORKER_B }),
  ])
  assert.equal(receipts.filter((receipt) => receipt.admitted === true).length, 1)
  const active = (await db.query(`select count(*)::integer as count from
    public.seller_os_luna_shipping_job_claims where account_key=$1
    and candidate_id=$2 and status='CLAIMED'`, [ACCOUNT, candidate])).rows[0]
  assert.equal(active.count, 1)
  assert.match(migration,
    /from public\.seller_os_economic_evidence_refresh_jobs_v1[\s\S]*?for update/)
})
