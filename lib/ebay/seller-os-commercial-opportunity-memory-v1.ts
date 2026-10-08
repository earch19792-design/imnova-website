import type { SupabaseClient } from "@supabase/supabase-js"

import { CANONICAL_OPPORTUNITY_RESULT_VERSION_V2 } from
  "./ebay-commercial-intelligence-upgrade-v1"
import { goldenDigest, goldenRecord, type GoldenRecord } from
  "./commercial-golden-path-domain-v1"

export const SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1 =
  "SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1" as const
export const SELLER_OS_GOLDEN_EVALUATION_RECEIPT_PROJECTION_V1 =
  "SELLER_OS_GOLDEN_EVALUATION_RECEIPT_PROJECTION_V1" as const

export const SELLER_OS_NEXT_BEST_EVIDENCE_ACTIONS_V1 = [
  "GET_EXACT_SOLD",
  "VERIFY_PRODUCT_FIT",
  "CAPTURE_QTY1_SHIPPING",
  "CAPTURE_BUYER_FULFILLMENT",
  "COMPLETE_FEE",
  "RESOLVE_DUPLICATE",
  "COMPLETE_COMPLIANCE",
  "COMPLETE_ECONOMICS",
  "WAIT_UPSTREAM",
  "PREPARE_LISTING_PACKAGE",
  "OWNER_PUBLISH_MANUALLY",
  "MEASURE_RESULT",
  "REVIEW_REJECTION",
  "RESOLVE_BLOCKER",
  "CAPTURE_DELIVERED_COST",
  "VERIFY_AMAZON_ASIN",
  "GET_EBAY_EXACT_SOLD",
  "GET_AMAZON_DEMAND",
  "COMPLETE_EBAY_ECONOMICS",
  "COMPLETE_AMAZON_ECONOMICS",
  "VERIFY_AMAZON_ELIGIBILITY",
  "REVIEW_AMAZON_COMPETITION",
  "READY_FOR_OWNER_BUY_REVIEW",
  "NONE",
] as const

export type SellerOsNextBestEvidenceActionV1 =
  typeof SELLER_OS_NEXT_BEST_EVIDENCE_ACTIONS_V1[number]

export type SellerOsCommercialMemoryContextV1 = Readonly<{
  supabase: SupabaseClient
  accountKey: string
  principal: Readonly<{ ownerUserId: string }>
  now: Date
}>

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim() &&
      value.trim().length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() : null
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown, maximum = 100) {
  return Array.isArray(value) ? [...new Set(value.flatMap((entry) => {
    const normalized = text(entry, 200)
    return normalized ? [normalized] : []
  }))].slice(0, maximum) : []
}

function freshUntilStatus(value: unknown, now: Date) {
  const authority = goldenRecord(value)
  const freshUntil = text(authority.freshUntil, 48)
  if (!freshUntil || !Number.isFinite(Date.parse(freshUntil))) {
    return "UNPROVEN" as const
  }
  return Date.parse(freshUntil) > now.getTime()
    ? "FRESH" as const : "STALE" as const
}

function upstreamUnavailable(evaluation: GoldenRecord) {
  const market = goldenRecord(evaluation.market)
  const duplicate = goldenRecord(evaluation.duplicateGate)
  const reasons = stringArray(evaluation.reasonCodes)
  return market.status === "UNAVAILABLE" || duplicate.status === "UNAVAILABLE" ||
    reasons.some((reason) => /(?:EBAY|ANALYTICS|UPSTREAM).*(?:UNAVAILABLE|LIMIT|QUOTA|TIMEOUT)/.test(reason))
}

function productTruthProven(value: unknown) {
  const status = String(goldenRecord(value).status ?? "")
  return status === "PROVEN" || status === "CORE_PROVEN" ||
    status === "CORE_PLUS_AUTONOMOUS_ENRICHMENT"
}

function evidenceReference(value: unknown) {
  const authority = goldenRecord(value)
  return Object.freeze({
    status: text(authority.status, 80) ?? "UNPROVEN",
    receiptId: text(authority.receiptId, 200),
    evidenceDigest: text(authority.evidenceDigest, 80),
    observedAt: text(authority.observedAt, 48),
    freshUntil: text(authority.freshUntil, 48),
    reasonCode: text(authority.reasonCode, 200),
  })
}

