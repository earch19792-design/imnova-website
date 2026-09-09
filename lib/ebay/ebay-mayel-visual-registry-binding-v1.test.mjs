import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { resolveMayelVisualRegistryBindingV1 } from "./ebay-mayel-visual-registry-binding-v1.ts"

const scope={accountKey:"account",taskId:"task",itemId:"366582671136",currentRegistryId:null}
function db(rows,{race=null}={}) {
  const calls=[]
  return {calls,from(table){let update=false
    const chain={then(resolve){return Promise.resolve({error:null,data:table==="ebay_active_listings"?rows:update&&race?null:{active_listing_id:race??rows[0]?.id}}).then(resolve)}}
    for(const name of ["select","eq","is","limit","maybeSingle"])chain[name]=(...args)=>{calls.push([table,name,...args]);return chain}
    chain.update=value=>{update=true;calls.push([table,"update",value]);return chain};return chain
  }}
}
test("saved visual task acquires one exact registry binding without eBay or a publication package",async()=>{
  const supabase=db([{id:"registry",ebay_sku:"SKU"}])
  assert.equal(await resolveMayelVisualRegistryBindingV1({...scope,supabase}),"registry")
  assert.ok(supabase.calls.some(c=>c[1]==="eq"&&c[2]==="account_key"&&c[3]==="account"))
  assert.ok(supabase.calls.some(c=>c[1]==="is"&&c[2]==="active_listing_id"&&c[3]===null))
  assert.equal(supabase.calls.filter(c=>c[1]==="update").length,1)
  const replay=db([])
  assert.equal(await resolveMayelVisualRegistryBindingV1({...scope,supabase:replay,currentRegistryId:"registry"}),"registry")
  assert.equal(replay.calls.length,0)
})
test("ambiguous, missing and conflicting registry bindings stay closed",async()=>{
  for(const rows of [[],[{id:"one",ebay_sku:"SKU"},{id:"two",ebay_sku:"SKU"}],[{id:"one",ebay_sku:null}]]) {
    const supabase=db(rows);await assert.rejects(resolveMayelVisualRegistryBindingV1({...scope,supabase}),/EXACT_ACTIVE_REGISTRY_REQUIRED/)
    assert.equal(supabase.calls.some(c=>c[1]==="update"),false)
  }
  await assert.rejects(resolveMayelVisualRegistryBindingV1({...scope,supabase:db([{id:"registry",ebay_sku:"SKU"}],{race:"other"})}),/BIND_CONFLICT/)
  assert.equal(await resolveMayelVisualRegistryBindingV1({...scope,supabase:db([{id:"registry",ebay_sku:"SKU"}],{race:"registry"})}),"registry")
})
test("missing publication package is allowed only for delegated Trading image executions",async()=>{
  const database=new PGlite()
  try {
    await database.exec(`create table public.ebay_mayel_visual_phase_b_executions_v1(
      listing_package_id text not null, management_model text not null, delegation_authority_id text,
      active_listing_id text not null, visual_task_id text not null, visual_manifest_id text not null);`)
    await database.exec(readFileSync(new URL("../../supabase/migrations/20260909204853_mayel_existing_listing_image_execution_binding_v1.sql",import.meta.url),"utf8"))
    await database.query("insert into public.ebay_mayel_visual_phase_b_executions_v1 values(null,'TRADING_MANAGED','authority','active','task','manifest')")
    await assert.rejects(database.query("insert into public.ebay_mayel_visual_phase_b_executions_v1 values(null,'INVENTORY_API_MANAGED','authority','active','task','manifest')"),/package_scope/)
    await assert.rejects(database.query("insert into public.ebay_mayel_visual_phase_b_executions_v1 values(null,'TRADING_MANAGED',null,'active','task','manifest')"),/package_scope/)
    await database.query("insert into public.ebay_mayel_visual_phase_b_executions_v1 values('package','INVENTORY_API_MANAGED',null,'active','task','manifest')")
  }finally{await database.close()}
})
