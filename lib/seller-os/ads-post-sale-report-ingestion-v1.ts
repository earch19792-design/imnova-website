import type { SupabaseClient } from "@supabase/supabase-js"
import { feeDigestV1, feeRecordV1 as record } from "./ebay-fee-producer-v1"

export const ADS_POST_SALE_REPORT_INGESTION_V1="SELLER_OS_ADS_POST_SALE_REPORT_INGESTION_CONTRACT_V1"
type Metric={value:number|null;sourceKey:string;currency:"USD";availability:"AVAILABLE"|"UNAVAILABLE"}
export type OfficialAdsReportObservationV1={
  accountKey:string;marketplace:"EBAY_US";itemId:string;campaignId:string;adId:string|null;
  reportId:string;reportTaskId:string;reportType:string;reportRevision:string;
  windowStart:string;windowEnd:string;observedAt:string;source:string;sourceSha256:string;
  // The official report metadata defines keys/units. A downloaded report is
  // normalized by a trusted server adapter, never by the OWNER preview route.
  metadataReference:string;metadataSha256:string;normalizerVersion:string;
  adSpend:Metric;attributedSales:Metric;currency:"USD";
}
const id=(v:unknown):v is string=>typeof v==="string" && /^[A-Za-z0-9_:.\-]{1,200}$/.test(v)
const hash=(v:unknown)=>typeof v==="string" && /^[a-f0-9]{64}$/.test(v)
const money=(v:unknown):v is number=>typeof v==="number" && Number.isFinite(v) && v>=0
function metric(m:Metric){
  if(!m || !id(m.sourceKey) || m.currency!=="USD" ||
    !(m.availability==="AVAILABLE"?money(m.value):m.availability==="UNAVAILABLE" && m.value===null)) throw Error("ADS_REPORT_METRIC_EVIDENCE_REQUIRED")
  return m.value
}
/** Pure validation/normalization of an already downloaded official report.
 * No task creation, report download or marketplace traffic occurs here. */
export function normalizeOfficialAdsReportV1(input:OfficialAdsReportObservationV1, now:Date){
  let official=false
  try{const url=new URL(input.source);official=url.origin==="https://api.ebay.com" && url.pathname.startsWith("/sell/marketing/") && !url.username && !url.password && !url.search && !url.hash}catch{}
  if(!official || !id(input.accountKey) || input.marketplace!=="EBAY_US" || !/^\d{9,20}$/.test(input.itemId) ||
    ![input.campaignId,input.reportId,input.reportTaskId,input.reportType,input.reportRevision,input.metadataReference,input.normalizerVersion].every(id) ||
    input.adId!==null && !id(input.adId) || !hash(input.sourceSha256) || !hash(input.metadataSha256) || input.currency!=="USD" ||
    !(Date.parse(input.windowStart)<Date.parse(input.windowEnd)) || !(Date.parse(input.windowEnd)<=Date.parse(input.observedAt)) ||
    !(Date.parse(input.observedAt)<=now.getTime())) throw Error("ADS_OFFICIAL_REPORT_CONTRACT_INVALID")
  const body={contractVersion:ADS_POST_SALE_REPORT_INGESTION_V1,accountKey:input.accountKey,marketplace:input.marketplace,
    itemId:input.itemId,campaignId:input.campaignId,adId:input.adId,reportId:input.reportId,reportTaskId:input.reportTaskId,
    reportType:input.reportType,reportRevision:input.reportRevision,windowStart:input.windowStart,windowEnd:input.windowEnd,
    source:input.source,sourceSha256:input.sourceSha256,metadataReference:input.metadataReference,metadataSha256:input.metadataSha256,
    normalizerVersion:input.normalizerVersion,adSpend:metric(input.adSpend),attributedSales:metric(input.attributedSales),
    metricKeys:{adSpend:input.adSpend.sourceKey,attributedSales:input.attributedSales.sourceKey},currency:input.currency,
    // Report revenue is not profit. Do not mix report totals with one order's
    // fees, guess fulfillment's coverage of ad charges, or infer causation.
    profitAfterAds:null,profitStatus:"MATCHED_ORDER_COST_AND_FEE_COVERAGE_REQUIRED",causalAttribution:false,
    observedAt:input.observedAt,marketplaceWrites:0,ebayAdsWrites:0}
  return {...body,receiptId:feeDigestV1({...body,observedAt:undefined})}
}
/** Service-side handoff for a trusted official-report adapter. Exact listing
 * identity must already exist in Seller OS. Append-only revisions, one receipt
 * per official payload; conflicting reuse of a revision fails closed. */
export async function ingestOfficialAdsReportV1(input:{supabase:SupabaseClient;observation:OfficialAdsReportObservationV1;now:Date}){
  const receipt=normalizeOfficialAdsReportV1(input.observation,input.now)
  const result=await input.supabase.rpc("seller_os_record_ads_report_observation_v1",{p_receipt:receipt})
  if(result.error || result.data!==receipt.receiptId) throw Error("ADS_REPORT_DURABLE_RECEIPT_FAILED")
  return {status:"RECORDED",receiptId:receipt.receiptId,marketplaceWrites:0,ebayAdsWrites:0}
}
export function adsPostSaleLearningV1(input:{accountKey:string;itemId:string;feeReconciliation:unknown;report:unknown}){
  const r=record(input.report), valid=r.contractVersion===ADS_POST_SALE_REPORT_INGESTION_V1 && r.accountKey===input.accountKey && r.itemId===input.itemId && typeof r.receiptId==="string"
  return {feeReconciliation:input.feeReconciliation??null,reportReceiptId:valid?r.receiptId:null,
    adSpend:valid && money(r.adSpend)?r.adSpend:null,attributedSales:valid && money(r.attributedSales)?r.attributedSales:null,
    profitAfterAds:null,status:valid?"MATCHED_ORDER_COST_AND_FEE_COVERAGE_REQUIRED":"OFFICIAL_AD_REPORT_EVIDENCE_REQUIRED",
    window:valid?{start:r.windowStart,end:r.windowEnd}:null,causalAttribution:false}
}
