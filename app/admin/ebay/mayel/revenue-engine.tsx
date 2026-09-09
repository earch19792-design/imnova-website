"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { FRIENDLY_ACTIONS, METRIC_WINDOWS, scheduledLocalTimeV1, type MetricWindow, type PromotionPolicy } from "@/lib/seller-os/listing-treatment-engine-v1"
import type { prepareTreatmentPreviewV1 } from "@/lib/seller-os/listing-treatment-runtime-v1"
import { OwnerListingQualityReportControl } from "@/app/admin/owner-listing-quality-report-control"
import { MayelImageWorkspace } from "./image-workspace"

type Result = Awaited<ReturnType<typeof prepareTreatmentPreviewV1>>
type ListingChoice = { itemId: string; title: string; sku?: string | null; observedAt?: string | null }
const money = (n: number | null | undefined) => n === null || n === undefined ? "Por comprobar" : `$${n.toFixed(2)}`
const button = "min-h-11 rounded-xl border border-[#c7d0c3] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
const presets = { Conservador: [2, 3, 10, 20], Equilibrado: [3, 5, 8, 15], Acelerar: [3, 7, 8, 15] } as const
async function request(body?: unknown, after?: string) {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw Error("AUTH_REQUIRED")
  const response = await fetch(`/api/admin/ebay/assistant/revenue-engine${after ? `?after=${encodeURIComponent(after)}` : ""}`, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(65000),
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => { throw Error(`HTTP_${response.status}_INVALID_RESPONSE`) })
  if (!response.ok || !payload.success) throw Error(`${payload.error ?? "REQUEST_FAILED"} · ${payload.traceId ?? ""}`)
  return payload
}
export function MayelRevenueEngine({ owner }: { owner: boolean }) {
  const [menu, setMenu] = useState(0)
  const [listings, setListings] = useState<ListingChoice[]>([])
  const [loadingListings, setLoadingListings] = useState(true)
  const [actionsAvailable, setActionsAvailable] = useState(false)
  const [authoritativeZero, setAuthoritativeZero] = useState(false)
  const [selectionDetails, setSelectionDetails] = useState("")
  const [savedListingsOpen, setSavedListingsOpen] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [pageCursor, setPageCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [policy, setPolicy] = useState<PromotionPolicy>({ mode: "MANUAL", minRate: 3, maxRate: 5, minProfit: 8, minMargin: 15,
    window: "NOW", timeZone: "", startsAt: null, endsAt: null })
  const [preset, setPreset] = useState("Equilibrado")
  const [window, setWindow] = useState<MetricWindow>("7D")
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [receiptKey, setReceiptKey] = useState("")
  const [dates, setDates] = useState({ startsAt: "", endsAt: "" })
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  useEffect(() => { let active = true; void request().then(p => {
    if (active) { setListings(p.listings); setNextCursor(p.nextCursor); setActionsAvailable(p.actionsAvailable === true);
      setAuthoritativeZero(p.authoritativeZero === true); setSelectionDetails([p.sourceFailureCode, p.traceId].filter(Boolean).join(" · "));
      if (p.timeZone) setPolicy(old => ({ ...old, timeZone: p.timeZone })) }
  }).catch(e => { if (active) setError(String(e.message)) }).finally(() => { if (active) setLoadingListings(false) }); return () => { active = false } }, [])
  async function page(after?: string) {
    setBusy(true); setLoadingListings(true); setError("")
    try { const p = await request(undefined, after); setListings(p.listings); setNextCursor(p.nextCursor); setPageCursor(after ?? null); setSelected([]); setResult(null);
      setActionsAvailable(p.actionsAvailable === true); setAuthoritativeZero(p.authoritativeZero === true); setSavedListingsOpen(false);
      setSelectionDetails([p.sourceFailureCode, p.traceId].filter(Boolean).join(" · ")); if (p.timeZone) setPolicy(old => ({ ...old, timeZone: p.timeZone })) }
    catch (e) { setError(e instanceof Error ? e.message : "REQUEST_FAILED") }
    finally { setBusy(false); setLoadingListings(false) }
  }
  async function analyze(mode: "PREVIEW" | "SIMULATE" | "RECEIPT" | "MEASURE" | "IMAGE", itemId?: string) {
    if (busy) return
    setBusy(true); setError(""); setMessage(""); setPreviewItemId(null)
    try {
      const key = mode === "RECEIPT" ? receiptKey : crypto.randomUUID()
      const scheduledPolicy = policy.window === "NOW" ? policy : { ...policy,
        startsAt: scheduledLocalTimeV1(dates.startsAt, policy.timeZone), endsAt: scheduledLocalTimeV1(dates.endsAt, policy.timeZone) }
      const p = await request({ mode, itemIds: itemId ? [itemId] : selected, policy: scheduledPolicy, window, idempotencyKey: key })
      setResult(p.result); setReceiptKey(key)
      if (mode === "RECEIPT") setMessage("Simulación guardada. Podrás comparar los resultados cuando haya una acción aplicada y datos posteriores.")
      if (mode === "IMAGE") { setImagePreview(p.imagePreviewUrl); setMessage("Imagen preparada desde la fuente autorizada. El borrador conserva sus controles de calidad y procedencia.") }
      if (mode === "MEASURE") setMessage(p.measurements?.every((m: { outcomes?: Record<string, string> }) => !m.outcomes || Object.values(m.outcomes).every(v => v === "INSUFFICIENT_EVIDENCE"))
        ? "Aún no hay periodos posteriores comparables. La simulación no modificó tus listings." : "Hay nuevas observaciones. Revisa los cambios sin atribuirlos automáticamente a la propuesta.")
    } catch (e) { setError(e instanceof Error ? e.message : "REQUEST_FAILED") }
    finally { setBusy(false) }
  }
  function changePolicy(p: Partial<PromotionPolicy>) { setPolicy(old => ({ ...old, ...p })); setResult(null); setPreset("Personalizado") }
  return <section className="space-y-5">
    <div className="flex justify-end">
      <a className={`${button} inline-flex items-center gap-2`} href="/manual-mayel-menu-v1.pdf" target="_blank" rel="noopener noreferrer"
        aria-label="Ayuda / Manual de Mayel (abre en otra pestaña)">Ayuda / Manual</a>
    </div>
    <nav aria-label="Acciones principales de Mayel" className="grid gap-2 sm:grid-cols-4">
      {FRIENDLY_ACTIONS.map((name, index) => <button className={`${button} ${menu === index ? "bg-[#dcebdc]" : ""}`} key={name}
        onClick={() => setMenu(index)} aria-pressed={menu === index}>{name}</button>)}
    </nav>
    {menu === 2 ? <article className="rounded-2xl bg-white p-5"><p>Prepara un listing y revisa su borrador antes de publicarlo.</p>
      {owner ? <Link className="mt-3 inline-block underline" href="/admin/ebay/opportunity-queue">Abrir borradores</Link>
        : <p className="mt-3">La publicación necesita revisión y autorización del owner.</p>}</article> : <>
      <div className="rounded-2xl bg-white p-5">
        <h2 className="text-xl font-semibold">{menu === 0 ? "¿Qué listings quieres mejorar?" : menu === 1 ? "Prepara un impulso que proteja tu beneficio" : "¿Dónde hay una oportunidad ahora?"}</h2>
        <p className="mt-2 text-sm text-slate-600">Mayel revisa primero el rendimiento y explica qué conviene hacer. Hasta 20 listings por selección.</p>
        {loadingListings ? <p role="status" className="mt-3">Cargando tus listings…</p> : !actionsAvailable && <div className="mt-3 space-y-2" role="status">
          <p>{listings.length ? "eBay no pudo confirmar el estado actual. Puedes consultar los datos y revisar las imágenes guardadas. El envío espera una nueva verificación; tus propuestas se conservan." : authoritativeZero ? "No hay listings activos en la última lectura confirmada." : "No se pudo obtener la lista actual. Esto no significa que tus listings hayan desaparecido."}</p>
          <button className={button} disabled={busy} onClick={() => void page(pageCursor ?? undefined)}>Volver a consultar</button>
          <details><summary>Ver detalles</summary><p className="break-all text-xs">{selectionDetails}</p></details>
        </div>}
        {!loadingListings && actionsAvailable && !listings.length && <p className="mt-3">No hay listings activos en esta página.</p>}
        <label className="mt-4 block"><input type="checkbox" checked={listings.length > 0 && selected.length === listings.length} disabled={busy || loadingListings || !listings.length}
          onChange={e => { setSelected(e.target.checked ? listings.map(l => l.itemId) : []); setResult(null) }} /> Seleccionar todos los mostrados</label>
        <div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">{listings.map(l => <label className="flex gap-3 rounded-xl border p-3 text-sm" key={l.itemId}>
          <input type="checkbox" checked={selected.includes(l.itemId)} disabled={busy} onChange={e => {
            setSelected(old => e.target.checked ? [...old, l.itemId] : old.filter(id => id !== l.itemId)); setResult(null)
          }} />{l.title || l.itemId}</label>)}</div>
        {nextCursor && <button className={`${button} mt-3`} disabled={busy} onClick={() => void page(nextCursor)}>Siguientes listings</button>}
        {pageCursor && <button className={`${button} mt-3`} disabled={busy} onClick={() => void page()}>Volver al inicio</button>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label>Periodo<select className="ml-2 rounded border p-2" value={window} onChange={e => { setWindow(e.target.value as MetricWindow); setResult(null) }}>{METRIC_WINDOWS.map(w => <option key={w}>{w}</option>)}</select></label>
          <label>Horario de la cuenta<select className="ml-2 rounded border p-2" value={policy.timeZone} onChange={e => changePolicy({ timeZone: e.target.value })}>
            <option value="">Seleccionar horario</option><option value="America/Los_Angeles">Pacífico (Los Ángeles)</option><option value="America/New_York">Este (Nueva York)</option><option value="America/Guatemala">Guatemala</option><option value="UTC">UTC</option>
            {policy.timeZone && !["America/Los_Angeles", "America/New_York", "America/Guatemala", "UTC"].includes(policy.timeZone) && <option value={policy.timeZone}>Horario configurado de la cuenta</option>}
          </select></label>
        </div>
      </div>
      {menu === 1 && <section className="space-y-3 rounded-2xl bg-white p-5" aria-label="Política de promoción">
        <label>Política <select className="rounded border p-2" value={preset} onChange={e => {
          setPreset(e.target.value); setResult(null); const values = presets[e.target.value as keyof typeof presets]
          if (values) setPolicy(old => ({ ...old, minRate: values[0], maxRate: values[1], minProfit: values[2], minMargin: values[3] }))
        }}>{[...Object.keys(presets), "Personalizado"].map(p => <option key={p}>{p}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-4">{([["minRate", "Mínimo %"], ["maxRate", "Máximo %"], ["minProfit", "Beneficio mínimo $"], ["minMargin", "Margen mínimo %"]] as const).map(([key, label]) =>
          <label key={key}>{label}<input type="number" min="0" step="0.01" value={policy[key]} className="mt-1 w-full rounded border p-2" onChange={e => changePolicy({ [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>)}</div>
        <div className="flex flex-wrap gap-4"><label>Modo <select value={policy.mode} onChange={e => changePolicy({ mode: e.target.value as PromotionPolicy["mode"] })}>
          <option value="OFF">Apagado</option><option value="MANUAL">Manual</option><option value="AUTO">Automático · simular</option></select></label>
          <label>Cuándo <select value={policy.window} onChange={e => changePolicy({ window: e.target.value as PromotionPolicy["window"] })}>
            <option value="NOW">Ahora</option><option value="WEEKEND">Fin de semana</option><option value="SCHEDULE">Programar</option></select></label></div>
        {policy.window !== "NOW" && <div className="grid gap-2 sm:grid-cols-2">{(["startsAt", "endsAt"] as const).map((key, i) => <label key={key}>{i ? "Hasta" : "Desde"} · horario de la cuenta
          <input type="datetime-local" className="w-full rounded border p-2" value={dates[key]} onChange={e => { setDates(old => ({ ...old, [key]: e.target.value })); setResult(null) }} /></label>)}</div>}
        <p className="text-sm text-slate-600">Los presets rellenan tus límites. Esta vista prepara una simulación; aún no activa publicidad.</p>
      </section>}
      <button className={`${button} bg-[#dcebdc]`} disabled={busy || loadingListings || !selected.length || (actionsAvailable && !policy.timeZone)} onClick={() => actionsAvailable ? void analyze(menu === 0 ? "PREVIEW" : "SIMULATE") : setSavedListingsOpen(true)}>
        {busy ? "Mayel está analizando…" : !actionsAvailable ? "Ver información guardada" : menu === 0 ? "Analizar y preparar Preview" : "Calcular Preview"}</button>
      {actionsAvailable && selected.length > 0 && !policy.timeZone && <p role="status">Selecciona el horario de la cuenta para continuar.</p>}
      {savedListingsOpen && !actionsAvailable && <section className="space-y-3" aria-label="Información guardada de los listings">
        {listings.filter(l => selected.includes(l.itemId)).map(l => <article key={l.itemId} className="rounded-2xl bg-white p-5">
          <h3 className="font-semibold">{l.title}</h3><p>Última información guardada · pendiente de verificar</p>
          <p>SKU: {l.sku ?? "Por comprobar"}</p><p>Última verificación: {l.observedAt ? new Date(l.observedAt).toLocaleString("es") : "Por comprobar"}</p>
          <a className="underline" href={`https://www.ebay.com/itm/${l.itemId}`} target="_blank" rel="noopener noreferrer">Ver listing en eBay</a>
        </article>)}
      </section>}
      {result && <section className="space-y-4" aria-label="Recomendación de Mayel">
        {menu !== 0 && <div className="rounded-2xl bg-[#dcebdc] p-5"><p>{result.summary.selected} seleccionados · {result.summary.ready} listos para impulsar · {result.summary.optimizeFirst} mejorar primero</p>
          <p>{result.summary.blockedMargin} bloqueados por margen · {result.summary.blockedEvidence} por evidencia · {result.summary.blockedStock} por stock</p>
          <p className="mt-2">Coste Ads: {money(result.summary.projectedAdCost)} · Beneficio: {money(result.summary.projectedProfitAfterAds)}</p>
          <p className="text-sm">Escenario de una venta atribuida por listing elegible; no es una previsión de ventas.</p></div>}
        {menu === 3 && <div className="rounded-2xl bg-white p-5"><p>{result.rows.filter(r => r.treatment === "SCALE").length} listings permiten preparar un impulso · {result.summary.optimizeFirst} necesitan mejorar primero · {result.summary.blockedMargin} requieren proteger margen · {result.summary.blockedStock} necesitan stock.</p><p>Prioridad por evidencia y tratamiento; no se estiman dólares adicionales sin respaldo.</p></div>}
        {menu === 1 && result.summary.ready > 0 && <button className={button} onClick={() => { setSelected(result.rows.filter(r => r.treatment === "SCALE" && r.promotion.status === "SIMULATION_READY").map(r => r.itemId)); setResult(null) }}>Seleccionar todos los listos de esta página</button>}
        {[...result.rows].sort((a, b) => menu === 3 ? ["PROFIT_PROTECT", "RESTOCK", "OPTIMIZE", "SCALE", "TEST", "HOLD"].indexOf(a.treatment) - ["PROFIT_PROTECT", "RESTOCK", "OPTIMIZE", "SCALE", "TEST", "HOLD"].indexOf(b.treatment) : 0).map(row => <article key={row.itemId} className="space-y-3 rounded-2xl bg-white p-5">
          <h3 className="text-lg font-semibold">{row.title}</h3><p className="font-semibold">{row.label}</p><p>{row.why}</p><p>{row.recommendedAction}</p>
          <p>Datos del listing: <strong>{row.commercialEnvelope.label}</strong></p>
          {row.treatment === "TEST" && <p className="text-sm">Estamos reuniendo datos para decidir con confianza. Mayel volverá a evaluarlos en el próximo análisis. Mientras tanto, no se preparará una promoción.</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">{([["impressions", "Impresiones"], ["views", "Visitas"], ["ctr", "CTR"], ["unitsSold", "Unidades vendidas"], ["conversion", "Conversión"], ["salesRevenue", "Ventas"]] as const).map(([key, label]) => <div key={key}>
            <dt>{label} · {window}</dt><dd className="font-semibold">{row.metrics.windows[window]?.[key]?.value ?? "Sin datos para este periodo"}</dd></div>)}</dl>
          <section aria-label="Observaciones disponibles" className="rounded-xl bg-slate-50 p-3">
            <h4 className="font-semibold">Datos disponibles de otros periodos</h4>
            <p className="text-sm">Cada dato conserva el periodo informado por eBay. No se usa como sustituto del periodo seleccionado.</p>
            {([["impressions", "Impresiones"], ["views", "Visitas"], ["ctr", "CTR informado"], ["unitsSold", "Unidades vendidas"], ["conversion", "Conversión informada"], ["salesRevenue", "Ventas"]] as const).map(([key, label]) => {
              const observation = row.metrics.sourceObservations[key]
              if (row.metrics.windows[window]?.[key]?.value !== null || observation?.availability !== "AVAILABLE" ||
                observation.identity.itemId !== row.itemId || !observation.source.evidenceReference ||
                observation.value === null || !Number.isFinite(observation.value) || !observation.reportingWindow) return null
              return <p key={key} className="mt-2 text-sm">{label}: <strong>{observation.value}</strong> · {observation.reportingWindow.start.slice(0, 10)} a {observation.reportingWindow.end.slice(0, 10)} · {observation.reportingWindow.timeZone ?? "Horario por comprobar"}
                {observation.freshness.status !== "FRESH" && " · Pendiente de actualización"}</p>
            })}
          </section>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">{([["Precio", row.economics.components.salePrice.value], ["Coste del producto", row.economics.components.productCost.value],
            ["Envío", row.economics.components.shippingCost.value], ["Comisiones eBay", row.economics.components.ebayFees.value], ["Otros costes", row.economics.components.otherCosts.value],
            ["Beneficio antes de Ads", row.economics.profitBeforeAds]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold">{money(value)}</dd></div>)}</dl>
          <p>Margen antes de Ads: {row.economics.marginBeforeAds === null ? "Por comprobar" : `${row.economics.marginBeforeAds.toFixed(2)}%`}</p>
          {row.economics.economicsUnproven && <p className="text-sm text-amber-800">{row.feeHandoff && row.feeHandoff.status !== "PROVEN" ? row.feeHandoff.label : "Faltan costes vigentes para comprobar el beneficio."}</p>}
          <p>Quality: {row.quality.freshness ?? "Por comprobar"} · {row.quality.reportDate ?? "Sin fecha"} · {row.quality.recommendations.length} recomendaciones</p>
          {row.quality.recommendations.map((r, i) => <p key={i} className="text-sm">{r.recommendationText} · {r.actionState}</p>)}
          <p className="text-sm">Tasa recomendada: {row.promotion.recommendedAdRate ?? "Por comprobar"}% · Máxima segura: {row.promotion.maxSafeAdRate ?? "Por comprobar"}%</p>
          <p className="text-sm">Ads por venta: {money(row.promotion.projectedAdCost)} · Beneficio después: {money(row.promotion.projectedProfitAfterAds)} · Margen: {row.promotion.projectedMarginAfterAds?.toFixed(2) ?? "Por comprobar"}%</p>
          {result.previews?.find(p => p.itemId === row.itemId)?.result.preview && <button className={button} onClick={() => setPreviewItemId(row.itemId)}>Ver Preview del listing</button>}
          {previewItemId === row.itemId && (() => {
            const preview = result.previews?.find(p => p.itemId === row.itemId)?.result.preview
            return preview ? <section aria-label="Preview del listing" className="rounded-xl border border-[#b9ccaf] p-4">
              <h4 className="font-semibold">Preview · {String(preview.title ?? row.title)}</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm">{String(preview.description ?? "Descripción por comprobar").replace(/<[^>]*>/g, " ")}</p>
              <p className="mt-2 text-sm">{row.treatment === "OPTIMIZE" ? "Propuesta sujeta a las comprobaciones de evidencia." : "Se conserva el borrador actual mientras se comprueba el tratamiento."}</p>
              <p className="text-sm">No se ha publicado ningún cambio.</p>
            </section> : null
          })()}
          {owner && row.treatment === "OPTIMIZE" && row.diagnosticPriorities.includes("MAIN_IMAGE") && <button className={button} disabled={busy} onClick={() => void analyze("IMAGE", row.itemId)}>Preparar mejora de imagen</button>}
          <details><summary>Ver detalles</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ row, preview: result.previews?.find(p => p.itemId === row.itemId) }, null, 2)}</pre></details>
        </article>)}
        {menu === 1 && owner && <button className={button} disabled={busy} onClick={() => void analyze("RECEIPT")}>Guardar simulación</button>}
        <button className={button} disabled={busy} onClick={() => void analyze("MEASURE")}>Medir resultados</button>
      </section>}
      {menu === 0 && selected.length > 0 && <MayelImageWorkspace key={selected.join(",")} itemIds={selected} />}
      {menu === 0 && owner && <OwnerListingQualityReportControl />}
    </>}
    {message && <p role="status">{message}</p>}
    {imagePreview && <figure className="rounded-xl bg-white p-4"><Image src={imagePreview} alt="Preview del borrador de imagen autorizado" width={480} height={480} unoptimized /><figcaption>Imagen en borrador · revisión de calidad completada</figcaption></figure>}
    {error && <div role="alert"><p>No se pudo completar la consulta. Puedes volver a intentarlo.</p><button className={button} disabled={busy} onClick={() => void page(pageCursor ?? undefined)}>Volver a cargar listings</button><details><summary>Ver detalles</summary><p className="break-all text-xs">{error}</p></details></div>}
  </section>
}
