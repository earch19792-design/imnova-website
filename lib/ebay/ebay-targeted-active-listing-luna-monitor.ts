import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { DirectedLunaProduct } from "./ebay-luna-directed-product-import"
import {
  fetchDirectedLunaProduct,
  parseDirectedLunaProductUrl,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-luna-directed-product-import.ts"

export const TARGETED_ACTIVE_LISTING_LUNA_MONITOR_VERSION =
  "EBAY_TARGETED_ACTIVE_LISTING_LUNA_MONITOR_V1" as const

const LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 8_000

type JsonRecord = Record<string, unknown>

type ActiveListingRow = {
  id: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
}

type CurrentVariantRow = {
  product_id: string
  source_id: string
  source_key: string
  supplier_product_id: string
  product_url: string | null
  snapshot_id: string
  supplier_variant_id: string
  variant_title: string | null
  sku: string | null
  barcode: string | null
  price: number | string | null
  compare_at_price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  weight: number | string | null
  weight_unit: string | null
  captured_at: string | null
}

export type TargetedLunaPreviousSnapshot = {
  id: string
  source_id: string
  product_id: string
  supplier_variant_id: string
  variant_title: string | null
  sku: string | null
  barcode: string | null
  price: number | string | null
  compare_at_price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  collections: string[] | null
  discount_percent: number | string | null
  weight: number | string | null
  weight_unit: string | null
  raw: JsonRecord | null
  captured_at: string
}

export type ExactTargetedLunaMonitorTarget = {
  marketRadarProductId: string
  sourceId: string
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  productUrl: string
  listingCount: number
  previousSnapshot: TargetedLunaPreviousSnapshot
}

export type TargetedLunaSnapshotInsert = {
  source_id: string
  product_id: string
  supplier_variant_id: string
  variant_title: string
  sku: string
  barcode: string | null
  price: number
  compare_at_price: number | null
  available: boolean
  inventory_quantity: number | null
  collections: string[]
  discount_percent: number | null
  weight: number | null
  weight_unit: string | null
  raw: JsonRecord
  captured_at: string
}

export type TargetedLunaEventInsert = {
  source_id: string
  product_id: string
  supplier_variant_id: string
  event_type: "out_of_stock" | "restocked" | "price_up" | "price_down"
  old_value: JsonRecord
  new_value: JsonRecord
  event_strength: number
  idempotency_key: string
  created_at: string
}

export type TargetedLunaUnavailableReason =
  | "ACTIVE_LISTING_EXACT_LUNA_IDENTITY_REQUIRED"
  | "CURRENT_LUNA_IDENTITY_MISMATCH"
  | "LUNA_PUBLIC_PRODUCT_NETWORK_UNAVAILABLE"
  | "LUNA_PUBLIC_PRODUCT_AUTH_UNAVAILABLE"
  | "LUNA_PUBLIC_PRODUCT_IDENTITY_MISMATCH"
  | "TARGET_LIMIT_REACHED"

type UnavailableObservation = {
  status: "unavailable"
  reason: TargetedLunaUnavailableReason
  marketRadarProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  listingCount: number
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function identityKey(productId: string, variantId: string, sku: string) {
  return JSON.stringify([productId, variantId, sku])
}

function discountPercent(price: number, compareAtPrice: number | null) {
  if (compareAtPrice === null || compareAtPrice <= price || compareAtPrice <= 0) {
    return null
  }
  return Number((((compareAtPrice - price) / compareAtPrice) * 100).toFixed(2))
}

function sameNumeric(left: unknown, right: unknown) {
  const normalizedLeft = numeric(left)
  const normalizedRight = numeric(right)
  return normalizedLeft === normalizedRight
}

/**
 * A successful public Luna read is still a valid heartbeat when nothing
 * changed. Persist a new append-only snapshot only when a listing-relevant
 * value changed, so a frequent active-listing monitor cannot grow the market
 * history with identical rows.
 */
export function targetedLunaSnapshotMateriallyChanged(
  previous: TargetedLunaPreviousSnapshot,
  next: TargetedLunaSnapshotInsert,
) {
  return previous.variant_title !== next.variant_title ||
    previous.sku !== next.sku ||
    previous.barcode !== next.barcode ||
    !sameNumeric(previous.price, next.price) ||
    !sameNumeric(previous.compare_at_price, next.compare_at_price) ||
    previous.available !== next.available ||
    previous.inventory_quantity !== next.inventory_quantity ||
    !sameNumeric(previous.weight, next.weight) ||
    previous.weight_unit !== next.weight_unit
}

function assertPreviewBoundary() {
  if (process.env.VERCEL_ENV !== "preview") {
    throw new Error("TARGETED_ACTIVE_LISTING_LUNA_MONITOR_PREVIEW_ONLY")
  }
}

function publicLunaFetch(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init = {}) => {
    const requestUrl = input instanceof URL
      ? input.toString()
      : typeof input === "string"
        ? input
        : input.url
    const parsed = new URL(requestUrl)
    const headers = new Headers(init.headers)
    const method = (init.method ?? "GET").toUpperCase()
    let exactPublicJsonUrl = false
    if (parsed.pathname.endsWith(".js")) {
      try {
        const productUrl = new URL(parsed.toString())
        productUrl.pathname = parsed.pathname.slice(0, -3)
        const expected = parseDirectedLunaProductUrl(productUrl.toString()).jsonUrl
        exactPublicJsonUrl = parsed.toString() === expected
      } catch {
        exactPublicJsonUrl = false
      }
    }
    if (
      parsed.protocol !== "https:" ||
      !LUNA_HOSTS.has(parsed.hostname) ||
      !exactPublicJsonUrl ||
      method !== "GET" ||
      init.body !== undefined && init.body !== null
    ) {
      throw new Error("TARGETED_LUNA_PUBLIC_REQUEST_REJECTED")
    }
    if (
      headers.has("authorization") ||
      headers.has("cookie") ||
      headers.has("proxy-authorization")
    ) {
      throw new Error("TARGETED_LUNA_PUBLIC_CREDENTIALS_FORBIDDEN")
    }
    return fetchImpl(parsed.toString(), {
      ...init,
      method: "GET",
      headers,
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
}

export async function fetchPublicLunaProductForActiveListingMonitor(
  productUrl: string,
  options: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {},
) {
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 15_000))
  return fetchDirectedLunaProduct(
    productUrl,
    publicLunaFetch(options.fetchImpl ?? fetch, timeoutMs),
  )
}

function eventStrength(type: TargetedLunaEventInsert["event_type"]) {
  if (type === "out_of_stock" || type === "restocked") return 5
  if (type === "price_down") return 4
  return 2
}

function buildEvent(input: {
  target: ExactTargetedLunaMonitorTarget
  type: TargetedLunaEventInsert["event_type"]
  oldValue: JsonRecord
  newValue: JsonRecord
  observedAt: string
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      TARGETED_ACTIVE_LISTING_LUNA_MONITOR_VERSION,
      input.target.marketRadarProductId,
      input.target.supplierVariantId,
      input.target.supplierSku,
      input.type,
      input.target.previousSnapshot.id,
      input.oldValue,
      input.newValue,
    ]))
    .digest("hex")
  return {
    source_id: input.target.sourceId,
    product_id: input.target.marketRadarProductId,
    supplier_variant_id: input.target.supplierVariantId,
    event_type: input.type,
    old_value: input.oldValue,
    new_value: input.newValue,
    event_strength: eventStrength(input.type),
    idempotency_key: `targeted-active-luna-v1:${digest}`,
    created_at: input.observedAt,
  } satisfies TargetedLunaEventInsert
}

