import assert from "node:assert/strict"
import test from "node:test"
import { classifyControlledRestartProbe, deriveMeasuredSettlePolicy, makeSettlePolicy,
  restartAndSettle } from "./ebay-seller-os-controlled-restart-settle-v1.ts"

const policy = makeSettlePolicy(120, 10)
const unit = (pid = 2) => ({ activeState: "active", subState: "running", result: "success", pid })
function probe() {
  const now = new Date().toISOString()
  return { mcp: unit(12), tunnel: unit(22), watchdog: { ...unit(0), activeState: "inactive", subState: "dead" },
    health: { observedAt: now, overallStatus: "HEALTHY", evidenceCompleteness: "COMPLETE", limitations: [],
      services: { mcp: { status: "HEALTHY", mainPid: 12 }, tunnel: { status: "HEALTHY", mainPid: 22 },
        watchdogTimer: { status: "HEALTHY", subState: "waiting" } }, port3000: { status: "AVAILABLE" },
      watchdog: { lastResult: "success", lastRunAt: now, lastSuccessAt: now },
      runtimeCatalog: { runtimeCatalogCount: 28, expectedCatalogCount: 28, exactCatalogMatch: true,
        runtimeWorkingDirectoryMatch: true, workspaceRuntimeBindingStatus: "MATCHED" } } }
}
const context = () => ({ requestedAtMs: Date.now() - 100, previousMcpPid: 11, previousTunnelPid: 21 })
const classify = p => classifyControlledRestartProbe({ probe: p, controlledRestart: context(), elapsedMs: 1, policy })
const run = overrides => restartAndSettle({ phase: "ACTIVATION", policy, previousMcpPid: 11,
  previousTunnelPid: 21, restart: async () => {}, probe: async () => probe(), ...overrides })

test("PASS_CONTROLLED_MCP_RESTART_EXPECTS_TUNNEL_RESTART", () => {
  assert.equal(classify(probe()).acceptable, true)
  const p = probe(); p.health.services.tunnel.mainPid = 21
  assert.equal(classify(p).acceptable, false)
})
test("PASS_TRANSIENT_WATCHDOG_EXECUTION_NOT_TERMINAL", async () => {
  let reads = 0
  const result = await run({ probe: async () => { const p = probe(); if (++reads === 1) {
    p.watchdog.activeState = "activating"; p.health.overallStatus = "DEGRADED"
    p.health.services.watchdogTimer.subState = "running"; p.health.watchdog.lastSuccessAt = null
  } return p } })
  assert.equal(result.observations[0].classification, "TRANSIENT_SETTLING")
  assert.equal(result.observations[0].rawOverallStatus, "DEGRADED")
  assert.equal(result.status, "ACCEPTED")
  assert.equal(result.probeCount, 3)
})
test("PASS_SETTLE_WINDOW_FINITE", async () => {
  assert.throws(() => makeSettlePolicy(Infinity))
  assert.throws(() => makeSettlePolicy(120001))
  const started = performance.now()
  const result = await run({ policy: makeSettlePolicy(60, 10), restart: async () => new Promise(() => {}) })
  assert.equal(result.status, "SETTLE_TIMEOUT")
  assert.ok(performance.now() - started < 160)
  assert.equal(result.probeCount, 0)
})
test("PASS_FULL_ACCEPTANCE_REQUIRES_ALL_RUNTIME_INVARIANTS", () => {
  const mutations = [p => p.health.overallStatus = "DEGRADED", p => p.health.evidenceCompleteness = "PARTIAL",
    p => p.health.services.mcp.status = "DEGRADED", p => p.health.services.tunnel.status = "DEGRADED",
    p => p.health.port3000.status = "UNAVAILABLE", p => p.health.watchdog.lastResult = "exit-code",
    p => p.health.watchdog.lastSuccessAt = null, p => p.health.runtimeCatalog.runtimeCatalogCount = 27,
    p => p.health.runtimeCatalog.exactCatalogMatch = false,
    p => p.health.runtimeCatalog.workspaceRuntimeBindingStatus = "MISMATCHED",
    p => p.health.runtimeCatalog.runtimeWorkingDirectoryMatch = false,
    p => p.health.observedAt = "2000-01-01T00:00:00Z"]
  for (const mutate of mutations) { const p = probe(); mutate(p); assert.equal(classify(p).acceptable, false) }
})
test("PASS_SETTLE_TIMEOUT_CAUSES_FAILURE", async () => {
  const result = await run({ policy: makeSettlePolicy(60, 10), probe: async () => new Promise(() => {}) })
  assert.equal(result.status, "SETTLE_TIMEOUT")
  assert.equal(result.nextAction, "RESTORE_IMMUTABLE_BASELINE_AND_APPLY_SAME_SETTLE_CONTRACT")
  assert.ok(result.probeCount <= result.policy.maxProbeCount)
})
test("PASS_NO_HEALTH_SEMANTIC_WEAKENING_OUTSIDE_WINDOW", () => {
  const p = probe(); p.health.overallStatus = "DEGRADED"; p.watchdog.activeState = "activating"
  const before = JSON.stringify(p)
  for (const controlledRestart of [null, context()]) {
    const result = classifyControlledRestartProbe({ probe: p, controlledRestart, elapsedMs: 120, policy })
    assert.equal(result.classification, "OUTSIDE_CONTROLLED_WINDOW")
    assert.equal(result.acceptable, false); assert.equal(result.rawOverallStatus, "DEGRADED")
  }
  assert.equal(JSON.stringify(p), before)
})
test("PASS_ROLLBACK_USES_SAME_SETTLE_CONTRACT", async () => {
  for (const phase of ["ACTIVATION", "ROLLBACK"]) {
    const result = await run({ phase }); assert.equal(result.status, "ACCEPTED")
    assert.deepEqual(result.policy, policy); assert.equal(result.probeCount, 2)
  }
})
test("explicit failed units and wrong catalog are failures, not transients", () => {
  const p = probe(); p.mcp.activeState = "failed"
  assert.equal(classify(p).classification, "UNEXPECTED_RUNTIME_FAILURE")
  const q = probe(); q.health.runtimeCatalog.runtimeCatalogCount = 27
  assert.equal(classify(q).classification, "UNEXPECTED_RUNTIME_FAILURE")
})
test("programming exceptions stay visible and are not relabeled transient", async () => {
  await assert.rejects(run({ probe: async () => { throw new TypeError("programming error") } }), /programming error/)
})
test("measurement policy requires three samples and explicit margin", () => {
  assert.throws(() => deriveMeasuredSettlePolicy([12000]))
  const result = deriveMeasuredSettlePolicy([12000, 15000, 16000])
  assert.equal(result.policy.settleWindowMs, 30000)
  assert.equal(result.actualMarginMs, 14000)
  assert.equal(result.policy.maxProbeCount, 6)
})
test("consecutive acceptance requires stable restarted process identities", async () => {
  let count = 0
  const result = await run({ probe: async () => { const p = probe(); if (++count > 1) p.health.services.mcp.mainPid = 13; return p } })
  assert.equal(result.status, "ACCEPTED"); assert.equal(result.probeCount, 3)
})
test("expired probes are aborted and cannot accept late healthy evidence", async () => {
  let aborted = false
  const result = await run({ policy: makeSettlePolicy(60, 10), probe: async signal => {
    signal.addEventListener("abort", () => { aborted = true }, { once: true })
    await new Promise(resolve => setTimeout(resolve, 80)); return probe()
  } })
  assert.equal(result.status, "SETTLE_TIMEOUT"); assert.equal(aborted, true)
})
