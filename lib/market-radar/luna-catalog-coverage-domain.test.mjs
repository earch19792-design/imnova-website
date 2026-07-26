import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLunaCatalogCoverageManifest,
  evaluateLunaCatalogExecutionWindow,
  evaluateLunaCollectionCoverage,
  lunaRetryDelayMs,
  mergeLunaVariantSets,
  selectLunaRoundRobinWindow,
} from "./luna-catalog-coverage-domain.ts"

function page(overrides = {}) {
  return {
    collection: "products", page: 1, pageLimit: 250, maxPages: 30,
    receivedProducts: 10, uniqueProducts: 10, uniqueVariants: 10,
    missingIdentityCount: 0, duplicateProductCount: 0, collisionCount: 0,
    attempts: 1, sourceObservedAt: "2026-07-26T12:00:00.000Z",
    fetchedAt: "2026-07-26T12:00:01.000Z", checksum: "a".repeat(64),
    etag: null, errorCode: null, ...overrides,
  }
}

test("empty catalog is FAILED and never reports 100 percent", () => {
  const collection = evaluateLunaCollectionCoverage({
    collection: "products",
    pages: [page({ receivedProducts: 0, uniqueProducts: 0, uniqueVariants: 0 })],
  })
  const manifest = buildLunaCatalogCoverageManifest({
    collections: [collection], uniqueProducts: 0, uniqueVariants: 0,
  })
  assert.equal(collection.status, "FAILED")
  assert.equal(manifest.status, "FAILED")
  assert.equal(manifest.coveragePercent, null)
})

test("full page 30 is TRUNCATED", () => {
  const collection = evaluateLunaCollectionCoverage({
    collection: "products",
    pages: [page({ page: 30, receivedProducts: 250, uniqueProducts: 250 })],
  })
  assert.equal(collection.status, "TRUNCATED")
})

test("one failed collection leaves successful collections available", () => {
  const good = evaluateLunaCollectionCoverage({
    collection: "products", expectedTotal: 10, pages: [page()],
  })
  const failed = evaluateLunaCollectionCoverage({
    collection: "weekly-deals",
    pages: [page({
      collection: "weekly-deals", receivedProducts: 0, uniqueProducts: 0,
      uniqueVariants: 0, errorCode: "LUNA_HTTP_503",
    })],
  })
  assert.equal(buildLunaCatalogCoverageManifest({
    collections: [failed, good], uniqueProducts: 10, uniqueVariants: 10,
  }).status, "PARTIAL")
})

test("round-robin eventually covers more than 300 candidates", () => {
  const candidates = Array.from({ length: 725 }, (_, id) => ({ id: String(id) }))
  const visited = new Set()
  let cursor = 0
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const window = selectLunaRoundRobinWindow({
      candidates, cursor, limit: 300,
      key: candidate => candidate.id.padStart(4, "0"),
    })
    window.selected.forEach(candidate => visited.add(candidate.id))
    cursor = window.nextCursor
  }
  assert.equal(visited.size, 725)
})

test("variant merge loses no variant", () => {
  const merged = mergeLunaVariantSets(
    [{ id: "1" }, { id: "2" }],
    [{ id: "2" }, { id: "3" }],
    variant => variant.id,
  )
  assert.deepEqual(merged.map(item => item.id), ["1", "2", "3"])
})

test("retry honors Retry-After and bounded exponential delay", () => {
  assert.equal(lunaRetryDelayMs({ attempt: 0, retryAfter: "3" }), 3_000)
  assert.equal(lunaRetryDelayMs({
    attempt: 2, jitterUnit: 0, baseDelayMs: 500, maximumDelayMs: 30_000,
  }), 2_000)
})

test("execution window stops before the route deadline", () => {
  assert.deepEqual(evaluateLunaCatalogExecutionWindow({
    nowMs: 38_000,
    deadlineAtMs: 42_000,
    pagesProcessed: 2,
    maxPages: 4,
    minimumRemainingMs: 5_000,
  }), {
    canStartNextPage: false,
    remainingMs: 4_000,
    reason: "DEADLINE",
  })
})

test("execution window caps pages without treating the checkpoint as failure", () => {
  const decision = evaluateLunaCatalogExecutionWindow({
    nowMs: 10_000,
    deadlineAtMs: 42_000,
    pagesProcessed: 4,
    maxPages: 4,
    minimumRemainingMs: 5_000,
  })
  assert.equal(decision.canStartNextPage, false)
  assert.equal(decision.reason, "PAGE_LIMIT")
})
