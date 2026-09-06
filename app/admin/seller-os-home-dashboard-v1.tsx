"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, BriefcaseBusiness, CircleAlert, PackageCheck,
  RefreshCw, ShieldCheck, TrendingUp, UsersRound } from "lucide-react"

import { supabase } from "@/lib/supabase"
import {
  sellerOsOperationalStateToneV1,
  type SellerOsOperationalStateV1,
} from "@/lib/seller-os/operational-status-v1"

type HomeAuthority = Readonly<{
  publicationAuthority: boolean
  preparedReady: number | null
  actionableReady: number | null
  ownerFacts: number | null
  candidateBlockers: number | null
  liveAuthority: boolean
  postSaleAuthority: boolean
  activeListings: number | null
  liveAttention: number | null
  officialOrders: number | null
  fulfillmentPending: number | null
  postSaleExceptions: number | null
  postSaleWorking: boolean
  ebayState: SellerOsOperationalStateV1
  productResearchState: SellerOsOperationalStateV1
  productResearchCause: string
  productResearchConnection: "CONECTADA" | "DESCONECTADA" | "DESCONOCIDA"
  productResearchObservedAt: string | null
  productResearchVersion: string | null
  productResearchPlan: string | null
  lunaState: SellerOsOperationalStateV1
  lunaCause: string
  lunaConnection: "CONECTADA" | "DESCONECTADA" | "DESCONOCIDA"
  lunaObservedAt: string | null
  lunaVersion: string | null
  lunaPending: number | null
  mayelState: SellerOsOperationalStateV1
  mayelAvailable: boolean
  mayelDelegated: number | null
  mayelOwnerExceptions: number | null
  mayelRecentResults: number | null
  ownerInsights: Record<string, unknown> | null
}>

const EMPTY_AUTHORITY: HomeAuthority = Object.freeze({
  publicationAuthority: false,
  preparedReady: null,
  actionableReady: null,
  ownerFacts: null,
  candidateBlockers: null,
  liveAuthority: false,
  postSaleAuthority: false,
  activeListings: null,
  liveAttention: null,
  officialOrders: null,
  fulfillmentPending: null,
  postSaleExceptions: null,
  postSaleWorking: false,
  ebayState: "DESCONOCIDO",
  productResearchState: "DESCONOCIDO",
  productResearchCause: "OPERATIONAL_SNAPSHOT_NOT_LOADED",
  productResearchConnection: "DESCONOCIDA",
  productResearchObservedAt: null,
  productResearchVersion: null,
  productResearchPlan: null,
  lunaState: "DESCONOCIDO",
  lunaCause: "OPERATIONAL_SNAPSHOT_NOT_LOADED",
  lunaConnection: "DESCONOCIDA",
  lunaObservedAt: null,
  lunaVersion: null,
  lunaPending: null,
  mayelState: "DESCONOCIDO",
  mayelAvailable: false,
  mayelDelegated: null,
  mayelOwnerExceptions: null,
  mayelRecentResults: null,
  ownerInsights: null,
})

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function count(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function operationalState(value: unknown): SellerOsOperationalStateV1 {
  return ["OPERANDO", "SIN_TRABAJO", "RECUPERANDO", "BLOQUEADO",
    "DESCONOCIDO"].includes(String(value))
    ? value as SellerOsOperationalStateV1 : "DESCONOCIDO"
}

function connectionState(value: unknown) {
  return ["CONECTADA", "DESCONECTADA", "DESCONOCIDA"].includes(String(value))
    ? value as "CONECTADA" | "DESCONECTADA" | "DESCONOCIDA"
    : "DESCONOCIDA" as const
}

function safeIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value : null
}

function ownerTime(value: unknown) {
  const timestamp = safeIso(value)
  return timestamp ? new Intl.DateTimeFormat("es-NI", { timeZone:
    "America/Managua", month: "short", day: "numeric", hour: "numeric",
  minute: "2-digit" }).format(new Date(timestamp)) : "—"
}

function usd(value: unknown) {
  const amount = typeof value === "number" && Number.isFinite(value)
    ? value : null
  return amount === null ? "—" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD" }).format(amount)
}

