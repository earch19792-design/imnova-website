import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { SETTLE_POLICY, MAX_RECOVERY_ATTEMPTS, RECOVERY_WINDOW_MS, initialRecoveryState,
  validateRecoveryState, decideRecovery, beginSettle, recordSettleResult,
  executeRecoveryDecision } from "./ebay-seller-os-watchdog-recovery-v1.mjs"
import { CERTIFIED_CONTROLLED_RESTART_SETTLE_POLICY_V1, observeExistingLifecycle,
  classifyControlledRestartProbe, makeSettlePolicy } from "./ebay-seller-os-controlled-restart-settle-v1.ts"

const base = 1_800_000_000_000
const decide = (state, extra = {}) => decideRecovery({ state, nowMs: base,
  lifecycleId: "mcp:tunnel", lifecycleStartedAtMs: base - 60000, localOk: false, doctorFailure: null, ...extra })
function fullProbe() {
  const at = new Date().toISOString()
  const unit = pid => ({ activeState: "active", subState: "running", result: "success", pid })
  return { mcp: unit(12), tunnel: unit(22), watchdog: { ...unit(0), activeState: "inactive", subState: "dead" },
    health: { observedAt: at, overallStatus: "HEALTHY", evidenceCompleteness: "COMPLETE",
      services: { mcp: { status: "HEALTHY", mainPid: 12 }, tunnel: { status: "HEALTHY", mainPid: 22 },
        watchdogTimer: { status: "HEALTHY", subState: "waiting" } }, port3000: { status: "AVAILABLE" },
      watchdog: { lastResult: "success", lastRunAt: at, lastSuccessAt: at },
      runtimeCatalog: { runtimeCatalogCount: 28, expectedCatalogCount: 28, exactCatalogMatch: true,
        runtimeWorkingDirectoryMatch: true, workspaceRuntimeBindingStatus: "MATCHED" } } }
}
const classify = probe => classifyControlledRestartProbe({ probe, policy: SETTLE_POLICY, elapsedMs: 1,
  controlledRestart: { requestedAtMs: Date.now() - 1000, previousMcpPid: 0, previousTunnelPid: 0 } })
