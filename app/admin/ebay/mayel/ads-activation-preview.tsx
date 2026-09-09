"use client"
import { useState } from "react"
import { supabase } from "@/lib/supabase"
import type { readAdsRevenueActivationV1 } from "@/lib/seller-os/ebay-ads-revenue-runtime-v1"

type Result = Awaited<ReturnType<typeof readAdsRevenueActivationV1>>
const money = (n: number | null) => n === null ? "Por comprobar" : `$${n.toFixed(2)}`
export function MayelAdsActivationPreview({ itemIds }: { itemIds: string[] }) {
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
        <p>{row.singleListingAdsCanaryReady ? "Requiere tu aprobación antes de gastar." : "Publicidad pendiente de verificar."}</p>
        <p>Beneficio antes de publicidad: {money(row.preview.PROFIT_BEFORE_ADS)} · Tasa máxima segura: {row.preview.MAX_SAFE_AD_RATE_PCT ?? "Por comprobar"}%</p>
        {!row.ownerPolicyValid && <p>Revisa las fechas y los límites de tu política de publicidad.</p>}
        {row.singleListingAdsCanaryReady && <dl>{Object.entries(row.preview).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "Por comprobar")}</dd></div>)}</dl>}
        <details><summary>Ver detalles</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ itemId:row.itemId, blockers:row.blockers, preview:row.preview, feeEstimateMode:row.feeEstimateMode },null,2)}</pre></details>
      </article>)}
    </>}
  </section>
}
