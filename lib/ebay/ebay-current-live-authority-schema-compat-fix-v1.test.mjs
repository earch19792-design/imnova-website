import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

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

const { runCurrentLiveAuthorityRecoveryV1 } = await import(
  "./ebay-current-live-authority-recovery-v1.ts")

const ACCOUNT = `imnova:${"a".repeat(64)}`
const NOW = new Date("2026-09-08T23:30:00.000Z")
const MIGRATION =
  "supabase/migrations/20260908232657_ebay_current_live_authority_schema_compat_fix_v1.sql"

function listing(overrides = {}) {
  return {
    itemId: "123456789012",
    title: "Certified listing",
    sku: "SKU-1",
    variationKey: null,
    availableQuantity: 2,
    price: 14.5,
    currency: "USD",
    primaryImageUrl: "https://example.invalid/item.jpg",
    identityAmbiguous: false,
    marketplaceCertification: { status: "US_CERTIFIED" },
    ...overrides,
  }
}

function live(rows = [listing()]) {
  return {
    account: { status: "CERTIFIED", bindingMatched: true },
    discovery: {
      status: "AVAILABLE",
      coverage: "COMPLETE",
      observedAt: NOW.toISOString(),
      gapCodes: [],
      currentLiveListings: rows,
      sellerWideEnumeration: {
        itemSetComplete: true,
        identitySetComplete: true,
      },
      marketplaceCertification: {
        sellerWideItemsParsed: new Set(rows.map((row) => row.itemId)).size,
        sellerWideItemsReported: new Set(rows.map((row) => row.itemId)).size,
        sellerWideItemsMarketplaceUnresolved: 0,
        sellerWideItemsMarketplaceError: 0,
        sellerWideItemsMarketplaceItemIdMismatch: 0,
        sellerWideItemsMarketplaceBudgetExhausted: 0,
      },
    },
  }
}

function fakeSupabase(options = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      assert.equal(table, "ebay_active_listing_sync_state")
      const chain = {
        select() { return chain },
        eq() { return chain },
        limit() { return chain },
        async maybeSingle() { return { data: null, error: null } },
      }
      return chain
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === "claim_ebay_active_listing_sync_run") {
        return { data: { claimed: true }, error: null }
      }
      if (name === "record_ebay_current_live_authority_success_v1") {
        return options.failSuccessReceipt
          ? { data: null, error: { message: "fixture failure" } }
          : { data: { applied: true }, error: null }
      }
      if (name === "finish_ebay_active_listing_sync_run") {
        return { data: { finished: true }, error: null }
      }
      throw new Error(`UNEXPECTED_RPC_${name}`)
    },
  }
}

async function run(rows, options = {}) {
  const supabase = fakeSupabase(options)
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    clock: () => NOW,
    forceOfficialRead: true,
    readOfficial: async () => live(rows),
  })
  return { result, calls: supabase.calls }
}

function successCall(calls) {
  return calls.find((call) =>
    call.name === "record_ebay_current_live_authority_success_v1")
}

async function schemaDatabase() {
  const database = new PGlite()
  await database.exec(`
    create table public.ebay_active_listings (
      source text not null,
      account_key text not null,
      sync_key text not null unique,
      sync_run_id uuid,
      sync_generation bigint not null default 0,
      ebay_item_id text not null,
      listing_status text not null,
      title text not null,
      ebay_sku text,
      ebay_quantity integer,
      ebay_price numeric,
      currency text,
      last_ebay_sync_at timestamptz,
      raw_payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table public.ebay_active_listing_sync_state (
      account_key text primary key,
      current_live_source_state text not null default 'CURRENT_UNAVAILABLE',
      current_live_last_attempt_at timestamptz,
      current_live_next_retry_at timestamptz,
      current_live_last_error_code text,
      last_certified_live_scope_id text,
      last_certified_live_item_ids jsonb,
      last_certified_live_count integer,
      last_certified_live_observed_at timestamptz,
      last_certified_live_fresh_until timestamptz,
      last_certified_live_source_authority text
    );
  `)
  const migration = readFileSync(MIGRATION, "utf8")
  const definition = migration.match(
    /create or replace function public\.record_ebay_current_live_authority_success_v1[\s\S]*?\$function\$;/i)?.[0]
  assert.ok(definition)
  await database.exec(definition)
  return database
}

