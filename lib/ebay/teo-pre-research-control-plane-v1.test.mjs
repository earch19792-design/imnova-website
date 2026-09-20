import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const control = await import("./teo-pre-research-control-plane-v1.ts")
const mcp = readFileSync("lib/ebay/teo-pre-research-control-mcp-v1.ts", "utf8")
const readOnlyMcp = readFileSync("lib/ebay/ebay-seller-os-mcp-server-v1.ts", "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const operator = readFileSync(
  "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")

const candidates = [
  { productId: "101", variantId: "201", sku: "ITEM101" },
  { productId: "102", variantId: "202", sku: "ITEM102" },
]

test("request schema is closed, bounded, identity-only, and deterministic", () => {
  const parsed = control.parseTeoPreResearchRequestV1({
    snapshotId: "11111111-1111-4111-8111-111111111111",
    clientIdempotencyKey: "teo.batch.0001", candidates,
  })
  assert.equal(parsed.candidates.length, 2)
  for (const forbidden of ["ownerUserId", "commandClientId", "contractVersion",
    "sql", "url", "path", "publisher", "commercialTrace"]) {
    assert.throws(() => control.parseTeoPreResearchRequestV1({
      snapshotId: parsed.snapshotId,
      clientIdempotencyKey: parsed.clientIdempotencyKey,
      candidates, [forbidden]: "spoofed",
    }), /BATCH_REQUEST_INVALID/)
  }
  assert.throws(() => control.parseTeoPreResearchCandidatesV1(
    Array.from({ length: 51 }, (_, index) => ({ productId: `${index + 1}`,
      variantId: `${index + 101}`, sku: `ITEM${index}` }))), /BOUNDS_INVALID/)
  assert.throws(() => control.parseTeoPreResearchCandidatesV1(
    [candidates[0], candidates[0]]), /DUPLICATE_CANDIDATE/)
})

test("the isolated command catalog exposes exactly request, get, and resume", () => {
  assert.deepEqual(mcp.match(/"seller_os_(?:request|get|resume)_pre_research_batch"/g), [
    '"seller_os_request_pre_research_batch"',
    '"seller_os_get_pre_research_batch"',
    '"seller_os_resume_pre_research_batch"',
  ])
  assert.doesNotMatch(mcp, /z\.object\(\{\s*(?:sql|url|path):/)
  assert.doesNotMatch(mcp, /import[^\n]*(?:publisher|commercial-trace)/i)
  assert.match(readFileSync(
    "lib/ebay/teo-pre-research-control-plane-v1.ts", "utf8"),
    /marketplaceWrites: 0/)
  assert.doesNotMatch(readOnlyMcp, /teo-pre-research-control|seller_os_request_pre_research_batch/)
})

test("persistent browser runner obtains only an authorized explicit plan", () => {
  assert.match(runner, /GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN/)
  assert.match(runner, /planId = nextPlanId/)
  assert.match(runner,
    /CLAIM_AUTONOMOUS_RESEARCH_PLAN[\s\S]*\.\.\.\(planId \? \{ planId \} : \{\}\)/)
  assert.match(operator,
    /GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN[\s\S]*nextAuthorizedTeoPreResearchPlanV1/)
  assert.match(operator, /globalQueueFallback: 0/)
})

test("normal intake and certified evidence engines are reused rather than duplicated", () => {
  assert.match(readFileSync(
    "lib/ebay/teo-pre-research-control-plane-v1.ts", "utf8"),
    /requestLunaPreResearchV1/)
  assert.doesNotMatch(mcp,
    /buildProductResearchCommercialQueryPlanV1|classifyCommercial|complete_luna_pre_research/)
})
