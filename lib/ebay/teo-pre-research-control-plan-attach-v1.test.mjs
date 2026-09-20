import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const controlSql = readFileSync(
  "supabase/migrations/20260919180000_teo_pre_research_control_plane_v1.sql",
  "utf8")
const intakeSql = readFileSync(
  "supabase/migrations/20260919160000_pre_research_controlled_rerun_cohort_v1.sql",
  "utf8")
const guardSql = readFileSync(
  "supabase/migrations/20260920173417_fix_teo_pre_research_shared_immutability_guard_v1.sql",
  "utf8")
const attachFixPath = "supabase/migrations/" +
  "20260920180225_fix_teo_pre_research_canonical_plan_attach_v1.sql"
const attachFixSql = readFileSync(attachFixPath, "utf8")

function functionSql(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `${name} start`)
  const opening = source.indexOf("$function$", start)
  const end = source.indexOf("$function$;", opening + "$function$".length)
  assert.notEqual(end, -1, `${name} end`)
  return source.slice(start, end + "$function$;".length)
}

const requestSql = functionSql(controlSql,
  "request_seller_os_pre_research_batch_v1")
const brokenAttachSql = functionSql(controlSql,
  "attach_seller_os_pre_research_batch_plans_v1")
const canonicalPlanSql = functionSql(intakeSql,
  "create_or_reuse_luna_pre_research_plan_v1")

const owner = "10000000-0000-4000-8000-000000000001"
const capability = "20000000-0000-4000-8000-000000000001"
const oldSnapshot = "30000000-0000-4000-8000-000000000001"
const snapshot = "30000000-0000-4000-8000-000000000002"
const wrongSnapshot = "30000000-0000-4000-8000-000000000003"
const contract = "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"
const account = "ebay-us-owner"
const client = "chatgpt-control-client"
const hash = (value) => `sha256:${createHash("sha256")
  .update(String(value)).digest("hex")}`

function candidate(index) {
  return {
    productId: String(900000 + index),
    variantId: String(800000 + index),
    sku: `ITEM${index}`,
    sourceCandidateKey: hash(`source-${index}`),
    productTruthFingerprint: hash(`truth-${index}`),
    sourceFingerprint: hash(`catalog-${index}`),
  }
}

async function request(db, candidates, key = "teo.attach.mixed") {
  const result = await db.query(`select
    public.request_seller_os_pre_research_batch_v1(
      $1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,
      $8::jsonb) as value`, [account, owner, client, snapshot, contract,
    hash(`digest-${key}`), key, JSON.stringify(candidates.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      sourceCandidateKey: item.sourceCandidateKey,
      productTruthFingerprint: item.productTruthFingerprint,
    })))])
  return result.rows[0].value
}

async function canonicalPlan(db, item, sourceSnapshot, planId) {
  const queries = [{ ordinal: 1, search_query: `${item.sku} exact`,
    query_hash: hash(`query-${item.sku}`),
    cluster_key_hash: hash(`cluster-${item.sku}`), category_id: null,
    candidate_count: 1, candidate_variant_hashes: [hash(item.variantId)],
    query_intent: "EXACT_STRONG", evidence_basis: [],
    strategy_version: "TEST_QUERY_V1" }]
  const result = await db.query(`select
    public.create_or_reuse_luna_pre_research_plan_v1(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::uuid,$7::text,
      $8::text,$9::text,$10::text,$11::text,$12::text,$13::timestamptz,
      $14::jsonb) as value`, [planId, account,
    "LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15", hash(`input-${item.sku}`),
    item.sourceCandidateKey, sourceSnapshot, item.productId, item.variantId,
    item.sku, item.productTruthFingerprint,
    "LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15", item.sourceFingerprint,
    "2026-09-20T12:00:00.000Z", JSON.stringify(queries)])
  return result.rows[0].value
}

async function attach(db, batchId, plans, overrides = {}) {
  const result = await db.query(`select
    public.attach_seller_os_pre_research_batch_plans_v1(
      $1::uuid,$2::uuid,$3::text,$4::jsonb) as value`, [batchId,
    overrides.owner ?? owner, overrides.client ?? client,
    JSON.stringify(plans)])
  return result.rows[0].value
}

function binding(item, planId) {
  return { productId: item.productId, variantId: item.variantId,
    sku: item.sku, planId }
}

