import type { SupabaseClient } from "@supabase/supabase-js"
import { buildEbayBoundedPriceDistributionV1 } from "./ebay-market-pricing-strategy"
import { buildLunaPreResearchIdentityKeyV1,
  buildLunaPreResearchProductTruthFingerprintV1 } from "./luna-pre-research-intake-v1"

type Row = Record<string, unknown>
const DAY = 86_400_000
const HASH = /^sha256:[0-9a-f]{64}$/
const row = (value: unknown): Row => value && typeof value === "object" &&
  !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === "string" ? value.trim() : ""
function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function fresh(value: unknown, now: Date, maximumAge: number) {
  const age = now.getTime() - Date.parse(text(value))
  return Number.isFinite(age) && age >= -60_000 && age <= maximumAge
}
function itemIdentity(value: unknown) {
  const valueText = text(value)
  return valueText.match(/^(?:v1\|)?(\d{9,19})(?:\|\d+)?$/)?.[1] ?? null
}
function range(distribution: ReturnType<typeof buildEbayBoundedPriceDistributionV1>) {
  return distribution ? { minimum: distribution.minimumLandedPrice,
    median: distribution.medianLandedPrice, maximum: distribution.maximumLandedPrice,
    currency: "USD" as const } : null
}

export type CommercialPricingContextV1 = Readonly<{
  demandProven: boolean
  demandReceipt: Row | null
  aggregateSold: ReturnType<typeof buildCanonicalAggregateSoldPricingV1> | null
  readStatus: string
}>

/** Uses only the canonical semantics view + its exact observation/capture.
 * An average is derived from explicitly proven cumulative SOLD value / SOLD
 * quantity, never from the legacy ambiguous average_sold_price column.
 */
export function buildCanonicalAggregateSoldPricingV1(input: Readonly<{
  evidence: readonly Row[]; observations: readonly Row[]; captures: readonly Row[]
  accountKey: string; planId: string; now: Date
}>) {
  const seen = new Set<string>()
  const accepted = input.evidence.slice(0, 100).flatMap((entry) => {
    const id = itemIdentity(entry.item_id)
    const price = row(entry.price_evidence)
    const cumulative = row(price.CUMULATIVE_SALES_VALUE)
    const quantity = row(price.QUANTITY_SOLD)
    const shipping = row(price.SHIPPING)
    const seller = row(entry.seller_evidence)
    const currency = row(price.CURRENCY)
    const source = row(price.PRICE_SOURCE)
    const compatibility = row(entry.structural_compatibility)
    const observation = input.observations.find((value) =>
      value.id === entry.source_observation_id)
    const capture = input.captures.find((value) =>
      value.id === entry.source_capture_batch_id)
    const window = row(capture?.date_range)
    const amount = numeric(cumulative.amount)
    const sold = numeric(quantity.value)
    const freight = numeric(shipping.amount)
    if (!id || seen.has(id) || entry.plan_id !== input.planId ||
        entry.marketplace_account_key !== input.accountKey || entry.marketplace !== "EBAY_US" ||
        !["EXACT_PRODUCT_COMPARABLE", "CLOSE_VARIANT_COMPARABLE"].includes(text(entry.structural_classification)) ||
        compatibility.entityCompatible !== true || compatibility.architectureCompatible !== true ||
        compatibility.useCompatible !== true || compatibility.explicitCountDifference !== false ||
        compatibility.explicitSizeDifference !== false ||
        cumulative.status !== "PROVEN" || quantity.status !== "PROVEN" ||
        source.cumulative !== "PRODUCT_RESEARCH_ITEM_SALES_COLUMN" ||
        currency.status !== "PROVEN" || currency.value !== "USD" ||
        !["FREE_SHIPPING", "SHIPPING_PRICE"].includes(text(shipping.status)) ||
        seller.status !== "PROVEN" || !HASH.test(text(seller.identityHash)) ||
        amount === null || amount <= 0 || sold === null || sold < 1 ||
        !Number.isInteger(sold) || freight === null || freight < 0 ||
        !observation || !capture || observation.capture_batch_id !== capture.id ||
        observation.marketplace_account_key !== input.accountKey ||
        capture.marketplace_account_key !== input.accountKey ||
        observation.marketplace !== "EBAY_US" || capture.marketplace !== "EBAY_US" ||
        observation.source_listing_id !== entry.item_id ||
        numeric(observation.item_sales) !== amount ||
        numeric(observation.confirmed_sold_quantity) !== sold ||
        capture.source !== "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE" ||
        !HASH.test(text(capture.search_query_hash)) ||
        !Array.isArray(entry.query_provenance_hashes) || !entry.query_provenance_hashes.length ||
        !fresh(capture.captured_at, input.now, 30 * DAY) ||
        !fresh(observation.last_sold_date, input.now, 90 * DAY) ||
        !fresh(window.end, input.now, 90 * DAY) ||
        !(Date.parse(text(window.start)) <= Date.parse(text(window.end)))) return []
    seen.add(id)
    return [{ itemId: id, seller: text(seller.identityHash),
      landedPrice: Math.round((amount / sold + freight) * 100) / 100,
      soldQuantity: sold, observationId: observation.id, captureId: capture.id,
      queryHash: capture.search_query_hash, observationWindow: window,
      capturedAt: capture.captured_at }]
  })
  const distribution = buildEbayBoundedPriceDistributionV1(accepted)
  const sufficient = Boolean(distribution && distribution.sampleSize >= 2 &&
    distribution.sellerCount >= 2 && distribution.soldQuantity >= 3)
  return Object.freeze({ sufficient, distribution, priceRange: range(distribution),
    source: "PRODUCT_RESEARCH_CANONICAL_CUMULATIVE_SOLD_VALUE" as const,
    evidence: accepted, perSaleRealizedPriceProven: false })
}