export function buildExactTargetedLunaObservation(input: {
  target: ExactTargetedLunaMonitorTarget
  product: DirectedLunaProduct
  observedAt: string
}) {
  const { target, product, observedAt } = input
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error("TARGETED_LUNA_OBSERVED_AT_INVALID")
  }
  const previous = target.previousSnapshot
  if (
    product.productId !== target.supplierProductId ||
    previous.source_id !== target.sourceId ||
    previous.product_id !== target.marketRadarProductId ||
    previous.supplier_variant_id !== target.supplierVariantId ||
    previous.sku !== target.supplierSku
  ) {
    throw new Error("TARGETED_LUNA_IDENTITY_MISMATCH")
  }
  const exactVariants = product.variants.filter((variant) =>
    variant.id === target.supplierVariantId && variant.sku === target.supplierSku)
  if (exactVariants.length !== 1) {
    throw new Error("TARGETED_LUNA_IDENTITY_MISMATCH")
  }
  const variant = exactVariants[0]
  const price = Number(variant.sourceUnitPrice.toFixed(2))
  const compareAtPrice = variant.sourceCompareAtPrice === null
    ? null
    : Number(variant.sourceCompareAtPrice.toFixed(2))
  const inventoryQuantity = variant.available ? null : 0
  const retainedWeightUnit = variant.weightUnit === null &&
    previous.weight_unit !== null &&
    sameNumeric(previous.weight, variant.weight)
    ? previous.weight_unit
    : null
  const weightUnit = variant.weightUnit ?? retainedWeightUnit
  const collections = Array.isArray(previous.collections)
    ? previous.collections.filter((value): value is string => typeof value === "string")
    : []
  const snapshot = {
    source_id: target.sourceId,
    product_id: target.marketRadarProductId,
    supplier_variant_id: target.supplierVariantId,
    variant_title: variant.title,
    sku: target.supplierSku,
    barcode: variant.sourceUnitBarcode,
    price,
    compare_at_price: compareAtPrice,
    available: variant.available,
    inventory_quantity: inventoryQuantity,
    collections,
    discount_percent: discountPercent(price, compareAtPrice),
    weight: variant.weight,
    weight_unit: weightUnit,
    raw: {
      product: {
        id: product.productId,
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        product_type: product.productType,
        product_url: product.canonicalUrl,
      },
      variant: {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        barcode: variant.sourceUnitBarcode,
        price,
        compare_at_price: compareAtPrice,
        available: variant.available,
        weight: variant.weight,
        weight_unit: weightUnit,
      },
      inventory_context: {
        inventory_quantity: inventoryQuantity,
        inventory_status: variant.available ? "in_stock" : "out_of_stock",
        inventory_source: "luna_public_product_json",
        inventory_confidence: "medium",
        inventory_scope: "availability_only",
      },
      targeted_active_listing_monitor: {
        version: TARGETED_ACTIVE_LISTING_LUNA_MONITOR_VERSION,
        observation_status: "available",
        public_data_only: true,
        login_automation_used: false,
        credentials_used: false,
        exact_identity_verified: true,
        previous_snapshot_id: previous.id,
        listing_count: target.listingCount,
        weight_unit_retained_from_previous_exact_snapshot:
          retainedWeightUnit !== null,
      },
    },
    captured_at: observedAt,
  } satisfies TargetedLunaSnapshotInsert

  const events: TargetedLunaEventInsert[] = []
  const previousAvailable = typeof previous.available === "boolean"
    ? previous.available
    : previous.inventory_quantity === 0
      ? false
      : null
  if (previousAvailable !== null && previousAvailable !== snapshot.available) {
    events.push(buildEvent({
      target,
      type: snapshot.available ? "restocked" : "out_of_stock",
      oldValue: {
        available: previousAvailable,
        inventory_quantity: previous.inventory_quantity,
        snapshot_id: previous.id,
      },
      newValue: {
        available: snapshot.available,
        inventory_quantity: snapshot.inventory_quantity,
        observation_source: "luna_public_product_json",
      },
      observedAt,
    }))
  }
  const previousPrice = numeric(previous.price)
  if (previousPrice !== null && previousPrice !== snapshot.price) {
    events.push(buildEvent({
      target,
      type: snapshot.price < previousPrice ? "price_down" : "price_up",
      oldValue: { price: previousPrice, snapshot_id: previous.id },
      newValue: {
        price: snapshot.price,
        observation_source: "luna_public_product_json",
      },
      observedAt,
    }))
  }
  return {
    snapshot,
    events,
    snapshotRequired: targetedLunaSnapshotMateriallyChanged(previous, snapshot),
  }
}

