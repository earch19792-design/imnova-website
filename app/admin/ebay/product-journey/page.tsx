"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

import { supabase } from "@/lib/supabase"

type HumanStatus = "COMPROBADO" | "EN_PROCESO" | "FALTA_COMPROBAR" |
  "TIENE_UN_FALLO" | "PENDIENTE"
type Phase = {
  ordinal: number
  code: string
  label: string
  status: HumanStatus
  mechanismCertification: string
  startedAt: string | null
  completedAt: string | null
  trigger: string
  sourceAuthority: string
  freshness: { status: string; observedAt: string | null;
    expiresAt: string | null }
  attempted: string
  found: string[]
  missing: string[]
  result: string
  decision: string
  failureClass: string | null
  retrySafety: string
  nextAction: string
  ownerIntervention: string
  databaseWriteCount: number | null
  marketplaceWriteCount: number | null
  technicalEvidence: { inputReferences: string[]; outputReferences: string[];
    receiptReferences: string[] }
}
type Journey = {
  observedAt: string
  identity: { candidateId: string | null; productId: string | null;
    variantId: string | null; supplierSku: string | null; title: string | null;
    packageId: string | null; offerId: string | null; itemId: string | null;
    sourceUrl: string | null; provenance: string }
  overall: { status: HumanStatus; completedPhaseCount: number;
    totalPhaseCount: number; nextAction: string; ownerIntervention: string }
  ownerFlow: Array<{ code: string; label: string; status: HumanStatus }>
  phases: Phase[]
  activity: Array<{ occurredAt: string; label: string; phase: string;
    authority: string }>
  integrity: { productJourneyTraceAvailable: boolean;
    everyStageHasHumanStatus: boolean; everyStageHasSourceAuthority: boolean;
    everyStageHasFreshness: boolean;
    everyStageHasOutputOrExplicitFailure: boolean;
    technicalDetailsSecondary: boolean; noFalseZero: boolean;
    noFakeCompleted: boolean; noNewParallelRuntime: boolean;
    noOwnerTechnicalRecovery: boolean; marketplaceWritesForObservability: 0;
    databaseMutationsFromRead: 0; violations: Array<Record<string, unknown>> }
}

function humanStatus(status: HumanStatus) {
  if (status === "EN_PROCESO") return "En proceso"
  if (status === "FALTA_COMPROBAR") return "Falta comprobar"
  if (status === "TIENE_UN_FALLO") return "Tiene un fallo"
  if (status === "PENDIENTE") return "Pendiente"
  return "Comprobado"
}

function statusStyle(status: HumanStatus) {
  if (status === "COMPROBADO") return "border-emerald-200/30 bg-emerald-200/[0.09] text-emerald-50"
  if (status === "TIENE_UN_FALLO") return "border-rose-200/35 bg-rose-200/[0.09] text-rose-50"
  if (status === "EN_PROCESO") return "border-cyan-200/35 bg-cyan-200/[0.09] text-cyan-50"
  if (status === "FALTA_COMPROBAR") return "border-amber-200/30 bg-amber-200/[0.08] text-amber-50"
  return "border-white/15 bg-white/[0.04] text-white/65"
}

