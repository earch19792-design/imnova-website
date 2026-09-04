"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef,
  useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { validateSellerOsSession } from "@/lib/admin-auth"
import { supabase } from "@/lib/supabase"
import {
  SELLER_OS_ACCESS_ROLES,
} from "@/lib/seller-os-access-control"
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
  "READ_FAILED"

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
  processingLifecycle: "ACTIVE" | "COMPLETED"
  commercialStage: string
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
  overnightEnrichmentPending: boolean
  overnightEnrichmentStatus: string | null
  overnightEnrichmentLastRunAt: string | null
  stages: Readonly<Record<string, OwnerRuntimeQuickPickStageState>>
}>

export type OwnerRuntimeQuickPickOvernightSummary = Readonly<{
  observedAt: string | null
  enrichedCount: number
  readyAfterCount: number
  ownerConfirmationRequiredCount: number
  ownerFactRequiredCount: number
  outcomes: readonly Readonly<{
    sourceSku: string | null
    productTitle: string | null
    beforeStatus: string
    afterStatus: string
    fieldsResolvedOvernight: readonly string[]
    demandEvidenceAdded: boolean
    listingIntelligenceUpdated: boolean
    ownerActionRequired: "CONFIRM" | "ENTER_FACT" | null
  }>[]
}>

export type OwnerRuntimeNightWorkOrigin = Readonly<{
  classification: "MANUAL_LUNA_BATCH" | "RADAR_HANDOFF" |
    "OTHER_PROVEN_ORIGIN" | "UNPROVEN"
  label: string
  batchReference: string | null
  opportunityCaseId: string | null
  radarFamilyId: string | null
  radarObservationId: string | null
  identityClass: string | null
}>

export type OwnerRuntimeNightWorkProvenance = Readonly<{
  observedAt: string | null
  outcomes: readonly Readonly<{
    operationId: string
    sourceSku: string | null
    productTitle: string | null
    origin: OwnerRuntimeNightWorkOrigin
    processor: string
    enrichmentSource: string
    resolutionSource: string
    fieldsResolvedDuringSnapshot: readonly string[]
    blockerBefore: string
    blockerAfter: string
    persistentBlockingFields: readonly string[]
    historicalAction: string
    currentCanonicalState: string
    currentAction: string
    currentResolutions: readonly Readonly<{
      specificName: string
      resolvedValue: string | null
      resolutionSource: string
      sourceAuthority: string | null
    }>[]
    factInvented: boolean
  }>[]
  currentOperations: readonly Readonly<{
    operationId: string
    sourceSku: string | null
    productTitle: string | null
    origin: OwnerRuntimeNightWorkOrigin
    processor: string
    currentCanonicalState: string
    currentAction: string
  }>[]
  morningSummary: Readonly<{
    linksReceived: number | null
    processedDuringDay: number | null
    processedAtNight: number
    radarEnrichedCount: number
    noNewRadarEvidenceCount: number
    blockersResolvedByRadarCount: number
    blockersResolvedByOtherSystemCount: number
    ownerFactsRemainingCount: number
    marketTestReadyCount: number
  }>
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
  quickPickCurrentBatch: OwnerRuntimeQuickPickSummary | null
  quickPickAvailable: boolean
  quickPickReadState: OwnerRuntimeQuickPickReadState
  quickPickReconciliationActive: boolean
  overnightEnrichment: OwnerRuntimeQuickPickOvernightSummary | null
  nightWorkProvenance: OwnerRuntimeNightWorkProvenance | null
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
  quickPickCurrentBatch: null,
  quickPickAvailable: false,
  quickPickReadState: "REFRESHING",
  quickPickReconciliationActive: false,
  overnightEnrichment: null,
  nightWorkProvenance: null,
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
    processingLifecycle: item.processingLifecycle === "ACTIVE" ||
        (item.processingLifecycle === undefined && state === "RUNNING" &&
          Object.values(stages).some((value) => value === "RUNNING"))
      ? "ACTIVE" : "COMPLETED",
    commercialStage: nullableText(item.commercialStage, 160) ??
      nullableText(item.disposition, 160) ?? "WAITING",
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
    overnightEnrichmentPending: item.overnightEnrichmentPending === true,
    overnightEnrichmentStatus:
      nullableText(item.overnightEnrichmentStatus, 120),
    overnightEnrichmentLastRunAt:
      nullableText(item.overnightEnrichmentLastRunAt, 80),
    stages: Object.freeze(stages) })
}

