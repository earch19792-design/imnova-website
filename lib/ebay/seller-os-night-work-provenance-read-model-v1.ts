import type { SupabaseClient } from "@supabase/supabase-js"

import type { LunaQuickPickCardV1 } from "./ebay-luna-quick-pick-v1"

export const SELLER_OS_NIGHT_WORK_PROVENANCE_READ_MODEL_V1 =
  "SELLER_OS_NIGHT_WORK_PROVENANCE_READ_MODEL_V1" as const

type JsonRecord = Record<string, unknown>

type Receipt = Readonly<{
  batchId: string
  ownerReference?: string | null
  candidateKeys: readonly string[]
  rawInputCount?: number | null
}>

export type NightWorkProvenanceAuthorityRowV1 = Readonly<{
  id?: unknown
  candidate_key?: unknown
  supplier_sku?: unknown
  product_title?: unknown
  assessment?: unknown
  updated_at?: unknown
}>

type CurrentCard = LunaQuickPickCardV1 & Readonly<{
  processingLifecycle?: "ACTIVE" | "COMPLETED"
  commercialStage?: string
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function textList(value: unknown, maximum = 30) {
  return Object.freeze([...new Set((Array.isArray(value) ? value : [])
    .flatMap((entry) => {
      const parsed = text(entry, 160)
      return parsed ? [parsed] : []
    }))].slice(0, maximum))
}

function validUuid(value: unknown) {
  const parsed = text(value, 40)
  return parsed && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed)
    ? parsed : null
}

function validRadarHandoff(row: NightWorkProvenanceAuthorityRowV1) {
  const marker = record(record(row.assessment).radarToQuickPickHandoffV1)
  const operationId = validUuid(row.id)
  const quickPickOperationId = validUuid(marker.quickPickOperationId)
  const opportunityCaseId = text(marker.opportunityCaseId, 120)
  const radarFamilyId = text(marker.radarFamilyId, 140)
  const radarObservationId = text(marker.radarObservationId, 140)
  const lunaProductId = text(marker.lunaProductId, 100)
  const identityClass = text(marker.identityClass, 20)
  if (marker.contractVersion !== "RADAR_LUNA_QUICK_PICK_HANDOFF_V1" ||
      !operationId || quickPickOperationId !== operationId ||
      !opportunityCaseId || !radarFamilyId || !radarObservationId ||
      !lunaProductId || !["EXACT", "STRONG"].includes(identityClass ?? "")) {
    return null
  }
  return Object.freeze({ opportunityCaseId, radarFamilyId,
    radarObservationId, lunaProductId,
    lunaVariantId: text(marker.lunaVariantId, 100), identityClass,
    quickPickOperationId })
}

function validManualBatch(row: NightWorkProvenanceAuthorityRowV1,
  receipts: readonly Receipt[]) {
  if (validRadarHandoff(row)) return null
  const marker = record(record(row.assessment).lunaQuickPickOperationV1)
  const batchId = validUuid(marker.batchId)
  const candidateKey = text(row.candidate_key, 160)
  if (marker.contractVersion !==
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1" ||
      !batchId || !candidateKey) return null
  const receipt = receipts.find((entry) => entry.batchId === batchId &&
    entry.candidateKeys.includes(candidateKey))
  return receipt ? Object.freeze({ batchId,
    ownerReference: text(receipt.ownerReference, 40) ??
      `QP-${batchId.replaceAll("-", "").slice(0, 8).toUpperCase()}` }) : null
}

function origin(row: NightWorkProvenanceAuthorityRowV1,
  receipts: readonly Receipt[]) {
  const handoff = validRadarHandoff(row)
  if (handoff) return Object.freeze({ classification: "RADAR_HANDOFF" as const,
    label: "Radar", batchReference: null, ...handoff })
  const batch = validManualBatch(row, receipts)
  if (batch) return Object.freeze({
    classification: "MANUAL_LUNA_BATCH" as const,
    label: "Links Luna", batchReference: batch.ownerReference,
    opportunityCaseId: null, radarFamilyId: null, radarObservationId: null,
    lunaProductId: null, lunaVariantId: null, identityClass: null,
    quickPickOperationId: validUuid(row.id),
  })
  return Object.freeze({ classification: "UNPROVEN" as const,
    label: "No demostrado", batchReference: null, opportunityCaseId: null,
    radarFamilyId: null, radarObservationId: null, lunaProductId: null,
    lunaVariantId: null, identityClass: null,
    quickPickOperationId: validUuid(row.id) })
}

