import type { LunaQuickPickCardV1 } from "./ebay-luna-quick-pick-v1"
import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_QUICK_PICK_OWNER_READ_MODEL_V1 =
  "SELLER_OS_QUICK_PICK_OWNER_READ_MODEL_V1" as const

export const QUICK_PICK_OWNER_STAGE_CATALOG_V1 = Object.freeze([
  ["IDENTITY", "Producto identificado"],
  ["DUPLICATE", "Comprobando si ya está publicado"],
  ["STOCK", "Stock disponible"],
  ["DEMAND", "Buscando demanda"],
  ["SHIPPING", "Calculando envío"],
  ["ECONOMICS", "Comprobando margen"],
  ["PRODUCT_TRUTH", "Verificando producto exacto"],
  ["LISTING_PACKAGE", "Preparando eBay"],
  ["REQUIRED_SPECIFICS", "Comprobando datos requeridos"],
  ["MARKETPLACE_READINESS", "Comprobando requisitos eBay"],
  ["LISTING_READY", "Listo para decisión owner"],
] as const)

type StageState = "WAITING" | "RUNNING" | "PASS" | "BLOCKED" |
  "CONTINUES"

type StateAuthorityRow = Readonly<{
  id?: unknown
  assessment?: unknown
}>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown, maximum = 200) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

export async function readRecentDurableQuickPickCandidateKeysV1(input:
  Readonly<{ supabase: SupabaseClient; limit?: number }>) {
  const limit = Math.max(1, Math.min(20, input.limit ?? 20))
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("candidate_key,assessment,updated_at")
    .order("updated_at", { ascending: false }).limit(100)
  if (read.error) throw new Error("QUICK_PICK_OWNER_QUEUE_READ_FAILED")
  const keys = (Array.isArray(read.data) ? read.data : []).flatMap((row) => {
    const item = record(row)
    const operation = record(record(item.assessment).lunaQuickPickOperationV1)
    const key = typeof item.candidate_key === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(item.candidate_key)
      ? item.candidate_key : null
    return key && operation.contractVersion ===
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1" ? [key] : []
  })
  return Object.freeze([...new Set(keys)].slice(0, limit))
}

type Receipt = Readonly<{
  batchId: string
  status: unknown
  candidateKeys: readonly string[]
  cards: readonly LunaQuickPickCardV1[]
  receivedAt?: string | null
  updatedAt?: string | null
  [key: string]: unknown
}>

function stageState(value: unknown): StageState {
  const state = String(value ?? "WAITING").toUpperCase()
  return new Set(["WAITING", "RUNNING", "PASS", "BLOCKED"]).has(state)
    ? state as StageState : "WAITING"
}

function normalizedStages(card: LunaQuickPickCardV1) {
  return Object.freeze(Object.fromEntries(
    QUICK_PICK_OWNER_STAGE_CATALOG_V1.map(([key]) =>
      [key, stageState(card.stages?.[key])]),
  )) as Readonly<Record<string, StageState>>
}

const STAGE_INDEX = new Map<string, number>(QUICK_PICK_OWNER_STAGE_CATALOG_V1.map(
  ([stage], index) => [stage, index] as const))

function stateAuthority(card: LunaQuickPickCardV1,
  rows: readonly StateAuthorityRow[]) {
  const row = rows.find((candidate) => String(candidate.id ?? "") ===
    card.opportunityId)
  const assessment = record(row?.assessment)
  const handoff = record(assessment.radarToQuickPickHandoffV1)
  const validHandoff = handoff.contractVersion ===
      "RADAR_LUNA_QUICK_PICK_HANDOFF_V1" &&
    handoff.quickPickOperationId === card.opportunityId
  return Object.freeze({
    handoff: validHandoff ? handoff : {},
    minimum: record(assessment.minimumTruthfulListingReadinessV1),
    marketTest: record(assessment.quickPickMarketTestReviewV1),
    shipping: record(assessment.radarAutomaticLunaShippingContinuationV1),
  })
}

function familyDemand(value: unknown) {
  const normalized = text(value, 80)?.replace("FAMILY_DEMAND_", "")
  return new Set(["PROVEN", "SUPPORTED", "UNPROVEN", "UNAVAILABLE"])
    .has(normalized ?? "") ? normalized : "UNPROVEN"
}

