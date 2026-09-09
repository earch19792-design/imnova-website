import { getEbaySellerAccountScopeConfiguration, getEbayProductionIdentityBindingConfiguration } from "./ebay-seller-account-scope"
import { feeRecordV1 as record, feeDigestV1 } from "../seller-os/ebay-fee-producer-v1"
import { adsOfficialContractV1, type AdsOfficialObservationV1 } from "../seller-os/ebay-ads-revenue-activation-v1"
import contract from "../../docs/ebay-ads-revenue-official-contract-v1.json" with { type: "json" }

const array = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null
const id = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v) ? v : null
/** Never interpret an omitted quota or rate as zero or available. */
export function adsQuotaAvailableV1(payload: unknown, now: Date) {
  const matching = array(record(payload).rateLimits).filter(x => x.apiContext === "sell" && x.apiName === "marketing")
  const rates = matching.flatMap(x => array(x.resources).flatMap(r => array(r.rates)))
  return rates.length > 0 && rates.every(r => num(r.remaining) !== null && num(r.remaining)! >= 10 &&
    num(r.limit) !== null && num(r.limit)! > 0 && Date.parse(String(r.reset)) > now.getTime())
}
export function adsErrorDispositionV1(httpStatus: number, dispatched = false) {
  if (dispatched && (httpStatus === 0 || httpStatus >= 500)) return "UNKNOWN_COMMIT_READBACK_REQUIRED"
  if (httpStatus === 429) return "QUOTA_HOLD"
  if (httpStatus === 401 || httpStatus === 403) return "REAUTH_OR_ACCOUNT_ATTENTION"
  return httpStatus >= 500 || httpStatus === 0 ? "TEMPORARY_UPSTREAM_FAILURE" : "REQUEST_OR_BUSINESS_ATTENTION"
}

/** Current official docs determine paths. One bounded read attempt, no Ads POST
 * or DELETE. The caller must first verify the durable quota/current-LIVE gate. */