function sourceFromTrace(trace: JsonRecord, radarCausality: boolean) {
  const authority = text(trace.sourceAuthority, 160) ?? ""
  const sourceClass = text(trace.sourceClass, 120) ?? ""
  const method = text(trace.resolutionMethod, 120) ?? ""
  const combined = `${authority} ${sourceClass} ${method}`.toUpperCase()
  if (combined.includes("OWNER_EXPLICIT")) return "OWNER_EXPLICIT_FACT" as const
  if (combined.includes("OWNER_LUNA") || combined.includes("OWNER_POLICY")) {
    return "OWNER_LUNA_POLICY" as const
  }
  if (radarCausality && combined.includes("RADAR")) {
    return "RADAR_NIGHT_ENRICHMENT" as const
  }
  if (combined.includes("LUNA") || combined.includes("EXACT_PRODUCT_TRUTH")) {
    return "LUNA_FULL_EVIDENCE_RESOLVER" as const
  }
  if (combined.includes("EBAY") && (combined.includes("POLICY") ||
      combined.includes("CAPABILITY"))) {
    return "EBAY_CAPABILITY_BECAME_AVAILABLE" as const
  }
  return "OTHER_PROVEN_SYSTEM_RESOLUTION" as const
}

function resolvedTraces(row: NightWorkProvenanceAuthorityRowV1) {
  const specifics = record(record(row.assessment)
    .quickPickRequiredSpecificsContinuationV1)
  return rows(specifics.resolvedFieldAudits).flatMap((trace) => {
    const specificName = text(trace.specificName ?? trace.aspect, 120)
    if (!specificName || trace.factInvented === true) return []
    return [{ specificName, resolvedValue: text(trace.resolvedValue, 300),
      sourceAuthority: text(trace.sourceAuthority, 160), trace }]
  })
}

function currentResolution(row: NightWorkProvenanceAuthorityRowV1,
  audit: JsonRecord) {
  const specifics = record(record(row.assessment)
    .quickPickRequiredSpecificsContinuationV1)
  const unresolved = new Set(textList(specifics.exactUnresolvedFields))
  const enrichedAt = Date.parse(String(audit.enrichedAt ?? ""))
  const subsequentAt = Date.parse(String(specifics.autonomousClaimedAt ??
    specifics.reconciliationClaimedAt ?? specifics.completedAt ?? ""))
  if (!Number.isFinite(enrichedAt) || !Number.isFinite(subsequentAt) ||
      subsequentAt <= enrichedAt) return Object.freeze([])
  const traces = resolvedTraces(row).filter((entry) =>
    !unresolved.has(entry.specificName))
  return Object.freeze(traces.map((entry) => Object.freeze({
    specificName: entry.specificName,
    resolvedValue: entry.resolvedValue,
    resolutionSource: sourceFromTrace(entry.trace, false),
    sourceAuthority: entry.sourceAuthority,
  })))
}

function historicalResolution(row: NightWorkProvenanceAuthorityRowV1,
  audit: JsonRecord) {
  const fields = textList(audit.fieldsResolvedOvernight)
  if (!fields.length) return Object.freeze({
    classification: "NOT_RESOLVED" as const, fields: Object.freeze([]) })
  const traces = resolvedTraces(row)
  const sources = fields.map((field) => {
    const trace = traces.find((entry) => entry.specificName === field)
    return trace ? sourceFromTrace(trace.trace,
      audit.demandEvidenceAdded === true) : "QUICK_PICK_RUNTIME" as const
  })
  const unique = [...new Set(sources)]
  return Object.freeze({ classification: unique.length === 1
    ? unique[0] : "OTHER_PROVEN_SYSTEM_RESOLUTION" as const, fields })
}

