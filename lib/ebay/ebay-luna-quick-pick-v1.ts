import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit
  // extension; the production bundler resolves the same source module.
  "./ebay-luna-quick-pick-required-specifics-v1.ts"

import {
  fetchDirectedLunaProduct,
  parseDirectedLunaProductUrl,
  type DirectedLunaProduct,
} from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-luna-directed-product-import.ts"
import {
  buildRadarRevenueFactoryCandidateBatchV1,
  ensureRadarCandidateEconomicsPreflightsV1,
  materializeRadarRevenueFactoryCandidateBatchV1,
  readAlreadyLiveExactLunaIdentitiesV1,
  readRadarRevenueFactoryLunaCatalogV1,
  type RadarRevenueFactoryCandidateV1,
} from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1.ts"
import type { RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1.ts"
import {
  discoverAndPersistSellerOsOnDemandFamilyDemandV1,
  type SellerOsOnDemandFamilyDemandDiscoveryResultV1,
} from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-demand-first-broad-net-orchestrator-v1.ts"
import { buildQuickPickMarketTestListingReviewV1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit
  // extension; the production bundler resolves the same source module.
  "./ebay-quick-pick-market-test-package-v1.ts"
import { projectQuickPickOvernightEligibilityV1 } from
  "./ebay-quick-pick-radar-overnight-enrichment-v1"
import { MINIMUM_TRUTHFUL_LISTING_READINESS_V1 } from
  "./ebay-minimum-truthful-listing-readiness-v1"
import { ownerExplicitProductTruthFactsV1 } from
  "./ebay-human-product-truth-evidence-v1"

export const LUNA_QUICK_PICK_FAST_LISTING_V1 =
  "LUNA_QUICK_PICK_FAST_LISTING_V1" as const
export const LUNA_QUICK_PICK_MAX_INPUTS = 20
export const LUNA_QUICK_PICK_CONCURRENCY = 4
export const LUNA_QUICK_PICK_DEMAND_DISCOVERY_CONCURRENCY = 2
export const QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1 =
  "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1" as const
export const QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1 =
  "QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1" as const

type JsonRecord = Record<string, unknown>
type RadarBatch = ReturnType<typeof buildRadarRevenueFactoryCandidateBatchV1>

export function classifyLunaQuickPickDemandDiscoveryV1(
  result: SellerOsOnDemandFamilyDemandDiscoveryResultV1,
) {
  if (result.demandNegativeEvidencePresent) {
    return "BLOCK_NEGATIVE_DEMAND" as const
  }
  if (result.marketTestRadarFamily &&
      result.status === "FAMILY_DEMAND_UNPROVEN") {
    return "CONTINUE_DEMAND_UNPROVEN" as const
  }
  if (result.familyBindingCreatedOrReused ||
      ["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
        .includes(result.status)) {
    return "CONTINUE_DEMAND_EVIDENCE" as const
  }
  return "BLOCK_DEMAND_UNRESOLVED" as const
}

export type LunaQuickPickVariantV1 = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  title: string
  available: boolean
  supplierCostUsd: number
}>

export type LunaQuickPickSupplierIdentityV1 = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
}>

export type LunaQuickPickCardV1 = Readonly<{
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
  exactBlockers: readonly string[]
  variantSelectionRequired: boolean
  variants: readonly LunaQuickPickVariantV1[]
  alreadyLive: boolean
  linkedLiveItemIds: readonly string[]
  durableFamilyHit: boolean
  onDemandDemandDiscoveryRequired: boolean
  onDemandDemandDiscoveryExecuted: boolean
  soldComparableCount: number
  familyDemandStatus: "FAMILY_DEMAND_PROVEN" | "FAMILY_DEMAND_SUPPORTED" |
    "FAMILY_DEMAND_UNPROVEN" | "FAMILY_DEMAND_UNAVAILABLE" |
    "DEMAND_NOT_PROVEN" | "DEMAND_DISCOVERY_UNAVAILABLE" | null
  familyBindingCreatedOrReused: boolean
  demandEvidenceClass: "PROVEN_OR_SUPPORTED" |
    "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE" | null
  demandNegativeEvidencePresent: boolean
  marketTestPathEligible: boolean
  marketTestReady: boolean
  marketTestReview: JsonRecord | null
  requiredItemSpecificsCount: number | null
  requiredItemSpecificsSatisfied: number | null
  requiredItemSpecificsReady: boolean | null
  unresolvedRequiredAspects: readonly string[]
  deterministicResolvedCount: number
  marketplaceFallbackResolvedCount: number
  aiCallCount: number
  aiAspectsResolvedCount: number
  factInvented: false
  automaticResolutionExhausted: boolean
  automaticResolutionContractCurrent: boolean
  automaticResolutionUpgradeHasPriorResidual: boolean
  exactUnresolvedFields: readonly string[]
  ownerResidualActions: readonly JsonRecord[]
  ownerTruePublicationBlockers: readonly JsonRecord[]
  ownerCapturedFacts: readonly JsonRecord[]
  postPublishEnrichmentOpportunities: readonly JsonRecord[]
  nextOwnerAction: "CONFIRM" | "ENTER_FACT" | null
  minimumTruthfulListingReady: boolean
  officialRequirementClassification: boolean
  requirementCounts: Readonly<{
    requiredToList: number
    conditionallyRequired: number
    recommended: number
    optional: number
    unproven: number
  }>
  productIdentifierRequirementStatus: "PASS" | "BLOCKED_REQUIRED_FACT" |
    "UNPROVEN_CAPABILITY" | null
  safeResumeAfterOwnerFact: boolean
  marketplaceReadinessReady: boolean
  conditionReady: boolean | null
  shippingUsd: number | null
  rehydrated: boolean
  updatedAt: string | null
  stages: Readonly<Record<string, "WAITING" | "RUNNING" | "PASS" | "BLOCKED">>
  dollarCheck: JsonRecord | null
  listingReview: JsonRecord | null
  overnightEnrichmentPending: boolean
  overnightEnrichmentStatus: string | null
  overnightEnrichmentLastRunAt: string | null
  elapsedMs: number
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

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function textList(value: unknown, maximum = 50) {
  return Array.isArray(value) ? [...new Set(value.flatMap((entry) => {
    const parsed = text(entry, 160)
    return parsed ? [parsed] : []
  }))].slice(0, maximum) : []
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function identityKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "LUNA_QUICK_PICK_PROCESSING_FAILED"
}

function actionable(value: unknown) {
  const candidate = text(value, 120)
  return candidate && candidate !== "NONE" ? candidate : null
}

function canonicalRowUrl(row: JsonRecord) {
  try {
    return parseDirectedLunaProductUrl(row.product_url).canonicalUrl
  } catch {
    return null
  }
}

function sourceUrlWithVariant(canonicalUrl: string, variantId: string) {
  if (!variantId) return canonicalUrl
  try {
    const parsed = new URL(canonicalUrl)
    parsed.searchParams.set("variant", variantId)
    return parsed.toString()
  } catch {
    return canonicalUrl
  }
}

function supplierIdentityKeyV1(value: Readonly<{
  lunaProductId?: string | null
  lunaVariantId?: string | null
  supplierSku?: string | null
}>) {
  return value.lunaProductId && value.lunaVariantId && value.supplierSku
    ? identityKey(value.lunaProductId, value.lunaVariantId, value.supplierSku)
    : null
}

export function isRehydratableQuickPickOperationV1(input: Readonly<{
  assessment: unknown
  durableFamilyIds: ReadonlySet<string>
}>) {
  const assessment = record(input.assessment)
  const marker = record(assessment.lunaQuickPickOperationV1)
  if (marker.contractVersion ===
      QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1) return true
  if (Object.keys(record(assessment.quickPickMarketTestReviewV1)).length) {
    return true
  }
  const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
  const familyId = text(record(assessment.radarFactoryCandidateV1).familyId, 120)
  return shipping.contractVersion ===
    "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1" &&
    Boolean(familyId) && !input.durableFamilyIds.has(familyId as string)
}

async function persistQuickPickOperationV1(input: Readonly<{
  supabase: SupabaseClient
  sourceUrl: string
  canonicalUrl: string
  candidateId: string
  candidateKey: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  batchId?: string | null
}>) {
  const existing = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment")
    .eq("candidate_key", input.candidateKey)
    .eq("supplier_product_id", input.lunaProductId)
    .eq("supplier_variant_id", input.lunaVariantId)
    .eq("supplier_sku", input.supplierSku).limit(2)
  if (existing.error || rows(existing.data).length !== 1) {
    throw new Error("LUNA_QUICK_PICK_OPERATION_IDENTITY_READ_FAILED")
  }
  const row = rows(existing.data)[0]
  const assessment = record(row.assessment)
  const previous = record(assessment.lunaQuickPickOperationV1)
  const now = new Date().toISOString()
  const marker = Object.freeze({
    contractVersion: QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl,
    candidateId: input.candidateId,
    candidateKey: input.candidateKey,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    supplierSku: input.supplierSku,
    firstObservedAt: text(previous.firstObservedAt, 80) ?? now,
    lastSubmittedAt: now,
    ownerSurface: "/admin/ebay/quick-pick",
    batchId: text(input.batchId, 80),
    marketplaceWrites: 0 as const,
  })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...assessment, lunaQuickPickOperationV1: marker },
      updated_at: now })
    .eq("id", row.id).eq("candidate_key", input.candidateKey)
    .select("id,candidate_key,assessment").single()
  const readback = record(record(write.data).assessment)
    .lunaQuickPickOperationV1
  if (write.error || !write.data || record(readback).candidateKey !==
      input.candidateKey || record(readback).contractVersion !==
      QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1) {
    throw new Error("LUNA_QUICK_PICK_OPERATION_DURABLE_WRITE_FAILED")
  }
}

function explicitVariantId(value: string) {
  try {
    const variant = new URL(value).searchParams.get("variant")?.trim() ?? ""
    return /^\d{1,30}$/.test(variant) ? variant : null
  } catch {
    return null
  }
}

export function normalizeLunaQuickPickUrlsV1(value: unknown) {
  const collected = collectLunaQuickPickInputsV1(value)
  if (collected.invalid.length) throw new Error("LUNA_QUICK_PICK_URL_INVALID")
  return collected.urls
}

