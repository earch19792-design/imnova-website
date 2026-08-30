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

test("429 evidence is not retained by the positive snapshot cache", async () => {
  let upstreamLoads = 0
  const loadSnapshot = createSellerOsAssistantMonitorSnapshotLoaderV1({
    loader: async () => {
      upstreamLoads += 1
      return { generatedAt: "2026-08-29T12:00:00.000Z", backend: {
        trafficScopes: { accountTraffic: {
          cacheHitCount: 0,
          gapCodes: upstreamLoads === 1
            ? ["EBAY_MONITOR_ACCOUNT_TRAFFIC_429"] : [],
        } },
      } }
    },
  })

  await loadSnapshot()
  const recovered = await loadSnapshot()
  assert.equal(upstreamLoads, 2)
  assert.deepEqual(recovered.backend.trafficScopes.accountTraffic.gapCodes, [])
})

test("bounded snapshot reuse exposes Account Traffic cache-hit telemetry without mutating source evidence", async () => {
  const source = { generatedAt: "2026-08-13T12:00:00.000Z", backend: {
    trafficScopes: { accountTraffic: { cacheHitCount: 0,
      upstreamSnapshotAcquisitionCount: 1 } },
  } }
  const loadSnapshot = createSellerOsAssistantMonitorSnapshotLoaderV1({
    loader: async () => source,
  })

  const first = await loadSnapshot()
  const second = await loadSnapshot()
  assert.equal(first.backend.trafficScopes.accountTraffic.cacheHitCount, 0)
  assert.equal(second.backend.trafficScopes.accountTraffic.cacheHitCount, 1)
  assert.equal(second.backend.trafficScopes.accountTraffic
    .upstreamSnapshotAcquisitionCount, 1)
  assert.equal(source.backend.trafficScopes.accountTraffic.cacheHitCount, 0)
})

test("one bounded multi-tool audit keeps one monitor snapshot across sequential listing drilldowns", async () => {
  let now = 1_786_579_200_000
  let upstreamLoads = 0
  const loadSnapshot = createSellerOsAssistantMonitorSnapshotLoaderV1({
    loader: async () => {
      upstreamLoads += 1
      return { generatedAt: new Date(now).toISOString(), backend: {
        trafficScopes: { accountTraffic: { cacheHitCount: 0,
          upstreamSnapshotAcquisitionCount: 1 } },
      } }
    },
    now: () => now,
  })

  for (const operation of ["SYSTEM_REVIEW_BUNDLE", "COMMERCIAL_CONTEXT",
    "LISTING_INTELLIGENCE_1", "LISTING_INTELLIGENCE_2",
    "LISTING_INTELLIGENCE_3"]) {
    const snapshot = await loadSnapshot()
    assert.ok(snapshot.generatedAt)
    assert.ok(operation)
    now += 45_000
  }
  assert.equal(upstreamLoads, 1)
})
