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
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
  type MarketRadarSource,
} from "@/lib/market-radar-types"

const LUNAPORTEX_SOURCE_KEY =
  "lunaportex"

const POSTGREST_PAGE_SIZE = 1000
const FALLBACK_PRODUCT_LIMIT = 250

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

function getMarketRadarRankValue(
  product: MarketRadarProductRow
) {
  const hasInventory =
    product.inventory_quantity !== null &&
    product.inventory_quantity !== undefined

  const inventoryQuantity =
    toNumber(
      product.inventory_quantity
    ) || 0

  const price =
    toNumber(
      product.price
    )

  const priceBandScore =
    price === null
      ? 0
      : price <= 25
      ? 4
      : price <= 50
      ? 3
      : price <= 100
      ? 2
      : 1

  return [
    product.available === true ? 1 : 0,
    inventoryQuantity > 0 ? 1 : 0,
    hasInventory ? 1 : 0,
    toNumber(product.opportunity_score) || 0,
    toNumber(product.discount_score) || 0,
    priceBandScore,
    toNumber(product.rotation_score) || 0,
    product.restock_count_7d || 0,
    product.event_count_7d || 0,
    product.last_event_at
      ? new Date(product.last_event_at).getTime()
      : 0,
    inventoryQuantity,
  ]
}