function projectTaxonomyAuthority(value: unknown) {
  const authority = goldenRecord(value)
  const aspects = Array.isArray(authority.aspects) ? authority.aspects : []
  const requiredAspects = Array.isArray(authority.requiredAspects)
    ? authority.requiredAspects : aspects.filter((entry) =>
      goldenRecord(entry).required === true)
  return Object.freeze({
    status: text(authority.status, 80) ?? "UNPROVEN",
    source: text(authority.source, 160),
    categoryId: text(authority.categoryId, 40),
    categoryName: text(authority.categoryName, 240),
    categoryResolution: text(authority.categoryResolution, 100),
    taxonomyMarketplaceId: text(authority.taxonomyMarketplaceId, 40),
    categoryTreeId: text(authority.categoryTreeId, 40),
    categoryTreeVersion: text(authority.categoryTreeVersion, 100),
    observedAt: text(authority.observedAt, 48),
    freshUntil: text(authority.freshUntil, 48),
    failureCode: text(authority.failureCode, 160),
    aspectCount: aspects.length,
    requiredAspectNames: requiredAspects.flatMap((entry) => {
      const name = text(goldenRecord(entry).name ?? entry, 120)
      return name ? [name] : []
    }).slice(0, 100),
    fullAuthorityDigest: goldenDigest(value),
    evidenceStorage:
      "OFFICIAL_READ_AUTHORITY_DIGEST_PLUS_DECISION_PROJECTION",
  })
}

function projectCategoryReceipt(value: unknown) {
  const receipt = goldenRecord(value)
  return Object.freeze({
    contractVersion: text(receipt.contractVersion, 160),
    categoryId: text(receipt.categoryId ?? receipt.id, 40),
    categoryName: text(receipt.categoryName ?? receipt.name, 240),
    taxonomyTreeId: text(receipt.taxonomyTreeId, 40),
    taxonomyTreeVersion: text(receipt.taxonomyTreeVersion, 100),
    taxonomyObservedAt: text(receipt.taxonomyObservedAt ?? receipt.observedAt, 48),
    taxonomyFreshUntil: text(receipt.taxonomyFreshUntil ?? receipt.freshUntil, 48),
    fullAuthorityDigest: goldenDigest(value),
    evidenceStorage:
      "CATEGORY_AUTHORITY_DIGEST_PLUS_DECISION_PROJECTION",
  })
}

function projectIdentifierPreflight(value: unknown) {
  const preflight = goldenRecord(value)
  return Object.freeze({
    status: text(preflight.status, 80),
    safe: preflight.safe === true,
    reasonCodes: stringArray(preflight.reasonCodes, 50),
    observedAt: text(preflight.observedAt, 48),
    fullAuthorityDigest: goldenDigest(value),
    evidenceStorage:
      "IDENTIFIER_AUTHORITY_DIGEST_PLUS_DECISION_PROJECTION",
  })
}

function boundedEvidenceRows(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.slice(0, maximum) : []
}

/**
 * Produces the immutable, decision-complete receipt body. Large official
 * authority documents are represented by their digest and the exact fields
 * consumed by the decision, instead of being duplicated in every receipt.
 */
