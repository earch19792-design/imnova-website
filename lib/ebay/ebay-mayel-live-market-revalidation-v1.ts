import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCommercialMonitorDashboard } from
  "./ebay-commercial-monitor-service"
import {
  buildMayelCommercialIntelligenceV1,
  type MayelMarketEvidenceRowV1,
} from "./ebay-mayel-commercial-intelligence-v1"
import { importOfficialSoldEvidence } from "./ebay-official-sold-evidence-import"
import {
  importProductResearchBrowserCapture,
  targetFromCatalogRow,
  type ProductResearchBrowserCapture,
} from "./ebay-product-research-browser-capture"
import {
  assertProductResearchCaptureMatchesNextQuery,
  buildProductResearchQueryPlan,
  getProductResearchQueryPlanStatus,
  markProductResearchQueryCaptured,
  PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
} from "./ebay-product-research-query-plan"
import { currentLiveListingsForMonitorV1 } from
  "./ebay-seller-os-live-portfolio-integrity-v1"
import { loadSellerOsAssistantMonitorV1 } from
  "./ebay-seller-os-assistant-runtime"

export const MAYEL_LIVE_MARKET_REVALIDATION_VERSION =
  "MAYEL_LIVE_MARKET_REVALIDATION_V1_2026_09_06"
export const MAYEL_LIVE_MARKET_REVALIDATION_RECOVERY_POLICY =
  "MAYEL_LIVE_MARKET_REVALIDATION_POLICY_V1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

function validItemId(value: unknown) {
  const normalized = text(value, 20)
  return /^\d{9,20}$/.test(normalized) ? normalized : null
}

function validPlanId(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : null
}

function validIdempotencyKey(value: unknown) {
  const normalized = text(value, 120)
  return /^[A-Za-z0-9._:-]{8,120}$/.test(normalized) ? normalized : null
}

async function readExactLiveContext(input: {
  supabase: SupabaseClient
  accountKey: string
  itemId?: string | null
  planId?: string | null
}) {
  let listingQuery = input.supabase.from("ebay_active_listings")
    .select("id,ebay_item_id,ebay_sku,title,listing_status,account_key,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_radar_review_at,raw_payload")
    .eq("account_key", input.accountKey).eq("listing_status", "active")
  if (input.planId) {
    const { data: plan, error: planError } = await input.supabase.from(
      "marketplace_product_research_query_plans")
      .select("id,source_context,subject_listing_id,subject_item_id,subject_supplier_variant_id,request_receipt_id,status")
      .eq("id", input.planId).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").limit(1).maybeSingle()
    if (planError || !plan || plan.source_context !==
        "LIVE_LISTING_REVALIDATION") {
      throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_SCOPE_INVALID")
    }
    listingQuery = listingQuery.eq("id", plan.subject_listing_id)
      .eq("ebay_item_id", plan.subject_item_id)
      .eq("supplier_variant_id", plan.subject_supplier_variant_id)
    const { data: listing, error } = await listingQuery.limit(1).maybeSingle()
    if (error || !listing) {
      throw new Error("MAYEL_MARKET_REVALIDATION_LIVE_IDENTITY_STALE")
    }
    return readVariant({ ...input, listing, plan })
  }
  if (!input.itemId) throw new Error("MAYEL_MARKET_REVALIDATION_ITEM_REQUIRED")
  const { data: listing, error } = await listingQuery.eq(
    "ebay_item_id", input.itemId).limit(1).maybeSingle()
  if (error || !listing) {
    throw new Error("MAYEL_MARKET_REVALIDATION_LIVE_LISTING_REQUIRED")
  }
  return readVariant({ ...input, listing, plan: null })
}

async function readVariant(input: {
  supabase: SupabaseClient
  accountKey: string
  listing: JsonRecord
  plan: JsonRecord | null
}) {
  const productId = text(input.listing.market_radar_product_id, 80)
  const supplierVariantId = text(input.listing.supplier_variant_id, 160)
  if (!productId || !supplierVariantId || !text(input.listing.supplier_sku, 100)) {
    throw new Error("MAYEL_MARKET_REVALIDATION_PRODUCT_IDENTITY_REQUIRED")
  }
  const { data: variant, error } = await input.supabase.from(
    "market_radar_latest_variants").select("*")
    .eq("source_key", "lunaportex").eq("product_id", productId)
    .eq("supplier_variant_id", supplierVariantId).limit(1).maybeSingle()
  if (error || !variant) {
    throw new Error("MAYEL_MARKET_REVALIDATION_EXACT_VARIANT_REQUIRED")
  }
  const target = targetFromCatalogRow(record(variant))
  if (!target || target.supplierVariantId !== supplierVariantId) {
    throw new Error("MAYEL_MARKET_REVALIDATION_EXACT_VARIANT_REQUIRED")
  }
  return Object.freeze({ listing: input.listing, variant: record(variant),
    target, plan: input.plan })
}

