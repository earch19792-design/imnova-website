import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1,
  SELLER_OS_RUNTIME_HEALTH_TOOL_V1,
  collectSellerOsRuntimeHealthV1,
  createUnavailableSellerOsRuntimeHealthV1,
} from "./ebay-seller-os-runtime-health-v1.ts"

const NOW = new Date("2026-08-20T03:54:41.000Z")
const LAST_TRIGGER = new Date("2026-08-20T03:56:19.000Z")
const NEXT_TRIGGER = new Date("2026-08-20T03:58:19.000Z")

const baseUnits = Object.freeze({
  mcp: Object.freeze({
    Id: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
    LoadState: "loaded",
    ActiveState: "active",
    SubState: "running",
    ActiveEnterTimestamp: "Wed 2026-08-19 21:54:27 CST",
    MainPID: "12699",
    Result: "success",
    NRestarts: "0",
    ExecMainStartTimestamp: "Wed 2026-08-19 21:54:27 CST",
    ExecMainExitTimestamp: "",
  }),
  tunnel: Object.freeze({
    Id: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
    LoadState: "loaded",
    ActiveState: "active",
    SubState: "running",
    ActiveEnterTimestamp: "Wed 2026-08-19 21:54:44 CST",
    MainPID: "12869",
    Result: "success",
    NRestarts: "0",
    ExecMainStartTimestamp: "Wed 2026-08-19 21:54:44 CST",
    ExecMainExitTimestamp: "",
  }),
  watchdogTimer: Object.freeze({
    Id: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
    LoadState: "loaded",
    ActiveState: "active",
    SubState: "waiting",
    ActiveEnterTimestamp: "Wed 2026-08-19 18:03:23 CST",
    LastTriggerUSec: "Wed 2026-08-19 21:56:19 CST",
    Result: "success",
  }),
  watchdogService: Object.freeze({
    Id: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService,
    LoadState: "loaded",
    ActiveState: "inactive",
    SubState: "dead",
    ActiveEnterTimestamp: "",
    MainPID: "0",
    Result: "success",
    NRestarts: "0",
    ExecMainStartTimestamp: "Wed 2026-08-19 21:56:19 CST",
    ExecMainExitTimestamp: "Wed 2026-08-19 21:56:19 CST",
  }),
})