function canonicalCurrentStage(card: LunaQuickPickCardV1,
  authority: ReturnType<typeof stateAuthority>) {
  const source = `${card.disposition} ${card.lastStage} ${
    authority.handoff.quickPickFinalState ?? ""} ${
    authority.shipping.shippingJobStatus ?? ""}`.toUpperCase()
  if (card.marketTestReady || ownerPublicationDecisionReady(card) ||
      card.state === "READY") return "LISTING_READY"
  if (source.includes("SHIPPING")) return "SHIPPING"
  if (source.includes("OWNER_FACT") || card.ownerResidualActions.length > 0 ||
      card.ownerTruePublicationBlockers.length > 0) return "REQUIRED_SPECIFICS"
  if (source.includes("ECONOMICS")) return "ECONOMICS"
  if (source.includes("EBAY_CAPABILITY") ||
      source.includes("MARKETPLACE_READINESS")) return "MARKETPLACE_READINESS"
  const activeStage = QUICK_PICK_OWNER_STAGE_CATALOG_V1.find(([stage]) =>
    card.stages?.[stage] === "RUNNING")?.[0]
  if (activeStage) return activeStage
  return STAGE_INDEX.has(card.lastStage) ? card.lastStage : "IDENTITY"
}

function trueBlockerStage(card: LunaQuickPickCardV1,
  authority: ReturnType<typeof stateAuthority>) {
  if (card.marketTestReady || ownerPublicationDecisionReady(card) ||
      card.state === "READY") return null
  if (card.alreadyLive || card.exactBlockers.some((value) =>
    /ALREADY_LIVE|PROVEN_DUPLICATE/.test(value))) return "DUPLICATE"
  if (card.demandNegativeEvidencePresent || card.exactBlockers.some((value) =>
    /NEGATIVE_DEMAND|DEMAND_NEGATIVE/.test(value))) return "DEMAND"
  if (card.ownerTruePublicationBlockers.length > 0 ||
      card.ownerResidualActions.length > 0 ||
      card.exactBlockers.some((value) => value.startsWith(
        "BLOCKED_REQUIRED_FACT"))) return "REQUIRED_SPECIFICS"
  const source = `${card.disposition} ${card.exactBlocker ?? ""} ${
    card.exactBlockers.join(" ")} ${
    authority.handoff.quickPickFinalState ?? ""}`.toUpperCase()
  if (source.includes("PARKED_ECONOMICS") ||
      source.includes("ECONOMICS_BELOW")) return "ECONOMICS"
  if (source.includes("STOCK_FAILURE") || source.includes("STOCK_UNSAFE")) {
    return "STOCK"
  }
  if (source.includes("IDENTITY_CONFLICT")) return "IDENTITY"
  if (source.includes("WAITING_FOR_EBAY_CAPABILITY") ||
      source.includes("CAPABILITY_REQUIRED_AND_UNAVAILABLE")) {
    return "MARKETPLACE_READINESS"
  }
  return card.state === "BLOCKED" && STAGE_INDEX.has(card.lastStage)
    ? card.lastStage : null
}

function demandSemantics(card: LunaQuickPickCardV1,
  authority: ReturnType<typeof stateAuthority>, currentStage: string) {
  const handoff = authority.handoff
  const minimumGate = text(record(authority.minimum.gateStates).demand, 80)
  const familyStatus = familyDemand(handoff.familyDemandStatus ??
    card.familyDemandStatus)
  const exactClaimed = authority.minimum.demandProven === true ||
    authority.marketTest.exactProductDemandClaimed === true
  const exactStatus = exactClaimed ? "PROVEN" as const : "UNPROVEN" as const
  const progressedPastDemand = (STAGE_INDEX.get(currentStage) ?? 0) >
    (STAGE_INDEX.get("DEMAND") ?? 0)
  const gateContinued = !card.demandNegativeEvidencePresent && !exactClaimed &&
    (card.marketTestPathEligible || card.marketTestReady ||
      minimumGate === "UNPROVEN_MARKET_TEST_ALLOWED" ||
      handoff.exactDemandStatus === "UNPROVEN" && progressedPastDemand)
  const radarOrigin = Object.keys(handoff).length > 0
  return Object.freeze({
    origin: radarOrigin ? "RADAR_HANDOFF" as const : "OTHER_OR_MANUAL" as const,
    familyDemand: familyStatus,
    exactProductDemand: exactStatus,
    demandGateContinued: gateContinued,
    route: gateContinued ? "MARKET_TEST" as const : "STANDARD" as const,
    presentationState: card.demandNegativeEvidencePresent
      ? "BLOCKED" as const : gateContinued ? "CONTINUES" as const
        : exactClaimed ? "PASS" as const : "WAITING" as const,
    familyDemandAuthority: radarOrigin
      ? "RADAR_LUNA_QUICK_PICK_HANDOFF_V1" as const
      : card.familyDemandStatus
        ? "QUICK_PICK_CURRENT_MARKET_PROJECTION" as const
        : "UNPROVEN" as const,
    exactDemandAuthority: radarOrigin
      ? "RADAR_HANDOFF_EXACT_DEMAND_STATUS" as const
      : minimumGate ? "MINIMUM_TRUTHFUL_LISTING_READINESS_V1" as const
        : "QUICK_PICK_CURRENT_STAGE_PROGRESSION" as const,
    demandGateAuthority: gateContinued
      ? minimumGate === "UNPROVEN_MARKET_TEST_ALLOWED"
        ? "MINIMUM_TRUTHFUL_LISTING_READINESS_V1" as const
        : "CURRENT_CANONICAL_STAGE_AFTER_DEMAND" as const
      : "CURRENT_QUICK_PICK_GATE_STATE" as const,
  })
}

