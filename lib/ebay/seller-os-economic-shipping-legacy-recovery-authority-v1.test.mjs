import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test, { after, before } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

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
  "../seller-os/economic-shipping-legacy-recovery-authority-v1.ts")
const phaseA = readFileSync(
  "supabase/migrations/20260908142459_seller_os_background_workload_optimization_v1_phase_a.sql",
  "utf8")
const b618 = readFileSync(
  "supabase/migrations/20260908155651_seller_os_economic_shipping_refresh_reclaim_loop_fix_v1.sql",
  "utf8")
const migration = readFileSync(
  "supabase/migrations/20260908164222_seller_os_economic_shipping_legacy_recovery_authority_v1.sql",
  "utf8")
const cohortMigration = readFileSync(
  "supabase/migrations/20260908203000_legacy_shipping_incident_cohort_boundary_v1.sql",
  "utf8")
const dispositionMigration = readFileSync(
  "supabase/migrations/20260909082500_seller_os_legacy_shipping_out_of_scope_disposition_contract_v2.sql",
  "utf8")
const server = readFileSync(
  "lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
const control = readFileSync(
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  "utf8")

const ACCOUNT =
  "account:sha256:0000000000000000000000000000000000000000000000000000000000000000"
const WORKER_A = "11111111-1111-4111-8111-111111111111"
const WORKER_B = "22222222-2222-4222-8222-222222222222"
const LEADER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SNAPSHOT = `sha256:${"b".repeat(64)}`
const FRESHNESS = `economic-shipping-refresh-v1:sha256:${"c".repeat(64)}`
const EVIDENCE_ID = `economic-evidence-v1:sha256:${"d".repeat(64)}`
const REQUIRED_AFTER = "2026-09-08T16:00:00Z"
const PRODUCT_ROW_ID = "33333333-3333-4333-8333-333333333333"
const PRODUCT_ID = "9266387058912"
const VARIANT_ID = "48907793826016"
const SKU = "ITEM1046"
const LINKAGE_ID = `luna-linkage-v1:sha256:${"e".repeat(64)}`
const INCIDENT_ACCOUNT =
  "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12"
const INCIDENT_COHORT =
  "legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba"
const INCIDENT_OUT_OF_SCOPE_JOB = "7863fcfc-4229-487b-9173-aeb52e3d033f"

let db
let sequence = 1
function uuid() {
  const suffix = String(sequence++).padStart(12, "0")
  return `00000000-0000-4000-8000-${suffix}`
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create extension if not exists pgcrypto;
    create schema extensions;
    create function extensions.gen_random_uuid() returns uuid
      language sql as $$ select gen_random_uuid(); $$;
    create function extensions.digest(bytea,text) returns bytea
      language sql as $$ select public.digest($1,$2); $$;
    create schema cron;
    create table cron.job(jobid bigint primary key, jobname text);
    create function cron.alter_job(job_id bigint, schedule text)
      returns void language sql as $$ select; $$;
    create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql stable as $$ select true; $$;
    create function public.record_seller_os_browser_worker_heartbeat_v1(
      p_marketplace_account_key text, p_worker_family text,
      p_worker_instance_id text, p_extension_version text,
      p_extension_identity_match boolean, p_worker_state text,
      p_observed_at timestamptz, p_ttl_seconds integer default 300
    ) returns jsonb language sql as $$
      select jsonb_build_object('capabilityFresh',true,
        'observedAt',p_observed_at,
        'freshUntil',p_observed_at+make_interval(secs=>p_ttl_seconds));
    $$;
    create table public.seller_os_post_runtime_scheduler_v1(
      lane text primary key, schedule text not null,
      updated_at timestamptz not null default clock_timestamp());
    create table public.seller_os_economic_evidence_refresh_jobs_v1(
      job_id uuid primary key, idempotency_key text not null unique,
      marketplace_account_key text not null,
      marketplace_id text not null default 'EBAY_US',
      ebay_item_id text not null, evidence_type text not null,
      source_identity jsonb not null default '{}'::jsonb,
      status text not null, last_evidence_id text, failure_class text,
      next_retry_at timestamptz, attempt_count integer not null default 0,
      lease_owner text, lease_expires_at timestamptz,
      first_detected_at timestamptz not null default clock_timestamp(),
      last_detected_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp());
    create table public.seller_os_luna_shipping_job_claims(
      account_key text not null, candidate_id text not null,
      snapshot_digest text not null, runtime_instance_id uuid not null,
      capture_session_id uuid not null unique, status text not null,
      claimed_at timestamptz not null, lease_expires_at timestamptz not null,
      completed_at timestamptz, updated_at timestamptz not null,
      primary key(account_key,candidate_id));
    create table public.ebay_active_listings(
      id uuid primary key, account_key text not null, ebay_item_id text not null,
      listing_status text not null, updated_at timestamptz not null,
      market_radar_product_id uuid, supplier_variant_id text,
      supplier_sku text);
    create table public.seller_os_luna_linkage_decisions(
      decision_id text primary key, account_key text not null,
      marketplace_id text not null, ebay_item_id text not null,
      decision_version integer not null, decision text not null,
      linkage_id text, luna_product_id text, luna_variant_id text,
      luna_sku text);
    create table public.market_radar_latest_variants(
      source_key text not null, supplier_product_id text not null,
      supplier_variant_id text not null, sku text not null,
      product_id uuid not null, product_url text,
      captured_at timestamptz not null);
  `)
  try { await db.exec(phaseA) } catch (error) {
    console.error("PHASE_A_SETUP_FAILED", error)
    throw error
  }
  try { await db.exec(b618) } catch (error) {
    console.error("B618_SETUP_FAILED", error)
    throw error
  }
  try { await db.exec(migration) } catch (error) {
    console.error("LEGACY_RECOVERY_SETUP_FAILED", error)
    throw error
  }
  try { await db.exec(cohortMigration) } catch (error) {
    console.error("INCIDENT_COHORT_SETUP_FAILED", error)
    throw error
  }
  try { await db.exec(dispositionMigration) } catch (error) {
    console.error("OUT_OF_SCOPE_DISPOSITION_V2_SETUP_FAILED", error)
    throw error
  }
  await db.query(`select public.record_seller_os_browser_worker_heartbeat_v2(
    $1,'LUNA_SHIPPING',$2,'2.0.0',true,'IDLE',clock_timestamp(),
    $3::uuid,300,150)`, [ACCOUNT, WORKER_A, LEADER_A])
})
after(async () => db.close())

async function insertLegacyJob({ active = true, attempts = 20,
  itemId = String(100000000000 + sequence) } = {}) {
  const jobId = uuid()
  await db.query(`insert into public.seller_os_economic_evidence_refresh_jobs_v1(
    job_id,idempotency_key,marketplace_account_key,marketplace_id,ebay_item_id,
    evidence_type,source_identity,status,attempt_count,first_detected_at,
    last_detected_at,updated_at)
  values($1,$2,$3,'EBAY_US',$4,'LUNA_CURRENT_SHIPPING',$5::jsonb,
    'FAILED_RETRYABLE',$6,'2026-09-08T15:00:00Z',clock_timestamp(),
    clock_timestamp())`, [jobId, `legacy:${jobId}`, ACCOUNT, itemId,
    JSON.stringify({ linkageId: LINKAGE_ID, lunaProductId: PRODUCT_ID,
      lunaVariantId: VARIANT_ID, sourceSku: SKU }), attempts])
  if (active) {
    await db.query(`insert into public.ebay_active_listings(
      id,account_key,ebay_item_id,listing_status,updated_at,
      market_radar_product_id,supplier_variant_id,supplier_sku)
    values($1::uuid,$2,$3,'active',clock_timestamp(),$4::uuid,$5,$6)`,
    [uuid(), ACCOUNT, itemId, PRODUCT_ROW_ID, VARIANT_ID, SKU])
  }
  await db.query(`insert into public.seller_os_luna_linkage_decisions(
    decision_id,account_key,marketplace_id,ebay_item_id,decision_version,
    decision,linkage_id,luna_product_id,luna_variant_id,luna_sku)
  values($1,$2,'EBAY_US',$3,1,'APPROVE_EXACT_LINKAGE',$4,$5,$6,$7)`,
  [`decision:${jobId}`, ACCOUNT, itemId, LINKAGE_ID, PRODUCT_ID, VARIANT_ID, SKU])
  return jobId
}

async function ensureVariant() {
  await db.query(`insert into public.market_radar_latest_variants(
    source_key,supplier_product_id,supplier_variant_id,sku,product_id,
    product_url,captured_at)
  select 'lunaportex',$1,$2,$3,$4::uuid,'https://example.invalid/product',
    clock_timestamp() where not exists(select 1 from
      public.market_radar_latest_variants where source_key='lunaportex'
      and supplier_product_id=$1 and supplier_variant_id=$2 and sku=$3)`,
  [PRODUCT_ID, VARIANT_ID, SKU, PRODUCT_ROW_ID])
}

async function classify(jobId) {
  await ensureVariant()
  return (await db.query(`select
    public.classify_seller_os_economic_shipping_legacy_job_v1($1,$2::uuid)
      as receipt`, [ACCOUNT, jobId])).rows[0].receipt
}

async function beginRecovery(jobId, { worker = WORKER_A,
  capture = uuid(), generation, fingerprint, reuse = false } = {}) {
  const classified = fingerprint ? null : await classify(jobId)
  const resolvedFingerprint = fingerprint ?? classified.classificationFingerprint
  const resolvedGeneration = generation ??
    policy.sellerOsEconomicShippingLegacyRecoveryGenerationV1({
      accountKey: ACCOUNT, jobId,
      classificationFingerprint: resolvedFingerprint,
    })
  const candidate = `sha256:${jobId.replaceAll("-", "").padEnd(64, "0")}`
  const receipt = (await db.query(`select
    public.begin_seller_os_economic_shipping_legacy_recovery_v1(
      $1,$2::uuid,$3,$4::uuid,$5,false,0,true,true,$6,$7,$8,$9,
      $10::uuid,$11,$12::timestamptz,$13,900,5) as receipt`,
  [ACCOUNT, jobId, worker, LEADER_A,
    policy.SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1,
    resolvedFingerprint, resolvedGeneration, candidate, SNAPSHOT, capture,
    FRESHNESS, REQUIRED_AFTER, reuse])).rows[0].receipt
  return { receipt, generation: resolvedGeneration,
    fingerprint: resolvedFingerprint, capture }
}

test("LEGACY_ATTEMPT_HISTORY_PRESERVED_PASS and RECOVERY_COUNTER_SEPARATE_PASS",
  async () => {
    const jobId = await insertLegacyJob({ attempts: 27 })
    const { receipt } = await beginRecovery(jobId)
    assert.equal(receipt.admitted, true)
    assert.equal(receipt.historicalAttemptCount, 27)
    assert.equal(receipt.recoveryAttemptOrdinal, 1)
    const row = (await db.query(`select job.attempt_count,
      recovery.historical_attempt_count,recovery.recovery_attempt_count
      from public.seller_os_economic_evidence_refresh_jobs_v1 job join
      public.seller_os_economic_shipping_legacy_recoveries_v1 recovery
      on recovery.job_id=job.job_id where job.job_id=$1`, [jobId])).rows[0]
    assert.deepEqual(row, { attempt_count: 27, historical_attempt_count: 27,
      recovery_attempt_count: 1 })
  })

test("RECOVERY_MAX_5_PASS, RECOVERY_BACKOFF_PASS and RECOVERY_DEAD_LETTER_PASS",
  async () => {
    const jobId = await insertLegacyJob({ attempts: 31 })
    let context
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      context = await beginRecovery(jobId, context ? {
        generation: context.generation, fingerprint: context.fingerprint,
      } : {})
      assert.equal(context.receipt.admitted, true)
      const failed = (await db.query(`select
        public.fail_seller_os_economic_shipping_legacy_recovery_v1(
          $1,$2::uuid,$3,$4,$5,$6,true) as receipt`, [ACCOUNT, jobId,
        WORKER_A, context.generation, FRESHNESS,
        "LEGACY_SHIPPING_RECOVERY_EXECUTOR_MISSING"])).rows[0].receipt
      assert.equal(failed.recoveryAttemptOrdinal, attempt)
      assert.equal(failed.status,
        attempt === 5 ? "FAILED_TERMINAL" : "FAILED_RETRYABLE")
      if (attempt < 5) {
        const delay = (await db.query(`select extract(epoch from
          (recovery_next_retry_at-updated_at))/60 as minutes from
          public.seller_os_economic_shipping_legacy_recoveries_v1
          where job_id=$1`, [jobId])).rows[0].minutes
        assert.equal(Math.round(Number(delay)), [1, 2, 4, 8][attempt - 1])
        await db.query(`update
          public.seller_os_economic_shipping_legacy_recoveries_v1
          set recovery_next_retry_at=clock_timestamp()-interval '1 second'
          where job_id=$1`, [jobId])
        await db.query(`update public.seller_os_economic_evidence_refresh_jobs_v1
          set next_retry_at=clock_timestamp()-interval '1 second'
          where job_id=$1`, [jobId])
      }
    }
    const final = (await db.query(`select status,recovery_attempt_count,
      recovery_dead_letter_at is not null as dead_letter from
      public.seller_os_economic_shipping_legacy_recoveries_v1 where job_id=$1`,
    [jobId])).rows[0]
    assert.deepEqual(final, { status: "FAILED_TERMINAL",
      recovery_attempt_count: 5, dead_letter: true })
  })

test("CAS_SINGLE_JOB_PASS, IDEMPOTENT_RECOVERY_PASS and CONCURRENT_RECOVERY_AUTHORITY_PASS",
  async () => {
    const jobId = await insertLegacyJob()
    const first = await beginRecovery(jobId)
    const same = await beginRecovery(jobId, { generation: first.generation,
      fingerprint: first.fingerprint, capture: first.capture })
    assert.equal(same.receipt.admitted, true)
    assert.equal(same.receipt.idempotent, true)
    await assert.rejects(() => beginRecovery(jobId, { worker: WORKER_B,
      generation: first.generation, fingerprint: first.fingerprint }),
    /RECOVERY_LEADER_UNPROVEN/)
    const rows = (await db.query(`select count(*)::integer count,
      max(recovery_attempt_count)::integer attempts from
      public.seller_os_economic_shipping_legacy_recoveries_v1
      where job_id=$1`, [jobId])).rows[0]
    assert.deepEqual(rows, { count: 1, attempts: 1 })
    assert.match(migration, /pg_advisory_xact_lock[\s\S]*?for update/)
  })

test("LEGACY_RUNTIME_CANNOT_RECLAIM_RECOVERY_JOB_PASS", async () => {
  const jobId = await insertLegacyJob()
  await beginRecovery(jobId)
  await db.query(`update public.seller_os_economic_evidence_refresh_jobs_v1
    set status='FAILED_RETRYABLE',lease_owner=null,lease_expires_at=null,
      next_retry_at=clock_timestamp()-interval '1 second' where job_id=$1`,
  [jobId])
  const claimed = (await db.query(`select job_id from
    public.claim_seller_os_economic_refresh_jobs_v1($1,$2,null,10,180)`,
  [ACCOUNT, WORKER_B])).rows
  assert.equal(claimed.some((row) => row.job_id === jobId), false)
  assert.match(server, /\.is\("shipping_legacy_recovery_generation", null\)/)
})

test("NEW_FRESHNESS_GENERATION_PASS and HANDOFF_TO_B618_PASS", async () => {
  const jobId = await insertLegacyJob({ attempts: 24 })
  const { receipt, generation } = await beginRecovery(jobId)
  assert.equal(receipt.reasonCode,
    "LEGACY_SHIPPING_RECOVERY_B618_HANDOFF_ADMITTED")
  assert.match(receipt.freshnessGeneration,
    /^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$/)
  assert.equal(receipt.recoveryGeneration, generation)
  assert.match(server,
    /finish_seller_os_economic_shipping_legacy_recovery_v1/)
  assert.match(server, /complete_seller_os_luna_shipping_job_v1/)
  assert.match(route, /recover_one_legacy_economic_shipping_job/)
  assert.match(control, /legacyRecoveryGeneration/)
  await db.query(`update public.seller_os_luna_shipping_job_claims
    set status='COMPLETED',completed_at=clock_timestamp(),
      updated_at=clock_timestamp() where freshness_generation=$1`,
  [FRESHNESS])
  const finished = (await db.query(`select
    public.finish_seller_os_economic_shipping_legacy_recovery_v1(
      $1,$2::uuid,$3,$4,$5,$6) as receipt`, [ACCOUNT, jobId, WORKER_A,
    generation, FRESHNESS, EVIDENCE_ID])).rows[0].receipt
  assert.equal(finished.finished, true)
  assert.equal(finished.historicalAttemptCount, 24)
  const final = (await db.query(`select job.status,job.attempt_count,
    recovery.status recovery_status,recovery.legacy_status,
    recovery.legacy_lease_owner,recovery.historical_attempt_count
    from public.seller_os_economic_evidence_refresh_jobs_v1 job join
    public.seller_os_economic_shipping_legacy_recoveries_v1 recovery
    on recovery.job_id=job.job_id where job.job_id=$1`, [jobId])).rows[0]
  assert.deepEqual(final, { status: "FRESH", attempt_count: 24,
    recovery_status: "COMPLETED", legacy_status: "FAILED_RETRYABLE",
    legacy_lease_owner: null, historical_attempt_count: 24 })
})

test("FRESH_EXACT_EVIDENCE_REUSE_PASS", async () => {
  const jobId = await insertLegacyJob({ attempts: 23 })
  const result = await beginRecovery(jobId, { reuse: true })
  assert.equal(result.receipt.admitted, true)
  assert.equal(result.receipt.reuseFreshEvidence, true)
  assert.equal(result.receipt.reasonCode,
    "LEGACY_SHIPPING_RECOVERY_FRESH_EVIDENCE_REUSE_ADMITTED")
  const candidate = `sha256:${jobId.replaceAll("-", "").padEnd(64, "0")}`
  assert.equal((await db.query(`select count(*)::integer count from
    public.seller_os_luna_shipping_job_claims where account_key=$1 and
    candidate_id=$2`, [ACCOUNT, candidate])).rows[0].count, 0)
  assert.match(server,
    /reuseFresh[\s\S]*?finish_seller_os_economic_shipping_legacy_recovery_v1/)
})

test("OUT_OF_SCOPE_CREATES_DISPOSITION_RECEIPT_PASS OUT_OF_SCOPE_CREATES_RECOVERY_ROW_FALSE_PASS",
  async () => {
    await db.query(`insert into public.seller_os_economic_evidence_refresh_jobs_v1(
      job_id,idempotency_key,marketplace_account_key,marketplace_id,
      ebay_item_id,evidence_type,source_identity,status,failure_class,
      attempt_count,first_detected_at,last_detected_at,updated_at)
    values($1::uuid,$2,$3,'EBAY_US','366643126310',
      'LUNA_CURRENT_SHIPPING','{}'::jsonb,'FAILED_TERMINAL',
      'ECONOMIC_SHIPPING_EXECUTOR_LEASE_EXPIRED_MAX_ATTEMPTS',32,
      '2026-09-08T15:00:00Z','2026-09-09T00:37:21.357Z',
      '2026-09-09T00:37:21.357Z')`, [INCIDENT_OUT_OF_SCOPE_JOB,
    `legacy:${INCIDENT_OUT_OF_SCOPE_JOB}`, INCIDENT_ACCOUNT])
    // Current marketplace state is deliberately different from the immutable
    // incident snapshot; V2 must not use it to reinterpret membership.
    await db.query(`insert into public.ebay_active_listings(
      id,account_key,ebay_item_id,listing_status,updated_at)
    values($1::uuid,$2,'366643126310','active',clock_timestamp())`,
    [uuid(), INCIDENT_ACCOUNT])
    const before = (await db.query(`select row_to_json(job) value from
      public.seller_os_economic_evidence_refresh_jobs_v1 job
      where job_id=$1::uuid`, [INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].value
    const receipt = (await db.query(`select
      public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
        $1,$2,$3::uuid) receipt`, [INCIDENT_ACCOUNT, INCIDENT_COHORT,
      INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].receipt
    assert.equal(receipt.closed, true)
    assert.equal(receipt.idempotent, false)
    assert.equal(receipt.economicJobStateMutated, false)
    assert.equal(receipt.recoveryRowCreated, false)
    assert.equal(receipt.recoveryGenerationCreated, false)
    assert.equal(receipt.shippingLegacyRecoveryGenerationCreated, false)
    assert.equal(receipt.chromeDispatchCount, 0)
    assert.equal(receipt.marketplaceWriteCount, 0)
    const afterReceipt = (await db.query(`select row_to_json(job) value from
      public.seller_os_economic_evidence_refresh_jobs_v1 job
      where job_id=$1::uuid`, [INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].value
    assert.deepEqual(afterReceipt, before)
    const persisted = (await db.query(`select disposition,
      incident_classification,disposition_reason,authority_version
      from public.seller_os_legacy_shipping_incident_dispositions_v1
      where cohort_id=$1 and job_id=$2::uuid`, [INCIDENT_COHORT,
      INCIDENT_OUT_OF_SCOPE_JOB])).rows[0]
    assert.deepEqual(persisted, { disposition: "OUT_OF_SCOPE",
      incident_classification: "OUT_OF_SCOPE_NO_ACTIVE_LISTING",
      disposition_reason: "LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED",
      authority_version:
        "SELLER_OS_LEGACY_SHIPPING_OUT_OF_SCOPE_DISPOSITION_CONTRACT_V2" })
    assert.equal((await db.query(`select count(*)::integer count from
      public.seller_os_economic_shipping_legacy_recoveries_v1
      where job_id=$1::uuid`, [INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].count, 0)
    const cohort = (await db.query(`select
      public.read_seller_os_legacy_shipping_incident_cohort_v1($1) receipt`,
    [INCIDENT_COHORT])).rows[0].receipt
    assert.equal(cohort.outOfScopeDisposedCount, 1)
  })

test("IDEMPOTENT_REPLAY_PASS and CONFLICTING_DISPOSITION_FAIL_CLOSED_PASS",
  async () => {
    const replay = (await db.query(`select
      public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
        $1,$2,$3::uuid) receipt`, [INCIDENT_ACCOUNT, INCIDENT_COHORT,
      INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].receipt
    assert.equal(replay.closed, true)
    assert.equal(replay.idempotent, true)
    assert.equal((await db.query(`select count(*)::integer count from
      public.seller_os_legacy_shipping_incident_dispositions_v1
      where cohort_id=$1 and job_id=$2::uuid`, [INCIDENT_COHORT,
      INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].count, 1)
    await assert.rejects(() => db.query(`insert into
      public.seller_os_legacy_shipping_incident_dispositions_v1
      select disposition_id,cohort_id,job_id,disposition,
        incident_classification,incident_membership_digest,
        incident_evidence_digest,source_receipt_id,disposition_reason,
        authority_version,authority_identity,$3,clock_timestamp()
      from public.seller_os_legacy_shipping_incident_dispositions_v1
      where cohort_id=$1 and job_id=$2::uuid`, [INCIDENT_COHORT,
    INCIDENT_OUT_OF_SCOPE_JOB, `sha256:${"f".repeat(64)}`]),
    /duplicate key|unique constraint/i)
  })

test("NON_OUT_OF_SCOPE_MEMBER_REJECTED_PASS", async () => {
  const recoverableJob = "089c26b0-4bed-410d-847f-8eefdeee6fa0"
  await db.query(`insert into public.seller_os_economic_evidence_refresh_jobs_v1(
    job_id,idempotency_key,marketplace_account_key,marketplace_id,
    ebay_item_id,evidence_type,source_identity,status,attempt_count,
    first_detected_at,last_detected_at,updated_at)
  values($1::uuid,$2,$3,'EBAY_US','366649437609',
    'LUNA_CURRENT_SHIPPING','{}'::jsonb,'FRESH',20,
    '2026-09-08T15:00:00Z',clock_timestamp(),clock_timestamp())`,
  [recoverableJob, `legacy:${recoverableJob}`, INCIDENT_ACCOUNT])
  await assert.rejects(() => db.query(`select
    public.close_seller_os_economic_shipping_legacy_out_of_scope_v2(
      $1,$2,$3::uuid)`, [INCIDENT_ACCOUNT, INCIDENT_COHORT, recoverableJob]),
  /OUT_OF_SCOPE_MEMBERSHIP_REQUIRED/)
})

test("RECOVERY_GENERATION_CREATED_FALSE_PASS SHIPPING_LEGACY_RECOVERY_GENERATION_CREATED_FALSE_PASS ATTEMPT_COUNT_UNCHANGED_PASS JOB_NOT_REOPENED_PASS", async () => {
  const job = (await db.query(`select status,attempt_count,lease_owner,
    lease_expires_at,shipping_legacy_recovery_generation
    from public.seller_os_economic_evidence_refresh_jobs_v1
    where job_id=$1::uuid`, [INCIDENT_OUT_OF_SCOPE_JOB])).rows[0]
  assert.deepEqual(job, { status: "FAILED_TERMINAL", attempt_count: 32,
    lease_owner: null, lease_expires_at: null,
    shipping_legacy_recovery_generation: null })
  assert.equal((await db.query(`select count(*)::integer count from
    public.seller_os_economic_shipping_legacy_recoveries_v1
    where job_id=$1::uuid`, [INCIDENT_OUT_OF_SCOPE_JOB])).rows[0].count, 0)
})

test("CHROME_DISPATCH_ZERO_PASS MARKETPLACE_WRITES_ZERO_PASS GENERIC_RECONCILER_NOT_USED_PASS", () => {
  const branch = server.slice(
    server.indexOf("closeLegacyShippingIncidentOutOfScopeDispositionV2"),
    server.indexOf("export async function acquireOneLegacyEconomicShippingRecoveryV1"),
  )
  assert.match(branch, /chromeDispatchCount !== 0/)
  assert.match(branch, /marketplaceWriteCount !== 0/)
  assert.doesNotMatch(branch, /sendCurrent|reconcile|ebay.*write/i)
})

test("COHORT_MEMBERSHIP_IMMUTABLE_PASS CURRENT_MARKETPLACE_STATE_DOES_NOT_REWRITE_INCIDENT_PASS", async () => {
  await assert.rejects(() => db.query(`update
    public.seller_os_legacy_shipping_incident_dispositions_v1
    set disposition_reason='DIFFERENT' where cohort_id=$1 and job_id=$2::uuid`,
  [INCIDENT_COHORT, INCIDENT_OUT_OF_SCOPE_JOB]), /DISPOSITION_IMMUTABLE/)
  assert.doesNotMatch(dispositionMigration,
    /from public\.ebay_active_listings|join public\.ebay_active_listings/i)
  assert.match(dispositionMigration,
    /foreign key \(cohort_id,job_id\)[\s\S]*?incident_members_v1/)
})

test("SELLER_OS_OPERATIONAL_EFFICIENCY_GATE_V1 disposition V2", () => {
  const branch = server.slice(
    server.indexOf("closeLegacyShippingIncidentOutOfScopeDispositionV2"),
    server.indexOf("export async function acquireOneLegacyEconomicShippingRecoveryV1"),
  )
  assert.equal(branch.match(/\.rpc\(/g)?.length, 1)
  assert.doesNotMatch(dispositionMigration, /setInterval|setTimeout/)
  assert.doesNotMatch(dispositionMigration, /count:\s*['\"]exact['\"]/)
  assert.doesNotMatch(dispositionMigration, /select\s+\*/i)
  assert.doesNotMatch(dispositionMigration,
    /update public\.seller_os_economic_evidence_refresh_jobs_v1/i)
  assert.match(dispositionMigration,
    /insert into public\.seller_os_legacy_shipping_incident_dispositions_v1/)
})

test("NO_DUPLICATE_CAPTURE_PASS", async () => {
  const jobId = await insertLegacyJob()
  const first = await beginRecovery(jobId)
  const same = await beginRecovery(jobId, { generation: first.generation,
    fingerprint: first.fingerprint, capture: first.capture })
  assert.equal(same.receipt.idempotent, true)
  const claims = (await db.query(`select count(*)::integer count from
    public.seller_os_luna_shipping_job_claims where account_key=$1 and
    candidate_id=$2`, [ACCOUNT,
    `sha256:${jobId.replaceAll("-", "").padEnd(64, "0")}`])).rows[0].count
  assert.equal(claims, 1)
})

test("ROLLBACK_SAFETY_PASS", async () => {
  const jobId = await insertLegacyJob({ attempts: 26 })
  const before = (await db.query(`select row_to_json(job) value from
    public.seller_os_economic_evidence_refresh_jobs_v1 job where job_id=$1`,
  [jobId])).rows[0].value
  await db.exec("begin")
  const admitted = await beginRecovery(jobId)
  assert.equal(admitted.receipt.admitted, true)
  await db.exec("rollback")
  const afterRollback = (await db.query(`select row_to_json(job) value from
    public.seller_os_economic_evidence_refresh_jobs_v1 job where job_id=$1`,
  [jobId])).rows[0].value
  assert.deepEqual(afterRollback, before)
  assert.equal((await db.query(`select count(*)::integer count from
    public.seller_os_economic_shipping_legacy_recoveries_v1 where job_id=$1`,
  [jobId])).rows[0].count, 0)
  assert.doesNotMatch(migration, /delete from|truncate|disable trigger/i)
})

test("GATE_FAIL_CLOSED_PASS", () => {
  assert.throws(() => policy.certifySellerOsEconomicShippingLegacyRecoveryGateV1({
    legacyShippingRuntimeActive: true, heartbeatV1Total: 0,
    phaseAV2Active: true, b618RuntimeActive: true,
    jobLegacyClassificationProven: true,
  }), /RECOVERY_GATE_FAILED/)
  assert.match(migration,
    /p_legacy_shipping_runtime_active is distinct from false[\s\S]*?p_heartbeat_v1_total<>0[\s\S]*?p_phase_a_v2_active is distinct from true[\s\S]*?p_b618_runtime_active is distinct from true/)
})

test("CONTRACT_STATIC_SAFETY_PASS", () => {
  assert.equal(policy.SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_MAX_ATTEMPTS_V1,
    5)
  assert.deepEqual(
    [...policy.SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_BACKOFF_MINUTES_V1],
    [1, 2, 4, 8, 15])
  assert.equal(
    policy.SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_BATCH_LIMIT_V1, 1)
  assert.match(migration, /historical_attempt_count integer not null/)
  assert.match(migration, /recovery_attempt_count integer not null default 0/)
  assert.match(migration, /runtime_commit_sha =\s*'b618350a9848e8b49f3c0590270afe2d0ec91c14'/)
  assert.doesNotMatch(migration, /set\s+attempt_count\s*=/i)
})
