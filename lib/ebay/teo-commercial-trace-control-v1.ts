import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  readCanonicalTraceProductTruthV1,
  readSellerOsLiveCommercialTraceV1,
  runSellerOsLiveCommercialTraceV1,
  SELLER_OS_LIVE_COMMERCIAL_TRACE_V1,
} from "./seller-os-live-commercial-trace-v1"
import type { TeoPreResearchCommandPrincipalV1 } from
  "./teo-pre-research-control-plane-v1"
import { readCommercialTraceShippingReceiptV1 } from
  "./ebay-luna-chrome-shipping-capture-server-v1"
import { enqueueCommercialTracePricingEnrichmentV1,
  readCommercialTracePricingEvidenceV1 } from
  "./seller-os-commercial-trace-pricing-enrichment-v1"

export const TEO_COMMERCIAL_TRACE_CAPABILITY_V1 =
  "TEO_COMMERCIAL_TRACE_V1" as const
export const TEO_COMMERCIAL_TRACE_CONTRACT_V1 =
  SELLER_OS_LIVE_COMMERCIAL_TRACE_V1

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const candidate = text(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(candidate) ? candidate : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function rpcRow(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value)
}

export function decideTeoCommercialTracePricingReplayV1(
  receipt: Readonly<{ refreshEligible: boolean }> | null,
) {
  if (!receipt) return "DISPATCH_INITIAL" as const
  return receipt.refreshEligible
    ? "DISPATCH_REFRESH" as const
    : "REEVALUATE_TRACE" as const
}

export class TeoCommercialTraceControlErrorV1 extends Error {
  readonly code: string

  constructor(code: string) {
    super(/^[A-Z0-9_]{3,180}$/.test(code)
      ? code : "TEO_COMMERCIAL_TRACE_CONTROL_FAILED_CLOSED")
    this.name = "TeoCommercialTraceControlErrorV1"
    this.code = this.message
  }
}

function fail(code: string): never {
  throw new TeoCommercialTraceControlErrorV1(code)
}

export function parseTeoCommercialTraceRequestV1(value: unknown) {
  const body = record(value)
  const expected = ["clientIdempotencyKey", "productId", "sku", "variantId"]
  if (Object.keys(body).sort().join(",") !== expected.join(",") ||
      !/^\d{1,30}$/.test(text(body.productId, 40)) ||
      !/^\d{1,30}$/.test(text(body.variantId, 40)) ||
      !/^[^\u0000\r\n]{1,160}$/.test(text(body.sku, 160)) ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(
        text(body.clientIdempotencyKey, 180))) {
    fail("TEO_COMMERCIAL_TRACE_REQUEST_INVALID")
  }
  return Object.freeze({ productId: text(body.productId, 40),
    variantId: text(body.variantId, 40), sku: text(body.sku, 160),
    clientIdempotencyKey: text(body.clientIdempotencyKey, 180) })
}

export function parseTeoCommercialTraceGetV1(value: unknown) {
  const body = record(value)
  if (Object.keys(body).join(",") !== "traceId" || !uuid(body.traceId)) {
    fail("TEO_COMMERCIAL_TRACE_ID_INVALID")
  }
  return Object.freeze({ traceId: uuid(body.traceId)! })
}

async function requireCapability(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  oauthResource: string
  principal: TeoPreResearchCommandPrincipalV1
}>) {
  const read = await input.supabase.from(
    "seller_os_commercial_trace_command_capabilities_v1")
    .select("capability_id,allowed_contract_version,enabled,expires_at")
    .eq("capability_code", TEO_COMMERCIAL_TRACE_CAPABILITY_V1)
    .eq("marketplace_account_key", input.accountKey)
    .eq("owner_user_id", input.principal.ownerUserId)
    .eq("command_client_id", input.principal.commandClientId)
    .eq("oauth_resource", input.oauthResource).eq("enabled", true)
    .limit(1).maybeSingle()
  if (read.error || !read.data || read.data.allowed_contract_version !==
      TEO_COMMERCIAL_TRACE_CONTRACT_V1 ||
      (read.data.expires_at && Date.parse(read.data.expires_at) <= Date.now())) {
    fail("TEO_COMMERCIAL_TRACE_CAPABILITY_DENIED")
  }
  return read.data
}

