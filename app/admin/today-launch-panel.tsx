"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  evaluateEbayQuotaLaneState,
  evaluateEbayQuotaRetryState,
} from "@/lib/ebay/ebay-quota-lane-domain"
import {
  deriveSameDayLiveMonitor,
  type SameDayLiveMonitor,
} from "@/lib/ebay/ebay-same-day-live-monitor"

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
  const [lastObservedAt, setLastObservedAt] = useState<string | null>(null)
  const load = useCallback(async () => {
    const accessToken = await token()
    if (!accessToken) return
    const response = await fetch("/api/admin/ebay/same-day-pilot", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || "No se pudo consultar el lanzamiento.")
    setPilot(body.pilot)
    setLastObservedAt(new Date().toISOString())
  }, [])
  useEffect(() => { load().catch((caught) => setError(caught instanceof Error ? caught.message : "No disponible")).finally(() => setLoading(false)) }, [load])
  useEffect(() => {
    if (!pilot || ["COMPLETED", "BLOCKED"].includes(String(pilot.run?.status))) return
    const timer = window.setInterval(() => {
      load().catch(() => undefined)
    }, 10_000)
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
  const primaryReviewAssets = primaryCandidate &&
    Array.isArray(pilot?.imageReviewAssets?.[String(primaryCandidate.id)])
    ? pilot.imageReviewAssets[String(primaryCandidate.id)]
    : []
  const readyCandidates = candidates.filter((candidate: Row) => candidate.machine_state === "READY_FOR_MANUAL_PUBLICATION")
  const runStatus = String(pilot?.run?.status ?? "")
  const nextCycleAllowed = pilot?.nextCandidateCycle?.allowed === true
  const currentCycle = Math.max(1, Number(pilot?.run?.cycle ?? 1) || 1)
  const nextCycle = Math.max(currentCycle + 1,
    Number(pilot?.nextCandidateCycle?.nextCycle ?? currentCycle + 1) || currentCycle + 1)
  const canRecoverEmptyRun = runStatus === "BLOCKED" && candidates.length === 0
    && pilot?.nextCandidateCycle?.reason !== "NEXT_CANDIDATE_SET_EXHAUSTED"
  const resumePreparedCycle = canRecoverEmptyRun
    && pilot?.run?.source_inventory?.productResearchPlanPrepared === true
  const showLaunchAction = !loading && (!pilot || canRecoverEmptyRun || nextCycleAllowed)
  const pilotProgress = Math.max(0, Math.min(3,
    Number(pilot?.cycleHistory?.verifiedPilotProgress
      ?? (Number(pilot?.run?.verified_existing_listings) + Number(pilot?.run?.verified_new_listings))) || 0))
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
  const liveMonitor = deriveSameDayLiveMonitor({
    run: pilot?.run,
    candidates,
    tasks: pilot?.tasks,
    jobs: pilot?.jobs,
    quotaPaused,
  })
  const currentBusinessState = nextCycleAllowed
    ? "ESPERANDO TU CONFIRMACIÓN"
    : liveMonitor.businessLabel
  const imageAiReady = pilot?.imageFactoryConfiguration?.aiGeneration === "READY"
  return <section className="mt-5 min-w-0 overflow-hidden rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] to-emerald-200/[0.04] p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/60">Lanzamiento de hoy</p>
        <h2 className="mt-2 break-words text-2xl font-black">Objetivo: completar el piloto 3/3</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Un clic inicia el trabajo automático. Tú supervisas y Seller OS se detiene sólo cuando necesita una confirmación indispensable.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pilot && <span className="rounded-full border border-cyan-200/20 px-3 py-2 text-xs font-black text-cyan-100">Ciclo de revisión {currentCycle}</span>}
        {pilot && <span className={`rounded-full border px-3 py-2 text-xs font-black ${imageAiReady ? "border-emerald-200/25 bg-emerald-200/[0.06] text-emerald-100" : "border-amber-200/25 bg-amber-200/[0.06] text-amber-100"}`}>{imageAiReady ? "IMÁGENES IA LISTAS" : "IMÁGENES: RESPALDO LOCAL"}</span>}
        <span aria-live="polite" className="rounded-full border border-white/15 px-3 py-2 text-xs font-black">{loading ? "CARGANDO" : currentBusinessState}</span>
      </div>
    </div>
    {showLaunchAction && <div className="mt-5">
      <button type="button" disabled={working} aria-describedby={pilot ? "next-cycle-helper" : undefined} onClick={() => void request({ action: "start" })} className="min-h-14 w-full rounded-2xl bg-cyan-200 px-5 text-base font-black text-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-50 sm:w-auto">{working ? (resumePreparedCycle ? "REANUDANDO CICLO…" : pilot ? "PREPARANDO SIGUIENTES 5…" : "INICIANDO…") : resumePreparedCycle ? "REANUDAR 5 CANDIDATOS PREPARADOS" : pilot ? "ANALIZAR SIGUIENTES 5 CANDIDATOS" : "INICIAR LANZAMIENTO DE HOY"}</button>
      {pilot && <p id="next-cycle-helper" className="mt-2 max-w-2xl text-xs leading-5 text-white/60">{resumePreparedCycle ? `Reutiliza el plan ya preparado del ciclo ${currentCycle}; no duplica consultas ni requiere repetir capturas.` : `Conserva todo lo revisado, excluye los candidatos ya intentados y crea el ciclo ${nextCycle} con un máximo de 5. No reinicia Discovery ni consulta eBay para las 1,513 variantes.`}</p>}
    </div>}
    {pilot?.nextCandidateCycle?.reason === "NEXT_CANDIDATE_SET_EXHAUSTED" && <p className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-50">No quedan candidatos distintos elegibles en la cola local actual. Seller OS preservó toda la evidencia y no forzará una publicación.</p>}
    {error && <p role="alert" className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 p-3 text-sm font-bold text-red-100">{error}</p>}
    {pilot && <>
      <LivePilotMonitor monitor={liveMonitor} pilotProgress={pilotProgress}
        lastObservedAt={lastObservedAt} nextCycleAllowed={nextCycleAllowed} />
      {quotaPaused && <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-50">eBay pausó únicamente la verificación exacta. La selección, Luna y los paquetes locales permanecen disponibles; Seller OS retomará el mismo producto automáticamente{quotaResumeAt ? ` después de ${new Date(quotaResumeAt).toLocaleString("es-NI")}` : " cuando eBay libere la cuota"}.</p>}
      <section aria-labelledby="operator-task-heading" className="mt-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-100/60">2 · Tu decisión</p>
        <h3 id="operator-task-heading" className="mt-1 text-lg font-black">Tarea para Ernesto</h3>
        {productResearchTasks.length > 0
          ? <div className="mt-3"><ProductResearchQueueTask guidance={pilot.productResearchGuidance} researchTasks={productResearchTasks} fallbackQuery={productResearchTasks[0]?.action_schema?.query} openTaskCount={productResearchTasks.length} /></div>
          : !primaryTask
          ? <p className="mt-2 rounded-2xl border border-white/10 p-4 text-sm text-white/55">Seller OS no necesita una acción humana en este momento.</p>
          : <div className="mt-3"><HumanTask task={primaryTask} candidate={primaryCandidate}
            reviewAssets={primaryReviewAssets} working={working}
            onConfirm={(body) => request(body)} /></div>}
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
      <details className="mt-5 rounded-2xl border border-white/10 p-4"><summary className="flex min-h-11 cursor-pointer items-center font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver métricas y progreso automático</summary><div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-7"><Metric label="Piloto" value={`${pilotProgress} / 3`} /><Metric label="Ciclo" value={String(currentCycle)} /><Metric label="Cola de este ciclo" value={`${candidates.length} / 5`} /><Metric label="Intentados acumulados" value={String(pilot.cycleHistory?.attemptedCandidates ?? candidates.length)} /><Metric label="Preparación local" value={String(candidates.filter((candidate: Row) => candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES").length)} /><Metric label="Listos" value={String(pilot.run.ready_for_manual_publication_count)} /><Metric label="Escrituras eBay" value="0" /></div><div className="mt-3 grid gap-2">{candidates.map((candidate: Row) => <div key={candidate.id} className="min-w-0 rounded-xl bg-black/20 p-3"><p className="break-words font-bold">{candidate.ordinal}. {candidate.product_title}</p><p className="mt-1 break-words text-xs text-white/55">{businessState(candidate.machine_state)} · SKU {candidate.supplier_sku}</p>{candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES" && <p className="mt-1 text-xs text-cyan-100/75">Paquete local seguro preparado; todavía no es publicable.</p>}<p className="mt-1 break-words text-xs text-amber-100/80">{candidate.next_human_action}</p></div>)}</div></details>
    </>}
  </section>
}

function LivePilotMonitor({ monitor, pilotProgress, lastObservedAt, nextCycleAllowed }: {
  monitor: SameDayLiveMonitor
  pilotProgress: number
  lastObservedAt: string | null
  nextCycleAllowed: boolean
}) {
  const palette = liveMonitorPalette(monitor.status)
  const settled = monitor.batch.completed + monitor.batch.blocked
  const progressValue = monitor.batch.total
    ? Math.max(settled, monitor.batch.currentOrdinal ?? 0)
    : 0
  const observedLabel = lastObservedAt
    ? new Date(lastObservedAt).toLocaleTimeString("es-NI", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
    : "pendiente"
  return <section aria-labelledby="system-working-heading"
    className="relative isolate mt-5 overflow-hidden rounded-3xl border border-cyan-200/20 bg-[#07141a] p-4 shadow-[0_24px_90px_rgba(34,211,238,0.08)] sm:p-5">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:linear-gradient(rgba(34,211,238,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.055)_1px,transparent_1px)] [background-size:28px_28px]" />
    <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 -z-10 h-64 w-64 rounded-full bg-cyan-300/10 blur-3xl" />
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div aria-hidden="true" className={`relative mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${palette.beacon}`}>
          {monitor.shouldAnimate && <span className="absolute inset-1 rounded-xl bg-cyan-200/25 motion-safe:animate-ping" />}
          <span className={`relative h-3 w-3 rounded-full ${palette.dot} ${monitor.shouldAnimate ? "motion-safe:animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/60">1 · Sistema trabajando</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 id="system-working-heading" className="break-words text-lg font-black text-white">{nextCycleAllowed ? "El ciclo terminó; puedes autorizar el siguiente lote" : monitor.headline}</h3>
            <span aria-live="polite" className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${nextCycleAllowed ? "border-amber-200/35 bg-amber-200/10 text-amber-100" : palette.badge}`}>{nextCycleAllowed ? "ESPERANDO TU CONFIRMACIÓN" : monitor.businessLabel}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">{nextCycleAllowed
            ? "No se iniciará otro grupo sin tu autorización. El lote terminado y toda su evidencia permanecen guardados."
            : monitor.detail}</p>
          <p className="mt-1 text-xs font-bold text-cyan-100/65">{nextCycleAllowed
            ? "Próxima acción: autorizar un lote acotado de hasta cinco candidatos distintos."
            : monitor.activityEvidence}</p>
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <LiveMetric label="Piloto" value={`${pilotProgress} / 3`} />
        <LiveMetric label="Lote" value={`${monitor.batch.total} / 5`} />
        <LiveMetric label="En curso" value={String(monitor.batch.active)} />
        <LiveMetric label="Descartados" value={String(monitor.batch.blocked)} tone={monitor.batch.blocked ? "WARN" : "DEFAULT"} />
      </div>
    </div>

    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-black text-white/70">Recorrido del candidato</span>
        <span className="text-white/45">Actualización {observedLabel}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar"
        aria-label="Progreso del lote actual" aria-valuemin={0} aria-valuemax={monitor.batch.total || 1}
        aria-valuenow={Math.min(progressValue, monitor.batch.total || 1)}>
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-violet-300 to-emerald-300 transition-[width] motion-reduce:transition-none"
          style={{ width: monitor.batch.total ? `${Math.min(100, (progressValue / monitor.batch.total) * 100)}%` : "0%" }} />
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {monitor.timeline.map((step, index) => <li key={step.id} aria-current={step.status === "CURRENT" ? "step" : undefined}
          className={`min-w-0 rounded-xl border p-2.5 ${step.status === "DONE"
            ? "border-emerald-200/25 bg-emerald-200/[0.07] text-emerald-50"
            : step.status === "CURRENT"
              ? "border-cyan-200/40 bg-cyan-200/[0.12] text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.10)]"
              : "border-white/[0.08] bg-white/[0.025] text-white/30"}`}>
          <p className="text-[9px] font-black uppercase tracking-wider">{step.status === "DONE" ? "Completado" : step.status === "CURRENT" ? "Ahora" : "Después"}</p>
          <p className="mt-1 break-words text-xs font-black">{index + 1}. {step.label}</p>
        </li>)}
      </ol>
      <p className="mt-2 text-[11px] leading-5 text-white/45">La etapa actual está resaltada. Las etapas futuras permanecen en gris y no habilitan acciones antes de tiempo.</p>
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="rounded-2xl border border-violet-200/20 bg-violet-200/[0.05] p-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/60">Próxima acción del sistema</p>
        <p className="mt-1 break-words text-sm font-bold leading-5 text-violet-50">{monitor.nextAutomaticAction}</p>
      </div>
      <div className={`rounded-2xl border p-3 ${monitor.nextHumanAction === "Ninguna."
        ? "border-white/10 bg-white/[0.025]"
        : "border-amber-200/25 bg-amber-200/[0.06]"}`}>
        <p className={`text-[10px] font-black uppercase tracking-widest ${monitor.nextHumanAction === "Ninguna." ? "text-white/40" : "text-amber-100/60"}`}>Próxima acción tuya</p>
        <p className={`mt-1 break-words text-sm font-bold leading-5 ${monitor.nextHumanAction === "Ninguna." ? "text-white/45" : "text-amber-50"}`}>{monitor.nextHumanAction}</p>
      </div>
    </div>
    {monitor.blockerSummary && <p role="status" className="mt-3 rounded-2xl border border-red-300/25 bg-red-400/[0.08] p-3 text-sm leading-6 text-red-100"><strong>{monitor.status === "BLOCKED" ? "Por qué se bloqueó este lote:" : "Descarte anterior del lote:"}</strong> {monitor.blockerSummary}</p>}
  </section>
}

function LiveMetric({ label, value, tone = "DEFAULT" }: { label: string; value: string; tone?: "DEFAULT" | "WARN" }) {
  return <div className={`min-w-[6.5rem] rounded-xl border px-3 py-2 ${tone === "WARN" ? "border-amber-200/25 bg-amber-200/[0.06]" : "border-white/10 bg-black/20"}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest ${tone === "WARN" ? "text-amber-100/60" : "text-white/40"}`}>{label}</p>
    <p className="mt-1 text-base font-black text-white">{value}</p>
  </div>
}

function liveMonitorPalette(status: SameDayLiveMonitor["status"]) {
  if (status === "WORKING") return {
    beacon: "border-cyan-200/40 bg-cyan-200/10",
    dot: "bg-cyan-200 shadow-[0_0_18px_rgba(165,243,252,0.9)]",
    badge: "border-cyan-200/35 bg-cyan-200/10 text-cyan-100",
  }
  if (status === "WAITING_OPERATOR" || status === "PAUSED_EBAY") return {
    beacon: "border-amber-200/35 bg-amber-200/10",
    dot: "bg-amber-200 shadow-[0_0_14px_rgba(253,230,138,0.65)]",
    badge: "border-amber-200/35 bg-amber-200/10 text-amber-100",
  }
  if (status === "READY_TO_PUBLISH" || status === "COMPLETED") return {
    beacon: "border-emerald-200/35 bg-emerald-200/10",
    dot: "bg-emerald-200 shadow-[0_0_14px_rgba(167,243,208,0.65)]",
    badge: "border-emerald-200/35 bg-emerald-200/10 text-emerald-100",
  }
  if (status === "BLOCKED") return {
    beacon: "border-red-200/35 bg-red-200/10",
    dot: "bg-red-200 shadow-[0_0_14px_rgba(254,202,202,0.65)]",
    badge: "border-red-200/35 bg-red-200/10 text-red-100",
  }
  return {
    beacon: "border-white/15 bg-white/[0.04]",
    dot: "bg-white/45",
    badge: "border-white/15 bg-white/[0.04] text-white/60",
  }
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
        <p className="mt-1 text-sm leading-6 text-white/65">Una sola consulta está disponible para actuar. Las posteriores permanecen ordenadas y la extensión v1.2.6 las encadena en la misma sesión.</p>
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

function HumanTask({ task, candidate, reviewAssets, working, onConfirm }: {
  task: Row
  candidate?: Row
  reviewAssets: Row[]
  working: boolean
  onConfirm: (body: Row) => Promise<void>
}) {
  const [price, setPrice] = useState("")
  const [salePrice, setSalePrice] = useState("")
  const [fulfillmentBasis, setFulfillmentBasis] = useState("")
  const [availability, setAvailability] = useState("unknown")
  const [quantity, setQuantity] = useState("")
  const [identityAndPackConfirmed, setIdentityAndPackConfirmed] = useState(false)
  const [nativePackCount, setNativePackCount] = useState("")
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false)
  const [openAiImageSpendApproved, setOpenAiImageSpendApproved] = useState(false)
  const anchorImage = candidateHeroImage(candidate)
  const parsedQuantity = quantity === "" ? null : Number(quantity)
  const parsedNativePackCount = nativePackCount === "" ? null : Number(nativePackCount)
  const lunaQuantityConflict = parsedQuantity !== null && (
    !Number.isInteger(parsedQuantity) || parsedQuantity < 0 ||
    (availability === "available" && parsedQuantity === 0) ||
    (availability === "out" && parsedQuantity > 0)
  )
  const priceMissing = !(Number(price) > 0)
  const availabilityMissing = availability === "unknown"
  const salePriceMissing = !(Number(salePrice) > 0)
  const fieldId = String(task.id ?? "task")
  const imageSet = normalizedImageReviewSet(reviewAssets)
  const imageSetReady = completeImageReviewSet(imageSet)
  const openAiContextUsed = imageSet.some((asset) => asset.generativeAiUsed === true)
  const controlledExploratoryTest = candidate?.evidence_summary?.commercialEvidenceMode ===
    "CONTROLLED_EXPLORATORY_TEST"
  const selectionIdentity = candidate?.evidence_summary?.selectionIdentity ?? {}
  const identityAndPackConfirmationRequired = selectionIdentity.confirmationRequired === true
  const identityAndPackConfirmationApplies = identityAndPackConfirmationRequired && availability !== "out"
  const identityConfirmationMissing = identityAndPackConfirmationApplies && !identityAndPackConfirmed
  const nativePackCountMissing = identityAndPackConfirmationApplies && (
    !Number.isInteger(parsedNativePackCount) || Number(parsedNativePackCount) <= 0
  )

  useEffect(() => {
    setIdentityAndPackConfirmed(false)
    setNativePackCount("")
  }, [task.id])

  return <article className="min-w-0 overflow-hidden rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {anchorImage
          ? <img src={anchorImage} alt={`Producto Luna: ${String(candidate?.product_title ?? "producto")}`} className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain p-1" />
          : <div role="img" aria-label="Imagen Luna no disponible" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-red-300/30 bg-red-400/10 p-2 text-center text-[10px] font-black text-red-100">IMAGEN LUNA NO DISPONIBLE</div>}
        <div className="min-w-0">
          <h4 className="break-words font-black">{task.title}</h4>
          <p className="mt-1 break-words text-sm text-white/65">{candidate?.product_title}</p>
          <p className="mt-1 break-words text-xs text-white/50">SKU {String(candidate?.supplier_sku ?? "N/D")} · {task.gate_type === "IMAGE_APPROVAL_REQUIRED" ? "referencia Luna de identidad; el set a aprobar aparece abajo" : "misma referencia visual durante todo el recorrido"}</p>
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
      </div>
      {identityAndPackConfirmationApplies && <fieldset className="mt-4 grid gap-3 rounded-xl border border-red-300/30 bg-red-400/[0.06] p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-black text-red-100">Identidad y presentación exactas <span aria-hidden="true">*</span></legend>
        <label className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 text-xs leading-5 ${identityConfirmationMissing ? "border-red-400 text-red-100" : "border-emerald-200/25 text-emerald-50"}`}>
          <input type="checkbox" checked={identityAndPackConfirmed}
            onChange={(event) => setIdentityAndPackConfirmed(event.target.checked)}
            aria-required="true" aria-invalid={identityConfirmationMissing}
            aria-describedby={`${fieldId}-identity-pack-help`}
            className="mt-1 h-5 w-5 shrink-0 accent-emerald-200" />
          <span><strong>Confirmo el producto exacto.</strong> La imagen, el nombre, la variante y la presentación mostrados en Luna corresponden al producto que estamos preparando.</span>
        </label>
        <label className="text-xs font-bold">Unidades por presentación de Luna <span className="text-red-200">*</span>
          <input value={nativePackCount} onChange={(event) => setNativePackCount(event.target.value)}
            inputMode="numeric" type="number" min="1" step="1" aria-required="true"
            aria-invalid={nativePackCountMissing} aria-describedby={`${fieldId}-native-pack-help`}
            className={`mt-1 min-h-11 w-full rounded-xl border bg-black/30 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${nativePackCountMissing ? "border-red-400" : "border-white/15"}`} />
          <span id={`${fieldId}-native-pack-help`} className={`mt-1 block font-normal ${nativePackCountMissing ? "text-red-200" : "text-white/55"}`}>{nativePackCountMissing
            ? "Obligatorio: indica un número entero mayor que cero."
            : "Pack nativo confirmado. No es la cantidad disponible en inventario."}</span>
        </label>
        <p id={`${fieldId}-identity-pack-help`} className={`text-xs leading-5 sm:col-span-2 ${identityConfirmationMissing ? "font-bold text-red-200" : "text-white/55"}`}>{identityConfirmationMissing
          ? "Obligatorio: confirma visualmente que el producto y su presentación son exactos antes de continuar."
          : "Identidad visual confirmada. Seller OS conservará esta confirmación con la presentación indicada."}</p>
      </fieldset>}
      <button type="button" disabled={working || priceMissing || availabilityMissing || lunaQuantityConflict || identityConfirmationMissing || nativePackCountMissing} onClick={() => void onConfirm({ action: "confirm_luna", taskId: task.id, price: Number(price), availability: { available: availability === "available", quantity: parsedQuantity }, ...(identityAndPackConfirmationApplies ? { identityAndPackConfirmed, nativePackCount: parsedNativePackCount } : {}) })} className="mt-4 min-h-12 w-full rounded-xl bg-amber-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 disabled:opacity-40 sm:w-auto">CONFIRMAR Y CONTINUAR</button>
    </div>}

    {task.gate_type === "PRODUCT_APPROVAL_REQUIRED" && <div className="mt-4 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">
      <p>{controlledExploratoryTest
        ? "La búsqueda histórica terminó sin ventas exactas confirmadas. Identidad, pack, ficha técnica y gates críticos deben pasar igualmente; esta oferta comienza como prueba comercial controlada."
        : "La identidad y la ficha técnica pasaron. Tú defines el precio final; Seller OS comprobará utilidad, ROI y margen sin convertir precios de competidores en una recomendación automática."}</p>
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
      <fieldset className="mt-3 grid gap-3 rounded-xl border border-violet-200/20 bg-violet-200/[0.05] p-3">
        <legend className="px-1 text-xs font-black text-violet-50">Autorizaciones para preparar las imágenes</legend>
        <label className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 text-xs leading-5 ${imageRightsConfirmed ? "border-emerald-200/25 text-emerald-50" : "border-red-300/30 text-red-100"}`}>
          <input type="checkbox" checked={imageRightsConfirmed}
            onChange={(event) => setImageRightsConfirmed(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-emerald-200" />
          <span><strong>Confirmo los derechos de uso.</strong> Las imágenes de Luna/proveedor mostradas para este producto están autorizadas para preparar mi listing y corresponden al producto y pack exactos.</span>
        </label>
        <label className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 text-xs leading-5 ${openAiImageSpendApproved ? "border-emerald-200/25 text-emerald-50" : "border-red-300/30 text-red-100"}`}>
          <input type="checkbox" checked={openAiImageSpendApproved}
            onChange={(event) => setOpenAiImageSpendApproved(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-emerald-200" />
          <span><strong>Autorizo hasta 1 llamada OpenAI de calidad low.</strong> Se utilizará únicamente para un fondo contextual seguro; el producto autorizado se compondrá localmente y las seis imágenes requerirán mi revisión.</span>
        </label>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={working || salePriceMissing || !fulfillmentBasis || !imageRightsConfirmed || !openAiImageSpendApproved} onClick={() => void onConfirm({ action: "product_decision", taskId: task.id, decision: "APPROVE", salePrice: Number(salePrice), fulfillmentBasis, imageRightsConfirmed, openAiImageSpendApproved })} className="min-h-12 w-full rounded-xl bg-cyan-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:opacity-40 sm:w-auto">{controlledExploratoryTest ? "APROBAR PRUEBA CONTROLADA · CANTIDAD 1" : "APROBAR PRODUCTO CON MERCADO VALIDADO"}</button>
        <button type="button" disabled={working} onClick={() => void onConfirm({ action: "product_decision", taskId: task.id, decision: "REJECT" })} className="min-h-12 w-full rounded-xl border border-red-300/35 px-4 font-black text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200 disabled:opacity-40 sm:w-auto">RECHAZAR</button>
      </div>
      {candidate?.economics_summary?.minimumOperatorPrice && <p className="mt-2 text-xs text-white/60">Piso interno estimado con costo y reservas propias: ${Number(candidate.economics_summary.minimumOperatorPrice).toFixed(2)}. Debe validarse con el precio que tú apruebes.</p>}
    </div>}

    {task.gate_type === "IMAGE_APPROVAL_REQUIRED" && <div className="mt-4">
      <div className="rounded-xl border border-violet-200/20 bg-violet-200/[0.05] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black text-violet-50">Set de publicación para revisión · {imageSet.length}/6</p>
          <span className="rounded-full border border-violet-100/20 px-2.5 py-1 text-[10px] font-black text-violet-100">{openAiContextUsed ? "1 FONDO DE CONTEXTO OPENAI" : "COMPOSICIÓN LOCAL"}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-white/60">Estas son las seis imágenes derivadas guardadas por Seller OS para este candidato. La imagen Luna superior sólo sirve como referencia de identidad y no sustituye este set.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{imageSet.map((asset, index) => <figure key={asset.id} className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white p-2 text-black">
        {asset.outputPreviewUrl
          ? <img src={asset.outputPreviewUrl} alt={`${imageSlotLabel(asset.slot)} · imagen ${index + 1} de 6`} className="aspect-square w-full object-contain" />
          : <div role="img" aria-label="Preview temporal no disponible" className="flex aspect-square w-full items-center justify-center bg-slate-100 p-3 text-center text-xs font-black text-slate-600">PREVIEW TEMPORAL NO DISPONIBLE</div>}
        <figcaption className="mt-2 min-w-0">
          <p className="break-words text-xs font-black">{index + 1}. {imageSlotLabel(asset.slot)}</p>
          <p className="mt-1 text-[10px] font-bold text-slate-500">{asset.generativeAiUsed === true ? "Fondo seguro generado; producto autorizado compuesto localmente" : "Composición local con fuente autorizada"}</p>
        </figcaption>
      </figure>)}</div>
      <p role="status" className={`mt-3 rounded-xl border p-3 text-sm ${imageSetReady ? "border-emerald-200/20 bg-emerald-200/[0.05] text-emerald-50" : "border-red-300/30 bg-red-400/10 text-red-100"}`}>{imageSetReady
        ? "Set completo: revisa producto, pack, variante, textos y elementos incluidos antes de aprobar una sola vez."
        : imageSet.length
          ? `El set todavía no está listo para aprobar: se recibieron ${imageSet.length} de 6 previews válidos o falta un slot obligatorio.`
          : "Seller OS todavía no entregó el set derivado de seis imágenes. Las URLs Luna no se usarán como sustituto."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={working || !imageSetReady} onClick={() => void onConfirm({ action: "image_decision", taskId: task.id, decision: "APPROVE" })} className="min-h-12 w-full rounded-xl bg-emerald-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100 disabled:opacity-40 sm:w-auto">APROBAR IMÁGENES · SET DE 6</button>
        <button type="button" disabled={working} onClick={() => void onConfirm({ action: "image_decision", taskId: task.id, decision: "REJECT" })} className="min-h-12 w-full rounded-xl border border-red-300/35 px-4 font-black text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200 disabled:opacity-40 sm:w-auto">RECHAZAR</button>
      </div>
    </div>}
  </article>
}

const IMAGE_REVIEW_SLOTS = [
  "MAIN_WHITE_BACKGROUND",
  "PACK_AND_COUNT",
  "KEY_FEATURES",
  "SIZE_AND_CONTENT",
  "USE_CONTEXT",
  "PACKAGE_CONTENTS",
] as const

function normalizedImageReviewSet(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => entry && typeof entry === "object" ? entry as Row : {})
    .filter((asset) => typeof asset.id === "string" &&
      IMAGE_REVIEW_SLOTS.includes(asset.slot) &&
      ["pending_review", "approved"].includes(String(asset.status)) &&
      Boolean(safeHttpsUrl(asset.outputPreviewUrl)))
    .map((asset): Row => ({ ...asset, outputPreviewUrl: safeHttpsUrl(asset.outputPreviewUrl) }))
    .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
    .slice(0, 6)
}

function completeImageReviewSet(assets: Row[]) {
  return assets.length === IMAGE_REVIEW_SLOTS.length &&
    new Set(assets.map((asset) => asset.id)).size === IMAGE_REVIEW_SLOTS.length &&
    IMAGE_REVIEW_SLOTS.every((slot) =>
      assets.filter((asset) => asset.slot === slot).length === 1)
}

function imageSlotLabel(value: unknown) {
  return ({
    MAIN_WHITE_BACKGROUND: "Principal con fondo blanco",
    PACK_AND_COUNT: "Pack y cantidad",
    KEY_FEATURES: "Características verificadas",
    SIZE_AND_CONTENT: "Tamaño y contenido",
    USE_CONTEXT: "Contexto de uso",
    PACKAGE_CONTENTS: "Contenido del paquete",
  } as Record<string, string>)[String(value)] ?? "Imagen del listing"
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
  if (candidate?.evidence_summary?.commercialEvidenceMode === "CONTROLLED_EXPLORATORY_TEST") {
    const coverage = candidate?.evidence_summary?.reconciliationCoverage ?? {}
    return <div className="mt-3 rounded-xl border border-violet-200/25 bg-violet-200/[0.07] p-3 text-xs leading-5 text-violet-50">
      <p className="font-black">PRUEBA COMERCIAL CONTROLADA</p>
      <p className="mt-1">La búsqueda acotada terminó sin historial vendido exacto. Eso reduce la confianza, pero no bloquea por sí solo un producto seguro, rentable y operable.</p>
      <p className="mt-2 text-violet-100/70">Muestra revisada: {Number(coverage.reviewedObservations ?? 0)} · cantidad inicial eBay 1 · precio aprobado por el operador · monitoreo obligatorio · un cambio por experimento.</p>
      <p className="mt-1 text-violet-100/60">Los patrones transferibles son contexto agregado; no prueban ventas de este producto ni autorizan copiar contenido de otros vendedores.</p>
    </div>
  }
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
  const controlledExploratoryTest = candidate.evidence_summary?.commercialEvidenceMode ===
    "CONTROLLED_EXPLORATORY_TEST"
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase text-emerald-100/65">{controlledExploratoryTest ? "Prueba controlada · paquete verificado" : "Mercado validado · paquete verificado"}</p><h4 className="mt-1 break-words font-black">{candidate.product_title}</h4><p className="mt-1 break-words text-xs text-white/55">SKU {candidate.supplier_sku} · {imageUrls.length} imagen(es) autorizada(s)</p></div><a href="https://www.ebay.com/sh/ovw" target="_blank" rel="noreferrer" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-200 px-4 text-center font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100 sm:w-auto">ABRIR SELLER HUB Y PUBLICAR</a></div>
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
