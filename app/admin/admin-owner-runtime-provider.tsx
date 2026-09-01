"use client"

import { createContext, useCallback, useContext, useEffect, useMemo,
  useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { supabase } from "@/lib/supabase"
import { LunaShippingCaptureControlPlane, type LunaShippingOwnerWorkerSnapshot }
  from "./ebay/luna-shipping-capture/luna-shipping-capture-control-plane"

export type OwnerRuntimeQuickPickSummary = Readonly<{
  inProgress: number
  readyForReview: number
  blocked: number
  total: number
}>

type OwnerRuntimeContextValue = Readonly<{
  lunaWorker: LunaShippingOwnerWorkerSnapshot
  quickPick: OwnerRuntimeQuickPickSummary
  quickPickAvailable: boolean
  quickPickReconciliationActive: boolean
}>

const EMPTY_SUMMARY: OwnerRuntimeQuickPickSummary = Object.freeze({
  inProgress: 0, readyForReview: 0, blocked: 0, total: 0,
})

const INITIAL_WORKER: LunaShippingOwnerWorkerSnapshot = Object.freeze({
  status: "CONNECTING",
  reasonCode: "OWNER_RUNTIME_INITIALIZING",
  connected: false,
  canonicalBindingReady: false,
  canonicalDestinationBound: false,
  autoClaimEnabled: true,
})

const OwnerRuntimeContext = createContext<OwnerRuntimeContextValue>({
  lunaWorker: INITIAL_WORKER,
  quickPick: EMPTY_SUMMARY,
  quickPickAvailable: false,
  quickPickReconciliationActive: false,
})

function count(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function useAdminOwnerRuntime() {
  return useContext(OwnerRuntimeContext)
}

export function AdminOwnerRuntimeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const runtimeRouteEligible = !pathname.startsWith("/admin/login") &&
    !pathname.startsWith("/admin/ebay/luna-shipping-capture")
  const quickPickPageOwnsPolling = pathname.startsWith("/admin/ebay/quick-pick")
  const [adminSessionReady, setAdminSessionReady] = useState(false)
  const [lunaWorker, setLunaWorker] = useState(INITIAL_WORKER)
  const [quickPick, setQuickPick] = useState(EMPTY_SUMMARY)
  const [quickPickAvailable, setQuickPickAvailable] = useState(false)
  const [quickPickReconciliationActive, setQuickPickReconciliationActive] =
    useState(false)
  const runtimeEnabled = runtimeRouteEligible && adminSessionReady

  useEffect(() => {
    let active = true
    if (!runtimeRouteEligible) {
      setAdminSessionReady(false)
      return () => { active = false }
    }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) setAdminSessionReady(!error && Boolean(data.session))
    }).catch(() => { if (active) setAdminSessionReady(false) })
    return () => { active = false }
  }, [runtimeRouteEligible])

  const reconcileQuickPicks = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error("ADMIN_AUTH_REQUIRED")
    const response = await fetch("/api/admin/ebay/luna-quick-pick", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    })
    const payload = await response.json()
    if (!response.ok || payload.success !== true) {
      throw new Error("QUICK_PICK_RECONCILIATION_UNAVAILABLE")
    }
    const summary = record(payload.summary)
    setQuickPick({
      inProgress: count(summary.inProgress),
      readyForReview: count(summary.readyForReview),
      blocked: count(summary.blocked),
      total: count(summary.total),
    })
    setQuickPickAvailable(true)
    setQuickPickReconciliationActive(true)
  }, [])

  useEffect(() => {
    if (!runtimeEnabled || quickPickPageOwnsPolling) return
    let active = true
    void reconcileQuickPicks().catch(() => {
      if (active) setQuickPickAvailable(false)
    })
    const timer = window.setInterval(() => {
      if (active) void reconcileQuickPicks().catch(() => undefined)
    }, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [quickPickPageOwnsPolling, reconcileQuickPicks, runtimeEnabled])

  const value = useMemo(() => ({ lunaWorker, quickPick,
    quickPickAvailable, quickPickReconciliationActive }),
  [lunaWorker, quickPick, quickPickAvailable,
    quickPickReconciliationActive])

  return <OwnerRuntimeContext.Provider value={value}>
    {runtimeEnabled ? <LunaShippingCaptureControlPlane runtimeOnly
      onWorkerSnapshot={setLunaWorker} /> : null}
    {children}
  </OwnerRuntimeContext.Provider>
}
