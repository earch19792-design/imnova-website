import test from 'node:test'
import assert from 'node:assert/strict'
import {currentFactoryMarkerV1, currentFactoryMaterializationV1, currentFactoryPreparationStatusV1,CURRENT_PUBLICATION_FACTORY_V1} from '../seller-os/current-publication-factory-v1.ts'
import {readFileSync} from 'node:fs'
const marker={version:CURRENT_PUBLICATION_FACTORY_V1,packageId:'current',generation:'generation',accountKey:'account',productId:'product',variantId:'variant',supplierSku:'sku',authorityPolicy:'CURRENT_ONLY',reuseLegacyPreparation:false}
test('historical readiness, quotes, fees, approval/execution cannot enter a new CURRENT package',()=>{
 const legacy={shipping:{ready:true,amount:6.99},fees:{ready:true},preview:{ready:true},approval:{accepted:true},execution:{claimable:true},quickPickOwnerReviewV1:{approved:true},draftConfiguration:{title:'old'},currentPublicationFactoryV1:marker}
 const result=currentFactoryMaterializationV1({...legacy,pricing:{currency:'USD',targetPrice:17.77,shipping:6.99,fees:3.12,profit:5}},legacy)
 assert.deepEqual(Object.keys(result).sort(),['currentPublicationFactoryV1','pricing'])
 assert.deepEqual(result.pricing,{targetPrice:17.77,currency:'USD',source:'CURRENT_FACTORY_PRICE_PROPOSAL',economicsProven:false})
 assert.equal(currentFactoryMarkerV1({currentPublicationFactoryV1:{...marker,reuseLegacyPreparation:true}}),null)
 assert.equal(currentFactoryMarkerV1({currentPublicationFactoryV1:{...marker,variantId:''}}),null)
})
test('category bound to another package is excluded, exact current resolver survives',()=>{
 const old={currentPublicationFactoryV1:marker,categoryId:'category',categoryResolverV1:{status:'AUTO_SELECTED',listingPackageId:'old'},aspects:{Brand:'old'}}
 assert.equal(currentFactoryMaterializationV1({},old).categoryId,undefined)
 assert.equal(currentFactoryMaterializationV1({},{...old,categoryResolverV1:{status:'AUTO_SELECTED',listingPackageId:'current'}}).categoryId,'category')
})
test('new CURRENT readiness cannot become ready from missing dependent authorities',()=>{
 const result=currentFactoryPreparationStatusV1({keywordReady:false,shippingReady:false,feeReady:false,previewAligned:false,executionValid:false,claimable:false})
 assert.equal(result.readyToPublish,false);assert.equal(result.ownerActionRequired,false);assert.equal(result.publicationAuthorized,false)
 assert.equal(result.missingCurrentAuthorities.length,6)
})
test('operational selectors are CURRENT-only; explicit current preparation cannot fall back to old approval',()=>{
 const source=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
 for(const p of ['lib/ebay/ebay-luna-quick-pick-v1.ts','lib/ebay/ebay-smart-stocking-listing-intake-v1.ts','lib/ebay/ebay-smart-stocking-durable-factory-v1.ts','lib/seller-os/sell-one-like-this-runtime-v1.ts'])assert.match(source(p),/ebay_current_listing_packages_v1/)
 assert.match(source('app/api/admin/ebay/draft-only/route.ts'),/CURRENT_REVISION_PREPARATION_REQUIRED_NO_LEGACY_FALLBACK/)
 assert.match(source('app/api/admin/ebay/draft-only/route.ts'),/LEGACY_SUPERSEDED_FOR_NEW_PUBLICATION_CURRENT_REVISION_REQUIRED/)
})
