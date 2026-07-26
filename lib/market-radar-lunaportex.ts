import { createHash } from "node:crypto"
import {
  type SupabaseClient,
} from "@supabase/supabase-js"
import {
  type MarketRadarEventType,
  type MarketRadarSyncResult,
} from "@/lib/market-radar-types"
import {
  buildLunaCatalogResumeState,
  buildLunaCatalogCoverageManifest,
  buildLunaSnapshotIngestionKey,
  evaluateLunaCatalogExecutionWindow,
  evaluateLunaCollectionCoverage,
  isRetryableLunaStatus,
  LUNA_CATALOG_COVERAGE_MANIFEST_VERSION,
  LUNA_CATALOG_HYDRATION_CURSOR_VERSION,
  LUNA_SNAPSHOT_INGESTION_POLICY_VERSION,
  lunaCatalogChecksum,
  lunaRetryDelayMs,
  mergeLunaVariantSets,
  safeLunaCatalogErrorCode,
  selectLunaRoundRobinWindow,
  type LunaCatalogCollectionCoverage,
  type LunaCatalogPageCheckpoint,
  type LunaCatalogPersistedPage,
} from "@/lib/market-radar/luna-catalog-coverage-domain"

const LUNAPORTEX_SOURCE_KEY =
  "lunaportex"

const LUNAPORTEX_BASE_URL =
  "https://lunaportex.com"

const LUNAPORTEX_COLLECTIONS = [
  "products",
  "flash-sale",
  "weekly-deals",
  "out-of-stock",
]

const LUNAPORTEX_AUTH_COOKIE =
  process.env.LUNAPORTEX_AUTH_COOKIE?.trim() ||
  ""

const SHOPIFY_PAGE_LIMIT = 250
const SHOPIFY_MAX_PAGES = 30
const SHOPIFY_PAGE_DELAY_MS = 250
const SHOPIFY_AUTH_PRODUCT_CONCURRENCY = 6
const SHOPIFY_AUTH_PRODUCT_LIMIT = 24
const LUNA_CATALOG_HTTP_MAX_ATTEMPTS = 3
const LUNA_CATALOG_DEFAULT_TIME_BUDGET_MS = 42_000
const LUNA_CATALOG_DEFAULT_PAGE_BUDGET = 4
const LUNA_CATALOG_MINIMUM_REMAINING_MS = 5_000
const LUNA_CATALOG_REQUEST_TIMEOUT_MS = 8_000
const POSTGREST_FILTER_CHUNK_SIZE = 100
const PRODUCT_WRITE_BATCH_SIZE = 25
const SNAPSHOT_WRITE_BATCH_SIZE = 50
const EVENT_WRITE_BATCH_SIZE = 50
const SCORE_WRITE_BATCH_SIZE = 50
const MINIMUM_ADAPTIVE_BATCH_SIZE = 5
const SNAPSHOT_PERSISTENCE_MINIMUM_REMAINING_MS =
  5_000

type MarketRadarSyncStage =
  | "PRODUCT_UPSERT"
  | "SNAPSHOT_INSERT"
  | "EVENT_UPSERT"
  | "SCORE_UPSERT"

type AdaptiveBatchTelemetry = {
  adaptiveRetryCount: number
  failedBatchCount: number
  smallestSuccessfulBatchSize: number | null
}

function isStatementTimeoutError(
  error: unknown
) {
  const typedError =
    error as {
      code?: string
      message?: string
    } | null
  const message =
    typedError?.message?.toLowerCase() || ""

  return (
    typedError?.code === "57014" ||
    message.includes(
      "canceling statement due to statement timeout"
    )
  )
}

