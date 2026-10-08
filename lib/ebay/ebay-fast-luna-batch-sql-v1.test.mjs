import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"

const migration = readFileSync(
  "supabase/migrations/20261008223335_fast_luna_batch_publisher_v1.sql",
  "utf8",
)

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create or replace function public.is_seller_os_service_role_request_v1()
    returns boolean language sql stable as $$ select true $$;
    create table public.ebay_luna_opportunity_queue (
      opportunity_score numeric not null default 0,
      demand_score numeric not null default 0,
      economics_score numeric not null default 0,
      competition_score numeric not null default 0,
      active_comparables integer not null default 0,
      sellers_with_movement integer not null default 0
    );
    create table public.seller_os_autonomous_stocking_batches_v1 (
      id uuid primary key default gen_random_uuid(),
      account_key text not null,
      contract_version text not null default 'AUTONOMOUS_EBAY_STOCKING_BATCH_V1',
      idempotency_key text not null,
      target_published_count integer not null,
      status text not null default 'ACTIVE',
      baseline_active_count bigint not null,
      final_active_count bigint null,
      publication_write_count integer not null default 0,
      ads_write_count integer not null default 0,
      evidence jsonb not null default '{}'::jsonb,
      started_at timestamptz not null default clock_timestamp(),
      completed_at timestamptz null,
      updated_at timestamptz not null default clock_timestamp(),
      unique(account_key, idempotency_key)
    );
    insert into auth.users(id)
    values ('11111111-1111-4111-8111-111111111111');
  `)
  await db.exec(migration)
  return db
}

const call = `select public.start_fast_luna_test_batch_v1(
  'seller:${"a".repeat(64)}',
  '11111111-1111-4111-8111-111111111111',
  'fixture-client', 3, 13, 'fast-luna:fixture-001',
  'PUBLICAR 3 LISTINGS DE LUNA') as value`

test("fast Luna batch write/readback is idempotent and owner-bound", async () => {
  const db = await setup()
  try {
    const first = await db.query(call)
    const replay = await db.query(call)
    assert.equal(first.rows[0].value.id, replay.rows[0].value.id)
    assert.equal(first.rows[0].value.owner_user_id,
      "11111111-1111-4111-8111-111111111111")
    assert.equal(first.rows[0].value.authorization_mode,
      "OWNER_FAST_LUNA_TEST_BATCH_V1")
    assert.equal(first.rows[0].value.target_published_count, 3)
    assert.equal(first.rows[0].value.evidence.marketLookupPerformed, false)
    assert.equal(first.rows[0].value.evidence.unknownCostEqualsZero, false)
    const nullable = await db.query(`select column_name, is_nullable
      from information_schema.columns
      where table_schema='public'
        and table_name='ebay_luna_opportunity_queue'
      order by column_name`)
    assert.equal(nullable.rows.length, 6)
    assert.ok(nullable.rows.every((column) => column.is_nullable === "YES"))
  } finally {
    await db.close()
  }
})

test("fast Luna batch rejects altered replay, fifth listing and wrong confirmation", async () => {
  const db = await setup()
  try {
    await db.query(call)
    await assert.rejects(() => db.query(call
      .replace(", 3, 13,", ", 2, 13,")
      .replace("PUBLICAR 3", "PUBLICAR 2")),
      /FAST_LUNA_TEST_BATCH_IDEMPOTENCY_CONFLICT/)
    await assert.rejects(() => db.query(call
      .replace(", 3, 13,", ", 5, 13,")
      .replace("PUBLICAR 3", "PUBLICAR 5")
      .replace("fixture-001", "fixture-005")),
    /FAST_LUNA_TEST_BATCH_START_INVALID/)
    await assert.rejects(() => db.query(call
      .replace("PUBLICAR 3 LISTINGS DE LUNA", "PUBLICAR SIN CONTROL")
      .replace("fixture-001", "fixture-bad")),
    /FAST_LUNA_TEST_BATCH_START_INVALID/)
  } finally {
    await db.close()
  }
})
