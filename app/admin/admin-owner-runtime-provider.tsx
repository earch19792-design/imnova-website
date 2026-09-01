"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef,
  useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { supabase } from "@/lib/supabase"
import { mergeSellerOsQuickPickPresentationV1 } from
  "@/lib/ebay/seller-os-quick-pick-presentation-v1"
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
export type OwnerRuntimeQuickPickReadState = "REFRESHING" | "STABLE" |
  "READ_RETRYING"

export type OwnerRuntimeQuickPickCard = Readonly<{
  sourceUrl: string
  canonicalUrl: string | null
  sourceSku: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  opportunityId: string | null
  listingPackageId: string | null
  title: string | null
  candidateKey: string | null
  state: "WAITING" | "RUNNING" | "BLOCKED" | "READY"
  disposition: string
  lastStage: string
  exactBlocker: string | null
  exactBlockers: readonly string[]
  requiredItemSpecificsCount: number | null
  requiredItemSpecificsSatisfied: number | null
  requiredItemSpecificsReady: boolean | null
  unresolvedRequiredAspects: readonly string[]
  conditionReady: boolean | null
  automaticResolutionExhausted: boolean
  exactUnresolvedFields: readonly string[]
  ownerResidualActions: readonly Readonly<{
    productField: string
    bestProposal: string | null
    proposalEvidence: string
    confidence: string
    ownerAction: "CONFIRM" | "ENTER_FACT"
  }>[]
  nextOwnerAction: "CONFIRM" | "ENTER_FACT" | null
  listingReview: Readonly<Record<string, unknown>> | null
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
  quickPickReadState: OwnerRuntimeQuickPickReadState
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
  quickPickReadState: "REFRESHING",
  quickPickReconciliationActive: false,
  refreshQuickPicks: async () => undefined,
})

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

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null
}

function boundedTextList(value: unknown, maximumItems = 20,
  maximumLength = 160) {
  return Object.freeze([...new Set((Array.isArray(value) ? value : [])
    .flatMap((entry) => {
      const parsed = nullableText(entry, maximumLength)
      return parsed ? [parsed] : []
    }))].slice(0, maximumItems))
}

function stageState(value: unknown): OwnerRuntimeQuickPickStageState {
  const normalized = String(value ?? "WAITING").toUpperCase()
  return new Set<OwnerRuntimeQuickPickStageState>(["WAITING", "RUNNING",
    "PASS", "BLOCKED"]).has(normalized as OwnerRuntimeQuickPickStageState)
    ? normalized as OwnerRuntimeQuickPickStageState : "WAITING"
}

function ownerResidualActions(value: unknown) {
  return Object.freeze((Array.isArray(value) ? value : []).flatMap((entry) => {
    const action = record(entry)
    const productField = nullableText(action.productField, 120)
    const ownerAction = String(action.ownerAction ?? "")
    if (!productField || !["CONFIRM", "ENTER_FACT"].includes(ownerAction)) {
      return []
    }
    return [Object.freeze({ productField,
      bestProposal: nullableText(action.bestProposal, 300),
      proposalEvidence: nullableText(action.proposalEvidence, 500)
        ?? "AUTOMATIC_EVIDENCE_CASCADE_EXHAUSTED",
      confidence: nullableText(action.confidence, 20) ?? "LOW",
      ownerAction: ownerAction as "CONFIRM" | "ENTER_FACT" })]
  }).slice(0, 20))
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
    canonicalUrl: nullableText(item.canonicalUrl, 2_000),
    sourceSku: nullableText(item.sourceSku, 160),
    lunaProductId: nullableText(item.lunaProductId, 100),
    lunaVariantId: nullableText(item.lunaVariantId, 100),
    opportunityId: nullableText(item.opportunityId, 100),
    listingPackageId: nullableText(item.listingPackageId, 100),
    title: nullableText(item.title, 400),
    candidateKey: nullableText(item.candidateKey, 160),
    state: new Set(["WAITING", "RUNNING", "BLOCKED", "READY"]).has(state)
      ? state as OwnerRuntimeQuickPickCard["state"] : "WAITING",
    disposition: nullableText(item.disposition, 160) ?? "WAITING",
    lastStage: nullableText(item.lastStage, 160) ?? "IDENTITY",
    exactBlocker: nullableText(item.exactBlocker, 200),
    exactBlockers: boundedTextList(item.exactBlockers ??
      (item.exactBlocker ? [item.exactBlocker] : [])),
    requiredItemSpecificsCount:
      nullableCount(item.requiredItemSpecificsCount),
    requiredItemSpecificsSatisfied:
      nullableCount(item.requiredItemSpecificsSatisfied),
    requiredItemSpecificsReady:
      nullableBoolean(item.requiredItemSpecificsReady),
    unresolvedRequiredAspects:
      boundedTextList(item.unresolvedRequiredAspects),
    conditionReady: nullableBoolean(item.conditionReady),
    automaticResolutionExhausted:
      item.automaticResolutionExhausted === true,
    exactUnresolvedFields: boundedTextList(item.exactUnresolvedFields),
    ownerResidualActions: ownerResidualActions(item.ownerResidualActions),
    nextOwnerAction: ["CONFIRM", "ENTER_FACT"].includes(
      String(item.nextOwnerAction ?? ""))
      ? item.nextOwnerAction as "CONFIRM" | "ENTER_FACT" : null,
    listingReview: Object.keys(record(item.listingReview)).length
      ? Object.freeze(record(item.listingReview)) : null,
    stages: Object.freeze(stages) })
}

