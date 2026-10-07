"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
type CostForm = Record<string, string>

const emptyCost: CostForm = { sellerSku: "", supplierName: "",
  supplierBaseUrl: "", supplierSku: "", supplierProductUrl: "",
  unitCostUsd: "", inboundShippingPerUnitUsd: "",
  prepCostPerUnitUsd: "", unitsPurchased: "",
  otherActualCostsUsd: "0" }

const actionLabels: Record<string, string> = {
  VERIFY_AMAZON_ASIN: "Esperar el ASIN exacto de Amazon",
  VERIFY_AMAZON_ELIGIBILITY: "Revisar restricción o estado del listing",
  GET_AMAZON_DEMAND: "Esperar el reporte automático de ventas y tráfico",
  CAPTURE_DELIVERED_COST: "Vincular costo y proveedor",
  COMPLETE_AMAZON_ECONOMICS: "Esperar tarifas o completar costo externo",
  CAPTURE_AMAZON_LISTING_READBACK: "Esperar publicación en Seller Central",
  MEASURE_RESULT: "Esperar el siguiente resultado automático",
  REVIEW_REORDER: "Revisar recompra con el owner",
  REVIEW_REJECTION: "Revisar descarte o aprendizaje",
}

const outcomeLabels: Record<string, string> = {
  WINNER: "Ganador confirmado", NOT_WINNER: "No ganador",
  PENDING_RESULT: "Esperando resultado", PENDING_EVIDENCE: "Falta evidencia",
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(object) : []
}

function money(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(value) : "Sin evidencia"
}

function percent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%` : "Sin evidencia"
}

function date(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Nunca"
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium",
    timeStyle: "short" }).format(new Date(value))
}

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

async function request(init?: RequestInit) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error("Inicia sesión como propietario.")
  return fetch("/api/admin/marketplace/amazon/collaborators/connie", {
    cache: "no-store", ...init,
    headers: { Authorization: `Bearer ${session.data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers },
  })
}

