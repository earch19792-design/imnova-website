"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import { mergeSellerOsQuickPickPresentationV1 } from
  "@/lib/ebay/seller-os-quick-pick-presentation-v1"
import { QUICK_PICK_OWNER_STAGE_CATALOG_V1 } from
  "@/lib/ebay/seller-os-quick-pick-owner-read-model-v1"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type StageState = "WAITING" | "RUNNING" | "PASS" | "BLOCKED" | "CONTINUES"
type QuickPickReceipt = {
  batchId: string
  ownerReference: string
  status: string
  rawInputCount: number | null
  urlDedupedCount: number | null
  rejectedInputCount: number | null
  durableOperationCount: number | null
  exactProductCount: number | null
}
type QuickPickSummary = { inProgress: number; readyForReview: number
  blocked: number; waiting: number; total: number }
type PublisherCohort = {
  summary: { authoritativeReadyCount: number; visibleReadyCount: number
    actionableReadyCount: number; batchEligibleCount: number
    batchButtonN: number; preflightEligible: boolean
    exactMemberDigestsMatch: boolean
    falseDisabledReadyCount: number; trueBlockerCount: number }
  candidates: Array<{ candidateId: string; packageId: string
    sourceSku: string | null; title: string | null
    currentPackageDigest: string; batchEligible: boolean
    authorizationBinding: Record<string, unknown> | null
    lastPublisherStage: string; lastErrorClass: string | null
    batchRuntime: { status: string | null; stage: string | null
      result: string | null; retrySafety: string | null
      officialReadbackState: string | null; marketplaceWriteCount: number
      attemptCount: number; receiptDigest: string | null
      inProgress: boolean; published: boolean; blocked: boolean } }>
  source?: { apiSourceSha?: string | null; deploymentId?: string | null
    projection?: string | null }
}
type QuickPickCard = {
  sourceUrl: string
  canonicalUrl: string | null
  sourceSku: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  candidateId: string | null
  opportunityId: string | null
  candidateKey: string | null
  listingPackageId: string | null
  title: string | null
  state: "WAITING" | "RUNNING" | "BLOCKED" | "READY"
  lastStage: string
  disposition: string
  exactBlocker: string | null
  exactBlockers: string[]
  variantSelectionRequired: boolean
  variants: Array<{ lunaProductId: string; lunaVariantId: string
    supplierSku: string; title: string; available: boolean
    supplierCostUsd: number }>
  durableFamilyHit: boolean
  onDemandDemandDiscoveryRequired: boolean
  onDemandDemandDiscoveryExecuted: boolean
  soldComparableCount: number
  familyDemandStatus: string | null
  familyBindingCreatedOrReused: boolean
  demandEvidenceClass: string | null
  demandNegativeEvidencePresent: boolean
  marketTestPathEligible: boolean
  marketTestReady: boolean
  marketTestReview: Record<string, unknown> | null
  listingReview: Record<string, unknown> | null
  requiredItemSpecificsCount: number | null
  requiredItemSpecificsSatisfied: number | null
  requiredItemSpecificsReady: boolean | null
  unresolvedRequiredAspects: string[]
  conditionReady: boolean | null
  automaticResolutionExhausted: boolean
  fullLunaBrandEvidenceReviewPending: boolean
  exactUnresolvedFields: string[]
  ownerResidualActions: Array<{ productField: string
    bestProposal: string | null; proposalEvidence: string
    confidence: string; ownerAction: "CONFIRM" | "ENTER_FACT" }>
  nextOwnerAction: "CONFIRM" | "ENTER_FACT" | null
  ownerTruePublicationBlockers: Array<{
    specificName: string
    requirementClass: "REQUIRED_TO_LIST" | "CONDITIONALLY_REQUIRED"
    officialPolicySource: string
    currentFactStatus: string
    aiAutonomousResolutionAllowed: boolean
    ownerInputRequired: boolean
    blocksMinimumTruthfulListing: boolean
    mode: string
    maxLength: number | null
    dataType: string
    valuesComplete: boolean
    allowedValues: string[]
    bestProposal: string | null
    proposalEvidence: string | null
    factInvented: false
  }>
  ownerCapturedFacts: Array<{ specificName: string; exactValue: string
    normalizedMarketplaceValue: string; capturedAt: string
    evidenceDigest: string; correctionAllowedBeforePublication: boolean
    factInvented: false }>
  postPublishEnrichmentOpportunities: Array<{ specificName: string
    requirementClass: "RECOMMENDED" | "OPTIONAL" }>
  minimumTruthfulListingReady: boolean
  officialRequirementClassification: boolean
  requirementCounts: { requiredToList: number; conditionallyRequired: number
    recommended: number; optional: number; unproven: number }
  productIdentifierRequirementStatus: "PASS" | "BLOCKED_REQUIRED_FACT" |
    "UNPROVEN_CAPABILITY" | null
  safeResumeAfterOwnerFact: boolean
  deterministicResolvedCount: number
  marketplaceFallbackResolvedCount: number
  aiCallCount: number
  aiAspectsResolvedCount: number
  factInvented: false
  marketplaceReadinessReady: boolean
  shippingUsd: number | null
  rehydrated: boolean
  updatedAt: string | null
  stages: Record<string, StageState>
  demandSemantics?: { origin: "RADAR_HANDOFF" | "OTHER_OR_MANUAL"
    familyDemand: string; exactProductDemand: string
    demandGateContinued: boolean; route: "MARKET_TEST" | "STANDARD" }
  dollarCheck: Record<string, unknown> | null
  elapsedMs: number
  provenance?: { sourceType: string; label: string; sourceId: string | null }
}