function Status({ state }: { state: SellerOsOperationalStateV1 }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${sellerOsOperationalStateToneV1(state)}`}>
    {state.replace("_", " ")}
  </span>
}

function Value({ value, suffix = "" }: { value: number | null;
  suffix?: string }) {
  return <strong className="tabular-nums">{value === null
    ? "—" : `${value}${suffix}`}</strong>
}

export function SellerOsHomeDashboardV1() {
  const [authority, setAuthority] = useState(EMPTY_AUTHORITY)
  const [readState, setReadState] = useState<
    "LOADING" | "STABLE" | "PARTIAL">("LOADING")

  const request = useCallback(async (path: string) => {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.access_token) throw new Error("AUTH_REQUIRED")
    const response = await fetch(path, { cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}` } })
    const payload = await response.json().catch(() => null)
    if (!response.ok || record(payload).success !== true) {
      throw new Error("HOME_AUTHORITY_READ_FAILED")
    }
    return record(payload)
  }, [])

  const load = useCallback(async () => {
    setReadState("LOADING")
    try {
      const payload = await request("/api/admin/ebay/operational-snapshot")
      const snapshot = record(payload.snapshot)
      const publication = record(snapshot.publication)
      const business = record(snapshot.business)
      const mayel = record(snapshot.mayel)
      const capabilities = record(snapshot.capabilities)
      const researchCapability = record(capabilities.productResearch)
      const lunaCapability = record(capabilities.lunaShipping)
      setAuthority(Object.freeze({
        publicationAuthority: publication.authorityAvailable === true,
        preparedReady: count(publication.preparedReadyCount),
        actionableReady: count(publication.actionableReadyCount),
        ownerFacts: count(publication.ownerFactCount),
        candidateBlockers: count(publication.candidateBlockerCount),
        liveAuthority: business.liveAuthority === true,
        postSaleAuthority: business.postSaleAuthority === true,
        activeListings: count(business.activeListings),
        liveAttention: count(business.liveAttention),
        officialOrders: count(business.officialOrders),
        fulfillmentPending: count(business.fulfillmentPending),
        postSaleExceptions: count(business.postSaleExceptions),
        postSaleWorking: business.postSaleWorking === true,
        ebayState: operationalState(record(capabilities.ebay).state),
        productResearchState: operationalState(researchCapability.state),
        productResearchCause: String(
          researchCapability.presentationCause
            ?? "PRODUCT_RESEARCH_PRESENTATION_CAUSE_UNAVAILABLE"),
        productResearchConnection: connectionState(
          researchCapability.connectionState),
        productResearchObservedAt: safeIso(
          researchCapability.capabilityObservedAt),
        productResearchVersion: typeof researchCapability.extensionVersion ===
          "string" ? researchCapability.extensionVersion : null,
        productResearchPlan: typeof researchCapability.queuePlanState ===
          "string" ? researchCapability.queuePlanState : null,
        lunaState: operationalState(lunaCapability.state),
        lunaCause: String(lunaCapability.presentationCause
          ?? "LUNA_PRESENTATION_CAUSE_UNAVAILABLE"),
        lunaConnection: connectionState(lunaCapability.connectionState),
        lunaObservedAt: safeIso(lunaCapability.capabilityObservedAt),
        lunaVersion: typeof lunaCapability.extensionVersion === "string"
          ? lunaCapability.extensionVersion : null,
        lunaPending: count(lunaCapability.eligiblePendingJobCount),
        mayelState: operationalState(record(capabilities.mayel).state),
        mayelAvailable: mayel.authorityAvailable === true,
        mayelDelegated: count(mayel.delegatedCount),
        mayelOwnerExceptions: count(mayel.ownerExceptionCount),
        mayelRecentResults: count(mayel.recentResultCount),
        ownerInsights: snapshot.ownerInsights &&
          typeof snapshot.ownerInsights === "object"
          ? record(snapshot.ownerInsights) : null,
      }))
      setReadState(Array.isArray(snapshot.authorityFailures) &&
        snapshot.authorityFailures.length > 0 ? "PARTIAL" : "STABLE")
    } catch {
      setAuthority(EMPTY_AUTHORITY)
      setReadState("PARTIAL")
    }
  }, [request])

  useEffect(() => { void load() }, [load])

  // The global shell deliberately owns no Luna executor. Its initialization
  // state is therefore not worker evidence and may never override the durable
  // operational snapshot shown to the owner.
  const lunaState = authority.lunaState
  const postSaleState: SellerOsOperationalStateV1 =
    !authority.postSaleAuthority ? "DESCONOCIDO"
      : authority.postSaleExceptions === null ? "DESCONOCIDO"
        : authority.postSaleExceptions > 0 ? "BLOQUEADO"
        : authority.postSaleWorking ? "OPERANDO" : "SIN_TRABAJO"
  const preparedReady = authority.preparedReady
  const actionableReady = authority.actionableReady
  const facts = authority.ownerFacts
  const blocked = authority.candidateBlockers
  const nextAction = useMemo(() => {
    if (facts !== null && facts > 0) return {
      label: `Confirmar ${facts} dato${facts === 1 ? "" : "s"} comercial${facts === 1 ? "" : "es"}`,
      detail: "Sólo facts exactos que Seller OS no puede demostrar.",
      href: "/admin/ebay/quick-pick?view=needs-data",
    }
    if ((authority.liveAttention ?? 0) > 0) return {
      label: "Atender listings LIVE",
      detail: "Hay señales comprobadas en el portafolio oficial.",
      href: "/admin/ebay/monitor",
    }
    if ((authority.fulfillmentPending ?? 0) > 0) return {
      label: "Continuar fulfillment",
      detail: "Hay órdenes con una acción durable pendiente.",
      href: "/admin/ebay/sales?view=fulfillment",
    }
    if ((authority.mayelOwnerExceptions ?? 0) > 0) return {
      label: "Revisar resultados de Mayel",
      detail: "Hay resultados visuales listos para una decisión owner.",
      href: "/admin/ebay/mayel?view=results",
    }
    return null
  }, [authority, facts])

  const capabilities: readonly [string, SellerOsOperationalStateV1,
    string][] = [
    ["Publisher", "BLOQUEADO",
      "FAILED_PHYSICAL_ACCEPTANCE · no se solicitan pruebas SKU por SKU."],
    ["eBay", authority.ebayState,
      "Lectura oficial de cuenta y órdenes; HTTP 200 solo no certifica éxito."],
    ["Mayel", authority.mayelState,
      "Cola durable y resultados; la navegación no controla el runtime."],
  ]

  const insights = record(authority.ownerInsights)
  const radar = record(insights.radar)
  const listingIntegrity = record(insights.listingIntegrity)
  const activity = Array.isArray(insights.activity)
    ? insights.activity.map(record) : []

  return <div className="space-y-4" data-seller-os-home-v1
    data-home-read-only="true" data-get-business-mutations="0">
    <section className="rounded-3xl border border-cyan-200/25 bg-gradient-to-br from-cyan-200/[0.11] to-transparent p-5 sm:p-6"
      aria-labelledby="next-action-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">
            Próxima acción
          </p>
          <h2 id="next-action-heading" className="mt-2 text-2xl font-black">
            {nextAction?.label ?? (readState === "LOADING"
              ? "Comprobando la autoridad…" : "Nada requiere al owner ahora")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
            {nextAction?.detail ?? "Seller OS conserva el trabajo pendiente y volverá a presentarlo cuando exista una acción legítima."}
          </p>
        </div>
        {nextAction && <a href={nextAction.href}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-cyan-200 px-5 text-sm font-black text-cyan-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-100">
          Continuar <ArrowRight size={16} />
        </a>}
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"
        aria-labelledby="publication-heading">
        <div className="flex items-center gap-3">
          <PackageCheck className="text-emerald-200" />
          <h2 id="publication-heading" className="text-xl font-black">Publicación</h2>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Listos realmente accionables</dt><dd><Value value={actionableReady} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Preparados, en espera de Publisher</dt><dd><Value value={preparedReady} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Datos por confirmar</dt><dd><Value value={facts} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Fallos o bloqueos reales</dt><dd><Value value={blocked} /></dd></div>
        </dl>
        <div data-product-journey-entry
          className="mt-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.055] p-3">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-cyan-100/65">
            Recorrido por producto
          </p>
          <p className="mt-2 text-sm font-black text-white">
            Producto → Mercado → Rentabilidad → Anuncio → Tu aprobación → Publicación → LIVE
          </p>
          <p className="mt-1 text-xs leading-5 text-white/50">
            Abre cualquier producto para ver qué comprobó Seller OS, qué falta y si puede continuar. La evidencia técnica queda detrás del detalle.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href="/admin/ebay/publish"
            className="inline-flex min-h-11 items-center text-sm font-black text-emerald-100">
            Abrir Publicar <ArrowRight className="ml-2" size={15} />
          </a>
          <a href="/admin/ebay/publish#quick-pick-ready"
            className="inline-flex min-h-11 items-center rounded-xl border border-cyan-200/20 px-3 text-sm font-black text-cyan-100">
            Ver recorridos de productos <ArrowRight className="ml-2" size={15} />
          </a>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"
        aria-labelledby="live-business-heading">
        <div className="flex items-center gap-3">
          <BriefcaseBusiness className="text-violet-200" />
          <h2 id="live-business-heading" className="text-xl font-black">Negocio LIVE</h2>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Listings con acción</dt><dd><Value value={authority.liveAttention} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Ventas oficiales</dt><dd><Value value={authority.officialOrders} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Fulfillment pendiente</dt><dd><Value value={authority.fulfillmentPending} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Postventa</dt><dd><Status state={postSaleState} /></dd></div>
        </dl>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"
        aria-labelledby="mayel-heading">
        <div className="flex items-center gap-3">
          <UsersRound className="text-amber-100" />
          <h2 id="mayel-heading" className="text-xl font-black">Mayel</h2>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Trabajo delegado</dt><dd><Value value={authority.mayelDelegated} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Excepciones que requieren owner</dt><dd><Value value={authority.mayelOwnerExceptions} /></dd></div>
          <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Resultados recientes</dt><dd><Value value={authority.mayelRecentResults} /></dd></div>
        </dl>
        <a href="/admin/ebay/mayel"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-amber-100">
          Abrir Mayel <ArrowRight className="ml-2" size={15} />
        </a>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"
        aria-labelledby="system-state-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-cyan-200" />
            <h2 id="system-state-heading" className="text-xl font-black">
                  Estado operativo compacto
            </h2>
          </div>
          <button type="button" onClick={() => void load()}
            disabled={readState === "LOADING"} aria-label="Actualizar lecturas"
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 disabled:opacity-40">
            <RefreshCw size={16} />
          </button>
        </div>
        <dl className="mt-4 space-y-2">
          <ExtensionCapability label="Luna Shipping Capture"
            connection={authority.lunaConnection} state={lunaState}
            observedAt={authority.lunaObservedAt}
            version={authority.lunaVersion}
            queue={authority.lunaPending === null ? "DESCONOCIDA"
              : authority.lunaPending === 0 ? "VACÍA"
                : `${authority.lunaPending} PENDIENTE(S)`}
            cause={authority.lunaCause} />
          <ExtensionCapability label="Product Research"
            connection={authority.productResearchConnection}
            state={authority.productResearchState}
            observedAt={authority.productResearchObservedAt}
            version={authority.productResearchVersion}
            queue={authority.productResearchPlan ?? "DESCONOCIDO"}
            cause={authority.productResearchCause} />
          <div className="rounded-xl bg-black/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm font-black">Night Radar</dt>
              <dd><Status state={operationalState(radar.status)} /></dd>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-white/45">
              Último ciclo: {safeIso(radar.lastCompletedRunAt)
                ? ownerTime(radar.lastCompletedRunAt)
                : String(radar.lastCompletedRunDate ?? "—")} · último dispatch: {ownerTime(radar.lastDispatchAt)} · oportunidades: {count(radar.opportunitiesFound) ?? "—"}.
            </p>
            <p className="mt-1 text-[10px] text-white/35">
              Tick: {String(radar.schedule ?? "—")} · un tick no implica un dispatch elegible · {String(radar.cause ?? "RADAR_AUTHORITY_UNAVAILABLE")}.
            </p>
          </div>
          {capabilities.map(([label, state, detail]) => <div key={label}
            className="rounded-xl bg-black/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm font-black">{label}</dt>
              <dd><Status state={state} /></dd>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-white/40">{detail}</p>
          </div>)}
        </dl>
        {readState === "PARTIAL" && <p className="mt-3 flex items-center gap-2 text-xs text-amber-100/80">
          <CircleAlert size={14} /> Una autoridad no respondió; se muestra como desconocida, nunca como cero.
        </p>}
        <a href="/admin/ebay/operational-readiness"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-cyan-100">
          Abrir Administración <ArrowRight className="ml-2" size={15} />
        </a>
      </section>
    </div>
    <SalesRevenueVisual insights={insights} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-lg font-black">Actividad reciente</h2>
        <div className="mt-3 space-y-2">
          {activity.length ? activity.map((event, index) => <div
            key={`${event.type}:${event.at}:${index}`}
            className="rounded-xl bg-black/20 px-3 py-2 text-sm">
            <span className="font-black">{ownerTime(event.at)}</span>
            <span className="text-white/65"> · {String(event.title ?? "Evento")}</span>
            {typeof event.amountUsd === "number" && <span> · {usd(event.amountUsd)}</span>}
            <p className="mt-1 text-[10px] text-white/35">WhatsApp: {String(event.whatsappStatus ?? "UNKNOWN")} · Agradecimiento: {String(event.buyerThankYouStatus ?? "UNKNOWN")} · {String(event.officialReadbackState ?? "UNKNOWN")}</p>
          </div>) : <p className="text-sm text-white/45">No hay eventos durables disponibles.</p>}
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-lg font-black">Integridad de listings</h2>
        <p className="mt-2 text-sm text-white/55">Links de proveedor faltantes: <Value value={count(listingIntegrity.supplierLinkMissingCount)} /> · categorías sin mapear en ventas: <Value value={count(listingIntegrity.categoryUnmappedCount)} /></p>
        <div className="mt-3 space-y-2">
          {(Array.isArray(listingIntegrity.exceptions)
            ? listingIntegrity.exceptions.map(record) : []).map((item) =>
            <div key={String(item.itemId)} className="rounded-xl bg-black/20 px-3 py-2 text-xs">
              <strong>Listing {String(item.itemId ?? "—")}</strong> · {String(item.problem ?? "UNKNOWN")}<br />
              <span className="text-white/40">Evidencia: {ownerTime(item.lastEvidenceAt)} · siguiente: {String(item.nextAction ?? "UNKNOWN")}</span>
            </div>)}
        </div>
      </section>
    </div>
  </div>
}