function reconcileStages(card: LunaQuickPickCardV1,
  authority: ReturnType<typeof stateAuthority>) {
  const historical = normalizedStages(card)
  const currentStage = canonicalCurrentStage(card, authority)
  const blockerStage = trueBlockerStage(card, authority)
  const demand = demandSemantics(card, authority, currentStage)
  const terminalReady = card.marketTestReady ||
    ownerPublicationDecisionReady(card) || card.state === "READY"
  const stopStage = blockerStage ?? currentStage
  const stopIndex = STAGE_INDEX.get(stopStage) ?? 0
  const stages = Object.fromEntries(QUICK_PICK_OWNER_STAGE_CATALOG_V1.map(
    ([stage], index) => {
      if (stage === "DEMAND" && demand.presentationState === "CONTINUES") {
        return [stage, "CONTINUES"]
      }
      if (terminalReady) return [stage, "PASS"]
      if (index < stopIndex) return [stage, "PASS"]
      if (index > stopIndex) return [stage, "WAITING"]
      if (blockerStage === stage) return [stage, "BLOCKED"]
      return [stage, historical[stage] === "RUNNING" ? "RUNNING" : "WAITING"]
    })) as Record<string, StageState>
  const falseBlockedSuppressed = Object.keys(historical).filter((stage) =>
    historical[stage] === "BLOCKED" && stages[stage] !== "BLOCKED")
  return Object.freeze({ stages: Object.freeze(stages), historical,
    currentStage, blockerStage, demand,
    falseBlockedSuppressed: Object.freeze(falseBlockedSuppressed) })
}

function ownerPublicationDecisionReady(card: LunaQuickPickCardV1) {
  const listingReview = card.listingReview &&
    typeof card.listingReview === "object" ? card.listingReview as
      Record<string, unknown> : {}
  const handoff = listingReview.publishAuthorizationHandoff &&
    typeof listingReview.publishAuthorizationHandoff === "object"
    ? listingReview.publishAuthorizationHandoff as Record<string, unknown>
    : {}
  return handoff.ownerPublicationDecisionReady === true
}

export function projectQuickPickOwnerCardV1(card: LunaQuickPickCardV1,
  authorityRows: readonly StateAuthorityRow[] = []) {
  const authority = stateAuthority(card, authorityRows)
  const reconciled = reconcileStages(card, authority)
  const stages = reconciled.stages
  const technicalHistoricalBlockers = Object.freeze([...card.exactBlockers])
  const currentBlockers = reconciled.blockerStage ? technicalHistoricalBlockers
    : Object.freeze([])
  const semanticFields = Object.freeze({
    familyDemandStatus: Object.keys(authority.handoff).length
      ? `FAMILY_DEMAND_${reconciled.demand.familyDemand}` as
        LunaQuickPickCardV1["familyDemandStatus"]
      : card.familyDemandStatus,
    marketTestPathEligible: card.marketTestPathEligible ||
      reconciled.demand.demandGateContinued,
    demandSemantics: reconciled.demand,
    currentStageAuthority: "CURRENT_DURABLE_QUICK_PICK_OPERATION" as const,
    trueBlockerAuthority: "CURRENT_CANONICAL_BLOCKER_NOT_RAW_STAGE_DEFAULT" as const,
    stageEvaluationAuthority:
      "CURRENT_STAGE_PLUS_DURABLE_GATE_MARKERS" as const,
    technicalHistoricalStages: reconciled.historical,
    technicalHistoricalBlockers,
    falseBlockedStagesSuppressed: reconciled.falseBlockedSuppressed,
    exactBlocker: currentBlockers[0] ?? null,
    exactBlockers: currentBlockers,
  })
  if (card.marketTestReady || ownerPublicationDecisionReady(card)) {
    return Object.freeze({ ...card, ...semanticFields, state: "READY" as const,
      lastStage: "MARKET_TEST_READY",
      disposition: "MARKET_TEST_READY",
      exactBlocker: null, exactBlockers: Object.freeze([]), stages,
      processingLifecycle: "COMPLETED" as const,
      commercialStage: "MARKET_TEST_READY" as const })
  }
  if (card.state === "READY") {
    return Object.freeze({ ...card, ...semanticFields,
      disposition: "LISTING_READY", stages,
      processingLifecycle: "COMPLETED" as const,
      commercialStage: "LISTING_READY" as const })
  }
  const processingActive = card.state === "RUNNING" &&
    Object.values(stages).some((state) => state === "RUNNING")
  return Object.freeze({ ...card, ...semanticFields,
    state: card.state === "RUNNING" && !processingActive
      ? "WAITING" as const : card.state,
    disposition: card.state === "RUNNING" && !processingActive
      ? `WAITING_FOR_${card.lastStage}_CONTINUATION` : card.disposition,
    stages,
    processingLifecycle: processingActive ? "ACTIVE" as const
      : "COMPLETED" as const,
    commercialStage: card.disposition })
}

