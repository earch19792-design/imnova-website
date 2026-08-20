import { execFile } from "node:child_process"
import { createConnection } from "node:net"

export const SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION =
  "SELLER_OS_RUNTIME_HEALTH_V1"

export const SELLER_OS_RUNTIME_HEALTH_TOOL_V1 = Object.freeze({
  name: "seller_os_get_runtime_health",
  title: "Get Seller OS runtime health",
  description: "Inspect only the fixed local Seller OS MCP service, tunnel service, watchdog timer, watchdog execution, and loopback port 3000. This read cannot select commands, services, ports, files, URLs, or environment values and cannot repair runtime state.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export const SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1 = Object.freeze({
  mcpService: "imnova-seller-os-mcp.service",
  tunnelService: "imnova-seller-os-tunnel.service",
  watchdogTimer: "imnova-seller-os-watchdog.timer",
  watchdogService: "imnova-seller-os-watchdog.service",
  host: "127.0.0.1" as const,
  port: 3000 as const,
})

type RuntimeStatusV1 = "HEALTHY" | "DEGRADED" | "FAILED" | "UNAVAILABLE"
type PortStatusV1 = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN"

type RuntimeServiceHealthV1 = Readonly<{
  service: string
  status: RuntimeStatusV1
  activeState: string | null
  subState: string | null
  result: string | null
  mainPid: number | null
  restartCount: number | null
  activeEnterTimestamp: string | null
}>

type WatchdogTimerHealthV1 = Readonly<{
  service: string
  status: RuntimeStatusV1
  activeState: string | null
  subState: string | null
  lastTrigger: string | null
  nextTrigger: string | null
}>

export type SellerOsRuntimeHealthV1 = Readonly<{
  contractVersion: typeof SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION
  observedAt: string
  overallStatus: RuntimeStatusV1
  services: Readonly<{
    mcp: RuntimeServiceHealthV1
    tunnel: RuntimeServiceHealthV1
    watchdogTimer: WatchdogTimerHealthV1
  }>
  port3000: Readonly<{
    host: "127.0.0.1"
    port: 3000
    status: PortStatusV1
    observedAt: string
  }>
  watchdog: Readonly<{
    lastRunAt: string | null
    lastSuccessAt: string | null
    lastResult: string | null
  }>
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
  limitations: readonly string[]
  safety: Readonly<{
    readOnly: true
    arbitraryShellAllowed: false
    callerControlledServiceAllowed: false
    credentialsIncluded: false
    environmentValuesIncluded: false
    marketplaceWrites: 0
    inventoryWrites: 0
    productCaseMutations: 0
    lunaLinkMutations: 0
    whatsappSends: 0
  }>
}>

export type SellerOsRuntimeHealthAdapterV1 = Readonly<{
  readSystemdUnits: () => Promise<string>
  readWatchdogSchedule: () => Promise<string>
  probePort3000: () => Promise<PortStatusV1>
}>

const SYSTEMCTL_EXECUTABLE = "/usr/bin/systemctl"
const SYSTEMD_OUTPUT_MAX_BYTES = 32_768
const TIMER_OUTPUT_MAX_BYTES = 4_096
const COLLECTOR_TIMEOUT_MS = 2_000
const PORT_PROBE_TIMEOUT_MS = 750
const MAX_LIMITATIONS = 24

const SYSTEMD_SHOW_ARGUMENTS = Object.freeze([
  "--user",
  "show",
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService,
  "--no-pager",
  "--property=Id,LoadState,ActiveState,SubState,Result,MainPID,NRestarts,ActiveEnterTimestamp,LastTriggerUSec,ExecMainStartTimestamp,ExecMainExitTimestamp",
])

const WATCHDOG_SCHEDULE_ARGUMENTS = Object.freeze([
  "--user",
  "list-timers",
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
  "--all",
  "--no-pager",
  "--output=json",
])

const SYSTEMD_PROPERTY_ALLOWLIST = new Set([
  "Id", "LoadState", "ActiveState", "SubState", "Result", "MainPID",
  "NRestarts", "ActiveEnterTimestamp", "LastTriggerUSec",
  "ExecMainStartTimestamp", "ExecMainExitTimestamp",
])

const SYSTEMD_UNIT_ALLOWLIST = new Set<string>([
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService,
])

