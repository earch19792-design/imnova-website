"use client"

import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { supabase } from "@/lib/supabase"
import {
  normalizeEbaySellerTrafficReport,
  type EbaySellerTrafficDashboard,
  type EbaySellerTrafficRow,
} from "@/lib/ebay/ebay-seller-traffic-report"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type ApiPayload = {
  success?: boolean
  error?: string
  report?: unknown
  configuration?: {
    configured?: boolean
    requiredScope?: string
    refreshTokenReturnedToBrowser?: boolean
    refreshTokenLogged?: boolean
    ebayWriteUsed?: boolean
  }
  learning?: {
    status?: string
    error?: string
    persistencePerformed?: boolean
    trainingTriggered?: boolean
    automaticCollectionOnly?: boolean
    reportCoverage?: {
      requestedDateFrom: string
      requestedDateTo: string
      reportDateFrom: string
      reportDateTo: string
      lastUpdatedDate: string | null
      complete: boolean
    }
    categoryLearning?: Array<{
      categoryId: string
      status: "COLLECTING" | "ELIGIBLE_APPLIED"
      adjustmentPoints: number
      sampleListingCount: number
      totalImpressions: number
      minimumObservationDays: number
      remainingRequirements: {
        linkedListings: number
        observationDays: number
        totalImpressions: number
      }
    }>
  }
  listingSelection?: {
    mode?: "EXPLICIT" | "VERIFIED_OWN_LINKS"
    count?: number
  }
}

const numberFormatter = new Intl.NumberFormat("es-US", {
  maximumFractionDigits: 2,
})

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function initialDateRange() {
  const end = new Date(Date.now() - 86_400_000)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 29)
  return { dateFrom: isoDay(start), dateTo: isoDay(end) }
}

function metric(row: EbaySellerTrafficRow, key: string) {
  const value = row.metrics[key]
  return row.applicability[key] && typeof value === "number" ? value : null
}

function rate(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0
    ? (numerator / denominator) * 100
    : null
}

function formatMetric(value: number | null) {
  return value === null ? "—" : numberFormatter.format(value)
}

function rowClickThroughRate(row: EbaySellerTrafficRow) {
  return rate(
    metric(row, "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE"),
    metric(row, "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE"),
  )
}

function rowSalesConversionRate(row: EbaySellerTrafficRow) {
  return rate(
    metric(row, "TRANSACTION"),
    metric(row, "LISTING_VIEWS_TOTAL"),
  )
}

function formatPercent(value: number | null) {
  return value === null ? "Sin base" : `${numberFormatter.format(value)}%`
}

function formatDateTime(value: string | null) {
  if (!value) return "No informado por eBay"
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : value
}

function dimensionLabel(value: string, dimension: "DAY" | "LISTING") {
  if (dimension === "LISTING") return value
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", {
        month: "short",
        day: "numeric",
      }).format(date)
    : value
}

function humanError(code: string) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "La sesión Admin expiró. Vuelve a iniciar sesión.",
    ADMIN_FORBIDDEN:
      "La cuenta autenticada no tiene permisos de administrador.",
    EBAY_SELLER_OAUTH_NOT_CONFIGURED:
      "Falta EBAY_SELLER_REFRESH_TOKEN en este entorno de Vercel.",
    EBAY_READONLY_ENV_MISSING:
      "Faltan las credenciales eBay de Production en el servidor.",
    EBAY_SELLER_OAUTH_400:
      "eBay rechazó el refresh token. Reautoriza la cuenta Seller con el scope de Analytics.",
    EBAY_SELLER_OAUTH_401:
      "eBay rechazó las credenciales OAuth de Production.",
    EBAY_ANALYTICS_DATE_RANGE_INVALID:
      "El rango debe ser válido, cronológico y de 90 días o menos.",
    EBAY_ANALYTICS_READ_400:
      "eBay rechazó el rango o los listing IDs solicitados.",
    EBAY_ANALYTICS_READ_403:
      "La autorización no incluye sell.analytics.readonly o la cuenta no tiene acceso.",
    EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_REQUIRED:
      "Falta configurar el alias y la identidad vinculada de la cuenta Seller oficial.",
    EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_INVALID:
      "El alias o la identidad vinculada de la cuenta Seller oficial no es válido.",
    EBAY_VERIFIED_LISTING_REQUIRED:
      "Todavía no hay un listing propio verificado. Registra el primer Item ID antes de consultar rendimiento por listing.",
    EBAY_VERIFIED_LISTING_LINKS_READ_FAILED:
      "No se pudieron leer los listings propios verificados. Revisa Supabase e intenta nuevamente.",
  }
  return messages[code] ?? "No se pudo consultar Seller Analytics. Intenta nuevamente."
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className="mt-4 text-3xl font-black text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/50">{detail}</p>
    </article>
  )
}

