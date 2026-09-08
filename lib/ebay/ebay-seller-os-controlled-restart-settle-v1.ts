import type { SellerOsRuntimeHealthV1 } from "./ebay-seller-os-runtime-health-v1"

/** Acceptance gate only: never changes the underlying runtime health authority. */
export const CONTROLLED_RESTART_SETTLE_VERSION = "SELLER_OS_CONTROLLED_RESTART_SETTLE_V1"
export type SettlePolicy = Readonly<{
  settleWindowMs: number
  probeIntervalMs: number
  perProbeBudgetMs: number
  maxProbeCount: number
  consecutiveHealthyReads: 2
}>
export type UnitObservation = Readonly<{
  activeState: string | null
  subState: string | null
  result: string | null
  pid: number | null
}>
export type SettleProbe = Readonly<{
  health: SellerOsRuntimeHealthV1 | null
  mcp: UnitObservation | null
  tunnel: UnitObservation | null
  watchdog: UnitObservation | null
  failureCode?: string | null
  runtimeReadAt?: string
  portAvailableAt?: string | null
}>
export type ControlledRestart = Readonly<{
  requestedAtMs: number
  previousMcpPid: number
  previousTunnelPid: number
}>

export function makeSettlePolicy(settleWindowMs: number, probeIntervalMs = 5_000): SettlePolicy {
  if (!Number.isFinite(settleWindowMs) || !Number.isFinite(probeIntervalMs) ||
    !Number.isInteger(settleWindowMs) || !Number.isInteger(probeIntervalMs) ||
    probeIntervalMs < 1 || settleWindowMs < 3 * probeIntervalMs || settleWindowMs > 120_000) {
    throw new Error("SETTLE_POLICY_NOT_FINITE_OR_BOUNDED")
  }
  return Object.freeze({ settleWindowMs, probeIntervalMs,
    perProbeBudgetMs: Math.min(5_000, probeIntervalMs),
    maxProbeCount: Math.ceil(settleWindowMs / probeIntervalMs), consecutiveHealthyReads: 2 })
}

// Calibrated with three physical baseline restarts, including a real watchdog
// running/DEGRADED observation; independently validated in three further trials.
// Formula and original observations live in the existing technical receipt.
export const CERTIFIED_CONTROLLED_RESTART_SETTLE_POLICY_V1 = makeSettlePolicy(30_000)

export function deriveMeasuredSettlePolicy(acceptedElapsedMs: readonly number[], intervalMs = 5_000) {
  if (acceptedElapsedMs.length < 3 || acceptedElapsedMs.some(x => !Number.isFinite(x) || x <= 0)) {
    throw new Error("AT_LEAST_THREE_PHYSICAL_ACCEPTED_RESTARTS_REQUIRED")
  }
  const maximumMs = Math.max(...acceptedElapsedMs), minimumMs = Math.min(...acceptedElapsedMs)
  // Reserve at least two spaced observations, 50% of the worst recovery, or its
  // entire observed spread, whichever is greater. Round up to one probe slot.
  const marginMs = Math.max(2 * intervalMs, maximumMs / 2, maximumMs - minimumMs)
  const windowMs = Math.ceil((maximumMs + marginMs) / intervalMs) * intervalMs
  return { policy: makeSettlePolicy(windowMs, intervalMs), maximumMs, minimumMs,
    requestedMarginMs: marginMs, actualMarginMs: windowMs - maximumMs,
    formula: "ceil((max + max(2*interval, 0.5*max, max-min))/interval)*interval" }
}

