import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722046000_prepare_extraordinary_position_4_6_replacements.sql",
  import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/reference-guided-extraordinary-replacement/route.ts",
  import.meta.url), "utf8")
const imagesGet = readFileSync(new URL(
  "../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")

const noDeformation =
  "Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product."

test("position 4 chains exact geometry protection without replacing history", () => {
  assert.match(migration, /PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX/)
  assert.match(migration, new RegExp(noDeformation.replaceAll(".", "\\.")))
  assert.match(migration, /MUST preserve exactly two handles/)
  assert.match(migration, /shape, curvature, size, and attachment points/)
  assert.match(migration, /count, distribution, orientation, and relative position of all perforations/)
  assert.match(migration, /complete product without clipping or hidden parts/)
  assert.match(migration, /visible faucet that is switched off/)
  assert.match(migration, /exactly 4 to 6 freshly rinsed strawberries/)
  assert.match(migration, /zero currents, streams, jets, waterfalls, splashes, or drainage/)
  assert.match(migration, /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
})

test("position 6 correction requires an empty background and exact identity", () => {
  assert.match(migration, /EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX/)
  assert.match(migration, /background that is completely empty/)
  assert.match(migration, /MUST NOT show cutting boards in any plane/)
  assert.match(migration, /MUST NOT show jars, containers, or canisters in any plane/)
  assert.match(migration, /MUST NOT show plants or decoration in any plane/)
  assert.match(migration, /MUST NOT show utensils or appliances in any plane/)
  assert.match(migration, /MUST NOT show any recognizable background object/)
  assert.match(migration, /MUST show exactly two real adult hands/)
  assert.match(migration, /Do not deform, warp, stretch, compress/)
})

test("extraordinary plan fixes ordinals, cap, sequence, and one-time consumption", () => {
  assert.match(migration, /CONTROLLED_TWO_POSITION_REPLACEMENT_V1/)
  assert.match(migration, /current_provider_calls integer not null check \(current_provider_calls = 6\)/)
  assert.match(migration, /absolute_cap integer not null check \(absolute_cap = 8\)/)
  assert.match(migration, /max_concurrency integer not null check \(max_concurrency = 1\)/)
  assert.match(migration, /automatic_retries boolean not null check \(not automatic_retries\)/)
  assert.match(migration, /position=4[\s\S]*extraordinary_ordinal=7/)
  assert.match(migration, /position=6[\s\S]*extraordinary_ordinal=8/)
  assert.match(migration, /BLOCKED_UNTIL_POSITION_4_PASSED/)
  assert.match(migration, /extraordinary_ordinal_consumed_once/)
  assert.match(migration, /unique\(correction_plan_id,position,extraordinary_ordinal\)/)
  assert.match(migration, /status='PASSED'/)
  assert.doesNotMatch(migration, /set provider_calls\s*=/)
  assert.doesNotMatch(migration, /OPENAI_API_KEY|\/v1\/images\/edits/)
})

test("authorization endpoint accepts no browser visual authority and remains non-consuming", () => {
  assert.match(route, /AUTHORIZE_POSITION_4/)
  assert.match(route, /AUTHORIZE_POSITION_6/)
  assert.match(route, /browser supplies no plan, prompt, amendment, hash, ordinal, budget/)
  assert.match(route, /providerCallConsumed: false/)
  assert.match(route, /providerCallsCreated: 0/)
  assert.doesNotMatch(route, /OPENAI|CONSUMED|PROVIDER_CALLING/)
  assert.match(migration, /if found then return query select v_existing\.id[\s\S]*true/)
})

test("GET and UI expose individual controls and persistent budget", () => {
  assert.match(imagesGet, /extraordinaryReplacementPlan/)
  assert.match(imagesGet, /providerCallsRemaining/)
  assert.match(workspace, /Autorizar reemplazo controlado · Secundaria 4/)
  assert.match(workspace, /Llamada extraordinaria 7\/8/)
  assert.match(workspace, /Autorizar reemplazo controlado · Secundaria 6/)
  assert.match(workspace, /Llamada extraordinaria 8\/8/)
  assert.match(workspace, /Secundaria 6 permanece bloqueada hasta que el reemplazo de Secundaria 4/)
  assert.match(workspace, /disabled=\{!extraordinaryPositionSixCanAuthorize/)
})
