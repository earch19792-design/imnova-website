import assert from "node:assert/strict"
import test from "node:test"
import { resolveListingPreSaleFeesV1, resolveDurableListingFeeMetadataV1 } from "./listing-fee-resolver-v1.ts"
import { bindOfficialCategoryFeePolicyV1 } from "../ebay/ebay-official-category-fee-binding-v1.ts"
import { parseTradingManualListingResponses } from "../ebay/ebay-manual-listing-trading-readonly.ts"

// Synthetic account/category applicability fixtures. Published tariff numbers
// are used to test arithmetic, not certify a real account's applicability.
const now = new Date("2026-09-09T18:00:00Z")
const source = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
const input = { accountKey: "TEST_ACCOUNT", itemId: "999999999999", categoryId: "TEST_GENERAL", salePrice: 52.99, now }
function bundle() {
  const proof = {status: "PROVEN", source, sourceVersion: "TEST_SNAPSHOT", reference: "test-evidence",
    observedAt: "2026-09-09T17:00:00Z", freshUntil: "2026-09-10T00:00:00Z",
    effectiveFrom: "2026-09-01T00:00:00Z", effectiveUntil: "2026-10-01T00:00:00Z"}
  const binding = {marketplaceAccountKey: input.accountKey, itemId: input.itemId, categoryId: input.categoryId, currency: "USD"}
  return {
    context: {...proof, ...binding, marketplace: "EBAY_US", storeLevel: "NO_STORE", saleFormat: "FIXED_PRICE",
      categoryReference: "test-taxonomy", storeReference: "test-store", formatReference: "test-format"},
    policies: [{...proof, marketplace: "EBAY_US", currency: "USD", categoryIds: [input.categoryId], storeLevels: ["NO_STORE"],
      saleFormats: ["FIXED_PRICE", "AUCTION"], tierMethod: "MARGINAL",
      tiers: [{upTo: 7500, ratePct: 13.6}, {upTo: null, ratePct: 2.35}],
      perOrder: {threshold: 10, atOrBelow: .3, above: .4}}],
    basis: {...proof, ...binding, method: "EXACT_SCENARIO", scenarioReference: "test-usd-domestic-scenario",
      quantity: 1, orderItemCount: 1, itemPrice: 52.99, buyerShipping: 0, handling: 0, buyerTax: 4.53,
      amount: 57.52, adBasisCovered: true},
    adjustments: ["SELLER_PERFORMANCE", "SERVICE_METRICS", "INTERNATIONAL", "CURRENCY_CONVERSION", "REGULATORY_OPERATING", "TAX_ON_FEES"]
      .map(type => ({...proof,...binding,type,applicability: "NOT_APPLICABLE", amount: 0,
        scenarioReference: "test-usd-domestic-scenario", applicabilityEvidence: "test-explicit-"+type})),
  }
}
const resolve = b => resolveListingPreSaleFeesV1({...input,bundle:b})
test("observed sale arithmetic reproduces 8.22 without establishing real applicability",()=>{
  const r=resolve(bundle()); assert.equal(r.status,"PROVEN"); assert.equal(r.amount,8.22)
  assert.equal(r.globalFlatFeeRate,false); assert.equal(r.unknownMaterialFeeComponentCount,0)
  assert.equal(r.actualFeesSubstitutedForCurrentAuthority,false)
})
test("jewelry has its own whole-amount tiers, never the general-category rate",()=>{
  const b=bundle(); b.policies[0].tiers=[{upTo:5000,ratePct:15},{upTo:null,ratePct:9}]
  b.policies[0].tierMethod="WHOLE_AMOUNT"; b.policies[0].categoryIds=["TEST_JEWELRY"]
  b.context.categoryId="TEST_JEWELRY"; b.basis.categoryId="TEST_JEWELRY"; b.adjustments.forEach(a=>a.categoryId="TEST_JEWELRY")
  const r=resolveListingPreSaleFeesV1({...input,categoryId:"TEST_JEWELRY",bundle:b})
  assert.equal(r.amount,9.03); assert.equal(r.officialCategoryFeePolicyBound,true)
  assert.equal(resolve(b).amount,null)
})
test("marginal and whole-amount rules differ above a threshold",()=>{
  const b=bundle(); b.basis.itemPrice=8000; b.basis.buyerTax=0; b.basis.amount=8000
  assert.equal(resolveListingPreSaleFeesV1({...input,salePrice:8000,bundle:b}).amount,1032.15)
  b.policies[0].tierMethod="WHOLE_AMOUNT"; b.policies[0].tiers=[{upTo:5000,ratePct:15},{upTo:null,ratePct:9}]
  assert.equal(resolveListingPreSaleFeesV1({...input,salePrice:8000,bundle:b}).amount,720.4)
})
test("account, format, Store, category and policy effective date are mandatory",()=>{
  const changes=[b=>b.context.marketplaceAccountKey="OTHER",b=>b.context.saleFormat="CLASSIFIED_AD",
    b=>b.context.storeLevel="BASIC",b=>b.context.categoryId="UNKNOWN",b=>b.policies[0].effectiveUntil="2026-09-08",
    b=>b.policies[0].effectiveFrom="2026-09-10",b=>b.policies.push(structuredClone(b.policies[0])),
    b=>b.policies[0].source="https://ebay.com.attacker.test/policy"]
  for(const change of changes){const b=bundle(); change(b);const r=resolve(b);assert.equal(r.amount,null);assert.equal(r.authority,null)}
})
test("missing buyer tax, cross-account basis and multi-item orders fail closed",()=>{
  for(const change of [b=>b.basis.buyerTax=null,b=>b.basis.marketplaceAccountKey="OTHER",b=>b.basis.orderItemCount=2,
    b=>b.basis.quantity=2,b=>b.basis.scenarioReference=null,b=>b.basis.amount=52.99]){
    const b=bundle();change(b);assert.equal(resolve(b).amount,null)
  }
})
test("unknown material components cannot be zeroed by the resolver",()=>{
  const b=bundle();b.adjustments.pop();const r=resolve(b)
  assert.equal(r.amount,null);assert.equal(r.unknownMaterialFeeComponentCount,1)
  assert.ok(r.blockers.includes("FEE_COMPONENT_UNPROVEN:TAX_ON_FEES"))
  for(const change of [a=>a.applicabilityEvidence=null,a=>a.effectiveUntil="2026-09-08",a=>a.scenarioReference="OTHER",
    a=>a.marketplaceAccountKey="OTHER",a=>a.amount=null]) {
    const b=bundle();change(b.adjustments[0]);assert.equal(resolve(b).accountSurchargeContextResolved,false)
  }
})
test("performance and service fees never stack; valid one-component surcharge computes",()=>{
  const b=bundle();Object.assign(b.adjustments[0],{applicability:"APPLICABLE",amount:3.45,ratePct:6,basisAmount:57.52})
  assert.equal(resolve(b).amount,11.67)
  Object.assign(b.adjustments[1],{applicability:"APPLICABLE",amount:2.88,ratePct:5,basisAmount:57.52})
  assert.equal(resolve(b).amount,null)
  assert.ok(resolve(b).blockers.includes("MUTUALLY_EXCLUSIVE_SURCHARGES_STACKED"))
})
test("new durable evidence is resolved during reads; newer incomplete evidence cannot reuse old success",()=>{
  const b=bundle(), metadata={feeResolutionInputsV1:b}
  assert.equal(resolveDurableListingFeeMetadataV1({...input,metadata}).metadata.feeAuthorityV1.amount,8.22)
  const old=resolve(b).authority;b.adjustments=[]
  const r=resolveDurableListingFeeMetadataV1({...input,metadata:{feeAuthorityV1:old,feeResolutionInputsV1:b}})
  assert.equal(r.metadata.feeAuthorityV1,null);assert.equal(r.resolution.amount,null)
  assert.deepEqual(resolveDurableListingFeeMetadataV1({...input,metadata:{feeAuthorityV1:old}}),{metadata:{feeAuthorityV1:old},resolution:null})
})
test("official GetItem category path binds jewelry policy without title inference or another request",()=>{
  const at=new Date("2026-09-09T19:00:00Z")
  const listing=parseTradingManualListingResponses("<User><UserID>test-seller</UserID></User>",
    "<Item><ItemID>999999999999</ItemID><Seller><UserID>test-seller</UserID></Seller><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><Currency>USD</Currency><ListingType>FixedPriceItem</ListingType><PrimaryCategory><CategoryID>50692</CategoryID><CategoryName>Jewelry &amp; Watches:Fashion Jewelry:Jewelry Sets</CategoryName></PrimaryCategory></Item>",
    input.itemId,at)
  assert.equal(listing.categoryPath,"Jewelry & Watches:Fashion Jewelry:Jewelry Sets")
  const ctx={listing,accountKey:input.accountKey,storeLevel:"NO_STORE",storeReference:"test-getuser",now:at}
  const r=bindOfficialCategoryFeePolicyV1(ctx)
  assert.equal(r.status,"PROVEN_BASE_POLICY_ONLY"); assert.equal(r.policy.tiers[0].ratePct,15)
  assert.equal(r.policy.tierMethod,"WHOLE_AMOUNT")
  for(const change of [{saleFormat:"LeadGeneration"},{categoryPath:null},{ownership:"not_owned"},{secondaryCategoryId:"123"}])
    assert.equal(bindOfficialCategoryFeePolicyV1({...ctx,listing:{...listing,...change}}).policy,null)
  assert.equal(bindOfficialCategoryFeePolicyV1({...ctx,storeLevel:"BASIC"}).policy,null)
  assert.equal(bindOfficialCategoryFeePolicyV1({...ctx,now:new Date("2026-09-11")}).policy,null)
  assert.equal(bindOfficialCategoryFeePolicyV1({...ctx,listing:{...listing,categoryPath:"Unknown:Unknown"}}).policy,null)
})
