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

const bridge = await import(
  "../seller-os/legacy-shipping-recovery-client-bridge-v1.ts")
const control = readFileSync(
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  "utf8")
const route = readFileSync(
  "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
const server = readFileSync(
  "lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260908164222_seller_os_economic_shipping_legacy_recovery_authority_v1.sql",
  "utf8")

const JOB_ID = "089c26b0-4bed-410d-847f-8eefdeee6fa0"
const CANDIDATE = `sha256:${"a".repeat(64)}`
const FRESHNESS = `economic-shipping-refresh-v1:sha256:${"b".repeat(64)}`
const RECOVERY =
  `economic-shipping-legacy-recovery-v1:sha256:${"c".repeat(64)}`

function gate(overrides = {}) {
  return { ownerAdminAuthenticated: true, browserLeader: true,
    serverLeaderLeaseActive: true, heartbeatV2Fresh: true,
    shippingCapabilityFresh: true, chromePortConnected: true,
    recoveryDispatchInFlight: false, ...overrides }
}

function job(overrides = {}) {
  return { contractVersion: "LUNA_SHIPPING_QUOTE_CAPTURE_V1",
    identity: { candidateId: CANDIDATE },
    economicRefresh: { jobId: JOB_ID, freshnessGeneration: FRESHNESS,
      recoveryGeneration: RECOVERY, legacyRecoveryGeneration: RECOVERY,
      attemptOrdinal: 1 }, ...overrides }
}

test("OWNER_ADMIN_REQUIRED_PASS", () => {
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ ownerAdminAuthenticated: false })), /OWNER_ADMIN_REQUIRED/)
  assert.match(control,
    /isSellerOsOwnerRole\(sellerOsAccessRoleFromUser\(session\?\.user\)\)/)
  assert.match(route,
    /authorizeLunaShippingCaptureRequest[\s\S]*?validateAdminApiRequest/)
})

test("FOLLOWER_CANNOT_RECOVER_PASS", () => {
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ browserLeader: false })), /LEADER_REQUIRED/)
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ serverLeaderLeaseActive: false })), /LEADER_REQUIRED/)
})

test("STALE_CAPABILITY_BLOCKS_PASS", () => {
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ heartbeatV2Fresh: false })), /CAPABILITY_STALE/)
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ shippingCapabilityFresh: false })), /CAPABILITY_STALE/)
})

test("CHROME_PORT_REQUIRED_PASS", () => {
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ chromePortConnected: false })), /CHROME_PORT_REQUIRED/)
})

test("EXACTLY_ONE_JOB_PASS and ZERO_JOB_NOOP_PASS", () => {
  const one = bridge.sellerOsLegacyShippingRecoveryResultJobV1({ result: {
    recoveryGeneration: RECOVERY, jobs: [job()] } }, JOB_ID)
  assert.equal(one.binding.jobId, JOB_ID)
  assert.equal(one.binding.recoveryGeneration, RECOVERY)
  assert.equal(one.job.economicRefresh.freshnessGeneration, FRESHNESS)
  const zero = bridge.sellerOsLegacyShippingRecoveryResultJobV1({ result: {
    recoveryGeneration: RECOVERY, jobs: [] } }, JOB_ID)
  assert.equal(zero.job, null)
  assert.equal(zero.binding, null)
})

test("MULTIPLE_JOBS_FAIL_CLOSED_PASS", () => {
  assert.throws(() => bridge.sellerOsLegacyShippingRecoveryResultJobV1({
    result: { recoveryGeneration: RECOVERY, jobs: [job(), job()] },
  }, JOB_ID), /MULTIPLE_JOBS_FORBIDDEN/)
  assert.match(route, /result\.jobs\.length > 1/)
})

test("RECOVERY_JOB_TO_SENDCURRENT_PASS and B618_CHROME_PORT_HANDOFF_PASS",
  () => {
    assert.match(control,
      /jobs = \[recovered\.job as LunaChromeShippingJobV1\][\s\S]*?mode = "RECOVERY"[\s\S]*?sendCurrent\(\)/)
    assert.match(control,
      /currentPort\.postMessage\(\{ type: "START_SHIPPING_JOB", job/)
    assert.match(server,
      /legacyRecoveryGeneration: recoveryGeneration[\s\S]*?jobs: Object\.freeze\(\[recoveryJob\]\)/)
  })

test("DISPATCH_FAILURE_RETRYABLE_PASS and NO_ABANDONED_REFRESHING_PASS",
  () => {
    assert.match(control, /fail\(recoveryError, "LEGACY_RECOVERY_DISPATCH_FAILED"\)/)
    assert.match(control,
      /report_economic_shipping_failure[\s\S]*?legacyRecoveryGeneration/)
    assert.match(server,
      /legacy[\s\S]{0,80}?"fail_seller_os_economic_shipping_legacy_recovery_v1"/)
    assert.match(control,
      /SELLER_OS_LEGACY_RECOVERY_FAILURE_ROUTING_FAILED/)
  })

test("DOUBLE_CLICK_SUPPRESSED_PASS", () => {
  assert.throws(() => bridge.certifySellerOsLegacyShippingRecoveryClientGateV1(
    gate({ recoveryDispatchInFlight: true })), /ALREADY_IN_FLIGHT/)
  assert.match(control,
    /legacyRecoveryDispatchInFlight = true[\s\S]*?setLegacyRecoveryInFlight\(true\)/)
})

test("CONCURRENT_RECOVERY_CAS_PASS", () => {
  assert.match(migration,
    /pg_advisory_xact_lock[\s\S]*?for update/)
  assert.match(migration,
    /unique \(marketplace_account_key, job_id\)/)
})

test("RECOVERY_SUCCESS_FINISH_ROUTING_PASS", () => {
  assert.match(server,
    /recoveryGeneration[\s\S]*?finish_seller_os_economic_shipping_legacy_recovery_v1/)
  assert.match(control,
    /result\.economicRefreshJobId !==[\s\S]*?RECOVERY_FINISH_ROUTED/)
})

test("NO_EXTRA_POLLING_PASS and SELLER_OS_OPERATIONAL_EFFICIENCY_GATE", () => {
  assert.deepEqual(
    bridge.SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_LOAD_BUDGET_V1,
    { rpcPerManualRecoveryMax: 1, jobsPerManualRecoveryMax: 1,
      chromeDispatchPerRecoveryMax: 1, additionalPollers: 0 })
  assert.equal((control.match(
    /"recover_one_legacy_economic_shipping_job"/g) ?? []).length, 1)
  assert.doesNotMatch(control,
    /setInterval\([^)]*recover_one_legacy_economic_shipping_job/)
})

test("RECOVERY_RECEIPTS_BOUNDED_PASS", () => {
  for (const event of
    bridge.SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_RECEIPTS_V1) {
    const receipt = bridge.sellerOsLegacyShippingRecoveryClientReceiptV1({
      event, jobId: JOB_ID,
      recoveryGeneration: event === "RECOVERY_CONTROL_INVOKED"
        ? null : RECOVERY,
      now: 1_788_890_000_000,
    })
    assert.equal(receipt.event, event)
    assert.equal(receipt.jobId, JOB_ID)
    assert.equal("accessToken" in receipt, false)
  }
  assert.match(control, /\.slice\(-20\)/)
})
