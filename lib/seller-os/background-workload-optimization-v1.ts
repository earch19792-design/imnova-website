export const SELLER_OS_BACKGROUND_WORKLOAD_OPTIMIZATION_V1 =
  "SELLER_OS_BACKGROUND_WORKLOAD_OPTIMIZATION_V1_PHASE_A" as const

export const SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS = 60_000
export const SELLER_OS_BACKGROUND_CAPABILITY_TTL_MS = 300_000
export const SELLER_OS_BACKGROUND_LEADER_LEASE_SECONDS = 150
export const SELLER_OS_BACKGROUND_MAX_CATCHUP_MS = 15 * 60_000
export const SELLER_OS_BACKGROUND_EMPTY_BACKOFF_MS = Object.freeze([
  60_000, 120_000, 240_000, 480_000, 900_000,
] as const)
export const SELLER_OS_BACKGROUND_CIRCUIT_BACKOFF_MS = Object.freeze([
  60_000, 120_000, 300_000, 900_000,
] as const)
export const SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_MS = 5_000
export const SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_COUNT = 2

export type SellerOsBackgroundProducerV1 =
  "PRODUCT_RESEARCH" | "LUNA_SHIPPING"
export type SellerOsBackgroundLeaderStateV1 =
  "FOLLOWER" | "BROWSER_LEADER" | "SERVER_LEASE_ONLY" | "STOPPED"
export type SellerOsBackgroundCircuitStateV1 =
  "CLOSED" | "OPEN" | "HALF_OPEN"

export type SellerOsBackgroundProducerMetricsV1 = Readonly<{
  contractVersion: typeof SELLER_OS_BACKGROUND_WORKLOAD_OPTIMIZATION_V1
  producer: SellerOsBackgroundProducerV1
  polls: number
  emptyPolls: number
  claimedJobs: number
  suppressedDuplicatePolls: number
  currentBackoffMs: number
  leaderState: SellerOsBackgroundLeaderStateV1
  circuitBreakerState: SellerOsBackgroundCircuitStateV1
  observedAt: string
}>

type PersistedWorkloadStateV1 = {
  emptyPollOrdinal: number
  circuitFailureOrdinal: number
  circuitState: SellerOsBackgroundCircuitStateV1
  circuitOpenUntilMs: number
  consecutiveSlowResponses: number
  metrics: {
    polls: number
    emptyPolls: number
    claimedJobs: number
    suppressedDuplicatePolls: number
    currentBackoffMs: number
    leaderState: SellerOsBackgroundLeaderStateV1
    circuitBreakerState: SellerOsBackgroundCircuitStateV1
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

function boundedInteger(value: unknown, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), maximum) : 0
}

function jitteredDelay(baseMs: number, random: () => number) {
  const sample = Math.max(0, Math.min(1, Number(random()) || 0))
  const multiplier = 0.9 + sample * 0.2
  return Math.min(SELLER_OS_BACKGROUND_MAX_CATCHUP_MS,
    Math.max(1_000, Math.round(baseMs * multiplier)))
}

export function sellerOsEmptyPollBackoffMsV1(
  consecutiveEmptyPolls: number,
  random: () => number = Math.random,
) {
  const ordinal = Math.max(1, Math.floor(consecutiveEmptyPolls))
  const base = SELLER_OS_BACKGROUND_EMPTY_BACKOFF_MS[Math.min(
    ordinal - 1, SELLER_OS_BACKGROUND_EMPTY_BACKOFF_MS.length - 1)]
  return jitteredDelay(base, random)
}

export function sellerOsCircuitBackoffMsV1(
  consecutiveFailures: number,
  random: () => number = Math.random,
) {
  const ordinal = Math.max(1, Math.floor(consecutiveFailures))
  const base = SELLER_OS_BACKGROUND_CIRCUIT_BACKOFF_MS[Math.min(
    ordinal - 1, SELLER_OS_BACKGROUND_CIRCUIT_BACKOFF_MS.length - 1)]
  return jitteredDelay(base, random)
}