function formatDate(value: string | null) {
  if (!value) return "No demostrado"
  return new Intl.DateTimeFormat("es-NI", { timeZone: "America/Managua",
    dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function certification(value: string) {
  if (value === "PHYSICAL_PASS") return "Comprobado físicamente"
  if (value === "INTERNAL_PASS") return "Comprobación interna"
  if (value === "FAILED") return "Falló"
  return "No certificado"
}

function SellerOsProductJourneyContent() {
  const search = useSearchParams()
  const candidateId = search.get("candidateId")?.trim() ?? ""
  const [journey, setJourney] = useState<Journey | null>(null)
  const [state, setState] = useState<"LOADING" | "READY" | "ERROR">(
    candidateId ? "LOADING" : "ERROR")
  const [error, setError] = useState(candidateId ? "" :
    "Abre un producto desde Preparar productos para ver su recorrido.")

  const load = useCallback(async () => {
    if (!candidateId) return
    setState("LOADING"); setError("")
    try {
      const session = await supabase.auth.getSession()
      if (session.error || !session.data.session) throw new Error(
        "Tu sesión de administración no está disponible.")
      const response = await fetch(`/api/admin/ebay/product-journey?candidateId=${
        encodeURIComponent(candidateId)}`, { cache: "no-store",
        headers: { Authorization:
          `Bearer ${session.data.session.access_token}` } })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || !payload.journey) {
        throw new Error(payload?.error ?? "No pudimos leer el recorrido.")
      }
      setJourney(payload.journey as Journey); setState("READY")
    } catch (caught) {
      setJourney(null); setState("ERROR")
      setError(caught instanceof Error ? caught.message
        : "No pudimos leer el recorrido.")
    }
  }, [candidateId])

  useEffect(() => { void load() }, [load])

  return <main className="min-h-screen bg-[#07101d] px-4 py-6 text-white sm:px-6 lg:px-10">
    <div className="mx-auto max-w-6xl">
      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/admin/ebay/publish" className="font-bold text-cyan-100 hover:text-white">Publicar</a>
        <span className="text-white/30">/</span>
        <span className="text-white/60">Recorrido del producto</span>
      </nav>

      {state === "LOADING" && <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <p className="text-white/65">Leyendo la evidencia durable del producto…</p>
      </section>}
      {state === "ERROR" && <section role="alert" className="mt-8 rounded-3xl border border-amber-200/25 bg-amber-200/[0.07] p-6">
        <h1 className="text-2xl font-black">Recorrido del producto</h1>
        <p className="mt-3 text-amber-50/85">{error}</p>
        <a href="/admin/ebay/quick-pick" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-4 font-black text-black">Ir a Preparar productos</a>
      </section>}

      {state === "READY" && journey && <>
        <header className="mt-7 rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] to-white/[0.03] p-5 sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">{journey.identity.provenance}</p>
          <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><h1 className="text-2xl font-black sm:text-3xl">{journey.identity.title ?? "Producto sin título"}</h1>
              <p className="mt-2 text-sm text-white/60">{journey.identity.supplierSku ?? "SKU no demostrado"}</p></div>
            <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-black ${statusStyle(journey.overall.status)}`}>{humanStatus(journey.overall.status)}</span>
          </div>
          <div className="mt-5 grid gap-3 rounded-2xl bg-black/20 p-4 sm:grid-cols-2">
            <div><p className="text-xs font-black uppercase tracking-wider text-white/45">Qué sigue</p><p className="mt-1 text-sm leading-6">{journey.overall.nextAction}</p></div>
            <div><p className="text-xs font-black uppercase tracking-wider text-white/45">Tu intervención</p><p className="mt-1 text-sm leading-6">{journey.overall.ownerIntervention}</p></div>
          </div>
        </header>

        <section aria-labelledby="flow-heading" className="mt-6">
          <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/55">Vista simple</p><h2 id="flow-heading" className="mt-1 text-xl font-black">Recorrido comercial</h2></div><p className="text-xs text-white/45">{journey.overall.completedPhaseCount} de {journey.overall.totalPhaseCount} fases comprobadas</p></div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {journey.ownerFlow.map((step, index) => <li key={step.code} className={`relative rounded-2xl border p-3 ${statusStyle(step.status)}`}>
              <span className="text-[10px] font-black text-current/60">{index + 1}</span>
              <p className="mt-1 text-sm font-black">{step.label}</p>
              <p className="mt-2 text-[11px] opacity-75">{humanStatus(step.status)}</p>
            </li>)}
          </ol>
        </section>

        <section aria-labelledby="phases-heading" className="mt-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/55">Detalle humano</p>
          <h2 id="phases-heading" className="mt-1 text-xl font-black">Qué hizo Seller OS</h2>
          <div className="mt-4 space-y-3">{journey.phases.map((phase) =>
            <article key={phase.code} className={`rounded-3xl border p-4 sm:p-5 ${statusStyle(phase.status)}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div><p className="text-[11px] font-black uppercase tracking-wider opacity-55">Fase {phase.ordinal}</p><h3 className="mt-1 text-lg font-black">{phase.label}</h3></div>
                <div className="flex flex-wrap gap-2"><span className="rounded-full border border-current/20 px-3 py-1 text-xs font-black">{humanStatus(phase.status)}</span><span className="rounded-full bg-black/20 px-3 py-1 text-xs">Mecanismo: {certification(phase.mechanismCertification)}</span></div>
              </div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="font-black">¿Qué hizo?</dt><dd className="mt-1 leading-6 opacity-80">{phase.attempted}</dd></div>
                <div><dt className="font-black">¿Qué encontró?</dt><dd className="mt-1 leading-6 opacity-80">{phase.found.length ? <ul className="space-y-1">{phase.found.map((item) => <li key={item}>{item}</li>)}</ul> : "Todavía no hay un resultado durable."}</dd></div>
                <div><dt className="font-black">¿Qué falta?</dt><dd className="mt-1 leading-6 opacity-80">{phase.missing.length ? <ul className="space-y-1">{phase.missing.map((item) => <li key={item}>{item}</li>)}</ul> : "Nada en esta fase."}</dd></div>
                <div><dt className="font-black">¿Qué sigue?</dt><dd className="mt-1 leading-6 opacity-80">{phase.nextAction}</dd></div>
              </dl>
              <div className="mt-4 rounded-2xl bg-black/20 p-3 text-sm"><strong>Resultado:</strong> {phase.result}<br/><strong>Tu intervención:</strong> {phase.ownerIntervention}</div>
              <details className="mt-3 rounded-2xl border border-current/15 bg-black/10 p-3 text-xs">
                <summary className="flex min-h-8 cursor-pointer items-center font-black">Ver evidencia técnica</summary>
                <dl className="mt-3 grid gap-2 text-current/70 sm:grid-cols-2">
                  <div><dt className="font-black">Autoridad</dt><dd className="break-words">{phase.sourceAuthority}</dd></div>
                  <div><dt className="font-black">Freshness</dt><dd>{phase.freshness.status} · observado {formatDate(phase.freshness.observedAt)}</dd></div>
                  <div><dt className="font-black">Inicio / fin</dt><dd>{formatDate(phase.startedAt)} / {formatDate(phase.completedAt)}</dd></div>
                  <div><dt className="font-black">Fallo / retry</dt><dd className="break-words">{phase.failureClass ?? "Ninguno"} / {phase.retrySafety}</dd></div>
                  <div><dt className="font-black">Escrituras DB</dt><dd>{phase.databaseWriteCount ?? "No instrumentado históricamente"}</dd></div>
                  <div><dt className="font-black">Escrituras marketplace</dt><dd>{phase.marketplaceWriteCount ?? "No instrumentado históricamente"}</dd></div>
                </dl>
                {[...phase.technicalEvidence.inputReferences, ...phase.technicalEvidence.outputReferences, ...phase.technicalEvidence.receiptReferences].length > 0 && <ul className="mt-3 space-y-1 break-all text-current/55">{[...phase.technicalEvidence.inputReferences, ...phase.technicalEvidence.outputReferences, ...phase.technicalEvidence.receiptReferences].map((item) => <li key={item}>{item}</li>)}</ul>}
              </details>
            </article>)}
          </div>
        </section>

        <section aria-labelledby="activity-heading" className="mt-8 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/55">Actividad durable</p>
          <h2 id="activity-heading" className="mt-1 text-xl font-black">Lo que acaba de ocurrir</h2>
          {journey.activity.length ? <ol className="mt-4 space-y-3">{journey.activity.slice(0, 12).map((event) => <li key={`${event.occurredAt}:${event.phase}`} className="flex gap-3 border-l border-cyan-200/30 pl-4"><time className="w-32 shrink-0 text-xs text-white/45">{formatDate(event.occurredAt)}</time><span className="text-sm">{event.label}</span></li>)}</ol> : <p className="mt-4 text-sm text-white/55">No hay actividad durable demostrada todavía.</p>}
        </section>

        <footer className="mt-8 rounded-2xl border border-white/10 p-4 text-xs text-white/45">
          Observabilidad de solo lectura · 0 mutaciones de base de datos · 0 escrituras marketplace · actualizado {formatDate(journey.observedAt)}
        </footer>
      </>}
    </div>
  </main>
}

export default function SellerOsProductJourneyPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#07101d] p-6 text-white"><p className="text-white/65">Leyendo recorrido…</p></main>}>
    <SellerOsProductJourneyContent />
  </Suspense>
}
