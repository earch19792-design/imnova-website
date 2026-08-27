"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type Intake = {
  decisionPackageId: string
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

async function bearer() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return data.session.access_token
}

export function SmartStockingListingIntakeCard() {
  const [intake, setIntake] = useState<Intake | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const token = await bearer()
        const response = await fetch(
          "/api/admin/ebay/command-center?smartStockingCandidate=ITEM3525",
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        )
        const payload = await response.json() as {
          success?: boolean
          smartStockingListingIntake?: Intake
          error?: string
        }
        if (!response.ok || !payload.success || !payload.smartStockingListingIntake) {
          throw new Error(payload.error ?? "SMART_STOCKING_INTAKE_READ_FAILED")
        }
        if (active) setIntake(payload.smartStockingListingIntake)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message :
          "SMART_STOCKING_INTAKE_READ_FAILED")
      }
    })()
    return () => { active = false }
  }, [])

  async function completePackage() {
    if (!intake || intake.finalDecision !== "LISTING_READY") return
    if (intake.listingWorkspaceUrl) {
      window.location.assign(intake.listingWorkspaceUrl)
      return
    }
    setBusy(true)
    setError("")
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
        listingWorkspaceUrl?: string
        error?: string
      }
      if (!response.ok || !payload.success || !payload.listingWorkspaceUrl) {
        throw new Error(payload.error ?? "SMART_STOCKING_INTAKE_WRITE_FAILED")
      }
      window.location.assign(payload.listingWorkspaceUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message :
        "SMART_STOCKING_INTAKE_WRITE_FAILED")
      setBusy(false)
    }
  }

  return <section data-smart-stocking-listing-intake className="mb-5 rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.06] p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Smart Stocking · paquete sin publicar</p>
    <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">ITEM3525 · Cake Turntable</h2>
        <p className="mt-1 text-xs text-slate-400">GTIN 740119084743 · single unit · ENTRY 57 preservado</p>
      </div>
      <span className="rounded-full border border-emerald-200/25 px-3 py-1 text-xs font-semibold text-emerald-100">{intake?.finalDecision ?? "VERIFICANDO"}</span>
    </div>
    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
      <p className="rounded-xl bg-black/20 p-3"><span className="block text-slate-500">Precio final</span><strong className="mt-1 block text-white">{intake?.finalPriceUsd === 25.99 ? "USD 25.99" : "Verificando"}</strong></p>
      <p className="rounded-xl bg-black/20 p-3"><span className="block text-slate-500">Autoridad</span><strong className="mt-1 block text-white">Decision Package + Product Truth</strong></p>
      <p className="rounded-xl bg-black/20 p-3"><span className="block text-slate-500">Publicación</span><strong className="mt-1 block text-white">Requiere aprobación humana</strong></p>
    </div>
    <button type="button" onClick={() => void completePackage()}
      disabled={busy || !intake || intake.finalDecision !== "LISTING_READY"}
      className="mt-3 min-h-12 w-full rounded-xl bg-emerald-200 px-4 font-semibold text-slate-950 disabled:opacity-40">
      {busy ? "Preparando intake…" : "Completar paquete"}
    </button>
    <p className="mt-2 text-[11px] text-slate-500">Abre el Listing Workspace existente para categoría/aspectos, imágenes, políticas y revisión final. No publica automáticamente.</p>
    {error ? <p role="alert" className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/10 p-2 text-xs text-rose-100">{error}</p> : null}
  </section>
}
