"use client"

import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Link2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

const ENDPOINT = "/api/admin/ebay/luna-supplier-linkage-review"

type Decision =
  | "APPROVE_EXACT_LINKAGE"
  | "REJECT_CANDIDATE"
  | "KEEP_UNPROVEN"

type ReviewComponent = {
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  productTitle: string | null
  variantTitle: string | null
  supplierQuantityRequired: number
  quantityBasis: string
  variantPresence: string
}

type ReviewEntry = {
  currentCohortId: string
  ebayItemId: string
  ebaySku: string | null
  listingTitle: string | null
  classification: string
  linkageMode: string
  linkageId: string | null
  components: ReviewComponent[]
  supplierQuantityRequired: number | null
  matchSignals: string[]
  conflictSignals: string[]
  evidenceReferences: string[]
  evidenceObservedAt: string
  evidenceExpiresAt: string
  evidenceDigest: string
  evidenceFreshness: string
  decisionWindowStatus: string
  decisionVersion: number
  allowedOperatorDecisions: Decision[]
  recommendedSafeDecision: "KEEP_UNPROVEN"
  approvalEligibility: {
    eligible: boolean
    reasonCodes: string[]
  }
  latestDecision: {
    decision: Decision
    decisionVersion: number
    decisionAt: string
  } | null
  stockCertification: {
    status: "NOT_EVALUATED"
    automaticPauseAllowed: false
  }
}

type ReviewPayload = {
  success?: boolean
  error?: string
  observedAt?: string
  reviewSet?: {
    reviewSetId: string
    currentCohortId: string
    currentLiveCount: number
    reviewSetDigest: string
    bounded: boolean
    entries: ReviewEntry[]
  }
  csrf?: {
    csrfToken: string
    expiresAt: string
    singleUse: boolean
  }
}

async function adminToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return data.session.access_token
}

function decisionLabel(decision: Decision) {
  if (decision === "APPROVE_EXACT_LINKAGE") return "Aprobar enlace exacto"
  if (decision === "REJECT_CANDIDATE") return "Rechazar candidato"
  return "Mantener sin probar"
}