export async function readAdsActivationOfficialV1(input: { accountKey: string; itemId: string; currentLiveFresh: boolean;
  now?: Date; fetchImpl?: typeof fetch; applicationToken?: () => Promise<string> }) {
  const now = input.now ?? new Date(), fetcher = input.fetchImpl ?? fetch
  let calls = 0
  if (!input.currentLiveFresh) return { observation: null, error: "CURRENT_LIVE_QUOTA_HOLD", officialApiCalls: 0 }
  if (!adsOfficialContractV1(now).certified) return { observation: null, error: "OFFICIAL_CONTRACT_REVIEW_REQUIRED", officialApiCalls: 0 }
  const counted: typeof fetch = async (...args) => { calls++; return fetcher(...args) }
  try {
    const scope = getEbaySellerAccountScopeConfiguration(), identity = getEbayProductionIdentityBindingConfiguration()
    if (scope.accountKey !== input.accountKey || !identity.bound || !identity.consistent || !/^\d{9,20}$/.test(input.itemId)) throw Error("ADS_CANONICAL_ACCOUNT_REQUIRED")
    const clientId = process.env.EBAY_CLIENT_ID?.trim(), secret = process.env.EBAY_CLIENT_SECRET?.trim(), refresh = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim()
    if (!clientId || !secret || !refresh) throw Error("ADS_READONLY_OAUTH_REQUIRED")
    const tokenResponse = await counted("https://api.ebay.com/identity/v1/oauth2/token", { method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh,
        scope: ["https://api.ebay.com/oauth/api_scope", "https://api.ebay.com/oauth/api_scope/sell.account.readonly", "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly"].join(" ") }),
      signal: AbortSignal.timeout(7000), cache: "no-store" })
    const tokenBody = record(await tokenResponse.json())
    if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") throw Error(tokenBody.error === "invalid_scope" ? "ADS_READONLY_SCOPE_REAUTH_REQUIRED" : "ADS_READONLY_OAUTH_FAILED")
    const token = tokenBody.access_token
    const { verifyEbayCommercialOfficialAccount } = await import("./ebay-commercial-readers")
    await verifyEbayCommercialOfficialAccount(token, counted)
    async function get(operationId: string, params: Record<string,string> = {}, query: Record<string,string> = {}, authToken = token) {
      const op = contract.operations.find(x => x.operationId === operationId)
      if (!op || op.method !== "GET") throw Error("ADS_READONLY_OPERATION_BLOCKED")
      let path = op.path
      for (const [key,value] of Object.entries(params)) { if (!id(value)) throw Error("ADS_OFFICIAL_ID_INVALID"); path = path.replace(`{${key}}`,value) }
      if (path.includes("{")) throw Error("ADS_OFFICIAL_ID_REQUIRED")
      const root = op.api === "account" ? "/sell/account/v1" : op.api === "developer-analytics" ? "/developer/analytics/v1_beta" : "/sell/marketing/v1"
      const url = new URL(`https://api.ebay.com${root}${path}`)
      Object.entries(query).forEach(([k,v]) => url.searchParams.set(k,v))
      const r = await counted(url,{ method: "GET", headers: { Authorization: `Bearer ${authToken}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" }, cache:"no-store",signal:AbortSignal.timeout(7000) })
      const body = record(await r.json().catch(() => ({})))
      if (!r.ok) { const ids = array(body.errors).map(e => num(e.errorId)).filter(v => v !== null).slice(0,3).join("_"); throw Error(`ADS_${adsErrorDispositionV1(r.status)}_${r.status}${ids ? `_${ids}` : ""}`) }
      return body
    }
    const eligibility = await get("getAdvertisingEligibility",{}, { program_types: contract.eligibility.programType })
    const programs = array(eligibility.advertisingEligibility).filter(p => p.programType === contract.eligibility.programType)
    if (programs.length !== 1 || programs[0].status !== contract.eligibility.eligibleStatus) throw Error("ADS_ACCOUNT_NOT_ELIGIBLE_OR_UNPROVEN")
    const applicationToken = input.applicationToken ?? (await import("./ebay-seller-keyword-demand-gateway")).getEbayBaseApplicationTokenV1
    const appToken = await applicationToken()
    const quota = await get("getRateLimits",{}, {api_context:"sell",api_name:"marketing"},appToken)
    const userQuota = await get("getUserRateLimits",{}, {api_context:"sell",api_name:"marketing"})
    if (!adsQuotaAvailableV1(quota,now) || !adsQuotaAvailableV1(userQuota,now)) throw Error("ADS_OFFICIAL_QUOTA_UNPROVEN_OR_EXHAUSTED")
    const campaigns = await get("getCampaigns",{}, { funding_strategy:"CPS",campaign_status:"RUNNING",limit:"50",offset:"0" })
    // Incomplete pagination never proves absence or authorizes a second ad.
    if (campaigns.next || num(campaigns.total) !== array(campaigns.campaigns).length) throw Error("ADS_CAMPAIGN_PAGINATION_INCOMPLETE")
    const matches = array(campaigns.campaigns).filter(c => c.marketplaceId === "EBAY_US" && c.campaignStatus === "RUNNING" && record(c.fundingStrategy).fundingModel === "CPS")
    if (matches.length !== 1 || !id(matches[0].campaignId)) throw Error("ADS_ONE_EXISTING_CPS_CAMPAIGN_REQUIRED")
    const campaignId = id(matches[0].campaignId)!
    const campaign = await get("getCampaign",{campaign_id:campaignId})
    if (campaign.campaignId !== campaignId || campaign.marketplaceId !== "EBAY_US" || campaign.campaignStatus !== "RUNNING" ||
      record(campaign.fundingStrategy).fundingModel !== "CPS" || ![undefined,"FIXED"].includes(record(campaign.fundingStrategy).adRateStrategy as string | undefined)) throw Error("ADS_FIXED_RUNNING_CAMPAIGN_REQUIRED")
    const ads = await get("getAds",{campaign_id:campaignId},{listing_ids:input.itemId,limit:"50",offset:"0"})
    if (ads.next || num(ads.total) !== array(ads.ads).length) throw Error("ADS_AD_READBACK_INCOMPLETE")
    const exact = array(ads.ads).filter(a => a.listingId === input.itemId)
    if (exact.length > 1 || array(ads.ads).length !== exact.length) throw Error("ADS_DUPLICATE_OR_WRONG_LISTING")
    const suggested = exact.length ? null : await get("suggestItems",{campaign_id:campaignId},{limit:"500",offset:"0"})
    const eligibleListing = exact.length === 1 || array(suggested?.suggestedItems).some(i => i.listingId === input.itemId)
    const ad = exact[0], currentRate = ad ? num(ad.bidPercentage) : null
    if (ad && (!id(ad.adId) || currentRate === null || currentRate < 2 || currentRate > 100)) throw Error("ADS_CURRENT_RATE_UNPROVEN")
    const observation: AdsOfficialObservationV1 = {accountKey:input.accountKey,itemId:input.itemId,observedAt:now.toISOString(),freshUntil:new Date(now.getTime()+60000).toISOString(),
      reference:feeDigestV1({eligibility,campaign,ads,suggested,quota,userQuota}),accountEligible:true,listingEligible:eligibleListing ? true : null,
      termsAccepted:true, campaignId,adId:ad ? id(ad.adId) : null,campaignRunning:true,fundingModel:"CPS",adRateStrategy:"FIXED",
      currentAdState:ad ? "ACTIVE":"INACTIVE",currentAdRate:currentRate,recommendedRate:null,quotaAvailable:true}
    return {observation,error:null,officialApiCalls:calls,termsEvidence:"INFERRED_FROM_ELIGIBLE_ACCOUNT_AND_EXISTING_RUNNING_CPS_CAMPAIGN"}
  } catch(error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,180}$/.test(error.message) ? error.message : "ADS_OFFICIAL_READ_UNAVAILABLE"
    return {observation:null,error:code,officialApiCalls:calls}
  }
}
