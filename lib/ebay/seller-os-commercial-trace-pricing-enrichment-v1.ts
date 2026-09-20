import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { ebaySellerReferenceHash, ebaySourceListingReferenceHash } from
  "./ebay-competitor-watch-fingerprints"
import {
  adaptMainSearchSoldCaptureForCanonicalImport,
  adaptMainSearchSoldCaptureForCommercialTrace,
  EBAY_COMMERCIAL_TRACE_SOLD_CAPTURE_ADAPTER_VERSION,
} from "./ebay-main-search-sold-capture-adapter-v1"
import {
  importOfficialSoldEvidence,
  soldEvidenceNoValidRowsDiagnostic,
} from "./ebay-official-sold-evidence-import"
import { buildEbaySellerKeywordSearchQuery,
  type EbaySellerComparableInput } from
  "./ebay-seller-keyword-demand-validation"

export const SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1 =
  "SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1" as const
export const SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1 =
  "SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1" as const
export const COMMERCIAL_TRACE_PRICING_MAX_TASKS = 6
export const COMMERCIAL_TRACE_PRICING_MAX_ROWS = 60

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function uuid(value: unknown) {
  const candidate = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(candidate) ? candidate : null
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as JsonRecord).sort(([left], [right]) =>
      left.localeCompare(right)).map(([key, entry]) => [key, stableJson(entry)]))
  return value
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    JSON.stringify(stableJson(value))).digest("hex")}`
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100 : null
}

function rpcRow(value: unknown) {
  const rows = Array.isArray(value) ? value : [value]
  return record(rows[0])
}

export type CommercialTracePricingTaskV1 = Readonly<{
  ordinal: number
  sourceComparableId: string
  searchQuery: string
  acquisitionPath: "PRODUCT_RESEARCH_NEAR_EXACT_SOLD" |
    "PUBLIC_EBAY_SOLD_COMPLETED"
}>

export function buildCommercialTracePricingDispatchV1(input: Readonly<{
  exactProductTitle: string
  market: unknown
}>) {
  const market = record(input.market)
  const enrichment = record(market.nearExactSoldEnrichment)
  const accepted = Array.isArray(market.acceptedComparables)
    ? market.acceptedComparables.map(record) : []
  const byId = new Map(accepted.map((entry) =>
    [text(entry.comparableId, 160), entry] as const))
  const selected = Array.isArray(enrichment.candidates)
    ? enrichment.candidates.map(record) : []
  const tasks: CommercialTracePricingTaskV1[] = []
  const seenQueries = new Set<string>()
  const append = (sourceComparableId: string, title: string,
    acquisitionPath: CommercialTracePricingTaskV1["acquisitionPath"]) => {
    const searchQuery = buildEbaySellerKeywordSearchQuery({ productName: title })
    const key = searchQuery.toLocaleLowerCase("en-US")
    if (searchQuery.length < 3 || seenQueries.has(key) ||
        tasks.length >= COMMERCIAL_TRACE_PRICING_MAX_TASKS) return
    seenQueries.add(key)
    tasks.push(Object.freeze({ ordinal: tasks.length + 1,
      sourceComparableId, searchQuery, acquisitionPath }))
  }
  // Public SOLD/COMPLETED is a first-class path tied to the exact Luna title.
  append("LUNA_EXACT_PRODUCT", input.exactProductTitle,
    "PUBLIC_EBAY_SOLD_COMPLETED")
  for (const candidate of selected) {
    if (!["NOT_AVAILABLE", "REQUEST_FAILED"].includes(
      text(candidate.result, 40))) continue
    const comparableId = text(candidate.comparableId, 160)
    const comparable = byId.get(comparableId)
    if (!comparable || comparable.pricingAuthorityEligible === false ||
        !["EXACT_MODEL_COMPARABLE", "NEAR_EXACT_PRODUCT"].includes(
          text(comparable.comparableClass, 80))) continue
    append(comparableId, text(comparable.title, 300),
      "PRODUCT_RESEARCH_NEAR_EXACT_SOLD")
  }
  return Object.freeze({ contractVersion:
      SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1,
    tasks: Object.freeze(tasks), taskSpecDigest: sha256(tasks),
    maximumTasks: COMMERCIAL_TRACE_PRICING_MAX_TASKS,
    maximumRows: COMMERCIAL_TRACE_PRICING_MAX_ROWS,
    freeShippingRequired: false as const,
    publicSoldCompletedRequired: true as const,
    arbitraryUrlAllowed: false as const,
    marketplaceWrites: 0 as const })
}

export async function enqueueCommercialTracePricingEnrichmentV1(input: Readonly<{
  supabase: SupabaseClient
  traceId: string
  accountKey: string
  productId: string
  variantId: string
  supplierSku: string
  canonicalUrl: string
  sourceFingerprint: string
  exactProductTitle: string
  market: unknown
}>) {
  const dispatch = buildCommercialTracePricingDispatchV1({
    exactProductTitle: input.exactProductTitle, market: input.market,
  })
  if (!dispatch.tasks.length) return Object.freeze({ enqueued: false as const,
    reason: "NO_BOUNDED_PRICING_ENRICHMENT_TASKS" as const, ...dispatch })
  const taskSpec = dispatch.tasks.map(({ ordinal, sourceComparableId,
    searchQuery, acquisitionPath }) => ({ ordinal, sourceComparableId,
    searchQuery, acquisitionPath }))
  const taskSpecDigest = sha256(taskSpec)
  const result = await input.supabase.rpc(
    "enqueue_seller_os_commercial_trace_pricing_enrichment_v1", {
      p_trace_id: input.traceId,
      p_marketplace_account_key: input.accountKey,
      p_luna_product_id: input.productId,
      p_luna_variant_id: input.variantId,
      p_supplier_sku: input.supplierSku,
      p_canonical_url: input.canonicalUrl,
      p_source_fingerprint: input.sourceFingerprint,
      p_task_spec: taskSpec,
      p_task_spec_digest: taskSpecDigest,
    })
  if (result.error) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_DISPATCH_FAILED")
  const row = rpcRow(result.data)
  const jobId = uuid(row.jobId)
  if (!jobId || row.traceId !== input.traceId) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_DISPATCH_READBACK_INVALID")
  return Object.freeze({ ...dispatch, enqueued: true as const, jobId,
    state: text(row.state, 30), taskCount: taskSpec.length,
    taskSpecDigest })
}

export async function claimCommercialTracePricingEnrichmentV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  workerId: unknown
}>) {
  const workerId = text(input.workerId, 180)
  if (workerId.length < 8) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_WORKER_INVALID")
  const claimed = await input.supabase.rpc(
    "claim_seller_os_commercial_trace_pricing_enrichment_v1", {
      p_marketplace_account_key: input.accountKey,
      p_owner_user_id: input.ownerUserId,
      p_worker_id: workerId,
    })
  if (claimed.error) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_CLAIM_FAILED")
  const row = rpcRow(claimed.data)
  if (row.claimed !== true) return Object.freeze({ claimed: false as const,
    jobId: null, traceId: null, marketplaceWrites: 0 as const })
  const jobId = uuid(row.jobId)
  const traceId = uuid(row.traceId)
  const tasks = Array.isArray(row.tasks) ? row.tasks.map(record) : []
  if (!jobId || !traceId || tasks.length < 1 ||
      tasks.length > COMMERCIAL_TRACE_PRICING_MAX_TASKS ||
      row.contractVersion !== SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_V1 ||
      Number(row.remainingRows) !== COMMERCIAL_TRACE_PRICING_MAX_ROWS) {
    throw new Error("COMMERCIAL_TRACE_PRICING_ENRICHMENT_CLAIM_INVALID")
  }
  return Object.freeze({ claimed: true as const, jobId, traceId,
    leaseExpiresAt: text(row.leaseExpiresAt, 80),
    contractVersion: row.contractVersion,
    lunaProductId: text(row.lunaProductId, 40),
    lunaVariantId: text(row.lunaVariantId, 40),
    supplierSku: text(row.supplierSku, 160),
    tasks: Object.freeze(tasks), remainingRows: COMMERCIAL_TRACE_PRICING_MAX_ROWS,
    commandType: "IMNOVA_EBAY_NEAR_EXACT_SOLD_ENRICHMENT_V1" as const,
    freeShippingRequired: false as const, arbitraryUrlAllowed: false as const,
    marketplaceWrites: 0 as const })
}

export async function releaseCommercialTracePricingEnrichmentV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  workerId: unknown
  jobId: unknown
  errorCode: unknown
}>) {
  const jobId = uuid(input.jobId)
  const workerId = text(input.workerId, 180)
  const errorCode = text(input.errorCode, 120)
  if (!jobId || workerId.length < 8 || !/^[A-Z0-9_]{3,120}$/.test(errorCode)) {
    throw new Error("COMMERCIAL_TRACE_PRICING_ENRICHMENT_RELEASE_INVALID")
  }
  const released = await input.supabase.rpc(
    "release_seller_os_commercial_trace_pricing_enrichment_v1", {
      p_job_id: jobId, p_marketplace_account_key: input.accountKey,
      p_owner_user_id: input.ownerUserId, p_worker_id: workerId,
      p_error_code: errorCode,
    })
  if (released.error) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_RELEASE_FAILED")
  return Object.freeze({ released: released.data === true,
    marketplaceWrites: 0 as const })
}

function pricingFingerprintSecret() {
  return process.env.EBAY_COMPETITOR_FINGERPRINT_SECRET?.trim() ||
    process.env.EBAY_CLIENT_SECRET?.trim() || ""
}

export async function completeCommercialTracePricingEnrichmentV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  workerId: unknown
  jobId: unknown
  rows: unknown
  taskOutcomes: unknown
  soldFilterProven: unknown
  paginationAutomated: unknown
  extensionMarketplaceWrites: unknown
}>) {
  const jobId = uuid(input.jobId)
  const workerId = text(input.workerId, 180)
  if (!jobId || workerId.length < 8 || !Array.isArray(input.rows) ||
      input.rows.length > COMMERCIAL_TRACE_PRICING_MAX_ROWS ||
      !Array.isArray(input.taskOutcomes) ||
      input.soldFilterProven !== true || input.paginationAutomated !== true ||
      input.extensionMarketplaceWrites !== 0) throw new Error(
        "COMMERCIAL_TRACE_PRICING_ENRICHMENT_WORKER_RESULT_INVALID")
  const jobRead = await input.supabase.from(
    "seller_os_commercial_trace_pricing_enrichment_jobs_v1")
    .select("job_id,trace_id,owner_user_id,marketplace_account_key,luna_product_id,luna_variant_id,supplier_sku,source_fingerprint,task_spec,task_spec_digest,state,lease_owner,lease_expires_at,receipt,receipt_digest")
    .eq("job_id", jobId).eq("marketplace_account_key", input.accountKey)
    .eq("owner_user_id", input.ownerUserId).limit(1).maybeSingle()
  if (jobRead.error || !jobRead.data) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_JOB_NOT_FOUND")
  const job = record(jobRead.data)
  if (job.state === "COMPLETED") return Object.freeze({ completed: true as const,
    jobId, traceId: text(job.trace_id, 40), idempotent: true as const,
    marketplaceWrites: 0 as const })
  if (job.state !== "CLAIMED" || job.lease_owner !== workerId ||
      Date.parse(text(job.lease_expires_at, 80)) <= Date.now()) throw new Error(
        "COMMERCIAL_TRACE_PRICING_ENRICHMENT_WORKER_LEASE_REQUIRED")
  const tasks = Array.isArray(job.task_spec) ? job.task_spec.map(record) : []
  const queries = tasks.map((task) => text(task.searchQuery, 100))
  if (!queries.length || queries.length > COMMERCIAL_TRACE_PRICING_MAX_TASKS ||
      input.taskOutcomes.length !== tasks.length ||
      input.taskOutcomes.some((value, index) => {
        const outcome = record(value)
        return outcome.status !== "COMPLETED" ||
          Number(outcome.ordinal) !== Number(tasks[index]?.ordinal) ||
          text(outcome.searchQuery, 100) !== queries[index]
      })) throw new Error(
        "COMMERCIAL_TRACE_PRICING_ENRICHMENT_TASK_OUTCOME_INVALID")
  const capture = adaptMainSearchSoldCaptureForCommercialTrace({
    rows: input.rows, requestedQueries: queries,
  })
  const fingerprintSecret = pricingFingerprintSecret()
  if (!fingerprintSecret) throw new Error(
    "COMMERCIAL_TRACE_PRICING_SELLER_FINGERPRINT_CONFIGURATION_REQUIRED")
  const rows = capture.rows.map((row) => {
    const sellerReferenceHash = row.sellerIdentityStatus === "PROVEN"
      ? ebaySellerReferenceHash({ sellerUsername: row.sellerUsername,
          marketplaceAccountKey: input.accountKey, fingerprintSecret }) : null
    const sourceListingReferenceHash = ebaySourceListingReferenceHash(row.itemId)
    const explicitShipping = row.shippingStatus === "OBSERVED" &&
      row.visibleShippingAmount !== null
    const priceEligible = row.pricingEligibility ===
        "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION" &&
      Boolean(sellerReferenceHash) && explicitShipping
    return Object.freeze({ ebayItemId: row.itemId,
      sourceListingReferenceHash, sellerReferenceHash,
      title: row.title, condition: row.condition,
      soldAt: row.soldAt, observedAt: row.capturedAt,
      queryIdentity: row.queryIdentity,
      itemSoldPriceUsd: row.displayedSoldPriceAmount,
      buyerPaidShippingUsd: explicitShipping ? row.visibleShippingAmount : null,
      landedSoldPriceUsd: explicitShipping ? row.displayedDeliveredPrice : null,
      shippingStatus: row.shippingStatus,
      soldStatus: "SOLD_COMPLETED_CONFIRMED" as const,
      confirmedSoldQuantity: 1 as const,
      sellerIdentityStatus: row.sellerIdentityStatus,
      realizedPriceStatus: row.realizedPriceStatus,
      exactOrNearExactMatch: "PENDING_CANONICAL_TRACE_CLASSIFIER" as const,
      pricingEligibility: priceEligible
        ? "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION" as const
        : "NOT_PRICING_ELIGIBLE" as const,
      source: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE" as const,
      captureAdapterVersion: capture.version,
      acquisitionPath: tasks.find((task) =>
        text(task.searchQuery, 100) === row.queryIdentity)?.acquisitionPath ?? null,
    })
  })
  let canonicalImport: JsonRecord = { status: "NO_ROWS", validCount: 0 }
  if (input.rows.length) {
    const canonical = await adaptMainSearchSoldCaptureForCanonicalImport({
      rows: input.rows,
    })
    try {
      const imported = await importOfficialSoldEvidence({
        supabase: input.supabase, accountKey: input.accountKey,
        actorId: input.ownerUserId, format: "JSON",
        sourceExportType: "EBAY_MAIN_SEARCH_SOLD_CAPTURE",
        content: JSON.stringify({ rows: canonical.rows }),
        operatorAttested: true,
      })
      canonicalImport = { status: "DURABLE_SOLD_EVIDENCE",
        batchId: imported.batchId, validCount: imported.validCount }
    } catch (error) {
      const diagnostic = soldEvidenceNoValidRowsDiagnostic(error)
      if (!diagnostic) throw error
      canonicalImport = { status: "NO_VALID_CANONICAL_IMPORT_ROWS",
        validCount: 0, diagnostic }
    }
  }
  const receipt = { contractVersion:
      SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1,
    adapterVersion: EBAY_COMMERCIAL_TRACE_SOLD_CAPTURE_ADAPTER_VERSION,
    jobId, traceId: text(job.trace_id, 40),
    lunaProductId: text(job.luna_product_id, 40),
    lunaVariantId: text(job.luna_variant_id, 40),
    supplierSku: text(job.supplier_sku, 160),
    sourceFingerprint: text(job.source_fingerprint, 100),
    taskSpecDigest: text(job.task_spec_digest, 100),
    observedAt: new Date().toISOString(), rows,
    taskOutcomes: input.taskOutcomes,
    canonicalSoldImport: canonicalImport,
    sourcePaths: [...new Set(tasks.map((task) => task.acquisitionPath))],
    freeShippingRequired: false, arbitraryUrlAllowed: false,
    marketplaceWrites: 0 }
  const receiptDigest = sha256(receipt)
  const completed = await input.supabase.rpc(
    "complete_seller_os_commercial_trace_pricing_enrichment_v1", {
      p_job_id: jobId, p_marketplace_account_key: input.accountKey,
      p_owner_user_id: input.ownerUserId, p_worker_id: workerId,
      p_receipt: receipt, p_receipt_digest: receiptDigest,
    })
  if (completed.error) throw new Error(
    "COMMERCIAL_TRACE_PRICING_ENRICHMENT_COMPLETE_FAILED")
  return Object.freeze({ ...rpcRow(completed.data), receiptDigest,
    acceptedRowCount: rows.length, pricingEligibleRowCount: rows.filter((row) =>
      row.pricingEligibility ===
        "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION").length,
    marketplaceWrites: 0 as const })
}

export async function readCommercialTracePricingEvidenceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  traceId: string
  productId: string
  variantId: string
  supplierSku: string
  sourceFingerprint: string
}>) {
  const read = await input.supabase.from(
    "seller_os_commercial_trace_pricing_enrichment_jobs_v1")
    .select("state,luna_product_id,luna_variant_id,supplier_sku,source_fingerprint,task_spec,receipt,receipt_digest")
    .eq("trace_id", input.traceId)
    .eq("marketplace_account_key", input.accountKey).limit(1).maybeSingle()
  if (read.error || !read.data || read.data.state !== "COMPLETED") return null
  if (read.data.luna_product_id !== input.productId ||
      read.data.luna_variant_id !== input.variantId ||
      read.data.supplier_sku !== input.supplierSku ||
      read.data.source_fingerprint !== input.sourceFingerprint) throw new Error(
        "COMMERCIAL_TRACE_PRICING_ENRICHMENT_READ_BINDING_INVALID")
  const receipt = record(read.data.receipt)
  if (receipt.contractVersion !==
      SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1 ||
      receipt.traceId !== input.traceId || receipt.marketplaceWrites !== 0 ||
      read.data.receipt_digest !== sha256(receipt)) throw new Error(
        "COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_INVALID")
  const rows = Array.isArray(receipt.rows) ? receipt.rows.map(record) : []
  const comparables: EbaySellerComparableInput[] = rows.flatMap((row) => {
    const price = money(row.itemSoldPriceUsd)
    const shipping = money(row.buyerPaidShippingUsd)
    const seller = text(row.sellerReferenceHash, 100)
    if (row.pricingEligibility !==
        "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION" || price === null ||
        shipping === null || !/^hmac-sha256:[0-9a-f]{64}$/.test(seller) ||
        !/^\d{9,20}$/.test(text(row.ebayItemId, 30)) ||
        row.realizedPriceStatus !== "REALIZED_PRICE_CONFIRMED") return []
    return [{ itemId: text(row.ebayItemId, 30), title: text(row.title, 300),
      price, currency: "USD", sellerUsername: seller,
      confirmedSoldQuantity: 1, estimatedSoldQuantity: 0,
      lastSoldDate: text(row.soldAt, 80),
      soldHistorySource: "CONFIRMED_DURABLE_SOLD" as const,
      durableSoldSourceType: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
      durableSoldSourceClass: "MAIN_SEARCH_SOLD",
      realizedPriceStatus: "REALIZED_PRICE_CONFIRMED",
      commercialTraceQueryIdentity: text(row.queryIdentity, 100),
      commercialTraceAcquisitionPath: row.acquisitionPath ===
          "PRODUCT_RESEARCH_NEAR_EXACT_SOLD"
        ? "PRODUCT_RESEARCH_NEAR_EXACT_SOLD" as const
        : "PUBLIC_EBAY_SOLD_COMPLETED" as const,
      shippingCost: shipping,
      localizedAspects: text(row.condition, 80)
        ? [{ name: "Condition", value: text(row.condition, 80) }] : [],
      itemEndDate: text(row.soldAt, 80),
      source: "EBAY_BROWSE_ACTIVE_LISTING" as const }]
  })
  const tasks = Array.isArray(read.data.task_spec)
    ? read.data.task_spec.map(record) : []
  return Object.freeze({ status: "COMPLETED" as const,
    receiptDigest: read.data.receipt_digest, rows: Object.freeze(comparables),
    tasks: Object.freeze(tasks), marketplaceWrites: 0 as const })
}