export function sellerOsDatabaseDegradedFailureV1(input: Readonly<{
  httpStatus?: number | null
  errorCode?: string | null
}>) {
  const code = String(input.errorCode ?? "").toUpperCase()
  return input.httpStatus === 522 || input.httpStatus === 524 ||
    /STATEMENT[_ ]?TIMEOUT|QUERY_CANCELED|57014|POSTGREST.*TIMEOUT|HTTP[_ ]?(522|524)|SUPABASE.*FAILED|DATABASE.*FAILED|(?:READ|CLAIM)_FAILED|HEARTBEAT_PERSIST_FAILED|WORKLOAD_LEASE_VERIFY_FAILED|AUTHORITY_UNAVAILABLE|FAILED TO FETCH|NETWORK_ERROR/
      .test(code)
}

function initialState(): PersistedWorkloadStateV1 {
  return {
    emptyPollOrdinal: 0,
    circuitFailureOrdinal: 0,
    circuitState: "CLOSED",
    circuitOpenUntilMs: 0,
    consecutiveSlowResponses: 0,
    metrics: {
      polls: 0,
      emptyPolls: 0,
      claimedJobs: 0,
      suppressedDuplicatePolls: 0,
      currentBackoffMs: 0,
      leaderState: "FOLLOWER",
      circuitBreakerState: "CLOSED",
    },
  }
}

function safeStoredState(value: unknown): PersistedWorkloadStateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return initialState()
  }
  const candidate = value as Partial<PersistedWorkloadStateV1>
  const metrics = candidate.metrics && typeof candidate.metrics === "object"
    ? candidate.metrics : initialState().metrics
  const circuitState = new Set(["CLOSED", "OPEN", "HALF_OPEN"])
    .has(String(candidate.circuitState))
    ? candidate.circuitState as SellerOsBackgroundCircuitStateV1 : "CLOSED"
  const leaderState = new Set([
    "FOLLOWER", "BROWSER_LEADER", "SERVER_LEASE_ONLY", "STOPPED",
  ]).has(String(metrics.leaderState))
    ? metrics.leaderState as SellerOsBackgroundLeaderStateV1 : "FOLLOWER"
  return {
    emptyPollOrdinal: boundedInteger(candidate.emptyPollOrdinal, 100),
    circuitFailureOrdinal: boundedInteger(candidate.circuitFailureOrdinal, 100),
    circuitState,
    circuitOpenUntilMs: boundedInteger(candidate.circuitOpenUntilMs,
      Number.MAX_SAFE_INTEGER),
    consecutiveSlowResponses: boundedInteger(
      candidate.consecutiveSlowResponses, 10),
    metrics: {
      polls: boundedInteger(metrics.polls),
      emptyPolls: boundedInteger(metrics.emptyPolls),
      claimedJobs: boundedInteger(metrics.claimedJobs),
      suppressedDuplicatePolls: boundedInteger(
        metrics.suppressedDuplicatePolls),
      currentBackoffMs: boundedInteger(metrics.currentBackoffMs,
        SELLER_OS_BACKGROUND_MAX_CATCHUP_MS),
      leaderState,
      circuitBreakerState: circuitState,
    },
  }
}

