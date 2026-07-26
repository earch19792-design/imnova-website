import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLunaCatalogCoverageManifest,
  buildLunaCatalogResumeState,
  evaluateLunaCollectionCoverage,
  selectLunaRoundRobinWindow,
} from "./luna-catalog-coverage-domain.ts"

function checkpoint(page, receivedProducts, overrides = {}) {
  return {
    collection: "products",
    page,
    pageLimit: 250,
    maxPages: 30,
    receivedProducts,
    uniqueProducts: receivedProducts,
    uniqueVariants: receivedProducts,
    missingIdentityCount: 0,
    duplicateProductCount: 0,
    collisionCount: 0,
    attempts: 1,
    sourceObservedAt: "2026-07-26T12:00:00.000Z",
    fetchedAt: "2026-07-26T12:00:01.000Z",
    checksum: String(page).padStart(64, "0"),
    etag: null,
    errorCode: null,
    ...overrides,
  }
}

test("simulated page 30 full checkpoint is TRUNCATED", () => {
  const coverage = evaluateLunaCollectionCoverage({
    collection: "products",
    pages: [checkpoint(30, 250)],
  })
  assert.equal(coverage.status, "TRUNCATED")
})

test("simulated failed collection does not discard other collections", () => {
  const successful = evaluateLunaCollectionCoverage({
    collection: "products",
    expectedTotal: 2,
    pages: [checkpoint(1, 2)],
  })
  const failed = evaluateLunaCollectionCoverage({
    collection: "weekly-deals",
    pages: [
      checkpoint(1, 0, {
        collection: "weekly-deals",
        errorCode: "LUNA_CATALOG_HTTP_503",
      }),
    ],
  })
  const manifest = buildLunaCatalogCoverageManifest({
    collections: [failed, successful],
    uniqueProducts: 2,
    uniqueVariants: 2,
  })
  assert.equal(successful.uniqueProducts, 2)
  assert.equal(failed.status, "FAILED")
  assert.equal(manifest.status, "PARTIAL")
})

test("simulated restart resumes from the first uncommitted page", () => {
  const persisted = [
    {
      checkpoint: checkpoint(1, 250),
      products: [{ id: "p1" }],
    },
    {
      checkpoint: checkpoint(2, 250),
      products: [{ id: "p2" }],
    },
    {
      checkpoint: checkpoint(3, 0, {
        errorCode: "LUNA_CATALOG_HTTP_503",
      }),
      products: [],
    },
  ]
  const resume = buildLunaCatalogResumeState(persisted)
  assert.equal(resume.nextPage, 3)
  assert.deepEqual(
    resume.products.map(product => product.id),
    ["p1", "p2"],
  )
  assert.deepEqual(
    resume.pages.map(page => page.page),
    [1, 2],
  )
})

test("simulated durable round-robin eventually covers more than 300", () => {
  const candidates = Array.from(
    { length: 901 },
    (_, index) => ({ id: String(index).padStart(4, "0") }),
  )
  const visited = new Set()
  let persistedCursor = 0
  for (let run = 0; run < 4; run += 1) {
    const window = selectLunaRoundRobinWindow({
      candidates,
      cursor: persistedCursor,
      limit: 300,
      key: candidate => candidate.id,
    })
    window.selected.forEach(candidate => visited.add(candidate.id))
    persistedCursor = window.nextCursor
  }
  assert.equal(visited.size, 901)
  assert.equal(persistedCursor, 299)
})
