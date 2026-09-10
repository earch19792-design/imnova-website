import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {scopedVisualTasksV1,friendlyVisualSyncV1} from './mayel-visual-scope-v1.ts'
import {approvedVisualReadbackMatchesV1} from './visual-sync-readback-v1.ts'
import {executeOutboxOperationV1} from './ipad-sync-engine-v1.ts'
import {visualAssetOwnerApprovedV1,visualAssetSyncViewV1,visualAssetSyncKeyV1} from './visual-asset-sync-state-v1.ts'
import {parseSellingFeeTaxPolicyV1} from '../ebay/ebay-selling-fee-tax-policy-v1.ts'
import {produceEbayFeeAuthorityV1} from './ebay-fee-producer-v1.ts'
import {otherVariableCostPolicyPresentV1,adsCanaryEconomicsV1} from './pre-sale-economics-v1.ts'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
const item='366582671136',other='366649508886', now=new Date('2026-09-10T10:00:00Z')
const task={id:'task',ebay_item_id:item,source_image_set_digest:'sources',product_truth_digest:'truth',visual_manifest_digest:'current'}
const asset={id:'asset',output_sha256:'output',source_sha256:'source',status:'approved',mayel_approval_status:'APPROVED',owner_approval_status:'PENDING',qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE'}},source_image_set_digest:'sources',product_truth_digest:'truth'}
asset.owner_sync_approval={confirmation:'APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1',assetId:asset.id,generation:'asset:output',idempotencyKey:visualAssetSyncKeyV1(asset),ownerUserId:'00000000-0000-4000-8000-000000000001',approvedAt:now.toISOString(),sourceImageSetDigest:'sources',productTruthDigest:'truth'}
const proof={official:true,ownerApproved:true,baseListingCompatible:true,approvedManifestDigest:'current',currentManifestDigest:'current',expectedImages:['https://example.com/new.jpg','https://example.com/retained.jpg'],currentImages:['https://example.com/new.jpg','https://example.com/retained.jpg']}
test('1136_OWNER_APPROVAL_AUTHORITY_PASS: legacy QA flag cannot supersede exact durable owner sync evidence',()=>{
 assert.equal(visualAssetOwnerApprovedV1(asset,task),true)
 for(const a of [{...asset,owner_sync_approval:{}},{...asset,output_sha256:'stale'},{...asset,product_truth_digest:'changed'}])assert.equal(visualAssetOwnerApprovedV1(a,task),false)
})
test('1136_STALE_GENERATION_FAIL_CLOSED_PASS: wrong item, task and old manifest cannot poison current receipt',()=>{
 const row={item_id:item,intent:{requestedChanges:{taskId:'task',manifestDigest:'current'}},binding:{assetId:'asset',sourceSha256:'source',executionManifestDigest:'current'},state:'SYNCED',official_readback:true,received_at:'2026-09-10T10:00:00Z'}
 const old={...row,binding:{...row.binding,executionManifestDigest:'old'},state:'REQUIRES_ATTENTION',received_at:'2026-09-10T09:00:00Z'}
 assert.equal(visualAssetSyncViewV1(asset,task,[old,row]).state,'SYNCED')
 assert.equal(visualAssetSyncViewV1(asset,task,[{...row,item_id:other}]).serverReceiptPresent,false)
 assert.equal(visualAssetSyncViewV1(asset,task,[{...row,intent:{requestedChanges:{taskId:'other'}}}]).serverReceiptPresent,false)
 assert.match(read('./ipad-durable-outbox-v1.ts'),/row\.kind === "IMAGE_SYNC" \|\| row\.intent\.requestedChanges\.manifestDigest != null/)
})
test('1136_OFFICIAL_READBACK_PASS: exact ordered gallery, current generation and protected fields required',()=>{
 assert.equal(approvedVisualReadbackMatchesV1(proof),true)
 for(const change of [{official:false},{ownerApproved:false},{baseListingCompatible:false},{currentManifestDigest:'stale'},{currentImages:[...proof.currentImages].reverse()},{currentImages:['https://example.com/thumbnail.jpg']},{expectedImages:[]}])assert.equal(approvedVisualReadbackMatchesV1({...proof,...change}),false)
})
function engine(applied){
 const events=[];let state='APPROVED_FOR_EBAY_SYNC',dispatch=0
 const d={authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async s=>{state=s},
 readback:async()=>{events.push('read');return{official:true,matchesIntent:applied,baseHash:'base',safetyPass:true,reason:null,receipt:{official:true}}},
 markDispatch:async()=>{assert.equal(dispatch,0);dispatch++},execute:async()=>{events.push('write');applied=true;return{writes:1,mediaWrites:0}},
 finish:async(s,r,p)=>{state=s;if(s==='SYNCED')assert.equal(p.official,true)}}
 return{d,events,op:{state,dispatchCount:0,baseHash:'base',kind:'IMAGE_DRAFT'},state:()=>state}
}
test('1136_READBACK_BEFORE_WRITE_PASS / 1136_ONE_IDEMPOTENT_SYNC_PASS',async()=>{
 const f=engine(false);const r=await executeOutboxOperationV1(f.op,f.d);assert.deepEqual(f.events,['read','write','read']);assert.equal(r.writes,1);assert.equal(f.state(),'SYNCED')
})
test('1136_ALREADY_APPLIED_NO_DUPLICATE_WRITE_PASS: matching readback reconciles without execution row',async()=>{
 const f=engine(true);const r=await executeOutboxOperationV1(f.op,f.d);assert.equal(r.writes,0);assert.deepEqual(f.events,['read']);assert.equal(f.state(),'SYNCED')
})
test('VISUAL_STATION_EXACT_ITEM_SCOPE_PASS / BULK_SELECTION_NO_CROSS_LISTING_TASK_PASS',()=>{
 const tasks=[{ebayItemId:other,visualTaskId:'other'},{ebayItemId:item,visualTaskId:'task'}]
 assert.deepEqual(scopedVisualTasksV1(tasks,item).map(t=>t.visualTaskId),['task'])
 assert.deepEqual(scopedVisualTasksV1(tasks,item,'other'),[])
 assert.deepEqual(scopedVisualTasksV1(tasks,'missing'),[])
 const menu=read('../../app/admin/ebay/mayel/revenue-engine.tsx')
 assert.doesNotMatch(menu,/visualStationItemId && selected\.includes/)
 assert.match(menu,/itemIds=\{visualStationItemId \? \[visualStationItemId\] : selected\}/)
 assert.match(read('../../app/admin/mayel-visual-workstation.tsx'),/generation !== loadGeneration\.current/)
})
test('PUBLICATION_VS_LIVE_SYNC_SEPARATION_PASS / QUALITY_MENU_DISCOVERABILITY_REGRESSION_PASS',()=>{
 const menu=read('../../app/admin/ebay/mayel/revenue-engine.tsx')
 for(const label of ['Publicar nuevo listing','Listos para publicar','Esperando datos','Requieren revisión','Pendientes de sincronizar con eBay','Revisar cambios de listings activos'])assert.ok(menu.includes(label))
 assert.match(menu,/menu === 0 && owner && <OwnerListingQualityReportControl/)
 for(const state of ['OWNER_APPROVAL_REQUIRED','DRAFT','PENDING_EBAY_SYNC','APPROVED_FOR_EBAY_SYNC','REVALIDATING','SYNCING','SYNCED','REQUIRES_ATTENTION'])assert.ok(['Guardado','Pendiente de sincronizar','Sincronizado','Requiere atención'].includes(friendlyVisualSyncV1(state).label))
})
test('FEE_COMPONENT_CLASSIFICATION_PASS / NO_UNKNOWN_FEE_TO_ZERO_PASS',()=>{
 const html='<h2>Tax on eBay selling fees</h2><p>In the US, this currently applies to sellers located in Hawaii, South Dakota, Texas, and Washington.</p>'
 const policy=parseSellingFeeTaxPolicyV1(html,now);assert.deepEqual(policy.applicableStates,['HI','SD','TX','WA'])
 assert.equal(parseSellingFeeTaxPolicyV1(html.replace('Washington','Florida'),now),null)
 const input={accountKey:'account',itemId:item,sku:'sku',packageId:null,now,context:{marketplaceAccountKey:'account',observedAt:now.toISOString(),identity:{itemId:item,sku:'sku',marketplace:'EBAY_US',accountBindingExact:true},listing:{price:18.74},accountPerformance:{accountBindingExact:true,registrationCountry:'US',registrationState:'FL'},feeTaxPolicy:policy}}
 const a=produceEbayFeeAuthorityV1(input)
 assert.equal(a.components.find(c=>c.type==='TAX_ON_FEES').classification,'NOT_APPLICABLE')
 assert.equal(a.components.find(c=>c.type==='TAX_ON_FEES').amount,0)
 assert.equal(a.components.find(c=>c.type==='CURRENCY_CONVERSION').pendingDependency,'CURRENT_PAYOUT_CURRENCY_AUTHORITY')
 assert.equal(a.components.find(c=>c.type==='INTERNATIONAL').amount,null);assert.equal(a.amount,null)
 for(const change of [{registrationState:null},{registrationState:'HI'},{registrationCountry:'CA'},{accountBindingExact:false}]){
 const b=produceEbayFeeAuthorityV1({...input,context:{...input.context,accountPerformance:{...input.context.accountPerformance,...change}}})
 assert.equal(b.components.find(c=>c.type==='TAX_ON_FEES').amount,null)}
 const stale=produceEbayFeeAuthorityV1({...input,now:new Date('2026-09-11T10:00:00Z')});assert.equal(stale.components.find(c=>c.type==='TAX_ON_FEES').amount,null)
})
test('OTHER_VARIABLE_COST_POLICY_PRESENT is independent of incomplete shipping/fees',()=>{
 const p=JSON.parse(read('../../docs/owner-variable-cost-policy-v1.json'))
 assert.equal(otherVariableCostPolicyPresentV1(p.marketplaceAccountKey,'366650054490'),true)
 assert.equal(otherVariableCostPolicyPresentV1(p.marketplaceAccountKey,'999999999999'),false)
})
test('ECONOMIC_SAFE_CEILING_PASS / ADS_PREVIEW_STOP_FOR_OWNER_PASS / NO_ADS_WRITE_PASS',async()=>{
 const v=value=>({value,fresh:true,reference:'synthetic-proof'})
 const economics={salePrice:v(100),productCost:v(30),shippingCost:v(10),ebayFees:v(15),otherCosts:v(0),adFeeBasis:v(110)}
 const policy={minRate:3,maxRate:5,minProfit:8,minMargin:15,mode:'MANUAL',window:'NOW',timeZone:'UTC',startsAt:null,endsAt:null}
 for(const rate of [3,4,5]){const p=adsCanaryEconomicsV1(economics,policy,rate);assert.equal(p.proposedAdRatePct,rate);assert.ok(p.maxSafeAdRatePct>5);assert.ok(p.projectedProfitAfterAds>=8);assert.ok(p.projectedMarginAfterAds>=15)}
 assert.equal(adsCanaryEconomicsV1({...economics,shippingCost:v(null)},policy,3).proposedAdRatePct,null)
 const f=engine(false);await executeOutboxOperationV1({...f.op,kind:'ADS_POLICY'},f.d);assert.equal(f.events.length,0)
 const activation=read('./ebay-ads-revenue-activation-v1.ts');assert.match(activation,/OWNER_APPROVAL_REQUIRED: true/);assert.match(activation,/ebayAdsWriteEnabled: false, multiListingAdsWriteEnabled: false/)
})
