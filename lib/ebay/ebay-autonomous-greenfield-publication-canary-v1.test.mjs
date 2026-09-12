import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { autonomousGreenfieldCurrentCertificationReadyV1 as ready } from
  "./ebay-autonomous-greenfield-current-certification-v1.ts"

const route = readFileSync(new URL(
  "../../app/api/cron/quick-pick-runtime-recovery/route.ts",
  import.meta.url), "utf8")
const executor = readFileSync(new URL(
  "./ebay-current-publication-executor-v1.ts", import.meta.url), "utf8")
const migration = readFileSync(new URL(
  "../../supabase/migrations/20260912194604_autonomous_greenfield_end_to_end_publication_canary_v1.sql",
  import.meta.url), "utf8")
const start = route.indexOf(
  '"AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY"')
const end = route.indexOf('"CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT"',
  start)
const lane = route.slice(start, end)

test("autonomous lane accepts no caller-selected product identity", () => {
  assert.ok(start > 0 && end > start)
  for (const field of ["productId", "variantId", "supplierSku", "packageId",
    "opportunityId", "candidateId"]) assert.match(lane,
      new RegExp(`"${field}"`))
  assert.match(lane, /MANUAL_PRODUCT_ID_INJECTION_FORBIDDEN/)
  assert.match(lane, /collectRadarRevenueFactoryCandidateBatchV1/)
  assert.match(lane, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(lane, /for \(const outcome of factory\.outcomes\.map\(record\)\)/)
  assert.doesNotMatch(lane, /9220\d{12}|5300\d{10}|FL-NH[A-Z0-9]+/)
})

test("candidate failures remain independent and continuation stays automatic", () => {
  assert.match(lane, /parked: factory\.parked/)
  assert.match(lane, /exceptions: factory\.exceptions/)
  assert.match(lane, /alreadyLiveExcluded/)
  assert.match(lane, /waitingBrowserWorker/)
  assert.match(lane, /AUTONOMOUS_CANDIDATE_CONTINUATION: true/)
  assert.match(lane, /OWNER_ACTION_REQUIRED: false/)
  assert.match(lane, /CODEX_RUNTIME_DEPENDENCY: false/)
})

test("factory-ready GREENFIELD crosses only the CURRENT certification boundary", () => {
  const bridge = {
    listingReady: false,
    firstBlocker: "CURRENT_PUBLICATION_CERTIFICATION_REQUIRED",
    stageStatuses: { PRODUCT_TRUTH_READY: "READY", ECONOMICS_READY: "READY",
      LISTING_PACKAGE_READY: "READY", LISTING_READY: "READY" },
    productTruthExactIdentityMatch: true, productTruthDurable: true,
    productTruthReadbackMatch: true,
    canonicalMarketplaceReadinessReady: true,
    requiredItemSpecificsReady: true, listingPolicyReady: true,
    locationOrInventoryContextReady: true, sellerAccountBindingReady: true,
    marketplaceIdentityReady: true,
  }
  assert.equal(ready(bridge), true)
  assert.equal(ready({ ...bridge, firstBlocker:
    "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR" }), false)
  assert.equal(ready({ ...bridge, stageStatuses: {
    ...bridge.stageStatuses, ECONOMICS_READY: "BLOCKED" } }), false)
})

test("durable singleton and publisher enforce one exact physical commit", () => {
  assert.match(migration,
    /seller_os_autonomous_greenfield_canary_v1[\s\S]*account_key text primary key/)
  assert.match(migration, /claim_autonomous_greenfield_canary_v1/)
  assert.match(migration, /is_seller_os_service_role_request_v1/)
  assert.match(lane, /publishCurrentRevisionV1/)
  assert.match(lane, /concurrency: 1/)
  assert.match(executor, /ONE_EXACT_PUBLICATION_WRITE_ONLY/)
  assert.equal((executor.match(/deps\.publish\(/g) ?? []).length, 1)
  assert.match(executor,
    /UNKNOWN_COMMIT_STATE_OFFICIAL_READBACK_NOT_PUBLISHED_UNPROVEN/)
  assert.match(executor, /blindRetryAllowed:false/)
})

test("completed replay is official-readback only and cannot create a second listing", () => {
  const replay = executor.slice(executor.indexOf("if(p.phase==='monitor_registered')"),
    executor.indexOf("// Every other consumed key"))
  assert.match(replay, /deps\.inventory/)
  assert.match(replay, /deps\.offer/)
  assert.match(replay, /deps\.collection/)
  assert.doesNotMatch(replay, /deps\.publish|deps\.register/)
  assert.match(replay, /ADDITIONAL_PUBLICATION_WRITE_COUNT:0/)
  assert.match(replay, /SECOND_LISTING_CREATED:false/)
  assert.match(replay, /IDEMPOTENT_REPLAY_CONFIRMED:true/)
})

test("scheduler exposes only the protected POST runtime lane", () => {
  assert.match(migration,
    /AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY/)
  assert.match(migration, /\/api\/cron\/quick-pick-runtime-recovery/)
  assert.match(migration, /authorization_secret_name/)
  assert.match(migration, /vercel_bypass_secret_name/)
})
