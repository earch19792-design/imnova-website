import type { SupabaseClient } from "@supabase/supabase-js"

import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import {
  createOpenAiRequiredSpecificsBatchResolverV1,
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  requiredSpecificBatchEvidenceDigestV1,
  resolveMarketplaceRequiredSpecificsBatchV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"
import type {
  RequiredSpecificsAiBatchV1,
  RequiredSpecificsBatchProductV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"

export const QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1 =
  "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1" as const

const MAXIMUM_QUICK_PICKS = 20
const REQUIRED_ASPECT_SCOPE = "ALL_OFFICIAL_REQUIRED_ASPECTS" as const
type JsonRecord = Record<string, unknown>

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

function actionable(value: unknown) {
  const candidate = text(value, 120)
  return candidate && candidate !== "NONE" ? candidate : null
}

function marker(value: unknown) {
  const candidate = record(value)
  return candidate.contractVersion ===
    QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1 ? candidate : null
}

export function durableQuickPickRequiredSpecificsCandidateV1(row: unknown) {
  const durableRow = record(row)
  const assessment = record(durableRow.assessment)
  const candidate = record(assessment.radarFactoryCandidateV1)
  const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
  const stages = record(record(
    assessment.sellerOsDeterministicFactory).stageStatuses)
  const exact = candidate.contractVersion ===
      "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1"
    && candidate.authority === "SELLER_OS_DETERMINISTIC_FACTORY"
    && typeof candidate.candidateId === "string"
    && shipping.candidateId === candidate.candidateId
    && shipping.lunaProductId === durableRow.supplier_product_id
    && shipping.lunaVariantId === durableRow.supplier_variant_id
    && shipping.supplierSku === durableRow.supplier_sku
    && shipping.shippingJobStatus === "SHIPPING_EVIDENCE_DURABLE"
    && stages.ECONOMICS_READY === "READY"
    && stages.PRODUCT_TRUTH_READY === "READY"
  return exact ? Object.freeze({
    radarCandidateId: String(candidate.candidateId),
    rowId: String(durableRow.id),
    candidateKey: String(durableRow.candidate_key),
    lunaProductId: String(durableRow.supplier_product_id),
    lunaVariantId: String(durableRow.supplier_variant_id),
    supplierSku: String(durableRow.supplier_sku),
  }) : null
}

function validBatchInput(value: unknown,
  candidate: NonNullable<ReturnType<
    typeof durableQuickPickRequiredSpecificsCandidateV1>>,
): value is RequiredSpecificsBatchProductV1 {
  const input = record(value)
  return input.radarCandidateId === candidate.radarCandidateId
    && input.lunaProductId === candidate.lunaProductId
    && input.lunaVariantId === candidate.lunaVariantId
    && input.supplierSku === candidate.supplierSku
    && input.marketplaceId === "EBAY_US"
    && typeof input.categoryId === "string"
    && Array.isArray(input.unresolvedRequiredAspects)
    && Array.isArray(input.officialAspectDefinitions)
    && /^sha256:[0-9a-f]{64}$/.test(String(input.inputEvidenceDigest ?? ""))
}

async function consumeAiBudget(input: Readonly<{
  supabase: SupabaseClient
  rowId: string
  candidateKey: string
  stage: "TEXT" | "VISION"
}>) {
  const rowRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,assessment")
    .eq("id", input.rowId).eq("candidate_key", input.candidateKey)
    .maybeSingle()
  const row = record(rowRead.data)
  const assessment = record(row.assessment)
  const current = marker(assessment.quickPickRequiredSpecificsContinuationV1)
  if (rowRead.error || !row.id || !current
      || Number(current.aiCallCount ?? 0) >= 1) {
    throw new Error("LUNA_QUICK_PICK_AI_BUDGET_GUARD_BLOCKED")
  }
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...assessment,
      quickPickRequiredSpecificsContinuationV1: {
        ...current, aiCallCount: 1, aiStage: input.stage,
        aiCalledAt: new Date().toISOString(),
      } } })
    .eq("id", row.id).eq("candidate_key", row.candidate_key)
    .select("id").maybeSingle()
  if (write.error || !write.data) {
    throw new Error("LUNA_QUICK_PICK_AI_BUDGET_WRITE_FAILED")
  }
}

