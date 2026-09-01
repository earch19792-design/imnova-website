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

export type OwnerRuntimeQuickPickStageState = "WAITING" | "RUNNING" |
  "PASS" | "BLOCKED"

export type OwnerRuntimeQuickPickCard = Readonly<{
  sourceUrl: string
  sourceSku: string | null
  title: string | null
  candidateKey: string | null
  state: "WAITING" | "RUNNING" | "BLOCKED" | "READY"
  disposition: string
  lastStage: string
  exactBlocker: string | null
  stages: Readonly<Record<string, OwnerRuntimeQuickPickStageState>>
}>

export type OwnerRuntimeQuickPickReceipt = Readonly<{
  batchId: string
  ownerReference: string
  status: string
  rawInputCount: number | null
  durableOperationCount: number | null
  unprovenInputCount: number | null
}>

type OwnerRuntimeContextValue = Readonly<{
  lunaWorker: LunaShippingOwnerWorkerSnapshot
  quickPick: OwnerRuntimeQuickPickSummary
  quickPickCards: readonly OwnerRuntimeQuickPickCard[]
  quickPickReceipt: OwnerRuntimeQuickPickReceipt | null
  quickPickAvailable: boolean
  quickPickReconciliationActive: boolean
  refreshQuickPicks: () => Promise<void>
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
  quickPickCards: Object.freeze([]),
  quickPickReceipt: null,
  quickPickAvailable: false,
  quickPickReconciliationActive: false,
  refreshQuickPicks: async () => undefined,
})

function count(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function nullableCount(value: unknown) {
  const parsed = Number(value)
  return value !== null && value !== undefined && Number.isSafeInteger(parsed) &&
    parsed >= 0 ? parsed : null
}

function nullableText(value: unknown, maximum = 300) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function stageState(value: unknown): OwnerRuntimeQuickPickStageState {
  const normalized = String(value ?? "WAITING").toUpperCase()
  return new Set<OwnerRuntimeQuickPickStageState>(["WAITING", "RUNNING",
    "PASS", "BLOCKED"]).has(normalized as OwnerRuntimeQuickPickStageState)
    ? normalized as OwnerRuntimeQuickPickStageState : "WAITING"
}

export function parseOwnerRuntimeQuickPickCard(value: unknown):
  OwnerRuntimeQuickPickCard | null {
  const item = record(value)
  const sourceUrl = nullableText(item.sourceUrl, 2_000)
  if (!sourceUrl) return null
  const rawStages = record(item.stages)
  const stages = Object.fromEntries(Object.entries(rawStages).map(
    ([key, state]) => [key, stageState(state)]))
  const state = String(item.state ?? "WAITING").toUpperCase()
  return Object.freeze({ sourceUrl,
    sourceSku: nullableText(item.sourceSku, 160),
    title: nullableText(item.title, 400),
    candidateKey: nullableText(item.candidateKey, 160),
    state: new Set(["WAITING", "RUNNING", "BLOCKED", "READY"]).has(state)
      ? state as OwnerRuntimeQuickPickCard["state"] : "WAITING",
    disposition: nullableText(item.disposition, 160) ?? "WAITING",
    lastStage: nullableText(item.lastStage, 160) ?? "IDENTITY",
    exactBlocker: nullableText(item.exactBlocker, 200),
    stages: Object.freeze(stages) })
}

export function parseOwnerRuntimeQuickPickReceipt(value: unknown):
  OwnerRuntimeQuickPickReceipt | null {
  const item = record(value)
  const ownerReference = nullableText(item.ownerReference, 40)
  if (!ownerReference) return null
  return Object.freeze({ batchId: nullableText(item.batchId, 80) ?? "",
    ownerReference, status: nullableText(item.status, 80) ?? "UNPROVEN",
    rawInputCount: nullableCount(item.rawInputCount),
    durableOperationCount: nullableCount(item.durableOperationCount),
    unprovenInputCount: nullableCount(item.unprovenInputCount) })
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
  const [quickPickCards, setQuickPickCards] = useState<
    readonly OwnerRuntimeQuickPickCard[]>([])
  const [quickPickReceipt, setQuickPickReceipt] =
    useState<OwnerRuntimeQuickPickReceipt | null>(null)
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
    setQuickPickCards((Array.isArray(payload.progress) ? payload.progress : [])
      .flatMap((value: unknown) => {
        const parsed = parseOwnerRuntimeQuickPickCard(value)
        return parsed ? [parsed] : []
      }))
    setQuickPickReceipt(parseOwnerRuntimeQuickPickReceipt(payload.receipt))
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
    }, 2_500)
    return () => { active = false; window.clearInterval(timer) }
  }, [quickPickPageOwnsPolling, reconcileQuickPicks, runtimeEnabled])

  const value = useMemo(() => ({ lunaWorker, quickPick, quickPickCards,
    quickPickReceipt, quickPickAvailable, quickPickReconciliationActive,
    refreshQuickPicks: reconcileQuickPicks }),
  [lunaWorker, quickPick, quickPickCards, quickPickReceipt,
    quickPickAvailable, quickPickReconciliationActive, reconcileQuickPicks])

  return <OwnerRuntimeContext.Provider value={value}>
    {runtimeEnabled ? <LunaShippingCaptureControlPlane runtimeOnly
      onWorkerSnapshot={setLunaWorker} /> : null}
    {children}
  </OwnerRuntimeContext.Provider>
}
