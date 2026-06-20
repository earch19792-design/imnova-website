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
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
  type MarketRadarSource,
} from "@/lib/market-radar-types"

const LUNAPORTEX_SOURCE_KEY =
  "lunaportex"

const POSTGREST_PAGE_SIZE = 1000

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
      throw new Error(
        error.message
      )
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
      "sync_lunaportex"
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
          "market_radar_sync_failed",
      },
      {
        status: 500,
      }
    )
  }
}
