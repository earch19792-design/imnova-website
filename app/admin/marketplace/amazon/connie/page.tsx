"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
type Form = Record<string, string>

const empty: Form = {
  supplierName: "", supplierBaseUrl: "", supplierSku: "",
  supplierProductId: "", supplierProductUrl: "", inventoryQuantity: "",
  title: "", brand: "", category: "", asin: "", upc: "",
  condition: "New",
  demandClaim: "UNKNOWN", demandEvidenceState: "CONTRIBUTOR_ASSERTED",
  demandSource: "Connie · propuesta profesional", demandNotes: "",
  eligibilityState: "UNPROVEN",
  unitCostUsd: "", inboundShippingPerUnitUsd: "", prepCostPerUnitUsd: "",
  expectedSalePriceUsd: "", referralFeePerUnitUsd: "",
  fbaFeePerUnitUsd: "", otherVariableCostPerUnitUsd: "",
  listingState: "NOT_LISTED", sellerSku: "", listingPriceUsd: "",
  listedAt: "", resultAuthority: "UNPROVEN", observationWindowDays: "",
  unitsPurchased: "", unitsSold: "", grossSalesUsd: "",
  amazonFeesUsd: "", fulfillmentFeesUsd: "", refundsUsd: "",
  otherActualCostsUsd: "", firstSaleAt: "",
}

