"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  CommercialListingReadModel,
  CalculatedNumericObservation,
  CommercialMetricKey,
  CommercialMonitorGetDto,
  DataQualityIssue,
  Observation,
} from "@/lib/ebay/commercial-monitor-readonly-contract"
import { supabase } from "@/lib/supabase"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type ApiPayload = {
  success?: boolean
  error?: string
  monitor?: CommercialMonitorGetDto
}

const numberFormatter = new Intl.NumberFormat("es-US", {
  maximumFractionDigits: 2,
})

const metricLabels: Record<CommercialMetricKey, string> = {
  listing_price: "Precio del listing",
  impressions: "Impresiones",
  ebay_views: "Vistas eBay calculadas",
  external_views: "Vistas externas",
  ctr_reported: "CTR reportado",
  ctr_calculated: "CTR calculado",
  watchers: "Watchers",
  transactions: "Transacciones Analytics",
  orders: "Órdenes observadas",
  units_sold: "Unidades observadas",
  conversion: "Conversión reportada",
  revenue: "Ingresos observados",
  fees: "Fees",
  promoted_fees: "Promoted fees",
  supplier_cost: "Costo proveedor",
  shipping: "Envío",
  contribution: "Contribución",
  net_profit: "Beneficio neto",
  margin: "Margen",
  roi: "ROI",
}

const statusTone: Record<string, string> = {
  AVAILABLE: "border-emerald-200/30 bg-emerald-200/[0.10] text-emerald-50",
  CERTIFIED: "border-emerald-200/30 bg-emerald-200/[0.10] text-emerald-50",
  COMPLETE: "border-emerald-200/30 bg-emerald-200/[0.10] text-emerald-50",
  FRESH: "border-emerald-200/30 bg-emerald-200/[0.10] text-emerald-50",
  IN_STOCK_SIGNAL: "border-emerald-200/30 bg-emerald-200/[0.10] text-emerald-50",
  PARTIAL: "border-amber-200/30 bg-amber-200/[0.10] text-amber-50",
  MISSING: "border-amber-200/30 bg-amber-200/[0.10] text-amber-50",
  UNPROVEN: "border-amber-200/30 bg-amber-200/[0.10] text-amber-50",
  UNKNOWN: "border-white/15 bg-white/[0.06] text-white/70",
  UNAVAILABLE: "border-white/15 bg-white/[0.06] text-white/70",
  INSUFFICIENT_EVIDENCE: "border-white/15 bg-white/[0.06] text-white/70",
  STOCK_UNKNOWN: "border-white/15 bg-white/[0.06] text-white/70",
  STALE: "border-orange-200/30 bg-orange-200/[0.10] text-orange-50",
  ERROR: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  BLOCKED: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  OUT_OF_STOCK_SIGNAL: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  STOCK_CONFLICTED: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  SOURCE_FORMAT_CHANGED: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  BLOCKER: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  CRITICAL: "border-rose-200/30 bg-rose-200/[0.10] text-rose-50",
  HIGH: "border-orange-200/30 bg-orange-200/[0.10] text-orange-50",
  MEDIUM: "border-amber-200/30 bg-amber-200/[0.10] text-amber-50",
  LOW: "border-white/15 bg-white/[0.06] text-white/70",
}

