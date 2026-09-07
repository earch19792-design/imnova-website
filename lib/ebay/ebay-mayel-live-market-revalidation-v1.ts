import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCommercialMonitorDashboard } from
  "./ebay-commercial-monitor-service"
import {
  buildMayelCommercialIntelligenceV1,
  type MayelMarketEvidenceRowV1,
} from "./ebay-mayel-commercial-intelligence-v1"
import { adaptMainSearchSoldCaptureForCanonicalImport } from
  "./ebay-main-search-sold-capture-adapter-v1"
import {
  importOfficialSoldEvidence,
  soldEvidenceNoValidRowsDiagnostic,
} from "./ebay-official-sold-evidence-import"
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

function validWorkerId(value: unknown) {
  const normalized = text(value, 160)
  return /^product-research-browser:[0-9a-f-]{36}$/i.test(normalized)
    ? normalized : null
}

function safeFailureCode(value: unknown) {
  const normalized = text(value, 180).toUpperCase()
  return /^[A-Z0-9_]{3,180}$/.test(normalized)
    ? normalized : "PRODUCT_RESEARCH_WORKER_FAILED"
}

function sameTimestamp(left: unknown, right: unknown) {
  const leftMs = Date.parse(String(left ?? ""))
  const rightMs = Date.parse(String(right ?? ""))
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs
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

export async function readMayelAutonomousResearchAcquisitionV1(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const plans = await input.supabase.from(
    "marketplace_product_research_query_plans")
    .select("id,source_context,request_receipt_id,subject_item_id,status,created_at,worker_lease_owner,worker_lease_expires_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .in("source_context", ["LIVE_LISTING_REVALIDATION",
      "QUICK_PICK_RESEARCH_REQUIRED"])
    .in("status", ["ACTIVE", "COMPLETED"])
    .order("created_at", { ascending: true }).limit(100)
  if (plans.error) {
    throw new Error("MAYEL_RESEARCH_ACQUISITION_PLAN_READ_FAILED")
  }
  const planIds = (plans.data ?? []).map((plan) => String(plan.id))
  if (!planIds.length) return Object.freeze({
    pendingPlanCount: 0, claimablePlanCount: 0,
    activeClaimCount: 0, nextPlanId: null,
    sourceContexts: Object.freeze([] as string[]),
    authenticatedBrowserRequired: true as const,
    marketplaceWrites: 0 as const,
  })
  const receiptIds = (plans.data ?? []).flatMap((plan) =>
    plan.request_receipt_id ? [String(plan.request_receipt_id)] : [])
  const [tasks, receipts] = await Promise.all([
    input.supabase.from("marketplace_product_research_query_tasks")
      .select("plan_id,status,capture_batch_id")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").in("plan_id", planIds)
      .in("status", ["PENDING", "PROCESSED"]),
    receiptIds.length ? input.supabase.from(
      "seller_os_operational_learning_ledger_v1")
      .select("id,status,lease_owner,lease_expires_at")
      .eq("marketplace_account_key", input.accountKey)
      .in("id", receiptIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (tasks.error || receipts.error) {
    throw new Error("MAYEL_RESEARCH_ACQUISITION_STATE_READ_FAILED")
  }
  const resumablePlanIds = new Set((plans.data ?? []).filter((plan) =>
    (tasks.data ?? []).some((task) => {
      const samePlan = String(task.plan_id) === String(plan.id)
      const pendingQuery = plan.status === "ACTIVE" && task.status === "PENDING"
      const downstreamResume = plan.status === "COMPLETED" &&
        task.status === "PROCESSED" && Boolean(task.capture_batch_id)
      return samePlan && (pendingQuery || downstreamResume)
    })).map((plan) => String(plan.id)))
  const now = Date.now()
  const receiptById = new Map((receipts.data ?? []).map((receipt) =>
    [String(receipt.id), receipt] as const))
  const pending = (plans.data ?? []).filter((plan) =>
    resumablePlanIds.has(String(plan.id)) && (
      plan.source_context === "QUICK_PICK_RESEARCH_REQUIRED" ||
      receiptById.get(String(plan.request_receipt_id))?.status === "OPEN"))
  const activeClaimCount = pending.filter((plan) => {
    if (plan.source_context === "QUICK_PICK_RESEARCH_REQUIRED") {
      return Boolean(plan.worker_lease_owner && plan.worker_lease_expires_at &&
        Date.parse(String(plan.worker_lease_expires_at)) > now)
    }
    const receipt = receiptById.get(String(plan.request_receipt_id))
    return Boolean(receipt?.lease_owner && receipt.lease_expires_at &&
      Date.parse(String(receipt.lease_expires_at)) > now)
  }).length
  const claimable = pending.filter((plan) => {
    if (plan.source_context === "QUICK_PICK_RESEARCH_REQUIRED") {
      return !plan.worker_lease_expires_at ||
        Date.parse(String(plan.worker_lease_expires_at)) <= now
    }
    const receipt = receiptById.get(String(plan.request_receipt_id))
    return !receipt?.lease_expires_at ||
      Date.parse(String(receipt.lease_expires_at)) <= now
  })
  return Object.freeze({ pendingPlanCount: pending.length,
    claimablePlanCount: activeClaimCount ? 0 : claimable.length,
    activeClaimCount,
    nextPlanId: activeClaimCount ? null : claimable[0]?.id ?? null,
    sourceContexts: Object.freeze([...new Set(pending.map((plan) =>
      String(plan.source_context)))]),
    authenticatedBrowserRequired: true as const,
    marketplaceWrites: 0 as const })
}

export async function claimMayelAutonomousResearchPlanV1(input: {
  supabase: SupabaseClient
  accountKey: string
  workerId: unknown
  workerCapability: unknown
  planId?: unknown
}) {
  const workerId = validWorkerId(input.workerId)
  const capability = record(input.workerCapability)
  const requestedPlanId = input.planId === undefined || input.planId === null
    ? null : validPlanId(input.planId)
  if (!workerId || (input.planId !== undefined && input.planId !== null &&
      !requestedPlanId)) {
    throw new Error("MAYEL_RESEARCH_WORKER_CLAIM_INVALID")
  }
  const claimed = await input.supabase.rpc(
    "claim_next_live_listing_product_research_v2", {
      p_marketplace_account_key: input.accountKey,
      p_worker_id: workerId,
      p_worker_capability: capability,
      p_plan_id: requestedPlanId,
      p_lease_seconds: 900,
    })
  if (claimed.error) {
    throw new Error("MAYEL_RESEARCH_WORKER_CLAIM_FAILED")
  }
  const row = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data
  if (!record(row).claimed) return Object.freeze({ claimed: false as const,
    planId: null, leaseExpiresAt: null, plan: null,
    marketplaceWrites: 0 as const })
  const planId = validPlanId(record(row).plan_id)
  if (!planId) throw new Error("MAYEL_RESEARCH_WORKER_CLAIM_READBACK_FAILED")
  const plan = await getProductResearchQueryPlanStatus({
    supabase: input.supabase, accountKey: input.accountKey, planId,
  })
  if (!plan || !["LIVE_LISTING_REVALIDATION",
      "QUICK_PICK_RESEARCH_REQUIRED"].includes(plan.sourceContext)) {
    throw new Error("MAYEL_RESEARCH_WORKER_CLAIM_READBACK_FAILED")
  }
  const itemId = plan.sourceContext === "LIVE_LISTING_REVALIDATION"
    ? (await readMayelLiveMarketRevalidationPlanV1({
      supabase: input.supabase, accountKey: input.accountKey, planId,
    })).itemId : null
  return Object.freeze({ claimed: true as const, workerId, planId,
    leaseExpiresAt: record(row).lease_expires_at ?? null,
    ledgerId: record(row).ledger_id ?? null, plan,
    itemId, sourceContext: plan.sourceContext,
    marketplaceWrites: 0 as const })
}

export async function releaseMayelAutonomousResearchPlanV1(input: {
  supabase: SupabaseClient
  accountKey: string
  workerId: unknown
  planId: unknown
  errorCode: unknown
}) {
  const workerId = validWorkerId(input.workerId)
  const planId = validPlanId(input.planId)
  if (!workerId || !planId) {
    throw new Error("MAYEL_RESEARCH_WORKER_RELEASE_INVALID")
  }
  const released = await input.supabase.rpc(
    "release_live_listing_product_research_v1", {
      p_marketplace_account_key: input.accountKey,
      p_plan_id: planId,
      p_worker_id: workerId,
      p_error_code: safeFailureCode(input.errorCode),
    })
  if (released.error || released.data !== true) {
    throw new Error("MAYEL_RESEARCH_WORKER_RELEASE_FAILED")
  }
  return Object.freeze({ released: true as const, planId,
    retrySafety: "SAFE_IDEMPOTENT_RUNTIME_RESUME" as const,
    marketplaceWrites: 0 as const })
}

async function completeQuickPickProductResearchPlanV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  planId: string
  capture: ProductResearchBrowserCapture
  soldRows: unknown[]
  workerId: string
}) {
  const plan = await getProductResearchQueryPlanStatus({
    supabase: input.supabase, accountKey: input.accountKey,
    planId: input.planId,
  })
  if (!plan || plan.sourceContext !== "QUICK_PICK_RESEARCH_REQUIRED" ||
      !plan.sourceLunaProductId || !plan.subjectSupplierVariantId ||
      !plan.sourceCandidateKey) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_PLAN_SCOPE_INVALID")
  }
  const lease = await input.supabase.from(
    "marketplace_product_research_query_plans")
    .select("worker_lease_owner,worker_lease_expires_at")
    .eq("id", input.planId).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("source_context", "QUICK_PICK_RESEARCH_REQUIRED")
    .limit(1).maybeSingle()
  if (lease.error || lease.data?.worker_lease_owner !== input.workerId ||
      !lease.data.worker_lease_expires_at ||
      Date.parse(String(lease.data.worker_lease_expires_at)) <= Date.now()) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_WORKER_LEASE_REQUIRED")
  }
  const variant = await input.supabase.from("market_radar_latest_variants")
    .select("*").eq("source_key", "lunaportex")
    .eq("product_id", plan.sourceLunaProductId)
    .eq("supplier_variant_id", plan.subjectSupplierVariantId)
    .limit(1).maybeSingle()
  const target = variant.error ? null : targetFromCatalogRow(record(variant.data))
  if (!target || target.supplierVariantId !== plan.subjectSupplierVariantId) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_EXACT_VARIANT_REQUIRED")
  }
  const planned = await assertProductResearchCaptureMatchesNextQuery({
    supabase: input.supabase, accountKey: input.accountKey,
    searchQuery: input.capture?.searchQuery, planId: input.planId,
  })
  if (!planned || planned.planId !== input.planId) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_TASK_BINDING_INVALID")
  }
  const research = await importProductResearchBrowserCapture({
    supabase: input.supabase, accountKey: input.accountKey,
    actorId: input.actorId, capture: input.capture,
    exactTargets: [target], visualContext: { categoryId: planned.categoryId },
  })
  let soldImportBatchId: string | null = null
  let soldEvidenceOutcome = "NO_ROWS_CAPTURED"
  if (input.soldRows.length > 0) {
    const soldCapture = await adaptMainSearchSoldCaptureForCanonicalImport({
      rows: input.soldRows,
    })
    try {
      const sold = await importOfficialSoldEvidence({
        supabase: input.supabase, accountKey: input.accountKey,
        actorId: input.actorId, format: "JSON",
        sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE",
        content: JSON.stringify({ rows: soldCapture.rows }),
        operatorAttested: true,
      })
      soldImportBatchId = sold.batchId
      soldEvidenceOutcome = "DURABLE_SOLD_EVIDENCE"
    } catch (error) {
      if (!soldEvidenceNoValidRowsDiagnostic(error)) throw error
      soldEvidenceOutcome = "NO_VALID_SOLD_EVIDENCE"
    }
  }
  if (!planned.alreadyProcessed) {
    await markProductResearchQueryCaptured({
      supabase: input.supabase, accountKey: input.accountKey,
      planId: input.planId, taskId: planned.taskId,
      searchQueryHash: research.searchQueryHash,
      captureBatchId: research.batchId,
      capturedAt: new Date(research.capturedAt),
    })
  }
  const completedAt = new Date().toISOString()
  const completed = await input.supabase.rpc(
    "complete_quick_pick_product_research_claim_v1", {
      p_marketplace_account_key: input.accountKey,
      p_plan_id: input.planId,
      p_worker_id: input.workerId,
      p_capture_batch_id: research.batchId,
      p_completed_at: completedAt,
    })
  if (completed.error || completed.data !== true) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_CLAIM_COMPLETE_FAILED")
  }
  return Object.freeze({ planId: input.planId,
    sourceContext: "QUICK_PICK_RESEARCH_REQUIRED" as const,
    candidateId: plan.sourceCandidateKey,
    lunaProductId: plan.sourceLunaProductId,
    lunaVariantId: plan.subjectSupplierVariantId,
    captureBatchId: research.batchId, soldImportBatchId, soldEvidenceOutcome,
    productResearchExecuted: true as const,
    researchReceiptCreated: true as const,
    nextStageStarted: false as const,
    ownerActionRequired: false as const,
    marketplaceWrites: 0 as const, completedAt })
}

