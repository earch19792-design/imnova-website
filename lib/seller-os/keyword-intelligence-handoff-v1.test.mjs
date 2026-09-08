import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { consumeListingPackageKeywordHandoffV1, decodeKeywordReadV1,
  readKeywordDecisionHandoffV1, keywordWireDigestV1 } from "./keyword-intelligence-handoff-v1.ts"

const binding={ACCOUNT_KEY:"acct",PRODUCT_ID:"p1",VARIANT_ID:"v1",CANDIDATE_KEY:"cand",OPPORTUNITY_ID:"00000000-0000-4000-8000-000000000001",PLAN_ID:"00000000-0000-4000-8000-000000000002"}
const authority="sha256:"+"a".repeat(64)
const decision={DECISION_VERSION:"PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1",INPUT_AUTHORITY_FINGERPRINT:authority,INPUT_FINGERPRINT:"sha256:"+createHash("sha256").update(`[${JSON.stringify("PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1")}, ${JSON.stringify(authority)}]`).digest("hex"),KEYWORD_DECISION_READY:true,BLOCKERS:[],PRIMARY_KEYWORD:"steel strainer",TERMS:[...[
  ["steel strainer","PRIMARY_KEYWORD"],["steel","CORE_QUALIFIERS"],["sieve","SEMANTIC_EXPANSIONS"],["strainer","SECONDARY_KEYWORDS"],["brand","REJECTED_TERMS"]].map(([TERM,CLASSIFICATION])=>({TERM,CLASSIFICATION}))]}
const digest=JSON.stringify(decision)
function wire(status="READY", d=decision, extra={}) { return {READ_CONTRACT_VERSION:"PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1",STATUS:status,BLOCKERS:[],BINDING:binding,VALIDATION:{CURRENT_INPUTS_MATCH:true,DECISION_DIGEST:"sha256:"+"0".repeat(64)},DECISION_SERIALIZED:JSON.stringify(d),...extra} }
test("V2.1 decision is accepted losslessly with all five classifications",()=>{
 const decoded=decodeKeywordReadV1({...wire(),VALIDATION:{CURRENT_INPUTS_MATCH:true,DECISION_DIGEST:"sha256:"+createHash('sha256').update(digest).digest('hex')}})
 const accepted=consumeListingPackageKeywordHandoffV1({...decoded,VALIDATION:{...decoded.VALIDATION,TRANSPORT_DIGEST:keywordWireDigestV1({BINDING:decoded.BINDING,DECISION:decoded.DECISION})}},binding)
 assert.equal(accepted.STATUS,"ACCEPTED"); assert.deepEqual(Object.keys(accepted.CLASSIFICATIONS),["PRIMARY_KEYWORD","CORE_QUALIFIERS","SEMANTIC_EXPANSIONS","SECONDARY_KEYWORDS","REJECTED_TERMS"])
})
test("unknown version, stale, cross-binding and UNPROVEN fail closed",()=>{
 for (const d of [{...decision,DECISION_VERSION:"V9"},{...decision,KEYWORD_DECISION_READY:false,BLOCKERS:["X"]}]) {
  const got=consumeListingPackageKeywordHandoffV1({...wire("READY",d),VALIDATION:{CURRENT_INPUTS_MATCH:false}},binding)
  assert.equal(got.STATUS,"BLOCKED")
 }
 const cross=consumeListingPackageKeywordHandoffV1({...wire(),BINDING:{...binding,VARIANT_ID:"other"}},binding)
 assert.equal(cross.STATUS,"BLOCKED")
})
test("reader uses existing bounded RPC and performs no recomputation",async()=>{
 let calls=0
 const supabase={rpc:async(name,args)=>{calls++;assert.equal(name,"read_product_research_keyword_handoff_v1");assert.equal(args.p_plan_id,binding.PLAN_ID);return {data:wire(),error:null}}}
 const budget={read:async x=>x.query(),close(){}}
 const got=await readKeywordDecisionHandoffV1({supabase,binding,budget})
 assert.equal(calls,1); assert.equal(got.DATABASE_WRITES,0); assert.equal(got.DECISION!==undefined,true)
})
