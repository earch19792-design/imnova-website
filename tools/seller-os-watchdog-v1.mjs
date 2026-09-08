// Controller for the existing watchdog executable and its existing reporter job.
// No systemd graph/timer changes, new service, runtime or health authority.
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from "node:fs"
import { execFile } from "node:child_process"
import { observeExistingLifecycle } from "../lib/ebay/ebay-seller-os-controlled-restart-settle-v1.ts"
import { initialRecoveryState, validateRecoveryState, decideRecovery, beginSettle,
  recordSettleResult, executeRecoveryDecision, SETTLE_POLICY, RECOVERY_WINDOW_MS } from "../lib/ebay/ebay-seller-os-watchdog-recovery-v1.mjs"

const mcp = "imnova-seller-os-mcp.service", tunnel = "imnova-seller-os-tunnel.service"
const watchdog = "imnova-seller-os-watchdog.service", timer = "imnova-seller-os-watchdog.timer"
const endpoint = "http://127.0.0.1:3000/api/seller-os/assistant/mcp"
const stateDir = "/home/earch/.local/state/imnova-seller-os"
const statePath = `${stateDir}/watchdog.json`
const launcher = "/home/earch/.local/bin/imnova-seller-os-watchdog"
const emit = data => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }))
const summary = s => ({ status: s.status, recoveryAttemptOrdinal: s.recoveryAttemptOrdinal,
  lastRecoveryAt: s.lastRecoveryAtMs, recoveryWindow: s.recoveryWindowStartedAtMs,
  recoveryExhausted: s.recoveryExhausted, doctorFailure: s.doctorFailure,
  localHttpFailure: s.localHttpFailure, settle: s.settle })

function command(binary, args, signal = AbortSignal.timeout(5000), timeout = 5000, reporterStatus = false) {
  return new Promise((resolve, reject) => execFile(binary, args, { encoding: "utf8", signal,
    timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, env: { ...process.env, TZ: "UTC" } },
  (error, stdout, stderr) => {
    if (reporterStatus) for (const line of stderr.trim().split("\n")) {
      if (/^SELLER_OS_RUNTIME_HEALTH_[A-Z_0-9]+$/.test(line)) emit({ event: line })
    }
    error ? reject(error) : resolve(stdout)
  }))
}
function save(s) {
  validateRecoveryState(s)
  const temporary = `${statePath}.${process.pid}.tmp`
  const fd = openSync(temporary, "w", 0o600)
  try { writeFileSync(fd, JSON.stringify(s) + "\n"); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, statePath)
  const directory = openSync(stateDir, "r")
  try { fsyncSync(directory) } finally { closeSync(directory) }
}
async function load() {
  try { return validateRecoveryState(JSON.parse(readFileSync(statePath, "utf8"))) }
  catch (error) { if (error.code !== "ENOENT") throw new Error("RECOVERY_STATE_UNPROVEN_NO_RESTART") }
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  // Do not give an already storming installation a fresh automatic budget.
  // Conservatively debit ALL recorded MCP starts, including operator starts.
  const now = Date.now()
  const raw = await command("/usr/bin/journalctl", ["--user", "--since", new Date(now - RECOVERY_WINDOW_MS).toISOString(),
    "_COMM=systemd", `USER_UNIT=${mcp}`, "-n", "10000", "-o", "json", "--no-pager"])
  const rows = raw.trim().split("\n").filter(Boolean).map(x => JSON.parse(x))
  if (rows.length >= 10000) throw new Error("RECOVERY_HISTORY_TRUNCATED_NO_RESTART")
  const attempts = rows.filter(x => /^Started /.test(x.MESSAGE ?? "")).map(x => Number(x.__REALTIME_TIMESTAMP) / 1000)
  if (attempts.some(x => !Number.isFinite(x))) throw new Error("RECOVERY_HISTORY_UNPROVEN_NO_RESTART")
  const state = initialRecoveryState(bootId, attempts)
  state.importedHistory = { source: "SYSTEMD_JOURNAL_ALL_MCP_STARTS_CONSERVATIVE", count: attempts.length, atMs: now }
  save(state)
  return state
}
async function units(signal) {
  const raw = await command("/usr/bin/systemctl", ["--user", "show", mcp, tunnel, watchdog, timer,
    "--property=Id,ActiveState,SubState,Result,MainPID,ExecMainStartTimestamp,InvocationID,Requires,After"], signal)
  return Object.fromEntries(raw.trim().split(/\n\n/).map(block => {
    const row = Object.fromEntries(block.split("\n").filter(x => x.includes("=")).map(x => {
      const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]
    }))
    return [row.Id, row]
  }))
}
const unit = u => u ? { activeState: u.ActiveState || null, subState: u.SubState || null,
  result: u.Result || null, pid: Number(u.MainPID) || null } : null
