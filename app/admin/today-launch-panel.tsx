"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"

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
  const quotaPaused = (pilot?.jobs ?? []).some((job: Row) => job.status === "WAITING_RETRY" && /429|QUOTA/.test(String(job.last_error_code ?? "")))
  const currentBusinessState = !pilot ? "NO INICIADO" : quotaPaused ? "PAUSADO POR EBAY" :
    candidates.some((candidate: Row) => candidate.machine_state === "READY_FOR_MANUAL_PUBLICATION") ? "LISTO PARA PUBLICAR" :
      openTasks.length ? "ESPERANDO TU CONFIRMACIÓN" :
        candidates.some((candidate: Row) => candidate.machine_state === "BLOCKED") ? "BLOQUEADO" : "TRABAJANDO"
  return <section className="mt-5 rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] to-emerald-200/[0.04] p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/60">Lanzamiento de hoy</p><h2 className="mt-2 text-2xl font-black">Objetivo: completar el piloto 3/3</h2><p className="mt-2 text-sm text-white/60">Un clic inicia el trabajo automático. Seller OS se detiene sólo cuando necesita una confirmación indispensable.</p></div><span className="rounded-full border border-white/15 px-3 py-2 text-xs font-black">{loading ? "CARGANDO" : currentBusinessState}</span></div>
    {!pilot && !loading && <button type="button" disabled={working} onClick={() => void request({ action: "start" })} className="mt-5 min-h-14 w-full rounded-2xl bg-cyan-200 px-5 text-base font-black text-black disabled:opacity-50 sm:w-auto">{working ? "INICIANDO…" : "INICIAR LANZAMIENTO DE HOY"}</button>}
    {error && <p role="alert" className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 p-3 text-sm font-bold text-red-100">{error}</p>}
    {pilot && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-5"><Metric label="Piloto" value={`${Number(pilot.run.verified_existing_listings) + Number(pilot.run.verified_new_listings)} / 3`} /><Metric label="Cola de hoy" value={`${candidates.length} / 5`} /><Metric label="Preparación local" value={String(candidates.filter((candidate: Row) => candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES").length)} /><Metric label="Listos" value={String(pilot.run.ready_for_manual_publication_count)} /><Metric label="Escrituras eBay" value="0" /></div>
      {quotaPaused && <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-50">eBay pausó únicamente la lane de verificación. La selección, Luna y los paquetes locales permanecen disponibles; Seller OS retomará el mismo checkpoint automáticamente.</p>}
      <div className="mt-6"><h3 className="text-lg font-black">Tareas para Ernesto</h3>{openTasks.length === 0 ? <p className="mt-2 rounded-2xl border border-white/10 p-4 text-sm text-white/55">Seller OS no necesita una acción humana en este momento.</p> : <div className="mt-3 grid gap-3">{openTasks.map((task: Row) => <HumanTask key={task.id} task={task} candidate={candidates.find((candidate: Row) => candidate.id === task.candidate_id)} working={working} onConfirm={(body) => request(body)} />)}</div>}</div>
      <details className="mt-5 rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer font-black">Ver candidatos y progreso automático</summary><div className="mt-3 grid gap-2">{candidates.map((candidate: Row) => <div key={candidate.id} className="rounded-xl bg-black/20 p-3"><p className="font-bold">{candidate.ordinal}. {candidate.product_title}</p><p className="mt-1 text-xs text-white/55">{businessState(candidate.machine_state)} · SKU {candidate.supplier_sku}</p>{candidate.local_preparation_status === "BLOCKED_PENDING_VERIFIED_GATES" && <p className="mt-1 text-xs text-cyan-100/75">Paquete local seguro preparado; todavía no es publicable.</p>}<p className="mt-1 text-xs text-amber-100/80">{candidate.next_human_action}</p></div>)}</div></details>
    </>}
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs font-black uppercase text-white/45">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div> }

function HumanTask({ task, candidate, working, onConfirm }: { task: Row; candidate?: Row; working: boolean; onConfirm: (body: Row) => Promise<void> }) {
  const [price, setPrice] = useState("")
  const [availability, setAvailability] = useState("unknown")
  const [quantity, setQuantity] = useState("")
  const schema = task.action_schema ?? {}
  return <article className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4"><div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-black">{task.title}</h4><p className="mt-1 text-sm text-white/65">{candidate?.product_title}</p></div><span className="text-xs font-black text-amber-100">≈ {Math.ceil(Number(task.estimated_seconds) / 60)} min</span></div><p className="mt-3 text-sm text-white/60">{task.why_needed}</p><p className="mt-2 text-xs text-emerald-100/75">Después: {task.impact}</p>
    {task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && <a href={`https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=${encodeURIComponent(String(schema.query ?? ""))}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-amber-200 px-4 font-black text-black">ABRIR CONSULTA Y CAPTURAR</a>}
    {task.gate_type === "LUNA_CONFIRMATION_REQUIRED" && <div className="mt-4 grid gap-3 sm:grid-cols-4"><label className="text-xs font-bold">Precio actual<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-white" /></label><label className="text-xs font-bold">Disponibilidad<select value={availability} onChange={(event) => setAvailability(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-white"><option value="unknown">Seleccionar</option><option value="available">Disponible</option><option value="out">Agotado</option></select></label><label className="text-xs font-bold">Cantidad visible (opcional)<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-white" /></label><button type="button" disabled={working || !(Number(price) > 0) || availability === "unknown"} onClick={() => void onConfirm({ action: "confirm_luna", taskId: task.id, price: Number(price), availability: { available: availability === "available", quantity: quantity ? Number(quantity) : null } })} className="min-h-12 self-end rounded-xl bg-amber-200 px-4 font-black text-black disabled:opacity-40">CONFIRMAR</button></div>}
    {task.gate_type === "PRODUCT_APPROVAL_REQUIRED" && <p className="mt-4 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">Producto listo para revisión. La generación permanece detenida porque OpenAI está apagado en esta subfase.</p>}
  </article>
}

function businessState(state: string) {
  if (state === "WAITING_PRODUCT_RESEARCH_CAPTURE" || state === "WAITING_LUNA_CONFIRMATION" || state.startsWith("WAITING_")) return "Esperando tu confirmación"
  if (state === "READY_FOR_MANUAL_PUBLICATION") return "Listo para publicar"
  if (state === "VERIFIED_ACTIVE") return "Publicado y verificado"
  if (state === "BLOCKED" || state === "REJECTED") return "Bloqueado"
  return "Sistema trabajando"
}