export function projectGoldenEvaluationReceiptV1<T extends GoldenRecord>(
  evaluation: T,
) {
  const compliance = goldenRecord(evaluation.compliance)
  const category = goldenRecord(compliance.category)
  const market = goldenRecord(evaluation.market)
  const exactSold = Array.isArray(market.exactSold) ? market.exactSold : []
  const closeSold = Array.isArray(market.closeSold) ? market.closeSold : []
  const familyEvidence = Array.isArray(market.familyEvidence)
    ? market.familyEvidence : []
  const rejectedComparables = Array.isArray(market.rejectedComparables)
    ? market.rejectedComparables : []
  const activeCompetition = Array.isArray(market.activeCompetition)
    ? market.activeCompetition : []
  const sourceEvidenceDigest = text(evaluation.evidenceDigest, 80) ??
    goldenDigest(evaluation)
  return Object.freeze({
    ...evaluation,
    compliance: Object.freeze({
      ...compliance,
      category: compliance.category == null ? null : Object.freeze({
        ...category,
        receipt: category.receipt == null
          ? null : projectCategoryReceipt(category.receipt),
      }),
      taxonomy: compliance.taxonomy == null
        ? null : projectTaxonomyAuthority(compliance.taxonomy),
      identifierPreflight: compliance.identifierPreflight == null
        ? null : projectIdentifierPreflight(compliance.identifierPreflight),
    }),
    market: Object.freeze({
      ...market,
      exactSold: boundedEvidenceRows(exactSold, 25),
      closeSold: boundedEvidenceRows(closeSold, 25),
      familyEvidence: boundedEvidenceRows(familyEvidence, 10),
      rejectedComparables: boundedEvidenceRows(rejectedComparables, 25),
      activeCompetition: boundedEvidenceRows(activeCompetition, 25),
      durableEvidenceCounts: Object.freeze({
        exactSold: exactSold.length,
        closeSold: closeSold.length,
        familyEvidence: familyEvidence.length,
        rejectedComparables: rejectedComparables.length,
        activeCompetition: activeCompetition.length,
      }),
      durableSamplesMayBeTruncated: true,
    }),
    receiptProjection: Object.freeze({
      contractVersion: SELLER_OS_GOLDEN_EVALUATION_RECEIPT_PROJECTION_V1,
      sourceEvaluationEvidenceDigest: sourceEvidenceDigest,
      decisionFieldsPreserved: true,
      fullAuthorityDocumentsEmbedded: false,
      maximumMarketEvidenceSamples: 110,
    }),
  })
}

export function resolveSellerOsNextBestEvidenceV1(
  evaluation: GoldenRecord,
  now = new Date(),
) {
  const market = goldenRecord(evaluation.market)
  const productTruth = goldenRecord(evaluation.productTruth)
  const shipping = goldenRecord(evaluation.shipping)
  const fulfillment = goldenRecord(evaluation.fulfillment)
  const economics = goldenRecord(evaluation.economics)
  const fee = goldenRecord(economics.feeAuthority)
  const duplicate = goldenRecord(evaluation.duplicateGate)
  const compliance = goldenRecord(evaluation.compliance)
  const lifecycle = text(goldenRecord(evaluation.commercialMemory).lifecycleStage,
    80)

  let action: SellerOsNextBestEvidenceActionV1 = "NONE"
  let reasonCode = "NO_ADDITIONAL_EVIDENCE_REQUIRED"
  let authority = "TERMINAL_STATE"
  if (lifecycle === "RESULT") {
    action = "NONE"; reasonCode = "RESULT_EVIDENCE_CAPTURED"
    authority = "COMMERCIAL_RESULT_MEMORY"
  } else if (lifecycle === "PUBLISHED") {
    action = "MEASURE_RESULT"; reasonCode = "POST_PUBLICATION_RESULT_REQUIRED"
    authority = "EBAY_ORDERS_AND_ANALYTICS"
  } else if (lifecycle === "LISTING_READY") {
    action = "OWNER_PUBLISH_MANUALLY"; reasonCode = "OWNER_PUBLICATION_REQUIRED"
    authority = "OWNER_MANUAL_PUBLICATION"
  } else if (!(finite(market.soldQuantity)! > 0)) {
    action = upstreamUnavailable(evaluation) ? "WAIT_UPSTREAM" : "GET_EXACT_SOLD"
    reasonCode = action === "WAIT_UPSTREAM"
      ? "EBAY_UPSTREAM_UNAVAILABLE_NO_FALSE_ZERO"
      : "EXACT_SOLD_EVIDENCE_REQUIRED"
    authority = "EBAY_SOLD_READONLY"
  } else if (!productTruthProven(productTruth)) {
    action = "VERIFY_PRODUCT_FIT"; reasonCode = "PRODUCT_FIT_UNPROVEN"
    authority = "LUNA_PRODUCT_TRUTH"
  } else if (shipping.status !== "PROVEN" ||
      freshUntilStatus(shipping, now) === "STALE") {
    action = "CAPTURE_QTY1_SHIPPING"; reasonCode = "QTY1_SHIPPING_REQUIRED"
    authority = "LUNA_SHIPPING_CAPTURE"
  } else if (!["PROVEN", "PROVISIONAL_OWNER_POLICY"].includes(
    String(fee.status ?? "")) || freshUntilStatus(fee, now) === "STALE") {
    action = "COMPLETE_FEE"; reasonCode = "FEE_AUTHORITY_REQUIRED"
    authority = "EBAY_FEE_AUTHORITY"
  } else if (fulfillment.status !== "PROVEN" ||
      freshUntilStatus(fulfillment, now) === "STALE") {
    action = "CAPTURE_BUYER_FULFILLMENT"
    reasonCode = "BUYER_FULFILLMENT_AUTHORITY_REQUIRED"
    authority = "BUYER_FULFILLMENT_SHIPPING"
  } else if (!["PASS", "FAIL", "DUPLICATE"].includes(
    String(duplicate.status ?? ""))) {
    action = upstreamUnavailable(evaluation) ? "WAIT_UPSTREAM" :
      "RESOLVE_DUPLICATE"
    reasonCode = action === "WAIT_UPSTREAM"
      ? "EBAY_UPSTREAM_UNAVAILABLE_NO_FALSE_ZERO" : "DUPLICATE_GATE_REQUIRED"
    authority = "EBAY_ACTIVE_LISTINGS_READONLY"
  } else if (compliance.status !== "PROVEN" ||
      freshUntilStatus(compliance, now) === "STALE") {
    action = "COMPLETE_COMPLIANCE"
    reasonCode = "CATEGORY_SPECIFICS_OR_IDENTIFIER_AUTHORITY_REQUIRED"
    authority = "PRODUCT_TRUTH_AND_EBAY_TAXONOMY"
  } else if (!["PROVEN", "PROVISIONAL_OWNER_POLICY"].includes(
    String(economics.status ?? "")) ||
      finite(economics.expectedNetProfit) === null) {
    action = "COMPLETE_ECONOMICS"; reasonCode = "ECONOMICS_REQUIRED"
    authority = "GOLDEN_PATH_ECONOMICS"
  } else if (evaluation.decision === "GO") {
    action = "PREPARE_LISTING_PACKAGE"; reasonCode = "GO_DECISION_DRAFT_REQUIRED"
    authority = "GOLDEN_PATH_DRAFT_ONLY"
  } else if (evaluation.decision === "REJECT") {
    action = "REVIEW_REJECTION"; reasonCode = "REJECT_DECISION_TERMINAL_REVIEW"
    authority = "GOLDEN_PATH_DECISION"
  } else {
    action = "RESOLVE_BLOCKER"; reasonCode = "DECISION_BLOCKER_REMAINS"
    authority = "GOLDEN_PATH_REASON_CODES"
  }
  return Object.freeze({ action, priority: 1 as const, reasonCode, authority,
    observedAt: now.toISOString(), inventedEvidence: false as const })
}

