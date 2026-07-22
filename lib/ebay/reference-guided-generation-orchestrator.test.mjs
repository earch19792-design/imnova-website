import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("../../supabase/migrations/20260722008000_reference_guided_generation_orchestrator.sql", import.meta.url), "utf8")

test("V3 persistent orchestrator migration is additive and fail-closed", () => {
  assert.doesNotMatch(migration, /\b(drop|truncate|delete\s+from)\b/i)
  assert.match(migration, /expected_job_count integer not null default 6 check \(expected_job_count = 6\)/)
  assert.match(migration, /unique \(generation_attempt_id, position\)/i)
  assert.match(migration, /limit greatest\(1, least\(p_limit,2\)\)/i)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /set search_path = public/i)
  assert.match(migration, /grant execute on function public\.claim_ebay_reference_guided_generation_jobs[\s\S]*to service_role/i)
  assert.match(migration, /ebay_writes integer not null default 0 check \(ebay_writes = 0\)/i)
})
