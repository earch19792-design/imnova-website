import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './sell-one-like-this-v1.test.mjs'
import {prepareMayelOwnContentV1,mayelContentDiffV1,validateMayelContentPatchV1} from './mayel-autonomous-content-v1.ts'
import {keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1.ts'
import {executeOutboxOperationV1} from './ipad-sync-engine-v1.ts'
import {buildEbayInventoryManagedContentReplacementV1} from '../ebay/ebay-draft-only-gateway.ts'
const {mayelContentRevisionXmlV1,contentReadbackMatchesV1}=await import('../ebay/ebay-mayel-content-executor-v1.ts')
const {decodeListingDescriptionV1}=await import('../ebay/ebay-active-listing-image-revision-service.ts')
test('AUTONOMOUS_TITLE_OPTIMIZATION_PASS / DESCRIPTION_PASS / ITEM_SPECIFICS_PASS use own truth and V2.1',()=>{
 const f=fixture(),r=prepareMayelOwnContentV1(f)
 assert.equal(r.status,'QA_READY',r.blockers.join(','));assert.equal(r.proposal.qa.pass,true)
 const before={title:'Old title',description:'Old description',aspects:{Color:['Pink'],Brand:['Unbranded']}}
 const d=mayelContentDiffV1(before,r.proposal)
 assert.deepEqual(d.actions,['TITLE_OPTIMIZATION','DESCRIPTION_OPTIMIZATION','ITEM_SPECIFICS_OPTIMIZATION'])
 assert.deepEqual(d.after.aspects.Color,['Pink']);assert.equal(d.after.aspects.Style[0],'Charm')
 assert.doesNotMatch(JSON.stringify(d.after),/COMPETITOR|platinum|certified|warranty|stolen/)
 assert.equal(d.evidenceUsed.keyword.DECISION_VERSION,'PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1')
 assert.equal(d.evidenceUsed.keyword.LEGACY_FALLBACK_USED,false)
 assert.equal(mayelContentDiffV1(d.after,r.proposal).changed,false)
})
test('missing, stale, ambiguous or cross-product facts cannot authorize content',()=>{
 for(const change of [f=>f.keywordRead={},f=>f.keywordRead.VALIDATION.CURRENT_INPUTS_MATCH=false,
  f=>f.truthFields[0].VALUE='other',f=>f.truthFields.push({...f.truthFields[0]}),
  f=>f.truthFields.find(x=>x.FIELD==='TITLE').FRESH_UNTIL='2026-09-09T00:00:00Z',
  f=>f.requiredTruth.resolutions.Brand.exactProductSupported=false]){
  const f=fixture();change(f);assert.equal(prepareMayelOwnContentV1(f).proposal,null)
 }
})
test('unsupported patch fails closed; XML cannot touch price, inventory, gallery, policies or publication',()=>{
 for(const p of [{price:1},{title:'x',quantity:8},{imageUrls:['https://evil.test/x']},{sku:'other'},{description:'<script>alert(1)</script>'},{aspects:{Color:[]}}])
  assert.throws(()=>validateMayelContentPatchV1(p))
 const xml=mayelContentRevisionXmlV1('366650121192',{title:'A & B',description:'Own facts<br>Color: Pink',aspects:{Color:['Pink']}})
 assert.match(xml,/<Title>A &amp; B<\/Title>/);assert.match(xml,/<ItemSpecifics>/)
 assert.doesNotMatch(xml,/<Quantity>|<StartPrice>|<PictureDetails>|<SellerProfiles>|<AddFixedPriceItem/)
})
test('full Inventory replacement preserves every non-authorized value including gallery and inventory',()=>{
 const payload={sku:'SKU',locale:'en_US',availability:{shipToLocationAvailability:{quantity:7}},condition:'NEW',product:{title:'Old',description:'Old',aspects:{Color:['Pink']},imageUrls:['https://i.ebayimg.com/one']}}
 const original=structuredClone(payload),patch={title:'New',description:'Own facts',aspects:{Color:['Pink'],Style:['Charm']}}
 const result=buildEbayInventoryManagedContentReplacementV1({sku:'SKU',inventoryItemPayload:payload,expectedEvidenceDigest:digest(payload),patch})
 assert.deepEqual(payload,original);assert.deepEqual(result.payload.availability,payload.availability);assert.deepEqual(result.payload.product.imageUrls,payload.product.imageUrls)
 assert.equal(result.nonAuthorizedFieldsPreserved,true)
 assert.throws(()=>buildEbayInventoryManagedContentReplacementV1({sku:'other',inventoryItemPayload:payload,expectedEvidenceDigest:digest(payload),patch}))
 assert.throws(()=>buildEbayInventoryManagedContentReplacementV1({sku:'SKU',inventoryItemPayload:{...payload,newUnknownField:1},expectedEvidenceDigest:digest(payload),patch}))
})
test('official content readback requires unchanged protected fields and expected actual content',()=>{
 const after={title:'New',description:'Own<br>facts',aspects:{Style:['Charm']}},patch={title:'New',description:after.description,aspects:after.aspects}
 const current={content:after,categoryId:'123',protectedFields:{title:'New',price:'20',orderedGallery:['one'],descriptionDigest:'new',itemSpecificsDigest:'new'},inventoryPreserved:null,management:{managementModel:'TRADING_MANAGED'}}
 const audit={after,patch,categoryId:'123',protectedBefore:{...current.protectedFields,title:'Old',descriptionDigest:'old',itemSpecificsDigest:'old'},inventoryBefore:null,managementModel:'TRADING_MANAGED'}
 assert.equal(contentReadbackMatchesV1(current,audit),true)
 assert.equal(contentReadbackMatchesV1({...current,protectedFields:{...current.protectedFields,price:'19'}},audit),false)
 assert.equal(contentReadbackMatchesV1({...current,content:{...after,title:'Old'}},audit),false)
 assert.equal(decodeListingDescriptionV1('<![CDATA[Own<br>facts]]>'),'Own<br>facts')
 assert.equal(decodeListingDescriptionV1('Own&lt;br&gt;facts &amp; more'),'Own<br>facts & more')
})
test('content shares the real durable sync engine: one dispatch, official readback, unknown commit never retries',async()=>{
 let writes=0,readbacks=0,state='',applied=false
 const deps={authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async()=>{},markDispatch:async()=>{},
  readback:async()=>{readbacks++;return {official:true,baseHash:'base',matchesIntent:applied,safetyPass:true,reason:null,receipt:{official:true}}},
  execute:async()=>{writes++;applied=true;throw Error('TIMEOUT')},finish:async s=>{state=s}}
 await executeOutboxOperationV1({state:'PENDING_EBAY_SYNC',dispatchCount:0,baseHash:'base',kind:'LISTING_OPTIMIZATION'},deps)
 assert.equal(writes,1);assert.equal(state,'OFFICIAL_READBACK_REQUIRED')
 await executeOutboxOperationV1({state,dispatchCount:1,baseHash:'base',kind:'LISTING_OPTIMIZATION'},deps)
 assert.equal(writes,1);assert.equal(readbacks,2);assert.equal(state,'SYNCED')
 applied=false;await executeOutboxOperationV1({state:'PENDING_EBAY_SYNC',dispatchCount:0,baseHash:'stale',kind:'LISTING_OPTIMIZATION'},deps)
 assert.equal(writes,1);assert.equal(state,'REQUIRES_ATTENTION')
})
