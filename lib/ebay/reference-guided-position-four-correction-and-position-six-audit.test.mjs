import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const correction = readFileSync(new URL(
  "../../supabase/migrations/20260722041000_position_4_water_identity_correction_amendment.sql",
  import.meta.url), "utf8")
const plan = readFileSync(new URL(
  "./reference-guided-final-batch-plan-v2.ts", import.meta.url), "utf8")

test("position 4 correction is append-only and chained to the prior amendment", () => {
  assert.match(correction,
    /ebay_reference_guided_position_4_correction_amendments/)
  assert.match(correction,
    /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(correction, /force row level security/)
  assert.match(correction, /to service_role/)
  assert.match(correction, /5fdc0614-8467-4d0c-97e9-9fc4c99828f7/)
  assert.match(correction, /d360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747/)
  assert.match(correction, /RUNNING_WATER_REQUIREMENT/)
  assert.match(correction, /WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX/)
})

test("position 4 corrected prompt restrains water and identity", () => {
  for (const phrase of [
    "visible faucet that is switched off",
    "exactly 4 to 6 freshly rinsed strawberries",
    "small residual droplets",
    "zero water exiting perforations, bottom, or base",
    "MUST NOT show running water",
    "MUST NOT show water streams",
    "MUST NOT show waterfalls",
    "MUST NOT show dramatic splashes",
    "MUST NOT alter the perforation pattern",
    "MUST NOT alter the base geometry",
  ]) assert.match(correction, new RegExp(phrase))
  assert.match(correction,
    /resolve_ebay_reference_guided_position_4_corrected_contract/)
  assert.doesNotMatch(correction, /insert[\s\S]{0,300}'AUTHORIZED'/)
  assert.doesNotMatch(correction, /insert[\s\S]{0,300}'CONSUMED'/)
  assert.doesNotMatch(correction, /set provider_calls =/)
})

test("position 6 audit exposes requirements that need an amendment", () => {
  const positionSix = plan.slice(plan.indexOf("  6: {"),
    plan.indexOf("} as const"))
  assert.match(positionSix, /MUST show two real human hands holding the two handles/)
  assert.match(positionSix, /exact product empty, complete, and clearly visible/)
  assert.match(positionSix, /conspicuous jewelry/)
  assert.match(positionSix, /complete empty product, both handles, rim, perforations, body, and base/)
  assert.match(positionSix, /DISTINCT_COMMERCIAL_COMPOSITION/)
  assert.doesNotMatch(positionSix, /exactly two adult hands/i)
  assert.doesNotMatch(positionSix, /one hand (?:holding|on) each handle/i)
  assert.doesNotMatch(positionSix, /no person or face/i)
  assert.doesNotMatch(positionSix, /additional or fused fingers/i)
  assert.match(positionSix, /water, food, or utensils inside the product/)
})
