"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
type Form = Record<string, string>

const empty: Form = {
  supplierProductId: "", supplierVariantId: "", supplierSku: "", title: "",
  brand: "", category: "", productUrl: "",
  upc: "", asin: "", quantity: "", moq: "1", unitCost: "",
  deliveredCost: "", condition: "Brand New",
  amazonClicks30: "", amazonGrowth30: "", amazonClicks90: "",
  amazonGrowth90: "", amazonAveragePrice: "", amazonMinimumPrice: "",
  amazonMaximumPrice: "", amazonReferralFee: "", amazonFbaFee: "",
  amazonOfferDepth: "", amazonTotalOffers: "", amazonPromotion: "0",
  amazonReturns: "", amazonOther: "0", amazonEligible: "",
  ebayItemId: "", ebaySold: "", ebayWindow: "30", ebayPrice: "",
  ebayFee: "", ebayFulfillment: "", ebayPromotion: "0", ebayReturns: "",
  ebayOther: "0", ebayEligible: "",
}

const laneLabels: Record<string, string> = {
  ALL: "Todos", NEW_DISCOVERY: "Nuevos para investigar",
  RESEARCH_PENDING: "Esperando evidencia", BUY_READY: "Listos para compra",
  HOLD: "En espera", REJECTED: "Descartados", RESULT: "Resultados",
}

const actionLabels: Record<string, string> = {
  VERIFY_AMAZON_ASIN: "Verificar ASIN exacto",
  VERIFY_AMAZON_ELIGIBILITY: "Verificar permiso para vender en Amazon",
  GET_AMAZON_DEMAND: "Revisar demanda en Amazon",
  GET_EBAY_EXACT_SOLD: "Revisar ventas exactas en eBay",
  CAPTURE_DELIVERED_COST: "Confirmar costo entregado en el carrito",
  REVIEW_AMAZON_COMPETITION: "Revisar competencia de Amazon",
  READY_FOR_OWNER_BUY_REVIEW: "Revisión final de compra",
  WAIT_UPSTREAM: "Esperar inventario o datos del proveedor",
}

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function displayMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return "Sin dato"
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `$${numeric.toFixed(2)}` : "Sin dato"
}

