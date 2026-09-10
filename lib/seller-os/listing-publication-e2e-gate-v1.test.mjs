import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {fixture,database} from './sell-one-like-this-v1.test.mjs'
import {prepareSellOneLikeThisV1} from './sell-one-like-this-v1.ts'
import {listingPipelineConsistencyV1} from './listing-pipeline-consistency-v1.ts'
const {readSellOneLikeThisV1}=await import('./sell-one-like-this-runtime-v1.ts')
import {listingPublicationE2eGateV1,publicationLedgerStateV1,PUBLICATION_STAGES_V1} from './listing-publication-e2e-gate-v1.ts'
import {canonicalEbayPackageSku} from '../ebay/ebay-sku.ts'
import {keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function prepared(){const f=fixture(),account='account:'+'a'.repeat(64);f.binding.ACCOUNT_KEY=account;f.reference.marketplace_account_key=account;f.keywordRead.BINDING.ACCOUNT_KEY=account;
 f.keywordRead.VALIDATION.TRANSPORT_DIGEST=digest({BINDING:f.keywordRead.BINDING,DECISION:f.keywordRead.DECISION});
 return {f,g:listingPipelineConsistencyV1(prepareSellOneLikeThisV1(f),{...f,accountKey:account,sku:'OUR-SKU'})}}
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8')
test('PACKAGE_CERTIFIED is independent of current commercial readiness and does not authorize publication',()=>{
 const {g}=prepared(),r=listingPublicationE2eGateV1(g)
 assert.equal(r.PACKAGE_CERTIFIED,true);assert.equal(r.PACKAGE_CONSISTENT,true);assert.equal(r.READY_TO_PUBLISH,false)
 assert.equal(r.PUBLICATION_AUTHORIZATION_GRANTED,false);assert.equal(r.PUBLICATION_IDEMPOTENCY_KEY_PRESENT,false)
 assert.ok(r.publicationPreparationKey);assert.equal(r.publicationWrites,0)
 assert.deepEqual(PUBLICATION_STAGES_V1,['DRAFT','PACKAGE_CERTIFIED','EBAY_PREVALIDATED','INVENTORY_READY','OFFER_READY','PUBLISH_REQUESTED','READBACK_REQUIRED','PUBLISHED_CONFIRMED'])
})
test('old publisher Preview cannot impersonate a newer package; stable key reuses existing intent',()=>{
 const {f,g}=prepared(),c=g.snapshot.content
 const sku=canonicalEbayPackageSku(f.packageId),fingerprint=f.binding.ACCOUNT_KEY.split(':').at(-1)
 const row={id:id(1),listing_package_id:f.packageId,marketplace_account_key:f.binding.ACCOUNT_KEY,account_fingerprint:fingerprint,sku,phase:'preview_ready',preview:{sku,accountFingerprint:fingerprint,
 listingPackageId:f.packageId,opportunityId:f.binding.OPPORTUNITY_ID,candidateKey:f.binding.CANDIDATE_KEY,
 inventoryItemPayload:{product:{title:c.title,description:c.description,imageUrls:c.imageUrls,aspects:Object.fromEntries(Object.entries(c.itemSpecifics).map(([k,v])=>[k,[v]]))}},
 offerPayload:{sku,marketplaceId:'EBAY_US',categoryId:c.categoryId,pricingSummary:{price:{currency:'USD',value:c.price}}}}}
 const a=listingPublicationE2eGateV1(g,row),b=listingPublicationE2eGateV1(g,structuredClone(row))
 assert.equal(a.existingPublicationGenerationMatches,true);assert.equal(a.publicationIdempotencyKey,`publish:${id(1)}`)
 assert.equal(a.publicationIdempotencyKey,b.publicationIdempotencyKey);assert.equal(a.publicationIdempotencyKeyDurablyClaimed,false)
 for(const mutate of [p=>p.inventoryItemPayload.product.title='OLD',p=>p.inventoryItemPayload.product.description='OLD',
 p=>p.inventoryItemPayload.product.imageUrls=['https://old.example/image.jpg'],p=>p.offerPayload.categoryId='OTHER']){
 const changed=structuredClone(row);mutate(changed.preview);const r=listingPublicationE2eGateV1(g,changed)
 assert.equal(r.PACKAGE_CONSISTENT,true);assert.equal(r.READY_TO_PUBLISH,false);assert.ok(r.blockingEvidence.includes('PUBLICATION_PREVIEW_GENERATION_MISMATCH'))
 }
 assert.equal(listingPublicationE2eGateV1(g,{...row,marketplace_account_key:'other'}).status,'REQUIRES_REVIEW')
 assert.ok(listingPublicationE2eGateV1(g,null,false).blockingEvidence.includes('PUBLICATION_EVIDENCE_UNAVAILABLE'))
 const published={...row,phase:'monitor_registered',listing_id:'123456789012',active_listing_id:id(2),manual_registration_id:id(3),verified_active_at:'2026-09-10T10:00:00Z',monitor_registered_at:'2026-09-10T10:00:01Z'}
 // Isolate dispatch eligibility after the material-evidence gate has passed.
 const ready={...g,READY_TO_PUBLISH:true,waiting:[]}
 assert.equal(listingPublicationE2eGateV1(ready,row).READY_TO_PUBLISH,true)
 for(const phase of ['monitor_registered','publish_in_flight','outcome_unknown','published_pending_verification','terminal_failure'])
 assert.equal(listingPublicationE2eGateV1(ready,{...published,phase}).READY_TO_PUBLISH,false)
 const old=structuredClone(published);old.preview.inventoryItemPayload.product.description='OLDER GENERATION'
 const oldState=listingPublicationE2eGateV1(g,old)
 assert.equal(oldState.existingLedgerState,'PUBLISHED_CONFIRMED');assert.notEqual(oldState.status,'PUBLISHED_CONFIRMED')
})
test('no false PUBLISHED_CONFIRMED: dispatch, response, durable IDs and official confirmation are different',()=>{
 assert.equal(publicationLedgerStateV1({phase:'publish_in_flight'}),'PUBLISH_REQUESTED')
 assert.equal(publicationLedgerStateV1({phase:'outcome_unknown'}),'UNKNOWN_COMMIT_STATE')
 assert.equal(publicationLedgerStateV1({phase:'published_pending_verification',listing_id:'123456789012'}),'READBACK_REQUIRED')
 const confirmed={phase:'monitor_registered',listing_id:'123456789012',active_listing_id:id(2),manual_registration_id:id(3),verified_active_at:'2026-09-10T10:00:00Z',monitor_registered_at:'2026-09-10T10:00:01Z'}
 assert.equal(publicationLedgerStateV1(confirmed),'PUBLISHED_CONFIRMED')
 for(const k of ['listing_id','active_listing_id','manual_registration_id','verified_active_at','monitor_registered_at']){
 const bad={...confirmed};delete bad[k];assert.equal(publicationLedgerStateV1(bad),'READBACK_REQUIRED')
 }
})
test('fresh Shipping automatically attaches on normal read and reevaluates readiness of the same package',async()=>{
 const {f}=prepared(),d=database(f),args={supabase:d.db,accountKey:f.binding.ACCOUNT_KEY,packageId:f.packageId,referenceItemId:f.reference.item_id,now:f.now}
 const before=await readSellOneLikeThisV1(args);d.fresh();const after=await readSellOneLikeThisV1(args)
 assert.equal(before.publicationGate.shippingStatus,'WAITING_FOR_DATA');assert.equal(after.publicationGate.shippingStatus,'FRESH')
 assert.equal(after.publicationGate.PACKAGE_HASH,before.publicationGate.PACKAGE_HASH)
 assert.equal(after.publicationGate.CODEX_RUNTIME_DEPENDENCY,false);assert.equal(after.publicationGate.READY_TO_PUBLISH,false)
 const route=source('../../app/api/admin/ebay/luna-shipping-capture/route.ts')
 assert.ok(route.indexOf('economicsContinuation = await resumeRadarFactoryCandidateAfterShippingV1')<route.lastIndexOf('continueLunaQuickPickPostShippingRuntimeV1'))
})
test('existing publisher enforces prevalidation, claim-before-send, official readback and GET-only unknown recovery',()=>{
 const route=source('../../app/api/admin/ebay/draft-only/route.ts'),start=route.indexOf('async function publishFinalPublication('),end=route.indexOf('async function rearmFinalPublication(',start),publish=route.slice(start,end)
 for(const guard of ['readCategoryProductIdentifierPreflight','verifyExactUnpublishedPublicationState','revalidateFinalPublicationDependencies','revalidateFinalPublicationSource','revalidateFinalPublicationDuplicateGuard'])
 assert.ok(publish.indexOf(guard)<publish.indexOf('claim_ebay_authorized_listing_publication'))
 assert.ok(publish.indexOf('claim_ebay_authorized_listing_publication')<publish.indexOf('publishEbayOfferOnce'))
 assert.match(publish,/claimedPublication.claim_token\) !== claimToken/)
 const recovery=route.slice(route.indexOf('async function reconcileFinalPublication('),route.indexOf('async function reconcileFinalPublication(')+4200)
 assert.match(recovery,/verifyEbayPublishedOffer/);assert.doesNotMatch(recovery,/publishEbayOfferOnce/)
 const complete=route.slice(route.indexOf('async function completeFinalPublicationMonitor('),start)
 for(const proof of ['verifyEbayDraftInventoryItem','verifyEbayPublishedOffer','registerManualEbayListing','exactActiveReadback'])assert.match(complete,new RegExp(proof))
 const rearm=route.slice(end,route.indexOf('async function reconcileFinalPublication('))
 assert.ok(rearm.indexOf('verifyEbayUnpublishedOffer')<rearm.indexOf('.rpc(rearmRpc'))
 assert.match(rearm,/revalidateFinalPublicationDependencies/)
 const read=source('./sell-one-like-this-runtime-v1.ts')
 assert.doesNotMatch(read,/setInterval|\.insert\(|\.update\(\{|publishEbayOfferOnce/)
 const ui=source('../../app/admin/ebay/mayel/reference-preview.tsx');assert.match(ui,/no autoriza una publicación/);assert.match(ui,/Estación visual/)
})
test('actual SQL claim is one-shot across replay, wrong actor, competing token and unknown commit',async()=>{
 const db=new PGlite(),base=source('../../supabase/migrations/20260720041000_create_ebay_authorized_listing_publication.sql')
 const extract=(s,name)=>s.slice(s.indexOf(`create or replace function public.${name}(`)).split('\n$$;')[0]+'\n$$;'
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create table ebay_draft_only_execution_ledger(id uuid primary key);create table ebay_draft_only_approvals(id uuid primary key);
 create table ebay_listing_packages(id uuid primary key);create table ebay_luna_opportunity_queue(id uuid primary key);
 create table ebay_active_listings(id uuid primary key);create table ebay_manual_listing_links(id uuid primary key);`)
 await db.exec(base.slice(0,base.indexOf('create or replace function public.prepare_')))
 // Semantic QA is a separate certified guard. This isolated ledger fixture
 // supplies its verdict; it does not replace the production implementation.
 await db.exec(`create table qa_fixture(pass boolean);insert into qa_fixture values(true);
 create function assert_ebay_authorized_publication_image_set_high_quality(uuid,uuid,text) returns void language plpgsql as $$begin if not (select pass from qa_fixture) then raise exception 'QA_REQUIRED';end if;end;$$;`)
 await db.exec(extract(source('../../supabase/migrations/20260721229000_require_high_quality_publish_visuals.sql'),'claim_ebay_authorized_listing_publication'))
 const gateMigration=source('../../supabase/migrations/20260724002000_support_v3_publication_claim_image_gate.sql')
 await db.exec(gateMigration.slice(gateMigration.indexOf('do $migration$'),gateMigration.indexOf('$migration$;')+'$migration$;'.length))
 await db.exec(extract(source('../../supabase/migrations/20260725004000_audit_single_rejected_publish_recovery.sql'),'fail_ebay_authorized_listing_publication'))
 await db.exec(extract(base,'record_ebay_authorized_listing_published'))
 for(const [table,n] of [['auth.users',1],['ebay_draft_only_execution_ledger',2],['ebay_draft_only_approvals',3],['ebay_listing_packages',4],['ebay_luna_opportunity_queue',5]])await db.query(`insert into ${table}(id) values($1)`,[id(n)])
 await db.query(`insert into ebay_authorized_listing_publications(id,draft_execution_id,draft_approval_id,listing_package_id,opportunity_id,actor_user_id,marketplace_account_key,target,account_fingerprint,offer_id,sku,preview_hash,preview)
 values($1,$2,$3,$4,$5,$6,$7,'PRODUCTION',$8,'offer1','IMNOVA-AAAAAAAAAAAAAAAA',$9,'{}')`,[id(6),id(2),id(3),id(4),id(5),id(1),'account:'+ 'a'.repeat(64),'a'.repeat(64),'b'.repeat(64)])
 const claim=(actor=id(1),key='publish:'+id(6),token=id(7))=>db.query('select * from claim_ebay_authorized_listing_publication($1,$2,$3,$4,$5,$6)',[id(6),actor,key,'b'.repeat(64),'PUBLICAR LISTING EN EBAY',token])
 await db.exec('update qa_fixture set pass=false');await assert.rejects(claim(),/QA_REQUIRED/);await db.exec('update qa_fixture set pass=true')
 await assert.rejects(claim(id(9)),/NOT_CLAIMABLE/)
 const first=(await claim()).rows[0],replay=(await claim(id(1),'publish:'+id(6),id(8))).rows[0]
 assert.equal(first.phase,'publish_in_flight');assert.equal(replay.claim_token,id(7));assert.equal(replay.publish_attempt_count,1)
 await assert.rejects(claim(id(1),'another-key'),/IDEMPOTENCY_MISMATCH/)
 await db.query("select fail_ebay_authorized_listing_publication($1,$2,$3,null,$4,true,'{}')",[id(6),id(1),id(7),'EBAY_PUBLISH_OUTCOME_UNKNOWN'])
 const unknown=(await claim()).rows[0];assert.equal(unknown.phase,'outcome_unknown');assert.equal(unknown.claim_token,null);assert.equal(unknown.publish_attempt_count,1)
 const recovered=(await db.query('select * from record_ebay_authorized_listing_published($1,$2,$3,200,true)',[id(6),id(1),'123456789012'])).rows[0]
 assert.equal(publicationLedgerStateV1(recovered),'READBACK_REQUIRED')
 await assert.rejects(db.query('select * from record_ebay_authorized_listing_published($1,$2,$3,200,true)',[id(6),id(1),'123456789013']),/RESULT_INVALID/)
 assert.equal((await db.query('select id from ebay_authorized_listing_publications')).rows.length,1)
 }finally{await db.close()}
})