const SYSTEMD_ACTIVE_STATE_ALLOWLIST = new Set([
  "active", "reloading", "inactive", "failed", "activating",
  "deactivating", "maintenance", "refreshing",
])
const SYSTEMD_SUB_STATE_ALLOWLIST = new Set([
  "running", "exited", "dead", "failed", "waiting", "elapsed", "active",
  "auto-restart", "start-pre", "start", "start-post", "reload", "stop",
  "stop-sigterm", "stop-sigkill", "stop-post", "final-sigterm",
  "final-sigkill", "final-watchdog", "condition", "plugged", "mounted",
])
const SYSTEMD_RESULT_ALLOWLIST = new Set([
  "success", "exit-code", "signal", "core-dump", "watchdog", "timeout",
  "start-limit-hit", "resources", "oom-kill", "protocol", "dependency",
  "assert", "condition", "skip-condition", "exec-condition", "clean",
])

const SAFETY = Object.freeze({
  readOnly: true as const,
  arbitraryShellAllowed: false as const,
  callerControlledServiceAllowed: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
})

function runFixedSystemctl(
  args: readonly string[],
  maxBuffer: number,
) {
  return new Promise<string>((resolve, reject) => {
    execFile(SYSTEMCTL_EXECUTABLE, [...args], {
      encoding: "utf8",
      timeout: COLLECTOR_TIMEOUT_MS,
      maxBuffer,
      windowsHide: true,
    }, (error, stdout) => {
      const boundedOutput = typeof stdout === "string" ? stdout : ""
      if (error && !boundedOutput.trim()) {
        reject(new Error("SELLER_OS_RUNTIME_SYSTEMD_READ_UNAVAILABLE"))
        return
      }
      resolve(boundedOutput)
    })
  })
}

function probeFixedPort3000V1() {
  return new Promise<PortStatusV1>((resolve) => {
    const socket = createConnection({
      host: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.host,
      port: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.port,
    })
    let settled = false
    const finish = (status: PortStatusV1) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(status)
    }
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS)
    socket.once("connect", () => finish("AVAILABLE"))
    socket.once("timeout", () => finish("UNKNOWN"))
    socket.once("error", (error: NodeJS.ErrnoException) => finish(
      ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code ?? "")
        ? "UNAVAILABLE"
        : "UNKNOWN",
    ))
  })
}

const DEFAULT_ADAPTER: SellerOsRuntimeHealthAdapterV1 = Object.freeze({
  readSystemdUnits: () => runFixedSystemctl(
    SYSTEMD_SHOW_ARGUMENTS,
    SYSTEMD_OUTPUT_MAX_BYTES,
  ),
  readWatchdogSchedule: () => runFixedSystemctl(
    WATCHDOG_SCHEDULE_ARGUMENTS,
    TIMER_OUTPUT_MAX_BYTES,
  ),
  probePort3000: probeFixedPort3000V1,
})

type SystemdPropertiesV1 = Readonly<Record<string, string>>

function parseSystemdShowV1(raw: string) {
  const limitations: string[] = []
  const units = new Map<string, SystemdPropertiesV1>()
  if (Buffer.byteLength(raw, "utf8") > SYSTEMD_OUTPUT_MAX_BYTES) {
    return { units, limitations: ["SYSTEMD_OUTPUT_NOT_BOUNDED"] }
  }
  for (const block of raw.trim().split(/\n\s*\n/).filter(Boolean)) {
    const properties: Record<string, string> = {}
    let malformed = false
    for (const line of block.split("\n")) {
      const separator = line.indexOf("=")
      if (separator < 1) {
        malformed = true
        continue
      }
      const key = line.slice(0, separator)
      const value = line.slice(separator + 1)
      if (!SYSTEMD_PROPERTY_ALLOWLIST.has(key)) {
        malformed = true
        continue
      }
      if (value.length > 160 || Object.hasOwn(properties, key)) {
        malformed = true
        continue
      }
      properties[key] = value
    }
    const id = properties.Id
    if (!id || !SYSTEMD_UNIT_ALLOWLIST.has(id)) {
      limitations.push("SYSTEMD_UNEXPECTED_SERVICE_IDENTITY")
      continue
    }
    if (units.has(id)) {
      limitations.push("SYSTEMD_OUTPUT_MALFORMED")
      continue
    }
    if (malformed) limitations.push("SYSTEMD_OUTPUT_MALFORMED")
    units.set(id, Object.freeze(properties))
  }
  if (!raw.trim()) limitations.push("SYSTEMD_OUTPUT_UNAVAILABLE")
  return { units, limitations }
}

