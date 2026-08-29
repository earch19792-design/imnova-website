import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { selectSellerOsLunaStockFreshnessRenewalsV1 } = await import(
  "./ebay-luna-stock-freshness-renewal-v1.ts")
const { classifyPersistedLunaStockObservationStateV1 } = await import(
  "./ebay-stock-identity-auto-reconciliation-v1.ts")

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260828195337_post_publish_luna_linkage_handoff_v1.sql",
  import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/draft-only/route.ts", import.meta.url), "utf8")
const cron = readFileSync(new URL(
  "../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
  import.meta.url), "utf8")
const reconciliation = readFileSync(new URL(
  "./ebay-stock-identity-auto-reconciliation-v1.ts", import.meta.url), "utf8")
const existingDispatcher = readFileSync(new URL(
  "../../.github/workflows/ebay-commercial-preview-monitor.yml",
  import.meta.url), "utf8")
const recurrenceMigration = readFileSync(new URL(
  "../../supabase/migrations/20260829033206_scope_luna_monitor_to_canonical_live_cohort.sql",
  import.meta.url), "utf8")
const recurrenceAuthMigration = readFileSync(new URL(
  "../../supabase/migrations/20260829035030_use_dedicated_preview_cron_authorization_header.sql",
  import.meta.url), "utf8")

function listing(overrides = {}) {
  return {
    itemId: "366634810965",
    liveStatus: "LIVE_ACTIVE",
    supplierLinkageStatus: "CERTIFIED",
    limitationCode: null,
    freshness: { status: "FRESH", ageSeconds: 1_000,
      maximumAgeSeconds: 21_600 },
    ...overrides,
  }
}

test("POST_PUBLISH_EXACT_LINEAGE_HANDOFF -> CERTIFIED", () => {
  assert.match(migration,
    /handoff_ebay_authorized_publication_luna_linkage_v1/)
  assert.match(migration,
    /DURABLE_CANDIDATE_PACKAGE_PUBLICATION_LINEAGE/)
  assert.match(migration, /'status', 'CERTIFIED'/)
  assert.match(migration, /seller_os_luna_linkage_decisions/)
  assert.match(migration, /canonicalSupplierLineage/)
  const handoff = route.indexOf(
    "handoff_ebay_authorized_publication_luna_linkage_v1")
  const monitorCompletion = route.indexOf(
    "complete_ebay_authorized_listing_monitor_registration", handoff)
  assert.ok(handoff > 0 && monitorCompletion > handoff)
})

test("POST_PUBLISH_IDENTITY_MISMATCH -> FAIL_CLOSED", () => {
  assert.match(migration, /POST_PUBLISH_LUNA_LINEAGE_IDENTITY_MISMATCH/)
  assert.match(migration,
    /POST_PUBLISH_LUNA_LINEAGE_EXISTING_DECISION_CONFLICT/)
  assert.match(route,
    /EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED/)
})

test("NO_TITLE_BASED_LINKAGE_INFERENCE", () => {
  assert.doesNotMatch(migration,
    /v_active\.title\s*(?:=|is distinct from|like|ilike)/i)
  assert.match(migration, /'titleInferenceUsed', false/)
})

test("NO_EBAY_SKU_AS_SUPPLIER_IDENTITY", () => {
  assert.match(migration,
    /'sourceSku', v_opportunity\.supplier_sku/)
  assert.doesNotMatch(migration,
    /'sourceSku',\s*(?:v_active\.ebay_sku|v_publication\.sku)/)
  assert.match(migration, /'ebaySkuUsedAsSupplierIdentity', false/)
})

test("FRESHNESS_RENEWS_BEFORE_TTL from each evidence contract", () => {
  const result = selectSellerOsLunaStockFreshnessRenewalsV1({
    schedulerIntervalSeconds: 900,
    listings: [listing({ freshness: { status: "FRESH", ageSeconds: 19_500,
      maximumAgeSeconds: 21_600 } })],
  })
  assert.deepEqual(result.targetItemIds, ["366634810965"])
  assert.equal(result.outcomes[0].reasonCode, "APPROACHING_EVIDENCE_TTL")
  assert.equal(result.outcomes[0].renewalLeadSeconds, 2_160)
})

