import test from "node:test"
import assert from "node:assert/strict"
import { assessOwnHistoryMetricsV1, readOwnHistoryMetricsV1 } from "./listing-metrics-cold-start-v1.ts"
import { consumeListingFeeAuthorityV1, LISTING_FEE_AUTHORITY_V1, REQUIRED_FEE_COMPONENTS_V1 } from "./listing-fee-authority-v1.ts"
import { buildListingCommercialEnvelopeV1, COMMERCIAL_COMPONENTS } from "./listing-commercial-envelope-v1.ts"
import { readCommercialPackageBindingV1 } from "./listing-commercial-binding-v1.ts"
import { diagnoseListingTreatmentV1, promotionProfitGuardV1 } from "./listing-treatment-engine-v1.ts"

const now = new Date("2026-09-09T18:00:00Z"), itemId = "366650054490", accountKey = "test-account", sku = "TEST-SKU"
const policy = { mode: "MANUAL", minRate: 3, maxRate: 5, minProfit: 8, minMargin: 15, window: "NOW", timeZone: "America/Guatemala", startsAt: null, endsAt: null }
const amount = value => ({ value, reference: "test-evidence", fresh: true })
const economics = () => ({ salePrice: amount(100), productCost: amount(20), shippingCost: amount(10), ebayFees: amount(12.4), otherCosts: amount(0), adFeeBasis: amount(120) })
function snapshot(prior = false) {
  return { id: prior ? "prior" : "current", marketplace_account_key: accountKey, marketplace: "EBAY_US", listing_id: itemId, sku,
    impressions: prior ? 40000 : 20000, views: prior ? 10000 : 1000, transactions: prior ? 100 : 200,
    window_start: prior ? "2026-08-26" : "2026-09-02", window_end: prior ? "2026-09-01" : "2026-09-08", observed_at: now.toISOString(), completeness_status: "complete",
    source: { analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT", freshnessStatus: "CURRENT", syntheticFallbackUsed: false, fixtureEvidenceUsed: false,
      calculatedCtrApplicable: true, transactionsApplicable: true, totalListingViewsApplicable: true,
      calculatedCtrNumerator: prior ? 1000 : 2000, calculatedCtrDenominator: prior ? 40000 : 20000 } }
}
const assess = (current = snapshot(), history = [snapshot(true)]) => assessOwnHistoryMetricsV1({ accountKey, itemId, sku, window: "7D", now, current, history })
const diagnose = comparison => diagnoseListingTreatmentV1({ itemId, window: "7D", comparison, economics: economics(), policy,
  stock: "AVAILABLE", stockReference: "stock", protected: false, qualityReferences: [], keywordReferences: [] })

test("cold start is not an error; complete economics never bypass missing metric evidence", () => {
  const row = snapshot(); row.views = 3; row.transactions = 0
  const r = assess(row)
  assert.equal(r.status, "PENDING_REAL_SAMPLE"); assert.equal(r.metricSampleSufficient, false); assert.equal(r.isError, false)
  const treatment = diagnose(r.comparison)
  assert.equal(treatment.treatment, "TEST"); assert.equal(treatment.promotion.status, "BLOCKED_EVIDENCE")
  assert.equal(treatment.promotion.economicSimulationStatus, "SIMULATION_READY")
  assert.deepEqual(treatment.diagnosticPriorities, [])
})
test("new sufficient independent evidence automatically changes TEST to SCALE", () => {
  assert.equal(diagnose(assess(null).comparison).treatment, "TEST")
  const r = assess()
  assert.equal(r.metricSampleSufficient, true); assert.equal(r.comparison.basis, "OWN_HISTORY")
  assert.equal(diagnose(r.comparison).treatment, "SCALE"); assert.equal(r.codexRequired, false)
})
test("metric boundary rejects foreign account, SKU, item, stale, future, unknown denominator and synthetic data", () => {
  for (const changes of [{marketplace_account_key:"other"}, {sku:"other"}, {listing_id:"123456789012"}, {observed_at:"2026-09-01"}, {observed_at:"2026-09-10"},
    {source:{...snapshot().source,calculatedCtrDenominator:null}}, {source:{...snapshot().source,syntheticFallbackUsed:true}}]) {
    assert.equal(assess({...snapshot(),...changes}).metricSampleSufficient,false)
  }
})
test("overlapping repeated captures are not independent samples or fabricated healthy baselines", () => {
  assert.equal(assess(snapshot(), Array.from({length:12}, () => snapshot())).metricSampleSufficient,false)
  const prior = {...snapshot(),id:"prior",window_start:"2026-08-26",window_end:"2026-09-01"}
  const r=assess(snapshot(),[prior]); assert.equal(r.comparison.ctr,"UNKNOWN"); assert.equal(diagnose(r.comparison).treatment,"TEST")
})
test("30D and 7D never substitute for one another", () => {
  const current = {...snapshot(),window_start:"2026-08-10"}
  assert.equal(assess(current).metricSampleSufficient,false)
})