function commercialLifecycle(evaluation: GoldenRecord, now: Date) {
  const market = goldenRecord(evaluation.market)
  const productTruth = goldenRecord(evaluation.productTruth)
  const shipping = goldenRecord(evaluation.shipping)
  const economics = goldenRecord(evaluation.economics)
  const duplicate = goldenRecord(evaluation.duplicateGate)
  const completed = ["DISCOVERED"]
  const hasSold = finite(market.soldQuantity) !== null &&
    finite(market.soldQuantity)! > 0
  const hasSupportingDemand = hasSold || ["exactSold", "closeSold",
    "familyEvidence"].some((key) => Array.isArray(market[key]) &&
      (market[key] as unknown[]).length > 0)
  if (hasSold) completed.push("DEMAND_PROVEN")
  else if (hasSupportingDemand) completed.push("DEMAND_SUPPORTED")
  const productFit = productTruthProven(productTruth)
  if (productFit) completed.push("PRODUCT_FIT")
  const shippingProven = shipping.status === "PROVEN" &&
    freshUntilStatus(shipping, now) !== "STALE"
  if (productFit && shippingProven) completed.push("SHIPPING")
  const economicsProven = ["PROVEN", "PROVISIONAL_OWNER_POLICY"].includes(
    String(economics.status ?? "")) &&
    finite(economics.expectedNetProfit) !== null
  if (shippingProven && economicsProven) completed.push("ECONOMICS")
  const duplicateResolved = ["PASS", "FAIL", "DUPLICATE"].includes(
    String(duplicate.status ?? ""))
  if (economicsProven && duplicateResolved) completed.push("DUPLICATE_GATE")
  if (duplicateResolved && ["GO", "HOLD", "REJECT"].includes(
    String(evaluation.decision ?? ""))) completed.push(String(evaluation.decision))
  const requestedStage = text(
    goldenRecord(evaluation.commercialMemory).lifecycleStage, 80)
  if (requestedStage === "LISTING_READY" && evaluation.decision === "GO") {
    completed.push("LISTING_READY")
  } else if (requestedStage === "PUBLISHED" && evaluation.decision === "GO") {
    completed.push("LISTING_READY", "PUBLISHED")
  } else if (requestedStage === "RESULT" && evaluation.decision === "GO") {
    completed.push("LISTING_READY", "PUBLISHED", "RESULT")
  }
  return Object.freeze({ current: completed.at(-1) ?? "DISCOVERED",
    completed: Object.freeze([...new Set(completed)]) })
}

