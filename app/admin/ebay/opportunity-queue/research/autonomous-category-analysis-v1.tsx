"use client"

import { useState } from "react"

import { supabase } from "@/lib/supabase"

type JsonRecord = Record<string, unknown>
type CategoryCandidate = JsonRecord & {
  decision?: string
  reasonCodes?: string[]
  candidate?: { productId?: string; variantId?: string; supplierSku?: string;
    supplierQuantity?: number }
  sourceIdentity?: { title?: string | null }
  offer?: { includedCount?: number | null }
  market?: { soldQuantity?: number | null;
    realizedBuyerLandedPrice?: number | null }
  economics?: { expectedNetProfit?: number | null }
  productTruth?: { autonomousIdentity?: { status?: string } }
  strategy?: { type?: string; sequence?: number }
  durableReceipt?: { receiptId?: string }
}
type CategoryResult = JsonRecord & {
  category?: string
  status?: string
  resultCount?: number | null
  productCount?: number | null
  packScenarioCount?: number | null
  screenedSourceCount?: number | null
  evaluatedProductCount?: number | null
  evaluationCount?: number | null
  qualifiedDraftCount?: number | null
  qualifiedDrafts?: Array<JsonRecord & { title?: string; price?: number;
    expectedNetProfit?: number; qualification?: string;
    draftReceiptId?: string; published?: boolean }>
  queuedEvidenceCount?: number | null
  queuedShippingCount?: number | null
  readyShippingCount?: number | null
  evidenceAcquisition?: JsonRecord[]
  nextAction?: string
  candidates?: CategoryCandidate[]
  deferredCandidates?: JsonRecord[]
  noSupportedPackReason?: string | null
  durableReceipt?: { receiptId?: string; createdAt?: string }
}

function money(value: number | null | undefined) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "No comprobado"
}

function decisionTone(value: string | undefined) {
  if (value === "GO") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
  if (value === "REJECT") return "border-rose-400/30 bg-rose-400/10 text-rose-200"
  return "border-amber-400/30 bg-amber-400/10 text-amber-100"
}