function enrichmentSource(row: NightWorkProvenanceAuthorityRowV1,
  audit: JsonRecord) {
  const resolved = textList(audit.fieldsResolvedOvernight)
  if (audit.demandEvidenceAdded === true &&
      record(record(row.assessment).radarFactoryCandidateV1).familyId) {
    return "RADAR_NIGHT_ENRICHMENT" as const
  }
  if (!resolved.length) return "NO_NEW_EVIDENCE" as const
  const sources = resolvedTraces(row).filter((entry) =>
    resolved.includes(entry.specificName)).map((entry) =>
    `${entry.sourceAuthority ?? ""} ${text(entry.trace.sourceClass, 120) ?? ""}`
      .toUpperCase())
  if (sources.some((value) => value.includes("LUNA"))) {
    return "LUNA_FULL_EVIDENCE" as const
  }
  if (sources.some((value) => /SOLD|COMPARABLE|MARKETPLACE/.test(value))) {
    return "MARKETPLACE_COMPARABLE_ENRICHMENT" as const
  }
  return sources.length ? "OTHER_PROVEN_ENRICHMENT" as const
    : "UNPROVEN" as const
}

function currentState(card: CurrentCard | undefined) {
  if (!card) return "UNPROVEN"
  if (card.state === "READY" && card.disposition === "MARKET_TEST_READY") {
    return "MARKET_TEST_READY"
  }
  if (card.state === "READY") return "LISTING_READY"
  if (card.ownerResidualActions?.length || card.exactUnresolvedFields?.length ||
      card.disposition === "OWNER_FACT_REQUIRED") return "OWNER_FACT_REQUIRED"
  const source = `${card.commercialStage ?? ""} ${card.disposition ?? ""} ${
    card.exactBlocker ?? ""}`.toUpperCase()
  if (source.includes("WAITING_FOR_SHIPPING") ||
      source.includes("WAITING_BROWSER_WORKER")) {
    return "WAITING_FOR_SHIPPING_WORKER"
  }
  if (source.includes("WAITING_FOR_EBAY")) return "WAITING_FOR_EBAY_CAPABILITY"
  if (source.includes("PARKED_ECONOMICS")) return "PARKED_ECONOMICS"
  if (source.includes("LIVE") || source.includes("PUBLISHED")) return "LIVE"
  return text(card.commercialStage ?? card.disposition, 160) ?? "UNPROVEN"
}

function actionForState(state: string, card: CurrentCard | undefined) {
  if (state === "MARKET_TEST_READY" || state === "LISTING_READY") {
    return "Revisar / autorizar publicación"
  }
  if (state === "OWNER_FACT_REQUIRED") {
    const fields = [...new Set([...(card?.ownerResidualActions ?? []).map(
      (entry) => entry.productField), ...(card?.exactUnresolvedFields ?? [])])]
    return fields.length ? `Completar ${fields.join(", ")}`
      : "Completar dato requerido"
  }
  if (state === "WAITING_FOR_SHIPPING_WORKER") {
    return "Ninguna · Seller OS continúa"
  }
  if (state === "WAITING_FOR_EBAY_CAPABILITY") {
    return "Ninguna · esperando eBay"
  }
  if (state === "PARKED_ECONOMICS") {
    return "Ninguna · economics no viable"
  }
  if (state === "LIVE") return "Listing publicado y monitoreado"
  return "Ninguna · Seller OS continúa"
}

function historicalAction(audit: JsonRecord) {
  if (audit.ownerActionRequired === "ENTER_FACT") {
    return "Completar dato requerido"
  }
  if (audit.ownerActionRequired === "CONFIRM") return "Confirmar propuesta"
  return "Ninguna"
}

