import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fixture,database} from './sell-one-like-this-v1.test.mjs'
import {prepareSellOneLikeThisV1} from './sell-one-like-this-v1.ts'
import {listingPipelineConsistencyV1} from './listing-pipeline-consistency-v1.ts'
const {readSellOneLikeThisV1}=await import('./sell-one-like-this-runtime-v1.ts')
const authority=f=>({...f,accountKey:f.binding.ACCOUNT_KEY,sku:'OUR-SKU'})
test('blocked keyword preparation without content returns a closed gate, not a digest exception',()=>{
 const f=fixture();f.keywordRead.VALIDATION.CURRENT_INPUTS_MATCH=false
 const p=prepareSellOneLikeThisV1(f);assert.equal(p.listingPackage,null)
 const before=JSON.stringify(p),a=authority(f)
 a.currentQuantityMaterial={title:undefined,description:undefined,itemSpecifics:undefined,imageUrls:undefined}
 const g=listingPipelineConsistencyV1(p,a)
 assert.equal(g.READY_TO_PUBLISH,false);assert.equal(g.PACKAGE_CONSISTENT,false)
 assert.equal(g.evidence.inventory.inventoryReady,false);assert.equal(g.PUBLICATION_IDEMPOTENCY_KEY_READY,false)
 assert.ok(g.inconsistencies.includes('KEYWORD_V2_1_VERSION_PINNED'))
 assert.equal(JSON.stringify(p),before)
})
test('availability-only inventory uses exact current reviewed exposure, never supplier quantity=1',()=>{
 const f=fixture(),sample=f.truthFields[0];f.truthFields.push({...sample,FIELD:'SUPPLIER_AVAILABILITY',VALUE:'AVAILABLE',FRESH_UNTIL:'2026-09-12T00:00:00Z'})
 const p=prepareSellOneLikeThisV1(f),a=authority(f),c=p.listingPackage.content
 const lineage={supplierSku:a.sku,lunaProductId:a.binding.PRODUCT_ID,lunaVariantId:a.binding.VARIANT_ID,productTruthDigest:'sha256:'+'b'.repeat(64)}
 a.currentQuantityMaterial={contractVersion:'QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1',listingPackageId:a.packageId,exactProductLineage:lineage,
  quantity:1,title:c.title,description:c.description,categoryId:c.categoryId,price:c.price,itemSpecifics:c.itemSpecifics,imageUrls:c.imageUrls}
 a.quantityReview={contractVersion:'QUICK_PICK_REMOTE_OWNER_REVIEW_V1',status:'CONFIRMED',reviewedBy:'owner',reviewedAt:'2026-09-09T00:00:00Z',
  materialPackageDigestVersion:'QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1',materialPackageChangeInvalidatesAuthorization:true,
  reviewedPackageDigest:'sha256:'+createHash('sha256').update(JSON.stringify(a.currentQuantityMaterial)).digest('hex'),
  authorizedPackageId:a.packageId,authorizedSku:a.sku,exactProductLineage:lineage,authorizedQuantity:1}
 const g=listingPipelineConsistencyV1(p,a)
 assert.equal(g.evidence.inventory.status,'PROVEN');assert.equal(g.evidence.inventory.supplierQuantity,null)
 assert.equal(g.evidence.inventory.listingQuantity,1);assert.equal(g.PACKAGE_CONSISTENT,true)
 const old=structuredClone(a);old.currentQuantityMaterial.title='Old title';old.quantityReview.reviewedPackageDigest='sha256:'+createHash('sha256').update(JSON.stringify(old.currentQuantityMaterial)).digest('hex')
 assert.equal(listingPipelineConsistencyV1(p,old).evidence.inventory.inventoryReady,false)
 const stale=structuredClone(a);stale.now=new Date('2026-09-13T00:00:00Z')
 assert.equal(listingPipelineConsistencyV1(p,stale).evidence.inventory.inventoryReady,false)
 assert.equal(JSON.stringify(p.listingPackage),JSON.stringify(prepareSellOneLikeThisV1(f).listingPackage))
})
test('EXACT_PRODUCT_BINDING_PASS / EXACT_SKU_BINDING_PASS / CATEGORY_BINDING_PASS',()=>{
 const f=fixture(),p=prepareSellOneLikeThisV1(f),g=listingPipelineConsistencyV1(p,authority(f))
 assert.equal(g.PACKAGE_CONSISTENT,true);assert.equal(g.EXACT_PRODUCT_BINDING,true);assert.equal(g.EXACT_ACCOUNT_BINDING,true)
 assert.equal(g.EXACT_SKU_BINDING,true);assert.equal(g.EXACT_VARIATION_BINDING,true);assert.equal(g.CATEGORY_BINDING_VALID,true)
 assert.equal(g.ITEM_SPECIFICS_BINDING_VALID,true)
 for(const change of [a=>a.sku='another',a=>a.accountKey='another',a=>a.binding.PRODUCT_ID='other',a=>a.binding.VARIANT_ID='other',a=>a.category.selectedCategoryId='other']){
  const a=authority(structuredClone(f));change(a);assert.equal(listingPipelineConsistencyV1(p,a).PACKAGE_CONSISTENT,false)
 }
})
test('KEYWORD_V2_1_NO_FALLBACK_PASS / IMAGE_PROVENANCE_PASS / NO_COMPETITOR_CONTAMINATION_PASS',()=>{
 const f=fixture(),p=prepareSellOneLikeThisV1(f)
 const g=listingPipelineConsistencyV1(p,authority(f));assert.equal(g.KEYWORD_V2_1_VERSION_PINNED,true)
 assert.equal(g.IMAGE_PROVENANCE_VALID,true);assert.equal(g.COMPETITOR_CONTAMINATION_COUNT,0);assert.equal(g.LEGACY_KEYWORD_FALLBACK,false)
 for(const mutate of [a=>a.keywordRead.VALIDATION.CURRENT_INPUTS_MATCH=false,a=>a.requiredTruth.lunaExactProductEvidenceSetV1.allExactProductImagesReviewed=false]){
  const a=authority(structuredClone(f));mutate(a);assert.equal(listingPipelineConsistencyV1(p,a).PACKAGE_CONSISTENT,false)
 }
 const injected=structuredClone(p);injected.listingPackage.content.description+=' Certified platinum';
 assert.equal(listingPipelineConsistencyV1(injected,authority(f)).PACKAGE_CONSISTENT,false)
})
test('PACKAGE_IMMUTABILITY_PASS / PUBLICATION_IDEMPOTENCY_READY_PASS',()=>{
 const f=fixture(),p=prepareSellOneLikeThisV1(f),original=JSON.stringify(p),g=listingPipelineConsistencyV1(p,authority(f))
 assert.equal(JSON.stringify(p),original);assert.equal(g.IMMUTABLE,true);assert.ok(g.PACKAGE_HASH);assert.ok(g.PUBLICATION_IDEMPOTENCY_KEY_READY)
 assert.ok(Object.isFrozen(g.snapshot.content));assert.throws(()=>{g.snapshot.content.title='modified'})
 assert.equal(g.publicationPreparationKey,listingPipelineConsistencyV1(p,authority(f)).publicationPreparationKey)
 assert.equal(g.PUBLICATION_AUTHORIZATION_GRANTED,false)
 const changed=structuredClone(p);changed.listingPackage.generation='sha256:'+'0'.repeat(64)
 assert.equal(listingPipelineConsistencyV1(changed,authority(f)).PUBLICATION_IDEMPOTENCY_KEY_READY,false)
})
test('STALE_EVIDENCE_NOT_CURRENT_PASS / WAITING_SHIPPING_PACKAGE_CONSISTENT_PASS',()=>{
 const f=fixture(),p=prepareSellOneLikeThisV1(f),a=authority(f)
 a.shipping={status:'PROVEN',value:4,reference:'old',source:'PORTEX',freshUntil:'2026-09-09T00:00:00Z'}
 const g=listingPipelineConsistencyV1(p,a);assert.equal(g.PACKAGE_CONSISTENT,true);assert.equal(g.SHIPPING_STATUS,'WAITING_FOR_DATA')
 assert.equal(g.READY_TO_PUBLISH,false);assert.equal(g.evidence.shipping.status,'STALE');assert.equal(g.STALE_EVIDENCE_USED_AS_CURRENT,0)
 const stale=fixture();stale.truthFields.find(f=>f.FIELD==='SUPPLIER_COST').FRESH_UNTIL='2026-09-09T00:00:00Z'
 assert.notEqual(listingPipelineConsistencyV1(p,authority(stale)).evidence.productCost.status,'PROVEN')
})
test('normal read reevaluates the same immutable package after Shipping arrives without capture',async()=>{
 const f=fixture(),d=database(f),existing=prepareSellOneLikeThisV1(f),original=JSON.stringify(existing.listingPackage)
 const request={supabase:d.db,accountKey:f.binding.ACCOUNT_KEY,packageId:f.packageId,referenceItemId:f.reference.item_id,now:f.now,existingPackagePreview:existing}
 const before=await readSellOneLikeThisV1(request);assert.equal(before.consistency.PACKAGE_CONSISTENT,true)
 d.fresh();const after=await readSellOneLikeThisV1(request)
 assert.equal(after.consistency.SHIPPING_STATUS,'FRESH');assert.equal(after.consistency.PACKAGE_HASH,before.consistency.PACKAGE_HASH)
 assert.equal(JSON.stringify(after.listingPackage),original);assert.equal(after.consistency.CODEX_RUNTIME_DEPENDENCY,false)
 assert.equal(after.consistency.READY_TO_PUBLISH,false);assert.ok(after.consistency.waiting.includes('feeAuthority'))
})
test('PUBLICATION_VS_LIVE_SYNC_SEPARATION_PASS existing publish surface and no extra traffic',()=>{
 const ui=readFileSync(new URL('../../app/admin/ebay/mayel/reference-preview.tsx',import.meta.url),'utf8')
 assert.match(ui,/Estación visual/);assert.match(ui,/no autoriza una publicación/)
 const module=readFileSync(new URL('./listing-pipeline-consistency-v1.ts',import.meta.url),'utf8')
 assert.doesNotMatch(module,/setInterval|setTimeout|fetch\(|\.rpc\(|\.insert\(|\.update\(/)
 assert.match(module,/PUBLICATION_AUTHORIZATION_GRANTED: false/)
})
