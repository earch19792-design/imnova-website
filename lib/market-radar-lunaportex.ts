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

const SHOPIFY_PAGE_LIMIT = 250
const SHOPIFY_MAX_PAGES = 30
const SHOPIFY_PAGE_DELAY_MS = 250
const SHOPIFY_AUTH_PRODUCT_CONCURRENCY = 6
const SHOPIFY_AUTH_PRODUCT_LIMIT = 300
const POSTGREST_FILTER_CHUNK_SIZE = 100

type ShopifyVariant = {
  id?: number | string | null
  title?: string | null
  sku?: string | null
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

type InventoryHydrationMetrics = {
  enabled: boolean
  candidates: number
  hydratedProducts: number
  checkedProducts: number
}

type LunaPortexProductFetchResult = {
  products: AggregatedProduct[]
  inventoryHydration: InventoryHydrationMetrics
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

  if (inventoryQuantity !== null) {
    return {
      inventory_quantity:
        inventoryQuantity,
      inventory_status:
        inventoryQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_numeric",
      inventory_confidence:
        "high",
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
      `${LUNAPORTEX_BASE_URL}/collections/${collection}/products.json?limit=${SHOPIFY_PAGE_LIMIT}&page=${page}`

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

async function hydrateAuthenticatedInventoryQuantities(
  products: AggregatedProduct[]
): Promise<LunaPortexProductFetchResult> {
  if (!LUNAPORTEX_AUTH_COOKIE) {
    return {
      products,
      inventoryHydration: {
        enabled:
          false,
        candidates:
          0,
        hydratedProducts:
          0,
        checkedProducts:
          products.length,
      },
    }
  }

  const productsToHydrate =
    products
      .filter(shouldHydrateProductInventory)
      .slice(
        0,
        SHOPIFY_AUTH_PRODUCT_LIMIT
      )

  let hydratedProducts =
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

        if (
          authenticatedProduct &&
          mergeAuthenticatedVariantInventory(
            product,
            authenticatedProduct
          )
        ) {
          hydratedProducts += 1
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
      hydrationLimit:
        SHOPIFY_AUTH_PRODUCT_LIMIT,
      hydrationCandidates:
        productsToHydrate.length,
      checkedProducts:
        products.length,
    }
  )

  return {
    products,
    inventoryHydration: {
      enabled:
        true,
      candidates:
        productsToHydrate.length,
      hydratedProducts,
      checkedProducts:
        products.length,
    },
  }
}

async function fetchLunaPortexProducts(): Promise<LunaPortexProductFetchResult> {
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

      const inventoryQuantity =
        getNormalizedVariantInventory(
          variant
        )

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
    const productFetchResult =
      await fetchLunaPortexProducts()

    const products =
      productFetchResult.products

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

    const inventoryNumericVariants =
      snapshotRows.filter(snapshot =>
        snapshot.raw?.inventory_context &&
        (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
        ).inventory_source === "luna_numeric"
      ).length

    const inventoryAvailabilityOnlyVariants =
      snapshotRows.filter(snapshot =>
        snapshot.raw?.inventory_context &&
        (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
        ).inventory_source === "luna_availability" &&
        snapshot.inventory_quantity === null
      ).length

    const inventoryUnknownVariants =
      snapshotRows.filter(snapshot =>
        !snapshot.raw?.inventory_context ||
        (
          snapshot.raw.inventory_context as {
            inventory_source?: string
          }
        ).inventory_source === "not_exposed"
      ).length

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
      snapshotsInserted,
      eventsInserted,
      scoredProducts,
      inventoryNumericVariants,
      inventoryAvailabilityOnlyVariants,
      inventoryUnknownVariants,
      inventoryHydrationEnabled:
        productFetchResult.inventoryHydration.enabled,
      inventoryHydrationCandidates:
        productFetchResult.inventoryHydration.candidates,
      inventoryHydratedProducts:
        productFetchResult.inventoryHydration.hydratedProducts,
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
