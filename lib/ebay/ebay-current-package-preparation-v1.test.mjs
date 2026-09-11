import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {currentUnpublishedPayloadAcceptedV1 as accepted,currentPreparationBindingValidV1 as valid,projectCurrentPreparationPackageV1 as project,currentPreparationPayloadMatchesV1 as match,currentPreparationApprovalMatchesV1 as approvalMatch,currentPreparationVisualGateV1 as visual} from './ebay-current-package-preparation-v1.ts'
import {buildEbayDraftOnlyPayload as build,evaluateEbayDraftOnlyReadiness as evaluate} from './ebay-draft-only-readiness.ts'
import {canonicalEbayPackageSku} from './ebay-sku.ts'
import {keywordWireDigestV1 as digest} from '../seller-os/keyword-intelligence-handoff-v1.ts'
const now=new Date('2026-09-11T10:00:00Z'),fp='a'.repeat(64)
function fixture(){
 const pkg={id:'24535b37-0335-4984-a36c-dbb73a7560da',created_by:'owner',account_key:'account:'+fp,candidate_key:'candidate',status:'ready_for_review',source_observed_at:'2026-09-01T00:00:00Z',package_data:{title:'Historical',description:'Historical',aspects:{},imageUrls:['https://images.test/old'],pricing:{targetPrice:17.77}}}
 const op={id:'op',candidate_key:'candidate',supplier_product_id:'product',supplier_variant_id:'variant',supplier_sku:'supplier',supplier_price:1.06,supplier_available:true,supplier_inventory_quantity:null,queue_status:'ready'}
 const content={title:'Current bracelet',description:'Current own description',categoryId:'261987',itemSpecifics:{Type:'Bracelet'},imageUrls:['https://images.test/one','https://images.test/two'],price:17.77}
 const sku=canonicalEbayPackageSku(pkg.id),snapshot={binding:{ACCOUNT_KEY:pkg.account_key,PRODUCT_ID:'product',VARIANT_ID:'variant',SKU:'supplier',OPPORTUNITY_ID:'op',CANDIDATE_KEY:'candidate'},content,generation:'sha256:'+'b'.repeat(64)}
 const config={sku,quantity:1,condition:'NEW',merchantLocationKey:'location',businessPolicies:{fulfillmentPolicyId:'shipping',paymentPolicyId:'payment',returnPolicyId:'return'},imageAuthorization:{approved:true,approvedAt:now.toISOString(),approvedImageUrls:content.imageUrls,rightsBasis:'supplier_authorized',source:'luna'},aspectValidation:{validated:true,validatedAt:now.toISOString(),categoryId:'261987',requiredAspects:[]}}
 const preview={sku,inventoryItemPayload:{availability:{shipToLocationAvailability:{quantity:1}},condition:'NEW',product:{title:content.title,description:content.description,aspects:{Type:['Bracelet']},imageUrls:content.imageUrls}},offerPayload:{sku,marketplaceId:'EBAY_US',format:'FIXED_PRICE',availableQuantity:1,categoryId:content.categoryId,listingDescription:content.description,merchantLocationKey:'location',listingPolicies:config.businessPolicies,pricingSummary:{price:{value:'17.77',currency:'USD'}}}}
 const authority={operation:'PREPARE_UNPUBLISHED_ONLY',publicationAuthorized:false,packageConsistent:true,brandSupported:true,revision:{version:'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1',publicationId:'publication',packageId:pkg.id,accountKey:pkg.account_key,productId:'product',variantId:'variant',sku:'supplier',snapshot,packageGeneration:snapshot.generation,packageHash:digest(snapshot),preview,previewHash:digest(preview)},inventory:{inventoryReady:true,availability:'IN_STOCK',freshness:'FRESH',listingQuantity:1,supplierQuantity:null,observedAt:'2026-09-11T09:00:00Z',freshUntil:'2026-09-11T15:00:00Z'}}
 const projected=project(pkg,authority),payload=build(projected,op,config,'PRODUCTION',fp,{},null,null,null,authority)
 return {pkg,op,config,authority,projected,payload}
}
test('CURRENT content reaches the existing payload builder without rewriting historical package',()=>{
 const f=fixture(),before=structuredClone(f.pkg);assert.equal(valid(f.authority,f.pkg,f.op,fp,now),true)
 assert.equal(match(f.authority,f.payload),true);assert.equal(approvalMatch(f.authority,f.payload),true)
 assert.equal(f.payload.inventoryItemPayload.product.title,'Current bracelet');assert.deepEqual(f.pkg,before)
 assert.equal(f.payload.safety.unpublishedOnly,true);assert.equal(f.payload.safety.publishOfferPresent,false)
})
test('historical ACK, payload and cross-generation/identity approvals never validate CURRENT',()=>{
 const f=fixture();assert.equal(approvalMatch(f.authority,{...f.payload,compliance:{}}),false)
 for(const key of ['packageHash','packageGeneration','previewHash','publicationId']){
  const p=structuredClone(f.payload);p.compliance.publicationPreparationRevisionV1[key]='other';assert.equal(approvalMatch(f.authority,p),false)
 }
 for(const key of ['productId','variantId','accountKey','packageId','sku']){const a=structuredClone(f.authority);a.revision[key]='other';assert.equal(valid(a,f.pkg,f.op,fp,now),false)}
 for(const key of ['title','description','imageUrls','aspects']){const p=structuredClone(f.payload);p.inventoryItemPayload.product[key]=key==='title'?'Historical':[];assert.equal(match(f.authority,p),false)}
 for(const key of ['categoryId','availableQuantity','listingPolicies','pricingSummary']){const p=structuredClone(f.payload);p.offerPayload[key]='other';assert.equal(match(f.authority,p),false)}
})
test('fresh availability permits non-LIVE preparation while monetary evidence remains pending; no stock fabrication',()=>{
 const f=fixture(),input={now,listingPackage:f.projected,opportunity:f.op,draftConfiguration:f.config,target:'PRODUCTION',accountFingerprint:fp,currentPreparation:f.authority}
 const r=evaluate(input);for(const blocker of ['LUNA_STOCK_UNAVAILABLE','QUANTITY_EXCEEDS_FRESH_STOCK','PACKAGE_SOURCE_STALE','MINIMUM_NET_MARGIN_NOT_MET','CURRENT_REVISION_PAYLOAD_PREVIEW_MISMATCH'])assert.equal(r.blockers.includes(blocker),false,blocker)
 assert.equal(r.safety.canPublish,false);assert.equal(r.economics.passesProfitGate,false);assert.equal(r.economics.estimatedOutboundShipping,null);assert.equal(f.op.supplier_inventory_quantity,null)
 for(const patch of [{availability:'OUT_OF_STOCK'},{freshness:'STALE'},{freshUntil:'2026-09-10T00:00:00Z'},{listingQuantity:2}]){
 const a=structuredClone(f.authority);Object.assign(a.inventory,patch);assert.equal(evaluate({...input,currentPreparation:a}).blockers.includes('CURRENT_REVISION_AUTHORITY_NOT_READY'),true)
 }
 assert.equal(evaluate({...input,currentPreparation:null}).blockers.includes('LUNA_STOCK_UNAVAILABLE'),true)
})
test('CURRENT preparation preserves image, collision and taxonomy guards',()=>{
 const f=fixture(),input={now,listingPackage:f.projected,opportunity:f.op,draftConfiguration:f.config,target:'PRODUCTION',accountFingerprint:fp,currentPreparation:f.authority}
 assert.ok(evaluate({...input,activeSkuCollision:true}).blockers.includes('SKU_COLLISION'))
 assert.ok(evaluate({...input,draftConfiguration:{...f.config,imageAuthorization:{}}}).blockers.includes('IMAGE_AUTHORIZATION_REQUIRED'))
 assert.ok(evaluate({...input,draftConfiguration:{...f.config,aspectValidation:{}}}).blockers.includes('CATEGORY_ASPECTS_NOT_VALIDATED'))
 assert.ok(evaluate({...input,currentPreparation:{...f.authority,packageConsistent:false}}).blockers.includes('CURRENT_REVISION_AUTHORITY_NOT_READY'))
})
test('route validates CURRENT approval before returning a completed historical ledger',()=>{
 const s=readFileSync(new URL('../../app/api/admin/ebay/draft-only/route.ts',import.meta.url),'utf8').split('async function executeDraft(')[1]
 assert.ok(s.indexOf('currentPreparationApprovalMatchesV1')<s.indexOf('existing?.phase === "completed"'))
 assert.match(s,/context\.currentPreparation/)
})