/** Strictly additive metadata path; legacy sold/identity classifiers unchanged. */
export function buildCommercialActiveMarketAuthorityV1(
  values: readonly unknown[], now = new Date(),
) {
  const seen = new Set<string>()
  const eligible = values.slice(0, 100).flatMap((value) => {
    const entry = row(value)
    const observed = row(entry.activeMarketObservation)
    const id = itemIdentity(entry.comparableId)
    const seller = text(observed.sellerUsername).toLowerCase()
    const itemPrice = numeric(observed.itemPrice)
    const shipping = numeric(observed.shippingPrice)
    if (!id || seen.has(id) || !seller || seller === "vendedor ebay" ||
        entry.eligibleComparable !== true || entry.pricingAuthorityEligible !== true ||
        !["EXACT_MODEL_COMPARABLE", "NEAR_EXACT_PRODUCT"].includes(text(entry.commercialComparableClass)) ||
        !["EBAY_BROWSE_ACTIVE_LISTING", "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE"]
          .includes(text(entry.evidenceSource)) ||
        observed.active !== true || observed.sponsored !== false ||
        observed.conditionId !== "1000" || observed.currency !== "USD" ||
        observed.shippingCurrency !== "USD" ||
        !fresh(observed.observedAt, now, DAY) ||
        (text(entry.itemEndDate) && Date.parse(text(entry.itemEndDate)) <= now.getTime()) ||
        itemPrice === null || itemPrice <= 0 || shipping === null || shipping < 0) return []
    seen.add(id)
    return [{ itemId: id, seller, itemPrice, shippingPrice: shipping,
      landedPrice: Math.round((itemPrice + shipping) * 100) / 100,
      soldQuantity: 0, observedAt: observed.observedAt, conditionId: "1000" }]
  })
  const distribution = buildEbayBoundedPriceDistributionV1(eligible, true)
  // Each seller gets one vote in the supported target. Listing spam from one
  // seller cannot push the target up. The normal market reducer handles MAD.
  const sellerPrices = [...new Set(eligible.map((entry) => entry.seller))]
    .flatMap((seller) => {
      const own = buildEbayBoundedPriceDistributionV1(eligible.filter((entry) =>
        entry.seller === seller && distribution &&
        entry.landedPrice >= distribution.minimumLandedPrice &&
        entry.landedPrice <= distribution.maximumLandedPrice))
      return own?.medianLandedPrice ? [{ seller,
        landedPrice: own.medianLandedPrice, soldQuantity: 0 }] : []
    })
  const target = buildEbayBoundedPriceDistributionV1(sellerPrices)?.medianLandedPrice ?? null
  const sufficient = Boolean(distribution && distribution.sampleSize >= 3 &&
    distribution.sellerCount >= 2 && sellerPrices.length >= 2 &&
    distribution.maximumLandedPrice <= distribution.minimumLandedPrice * 2)
  return Object.freeze({ sufficient, distribution, priceRange: range(distribution),
    sellerBalancedTarget: target, evidence: eligible,
    source: "EBAY_BROWSE_ACTIVE_LISTING" as const,
    realizedSoldPriceProven: false })
}

