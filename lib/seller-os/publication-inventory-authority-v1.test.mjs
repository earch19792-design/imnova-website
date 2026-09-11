import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {publicationInventoryAuthorityV1 as project} from './publication-inventory-authority-v1.ts'
const hash=v=>'sha256:'+createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fact=value=>({VALUE:value,EVIDENCE_STATUS:'PROVEN',CONTRADICTION:false,SEMANTIC_CLASS:'FACT',SOURCE_AUTHORITY:'SUPPLIER',
 EVIDENCE_ID:'snapshot',SOURCE_LOCATOR_OR_FIELD:'exact variant available',OBSERVED_AT:'2026-09-11T07:00:00Z',FRESH_UNTIL:'2026-09-12T07:00:00Z'})
function fixture(){
 const lineage={supplierSku:'sku',lunaProductId:'product',lunaVariantId:'variant',productTruthDigest:'sha256:'+'a'.repeat(64)}
 const material={contractVersion:'QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1',listingPackageId:'package',exactProductLineage:lineage,quantity:1,title:'Own product',imageUrls:['source']}
 return {availability:fact('AVAILABLE'),numericStock:fact(null),exactBinding:true,now:new Date('2026-09-11T08:00:00Z'),packageId:'package',sku:'sku',productId:'product',variantId:'variant',currentQuantityMaterial:material,
 quantityReview:{contractVersion:'QUICK_PICK_REMOTE_OWNER_REVIEW_V1',status:'CONFIRMED',reviewedBy:'owner',reviewedAt:'2026-09-11T07:00:00Z',materialPackageDigestVersion:'QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1',materialPackageChangeInvalidatesAuthorization:true,reviewedPackageDigest:hash(material),authorizedPackageId:'package',authorizedSku:'sku',exactProductLineage:lineage,authorizedQuantity:1}}
}
test('fresh availability with separately bound exposure policy is ready, supplier quantity remains unknown',()=>{
 const r=project(fixture());assert.equal(r.inventoryReady,true);assert.equal(r.listingQuantity,1);assert.equal(r.supplierQuantity,null);assert.equal(r.supplierNumericQuantityRequired,false)
})
test('availability alone does not manufacture listing or supplier quantity',()=>{
 const f=fixture();delete f.quantityReview;const r=project(f);assert.equal(r.supplierAvailabilityAuthorityValid,true);assert.equal(r.inventoryReady,false);assert.equal(r.listingQuantity,null);assert.equal(r.supplierQuantity,null)
})
test('stock freshness is independent of availability and stale is not OUT_OF_STOCK',()=>{
 const f=fixture();f.availability.FRESH_UNTIL='2026-09-11T07:30:00Z';f.availability.EVIDENCE_STATUS='STALE';
 const r=project(f);assert.equal(r.availability,'IN_STOCK');assert.equal(r.freshness,'STALE');assert.equal(r.reason,'WAITING_FOR_REFRESH');assert.equal(r.inventoryReady,false)
 f.availability.FRESH_UNTIL='2026-09-12T07:00:00Z';assert.equal(project(f).freshness,'STALE')
})
test('fresh OUT_OF_STOCK blocks; unknown, contradictions and missing expiry fail closed',()=>{
 for(const mutate of [f=>f.availability.VALUE=false,f=>f.availability.VALUE=null,f=>f.availability.CONTRADICTION=true,f=>delete f.availability.FRESH_UNTIL,
 f=>f.availability.OBSERVED_AT='2026-09-12T07:00:00Z',f=>f.numericStock= fact(0)]){
 const f=fixture();mutate(f);assert.equal(project(f).inventoryReady,false)}
 assert.equal(project({...fixture(),availability:fact(false)}).availability,'OUT_OF_STOCK')
})
test('quantity review is exact product, variant, SKU, package and material scoped',()=>{
 for(const mutate of [f=>f.packageId='other',f=>f.sku='other',f=>f.productId='other',f=>f.variantId='other',f=>f.exactBinding=false,
 f=>f.currentQuantityMaterial.title='Changed',f=>f.currentQuantityMaterial.imageUrls=['different'],f=>f.quantityReview.authorizedQuantity=2,
 f=>f.quantityReview.materialPackageChangeInvalidatesAuthorization=false]){
 const f=fixture();mutate(f);assert.equal(project(f).inventoryReady,false)}
})
test('explicit supplier quantity remains separate and caps exposed quantity',()=>{
 const f=fixture();f.numericStock=fact(3);const r=project(f);assert.equal(r.supplierQuantity,3);assert.equal(r.listingQuantity,1);assert.equal(r.inventoryReady,true)
})
