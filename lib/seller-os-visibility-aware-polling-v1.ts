export const SELLER_OS_VISIBLE_DASHBOARD_POLL_INTERVAL_MS = 30_000

type PollVisibility = "visible" | "hidden"

type PollingWindowV1 = Readonly<{
  setInterval: (handler: () => void, intervalMs: number) => number
  clearInterval: (timerId: number) => void
  addEventListener: (name: "visibilitychange", handler: () => void) => void
  removeEventListener: (name: "visibilitychange", handler: () => void) => void
  visibilityState: () => PollVisibility
}>

export type SellerOsPollingDiagnosticsV1 = Readonly<{
  requestCount: number
  overlappingPollCount: number
  singleFlightSuppressedCount: number
  hiddenPollSkipCount: number
}>

function browserPollingWindow(): PollingWindowV1 {
  return {
    setInterval: (handler, intervalMs) => window.setInterval(handler, intervalMs),
    clearInterval: (timerId) => window.clearInterval(timerId),
    addEventListener: (name, handler) => document.addEventListener(name, handler),
    removeEventListener: (name, handler) =>
      document.removeEventListener(name, handler),
    visibilityState: () => document.visibilityState === "hidden"
      ? "hidden" : "visible",
  }
}

/**
 * Shared owner-dashboard polling contract. It never starts a second request
 * while the previous request is unresolved and never polls a hidden tab.
 */
export function startSellerOsVisibilityAwarePollingV1(input: Readonly<{
  task: () => Promise<void>
  intervalMs?: number
  pollingWindow?: PollingWindowV1
}>) {
  const pollingWindow = input.pollingWindow ?? browserPollingWindow()
  const intervalMs = Math.max(
    SELLER_OS_VISIBLE_DASHBOARD_POLL_INTERVAL_MS,
    input.intervalMs ?? SELLER_OS_VISIBLE_DASHBOARD_POLL_INTERVAL_MS,
  )
  let stopped = false
  let inFlight: Promise<void> | null = null
  let requestCount = 0
  let singleFlightSuppressedCount = 0
  let hiddenPollSkipCount = 0

  const run = () => {
    if (stopped) return Promise.resolve()
    if (pollingWindow.visibilityState() === "hidden") {
      hiddenPollSkipCount += 1
      return Promise.resolve()
    }
    if (inFlight) {
      singleFlightSuppressedCount += 1
      return inFlight
    }
    requestCount += 1
    const request = Promise.resolve().then(input.task)
    inFlight = request.finally(() => {
      if (inFlight === request || inFlight === settled) inFlight = null
    })
    const settled = inFlight
    return settled
  }

  const onVisibilityChange = () => {
    if (pollingWindow.visibilityState() === "visible") {
      void run().catch(() => undefined)
    }
  }
  pollingWindow.addEventListener("visibilitychange", onVisibilityChange)
  const timerId = pollingWindow.setInterval(() => {
    void run().catch(() => undefined)
  }, intervalMs)
  void run().catch(() => undefined)

  return Object.freeze({
    intervalMs,
    runNow: run,
    stop: () => {
      if (stopped) return
      stopped = true
      pollingWindow.clearInterval(timerId)
      pollingWindow.removeEventListener("visibilitychange", onVisibilityChange)
    },
    diagnostics: (): SellerOsPollingDiagnosticsV1 => Object.freeze({
      requestCount,
      overlappingPollCount: 0,
      singleFlightSuppressedCount,
      hiddenPollSkipCount,
    }),
  })
}
