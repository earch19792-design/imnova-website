import test from "node:test"
import assert from "node:assert/strict"
import { runMayelVisualDelegatedRuntimeV1 } from "./ebay-mayel-visual-delegated-runtime-v1.ts"

function database() {
  const writes = []
  const task = { id: "task", ebay_item_id: "366643122092", visual_manifest_id: "manifest-id", visual_manifest_digest: "digest" }
  return { writes, task, client: {
    rpc: async (name,args) => { assert.equal(name,"seller_os_pending_mayel_visual_manifests_v1"); assert.equal(args.p_account_key,"account"); return {data:[task],error:null} },
    from(table) {
      let upserted=false
      const result = () => ({data: table === "ebay_mayel_visual_delegation_authorities_v1" ? {id:"authority",main_image_authority:true,owner_per_image_approval:false,owner_per_listing_visual_approval:false}
        : upserted ? {id:"receipt"} : [],error:null})
      const chain={then(resolve){return Promise.resolve(result()).then(resolve)}}
      for(const name of ["select","eq","in","is","limit","maybeSingle"]) chain[name]=()=>chain
      chain.upsert=value=>{upserted=true;writes.push(value);return chain}
      return chain
    },
  }}
}
test("blocked and unproven quotas preserve the durable queue with zero Trading probes or writes",async()=>{
  for(const gateState of ["BLOCKED","UNPROVEN"]) {
    const db=database();let executions=0
    const result=await runMayelVisualDelegatedRuntimeV1({supabase:db.client,accountKey:"account"},{
      quota:async()=>({gateState,nextSafeTradingProbeAt:"2026-09-10T07:00:00Z"}),
      execute:async()=>{executions++;throw Error("MUST_NOT_EXECUTE")},
    })
    assert.equal(result.status,"WAITING_FOR_EBAY");assert.equal(executions,0)
    assert.equal(result.proposalsPreserved,true);assert.equal(result.listingWriteCount,0);assert.equal(db.writes.length,0)
  }
})
test("existing runtime resumes the same manifest after the quota opens, through its certified executor",async()=>{
  const db=database();const executed=[]
  const dependencies={quota:async()=>({gateState:"BLOCKED"}),execute:async input=>{
    executed.push(input.taskId)
    return {status:"APPLIED_AND_OFFICIALLY_VERIFIED",tradingListingWriteCount:1,mediaApiWriteCount:1,execution:{phase:"APPLIED_AND_OFFICIALLY_VERIFIED"}}
  }}
  await runMayelVisualDelegatedRuntimeV1({supabase:db.client,accountKey:"account"},dependencies)
  dependencies.quota=async()=>({gateState:"OPEN"})
  const result=await runMayelVisualDelegatedRuntimeV1({supabase:db.client,accountKey:"account"},dependencies)
  assert.deepEqual(executed,["task"]);assert.equal(result.listingWriteCount,1)
  assert.equal(db.writes[0].regression_guard.ambiguousWriteRetryAllowed,false)
  assert.equal(db.writes[0].regression_guard.freshOfficialPreflight,true)
})
test("an unsettled execution stays blocked instead of retrying a possibly accepted write",async()=>{
  const db=database()
  const result=await runMayelVisualDelegatedRuntimeV1({supabase:db.client,accountKey:"account"},{quota:async()=>({gateState:"OPEN"}),
    execute:async()=>{throw Error("MAYEL_TRADING_VISUAL_PRIOR_EXECUTION_UNSETTLED")}})
  assert.equal(result.listingWriteCount,0);assert.equal(result.status,"DEGRADED")
  assert.equal(result.outcomes[0].failureClass,"MAYEL_TRADING_VISUAL_PRIOR_EXECUTION_UNSETTLED")
})
