import test from 'node:test'
import assert from 'node:assert/strict'
import {goldenDigest} from './commercial-golden-path-domain-v1.ts'
import {buildGoldenLiveComparisonReviewV1,applyGoldenLiveComparisonReviewsV1,goldenLiveCohortIdentityDigestV1} from './commercial-golden-path-live-comparison-v1.ts'
const candidate={productId:'1',variantId:'2',supplierSku:'FIXTURE',supplierQuantity:1}, owner='FIXTURE_OWNER', fp='sha256:'+'a'.repeat(64), now=new Date('2026-10-03T05:00:00Z')
const listings=[{itemId:'999999999991',sku:'OTHER_A',title:'Fixture A'},{itemId:'999999999992',sku:'OTHER_B',title:'Fixture B'}]
const base={status:'UNPROVEN',marketplaceWrites:0,paginationComplete:true,unresolvedItemIds:listings.map(l=>l.itemId),relatedItemIds:[],comparisonTargets:listings,cohortIdentityDigest:goldenLiveCohortIdentityDigestV1('FIXTURE_ACCOUNT',candidate,fp,listings)}
const evaluation={candidate,evaluatedAt:now.toISOString(),sourceIdentity:{sourceFingerprint:fp},duplicateGate:base,executionAuthority:{source:'AUTHENTICATED_CONTROL_MCP',ownerUserId:owner}}
const review={evaluationReceiptId:'FIXTURE_RECEIPT',comparisons:listings.map(l=>({itemId:l.itemId,decision:'DIFFERENT_PRODUCT',reason:'Owner reviewed the different physical product',sourceLocator:'fixture://comparison-source',sourceDigest:fp}))}
const input={candidate,sourceFingerprint:fp,ownerUserId:owner,invocationSource:'AUTHENTICATED_CONTROL_MCP',now,evaluation,review}
const stored=r=>{const payload={liveComparisonReview:r,executionAuthority:evaluation.executionAuthority};return {receipt_id:'FIXTURE_DURABLE_RECEIPT',payload,evidence_digest:goldenDigest(payload)}}
test('explicit OWNER comparison can clear this candidate without repairing any historical product linkage',()=>{
 const r=buildGoldenLiveComparisonReviewV1(input), out=applyGoldenLiveComparisonReviewsV1({base,candidate,sourceFingerprint:fp,ownerUserId:owner,now,receipts:[stored(r)]})
 assert.equal(out.status,'PASS');assert.equal(out.historicalBackfillStarted,false);assert.equal(out.supplierTruthModified,false);assert.equal(out.portfolioLinkageModified,false)
 assert.deepEqual(out.ownerComparedDistinctItemIds,base.unresolvedItemIds);assert.equal(out.marketplaceWrites,0)
})
test('partial review stays UNPROVEN; related known variants and actual duplicates cannot be overridden',()=>{
 const r=buildGoldenLiveComparisonReviewV1({...input,review:{...review,comparisons:review.comparisons.slice(0,1)}})
 const args={base,candidate,sourceFingerprint:fp,ownerUserId:owner,now,receipts:[stored(r)]}
 assert.equal(applyGoldenLiveComparisonReviewsV1(args).status,'UNPROVEN')
 assert.equal(applyGoldenLiveComparisonReviewsV1({...args,base:{...base,status:'DUPLICATE'}}).status,'DUPLICATE')
 const full=stored(buildGoldenLiveComparisonReviewV1(input))
 assert.equal(applyGoldenLiveComparisonReviewsV1({...args,receipts:[full],base:{...base,relatedItemIds:['999999999993']}}).status,'UNPROVEN')
})
test('expired, tampered, different account/cohort, candidate/quantity, supplier fingerprint and owner receipts stay UNPROVEN',()=>{
 const receipt=stored(buildGoldenLiveComparisonReviewV1(input)), args={base,candidate,sourceFingerprint:fp,ownerUserId:owner,now,receipts:[receipt]}
 for(const change of [{now:new Date(+now+86400000)},{ownerUserId:'OTHER_OWNER'},{candidate:{...candidate,supplierQuantity:2}},{sourceFingerprint:'sha256:'+'b'.repeat(64)},{base:{...base,cohortIdentityDigest:goldenLiveCohortIdentityDigestV1('OTHER_ACCOUNT',candidate,fp,listings)}},{receipts:[{...receipt,evidence_digest:'sha256:'+'0'.repeat(64)}]}]) assert.equal(applyGoldenLiveComparisonReviewsV1({...args,...change}).status,'UNPROVEN')
 assert.notEqual(goldenLiveCohortIdentityDigestV1('FIXTURE_ACCOUNT',candidate,fp,[{...listings[0],title:'Changed LIVE identity'},listings[1]]),base.cohortIdentityDigest)
 assert.notEqual(goldenLiveCohortIdentityDigestV1('FIXTURE_ACCOUNT',candidate,fp,[{...listings[0],variationKey:'ChangedVariant'},listings[1]]),base.cohortIdentityDigest)
 assert.equal(goldenLiveCohortIdentityDigestV1('FIXTURE_ACCOUNT',candidate,fp,[...listings].reverse()),base.cohortIdentityDigest)
})
test('service diagnostics, uncertified cohorts, wrong candidate, duplicate IDs and foreign LIVE IDs cannot create OWNER reviews',()=>{
 for(const change of [{invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC'},{evaluation:{...evaluation,duplicateGate:{...base,paginationComplete:false}}},{candidate:{...candidate,variantId:'3'}},{review:{...review,comparisons:[review.comparisons[0],review.comparisons[0]]}},{review:{...review,comparisons:[{...review.comparisons[0],itemId:'999999999999'}]}}]) assert.throws(()=>buildGoldenLiveComparisonReviewV1({...input,...change}),/LIVE_COMPARISON_/)
})
