import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722042000_position_6_human_context_amendment.sql",
  import.meta.url), "utf8")

test("position 6 amendment is append-only and service-role-only", () => {
  assert.match(migration, /ebay_reference_guided_position_6_contract_amendments/)
  assert.match(migration,
    /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /to service_role/)
  assert.match(migration, /HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX/)
  assert.match(migration,
    /MISSING_EXACT_HANDS_GRIP_EXCLUSIONS_AND_ANATOMY_REQUIREMENTS/)
})

test("position 6 effective contract contains every mandatory human-context rule", () => {
  for (const phrase of [
    "exactly two real adult hands",
    "one hand entering from the left and holding only the left handle",
    "one hand entering from the right and holding only the right handle",
    "natural relaxed grip",
    "exact product empty, complete, centered",
    "both handles completely",
    "rim, base, body, and exact perforation pattern clearly visible",
    "neutral lightly blurred kitchen background",
    "additional, missing, fused, or deformed fingers",
    "full arms, a torso, a person, or a face",
    "jewelry, a watch, bracelets, rings",
    "water, droplets, food, utensils, or held props anywhere",
    "exactly one hand per handle",
    "no finger passes through metal or product pixels",
    "distinct from positions 3, 4, and 5",
  ]) assert.match(migration, new RegExp(phrase))
  for (const key of [
    "exactlyTwoHands", "oneHandPerHandle", "noExtraOrFusedFingers",
    "noPersonOrFace", "noJewelry", "productEmpty", "noWater", "noFood",
    "noUtensils", "identityFeaturesVisible", "noText",
    "distinctCommercialComposition",
  ]) assert.match(migration, new RegExp(key))
})

test("resolver and event trigger prevent amendment omission before reservation", () => {
  assert.match(migration,
    /resolve_ebay_reference_guided_position_6_effective_contract/)
  assert.match(migration,
    /enforce_ebay_reference_guided_position_6_amendment/)
  assert.match(migration, /POSITION_6_AUTHORIZATION_AMENDMENT_MISMATCH/)
  assert.match(migration, /POSITION_6_RESERVATION_AMENDMENT_MISMATCH/)
  assert.match(migration, /position6AmendmentId/)
  assert.match(migration, /position6EffectivePromptHash/)
  assert.doesNotMatch(migration, /insert[\s\S]{0,300}'AUTHORIZED'/)
  assert.doesNotMatch(migration, /insert[\s\S]{0,300}'CONSUMED'/)
  assert.doesNotMatch(migration, /set provider_calls =/)
})

test("passed assets and position 4 are evidence-only snapshots", () => {
  assert.match(migration, /passed_assets_snapshot/)
  assert.match(migration, /position_4_snapshot/)
  assert.match(migration, /j2\.status = 'PASSED'/)
  assert.match(migration, /j3\.status = 'PASSED'/)
  assert.match(migration, /j5\.status = 'PASSED'/)
  assert.match(migration, /j4\.status = 'BLOCKED_FIDELITY'/)
  assert.doesNotMatch(migration, /update public\.ebay_reference_guided_generation_jobs/)
  assert.doesNotMatch(migration, /update public\.ebay_reference_guided_position_4/)
})
