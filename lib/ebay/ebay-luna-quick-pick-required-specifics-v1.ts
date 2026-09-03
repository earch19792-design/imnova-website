import type { SupabaseClient } from "@supabase/supabase-js"

import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import type { RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"
import {
  createOpenAiRequiredSpecificsBatchResolverV1,
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  REQUIRED_SPECIFICS_DIGEST_VERSION,
  revalidateCompatiblePriorAiResolutionsV1,
  requiredSpecificBatchEvidenceDigestV1,
  requiredSpecificsAiBatchEvidenceDigestV1,
  resolveMarketplaceRequiredSpecificsBatchV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"
import type {
  RequiredSpecificsAiBatchV1,
  RequiredSpecificsBatchProductV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1"
import { buildOwnerLunaUnbrandedPolicyApplicationV1,
  buildOwnerSupplierPolicyApplicationV1,
  readLunaNewMerchandisePolicyV1,
  readLunaUnbrandedAfterFullPageReviewPolicyV1,
  validateOwnerLunaUnbrandedPolicyApplicationV1,
  validateOwnerSupplierPolicyApplicationV1 } from
  "./ebay-owner-supplier-merchandise-policy-v1"
import { buildLunaFullPageImageReviewV1 } from
  "./ebay-luna-full-page-required-facts-v1"

export const QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1 =
  "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1" as const
export const QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1 =
  "QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V8" as const

const MAXIMUM_QUICK_PICKS = 20
const MATERIALIZATION_CONCURRENCY = 3
const REQUIRED_ASPECT_SCOPE = "ALL_OFFICIAL_REQUIRED_ASPECTS" as const
const STALE_CLAIM_MS = 5 * 60 * 1_000
const AUTOMATIC_RESOLUTION_CASCADE = Object.freeze([
  "FULL_EXACT_LUNA_PRODUCT_EVIDENCE_SET",
  "EXPLICIT_LUNA_FACT",
  "OWNER_POLICY",
  "DETERMINISTIC_DERIVATION",
  "LUNA_CONTEXTUAL_DERIVATION",
  "EBAY_SEMANTIC_MAPPING",
  "ONE_BOUNDED_AI_BATCH_MAX",
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

async function mapWithBoundedConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  resolver: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await resolver(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(
    Math.max(1, concurrency), values.length) }, worker))
  return output
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
  if (resolutionClass === "OWNER_POLICY") return "OWNER_POLICY"
  if (resolutionClass === "LUNA_CONTEXTUAL_DERIVATION") {
    return "LUNA_CONTEXTUAL_DERIVATION"
  }
  if (resolutionClass === "EBAY_SEMANTIC_MAPPING") {
    return "EBAY_SEMANTIC_MAPPING"
  }
  if (resolutionClass.startsWith("AI_")) return "AI_COMPLETION"
  if (resolutionClass === "EXPLICIT_PRODUCT_TRUTH") {
    return "EXACT_PRODUCT_TRUTH"
  }
  return "DETERMINISTIC_EXACT_EVIDENCE"
}

function sourceAuthorityForResolution(value: JsonRecord) {
  const field = String(record(value.sourceEvidence).sourceField ?? "NONE")
  if (field === "SPECS") return "EXACT_LUNA_STRUCTURED_PRODUCT_DATA"
  if (field === "VARIANT") return "EXACT_LUNA_STRUCTURED_VARIANT_DATA"
  if (field === "TITLE" || field === "DESCRIPTION") {
    return "EXACT_LUNA_SUPPLIER_TEXT"
  }
  if (field === "IMAGE") return "EXACT_LUNA_PRODUCT_IMAGE"
  if (field === "OWNER_POLICY") return "OWNER_LUNA_UNBRANDED_POLICY"
  if (field === "MARKETPLACE_POLICY") {
    return "OFFICIAL_EBAY_CATEGORY_POLICY"
  }
  return "NO_SUFFICIENT_EXACT_EVIDENCE"
}

export function projectQuickPickAutonomousResolutionV1(input: Readonly<{
  initial: JsonRecord
  refreshed: JsonRecord
  resolutions: readonly JsonRecord[]
  directResolutions?: JsonRecord
  baselineUnresolvedFields?: readonly string[]
  requiredSpecificsBatchInput: JsonRecord
  aiCallCountBefore: number
  aiCallCountAfter: number
}>) {
  const durableBaseline = unresolvedFields(input.baselineUnresolvedFields)
  const initialFields = durableBaseline.length ? durableBaseline : unique([
    ...unresolvedFields(input.initial.unsupportedRequiredSpecifics),
    ...(input.initial.conditionReady === false ? ["Condition"] : []),
  ])
  let finalFields = unique([
    ...unresolvedFields(input.refreshed.unsupportedRequiredSpecifics),
    ...(input.refreshed.conditionReady === false ? ["Condition"] : []),
  ])
  const readinessBlocker = text(input.refreshed.firstBlocker, 160)
  const waitingForEbayCapability = readinessBlocker ===
    "WAITING_FOR_EBAY_CAPABILITY"
  if (!finalFields.length && input.refreshed.marketTestReady !== true
      && input.refreshed.listingReady !== true
      && !waitingForEbayCapability) {
    if (readinessBlocker?.startsWith("MARKETPLACE_CATEGORY")) {
      finalFields = ["eBay Category"]
    } else if (readinessBlocker?.startsWith(
      "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")) {
      finalFields = ["Required item specifics"]
    } else if (readinessBlocker?.startsWith("MARKETPLACE_")) {
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
      whyAutomationCouldNotResolve: proposal
        ? "EXACT_EVIDENCE_REQUIRES_OWNER_CONFIRMATION"
        : "EXACT_EVIDENCE_INSUFFICIENT_OR_CONFLICTING",
      exactEvidenceMissing: field === "Condition"
        ? "AUTHORITATIVE_EXACT_PRODUCT_CONDITION"
        : `AUTHORITATIVE_EXACT_PRODUCT_${normalized(field)
          .toLocaleUpperCase("en-US").replace(/\s+/g, "_")}`,
      editAllowed: true,
      automaticResolutionExhausted: true,
      factInvented: false,
    })
  })
  const finalDisposition = input.refreshed.marketTestReady === true
    ? "MARKET_TEST_READY"
    : input.refreshed.listingReady === true
      ? "LISTING_READY"
      : waitingForEbayCapability
        ? "WAITING_FOR_EBAY_CAPABILITY"
      : residualOwnerActions.some((entry) =>
          entry.disposition === "OWNER_FACT_REQUIRED")
        ? "OWNER_FACT_REQUIRED"
        : residualOwnerActions.length
          ? "OWNER_CONFIRMATION_REQUIRED"
          : "OWNER_FACT_REQUIRED"
  const directResolutions = Object.entries(record(input.directResolutions))
    .flatMap(([aspectName, raw]) => {
      const value = record(raw)
      const resolvedValue = text(value.value, 500)
      if (!resolvedValue || value.exactProductSupported !== true
          || !initialFields.some((field) =>
            normalized(field) === normalized(aspectName))) return []
      const source = text(value.source, 120) ?? "EXPLICIT_LUNA_EVIDENCE"
      const resolutionClass = source === "OWNER_LUNA_UNBRANDED_POLICY"
        ? "OWNER_POLICY" : source === "LUNA_CONTEXTUAL_DERIVATION"
          ? "LUNA_CONTEXTUAL_DERIVATION"
          : source === "EBAY_SEMANTIC_MAPPING"
            ? "EBAY_SEMANTIC_MAPPING" : "EXPLICIT_PRODUCT_TRUTH"
      const sourceField = text(value.sourceField, 40)
        ?? (source === "LUNA_EXACT_PRODUCT_TITLE" ? "TITLE"
          : source === "OWNER_LUNA_UNBRANDED_POLICY"
            ? "OWNER_POLICY" : "DESCRIPTION")
      return [{ aspectName, resolvedValue, resolutionClass,
        sourceEvidence: { sourceField,
          sourceExcerpt: text(value.sourceExcerpt, 500) ?? resolvedValue,
          imageIndex: null }, confidence: "HIGH", factInvented: false,
        humanReviewRequired: false }]
    })
  const combinedResolutions = [...directResolutions, ...input.resolutions]
    .filter((entry, index, values) => values.findIndex((candidate) =>
      normalized(candidate.aspectName) === normalized(entry.aspectName)) === index)
  const resolvedFieldAudits = combinedResolutions.filter((entry) =>
    entry.humanReviewRequired === false && text(entry.resolvedValue, 500))
    .map((entry) => Object.freeze({
      specificName: text(entry.aspectName, 120),
      aspect: text(entry.aspectName, 120),
      resolvedValue: text(entry.resolvedValue, 500),
      sourceAuthority: sourceAuthorityForResolution(entry),
      sourceFieldOrText:
        text(record(entry.sourceEvidence).sourceExcerpt, 500),
      sourceClass: sourceClassForResolution(entry),
      sourceEvidence: record(entry.sourceEvidence),
      resolutionMethod: entry.resolutionClass,
      confidence: entry.confidence,
      ownerConfirmationRequired: false,
      factInvented: false,
    }))
  const requiredSpecificFactTraces = combinedResolutions.map((entry) => {
    const value = text(entry.resolvedValue, 500)
    return Object.freeze({
      specificName: text(entry.aspectName, 120),
      resolvedValue: value,
      sourceAuthority: sourceAuthorityForResolution(entry),
      sourceFieldOrText:
        text(record(entry.sourceEvidence).sourceExcerpt, 500),
      resolutionClass: entry.resolutionClass,
      confidence: entry.confidence,
      ownerConfirmationRequired:
        entry.humanReviewRequired === true && Boolean(value),
      factInvented: false,
    })
  })
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
    requiredSpecificFactTraces:
      Object.freeze(requiredSpecificFactTraces),
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
  return input.operationId === candidate.rowId
    && input.radarCandidateId === candidate.radarCandidateId
    && input.lunaProductId === candidate.lunaProductId
    && input.lunaVariantId === candidate.lunaVariantId
    && input.supplierSku === candidate.supplierSku
    && input.marketplaceId === "EBAY_US"
    && typeof input.categoryId === "string"
    && Array.isArray(input.unresolvedRequiredAspects)
    && Array.isArray(input.officialAspectDefinitions)
    && typeof input.compactLunaEvidence === "object"
    && /^sha256:[0-9a-f]{64}$/.test(String(input.inputEvidenceDigest ?? ""))
}