export function collectLunaQuickPickInputsV1(value: unknown): Readonly<{
  rawInputCount: number
  urls: readonly string[]
  invalid: readonly Readonly<{ sourceUrl: string; blocker: string }>[]
}> {
  const input = Array.isArray(value) ? value : typeof value === "string"
    ? value.split(/\r?\n/) : []
  const rawInputs = input.flatMap((entry) => text(entry, 2_000)
    ? [entry] : [])
  if (rawInputs.length > LUNA_QUICK_PICK_MAX_INPUTS) {
    throw new Error("LUNA_QUICK_PICK_INPUT_LIMIT_EXCEEDED")
  }
  const normalized = new Map<string, string>()
  const invalid: Readonly<{ sourceUrl: string; blocker: string }>[] = []
  for (const entry of rawInputs) {
    const source = text(entry, 2_000)
    if (!source) continue
    try {
      const parsed = parseDirectedLunaProductUrl(source)
      const variant = explicitVariantId(source)
      const key = `${parsed.canonicalUrl}\n${variant ?? ""}`
      if (!normalized.has(key)) normalized.set(key, source)
    } catch {
      invalid.push(Object.freeze({ sourceUrl: source,
        blocker: "LUNA_QUICK_PICK_URL_INVALID" }))
    }
  }
  if (!normalized.size && !invalid.length) {
    throw new Error("LUNA_QUICK_PICK_URL_REQUIRED")
  }
  return Object.freeze({ rawInputCount: rawInputs.length,
    urls: Object.freeze([...normalized.values()]),
    invalid: Object.freeze(invalid) })
}

function batchInputReceiptV1(sourceUrl: string) {
  const parsed = parseDirectedLunaProductUrl(sourceUrl)
  const variantId = explicitVariantId(sourceUrl)
  const canonicalUrl = parsed.canonicalUrl
  return Object.freeze({ inputId: digest({ canonicalUrl, variantId }),
    canonicalUrl, variantId, status: "WAITING" as const })
}

function ownerBatchReferenceV1(batchId: string) {
  return `QP-${batchId.replaceAll("-", "").slice(0, 8).toUpperCase()}`
}

function batchCardSnapshotV1(value: LunaQuickPickCardV1) {
  return Object.freeze({ sourceUrl: value.sourceUrl,
    canonicalUrl: value.canonicalUrl, sourceSku: value.sourceSku,
    lunaProductId: value.lunaProductId, lunaVariantId: value.lunaVariantId,
    candidateId: value.candidateId, candidateKey: value.candidateKey,
    opportunityId: value.opportunityId, listingPackageId: value.listingPackageId,
    title: value.title, state: value.state, lastStage: value.lastStage,
    disposition: value.disposition, exactBlocker: value.exactBlocker,
    exactBlockers: value.exactBlockers,
    variantSelectionRequired: value.variantSelectionRequired,
    variants: value.variants, alreadyLive: value.alreadyLive,
    linkedLiveItemIds: value.linkedLiveItemIds, stages: value.stages,
    minimumTruthfulListingReady: value.minimumTruthfulListingReady,
    officialRequirementClassification:
      value.officialRequirementClassification,
    requirementCounts: value.requirementCounts,
    ownerTruePublicationBlockers: value.ownerTruePublicationBlockers,
    ownerCapturedFacts: value.ownerCapturedFacts,
    postPublishEnrichmentOpportunities:
      value.postPublishEnrichmentOpportunities,
    productIdentifierRequirementStatus:
      value.productIdentifierRequirementStatus,
    safeResumeAfterOwnerFact: value.safeResumeAfterOwnerFact,
    listingReview: value.listingReview,
    overnightEnrichmentPending: value.overnightEnrichmentPending,
    overnightEnrichmentStatus: value.overnightEnrichmentStatus,
    overnightEnrichmentLastRunAt: value.overnightEnrichmentLastRunAt,
    updatedAt: value.updatedAt ?? new Date().toISOString(),
    marketplaceWrites: 0 as const })
}

export async function receiveLunaQuickPickBatchV1(input: Readonly<{
  supabase: SupabaseClient
  urls: unknown
}>) {
  const collected = collectLunaQuickPickInputsV1(input.urls)
  const inputs = collected.urls.map(batchInputReceiptV1)
  const startedAt = new Date().toISOString()
  const metrics = Object.freeze({
    contractVersion: QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1,
    rawInputCount: collected.rawInputCount,
    urlDedupedCount: collected.urls.length,
    rejectedInputCount: collected.invalid.length,
    durableOperationCount: 0,
    exactProductCount: 0,
    duplicateOperationCount: 0,
    inputs,
    candidateKeys: Object.freeze([]),
    cards: Object.freeze([]),
    receiptStatus: "RECEIVED",
    marketplaceWrites: 0,
  })
  const write = await input.supabase.from("ebay_seller_automation_runs")
    .insert({ run_kind: "manual_acceleration", trigger_source: "admin",
      status: "running", lanes: ["quick_pick"], metrics,
      heartbeat_at: startedAt })
    .select("id,status,metrics,started_at").single()
  const stored = record(write.data)
  if (write.error || !write.data ||
      record(stored.metrics).contractVersion !==
        QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1) {
    throw new Error("LUNA_QUICK_PICK_BATCH_RECEIPT_WRITE_FAILED")
  }
  const batchId = String(stored.id)
  return Object.freeze({ batchId, ownerReference: ownerBatchReferenceV1(batchId),
    status: "RECEIVED" as const, rawInputCount: collected.rawInputCount,
    urlDedupedCount: collected.urls.length,
    rejectedInputCount: collected.invalid.length,
    durableOperationCount: 0, exactProductCount: 0,
    duplicateOperationCount: 0, receivedAt: text(stored.started_at, 80),
    cards: Object.freeze(inputs.map((entry) => card({
      sourceUrl: sourceUrlWithVariant(entry.canonicalUrl,
        entry.variantId ?? ""), canonicalUrl: entry.canonicalUrl,
      state: "WAITING", lastStage: "IDENTITY",
      disposition: "WAITING_FOR_IDENTITY_CONTINUATION",
      stages: emptyStages({ IDENTITY: "WAITING" }),
    }))) })
}

export async function completeLunaQuickPickBatchReceiptV1(input: Readonly<{
  supabase: SupabaseClient
  batchId: string
  result?: Readonly<{ cards: readonly LunaQuickPickCardV1[] }>
  failureCode?: string | null
}>) {
  if (!/^[0-9a-f-]{36}$/.test(input.batchId)) {
    throw new Error("LUNA_QUICK_PICK_BATCH_ID_INVALID")
  }
  const currentRead = await input.supabase.from("ebay_seller_automation_runs")
    .select("id,status,lanes,metrics").eq("id", input.batchId)
    .eq("run_kind", "manual_acceleration").contains("lanes", ["quick_pick"])
    .maybeSingle()
  const current = record(currentRead.data)
  const metrics = record(current.metrics)
  if (currentRead.error || !currentRead.data ||
      metrics.contractVersion !== QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1) {
    throw new Error("LUNA_QUICK_PICK_BATCH_RECEIPT_NOT_FOUND")
  }
  const cards = [...(input.result?.cards ?? [])]
  const candidateKeys = [...new Set(cards.flatMap((entry) =>
    entry.candidateKey ? [entry.candidateKey] : []))]
  const failureCode = actionable(input.failureCode)
  const now = new Date().toISOString()
  const nextMetrics = { ...metrics,
    durableOperationCount: candidateKeys.length,
    exactProductCount: new Set(cards.flatMap((entry) => entry.sourceSku &&
      entry.lunaProductId && entry.lunaVariantId
      ? [identityKey(entry.lunaProductId, entry.lunaVariantId,
        entry.sourceSku)] : [])).size,
    duplicateOperationCount: 0,
    duplicateInputCount: cards.filter((entry) =>
      entry.disposition === "EXCLUDED_DUPLICATE_INPUT").length,
    candidateKeys, cards: cards.map(batchCardSnapshotV1),
    receiptStatus: failureCode ? "FAILED" : "MATERIALIZED",
    safeFailureCode: failureCode,
    updatedAt: now,
  }
  const status = failureCode ? "failed" : "completed"
  const write = await input.supabase.from("ebay_seller_automation_runs")
    .update({ status, metrics: nextMetrics, last_error_code: failureCode,
      heartbeat_at: now, completed_at: now }).eq("id", input.batchId)
    .eq("run_kind", "manual_acceleration")
    .select("id,status,metrics").single()
  if (write.error || !write.data || record(record(write.data).metrics)
      .receiptStatus !== nextMetrics.receiptStatus) {
    throw new Error("LUNA_QUICK_PICK_BATCH_RECEIPT_UPDATE_FAILED")
  }
  return Object.freeze({ batchId: input.batchId,
    ownerReference: ownerBatchReferenceV1(input.batchId), status,
    ...nextMetrics })
}

export async function readLunaQuickPickBatchReceiptsV1(input: Readonly<{
  supabase: SupabaseClient
  limit?: number
}>) {
  const limit = Math.max(1, Math.min(20, input.limit ?? 10))
  const read = await input.supabase.from("ebay_seller_automation_runs")
    .select("id,status,metrics,last_error_code,started_at,heartbeat_at,completed_at")
    .eq("run_kind", "manual_acceleration").contains("lanes", ["quick_pick"])
    .order("started_at", { ascending: false }).limit(limit)
  if (read.error) throw new Error("LUNA_QUICK_PICK_BATCH_RECEIPT_READ_FAILED")
  return Object.freeze(rows(read.data).flatMap((row) => {
    const metrics = record(row.metrics)
    if (metrics.contractVersion !==
        QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1) return []
    const batchId = String(row.id)
    const storedCards = rows(metrics.cards)
    const inputs = rows(metrics.inputs)
    const materializedInputIds = new Set(storedCards.flatMap((entry) => {
      const canonicalUrl = text(entry.canonicalUrl, 2_000)
      if (!canonicalUrl) return []
      return [digest({ canonicalUrl,
        variantId: explicitVariantId(String(entry.sourceUrl ?? "")) })]
    }))
    const waitingCards = inputs.filter((entry) =>
      !materializedInputIds.has(String(entry.inputId))).flatMap((entry) => {
      const canonicalUrl = text(entry.canonicalUrl, 2_000)
      if (!canonicalUrl) return []
      const failed = row.status === "failed"
      return [card({ sourceUrl: sourceUrlWithVariant(canonicalUrl,
        text(entry.variantId, 40) ?? ""), canonicalUrl,
      state: failed ? "BLOCKED" : "RUNNING",
      lastStage: "IDENTITY", disposition: failed ? "BLOCKED" : "RUNNING",
      exactBlocker: failed ? text(row.last_error_code, 120) : null,
      stages: emptyStages({ IDENTITY: failed ? "BLOCKED" : "RUNNING" }),
      rehydrated: true,
      updatedAt: text(row.heartbeat_at, 80) })]
    })
    return [Object.freeze({ batchId,
      ownerReference: ownerBatchReferenceV1(batchId), status: row.status,
      rawInputCount: number(metrics.rawInputCount),
      urlDedupedCount: number(metrics.urlDedupedCount),
      rejectedInputCount: number(metrics.rejectedInputCount),
      durableOperationCount: number(metrics.durableOperationCount),
      exactProductCount: number(metrics.exactProductCount),
      duplicateOperationCount: number(metrics.duplicateOperationCount),
      unprovenInputCount: number(metrics.unmaterializedInputCount),
      unprovenInputDisposition:
        text(metrics.unmaterializedInputDisposition, 120),
      countEvidenceClass: text(metrics.countEvidenceClass, 120) ??
        "DURABLE_BATCH_RECEIPT",
      candidateKeys: Object.freeze(Array.isArray(metrics.candidateKeys)
        ? metrics.candidateKeys.flatMap((value) => text(value, 120)
          ? [String(value)] : []) : []),
      cards: Object.freeze([...storedCards.map((entry) =>
        reconcileLunaQuickPickCardLivenessV1(card({
        ...entry, sourceUrl: String(entry.sourceUrl ?? "quick-pick:unknown"),
        rehydrated: true,
      }))), ...waitingCards.map(reconcileLunaQuickPickCardLivenessV1)]),
      receivedAt: text(row.started_at, 80),
      updatedAt: text(row.heartbeat_at, 80),
      safeFailureCode: text(row.last_error_code, 120),
    })]
  }))
}