export function parseOwnerRuntimeQuickPickOvernightSummary(value: unknown):
  OwnerRuntimeQuickPickOvernightSummary | null {
  const item = record(value)
  if (item.contractVersion !== "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1") {
    return null
  }
  const outcomes = Object.freeze((Array.isArray(item.outcomes)
    ? item.outcomes : []).flatMap((value) => {
    const outcome = record(value)
    const beforeStatus = nullableText(outcome.beforeStatus, 120)
    const afterStatus = nullableText(outcome.afterStatus, 120)
    if (!beforeStatus || !afterStatus) return []
    const action = String(outcome.ownerActionRequired ?? "")
    return [Object.freeze({ sourceSku: nullableText(outcome.sourceSku, 160),
      productTitle: nullableText(outcome.productTitle, 400), beforeStatus,
      afterStatus,
      fieldsResolvedOvernight: boundedTextList(
        outcome.fieldsResolvedOvernight),
      demandEvidenceAdded: outcome.demandEvidenceAdded === true,
      listingIntelligenceUpdated:
        outcome.listingIntelligenceUpdated === true,
      ownerActionRequired: ["CONFIRM", "ENTER_FACT"].includes(action)
        ? action as "CONFIRM" | "ENTER_FACT" : null })]
  }).slice(0, 20))
  return Object.freeze({ observedAt: nullableText(item.observedAt, 80),
    enrichedCount: nullableCount(item.enrichedCount) ?? 0,
    readyAfterCount: nullableCount(item.readyAfterCount) ?? 0,
    ownerConfirmationRequiredCount:
      nullableCount(item.ownerConfirmationRequiredCount) ?? 0,
    ownerFactRequiredCount: nullableCount(item.ownerFactRequiredCount) ?? 0,
    outcomes })
}

function parseNightWorkOrigin(value: unknown): OwnerRuntimeNightWorkOrigin {
  const item = record(value)
  const candidate = String(item.classification ?? "UNPROVEN")
  const classification = new Set(["MANUAL_LUNA_BATCH", "RADAR_HANDOFF",
    "OTHER_PROVEN_ORIGIN", "UNPROVEN"]).has(candidate)
    ? candidate as OwnerRuntimeNightWorkOrigin["classification"] : "UNPROVEN"
  return Object.freeze({ classification,
    label: nullableText(item.label, 120) ?? (classification === "RADAR_HANDOFF"
      ? "Radar" : classification === "MANUAL_LUNA_BATCH"
        ? "Links Luna" : "No demostrado"),
    batchReference: nullableText(item.batchReference, 60),
    opportunityCaseId: nullableText(item.opportunityCaseId, 160),
    radarFamilyId: nullableText(item.radarFamilyId, 180),
    radarObservationId: nullableText(item.radarObservationId, 180),
    identityClass: nullableText(item.identityClass, 20) })
}