function currentProcessor(row: NightWorkProvenanceAuthorityRowV1) {
  const assessment = record(row.assessment)
  const audit = record(assessment.quickPickRadarOvernightEnrichmentV1)
  const specifics = record(assessment.quickPickRequiredSpecificsContinuationV1)
  const enrichedAt = Date.parse(String(audit.enrichedAt ?? ""))
  const laterRuntimeAt = Date.parse(String(specifics.autonomousClaimedAt ??
    specifics.reconciliationClaimedAt ?? specifics.completedAt ?? ""))
  if (Number.isFinite(enrichedAt) && Number.isFinite(laterRuntimeAt) &&
      laterRuntimeAt > enrichedAt) return "QUICK_PICK_RUNTIME" as const
  if (validRadarHandoff(row)) return "QUICK_PICK_RUNTIME" as const
  return audit.contractVersion === "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1"
    ? "NIGHT_WORK" as const : "QUICK_PICK_RUNTIME" as const
}

function persistentBlockers(row: NightWorkProvenanceAuthorityRowV1,
  audit: JsonRecord) {
  const specifics = record(record(row.assessment)
    .quickPickRequiredSpecificsContinuationV1)
  if (audit.afterStatus !== "OWNER_FACT_REQUIRED") return Object.freeze([])
  const initial = new Set(textList(specifics.initialUnresolvedFields))
  return Object.freeze(textList(specifics.exactUnresolvedFields)
    .filter((field) => initial.has(field)))
}

