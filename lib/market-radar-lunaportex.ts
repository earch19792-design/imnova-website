import {
  type SupabaseClient,
} from "@supabase/supabase-js"
import {
  type MarketRadarEventType,
  type MarketRadarSyncResult,
} from "@/lib/market-radar-types"

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

const LUNAPORTEX_REQUEST_EMAIL =
  process.env.LUNAPORTEX_REQUEST_EMAIL?.trim() ||
  ""

const LUNAPORTEX_REQUEST_EMAIL_PARAM =
  process.env.LUNAPORTEX_REQUEST_EMAIL_PARAM?.trim() ||
  "email"

const LUNAPORTEX_HTML_INVENTORY_MAX_PRODUCTS =
  Number(
    process.env.LUNAPORTEX_HTML_INVENTORY_MAX_PRODUCTS ||
      100
  )

const LUNAPORTEX_HTML_INVENTORY_HANDLES =
  (
    process.env.LUNAPORTEX_HTML_INVENTORY_HANDLES ||
    ""
  )
    .split(",")
    .map(handle =>
      handle.trim()
    )
    .filter(Boolean)

const SHOPIFY_PAGE_LIMIT = 250
const SHOPIFY_MAX_PAGES = 30
const SHOPIFY_PAGE_DELAY_MS = 250
const SHOPIFY_AUTH_PRODUCT_DELAY_MS = 150
const POSTGREST_FILTER_CHUNK_SIZE = 100

type ShopifyVariant = {
  id?: number | string | null
  title?: string | null
  sku?: string | null
  price?: string | number | null
  compare_at_price?: string | number | null
  available?: boolean | null
  inventory_quantity?: number | string | null
  inventoryQuantity?: number | string | null
  quantity_available?: number | string | null
  quantityAvailable?: number | string | null
  available_quantity?: number | string | null
  availableQuantity?: number | string | null
  quantity?: number | string | null
  inventory?: {
    available?: number | string | null
    quantity?: number | string | null
  } | null
  inventory_level?: {
    available?: number | string | null
  } | null
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
}

type InventoryHydrationStats = {
  authHydratedProducts: number
  htmlHydratedProducts: number
  checkedProducts: number
  productsNeedingInventory: number
  productsToHydrate: number
  requestEmailConfigured: boolean
  authCookieConfigured: boolean
}

