"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Intake = {
  decisionPackageId: string
  candidateKey: string
  supplierSku: string
  gtin: string
  productTitle: string
  finalDecision: string
  finalPriceUsd: number | null
  entryPotentialScore: number | null
  intakeMaterialized: boolean
  listingWorkspaceUrl: string | null
  publicationAuthorized: false
}

const CANDIDATES = Object.freeze([
  {
    supplierSku: "ITEM3404",
    candidateKey:
      "smart-stocking:EBAY_US:9220837146848:48809648488672",
    label: "Window Privacy Film",
  },
  {
    supplierSku: "ITEM3525",
    candidateKey:
      "smart-stocking:EBAY_US:9220835475680:48809646653664",
    label: "Cake Turntable",
  },
])

async function bearer() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return data.session.access_token
}

export function SmartStockingListingIntakeCard() {
  const [intakes, setIntakes] = useState<Record<string, Intake | null>>({})
  const [busySku, setBusySku] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const token = await bearer()
        const entries = await Promise.all(CANDIDATES.map(async (candidate) => {
          const response = await fetch(
            `/api/admin/ebay/command-center?smartStockingCandidate=${encodeURIComponent(candidate.supplierSku)}`,
            { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
          )
          const payload = await response.json() as {
            success?: boolean
            smartStockingListingIntake?: Intake
            error?: string
          }
          const intake = payload.smartStockingListingIntake
          if (!response.ok || !payload.success || !intake
            || intake.supplierSku !== candidate.supplierSku
            || intake.candidateKey !== candidate.candidateKey) {
            throw new Error(payload.error
              ?? "SMART_STOCKING_INTAKE_CONTEXT_MISMATCH")
          }
          return [candidate.supplierSku, intake] as const
        }))
        if (active) setIntakes(Object.fromEntries(entries))
      } catch (caught) {
        if (active) setErrors({ general: caught instanceof Error
          ? caught.message : "SMART_STOCKING_INTAKE_READ_FAILED" })
      }
    })()
    return () => { active = false }
  }, [])

  async function completePackage(candidate: typeof CANDIDATES[number]) {
    const intake = intakes[candidate.supplierSku]
    if (!intake || intake.finalDecision !== "LISTING_READY") return
    if (intake.candidateKey !== candidate.candidateKey) {
      setErrors((current) => ({ ...current,
        [candidate.supplierSku]: "SMART_STOCKING_INTAKE_CONTEXT_MISMATCH" }))
      return
    }
    if (intake.listingWorkspaceUrl) {
      window.location.assign(intake.listingWorkspaceUrl)
      return
    }
    setBusySku(candidate.supplierSku)
    setErrors((current) => ({ ...current, [candidate.supplierSku]: "" }))
    try {
      const token = await bearer()
      const response = await fetch("/api/admin/ebay/command-center", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`,
          "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare_smart_stocking_listing_intake",
          decisionPackageId: intake.decisionPackageId,
          supplierSku: intake.supplierSku,
        }),
      })
      const payload = await response.json() as {
        success?: boolean
        candidateKey?: string
        listingWorkspaceUrl?: string
        error?: string
      }
      if (!response.ok || !payload.success || !payload.listingWorkspaceUrl
        || payload.candidateKey !== candidate.candidateKey) {
        throw new Error(payload.error
          ?? "SMART_STOCKING_INTAKE_CONTEXT_MISMATCH")
      }
      window.location.assign(payload.listingWorkspaceUrl)
    } catch (caught) {
      setErrors((current) => ({ ...current,
        [candidate.supplierSku]: caught instanceof Error ? caught.message
          : "SMART_STOCKING_INTAKE_WRITE_FAILED" }))
      setBusySku("")
    }
  }

  return <section data-smart-stocking-listing-intake className="mb-5 rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.06] p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Smart Stocking · paquetes sin publicar</p>
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      {CANDIDATES.map((candidate) => {
        const intake = intakes[candidate.supplierSku]
        const error = errors[candidate.supplierSku]
        return <article key={candidate.supplierSku}
          data-smart-stocking-candidate={candidate.supplierSku}
          className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{candidate.supplierSku} · {candidate.label}</h2>
              <p className="mt-1 text-xs text-slate-400">{intake
                ? `GTIN ${intake.gtin} · ENTRY ${intake.entryPotentialScore ?? "N/D"}`
                : "Verificando identidad y decisión durable…"}</p>
            </div>
            <span className="rounded-full border border-emerald-200/25 px-3 py-1 text-xs font-semibold text-emerald-100">{intake?.finalDecision ?? "VERIFICANDO"}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <p className="rounded-xl bg-black/20 p-3"><span className="block text-slate-500">Precio final</span><strong className="mt-1 block text-white">{intake?.finalPriceUsd
              ? `USD ${intake.finalPriceUsd.toFixed(2)}` : "Verificando"}</strong></p>
            <p className="rounded-xl bg-black/20 p-3"><span className="block text-slate-500">Publicación</span><strong className="mt-1 block text-white">Requiere aprobación humana</strong></p>
          </div>
          <button type="button" onClick={() => void completePackage(candidate)}
            disabled={busySku === candidate.supplierSku || !intake
              || intake.finalDecision !== "LISTING_READY"}
            className="mt-3 min-h-12 w-full rounded-xl bg-emerald-200 px-4 font-semibold text-slate-950 disabled:opacity-40">
            {busySku === candidate.supplierSku ? "Preparando intake…" : "Completar paquete"}
          </button>
          {error ? <p role="alert" className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/10 p-2 text-xs text-rose-100">{error}</p> : null}
        </article>
      })}
    </div>
    <p className="mt-3 text-[11px] text-slate-500">Cada acción queda enlazada a candidato, oportunidad y paquete exactos. Abre el Listing Workspace existente; nunca publica automáticamente.</p>
    {errors.general ? <p role="alert" className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/10 p-2 text-xs text-rose-100">{errors.general}</p> : null}
  </section>
}