async function request(init?: RequestInit) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw new Error("Inicia sesión como propietario.")
  return fetch("/api/admin/marketplace/supplier-catalog/888lots", {
    cache: "no-store", ...init,
    headers: { Authorization: `Bearer ${session.data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers },
  })
}

const panel = { border: "1px solid #d8dee8", borderRadius: 16,
  padding: 20, background: "#fff" }
const grid = { display: "grid", gridTemplateColumns:
  "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }
const label = { display: "grid", gap: 5, fontSize: 13, fontWeight: 650 }
const input = { border: "1px solid #aeb8c8", borderRadius: 9, padding: "10px 11px",
  minWidth: 0, font: "inherit" }

function SummaryCard({ title, value, tone = "#173d2d" }: {
  title: string, value: unknown, tone?: string
}) {
  return <div style={{ ...panel, padding: 16 }}><div style={{ color: "#657184",
    fontSize: 12 }}>{title}</div><strong style={{ color: tone, fontSize: 26 }}>
      {String(value ?? 0)}</strong></div>
}

export default function LotsManualCapturePage() {
  const [form, setForm] = useState<Form>(empty)
  const [recent, setRecent] = useState<Json[]>([])
  const [radar, setRadar] = useState<Json>({})
  const [amazonStars, setAmazonStars] = useState<Json>({})
  const [result, setResult] = useState<Json | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState("")
  const [message, setMessage] = useState("")
  const [lane, setLane] = useState("ALL")
  const [search, setSearch] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const manualRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await request()
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo leer el Radar."))
      }
      setRecent(array(payload.recentCandidates).map(object))
      setRadar(object(payload.radar))
      setAmazonStars(object(payload.amazonStars))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer el Radar.")
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function set(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function field(name: string, title: string, type = "text", placeholder = "") {
    return <label style={label}>{title}<input style={input} type={type}
      value={form[name] ?? ""} placeholder={placeholder}
      onChange={(event) => set(name, event.target.value)} /></label>
  }

  async function sync(sourceView: string) {
    setSyncing(sourceView); setMessage("")
    try {
      const response = await request({ method: "POST", body: JSON.stringify({
        action: "SYNC_PUBLIC_CATALOG_VIEW", sourceView,
      }) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo actualizar el catálogo."))
      }
      setRadar(object(payload.radar))
      setAmazonStars(object(payload.amazonStars))
      const syncResult = object(payload.sync)
      const preSearch = object(payload.preSearch)
      setMessage(`Catálogo actualizado: ${String(syncResult.productsObserved ?? 0)} ` +
        `productos observados; ${String(syncResult.snapshotsInserted ?? 0)} cambios guardados. ` +
        `PreSearch revisó ${String(preSearch.selectedCount ?? 0)} candidatos.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar.")
    } finally { setSyncing("") }
  }

  async function runPreSearch() {
    setSyncing("presearch"); setMessage("")
    try {
      const response = await request({ method: "POST", body: JSON.stringify({
        action: "RUN_DUAL_MARKET_PRESEARCH", limit: 5,
      }) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo ejecutar PreSearch."))
      }
      setRadar(object(payload.radar))
      setAmazonStars(object(payload.amazonStars))
      const preSearch = object(payload.preSearch)
      setMessage(`PreSearch terminado: ${String(preSearch.researchedCount ?? 0)} ` +
        `investigaciones nuevas y ${String(preSearch.replayedCount ?? 0)} reutilizadas.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo ejecutar PreSearch.")
    } finally { setSyncing("") }
  }

  function chooseCandidate(card: Json) {
    const conditionCode = String(card.conditionCode ?? "")
    setForm((current) => ({ ...current,
      supplierProductId: String(card.supplierProductId ?? card.supplierSku ?? ""),
      supplierVariantId: String(card.supplierVariantId ?? card.supplierSku ?? ""),
      supplierSku: String(card.supplierSku ?? ""),
      title: String(card.title ?? ""), brand: String(card.brand ?? ""),
      category: String(card.category ?? card.department ?? ""),
      productUrl: String(card.productUrl ?? ""), upc: String(card.upc ?? ""),
      asin: String(card.asin ?? ""), quantity: card.availableQuantity == null
        ? "" : String(card.availableQuantity),
      moq: card.minimumOrderQuantity == null ? "1" : String(card.minimumOrderQuantity),
      unitCost: card.currentUnitCostUsd == null ? "" : String(card.currentUnitCostUsd),
      deliveredCost: "",
      condition: conditionCode.includes("DISTR") ? "Distribution Stock"
        : conditionCode.includes("REFURB") ? "Refurbished" : "Brand New",
      amazonAveragePrice: "",
      amazonMinimumPrice: "", amazonMaximumPrice: "",
      amazonReferralFee: "", amazonFbaFee: "", amazonEligible: "",
    }))
    setResult(null); setManualOpen(true)
    setMessage("Producto cargado para investigar. Confirma shipping en carrito y datos de marketplace.")
    requestAnimationFrame(() => manualRef.current?.scrollIntoView({ behavior: "smooth" }))
  }

  async function evaluate(save: boolean) {
    setLoading(true); setMessage(""); setResult(null)
    try {
      const capturedAt = new Date().toISOString()
      const amazonClicks = numberOrNull(form.amazonClicks30) !== null ||
        numberOrNull(form.amazonClicks90) !== null
      const amazonPrice = numberOrNull(form.amazonAveragePrice)
      const amazonFee = numberOrNull(form.amazonReferralFee)
      const amazonFba = numberOrNull(form.amazonFbaFee)
      const evidence: Json[] = [{ marketplace: "AMAZON_US",
        marketplaceProductId: form.asin, exactProductMatch: Boolean(form.asin),
        identityState: form.asin ? "PROVEN" : "UNPROVEN",
        demandState: amazonClicks ? "SUPPORTED" : "UNPROVEN",
        observedUnitsSold: null, observationWindowDays: null,
        searchClicks30Days: numberOrNull(form.amazonClicks30),
        searchClickGrowth30Percent: numberOrNull(form.amazonGrowth30),
        searchClicks90Days: numberOrNull(form.amazonClicks90),
        searchClickGrowth90Percent: numberOrNull(form.amazonGrowth90),
        salePriceState: amazonPrice !== null ? "SUPPORTED" : "UNPROVEN",
        averageOfferPrice90DaysUsd: amazonPrice,
        minimumOfferPrice90DaysUsd: numberOrNull(form.amazonMinimumPrice),
        maximumOfferPrice90DaysUsd: numberOrNull(form.amazonMaximumPrice),
        feeState: amazonFee !== null ? "SUPPORTED" : "UNPROVEN",
        averageReferralFeeUsd: amazonFee,
        fulfillmentState: amazonFba !== null ? "SUPPORTED" : "UNPROVEN",
        averageFbaFeeUsd: amazonFba,
        promotionState: form.amazonPromotion !== "" ? "SUPPORTED" : "UNPROVEN",
        promotionCostUsd: numberOrNull(form.amazonPromotion),
        returnsReserveState: form.amazonReturns !== "" ? "SUPPORTED" : "UNPROVEN",
        returnsReserveUsd: numberOrNull(form.amazonReturns),
        otherVariableCostState: form.amazonOther !== "" ? "SUPPORTED" : "UNPROVEN",
        otherVariableCostUsd: numberOrNull(form.amazonOther),
        totalOfferDepth90Days: numberOrNull(form.amazonTotalOffers),
        averageOfferDepth90Days: numberOrNull(form.amazonOfferDepth),
        eligibilityState: form.amazonEligible ? "SUPPORTED" : "UNPROVEN",
        eligibleToSell: form.amazonEligible === "yes" ? true
          : form.amazonEligible === "no" ? false : null,
        capturedAt,
        authorityContract: "AMAZON_PRODUCT_OPPORTUNITY_EXPLORER_OWNER_READONLY" }]
      if (form.ebayItemId || form.ebaySold || form.ebayPrice) {
        evidence.push({ marketplace: "EBAY_US", marketplaceProductId: form.ebayItemId,
          exactProductMatch: Boolean(form.ebayItemId),
          identityState: form.ebayItemId ? "PROVEN" : "UNPROVEN",
          demandState: form.ebaySold !== "" ? "PROVEN" : "UNPROVEN",
          observedUnitsSold: numberOrNull(form.ebaySold),
          observationWindowDays: numberOrNull(form.ebayWindow),
          salePriceState: form.ebayPrice ? "PROVEN" : "UNPROVEN",
          buyerLandedSalePriceUsd: numberOrNull(form.ebayPrice),
          feeState: form.ebayFee ? "PROVEN" : "UNPROVEN",
          marketplaceFeeUsd: numberOrNull(form.ebayFee),
          fulfillmentState: form.ebayFulfillment ? "PROVEN" : "UNPROVEN",
          fulfillmentCostUsd: numberOrNull(form.ebayFulfillment),
          promotionState: form.ebayPromotion !== "" ? "SUPPORTED" : "UNPROVEN",
          promotionCostUsd: numberOrNull(form.ebayPromotion),
          returnsReserveState: form.ebayReturns !== "" ? "SUPPORTED" : "UNPROVEN",
          returnsReserveUsd: numberOrNull(form.ebayReturns),
          otherVariableCostState: form.ebayOther !== "" ? "SUPPORTED" : "UNPROVEN",
          otherVariableCostUsd: numberOrNull(form.ebayOther),
          eligibilityState: form.ebayEligible ? "SUPPORTED" : "UNPROVEN",
          eligibleToSell: form.ebayEligible === "yes" ? true
            : form.ebayEligible === "no" ? false : null,
          capturedAt, authorityContract: "CANONICAL_OPPORTUNITY_RESULT_V2" })
      }
      const body = { action: save ? "CAPTURE_MANUAL_DUAL_MARKETPLACE_SOURCING"
        : "PREVIEW_DUAL_MARKETPLACE_SOURCING", capturedAt,
        supplierRow: { supplier_sku: form.supplierSku,
          supplier_product_id: form.supplierProductId || form.supplierSku,
          supplier_variant_id: form.supplierVariantId || form.supplierSku,
          title: form.title,
          brand: form.brand, category: form.category, product_url: form.productUrl,
          upc: form.upc, asin: form.asin, condition: form.condition,
          available_quantity: numberOrNull(form.quantity),
          minimum_order_quantity: numberOrNull(form.moq),
          unit_cost_usd: numberOrNull(form.unitCost),
          delivered_unit_cost_usd: numberOrNull(form.deliveredCost),
          restock_status: "public catalog available", source_updated_at: capturedAt },
        marketplaceEvidence: evidence }
      const response = await request({ method: "POST", body: JSON.stringify(body) })
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo evaluar."))
      }
      setResult(payload)
      setMessage(save ? "Expediente guardado en la memoria de TEO."
        : "Evaluación calculada sin guardar.")
      if (save) await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo evaluar.")
    } finally { setLoading(false) }
  }

  const sourcing = object(result?.sourcing)
  const next = object(result?.nextBestEvidence)
  const summary = object(radar.summary)
  const source = object(radar.source)
  const starCandidates = array(amazonStars.candidates).map(object)
  const cards = useMemo(() => array(radar.cards).map(object).filter((card) => {
    if (lane !== "ALL" && String(card.operatingLane) !== lane) return false
    const query = search.trim().toLowerCase()
    return !query || [card.title, card.brand, card.asin, card.supplierSku,
      card.category, card.department].some((value) =>
      String(value ?? "").toLowerCase().includes(query))
  }), [radar.cards, lane, search])

  return <main style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 20px 60px",
    display: "grid", gap: 18 }}>
    <div><Link href="/admin">← Seller OS</Link><h1 style={{ marginBottom: 6 }}>
      Radar 888lots · Amazon + eBay</h1><p style={{ margin: 0, color: "#526071" }}>
      Descubre inventario, prioriza investigación y prepara compras pequeñas. No compra,
      publica ni cambia precios.</p></div>

    <section style={{ ...panel, background: "#f6faf8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16,
        alignItems: "start", flexWrap: "wrap" }}><div><h2 style={{ marginTop: 0 }}>
          Bandeja del proveedor</h2><p style={{ margin: 0, color: "#526071" }}>
          Actualización iniciada por el propietario. La automatización queda desactivada
          hasta contar con feed o exportación oficial.</p></div><div style={{ color: "#526071",
            fontSize: 13 }}>Última captura: {String(source.last_success_at ?? "Nunca")}</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        {[["trending", "Trending"], ["newest", "Nuevos"],
          ["price_drop", "Price Drop"], ["staff_picks", "Staff Picks"]].map(
          ([value, title]) => <button key={value} disabled={Boolean(syncing)}
            onClick={() => void sync(value)} style={{ ...input, cursor: "pointer",
              background: value === "trending" ? "#173d2d" : "#fff",
              color: value === "trending" ? "#fff" : "#17202b" }}>
            {syncing === value ? "Actualizando…" : `Actualizar ${title}`}</button>)}</div>
      <button disabled={Boolean(syncing)} onClick={() => void runPreSearch()}
        style={{ ...input, cursor: "pointer", marginTop: 10,
          background: "#275ea8", color: "#fff" }}>
        {syncing === "presearch" ? "Investigando…" :
          "Ejecutar PreSearch de 5 candidatos"}</button>
      {source.last_error ? <p style={{ color: "#9d2d20" }}>
        Último error: {String(source.last_error)}</p> : null}
    </section>

    <section style={grid}>
      <SummaryCard title="Productos observados" value={summary.total} />
      <SummaryCard title="Nuevos para investigar" value={summary.newDiscoveries}
        tone="#146c43" />
      <SummaryCard title="Esperando evidencia" value={Number(summary.researchPending ?? 0) +
        Number(summary.hold ?? 0)} tone="#9a6700" />
      <SummaryCard title="Listos para compra" value={summary.buyReady} tone="#0b7a37" />
    </section>

    <section style={{ ...panel, background: "#eef5ff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12,
        alignItems: "start", flexWrap: "wrap" }}><div><h2 style={{ marginTop: 0 }}>
          Productos estrella para Amazon</h2><p style={{ margin: 0, color: "#526071" }}>
          Es la misma lista que TEO consulta cuando le pides desde el chat 10 o 20
          candidatos. “Estrella” significa prioridad de investigación; no autoriza
          comprar ni publicar.</p></div><strong>
          {String(amazonStars.returnedCount ?? 0)} candidatos</strong></div>
      {starCandidates.length === 0 ? <p style={{ marginBottom: 0 }}>
        Actualiza una vista pública de 888lots para crear la primera lista.</p> :
        <ol style={{ display: "grid", gap: 9, paddingLeft: 24, marginBottom: 0 }}>
          {starCandidates.slice(0, 20).map((candidate) => {
            const ebay = object(candidate.ebayEvidence)
            const amazon = object(candidate.amazonEvidence)
            const action = String(candidate.nextBestEvidence ?? "")
            return <li key={String(candidate.supplierVariantId)} style={{ padding: 10,
              background: "#fff", borderRadius: 10 }}><strong>
                {String(candidate.title)}</strong><div style={{ fontSize: 13,
                  color: "#526071", marginTop: 4 }}>
                SKU {String(candidate.supplierSku)} · costo {displayMoney(
                  candidate.currentSupplierUnitCostUsd)} · stock {String(
                  candidate.availableQuantity ?? "?")} · ASIN {String(
                  candidate.asin ?? "sin verificar")}</div><div style={{ fontSize: 13,
                  marginTop: 4 }}>Amazon: {String(amazon.demandState ?? "UNPROVEN")} ·
                  eBay vendidos: {String(ebay.soldEvidenceState ?? "UNAVAILABLE")} ·
                  PreSearch: {String(candidate.preSearchStatus ?? "NOT_RUN")}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}><strong>Siguiente:</strong>{" "}
                  {actionLabels[action] ?? action}</div></li>
          })}</ol>}
    </section>

    <section style={panel}>
      <h2 style={{ marginTop: 0 }}>Cola inteligente</h2>
      <div style={{ ...grid, marginBottom: 16 }}><label style={label}>Estado
        <select style={input} value={lane} onChange={(event) => setLane(event.target.value)}>
          {Object.entries(laneLabels).map(([value, title]) =>
            <option key={value} value={value}>{title}</option>)}</select></label>
        <label style={label}>Buscar producto, ASIN o SKU<input style={input}
          value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Ej. B0…, marca o producto" /></label></div>
      {cards.length === 0 ? <div style={{ padding: 24, borderRadius: 12,
        background: "#f7f8fa" }}><strong>Aún no hay productos en esta vista.</strong>
        <p style={{ marginBottom: 0 }}>Pulsa “Actualizar Trending” para cargar el primer
          lote público y dejar de trabajar desde un formulario vacío.</p></div>
        : <div style={{ display: "grid", gridTemplateColumns:
          "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>{cards.map((card) => {
            const risks = array(card.riskFlags).map(String)
            const preSearch = object(card.preSearch)
            const preSearchEbay = object(preSearch.ebay)
            const action = String(card.commercialNextBestEvidence ?? card.nextBestEvidence ?? "")
            const firstOrder = object(card.promotion).firstOrderOnly === true
            return <article key={`${String(card.productId)}:${String(card.snapshotId)}`}
              style={{ border: "1px solid #e0e5ec", borderRadius: 14, padding: 16,
                display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 12 }}>
                {card.imageUrl ? <img src={String(card.imageUrl)} alt="" width={76}
                  height={76} style={{ objectFit: "contain", borderRadius: 8,
                    background: "#f4f5f7" }} /> : null}
                <div><span style={{ fontSize: 12, color: "#657184" }}>
                  {laneLabels[String(card.operatingLane)] ?? card.operatingLane} ·
                  prioridad {String(card.researchScore ?? 0)}/100</span>
                  <h3 style={{ margin: "4px 0", fontSize: 16 }}>{String(card.title)}</h3>
                  <div style={{ fontSize: 13 }}>{String(card.brand ?? "Marca sin verificar")} ·
                    ASIN {String(card.asin ?? "sin verificar")}</div></div></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                fontSize: 13 }}><div><strong>Costo público</strong><br />
                  {displayMoney(card.currentUnitCostUsd)}</div><div><strong>Precio regular</strong>
                  <br />{displayMoney(card.regularUnitCostUsd)}</div>
                <div><strong>Stock / MOQ</strong><br />{String(card.availableQuantity ?? "?")} /
                  {String(card.minimumOrderQuantity ?? "?")}</div>
                <div><strong>Estimado Amazon de 888lots</strong><br />
                  {displayMoney(card.supplierAmazonPriceEstimateUsd)}</div></div>
              <div style={{ fontSize: 12, color: "#657184" }}>
                Shipping público: {displayMoney(card.publicShippingEstimateUsd)}. Confirma el
                costo entregado en el carrito antes de decidir una compra.
              </div>
              <div style={{ fontSize: 12, color: "#526071" }}>
                PreSearch: {preSearch.contractVersion ?
                  `${String(preSearch.preSearchScore ?? 0)}/100 · eBay ${String(
                    preSearchEbay.soldEvidenceState ?? "UNPROVEN")}` :
                  "pendiente"}. Amazon LIVE permanece sin probar hasta verificarlo
                dentro de Seller Central.
              </div>
              <div style={{ fontSize: 13, padding: 10, borderRadius: 9,
                background: "#fff8df" }}><strong>Siguiente:</strong> {actionLabels[action] ?? action}
                {firstOrder ? <><br /><strong>Atención:</strong> precio promocional no
                  reutilizable para reposición.</> : null}</div>
              {risks.length ? <details><summary style={{ cursor: "pointer", fontSize: 13 }}>
                {risks.length} controles de riesgo</summary><ul style={{ fontSize: 12 }}>
                  {risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></details> : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => chooseCandidate(card)} style={{ ...input,
                  background: "#173d2d", color: "#fff", cursor: "pointer" }}>
                  Investigar este producto</button>
                <a href={String(card.productUrl)} target="_blank" rel="noreferrer"
                  style={{ ...input, textDecoration: "none", color: "#17202b" }}>
                  Ver en 888lots ↗</a></div>
              <small style={{ color: "#657184" }}>El precio Amazon mostrado por el proveedor
                no prueba demanda, Buy Box ni rentabilidad.</small>
            </article>
          })}</div>}
    </section>

    <section style={{ ...panel, background: "#101a24", color: "#fff" }}>
      <h2 style={{ marginTop: 0 }}>Regla diaria de TEO</h2><div style={grid}>
        <div><strong>20</strong><br />productos prefiltrados</div>
        <div><strong>5</strong><br />investigaciones profundas</div>
        <div><strong>Máx. 3</strong><br />unidades cuando sólo hay señal por clics</div>
        <div><strong>$4 netos</strong><br />mínimo obligatorio por unidad</div></div>
    </section>

    <section ref={manualRef} style={panel}>
      <button type="button" onClick={() => setManualOpen((current) => !current)}
        style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer",
          font: "inherit", fontWeight: 800, fontSize: 20 }}>
        {manualOpen ? "▾" : "▸"} Investigación y economics del candidato</button>
      {!manualOpen ? <p style={{ color: "#526071" }}>Selecciona “Investigar este producto”
        para precargar aquí sus datos del proveedor.</p> : <div style={{ display: "grid",
          gap: 18, marginTop: 18 }}>
        <div><h3>1. Producto disponible en 888lots</h3><div style={grid}>
          {field("productUrl", "Enlace de 888lots")}
          {field("supplierSku", "SKU del proveedor *")}{field("title", "Producto *")}
          {field("brand", "Marca *")}{field("category", "Categoría")}
          {field("upc", "UPC/GTIN")}{field("asin", "ASIN de Amazon")}
          {field("quantity", "Unidades disponibles *", "number")}
          {field("moq", "Compra mínima *", "number")}
          {field("unitCost", "Precio por unidad *", "number")}
          {field("deliveredCost", "Costo entregado confirmado *", "number",
            "Confirmar en carrito")}</div></div>
        <div><h3>2. Evidencia de Amazon Seller</h3><p style={{ color: "#526071" }}>
          Copia Product Opportunity Explorer. Los clics apoyan demanda, pero nunca se
          convierten en unidades vendidas.</p><div style={grid}>
          {field("amazonClicks30", "Clics últimos 30 días", "number")}
          {field("amazonGrowth30", "Crecimiento 30 días %", "number")}
          {field("amazonClicks90", "Clics últimos 90 días", "number")}
          {field("amazonGrowth90", "Crecimiento 90 días %", "number")}
          {field("amazonAveragePrice", "Precio promedio 90 días", "number")}
          {field("amazonMinimumPrice", "Precio mínimo 90 días", "number")}
          {field("amazonMaximumPrice", "Precio máximo 90 días", "number")}
          {field("amazonReferralFee", "Referral fee promedio", "number")}
          {field("amazonFbaFee", "FBA fee promedio", "number")}
          {field("amazonOfferDepth", "Ofertas promedio 90 días", "number")}
          {field("amazonTotalOffers", "Ofertas totales 90 días", "number")}
          {field("amazonReturns", "Reserva de devoluciones", "number")}
          <label style={label}>¿Podemos vender este ASIN?<select style={input}
            value={form.amazonEligible} onChange={(event) =>
              set("amazonEligible", event.target.value)}><option value="">No verificado</option>
            <option value="yes">Sí</option><option value="no">No</option></select></label></div></div>
        <details><summary style={{ fontWeight: 750, cursor: "pointer" }}>
          3. Evidencia eBay</summary><div style={{ ...grid, marginTop: 16 }}>
          {field("ebayItemId", "Item ID comparable")}
          {field("ebaySold", "Unidades vendidas exactas", "number")}
          {field("ebayWindow", "Ventana en días", "number")}
          {field("ebayPrice", "Precio entregado al comprador", "number")}
          {field("ebayFee", "Fee eBay", "number")}
          {field("ebayFulfillment", "Fulfillment", "number")}
          {field("ebayReturns", "Reserva de devoluciones", "number")}
          <label style={label}>¿Pasa Duplicate Gate?<select style={input}
            value={form.ebayEligible} onChange={(event) =>
              set("ebayEligible", event.target.value)}><option value="">No verificado</option>
            <option value="yes">Sí</option><option value="no">No</option></select></label></div></details>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button disabled={loading} onClick={() => void evaluate(false)}
            style={{ ...input, cursor: "pointer", background: "#fff" }}>
            Evaluar sin guardar</button><button disabled={loading}
              onClick={() => void evaluate(true)} style={{ ...input, cursor: "pointer",
                background: "#173d2d", color: "#fff" }}>
            Guardar en memoria de TEO</button></div></div>}
    </section>

    {message && <p role="status" style={{ margin: 0, padding: 12,
      background: "#eef4ff", borderRadius: 10 }}>{message}</p>}

    {result && <section style={{ ...panel, background: "#f5faf7" }}>
      <h2>Resultado</h2><div style={grid}>
        <p><strong>Decisión:</strong><br />{String(sourcing.decision ?? "HOLD")}</p>
        <p><strong>Prueba sugerida:</strong><br />
          {String(sourcing.recommendedPurchaseQuantity ?? "Sin calcular")} unidades</p>
        <p><strong>Precio máximo de compra:</strong><br />
          {sourcing.conservativeMaxSupplierUnitCostUsd == null ? "Sin calcular"
            : `$${String(sourcing.conservativeMaxSupplierUnitCostUsd)}`}</p>
        <p><strong>Siguiente evidencia:</strong><br />
          {actionLabels[String(next.action)] ?? String(next.action ?? "UNPROVEN")}</p></div>
      <p style={{ color: "#526071" }}>La cantidad “POLICY_LIMITED_TEST_NOT_VELOCITY”
        es una prueba controlada, no una estimación de ventas.</p></section>}

    <section style={panel}><h2>Memoria comercial de TEO</h2>
      {recent.length === 0 ? <p>No hay candidatos evaluados todavía. Los productos del Radar
        son descubrimientos; pasan a esta memoria sólo después de guardar su evaluación.</p>
        : <div style={{ display: "grid", gap: 8 }}>{recent.map((row) =>
          <article key={String(row.id)} style={{ borderTop: "1px solid #e2e7ee",
            paddingTop: 10 }}><strong>{String(row.product_title ?? row.candidate_key)}</strong>
            <div>{String(row.commercial_decision ?? "HOLD")} · siguiente: {actionLabels[
              String(row.commercial_next_best_evidence)] ?? String(
                row.commercial_next_best_evidence ?? "UNPROVEN")}</div></article>)}</div>}
    </section>
  </main>
}