async function effects(decision, overrides = {}) {
  const events = []
  const state = await executeRecoveryDecision(decision, {
    previousMcpPid: 11, previousTunnelPid: 21,
    save: async s => events.push(["save", structuredClone(s)]),
    restartMcp: async () => events.push(["restartMcp"]),
    restartTunnel: async () => { throw new Error("Tunnel restart forbidden") },
    scheduleObservation: async () => events.push(["observe"]), ...overrides })
  return { state, events }
}
test("PASS_INITIALIZATION_PENDING_DOES_NOT_RESTART_IMMEDIATELY", async () => {
  const first = decide(initialRecoveryState("boot"), { lifecycleStartedAtMs: base - 1000 })
  assert.equal(first.reason, "INITIALIZATION_PENDING")
  let s = (await effects(first)).state
  const deadline = s.settle.deadlineMs
  for (let age = 5000; age < 29000; age += 5000) {
    const d = decide(s, { nowMs: base + age, lifecycleStartedAtMs: base - 1000 })
    const r = await effects(d); s = r.state
    assert.equal(d.action, "OBSERVE"); assert.equal(s.settle.deadlineMs, deadline)
    assert.equal(r.events.some(x => x[0] === "restartMcp"), false)
    assert.equal(s.recoveryAttemptOrdinal, 0)
  }
})
test("PASS_30S_SETTLE_CONTRACT_REUSED", async () => {
  assert.equal(SETTLE_POLICY, CERTIFIED_CONTROLLED_RESTART_SETTLE_POLICY_V1)
  assert.deepEqual(SETTLE_POLICY, { settleWindowMs: 30000, probeIntervalMs: 5000,
    perProbeBudgetMs: 5000, maxProbeCount: 6, consecutiveHealthyReads: 2 })
  let probes = 0
  const result = await observeExistingLifecycle({ phase: "WATCHDOG_RECOVERY", policy: SETTLE_POLICY,
    requestedAtMs: Date.now() - 30001, previousMcpPid: 0, previousTunnelPid: 0,
    probe: async () => { probes++; return fullProbe() } })
  assert.equal(result.status, "SETTLE_TIMEOUT"); assert.equal(probes, 0)
})
test("PASS_TWO_CONSECUTIVE_HEALTHY_ENDS_RECOVERY", async () => {
  let reads = 0
  const result = await observeExistingLifecycle({ phase: "WATCHDOG_RECOVERY", policy: makeSettlePolicy(300, 10),
    requestedAtMs: Date.now(), previousMcpPid: 11, previousTunnelPid: 21, probe: async () => {
      const p = fullProbe(); if (++reads === 2) p.health.overallStatus = "DEGRADED"; return p
    } })
  assert.equal(result.status, "ACCEPTED"); assert.equal(reads, 4)
  const s = beginSettle(initialRecoveryState("boot", [base - 60000, base - 40000]),
    { kind: "RECOVERY", startedAtMs: base, lifecycleId: "m:t" })
  recordSettleResult(s, result)
  assert.equal(s.status, "RECOVERY_SUCCESS"); assert.equal(s.recoveryAttemptOrdinal, 2)
})
test("PASS_SETTLE_EXHAUSTION_ALLOWS_BOUNDED_RECOVERY", async () => {
  const s = beginSettle(initialRecoveryState("boot"), { kind: "STARTUP", startedAtMs: base - 30000, lifecycleId: "mcp:tunnel" })
  const d = decide(s)
  assert.equal(d.action, "RESTART_MCP"); assert.equal(d.reason, "STARTUP_SETTLE_EXHAUSTED")
  const r = await effects(d)
  assert.equal(r.events[0][0], "save"); assert.equal(r.events[0][1].recoveryAttemptOrdinal, 1)
  assert.equal(r.state.settle.deadlineMs, base + 30000)
  assert.equal(r.events.filter(x => x[0] === "restartMcp").length, 1)
})
test("PASS_RECOVERY_ATTEMPTS_BOUNDED", async () => {
  let s = initialRecoveryState("boot"), restarts = 0
  for (let i = 0; i < 20; i++) {
    const r = await effects(decide(s, { nowMs: base + i * 120000 }))
    s = JSON.parse(JSON.stringify(r.state)) // New watchdog process every timer cycle.
    restarts += r.events.filter(x => x[0] === "restartMcp").length
  }
  assert.equal(restarts, MAX_RECOVERY_ATTEMPTS)
  assert.equal(s.status, "RECOVERY_POLICY_EXHAUSTED")
})
test("PASS_RECOVERY_EXHAUSTION_STOPS_RESTART_STORM", async () => {
  const imported = initialRecoveryState("boot", [base - 5000, base - 1000])
  const r = await effects(decide(imported))
  assert.equal(r.state.status, "RECOVERY_POLICY_EXHAUSTED")
  assert.equal(r.state.localHttpFailure, "LOCAL_HTTP_UNRESPONSIVE")
  assert.equal(r.events.some(x => x[0] === "restartMcp"), false)
  const next = decide(r.state, { nowMs: base - 5000 + RECOVERY_WINDOW_MS })
  assert.equal(next.action, "RESTART_MCP"); assert.equal(next.state.recoveryAttemptOrdinal, 1)
})
test("PASS_MCP_RESTART_RELIES_ON_SYSTEMD_FOR_TUNNEL", async () => {
  const r = await effects(decide(initialRecoveryState("boot")))
  assert.deepEqual(r.events.map(x => x[0]), ["save", "restartMcp", "observe"])
})
test("PASS_NO_REDUNDANT_TUNNEL_RESTART", async () => {
  const source = readFileSync(new URL("../../tools/seller-os-watchdog-v1.mjs", import.meta.url), "utf8")
  // Check the installed adapter as well as the policy effect boundary.
  const restartCommands = [...source.matchAll(/\["--user", "restart", (\w+)\]/g)].map(x => x[1])
  assert.deepEqual(restartCommands, ["mcp", "mcp"])
  for (const failedDoctor of [null, { code: "DOCTOR_FAILED", exitCode: 1 }]) {
    const r = await effects(decide(initialRecoveryState("boot"), { doctorFailure: failedDoctor }))
    assert.equal(r.events.filter(x => x[0] === "restartMcp").length, 1)
  }
})
test("PASS_DOCTOR_FAILURE_PRESERVED_WITHOUT_DUPLICATE_RESTART", async () => {
  const failure = { code: "DOCTOR_FAILED", exitCode: 1, at: new Date(base).toISOString() }
  const r = await effects(decide(initialRecoveryState("boot"), { doctorFailure: failure }))
  const pending = await effects(decide(r.state, { nowMs: base + 10000, doctorFailure: failure }))
  assert.equal(pending.events.some(x => x[0] === "restartMcp"), false)
  recordSettleResult(pending.state, { status: "ACCEPTED", probeCount: 2, elapsedMs: 15000 })
  assert.deepEqual(pending.state.doctorFailure, failure)
  const p = fullProbe(); p.doctorFailure = failure
  assert.equal(classify(p).acceptable, true)
  assert.deepEqual(p.doctorFailure, failure)
})
test("PASS_HEALTH_SEMANTICS_NOT_WEAKENED", () => {
  const mutations = [p => p.health.overallStatus = "DEGRADED", p => p.health.evidenceCompleteness = "PARTIAL",
    p => p.health.services.mcp.status = "DEGRADED", p => p.health.services.tunnel.status = "DEGRADED",
    p => p.health.port3000.status = "UNAVAILABLE", p => p.health.watchdog.lastResult = "exit-code",
    p => p.health.watchdog.lastSuccessAt = null, p => p.health.services.watchdogTimer.subState = "running",
    p => p.watchdog.activeState = "activating", p => p.health.services.watchdogTimer.status = "DEGRADED",
    p => p.health.observedAt = "2000-01-01T00:00:00Z"]
  assert.equal(classify(fullProbe()).acceptable, true)
  for (const mutate of mutations) {
    const p = fullProbe(); mutate(p); const before = JSON.stringify(p)
    assert.equal(classify(p).acceptable, false); assert.equal(JSON.stringify(p), before)
  }
})
test("PASS_EXISTING_RUNTIME_CATALOG_UNCHANGED", () => {
  for (const mutate of [p => p.health.runtimeCatalog.runtimeCatalogCount = 27,
    p => p.health.runtimeCatalog.runtimeCatalogCount = 29,
    p => p.health.runtimeCatalog.expectedCatalogCount = 29,
    p => p.health.runtimeCatalog.exactCatalogMatch = false,
    p => p.health.runtimeCatalog.runtimeWorkingDirectoryMatch = false,
    p => p.health.runtimeCatalog.workspaceRuntimeBindingStatus = "MISMATCHED"]) {
    const p = fullProbe(); mutate(p); const before = JSON.stringify(p.health.runtimeCatalog)
    assert.equal(classify(p).acceptable, false)
    assert.equal(JSON.stringify(p.health.runtimeCatalog), before)
  }
})
test("failed restart consumes the reserved attempt and cannot duplicate it inside grace", async () => {
  const r = await effects(decide(initialRecoveryState("boot")), { restartMcp: async () => { throw Error("failed") } })
  assert.equal(r.state.restartFailure, "MCP_RESTART_COMMAND_FAILED")
  assert.equal(r.state.recoveryAttemptOrdinal, 1)
  assert.equal(decide(r.state, { nowMs: base + 1000 }).action, "OBSERVE")
})
test("corrupt state, backwards clock and unproven start fail closed", () => {
  assert.throws(() => validateRecoveryState({}), /UNPROVEN/)
  const s = initialRecoveryState("boot", [base])
  assert.equal(decide(s, { nowMs: base - 1 }).action, "ESCALATE")
  assert.equal(decide(s, { lifecycleStartedAtMs: NaN }).action, "ESCALATE")
})
test("a restarted observer cannot acquire another six probes or reset its deadline", async () => {
  let reads = 0
  const result = await observeExistingLifecycle({ phase: "WATCHDOG_RECOVERY", policy: makeSettlePolicy(60, 10),
    requestedAtMs: Date.now(), previousMcpPid: 0, previousTunnelPid: 0, previousProbeCount: 5,
    probe: async () => { reads++; return fullProbe() } })
  assert.equal(reads, 1); assert.equal(result.probeCount, 6); assert.equal(result.status, "SETTLE_TIMEOUT")
})
test("healthy timer cycles have no recovery effects and do not replenish budget", async () => {
  const r = await effects(decide(initialRecoveryState("boot", [base - 1000]), { localOk: true }))
  assert.equal(r.state.status, "FULL_HEALTH_VERIFICATION_PENDING")
  assert.deepEqual(r.events.map(x => x[0]), ["save", "observe"])
  assert.equal(r.state.recoveryAttemptOrdinal, 1)
  const doctorFailed = await effects(decide(initialRecoveryState("boot"), {
    localOk: true, doctorFailure: { code: "DOCTOR_FAILED", exitCode: 2 } }))
  assert.deepEqual(doctorFailed.events.map(x => x[0]), ["save", "observe"])
  assert.equal(doctorFailed.state.doctorFailure.exitCode, 2)
})
test("exhaustion preserves the existing health reporting path without restarting", async () => {
  const r = await effects(decide(initialRecoveryState("boot", [base - 5000, base - 1000])))
  assert.deepEqual(r.events.map(x => x[0]), ["save", "observe"])
  assert.equal(r.state.status, "RECOVERY_POLICY_EXHAUSTED")
})
test("later reporter jobs preserve the first terminal settle receipt", () => {
  const s = beginSettle(initialRecoveryState("boot"), { kind: "STARTUP", startedAtMs: base, lifecycleId: "m:t" })
  recordSettleResult(s, { status: "SETTLE_TIMEOUT", elapsedMs: 30000, probeCount: 4 })
  const first = JSON.stringify(s.lastSettle)
  recordSettleResult(s, { status: "SETTLE_TIMEOUT", elapsedMs: 150000, probeCount: 4 })
  assert.equal(JSON.stringify(s.lastSettle), first)
})
