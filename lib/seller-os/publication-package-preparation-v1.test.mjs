import test from 'node:test'
import assert from 'node:assert/strict'
import {packageExposurePolicyV1 as policy,buildPackagePreviewRevisionV1 as build,currentPackagePreviewRevisionV1 as project,PACKAGE_EXPOSURE_POLICY_V1} from './publication-package-preparation-v1.ts'
import {publicationInventoryAuthorityV1 as inventory} from './publication-inventory-authority-v1.ts'
import {canonicalEbayPackageSku} from '../ebay/ebay-sku.ts'
import {keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1.ts'
const now=new Date('2026-09-11T08:00:00Z'),packageId='24535b37-0335-4984-a36c-dbb73a7560da'
function fixture(){
 const binding={accountKey:'account:'+ 'a'.repeat(64),packageId,productId:'product',variantId:'variant',sku:'supplier',productTruthDigest:'sha256:'+'b'.repeat(64),now}
 const exposure={version:PACKAGE_EXPOSURE_POLICY_V1,status:'ACTIVE',scope:'EXACT_NEW_PACKAGE_EXPOSURE',quantity:1,sourcePolicy:'QUICK_PICK_REMOTE_OWNER_REVIEW_V1',authorizedBy:'owner',authorizedAt:'2026-09-11T07:00:00Z',authorizationReference:'OWNER_EXPLICIT_EXPOSURE_SCOPE_EXTENSION',supplierQuantityInferred:false,publicationAuthorized:false,binding:{...binding,now:undefined}}
 const content={title:'Current',description:'Current own description',itemSpecifics:{Type:'Bracelet'},imageUrls:['https://own/one','https://own/two'],categoryId:'261987',price:17.77}
 const snapshot={binding:{ACCOUNT_KEY:binding.accountKey,PRODUCT_ID:'product',VARIANT_ID:'variant',SKU:'supplier',OPPORTUNITY_ID:'op',CANDIDATE_KEY:'candidate'},generation:'sha256:'+'c'.repeat(64),content,sourceEvidenceReferences:[packageId,'source']}
 const consistency={PACKAGE_CONSISTENT:true,IMMUTABLE:true,PACKAGE_HASH_PRESENT:true,PACKAGE_HASH:digest(snapshot),snapshot}
 const publication={id:'publication',listing_package_id:packageId,marketplace_account_key:binding.accountKey,account_fingerprint:'a'.repeat(64),sku:canonicalEbayPackageSku(packageId),phase:'preview_ready',publish_attempt_count:0,publication_idempotency_key:null,claim_token:null,listing_id:null,preview_hash:'old',draft_execution_id:'old-execution',preview:{imageUrls:['old'],offerId:'old-offer',inventoryItemPayload:{product:{title:'old'}},offerPayload:{}}}
 return {binding,exposure,consistency,publication,certified:{listingPackage:{generation:snapshot.generation,content}},now}
}
test('exposure is explicit package/identity/Truth scoped, never inferred from availability',()=>{
 const f=fixture();assert.equal(policy(f.exposure,f.binding).valid,true)
 for(const key of ['accountKey','packageId','productId','variantId','sku','productTruthDigest'])assert.equal(policy(f.exposure,{...f.binding,[key]:'other'}).valid,false)
 for(const patch of [{quantity:2},{status:'REVOKED'},{authorizationReference:null},{publicationAuthorized:true},{supplierQuantityInferred:true}])assert.equal(policy({...f.exposure,...patch},f.binding).valid,false)
 assert.equal(policy(null,f.binding).valid,false)
})
test('fresh availability and separate exposure grant ready inventory without supplier quantity',()=>{
 const f=fixture(),fact={VALUE:true,EVIDENCE_STATUS:'PROVEN',SEMANTIC_CLASS:'FACT',SOURCE_AUTHORITY:'SUPPLIER',CONTRADICTION:false,EVIDENCE_ID:'e',SOURCE_LOCATOR_OR_FIELD:'availability',OBSERVED_AT:'2026-09-11T07:00:00Z',FRESH_UNTIL:'2026-09-12T07:00:00Z'}
 const i={...f.binding,availability:fact,numericStock:null,exactBinding:true,exposurePolicy:f.exposure};const r=inventory(i)
 assert.equal(r.inventoryReady,true);assert.equal(r.listingQuantity,1);assert.equal(r.supplierQuantity,null)
 assert.equal(inventory({...i,availability:{...fact,EVIDENCE_STATUS:'STALE'}}).inventoryReady,false)
 assert.equal(inventory({...i,availability:{...fact,VALUE:false}}).inventoryReady,false)
})
test('revision preserves all historical data and replaces all current content and image fields',()=>{
 const f=fixture(),before=structuredClone(f.publication),r=build({...f,exposure:policy(f.exposure,f.binding)})
 assert.deepEqual(f.publication,before);assert.equal(r.publicationId,'publication');assert.equal(r.preview.offerId,null)
 assert.equal(r.preview.inventoryItemPayload.product.title,'Current');assert.deepEqual(r.preview.imageUrls,f.consistency.snapshot.content.imageUrls)
 assert.equal(r.preview.offerPayload.listingDescription,'Current own description');assert.equal(r.ebayPrevalidated,false)
 const view=project(r,f.consistency,f.publication);assert.equal(view.valid,true);assert.equal(view.publication.phase,'draft')
 assert.equal(build({...f,exposure:policy(f.exposure,f.binding),now:new Date(now.getTime()+1000)}).revisionKey,r.revisionKey)
})
test('unknown commit, claimed key, active lease, published or inconsistent package cannot revise',()=>{
 for(const patch of [{phase:'outcome_unknown'},{publish_attempt_count:1},{publication_idempotency_key:'publish:publication'},{claim_token:'lease'},{listing_id:'123'}]){
 const f=fixture();assert.throws(()=>build({...f,publication:{...f.publication,...patch},exposure:{valid:true,quantity:1}}))}
 const f=fixture();assert.throws(()=>build({...f,consistency:{...f.consistency,PACKAGE_CONSISTENT:false},exposure:{valid:true,quantity:1}}))
})
test('wrong package, product, account, generation, hash or modified preview cannot align',()=>{
 const f=fixture(),r=build({...f,exposure:{valid:true,quantity:1}})
 for(const k of ['packageId','productId','variantId','accountKey','packageGeneration','packageHash','priorPreviewHash','priorDraftExecutionId'])assert.equal(project({...r,[k]:'wrong'},f.consistency,f.publication).valid,false,k)
 assert.equal(project({...r,preview:{...r.preview,imageUrls:['other']}},f.consistency,f.publication).valid,false)
})

test('historical Preview is never a template for current condition, policies, inventory or Offer payload',()=>{
 const f=fixture();f.publication.preview.inventoryItemPayload={condition:'USED',packageWeightAndSize:{weight:999},product:{title:'old'}}
 f.publication.preview.offerPayload={listingPolicies:{paymentPolicyId:'legacy'},merchantLocationKey:'legacy',tax:{vatPercentage:99}}
 const before=structuredClone(f.publication)
 const r=build({...f,exposure:{valid:true,quantity:1},currentConfiguration:{target:'PRODUCTION',condition:'NEW',merchantLocationKey:'current',listingPolicies:{paymentPolicyId:'current'}}})
 assert.deepEqual(f.publication,before)
 assert.equal(r.preview.inventoryItemPayload.condition,'NEW');assert.equal(r.preview.inventoryItemPayload.packageWeightAndSize,undefined)
 assert.equal(r.preview.offerPayload.tax,undefined);assert.equal(r.preview.offerPayload.listingPolicies.paymentPolicyId,'current')
 const missing=build({...f,exposure:{valid:true,quantity:1}})
 assert.equal(missing.preview.inventoryItemPayload.condition,undefined);assert.equal(missing.preview.offerPayload.listingPolicies,undefined)
})
