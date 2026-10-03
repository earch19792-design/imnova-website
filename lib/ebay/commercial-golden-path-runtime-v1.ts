import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { GOLDEN_PATH_V1, evaluateGoldenCandidateV1, prepareGoldenDraftV1, goldenArray, goldenRecord, goldenNumber, goldenDigest, goldenComparableIdentity, classifyGoldenComparable, verifiedGoldenFields, goldenCategoryDiscoveryMatchesV1,
  type GoldenCandidateKey, type GoldenMarketEvidence, type GoldenAuthority, type GoldenRecord } from "./commercial-golden-path-domain-v1"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { getEbayOfficialLiveListingSweepReadonly } from "./ebay-commercial-monitor-live-readonly"
import { readManualListingFromTradingApi } from "./ebay-manual-listing-trading-readonly"
import { resolveCommercialTraceOwnerPricePolicyV1 } from "./commercial-trace-owner-price-policy-v1"
import { readCommercialTraceShippingReceiptV1 } from "./ebay-luna-chrome-shipping-capture-server-v1"
import { attemptLunaAuthenticatedHttpShippingQuoteV1 } from "./ebay-luna-authoritative-shipping-server-v1"
import { readProductionStockGuardV1 } from "./ebay-production-stock-read-service-v1"
import { projectGoldenMonitoringV1 } from "./commercial-golden-path-monitoring-v1"
import { readGoldenTrafficWindowsV1 } from "./commercial-golden-path-traffic-v1"
import { readGoldenPresaleAuthorityV1 } from "./commercial-golden-path-presale-authority-v1"
import { goldenLiveCohortIdentityDigestV1, buildGoldenLiveComparisonReviewV1, applyGoldenLiveComparisonReviewsV1, type GoldenLiveComparisonInput } from "./commercial-golden-path-live-comparison-v1"
import { buildGoldenOwnerFeePolicyV1, readGoldenOwnerFeePolicyFromReceiptV1, type GoldenOwnerFeePolicyInput } from "./commercial-golden-path-owner-fee-policy-v1"
import { buildGoldenOwnerProductTruthEvidenceV1, isGoldenOwnerProductTruthEvidenceV1,
  type GoldenOwnerProductTruthObservationV1, type GoldenOwnerProductTruthSourceV1 } from "./commercial-golden-path-owner-product-truth-v1"
import { buildGoldenVisualComparisonEvidenceV1, isGoldenVisualComparisonEvidenceV1,
  type GoldenVisualRelationV1, type GoldenVisualSourceObservationV1 } from "./commercial-golden-path-visual-comparison-v1"
import { readEbayFeeHandoffV1 } from "../seller-os/ebay-fee-runtime-v1"
import { readEbayListingCategoryAuthorityV1 } from "./ebay-listing-category-authority-v1"
import { getEbayTaxonomyListingIntelligence } from "./ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from "./ebay-draft-only-gateway"
import { getSupabaseAdminClient } from "../supabase-admin"
import type { SellerOsControlPrincipalV1 } from "./teo-pre-research-control-oauth-v1"

