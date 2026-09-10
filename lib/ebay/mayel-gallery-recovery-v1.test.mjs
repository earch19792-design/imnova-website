import test from 'node:test'
import {registerHooks} from 'node:module'
registerHooks({resolve(specifier,context,nextResolve){return specifier==='server-only'?{url:'data:text/javascript,export{}',shortCircuit:true}:nextResolve(specifier,context)}})
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {galleryListingSkuV1} from './mayel-gallery-binding-v1.ts'
import {ebayOfficialImageSetDigestV1} from './ebay-mayel-visual-phase-b-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const item='366647547173',account='exact-account'
const row=source=>({account_key:account,ebay_item_id:item,ebay_sku:'OUR-SKU',listing_status:'active',raw_payload:{source}})
test('historical plus current rows bind one SKU; conflicts never choose an arbitrary row',()=>{
 const rows=[row('EBAY_TRADING_GET_ITEM_READONLY'),row('EBAY_TRADING_GET_MY_EBAY_SELLING')]
 assert.equal(galleryListingSkuV1(rows,item,account),'OUR-SKU')
 assert.equal(galleryListingSkuV1([...rows].reverse(),item,account),'OUR-SKU')
 assert.equal(galleryListingSkuV1([rows[0],{...rows[1],ebay_sku:'OTHER'}],item,account),null)
 assert.equal(galleryListingSkuV1([rows[1],rows[1]],item,account),null)
 assert.equal(galleryListingSkuV1(rows,item,'other-account'),null)
 assert.equal(galleryListingSkuV1(rows,'366111111111',account),null)
 assert.equal(galleryListingSkuV1([...rows,rows[0]],item,account),null)
})
test('durable missing-gallery recovery includes unfinished tasks, one account lease, backoff, immutable asset bases',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,ebay_item_id text,status text,created_at timestamptz default now(),selection_signal jsonb default '{}',current_image_set jsonb,visual_manifest_digest text,visual_manifest jsonb);
 `)
 await db.exec(readFileSync('supabase/migrations/20260910211159_mayel_missing_gallery_auto_recovery_v1.sql','utf8'))
 for(const n of [1,2,3])await db.query(`insert into ebay_mayel_visual_tasks_v1(id,marketplace_account_key,ebay_item_id,status,current_image_set,visual_manifest_digest,visual_manifest) values($1,$2,$3,$4,'["https://old.test/hero.jpg"]','OLD-IMMUTABLE-GENERATION','{"assets":["KEEP-QA"]}')`,[id(n),account,n===1?item:String(366600000000+n),n===3?'MAYEL_REVIEW_PENDING':'PROMPT_READY'])
 await db.query(`update ebay_mayel_visual_tasks_v1 set selection_signal='{"currentOfficialGallery":null}' where id=$1`,[id(3)])
 const rpc=async(name,args)=>{const names=Object.keys(args),r=await db.query(`select public.${name}(${names.map((_,i)=>'$'+(i+1)).join(',')}) as result`,Object.values(args));return r.rows[0].result}
 const due=async()=>db.query('select id from seller_os_pending_mayel_galleries_v1($1)',[account])
 assert.equal((await due()).rows.length,1)
 const a=await rpc('seller_os_claim_mayel_gallery_v1',{a:account,t:id(1)})
 assert.equal(a.itemId,item)
 assert.equal(await rpc('seller_os_claim_mayel_gallery_v1',{a:account,t:id(2)}),null,'follower cannot claim another binding')
 const images='ABCDEF'.split('').map(c=>`https://i.ebayimg.com/${c}.jpg`)
 const gallery={authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',itemId:item,ebaySku:'OUR-SKU',images,digest:ebayOfficialImageSetDigestV1(images),observedAt:new Date().toISOString()}
 const finish=(gal,next=null,reason=null,token=a.leaseToken)=>rpc('seller_os_finish_mayel_gallery_v1',{a:account,t:id(1),token,gal:gal?JSON.stringify(gal):null,next,reason})
 await assert.rejects(()=>finish({...gallery,itemId:'366111111111'}),/BINDING/)
 const done=await finish(gallery);assert.equal(done.status,'GALLERY_RECOVERED')
 const saved=(await db.query('select current_image_set,visual_manifest_digest,visual_manifest,selection_signal from ebay_mayel_visual_tasks_v1 where id=$1',[id(1)])).rows[0]
 assert.equal(saved.current_image_set.length,1);assert.equal(saved.visual_manifest_digest,'OLD-IMMUTABLE-GENERATION');assert.deepEqual(saved.visual_manifest,{assets:['KEEP-QA']})
 assert.deepEqual(saved.selection_signal.currentOfficialGallery.images,images)
 await assert.rejects(()=>finish(gallery),/LEASE_CHANGED/)
 const future=new Date(Date.now()+15*60_000).toISOString()
 assert.equal(await rpc('seller_os_defer_mayel_galleries_v1',{a:account,next:future}),2)
 assert.equal((await due()).rows.length,0)
 assert.equal(await rpc('seller_os_claim_mayel_gallery_v1',{a:account,t:id(2)}),null)
 assert.equal(await rpc('seller_os_defer_mayel_galleries_v1',{a:account,next:future}),0)
 // Advance fixture retry authority; production never manually clears a marker.
 await db.query(`update ebay_mayel_visual_tasks_v1 set selection_signal=jsonb_set(selection_signal,'{galleryRecovery,nextAttemptAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1`,[id(2)])
 const b=await rpc('seller_os_claim_mayel_gallery_v1',{a:account,t:id(2)})
 assert.ok(b.leaseToken)
 await rpc('seller_os_finish_mayel_gallery_v1',{a:account,t:id(2),token:b.leaseToken,gal:null,next:future,reason:'HTTP_429'})
 assert.equal(await rpc('seller_os_claim_mayel_gallery_v1',{a:account,t:id(2)}),null,'no immediate retry on 429')
 const privileges=(await db.query(`select has_function_privilege('anon','seller_os_claim_mayel_gallery_v1(text,uuid)','execute') as anon,has_function_privilege('authenticated','seller_os_finish_mayel_gallery_v1(text,uuid,uuid,jsonb,timestamptz,text)','execute') as authenticated`)).rows[0]
 assert.deepEqual(privileges,{anon:false,authenticated:false})
 }finally{await db.close()}
})
test('existing runtime discovers missing galleries before finished-manifest dependency; no new polling',()=>{
 const runtime=readFileSync('lib/ebay/ebay-mayel-visual-delegated-runtime-v1.ts','utf8')
 assert.match(runtime,/seller_os_pending_mayel_galleries_v1/);assert.match(runtime,/seller_os_defer_mayel_galleries_v1/)
 assert.match(runtime,/galleryWork.data\[0\].id/);assert.match(runtime,/listingWriteCount: 0, mediaWriteCount: 0/)
 const recovery=readFileSync('lib/ebay/mayel-gallery-recovery-server-v1.ts','utf8')
 assert.doesNotMatch(recovery,/setInterval|setTimeout|executeMayel|revise|publish/i)
 assert.match(recovery,/nextOutboxAttemptAtV1\(cachedTradingNextSafeProbeAtV1\(\)\)/)
 const ui=readFileSync('app/admin/mayel-visual-workstation.tsx','utf8')
 assert.match(ui,/Galería incompleta en Seller OS/);assert.match(ui,/Recuperación automática pendiente de eBay/)
 const reader=readFileSync('lib/ebay/ebay-mayel-visual-workstation-server-v1.ts','utf8')
 assert.match(reader,/currentImages: savedOfficialGalleryV1\(task.selection_signal\)\?\.images/)
 assert.match(reader,/const currentImages = savedOfficialGalleryV1\(input.task.selection_signal\)\?\.images/)
})
test('shared recovery makes zero reads for a follower and one read for the lease owner',async()=>{
 const {recoverMissingMayelGalleryV1}=await import('./mayel-gallery-recovery-server-v1.ts')
 let reads=0,finished=null,claimed=false
 const db={rpc:async(name,args)=> name==='seller_os_claim_mayel_gallery_v1'
   ? {data:claimed?{itemId:item,leaseToken:id(8)}:null,error:null}
   : (finished=args,{data:{status:'GALLERY_RECOVERED'},error:null})}
 const images='ABCDEF'.split('').map(c=>`https://i.ebayimg.com/${c}.jpg`)
 const read=async()=>{reads++;return {authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',itemId:item,ebaySku:'OUR-SKU',images,digest:ebayOfficialImageSetDigestV1(images),observedAt:new Date().toISOString()}}
 await recoverMissingMayelGalleryV1({supabase:db,accountKey:account,taskId:id(1)},read)
 assert.equal(reads,0);assert.equal(finished,null)
 claimed=true
 const out=await recoverMissingMayelGalleryV1({supabase:db,accountKey:account,taskId:id(1)},read)
 assert.equal(reads,1);assert.equal(out.status,'GALLERY_RECOVERED');assert.deepEqual(finished.p_gallery.images,images)
 const pending=await recoverMissingMayelGalleryV1({supabase:db,accountKey:account,taskId:id(1)},async()=>null)
 assert.equal(pending.status,'WAITING_FOR_DATA');assert.ok(Date.parse(finished.p_next)>Date.now());assert.equal(finished.p_gallery,null)
})
