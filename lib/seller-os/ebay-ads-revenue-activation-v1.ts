import { adsPostSaleLearningV1 } from "./ads-post-sale-report-ingestion-v1"
import contract from "../../docs/ebay-ads-revenue-official-contract-v1.json" with { type: "json" }
import { adsCanaryEconomicsV1, resolvePreSaleEconomicsV1 } from "./pre-sale-economics-v1"
export { adsCanaryEconomicsV1 } from "./pre-sale-economics-v1"
import { feeRecordV1 as record, feeDigestV1 } from "./ebay-fee-producer-v1"
import { validatePromotionPolicyV1, type PromotionPolicy } from "./listing-treatment-engine-v1"

export const ADS_REVENUE_ACTIVATION_V1 = "SELLER_OS_EBAY_ADS_REVENUE_ACTIVATION_FINAL_V1"
const arr = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const amount = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null
const fresh = (v: Record<string, unknown>, now: Date) => Date.parse(String(v.observedAt)) <= now.getTime() && Date.parse(String(v.freshUntil)) > now.getTime()
export function adsOfficialContractV1(now: Date) {
  const operations = ["getAdvertisingEligibility", "getCampaigns", "getCampaign", "getAds", "getAd", "createAdByListingId", "updateBid", "deleteAd", "findCampaignByAdReference", "suggestItems"]
  const pass = fresh({ observedAt: contract.reviewedAt, freshUntil: contract.reviewDueAt }, now) &&
    operations.every(id => contract.operations.some(op => op.operationId === id && op.success.length && op.errors.length)) &&
    contract.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256))
  return { certified: pass, reference: contract.contractVersion, reviewedAt: contract.reviewedAt, reviewDueAt: contract.reviewDueAt,
    scope: "OFFICIAL_DOCUMENTED_CONTRACT", accountEligibilityProven: false, marketplaceWrites: 0 }
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
  const resolved = resolvePreSaleEconomicsV1({accountKey:input.accountKey,itemId,listing,evidence,feeHead:head,now:input.now})
  const {economics:e,fee,feeProven,base}=resolved
  const economics=e
  const supportedListingModel = ["FixedPriceItem", "FIXED_PRICE"].includes(String(record(authority.resolvedAuthority).saleFormat))
  if (!supportedListingModel) blockers.push("ADS_FIXED_PRICE_LISTING_REQUIRED")
  if (!resolved.incrementalAdCostsProven) blockers.push("AD_INCREMENTAL_TAX_OR_CONVERSION_BOUND_REQUIRED")
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
    postSaleLearning: adsPostSaleLearningV1({accountKey:input.accountKey,itemId,feeReconciliation:raw.latestFeeReconciliation,report:raw.latestAdsReport}),
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
