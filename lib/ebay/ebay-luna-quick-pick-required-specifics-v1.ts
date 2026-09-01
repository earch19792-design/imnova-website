import type { SupabaseClient } from "@supabase/supabase-js"

import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import {
  createOpenAiRequiredSpecificsBatchResolverV1,
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  REQUIRED_SPECIFICS_DIGEST_VERSION,
  revalidateCompatiblePriorAiResolutionsV1,
  requiredSpecificBatchEvidenceDigestV1,
  resolveMarketplaceRequiredSpecificsBatchV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"
import type {
  RequiredSpecificsAiBatchV1,
  RequiredSpecificsBatchProductV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"

export const QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1 =
  "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1" as const
export const QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1 =
  "QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V2" as const

const MAXIMUM_QUICK_PICKS = 20
const REQUIRED_ASPECT_SCOPE = "ALL_OFFICIAL_REQUIRED_ASPECTS" as const
const STALE_CLAIM_MS = 5 * 60 * 1_000
const AUTOMATIC_RESOLUTION_CASCADE = Object.freeze([
  "DURABLE_EXACT_LUNA_STRUCTURED_DATA",
  "EXACT_PUBLIC_LUNA_PRODUCT_JSON",
  "EXACT_TEXT_VARIANT_AND_SPECIFICATIONS",
  "EXISTING_PRODUCT_TRUTH_EVIDENCE",
  "EXACT_PRODUCT_IMAGES",
  "DETERMINISTIC_DERIVATION",
  "MARKETPLACE_ALLOWED_FALLBACK",
  "AI_MULTIMODAL_RESOLUTION",
  "EXACT_IDENTITY_EXTERNAL_ENRICHMENT",
  "OWNER_LAST_MILE",
])
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

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function unresolvedFields(value: unknown) {
  return Array.isArray(value) ? unique(value.flatMap((entry) => {
    const field = text(entry, 120)
    return field ? [field] : []
  })) : []
}

function sourceClassForResolution(value: JsonRecord) {
  const resolutionClass = String(value.resolutionClass ?? "")
  if (resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK") {
    return "MARKETPLACE_ALLOWED_FALLBACK"
  }
  if (resolutionClass.startsWith("AI_")) return "AI_COMPLETION"
  if (resolutionClass === "EXPLICIT_PRODUCT_TRUTH") {
    return "EXACT_PRODUCT_TRUTH"
  }
  return "DETERMINISTIC_EXACT_EVIDENCE"
}

export function projectQuickPickAutonomousResolutionV1(input: Readonly<{
  initial: JsonRecord
  refreshed: JsonRecord
  resolutions: readonly JsonRecord[]
  requiredSpecificsBatchInput: JsonRecord
  aiCallCountBefore: number
  aiCallCountAfter: number
}>) {
  const initialFields = unique([
    ...unresolvedFields(input.initial.unsupportedRequiredSpecifics),
    ...(input.initial.conditionReady === false ? ["Condition"] : []),
  ])
  let finalFields = unique([
    ...unresolvedFields(input.refreshed.unsupportedRequiredSpecifics),
    ...(input.refreshed.conditionReady === false ? ["Condition"] : []),
  ])
  if (!finalFields.length && input.refreshed.marketTestReady !== true
      && input.refreshed.listingReady !== true) {
    const blocker = text(input.refreshed.firstBlocker, 160)
    if (blocker?.startsWith("MARKETPLACE_CATEGORY")) {
      finalFields = ["eBay Category"]
    } else if (blocker?.startsWith(
      "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")) {
      finalFields = ["Required item specifics"]
    } else if (blocker?.startsWith("MARKETPLACE_")) {
      finalFields = ["Marketplace readiness"]
    }
  }
  const tags = normalized(record(
    input.requiredSpecificsBatchInput.exactSpecs).tags)
  const newInventoryProposalAvailable = (` ${tags} `).includes(
    " new inventory ")
  const residualOwnerActions = finalFields.map((field) => {
    const resolution = input.resolutions.find((entry) =>
      normalized(entry.aspectName) === normalized(field))
    const proposal = field === "Condition"
      ? (newInventoryProposalAvailable ? "New" : null)
      : text(resolution?.resolvedValue, 500)
    const evidence = field === "Condition"
      ? (newInventoryProposalAvailable
          ? "LUNA_EXACT_CATALOG_TAG_NEW_INVENTORY_NOT_CONDITION_CERTIFICATION"
          : "LUNA_EXACT_PRODUCT_CONDITION_NOT_DECLARED")
      : text(record(resolution?.sourceEvidence).sourceExcerpt, 500)
        ?? "AUTOMATIC_EVIDENCE_CASCADE_EXHAUSTED"
    return Object.freeze({
      productField: field,
      exactUnresolvedField: field,
      disposition: proposal
        ? "OWNER_CONFIRMATION_REQUIRED" : "OWNER_FACT_REQUIRED",
      bestProposal: proposal,
      proposalEvidence: evidence,
      confidence: proposal
        ? (field === "Condition" ? "LOW" : resolution?.confidence ?? "LOW")
        : "LOW",
      ownerAction: proposal ? "CONFIRM" : "ENTER_FACT",
      editAllowed: true,
      automaticResolutionExhausted: true,
      factInvented: false,
    })
  })
  const finalDisposition = input.refreshed.marketTestReady === true
    ? "MARKET_TEST_READY"
    : input.refreshed.listingReady === true
      ? "LISTING_READY"
      : residualOwnerActions.some((entry) =>
          entry.disposition === "OWNER_FACT_REQUIRED")
        ? "OWNER_FACT_REQUIRED"
        : residualOwnerActions.length
          ? "OWNER_CONFIRMATION_REQUIRED"
          : "OWNER_FACT_REQUIRED"
  const resolvedFieldAudits = input.resolutions.filter((entry) =>
    entry.humanReviewRequired === false && text(entry.resolvedValue, 500))
    .map((entry) => Object.freeze({
      aspect: text(entry.aspectName, 120),
      resolvedValue: text(entry.resolvedValue, 500),
      sourceClass: sourceClassForResolution(entry),
      sourceEvidence: record(entry.sourceEvidence),
      resolutionMethod: entry.resolutionClass,
      confidence: entry.confidence,
      factInvented: false,
    }))
  return Object.freeze({
    autonomousResolutionContractVersion:
      QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1,
    canon: "AUTOMATE_FIRST_EVIDENCE_FIRST_AI_COMPLETION_OWNER_LAST_MILE_ONLY",
    automaticResolutionCascade: AUTOMATIC_RESOLUTION_CASCADE,
    initialUnresolvedFieldCount: initialFields.length,
    initialUnresolvedFields: Object.freeze(initialFields),
    finalUnresolvedFieldCount: finalFields.length,
    exactUnresolvedFields: Object.freeze(finalFields),
    resolvedFieldAudits: Object.freeze(resolvedFieldAudits),
    residualOwnerActions: Object.freeze(residualOwnerActions),
    finalDisposition,
    automaticResolutionExhausted: true,
    ownerLastMileOnly: residualOwnerActions.length > 0,
    canLunaCatalogSemanticsCertifyNewMerchandise:
      input.refreshed.conditionSource ===
        "LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1",
    conditionAuthorityReasonCode:
      input.refreshed.conditionSource ===
        "LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1"
        ? "OWNER_CERTIFIED_LUNA_CATALOG_NEW_MERCHANDISE"
        : "LUNA_CATALOG_GLOBAL_CONDITION_SEMANTICS_UNPROVEN",
    conditionId: text(input.refreshed.conditionId, 20),
    conditionSource: text(input.refreshed.conditionSource, 120),
    conditionReadyAfter: input.refreshed.conditionReady === true,
    aiCallCountBefore: input.aiCallCountBefore,
    aiCallCountIncrement: Math.max(0,
      input.aiCallCountAfter - input.aiCallCountBefore),
    aiCallCountAfter: input.aiCallCountAfter,
    externalExactIdentityResolvedCount: 0,
    metadataOnlyDoNotList: false,
    metadataFalseRejectionCount: 0,
    hiddenBlockerCount: 0,
    factInvented: false,
    marketplaceWrites: 0,
  })
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
    aspectScope: REQUIRED_ASPECT_SCOPE,
    digestVersion: REQUIRED_SPECIFICS_DIGEST_VERSION,
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
    aiExhausted: boolean, aiCallCountBefore: number }>> = []
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
    const blockedByCondition = blockers.some((blocker) => text(blocker, 120)
      ?.startsWith("MARKETPLACE_CONDITION_NOT_READY"))
    const metadataBlocked = blockedBySpecifics || blockedByCondition
    const legacyScopeReconciliation = Boolean(currentMarker
      && currentMarker.completedAt
      && (currentMarker.aspectScope !== REQUIRED_ASPECT_SCOPE
        || existingResolution.digestVersion !==
          REQUIRED_SPECIFICS_DIGEST_VERSION
        || (["LUNA_QUICK_PICK_SPECIFICS_BATCH_INPUT_INVALID",
          "REQUIRED_SPECIFICS_AI_CONFIGURATION_MISSING"].includes(
          String(currentMarker.resolverReasonCode ?? ""))
          && Number(currentMarker.scopeReconciliationRetryCount ?? 0) < 2))
      && blockedBySpecifics)
    const autonomousUpgradeRequired = Boolean(currentMarker
      && currentMarker.autonomousResolutionContractVersion !==
        QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1)
    const claimedAt = Date.parse(String(currentMarker?.autonomousClaimedAt
      ?? currentMarker?.claimedAt ?? ""))
    const incompleteClaimStale = Boolean(currentMarker
      && !currentMarker.completedAt && Number.isFinite(claimedAt)
      && Date.now() - claimedAt >= STALE_CLAIM_MS)
    if (!candidate || !metadataBlocked
      || (currentMarker && !legacyScopeReconciliation
        && !autonomousUpgradeRequired && !incompleteClaimStale)) continue
    const now = new Date().toISOString()
    const aiCallCountBefore = Number(currentMarker?.aiCallCount ?? 0)
    const nextMarker = currentMarker ? {
      ...currentMarker, aspectScope: REQUIRED_ASPECT_SCOPE,
      reconciliationClaimedAt: now,
      scopeReconciliationRetryCount:
        Number(currentMarker.scopeReconciliationRetryCount ?? 0) + 1,
    } : {
      contractVersion: QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1,
      claimedAt: now, aspectScope: REQUIRED_ASPECT_SCOPE,
      noArtificialBatchWait: true,
      opportunisticBatching: true, maximumAiCallsPerQuickPick: 1,
      aiCallCount: 0, factInvented: false, marketplaceWrites: 0,
    }
    Object.assign(nextMarker, {
      autonomousResolutionContractVersion:
        QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1,
      autonomousClaimedAt: now,
      automaticResolutionExhausted: false,
      finalDisposition: "RESOLVING",
      completedAt: null,
      aiCallCountBefore,
    })
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
      aiCallCountBefore,
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
          aiStages: [aiEligible.some((product) =>
            product.exactImageUrls.length > 0) ? "VISION" : "TEXT"],
        }))
      if (aiExhausted.length) resolvedBatches.push(
        await resolveMarketplaceRequiredSpecificsBatchV1({
          products: aiExhausted, aiResolver: null, aiStages: [],
        }))
      for (const batch of resolvedBatches) {
        for (const resolution of batch.candidates) {
          const entry = claimedByCandidate.get(resolution.radarCandidateId)
          const product = pending.find((candidate) =>
            candidate.radarCandidateId === resolution.radarCandidateId)
          if (entry && product) {
            const priorAssessment = record(entry.row.assessment)
            const priorDurable = record(priorAssessment
              .marketplaceRequiredSpecificsBatchResolutionV1)
            const priorMarker = marker(priorAssessment
              .quickPickRequiredSpecificsContinuationV1)
            const priorStage = priorMarker?.aiStage === "VISION"
              ? "VISION" as const : "TEXT" as const
            const compatiblePrior =
              revalidateCompatiblePriorAiResolutionsV1({ product,
                stage: priorStage, resolutions: priorDurable.resolutions })
            const merged = { ...resolution,
              resolutions: resolution.resolutions.map((current) => {
                if (!current.humanReviewRequired) return current
                return compatiblePrior.find((prior) =>
                  normalized(prior.aspectName) ===
                    normalized(current.aspectName)) ?? current
              }) }
            await persistResolution({ supabase: input.supabase,
              candidate: entry.candidate, resolution: merged })
          }
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
  const autonomousResults: Array<ReturnType<
    typeof projectQuickPickAutonomousResolutionV1>> = []
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
    const aiCallCountAfter = Number(current.aiCallCount ?? 0)
    const autonomous = projectQuickPickAutonomousResolutionV1({
      initial: record(initial), refreshed: record(refreshed), resolutions,
      requiredSpecificsBatchInput:
        record(refreshed?.requiredSpecificsBatchInput),
      aiCallCountBefore: entry.aiCallCountBefore,
      aiCallCountAfter,
    })
    autonomousResults.push(autonomous)
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
          conditionReady: refreshed?.conditionReady === true,
          requiredItemSpecificsReady:
            refreshed?.requiredItemSpecificsReady === true,
          ...autonomous,
          resolverStatus: resolverReasonCode
            ? "COMPLETED_WITH_SAFE_RESIDUAL"
            : autonomous.residualOwnerActions.length
              ? "COMPLETED_WITH_OWNER_RESIDUAL" : "COMPLETED",
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
    productsEvaluated: autonomousResults.length,
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
    initialUnresolvedFieldCount: autonomousResults.reduce((sum, result) =>
      sum + result.initialUnresolvedFieldCount, 0),
    finalUnresolvedFieldCount: autonomousResults.reduce((sum, result) =>
      sum + result.finalUnresolvedFieldCount, 0),
    ownerConfirmationRequiredCount: autonomousResults.filter((result) =>
      result.finalDisposition === "OWNER_CONFIRMATION_REQUIRED").length,
    ownerFactRequiredCount: autonomousResults.filter((result) =>
      result.finalDisposition === "OWNER_FACT_REQUIRED").length,
    metadataOnlyDoNotListCount: autonomousResults.filter((result) =>
      result.metadataOnlyDoNotList).length,
    marketTestReadyCount: autonomousResults.filter((result) =>
      result.finalDisposition === "MARKET_TEST_READY").length,
    listingReadyCount: autonomousResults.filter((result) =>
      result.finalDisposition === "LISTING_READY").length,
    ownerTouchesRequiredTotal: autonomousResults.filter((result) =>
      result.ownerLastMileOnly).length,
    automaticResolutionExhaustedForAllResiduals: autonomousResults.every(
      (result) => result.automaticResolutionExhausted),
    autonomousCompletionRate: (() => {
      const initial = autonomousResults.reduce((sum, result) =>
        sum + result.initialUnresolvedFieldCount, 0)
      const final = autonomousResults.reduce((sum, result) =>
        sum + result.finalUnresolvedFieldCount, 0)
      return initial > 0 ? (initial - final) / initial : 1
    })(),
    candidateReadinessReevaluated: reevaluated,
    resolverReasonCode, marketplaceWrites: 0 as const })
}
