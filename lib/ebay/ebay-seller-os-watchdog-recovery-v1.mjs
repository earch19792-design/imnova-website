import { CERTIFIED_CONTROLLED_RESTART_SETTLE_POLICY_V1 } from "./ebay-seller-os-controlled-restart-settle-v1.ts"

export const WATCHDOG_RECOVERY_VERSION = "SELLER_OS_WATCHDOG_BOUNDED_RECOVERY_V1"
export const MAX_RECOVERY_ATTEMPTS = 2
export const RECOVERY_WINDOW_MS = 60 * 60 * 1000
export const SETTLE_POLICY = CERTIFIED_CONTROLLED_RESTART_SETTLE_POLICY_V1

export function initialRecoveryState(bootId, previousAttempts = []) {
  const attempts = [...previousAttempts].sort((a, b) => a - b)
  return { version: WATCHDOG_RECOVERY_VERSION, bootId,
    recoveryWindowStartedAtMs: attempts[0] ?? null, recoveryAttemptOrdinal: attempts.length,
    lastRecoveryAtMs: attempts.at(-1) ?? null, recoveryExhausted: attempts.length >= MAX_RECOVERY_ATTEMPTS,
    status: attempts.length >= MAX_RECOVERY_ATTEMPTS ? "RECOVERY_POLICY_EXHAUSTED" : "UNPROVEN",
    lifecycleId: null, settle: null, doctorFailure: null, localHttpFailure: null }
}

export function validateRecoveryState(s) {
  if (!s || s.version !== WATCHDOG_RECOVERY_VERSION || typeof s.bootId !== "string" ||
    !Number.isInteger(s.recoveryAttemptOrdinal) || s.recoveryAttemptOrdinal < 0 ||
    typeof s.recoveryExhausted !== "boolean" || typeof s.status !== "string" ||
    ![s.recoveryWindowStartedAtMs, s.lastRecoveryAtMs].every(x => x === null || Number.isFinite(x) && x > 0) ||
    (s.recoveryAttemptOrdinal > 0 && (!s.recoveryWindowStartedAtMs || !s.lastRecoveryAtMs)) ||
    (s.lastRecoveryAtMs !== null && s.lastRecoveryAtMs < s.recoveryWindowStartedAtMs) ||
    (s.settle && (!Number.isFinite(s.settle.startedAtMs) || s.settle.startedAtMs <= 0 ||
      s.settle.deadlineMs !== s.settle.startedAtMs + SETTLE_POLICY.settleWindowMs ||
      !Number.isInteger(s.settle.probeCount) || s.settle.probeCount < 0 || s.settle.probeCount > SETTLE_POLICY.maxProbeCount))) {
    throw new Error("RECOVERY_STATE_UNPROVEN_NO_RESTART")
  }
  return s
}

export function beginSettle(state, { kind, startedAtMs, lifecycleId, previousMcpPid = 0, previousTunnelPid = 0 }) {
  state.lifecycleId = lifecycleId
  state.status = kind === "HEALTH_CHECK" ? "FULL_HEALTH_VERIFICATION_PENDING" : "INITIALIZATION_PENDING"
  state.settle = { id: `${kind}:${startedAtMs}`, kind, startedAtMs,
    deadlineMs: startedAtMs + SETTLE_POLICY.settleWindowMs, previousMcpPid, previousTunnelPid, probeCount: 0 }
  return state
}

/** One durable budget across timer cycles, successful reads and host boots.
 * Attempts are reserved before invoking systemctl. Only the fixed hour boundary
 * permits a new automatic cycle; healthy evidence never replenishes the budget. */
