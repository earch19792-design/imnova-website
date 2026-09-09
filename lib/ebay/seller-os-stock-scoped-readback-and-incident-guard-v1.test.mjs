import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const repository = await import("./commercial-monitor-readonly-repository.ts")
const renewal = await import("./ebay-luna-stock-freshness-renewal-v1.ts")
const stock = await import("./ebay-stock-identity-auto-reconciliation-v1.ts")
const guard = await import(
  "../seller-os/incident-cohort-reconciler-authority-guard-v1.ts")

class Query {
  constructor(table, rows, calls) {
    this.table = table
    this.rows = rows
    this.calls = calls
    this.filters = []
    this.maximum = Infinity
    this.call = { table, columns: null, filters: this.filters, limit: null }
    calls.push(this.call)
  }
  select(columns) { this.call.columns = columns; return this }
  eq(column, value) {
    this.filters.push({ kind: "eq", column, value }); return this
  }
  in(column, values) {
    this.filters.push({ kind: "in", column, values: [...values] }); return this
  }
  order() { return this }
  limit(value) { this.maximum = value; this.call.limit = value; return this }
  then(resolve, reject) {
    const filtered = this.rows.filter((row) => this.filters.every((filter) =>
      filter.kind === "eq" ? row[filter.column] === filter.value
        : filter.values.includes(row[filter.column]))).slice(0, this.maximum)
    return Promise.resolve({ data: filtered, error: null }).then(resolve, reject)
  }
}

function fakeSupabase(tables) {
  const calls = []
  return { calls, from(table) { return new Query(table, tables[table] ?? [], calls) } }
}

const account = "account-a"
const item = "366650000001"
const jobId = `luna-stock-check-v1:sha256:${"a".repeat(64)}`

function job(overrides = {}) {
  return { account_key: account, workflow_state: "SUCCEEDED",
    stock_check_job_id: jobId, linkage_id: "linkage-a", ebay_item_id: item,
    observation_window_start: "2026-09-09T00:00:00.000Z",
    observation_window_end: "2026-09-09T00:15:00.000Z", attempt_count: 1,
    success_receipt_digest: "digest-a", ...overrides }
}

function observation(overrides = {}) {
  return { account_key: account, observation_id: "observation-a",
    stock_check_job_id: jobId, linkage_id: "linkage-a", ebay_item_id: item,
    component_identity_id: "component-a", luna_product_id: "product-a",
    luna_variant_id: "variant-a", luna_sku: "SKU-A",
    supplier_quantity_required: 1, observation_state: "OBSERVED_IN_STOCK",
    source_status: "AVAILABLE", observed_availability: true,
    observed_supplier_quantity: null, evidence_class: "SUPPLIER_STATED",
    evidence_digest: "digest-a", acquisition_method: "CANONICAL_SERVER_READ",
    attempt_number: 1, observed_at: "2026-09-09T00:14:00.000Z",
    maximum_age_seconds: 21600,
    limitations: ["NUMERIC_SAFE_CAPACITY_UNPROVEN"], ...overrides }
}

test("SCOPED_READBACK_WITH_5000_HISTORICAL_ROWS_PASS and NEW_OBSERVATION_VISIBLE_PASS", async () => {
  const historical = Array.from({ length: 5_000 }, (_, index) => job({
    stock_check_job_id: `historical-${index}`, ebay_item_id: "366640000000",
  }))
  const db = fakeSupabase({ seller_os_luna_stock_check_jobs:
    [...historical, job()] })
  const result = await repository.readCanonicalLunaStockJobs(db, account, {
    itemIds: [item], stockCheckJobIds: [jobId],
  })
  assert.equal(result.status, "AVAILABLE")
  assert.deepEqual(result.rows.map((row) => row.stock_check_job_id), [jobId])
  assert.equal(db.calls[0].limit, 21)
  assert.notEqual(db.calls[0].columns, "*")
})

