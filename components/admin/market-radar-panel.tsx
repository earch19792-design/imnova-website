"use client"

import {
  type ElementType,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  DollarSign,
  ExternalLink,
  PackageCheck,
  Radar,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"
import {
  supabase,
} from "@/lib/supabase"
import {
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
  type MarketRadarSyncResult,
} from "@/lib/market-radar-types"

type MarketRadarApiResponse = {
  success: boolean
  dashboard?: MarketRadarDashboard
  sync?: MarketRadarSyncResult
  error?: string
}

const eventLabels: Record<string, string> = {
  new_product:
    "Nuevo producto",
  restocked:
    "Volvio a stock",
  out_of_stock:
    "Agotado",
  price_up:
    "Precio subio",
  price_down:
    "Precio bajo",
  entered_collection:
    "Entro a coleccion",
  exited_collection:
    "Salio de coleccion",
  discount_started:
    "Inicio descuento",
  discount_ended:
    "Termino descuento",
}

const eventClassNames: Record<string, string> = {
  restocked:
    "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  out_of_stock:
    "border-red-300/25 bg-red-300/[0.10] text-red-100",
  price_down:
    "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  price_up:
    "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
  new_product:
    "border-violet-300/25 bg-violet-300/[0.10] text-violet-100",
  entered_collection:
    "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  exited_collection:
    "border-white/10 bg-white/[0.04] text-white/45",
  discount_started:
    "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  discount_ended:
    "border-white/10 bg-white/[0.04] text-white/45",
}

const collectionLabels: Record<string, string> = {
  products:
    "Products",
  "flash-sale":
    "Flash Sale",
  "weekly-deals":
    "Weekly Deals",
  "out-of-stock":
    "Out of Stock",
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

function formatCurrency(
  value: number | string | null | undefined
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "-"
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
    }
  ).format(numericValue)
}

function formatNumber(
  value: number | string | null | undefined
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "0"
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 1,
    }
  ).format(numericValue)
}

function formatDate(
  value?: string | null
) {
  if (!value) {
    return "Sin registro"
  }

  try {
    return new Intl.DateTimeFormat(
      "es-NI",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone:
          "America/Managua",
      }
    ).format(
      new Date(value)
    )
  } catch {
    return "Fecha no disponible"
  }
}

function getScoreClassName(
  value: number | string | null | undefined
) {
  const score =
    toNumber(value) || 0

  if (score >= 70) {
    return "text-emerald-100"
  }

  if (score >= 45) {
    return "text-cyan-100"
  }

  if (score >= 25) {
    return "text-amber-100"
  }

  return "text-white/45"
}

function getEventValue(
  event: MarketRadarEventRow
) {
  if (
    event.event_type === "price_down" ||
    event.event_type === "price_up"
  ) {
    return `${formatCurrency(
      event.old_value?.price as number | string | null
    )} -> ${formatCurrency(
      event.new_value?.price as number | string | null
    )}`
  }

  if (
    event.event_type === "entered_collection" ||
    event.event_type === "exited_collection"
  ) {
    const collection =
      (
        event.new_value?.collection ||
        event.old_value?.collection ||
        ""
      ) as string

    return collectionLabels[collection] ||
      collection ||
      "-"
  }

  if (
    event.event_type === "restocked" ||
    event.event_type === "out_of_stock"
  ) {
    return event.new_value?.available === true
      ? "Disponible"
      : "Agotado"
  }

  return "-"
}

function getProductStatusLabel(
  product: MarketRadarProductRow
) {
  if (product.available === true) {
    return "Disponible"
  }

  if (product.available === false) {
    return "Agotado"
  }

  return "Sin dato"
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string | number
  detail: string
  icon: ElementType
}) {
  return (
    <div
      className="
        rounded-lg
        border
        border-white/10
        bg-black/25
        p-4
      "
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          {title}
        </p>
        <Icon className="h-4 w-4 text-cyan-100/55" />
      </div>
      <p className="mt-4 text-3xl font-black text-white">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-white/45">
        {detail}
      </p>
    </div>
  )
}