export async function completeAutonomousProductResearchPlanV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  planId: unknown
  capture: ProductResearchBrowserCapture
  soldRows: unknown
  soldFilterAutomated: unknown
  paginationAutomated: unknown
  extensionMarketplaceWrites: unknown
  workerId: unknown
  workerMetrics?: unknown
}) {
  const planId = validPlanId(input.planId)
  const workerId = validWorkerId(input.workerId)
  if (!planId || !workerId || input.soldFilterAutomated !== true ||
      input.paginationAutomated !== true ||
      input.extensionMarketplaceWrites !== 0 ||
      !Array.isArray(input.soldRows) || input.soldRows.length > 200) {
    throw new Error("PRODUCT_RESEARCH_WORKER_RESULT_INVALID")
  }
  const plan = await getProductResearchQueryPlanStatus({
    supabase: input.supabase, accountKey: input.accountKey, planId,
  })
  if (plan?.sourceContext === "LIVE_LISTING_REVALIDATION") {
    return completeMayelLiveMarketRevalidationV1({ ...input, planId,
      workerId, soldRows: input.soldRows })
  }
  if (plan?.sourceContext === "QUICK_PICK_RESEARCH_REQUIRED") {
    return completeQuickPickProductResearchPlanV1({
      supabase: input.supabase, accountKey: input.accountKey,
      actorId: input.actorId, planId, workerId,
      capture: input.capture, soldRows: input.soldRows,
    })
  }
  throw new Error("PRODUCT_RESEARCH_PLAN_CONTEXT_NOT_CLAIMABLE")
}

