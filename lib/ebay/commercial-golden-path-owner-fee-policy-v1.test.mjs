import test from 'node:test'
import assert from 'node:assert/strict'
import { goldenDigest } from './commercial-golden-path-domain-v1.ts'
import { buildGoldenOwnerFeePolicyV1, validGoldenOwnerFeePolicyV1, readGoldenOwnerFeePolicyFromReceiptV1 } from './commercial-golden-path-owner-fee-policy-v1.ts'
const now=new Date('2026-10-03T06:00:00Z')
const context={candidate:{productId:'1',variantId:'2',supplierSku:'FIXTURE-ONLY',supplierQuantity:1},accountKey:'FIXTURE-ACCOUNT',ownerUserId:'fixture-owner',invocationSource:'AUTHENTICATED_CONTROL_MCP',sourceFingerprint:goldenDigest('fixture-source'),price:20,now}
const policy={variableRateFraction:.15,fixedAmountUsd:.3,freshUntil:'2026-10-03T07:00:00Z',sourceLocator:'fixture://owner-approval',sourceDigest:goldenDigest('fixture-policy'),approvalNote:'Synthetic OWNER approval; never production evidence',operatorAttested:true}
test('provisional fee policy is explicit, candidate/price bound, and never official or realized authority',()=>{
 const fee=buildGoldenOwnerFeePolicyV1({...context,policy})
 assert.equal(fee.status,'PROVISIONAL_OWNER_POLICY');assert.equal(fee.amountUsd,3.3)
 assert.equal(fee.officialFeeAuthority,false);assert.equal(fee.realizedFeeAuthority,false)
 assert.equal(validGoldenOwnerFeePolicyV1(fee,context),true)
 for(const changes of [{accountKey:'OTHER'},{price:21},{sourceFingerprint:goldenDigest('other')},{candidate:{...context.candidate,supplierQuantity:2}},{now:new Date('2026-10-03T07:00:00Z')}])assert.equal(validGoldenOwnerFeePolicyV1(fee,{...context,...changes}),false)
 assert.equal(validGoldenOwnerFeePolicyV1({...fee,amountUsd:0},context),false)
})
test('service diagnostics, absent OWNER consent, invalid rates and invalid expiry cannot create policy authority',()=>{
 for(const invocationSource of [undefined,'SERVICE_CERTIFICATION_DIAGNOSTIC'])assert.throws(()=>buildGoldenOwnerFeePolicyV1({...context,policy,invocationSource}),/UNAUTHENTICATED/)
 for(const change of [{operatorAttested:false},{variableRateFraction:NaN},{variableRateFraction:1.1},{fixedAmountUsd:-1},{sourceDigest:null},{freshUntil:'2026-10-03T06:00:00Z'},{freshUntil:'2026-10-05T06:00:00Z'}])assert.throws(()=>buildGoldenOwnerFeePolicyV1({...context,policy:{...policy,...change}}),/INVALID/)
 assert.equal(buildGoldenOwnerFeePolicyV1({...context,policy,price:null}).status,'UNPROVEN')
})
test('durable policy reuse validates full receipt hash, authenticated OWNER, candidate, freshness and price',()=>{
 const fee=buildGoldenOwnerFeePolicyV1({...context,policy})
 const payload={economics:{feeAuthority:fee},executionAuthority:{source:'AUTHENTICATED_CONTROL_MCP',ownerUserId:context.ownerUserId}}
 const row={receipt_id:'fixture-only',payload,evidence_digest:goldenDigest(payload)}
 assert.deepEqual(readGoldenOwnerFeePolicyFromReceiptV1(row,context),fee)
 assert.equal(readGoldenOwnerFeePolicyFromReceiptV1({...row,evidence_digest:goldenDigest('wrong')},context),null)
 assert.equal(readGoldenOwnerFeePolicyFromReceiptV1(row,{...context,ownerUserId:'another-owner'}),null)
 const diagnostic={...payload,executionAuthority:{...payload.executionAuthority,source:'SERVICE_CERTIFICATION_DIAGNOSTIC'}}
 assert.equal(readGoldenOwnerFeePolicyFromReceiptV1({...row,payload:diagnostic,evidence_digest:goldenDigest(diagnostic)},context),null)
})