type FetchedLunaPortexProducts = {
  products: AggregatedProduct[]
  inventoryHydrationStats: InventoryHydrationStats
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
  price: number | null
  compare_at_price: number | null
  available: boolean | null
  inventory_quantity: number | null
  collections: string[]
  discount_percent: number | null
  raw: Record<string, unknown>
  captured_at: string
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

function getInventoryQuantity(
  variant: ShopifyVariant
) {
  return [
    variant.inventory_quantity,
    variant.inventoryQuantity,
    variant.quantity_available,
    variant.quantityAvailable,
    variant.available_quantity,
    variant.availableQuantity,
    variant.quantity,
    variant.inventory?.quantity,
    variant.inventory?.available,
    variant.inventory_level?.available,
  ].reduce<number | null>(
    (quantity, value) =>
      quantity !== null
        ? quantity
        : getInteger(value),
    null
  )
}

function getInventoryQuantityFromHtml(
  html: string
) {
  const quantityMatch =
    html.match(
      /(\d[\d,]*)\s+units?\s+available/i
    )

  if (!quantityMatch) {
    return null
  }

  return getInteger(
    quantityMatch[1].replace(
      /,/g,
      ""
    )
  )
}

function getSelectedVariantIdFromHtml(
  html: string
) {
  const selectedVariantMatch =
    html.match(
      /<input\b(?=[^>]*\bname=["']id["'])(?=[^>]*\bvalue=["']([^"']+)["'])[^>]*>/i
    )

  return selectedVariantMatch
    ? getString(selectedVariantMatch[1])
    : ""
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

  if (LUNAPORTEX_REQUEST_EMAIL) {
    headers["X-Customer-Email"] =
      LUNAPORTEX_REQUEST_EMAIL
  }

  return headers
}

function getLunaPortexRequestUrl(
  path: string
) {
  const url =
    new URL(
      path,
      LUNAPORTEX_BASE_URL
    )

  if (LUNAPORTEX_REQUEST_EMAIL) {
    url.searchParams.set(
      LUNAPORTEX_REQUEST_EMAIL_PARAM,
      LUNAPORTEX_REQUEST_EMAIL
    )
  }

  return url.toString()
}

function hasVariantInventoryQuantity(
  variant: ShopifyVariant
) {
  return getInventoryQuantity(variant) !== null
}

function shouldHydrateProductInventory(
  product: AggregatedProduct
) {
  return Boolean(
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

      if (!authenticatedVariant) {
        return variant
      }

      const inventoryQuantity =
        getInventoryQuantity(
          authenticatedVariant
        )

      if (inventoryQuantity === null) {
        return variant
      }

      changed =
        true

      return {
        ...variant,
        inventory_quantity:
          inventoryQuantity,
      }
    })

  return changed
}

function mergeHtmlInventoryQuantity(
  product: AggregatedProduct,
  html: string
) {
  const inventoryQuantity =
    getInventoryQuantityFromHtml(html)

  if (inventoryQuantity === null) {
    return false
  }

  const selectedVariantId =
    getSelectedVariantIdFromHtml(html)

  const variants =
    product.variants || []

  if (variants.length === 0) {
    return false
  }

  let changed =
    false

  product.variants =
    variants.map(variant => {
      if (hasVariantInventoryQuantity(variant)) {
        return variant
      }

      const isSelectedVariant =
        selectedVariantId &&
        String(variant.id || "") ===
          selectedVariantId

      if (
        variants.length > 1 &&
        !isSelectedVariant
      ) {
        return variant
      }

      changed =
        true

      return {
        ...variant,
        inventory_quantity:
          inventoryQuantity,
      }
    })

  return changed
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

async function fetchCollectionProducts(
  collection: string
) {
  const products: ShopifyProduct[] = []

  for (
    let page = 1;
    page <= SHOPIFY_MAX_PAGES;
    page += 1
  ) {
    const url =
      getLunaPortexRequestUrl(
        `/collections/${collection}/products.json?limit=${SHOPIFY_PAGE_LIMIT}&page=${page}`
      )

    const response =
      await fetch(
        url,
        {
          headers:
            getLunaPortexRequestHeaders(),
          cache:
            "no-store",
        }
      )

    if (!response.ok) {
      throw new Error(
        `Luna Portex ${collection} fetch failed: ${response.status}`
      )
    }

    const payload =
      await response.json() as ShopifyProductsResponse

    const pageProducts =
      payload.products || []

    if (pageProducts.length === 0) {
      break
    }

    products.push(
      ...pageProducts
    )

    if (
      pageProducts.length <
      SHOPIFY_PAGE_LIMIT
    ) {
      break
    }

    await wait(
      SHOPIFY_PAGE_DELAY_MS
    )
  }

  return products
}

async function fetchAuthenticatedProductInventory(
  handle: string
) {
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return null
  }

  const response =
    await fetch(
      getLunaPortexRequestUrl(
        `/products/${handle}.js`
      ),
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

async function fetchProductHtml(
  handle: string
) {
  const response =
    await fetch(
      getLunaPortexRequestUrl(
        `/products/${handle}`
      ),
      {
        headers:
          {
            ...getLunaPortexRequestHeaders(),
            Accept:
              "text/html,application/xhtml+xml",
          },
        cache:
          "no-store",
      }
    )

  if (!response.ok) {
    console.warn(
      "LUNA PORTEX PRODUCT HTML INVENTORY FETCH WARNING:",
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

async function hydrateAuthenticatedInventoryQuantities(
  products: AggregatedProduct[]
): Promise<FetchedLunaPortexProducts> {
  const priorityHandles =
    new Set(
      LUNAPORTEX_HTML_INVENTORY_HANDLES
    )

  const productsNeedingInventory =
    products
      .filter(shouldHydrateProductInventory)
      .sort((left, right) => {
        const leftPriority =
          priorityHandles.has(
            getString(left.handle)
          )
            ? 0
            : 1

        const rightPriority =
          priorityHandles.has(
            getString(right.handle)
          )
            ? 0
            : 1

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority
        }

        const leftOutOfStock =
          left.collections.has("out-of-stock")
            ? 1
            : 0

        const rightOutOfStock =
          right.collections.has("out-of-stock")
            ? 1
            : 0

        return leftOutOfStock - rightOutOfStock
      })

  const productsToHydrate =
    productsNeedingInventory.filter((product, index) =>
      priorityHandles.has(
        getString(product.handle)
      ) ||
      index < LUNAPORTEX_HTML_INVENTORY_MAX_PRODUCTS
    )

  let hydratedProducts =
    0

  let htmlHydratedProducts =
    0

  for (const product of productsToHydrate) {
    const handle =
      getString(product.handle)

    try {
      if (LUNAPORTEX_AUTH_COOKIE) {
        const authenticatedProduct =
          await fetchAuthenticatedProductInventory(
            handle
          )

        if (
          authenticatedProduct &&
          mergeAuthenticatedVariantInventory(
            product,
            authenticatedProduct
          )
        ) {
          hydratedProducts += 1
        }
      }

      if (shouldHydrateProductInventory(product)) {
        const productHtml =
          await fetchProductHtml(handle)

        if (
          productHtml &&
          mergeHtmlInventoryQuantity(
            product,
            productHtml
          )
        ) {
          htmlHydratedProducts += 1
        }
      }
    } catch (error) {
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

    await wait(
      SHOPIFY_AUTH_PRODUCT_DELAY_MS
    )
  }

  console.log(
    `LUNA PORTEX AUTH INVENTORY HYDRATION: ${JSON.stringify({
      enabled: true,
      hydratedProducts,
      htmlHydratedProducts,
      checkedProducts:
        products.length,
      productsNeedingInventory:
        productsNeedingInventory.length,
      productsToHydrate:
        productsToHydrate.length,
      priorityHandles:
        LUNAPORTEX_HTML_INVENTORY_HANDLES.length,
    })}`
  )

  const inventoryHydrationStats = {
    authHydratedProducts:
      hydratedProducts,
    htmlHydratedProducts,
    checkedProducts:
      products.length,
    productsNeedingInventory:
      productsNeedingInventory.length,
    productsToHydrate:
      productsToHydrate.length,
    requestEmailConfigured:
      Boolean(LUNAPORTEX_REQUEST_EMAIL),
    authCookieConfigured:
      Boolean(LUNAPORTEX_AUTH_COOKIE),
  }

  return {
    products,
    inventoryHydrationStats,
  }
}

async function fetchLunaPortexProducts(): Promise<FetchedLunaPortexProducts> {
  const productMap =
    new Map<string, AggregatedProduct>()

  for (const collection of LUNAPORTEX_COLLECTIONS) {
    const products =
      await fetchCollectionProducts(collection)

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

        return
      }

      productMap.set(
        supplierProductId,
        {
          ...product,
          collections:
            new Set([collection]),
        }
      )
    })

    await wait(
      SHOPIFY_PAGE_DELAY_MS
    )
  }

  return hydrateAuthenticatedInventoryQuantities(
    Array.from(
      productMap.values()
    )
  )
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
  capturedAt: string
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
        last_snapshot_at:
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

  for (const chunk of chunkArray(rows, 100)) {
    const {
      data,
      error,
    } =
      await supabase
        .from("market_radar_products")
        .upsert(
          chunk,
          {
            onConflict:
              "source_id,supplier_product_id",
          }
        )
        .select("id,supplier_product_id,handle")

    if (error) {
      throw new Error(
        error.message
      )
    }

    savedProducts.push(
      ...(
        data || []
      ) as MarketRadarProductRecord[]
    )
  }

  return savedProducts
}

async function getLatestSnapshots(
  supabase: SupabaseClient,
  productIds: string[]
) {
  const snapshots =
    new Map<string, LatestSnapshotRecord>()

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
        .from("market_radar_latest_snapshots")
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

    if (error) {
      throw new Error(
        error.message
      )
    }

    ;(
      data || []
    ).forEach(snapshot => {
      const typedSnapshot =
        snapshot as LatestSnapshotRecord

      snapshots.set(
        `${typedSnapshot.product_id}:${typedSnapshot.supplier_variant_id}`,
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
  capturedAt: string
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
        price,
        compare_at_price:
          compareAtPrice,
        available,
        inventory_quantity:
          getInventoryQuantity(
            variant
          ),
        collections,
        discount_percent:
          getDiscountPercent(
            price,
            compareAtPrice
          ),
        raw:
          {
            product,
            variant,
          },
        captured_at:
          capturedAt,
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
  snapshotRows: SnapshotInsert[]
) {
  let insertedCount = 0

  for (
    const snapshotChunk of chunkArray(
      snapshotRows,
      250
    )
  ) {
    const { error } =
      await supabase
        .from("market_radar_snapshots")
        .insert(snapshotChunk)

    if (error) {
      throw new Error(
        error.message
      )
    }

    insertedCount +=
      snapshotChunk.length
  }

  return insertedCount
}

async function insertEvents(
  supabase: SupabaseClient,
  eventRows: EventInsert[]
) {
  if (eventRows.length === 0) {
    return 0
  }

  let insertedCount = 0

  for (
    const eventChunk of chunkArray(
      eventRows,
      250
    )
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from("market_radar_events")
        .upsert(
          eventChunk,
          {
            onConflict:
              "idempotency_key",
            ignoreDuplicates:
              true,
          }
        )
        .select("id")

    if (error) {
      throw new Error(
        error.message
      )
    }

    insertedCount +=
      (data || []).length
  }

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
    score += 8
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
      ? 2
      : 5

  const rotationScore =
    Math.min(
      stats.eventCount7d * 3 +
      stats.restockCount7d * 8 +
      stats.outOfStockCount7d * 8,
      35
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

  const opportunityScore =
    Math.min(
      discountScore +
      collectionScore +
      stockScore +
      rotationScore +
      priceScore,
      100
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
  startedAt: string
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

  for (
    const scoreChunk of chunkArray(
      scoreRows,
      250
    )
  ) {
    const { error } =
      await supabase
        .from("market_radar_scores")
        .upsert(
          scoreChunk,
          {
            onConflict:
              "product_id",
          }
        )

    if (error) {
      throw new Error(
        error.message
      )
    }

    scoredProducts +=
      scoreChunk.length
  }

  return scoredProducts
}

export async function runLunaPortexMarketRadarSync(
  supabase: SupabaseClient
): Promise<MarketRadarSyncResult> {
  const startedAt =
    new Date().toISOString()

  const source =
    await ensureLunaPortexSource(
      supabase
    )

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
    const fetched =
      await fetchLunaPortexProducts()

    const products =
      fetched.products

    const savedProducts =
      await upsertProducts(
        supabase,
        source.id,
        products,
        startedAt
      )

    const productIds =
      savedProducts.map(
        product => product.id
      )

    const latestSnapshots =
      await getLatestSnapshots(
        supabase,
        productIds
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
        startedAt
      )

    const snapshotsInserted =
      await insertSnapshots(
        supabase,
        snapshotRows
      )

    const eventsInserted =
      await insertEvents(
        supabase,
        eventRows
      )

    const scoredProducts =
      await upsertScores(
        supabase,
        source.id,
        productIds,
        snapshotRows,
        startedAt
      )

    const variantsWithQuantity =
      snapshotRows.filter(
        snapshot =>
          snapshot.inventory_quantity !== null &&
          snapshot.inventory_quantity !== undefined
      ).length

    const variantsMissingQuantity =
      snapshotRows.length -
      variantsWithQuantity

    const finishedAt =
      new Date().toISOString()

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
      variantsWithQuantity,
      variantsMissingQuantity,
      htmlInventoryHydratedProducts:
        fetched.inventoryHydrationStats.htmlHydratedProducts,
      authInventoryHydratedProducts:
        fetched.inventoryHydrationStats.authHydratedProducts,
      inventoryHydrationCheckedProducts:
        fetched.inventoryHydrationStats.checkedProducts,
      inventoryHydrationTargetProducts:
        fetched.inventoryHydrationStats.productsToHydrate,
      requestEmailConfigured:
        fetched.inventoryHydrationStats.requestEmailConfigured,
      authCookieConfigured:
        fetched.inventoryHydrationStats.authCookieConfigured,
      snapshotsInserted,
      eventsInserted,
      scoredProducts,
      startedAt,
      finishedAt,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "market_radar_sync_failed"

    await supabase
      .from("market_radar_sources")
      .update({
        last_error:
          message,
      })
      .eq(
        "id",
        source.id
      )

    throw error
  }
}
