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

type StageState = "WAITING" | "RUNNING" | "PASS" | "BLOCKED"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
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

export function projectQuickPickOwnerCardV1(card: LunaQuickPickCardV1) {
  const stages = normalizedStages(card)
  if (card.marketTestReady || ownerPublicationDecisionReady(card)) {
    return Object.freeze({ ...card, state: "READY" as const,
      lastStage: "MARKET_TEST_READY",
      disposition: "MARKET_TEST_READY",
      exactBlocker: null,
      exactBlockers: Object.freeze([]),
      stages: Object.freeze({ ...stages, LISTING_READY: "PASS" as const }),
      processingLifecycle: "COMPLETED" as const,
      commercialStage: "MARKET_TEST_READY" as const })
  }
  if (card.state === "READY") {
    return Object.freeze({ ...card, disposition: "LISTING_READY",
      stages,
      processingLifecycle: "COMPLETED" as const,
      commercialStage: "LISTING_READY" as const })
  }
  const processingActive = card.state === "RUNNING" &&
    Object.values(stages).some((state) => state === "RUNNING")
  return Object.freeze({ ...card,
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
}>) {
  const selectedReceipt = input.explicitCandidateScope
    ? null : input.receipts[0] ?? null
  const selectedBatchCards = Object.freeze(input.selectedBatchCards.map(
    projectQuickPickOwnerCardV1))
  const globalQueueCards = Object.freeze(input.globalQueueCards.map(
    projectQuickPickOwnerCardV1))
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