const lifecycle = u => ({ lifecycleId: `${u[mcp].InvocationID}:${u[tunnel].InvocationID}`,
  lifecycleStartedAtMs: Math.max(Date.parse(u[mcp].ExecMainStartTimestamp) || 0,
    Date.parse(u[tunnel].ExecMainStartTimestamp) || 0) })
function verifyDependency(u) {
  if (!u[tunnel].Requires?.split(" ").includes(mcp) || !u[tunnel].After?.split(" ").includes(mcp)) {
    throw new Error("SYSTEMD_TUNNEL_PROPAGATION_UNPROVEN_NO_RESTART")
  }
}
async function doctor(signal = AbortSignal.timeout(4000)) {
  try {
    await command("/home/earch/.local/bin/tunnel-client", ["doctor", "--profile", "seller-os-tunnel-live-v1"], signal, 4000)
    return null
  } catch (error) { return { code: error.killed || signal.aborted ? "DOCTOR_TIMEOUT" : "DOCTOR_FAILED",
    exitCode: Number.isInteger(error.code) ? error.code : null, at: new Date().toISOString() } }
}
async function httpResponsive() {
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(4000), redirect: "manual" })
    await r.body?.cancel()
    return [200, 406].includes(r.status)
  } catch { return false }
}
async function runtime(signal) {
  try {
    const r = await fetch(endpoint, { method: "POST", signal,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "watchdog-settle", method: "tools/call",
        params: { name: "seller_os_get_runtime_health", arguments: {} } }) })
    if (!r.ok) { await r.body?.cancel(); return { health: null, failureCode: r.status === 401 ? "AUTH_REQUIRED" :
      r.status === 403 ? "PROTECTION_REQUIRED" : `MCP_HTTP_${r.status}` } }
    const body = await r.json(), health = body.result?.structuredContent?.result
    if (body.error || body.result?.isError || health?.contractVersion !== "SELLER_OS_RUNTIME_HEALTH_V1") {
      return { health: null, failureCode: "MCP_HEALTH_CONTRACT_UNAVAILABLE" }
    }
    return { health, failureCode: null }
  } catch (error) {
    if (signal.aborted) throw error
    return { health: null, failureCode: "MCP_TRANSPORT_UNAVAILABLE" }
  }
}
async function scheduleObservation() {
  // Use the existing reporter unit after this oneshot exits. The full health
  // authority intentionally reports an executing watchdog as DEGRADED.
  await command("/usr/bin/systemd-run", ["--user", "--quiet", "--collect",
    "--unit=imnova-seller-os-runtime-health-reporter", "--on-active=1s", "--timer-property=AccuracySec=1ms",
    "--property=RuntimeMaxSec=50s",
    "--property=EnvironmentFile=/home/earch/.config/imnova/seller-os-cloud-read-relay.env",
    launcher, "observe"])
}
async function observe(s) {
  if (!s.settle) return
  if (s.lastSettle?.id === s.settle.id) {
    emit({ event: "SETTLE_ALREADY_COMPLETED", ...summary(s), firstResult: s.lastSettle })
    return s.lastSettle
  }
  const context = { ...s.settle }
  const result = await observeExistingLifecycle({ phase: "WATCHDOG_RECOVERY", policy: SETTLE_POLICY,
    requestedAtMs: context.startedAtMs, previousMcpPid: context.previousMcpPid,
    previousTunnelPid: context.previousTunnelPid, previousProbeCount: context.probeCount,
    probe: async signal => {
      s.settle.probeCount++; save(s) // Count even a probe interrupted by process death.
      const [u, r, d] = await Promise.all([units(signal), runtime(signal), doctor(signal)])
      if (d) { s.doctorFailure = d; save(s) }
      if (!r.health) { s.localHttpFailure = "LOCAL_HTTP_UNRESPONSIVE"; save(s) }
      // Doctor evidence remains separate from the certified runtime invariants.
      // Local runtime health does not certify external Tunnel reachability.
      return { ...r, mcp: unit(u[mcp]), tunnel: unit(u[tunnel]), watchdog: unit(u[watchdog]), doctorFailure: d }
    },
    onObservation: row => {
      if (["PROBE_BUDGET_EXPIRED", "MCP_TRANSPORT_UNAVAILABLE"].includes(row.probe.failureCode)) {
        s.localHttpFailure = "LOCAL_HTTP_UNRESPONSIVE"; save(s)
      }
      emit({ event: "SETTLE_PROBE", transaction: context.id,
      probeCount: row.probeCount, elapsedMs: row.elapsedMs, classification: row.classification,
      acceptable: row.acceptable, rawOverallStatus: row.rawOverallStatus,
      failureCode: row.probe.failureCode ?? null, doctorFailure: row.probe.doctorFailure ?? null }) } })
  recordSettleResult(s, result); save(s)
  emit({ event: "SETTLE_RESULT", ...summary(s), result: result.status,
    settleOutcome: result.status === "ACCEPTED" ? "RECOVERY_SUCCESS" : "STARTUP_SETTLE_EXHAUSTED",
    elapsedMs: result.elapsedMs, probeCount: result.probeCount,
    noRecoveryActionWhenHealthy: context.kind === "HEALTH_CHECK" && result.status === "ACCEPTED" })
  return result
}
async function tick() {
  const s = await load(), u = await units()
  verifyDependency(u)
  const context = lifecycle(u), nowMs = Date.now()
  const inGrace = s.settle && nowMs < s.settle.deadlineMs ||
    context.lifecycleId !== s.lifecycleId && nowMs - context.lifecycleStartedAtMs < SETTLE_POLICY.settleWindowMs
  const [localOk, doctorFailure] = inGrace ? [null, null] : await Promise.all([httpResponsive(), doctor()])
  const active = [mcp, tunnel].every(name => u[name].ActiveState === "active" && u[name].SubState === "running")
  const decision = decideRecovery({ state: s, nowMs: Date.now(), ...context,
    localOk: inGrace ? null : localOk && active, doctorFailure })
  emit({ event: "WATCHDOG_DECISION", action: decision.action, reason: decision.reason, ...summary(decision.state) })
  await executeRecoveryDecision(decision, { save, scheduleObservation,
    previousMcpPid: Number(u[mcp].MainPID), previousTunnelPid: Number(u[tunnel].MainPID),
    restartMcp: async () => {
      emit({ event: "WATCHDOG_MCP_RESTART", tunnelOwner: "SYSTEMD_DEPENDENCY" })
      await command("/usr/bin/systemctl", ["--user", "restart", mcp], AbortSignal.timeout(10000), 10000)
    } })
}
async function canary() {
  const s = await load(), u = await units()
  verifyDependency(u)
  if (u[watchdog].ActiveState !== "inactive") throw new Error("CANARY_REQUIRES_IDLE_WATCHDOG")
  beginSettle(s, { kind: "CONTROLLED_CANARY", startedAtMs: Date.now(), ...lifecycle(u),
    previousMcpPid: Number(u[mcp].MainPID), previousTunnelPid: Number(u[tunnel].MainPID) })
  save(s)
  emit({ event: "CONTROLLED_CANARY_MCP_RESTART", ...summary(s), tunnelOwner: "SYSTEMD_DEPENDENCY" })
  await command("/usr/bin/systemctl", ["--user", "restart", mcp], AbortSignal.timeout(10000), 10000)
  const result = await observe(s)
  process.exitCode = result?.status === "ACCEPTED" ? 0 : 2
}
try {
  const mode = process.argv[2]
  if (mode === "tick") await tick()
  else if (mode === "observe") {
    await observe(await load())
    // Preserve the existing attestation path, even when settle was unsuccessful.
    await command(process.execPath, ["/home/earch/.local/bin/imnova-seller-os-runtime-health-reporter.mjs"],
      AbortSignal.timeout(17000), 17000, true).catch(() => emit({ event: "EXISTING_HEALTH_REPORTER_FAILED" }))
  } else if (mode === "canary") await canary()
  else throw new Error("WATCHDOG_MODE_INVALID")
} catch (error) {
  const safeCodes = ["RECOVERY_STATE_UNPROVEN_NO_RESTART", "RECOVERY_HISTORY_TRUNCATED_NO_RESTART",
    "RECOVERY_HISTORY_UNPROVEN_NO_RESTART", "SYSTEMD_TUNNEL_PROPAGATION_UNPROVEN_NO_RESTART",
    "CANARY_REQUIRES_IDLE_WATCHDOG", "WATCHDOG_MODE_INVALID"]
  emit({ event: "WATCHDOG_ENGINEERING_ESCALATION", code: safeCodes.includes(error.message) ? error.message :
    "WATCHDOG_OPERATION_FAILED_NO_ADDITIONAL_RESTART" })
  process.exitCode = 1
}