function authority() {
  const source="https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
  // Synthetic contract example, explicitly not a rate certified for a real account.
  const components = REQUIRED_FEE_COMPONENTS_V1.map(type=>({type,status:"NOT_APPLICABLE",amount:0,source,sourceVersion:"TEST",reference:"test:"+type,applicabilityEvidence:"test-scenario"}))
  Object.assign(components[0],{status:"PROVEN",amount:12,ratePct:10,basisAmount:120})
  Object.assign(components[1],{status:"PROVEN",amount:0.4})
  return {contractVersion:LISTING_FEE_AUTHORITY_V1,evidenceClass:"PRE_SALE_FEE_ESTIMATE",marketplaceAccountKey:accountKey,marketplace:"EBAY_US",itemId,categoryId:"test-category",
    storeContextReference:"test-store",accountContextReference:"test-account",source,sourceVersion:"TEST",reference:"test-authority",observedAt:now.toISOString(),freshUntil:"2026-09-10T00:00:00Z",amount:12.4,components,
    feeBasis:{status:"PROVEN",reference:"test-basis",amount:120,salePrice:100,method:"PROVEN_UPPER_BOUND",coveredComponents:["ITEM_PRICE","BUYER_SHIPPING","HANDLING","BUYER_TAX"],adBasisCovered:true}}
}
const fee = a => consumeListingFeeAuthorityV1({ metadata:{feeAuthorityV1:a},accountKey,itemId,categoryId:"test-category",salePrice:100,now })
test("versioned presale estimate is distinct from actual post-sale fee", () => {
  assert.equal(fee(authority()).status,"PROVEN"); assert.equal(fee(authority()).unknownFeeComponentCount,0)
  assert.equal(fee({...authority(),evidenceClass:"ACTUAL_POST_SALE_FEE"}).status,"NEEDS_EVIDENCE")
  assert.equal(fee(authority()).actualPostSaleFee,null)
})
test("unknown material fee never becomes zero; account/basis/version failures block economics", () => {
  for (const change of [{components:authority().components.slice(1)}, {marketplaceAccountKey:"other"}, {categoryId:"other"}, {salePrice:12,feeBasis:{}},
    {source:"https://ebay.com.attacker.test/fees"},{sourceVersion:null},{amount:0},{freshUntil:"2026-09-08"}]) {
    const r=fee({...authority(),...change}); assert.equal(r.status,"NEEDS_EVIDENCE"); assert.equal(r.amount,null); assert.equal(r.adFeeBasis,null)
  }
  assert.equal(fee({}).unknownFeeComponentCount,8)
})
test("3–5 percent simulation respects both economic ceilings", () => {
  const e=economics(), f=fee(authority()); e.ebayFees=amount(f.amount); e.adFeeBasis=amount(f.adFeeBasis)
  const r=promotionProfitGuardV1(e,policy)
  assert.equal(r.recommendedAdRate,5); assert.equal(r.projectedAdCost,6); assert.equal(r.projectedProfitAfterAds,51.6)
  assert.equal(promotionProfitGuardV1(e,{...policy,minProfit:57}).status,"BLOCKED_MARGIN")
})
test("commercial envelope keeps stable package identity across official publication/readback", () => {
  const before=buildListingCommercialEnvelopeV1({accountKey,packageId:"package",itemId:null,components:{},now})
  const after=buildListingCommercialEnvelopeV1({accountKey,packageId:"package",itemId,components:{},now})
  assert.equal(before.envelopeKey,after.envelopeKey); assert.equal(before.label,"Esperando datos"); assert.equal(before.waitingIsError,false)
  assert.ok(COMMERCIAL_COMPONENTS.every(k=>before.components[k].value===null))
})
test("envelope preserves stale evidence and requires provenance for proven values", () => {
  const e=buildListingCommercialEnvelopeV1({accountKey,packageId:"package",itemId,components:{shipping:{status:"PROVEN",value:6.99,reference:"quote",source:"LUNA",freshUntil:"2026-09-08"},productCost:{status:"PROVEN",value:0}},now})
  assert.equal(e.components.shipping.status,"STALE"); assert.equal(e.components.shipping.value,6.99)
  assert.equal(e.components.productCost.status,"NEEDS_EVIDENCE"); assert.equal(e.label,"Requiere atención")
})

