import contract from "../../docs/ebay-ads-revenue-official-contract-v1.json" with { type: "json" }
import variableCosts from "../../docs/owner-variable-cost-policy-v1.json" with { type: "json" }
import { consumeListingFeeAuthorityV1 } from "./listing-fee-authority-v1"
import { EBAY_FEE_AUTHORITY_V1, feeRecordV1 as record, feeDigestV1 } from "./ebay-fee-producer-v1"
import { listingEconomicsV1, validatePromotionPolicyV1, type Economics, type PromotionPolicy } from "./listing-treatment-engine-v1"

export const ADS_REVENUE_ACTIVATION_V1 = "SELLER_OS_EBAY_ADS_REVENUE_ACTIVATION_FINAL_V1"
const arr = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const amount = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null
const down = (n: number) => Math.floor(n * 100 + 1e-9) / 100
const ceil = (n: number) => Math.ceil(n * 100 - 1e-9) / 100
const fresh = (v: Record<string, unknown>, now: Date) => Date.parse(String(v.observedAt)) <= now.getTime() && Date.parse(String(v.freshUntil)) > now.getTime()
export function adsOfficialContractV1(now: Date) {
  const operations = ["getAdvertisingEligibility", "getCampaigns", "getCampaign", "getAds", "getAd", "createAdByListingId", "updateBid", "deleteAd", "findCampaignByAdReference", "suggestItems"]
  const pass = fresh({ observedAt: contract.reviewedAt, freshUntil: contract.reviewDueAt }, now) &&
    operations.every(id => contract.operations.some(op => op.operationId === id && op.success.length && op.errors.length)) &&
    contract.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256))
  return { certified: pass, reference: contract.contractVersion, reviewedAt: contract.reviewedAt, reviewDueAt: contract.reviewDueAt,
    scope: "OFFICIAL_DOCUMENTED_CONTRACT", accountEligibilityProven: false, marketplaceWrites: 0 }
}

/** All values must come from the server's current authority, never UI amounts.
 * The ad basis may be a conservative bound larger than the item sale price. */
export function adsCanaryEconomicsV1(e: Economics, policy: PromotionPolicy, recommendedRate: number | null) {
  validatePromotionPolicyV1(policy)
  const result = listingEconomicsV1(e)
  const empty = { ...result, maxSafeAdRatePct: null as number | null, allowedAdRate: null as number | null,
    proposedAdRatePct: null as number | null, projectedAdCost: null as number | null,
    projectedProfitAfterAds: null as number | null, projectedMarginAfterAds: null as number | null,
    promotionBlockedMargin: false, status: "BLOCKED_EVIDENCE" }
  if (result.economicsUnproven || !e.adFeeBasis.fresh || !e.adFeeBasis.reference || e.adFeeBasis.value === null || e.adFeeBasis.value < e.salePrice.value!) return empty
  // A cent of reserved profit cannot be spent by rounding the fee up.
  const room = down(result.profitBeforeAds! - Math.max(policy.minProfit, e.salePrice.value! * policy.minMargin / 100))
  const maxSafeAdRatePct = Math.max(0, Math.min(100, down(room / e.adFeeBasis.value * 100)))
  const cap = recommendedRate === null || !Number.isFinite(recommendedRate) || recommendedRate < 0 || recommendedRate > 100 ? null :
    Math.min(recommendedRate, policy.maxRate, maxSafeAdRatePct)
  const rate = cap === null ? null : Math.floor(cap * 10 + 1e-9) / 10
  const blockedMargin = room < 0 || maxSafeAdRatePct < policy.minRate
  if (blockedMargin || rate === null || rate < policy.minRate || rate < contract.adRate.apiMinPct)
    return { ...empty, maxSafeAdRatePct, allowedAdRate: cap, promotionBlockedMargin: blockedMargin,
      status: blockedMargin ? "BLOCKED_MARGIN" : rate === null ? "RECOMMENDED_RATE_REQUIRED" : "NO_REPRESENTABLE_RATE_IN_POLICY" }
  const projectedAdCost = ceil(e.adFeeBasis.value * rate / 100)
  const projectedProfitAfterAds = down(result.profitBeforeAds! - projectedAdCost)
  const projectedMarginAfterAds = projectedProfitAfterAds / e.salePrice.value! * 100
  const safe = projectedProfitAfterAds + 1e-9 >= policy.minProfit && projectedMarginAfterAds + 1e-9 >= policy.minMargin
  return { ...empty, maxSafeAdRatePct, allowedAdRate: cap, proposedAdRatePct: safe ? rate : null,
    projectedAdCost: safe ? projectedAdCost : null, projectedProfitAfterAds: safe ? projectedProfitAfterAds : null,
    projectedMarginAfterAds: safe ? projectedMarginAfterAds : null, promotionBlockedMargin: !safe,
    status: !safe ? "BLOCKED_MARGIN" : policy.mode === "OFF" ? "POLICY_OFF" : "PREVIEW_READY" }
}