async function consumeAiBudget(input: Readonly<{
  supabase: SupabaseClient
  rowId: string
  candidateKey: string
  stage: "TEXT" | "VISION"
  batchEvidenceDigest: string
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
        aiBatchEvidenceDigest: input.batchEvidenceDigest,
        aiRetryCount: 0, duplicateAiCallCount: 0,
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
    aiBatchEvidenceDigest: input.resolution.aiBatchEvidenceDigest ?? null,
    resolutions: input.resolution.resolutions,
    groupedBy: "ONE_BOUNDED_BATCH_ACROSS_OFFICIAL_CATEGORIES",
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

async function persistAiFullPageBrandReviewV1(input: Readonly<{
  supabase: SupabaseClient
  candidate: NonNullable<ReturnType<
    typeof durableQuickPickRequiredSpecificsCandidateV1>>
  product: RequiredSpecificsBatchProductV1
  resolutions: readonly JsonRecord[]
}>) {
  const brand = input.resolutions.find((resolution) =>
    normalized(resolution.aspectName) === "brand"
    && resolution.brandEvidenceReviewSource ===
      "ONE_BOUNDED_OPENAI_FULL_IMAGE_BATCH")
  const brandEvidenceStatus = String(brand?.brandEvidenceStatus ?? "")
  const explicitBrand = text(brand?.explicitBrand, 120)
  if (!brand || brand.allExactProductImagesReviewed !== true
      || input.product.exactImageUrls.length === 0
      || !["NO_EXPLICIT_BRAND", "EXPLICIT_BRAND", "CONFLICT"]
        .includes(brandEvidenceStatus)
      || (brandEvidenceStatus === "EXPLICIT_BRAND" && !explicitBrand)
      || (brandEvidenceStatus !== "EXPLICIT_BRAND" && explicitBrand)) return
  const review = buildLunaFullPageImageReviewV1({
    lunaProductId: input.product.lunaProductId,
    lunaVariantId: input.product.lunaVariantId,
    supplierSku: input.product.supplierSku,
    imageUrls: input.product.exactImageUrls,
    brandEvidenceStatus: brandEvidenceStatus as
      "NO_EXPLICIT_BRAND" | "EXPLICIT_BRAND" | "CONFLICT",
    explicitBrand,
    reviewMethod: "ONE_BOUNDED_OPENAI_BATCH",
  })
  if (!review) throw new Error("LUNA_FULL_PAGE_BRAND_REVIEW_INVALID")
  const rowRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment")
    .eq("id", input.candidate.rowId)
    .eq("candidate_key", input.candidate.candidateKey).maybeSingle()
  const row = record(rowRead.data)
  if (rowRead.error || !row.id
      || row.supplier_product_id !== input.product.lunaProductId
      || row.supplier_variant_id !== input.product.lunaVariantId
      || row.supplier_sku !== input.product.supplierSku) {
    throw new Error("LUNA_FULL_PAGE_BRAND_REVIEW_IDENTITY_MISMATCH")
  }
  const assessment = record(row.assessment)
  const existing = record(assessment.lunaFullPageImageReviewV1)
  if (existing.imageSetDigest === review.imageSetDigest
      && existing.evidenceDigest === review.evidenceDigest) return
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...assessment,
      lunaFullPageImageReviewV1: review }, updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("candidate_key", row.candidate_key)
    .eq("supplier_product_id", input.product.lunaProductId)
    .eq("supplier_variant_id", input.product.lunaVariantId)
    .eq("supplier_sku", input.product.supplierSku)
    .select("id,assessment").single()
  const stored = record(record(record(write.data).assessment)
    .lunaFullPageImageReviewV1)
  if (write.error || !write.data
      || stored.evidenceDigest !== review.evidenceDigest) {
    throw new Error("LUNA_FULL_PAGE_BRAND_REVIEW_WRITE_FAILED")
  }
}

export async function continueLunaQuickPickRequiredSpecificsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateKeys: readonly string[]
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
  aiResolver?: RequiredSpecificsAiBatchV1 | null
  trigger?: "IMMEDIATE" | "OVERNIGHT_ENRICHMENT"
}>) {
  const candidateKeys = [...new Set(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value)))].slice(0, MAXIMUM_QUICK_PICKS)
  if (!candidateKeys.length) return Object.freeze({ attempted: 0,
    claimed: 0, aiCallCount: 0, marketplaceWrites: 0 as const })
  const [ownerBrandPolicy, ownerConditionPolicy] = await Promise.all([
    readLunaUnbrandedAfterFullPageReviewPolicyV1({
      supabase: input.supabase, accountKey: input.accountKey,
    }),
    readLunaNewMerchandisePolicyV1({
      supabase: input.supabase, accountKey: input.accountKey,
    }),
  ])
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment,updated_at")
    .in("candidate_key", candidateKeys).limit(MAXIMUM_QUICK_PICKS)
  if (read.error) throw new Error("LUNA_QUICK_PICK_SPECIFICS_READ_FAILED")
  const queueRows = rows(read.data)
  const waitingBatchIds = new Set(queueRows.flatMap((row) => {
    const assessment = record(row.assessment)
    const operation = record(assessment.lunaQuickPickOperationV1)
    const shipping = record(
      assessment.radarAutomaticLunaShippingContinuationV1)
    const batchId = text(operation.batchId, 80)
    return batchId && shipping.shippingJobStatus === "WAITING_BROWSER_WORKER"
      ? [batchId] : []
  }))
  const claimed: Array<Readonly<{ row: JsonRecord, candidate: NonNullable<
    ReturnType<typeof durableQuickPickRequiredSpecificsCandidateV1>>,
    aiExhausted: boolean, aiCallCountBefore: number,
    baselineUnresolvedFields: readonly string[] }>> = []
  for (const row of queueRows) {
    const assessment = record(row.assessment)
    const operation = record(assessment.lunaQuickPickOperationV1)
    const operationBatchId = text(operation.batchId, 80)
    // The receipt is the AI batching boundary. Do not let one fast Shipping
    // job consume the only batch call while a sibling is still executing.
    if (operationBatchId && waitingBatchIds.has(operationBatchId)) continue
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
    const requiredTruth = record(record(
      assessment.canonicalMarketplaceReadinessV1)
      .requiredItemSpecificsTruth)
    const fullLunaEvidence = record(
      requiredTruth.lunaExactProductEvidenceSetV1)
    const brandResolution = record(Object.entries(record(
      requiredTruth.resolutions)).find(([name]) =>
        normalized(name) === "brand")?.[1])
    const brandEvidencePending =
      operation.fullLunaBrandEvidenceReviewRequired === true
      && Number(fullLunaEvidence.exactImageCount ?? 0) > 0
      && fullLunaEvidence.allExactProductImagesReviewed !== true
      && brandResolution.exactProductSupported !== true
    const durableDigestUpgrade = typeof existingResolution.digestVersion ===
      "string" && existingResolution.digestVersion.length > 0
      && existingResolution.digestVersion !== REQUIRED_SPECIFICS_DIGEST_VERSION
    const legacyScopeReconciliation = Boolean(currentMarker
      && currentMarker.completedAt
      && (currentMarker.aspectScope !== REQUIRED_ASPECT_SCOPE
        || durableDigestUpgrade
        || (["LUNA_QUICK_PICK_SPECIFICS_BATCH_INPUT_INVALID",
          "REQUIRED_SPECIFICS_AI_CONFIGURATION_MISSING"].includes(
          String(currentMarker.resolverReasonCode ?? ""))
          && Number(currentMarker.scopeReconciliationRetryCount ?? 0) < 2))
      && blockedBySpecifics)
    const autonomousUpgradeRequired = Boolean(currentMarker
      && currentMarker.autonomousResolutionContractVersion !==
        QUICK_PICK_AUTONOMOUS_BLOCKER_RESOLUTION_V1)
    const priorResidualScope = unique(currentMarker?.completedAt
      && currentMarker.fullLunaPageIsPrimaryProductEvidence === true
      ? unresolvedFields(currentMarker?.unresolvedAspectsBefore)
      : unresolvedFields(currentMarker?.unresolvedAspectsAfter))
    const safeContractUpgrade = autonomousUpgradeRequired
      && priorResidualScope.length > 0
    const claimedAt = Date.parse(String(currentMarker?.autonomousClaimedAt
      ?? currentMarker?.claimedAt ?? ""))
    const incompleteClaimStale = Boolean(currentMarker
      && !currentMarker.completedAt && Number.isFinite(claimedAt)
      && Date.now() - claimedAt >= STALE_CLAIM_MS)
    const overnightReevaluation = input.trigger === "OVERNIGHT_ENRICHMENT"
      && Boolean(currentMarker?.completedAt)
    if (!candidate || (!metadataBlocked && !safeContractUpgrade
        && !brandEvidencePending)
      || (currentMarker && !legacyScopeReconciliation
        && !autonomousUpgradeRequired && !incompleteClaimStale
        && !overnightReevaluation && !brandEvidencePending)) continue
    const now = new Date().toISOString()
    const aiCallCountBefore = Number(currentMarker?.aiCallCount ?? 0)
    const baselineUnresolvedFields = unique([
      ...priorResidualScope,
      ...blockers.flatMap((blocker) => {
        const value = text(blocker, 500) ?? ""
        return value.startsWith("MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:")
          ? value.split(":").slice(1).join(":").split("|").filter(Boolean) : []
      }),
      ...(blockedByCondition ? ["Condition"] : []),
    ])
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
      maximumAiCallsPerBatch: 1,
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
      maximumAiCallsPerBatch: 1,
      aiRetryCount: 0,
      duplicateAiCallCount: 0,
      resolutionTrigger: input.trigger ?? "IMMEDIATE",
      ...(overnightReevaluation ? { overnightClaimedAt: now } : {}),
    })
    const currentBrandPolicyApplication = record(
      assessment.ownerLunaUnbrandedPolicyApplicationV1)
    const reusableBrandPolicyApplication = ownerBrandPolicy
      && currentBrandPolicyApplication.policyId === ownerBrandPolicy.id
      && currentBrandPolicyApplication.policyDigest ===
        ownerBrandPolicy.evidenceDigest
      && validateOwnerLunaUnbrandedPolicyApplicationV1(
        currentBrandPolicyApplication, {
          lunaProductId: row.supplier_product_id,
          lunaVariantId: row.supplier_variant_id,
          supplierSku: row.supplier_sku,
        }) ? currentBrandPolicyApplication : null
    const brandPolicyApplication = reusableBrandPolicyApplication
      ?? (ownerBrandPolicy ? buildOwnerLunaUnbrandedPolicyApplicationV1({
        policy: ownerBrandPolicy,
        lunaProductId: String(row.supplier_product_id),
        lunaVariantId: String(row.supplier_variant_id),
        supplierSku: String(row.supplier_sku),
        exactSupplierLineageCertified: true,
        productIdentityExact: true,
        appliedAt: now,
      }) : null)
    const currentConditionPolicyApplication = record(
      assessment.ownerSupplierMerchandisePolicyApplicationV1)
    const reusableConditionPolicyApplication = ownerConditionPolicy
      && currentConditionPolicyApplication.policyId === ownerConditionPolicy.id
      && currentConditionPolicyApplication.policyDigest ===
        ownerConditionPolicy.evidenceDigest
      && validateOwnerSupplierPolicyApplicationV1(
        currentConditionPolicyApplication, {
          lunaProductId: row.supplier_product_id,
          lunaVariantId: row.supplier_variant_id,
          supplierSku: row.supplier_sku,
        }) ? currentConditionPolicyApplication : null
    const conditionPolicyApplication = reusableConditionPolicyApplication
      ?? (ownerConditionPolicy ? buildOwnerSupplierPolicyApplicationV1({
        policy: ownerConditionPolicy,
        lunaProductId: String(row.supplier_product_id),
        lunaVariantId: String(row.supplier_variant_id),
        supplierSku: String(row.supplier_sku),
        exactSupplierLineageCertified: true,
        productIdentityExact: true,
        appliedAt: now,
      }) : null)
    const nextAssessment = { ...assessment,
        quickPickRequiredSpecificsContinuationV1: nextMarker,
        ...(brandPolicyApplication ? {
          ownerLunaUnbrandedPolicyApplicationV1: brandPolicyApplication,
        } : {}),
        ...(conditionPolicyApplication ? {
          ownerSupplierMerchandisePolicyApplicationV1:
            conditionPolicyApplication,
        } : {}),
      }
    const claim = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: nextAssessment, updated_at: now })
      .eq("id", row.id).eq("candidate_key", row.candidate_key)
      .eq("updated_at", row.updated_at)
      .eq("supplier_product_id", row.supplier_product_id)
      .eq("supplier_variant_id", row.supplier_variant_id)
      .eq("supplier_sku", row.supplier_sku)
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,updated_at")
      .maybeSingle()
    if (!claim.error && claim.data) claimed.push(Object.freeze({
      row: { ...record(claim.data), assessment: nextAssessment }, candidate,
      aiExhausted: Number(nextMarker.aiCallCount ?? 0) >= 1,
      aiCallCountBefore, baselineUnresolvedFields,
    }))
  }
  if (!claimed.length) return Object.freeze({ attempted: candidateKeys.length,
    claimed: 0, aiCallCount: 0, marketplaceWrites: 0 as const })

  const before = new Map<string, Awaited<ReturnType<
    typeof materializeSellerOsDeterministicFactoryCandidateV1>>>()
  const pending: RequiredSpecificsBatchProductV1[] = []
  const initialMaterializations = await mapWithBoundedConcurrency(
    claimed, MATERIALIZATION_CONCURRENCY, async (entry) => ({ entry,
      materialized: await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase: input.supabase, accountKey: input.accountKey,
        opportunityId: entry.candidate.rowId,
        candidateKey: entry.candidate.candidateKey,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      }),
    }))
  for (const { entry, materialized } of initialMaterializations) {
    before.set(entry.candidate.radarCandidateId, materialized)
    if (validBatchInput(materialized.requiredSpecificsBatchInput,
          entry.candidate)
        && materialized.requiredSpecificsBatchInput
          .unresolvedRequiredAspects.length > 0) {
      // This may contain an optional Brand evidence review. It is allowed to
      // enrich Product Truth but remains absent from publication blockers.
      pending.push(materialized.requiredSpecificsBatchInput)
    }
  }

  const claimedByCandidate = new Map(claimed.map((entry) =>
    [entry.candidate.radarCandidateId, entry]))
  const baseAiResolver = input.aiResolver === undefined
    ? createOpenAiRequiredSpecificsBatchResolverV1() : input.aiResolver
  const guardedAiResolver: RequiredSpecificsAiBatchV1 | null = baseAiResolver
    ? async (aiInput) => {
      const batchEvidenceDigest = requiredSpecificsAiBatchEvidenceDigestV1(
        aiInput.products, aiInput.stage)
      for (const product of aiInput.products) {
        const entry = claimedByCandidate.get(product.radarCandidateId)
        if (!entry) throw new Error("LUNA_QUICK_PICK_AI_IDENTITY_MISMATCH")
        await consumeAiBudget({ supabase: input.supabase,
          rowId: entry.candidate.rowId,
          candidateKey: entry.candidate.candidateKey,
          stage: aiInput.stage, batchEvidenceDigest })
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
            await persistAiFullPageBrandReviewV1({
              supabase: input.supabase,
              candidate: entry.candidate,
              product,
              resolutions: merged.resolutions.map((value) =>
                value as unknown as JsonRecord),
            })
            await persistResolution({ supabase: input.supabase,
              candidate: entry.candidate, resolution: merged })
          }
        }
      }
      const aiFailureCode = resolvedBatches.flatMap((batch) =>
        batch.aiFailureCodes)[0]
      if (aiFailureCode) resolverReasonCode = aiFailureCode
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
  const fullPageMetricTotals = {
    brandExplicitLunaCount: 0,
    brandUnbrandedPolicyCount: 0,
    explicitLunaFactResolvedCount: 0,
    directDeterministicDerivationCount: 0,
    lunaContextualDerivationCount: 0,
    ebaySemanticMappingCount: 0,
    freeTextAutoFilledCount: 0,
    selectionOnlyAutoMappedCount: 0,
    directResolvedCount: 0,
    sourceConflictDetectedCount: 0,
  }
  const finalMaterializations = await mapWithBoundedConcurrency(
    claimed, MATERIALIZATION_CONCURRENCY, async (entry) => ({ entry,
      materialized: await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase: input.supabase, accountKey: input.accountKey,
        opportunityId: entry.candidate.rowId,
        candidateKey: entry.candidate.candidateKey,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      }),
    }))
  for (const { entry, materialized } of finalMaterializations) {
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
    const directResolutions = record(
      refreshed?.requiredItemSpecificResolutions)
    const aiCallCountAfter = Number(current.aiCallCount ?? 0)
    const autonomous = projectQuickPickAutonomousResolutionV1({
      initial: record(initial), refreshed: record(refreshed), resolutions,
      directResolutions,
      baselineUnresolvedFields: entry.baselineUnresolvedFields,
      requiredSpecificsBatchInput:
        record(refreshed?.requiredSpecificsBatchInput),
      aiCallCountBefore: entry.aiCallCountBefore,
      aiCallCountAfter,
    })
    autonomousResults.push(autonomous)
    const directResolved = Object.entries(directResolutions).flatMap(
      ([specificName, raw]) => {
        const value = record(raw)
        return value.exactProductSupported === true
          && entry.baselineUnresolvedFields.some((field) =>
            normalized(field) === normalized(specificName))
          ? [{ specificName, source: String(value.source ?? ""),
            value: value.value, sourceField: value.sourceField,
            sourceExcerpt: value.sourceExcerpt }] : []
      })
    const deterministicResolvedCount = resolutions.filter((value) =>
      ["EXPLICIT_PRODUCT_TRUTH", "DETERMINISTIC_DERIVATION"]
        .includes(String(value.resolutionClass)) &&
      value.humanReviewRequired !== true).length + directResolved.filter(
      (value) => ["LUNA_EXACT_PRODUCT_TITLE",
        "LUNA_EXACT_STRUCTURED_VENDOR", "EXPLICIT_LUNA_EVIDENCE",
        "DETERMINISTIC_DERIVATION"].includes(String(value.source))).length
    const marketplaceFallbackResolvedCount = resolutions.filter((value) =>
      value.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK" &&
      value.humanReviewRequired !== true).length
    const aiAspectsResolvedCount = resolutions.filter((value) =>
      String(value.resolutionClass).startsWith("AI_") &&
      value.humanReviewRequired !== true).length
    const brandExplicitLunaCount = directResolved.filter((value) =>
      normalized(value.specificName) === "brand"
      && value.source === "EXPLICIT_LUNA_EVIDENCE").length
    const brandUnbrandedPolicyCount = directResolved.filter((value) =>
      normalized(value.specificName) === "brand"
      && value.source === "OWNER_LUNA_UNBRANDED_POLICY").length
    const explicitLunaFactResolvedCount = directResolved.filter((value) =>
      value.source === "EXPLICIT_LUNA_EVIDENCE"
      || value.source === "LUNA_EXACT_PRODUCT_TITLE"
      || value.source === "LUNA_EXACT_STRUCTURED_VENDOR").length
    const directDeterministicDerivationCount = directResolved.filter((value) =>
      value.source === "DETERMINISTIC_DERIVATION").length
    const lunaContextualDerivationCount = directResolved.filter((value) =>
      value.source === "LUNA_CONTEXTUAL_DERIVATION").length
    const ebaySemanticMappingCount = directResolved.filter((value) =>
      value.source === "EBAY_SEMANTIC_MAPPING").length
    const fullLunaEvidence = record(
      refreshed?.lunaExactProductEvidenceSetV1)
    const sourceConflictDetected = Array.isArray(
      fullLunaEvidence.sourceConflicts)
      && (fullLunaEvidence.sourceConflicts as unknown[]).length > 0
    fullPageMetricTotals.brandExplicitLunaCount += brandExplicitLunaCount
    fullPageMetricTotals.brandUnbrandedPolicyCount +=
      brandUnbrandedPolicyCount
    fullPageMetricTotals.explicitLunaFactResolvedCount +=
      explicitLunaFactResolvedCount
    fullPageMetricTotals.directDeterministicDerivationCount +=
      directDeterministicDerivationCount
    fullPageMetricTotals.lunaContextualDerivationCount +=
      lunaContextualDerivationCount
    fullPageMetricTotals.ebaySemanticMappingCount +=
      ebaySemanticMappingCount
    fullPageMetricTotals.freeTextAutoFilledCount +=
      lunaContextualDerivationCount
    fullPageMetricTotals.selectionOnlyAutoMappedCount +=
      ebaySemanticMappingCount
    fullPageMetricTotals.directResolvedCount += directResolved.length
    fullPageMetricTotals.sourceConflictDetectedCount +=
      sourceConflictDetected ? 1 : 0
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
            entry.baselineUnresolvedFields,
          requiredItemSpecificsSatisfiedAfter:
            number(refreshed?.requiredItemSpecificsSatisfied),
          unresolvedAspectsAfter:
            refreshed?.unsupportedRequiredSpecifics ?? [],
          deterministicResolvedCount, marketplaceFallbackResolvedCount,
          aiAspectsResolvedCount,
          brandExplicitLunaCount,
          brandUnbrandedPolicyCount,
          explicitLunaFactResolvedCount,
          directDeterministicDerivationCount,
          lunaContextualDerivationCount,
          ebaySemanticMappingCount,
          freeTextAutoFilledCount: lunaContextualDerivationCount,
          selectionOnlyAutoMappedCount: ebaySemanticMappingCount,
          fullLunaPageIsPrimaryProductEvidence: true,
          fullLunaEvidenceSetDigest: record(
            refreshed?.lunaExactProductEvidenceSetV1).evidenceDigest ?? null,
          sourceConflictDetected,
          marketplaceReadinessReady:
            refreshed?.canonicalMarketplaceReadinessReady === true,
          marketTestReady: refreshed?.marketTestReady === true,
          listingReady: refreshed?.listingReady === true,
          exactBlocker: actionable(refreshed?.firstBlocker),
          conditionReady: refreshed?.conditionReady === true,
          requiredItemSpecificsReady:
            refreshed?.requiredItemSpecificsReady === true,
          ...autonomous,
          resolutionTrigger: input.trigger ?? "IMMEDIATE",
          ...(input.trigger === "OVERNIGHT_ENRICHMENT"
            ? { lastOvernightEnrichedAt: new Date().toISOString() } : {}),
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
    autoResolvedRequiredSpecificsCount: fullPageMetricTotals.directResolvedCount
      + resolvedBatches.reduce(
      (total, batch) => total + batch.candidates.reduce(
        (candidateTotal, candidate) => candidateTotal
          + candidate.resolutions.filter((resolution) =>
            resolution.humanReviewRequired === false
            && Boolean(resolution.resolvedValue)).length, 0), 0),
    residualRequiredFactCountBefore: claimed.reduce((sum, entry) =>
      sum + entry.baselineUnresolvedFields.filter((field) =>
        normalized(field) !== "condition").length, 0),
    brandResidualBefore: claimed.reduce((sum, entry) => sum
      + entry.baselineUnresolvedFields.filter((field) =>
        normalized(field) === "brand").length, 0),
    nonBrandResidualBefore: claimed.reduce((sum, entry) => sum
      + entry.baselineUnresolvedFields.filter((field) =>
        normalized(field) !== "brand" && normalized(field) !== "condition")
        .length, 0),
    brandExplicitLunaCount: fullPageMetricTotals.brandExplicitLunaCount,
    brandUnbrandedPolicyCount:
      fullPageMetricTotals.brandUnbrandedPolicyCount,
    brandResidualAfter: autonomousResults.reduce((sum, result) => sum
      + result.exactUnresolvedFields.filter((field) =>
        normalized(field) === "brand").length, 0),
    explicitLunaFactResolvedCount:
      fullPageMetricTotals.explicitLunaFactResolvedCount,
    directDeterministicDerivationCount:
      fullPageMetricTotals.directDeterministicDerivationCount,
    lunaContextualDerivationCount:
      fullPageMetricTotals.lunaContextualDerivationCount,
    ebaySemanticMappingCount: fullPageMetricTotals.ebaySemanticMappingCount,
    freeTextAutoFilledCount: fullPageMetricTotals.freeTextAutoFilledCount,
    selectionOnlyAutoMappedCount:
      fullPageMetricTotals.selectionOnlyAutoMappedCount,
    factsResolvedWithoutAi: fullPageMetricTotals.directResolvedCount
      + resolvedBatches.reduce((sum, batch) => sum
        + batch.deterministicResolvedCount
        + batch.marketplaceFallbackResolvedCount, 0),
    factsSentToSingleAiBatch: resolvedBatches.reduce((sum, batch) =>
      sum + batch.aiFactsSentCount, 0),
    factsResolvedByAi: resolvedBatches.reduce((sum, batch) => sum
      + batch.candidates.reduce((candidateSum, candidate) => candidateSum
        + candidate.resolutions.filter((resolution) =>
          String(resolution.resolutionClass).startsWith("AI_")
          && resolution.humanReviewRequired === false).length, 0), 0),
    openAiTotalInputTokens: resolvedBatches.reduce((sum, batch) =>
      sum + batch.aiInputTokens, 0),
    openAiTotalOutputTokens: resolvedBatches.reduce((sum, batch) =>
      sum + batch.aiOutputTokens, 0),
    aiCostStatus: resolvedBatches.some((batch) => batch.aiCallCount > 0)
      ? "BOUNDED_SINGLE_BATCH_USAGE_RECORDED" : "NO_NEW_AI_COST",
    aiRetryCount: 0 as const,
    duplicateAiCallCount: 0 as const,
    sourceConflictDetectedCount:
      fullPageMetricTotals.sourceConflictDetectedCount,
    initialUnresolvedFieldCount: autonomousResults.reduce((sum, result) =>
      sum + result.initialUnresolvedFieldCount, 0),
    finalUnresolvedFieldCount: autonomousResults.reduce((sum, result) =>
      sum + result.finalUnresolvedFieldCount, 0),
    ownerConfirmationRequiredCount: autonomousResults.filter((result) =>
      result.residualOwnerActions.some((action) =>
        action.disposition === "OWNER_CONFIRMATION_REQUIRED")).length,
    ownerFactRequiredCount: autonomousResults.filter((result) =>
      result.residualOwnerActions.some((action) =>
        action.disposition === "OWNER_FACT_REQUIRED")).length,
    ownerLastMileFactCount: autonomousResults.reduce((sum, result) =>
      sum + result.residualOwnerActions.length, 0),
    residualRequiredFactCountAfter: autonomousResults.reduce((sum, result) =>
      sum + result.exactUnresolvedFields.filter((field) =>
        normalized(field) !== "condition"
        && normalized(field) !== "marketplace readiness").length, 0),
    waitingForEbayCapabilityCount: autonomousResults.filter((result) =>
      result.finalDisposition === "WAITING_FOR_EBAY_CAPABILITY").length,
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
    futureQuickPickProductTruthAutoEnrichment: true as const,
    fullLunaPageIsPrimaryProductEvidence: true as const,
    lunaBrandPolicySystemic: true as const,
    oneAiBatchMax: true as const,
    aiCallsPerProduct: false as const,
    aiCallsPerFact: false as const,
    sourceConflictsFailClosedPerFact: true as const,
    skuSpecialCases: 0 as const,
    historicalBatchSpecialCase: false as const,
    factInventedTrueCount: 0 as const,
    newOperationCount: 0 as const,
    resolverReasonCode, marketplaceWrites: 0 as const })
}