export function parseOwnerRuntimeNightWorkProvenance(value: unknown):
  OwnerRuntimeNightWorkProvenance | null {
  const item = record(value)
  if (item.contractVersion !==
      "SELLER_OS_NIGHT_WORK_PROVENANCE_READ_MODEL_V1") return null
  const snapshot = record(item.historicalSnapshot)
  const outcomes = Object.freeze((Array.isArray(snapshot.outcomes)
    ? snapshot.outcomes : []).flatMap((value) => {
    const outcome = record(value)
    const operationId = nullableText(outcome.operationId, 100)
    const blockerBefore = nullableText(outcome.blockerBefore, 160)
    const blockerAfter = nullableText(outcome.blockerAfter, 160)
    const currentState = nullableText(outcome.currentCanonicalState, 160)
    const currentAction = nullableText(outcome.currentAction, 300)
    if (!operationId || !blockerBefore || !blockerAfter || !currentState ||
        !currentAction) return []
    const resolutions = Object.freeze((Array.isArray(
      outcome.currentResolutions) ? outcome.currentResolutions : [])
      .flatMap((value) => {
        const resolution = record(value)
        const specificName = nullableText(resolution.specificName, 120)
        const resolutionSource = nullableText(
          resolution.resolutionSource, 160)
        if (!specificName || !resolutionSource) return []
        return [Object.freeze({ specificName,
          resolvedValue: nullableText(resolution.resolvedValue, 300),
          resolutionSource,
          sourceAuthority: nullableText(resolution.sourceAuthority, 180) })]
      }))
    return [Object.freeze({ operationId,
      sourceSku: nullableText(outcome.sourceSku, 160),
      productTitle: nullableText(outcome.productTitle, 400),
      origin: parseNightWorkOrigin(outcome.origin),
      processor: nullableText(outcome.processor, 80) ?? "UNPROVEN",
      enrichmentSource: nullableText(outcome.enrichmentSource, 120) ??
        "UNPROVEN",
      resolutionSource: nullableText(outcome.resolutionSource, 120) ??
        "UNPROVEN",
      fieldsResolvedDuringSnapshot: boundedTextList(
        outcome.fieldsResolvedDuringSnapshot),
      blockerBefore, blockerAfter,
      persistentBlockingFields: boundedTextList(
        outcome.persistentBlockingFields),
      historicalAction: nullableText(outcome.historicalAction, 300) ??
        "Ninguna",
      currentCanonicalState: currentState, currentAction,
      currentResolutions: resolutions,
      factInvented: outcome.factInvented === true })]
  }))
  const currentOperations = Object.freeze((Array.isArray(item.currentOperations)
    ? item.currentOperations : []).flatMap((value) => {
    const operation = record(value)
    const operationId = nullableText(operation.operationId, 100)
    const state = nullableText(operation.currentCanonicalState, 160)
    const action = nullableText(operation.currentAction, 300)
    if (!operationId || !state || !action) return []
    return [Object.freeze({ operationId,
      sourceSku: nullableText(operation.sourceSku, 160),
      productTitle: nullableText(operation.productTitle, 400),
      origin: parseNightWorkOrigin(operation.origin),
      processor: nullableText(operation.processor, 80) ?? "UNPROVEN",
      currentCanonicalState: state, currentAction: action })]
  }))
  const morning = record(item.morningSummary)
  const metric = (name: string) => nullableCount(morning[name]) ?? 0
  return Object.freeze({ observedAt: nullableText(snapshot.observedAt, 80),
    outcomes, currentOperations,
    morningSummary: Object.freeze({
      linksReceived: nullableCount(record(morning.linksReceived).value),
      processedDuringDay:
        nullableCount(record(morning.processedDuringDay).value),
      processedAtNight:
        nullableCount(record(morning.processedAtNight).value) ?? 0,
      radarEnrichedCount: metric("radarEnrichedCount"),
      noNewRadarEvidenceCount: metric("noNewRadarEvidenceCount"),
      blockersResolvedByRadarCount: metric("blockersResolvedByRadarCount"),
      blockersResolvedByOtherSystemCount:
        metric("blockersResolvedByOtherSystemCount"),
      ownerFactsRemainingCount: metric("ownerFactsRemainingCount"),
      marketTestReadyCount: metric("marketTestReadyCount"),
    }) })
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
    inProgress: cards.filter((card) =>
      card.processingLifecycle === "ACTIVE").length,
    readyForReview: cards.filter((card) => card.state === "READY").length,
    blocked: cards.filter((card) => card.state === "BLOCKED").length,
    total: cards.length,
  })
}