export function mergeOwnerRuntimeQuickPickCards(
  ...collections: readonly (readonly OwnerRuntimeQuickPickCard[])[]) {
  return mergeSellerOsQuickPickPresentationV1(...collections)
}

function parseQuickPickSummary(value: unknown,
  cards: readonly OwnerRuntimeQuickPickCard[]) {
  const item = record(value)
  const values = [item.inProgress, item.readyForReview, item.blocked, item.total]
    .map(nullableCount)
  if (values.some((entry) => entry === null)) return null
  return Object.freeze({
    inProgress: cards.filter((card) => card.state === "RUNNING").length,
    readyForReview: cards.filter((card) => card.state === "READY").length,
    blocked: cards.filter((card) => card.state === "BLOCKED").length,
    total: cards.length,
  })
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
  const [quickPickReadState, setQuickPickReadState] =
    useState<OwnerRuntimeQuickPickReadState>("REFRESHING")
  const [quickPickReconciliationActive, setQuickPickReconciliationActive] =
    useState(false)
  const quickPickRequest = useRef<Promise<void> | null>(null)
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

  const reconcileQuickPicks = useCallback(() => {
    if (quickPickRequest.current) return quickPickRequest.current
    setQuickPickReadState("REFRESHING")
    const request = (async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session) throw new Error("ADMIN_AUTH_REQUIRED")
        const response = await fetch("/api/admin/ebay/luna-quick-pick", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        })
        const payload = await response.json()
        if (!response.ok || payload.success !== true ||
            !Array.isArray(payload.progress)) {
          throw new Error("QUICK_PICK_RECONCILIATION_UNAVAILABLE")
        }
        const cards = mergeOwnerRuntimeQuickPickCards(
          payload.progress.flatMap((value: unknown) => {
            const parsed = parseOwnerRuntimeQuickPickCard(value)
            return parsed ? [parsed] : []
          }))
        const summary = parseQuickPickSummary(payload.summary, cards)
        if (!summary) {
          throw new Error("QUICK_PICK_RECONCILIATION_INVALID_SUMMARY")
        }
        setQuickPick(summary)
        setQuickPickCards(cards)
        const receipt = parseOwnerRuntimeQuickPickReceipt(payload.receipt)
        if (receipt) setQuickPickReceipt(receipt)
        setQuickPickAvailable(true)
        setQuickPickReadState("STABLE")
      } catch (error) {
        setQuickPickReadState("READ_RETRYING")
        throw error
      }
    })()
    quickPickRequest.current = request.finally(() => {
      quickPickRequest.current = null
    })
    return quickPickRequest.current
  }, [])

  useEffect(() => {
    if (!runtimeEnabled || quickPickPageOwnsPolling) return
    let active = true
    setQuickPickReconciliationActive(true)
    void reconcileQuickPicks().catch(() => undefined)
    const timer = window.setInterval(() => {
      if (active) void reconcileQuickPicks().catch(() => undefined)
    }, 2_500)
    return () => { active = false; setQuickPickReconciliationActive(false)
      window.clearInterval(timer) }
  }, [quickPickPageOwnsPolling, reconcileQuickPicks, runtimeEnabled])

  const value = useMemo(() => ({ lunaWorker, quickPick, quickPickCards,
    quickPickReceipt, quickPickAvailable, quickPickReadState,
    quickPickReconciliationActive,
    refreshQuickPicks: reconcileQuickPicks }),
  [lunaWorker, quickPick, quickPickCards, quickPickReceipt,
    quickPickAvailable, quickPickReadState, quickPickReconciliationActive,
    reconcileQuickPicks])

  return <OwnerRuntimeContext.Provider value={value}>
    {runtimeEnabled ? <LunaShippingCaptureControlPlane runtimeOnly
      onWorkerSnapshot={setLunaWorker} /> : null}
    {children}
  </OwnerRuntimeContext.Provider>
}
