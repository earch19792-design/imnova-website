"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, MessageCircle, RefreshCw, ShieldAlert } from "lucide-react"

import { supabase } from "@/lib/supabase"
import {
  sellerOsOperationalStateToneV1,
  sellerOsOperationalStateV1,
  type SellerOsOperationalStateV1,
} from "@/lib/seller-os/operational-status-v1"

type PostSaleView = Readonly<{
  authority: boolean
  orders: number | null
  communication: SellerOsOperationalStateV1
  alerts: SellerOsOperationalStateV1
  exceptionCount: number | null
  ownerCaseCount: number | null
  recentCount: number | null
}>

const EMPTY: PostSaleView = Object.freeze({
  authority: false,
  orders: null,
  communication: "DESCONOCIDO",
  alerts: "DESCONOCIDO",
  exceptionCount: null,
  ownerCaseCount: null,
  recentCount: null,
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

function stateForMechanism(value: Record<string, unknown>,
  pending: number | null): SellerOsOperationalStateV1 {
  const status = String(value.status ?? "")
  return sellerOsOperationalStateV1({
    authorityAvailable: status.length > 0,
    pendingCount: pending,
    working: status === "SUCCEEDED" || status === "ARMED",
    blocked: status === "FAILED" || status === "MANUAL_REVIEW",
  })
}

function Pill({ state }: { state: SellerOsOperationalStateV1 }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${sellerOsOperationalStateToneV1(state)}`}>
    {state.replace("_", " ")}
  </span>
}

export function PostSaleReadModel() {
  const [view, setView] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session?.access_token) throw new Error()
      const response = await fetch(
        "/api/admin/ebay/commercial-monitor?dashboardHealthOnly=1", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        })
      const payload = record(await response.json())
      if (!response.ok || payload.success !== true) throw new Error()
      const health = record(payload.commercialHealth)
      const postSale = record(health.postSale)
      const whatsapp = record(postSale.whatsapp)
      const buyer = record(postSale.buyerThankYou)
      const traces = Array.isArray(postSale.recentSaleTraces)
        ? postSale.recentSaleTraces : []
      const whatsappManual = count(whatsapp.manualReviewCount)
      const buyerManual = count(buyer.manualReviewRequired)
      const exceptions = whatsappManual === null || buyerManual === null
        ? null : whatsappManual + buyerManual
      setView(Object.freeze({
        authority: postSale.authorityAvailable === true,
        orders: record(health.orders).sourceStatus === "AVAILABLE"
          ? count(record(health.orders).officialOrderCount) : null,
        communication: stateForMechanism(buyer, buyerManual),
        alerts: stateForMechanism(whatsapp, whatsappManual),
        exceptionCount: exceptions,
        ownerCaseCount: exceptions,
        recentCount: traces.length,
      }))
      setPartial(false)
    } catch {
      setPartial(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return <div className="grid gap-4 md:grid-cols-2"
    data-post-sale-read-only data-get-business-mutations="0">
    {([
      ["Comunicación", "Mensajes al comprador respaldados por receipt.",
        view.communication, MessageCircle],
      ["Alertas", "Alertas al owner; armado no equivale a enviado.",
        view.alerts, BellRing],
    ] as const).map(([label, detail, state, Icon]) => <section key={label}
      className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3"><Icon className="text-cyan-200" />
          <h2 className="text-xl font-black">{label}</h2></div>
        <Pill state={state} />
      </div>
      <p className="mt-3 text-sm leading-6 text-white/55">{detail}</p>
    </section>)}
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center gap-3"><ShieldAlert
        className="text-amber-100" /><h2 className="text-xl font-black">
        Excepciones y casos owner
      </h2></div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Excepciones reales</dt><dd className="font-black">{view.exceptionCount ?? "—"}</dd></div>
        <div className="flex min-h-11 items-center justify-between rounded-xl bg-black/20 px-3"><dt>Casos owner</dt><dd className="font-black">{view.ownerCaseCount ?? "—"}</dd></div>
      </dl>
    </section>
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black">Historial</h2>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 disabled:opacity-40"
          aria-label="Actualizar Postventa"><RefreshCw size={16} /></button>
      </div>
      <p className="mt-4 text-sm text-white/55">
        Ventas oficiales: <strong>{view.orders ?? "—"}</strong> · ejecuciones
        recientes: <strong>{view.recentCount ?? "—"}</strong>
      </p>
      {partial && <p className="mt-3 text-xs text-amber-100">
        La autoridad no respondió. Se conserva desconocido; no se muestra cero.
      </p>}
    </section>
  </div>
}