export function decideRecovery({ state, nowMs, lifecycleId, lifecycleStartedAtMs, localOk, doctorFailure }) {
  const s = structuredClone(validateRecoveryState(state))
  const answer = (action, reason) => ({ action, reason, state: s })
  if (!Number.isFinite(nowMs) || nowMs < (s.lastRecoveryAtMs ?? 0) || nowMs < (s.settle?.startedAtMs ?? 0) ||
    !Number.isFinite(lifecycleStartedAtMs) || lifecycleStartedAtMs <= 0 || lifecycleStartedAtMs > nowMs) {
    s.status = "LIFECYCLE_START_TIME_UNPROVEN"
    return answer("ESCALATE", s.status)
  }
  if (doctorFailure) s.doctorFailure = doctorFailure // Preserve evidence even after subsequent success.
  if (localOk === false) s.localHttpFailure = "LOCAL_HTTP_UNRESPONSIVE"
  if (s.settle && nowMs < s.settle.deadlineMs) {
    return answer("OBSERVE", s.status) // Never move the clock on another probe/timer invocation.
  }
  if (lifecycleId !== s.lifecycleId && nowMs - lifecycleStartedAtMs < SETTLE_POLICY.settleWindowMs) {
    beginSettle(s, { kind: "STARTUP", startedAtMs: lifecycleStartedAtMs, lifecycleId })
    return answer("OBSERVE", s.status)
  }
  const failedSettle = Boolean(s.settle)
  s.lifecycleId = lifecycleId
  if (s.recoveryWindowStartedAtMs !== null && nowMs - s.recoveryWindowStartedAtMs >= RECOVERY_WINDOW_MS) {
    s.recoveryWindowStartedAtMs = null; s.recoveryAttemptOrdinal = 0; s.recoveryExhausted = false
  }
  if (localOk && (!failedSettle || s.recoveryAttemptOrdinal >= MAX_RECOVERY_ATTEMPTS)) {
    beginSettle(s, { kind: "HEALTH_CHECK", startedAtMs: nowMs, lifecycleId })
    return answer("OBSERVE", s.status)
  }
  s.status = "STARTUP_SETTLE_EXHAUSTED"
  if (s.recoveryAttemptOrdinal >= MAX_RECOVERY_ATTEMPTS) {
    s.recoveryExhausted = true; s.status = "RECOVERY_POLICY_EXHAUSTED"
    return answer("ESCALATE", s.status)
  }
  s.recoveryWindowStartedAtMs ??= nowMs
  s.recoveryAttemptOrdinal++
  s.lastRecoveryAtMs = nowMs
  s.recoveryExhausted = s.recoveryAttemptOrdinal >= MAX_RECOVERY_ATTEMPTS
  return answer("RESTART_MCP", "STARTUP_SETTLE_EXHAUSTED")
}

export function recordSettleResult(state, result) {
  validateRecoveryState(state)
  if (!state.settle) throw new Error("SETTLE_TRANSACTION_REQUIRED")
  if (state.lastSettle?.id === state.settle.id) return state
  state.lastSettle = { id: state.settle.id, status: result.status, elapsedMs: result.elapsedMs,
    probeCount: result.probeCount, completedAt: new Date().toISOString() }
  if (result.status === "ACCEPTED") {
    state.status = "RECOVERY_SUCCESS"; state.settle = null; state.localHttpFailure = null
  } else {
    state.status = state.recoveryAttemptOrdinal >= MAX_RECOVERY_ATTEMPTS ?
      "RECOVERY_POLICY_EXHAUSTED" : "STARTUP_SETTLE_EXHAUSTED"
    // Retain the exhausted original deadline: another timer tick cannot grant more grace.
  }
  return state
}

/** Effect boundary shared by the installed watchdog and regression tests. */
export async function executeRecoveryDecision(decision, io) {
  const s = decision.state
  if (decision.action === "RESTART_MCP") {
    beginSettle(s, { kind: "RECOVERY", startedAtMs: s.lastRecoveryAtMs,
      lifecycleId: s.lifecycleId, previousMcpPid: io.previousMcpPid, previousTunnelPid: io.previousTunnelPid })
    await io.save(s) // A crash or failed systemctl still consumes this attempt.
    try { await io.restartMcp() }
    catch { s.restartFailure = "MCP_RESTART_COMMAND_FAILED"; await io.save(s) }
    await io.scheduleObservation()
  } else {
    await io.save(s)
    // Even exhausted recovery keeps the existing health attestation job alive.
    // An expired settle transaction cannot acquire another window or restart.
    await io.scheduleObservation()
  }
  return s
}
