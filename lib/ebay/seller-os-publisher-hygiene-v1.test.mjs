import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildSellerOsPublisherHygieneV1 } from
  "./seller-os-publisher-hygiene-v1.ts"

const now = new Date("2026-10-08T22:00:00.000Z")

test("historical unpublished Offers stay visible without recommending deletion", () => {
  const result = buildSellerOsPublisherHygieneV1({ now, rows: [{
    id: "old", phase: "preview_ready", publish_attempt_count: 0,
    offer_id: "123", updated_at: "2026-09-13T12:00:00.000Z",
  }, {
    id: "manual", phase: "terminal_failure",
    last_error_code: "SUPERSEDED_BY_MANUAL_LIVE_ITEM",
    updated_at: "2026-09-01T12:00:00.000Z",
  }] })
  assert.equal(result.status, "CLEAN")
  assert.equal(result.newPublicationLaneAvailable, true)
  assert.equal(result.historicalUnpublishedCount, 1)
  assert.equal(result.quarantinedFailureCount, 1)
  assert.equal(result.supersededManualCount, 1)
  assert.equal(result.safety.marketplaceDeletes, 0)
  assert.ok(result.records.every((row) =>
    row.marketplaceDeleteRecommended === false))
})

test("ambiguous in-flight publication blocks a new blind write", () => {
  const result = buildSellerOsPublisherHygieneV1({ now, rows: [{
    id: "unknown", phase: "outcome_unknown", publish_attempt_count: 1,
    updated_at: "2026-10-08T21:59:00.000Z",
  }] })
  assert.equal(result.status, "RECONCILIATION_REQUIRED")
  assert.equal(result.newPublicationLaneAvailable, false)
  assert.equal(result.inFlightCount, 1)
  assert.equal(result.records[0].nextAction,
    "RECONCILE_OFFICIAL_READBACK")
})

test("owner dashboard exposes bounded read-only publication hygiene", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  const dashboard = readFileSync(
    "app/admin/seller-os-operational-dashboard.tsx", "utf8")
  assert.match(route, /publicationHygiene/)
  assert.match(route, /buildSellerOsPublisherHygieneV1/)
  assert.match(route, /\.eq\("actor_user_id", auth\.actor\)/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(dashboard, /publicationHygiene=1/)
  assert.match(dashboard, /data-publisher-hygiene/)
  assert.match(dashboard, /Publicador de un botón/)
})