function block(properties) {
  return Object.entries(properties).map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function systemdOutput(overrides = {}, omitted = []) {
  return Object.entries(baseUnits)
    .filter(([name]) => !omitted.includes(name))
    .map(([name, properties]) => block({ ...properties,
      ...(overrides[name] ?? {}) }))
    .join("\n\n")
}

function scheduleOutput(overrides = {}) {
  return JSON.stringify([{ next: NEXT_TRIGGER.getTime() * 1_000,
    last: LAST_TRIGGER.getTime() * 1_000,
    unit: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
    activates: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService,
    ...overrides }])
}

function adapter(options = {}) {
  return {
    readSystemdUnits: async () => options.systemd ?? systemdOutput(),
    readWatchdogSchedule: async () => options.schedule ?? scheduleOutput(),
    probePort3000: async () => options.port ?? "AVAILABLE",
  }
}

function collect(options = {}) {
  return collectSellerOsRuntimeHealthV1({
    adapter: options.adapter ?? adapter(options),
    now: () => NOW,
  })
}

test("healthy allowlisted runtime normalizes to complete HEALTHY evidence", async () => {
  const result = await collect()
  assert.equal(result.contractVersion, SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION)
  assert.equal(result.observedAt, NOW.toISOString())
  assert.equal(result.overallStatus, "HEALTHY")
  assert.equal(result.evidenceCompleteness, "COMPLETE")
  assert.deepEqual(result.limitations, [])
  assert.equal(result.services.mcp.status, "HEALTHY")
  assert.equal(result.services.mcp.mainPid, 12699)
  assert.equal(result.services.mcp.restartCount, 0)
  assert.equal(result.services.tunnel.status, "HEALTHY")
  assert.equal(result.services.watchdogTimer.status, "HEALTHY")
  assert.equal(result.services.watchdogTimer.lastTrigger,
    LAST_TRIGGER.toISOString())
  assert.equal(result.services.watchdogTimer.nextTrigger,
    NEXT_TRIGGER.toISOString())
  assert.equal(result.port3000.status, "AVAILABLE")
  assert.equal(result.watchdog.lastResult, "success")
  assert.equal(result.watchdog.lastSuccessAt,
    "2026-08-20T03:56:19.000Z")
})

test("an explicitly failed MCP service remains visible and makes runtime FAILED", async () => {
  const result = await collect({ systemd: systemdOutput({ mcp: {
    ActiveState: "failed", SubState: "failed", Result: "exit-code",
    MainPID: "0",
  } }) })
  assert.equal(result.services.mcp.status, "FAILED")
  assert.equal(result.services.mcp.mainPid, null)
  assert.equal(result.services.tunnel.status, "HEALTHY")
  assert.equal(result.overallStatus, "FAILED")
})

test("an explicitly failed tunnel service makes runtime FAILED", async () => {
  const result = await collect({ systemd: systemdOutput({ tunnel: {
    ActiveState: "inactive", SubState: "dead", Result: "exit-code",
    MainPID: "0",
  } }) })
  assert.equal(result.services.tunnel.status, "FAILED")
  assert.equal(result.services.mcp.status, "HEALTHY")
  assert.equal(result.overallStatus, "FAILED")
})

test("watchdog evidence unavailable is partial and never HEALTHY", async () => {
  const result = await collect({ systemd: systemdOutput({}, [
    "watchdogTimer", "watchdogService",
  ]) })
  assert.equal(result.services.watchdogTimer.status, "UNAVAILABLE")
  assert.deepEqual(result.watchdog, { lastRunAt: null, lastSuccessAt: null,
    lastResult: null })
  assert.equal(result.evidenceCompleteness, "PARTIAL")
  assert.equal(result.overallStatus, "DEGRADED")
  assert.ok(result.limitations.includes("WATCHDOG_TIMER_EVIDENCE_UNAVAILABLE"))
})

test("an observed unavailable port makes runtime FAILED without inventing zeroes", async () => {
  const result = await collect({ port: "UNAVAILABLE" })
  assert.equal(result.port3000.status, "UNAVAILABLE")
  assert.equal(result.evidenceCompleteness, "COMPLETE")
  assert.equal(result.overallStatus, "FAILED")
})

test("permission denied is normalized to unavailable evidence without throwing", async () => {
  const denied = async () => { throw new Error("permission denied: secret-value") }
  const result = await collect({ adapter: {
    readSystemdUnits: denied,
    readWatchdogSchedule: denied,
    probePort3000: async () => "AVAILABLE",
  } })
  assert.equal(result.services.mcp.status, "UNAVAILABLE")
  assert.equal(result.services.tunnel.status, "UNAVAILABLE")
  assert.equal(result.overallStatus, "UNAVAILABLE")
  assert.equal(result.evidenceCompleteness, "PARTIAL")
  assert.doesNotMatch(JSON.stringify(result), /permission denied|secret-value/)
})

test("a missing systemd service is unavailable rather than healthy", async () => {
  const result = await collect({ systemd: systemdOutput({}, ["mcp"]) })
  assert.equal(result.services.mcp.status, "UNAVAILABLE")
  assert.equal(result.services.mcp.mainPid, null)
  assert.equal(result.services.mcp.restartCount, null)
  assert.equal(result.overallStatus, "UNAVAILABLE")
  assert.ok(result.limitations.includes("MCP_SERVICE_EVIDENCE_UNAVAILABLE"))
})

test("malformed and unexpected collector output fails closed", async () => {
  const malformedMcp = block({ ...baseUnits.mcp,
    Id: "caller-selected.service",
    MainPID: "not-a-number",
  })
  const remaining = systemdOutput({}, ["mcp"])
  const result = await collect({
    systemd: `${malformedMcp}\nmalformed-line\n\n${remaining}`,
    port: "AVAILABLE<script>",
  })
  assert.equal(result.services.mcp.status, "UNAVAILABLE")
  assert.equal(result.port3000.status, "UNKNOWN")
  assert.equal(result.overallStatus, "UNAVAILABLE")
  assert.ok(result.limitations.includes(
    "SYSTEMD_UNEXPECTED_SERVICE_IDENTITY"))
  assert.ok(result.limitations.includes("PORT_3000_PROBE_UNAVAILABLE"))
})

test("unknown numeric evidence remains null and makes completeness partial", async () => {
  const result = await collect({ systemd: systemdOutput({ mcp: {
    MainPID: "unknown", NRestarts: "unknown",
  } }) })
  assert.equal(result.services.mcp.mainPid, null)
  assert.equal(result.services.mcp.restartCount, null)
  assert.notEqual(result.services.mcp.mainPid, 0)
  assert.notEqual(result.services.mcp.restartCount, 0)
  assert.equal(result.evidenceCompleteness, "PARTIAL")
  assert.equal(result.overallStatus, "DEGRADED")
})

test("overall normalization distinguishes unavailable core from degraded watchdog", async () => {
  const [unknownPort, failedWatchdog] = await Promise.all([
    collect({ port: "UNKNOWN" }),
    collect({ systemd: systemdOutput({ watchdogService: {
      Result: "exit-code",
    } }) }),
  ])
  assert.equal(unknownPort.overallStatus, "UNAVAILABLE")
  assert.equal(failedWatchdog.services.mcp.status, "HEALTHY")
  assert.equal(failedWatchdog.services.tunnel.status, "HEALTHY")
  assert.equal(failedWatchdog.watchdog.lastResult, "exit-code")
  assert.equal(failedWatchdog.overallStatus, "DEGRADED")
})

test("collector and tool scope are compile-time fixed with no shell or caller selection", () => {
  const source = readFileSync(new URL(
    "./ebay-seller-os-runtime-health-v1.ts", import.meta.url), "utf8")
  assert.deepEqual(SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1, {
    mcpService: "imnova-seller-os-mcp.service",
    tunnelService: "imnova-seller-os-tunnel.service",
    watchdogTimer: "imnova-seller-os-watchdog.timer",
    watchdogService: "imnova-seller-os-watchdog.service",
    host: "127.0.0.1",
    port: 3000,
  })
  assert.equal(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.name,
    "seller_os_get_runtime_health")
  assert.equal(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.annotations.readOnlyHint, true)
  assert.equal(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.annotations.destructiveHint,
    false)
  assert.equal(SELLER_OS_RUNTIME_HEALTH_TOOL_V1.sideEffects, false)
  assert.match(source, /execFile\(SYSTEMCTL_EXECUTABLE, \[\.\.\.args\]/)
  assert.doesNotMatch(source,
    /\bexec\s*\(|\bspawn\s*\(|shell\s*:\s*true|\beval\s*\(|process\.env/)
  assert.doesNotMatch(source,
    /options\.(?:service|port|command)\b|request\.(?:service|port|command)\b|input\.(?:service|port|command)\b/)
})

test("malformed sensitive-looking values and fallback output never leak secrets", async () => {
  const result = await collect({ systemd: systemdOutput({ mcp: {
    ActiveEnterTimestamp: "CONTROL_PLANE_API_KEY=do-not-expose",
    Result: "success-secret-value",
  } }) })
  const fallback = createUnavailableSellerOsRuntimeHealthV1(NOW.toISOString())
  const serialized = JSON.stringify({ result, fallback })
  assert.doesNotMatch(serialized,
    /CONTROL_PLANE_API_KEY|do-not-expose|secret-value|sk-(?:proj-)?/i)
  assert.equal(fallback.overallStatus, "UNAVAILABLE")
  assert.equal(fallback.safety.credentialsIncluded, false)
  assert.equal(fallback.safety.environmentValuesIncluded, false)
})

test("safety contract proves every prohibited mutation count is zero", async () => {
  const result = await collect()
  assert.deepEqual(result.safety, {
    readOnly: true,
    arbitraryShellAllowed: false,
    callerControlledServiceAllowed: false,
    credentialsIncluded: false,
    environmentValuesIncluded: false,
    marketplaceWrites: 0,
    inventoryWrites: 0,
    productCaseMutations: 0,
    lunaLinkMutations: 0,
    whatsappSends: 0,
  })
})
