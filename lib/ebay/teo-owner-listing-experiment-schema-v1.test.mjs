import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { PGlite } from "@electric-sql/pglite"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20261005035706_teo_manual_listing_improvement_memory_v1.sql",
  import.meta.url,
), "utf8")

test("TEO experiment memory SQL enforces owner/readback separation", async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create table public.ebay_listing_experiments_v1 (
        experiment_id text primary key,
        account_key text not null,
        ebay_item_id text not null,
        variable_changed text not null,
        lifecycle_status text not null,
        updated_at timestamptz not null default now()
      );
    `)
    await db.exec(migration)
    await db.query(`
      insert into public.ebay_listing_experiments_v1 (
        experiment_id, account_key, ebay_item_id, variable_changed,
        lifecycle_status, workflow_kind, owner_execution_status,
        readback_status, baseline_listing_snapshot
      ) values ($1, 'seller:test', '123456789012', 'PRICE', 'READY',
        'TEO_OWNER_MANUAL', 'AWAITING_OWNER', 'AWAITING_OWNER', '{}')
    `, ["experiment-1"])
    await assert.rejects(db.query(`
      update public.ebay_listing_experiments_v1
      set readback_status = 'VERIFIED_ON_EBAY'
      where experiment_id = 'experiment-1'
    `), /ebay_listing_experiments_readback_verified_check/)
    await db.query(`
      update public.ebay_listing_experiments_v1
      set owner_execution_status = 'CONFIRMED_BY_OWNER',
          owner_confirmed_at = now(),
          readback_status = 'VERIFIED_ON_EBAY',
          readback_verified_at = now(),
          readback_listing_snapshot = '{}',
          attribution_status = 'CLEAN_SINGLE_VARIABLE'
      where experiment_id = 'experiment-1'
    `)
    await db.query(`
      insert into public.ebay_listing_experiment_events_v1 (
        experiment_id, account_key, ebay_item_id, event_type, actor_role,
        occurred_at, evidence, event_fingerprint
      ) values ('experiment-1', 'seller:test', '123456789012',
        'READBACK_VERIFIED', 'SYSTEM', now(), '{}', $1)
    `, ["a".repeat(64)])
    const permissions = (await db.query(`
      select
        has_table_privilege('anon',
          'public.ebay_listing_experiment_events_v1', 'SELECT') as anon_read,
        has_table_privilege('authenticated',
          'public.ebay_listing_experiment_events_v1', 'INSERT') as admin_write,
        has_table_privilege('service_role',
          'public.ebay_listing_experiment_events_v1', 'INSERT') as service_write
    `)).rows[0]
    assert.equal(permissions.anon_read, false)
    assert.equal(permissions.admin_write, false)
    assert.equal(permissions.service_write, true)
  } finally {
    await db.close()
  }
})
