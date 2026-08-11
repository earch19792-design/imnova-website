import type { SupabaseClient } from "@supabase/supabase-js"

export type ReadonlySourceStatus = "AVAILABLE" | "PARTIAL" | "ERROR"

export type ReadonlySourceResult<T> = {
  source: string
  status: ReadonlySourceStatus
  rows: T[]
  limitationCode: string | null
  truncated: boolean
}

export type ReadonlyRegistryListingRow = {
  id: string
  account_key: string
  source: string
  sync_key?: string | null
  ebay_item_id: string
  ebay_sku: string | null
  ebay_variation_key?: string | null
  listing_status: string
  title: string
  ebay_quantity: number | null
  ebay_price: number | string | null
  currency: string | null
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_cost_at_linking: number | string | null
  last_ebay_sync_at: string | null
  raw_payload: unknown
  sync_generation: number | string | null
  created_at: string
  updated_at: string
}

export type ReadonlyRegistrySyncKeyRow = {
  sync_key: string | null
}

export type ReadonlySyncStateRow = {
  account_key: string
  latest_generation: number | string
  latest_started_at: string | null
  latest_committed_generation: number | string
  latest_committed_at: string | null
  targeted_luna_last_success_run_id: string | null
  targeted_luna_last_success_at: string | null
  targeted_luna_last_error_at: string | null
  targeted_luna_last_error_code: string | null
}

export type ReadonlyIdentityVerificationRow = {
  id: string
  listing_id: string
  expected_sku: string
  observed_listing_id: string | null
  observed_sku: string | null
  variation_key?: string | null
  observed_listing_status: string | null
  item_id_matches: boolean
  sku_matches: boolean
  active_listing_confirmed: boolean
  source: string
  error_code: string | null
  observed_at: string
}

export type ReadonlyCommercialSnapshotRow = {
  id: string
  listing_id: string
  sku: string | null
  listing_status: string
  impressions: number | string | null
  views: number | string | null
  ctr: number | string | null
  transactions: number | string | null
  sales_conversion_rate: number | string | null
  revenue: number | string | null
  current_watchers: number | string | null
  stock_available: number | string | null
  supplier_cost: number | string | null
  estimated_margin_percent: number | string | null
  observed_at: string
  window_start: string | null
  window_end: string | null
  source: unknown
  completeness_status: string
}

export type ReadonlySupplyRow = {
  product_id: string | null
  source_key: string | null
  snapshot_id: string | null
  supplier_variant_id: string | null
  sku: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | string | null
  captured_at: string | null
  metadata: unknown
}

export type ReadonlySupplySourceRow = {
  key: string
  is_active: boolean
  last_run_at: string | null
  last_success_at: string | null
}

export type ReadonlyOrderRow = {
  marketplace_order_id: string
  order_created_at: string
  order_modified_at: string
  payment_status: string
  fulfillment_status: string
  total_amount: number | string | null
  currency: string | null
  source: string
  observed_at: string
}

export type ReadonlyOrderLineRow = {
  marketplace_order_id: string
  marketplace_line_item_id: string
  listing_id: string
  sku: string | null
  pack_quantity: number | string | null
  quantity: number | string
  line_item_amount: number | string | null
  currency: string | null
  ship_by_at: string | null
  source: string
  first_observed_at: string
  last_observed_at: string
}

export type ReadonlyLearningAdjustmentRow = {
  id: string
  category_id: string
  model_version: string
  prediction_engine_version: string
  status: string
  eligible: boolean
  adjustment_points: number | string
  sample_listing_count: number | string
  total_impressions: number | string
  minimum_observation_days: number | string
  source: string
  computed_at: string
}

export type ReadonlySupabaseReader = Pick<SupabaseClient, "from">

export type CommercialMonitorReadonlySources = {
  registry: ReadonlySourceResult<ReadonlyRegistryListingRow>
  syncState: ReadonlySourceResult<ReadonlySyncStateRow>
  identityVerifications: ReadonlySourceResult<ReadonlyIdentityVerificationRow>
  commercialSnapshots: ReadonlySourceResult<ReadonlyCommercialSnapshotRow>
  supplies: ReadonlySourceResult<ReadonlySupplyRow>
  supplySources: ReadonlySourceResult<ReadonlySupplySourceRow>
  orders: ReadonlySourceResult<ReadonlyOrderRow>
  orderLines: ReadonlySourceResult<ReadonlyOrderLineRow>
  learning: ReadonlySourceResult<ReadonlyLearningAdjustmentRow>
}

