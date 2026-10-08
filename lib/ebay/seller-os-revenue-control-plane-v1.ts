import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's direct TypeScript runner needs the extension.
import { readRegistry, readCommercialSnapshots } from "./commercial-monitor-readonly-repository.ts"
// @ts-expect-error Node's direct TypeScript runner needs the extension.
import { readProductionStockGuardV1 } from "./ebay-production-stock-read-service-v1.ts"
// @ts-expect-error Node's direct TypeScript runner needs the extension.
import { readCurrentLiveAuthorityV1 } from "./ebay-current-live-authority-v1.ts"
import { getEbayCommercialMonitorLiveReadonly } from
  "./ebay-commercial-monitor-live-readonly"
import { evaluateSellerOsRoiMarginPolicyV2,
  sellerOsRoiMarginPolicyContractV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

export const SELLER_OS_REVENUE_CONTROL_PLANE_V1 =
  "SELLER_OS_REVENUE_CONTROL_PLANE_V1" as const

type R = Record<string, unknown>
type Source = { status: "AVAILABLE" | "UNAVAILABLE" | "PARTIAL";
  rows: R[]; blocker: string | null }
type Temporal = { status: "AVAILABLE" | "STALE" | "MISSING" |
  "UNAVAILABLE" | "UNPROVEN"; observedAt: string | null;
  freshUntil: string | null; sourceAuthority: string | null }

const asRecord = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}
const str = (value: unknown): string | null => typeof value === "string" &&
  value.trim() ? value.trim() : null
const amount = (value: unknown): number | null => value === null ||
  value === undefined || value === "" ? null :
  Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
const instant = (value: unknown): string | null => {
  const text = str(value)
  return text && Number.isFinite(Date.parse(text))
    ? new Date(text).toISOString() : null
}
const newest = (rows: R[], field: string) => [...rows].sort((a, b) =>
  Date.parse(String(b[field] ?? "")) - Date.parse(String(a[field] ?? "")))[0]
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function readRevenueControlPolicyV1(
  environment: NodeJS.ProcessEnv = process.env) {
  const configured = (key: string, fallback: number) => {
    const raw = environment[key]
    if (raw === undefined || raw === "") return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
      throw Error("REVENUE_CONTROL_POLICY_CONFIGURATION_INVALID")
    return parsed
  }
  const policy = {
    targetNetProfitMin: 0,
    targetNetProfitMax: 0,
    absoluteMinimumNetProfit: 0,
    economicPolicy: sellerOsRoiMarginPolicyContractV2(),
    promotedListingsRate: configured("SELLER_OS_REVENUE_PROMOTED_RATE", 0),
    returnsReserveRate: configured("SELLER_OS_REVENUE_RETURNS_RESERVE_RATE", 0.04),
  }
  if (policy.promotedListingsRate > 1 || policy.returnsReserveRate > 1) {
    throw Error("REVENUE_CONTROL_POLICY_CONFIGURATION_INVALID")
  }
  return policy
}

function temporal(row: R | undefined, observedField: string,
  freshUntilField: string, sourceField: string, now: number): Temporal {
  if (!row) return { status: "MISSING", observedAt: null,
    freshUntil: null, sourceAuthority: null }
  const observedAt = instant(row[observedField])
  const freshUntil = instant(row[freshUntilField])
  return { status: !observedAt ? "UNPROVEN" :
    freshUntil && Date.parse(freshUntil) > now &&
    (row.freshness_status === undefined || row.freshness_status === "FRESH")
      ? "AVAILABLE" : "STALE",
    observedAt, freshUntil, sourceAuthority: str(row[sourceField]) }
}

async function bulk(supabase: SupabaseClient, table: string,
  select: string, accountField: string, accountKey: string,
  idsField: string, ids: string[], order: string, maximum = 2000): Promise<Source> {
  if (!ids.length) return { status: "AVAILABLE", rows: [], blocker: null }
  const result = await supabase.from(table).select(select)
    .eq(accountField, accountKey).in(idsField, ids)
    .order(order, { ascending: false }).limit(maximum + 1)
  if (result.error) return { status: "UNAVAILABLE", rows: [],
    blocker: `${table.toUpperCase()}_READ_FAILED` }
  const rows = (result.data ?? []) as unknown as R[]
  return { status: rows.length > maximum ? "PARTIAL" : "AVAILABLE",
    rows: rows.slice(0, maximum), blocker: rows.length > maximum
      ? `${table.toUpperCase()}_RESULT_LIMIT_REACHED` : null }
}

export type RevenueDuplicateCandidateV1 = Readonly<{
  supplierSku: string | null; lunaProductId: string | null;
  lunaVariantId: string | null; title?: string | null;
  productFingerprint?: string | null
}>

/** An exact tuple wins over labels. Semantic similarity only requests review. */
export function classifyRevenueLiveDuplicateV1(candidate: RevenueDuplicateCandidateV1,
  listings: readonly { supplierSku: string | null;
    lunaProductId: string | null; lunaVariantId: string | null;
    title: string | null; liveStatus: string;
    productFingerprint?: string | null }[]) {
  const live = listings.filter((row) => row.liveStatus === "LIVE_ACTIVE")
  if (candidate.lunaProductId && candidate.lunaVariantId &&
      candidate.supplierSku && live.some((row) =>
        row.lunaProductId === candidate.lunaProductId &&
        row.lunaVariantId === candidate.lunaVariantId &&
        row.supplierSku === candidate.supplierSku)) return "EXACT_LIVE_DUPLICATE" as const
  if (candidate.lunaProductId && candidate.lunaVariantId && live.some((row) =>
    row.lunaProductId === candidate.lunaProductId &&
    row.lunaVariantId === candidate.lunaVariantId)) return "VARIANT_DUPLICATE" as const
  if (candidate.supplierSku && live.some((row) =>
    row.supplierSku === candidate.supplierSku)) return "REVIEW_REQUIRED" as const
  if (candidate.productFingerprint && live.some((row) =>
    row.productFingerprint === candidate.productFingerprint)) {
    return "SEMANTIC_DUPLICATE" as const
  }
  const normalizedTitle = candidate.title?.normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim() ?? ""
  if (normalizedTitle.length >= 20 && live.some((row) =>
    row.title?.normalize("NFKC").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim() === normalizedTitle)) {
    return "REVIEW_REQUIRED" as const
  }
  return "NONE" as const
}