function safeSystemdValue(
  value: string | undefined,
  allowlist: ReadonlySet<string>,
) {
  return value && allowlist.has(value) ? value : null
}

function safeTimestamp(value: string | undefined) {
  if (!value || value.length > 100 ||
      !/^[a-zA-Z0-9,:+ ._-]+$/.test(value)) return null
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function safeInteger(value: string | undefined, zeroIsNull = false) {
  if (!value || !/^\d+$/.test(value)) return { value: null, valid: false }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return { value: null, valid: false }
  }
  return { value: zeroIsNull && parsed === 0 ? null : parsed, valid: true }
}

function unavailableService(service: string): RuntimeServiceHealthV1 {
  return Object.freeze({ service, status: "UNAVAILABLE", activeState: null,
    subState: null, result: null, mainPid: null, restartCount: null,
    activeEnterTimestamp: null })
}

function normalizeServiceV1(
  properties: SystemdPropertiesV1 | undefined,
  service: string,
  code: "MCP" | "TUNNEL",
  limitations: string[],
): RuntimeServiceHealthV1 {
  if (!properties || properties.LoadState !== "loaded") {
    limitations.push(`${code}_SERVICE_EVIDENCE_UNAVAILABLE`)
    return unavailableService(service)
  }
  const activeState = safeSystemdValue(properties.ActiveState,
    SYSTEMD_ACTIVE_STATE_ALLOWLIST)
  const subState = safeSystemdValue(properties.SubState,
    SYSTEMD_SUB_STATE_ALLOWLIST)
  const result = safeSystemdValue(properties.Result,
    SYSTEMD_RESULT_ALLOWLIST)
  const mainPid = safeInteger(properties.MainPID, true)
  const restartCount = safeInteger(properties.NRestarts)
  const activeEnterTimestamp = safeTimestamp(properties.ActiveEnterTimestamp)
  if (!activeState) limitations.push(`${code}_ACTIVE_STATE_UNAVAILABLE`)
  if (!subState) limitations.push(`${code}_SUB_STATE_UNAVAILABLE`)
  if (!result) limitations.push(`${code}_RESULT_UNAVAILABLE`)
  if (!mainPid.valid) limitations.push(`${code}_MAIN_PID_UNAVAILABLE`)
  if (!restartCount.valid) limitations.push(`${code}_RESTART_COUNT_UNAVAILABLE`)
  if (!activeEnterTimestamp) {
    limitations.push(`${code}_ACTIVE_ENTER_TIMESTAMP_UNAVAILABLE`)
  }
  let status: RuntimeStatusV1 = "UNAVAILABLE"
  if (activeState === "failed" || activeState === "inactive" ||
      result && result !== "success") {
    status = "FAILED"
  } else if (activeState === "active" && subState === "running" &&
      result === "success") {
    status = "HEALTHY"
  } else if (["active", "activating", "deactivating", "reloading"]
    .includes(activeState ?? "")) {
    status = "DEGRADED"
  }
  return Object.freeze({ service, status, activeState, subState, result,
    mainPid: mainPid.value, restartCount: restartCount.value,
    activeEnterTimestamp })
}

function microsecondsToIso(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }
  const timestamp = new Date(value / 1_000)
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString()
}

function parseWatchdogScheduleV1(raw: string) {
  if (Buffer.byteLength(raw, "utf8") > TIMER_OUTPUT_MAX_BYTES) {
    return { lastTrigger: null, nextTrigger: null,
      limitation: "WATCHDOG_SCHEDULE_NOT_BOUNDED" }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 1 ||
        !parsed[0] || typeof parsed[0] !== "object") {
      throw new Error("WATCHDOG_SCHEDULE_INVALID")
    }
    const row = parsed[0] as Record<string, unknown>
    if (row.unit !== SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer ||
        row.activates !== SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService) {
      return { lastTrigger: null, nextTrigger: null,
        limitation: "WATCHDOG_SCHEDULE_IDENTITY_UNEXPECTED" }
    }
    const lastTrigger = microsecondsToIso(row.last)
    const nextTrigger = microsecondsToIso(row.next)
    return { lastTrigger, nextTrigger,
      limitation: lastTrigger && nextTrigger ? null :
        "WATCHDOG_SCHEDULE_MALFORMED" }
  } catch {
    return { lastTrigger: null, nextTrigger: null,
      limitation: "WATCHDOG_SCHEDULE_MALFORMED" }
  }
}

