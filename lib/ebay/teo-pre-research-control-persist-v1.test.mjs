import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const baseSql = readFileSync(
  "supabase/migrations/20260919180000_teo_pre_research_control_plane_v1.sql",
  "utf8")
const fixPath = "supabase/migrations/" +
  "20260920173417_fix_teo_pre_research_shared_immutability_guard_v1.sql"
const fixSql = readFileSync(fixPath, "utf8")

function functionSql(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `${name} start`)
  const marker = "end $function$;"
  const end = source.indexOf(marker, start)
  assert.notEqual(end, -1, `${name} end`)
  return source.slice(start, end + marker.length)
}

const requestSql = functionSql(baseSql,
  "request_seller_os_pre_research_batch_v1")
const brokenGuardSql = functionSql(baseSql,
  "guard_seller_os_pre_research_batch_immutability_v1")

const owner = "10000000-0000-4000-8000-000000000001"
const capability = "20000000-0000-4000-8000-000000000001"
const snapshot = "30000000-0000-4000-8000-000000000001"
const contract = "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"
const account = "ebay-us-owner"
const client = "chatgpt-control-client"
const hash = (value) => `sha256:${createHash("sha256")
  .update(String(value)).digest("hex")}`

function candidate(index, overrides = {}) {
  return {
    productId: String(900000 + index),
    variantId: String(800000 + index),
    sku: `ITEM${index}`,
    sourceCandidateKey: hash(`source-${index}`),
    productTruthFingerprint: hash(`truth-${index}`),
    ...overrides,
  }
}

async function request(db, candidates, overrides = {}) {
  const result = await db.query(`
    select public.request_seller_os_pre_research_batch_v1(
      $1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,
      $8::jsonb) as value`, [
    overrides.account ?? account,
    overrides.owner ?? owner,
    overrides.client ?? client,
    overrides.snapshot ?? snapshot,
    overrides.contract ?? contract,
    overrides.digest ?? hash(`digest-${overrides.key ?? "default"}`),
    overrides.key ?? "teo.persist.default",
    JSON.stringify(candidates),
  ])
  return result.rows[0].value
}

