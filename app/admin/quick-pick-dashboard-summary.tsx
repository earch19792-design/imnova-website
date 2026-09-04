"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import { startSellerOsVisibilityAwarePollingV1 } from
  "@/lib/seller-os-visibility-aware-polling-v1"

type Summary = Readonly<{
  inProgress: number
  readyForReview: number
  blocked: number
  total: number
}>

const empty: Summary = { inProgress: 0, readyForReview: 0, blocked: 0,
  total: 0 }

export function QuickPickDashboardSummary() {
  const [summary, setSummary] = useState<Summary>(empty)
  const [state, setState] = useState<"LOADING" | "READY" | "UNAVAILABLE">(
    "LOADING")
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error("ADMIN_AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/luna-quick-pick", {
      cache: "no-store", headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    })
    const payload = await response.json()
    if (!response.ok || payload.success !== true) {
      throw new Error("QUICK_PICK_SUMMARY_UNAVAILABLE")
    }
    setSummary(payload.summary ?? empty)
    setState("READY")
  }, [])
  useEffect(() => {
    let active = true
    const polling = startSellerOsVisibilityAwarePollingV1({
      task: async () => {
        try {
          await load()
        } catch {
          if (active) setState("UNAVAILABLE")
        }
      },
    })
    return () => { active = false; polling.stop() }
  }, [load])
  return <a href="/admin/ebay/quick-pick"
    className="block min-w-0 rounded-3xl border border-cyan-200/30 bg-cyan-200/[0.08] p-5 transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/65">Acción directa</p>
        <h2 className="mt-2 text-2xl font-black">⚡ Quick Pick Luna</h2></div>
      <span className="rounded-full bg-cyan-200 px-3 py-2 text-xs font-black text-black">ABRIR</span>
    </div>
    <p className="mt-2 text-sm leading-6 text-white/65">Pega links Luna y vuelve cuando quieras: Seller OS reconstruye cada operación desde su evidencia durable.</p>
    <dl aria-live="polite" className="mt-4 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-2xl bg-black/25 p-3"><dt className="text-xs text-white/50">En proceso</dt><dd className="mt-1 text-xl font-black">{state === "LOADING" ? "…" : state === "UNAVAILABLE" ? "—" : summary.inProgress}</dd></div>
      <div className="rounded-2xl bg-black/25 p-3"><dt className="text-xs text-white/50">Para revisar</dt><dd className="mt-1 text-xl font-black">{state === "LOADING" ? "…" : state === "UNAVAILABLE" ? "—" : summary.readyForReview}</dd></div>
      <div className="rounded-2xl bg-black/25 p-3"><dt className="text-xs text-white/50">Bloqueados</dt><dd className="mt-1 text-xl font-black">{state === "LOADING" ? "…" : state === "UNAVAILABLE" ? "—" : summary.blocked}</dd></div>
    </dl>
  </a>
}
