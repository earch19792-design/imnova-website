export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  runLunaPortexMarketRadarSync,
} from "@/lib/market-radar-lunaportex"
import {
  sendWhatsAppUpdate,
} from "@/lib/whatsapp"
import {
  getRadarAdvisorEvent,
} from "@/lib/radar-advisor-events.mjs"
import {
  decorateMarketRadarProductActionability,
  getManualStockQuantity,
} from "@/lib/market-radar-actionable-ranking.mjs"
import {
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
  type RadarAdvisorAlert,
  type MarketRadarSource,
} from "@/lib/market-radar-types"

const LUNAPORTEX_SOURCE_KEY =
  "lunaportex"

const DASHBOARD_PRODUCT_LIMIT = 80
const DASHBOARD_SEARCH_LIMIT = 80
const DASHBOARD_SEARCH_SCAN_LIMIT = 1200

type MarketRadarPipelineCandidateLookup = {
  id: string
  candidate_key?: string | null
  market_radar_product_id: string | null
  supplier_variant_id?: string | null
  supplier_sku?: string | null
  title?: string | null
  product_type?: string | null
  state?: string | null
  blocked_reason?: string | null
  needs_data?: unknown
  last_evaluated_at?: string | null
  updated_at?: string | null
}

function getPipelineCandidateVariantKey(
  productId: string,
  supplierVariantId?: string | null
) {
  return [
    productId,
    supplierVariantId || "default",
  ].join(":")
}

function getCandidateForMarketRadarProduct({
  product,
  candidatesByVariantKey,
  fallbackCandidatesByProductId,
}: {
  product: MarketRadarProductRow
  candidatesByVariantKey: Map<string, MarketRadarPipelineCandidateLookup>
  fallbackCandidatesByProductId: Map<string, MarketRadarPipelineCandidateLookup>
}) {
  const exactCandidate =
    candidatesByVariantKey.get(
      getPipelineCandidateVariantKey(
        product.product_id,
        product.supplier_variant_id
      )
    )

  if (exactCandidate) {
    return exactCandidate
  }

  return (
    fallbackCandidatesByProductId.get(product.product_id) ||
    null
  )
}

function getCount(
  count: number | null
) {
  return typeof count === "number"
    ? count
    : 0
}

function formatWhatsAppMoney(
  value: number | string | null | undefined
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "precio sin dato"
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
    }
  ).format(numericValue)
}

function formatWhatsAppQuantity(
  value: number | null | undefined
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "cantidad no expuesta"
  }

  return `${new Intl.NumberFormat(
    "en-US"
  ).format(value)} unidades`
}

function getSafeErrorDetail(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""

  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]")
    .slice(0, 300) ||
    "unknown_error"
}

function getMarketRadarActionError(
  action?: string
) {
  if (action === "sync_lunaportex") {
    return "market_radar_sync_lunaportex_failed"
  }

  if (action === "notify_ebay_opportunities") {
    return "market_radar_notify_failed"
  }

  if (action === "confirm_stock_quantity") {
    return "market_radar_confirm_stock_failed"
  }

  return "market_radar_action_failed"
}

function buildMarketRadarWhatsAppAnalysis(
  products: MarketRadarProductRow[]
) {
  const opportunities =
    products
      .filter(product => {
        const score =
          toNumber(
            product.opportunity_score
          ) || 0

        return (
          score >= 70 &&
          product.available === true
        )
      })
      .slice(
        0,
        3
      )

  if (opportunities.length === 0) {
    return {
      product:
        "Radar eBay IMNOVA",
      status:
        "Sin alerta enviada: hoy no hay oportunidades fuertes para eBay.",
      progress:
        "El radar no encontro productos con score 70+, stock disponible y precio claro. Recomiendo correr otro sync antes de decidir nuevos listings.",
      opportunityCount:
        0,
      shouldNotify:
        false,
    }
  }

  const lines =
    opportunities.map((product, index) => {
      const score =
        toNumber(
          product.opportunity_score
        ) || 0

      return `${index + 1}) ${product.title}: score ${Math.round(score)}, ${formatWhatsAppMoney(product.price)}, ${formatWhatsAppQuantity(product.inventory_quantity)}.`
    })

  return {
    product:
      `Radar eBay: ${opportunities.length} oportunidad${opportunities.length === 1 ? "" : "es"} potencial${opportunities.length === 1 ? "" : "es"}`,
    status:
      "Detecte productos con buena senal para revisar como listing de eBay.",
    progress:
      `${lines.join(" ")} Mi recomendacion: validar margen, envio, reglas de marca y fotos antes de publicar.`,
    opportunityCount:
      opportunities.length,
    shouldNotify:
      true,
  }
}

function createUnauthorizedResponse(
  error: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    {
      status,
    }
  )
}

