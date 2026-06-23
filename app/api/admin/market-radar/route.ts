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

const DASHBOARD_PRODUCT_LIMIT = 80

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

async function getLatestMarketRadarProducts(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  source: MarketRadarSource
) {
  const {
    data: scoreData,
    error: scoreError,
  } =
    await supabase
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

  let productIds =
    scores.map(
      score => score.product_id
    )

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

  const {
    data: snapshotsData,
    error: snapshotsError,
  } =
    await supabase
      .from("market_radar_snapshots")
      .select(`
        id,
        product_id,
        supplier_variant_id,
        variant_title,
        sku,
        price,
        compare_at_price,
        available,
        inventory_quantity,
        collections,
        discount_percent,
        captured_at
      `)
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

  if (snapshotsError) {
    throw new Error(
      snapshotsError.message
    )
  }

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
          snapshot?.inventory_quantity ?? null,
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
    .filter(
      (
        product
      ): product is MarketRadarProductRow =>
        Boolean(product)
    )
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

async function getMarketRadarDashboard(): Promise<MarketRadarDashboard> {
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
    }
  }

  const latestProducts =
    await getLatestMarketRadarProducts(
      supabase,
      source
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
    throw new Error(
      recentEventsError.message
    )
  }

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

  return {
    summary: {
      source,
      totalProducts:
        getCount(
          totalProductsResult.count
        ),
      availableProducts:
        availableProducts,
      outOfStockProducts:
        outOfStockProducts,
      discountedProducts:
        discountedProducts,
      highOpportunityProducts:
        getCount(
          highOpportunityProductsResult.count
        ),
      priceChanges24h:
        getCount(
          priceChanges24hResult.count
        ),
      restocks7d:
        getCount(
          restocks7dResult.count
        ),
      stockOuts7d:
        getCount(
          stockOuts7dResult.count
        ),
      lastRunAt:
        source.last_run_at,
      lastSuccessAt:
        source.last_success_at,
    },
    products:
      latestProducts,
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