export function buildSellerOsCommercialOpportunityMemoryV1(
  evaluation: GoldenRecord,
  now = new Date(),
) {
  const candidate = goldenRecord(evaluation.candidate)
  const source = goldenRecord(evaluation.sourceIdentity)
  const market = goldenRecord(evaluation.market)
  const economics = goldenRecord(evaluation.economics)
  const compliance = goldenRecord(evaluation.compliance)
  const receipt = goldenRecord(evaluation.durableReceipt)
  const lifecycleArtifact = goldenRecord(evaluation.commercialMemory)
  const lifecycle = commercialLifecycle(evaluation, now)
  const authorities = [evaluation.shipping, evaluation.fulfillment,
    economics.feeAuthority, evaluation.duplicateGate, evaluation.compliance]
  const freshnessStates = authorities.map((value) =>
    freshUntilStatus(value, now))
  const evidenceFreshness = freshnessStates.includes("STALE") ? "STALE" :
    freshnessStates.includes("FRESH") ? "FRESH" : "UNPROVEN"
  const demandStatus = upstreamUnavailable(evaluation) &&
      finite(market.soldQuantity) === null
    ? "UNAVAILABLE" : lifecycle.completed.includes("DEMAND_PROVEN")
      ? "PROVEN" : lifecycle.completed.includes("DEMAND_SUPPORTED")
        ? "SUPPORTED" : "UNPROVEN"
  const nextBestEvidence = resolveSellerOsNextBestEvidenceV1(evaluation, now)
  const blockers = [...new Set([
    ...stringArray(evaluation.reasonCodes),
    ...stringArray(compliance.blockers),
  ])].slice(0, 100)
  const memoryWithoutDigest = {
    contractVersion: SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1,
    canonicalResultVersion: CANONICAL_OPPORTUNITY_RESULT_VERSION_V2,
    candidate: {
      sourceKey: text(candidate.sourceKey, 80) ?? "luna-portex",
      productId: text(candidate.productId, 100),
      variantId: text(candidate.variantId, 100),
      supplierSku: text(candidate.supplierSku, 160),
      supplierQuantity: finite(candidate.supplierQuantity),
      title: text(source.title, 500) ?? text(candidate.supplierSku, 160),
    },
    lifecycleStage: lifecycle.current,
    completedStages: lifecycle.completed,
    decision: ["GO", "HOLD", "REJECT"].includes(
      String(evaluation.decision ?? "")) ? evaluation.decision : "UNPROVEN",
    demand: {
      status: demandStatus,
      soldQuantity: demandStatus === "UNAVAILABLE"
        ? null : finite(market.soldQuantity),
      realizedBuyerLandedPrice: demandStatus === "UNAVAILABLE"
        ? null : finite(market.realizedBuyerLandedPrice),
      authority: evidenceReference(evaluation.market),
    },
    productFit: evidenceReference(evaluation.productTruth),
    shipping: evidenceReference(evaluation.shipping),
    economics: {
      ...evidenceReference(evaluation.economics),
      expectedNetProfit: finite(economics.expectedNetProfit),
      targetNetProfit: null,
      economicPolicyEvaluation: economics.economicPolicyEvaluation ?? null,
      feeAuthority: evidenceReference(economics.feeAuthority),
    },
    duplicateGate: evidenceReference(evaluation.duplicateGate),
    compliance: evidenceReference(evaluation.compliance),
    evidenceFreshness,
    blockers,
    nextBestEvidence,
    decisionProvenance: {
      evaluationReceiptId: text(receipt.receiptId, 100),
      evaluationEvidenceDigest: text(receipt.evidenceDigest, 80),
      sourceEvaluationEvidenceDigest: text(evaluation.evidenceDigest, 80),
      minimumNetProfitUsd: null,
      economicPolicyEvaluation: economics.economicPolicyEvaluation ?? null,
      failClosed: true,
      lifecycleArtifactReceiptId: text(
        lifecycleArtifact.lifecycleArtifactReceiptId, 100),
      lifecycleArtifactKind: text(lifecycleArtifact.lifecycleArtifactKind, 40),
    },
    marketOpportunityCase: {
      opportunityCaseId: null,
      familyId: null,
      linkageStatus: "UNPROVEN_NOT_INVENTED",
    },
    experimentRegistry: (() => {
      const experiment = goldenRecord(lifecycleArtifact.experimentRegistry)
      return {
        status: text(experiment.status, 80) ?? "UNPROVEN",
        experimentId: text(experiment.experimentId, 160),
        lifecycleStatus: text(experiment.lifecycleStatus, 80),
        updatedAt: text(experiment.updatedAt, 48),
        authority: "EBAY_LISTING_EXPERIMENTS_V1",
      }
    })(),
    observedAt: now.toISOString(),
    safety: { marketplaceWrites: 0, publications: 0, repricing: 0,
      ebayMutationAllowed: false },
  }
  return Object.freeze({ ...memoryWithoutDigest,
    memoryDigest: goldenDigest(memoryWithoutDigest) })
}