function ExtensionCapability(props: Readonly<{ label: string;
  connection: "CONECTADA" | "DESCONECTADA" | "DESCONOCIDA";
  state: SellerOsOperationalStateV1; observedAt: string | null;
  version: string | null; queue: string; cause: string }>) {
  return <div className="rounded-xl bg-black/20 px-3 py-2.5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <dt className="text-sm font-black">{props.label}</dt>
      <dd className="flex items-center gap-2"><span className="text-[10px] font-black tracking-wide text-white/65">{props.connection}</span><Status state={props.state} /></dd>
    </div>
    <p className="mt-1 text-[11px] text-white/45">Handshake: {ownerTime(props.observedAt)} · versión: {props.version ?? "—"} · cola/plan: {props.queue}</p>
    <p className="mt-1 text-[10px] text-white/30">{props.cause}</p>
  </div>
}

function SalesRevenueVisual({ insights }: Readonly<{
  insights: Record<string, unknown> }>) {
  const [days, setDays] = useState(30)
  const [categoryDays, setCategoryDays] = useState(7)
  const sales = record(insights.sales)
  const windows = Array.isArray(sales.windows) ? sales.windows.map(record) : []
  const selected = windows.find((item) => Number(item.days) === days) ?? {}
  const points = Array.isArray(selected.points) ? selected.points.map(record) : []
  const values = points.map((point) => typeof point.grossSalesUsd === "number"
    ? point.grossSalesUsd : 0)
  const maximum = Math.max(1, ...values)
  const polyline = values.map((value, index) => `${points.length <= 1 ? 0
    : index / (points.length - 1) * 100},${42 - value / maximum * 38}`).join(" ")
  const categories = record(insights.categories)
  const categoryWindows = Array.isArray(categories.windows)
    ? categories.windows.map(record) : []
  const categoryWindow = categoryWindows.find((item) =>
    Number(item.days) === categoryDays) ?? {}
  const top = Array.isArray(categoryWindow.top)
    ? categoryWindow.top.map(record) : []
  const opportunity = record(insights.marketOpportunity)
  const opportunities = Array.isArray(opportunity.opportunities)
    ? opportunity.opportunities.map(record) : []
  return <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-300/[0.08] to-transparent p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><TrendingUp size={19} className="text-emerald-200" /><h2 className="text-xl font-black">Ventas</h2></div><p className="mt-1 text-xs text-white/45">Ingresos confirmados por órdenes oficiales de eBay · America/Managua.</p></div>
      <div className="flex flex-wrap gap-1">{[1, 7, 30, 90, 365].map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${days === value ? "bg-emerald-200 text-emerald-950" : "bg-white/[0.06] text-white/55"}`}>{value === 1 ? "HOY" : value === 365 ? "12 MESES" : `${value} DÍAS`}</button>)}</div>
    </div>
    <div className="mt-5" aria-label={`Ventas de los últimos ${days} días`}>
      <p className="text-3xl font-black tabular-nums">{usd(selected.grossSalesUsd)}</p>
      {points.length ? <svg viewBox="0 0 100 46" role="img" className="mt-3 h-36 w-full overflow-visible" preserveAspectRatio="none"><defs><linearGradient id="sales-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ee7b7" stopOpacity=".32"/><stop offset="1" stopColor="#6ee7b7" stopOpacity="0"/></linearGradient></defs><polygon points={`0,46 ${polyline} 100,46`} fill="url(#sales-area)"/><polyline points={polyline} fill="none" stroke="#a7f3d0" strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>{points.map((point, index) => <circle key={String(point.date)} cx={points.length <= 1 ? 0 : index / (points.length - 1) * 100} cy={42 - values[index] / maximum * 38} r="1.1" fill="#d1fae5"><title>{String(point.date)} · {usd(point.grossSalesUsd)} · {String(point.officialOrderCount ?? "—")} órdenes · {String(point.unitsSold ?? "—")} unidades</title></circle>)}</svg> : <div className="mt-4 h-36 rounded-2xl bg-black/15" />}
      <p className="mt-2 text-sm text-white/60">{usd(selected.grossSalesUsd)} vendidos · {count(selected.officialOrderCount) ?? "—"} órdenes · {count(selected.unitsSold) ?? "—"} unidades</p>
      <p className="mt-1 text-[10px] text-white/35">Estado: {String(sales.status ?? "UNKNOWN")} · actualizado: {ownerTime(sales.sourceUpdatedAt)} · profit: UNKNOWN</p>
    </div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black">Categorías con más ventas</h3><div className="flex gap-1">{[1, 7, 30, 90].map((value) => <button key={value} type="button" onClick={() => setCategoryDays(value)} className={`rounded-md px-2 py-1 text-[9px] font-black ${categoryDays === value ? "bg-white/20" : "text-white/40"}`}>{value === 1 ? "AYER" : `${value}D`}</button>)}</div></div><p className="mt-1 text-[10px] text-white/35">Órdenes oficiales + categoría canónica · no se omiten ventas sin mapear.</p><div className="mt-3 space-y-2">{top.length ? top.map((item, index) => <a key={`${item.categoryId}:${index}`} href={`/admin/ebay/sales?category=${encodeURIComponent(String(item.categoryId ?? "UNMAPPED"))}`} className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3 text-sm"><span>{index + 1}. {String(item.categoryName ?? "Sin mapear")}</span><strong>{usd(item.grossSalesUsd)}</strong></a>) : <p className="text-sm text-white/45">No hay ventas confirmadas en este período.</p>}</div><p className="mt-2 text-[10px] text-white/35">Estado: {String(categories.status ?? "UNKNOWN")} · reconciliación: {categories.totalReconciles === true ? "PASS" : "UNKNOWN"}</p></div>
      <div><h3 className="text-sm font-black">Categorías con oportunidad de mercado</h3><p className="mt-1 text-[10px] text-white/35">Radar separado de nuestras ventas · nunca autoriza publicación.</p><div className="mt-3 space-y-2">{opportunities.length ? opportunities.map((item, index) => <a key={`${item.family}:${index}`} href="/admin/ebay/mobile-review" className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3 text-sm"><span>{String(item.family ?? "Familia por determinar")}</span><strong>{count(item.opportunityCount) ?? "—"}</strong></a>) : <p className="text-sm text-white/45">Sin autoridad suficiente.</p>}</div><p className="mt-2 text-[10px] text-white/35">Estado: {String(opportunity.status ?? "UNKNOWN")}</p></div>
    </div>
  </section>
}