test('current gallery assessment is consumed exactly; historical QA never substitutes for CURRENT',()=>{
 const f=fixture(),r=f.authority.revision
 const a={...f.authority,imageAuthority:{pass:true,contractVersion:'SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1',packageHash:r.packageHash,generation:r.packageGeneration,imageCount:2,marketplaceWrites:0,publicationAuthorized:false}}
 assert.equal(visual(a).allowed,true);assert.equal(visual(a).passedAssets,2)
 for(const patch of [{pass:false},{packageHash:'other'},{generation:'old'},{imageCount:7},{publicationAuthorized:true}])assert.equal(visual({...a,imageAuthority:{...a.imageAuthority,...patch}}).allowed,false)
 assert.equal(visual(f.authority).allowed,false)
})

test('CURRENT accepted payload requires exact durable receipt and never borrows another revision or Offer',()=>{
 const f=fixture(),r=f.authority.revision;r.publicationId='publication';r.previewHash=digest(r.preview)
 const b={publicationId:'publication',packageId:r.packageId,accountKey:r.accountKey,offerId:'123',sku:r.preview.sku,packageHash:r.packageHash,packageGeneration:r.packageGeneration,previewHash:r.previewHash}
 const receipt={version:'CURRENT_UNPUBLISHED_PREPARATION_V1',key:digest(b),binding:b,state:'READBACK_CONFIRMED',publicationAuthorized:false,observedAt:now.toISOString(),result:{pass:true,inventoryReadback:{safe:true},offerReadback:{safe:true,offerId:'123',sku:b.sku,status:'UNPUBLISHED',listingPresent:false,payloadMatches:true}}}
 const p={id:'publication',listing_package_id:r.packageId,marketplace_account_key:r.accountKey,offer_id:'123',sanitized_result:{currentUnpublishedPreparationV1:receipt}}
 assert.equal(accepted(p,r,now),true)
 for(const field of ['publicationId','packageId','accountKey','offerId','sku','packageHash','packageGeneration','previewHash']){
  const changed=structuredClone(p);const c=changed.sanitized_result.currentUnpublishedPreparationV1;c.binding[field]='other';c.key=digest(c.binding);assert.equal(accepted(changed,r,now),false,field)
 }
 for(const patch of [{safe:false},{status:'PUBLISHED'},{listingPresent:true},{payloadMatches:false}]){
  const changed=structuredClone(p);Object.assign(changed.sanitized_result.currentUnpublishedPreparationV1.result.offerReadback,patch);assert.equal(accepted(changed,r,now),false)
 }
 assert.equal(accepted({...p,sanitized_result:{}},r,now),false)
})