export class SellerOsCommercialMemoryPersistenceErrorV1 extends Error {
  readonly phase: "WRITE" | "READBACK"
  constructor(phase: "WRITE" | "READBACK") {
    super(`SELLER_OS_COMMERCIAL_MEMORY_${phase}_FAILED`)
    this.phase = phase
  }
}

export async function persistSellerOsCommercialOpportunityMemoryV1(
  ctx: SellerOsCommercialMemoryContextV1,
  evaluation: GoldenRecord,
) {
  const memory = buildSellerOsCommercialOpportunityMemoryV1(evaluation, ctx.now)
  return persistSellerOsCommercialMemoryDocumentV1(ctx, memory)
}

export async function persistSellerOsCommercialMemoryDocumentV1(
  ctx: SellerOsCommercialMemoryContextV1,
  memory: ReturnType<typeof buildSellerOsCommercialOpportunityMemoryV1> |
    GoldenRecord,
) {
  const write = await ctx.supabase.rpc(
    "put_seller_os_commercial_opportunity_memory_v1",
    { p_account_key: ctx.accountKey,
      p_owner_user_id: ctx.principal.ownerUserId,
      p_memory: memory,
      p_idempotency_key: `commercial-memory:${memory.memoryDigest}` },
  )
  if (write.error) throw new SellerOsCommercialMemoryPersistenceErrorV1("WRITE")
  const candidate = goldenRecord(memory.candidate)
  const sourceKey = text(candidate.sourceKey, 80) ?? "luna-portex"
  const candidateKey = `${sourceKey}:${candidate.productId}:${candidate.variantId}`
  const read = await ctx.supabase.from("ebay_luna_opportunity_queue")
    .select("id,commercial_memory_digest,commercial_evaluation_receipt_id,commercial_memory,commercial_updated_at")
    .eq("commercial_account_key", ctx.accountKey)
    .eq("candidate_key", candidateKey).limit(1).maybeSingle()
  const stored = goldenRecord(read.data?.commercial_memory)
  if (read.error || !read.data ||
      read.data.commercial_memory_digest !== memory.memoryDigest ||
      stored.memoryDigest !== memory.memoryDigest ||
      read.data.commercial_evaluation_receipt_id !==
        goldenRecord(memory.decisionProvenance).evaluationReceiptId) {
    throw new SellerOsCommercialMemoryPersistenceErrorV1("READBACK")
  }
  return Object.freeze({ ...memory, persistence: Object.freeze({
    opportunityId: read.data.id,
    evaluationReceiptId: read.data.commercial_evaluation_receipt_id,
    updatedAt: read.data.commercial_updated_at,
    readback: "PASS" as const,
    replay: goldenRecord(write.data).replay === true,
    ledger: "EBAY_LUNA_OPPORTUNITY_QUEUE_AND_EVENTS",
  }) })
}