export async function readLunaQuickPickBatchRehydrationV1(input: Readonly<{
  supabase: SupabaseClient
  batchId: string
}>) {
  if (!/^[0-9a-f-]{36}$/.test(input.batchId)) {
    throw new Error("LUNA_QUICK_PICK_BATCH_ID_INVALID")
  }
  const read = await input.supabase.from("ebay_seller_automation_runs")
    .select("id,metrics,started_at,heartbeat_at").eq("id", input.batchId)
    .eq("run_kind", "manual_acceleration").contains("lanes", ["quick_pick"])
    .maybeSingle()
  const row = record(read.data)
  const metrics = record(row.metrics)
  if (read.error || !read.data || metrics.contractVersion !==
      QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1) {
    throw new Error("LUNA_QUICK_PICK_BATCH_RECEIPT_NOT_FOUND")
  }
  const inputs = rows(metrics.inputs)
  const urls = inputs.flatMap((entry) => {
    const canonicalUrl = text(entry.canonicalUrl, 2_000)
    if (!canonicalUrl) return []
    return [sourceUrlWithVariant(canonicalUrl,
      text(entry.variantId, 40) ?? "")]
  })
  if (urls.length !== inputs.length || urls.length < 1 ||
      urls.length > LUNA_QUICK_PICK_MAX_INPUTS) {
    throw new Error("LUNA_QUICK_PICK_BATCH_REHYDRATION_INPUT_UNPROVEN")
  }
  const capabilityGaps = new Map<string, Readonly<{
    lunaProductId: string
    lunaVariantId: string
    supplierSku: string
    reasonCode: "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED" |
      "ON_DEMAND_MARKETPLACE_INSIGHTS_UNAVAILABLE"
    observedAt: string | null
  }>>()
  const rehydrateUrls: string[] = []
  const storedCards = rows(metrics.cards).map((stored) =>
    reconcileLunaQuickPickCardLivenessV1(card({
      ...stored,
      sourceUrl: String(stored.sourceUrl ?? "quick-pick:unknown"),
      rehydrated: true,
    })))
  for (const stored of rows(metrics.cards)) {
    const reasonCode = stored.exactBlocker
    if (reasonCode !== "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED" &&
        reasonCode !== "ON_DEMAND_MARKETPLACE_INSIGHTS_UNAVAILABLE") continue
    const lunaProductId = text(stored.lunaProductId, 80)
    const lunaVariantId = text(stored.lunaVariantId, 80)
    const supplierSku = text(stored.sourceSku, 120)
    const key = supplierIdentityKeyV1({ lunaProductId, lunaVariantId,
      supplierSku })
    if (key) capabilityGaps.set(key, Object.freeze({
      lunaProductId: lunaProductId as string,
      lunaVariantId: lunaVariantId as string,
      supplierSku: supplierSku as string,
      reasonCode,
      observedAt: text(stored.updatedAt, 80) ??
        text(row.heartbeat_at, 80) ?? text(row.started_at, 80) }))
    const sourceUrl = text(stored.sourceUrl, 2_000)
    if (key && sourceUrl) rehydrateUrls.push(sourceUrl)
  }
  if (rehydrateUrls.length !== capabilityGaps.size) {
    throw new Error("LUNA_QUICK_PICK_CAPABILITY_GAP_INPUTS_UNPROVEN")
  }
  return Object.freeze({
    batchId: input.batchId,
    originalBatchOperationCount: inputs.length,
    urls: Object.freeze(urls),
    rehydrateUrls: Object.freeze(rehydrateUrls),
    storedCards: Object.freeze(storedCards),
    capabilityGaps,
    newOperationCount: 0 as const,
    duplicateOperationCount: 0 as const,
  })
}

function publicProductRows(product: DirectedLunaProduct, observedAt: string) {
  return product.variants.map((variant) => ({
    product_id: product.productId,
    supplier_product_id: product.productId,
    supplier_variant_id: variant.id,
    sku: variant.sku,
    title: product.title,
    variant_title: variant.title,
    product_type: product.productType,
    tags: [], metadata: {}, price: variant.sourceUnitPrice,
    available: variant.available,
    inventory_quantity: variant.sourceInventoryQuantityExplicit
      ? variant.sourceInventoryQuantity : null,
    product_url: product.canonicalUrl,
    image_urls: product.imageUrls,
    barcode: variant.sourceUnitBarcode,
    captured_at: observedAt,
  }))
}

async function mapBounded<T, R>(values: readonly T[], concurrency: number,
  operation: (value: T) => Promise<R>) {
  const result: R[] = new Array(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        result[index] = await operation(values[index])
      }
    }))
  return result
}

type ResolvedInput = Readonly<{
  sourceUrl: string
  canonicalUrl: string
  title: string
  variants: readonly LunaQuickPickVariantV1[]
  selected: LunaQuickPickVariantV1 | null
  selectedRow: JsonRecord | null
  blocker: string | null
  sourceClass: "DURABLE_LUNA_CATALOG_EXACT_ROW" |
    "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK"
}>

type ResolutionAttempt = Readonly<{
  result: ResolvedInput | null
  error: string | null
}>

export async function resolveLunaQuickPickInputV1(input: Readonly<{
  sourceUrl: string
  catalogRows: readonly JsonRecord[]
  selectedVariantId?: string | null
  fetchImpl?: typeof fetch
}>): Promise<ResolvedInput> {
  const parsed = parseDirectedLunaProductUrl(input.sourceUrl)
  let matchingRows = input.catalogRows.filter((row) =>
    canonicalRowUrl(row) === parsed.canonicalUrl)
  let sourceClass: ResolvedInput["sourceClass"] =
    "DURABLE_LUNA_CATALOG_EXACT_ROW"
  if (!matchingRows.length) {
    const product = await fetchDirectedLunaProduct(input.sourceUrl,
      input.fetchImpl ?? fetch)
    matchingRows = publicProductRows(product, new Date().toISOString())
    sourceClass = "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK"
  }
  const variants = matchingRows.flatMap((row) => {
    const productId = text(row.supplier_product_id) ?? text(row.product_id)
    const variantId = text(row.supplier_variant_id)
    const sku = text(row.sku, 120)
    const price = number(row.price)
    if (!productId || !variantId || !/^\d{1,30}$/.test(productId) ||
        !/^\d{1,30}$/.test(variantId) || !sku || price === null || price <= 0) {
      return []
    }
    return [Object.freeze({ lunaProductId: productId,
      lunaVariantId: variantId, supplierSku: sku,
      title: text(row.variant_title, 200) ?? "Variante general",
      available: row.available === true &&
        (number(row.inventory_quantity) === null ||
          Number(row.inventory_quantity) > 0),
      supplierCostUsd: price })]
  })
  const unique = [...new Map(variants.map((variant) => [
    identityKey(variant.lunaProductId, variant.lunaVariantId,
      variant.supplierSku), variant])).values()]
  const requestedVariant = input.selectedVariantId ??
    explicitVariantId(input.sourceUrl)
  let selected = requestedVariant
    ? unique.find((variant) => variant.lunaVariantId === requestedVariant) ?? null
    : null
  if (requestedVariant && !selected) return Object.freeze({
    sourceUrl: input.sourceUrl, canonicalUrl: parsed.canonicalUrl,
    title: text(matchingRows[0]?.title, 350) ?? parsed.handle,
    variants: Object.freeze(unique), selected: null, selectedRow: null,
    blocker: "LUNA_QUICK_PICK_EXPLICIT_VARIANT_MISMATCH", sourceClass,
  })
  const available = unique.filter((variant) => variant.available)
  if (!selected && available.length === 1) selected = available[0]
  if (!selected && unique.length === 1) selected = unique[0]
  const selectedRow = selected ? matchingRows.find((row) =>
    (text(row.supplier_product_id) ?? text(row.product_id)) ===
      selected!.lunaProductId &&
    text(row.supplier_variant_id) === selected!.lunaVariantId &&
    text(row.sku, 120) === selected!.supplierSku) ?? null : null
  return Object.freeze({ sourceUrl: input.sourceUrl,
    canonicalUrl: parsed.canonicalUrl,
    title: text(matchingRows[0]?.title, 350) ?? parsed.handle,
    variants: Object.freeze(unique), selected, selectedRow,
    blocker: selected ? null : "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED",
    sourceClass })
}

function emptyStages(overrides: Record<string, "WAITING" | "RUNNING" |
  "PASS" | "BLOCKED"> = {}) {
  return Object.freeze({ IDENTITY: "WAITING", DUPLICATE: "WAITING",
    STOCK: "WAITING", DEMAND: "WAITING", SHIPPING: "WAITING",
    ECONOMICS: "WAITING", PRODUCT_TRUTH: "WAITING",
    LISTING_PACKAGE: "WAITING", REQUIRED_SPECIFICS: "WAITING",
    MARKETPLACE_READINESS: "WAITING",
    LISTING_READY: "WAITING", ...overrides })
}

