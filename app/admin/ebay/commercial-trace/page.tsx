"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { supabase } from "@/lib/supabase"

const AWCS06F_URL = "https://lunaportex.com/products/hd-1080p-webcam-usb-c-usb-a-w-built-in-speakers-mic-black-awcs06f"
type JsonRecord = Record<string, unknown>
type TraceEvent = { sequence: number; stage: string; status: string;
  narrative: string; evidence: JsonRecord; observed_at: string }
type Trace = { trace_id: string; state: "RUNNING" | "COMPLETED" | "FAILED";
  current_stage: string; result: JsonRecord; product_url: string;
  started_at: string; updated_at: string; completed_at: string | null }

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "No demostrado"
  if (typeof value === "number") return Number.isInteger(value)
    ? String(value) : value.toFixed(2)
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Ninguno"
  return String(value)
}

function money(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" })
      .format(amount) : "No demostrado"
}

function tone(status: string) {
  if (status === "PASS" || status === "COMPLETED") {
    return "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-50"
  }
  if (status === "BLOCKED" || status === "FAIL" || status === "FAILED") {
    return "border-rose-300/30 bg-rose-300/[0.09] text-rose-50"
  }
  if (status === "RUNNING") {
    return "border-cyan-300/30 bg-cyan-300/[0.09] text-cyan-50"
  }
  return "border-white/10 bg-white/[0.04] text-white/80"
}