async function executeAdaptiveBatches<T>({ rows, batchSize, stage, telemetry, execute }: {
  rows: T[]
  batchSize: number
  stage: MarketRadarSyncStage
  telemetry: AdaptiveBatchTelemetry
  execute: (batch: T[]) => Promise<void>
}) {
  const executeBatch = async (batch: T[]): Promise<void> => {
    try {
      await execute(batch)
      telemetry.smallestSuccessfulBatchSize = telemetry.smallestSuccessfulBatchSize === null
        ? batch.length
        : Math.min(telemetry.smallestSuccessfulBatchSize, batch.length)
    } catch (error) {
      if (!isStatementTimeoutError(error)) {
        throw new Error(`${stage}_FAILED: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (batch.length <= MINIMUM_ADAPTIVE_BATCH_SIZE) {
        telemetry.failedBatchCount += 1
        throw new Error(`${stage}_TIMEOUT: ${error instanceof Error ? error.message : String(error)}`)
      }
      telemetry.adaptiveRetryCount += 1
      const midpoint = Math.ceil(batch.length / 2)
      await executeBatch(batch.slice(0, midpoint))
      await executeBatch(batch.slice(midpoint))
    }
  }

  for (const batch of chunkArray(rows, batchSize)) {
    await executeBatch(batch)
  }
}

type ShopifyVariant = {
  id?: number | string | null
  title?: string | null
  sku?: string | null
  barcode?: string | null
  grams?: number | string | null
  weight?: number | string | null
  weight_unit?: string | null
  price?: string | number | null
  compare_at_price?: string | number | null
  available?: boolean | null
  inventory_quantity?: number | null
  inventoryQuantity?: number | string | null
  available_quantity?: number | string | null
  availableQuantity?: number | string | null
  quantity?: number | string | null
  qty?: number | string | null
  stock?: number | string | null
  inventory?: number | string | null
  product_available_quantity?: number | null
  inventory_scope?:
    | "variant_level"
    | "product_level"
    | "product_or_category_signal"
    | "availability_only"
    | "unknown"
    | null
  inventory_source?:
    | "luna_authenticated_html"
    | "luna_authenticated_html_product"
    | null
}

type ShopifyImage = {
  src?: string | null
}

type ShopifyProduct = {
  id?: number | string | null
  title?: string | null
  handle?: string | null
  body_html?: string | null
  vendor?: string | null
  product_type?: string | null
  tags?: string[] | string | null
  created_at?: string | null
  updated_at?: string | null
  published_at?: string | null
  image?: ShopifyImage | null
  images?: ShopifyImage[] | null
  variants?: ShopifyVariant[] | null
}

type ShopifyProductsResponse = {
  products?: ShopifyProduct[]
}

type ShopifyProductResponse =
  | ShopifyProduct
  | {
      product?: ShopifyProduct
    }

type AggregatedProduct = ShopifyProduct & {
  collections: Set<string>
  sourceObservedAt: string
  fetchedAt: string
}

type MarketRadarSourceRecord = {
  id: string
  key: string
}

type MarketRadarProductRecord = {
  id: string
  supplier_product_id: string
  handle: string
}

type LatestSnapshotRecord = {
  product_id: string
  supplier_variant_id: string
  price: number | string | null
  compare_at_price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  collections: string[] | null
  captured_at: string
}

type SnapshotInsert = {
  source_id: string
  product_id: string
  supplier_variant_id: string
  variant_title: string | null
  sku: string | null
  barcode: string | null
  weight: number | null
  weight_unit: string | null
  price: number | null
  compare_at_price: number | null
  available: boolean | null
  inventory_quantity: number | null
  collections: string[]
  discount_percent: number | null
  raw: Record<string, unknown>
  captured_at: string
  catalog_scan_run_id?: string
  source_observed_at?: string
  fetched_at?: string
  snapshot_fingerprint?: string
  snapshot_ingestion_key?: string
}

type EventInsert = {
  source_id: string
  product_id: string
  supplier_variant_id: string
  event_type: MarketRadarEventType
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  event_strength: number
  idempotency_key: string
  created_at: string
}

type EventAggregateRow = {
  product_id: string
  event_type: MarketRadarEventType
  created_at: string
}

type InventoryHydrationMetrics = {
  enabled: boolean
  candidates: number
  hydratedProducts: number
  successfulFetches: number
  failedFetches: number
  productsWithoutNumericInventory: number
  checkedProducts: number
  authState:
    | "approved"
    | "restricted"
    | "unknown"
    | "not_configured"
  authMessage: string
  authCheckedHandle: string | null
  startCursor: number
  nextCursor: number
  catalogFingerprint: string | null
}

type LunaPortexProductFetchResult = {
  products: AggregatedProduct[]
  inventoryHydration: InventoryHydrationMetrics
  catalogCoverage: ReturnType<typeof buildLunaCatalogCoverageManifest>
  catalogScanRunId: string | null
  catalogContinuationRequired: boolean
  catalogPagesProcessed: number
  catalogPauseReason:
    | "PAGE_LIMIT"
    | "DEADLINE"
    | "FETCH_RETRY_REQUIRED"
    | null
}

type LunaCatalogExecutionWindow = {
  deadlineAtMs: number
  maxPages: number
  pagesProcessed: number
}

export function getLunaCatalogCoverageRuntimeConfiguration() {
  const enabled =
    process.env.LUNA_CATALOG_COVERAGE_V1_ENABLED?.trim().toLowerCase() === "true"
  return {
    enabled,
    mode:
      process.env.LUNA_CATALOG_COVERAGE_V1_MODE?.trim().toUpperCase() === "ENFORCED"
        ? "ENFORCED" as const
        : "SHADOW" as const,
    manifestVersion:
      LUNA_CATALOG_COVERAGE_MANIFEST_VERSION,
    hydrationPolicyVersion:
      LUNA_CATALOG_HYDRATION_CURSOR_VERSION,
  }
}

function buildLunaSnapshotBatchKey(
  catalogScanRunId: string,
  batchOrdinal: number
) {
  return createHash("sha256")
    .update([
      catalogScanRunId,
      LUNA_SNAPSHOT_INGESTION_POLICY_VERSION,
      String(batchOrdinal),
    ].join("|"))
    .digest("hex")
}

function wait(
  ms: number
) {
  return new Promise(resolve =>
    setTimeout(
      resolve,
      ms
    )
  )
}

function chunkArray<T>(
  values: T[],
  size: number
) {
  const chunks: T[][] = []

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(
        index,
        index + size
      )
    )
  }

  return chunks
}

function getString(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function getNumber(
  value: unknown
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

const SUSPICIOUS_HTML_INVENTORY_QUANTITY =
  10000

function getInteger(
  value: unknown
) {
  const numericValue =
    getNumber(value)

  if (numericValue === null) {
    return null
  }

  return Math.trunc(numericValue)
}

function getLunaPortexRequestHeaders() {
  const headers: Record<string, string> = {
    Accept:
      "application/json",
    "User-Agent":
      "IMNOVA-Market-Radar/1.0",
  }

  if (LUNAPORTEX_AUTH_COOKIE) {
    headers.Cookie =
      LUNAPORTEX_AUTH_COOKIE
  }

  return headers
}

function hasVariantInventoryQuantity(
  variant: ShopifyVariant
) {
  return getVariantInventoryQuantity(
    variant
  ) !== null
}

function getVariantInventoryQuantity(
  variant: ShopifyVariant
) {
  return getInteger(
    variant.inventory_quantity ??
      variant.inventoryQuantity ??
      variant.available_quantity ??
      variant.availableQuantity ??
      variant.quantity ??
      variant.qty ??
      variant.stock ??
      variant.inventory
  )
}

function getNormalizedVariantInventory(
  variant: ShopifyVariant
) {
  const inventoryQuantity =
    getVariantInventoryQuantity(
      variant
    )

  if (
    inventoryQuantity !== null &&
    variant.inventory_source === "luna_authenticated_html" &&
    inventoryQuantity >=
      SUSPICIOUS_HTML_INVENTORY_QUANTITY
  ) {
    return {
      inventory_quantity:
        null,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      product_available_quantity:
        inventoryQuantity,
    } as const
  }

  if (inventoryQuantity !== null) {
    return {
      inventory_quantity:
        inventoryQuantity,
      inventory_status:
        inventoryQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        variant.inventory_source === "luna_authenticated_html"
          ? "luna_authenticated_html"
          : "luna_numeric",
      inventory_confidence:
        "high",
      inventory_scope:
        "variant_level",
      product_available_quantity:
        getInteger(
          variant.product_available_quantity
        ),
    } as const
  }

  const productAvailableQuantity =
    getInteger(
      variant.product_available_quantity
    )

  if (
    productAvailableQuantity !== null &&
    (
      variant.inventory_scope === "product_or_category_signal" ||
      productAvailableQuantity >=
        SUSPICIOUS_HTML_INVENTORY_QUANTITY
    )
  ) {
    return {
      inventory_quantity:
        null,
      inventory_status:
        productAvailableQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      product_available_quantity:
        productAvailableQuantity,
    } as const
  }

  if (productAvailableQuantity !== null) {
    return {
      inventory_quantity:
        null,
      inventory_status:
        productAvailableQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html_product",
      inventory_confidence:
        "medium",
      inventory_scope:
        "product_level",
      product_available_quantity:
        productAvailableQuantity,
    } as const
  }

  if (variant.available === false) {
    return {
      inventory_quantity:
        0,
      inventory_status:
        "out_of_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      product_available_quantity:
        null,
    } as const
  }

  if (variant.available === true) {
    return {
      inventory_quantity:
        null,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      product_available_quantity:
        null,
    } as const
  }

  return {
    inventory_quantity:
      null,
    inventory_status:
      "unknown",
    inventory_source:
      "not_exposed",
    inventory_confidence:
      "low",
    inventory_scope:
      "unknown",
    product_available_quantity:
      null,
  } as const
}

function shouldHydrateProductInventory(
  product: AggregatedProduct
) {
  return Boolean(
    LUNAPORTEX_AUTH_COOKIE &&
    getString(product.handle) &&
    product.variants?.some(
      variant =>
        !hasVariantInventoryQuantity(
          variant
        )
    )
  )
}

function mergeAuthenticatedVariantInventory(
  product: AggregatedProduct,
  authenticatedProduct: ShopifyProduct
) {
  const authenticatedVariants =
    authenticatedProduct.variants || []

  if (authenticatedVariants.length === 0) {
    return false
  }

  const authenticatedById =
    new Map(
      authenticatedVariants.map(variant => [
        String(variant.id || ""),
        variant,
      ])
    )

  const authenticatedBySku =
    new Map(
      authenticatedVariants
        .filter(variant =>
          Boolean(getString(variant.sku))
        )
        .map(variant => [
          getString(variant.sku),
          variant,
        ])
    )

  let changed =
    false

  product.variants =
    (product.variants || []).map(variant => {
      const authenticatedVariant =
        authenticatedById.get(
          String(variant.id || "")
        ) ||
        authenticatedBySku.get(
          getString(variant.sku)
        )

      if (
        !authenticatedVariant ||
        !hasVariantInventoryQuantity(
          authenticatedVariant
        )
      ) {
        return variant
      }

      changed =
        true

      return {
        ...variant,
        inventory_quantity:
          getVariantInventoryQuantity(
            authenticatedVariant
          ),
      }
    })

  return changed
}

function getAuthenticatedHtmlInventoryQuantity(
  html: string
) {
  const inventoryMatch =
    html.match(
      /(\d[\d,]*)\s+units\s+available/i
    )

  if (!inventoryMatch) {
    return null
  }

  return getInteger(
    inventoryMatch[1].replace(
      /,/g,
      ""
    )
  )
}

function mergeAuthenticatedHtmlInventory(
  product: AggregatedProduct,
  html: string
) {
  const inventoryQuantity =
    getAuthenticatedHtmlInventoryQuantity(
      html
    )

  if (inventoryQuantity === null) {
    return false
  }

  const variants =
    product.variants || []

  if (variants.length === 0) {
    return false
  }

  product.variants =
    variants.map(variant =>
      variants.length === 1 &&
      inventoryQuantity <
        SUSPICIOUS_HTML_INVENTORY_QUANTITY
        ? {
            ...variant,
            inventory_quantity:
              inventoryQuantity,
            product_available_quantity:
              inventoryQuantity,
            inventory_scope:
              "variant_level",
            inventory_source:
              "luna_authenticated_html",
          }
        : {
            ...variant,
            product_available_quantity:
              inventoryQuantity,
            inventory_scope:
              "product_or_category_signal",
            inventory_source:
              "luna_authenticated_html",
          }
    )

  return true
}

function normalizeAuthenticatedProductPayload(
  payload: ShopifyProductResponse
) {
  if (
    "product" in payload &&
    payload.product
  ) {
    return payload.product
  }

  return payload as ShopifyProduct
}

function normalizeTags(
  tags: ShopifyProduct["tags"]
) {
  if (Array.isArray(tags)) {
    return tags
      .map(getString)
      .filter(Boolean)
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map(getString)
      .filter(Boolean)
  }

  return []
}

function normalizeImageUrls(
  product: ShopifyProduct
) {
  return Array.from(
    new Set(
      [
        product.image?.src,
        ...(product.images || [])
          .map(image => image.src),
      ]
        .map(getString)
        .filter(Boolean)
    )
  )
}

function getSnapshotRawProduct(
  product: AggregatedProduct
) {
  const imageUrls =
    normalizeImageUrls(product)

  const handle =
    getString(product.handle)

  return {
    id:
      product.id || null,
    title:
      getString(product.title) || null,
    handle:
      handle || null,
    product_url:
      handle
        ? `${LUNAPORTEX_BASE_URL}/products/${handle}`
        : null,
    featured_image_url:
      imageUrls[0] || null,
    image_urls:
      imageUrls,
    vendor:
      getString(product.vendor) || null,
    product_type:
      getString(product.product_type) || null,
    tags:
      normalizeTags(product.tags),
    collections:
      Array.from(product.collections).sort(),
    updated_at:
      getString(product.updated_at) || null,
  }
}

function getDiscountPercent(
  price: number | null,
  compareAtPrice: number | null
) {
  if (
    price === null ||
    compareAtPrice === null ||
    compareAtPrice <= 0 ||
    compareAtPrice <= price
  ) {
    return null
  }

  return Number(
    (
      ((compareAtPrice - price) /
        compareAtPrice) *
      100
    ).toFixed(2)
  )
}

function hasDiscount(
  price: number | null,
  compareAtPrice: number | null
) {
  return getDiscountPercent(
    price,
    compareAtPrice
  ) !== null
}

function getCollectionDiff(
  previousCollections: string[],
  currentCollections: string[]
) {
  const previousSet =
    new Set(previousCollections)

  const currentSet =
    new Set(currentCollections)

  return {
    entered:
      currentCollections.filter(
        collection =>
          !previousSet.has(collection)
      ),
    exited:
      previousCollections.filter(
        collection =>
          !currentSet.has(collection)
      ),
  }
}

function getEventStrength(
  eventType: MarketRadarEventType
) {
  if (
    eventType === "restocked" ||
    eventType === "out_of_stock"
  ) {
    return 5
  }

  if (
    eventType === "price_down" ||
    eventType === "entered_collection"
  ) {
    return 4
  }

  if (
    eventType === "discount_started" ||
    eventType === "new_product"
  ) {
    return 3
  }

  return 2
}

function createEvent(
  sourceId: string,
  productId: string,
  supplierVariantId: string,
  eventType: MarketRadarEventType,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
  capturedAt: string
): EventInsert {
  const idempotencyParts = [
    LUNAPORTEX_SOURCE_KEY,
    productId,
    supplierVariantId,
    eventType,
    capturedAt,
    JSON.stringify(newValue || {}),
  ]

  return {
    source_id:
      sourceId,
    product_id:
      productId,
    supplier_variant_id:
      supplierVariantId,
    event_type:
      eventType,
    old_value:
      oldValue,
    new_value:
      newValue,
    event_strength:
      getEventStrength(eventType),
    idempotency_key:
      Buffer
        .from(
          idempotencyParts.join("|")
        )
        .toString("base64")
        .slice(0, 180),
    created_at:
      capturedAt,
  }
}

type LunaCollectionFetchResult = {
  products: ShopifyProduct[]
  coverage: LunaCatalogCollectionCoverage
  sourceObservedAt: string
  fetchedAt: string
  traversalComplete: boolean
  pauseReason:
    | "PAGE_LIMIT"
    | "DEADLINE"
    | "FETCH_RETRY_REQUIRED"
    | null
}

type LunaCollectionFetchOptions = {
  startPage?: number
  resumedProducts?: ShopifyProduct[]
  resumedPages?: LunaCatalogPageCheckpoint[]
  expectedTotal?: number | null
  resumeTerminal?: boolean
  executionWindow?: LunaCatalogExecutionWindow
  onPageCheckpoint?: (input: {
    checkpoint: LunaCatalogPageCheckpoint
    products: ShopifyProduct[]
    expectedTotal: number | null
  }) => Promise<void>
}

function sourceObservedAtFromResponse(
  response: Response,
  fetchedAt: string
) {
  const sourceDate =
    response.headers.get("date")
  return sourceDate &&
    Number.isFinite(Date.parse(sourceDate))
    ? new Date(sourceDate).toISOString()
    : fetchedAt
}

async function fetchCollectionProducts(
  collection: string,
  options: LunaCollectionFetchOptions = {}
): Promise<LunaCollectionFetchResult> {
  const products: ShopifyProduct[] = [
    ...(options.resumedProducts || []),
  ]
  const pages: LunaCatalogPageCheckpoint[] = [
    ...(options.resumedPages || []),
  ]
  let expectedTotal: number | null =
    options.expectedTotal ?? null
  let traversalComplete =
    options.resumeTerminal === true
  let pauseReason:
    | "PAGE_LIMIT"
    | "DEADLINE"
    | "FETCH_RETRY_REQUIRED"
    | null =
      null

  for (
    let page = Math.max(
      1,
      options.startPage || 1
    );
    page <= SHOPIFY_MAX_PAGES;
    page += 1
  ) {
    if (options.executionWindow) {
      const executionDecision =
        evaluateLunaCatalogExecutionWindow({
          nowMs:
            Date.now(),
          deadlineAtMs:
            options.executionWindow.deadlineAtMs,
          pagesProcessed:
            options.executionWindow.pagesProcessed,
          maxPages:
            options.executionWindow.maxPages,
          minimumRemainingMs:
            LUNA_CATALOG_MINIMUM_REMAINING_MS,
        })
      if (!executionDecision.canStartNextPage) {
        pauseReason =
          executionDecision.reason
        break
      }
    }
    const url =
      `${LUNAPORTEX_BASE_URL}/collections/${collection}/products.json?limit=${SHOPIFY_PAGE_LIMIT}&page=${page}`

    let response: Response | null = null
    let payload: ShopifyProductsResponse = {}
    let attempts = 0
    let errorCode: string | null = null
    let fetchedAt = new Date().toISOString()
    let sourceObservedAt = fetchedAt

    while (attempts < LUNA_CATALOG_HTTP_MAX_ATTEMPTS) {
      const executionDecision =
        options.executionWindow
          ? evaluateLunaCatalogExecutionWindow({
              nowMs:
                Date.now(),
              deadlineAtMs:
                options.executionWindow.deadlineAtMs,
              pagesProcessed:
                options.executionWindow.pagesProcessed,
              maxPages:
                options.executionWindow.maxPages,
              minimumRemainingMs:
                LUNA_CATALOG_MINIMUM_REMAINING_MS,
            })
          : null
      if (
        executionDecision &&
        !executionDecision.canStartNextPage
      ) {
        pauseReason =
          executionDecision.reason
        break
      }
      attempts += 1
      try {
        const requestTimeoutMs =
          executionDecision
            ? Math.max(
                1,
                Math.min(
                  LUNA_CATALOG_REQUEST_TIMEOUT_MS,
                  executionDecision.remainingMs -
                    LUNA_CATALOG_MINIMUM_REMAINING_MS
                )
              )
            : LUNA_CATALOG_REQUEST_TIMEOUT_MS
        response = await fetch(
          url,
          {
            headers:
              getLunaPortexRequestHeaders(),
            cache:
              "no-store",
            signal:
              AbortSignal.timeout(
                requestTimeoutMs
              ),
          }
        )
        fetchedAt = new Date().toISOString()
        sourceObservedAt =
          sourceObservedAtFromResponse(
            response,
            fetchedAt
          )
        if (response.ok) {
          payload =
            await response.json() as ShopifyProductsResponse
          errorCode = null
          break
        }
        errorCode =
          `LUNA_CATALOG_HTTP_${response.status}`
        if (
          !isRetryableLunaStatus(response.status) ||
          attempts >= LUNA_CATALOG_HTTP_MAX_ATTEMPTS
        ) {
          break
        }
        await wait(
          lunaRetryDelayMs({
            attempt:
              attempts - 1,
            retryAfter:
              response.headers.get("retry-after"),
          })
        )
      } catch (error) {
        errorCode =
          safeLunaCatalogErrorCode(error)
        if (
          attempts >=
          LUNA_CATALOG_HTTP_MAX_ATTEMPTS
        ) {
          break
        }
        await wait(
          lunaRetryDelayMs({
            attempt:
              attempts - 1,
          })
        )
      }
    }

    if (pauseReason) {
      break
    }
    if (options.executionWindow) {
      const postRequestDecision =
        evaluateLunaCatalogExecutionWindow({
          nowMs:
            Date.now(),
          deadlineAtMs:
            options.executionWindow.deadlineAtMs,
          pagesProcessed:
            options.executionWindow.pagesProcessed,
          maxPages:
            options.executionWindow.maxPages,
          minimumRemainingMs:
            LUNA_CATALOG_MINIMUM_REMAINING_MS,
        })
      if (
        !postRequestDecision.canStartNextPage &&
        postRequestDecision.reason === "DEADLINE"
      ) {
        pauseReason =
          postRequestDecision.reason
        break
      }
    }
    const pageProducts =
      errorCode
        ? []
        : payload.products || []
    const identityKeys =
      pageProducts.map(product =>
        `${String(product.id || "")}:${getString(product.handle)}`
      )
    const uniqueIdentityKeys =
      new Set(
        identityKeys.filter(key =>
          !key.startsWith(":") &&
          !key.endsWith(":")
        )
      )
    const headerExpectedTotal =
      response
        ? getInteger(
            response.headers.get("x-total-count")
          )
        : null
    if (headerExpectedTotal !== null) {
      expectedTotal =
        headerExpectedTotal
    }
    const checkpoint: LunaCatalogPageCheckpoint = {
      collection,
      page,
      pageLimit:
        SHOPIFY_PAGE_LIMIT,
      maxPages:
        SHOPIFY_MAX_PAGES,
      receivedProducts:
        pageProducts.length,
      uniqueProducts:
        uniqueIdentityKeys.size,
      uniqueVariants:
        pageProducts.reduce(
          (sum, product) =>
            sum + (product.variants?.length || 0),
          0
        ),
      missingIdentityCount:
        identityKeys.length -
        uniqueIdentityKeys.size,
      duplicateProductCount:
        Math.max(
          0,
          pageProducts.length -
          uniqueIdentityKeys.size
        ),
      collisionCount:
        0,
      attempts,
      sourceObservedAt,
      fetchedAt,
      checksum:
        lunaCatalogChecksum(
          identityKeys.sort()
        ),
      etag:
        response?.headers.get("etag") || null,
      errorCode,
    }
    pages.push(checkpoint)
    await options.onPageCheckpoint?.({
      checkpoint,
      products:
        pageProducts,
      expectedTotal,
    })
    if (options.executionWindow) {
      options.executionWindow.pagesProcessed += 1
    }

    if (errorCode) {
      pauseReason =
        "FETCH_RETRY_REQUIRED"
      break
    }

    if (pageProducts.length === 0) {
      traversalComplete =
        true
      break
    }

    products.push(
      ...pageProducts
    )

    if (
      pageProducts.length <
      SHOPIFY_PAGE_LIMIT
    ) {
      traversalComplete =
        true
      break
    }

    if (page >= SHOPIFY_MAX_PAGES) {
      traversalComplete =
        true
      break
    }

    await wait(
      SHOPIFY_PAGE_DELAY_MS
    )
  }

  const coverage =
    evaluateLunaCollectionCoverage({
      collection,
      expectedTotal,
      pages,
    })
  return {
    products,
    coverage,
    sourceObservedAt:
      coverage.sourceObservedAt,
    fetchedAt:
      coverage.fetchedAt,
    traversalComplete,
    pauseReason,
  }
}

async function fetchAuthenticatedProductInventory(
  handle: string
) {
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return null
  }

  const response =
    await fetch(
      `${LUNAPORTEX_BASE_URL}/products/${handle}.js`,
      {
        headers:
          getLunaPortexRequestHeaders(),
        cache:
          "no-store",
      }
    )

  if (!response.ok) {
    console.warn(
      "LUNA PORTEX AUTH PRODUCT INVENTORY FETCH WARNING:",
      {
        handle,
        status:
          response.status,
      }
    )

    return null
  }

  const payload =
    await response.json() as ShopifyProductResponse

  return normalizeAuthenticatedProductPayload(
    payload
  )
}

async function fetchAuthenticatedProductHtml(
  handle: string
) {
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return null
  }

  const headers =
    getLunaPortexRequestHeaders()

  headers.Accept =
    "text/html"

  const response =
    await fetch(
      `${LUNAPORTEX_BASE_URL}/products/${handle}`,
      {
        headers,
        cache:
          "no-store",
      }
    )

  if (!response.ok) {
    console.warn(
      "LUNA PORTEX AUTH PRODUCT HTML INVENTORY FETCH WARNING:",
      {
        handle,
        status:
          response.status,
      }
    )

    return null
  }

  return response.text()
}

async function getLunaPortexAuthState(
  handle: string
) {
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return {
      authState:
        "not_configured",
      authMessage:
        "Cookie Luna no configurada. Actualizar LUNAPORTEX_AUTH_COOKIE para ver inventario autenticado.",
      authCheckedHandle:
        null,
    } as const
  }

  if (!handle) {
    return {
      authState:
        "unknown",
      authMessage:
        "No hubo producto de muestra para validar la sesión Luna.",
      authCheckedHandle:
        null,
    } as const
  }

  try {
    const headers =
      getLunaPortexRequestHeaders()

    headers.Accept =
      "text/html"

    const response =
      await fetch(
        `${LUNAPORTEX_BASE_URL}/products/${handle}`,
        {
          headers,
          cache:
            "no-store",
        }
      )

    if (!response.ok) {
      return {
        authState:
          "unknown",
        authMessage:
          `No se pudo validar sesión Luna. Status ${response.status}.`,
        authCheckedHandle:
          handle,
      } as const
    }

    const html =
      await response.text()

    if (/Access Restricted/i.test(html)) {
      return {
        authState:
          "restricted",
        authMessage:
          "Cookie Luna vencida o sin aprobación. Actualizar LUNAPORTEX_AUTH_COOKIE con una sesión aprobada.",
        authCheckedHandle:
          handle,
      } as const
    }

    if (
      /"customerId"\s*:\s*\d+/.test(html) ||
      /customerId["']?\s*:\s*\d+/.test(html)
    ) {
      return {
        authState:
          "approved",
        authMessage:
          "Sesión Luna aprobada para inventario autenticado.",
        authCheckedHandle:
          handle,
      } as const
    }

    return {
      authState:
        "unknown",
      authMessage:
        "Luna respondió, pero no se pudo confirmar si la sesión está aprobada.",
      authCheckedHandle:
        handle,
    } as const
  } catch (error) {
    return {
      authState:
        "unknown",
      authMessage:
        error instanceof Error
          ? `No se pudo validar sesión Luna: ${error.message}`
          : "No se pudo validar sesión Luna.",
      authCheckedHandle:
        handle,
    } as const
  }
}

async function hydrateAuthenticatedInventoryQuantities(
  products: AggregatedProduct[],
  startCursor = 0
): Promise<LunaPortexProductFetchResult> {
  const emptyCoverage =
    buildLunaCatalogCoverageManifest({
      collections: [],
      uniqueProducts:
        products.length,
      uniqueVariants:
        products.reduce(
          (sum, product) =>
            sum + (product.variants?.length || 0),
          0
        ),
    })
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return {
      products,
      catalogCoverage:
        emptyCoverage,
      catalogScanRunId:
        null,
      catalogContinuationRequired:
        false,
      catalogPagesProcessed:
        0,
      catalogPauseReason:
        null,
      inventoryHydration: {
        enabled:
          false,
        candidates:
          0,
        hydratedProducts:
          0,
        successfulFetches:
          0,
        failedFetches:
          0,
        productsWithoutNumericInventory:
          0,
        checkedProducts:
          products.length,
        authState:
          "not_configured",
        authMessage:
          "Cookie Luna no configurada. Actualizar LUNAPORTEX_AUTH_COOKIE para ver inventario autenticado.",
        authCheckedHandle:
          null,
        startCursor:
          0,
        nextCursor:
          0,
        catalogFingerprint:
          null,
      },
    }
  }

  const hydrationCandidates =
    products
      .filter(shouldHydrateProductInventory)
  const catalogFingerprint =
    lunaCatalogChecksum(
      hydrationCandidates.map(product =>
        `${String(product.id || "")}:${getString(product.handle)}`
      ).sort()
    )
  const hydrationWindow =
    selectLunaRoundRobinWindow({
      candidates:
        hydrationCandidates,
      cursor:
        startCursor,
      limit:
        SHOPIFY_AUTH_PRODUCT_LIMIT,
      key:
        product =>
          `${String(product.id || "")}:${getString(product.handle)}`,
    })
  const productsToHydrate =
    hydrationWindow.selected

  const authState =
    await getLunaPortexAuthState(
      getString(
        productsToHydrate[0]?.handle ||
          products[0]?.handle
      )
    )

  let hydratedProducts =
    0

  let successfulFetches =
    0

  let failedFetches =
    0

  let productsWithoutNumericInventory =
    0

  let nextProductIndex =
    0

  async function hydrateNextProduct() {
    while (
      nextProductIndex <
      productsToHydrate.length
    ) {
      const product =
        productsToHydrate[nextProductIndex]

      nextProductIndex += 1

      const handle =
        getString(product.handle)

      try {
        const authenticatedProduct =
          await fetchAuthenticatedProductInventory(
            handle
          )

        if (authenticatedProduct) {
          successfulFetches += 1

          if (
            mergeAuthenticatedVariantInventory(
              product,
              authenticatedProduct
            )
          ) {
            hydratedProducts += 1
          } else {
            if (authState.authState === "approved") {
              const authenticatedHtml =
                await fetchAuthenticatedProductHtml(
                  handle
                )

              if (
                authenticatedHtml &&
                mergeAuthenticatedHtmlInventory(
                  product,
                  authenticatedHtml
                )
              ) {
                hydratedProducts += 1
              } else {
                productsWithoutNumericInventory += 1
              }
            } else {
              productsWithoutNumericInventory += 1
            }
          }
        } else {
          failedFetches += 1
        }
      } catch (error) {
        failedFetches += 1

        console.warn(
          "LUNA PORTEX AUTH INVENTORY HYDRATION WARNING:",
          {
            handle,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          }
        )
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            SHOPIFY_AUTH_PRODUCT_CONCURRENCY,
            productsToHydrate.length
          ),
      },
      () => hydrateNextProduct()
    )
  )

  console.log(
    "LUNA PORTEX AUTH INVENTORY HYDRATION:",
    {
      enabled: true,
      hydratedProducts,
      successfulFetches,
      failedFetches,
      productsWithoutNumericInventory,
      hydrationLimit:
        SHOPIFY_AUTH_PRODUCT_LIMIT,
      hydrationCandidates:
        productsToHydrate.length,
      checkedProducts:
        products.length,
      authState:
        authState.authState,
    }
  )

  return {
    products,
    catalogCoverage:
      emptyCoverage,
    catalogScanRunId:
      null,
    catalogContinuationRequired:
      false,
    catalogPagesProcessed:
      0,
    catalogPauseReason:
      null,
    inventoryHydration: {
      enabled:
        true,
      candidates:
        productsToHydrate.length,
      hydratedProducts,
      successfulFetches,
      failedFetches,
      productsWithoutNumericInventory,
      checkedProducts:
        products.length,
      authState:
        authState.authState,
      authMessage:
        authState.authMessage,
      authCheckedHandle:
        authState.authCheckedHandle,
      startCursor:
        hydrationWindow.startCursor,
      nextCursor:
        hydrationWindow.nextCursor,
      catalogFingerprint,
    },
  }
}

async function createCatalogCoverageRun(
  supabase: SupabaseClient,
  sourceId: string,
  startedAt: string
) {
  const configuration =
    getLunaCatalogCoverageRuntimeConfiguration()
  if (!configuration.enabled) {
    return null
  }
  const {
    data: resumableRun,
    error: resumableRunError,
  } =
    await supabase
      .from("market_radar_catalog_scan_runs")
      .select("id,started_at")
      .eq(
        "source_id",
        sourceId
      )
      .eq(
        "manifest_version",
        configuration.manifestVersion
      )
      .eq(
        "status",
        "RUNNING"
      )
      .is(
        "finished_at",
        null
      )
      .order(
        "started_at",
        {
          ascending:
            false,
        }
      )
      .limit(1)
      .maybeSingle()
  if (resumableRun?.id) {
    return {
      id:
        String(resumableRun.id),
      startedAt:
        String(resumableRun.started_at),
    }
  }
  if (
    resumableRunError &&
    configuration.mode === "ENFORCED"
  ) {
    throw new Error(
      "LUNA_CATALOG_RESUME_LOOKUP_FAILED"
    )
  }
  const { data, error } =
    await supabase
      .from("market_radar_catalog_scan_runs")
      .insert({
        source_id:
          sourceId,
        manifest_version:
          configuration.manifestVersion,
        execution_mode:
          configuration.mode,
        status:
          "RUNNING",
        started_at:
          startedAt,
      })
      .select("id,started_at")
      .single()
  if (error || !data?.id) {
    if (configuration.mode === "ENFORCED") {
      throw new Error(
        "LUNA_CATALOG_MANIFEST_RUN_CREATE_FAILED"
      )
    }
    console.warn(
      "LUNA CATALOG COVERAGE SHADOW UNAVAILABLE:",
      "LUNA_CATALOG_MANIFEST_RUN_CREATE_FAILED"
    )
    return null
  }
  return {
    id:
      String(data.id),
    startedAt:
      String(data.started_at),
  }
}

function catalogPageCheckpointRow(
  catalogScanRunId: string,
  page: LunaCatalogPageCheckpoint,
  expectedTotal: number | null,
  pageProducts?: ShopifyProduct[]
) {
  const row = {
    scan_run_id:
      catalogScanRunId,
    collection_key:
      page.collection,
    page_number:
      page.page,
    resume_token:
      `${page.collection}:page:${page.page + 1}`,
    status:
      page.errorCode
        ? "FAILED"
        : (
            page.page === page.maxPages &&
            page.receivedProducts >= page.pageLimit
          )
          ? "TRUNCATED"
          : "COMPLETE",
    page_limit:
      page.pageLimit,
    max_pages:
      page.maxPages,
    expected_total:
      expectedTotal,
    received_products:
      page.receivedProducts,
    unique_products:
      page.uniqueProducts,
    unique_variants:
      page.uniqueVariants,
    missing_identity_count:
      page.missingIdentityCount,
    duplicate_product_count:
      page.duplicateProductCount,
    collision_count:
      page.collisionCount,
    attempts:
      page.attempts,
    checksum:
      page.checksum,
    etag:
      page.etag,
    source_observed_at:
      page.sourceObservedAt,
    fetched_at:
      page.fetchedAt,
    error_code:
      page.errorCode,
    updated_at:
      new Date().toISOString(),
  }
  return pageProducts
    ? {
        ...row,
        product_payload:
          pageProducts,
      }
    : row
}

async function persistCatalogPageCheckpoint(
  supabase: SupabaseClient,
  catalogScanRunId: string | null,
  input: {
    checkpoint: LunaCatalogPageCheckpoint
    products: ShopifyProduct[]
    expectedTotal: number | null
  }
) {
  if (!catalogScanRunId) {
    return
  }
  const { error } =
    await supabase
      .from("market_radar_catalog_scan_segments")
      .upsert(
        catalogPageCheckpointRow(
          catalogScanRunId,
          input.checkpoint,
          input.expectedTotal,
          input.products
        ),
        {
          onConflict:
            "scan_run_id,collection_key,page_number",
        }
      )
  if (error) {
    const configuration =
      getLunaCatalogCoverageRuntimeConfiguration()
    if (configuration.mode === "ENFORCED") {
      throw new Error(
        "LUNA_CATALOG_PAGE_CHECKPOINT_FAILED"
      )
    }
    console.warn(
      "LUNA CATALOG PAGE SHADOW CHECKPOINT UNAVAILABLE:",
      "LUNA_CATALOG_PAGE_CHECKPOINT_FAILED"
    )
  }
}

async function loadCatalogCollectionResumeState(
  supabase: SupabaseClient,
  catalogScanRunId: string | null,
  collection: string
) {
  const empty =
    buildLunaCatalogResumeState<ShopifyProduct>(
      []
    )
  if (!catalogScanRunId) {
    return {
      ...empty,
      expectedTotal:
        null,
    }
  }
  const { data, error } =
    await supabase
      .from("market_radar_catalog_scan_segments")
      .select(
        "collection_key,page_number,status,page_limit,max_pages,expected_total,received_products,unique_products,unique_variants,missing_identity_count,duplicate_product_count,collision_count,attempts,checksum,etag,source_observed_at,fetched_at,error_code,product_payload"
      )
      .eq(
        "scan_run_id",
        catalogScanRunId
      )
      .eq(
        "collection_key",
        collection
      )
      .order(
        "page_number",
        {
          ascending:
            true,
        }
      )
  if (error) {
    const configuration =
      getLunaCatalogCoverageRuntimeConfiguration()
    if (configuration.mode === "ENFORCED") {
      throw new Error(
        "LUNA_CATALOG_RESUME_LOAD_FAILED"
      )
    }
    console.warn(
      "LUNA CATALOG RESUME SHADOW UNAVAILABLE:",
      "LUNA_CATALOG_RESUME_LOAD_FAILED"
    )
    return {
      ...empty,
      expectedTotal:
        null,
    }
  }
  const persistedPages: LunaCatalogPersistedPage<ShopifyProduct>[] =
    (data || []).map(row => ({
      checkpoint: {
        collection:
          String(row.collection_key),
        page:
          getInteger(row.page_number) || 1,
        pageLimit:
          getInteger(row.page_limit) || SHOPIFY_PAGE_LIMIT,
        maxPages:
          getInteger(row.max_pages) || SHOPIFY_MAX_PAGES,
        receivedProducts:
          getInteger(row.received_products) || 0,
        uniqueProducts:
          getInteger(row.unique_products) || 0,
        uniqueVariants:
          getInteger(row.unique_variants) || 0,
        missingIdentityCount:
          getInteger(row.missing_identity_count) || 0,
        duplicateProductCount:
          getInteger(row.duplicate_product_count) || 0,
        collisionCount:
          getInteger(row.collision_count) || 0,
        attempts:
          getInteger(row.attempts) || 1,
        sourceObservedAt:
          String(row.source_observed_at),
        fetchedAt:
          String(row.fetched_at),
        checksum:
          String(row.checksum),
        etag:
          getString(row.etag) || null,
        errorCode:
          getString(row.error_code) || null,
      },
      products:
        Array.isArray(row.product_payload)
          ? row.product_payload as ShopifyProduct[]
          : [],
    }))
  const resume =
    buildLunaCatalogResumeState(
      persistedPages
    )
  const expectedTotal =
    [...(data || [])]
      .reverse()
      .map(row =>
        getInteger(row.expected_total)
      )
      .find(value => value !== null) ??
      null
  return {
    ...resume,
    expectedTotal,
  }
}

async function persistCatalogCollectionCoverage(
  supabase: SupabaseClient,
  catalogScanRunId: string | null,
  coverage: LunaCatalogCollectionCoverage
) {
  if (!catalogScanRunId || !coverage.pages.length) {
    return
  }
  const rows =
    coverage.pages.map(page =>
      catalogPageCheckpointRow(
        catalogScanRunId,
        page,
        coverage.expectedTotal
      )
    )
  const { error } =
    await supabase
      .from("market_radar_catalog_scan_segments")
      .upsert(
        rows,
        {
          onConflict:
            "scan_run_id,collection_key,page_number",
        }
      )
  if (error) {
    const configuration =
      getLunaCatalogCoverageRuntimeConfiguration()
    if (configuration.mode === "ENFORCED") {
      throw new Error(
        "LUNA_CATALOG_SEGMENT_CHECKPOINT_FAILED"
      )
    }
    console.warn(
      "LUNA CATALOG SEGMENT SHADOW CHECKPOINT UNAVAILABLE:",
      "LUNA_CATALOG_SEGMENT_CHECKPOINT_FAILED"
    )
  }
}

async function claimInventoryHydrationCursor(
  supabase: SupabaseClient,
  sourceId: string,
  products: AggregatedProduct[]
) {
  const configuration =
    getLunaCatalogCoverageRuntimeConfiguration()
  if (!configuration.enabled) {
    return {
      startCursor:
        0,
      workerId:
        null,
      claimed:
        false,
    }
  }
  const candidates =
    products.filter(
      shouldHydrateProductInventory
    )
  const catalogFingerprint =
    lunaCatalogChecksum(
      candidates.map(product =>
        `${String(product.id || "")}:${getString(product.handle)}`
      ).sort()
    )
  const workerId =
    `luna-sync:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const { data, error } =
    await supabase.rpc(
      "claim_market_radar_luna_hydration_window_v1",
      {
        p_source_id:
          sourceId,
        p_policy_version:
          configuration.hydrationPolicyVersion,
        p_catalog_fingerprint:
          catalogFingerprint,
        p_candidate_count:
          candidates.length,
        p_limit:
          SHOPIFY_AUTH_PRODUCT_LIMIT,
        p_worker_id:
          workerId,
        p_lease_seconds:
          300,
      }
    )
  if (error) {
    if (configuration.mode === "ENFORCED") {
      throw new Error(
        "LUNA_HYDRATION_CURSOR_CLAIM_FAILED"
      )
    }
    console.warn(
      "LUNA HYDRATION ROUND ROBIN SHADOW UNAVAILABLE:",
      "LUNA_HYDRATION_CURSOR_CLAIM_FAILED"
    )
    return {
      startCursor:
        0,
      workerId:
        null,
      claimed:
        false,
    }
  }
  const row =
    Array.isArray(data)
      ? data[0]
      : data
  return {
    startCursor:
      getInteger(
        row?.start_offset
      ) || 0,
    workerId,
    claimed:
      true,
  }
}

async function releaseInventoryHydrationCursor(
  supabase: SupabaseClient,
  sourceId: string,
  lease: {
    workerId: string | null
    claimed: boolean
  },
  outcome: "SUCCESS" | "SAFE_FAILURE",
  strict: boolean
) {
  if (!lease.claimed || !lease.workerId) {
    return
  }
  const { error } =
    await supabase.rpc(
      "release_market_radar_luna_hydration_window_v1",
      {
        p_source_id:
          sourceId,
        p_worker_id:
          lease.workerId,
        p_outcome:
          outcome,
      }
    )
  if (error) {
    const configuration =
      getLunaCatalogCoverageRuntimeConfiguration()
    if (
      strict &&
      configuration.mode === "ENFORCED"
    ) {
      throw new Error(
        "LUNA_HYDRATION_CURSOR_RELEASE_FAILED"
      )
    }
    console.warn(
      "LUNA HYDRATION CURSOR RELEASE UNAVAILABLE:",
      "LUNA_HYDRATION_CURSOR_RELEASE_FAILED"
    )
  }
}

async function fetchLunaPortexProducts(
  supabase: SupabaseClient,
  sourceId: string,
  catalogScanRunId: string | null,
  executionWindow: LunaCatalogExecutionWindow
): Promise<LunaPortexProductFetchResult> {
  const productMap =
    new Map<string, AggregatedProduct>()
  const collectionCoverages: LunaCatalogCollectionCoverage[] =
    []
  const collectionTraversal: boolean[] =
    []
  let catalogPauseReason:
    | "PAGE_LIMIT"
    | "DEADLINE"
    | "FETCH_RETRY_REQUIRED"
    | null =
      null

  for (const collection of LUNAPORTEX_COLLECTIONS) {
    const resume =
      await loadCatalogCollectionResumeState(
        supabase,
        catalogScanRunId,
        collection
      )
    const collectionResult =
      await fetchCollectionProducts(
        collection,
        {
          startPage:
            resume.nextPage,
          resumedProducts:
            resume.products,
          resumedPages:
            resume.pages,
          expectedTotal:
            resume.expectedTotal,
          resumeTerminal:
            resume.terminal,
          executionWindow,
          onPageCheckpoint:
            checkpoint =>
              persistCatalogPageCheckpoint(
                supabase,
                catalogScanRunId,
                checkpoint
              ),
        }
      )
    const products =
      collectionResult.products
    collectionCoverages.push(
      collectionResult.coverage
    )
    collectionTraversal.push(
      collectionResult.traversalComplete
    )
    catalogPauseReason =
      catalogPauseReason ||
      collectionResult.pauseReason
    await persistCatalogCollectionCoverage(
      supabase,
      catalogScanRunId,
      collectionResult.coverage
    )

    products.forEach(product => {
      const supplierProductId =
        String(product.id || "")

      const handle =
        getString(product.handle)

      if (
        !supplierProductId ||
        !handle
      ) {
        return
      }

      const existingProduct =
        productMap.get(
          supplierProductId
        )

      if (existingProduct) {
        existingProduct.collections.add(
          collection
        )
        existingProduct.variants =
          mergeLunaVariantSets(
            existingProduct.variants || [],
            product.variants || [],
            (variant, index) =>
              String(variant.id || "") ||
              getString(variant.sku) ||
              `unidentified:${index}`
          )
        existingProduct.sourceObservedAt =
          [
            existingProduct.sourceObservedAt,
            collectionResult.sourceObservedAt,
          ].sort().at(-1) ||
          collectionResult.sourceObservedAt
        existingProduct.fetchedAt =
          [
            existingProduct.fetchedAt,
            collectionResult.fetchedAt,
          ].sort().at(-1) ||
          collectionResult.fetchedAt

        return
      }

      productMap.set(
        supplierProductId,
        {
          ...product,
          collections:
            new Set([collection]),
          sourceObservedAt:
            collectionResult.sourceObservedAt,
          fetchedAt:
            collectionResult.fetchedAt,
        }
      )
    })

    await wait(
      SHOPIFY_PAGE_DELAY_MS
    )
  }

  const products =
    Array.from(
      productMap.values()
    )
  const catalogCoverage =
    buildLunaCatalogCoverageManifest({
      collections:
        collectionCoverages,
      uniqueProducts:
        products.length,
      uniqueVariants:
        products.reduce(
          (sum, product) =>
            sum + (product.variants?.length || 0),
          0
        ),
    })
  const catalogContinuationRequired =
    collectionTraversal.length !==
      LUNAPORTEX_COLLECTIONS.length ||
    collectionTraversal.some(
      complete =>
        !complete
    )
  if (catalogContinuationRequired) {
    return {
      products,
      catalogCoverage,
      catalogScanRunId,
      catalogContinuationRequired:
        true,
      catalogPagesProcessed:
        executionWindow.pagesProcessed,
      catalogPauseReason:
        catalogPauseReason ||
        "FETCH_RETRY_REQUIRED",
      inventoryHydration: {
        enabled:
          false,
        candidates:
          0,
        hydratedProducts:
          0,
        successfulFetches:
          0,
        failedFetches:
          0,
        productsWithoutNumericInventory:
          0,
        checkedProducts:
          products.length,
        authState:
          LUNAPORTEX_AUTH_COOKIE
            ? "unknown"
            : "not_configured",
        authMessage:
          "Hidratación diferida hasta completar la cobertura del catálogo.",
        authCheckedHandle:
          null,
        startCursor:
          0,
        nextCursor:
          0,
        catalogFingerprint:
          null,
      },
    }
  }
  const hydrationLease =
    await claimInventoryHydrationCursor(
      supabase,
      sourceId,
      products
    )
  try {
    const hydrated =
      await hydrateAuthenticatedInventoryQuantities(
        products,
        hydrationLease.startCursor
      )
    await releaseInventoryHydrationCursor(
      supabase,
      sourceId,
      hydrationLease,
      "SUCCESS",
      true
    )
    return {
      ...hydrated,
      catalogCoverage,
      catalogScanRunId,
      catalogContinuationRequired:
        false,
      catalogPagesProcessed:
        executionWindow.pagesProcessed,
      catalogPauseReason:
        null,
    }
  } catch (error) {
    await releaseInventoryHydrationCursor(
      supabase,
      sourceId,
      hydrationLease,
      "SAFE_FAILURE",
      false
    )
    throw error
  }
}

async function ensureLunaPortexSource(
  supabase: SupabaseClient
) {
  const {
    data,
    error,
  } =
    await supabase
      .from("market_radar_sources")
      .upsert(
        {
          key:
            LUNAPORTEX_SOURCE_KEY,
          name:
            "Luna Portex",
          base_url:
            LUNAPORTEX_BASE_URL,
          poll_interval_minutes:
            15,
        },
        {
          onConflict:
            "key",
        }
      )
      .select("id,key")
      .single()

  if (error || !data) {
    throw new Error(
      error?.message ||
        "No se pudo preparar Luna Portex como fuente."
    )
  }

  return data as MarketRadarSourceRecord
}

async function upsertProducts(
  supabase: SupabaseClient,
  sourceId: string,
  products: AggregatedProduct[],
  capturedAt: string,
  telemetry: AdaptiveBatchTelemetry
) {
  const rows =
    products.map(product => {
      const supplierProductId =
        String(product.id || "")

      const imageUrls =
        normalizeImageUrls(product)

      return {
        source_id:
          sourceId,
        supplier_product_id:
          supplierProductId,
        handle:
          getString(product.handle),
        title:
          getString(product.title) ||
          "Producto sin titulo",
        vendor:
          getString(product.vendor) ||
          null,
        product_type:
          getString(product.product_type) ||
          null,
        tags:
          normalizeTags(product.tags),
        body_html:
          getString(product.body_html) ||
          null,
        product_url:
          `${LUNAPORTEX_BASE_URL}/products/${getString(product.handle)}`,
        featured_image_url:
          imageUrls[0] || null,
        image_urls:
          imageUrls,
        created_at_source:
          getString(product.created_at) ||
          null,
        updated_at_source:
          getString(product.updated_at) ||
          null,
        published_at_source:
          getString(product.published_at) ||
          null,
        last_seen_at:
          capturedAt,
        is_active:
          true,
        metadata:
          {
            collections:
              Array.from(
                product.collections
              ),
          },
      }
    })

  const savedProducts: MarketRadarProductRecord[] =
    []

  await executeAdaptiveBatches({
    rows,
    batchSize: PRODUCT_WRITE_BATCH_SIZE,
    stage: "PRODUCT_UPSERT",
    telemetry,
    execute: async chunk => {
      const { data, error } = await supabase
        .from("market_radar_products")
        .upsert(chunk, { onConflict: "source_id,supplier_product_id" })
        .select("id,supplier_product_id,handle")
      if (error) throw error
      savedProducts.push(...(data || []) as MarketRadarProductRecord[])
    },
  })

  return savedProducts
}

async function getLatestSnapshots(
  supabase: SupabaseClient,
  productIds: string[],
  currentCatalogScanRunId: string | null
) {
  const snapshots =
    new Map<string, LatestSnapshotRecord>()

  for (
    const productIdChunk of chunkArray(
      productIds,
      POSTGREST_FILTER_CHUNK_SIZE
    )
  ) {
    const historyLimit =
      Math.min(
        Math.max(productIdChunk.length * 8, 100),
        1000
      )

    let query =
      supabase
        .from("market_radar_snapshots")
        .select(`
          product_id,
          supplier_variant_id,
          price,
          compare_at_price,
          available,
          inventory_quantity,
          collections,
          captured_at
        `)
        .in(
          "product_id",
          productIdChunk
        )

    if (currentCatalogScanRunId) {
      query =
        query.or(
          `catalog_scan_run_id.is.null,catalog_scan_run_id.neq.${currentCatalogScanRunId}`
        )
    }

    const {
      data,
      error,
    } =
      await query
        .order(
          "captured_at",
          {
            ascending:
              false,
            nullsFirst:
              false,
          }
        )
        .limit(
          historyLimit
        )

    if (error) {
      if (
        isStatementTimeoutError(
          error
        )
      ) {
        console.warn(
          "MARKET RADAR SNAPSHOT HISTORY LOOKUP TIMEOUT; CONTINUING WITHOUT PREVIOUS SNAPSHOTS FOR CHUNK:",
          error.message
        )
        continue
      }

      throw new Error(
        error.message
      )
    }

    ;(
      data || []
    ).forEach(snapshot => {
      const typedSnapshot =
        snapshot as LatestSnapshotRecord
      const snapshotKey =
        `${typedSnapshot.product_id}:${typedSnapshot.supplier_variant_id}`

      if (
        snapshots.has(
          snapshotKey
        )
      ) {
        return
      }

      snapshots.set(
        snapshotKey,
        typedSnapshot
      )
    })
  }

  return snapshots
}

function buildSnapshotsAndEvents(
  sourceId: string,
  products: AggregatedProduct[],
  savedProducts: MarketRadarProductRecord[],
  latestSnapshots: Map<string, LatestSnapshotRecord>,
  capturedAt: string,
  catalogScanRunId: string | null
) {
  const productIdBySupplierId =
    new Map(
      savedProducts.map(product => [
        product.supplier_product_id,
        product.id,
      ])
    )

  const snapshotRows: SnapshotInsert[] =
    []

  const eventRows: EventInsert[] =
    []

  products.forEach(product => {
    const supplierProductId =
      String(product.id || "")

    const productId =
      productIdBySupplierId.get(
        supplierProductId
      )

    if (!productId) {
      return
    }

    const collections =
      Array.from(product.collections)
        .sort()

    const variants =
      product.variants?.length
        ? product.variants
        : [
            {
              id:
                supplierProductId,
              title:
                "Default Title",
              price:
                null,
              compare_at_price:
                null,
              available:
                null,
              inventory_quantity:
                null,
            },
          ]

    variants.forEach(variant => {
      const supplierVariantId =
        String(
          variant.id ||
          supplierProductId
        )

      const price =
        getNumber(variant.price)

      const compareAtPrice =
        getNumber(
          variant.compare_at_price
        )

      const available =
        typeof variant.available === "boolean"
          ? variant.available
          : null

      const inventoryQuantity =
        getNormalizedVariantInventory(
          variant
        )
      const snapshotFingerprint =
        catalogScanRunId
          ? lunaCatalogChecksum({
              productId,
              supplierVariantId,
              price,
              compareAtPrice,
              available,
              inventoryQuantity,
              collections,
              sourceObservedAt:
                product.sourceObservedAt,
            })
          : null

      const snapshotRow: SnapshotInsert = {
        source_id:
          sourceId,
        product_id:
          productId,
        supplier_variant_id:
          supplierVariantId,
        variant_title:
          getString(variant.title) ||
          null,
        sku:
          getString(variant.sku) ||
          null,
        barcode:
          getString(variant.barcode) ||
          null,
        weight:
          getNumber(variant.grams) ??
          getNumber(variant.weight),
        weight_unit:
          getNumber(variant.grams) !== null
            ? "g"
            : getString(variant.weight_unit) || null,
        price,
        compare_at_price:
          compareAtPrice,
        available,
        inventory_quantity:
          inventoryQuantity.inventory_quantity,
        collections,
        discount_percent:
          getDiscountPercent(
            price,
            compareAtPrice
          ),
        raw:
          {
            product:
              getSnapshotRawProduct(
                product
              ),
            variant,
            inventory_context:
              inventoryQuantity,
          },
        captured_at:
          capturedAt,
        ...(catalogScanRunId
          ? {
              catalog_scan_run_id:
                catalogScanRunId,
              source_observed_at:
                product.sourceObservedAt,
              fetched_at:
                product.fetchedAt,
              snapshot_fingerprint:
                snapshotFingerprint!,
              snapshot_ingestion_key:
                buildLunaSnapshotIngestionKey({
                  catalogScanRunId,
                  productId,
                  supplierVariantId,
                }),
            }
          : {}),
      }

      snapshotRows.push(
        snapshotRow
      )

      const latestSnapshot =
        latestSnapshots.get(
          `${productId}:${supplierVariantId}`
        )

      if (!latestSnapshot) {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            "new_product",
            null,
            {
              title:
                getString(product.title),
              price,
              available,
              inventory_quantity:
                inventoryQuantity.inventory_quantity,
              stock_context:
                inventoryQuantity,
              collections,
            },
            capturedAt
          )
        )

        return
      }

      const previousPrice =
        getNumber(
          latestSnapshot.price
        )

      const previousCompareAtPrice =
        getNumber(
          latestSnapshot.compare_at_price
        )

      if (
        latestSnapshot.available !== null &&
        available !== null &&
        latestSnapshot.available !== available
      ) {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            available
              ? "restocked"
              : "out_of_stock",
            {
              available:
                latestSnapshot.available,
            },
            {
              available,
              inventory_quantity:
                inventoryQuantity.inventory_quantity,
              stock_context:
                inventoryQuantity,
            },
            capturedAt
          )
        )
      }

      if (
        previousPrice !== null &&
        price !== null &&
        previousPrice !== price
      ) {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            price < previousPrice
              ? "price_down"
              : "price_up",
            {
              price:
                previousPrice,
            },
            {
              price,
            },
            capturedAt
          )
        )
      }

      const previousHasDiscount =
        hasDiscount(
          previousPrice,
          previousCompareAtPrice
        )

      const currentHasDiscount =
        hasDiscount(
          price,
          compareAtPrice
        )

      if (
        previousHasDiscount !==
        currentHasDiscount
      ) {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            currentHasDiscount
              ? "discount_started"
              : "discount_ended",
            {
              price:
                previousPrice,
              compare_at_price:
                previousCompareAtPrice,
            },
            {
              price,
              compare_at_price:
                compareAtPrice,
            },
            capturedAt
          )
        )
      }

      const {
        entered,
        exited,
      } =
        getCollectionDiff(
          latestSnapshot.collections || [],
          collections
        )

      entered.forEach(collection => {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            "entered_collection",
            null,
            {
              collection,
            },
            capturedAt
          )
        )
      })

      exited.forEach(collection => {
        eventRows.push(
          createEvent(
            sourceId,
            productId,
            supplierVariantId,
            "exited_collection",
            {
              collection,
            },
            null,
            capturedAt
          )
        )
      })
    })
  })

  return {
    snapshotRows,
    eventRows,
  }
}