test("ACCOUNT_SCOPE_ISOLATION_PASS PLAN_SCOPE_ISOLATION_PASS ITEM_SCOPE_ISOLATION_PASS", async () => {
  const otherJob = `luna-stock-check-v1:sha256:${"b".repeat(64)}`
  const db = fakeSupabase({ seller_os_luna_stock_observations: [
    observation(),
    observation({ account_key: "account-b", observation_id: "cross-account" }),
    observation({ stock_check_job_id: otherJob, observation_id: "cross-generation" }),
    observation({ ebay_item_id: "366650000002", observation_id: "cross-item" }),
  ] })
  const result = await repository.readCanonicalLunaStockObservations(
    db, account, { itemIds: [item], stockCheckJobIds: [jobId] })
  assert.equal(result.status, "AVAILABLE")
  assert.deepEqual(result.rows.map((row) => row.observation_id), ["observation-a"])
  assert.equal(db.calls[0].limit, 401)
  assert.notEqual(db.calls[0].columns, "*")
})

function listing(itemId) {
  return { itemId, liveStatus: "LIVE_ACTIVE",
    supplierLinkageStatus: "CERTIFIED", limitationCode: null,
    freshness: { status: "UNKNOWN", ageSeconds: null,
      maximumAgeSeconds: null } }
}

test("MAX_20_SELECTED_PASS and 22_ELIGIBLE_20_PROCESSED_2_DEFERRED_PASS", () => {
  const listings = Array.from({ length: 22 }, (_, index) =>
    listing(String(366650000000 + index)))
  const result = renewal.selectSellerOsLunaStockFreshnessRenewalsV1({
    listings, schedulerIntervalSeconds: 900,
    cycleStartedAt: "1970-01-01T00:00:00.000Z",
  })
  assert.equal(result.eligibleTargetItemIds.length, 22)
  assert.equal(result.targetItemIds.length, 20)
  assert.equal(result.deferredTargetItemIds.length, 2)
  assert.ok(result.deferred.every((row) =>
    row.status === "DEFERRED_NOT_PROCESSED"))
})

test("DEFERRED_TARGET_EVENTUALLY_ELIGIBLE_PASS", () => {
  const listings = Array.from({ length: 22 }, (_, index) =>
    listing(String(366650000000 + index)))
  const first = renewal.selectSellerOsLunaStockFreshnessRenewalsV1({
    listings, schedulerIntervalSeconds: 900,
    cycleStartedAt: "1970-01-01T00:00:00.000Z",
  })
  const next = renewal.selectSellerOsLunaStockFreshnessRenewalsV1({
    listings, schedulerIntervalSeconds: 900,
    cycleStartedAt: "1970-01-01T00:15:00.000Z",
  })
  assert.ok(first.deferredTargetItemIds.every((id) =>
    next.targetItemIds.includes(id)))
})

test("NUMERIC_QUANTITY_UNPROVEN_PRESERVED_PASS", () => {
  assert.equal(stock.classifyPersistedLunaStockObservationStateV1({
    sourceAvailable: true, stockState: "IN_STOCK",
    observedSupplierQuantity: null,
  }), "OBSERVED_IN_STOCK")
})

test("NO_FALSE_COMPONENT_UNAVAILABLE_FOR_DEFERRED_PASS FAIL_CLOSED_503_PRESERVED_PASS", () => {
  const route = readFileSync(
    "app/api/cron/ebay-active-listing-luna-monitor/route.ts", "utf8")
  assert.match(route, /refreshDeferred: freshnessRenewal\.deferredTargetItemIds\.length/)
  assert.match(route, /const refreshFailed = targetItemIds\.length - refreshSucceeded/)
  assert.match(route, /status: success \? 200 : 503/)
  const failures = route.slice(route.indexOf("failures: Object.freeze"),
    route.indexOf("const { error: leaseFinishError }",
      route.indexOf("failures: Object.freeze")))
  assert.match(failures, /targetItemIds\.flatMap/)
  assert.doesNotMatch(failures, /deferredTargetItemIds/)
})