function database(tables) {
  const reads=[]
  return {reads,from(table) { const filters=[],sorts=[];let limit=Infinity,single=false
    const q={select(columns){assert.ok(!columns.includes("*"));return q},eq(k,v){filters.push(r=>r[k]===v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},
      order(k,o){sorts.push([k,o]);return q},limit(n){limit=n;return q},maybeSingle(){single=true;return q},
      then(resolve,reject){assert.ok(limit<=12); reads.push({table,limit});let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)))
        rows=[...rows].sort((a,b)=>{for(const[k,o]of sorts){const c=String(a[k]).localeCompare(String(b[k]));if(c)return o.ascending?c:-c}return 0}).slice(0,limit)
        return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject)}};return q}}
}
test("runtime reader re-evaluates new snapshots without writes or new polling", async()=>{
  const current=snapshot(), tables={listing_commercial_snapshots:[current]}, db=database(tables)
  const input={supabase:db,accountKey,itemId,sku,window:"7D",now,start:"2026-09-02",end:"2026-09-08"}
  assert.equal((await readOwnHistoryMetricsV1(input)).metricSampleSufficient,false)
  tables.listing_commercial_snapshots.push(snapshot(true))
  assert.equal((await readOwnHistoryMetricsV1(input)).metricSampleSufficient,true)
  assert.equal(db.reads.length,4)
})
test("official publication automatically binds the existing package; conflicting links fail closed",async()=>{
  const tables={ebay_authorized_listing_publications:[{id:"pub",marketplace_account_key:accountKey,listing_id:itemId,sku,verified_active_at:now.toISOString(),listing_package_id:"pkg",opportunity_id:"opp"}],
    ebay_listing_packages:[{id:"pkg",account_key:accountKey,opportunity_id:"opp",candidate_key:"candidate",updated_at:now.toISOString(),package_data:{categoryId:"category"},status:"approved"}]}
  const input={supabase:database(tables),accountKey,itemId,sku}
  assert.equal((await readCommercialPackageBindingV1(input)).packageId,"pkg")
  tables.ebay_manual_listing_links=[{id:"link",account_key:accountKey,marketplace_id:"EBAY_US",ebay_item_id:itemId,verification_status:"verified",connector_listing_status:"active",opportunity_id:"different"}]
  assert.equal((await readCommercialPackageBindingV1(input)).reason,"COMMERCIAL_BINDING_CONFLICT")
})