export function classifyControlledRestartProbe(input: {
  probe: SettleProbe
  controlledRestart: ControlledRestart | null
  elapsedMs: number
  policy: SettlePolicy
}) {
  const { probe, controlledRestart: context, elapsedMs, policy } = input
  const h = probe.health
  const base = { rawOverallStatus: h?.overallStatus ?? null }
  if (!context || elapsedMs < 0 || elapsedMs >= policy.settleWindowMs) {
    return { ...base, classification: "OUTSIDE_CONTROLLED_WINDOW" as const, acceptable: false }
  }
  const failedUnit = [probe.mcp, probe.tunnel, probe.watchdog].some(u => u &&
    (u.activeState === "failed" || (u.result && u.result !== "success")))
  const catalog = h?.runtimeCatalog
  const wrongCatalog = catalog && (catalog.workspaceRuntimeBindingStatus === "MISMATCHED" ||
    (catalog.runtimeCatalogCount !== null && catalog.runtimeCatalogCount !== 28) ||
    (catalog.expectedCatalogCount !== null && catalog.expectedCatalogCount !== 28))
  if (failedUnit || wrongCatalog || ["AUTH_REQUIRED", "PROTECTION_REQUIRED"].includes(probe.failureCode ?? "")) {
    return { ...base, classification: "UNEXPECTED_RUNTIME_FAILURE" as const, acceptable: false }
  }
  const watchdogRunning = ["activating", "active", "deactivating"].includes(probe.watchdog?.activeState ?? "") ||
    h?.services.watchdogTimer.subState === "running"
  const restarting = [probe.mcp, probe.tunnel].some(u => u &&
    ["activating", "deactivating", "reloading", "inactive"].includes(u.activeState ?? ""))
  const fresh = h && Date.parse(h.observedAt) >= context.requestedAtMs
  const restarted = h && Number.isInteger(h.services.mcp.mainPid) && Number.isInteger(h.services.tunnel.mainPid) &&
    (h.services.mcp.mainPid ?? 0) > 0 && (h.services.tunnel.mainPid ?? 0) > 0 &&
    h.services.mcp.mainPid !== context.previousMcpPid && h.services.tunnel.mainPid !== context.previousTunnelPid
  const completedWatchdog = h?.watchdog.lastResult === "success" &&
    Boolean(h.watchdog.lastRunAt && h.watchdog.lastSuccessAt) &&
    Date.parse(h.watchdog.lastSuccessAt!) >= Date.parse(h.watchdog.lastRunAt!)
  const acceptable = Boolean(fresh && restarted && !watchdogRunning && !probe.failureCode &&
    h?.overallStatus === "HEALTHY" && h.evidenceCompleteness === "COMPLETE" &&
    h.services.mcp.status === "HEALTHY" && h.services.tunnel.status === "HEALTHY" &&
    h.port3000.status === "AVAILABLE" && h.services.watchdogTimer.status === "HEALTHY" &&
    completedWatchdog && catalog?.runtimeCatalogCount === 28 && catalog.expectedCatalogCount === 28 &&
    catalog.exactCatalogMatch && catalog.runtimeWorkingDirectoryMatch &&
    catalog.workspaceRuntimeBindingStatus === "MATCHED")
  return { ...base, acceptable, classification: acceptable ? "FULL_RUNTIME_INVARIANTS_OBSERVED" as const :
    watchdogRunning || restarting ? "TRANSIENT_SETTLING" as const : "PENDING_UNPROVEN_EVIDENCE" as const }
}

class DeadlineError extends Error {}
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, budgetMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        reject(new DeadlineError("CONTROLLED_RESTART_BUDGET_EXPIRED"))
        controller.abort()
      }, Math.max(0, budgetMs)) })])
  } finally { if (timer) clearTimeout(timer); controller.abort() }
}

type SettleInput = {
  phase: "ACTIVATION" | "ROLLBACK" | "BASELINE_CERTIFICATION" | "WATCHDOG_RECOVERY"
  policy: SettlePolicy
  previousMcpPid: number
  previousTunnelPid: number
  restart: (signal: AbortSignal) => Promise<void>
  probe: (signal: AbortSignal) => Promise<SettleProbe>
  onObservation?: (row: Record<string, unknown>) => void
  previousProbeCount?: number
}

export async function restartAndSettle(input: SettleInput) {
  return runSettle(input)
}

/** Observe an already started lifecycle without resetting its original deadline.
 * Zero predecessor PIDs mean a natural start with no observed predecessor; all
 * current identities, freshness, catalog and health invariants still apply. */
export async function observeExistingLifecycle(input: Omit<SettleInput, "restart"> & { requestedAtMs: number }) {
  return runSettle({ ...input, restart: async () => {} }, input.requestedAtMs)
}

