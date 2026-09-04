export const SELLER_OS_DASHBOARD_SNAPSHOT_FRESHNESS_MS = 25_000

type CacheEntry = {
  value?: unknown
  expiresAt: number
  inFlight?: Promise<unknown>
}

const snapshotCache = new Map<string, CacheEntry>()

export async function readSellerOsDashboardSnapshotV1<T>(input: Readonly<{
  key: string
  load: () => Promise<T>
  freshnessMs?: number
  now?: () => number
}>) {
  const now = input.now ?? Date.now
  const freshnessMs = Math.max(1_000, input.freshnessMs ??
    SELLER_OS_DASHBOARD_SNAPSHOT_FRESHNESS_MS)
  const existing = snapshotCache.get(input.key)
  if (existing?.value !== undefined && existing.expiresAt > now()) {
    return Object.freeze({ value: existing.value as T,
      source: "FRESH_SNAPSHOT" as const })
  }
  if (existing?.inFlight) {
    return Object.freeze({ value: await existing.inFlight as T,
      source: "SINGLE_FLIGHT_JOIN" as const })
  }

  const inFlight = input.load()
  snapshotCache.set(input.key, { expiresAt: 0, inFlight })
  try {
    const value = await inFlight
    snapshotCache.set(input.key, { value, expiresAt: now() + freshnessMs })
    return Object.freeze({ value, source: "DATABASE_READ" as const })
  } catch (error) {
    if (snapshotCache.get(input.key)?.inFlight === inFlight) {
      snapshotCache.delete(input.key)
    }
    throw error
  }
}

export function resetSellerOsDashboardSnapshotCacheV1() {
  snapshotCache.clear()
}