async function persistResolution(input: Readonly<{
  supabase: SupabaseClient
  candidate: NonNullable<ReturnType<
    typeof durableQuickPickRequiredSpecificsCandidateV1>>
  resolution: Awaited<ReturnType<
    typeof resolveMarketplaceRequiredSpecificsBatchV1>>["candidates"][number]
}>) {
  const rowRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment")
    .eq("id", input.candidate.rowId)
    .eq("candidate_key", input.candidate.candidateKey).maybeSingle()
  const row = record(rowRead.data)
  if (rowRead.error || !row.id
      || row.supplier_product_id !== input.resolution.lunaProductId
      || row.supplier_variant_id !== input.resolution.lunaVariantId
      || row.supplier_sku !== input.resolution.supplierSku) {
    throw new Error("LUNA_QUICK_PICK_SPECIFICS_IDENTITY_MISMATCH")
  }
  const candidateCore = {
    contractVersion: MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY",
    radarCandidateId: input.resolution.radarCandidateId,
    lunaProductId: input.resolution.lunaProductId,
    lunaVariantId: input.resolution.lunaVariantId,
    supplierSku: input.resolution.supplierSku,
    marketplaceId: input.resolution.marketplaceId,
    categoryId: input.resolution.categoryId,
    inputEvidenceDigest: input.resolution.inputEvidenceDigest,
    resolutions: input.resolution.resolutions,
    groupedBy: "EBAY_MARKETPLACE_PLUS_CATEGORY_ID",
    factInvented: false,
    marketplaceWrites: 0,
  }
  const durableResolution = Object.freeze({ ...candidateCore,
    evidenceDigest: requiredSpecificBatchEvidenceDigestV1(candidateCore) })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...record(row.assessment),
      marketplaceRequiredSpecificsBatchResolutionV1: durableResolution },
      updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("candidate_key", row.candidate_key)
    .eq("supplier_product_id", input.candidate.lunaProductId)
    .eq("supplier_variant_id", input.candidate.lunaVariantId)
    .eq("supplier_sku", input.candidate.supplierSku)
    .select("id,candidate_key,assessment").single()
  const stored = record(record(record(write.data).assessment)
    .marketplaceRequiredSpecificsBatchResolutionV1)
  if (write.error || !write.data
      || stored.evidenceDigest !== durableResolution.evidenceDigest) {
    throw new Error("LUNA_QUICK_PICK_SPECIFICS_DURABLE_WRITE_FAILED")
  }
}