function money(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" })
      .format(number) : "No comprobado"
}

function percent(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : "No comprobado"
}

function stateTone(state: QuickPickCard["state"]) {
  if (state === "READY") return "border-emerald-200/40 bg-emerald-200/[0.08]"
  if (state === "BLOCKED") return "border-amber-200/35 bg-amber-200/[0.07]"
  if (state === "RUNNING") return "border-cyan-200/35 bg-cyan-200/[0.07]"
  return "border-white/15 bg-white/[0.04]"
}

function stageIcon(state: StageState | undefined) {
  if (state === "PASS") return "✅"
  if (state === "CONTINUES") return "→"
  if (state === "RUNNING") return "…"
  if (state === "BLOCKED") return "⚠️"
  return "○"
}

function cardBlockers(card: QuickPickCard) {
  return [...new Set(card.exactBlockers?.length
    ? card.exactBlockers
    : card.exactBlocker ? [card.exactBlocker] : [])]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export default function LunaQuickPickPage() {
  const [input, setInput] = useState("")
  const [cards, setCards] = useState<QuickPickCard[]>([])
  const [error, setError] = useState("")
  const [rehydrating, setRehydrating] = useState(true)
  const [receipt, setReceipt] = useState<QuickPickReceipt | null>(null)
  const [receiptIsCurrentSession, setReceiptIsCurrentSession] = useState(false)
  const [currentBatchSummary, setCurrentBatchSummary] =
    useState<QuickPickSummary | null>(null)
  const [globalQueueSummary, setGlobalQueueSummary] =
    useState<QuickPickSummary | null>(null)
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({})
  const [factBusy, setFactBusy] = useState<Record<string, boolean>>({})
  const [factFeedback, setFactFeedback] = useState<Record<string, string>>({})
  const [publisherCohort, setPublisherCohort] =
    useState<PublisherCohort | null>(null)
  const [publisherReadError, setPublisherReadError] = useState("")
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchFeedback, setBatchFeedback] = useState("")
  const [batchIdempotencyKey, setBatchIdempotencyKey] = useState("")

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("ADMIN_AUTH_REQUIRED")
    const response = await fetch(path, { ...init, cache: "no-store",
      headers: { ...(init?.headers ?? {}),
        Authorization: `Bearer ${data.session.access_token}` } })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error ||
      "LUNA_QUICK_PICK_REQUEST_FAILED")
    return payload
  }, [])

  const mergeCards = useCallback((incoming: QuickPickCard[]) => {
    setCards((current) => [...mergeSellerOsQuickPickPresentationV1(
      current, incoming)])
  }, [])

  const loadReadModel = useCallback(async () => {
    setRehydrating(true)
    setError("")
    setPublisherReadError("")
    const [quickPickResult, publisherResult] = await Promise.allSettled([
      request("/api/admin/ebay/luna-quick-pick"),
      request("/api/admin/ebay/publisher-cohort"),
    ])
    if (quickPickResult.status === "fulfilled") {
      const payload = quickPickResult.value
      const readModel = record(payload.readModel)
      const selectedBatch = record(readModel.selectedBatch)
      const globalQueue = record(readModel.globalQueue)
      const globalCards = Array.isArray(globalQueue.cards)
        ? globalQueue.cards as QuickPickCard[]
        : Array.isArray(payload.progress) ? payload.progress : []
      setCards(globalCards)
      setReceipt((record(selectedBatch).receipt ?? payload.receipt ?? null) as
        QuickPickReceipt | null)
      setReceiptIsCurrentSession(false)
      setCurrentBatchSummary(Object.keys(record(selectedBatch.summary)).length
        ? record(selectedBatch.summary) as QuickPickSummary : null)
      setGlobalQueueSummary(Object.keys(record(globalQueue.summary)).length
        ? record(globalQueue.summary) as QuickPickSummary : null)
      setLastReadAt(new Date().toISOString())
    } else {
      setError(quickPickResult.reason instanceof Error
        ? quickPickResult.reason.message : "LUNA_QUICK_PICK_READ_FAILED")
    }
    if (publisherResult.status === "fulfilled") {
      setPublisherCohort(publisherResult.value.cohort as PublisherCohort)
    } else {
      setPublisherCohort(null)
      setPublisherReadError(publisherResult.reason instanceof Error
        ? publisherResult.reason.message : "PUBLISHER_COHORT_READ_FAILED")
    }
    setRehydrating(false)
  }, [request])

  const processLinks = useCallback(async (urls: string[],
    selectedVariants: Record<string, string> = {}) => {
    setError("")
    let batchAccepted = false
    mergeCards(urls.map((sourceUrl) => ({ sourceUrl, canonicalUrl: null,
      sourceSku: null, lunaProductId: null, lunaVariantId: null,
      candidateId: null, opportunityId: null, candidateKey: null,
      listingPackageId: null, title: null, state: "RUNNING",
      lastStage: "IDENTITY", disposition: "RUNNING", exactBlocker: null,
      exactBlockers: [],
      variantSelectionRequired: false, variants: [], stages: {
        IDENTITY: "RUNNING" }, durableFamilyHit: false,
      onDemandDemandDiscoveryRequired: false,
      onDemandDemandDiscoveryExecuted: false, soldComparableCount: 0,
      familyDemandStatus: null, familyBindingCreatedOrReused: false,
      demandEvidenceClass: null, demandNegativeEvidencePresent: false,
      marketTestPathEligible: false, marketTestReady: false,
      marketTestReview: null, listingReview: null,
      requiredItemSpecificsCount: null,
      requiredItemSpecificsSatisfied: null,
      requiredItemSpecificsReady: null, unresolvedRequiredAspects: [],
      conditionReady: null, automaticResolutionExhausted: false,
      fullLunaBrandEvidenceReviewPending: false,
      exactUnresolvedFields: [], ownerResidualActions: [],
      ownerTruePublicationBlockers: [], ownerCapturedFacts: [],
      postPublishEnrichmentOpportunities: [],
      nextOwnerAction: null, deterministicResolvedCount: 0,
      marketplaceFallbackResolvedCount: 0, aiCallCount: 0,
      aiAspectsResolvedCount: 0, factInvented: false,
      marketplaceReadinessReady: false,
      minimumTruthfulListingReady: false,
      officialRequirementClassification: false,
      requirementCounts: { requiredToList: 0, conditionallyRequired: 0,
        recommended: 0, optional: 0, unproven: 0 },
      productIdentifierRequirementStatus: null,
      safeResumeAfterOwnerFact: false,
      shippingUsd: null, rehydrated: false, updatedAt: null,
      dollarCheck: null, elapsedMs: 0 })))
    try {
      const received = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECEIVE", urls }),
      })
      batchAccepted = true
      setReceipt(received.receipt)
      setReceiptIsCurrentSession(true)
      mergeCards(received.receipt.cards ?? [])
      const payload = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PROCESS",
          batchId: received.receipt.batchId, urls, selectedVariants }),
      })
      mergeCards(payload.result.cards)
      setReceipt(payload.receipt ?? received.receipt)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : ""
      setError(batchAccepted
        ? "Lote recibido · reconciliando el progreso durable"
        : message || "LUNA_QUICK_PICK_REQUEST_FAILED")
      if (batchAccepted) return
      setCards((current) => current.map((card) => urls.includes(card.sourceUrl)
        && card.state === "RUNNING" ? { ...card, state: "BLOCKED",
          disposition: "BLOCKED", exactBlocker: message,
          exactBlockers: message ? [message] : [],
          stages: { ...card.stages, [card.lastStage]: "BLOCKED" } } : card))
    }
  }, [mergeCards, request])

  async function submit() {
    const urls = input.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    if (!urls.length) return
    setInput("")
    await processLinks(urls)
  }

  async function publishReadyBatch() {
    if (!publisherCohort || batchBusy) return
    const members = publisherCohort.candidates.filter((candidate) =>
      candidate.batchEligible).map((candidate) => ({
        candidateId: candidate.candidateId,
        packageId: candidate.packageId,
        packageDigest: candidate.currentPackageDigest,
        authorizationBinding: candidate.authorizationBinding,
      }))
    if (members.length < 1) return
    const key = batchIdempotencyKey ||
      `publisher-batch:${crypto.randomUUID()}`
    setBatchIdempotencyKey(key)
    setBatchBusy(true); setBatchFeedback(""); setError("")
    try {
      const payload = await request("/api/admin/ebay/draft-only", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch_publish", members,
          idempotencyKey: key, confirmExactMemberCount: members.length,
          confirmCommercialAuthorization: true,
          confirmation: `PUBLICAR ${members.length} LISTOS` }),
      })
      const runtime = record(payload.runtimeResult)
      setBatchFeedback(runtime.status === "COMPLETED"
        ? `${members.length} publicaciones confirmadas LIVE por eBay.`
        : `Lote autorizado. Seller OS continúa de forma durable; estado ${
          String(runtime.status ?? "EN EJECUCIÓN")}.`)
      await loadReadModel()
    } catch (caught) {
      setBatchFeedback(caught instanceof Error ? caught.message
        : "El lote quedó fail-closed antes de una operación no comprobada.")
      await loadReadModel().catch(() => undefined)
    } finally { setBatchBusy(false) }
  }

  async function chooseVariant(card: QuickPickCard, variantId: string) {
    if (!card.canonicalUrl) return
    await processLinks([card.sourceUrl], { [card.canonicalUrl]: variantId })
  }

  const ownerFactKey = (card: QuickPickCard, specificName: string) =>
    `${card.candidateKey ?? "unknown"}:${specificName}`

  async function saveOwnerFact(card: QuickPickCard,
    blocker: Readonly<{ specificName: string; bestProposal?: string | null }>,
    explicitValue?: string) {
    if (!card.candidateKey || !card.listingPackageId) return
    const key = ownerFactKey(card, blocker.specificName)
    const exactValue = (explicitValue ?? factDrafts[key] ??
      blocker.bestProposal ?? "").trim()
    if (!exactValue) {
      setFactFeedback((current) => ({ ...current,
        [key]: "Escribe el dato exacto antes de guardar." }))
      return
    }
    setFactBusy((current) => ({ ...current, [key]: true }))
    setFactFeedback((current) => ({ ...current, [key]: "" }))
    try {
      const payload = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "OWNER_FACT_CAPTURE",
          candidateKey: card.candidateKey,
          listingPackageId: card.listingPackageId,
          specificName: blocker.specificName,
          exactValue }),
      })
      mergeCards(payload.progress ?? [])
      setFactFeedback((current) => ({ ...current,
        [key]: "Dato guardado. Seller OS continuó desde este punto ✓" }))
    } catch (caught) {
      setFactFeedback((current) => ({ ...current,
        [key]: caught instanceof Error
          ? "No se pudo guardar. Tu producto no avanzó y puedes intentarlo de nuevo."
          : "No se pudo guardar este dato." }))
    } finally {
      setFactBusy((current) => ({ ...current, [key]: false }))
    }
  }

  useEffect(() => {
    void loadReadModel().catch(() => undefined)
    return () => undefined
  }, [loadReadModel])

  const publisherByCandidate = useMemo(() => new Map(
    (publisherCohort?.candidates ?? []).map((candidate) =>
      [candidate.candidateId, candidate]),
  ), [publisherCohort])

  const sections = useMemo(() => [
    { id: "ready", title: "A. Listos",
      copy: "Paquetes actuales, accionables y elegibles para el Publisher.",
      cards: cards.filter((card) => publisherByCandidate.get(
        card.candidateKey ?? "")?.batchEligible === true) },
    { id: "needs-data", title: "B. Datos por confirmar",
      copy: "Sólo hechos comerciales que Seller OS no pudo demostrar.",
      cards: cards.filter((card) =>
        card.ownerTruePublicationBlockers.length > 0
        && publisherByCandidate.get(card.candidateKey ?? "")
          ?.batchRuntime.published !== true) },
    { id: "prepare", title: "C. Preparar productos",
      copy: "Quick Pick Luna y paquetes que el runtime sigue preparando.",
      cards: cards.filter((card) => card.state === "WAITING"
        && card.ownerTruePublicationBlockers.length === 0
        && !publisherByCandidate.get(card.candidateKey ?? "")
          ?.batchRuntime.inProgress) },
    { id: "in-progress", title: "D. En ejecución",
      copy: "Seller OS continúa automáticamente desde receipts durables.",
      cards: cards.filter((card) => card.state === "RUNNING"
        || publisherByCandidate.get(card.candidateKey ?? "")
          ?.batchRuntime.inProgress === true) },
    { id: "blocked", title: "E. Bloqueados",
      copy: "Cada producto conserva su avance y muestra solamente el blocker real.",
      cards: cards.filter((card) =>
        publisherByCandidate.get(card.candidateKey ?? "")
          ?.batchRuntime.published !== true
        && (card.state === "BLOCKED"
          || publisherByCandidate.get(card.candidateKey ?? "")
            ?.batchRuntime.blocked === true)) },
    { id: "published", title: "F. Publicados",
      copy: "Aparecerán aquí después de una publicación autorizada y readback LIVE.",
      cards: cards.filter((card) => publisherByCandidate.get(
        card.candidateKey ?? "")?.batchRuntime.published === true) },
    { id: "history", title: "G. Historial",
      copy: "Snapshots y lotes terminados, separados de la operación actual.",
      cards: [] as QuickPickCard[] },
  ], [cards, publisherByCandidate])

  const ownerLastMileCards = useMemo(() => cards.filter((card) =>
    card.ownerTruePublicationBlockers?.length > 0)
    .sort((left, right) =>
      left.ownerTruePublicationBlockers.length
        - right.ownerTruePublicationBlockers.length
      || String(left.sourceSku ?? "").localeCompare(
        String(right.sourceSku ?? ""))), [cards])
  const ownerLastMileFactCount = ownerLastMileCards.reduce((total, card) =>
    total + card.ownerTruePublicationBlockers.length, 0)
  const batchSummary = publisherCohort?.summary
  const exactBatchMembers = (publisherCohort?.candidates ?? []).filter(
    (candidate) => candidate.batchEligible)
  const exactMembershipValid = Boolean(batchSummary
    && batchSummary.exactMemberDigestsMatch
    && exactBatchMembers.length === batchSummary.batchEligibleCount
    && new Set(exactBatchMembers.map((entry) => entry.candidateId)).size
      === exactBatchMembers.length
    && exactBatchMembers.every((entry) => {
      const binding = record(entry.authorizationBinding)
      return /^sha256:[0-9a-f]{64}$/.test(entry.candidateId)
        && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.packageId)
        && /^sha256:[0-9a-f]{64}$/.test(entry.currentPackageDigest)
        && binding.candidateId === entry.candidateId
        && binding.packageId === entry.packageId
        && binding.packageDigest === entry.currentPackageDigest
    }))
  const batchParity = Boolean(batchSummary
    && batchSummary.authoritativeReadyCount ===
      batchSummary.visibleReadyCount
    && batchSummary.visibleReadyCount ===
      batchSummary.actionableReadyCount
    && batchSummary.actionableReadyCount === batchSummary.batchEligibleCount
    && batchSummary.batchEligibleCount === batchSummary.batchButtonN
    && batchSummary.preflightEligible && exactMembershipValid)

  return <main className="min-h-screen bg-[#080b11] px-4 pb-28 pt-6 text-white">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.06] p-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/65">Seller OS · Control plane comercial</p>
        <h1 className="mt-2 text-3xl font-black">Publicar</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">Prepara, autoriza y sigue cada publicación desde una sola autoridad operacional. Seller OS ejecuta cada child de forma independiente; tú autorizas el conjunto exacto una sola vez.</p>
        <nav aria-label="Secciones de Publicar"
          className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          {[{ label: "Listos", id: "ready" },
            { label: "Datos por confirmar", id: "needs-data" },
            { label: "Preparar productos", id: "prepare" },
            { label: "En ejecución", id: "in-progress" },
            { label: "Bloqueados", id: "blocked" },
            { label: "Publicados", id: "published" },
            { label: "Historial", id: "history" }]
            .map(({ label, id }) => <a key={id}
              href={`#quick-pick-${id}`}
              className="rounded-full border border-white/15 px-3 py-2 text-white/70">{label}</a>)}
        </nav>
      </header>

      <section id="quick-pick-preparar-productos"
        className="rounded-3xl border border-white/15 bg-white/[0.04] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/60">Preparar productos · Quick Pick Luna</p>
        <label className="block"><span className="font-black">Pegar uno o varios links Luna</span>
          <textarea value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="https://www.lunaportex.com/products/...&#10;https://www.lunaportex.com/products/..."
            rows={5} className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 p-4 text-sm outline-none focus:border-cyan-200" /></label>
        <button type="button" onClick={() => void submit()} disabled={!input.trim()}
          className="mt-3 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">Procesar ahora</button>
        <p className="mt-2 text-xs text-white/45">Puedes agregar más links mientras los anteriores continúan. Máximo 20 por envío; concurrencia bounded de 4 productos.</p>
      </section>

      {receipt && <section aria-live="polite"
        className="rounded-3xl border border-emerald-200/30 bg-emerald-200/[0.07] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/70">
          {receiptIsCurrentSession ? "Lote recibido" :
            "Último lote guardado · snapshot histórico"} · {receipt.ownerReference}
        </p>
        <p className="mt-2 text-lg font-black">{receipt.rawInputCount ?? "—"} links recibidos · {receipt.urlDedupedCount ?? "—"} únicos · {receipt.rejectedInputCount ?? "—"} rechazados · {receipt.durableOperationCount ?? "—"} productos materializados</p>
        {currentBatchSummary && <p className="mt-1 text-sm text-white/65">
          Estado de este lote: {currentBatchSummary.inProgress} trabajando · {currentBatchSummary.readyForReview} listos · {currentBatchSummary.blocked} bloqueados.
        </p>}
        <p className="mt-1 text-xs text-white/45">Recibo durable de un solo lote; no incluye otros lotes ni representa por sí solo la cola actual.</p>
      </section>}

      {globalQueueSummary && <section data-quick-pick-global-queue-counts
        className="rounded-3xl border border-white/15 bg-white/[0.04] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/55">Cola total · operaciones durables actuales</p>
        <p className="mt-2 text-sm text-white/70">
          {globalQueueSummary.inProgress} trabajando · {globalQueueSummary.readyForReview} listos para revisar · {globalQueueSummary.blocked} bloqueados · {globalQueueSummary.waiting} en espera.
        </p>
        <p className="mt-1 text-xs text-white/45">
          Los snapshots de lotes históricos y certificaciones no se suman aquí; sólo se usa el estado durable actual de cada operación.
        </p>
        <button type="button" onClick={() => void loadReadModel()}
          disabled={rehydrating}
          className="mt-3 min-h-11 rounded-xl border border-white/20 px-4 text-sm font-black disabled:opacity-40">
          {rehydrating ? "Actualizando…" : "Actualizar estado"}
        </button>
      </section>}

      <section data-publisher-batch-control
        className="rounded-3xl border border-emerald-200/30 bg-emerald-200/[0.07] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/70">Autorización comercial de lote</p>
        <h2 className="mt-1 text-xl font-black">PUBLICAR {
          batchSummary?.batchButtonN ?? 0} LISTOS</h2>
        <p className="mt-2 text-sm text-white/65">
          Autoridad {batchSummary?.authoritativeReadyCount ?? "—"} · visibles {
          batchSummary?.visibleReadyCount ?? "—"} · accionables {
          batchSummary?.actionableReadyCount ?? "—"} · elegibles {
          batchSummary?.batchEligibleCount ?? "—"}.
        </p>
        {publisherReadError && <p role="alert"
          className="mt-2 text-xs text-rose-100">
          Autoridad Publisher no disponible · {publisherReadError}. El lote
          continúa cerrado y no se presenta como cero.
        </p>}
        {publisherCohort && <div className="mt-3 rounded-2xl bg-black/25 p-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-white/55">
            Membresía exacta · {exactMembershipValid ? "DIGESTS MATCH" : "NO VERIFICADA"}
          </p>
          <ol className="mt-2 space-y-2">
            {exactBatchMembers.map((member) => <li key={member.candidateId}
              className="rounded-xl border border-white/10 p-2 text-xs">
              <p className="font-black text-white/85">{member.title
                ?? member.sourceSku ?? "Producto sin título"}</p>
              <p className="mt-1 break-all text-white/45">SKU {member.sourceSku
                ?? "NO DEMOSTRADO"} · candidate {member.candidateId}</p>
              <p className="break-all text-white/45">package {member.packageId}
                · {member.currentPackageDigest}</p>
            </li>)}
          </ol>
          {publisherCohort.source?.apiSourceSha && <p
            className="mt-2 break-all text-[10px] text-white/35">
            API source · {publisherCohort.source.apiSourceSha}
          </p>}
        </div>}
        <button type="button" onClick={() => void publishReadyBatch()}
          disabled={!batchParity || batchBusy ||
            (batchSummary?.batchEligibleCount ?? 0) < 1}
          className="mt-3 min-h-12 w-full rounded-xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">
          {batchBusy ? "SELLER OS EJECUTANDO…" : `PUBLICAR ${
            batchSummary?.batchButtonN ?? 0} LISTOS`}
        </button>
        {!batchParity && <p className="mt-2 text-xs text-amber-100">
          El lote permanece cerrado hasta que autoridad, acción, preflight y membresía exacta coincidan.
        </p>}
        {batchFeedback && <p aria-live="polite"
          className="mt-2 text-sm text-emerald-50">{batchFeedback}</p>}
      </section>

      {rehydrating && <p aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4 text-sm text-cyan-50">Recuperando tus Quick Picks guardados…</p>}

      {error && <section role="alert"
        className="rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm text-rose-50">
        <strong>No pudimos cargar Quick Pick · {error}</strong>
        <p className="mt-1 text-xs text-white/60">La autoridad del lote
          Publisher se conserva de forma independiente cuando está disponible.</p>
        {cards.length > 0 && lastReadAt && <p className="mt-1 text-xs text-white/60">
          Mostrando la última lectura durable confirmada de esta sesión · {new Date(lastReadAt).toLocaleString("es-NI")}.
        </p>}
        <button type="button" onClick={() => void loadReadModel()}
          className="mt-3 min-h-11 rounded-xl bg-white px-4 font-black text-black">Reintentar</button>
      </section>}

      {ownerLastMileCards.length > 0 && <section
        aria-labelledby="owner-last-mile-title"
        className="rounded-3xl border border-sky-200/35 bg-sky-200/[0.07] p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-100/70">Tu última revisión</p>
        <h2 id="owner-last-mile-title" className="mt-1 text-xl font-black">
          {ownerLastMileCards.length} productos necesitan tu atención
        </h2>
        <p className="mt-1 text-sm text-white/65">
          {ownerLastMileFactCount} datos en total. Aquí aparecen únicamente los datos que eBay exige para poder continuar.
        </p>
        <div className="mt-4 grid gap-3">
          {ownerLastMileCards.map((card) => <article
            key={`owner:${card.candidateKey}`}
            className="rounded-2xl border border-white/15 bg-black/20 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-white/45">{card.sourceSku}</p>
            <h3 className="mt-1 font-black">{card.title}</h3>
            <p className="mt-2 text-sm text-sky-50">
              Falta {card.ownerTruePublicationBlockers.length === 1
                ? "1 dato" : `${card.ownerTruePublicationBlockers.length} datos`} para poder publicar.
            </p>
            <div className="mt-3 grid gap-3">
              {card.ownerTruePublicationBlockers.map((blocker) => {
                const fieldKey = ownerFactKey(card, blocker.specificName)
                const draft = factDrafts[fieldKey] ?? ""
                const busy = factBusy[fieldKey] === true
                return <div key={blocker.specificName}
                  className="rounded-xl border border-sky-100/15 bg-white/[0.04] p-3">
                  <p className="text-xs font-black uppercase tracking-wider text-sky-100/65">Campo</p>
                  <p className="mt-1 font-black">{blocker.specificName}</p>
                  <p className="mt-2 text-sm leading-5 text-white/65">
                    Seller OS revisó la información disponible pero no pudo demostrar este dato con suficiente evidencia. eBay lo exige para continuar.
                  </p>
                  {blocker.bestProposal && <div className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.06] p-3">
                    <p className="text-sm">Seller OS propone: <strong>{blocker.bestProposal}</strong></p>
                    <button type="button" disabled={busy}
                      onClick={() => void saveOwnerFact(card, blocker,
                        blocker.bestProposal ?? undefined)}
                      className="mt-2 min-h-11 rounded-xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">
                      {busy ? "Guardando…" : "Confirmar"}
                    </button>
                  </div>}
                  <label className="mt-3 block">
                    <span className="text-xs font-black text-white/65">
                      {blocker.bestProposal ? "Editar valor" : "Dato exacto"}
                    </span>
                    {blocker.mode === "SELECTION_ONLY"
                        && blocker.valuesComplete
                        && blocker.allowedValues.length > 0
                      ? <select value={draft}
                        onChange={(event) => setFactDrafts((current) => ({
                          ...current, [fieldKey]: event.target.value }))}
                        className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-[#101722] px-3 outline-none focus:border-sky-200">
                        <option value="">Selecciona el valor exacto</option>
                        {blocker.allowedValues.map((value) => <option
                          key={value} value={value}>{value}</option>)}
                      </select>
                      : <input value={draft}
                        maxLength={blocker.maxLength ?? 500}
                        onChange={(event) => setFactDrafts((current) => ({
                          ...current, [fieldKey]: event.target.value }))}
                        placeholder={`Escribe ${blocker.specificName}`}
                        className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3 outline-none focus:border-sky-200" />}
                  </label>
                  <button type="button" disabled={busy || !draft.trim()}
                    onClick={() => void saveOwnerFact(card, blocker)}
                    className="mt-2 min-h-11 w-full rounded-xl bg-sky-200 px-4 font-black text-black disabled:opacity-40">
                    {busy ? "Guardando…" : blocker.bestProposal
                      ? "Guardar edición" : "Guardar y continuar"}
                  </button>
                  {factFeedback[fieldKey] && <p aria-live="polite"
                    className="mt-2 text-xs text-sky-50">
                    {factFeedback[fieldKey]}
                  </p>}
                </div>
              })}
            </div>
          </article>)}
        </div>
      </section>}

      {sections.map((section) => <section key={section.id}
        aria-labelledby={`quick-pick-${section.id}`} className="space-y-3">
        <div><h2 id={`quick-pick-${section.id}`} className="text-xl font-black">{section.title}</h2>
          <p className="mt-1 text-sm text-white/55">{section.copy}</p></div>
        {section.cards.length === 0 ? <p className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-white/45">No hay productos en esta sección.</p> : <div className="grid gap-4 lg:grid-cols-2">
        {section.cards.map((card) => <article key={card.opportunityId ??
          card.candidateKey ?? `${card.lunaProductId ?? "pending"}:${
            card.lunaVariantId ?? card.sourceUrl}`}
          className={`rounded-3xl border p-4 ${card.marketTestReady
            ? "border-amber-200/45 bg-amber-200/[0.09]" : stateTone(card.state)}`}>
          <div className="flex items-start justify-between gap-3"><div>
            <p className="text-xs font-black uppercase tracking-widest text-white/45">{card.sourceSku ?? "Identificando…"}</p>
            <h2 className="mt-1 font-black">{card.title ?? "Producto Luna"}</h2>
            <p className="mt-1 text-xs text-white/45">{
              card.provenance?.label ?? "Origen · Por determinar"}</p>
          </div><span className="rounded-full border border-white/20 px-3 py-1 text-xs font-black">{
            publisherByCandidate.get(card.candidateKey ?? "")?.batchRuntime
              .published ? "PUBLICADO"
              : publisherByCandidate.get(card.candidateKey ?? "")?.batchRuntime
                .inProgress ? "EN EJECUCIÓN"
                : publisherByCandidate.get(card.candidateKey ?? "")?.batchRuntime
                  .blocked ? "BLOQUEADO" : card.state}</span></div>

          {publisherByCandidate.get(card.candidateKey ?? "")?.batchRuntime
              .status && <p data-publisher-child-runtime
            className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.05] p-2 text-xs text-cyan-50">
            Publisher · {publisherByCandidate.get(card.candidateKey ?? "")
              ?.batchRuntime.stage ?? "PREFLIGHT"} · {
              publisherByCandidate.get(card.candidateKey ?? "")
                ?.batchRuntime.status}
            {publisherByCandidate.get(card.candidateKey ?? "")
              ?.lastErrorClass ? ` · ${publisherByCandidate.get(
                card.candidateKey ?? "")?.lastErrorClass}` : ""}
          </p>}

          {card.demandSemantics?.demandGateContinued && <div
            data-quick-pick-demand-semantics
            className="mt-3 rounded-xl border border-violet-200/20 bg-violet-200/[0.06] p-2 text-sm text-violet-50/80">
            {card.demandSemantics.origin === "RADAR_HANDOFF" && <span
              className="block">Demanda de la familia: <strong>{
                card.demandSemantics.familyDemand}</strong></span>}
            <span className="block">Demanda del producto exacto: <strong>
              aún no comprobada</strong></span>
            <span className="block">Ruta: <strong>Prueba de mercado</strong></span>
          </div>}

          {card.variantSelectionRequired && <div className="mt-4 rounded-2xl border border-amber-200/30 bg-black/20 p-3">
            <strong>Elige la variante exacta</strong>
            <div className="mt-2 grid gap-2">{card.variants.map((variant) =>
              <button key={variant.lunaVariantId} type="button"
                onClick={() => void chooseVariant(card, variant.lunaVariantId)}
                className="rounded-xl border border-white/15 p-3 text-left text-sm hover:border-cyan-200">
                <strong>{variant.title}</strong><span className="block text-xs text-white/55">{variant.supplierSku} · {money(variant.supplierCostUsd)} · {variant.available ? "Disponible" : "Sin stock"}</span>
              </button>)}</div>
          </div>}

          <ol data-quick-pick-canonical-stage-renderer
            className="mt-4 list-none space-y-1.5 text-sm">{QUICK_PICK_OWNER_STAGE_CATALOG_V1.map(([key, label]) => {
            const displayedState = card.stages[key]
            const displayedLabel = key === "LISTING_READY" &&
              card.marketTestReady ? "Listo para decisión owner" : label
            return <li key={key} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${displayedState === "RUNNING" ? "bg-cyan-200/[0.08] text-cyan-50" : displayedState === "CONTINUES" ? "bg-violet-200/[0.08] text-violet-50" : displayedState === "BLOCKED" ? "text-amber-100" : "text-white/65"}`}>
              <span aria-hidden="true">{stageIcon(displayedState)}</span><span>{displayedLabel}{displayedState === "CONTINUES" ? " — CONTINÚA" : ""}</span>
            </li>
          })}</ol>

          {card.stages.SHIPPING === "PASS" && <p className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.06] p-2 text-sm text-emerald-50">Envío comprobado{card.shippingUsd !== null ? ` · ${money(card.shippingUsd)}` : ""}</p>}
          {card.stages.SHIPPING === "RUNNING" && <p className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-2 text-sm text-cyan-50">Esperando worker Luna. Seller OS reanudará este producto automáticamente.</p>}

          {card.ownerTruePublicationBlockers.length > 0 && <p
            className="mt-3 rounded-xl border border-sky-200/20 bg-sky-200/[0.06] p-3 text-sm text-sky-50">
            Este producto está incluido en “Tu última revisión” para completar únicamente lo que eBay exige.
          </p>}
          {card.ownerTruePublicationBlockers.length === 0
              && card.productIdentifierRequirementStatus ===
                "UNPROVEN_CAPABILITY" && <p
            className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">
            Esperando que eBay permita comprobar su política de identificadores. Tu avance está guardado.
          </p>}

          {!card.officialRequirementClassification
              && (card.ownerResidualActions ?? []).length > 0 && <section
            className="mt-3 rounded-xl border border-sky-200/20 bg-sky-200/[0.06] p-3 text-sm text-sky-50">
            <strong>{card.nextOwnerAction === "ENTER_FACT"
              ? "Último dato del owner requerido"
              : "Confirmación final del owner requerida"}</strong>
            <ul className="mt-2 space-y-1 text-xs">
              {(card.ownerResidualActions ?? []).map((action) => <li
                key={action.productField}>
                {action.productField}: {action.bestProposal
                  ? `confirmar “${action.bestProposal}” o editar`
                  : "ingresar el hecho exacto"}
              </li>)}
            </ul>
          </section>}

          {card.ownerCapturedFacts.length > 0 && <details
            className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-white/65">
            <summary className="flex min-h-11 cursor-pointer items-center font-black">
              Corregir datos que confirmaste
            </summary>
            <div className="mt-2 grid gap-3">
              {card.ownerCapturedFacts.map((fact) => {
                const fieldKey = ownerFactKey(card, fact.specificName)
                const value = factDrafts[fieldKey] ?? fact.exactValue
                return <label key={fact.evidenceDigest} className="block">
                  <span className="text-xs font-black">{fact.specificName}</span>
                  <input value={value} onChange={(event) =>
                    setFactDrafts((current) => ({ ...current,
                      [fieldKey]: event.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/25 px-3" />
                  <button type="button" disabled={factBusy[fieldKey] === true
                      || !value.trim()}
                    onClick={() => void saveOwnerFact(card, {
                      specificName: fact.specificName,
                    }, value)}
                    className="mt-2 min-h-11 rounded-xl border border-white/20 px-4 font-black disabled:opacity-40">
                    {factBusy[fieldKey] ? "Guardando…" : "Guardar corrección"}
                  </button>
                  {factFeedback[fieldKey] && <span className="mt-2 block text-xs text-sky-50">{factFeedback[fieldKey]}</span>}
                </label>
              })}
            </div>
          </details>}

          {card.state === "READY" && card.dollarCheck && <section
            className={`mt-4 rounded-2xl border p-3 ${card.marketTestReady
              ? "border-amber-200/35 bg-amber-200/[0.08]"
              : "border-emerald-200/30 bg-emerald-200/[0.08]"}`}>
            <h3 className={`font-black ${card.marketTestReady
              ? "text-amber-50" : "text-emerald-50"}`}>{card.marketTestReady
              ? "🟡 PRUEBA DE MERCADO" : "Dollar Check"}</h3>
            {card.marketTestReady && <p className="mt-2 text-sm leading-5 text-amber-50">No encontramos suficiente historial de demanda en eBay. El producto pasa stock, costos y preparación del listing. Puedes probarlo con riesgo comercial explícito.</p>}
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div><dt>{card.marketTestReady ? "Test price" : "Precio"}</dt><dd className="font-black">{money(card.marketTestReady ? card.marketTestReview?.testPrice : card.dollarCheck.targetPrice)}</dd></div>
              <div><dt>Supplier cost</dt><dd className="font-black">{money(card.dollarCheck.supplierCost)}</dd></div>
              <div><dt>Shipping</dt><dd className="font-black">{money(card.dollarCheck.shipping)}</dd></div>
              <div><dt>eBay fees</dt><dd className="font-black">{money(card.dollarCheck.ebayFees)}</dd></div>
              <div><dt>Profit</dt><dd className="font-black">{money(card.dollarCheck.profit)}</dd></div>
              <div><dt>Margin</dt><dd className="font-black">{percent(card.dollarCheck.margin)}</dd></div>
              <div><dt>ROI</dt><dd className="font-black">{percent(card.dollarCheck.roi)}</dd></div>
              <div><dt>Stock</dt><dd className="font-black">Seguro</dd></div>
            </dl>
            <p className="mt-3 rounded-xl bg-black/20 p-3 text-sm font-black">
              Incluido en la autorización exacta de “PUBLICAR N LISTOS”.
            </p>
            <p className={`mt-2 text-xs ${card.marketTestReady
              ? "text-amber-50/70" : "text-emerald-50/65"}`}>{card.marketTestReady
              ? "Demanda = UNPROVEN. Precio competitivo = UNPROVEN. Requiere autorización explícita del owner."
              : "Abre la autoridad de publicación existente. Este Quick Pick no publica automáticamente."}</p>
          </section>}

          <details className="mt-3 rounded-xl border border-white/10 p-2 text-xs text-white/55"><summary className="flex min-h-11 cursor-pointer items-center font-black">Ver evidencia técnica</summary><dl className="mt-2 space-y-1"><div>Product ID: {card.lunaProductId ?? "—"}</div><div>Variant ID: {card.lunaVariantId ?? "—"}</div><div>Operación rehidratada: {card.rehydrated ? "sí" : "no"}</div><div>Demanda durable previa: {card.durableFamilyHit ? "sí" : "no"}</div><div>Discovery bajo demanda: {card.onDemandDemandDiscoveryExecuted ? "ejecutado" : card.onDemandDemandDiscoveryRequired ? "requerido" : "no requerido"}</div><div>Estado demanda: {card.familyDemandStatus ?? "—"}</div><div>Comparables sold: {card.soldComparableCount}</div><div>Binding familia: {card.familyBindingCreatedOrReused ? "creado/reutilizado" : "—"}</div><div>Specifics requeridos: {card.requiredItemSpecificsCount ?? "—"}</div><div>Specifics satisfechos: {card.requiredItemSpecificsSatisfied ?? "—"}</div><div>Specifics listos: {card.requiredItemSpecificsReady === null ? "—" : card.requiredItemSpecificsReady ? "sí" : "no"}</div><div>Specifics pendientes: {card.unresolvedRequiredAspects.length ? card.unresolvedRequiredAspects.join(", ") : "ninguno"}</div><div>Condición lista: {card.conditionReady === null ? "—" : card.conditionReady ? "sí" : "no"}</div><div>Blockers: {cardBlockers(card).length ? cardBlockers(card).join(" · ") : "ninguno"}</div><div>Resueltos determinísticamente: {card.deterministicResolvedCount}</div><div>Fallbacks marketplace: {card.marketplaceFallbackResolvedCount}</div><div>Llamadas IA: {card.aiCallCount}</div><div>Aspectos resueltos por IA: {card.aiAspectsResolvedCount}</div><div>Fact inventado: no</div><div>Última etapa: {card.lastStage}</div><div>Disposición: {card.disposition}</div><div>Actualizado: {card.updatedAt ? new Date(card.updatedAt).toLocaleString("es-NI") : "—"}</div><div>Tiempo: {card.elapsedMs} ms</div></dl></details>
        </article>)}
        </div>}
      </section>)}
    </div>
    <SellerOsMobileNav active="publish" />
  </main>
}