async function resolveCanonicalProduct(input: Readonly<{
  supabase: SupabaseClient
  productId: string
  variantId: string
  sku: string
}>) {
  const latest = await input.supabase.from("luna_catalog_snapshots_v1")
    .select("snapshot_id").eq("snapshot_status", "COMPLETE")
    .order("snapshot_completed_at", { ascending: false }).limit(1).maybeSingle()
  if (latest.error || !latest.data || !uuid(latest.data.snapshot_id)) {
    fail("TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED")
  }
  const snapshotId = uuid(latest.data.snapshot_id)!
  const variants = await input.supabase.from("luna_catalog_snapshot_variants_v1")
    .select("snapshot_id,product_id,variant_id,sku,canonical_url,source_fingerprint,field_truth_v1")
    .eq("snapshot_id", snapshotId).eq("product_id", input.productId)
    .eq("variant_id", input.variantId).eq("sku", input.sku).limit(2)
  if (variants.error || variants.data?.length !== 1) {
    fail("TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED")
  }
  const row = record(variants.data[0])
  const canonicalUrl = text(row.canonical_url, 2_000)
  const sourceFingerprint = text(row.source_fingerprint, 100)
  if (!/^https:\/\/(?:www\.)?lunaportex\.com\/products\/[^/?#]+$/.test(
    canonicalUrl) || !/^sha256:[0-9a-f]{64}$/.test(sourceFingerprint)) {
    fail("TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED")
  }
  const canonical = await readCanonicalTraceProductTruthV1({
    supabase: input.supabase, canonicalUrl })
  if (String(canonical.row.product_id) !== input.productId ||
      String(canonical.row.variant_id) !== input.variantId ||
      String(canonical.row.sku) !== input.sku ||
      canonical.snapshotId !== snapshotId ||
      canonical.gate.traceProductTruthSufficient !== true ||
      !canonical.gate.receiptEvidenceDigest) {
    fail("TEO_COMMERCIAL_TRACE_PRODUCT_TRUTH_DENIED")
  }
  return Object.freeze({ snapshotId, canonicalUrl, sourceFingerprint,
    fieldTruthEvidenceDigest: canonical.gate.receiptEvidenceDigest })
}

function safeFailureCode(cause: unknown) {
  const code = cause instanceof Error ? cause.message : ""
  return /^[A-Z0-9_]{3,120}$/.test(code)
    ? code : "TEO_COMMERCIAL_TRACE_EXECUTION_FAILED"
}

