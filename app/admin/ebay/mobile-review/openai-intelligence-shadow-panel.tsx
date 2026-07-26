"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Payload = {
  success?: boolean
  migrationReady?: boolean
  migrationError?: string | null
  registry?: {
    useCases: Array<{
      id: string
      purpose: string
      currentEndToEndState: string
      modelTier: string
      risk: string
      newCallsEnabled: false
      evalSuite: string
    }>
  }
  configuration?: Array<{
    use_case_id: string
    enabled: boolean
    mode: string
    kill_switch_engaged: boolean
    daily_budget_micros: number
    monthly_budget_micros: number
  }>
  metrics?: Array<{
    metric_date: string
    invocation_count: number
    completed_count: number
    schema_pass_count: number
    evidence_pass_count: number
    actual_cost_micros: number
  }>
  recentInvocations?: Array<{
    id: string
    use_case_id: string
    status: string
    model_tier: string
    estimated_cost_micros: number
    actual_cost_micros: number
    created_at: string
  }>
  modelRouter?: {
    economyConfigured: boolean
    balancedConfigured: boolean
    advancedConfigured: boolean
    imageConfigured: boolean
    embeddingConfigured: boolean
  }
  safety?: {
    newCallsEnabled: false
    shadowOnly: true
    ebayWrites: 0
    stateMutations: 0
  }
  error?: string
}

function usd(micros: number | undefined) {
  return `$${((micros ?? 0) / 1_000_000).toFixed(4)}`
}

export function OpenAiIntelligenceShadowPanel() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data, error: authError } = await supabase.auth.getSession()
        if (authError || !data.session) throw new Error("AUTH_REQUIRED")
        const response = await fetch("/api/admin/ebay/openai-intelligence", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        })
        const result = await response.json() as Payload
        if (!response.ok) {
          throw new Error(result.error ?? "OPENAI_INTELLIGENCE_STATUS_FAILED")
        }
        if (active) setPayload(result)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error
          ? loadError.message : "OPENAI_INTELLIGENCE_STATUS_FAILED")
      }
    })()
    return () => { active = false }
  }, [])

  const metrics = payload?.metrics?.[0]
  const configured = payload?.configuration ?? []
  const enabled = configured.filter((entry) => entry.enabled).length
  const protectedCases = configured.filter((entry) =>
    entry.kill_switch_engaged).length
  const useCases = payload?.registry?.useCases ?? []

  return (
    <section aria-labelledby="openai-intelligence-heading" className="space-y-3 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">Intelligence Layer · auditoría primero</p>
          <h3 id="openai-intelligence-heading" className="mt-1 font-black">OpenAI Shadow Control</h3>
          <p className="mt-1 text-xs leading-5 text-white/60">OpenAI propone y se evalúa; las fuentes oficiales, las reglas deterministas y el ledger conservan autoridad.</p>
        </div>
        <span className="rounded-full border border-cyan-100/30 px-2 py-1 text-xs font-black">
          {payload?.migrationReady === false ? "MIGRACIÓN PENDIENTE" : "SHADOW · 0 EFECTOS"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Casos registrados</dt><dd className="mt-1 text-lg font-black">{useCases.length || "—"}</dd></div>
        <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Habilitados nuevos</dt><dd className="mt-1 text-lg font-black">{enabled}</dd></div>
        <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Kill switches</dt><dd className="mt-1 text-lg font-black">{configured.length ? protectedCases : "—"}</dd></div>
        <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Costo shadow hoy</dt><dd className="mt-1 text-lg font-black">{usd(metrics?.actual_cost_micros)}</dd></div>
      </dl>

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 p-2"><strong>Calidad</strong><p className="mt-1 text-white/60">Schema: {metrics?.schema_pass_count ?? 0} · evidencia: {metrics?.evidence_pass_count ?? 0}</p></div>
        <div className="rounded-xl border border-white/10 p-2"><strong>Utilidad</strong><p className="mt-1 text-white/60">Sin activación hasta comparar contra ground truth y flujo determinista.</p></div>
        <div className="rounded-xl border border-white/10 p-2"><strong>Autoridad</strong><p className="mt-1 text-white/60">eBay writes: 0 · cambios de estado: 0.</p></div>
      </div>

      <details className="rounded-xl border border-white/10 p-2">
        <summary className="cursor-pointer text-xs font-black">Registro y estado E2E</summary>
        <div className="mt-2 space-y-2">
          {useCases.map((entry) => (
            <article key={entry.id} className="rounded-xl bg-black/20 p-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2"><strong>{entry.id}</strong><span>{entry.modelTier} · {entry.currentEndToEndState}</span></div>
              <p className="mt-1 text-white/60">{entry.purpose}</p>
            </article>
          ))}
        </div>
      </details>

      {payload?.recentInvocations?.length ? (
        <p className="text-xs text-white/60">Invocaciones shadow registradas: {payload.recentInvocations.length}. Última: {payload.recentInvocations[0].use_case_id} · {payload.recentInvocations[0].status}.</p>
      ) : (
        <p className="text-xs text-white/55">Sin invocaciones nuevas. Los casos comienzan deshabilitados, con presupuesto cero y kill switch activo.</p>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200/30 p-2 text-xs text-rose-50">{error}</p>}
    </section>
  )
}
