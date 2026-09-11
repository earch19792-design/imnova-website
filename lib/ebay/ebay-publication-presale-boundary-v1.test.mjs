// Include publication semantic regressions in the full Seller OS entrypoint suite.
import '../seller-os/publication-presale-boundary-v1.test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {certifyCurrentPrepublicationV1 as certify} from './ebay-current-prepublication-server-v1.ts'
import {validation} from '../seller-os/publication-presale-boundary-v1.test.mjs'
function dbFixture(mode){
 const {p,v}=validation();v.observedAt=new Date().toISOString();p.sanitized_result={publicationPreparationV1:p.preparation};p.actor_user_id='actor';p.updated_at='before';delete p.preparation
 let updates=0
 const db={from(table){assert.equal(table,'ebay_authorized_listing_publications');let update=null,filters=[];const q={select(){return q},eq(k,x){filters.push([k,x]);return q},is(){return q},limit(){return q},abortSignal(){return q},retry(v){assert.equal(v,false);return q},update(v){update=v;updates++;return q},then(resolve){if(update){assert.ok(filters.some(([k,x])=>k==='updated_at'&&x==='before'));if(mode!=='concurrent')Object.assign(p,update);return Promise.resolve({data:mode==='concurrent'?[]:[{id:p.id}],error:mode==='ambiguous'?{code:'TIMEOUT'}:null}).then(resolve)}return Promise.resolve({data:[structuredClone(p)],error:null}).then(resolve)}};return q}}
 return {db,p,v,updates:()=>updates}
}
test('CURRENT certificate persists with CAS and mandatory readback, never consumes publication key',async()=>{const x=dbFixture();const r=await certify({supabase:x.db,packageId:'pkg',accountKey:'acct',actor:'actor'},async()=>({prepublicationEvidence:x.v,feeStructure:{},economics:{}}));assert.equal(r.pass,true);assert.equal(r.durableReadbackPass,true);assert.equal(x.p.publication_idempotency_key,null);assert.equal(x.updates(),1)})
test('New failed validation replaces older successful proof, preserving negative CURRENT evidence',async()=>{const x=dbFixture();x.p.sanitized_result.publicationPreparationV1.prepublicationEvidenceV1=structuredClone(x.v);x.v.blockingErrors=['CURRENT_ERROR'];const r=await certify({supabase:x.db,packageId:'pkg',accountKey:'acct',actor:'actor'},async()=>({prepublicationEvidence:x.v,feeStructure:{},economics:{}}));assert.equal(r.pass,false);assert.equal(r.durableReadbackPass,true);assert.deepEqual(x.p.sanitized_result.publicationPreparationV1.prepublicationEvidenceV1.blockingErrors,['CURRENT_ERROR'])})
test('Ambiguous database receipt uses readback and never retries',async()=>{const x=dbFixture('ambiguous');const r=await certify({supabase:x.db,packageId:'pkg',accountKey:'acct',actor:'actor'},async()=>({prepublicationEvidence:x.v,feeStructure:{},economics:{}}));assert.equal(r.pass,true);assert.equal(x.updates(),1)})
test('Concurrent revision prevents persistence without blind retry',async()=>{const x=dbFixture('concurrent');await assert.rejects(certify({supabase:x.db,packageId:'pkg',accountKey:'acct',actor:'actor'},async()=>({prepublicationEvidence:x.v,feeStructure:{},economics:{}})),/CONCURRENT_REVISION/);assert.equal(x.updates(),1)})