async function persistDatabaseRows(database, rows, runId =
  "11111111-1111-4111-8111-111111111111") {
  const observedAt = new Date().toISOString()
  return database.query(`
    select * from public.record_ebay_current_live_authority_success_v1(
      $1::text, $2::uuid, $3::text, $4::timestamptz,
      $5::timestamptz, $6::jsonb, $7::jsonb
    )
  `, [
    ACCOUNT,
    runId,
    `current-live:sha256:${"b".repeat(64)}`,
    observedAt,
    new Date(Date.parse(observedAt) + 20 * 60_000).toISOString(),
    JSON.stringify(rows.map((row) => row.itemId)),
    JSON.stringify(rows.map((row) => ({
      itemId: row.itemId,
      title: row.title,
      sku: row.sku ?? null,
      quantity: row.quantity ?? null,
      price: row.price ?? null,
      currency: row.currency,
      variationKey: row.variationKey ?? null,
      primaryImageUrl: row.primaryImageUrl ?? null,
      observedAt,
    }))),
  ])
}

test("NON_VARIATION_LISTING_PASS", async () => {
  const { calls } = await run([listing()])
  assert.equal(successCall(calls).args.p_rows[0].variationKey, null)
})

test("VARIATION_LISTING_PASS", async () => {
  const { calls } = await run([listing({ variationKey: "Color=Blue" })])
  assert.equal(successCall(calls).args.p_rows[0].variationKey, "Color=Blue")
})

test("EXACT_BINDING_PASS", async () => {
  const { calls } = await run([listing({ variationKey: "Size=Small" })])
  const receipt = successCall(calls).args
  assert.deepEqual(receipt.p_item_ids, ["123456789012"])
  assert.deepEqual(receipt.p_rows.map((row) => ({
    itemId: row.itemId,
    sku: row.sku,
    variationKey: row.variationKey,
  })), [{ itemId: "123456789012", sku: "SKU-1",
    variationKey: "Size=Small" }])
  const sql = readFileSync(MIGRATION, "utf8")
  assert.match(sql, /concat\('EBAY_TRADING_GET_MY_EBAY_SELLING:', p_account_key, ':'/)
  assert.match(sql, /'variationKey', row\.value -> 'variationKey'/)
})

test("MISSING_VARIATION_IDENTITY_FAIL_CLOSED_PASS", async () => {
  const supabase = fakeSupabase()
  await assert.rejects(() => runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readOfficial: async () => live([listing({ identityAmbiguous: true })]),
  }), /CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_UNPROVEN/)
  assert.equal(successCall(supabase.calls), undefined)
  assert.equal(supabase.calls.at(-1).args.p_success, false)
})

test("AMBIGUOUS_VARIATION_FAIL_CLOSED_PASS", async () => {
  const supabase = fakeSupabase()
  await assert.rejects(() => runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readOfficial: async () => live([
      listing({ variationKey: "Color=Blue" }),
      listing({ variationKey: "Color=Red", sku: "SKU-2" }),
    ]),
  }), /CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_AMBIGUOUS/)
  assert.equal(successCall(supabase.calls), undefined)
  assert.equal(supabase.calls.at(-1).args.p_success, false)
})

test("SUCCESS_RECEIPT_PASS", async () => {
  const { result, calls } = await run([listing()])
  assert.equal(result.status, "RECOVERED_CURRENT_FRESH")
  assert.equal(calls.filter((call) => call.name ===
    "record_ebay_current_live_authority_success_v1").length, 1)
  const finish = calls.find((call) =>
    call.name === "finish_ebay_active_listing_sync_run")
  assert.equal(finish.args.p_success, true)
})

