import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL(
  "../../app/api/cron/teo-listing-improvements/route.ts",
  import.meta.url,
), "utf8")
const migration = readFileSync(new URL(
  "../../supabase/migrations/20261005040816_schedule_teo_daily_listing_improvements_v1.sql",
  import.meta.url,
), "utf8")
const learning = readFileSync(new URL(
  "./ebay-category-performance-learning.ts",
  import.meta.url,
), "utf8")

test("TEO daily route is authenticated, read-only and owner controlled", () => {
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /sellerOsPostRuntimeAuthorizedV1/)
  assert.match(route, /collectionMode: "TEO_OWNER_MANUAL"/)
  assert.match(route, /refreshTeoOwnerListingExperimentsV1/)
  assert.match(route, /ownerConfirmationRequired: true/)
  assert.doesNotMatch(route,
    /ReviseItem|publishOffer|createOffer|updateOffer|automaticPriceChange[^s]/)
})

test("TEO performance memory cannot activate category ranking adjustments", () => {
  assert.match(learning, /if \(teoOwnerManualCollection\) \{[\s\S]*?rankingAdjustmentApplied: false/)
  assert.match(learning, /status: "TEO_SNAPSHOTS_STORED"/)
})

test("TEO has one secured daily POST schedule", () => {
  assert.match(migration, /'TEO_LISTING_IMPROVEMENTS'/)
  assert.match(migration, /'\/api\/cron\/teo-listing-improvements'/)
  assert.match(migration, /'10 13 \* \* \*'/)
  assert.match(migration, /dispatch_seller_os_post_runtime_v1/)
  assert.doesNotMatch(migration, /net\.http_get|create extension|decrypted_secret/)
})