async function runSettle(input: SettleInput, existingStartMs?: number) {
  const policy = makeSettlePolicy(input.policy.settleWindowMs, input.policy.probeIntervalMs)
  if (JSON.stringify(policy) !== JSON.stringify(input.policy)) throw new Error("SETTLE_POLICY_INCONSISTENT")
  if (!Number.isInteger(input.previousProbeCount ?? 0) || (input.previousProbeCount ?? 0) < 0 ||
    (input.previousProbeCount ?? 0) > policy.maxProbeCount) throw new Error("PREVIOUS_PROBE_COUNT_INVALID")
  if (![input.previousMcpPid, input.previousTunnelPid].every(x => Number.isInteger(x) && x >= (existingStartMs === undefined ? 1 : 0))) {
    throw new Error("PREVIOUS_PROCESS_IDENTITIES_REQUIRED")
  }
  const start = performance.now(), requestedAtMs = existingStartMs ?? Date.now()
  const initialAgeMs = Date.now() - requestedAtMs
  if (!Number.isFinite(initialAgeMs) || initialAgeMs < 0) throw new Error("LIFECYCLE_START_TIME_UNPROVEN")
  const context = { requestedAtMs, previousMcpPid: input.previousMcpPid, previousTunnelPid: input.previousTunnelPid }
  const elapsed = () => initialAgeMs + performance.now() - start
  const remaining = () => Math.max(0, policy.settleWindowMs - elapsed())
  const requestedAt = new Date(requestedAtMs).toISOString()
  let firstHealthyMs: number | null = null, consecutive = 0, probeCount = input.previousProbeCount ?? 0
  let acceptedIdentity: string | null = null, latestWatchdogRunMs = -Infinity
  const observations: Record<string, unknown>[] = []
  const finish = (status: "ACCEPTED" | "SETTLE_TIMEOUT" | "SETTLE_FAILURE") => ({
    contractVersion: CONTROLLED_RESTART_SETTLE_VERSION, phase: input.phase, policy, status,
    restartRequestedAt: requestedAt, elapsedMs: Math.round(elapsed()), firstHealthyMs,
    fullAcceptanceMs: status === "ACCEPTED" ? Math.round(elapsed()) : null, probeCount, observations,
    nextAction: status === "ACCEPTED" ? "RUN_REQUIRED_CONNECTED_CANARIES" :
      input.phase === "ACTIVATION" ? "RESTORE_IMMUTABLE_BASELINE_AND_APPLY_SAME_SETTLE_CONTRACT" :
      "STOP_AND_ESCALATE_NO_UNBOUNDED_RECOVERY",
  })
  // Restart is inside the same overall deadline; even an uncooperative child or
  // probe cannot extend the acceptance loop. Observation never initiates a restart.
  try { if (existingStartMs === undefined) await bounded(input.restart, remaining()) }
  catch (error) { if (error instanceof DeadlineError) return finish("SETTLE_TIMEOUT"); throw error }
  while (remaining() > 0 && probeCount < policy.maxProbeCount) {
    probeCount++
    let probe: SettleProbe
    try { probe = await bounded(input.probe, Math.min(policy.perProbeBudgetMs, remaining())) }
    catch (error) {
      if (!(error instanceof DeadlineError)) throw error
      probe = { health: null, mcp: null, tunnel: null, watchdog: null, failureCode: "PROBE_BUDGET_EXPIRED" }
    }
    if (remaining() <= 0) return finish("SETTLE_TIMEOUT")
    const result = classifyControlledRestartProbe({ probe, controlledRestart: context, elapsedMs: elapsed(), policy })
    const runMs = Date.parse(probe.health?.watchdog.lastRunAt ?? "")
    if (Number.isFinite(runMs)) latestWatchdogRunMs = Math.max(latestWatchdogRunMs, runMs)
    if (result.acceptable && Date.parse(probe.health?.watchdog.lastSuccessAt ?? "") < latestWatchdogRunMs) {
      result.acceptable = false
      result.classification = "PENDING_UNPROVEN_EVIDENCE"
    }
    if (probe.health?.overallStatus === "HEALTHY" && firstHealthyMs === null) firstHealthyMs = Math.round(elapsed())
    const row = { probeCount, observedAt: new Date().toISOString(), elapsedMs: Math.round(elapsed()), ...result, probe }
    observations.push(row); input.onObservation?.(row)
    if (result.classification === "UNEXPECTED_RUNTIME_FAILURE") return finish("SETTLE_FAILURE")
    const identity = probe.health ? `${probe.health.services.mcp.mainPid}:${probe.health.services.tunnel.mainPid}` : null
    consecutive = result.acceptable ? (identity === acceptedIdentity ? consecutive + 1 : 1) : 0
    acceptedIdentity = result.acceptable ? identity : null
    if (consecutive >= policy.consecutiveHealthyReads) return finish("ACCEPTED")
    await new Promise(resolve => setTimeout(resolve, Math.min(policy.probeIntervalMs, remaining())))
  }
  return finish("SETTLE_TIMEOUT")
}