function card(input: Partial<LunaQuickPickCardV1> &
  Pick<LunaQuickPickCardV1, "sourceUrl">): LunaQuickPickCardV1 {
  return Object.freeze({ sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl ?? null, sourceSku: input.sourceSku ?? null,
    lunaProductId: input.lunaProductId ?? null,
    lunaVariantId: input.lunaVariantId ?? null,
    candidateId: input.candidateId ?? null,
    opportunityId: input.opportunityId ?? null,
    candidateKey: input.candidateKey ?? null,
    listingPackageId: input.listingPackageId ?? null,
    title: input.title ?? null, state: input.state ?? "BLOCKED",
    lastStage: input.lastStage ?? "IDENTITY",
    disposition: input.disposition ?? "BLOCKED",
    exactBlocker: input.exactBlocker ?? null,
    exactBlockers: Object.freeze([...(input.exactBlockers ??
      (input.exactBlocker ? [input.exactBlocker] : []))]),
    variantSelectionRequired: input.variantSelectionRequired ?? false,
    variants: Object.freeze([...(input.variants ?? [])]),
    alreadyLive: input.alreadyLive ?? false,
    linkedLiveItemIds: Object.freeze([...(input.linkedLiveItemIds ?? [])]),
    durableFamilyHit: input.durableFamilyHit ?? false,
    onDemandDemandDiscoveryRequired:
      input.onDemandDemandDiscoveryRequired ?? false,
    onDemandDemandDiscoveryExecuted:
      input.onDemandDemandDiscoveryExecuted ?? false,
    soldComparableCount: input.soldComparableCount ?? 0,
    familyDemandStatus: input.familyDemandStatus ?? null,
    familyBindingCreatedOrReused:
      input.familyBindingCreatedOrReused ?? false,
    demandEvidenceClass: input.demandEvidenceClass ?? null,
    demandNegativeEvidencePresent:
      input.demandNegativeEvidencePresent ?? false,
    marketTestPathEligible: input.marketTestPathEligible ?? false,
    marketTestReady: input.marketTestReady ?? false,
    marketTestReview: input.marketTestReview ?? null,
    requiredItemSpecificsCount:
      input.requiredItemSpecificsCount ?? null,
    requiredItemSpecificsSatisfied:
      input.requiredItemSpecificsSatisfied ?? null,
    requiredItemSpecificsReady: input.requiredItemSpecificsReady ?? null,
    unresolvedRequiredAspects: Object.freeze([
      ...(input.unresolvedRequiredAspects ?? []),
    ]),
    deterministicResolvedCount: input.deterministicResolvedCount ?? 0,
    marketplaceFallbackResolvedCount:
      input.marketplaceFallbackResolvedCount ?? 0,
    aiCallCount: input.aiCallCount ?? 0,
    aiAspectsResolvedCount: input.aiAspectsResolvedCount ?? 0,
    factInvented: false,
    automaticResolutionExhausted:
      input.automaticResolutionExhausted ?? false,
    automaticResolutionContractCurrent:
      input.automaticResolutionContractCurrent ?? false,
    automaticResolutionUpgradeHasPriorResidual:
      input.automaticResolutionUpgradeHasPriorResidual ?? false,
    exactUnresolvedFields: Object.freeze([
      ...(input.exactUnresolvedFields ?? []),
    ]),
    ownerResidualActions: Object.freeze([
      ...(input.ownerResidualActions ?? []),
    ]),
    ownerTruePublicationBlockers: Object.freeze([
      ...(input.ownerTruePublicationBlockers ?? []),
    ]),
    ownerCapturedFacts: Object.freeze([...(input.ownerCapturedFacts ?? [])]),
    postPublishEnrichmentOpportunities: Object.freeze([
      ...(input.postPublishEnrichmentOpportunities ?? []),
    ]),
    nextOwnerAction: input.nextOwnerAction ?? null,
    minimumTruthfulListingReady:
      input.minimumTruthfulListingReady ?? false,
    officialRequirementClassification:
      input.officialRequirementClassification ?? false,
    requirementCounts: input.requirementCounts ?? Object.freeze({
      requiredToList: 0, conditionallyRequired: 0,
      recommended: 0, optional: 0, unproven: 0,
    }),
    productIdentifierRequirementStatus:
      input.productIdentifierRequirementStatus ?? null,
    safeResumeAfterOwnerFact: input.safeResumeAfterOwnerFact ?? false,
    marketplaceReadinessReady:
      input.marketplaceReadinessReady ?? false,
    conditionReady: input.conditionReady ?? null,
    shippingUsd: input.shippingUsd ?? null,
    rehydrated: input.rehydrated ?? false,
    updatedAt: input.updatedAt ?? null,
    stages: input.stages ?? emptyStages(), dollarCheck: input.dollarCheck ?? null,
    listingReview: input.listingReview ?? null,
    overnightEnrichmentPending: input.overnightEnrichmentPending ?? false,
    overnightEnrichmentStatus: input.overnightEnrichmentStatus ?? null,
    overnightEnrichmentLastRunAt:
      input.overnightEnrichmentLastRunAt ?? null,
    elapsedMs: input.elapsedMs ?? 0 })
}

export function reconcileLunaQuickPickCardLivenessV1(
  input: LunaQuickPickCardV1,
) {
  if (input.state !== "RUNNING") return input
  const waitingForShipping = input.lastStage === "SHIPPING" ||
    input.exactBlocker === "ACTUAL_LUNA_SHIPPING" ||
    input.exactBlocker === "WAITING_BROWSER_WORKER"
  const lastStage = waitingForShipping ? "SHIPPING" : input.lastStage
  return Object.freeze({
    ...input,
    state: "WAITING" as const,
    lastStage,
    disposition: waitingForShipping
      ? "WAITING_FOR_SHIPPING_WORKER"
      : `WAITING_FOR_${lastStage}_CONTINUATION`,
    exactBlocker: null,
    exactBlockers: Object.freeze([]),
    stages: Object.freeze({ ...input.stages,
      [lastStage]: "WAITING" as const }),
  })
}

function outcomeStages(outcome: JsonRecord,
  candidate: RadarRevenueFactoryCandidateV1) {
  const stages = record(outcome.stages)
  const shippingWaiting = outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
  const demandReady = candidate.source ===
      "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" || candidate.source ===
      "RADAR_FRONTIER_LUNA_IDENTITY"
  const shippingReady = candidate.readyForEconomics ||
    (candidate.economicsNextEvidence !== null &&
      candidate.economicsNextEvidence !== "ACTUAL_LUNA_SHIPPING")
  const pass = (name: string) => stages[name] === "READY" ? "PASS" as const
    : "BLOCKED" as const
  return emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
    STOCK: candidate.stockReady ? "PASS" : "BLOCKED",
    DEMAND: demandReady ? "PASS" : pass("DEMAND_READY"),
    SHIPPING: shippingWaiting ? "WAITING" :
      shippingReady ? "PASS" : "BLOCKED",
    ECONOMICS: candidate.readyForEconomics ? "PASS" :
      pass("ECONOMICS_READY"),
    PRODUCT_TRUTH: pass("PRODUCT_TRUTH_READY"),
    LISTING_PACKAGE: pass("LISTING_PACKAGE_READY"),
    REQUIRED_SPECIFICS:
      outcome.requiredItemSpecificsReady === true ? "PASS" : "BLOCKED",
    MARKETPLACE_READINESS:
      outcome.canonicalMarketplaceReadinessReady === true ? "PASS" : "BLOCKED",
    LISTING_READY: outcome.listingReady === true ? "PASS" : "BLOCKED" })
}

function economicsHardBlockerV1(payload: unknown,
  candidate: RadarRevenueFactoryCandidateV1) {
  const match = rows(record(payload).frontiers).find((outer) => {
    const frontier = record(outer.frontier)
    return frontier.familyId === candidate.familyId &&
      frontier.lunaProductId === candidate.lunaProductId &&
      frontier.lunaVariantId === candidate.lunaVariantId &&
      frontier.lunaSku === candidate.supplierSku
  })
  const blockers = Array.isArray(record(match?.frontier).currentHardBlockers)
    ? record(match?.frontier).currentHardBlockers as unknown[] : []
  return actionable(blockers[0])
}

