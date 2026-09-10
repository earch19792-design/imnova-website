import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { prepareSellOneLikeThisV1, classifyReferenceFieldsV1 } from "./sell-one-like-this-v1.ts"
import { registerHooks } from "node:module"
registerHooks({resolve(specifier, context, nextResolve) {
 if(specifier === "server-only") return {url:"data:text/javascript,export{}",shortCircuit:true}
 return nextResolve(specifier,context)
}})
const { readSellOneLikeThisV1 } = await import("./sell-one-like-this-runtime-v1.ts")
import { keywordWireDigestV1 as digest } from "./keyword-intelligence-handoff-v1.ts"
const { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1: destination } = await import("../ebay/ebay-luna-authoritative-shipping-server-v1.ts")
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
function fixture() {
 const b={ACCOUNT_KEY:"account",PRODUCT_ID:"9220846944480",VARIANT_ID:"53002139173088",CANDIDATE_KEY:"sha256:"+"b".repeat(64),OPPORTUNITY_ID:id(1)}
 const plan=id(3),packageId=id(2),version="PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1",authority=digest("truth")
 const d={DECISION_VERSION:version,INPUT_AUTHORITY_FINGERPRINT:authority,INPUT_FINGERPRINT:"sha256:"+createHash("sha256").update(`[${JSON.stringify(version)}, ${JSON.stringify(authority)}]`).digest("hex"),KEYWORD_DECISION_READY:true,BLOCKERS:[],PRIMARY_KEYWORD:"bracelet",TERMS:[{TERM:"bracelet",CLASSIFICATION:"PRIMARY_KEYWORD"}]}
 const binding={...b,PLAN_ID:plan},image="https://cdn.shopify.com/our-image.jpg"
 const field=(FIELD,VALUE)=>({FIELD,VALUE,EVIDENCE_STATUS:"PROVEN",SEMANTIC_CLASS:"FACT",CONTRADICTION:false,SOURCE_AUTHORITY:"SUPPLIER",EVIDENCE_ID:digest(FIELD),SOURCE_LOCATOR_OR_FIELD:FIELD,OBSERVED_AT:"2026-09-10T09:00:00Z"})
 return {binding:b,packageId,now:new Date("2026-09-10T15:00:00Z"),ownPrice:19,
  reference:{marketplace_account_key:b.ACCOUNT_KEY,marketplace:"EBAY_US",plan_id:plan,item_id:"137290616476",source_observation_id:id(4),bounded_title_evidence:"COMPETITOR BRAND platinum certified lifetime warranty bracelet",structural_classification:"CORE_FAMILY_COMPARABLE",structural_compatibility:{entityCompatible:true,useCompatible:true,architectureCompatible:true,explicitCountDifference:false,explicitSizeDifference:false},itemSpecifics:{Brand:"COMPETITOR BRAND",Material:"platinum"},brand:"COMPETITOR BRAND",gtin:"COMPETITOR GTIN",images:["https://evil.example/stolen.jpg"]},
  truthFields:[field("LUNA_PRODUCT_ID",b.PRODUCT_ID),field("LUNA_VARIANT_ID",b.VARIANT_ID),field("SUPPLIER_SKU","OUR-SKU"),field("TITLE","Double Pearl Dream Catcher Bracelet"),field("SUPPLIER_COST",1.06),field("IMAGES",[{SOURCE_IMAGE_URL:image}])],
  requiredTruth:{candidateKey:b.CANDIDATE_KEY,supplierProductId:b.PRODUCT_ID,supplierVariantId:b.VARIANT_ID,exactIdentity:true,marketplaceId:"EBAY_US",categoryId:"261987",evidenceDigest:digest("aspects"),authority:"OUR_TRUTH",aspectContracts:[{name:"Brand",required:true,freeTextAllowed:true},{name:"Style",required:true,freeTextAllowed:false,allowedValues:["Charm"]}],resolutions:{Brand:{value:"Unbranded",source:"OWNER_LUNA_UNBRANDED_POLICY",exactProductSupported:true}},lunaExactProductEvidenceSetV1:{productIdentityExact:true,exactSupplierLineageCertified:true,lunaProductId:b.PRODUCT_ID,lunaVariantId:b.VARIANT_ID,evidenceDigest:digest("ownset"),description:"Bracelet with charm details",allExactProductImagesReviewed:true,exactImageUrls:[image]}},
  aspectResolutions:[{aspectName:"Style",resolvedValue:"Charm",confidence:"HIGH",factInvented:false,humanReviewRequired:false,resolutionClass:"DETERMINISTIC_DERIVATION",sourceEvidence:{sourceField:"DESCRIPTION",sourceExcerpt:"charm"}}],
  category:{candidateKey:b.CANDIDATE_KEY,opportunityId:b.OPPORTUNITY_ID,listingPackageId:packageId,marketplaceId:"EBAY_US",status:"AUTO_SELECTED",semanticCompatibility:{status:"PROVEN",categoryId:"261987"},selectedCategoryId:"261987",taxonomySnapshotDigest:digest("taxonomy"),categorySource:["PRODUCT_TRUTH"]},
  keywordRead:{READ_CONTRACT_VERSION:"PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1",STATUS:"READY",BINDING:binding,DECISION:d,BLOCKERS:[],VALIDATION:{CURRENT_INPUTS_MATCH:true,TRANSPORT_DIGEST:digest({BINDING:binding,DECISION:d})}}}
}
test("own truth wins; competitor identities, media and claims never enter package",()=>{
 const f=fixture(),r=prepareSellOneLikeThisV1(f)
 assert.equal(r.previewPass,true);assert.equal(r.listingPackagePass,true)
 assert.equal(r.preview.itemSpecifics.Brand,"Unbranded");assert.equal(r.preview.itemSpecifics.Style,"Charm")
 assert.doesNotMatch(JSON.stringify(r.listingPackage),/COMPETITOR|platinum|certified|warranty|stolen/)
 assert.equal(r.competitorContaminationCount,0);assert.equal(r.unsupportedClaimCount,0)
 assert.deepEqual(r.listingPackage.content,r.preview)
 assert.deepEqual(f,fixture());assert.equal(r.safety.canPublish,false)
})
test("classification is default deny, value corroboration never grants inheritance",()=>{
 const f=classifyReferenceFieldsV1({...fixture().reference,unknownPayload:{brand:"evil"},dimensions:"10 inch",sellerPolicies:{returns:"free"}})
 assert.equal(f.find(x=>x.field==="ASPECT_NAME:Brand").classification,"TRANSFERABLE")
 assert.equal(f.find(x=>x.field==="ASPECT_VALUE:Brand").classification,"REQUIRES_CORROBORATION")
 for(const k of ["unknownPayload","dimensions","sellerPolicies","images","bounded_title_evidence"])assert.equal(f.find(x=>x.field===k).classification,"REJECTED")
})
test("Shipping unavailable or stale permits Preview without inventing costs or economics",()=>{
 const f=fixture();f.shipping={status:"PROVEN",value:8,reference:"stale",source:"LUNA_PORTEX",freshUntil:"2026-09-09T00:00:00Z"}
 const r=prepareSellOneLikeThisV1(f);assert.equal(r.previewPass,true);assert.equal(r.shippingStatus,"WAITING_FOR_DATA")
 assert.equal(r.commercialEnvelope.components.shipping.status,"STALE")
 assert.equal(r.commercialEnvelope.components.feeAuthority.status,"PENDING")
 assert.equal(r.safety.shippingClaims,0)
})
test("V2.1 missing, stale or cross-binding fails closed without legacy fallback",()=>{
 for(const change of [f=>f.keywordRead={},f=>f.keywordRead.VALIDATION.CURRENT_INPUTS_MATCH=false,f=>f.keywordRead.BINDING.VARIANT_ID="other"]){
  const f=fixture();change(f);const r=prepareSellOneLikeThisV1(f);assert.equal(r.previewPass,false);assert.equal(r.preview,null);assert.equal(r.safety.legacyKeywordFallback,false)
 }
})
test("cross-product references, truth or categories are never accepted",()=>{
 for(const change of [f=>f.reference.plan_id=id(9),f=>f.reference.marketplace_account_key="other",f=>f.reference.structural_compatibility.explicitCountDifference=true,f=>f.truthFields[1].VALUE="other",f=>f.category.candidateKey="other",f=>f.category.semanticCompatibility.status="UNPROVEN"]){
  const f=fixture();change(f);assert.equal(prepareSellOneLikeThisV1(f).previewPass,false)
 }
})
test("unknown, contradicted facts, unsupported required values and mappings remain pending",()=>{
 for(const change of [f=>f.truthFields.find(x=>x.FIELD==="TITLE").CONTRADICTION=true,f=>f.requiredTruth.resolutions.Brand.exactProductSupported=false,f=>f.aspectResolutions[0].sourceEvidence.sourceExcerpt="competitor text",f=>f.aspectResolutions[0].resolvedValue="platinum",f=>f.requiredTruth.aspectContracts[1].allowedValues=["Beaded"]]){
  const f=fixture();change(f);assert.equal(prepareSellOneLikeThisV1(f).previewPass,false)
 }
})
test("only reviewed own exact source images reach handoff",()=>{
 for(const change of [f=>f.requiredTruth.lunaExactProductEvidenceSetV1.allExactProductImagesReviewed=false,f=>f.requiredTruth.lunaExactProductEvidenceSetV1.lunaVariantId="other",f=>f.truthFields.find(x=>x.FIELD==="IMAGES").VALUE.push({SOURCE_IMAGE_URL:"https://evil.example/stolen.jpg"})]){
  const f=fixture();change(f);const r=prepareSellOneLikeThisV1(f);assert.equal(r.imageHandoffPass,false);assert.equal(r.previewPass,false);assert.doesNotMatch(JSON.stringify(r.preview),/evil.example/)
 }
})
test("deterministic preview generation changes when own truth changes",()=>{
 const f=fixture(),a=prepareSellOneLikeThisV1(f),b=prepareSellOneLikeThisV1(f)
 assert.equal(a.listingPackage.generation,b.listingPackage.generation)
 f.truthFields.find(x=>x.FIELD==="TITLE").VALUE="Another Bracelet"
 assert.notEqual(a.listingPackage.generation,prepareSellOneLikeThisV1(f).listingPackage.generation)
})
function database(f){
 const queries=[];let shipping=null
 const b=f.binding
 const tables={ebay_listing_packages:{id:f.packageId,opportunity_id:b.OPPORTUNITY_ID,candidate_key:b.CANDIDATE_KEY,account_key:b.ACCOUNT_KEY,ownPrice:f.ownPrice,category:f.category},ebay_luna_opportunity_queue:{id:b.OPPORTUNITY_ID,candidate_key:b.CANDIDATE_KEY,supplier_product_id:b.PRODUCT_ID,supplier_variant_id:b.VARIANT_ID,supplier_sku:"OUR-SKU",truthFields:f.truthFields,requiredTruth:f.requiredTruth,aspectResolutions:f.aspectResolutions},seller_os_product_research_canonical_evidence_v2:f.reference}
 const db={from(table){const log={table,filters:[],limit:null};queries.push(log);const q={select(s){assert.ok(!s.includes("*"));return this},eq(k,v){log.filters.push([k,v]);return this},order(){return this},limit(n){log.limit=n;return this},abortSignal(){return this},retry(v){assert.equal(v,false);return this},async maybeSingle(){const row=table==="seller_os_profitability_frontier_snapshots"?shipping:tables[table];assert.equal(log.limit,1);return {data:row&&log.filters.every(([k,v])=>row[k]===v)?row:null,error:null}},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)},insert(){throw Error("WRITE")},update(){throw Error("WRITE")}};return q},rpc:async(name,args)=>{assert.equal(name,"read_product_research_keyword_handoff_v1");assert.equal(args.p_variant_id,b.VARIANT_ID);return {data:f.keywordRead,error:null}}}
 return {db,queries,fresh(){shipping={frontier_id:"frontier",family_id:"market-family-v1:sha256:"+"e".repeat(64),account_key:b.ACCOUNT_KEY,marketplace_id:"EBAY_US",luna_product_id:b.PRODUCT_ID,luna_variant_id:b.VARIANT_ID,luna_sku:"OUR-SKU",shipping_status:"SHIPPING_DURABLY_PERSISTED",shipping_value:4,shippingEvidence:{candidateId:"sha256:"+createHash("sha256").update(JSON.stringify({familyId:"market-family-v1:sha256:"+"e".repeat(64),productId:b.PRODUCT_ID,variantId:b.VARIANT_ID,sku:"OUR-SKU"})).digest("hex"),lunaProductId:b.PRODUCT_ID,lunaVariantId:b.VARIANT_ID,supplierSku:"OUR-SKU",canonicalDestinationMatch:true,canonicalDestinationFingerprint:destination.profileDigest,currency:"USD",quantity:1,shippingUsd:4,noPurchase:true,noCredentials:true,acquisitionMethod:"LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING",evidenceDigest:digest("quote"),observedAt:"2026-09-10T14:00:00Z"}}}}
}
test("normal read attaches later fresh Shipping to same package; no claims, global scan or writes",async()=>{
 const f=fixture(),d=database(f),input={supabase:d.db,accountKey:f.binding.ACCOUNT_KEY,packageId:f.packageId,referenceItemId:f.reference.item_id,now:f.now}
 const before=await readSellOneLikeThisV1(input);assert.equal(before.shippingStatus,"WAITING_FOR_DATA");assert.equal(before.previewPass,true)
 d.fresh();const after=await readSellOneLikeThisV1(input);assert.equal(after.shippingStatus,"SHIPPING_PROVEN");assert.equal(after.commercialEnvelope.components.shipping.value,4)
 assert.equal(before.sourcePackageId,after.sourcePackageId);assert.equal(after.safety.codexRuntimeDependency,false)
 assert.equal(d.queries.length,12)
 assert.equal(d.queries.filter(q=>q.table!=="ebay_luna_opportunity_queue").every(q=>q.filters.some(([k])=>["account_key","marketplace_account_key"].includes(k))),true)
})
test("UI/auth boundary preserves reference scope and provides no publishing or polling action",()=>{
 const ui=readFileSync(new URL("../../app/admin/ebay/mayel/reference-preview.tsx",import.meta.url),"utf8")
 const route=readFileSync(new URL("../../app/api/admin/ebay/assistant/revenue-engine/route.ts",import.meta.url),"utf8")
 assert.match(ui,/Ver detalles/);assert.match(ui,/Esperando actualización/);assert.doesNotMatch(ui,/setInterval|setTimeout|mode: "PUBLISH"/)
 assert.match(route,/REFERENCE_OWNER_REQUIRED/);assert.match(route,/REFERENCE_INPUT_INVALID/)
 const capture=readFileSync(new URL("../../app/api/admin/ebay/luna-shipping-capture/route.ts",import.meta.url),"utf8")
 assert.match(capture,/continueLunaQuickPickPostShippingRuntimeV1/)
})

export { fixture, database }