export type AdsOfficialObservationV1 = {
  accountKey: string; itemId: string; observedAt: string; freshUntil: string; reference: string;
  accountEligible: boolean | null; listingEligible: boolean | null; termsAccepted: boolean | null;
  campaignId: string | null; adId: string | null; campaignRunning: boolean; fundingModel: string | null;
  adRateStrategy: string | null; currentAdState: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  currentAdRate: number | null; recommendedRate: number | null; quotaAvailable: boolean;
}

export function buildAdsActivationListingV1(input: { accountKey: string; raw: unknown; currentItemIds: readonly string[];
  currentLiveFresh: boolean; policyOverride?: PromotionPolicy; official?: AdsOfficialObservationV1 | null; now: Date }) {
  const raw = record(input.raw), itemId = String(raw.itemId), listings = arr(raw.listings), evidence = arr(raw.evidence)
  const listing = listings.length === 1 ? listings[0] : {}, heads = arr(raw.feeHeads)
  const head = heads.length === 1 ? heads[0] : {}, authority = record(head.authority)
  const blockers: string[] = []
  const listingRecent = Date.parse(String(listing.last_ebay_sync_at)) <= input.now.getTime() &&
    Date.parse(String(listing.last_ebay_sync_at)) > input.now.getTime() - 3600000 && String(listing.source).startsWith("EBAY_TRADING_")
  const exact = input.currentLiveFresh && input.currentItemIds.includes(itemId) && listing.ebay_item_id === itemId && typeof listing.ebay_sku === "string" && listingRecent
  if (!exact) blockers.push("EXACT_CURRENT_LISTING_REQUIRED")
  const inStock = exact && amount(listing.ebay_quantity) !== null && Number(listing.ebay_quantity) > 0
  if (!inStock) blockers.push("CURRENT_STOCK_REQUIRED")
  const component = (type: string) => {
    const rows = evidence.filter(e => e.evidence_type === type), row = rows.length === 1 ? rows[0] : {}
    return { value: amount(row.value_amount), reference: typeof row.evidence_id === "string" ? row.evidence_id : null,
      fresh: row.freshness_status === "FRESH" && row.value_currency === "USD" && fresh({ observedAt: row.captured_at, freshUntil: row.fresh_until }, input.now) }
  }
  const e = Object.fromEntries(Object.entries({ salePrice: "EBAY_LIVE_PRICE", productCost: "LUNA_CURRENT_COST", shippingCost: "LUNA_CURRENT_SHIPPING", ebayFees: "EXPECTED_EBAY_FEE", otherCosts: "OTHER_EXPLICIT_COSTS" }).map(([k,v]) => [k,component(v)])) as Omit<Economics,"adFeeBasis">
  if (amount(listing.ebay_price) !== e.salePrice.value || listing.currency !== "USD") e.salePrice.fresh = false
  const fee = consumeListingFeeAuthorityV1({ accountKey: input.accountKey, itemId, categoryId: typeof authority.categoryId === "string" ? authority.categoryId : null,
    salePrice: e.salePrice.value, now: input.now, metadata: { feeAuthorityV1: authority.resolvedAuthority } })
  const feeProven = authority.contractVersion === EBAY_FEE_AUTHORITY_V1 && authority.marketplaceAccountKey === input.accountKey &&
    authority.itemId === itemId && head.sku === listing.ebay_sku && authority.sku === listing.ebay_sku &&
    head.state === "PROVEN_PRE_SALE" && authority.state === "PROVEN_PRE_SALE" && fresh(authority, input.now) && fee.status === "PROVEN"
  const supportedListingModel = ["FixedPriceItem", "FIXED_PRICE"].includes(String(record(authority.resolvedAuthority).saleFormat))
  if (!supportedListingModel) blockers.push("ADS_FIXED_PRICE_LISTING_REQUIRED")
  e.ebayFees = { value: feeProven ? fee.amount : null, reference: feeProven ? fee.reference : null, fresh: feeProven }
  if (variableCosts.OWNER_VARIABLE_COST_POLICY_CONFIRMED && variableCosts.marketplaceAccountKey === input.accountKey &&
    variableCosts.observedCurrentItemIds.includes(itemId) && e.productCost.fresh && e.shippingCost.fresh && feeProven && e.otherCosts.value === null)
    e.otherCosts = { value: variableCosts.OTHER_PROVEN_VARIABLE_COSTS, reference: variableCosts.contractVersion, fresh: true }
  const economics: Economics = { ...e, adFeeBasis: { value: feeProven ? fee.adFeeBasis : null, reference: feeProven ? fee.reference : null, fresh: feeProven } }
  // A bound on base fees does not automatically bound tax/conversion on an
  // additional advertising fee. Require explicit non-applicability here.
  if (feeProven && ["TAX_ON_FEES", "CURRENCY_CONVERSION"].some(type =>
    !arr(record(authority.resolvedAuthority).components).some(c => c.type === type && c.status === "NOT_APPLICABLE" && c.amount === 0))) {
    economics.adFeeBasis.fresh = false
    blockers.push("AD_INCREMENTAL_TAX_OR_CONVERSION_BOUND_REQUIRED")
  }
  const base = listingEconomicsV1(economics)
  blockers.push(...base.missing.map(k => `ECONOMICS_REQUIRED:${k}`))
  if (!feeProven) blockers.push("SELLER_OS_EBAY_FEE_AUTHORITY_REQUIRED", ...fee.blockers)
  const draft = record(raw.policyDraft), policy = input.policyOverride ?? draft.policy as PromotionPolicy | undefined
  let policyValid = false
  try { validatePromotionPolicyV1(policy!); policyValid = true } catch (error) { blockers.push(error instanceof Error ? error.message : "OWNER_POLICY_REQUIRED") }
  if (policyValid && policy!.window !== "NOW" && (Date.parse(policy!.startsAt!) > input.now.getTime() || Date.parse(policy!.endsAt!) <= input.now.getTime())) blockers.push("OWNER_POLICY_WINDOW_NOT_ACTIVE")
  const o = input.official
  const officialFresh = !!o && o.accountKey === input.accountKey && o.itemId === itemId && !!o.reference && fresh(o, input.now)
  const contractState = adsOfficialContractV1(input.now)
  if (!contractState.certified) blockers.push("OFFICIAL_ADS_CONTRACT_REVIEW_REQUIRED")
  for (const [condition, code] of [
    [officialFresh && o?.accountEligible === true, "ACCOUNT_ADS_ELIGIBILITY_REQUIRED"],
    [officialFresh && o?.listingEligible === true, "LISTING_ADS_ELIGIBILITY_REQUIRED"],
    [officialFresh && o?.termsAccepted === true, "PROMOTED_LISTINGS_TERMS_EVIDENCE_REQUIRED"],
    [officialFresh && o?.quotaAvailable, "ADS_OFFICIAL_QUOTA_REQUIRED"],
    [officialFresh && !!o?.campaignId && o.campaignRunning && o.fundingModel === "CPS" && o.adRateStrategy === "FIXED", "EXISTING_RUNNING_FIXED_CPS_CAMPAIGN_REQUIRED"],
    [officialFresh && (o?.currentAdState === "INACTIVE" || o?.currentAdState === "ACTIVE" && !!o.adId && amount(o.currentAdRate) !== null), "CURRENT_AD_READBACK_REQUIRED"],
  ] as const) if (!condition) blockers.push(code)
  // The smallest representable OWNER rate is Mayel's technical TEST proposal;
  // an official recommendation, when present, retains its own independent cap.
  const recommendedRate = policyValid ? (officialFresh ? o!.recommendedRate : null) ?? Math.ceil(policy!.minRate * 10 - 1e-9) / 10 : null
  const promotion = policyValid ? adsCanaryEconomicsV1(economics, policy!, recommendedRate) : null
  if (promotion?.status !== "PREVIEW_READY") blockers.push(promotion?.status ?? "OWNER_POLICY_INVALID")
  if (o?.currentAdState === "ACTIVE" && promotion?.proposedAdRatePct === o.currentAdRate) blockers.push("ALREADY_AT_REQUESTED_RATE_NO_ACTION")
  const ready = blockers.length === 0
  const preview = { ITEM_ID: itemId, TITLE: typeof listing.title === "string" ? listing.title : null,
    CURRENT_AD_STATE: officialFresh ? o!.currentAdState : "UNKNOWN", SALE_PRICE: e.salePrice.fresh ? e.salePrice.value : null,
    PRODUCT_COST: e.productCost.fresh ? e.productCost.value : null, SHIPPING: e.shippingCost.fresh ? e.shippingCost.value : null,
    EBAY_FEES: e.ebayFees.value, OTHER_VARIABLE_COSTS: e.otherCosts.fresh ? e.otherCosts.value : null,
    PROFIT_BEFORE_ADS: base.profitBeforeAds, MARGIN_BEFORE_ADS: base.marginBeforeAds, OWNER_POLICY: policy ?? null,
    MAX_SAFE_AD_RATE_PCT: promotion?.maxSafeAdRatePct ?? null, PROPOSED_AD_RATE_PCT: promotion?.proposedAdRatePct ?? null,
    PROJECTED_AD_COST: promotion?.projectedAdCost ?? null, PROJECTED_PROFIT_AFTER_ADS: promotion?.projectedProfitAfterAds ?? null,
    PROJECTED_MARGIN_AFTER_ADS: promotion?.projectedMarginAfterAds ?? null,
    OWNER_APPROVAL_REQUIRED: true, projectionUnit: "ONE_ATTRIBUTED_SALE_NOT_A_SALES_FORECAST" }
  return { itemId, status: ready ? "OWNER_APPROVAL_REQUIRED" : "BLOCKED", preview, blockers: [...new Set(blockers)],
    treatment: "TEST", warmMetricsRequired: false, exactItemBinding: exact, inStock, supportedListingModel,
    recommendedRateSource: officialFresh && o!.recommendedRate !== null ? "OFFICIAL_EBAY_RECOMMENDATION" : "MAYEL_TECHNICAL_TEST_OWNER_MINIMUM",
    economicsProven: !base.economicsUnproven && feeProven, ebayFeeAuthorityPass: feeProven,
    basePreSaleFeeProven: authority.basePreSaleFeeProven === true,
    contingentOrderComponents: authority.contingentOrderComponents ?? null,
    postSaleLearning: { feeReconciliation: raw.latestFeeReconciliation ?? null, adSpend: null, attributedSales: null,
      profitAfterAds: null, status: "OFFICIAL_AD_REPORT_EVIDENCE_REQUIRED", causalAttribution: false },
    feeEstimateMode: authority.feeEstimateMode ?? null, economicsAutoResolution: true, codexRequiredForListingEconomics: false,
    ownerPolicyLoaded: !!policy, ownerPolicyValid: policyValid, policySource: input.policyOverride ? "CURRENT_OWNER_PREVIEW_INPUT" : draft.id ?? null,
    promotionBlockedMargin: promotion?.promotionBlockedMargin ?? false,
    ebayAdsOfficialContractCertified: contractState.certified, listingEligibleForAds: officialFresh ? o!.listingEligible : null,
    singleListingAdsCanaryReady: ready, approvalDigest: ready ? feeDigestV1({ accountKey: input.accountKey, preview, evidence, authorityId: authority.authorityId, official: o }) : null,
    ebayAdsWriteEnabled: false, multiListingAdsWriteEnabled: false, marketplaceWrites: 0, ebayAdsWrites: 0 }
}

/** Select one technical TEST canary; warm metrics are never an eligibility proxy. */
export function selectAdsCanaryV1(rows: ReturnType<typeof buildAdsActivationListingV1>[]) {
  if (rows.length > 20 || new Set(rows.map(r => r.itemId)).size !== rows.length) throw Error("ADS_BOUNDED_UNIQUE_LISTINGS_REQUIRED")
  return rows.filter(r => r.singleListingAdsCanaryReady).sort((a,b) => a.itemId.localeCompare(b.itemId))[0] ?? null
}