function Status({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone[value] ?? statusTone.UNKNOWN}`}>
      {value.replaceAll("_", " ")}
    </span>
  )
}

function formatNumber(value: number | null) {
  return value === null ? "—" : numberFormatter.format(value)
}

function formatTimestamp(value: string | null) {
  if (!value) return "Sin timestamp"
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "Timestamp inválido"
}

function shortCode(value: string | null) {
  return value ? value.replaceAll("_", " ") : "Sin limitación reportada"
}

function humanError(code: string) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "La sesión Admin expiró. Vuelve a iniciar sesión.",
    ADMIN_FORBIDDEN: "La cuenta autenticada no tiene permisos de administrador.",
    COMMERCIAL_MONITOR_PREVIEW_ONLY:
      "Commercial Monitor está aislado de Production.",
    COMMERCIAL_MONITOR_ASSISTANT_DTO_SANITIZATION_FAILED:
      "La respuesta fue bloqueada por el filtro de datos sensibles.",
    COMMERCIAL_MONITOR_READONLY_REQUEST_FAILED:
      "No se pudo construir la lectura comercial sanitizada.",
  }
  return messages[code] ?? "No se pudo consultar Commercial Monitor. Intenta nuevamente."
}

function isCalculatedObservation(
  observation: Observation<number>,
): observation is CalculatedNumericObservation {
  return "calculation" in observation &&
    Boolean((observation as CalculatedNumericObservation).calculation)
}

function MetricValue({ observation }: { observation: Observation<number> }) {
  return (
    <div className="min-w-[180px] rounded-2xl border border-white/10 bg-black/25 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-xl">{formatNumber(observation.value)}{observation.value !== null && observation.unit ? ` ${observation.unit}` : ""}</strong>
        <Status value={observation.availability} />
      </div>
      <dl className="mt-3 space-y-1 text-[11px] leading-5 text-white/55">
        <div><dt className="inline font-bold text-white/75">Completitud: </dt><dd className="inline">{observation.completeness}</dd></div>
        <div><dt className="inline font-bold text-white/75">Grano: </dt><dd className="inline">{observation.grain}</dd></div>
        <div><dt className="inline font-bold text-white/75">Fuente: </dt><dd className="inline break-all">{observation.source.system} · {observation.source.operation}</dd></div>
        <div><dt className="inline font-bold text-white/75">Evidencia: </dt><dd className="inline break-all">{observation.source.evidenceReference ?? "Sin referencia"}</dd></div>
        <div><dt className="inline font-bold text-white/75">Captura: </dt><dd className="inline">{formatTimestamp(observation.capturedAt)}</dd></div>
        <div><dt className="inline font-bold text-white/75">Frescura: </dt><dd className="inline">{observation.freshness.status}</dd></div>
        <div><dt className="inline font-bold text-white/75">Ventana: </dt><dd className="inline">{observation.reportingWindow ? `${observation.reportingWindow.start} → ${observation.reportingWindow.end} · ${observation.reportingWindow.timeZone}` : "No aplica / no informada"}</dd></div>
        {observation.limitationCode && <div><dt className="inline font-bold text-amber-100">Limitación: </dt><dd className="inline text-amber-50/80">{shortCode(observation.limitationCode)}</dd></div>}
        {isCalculatedObservation(observation) && <><div><dt className="inline font-bold text-cyan-100">Fórmula: </dt><dd className="inline">{observation.calculation.formula} · {observation.calculation.version}</dd></div><div><dt className="inline font-bold text-cyan-100">Inputs: </dt><dd className="inline break-all">{observation.calculation.inputEvidenceReferences.join(" · ") || "Sin referencias"}</dd></div><div><dt className="inline font-bold text-cyan-100">Valores de input: </dt><dd className="inline break-all">{observation.calculation.inputs.map((entry) => `${entry.name}=${entry.value}${entry.unit ? ` ${entry.unit}` : ""} @ ${formatTimestamp(entry.capturedAt)}`).join(" · ") || "Sin inputs calculables"}</dd></div></>}
      </dl>
    </div>
  )
}

function HeroCard({ label, value, detail }: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/55">{detail}</p>
    </article>
  )
}

function issueSummary(issue: DataQualityIssue) {
  return `${issue.code.replaceAll("_", " ")} · ${issue.domain} · ${issue.blocking ? "BLOCKER" : "CALIDAD"}`
}

export function CommercialMonitorReadonlyClient() {
  const [monitor, setMonitor] = useState<CommercialMonitorGetDto | null>(null)
  const [selectedKey, setSelectedKey] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [refreshFailedAt, setRefreshFailedAt] = useState("")

  const loadMonitor = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/monitor", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      })
      const payload = await response.json() as ApiPayload
      if (response.status === 401) throw new Error("AUTH_REQUIRED")
      if (response.status === 403) {
        throw new Error(payload.error === "COMMERCIAL_MONITOR_PREVIEW_ONLY"
          ? payload.error
          : "ADMIN_FORBIDDEN")
      }
      if (!response.ok || !payload.success || !payload.monitor) {
        throw new Error(payload.error || "COMMERCIAL_MONITOR_READONLY_REQUEST_FAILED")
      }
      setMonitor(payload.monitor)
      setRefreshFailedAt("")
      setSelectedKey((current) =>
        current && payload.monitor?.listings.some((listing) => listing.key === current)
          ? current
          : payload.monitor?.listings[0]?.key ?? ""
      )
    } catch (requestError) {
      const code = requestError instanceof Error
        ? requestError.message
        : "COMMERCIAL_MONITOR_READONLY_REQUEST_FAILED"
      setError(humanError(code))
      setRefreshFailedAt(new Date().toISOString())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMonitor()
  }, [loadMonitor])

  const selected = useMemo(() =>
    monitor?.listings.find((listing) => listing.key === selectedKey) ??
      monitor?.listings[0] ?? null,
  [monitor, selectedKey])

  const allIssues = useMemo(() => {
    if (!monitor) return []
    return [...monitor.accountDataQualityIssues.map((issue) => ({
      listing: null,
      issue,
    })), ...new Map(monitor.listings.flatMap((listing) =>
      listing.dataQualityIssues.map((issue) => [
        `${listing.key}:${issue.code}:${issue.source}`,
        { listing, issue },
      ]),
    )).values()]
  }, [monitor])

  const blockerCount = monitor
    ? monitor.listings.reduce(
        (total, listing) => total + listing.blockers.length,
        monitor.accountDataQualityIssues.filter((issue) => issue.blocking).length,
      )
    : undefined

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-5 text-white sm:px-6 md:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <nav aria-label="Commercial Monitor" className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.16em]">
          <a href="/admin/ebay-seller-os" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Seller OS</a>
          <a href="#listings" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Listings</a>
          <a href="#traffic" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Métricas</a>
          <a href="#data-quality" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Calidad</a>
        </nav>

        <header className="overflow-hidden rounded-[32px] border border-cyan-200/15 bg-gradient-to-br from-cyan-200/[0.12] via-white/[0.035] to-emerald-200/[0.08] p-6 md:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-100/35 bg-cyan-100 px-3 py-1.5 text-[11px] font-black text-black">READ-ONLY</span>
              <span className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-black text-white/70">COMMERCIAL MONITOR V1</span>
            </div>
            <button
              type="button"
              onClick={() => void loadMonitor()}
              disabled={loading}
              className="min-h-12 rounded-2xl bg-white px-5 text-sm font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Leyendo…" : "Actualizar datos"}
            </button>
          </div>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.26em] text-cyan-100/60">Cockpit operativo y diagnóstico</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight md:text-6xl">Estado comercial verificable, sin ejecutar cambios</h1>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-white/65 md:text-base">Cada valor conserva fuente, timestamp, grano, ventana y estado. UNKNOWN, UNAVAILABLE, ERROR, PARTIAL y MISSING nunca se presentan como cero.</p>
        </header>

        <div aria-live="polite">
          {loading && !monitor && <p role="status" className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.06] p-6 text-cyan-50">Consultando únicamente readers eBay allowlisted y fuentes internas SELECT-only; no se ejecutan escrituras ni dispatch.</p>}
          {error && <p role="alert" className="rounded-3xl border border-rose-200/25 bg-rose-200/[0.08] p-5 text-rose-50">{error}{monitor && refreshFailedAt ? ` La vista conserva la lectura anterior; refresh fallido ${formatTimestamp(refreshFailedAt)}.` : ""}</p>}
        </div>

        {monitor && <>
          <section id="summary" aria-labelledby="summary-heading" className="scroll-mt-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">Resumen</p><h2 id="summary-heading" className="mt-1 text-2xl font-black">Cobertura antes que optimismo</h2></div>
              <p className="text-xs text-white/50">Generado <time dateTime={monitor.generatedAt}>{formatTimestamp(monitor.generatedAt)}</time></p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HeroCard label="Listings representados" value={monitor.discoveryCoverage.status !== "COMPLETE" && monitor.listings.length === 0 ? "—" : numberFormatter.format(monitor.listings.length)} detail={monitor.discoveryCoverage.status !== "COMPLETE" && monitor.listings.length === 0 ? "La falta o parcialidad de evidencia no demuestra cero listings." : "Registros reconciliados más descubrimientos live visibles no registrados."} />
              <HeroCard label="Cobertura" value={monitor.discoveryCoverage.status} detail={monitor.discoveryCoverage.knownGapCodes.map(shortCode).join(" · ")} />
              <HeroCard label="Blockers" value={blockerCount === undefined ? "—" : numberFormatter.format(blockerCount)} detail="Separados de cualquier recomendación comercial." />
              <HeroCard label="Alert candidates" value={numberFormatter.format(monitor.alertCandidates.length)} detail="Candidatos internos; dispatchAllowed=false." />
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                <p className="text-xs font-black uppercase tracking-widest text-white/45">Conexión y cuenta</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><Status value={monitor.connection.status} /><Status value={monitor.liveCertification.status} /><span className="text-sm text-white/65">{monitor.marketplace.marketplaceId} · {monitor.marketplace.accountAlias ?? "Cuenta no configurada"}</span></div>
                <p className="mt-3 text-xs leading-5 text-white/50">{monitor.liveCertification.environment} · binding {monitor.liveCertification.account.bindingMatched ? "verificado" : "no probado"} · {monitor.liveCertification.account.source} · {formatTimestamp(monitor.liveCertification.account.observedAt)}</p>
                {monitor.liveCertification.account.limitationCode && <p className="mt-2 text-xs text-amber-100/75">{shortCode(monitor.liveCertification.account.limitationCode)}</p>}
              </article>
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                <h3 className="font-black">Lectores y frescura</h3>
                <div className="mt-3 grid gap-2 md:grid-cols-2">{monitor.connection.readers.map((reader) => <div key={reader.source} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs break-all">{reader.source}</strong><Status value={reader.status} /></div><p className="mt-2 text-[11px] text-white/50">{formatTimestamp(reader.observedAt)} · {shortCode(reader.limitationCode)}</p></div>)}</div>
              </article>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                <p className="text-xs font-black uppercase tracking-widest text-white/45">Discovery live</p>
                <div className="mt-3 flex flex-wrap gap-2"><Status value={monitor.liveCertification.discovery.status} /><Status value={monitor.liveCertification.discovery.coverage} /></div>
                <p className="mt-3 text-xs leading-5 text-white/55">Páginas {monitor.liveCertification.discovery.pagesRead}/{monitor.liveCertification.discovery.totalPages ?? "?"} · Items reportados {monitor.liveCertification.discovery.sellerWideItemsReported ?? "UNKNOWN"} · parseados {monitor.liveCertification.discovery.sellerWideItemsParsed ?? "UNKNOWN"}</p>
                <p className="mt-2 text-xs leading-5 text-white/55">EBAY_US certificados {monitor.liveCertification.discovery.sellerWideItemsMarketplaceCertifiedUs ?? "UNKNOWN"} · no-US {monitor.liveCertification.discovery.sellerWideItemsMarketplaceCertifiedNonUs ?? "UNKNOWN"} · no resueltos {monitor.liveCertification.discovery.sellerWideItemsMarketplaceUnresolved ?? "UNKNOWN"}</p>
                <p className="mt-2 text-xs leading-5 text-white/55">Errores {monitor.liveCertification.discovery.sellerWideItemsMarketplaceError ?? "UNKNOWN"} · Item ID mismatch {monitor.liveCertification.discovery.sellerWideItemsMarketplaceItemIdMismatch ?? "UNKNOWN"} · presupuesto agotado {monitor.liveCertification.discovery.sellerWideItemsMarketplaceBudgetExhausted ?? "UNKNOWN"} · representados {monitor.liveCertification.discovery.sellerWideItemsRepresented ?? "UNKNOWN"} · filas de variación {monitor.liveCertification.discovery.variationRowCount ?? "UNKNOWN"}</p>
                {typeof monitor.liveCertification.discovery.sellerWideItemsReported === "number" && monitor.liveCertification.discovery.sellerWideItemsReported > 0 && monitor.liveCertification.discovery.sellerWideItemsRepresented === 0 && monitor.liveCertification.discovery.coverage !== "COMPLETE" && <p className="mt-2 text-[11px] text-amber-100/75">eBay reportó identidades activas; cero representadas no demuestra cero listings.</p>}
                <p className="mt-2 text-[11px] text-white/45">{monitor.liveCertification.discovery.gapCodes.map(shortCode).join(" · ") || "Sin gaps declarados"}</p>
              </article>
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><p className="text-xs font-black uppercase tracking-widest text-white/45">Analytics / Órdenes</p><div className="mt-3 flex flex-wrap gap-2"><Status value={monitor.liveCertification.analytics.status} /><Status value={monitor.liveCertification.analytics.analyticsCoverageStatus} /><Status value={monitor.liveCertification.orders.status} /></div><p className="mt-3 text-xs leading-5 text-white/55">Analytics solicitados {monitor.liveCertification.analytics.analyticsRequestedItemCount ?? "UNKNOWN"} · representados {monitor.liveCertification.analytics.analyticsRepresentedItemCount ?? "UNKNOWN"} · faltantes {monitor.liveCertification.analytics.analyticsMissingItemCount ?? "UNKNOWN"} · Orders sanitizadas {monitor.liveCertification.orders.sanitizedOrderCount ?? "UNKNOWN"}</p><p className="mt-2 text-[11px] text-white/45">Ventana Analytics {monitor.liveCertification.analytics.windowStart ?? "UNKNOWN"} → {monitor.liveCertification.analytics.windowEnd ?? "UNKNOWN"}</p><p className="mt-2 text-[11px] text-white/45">{monitor.liveCertification.analytics.gapCodes.map(shortCode).join(" · ") || "Sin gaps Analytics declarados"}</p></article>
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><p className="text-xs font-black uppercase tracking-widest text-white/45">OAuth sanitizado</p><div className="mt-3 flex flex-wrap gap-2"><Status value={monitor.liveCertification.oauth.status} /><span className="text-xs text-white/55">token recibido {String(monitor.liveCertification.oauth.tokenReceived)} · persistido false · devuelto false</span></div><p className="mt-3 text-[11px] text-white/45">Expiración efímera {formatTimestamp(monitor.liveCertification.oauth.earliestAccessTokenExpiryAt)}</p><ul className="mt-2 space-y-1 text-[10px] text-white/45">{monitor.liveCertification.oauth.scopes.map((scope) => <li key={scope.scope} className="break-all">{scope.scope} · {scope.classifications.join(" + ")}</li>)}</ul></article>
            </div>
          </section>

          <section id="listings" aria-labelledby="listings-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">Listings</p><h2 id="listings-heading" className="mt-1 text-2xl font-black">Identidad, descubrimiento y Product Case</h2></div>{monitor.listings.length > 0 && <label className="grid gap-1 text-xs font-bold text-white/60">Detalle activo<select value={selected?.key ?? ""} onChange={(event) => setSelectedKey(event.target.value)} className="min-h-11 max-w-sm rounded-xl border border-white/15 bg-[#0b101b] px-3 text-white">{monitor.listings.map((listing) => <option key={listing.key} value={listing.key}>{listing.identity.itemId} · {listing.identity.sku ?? "sin SKU"}</option>)}</select></label>}</div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <caption className="sr-only">Listings eBay representados por la evidencia disponible</caption>
                <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th scope="col" className="pb-3 pr-4">Identidad</th><th scope="col" className="pb-3 pr-4">Descubrimiento</th><th scope="col" className="pb-3 pr-4">Producto</th><th scope="col" className="pb-3 pr-4">Product Case</th><th scope="col" className="pb-3">Acción informativa</th></tr></thead>
                <tbody>{monitor.listings.map((listing) => <tr key={listing.key} className="border-t border-white/10 align-top"><td className="py-4 pr-4"><strong>{listing.identity.title ?? "Título no probado"}</strong><p className="mt-1 text-xs text-white/55">Item {listing.identity.itemId}</p><p className="text-xs text-white/55">SKU: {listing.identity.sku ?? "UNKNOWN"}</p><p className="text-xs text-white/55">Custom Label: {listing.identity.customLabel ?? "UNKNOWN"}</p><p className="text-xs text-white/55">Variación: {listing.identity.variationKey ?? "UNKNOWN"}</p></td><td className="py-4 pr-4"><Status value={listing.discovery.coverage.status} /><p className="mt-2 text-xs text-white/55">{listing.discovery.registryStatus}</p><p className="text-xs text-white/55">Marketplace {listing.identity.marketplaceCertification.status} · {listing.identity.marketplaceCertification.source ?? "fuente no probada"} · grain {listing.identity.marketplaceCertification.grain}</p><p className="text-xs text-white/55">{formatTimestamp(listing.identity.marketplaceCertification.observedAt)}</p><p className="text-xs text-white/55">{listing.identity.source} · {listing.identity.freshness.status}</p><p className="text-xs text-white/55">{formatTimestamp(listing.identity.lastObservedAt)}</p><ul className="mt-2 space-y-1 text-[10px] text-white/45">{listing.discovery.observations.map((observation) => <li key={observation.evidenceReference}>{observation.source} · {observation.listingStatus} · {observation.freshness.status} · {formatTimestamp(observation.observedAt)}</li>)}</ul></td><td className="py-4 pr-4"><Status value={listing.identity.listingState.toUpperCase()} /><p className="mt-2 text-xs text-white/55">{listing.identity.listingType} · {listing.identity.listingFormat ?? "formato UNKNOWN"}</p><p className="text-xs text-white/55">Inicio {formatTimestamp(listing.identity.startTime)} · Moneda {listing.identity.currency ?? "UNKNOWN"}</p><p className="text-xs text-white/55">GTIN {listing.identity.gtin ?? "UNKNOWN"} · Brand {listing.identity.brand ?? "UNKNOWN"} · MPN {listing.identity.mpn ?? "UNKNOWN"}</p></td><td className="py-4 pr-4"><Status value={listing.productCase.status} />{listing.productCase.status === "AVAILABLE" ? <dl className="mt-2 text-xs text-white/55"><div><dt className="inline font-bold">ID: </dt><dd className="inline">{listing.productCase.productCaseId}</dd></div><div><dt className="inline font-bold">Versión: </dt><dd className="inline">{listing.productCase.versionId ?? "UNKNOWN"} · {listing.productCase.versionStatus ?? "UNKNOWN"}</dd></div><div><dt className="inline font-bold">Verificado: </dt><dd className="inline">{formatTimestamp(listing.productCase.checkedAt)}</dd></div></dl> : <p className="mt-2 text-xs text-amber-50/80">{listing.productCase.blocker}</p>}</td><td className="py-4"><strong className="text-cyan-50">{listing.informationalNextAction.replaceAll("_", " ")}</strong><p className="mt-2 text-xs text-white/50">{listing.blockers.length} blocker(s) · sólo humano</p></td></tr>)}</tbody>
              </table>
            </div>
            {monitor.listings.length === 0 && <p className="mt-5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm text-amber-50">No hay listings representables con las fuentes disponibles. Esto no prueba que la cuenta tenga cero listings.</p>}
          </section>

          <section id="components" aria-labelledby="components-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-violet-100/60">Kits y componentes</p><h2 id="components-heading" className="mt-1 text-2xl font-black">Composición sin inferencia desde el título</h2>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">{monitor.listings.map((listing) => <article key={listing.key} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Item {listing.identity.itemId}</strong><Status value={listing.composition.status} /></div><dl className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-2"><div><dt className="font-bold text-white/75">Tipo</dt><dd>{listing.composition.listingType}</dd></div><div><dt className="font-bold text-white/75">Componentes</dt><dd>{listing.composition.components.length ? numberFormatter.format(listing.composition.components.length) : "UNKNOWN"}</dd></div><div><dt className="font-bold text-white/75">Limitante</dt><dd>{listing.composition.limitingComponentId ?? "UNKNOWN"}</dd></div><div><dt className="font-bold text-white/75">Capacidad</dt><dd>{formatNumber(listing.composition.bundleCapacity.value)} · {listing.composition.bundleCapacity.availability}</dd></div></dl>{listing.composition.components.length > 0 && <ul className="mt-3 space-y-2 text-xs text-white/55">{listing.composition.components.map((component) => <li key={component.componentId} className="rounded-xl border border-white/10 p-2"><strong>{component.componentId}</strong> · SKU {component.supplierSku ?? "UNKNOWN"} · requerido {component.quantityRequired}<p className="mt-1 break-all text-[10px] text-white/40">{component.evidenceReferences.map((entry) => entry.reference).join(" · ") || "Sin evidencia"}</p></li>)}</ul>}<p className="mt-3 text-xs text-amber-50/70">{shortCode(listing.composition.limitationCode)}</p></article>)}</div>
          </section>

          <section id="stock" aria-labelledby="stock-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-emerald-100/60">Stock Guard</p><h2 id="stock-heading" className="mt-1 text-2xl font-black">Stock, costo y frescura exactos</h2>
            <div className="mt-5 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><caption className="sr-only">Estado de stock y costo de componentes exactos</caption><thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th scope="col" className="pb-3 pr-4">Listing</th><th scope="col" className="pb-3 pr-4">Estado</th><th scope="col" className="pb-3 pr-4">Componente</th><th scope="col" className="pb-3 pr-4">Cantidad</th><th scope="col" className="pb-3 pr-4">Costo</th><th scope="col" className="pb-3">Frescura / parser / evidencia</th></tr></thead><tbody>{monitor.listings.map((listing) => <tr key={listing.key} className="border-t border-white/10 align-top"><td className="py-4 pr-4">{listing.identity.itemId}<p className="text-xs text-white/50">{listing.identity.sku ?? "sin SKU"}</p></td><td className="py-4 pr-4"><Status value={listing.stock.state} /></td><td className="py-4 pr-4 text-xs">{listing.stock.supplierVariantId ?? "UNKNOWN"}<p className="text-white/50">{listing.stock.supplierSku ?? "sin SKU proveedor"}</p></td><td className="py-4 pr-4">{formatNumber(listing.stock.quantity.value)}{listing.stock.quantity.value !== null && listing.stock.quantity.unit ? ` ${listing.stock.quantity.unit}` : ""}<p className="text-xs text-white/50">{listing.stock.quantity.availability} · {formatTimestamp(listing.stock.quantity.capturedAt)}</p></td><td className="py-4 pr-4">{formatNumber(listing.stock.currentSupplierCost.value)}{listing.stock.currentSupplierCost.value !== null && listing.stock.currentSupplierCost.unit ? ` ${listing.stock.currentSupplierCost.unit}` : ""}<p className="text-xs text-white/50">{listing.stock.currentSupplierCost.availability} · {formatTimestamp(listing.stock.currentSupplierCost.capturedAt)}</p></td><td className="py-4"><Status value={listing.stock.freshness.status} /><p className="mt-2 text-xs text-white/50">{listing.stock.sourceContractStatus} · {shortCode(listing.stock.limitationCode)}</p><p className="mt-1 break-all text-[10px] text-white/40">{listing.stock.evidenceReferences.map((entry) => `${entry.reference} · ${formatTimestamp(entry.capturedAt)}`).join(" · ") || "Sin evidencia exacta"}</p></td></tr>)}</tbody></table></div>
          </section>

          <section id="traffic" aria-labelledby="traffic-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-cyan-100/60">Tráfico y conversión</p><h2 id="traffic-heading" className="mt-1 text-2xl font-black">Métricas con estado, grano y ventana</h2>
            {selected ? <><p className="mt-2 text-sm text-white/55">Item {selected.identity.itemId} · Las métricas ITEM no se atribuyen a una variación.</p><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(Object.entries(selected.metrics) as Array<[CommercialMetricKey, Observation<number>]>).map(([key, observation]) => <article key={key}><h3 className="mb-2 text-xs font-black uppercase tracking-wide text-white/55">{metricLabels[key]}</h3><MetricValue observation={observation} /></article>)}</div></> : <p className="mt-4 text-sm text-white/55">No hay listing seleccionado.</p>}
          </section>

          <section id="action-plan" aria-labelledby="action-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-amber-100/60">Plan de acción</p><h2 id="action-heading" className="mt-1 text-2xl font-black">Siguientes pasos informativos y alert candidates</h2>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">{monitor.listings.map((listing) => <article key={listing.key} className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/50">Item {listing.identity.itemId}</p><h3 className="mt-1 font-black text-cyan-50">{listing.informationalNextAction.replaceAll("_", " ")}</h3><ul className="mt-3 space-y-1 text-xs text-amber-50/75">{listing.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.source}`}>• {issueSummary(blocker)}</li>)}</ul></article>)}</div>
            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {monitor.alertCandidates.map((alert) => <article key={alert.eventKey} className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{alert.reasonCode.replaceAll("_", " ")}</strong><Status value={alert.severity} /></div>
                <p className="mt-2 text-xs text-white/55">{alert.listingReference.scope === "ACCOUNT" ? "Cuenta" : `Item ${alert.listingReference.itemId}`} · {alert.recommendedHumanDestination.replaceAll("_", " ")}</p>
                {alert.componentReference && <p className="mt-1 text-xs text-white/55">Componente {alert.componentReference.componentId} · SKU {alert.componentReference.sku ?? "UNKNOWN"}</p>}
                <p className="mt-1 text-xs text-white/50">Frescura {alert.freshness.status} · {formatTimestamp(alert.freshness.capturedAt)}</p>
                <p className="mt-2 break-all text-[10px] text-white/35">eventKey {alert.eventKey}</p>
                <p className="mt-2 break-all text-[10px] text-white/40">{alert.supportingEvidence.map((entry) => entry.reference).join(" · ") || "Gap de cobertura sin evidencia de listing"}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-xl bg-black/25 p-2"><dt>dispatchAllowed</dt><dd className="mt-1 font-black">{String(alert.dispatchAllowed)}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt>whatsappCalled</dt><dd className="mt-1 font-black">{String(alert.whatsappCalled)}</dd></div><div className="rounded-xl bg-black/25 p-2"><dt>deliveryAttempted</dt><dd className="mt-1 font-black">{String(alert.deliveryAttempted)}</dd></div></dl>
              </article>)}
            </div>
            {monitor.alertCandidates.length === 0 && <p className="mt-4 rounded-2xl border border-white/10 p-4 text-sm text-white/55">No hay candidatos soportados por la evidencia disponible. Esto no prueba ausencia de riesgo.</p>}
          </section>

          <section id="experiments" aria-labelledby="experiments-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-violet-100/60">Experimentos</p><h2 id="experiments-heading" className="mt-1 text-2xl font-black">Protección de variables congeladas</h2><p className="mt-2 text-sm text-white/55">Un estado RUNNING autoritativo produciría NO_TOCAR. La ausencia del registro no se interpreta como “sin experimento”.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">{monitor.listings.map((listing) => <article key={listing.key} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-2"><strong>Item {listing.identity.itemId}</strong><Status value={listing.experiment.status} /></div><p className="mt-2 text-xs text-white/55">Acción comercial: {listing.experiment.commercialAction}</p>{listing.experiment.status === "AVAILABLE" ? <dl className="mt-3 space-y-1 text-xs text-white/55"><div><dt className="inline font-bold">Experimento / estado: </dt><dd className="inline">{listing.experiment.experimentId} · {listing.experiment.lifecycleState}</dd></div><div><dt className="inline font-bold">Variable: </dt><dd className="inline">{listing.experiment.testedVariable}</dd></div><div><dt className="inline font-bold">T0 / post-change T0: </dt><dd className="inline">{listing.experiment.t0} · {listing.experiment.postChangeT0 ?? "UNKNOWN"}</dd></div><div><dt className="inline font-bold">Congeladas: </dt><dd className="inline">{listing.experiment.frozenVariables.join(", ") || "Ninguna reportada"}</dd></div><div><dt className="inline font-bold">Checkpoint / calidad: </dt><dd className="inline">{listing.experiment.checkpointGate ?? "UNKNOWN"} · {listing.experiment.dataQualityStatus}</dd></div><div><dt className="inline font-bold">Evidencia: </dt><dd className="inline">{formatTimestamp(listing.experiment.evidenceTimestamp)} · {listing.experiment.source.reference}</dd></div></dl> : <p className="mt-2 text-xs text-amber-50/70">{listing.experiment.status === "MISSING" ? "AUTHORITATIVE LOOKUP CONFIRMED NO EXPERIMENT" : "AUTHORITATIVE EXPERIMENT REGISTRY UNAVAILABLE"}</p>}</article>)}</div>
          </section>

          <section id="learning" aria-labelledby="learning-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100/60">Aprendizaje</p><h2 id="learning-heading" className="mt-1 text-2xl font-black">Calibración almacenada, sólo lectura</h2></div><Status value={monitor.learning.status} /></div><p className="mt-2 text-sm text-white/55">Fuente {monitor.learning.source} · {formatTimestamp(monitor.learning.evidenceTimestamp)} · {shortCode(monitor.learning.limitationCode)}</p>
            <div className="mt-4 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><caption className="sr-only">Ajustes históricos de aprendizaje por categoría</caption><thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th scope="col" className="pb-3">Categoría</th><th scope="col" className="pb-3">Estado</th><th scope="col" className="pb-3">Ajuste</th><th scope="col" className="pb-3">Muestra</th><th scope="col" className="pb-3">Impresiones</th><th scope="col" className="pb-3">Observación</th><th scope="col" className="pb-3">Evidencia</th></tr></thead><tbody>{monitor.learning.categoryAdjustments.map((row) => <tr key={`${row.categoryId}:${row.computedAt}`} className="border-t border-white/10 align-top"><td className="py-3">{row.categoryId}</td><td><Status value={row.status} /><p className="mt-1 text-[10px] text-white/45">{row.completeness} · eligible={String(row.eligible)}</p></td><td>{formatNumber(row.adjustmentPoints)}</td><td>{formatNumber(row.sampleListingCount)}</td><td>{formatNumber(row.totalImpressions)}</td><td>{row.minimumObservationDays} días</td><td className="max-w-xs break-all text-[10px] text-white/45">{row.source} · {row.evidenceReference} · {formatTimestamp(row.computedAt)}</td></tr>)}</tbody></table></div>
          </section>

          <section id="data-quality" aria-labelledby="quality-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-rose-100/60">Calidad de datos</p><h2 id="quality-heading" className="mt-1 text-2xl font-black">Problemas separados de recomendaciones</h2>
            <div className="mt-4 grid gap-2 md:grid-cols-2">{allIssues.map(({ listing, issue }) => <article key={`${listing?.key ?? "ACCOUNT"}:${issue.code}:${issue.source}`} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{issue.code.replaceAll("_", " ")}</strong><Status value={issue.blocking ? "BLOCKER" : issue.severity} /></div><p className="mt-2 text-[11px] text-white/50">{listing ? `Item ${listing.identity.itemId}` : "Cuenta"} · {issue.domain} · {issue.source}</p><p className="mt-1 text-[11px] text-white/45">{issue.sanitizedReasonCode}</p><p className="mt-1 break-all text-[10px] text-white/35">{issue.evidenceReferences.join(" · ") || "Sin evidencia específica"}</p></article>)}</div>
            {allIssues.length === 0 && <p className="mt-4 text-sm text-white/55">No se reportaron issues; esto no sustituye la cobertura del lector.</p>}
          </section>

          <section id="timeline" aria-labelledby="timeline-heading" className="scroll-mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-widest text-white/45">Timeline / Auditoría</p><h2 id="timeline-heading" className="mt-1 text-2xl font-black">Evidencia sanitizada por timestamp</h2>
            <ol className="mt-4 space-y-2">{monitor.timeline.map((entry, index) => <li key={`${entry.at}:${entry.kind}:${entry.listingReference.itemId ?? "account"}:${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{entry.kind}</strong><time dateTime={entry.at} className="text-xs text-white/50">{formatTimestamp(entry.at)}</time></div><p className="mt-1 text-xs text-white/55">{entry.listingReference.itemId ? `Item ${entry.listingReference.itemId}` : "Cuenta"} · {entry.evidenceReferences.join(" · ") || "Referencia agregada"}</p></li>)}</ol>
          </section>

          <aside className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.06] p-5 text-sm leading-6 text-cyan-50/80">
            <strong className="text-white">Assistant Tool Gateway contract preparado:</strong> operación <code>commercial_monitor.get</code>, DTO sanitizado y capacidades deny-by-default. Marketplace writes, buyer messages y dispatch externo permanecen en false.
          </aside>
        </>}
      </div>
      <SellerOsMobileNav active="operations" />
    </main>
  )
}