test("targeted guard fix unblocks fresh and mixed durable CREATE without widening authority", async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions;
      create extension pgcrypto schema extensions;

      create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql stable as $$ select true $$;

      create table public.luna_catalog_snapshots_v1(
        snapshot_id uuid primary key,
        snapshot_status text not null);
      create table public.luna_catalog_snapshot_variants_v1(
        snapshot_id uuid not null,
        product_id text not null,
        variant_id text not null,
        sku text not null,
        preflight_status text not null,
        primary key(snapshot_id,product_id,variant_id));
      create table public.marketplace_product_research_query_plans(
        id uuid primary key default extensions.gen_random_uuid(),
        sku text not null unique);

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
        unique(batch_id,luna_product_id,luna_variant_id,luna_sku));
      create table public.seller_os_pre_research_batch_events_v1(
        event_id uuid primary key default extensions.gen_random_uuid(),
        batch_id uuid not null,
        member_id uuid,
        event_type text not null,
        actor_kind text not null,
        actor_subject text not null,
        detail jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default clock_timestamp());

      insert into public.luna_catalog_snapshots_v1 values
        ('${snapshot}','COMPLETE');
      insert into public.seller_os_pre_research_command_capabilities_v1 values
        ('${capability}','TEO_PRE_RESEARCH_NORMAL_BATCH_V1','${account}',
          '${owner}','${client}','${contract}',50,true,null);
    `)
    for (let index = 1; index <= 55; index += 1) {
      const item = candidate(index)
      await db.query(`insert into public.luna_catalog_snapshot_variants_v1
        (snapshot_id,product_id,variant_id,sku,preflight_status)
        values ($1::uuid,$2::text,$3::text,$4::text,'PREFLIGHT_PASS')`,
      [snapshot, item.productId, item.variantId, item.sku])
    }

    await db.exec(`${requestSql}\n${brokenGuardSql}
      create trigger seller_os_pre_research_batch_identity_immutable_v1
      before update on public.seller_os_pre_research_batches_v1
      for each row execute function
        public.guard_seller_os_pre_research_batch_immutability_v1();
      create trigger seller_os_pre_research_batch_member_identity_immutable_v1
      before update on public.seller_os_pre_research_batch_members_v1
      for each row execute function
        public.guard_seller_os_pre_research_batch_immutability_v1();`)

    await assert.rejects(request(db, [candidate(1)], {
      key: "teo.persist.broken" }), /record "old" has no field "ordinal"/i)
    assert.equal((await db.query(
      "select count(*)::int as count from public.seller_os_pre_research_batches_v1"))
      .rows[0].count, 0)

    await db.exec(fixSql)

    assert.equal((await db.query(
      "select count(*)::int as count from public.marketplace_product_research_query_plans where sku='ITEM1'"))
      .rows[0].count, 0)
    const fresh = await request(db, [candidate(1)], {
      key: "teo.persist.fresh" })
    assert.deepEqual({ created: fresh.created, state: fresh.state,
      candidateCount: fresh.candidateCount }, {
      created: true, state: "AUTHORIZED", candidateCount: 1 })
    assert.equal((await db.query(
      "select count(*)::int as count from public.marketplace_product_research_query_plans where sku='ITEM1'"))
      .rows[0].count, 0)

    await db.query(`insert into public.marketplace_product_research_query_plans(sku)
      values ($1),($2)`, ["ITEM2", "ITEM3"])
    const existing = await request(db, [candidate(2)], {
      key: "teo.persist.existing" })
    assert.equal(existing.created, true)
    const mixed = await request(db, [candidate(3), candidate(4)], {
      key: "teo.persist.mixed" })
    assert.deepEqual([mixed.created, mixed.candidateCount], [true, 2])

    const idempotentInput = { key: "teo.persist.idempotent" }
    const first = await request(db, [candidate(5)], idempotentInput)
    const replay = await request(db, [candidate(5)], idempotentInput)
    assert.equal(first.batchId, replay.batchId)
    assert.deepEqual([first.created, replay.created], [true, false])
    assert.equal((await db.query(`select count(*)::int as count
      from public.seller_os_pre_research_batches_v1
      where client_idempotency_key='teo.persist.idempotent'`)).rows[0].count, 1)

    await assert.rejects(request(db, [candidate(6, {
      sourceCandidateKey: "not-a-hash" })], {
      key: "teo.persist.bad-identity" }),
    /TEO_PRE_RESEARCH_CANDIDATE_IDENTITY_INVALID/)
    await assert.rejects(request(db, [candidate(6)], {
      key: "teo.persist.bad-snapshot",
      snapshot: "30000000-0000-4000-8000-000000000099",
    }), /TEO_PRE_RESEARCH_SNAPSHOT_NOT_COMPLETE/)
    await assert.rejects(request(db, [candidate(6)], {
      key: "teo.persist.bad-owner",
      owner: "10000000-0000-4000-8000-000000000099",
    }), /TEO_PRE_RESEARCH_CAPABILITY_DENIED/)
    await assert.rejects(request(db, [candidate(6)], {
      key: "teo.persist.bad-client", client: "wrong-control-client",
    }), /TEO_PRE_RESEARCH_CAPABILITY_DENIED/)
    await db.exec(`update public.seller_os_pre_research_command_capabilities_v1
      set enabled=false where capability_id='${capability}'`)
    await assert.rejects(request(db, [candidate(6)], {
      key: "teo.persist.disabled" }), /TEO_PRE_RESEARCH_CAPABILITY_DENIED/)
    await db.exec(`update public.seller_os_pre_research_command_capabilities_v1
      set enabled=true where capability_id='${capability}'`)
    await assert.rejects(request(db,
      Array.from({ length: 51 }, (_, offset) => candidate(offset + 1)), {
        key: "teo.persist.over-limit",
      }), /TEO_PRE_RESEARCH_BATCH_REQUEST_INVALID/)

    const batchId = fresh.batchId
    await db.query(`update public.seller_os_pre_research_batches_v1
      set updated_at=clock_timestamp() where batch_id=$1::uuid`, [batchId])
    await assert.rejects(db.query(`update public.seller_os_pre_research_batches_v1
      set owner_user_id=$2::uuid where batch_id=$1::uuid`, [batchId,
      "10000000-0000-4000-8000-000000000099"]),
    /TEO_PRE_RESEARCH_BATCH_IDENTITY_IMMUTABLE/)
    const member = (await db.query(`select member_id from
      public.seller_os_pre_research_batch_members_v1
      where batch_id=$1::uuid`, [batchId])).rows[0]
    const planOne = "40000000-0000-4000-8000-000000000001"
    const planTwo = "40000000-0000-4000-8000-000000000002"
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set plan_id=$2::uuid where member_id=$1::uuid`, [member.member_id, planOne])
    await assert.rejects(db.query(`update
      public.seller_os_pre_research_batch_members_v1 set plan_id=$2::uuid
      where member_id=$1::uuid`, [member.member_id, planTwo]),
    /TEO_PRE_RESEARCH_BATCH_MEMBERSHIP_IMMUTABLE/)
    await assert.rejects(db.query(`update
      public.seller_os_pre_research_batch_members_v1 set ordinal=2
      where member_id=$1::uuid`, [member.member_id]),
    /TEO_PRE_RESEARCH_BATCH_MEMBERSHIP_IMMUTABLE/)

    const durable = await db.query(`select
      (select count(*)::int from public.seller_os_pre_research_batches_v1) batches,
      (select count(*)::int from public.seller_os_pre_research_batch_members_v1) members,
      (select count(*)::int from public.seller_os_pre_research_batch_events_v1) events`)
    assert.deepEqual(durable.rows[0], { batches: 4, members: 5, events: 4 })
  } finally {
    await db.close()
  }
})

test("migration replaces only the shared guard and preserves forced-RLS ownership", () => {
  assert.match(fixSql, /create or replace function public\.guard_seller_os_pre_research_batch_immutability_v1/)
  assert.match(fixSql, /to_jsonb\(old\)/)
  assert.match(fixSql, /elsif tg_table_name='seller_os_pre_research_batch_members_v1'/)
  assert.match(fixSql, /TEO_PRE_RESEARCH_IMMUTABILITY_GUARD_TABLE_INVALID/)
  assert.match(fixSql, /revoke all on function[\s\S]*public, anon, authenticated, service_role/)
  assert.doesNotMatch(fixSql,
    /alter\s+table|create\s+policy|disable\s+row\s+level|insert\s+into|update\s+public\.|delete\s+from|marketplace_product_research_query_plans/i)
})
