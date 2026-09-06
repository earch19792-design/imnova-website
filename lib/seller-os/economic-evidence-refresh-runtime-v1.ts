import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCommercialMonitorLiveReadonly } from
  "../ebay/ebay-commercial-monitor-live-readonly"
import { readManualListingFromTradingApi } from
  "../ebay/ebay-manual-listing-trading-readonly"
import { readEbaySellerStoreSubscriptionReadonly } from
  "../ebay/ebay-account-policy-readonly-gateway"
import { resolveOfficialPreSaleFeePolicyV1 } from
  "../ebay/ebay-live-presale-economics-v1"
import { fetchPublicLunaProductForActiveListingMonitor } from
  "../ebay/ebay-targeted-active-listing-luna-monitor"
import { captureLiveListingShippingEvidenceV1,
  LiveListingShippingEvidenceCaptureErrorV1 } from
  "../ebay/ebay-live-listing-shipping-evidence-server-v1"
import {
  ECONOMIC_EVIDENCE_TYPES_V1,
  SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1,
  buildEconomicEvidenceV1,
  calculateLiveEconomicsV1,
  economicRefreshJobKeyV1,
  evidenceIsFreshV1,
  type EconomicEvidenceTypeV1,
  type EconomicRefreshStatusV1,
  type LatestEconomicEvidenceV1,
} from "./economic-evidence-refresh-v1"

type JsonRecord = Record<string, unknown>

type JobRow = Readonly<{
  job_id: string
  idempotency_key: string
  ebay_item_id: string
  evidence_type: EconomicEvidenceTypeV1
  source_identity: JsonRecord
  status: EconomicRefreshStatusV1
  last_evidence_id: string | null
  failure_class: string | null
  next_retry_at: string | null
  attempt_count: number
  first_detected_at: string
  lease_expires_at: string | null
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function money(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Number(parsed.toFixed(4)) : null
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,159}$/.test(code)
    ? code : "ECONOMIC_EVIDENCE_SOURCE_READ_FAILED"
}

function retryAt(now: Date, milliseconds: number) {
  return new Date(now.getTime() + milliseconds).toISOString()
}

function sourceStatusForError(error: unknown, now: Date) : Readonly<{
  status: "WAITING_FOR_WORKER" | "FAILED_RETRYABLE"
  nextRetryAt: string
}> {
  const code = safeCode(error)
  const worker = error instanceof LiveListingShippingEvidenceCaptureErrorV1 ||
    /(?:BROWSER|SESSION|REAUTH|WORKER|CHROME)/.test(code)
  return Object.freeze({
    status: worker ? "WAITING_FOR_WORKER" as const
      : "FAILED_RETRYABLE" as const,
    nextRetryAt: retryAt(now, worker ? 15 * 60_000 : 30 * 60_000),
  })
}

async function insertEvidence(input: Readonly<{
  supabase: SupabaseClient
  evidence: ReturnType<typeof buildEconomicEvidenceV1>
}>) {
  const write = await input.supabase.from("seller_os_live_economic_evidence_v1")
    .upsert(input.evidence, { onConflict: "evidence_id",
      ignoreDuplicates: true }).select("evidence_id").maybeSingle()
  if (write.error) throw new Error("ECONOMIC_EVIDENCE_PERSIST_FAILED")
  const readback = await input.supabase.from(
    "seller_os_live_economic_evidence_v1")
    .select("evidence_id,evidence_digest,freshness_status")
    .eq("evidence_id", input.evidence.evidence_id).maybeSingle()
  if (readback.error || !readback.data ||
      readback.data.evidence_digest !== input.evidence.evidence_digest ||
      readback.data.freshness_status !== input.evidence.freshness_status) {
    throw new Error("ECONOMIC_EVIDENCE_DURABLE_READBACK_FAILED")
  }
  return input.evidence.evidence_id
}