function unavailable(
  reason: TargetedLunaUnavailableReason,
  input: {
    marketRadarProductId?: string | null
    supplierVariantId?: string | null
    supplierSku?: string | null
    listingCount?: number
  } = {},
): UnavailableObservation {
  return {
    status: "unavailable",
    reason,
    marketRadarProductId: input.marketRadarProductId ?? null,
    supplierVariantId: input.supplierVariantId ?? null,
    supplierSku: input.supplierSku ?? null,
    listingCount: input.listingCount ?? 1,
  }
}

function classifyPublicFailure(error: unknown): TargetedLunaUnavailableReason {
  const code = error instanceof Error ? error.message : ""
  if (
    code === "TARGETED_LUNA_PUBLIC_CREDENTIALS_FORBIDDEN" ||
    /LUNA_DIRECTED_IMPORT_FETCH_(401|403)$/.test(code)
  ) {
    return "LUNA_PUBLIC_PRODUCT_AUTH_UNAVAILABLE"
  }
  if (
    code === "TARGETED_LUNA_IDENTITY_MISMATCH" ||
    code === "TARGETED_LUNA_PUBLIC_REQUEST_REJECTED" ||
    /^LUNA_DIRECTED_IMPORT_(?:URL_INVALID|REDIRECT_REJECTED|RESPONSE_TOO_LARGE|RESPONSE_INVALID|PRODUCT_INVALID|VARIANT_REQUIRED)$/.test(code) ||
    /^LUNA_DIRECTED_IMPORT_FETCH_(?:400|404|410|422)$/.test(code)
  ) {
    return "LUNA_PUBLIC_PRODUCT_IDENTITY_MISMATCH"
  }
  return "LUNA_PUBLIC_PRODUCT_NETWORK_UNAVAILABLE"
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ))
  return results
}