function EventBadge({
  type,
}: {
  type: string
}) {
  return (
    <span
      className={`
        inline-flex
        rounded-md
        border
        px-2
        py-1
        text-[10px]
        uppercase
        tracking-[0.14em]
        ${eventClassNames[type] || eventClassNames.new_product}
      `}
    >
      {eventLabels[type] || type}
    </span>
  )
}

function ProductRow({
  product,
}: {
  product: MarketRadarProductRow
}) {
  const score =
    formatNumber(
      product.opportunity_score
    )

  const collections =
    product.collections || []

  return (
    <tr className="border-b border-white/5 align-top">
      <td className="w-[42%] px-4 py-4">
        <div className="flex gap-3">
          <div
            className="
              h-14
              w-14
              shrink-0
              overflow-hidden
              rounded-md
              border
              border-white/10
              bg-white/[0.04]
            "
          >
            {product.featured_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.featured_image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <p className="line-clamp-2 text-sm font-semibold leading-5 text-white">
                {product.title}
              </p>
              {product.product_url && (
                <a
                  href={product.product_url}
                  target="_blank"
                  rel="noreferrer"
                  className="
                    mt-0.5
                    shrink-0
                    rounded-md
                    border
                    border-white/10
                    p-1
                    text-white/45
                    transition
                    hover:border-cyan-300/30
                    hover:text-cyan-100
                  "
                  aria-label="Abrir producto"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/35">
              {product.sku || product.handle}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm font-bold text-white">
          {formatCurrency(product.price)}
        </p>
        {toNumber(product.compare_at_price) ? (
          <p className="mt-1 text-xs text-white/35 line-through">
            {formatCurrency(
              product.compare_at_price
            )}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-4">
        <span
          className={`
            rounded-md
            border
            px-2
            py-1
            text-[10px]
            uppercase
            tracking-[0.14em]
            ${
              product.available === true
                ? "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
                : product.available === false
                ? "border-red-300/25 bg-red-300/[0.10] text-red-100"
                : "border-white/10 bg-white/[0.04] text-white/45"
            }
          `}
        >
          {getProductStatusLabel(product)}
        </span>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          {collections.slice(0, 3).map(collection => (
            <span
              key={collection}
              className="
                rounded-md
                border
                border-cyan-300/15
                bg-cyan-300/[0.07]
                px-2
                py-1
                text-[10px]
                uppercase
                tracking-[0.12em]
                text-cyan-50/70
              "
            >
              {collectionLabels[collection] || collection}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <p
          className={`
            text-lg
            font-black
            ${getScoreClassName(product.opportunity_score)}
          `}
        >
          {score}
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          {product.event_count_7d || 0} eventos 7d
        </p>
      </td>
      <td className="px-4 py-4 text-xs leading-5 text-white/45">
        {formatDate(
          product.last_event_at ||
          product.last_captured_at
        )}
      </td>
    </tr>
  )
}

function RecentEventItem({
  event,
}: {
  event: MarketRadarEventRow
}) {
  return (
    <div
      className="
        rounded-lg
        border
        border-white/10
        bg-white/[0.03]
        p-4
      "
    >
      <div className="flex items-start justify-between gap-3">
        <EventBadge type={event.event_type} />
        <span className="text-[11px] text-white/35">
          {formatDate(event.created_at)}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-white">
        {event.product?.title || "Producto sin titulo"}
      </p>
      <p className="mt-2 text-xs text-white/45">
        {getEventValue(event)}
      </p>
    </div>
  )
}

export function MarketRadarPanel() {
  const [
    dashboard,
    setDashboard,
  ] = useState<MarketRadarDashboard | null>(null)

  const [
    isLoading,
    setIsLoading,
  ] = useState(true)

  const [
    isSyncing,
    setIsSyncing,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState("")

  const [
    syncResult,
    setSyncResult,
  ] = useState<MarketRadarSyncResult | null>(null)

  const getAccessToken =
    useCallback(async () => {
      const {
        data,
        error:
          sessionError,
      } =
        await supabase.auth.getSession()

      if (
        sessionError ||
        !data.session?.access_token
      ) {
        throw new Error(
          "No hay sesion admin activa."
        )
      }

      return data.session.access_token
    }, [])

  const requestDashboard =
    useCallback(async (
      options?: {
        sync?: boolean
      }
    ) => {
      const token =
        await getAccessToken()

      const response =
        await fetch(
          "/api/admin/market-radar",
          {
            method:
              options?.sync
                ? "POST"
                : "GET",
            headers: {
              Authorization:
                `Bearer ${token}`,
              "Content-Type":
                "application/json",
            },
            body:
              options?.sync
                ? JSON.stringify({
                    action:
                      "sync_lunaportex",
                  })
                : undefined,
          }
        )

      const payload =
        await response.json() as MarketRadarApiResponse

      if (
        !response.ok ||
        !payload.success ||
        !payload.dashboard
      ) {
        throw new Error(
          payload.error ||
          "No se pudo cargar Market Radar."
        )
      }

      setDashboard(
        payload.dashboard
      )

      if (payload.sync) {
        setSyncResult(
          payload.sync
        )
      }
    }, [getAccessToken])

  const loadDashboard =
    useCallback(async () => {
      setIsLoading(true)
      setError("")

      try {
        await requestDashboard()
      } catch (loadError) {
        console.error(
          "LOAD MARKET RADAR ERROR:",
          loadError
        )

        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar Market Radar."
        )
      } finally {
        setIsLoading(false)
      }
    }, [requestDashboard])

  const syncLunaPortex =
    useCallback(async () => {
      setIsSyncing(true)
      setError("")

      try {
        await requestDashboard({
          sync:
            true,
        })
      } catch (syncError) {
        console.error(
          "SYNC MARKET RADAR ERROR:",
          syncError
        )

        setError(
          syncError instanceof Error
            ? syncError.message
            : "No se pudo sincronizar Luna Portex."
        )
      } finally {
        setIsSyncing(false)
      }
    }, [requestDashboard])

  useEffect(() => {
    loadDashboard()

    const interval =
      window.setInterval(
        () => {
          loadDashboard()
        },
        60 * 1000
      )

    return () =>
      window.clearInterval(interval)
  }, [loadDashboard])

  const hotProducts =
    useMemo(
      () =>
        (
          dashboard?.products || []
        ).slice(
          0,
          25
        ),
      [dashboard]
    )

  const summary =
    dashboard?.summary

  return (
    <div className="mt-16 space-y-6">
      <section
        className="
          rounded-lg
          border
          border-cyan-300/15
          bg-cyan-300/[0.04]
          p-5
          md:p-6
        "
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/60">
              Luna Portex
            </p>
            <h2 className="mt-3 text-3xl font-black text-white">
              Market Radar
            </h2>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
              <span>
                Ultimo sync: {formatDate(summary?.lastSuccessAt)}
              </span>
              <span>
                Fuente: {summary?.source?.base_url || "Pendiente"}
              </span>
              {summary?.source?.last_error && (
                <span className="text-red-100">
                  Error: {summary.source.last_error}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={loadDashboard}
              disabled={isLoading || isSyncing}
              className="
                inline-flex
                items-center
                gap-2
                rounded-lg
                border
                border-white/10
                bg-white/[0.04]
                px-4
                py-3
                text-sm
                font-semibold
                text-white
                transition
                hover:border-cyan-300/25
                hover:bg-cyan-300/[0.06]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              <RefreshCw
                className={`
                  h-4
                  w-4
                  ${isLoading ? "animate-spin" : ""}
                `}
              />
              Refrescar
            </button>

            <button
              onClick={syncLunaPortex}
              disabled={isSyncing}
              className="
                inline-flex
                items-center
                gap-2
                rounded-lg
                border
                border-cyan-300/30
                bg-cyan-300
                px-4
                py-3
                text-sm
                font-black
                text-black
                transition
                hover:bg-cyan-200
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              <Radar
                className={`
                  h-4
                  w-4
                  ${isSyncing ? "animate-spin" : ""}
                `}
              />
              {isSyncing ? "Sincronizando" : "Sync Luna"}
            </button>
          </div>
        </div>

        {syncResult && (
          <div
            className="
              mt-5
              grid
              gap-3
              rounded-lg
              border
              border-white/10
              bg-black/25
              p-4
              text-xs
              text-white/55
              md:grid-cols-5
            "
          >
            <span>
              Productos: <strong className="text-white">{syncResult.fetchedProducts}</strong>
            </span>
            <span>
              Variantes: <strong className="text-white">{syncResult.fetchedVariants}</strong>
            </span>
            <span>
              Snapshots: <strong className="text-white">{syncResult.snapshotsInserted}</strong>
            </span>
            <span>
              Eventos: <strong className="text-white">{syncResult.eventsInserted}</strong>
            </span>
            <span>
              Scores: <strong className="text-white">{syncResult.scoredProducts}</strong>
            </span>
          </div>
        )}

        {error && (
          <div
            className="
              mt-5
              rounded-lg
              border
              border-red-300/20
              bg-red-300/[0.08]
              p-4
              text-sm
              text-red-100
            "
          >
            {error}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Productos"
          value={summary?.totalProducts || 0}
          detail={`${summary?.availableProducts || 0} disponibles`}
          icon={PackageCheck}
        />
        <MetricCard
          title="Agotados"
          value={summary?.outOfStockProducts || 0}
          detail={`${summary?.stockOuts7d || 0} eventos 7d`}
          icon={TriangleAlert}
        />
        <MetricCard
          title="Descuento"
          value={summary?.discountedProducts || 0}
          detail="Con compare-at price"
          icon={DollarSign}
        />
        <MetricCard
          title="Hot"
          value={summary?.highOpportunityProducts || 0}
          detail="Score 70+"
          icon={Activity}
        />
        <MetricCard
          title="Restocks"
          value={summary?.restocks7d || 0}
          detail="Ultimos 7 dias"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Precios"
          value={summary?.priceChanges24h || 0}
          detail="Cambios 24h"
          icon={Clock3}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.7fr]">
        <section
          className="
            overflow-hidden
            rounded-lg
            border
            border-white/10
            bg-black/30
          "
        >
          <div className="flex flex-col gap-3 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                Ranking
              </p>
              <h3 className="mt-2 text-xl font-black text-white">
                Productos con mayor oportunidad
              </h3>
            </div>
            <div className="flex gap-2 text-[11px] text-white/40">
              <span className="inline-flex items-center gap-1">
                <ArrowDown className="h-3.5 w-3.5 text-cyan-100" />
                Baja precio
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowUp className="h-3.5 w-3.5 text-amber-100" />
                Sube precio
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead className="bg-white/[0.035] text-[10px] uppercase tracking-[0.18em] text-white/35">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    Producto
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Precio
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Stock
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Coleccion
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Score
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Movimiento
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !dashboard ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-white/45"
                    >
                      Cargando radar...
                    </td>
                  </tr>
                ) : hotProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-white/45"
                    >
                      Ejecuta el primer sync para llenar el ranking.
                    </td>
                  </tr>
                ) : (
                  hotProducts.map(product => (
                    <ProductRow
                      key={`${product.product_id}-${product.supplier_variant_id || "default"}`}
                      product={product}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="
            rounded-lg
            border
            border-white/10
            bg-black/30
            p-5
          "
        >
          <p className="text-[10px] uppercase tracking-[0.26em] text-white/40">
            Eventos
          </p>
          <h3 className="mt-2 text-xl font-black text-white">
            Movimiento reciente
          </h3>

          <div className="mt-5 space-y-3">
            {dashboard?.recentEvents.length ? (
              dashboard.recentEvents.slice(0, 12).map(event => (
                <RecentEventItem
                  key={event.id}
                  event={event}
                />
              ))
            ) : (
              <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                Sin eventos todavia.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