async function latestResearchAt(input: {
  supabase: SupabaseClient
  accountKey: string
  supplierVariantId: string
}) {
  const { data, error } = await input.supabase.from(
    "marketplace_product_research_capture_observations").select("created_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("matched_supplier_variant_id", input.supplierVariantId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("MAYEL_MARKET_REVALIDATION_EVIDENCE_READ_FAILED")
  return data?.created_at ?? null
}

async function requestReceipt(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  idempotencyKey: string
  context: Awaited<ReturnType<typeof readExactLiveContext>>
}) {
  const itemId = String(input.context.listing.ebay_item_id)
  const latest = await latestResearchAt({ supabase: input.supabase,
    accountKey: input.accountKey,
    supplierVariantId: input.context.target.supplierVariantId })
  const fingerprint = sha256({ itemId,
    supplierVariantId: input.context.target.supplierVariantId,
    supplierSnapshot: input.context.variant.captured_at ?? null,
    latestResearchAt: latest })
  const now = new Date().toISOString()
  const payload = {
    marketplace_account_key: input.accountKey,
    failure_class: "MARKET_EVIDENCE_REVALIDATION_REQUIRED",
    invariant_code: "LIVE_LISTING_RESEARCH_REQUIRED",
    mechanism_version: MAYEL_LIVE_MARKET_REVALIDATION_VERSION,
    evidence_fingerprint: fingerprint,
    recovery_policy_version: MAYEL_LIVE_MARKET_REVALIDATION_RECOVERY_POLICY,
    retry_safety: "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    recovery_class: "AUTO_RECOVERABLE",
    recovery_outcome: "OBSERVED",
    regression_guard: { sellerOsChoosesQueries: true,
      sellerOsChoosesPages: true, sellerOsAppliesSoldFilter: true,
      marketplaceWrites: 0 },
    evidence: { requestState: "RESEARCH_REQUIRED", itemId,
      listingId: input.context.listing.id,
      supplierProductId: input.context.variant.supplier_product_id,
      supplierVariantId: input.context.target.supplierVariantId,
      supplierSku: input.context.listing.supplier_sku,
      exactVariant: input.context.variant.variant_title ?? null,
      requestedBy: input.actorId, requestedAt: now,
      latestResearchAt: latest, marketplaceWrites: 0 },
    status: "OPEN", first_observed_at: now, last_observed_at: now,
    resolved_at: null,
  }
  const inserted = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").insert(payload)
    .select("id,evidence_fingerprint,status,evidence").single()
  if (!inserted.error && inserted.data) return inserted.data
  if (record(inserted.error).code !== "23505") {
    throw new Error("MAYEL_MARKET_REVALIDATION_REQUEST_PERSIST_FAILED")
  }
  const existing = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,evidence_fingerprint,status,evidence")
    .eq("marketplace_account_key", input.accountKey)
    .eq("invariant_code", "LIVE_LISTING_RESEARCH_REQUIRED")
    .eq("mechanism_version", MAYEL_LIVE_MARKET_REVALIDATION_VERSION)
    .eq("evidence_fingerprint", fingerprint).limit(1).maybeSingle()
  if (existing.error || !existing.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_REQUEST_READBACK_FAILED")
  }
  return existing.data
}

export async function startMayelLiveMarketRevalidationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  itemId: unknown
  idempotencyKey: unknown
}) {
  const itemId = validItemId(input.itemId)
  const idempotencyKey = validIdempotencyKey(input.idempotencyKey)
  if (!itemId || !idempotencyKey) {
    throw new Error("MAYEL_MARKET_REVALIDATION_REQUEST_INVALID")
  }
  const context = await readExactLiveContext({ ...input, itemId })
  const receipt = await requestReceipt({ ...input, idempotencyKey, context })
  const candidate = {
    supplierVariantId: context.target.supplierVariantId,
    productName: context.target.productName,
    brand: context.target.identity.manufacturerBrand,
    categoryId: text(record(context.listing.raw_payload).categoryId, 30) || null,
    priorityScore: 100,
  }
  const built = buildProductResearchQueryPlan([candidate])
  if (built.queries.length !== 1 || built.candidateCount !== 1) {
    throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_UNAVAILABLE")
  }
  const planId = randomUUID()
  const planInputHash = sha256({ connector:
    MAYEL_LIVE_MARKET_REVALIDATION_VERSION,
    requestReceiptId: receipt.id, inputHash: built.inputHash })
  const created = await input.supabase.rpc(
    "create_live_listing_product_research_plan_v1", {
      p_plan_id: planId,
      p_marketplace_account_key: input.accountKey,
      p_plan_version: PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
      p_input_hash: planInputHash,
      p_listing_id: context.listing.id,
      p_item_id: itemId,
      p_supplier_variant_id: context.target.supplierVariantId,
      p_request_receipt_id: receipt.id,
      p_queries: built.queries.map((query) => ({
        ordinal: query.ordinal, search_query: query.searchQuery,
        query_hash: query.queryHash, cluster_key_hash: query.clusterKeyHash,
        category_id: query.categoryId, candidate_count: query.candidateCount,
        candidate_variant_hashes: query.candidateVariantHashes,
      })),
    })
  if (created.error || !created.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_PERSIST_FAILED")
  }
  const plan = await getProductResearchQueryPlanStatus({
    supabase: input.supabase, accountKey: input.accountKey,
    planId: String(created.data),
  })
  if (!plan || plan.sourceContext !== "LIVE_LISTING_REVALIDATION" ||
      plan.subjectItemId !== itemId || plan.pendingCount !== 1) {
    throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_READBACK_FAILED")
  }
  return Object.freeze({ requestPersisted: true as const,
    nextResearchPlanCreated: true as const, itemId,
    productIdentity: Object.freeze({
      ebaySku: context.listing.ebay_sku,
      supplierProductId: context.variant.supplier_product_id,
      supplierVariantId: context.target.supplierVariantId,
      supplierSku: context.listing.supplier_sku,
      exactVariant: context.variant.variant_title ?? null,
    }),
    requestReceiptId: receipt.id, plan,
    continuationUrl: `/admin/ebay/opportunity-queue/research?mayelMarketRevalidation=${plan.id}`,
    ownerActionRequired: false as const,
    mayelManualResearchRequired: false as const,
    marketplaceWrites: 0 as const })
}

async function readMarketEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  supplierVariantId: string
}) {
  const { data, error } = await input.supabase.from(
    "marketplace_product_research_capture_observations")
    .select("id,source_listing_id,matched_supplier_variant_id,match_classification,match_reasons,normalized_identity,average_sold_price,average_shipping,confirmed_sold_quantity,last_sold_date,created_at,evidence_reviewed,quality_status")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("matched_supplier_variant_id", input.supplierVariantId)
    .order("created_at", { ascending: false }).limit(500)
  if (error) throw new Error("MAYEL_MARKET_REVALIDATION_EVIDENCE_READ_FAILED")
  return (data ?? []) as MayelMarketEvidenceRowV1[]
}

export async function readMayelLiveMarketRevalidationPlanV1(input: {
  supabase: SupabaseClient
  accountKey: string
  planId: unknown
}) {
  const planId = validPlanId(input.planId)
  if (!planId) throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_REQUIRED")
  const context = await readExactLiveContext({ ...input, planId })
  const plan = await getProductResearchQueryPlanStatus({ ...input, planId })
  if (!plan || plan.sourceContext !== "LIVE_LISTING_REVALIDATION" ||
      plan.subjectItemId !== context.listing.ebay_item_id) {
    throw new Error("MAYEL_MARKET_REVALIDATION_PLAN_SCOPE_INVALID")
  }
  return Object.freeze({ plan, itemId: context.listing.ebay_item_id,
    marketplaceWrites: 0 as const })
}