function normalizeWatchdogTimerV1(
  properties: SystemdPropertiesV1 | undefined,
  schedule: ReturnType<typeof parseWatchdogScheduleV1>,
  limitations: string[],
): WatchdogTimerHealthV1 {
  const service = SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer
  if (!properties || properties.LoadState !== "loaded") {
    limitations.push("WATCHDOG_TIMER_EVIDENCE_UNAVAILABLE")
    return Object.freeze({ service, status: "UNAVAILABLE", activeState: null,
      subState: null, lastTrigger: null, nextTrigger: null })
  }
  const activeState = safeSystemdValue(properties.ActiveState,
    SYSTEMD_ACTIVE_STATE_ALLOWLIST)
  const subState = safeSystemdValue(properties.SubState,
    SYSTEMD_SUB_STATE_ALLOWLIST)
  const result = safeSystemdValue(properties.Result,
    SYSTEMD_RESULT_ALLOWLIST)
  if (!activeState) limitations.push("WATCHDOG_TIMER_ACTIVE_STATE_UNAVAILABLE")
  if (!subState) limitations.push("WATCHDOG_TIMER_SUB_STATE_UNAVAILABLE")
  if (schedule.limitation) limitations.push(schedule.limitation)
  let status: RuntimeStatusV1 = "UNAVAILABLE"
  if (activeState === "failed" || activeState === "inactive" ||
      result && result !== "success") {
    status = "FAILED"
  } else if (activeState === "active" && subState === "waiting" &&
      result === "success" && schedule.lastTrigger && schedule.nextTrigger) {
    status = "HEALTHY"
  } else if (["active", "activating", "deactivating", "reloading"]
    .includes(activeState ?? "")) {
    status = "DEGRADED"
  }
  return Object.freeze({ service, status, activeState, subState,
    lastTrigger: schedule.lastTrigger, nextTrigger: schedule.nextTrigger })
}

function normalizeWatchdogExecutionV1(
  properties: SystemdPropertiesV1 | undefined,
  limitations: string[],
) {
  if (!properties || properties.LoadState !== "loaded") {
    limitations.push("WATCHDOG_EXECUTION_EVIDENCE_UNAVAILABLE")
    return Object.freeze({ lastRunAt: null, lastSuccessAt: null,
      lastResult: null })
  }
  const lastRunAt = safeTimestamp(properties.ExecMainStartTimestamp)
  const lastResult = safeSystemdValue(properties.Result,
    SYSTEMD_RESULT_ALLOWLIST)
  const exitTimestamp = safeTimestamp(properties.ExecMainExitTimestamp)
  if (!lastRunAt) limitations.push("WATCHDOG_LAST_RUN_UNAVAILABLE")
  if (!lastResult) limitations.push("WATCHDOG_LAST_RESULT_UNAVAILABLE")
  if (lastResult === "success" && !exitTimestamp) {
    limitations.push("WATCHDOG_LAST_SUCCESS_UNAVAILABLE")
  }
  return Object.freeze({ lastRunAt,
    lastSuccessAt: lastResult === "success" ? exitTimestamp : null,
    lastResult })
}

function deriveOverallStatusV1(input: {
  mcp: RuntimeServiceHealthV1
  tunnel: RuntimeServiceHealthV1
  watchdogTimer: WatchdogTimerHealthV1
  portStatus: PortStatusV1
  watchdogLastResult: string | null
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
}): RuntimeStatusV1 {
  if (input.mcp.status === "FAILED" || input.tunnel.status === "FAILED" ||
      input.portStatus === "UNAVAILABLE") return "FAILED"
  if (input.mcp.status === "UNAVAILABLE" ||
      input.tunnel.status === "UNAVAILABLE" ||
      input.portStatus === "UNKNOWN") return "UNAVAILABLE"
  if (input.mcp.status !== "HEALTHY" || input.tunnel.status !== "HEALTHY" ||
      input.watchdogTimer.status !== "HEALTHY" ||
      input.watchdogLastResult !== "success" ||
      input.evidenceCompleteness !== "COMPLETE") return "DEGRADED"
  return "HEALTHY"
}

function observedAt(now: () => Date) {
  try {
    const value = now()
    if (!Number.isNaN(value.getTime())) return value.toISOString()
  } catch {
    // The deterministic fallback below preserves the collector contract.
  }
  return new Date().toISOString()
}

