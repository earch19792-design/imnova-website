import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readMayelListingSelectionV1 } from './mayel-listing-selection-v1.ts'
import { CURRENT_LIVE_SOURCE_AUTHORITY } from '../ebay/ebay-current-live-authority-v1.ts'
const ids=Array.from({length:23},(_,i)=>String(366650054490+i))
const stored={current_live_source_state:'CURRENT_UNAVAILABLE',current_live_last_error_code:'EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518',last_certified_live_item_ids:ids,last_certified_live_count:23,last_certified_live_observed_at:'2026-09-09T18:50:00Z',last_certified_live_fresh_until:'2026-09-09T19:10:00Z',last_certified_live_scope_id:'current-live:sha256:'+'a'.repeat(64),last_certified_live_source_authority:CURRENT_LIVE_SOURCE_AUTHORITY}
function db(state=stored, repeats=false){
 const calls=[]
 return {calls,from(table){const filters=[];let itemIds=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){itemIds=v;return q},order(){return q},limit(n){calls.push({table,filters,itemIds,limit:n});return q},maybeSingle(){return Promise.resolve({data:state,error:null})},then(resolve){const rows=itemIds.map(id=>({ebay_item_id:id,title:'Saved '+id,ebay_sku:'SKU'+id}));return Promise.resolve({data:repeats?[...rows,...rows.map(r=>({...r,ebay_sku:'CONFLICT'}))]:rows,error:null}).then(resolve)}};return q}}
}
test('Trading unavailable: stored listings remain selectable without asserting current LIVE or making eBay calls',async()=>{
 const supabase=db();const r=await readMayelListingSelectionV1({supabase,accountKey:'TEST_ACCOUNT',now:new Date('2026-09-09T20:00:00Z')})
 assert.equal(r.actionsAvailable,false);assert.equal(r.selectionState,'LAST_CERTIFIED');assert.equal(r.listings.length,20);assert.equal(r.nextCursor,ids[19]);assert.equal(r.listings[0].observedAt,stored.last_certified_live_observed_at.replace('00Z','00.000Z'))
 assert.equal(r.sourceFailureCode,stored.current_live_last_error_code);assert.equal(r.marketplaceWrites,0)
 assert.equal(supabase.calls.length,2);for(const c of supabase.calls)assert.deepEqual(c.filters,[['account_key','TEST_ACCOUNT']])
 assert.equal(supabase.calls[1].itemIds.length,20)
 const next=await readMayelListingSelectionV1({supabase,accountKey:'TEST_ACCOUNT',after:r.nextCursor,now:new Date('2026-09-09T20:00:00Z')})
 assert.equal(next.listings.length,3);assert.equal(next.nextCursor,null)
})
test('fresh authority enables normal actions; missing history never becomes an authoritative zero',async()=>{
 const fresh=await readMayelListingSelectionV1({supabase:db({...stored,current_live_source_state:'CURRENT_FRESH'}),accountKey:'A',now:new Date('2026-09-09T19:00:00Z')})
 assert.equal(fresh.actionsAvailable,true);assert.equal(fresh.selectionState,'CURRENT')
 const missing=await readMayelListingSelectionV1({supabase:db(null),accountKey:'A'})
 assert.deepEqual(missing.listings,[]);assert.equal(missing.authoritativeZero,false);assert.equal(missing.actionsAvailable,false)
})
test('duplicate registry representations preserve an agreed title without inventing a conflicting SKU',async()=>{
 const r=await readMayelListingSelectionV1({supabase:db(stored,true),accountKey:'A',now:new Date('2026-09-09T20:00:00Z')})
 assert.equal(r.listings[0].title,'Saved '+ids[0]);assert.equal(r.listings[0].sku,null)
})
test('selector route uses stored authority; historical browsing cannot invoke analysis and explains pending state',()=>{
 const route=readFileSync(new URL('../../app/api/admin/ebay/assistant/revenue-engine/route.ts',import.meta.url),'utf8').split('export async function GET')[1].split('export async function POST')[0]
 assert.match(route,/readMayelListingSelectionV1/);assert.doesNotMatch(route,/loadSellerOsAssistantMonitorSnapshotV1/)
 const ui=readFileSync(new URL('../../app/admin/ebay/mayel/revenue-engine.tsx',import.meta.url),'utf8')
 assert.match(ui,/actionsAvailable \? void analyze/);assert.match(ui,/Ver información guardada/);assert.match(ui,/Cargando tus listings/);assert.match(ui,/AbortSignal.timeout/)
})
