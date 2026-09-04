import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { continueLunaQuickPickPostShippingRuntimeV1 } = await import(
  "./ebay-quick-pick-post-shipping-continuation-v1.ts")

const candidateA = `sha256:${"a".repeat(64)}`
const candidateB = `sha256:${"b".repeat(64)}`

test("one shared mutating coordinator resolves the durable batch before readiness", async () => {
  const calls = []
  const result = await continueLunaQuickPickPostShippingRuntimeV1({
    supabase: {}, accountKey: "account-1", candidateKeys: [candidateA],
    taxonomyReader: async () => ({}),
    dependencies: {
      readBatchScope: async () => [candidateA, candidateB],
      continueRequiredSpecifics: async (input) => {
        calls.push(["REQUIRED_SPECIFICS", input.candidateKeys, input.trigger])
        return { completedCount: 2 }
      },
      continueMinimumReadiness: async (input) => {
        calls.push(["MINIMUM_READINESS", input.candidateKeys])
        return { marketTestReadyCount: 2 }
      },
    },
  })
  assert.deepEqual(calls, [
    ["REQUIRED_SPECIFICS", [candidateA, candidateB], "IMMEDIATE"],
    ["MINIMUM_READINESS", [candidateA, candidateB]],
  ])
  assert.equal(result.requestedCandidateCount, 1)
  assert.equal(result.scopedCandidateCount, 2)
  assert.equal(result.retryConsumerPresent, true)
  assert.equal(result.overnightDependency, false)
  assert.equal(result.marketplaceWrites, 0)
})

test("invalid or empty scope cannot invoke a mutating continuation", async () => {
  let callCount = 0
  const result = await continueLunaQuickPickPostShippingRuntimeV1({
    supabase: {}, accountKey: "account-1", candidateKeys: ["not-a-key"],
    taxonomyReader: async () => ({}),
    dependencies: {
      readBatchScope: async () => { callCount += 1; return [] },
      continueRequiredSpecifics: async () => { callCount += 1; return {} },
      continueMinimumReadiness: async () => { callCount += 1; return {} },
    },
  })
  assert.equal(callCount, 0)
  assert.equal(result.scopedCandidateCount, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("GET remains read-only while every normal mutating path uses the coordinator", async () => {
  const [route, shipping, radar, coordinator] = await Promise.all([
    readFile("app/api/admin/ebay/luna-quick-pick/route.ts", "utf8"),
    readFile("app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8"),
    readFile("lib/ebay/ebay-radar-luna-quick-pick-handoff-v1.ts", "utf8"),
    readFile("lib/ebay/ebay-quick-pick-post-shipping-continuation-v1.ts", "utf8"),
  ])
  const getBody = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function POST"))
  const postBody = route.slice(route.indexOf("export async function POST"))
  assert.doesNotMatch(getBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(getBody, /continuationExecuted: false/)
  assert.match(postBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(shipping, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(radar, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.equal((coordinator.match(
    /export async function continueLunaQuickPickPostShippingRuntimeV1/g) ?? [])
    .length, 1)
  assert.doesNotMatch([route, shipping, radar, coordinator].join("\n"),
    /publishOffer|createOffer|bulkCreateOffer/)
})
