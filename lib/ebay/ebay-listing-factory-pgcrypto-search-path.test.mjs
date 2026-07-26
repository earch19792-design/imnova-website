import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260726073000_fix_listing_factory_pgcrypto_search_path.sql",
  "utf8",
)
const rollback = readFileSync(
  "supabase/rollback/20260726073000_fix_listing_factory_pgcrypto_search_path.down.sql",
  "utf8",
)

const affectedFunctions = [
  "initialize_ebay_listing_factory_run_v1",
  "claim_ebay_listing_factory_candidate_v1",
  "claim_ebay_listing_factory_candidate_by_id_v1",
  "transition_ebay_listing_factory_candidate_v1",
  "resolve_ebay_listing_factory_circuit_probe_v1",
]

test("pgcrypto queda resoluble sólo para las cinco funciones factory afectadas", () => {
  assert.match(migration, /^\s*begin\s*;/i)
  assert.match(migration, /commit\s*;\s*$/i)
  assert.match(rollback, /^\s*begin\s*;/i)
  assert.match(rollback, /commit\s*;\s*$/i)

  for (const functionName of affectedFunctions) {
    assert.match(migration, new RegExp(
      `alter function public\\.${functionName}\\(`,
      "i",
    ))
    assert.match(rollback, new RegExp(
      `alter function public\\.${functionName}\\(`,
      "i",
    ))
  }

  assert.equal(
    (migration.match(
      /set search_path\s*=\s*public,\s*extensions,\s*pg_temp/gi,
    ) ?? []).length,
    affectedFunctions.length,
  )
  assert.equal(
    (rollback.match(
      /set search_path\s*=\s*public,\s*pg_temp/gi,
    ) ?? []).length,
    affectedFunctions.length,
  )
  assert.doesNotMatch(
    `${migration}\n${rollback}`,
    /\b(?:insert|update|delete|truncate|drop|grant)\b/i,
  )
})