export async function readMayelLiveMarketRevalidationStatusV1(input: {
  supabase: SupabaseClient
  accountKey: string
  itemId: unknown
}) {
  const itemId = validItemId(input.itemId)
  if (!itemId) throw new Error("MAYEL_MARKET_REVALIDATION_ITEM_REQUIRED")
  const context = await readExactLiveContext({ ...input, itemId })
  const planRead = await input.supabase.from(
    "marketplace_product_research_query_plans")
    .select("id,status,request_receipt_id,created_at,completed_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("source_context", "LIVE_LISTING_REVALIDATION")
    .eq("subject_listing_id", context.listing.id).eq("subject_item_id", itemId)
    .eq("subject_supplier_variant_id", context.target.supplierVariantId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (planRead.error) {
    throw new Error("MAYEL_MARKET_REVALIDATION_STATUS_READ_FAILED")
  }
  if (!planRead.data) return Object.freeze({ connectorAvailable: true as const,
    state: "READY_TO_REQUEST" as const, itemId, planId: null,
    requestPersisted: false, nextResearchPlanCreated: false,
    result: null, ownerActionRequired: false as const,
    mayelManualResearchRequired: false as const,
    marketplaceWrites: 0 as const })
  const receiptRead = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,status,recovery_outcome,evidence,last_observed_at,resolved_at")
    .eq("id", planRead.data.request_receipt_id)
    .eq("marketplace_account_key", input.accountKey).limit(1).maybeSingle()
  if (receiptRead.error || !receiptRead.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_REQUEST_READBACK_FAILED")
  }
  const result = record(receiptRead.data.evidence)
  const completed = receiptRead.data.status === "RESOLVED" &&
    result.requestState === "COMPLETED"
  return Object.freeze({ connectorAvailable: true as const,
    state: completed ? "COMPLETED" as const :
      planRead.data.status === "ACTIVE" ? "IN_PROGRESS" as const
        : "PENDING_RESUME" as const,
    itemId, planId: planRead.data.id,
    requestPersisted: true, nextResearchPlanCreated: true,
    result: completed ? result : null,
    lastObservedAt: receiptRead.data.last_observed_at,
    ownerActionRequired: false as const,
    mayelManualResearchRequired: false as const,
    marketplaceWrites: 0 as const })
}

export async function completeMayelLiveMarketRevalidationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  planId: unknown
  capture: ProductResearchBrowserCapture
  soldRows: unknown
  soldFilterAutomated: unknown
  paginationAutomated: unknown
  extensionMarketplaceWrites: unknown
}) {
  const planId = validPlanId(input.planId)
  if (!planId || input.soldFilterAutomated !== true ||
      input.paginationAutomated !== true || input.extensionMarketplaceWrites !== 0 ||
      !Array.isArray(input.soldRows) || input.soldRows.length > 200) {
    throw new Error("MAYEL_MARKET_REVALIDATION_WORKER_RESULT_INVALID")
  }
  const context = await readExactLiveContext({ ...input, planId })
  const receiptId = text(context.plan?.request_receipt_id, 40)
  const priorReceipt = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,status,evidence,resolved_at")
    .eq("id", receiptId).eq("marketplace_account_key", input.accountKey)
    .limit(1).maybeSingle()
  if (priorReceipt.error || !priorReceipt.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_REQUEST_READBACK_FAILED")
  }
  const priorEvidence = record(priorReceipt.data.evidence)
  if (priorReceipt.data.status === "RESOLVED" &&
      priorEvidence.requestState === "COMPLETED") {
    return Object.freeze({ ...priorEvidence,
      receiptId: priorReceipt.data.id, mayelResultVisible: true as const })
  }
  const planned = await assertProductResearchCaptureMatchesNextQuery({
    supabase: input.supabase, accountKey: input.accountKey,
    searchQuery: input.capture?.searchQuery, planId,
  })
  if (!planned || planned.planId !== planId) {
    throw new Error("MAYEL_MARKET_REVALIDATION_TASK_BINDING_INVALID")
  }
  const research = await importProductResearchBrowserCapture({
    supabase: input.supabase, accountKey: input.accountKey,
    actorId: input.actorId, capture: input.capture,
    exactTargets: [context.target],
    visualContext: { categoryId: planned.categoryId },
  })
  let sold: Awaited<ReturnType<typeof importOfficialSoldEvidence>> | null = null
  if (input.soldRows.length > 0) {
    sold = await importOfficialSoldEvidence({
      supabase: input.supabase, accountKey: input.accountKey,
      actorId: input.actorId, format: "JSON",
      sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE",
      content: JSON.stringify({ rows: input.soldRows }),
      operatorAttested: true,
    })
  }
  if (!planned.alreadyProcessed) {
    await markProductResearchQueryCaptured({
      supabase: input.supabase, accountKey: input.accountKey,
      planId, taskId: planned.taskId,
      searchQueryHash: research.searchQueryHash,
      captureBatchId: research.batchId,
      capturedAt: new Date(research.capturedAt),
    })
  }
  const evidence = await readMarketEvidence({ supabase: input.supabase,
    accountKey: input.accountKey,
    supplierVariantId: context.target.supplierVariantId })
  const [monitor, commercialDashboard] = await Promise.all([
    loadSellerOsAssistantMonitorV1(),
    getEbayCommercialMonitorDashboard(input.supabase),
  ])
  const live = currentLiveListingsForMonitorV1(monitor).find((entry) =>
    entry.identity.itemId === context.listing.ebay_item_id)
  if (!live) throw new Error("MAYEL_MARKET_REVALIDATION_LIVE_READBACK_REQUIRED")
  const decision = monitor.backend.decisions.find((entry) =>
    entry.listingKey === live.key)
  const intelligence = buildMayelCommercialIntelligenceV1({
    listing: live, commercialDashboard, marketEvidence: evidence,
    marketEvidenceReadStatus: "AVAILABLE",
    qualityRecommendations: monitor.backend.listingQualityReport.recommendations,
    decisionReasonCodes: decision?.reasonCodes ?? [],
  })
  const completedAt = new Date().toISOString()
  const radar = await input.supabase.from("ebay_active_listings")
    .update({ last_radar_review_at: completedAt })
    .eq("id", context.listing.id).eq("account_key", input.accountKey)
    .eq("ebay_item_id", context.listing.ebay_item_id)
    .eq("supplier_variant_id", context.target.supplierVariantId)
    .select("id,last_radar_review_at").single()
  if (radar.error || radar.data?.last_radar_review_at !== completedAt) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RADAR_REINGEST_FAILED")
  }
  const freshSoldEvidencePersisted = research.validCount > 0 ||
    Number(sold?.validCount ?? 0) > 0
  const outcome = {
    requestState: "COMPLETED",
    itemId: context.listing.ebay_item_id,
    listingId: context.listing.id,
    supplierVariantId: context.target.supplierVariantId,
    planId,
    captureBatchId: research.batchId,
    soldImportBatchId: sold?.batchId ?? null,
    productResearchExecuted: true,
    freshSoldEvidencePersisted,
    exactComparableCount: intelligence.market.acceptedComparableCount,
    rejectedComparableCount: intelligence.market.rejectedComparableCount,
    radarReingest: true,
    radarReingestedAt: completedAt,
    marketPriceRecalculated: true,
    marketPriceAuthority: intelligence.pricePosition.marketPriceAuthority,
    soldPriceRange: {
      minimum: intelligence.market.soldPriceMinimum,
      median: intelligence.market.soldPriceMedian,
      maximum: intelligence.market.soldPriceMaximum,
    },
    defensibleMarketPrice: intelligence.pricePosition.defensibleSellerOsPrice,
    livePricePosition: intelligence.pricePosition.status,
    economicsRecalculated: true,
    economics: {
      supplierCost: intelligence.economics.supplierCost.value,
      shipping: intelligence.economics.shippingCost.value,
      ebayFees: intelligence.economics.ebayFees.value,
      otherCosts: intelligence.economics.otherCostsOrReserves.value,
      expectedProfit: intelligence.economics.expectedProfit.value,
      margin: intelligence.economics.marginPercent.value,
    },
    ownerActionRequired: false,
    mayelManualResearchRequired: false,
    marketplaceWrites: 0,
    completedAt,
  }
  const receipt = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").update({
      recovery_outcome: "RECOVERED", status: "RESOLVED",
      evidence: outcome, last_observed_at: completedAt,
      resolved_at: completedAt, lease_owner: null, lease_expires_at: null,
      updated_at: completedAt,
    }).eq("id", receiptId).eq("marketplace_account_key", input.accountKey)
    .eq("status", "OPEN").select("id,evidence,status,resolved_at").maybeSingle()
  if (receipt.error || !receipt.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RECEIPT_FINALIZE_FAILED")
  }
  return Object.freeze({ ...outcome, receiptId: receipt.data.id,
    mayelResultVisible: true as const })
}