async function insertSnapshots(
  supabase: SupabaseClient,
  snapshotRows: SnapshotInsert[],
  eventRows: EventInsert[],
  catalogScanRunId: string | null,
  deadlineAtMs: number,
  telemetry: AdaptiveBatchTelemetry
) {
  if (!catalogScanRunId) {
    let insertedCount = 0
    await executeAdaptiveBatches({
      rows: snapshotRows,
      batchSize: SNAPSHOT_WRITE_BATCH_SIZE,
      stage: "SNAPSHOT_INSERT",
      telemetry,
      execute: async snapshotChunk => {
        const { error } = await supabase
          .from("market_radar_snapshots")
          .insert(snapshotChunk)
        if (error) throw error
        insertedCount += snapshotChunk.length
      },
    })
    const eventsInserted =
      await insertEvents(
        supabase,
        eventRows,
        telemetry
      )
    return {
      snapshotsInserted:
        insertedCount,
      eventsInserted,
      processedRows:
        snapshotRows.length,
      complete:
        true,
    }
  }

  const {
    data: completedBatchRows,
    error: completedBatchError,
  } =
    await supabase
      .from(
        "market_radar_snapshot_ingestion_batches"
      )
      .select(
        "batch_ordinal,row_count,snapshot_inserted_count,event_inserted_count"
      )
      .eq(
        "scan_run_id",
        catalogScanRunId
      )
      .eq(
        "policy_version",
        LUNA_SNAPSHOT_INGESTION_POLICY_VERSION
      )
      .eq(
        "status",
        "COMPLETE"
      )
  if (completedBatchError) {
    throw new Error(
      `SNAPSHOT_BATCH_CHECKPOINT_LOOKUP_FAILED: ${completedBatchError.message}`
    )
  }

  const completedBatches =
    new Map(
      (completedBatchRows || []).map(row => [
        Number(row.batch_ordinal),
        {
          rowCount:
            Number(row.row_count || 0),
          snapshotsInserted:
            Number(
              row.snapshot_inserted_count || 0
            ),
          eventsInserted:
            Number(
              row.event_inserted_count || 0
            ),
        },
      ])
    )
  const eventsByVariant =
    new Map<string, EventInsert[]>()
  eventRows.forEach(event => {
    const key =
      `${event.product_id}:${event.supplier_variant_id}`
    const rows =
      eventsByVariant.get(key) || []
    rows.push(event)
    eventsByVariant.set(key, rows)
  })
  const orderedSnapshots =
    [...snapshotRows].sort((left, right) =>
      (
        `${left.product_id}:${left.supplier_variant_id}`
      ).localeCompare(
        `${right.product_id}:${right.supplier_variant_id}`
      )
    )
  const batches =
    chunkArray(
      orderedSnapshots,
      SNAPSHOT_WRITE_BATCH_SIZE
    )
  let processedRows = 0
  let snapshotsInserted = 0
  let eventsInserted = 0

  for (
    let batchOrdinal = 0;
    batchOrdinal < batches.length;
    batchOrdinal += 1
  ) {
    const snapshotChunk =
      batches[batchOrdinal]
    const completed =
      completedBatches.get(batchOrdinal)
    if (completed) {
      if (
        completed.rowCount !==
        snapshotChunk.length
      ) {
        throw new Error(
          "SNAPSHOT_BATCH_REPLAY_SHAPE_MISMATCH"
        )
      }
      processedRows +=
        completed.rowCount
      snapshotsInserted +=
        completed.snapshotsInserted
      eventsInserted +=
        completed.eventsInserted
      continue
    }
    if (
      Date.now() +
        SNAPSHOT_PERSISTENCE_MINIMUM_REMAINING_MS >=
      deadlineAtMs
    ) {
      return {
        snapshotsInserted,
        eventsInserted,
        processedRows,
        complete:
          false,
      }
    }
    const eventChunk =
      snapshotChunk.flatMap(snapshot =>
        eventsByVariant.get(
          `${snapshot.product_id}:${snapshot.supplier_variant_id}`
        ) || []
      )
    const payloadFingerprint =
      lunaCatalogChecksum({
        snapshotRows:
          snapshotChunk,
        eventRows:
          eventChunk,
      })
    const { data, error } =
      await supabase.rpc(
        "persist_market_radar_snapshot_batch_v1",
        {
          p_scan_run_id:
            catalogScanRunId,
          p_policy_version:
            LUNA_SNAPSHOT_INGESTION_POLICY_VERSION,
          p_batch_ordinal:
            batchOrdinal,
          p_batch_key:
            buildLunaSnapshotBatchKey(
              catalogScanRunId,
              batchOrdinal
            ),
          p_payload_fingerprint:
            payloadFingerprint,
          p_snapshot_rows:
            snapshotChunk,
          p_event_rows:
            eventChunk,
        }
      )
    if (error) {
      throw new Error(
        `SNAPSHOT_BATCH_PERSIST_FAILED: ${error.message}`
      )
    }
    const result =
      Array.isArray(data)
        ? data[0]
        : data
    processedRows +=
      Number(
        result?.expected_count ||
        snapshotChunk.length
      )
    snapshotsInserted +=
      Number(
        result?.snapshot_inserted_count || 0
      )
    eventsInserted +=
      Number(
        result?.event_inserted_count || 0
      )
  }

  return {
    snapshotsInserted,
    eventsInserted,
    processedRows,
    complete:
      processedRows === orderedSnapshots.length,
  }
}

