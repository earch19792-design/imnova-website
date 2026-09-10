import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {PGlite} from '@electric-sql/pglite'
import {buildFullGalleryMutationV1 as build,fullGalleryManifestMatchesV1,fullGalleryReadbackV1,existingGalleryMutationDecisionV1} from './mayel-full-gallery-mutation-v1.ts'
import {decideMayelAssetPositionV1} from './mayel-visual-intent-v1.ts'
import {executeOutboxOperationV1} from './ipad-sync-engine-v1.ts'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}})
const {readDelegatedVisualAuthorityV1}=await import('./mayel-optimization-delegation-server-v1.ts')
const {provenGalleryRemovalsV1}=await import('./mayel-full-gallery-server-v1.ts')
const {buildReviseFixedPriceItemPicturesOnlyXmlV1,buildDelegatedMayelTradingPictureSetV1}=await import('../ebay/ebay-mayel-trading-visual-executor-v1.ts')
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,truth='sha256:'+'a'.repeat(64)
const current='ABCDEF'.split('').map(c=>`https://i.ebayimg.com/${c}.jpg`)
const assets=[{assetId:id(2),role:'DETAIL',outputSha256:'b'.repeat(64),publicUrl:'https://own.test/X.jpg'}, {assetId:id(3),role:'LIFESTYLE',outputSha256:'c'.repeat(64),publicUrl:'https://own.test/Y.jpg'}]
const base={visualTaskId:id(1),ebayItemId:'366643122092',accountKey:'account',generation:truth,currentImages:current,assets,productTruthDigest:truth,sourceImageSetDigest:truth}
const keep=()=>current.map((u,p)=>({action:'KEEP',sourcePosition:p,targetPosition:p,assetId:null,visualRole:p?'CURRENT':'MAIN',intentReason:'Preservar evidencia actual.'}))
const replacement=()=>keep().map(d=>d.sourcePosition===1?{...d,action:'REPLACE',assetId:id(2),visualRole:'DETAIL',intentReason:'Mejorar este detalle.'}:d)
function combined(){const ds=replacement();ds[3]={...ds[3],action:'REMOVE',targetPosition:null,removalEvidence:{productTruthDigest:truth,evidenceReferences:[current[4]],noRequiredEvidenceLost:true,semanticQaPassed:true}};ds[4].targetPosition=3;ds.push({action:'ADD',sourcePosition:null,targetPosition:4,assetId:id(3),visualRole:'LIFESTYLE',intentReason:'Mostrar el uso antes de la última vista.'});return ds}
test('FULL_GALLERY_MUTATION_PASS: replace B, remove D, insert Y at 4; KEEP preserved',()=>{
 const m=build({...base,decisions:combined()})
 assert.deepEqual(m.proposedOrderedImages.map(e=>e.publicUrl),[current[0],assets[0].publicUrl,current[2],current[4],assets[1].publicUrl,current[5]])
 assert.deepEqual(m.removedOfficialImageUrls,[current[1],current[3]])
 assert.equal(m.ownerSlotApprovalRequired,false);assert.equal(m.finalOrderedEbayGallery.length,6)
 assert.ok(fullGalleryManifestMatchesV1({...base,decisions:m.galleryDecisions},m))
 assert.equal(m.galleryDecisions[3].targetPosition,null)
 const eps=['https://i.ebayimg.com/X.jpg','https://i.ebayimg.com/Y.jpg']
 const prepared=buildDelegatedMayelTradingPictureSetV1({currentOfficialImageUrls:current,proposedSourceImageUrls:m.proposedOrderedImages.map(e=>e.publicUrl),preparedAssets:assets.map((a,i)=>({sourceUrl:a.publicUrl,epsImageUrl:eps[i]}))})
 const xml=buildReviseFixedPriceItemPicturesOnlyXmlV1({itemId:base.ebayItemId,pictureUrls:prepared.pictureUrls})
 assert.ok(xml.includes('<PictureDetails>'));assert.equal((xml.match(/<PictureURL>/g)||[]).length,6)
 assert.ok(xml.indexOf(eps[0])<xml.indexOf(current[2]));assert.ok(!xml.includes(current[1]));assert.ok(!xml.includes(current[3]))
})
test('deterministic slots: MAIN zero, replacements isolated, ADD cannot be implicit, omissions/reorder fail closed',()=>{
 for(let p=0;p<6;p++){const ds=keep();ds[p]={...ds[p],action:p?'REPLACE':'REPLACE_MAIN',assetId:id(2)};const m=build({...base,decisions:ds});assert.equal(m.proposedOrderedImages[p].assetId,id(2));for(let j=0;j<6;j++)if(j!==p)assert.equal(m.proposedOrderedImages[j].publicUrl,current[j])}
 for(const target of [null,-1,24,1.5,undefined]){const ds=replacement();ds[1].targetPosition=target;assert.throws(()=>build({...base,decisions:ds}))}
 assert.throws(()=>build({...base,decisions:keep().slice(1)}),/UNAUTHORIZED_IMAGE_REMOVAL/)
 const reorder=keep();reorder[1].targetPosition=2;reorder[2].targetPosition=1;assert.throws(()=>build({...base,decisions:reorder}),/UNAUTHORIZED_IMAGE_REORDER/)
 reorder[1].action='REORDER';const moved=build({...base,decisions:reorder});assert.deepEqual(moved.proposedOrderedImages.map(e=>e.publicUrl),[current[0],current[2],current[1],...current.slice(3)])
 assert.deepEqual(existingGalleryMutationDecisionV1(current,moved.proposedOrderedImages.map(e=>e.publicUrl),moved).actions,['IMAGE_REORDER'])
 const bad=keep();bad[1]={...bad[1],action:'REPLACE_MAIN',assetId:id(2)};assert.throws(()=>build({...base,decisions:bad}),/MAIN_POSITION_ZERO/)
 const add=keep();for(const d of add)if(d.targetPosition>=2)d.targetPosition++;add.push({action:'ADD',sourcePosition:null,targetPosition:2,assetId:id(2),visualRole:'DETAIL',intentReason:'Detalle antes de las vistas restantes.'});const inserted=build({...base,decisions:add});assert.equal(inserted.proposedOrderedImages[2].assetId,id(2));assert.deepEqual(inserted.proposedOrderedImages.filter(e=>!e.assetId).map(e=>e.publicUrl),current)
})
test('removal never inferred from missing slots or a caller QA flag',()=>{
 const ds=combined(),t={product_truth_digest:truth,source_image_references:[]}
 assert.equal(provenGalleryRemovalsV1(t,ds,current),false)
 t.source_image_references=[{url:current[3],sha256:'f'.repeat(64)},{url:current[4],sha256:'f'.repeat(64)}]
 assert.equal(provenGalleryRemovalsV1(t,ds,current),true)
 t.source_image_references[1].sha256='e'.repeat(64);assert.equal(provenGalleryRemovalsV1(t,ds,current),false)
 delete ds[3].removalEvidence;assert.throws(()=>build({...base,decisions:ds}),/REMOVAL_EVIDENCE_REQUIRED/)
 assert.throws(()=>build({...base,decisions:keep().map(d=>({...d,action:'REMOVE',targetPosition:null}))}))
})
test('active delegation validates full manifest and every selected asset; tampering and identity drift stay closed',async()=>{
 const ds=replacement(),m=build({...base,decisions:ds}),t={id:base.visualTaskId,ebay_item_id:base.ebayItemId,marketplace_account_key:'account',status:'OWNER_PREVIEW_READY',current_image_set:current,visual_manifest:m,product_truth_digest:truth,source_image_set_digest:truth,selection_signal:{productTruthSupported:true,currentOfficialGallery:{authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',images:current}},source_image_references:[{authority:'OFFICIAL_EBAY_CURRENT_LISTING_IMAGE',referenceId:`EBAY_ITEM_${base.ebayItemId}`,sha256:'f'.repeat(64)}]}
 const grant={id:id(4),account_key:'account',owner_user_id:id(5),scope:'FULL',status:'ACTIVE',revoked_at:null,contract_version:'MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1',authority_digest:truth,allowed_actions:['SECONDARY_IMAGE_REPLACEMENT']}
 const a={id:id(2),status:'approved',mayel_approval_status:'APPROVED',mayel_output_role:'DETAIL',public_url:assets[0].publicUrl,output_sha256:assets[0].outputSha256,product_truth_digest:truth,source_image_set_digest:truth,qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE',checks:{productIdentityPreserved:true,colorPreserved:true,shapePreserved:true,partCountPreserved:true,visibleLogosPreserved:true,roleMatchesOutput:true,noUnsupportedClaims:true,noInventedAccessories:true,noUnauthorizedText:true}}}}
 const input={supabase:{},accountKey:'account',task:t,assets:[a],grant}
 assert.equal((await readDelegatedVisualAuthorityV1(input)).authorized,true)
 assert.equal((await readDelegatedVisualAuthorityV1({...input,assets:[{...a,status:'rejected'}]})).authorized,false)
 const tampered=structuredClone(t);tampered.visual_manifest.proposedOrderedImages.reverse();assert.equal((await readDelegatedVisualAuthorityV1({...input,task:tampered})).authorized,false)
 const stale={...t,current_image_set:current.slice(0,1)};assert.equal((await readDelegatedVisualAuthorityV1({...input,task:stale})).authorized,false)
})
test('ordered readback: append-only, wrong order and replaced image remaining never report SYNCED',()=>{
 const expected=build({...base,decisions:replacement()}).proposedOrderedImages.map(e=>e.publicUrl)
 for(const official of [[...current,assets[0].publicUrl],[...expected].reverse(),[...expected,current[1]],current])assert.equal(fullGalleryReadbackV1(expected,official,[current[1]]).synced,false)
 assert.equal(fullGalleryReadbackV1(expected,expected,[current[1]]).state,'SYNCED')
})
test('one intent one dispatch; ambiguous commit readback before any retry',async()=>{
 let dispatch=0,writes=0,reads=0,finish=null;const expected=build({...base,decisions:replacement()}).proposedOrderedImages.map(e=>e.publicUrl);let official=current
 const deps={authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async()=>{},markDispatch:async()=>{dispatch++},readback:async()=>{reads++;return {official:true,baseHash:truth,safetyPass:true,matchesIntent:fullGalleryReadbackV1(expected,official,[current[1]]).synced,reason:null,receipt:{}}},execute:async()=>{writes++;official=expected;throw Error('TIMEOUT')},finish:async(s)=>{finish=s}}
 await executeOutboxOperationV1({state:'APPROVED_FOR_EBAY_SYNC',dispatchCount:0,baseHash:truth,kind:'IMAGE_SYNC'},deps)
 await executeOutboxOperationV1({state:'UNKNOWN_COMMIT',dispatchCount:1,baseHash:truth,kind:'IMAGE_SYNC'},deps)
 assert.equal(dispatch,1);assert.equal(writes,1);assert.ok(reads>=2);assert.equal(finish,'SYNCED')
})
test('Mayel position decision persists its reason and never requires OWNER slot selection',()=>{
 const hero=decideMayelAssetPositionV1({assetId:id(2),role:'DETAIL',currentImages:current,manifest:{selectedHeroAssetId:id(2)}});assert.equal(hero.targetImagePosition,0);assert.equal(hero.visualIntent,'REPLACE_MAIN')
 const keepDecision={assetId:id(2),visualIntent:'REPLACE_SLOT',targetImagePosition:2,intentReason:'Detalle existente'}
 assert.deepEqual(decideMayelAssetPositionV1({assetId:id(2),role:'DETAIL',currentImages:current,manifest:{visualIntents:[keepDecision]}}),keepDecision)
 const addition=decideMayelAssetPositionV1({assetId:id(2),role:'DETAIL',currentImages:current,manifest:{}});assert.equal(addition.targetImagePosition,6);assert.ok(addition.intentReason)
})
test('actual SQL gallery validator agrees with TS and rejects incomplete/ambiguous/moved slots',async()=>{
 const db=new PGlite();try{
 const sql=readFileSync(new URL('../../supabase/migrations/20260910192811_mayel_full_gallery_mutation_control_v1.sql',import.meta.url),'utf8')
 const start=sql.indexOf('create function public.seller_os_full_gallery_shape_v1'),end=sql.indexOf('create function public.seller_os_full_gallery_authority_v1',start)
 await db.exec(sql.slice(start,end));const m=build({...base,decisions:combined()})
 const verify=async value=>(await db.query('select seller_os_full_gallery_shape_v1($1::jsonb,$2::jsonb) as pass',[JSON.stringify(value),JSON.stringify(current)])).rows[0].pass
 assert.equal(await verify(m),true)
 for(const mutate of [x=>x.galleryDecisions.pop(),x=>x.galleryDecisions[1].targetPosition=0,x=>x.galleryDecisions[0].beforeImage='https://wrong.test',x=>x.proposedOrderedImages.reverse(),x=>x.galleryDecisions[3].removalEvidence.noRequiredEvidenceLost=false]){const bad=structuredClone(m);mutate(bad);assert.equal(await verify(bad),false)}
 }finally{await db.close()}
})
test('migration: durable removal addendum, immutable history, private ACL and full-gallery grant gate',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create table seller_os_mayel_optimization_grants_v1(id uuid primary key,account_key text,owner_user_id uuid,scope text,status text,revoked_at timestamptz,contract_version text,allowed_actions jsonb);
 create table ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,ebay_item_id text,status text,selection_signal jsonb,visual_manifest jsonb,visual_manifest_id uuid,visual_manifest_digest text,product_truth_digest text,source_image_set_digest text,source_image_references jsonb,evidence_pack jsonb,current_image_set jsonb,updated_at timestamptz);
 create table ebay_mayel_visual_delegation_authorities_v1(marketplace_account_key text,owner_user_id uuid,status text,revoked_at timestamptz);
 create table ebay_listing_image_assets(id uuid,account_key text,mayel_visual_task_id uuid,status text,mayel_approval_status text,output_sha256 text,public_url text,source_image_set_digest text,product_truth_digest text,qa_result jsonb);
 create table ebay_mayel_visual_phase_b_executions_v1(marketplace_account_key text,visual_task_id uuid,visual_manifest_digest text,phase text);
 create table seller_os_ipad_outbox_v1(account_key text,kind text,state text,intent jsonb,dispatch_count integer);
 create table seller_os_mayel_content_outbox_v1(task_id uuid,account_key text,audit jsonb);
 create function seller_os_visual_current_product_truth_v1(t ebay_mayel_visual_tasks_v1) returns jsonb language sql as $$select null::jsonb$$;`)
 const sql=readFileSync(new URL('../../supabase/migrations/20260910192811_mayel_full_gallery_mutation_control_v1.sql',import.meta.url),'utf8')
 await db.exec(sql)
 await db.query('insert into auth.users values ($1)',[id(5)])
 await db.query(`insert into seller_os_mayel_optimization_grants_v1 values ($1,'account',$2,'FULL','ACTIVE',null,'MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1','["IMAGE_REORDER","SECONDARY_IMAGE_REPLACEMENT","IMAGE_ADDITION"]')`,[id(4),id(5)])
 const m=build({...base,decisions:combined()}),refs=[{url:current[3],sha256:'f'.repeat(64)},{url:current[4],sha256:'f'.repeat(64)}]
 await db.query('insert into ebay_mayel_visual_tasks_v1(id,marketplace_account_key,ebay_item_id,current_image_set,product_truth_digest,source_image_set_digest,source_image_references) values ($1,$2,$3,$4,$5,$5,$6)',[id(1),'account',base.ebayItemId,JSON.stringify(current),truth,JSON.stringify(refs)])
 await db.exec(`update ebay_mayel_visual_tasks_v1 set selection_signal='{"productTruthSupported":true}'`)
 const check=async()=>(await db.query('select seller_os_full_gallery_authority_v1(t,$1::jsonb,$2::uuid) pass from ebay_mayel_visual_tasks_v1 t where id=$3',[JSON.stringify(m),id(4),id(1)])).rows[0].pass
 assert.equal(await check(),false)
 await db.query(`insert into seller_os_mayel_gallery_removal_grants_v1(grant_id,account_key,owner_user_id,owner_instruction) values ($1,'account',$2,'{"authorization":"test fixture"}')`,[id(4),id(5)])
 assert.equal(await check(),true)
 await assert.rejects(db.exec(`update seller_os_mayel_gallery_removal_grants_v1 set owner_instruction='{}'`),/IMMUTABLE/)
 const acl=await db.query(`select has_table_privilege('anon','seller_os_mayel_gallery_removal_grants_v1','SELECT') anon,has_function_privilege('authenticated','seller_os_full_gallery_shape_v1(jsonb,jsonb)','EXECUTE') auth`)
 assert.equal(acl.rows[0].anon,false);assert.equal(acl.rows[0].auth,false)
 await db.exec('update seller_os_mayel_gallery_removal_grants_v1 set revoked_at=now()');assert.equal(await check(),false)
 const original=await db.query('select allowed_actions from seller_os_mayel_optimization_grants_v1');assert.equal(original.rows[0].allowed_actions.includes('IMAGE_REMOVAL'),false)
 }finally{await db.close()}
})
