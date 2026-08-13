import { assertCommercialMonitorAssistantDtoSafe } from
  "./commercial-monitor-readonly-contract"
import { getCommercialMonitorReadonly } from
  "./commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "./ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import { getSupabaseAdminClient } from "../supabase-admin"

export const SELLER_OS_ASSISTANT_MONITOR_SNAPSHOT_TTL_MS = 30_000

function withAccountTrafficCacheTelemetryV1<T>(value: T, cacheHitCount: number): T {
  if (!value || typeof value !== "object") return value
  const monitor = value as Record<string, unknown>
  const backend = monitor.backend
  if (!backend || typeof backend !== "object") return value
  const trafficScopes = (backend as Record<string, unknown>).trafficScopes
  if (!trafficScopes || typeof trafficScopes !== "object") return value
  const accountTraffic = (trafficScopes as Record<string, unknown>).accountTraffic
  if (!accountTraffic || typeof accountTraffic !== "object") return value
  return {
    ...monitor,
    backend: {
      ...backend as Record<string, unknown>,
      trafficScopes: {
        ...trafficScopes as Record<string, unknown>,
        accountTraffic: {
          ...accountTraffic as Record<string, unknown>,
          cacheHitCount,
        },
      },
    },
  } as T
}

export async function loadSellerOsAssistantMonitorV1() {
  const account = getEbaySellerAccountScopeConfiguration()
  const live = await getEbayCommercialMonitorLiveReadonly({ accountKey: account.accountKey,
    accountAlias: account.accountAlias })
  const monitor = await getCommercialMonitorReadonly(
    account.accountKey ? getSupabaseAdminClient() : null,
    { accountKey: account.accountKey, accountAlias: account.accountAlias,
      configurationReason: account.reason }, live)
  return assertCommercialMonitorAssistantDtoSafe(monitor)
}

export function createSellerOsAssistantMonitorSnapshotLoaderV1(input: {
  loader?: typeof loadSellerOsAssistantMonitorV1
  now?: () => number
  maximumAgeMs?: number
} = {}) {
  const loader = input.loader ?? loadSellerOsAssistantMonitorV1
  const now = input.now ?? Date.now
  const maximumAgeMs = Math.min(60_000, Math.max(1_000,
    input.maximumAgeMs ?? SELLER_OS_ASSISTANT_MONITOR_SNAPSHOT_TTL_MS))
  let snapshot: {
    expiresAt: number
    promise: ReturnType<typeof loadSellerOsAssistantMonitorV1>
  } | null = null
  let cacheHitCount = 0
  return async () => {
    const timestamp = now()
    if (snapshot && snapshot.expiresAt > timestamp) {
      cacheHitCount += 1
      return withAccountTrafficCacheTelemetryV1(
        await snapshot.promise,
        cacheHitCount,
      )
    }
    const promise = loader()
    cacheHitCount = 0
    snapshot = { expiresAt: timestamp + maximumAgeMs, promise }
    try {
      return withAccountTrafficCacheTelemetryV1(await promise, 0)
    } catch (error) {
      if (snapshot?.promise === promise) snapshot = null
      throw error
    }
  }
}

const loadBoundedSellerOsAssistantMonitorSnapshotV1 =
  createSellerOsAssistantMonitorSnapshotLoaderV1()

export async function loadSellerOsAssistantMonitorSnapshotV1() {
  return loadBoundedSellerOsAssistantMonitorSnapshotV1()
}
