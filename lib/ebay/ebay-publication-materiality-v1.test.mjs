import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {fixture} from '../seller-os/sell-one-like-this-v1.test.mjs'
import {prepareSellOneLikeThisV1} from '../seller-os/sell-one-like-this-v1.ts'
import {listingPipelineConsistencyV1 as gate} from '../seller-os/listing-pipeline-consistency-v1.ts'
import {keywordWireDigestV1 as hash} from '../seller-os/keyword-intelligence-handoff-v1.ts'
import {currentPackagePreviewRevisionV1 as preview} from '../seller-os/publication-package-preparation-v1.ts'
import {publicationRevisionPublisherViewV1 as publisher} from '../seller-os/publication-revision-publisher-view-v1.ts'
import {observationIndependentFactV1 as semanticFact} from '../seller-os/publication-evidence-materiality-v1.ts'
const authority=f=>({...f,accountKey:f.binding.ACCOUNT_KEY,sku:'OUR-SKU'})
function setup(){
 const f=fixture();f.truthFields.push({...f.truthFields[0],FIELD:'SUPPLIER_AVAILABILITY',VALUE:'AVAILABLE',FRESH_UNTIL:'2026-09-11T15:00:00Z'})
 const p=prepareSellOneLikeThisV1(f),a=authority(f),first=gate(p,a)
 a.pinnedSnapshot=first.snapshot;a.pinnedPackageHash=first.PACKAGE_HASH
 const pub={id:'pub',listing_package_id:f.packageId,marketplace_account_key:f.binding.ACCOUNT_KEY,preview_hash:'old',draft_execution_id:'old',phase:'preview_ready'}
 const contentPreview={inventoryItemPayload:{product:first.snapshot.content}}
 const rev={version:'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1',publicationId:pub.id,packageId:f.packageId,accountKey:f.binding.ACCOUNT_KEY,productId:f.binding.PRODUCT_ID,variantId:f.binding.VARIANT_ID,sku:a.sku,packageGeneration:first.snapshot.generation,packageHash:first.PACKAGE_HASH,snapshot:first.snapshot,preview:contentPreview,previewHash:hash(contentPreview),priorPreviewHash:'old',priorDraftExecutionId:'old'}
 return {f,p,a,first,pub,rev}
}
function rotate(a){
 a.truthFields=a.truthFields.map(f=>({...f,EVIDENCE_ID:hash('new'+f.FIELD),OBSERVED_AT:'2026-09-10T14:00:00Z',FRESH_UNTIL:'2026-09-12T00:00:00Z'}))
 const d=a.keywordRead.DECISION;d.INPUT_AUTHORITY_FINGERPRINT=hash('new-input')
 d.INPUT_FINGERPRINT='sha256:'+createHash('sha256').update(`[${JSON.stringify(d.DECISION_VERSION)}, ${JSON.stringify(d.INPUT_AUTHORITY_FINGERPRINT)}]`).digest('hex')
 a.keywordRead.VALIDATION.TRANSPORT_DIGEST=hash({BINDING:a.keywordRead.BINDING,DECISION:d})
}
test('equivalent Keyword/stock receipt rotation keeps exact package hash and Preview, with fresh lineage',()=>{
 const {p,a,first,pub,rev}=setup(),before=JSON.stringify(p);rotate(a)
 const g=gate(p,a);assert.equal(g.evidenceMateriality.equivalent,true);assert.equal(g.KEYWORD_V2_1_VERSION_PINNED,true)
 assert.equal(g.PACKAGE_CONSISTENT,true);assert.equal(g.PACKAGE_HASH,first.PACKAGE_HASH)
 assert.deepEqual(g.snapshot,first.snapshot);assert.notDeepEqual(g.currentEvidenceLineage.sourceEvidenceReferences,first.snapshot.sourceEvidenceReferences)
 assert.equal(preview(rev,g,pub).valid,true);assert.equal(preview(rev,g,pub).publication.phase,'draft');assert.equal(JSON.stringify(p),before)
})
test('real accepted keyword semantic change invalidates even with valid transport',()=>{
 const {p,a,pub,rev}=setup();rotate(a);const d=a.keywordRead.DECISION;d.TERMS.push({TERM:'charm',CLASSIFICATION:'SECONDARY_KEYWORDS'})
 a.keywordRead.VALIDATION.TRANSPORT_DIGEST=hash({BINDING:a.keywordRead.BINDING,DECISION:d})
 const g=gate(p,a);assert.equal(g.KEYWORD_V2_1_VERSION_PINNED,false);assert.equal(preview(rev,g,pub).valid,false)
})
test('fresh IN_STOCK to OUT_OF_STOCK is material and cannot be exposed',()=>{
 const {p,a}=setup();rotate(a);a.truthFields.find(f=>f.FIELD==='SUPPLIER_AVAILABILITY').VALUE='OUT_OF_STOCK'
 const g=gate(p,a);assert.equal(g.evidence.inventory.availability,'OUT_OF_STOCK');assert.equal(g.evidence.inventory.inventoryReady,false);assert.equal(g.evidenceMateriality.equivalent,false)
})
test('changed content or image order cannot keep aligned Preview',()=>{
 for(const change of [p=>p.listingPackage.content.title+=' other',p=>p.listingPackage.content.imageUrls.push('https://other/image')]){
  const {p,a,pub,rev}=setup();change(p)
  assert.equal(preview(rev,gate(p,a),pub).valid,false)
 }
})
test('selected locator rotation is equivalent only within the same corroborating source set',()=>{
 const f={VALUE:'same',SOURCE_LOCATOR_OR_FIELD:'a',SOURCE_EVIDENCE:[{VALUE:'same',SOURCE_LOCATOR_OR_FIELD:'a'},{VALUE:'same',SOURCE_LOCATOR_OR_FIELD:'b'}]}
 assert.deepEqual(semanticFact(f),semanticFact({...f,SOURCE_LOCATOR_OR_FIELD:'b',SOURCE_EVIDENCE:[...f.SOURCE_EVIDENCE].reverse()}))
 assert.notDeepEqual(semanticFact(f),semanticFact({...f,SOURCE_LOCATOR_OR_FIELD:'unproved'}))
})
function resolvedPublisher(){
 const imageSetDigest=hash('images'),r={version:'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1',publicationId:'p',packageId:'pkg',packageHash:'hash',packageGeneration:'gen',certifiedPackage:{sourceProvenance:{images:{ownImageSetDigest:imageSetDigest}}}}
 const resolution={issueSignature:'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED',publisherContract:'SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1',resolution:'SUPERSEDED',resolutionBasis:'CURRENT_CERTIFIED_FULL_SOURCE_GALLERY',publicationId:'p',packageId:'pkg',imageSetDigest,publicationAuthorized:false,recordedAt:'2026-09-11T08:00:00Z'}
 return {id:'p',sanitized_result:{publicationPreparationV1:{current:r,publisherResolutionV1:resolution}}}
}
test('durably superseded publisher issue does not resurrect on unrelated receipts or temporarily missing evidence',()=>{
 const p=resolvedPublisher(),r=publisher(p,{pass:false,reason:'CURRENT_REVISION_IMAGE_AUTHORITY_UNPROVEN'},'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED')
 assert.equal(r.historicalPublisherContradictionSuperseded,true);assert.equal(r.currentPublisherContradictionCount,0);assert.equal(r.currentRevisionImageContractPass,false)
})
test('real current gallery violation creates a current contradiction without rewriting history',()=>{
 const p=resolvedPublisher(),a={pass:false,currentViolationProven:true,contractVersion:'SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1',packageHash:'hash',generation:'gen'}
 const r=publisher(p,a,'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED');assert.equal(r.currentPublisherContradictionCount,1);assert.equal(r.currentIssue,'CURRENT_GALLERY_PROVENANCE_MISMATCH');assert.equal(r.historicalPublisherContradictionSuperseded,true)
})
test('historical ACK cannot prevalidate a current revision after nonmaterial refresh',()=>{
 const {p,a,pub,rev}=setup();rotate(a);const r=preview(rev,gate(p,a),{...pub,phase:'preview_ready',officialReadback:true})
 assert.equal(r.valid,true);assert.equal(r.publication.phase,'draft');assert.equal(r.revision.ebayPrevalidated,undefined)
})
test('same input fingerprint cannot mask a changed accepted decision',()=>{
 const {p,a}=setup(),d=a.keywordRead.DECISION;d.TERMS.push({TERM:'charm',CLASSIFICATION:'CORE_QUALIFIERS'})
 a.keywordRead.VALIDATION.TRANSPORT_DIGEST=hash({BINDING:a.keywordRead.BINDING,DECISION:d})
 assert.equal(gate(p,a).KEYWORD_V2_1_VERSION_PINNED,false);assert.equal(gate(p,a).PACKAGE_CONSISTENT,false)
})