const actionLabels: Record<string, string> = {
  VERIFY_AMAZON_ASIN: "Verificar el ASIN exacto",
  VERIFY_AMAZON_ELIGIBILITY: "Verificar permiso para vender en Seller Central",
  GET_AMAZON_DEMAND: "Confirmar demanda con evidencia independiente",
  CAPTURE_DELIVERED_COST: "Completar costo entregado por unidad",
  COMPLETE_AMAZON_ECONOMICS: "Completar precio y tarifas de Amazon",
  CAPTURE_AMAZON_LISTING_READBACK: "Confirmar el listing publicado en Amazon",
  MEASURE_RESULT: "Traer resultado actual de Seller Central",
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

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

function Metric({ title, value, note }: { title: string; value: string | number;
  note?: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
    <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/45">
      {title}
    </p>
    <p className="mt-2 text-2xl font-black">{value}</p>
    {note && <p className="mt-1 text-xs text-white/45">{note}</p>}
  </div>
}

const fieldClass = "min-h-11 rounded-xl border border-white/15 bg-black/20 px-3 text-sm outline-none focus:border-cyan-200/60"

export default function ConnieAmazonPerformancePage() {
  const [form, setForm] = useState<Form>(empty)
  const [monitor, setMonitor] = useState<Json>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer.")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function set(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function Field({ name, title, type = "text", placeholder = "" }: {
    name: string; title: string; type?: string; placeholder?: string
  }) {
    return <label className="grid gap-1.5 text-xs font-bold text-white/70">
      {title}
      <input className={fieldClass} type={type} value={form[name] ?? ""}
        placeholder={placeholder}
        onChange={(event) => set(name, event.target.value)} />
    </label>
  }

  function Select({ name, title, options }: { name: string; title: string;
    options: Array<[string, string]> }) {
    return <label className="grid gap-1.5 text-xs font-bold text-white/70">
      {title}
      <select className={fieldClass} value={form[name] ?? ""}
        onChange={(event) => set(name, event.target.value)}>
        {options.map(([value, label]) => <option key={value} value={value}
          className="bg-slate-950">{label}</option>)}
      </select>
    </label>
  }

  async function save() {
    setSaving(true); setMessage("")
    try {
      const now = new Date().toISOString()
      const response = await request({ method: "POST", body: JSON.stringify({
        action: "CAPTURE_CONTRIBUTOR_PRODUCT_OBSERVATION",
        observation: {
          observedAt: now,
          supplier: { name: form.supplierName, baseUrl: form.supplierBaseUrl,
            sku: form.supplierSku,
            productId: form.supplierProductId || form.supplierSku,
            variantId: form.supplierSku, productUrl: form.supplierProductUrl,
            inventoryQuantity: numberOrNull(form.inventoryQuantity) },
          product: { title: form.title, brand: form.brand,
            category: form.category, asin: form.asin, upc: form.upc,
            condition: form.condition },
          demand: { claim: form.demandClaim,
            evidenceState: form.demandEvidenceState,
            source: form.demandSource, notes: form.demandNotes,
            observedAt: form.demandEvidenceState === "UNPROVEN" ? null : now },
          eligibility: { state: form.eligibilityState,
            observedAt: form.eligibilityState === "UNPROVEN" ? null : now },
          economics: { unitCostUsd: numberOrNull(form.unitCostUsd),
            inboundShippingPerUnitUsd:
              numberOrNull(form.inboundShippingPerUnitUsd),
            prepCostPerUnitUsd: numberOrNull(form.prepCostPerUnitUsd),
            expectedSalePriceUsd: numberOrNull(form.expectedSalePriceUsd),
            referralFeePerUnitUsd: numberOrNull(form.referralFeePerUnitUsd),
            fbaFeePerUnitUsd: numberOrNull(form.fbaFeePerUnitUsd),
            otherVariableCostPerUnitUsd:
              numberOrNull(form.otherVariableCostPerUnitUsd) },
          amazonListing: { state: form.listingState,
            sellerSku: form.sellerSku,
            listingPriceUsd: numberOrNull(form.listingPriceUsd),
            listedAt: form.listedAt || null },
          performance: { authority: form.resultAuthority,
            observationWindowDays: numberOrNull(form.observationWindowDays),
            unitsPurchased: numberOrNull(form.unitsPurchased),
            unitsSold: numberOrNull(form.unitsSold),
            grossSalesUsd: numberOrNull(form.grossSalesUsd),
            amazonFeesUsd: numberOrNull(form.amazonFeesUsd),
            fulfillmentFeesUsd: numberOrNull(form.fulfillmentFeesUsd),
            refundsUsd: numberOrNull(form.refundsUsd),
            otherActualCostsUsd: numberOrNull(form.otherActualCostsUsd),
            firstSaleAt: form.firstSaleAt || null,
            observedAt: form.resultAuthority === "UNPROVEN" ? null : now },
        },
      }) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo guardar."))
      }
      const observation = object(payload.observation)
      const next = object(observation.nextBestEvidence)
      setMonitor(object(payload.monitor))
      setMessage(`Guardado y verificado. Siguiente paso: ${actionLabels[String(next.action)] ?? String(next.action)}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.")
    } finally { setSaving(false) }
  }

  const summary = object(monitor.summary)
  const cards = list(monitor.cards)

  return <main className="mx-auto max-w-7xl space-y-5 p-4 text-white sm:p-6">
    <header className="rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.12] to-transparent p-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">
        Amazon · desempeño del operador
      </p>
      <h1 className="mt-2 text-3xl font-black">Seguimiento de Connie</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
        Connie puede continuar investigando y publicando desde Seller Central.
        Aquí medimos cada producto que propone: demanda confirmada, movimiento,
        utilidad neta y si merece recompra. Sus afirmaciones se conservan, pero
        no se convierten en prueba de Amazon sin evidencia independiente.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
        <Link href="/admin" className="min-h-11 rounded-xl border border-white/15 px-4 py-3">
          Volver al inicio
        </Link>
        <button type="button" onClick={() => void load()}
          className="min-h-11 rounded-xl bg-cyan-200 px-4 py-3 text-cyan-950">
          Actualizar resultados
        </button>
      </div>
    </header>

    {message && <p className="rounded-2xl border border-amber-200/20 bg-amber-200/10 p-4 text-sm text-amber-50">
      {message}
    </p>}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric title="Productos propuestos" value={loading ? "…" : Number(summary.productsProposed ?? 0)} />
      <Metric title="Demanda confirmada" value={loading ? "…" : Number(summary.demandConfirmed ?? 0)}
        note="No incluye una afirmación sin confirmar" />
      <Metric title="Resultados medidos" value={loading ? "…" : Number(summary.resultsEvaluated ?? 0)} />
      <Metric title="Ganadores" value={loading ? "…" : Number(summary.winners ?? 0)}
        note={`Tasa: ${percent(summary.winnerRate)}`} />
      <Metric title="Listings activos" value={loading ? "…" : Number(summary.activeListings ?? 0)} />
      <Metric title="Utilidad neta realizada" value={loading ? "…" : money(summary.realizedNetProfitUsd)} />
      <Metric title="Listos para revisar recompra" value={loading ? "…" : Number(summary.reorderReviewReady ?? 0)} />
      <Metric title="Cobertura de resultados" value={loading ? "…" : percent(summary.evidenceCoverage)}
        note="Lo desconocido no se muestra como cero" />
    </section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black">Registrar o actualizar un producto</h2>
      <p className="mt-2 text-sm text-white/50">
        Usa el mismo SKU del proveedor para actualizar el historial del producto.
        Este formulario sólo guarda evidencia interna; no publica ni compra.
      </p>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <fieldset className="grid gap-3 rounded-2xl bg-black/20 p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-black text-cyan-100">Proveedor y producto</legend>
          <Field name="supplierName" title="Proveedor *" placeholder="Nombre comercial" />
          <Field name="supplierBaseUrl" title="Sitio HTTPS *" placeholder="https://proveedor.com" />
          <Field name="supplierSku" title="SKU del proveedor *" />
          <Field name="supplierProductId" title="ID del producto" />
          <Field name="supplierProductUrl" title="URL del producto" />
          <Field name="inventoryQuantity" title="Inventario observado" type="number" />
          <Field name="title" title="Producto *" />
          <Field name="brand" title="Marca" />
          <Field name="category" title="Categoría" />
          <Field name="condition" title="Condición" />
          <Field name="asin" title="ASIN exacto" placeholder="10 caracteres" />
          <Field name="upc" title="UPC / GTIN" />
        </fieldset>

        <fieldset className="grid gap-3 rounded-2xl bg-black/20 p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-black text-cyan-100">Tesis y validación Amazon</legend>
          <Select name="demandClaim" title="Demanda declarada por Connie" options={[
            ["UNKNOWN", "Sin declarar"], ["HIGH", "Alta"],
            ["MEDIUM", "Media"], ["LOW", "Baja"],
          ]} />
          <Select name="demandEvidenceState" title="Estado de la evidencia" options={[
            ["CONTRIBUTOR_ASSERTED", "Declarada por Connie"],
            ["CONFIRMED", "Confirmada con Amazon / Keepa / SmartScout"],
            ["UNPROVEN", "Sin probar"], ["UNAVAILABLE", "No disponible"],
          ]} />
          <Field name="demandSource" title="Fuente de demanda" />
          <Field name="demandNotes" title="Razón de compra / notas" />
          <Select name="eligibilityState" title="Permiso para vender" options={[
            ["UNPROVEN", "Sin verificar"], ["CONFIRMED", "Confirmado"],
            ["RESTRICTED", "Restringido"], ["UNAVAILABLE", "No disponible"],
          ]} />
          <div className="rounded-xl border border-white/10 p-3 text-xs leading-5 text-white/50">
            Amazon, Keepa, SmartScout o un reporte comprobable confirman demanda.
            Una opinión profesional queda como evidencia de origen, no como venta.
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-2xl bg-black/20 p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-black text-cyan-100">Economía por unidad</legend>
          <Field name="unitCostUsd" title="Costo proveedor" type="number" />
          <Field name="inboundShippingPerUnitUsd" title="Envío inbound / unidad" type="number" />
          <Field name="prepCostPerUnitUsd" title="Prep / unidad" type="number" />
          <Field name="expectedSalePriceUsd" title="Precio esperado" type="number" />
          <Field name="referralFeePerUnitUsd" title="Referral fee" type="number" />
          <Field name="fbaFeePerUnitUsd" title="FBA fee" type="number" />
          <Field name="otherVariableCostPerUnitUsd" title="Otros costos / unidad" type="number" />
          <p className="self-end rounded-xl bg-emerald-200/10 p-3 text-xs text-emerald-100">
            Regla vigente: mínimo $4 netos por unidad. Si faltan tarifas, el
            resultado queda pendiente.
          </p>
        </fieldset>

        <fieldset className="grid gap-3 rounded-2xl bg-black/20 p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-black text-cyan-100">Listing y resultado real</legend>
          <Select name="listingState" title="Estado del listing" options={[
            ["NOT_LISTED", "No publicado"], ["DRAFT", "Borrador"],
            ["ACTIVE", "Activo"], ["INACTIVE", "Inactivo"],
            ["SUPPRESSED", "Suprimido"],
          ]} />
          <Field name="sellerSku" title="Seller SKU" />
          <Field name="listingPriceUsd" title="Precio publicado" type="number" />
          <Field name="listedAt" title="Fecha de publicación" type="datetime-local" />
          <Select name="resultAuthority" title="Autoridad del resultado" options={[
            ["UNPROVEN", "Sin reporte"],
            ["SELLER_CENTRAL_REPORT", "Reporte de Seller Central"],
            ["OWNER_ATTESTED", "Confirmado por el owner"],
            ["CONTRIBUTOR_ATTESTED", "Informado sólo por Connie"],
          ]} />
          <Field name="observationWindowDays" title="Días medidos" type="number" />
          <Field name="unitsPurchased" title="Unidades compradas" type="number" />
          <Field name="unitsSold" title="Unidades vendidas" type="number" />
          <Field name="grossSalesUsd" title="Ventas brutas" type="number" />
          <Field name="amazonFeesUsd" title="Tarifas Amazon totales" type="number" />
          <Field name="fulfillmentFeesUsd" title="Fulfillment total" type="number" />
          <Field name="refundsUsd" title="Reembolsos / pérdidas" type="number" />
          <Field name="otherActualCostsUsd" title="Otros costos reales" type="number" />
          <Field name="firstSaleAt" title="Primera venta" type="datetime-local" />
        </fieldset>
      </div>
      <button type="button" onClick={() => void save()} disabled={saving}
        className="mt-5 min-h-12 rounded-2xl bg-emerald-200 px-6 font-black text-emerald-950 disabled:opacity-40">
        {saving ? "Guardando y verificando…" : "Guardar observación"}
      </button>
    </section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black">Productos y siguiente evidencia</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {cards.length === 0 && <p className="text-sm text-white/50">
          Todavía no hay productos registrados. El primer producto quedará como
          descubierto y Seller OS indicará qué evidencia falta.
        </p>}
        {cards.map((card) => {
          const observation = object(card.observation)
          const outcome = object(observation.outcome)
          const performance = object(observation.performance)
          const economics = object(observation.economics)
          const next = object(observation.nextBestEvidence)
          const supplier = object(observation.supplier)
          return <article key={String(card.id)}
            className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-black">{String(card.title ?? "Producto")}</h3>
                <p className="mt-1 text-xs text-white/45">
                  {String(supplier.name ?? "Proveedor")} · SKU {String(supplier.sku ?? "—")}
                </p></div>
              <span className="rounded-full bg-cyan-200/10 px-3 py-1 text-xs font-bold text-cyan-100">
                {outcomeLabels[String(outcome.skillOutcome)] ?? String(outcome.skillOutcome ?? "Pendiente")}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Etapa</dt><dd className="mt-1 font-bold">{String(observation.lifecycleStage ?? "—")}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Neto proyectado</dt><dd className="mt-1 font-bold">{money(economics.projectedNetProfitPerUnitUsd)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Unidades vendidas</dt><dd className="mt-1 font-bold">{performance.observedUnitsSold == null ? "Sin evidencia" : String(performance.observedUnitsSold)}</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/40">Neto real / unidad</dt><dd className="mt-1 font-bold">{money(performance.actualNetProfitPerUnitUsd)}</dd></div>
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