function Metric({ title, value, note }: { title: string;
  value: string | number; note?: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
    <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">
      {title}
    </p>
    <p className="mt-2 text-2xl font-black">{value}</p>
    {note && <p className="mt-1 text-xs text-white/45">{note}</p>}
  </div>
}

export default function ConnieAmazonPerformancePage() {
  const [monitor, setMonitor] = useState<Json>({})
  const [connection, setConnection] = useState<Json>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [cost, setCost] = useState<CostForm>(emptyCost)
  const [message, setMessage] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await request()
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo leer el seguimiento."))
      }
      setMonitor(object(payload.monitor))
      setConnection(object(payload.connection))
      setMessage("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer.")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function sync() {
    setSyncing(true); setMessage("")
    try {
      const response = await request({ method: "POST", body: JSON.stringify({
        action: "SYNC_FROM_AMAZON_READ_ONLY",
      }) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo leer Amazon."))
      }
      setMonitor(object(payload.monitor))
      setConnection(object(payload.connection))
      const result = object(payload.sync)
      setMessage(result.status === "WAITING_REPORT"
        ? "Listings capturados. Amazon está preparando ventas y tráfico; Seller OS los recogerá automáticamente en la siguiente pasada."
        : `Sincronización terminada: ${Number(result.listingsAttributed ?? 0)} SKU de Connie detectados.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo sincronizar.")
    } finally { setSyncing(false) }
  }

  async function linkCost() {
    setLinking(true); setMessage("")
    try {
      const response = await request({ method: "POST", body: JSON.stringify({
        action: "LINK_SUPPLIER_AND_COST", sellerSku: cost.sellerSku,
        supplier: { name: cost.supplierName,
          baseUrl: cost.supplierBaseUrl, sku: cost.supplierSku,
          productId: cost.supplierSku, variantId: cost.supplierSku,
          productUrl: cost.supplierProductUrl },
        economics: { unitCostUsd: numberOrNull(cost.unitCostUsd),
          inboundShippingPerUnitUsd:
            numberOrNull(cost.inboundShippingPerUnitUsd),
          prepCostPerUnitUsd: numberOrNull(cost.prepCostPerUnitUsd) },
        unitsPurchased: numberOrNull(cost.unitsPurchased),
        otherActualCostsUsd: numberOrNull(cost.otherActualCostsUsd),
      }) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo vincular el costo."))
      }
      setMonitor(object(payload.monitor)); setCost(emptyCost)
      setMessage("Proveedor y costo vinculados. Amazon continuará llenando los resultados automáticamente.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo vincular.")
    } finally { setLinking(false) }
  }

  const summary = object(monitor.summary)
  const automation = object(monitor.automation)
  const syncState = object(automation.sync)
  const cards = list(monitor.cards)
  const ready = connection.status === "READY"

  return <main className="mx-auto max-w-7xl space-y-5 p-4 text-white sm:p-6">
    <header className="rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.12] to-transparent p-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">
        Amazon · captura automática de Connie
      </p>
      <h1 className="mt-2 text-3xl font-black">Seller OS observa; tú no llenas resultados</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
        Seller OS lee Seller Central en modo seguro: detecta los SKU de Connie,
        ASIN, precio, inventario, estado del listing, ventas, tráfico y cargos.
        Nunca publica, cambia precios ni compra inventario.
      </p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm font-bold">
        <Link href="/admin" className="min-h-11 rounded-xl border border-white/15 px-4 py-3">
          Volver al inicio
        </Link>
        <button type="button" onClick={() => void sync()}
          disabled={syncing || !ready}
          className="min-h-11 rounded-xl bg-cyan-200 px-4 py-3 text-cyan-950 disabled:cursor-not-allowed disabled:opacity-40">
          {syncing ? "Leyendo Amazon…" : "Actualizar desde Amazon"}
        </button>
        <button type="button" onClick={() => void load()}
          className="min-h-11 rounded-xl border border-white/15 px-4 py-3">
          Actualizar pantalla
        </button>
      </div>
    </header>

    {message && <p className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-4 text-sm text-amber-50">
      {message}
    </p>}

    <section className={`rounded-3xl border p-5 ${ready
      ? "border-emerald-200/20 bg-emerald-200/[0.07]"
      : "border-amber-200/20 bg-amber-200/[0.07]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.15em] text-white/45">
            Conexión automática
          </p>
          <h2 className="mt-2 text-xl font-black">
            {ready ? "Amazon SP-API lista para leer" : "Falta la autorización única de Amazon"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
            {ready
              ? `Todo SKU que empiece con ${String(connection.skuPrefix ?? "CON-")} se atribuye automáticamente a Connie. Amazon no informa qué usuario creó el listing.`
              : "Hay que autorizar una app privada de lectura en Seller Central una sola vez. Después, la captura corre sola cada seis horas."}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${ready
          ? "bg-emerald-200/15 text-emerald-100"
          : "bg-amber-200/15 text-amber-50"}`}>
          {ready ? "CONECTADO" : "PENDIENTE DE AUTORIZACIÓN"}
        </span>
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-black/15 p-3"><dt className="text-white/40">Última pasada</dt><dd className="mt-1 font-bold">{date(syncState.last_attempt_at)}</dd></div>
        <div className="rounded-xl bg-black/15 p-3"><dt className="text-white/40">Estado</dt><dd className="mt-1 font-bold">{String(syncState.run_status ?? "SIN EJECUTAR")}</dd></div>
        <div className="rounded-xl bg-black/15 p-3"><dt className="text-white/40">SKU atribuidos</dt><dd className="mt-1 font-bold">{Number(automation.attributedSellerSkus ?? 0)}</dd></div>
        <div className="rounded-xl bg-black/15 p-3"><dt className="text-white/40">Próxima acción técnica</dt><dd className="mt-1 font-bold">{syncState.pending_report_id ? "Recoger reporte Amazon" : ready ? "Leer Seller Central" : "Autorizar conexión"}</dd></div>
      </dl>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric title="Productos de Connie" value={loading ? "…" : Number(summary.productsProposed ?? 0)} />
      <Metric title="Demanda confirmada" value={loading ? "…" : Number(summary.demandConfirmed ?? 0)} note="Desde Amazon, no por opinión" />
      <Metric title="Resultados medidos" value={loading ? "…" : Number(summary.resultsEvaluated ?? 0)} />
      <Metric title="Ganadores" value={loading ? "…" : Number(summary.winners ?? 0)} note={`Tasa: ${percent(summary.winnerRate)}`} />
      <Metric title="Listings activos" value={loading ? "…" : Number(summary.activeListings ?? 0)} />
      <Metric title="Utilidad neta realizada" value={loading ? "…" : money(summary.realizedNetProfitUsd)} />
      <Metric title="Revisar recompra" value={loading ? "…" : Number(summary.reorderReviewReady ?? 0)} />
      <Metric title="Cobertura real" value={loading ? "…" : percent(summary.evidenceCoverage)} note="Sin convertir faltantes en cero" />
    </section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black">Qué se llena automáticamente</h2>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {["SKU, ASIN y título", "Precio, stock y estado", "Ventas, sesiones y conversión", "Tarifas, reembolsos y movimiento"].map((item) =>
          <p key={item} className="rounded-xl bg-cyan-200/10 p-3 font-bold text-cyan-50">✓ {item}</p>)}
      </div>
      <p className="mt-4 rounded-xl bg-amber-200/10 p-3 text-sm text-amber-50">
        Amazon no conoce el costo de compra ni el proveedor de Connie. Ésos se
        vinculan una sola vez desde factura o catálogo; no tendrás que copiar
        ventas, tráfico ni resultados cada día.
      </p>
    </section>

    <details className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <summary className="cursor-pointer text-xl font-black">
        Vincular proveedor y costo · una sola vez
      </summary>
      <p className="mt-2 text-sm text-white/50">
        No copies ventas ni tarifas. Sólo identifica el origen y el costo del
        lote; Seller OS conserva el vínculo con el Seller SKU de Amazon.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-xs font-bold text-white/65">Seller SKU
          <select value={cost.sellerSku} onChange={(event) =>
            setCost((current) => ({ ...current, sellerSku: event.target.value }))}
            className="min-h-11 rounded-xl border border-white/15 bg-slate-950 px-3">
            <option value="">Seleccionar producto</option>
            {cards.map((card) => {
              const sku = String(object(object(card.observation).amazonListing).sellerSku ?? "")
              return sku ? <option key={sku} value={sku}>{sku} · {String(card.title ?? "Producto")}</option> : null
            })}
          </select>
        </label>
        {[
          ["supplierName", "Proveedor", "Nombre comercial", "text"],
          ["supplierBaseUrl", "Sitio del proveedor", "https://proveedor.com", "url"],
          ["supplierSku", "SKU del proveedor", "SKU / código", "text"],
          ["supplierProductUrl", "Enlace del producto", "https://…", "url"],
          ["unitCostUsd", "Costo del producto / unidad", "0.00", "number"],
          ["inboundShippingPerUnitUsd", "Envío inbound / unidad", "0.00", "number"],
          ["prepCostPerUnitUsd", "Preparación / unidad", "0.00", "number"],
          ["unitsPurchased", "Unidades compradas", "0", "number"],
          ["otherActualCostsUsd", "Otros costos del lote (0 si no aplica)", "0", "number"],
        ].map(([name, label, placeholder, type]) =>
          <label key={name} className="grid gap-1 text-xs font-bold text-white/65">
            {label}
            <input type={type} min={type === "number" ? "0" : undefined}
              step={type === "number" ? "0.01" : undefined}
              value={cost[name] ?? ""} placeholder={placeholder}
              onChange={(event) => setCost((current) => ({ ...current,
                [name]: event.target.value }))}
              className="min-h-11 rounded-xl border border-white/15 bg-black/20 px-3" />
          </label>)}
      </div>
      <button type="button" onClick={() => void linkCost()}
        disabled={linking || !cost.sellerSku || !cost.supplierName ||
          !cost.supplierBaseUrl || !cost.supplierSku || !cost.unitCostUsd}
        className="mt-4 min-h-11 rounded-xl bg-emerald-200 px-4 font-black text-emerald-950 disabled:opacity-40">
        {linking ? "Vinculando…" : "Guardar proveedor y costo"}
      </button>
    </details>

    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black">Productos y siguiente evidencia</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {cards.length === 0 && <p className="text-sm text-white/50">
          Al conectarse Amazon, aparecerán automáticamente los listings cuyo
          Seller SKU empiece con {String(connection.skuPrefix ?? "CON-")}.
        </p>}
        {cards.map((card) => {
          const observation = object(card.observation)
          const outcome = object(observation.outcome)
          const performance = object(observation.performance)
          const economics = object(observation.economics)
          const listing = object(observation.amazonListing)
          const next = object(observation.nextBestEvidence)
          return <article key={String(card.id)} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-black">{String(card.title ?? "Producto")}</h3>
                <p className="mt-1 text-xs text-white/45">Seller SKU {String(listing.sellerSku ?? "—")} · ASIN {String(object(observation.product).asin ?? "—")}</p></div>
              <span className="rounded-full bg-cyan-200/10 px-3 py-1 text-xs font-bold text-cyan-100">
                {outcomeLabels[String(outcome.skillOutcome)] ?? String(outcome.skillOutcome ?? "Pendiente")}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Precio Amazon</dt><dd className="mt-1 font-bold">{money(listing.listingPriceUsd)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Stock Amazon</dt><dd className="mt-1 font-bold">{listing.availableQuantity == null ? "Sin evidencia" : String(listing.availableQuantity)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Unidades vendidas</dt><dd className="mt-1 font-bold">{performance.observedUnitsSold == null ? "Sin evidencia" : String(performance.observedUnitsSold)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Neto real / unidad</dt><dd className="mt-1 font-bold">{money(performance.actualNetProfitPerUnitUsd)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Sesiones</dt><dd className="mt-1 font-bold">{performance.sessions == null ? "Sin evidencia" : String(performance.sessions)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Neto proyectado</dt><dd className="mt-1 font-bold">{money(economics.projectedNetProfitPerUnitUsd)}</dd></div>
            </dl>
            <p className="mt-3 rounded-xl bg-amber-200/10 p-3 text-xs font-bold text-amber-50">
              Siguiente: {actionLabels[String(next.action)] ?? String(next.action ?? "Revisar evidencia")}
            </p>
          </article>
        })}
      </div>
    </section>
  </main>
}
