import { feeRecordV1 as record } from "./ebay-fee-producer-v1"
import { buildAdsActivationListingV1 } from "./ebay-ads-revenue-activation-v1"
import variableCosts from "../../docs/owner-variable-cost-policy-v1.json" with { type: "json" }

/** Exact evidence diagnosis, independent of Ads eligibility or warm metrics.
 * Counts overlap: every blocker is recorded once per listing. */
export function classifyEconomicsBlockersV1(input: {accountKey:string;raw:unknown;now:Date}) {
  const raw=record(input.raw), itemId=String(raw.itemId)
  const row=buildAdsActivationListingV1({...input,currentItemIds:[],currentLiveFresh:false})
  const evidence=(Array.isArray(raw.evidence)?raw.evidence:[]).map(record)
  const reasons:string[]=[]
  for(const type of ["EBAY_LIVE_PRICE","LUNA_CURRENT_COST","LUNA_CURRENT_SHIPPING"]){
    const matches=evidence.filter(e=>e.evidence_type===type), e=matches.length===1?matches[0]:{}
    const prefix=type==="EBAY_LIVE_PRICE"?"SALE_PRICE":type==="LUNA_CURRENT_COST"?"PRODUCT_COST":"SHIPPING"
    if(!e.evidence_id) reasons.push(`${prefix}:MISSING_EVIDENCE`)
    else if(e.value_amount===null) reasons.push(`${prefix}:${e.limitation_code??"MISSING_AMOUNT"}`)
    else if(e.freshness_status!=="FRESH" || e.value_currency!=="USD" || !(Date.parse(String(e.captured_at))<=input.now.getTime())) reasons.push(`${prefix}:UNPROVEN_EVIDENCE`)
    else if(!(Date.parse(String(e.fresh_until))>input.now.getTime())) reasons.push(`${prefix}:STALE`)
  }
  const heads=(Array.isArray(raw.feeHeads)?raw.feeHeads:[]).map(record), a=record(heads[0]?.authority)
  if(heads.length!==1) reasons.push(heads.length?"FEE_AUTHORITY:AMBIGUOUS_HEAD":"FEE_AUTHORITY:MISSING_HEAD")
  if(heads.length===1 && !row.ebayFeeAuthorityPass){
    if(!(Date.parse(String(a.freshUntil))>input.now.getTime())) reasons.push("FEE_AUTHORITY:STALE")
    for(const c of (Array.isArray(a.components)?a.components:[]).map(record)) if(c.pendingDependency)
      reasons.push(`FEE_AUTHORITY:${c.status}:${c.pendingDependency}`)
    if(a.state==="PROVEN_PRE_SALE") reasons.push("FEE_AUTHORITY:INVALID_BINDING_OR_RESOLVED_PROOF")
  }
  const legacy=evidence.find(e=>e.evidence_type==="EXPECTED_EBAY_FEE")
  if(!row.ebayFeeAuthorityPass && legacy?.value_amount!=null) reasons.push("FEE_AUTHORITY:LEGACY_NUMERIC_FEE_NOT_AUTHORITY")
  if(!row.ebayFeeAuthorityPass && legacy?.limitation_code==="OFFICIAL_CATEGORY_FEE_POLICY_NOT_CERTIFIED") reasons.push("FEE_AUTHORITY:OFFICIAL_CATEGORY_POLICY_NOT_CERTIFIED")
  if(row.preview.OTHER_VARIABLE_COSTS===null) reasons.push(variableCosts.marketplaceAccountKey===input.accountKey && variableCosts.observedCurrentItemIds.includes(itemId)
    ? "OTHER_COSTS:EXPLICIT_OWNER_POLICY_WAITING_FOR_PROVEN_DEPENDENCIES" : "OTHER_COSTS:EXPLICIT_AUTHORITY_REQUIRED")
  if(row.economicsProven && row.preview.MAX_SAFE_AD_RATE_PCT===null) reasons.push("AD_BASIS:SAFE_BOUND_OR_OWNER_POLICY_REQUIRED")
  return {itemId,economicsProven:row.economicsProven,status:row.economicsProven?"ECONOMICS_PROVEN":"PROMOTION_BLOCKED_EVIDENCE",
    reasons:[...new Set(reasons)],contingentOrderState:a.contingentOrderComponents?"PENDING_ORDER_CONTEXT":null,
    pendingOrderContextIsError:false,feeEstimateMode:row.feeEstimateMode,preview:row.preview}
}
export function quotaHoldEconomicsReportV1(input:{accountKey:string;rawRows:unknown[];now:Date}) {
  const rows=input.rawRows.map(raw=>classifyEconomicsBlockersV1({...input,raw}))
  if(new Set(rows.map(r=>r.itemId)).size!==rows.length || rows.length>100) throw Error("ECONOMICS_UNIQUE_BOUNDED_SCOPE_REQUIRED")
  const counts:Record<string,number>={}
  for(const row of rows) for(const reason of row.reasons) counts[reason]=(counts[reason]??0)+1
  return {status:"EBAY_QUOTA_HOLD",observedAt:input.now.toISOString(),examined:rows.length,rows,
    economicsBlockerCountsByReason:counts,countsAreOverlapping:true,
    newListingEconomicsAutoResolution:true,ownerManualEconomicsRepairRequired:false,codexRuntimeDependency:false,
    marketplaceWrites:0,ebayAdsWrites:0,officialApiCalls:0,
    resume:postQuotaResetResumeV1({quotaHeld:true,currentEvidenceFresh:false,economicsProven:false,eligibilityProven:false,canaryItemId:null})}
}
export function postQuotaResetResumeV1(input:{quotaHeld:boolean;currentEvidenceFresh:boolean;economicsProven:boolean;eligibilityProven:boolean;canaryItemId:string|null}) {
  const steps=["REFRESH_CURRENT_EBAY_EVIDENCE","RESOLVE_ECONOMICS","OFFICIAL_ADS_LISTING_ELIGIBILITY","SELECT_EXACTLY_ONE_SAFE_CANARY","SHOW_OWNER_PREVIEW","STOP_FOR_OWNER_APPROVAL"]
  const next=input.quotaHeld?"WAIT_FOR_QUOTA_RECOVERY":!input.currentEvidenceFresh?steps[0]:!input.economicsProven?steps[1]:
    !input.eligibilityProven?steps[2]:!input.canaryItemId?steps[3]:steps[4]
  return {steps,next,stopState:"OWNER_APPROVAL_REQUIRED",ownerApprovalRequired:true,automaticOwnerApproval:false,
    selectedCanaryCount:input.canaryItemId?1:0,ebayAdsWriteEnabled:false,multiListingAdsWriteEnabled:false,
    executionAuthority:"EXISTING_NORMAL_RUNTIME",codexRuntimeDependency:false}
}
