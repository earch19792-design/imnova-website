import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const historicalPath = new URL(
  "../../supabase/migrations/20260822192955_create_seller_os_prelinked_family_demand_gate.sql",
  import.meta.url,
)
const hotfixPath = new URL(
  "../../supabase/migrations/20260823001407_fix_seller_os_radar_jsonb_scalar_precedence.sql",
  import.meta.url,
)
const historical = readFileSync(historicalPath, "utf8")
const hotfix = readFileSync(hotfixPath, "utf8")

function functionBody(source, name) {
  return source.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  ))?.[0] ?? ""
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function canonicalFamilyId(identity) {
  const structured = Object.entries(identity.structuredDefinition)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
  return `market-family-v1:sha256:${sha256([
    "SELLER_OS_MARKET_FAMILY_ID_V1",
    identity.productFunction,
    identity.buyerUseCase,
    identity.category,
    structured,
  ].join("\n"))}`
}

function structuredDefinitionHasOnlySupportedScalars(identity) {
  return Object.values(identity.structuredDefinition).every(
    (value) => typeof value === "string" && value.length > 0,
  )
}

test("historical applied artifact remains byte-identical", () => {
  assert.equal(sha256(historical),
    "33cf05633e90738f5f6828c3ce32567d503a320fc8b3a9acc07957442f44bb7b")
})

test("hotfix replaces exactly the two affected functions", () => {
  const names = [...hotfix.matchAll(
    /create or replace function public\.([a-z0-9_]+)\(/g,
  )].map((match) => match[1])
  assert.deepEqual(names, [
    "seller_os_market_family_id_v1",
    "put_seller_os_prelinked_launch_family_evaluation_v1",
  ])
  assert.doesNotMatch(hotfix, /\b(?:create|alter|drop)\s+table\b/i)
})

test("replacement definitions differ only by JSONB scalar precedence", () => {
  for (const name of [
    "seller_os_market_family_id_v1",
    "put_seller_os_prelinked_launch_family_evaluation_v1",
  ]) {
    const before = functionBody(historical, name)
    const after = functionBody(hotfix, name)
    assert.ok(before.length > 0 && after.length > 0)
    assert.equal(after, before.replace(
      "item.key || '=' || item.value #>> '{}'",
      "item.key || '=' || (item.value #>> '{}')",
    ))
  }
  assert.doesNotMatch(hotfix,
    /item\.key \|\| '=' \|\| item\.value #>> '\{\}'/)
  assert.equal(hotfix.match(/item\.key \|\| '=' \|\| \(item\.value #>> '\{\}'\)/g)?.length, 2)
})

test("family identity is deterministic across JSON key order", () => {
  const left = {
    productFunction: "adapt an electric vehicle connector",
    buyerUseCase: "charge an electric vehicle",
    category: "electric vehicle adapters",
    structuredDefinition: {
      connectorclass: "nema outlet",
      producttype: "outlet adapter",
    },
  }
  const right = {
    ...left,
    structuredDefinition: {
      producttype: "outlet adapter",
      connectorclass: "nema outlet",
    },
  }
  const first = canonicalFamilyId(left)
  assert.equal(first, canonicalFamilyId(left))
  assert.equal(first, canonicalFamilyId(right))
  assert.match(first, /^market-family-v1:sha256:[0-9a-f]{64}$/)
})

test("existing scalar contract accepts strings and rejects numeric boolean and null", () => {
  const base = {
    productFunction: "adapt an electric vehicle connector",
    buyerUseCase: "charge an electric vehicle",
    category: "electric vehicle adapters",
  }
  assert.equal(structuredDefinitionHasOnlySupportedScalars({
    ...base, structuredDefinition: { producttype: "outlet adapter" },
  }), true)
  for (const value of [1, true, null]) {
    assert.equal(structuredDefinitionHasOnlySupportedScalars({
      ...base, structuredDefinition: { producttype: value },
    }), false)
  }
  assert.match(historical, /jsonb_typeof\(item\.value\) <> 'string'/)
})

test("evaluation replacement preserves hard gates and reaches fixed profile path", () => {
  const evaluation = functionBody(hotfix,
    "put_seller_os_prelinked_launch_family_evaluation_v1")
  assert.match(evaluation,
    /item\.key \|\| '=' \|\| \(item\.value #>> '\{\}'\)/)
  for (const guard of [
    "SELLER_OS_PRELINKED_FAMILY_EVALUATION_STALE_SOURCE",
    "SELLER_OS_PRELINKED_FAMILY_EVALUATION_OBSERVATION_STALE",
    "SELLER_OS_PRELINKED_FAMILY_EVALUATION_ENROLLMENT_REQUIRED",
    "SELLER_OS_PRELINKED_FAMILY_EVALUATION_GATE_MISMATCH",
    "p2_gate_bypass_allowed = false",
  ]) assert.match(evaluation, new RegExp(guard))
  assert.match(historical,
    /seller_os_opportunity_case_id_v1[\s\S]*?demand-first-test-launch/)
  assert.match(historical,
    /assert_seller_os_prelinked_current_test_launch_gate_v1/)
})