async function finishJob(input: Readonly<{
  supabase: SupabaseClient
  job: JobRow
  workerId: string
  status: "FRESH" | "WAITING_FOR_WORKER" | "SOURCE_UNAVAILABLE" |
    "FAILED_RETRYABLE" | "FAILED_TERMINAL"
  evidenceId: string
  failureClass?: string | null
  nextRetryAt?: string | null
}>) {
  const result = await input.supabase.rpc(
    "finish_seller_os_economic_refresh_job_v1", {
      p_job_id: input.job.job_id,
      p_worker_id: input.workerId,
      p_status: input.status,
      p_last_evidence_id: input.evidenceId,
      p_failure_class: input.failureClass ?? null,
      p_next_retry_at: input.nextRetryAt ?? null,
    })
  if (result.error || result.data !== true) {
    throw new Error("ECONOMIC_REFRESH_JOB_FINISH_FAILED")
  }
}

async function persistOutcome(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  job: JobRow
  workerId: string
  value: number | null
  sourceAuthority: string
  sourceEntityId: string
  status: "FRESH" | "WAITING_FOR_WORKER" | "SOURCE_UNAVAILABLE" |
    "FAILED_RETRYABLE" | "FAILED_TERMINAL"
  limitationCode?: string | null
  nextRetryAt?: string | null
  metadata?: JsonRecord
  now: Date
}>) {
  const evidence = buildEconomicEvidenceV1({
    accountKey: input.accountKey,
    itemId: input.job.ebay_item_id,
    evidenceType: input.job.evidence_type,
    value: input.value,
    sourceAuthority: input.sourceAuthority,
    sourceEntityId: input.sourceEntityId,
    capturedAt: input.now.toISOString(),
    status: input.status,
    limitationCode: input.limitationCode,
    metadata: input.metadata,
  })
  const evidenceId = await insertEvidence({ supabase: input.supabase,
    evidence })
  await finishJob({ supabase: input.supabase, job: input.job,
    workerId: input.workerId, status: input.status, evidenceId,
    failureClass: input.limitationCode,
    nextRetryAt: input.nextRetryAt })
  return evidence
}

async function claim(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  workerId: string
  types: readonly EconomicEvidenceTypeV1[]
  limit: number
}>) {
  const result = await input.supabase.rpc(
    "claim_seller_os_economic_refresh_jobs_v1", {
      p_marketplace_account_key: input.accountKey,
      p_worker_id: input.workerId,
      p_evidence_types: [...input.types],
      p_limit: input.limit,
      p_lease_seconds: 240,
    })
  if (result.error) throw new Error("ECONOMIC_REFRESH_JOB_CLAIM_FAILED")
  return (Array.isArray(result.data) ? result.data : []) as JobRow[]
}

function latestEvidenceMap(rows: readonly JsonRecord[]) {
  const map = new Map<string, LatestEconomicEvidenceV1>()
  for (const row of rows) {
    const key = `${row.ebay_item_id}\n${row.evidence_type}`
    if (!map.has(key)) map.set(key, row as unknown as LatestEconomicEvidenceV1)
  }
  return map
}