export function createSellerOsBackgroundWorkloadControllerV1(input: Readonly<{
  producer: SellerOsBackgroundProducerV1
  storage?: StorageLike | null
  random?: () => number
  now?: () => number
  publish?: (metrics: SellerOsBackgroundProducerMetricsV1) => void
}>) {
  const storageKey = `seller-os-background-workload-v1:${input.producer}`
  const random = input.random ?? Math.random
  const now = input.now ?? Date.now
  let halfOpenProbeInFlight = false
  let state = (() => {
    try {
      const raw = input.storage?.getItem(storageKey)
      return safeStoredState(raw ? JSON.parse(raw) : null)
    } catch { return initialState() }
  })()

  const snapshot = (): SellerOsBackgroundProducerMetricsV1 => Object.freeze({
    contractVersion: SELLER_OS_BACKGROUND_WORKLOAD_OPTIMIZATION_V1,
    producer: input.producer,
    ...state.metrics,
    circuitBreakerState: state.circuitState,
    observedAt: new Date(now()).toISOString(),
  })
  const persist = () => {
    state.metrics.circuitBreakerState = state.circuitState
    try { input.storage?.setItem(storageKey, JSON.stringify(state)) } catch {
      // Local metrics must never become a claim or job-processing authority.
    }
    input.publish?.(snapshot())
  }
  const setBackoff = (delayMs: number) => {
    state.metrics.currentBackoffMs = Math.min(
      SELLER_OS_BACKGROUND_MAX_CATCHUP_MS, Math.max(0, delayMs))
    persist()
    return state.metrics.currentBackoffMs
  }
  const closeCircuit = () => {
    state.circuitState = "CLOSED"
    state.circuitFailureOrdinal = 0
    state.circuitOpenUntilMs = 0
    state.consecutiveSlowResponses = 0
    halfOpenProbeInFlight = false
  }
  const openCircuit = (atMs: number) => {
    state.circuitFailureOrdinal += 1
    state.circuitState = "OPEN"
    halfOpenProbeInFlight = false
    const delay = sellerOsCircuitBackoffMsV1(
      state.circuitFailureOrdinal, random)
    state.circuitOpenUntilMs = atMs + delay
    return setBackoff(delay)
  }
  const observeLatency = (latencyMs: number, atMs: number) => {
    if (latencyMs >= SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_MS) {
      state.consecutiveSlowResponses += 1
      if (state.consecutiveSlowResponses >=
          SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_COUNT) {
        openCircuit(atMs)
        return false
      }
    } else {
      state.consecutiveSlowResponses = 0
      if (state.circuitState === "HALF_OPEN") closeCircuit()
    }
    return true
  }

  return Object.freeze({
    metrics: snapshot,
    setLeaderState(leaderState: SellerOsBackgroundLeaderStateV1) {
      state.metrics.leaderState = leaderState
      persist()
    },
    suppressDuplicatePoll() {
      state.metrics.suppressedDuplicatePolls += 1
      persist()
    },
    acquirePollPermit(atMs = now()) {
      if (state.circuitState === "OPEN") {
        if (atMs < state.circuitOpenUntilMs) {
          setBackoff(state.circuitOpenUntilMs - atMs)
          return Object.freeze({ allowed: false as const,
            reason: "CIRCUIT_OPEN" as const,
            retryInMs: state.metrics.currentBackoffMs })
        }
        state.circuitState = "HALF_OPEN"
        halfOpenProbeInFlight = false
      }
      if (state.circuitState === "HALF_OPEN") {
        if (halfOpenProbeInFlight) {
          state.metrics.suppressedDuplicatePolls += 1
          persist()
          return Object.freeze({ allowed: false as const,
            reason: "HALF_OPEN_PROBE_IN_FLIGHT" as const,
            retryInMs: state.metrics.currentBackoffMs })
        }
        halfOpenProbeInFlight = true
      }
      state.metrics.polls += 1
      persist()
      return Object.freeze({ allowed: true as const,
        halfOpenProbe: state.circuitState === "HALF_OPEN" })
    },
    recordEmptyPoll(latencyMs = 0, atMs = now()) {
      halfOpenProbeInFlight = false
      if (!observeLatency(latencyMs, atMs)) return state.metrics.currentBackoffMs
      if (state.circuitState === "HALF_OPEN") closeCircuit()
      state.emptyPollOrdinal += 1
      state.metrics.emptyPolls += 1
      return setBackoff(sellerOsEmptyPollBackoffMsV1(
        state.emptyPollOrdinal, random))
    },
    recordClaimedJobs(claimedJobs: number, latencyMs = 0, atMs = now()) {
      halfOpenProbeInFlight = false
      if (!observeLatency(latencyMs, atMs)) return state.metrics.currentBackoffMs
      closeCircuit()
      state.emptyPollOrdinal = 0
      state.metrics.claimedJobs += boundedInteger(claimedJobs, 1_000)
      return setBackoff(0)
    },
    recordProbeSuccess(latencyMs = 0, atMs = now()) {
      halfOpenProbeInFlight = false
      if (!observeLatency(latencyMs, atMs)) return state.metrics.currentBackoffMs
      if (state.circuitState === "HALF_OPEN") {
        closeCircuit()
        return setBackoff(state.emptyPollOrdinal > 0
          ? sellerOsEmptyPollBackoffMsV1(state.emptyPollOrdinal, random) : 0)
      }
      persist()
      return state.metrics.currentBackoffMs
    },
    recordFailure(failure: Readonly<{
      httpStatus?: number | null
      errorCode?: string | null
      latencyMs?: number
    }>, atMs = now()) {
      halfOpenProbeInFlight = false
      if (state.circuitState === "HALF_OPEN" ||
          sellerOsDatabaseDegradedFailureV1(failure)) {
        return openCircuit(atMs)
      }
      state.consecutiveSlowResponses = failure.latencyMs &&
        failure.latencyMs >= SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_MS
        ? state.consecutiveSlowResponses + 1 : 0
      if (state.consecutiveSlowResponses >=
          SELLER_OS_BACKGROUND_SUSTAINED_LATENCY_COUNT) {
        return openCircuit(atMs)
      }
      return setBackoff(sellerOsEmptyPollBackoffMsV1(
        Math.max(1, state.emptyPollOrdinal), random))
    },
    confirmDurableWorkSignal() {
      closeCircuit()
      state.emptyPollOrdinal = 0
      setBackoff(0)
    },
    nextDelayMs() {
      if (state.circuitState === "OPEN") {
        return Math.min(SELLER_OS_BACKGROUND_MAX_CATCHUP_MS,
          Math.max(1_000, state.circuitOpenUntilMs - now()))
      }
      return state.metrics.currentBackoffMs ||
        sellerOsEmptyPollBackoffMsV1(
          Math.max(1, state.emptyPollOrdinal), random)
    },
  })
}

