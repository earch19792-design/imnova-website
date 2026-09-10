// Event-driven exclusive-port gate. Waiting followers perform no extension I/O.
export function createLunaShippingPortLeadershipGateV1(signal: AbortSignal) {
  let leader = false
  const waiters = new Set<(allowed: boolean) => void>()
  const settle = (allowed: boolean) => {
    for (const resolve of waiters) resolve(allowed)
    waiters.clear()
  }
  signal.addEventListener("abort", () => settle(false), { once: true })
  return {
    setLeader(value: boolean) { leader = value; if (leader) settle(true) },
    wait(): Promise<boolean> {
      if (signal.aborted) return Promise.resolve(false)
      if (leader) return Promise.resolve(true)
      return new Promise(resolve => waiters.add(resolve))
    },
  }
}

export type LunaReadOnlyCaptureProbeV1 = Record<string, unknown>

// Receipts are independent of discovery. Neither receiving nor flushing a probe
// can claim work. Existing heartbeat/scheduler events may flush a pending receipt.
export function createLunaCaptureProbeRecorderV1(input: {
  canPersist: () => boolean
  persist: (probe: LunaReadOnlyCaptureProbeV1) => Promise<boolean>
  now?: () => number
  retryDelayMs: () => number
}) {
  const now = input.now ?? Date.now
  let pending: LunaReadOnlyCaptureProbeV1 | null = null
  let recordedAt = 0
  let inFlight = false
  let nextAttemptAt = 0
  return {
    receive(probe: LunaReadOnlyCaptureProbeV1) {
      const at = Date.parse(String(probe.observedAt ?? ""))
      if (probe.contract !== "LUNA_CAPTURE_READ_ONLY_PROBE_V1" ||
          !Number.isFinite(at) || at < now() - 300_000 || at > now() + 60_000 ||
          at <= recordedAt || at <= Date.parse(String(pending?.observedAt ?? ""))) return false
      pending = probe
      return true
    },
    async flush() {
      if (!pending || inFlight || !input.canPersist() || now() < nextAttemptAt) return false
      const probe = pending
      inFlight = true
      try {
        if (!await input.persist(probe)) throw new Error("PROBE_RECEIPT_NOT_ACCEPTED")
        recordedAt = Date.parse(String(probe.observedAt))
        if (pending === probe) pending = null
        return true
      } catch {
        nextAttemptAt = now() + Math.max(900_000, input.retryDelayMs())
        return false
      } finally { inFlight = false }
    },
  }
}