export async function resumeMayelMarketRevalidationDownstreamV1(input: {
  supabase: SupabaseClient
  accountKey: string
  planId: unknown
  workerId: unknown
}) {
  const planId = validPlanId(input.planId)
  const workerId = validWorkerId(input.workerId)
  if (!planId || !workerId) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RESUME_INVALID")
  }
  const context = await readExactLiveContext({ ...input, planId })
  const receiptId = text(context.plan?.request_receipt_id, 40)
  const [plan, receipt, task] = await Promise.all([
    getProductResearchQueryPlanStatus({ ...input, planId }),
    input.supabase.from("seller_os_operational_learning_ledger_v1")
      .select("id,status,lease_owner,lease_expires_at")
      .eq("id", receiptId).eq("marketplace_account_key", input.accountKey)
      .limit(1).maybeSingle(),
    input.supabase.from("marketplace_product_research_query_tasks")
      .select("capture_batch_id,captured_at")
      .eq("plan_id", planId).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").eq("status", "PROCESSED")
      .not("capture_batch_id", "is", null).order("ordinal", { ascending: false })
      .limit(1).maybeSingle(),
  ])
  if (!plan || plan.status !== "COMPLETED" || plan.pendingCount !== 0 ||
      receipt.error || !receipt.data || receipt.data.status !== "OPEN" ||
      receipt.data.lease_owner !== workerId ||
      !receipt.data.lease_expires_at ||
      Date.parse(String(receipt.data.lease_expires_at)) <= Date.now() ||
      task.error || !task.data?.capture_batch_id) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RESUME_NOT_ELIGIBLE")
  }
  const capture = await input.supabase.from(
    "marketplace_product_research_capture_batches")
    .select("id,source_row_count,valid_count,imported_count,duplicate_count,rejected_count,captured_at")
    .eq("id", task.data.capture_batch_id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").limit(1).maybeSingle()
  if (capture.error || !capture.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_CAPTURE_READBACK_REQUIRED")
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
  if (radar.error || !sameTimestamp(
    radar.data?.last_radar_review_at, completedAt)) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RADAR_REINGEST_FAILED")
  }
  const validCount = Number(capture.data.valid_count) || 0
  const outcome = {
    requestState: "COMPLETED",
    itemId: context.listing.ebay_item_id,
    listingId: context.listing.id,
    supplierVariantId: context.target.supplierVariantId,
    planId,
    captureBatchId: capture.data.id,
    soldImportBatchId: null,
    productResearchExecuted: true,
    workerClaimed: true,
    workerCapabilityFresh: true,
    downstreamResumeUsed: true,
    repeatedBrowserCapture: false,
    workerMetrics: {
      queryCount: plan.queryCount,
      pagesCaptured: null,
      pagesCapturedMinimum: 1,
      pagesCapturedMaximum: 2,
      rawResultCount: Number(capture.data.source_row_count) || 0,
      soldResultCount: validCount,
      dedupedResultCount: Number(capture.data.imported_count) || 0,
      productResearchDuplicateCount:
        Number(capture.data.duplicate_count) || 0,
      soldDuplicateCount: 0,
    },
    soldEvidenceOutcome: validCount > 0 ? "DURABLE_SOLD_EVIDENCE" :
      "NO_VALID_SOLD_EVIDENCE",
    soldEvidenceRejectedCount: Number(capture.data.rejected_count) || 0,
    soldEvidenceRejectionReasonCounts: {},
    freshSoldEvidencePersisted: validCount > 0,
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
  const finalized = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").update({
      recovery_outcome: "RECOVERED", status: "RESOLVED",
      evidence: outcome, last_observed_at: completedAt,
      resolved_at: completedAt, lease_owner: null, lease_expires_at: null,
      updated_at: completedAt,
    }).eq("id", receiptId).eq("marketplace_account_key", input.accountKey)
    .eq("status", "OPEN").eq("lease_owner", workerId)
    .gt("lease_expires_at", completedAt)
    .select("id").maybeSingle()
  if (finalized.error || !finalized.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RECEIPT_FINALIZE_FAILED")
  }
  return Object.freeze({ ...outcome, receiptId: finalized.data.id,
    mayelResultVisible: true as const })
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
      planRead.data.status === "ACTIVE" ? "WAITING_FOR_WORKER" as const
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
  workerId: unknown
  workerMetrics?: unknown
}) {
  const planId = validPlanId(input.planId)
  const workerId = validWorkerId(input.workerId)
  if (!planId || input.soldFilterAutomated !== true ||
      input.paginationAutomated !== true || input.extensionMarketplaceWrites !== 0 ||
      !workerId || !Array.isArray(input.soldRows) || input.soldRows.length > 200) {
    throw new Error("MAYEL_MARKET_REVALIDATION_WORKER_RESULT_INVALID")
  }
  const context = await readExactLiveContext({ ...input, planId })
  const receiptId = text(context.plan?.request_receipt_id, 40)
  const priorReceipt = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,status,evidence,resolved_at,lease_owner,lease_expires_at")
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
  if (priorReceipt.data.lease_owner !== workerId ||
      !priorReceipt.data.lease_expires_at ||
      Date.parse(String(priorReceipt.data.lease_expires_at)) <= Date.now()) {
    throw new Error("MAYEL_MARKET_REVALIDATION_WORKER_LEASE_REQUIRED")
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
  let soldNoValid: ReturnType<typeof soldEvidenceNoValidRowsDiagnostic> = null
  let soldCapture: Awaited<ReturnType<
    typeof adaptMainSearchSoldCaptureForCanonicalImport
  >> | null = null
  if (input.soldRows.length > 0) {
    // The browser extension returns a deliberately minimal visible-row schema.
    // Reuse the same canonical adapter as the established Product Research
    // route before importing official Sold evidence. A healthy capture with no
    // exact valid comparable is a durable market result, not a worker crash.
    soldCapture = await adaptMainSearchSoldCaptureForCanonicalImport({
      rows: input.soldRows,
    })
    try {
      sold = await importOfficialSoldEvidence({
        supabase: input.supabase, accountKey: input.accountKey,
        actorId: input.actorId, format: "JSON",
        sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE",
        content: JSON.stringify({ rows: soldCapture.rows }),
        operatorAttested: true,
      })
    } catch (error) {
      soldNoValid = soldEvidenceNoValidRowsDiagnostic(error)
      if (!soldNoValid) throw error
    }
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
  if (radar.error || !sameTimestamp(
    radar.data?.last_radar_review_at, completedAt)) {
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
    workerClaimed: true,
    workerCapabilityFresh: true,
    workerMetrics: {
      queryCount: Number(record(input.workerMetrics).queryCount) || 1,
      pagesCaptured: Number.isInteger(Number(
        record(input.workerMetrics).pagesCaptured)) &&
        Number(record(input.workerMetrics).pagesCaptured) > 0
        ? Number(record(input.workerMetrics).pagesCaptured) : null,
      pagesCapturedMinimum: Number(record(input.workerMetrics)
        .pagesCapturedMinimum) || 1,
      pagesCapturedMaximum: Number(record(input.workerMetrics)
        .pagesCapturedMaximum) || 2,
      rawResultCount: research.rowCount +
        Number(soldCapture?.sourceRowCount ?? input.soldRows.length),
      soldResultCount: Number(sold?.rowCount ??
        soldNoValid?.sourceRowCount ?? 0),
      dedupedResultCount: research.importedCount +
        Number(sold?.importedCount ?? 0),
      productResearchDuplicateCount: research.duplicateCount,
      soldDuplicateCount: Number(sold?.duplicateCount ?? 0),
    },
    soldEvidenceOutcome: soldNoValid ? "NO_VALID_SOLD_EVIDENCE" :
      sold ? "DURABLE_SOLD_EVIDENCE" : "NO_SOLD_ROWS_RETURNED",
    soldEvidenceRejectedCount: Number(soldNoValid?.rejectedCount ??
      sold?.rejectedCount ?? 0),
    soldEvidenceRejectionReasonCounts: soldNoValid?.errorCounts ?? {},
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
    .eq("status", "OPEN").eq("lease_owner", workerId)
    .gt("lease_expires_at", completedAt)
    .select("id,evidence,status,resolved_at").maybeSingle()
  if (receipt.error || !receipt.data) {
    throw new Error("MAYEL_MARKET_REVALIDATION_RECEIPT_FINALIZE_FAILED")
  }
  return Object.freeze({ ...outcome, receiptId: receipt.data.id,
    mayelResultVisible: true as const })
}