type BrowserLockManagerV1 = Pick<LockManager, "request">

export async function holdSellerOsCrossTabBrowserLeaderV1(input: Readonly<{
  scope: SellerOsBackgroundProducerV1
  signal: AbortSignal
  locks?: BrowserLockManagerV1 | null
  onLeaderState?: (state: SellerOsBackgroundLeaderStateV1) => void
  run: () => Promise<void>
}>) {
  const locks = input.locks ?? globalThis.navigator?.locks
  if (!locks) {
    input.onLeaderState?.("SERVER_LEASE_ONLY")
    await input.run()
    return
  }
  input.onLeaderState?.("FOLLOWER")
  await locks.request(
    `seller-os-background-workload-v1:${input.scope}`,
    { mode: "exclusive", signal: input.signal },
    async () => {
      if (input.signal.aborted) return
      input.onLeaderState?.("BROWSER_LEADER")
      await input.run()
    },
  )
  input.onLeaderState?.("STOPPED")
}

export async function trySellerOsCrossTabBrowserLeaderV1<T>(input: Readonly<{
  scope: SellerOsBackgroundProducerV1
  locks?: BrowserLockManagerV1 | null
  run: () => Promise<T>
}>) {
  const locks = input.locks ?? globalThis.navigator?.locks
  if (!locks) return Object.freeze({ acquired: true as const,
    serverLeaseRequired: true as const, value: await input.run() })
  return locks.request(
    `seller-os-background-workload-v1:${input.scope}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => lock
      ? Object.freeze({ acquired: true as const,
        serverLeaseRequired: true as const, value: await input.run() })
      : Object.freeze({ acquired: false as const,
        serverLeaseRequired: true as const, value: null }),
  )
}

export function sellerOsBackgroundMetricsPublisherV1(
  metrics: SellerOsBackgroundProducerMetricsV1,
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(
    "seller-os-background-workload-metrics-v1", { detail: metrics }))
}
