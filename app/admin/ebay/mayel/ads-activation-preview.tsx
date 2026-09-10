"use client"
import { promotionShippingLabelV1, promotionEconomicStatusV1, promotionDataLabelV1 } from "@/lib/seller-os/mayel-promotion-ui-semantics-v1"
import { MayelListingShippingStatus } from "./shipping-status"
import type { MayelShippingSnapshotV1 } from "@/lib/seller-os/mayel-shipping-visibility-v1"
import { useState } from "react"
import { supabase } from "@/lib/supabase"
import type { readAdsRevenueActivationV1 } from "@/lib/seller-os/ebay-ads-revenue-runtime-v1"

type Result = Awaited<ReturnType<typeof readAdsRevenueActivationV1>>
const pct = (n: number | null) => n === null ? "Por comprobar" : `${n.toFixed(2)}%`
const money = (n: number | null) => n === null ? "Por comprobar" : `$${n.toFixed(2)}`
export function MayelAdsActivationPreview({ itemIds, shipping }: { itemIds: string[]; shipping: MayelShippingSnapshotV1 | null }) {
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error,setError] = useState("")
  async function review() {
    setBusy(true); setError(""); setResult(null)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw Error("Vuelve a ingresar para revisar la publicidad.")
      const r = await fetch("/api/admin/ebay/assistant/revenue-engine", { method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ADS_ACTIVATION", itemIds }), signal: AbortSignal.timeout(60000) })
      const p = await r.json()
      if (!r.ok || !p.success) throw Error(p.error ?? "No pudimos completar la revisión.")
      setResult(p.activation)
    } catch (e) { setError(e instanceof Error ? e.message : "No pudimos completar la revisión.") }
    finally { setBusy(false) }
  }
  return <section aria-label="Revisión de publicidad" className="space-y-3 rounded-2xl bg-white p-5">
    <button className="min-h-11 rounded-xl border px-4 py-2 font-semibold disabled:opacity-50" disabled={busy || !itemIds.length} onClick={() => void review()}>
      {busy ? "Revisando publicidad…" : "Revisar publicidad guardada"}
    </button>
    <p className="text-sm">Revisa los costes y el borrador de política guardado antes de autorizar publicidad.</p>
    {error && <p role="alert">{error}</p>}
    {result && <><p>{result.summary.examined} listings revisados · {result.summary.economicsProven} con economía comprobada · {result.summary.ready} disponibles para preparar una prueba.</p>
      {result.rows.map(row => <article key={row.itemId} className="rounded-xl border p-4">
        <h3 className="font-semibold">{row.preview.TITLE ?? row.itemId}</h3>
        <p className="font-medium">{row.treatmentLabel}</p>
        <MayelListingShippingStatus snapshot={shipping} itemId={row.itemId} />
        <p>{row.singleListingAdsCanaryReady ? "Requiere tu aprobación antes de gastar." : "Esperando los datos necesarios para completar la revisión."}</p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[
          ["Precio", money(row.preview.SALE_PRICE)], ["Costo", money(row.preview.PRODUCT_COST)],
          ["Envío", promotionShippingLabelV1({itemId:row.itemId,value:row.preview.SHIPPING,reference:row.commercialEnvelope.shipping.reference,snapshot:shipping})], ["Fees eBay", money(row.preview.EBAY_FEES)],
          ["Ganancia antes Ads", money(row.preview.PROFIT_BEFORE_ADS)], ["Margen", pct(row.preview.MARGIN_BEFORE_ADS)],
          ["Techo Ads seguro", pct(row.preview.MAX_SAFE_AD_RATE_PCT)], ["Ads recomendada", pct(row.preview.PROPOSED_AD_RATE_PCT)],
          ["Ganancia después Ads", money(row.preview.PROJECTED_PROFIT_AFTER_ADS)],
        ].map(([label, value]) => <div key={label}><dt className="text-sm">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>

        <p>Datos del listing: <strong>{promotionDataLabelV1({complete:row.economicsProven,sampleSufficient:row.metricsStatus === "COMPARABLE_SAMPLE",treatment:row.treatment,ownerActionRequired:!row.ownerPolicyValid})}</strong></p>
        <p role="status">{promotionEconomicStatusV1({feesProven:row.ebayFeeAuthorityPass,economicsProven:row.economicsProven}).label}</p>
        <p className="mt-2 text-sm">{row.preview.WHY_MAYEL_RECOMMENDS_PROMOTION}</p>
        {!row.ownerPolicyValid && <p>Revisa las fechas y los límites de tu política de publicidad.</p>}
        <details><summary>Ver detalles</summary><p className="text-sm">{row.shippingStatus === "SHIPPING_PROVEN" ? "Shipping comprobado al preparar este cálculo." : "Este cálculo esperaba Shipping vigente. La conexión con Luna no confirma el costo."}</p><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ ECONOMICS:promotionEconomicStatusV1({feesProven:row.ebayFeeAuthorityPass,economicsProven:row.economicsProven}).status, itemId:row.itemId, blockers:row.blockers, preview:row.preview, feeEstimateMode:row.feeEstimateMode, metricsStatus:row.metricsStatus, simulations:row.simulations },null,2)}</pre></details>
      </article>)}
    </>}
  </section>
}
