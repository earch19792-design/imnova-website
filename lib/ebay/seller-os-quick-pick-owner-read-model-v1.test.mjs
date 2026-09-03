import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildQuickPickOwnerReadModelV1,
  projectQuickPickOwnerCardV1,
  QUICK_PICK_OWNER_STAGE_CATALOG_V1,
} from "./seller-os-quick-pick-owner-read-model-v1.ts"

function card(overrides = {}) {
  return {
    sourceUrl: "https://lunaportex.com/products/example",
    candidateKey: "sha256:" + "a".repeat(64),
    state: "WAITING",
    lastStage: "REQUIRED_SPECIFICS",
    disposition: "RESOLVING",
    exactBlocker: null,
    exactBlockers: [],
    stages: {},
    marketTestReady: false,
    listingReview: null,
    ownerTruePublicationBlockers: [],
    ...overrides,
  }
}

test("commercial readiness supersedes stale resolving lifecycle presentation", () => {
  const projected = projectQuickPickOwnerCardV1(card({
    marketTestReady: true,
    state: "READY",
    listingReview: { publishAuthorizationHandoff: {
      ownerPublicationDecisionReady: true,
    } },
  }))
  assert.equal(projected.state, "READY")
  assert.equal(projected.disposition, "MARKET_TEST_READY")
  assert.equal(projected.commercialStage, "MARKET_TEST_READY")
  assert.equal(projected.processingLifecycle, "COMPLETED")
  assert.equal(projected.stages.LISTING_READY, "PASS")
})

test("canonical renderer always projects eleven labeled stages", () => {
  const projected = projectQuickPickOwnerCardV1(card({ stages: null }))
  assert.equal(QUICK_PICK_OWNER_STAGE_CATALOG_V1.length, 11)
  assert.deepEqual(Object.keys(projected.stages),
    QUICK_PICK_OWNER_STAGE_CATALOG_V1.map(([key]) => key))
  assert.ok(QUICK_PICK_OWNER_STAGE_CATALOG_V1.every(([, label]) => label))
})

test("batch and global queue counts retain separate scope and grain", () => {
  const batchReady = card({ marketTestReady: true, state: "READY" })
  const active = card({ sourceUrl: "https://lunaportex.com/products/active",
    state: "RUNNING", stages: { SHIPPING: "RUNNING" } })
  const blocked = card({ sourceUrl: "https://lunaportex.com/products/blocked",
    state: "BLOCKED", exactBlocker: "REAL_BLOCKER",
    exactBlockers: ["REAL_BLOCKER"] })
  const receipt = { batchId: "batch-current", status: "completed",
    candidateKeys: [batchReady.candidateKey], cards: [batchReady],
    receivedAt: "2026-09-03T20:00:00.000Z" }
  const historical = { batchId: "batch-history", status: "completed",
    candidateKeys: [], cards: [blocked, blocked] }
  const readModel = buildQuickPickOwnerReadModelV1({
    receipts: [receipt, historical], selectedBatchCards: [batchReady],
    globalQueueCards: [active, blocked], explicitCandidateScope: false,
  })
  assert.equal(readModel.selectedBatch.summary.readyForReview, 1)
  assert.equal(readModel.selectedBatch.summary.blocked, 0)
  assert.equal(readModel.globalQueue.summary.inProgress, 1)
  assert.equal(readModel.globalQueue.summary.blocked, 1)
  assert.equal(readModel.historicalBatches.excludedCardCount, 2)
  assert.equal(readModel.certificationCanaryOperations
    .excludedFromCurrentBatchCounts, true)
})

test("owner read endpoint is pure and navigation has bounded manual retry", () => {
  const route = readFileSync(
    "app/api/admin/ebay/luna-quick-pick/route.ts", "utf8")
  const getBody = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function POST"))
  const page = readFileSync("app/admin/ebay/quick-pick/page.tsx", "utf8")
  const provider = readFileSync(
    "app/admin/admin-owner-runtime-provider.tsx", "utf8")
  assert.doesNotMatch(getBody,
    /continueLunaQuickPick|requiredSpecifics|materializeSellerOs/)
  assert.match(getBody, /readOnly: true/)
  assert.match(getBody, /continuationExecuted: false/)
  assert.doesNotMatch(page, /setInterval|localStorage/)
  assert.match(page, />Reintentar</)
  assert.doesNotMatch(provider, /setInterval/)
  assert.match(provider, /"READ_FAILED"/)
})
