import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260912211823_autonomous_ebay_stocking_batch_v1.sql",
  "utf8",
)
const runtime = readFileSync(
  "lib/ebay/ebay-autonomous-stocking-batch-server-v1.ts",
  "utf8",
)
const route = readFileSync(
  "app/api/cron/quick-pick-runtime-recovery/route.ts",
  "utf8",
)
const executor = readFileSync(
  "lib/ebay/ebay-current-publication-executor-v1.ts",
  "utf8",
)

test("batch authority is durable, service-role only and preserves the canary singleton", () => {
  assert.match(migration, /seller_os_autonomous_stocking_batches_v1/)
  assert.match(migration, /seller_os_autonomous_stocking_batch_children_v1/)
  assert.match(migration, /force row level security/g)
  assert.match(migration, /from public, anon, authenticated/g)
  assert.match(migration, /is_seller_os_service_role_request_v1/)
  assert.doesNotMatch(migration,
    /delete from public\.seller_os_autonomous_greenfield_canary_v1/i)
  assert.doesNotMatch(migration,
    /update public\.seller_os_autonomous_greenfield_canary_v1/i)
})

test("candidate identities can only be claimed by ordered CURRENT runtime output", () => {
  assert.match(runtime, /collectRadarRevenueFactoryCandidateBatchV1/)
  assert.match(runtime, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(runtime, /autonomousGreenfieldCurrentCertificationReadyV1/)
  assert.match(runtime, /claim_autonomous_stocking_batch_candidate_v1/)
  assert.match(runtime, /manualProductSelection: false/)
  assert.match(runtime, /manualProductIdInjection: false/)
  assert.doesNotMatch(runtime,
    /9220\d{12}|5300\d{13}|FL-[A-Z0-9-]+|ab0f0c2b|366665179743/)
  assert.doesNotMatch(runtime, /allowlist/i)
})

test("children are sequential and require official confirmation plus replay", () => {
  assert.match(migration,
    /prior\.sequence_no < v_child\.sequence_no[\s\S]*prior\.status <> 'REPLAY_CONFIRMED'/)
  assert.match(migration,
    /status <> 'REPLAY_CONFIRMED'[\s\S]*replay_confirmed_at is not null/)
  assert.match(runtime, /child\.status === "PUBLISHED_CONFIRMED"/)
  assert.match(runtime, /replay\.publicationWrites === 0/)
  assert.match(runtime, /IDEMPOTENT_REPLAY_CONFIRMED === true/)
  assert.match(runtime, /SECOND_LISTING_CREATED: false/)
})

test("publication remains concurrency one, no ads and no blind retry", () => {
  assert.match(runtime, /concurrency: 1/g)
  assert.match(runtime, /adsWrites: 0/g)
  assert.match(runtime, /blindRetryAllowed: false/g)
  assert.match(runtime, /status: "UNKNOWN_COMMIT_STATE"/)
  assert.match(runtime, /publishCurrentRevisionV1/)
  assert.match(migration, /ads_write_count = 0/)
})

test("same certified lane delegates only when an active batch exists", () => {
  assert.match(route,
    /AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY[\s\S]*runAutonomousEbayStockingBatchV1/)
  assert.match(runtime,
    /eq\("account_key", input\.accountKey\)\.eq\("status", "ACTIVE"\)/)
  assert.match(runtime, /if \(!read\.data\) return null/)
})

test("three-publication closeout requires three exact writes and replays", () => {
  assert.match(migration,
    /publication_write_count = target_published_count/)
  assert.match(runtime,
    /values\.length !== target[\s\S]*child\.status !== "REPLAY_CONFIRMED"/)
  assert.match(runtime,
    /finalCount - Number\(input\.batch\.baseline_active_count\) !== target/)
  assert.match(runtime, /duplicateListingCount: 0/)
  assert.match(runtime, /duplicateOfferCount: 0/)
})

test("active deltas count physical Item IDs rather than sync registry rows", () => {
  const physicalCount = readFileSync(
    "supabase/migrations/20260912213335_autonomous_stocking_physical_active_count_v1.sql",
    "utf8",
  )
  assert.match(physicalCount, /count\(distinct listing\.ebay_item_id\)/)
  assert.match(physicalCount, /is_seller_os_service_role_request_v1/)
  assert.match(runtime,
    /get_autonomous_stocking_active_listing_count_v1/)
  assert.doesNotMatch(runtime,
    /from\("ebay_active_listings"\)[\s\S]*count: "exact"/)
})

test("batch adapter accepts only the executor's complete duplicate contract", () => {
  assert.match(executor,
    /DUPLICATE_LISTING_CREATED:false,DUPLICATE_OFFER_CREATED:false/)
  assert.match(executor,
    /Number\(collection\.offerCount\)===1/)
  assert.match(runtime,
    /publication\.DUPLICATE_LISTING_CREATED !== false[\s\S]*publication\.DUPLICATE_OFFER_CREATED !== false/)
  assert.match(runtime,
    /replay\.DUPLICATE_LISTING_CREATED === false[\s\S]*replay\.DUPLICATE_OFFER_CREATED === false/)
})