async function getCatalogRunSnapshots(
  supabase: SupabaseClient,
  catalogScanRunId: string
) {
  const rows: SnapshotInsert[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } =
      await supabase
        .from("market_radar_snapshots")
        .select(`
          source_id,
          product_id,
          supplier_variant_id,
          variant_title,
          sku,
          barcode,
          weight,
          weight_unit,
          price,
          compare_at_price,
          available,
          inventory_quantity,
          collections,
          discount_percent,
          raw,
          captured_at,
          catalog_scan_run_id,
          source_observed_at,
          fetched_at,
          snapshot_fingerprint,
          snapshot_ingestion_key
        `)
        .eq(
          "catalog_scan_run_id",
          catalogScanRunId
        )
        .order(
          "product_id",
          {
            ascending:
              true,
          }
        )
        .order(
          "supplier_variant_id",
          {
            ascending:
              true,
          }
        )
        .range(
          offset,
          offset + pageSize - 1
        )
    if (error) {
      throw new Error(
        `SNAPSHOT_RUN_READBACK_FAILED: ${error.message}`
      )
    }
    rows.push(
      ...(data || []) as SnapshotInsert[]
    )
    if ((data || []).length < pageSize) {
      break
    }
  }
  return rows
}

async function insertEvents(
  supabase: SupabaseClient,
  eventRows: EventInsert[],
  telemetry: AdaptiveBatchTelemetry
) {
  if (eventRows.length === 0) {
    return 0
  }

  let insertedCount = 0

  await executeAdaptiveBatches({
    rows: eventRows,
    batchSize: EVENT_WRITE_BATCH_SIZE,
    stage: "EVENT_UPSERT",
    telemetry,
    execute: async eventChunk => {
      const { data, error } = await supabase
        .from("market_radar_events")
        .upsert(eventChunk, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id")
      if (error) throw error
      insertedCount += (data || []).length
    },
  })

  return insertedCount
}

async function getRecentEventsForProducts(
  supabase: SupabaseClient,
  productIds: string[],
  startedAt: string
) {
  const sevenDaysAgo =
    new Date(
      new Date(startedAt).getTime() -
      7 * 24 * 60 * 60 * 1000
    ).toISOString()

  const events: EventAggregateRow[] = []

  for (
    const productIdChunk of chunkArray(
      productIds,
      POSTGREST_FILTER_CHUNK_SIZE
    )
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from("market_radar_events")
        .select(`
          product_id,
          event_type,
          created_at
        `)
        .in(
          "product_id",
          productIdChunk
        )
        .gte(
          "created_at",
          sevenDaysAgo
        )

    if (error) {
      if (
        isStatementTimeoutError(
          error
        )
      ) {
        console.warn(
          "MARKET RADAR RECENT EVENT LOOKUP TIMEOUT; CONTINUING WITH PARTIAL EVENT HISTORY:",
          error.message
        )
        continue
      }

      throw new Error(
        error.message
      )
    }

    events.push(
      ...(
        data || []
      ) as EventAggregateRow[]
    )
  }

  return events
}

function getLatestSnapshotByProduct(
  snapshotRows: SnapshotInsert[]
) {
  const latestSnapshotByProduct =
    new Map<string, SnapshotInsert>()

  snapshotRows.forEach(snapshot => {
    if (
      !latestSnapshotByProduct.has(
        snapshot.product_id
      )
    ) {
      latestSnapshotByProduct.set(
        snapshot.product_id,
        snapshot
      )
    }
  })

  return latestSnapshotByProduct
}

function getEventStats(
  events: EventAggregateRow[],
  productId: string,
  startedAt: string
) {
  const now =
    new Date(startedAt).getTime()

  const oneDayAgo =
    now - 24 * 60 * 60 * 1000

  const productEvents =
    events.filter(
      event =>
        event.product_id === productId
    )

  const eventCount24h =
    productEvents.filter(
      event =>
        new Date(
          event.created_at
        ).getTime() >= oneDayAgo
    ).length

  const restockCount7d =
    productEvents.filter(
      event =>
        event.event_type === "restocked"
    ).length

  const outOfStockCount7d =
    productEvents.filter(
      event =>
        event.event_type === "out_of_stock"
    ).length

  const priceChangeCount7d =
    productEvents.filter(
      event =>
        event.event_type === "price_down" ||
        event.event_type === "price_up"
    ).length

  const lastEventAt =
    productEvents
      .map(event => event.created_at)
      .sort()
      .reverse()[0] || null

  return {
    eventCount24h,
    eventCount7d:
      productEvents.length,
    restockCount7d,
    outOfStockCount7d,
    priceChangeCount7d,
    lastEventAt,
  }
}

function calculateCollectionScore(
  collections: string[]
) {
  let score = 0

  if (collections.includes("flash-sale")) {
    score += 18
  }

  if (collections.includes("weekly-deals")) {
    score += 10
  }

  if (collections.includes("out-of-stock")) {
    score += 0
  }

  if (collections.includes("products")) {
    score += 2
  }

  return Math.min(
    score,
    25
  )
}

function calculateScores(
  snapshot: SnapshotInsert,
  stats: ReturnType<typeof getEventStats>
) {
  const discountScore =
    Math.min(
      Number(snapshot.discount_percent || 0) * 0.6,
      30
    )

  const collectionScore =
    calculateCollectionScore(
      snapshot.collections
    )

  const stockScore =
    snapshot.available === true
      ? 12
      : snapshot.available === false
      ? 0
      : 5

  const rotationScore =
    Math.min(
      stats.eventCount7d * 2 +
      stats.restockCount7d * 5,
      25
    )

  const priceScore =
    Math.min(
      stats.priceChangeCount7d * 6 +
      (
        snapshot.discount_percent
          ? 5
          : 0
      ),
      15
    )

  const riskPenalty =
    Math.min(
      stats.outOfStockCount7d * 12 +
      (snapshot.available === false ? 20 : 0),
      40
    )

  const opportunityScore =
    Math.max(
      0,
      Math.min(
      discountScore +
      collectionScore +
      stockScore +
      rotationScore +
        priceScore -
        riskPenalty,
        100
      )
    )

  return {
    opportunityScore,
    rotationScore,
    priceScore,
    stockScore,
    discountScore,
    collectionScore,
  }
}

async function upsertScores(
  supabase: SupabaseClient,
  sourceId: string,
  productIds: string[],
  snapshotRows: SnapshotInsert[],
  startedAt: string,
  telemetry: AdaptiveBatchTelemetry
) {
  const recentEvents =
    await getRecentEventsForProducts(
      supabase,
      productIds,
      startedAt
    )

  const latestSnapshotByProduct =
    getLatestSnapshotByProduct(
      snapshotRows
    )

  const scoreRows =
    productIds
      .flatMap(productId => {
        const snapshot =
          latestSnapshotByProduct.get(productId)

        if (!snapshot) {
          return []
        }

        const stats =
          getEventStats(
            recentEvents,
            productId,
            startedAt
          )

        const scores =
          calculateScores(
            snapshot,
            stats
          )

        return [
          {
            product_id:
              productId,
            source_id:
              sourceId,
            opportunity_score:
              Number(
                scores.opportunityScore.toFixed(2)
              ),
            rotation_score:
              Number(
                scores.rotationScore.toFixed(2)
              ),
            price_score:
              Number(
                scores.priceScore.toFixed(2)
              ),
            stock_score:
              Number(
                scores.stockScore.toFixed(2)
              ),
            discount_score:
              Number(
                scores.discountScore.toFixed(2)
              ),
            collection_score:
              Number(
                scores.collectionScore.toFixed(2)
              ),
            event_count_24h:
              stats.eventCount24h,
            event_count_7d:
              stats.eventCount7d,
            restock_count_7d:
              stats.restockCount7d,
            out_of_stock_count_7d:
              stats.outOfStockCount7d,
            price_change_count_7d:
              stats.priceChangeCount7d,
            last_event_at:
              stats.lastEventAt,
            updated_at:
              startedAt,
          },
        ]
      })

  let scoredProducts = 0

  await executeAdaptiveBatches({
    rows: scoreRows,
    batchSize: SCORE_WRITE_BATCH_SIZE,
    stage: "SCORE_UPSERT",
    telemetry,
    execute: async scoreChunk => {
      const { error } = await supabase
        .from("market_radar_scores")
        .upsert(scoreChunk, { onConflict: "product_id" })
      if (error) throw error
      scoredProducts += scoreChunk.length
    },
  })

  return scoredProducts
}

export async function runLunaPortexMarketRadarSync(
  supabase: SupabaseClient,
  options: {
    timeBudgetMs?: number
    maxCatalogPagesPerInvocation?: number
  } = {}
): Promise<MarketRadarSyncResult> {
  const executionStartedAtMs =
    Date.now()
  const executionWindow: LunaCatalogExecutionWindow = {
    deadlineAtMs:
      executionStartedAtMs +
      Math.max(
        10_000,
        Math.min(
          45_000,
          options.timeBudgetMs ||
            LUNA_CATALOG_DEFAULT_TIME_BUDGET_MS
        )
      ),
    maxPages:
      Math.max(
        1,
        Math.min(
          12,
          options.maxCatalogPagesPerInvocation ||
            LUNA_CATALOG_DEFAULT_PAGE_BUDGET
        )
      ),
    pagesProcessed:
      0,
  }
  const startedAt =
    new Date().toISOString()

  const source =
    await ensureLunaPortexSource(
      supabase
    )

  const batchTelemetry: AdaptiveBatchTelemetry = {
    adaptiveRetryCount: 0,
    failedBatchCount: 0,
    smallestSuccessfulBatchSize: null,
  }
  let catalogScanRunId: string | null =
    null
  let snapshotCapturedAt =
    startedAt

  await supabase
    .from("market_radar_sources")
    .update({
      last_run_at:
        startedAt,
      last_error:
        null,
    })
    .eq(
      "id",
      source.id
    )

  try {
    const catalogCoverageRun =
      await createCatalogCoverageRun(
        supabase,
        source.id,
        startedAt
      )
    catalogScanRunId =
      catalogCoverageRun?.id || null
    snapshotCapturedAt =
      catalogCoverageRun?.startedAt ||
      startedAt
    const productFetchResult =
      await fetchLunaPortexProducts(
        supabase,
        source.id,
        catalogScanRunId,
        executionWindow
      )

    const products =
      productFetchResult.products
    if (
      productFetchResult
        .catalogContinuationRequired
    ) {
      const manifest =
        productFetchResult.catalogCoverage
      const finishedAt =
        new Date().toISOString()
      if (catalogScanRunId) {
        await supabase
          .from(
            "market_radar_catalog_scan_runs"
          )
          .update({
            status:
              "RUNNING",
            expected_products:
              manifest.expectedProducts,
            received_products:
              manifest.receivedProducts,
            unique_products:
              manifest.uniqueProducts,
            unique_variants:
              manifest.uniqueVariants,
            missing_identity_count:
              manifest.missingIdentityCount,
            duplicate_product_count:
              manifest.duplicateProductCount,
            collision_count:
              manifest.collisionCount,
            coverage_percent:
              manifest.coveragePercent,
            catalog_checksum:
              manifest.checksum,
            source_observed_at:
              manifest.sourceObservedAt,
            fetched_at:
              manifest.fetchedAt,
            finished_at:
              null,
            error_code:
              `LUNA_CATALOG_WINDOW_${productFetchResult.catalogPauseReason || "PARTIAL"}`,
          })
          .eq(
            "id",
            catalogScanRunId
          )
      }
      return {
        success:
          true,
        sourceKey:
          LUNAPORTEX_SOURCE_KEY,
        fetchedProducts:
          products.length,
        fetchedVariants:
          0,
        snapshotsInserted:
          0,
        eventsInserted:
          0,
        scoredProducts:
          0,
        catalogProductsFetched:
          products.length,
        uniqueProductsFetched:
          products.length,
        productsUpserted:
          0,
        productsWithSnapshots:
          0,
        failedBatchCount:
          0,
        adaptiveRetryCount:
          0,
        scanCompletenessPercent:
          manifest.coveragePercent || 0,
        scanStatus:
          "PARTIAL",
        inventoryNumericVariants:
          0,
        inventoryAvailabilityOnlyVariants:
          0,
        inventoryUnknownVariants:
          0,
        inventoryHydrationEnabled:
          false,
        inventoryHydrationCandidates:
          0,
        inventoryHydratedProducts:
          0,
        inventoryHydrationSuccessfulFetches:
          0,
        inventoryHydrationFailedFetches:
          0,
        inventoryHydrationWithoutNumericInventory:
          0,
        lunaAuthState:
          productFetchResult.inventoryHydration.authState,
        lunaAuthMessage:
          productFetchResult.inventoryHydration.authMessage,
        lunaAuthCheckedHandle:
          null,
        continuationRequired:
          true,
        catalogScanRunId,
        catalogPagesProcessed:
          productFetchResult.catalogPagesProcessed,
        catalogPauseReason:
          productFetchResult.catalogPauseReason,
        startedAt,
        finishedAt,
      }
    }

    const savedProducts =
      await upsertProducts(
        supabase,
        source.id,
        products,
        startedAt,
        batchTelemetry
      )

    const productIds =
      savedProducts.map(
        product => product.id
      )

    const latestSnapshots =
      await getLatestSnapshots(
        supabase,
        productIds,
        productFetchResult.catalogScanRunId
      )

    const {
      snapshotRows,
      eventRows,
    } =
      buildSnapshotsAndEvents(
        source.id,
        products,
        savedProducts,
        latestSnapshots,
        snapshotCapturedAt,
        productFetchResult.catalogScanRunId
      )

    const snapshotPersistence =
      await insertSnapshots(
        supabase,
        snapshotRows,
        eventRows,
        productFetchResult.catalogScanRunId,
        executionWindow.deadlineAtMs,
        batchTelemetry
      )
    if (!snapshotPersistence.complete) {
      const finishedAt =
        new Date().toISOString()
      if (catalogScanRunId) {
        await supabase
          .from(
            "market_radar_catalog_scan_runs"
          )
          .update({
            status:
              "RUNNING",
            finished_at:
              null,
            error_code:
              "LUNA_SNAPSHOT_PERSISTENCE_PARTIAL",
          })
          .eq(
            "id",
            catalogScanRunId
          )
      }
      return {
        success:
          true,
        sourceKey:
          LUNAPORTEX_SOURCE_KEY,
        fetchedProducts:
          products.length,
        fetchedVariants:
          snapshotRows.length,
        snapshotsInserted:
          snapshotPersistence.snapshotsInserted,
        eventsInserted:
          snapshotPersistence.eventsInserted,
        scoredProducts:
          0,
        catalogProductsFetched:
          products.length,
        uniqueProductsFetched:
          products.length,
        productsUpserted:
          savedProducts.length,
        productsWithSnapshots:
          0,
        failedBatchCount:
          batchTelemetry.failedBatchCount,
        adaptiveRetryCount:
          batchTelemetry.adaptiveRetryCount,
        scanCompletenessPercent:
          productFetchResult.catalogCoverage
            .coveragePercent || 0,
        scanStatus:
          "PARTIAL",
        continuationRequired:
          true,
        catalogScanRunId,
        catalogPagesProcessed:
          productFetchResult.catalogPagesProcessed,
        catalogPauseReason:
          "SNAPSHOT_PERSISTENCE",
        startedAt,
        finishedAt,
      }
    }

    const snapshotsInserted =
      snapshotPersistence.snapshotsInserted
    const eventsInserted =
      snapshotPersistence.eventsInserted
    const effectiveSnapshotRows =
      productFetchResult.catalogScanRunId
        ? await getCatalogRunSnapshots(
            supabase,
            productFetchResult.catalogScanRunId
          )
        : snapshotRows

    const inventoryNumericVariants =
      effectiveSnapshotRows.filter(snapshot => {
        const inventorySource =
          (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
          )?.inventory_source

        return (
          inventorySource === "luna_numeric" ||
          inventorySource === "luna_authenticated_html"
        )
      }).length

    const inventoryAvailabilityOnlyVariants =
      effectiveSnapshotRows.filter(snapshot =>
        snapshot.raw?.inventory_context &&
        (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
        ).inventory_source === "luna_availability" &&
        snapshot.inventory_quantity === null
      ).length

    const inventoryUnknownVariants =
      effectiveSnapshotRows.filter(snapshot =>
        !snapshot.raw?.inventory_context ||
        (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
        ).inventory_source === "not_exposed"
      ).length

    const scoredProducts =
      await upsertScores(
        supabase,
        source.id,
        productIds,
        effectiveSnapshotRows,
        snapshotCapturedAt,
        batchTelemetry
      )

    const productsWithSnapshots =
      new Set(
        effectiveSnapshotRows.map(snapshot => snapshot.product_id)
      ).size

    const completedProducts = Math.min(
      savedProducts.length,
      productsWithSnapshots,
      scoredProducts
    )

    const configuration =
      getLunaCatalogCoverageRuntimeConfiguration()
    const legacyCompletenessPercent =
      products.length > 0
        ? Number(
            (
              completedProducts /
              products.length *
              100
            ).toFixed(2)
          )
        : 0
    const scanCompletenessPercent =
      configuration.enabled &&
      configuration.mode === "ENFORCED"
        ? (
            productFetchResult.catalogCoverage
              .coveragePercent || 0
          )
        : legacyCompletenessPercent
    const scanStatus =
      products.length === 0 ||
      productFetchResult.catalogCoverage.status === "FAILED"
        ? "FAILED" as const
        : (
            productFetchResult.catalogCoverage.status === "TRUNCATED" ||
            batchTelemetry.failedBatchCount > 0 ||
            (
              configuration.enabled &&
              configuration.mode === "ENFORCED" &&
              productFetchResult.catalogCoverage.status !== "COMPLETE"
            )
          )
          ? "PARTIAL" as const
          : scanCompletenessPercent === 100
            ? "COMPLETE" as const
            : "PARTIAL" as const

    const finishedAt =
      new Date().toISOString()

    if (productFetchResult.catalogScanRunId) {
      const manifest =
        productFetchResult.catalogCoverage
      const { error: manifestError } =
        await supabase
          .from("market_radar_catalog_scan_runs")
          .update({
            status:
              manifest.status,
            expected_products:
              manifest.expectedProducts,
            received_products:
              manifest.receivedProducts,
            unique_products:
              manifest.uniqueProducts,
            unique_variants:
              manifest.uniqueVariants,
            missing_identity_count:
              manifest.missingIdentityCount,
            duplicate_product_count:
              manifest.duplicateProductCount,
            collision_count:
              manifest.collisionCount,
            coverage_percent:
              manifest.coveragePercent,
            catalog_checksum:
              manifest.checksum,
            source_observed_at:
              manifest.sourceObservedAt,
            fetched_at:
              manifest.fetchedAt,
            finished_at:
              finishedAt,
            error_code:
              manifest.status === "COMPLETE"
                ? null
                : `LUNA_CATALOG_${manifest.status}`,
          })
          .eq(
            "id",
            productFetchResult.catalogScanRunId
          )
      if (
        manifestError &&
        configuration.mode === "ENFORCED"
      ) {
        throw new Error(
          "LUNA_CATALOG_MANIFEST_FINALIZE_FAILED"
        )
      }
    }

    await supabase
      .from("market_radar_sources")
      .update({
        last_success_at:
          finishedAt,
        last_error:
          null,
      })
      .eq(
        "id",
        source.id
      )

    return {
      success:
        true,
      sourceKey:
        LUNAPORTEX_SOURCE_KEY,
      fetchedProducts:
        products.length,
      fetchedVariants:
        snapshotRows.length,
      snapshotsInserted,
      eventsInserted,
      scoredProducts,
      catalogProductsFetched:
        products.length,
      uniqueProductsFetched:
        products.length,
      productsUpserted:
        savedProducts.length,
      productsWithSnapshots,
      failedBatchCount:
        batchTelemetry.failedBatchCount,
      adaptiveRetryCount:
        batchTelemetry.adaptiveRetryCount,
      scanCompletenessPercent,
      scanStatus,
      inventoryNumericVariants,
      inventoryAvailabilityOnlyVariants,
      inventoryUnknownVariants,
      inventoryHydrationEnabled:
        productFetchResult.inventoryHydration.enabled,
      inventoryHydrationCandidates:
        productFetchResult.inventoryHydration.candidates,
      inventoryHydratedProducts:
        productFetchResult.inventoryHydration.hydratedProducts,
      inventoryHydrationSuccessfulFetches:
        productFetchResult.inventoryHydration.successfulFetches,
      inventoryHydrationFailedFetches:
        productFetchResult.inventoryHydration.failedFetches,
      inventoryHydrationWithoutNumericInventory:
        productFetchResult.inventoryHydration.productsWithoutNumericInventory,
      lunaAuthState:
        productFetchResult.inventoryHydration.authState,
      lunaAuthMessage:
        productFetchResult.inventoryHydration.authMessage,
      lunaAuthCheckedHandle:
        productFetchResult.inventoryHydration.authCheckedHandle,
      continuationRequired:
        false,
      catalogScanRunId:
        productFetchResult.catalogScanRunId,
      catalogPagesProcessed:
        productFetchResult.catalogPagesProcessed,
      catalogPauseReason:
        null,
      startedAt,
      finishedAt,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "market_radar_sync_failed"

    const detailedMessage =
      `${message} | adaptive_retries=${batchTelemetry.adaptiveRetryCount} | failed_batches=${batchTelemetry.failedBatchCount}`

    if (
      catalogScanRunId &&
      (
        message.startsWith(
          "SNAPSHOT_"
        ) ||
        isStatementTimeoutError(error)
      )
    ) {
      await supabase
        .from("market_radar_catalog_scan_runs")
        .update({
          status:
            "RUNNING",
          error_code:
            safeLunaCatalogErrorCode(error),
          finished_at:
            null,
        })
        .eq(
          "id",
          catalogScanRunId
        )
    } else if (catalogScanRunId) {
      await supabase
        .from("market_radar_catalog_scan_runs")
        .update({
          status:
            "FAILED",
          error_code:
            safeLunaCatalogErrorCode(error),
          finished_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          catalogScanRunId
        )
    }

    await supabase
      .from("market_radar_sources")
      .update({
        last_error:
          detailedMessage,
      })
      .eq(
        "id",
        source.id
      )

    throw error
  }
}