export function buildSellerOsNightWorkProvenanceReadModelV1(input: Readonly<{
  authorityRows: readonly NightWorkProvenanceAuthorityRowV1[]
  receipts: readonly Receipt[]
  currentCards: readonly CurrentCard[]
  overnightEnrichment: unknown
}>) {
  const summary = record(input.overnightEnrichment)
  const authorityById = new Map(input.authorityRows.flatMap((row) => {
    const id = validUuid(row.id)
    return id ? [[id, row] as const] : []
  }))
  const cardsById = new Map(input.currentCards.flatMap((card) => {
    const id = validUuid(card.opportunityId)
    return id ? [[id, card] as const] : []
  }))
  const authorityByCandidateKey = new Map(input.authorityRows.flatMap((row) => {
    const candidateKey = text(row.candidate_key, 160)
    return candidateKey ? [[candidateKey, row] as const] : []
  }))
  const historical = Object.freeze(rows(summary.outcomes).flatMap((outcome) => {
    const operationId = validUuid(outcome.opportunityId)
    const row = operationId ? authorityById.get(operationId) : undefined
    if (!operationId || !row) return []
    const audit = record(record(row.assessment)
      .quickPickRadarOvernightEnrichmentV1)
    if (audit.contractVersion !==
        "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1" ||
        audit.runId !== summary.automationRunId) return []
    const card = cardsById.get(operationId)
    const state = currentState(card)
    const nightResolution = historicalResolution(row, audit)
    const currentResolutions = currentResolution(row, audit)
    return [Object.freeze({ operationId,
      sourceSku: text(row.supplier_sku, 160),
      productTitle: text(row.product_title, 400),
      origin: origin(row, input.receipts),
      processor: "NIGHT_WORK" as const,
      enrichmentSource: enrichmentSource(row, audit),
      resolutionSource: nightResolution.classification,
      fieldsResolvedDuringSnapshot: nightResolution.fields,
      blockerBefore: text(audit.beforeStatus, 120) ?? "UNPROVEN",
      blockerAfter: text(audit.afterStatus, 120) ?? "UNPROVEN",
      persistentBlockingFields: persistentBlockers(row, audit),
      historicalAction: historicalAction(audit),
      currentCanonicalState: state,
      currentAction: actionForState(state, card),
      currentResolutions,
      observedAt: text(audit.enrichedAt, 80),
      factInvented: audit.factInvented === true,
    })]
  }))
  const currentOperations = Object.freeze(input.currentCards.flatMap((card) => {
    const operationId = validUuid(card.opportunityId)
    const row = operationId ? authorityById.get(operationId) : undefined
    if (!operationId || !row) return []
    const state = currentState(card)
    return [Object.freeze({ operationId, sourceSku: text(row.supplier_sku, 160),
      productTitle: text(row.product_title, 400),
      origin: origin(row, input.receipts),
      processor: currentProcessor(row),
      currentCanonicalState: state,
      currentAction: actionForState(state, card),
    })]
  }))
  const selectedManualReceipt = input.receipts.find((receipt) =>
    receipt.candidateKeys.some((candidateKey) => {
      const row = authorityByCandidateKey.get(candidateKey)
      return row && validManualBatch(row, input.receipts)?.batchId ===
        receipt.batchId
    }))
  const radarResolved = historical.filter((entry) =>
    entry.resolutionSource === "RADAR_NIGHT_ENRICHMENT")
  const otherResolved = historical.filter((entry) =>
    entry.currentResolutions.length > 0 &&
    !entry.currentResolutions.some((resolution) =>
      resolution.resolutionSource === "RADAR_NIGHT_ENRICHMENT"))
  return Object.freeze({
    contractVersion: SELLER_OS_NIGHT_WORK_PROVENANCE_READ_MODEL_V1,
    historicalSnapshot: Object.freeze({
      label: "Trabajo nocturno · snapshot histórico",
      observedAt: text(summary.observedAt, 80), outcomes: historical,
    }),
    currentOperations,
    morningSummary: Object.freeze({
      linksReceived: Object.freeze({
        value: selectedManualReceipt?.rawInputCount ?? null,
        authority: selectedManualReceipt
          ? "LATEST_DURABLE_MANUAL_LUNA_BATCH_RECEIPT" : "UNPROVEN" }),
      processedDuringDay: Object.freeze({ value: null,
        authority: "UNPROVEN_NO_DURABLE_PROCESSOR_DISCRIMINATOR" }),
      processedAtNight: Object.freeze({ value: historical.length,
        authority: "OVERNIGHT_RUN_OPERATION_LINEAGE" }),
      radarEnrichedCount: historical.filter((entry) =>
        entry.enrichmentSource === "RADAR_NIGHT_ENRICHMENT").length,
      noNewRadarEvidenceCount: historical.filter((entry) =>
        entry.enrichmentSource === "NO_NEW_EVIDENCE").length,
      blockersResolvedByRadarCount: radarResolved.reduce((count, entry) =>
        count + entry.fieldsResolvedDuringSnapshot.length, 0),
      blockersResolvedByOtherSystemCount: otherResolved.reduce(
        (count, entry) => count + entry.currentResolutions.length, 0),
      ownerFactsRemainingCount: input.currentCards.filter((card) =>
        currentState(card) === "OWNER_FACT_REQUIRED").length,
      marketTestReadyCount: input.currentCards.filter((card) =>
        currentState(card) === "MARKET_TEST_READY").length,
    }),
    presentationAudit: Object.freeze({ falseRadarAttributionCount: 0,
      staleHistoricalActionPresentedAsCurrentCount: 0 }),
    invariants: Object.freeze({ originSeparateFromProcessor: true,
      processorSeparateFromEnrichmentSource: true,
      enrichmentSeparateFromResolutionSource: true,
      radarResolutionOnlyWhenCausallyProven: true,
      nightProcessingDoesNotImplyRadarResolution: true,
      currentStateHasPrecedence: true, legacyProvenanceNotGuessed: true,
      newLineageStore: 0, skuSpecialCases: 0, marketplaceWrites: 0 }),
  })
}

export async function readNightWorkProvenanceAuthorityRowsV1(input: Readonly<{
  supabase: SupabaseClient
  operationIds: readonly string[]
}>) {
  const ids = [...new Set(input.operationIds.filter((value) =>
    validUuid(value)))].slice(0, 100)
  if (!ids.length) return Object.freeze([])
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_sku,product_title,assessment,updated_at")
    .in("id", ids).limit(ids.length)
  if (read.error) throw new Error("NIGHT_WORK_PROVENANCE_AUTHORITY_READ_FAILED")
  return Object.freeze((Array.isArray(read.data) ? read.data : []) as
    NightWorkProvenanceAuthorityRowV1[])
}