export default function LunaSupplierLinkageReviewPage() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState("")
  const [busyItem, setBusyItem] = useState("")
  const [notice, setNotice] = useState("")

  const refresh = useCallback(async () => {
    try {
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}` },
      })
      const result = await response.json() as ReviewPayload
      if (!response.ok || !result.success || !result.reviewSet ||
          !result.csrf?.csrfToken) {
        throw new Error(result.error ?? "LUNA_LINKAGE_REVIEW_READ_FAILED")
      }
      setPayload(result)
      setError("")
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_LINKAGE_REVIEW_READ_FAILED")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const decide = useCallback(async (entry: ReviewEntry, decision: Decision) => {
    const reviewSet = payload?.reviewSet
    const csrfToken = payload?.csrf?.csrfToken
    if (!reviewSet || !csrfToken ||
        !entry.allowedOperatorDecisions.includes(decision)) return
    const confirmation = decision === "APPROVE_EXACT_LINKAGE"
      ? `Confirmas producto, variante y cantidades exactas para eBay ${entry.ebayItemId}?`
      : `Confirmas la decisión “${decisionLabel(decision)}” para eBay ${entry.ebayItemId}?`
    if (!window.confirm(confirmation)) return
    setBusyItem(entry.ebayItemId)
    setError("")
    setNotice("")
    try {
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Seller-OS-CSRF": csrfToken,
        },
        body: JSON.stringify({
          reviewSetId: reviewSet.reviewSetId,
          currentCohortId: reviewSet.currentCohortId,
          ebayItemId: entry.ebayItemId,
          candidateEvidenceDigest: entry.evidenceDigest,
          decision,
          decisionVersion: entry.decisionVersion,
        }),
      })
      const result = await response.json() as {
        success?: boolean
        error?: string
        receipt?: { idempotent?: boolean }
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "LUNA_LINKAGE_DECISION_FAILED")
      }
      setNotice(result.receipt?.idempotent
        ? "La misma decisión ya estaba registrada; replay idempotente."
        : "Decisión humana durable registrada.")
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_LINKAGE_DECISION_FAILED")
    } finally {
      setBusyItem("")
      await refresh()
    }
  }, [payload?.csrf?.csrfToken, payload?.reviewSet, refresh])

  const reviewSet = payload?.reviewSet

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/ebay/stock-guard"
          className="inline-flex items-center gap-2 text-xs font-bold text-cyan-800">
          <ArrowLeft size={14} /> Stock Guard
        </Link>
        <header className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Seller OS · P2-I01C
              </p>
              <h1 className="mt-1 text-2xl font-black">Revisión eBay → Luna</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Decisiones humanas ligadas al cohort, Item ID, digest de evidencia y versión.
                Esta superficie no consulta stock ni permite editar identidades Luna.
              </p>
            </div>
            <button type="button" onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-black hover:bg-slate-50">
              <RefreshCw size={14} /> Recargar review set
            </button>
          </div>

          {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <CircleAlert size={18} className="shrink-0" /> {error}
          </div>}
          {notice && <div className="mt-5 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            <CircleCheck size={18} className="shrink-0" /> {notice}
          </div>}

          {reviewSet && <dl className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Cohorte current-live</dt>
              <dd className="font-black">{reviewSet.currentLiveCount}</dd></div>
            <div><dt className="text-slate-500">Review set</dt>
              <dd className="break-all font-mono text-[10px]">{reviewSet.reviewSetId}</dd></div>
            <div><dt className="text-slate-500">Stock</dt>
              <dd className="font-black">NOT_EVALUATED</dd></div>
          </dl>}
        </header>

        {!reviewSet ? <p className="mt-6 text-sm text-slate-500">
          Cargando el review set current-live completo…
        </p> : <section className="mt-6 space-y-4" aria-label="Candidatos Luna">
          {reviewSet.entries.map((entry) => (
            <article key={entry.ebayItemId}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">eBay {entry.ebayItemId}</p>
                  <h2 className="mt-1 text-base font-black">{entry.listingTitle ?? "Sin título durable"}</h2>
                  <p className="mt-1 text-xs text-slate-500">SKU {entry.ebaySku ?? "UNAVAILABLE"}</p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-black text-cyan-800">{entry.classification}</p>
                  <p className={entry.decisionWindowStatus === "CURRENT"
                    ? "font-bold text-emerald-700" : "font-bold text-amber-700"}>
                    Evidencia {entry.decisionWindowStatus}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {entry.components.length === 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                  No existe un componente Luna exacto verificable.
                </div> : entry.components.map((component, index) => (
                  <div key={`${component.lunaProductId}:${component.lunaVariantId}:${index}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-black">Componente {index + 1}: {component.productTitle ?? component.lunaProductId}</p>
                    <p className="mt-1 text-slate-600">Variante: {component.variantTitle ?? component.lunaVariantId}</p>
                    <p className="text-slate-600">SKU Luna: {component.lunaSku}</p>
                    <p className="font-bold">Cantidad proveedor: {component.supplierQuantityRequired}</p>
                    <p className="text-xs text-slate-500">Base: {component.quantityBasis}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 text-xs md:grid-cols-2">
                <div><p className="font-black text-emerald-800">Señales de match</p>
                  <p className="mt-1 text-slate-600">{entry.matchSignals.join(" · ") || "Ninguna"}</p></div>
                <div><p className="font-black text-red-800">Conflictos</p>
                  <p className="mt-1 text-slate-600">{entry.conflictSignals.join(" · ") || "Ninguno"}</p></div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                {entry.allowedOperatorDecisions.map((decision) => (
                  <button type="button" key={decision}
                    disabled={Boolean(busyItem)}
                    onClick={() => void decide(entry, decision)}
                    className={decision === "APPROVE_EXACT_LINKAGE"
                      ? "rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                      : "rounded-lg border border-slate-300 px-3 py-2 text-xs font-black disabled:opacity-50"}>
                    {decisionLabel(decision)}
                  </button>
                ))}
                {entry.allowedOperatorDecisions.length === 0 &&
                  <p className="text-xs font-bold text-amber-700">
                    Revisión expirada o inválida: actualiza la evidencia.
                  </p>}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
                  <ShieldCheck size={13} /> CSRF single-use
                </span>
              </div>
              {entry.latestDecision && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-cyan-800">
                <Link2 size={13} /> Última decisión: {entry.latestDecision.decision}
                · v{entry.latestDecision.decisionVersion}
              </p>}
            </article>
          ))}
        </section>}
      </div>
    </main>
  )
}
