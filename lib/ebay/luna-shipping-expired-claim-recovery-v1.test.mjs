import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260912231500_luna_shipping_expired_claim_recovery_v1.sql",
  import.meta.url), "utf8")
const server = readFileSync(new URL(
  "./ebay-luna-chrome-shipping-capture-server-v1.ts", import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/luna-shipping-capture/route.ts", import.meta.url), "utf8")
const control = readFileSync(new URL(
  "../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  import.meta.url), "utf8")

const account = `account:${"a".repeat(64)}`
const candidate = `sha256:${"b".repeat(64)}`
const otherCandidate = `sha256:${"c".repeat(64)}`
const snapshot = `sha256:${"d".repeat(64)}`
const otherSnapshot = `sha256:${"e".repeat(64)}`
const worker = "11111111-1111-4111-8111-111111111111"
const leader = "22222222-2222-4222-8222-222222222222"
const oldSession = "33333333-3333-4333-8333-333333333333"
const newSession = "44444444-4444-4444-8444-444444444444"

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists extensions;
    create function extensions.gen_random_uuid() returns uuid language sql volatile
      as 'select md5(random()::text || clock_timestamp()::text)::uuid';
    create role service_role;
    create role anon;
    create role authenticated;
    create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql immutable as 'select true';
    create table public.seller_os_browser_workload_leases_v1(
      marketplace_account_key text not null,worker_family text not null,
      leader_session_id uuid not null,worker_instance_id text not null,
      lease_generation bigint not null default 1,acquired_at timestamptz not null,
      renewed_at timestamptz not null,lease_expires_at timestamptz not null,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      shipping_capture_state text not null default 'UNAVAILABLE',
      shipping_capability_worker_id text,shipping_capability_observed_at timestamptz,
      shipping_capability_transition bigint not null default 0,
      shipping_next_attempt_at timestamptz,primary key(marketplace_account_key,worker_family));
    create table public.seller_os_luna_shipping_job_claims(
      account_key text not null,candidate_id text not null,snapshot_digest text not null,
      runtime_instance_id uuid not null,capture_session_id uuid not null unique,
      status text not null default 'CLAIMED' check(status in('CLAIMED','COMPLETED')),
      claimed_at timestamptz not null,lease_expires_at timestamptz not null,
      completed_at timestamptz,updated_at timestamptz not null,
      freshness_generation text,required_evidence_after timestamptz,
      primary key(account_key,candidate_id));
    create table public.seller_os_profitability_frontier_snapshots(
      frontier_id text primary key,account_key text not null,
      shipping_status text not null,frontier_payload jsonb not null);
    insert into public.seller_os_browser_workload_leases_v1(
      marketplace_account_key,worker_family,leader_session_id,worker_instance_id,
      lease_generation,acquired_at,renewed_at,lease_expires_at,
      shipping_capture_state,shipping_capability_worker_id,
      shipping_capability_observed_at)
    values('${account}','LUNA_SHIPPING','${leader}','${worker}',7,
      clock_timestamp()-interval '1 minute',clock_timestamp(),
      clock_timestamp()+interval '2 minutes','AVAILABLE','${worker}',clock_timestamp());
  `)
  await db.exec(migration)
  return db
}

async function putClaim(db, { active = false, durable = false } = {}) {
  await db.query(`insert into public.seller_os_luna_shipping_job_claims(
    account_key,candidate_id,snapshot_digest,runtime_instance_id,capture_session_id,
    status,claimed_at,lease_expires_at,updated_at)
    values($1,$2,$3,$4::uuid,$5::uuid,'CLAIMED',clock_timestamp()-interval '20 minutes',
      clock_timestamp()+case when $6 then interval '5 minutes' else interval '-5 minutes' end,
      clock_timestamp())`, [account,candidate,snapshot,worker,oldSession,active])
  if (durable) await db.query(`insert into public.seller_os_profitability_frontier_snapshots
    values('frontier:one',$1,'SHIPPING_DURABLY_PERSISTED',
      jsonb_build_object('shippingCaptureEvidence',jsonb_build_object(
        'candidateId',$2::text,'captureSessionId',$3::text)))`, [account,candidate,oldSession])
}

async function observe(db, state, binding = {}) {
  const result = await db.query(`select public.record_seller_os_luna_shipping_execution_observation_v1(
    $1,$2,$3::uuid,$4,$5,$6,$7::uuid,clock_timestamp()) result`, [account,worker,
    leader,state,binding.candidateId ?? null,binding.snapshotDigest ?? null,
    binding.captureSessionId ?? null])
  assert.equal(result.rows[0].result.recorded, true)
}

async function claim(db, requestedSnapshot = snapshot) {
  return (await db.query(`select public.claim_seller_os_luna_shipping_job_v2(
    $1,$2,$3,$4::uuid,$5::uuid,$6::uuid) result`,
  [account,candidate,requestedSnapshot,worker,newSession,leader])).rows[0].result
}

test("active lease waits and never reclaims", async () => {
  const db = await fixture(); await putClaim(db,{active:true}); await observe(db,"IDLE")
  const result = await claim(db)
  assert.equal(result.claimStatus,"ACTIVE_LEASE"); assert.equal(result.claimed,false)
  assert.equal((await db.query(`select count(*)::int n from public.seller_os_luna_shipping_claim_recovery_events_v1`)).rows[0].n,0)
})

test("expired claim with one durable result reconciles without recapture", async () => {
  const db=await fixture(); await putClaim(db,{durable:true}); await observe(db,"IDLE")
  const result=await claim(db)
  assert.equal(result.claimStatus,"DURABLE_RESULT_RECONCILED")
  assert.equal(result.captureRequired,false); assert.equal(result.durableReadbackMatch,true)
  assert.equal((await db.query(`select status from public.seller_os_luna_shipping_job_claims`)).rows[0].status,"COMPLETED")
})

test("expired claim without result and proven idle execution gets one bounded reclaim", async () => {
  const db=await fixture(); await putClaim(db); await observe(db,"IDLE")
  const result=await claim(db)
  assert.equal(result.claimed,true); assert.equal(result.automaticExpiredRecovery,true)
  const event=(await db.query(`select attempt_status,replacement_capture_session_id from public.seller_os_luna_shipping_claim_recovery_events_v1`)).rows[0]
  assert.equal(event.attempt_status,"EXPIRED_RECOVERABLE")
  assert.equal(event.replacement_capture_session_id,newSession)
})

test("expired claim with active or uncertain execution fails closed", async () => {
  for (const state of ["ACTIVE","UNKNOWN"]) {
    const db=await fixture(); await putClaim(db)
    if(state==="ACTIVE") await observe(db,"ACTIVE",{candidateId:candidate,
      snapshotDigest:snapshot,captureSessionId:oldSession})
    const result=await claim(db)
    assert.equal(result.claimed,false)
    assert.match(result.claimStatus,/CAPTURE_EXECUTION_(ACTIVE|UNCERTAIN)/)
  }
})

test("identity or binding mismatch fails closed", async () => {
  const db=await fixture(); await putClaim(db); await observe(db,"IDLE")
  const result=await claim(db,otherSnapshot)
  assert.equal(result.claimed,false); assert.equal(result.claimStatus,"IDENTITY_BINDING_MISMATCH")
  assert.notEqual(otherCandidate,candidate)
})

test("successful durable replay creates zero additional captures", async () => {
  const db=await fixture(); await putClaim(db,{durable:true}); await observe(db,"IDLE")
  assert.equal((await claim(db)).claimStatus,"DURABLE_RESULT_RECONCILED")
  const replay=await claim(db)
  assert.equal(replay.claimStatus,"ALREADY_COMPLETED")
  assert.equal(replay.captureRequired,false)
  assert.equal((await db.query(`select count(*)::int n from public.seller_os_luna_shipping_claim_recovery_events_v1`)).rows[0].n,1)
})

test("normal runtime persists extension state and uses the v2 claim authority", () => {
  assert.match(server,/claim_seller_os_luna_shipping_job_v2/)
  assert.match(route,/record_shipping_execution_observation/)
  assert.match(control,/LUNA_SHIPPING_ACTIVE_JOB_STATUS[\s\S]*?record_shipping_execution_observation/)
  assert.match(control,
    /refreshShippingExecutionObservationRef\.current = \(\) =>[\s\S]*?SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS/)
  assert.match(control,
    /if \(serverClaimLeaderRef\.current\) \{[\s\S]*?refreshShippingExecutionObservationRef\.current\?\.\(\)/)
  assert.doesNotMatch(control,/MANUAL_SHIPPING_RECLAIM/)
})