test("FRESH_OUTSIDE_RENEWAL_WINDOW -> SKIP_CURRENT", () => {
  const result = selectSellerOsLunaStockFreshnessRenewalsV1({
    schedulerIntervalSeconds: 900,
    listings: [listing()],
  })
  assert.deepEqual(result.targetItemIds, [])
  assert.equal(result.outcomes[0].reasonCode, "EVIDENCE_CURRENT")
})

test("STALE_EVIDENCE_AUTO_REFRESH and missing evidence are due", () => {
  const result = selectSellerOsLunaStockFreshnessRenewalsV1({
    schedulerIntervalSeconds: 900,
    listings: [
      listing({ itemId: "366634810965", freshness: { status: "STALE",
        ageSeconds: 30_000, maximumAgeSeconds: 21_600 } }),
      listing({ itemId: "366592485792", freshness: { status: "UNKNOWN",
        ageSeconds: null, maximumAgeSeconds: null } }),
    ],
  })
  assert.deepEqual(result.targetItemIds,
    ["366592485792", "366634810965"])
})

test("MULTIPLE_RENEWAL_CYCLES_IDEMPOTENT", () => {
  const input = { schedulerIntervalSeconds: 900,
    listings: [listing({ freshness: { status: "STALE", ageSeconds: 30_000,
      maximumAgeSeconds: 21_600 } })] }
  assert.deepEqual(selectSellerOsLunaStockFreshnessRenewalsV1(input),
    selectSellerOsLunaStockFreshnessRenewalsV1(input))
  assert.match(reconciliation, /repository\.ensureJob/)
  assert.match(reconciliation, /repository\.ensureObservation/)
})

test("NULL_SUPPLIER_QUANTITY_NOT_OOS", () => {
  assert.equal(classifyPersistedLunaStockObservationStateV1({
    sourceAvailable: true,
    stockState: "IN_STOCK",
    observedSupplierQuantity: null,
  }), "OBSERVED_IN_STOCK")
})

test("EXPLICIT_CERTIFIED_OOS -> OOS", () => {
  assert.equal(classifyPersistedLunaStockObservationStateV1({
    sourceAvailable: true,
    stockState: "CERTIFIED_OOS",
    observedSupplierQuantity: null,
  }), "OBSERVED_OUT_OF_STOCK")
})

test("REFRESH_ERROR -> UNKNOWN_NOT_OOS", () => {
  assert.equal(classifyPersistedLunaStockObservationStateV1({
    sourceAvailable: false,
    stockState: "CERTIFIED_OOS",
    observedSupplierQuantity: 0,
  }), "UNKNOWN")
})

test("24_INVALID_NONLIVE_LEGACY_ROWS + 10_CANONICAL_LIVE_CERTIFIED -> DISPATCH_ALLOWED", () => {
  assert.match(recurrenceMigration,
    /v_lane in \('COMMERCIAL_MONITOR', 'ALERT_DISPATCHER'\)/)
  assert.match(recurrenceMigration,
    /elsif v_lane = 'LUNA_MONITOR'/)
  assert.match(recurrenceMigration,
    /CANONICAL_CURRENT_LIVE_COHORT_SCOPED_IN_WORKER/)
  assert.match(recurrenceMigration,
    /'nonLiveLegacyRowsBlockDispatch', false/)
  assert.match(recurrenceMigration, /'legacyMonitoringDebt', v_state/)
})