export async function runTargetedActiveListingLunaMonitor(
  supabase: SupabaseClient,
  input: {
    accountKey: string
    limit?: number
    concurrency?: number
    timeoutMs?: number
    fetchImpl?: typeof fetch
    now?: Date
  },
) {
  assertPreviewBoundary()
  const accountKey = text(input.accountKey)
  if (!accountKey || accountKey.length > 200) {
    throw new Error("TARGETED_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED")
  }
  const limit = boundedInteger(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const concurrency = boundedInteger(input.concurrency, DEFAULT_CONCURRENCY, 1, 8)
  const observedAt = (input.now ?? new Date()).toISOString()
  const listingRead = await supabase
    .from("ebay_active_listings")
    .select("id,market_radar_product_id,supplier_variant_id,supplier_sku", { count: "exact" })
    .eq("account_key", accountKey)
    .eq("listing_status", "active")
    .order("last_radar_review_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .limit(limit)
  if (listingRead.error) {
    throw new Error("TARGETED_ACTIVE_LISTING_READ_FAILED")
  }
  const listings = (listingRead.data ?? []) as ActiveListingRow[]
  const totalActiveListingRows = listingRead.count ?? listings.length
  if (totalActiveListingRows > listings.length) {
    return {
      version: TARGETED_ACTIVE_LISTING_LUNA_MONITOR_VERSION,
      status: "unavailable" as const,
      observedAt,
      accountScoped: true,
      totalActiveListingRows,
      activeListingRowsSelected: listings.length,
      exactTargetsSelected: 0,
      exactTargetsObserved: 0,
      monitoredListingRows: 0,
      publicProductsFetched: 0,
      snapshotsInserted: 0,
      unchangedTargetsObserved: 0,
      eventsDetected: 0,
      eventsInserted: 0,
      eventWriteStatus: "not_required" as const,
      unavailable: [unavailable("TARGET_LIMIT_REACHED", {
        listingCount: totalActiveListingRows - listings.length,
      })],
      safety: {
        previewOnly: true,
        publicLunaReadsOnly: true,
        loginAutomationUsed: false,
        cookiesOrCredentialsUsed: false,
        fullCatalogScanUsed: false,
        activeListingRegistryReadsUsed: true,
        ebayApiReadsUsed: false,
        ebayApiWritesUsed: false,
        openAiCalls: 0,
        productionChanged: false,
      },
    }
  }
  const unavailableObservations: UnavailableObservation[] = []

  const grouped = new Map<string, {
    marketRadarProductId: string
    supplierVariantId: string
    supplierSku: string
    listingCount: number
  }>()
  for (const listing of listings) {
    const productId = text(listing.market_radar_product_id)
    const variantId = text(listing.supplier_variant_id)
    const sku = text(listing.supplier_sku)
    if (!productId || !variantId || !sku) {
      unavailableObservations.push(unavailable(
        "ACTIVE_LISTING_EXACT_LUNA_IDENTITY_REQUIRED",
        {
          marketRadarProductId: productId,
          supplierVariantId: variantId,
          supplierSku: sku,
        },
      ))
      continue
    }
    const key = identityKey(productId, variantId, sku)
    const current = grouped.get(key)
    if (current) current.listingCount += 1
    else grouped.set(key, {
      marketRadarProductId: productId,
      supplierVariantId: variantId,
      supplierSku: sku,
      listingCount: 1,
    })
  }
  const seeds = [...grouped.values()]
  const productIds = [...new Set(seeds.map((target) => target.marketRadarProductId))]
  const variantIds = [...new Set(seeds.map((target) => target.supplierVariantId))]
  const skus = [...new Set(seeds.map((target) => target.supplierSku))]
  let currentRows: CurrentVariantRow[] = []
  if (seeds.length) {
    const currentRead = await supabase
      .from("market_radar_latest_variants")
      .select("product_id,source_id,source_key,supplier_product_id,product_url,snapshot_id,supplier_variant_id,variant_title,sku,barcode,price,compare_at_price,available,inventory_quantity,weight,weight_unit,captured_at")
      .eq("source_key", "lunaportex")
      .in("product_id", productIds)
      .in("supplier_variant_id", variantIds)
      .in("sku", skus)
      .limit(Math.min(1_000, Math.max(100, seeds.length * 10)))
    if (currentRead.error) {
      throw new Error("TARGETED_CURRENT_LUNA_VARIANTS_READ_FAILED")
    }
    currentRows = (currentRead.data ?? []) as CurrentVariantRow[]
  }

  const currentByIdentity = new Map<string, CurrentVariantRow[]>()
  for (const row of currentRows) {
    if (!row.product_id || !row.supplier_variant_id || !row.sku) continue
    const key = identityKey(row.product_id, row.supplier_variant_id, row.sku)
    const rows = currentByIdentity.get(key) ?? []
    rows.push(row)
    currentByIdentity.set(key, rows)
  }
  const exactCurrentRows: Array<{ seed: typeof seeds[number]; current: CurrentVariantRow }> = []
  for (const seed of seeds) {
    const rows = currentByIdentity.get(identityKey(
      seed.marketRadarProductId,
      seed.supplierVariantId,
      seed.supplierSku,
    )) ?? []
    if (rows.length !== 1 || !rows[0].product_url || !rows[0].snapshot_id) {
      unavailableObservations.push(unavailable("CURRENT_LUNA_IDENTITY_MISMATCH", {
        ...seed,
      }))
      continue
    }
    exactCurrentRows.push({ seed, current: rows[0] })
  }

  const snapshotIds = exactCurrentRows.map(({ current }) => current.snapshot_id)
  let previousRows: TargetedLunaPreviousSnapshot[] = []
  if (snapshotIds.length) {
    const previousRead = await supabase
      .from("market_radar_snapshots")
      .select("id,source_id,product_id,supplier_variant_id,variant_title,sku,barcode,price,compare_at_price,available,inventory_quantity,collections,discount_percent,weight,weight_unit,raw,captured_at")
      .in("id", snapshotIds)
      .limit(snapshotIds.length)
    if (previousRead.error) {
      throw new Error("TARGETED_PREVIOUS_LUNA_SNAPSHOTS_READ_FAILED")
    }
    previousRows = (previousRead.data ?? []) as TargetedLunaPreviousSnapshot[]
  }
  const previousById = new Map(previousRows.map((row) => [row.id, row]))
  const targets: ExactTargetedLunaMonitorTarget[] = []
  for (const { seed, current } of exactCurrentRows) {
    const previous = previousById.get(current.snapshot_id)
    if (
      !previous ||
      previous.source_id !== current.source_id ||
      previous.product_id !== seed.marketRadarProductId ||
      previous.supplier_variant_id !== seed.supplierVariantId ||
      previous.sku !== seed.supplierSku
    ) {
      unavailableObservations.push(unavailable("CURRENT_LUNA_IDENTITY_MISMATCH", {
        ...seed,
      }))
      continue
    }
    targets.push({
      marketRadarProductId: seed.marketRadarProductId,
      sourceId: current.source_id,
      supplierProductId: current.supplier_product_id,
      supplierVariantId: seed.supplierVariantId,
      supplierSku: seed.supplierSku,
      productUrl: current.product_url as string,
      listingCount: seed.listingCount,
      previousSnapshot: previous,
    })
  }

  const fetchCache = new Map<string, Promise<DirectedLunaProduct>>()
  const observations = await mapConcurrent(targets, concurrency, async (target) => {
    try {
      let productFetch = fetchCache.get(target.productUrl)
      if (!productFetch) {
        productFetch = fetchPublicLunaProductForActiveListingMonitor(target.productUrl, {
          fetchImpl: input.fetchImpl,
          timeoutMs: input.timeoutMs,
        })
        fetchCache.set(target.productUrl, productFetch)
      }
      const product = await productFetch
      return {
        status: "available" as const,
        target,
        ...buildExactTargetedLunaObservation({ target, product, observedAt }),
      }
    } catch (error) {
      return {
        status: "unavailable" as const,
        observation: unavailable(classifyPublicFailure(error), {
          marketRadarProductId: target.marketRadarProductId,
          supplierVariantId: target.supplierVariantId,
          supplierSku: target.supplierSku,
          listingCount: target.listingCount,
        }),
      }
    }
  })
  const availableObservations = observations.filter(
    (observation): observation is Extract<typeof observation, { status: "available" }> =>
      observation.status === "available",
  )
  unavailableObservations.push(...observations
    .filter((observation): observation is Extract<typeof observation, { status: "unavailable" }> =>
      observation.status === "unavailable")
    .map((observation) => observation.observation))

  // Persist transition events before advancing the current-snapshot pointer.
  // A failed event write must leave the previous snapshot current so the same
  // transition can be retried. The event key is based on that previous
  // snapshot (not wall-clock time), so a retry cannot duplicate the alert.
  const eventRows = availableObservations.flatMap((observation) => observation.events)
  let eventsInserted = 0
  const eventWriteStatus: "complete" | "not_required" = eventRows.length
    ? "complete"
    : "not_required"
  if (eventRows.length) {
    const eventWrite = await supabase
      .from("market_radar_events")
      .upsert(eventRows, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id")
    if (eventWrite.error) throw new Error("TARGETED_LUNA_EVENT_WRITE_FAILED")
    eventsInserted = eventWrite.data?.length ?? 0
  }

  const changedObservations = availableObservations.filter(
    (observation) => observation.snapshotRequired,
  )
  let snapshotsInserted = 0
  if (changedObservations.length) {
    const snapshotWrite = await supabase
      .from("market_radar_snapshots")
      .insert(changedObservations.map((observation) => observation.snapshot))
      .select("id")
    if (snapshotWrite.error || (snapshotWrite.data ?? []).length !== changedObservations.length) {
      throw new Error("TARGETED_LUNA_SNAPSHOT_WRITE_FAILED")
    }
    snapshotsInserted = snapshotWrite.data?.length ?? 0
  }

  const monitoredListingRows = availableObservations.reduce(
    (count, observation) => count + observation.target.listingCount,
    0,
  )
  const status = totalActiveListingRows === 0
    ? "complete" as const
    : monitoredListingRows === totalActiveListingRows &&
        unavailableObservations.length === 0
      ? "complete" as const
      : monitoredListingRows === 0
        ? "unavailable" as const
        : "partial" as const

  return {
    version: TARGETED_ACTIVE_LISTING_LUNA_MONITOR_VERSION,
    status,
    observedAt,
    accountScoped: true,
    totalActiveListingRows,
    activeListingRowsSelected: listings.length,
    exactTargetsSelected: seeds.length,
    exactTargetsObserved: availableObservations.length,
    monitoredListingRows,
    publicProductsFetched: fetchCache.size,
    snapshotsInserted,
    unchangedTargetsObserved: availableObservations.length - changedObservations.length,
    eventsDetected: eventRows.length,
    eventsInserted,
    eventWriteStatus,
    unavailable: unavailableObservations,
    safety: {
      previewOnly: true,
      publicLunaReadsOnly: true,
      loginAutomationUsed: false,
      cookiesOrCredentialsUsed: false,
      fullCatalogScanUsed: false,
      activeListingRegistryReadsUsed: true,
      ebayApiReadsUsed: false,
      ebayApiWritesUsed: false,
      openAiCalls: 0,
      productionChanged: false,
    },
  }
}
