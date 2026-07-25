import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722038000_position_4_contract_distinctness_amendment.sql",
  import.meta.url), "utf8")

test("position 4 amendment is append-only and service-role-only", () => {
  assert.match(migration,
    /ebay_reference_guided_position_contract_amendments/)
  assert.match(migration,
    /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /grant select, insert[\s\S]*to service_role/)
  assert.match(migration,
    /POSITION_CONTRACT_DISTINCTNESS_FIX/)
  assert.match(migration,
    /EXCLUDE_HANDS_TO_PRESERVE_DISTINCTION_FROM_POSITION_6/)
})

test("effective position 4 contract excludes every human-form category", () => {
  for (const phrase of ["human hands", "fingers", "arms", "people",
    "human body parts"]) {
    assert.match(migration, new RegExp(phrase))
  }
  assert.match(migration,
    /POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image/)
  assert.match(migration,
    /FAIL if any human hand, finger, arm, person, or human body part is visible/)
  assert.match(migration,
    /FAIL if position 4 is semantically equivalent to position 6/)
})

test("resolver binds base plan, historical prompt, amendment and effective hashes", () => {
  assert.match(migration,
    /resolve_ebay_reference_guided_position_4_effective_contract/)
  assert.match(migration, /base_plan_hash <> v_plan\.plan_hash/)
  assert.match(migration,
    /base_prompt_hash <> v_position_4\.exact_prompt_hash/)
  assert.match(migration,
    /effective_prompt_hash <> encode\(extensions\.digest/)
  assert.match(migration,
    /effective_position_contract_hash <>[\s\S]*extensions\.digest/)
  assert.match(migration,
    /MUST show two real human hands holding the two handles/)
})

test("provider events cannot omit or alter the active amendment", () => {
  assert.match(migration,
    /enforce_ebay_reference_guided_position_4_amendment/)
  assert.match(migration, /POSITION_4_AUTHORIZATION_AMENDMENT_MISMATCH/)
  assert.match(migration, /POSITION_4_RESERVATION_AMENDMENT_MISMATCH/)
  assert.match(migration, /new\.evidence->>'effectivePromptHash'/)
  assert.match(migration, /before insert[\s\S]*when \(new\.position = 4\)/)
})

test("amendment migration grants no execution and preserves the budget", () => {
  assert.doesNotMatch(migration,
    /set\s+provider_calls\s*=|status\s*=\s*'PROVIDER_CALLING'/i)
  assert.doesNotMatch(migration,
    /insert into[\s\S]{0,500}'CONSUMED'/i)
  assert.doesNotMatch(migration, /fetch\(|openai\.com/i)
})
