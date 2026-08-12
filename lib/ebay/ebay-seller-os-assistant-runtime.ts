import { assertCommercialMonitorAssistantDtoSafe } from
  "./commercial-monitor-readonly-contract"
import { getCommercialMonitorReadonly } from
  "./commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "./ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import { getSupabaseAdminClient } from "../supabase-admin"

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