test("FAILED_RPC_ROLLBACK_PASS", async () => {
  const supabase = fakeSupabase({ failSuccessReceipt: true })
  await assert.rejects(() => runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readOfficial: async () => live(),
  }), /CURRENT_LIVE_AUTHORITY_SUCCESS_RECEIPT_FAILED/)
  const finish = supabase.calls.find((call) =>
    call.name === "finish_ebay_active_listing_sync_run")
  assert.equal(finish.args.p_success, false)
  const sql = readFileSync(MIGRATION, "utf8")
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 1)
})

test("IDEMPOTENT_REPLAY_PASS", async () => {
  const first = await run([listing({ variationKey: "Color=Blue" })])
  const second = await run([listing({ variationKey: "Color=Blue" })])
  const a = successCall(first.calls).args
  const b = successCall(second.calls).args
  assert.deepEqual(a.p_item_ids, b.p_item_ids)
  assert.deepEqual(a.p_rows, b.p_rows)
  assert.equal(a.p_scope_id, b.p_scope_id)
  assert.match(readFileSync(MIGRATION, "utf8"),
    /on conflict \(sync_key\) do update set/)
})

test("NO_MARKETPLACE_WRITE_SIDE_EFFECT_PASS", async () => {
  const { result, calls } = await run([listing()])
  assert.equal(result.marketplaceWrites, 0)
  assert.deepEqual([...new Set(calls.map((call) => call.name))].sort(), [
    "claim_ebay_active_listing_sync_run",
    "finish_ebay_active_listing_sync_run",
    "record_ebay_current_live_authority_success_v1",
  ])
})

test("NO_STALE_COLUMN_REFERENCE_PASS", () => {
  const migration = readFileSync(MIGRATION, "utf8")
  const baseSchema = readFileSync(
    "supabase/migrations/202606280002_create_ebay_active_listing_risk_monitor.sql",
    "utf8")
  assert.doesNotMatch(migration, /\bebay_variation_key\b/)
  assert.doesNotMatch(baseSchema, /\bebay_variation_key\b/)
  assert.match(migration, /raw_payload/)
  assert.doesNotMatch(migration, /alter table/i)
})

test("SELLER_OS_OPERATIONAL_EFFICIENCY_GATE_V1", () => {
  const migration = readFileSync(MIGRATION, "utf8")
  const implementation = readFileSync(
    "lib/ebay/ebay-current-live-authority-recovery-v1.ts", "utf8")
  for (const source of [migration, implementation]) {
    assert.doesNotMatch(source, /setInterval|setTimeout\(|count\s*=\s*exact/i)
    assert.doesNotMatch(source, /select\s+\*/i)
  }
  assert.doesNotMatch(migration, /create\s+index/i)
})

test("DATABASE_FUNCTION_SCHEMA_AND_TRANSACTION_PASS", async () => {
  const database = await schemaDatabase()
  try {
    const row = {
      itemId: "123456789012",
      title: "Certified variation",
      sku: "SKU-1",
      quantity: 2,
      price: 14.5,
      currency: "USD",
      variationKey: "Color=Blue",
      primaryImageUrl: "https://example.invalid/item.jpg",
    }
    const receipt = await persistDatabaseRows(database, [row])
    assert.deepEqual(receipt.rows, [{
      applied: true,
      certified_live_count: 1,
      authoritative_zero: false,
      stale_rows_ended: 0,
    }])
    const stored = await database.query(`
      select ebay_item_id, ebay_sku,
        raw_payload ->> 'variationKey' as variation_key
      from public.ebay_active_listings
    `)
    assert.deepEqual(stored.rows, [{
      ebay_item_id: "123456789012",
      ebay_sku: "SKU-1",
      variation_key: "Color=Blue",
    }])

    await database.exec(`
      truncate public.ebay_active_listings,
        public.ebay_active_listing_sync_state;
      alter table public.ebay_active_listing_sync_state
        add constraint fixture_force_rollback check (
          current_live_source_state <> 'CURRENT_FRESH'
        );
    `)
    await assert.rejects(() => persistDatabaseRows(database, [row],
      "22222222-2222-4222-8222-222222222222"))
    const rolledBack = await database.query(
      "select count(*)::integer as count from public.ebay_active_listings")
    assert.deepEqual(rolledBack.rows, [{ count: 0 }])
  } finally {
    await database.close()
  }
})