test("NO_MARKETPLACE_WRITES_PASS and scoped load budget gate", () => {
  const implementation = readFileSync(
    "lib/ebay/ebay-stock-identity-auto-reconciliation-v1.ts", "utf8")
  const repositorySource = readFileSync(
    "lib/ebay/commercial-monitor-readonly-repository.ts", "utf8")
  assert.match(implementation, /ebayWrites: 0 as const/)
  assert.match(repositorySource, /const maximum = scope \? 20 : 500/)
  assert.match(repositorySource, /const maximum = scope \? 400 : 1_500/)
  assert.doesNotMatch(repositorySource, /count:\s*["']exact["']/)
})

test("INCIDENT_MEMBER_GENERIC_TERMINALIZATION_BLOCKED_PASS", () => {
  const result = guard.guardIncidentCohortFromGenericReconciliationV1({
    detectedRows: [
      { idempotency_key: "incident", status: "FAILED_TERMINAL" },
      { idempotency_key: "normal", status: "FAILED_TERMINAL" },
    ],
    incidentMembers: [{ jobId: "job-incident", idempotencyKey: "incident",
      incidentClassification: "OUT_OF_SCOPE_NO_ACTIVE_LISTING" }],
  })
  assert.deepEqual(result.genericRows.map((row) => row.idempotency_key),
    ["normal"])
  assert.deepEqual(result.protectedRows.map((row) => row.idempotency_key),
    ["incident"])
})

test("LEGACY_RECOVERY_AUTHORITY_PRESERVED_PASS and OUT_OF_SCOPE_DISPOSITION_AUTHORITY_REQUIRED_PASS", () => {
  const migration = readFileSync(
    "supabase/migrations/20260908164222_seller_os_economic_shipping_legacy_recovery_authority_v1.sql",
    "utf8")
  const runtime = readFileSync(
    "lib/seller-os/economic-evidence-refresh-runtime-v1.ts", "utf8")
  assert.match(migration,
    /close_seller_os_economic_shipping_legacy_out_of_scope_v1/)
  assert.equal(guard.SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_AUTHORITY_V1,
    "close_seller_os_economic_shipping_legacy_out_of_scope_v1")
  assert.match(runtime, /seller_os_legacy_shipping_incident_members_v1/)
  assert.doesNotMatch(runtime,
    /rpc\([\s\S]{0,80}close_seller_os_economic_shipping_legacy_out_of_scope_v1/)
})

test("NON_COHORT_GENERIC_RECONCILER_UNCHANGED_PASS", () => {
  const rows = [{ idempotency_key: "normal", status: "STALE" }]
  const result = guard.guardIncidentCohortFromGenericReconciliationV1({
    detectedRows: rows, incidentMembers: [],
  })
  assert.deepEqual(result.genericRows, rows)
  assert.equal(result.protectedRows.length, 0)
})

test("COHORT_MEMBERSHIP_IMMUTABLE_PASS CURRENT_ELIGIBILITY_DOES_NOT_REWRITE_COHORT_PASS", () => {
  const source = readFileSync(
    "lib/seller-os/incident-cohort-reconciler-authority-guard-v1.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260908203000_legacy_shipping_incident_cohort_boundary_v1.sql",
    "utf8")
  assert.match(source, /currentEconomicJobEligibilityUsedForMembership: false/)
  assert.match(migration, /grant select on table public\.seller_os_legacy_shipping_incident_members_v1/)
  assert.doesNotMatch(migration,
    /grant (?:insert|update|delete|all) on table public\.seller_os_legacy_shipping_incident_members_v1\s+to service_role/i)
})

test("IDEMPOTENT_DISPOSITION_PASS and NO_ADDITIONAL_POLLING_PASS", () => {
  const input = { detectedRows: [{ idempotency_key: "incident" }],
    incidentMembers: [{ jobId: "job", idempotencyKey: "incident",
      incidentClassification: "OUT_OF_SCOPE_NO_ACTIVE_LISTING" }] }
  assert.deepEqual(
    guard.guardIncidentCohortFromGenericReconciliationV1(input),
    guard.guardIncidentCohortFromGenericReconciliationV1(input),
  )
  const source = readFileSync(
    "lib/seller-os/incident-cohort-reconciler-authority-guard-v1.ts", "utf8")
  assert.doesNotMatch(source, /setInterval|setTimeout|poll/i)
})

test("SELLER_OS_OPERATIONAL_EFFICIENCY_GATE_V1", () => {
  const route = readFileSync(
    "app/api/cron/ebay-active-listing-luna-monitor/route.ts", "utf8")
  const repositorySource = readFileSync(
    "lib/ebay/commercial-monitor-readonly-repository.ts", "utf8")
  const runtime = readFileSync(
    "lib/seller-os/economic-evidence-refresh-runtime-v1.ts", "utf8")
  assert.match(route, /stockReadScope: stockPolling\.readbackScope/)
  assert.match(repositorySource, /\.in\(\s*"stock_check_job_id"/)
  assert.doesNotMatch(repositorySource, /count:\s*["']exact["']/)
  assert.match(runtime, /\.limit\(19\)/)
  assert.doesNotMatch(runtime, /setInterval|setTimeout/)
})