function toNumber(
  value: number | string | null | undefined
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

function sanitizeMarketRadarSearch(
  value: string | null
) {
  return String(value || "")
    .trim()
    .replace(
      /[^a-zA-Z0-9\s-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      100
    )
}

function isUuidLike(
  value: string
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function getAdvisorAlertDedupeKey(
  alert: RadarAdvisorAlert
) {
  return [
    alert.product_id || "unknown_product",
    alert.supplier_sku || "unknown_sku",
    alert.event_type || "unknown_event",
    alert.business_signal || "unknown_signal",
    alert.recommended_action || "unknown_action",
    alert.stock_context?.inventory_status || "unknown_stock",
    alert.stock_context?.inventory_source || "unknown_source",
    alert.stock_context?.inventory_scope || "unknown_scope",
    alert.stock_context?.inventory_quantity ?? "unknown_quantity",
  ].join("|")
}

function dedupeAdvisorAlerts(
  alerts: RadarAdvisorAlert[]
) {
  const seenAlerts =
    new Set<string>()

  return alerts.filter(alert => {
    const dedupeKey =
      getAdvisorAlertDedupeKey(alert)

    if (seenAlerts.has(dedupeKey)) {
      return false
    }

    seenAlerts.add(dedupeKey)

    return true
  })
}

function normalizeMarketRadarSearchText(
  value: string | null | undefined
) {
  return String(value || "")
    .toLowerCase()
    .replace(
      /[^a-z0-9\s-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
}

function getMarketRadarSearchHandleCandidate(
  value: string
) {
  return normalizeMarketRadarSearchText(
    value
  )
    .replace(
      /\s+/g,
      "-"
    )
    .replace(
      /-+/g,
      "-"
    )
}

function productMatchesMarketRadarSearch(
  product: {
    title?: string | null
    handle?: string | null
    vendor?: string | null
    product_type?: string | null
    supplier_product_id?: string | null
  },
  search: string
) {
  const normalizedSearch =
    normalizeMarketRadarSearchText(
      search
    )

  if (!normalizedSearch) {
    return false
  }

  return [
    product.title,
    product.handle,
    product.vendor,
    product.product_type,
    product.supplier_product_id,
  ].some(value =>
    normalizeMarketRadarSearchText(
      value
    ).includes(
      normalizedSearch
    )
  )
}

function getInventoryContext(
  value: {
    available?: boolean | null
    inventory_quantity?: number | string | null
    raw?: {
      inventory_context?: {
        inventory_source?: string | null
        inventory_scope?: string | null
        inventory_confidence?: string | null
        product_available_quantity?: number | string | null
        stock_message?: string | null
      } | null
    } | null
  } | null | undefined
) {
  const rawInventoryContext =
    value?.raw?.inventory_context || null

  const productAvailableQuantity =
    toNumber(
      rawInventoryContext?.product_available_quantity ??
        null
    )

  if (
    (
      rawInventoryContext?.inventory_scope ===
        "product_or_category_signal" ||
      (
        productAvailableQuantity !== null &&
        productAvailableQuantity >= 10000
      )
    ) &&
    productAvailableQuantity !== null
  ) {
    const signalQuantity =
      Math.trunc(productAvailableQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        signalQuantity,
      inventory_status:
        signalQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      stock_message:
        `Luna muestra ${new Intl.NumberFormat("en-US").format(signalQuantity)} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
    } as const
  }

  if (
    rawInventoryContext?.inventory_scope ===
      "product_level" &&
    productAvailableQuantity !== null
  ) {
    const productQuantity =
      Math.trunc(productAvailableQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        productQuantity,
      inventory_status:
        productQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html_product",
      inventory_confidence:
        "medium",
      inventory_scope:
        "product_level",
      stock_message:
        `Luna muestra ${new Intl.NumberFormat("en-US").format(productQuantity)} unidades disponibles a nivel producto. Este producto tiene varias variantes; validar cantidad por variante antes de listar o escalar.`,
    } as const
  }

  const numericQuantity =
    toNumber(
      value?.inventory_quantity ?? null
    )

  if (
    numericQuantity !== null &&
    rawInventoryContext?.inventory_source ===
      "luna_authenticated_html" &&
    numericQuantity >= 10000
  ) {
    const signalQuantity =
      Math.trunc(numericQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        signalQuantity,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      stock_message:
        `Luna muestra ${new Intl.NumberFormat("en-US").format(signalQuantity)} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
    } as const
  }

  if (numericQuantity !== null) {
    const inventoryQuantity =
      Math.trunc(numericQuantity)

    return {
      inventory_quantity:
        inventoryQuantity,
      product_available_quantity:
        productAvailableQuantity !== null
          ? Math.trunc(productAvailableQuantity)
          : null,
      inventory_status:
        inventoryQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        rawInventoryContext?.inventory_source ===
          "manual_admin_confirmation"
          ? "manual_admin_confirmation"
          : rawInventoryContext?.inventory_source ===
          "luna_authenticated_html"
          ? "luna_authenticated_html"
          : "luna_numeric",
      inventory_confidence:
        "high",
      inventory_scope:
        "variant_level",
      stock_message:
        inventoryQuantity > 0
          ? `Stock disponible: ${new Intl.NumberFormat("en-US").format(inventoryQuantity)} unidades.`
          : "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    } as const
  }

  if (value?.available === false) {
    return {
      inventory_quantity:
        0,
      product_available_quantity:
        null,
      inventory_status:
        "out_of_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      stock_message:
        "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    } as const
  }

  if (value?.available === true) {
    return {
      inventory_quantity:
        null,
      product_available_quantity:
        null,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      stock_message:
        "Disponible, pero Luna no expone cantidad numérica.",
    } as const
  }

  return {
    inventory_quantity:
      null,
    product_available_quantity:
      null,
    inventory_status:
      "unknown",
    inventory_source:
      "not_exposed",
    inventory_confidence:
      "low",
    inventory_scope:
      "unknown",
    stock_message:
      "Cantidad no disponible. Validar manualmente antes de listar.",
  } as const
}

function isMissingLatestSnapshotViewError(
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
    typedError?.code === "42P01" ||
    typedError?.code === "PGRST205" ||
    (
      message.includes(
        "market_radar_latest_snapshots"
      ) &&
      (
        message.includes("does not exist") ||
        message.includes("not found")
      )
    )
  )
}

async function getLatestProductSnapshots(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  productIds: string[]
) {
  const selectFields = `
    id,
    product_id,
    supplier_variant_id,
    variant_title,
    sku,
    price,
    compare_at_price,
    available,
    inventory_quantity,
    raw,
    collections,
    discount_percent,
    captured_at
  `

  const historyLimit =
    Math.min(
      Math.max(productIds.length * 8, 100),
      1000
    )

  const historyResult =
    await supabase
      .from("market_radar_snapshots")
      .select(selectFields)
      .in(
        "product_id",
        productIds
      )
      .order(
        "captured_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .limit(historyLimit)

  if (!historyResult.error) {
    return historyResult.data || []
  }

  if (
    !isMissingLatestSnapshotViewError(
      historyResult.error
    )
  ) {
    throw new Error(
      historyResult.error.message
    )
  }

  console.warn(
    "MARKET RADAR LATEST SNAPSHOTS VIEW MISSING; FALLING BACK TO SNAPSHOT HISTORY:",
    historyResult.error.message
  )

  const fallbackResult =
    await supabase
      .from("market_radar_latest_snapshots")
      .select(selectFields)
      .in(
        "product_id",
        productIds
      )
      .order(
        "captured_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )

  if (fallbackResult.error) {
    throw new Error(
      fallbackResult.error.message
    )
  }

  return fallbackResult.data || []
}

async function getLatestMarketRadarProducts(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  source: MarketRadarSource,
  options: {
    search?: string
  } = {}
) {
  const search =
    sanitizeMarketRadarSearch(
      options.search || null
    )

  let productIds: string[] = []

  if (search) {
    const skuSearchValues =
      Array.from(
        new Set([
          search,
          search.toUpperCase(),
          search.toLowerCase(),
        ])
      )
    const handleCandidate =
      getMarketRadarSearchHandleCandidate(
        search
      )
    const productIdSearchPromise =
      isUuidLike(search)
        ? supabase
            .from("market_radar_products")
            .select("id")
            .eq(
              "source_id",
              source.id
            )
            .eq(
              "id",
              search
            )
            .limit(
              DASHBOARD_SEARCH_LIMIT
            )
        : Promise.resolve({
            data: [],
            error: null,
          })

    const [
      exactProductIdSearchResult,
      exactHandleSearchResult,
      exactSupplierProductSearchResult,
      productSearchResult,
      snapshotSearchResult,
      snapshotVariantSearchResult,
    ] =
      await Promise.all([
        productIdSearchPromise,
        supabase
          .from("market_radar_products")
          .select("id")
          .eq(
            "source_id",
            source.id
          )
          .eq(
            "handle",
            handleCandidate
          )
          .limit(
            DASHBOARD_SEARCH_LIMIT
          ),
        supabase
          .from("market_radar_products")
          .select("id")
          .eq(
            "source_id",
            source.id
          )
          .eq(
            "supplier_product_id",
            search
          )
          .limit(
            DASHBOARD_SEARCH_LIMIT
          ),
        supabase
          .from("market_radar_products")
          .select(`
            id,
            title,
            handle,
            vendor,
            product_type,
            supplier_product_id
          `)
          .eq(
            "source_id",
            source.id
          )
          .limit(
            DASHBOARD_SEARCH_SCAN_LIMIT
          ),
        supabase
          .from("market_radar_snapshots")
          .select("product_id")
          .eq(
            "source_id",
            source.id
          )
          .in(
            "sku",
            skuSearchValues
          )
          .limit(
            DASHBOARD_SEARCH_LIMIT
          ),
        supabase
          .from("market_radar_snapshots")
          .select("product_id")
          .eq(
            "source_id",
            source.id
          )
          .eq(
            "supplier_variant_id",
            search
          )
          .limit(
            DASHBOARD_SEARCH_LIMIT
          ),
      ])

    if (exactProductIdSearchResult.error) {
      throw new Error(
        exactProductIdSearchResult.error.message
      )
    }

    if (exactHandleSearchResult.error) {
      throw new Error(
        exactHandleSearchResult.error.message
      )
    }

    if (exactSupplierProductSearchResult.error) {
      throw new Error(
        exactSupplierProductSearchResult.error.message
      )
    }

    if (productSearchResult.error) {
      throw new Error(
        productSearchResult.error.message
      )
    }

    if (snapshotSearchResult.error) {
      throw new Error(
        snapshotSearchResult.error.message
      )
    }

    if (snapshotVariantSearchResult.error) {
      throw new Error(
        snapshotVariantSearchResult.error.message
      )
    }

    productIds =
      Array.from(
        new Set([
          ...(
            exactProductIdSearchResult.data || []
          ).map(product => product.id),
          ...(
            exactHandleSearchResult.data || []
          ).map(product => product.id),
          ...(
            exactSupplierProductSearchResult.data || []
          ).map(product => product.id),
          ...(
            productSearchResult.data || []
          )
            .filter(product =>
              productMatchesMarketRadarSearch(
                product,
                search
              )
            )
            .map(product => product.id),
          ...(
            snapshotSearchResult.data || []
          ).map(snapshot => snapshot.product_id),
          ...(
            snapshotVariantSearchResult.data || []
          ).map(snapshot => snapshot.product_id),
        ].filter(Boolean))
      ).slice(
        0,
        DASHBOARD_SEARCH_LIMIT
      )
  }

  let scoreQuery =
    supabase
      .from("market_radar_scores")
      .select(`
        product_id,
        opportunity_score,
        rotation_score,
        price_score,
        stock_score,
        discount_score,
        collection_score,
        event_count_24h,
        event_count_7d,
        restock_count_7d,
        out_of_stock_count_7d,
        price_change_count_7d,
        last_event_at,
        updated_at
      `)
      .eq(
        "source_id",
        source.id
      )

  if (search) {
    if (productIds.length === 0) {
      return []
    }

    scoreQuery =
      scoreQuery.in(
        "product_id",
        productIds
      )
  } else {
    scoreQuery =
      scoreQuery
        .order(
          "opportunity_score",
          {
            ascending: false,
            nullsFirst: false,
          }
        )
        .order(
          "last_event_at",
          {
            ascending: false,
            nullsFirst: false,
          }
        )
        .limit(
          DASHBOARD_PRODUCT_LIMIT
        )
  }

  const {
    data: scoreData,
    error: scoreError,
  } =
    await scoreQuery

  if (scoreError) {
    throw new Error(
      scoreError.message
    )
  }

  const scores =
    (scoreData || []) as Array<{
      product_id: string
      opportunity_score: number | string | null
      rotation_score: number | string | null
      price_score: number | string | null
      stock_score: number | string | null
      discount_score: number | string | null
      collection_score: number | string | null
      event_count_24h: number | null
      event_count_7d: number | null
      restock_count_7d: number | null
      out_of_stock_count_7d: number | null
      price_change_count_7d: number | null
      last_event_at: string | null
      updated_at: string | null
    }>

  const scoreByProductId =
    new Map(
      scores.map(score => [
        score.product_id,
        score,
      ])
    )

  if (!search) {
    productIds =
      scores.map(
        score => score.product_id
      )
  }

  if (productIds.length === 0) {
    const {
      data: fallbackProductsData,
      error: fallbackProductsError,
    } =
      await supabase
        .from("market_radar_products")
        .select("id")
        .eq(
          "source_id",
          source.id
        )
        .order(
          "last_seen_at",
          {
            ascending: false,
            nullsFirst: false,
          }
        )
        .limit(
          DASHBOARD_PRODUCT_LIMIT
        )

    if (fallbackProductsError) {
      throw new Error(
        fallbackProductsError.message
      )
    }

    productIds =
      (
        fallbackProductsData || []
      ).map(product => product.id)
  }

  if (productIds.length === 0) {
    return []
  }

  const {
    data: productsData,
    error: productsError,
  } =
    await supabase
      .from("market_radar_products")
      .select(`
        id,
        source_id,
        supplier_product_id,
        handle,
        title,
        vendor,
        product_type,
        tags,
        product_url,
        featured_image_url,
        image_urls,
        is_active,
        first_seen_at,
        last_seen_at,
        updated_at_source
      `)
      .in(
        "id",
        productIds
      )

  if (productsError) {
    throw new Error(
      productsError.message
    )
  }

  const productById =
    new Map(
      (
        productsData || []
      ).map(product => [
        product.id,
        product,
      ])
    )

  const snapshotsData =
    await getLatestProductSnapshots(
      supabase,
      productIds
    )

  const snapshotByProductId =
    new Map<string, NonNullable<typeof snapshotsData>[number]>()

  for (const snapshot of snapshotsData || []) {
    const currentSnapshot =
      snapshotByProductId.get(
        snapshot.product_id
      )

    const hasConfirmedQuantity =
      snapshot.available === true &&
      snapshot.inventory_quantity !== null &&
      snapshot.inventory_quantity !== undefined

    const currentHasConfirmedQuantity =
      currentSnapshot?.available === true &&
      currentSnapshot.inventory_quantity !== null &&
      currentSnapshot.inventory_quantity !== undefined

    if (
      !currentSnapshot ||
      (
        hasConfirmedQuantity &&
        !currentHasConfirmedQuantity
      )
    ) {
      snapshotByProductId.set(
        snapshot.product_id,
        snapshot
      )
    }
  }

  return productIds
    .map(productId => {
      const product =
        productById.get(productId)

      if (!product) {
        return null
      }

      const snapshot =
        snapshotByProductId.get(productId)

      const score =
        scoreByProductId.get(productId)

      const inventoryContext =
        getInventoryContext(
          snapshot
        )

      return {
        product_id:
          product.id,
        source_id:
          product.source_id,
        source_key:
          source.key,
        source_name:
          source.name,
        supplier_product_id:
          product.supplier_product_id,
        handle:
          product.handle,
        title:
          product.title,
        vendor:
          product.vendor,
        product_type:
          product.product_type,
        tags:
          product.tags,
        product_url:
          product.product_url,
        featured_image_url:
          product.featured_image_url,
        image_urls:
          product.image_urls,
        is_active:
          product.is_active ?? null,
        first_seen_at:
          product.first_seen_at,
        last_seen_at:
          product.last_seen_at,
        updated_at_source:
          product.updated_at_source,
        snapshot_id:
          snapshot?.id || null,
        supplier_variant_id:
          snapshot?.supplier_variant_id || null,
        variant_title:
          snapshot?.variant_title || null,
        sku:
          snapshot?.sku || null,
        price:
          snapshot?.price || null,
        compare_at_price:
          snapshot?.compare_at_price || null,
        available:
          snapshot?.available ?? null,
        inventory_quantity:
          inventoryContext.inventory_quantity,
        product_available_quantity:
          inventoryContext.product_available_quantity,
        inventory_status:
          inventoryContext.inventory_status,
        inventory_source:
          inventoryContext.inventory_source,
        inventory_confidence:
          inventoryContext.inventory_confidence,
        inventory_scope:
          inventoryContext.inventory_scope,
        collections:
          snapshot?.collections || null,
        discount_percent:
          snapshot?.discount_percent || null,
        last_captured_at:
          snapshot?.captured_at || null,
        opportunity_score:
          score?.opportunity_score || null,
        rotation_score:
          score?.rotation_score || null,
        price_score:
          score?.price_score || null,
        stock_score:
          score?.stock_score || null,
        discount_score:
          score?.discount_score || null,
        collection_score:
          score?.collection_score || null,
        event_count_24h:
          score?.event_count_24h ?? null,
        event_count_7d:
          score?.event_count_7d ?? null,
        restock_count_7d:
          score?.restock_count_7d ?? null,
        out_of_stock_count_7d:
          score?.out_of_stock_count_7d ?? null,
        price_change_count_7d:
          score?.price_change_count_7d ?? null,
        last_event_at:
          score?.last_event_at || null,
        score_updated_at:
          score?.updated_at || null,
      } satisfies MarketRadarProductRow
    })
    .filter(Boolean) as MarketRadarProductRow[]
}

async function validateAdmin(
  req: Request
) {
  const validation =
    await validateAdminApiRequest(req)

  if (!validation.ok) {
    return createUnauthorizedResponse(
      validation.error ||
        "admin_validation_failed",
      validation.status || 403
    )
  }

  return null
}

async function confirmMarketRadarStockQuantity({
  supabase,
  sourceId,
  productId,
  supplierVariantId,
  quantity,
  note,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  sourceId: string
  productId: string
  supplierVariantId: string
  quantity: number
  note?: string | null
}) {
  const {
    data: latestSnapshot,
    error: latestSnapshotError,
  } =
    await supabase
      .from("market_radar_snapshots")
      .select(`
        id,
        variant_title,
        sku,
        price,
        compare_at_price,
        collections,
        discount_percent
      `)
      .eq(
        "product_id",
        productId
      )
      .eq(
        "supplier_variant_id",
        supplierVariantId
      )
      .order(
        "captured_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (latestSnapshotError) {
    throw new Error(
      latestSnapshotError.message
    )
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("market_radar_snapshots")
      .insert({
        source_id:
          sourceId,
        product_id:
          productId,
        supplier_variant_id:
          supplierVariantId,
        variant_title:
          latestSnapshot?.variant_title || null,
        sku:
          latestSnapshot?.sku || null,
        price:
          latestSnapshot?.price ?? null,
        compare_at_price:
          latestSnapshot?.compare_at_price ?? null,
        available:
          true,
        inventory_quantity:
          quantity,
        collections:
          latestSnapshot?.collections || [],
        discount_percent:
          latestSnapshot?.discount_percent ?? null,
        raw: {
          inventory_context: {
            inventory_quantity:
              quantity,
            inventory_source:
              "manual_admin_confirmation",
            inventory_scope:
              "variant_level",
            inventory_confidence:
              "high",
            stock_message:
              `Cantidad confirmada manualmente: ${quantity} unidades.`,
          },
          manual_stock_confirmation: {
            confirmed_quantity:
              quantity,
            note:
              note || null,
            previous_snapshot_id:
              latestSnapshot?.id || null,
            confirmed_at:
              new Date().toISOString(),
          },
        },
      })
      .select("id")
      .single()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return {
    snapshot_id:
      data?.id || null,
    confirmed_quantity:
      quantity,
  }
}

async function getMarketRadarDashboard(
  options: {
    search?: string
    lightweight?: boolean
  } = {}
): Promise<MarketRadarDashboard> {
  const supabase =
    getSupabaseAdminClient()

  const {
    data: sourceData,
    error: sourceError,
  } =
    await supabase
      .from("market_radar_sources")
      .select(`
        id,
        key,
        name,
        base_url,
        is_active,
        poll_interval_minutes,
        last_run_at,
        last_success_at,
        last_error
      `)
      .eq(
        "key",
        LUNAPORTEX_SOURCE_KEY
      )
      .maybeSingle()

  if (sourceError) {
    throw new Error(
      sourceError.message
    )
  }

  const source =
    sourceData as MarketRadarSource | null

  if (!source) {
    return {
      summary: {
        source:
          null,
        totalProducts:
          0,
        availableProducts:
          0,
        outOfStockProducts:
          0,
        discountedProducts:
          0,
        highOpportunityProducts:
          0,
        priceChanges24h:
          0,
        restocks7d:
          0,
        stockOuts7d:
          0,
        lastRunAt:
          null,
        lastSuccessAt:
          null,
      },
      products: [],
      recentEvents: [],
      advisorAlerts: [],
    }
  }

  const latestProducts =
    await getLatestMarketRadarProducts(
      supabase,
      source,
      {
        search:
          options.search,
      }
    )

  const isSearchDashboard =
    Boolean(
      sanitizeMarketRadarSearch(
        options.search || null
      )
    )
  const useLightweightDashboard =
    isSearchDashboard ||
    options.lightweight === true

  const latestProductIds =
    Array.from(
      new Set(
        latestProducts
          .map(product => product.product_id)
          .filter(Boolean)
      )
    )

  const sevenDaysAgo =
    new Date(
      Date.now() -
      7 * 24 * 60 * 60 * 1000
    ).toISOString()

  const oneDayAgo =
    new Date(
      Date.now() -
      24 * 60 * 60 * 1000
    ).toISOString()

  const {
    data: recentEventsData,
    error: recentEventsError,
  } =
    useLightweightDashboard &&
    latestProductIds.length === 0
      ? {
          data:
            [],
          error:
            null,
        }
      : await (
          useLightweightDashboard
            ? supabase
                .from("market_radar_events")
                .select(`
                  id,
                  source_id,
                  product_id,
                  supplier_variant_id,
                  event_type,
                  old_value,
                  new_value,
                  event_strength,
                  created_at,
                  product:market_radar_products (
                    title,
                    handle,
                    product_url,
                    featured_image_url
                  )
                `)
                .eq(
                  "source_id",
                  source.id
                )
                .in(
                  "product_id",
                  latestProductIds
                )
                .order(
                  "created_at",
                  {
                    ascending: false,
                  }
                )
                .limit(80)
            : supabase
                .from("market_radar_events")
                .select(`
                  id,
                  source_id,
                  product_id,
                  supplier_variant_id,
                  event_type,
                  old_value,
                  new_value,
                  event_strength,
                  created_at,
                  product:market_radar_products (
                    title,
                    handle,
                    product_url,
                    featured_image_url
                  )
                `)
                .eq(
                  "source_id",
                  source.id
                )
                .order(
                  "created_at",
                  {
                    ascending: false,
                  }
                )
                .limit(40)
        )

  if (recentEventsError) {
    throw new Error(
      recentEventsError.message
    )
  }

  const availableProducts =
    latestProducts.filter(
      product =>
        product.available === true
    ).length

  const outOfStockProducts =
    latestProducts.filter(
      product =>
        product.available === false
    ).length

  const discountedProducts =
    latestProducts.filter(product => {
      const discountPercent =
        toNumber(
          product.discount_percent
        )

      return Boolean(
        discountPercent &&
        discountPercent > 0
      )
    }).length

  const recentEvents =
    (
      (
        recentEventsData || []
      ) as Array<
        Omit<MarketRadarEventRow, "product"> & {
          product?:
            | MarketRadarEventRow["product"]
            | MarketRadarEventRow["product"][]
        }
      >
    ).map(event => ({
      ...event,
      product:
        Array.isArray(event.product)
          ? event.product[0] || null
          : event.product || null,
    })) as MarketRadarEventRow[]

  let totalProductsCount =
    latestProducts.length
  let highOpportunityProductsCount =
    latestProducts.filter(
      product =>
        (
          toNumber(
            product.opportunity_score
          ) || 0
        ) >= 70
    ).length
  let priceChanges24hCount =
    recentEvents.filter(
      event =>
        (
          event.event_type === "price_down" ||
          event.event_type === "price_up"
        ) &&
        event.created_at >= oneDayAgo
    ).length
  let restocks7dCount =
    recentEvents.filter(
      event =>
        event.event_type === "restocked" &&
        event.created_at >= sevenDaysAgo
    ).length
  let stockOuts7dCount =
    recentEvents.filter(
      event =>
        event.event_type === "out_of_stock" &&
        event.created_at >= sevenDaysAgo
    ).length

  if (!useLightweightDashboard) {
    const [
      totalProductsResult,
      highOpportunityProductsResult,
      priceChanges24hResult,
      restocks7dResult,
      stockOuts7dResult,
    ] =
      await Promise.all([
        supabase
          .from("market_radar_products")
          .select(
            "id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq(
            "source_id",
            source.id
          ),
        supabase
          .from("market_radar_scores")
          .select(
            "product_id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq(
            "source_id",
            source.id
          )
          .gte(
            "opportunity_score",
            70
          ),
        supabase
          .from("market_radar_events")
          .select(
            "id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq(
            "source_id",
            source.id
          )
          .in(
            "event_type",
            [
              "price_down",
              "price_up",
            ]
          )
          .gte(
            "created_at",
            oneDayAgo
          ),
        supabase
          .from("market_radar_events")
          .select(
            "id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq(
            "source_id",
            source.id
          )
          .eq(
            "event_type",
            "restocked"
          )
          .gte(
            "created_at",
            sevenDaysAgo
          ),
        supabase
          .from("market_radar_events")
          .select(
            "id",
            {
              count: "exact",
              head: true,
            }
          )
          .eq(
            "source_id",
            source.id
          )
          .eq(
            "event_type",
            "out_of_stock"
          )
          .gte(
            "created_at",
            sevenDaysAgo
          ),
      ])

    const countErrors = [
      totalProductsResult.error,
      highOpportunityProductsResult.error,
      priceChanges24hResult.error,
      restocks7dResult.error,
      stockOuts7dResult.error,
    ].filter(Boolean)

    if (countErrors.length > 0) {
      throw new Error(
        countErrors[0]?.message ||
          "market_radar_count_failed"
      )
    }

    totalProductsCount =
      getCount(
        totalProductsResult.count
      )
    highOpportunityProductsCount =
      getCount(
        highOpportunityProductsResult.count
      )
    priceChanges24hCount =
      getCount(
        priceChanges24hResult.count
      )
    restocks7dCount =
      getCount(
        restocks7dResult.count
      )
    stockOuts7dCount =
      getCount(
        stockOuts7dResult.count
      )
  }

  const productById =
    new Map(
      latestProducts.map(product => [
        product.product_id,
        product,
      ])
    )

  const candidatesByVariantKey =
    new Map<string, MarketRadarPipelineCandidateLookup>()

  const fallbackCandidatesByProductId =
    new Map<string, MarketRadarPipelineCandidateLookup>()

  if (latestProductIds.length > 0) {
    const {
      data: candidateData,
      error: candidateError,
    } =
      await supabase
        .from("ebay_product_candidates")
        .select(`
          id,
          candidate_key,
          market_radar_product_id,
          supplier_variant_id,
          supplier_sku,
          title,
          product_type,
          state,
          blocked_reason,
          needs_data,
          last_evaluated_at,
          updated_at
        `)
        .in(
          "market_radar_product_id",
          latestProductIds
        )
        .order(
          "updated_at",
          {
            ascending: false,
            nullsFirst: false,
          }
        )

    if (candidateError) {
      console.warn(
        "RADAR ADVISOR CANDIDATE LOOKUP WARNING:",
        candidateError.message
      )
    } else {
      ;(
        candidateData || []
      ).forEach(candidate => {
        const productId =
          candidate.market_radar_product_id

        if (
          productId &&
          candidate.supplier_variant_id
        ) {
          const variantKey =
            getPipelineCandidateVariantKey(
              productId,
              candidate.supplier_variant_id
            )

          if (
            !candidatesByVariantKey.has(variantKey)
          ) {
            candidatesByVariantKey.set(
              variantKey,
              candidate
            )
          }
        }

        if (
          productId &&
          !fallbackCandidatesByProductId.has(productId)
        ) {
          fallbackCandidatesByProductId.set(
            productId,
            candidate
          )
        }
      })
    }
  }

  const eventsByProductId =
    new Map<string, MarketRadarEventRow[]>()

  if (latestProductIds.length > 0) {
    const {
      data: productEventsData,
      error: productEventsError,
    } =
      await supabase
        .from("market_radar_events")
        .select(`
          id,
          source_id,
          product_id,
          supplier_variant_id,
          event_type,
          old_value,
          new_value,
          event_strength,
          created_at
        `)
        .eq(
          "source_id",
          source.id
        )
        .in(
          "product_id",
          latestProductIds
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(500)

    if (productEventsError) {
      console.warn(
        "RADAR ACTIONABLE EVENT LOOKUP WARNING:",
        productEventsError.message
      )
    } else {
      ;(
        productEventsData || []
      ).forEach(event => {
        const productEvents =
          eventsByProductId.get(event.product_id) || []

        productEvents.push(
          event as MarketRadarEventRow
        )

        eventsByProductId.set(
          event.product_id,
          productEvents
        )
      })
    }
  }

  const actionableProducts =
    latestProducts.map(product =>
      decorateMarketRadarProductActionability({
        product,
        candidate:
          getCandidateForMarketRadarProduct({
            product,
            candidatesByVariantKey,
            fallbackCandidatesByProductId,
          }),
        events:
          eventsByProductId.get(product.product_id) ||
          [],
      })
    ) as MarketRadarProductRow[]

  const advisorAlerts =
    dedupeAdvisorAlerts(
      recentEvents
        .map(event =>
          getRadarAdvisorEvent(
            event,
            productById.get(event.product_id) || null,
            fallbackCandidatesByProductId.get(event.product_id) ||
              null
          )
        )
        .filter(Boolean) as RadarAdvisorAlert[]
    ).slice(0, 12)

  return {
    summary: {
      source,
      totalProducts:
        totalProductsCount,
      availableProducts:
        availableProducts,
      outOfStockProducts:
        outOfStockProducts,
      discountedProducts:
        discountedProducts,
      highOpportunityProducts:
        highOpportunityProductsCount,
      priceChanges24h:
        priceChanges24hCount,
      restocks7d:
        restocks7dCount,
      stockOuts7d:
        stockOuts7dCount,
      lastRunAt:
        source.last_run_at,
      lastSuccessAt:
        source.last_success_at,
    },
    products:
      actionableProducts,
    recentEvents,
    advisorAlerts,
  }
}

export async function GET(
  req: Request
) {
  const unauthorized =
    await validateAdmin(req)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const url =
      new URL(req.url)

    const dashboard =
      await getMarketRadarDashboard({
        search:
          sanitizeMarketRadarSearch(
            url.searchParams.get("search")
          ),
        lightweight:
          true,
      })

    return NextResponse.json({
      success: true,
      dashboard,
    })
  } catch (error) {
    console.error(
      "GET MARKET RADAR ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          "market_radar_dashboard_failed",
        error_detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    )
  }
}

export async function POST(
  req: Request
) {
  const unauthorized =
    await validateAdmin(req)

  if (unauthorized) {
    return unauthorized
  }

  let action: string | undefined

  try {
    const body =
      await req
        .json()
        .catch(() => ({})) as {
          action?: string
          source_id?: string
          product_id?: string
          supplier_variant_id?: string
          quantity?: number | string | null
          note?: string
        }

    action =
      body.action

    if (
      action !==
      "sync_lunaportex" &&
      action !==
      "notify_ebay_opportunities" &&
      action !==
      "confirm_stock_quantity"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "unsupported_market_radar_action",
        },
        {
          status: 400,
        }
      )
    }

    if (
      action ===
      "notify_ebay_opportunities"
    ) {
      const dashboard =
        await getMarketRadarDashboard()

      const analysis =
        buildMarketRadarWhatsAppAnalysis(
          dashboard.products
        )

      if (!analysis.shouldNotify) {
        return NextResponse.json({
          success: true,
          dashboard,
          notification: {
            success: true,
            total: 0,
            successful: 0,
            failed: 0,
            opportunityCount:
              analysis.opportunityCount,
            templateName:
              "imnova_update",
            skipped: true,
            message:
              analysis.status,
          },
        })
      }

      const notification =
        await sendWhatsAppUpdate(
          analysis.product,
          analysis.status,
          analysis.progress
        )

      const responseBody = {
        success:
          notification.success,
        dashboard,
        notification: {
          ...notification,
          opportunityCount:
            analysis.opportunityCount,
          templateName:
            "imnova_update",
        },
      }

      return NextResponse.json(
        responseBody,
        {
          status:
            notification.success
              ? 200
              : 502,
        }
      )
    }

    if (
      action ===
      "confirm_stock_quantity"
    ) {
      const sourceId =
        typeof body.source_id === "string"
          ? body.source_id
          : ""

      const productId =
        typeof body.product_id === "string"
          ? body.product_id
          : ""

      const supplierVariantId =
        typeof body.supplier_variant_id === "string"
          ? body.supplier_variant_id
          : ""

      const quantity =
        getManualStockQuantity(
          body.quantity
        )

      const note =
        typeof body.note === "string"
          ? body.note.trim().slice(0, 500)
          : null

      if (
        !sourceId ||
        !productId ||
        !supplierVariantId ||
        quantity === null
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "invalid_stock_confirmation_payload",
          },
          {
            status: 400,
          }
        )
      }

      const supabase =
        getSupabaseAdminClient()

      const stockConfirmation =
        await confirmMarketRadarStockQuantity({
          supabase,
          sourceId,
          productId,
          supplierVariantId,
          quantity,
          note,
        })

      const dashboard =
        await getMarketRadarDashboard()

      return NextResponse.json({
        success: true,
        stockConfirmation,
        dashboard,
      })
    }

    const supabase =
      getSupabaseAdminClient()

    const sync =
      await runLunaPortexMarketRadarSync(
        supabase
      )

    const dashboard =
      await getMarketRadarDashboard({
        lightweight:
          true,
      })

    return NextResponse.json({
      success: true,
      sync,
      dashboard,
    })
  } catch (error) {
    console.error(
      "POST MARKET RADAR ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          getMarketRadarActionError(
            action
          ),
        error_detail:
          getSafeErrorDetail(
            error
          ),
      },
      {
        status: 500,
      }
    )
  }
}