export function AutonomousCategoryAnalysisV1() {
  const [category, setCategory] = useState("Pet Supplies")
  const [targetNetProfit, setTargetNetProfit] = useState(4)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<CategoryResult | null>(null)

  async function run() {
    setRunning(true)
    setError("")
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (session.error || !token) throw new Error("OWNER_ADMIN_SESSION_REQUIRED")
      const response = await fetch(
        "/api/admin/ebay/autonomous-category-analysis", {
          method: "POST", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`,
            "Content-Type": "application/json" },
          body: JSON.stringify({ action: "RUN_STOCKING_BATCH", category,
            scanLimit: 100, targetDrafts: 10, targetNetProfit }),
        })
      const payload = await response.json() as {
        success?: boolean; result?: CategoryResult; error?: string }
      if (!response.ok || !payload.success || !payload.result) {
        throw new Error(payload.error ?? "AUTONOMOUS_CATEGORY_ANALYSIS_FAILED")
      }
      setResult(payload.result)
    } catch (caught) {
      setResult(null)
      setError(caught instanceof Error ? caught.message
        : "AUTONOMOUS_CATEGORY_ANALYSIS_FAILED")
    } finally {
      setRunning(false)
    }
  }

  return <section data-autonomous-category-analysis-v1
    className="mb-5 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.07] to-[#0b1826] p-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[240px] flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Lote autónomo · unidad primero
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Primeros 10 borradores calificados
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Seller OS revisa hasta 100 candidatos, exige al menos $4 netos y solo
          prueba packs respaldados por ventas. Si falta evidencia, la solicita
          automáticamente. Crea borradores internos; no publica ni compra.
        </p>
      </div>
      <label className="text-xs text-slate-400">Categoría
        <input value={category} onChange={(event) => setCategory(event.target.value)}
          maxLength={100}
          className="mt-1.5 block w-56 rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm text-white" />
      </label>
      <label className="text-xs text-slate-400">Ganancia mínima
        <input type="number" min={4} max={10000} step="0.01"
          value={targetNetProfit}
          onChange={(event) => setTargetNetProfit(Number(event.target.value))}
          className="mt-1.5 block w-32 rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm text-white" />
      </label>
      <button type="button" onClick={() => void run()}
        disabled={running || !category.trim() || targetNetProfit < 4}
        className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {running ? "Preparando lote…" : "Buscar 10 borradores"}
      </button>
    </div>

    {error ? <p role="alert"
      className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
      {error}
    </p> : null}

    {result ? <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {[["Estado", result.status ?? "UNPROVEN"],
          ["Revisados", result.screenedSourceCount ?? result.productCount ?? "—"],
          ["Evaluados", result.evaluationCount ?? result.resultCount ?? "—"],
          ["Borradores", `${result.qualifiedDraftCount ?? 0}/10`],
          ["Packs probados", result.packScenarioCount ?? "—"],
          ["Investigación", result.queuedEvidenceCount ?? 0],
          ["Envíos Luna", `${result.queuedShippingCount ?? 0} pendientes · ${result.readyShippingCount ?? 0} listos`]]
          .map(([label, value]) => <article key={label}
            className="rounded-xl border border-white/[0.07] bg-[#07111d]/70 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 break-all text-xs font-medium text-slate-100">{String(value)}</p>
          </article>)}
      </div>

      {(result.qualifiedDrafts ?? []).length ? <div className="space-y-2">
        <h3 className="text-sm font-semibold text-emerald-200">
          Borradores internos calificados
        </h3>
        {(result.qualifiedDrafts ?? []).map((draft, index) => <article
          key={draft.draftReceiptId ?? index}
          className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] p-3">
          <p className="text-sm font-medium text-white">{draft.title ?? "Borrador calificado"}</p>
          <p className="mt-1 text-xs text-emerald-100/80">
            {draft.qualification ?? "CALIFICADO"} · Precio {money(draft.price)} · Ganancia {money(draft.expectedNetProfit)} · No publicado
          </p>
        </article>)}
      </div> : null}

      {result.nextAction ? <p className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-3 text-xs text-cyan-100/80">
        Siguiente acción automática: {result.nextAction}
      </p> : null}

      <div className="space-y-2">
        {(result.candidates ?? []).map((candidate, index) => {
          const reasons = candidate.reasonCodes ?? []
          const quantity = candidate.candidate?.supplierQuantity ?? 1
          return <article key={candidate.durableReceipt?.receiptId ?? index}
            className="rounded-xl border border-white/[0.08] bg-[#07111d]/75 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {candidate.sourceIdentity?.title ?? candidate.candidate?.supplierSku ?? "Producto sin título comprobado"}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {candidate.strategy?.type === "SINGLE_UNIT" ? "Unidad" : `Pack · ${quantity} unidades de proveedor`}
                  {candidate.offer?.includedCount ? ` · ${candidate.offer.includedCount} piezas incluidas` : ""}
                  {candidate.candidate?.supplierSku ? ` · SKU ${candidate.candidate.supplierSku}` : ""}
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${decisionTone(candidate.decision)}`}>
                {candidate.decision ?? "UNPROVEN"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
              <p><span className="text-slate-500">Ventas:</span> {candidate.market?.soldQuantity ?? "No comprobado"}</p>
              <p><span className="text-slate-500">Precio mercado:</span> {money(candidate.market?.realizedBuyerLandedPrice)}</p>
              <p><span className="text-slate-500">Ganancia:</span> {money(candidate.economics?.expectedNetProfit)}</p>
              <p><span className="text-slate-500">Identidad:</span> {candidate.productTruth?.autonomousIdentity?.status ?? "UNPROVEN"}</p>
              <p><span className="text-slate-500">Bloqueos:</span> {reasons.length}</p>
            </div>
            {reasons.length ? <p className="mt-2 break-words text-[11px] leading-5 text-amber-100/80">
              {reasons.join(" · ")}
            </p> : null}
          </article>
        })}
      </div>
      {result.noSupportedPackReason ? <p className="text-xs text-slate-400">
        Packs: {result.noSupportedPackReason}
      </p> : null}
    </div> : null}
  </section>
}