export async function readSellerOsEconomicEvidenceRefreshStatusV1(input:
  Readonly<{ supabase: SupabaseClient; accountKey: string; itemIds?:
    readonly string[] }>) {
  let query = input.supabase.from("seller_os_economic_evidence_refresh_jobs_v1")
    .select("job_id,ebay_item_id,evidence_type,status,last_evidence_id,failure_class,next_retry_at,attempt_count,updated_at")
    .eq("marketplace_account_key", input.accountKey)
    .order("ebay_item_id").order("evidence_type")
  if (input.itemIds?.length) query = query.in("ebay_item_id", [...input.itemIds])
  const result = await query.limit(500)
  if (result.error) throw new Error("ECONOMIC_REFRESH_STATUS_READ_FAILED")
  const rows = (result.data ?? []).map((row) => Object.freeze({
    itemId: row.ebay_item_id,
    evidenceType: row.evidence_type,
    status: row.status,
    evidenceId: row.last_evidence_id,
    limitationCode: row.failure_class,
    nextRetryAt: row.next_retry_at,
    attemptCount: row.attempt_count,
    updatedAt: row.updated_at,
  }))
  return Object.freeze({
    contractVersion: SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1,
    rows: Object.freeze(rows),
    summary: Object.freeze(Object.fromEntries([
      "FRESH", "STALE", "MISSING", "WAITING_FOR_WORKER", "REFRESHING",
      "SOURCE_UNAVAILABLE", "FAILED_RETRYABLE", "FAILED_TERMINAL",
    ].map((status) => [status, rows.filter((row) => row.status === status).length]))),
    ownerTechnicalActionRequired: false as const,
    marketplaceWrites: 0 as const,
  })
}

