"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type RunMetric = {
  run_id: string
  operation_date: string
  status: string
  factory_mode: string
  products_selected: number
  products_started: number
  products_completed: number
  products_quarantined: number
  products_on_hold: number
  reserve_replacements: number
  effects_blocked_by_policy: number
}

type QuarantineCase = {
  id: string
  sku: string | null
  phase: string
  error_code: string
  dependency: string
  impact: string
  suggested_action: string
  replay_safe: boolean
  status: string
}

type Circuit = {
  id: string
  dependency: string
  status: string
  failure_count: number
  last_error_code: string | null
}

type Dashboard = {
  migrationReady: boolean
  error: string | null
  safety: {
    environment: string
    defaultMode: string
    externalWritesAllowed: boolean
    automaticPublishAllowed: boolean
  }
  runs: RunMetric[]
  quarantine: QuarantineCase[]
  circuits: Circuit[]
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

export default function ResilientListingFactoryPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    setError("")
    const token = await bearerToken()
    const response = await fetch("/api/admin/ebay/listing-factory", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    const payload = await response.json() as {
      success?: boolean
      error?: string
      resilientFactory?: Dashboard
    }
    if (!response.ok || payload.success === false || !payload.resilientFactory) {
      setError(payload.error ?? "No fue posible cargar la fabrica.")
      return
    }
    setDashboard(payload.resilientFactory)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const replay = async (item: QuarantineCase) => {
    if (!item.replay_safe) return
    setBusyId(item.id)
    setError("")
    try {
      const token = await bearerToken()
      const response = await fetch("/api/admin/ebay/listing-factory", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "REPLAY_FROM_LAST_CHECKPOINT",
          quarantineCaseId: item.id,
          evidenceRevalidated: true,
        }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? "REPLAY_FAILED")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "REPLAY_FAILED")
    } finally {
      setBusyId("")
    }
  }

  return (
    <section className="mt-10 bg-[#f2efe6] py-8 text-[#17231b]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-[#17231b]/15 bg-[#d7ff45] p-7 shadow-[0_22px_70px_rgba(23,35,27,0.12)] sm:p-10">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[36px] border-[#ff6b35]/70" />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em]">
            Seller OS / Listing Workspace
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl font-black leading-none sm:text-6xl">
            Fabrica resiliente de lotes de cinco
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold sm:text-lg">
            Cinco productos independientes, checkpoints durables y cero efectos
            externos mientras la politica permanezca en dry-run.
          </p>
          <div className="mt-7 flex flex-wrap gap-2 font-mono text-xs font-bold uppercase">
            <span className="rounded-full bg-[#17231b] px-4 py-2 text-white">
              {dashboard?.safety.environment ?? "STAGING"}
            </span>
            <span className="rounded-full bg-white/80 px-4 py-2">
              {dashboard?.safety.defaultMode ?? "DRY_RUN"}
            </span>
            <span className="rounded-full bg-[#ff6b35] px-4 py-2 text-white">
              Escrituras eBay: 0
            </span>
          </div>
        </header>

        {error && (
          <p className="mt-5 rounded-2xl border border-red-800/30 bg-red-100 p-4 font-mono text-sm text-red-900">
            {error}
          </p>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          {[
            ["Lotes recientes", dashboard?.runs.length ?? 0],
            ["Cuarentenas abiertas", dashboard?.quarantine.length ?? 0],
            ["Circuitos abiertos", dashboard?.circuits.length ?? 0],
            ["Publicaciones automaticas", "0"],
          ].map(([label, value]) => (
            <article key={label} className="rounded-3xl border border-[#17231b]/15 bg-white p-5">
              <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#516056]">
                {label}
              </p>
              <p className="mt-3 font-serif text-4xl font-black">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-3xl border border-[#17231b]/15 bg-white">
          <div className="border-b border-[#17231b]/10 p-6">
            <h2 className="font-serif text-3xl font-black">Operacion por lote</h2>
            <p className="mt-1 text-sm text-[#516056]">
              El producto original permanece en las metricas aunque una reserva ocupe su slot.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#17231b] font-mono text-xs uppercase text-white">
                <tr>
                  {["Fecha", "Estado", "Seleccionados", "Completados", "Holds",
                    "Cuarentena", "Reemplazos", "Efectos bloqueados"].map((label) => (
                    <th key={label} className="px-4 py-3">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(dashboard?.runs ?? []).map((run) => (
                  <tr key={run.run_id} className="border-b border-[#17231b]/10">
                    <td className="px-4 py-4 font-mono">{run.operation_date}</td>
                    <td className="px-4 py-4 font-bold">{run.status}</td>
                    <td className="px-4 py-4">{run.products_selected}</td>
                    <td className="px-4 py-4">{run.products_completed}</td>
                    <td className="px-4 py-4">{run.products_on_hold}</td>
                    <td className="px-4 py-4">{run.products_quarantined}</td>
                    <td className="px-4 py-4">{run.reserve_replacements}</td>
                    <td className="px-4 py-4">{run.effects_blocked_by_policy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border border-[#17231b]/15 bg-white p-6">
            <h2 className="font-serif text-3xl font-black">Cola de excepciones</h2>
            <div className="mt-5 space-y-4">
              {(dashboard?.quarantine ?? []).map((item) => (
                <article key={item.id} className="rounded-2xl bg-[#f2efe6] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-bold text-[#ff4f20]">
                        {item.sku ?? "SKU pendiente"} / {item.phase}
                      </p>
                      <h3 className="mt-2 font-bold">{item.error_code}</h3>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 font-mono text-xs">
                      {item.dependency}
                    </span>
                  </div>
                  <p className="mt-3 text-sm"><strong>Impacto:</strong> {item.impact}</p>
                  <p className="mt-1 text-sm"><strong>Accion:</strong> {item.suggested_action}</p>
                  <button
                    type="button"
                    disabled={!item.replay_safe || busyId === item.id}
                    onClick={() => void replay(item)}
                    className="mt-4 rounded-full bg-[#17231b] px-4 py-2 font-mono text-xs font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {busyId === item.id ? "Reanudando..." : "Replay desde checkpoint"}
                  </button>
                </article>
              ))}
              {dashboard?.quarantine.length === 0 && (
                <p className="text-sm text-[#516056]">No hay excepciones abiertas.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[#17231b]/15 bg-[#17231b] p-6 text-white">
            <h2 className="font-serif text-3xl font-black">Dependencias</h2>
            <div className="mt-5 space-y-3">
              {(dashboard?.circuits ?? []).map((circuit) => (
                <article key={circuit.id} className="rounded-2xl border border-white/15 p-4">
                  <div className="flex justify-between gap-3">
                    <strong>{circuit.dependency}</strong>
                    <span className="font-mono text-xs text-[#d7ff45]">{circuit.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-white/70">
                    {circuit.failure_count} fallos / {circuit.last_error_code ?? "sin codigo"}
                  </p>
                </article>
              ))}
              {dashboard?.circuits.length === 0 && (
                <p className="text-sm text-white/60">Todos los circuitos estan cerrados.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
