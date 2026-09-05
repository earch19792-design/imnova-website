import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_OWNER_OPERATIONAL_INSIGHTS_V1 =
  "SELLER_OS_OWNER_OPERATIONAL_INSIGHTS_V1" as const
export const SELLER_OS_OWNER_TIME_ZONE_V1 = "America/Managua" as const

type Row = Record<string, unknown>

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {}
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function iso(value: unknown) {
  const valueText = text(value, 80)
  return valueText && Number.isFinite(Date.parse(valueText))
    ? new Date(valueText).toISOString() : null
}

function nonnegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function localDateKey(value: string, timeZone = SELLER_OS_OWNER_TIME_ZONE_V1) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric",
    month: "2-digit", day: "2-digit" }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function dateKeys(now: Date, days: number) {
  return Array.from({ length: days }, (_, offset) => localDateKey(
    new Date(now.getTime() - (days - 1 - offset) * 86_400_000).toISOString()))
}

function packageId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = record(value)
  for (const key of ["listingPackageId", "listing_package_id", "packageId"])
    if (text(source[key], 80)) return text(source[key], 80)
  for (const nested of [source.lineage, source.sellerOs, source.metadata]) {
    const found = packageId(nested)
    if (found) return found
  }
  return null
}

function category(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = record(value)
  const directId = text(source.categoryId ?? source.category_id, 30)
  const directName = text(source.categoryName ?? source.category_name, 120)
  if (directId || directName) return { id: directId ?? "UNMAPPED",
    name: directName ?? `Categoría ${directId}` }
  for (const key of ["category", "taxonomy", "readiness", "listingReview",
    "canonicalListing", "marketplacePackage"]) {
    const found = category(source[key])
    if (found) return found
  }
  return null
}

function confirmedOrder(row: Row) {
  const payment = String(row.payment_status ?? "").toUpperCase()
  const fulfillment = String(row.fulfillment_status ?? "").toUpperCase()
  return ["PAID", "FULLY_PAID"].includes(payment)
    && !/(CANCEL|VOID)/.test(fulfillment)
}

export async function readSellerOsOwnerOperationalInsightsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const [ordersRead, linesRead] = await Promise.all([
    input.supabase.from("marketplace_order_snapshots")
      .select("marketplace_order_id,order_created_at,order_modified_at,payment_status,fulfillment_status,total_amount,currency,source,observed_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("order_modified_at", { ascending: false }).limit(1_000),
    input.supabase.from("marketplace_order_line_items")
      .select("marketplace_order_id,marketplace_line_item_id,listing_id,sku,quantity,line_item_amount,currency,last_observed_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("last_observed_at", { ascending: false }).limit(2_000),
  ])
  const orderRows = (ordersRead.data ?? []).map(record)
  const lineRows = (linesRead.data ?? []).map(record)
  const orderById = new Map(orderRows.map((row) =>
    [String(row.marketplace_order_id), row]))
  const uniqueLines = [...new Map(lineRows.map((row) => [
    `${row.marketplace_order_id}:${row.marketplace_line_item_id}`, row,
  ])).values()]
  const confirmed = orderRows.filter(confirmedOrder)
  const confirmedIds = new Set(confirmed.map((row) =>
    String(row.marketplace_order_id)))
  const confirmedLines = uniqueLines.filter((row) =>
    confirmedIds.has(String(row.marketplace_order_id)))
  const orderSourceAvailable = !ordersRead.error && !linesRead.error
  const amountComplete = confirmed.every((row) =>
    nonnegative(row.total_amount) !== null && row.currency === "USD")
  const lineAmountComplete = confirmedLines.every((row) =>
    nonnegative(row.line_item_amount) !== null && row.currency === "USD"
      && nonnegative(row.quantity) !== null)
  const latestObservedAt = [...confirmed].map((row) =>
    iso(row.observed_at) ?? iso(row.order_modified_at)).filter(Boolean).sort().at(-1)
    ?? null
  const sourceAgeSeconds = latestObservedAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(latestObservedAt)) / 1_000))
    : null
  const freshness = sourceAgeSeconds === null ? "UNKNOWN" as const
    : sourceAgeSeconds <= 15 * 60 ? "FRESH" as const : "STALE" as const
  const windows = [1, 7, 30, 90, 365].map((days) => {
    const keys = dateKeys(now, days)
    const keySet = new Set(keys)
    const scopedOrders = confirmed.filter((row) => {
      const createdAt = iso(row.order_created_at)
      return createdAt && keySet.has(localDateKey(createdAt))
    })
    const scopedOrderIds = new Set(scopedOrders.map((row) =>
      String(row.marketplace_order_id)))
    const scopedLines = confirmedLines.filter((row) =>
      scopedOrderIds.has(String(row.marketplace_order_id)))
    const points = keys.map((date) => {
      const dateOrders = scopedOrders.filter((row) => {
        const createdAt = iso(row.order_created_at)
        return createdAt && localDateKey(createdAt) === date
      })
      const ids = new Set(dateOrders.map((row) =>
        String(row.marketplace_order_id)))
      const dateLines = scopedLines.filter((row) =>
        ids.has(String(row.marketplace_order_id)))
      return Object.freeze({ date,
        grossSalesUsd: amountComplete ? dateOrders.reduce((sum, row) =>
          sum + (nonnegative(row.total_amount) ?? 0), 0) : null,
        officialOrderCount: dateOrders.length,
        unitsSold: lineAmountComplete ? dateLines.reduce((sum, row) =>
          sum + (nonnegative(row.quantity) ?? 0), 0) : null })
    })
    const grossSalesUsd = amountComplete ? scopedOrders.reduce((sum, row) =>
      sum + (nonnegative(row.total_amount) ?? 0), 0) : null
    const unitsSold = lineAmountComplete ? scopedLines.reduce((sum, row) =>
      sum + (nonnegative(row.quantity) ?? 0), 0) : null
    return Object.freeze({ days, points: Object.freeze(points), grossSalesUsd,
      officialOrderCount: scopedOrders.length, unitsSold,
      averageOrderValueUsd: grossSalesUsd !== null && scopedOrders.length
        ? grossSalesUsd / scopedOrders.length : null })
  })

  const soldListingIds = [...new Set(confirmedLines.flatMap((row) =>
    text(row.listing_id, 30) ? [String(row.listing_id)] : []))]
  const registryRead = soldListingIds.length
    ? await input.supabase.from("ebay_active_listings")
      .select("ebay_item_id,listing_status,supplier_variant_id,supplier_sku,last_ebay_sync_at,raw_payload")
      .eq("account_key", input.accountKey).in("ebay_item_id", soldListingIds)
      .limit(500)
    : { data: [], error: null }
  const registryRows = (registryRead.data ?? []).map(record)
  const packageIds = [...new Set(registryRows.flatMap((row) => {
    const id = packageId(row.raw_payload)
    return id ? [id] : []
  }))]
  const packagesRead = packageIds.length
    ? await input.supabase.from("ebay_listing_packages")
      .select("id,package_data,readiness,updated_at")
      .eq("account_key", input.accountKey).in("id", packageIds).limit(500)
    : { data: [], error: null }
  const packages = new Map((packagesRead.data ?? []).map((value) => {
    const row = record(value)
    return [String(row.id), category(row.package_data) ?? category(row.readiness)]
  }))
  const registryByItem = new Map(registryRows.map((row) =>
    [String(row.ebay_item_id), row]))
  const categoryByItem = new Map(registryRows.map((row) => {
    const id = packageId(row.raw_payload)
    return [String(row.ebay_item_id), id ? packages.get(id) ?? null : null]
  }))
  const buildCategoryWindow = (days: number) => {
    const keys = new Set(days === 1
      ? [localDateKey(new Date(now.getTime() - 86_400_000).toISOString())]
      : dateKeys(now, days))
    const scopedLines = confirmedLines.filter((line) => {
      const order = orderById.get(String(line.marketplace_order_id))
      const createdAt = iso(order?.order_created_at)
      return createdAt && keys.has(localDateKey(createdAt))
    })
    const groups = new Map<string, { id: string; name: string;
      gross: number; orders: Set<string>; units: number;
      lastSaleAt: string | null }>()
    for (const line of scopedLines) {
      const itemId = text(line.listing_id, 30) ?? "UNMAPPED"
      const mapped = categoryByItem.get(itemId) ?? null
      const key = mapped?.id ?? "UNMAPPED"
      const current = groups.get(key) ?? { id: key,
        name: mapped?.name ?? "Sin mapear", gross: 0,
        orders: new Set<string>(), units: 0, lastSaleAt: null }
      const order = orderById.get(String(line.marketplace_order_id))
      const createdAt = iso(order?.order_created_at)
      current.gross += nonnegative(line.line_item_amount) ?? 0
      current.units += nonnegative(line.quantity) ?? 0
      current.orders.add(String(line.marketplace_order_id))
      if (createdAt && (!current.lastSaleAt || createdAt > current.lastSaleAt))
        current.lastSaleAt = createdAt
      groups.set(key, current)
    }
    const total = [...groups.values()].reduce((sum, item) =>
      sum + item.gross, 0)
    const top = [...groups.values()].map((item) => Object.freeze({
      categoryId: item.id, categoryName: item.name,
      grossSalesUsd: lineAmountComplete ? item.gross : null,
      officialOrderCount: item.orders.size, unitsSold: item.units,
      averageOrderValueUsd: item.orders.size ? item.gross / item.orders.size : null,
      shareOfTotalSalesPercent: total > 0 ? item.gross / total * 100 : null,
      lastSaleAt: item.lastSaleAt, profitUsd: null, marginPercent: null,
      salesTrend: "INSUFFICIENT_DATA" as const,
      mappingStatus: item.id === "UNMAPPED" ? "UNMAPPED" as const
        : "MAPPED" as const })).sort((left, right) =>
      (right.grossSalesUsd ?? -1) - (left.grossSalesUsd ?? -1)).slice(0, 5)
    return Object.freeze({ days, top: Object.freeze(top), total,
      unmappedCount: top.filter((item) => item.mappingStatus === "UNMAPPED").length })
  }
  const categoryWindows = [1, 7, 30, 90].map(buildCategoryWindow)
  const allCategoryWindow = buildCategoryWindow(3650)

  const [radarRunRead, radarReceiptRead, radarSchedulerRead,
    radarDispatchRead, opportunityRead] = await Promise.all([
    input.supabase.from("seller_os_daily_dollar_radar_runs")
      .select("run_id,status,queue_entry_count,families_evaluated,demand_proven_count,demand_supported_count,luna_match_count,last_error_code,failure_stage,started_at,completed_at")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_daily_dollar_radar_run_receipts")
      .select("receipt_id,event_type,run_status,failure_stage,families_evaluated,demand_proven_count,demand_supported_count,luna_match_count,morning_queue_count,recorded_at")
      .order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_post_runtime_scheduler_v1")
      .select("lane,schedule,dispatch_window_seconds,enabled,updated_at")
      .eq("lane", "DAILY_DOLLAR_RADAR_AUTOPILOT").maybeSingle(),
    input.supabase.from("seller_os_post_runtime_dispatch_receipts_v1")
      .select("dispatch_slot,status,requested_at")
      .eq("lane", "DAILY_DOLLAR_RADAR_AUTOPILOT")
      .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_market_opportunity_cases")
      .select("opportunity_case_id,family_name,status,updated_at")
      .eq("status", "MONITORING").order("updated_at", { ascending: false })
      .limit(100),
  ])
  const radarRun = record(radarRunRead.data)
  const radarReceipt = record(radarReceiptRead.data)
  const radarScheduler = record(radarSchedulerRead.data)
  const radarDispatch = record(radarDispatchRead.data)
  const radarLastCompletedAt = iso(radarRun.completed_at)
  const radarAgeSeconds = radarLastCompletedAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(radarLastCompletedAt)) / 1_000))
    : null
  const radarAuthorityAvailable = !radarRunRead.error &&
    !radarSchedulerRead.error && !radarDispatchRead.error
  const radarStatus = !radarAuthorityAvailable ? "DESCONOCIDO" as const
    : radarScheduler.enabled !== true ? "BLOQUEADO" as const
      : !iso(radarDispatch.requested_at) ? "BLOQUEADO" as const
        : radarAgeSeconds !== null && radarAgeSeconds > 36 * 60 * 60
          ? "BLOQUEADO" as const : radarRun.status === "RUNNING"
            ? "OPERANDO" as const : "SIN_TRABAJO" as const
  const radarCause = !radarAuthorityAvailable
    ? "RADAR_AUTHORITY_UNAVAILABLE"
    : radarScheduler.enabled !== true ? "RADAR_SCHEDULER_DISABLED"
      : !iso(radarDispatch.requested_at)
        ? "RADAR_POST_DISPATCH_RECEIPT_ABSENT"
        : radarAgeSeconds !== null && radarAgeSeconds > 36 * 60 * 60
          ? "RADAR_LAST_COMPLETED_RUN_STALE"
          : "RADAR_RUNTIME_AUTHORITY_CURRENT"
  const opportunityRows = (opportunityRead.data ?? []).map(record)
  const activity: Array<Readonly<{ type: string; at: string; title: string;
    amountUsd: number | null; units: number | null; whatsappStatus: string;
    buyerThankYouStatus: string; officialReadbackState: string }>> =
    confirmed.slice(0, 5).flatMap((row) => {
    const at = iso(row.order_created_at)
    return at ? [Object.freeze({ type: "SALE_CONFIRMED" as const, at,
      title: "Venta confirmada", amountUsd: nonnegative(row.total_amount),
      units: confirmedLines.filter((line) => line.marketplace_order_id ===
        row.marketplace_order_id).reduce((sum, line) =>
        sum + (nonnegative(line.quantity) ?? 0), 0),
      whatsappStatus: "UNKNOWN" as const,
      buyerThankYouStatus: "UNKNOWN" as const,
      officialReadbackState: "OFFICIAL_ORDER_CONFIRMED" as const })] : []
    })
  if (radarLastCompletedAt) activity.push(Object.freeze({
    type: "RADAR_COMPLETED" as const, at: radarLastCompletedAt,
    title: "Radar nocturno terminó",
    amountUsd: null, units: nonnegative(radarRun.queue_entry_count),
    whatsappStatus: "NOT_ELIGIBLE" as const,
    buyerThankYouStatus: "NOT_ELIGIBLE" as const,
    officialReadbackState: radarReceipt.event_type === "COMPLETED"
      ? "DURABLE_RECEIPT_CONFIRMED" as const : "RECEIPT_UNPROVEN" as const,
  }))

  return Object.freeze({
    contractVersion: SELLER_OS_OWNER_OPERATIONAL_INSIGHTS_V1,
    observedAt: now.toISOString(), timeZone: SELLER_OS_OWNER_TIME_ZONE_V1,
    sales: Object.freeze({ source: "OFFICIAL_EBAY_ORDERS" as const,
      status: !orderSourceAvailable ? "UNAVAILABLE" as const
        : amountComplete && lineAmountComplete
          ? freshness === "FRESH" ? "AVAILABLE" as const : "PARTIAL" as const
          : "PARTIAL" as const,
      freshness, sourceUpdatedAt: latestObservedAt,
      sourceAgeSeconds, windows: Object.freeze(windows),
      orderIdentityDeduplicated: uniqueLines.length === lineRows.length,
      profitUsd: null, refundsUsd: null, netSalesUsd: null,
      limitationCodes: Object.freeze([
        freshness === "STALE" ? "OFFICIAL_ORDER_DURABLE_SOURCE_STALE" : null,
        !amountComplete ? "ORDER_TOTAL_AUTHORITY_PARTIAL" : null,
        !lineAmountComplete ? "ORDER_LINE_AMOUNT_AUTHORITY_PARTIAL" : null,
      ].filter((value): value is string => Boolean(value))) }),
    categories: Object.freeze({ status: !orderSourceAvailable ||
      registryRead.error || packagesRead.error ? "UNAVAILABLE" as const
      : allCategoryWindow.unmappedCount > 0
        ? "PARTIAL" as const : "AVAILABLE" as const,
      source: "OFFICIAL_EBAY_ORDERS_PLUS_CANONICAL_LISTING_CATEGORY" as const,
      windows: Object.freeze(categoryWindows),
      top: Object.freeze(categoryWindows.find((entry) => entry.days === 7)?.top
        ?? []),
      unmappedCount: allCategoryWindow.unmappedCount,
      totalReconciles: lineAmountComplete && Math.abs(allCategoryWindow.total -
        confirmedLines.reduce((sum, row) => sum +
          (nonnegative(row.line_item_amount) ?? 0), 0)) < 0.005 }),
    radar: Object.freeze({ status: radarStatus, cause: radarCause,
      lastCompletedRunAt: radarLastCompletedAt,
      lastDispatchAt: iso(radarDispatch.requested_at),
      lastResult: text(radarRun.status, 40),
      currentStage: text(radarRun.failure_stage, 80) ??
        (radarRun.status === "COMPLETED" ? "COMPLETADO" : "DESCONOCIDO"),
      schedule: text(radarScheduler.schedule, 40),
      schedulerEnabled: radarScheduler.enabled === true,
      schedulerTickIsEligibleDispatch: false as const,
      opportunitiesFound: opportunityRead.error ? null : opportunityRows.length,
      handoffCount: null,
      lunaMatchCount: nonnegative(radarRun.luna_match_count),
      errorCount: radarRun.last_error_code ? 1 : 0,
      errorCode: text(radarRun.last_error_code, 120) }),
    listingIntegrity: Object.freeze({ authorityAvailable: !registryRead.error,
      listingCount: registryRows.length,
      supplierLinkMissingCount: registryRows.filter((row) =>
        !text(row.supplier_variant_id, 160) && !text(row.supplier_sku, 160)).length,
      categoryUnmappedCount: soldListingIds.filter((itemId) =>
        !categoryByItem.get(itemId)).length,
      exceptions: Object.freeze(registryRows.filter((row) =>
        !text(row.supplier_variant_id, 160) && !text(row.supplier_sku, 160))
        .slice(0, 5).map((row) => Object.freeze({ itemId:
          text(row.ebay_item_id, 30), problem: "SUPPLIER_LINK_MISSING",
          lastEvidenceAt: iso(row.last_ebay_sync_at),
          nextAction: "RUNTIME_RECONCILIATION", ownerRequired: false }))) }),
    marketOpportunity: Object.freeze({ separateFromAccountSales: true as const,
      status: opportunityRead.error ? "UNAVAILABLE" as const :
        radarStatus === "BLOQUEADO" ? "STALE" as const : "AVAILABLE" as const,
      opportunities: Object.freeze(opportunityRows.slice(0, 5).map((row) =>
        Object.freeze({ family: text(row.family_name, 120),
          opportunityCount: 1, updatedAt: iso(row.updated_at) }))) }),
    activity: Object.freeze(activity.sort((left, right) =>
      Date.parse(right.at) - Date.parse(left.at)).slice(0, 8)),
    safety: Object.freeze({ readOnly: true as const, marketplaceWrites: 0 as const,
      buyerPiiIncluded: false as const, analyticsQuantitySoldUsed: false as const }),
  })
}