export async function processLunaQuickPickBatchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  urls: unknown
  selectedVariants?: Readonly<Record<string, string>>
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
  fetchImpl?: typeof fetch
  onDemandDemandDiscovery?: typeof discoverAndPersistSellerOsOnDemandFamilyDemandV1
  batchId?: string | null
}>) {
  const startedAt = Date.now()
  const collected = collectLunaQuickPickInputsV1(input.urls)
  const sourceUrls = collected.urls
  const [catalog, radarRead, frontierRead] = await Promise.all([
    readRadarRevenueFactoryLunaCatalogV1(input.supabase),
    input.supabase.rpc("get_seller_os_family_market_radar_v1",
      { p_family_id: null, p_limit: 100 }),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: null, p_limit: 100,
    }),
  ])
  if (radarRead.error) throw new Error("LUNA_QUICK_PICK_DEMAND_AUTHORITY_UNAVAILABLE")
  if (frontierRead.error) throw new Error("LUNA_QUICK_PICK_ECONOMICS_AUTHORITY_UNAVAILABLE")
  const resolutionAttempts = await mapBounded<string, ResolutionAttempt>(sourceUrls,
    LUNA_QUICK_PICK_CONCURRENCY, async (sourceUrl) => {
      const canonical = parseDirectedLunaProductUrl(sourceUrl).canonicalUrl
      try {
        return Object.freeze({ result: await resolveLunaQuickPickInputV1({
          sourceUrl, catalogRows: catalog.rows,
          selectedVariantId: input.selectedVariants?.[canonical] ?? null,
          fetchImpl: input.fetchImpl }), error: null }) as ResolutionAttempt
      } catch (error) {
        return Object.freeze({ result: null,
          error: safeError(error) }) as ResolutionAttempt
      }
    })
  const resolved = resolutionAttempts.flatMap((attempt) => attempt.result
    ? [attempt.result] : [])
  const selected = resolved.filter((entry) => entry.selected && entry.selectedRow)
  const liveGuard = await readAlreadyLiveExactLunaIdentitiesV1({
    supabase: input.supabase, accountKey: input.accountKey,
    identities: selected.map((entry) => ({
      identityKey: identityKey(entry.selected!.lunaProductId,
        entry.selected!.lunaVariantId, entry.selected!.supplierSku),
      lunaProductId: entry.selected!.lunaProductId,
      lunaVariantId: entry.selected!.lunaVariantId,
      supplierSku: entry.selected!.supplierSku,
    })),
  })
  const cards = new Map<string, LunaQuickPickCardV1>()
  for (const invalid of collected.invalid) {
    cards.set(invalid.sourceUrl, card({ sourceUrl: invalid.sourceUrl,
      state: "BLOCKED", lastStage: "IDENTITY", disposition: "BLOCKED",
      exactBlocker: invalid.blocker,
      stages: emptyStages({ IDENTITY: "BLOCKED" }) }))
  }
  resolutionAttempts.forEach((attempt, index) => {
    if (!attempt.result) cards.set(sourceUrls[index], card({
      sourceUrl: sourceUrls[index], state: "BLOCKED", lastStage: "IDENTITY",
      disposition: "BLOCKED", exactBlocker: attempt.error,
      stages: emptyStages({ IDENTITY: "BLOCKED" }),
    }))
  })
  const candidateRows: JsonRecord[] = []
  const acceptedIdentityKeys = new Set<string>()
  for (const entry of resolved) {
    const selectedVariant = entry.selected
    if (!selectedVariant || !entry.selectedRow) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        state: "WAITING", lastStage: "IDENTITY",
        disposition: entry.blocker === "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED"
          ? "WAITING_VARIANT_SELECTION" : "BLOCKED",
        exactBlocker: entry.blocker,
        variantSelectionRequired:
          entry.blocker === "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: entry.blocker ? "BLOCKED" : "PASS" }) }))
      continue
    }
    const key = identityKey(selectedVariant.lunaProductId,
      selectedVariant.lunaVariantId, selectedVariant.supplierSku)
    if (liveGuard.status !== "AVAILABLE") {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "BLOCKED_FAIL_CLOSED",
        exactBlocker: liveGuard.reasonCode,
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    const live = liveGuard.matches.get(key)
    if (live) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "EXCLUDED_ALREADY_LIVE",
        exactBlocker: "ALREADY_LIVE_EXACT_PRODUCT", variants: entry.variants,
        alreadyLive: true, linkedLiveItemIds: live.ebayItemIds,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    if (acceptedIdentityKeys.has(key)) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "EXCLUDED_DUPLICATE_INPUT",
        exactBlocker: "LUNA_QUICK_PICK_DUPLICATE_PRODUCT_IDENTITY",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    acceptedIdentityKeys.add(key)
    if (!selectedVariant.available) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "STOCK",
        disposition: "BLOCKED_STOCK",
        exactBlocker: "LUNA_QUICK_PICK_CANONICAL_STOCK_NOT_READY",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
          STOCK: "BLOCKED" }) }))
      continue
    }
    candidateRows.push(entry.selectedRow)
  }
  let activeRadarPayload = radarRead.data
  let currentBatch = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: activeRadarPayload, frontierPayload: frontierRead.data,
    lunaCatalogRows: candidateRows, targetCandidates: LUNA_QUICK_PICK_MAX_INPUTS,
    allowUnprovenMarketTest: true,
    catalogReadMetadata: { pageCount: catalog.pageCount,
      rowsRead: catalog.rowsRead, uniqueIdentities: catalog.uniqueIdentities,
      truncated: catalog.truncated },
  })
  const discoveryByIdentity = new Map<string,
    SellerOsOnDemandFamilyDemandDiscoveryResultV1>()
  const missingDemandEntries = resolved.filter((entry) => {
    if (cards.has(entry.sourceUrl) || !entry.selected || !entry.selectedRow) return false
    return !currentBatch.candidates.some((candidate) =>
      candidate.lunaProductId === entry.selected!.lunaProductId &&
      candidate.lunaVariantId === entry.selected!.lunaVariantId &&
      candidate.supplierSku === entry.selected!.supplierSku)
  })
  const demandDiscovery = input.onDemandDemandDiscovery ??
    discoverAndPersistSellerOsOnDemandFamilyDemandV1
  const discoveryResults = await mapBounded(missingDemandEntries,
    LUNA_QUICK_PICK_DEMAND_DISCOVERY_CONCURRENCY, async (entry) => {
      const result = await demandDiscovery({ supabase: input.supabase,
        accountKey: input.accountKey, lunaCatalogRow: entry.selectedRow! })
      return Object.freeze({ entry, result })
    })
  for (const { entry, result } of discoveryResults) {
    discoveryByIdentity.set(identityKey(entry.selected!.lunaProductId,
      entry.selected!.lunaVariantId, entry.selected!.supplierSku), result)
  }
  const marketTestRadarFamilies = discoveryResults.flatMap(({ result }) =>
    classifyLunaQuickPickDemandDiscoveryV1(result) ===
        "CONTINUE_DEMAND_UNPROVEN" && result.marketTestRadarFamily
      ? [result.marketTestRadarFamily] : [])
  if (discoveryResults.some(({ result }) =>
      classifyLunaQuickPickDemandDiscoveryV1(result) ===
        "CONTINUE_DEMAND_EVIDENCE" && result.familyBindingCreatedOrReused)) {
    const refreshedRadar = await input.supabase.rpc(
      "get_seller_os_family_market_radar_v1",
      { p_family_id: null, p_limit: 100 })
    if (refreshedRadar.error) {
      throw new Error("LUNA_QUICK_PICK_DEMAND_READBACK_FAILED")
    }
    activeRadarPayload = refreshedRadar.data
  }
  if (marketTestRadarFamilies.length) {
    const activeRoot = record(activeRadarPayload)
    activeRadarPayload = { ...activeRoot, status: "AVAILABLE",
      families: [...rows(activeRoot.families), ...marketTestRadarFamilies] }
  }
  if (discoveryResults.some(({ result }) =>
      classifyLunaQuickPickDemandDiscoveryV1(result).startsWith("CONTINUE_"))) {
    currentBatch = buildRadarRevenueFactoryCandidateBatchV1({
      radarPayload: activeRadarPayload, frontierPayload: frontierRead.data,
      lunaCatalogRows: candidateRows, targetCandidates: LUNA_QUICK_PICK_MAX_INPUTS,
      allowUnprovenMarketTest: true,
      catalogReadMetadata: { pageCount: catalog.pageCount,
        rowsRead: catalog.rowsRead, uniqueIdentities: catalog.uniqueIdentities,
        truncated: catalog.truncated },
    })
  }
  let activeFrontierPayload = frontierRead.data
  for (const entry of resolved) {
    if (cards.has(entry.sourceUrl) || !entry.selected) continue
    const exact = currentBatch.candidates.find((candidate) =>
      candidate.lunaProductId === entry.selected!.lunaProductId &&
      candidate.lunaVariantId === entry.selected!.lunaVariantId &&
      candidate.supplierSku === entry.selected!.supplierSku)
    if (!exact) {
      const discovery = discoveryByIdentity.get(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku))
      const single = buildRadarRevenueFactoryCandidateBatchV1({
        radarPayload: activeRadarPayload, frontierPayload: frontierRead.data,
        lunaCatalogRows: entry.selectedRow ? [entry.selectedRow] : [],
        targetCandidates: 2, allowUnprovenMarketTest: true,
      })
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: entry.selected.supplierSku,
        lunaProductId: entry.selected.lunaProductId,
        lunaVariantId: entry.selected.lunaVariantId,
        state: "BLOCKED", lastStage: "DEMAND",
        disposition: "BLOCKED",
        exactBlocker: discovery?.demandNegativeEvidencePresent
          ? "LUNA_QUICK_PICK_NEGATIVE_DEMAND_EVIDENCE"
          : discovery?.reasonCode ??
          (single.ambiguousFamilyAssignments > 0
          ? "LUNA_QUICK_PICK_DEMAND_FAMILY_AMBIGUOUS"
          : "LUNA_QUICK_PICK_DEMAND_NOT_PROVEN"),
        variants: entry.variants,
        durableFamilyHit: false,
        onDemandDemandDiscoveryRequired: true,
        onDemandDemandDiscoveryExecuted: Boolean(discovery),
        soldComparableCount: discovery?.soldComparableCount ?? 0,
        familyDemandStatus: discovery?.status ?? "DEMAND_DISCOVERY_UNAVAILABLE",
        familyBindingCreatedOrReused:
          discovery?.familyBindingCreatedOrReused ?? false,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
          STOCK: entry.selected.available ? "PASS" : "BLOCKED",
          DEMAND: "BLOCKED" }) }))
    }
  }
  const preflight = await ensureRadarCandidateEconomicsPreflightsV1({
    supabase: input.supabase, accountKey: input.accountKey, batch: currentBatch,
  })
  if (preflight.created > 0 || preflight.reused > 0) {
    const refreshedFrontier = await input.supabase.rpc(
      "get_seller_os_latest_profitability_frontiers_v1", {
        p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
        p_family_ids: null, p_limit: 100,
      })
    if (refreshedFrontier.error) {
      throw new Error("LUNA_QUICK_PICK_ECONOMICS_READBACK_FAILED")
    }
    activeFrontierPayload = refreshedFrontier.data
    currentBatch = buildRadarRevenueFactoryCandidateBatchV1({
      radarPayload: activeRadarPayload, frontierPayload: refreshedFrontier.data,
      lunaCatalogRows: candidateRows, targetCandidates: LUNA_QUICK_PICK_MAX_INPUTS,
      allowUnprovenMarketTest: true,
      catalogReadMetadata: { pageCount: catalog.pageCount,
        rowsRead: catalog.rowsRead, uniqueIdentities: catalog.uniqueIdentities,
        truncated: catalog.truncated },
    })
  }
  const materialized = currentBatch.candidates.length
    ? await materializeRadarRevenueFactoryCandidateBatchV1({
        supabase: input.supabase, accountKey: input.accountKey,
        batch: currentBatch, taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
        // Intake stays deterministic. The existing Required Specifics
        // continuation owns the one bounded residual AI batch so a fresh
        // Quick Pick cannot spend once in PROCESS and again during polling.
        requiredSpecificsAiStages: [],
      }) : null
  const durableQuickPickOperations = resolved.flatMap((entry) => {
    if (!entry.selected) return []
    const candidate = currentBatch.candidates.find((item) =>
      item.lunaProductId === entry.selected!.lunaProductId &&
      item.lunaVariantId === entry.selected!.lunaVariantId &&
      item.supplierSku === entry.selected!.supplierSku)
    const outcome = candidate ? record(materialized?.outcomes.find((item) =>
      item.candidateId === candidate.candidateId)) : {}
    const candidateKey = text(outcome.candidateKey, 120)
    return candidate && candidateKey ? [{ entry, candidate, candidateKey }] : []
  })
  await mapBounded(durableQuickPickOperations, LUNA_QUICK_PICK_CONCURRENCY,
    async ({ entry, candidate, candidateKey }) => persistQuickPickOperationV1({
      supabase: input.supabase,
      sourceUrl: entry.sourceUrl,
      canonicalUrl: entry.canonicalUrl,
      candidateId: candidate.candidateId,
      candidateKey,
      lunaProductId: candidate.lunaProductId as string,
      lunaVariantId: candidate.lunaVariantId as string,
      supplierSku: candidate.supplierSku as string,
      batchId: input.batchId,
    }))
  for (const entry of resolved) {
    if (cards.has(entry.sourceUrl) || !entry.selected) continue
    const candidate = currentBatch.candidates.find((item) =>
      item.lunaProductId === entry.selected!.lunaProductId &&
      item.lunaVariantId === entry.selected!.lunaVariantId &&
      item.supplierSku === entry.selected!.supplierSku)
    const outcome = candidate ? record(materialized?.outcomes.find((item) =>
      item.candidateId === candidate.candidateId)) : {}
    if (!candidate || !outcome.candidateId) continue
    const marketTestReady = outcome.marketTestReady === true
    const ready = outcome.listingReady === true || marketTestReady
    const economicsBlocker = economicsHardBlockerV1(activeFrontierPayload,
      candidate)
    cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
      canonicalUrl: entry.canonicalUrl, title: entry.title,
      sourceSku: entry.selected.supplierSku,
      lunaProductId: entry.selected.lunaProductId,
      lunaVariantId: entry.selected.lunaVariantId,
      candidateId: candidate.candidateId,
      opportunityId: text(outcome.opportunityId, 80),
      candidateKey: text(outcome.candidateKey, 120),
      listingPackageId: text(outcome.listingPackageId, 80),
      state: ready ? "READY" :
        outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "WAITING" : "BLOCKED",
      lastStage: marketTestReady ? "MARKET_TEST_READY" :
        ready ? "LISTING_READY" :
        outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "SHIPPING" : actionable(outcome.economicsNextEvidence) ??
            actionable(record(outcome.priceDistributionContinuation).finalReason) ??
            economicsBlocker ??
            actionable(outcome.reasonCode) ?? "ECONOMICS",
      disposition: outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
        ? "WAITING_FOR_SHIPPING_WORKER"
        : text(outcome.status, 80) ?? "PARKED",
      exactBlocker: ready ? null :
        actionable(outcome.economicsNextEvidence) ??
        actionable(record(outcome.priceDistributionContinuation).finalReason) ??
        economicsBlocker ??
        actionable(outcome.reasonCode),
      durableFamilyHit: !discoveryByIdentity.has(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku)),
      onDemandDemandDiscoveryRequired: discoveryByIdentity.has(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku)),
      onDemandDemandDiscoveryExecuted: discoveryByIdentity.has(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku)),
      soldComparableCount: discoveryByIdentity.get(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku))?.soldComparableCount ??
        candidate.lineage.soldComparableCount,
      familyDemandStatus: discoveryByIdentity.get(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku))?.status ?? candidate.lineage.familyDemandStatus,
      familyBindingCreatedOrReused: discoveryByIdentity.get(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku))?.familyBindingCreatedOrReused ?? false,
      demandEvidenceClass: candidate.marketTestPath
        ? "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE"
        : "PROVEN_OR_SUPPORTED",
      demandNegativeEvidencePresent: discoveryByIdentity.get(identityKey(
        entry.selected.lunaProductId, entry.selected.lunaVariantId,
        entry.selected.supplierSku))?.demandNegativeEvidencePresent ?? false,
      marketTestPathEligible: candidate.marketTestPath,
      marketTestReady,
      marketTestReview: marketTestReady
        ? record(outcome.marketTestReview) : null,
      variants: entry.variants, stages: outcomeStages(outcome, candidate),
      dollarCheck: ready ? record(outcome.dollarCheck) : null }))
  }
  const orderedUrls = [...collected.invalid.map((entry) => entry.sourceUrl),
    ...sourceUrls]
  const ordered = orderedUrls.map((url) => cards.get(url) ?? card({
    sourceUrl: url, state: "BLOCKED", lastStage: "IDENTITY",
    disposition: "BLOCKED", exactBlocker: "LUNA_QUICK_PICK_RESULT_MISSING",
  })).map((entry) => Object.freeze({ ...entry,
    elapsedMs: Date.now() - startedAt }))
  const aiCallCount = Number(record(materialized?.requiredSpecificsBatch)
    .aiCallCount ?? 0)
  return Object.freeze({ contractVersion: LUNA_QUICK_PICK_FAST_LISTING_V1,
    inputCount: orderedUrls.length,
    uniqueProductCount: new Set(ordered.flatMap((entry) => entry.sourceSku
      ? [identityKey(entry.lunaProductId!, entry.lunaVariantId!, entry.sourceSku)]
      : [])).size,
    exactIdentityCount: ordered.filter((entry) => entry.sourceSku).length,
    durableFamilyHitCount: ordered.filter((entry) => entry.durableFamilyHit).length,
    onDemandDemandDiscoveryRequiredCount: ordered.filter((entry) =>
      entry.onDemandDemandDiscoveryRequired).length,
    onDemandDemandDiscoveryExecutedCount: ordered.filter((entry) =>
      entry.onDemandDemandDiscoveryExecuted).length,
    soldComparableCount: ordered.reduce((sum, entry) =>
      sum + entry.soldComparableCount, 0),
    familyBindingCreatedOrReusedCount: ordered.filter((entry) =>
      entry.familyBindingCreatedOrReused).length,
    cards: Object.freeze(ordered), aiCallCount,
    aiProductsBatchedCount: aiCallCount > 0
      ? Number(record(materialized?.requiredSpecificsBatch).productCount ?? 0) : 0,
    noArtificialBatchWait: true as const, opportunisticBatching: true as const,
    maximumAiCallsPerQuickPick: 1 as const,
    boundedConcurrency: LUNA_QUICK_PICK_CONCURRENCY,
    elapsedMs: Date.now() - startedAt,
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      publishCalls: 0 as const, newTable: 0 as const, newScheduler: 0 as const,
      newStateMachine: 0 as const, newExtension: 0 as const,
      newBrowserAutomation: 0 as const }) })
}