function boundedTraceReadback(value: Awaited<ReturnType<
  typeof readSellerOsLiveCommercialTraceV1>>) {
  if (!value) fail("TEO_COMMERCIAL_TRACE_NOT_FOUND")
  const trace = record(value.trace)
  const result = record(trace.result)
  const decisionLoop = record(result.DECISION_LOOP)
  const productTruth = record(result.PRODUCT_TRUTH)
  const fieldTruth = record(productTruth.fieldTruthV1)
  const economics = record(result.ECONOMICS)
  const shippingAuthority = record(result.SHIPPING_AUTHORITY)
  const shippingFreshUntil = text(shippingAuthority.freshUntil, 80)
  const shippingStatus = shippingAuthority.status === "PROVEN" &&
    (!shippingFreshUntil || !Number.isFinite(Date.parse(shippingFreshUntil)) ||
      Date.parse(shippingFreshUntil) <= Date.now())
    ? "STALE" : text(shippingAuthority.status, 20) || "MISSING"
  const feeAuthority = record(result.FEE_AUTHORITY)
  const economicsAuthority = record(result.ECONOMICS_AUTHORITY)
  const finalAuthorizedPrice = typeof result.FINAL_AUTHORIZED_PRICE === "number" &&
    Number.isFinite(result.FINAL_AUTHORIZED_PRICE) &&
    result.FINAL_AUTHORIZED_PRICE > 0 ? result.FINAL_AUTHORIZED_PRICE : null
  const priceAuthorized = result.PRICE_AUTHORIZED === true &&
    shippingStatus === "PROVEN" && feeAuthority.status === "PROVEN" &&
    economicsAuthority.status === "PROVEN" &&
    finalAuthorizedPrice !== null
  const promotedListingsAuthority = record(result.PROMOTED_LISTINGS_AUTHORITY)
  const returnsReserveAuthority = record(result.RETURNS_RESERVE_AUTHORITY)
  const fulfillmentCostAuthority = record(result.FULFILLMENT_COST_AUTHORITY)
  const pricing = record(result.PRICING_AUTHORITY)
  const safety = record(trace.safety)
  return Object.freeze({
    traceId: uuid(trace.trace_id),
    status: text(trace.state, 40),
    currentStage: text(trace.current_stage, 80),
    decision: text(result.FINAL_DECISION, 120) || null,
    blockers: Array.isArray(decisionLoop.blockers)
      ? decisionLoop.blockers.slice(0, 30).map((item) => text(item, 180)) : [],
    receipt: fieldTruth.evidenceDigest ? Object.freeze({
      contractVersion: text(fieldTruth.contractVersion, 120),
      evidenceDigest: text(fieldTruth.evidenceDigest, 100),
      sourceSnapshotId: text(fieldTruth.sourceSnapshotId, 80),
      sourceProductId: text(fieldTruth.sourceProductId, 40),
      sourceVariantId: text(fieldTruth.sourceVariantId, 40),
      sourceSupplierSku: text(fieldTruth.sourceSupplierSku, 160),
    }) : null,
    economics: Object.keys(economics).length ? Object.freeze({
      estimatedNetProfit: economics.estimatedNetProfit ?? null,
      estimatedNetMarginPercent: economics.estimatedNetMarginPercent ?? null,
      passesProfitGate: economics.passesProfitGate === true,
      authority: "ESTIMATED_ADVISORY",
    }) : null,
    finalEconomics: Object.freeze({
      status: text(economicsAuthority.status, 30) || "INCOMPLETE",
      productCostAuthority: record(economicsAuthority.productCost),
      shippingQty1Authority: record(economicsAuthority.shippingQty1),
      ownerPolicyAuthority: record(economicsAuthority.ownerPolicyAuthority),
      feeIntervalAuthority:
        record(economicsAuthority.economicFloorFeeIntervalAuthority),
      values: Object.keys(record(economicsAuthority.economics)).length
        ? record(economicsAuthority.economics) : null,
      economicFloor: economicsAuthority.economicFloor ?? null,
      marketSupportedTargetPrice:
        economicsAuthority.marketSupportedTargetPrice ?? null,
      profitabilityGate: record(economicsAuthority.profitabilityGate),
      marketPricingAuthority: record(economicsAuthority.marketPricingAuthority),
      roiBasis: text(economicsAuthority.roiBasis, 40),
      formula: text(economicsAuthority.formula, 300),
    }),
    shippingAuthority: Object.freeze({
      status: shippingStatus,
      amountUsd: shippingStatus === "PROVEN"
        ? shippingAuthority.amountUsd : null,
      durableReceiptId: text(shippingAuthority.durableReceiptId, 80) || null,
      source: text(shippingAuthority.source, 80),
      evidenceDigest: text(shippingAuthority.evidenceDigest, 100),
      observedAt: text(shippingAuthority.observedAt, 80) || null,
      freshUntil: shippingFreshUntil || null,
      shippingServiceStatus:
        text(shippingAuthority.shippingServiceStatus, 20) || "UNKNOWN",
    }),
    feeAuthority: Object.freeze({
      status: text(feeAuthority.status, 20) || "MISSING",
      readReason: text(result.FEE_AUTHORITY_READ_REASON, 120),
      calculatedFee: feeAuthority.status === "PROVEN"
        ? feeAuthority.calculatedFee : null,
      source: text(feeAuthority.source, 200),
      sourceVersion: text(feeAuthority.sourceVersion, 100),
      observedAt: text(feeAuthority.observedAt, 80),
      freshUntil: text(feeAuthority.freshUntil, 80),
      ebayVariableFee: feeAuthority.status === "PROVEN"
        ? feeAuthority.ebayVariableFee : null,
      ebayFixedFee: feeAuthority.status === "PROVEN"
        ? feeAuthority.ebayFixedFee : null,
      otherSellerFees: feeAuthority.status === "PROVEN"
        ? feeAuthority.otherSellerFees : null,
    }),
    ownerPricePolicyAuthority: record(result.OWNER_PRICE_POLICY_AUTHORITY),
    promotedListingsAuthority: Object.freeze({
      status: text(promotedListingsAuthority.state, 20) || "UNKNOWN",
      amountUsd: promotedListingsAuthority.amountUsd ?? null,
      policyVersion: text(promotedListingsAuthority.policyVersion, 80),
      source: text(promotedListingsAuthority.source, 100) }),
    returnsReserveAuthority: Object.freeze({
      status: text(returnsReserveAuthority.state, 20) || "UNKNOWN",
      amountUsd: returnsReserveAuthority.amountUsd ?? null,
      policyVersion: text(returnsReserveAuthority.policyVersion, 80),
      source: text(returnsReserveAuthority.source, 100) }),
    otherExplicitCostsAuthority: Object.freeze({
      status: text(record(result.OTHER_EXPLICIT_COSTS_AUTHORITY).state, 20)
        || "UNKNOWN",
      amountUsd: record(result.OTHER_EXPLICIT_COSTS_AUTHORITY).amountUsd
        ?? null }),
    fulfillmentCostAuthority: Object.freeze({
      status: text(fulfillmentCostAuthority.status, 20) || "UNKNOWN",
      restrictionStatus: text(fulfillmentCostAuthority.restrictionStatus, 20)
        || "UNKNOWN",
      allowedCarrier: text(fulfillmentCostAuthority.allowedCarrier, 60),
      allowedService: text(fulfillmentCostAuthority.allowedService, 80),
      amountUsd: fulfillmentCostAuthority.amountUsd ?? null,
      restrictionSource:
        text(fulfillmentCostAuthority.restrictionSource, 100),
      restrictionEvidenceDigest:
        text(fulfillmentCostAuthority.restrictionEvidenceDigest, 100),
      serviceCostSource:
        text(fulfillmentCostAuthority.serviceCostSource, 100),
      observedAt: text(fulfillmentCostAuthority.observedAt, 80),
      freshUntil: text(fulfillmentCostAuthority.freshUntil, 80) }),
    priceAuthorized,
    finalAuthorizedPrice: priceAuthorized
      ? finalAuthorizedPrice : null,
    priceAuthorizationBlockers: Array.isArray(result.PRICE_AUTHORIZATION_BLOCKERS)
      ? result.PRICE_AUTHORIZATION_BLOCKERS.slice(0, 12)
        .map((item) => text(item, 120)) : [],
    pricingAuthority: Object.keys(pricing).length ? Object.freeze({
      sufficient: pricing.sufficient === true,
      pricingMode: text(pricing.pricingMode, 80),
      pricingConfidence: text(pricing.pricingConfidence, 20),
      realizedSoldPriceStatus: text(pricing.realizedSoldPriceStatus, 40),
      aggregateSoldPricingStatus: text(pricing.aggregateSoldPricingStatus, 40),
      activeMarketPriceStatus: text(pricing.activeMarketPriceStatus, 40),
      demandStatus: text(pricing.demandStatus, 40),
      targetPrice: pricing.targetPrice ?? null,
      economicFloor: pricing.economicFloor ?? null,
      postSalePriceReviewRequired: pricing.postSalePriceReviewRequired === true,
    }) : null,
    readiness: Object.freeze({ state: text(decisionLoop.state, 120) || null,
      listingPackageReady: decisionLoop.state === "LISTING_PACKAGE_READY" }),
    startedAt: text(trace.started_at, 80),
    completedAt: text(trace.completed_at, 80) || null,
    safety: Object.freeze({ publicationWrites: Number(safety.publicationWrites ?? 0),
      marketplaceWrites: Number(safety.ebayWrites ?? 0) }),
  })
}