export function createUnavailableSellerOsRuntimeHealthV1(
  timestamp = new Date().toISOString(),
): SellerOsRuntimeHealthV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION,
    observedAt: timestamp,
    overallStatus: "UNAVAILABLE",
    services: Object.freeze({
      mcp: unavailableService(
        SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
      ),
      tunnel: unavailableService(
        SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
      ),
      watchdogTimer: Object.freeze({
        service: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
        status: "UNAVAILABLE" as const,
        activeState: null,
        subState: null,
        lastTrigger: null,
        nextTrigger: null,
      }),
    }),
    port3000: Object.freeze({
      host: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.host,
      port: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.port,
      status: "UNKNOWN" as const,
      observedAt: timestamp,
    }),
    watchdog: Object.freeze({ lastRunAt: null, lastSuccessAt: null,
      lastResult: null }),
    evidenceCompleteness: "UNAVAILABLE",
    limitations: Object.freeze(["RUNTIME_HEALTH_COLLECTOR_FAILED_CLOSED"]),
    safety: SAFETY,
  })
}

export async function collectSellerOsRuntimeHealthV1(options: {
  adapter?: SellerOsRuntimeHealthAdapterV1
  now?: () => Date
} = {}): Promise<SellerOsRuntimeHealthV1> {
  const adapter = options.adapter ?? DEFAULT_ADAPTER
  const timestamp = observedAt(options.now ?? (() => new Date()))
  const limitations: string[] = []
  const [systemdResult, scheduleResult, portResult] = await Promise.allSettled([
    adapter.readSystemdUnits(),
    adapter.readWatchdogSchedule(),
    adapter.probePort3000(),
  ])

  const parsedSystemd = systemdResult.status === "fulfilled"
    ? parseSystemdShowV1(systemdResult.value)
    : { units: new Map<string, SystemdPropertiesV1>(),
        limitations: ["SYSTEMD_EVIDENCE_UNAVAILABLE"] }
  limitations.push(...parsedSystemd.limitations)

  const schedule = scheduleResult.status === "fulfilled"
    ? parseWatchdogScheduleV1(scheduleResult.value)
    : { lastTrigger: null, nextTrigger: null,
        limitation: "WATCHDOG_SCHEDULE_UNAVAILABLE" }

  const mcp = normalizeServiceV1(parsedSystemd.units.get(
    SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
  ), SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService,
  "MCP", limitations)
  const tunnel = normalizeServiceV1(parsedSystemd.units.get(
    SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
  ), SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService,
  "TUNNEL", limitations)
  const watchdogTimer = normalizeWatchdogTimerV1(parsedSystemd.units.get(
    SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer,
  ), schedule, limitations)
  const watchdog = normalizeWatchdogExecutionV1(parsedSystemd.units.get(
    SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogService,
  ), limitations)

  let portStatus: PortStatusV1 = "UNKNOWN"
  if (portResult.status === "fulfilled" &&
      ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"].includes(portResult.value)) {
    portStatus = portResult.value
  } else {
    limitations.push("PORT_3000_PROBE_UNAVAILABLE")
  }
  if (portStatus === "UNKNOWN") limitations.push("PORT_3000_STATUS_UNKNOWN")

  const boundedLimitations = Object.freeze([...new Set(limitations)]
    .sort().slice(0, MAX_LIMITATIONS))
  const anyEvidence = [mcp.activeState, tunnel.activeState,
    watchdogTimer.activeState, watchdog.lastRunAt].some(Boolean) ||
    portStatus !== "UNKNOWN"
  const evidenceCompleteness = boundedLimitations.length === 0
    ? "COMPLETE" as const
    : anyEvidence ? "PARTIAL" as const : "UNAVAILABLE" as const
  const overallStatus = deriveOverallStatusV1({ mcp, tunnel, watchdogTimer,
    portStatus, watchdogLastResult: watchdog.lastResult,
    evidenceCompleteness })

  return Object.freeze({
    contractVersion: SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION,
    observedAt: timestamp,
    overallStatus,
    services: Object.freeze({ mcp, tunnel, watchdogTimer }),
    port3000: Object.freeze({
      host: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.host,
      port: SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.port,
      status: portStatus,
      observedAt: timestamp,
    }),
    watchdog,
    evidenceCompleteness,
    limitations: boundedLimitations,
    safety: SAFETY,
  })
}
