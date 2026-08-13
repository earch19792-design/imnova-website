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
  return async () => {
    const timestamp = now()
    if (snapshot && snapshot.expiresAt > timestamp) return snapshot.promise
    const promise = loader()
    snapshot = { expiresAt: timestamp + maximumAgeMs, promise }
    try {
      return await promise
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
