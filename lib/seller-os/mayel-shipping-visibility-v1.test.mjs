import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {projectMayelShippingVisibilityV1 as project} from './mayel-shipping-visibility-v1.ts'
import {readMayelShippingVisibilityV1 as read} from './mayel-shipping-visibility-read-v1.ts'
const now=Date.parse('2026-09-10T15:00:00Z'),iso=offset=>new Date(now+offset).toISOString(),id='366643555454'
const snapshot=()=>({observedAt:iso(0),accountKey:'account',worker:{worker_instance_id:'worker',extension_identity_match:true,physical_connection:'PROVEN_AVAILABLE',observed_at:iso(-1000),fresh_until:iso(299000)},lease:{worker_instance_id:'worker',shipping_capability_worker_id:'worker',shipping_capture_state:'UNAVAILABLE',shipping_capability_observed_at:iso(-1000),lease_expires_at:iso(140000),shipping_next_attempt_at:null},ebay:{current_live_source_state:'CURRENT_FRESH',last_certified_live_fresh_until:iso(100000)},itemIds:[id],jobs:[],evidence:[],economics:[]})
const quote=()=>({ebay_item_id:id,marketplace_account_key:'account',evidence_type:'LUNA_CURRENT_SHIPPING',freshness_status:'FRESH',evidence_id:'exact-quote',value_amount:6.99,captured_at:iso(-2000),fresh_until:iso(100000)})
test('UNAVAILABLE → AVAILABLE → REFRESHING → FRESH / economics requires exact current quote',()=>{
 const s=snapshot();let p=project(s,now)
 assert.equal(p.extension,'CONECTADA');assert.equal(p.capture,'LIMITADA TEMPORALMENTE');assert.equal(p.autoResume,'EN ESPERA');assert.equal(p.shipping,'ESPERANDO ACTUALIZACIÓN')
 s.lease.shipping_capture_state='AVAILABLE';p=project(s,now);assert.equal(p.capture,'DISPONIBLE');assert.equal(p.autoResume,'ACTIVO');assert.equal(p.rows[0].fresh,false)
 s.jobs=[{ebay_item_id:id,status:'REFRESHING',lease_expires_at:iso(10000)}];assert.equal(project(s,now).shipping,'ACTUALIZANDO')
 s.evidence=[quote()];p=project(s,now);assert.equal(p.shipping,'VIGENTE');assert.equal(p.economicsReevaluated,false)
 s.economics=[{ebay_item_id:id,input_evidence_ids:{LUNA_CURRENT_SHIPPING:'old-quote'},calculated_at:iso(-500)}];assert.equal(project(s,now).economicsReevaluated,false)
 s.economics[0].input_evidence_ids.LUNA_CURRENT_SHIPPING='exact-quote';assert.equal(project(s,now).economicsReevaluated,true)
 s.economics[0].calculated_at=iso(-3000);assert.equal(project(s,now).economicsReevaluated,false)
})
test('heartbeat never implies capture; stale/mismatched probe and backoff fail closed',()=>{
 const s=snapshot();s.lease.shipping_capture_state='AVAILABLE'
 s.lease.shipping_capability_observed_at=null;assert.equal(project(s,now).capture,'LIMITADA TEMPORALMENTE')
 s.lease.shipping_capability_observed_at=iso(-301000);assert.equal(project(s,now).autoResume,'EN ESPERA')
 s.lease.shipping_capability_observed_at=iso(-1000);s.lease.shipping_capability_worker_id='other';assert.equal(project(s,now).capture,'LIMITADA TEMPORALMENTE')
 s.lease.shipping_capability_worker_id='worker';s.lease.shipping_next_attempt_at=iso(60000);assert.equal(project(s,now).autoResume,'EN ESPERA')
 s.worker.fresh_until=iso(-1);assert.equal(project(s,now).capture,'NO CONECTADA')
 assert.equal(project(null,now).capture,'NO CONECTADA')
})
test('per listing fresh evidence expires; unknown amount/account never becomes current; attention explicit',()=>{
 const s=snapshot();s.evidence=[quote()]
 assert.equal(project(s,now+100001).shipping,'ESPERANDO ACTUALIZACIÓN')
 s.evidence[0].value_amount=null;assert.equal(project(s,now).rows[0].fresh,false)
 s.evidence[0]=quote();s.evidence[0].marketplace_account_key='other';assert.equal(project(s,now).rows[0].fresh,false)
 s.jobs=[{ebay_item_id:id,status:'FAILED_TERMINAL'}];assert.equal(project(s,now).shipping,'REQUIERE ATENCIÓN')
 s.itemIds.push('366650054490');assert.equal(project(s,now).rows[1].fresh,false)
})
test('bounded account-scoped durable reads only; partial failure remains unknown',async()=>{
 const calls=[];const db={from(table){const c={table,ops:[]};calls.push(c);const q={then(resolve){return Promise.resolve({data:null,error:{message:'offline'}}).then(resolve)}};for(const op of ['select','eq','in','limit','maybeSingle','order','abortSignal','retry'])q[op]=(...args)=>{c.ops.push([op,...args]);return q};return q},rpc(name,args){calls.push({name,args});return {abortSignal(){return this},retry(enabled){assert.equal(enabled,false);return Promise.resolve({data:[],error:null})}}}}
 const s=await read({supabase:db,accountKey:'account',itemIds:[id,id],now:new Date(now)})
 assert.deepEqual(s.itemIds,[id]);assert.equal(project(s,now).rows[0].fresh,false);assert.equal(calls.length,6)
 for(const c of calls.filter(c=>c.table)){assert.ok(c.ops.some(o=>o[0]==='eq'&&o[2]==='account'));assert.ok(c.ops.some(o=>o[0]==='limit'));assert.ok(c.ops.every(o=>o[0]!=='select'||!o[1].includes('*')))}
 assert.equal(calls.find(c=>c.name).name,'seller_os_latest_economic_evidence_v1')
 const n=calls.length;await assert.rejects(()=>read({supabase:db,accountKey:'account',itemIds:Array(21).fill(id)}),/SCOPE_INVALID/);assert.equal(calls.length,n)
})
test('NO_NEW_POLLER / NO_EXTRA_EBAY_TRAFFIC / friendly technical details isolated',()=>{
 const local=readFileSync('app/admin/ebay/mayel/local-first.tsx','utf8'),card=readFileSync('app/admin/ebay/mayel/shipping-status.tsx','utf8'),server=readFileSync('lib/seller-os/mayel-shipping-visibility-read-v1.ts','utf8')
 assert.equal((local.match(/setInterval\(/g)||[]).length,1);assert.match(local,/setInterval\(resume, 15000\)/)
 assert.match(local,/start === 0 \? visibleItems.current : undefined/)
 assert.doesNotMatch(card+server,/setInterval|setTimeout|heartbeat_worker|resolve_jobs|fetch\(|getEbayCommercialMonitorLiveReadonly/)
 for(const label of ['eBay','Extensión Luna','Captura Shipping','Shipping','Auto-reanudación','Última observación'])assert.ok(card.includes(label))
 assert.match(card,/<details[\s\S]*Ver detalles[\s\S]*JSON.stringify/)
 assert.match(card,/Shipping ✅ Vigente/);assert.match(card,/Shipping ⏳ Esperando actualización/)
})
