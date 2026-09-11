import type { SupabaseClient } from "@supabase/supabase-js"
import { PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding,
  productionStockAuthorityConfigurationValidV1,
  verifyProductionStockServiceIdentityV1 } from "./ebay-production-stock-authority-binding-v1"
import { getEbayCommercialMonitorLiveConfigurationState } from "./ebay-commercial-monitor-live-readonly"
import { runCurrentLiveAuthorityRecoveryV1 } from "./ebay-current-live-authority-recovery-v1"
import { reconcileRelistSupplierHandoffV1, orderRelistHandoffCandidatesV1 } from "./ebay-relist-supplier-handoff-v1"
import { reconcileSellerOsStockIdentityV1 } from "./ebay-stock-identity-auto-reconciliation-v1"
import { readProductionStockGuardV1 } from "./ebay-production-stock-read-service-v1"

export const PRODUCTION_STOCK_POPULATION_PATH = "/api/cron/ebay-active-listing-luna-monitor"
const safety = { marketplaceWrites: 0, publicationWrites: 0, offerWrites: 0,
  adsWrites: 0, stockGuardEvaluations: 0, newWorkers: 0, newPollers: 0 }

// Separate producer admission on the EXISTING intake route. The certified
// stockguard-read boundary and its GET-only database transport do not change.
export async function authorizeProductionPopulationV1(request: Request,
  verify = verifyProductionStockServiceIdentityV1) {
  const url = new URL(request.url)
  if (request.method !== "POST" || url.origin !== `https://${binding.hostname}` || url.username || url.password || url.pathname !== PRODUCTION_STOCK_POPULATION_PATH ||
      url.search || request.headers.has("authorization") ||
      request.headers.get("x-seller-os-caller") !== "SELLER_OS_STOCKGUARD_MONITOR_V1" ||
      (await request.text()) !== "") return false
  return verify(request.headers.get("x-seller-os-service-assertion") ?? "")
}

export async function runProductionCurrentLivePopulationV1(input: {
  supabase: SupabaseClient; environment?: NodeJS.ProcessEnv;
  configuration?: typeof getEbayCommercialMonitorLiveConfigurationState;
  recover?: typeof runCurrentLiveAuthorityRecoveryV1;
}) {
  const environment = input.environment ?? process.env
  if (!productionStockAuthorityConfigurationValidV1(environment)) throw Error(
    "PRODUCTION_STOCK_CANONICAL_BINDING_CONFIGURATION_MISMATCH")
  const source = (input.configuration ?? getEbayCommercialMonitorLiveConfigurationState)(environment)
  // No lease/row/official call when the producer has no usable source binding.
  // A configured read-service identity alone is not an eBay producer grant.
  if (!source.configured || !source.identityConsistent || source.accountAlias !== binding.accountAlias) return { status: "BLOCKED_SOURCE_DEPENDENCY",
    missingDependency: `OFFICIAL_EBAY_CURRENT_LIVE_READ:${source.missingConfiguration[0] ?? "EXACT_ACCOUNT_IDENTITY"}`,
    missingSourceConfiguration: source.missingConfiguration,
    currentLiveAuthorityPopulated: false, bootstrapMode: "BOUNDED_CURRENT_ONLY", safety }
  const recovered = await (input.recover ?? runCurrentLiveAuthorityRecoveryV1)({
    supabase: input.supabase, accountKey: binding.accountKey, accountAlias: binding.accountAlias })
  if (recovered.authority.currentState !== "CURRENT_FRESH") return {
    status: recovered.status, missingDependency: "OFFICIAL_EBAY_CURRENT_LIVE_READ:CERTIFIED_CURRENT_SCOPE",
    currentLiveAuthorityPopulated: false, bootstrapMode: "BOUNDED_CURRENT_ONLY", safety }
  // Dependency metadata is fixed server-side; callers cannot choose objects.
  const dependencies = await input.supabase.rpc("get_production_stock_producer_readiness_v1")
  if (dependencies.error) return { status: "BLOCKED_PRODUCER_DEPENDENCY", currentLiveAuthorityPopulated: true,
    missingDependency: "public.get_production_stock_producer_readiness_v1", safety }
  const missing = (dependencies.data as { missing: string[] } | null)?.missing
  if (!Array.isArray(missing)) throw Error("PRODUCTION_PRODUCER_DEPENDENCY_READBACK_INVALID")
  if (missing.length) return { status: "BLOCKED_PRODUCER_DEPENDENCY", currentLiveAuthorityPopulated: true,
    missingDependency: missing[0], safety }
  const ids = recovered.authority.currentItemIds
  if (!ids.length) return { status: "CURRENT_LIVE_CERTIFIED_EMPTY", currentLiveAuthorityPopulated: true,
    missingDependency: "CURRENT_LIVE_TARGET_LISTINGS_ABSENT", safety }
  // Reuse existing intake rotation and the existing stock producer's 20-target
  // bound. No new clock, scheduler, retry or marketplace mutation is introduced.
  const targets = orderRelistHandoffCandidatesV1(ids.map(itemId => ({ itemId })), Date.now())
    .slice(0, 20).map(row => row.itemId)
  for (const itemId of targets) {
    const result = await reconcileRelistSupplierHandoffV1({ supabase: input.supabase,
      accountKey: binding.accountKey, itemId })
    if (result.status !== "CERTIFIED" || ("durableReadbackMatch" in result ? result.durableReadbackMatch : false) !== true) return {
      status: "WAITING_FOR_LINKAGE_AUTHORITY", currentLiveAuthorityPopulated: true,
      missingDependency: "CERTIFIED_CURRENT_LINKAGE_READBACK", itemId, safety }
  }
  await reconcileSellerOsStockIdentityV1(input.supabase, { accountKey: binding.accountKey, targetItemIds: targets })
  // Check durable jobs/observations before invoking the StockGuard consumer.
  const [jobs, observations] = await Promise.all([
    input.supabase.from("seller_os_luna_stock_check_jobs").select("stock_check_job_id,ebay_item_id,linkage_id")
      .eq("account_key", binding.accountKey).eq("workflow_state", "SUCCEEDED").in("ebay_item_id", ids).limit(1501),
    input.supabase.from("seller_os_luna_stock_observations").select("stock_check_job_id,ebay_item_id,linkage_id,observed_at,maximum_age_seconds")
      .eq("account_key", binding.accountKey).in("ebay_item_id", ids).order("observed_at", { ascending: false }).limit(1501),
  ])
  if (jobs.error || observations.error || !ids.every(itemId => (observations.data ?? []).some(o =>
    o.ebay_item_id === itemId && Date.parse(o.observed_at) <= Date.now() &&
    Date.now() - Date.parse(o.observed_at) <= o.maximum_age_seconds * 1000 &&
    (jobs.data ?? []).some(j => j.stock_check_job_id === o.stock_check_job_id && j.linkage_id === o.linkage_id && j.ebay_item_id === itemId)))) {
    return { status: "WAITING_FOR_CURRENT_STOCK_OBSERVATIONS", currentLiveAuthorityPopulated: true,
      missingDependency: "CURRENT_EXACT_STOCK_OBSERVATION_COHORT", safety }
  }
  const readback = await readProductionStockGuardV1({ supabase: input.supabase,
    accountKey: binding.accountKey, accountAlias: binding.accountAlias, itemId: null })
  return { status: "PRODUCTION_AUTHORITY_READBACK", readback, safety: { ...safety, stockGuardEvaluations: 1 } }
}
