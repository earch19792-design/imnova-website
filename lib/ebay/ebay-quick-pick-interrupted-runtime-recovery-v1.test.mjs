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

const { projectInterruptedQuickPickClaimV1,
  recoverInterruptedLunaQuickPickRuntimeV1 } = await import(
  "./ebay-quick-pick-interrupted-runtime-recovery-v1.ts")

const key = (character) => `sha256:${character.repeat(64)}`
const batchA = "11111111-1111-4111-8111-111111111111"

function row(character, overrides = {}) {
  return { id: `row-${character}`, candidate_key: key(character),
    updated_at: "2026-09-04T09:00:00.000Z", assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
        batchId: batchA,
      },
      quickPickRequiredSpecificsContinuationV1: {
        contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
        autonomousClaimedAt: "2026-09-04T09:00:00.000Z",
        completedAt: null,
      },
      ...overrides,
    } }
}

test("only stale incomplete durable claims are recovery eligible", () => {
  const now = new Date("2026-09-04T09:06:00.000Z")
  assert.equal(projectInterruptedQuickPickClaimV1({ row: row("a"), now })
    .eligible, true)
  assert.equal(projectInterruptedQuickPickClaimV1({ row: row("b", {
    quickPickRequiredSpecificsContinuationV1: {
      contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
      autonomousClaimedAt: "2026-09-04T09:04:00.000Z",
      completedAt: null,
    },
  }), now }).reasonCode, "CLAIM_NOT_STALE")
  assert.equal(projectInterruptedQuickPickClaimV1({ row: row("c", {
    quickPickRequiredSpecificsContinuationV1: {
      contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
      autonomousClaimedAt: "2026-09-04T09:00:00.000Z",
      completedAt: "2026-09-04T09:01:00.000Z",
    },
  }), now }).reasonCode, "CLAIM_ALREADY_COMPLETED")
})

test("generic recovery groups receipts and reuses the normal runtime path", async () => {
  const calls = []
  const result = await recoverInterruptedLunaQuickPickRuntimeV1({
    supabase: {}, accountKey: "account-1", taxonomyReader: async () => ({}),
    dependencies: {
      now: () => new Date("2026-09-04T09:06:00.000Z"),
      readRows: async () => [row("a"), row("b"), row("c", {
        lunaQuickPickOperationV1: {
          contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
          batchId: "22222222-2222-4222-8222-222222222222",
        },
      })],
      continueRuntime: async (input) => {
        calls.push({ keys: input.candidateKeys, scope: input.scopeMode,
          trigger: input.trigger })
        return { requiredSpecificsContinuation: { claimed:
          input.candidateKeys.length, productsEvaluated:
          input.candidateKeys.length, aiCallCount: 0 } }
      },
    },
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.durableReceiptsDiscovered, 3)
  assert.equal(result.durableScopeCount, 2)
  assert.equal(result.claimedCount, 3)
  assert.equal(result.productsEvaluated, 3)
  assert.equal(result.aiCallCount, 0)
  assert.equal(result.ownerSecondClickRequired, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.deepEqual(calls.map((entry) => [entry.keys.length, entry.scope,
    entry.trigger]), [[2, "EXACT_REQUEST", "DEPENDENCY_RECOVERY"],
    [1, "EXACT_REQUEST", "DEPENDENCY_RECOVERY"]])
})

test("scheduled recovery is generic, authenticated, and contains no batch case", async () => {
  const [route, runtime, vercel] = await Promise.all([
    readFile("app/api/cron/quick-pick-runtime-recovery/route.ts", "utf8"),
    readFile("lib/ebay/ebay-quick-pick-interrupted-runtime-recovery-v1.ts",
      "utf8"),
    readFile("vercel.json", "utf8"),
  ])
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /recoverInterruptedLunaQuickPickRuntimeV1/)
  assert.match(runtime, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(runtime, /DEPENDENCY_RECOVERY/)
  assert.match(vercel, /quick-pick-runtime-recovery/)
  assert.doesNotMatch(`${route}\n${runtime}`, /9798cb33|QP-9798CB33/i)
  assert.doesNotMatch(`${route}\n${runtime}`,
    /publishOffer|createOffer|bulkCreateOffer|OWNER_FACT_CAPTURE/)
})
