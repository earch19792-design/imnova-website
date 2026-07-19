"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  evaluateEbayQuotaLaneState,
  evaluateEbayQuotaRetryState,
} from "@/lib/ebay/ebay-quota-lane-domain"

type Row = Record<string, any>

async function token() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

export function TodayLaunchPanel() {
  const [pilot, setPilot] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    const accessToken = await token()
    if (!accessToken) return
    const response = await fetch("/api/admin/ebay/same-day-pilot", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || "No se pudo consultar el lanzamiento.")
    setPilot(body.pilot)
  }, [])
  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "No disponible")).finally(() => setLoading(false)) }, [load])
  useEffect(() => {
    if (!pilot || ["COMPLETED", "BLOCKED"].includes(String(pilot.run?.status))) return
    const timer = window.setInterval(() => {
      load().catch(() => undefined)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [load, pilot])
  const request = async (body: Row) => {
    setWorking(true); setError("")
    try {
      const accessToken = await token()
      const response = await fetch("/api/admin/ebay/same-day-pilot", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "No se pudo continuar.")
      setPilot(payload.pilot)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo continuar.") }
    finally { setWorking(false) }
  }
  const openTasks = useMemo(() => (pilot?.tasks ?? []).filter((task: Row) => task.status === "OPEN"), [pilot])
  const candidates = pilot?.candidates ?? []
  const productResearchTasks = openTasks.filter((task: Row) =>
    task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED")
  const decisionTasks = openTasks.filter((task: Row) =>
    task.gate_type !== "PRODUCT_RESEARCH_CAPTURE_REQUIRED")
  const primaryTask = decisionTasks[0]
  const queuedDecisionCount = Math.max(0, decisionTasks.length - 1)
  const deferredDecisionCount = productResearchTasks.length > 0 ? decisionTasks.length : queuedDecisionCount
  const primaryCandidate = primaryTask
    ? candidates.find((candidate: Row) => candidate.id === primaryTask.candidate_id)
    : undefined
  const readyCandidates = candidates.filter((candidate: Row) => candidate.machine_state === "READY_FOR_MANUAL_PUBLICATION")
  const runStatus = String(pilot?.run?.status ?? "")
  const quotaNow = new Date()
  const pausedJobs = (pilot?.jobs ?? []).map((job: Row) => ({
    job,
    decision: evaluateEbayQuotaRetryState({
      status: String(job.status ?? ""),
      last_error_code: typeof job.last_error_code === "string" ? job.last_error_code : null,
      rate_limit_resume_at: typeof job.rate_limit_resume_at === "string" ? job.rate_limit_resume_at : null,
      available_at: typeof job.available_at === "string" ? job.available_at : null,
    }, quotaNow),
  })).filter((entry: Row) => entry.decision.active)
  const quotaLanes = Array.isArray(pilot?.run?.quota_snapshot?.lanes)
    ? pilot.run.quota_snapshot.lanes : []
  const pausedQuotaLanes = quotaLanes.map((lane: Row) => ({
    lane,
    decision: evaluateEbayQuotaLaneState({
      status: String(lane.status ?? ""),
      reset_at: typeof lane.reset_at === "string" ? lane.reset_at : null,
      available_budget: lane.available_budget ?? null,
      reserved_budget: lane.reserved_budget ?? null,
      owner_lane: String(lane.owner_lane ?? ""),
    }, quotaNow),
  })).filter((entry: Row) => entry.decision.status === "PAUSED_429")
  const quotaPaused = pausedJobs.length > 0 || pausedQuotaLanes.length > 0
  const quotaResumeAt = [
    ...pausedJobs.map((entry: Row) => String(entry.decision.resumeAt || "")),
    ...pausedQuotaLanes.map((entry: Row) => String(entry.decision.resumeAt || "")),
  ].filter(Boolean).sort()[0]
  const currentBusinessState = !pilot ? "NO INICIADO" : runStatus === "BLOCKED" ? "BLOQUEADO" :
    runStatus === "COMPLETED" ? "PUBLICADO Y VERIFICADO" :
      candidates.some((candidate: Row) => candidate.machine_state === "READY_FOR_MANUAL_PUBLICATION") ? "LISTO PARA PUBLICAR" :
        openTasks.length ? "ESPERANDO TU CONFIRMACIÓN" :
          quotaPaused ? "PAUSADO POR EBAY" :
        candidates.some((candidate: Row) => candidate.machine_state === "BLOCKED") ? "BLOQUEADO" : "TRABAJANDO"
  return <section className="mt-5 min-w-0 overflow-hidden rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] to-emerald-200/[0.04] p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/60">Lanzamiento de hoy</p>
        <h2 className="mt-2 break-words text-2xl font-black">Objetivo: completar el piloto 3/3</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Un clic inicia el trabajo automático. Tú supervisas y Seller OS se detiene sólo cuando necesita una confirmación indispensable.</p>
      </div>
      <span className="rounded-full border border-white/15 px-3 py-2 text-xs font-black">{loading ? "CARGANDO" : currentBusinessState}</span>
    </div>
    {(!pilot || (runStatus === "BLOCKED" && candidates.length === 0)) && !loading && <button type="button" disabled={working} onClick={() => void request({ action: "start" })} className="mt-5 min-h-14 w-full rounded-2xl bg-cyan-200 px-5 text-base font-black text-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-50 sm:w-auto">{working ? "INICIANDO…" : pilot ? "BUSCAR CANDIDATOS SEGUROS DE NUEVO" : "INICIAR LANZAMIENTO DE HOY"}</button>}
    {error && <p role="alert" className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 p-3 text-sm font-bold text-red-100">{error}</p>}
    {pilot && <>
      <section aria-labelledby="system-working-heading" className="mt-5 rounded-2xl border border-emerald-200/20 bg-black/20 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-100/60">1 · Sistema trabajando</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h3 id="system-working-heading" className="text-lg font-black text-emerald-50">{currentBusinessState}</h3>
          <span className="text-sm font-bold text-white/65">Piloto {Number(pilot.run.verified_existing_listings) + Number(pilot.run.verified_new_listings)} / 3</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-white/60">Seller OS conserva el progreso, continúa los trabajos permitidos en segundo plano y te presenta una sola decisión a la vez.</p>
      </section>
      {quotaPaused && <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-50">eBay pausó únicamente la verificación exacta. La selección, Luna y los paquetes locales permanecen disponibles; Seller OS retomará el mismo producto automáticamente{quotaResumeAt ? ` después de ${new Date(quotaResumeAt).toLocaleString("es-NI")}` : " cuando eBay libere la cuota"}.</p>}
      <section aria-labelledby="operator-task-heading" className="mt-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-100/60">2 · Tu decisión</p>
        <h3 id="operator-task-heading" className="mt-1 text-lg font-black">Tarea para Ernesto</h3>
        {productResearchTasks.length > 0
          ? <div className="mt-3"><ProductResearchQueueTask guidance={pilot.productResearchGuidance} researchTasks={productResearchTasks} fallbackQuery={productResearchTasks[0]?.action_schema?.query} openTaskCount={productResearchTasks.length} /></div>
          : !primaryTask
          ? <p className="mt-2 rounded-2xl border border-white/10 p-4 text-sm text-white/55">Seller OS no necesita una acción humana en este momento.</p>
          : <div className="mt-3"><HumanTask task={primaryTask} candidate={primaryCandidate} working={working} onConfirm={(body) => request(body)} /></div>}
        {productResearchTasks.length > 0 && primaryTask && <aside aria-label="Próxima decisión en espera" className="mt-3 rounded-2xl border border-violet-200/20 bg-violet-200/[0.04] p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/60">Próxima decisión protegida</p>
          <p className="mt-1 break-words text-sm font-black text-violet-50">{primaryTask.title}</p>
          {primaryCandidate?.product_title && <p className="mt-1 break-words text-xs text-white/55">{primaryCandidate.product_title}</p>}
          <p className="mt-2 text-xs leading-5 text-white/55">{deferredDecisionCount} decisión(es) pendiente(s). No están ocultas: Seller OS mostrará una sola acción cuando corresponda en el orden del recorrido.</p>
        </aside>}
        {productResearchTasks.length === 0 && queuedDecisionCount > 0 && <p className="mt-3 rounded-2xl border border-white/10 p-3 text-sm text-white/55">{queuedDecisionCount} decisión(es) posterior(es) permanecen ordenadas. Seller OS mostrará sólo la siguiente cuando completes la actual.</p>}
      </section>
      <section aria-labelledby="automatic-continuation-heading" className="mt-5 rounded-2xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/60">3 · Qué continuará</p>
        <h3 id="automatic-continuation-heading" className="mt-1 text-base font-black text-violet-50">{productResearchTasks.length > 0
          ? "La extensión cargará la próxima consulta validada y Seller OS continuará con cada candidato afectado."
          : primaryTask?.impact ?? (readyCandidates.length ? "El paquete queda listo para publicación manual en Seller Hub." : "Seller OS avanzará automáticamente hasta la próxima confirmación indispensable.")}</h3>
        <p className="mt-2 text-xs leading-5 text-white/55">No necesitas pulsar otro botón técnico después de confirmar la tarea principal.</p>
      </section>
      {readyCandidates.length > 0 && <div className="mt-6"><h3 className="text-lg font-black">Listos para Seller Hub</h3><div className="mt-3 grid gap-4">{readyCandidates.map((candidate: Row) => <ManualHandoffCard key={candidate.id} candidate={candidate} />)}</div></div>}
      <details className="mt-5 rounded-2xl border border-white/10 p-4"><summary className="flex min-h-11 cursor-pointer items-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver métricas y progreso automático</summary><div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6"><Metric label="Piloto" value={`${Number(pilot.run.verified_existing_listings) + Number(pilot.run.verified_new_listings)} / 3`} /><Metric label="Cola de hoy" value={`${candidates.length} / 5`} /><Metric label="Preparación local" value={String(candidates.filter((candidate: Row) => candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES").length)} /><Metric label="Listos" value={String(pilot.run.ready_for_manual_publication_count)} /><Metric label="Automatización" value={`${Number(pilot.run.automation_metrics?.automationCoveragePercent ?? 0)}%`} /><Metric label="Escrituras eBay" value="0" /></div><div className="mt-3 grid gap-2">{candidates.map((candidate: Row) => <div key={candidate.id} className="min-w-0 rounded-xl bg-black/20 p-3"><p className="break-words font-bold">{candidate.ordinal}. {candidate.product_title}</p><p className="mt-1 break-words text-xs text-white/55">{businessState(candidate.machine_state)} · SKU {candidate.supplier_sku}</p>{candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES" && <p className="mt-1 text-xs text-cyan-100/75">Paquete local seguro preparado; todavía no es publicable.</p>}<p className="mt-1 break-words text-xs text-amber-100/80">{candidate.next_human_action}</p></div>)}</div></details>
    </>}
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs font-black uppercase text-white/45">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div> }

function ProductResearchQueueTask({ guidance, researchTasks, fallbackQuery, openTaskCount }: { guidance?: Row | null; researchTasks: Row[]; fallbackQuery?: unknown; openTaskCount: number }) {
  const [copyStatus, setCopyStatus] = useState<"IDLE" | "COPIED" | "FAILED">("IDLE")
  const guidedQuery = typeof guidance?.nextQuery?.searchQuery === "string"
    ? guidance.nextQuery.searchQuery.trim().slice(0, 100) : ""
  const durableTaskQuery = typeof fallbackQuery === "string"
    ? fallbackQuery.trim().slice(0, 100) : ""
  const nextQuery = guidedQuery || durableTaskQuery
  const queryKey = (value: unknown) => typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\bdefault\s+title\b/gi, " ").toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
    : ""
  const matchedTask = nextQuery ? researchTasks.find((task) =>
    queryKey(task?.action_schema?.query) === queryKey(nextQuery)) : undefined
  const productFamily = typeof matchedTask?.evidence?.product === "string"
    ? matchedTask.evidence.product.trim().slice(0, 180) : ""
  const queryCount = Number(guidance?.queryCount ?? 0)
  const capturedCount = Number(guidance?.capturedCount ?? 0)
  const pendingCount = Number(guidance?.pendingCount ?? openTaskCount)
  const nextOrdinal = Number(guidance?.nextQuery?.ordinal ?? capturedCount + 1)
  const familyCandidateCount = Number(guidance?.nextQuery?.candidateCount ?? 0)
  const chainedAfterCurrent = Math.max(0, pendingCount - 1)
  const queryFieldId = `product-research-query-${nextOrdinal}`
  const copyExactQuery = async () => {
    if (!nextQuery) return
    try {
      await navigator.clipboard.writeText(nextQuery)
      setCopyStatus("COPIED")
    } catch {
      setCopyStatus("FAILED")
    }
  }
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="font-black">Captura la próxima consulta de Product Research</h4>
        <p className="mt-1 text-sm leading-6 text-white/65">Una sola consulta está disponible para actuar. Las posteriores permanecen ordenadas y la extensión v1.2.5 las encadena.</p>
      </div>
      <span className="rounded-full border border-amber-100/20 px-3 py-1 text-xs font-black text-amber-100">{capturedCount}/{queryCount || capturedCount + pendingCount} capturadas</span>
    </div>
    <div className="mt-3 grid gap-3">
      <section aria-label="Familia o producto de referencia" className="rounded-xl border border-violet-200/25 bg-violet-200/[0.07] p-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/65">Familia / producto de referencia</p>
        <p className="mt-1 break-words text-sm font-black text-violet-50">{productFamily || `Familia de ${familyCandidateCount || 1} candidato(s)`}</p>
      </section>
      <section className="rounded-xl border border-cyan-200/30 bg-cyan-200/[0.07] p-3">
        <label htmlFor={queryFieldId} className="text-[10px] font-black uppercase tracking-widest text-cyan-100/70">Consulta exacta que se enviará · #{nextOrdinal}</label>
        <textarea id={queryFieldId} readOnly rows={2} value={nextQuery || "Actualizando consulta segura…"}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 box-border w-full resize-none rounded-lg border border-cyan-100/20 bg-black/30 p-2 text-sm font-bold leading-5 text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-100" />
      </section>
      <p className="text-xs leading-5 text-white/60">Pendientes: {pendingCount}. Después de ésta, {chainedAfterCurrent} consulta(s) quedarán encadenadas automáticamente.</p>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <a href={nextQuery ? `https://www.ebay.com/sh/research#seller-os-query=${encodeURIComponent(nextQuery)}` : undefined}
        target="_blank" rel="noreferrer" aria-disabled={!nextQuery}
        className={`inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 ${nextQuery ? "bg-amber-200 text-black" : "pointer-events-none border border-red-300/30 text-red-100"}`}>
        ABRIR PRODUCT RESEARCH
      </a>
      <button type="button" disabled={!nextQuery} onClick={() => void copyExactQuery()}
        className="min-h-12 w-full rounded-xl border border-cyan-200/40 px-4 text-center font-black text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-45">
        COPIAR CONSULTA EXACTA
      </button>
    </div>
    <p role="status" aria-live="polite" className={`mt-2 text-xs font-bold ${copyStatus === "FAILED" ? "text-red-200" : "text-cyan-100/80"}`}>{copyStatus === "COPIED"
      ? "Consulta exacta copiada completa."
      : copyStatus === "FAILED"
        ? "No se pudo copiar automáticamente. Toca el campo cian para seleccionarlo."
        : "Abrir transfiere la consulta a la extensión. Copiar queda como respaldo visible."}</p>
    <p className="mt-2 text-xs leading-5 text-cyan-100/75">Captura únicamente cuando habilite “Capturar y continuar”. Nunca utilices una búsqueda pública como sustituto de Product Research.</p>
  </article>
}

function HumanTask({ task, candidate, working, onConfirm }: { task: Row; candidate?: Row; working: boolean; onConfirm: (body: Row) => Promise<void> }) {
  const [price, setPrice] = useState("")
  const [salePrice, setSalePrice] = useState("")
  const [fulfillmentBasis, setFulfillmentBasis] = useState("")
  const [availability, setAvailability] = useState("unknown")
  const [quantity, setQuantity] = useState("")
  const anchorImage = candidateHeroImage(candidate)
  const parsedQuantity = quantity === "" ? null : Number(quantity)
  const lunaQuantityConflict = parsedQuantity !== null && (
    !Number.isInteger(parsedQuantity) || parsedQuantity < 0 ||
    (availability === "available" && parsedQuantity === 0) ||
    (availability === "out" && parsedQuantity > 0)
  )
  const priceMissing = !(Number(price) > 0)
  const availabilityMissing = availability === "unknown"
  const salePriceMissing = !(Number(salePrice) > 0)
  const fieldId = String(task.id ?? "task")

  return <article className="min-w-0 overflow-hidden rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {anchorImage
          ? <img src={anchorImage} alt={`Producto Luna: ${String(candidate?.product_title ?? "producto")}`} className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain p-1" />
          : <div role="img" aria-label="Imagen Luna no disponible" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-red-300/30 bg-red-400/10 p-2 text-center text-[10px] font-black text-red-100">IMAGEN LUNA NO DISPONIBLE</div>}
        <div className="min-w-0">
          <h4 className="break-words font-black">{task.title}</h4>
          <p className="mt-1 break-words text-sm text-white/65">{candidate?.product_title}</p>
          <p className="mt-1 break-words text-xs text-white/50">SKU {String(candidate?.supplier_sku ?? "N/D")} · misma referencia visual durante todo el recorrido</p>
        </div>
      </div>
      <span className="text-xs font-black text-amber-100">≈ {Math.ceil(Number(task.estimated_seconds) / 60)} min</span>
    </div>
    <p className="mt-3 text-sm leading-6 text-white/60">{task.why_needed}</p>
    <p className="mt-2 text-xs leading-5 text-emerald-100/75">Después: {task.impact}</p>

    {task.gate_type === "LUNA_CONFIRMATION_REQUIRED" && <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <a href={lunaProductUrl(candidate) ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!lunaProductUrl(candidate)} className={`inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-100 sm:w-auto ${lunaProductUrl(candidate) ? "bg-violet-200 text-black" : "pointer-events-none border border-red-300/30 text-red-100"}`}>{lunaProductUrl(candidate) ? "ABRIR PRODUCTO EXACTO EN LUNA" : "ENLACE EXACTO DE LUNA NO DISPONIBLE"}</a>
        <p className="text-xs leading-5 text-white/60">Confirma costo, disponibilidad y cantidad únicamente si Luna la muestra.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold">Costo actual en Luna <span className="text-red-200">*</span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" aria-required="true" aria-invalid={priceMissing} aria-describedby={`${fieldId}-price-help`} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${priceMissing ? "border-red-400" : "border-white/15"}`} />
          <span id={`${fieldId}-price-help`} className={`mt-1 block font-normal ${priceMissing ? "text-red-200" : "text-white/55"}`}>{priceMissing ? "Obligatorio: confirma el costo actual mostrado por Luna." : "Costo recibido; se recalculará la economía."}</span>
        </label>
        <label className="text-xs font-bold">Disponibilidad <span className="text-red-200">*</span>
          <select value={availability} onChange={(event) => setAvailability(event.target.value)} aria-required="true" aria-invalid={availabilityMissing} aria-describedby={`${fieldId}-availability-help`} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${availabilityMissing ? "border-red-400" : "border-white/15"}`}><option value="unknown">Seleccionar</option><option value="available">Disponible</option><option value="out">Agotado</option></select>
          <span id={`${fieldId}-availability-help`} className={`mt-1 block font-normal ${availabilityMissing ? "text-red-200" : "text-white/55"}`}>{availabilityMissing ? "Obligatorio: confirma si Luna muestra el producto disponible." : "Disponibilidad confirmada."}</span>
        </label>
        <label className="text-xs font-bold">Cantidad visible (opcional)
          <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" aria-invalid={lunaQuantityConflict} aria-describedby={`${fieldId}-quantity-help`} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${lunaQuantityConflict ? "border-red-400" : "border-white/15"}`} />
          <span id={`${fieldId}-quantity-help`} className={`mt-1 block font-normal ${lunaQuantityConflict ? "text-red-200" : "text-white/55"}`}>{lunaQuantityConflict ? "La disponibilidad y la cantidad se contradicen; corrige uno de los dos campos." : "Si Luna no comparte cantidad, déjalo vacío: eBay se preparará con cantidad 1 y revalidación después de la venta."}</span>
        </label>
        <button type="button" disabled={working || priceMissing || availabilityMissing || lunaQuantityConflict} onClick={() => void onConfirm({ action: "confirm_luna", taskId: task.id, price: Number(price), availability: { available: availability === "available", quantity: parsedQuantity } })} className="min-h-12 self-end rounded-xl bg-amber-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 disabled:opacity-40">CONFIRMAR Y CONTINUAR</button>
      </div>
    </div>}

    {task.gate_type === "PRODUCT_APPROVAL_REQUIRED" && <div className="mt-4 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">
      <p>La identidad y la ficha técnica pasaron. Tú defines el precio final; Seller OS comprobará utilidad, ROI y margen sin convertir precios de competidores en una recomendación automática.</p>
      <LunaConfirmationSummary candidate={candidate} />
      <MarketPriceReference candidate={candidate} />
      <p className="mt-3 rounded-xl border border-amber-200/25 bg-amber-200/[0.06] p-3 text-xs text-amber-50"><strong>Fulfillment obligatorio:</strong> confirma la base real antes de aprobar. No selecciones un acuerdo mayorista si sólo planeas comprar el producto después de la venta en un retailer o marketplace.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold">Precio de venta que apruebas <span className="text-red-200">*</span>
          <input value={salePrice} onChange={(event) => setSalePrice(event.target.value)} inputMode="decimal" aria-required="true" aria-invalid={salePriceMissing} aria-describedby={`${fieldId}-sale-price-help`} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${salePriceMissing ? "border-red-400" : "border-white/15"}`} />
          <span id={`${fieldId}-sale-price-help`} className={`mt-1 block font-normal ${salePriceMissing ? "text-red-200" : "text-white/55"}`}>{salePriceMissing ? "Obligatorio: define el precio que deseas evaluar." : "Seller OS comprobará utilidad, ROI y margen antes de avanzar."}</span>
        </label>
        <label className="text-xs font-bold">Base de fulfillment <span className="text-red-200">*</span>
          <select value={fulfillmentBasis} onChange={(event) => setFulfillmentBasis(event.target.value)} aria-required="true" aria-invalid={!fulfillmentBasis} aria-describedby={`${fieldId}-fulfillment-help`} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${fulfillmentBasis ? "border-white/15" : "border-red-400"}`}><option value="">Seleccionar</option><option value="OWNED_INVENTORY">Inventario propio disponible</option><option value="AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT">Acuerdo vigente con proveedor mayorista autorizado</option></select>
          <span id={`${fieldId}-fulfillment-help`} className={`mt-1 block font-normal ${fulfillmentBasis ? "text-white/55" : "text-red-200"}`}>{fulfillmentBasis ? "Base de fulfillment confirmada." : "Obligatorio: confirma la fuente real de fulfillment."}</span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={working || salePriceMissing || !fulfillmentBasis} onClick={() => void onConfirm({ action: "product_decision", taskId: task.id, decision: "APPROVE", salePrice: Number(salePrice), fulfillmentBasis })} className="min-h-12 w-full rounded-xl bg-cyan-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-40 sm:w-auto">APROBAR PRODUCTO</button>
        <button type="button" disabled={working} onClick={() => void onConfirm({ action: "product_decision", taskId: task.id, decision: "REJECT" })} className="min-h-12 w-full rounded-xl border border-red-300/35 px-4 font-black text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200 disabled:opacity-40 sm:w-auto">RECHAZAR</button>
      </div>
      {candidate?.economics_summary?.minimumOperatorPrice && <p className="mt-2 text-xs text-white/60">Piso interno estimado con costo y reservas propias: ${Number(candidate.economics_summary.minimumOperatorPrice).toFixed(2)}. Debe validarse con el precio que tú apruebes.</p>}
    </div>}

    {task.gate_type === "IMAGE_APPROVAL_REQUIRED" && <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{authorizedImages(candidate).map((url) => <img key={url} src={url} alt="Imagen autorizada de Luna para revisar" className="aspect-square w-full rounded-xl bg-white object-contain" />)}</div>
      <p className={`mt-3 rounded-xl border p-3 text-sm ${authorizedImages(candidate).length ? "border-emerald-200/20 bg-emerald-200/[0.05] text-emerald-50" : "border-red-300/30 bg-red-400/10 text-red-100"}`}>{authorizedImages(candidate).length ? `${authorizedImages(candidate).length} imagen(es) autorizada(s) de Luna. Confirma que muestran el producto y pack exactos.` : "Faltan imágenes autorizadas; no apruebes este producto."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={working || authorizedImages(candidate).length === 0} onClick={() => void onConfirm({ action: "image_decision", taskId: task.id, decision: "APPROVE" })} className="min-h-12 w-full rounded-xl bg-emerald-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100 disabled:opacity-40 sm:w-auto">APROBAR IMÁGENES</button>
        <button type="button" disabled={working} onClick={() => void onConfirm({ action: "image_decision", taskId: task.id, decision: "REJECT" })} className="min-h-12 w-full rounded-xl border border-red-300/35 px-4 font-black text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200 disabled:opacity-40 sm:w-auto">RECHAZAR</button>
      </div>
    </div>}
  </article>
}

function authorizedImages(candidate?: Row) {
  const urls = candidate?.manual_handoff_package?.package?.images?.urls
  return Array.isArray(urls) ? urls.filter((url) => typeof url === "string" && url.startsWith("https://")) : []
}

function candidateHeroImage(candidate?: Row) {
  return safeHttpsUrl(candidate?.local_preparation_package?.product?.supplierImageUrl)
    ?? safeHttpsUrl(candidate?.manual_handoff_package?.package?.images?.urls?.[0])
}

function lunaProductUrl(candidate?: Row) {
  const value = safeHttpsUrl(candidate?.local_preparation_package?.product?.supplierProductUrl)
  if (!value) return null
  const url = new URL(value)
  return url.hostname === "lunaportex.com" || url.hostname.endsWith(".lunaportex.com") ? url.href : null
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function MarketPriceReference({ candidate }: { candidate?: Row }) {
  const reference = candidate?.evidence_summary?.exactSoldMarketReference
  if (!reference || reference.evidenceTier !== "CONFIRMED_SOLD_EXACT") {
    return <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.05] p-3 text-xs text-amber-50">No existe todavía una referencia de precio vendido exacta y válida. No se mostrará una búsqueda amplia como sustituto.</p>
  }
  const leader = reference.highestSoldExactListing ?? {}
  const range = reference.soldPriceRange ?? {}
  return <div className="mt-3 grid gap-2 sm:grid-cols-4"><Metric label="Líder exacto vendido" value={leader.soldPrice != null ? `$${Number(leader.soldPrice).toFixed(2)}` : "N/D"} /><Metric label="Cantidad confirmada" value={String(leader.confirmedSoldQuantity ?? "N/D")} /><Metric label="Promedio exacto" value={reference.weightedAverageSoldPrice != null ? `$${Number(reference.weightedAverageSoldPrice).toFixed(2)}` : "N/D"} /><Metric label="Rango exacto" value={range.minimum != null && range.maximum != null ? `$${Number(range.minimum).toFixed(2)}–$${Number(range.maximum).toFixed(2)}` : "N/D"} /><p className="sm:col-span-4 text-xs text-white/55">Muestra: {reference.exactListingSampleSize} listing(s) exacto(s) · confianza {String(reference.confidence ?? "N/D").toLowerCase()} · referencia descriptiva de Product Research, no precio automático.</p></div>
}

function LunaConfirmationSummary({ candidate }: { candidate?: Row }) {
  const confirmation = candidate?.economics_summary?.lunaConfirmation ?? {}
  const status = String(confirmation.status ?? "")
  if (!status.startsWith("AVAILABLE_")) return <p className="mt-3 rounded-xl border border-red-300/30 bg-red-400/10 p-3 text-xs text-red-100">Falta confirmación humana reciente de Luna.</p>
  const quantity = confirmation.quantityVisible === true ? String(confirmation.confirmedQuantity ?? "N/D") : "no visible; eBay 1"
  return <p className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-xs text-emerald-50"><strong>Luna confirmada por el operador:</strong> {quantity} · {confirmation.confirmedAt ? new Date(String(confirmation.confirmedAt)).toLocaleString("es-NI") : "hora no disponible"}. eBay no se presenta como fuente del stock del proveedor.</p>
}

function ManualHandoffCard({ candidate }: { candidate: Row }) {
  const handoff = candidate.manual_handoff_package?.package ?? {}
  const specifics = handoff.itemSpecifics && typeof handoff.itemSpecifics === "object" ? Object.entries(handoff.itemSpecifics) : []
  const imageUrls = Array.isArray(handoff.images?.urls) ? handoff.images.urls.filter((url: unknown) => typeof url === "string") : []
  const businessPolicies = handoff.businessPolicies ?? {}
  const fulfillmentCompliance = handoff.fulfillmentCompliance ?? {}
  const shipping = handoff.shipping ?? {}
  const shippingValues = shipping.values && typeof shipping.values === "object" ? Object.entries(shipping.values) : []
  const specificsText = specifics.map(([name, values]) => `${name}: ${Array.isArray(values) ? values.join(", ") : String(values)}`).join("\n")
  const shippingText = shippingValues.length
    ? shippingValues.map(([name, entry]) => {
      const value = entry && typeof entry === "object" ? entry as Row : {}
      return `${shippingFieldLabel(name)}: ${String(value.value ?? "")} ${String(value.unit ?? "")}`.trim()
    }).join("\n")
    : String(shipping.operatorAction ?? "Confirmar envío en Seller Hub.")
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase text-emerald-100/65">Paquete verificado</p><h4 className="mt-1 break-words font-black">{candidate.product_title}</h4><p className="mt-1 break-words text-xs text-white/55">SKU {candidate.supplier_sku} · {imageUrls.length} imagen(es) autorizada(s)</p></div><a href="https://www.ebay.com/sh/ovw" target="_blank" rel="noreferrer" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-200 px-4 text-center font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100 sm:w-auto">ABRIR SELLER HUB Y PUBLICAR</a></div>
    <div aria-label="Ruta de publicación" className="mt-4 grid grid-cols-2 gap-2 text-xs font-black sm:grid-cols-4"><span className="rounded-xl border border-white/10 p-2">1 · Datos esenciales</span><span className="rounded-xl border border-white/10 p-2">2 · Ficha técnica</span><span className="rounded-xl border border-white/10 p-2">3 · Envío e imágenes</span><span className="rounded-xl border border-white/10 p-2">4 · Revisar y publicar</span></div>
    {handoff.publicationReadiness === "READY_FOR_MANUAL_SHIPPING_CONFIRMATION" && <p className="mt-3 rounded-xl border border-amber-200/25 bg-amber-200/[0.06] p-3 text-sm text-amber-50"><strong>Confirmación puntual pendiente:</strong> el paquete no copia medidas estimadas. Confirma peso/dimensiones en Seller Hub o usa una política de envío verificada compatible.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><CopyField label="Título" value={String(handoff.title ?? "")} /><CopyField label="Descripción" value={String(handoff.description ?? "")} multiline /></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><CopyField label="Precio" value={handoff.price ? Number(handoff.price).toFixed(2) : ""} /><CopyField label="Cantidad" value={handoff.quantity == null ? "" : String(handoff.quantity)} /><CopyField label="Custom Label / SKU" value={String(handoff.customLabel ?? "")} /><CopyField label="Categoría eBay" value={String(handoff.categoryId ?? "")} /><CopyField label="Condición eBay" value={String(handoff.conditionId ?? "")} /><CopyField label="Base de fulfillment" value={fulfillmentBasisLabel(String(fulfillmentCompliance.basis ?? ""))} /><CopyField label="Item specifics" value={specificsText} multiline /></div>
    <details className="mt-4 rounded-xl border border-white/10 p-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">3 · Envío, políticas e imágenes</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><CopyField label="Envío" value={shippingText} multiline /><div className="grid gap-3"><CopyField label="Política de fulfillment" value={String(businessPolicies.fulfillmentPolicyId ?? "")} /><CopyField label="Política de pago" value={String(businessPolicies.paymentPolicyId ?? "")} /><CopyField label="Política de devolución" value={String(businessPolicies.returnPolicyId ?? "")} /></div></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{imageUrls.map((url: string, index: number) => <figure key={url} className="min-w-0 rounded-xl border border-white/10 bg-white p-2"><img src={url} alt={`Imagen autorizada ${index + 1} de Luna`} className="aspect-square w-full object-contain" /><figcaption className="mt-1 text-center text-xs font-black text-black">Orden {index + 1}</figcaption></figure>)}</div><div className="mt-3"><CopyField label="URLs autorizadas en orden" value={imageUrls.join("\n")} multiline /></div></details>
    <details className="mt-3 rounded-xl border border-white/10 p-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">4 · Checklist final</summary><ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-white/60">{Array.isArray(handoff.operatorChecklist) && handoff.operatorChecklist.map((item: unknown) => <li key={String(item)}>{String(item)}</li>)}</ol></details>
  </article>
}

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_500) }
  const missing = !value.trim()
  return <div className="min-w-0"><div className="flex items-center justify-between gap-2"><label className={`break-words text-xs font-black uppercase ${missing ? "text-red-200" : "text-white/50"}`}>{label}</label><button type="button" disabled={missing} onClick={() => void copy()} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-black text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:text-white/25">{copied ? "COPIADO" : "COPIAR"}</button></div>{multiline ? <textarea readOnly value={value || "Falta completar"} rows={6} aria-invalid={missing} className={`mt-1 w-full rounded-xl border bg-black/30 p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${missing ? "border-red-400" : "border-white/10"}`} /> : <input readOnly value={value || "Falta completar"} aria-invalid={missing} className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${missing ? "border-red-400" : "border-white/10"}`} />}{missing && <p className="mt-1 text-xs font-bold text-red-200">Obligatorio para publicar: falta completar este campo.</p>}</div>
}

function shippingFieldLabel(field: string) {
  return ({ shippingWeight: "Peso", shippingLength: "Largo", shippingWidth: "Ancho", shippingHeight: "Alto" } as Record<string, string>)[field] ?? field
}

function fulfillmentBasisLabel(value: string) {
  if (value === "OWNED_INVENTORY") return "Inventario propio disponible"
  if (value === "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT") return "Acuerdo vigente con proveedor mayorista autorizado"
  return ""
}

function businessState(state: string) {
  if (state === "WAITING_PRODUCT_RESEARCH_CAPTURE" || state === "WAITING_LUNA_CONFIRMATION" || state.startsWith("WAITING_")) return "Esperando tu confirmación"
  if (state === "READY_FOR_MANUAL_PUBLICATION") return "Listo para publicar"
  if (state === "VERIFIED_ACTIVE") return "Publicado y verificado"
  if (state === "BLOCKED" || state === "REJECTED") return "Bloqueado"
  return "Sistema trabajando"
}