function success<T>(source: string, rows: T[], maximum: number) {
  const truncated = rows.length > maximum
  return {
    source,
    status: truncated ? "PARTIAL" as const : "AVAILABLE" as const,
    rows: rows.slice(0, maximum),
    limitationCode: truncated ? `${source}_RESULT_LIMIT_REACHED` : null,
    truncated,
  }
}

function failure<T>(source: string, code: string, rows: T[] = []) {
  return {
    source,
    status: rows.length ? "PARTIAL" as const : "ERROR" as const,
    rows,
    limitationCode: code,
    truncated: false,
  }
}

export async function readRegistry(
  supabase: ReadonlySupabaseReader,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlyRegistryListingRow>> {
  const maximum = 500
  const { data, error } = await supabase
    .from("ebay_active_listings")
    .select("id,account_key,source,sync_key,ebay_item_id,ebay_sku,listing_status,title,ebay_quantity,ebay_price,currency,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_ebay_sync_at,raw_payload,sync_generation,created_at,updated_at")
    .eq("account_key", accountKey)
    .in("listing_status", ["active", "paused", "unknown", "draft"])
    .order("updated_at", { ascending: false })
    .limit(maximum + 1)
  if (error) {
    return failure("EBAY_ACTIVE_LISTING_REGISTRY", "COMMERCIAL_REGISTRY_READ_FAILED")
  }
  return success(
    "EBAY_ACTIVE_LISTING_REGISTRY",
    (data ?? []) as ReadonlyRegistryListingRow[],
    maximum,
  )
}

export async function readRegistrySyncKeyCollisions(
  supabase: ReadonlySupabaseReader,
  syncKeys: string[],
): Promise<ReadonlySourceResult<ReadonlyRegistrySyncKeyRow>> {
  const maximum = 500
  const uniqueSyncKeys = [...new Set(syncKeys)]
  if (uniqueSyncKeys.length === 0) {
    return success("EBAY_ACTIVE_LISTING_SYNC_KEY_DOMAIN", [], maximum)
  }
  if (uniqueSyncKeys.length > maximum) {
    return failure(
      "EBAY_ACTIVE_LISTING_SYNC_KEY_DOMAIN",
      "EBAY_ACTIVE_LISTING_SYNC_KEY_LOOKUP_LIMIT_EXCEEDED",
    )
  }
  const { data, error } = await supabase
    .from("ebay_active_listings")
    .select("sync_key")
    .in("sync_key", uniqueSyncKeys)
    .limit(maximum + 1)
  if (error) {
    return failure(
      "EBAY_ACTIVE_LISTING_SYNC_KEY_DOMAIN",
      "EBAY_ACTIVE_LISTING_SYNC_KEY_LOOKUP_FAILED",
    )
  }
  return success(
    "EBAY_ACTIVE_LISTING_SYNC_KEY_DOMAIN",
    (data ?? []) as ReadonlyRegistrySyncKeyRow[],
    maximum,
  )
}

async function readSyncState(
  supabase: SupabaseClient,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlySyncStateRow>> {
  const { data, error } = await supabase
    .from("ebay_active_listing_sync_state")
    .select("account_key,latest_generation,latest_started_at,latest_committed_generation,latest_committed_at,targeted_luna_last_success_run_id,targeted_luna_last_success_at,targeted_luna_last_error_at,targeted_luna_last_error_code")
    .eq("account_key", accountKey)
    .limit(1)
  if (error) {
    return failure("EBAY_ACTIVE_LISTING_SYNC_STATE", "COMMERCIAL_SYNC_STATE_READ_FAILED")
  }
  return success(
    "EBAY_ACTIVE_LISTING_SYNC_STATE",
    (data ?? []) as ReadonlySyncStateRow[],
    1,
  )
}

async function readIdentityVerifications(
  supabase: SupabaseClient,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlyIdentityVerificationRow>> {
  const maximum = 500
  const { data, error } = await supabase
    .from("marketplace_listing_identity_verifications")
    .select("id,listing_id,expected_sku,observed_listing_id,observed_sku,observed_listing_status,item_id_matches,sku_matches,active_listing_confirmed,source,error_code,observed_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .order("observed_at", { ascending: false })
    .limit(maximum + 1)
  if (error) {
    return failure(
      "EBAY_TRADING_LISTING_IDENTITY",
      "COMMERCIAL_IDENTITY_VERIFICATION_READ_FAILED",
    )
  }
  return success(
    "EBAY_TRADING_LISTING_IDENTITY",
    (data ?? []) as ReadonlyIdentityVerificationRow[],
    maximum,
  )
}

async function readCommercialSnapshots(
  supabase: SupabaseClient,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlyCommercialSnapshotRow>> {
  const maximum = 2_000
  const { data, error } = await supabase
    .from("listing_commercial_snapshots")
    .select("id,listing_id,sku,listing_status,impressions,views,ctr,transactions,sales_conversion_rate,revenue,current_watchers,stock_available,supplier_cost,estimated_margin_percent,observed_at,window_start,window_end,source,completeness_status")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .order("observed_at", { ascending: false })
    .limit(maximum + 1)
  if (error) {
    return failure(
      "COMMERCIAL_SNAPSHOT_REGISTRY",
      "COMMERCIAL_SNAPSHOT_READ_FAILED",
    )
  }
  return success(
    "COMMERCIAL_SNAPSHOT_REGISTRY",
    (data ?? []) as ReadonlyCommercialSnapshotRow[],
    maximum,
  )
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function readSupplies(
  supabase: SupabaseClient,
  listings: ReadonlyRegistryListingRow[],
) : Promise<ReadonlySourceResult<ReadonlySupplyRow>> {
  const productIds = [...new Set(listings
    .map((listing) => listing.market_radar_product_id)
    .filter((value): value is string => Boolean(value)))]
  const variantIds = [...new Set(listings
    .map((listing) => listing.supplier_variant_id)
    .filter((value): value is string => Boolean(value)))]
  const supplierSkus = [...new Set(listings
    .map((listing) => listing.supplier_sku)
    .filter((value): value is string => Boolean(value)))]
  const selectors: Array<["product_id" | "supplier_variant_id" | "sku", string[]]> = [
    ["product_id", productIds],
    ["supplier_variant_id", variantIds],
    ["sku", supplierSkus],
  ]
  const rows: ReadonlySupplyRow[] = []
  let failed = false
  for (const [column, values] of selectors) {
    for (const selection of chunks(values, 100)) {
      const { data, error } = await supabase
        .from("market_radar_latest_variants")
        .select("product_id,source_key,snapshot_id,supplier_variant_id,sku,price,available,inventory_quantity,captured_at,metadata")
        .in(column, selection)
        .limit(1_001)
      if (error) {
        failed = true
        continue
      }
      rows.push(...((data ?? []) as ReadonlySupplyRow[]))
    }
  }
  const unique = [...new Map(rows.map((row) => [
    row.snapshot_id ?? JSON.stringify([
      row.product_id,
      row.supplier_variant_id,
      row.sku,
      row.captured_at,
    ]),
    row,
  ])).values()]
  if (failed) {
    return failure(
      "LUNA_PORTEX_MARKET_RADAR",
      "COMMERCIAL_LUNA_SUPPLY_READ_PARTIAL",
      unique.slice(0, 1_000),
    )
  }
  return success("LUNA_PORTEX_MARKET_RADAR", unique, 1_000)
}

async function readSupplySources(
  supabase: SupabaseClient,
): Promise<ReadonlySourceResult<ReadonlySupplySourceRow>> {
  const { data, error } = await supabase
    .from("market_radar_sources")
    .select("key,is_active,last_run_at,last_success_at")
    .eq("key", "lunaportex")
    .limit(2)
  if (error) {
    return failure(
      "LUNA_PORTEX_SOURCE_HEALTH",
      "COMMERCIAL_LUNA_SOURCE_HEALTH_READ_FAILED",
    )
  }
  return success(
    "LUNA_PORTEX_SOURCE_HEALTH",
    (data ?? []) as ReadonlySupplySourceRow[],
    1,
  )
}

async function readOrders(
  supabase: SupabaseClient,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlyOrderRow>> {
  const maximum = 1_000
  const { data, error } = await supabase
    .from("marketplace_order_snapshots")
    .select("marketplace_order_id,order_created_at,order_modified_at,payment_status,fulfillment_status,total_amount,currency,source,observed_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .order("order_modified_at", { ascending: false })
    .limit(maximum + 1)
  if (error) {
    return failure("SANITIZED_ORDER_SNAPSHOTS", "COMMERCIAL_ORDER_SNAPSHOT_READ_FAILED")
  }
  return success(
    "SANITIZED_ORDER_SNAPSHOTS",
    (data ?? []) as ReadonlyOrderRow[],
    maximum,
  )
}

async function readOrderLines(
  supabase: SupabaseClient,
  accountKey: string,
  itemIds: string[],
) : Promise<ReadonlySourceResult<ReadonlyOrderLineRow>> {
  const maximum = 2_000
  if (!itemIds.length) {
    return success("SANITIZED_ORDER_LINE_ITEMS", [], maximum)
  }
  const rows: ReadonlyOrderLineRow[] = []
  let failed = false
  for (const selection of chunks(itemIds, 100)) {
    const { data, error } = await supabase
      .from("marketplace_order_line_items")
      .select("marketplace_order_id,marketplace_line_item_id,listing_id,sku,pack_quantity,quantity,line_item_amount,currency,ship_by_at,source,first_observed_at,last_observed_at")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", "EBAY_US")
      .in("listing_id", selection)
      .order("last_observed_at", { ascending: false })
      .limit(maximum + 1)
    if (error) {
      failed = true
      continue
    }
    rows.push(...((data ?? []) as ReadonlyOrderLineRow[]))
  }
  const unique = [...new Map(rows.map((row) => [
    `${row.marketplace_order_id}:${row.marketplace_line_item_id}`,
    row,
  ])).values()]
  if (failed) {
    return failure(
      "SANITIZED_ORDER_LINE_ITEMS",
      "COMMERCIAL_ORDER_LINE_READ_PARTIAL",
      unique.slice(0, maximum),
    )
  }
  return success("SANITIZED_ORDER_LINE_ITEMS", unique, maximum)
}

async function readLearning(
  supabase: SupabaseClient,
  accountKey: string,
) : Promise<ReadonlySourceResult<ReadonlyLearningAdjustmentRow>> {
  const maximum = 200
  const { data, error } = await supabase
    .from("ebay_category_learning_adjustments")
    .select("id,category_id,model_version,prediction_engine_version,status,eligible,adjustment_points,sample_listing_count,total_impressions,minimum_observation_days,source,computed_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .order("computed_at", { ascending: false })
    .limit(maximum + 1)
  if (error) {
    return failure("EBAY_CATEGORY_LEARNING", "COMMERCIAL_LEARNING_READ_FAILED")
  }
  return success(
    "EBAY_CATEGORY_LEARNING",
    (data ?? []) as ReadonlyLearningAdjustmentRow[],
    maximum,
  )
}

export async function readCommercialMonitorReadonlySources(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<CommercialMonitorReadonlySources> {
  const [registry, identityVerifications] = await Promise.all([
    readRegistry(supabase, accountKey),
    readIdentityVerifications(supabase, accountKey),
  ])
  const itemIds = [...new Set([
    ...registry.rows.map((listing) => listing.ebay_item_id),
    ...identityVerifications.rows.flatMap((verification) => [
      verification.listing_id,
      verification.observed_listing_id,
    ]),
  ].filter((value): value is string =>
    typeof value === "string" && /^\d{9,20}$/.test(value)))]
  const [
    syncState,
    commercialSnapshots,
    supplies,
    supplySources,
    orders,
    orderLines,
    learning,
  ] = await Promise.all([
    readSyncState(supabase, accountKey),
    readCommercialSnapshots(supabase, accountKey),
    readSupplies(supabase, registry.rows),
    readSupplySources(supabase),
    readOrders(supabase, accountKey),
    readOrderLines(supabase, accountKey, itemIds),
    readLearning(supabase, accountKey),
  ])
  return {
    registry,
    syncState,
    identityVerifications,
    commercialSnapshots,
    supplies,
    supplySources,
    orders,
    orderLines,
    learning,
  }
}