export async function runSellerOsEconomicEvidenceRefreshV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  accountAlias: string | null
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const workerId = `economic-refresh:${randomUUID()}`
  const live = await getEbayCommercialMonitorLiveReadonly({
    accountKey: input.accountKey,
    accountAlias: input.accountAlias,
    readLimits: { maximumCalls: 60, budgetMs: 24_000 },
  })
  if (live.safety.marketplaceWrites !== 0 ||
      live.discovery.status !== "AVAILABLE" ||
      live.discovery.coverage !== "COMPLETE") {
    throw new Error("ECONOMIC_REFRESH_AUTHORITATIVE_LIVE_SCOPE_UNAVAILABLE")
  }
  const listings = live.discovery.currentLiveListings.filter((listing) =>
    listing.listingState === "ACTIVE" &&
    listing.marketplaceCertification.status === "US_CERTIFIED")
  const itemIds = listings.map((listing) => listing.itemId)
  const [evidenceRead, jobsRead, linkageRead] = await Promise.all([
    input.supabase.from("seller_os_live_economic_evidence_v1")
      .select("evidence_id,ebay_item_id,evidence_type,value_amount,fresh_until,freshness_status,captured_at")
      .eq("marketplace_account_key", input.accountKey)
      .in("ebay_item_id", itemIds).order("captured_at", { ascending: false })
      .limit(1_000),
    input.supabase.from("seller_os_economic_evidence_refresh_jobs_v1")
      .select("*").eq("marketplace_account_key", input.accountKey)
      .in("ebay_item_id", itemIds).limit(500),
    input.supabase.from("seller_os_luna_linkage_decisions")
      .select("ebay_item_id,decision,decision_version,linkage_id,luna_product_id,luna_variant_id,luna_sku,evidence_digest")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", itemIds)
      .order("decision_version", { ascending: false }).limit(500),
  ])
  if (evidenceRead.error || jobsRead.error || linkageRead.error) {
    throw new Error("ECONOMIC_REFRESH_DURABLE_AUTHORITY_READ_FAILED")
  }
  const latestEvidence = latestEvidenceMap((evidenceRead.data ?? []).map(record))
  const jobs = new Map((jobsRead.data ?? []).map((row) => [
    `${row.ebay_item_id}\n${row.evidence_type}`, row as JobRow,
  ]))
  const linkages = new Map<string, JsonRecord>()
  for (const value of linkageRead.data ?? []) {
    if (!linkages.has(value.ebay_item_id)) linkages.set(value.ebay_item_id,
      record(value))
  }
  const productIds = [...new Set([...linkages.values()].map((row) =>
    text(row.luna_product_id, 30)).filter((value): value is string =>
      Boolean(value)))]
  const catalogRead = productIds.length
    ? await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,product_url,captured_at")
      .eq("source_key", "lunaportex")
      .in("supplier_product_id", productIds).limit(500)
    : { data: [], error: null }
  if (catalogRead.error) throw new Error("ECONOMIC_REFRESH_LUNA_CATALOG_READ_FAILED")
  const catalog = new Map((catalogRead.data ?? []).map((row) => [
    `${row.supplier_product_id}\n${row.supplier_variant_id}\n${row.sku}`, row,
  ]))
  const detectedRows = listings.flatMap((listing) => {
    const linkage = linkages.get(listing.itemId) ?? {}
    const catalogRow = catalog.get(`${linkage.luna_product_id}\n${linkage.luna_variant_id}\n${linkage.luna_sku}`)
    const sourceIdentity = {
      itemId: listing.itemId,
      sku: listing.sku,
      liveObservedAt: listing.observedAt,
      livePrice: listing.price,
      currency: listing.currency,
      linkageId: linkage.linkage_id ?? null,
      linkageDecision: linkage.decision ?? null,
      lunaProductId: linkage.luna_product_id ?? null,
      lunaVariantId: linkage.luna_variant_id ?? null,
      sourceSku: linkage.luna_sku ?? null,
      productUrl: catalogRow?.product_url ?? null,
    }
    return ECONOMIC_EVIDENCE_TYPES_V1.map((evidenceType) => {
      const key = `${listing.itemId}\n${evidenceType}`
      const prior = jobs.get(key)
      const evidence = latestEvidence.get(key)
      const due = !prior?.next_retry_at ||
        Date.parse(prior.next_retry_at) <= now.getTime()
      const activeLease = prior?.status === "REFRESHING" &&
        Boolean(prior.lease_expires_at) &&
        Date.parse(prior.lease_expires_at as string) > now.getTime()
      const status: EconomicRefreshStatusV1 = evidenceIsFreshV1(evidence,
        now.getTime()) ? "FRESH"
        : prior?.status === "FAILED_TERMINAL" ? "FAILED_TERMINAL"
          : activeLease ? "REFRESHING"
          : prior && !due && ["WAITING_FOR_WORKER", "SOURCE_UNAVAILABLE",
            "FAILED_RETRYABLE"].includes(prior.status) ? prior.status
            : evidence ? "STALE" : "MISSING"
      return {
        idempotency_key: economicRefreshJobKeyV1({
          accountKey: input.accountKey, marketplaceId: "EBAY_US",
          itemId: listing.itemId, evidenceType,
        }),
        marketplace_account_key: input.accountKey,
        marketplace_id: "EBAY_US",
        ebay_item_id: listing.itemId,
        evidence_type: evidenceType,
        source_identity: sourceIdentity,
        status,
        last_evidence_id: evidence?.evidence_id ?? prior?.last_evidence_id ?? null,
        failure_class: status === "FRESH" ? null : prior?.failure_class ?? null,
        next_retry_at: status === "FRESH" ? null : prior?.next_retry_at ?? null,
        attempt_count: prior?.attempt_count ?? 0,
        first_detected_at: prior?.first_detected_at ?? now.toISOString(),
        last_detected_at: now.toISOString(),
        updated_at: now.toISOString(),
      }
    })
  })
  const jobWrite = await input.supabase.from(
    "seller_os_economic_evidence_refresh_jobs_v1")
    .upsert(detectedRows, { onConflict: "idempotency_key" })
  if (jobWrite.error) throw new Error("ECONOMIC_REFRESH_JOB_RECONCILE_FAILED")

  const sourceResults: JsonRecord[] = []
  const processFailure = async (job: JobRow, error: unknown) => {
    const failureClass = safeCode(error)
    const retry = sourceStatusForError(error, now)
    await persistOutcome({ supabase: input.supabase, accountKey: input.accountKey,
      job, workerId, value: null, sourceAuthority:
        "SELLER_OS_ECONOMIC_EVIDENCE_SOURCE_RUNTIME",
      sourceEntityId: job.ebay_item_id, status: retry.status,
      limitationCode: failureClass, nextRetryAt: retry.nextRetryAt, now })
    sourceResults.push({ itemId: job.ebay_item_id,
      evidenceType: job.evidence_type, status: retry.status,
      limitationCode: failureClass })
  }

  for (const job of await claim({ supabase: input.supabase,
    accountKey: input.accountKey, workerId, types: ["EBAY_LIVE_PRICE"],
    limit: 100 })) {
    const listing = listings.find((row) => row.itemId === job.ebay_item_id)
    try {
      const price = money(listing?.price)
      if (!listing || price === null || listing.currency !== "USD") {
        throw new Error("OFFICIAL_EBAY_LIVE_PRICE_UNPROVEN")
      }
      await persistOutcome({ supabase: input.supabase,
        accountKey: input.accountKey, job, workerId, value: price,
        sourceAuthority: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        sourceEntityId: listing.itemId, status: "FRESH", now,
        metadata: { currency: listing.currency,
          officialObservedAt: listing.observedAt,
          marketplaceCertification: listing.marketplaceCertification.status } })
      sourceResults.push({ itemId: job.ebay_item_id,
        evidenceType: job.evidence_type, status: "FRESH" })
    } catch (error) { await processFailure(job, error) }
  }

  for (const job of await claim({ supabase: input.supabase,
    accountKey: input.accountKey, workerId, types: ["LUNA_CURRENT_COST"],
    limit: 4 })) {
    try {
      const identity = record(job.source_identity)
      const productUrl = text(identity.productUrl, 2_000)
      const productId = text(identity.lunaProductId, 30)
      const variantId = text(identity.lunaVariantId, 30)
      const sourceSku = text(identity.sourceSku, 160)
      if (identity.linkageDecision !== "APPROVE_EXACT_LINKAGE" || !productUrl ||
          !productId || !variantId || !sourceSku) {
        const evidence = await persistOutcome({ supabase: input.supabase,
          accountKey: input.accountKey, job, workerId, value: null,
          sourceAuthority: "SELLER_OS_LUNA_LINKAGE_DECISION_V1",
          sourceEntityId: job.ebay_item_id, status: "SOURCE_UNAVAILABLE",
          limitationCode: "CERTIFIED_EXACT_LUNA_LINKAGE_UNAVAILABLE",
          nextRetryAt: retryAt(now, 24 * 60 * 60_000), now })
        sourceResults.push({ itemId: job.ebay_item_id,
          evidenceType: job.evidence_type, status: evidence.freshness_status })
        continue
      }
      const product = await fetchPublicLunaProductForActiveListingMonitor(
        productUrl, { maxAttempts: 2 })
      const exact = product.productId === productId
        ? product.variants.filter((variant) => variant.id === variantId &&
          variant.sku === sourceSku) : []
      if (exact.length !== 1) throw new Error("LUNA_EXACT_VARIANT_MISMATCH")
      await persistOutcome({ supabase: input.supabase,
        accountKey: input.accountKey, job, workerId,
        value: exact[0].sourceUnitPrice,
        sourceAuthority: "LUNA_PUBLIC_EXACT_PRODUCT_VARIANT_READ_V1",
        sourceEntityId: `${productId}:${variantId}:${sourceSku}`,
        status: "FRESH", now,
        metadata: { parserVersion: product.sourceParserVersion ?? null,
          sourceMode: product.sourceMode ?? null, canonicalUrl: product.canonicalUrl } })
      sourceResults.push({ itemId: job.ebay_item_id,
        evidenceType: job.evidence_type, status: "FRESH" })
    } catch (error) { await processFailure(job, error) }
  }

  for (const job of await claim({ supabase: input.supabase,
    accountKey: input.accountKey, workerId, types: ["LUNA_CURRENT_SHIPPING"],
    limit: 2 })) {
    try {
      const identity = record(job.source_identity)
      const target = {
        accountKey: input.accountKey, marketplaceId: "EBAY_US" as const,
        ebayItemId: job.ebay_item_id,
        lunaProductId: text(identity.lunaProductId, 30) ?? "",
        lunaVariantId: text(identity.lunaVariantId, 30) ?? "",
        sourceSku: text(identity.sourceSku, 160) ?? "",
      }
      const captured = await captureLiveListingShippingEvidenceV1({
        supabase: input.supabase, target, now: now.getTime(),
      })
      await persistOutcome({ supabase: input.supabase,
        accountKey: input.accountKey, job, workerId,
        value: captured.shippingCost,
        sourceAuthority: captured.acquisitionMethod,
        sourceEntityId: captured.evidenceId, status: "FRESH", now,
        metadata: { destinationFingerprint: captured.destinationFingerprint,
          supplierSubtotal: captured.supplierSubtotal,
          purchaseBoundaryEnforced: captured.purchaseBoundaryEnforced } })
      sourceResults.push({ itemId: job.ebay_item_id,
        evidenceType: job.evidence_type, status: "FRESH" })
    } catch (error) { await processFailure(job, error) }
  }

  const feeJobs = await claim({ supabase: input.supabase,
    accountKey: input.accountKey, workerId, types: ["EXPECTED_EBAY_FEE"],
    limit: 2 })
  let subscription: Awaited<ReturnType<
    typeof readEbaySellerStoreSubscriptionReadonly>> | null = null
  let subscriptionError: unknown = null
  if (feeJobs.length) {
    try { subscription = await readEbaySellerStoreSubscriptionReadonly() }
    catch (error) { subscriptionError = error }
  }
  for (const job of feeJobs) {
    try {
      if (!subscription) throw subscriptionError ??
        new Error("EBAY_STORE_SUBSCRIPTION_UNPROVEN")
      const listing = await readManualListingFromTradingApi(job.ebay_item_id)
      const livePrice = money(listing.price)
      const buyerShipping = money(listing.buyerShippingCharge)
      const categoryId = text(listing.safeDefaults.categoryId, 20) ?? ""
      const policy = resolveOfficialPreSaleFeePolicyV1({ categoryId,
        storeSubscriptionLevel: subscription.storeSubscriptionLevel ?? "",
        orderSubtotalUsd: livePrice ?? 0 })
      if (policy.status !== "AVAILABLE" || livePrice === null ||
          listing.buyerShippingChargeStatus !== "AVAILABLE" ||
          buyerShipping === null) {
        const limitation = policy.status === "AVAILABLE"
          ? "EXPECTED_EBAY_FEE_BASIS_UNPROVEN" : policy.limitationCode
        await persistOutcome({ supabase: input.supabase,
          accountKey: input.accountKey, job, workerId, value: null,
          sourceAuthority: policy.status === "AVAILABLE" ? policy.authority :
            "EBAY_OFFICIAL_CATEGORY_FEE_POLICY_RESOLVER_V1",
          sourceEntityId: `${job.ebay_item_id}:${categoryId || "UNKNOWN"}`,
          status: "SOURCE_UNAVAILABLE", limitationCode: limitation,
          nextRetryAt: retryAt(now, 24 * 60 * 60_000), now,
          metadata: { categoryId: categoryId || null,
            storeSubscriptionLevel: subscription.storeSubscriptionLevel ?? null,
            confidence: "UNPROVEN" } })
        sourceResults.push({ itemId: job.ebay_item_id,
          evidenceType: job.evidence_type, status: "SOURCE_UNAVAILABLE",
          limitationCode: limitation })
        continue
      }
      const amount = Number(((livePrice + buyerShipping) *
        policy.finalValueFeeRatePercent / 100 + policy.perOrderFixedFeeUsd)
        .toFixed(4))
      await persistOutcome({ supabase: input.supabase,
        accountKey: input.accountKey, job, workerId, value: amount,
        sourceAuthority: policy.authority,
        sourceEntityId: `${job.ebay_item_id}:${categoryId}`,
        status: "FRESH", now,
        metadata: { categoryId,
          effectiveRatePercent: policy.finalValueFeeRatePercent,
          fixedFeeUsd: policy.perOrderFixedFeeUsd,
          feeModelVersion: "EBAY_OFFICIAL_EXPECTED_BASE_SELLING_FEE_V1",
          feeConfidence: "PROVEN_RATE_PRE_SALE_MODEL",
          realizedFee: false } })
      sourceResults.push({ itemId: job.ebay_item_id,
        evidenceType: job.evidence_type, status: "FRESH" })
    } catch (error) { await processFailure(job, error) }
  }

  for (const job of await claim({ supabase: input.supabase,
    accountKey: input.accountKey, workerId,
    types: ["OTHER_EXPLICIT_COSTS"], limit: 100 })) {
    await persistOutcome({ supabase: input.supabase,
      accountKey: input.accountKey, job, workerId, value: null,
      sourceAuthority: "SELLER_OS_EXPLICIT_COST_COMPONENT_REGISTRY",
      sourceEntityId: job.ebay_item_id, status: "SOURCE_UNAVAILABLE",
      limitationCode: "EXPLICIT_OTHER_COST_AUTHORITY_NOT_CONFIGURED",
      nextRetryAt: retryAt(now, 24 * 60 * 60_000), now,
      metadata: { hiddenGenericReserveUsed: false,
        authoritativeZeroClaimed: false } })
    sourceResults.push({ itemId: job.ebay_item_id,
      evidenceType: job.evidence_type, status: "SOURCE_UNAVAILABLE" })
  }

  const finalEvidenceRead = await input.supabase.from(
    "seller_os_live_economic_evidence_v1")
    .select("evidence_id,ebay_item_id,evidence_type,value_amount,fresh_until,freshness_status,captured_at")
    .eq("marketplace_account_key", input.accountKey)
    .in("ebay_item_id", itemIds).order("captured_at", { ascending: false })
    .limit(1_000)
  if (finalEvidenceRead.error) {
    throw new Error("ECONOMIC_REFRESH_FINAL_EVIDENCE_READ_FAILED")
  }
  const finalEvidence = latestEvidenceMap(
    (finalEvidenceRead.data ?? []).map(record))
  const calculations = listings.map((listing) => calculateLiveEconomicsV1({
    accountKey: input.accountKey, itemId: listing.itemId,
    calculatedAt: now.toISOString(),
    evidence: Object.fromEntries(ECONOMIC_EVIDENCE_TYPES_V1.map((type) =>
      [type, finalEvidence.get(`${listing.itemId}\n${type}`) ?? null])),
  }))
  const calculationWrite = await input.supabase.from(
    "seller_os_live_economics_readbacks_v1")
    .upsert(calculations, { onConflict: "readback_id",
      ignoreDuplicates: true })
  if (calculationWrite.error) {
    throw new Error("ECONOMIC_REFRESH_CALCULATION_PERSIST_FAILED")
  }
  const status = await readSellerOsEconomicEvidenceRefreshStatusV1({
    supabase: input.supabase, accountKey: input.accountKey, itemIds,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1,
    authoritativeLiveScopeCount: listings.length,
    currentLiveScopeSource: live.discovery.source,
    automaticStalenessDetection: true as const,
    durableRefreshJobs: true as const,
    automaticWorkerClaim: true as const,
    automaticRecomputation: true as const,
    selfRecovery: true as const,
    processed: Object.freeze(sourceResults),
    evidenceStatus: status.summary,
    provenEconomicsCount: calculations.filter((row) =>
      row.status === "PROVEN").length,
    partialEconomicsCount: calculations.filter((row) =>
      row.status === "PARTIAL").length,
    unprovenEconomicsCount: calculations.filter((row) =>
      row.status === "UNPROVEN").length,
    ownerTechnicalActionRequired: false as const,
    codexListingPatchCount: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
