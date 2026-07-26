import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260726075000_qualify_listing_factory_pgcrypto_functions.sql",
  "utf8",
)
const claimRepairMigration = readFileSync(
  "supabase/migrations/20260726074000_fix_listing_factory_claim_ambiguous_columns.sql",
  "utf8",
)
const rollback = readFileSync(
  "supabase/rollback/20260726073000_fix_listing_factory_pgcrypto_search_path.down.sql",
  "utf8",
)
const bridgeService = readFileSync(
  "lib/ebay/ebay-resilient-listing-factory-service.ts",
  "utf8",
)

const affectedFunctions = [
  "initialize_ebay_listing_factory_run_v1",
  "claim_ebay_listing_factory_candidate_v1",
  "claim_ebay_listing_factory_candidate_by_id_v1",
  "transition_ebay_listing_factory_candidate_v1",
  "resolve_ebay_listing_factory_circuit_probe_v1",
]

test("pgcrypto queda cualificado en las cinco funciones factory afectadas", () => {
  assert.match(migration, /^\s*begin\s*;/i)
  assert.match(migration, /commit\s*;\s*$/i)
  assert.match(rollback, /^\s*begin\s*;/i)
  assert.match(rollback, /commit\s*;\s*$/i)

  for (const functionName of affectedFunctions) {
    assert.match(migration, new RegExp(
      `create or replace function public\.${functionName}\(`,
      "i",
    ))
    assert.match(rollback, new RegExp(
      `alter function public\.${functionName}\(`,
      "i",
    ))
  }

  assert.equal(
    (migration.match(
      /pg_catalog\.encode\s*\(\s*extensions\.digest\s*\(/gi,
    ) ?? []).length,
    7,
  )
  assert.equal(
    (migration.match(
      /set search_path\s*=\s*public,\s*pg_temp/gi,
    ) ?? []).length,
    affectedFunctions.length,
  )
  assert.doesNotMatch(migration, /(^|[^.\w])digest\s*\(/im)
  assert.doesNotMatch(migration, /(^|[^.\w])encode\s*\(/im)
  assert.doesNotMatch(migration, /set search_path\s*=.*extensions/i)
  assert.doesNotMatch(migration, /\b(?:drop|truncate)\b/i)
})

test("claim by id cualifica columnas que colisionan con RETURNS TABLE", () => {
  assert.match(claimRepairMigration, /^\s*begin\s*;/i)
  assert.match(claimRepairMigration, /commit\s*;\s*$/i)
  assert.match(
    claimRepairMigration,
    /update public\.ebay_same_day_pilot_candidates as target/i,
  )
  assert.match(
    claimRepairMigration,
    /factory_attempt_count\s*=\s*target\.factory_attempt_count\s*\+\s*1/i,
  )
  assert.match(
    claimRepairMigration,
    /factory_state\s*=\s*case\s+when target\.factory_state\s*=\s*'QUEUED'\s+then\s+'CLAIMED'\s+else target\.factory_state\s+end/i,
  )
  assert.match(
    claimRepairMigration,
    /factory_state_version\s*=\s*target\.factory_state_version\s*\+\s*1/i,
  )
  assert.match(claimRepairMigration, /where target\.id\s*=\s*p_candidate_id/i)
  assert.match(
    claimRepairMigration,
    /pg_catalog\.encode\s*\(\s*extensions\.digest\s*\(/i,
  )
})

test("el bridge sólo clasifica como migración los códigos allowlisted", () => {
  const start = bridgeService.indexOf("function bridgeErrorCode")
  const end = bridgeService.indexOf(
    "export function isResilientListingFactoryEnabled",
    start,
  )
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const mapper = bridgeService.slice(start, end)
  const allowlist = mapper.match(/\[([^\]]+)\]\.includes\(code\)/s)
  assert.ok(allowlist)
  assert.deepEqual(
    [...allowlist[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    ["42P01", "42702", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"],
  )
  assert.match(mapper, /return "LISTING_FACTORY_MIGRATION_NOT_READY"/)
  assert.match(mapper, /return "LISTING_FACTORY_LEGACY_BRIDGE_FAILED"/)
  assert.doesNotMatch(mapper, /return\s+code\b/)
})