export async function continueLunaQuickPickRequiredSpecificsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateKeys: readonly string[]
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  aiResolver?: RequiredSpecificsAiBatchV1 | null
}>) {
  const candidateKeys = [...new Set(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value)))].slice(0, MAXIMUM_QUICK_PICKS)
  if (!candidateKeys.length) return Object.freeze({ attempted: 0,
    claimed: 0, aiCallCount: 0, marketplaceWrites: 0 as const })
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment,updated_at")
    .in("candidate_key", candidateKeys).limit(MAXIMUM_QUICK_PICKS)
  if (read.error) throw new Error("LUNA_QUICK_PICK_SPECIFICS_READ_FAILED")
  const claimed: Array<Readonly<{ row: JsonRecord, candidate: NonNullable<
    ReturnType<typeof durableQuickPickRequiredSpecificsCandidateV1>>,
    aiExhausted: boolean }>> = []
  for (const row of rows(read.data)) {
    const assessment = record(row.assessment)
    const factory = record(assessment.sellerOsDeterministicFactory)
    const blockers = Array.isArray(factory.blockers)
      ? factory.blockers as unknown[] : []
    const existingResolution = record(
      assessment.marketplaceRequiredSpecificsBatchResolutionV1)
    const currentMarker = marker(
      assessment.quickPickRequiredSpecificsContinuationV1)
    const candidate = durableQuickPickRequiredSpecificsCandidateV1(row)
    const blockedBySpecifics = blockers.some((blocker) => text(blocker, 120)
      ?.startsWith("MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN"))
    const legacyScopeReconciliation = Boolean(currentMarker
      && currentMarker.completedAt
      && currentMarker.aspectScope !== REQUIRED_ASPECT_SCOPE
      && blockedBySpecifics)
    if (!candidate || !blockedBySpecifics
      || (currentMarker && !legacyScopeReconciliation)
      || (!legacyScopeReconciliation && existingResolution.contractVersion ===
        MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1)) continue
    const now = new Date().toISOString()
    const nextMarker = currentMarker ? {
      ...currentMarker, aspectScope: REQUIRED_ASPECT_SCOPE,
      reconciliationClaimedAt: now,
    } : {
      contractVersion: QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1,
      claimedAt: now, aspectScope: REQUIRED_ASPECT_SCOPE,
      noArtificialBatchWait: true,
      opportunisticBatching: true, maximumAiCallsPerQuickPick: 1,
      aiCallCount: 0, factInvented: false, marketplaceWrites: 0,
    }
    const claim = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: { ...assessment,
        quickPickRequiredSpecificsContinuationV1: nextMarker }, updated_at: now })
      .eq("id", row.id).eq("candidate_key", row.candidate_key)
      .eq("updated_at", row.updated_at)
      .eq("supplier_product_id", row.supplier_product_id)
      .eq("supplier_variant_id", row.supplier_variant_id)
      .eq("supplier_sku", row.supplier_sku)
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment,updated_at")
      .maybeSingle()
    if (!claim.error && claim.data) claimed.push(Object.freeze({
      row: record(claim.data), candidate,
      aiExhausted: Number(nextMarker.aiCallCount ?? 0) >= 1,
    }))
  }
  if (!claimed.length) return Object.freeze({ attempted: candidateKeys.length,
    claimed: 0, aiCallCount: 0, marketplaceWrites: 0 as const })

  const before = new Map<string, Awaited<ReturnType<
    typeof materializeSellerOsDeterministicFactoryCandidateV1>>>()
  const pending: RequiredSpecificsBatchProductV1[] = []
  for (const entry of claimed) {
    const materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: entry.candidate.rowId,
      candidateKey: entry.candidate.candidateKey,
      taxonomyReader: input.taxonomyReader,
    })
    before.set(entry.candidate.radarCandidateId, materialized)
    if (materialized.listingReady !== true
        && Array.isArray(materialized.unsupportedRequiredSpecifics)
        && materialized.unsupportedRequiredSpecifics.length > 0
        && validBatchInput(materialized.requiredSpecificsBatchInput,
          entry.candidate)) {
      pending.push(materialized.requiredSpecificsBatchInput)
    }
  }

  const claimedByCandidate = new Map(claimed.map((entry) =>
    [entry.candidate.radarCandidateId, entry]))
  const baseAiResolver = input.aiResolver === undefined
    ? createOpenAiRequiredSpecificsBatchResolverV1() : input.aiResolver
  const guardedAiResolver: RequiredSpecificsAiBatchV1 | null = baseAiResolver
    ? async (aiInput) => {
      for (const product of aiInput.products) {
        const entry = claimedByCandidate.get(product.radarCandidateId)
        if (!entry) throw new Error("LUNA_QUICK_PICK_AI_IDENTITY_MISMATCH")
        await consumeAiBudget({ supabase: input.supabase,
          rowId: entry.candidate.rowId,
          candidateKey: entry.candidate.candidateKey,
          stage: aiInput.stage })
      }
      return baseAiResolver(aiInput)
    } : null
  const resolvedBatches: Awaited<ReturnType<
    typeof resolveMarketplaceRequiredSpecificsBatchV1>>[] = []
  let resolverReasonCode: string | null = null
  if (claimed.some((entry) => {
    const initial = before.get(entry.candidate.radarCandidateId)
    return (Array.isArray(initial?.unsupportedRequiredSpecifics)
      ? initial.unsupportedRequiredSpecifics.length : 0) > 0
      && !pending.some((product) => product.radarCandidateId ===
        entry.candidate.radarCandidateId)
  })) resolverReasonCode = "LUNA_QUICK_PICK_SPECIFICS_BATCH_INPUT_INVALID"
  if (pending.length) {
    try {
      const aiEligible = pending.filter((product) =>
        claimedByCandidate.get(product.radarCandidateId)?.aiExhausted !== true)
      const aiExhausted = pending.filter((product) =>
        claimedByCandidate.get(product.radarCandidateId)?.aiExhausted === true)
      if (aiEligible.length) resolvedBatches.push(
        await resolveMarketplaceRequiredSpecificsBatchV1({
          products: aiEligible, aiResolver: guardedAiResolver,
          aiStages: ["TEXT"],
        }))
      if (aiExhausted.length) resolvedBatches.push(
        await resolveMarketplaceRequiredSpecificsBatchV1({
          products: aiExhausted, aiResolver: null, aiStages: [],
        }))
      for (const batch of resolvedBatches) {
        for (const resolution of batch.candidates) {
          const entry = claimedByCandidate.get(resolution.radarCandidateId)
          if (entry) await persistResolution({ supabase: input.supabase,
            candidate: entry.candidate, resolution })
        }
      }
    } catch (error) {
      resolverReasonCode = error instanceof Error
        && /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)
        ? error.message : "LUNA_QUICK_PICK_SPECIFICS_RESOLUTION_FAILED"
    }
  }

  let reevaluated = 0
  const after = new Map<string, Awaited<ReturnType<
    typeof materializeSellerOsDeterministicFactoryCandidateV1>>>()
  for (const entry of claimed) {
    const materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: entry.candidate.rowId,
      candidateKey: entry.candidate.candidateKey,
      taxonomyReader: input.taxonomyReader,
    })
    after.set(entry.candidate.radarCandidateId, materialized)
    reevaluated += 1
  }

  for (const entry of claimed) {
    const rowRead = await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,assessment")
      .eq("id", entry.candidate.rowId)
      .eq("candidate_key", entry.candidate.candidateKey).maybeSingle()
    const row = record(rowRead.data)
    if (rowRead.error || !row.id) continue
    const assessment = record(row.assessment)
    const current = marker(assessment.quickPickRequiredSpecificsContinuationV1)
    if (!current) continue
    const initial = before.get(entry.candidate.radarCandidateId)
    const refreshed = after.get(entry.candidate.radarCandidateId)
    const resolution = record(
      assessment.marketplaceRequiredSpecificsBatchResolutionV1)
    const resolutions = rows(resolution.resolutions)
    const deterministicResolvedCount = resolutions.filter((value) =>
      ["EXPLICIT_PRODUCT_TRUTH", "DETERMINISTIC_DERIVATION"]
        .includes(String(value.resolutionClass)) &&
      value.humanReviewRequired !== true).length
    const marketplaceFallbackResolvedCount = resolutions.filter((value) =>
      value.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK" &&
      value.humanReviewRequired !== true).length
    const aiAspectsResolvedCount = resolutions.filter((value) =>
      String(value.resolutionClass).startsWith("AI_") &&
      value.humanReviewRequired !== true).length
    const completion = await input.supabase.from(
      "ebay_luna_opportunity_queue")
      .update({ assessment: { ...assessment,
        quickPickRequiredSpecificsContinuationV1: {
          ...current, completedAt: new Date().toISOString(),
          requiredItemSpecificsCount:
            number(initial?.requiredItemSpecificsCount),
          requiredItemSpecificsSatisfiedBefore:
            number(initial?.requiredItemSpecificsSatisfied),
          unresolvedAspectsBefore:
            initial?.unsupportedRequiredSpecifics ?? [],
          requiredItemSpecificsSatisfiedAfter:
            number(refreshed?.requiredItemSpecificsSatisfied),
          unresolvedAspectsAfter:
            refreshed?.unsupportedRequiredSpecifics ?? [],
          deterministicResolvedCount, marketplaceFallbackResolvedCount,
          aiAspectsResolvedCount,
          marketplaceReadinessReady:
            refreshed?.canonicalMarketplaceReadinessReady === true,
          marketTestReady: refreshed?.marketTestReady === true,
          listingReady: refreshed?.listingReady === true,
          exactBlocker: actionable(refreshed?.firstBlocker),
          resolverStatus: resolverReasonCode ? "BLOCKED" : "COMPLETED",
          resolverReasonCode, factInvented: false, marketplaceWrites: 0,
        } } })
      .eq("id", row.id).eq("candidate_key", row.candidate_key)
      .select("id,candidate_key,assessment").single()
    const storedMarker = marker(record(record(completion.data).assessment)
      .quickPickRequiredSpecificsContinuationV1)
    if (completion.error || !completion.data || !storedMarker
        || !storedMarker.completedAt) {
      throw new Error("LUNA_QUICK_PICK_SPECIFICS_COMPLETION_WRITE_FAILED")
    }
  }
  return Object.freeze({ attempted: candidateKeys.length,
    claimed: claimed.length,
    requiredItemSpecificsCount: pending.reduce((sum, product) =>
      sum + product.unresolvedRequiredAspects.length, 0),
    deterministicResolvedCount:
      resolvedBatches.reduce((total, batch) =>
        total + batch.deterministicResolvedCount, 0),
    marketplaceFallbackResolvedCount:
      resolvedBatches.reduce((total, batch) =>
        total + batch.marketplaceFallbackResolvedCount, 0),
    aiCallCount: resolvedBatches.reduce((total, batch) =>
      total + batch.aiCallCount, 0),
    candidateReadinessReevaluated: reevaluated,
    resolverReasonCode, marketplaceWrites: 0 as const })
}