export function summarizeQuickPickOwnerCardsV1(
  cards: readonly ReturnType<typeof projectQuickPickOwnerCardV1>[],
) {
  return Object.freeze({
    inProgress: cards.filter((card) =>
      card.processingLifecycle === "ACTIVE").length,
    readyForReview: cards.filter((card) => card.state === "READY").length,
    blocked: cards.filter((card) => card.state === "BLOCKED").length,
    waiting: cards.filter((card) => card.state === "WAITING").length,
    total: cards.length,
  })
}

export function buildQuickPickOwnerReadModelV1(input: Readonly<{
  receipts: readonly Receipt[]
  selectedBatchCards: readonly LunaQuickPickCardV1[]
  globalQueueCards: readonly LunaQuickPickCardV1[]
  explicitCandidateScope: boolean
  authorityRows?: readonly StateAuthorityRow[]
}>) {
  const selectedReceipt = input.explicitCandidateScope
    ? null : input.receipts[0] ?? null
  const selectedBatchCards = Object.freeze(input.selectedBatchCards.map(
    (card) => projectQuickPickOwnerCardV1(card, input.authorityRows)))
  const globalQueueCards = Object.freeze(input.globalQueueCards.map(
    (card) => projectQuickPickOwnerCardV1(card, input.authorityRows)))
  const historicalReceipts = Object.freeze((selectedReceipt
    ? input.receipts.slice(1) : input.receipts).map((receipt) => Object.freeze({
      batchId: receipt.batchId,
      status: String(receipt.status ?? "UNPROVEN"),
      receivedAt: receipt.receivedAt ?? null,
      updatedAt: receipt.updatedAt ?? null,
      operationCount: receipt.cards.length,
    })))
  return Object.freeze({
    contractVersion: SELLER_OS_QUICK_PICK_OWNER_READ_MODEL_V1,
    selectedBatch: selectedReceipt ? Object.freeze({
      scope: "CURRENT_SELECTED_BATCH" as const,
      source: "LATEST_DURABLE_QUICK_PICK_BATCH_RECEIPT" as const,
      grain: "ONE_BATCH" as const,
      currentOrHistorical: String(selectedReceipt.status) === "running"
        ? "CURRENT" as const : "HISTORICAL_SNAPSHOT" as const,
      receipt: selectedReceipt,
      cards: selectedBatchCards,
      summary: summarizeQuickPickOwnerCardsV1(selectedBatchCards),
    }) : null,
    globalQueue: Object.freeze({
      scope: "GLOBAL_ACTIVE_QUEUE" as const,
      source: "DURABLE_QUICK_PICK_QUEUE_RECENT_BOUNDED" as const,
      grain: "ONE_DURABLE_OPERATION" as const,
      currentOrHistorical: "CURRENT" as const,
      cards: globalQueueCards,
      summary: summarizeQuickPickOwnerCardsV1(globalQueueCards),
    }),
    historicalBatches: Object.freeze({
      scope: "HISTORICAL_BATCHES" as const,
      source: "DURABLE_QUICK_PICK_BATCH_RECEIPTS" as const,
      grain: "ONE_BATCH" as const,
      currentOrHistorical: "HISTORICAL" as const,
      batches: historicalReceipts,
      excludedCardCount: historicalReceipts.reduce((count, receipt) =>
        count + receipt.operationCount, 0),
    }),
    certificationCanaryOperations: Object.freeze({
      scope: "CERTIFICATION_CANARY_OPERATIONS" as const,
      source: "NO_DURABLE_PURPOSE_DISCRIMINATOR_ON_LEGACY_RECEIPTS" as const,
      grain: "UNCLASSIFIED_LEGACY_BATCH_OPERATION" as const,
      currentOrHistorical: "HISTORICAL_UNCLASSIFIED" as const,
      excludedFromCurrentBatchCounts: true,
    }),
    countAuthority: Object.freeze({
      blocked: "GLOBAL_QUEUE_CURRENT_COMMERCIAL_STAGE",
      ready: "GLOBAL_QUEUE_CURRENT_COMMERCIAL_STAGE",
      working: "GLOBAL_QUEUE_REAL_ACTIVE_PROCESSING_LIFECYCLE",
      ownerReviewReady: "GLOBAL_QUEUE_OWNER_PUBLICATION_HANDOFF",
    }),
  })
}