function parseScopedQuickPickSummary(value: unknown) {
  const item = record(value)
  const values = [item.inProgress, item.readyForReview, item.blocked,
    item.total].map(nullableCount)
  if (values.some((entry) => entry === null)) return null
  return Object.freeze({ inProgress: values[0] as number,
    readyForReview: values[1] as number, blocked: values[2] as number,
    total: values[3] as number })
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
  const quickPickPageOwnsRead = pathname.startsWith("/admin/ebay/quick-pick")
  const [adminSessionReady, setAdminSessionReady] = useState(false)
  const [lunaWorker, setLunaWorker] = useState(INITIAL_WORKER)
  const [quickPick, setQuickPick] = useState(EMPTY_SUMMARY)
  const [quickPickCards, setQuickPickCards] = useState<
    readonly OwnerRuntimeQuickPickCard[]>([])
  const [quickPickReceipt, setQuickPickReceipt] =
    useState<OwnerRuntimeQuickPickReceipt | null>(null)
  const [quickPickCurrentBatch, setQuickPickCurrentBatch] =
    useState<OwnerRuntimeQuickPickSummary | null>(null)
  const [quickPickAvailable, setQuickPickAvailable] = useState(false)
  const [quickPickReadState, setQuickPickReadState] =
    useState<OwnerRuntimeQuickPickReadState>("REFRESHING")
  const [quickPickReconciliationActive, setQuickPickReconciliationActive] =
    useState(false)
  const [overnightEnrichment, setOvernightEnrichment] =
    useState<OwnerRuntimeQuickPickOvernightSummary | null>(null)
  const [nightWorkProvenance, setNightWorkProvenance] =
    useState<OwnerRuntimeNightWorkProvenance | null>(null)
  const quickPickRequest = useRef<Promise<void> | null>(null)
  const runtimeEnabled = runtimeRouteEligible && adminSessionReady

  useEffect(() => {
    let active = true
    if (!runtimeRouteEligible) {
      setAdminSessionReady(false)
      return () => { active = false }
    }
    void validateSellerOsSession().then((result) => {
      if (active) setAdminSessionReady(result.authorized &&
        result.role === SELLER_OS_ACCESS_ROLES.owner)
    }).catch(() => { if (active) setAdminSessionReady(false) })
    return () => { active = false }
  }, [runtimeRouteEligible])

  const reconcileQuickPicks = useCallback(() => {
    if (quickPickRequest.current) return quickPickRequest.current
    setQuickPickReadState("REFRESHING")
    setQuickPickReconciliationActive(true)
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
        const readModel = record(payload.readModel)
        const globalQueue = record(readModel.globalQueue)
        const globalCards = Array.isArray(globalQueue.cards)
          ? globalQueue.cards : payload.progress
        const cards = mergeOwnerRuntimeQuickPickCards(
          globalCards.flatMap((value: unknown) => {
            const parsed = parseOwnerRuntimeQuickPickCard(value)
            return parsed ? [parsed] : []
          }))
        const summary = parseQuickPickSummary(
          record(globalQueue).summary ?? payload.summary, cards)
        if (!summary) {
          throw new Error("QUICK_PICK_RECONCILIATION_INVALID_SUMMARY")
        }
        setQuickPick(summary)
        setQuickPickCards(cards)
        const receipt = parseOwnerRuntimeQuickPickReceipt(payload.receipt)
        if (receipt) setQuickPickReceipt(receipt)
        const selectedBatch = record(readModel.selectedBatch)
        setQuickPickCurrentBatch(parseScopedQuickPickSummary(
          selectedBatch.summary))
        const overnight = parseOwnerRuntimeQuickPickOvernightSummary(
          payload.overnightEnrichment)
        if (overnight) setOvernightEnrichment(overnight)
        setNightWorkProvenance(parseOwnerRuntimeNightWorkProvenance(
          payload.nightWorkProvenance))
        setQuickPickAvailable(true)
        setQuickPickReadState("STABLE")
      } catch (error) {
        setQuickPickReadState("READ_FAILED")
        throw error
      }
    })()
    quickPickRequest.current = request.finally(() => {
      quickPickRequest.current = null
      setQuickPickReconciliationActive(false)
    })
    return quickPickRequest.current
  }, [])

  useEffect(() => {
    if (!runtimeEnabled || quickPickPageOwnsRead) return
    void reconcileQuickPicks().catch(() => undefined)
    return () => undefined
  }, [quickPickPageOwnsRead, reconcileQuickPicks, runtimeEnabled])

  const value = useMemo(() => ({ lunaWorker, quickPick, quickPickCards,
    quickPickReceipt, quickPickCurrentBatch, quickPickAvailable,
    quickPickReadState,
    quickPickReconciliationActive, overnightEnrichment, nightWorkProvenance,
    refreshQuickPicks: reconcileQuickPicks }),
  [lunaWorker, quickPick, quickPickCards, quickPickReceipt,
    quickPickCurrentBatch,
    quickPickAvailable, quickPickReadState, quickPickReconciliationActive,
    overnightEnrichment, nightWorkProvenance, reconcileQuickPicks])

  return <OwnerRuntimeContext.Provider value={value}>
    {runtimeEnabled ? <LunaShippingCaptureControlPlane runtimeOnly
      onWorkerSnapshot={setLunaWorker} /> : null}
    {children}
  </OwnerRuntimeContext.Provider>
}