/** Read-only existing authorities; no capability, plan, evidence or job writes. */
export async function readCommercialPricingContextV1(input: Readonly<{
  supabase: SupabaseClient; accountKey: string; productTruthRow: Row; now?: Date
}>): Promise<CommercialPricingContextV1> {
  const unavailable = (readStatus: string): CommercialPricingContextV1 => ({
    demandProven: false, demandReceipt: null, aggregateSold: null, readStatus })
  const now = input.now ?? new Date()
  const variant = input.productTruthRow
  if (!variant.identity_result || !text(variant.product_id) || !text(variant.variant_id) ||
      !text(variant.sku) || !text(variant.title)) return unavailable("IDENTITY_UNAVAILABLE")
  const fingerprint = buildLunaPreResearchProductTruthFingerprintV1({
    product_id: text(variant.product_id), variant_id: text(variant.variant_id),
    sku: text(variant.sku), title: text(variant.title),
    product_type: text(variant.product_type) || null, identity_result: variant.identity_result })
  const key = buildLunaPreResearchIdentityKeyV1({ productId: text(variant.product_id),
    variantId: text(variant.variant_id), sku: text(variant.sku), productTruthFingerprint: fingerprint })
  const read = await input.supabase.from("marketplace_product_research_query_plans")
    .select("id,status,pre_research_result,pre_research_trace_eligible,pre_research_completed_at,pre_research_evidence_digest,pre_research_evidence,source_product_truth_fingerprint,source_candidate_key")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("source_context", "LUNA_PRE_RESEARCH").eq("source_luna_product_id", text(variant.product_id))
    .eq("subject_supplier_variant_id", text(variant.variant_id))
    .eq("source_supplier_sku", text(variant.sku)).eq("source_candidate_key", key)
    .eq("source_product_truth_fingerprint", fingerprint).is("pre_research_rerun_cohort_id", null)
    .eq("status", "COMPLETED").order("pre_research_completed_at", { ascending: false }).limit(1).maybeSingle()
  if (read.error || !read.data) return unavailable("CANONICAL_DEMAND_UNAVAILABLE")
  const plan = row(read.data)
  const evidence = row(plan.pre_research_evidence)
  const proven = plan.pre_research_result === "PRE_RESEARCH_HIGH" &&
    plan.pre_research_trace_eligible === true &&
    plan.source_product_truth_fingerprint === fingerprint && plan.source_candidate_key === key &&
    evidence.contractVersion === "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19" &&
    evidence.productTruthFingerprint === fingerprint && evidence.planId === plan.id &&
    evidence.productId === variant.product_id && evidence.variantId === variant.variant_id &&
    evidence.sku === variant.sku &&
    HASH.test(text(plan.pre_research_evidence_digest)) &&
    fresh(plan.pre_research_completed_at, now, 90 * DAY) &&
    (numeric(evidence.exactComparableCount) ?? 0) +
      (numeric(evidence.closeVariantComparableCount) ?? 0) >= 2 &&
    (numeric(evidence.acceptedComparableSoldQuantity) ?? 0) >= 3
  if (!proven) return unavailable("DEMAND_NOT_STRONG_OR_CURRENT")
  const demandReceipt = { planId: plan.id, evidenceDigest: plan.pre_research_evidence_digest,
    sourceCandidateKey: key, productTruthFingerprint: fingerprint,
    observedAt: plan.pre_research_completed_at, snapshotId: evidence.sourceSnapshotId,
    accountKey: input.accountKey, exactComparableCount: evidence.exactComparableCount,
    acceptedSoldQuantity: evidence.acceptedComparableSoldQuantity }
  const result: CommercialPricingContextV1 = { demandProven: true, demandReceipt,
    aggregateSold: null, readStatus: "DEMAND_PROVEN_AGGREGATE_UNAVAILABLE" }
  const canonical = await input.supabase.from("seller_os_product_research_canonical_evidence_v2")
    .select("plan_id,marketplace_account_key,marketplace,item_id,query_provenance_hashes,source_observation_id,source_capture_batch_id,structural_classification,structural_compatibility,price_evidence,seller_evidence")
    .eq("plan_id", plan.id).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").order("item_id").limit(100)
  if (canonical.error || !canonical.data?.length) return result
  const rows = canonical.data.map(row)
  const ids = [...new Set(rows.map((value) => text(value.source_observation_id)).filter(Boolean))]
  const captureIds = [...new Set(rows.map((value) => text(value.source_capture_batch_id)).filter(Boolean))]
  if (!ids.length || !captureIds.length) return result
  const [observations, captures] = await Promise.all([
    input.supabase.from("marketplace_product_research_capture_observations")
      .select("id,capture_batch_id,marketplace_account_key,marketplace,source_listing_id,item_sales,confirmed_sold_quantity,last_sold_date")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US").in("id", ids).limit(100),
    input.supabase.from("marketplace_product_research_capture_batches")
      .select("id,marketplace_account_key,marketplace,source,search_query_hash,date_range,captured_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US").in("id", captureIds).limit(100),
  ])
  if (observations.error || captures.error) return result
  return { ...result, readStatus: "CANONICAL_EVIDENCE_READ",
    aggregateSold: buildCanonicalAggregateSoldPricingV1({ evidence: rows,
      observations: (observations.data ?? []).map(row), captures: (captures.data ?? []).map(row),
      accountKey: input.accountKey, planId: text(plan.id), now }) }
}
