"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, BriefcaseBusiness, CircleAlert, PackageCheck,
  RefreshCw, ShieldCheck, UsersRound } from "lucide-react"

import { useAdminOwnerRuntime } from "./admin-owner-runtime-provider"
import { supabase } from "@/lib/supabase"
import {
  sellerOsLunaWorkerStateV1,
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
  lunaState: SellerOsOperationalStateV1
  mayelState: SellerOsOperationalStateV1
  mayelAvailable: boolean
  mayelDelegated: number | null
  mayelOwnerExceptions: number | null
  mayelRecentResults: number | null
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
  lunaState: "DESCONOCIDO",
  mayelState: "DESCONOCIDO",
  mayelAvailable: false,
  mayelDelegated: null,
  mayelOwnerExceptions: null,
  mayelRecentResults: null,
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
  const runtime = useAdminOwnerRuntime()
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
        productResearchState: operationalState(
          record(capabilities.productResearch).state),
        lunaState: operationalState(record(capabilities.lunaShipping).state),
        mayelState: operationalState(record(capabilities.mayel).state),
        mayelAvailable: mayel.authorityAvailable === true,
        mayelDelegated: count(mayel.delegatedCount),
        mayelOwnerExceptions: count(mayel.ownerExceptionCount),
        mayelRecentResults: count(mayel.recentResultCount),
      }))
      setReadState(Array.isArray(snapshot.authorityFailures) &&
        snapshot.authorityFailures.length > 0 ? "PARTIAL" : "STABLE")
    } catch {
      setAuthority(EMPTY_AUTHORITY)
      setReadState("PARTIAL")
    }
  }, [request])

  useEffect(() => { void load() }, [load])

  const liveLunaState = sellerOsLunaWorkerStateV1({
    status: runtime.lunaWorker.status,
    connected: runtime.lunaWorker.connected,
    canonicalBindingReady: runtime.lunaWorker.canonicalBindingReady,
    eligiblePendingJobCount: runtime.lunaWorker.eligiblePendingJobCount,
  })
  const lunaState = liveLunaState === "DESCONOCIDO"
    ? authority.lunaState : liveLunaState
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
    ["Luna Shipping", lunaState,
      "Cola, binding y capacidad del worker; conexión sola no basta."],
    ["Product Research", authority.productResearchState,
      "Receipt reciente y plan durable; configured no equivale a operar."],
    ["Publisher", "BLOQUEADO",
      "FAILED_PHYSICAL_ACCEPTANCE · no se solicitan pruebas SKU por SKU."],
    ["eBay", authority.ebayState,
      "Lectura oficial de cuenta y órdenes; HTTP 200 solo no certifica éxito."],
    ["Mayel", authority.mayelState,
      "Cola durable y resultados; la navegación no controla el runtime."],
  ]

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
        <a href="/admin/ebay/quick-pick"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-black text-emerald-100">
          Abrir preparación <ArrowRight className="ml-2" size={15} />
        </a>
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
  </div>
}