const MAX_CANDIDATES = 20, MAX_SOURCE_ROWS = 100, MAX_MARKET_ROWS = 200
const unavailable = (reasonCode: string): GoldenAuthority => ({ status: "UNPROVEN", receiptId: null, reasonCode })
const columns = "snapshot_id,product_id,variant_id,sku,canonical_url,title,price,availability,images,product_type,source_fingerprint,observed_at,preflight_status,field_truth_v1"
export type GoldenContext = { supabase: SupabaseClient; accountKey: string; accountAlias: string; principal: SellerOsControlPrincipalV1; now: Date; invocationSource?: "AUTHENTICATED_CONTROL_MCP" | "SERVICE_CERTIFICATION_DIAGNOSTIC" }
export function goldenBoundedFetchV1(): typeof fetch {
  // Fixed PostgREST methods; no caller URL, retries, eBay or supplier mutation.
  return async (url, init) => {
    const u = new URL(url instanceof Request ? url.url : String(url)), configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid")
    const method = (init?.method ?? "GET").toUpperCase()
    if (u.origin !== configured.origin || !u.pathname.startsWith("/rest/v1/") || !["GET", "POST"].includes(method)) throw Error("GOLDEN_PATH_DATABASE_BOUNDARY_REQUIRED")
    const signal = AbortSignal.timeout(8000)
    const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal })
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 2000000) throw Error("GOLDEN_PATH_RESPONSE_BOUND_EXCEEDED")
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, headers: response.headers })
  }
}
export async function createGoldenContextV1(principal: SellerOsControlPrincipalV1, oauthResource: string): Promise<GoldenContext> {
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey || !account.accountAlias) throw Error("GOLDEN_PATH_CANONICAL_ACCOUNT_REQUIRED")
  const supabase = getSupabaseAdminClient({ fetch: goldenBoundedFetchV1() })
  // Reuse the existing OWNER/client/resource allowlist. No anonymous control or arbitrary account input.
  const permission = await supabase.from("seller_os_commercial_trace_command_capabilities_v1")
    .select("capability_id,expires_at").eq("marketplace_account_key", account.accountKey)
    .eq("owner_user_id", principal.ownerUserId).eq("command_client_id", principal.commandClientId)
    .eq("oauth_resource", oauthResource).eq("capability_code", "TEO_COMMERCIAL_TRACE_V1").eq("enabled", true).limit(1).maybeSingle()
  if (permission.error || !permission.data || permission.data.expires_at && Date.parse(permission.data.expires_at) <= Date.now()) throw Error("GOLDEN_PATH_OWNER_CAPABILITY_DENIED")
  return { supabase, accountKey: account.accountKey, accountAlias: account.accountAlias, principal, now: new Date(), invocationSource: "AUTHENTICATED_CONTROL_MCP" }
}
export class GoldenReceiptPersistenceErrorV1 extends Error {
  readonly diagnostic: GoldenRecord
  constructor(phase: "WRITE" | "READBACK", kind: string, error: { code?: string; message?: string } | null, body: GoldenRecord) {
    super(`GOLDEN_PATH_DURABLE_RECEIPT_${phase}_FAILED`)
    const constraint = error?.message?.match(/constraint "(seller_os_golden_path_receipts_v1_[a-z0-9_]+)"/)?.[1] ?? null
    this.diagnostic = { operation: phase, table: "seller_os_golden_path_receipts_v1", kind,
      databaseCode: /^[A-Z0-9]{5,10}$/.test(error?.code ?? "") ? error!.code : null, constraint,
      payloadJsonBytes: Buffer.byteLength(JSON.stringify(body)),
      boundaryReason: /^GOLDEN_PATH_[A-Z0-9_]+$/.test(error?.message ?? "") ? error!.message : null }
    // Never log Postgres details/hints: they can contain the entire failing row.
    console.error(this.message, this.diagnostic)
  }
}
export async function writeGoldenReceiptV1<T extends GoldenRecord>(ctx: GoldenContext, kind: string, payload: T) {
  const body = { ...payload, executionAuthority: { source: ctx.invocationSource ?? "SERVICE_CERTIFICATION_DIAGNOSTIC", ownerUserId: ctx.principal.ownerUserId, clientId: ctx.principal.commandClientId } }
  const digest = goldenDigest(body), id = randomUUID()
  const written = await ctx.supabase.from("seller_os_golden_path_receipts_v1").upsert({ receipt_id: id, account_key: ctx.accountKey, owner_user_id: ctx.principal.ownerUserId, kind, evidence_digest: digest, payload: body }, { onConflict: "account_key,kind,evidence_digest", ignoreDuplicates: true })
  if (written.error) throw new GoldenReceiptPersistenceErrorV1("WRITE", kind, written.error, body)
  const read = await ctx.supabase.from("seller_os_golden_path_receipts_v1").select("receipt_id,evidence_digest,payload,created_at").eq("account_key", ctx.accountKey).eq("owner_user_id", ctx.principal.ownerUserId).eq("kind", kind).eq("evidence_digest", digest).limit(1).maybeSingle()
  if (read.error || !read.data || goldenDigest(read.data.payload) !== digest) throw new GoldenReceiptPersistenceErrorV1("READBACK", kind, read.error, body)
  return { ...body, durableReceipt: { receiptId: read.data.receipt_id, evidenceDigest: digest, createdAt: read.data.created_at, readback: "PASS", source: "SUPABASE_APPEND_ONLY_GOLDEN_PATH_LEDGER" } }
}
const receipt = writeGoldenReceiptV1
async function loadReceipt(ctx: GoldenContext, id: string, kind: string) {
  const read = await ctx.supabase.from("seller_os_golden_path_receipts_v1").select("payload,evidence_digest,created_at").eq("receipt_id", id).eq("account_key", ctx.accountKey).eq("owner_user_id", ctx.principal.ownerUserId).eq("kind", kind).limit(1).maybeSingle()
  if (read.error || !read.data || goldenDigest(read.data.payload) !== read.data.evidence_digest) throw Error("GOLDEN_PATH_RECEIPT_NOT_FOUND_OR_CONFLICT")
  return goldenRecord(read.data.payload)
}
async function snapshot(ctx: GoldenContext) {
  const read = await ctx.supabase.from("luna_catalog_snapshots_v1").select("snapshot_id,snapshot_completed_at").eq("snapshot_status", "COMPLETE").order("snapshot_completed_at", { ascending: false }).limit(1).maybeSingle()
  if (read.error || !read.data) throw Error("GOLDEN_PATH_CANONICAL_SNAPSHOT_UNAVAILABLE")
  return read.data
}
async function candidateSource(ctx: GoldenContext, key: GoldenCandidateKey) {
  const s = await snapshot(ctx)
  const r = await ctx.supabase.from("luna_catalog_snapshot_variants_v1").select(columns).eq("snapshot_id", s.snapshot_id).eq("product_id", key.productId).eq("variant_id", key.variantId).eq("sku", key.supplierSku).limit(2)
  if (r.error) throw Error("GOLDEN_PATH_CANONICAL_IDENTITY_READ_FAILED")
  return r.data?.length === 1 ? goldenRecord(r.data[0]) : null
}
export function normalizeGoldenStoredMarketV1(row: GoldenRecord): GoldenMarketEvidence | null {
  const recognizedSource = row.source_class === "MAIN_SEARCH_SOLD" && row.source_type === "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE" || row.source_class === "OFFICIAL_PRODUCT_RESEARCH" && ["EBAY_OFFICIAL_CSV_IMPORT", "EBAY_OFFICIAL_JSON_IMPORT", "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"].includes(String(row.source_type))
  if (!recognizedSource) return null
  const identity = goldenRecord(row.normalized_identity)
  return { evidenceId: String(row.id), source: String(row.source_class ?? row.source_type), sourceLocator: row.item_id ? `https://www.ebay.com/itm/${row.item_id}` : String(row.source_listing_reference_hash ?? ""), sourceDigest: String(row.evidence_digest ?? ""),
    listingState: "SOLD", identity: { ...identity, productName: String(identity.normalizedProductName ?? identity.productName ?? "") }, reviewed: row.evidence_reviewed === true,
    reviewReason: null, soldQuantity: goldenNumber(row.confirmed_sold_quantity), realizedSoldPrice: goldenNumber(row.realized_transaction_price_amount), buyerShipping: row.shipping_status === "OBSERVED" ? goldenNumber(row.visible_shipping_amount) : null,
    currency: String(row.realized_transaction_price_currency ?? row.currency ?? ""), lastSoldDate: typeof row.sold_at === "string" ? row.sold_at : null, capturedAt: String(row.captured_at ?? row.observed_at ?? ""),
    realizedPriceStatus: row.source_class === "MAIN_SEARCH_SOLD" ? "UNPROVEN" : row.realized_price_status === "PROVEN" ? "PROVEN" : row.realized_price_status === "UNAVAILABLE" ? "UNAVAILABLE" : "UNPROVEN" }
}
async function marketEvidence(ctx: GoldenContext, key?: GoldenCandidateKey) {
  const auto = ctx.supabase.from("marketplace_sold_evidence_observations").select("id,source_class,source_type,source_listing_reference_hash,normalized_identity,confirmed_sold_quantity,realized_transaction_price_amount,realized_transaction_price_currency,visible_shipping_amount,shipping_status,sold_at,captured_at,observed_at,realized_price_status,evidence_reviewed,evidence_digest,item_id,currency")
    .eq("marketplace_account_key", ctx.accountKey).eq("marketplace", "EBAY_US").eq("evidence_scope", "MARKET_WIDE_SOLD_EVIDENCE").gte("sold_at", new Date(ctx.now.getTime() - 90 * 86400000).toISOString()).order("sold_at", { ascending: false }).limit(MAX_MARKET_ROWS + 1)
  let manual = ctx.supabase.from("seller_os_golden_manual_market_v1").select("payload").eq("account_key", ctx.accountKey)
  if (key) manual = manual.eq("product_id", key.productId).eq("variant_id", key.variantId).eq("supplier_sku", key.supplierSku).eq("supplier_quantity", key.supplierQuantity)
  const [a, m] = await Promise.all([auto, manual.order("created_at", { ascending: false }).limit(MAX_MARKET_ROWS + 1)])
  if (a.error || m.error) return { rows: [] as GoldenMarketEvidence[], complete: false, truncated: false, reasonCode: "GOLDEN_PATH_MARKET_READ_FAILED" }
  // Reviewed exact-candidate intake must remain visible in a bounded market scan.
  // Completeness here means the bounded read succeeded, never market exhaustion.
  const rows = [...(m.data ?? []).map(r => goldenRecord(r.payload) as unknown as GoldenMarketEvidence), ...(a.data ?? []).map(normalizeGoldenStoredMarketV1).filter((row): row is GoldenMarketEvidence => row !== null)]
  return { rows: rows.slice(0, MAX_MARKET_ROWS), complete: (m.data?.length ?? 0) <= MAX_MARKET_ROWS, truncated: rows.length > MAX_MARKET_ROWS, reasonCode: rows.length > MAX_MARKET_ROWS ? "BOUNDED_MARKET_SCAN_PARTIAL_NOT_EXHAUSTIVE" : null }
}
async function ownerProductTruthEvidence(
  ctx: GoldenContext,
  key: GoldenCandidateKey,
  source: GoldenRecord | null,
) {
  if (!source) return { rows: [] as GoldenRecord[], complete: false }
  const read = await ctx.supabase.from("seller_os_golden_owner_product_truth_v1")
    .select("payload").eq("account_key", ctx.accountKey)
    .eq("owner_user_id", ctx.principal.ownerUserId)
    .eq("product_id", key.productId).eq("variant_id", key.variantId)
    .eq("supplier_sku", key.supplierSku)
    .eq("supplier_quantity", key.supplierQuantity)
    .eq("source_fingerprint", String(source.source_fingerprint ?? ""))
    .order("created_at", { ascending: true }).limit(21)
  if (read.error || (read.data?.length ?? 0) > 20) {
    return { rows: [] as GoldenRecord[], complete: false }
  }
  const rows = (read.data ?? []).map(row => goldenRecord(row.payload))
    .filter(evidence => isGoldenOwnerProductTruthEvidenceV1({
      evidence, candidate: key, accountKey: ctx.accountKey,
      ownerUserId: ctx.principal.ownerUserId,
      sourceFingerprint: String(source.source_fingerprint ?? ""),
      canonicalUrl: String(source.canonical_url ?? ""), now: ctx.now,
    }))
  return { rows, complete: rows.length === (read.data?.length ?? 0) }
}
async function visualComparisonEvidence(
  ctx: GoldenContext,
  key: GoldenCandidateKey,
  source: GoldenRecord | null,
) {
  if (!source) return { rows: [] as GoldenRecord[], complete: false }
  const read = await ctx.supabase.from("seller_os_golden_visual_comparison_v1")
    .select("payload").eq("account_key", ctx.accountKey)
    .eq("owner_user_id", ctx.principal.ownerUserId)
    .eq("product_id", key.productId).eq("variant_id", key.variantId)
    .eq("supplier_sku", key.supplierSku)
    .eq("supplier_quantity", key.supplierQuantity)
    .eq("source_fingerprint", String(source.source_fingerprint ?? ""))
    .order("created_at", { ascending: true }).limit(101)
  if (read.error || (read.data?.length ?? 0) > 100) {
    return { rows: [] as GoldenRecord[], complete: false }
  }
  return { rows: (read.data ?? []).map(row => goldenRecord(row.payload)), complete: true }
}
type OfficialSweep = Awaited<ReturnType<typeof getEbayOfficialLiveListingSweepReadonly>>
async function duplicateGate(ctx: GoldenContext, key: GoldenCandidateKey, source: GoldenRecord | null, sweep: OfficialSweep): Promise<GoldenAuthority> {
  if (sweep.status !== "CERTIFIED_COMPLETE" || !sweep.paginationComplete || !sweep.accountCertified) return unavailable("OFFICIAL_LIVE_DUPLICATE_COHORT_UNPROVEN")
  const liveIds = new Set(sweep.listings.map(l => l.itemId))
  const matched = sweep.listings.filter(l => l.sku?.trim().toUpperCase() === key.supplierSku.toUpperCase()).map(l => l.itemId)
  if (!liveIds.size) return { status: "PASS", receiptId: goldenDigest(sweep), source: "OFFICIAL_CERTIFIED_COMPLETE_EMPTY_LIVE_COHORT", observedAt: sweep.observedAt, cohortCount: 0, paginationComplete: true, marketplaceWrites: 0 }
  if (matched.length) return { status: "DUPLICATE", receiptId: goldenDigest({ sweep: sweep.observedAt, matched }), source: "OFFICIAL_LIVE_SUPPLIER_SKU_COLLISION", observedAt: sweep.observedAt, cohortCount: liveIds.size, matchingItemIds: matched, marketplaceWrites: 0 }
  if (liveIds.size > 500) return unavailable("DUPLICATE_COHORT_IDENTITY_BOUND_EXCEEDED")
  const cohortProof = { cohortIdentityDigest: goldenLiveCohortIdentityDigestV1(ctx.accountKey, key, source?.source_fingerprint, sweep.listings), comparisonTargets: sweep.listings.map(l => ({ itemId: l.itemId, sku: l.sku, title: l.title, variationKey: l.variationKey, sourceLocator: `https://www.ebay.com/itm/${l.itemId}` })), observedAt: sweep.observedAt, cohortCount: liveIds.size, paginationComplete: true, accountCertified: true, marketplaceWrites: 0 }
  const reviewed = async (base: GoldenAuthority) => {
    if (base.status === "DUPLICATE" || !Array.isArray(base.unresolvedItemIds) || !base.unresolvedItemIds.length) return base
    const read = await ctx.supabase.from("seller_os_golden_path_receipts_v1").select("receipt_id,evidence_digest,payload").eq("account_key", ctx.accountKey).eq("owner_user_id", ctx.principal.ownerUserId).eq("kind", "MANUAL_INTAKE").contains("payload", { liveComparisonReview: { candidate: key, sourceFingerprint: source?.source_fingerprint, cohortIdentityDigest: cohortProof.cohortIdentityDigest } }).order("created_at", { ascending: false }).limit(10)
    if (read.error) return { ...base, manualComparisonReadStatus: "UNPROVEN" }
    return applyGoldenLiveComparisonReviewsV1({ base, candidate: key, sourceFingerprint: source?.source_fingerprint, ownerUserId: ctx.principal.ownerUserId, now: ctx.now, receipts: (read.data ?? []).map(goldenRecord) })
  }
  const links = await ctx.supabase.from("seller_os_listing_product_link_authorities_v1").select("ebay_item_id,ebay_sku,luna_product_id,luna_variant_id,luna_sku,lifecycle_state,identity_preflight_status,source_fingerprint").eq("account_key", ctx.accountKey).eq("marketplace_id", "EBAY_US").eq("lifecycle_state", "ACTIVE").in("ebay_item_id", [...liveIds]).limit(501)
  if (links.error || (links.data?.length ?? 0) > 500) return reviewed({ ...unavailable("DUPLICATE_LINKAGE_READ_UNPROVEN"), ...cohortProof, unresolvedItemIds: [...liveIds], relatedItemIds: [], source: "OFFICIAL_LIVE_COHORT_LEGACY_LINKAGE_UNPROVEN" })
  const unresolvedItemIds: string[] = [], relatedItemIds: string[] = []
  for (const live of sweep.listings) {
    const identity = (links.data ?? []).filter(l => l.ebay_item_id === live.itemId && l.ebay_sku === live.sku && l.identity_preflight_status === "PREFLIGHT_PASS" && l.luna_product_id && l.luna_variant_id && l.luna_sku && /^sha256:[0-9a-f]{64}$/.test(String(l.source_fingerprint)))
    if (identity.length !== 1) { unresolvedItemIds.push(live.itemId); continue }
    if (identity[0].luna_product_id === key.productId) {
      if (identity[0].luna_variant_id === key.variantId) matched.push(live.itemId)
      else relatedItemIds.push(live.itemId)
    }
  }
  // A dissimilar title cannot prove an unresolved listing is a different product.
  // This reader never initiates historical backfill; missing comparison authority remains explicit.
  return reviewed({ ...cohortProof, status: matched.length ? "DUPLICATE" : unresolvedItemIds.length || relatedItemIds.length ? "UNPROVEN" : "PASS", source: "OFFICIAL_LIVE_PLUS_EXACT_CANONICAL_PRODUCT_COMPARISON_AUTHORITY", receiptId: goldenDigest({ observedAt: sweep.observedAt, itemIds: [...liveIds], matched, unresolvedItemIds, relatedItemIds }), matchingItemIds: matched, unresolvedItemIds, relatedItemIds, reasonCode: unresolvedItemIds.length ? "CANDIDATE_COMPARISON_AGAINST_UNRESOLVED_LIVE_IDENTITIES_UNPROVEN" : relatedItemIds.length ? "RELATED_PRODUCT_VARIANT_LIVE_REVIEW_REQUIRED" : null, historicalBackfillStarted: false, titleSimilarityUsedToProveAbsence: false, marketplaceWrites: 0 })

}
async function shippingAuthority(ctx: GoldenContext, key: GoldenCandidateKey, source: GoldenRecord | null): Promise<GoldenAuthority> {
  if (!source) return unavailable("SHIPPING_CANONICAL_IDENTITY_REQUIRED")
  const truth = verifiedGoldenFields(source, ctx.now)
  if (!truth.gate.receiptEvidenceDigest) return unavailable("SHIPPING_PRODUCT_TRUTH_BINDING_REQUIRED")
  if (key.supplierQuantity === 1) {
    const q = await readCommercialTraceShippingReceiptV1({ supabase: ctx.supabase, accountKey: ctx.accountKey, traceId: randomUUID(), lunaProductId: key.productId, lunaVariantId: key.variantId, supplierSku: key.supplierSku, sourceFingerprint: String(source.source_fingerprint), fieldTruthEvidenceDigest: truth.gate.receiptEvidenceDigest, allowCrossTraceReuse: true, now: ctx.now.getTime() })
    if (q) return { ...q, status: "PROVEN", receiptId: q.durableReceiptId, productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: 1, currency: "USD", noPayment: true }
  }
  const cached = await ctx.supabase.from("seller_os_golden_path_receipts_v1").select("receipt_id,payload").eq("account_key", ctx.accountKey).eq("kind", "SHIPPING").contains("payload", { productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: key.supplierQuantity, sourceFingerprint: source.source_fingerprint }).order("created_at", { ascending: false }).limit(1).maybeSingle()
  const prior = goldenRecord(cached.data?.payload)
  if (!cached.error && prior.status === "PROVEN" && Date.parse(String(prior.freshUntil)) > ctx.now.getTime()) return { ...prior, status: "PROVEN", receiptId: cached.data!.receipt_id }
  // The existing producer restores its temporary cart before returning and never purchases.
  const q = await attemptLunaAuthenticatedHttpShippingQuoteV1({ candidateId: goldenDigest({ accountKey: ctx.accountKey, key }), canonicalProductUrl: String(source.canonical_url), lunaProductId: key.productId, lunaVariantId: key.variantId, supplierSku: key.supplierSku, quantity: key.supplierQuantity })
  if (q.status !== "AVAILABLE") return unavailable(q.blocker)
  if (Math.round(q.subtotalUsd * 100) !== Math.round(Number(source.price) * key.supplierQuantity * 100)) return unavailable("SHIPPING_QUOTED_SUBTOTAL_IDENTITY_CONFLICT")
  const r = await receipt(ctx, "SHIPPING", { status: "PROVEN", productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: key.supplierQuantity, sourceFingerprint: source.source_fingerprint, fieldTruthEvidenceDigest: truth.gate.receiptEvidenceDigest, amountUsd: q.shippingAmountUsd, currency: q.currency, source: q.acquisitionMethod, observedAt: q.observedAt, freshUntil: new Date(Date.parse(q.observedAt) + 6 * 3600000).toISOString(), sourceDigest: q.evidenceDigest, destinationProfileId: q.destinationProfileId, destinationProfileDigest: q.destinationProfileDigest, noPurchase: q.noPurchase, noPayment: q.noPayment, supplierCartRestored: true, marketplaceWrites: 0 })
  return { ...r, receiptId: r.durableReceipt.receiptId }
}
async function candidateAuthorities(ctx: GoldenContext, key: GoldenCandidateKey, source: GoldenRecord | null, price: number | null) {
  const policy = source ? goldenRecord(resolveCommercialTraceOwnerPricePolicyV1({ marketplaceAccountKey: ctx.accountKey, lunaProductId: key.productId, lunaVariantId: key.variantId, supplierSku: key.supplierSku, sourceFingerprint: String(source.source_fingerprint), now: ctx.now })) : {}
  const normalizedPolicy: GoldenAuthority = { status: String(policy.status ?? "UNPROVEN"), accountKey: ctx.accountKey, receiptId: typeof policy.policyDigest === "string" ? policy.policyDigest : null, returnsReserveRate: goldenRecord(policy.returnsReserve).rateFraction ?? null, promotedState: goldenRecord(policy.promotedListings).state ?? "UNKNOWN", otherState: goldenRecord(policy.otherExplicitCosts).state ?? "UNKNOWN" }
  let category: GoldenAuthority = unavailable("EXACT_PLATFORM_CATEGORY_REQUIRED"), fee: GoldenAuthority = unavailable("EXACT_PRE_SALE_FEE_REQUIRED"), categoryId = ""
  const queue = await ctx.supabase.from("ebay_luna_opportunity_queue").select("id,candidate_key").eq("supplier_product_id", key.productId).eq("supplier_variant_id", key.variantId).eq("supplier_sku", key.supplierSku).limit(2)
  if (!queue.error && queue.data?.length === 1) {
    const opportunity = queue.data[0]
    const packages = await ctx.supabase.from("ebay_listing_packages").select("id,package_data,updated_at").eq("account_key", ctx.accountKey).eq("opportunity_id", opportunity.id).eq("candidate_key", opportunity.candidate_key).order("updated_at", { ascending: false }).limit(2)
    if (!packages.error && packages.data?.length === 1) {
      const pkg = packages.data[0], data = goldenRecord(pkg.package_data)
      categoryId = String(data.categoryId ?? "")
      const existingCategory = readEbayListingCategoryAuthorityV1({ packageData: data, identity: { accountKey: ctx.accountKey, sku: key.supplierSku, productId: key.productId, variantId: key.variantId, categoryId, opportunityId: opportunity.id, candidateKey: opportunity.candidate_key, packageId: pkg.id }, now: ctx.now })
      category = { ...existingCategory, categoryId }
      const handoff = await readEbayFeeHandoffV1({ supabase: ctx.supabase, accountKey: ctx.accountKey, itemId: null, packageId: pkg.id, sku: key.supplierSku, now: ctx.now }).catch(() => null)
      const authority = goldenRecord(handoff?.authority), resolved = goldenRecord(handoff?.resolvedAuthority), basis = goldenRecord(resolved.feeBasis)
      fee = { status: handoff?.status === "PROVEN" && key.supplierQuantity === 1 && basis.salePrice === price ? "PROVEN" : "UNPROVEN", accountKey: ctx.accountKey, productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: key.supplierQuantity, price: basis.salePrice ?? null, buyerShipping: basis.buyerShipping ?? null, currency: "USD", amountUsd: authority.amount ?? null, receiptId: handoff?.reference ?? null, observedAt: authority.observedAt ?? null, freshUntil: authority.freshUntil ?? null, source: "CANONICAL_EBAY_PRE_SALE_FEE_HANDOFF", components: resolved.components ?? null }
    }
  }
  if (category.status !== "PROVEN" || fee.status !== "PROVEN") {
    const standalone = await readGoldenPresaleAuthorityV1({ supabase: ctx.supabase, accountKey: ctx.accountKey, candidate: key, source, price, selectedCategory: category.status === "PROVEN" ? category : undefined }).catch(() => ({ category: unavailable("CATEGORY_AUTHORITY_READ_FAILED"), fee: unavailable("FEE_AUTHORITY_READ_FAILED") }))
    if (category.status !== "PROVEN") category = standalone.category
    if (fee.status !== "PROVEN") fee = standalone.fee
    categoryId = String(category.categoryId ?? goldenRecord(category.receipt).categoryId ?? "")
  }
  const truth = verifiedGoldenFields(source, ctx.now)
  const values = truth.values
  const [taxonomy, identifiers] = category.status === "PROVEN" ? await Promise.all([
    getEbayTaxonomyListingIntelligence(String(values.TITLE ?? ""), categoryId, { allowTitleSuggestionFallback: false }).catch(() => null),
    preflightEbayCategoryProductIdentifiers({ categoryId, marketplaceId: "EBAY_US", inventoryItemPayload: { product: { ...(key.supplierQuantity === 1 && typeof values.GTIN === "string" && /^\d{12}$/.test(values.GTIN) ? { upc: values.GTIN } : {}), ...(key.supplierQuantity === 1 && typeof values.GTIN === "string" && /^\d{13}$/.test(values.GTIN) ? { ean: values.GTIN } : {}) } } }).catch(() => null),
  ]) : [null, null]
  const aspectNames: Record<string, string> = { brand: "BRAND", mpn: "MPN", model: "MODEL", color: "COLOR", material: "MATERIAL", type: "PRODUCT_TYPE", scent: "SCENT", size: "SIZE_SET" }
  const aspects = taxonomy?.aspects ?? []
  const resolvedSpecifics = Object.fromEntries(aspects.flatMap(a => {
    const value = values[aspectNames[a.name.toLowerCase()] ?? ""]
    if (typeof value !== "string" || !value.trim() || !a.constraintsComplete || a.maxLength !== null && value.length > a.maxLength) return []
    if (a.mode === "SELECTION_ONLY" && (!a.valuesComplete || !a.values.some(v => v.value.toLowerCase() === value.toLowerCase()))) return []
    return [[a.name, value]]
  }))
  const missingAspects = aspects.filter(a => (a.required || a.officialConditionalRequirement?.evaluation === "APPLIES") && !resolvedSpecifics[a.name]).map(a => a.name)
  const conditionalUnknown = aspects.some(a => a.officialConditionalRequirement?.evaluation === "UNPROVEN")
  const blocks = truth.fields.some(f => f.CONTRADICTION === true) ? ["PRODUCT_TRUTH_CONTRADICTION"] : []
  if (/\b(cure|treats?|diagnos(?:e|is)|fda approved|hidden camera|spy camera|firearm|ammunition|switchblade)\b/i.test(String(values.TITLE ?? ""))) blocks.push("RESTRICTED_OR_UNVERIFIED_PRODUCT_CLAIM")
  if (/\b(powder|supplement|cosmetic|cream|serum|sunscreen|lotion|hearing aid|medical|disinfectant)\b/i.test(String(values.TITLE ?? ""))) blocks.push("REGULATED_PRODUCT_OWNER_COMPLIANCE_REVIEW_REQUIRED")
  const compliant = category.status === "PROVEN" && truth.gate.traceProductTruthSufficient && taxonomy?.status === "AVAILABLE" && taxonomy.categoryId === categoryId && taxonomy.categoryResolution === "KNOWN_CATEGORY" && taxonomy.taxonomyMarketplaceId === "EBAY_US" && missingAspects.length === 0 && !conditionalUnknown && identifiers?.safe === true
  const complianceBody = { productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: key.supplierQuantity, sourceFingerprint: source?.source_fingerprint, observedAt: ctx.now.toISOString(), freshUntil: new Date(+ctx.now + 6 * 3600000).toISOString(), category: category.status === "PROVEN" ? { id: categoryId, name: taxonomy?.categoryName ?? null, receipt: category.receipt } : null, source: "EXACT_PRODUCT_TRUTH_PLUS_OFFICIAL_TAXONOMY_AND_IDENTIFIER_PREFLIGHT", resolvedSpecifics, missingRequiredSpecifics: missingAspects, taxonomy, identifierPreflight: identifiers, blockers: blocks, publicationAuthorized: false }
  const compliance: GoldenAuthority = { ...complianceBody, status: compliant ? "PROVEN" : "UNPROVEN", receiptId: goldenDigest(complianceBody), reasonCode: compliant ? null : "EXACT_CATEGORY_REQUIRED_SPECIFICS_OR_IDENTIFIER_AUTHORITY_UNPROVEN" }
  // Existing Luna quotes stop at the merchant location. No authoritative producer
  // currently proves buyer delivery coverage or an additional real service cost.
  const fulfillment = unavailable("BUYER_FULFILLMENT_SHIPPING_UNPROVEN")
  return { policy: normalizedPolicy, compliance, fee, fulfillment }
}
export async function evaluateGoldenRuntimeV1(ctx: GoldenContext, key: GoldenCandidateKey, targetNetProfit = 4, shared?: { sweep: OfficialSweep; market: Awaited<ReturnType<typeof marketEvidence>>; source: GoldenRecord }, ownerFeePolicy?: GoldenOwnerFeePolicyInput) {
  const source = shared?.source ?? await candidateSource(ctx, key)
  const [market, sweep, shipping, ownerTruth, visualEvidence] = await Promise.all([
    shared?.market ?? marketEvidence(ctx, key), shared?.sweep ?? getEbayOfficialLiveListingSweepReadonly({ accountKey: ctx.accountKey, accountAlias: ctx.accountAlias }),
    shippingAuthority(ctx, key, source).catch(() => unavailable("SHIPPING_AUTHORITY_READ_FAILED")),
    ownerProductTruthEvidence(ctx, key, source), visualComparisonEvidence(ctx, key, source) ])
  const duplicate = await duplicateGate(ctx, key, source, sweep).catch(() => unavailable("DUPLICATE_AUTHORITY_READ_FAILED"))
  const missing = unavailable("AUTHORITY_NOT_EVALUATED")
  const visualReadComplete = visualEvidence.complete && visualEvidence.rows.every(evidence => {
    const marketEvidenceId = String(evidence.marketEvidenceId ?? "")
    const bound = market.rows.find(row => row.evidenceId === marketEvidenceId)
    return Boolean(bound && source && isGoldenVisualComparisonEvidenceV1({
      evidence, candidate: key, accountKey: ctx.accountKey,
      ownerUserId: ctx.principal.ownerUserId,
      sourceFingerprint: String(source.source_fingerprint ?? ""),
      canonicalUrl: String(source.canonical_url ?? ""),
      marketEvidence: { evidenceId: bound!.evidenceId,
        listingState: bound!.listingState, sourceLocator: bound!.sourceLocator,
        sourceDigest: bound!.sourceDigest }, now: ctx.now,
    }))
  })
  const initial = evaluateGoldenCandidateV1({ candidate: key, accountKey: ctx.accountKey, ownerUserId: ctx.principal.ownerUserId, now: ctx.now, targetNetProfit, source, market: market.rows, marketComplete: market.complete && ownerTruth.complete && visualReadComplete, ownerProductTruthEvidence: ownerTruth.rows, visualComparisonEvidence: visualEvidence.rows, duplicate, shipping, fee: missing, compliance: missing, policy: missing })
  const authority = await candidateAuthorities(ctx, key, source, initial.market.realizedBuyerLandedPrice).catch(() => ({ policy: missing, compliance: unavailable("COMPLIANCE_AUTHORITY_READ_FAILED"), fee: unavailable("FEE_AUTHORITY_READ_FAILED") }))
  if (authority.fee.status !== "PROVEN") {
    const policyContext = { candidate: key, accountKey: ctx.accountKey, ownerUserId: ctx.principal.ownerUserId, sourceFingerprint: source?.source_fingerprint, price: initial.market.realizedBuyerLandedPrice, now: ctx.now }
    if (ownerFeePolicy) authority.fee = buildGoldenOwnerFeePolicyV1({ ...policyContext, invocationSource: ctx.invocationSource, policy: ownerFeePolicy })
    else {
      const stored = await ctx.supabase.from("seller_os_golden_path_receipts_v1").select("receipt_id,evidence_digest,payload").eq("account_key", ctx.accountKey).eq("owner_user_id", ctx.principal.ownerUserId).eq("kind", "EVALUATION").contains("payload", { candidate: key, economics: { feeAuthority: { status: "PROVISIONAL_OWNER_POLICY", sourceFingerprint: source?.source_fingerprint } } }).order("created_at", { ascending: false }).limit(5)
      if (!stored.error) for (const row of stored.data ?? []) {
        const fee = readGoldenOwnerFeePolicyFromReceiptV1(goldenRecord(row), policyContext)
        if (fee) { authority.fee = fee; break }
      }
    }
  }
  const evaluated = evaluateGoldenCandidateV1({ candidate: key, accountKey: ctx.accountKey, ownerUserId: ctx.principal.ownerUserId, now: new Date(), targetNetProfit, source, market: market.rows, marketComplete: market.complete && ownerTruth.complete && visualReadComplete, ownerProductTruthEvidence: ownerTruth.rows, visualComparisonEvidence: visualEvidence.rows, duplicate, shipping, ...authority })
  return receipt(ctx, "EVALUATION", evaluated)
}
export async function previewGoldenCategoryV1(ctx: GoldenContext, category: string, limit = 5, targetNetProfit = 4) {
  // Read demand first. Supplier category is only a discovery filter; ranking uses classified SOLD evidence.
  const market = await marketEvidence(ctx), s = await snapshot(ctx)
  const isPersonalCare = category.trim().toLowerCase().replace(/[^a-z0-9]/g, "") === "personalcare"
  let candidateQuery = ctx.supabase.from("luna_catalog_snapshot_variants_v1").select(columns).eq("snapshot_id", s.snapshot_id)
  candidateQuery = isPersonalCare ? candidateQuery.or('product_type.eq."Personal Care",title.ilike.*mouthwash*,title.ilike.*tooth*,title.ilike.*dental*,title.ilike.*floss*,title.ilike.*hair*,title.ilike.*comb*,title.ilike.*razor*,title.ilike.*shav*,title.ilike.*manicure*,title.ilike.*pedicure*,title.ilike.*nail*,title.ilike.*skin*,title.ilike.*soap*,title.ilike.*lotion*,title.ilike.*cream*,title.ilike.*serum*,title.ilike.*sunscreen*,title.ilike.*lip balm*,title.ilike.*dusting powder*,title.ilike.*deodorant*,title.ilike.*perfume*,title.ilike.*body wash*,title.ilike.*bath brush*,title.ilike.*cosmetic*,title.ilike.*makeup*') : candidateQuery.eq("product_type", category)
  const [read, sweep] = await Promise.all([
    candidateQuery.order("product_id").order("variant_id").limit(MAX_SOURCE_ROWS + 1),
    getEbayOfficialLiveListingSweepReadonly({ accountKey: ctx.accountKey, accountAlias: ctx.accountAlias }) ])
  if (read.error) throw Error("GOLDEN_PATH_CATEGORY_SOURCE_READ_FAILED")
  const sources = (read.data ?? []).slice(0, MAX_SOURCE_ROWS).map(goldenRecord).filter(source => goldenCategoryDiscoveryMatchesV1(category, source, ctx.now))
  const candidates = sources.flatMap(source => {
    const key = { productId: String(source.product_id), variantId: String(source.variant_id), supplierSku: String(source.sku), supplierQuantity: 1 }
    const score = (quantity: number) => market.rows.reduce((n, e) => {
      const c = classifyGoldenComparable(goldenComparableIdentity(source, quantity, ctx.now), e)
      return n + (["EXACT", "CLOSE"].includes(c.classification) && e.listingState === "SOLD" ? Math.min(1000, e.soldQuantity ?? 0) : 0)
    }, 0)
    const rows = [{ key, source, demandScore: score(1) }]
    // Offer multipliers are discovered only from explicit SOLD pack counts matching the product identity.
    for (const q of [2, 3, 6, 12]) if (score(q) > 0) rows.push({ key: { ...key, supplierQuantity: q }, source, demandScore: score(q) })
    return rows
  }).sort((a, b) => b.demandScore - a.demandScore || a.key.productId.localeCompare(b.key.productId)).slice(0, Math.min(MAX_CANDIDATES, limit))
  const evaluated = []
  for (const c of candidates) {
    if (Date.now() - +ctx.now > 120000) break
    const r = await evaluateGoldenRuntimeV1(ctx, c.key, targetNetProfit, { source: c.source, market, sweep })
    evaluated.push(projectGoldenCategoryCandidateV1(r))
  }
  return receipt(ctx, "OPPORTUNITIES", { contractVersion: GOLDEN_PATH_V1, category, targetNetProfit, observedAt: ctx.now.toISOString(), status: evaluated.some(c => c.market.soldQuantity !== null && c.market.soldQuantity > 0) ? "AVAILABLE_WITH_GATES" : "UNPROVEN", resultCount: sources.length ? evaluated.length : null, candidates: evaluated, deferredCandidates: candidates.slice(evaluated.length).map(c => ({ candidate: c.key, reasonCode: "CATEGORY_REQUEST_TIME_BOUND_REACHED" })), bounded: { maximumSourceRows: MAX_SOURCE_ROWS, maximumMarketRows: MAX_MARKET_ROWS, maximumCandidates: MAX_CANDIDATES, candidateStartDeadlineMs: 120000, sourceTruncated: (read.data?.length ?? 0) > MAX_SOURCE_ROWS, marketTruncated: market.truncated, exhaustiveSearch: false }, packPolicy: "ONLY_COMMERCIALLY_EVIDENCED_OFFER_COUNTS", noSupportedPackReason: candidates.every(c => c.key.supplierQuantity === 1) ? "NO_EXACT_CLOSE_PACK_SOLD_IN_BOUNDED_EVIDENCE" : null, safety: { marketplaceWrites: 0, supplierPurchases: 0, draftIsLive: false } })
}
export function projectGoldenCategoryCandidateV1(r: Awaited<ReturnType<typeof evaluateGoldenRuntimeV1>>) {
  // Full authorities remain immutable in the already read-back EVALUATION receipt.
  // A category summary must not embed the same large taxonomy twice per candidate.
  const m = r.market, { taxonomy, category, ...compliance } = r.compliance
  const { receipt: categoryReceipt, ...categorySummary } = goldenRecord(category)
  const reference = (value: unknown, path: string) => ({ fullEvidenceReceiptId: r.durableReceipt.receiptId,
    path, evidenceDigest: goldenDigest(value), storage: "IMMUTABLE_EVALUATION_RECEIPT" })
  const taxonomySummary = goldenRecord(taxonomy)
  return { ...r,
    compliance: { ...compliance,
      category: category == null ? category : { ...categorySummary, receipt: categoryReceipt == null ? categoryReceipt : reference(categoryReceipt, "compliance.category.receipt") },
      taxonomy: taxonomy == null ? taxonomy : { status: taxonomySummary.status ?? null, categoryId: taxonomySummary.categoryId ?? null, ...reference(taxonomy, "compliance.taxonomy") },
      fullEvidenceReceiptId: r.durableReceipt.receiptId },
    market: { ...m, exactSold: m.exactSold.slice(0, 10), closeSold: m.closeSold.slice(0, 10), familyEvidence: m.familyEvidence.slice(0, 5), rejectedComparables: m.rejectedComparables.slice(0, 5), activeCompetition: m.activeCompetition.slice(0, 10), previewEvidenceCounts: { exact: m.exactSold.length, close: m.closeSold.length, family: m.familyEvidence.length, rejected: m.rejectedComparables.length, active: m.activeCompetition.length }, previewSamplesMayBeTruncated: true, fullEvidenceReceiptId: r.durableReceipt.receiptId } }
}
export async function importGoldenManualV1(ctx: GoldenContext, key: GoldenCandidateKey, rows: Omit<GoldenMarketEvidence, "evidenceId" | "source" | "reviewed">[], liveComparison?: GoldenLiveComparisonInput) {
  const source = await candidateSource(ctx, key)
  if (!source) throw Error("MANUAL_EVIDENCE_CANONICAL_CANDIDATE_REQUIRED")
  if (!rows.length && !liveComparison || rows.length > 50) throw Error("MANUAL_INTAKE_OBSERVATIONS_OR_LIVE_REVIEW_REQUIRED")
  const liveComparisonReview = liveComparison ? buildGoldenLiveComparisonReviewV1({ candidate: key, sourceFingerprint: source.source_fingerprint, ownerUserId: ctx.principal.ownerUserId, invocationSource: ctx.invocationSource, now: ctx.now, evaluation: await loadReceipt(ctx, liveComparison.evaluationReceiptId, "EVALUATION"), review: liveComparison }) : null
  const target = goldenComparableIdentity(source, key.supplierQuantity, ctx.now), receipts = [], pending = []
  // Validate every observation before the single atomic append. Invalid later
  // rows cannot leave a partially imported manual evidence batch.
  for (const row of rows) {
    if (row.marketplace !== "EBAY_US") throw Error("MANUAL_MARKETPLACE_EBAY_US_REQUIRED")
    if (row.listingState === "SOLD" && (!Number.isSafeInteger(row.soldQuantity) || !(row.soldQuantity! > 0) || !(row.realizedSoldPrice! > 0) || !row.lastSoldDate || !Number.isFinite(Date.parse(row.lastSoldDate)) || Date.parse(row.lastSoldDate) > ctx.now.getTime() || Date.parse(row.lastSoldDate) > Date.parse(row.capturedAt))) throw Error("MANUAL_SOLD_QUANTITY_PRICE_DATE_REQUIRED")
    if (row.listingState === "SOLD" && row.activeListingPrice != null) throw Error("SOLD_IS_NOT_ACTIVE_PRICE")
    if (row.listingState === "ACTIVE" && (row.realizedSoldPrice !== null || row.soldQuantity !== null || row.lastSoldDate !== null || row.realizedPriceStatus === "PROVEN")) throw Error("ACTIVE_IS_NOT_SOLD")
    if (!Number.isFinite(Date.parse(row.capturedAt)) || Date.parse(row.capturedAt) > ctx.now.getTime() || !row.sourceLocator || !/^sha256:[0-9a-f]{64}$/.test(row.sourceDigest)) throw Error("MANUAL_MARKET_PROVENANCE_REQUIRED")
    const dedup = goldenDigest({ accountKey: ctx.accountKey, key, marketplace: row.marketplace, sourceLocator: row.sourceLocator, listingState: row.listingState, identity: row.identity, lastSoldDate: row.lastSoldDate, soldQuantity: row.soldQuantity, realizedSoldPrice: row.realizedSoldPrice, activeListingPrice: row.activeListingPrice ?? null, buyerShipping: row.buyerShipping })
    const evidence: GoldenMarketEvidence = { ...row, evidenceId: dedup, source: "OWNER_ATTESTED_MANUAL_TERAPEAK", reviewed: true }
    const classification = classifyGoldenComparable(target, evidence)
    const payload = { ...evidence, listingTitle: row.identity.productName, buyerLandedPrice: row.listingState === "SOLD" && row.realizedPriceStatus === "PROVEN" && row.realizedSoldPrice !== null && row.buyerShipping !== null ? Math.round((row.realizedSoldPrice + row.buyerShipping) * 100) / 100 : null, classification: classification.classification, reasonCodes: classification.reasonCodes, targetCandidate: key, supplierTruthModified: false }
    pending.push({ evidence_id: dedup, account_key: ctx.accountKey, owner_user_id: ctx.principal.ownerUserId, product_id: key.productId, variant_id: key.variantId, supplier_sku: key.supplierSku, supplier_quantity: key.supplierQuantity, listing_state: row.listingState, classification: classification.classification, payload })
  }
  const unique = [...new Map(pending.map(row => [row.evidence_id, row])).values()]
  if (!unique.length) return receipt(ctx, "MANUAL_INTAKE", { contractVersion: GOLDEN_PATH_V1, candidate: key, importedEvidence: [], liveComparisonReview, supplierTruthModified: false, portfolioLinkageModified: false, marketScope: "OWNER_CANDIDATE_LIVE_COMPARISON_NOT_SOLD_OR_SUPPLIER_TRUTH", safety: { marketplaceWrites: 0, supplierWrites: 0 } })
  const written = await ctx.supabase.from("seller_os_golden_manual_market_v1").upsert(unique, { onConflict: "evidence_id", ignoreDuplicates: true })
  if (written.error) throw Error("MANUAL_MARKET_DURABLE_IMPORT_FAILED")
  const readback = await ctx.supabase.from("seller_os_golden_manual_market_v1").select("evidence_id,payload").eq("account_key", ctx.accountKey).in("evidence_id", unique.map(row => row.evidence_id)).limit(51)
  if (readback.error || readback.data?.length !== unique.length) throw Error("MANUAL_MARKET_READBACK_FAILED")
  for (const expected of unique) {
    const stored = readback.data.find(row => row.evidence_id === expected.evidence_id)
    // A replay preserves its original durable provenance. Changed attestation
    // is not silently reported as a successfully imported replacement.
    if (!stored || goldenDigest(stored.payload) !== goldenDigest(expected.payload)) throw Error("MANUAL_MARKET_EXISTING_ATTESTATION_CONFLICT")
    receipts.push(stored)
  }
  return receipt(ctx, "MANUAL_INTAKE", { contractVersion: GOLDEN_PATH_V1, candidate: key, importedEvidence: receipts, liveComparisonReview, deduplication: "CONTENT_IDEMPOTENT_SOURCE_SALE_OFFER", supplierTruthModified: false, marketScope: "MANUAL_ATTESTATION_NOT_AUTOMATIC_AUTHORITY", safety: { marketplaceWrites: 0, supplierWrites: 0 } })
}
export async function importGoldenOwnerProductTruthV1(
  ctx: GoldenContext,
  key: GoldenCandidateKey,
  sourceInput: GoldenOwnerProductTruthSourceV1,
  observations: ReadonlyArray<GoldenOwnerProductTruthObservationV1>,
) {
  const source = await candidateSource(ctx, key)
  if (!source || source.preflight_status !== "PREFLIGHT_PASS") {
    throw Error("OWNER_PRODUCT_TRUTH_CANONICAL_CANDIDATE_REQUIRED")
  }
  const evidence = buildGoldenOwnerProductTruthEvidenceV1({
    candidate: key, accountKey: ctx.accountKey,
    ownerUserId: ctx.principal.ownerUserId,
    sourceFingerprint: String(source.source_fingerprint ?? ""),
    expectedCanonicalUrl: String(source.canonical_url ?? ""),
    source: sourceInput, observations, operatorAttested: true, now: ctx.now,
  })
  const rows = [...new Map(evidence.map(item => [item.evidenceId, {
    evidence_id: item.evidenceId, account_key: ctx.accountKey,
    owner_user_id: ctx.principal.ownerUserId, product_id: key.productId,
    variant_id: key.variantId, supplier_sku: key.supplierSku,
    supplier_quantity: key.supplierQuantity,
    source_fingerprint: item.sourceFingerprint, fact_class: item.factClass,
    normalized_value: item.normalizedValue, source_digest: item.sourceDigest,
    source_captured_at: item.capturedAt, payload: item,
  }])).values()]
  const written = await ctx.supabase.from("seller_os_golden_owner_product_truth_v1")
    .upsert(rows, { onConflict: "evidence_id", ignoreDuplicates: true })
  if (written.error) throw Error("OWNER_PRODUCT_TRUTH_DURABLE_IMPORT_FAILED")
  const readback = await ctx.supabase.from("seller_os_golden_owner_product_truth_v1")
    .select("evidence_id,payload,created_at").eq("account_key", ctx.accountKey)
    .eq("owner_user_id", ctx.principal.ownerUserId)
    .in("evidence_id", rows.map(row => row.evidence_id)).limit(21)
  if (readback.error || readback.data?.length !== rows.length) {
    throw Error("OWNER_PRODUCT_TRUTH_READBACK_FAILED")
  }
  for (const expected of evidence) {
    const stored = readback.data.find(row => row.evidence_id === expected.evidenceId)
    if (!stored || !isGoldenOwnerProductTruthEvidenceV1({
      evidence: stored.payload, candidate: key, accountKey: ctx.accountKey,
      ownerUserId: ctx.principal.ownerUserId,
      sourceFingerprint: String(source.source_fingerprint ?? ""),
      canonicalUrl: String(source.canonical_url ?? ""), now: ctx.now,
    }) || goldenDigest(stored.payload) !== goldenDigest(expected)) {
      throw Error("OWNER_PRODUCT_TRUTH_EXISTING_ATTESTATION_CONFLICT")
    }
  }
  return receipt(ctx, "PRODUCT_TRUTH_INTAKE", {
    contractVersion: GOLDEN_PATH_V1, candidate: key,
    ownerProductTruthEvidence: readback.data,
    deduplication: "CONTENT_ADDRESSED_OWNER_EVIDENCE",
    supplierTruthModified: false, manufacturerBrandPromoted: false,
    unknownFieldsPromoted: false,
    unknownFields: ["MANUFACTURER_BRAND", "UPC", "GTIN", "MPN", "MODEL", "PACK_COUNT"],
    safety: { marketplaceWrites: 0, supplierWrites: 0, supplierPurchases: 0, draftIsLive: false },
  })
}
export async function importGoldenVisualComparisonV1(
  ctx: GoldenContext,
  key: GoldenCandidateKey,
  supplierObservation: GoldenVisualSourceObservationV1,
  comparisons: ReadonlyArray<Readonly<{
    marketEvidenceId: string
    marketplaceObservation: GoldenVisualSourceObservationV1
    relations: ReadonlyArray<GoldenVisualRelationV1>
  }>>,
) {
  const source = await candidateSource(ctx, key)
  if (!source || source.preflight_status !== "PREFLIGHT_PASS") {
    throw Error("VISUAL_COMPARISON_CANONICAL_CANDIDATE_REQUIRED")
  }
  if (comparisons.length < 1 || comparisons.length > 20) {
    throw Error("VISUAL_COMPARISON_BOUNDED_INPUT_REQUIRED")
  }
  const market = await marketEvidence(ctx, key)
  const requested = new Set(comparisons.map(comparison => comparison.marketEvidenceId))
  const matched = market.rows.filter(row => requested.has(row.evidenceId))
  if (matched.length !== requested.size) {
    throw Error("VISUAL_COMPARISON_MARKET_EVIDENCE_REQUIRED")
  }
  const evidence = buildGoldenVisualComparisonEvidenceV1({
    candidate: key, accountKey: ctx.accountKey,
    ownerUserId: ctx.principal.ownerUserId,
    sourceFingerprint: String(source.source_fingerprint ?? ""),
    canonicalUrl: String(source.canonical_url ?? ""), supplierObservation,
    comparisons: comparisons.map(comparison => {
      const marketEvidence = matched.find(row =>
        row.evidenceId === comparison.marketEvidenceId)!
      return { marketEvidence: { evidenceId: marketEvidence.evidenceId,
        listingState: marketEvidence.listingState,
        sourceLocator: marketEvidence.sourceLocator,
        sourceDigest: marketEvidence.sourceDigest },
      marketplaceObservation: comparison.marketplaceObservation,
      relations: comparison.relations }
    }),
    operatorAttested: true, now: ctx.now,
  })
  const rows = [...new Map(evidence.map(item => [item.evidenceId, {
    evidence_id: item.evidenceId, account_key: ctx.accountKey,
    owner_user_id: ctx.principal.ownerUserId, product_id: key.productId,
    variant_id: key.variantId, supplier_sku: key.supplierSku,
    supplier_quantity: key.supplierQuantity,
    source_fingerprint: item.sourceFingerprint,
    market_evidence_id: item.marketEvidenceId,
    marketplace_source_role: item.marketplaceObservation.sourceRole,
    supplier_source_digest: item.supplierObservation.sourceDigest,
    marketplace_source_digest: item.marketplaceObservation.sourceDigest,
    outcome: item.outcome, payload: item,
  }])).values()]
  const written = await ctx.supabase.from("seller_os_golden_visual_comparison_v1")
    .upsert(rows, { onConflict: "evidence_id", ignoreDuplicates: true })
  if (written.error) throw Error("VISUAL_COMPARISON_DURABLE_IMPORT_FAILED")
  const readback = await ctx.supabase.from("seller_os_golden_visual_comparison_v1")
    .select("evidence_id,payload,created_at").eq("account_key", ctx.accountKey)
    .eq("owner_user_id", ctx.principal.ownerUserId)
    .in("evidence_id", rows.map(row => row.evidence_id)).limit(21)
  if (readback.error || readback.data?.length !== rows.length) {
    throw Error("VISUAL_COMPARISON_READBACK_FAILED")
  }
  for (const expected of evidence) {
    const stored = readback.data.find(row => row.evidence_id === expected.evidenceId)
    const marketEvidence = matched.find(row => row.evidenceId === expected.marketEvidenceId)!
    if (!stored || !isGoldenVisualComparisonEvidenceV1({
      evidence: stored.payload, candidate: key, accountKey: ctx.accountKey,
      ownerUserId: ctx.principal.ownerUserId,
      sourceFingerprint: String(source.source_fingerprint ?? ""),
      canonicalUrl: String(source.canonical_url ?? ""),
      marketEvidence: { evidenceId: marketEvidence.evidenceId,
        listingState: marketEvidence.listingState,
        sourceLocator: marketEvidence.sourceLocator,
        sourceDigest: marketEvidence.sourceDigest }, now: ctx.now,
    }) || goldenDigest(stored.payload) !== goldenDigest(expected)) {
      throw Error("VISUAL_COMPARISON_EXISTING_ATTESTATION_CONFLICT")
    }
  }
  return receipt(ctx, "VISUAL_COMPARISON_INTAKE", {
    contractVersion: GOLDEN_PATH_V1, candidate: key,
    visualComparisonEvidence: readback.data,
    outcomes: readback.data.map(row => ({ evidenceId: row.evidence_id,
      marketEvidenceId: goldenRecord(row.payload).marketEvidenceId,
      outcome: goldenRecord(row.payload).outcome,
      reasonCodes: goldenRecord(row.payload).reasonCodes })),
    deduplication: "CONTENT_ADDRESSED_VISUAL_COMPARISON",
    visualAuthority: "CLOSE_SUPPORT_OR_CONTRADICTION_NEVER_EXACT",
    supplierTruthModified: false, manufacturerBrandInferred: false,
    safety: { marketplaceWrites: 0, supplierWrites: 0,
      supplierPurchases: 0, draftIsLive: false },
  })
}
export async function prepareGoldenRuntimeV1(ctx: GoldenContext, evaluationReceiptId: string) {
  const previous = await loadReceipt(ctx, evaluationReceiptId, "EVALUATION")
  const key = goldenRecord(previous.candidate) as unknown as GoldenCandidateKey
  // A historical GO cannot authorize a new draft after evidence expires or LIVE duplicates appear.
  const evaluation = await evaluateGoldenRuntimeV1(ctx, key, Number(goldenRecord(previous.economics).targetNetProfit ?? 4))
  const draft = prepareGoldenDraftV1(evaluation as unknown as ReturnType<typeof evaluateGoldenCandidateV1>)
  return receipt(ctx, "DRAFT", { ...draft, candidate: key, evaluationReceiptId: evaluation.durableReceipt.receiptId, sourceFingerprint: goldenRecord(evaluation.sourceIdentity).sourceFingerprint })
}
export async function reconcileGoldenRuntimeV1(ctx: GoldenContext, packageReceiptId: string, itemId: string | undefined, dryRun = true) {
  const pkg = await loadReceipt(ctx, packageReceiptId, "DRAFT"), key = goldenRecord(pkg.candidate) as unknown as GoldenCandidateKey
  if (pkg.state !== "DRAFT_ONLY" || pkg.published !== false) throw Error("GOLDEN_PATH_DRAFT_RECEIPT_REQUIRED")
  const source = await candidateSource(ctx, key)
  if (!source || source.source_fingerprint !== pkg.sourceFingerprint || source.preflight_status !== "PREFLIGHT_PASS" || !verifiedGoldenFields(source, ctx.now).gate.traceProductTruthSufficient) throw Error("GOLDEN_RECONCILIATION_CURRENT_IDENTITY_REQUIRED")
  const sweep = await getEbayOfficialLiveListingSweepReadonly({ accountKey: ctx.accountKey, accountAlias: ctx.accountAlias })
  if (sweep.status !== "CERTIFIED_COMPLETE" || !sweep.paginationComplete || !sweep.accountCertified) throw Error("GOLDEN_RECONCILIATION_OFFICIAL_COHORT_REQUIRED")
  const matches = sweep.listings.filter(l => l.sku === key.supplierSku)
  if (matches.length !== 1 || itemId && matches[0].itemId !== itemId) return receipt(ctx, "RECONCILIATION", { contractVersion: GOLDEN_PATH_V1, status: "UNPROVEN", reasonCode: matches.length > 1 ? "LIVE_SKU_AMBIGUOUS" : "MANUAL_PUBLICATION_NOT_CONFIRMED", packageReceiptId, candidate: key, draftIsPublished: false, enrollment: null, dryRun, marketplaceWrites: 0 })
  const official = await readManualListingFromTradingApi(matches[0].itemId)
  if (official.ownership !== "verified" || official.listingStatus !== "Active" || official.marketplaceSite !== "US" || official.ebaySku !== key.supplierSku) throw Error("GOLDEN_RECONCILIATION_GET_ITEM_LIVE_MISMATCH")
  const catalog = await ctx.supabase.from("market_radar_latest_variants").select("product_id,supplier_product_id,supplier_variant_id,sku").eq("source_key", "lunaportex").eq("supplier_product_id", key.productId).eq("supplier_variant_id", key.variantId).eq("sku", key.supplierSku).limit(2)
  if (catalog.error || catalog.data?.length !== 1) throw Error("GOLDEN_RECONCILIATION_PRODUCT_CASE_IDENTITY_REQUIRED")
  const identity = { productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: key.supplierQuantity }
  const hash = goldenDigest({ accountKey: ctx.accountKey, identity }), authorityId = `listing-link-authority-v1:${goldenDigest({ accountKey: ctx.accountKey, itemId: official.itemId, identity })}`
  const authority = { authority_id: authorityId, account_key: ctx.accountKey, ebay_item_id: official.itemId, seller_os_product_id: catalog.data[0].product_id, luna_product_id: key.productId, luna_variant_id: key.variantId, luna_sku: key.supplierSku, supplier_quantity_required: key.supplierQuantity, identity_key: `listing-product-identity-v1:${hash}`, linkage_id: `luna-linkage-v1:${hash}`, source_decision_id: `luna-linkage-decision-v1:${goldenDigest({ packageReceiptId, itemId: official.itemId, identity })}`, source_fingerprint: source.source_fingerprint, components: [{ componentId: key.variantId, lunaProductId: key.productId, lunaVariantId: key.variantId, lunaSku: key.supplierSku, supplierQuantityRequired: key.supplierQuantity, quantityRequired: key.supplierQuantity, exactProductIdentity: true, exactVariantIdentity: true, exactSupplierSku: true, structuredVariantAttributesComplete: true, identityConflict: false, evidenceReferences: [packageReceiptId, String(source.source_fingerprint)] }] }
  const payload = { contractVersion: GOLDEN_PATH_V1, status: "LIVE_VERIFIED", source: "EBAY_TRADING_GET_ITEM_READONLY", itemId: official.itemId, ownership: official.ownership, listingStatus: official.listingStatus, marketplaceSite: official.marketplaceSite, sku: official.ebaySku, observedAt: official.observedAt, packageReceiptId, candidate: key, authorityId, dryRun, marketplaceWrites: 0, stockguardMode: "MONITOR_ONLY", analyticsWindows: ["24H", "7D", "30D"], draftIsPublished: false }
  if (dryRun) return receipt(ctx, "RECONCILIATION", { ...payload, enrollment: { status: "SIMULATED_ONLY", registry: "WOULD_LINK", stockguard: "WOULD_ENROLL_MONITOR_ONLY", analytics: "WOULD_ENROLL", persisted: false } })
  const rid = randomUUID(), digest = goldenDigest(payload)
  const written = await ctx.supabase.rpc("seller_os_golden_enroll_v1", { p_account_key: ctx.accountKey, p_owner_user_id: ctx.principal.ownerUserId, p_package_receipt_id: packageReceiptId, p_receipt_id: rid, p_digest: digest, p_payload: payload, p_authority: authority })
  if (written.error || !written.data) throw Error("GOLDEN_PATH_ATOMIC_ENROLLMENT_FAILED")
  const read = await ctx.supabase.from("seller_os_golden_managed_listings_v1").select("*").eq("account_key", ctx.accountKey).eq("ebay_item_id", official.itemId).limit(1).maybeSingle()
  if (read.error || !read.data || read.data.authority_id !== authorityId || read.data.stockguard_enrolled !== true || read.data.analytics_enrolled !== true || read.data.marketplace_actions_enabled !== false) throw Error("GOLDEN_PATH_ENROLLMENT_READBACK_FAILED")
  return { ...payload, enrollment: read.data, durableReceipt: { receiptId: read.data.reconciliation_receipt_id, readback: "PASS" }, monitoringStatus: "UNPROVEN_UNTIL_OBSERVATIONS" }
}
export async function readGoldenMonitoringV1(ctx: GoldenContext, itemId: string) {
  const managed = await ctx.supabase.from("seller_os_golden_managed_listings_v1").select("*").eq("account_key", ctx.accountKey).eq("ebay_item_id", itemId).limit(1).maybeSingle()
  if (managed.error || !managed.data) throw Error("GOLDEN_PATH_MANAGED_LISTING_REQUIRED")
  // Exact account + Item ID + source windows. Enrollment is distinct from data availability.
  const [snapshots, stockRead, officialTraffic] = await Promise.all([
    ctx.supabase.from("listing_commercial_snapshots").select("*").eq("marketplace_account_key", ctx.accountKey).eq("marketplace", "EBAY_US").eq("listing_id", itemId).order("observed_at", { ascending: false }).limit(90),
    readProductionStockGuardV1({ supabase: ctx.supabase, accountKey: ctx.accountKey, accountAlias: ctx.accountAlias, itemId, now: ctx.now, includeKnownListingStockEvidence: true }).catch(() => null),
    readGoldenTrafficWindowsV1({ accountKey: ctx.accountKey, itemId, now: ctx.now }).catch(() => ({ snapshots: [] as GoldenRecord[], limitations: ["ANALYTICS_SOURCE_READ_FAILED"] })),
  ])
  const stock = goldenRecord(stockRead?.listings.find(r => r.itemId === itemId))
  const trafficSnapshots = [...officialTraffic.snapshots, ...(snapshots.data ?? []).map(goldenRecord)]
  const projection = projectGoldenMonitoringV1({ accountKey: ctx.accountKey, itemId, now: new Date(), snapshots: trafficSnapshots, readAvailable: !snapshots.error || officialTraffic.snapshots.length > 0, stock })
  return receipt(ctx, "MONITORING", { contractVersion: GOLDEN_PATH_V1, itemId, enrollment: managed.data, ...projection, stockReadback: stock, trafficSnapshots: officialTraffic.snapshots, analyticsLimitations: officialTraffic.limitations, availableSnapshotCount: snapshots.error && !officialTraffic.snapshots.length ? null : trafficSnapshots.length })
}