export function quickPickSafeTechnicalIdentityV1(candidate:
  RadarRevenueFactoryCandidateV1) {
  return Object.freeze({ candidateId: candidate.candidateId,
    exactIdentityDigest: digest({ productId: candidate.lunaProductId,
      variantId: candidate.lunaVariantId, sku: candidate.supplierSku }) })
}

export async function readLunaQuickPickProgressV1(input: Readonly<{
  supabase: SupabaseClient
  candidateKeys: readonly string[]
  supplierIdentities?: readonly LunaQuickPickSupplierIdentityV1[]
  accountKey?: string | null
  includeRecent?: boolean
}>) {
  const candidateKeys = [...new Set(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value)))].slice(0, LUNA_QUICK_PICK_MAX_INPUTS)
  const supplierIdentityKeys = new Set((input.supplierIdentities ?? [])
    .flatMap((value) => supplierIdentityKeyV1(value)
      ? [supplierIdentityKeyV1(value) as string] : []))
  const requestedVariantIds = [...new Set((input.supplierIdentities ?? [])
    .map((value) => value.lunaVariantId))]
  if (!candidateKeys.length && !supplierIdentityKeys.size &&
      !input.includeRecent) return Object.freeze([])
  const columns = "id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,queue_status,decision,assessment,updated_at"
  const queueReads = await Promise.all([
    candidateKeys.length
      ? input.supabase.from("ebay_luna_opportunity_queue").select(columns)
        .in("candidate_key", candidateKeys).limit(LUNA_QUICK_PICK_MAX_INPUTS)
      : Promise.resolve({ data: [], error: null }),
    requestedVariantIds.length
      ? input.supabase.from("ebay_luna_opportunity_queue").select(columns)
        .in("supplier_variant_id", requestedVariantIds)
        .limit(LUNA_QUICK_PICK_MAX_INPUTS)
      : Promise.resolve({ data: [], error: null }),
    !candidateKeys.length && !requestedVariantIds.length && input.includeRecent
      ? input.supabase.from("ebay_luna_opportunity_queue").select(columns)
        .order("updated_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (queueReads.some((read) => read.error)) {
    throw new Error("LUNA_QUICK_PICK_PROGRESS_READ_FAILED")
  }
  const uniqueQueueRows = new Map<string, JsonRecord>()
  for (const row of queueReads.flatMap((read) => rows(read.data))) {
    const id = text(row.id, 80)
    if (id) uniqueQueueRows.set(id, row)
  }
  let queueRows = [...uniqueQueueRows.values()]
  if (supplierIdentityKeys.size) {
    queueRows = queueRows.filter((row) => candidateKeys.includes(
      String(row.candidate_key)) || supplierIdentityKeys.has(identityKey(
      String(row.supplier_product_id), String(row.supplier_variant_id),
      String(row.supplier_sku))))
  }
  if (input.includeRecent && !candidateKeys.length &&
      !supplierIdentityKeys.size) {
    const radarRead = await input.supabase.rpc(
      "get_seller_os_family_market_radar_v1", {
        p_family_id: null, p_limit: 100,
      })
    if (radarRead.error) {
      throw new Error("LUNA_QUICK_PICK_RECENT_FAMILY_READ_FAILED")
    }
    const durableFamilyIds = new Set(rows(record(radarRead.data).families)
      .flatMap((family) => text(family.familyId, 120)
        ? [String(family.familyId)] : []))
    queueRows = queueRows.filter((row) => {
      // Before the durable operation marker existed, Quick Pick market-test
      // families were intentionally bounded in-memory. Their exact queue row
      // and shipping continuation are durable, but the family is absent from
      // the Night Radar authority. This recovers those operations without a
      // product/SKU special case and never promotes the synthetic family.
      return isRehydratableQuickPickOperationV1({ assessment: row.assessment,
        durableFamilyIds })
    }).slice(0, LUNA_QUICK_PICK_MAX_INPUTS)
  }
  const opportunityIds = queueRows.flatMap((row) => text(row.id, 80)
    ? [String(row.id)] : [])
  const variantIds = [...new Set(queueRows.flatMap((row) =>
    text(row.supplier_variant_id, 80)
      ? [String(row.supplier_variant_id)] : []))]
  const packageRead = opportunityIds.length
    ? await input.supabase.from("ebay_listing_packages")
      .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
      .in("opportunity_id", opportunityIds)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LUNA_QUICK_PICK_MAX_INPUTS)
    : { data: [], error: null }
  if (packageRead.error) throw new Error("LUNA_QUICK_PICK_PACKAGE_READ_FAILED")
  const catalogRead = variantIds.length
    ? await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,product_url,title,variant_title,vendor,product_type,tags,metadata,featured_image_url,image_urls,captured_at")
      .eq("source_key", "lunaportex")
      .in("supplier_variant_id", variantIds).limit(100)
    : { data: [], error: null }
  if (catalogRead.error) throw new Error("LUNA_QUICK_PICK_CATALOG_READ_FAILED")
  const productIds = [...new Set(rows(catalogRead.data).flatMap((row) =>
    text(row.product_id, 80) ? [String(row.product_id)] : []))]
  const productRead = productIds.length
    ? await input.supabase.from("market_radar_products")
      .select("id,body_html,metadata").in("id", productIds)
      .limit(LUNA_QUICK_PICK_MAX_INPUTS)
    : { data: [], error: null }
  if (productRead.error) {
    throw new Error("LUNA_QUICK_PICK_PRODUCT_CATALOG_READ_FAILED")
  }
  const frontierRead = variantIds.length && input.accountKey
    ? await input.supabase.rpc(
      "get_seller_os_latest_profitability_frontiers_v1", {
        p_account_key: input.accountKey,
        p_marketplace_id: "EBAY_US",
        p_family_ids: null,
        p_limit: 100,
      })
    : { data: [], error: null }
  if (frontierRead.error) {
    throw new Error("LUNA_QUICK_PICK_FRONTIER_READ_FAILED")
  }
  const liveGuard = input.accountKey
    ? await readAlreadyLiveExactLunaIdentitiesV1({
      supabase: input.supabase,
      accountKey: input.accountKey,
      identities: queueRows.flatMap((row) => {
        const lunaProductId = text(row.supplier_product_id, 80)
        const lunaVariantId = text(row.supplier_variant_id, 80)
        const supplierSku = text(row.supplier_sku, 120)
        return lunaProductId && lunaVariantId && supplierSku
          ? [{
              identityKey: identityKey(
                lunaProductId,
                lunaVariantId,
                supplierSku,
              ),
              lunaProductId,
              lunaVariantId,
              supplierSku,
            }]
          : []
      }),
    })
    : Object.freeze({
      status: "AVAILABLE" as const,
      matches: new Map<string, Readonly<{
        ebayItemIds: readonly string[]
        linkageAuthority: "SELLER_OS_LUNA_LINKAGE_DECISION_V1"
      }>>(),
      reasonCode: null,
    })
  if (liveGuard.status !== "AVAILABLE") {
    throw new Error(
      liveGuard.reasonCode ??
        "LUNA_QUICK_PICK_ALREADY_LIVE_GUARD_READ_FAILED",
    )
  }
  const packages = new Map<string, JsonRecord>()
  for (const row of rows(packageRead.data)) {
    const opportunityId = String(row.opportunity_id)
    if (!packages.has(opportunityId)) packages.set(opportunityId, row)
  }
  const products = new Map(rows(productRead.data).map((row) =>
    [String(row.id), row]))
  const catalog = new Map(rows(catalogRead.data).map((row) => [identityKey(
    String(row.supplier_product_id), String(row.supplier_variant_id),
    String(row.sku)), row]))
  const frontiers = new Map<string, JsonRecord>()
  for (const outer of rows(record(frontierRead.data).frontiers)) {
    const frontier = record(outer.frontier)
    const key = identityKey(String(frontier.lunaProductId),
      String(frontier.lunaVariantId), String(frontier.lunaSku))
    if (!frontiers.has(key)) frontiers.set(key, frontier)
  }
  return Object.freeze(queueRows.map((row) => {
    const assessment = record(row.assessment)
    const operation = record(assessment.lunaQuickPickOperationV1)
    const factory = record(assessment.sellerOsDeterministicFactory)
    const stages = record(factory.stageStatuses)
    const intake = record(assessment.smartStockingListingIntakeV1)
    const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
    const marketTestReview = record(assessment.quickPickMarketTestReviewV1)
    const specificsContinuation = record(
      assessment.quickPickRequiredSpecificsContinuationV1)
    const minimumReadiness = record(
      assessment.minimumTruthfulListingReadinessV1)
    const minimumContractCurrent = minimumReadiness.contractVersion ===
      MINIMUM_TRUTHFUL_LISTING_READINESS_V1
      && minimumReadiness.candidateKey === row.candidate_key
      && minimumReadiness.opportunityId === row.id
    const ownerTruePublicationBlockers = minimumContractCurrent
      ? rows(minimumReadiness.ownerLastMileActions) : []
    const ownerResidualActions = minimumContractCurrent
      ? ownerTruePublicationBlockers.map((entry) => Object.freeze({
        productField: entry.specificName,
        exactUnresolvedField: entry.specificName,
        disposition: "OWNER_FACT_REQUIRED",
        bestProposal: entry.bestProposal ?? null,
        proposalEvidence: entry.proposalEvidence ??
          "SELLER_OS_AUTOMATION_EXHAUSTED",
        confidence: entry.bestProposal ? "MEDIUM" : "LOW",
        ownerAction: entry.bestProposal ? "CONFIRM" : "ENTER_FACT",
        whyAutomationCouldNotResolve:
          "EXACT_EVIDENCE_INSUFFICIENT_OR_CONFLICTING",
        exactEvidenceMissing:
          `AUTHORITATIVE_EXACT_PRODUCT_${String(entry.specificName ?? "FACT")
            .toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
        editAllowed: true,
        automaticResolutionExhausted: true,
        factInvented: false,
      })) : rows(specificsContinuation.residualOwnerActions)
    const postPublishEnrichmentOpportunities = minimumContractCurrent
      ? rows(minimumReadiness.postPublishEnrichmentOpportunities) : []
    const ownerCapturedFacts = ownerExplicitProductTruthFactsV1(row)
      .map((entry) => Object.freeze({
        specificName: entry.specificName,
        exactValue: entry.exactValue,
        normalizedMarketplaceValue: entry.normalizedMarketplaceValue,
        capturedAt: entry.capturedAt,
        evidenceDigest: entry.evidenceDigest,
        correctionAllowedBeforePublication: true,
        factInvented: false,
      }))
    const canonicalMarketplaceReadiness = record(
      assessment.canonicalMarketplaceReadinessV1)
    const specificsResolution = record(
      assessment.marketplaceRequiredSpecificsBatchResolutionV1)
    const overnightAudit = record(
      assessment.quickPickRadarOvernightEnrichmentV1)
    const specificsResolutions = rows(specificsResolution.resolutions)
    const listingReady = (minimumContractCurrent
        && minimumReadiness.listingReady === true)
      || intake.finalDecision === "LISTING_READY"
      || row.decision === "LISTING_READY"
    const marketTestReady = (minimumContractCurrent
        && minimumReadiness.marketTestReady === true)
      || marketTestReview.finalDecision === "MARKET_TEST_READY"
      || row.decision === "MARKET_TEST_READY"
    const reviewReady = listingReady || marketTestReady
    const autonomousDisposition = text(
      specificsContinuation.finalDisposition, 120)
    const blockers = Array.isArray(factory.blockers)
      ? factory.blockers.flatMap((value) => text(value, 120)
        ? [String(value)] : []) : []
    const readinessBlockers = Array.isArray(
      canonicalMarketplaceReadiness.blockers)
      ? canonicalMarketplaceReadiness.blockers.flatMap((value) =>
        text(value, 120) ? [String(value)] : []) : []
    const identity = identityKey(String(row.supplier_product_id),
      String(row.supplier_variant_id), String(row.supplier_sku))
    const catalogRow = catalog.get(identity)
    const catalogUrl = text(catalogRow?.product_url, 2_000)
    const canonicalUrl = text(operation.canonicalUrl, 2_000) ?? catalogUrl
    const sourceUrl = text(operation.sourceUrl, 2_000) ?? (canonicalUrl
      ? sourceUrlWithVariant(canonicalUrl,
        String(row.supplier_variant_id)) : `quick-pick:${row.candidate_key}`)
    const live = liveGuard.matches.get(identity)
    if (live) {
      const listingPackage = packages.get(String(row.id))
      return card({
        sourceUrl,
        canonicalUrl,
        candidateKey: String(row.candidate_key),
        candidateId: String(row.candidate_key),
        opportunityId: String(row.id),
        listingPackageId: listingPackage ? String(listingPackage.id) : null,
        sourceSku: text(row.supplier_sku, 120),
        lunaProductId: text(row.supplier_product_id, 80),
        lunaVariantId: text(row.supplier_variant_id, 80),
        title: text(row.product_title, 350),
        state: "BLOCKED",
        lastStage: "DUPLICATE",
        disposition: "EXCLUDED_ALREADY_LIVE",
        exactBlocker: "ALREADY_LIVE_EXACT_PRODUCT",
        alreadyLive: true,
        linkedLiveItemIds: live.ebayItemIds,
        rehydrated: input.includeRecent === true,
        updatedAt: text(row.updated_at, 80),
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }),
      })
    }
    const frontier = frontiers.get(identity)
    const listingPackage = packages.get(String(row.id))
    const listingReview = reviewReady && listingPackage
      ? buildQuickPickMarketTestListingReviewV1({
        opportunity: row,
        listingPackage,
        frontier,
        catalogRow,
        catalogProduct: products.get(String(catalogRow?.product_id ?? "")),
      }) : null
    const shippingUsd = frontier?.shippingStatus ===
      "SHIPPING_DURABLY_PERSISTED"
      ? number(frontier.shippingValue) : null
    const waitingForWorker = shipping.shippingJobStatus ===
      "WAITING_BROWSER_WORKER"
    // A durable Shipping PASS supersedes the continuation snapshot's old
    // downstream blocker. Keeping that historical value in the live blocker
    // union makes a resolved category appear blocked after rehydration.
    const shippingBlocker = shipping.shippingJobStatus ===
      "SHIPPING_EVIDENCE_DURABLE" ? null : text(shipping.firstBlocker, 120)
    const minimumBlockers = minimumContractCurrent
      ? textList(minimumReadiness.blockers) : []
    const legacyBlockers = [...blockers, ...readinessBlockers]
      .filter((blocker) => !minimumContractCurrent
        || !blocker.startsWith(
          "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN"))
    const exactBlockers = [...new Set([...minimumBlockers, ...legacyBlockers,
      ...(shippingBlocker ? [shippingBlocker] : [])])]
    const firstBlocker = exactBlockers[0] ?? null
    const requiredItemSpecificsCount =
      number(canonicalMarketplaceReadiness.requiredItemSpecificsCount) ??
      number(specificsContinuation.requiredItemSpecificsCount)
    const requiredItemSpecificsSatisfied =
      number(canonicalMarketplaceReadiness.requiredItemSpecificsSatisfied) ??
      number(specificsContinuation.requiredItemSpecificsSatisfiedAfter)
    const unresolvedRequiredAspects = Array.isArray(
      canonicalMarketplaceReadiness.unsupportedRequiredSpecifics)
      ? canonicalMarketplaceReadiness.unsupportedRequiredSpecifics
        .flatMap((value) => text(value, 120) ? [String(value)] : [])
      : Array.isArray(specificsContinuation.unresolvedAspectsAfter)
        ? specificsContinuation.unresolvedAspectsAfter.flatMap((value) =>
          text(value, 120) ? [String(value)] : []) : []
    const requiredItemSpecificsReady =
      canonicalMarketplaceReadiness.requiredItemSpecificsReady === true ||
      (requiredItemSpecificsCount !== null &&
        requiredItemSpecificsSatisfied === requiredItemSpecificsCount &&
        requiredItemSpecificsCount > 0)
    const waitingForRequirementCapability = minimumContractCurrent
      && ownerTruePublicationBlockers.length === 0
      && (number(minimumReadiness.unprovenRequirementCount) ?? 0) > 0
    const effectiveRequiredItemSpecificsReady = minimumContractCurrent
      ? ownerTruePublicationBlockers.length === 0
        && !waitingForRequirementCapability
      : requiredItemSpecificsReady
    const effectiveUnresolvedRequiredAspects = minimumContractCurrent
      ? ownerTruePublicationBlockers.flatMap((entry) => {
        const specificName = text(entry.specificName, 120)
        return specificName ? [specificName] : []
      }) : unresolvedRequiredAspects
    const conditionReady = typeof canonicalMarketplaceReadiness.conditionReady
      === "boolean" ? canonicalMarketplaceReadiness.conditionReady : null
    const marketplaceReadinessReady =
      canonicalMarketplaceReadiness.ready === true || reviewReady
    const overnightEligibility = projectQuickPickOvernightEligibilityV1({
      row, alreadyLive: false,
    })
    const requiredSpecificsBlocked = minimumContractCurrent
      ? ownerTruePublicationBlockers.length > 0
      : !requiredItemSpecificsReady &&
        (unresolvedRequiredAspects.length > 0 || exactBlockers.some((value) =>
          value.startsWith("MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")))
    const waitingForIdentifierCapability = minimumContractCurrent
      && ownerTruePublicationBlockers.length === 0
      && record(minimumReadiness.gateStates).productIdentifiers ===
        "UNPROVEN_CAPABILITY"
    const waitingForEbayCapability = waitingForRequirementCapability
      || waitingForIdentifierCapability
    const marketplaceReadinessBlocked = !marketplaceReadinessReady &&
      (conditionReady === false || exactBlockers.some((value) =>
        value.startsWith("MARKETPLACE_CONDITION_NOT_READY")))
    const minimumDemand = text(
      record(minimumReadiness.gateStates).demand, 80)
    const marketTestPathEligible = minimumDemand ===
      "UNPROVEN_MARKET_TEST_ALLOWED" || marketTestReady
    const projectedLastStage = marketTestReady ? "MARKET_TEST_READY" :
      listingReady ? "LISTING_READY" : waitingForWorker ? "SHIPPING" :
        requiredSpecificsBlocked ? "REQUIRED_SPECIFICS" :
          waitingForRequirementCapability ? "REQUIRED_SPECIFICS" :
            waitingForIdentifierCapability ? "MARKETPLACE_READINESS" :
              marketplaceReadinessBlocked ? "MARKETPLACE_READINESS" :
                firstBlocker ?? "ECONOMICS"
    const mapped = emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
      STOCK: "PASS", DEMAND: marketTestPathEligible ? "WAITING" :
        stages.DEMAND_READY === "READY" ? "PASS" : "BLOCKED",
      SHIPPING: waitingForWorker ? "WAITING" :
        shipping.shippingJobStatus === "SHIPPING_EVIDENCE_DURABLE"
          ? "PASS" : "BLOCKED",
      ECONOMICS: stages.ECONOMICS_READY === "READY" ? "PASS" : "BLOCKED",
      PRODUCT_TRUTH: stages.PRODUCT_TRUTH_READY === "READY"
        ? "PASS" : "BLOCKED",
      LISTING_PACKAGE: stages.LISTING_PACKAGE_READY === "READY"
        ? "PASS" : "BLOCKED",
      REQUIRED_SPECIFICS: effectiveRequiredItemSpecificsReady ? "PASS"
        : waitingForRequirementCapability ? "WAITING" : "BLOCKED",
      MARKETPLACE_READINESS: marketplaceReadinessReady ? "PASS"
        : waitingForIdentifierCapability ? "WAITING" : "BLOCKED",
      LISTING_READY: listingReady ? "PASS" : marketTestReady
        ? "WAITING" : "BLOCKED" })
    const waitingForContinuation = !reviewReady && !waitingForWorker &&
      !firstBlocker
    const visibleStages = waitingForContinuation
      ? Object.freeze({ ...mapped,
          [projectedLastStage]: "WAITING" as const })
      : mapped
    return Object.freeze({ sourceUrl, canonicalUrl,
      candidateKey: String(row.candidate_key),
      candidateId: String(row.candidate_key), opportunityId: String(row.id),
      listingPackageId: listingPackage ? String(listingPackage.id) : null,
      sourceSku: text(row.supplier_sku, 120),
      lunaProductId: text(row.supplier_product_id, 80),
      lunaVariantId: text(row.supplier_variant_id, 80),
      title: text(row.product_title, 350),
      state: reviewReady ? "READY" as const : waitingForWorker
        || waitingForEbayCapability
        ? "WAITING" as const : firstBlocker
          ? "BLOCKED" as const : "WAITING" as const,
      lastStage: projectedLastStage,
      disposition: waitingForWorker ? "WAITING_FOR_SHIPPING_WORKER" :
        waitingForEbayCapability ? "WAITING_FOR_EBAY_CAPABILITY" :
        waitingForContinuation
          ? `WAITING_FOR_${projectedLastStage}_CONTINUATION`
          : autonomousDisposition ??
            String(row.decision ?? row.queue_status ?? "PARKED"),
      exactBlocker: reviewReady || waitingForWorker ? null : firstBlocker,
      exactBlockers: reviewReady
        ? Object.freeze([]) : Object.freeze(exactBlockers),
      variantSelectionRequired: false, variants: Object.freeze([]),
      alreadyLive: false, linkedLiveItemIds: Object.freeze([]),
      durableFamilyHit: false, onDemandDemandDiscoveryRequired: false,
      onDemandDemandDiscoveryExecuted: false, soldComparableCount: 0,
      familyDemandStatus: null, familyBindingCreatedOrReused: false,
      demandEvidenceClass: marketTestPathEligible
        ? "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE" : null,
      demandNegativeEvidencePresent: false,
      marketTestPathEligible,
      marketTestReady,
      marketTestReview: marketTestReady ? marketTestReview : null,
      requiredItemSpecificsCount,
      requiredItemSpecificsSatisfied,
      requiredItemSpecificsReady: effectiveRequiredItemSpecificsReady,
      unresolvedRequiredAspects: effectiveUnresolvedRequiredAspects,
      deterministicResolvedCount: specificsResolutions.filter((value) =>
        ["EXPLICIT_PRODUCT_TRUTH", "DETERMINISTIC_DERIVATION"]
          .includes(String(value.resolutionClass)) &&
        value.humanReviewRequired !== true).length,
      marketplaceFallbackResolvedCount: specificsResolutions.filter((value) =>
        value.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK" &&
        value.humanReviewRequired !== true).length,
      aiCallCount: number(specificsContinuation.aiCallCount) ?? 0,
      aiAspectsResolvedCount: specificsResolutions.filter((value) =>
        String(value.resolutionClass).startsWith("AI_") &&
        value.humanReviewRequired !== true).length,
      factInvented: false,
      automaticResolutionExhausted:
        specificsContinuation.automaticResolutionExhausted === true,
      automaticResolutionContractCurrent:
        specificsContinuation.autonomousResolutionContractVersion ===
          QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1,
      automaticResolutionUpgradeHasPriorResidual: new Set([
        ...textList(specificsContinuation.unresolvedAspectsBefore),
        ...textList(specificsContinuation.unresolvedAspectsAfter),
      ]).size > 0,
      exactUnresolvedFields: minimumContractCurrent
        ? Object.freeze(effectiveUnresolvedRequiredAspects)
        : textList(specificsContinuation.exactUnresolvedFields),
      ownerResidualActions: Object.freeze(ownerResidualActions),
      ownerTruePublicationBlockers:
        Object.freeze(ownerTruePublicationBlockers),
      ownerCapturedFacts: Object.freeze(ownerCapturedFacts),
      postPublishEnrichmentOpportunities:
        Object.freeze(postPublishEnrichmentOpportunities),
      nextOwnerAction: ownerResidualActions.some((value) =>
        value.ownerAction === "ENTER_FACT") ? "ENTER_FACT" as const
        : ownerResidualActions.some((value) => value.ownerAction === "CONFIRM")
          ? "CONFIRM" as const : null,
      minimumTruthfulListingReady:
        minimumReadiness.minimumTruthfulListingReady === true,
      officialRequirementClassification:
        minimumReadiness.officialRequirementClassification === true,
      requirementCounts: Object.freeze({
        requiredToList: number(minimumReadiness.requiredToListCount) ?? 0,
        conditionallyRequired:
          number(minimumReadiness.conditionallyRequiredCount) ?? 0,
        recommended: number(minimumReadiness.recommendedCount) ?? 0,
        optional: number(minimumReadiness.optionalCount) ?? 0,
        unproven: number(minimumReadiness.unprovenRequirementCount) ?? 0,
      }),
      productIdentifierRequirementStatus: ["PASS",
        "BLOCKED_REQUIRED_FACT", "UNPROVEN_CAPABILITY"].includes(String(
        record(minimumReadiness.gateStates).productIdentifiers ?? ""))
        ? record(minimumReadiness.gateStates).productIdentifiers as
          "PASS" | "BLOCKED_REQUIRED_FACT" | "UNPROVEN_CAPABILITY"
        : null,
      safeResumeAfterOwnerFact: minimumContractCurrent
        && minimumReadiness.safeResumeFrom ===
          "PRODUCT_TRUTH_REQUIRED_SPECIFICS_IDENTIFIER_POLICY_MARKETPLACE_READINESS",
      marketplaceReadinessReady,
      conditionReady,
      shippingUsd,
      rehydrated: input.includeRecent === true,
      stages: visibleStages,
      dollarCheck: reviewReady ? Object.freeze({
        title: row.product_title,
        targetPrice: marketTestReady ? marketTestReview.testPrice ?? null :
          intake.finalPriceUsd ?? null,
        supplierCost: marketTestReady ? marketTestReview.supplierCost ?? null :
          intake.supplierCostUsd ?? null,
        shipping: marketTestReady ? marketTestReview.shipping ?? null :
          intake.supplierShippingUsd ?? null,
        ebayFees: marketTestReady ? marketTestReview.ebayFees ?? null :
          intake.estimatedEbayFeesUsd ?? null,
        profit: marketTestReady ? marketTestReview.profit ?? null :
          intake.contributionProfitUsd ?? null,
        margin: marketTestReady ? marketTestReview.margin ?? null :
          intake.contributionMarginPercent ?? null,
        roi: marketTestReady ? marketTestReview.roi ?? null :
          intake.roiPercent ?? null,
        stock: "STOCK_SAFE",
        demandGrain: marketTestReady ? "UNPROVEN" : "FAMILY",
      }) : null,
      listingReview,
      overnightEnrichmentPending: overnightEligibility.eligible,
      overnightEnrichmentStatus: overnightEligibility.eligible
        ? "OVERNIGHT_ENRICHMENT_PENDING"
        : text(overnightAudit.afterStatus, 120),
      overnightEnrichmentLastRunAt:
        text(overnightAudit.enrichedAt, 80),
      updatedAt: text(row.updated_at, 80),
      elapsedMs: 0,
    })
  }))
}