export async function readSellerOsRevenueControlPlaneV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  now?: Date; policy?: { targetNetProfitMin: number;
    targetNetProfitMax: number; absoluteMinimumNetProfit: number;
    promotedListingsRate: number; returnsReserveRate?: number | null }
  stockReader?: typeof readProductionStockGuardV1
  liveReader?: typeof readCurrentLiveAuthorityV1
  registryReader?: typeof readRegistry
  analyticsReader?: typeof readCommercialSnapshots
  officialReader?: typeof getEbayCommercialMonitorLiveReadonly
}) {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const policy = input.policy ?? readRevenueControlPolicyV1()
  const storedLiveAuthority = await (input.liveReader ?? readCurrentLiveAuthorityV1)({
    supabase: input.supabase, accountKey: input.accountKey, now })
  const officialLive = storedLiveAuthority.currentState !== "CURRENT_FRESH" &&
    (!input.liveReader || input.officialReader)
    ? await (input.officialReader ?? getEbayCommercialMonitorLiveReadonly)({
      accountKey: input.accountKey, accountAlias: input.accountAlias,
      readLimits: { budgetMs: 40_000, maximumCalls: 100,
        certifiedPortfolioMode: true, isolateIndependentReads: true },
    }).catch(() => null) : null
  const [stockRead, liveAuthority] = await Promise.all([
    (input.stockReader ?? readProductionStockGuardV1)({ supabase: input.supabase,
      accountKey: input.accountKey, accountAlias: input.accountAlias,
      itemId: null, now, includeKnownListingStockEvidence: false,
      officialLive }).catch(() => null),
    (input.liveReader ?? readCurrentLiveAuthorityV1)({ supabase: input.supabase,
      accountKey: input.accountKey, now, live: officialLive }),
  ])
  const stock = stockRead ?? {
    cohortComplete: false, currentLiveState: "CURRENT_UNAVAILABLE",
    listings: [], sourceStatus: { registry: "ERROR", linkAuthority: "UNAVAILABLE",
      listingRegistry: "CURRENT_UNAVAILABLE", jobs: "ERROR",
      observations: "ERROR" },
  }
  const currentCertified = liveAuthority.currentState === "CURRENT_FRESH" ||
    stock.cohortComplete && stock.currentLiveState === "CURRENT_FRESH"
  // The complete official sweep can be newer than the legacy sync marker.
  // When it has expired, retain it as history without presenting it as LIVE.
  const historicalSweep = !currentCertified ? await input.supabase.from(
    "seller_os_listing_registry_sweeps_v1")
    .select("sweep_id,official_observed_at,official_live_item_count,reconciled_item_count,source_authority")
    .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
    .eq("status", "COMPLETE")
    .order("completed_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null }
  const historicalCases = historicalSweep.data?.sweep_id
    ? await input.supabase.from("seller_os_listing_cases_v1")
      .select("ebay_item_id,ebay_title,ebay_custom_label,ebay_observed_at,listing_status")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("last_reconciled_sweep_id", historicalSweep.data.sweep_id)
      .limit(1001)
    : { data: [], error: null }
  const sweepHistoryValid = Boolean(historicalSweep.data &&
    !historicalSweep.error && !historicalCases.error &&
    historicalSweep.data.official_live_item_count ===
      historicalSweep.data.reconciled_item_count &&
    historicalCases.data?.length ===
      historicalSweep.data.official_live_item_count &&
    new Set((historicalCases.data ?? []).map((row) =>
      row.ebay_item_id)).size === historicalCases.data?.length)
  const sweepHistoryNewer = sweepHistoryValid &&
    Date.parse(String(historicalSweep.data?.official_observed_at)) >
      Date.parse(liveAuthority.lastCertifiedAt ?? "")
  const currentIds = liveAuthority.currentState === "CURRENT_FRESH"
    ? liveAuthority.currentItemIds : stock.cohortComplete
      ? stock.listings.map((row) => row.itemId) : []
  const stockByItem = new Map(stock.listings.map((row) => [row.itemId, row]))
  const stockRows = currentCertified ? [...new Set(currentIds)].map((itemId) =>
    stockByItem.get(itemId) ?? {
      itemId, sku: null, title: null, supplierLinkage: "UNPROVEN",
      components: [], supplierAvailability: "UNKNOWN",
      supplierStockQuantity: null, stockFreshness: "UNKNOWN",
      stockObservedAt: null, stockFreshUntil: null,
      lastSuccessfulSource: null, linkAuthorityState: "UNAVAILABLE",
      limitationCode: "STOCKGUARD_READ_UNAVAILABLE",
    }) : []
  const ids = [...new Set(stockRows.map((row) => row.itemId))]
  const officialByItem = new Map((officialLive?.discovery.currentLiveListings ?? [])
    .map((row) => [row.itemId, row]))
  const tuples = stockRows.flatMap((row) => row.supplierLinkage === "CERTIFIED"
    ? row.components.flatMap((part) => part.supplierProductId &&
        part.supplierVariantId && part.supplierSku ? [{
          productId: String(part.supplierProductId),
          variantId: String(part.supplierVariantId), sku: String(part.supplierSku),
        }] : []) : [])
  const variantIds = [...new Set(tuples.map((tuple) => tuple.variantId))]
  const [registry, analytics, economic, shipping, fees, orders, runs, catalog,
    members, traces] = await Promise.all([
      (input.registryReader ?? readRegistry)(input.supabase, input.accountKey),
      (input.analyticsReader ?? readCommercialSnapshots)(input.supabase,
        input.accountKey, ids),
      bulk(input.supabase, "seller_os_live_economic_evidence_v1",
        "ebay_item_id,evidence_type,value_amount,value_currency,source_authority,source_entity_id,captured_at,fresh_until,freshness_status,limitation_code,evidence_metadata",
        "marketplace_account_key", input.accountKey, "ebay_item_id", ids,
        "captured_at"),
      bulk(input.supabase, "seller_os_live_listing_shipping_evidence",
        "ebay_item_id,luna_product_id,luna_variant_id,source_sku,shipping_cost,shipping_currency,observed_at,maximum_age_seconds,source_authority,evidence_id",
        "account_key", input.accountKey, "ebay_item_id", ids,
        "observed_at"),
      bulk(input.supabase, "seller_os_ebay_fee_authorities_v1",
        "ebay_item_id,sku,state,authority,observed_at,fresh_until,authority_id",
        "marketplace_account_key", input.accountKey, "ebay_item_id", ids,
        "observed_at"),
      bulk(input.supabase, "marketplace_order_line_items",
        "listing_id,marketplace_order_id,marketplace_line_item_id,quantity,last_observed_at,source",
        "marketplace_account_key", input.accountKey, "listing_id", ids,
        "last_observed_at"),
      input.supabase.from("commercial_monitor_runs")
        .select("id,started_at,completed_at,readers,status")
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US")
        .neq("trigger_source", "dry_run")
        .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      variantIds.length ? input.supabase.from("market_radar_latest_variants")
        .select("supplier_product_id,supplier_variant_id,sku,price,captured_at")
        .eq("source_key", "lunaportex")
        .in("supplier_variant_id", variantIds).limit(1001)
        : Promise.resolve({ data: [], error: null }),
      variantIds.length ? input.supabase.from(
        "seller_os_pre_research_batch_members_v1")
        .select("batch_id,luna_product_id,luna_variant_id,luna_sku,plan_id,execution_state,bounded_failure_reason,retry_safety,updated_at")
        .in("luna_variant_id", variantIds)
        .order("updated_at", { ascending: false }).limit(1001)
        : Promise.resolve({ data: [], error: null }),
      input.supabase.from("seller_os_live_commercial_traces_v1")
        .select("trace_id,state,current_stage,result,updated_at")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .order("updated_at", { ascending: false }).limit(1001),
    ])
  const batchIds = [...new Set((members.data ?? []).map((row) =>
    String(row.batch_id)))]
  const planIds = [...new Set((members.data ?? []).flatMap((row) =>
    row.plan_id ? [String(row.plan_id)] : []))]
  const [batches, plans] = await Promise.all([
    batchIds.length ? input.supabase.from("seller_os_pre_research_batches_v1")
      .select("batch_id,batch_state,marketplace_account_key")
      .eq("marketplace_account_key", input.accountKey)
      .in("batch_id", batchIds).limit(1001)
      : Promise.resolve({ data: [], error: null }),
    planIds.length ? input.supabase.from("marketplace_product_research_query_plans")
      .select("id,status,pre_research_result,pre_research_evidence,pre_research_completed_at")
      .eq("marketplace_account_key", input.accountKey)
      .in("id", planIds).limit(1001)
      : Promise.resolve({ data: [], error: null }),
  ])
  const batchIdsForAccount = new Set((batches.data ?? []).map((row) => row.batch_id))
  const planById = new Map((plans.data ?? []).map((row) => [row.id, row]))
  const catalogReadable = !catalog.error && (catalog.data?.length ?? 0) <= 1000
  const traceReadable = !traces.error && (traces.data?.length ?? 0) <= 1000
  const preResearchReadable = !members.error && !batches.error &&
    !plans.error && (members.data?.length ?? 0) <= 1000 &&
    (batches.data?.length ?? 0) <= 1000 &&
    (plans.data?.length ?? 0) <= 1000
  const run = asRecord(runs.data)
  const analyticsReader = asRecord(asRecord(run.readers).analytics)
  const analyticsCurrentAvailable = analyticsReader.status === "available" &&
    instant(run.completed_at ?? run.started_at) !== null &&
    nowMs - Date.parse(String(run.completed_at ?? run.started_at)) <= 20 * 60_000
  const registryById = new Map<string, typeof registry.rows[number]>()
  for (const row of registry.rows) {
    if (!row.ebay_item_id || registryById.has(row.ebay_item_id)) continue
    registryById.set(row.ebay_item_id, row)
  }
  const rows = stockRows.map((linked) => {
    const itemId = linked.itemId
    const official = officialByItem.get(itemId)
    const registryRow = registryById.get(itemId)
    const tuple = linked.supplierLinkage === "CERTIFIED" &&
      linked.components.length === 1 ? linked.components[0] : null
    const productId = tuple?.supplierProductId
      ? String(tuple.supplierProductId) : null
    const variantId = tuple?.supplierVariantId
      ? String(tuple.supplierVariantId) : null
    const sku = tuple?.supplierSku ? String(tuple.supplierSku) : null
    const registryObservedAt = instant(official?.observedAt ??
      registryRow?.last_ebay_sync_at)
    const registryFresh = Boolean(registryObservedAt &&
      nowMs >= Date.parse(registryObservedAt) &&
      nowMs - Date.parse(registryObservedAt) <= 20 * 60_000)
    const officialFields = { status: registryFresh ? "AVAILABLE" :
      registryObservedAt ? "STALE" : "MISSING",
      observedAt: registryObservedAt,
      freshUntil: registryObservedAt
        ? new Date(Date.parse(registryObservedAt) + 20 * 60_000).toISOString()
        : null, sourceAuthority: official
          ? "EBAY_TRADING_GET_MY_EBAY_SELLING" :
            "EBAY_TRADING_LISTING_REGISTRY" }
    const economicRows = economic.rows.filter((entry) =>
      entry.ebay_item_id === itemId)
    const costEvidence = newest(economicRows.filter((entry) =>
      entry.evidence_type === "LUNA_CURRENT_COST"), "captured_at")
    const otherEvidence = newest(economicRows.filter((entry) =>
      entry.evidence_type === "OTHER_EXPLICIT_COSTS"), "captured_at")
    const feeEvidence = newest(economicRows.filter((entry) =>
      entry.evidence_type === "EXPECTED_EBAY_FEE"), "captured_at")
    const costEvidenceAuthority = temporal(costEvidence, "captured_at",
      "fresh_until", "source_authority", nowMs)
    const otherAuthority = temporal(otherEvidence, "captured_at",
      "fresh_until", "source_authority", nowMs)
    const feeEvidenceAuthority = temporal(feeEvidence, "captured_at",
      "fresh_until", "source_authority", nowMs)
    const exactShipping = newest(shipping.rows.filter((entry) =>
      entry.ebay_item_id === itemId && productId && variantId && sku &&
      entry.luna_product_id === productId &&
      entry.luna_variant_id === variantId && entry.source_sku === sku),
    "observed_at")
    const shippingObservedAt = instant(exactShipping?.observed_at)
    const shippingFreshUntil = shippingObservedAt &&
      amount(exactShipping?.maximum_age_seconds) !== null
      ? new Date(Date.parse(shippingObservedAt) +
        Number(exactShipping?.maximum_age_seconds) * 1000).toISOString() : null
    const shippingAuthority: Temporal = exactShipping ? {
      status: shippingFreshUntil && Date.parse(shippingFreshUntil) > nowMs
        ? "AVAILABLE" : "STALE", observedAt: shippingObservedAt,
      freshUntil: shippingFreshUntil,
      sourceAuthority: str(exactShipping.source_authority),
    } : { status: shipping.status === "UNAVAILABLE" ? "UNAVAILABLE" :
      "MISSING", observedAt: null, freshUntil: null,
      sourceAuthority: null }
    const catalogRow = (catalog.data ?? []).find((entry) =>
      entry.supplier_product_id === productId &&
      entry.supplier_variant_id === variantId && entry.sku === sku)
    const catalogAt = instant(catalogRow?.captured_at)
    const catalogFreshUntil = catalogAt
      ? new Date(Date.parse(catalogAt) + 36 * 60 * 60_000).toISOString()
      : null
    const catalogCostFresh = Boolean(catalogAt &&
      nowMs >= Date.parse(catalogAt) &&
      catalogFreshUntil && Date.parse(catalogFreshUntil) > nowMs &&
      amount(catalogRow?.price) !== null)
    const costMetadata = asRecord(costEvidence?.evidence_metadata)
    const costEvidenceExact = Boolean(productId && variantId && sku &&
      costMetadata.productId === productId &&
      costMetadata.variantId === variantId &&
      costMetadata.supplierSku === sku)
    const costAuthority: Temporal = catalogReadable && catalogCostFresh ? {
      status: "AVAILABLE", observedAt: catalogAt,
      freshUntil: catalogFreshUntil,
      sourceAuthority: "MARKET_RADAR_LATEST_LUNA_VARIANT",
    } : costEvidenceExact ? costEvidenceAuthority : !catalogReadable ? {
      status: "UNAVAILABLE", observedAt: null, freshUntil: null,
      sourceAuthority: null,
    } : {
      ...costEvidenceAuthority, status: costEvidence ? "UNPROVEN" : "MISSING",
    }
    const snapshot = newest(analytics.rows.filter((entry) =>
      entry.listing_id === itemId &&
      asRecord(entry.source).analytics ===
        "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" &&
      entry.completeness_status !== "unavailable"), "observed_at")
    const snapshotAt = instant(snapshot?.observed_at)
    const officialAnalytics = officialLive?.analytics.status === "CERTIFIED"
      ? officialLive.analytics.observations.find((entry) =>
          entry.itemId === itemId && entry.completeness === "COMPLETE")
      : null
    const currentSnapshot = analyticsCurrentAvailable && snapshotAt &&
      Date.parse(snapshotAt) >= Date.parse(String(run.started_at)) &&
      snapshot?.completeness_status === "complete"
    const currentAnalytics = Boolean(officialAnalytics || currentSnapshot)
    const currentAnalyticsMetrics = officialAnalytics ? {
      impressions: amount(officialAnalytics.impressions),
      views: amount(officialAnalytics.totalListingViews),
      ctr: amount(officialAnalytics.reportedCtr ??
        officialAnalytics.calculatedCtr),
      quantitySold: amount(officialAnalytics.transactions),
      conversionRate: amount(officialAnalytics.reportedConversion),
      observedAt: instant(officialAnalytics.observedAt),
      windowStart: officialAnalytics.windowStart,
      windowEnd: officialAnalytics.windowEnd,
    } : { impressions: amount(snapshot?.impressions),
      views: amount(snapshot?.views), ctr: amount(snapshot?.ctr),
      quantitySold: amount(snapshot?.transactions),
      conversionRate: amount(snapshot?.sales_conversion_rate),
      observedAt: snapshotAt, windowStart: snapshot?.window_start ?? null,
      windowEnd: snapshot?.window_end ?? null }
    const currentAnalyticsStatus = currentAnalytics ? "AVAILABLE" :
      officialLive?.analytics.status === "UNAVAILABLE" ? "UNAVAILABLE" :
      officialLive?.analytics.status === "PARTIAL" ? "PENDING" :
      analyticsReader.status === "unavailable" ? "UNAVAILABLE" :
      analyticsReader.status === "incomplete" ? "PENDING" : "UNAVAILABLE"
    const ordersForItem = orders.rows.filter((entry) => entry.listing_id === itemId)
    const uniqueOrderLines = new Map(ordersForItem.map((entry) =>
      [`${entry.marketplace_order_id}:${entry.marketplace_line_item_id}`, entry]))
    const officialOrderLines = (officialLive?.orders.orders ?? []).flatMap(
      (order) => order.lineItems.filter((entry) => entry.listingId === itemId)
        .map((entry) => ({ orderId: order.ebayOrderId,
          lineId: entry.lineItemId, quantity: entry.quantity })))
    const officialOrdersCertified = officialLive?.orders.status === "CERTIFIED"
    const member = (members.data ?? []).find((entry) =>
      batchIdsForAccount.has(entry.batch_id) &&
      entry.luna_product_id === productId &&
      entry.luna_variant_id === variantId && entry.luna_sku === sku)
    const plan = member?.plan_id ? planById.get(member.plan_id) : null
    const trace = (traces.data ?? []).find((entry) => {
      const truth = asRecord(asRecord(asRecord(entry.result).PRODUCT_TRUTH)
        .fieldTruthV1)
      return truth.sourceProductId === productId &&
        truth.sourceVariantId === variantId &&
        truth.sourceSupplierSku === sku
    })
    const researchEvidence = asRecord(plan?.pre_research_evidence)
    const preResearchState = !preResearchReadable ? "UNAVAILABLE" :
      !productId || !variantId || !sku ? "UNPROVEN" :
      member?.execution_state === "RUNNING" ? "RUNNING" :
      member?.execution_state === "COMPLETED" ? "COMPLETED" :
      member?.execution_state === "NEEDS_ATTENTION" &&
        member.retry_safety === "SAFE_IDEMPOTENT_RUNTIME_RESUME"
        ? "FAILED_RETRY_SAFE" :
      member?.execution_state === "NEEDS_ATTENTION" ? "NEEDS_ATTENTION" :
      member?.execution_state === "PENDING" ? "PENDING" :
      member ? "AUTHORIZED" : "NOT_REQUESTED"
    const historicalPrice = amount(official?.price ?? registryRow?.ebay_price)
    const historicalQuantity = amount(official?.availableQuantity ??
      registryRow?.ebay_quantity)
    const livePrice = registryFresh ? historicalPrice : null
    const liveQuantity = registryFresh ? historicalQuantity : null
    const supplierCost = catalogCostFresh ? amount(catalogRow?.price) :
      costEvidenceExact ? amount(costEvidence?.value_amount) : null
    const shippingQty1 = amount(exactShipping?.shipping_cost)
    const feeMetadata = asRecord(feeEvidence?.evidence_metadata)
    const feeRowsForItem = fees.rows.filter((entry) =>
      entry.ebay_item_id === itemId && entry.sku === sku &&
      entry.state === "PROVEN_PRE_SALE")
    const feeRow = newest(feeRowsForItem, "observed_at")
    const feeRowAuthority = asRecord(feeRow?.authority)
    const feeRowTemporal = temporal(feeRow, "observed_at",
      "fresh_until", "authority_id", nowMs)
    const feeEvidencePrice = amount(feeMetadata.livePriceUsd ??
      feeMetadata.itemPrice ?? feeMetadata.salePrice)
    const feeRowPrice = amount(feeRowAuthority.livePriceUsd ??
      feeRowAuthority.itemPrice ?? feeRowAuthority.salePrice)
    const feeAuthority: Temporal = feeEvidenceAuthority.status === "AVAILABLE" &&
      livePrice !== null && feeEvidencePrice === livePrice
      ? feeEvidenceAuthority : feeRowTemporal.status === "AVAILABLE" &&
        livePrice !== null && feeRowPrice === livePrice &&
        feeRowAuthority.itemId === itemId ? feeRowTemporal : {
          ...feeEvidenceAuthority,
          status: feeEvidence || feeRow ? "UNPROVEN" : "MISSING",
        }
    const estimatedEbayFees = feeAuthority === feeRowTemporal
      ? amount(feeRowAuthority.amount) : amount(feeEvidence?.value_amount)
    const otherCosts = amount(otherEvidence?.value_amount)
    const promotedReserve = policy.promotedListingsRate === 0 &&
      Number.isFinite(policy.promotedListingsRate) && livePrice !== null
      ? 0 : livePrice !== null && Number.isFinite(policy.promotedListingsRate)
        ? cents(livePrice * policy.promotedListingsRate) : null
    const returnsReserve = livePrice !== null &&
      policy.returnsReserveRate !== null &&
      policy.returnsReserveRate !== undefined &&
      Number.isFinite(policy.returnsReserveRate)
      ? cents(livePrice * policy.returnsReserveRate) : null
    const economicsComplete = Boolean(registryFresh && livePrice !== null &&
      linked.supplierLinkage === "CERTIFIED" &&
      costAuthority.status === "AVAILABLE" && supplierCost !== null &&
      shippingAuthority.status === "AVAILABLE" && shippingQty1 !== null &&
      feeAuthority.status === "AVAILABLE" && estimatedEbayFees !== null &&
      otherAuthority.status === "AVAILABLE" && otherCosts !== null &&
      returnsReserve !== null && promotedReserve !== null)
    const estimatedNetProfit = economicsComplete
      ? cents(livePrice! - supplierCost! - shippingQty1! -
          estimatedEbayFees! - returnsReserve! - promotedReserve! - otherCosts!)
      : null
    const economicPolicyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
      revenueUsd: livePrice,
      investmentBase: "EBAY_LUNA_ORDER_INVESTMENT",
      investmentBaseUsd: supplierCost !== null && shippingQty1 !== null
        ? supplierCost + shippingQty1 : null,
      costs: [
        { key: "supplier_cost", amountUsd: supplierCost,
          authority: costAuthority.sourceAuthority ?? "UNPROVEN",
          state: costAuthority.status === "AVAILABLE" ? "KNOWN" : "UNKNOWN" },
        { key: "supplier_shipping", amountUsd: shippingQty1,
          authority: shippingAuthority.sourceAuthority ?? "UNPROVEN",
          state: shippingAuthority.status === "AVAILABLE" ? "KNOWN" : "UNKNOWN" },
        { key: "ebay_fees", amountUsd: estimatedEbayFees,
          authority: feeAuthority.sourceAuthority ?? "UNPROVEN",
          state: feeAuthority.status === "AVAILABLE" ? "KNOWN" : "UNKNOWN" },
        { key: "returns_reserve", amountUsd: returnsReserve,
          authority: "SELLER_OS_REVENUE_POLICY",
          state: returnsReserve === null ? "UNKNOWN" : "ESTIMATED" },
        { key: "promoted_listings_reserve", amountUsd: promotedReserve,
          authority: "SELLER_OS_REVENUE_POLICY",
          state: promotedReserve === null ? "UNKNOWN" : "ESTIMATED" },
        { key: "other_explicit_costs", amountUsd: otherCosts,
          authority: otherAuthority.sourceAuthority ?? "UNPROVEN",
          state: otherAuthority.status === "AVAILABLE" ? "KNOWN" : "UNKNOWN" },
      ],
    })
    const blockers = [
      linked.supplierLinkage !== "CERTIFIED" ? "SUPPLIER_IDENTITY_UNPROVEN" : null,
      !registryFresh ? "EBAY_LIVE_COMMERCIAL_FACTS_STALE_OR_MISSING" : null,
      costAuthority.status !== "AVAILABLE" ? "SUPPLIER_COST_NOT_FRESH" : null,
      shippingAuthority.status !== "AVAILABLE" ? "SHIPPING_QTY1_MISSING_OR_STALE" : null,
      feeAuthority.status !== "AVAILABLE" ? "EBAY_FEE_AUTHORITY_MISSING_OR_STALE" : null,
      otherAuthority.status !== "AVAILABLE" ? "OTHER_EXPLICIT_COSTS_UNPROVEN" : null,
      returnsReserve === null ? "RETURNS_RESERVE_UNPROVEN" : null,
      currentAnalyticsStatus !== "AVAILABLE" ?
        "CURRENT_ANALYTICS_UNAVAILABLE" : null,
      !officialOrdersCertified && !uniqueOrderLines.size ?
        "OFFICIAL_ORDERS_UNAVAILABLE" : null,
      !preResearchReadable ? "PRE_RESEARCH_READ_UNAVAILABLE" : null,
      linked.stockFreshness === "STALE" ? "SUPPLIER_RECAPTURE_REQUIRED" :
        linked.stockFreshness === "UNKNOWN" ? linked.limitationCode : null,
      ...[registry, analytics, economic, shipping, fees, orders]
        .flatMap((source) => source.status === "UNAVAILABLE" ||
          source.status === "ERROR" || source.status === "PARTIAL"
          ? ["limitationCode" in source ? source.limitationCode :
            "blocker" in source ? source.blocker : null]
          : []),
    ].filter((value): value is string => Boolean(value))
    return {
      ebayItemId: itemId, liveStatus: "LIVE_ACTIVE" as const,
      ebaySku: official?.sku ?? registryRow?.ebay_sku ?? linked.sku,
      customLabel: official?.customLabel ?? linked.sku,
      title: official?.title ?? linked.title,
      categoryId: str(asRecord(registryRow?.raw_payload).CategoryID),
      lunaProductId: productId, lunaVariantId: variantId,
      supplierSku: sku, identityStatus: linked.supplierLinkage === "CERTIFIED"
        ? "PROVEN" as const : "UNPROVEN" as const,
      identityAuthority: linked.linkAuthorityState,
      livePrice, currency: official?.currency ?? registryRow?.currency ?? null,
      liveQuantity,
      supplierCost: costAuthority.status === "AVAILABLE" ? supplierCost : null,
      lastSupplierCost: costEvidence ? supplierCost : amount(catalogRow?.price),
      supplierAvailability: linked.supplierAvailability,
      supplierStockQuantity: linked.supplierStockQuantity,
      supplierStockFreshness: linked.stockFreshness,
      shippingQty1: shippingAuthority.status === "AVAILABLE" ? shippingQty1 : null,
      lastCertifiedShippingQty1: shippingQty1,
      shippingStatus: shippingAuthority.status,
      estimatedEbayFees: feeAuthority.status === "AVAILABLE"
        ? estimatedEbayFees : null,
      returnsReserve, promotedListingsReserve: promotedReserve,
      otherExplicitCosts: otherAuthority.status === "AVAILABLE" ? otherCosts : null,
      economicsStatus: economicsComplete ? "AVAILABLE" as const :
        "INCOMPLETE" as const,
      profitabilityGate: !economicPolicyEvaluation.evidenceComplete
        ? "UNPROVEN" as const : economicPolicyEvaluation.passesPolicy
          ? "PASS" as const : "FAIL" as const,
      estimatedNetProfit,
      margin: economicPolicyEvaluation.contributionMarginPercent === null
        ? null : economicPolicyEvaluation.contributionMarginPercent / 100,
      roi: economicPolicyEvaluation.estimatedRoiPercent === null
        ? null : economicPolicyEvaluation.estimatedRoiPercent / 100,
      economicPolicyEvaluation,
      analyticsStatus: currentAnalyticsStatus,
      currentAnalytics: currentAnalytics ? {
        status: "AVAILABLE" as const,
        ...currentAnalyticsMetrics,
        freshUntil: currentAnalyticsMetrics.observedAt
          ? new Date(Date.parse(currentAnalyticsMetrics.observedAt) +
              20 * 60_000).toISOString() : null,
        sourceAuthority: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      } : { status: currentAnalyticsStatus,
        impressions: null, views: null, ctr: null, quantitySold: null,
        conversionRate: null, observedAt: null, windowStart: null,
        windowEnd: null, freshUntil: null, sourceAuthority: null },
      lastCertifiedAnalytics: officialAnalytics || snapshot ? {
        status: officialAnalytics || snapshotAt &&
          nowMs - Date.parse(snapshotAt) <= 20 * 60_000
          ? "AVAILABLE" : "STALE",
        impressions: officialAnalytics
          ? currentAnalyticsMetrics.impressions : amount(snapshot?.impressions),
        views: officialAnalytics
          ? currentAnalyticsMetrics.views : amount(snapshot?.views),
        ctr: officialAnalytics
          ? currentAnalyticsMetrics.ctr : amount(snapshot?.ctr),
        quantitySold: officialAnalytics
          ? currentAnalyticsMetrics.quantitySold : amount(snapshot?.transactions),
        conversionRate: officialAnalytics
          ? currentAnalyticsMetrics.conversionRate :
            amount(snapshot?.sales_conversion_rate),
        observedAt: officialAnalytics ? currentAnalyticsMetrics.observedAt :
          snapshotAt,
        freshUntil: (officialAnalytics ? currentAnalyticsMetrics.observedAt :
          snapshotAt) ? new Date(Date.parse(String(officialAnalytics
            ? currentAnalyticsMetrics.observedAt : snapshotAt)) +
            20 * 60_000).toISOString() : null,
        sourceAuthority: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        windowStart: officialAnalytics ? currentAnalyticsMetrics.windowStart :
          snapshot?.window_start ?? null,
        windowEnd: officialAnalytics ? currentAnalyticsMetrics.windowEnd :
          snapshot?.window_end ?? null,
      } : { status: "MISSING", impressions: null, views: null,
        ctr: null, quantitySold: null, conversionRate: null,
        observedAt: null, freshUntil: null, sourceAuthority: null,
        windowStart: null, windowEnd: null },
      impressions: currentAnalytics ? currentAnalyticsMetrics.impressions : null,
      views: currentAnalytics ? currentAnalyticsMetrics.views : null,
      ctr: currentAnalytics ? currentAnalyticsMetrics.ctr : null,
      quantitySold: currentAnalytics ?
        currentAnalyticsMetrics.quantitySold : null,
      conversionRate: currentAnalytics ?
        currentAnalyticsMetrics.conversionRate : null,
      officialOrders: officialOrdersCertified
        ? new Set(officialOrderLines.map((entry) => entry.orderId)).size
        : uniqueOrderLines.size ? uniqueOrderLines.size : null,
      officialUnits: officialOrdersCertified
        ? officialOrderLines.reduce((sum, entry) => sum + entry.quantity, 0)
        : uniqueOrderLines.size && orders.status === "AVAILABLE"
        ? [...uniqueOrderLines.values()].reduce((sum, entry) =>
            sum + Number(entry.quantity), 0) : null,
      ordersStatus: officialOrdersCertified ? "AVAILABLE" :
        orders.status === "AVAILABLE" && uniqueOrderLines.size
          ? "LAST_CERTIFIED" : "UNAVAILABLE",
      preResearchState,
      preResearchDisposition: plan?.pre_research_result ?? null,
      exactComparableCount: amount(researchEvidence.exactComparableCount),
      closeComparableCount: amount(researchEvidence.closeVariantComparableCount),
      familyComparableCount: amount(researchEvidence.familyComparableCount),
      acceptedSoldQuantity: amount(researchEvidence.acceptedComparableSoldQuantity),
      traceStatus: !traceReadable ? "UNAVAILABLE" as const :
        trace?.state ?? "MISSING" as const,
      traceId: trace?.trace_id ?? null,
      dataQualityStatus: blockers.length ? "NEEDS_ATTENTION" as const :
        "AVAILABLE" as const,
      blockers,
      evidence: { live: officialFields, supplierCost: costAuthority,
        lastOfficialPrice: registryFresh ? null : historicalPrice,
        lastOfficialQuantity: registryFresh ? null : historicalQuantity,
        supplierStock: { status: linked.stockFreshness,
          observedAt: linked.stockObservedAt,
          freshUntil: linked.stockFreshUntil,
          sourceAuthority: linked.lastSuccessfulSource },
        shipping: shippingAuthority, fees: feeAuthority,
        analytics: { observedAt: currentAnalytics
          ? currentAnalyticsMetrics.observedAt : snapshotAt,
          freshUntil: (currentAnalytics ? currentAnalyticsMetrics.observedAt :
            snapshotAt) ? new Date(Date.parse(String(currentAnalytics
              ? currentAnalyticsMetrics.observedAt : snapshotAt)) +
              20 * 60_000).toISOString() : null,
          sourceAuthority: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
          currentStatus: currentAnalyticsStatus,
          lastCertifiedStatus: officialAnalytics || snapshot
            ? "AVAILABLE" : "MISSING",
          gapCodes: officialLive?.analytics.gapCodes ?? [] },
        orders: { observedAt: officialOrdersCertified
          ? officialLive?.orders.observedAt ?? null :
            instant(newest(ordersForItem,
              "last_observed_at")?.last_observed_at),
          windowStart: officialOrdersCertified
            ? officialLive?.orders.windowStart ?? null : null,
          windowEnd: officialOrdersCertified
            ? officialLive?.orders.windowEnd ?? null : null,
          freshUntil: officialOrdersCertified && officialLive?.orders.observedAt
            ? new Date(Date.parse(officialLive.orders.observedAt) +
                20 * 60_000).toISOString() : null,
          sourceAuthority: officialOrdersCertified || uniqueOrderLines.size
            ? "OFFICIAL_EBAY_ORDERS" : null },
        preResearch: { observedAt: instant(plan?.pre_research_completed_at),
          freshUntil: null,
          sourceAuthority: plan ? "LUNA_PRE_RESEARCH_RESULT_V2" : null },
        trace: { observedAt: instant(trace?.updated_at),
          freshUntil: null,
          sourceAuthority: trace ? "SELLER_OS_LIVE_COMMERCIAL_TRACE_V1" : null } },
    }
  }).sort((a, b) => a.ebayItemId.localeCompare(b.ebayItemId))
  const sourceComplete = (source: { status: string }) =>
    source.status === "AVAILABLE"
  const summary = currentCertified ? {
    portfolioCount: rows.length, fullyResolvedCount: rows.filter((row) =>
      row.identityStatus === "PROVEN").length,
    identityBlockedCount: rows.filter((row) => row.identityStatus !== "PROVEN").length,
    analyticsFreshCount: (sourceComplete(analytics) && !runs.error ||
      officialLive?.analytics.status === "CERTIFIED")
      ? rows.filter((row) => row.analyticsStatus === "AVAILABLE").length : null,
    analyticsStaleCount: (sourceComplete(analytics) && !runs.error ||
      officialLive?.analytics.status === "CERTIFIED")
      ? rows.filter((row) => row.lastCertifiedAnalytics.status === "STALE").length : null,
    analyticsUnavailableCount: (sourceComplete(analytics) && !runs.error ||
      officialLive?.analytics.status === "CERTIFIED")
      ? rows.filter((row) => row.analyticsStatus === "UNAVAILABLE").length : null,
    stockFreshCount: stockRead && stock.sourceStatus.jobs === "AVAILABLE" &&
      stock.sourceStatus.observations === "AVAILABLE"
      ? rows.filter((row) => row.supplierStockFreshness === "FRESH").length : null,
    stockStaleCount: stockRead && stock.sourceStatus.jobs === "AVAILABLE" &&
      stock.sourceStatus.observations === "AVAILABLE"
      ? rows.filter((row) => row.supplierStockFreshness === "STALE").length : null,
    shippingCompleteCount: sourceComplete(shipping)
      ? rows.filter((row) => row.shippingStatus === "AVAILABLE").length : null,
    economicsCompleteCount: [registry, economic, shipping, fees].every(sourceComplete)
      ? rows.filter((row) => row.economicsStatus === "AVAILABLE").length : null,
    preResearchPendingCount: preResearchReadable
      ? rows.filter((row) => row.preResearchState === "PENDING").length : null,
    liveDuplicateCount: rows.every((row) => row.identityStatus === "PROVEN")
      ? rows.length - new Set(rows.map((row) =>
          `${row.supplierSku}:${row.lunaProductId}:${row.lunaVariantId}`)).size
      : null,
    semanticDuplicateReviewCount: null,
  } : null
  const summaryKeys = ["portfolioCount", "fullyResolvedCount",
    "identityBlockedCount", "analyticsFreshCount", "analyticsStaleCount",
    "analyticsUnavailableCount", "stockFreshCount", "stockStaleCount",
    "shippingCompleteCount", "economicsCompleteCount",
    "preResearchPendingCount", "liveDuplicateCount",
    "semanticDuplicateReviewCount"] as const
  const summaryStatus = Object.fromEntries(summaryKeys.map((key) =>
    [key, summary?.[key] === null || summary?.[key] === undefined
      ? "UNPROVEN" : "PROVEN"]))
  return { contractVersion: SELLER_OS_REVENUE_CONTROL_PLANE_V1,
    grain: "EBAY_LIVE_ITEM" as const,
    portfolioStatus: currentCertified ? "PROVEN" as const :
      "UNAVAILABLE" as const,
    portfolioCount: summary?.portfolioCount ?? null,
    summary, summaryStatus,
    lastCertifiedPortfolio: sweepHistoryNewer ? {
      status: "LAST_CERTIFIED_STALE" as const,
      count: historicalSweep.data!.official_live_item_count,
      itemIds: (historicalCases.data ?? []).map((row) =>
        row.ebay_item_id).sort(),
      observedAt: instant(historicalSweep.data!.official_observed_at),
      freshUntil: new Date(Date.parse(String(
        historicalSweep.data!.official_observed_at)) +
        20 * 60_000).toISOString(),
      sourceAuthority: historicalSweep.data!.source_authority,
    } : {
      status: liveAuthority.lastCertifiedState,
      count: liveAuthority.lastCertifiedListingCount,
      itemIds: liveAuthority.lastCertifiedItemIds,
      observedAt: liveAuthority.lastCertifiedAt,
      freshUntil: liveAuthority.lastCertifiedFreshUntil,
      sourceAuthority: liveAuthority.sourceAuthority,
    },
    historicalRows: sweepHistoryNewer ? (historicalCases.data ?? [])
      .map((row) => ({ ebayItemId: row.ebay_item_id,
        title: row.ebay_title, customLabel: row.ebay_custom_label,
        liveStatus: "LAST_CERTIFIED_STALE" as const,
        observedAt: row.ebay_observed_at,
        sourceAuthority: historicalSweep.data!.source_authority })) : [],
    rows, sourceStatus: { live: currentCertified ? "CURRENT_FRESH" :
        "CURRENT_UNAVAILABLE", stockRead: stockRead ? "AVAILABLE" :
        "UNAVAILABLE",
      officialRead: officialLive?.discovery.status ?? null,
      officialGapCodes: officialLive?.discovery.gapCodes ?? [],
      stock: stock.sourceStatus, registry: registry.status,
      analytics: analytics.status,
      analyticsCurrent: officialLive?.analytics.status ??
        analyticsReader.status ?? null,
      economic: economic.status, shipping: shipping.status, fees: fees.status,
      orders: orders.status, preResearch: preResearchReadable
        ? "AVAILABLE" : "UNAVAILABLE",
      catalog: catalogReadable ? "AVAILABLE" : "UNAVAILABLE",
      trace: traceReadable ? "AVAILABLE" : "UNAVAILABLE" },
    policy, observedAt: now.toISOString(),
    safety: { ebayWrites: 0, stockGuardWrites: 0, publicationWrites: 0,
      pricingWrites: 0, adsWrites: 0, durableWrites: 0 } }
}
