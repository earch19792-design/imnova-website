"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Json = Record<string, unknown>
type Form = Record<string, string>

const empty: Form = {
  supplierSku: "", title: "", brand: "", category: "", productUrl: "",
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

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
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

export default function LotsManualCapturePage() {
  const [form, setForm] = useState<Form>(empty)
  const [recent, setRecent] = useState<Json[]>([])
  const [result, setResult] = useState<Json | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  const load = useCallback(async () => {
    try {
      const response = await request()
      const payload = await response.json() as Json
      if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error ?? "No se pudo leer la memoria."))
      }
      setRecent(Array.isArray(payload.recentCandidates)
        ? payload.recentCandidates.map(object) : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer la memoria.")
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
          supplier_product_id: form.supplierSku,
          supplier_variant_id: form.supplierSku, title: form.title,
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

  return <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px 60px",
    display: "grid", gap: 18 }}>
    <div><Link href="/admin">← Seller OS</Link><h1 style={{ marginBottom: 6 }}>
      888lots + Amazon + eBay</h1><p style={{ margin: 0, color: "#526071" }}>
      Captura manual con memoria durable. No compra, publica ni cambia precios.</p></div>

    <section style={panel}><h2>1. Producto disponible en 888lots</h2>
      <div style={grid}>{field("productUrl", "Enlace de 888lots")}
        {field("supplierSku", "SKU del proveedor *")}{field("title", "Producto *")}
        {field("brand", "Marca *")}{field("category", "Categoría")}
        {field("upc", "UPC/GTIN")}{field("asin", "ASIN de Amazon")}
        {field("quantity", "Unidades disponibles *", "number")}
        {field("moq", "Compra mínima *", "number")}
        {field("unitCost", "Precio por unidad *", "number")}
        {field("deliveredCost", "Costo entregado por unidad *", "number")}</div>
    </section>

    <section style={panel}><h2>2. Evidencia de Amazon Seller</h2>
      <p style={{ color: "#526071" }}>Copia los datos de Product Opportunity Explorer.
        Los clics apoyan demanda, pero nunca se convierten en unidades vendidas.</p>
      <div style={grid}>{field("amazonClicks30", "Clics últimos 30 días", "number")}
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
          value={form.amazonEligible} onChange={(e) => set("amazonEligible", e.target.value)}>
          <option value="">No verificado</option><option value="yes">Sí</option>
          <option value="no">No</option></select></label></div>
    </section>

    <details style={panel}><summary style={{ fontWeight: 750, cursor: "pointer" }}>
      3. Evidencia eBay (opcional hasta investigarla)</summary>
      <div style={{ ...grid, marginTop: 16 }}>{field("ebayItemId", "Item ID comparable")}
        {field("ebaySold", "Unidades vendidas exactas", "number")}
        {field("ebayWindow", "Ventana en días", "number")}
        {field("ebayPrice", "Precio entregado al comprador", "number")}
        {field("ebayFee", "Fee eBay", "number")}
        {field("ebayFulfillment", "Fulfillment", "number")}
        {field("ebayReturns", "Reserva de devoluciones", "number")}
        <label style={label}>¿Pasa Duplicate Gate?<select style={input}
          value={form.ebayEligible} onChange={(e) => set("ebayEligible", e.target.value)}>
          <option value="">No verificado</option><option value="yes">Sí</option>
          <option value="no">No</option></select></label></div>
    </details>

    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button disabled={loading} onClick={() => void evaluate(false)}
        style={{ ...input, cursor: "pointer", background: "#fff" }}>
        Evaluar sin guardar</button>
      <button disabled={loading} onClick={() => void evaluate(true)}
        style={{ ...input, cursor: "pointer", background: "#173d2d", color: "#fff" }}>
        Guardar en memoria de TEO</button></div>
    {message && <p role="status" style={{ margin: 0 }}>{message}</p>}

    {result && <section style={{ ...panel, background: "#f5faf7" }}>
      <h2>Resultado</h2><div style={grid}>
        <p><strong>Decisión:</strong><br />{String(sourcing.decision ?? "HOLD")}</p>
        <p><strong>Prueba sugerida:</strong><br />
          {String(sourcing.recommendedPurchaseQuantity ?? "Sin calcular")} unidades</p>
        <p><strong>Precio máximo de compra:</strong><br />
          {sourcing.conservativeMaxSupplierUnitCostUsd == null ? "Sin calcular"
            : `$${String(sourcing.conservativeMaxSupplierUnitCostUsd)}`}</p>
        <p><strong>Siguiente evidencia:</strong><br />
          {String(next.action ?? "UNPROVEN")}</p></div>
      <p style={{ color: "#526071" }}>La cantidad “POLICY_LIMITED_TEST_NOT_VELOCITY”
        es una prueba controlada, no una estimación de ventas.</p></section>}

    <section style={panel}><h2>Memoria reciente de TEO</h2>
      {recent.length === 0 ? <p>Aún no hay productos 888lots guardados.</p>
        : <div style={{ display: "grid", gap: 8 }}>{recent.map((row) =>
          <article key={String(row.id)} style={{ borderTop: "1px solid #e2e7ee",
            paddingTop: 10 }}><strong>{String(row.product_title ?? row.candidate_key)}</strong>
            <div>{String(row.commercial_decision ?? "HOLD")} · siguiente: {String(
              row.commercial_next_best_evidence ?? "UNPROVEN")}</div></article>)}</div>}
    </section>
  </main>
}
