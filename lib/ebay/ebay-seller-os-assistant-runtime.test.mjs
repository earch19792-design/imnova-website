import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") &&
        !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try {
        return nextResolve(`${value}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { createSellerOsAssistantMonitorSnapshotLoaderV1 } = await import(
  "./ebay-seller-os-assistant-runtime.ts"
)

test("bounded relay snapshot reuse prevents per-tool Account Traffic amplification", async () => {
  let now = 1_786_579_200_000
  let upstreamLoads = 0
  const loadSnapshot = createSellerOsAssistantMonitorSnapshotLoaderV1({
    loader: async () => {
      upstreamLoads += 1
      return { generatedAt: new Date(now).toISOString() }
    },
    now: () => now,
    maximumAgeMs: 1_000,
  })

  const [first, second, third] = await Promise.all([
    loadSnapshot(), loadSnapshot(), loadSnapshot(),
  ])
  assert.equal(upstreamLoads, 1)
  assert.equal(first.generatedAt, second.generatedAt)
  assert.equal(second.generatedAt, third.generatedAt)

  now += 1_001
  await loadSnapshot()
  assert.equal(upstreamLoads, 2)
})

test("failed snapshots are not cached as current evidence", async () => {
  let upstreamLoads = 0
  const loadSnapshot = createSellerOsAssistantMonitorSnapshotLoaderV1({
    loader: async () => {
      upstreamLoads += 1
      if (upstreamLoads === 1) throw new Error("SOURCE_UNAVAILABLE")
      return { generatedAt: "2026-08-13T12:00:00.000Z" }
    },
  })

  await assert.rejects(loadSnapshot(), /SOURCE_UNAVAILABLE/)
  assert.equal((await loadSnapshot()).generatedAt,
    "2026-08-13T12:00:00.000Z")
  assert.equal(upstreamLoads, 2)
})