export async function requestTeoCommercialTraceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  oauthResource: string
  principal: TeoPreResearchCommandPrincipalV1
  productId: string
  variantId: string
  sku: string
  clientIdempotencyKey: string
}>) {
  await requireCapability(input)
  const canonical = await resolveCanonicalProduct(input)
  const requestDigest = digest({ contractVersion:
    TEO_COMMERCIAL_TRACE_CONTRACT_V1, snapshotId: canonical.snapshotId,
  productId: input.productId, variantId: input.variantId, sku: input.sku,
  sourceFingerprint: canonical.sourceFingerprint,
  fieldTruthEvidenceDigest: canonical.fieldTruthEvidenceDigest })
  const requested = await input.supabase.rpc(
    "request_seller_os_commercial_trace_v1", {
      p_marketplace_account_key: input.accountKey,
      p_owner_user_id: input.principal.ownerUserId,
      p_command_client_id: input.principal.commandClientId,
      p_oauth_resource: input.oauthResource,
      p_client_idempotency_key: input.clientIdempotencyKey,
      p_contract_version: TEO_COMMERCIAL_TRACE_CONTRACT_V1,
      p_source_snapshot_id: canonical.snapshotId,
      p_luna_product_id: input.productId,
      p_luna_variant_id: input.variantId,
      p_supplier_sku: input.sku,
      p_canonical_url: canonical.canonicalUrl,
      p_source_fingerprint: canonical.sourceFingerprint,
      p_field_truth_evidence_digest: canonical.fieldTruthEvidenceDigest,
      p_request_digest: requestDigest,
    })
  if (requested.error) fail("TEO_COMMERCIAL_TRACE_REQUEST_PERSIST_FAILED")
  const row = rpcRow(requested.data)
  const traceId = uuid(row.traceId)
  if (!traceId || typeof row.created !== "boolean") {
    fail("TEO_COMMERCIAL_TRACE_REQUEST_READBACK_FAILED")
  }
  if (row.created) {
    try {
      await runSellerOsLiveCommercialTraceV1({ supabase: input.supabase,
        accountKey: input.accountKey, productUrl: canonical.canonicalUrl,
        actorUserId: input.principal.ownerUserId,
        preauthorizedTraceId: traceId })
    } catch (cause) {
      try {
        await input.supabase.rpc("fail_seller_os_commercial_trace_request_v1", {
          p_trace_id: traceId, p_owner_user_id: input.principal.ownerUserId,
          p_command_client_id: input.principal.commandClientId,
          p_failure_code: safeFailureCode(cause),
        })
      } catch { /* The public request still fails closed. */ }
      fail("TEO_COMMERCIAL_TRACE_EXECUTION_FAILED")
    }
  } else {
    const existing = await readSellerOsLiveCommercialTraceV1({
      supabase: input.supabase, traceId })
    const trace = record(existing?.trace)
    const result = record(trace.result)
    if (trace.state === "COMPLETED" &&
        result.FINAL_DECISION === "HOLD_SHIPPING_UNPROVEN") {
      const shippingReceipt = await readCommercialTraceShippingReceiptV1({
        supabase: input.supabase, accountKey: input.accountKey, traceId,
        lunaProductId: input.productId, lunaVariantId: input.variantId,
        supplierSku: input.sku,
        sourceFingerprint: canonical.sourceFingerprint,
        fieldTruthEvidenceDigest: canonical.fieldTruthEvidenceDigest,
      })
      if (shippingReceipt) {
        try {
          await runSellerOsLiveCommercialTraceV1({ supabase: input.supabase,
            accountKey: input.accountKey, productUrl: canonical.canonicalUrl,
            actorUserId: input.principal.ownerUserId,
            preauthorizedTraceId: traceId,
            continuationReason: "EXACT_IDEMPOTENT_REPLAY_AFTER_SHIPPING" })
        } catch {
          fail("TEO_COMMERCIAL_TRACE_EXECUTION_FAILED")
        }
      }
    } else if (trace.state === "COMPLETED" &&
        result.FINAL_DECISION === "HOLD_PRICING_EVIDENCE_QUALITY") {
      const pricingReceipt = await readCommercialTracePricingEvidenceV1({
        supabase: input.supabase, accountKey: input.accountKey, traceId,
        productId: input.productId, variantId: input.variantId,
        supplierSku: input.sku,
        sourceFingerprint: canonical.sourceFingerprint,
      })
      const pricingReplayAction = decideTeoCommercialTracePricingReplayV1(
        pricingReceipt)
      if (pricingReplayAction === "REEVALUATE_TRACE") {
        try {
          await runSellerOsLiveCommercialTraceV1({ supabase: input.supabase,
            accountKey: input.accountKey, productUrl: canonical.canonicalUrl,
            actorUserId: input.principal.ownerUserId,
            preauthorizedTraceId: traceId,
            continuationReason:
              "EXACT_IDEMPOTENT_REPLAY_AFTER_PRICING_ENRICHMENT" })
        } catch {
          fail("TEO_COMMERCIAL_TRACE_EXECUTION_FAILED")
        }
      } else {
        // A refresh generation must be admitted while the durable Trace still
        // proves COMPLETED/HOLD_PRICING_EVIDENCE_QUALITY. Reopening the Trace
        // first would intentionally fail the enqueue RPC's state binding.
        const productTruth = record(result.PRODUCT_TRUTH)
        try {
          await enqueueCommercialTracePricingEnrichmentV1({
            supabase: input.supabase, traceId, accountKey: input.accountKey,
            productId: input.productId, variantId: input.variantId,
            supplierSku: input.sku, canonicalUrl: canonical.canonicalUrl,
            sourceFingerprint: canonical.sourceFingerprint,
            exactProductTitle: text(productTruth.title, 300),
            market: { acceptedComparables: result.ACCEPTED_COMPARABLES,
              nearExactSoldEnrichment:
                result.NEAR_EXACT_SOLD_ENRICHMENT },
          })
        } catch {
          fail("TEO_COMMERCIAL_TRACE_EXECUTION_FAILED")
        }
      }
    }
  }
  return getTeoCommercialTraceV1({ ...input, traceId })
}

export async function getTeoCommercialTraceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  oauthResource: string
  principal: TeoPreResearchCommandPrincipalV1
  traceId: string
}>) {
  const capability = await requireCapability(input)
  const owned = await input.supabase.from(
    "seller_os_commercial_trace_command_requests_v1")
    .select("trace_id").eq("trace_id", input.traceId)
    .eq("capability_id", capability.capability_id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("owner_user_id", input.principal.ownerUserId)
    .eq("command_client_id", input.principal.commandClientId)
    .eq("oauth_resource", input.oauthResource).limit(1).maybeSingle()
  if (owned.error || !owned.data) fail("TEO_COMMERCIAL_TRACE_NOT_FOUND")
  return boundedTraceReadback(await readSellerOsLiveCommercialTraceV1({
    supabase: input.supabase, traceId: input.traceId }))
}