test("NONLIVE_LEGACY_INVALID_ROWS -> NOT_IN_LIVE_DENOMINATOR", () => {
  const nonLive = Array.from({ length: 24 }, (_, index) => listing({
    itemId: String(100_000_000 + index),
    liveStatus: "NOT_CURRENT_LIVE",
    freshness: { status: "STALE", ageSeconds: 30_000,
      maximumAgeSeconds: 21_600 },
  }))
  const current = Array.from({ length: 10 }, (_, index) => listing({
    itemId: String(200_000_000 + index),
    freshness: { status: "STALE", ageSeconds: 30_000,
      maximumAgeSeconds: 21_600 },
  }))
  const result = selectSellerOsLunaStockFreshnessRenewalsV1({
    schedulerIntervalSeconds: 900,
    listings: [...nonLive, ...current],
  })
  assert.equal(result.targetItemIds.length, 10)
  assert.equal(result.outcomes.filter((outcome) =>
    outcome.reasonCode === "NOT_CURRENT_LIVE").length, 24)
})

test("ONE_LISTING_FAILURE -> OTHERS_CONTINUE and failure stays UNKNOWN", () => {
  assert.match(reconciliation,
    /for \(const target of targets\) \{\s+try \{/)
  assert.match(reconciliation,
    /catch \(error\) \{[\s\S]*?status: "REFRESH_FAILED"/)
  const failureBranch = reconciliation.slice(
    reconciliation.indexOf("} catch (error) {"),
    reconciliation.indexOf("  return Object.freeze({",
      reconciliation.indexOf("} catch (error) {")),
  )
  assert.match(failureBranch,
    /stockState: "STOCK_UNKNOWN", sourceStatus: "UNAVAILABLE"/)
  assert.doesNotMatch(failureBranch, /CERTIFIED_OOS/)
})

test("canonical recurrence reuses the scheduler and creates no parallel control plane", () => {
  assert.doesNotMatch(recurrenceMigration,
    /create\s+table|cron\.schedule|create\s+(?:or\s+replace\s+)?function/i)
  assert.match(recurrenceMigration,
    /dispatch_ebay_monitoring_staging_worker\(text,timestamptz\)/)
  assert.match(recurrenceMigration,
    /EXACT_ACTIVE_LISTING_STATE_REQUIRED/)
})

test("existing Preview dispatcher uses the route's dedicated authorization header", () => {
  assert.match(recurrenceAuthMigration,
    /'x-ebay-commercial-authorization', 'Bearer ' \|\| v_authorization_secret/)
  assert.match(recurrenceAuthMigration,
    /dispatch_ebay_monitoring_staging_worker\(text,timestamptz\)/)
  assert.doesNotMatch(recurrenceAuthMigration,
    /create\s+table|cron\.schedule|create\s+(?:or\s+replace\s+)?function/i)
})

test("NO_DUPLICATE_STOCKGUARD_ROWS and NO_EBAY_QUANTITY_MUTATION", () => {
  assert.doesNotMatch(migration, /insert into public\.ebay_active_listings/i)
  assert.doesNotMatch(reconciliation,
    /availableQuantity|ebay_quantity|ReviseFixedPriceItem|publishOffer/)
  assert.match(migration, /if not v_idempotent then/)
})

test("existing scheduler is reused and refresh-only forces MARKETPLACE_WRITES=0", () => {
  assert.match(cron, /selectSellerOsLunaStockFreshnessRenewalsV1/)
  assert.match(cron, /refreshOnly \? 0 : 1/)
  assert.doesNotMatch(cron, /LUNA_PRODUCTION_POLLING_CANARY_ITEM_ID/)
  assert.doesNotMatch(cron, /cron\.schedule|new .*scheduler/i)
  assert.match(reconciliation, /ebayWrites: 0 as const/)
  assert.match(existingDispatcher, /refresh_only:/)
  assert.match(existingDispatcher,
    /ebay-active-listing-luna-monitor\$query/)
  assert.equal((existingDispatcher.match(
    /inputs\.refresh_only != true/g) ?? []).length, 2)
})

test("stock observation TTL comes from durable evidence, not a universal constant", () => {
  assert.match(reconciliation, /evidence_maximum_age_seconds/)
  assert.match(reconciliation,
    /maximumAgeSeconds: seed\.maximumAgeSeconds/)
  assert.doesNotMatch(reconciliation, /maximumAgeSeconds:\s*21_600/)
})