function CommercialTraceContent() {
  const search = useSearchParams()
  const requestedTraceId = search.get("traceId")?.trim() ?? ""
  const [trace, setTrace] = useState<Trace | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const session = await supabase.auth.getSession()
    if (session.error || !session.data.session) throw new Error(
      "Tu sesión de administración no está disponible.")
    const response = await fetch(url, { ...init, cache: "no-store",
      headers: { ...init?.headers,
        Authorization: `Bearer ${session.data.session.access_token}` } })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) throw new Error(
      payload?.error ?? "LIVE_COMMERCIAL_TRACE_REQUEST_FAILED")
    return payload
  }, [])

  const load = useCallback(async () => {
    try {
      const query = requestedTraceId
        ? `?traceId=${encodeURIComponent(requestedTraceId)}` : ""
      const payload = await request(`/api/admin/ebay/commercial-trace${query}`)
      setTrace(payload.trace ?? null); setEvents(payload.events ?? [])
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message
        : "No se pudo leer el trace.")
    }
  }, [request, requestedTraceId])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(),
      trace?.state === "RUNNING" || busy ? 1_500 : 10_000)
    return () => window.clearInterval(interval)
  }, [load, trace?.state, busy])

  async function start() {
    setBusy(true); setError("")
    try {
      const operation = request("/api/admin/ebay/commercial-trace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "START", productUrl: AWCS06F_URL }),
      })
      window.setTimeout(() => void load(), 400)
      const payload = await operation
      window.history.replaceState({}, "",
        `/admin/ebay/commercial-trace?traceId=${payload.traceId}`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message
        : "La certificación quedó cerrada de forma segura.")
      await load()
    } finally { setBusy(false) }
  }

  const result = record(trace?.result)
  const accepted = useMemo(() => events.flatMap((event) =>
    event.stage === "ACCEPTED_COMPARABLES"
      ? list(record(event.evidence).acceptedComparables) : []), [events])
  const excluded = useMemo(() => events.flatMap((event) =>
    event.stage === "EXCLUDED_COMPARABLES"
      ? list(record(event.evidence).excludedComparables) : []), [events])
  const conflicts = list(result.CLAIM_CONFLICTS)
  const safeClaims = list(result.SAFE_CLAIM_SUBSET)
  const doNotUseClaims = list(result.DO_NOT_USE_CLAIMS)
  const summary: Array<readonly [string, unknown]> = [
    ["TRACE_ID", trace?.trace_id],
    ["FINAL_DECISION", result.FINAL_DECISION],
    ["CONFIDENCE", result.CONFIDENCE],
    ["RECOMMENDED_PRICE", money(result.RECOMMENDED_PRICE)],
    ["PRIMARY_KEYWORD_FAMILY", result.PRIMARY_KEYWORD_FAMILY],
    ["LANDED_COST", money(result.LANDED_COST)],
    ["ACCEPTED_COMPARABLE_COUNT", result.ACCEPTED_COMPARABLE_COUNT],
    ["EXCLUDED_COMPARABLE_COUNT", result.EXCLUDED_COMPARABLE_COUNT],
    ["COMMERCIAL_TRACE_CERTIFICATION", result.COMMERCIAL_TRACE_CERTIFICATION],
  ]

  return <main className="min-h-screen bg-[#07101d] px-4 py-6 pb-24 text-white sm:px-7">
    <div className="mx-auto max-w-7xl">
      <nav className="text-sm text-white/55"><a href="/admin/ebay/quick-pick"
        className="font-bold text-cyan-100 hover:text-white">Preparar productos</a>
        <span className="mx-2">/</span>Certificación comercial en vivo</nav>
      <header className="mt-6 rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] to-white/[0.03] p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/60">SELLER_OS_LIVE_COMMERCIAL_TRACE_V1</p>
            <h1 className="mt-2 text-2xl font-black sm:text-4xl">AWCS06F · evaluación autónoma</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">Narrativa durable de lo que Seller OS observa y decide. Sin precio, keywords, comparables ni conclusión inyectados por una persona.</p></div>
          <button onClick={() => void start()} disabled={busy || trace?.state === "RUNNING"}
            className="min-h-12 rounded-xl bg-white px-5 font-black text-black disabled:cursor-not-allowed disabled:opacity-45">
            {trace?.state === "RUNNING" || busy ? "Analizando…" : "Iniciar evaluación nueva"}
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-black/20 p-4"><p className="text-xs font-black text-white/45">ETAPA ACTUAL</p><p className="mt-1 font-black">{trace?.current_stage ?? "Sin trace"}</p></div>
          <div className="rounded-2xl bg-black/20 p-4"><p className="text-xs font-black text-white/45">TRACE ID</p><p className="mt-1 break-all text-xs font-bold">{trace?.trace_id ?? "Aún no creado"}</p></div>
          <div className="rounded-2xl bg-black/20 p-4"><p className="text-xs font-black text-white/45">ESTADO</p><p className="mt-1 font-black">{trace?.state ?? "PENDIENTE"}</p></div>
        </div>
      </header>

      {error && <p role="alert" className="mt-5 rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] p-4 text-rose-50">{error}</p>}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.map(([label, value]) => <div key={String(label)}
          className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <p className="text-[11px] font-black tracking-wider text-white/40">{label}</p>
          <p className="mt-2 break-words font-black">{display(value)}</p>
        </div>)}
      </section>

      <section className="mt-7">
        <h2 className="text-xl font-black">Qué está haciendo Seller OS</h2>
        <ol className="mt-4 space-y-3">{events.map((event) => <li
          key={event.sequence} className={`rounded-2xl border p-4 ${tone(event.status)}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-black"><span className="mr-2 opacity-45">{event.sequence}</span>{event.stage}</p>
            <span className="rounded-full border border-current/20 px-2.5 py-1 text-xs font-black">{event.status}</span>
          </div>
          <p className="mt-2 text-sm leading-6 opacity-85">{event.narrative}</p>
          <details className="mt-3 text-xs opacity-70"><summary className="min-h-8 cursor-pointer font-bold">Ver evidencia usada</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 p-3">{JSON.stringify(event.evidence, null, 2)}</pre>
          </details>
        </li>)}</ol>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <div><h2 className="text-xl font-black">Comparables aceptados ({accepted.length})</h2>
          <div className="mt-3 space-y-3">{accepted.map((item, index) => <article key={`${item.comparableId}:${index}`}
            className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-4">
            <p className="font-bold">{display(item.title)}</p><p className="mt-2 text-sm text-white/65">{money(item.price)} + shipping {money(item.shippingCost)} · {display(item.comparableClass)} · {display(item.identityMatchQuality)}</p>
            <p className="mt-2 text-xs text-emerald-100/65">Pricing: {display(item.pricingReason)}</p>
          </article>)}{!accepted.length && <p className="text-sm text-white/50">Ningún comparable aceptado todavía.</p>}</div></div>
        <div><h2 className="text-xl font-black">Comparables excluidos ({excluded.length})</h2>
          <div className="mt-3 space-y-3">{excluded.map((item, index) => <article key={`${item.comparableId}:${index}`}
            className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.06] p-4">
            <p className="font-bold">{display(item.title)}</p><p className="mt-2 text-sm text-white/65">{money(item.price)} · {display(item.comparableClass)} · {display(item.identityMatchQuality)}</p>
            <p className="mt-2 text-xs font-black text-rose-100">Razón: {display(item.rejectionReason)}</p>
          </article>)}{!excluded.length && <p className="text-sm text-white/50">Ningún comparable excluido todavía.</p>}</div></div>
      </section>

      <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-xl font-black">Conflictos y dudas conocidas</h2>
        {conflicts.length ? <ul className="mt-3 space-y-2 text-sm">{conflicts.map((item) => <li key={String(item.code)} className="rounded-xl bg-rose-300/[0.07] p-3"><strong>{display(item.code)}</strong>: {display(item.evidence)}</li>)}</ul> : <p className="mt-3 text-sm text-white/55">Sin conflictos visibles en el resultado actual.</p>}
        <p className="mt-4 text-sm text-emerald-100"><strong>Claims seguros:</strong> {safeClaims.length ? safeClaims.map((item) => display(item.value)).join(", ") : "No demostrados"}</p>
        <p className="mt-2 text-sm text-rose-100"><strong>UNVERIFIED / DO_NOT_USE:</strong> {doNotUseClaims.length ? doNotUseClaims.map((item) => display(item.value)).join(", ") : "Ninguno"}</p>
        <p className="mt-4 text-sm text-white/65"><strong>KNOWN_UNCERTAINTIES:</strong> {display(result.KNOWN_UNCERTAINTIES)}</p>
      </section>

      <footer className="mt-8 rounded-2xl border border-white/10 p-4 text-xs text-white/45">
        Actualización automática sin refresh · eBay GET/read-only · 0 escrituras de publicación · 0 escrituras eBay · compra prohibida.
      </footer>
    </div>
  </main>
}

export default function CommercialTracePage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#07101d] p-6 text-white">Leyendo trace…</main>}>
    <CommercialTraceContent />
  </Suspense>
}