export default function EbaySellerPerformancePage() {
  const initialRange = useMemo(initialDateRange, [])
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom)
  const [dateTo, setDateTo] = useState(initialRange.dateTo)
  const [listingIds, setListingIds] = useState("")
  const [dashboard, setDashboard] =
    useState<EbaySellerTrafficDashboard | null>(null)
  const [learning, setLearning] = useState<ApiPayload["learning"] | null>(null)
  const [listingSelection, setListingSelection] = useState<ApiPayload["listingSelection"] | null>(null)
  const [configurationReady, setConfigurationReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [errorCode, setErrorCode] = useState("")

  const chartRows = useMemo(() => {
    if (!dashboard) return []
    return dashboard.rows.slice(0, dashboard.dimension === "LISTING" ? 25 : 90)
      .map((row) => ({
        label: dimensionLabel(row.dimension, dashboard.dimension),
        impresiones: metric(row, "TOTAL_IMPRESSION_TOTAL"),
        vistas: metric(row, "LISTING_VIEWS_TOTAL"),
        transacciones: metric(row, "TRANSACTION"),
      }))
  }, [dashboard])

  async function loadReport() {
    if (loading) return
    setError("")
    setErrorCode("")
    setDashboard(null)
    setLearning(null)

    const rawIds = listingIds
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    const invalidIds = rawIds.filter((entry) => !/^\d{9,20}$/.test(entry))
    if (invalidIds.length || rawIds.length > 200) {
      setError("Usa hasta 200 listing IDs de 9–20 dígitos, separados por coma o espacio.")
      return
    }

    setLoading(true)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")

      const search = new URLSearchParams({ dateFrom, dateTo })
      if (rawIds.length) search.set("listingIds", [...new Set(rawIds)].join(","))
      const response = await fetch(
        `/api/admin/ebay/seller-performance?${search.toString()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        },
      )
      const payload = await response.json() as ApiPayload
      setConfigurationReady(Boolean(payload.configuration?.configured))
      if (response.status === 401) throw new Error("AUTH_REQUIRED")
      if (response.status === 403) throw new Error("ADMIN_FORBIDDEN")
      if (!response.ok || !payload.success || !payload.report) {
        throw new Error(payload.error || "EBAY_SELLER_ANALYTICS_READ_FAILED")
      }
      setDashboard(normalizeEbaySellerTrafficReport(payload.report))
      setLearning(payload.learning ?? null)
      setListingSelection(payload.listingSelection ?? null)
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : ""
      setErrorCode(code)
      setError(humanError(code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-8 text-white sm:px-6 md:px-10">
      <section className="mx-auto flex max-w-7xl flex-col gap-6">
        <nav className="flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em]">
          <a className="rounded-full border border-white/10 px-4 py-2 text-white/65" href="/admin/ebay-seller-os">
            Seller OS
          </a>
          <a className="rounded-full border border-white/10 px-4 py-2 text-white/65" href="/admin">
            Admin
          </a>
        </nav>

        <header className="overflow-hidden rounded-[32px] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.10] via-white/[0.04] to-emerald-300/[0.06] p-6 md:p-9">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-100/60">
            eBay Seller Analytics · read-only
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight md:text-6xl">
            Rendimiento real de tus listings
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-white/65 md:text-base">
            Consulta Traffic Report oficial para tu cuenta Seller: impresiones,
            vistas, CTR, transacciones y conversión. Estos datos describen
            únicamente tu cuenta; no prueban ventas ni rendimiento de competidores.
          </p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-black/30 p-5 md:p-7">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end">
            <label className="grid gap-2 text-sm font-bold text-white/75">
              Desde
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => setDateFrom(event.target.value)}
                className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-white"
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-white/75">
              Hasta
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={isoDay(new Date())}
                onChange={(event) => setDateTo(event.target.value)}
                className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-white"
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-white/75">
              Listing IDs opcionales
              <input
                type="text"
                inputMode="numeric"
                value={listingIds}
                onChange={(event) => setListingIds(event.target.value)}
                placeholder="123456789, 987654321"
                className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-white placeholder:text-white/25"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadReport()}
              disabled={loading}
              className="min-h-12 rounded-2xl bg-cyan-200 px-6 font-black text-black disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Consultando…" : "Consultar eBay"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-white/50">
              Máximo 90 días
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-white/50">
              Hasta 200 listings
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-white/50">
              Vacío = sólo listings propios verificados
            </span>
            {configurationReady !== null && (
              <span className={`rounded-full border px-3 py-1.5 ${configurationReady ? "border-emerald-200/30 text-emerald-100" : "border-rose-200/30 text-rose-100"}`}>
                OAuth Seller {configurationReady ? "configurado" : "pendiente"}
              </span>
            )}
          </div>
          {error && (
            <div className="mt-5 rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-4 text-sm font-semibold text-rose-50">
              {error}
              {error.includes("sesión Admin") && (
                <a className="ml-2 underline" href="/admin/login?returnTo=%2Fadmin%2Febay%2Fseller-performance">
                  Iniciar sesión
                </a>
              )}
              {errorCode === "EBAY_VERIFIED_LISTING_REQUIRED" && (
                <a className="mt-3 flex min-h-11 w-fit items-center rounded-xl bg-white px-4 font-black text-black" href="/admin/ebay/listings/register">
                  Registrar primer listing
                </a>
              )}
            </div>
          )}
        </section>

        {learning && <section className="rounded-3xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-100/60">Aprendizaje prudente del OS</p><h2 className="mt-2 text-2xl font-black">{learning.status === "STORED_ELIGIBLE_ADJUSTMENTS" ? "Calibración por categoría activa" : learning.status === "STORED_COLLECTING" ? "Recopilando evidencia propia" : "Sin aprendizaje almacenado todavía"}</h2></div><span className="rounded-full border border-emerald-200/25 px-3 py-1 text-xs font-black">Consulta visual · {listingSelection?.count ?? 0} listings · no entrena</span></div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-white/65">Esta pantalla sólo lee el reporte y el estado de aprendizaje ya almacenado. La automatización recopila períodos canónicos de 14 días completos y únicamente datos posteriores a la verificación. El ajuste puede afectar el orden —máximo ±5 puntos— después de 10 listings de la misma categoría/versión y 500 impresiones; identidad, stock, margen y restricciones nunca se relajan.</p>
          {learning.error && <p className="mt-4 rounded-2xl border border-amber-200/20 p-3 text-sm text-amber-50">No se pudo leer el estado almacenado: {learning.error.replaceAll("_", " ")}. Esta consulta no guardó evidencia ni cambió el ranking.</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">{(learning.categoryLearning ?? []).map((category) => <article key={category.categoryId} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><strong>Categoría {category.categoryId}</strong><span className="text-xs font-black text-emerald-100">{category.status === "ELIGIBLE_APPLIED" ? `${category.adjustmentPoints >= 0 ? "+" : ""}${category.adjustmentPoints} pts` : "0 pts"}</span></div><p className="mt-2 text-xs leading-5 text-white/55">Muestra: {category.sampleListingCount} listings · {category.minimumObservationDays} días · {numberFormatter.format(category.totalImpressions)} impresiones.</p>{category.status === "COLLECTING" && <p className="mt-2 text-xs text-amber-100">Faltan {category.remainingRequirements.linkedListings} listings, {category.remainingRequirements.observationDays} días y {numberFormatter.format(category.remainingRequirements.totalImpressions)} impresiones.</p>}</article>)}</div>
        </section>}

        {dashboard && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard label="Impresiones" value={numberFormatter.format(dashboard.summary.totalImpressions)} detail="Apariciones totales reportadas por eBay." />
              <SummaryCard label="Vistas" value={numberFormatter.format(dashboard.summary.totalViews)} detail="Aperturas totales de páginas de listing." />
              <SummaryCard label="CTR calculado" value={formatPercent(dashboard.summary.clickThroughRate)} detail="Vistas desde búsqueda ÷ impresiones en búsqueda." />
              <SummaryCard label="Transacciones" value={numberFormatter.format(dashboard.summary.transactions)} detail="Transacciones completadas en el período." />
              <SummaryCard label="Conversión" value={formatPercent(dashboard.summary.salesConversionRate)} detail="Transacciones ÷ vistas totales." />
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-white/40">
                    Tendencia oficial
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    {dashboard.dimension === "DAY" ? "Por día" : "Por listing"}
                  </h2>
                </div>
                <p className="text-xs text-white/45">
                  Actualizado por eBay: {formatDateTime(dashboard.lastUpdatedDate)}
                </p>
              </div>
              {chartRows.length ? (
                <div className="mt-6 h-80 w-full" aria-label="Gráfico de rendimiento eBay">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="label" stroke="rgba(255,255,255,0.45)" tickLine={false} minTickGap={24} />
                      <YAxis yAxisId="volume" stroke="rgba(255,255,255,0.45)" tickLine={false} axisLine={false} />
                      <YAxis yAxisId="sales" orientation="right" stroke="rgba(255,255,255,0.45)" tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#090d16", border: "1px solid rgba(255,255,255,.14)", borderRadius: 16 }} />
                      <Legend />
                      <Line yAxisId="volume" type="monotone" dataKey="impresiones" stroke="#67e8f9" strokeWidth={2} dot={false} />
                      <Line yAxisId="volume" type="monotone" dataKey="vistas" stroke="#6ee7b7" strokeWidth={2} dot={false} />
                      <Line yAxisId="sales" type="monotone" dataKey="transacciones" stroke="#fbbf24" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-6 rounded-2xl border border-white/10 p-5 text-white/55">
                  eBay no devolvió registros para este rango.
                </p>
              )}
            </section>

            <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/25">
              <div className="border-b border-white/10 p-5 md:p-7">
                <h2 className="text-2xl font-black">Detalle del reporte</h2>
                <p className="mt-2 text-sm text-white/50">
                  Dimensión: {dashboard.dimensionLabel} · {dashboard.rows.length} registros
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-white/45">
                    <tr>
                      <th className="px-5 py-4">{dashboard.dimension === "DAY" ? "Día" : "Listing ID"}</th>
                      <th className="px-5 py-4">Impresiones</th>
                      <th className="px-5 py-4">Vistas</th>
                      <th className="px-5 py-4">CTR</th>
                      <th className="px-5 py-4">Transacciones</th>
                      <th className="px-5 py-4">Conversión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.rows.map((row) => (
                      <tr key={row.dimension} className="border-t border-white/[0.07]">
                        <td className="whitespace-nowrap px-5 py-4 font-bold text-cyan-100">{dimensionLabel(row.dimension, dashboard.dimension)}</td>
                        <td className="px-5 py-4">{formatMetric(metric(row, "TOTAL_IMPRESSION_TOTAL"))}</td>
                        <td className="px-5 py-4">{formatMetric(metric(row, "LISTING_VIEWS_TOTAL"))}</td>
                        <td className="px-5 py-4">{formatPercent(rowClickThroughRate(row))}</td>
                        <td className="px-5 py-4">{formatMetric(metric(row, "TRANSACTION"))}</td>
                        <td className="px-5 py-4">{formatPercent(rowSalesConversionRate(row))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {dashboard.warnings.length > 0 && (
              <section className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.06] p-5 text-sm text-amber-50">
                <h2 className="font-black">Advertencias de eBay</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  {dashboard.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </section>
            )}
          </>
        )}

        <footer className="rounded-3xl border border-emerald-300/15 bg-emerald-300/[0.05] p-5 text-sm leading-7 text-white/60">
          <strong className="text-emerald-100">Límites de seguridad:</strong> solo GET oficial de
          eBay Analytics, acceso Admin obligatorio, refresh token únicamente en
          servidor, sin drafts, ofertas, publicaciones ni datos de competidores.
        </footer>
      </section>
      <SellerOsMobileNav active="operations" />
    </main>
  )
}