function compareMarketRadarProducts(
  left: MarketRadarProductRow,
  right: MarketRadarProductRow
) {
  const leftRank =
    getMarketRadarRankValue(left)

  const rightRank =
    getMarketRadarRankValue(right)

  for (
    let index = 0;
    index < leftRank.length;
    index += 1
  ) {
    if (leftRank[index] === rightRank[index]) {
      continue
    }

    return rightRank[index] - leftRank[index]
  }

  return (left.title || "").localeCompare(
    right.title || ""
  )
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

function createEmptyMarketRadarDashboard(
  source: MarketRadarSource | null
): MarketRadarDashboard {
  return {
    summary: {
      source,
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
        source?.last_run_at || null,
      lastSuccessAt:
        source?.last_success_at || null,
    },
    products: [],
    recentEvents: [],
  }
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

async function getLatestProductsFromView(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  source: MarketRadarSource
) {
  const latestProducts: MarketRadarProductRow[] =
    []

  for (
    let from = 0;
    ;
    from += POSTGREST_PAGE_SIZE
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from("market_radar_latest_products")
        .select("*")
        .eq(
          "source_id",
          source.id
        )
        .range(
          from,
          from + POSTGREST_PAGE_SIZE - 1
        )

    if (error) {
      throw new Error(
        error.message
      )
    }

    const rows =
      (
        data || []
      ) as MarketRadarProductRow[]

    latestProducts.push(
      ...rows
    )

    if (
      rows.length <
      POSTGREST_PAGE_SIZE
    ) {
      break
    }
  }

  return latestProducts
}

async function getLatestProductsFromBaseTables(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  source: MarketRadarSource
) {
  const {
    data: productData,
    error: productError,
  } =
    await supabase
      .from("market_radar_products")
      .select("*")
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
      .limit(FALLBACK_PRODUCT_LIMIT)

  if (productError) {
    throw new Error(
      productError.message
    )
  }

  const products =
    productData || []

  const productIds =
    products
      .map(product => product.id)
      .filter(Boolean)

  if (productIds.length === 0) {
    return []
  }

  const {
    data: snapshotData,
    error: snapshotError,
  } =
    await supabase
      .from("market_radar_snapshots")
      .select("*")
      .in(
        "product_id",
        productIds
      )
      .order(
        "captured_at",
        {
          ascending: false,
        }
      )

  if (snapshotError) {
    throw new Error(
      snapshotError.message
    )
  }

  const {
    data: scoreData,
    error: scoreError,
  } =
    await supabase
      .from("market_radar_scores")
      .select("*")
      .in(
        "product_id",
        productIds
      )

  if (scoreError) {
    throw new Error(
      scoreError.message
    )
  }

  const latestSnapshotByProduct =
    new Map<string, Record<string, unknown>>()

  for (const snapshot of snapshotData || []) {
    const productId =
      String(snapshot.product_id || "")

    if (
      productId &&
      !latestSnapshotByProduct.has(productId)
    ) {
      latestSnapshotByProduct.set(
        productId,
        snapshot
      )
    }
  }

  const scoreByProduct =
    new Map<string, Record<string, unknown>>()

  for (const score of scoreData || []) {
    scoreByProduct.set(
      String(score.product_id || ""),
      score
    )
  }

  return products.map(product => {
    const snapshot =
      latestSnapshotByProduct.get(product.id) ||
      {}

    const score =
      scoreByProduct.get(product.id) ||
      {}

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
      first_seen_at:
        product.first_seen_at,
      last_seen_at:
        product.last_seen_at,
      updated_at_source:
        product.updated_at_source,
      snapshot_id:
        snapshot.id || null,
      supplier_variant_id:
        snapshot.supplier_variant_id || null,
      variant_title:
        snapshot.variant_title || null,
      sku:
        snapshot.sku || null,
      price:
        snapshot.price || null,
      compare_at_price:
        snapshot.compare_at_price || null,
      available:
        snapshot.available ?? null,
      inventory_quantity:
        snapshot.inventory_quantity ?? null,
      collections:
        snapshot.collections || null,
      discount_percent:
        snapshot.discount_percent || null,
      last_captured_at:
        snapshot.captured_at || null,
      opportunity_score:
        score.opportunity_score || null,
      rotation_score:
        score.rotation_score || null,
      price_score:
        score.price_score || null,
      stock_score:
        score.stock_score || null,
      discount_score:
        score.discount_score || null,
      collection_score:
        score.collection_score || null,
      event_count_24h:
        score.event_count_24h || null,
      event_count_7d:
        score.event_count_7d || null,
      restock_count_7d:
        score.restock_count_7d || null,
      out_of_stock_count_7d:
        score.out_of_stock_count_7d || null,
      price_change_count_7d:
        score.price_change_count_7d || null,
      last_event_at:
        score.last_event_at || null,
      score_updated_at:
        score.updated_at || null,
    } as MarketRadarProductRow
  })
}

async function getLatestMarketRadarProducts(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  source: MarketRadarSource
) {
  try {
    return await getLatestProductsFromView(
      supabase,
      source
    )
  } catch (error) {
    console.warn(
      "MARKET RADAR VIEW FALLBACK:",
      error
    )

    return getLatestProductsFromBaseTables(
      supabase,
      source
    )
  }
}

async function getMarketRadarDashboard(): Promise<MarketRadarDashboard> {
  const supabase =
    getSupabaseAdminClient()

  const {
    data: sourceData,
    error: sourceError,
  } =
    await supabase
      .from("market_radar_sources")
      .select("*")
      .eq(
        "key",
        LUNAPORTEX_SOURCE_KEY
      )
      .limit(1)

  if (sourceError) {
    throw new Error(
      sourceError.message
    )
  }

  const source =
    (
      Array.isArray(sourceData)
        ? sourceData[0] || null
        : sourceData
    ) as MarketRadarSource | null

  if (!source) {
    return createEmptyMarketRadarDashboard(
      null
    )
  }

  let latestProducts: MarketRadarProductRow[] =
    []

  try {
    latestProducts =
      await getLatestMarketRadarProducts(
        supabase,
        source
      )
  } catch (error) {
    console.warn(
      "MARKET RADAR PRODUCTS WARNING:",
      error
    )
  }

  latestProducts.sort(
    compareMarketRadarProducts
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

  if (recentEventsError) {
    console.warn(
      "MARKET RADAR RECENT EVENTS WARNING:",
      recentEventsError
    )
  }

  const eventWindow =
    [] as Array<{
      event_type: string
      created_at: string
    }>

  for (
    let from = 0;
    ;
    from += POSTGREST_PAGE_SIZE
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from("market_radar_events")
        .select(`
          event_type,
          created_at
        `)
        .eq(
          "source_id",
          source.id
        )
        .gte(
          "created_at",
          sevenDaysAgo
        )
        .range(
          from,
          from + POSTGREST_PAGE_SIZE - 1
        )

    if (error) {
      console.warn(
        "MARKET RADAR EVENT WINDOW WARNING:",
        error
      )
      break
    }

    const rows =
      (
        data || []
      ) as Array<{
        event_type: string
        created_at: string
      }>

    eventWindow.push(
      ...rows
    )

    if (
      rows.length <
      POSTGREST_PAGE_SIZE
    ) {
      break
    }
  }

  const priceChanges24h =
    eventWindow.filter(event => {
      return (
        (
          event.event_type === "price_down" ||
          event.event_type === "price_up"
        ) &&
        event.created_at >= oneDayAgo
      )
    }).length

  const restocks7d =
    eventWindow.filter(
      event =>
        event.event_type === "restocked"
    ).length

  const stockOuts7d =
    eventWindow.filter(
      event =>
        event.event_type === "out_of_stock"
    ).length

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

  const highOpportunityProducts =
    latestProducts.filter(product => {
      const score =
        toNumber(
          product.opportunity_score
        ) || 0

      return score >= 70
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

  return {
    summary: {
      source,
      totalProducts:
        latestProducts.length,
      availableProducts,
      outOfStockProducts,
      discountedProducts,
      highOpportunityProducts,
      priceChanges24h,
      restocks7d,
      stockOuts7d,
      lastRunAt:
        source.last_run_at,
      lastSuccessAt:
        source.last_success_at,
    },
    products:
      latestProducts.slice(
        0,
        80
      ),
    recentEvents,
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
    const dashboard =
      await getMarketRadarDashboard()

    return NextResponse.json(
      {
        success: true,
        dashboard,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    )
  } catch (error) {
    console.error(
      "GET MARKET RADAR ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: true,
        dashboard:
          createEmptyMarketRadarDashboard(
            null
          ),
        warning:
          "market_radar_dashboard_degraded",
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
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

  try {
    const body =
      await req
        .json()
        .catch(() => ({})) as {
          action?: string
        }

    if (
      body.action !==
      "sync_lunaportex" &&
      body.action !==
      "notify_ebay_opportunities"
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
      body.action ===
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

    const supabase =
      getSupabaseAdminClient()

    const sync =
      await runLunaPortexMarketRadarSync(
        supabase
      )

    const dashboard =
      await getMarketRadarDashboard()

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
          "market_radar_action_failed",
      },
      {
        status: 500,
      }
    )
  }
}