test("canonical historical reuse and fresh plan attach recover one durable mixed batch", async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const historical = candidate(1)
  const fresh = candidate(2)
  const historicalPlanId = "40000000-0000-4000-8000-000000000001"
  const freshPlanId = "40000000-0000-4000-8000-000000000002"
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions;
      create extension pgcrypto schema extensions;
      create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql stable as $$ select true $$;

      create table public.luna_catalog_snapshots_v1(
        snapshot_id uuid primary key,
        snapshot_status text not null,
        snapshot_completed_at timestamptz not null);
      create table public.luna_catalog_snapshot_variants_v1(
        snapshot_id uuid not null,
        product_id text not null,
        variant_id text not null,
        sku text not null,
        source_fingerprint text not null,
        observed_at timestamptz not null,
        preflight_status text not null,
        primary key(snapshot_id,product_id,variant_id));
      create table public.marketplace_product_research_query_plans(
        id uuid primary key,
        marketplace_account_key text not null,
        marketplace text not null,
        run_id uuid,
        plan_version text not null,
        input_hash text not null,
        status text not null,
        query_count integer not null,
        candidate_count integer not null,
        source_context text not null,
        subject_supplier_variant_id text,
        source_candidate_key text,
        source_luna_product_id text,
        source_supplier_sku text,
        source_luna_snapshot_id uuid,
        source_product_truth_fingerprint text,
        pre_research_policy_version text,
        pre_research_result text not null,
        pre_research_trace_eligible boolean not null,
        pre_research_evidence jsonb not null,
        research_intelligence_status text,
        intelligence_contract_version text,
        raw_competitor_content_stored boolean not null,
        pii_stored boolean not null,
        openai_calls integer not null,
        ebay_writes integer not null,
        pre_research_rerun_cohort_id uuid,
        completed_at timestamptz,
        created_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp());
      create unique index marketplace_product_research_luna_normal_identity_uq
        on public.marketplace_product_research_query_plans(
          marketplace_account_key,marketplace,source_candidate_key)
        where source_context='LUNA_PRE_RESEARCH'
          and pre_research_rerun_cohort_id is null;
      create table public.marketplace_product_research_query_tasks(
        id uuid primary key default extensions.gen_random_uuid(),
        plan_id uuid not null,
        marketplace_account_key text not null,
        marketplace text not null,
        ordinal integer not null,
        search_query text not null,
        query_hash text not null,
        cluster_key_hash text not null,
        category_id text,
        candidate_count integer not null,
        candidate_variant_hashes text[] not null,
        query_intent text,
        evidence_basis jsonb,
        strategy_version text,
        status text not null default 'PENDING');

      create table public.seller_os_pre_research_command_capabilities_v1(
        capability_id uuid primary key,
        capability_code text not null,
        marketplace_account_key text not null,
        owner_user_id uuid not null,
        command_client_id text not null,
        allowed_contract_version text not null,
        maximum_candidates integer not null,
        enabled boolean not null,
        expires_at timestamptz);
      create table public.seller_os_pre_research_batches_v1(
        batch_id uuid primary key default extensions.gen_random_uuid(),
        marketplace_account_key text not null,
        source_snapshot_id uuid not null,
        candidate_identity_digest text not null,
        candidate_count integer not null,
        contract_version text not null,
        owner_authorization_id uuid not null,
        owner_user_id uuid not null,
        command_client_id text not null,
        client_idempotency_key text not null,
        batch_state text not null,
        created_at timestamptz not null default clock_timestamp(),
        authorized_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default clock_timestamp(),
        unique(owner_authorization_id,source_snapshot_id,
          candidate_identity_digest,client_idempotency_key));
      create table public.seller_os_pre_research_batch_members_v1(
        member_id uuid primary key default extensions.gen_random_uuid(),
        batch_id uuid not null,
        ordinal integer not null,
        luna_product_id text not null,
        luna_variant_id text not null,
        luna_sku text not null,
        source_candidate_key text not null,
        product_truth_fingerprint text not null,
        plan_id uuid,
        execution_state text not null default 'PENDING',
        bounded_failure_reason text,
        retry_safety text,
        created_at timestamptz not null default clock_timestamp(),
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default clock_timestamp(),
        unique(batch_id,ordinal),
        unique(batch_id,source_candidate_key),
        unique(batch_id,luna_product_id,luna_variant_id,luna_sku),
        unique(batch_id,plan_id));
      create table public.seller_os_pre_research_batch_events_v1(
        event_id uuid primary key default extensions.gen_random_uuid(),
        batch_id uuid not null,
        member_id uuid,
        event_type text not null,
        actor_kind text not null,
        actor_subject text not null,
        detail jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default clock_timestamp());

      insert into public.seller_os_pre_research_command_capabilities_v1 values
        ('${capability}','TEO_PRE_RESEARCH_NORMAL_BATCH_V1','${account}',
          '${owner}','${client}','${contract}',50,true,null);
      insert into public.luna_catalog_snapshots_v1 values
        ('${oldSnapshot}','COMPLETE','2026-09-19T12:00:00Z');
      insert into public.luna_catalog_snapshot_variants_v1 values
        ('${oldSnapshot}','${historical.productId}','${historical.variantId}',
          '${historical.sku}','${historical.sourceFingerprint}',
          '2026-09-19T12:00:00Z','PREFLIGHT_PASS');
    `)

    await db.exec(`${canonicalPlanSql}\n${requestSql}\n${brokenAttachSql}\n${guardSql}
      create trigger seller_os_pre_research_batch_identity_immutable_v1
      before update on public.seller_os_pre_research_batches_v1
      for each row execute function
        public.guard_seller_os_pre_research_batch_immutability_v1();
      create trigger seller_os_pre_research_batch_member_identity_immutable_v1
      before update on public.seller_os_pre_research_batch_members_v1
      for each row execute function
        public.guard_seller_os_pre_research_batch_immutability_v1();`)

    const historicalCreated = await canonicalPlan(db, historical,
      oldSnapshot, historicalPlanId)
    assert.deepEqual([historicalCreated.planId, historicalCreated.created],
      [historicalPlanId, true])
    await db.query(`update public.marketplace_product_research_query_plans
      set status='COMPLETED',completed_at=clock_timestamp()
      where id=$1::uuid`, [historicalPlanId])

    await db.exec(`insert into public.luna_catalog_snapshots_v1 values
      ('${snapshot}','COMPLETE','2026-09-20T12:00:00Z');
      insert into public.luna_catalog_snapshot_variants_v1 values
      ('${snapshot}','${historical.productId}','${historical.variantId}',
        '${historical.sku}','${historical.sourceFingerprint}',
        '2026-09-20T12:00:00Z','PREFLIGHT_PASS'),
      ('${snapshot}','${fresh.productId}','${fresh.variantId}',
        '${fresh.sku}','${fresh.sourceFingerprint}',
        '2026-09-20T12:00:00Z','PREFLIGHT_PASS');`)

    const createdBatch = await request(db, [historical, fresh])
    const batchId = createdBatch.batchId
    const historicalReuse = await canonicalPlan(db, historical,
      snapshot, "40000000-0000-4000-8000-000000000011")
    const freshCreated = await canonicalPlan(db, fresh, snapshot, freshPlanId)
    assert.deepEqual([historicalReuse.planId, historicalReuse.created],
      [historicalPlanId, false])
    assert.deepEqual([freshCreated.planId, freshCreated.created],
      [freshPlanId, true])
    const validBindings = [binding(historical, historicalPlanId),
      binding(fresh, freshPlanId)]

    await assert.rejects(attach(db, batchId, validBindings),
      /TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH/)
    const before = (await db.query(`select member_id,ordinal,luna_product_id,
      luna_variant_id,luna_sku,source_candidate_key,product_truth_fingerprint,
      plan_id,execution_state from public.seller_os_pre_research_batch_members_v1
      where batch_id=$1::uuid order by ordinal`, [batchId])).rows
    assert.ok(before.every((member) => member.plan_id === null &&
      member.execution_state === "PENDING"))

    await db.exec(attachFixSql)

    const rogueIdentityPlan = "40000000-0000-4000-8000-000000000091"
    const rogueSnapshotPlan = "40000000-0000-4000-8000-000000000092"
    await db.exec(`insert into public.luna_catalog_snapshots_v1 values
      ('${wrongSnapshot}','FAILED','2026-09-18T12:00:00Z');`)
    await db.query(`insert into public.marketplace_product_research_query_plans(
      id,marketplace_account_key,marketplace,plan_version,input_hash,status,
      query_count,candidate_count,source_context,subject_supplier_variant_id,
      source_candidate_key,source_luna_product_id,source_supplier_sku,
      source_luna_snapshot_id,source_product_truth_fingerprint,
      pre_research_policy_version,pre_research_result,
      pre_research_trace_eligible,pre_research_evidence,
      research_intelligence_status,intelligence_contract_version,
      raw_competitor_content_stored,pii_stored,openai_calls,ebay_writes)
      values
      ($1,'${account}','EBAY_US','LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
        $3,'ACTIVE',1,1,'LUNA_PRE_RESEARCH',$4,$5,$6,$7,$8,$9,
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15','PENDING',false,'{}',
        'RESEARCH_IN_PROGRESS','LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
        false,false,0,0),
      ($2,'${account}','EBAY_US','LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
        $10,'ACTIVE',1,1,'LUNA_PRE_RESEARCH',$11,$12,$13,$14,$15,$16,
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15','PENDING',false,'{}',
        'RESEARCH_IN_PROGRESS','LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
        false,false,0,0)`, [rogueIdentityPlan, rogueSnapshotPlan,
      hash("rogue-input-identity"), historical.variantId,
      hash("rogue-candidate-key"), historical.productId, historical.sku,
      snapshot, hash("rogue-truth"), hash("rogue-input-snapshot"),
      fresh.variantId, hash("wrong-snapshot-key"), fresh.productId, fresh.sku,
      wrongSnapshot, hash("wrong-snapshot-truth")])
    await assert.rejects(attach(db, batchId,
      [binding(historical, rogueIdentityPlan)]),
    /TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH/)
    await assert.rejects(attach(db, batchId,
      [binding(fresh, rogueSnapshotPlan)]),
    /TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH/)
    await assert.rejects(attach(db, batchId, validBindings, {
      owner: "10000000-0000-4000-8000-000000000099",
    }), /TEO_PRE_RESEARCH_BATCH_AUTHORITY_DENIED/)
    await assert.rejects(attach(db, batchId, validBindings, {
      client: "wrong-control-client",
    }), /TEO_PRE_RESEARCH_BATCH_AUTHORITY_DENIED/)

    const replayedBatch = await request(db, [historical, fresh])
    assert.deepEqual([replayedBatch.batchId, replayedBatch.created],
      [batchId, false])
    const historicalReplay = await canonicalPlan(db, historical,
      snapshot, "40000000-0000-4000-8000-000000000021")
    const freshReplay = await canonicalPlan(db, fresh,
      snapshot, "40000000-0000-4000-8000-000000000022")
    assert.deepEqual([historicalReplay.planId, historicalReplay.created],
      [historicalPlanId, false])
    assert.deepEqual([freshReplay.planId, freshReplay.created],
      [freshPlanId, false])

    const attached = await attach(db, batchId, validBindings)
    assert.deepEqual([attached.newPlanAttachments, attached.attachedPlanCount],
      [2, 2])
    const attachedReplay = await attach(db, batchId, validBindings)
    assert.deepEqual([attachedReplay.newPlanAttachments,
      attachedReplay.attachedPlanCount], [0, 2])

    const after = (await db.query(`select member_id,ordinal,luna_product_id,
      luna_variant_id,luna_sku,source_candidate_key,product_truth_fingerprint,
      plan_id,execution_state from public.seller_os_pre_research_batch_members_v1
      where batch_id=$1::uuid order by ordinal`, [batchId])).rows
    assert.deepEqual(after.map(({ plan_id: _planId,
      execution_state: _executionState, ...identity }) => identity),
    before.map(({ plan_id: _planId,
      execution_state: _executionState, ...identity }) => identity))
    assert.deepEqual(after.map((member) => member.plan_id),
      [historicalPlanId, freshPlanId])
    assert.deepEqual(after.map((member) => member.execution_state),
      ["COMPLETED", "PENDING"])

    const authority = (await db.query(`select
      (select count(*)::int from public.seller_os_pre_research_batches_v1)
        as batches,
      (select count(*)::int from public.seller_os_pre_research_batch_members_v1)
        as members,
      (select count(*)::int from public.marketplace_product_research_query_plans
        where source_candidate_key in ($1,$2)) as canonical_plans,
      batch.source_snapshot_id,batch.owner_user_id,batch.command_client_id,
      batch.client_idempotency_key,batch.candidate_count,batch.batch_state
      from public.seller_os_pre_research_batches_v1 batch
      where batch.batch_id=$3::uuid`, [historical.sourceCandidateKey,
      fresh.sourceCandidateKey, batchId])).rows[0]
    assert.deepEqual(authority, { batches: 1, members: 2,
      canonical_plans: 2, source_snapshot_id: snapshot,
      owner_user_id: owner, command_client_id: client,
      client_idempotency_key: "teo.attach.mixed", candidate_count: 2,
      batch_state: "AUTHORIZED" })
  } finally {
    await db.close()
  }
})

test("attach fix changes only the incompatible plan-snapshot predicate", () => {
  assert.match(brokenAttachSql,
    /plan\.source_luna_snapshot_id=v_batch\.source_snapshot_id/)
  assert.doesNotMatch(attachFixSql,
    /plan\.source_luna_snapshot_id=v_batch\.source_snapshot_id/)
  for (const binding of ["marketplace_account_key", "marketplace='EBAY_US'",
    "source_context='LUNA_PRE_RESEARCH'", "pre_research_rerun_cohort_id is null",
    "source_luna_product_id", "subject_supplier_variant_id",
    "source_supplier_sku", "source_candidate_key",
    "source_product_truth_fingerprint", "owner_user_id",
    "command_client_id", "capability.enabled"]) {
    assert.match(attachFixSql, new RegExp(binding.replaceAll(".", "\\.")))
  }
  assert.doesNotMatch(attachFixSql,
    /alter\s+table|create\s+policy|disable\s+row\s+level|delete\s+from/i)
  assert.doesNotMatch(attachFixSql,
    /publisher|commercial.?trace|marketplace.?write/i)
})
