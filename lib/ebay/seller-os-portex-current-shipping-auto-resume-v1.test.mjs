import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { before, after } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { createSellerOsBackgroundWorkloadControllerV1 } from "../seller-os/background-workload-optimization-v1.ts"
import { economicShippingFreshnessGenerationV1, reusableEconomicShippingEvidenceV1 } from "../seller-os/economic-shipping-refresh-reclaim-loop-v1.ts"
import { buildEconomicEvidenceV1, evidenceIsFreshV1, calculateLiveEconomicsV1 } from "../seller-os/economic-evidence-refresh-v1.ts"
const read = name => readFileSync(name, "utf8")
const migration = read("supabase/migrations/20260910121118_seller_os_portex_current_shipping_generation_resume_v1.sql")
const completedClaimReuse = read("supabase/migrations/20260912143241_current_luna_shipping_completed_claim_reuse.sql")
const account="portex-integration:account", worker="11111111-1111-4111-8111-111111111111", leader="22222222-2222-4222-8222-222222222222"
let db, seq=0
const uuid=()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,"0")}`
before(async()=>{
 db=new PGlite()
 await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema cron;
  create table cron.job(jobid bigint primary key, jobname text);
  create function cron.alter_job(job_id bigint, schedule text)
    returns void language sql as $$ select; $$;
  create function public.is_seller_os_service_role_request_v1()
    returns boolean language sql stable as $$ select true; $$;
  create function public.record_seller_os_browser_worker_heartbeat_v1(
    p_marketplace_account_key text,
    p_worker_family text,
    p_worker_instance_id text,
    p_extension_version text,
    p_extension_identity_match boolean,
    p_worker_state text,
    p_observed_at timestamptz,
    p_ttl_seconds integer default 300
  ) returns jsonb language sql as $$
    select jsonb_build_object('capabilityFresh', true,
      'observedAt', p_observed_at,
      'freshUntil', p_observed_at + make_interval(secs => p_ttl_seconds));
  $$;
  create table public.seller_os_post_runtime_scheduler_v1(
    lane text primary key,
    schedule text not null,
    updated_at timestamptz not null default clock_timestamp()
  );
  create table public.seller_os_economic_evidence_refresh_jobs_v1(
    job_id uuid primary key,
    idempotency_key text not null unique,
    marketplace_account_key text not null,
    marketplace_id text not null default 'EBAY_US',
    ebay_item_id text not null,
    evidence_type text not null,
    source_identity jsonb not null default '{}'::jsonb,
    status text not null,
    last_evidence_id text,
    failure_class text,
    next_retry_at timestamptz,
    attempt_count integer not null default 0,
    lease_owner text,
    lease_expires_at timestamptz,
    first_detected_at timestamptz not null default clock_timestamp(),
    last_detected_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
  );
  create table public.seller_os_luna_shipping_job_claims(
    account_key text not null,
    candidate_id text not null,
    snapshot_digest text not null,
    runtime_instance_id uuid not null,
    capture_session_id uuid not null unique,
    status text not null,
    claimed_at timestamptz not null,
    lease_expires_at timestamptz not null,
    completed_at timestamptz,
    updated_at timestamptz not null,
    primary key(account_key,candidate_id)
  );
`)
 await db.exec(read("supabase/migrations/20260908142459_seller_os_background_workload_optimization_v1_phase_a.sql"))
 await db.exec(read("supabase/migrations/20260908155651_seller_os_economic_shipping_refresh_reclaim_loop_fix_v1.sql"))
 await db.exec(`alter table seller_os_economic_evidence_refresh_jobs_v1 add column shipping_legacy_recovery_generation text;
 create table seller_os_economic_shipping_legacy_recoveries_v1(job_id uuid primary key,marketplace_account_key text,recovery_generation text,status text,shipping_freshness_generation text,recovery_attempt_count integer);
 create table ebay_active_listings(account_key text,ebay_item_id text,listing_status text);
 create table seller_os_live_economic_evidence_v1(evidence_id text primary key,fresh_until timestamptz);
 `)
 await db.exec(migration)
 await db.exec(completedClaimReuse)
 const original=read("supabase/migrations/20260906095925_seller_os_economic_evidence_refresh_v1.sql")
 const start=original.indexOf("create or replace function public.finish_seller_os_economic_refresh_job_v1(")
 await db.exec(original.slice(start,original.indexOf("\n$$;",start)+4))
 await heartbeat()
})

test("STALE_COMPLETED_QUOTE_REUSES_EXACT_JOB_ROW_WITH_SINGLE_FLIGHT_PASS",async()=>{
 const validAccount=`portex-integration:${"a".repeat(64)}`
 const candidate=`sha256:${"c".repeat(64)}`,snapshot=`sha256:${"d".repeat(64)}`
 const first=uuid(),second=uuid(),concurrent=uuid()
 const claim=async session=>(await db.query(`select * from claim_seller_os_luna_shipping_job_v1($1,$2,$3,$4::uuid,$5::uuid)`,[validAccount,candidate,snapshot,worker,session])).rows[0]
 assert.equal((await claim(first)).claimed,true)
 await db.query(`update seller_os_luna_shipping_job_claims set status='COMPLETED',completed_at=clock_timestamp() where account_key=$1 and candidate_id=$2 and snapshot_digest=$3 and capture_session_id=$4::uuid`,[validAccount,candidate,snapshot,first])
 assert.equal((await claim(second)).claimed,true)
 assert.equal((await claim(concurrent)).claimed,false)
 const count=(await db.query(`select count(*)::int count from seller_os_luna_shipping_job_claims where account_key=$1 and candidate_id=$2`,[validAccount,candidate])).rows[0].count
 assert.equal(count,1)
})
after(async()=>db.close())
async function heartbeat(){await db.query(`select record_seller_os_browser_worker_heartbeat_v2($1,'LUNA_SHIPPING',$2,'1.0.57',true,'IDLE',clock_timestamp(),$3::uuid,300,150)`,[account,worker,leader])}
async function gate(action,state=null,options={}){
 return (await db.query(`select gate_seller_os_shipping_capture_v1($1,$2,$3::uuid,$4,$5,clock_timestamp(),$6::timestamptz) result`,[account,options.worker??worker,leader,action,state,options.retryAfter??null])).rows[0].result
}
async function fixture(){
 const job=uuid(), item=String(366643555454+seq), historic=`historical:${job}`
 const oldgen=`economic-shipping-refresh-v1:sha256:${"a".repeat(64)}`
 await db.query(`insert into seller_os_economic_evidence_refresh_jobs_v1(job_id,idempotency_key,marketplace_account_key,ebay_item_id,evidence_type,status,attempt_count,shipping_legacy_recovery_generation,shipping_freshness_generation,source_identity) values($1,$2,$3,$4,'LUNA_CURRENT_SHIPPING','STALE',21,$5,$6,$7::jsonb)`,[job,`intent:${job}`,account,item,historic,oldgen,JSON.stringify({lunaProductId:"9220840456416",lunaVariantId:"48809652158688",sourceSku:"SKU-5454",linkageId:"exact-linkage"})])
 await db.query(`insert into seller_os_economic_shipping_legacy_recoveries_v1 values($1,$2,$3,'COMPLETED',$4,1)`,[job,account,historic,oldgen])
 await db.query(`insert into ebay_active_listings values($1,$2,'active')`,[account,item])
 const gen=economicShippingFreshnessGenerationV1({jobId:job,accountKey:account,ebayItemId:item,lunaProductId:"9220840456416",lunaVariantId:"48809652158688",sourceSku:"SKU-5454",requiredEvidenceAfter:"2026-09-09T04:51:48Z"})
 return {job,item,historic,oldgen,gen,candidate:`sha256:${seq.toString(16).padStart(64,"0")}`}
}
async function admit(f,overrides={}){
 return (await db.query(`select admit_seller_os_economic_shipping_refresh_v1($1,$2,$3,$4,$5,$6,$7,false,900,5) result`,[f.job,overrides.worker??worker,f.candidate,`sha256:${"b".repeat(64)}`,uuid(),overrides.gen??f.gen,"2026-09-09T04:51:48Z"])).rows[0].result
}
async function discover(){return (await db.query(`select discover_seller_os_current_shipping_refresh_v1($1) result`,[account])).rows[0].result}
async function history(f){return (await db.query(`select recovery_generation,status,shipping_freshness_generation,recovery_attempt_count from seller_os_economic_shipping_legacy_recoveries_v1 where job_id=$1`,[f.job])).rows[0]}
async function expireWindow(){await db.query(`update seller_os_browser_workload_leases_v1 set shipping_next_attempt_at=clock_timestamp()-interval '1 second' where marketplace_account_key=$1`,[account])}

test("HISTORICAL_RECOVERY_MARKER_PRESERVED_PASS / STALE_QUOTE_CURRENT_REFRESH_DISCOVERABLE_PASS",async()=>{
 const f=await fixture(), before=await history(f)
 assert.ok((await discover()).some(j=>j.job_id===f.job))
 assert.equal((await gate("ACQUIRE")).reasonCode,"WAITING_FOR_CAPTURE_CAPABILITY")
 assert.equal((await admit(f)).admitted,false)
 await gate("CAPABILITY","AVAILABLE")
 assert.equal((await gate("ACQUIRE")).allowed,true)
 const receipt=await admit(f)
 assert.equal(receipt.admitted,true)
 assert.equal(receipt.attemptOrdinal,1)
 const row=(await db.query(`select attempt_count,shipping_refresh_attempt_count,shipping_legacy_recovery_generation,shipping_execution_authority from seller_os_economic_evidence_refresh_jobs_v1 where job_id=$1`,[f.job])).rows[0]
 assert.equal(row.attempt_count,22);assert.equal(row.shipping_refresh_attempt_count,1)
 assert.equal(row.shipping_legacy_recovery_generation,f.historic)
 assert.equal(row.shipping_execution_authority,"CURRENT_OPERATIONAL_V1")
 assert.deepEqual(await history(f),before)
 assert.equal((await admit(f)).admitted,false)
 assert.equal((await admit(f,{worker:leader})).admitted,false)
 assert.equal((await gate("ACQUIRE")).allowed,false)
 assert.equal((await gate("ACQUIRE",null,{worker:leader})).reasonCode,"FOLLOWER_SUPPRESSED")
 assert.deepEqual((await db.query(`select job_id from claim_seller_os_economic_refresh_jobs_v1($1,$2,null,1,180)`,[account,worker])).rows,[])
 // Normal completion cannot route back into historical recovery.
 assert.equal((await db.query(`select finish_seller_os_economic_refresh_job_v1($1,$2,'FRESH','fresh-quote',null,null) ok`,[f.job,worker])).rows[0].ok,true)
 assert.deepEqual(await history(f),before)
 // Six hours later the completed operational job is discoverable without the
 // historical-cohort reconciler modifying its incident row.
 await db.query(`insert into seller_os_live_economic_evidence_v1 values('fresh-quote',clock_timestamp()-interval '1 second')`)
 assert.ok((await discover()).some(j=>j.job_id===f.job))
 await db.query(`update seller_os_live_economic_evidence_v1 set fresh_until=clock_timestamp()+interval '6 hours' where evidence_id='fresh-quote'`)
 assert.equal((await discover()).some(j=>j.job_id===f.job),false)
})

test("429_BACKOFF_THEN_REDISCOVER_PASS / NO_DUPLICATE_RECOVERY_PASS",async()=>{
 await expireWindow(); await gate("CAPABILITY","AVAILABLE")
 const f=await fixture(),before=await history(f)
 assert.equal((await admit(f)).admitted,true)
 await db.query(`update seller_os_economic_evidence_refresh_jobs_v1 set shipping_refresh_attempt_count=6 where job_id=$1`,[f.job])
 const failure=(await db.query(`select fail_seller_os_economic_shipping_refresh_v1($1,$2,$3,'LUNA_CART_ADD_HTTP_429',true,5) result`,[f.job,worker,f.gen])).rows[0].result
 assert.equal(failure.status,"FAILED_RETRYABLE");assert.equal(failure.deadLetter,false)
 const retry=(await db.query(`select next_retry_at>clock_timestamp()+interval '14 minutes' delayed from seller_os_economic_evidence_refresh_jobs_v1 where job_id=$1`,[f.job])).rows[0]
 assert.equal(retry.delayed,true)
 assert.equal((await discover()).some(j=>j.job_id===f.job),false)
 const retryAfter=new Date(Date.now()+3600000).toISOString()
 const closed=await gate("BACKOFF",null,{retryAfter})
 assert.ok(Date.parse(closed.nextAttemptAt)>=Date.parse(retryAfter))
 // A heartbeat or repeated AVAILABLE transition cannot clear the Retry-After.
 await heartbeat();await gate("CAPABILITY","AVAILABLE")
 assert.equal((await gate("ACQUIRE")).reasonCode,"WAIT_RETRY_WINDOW")
 assert.equal((await admit(f)).admitted,false)
 await expireWindow()
 await db.query(`update seller_os_economic_evidence_refresh_jobs_v1 set next_retry_at=clock_timestamp()-interval '1 second' where job_id=$1`,[f.job])
 assert.ok((await discover()).some(j=>j.job_id===f.job))
 assert.equal((await gate("ACQUIRE")).allowed,true)
 assert.equal((await admit(f)).admitted,true)
 assert.equal((await admit(f)).admitted,false)
 assert.deepEqual(await history(f),before)
})

test("CAPTURE_UNAVAILABLE_15_MINUTES_ZERO_CART_CALLS_PASS / ONE_TRANSITION_ONE_REFRESH_PASS",async()=>{
 // SQL gate + actual Phase A controller, simulated 15-minute browser lifecycle.
 await gate("CAPABILITY","UNAVAILABLE");await expireWindow()
 let now=0, claims=0,cartCalls=0,discoveryCalls=0
 const controller=createSellerOsBackgroundWorkloadControllerV1({producer:"LUNA_SHIPPING",now:()=>now,random:()=>0.5})
 controller.setLeaderState("BROWSER_LEADER")
 for(now=0;now<900000;now+=1000){
   if(now%60000===0)await heartbeat()
   const permit=await gate("ACQUIRE")
   if(permit.allowed){discoveryCalls++;claims++;cartCalls++}
 }
 assert.equal(discoveryCalls,0);assert.equal(claims,0);assert.equal(cartCalls,0)
 await gate("CAPABILITY","AVAILABLE")
 for(let duplicate=0;duplicate<20;duplicate++){
   await gate("CAPABILITY","AVAILABLE")
   const permit=await gate("ACQUIRE")
   if(permit.allowed){claims++;cartCalls++}
 }
 assert.equal(claims,1);assert.equal(cartCalls,1)
 // First empty window, not only the final exponential tier, is fifteen minutes.
 controller.recordEmptyPoll()
 let empties=1
 for(now=901000;now<1800000;now+=1000){
   const permit=controller.acquireClaimPermit()
   if(permit.allowed){empties++;controller.recordEmptyPoll();controller.releaseClaimPermit()}
 }
 assert.equal(empties,1)
})

test("ECONOMICS_AUTO_REEVALUATE_AFTER_FRESH_SHIPPING_PASS / NO_CODEX_RUNTIME_DEPENDENCY_PASS",()=>{
 const now=Date.parse("2026-09-10T13:00:00Z")
 const evidence=buildEconomicEvidenceV1({accountKey:account,itemId:"366643555454",evidenceType:"LUNA_CURRENT_SHIPPING",value:6.99,sourceAuthority:"LUNA_PORTEX",sourceEntityId:"fixture-only",capturedAt:new Date(now).toISOString(),status:"FRESH"})
 assert.equal(evidenceIsFreshV1(evidence,now),true)
 assert.equal(evidenceIsFreshV1(evidence,now+21600001),false)
 assert.equal(reusableEconomicShippingEvidenceV1({evidence:{observedAt:evidence.captured_at,maximumAgeSeconds:21600},requiredEvidenceAfter:"2026-09-09T04:51:48Z",bindingMatches:true,now}),true)
 const before=calculateLiveEconomicsV1({accountKey:account,itemId:"366643555454",calculatedAt:new Date(now).toISOString(),evidence:{}})
 const after=calculateLiveEconomicsV1({accountKey:account,itemId:"366643555454",calculatedAt:new Date(now).toISOString(),evidence:{LUNA_CURRENT_SHIPPING:evidence}})
 assert.equal(before.missing_economic_inputs.includes("LUNA_CURRENT_SHIPPING"),true)
 assert.equal(after.missing_economic_inputs.includes("LUNA_CURRENT_SHIPPING"),false)
 assert.equal(after.luna_shipping,6.99)
 assert.equal(after.expected_profit,null) // Independent fee guards remain closed.
 const server=read("lib/ebay/ebay-luna-chrome-shipping-capture-server-v1.ts")
 assert.match(server,/shipping_execution_authority ===[\s\S]*?CURRENT_OPERATIONAL_V1[\s\S]*?null : text/)
 assert.match(server,/seller_os_live_economic_evidence_v1[\s\S]*?finish_seller_os_economic_refresh_job_v1/)
 const route=read("app/api/admin/ebay/luna-shipping-capture/route.ts")
 const hb=route.slice(route.indexOf('body.action === "heartbeat_worker_capability"'),route.indexOf('body.action === "report_economic_shipping_failure"'))
 assert.doesNotMatch(hb,/acquireLunaChromeShippingJobsV1|discover_seller_os_current_shipping_refresh_v1/)
 assert.match(route,/gate_seller_os_shipping_capture_v1[\s\S]*?maximumJobs: 1/)
 assert.doesNotMatch(migration,/delete from|update public\.seller_os_economic_shipping_legacy_recoveries_v1|select \*/i)
})

test("CAPABILITY_PROBE_READS_EXISTING_DOM_WITH_ZERO_NETWORK_OR_CART_PASS",async()=>{
 const {runInNewContext}=await import("node:vm")
 const {webcrypto}=await import("node:crypto")
 const manifest=JSON.parse(read("tools/browser-extensions/luna-shipping-capture/manifest.json"))
 let connect,portMessage,tabUpdated,ready=false,network=0,navigations=0
 const posted=[]
 const binding={canonicalDestinationFingerprint:`sha256:${"a".repeat(64)}`,
  fingerprintVersion:"LUNA_CANONICAL_DESTINATION_PROFILE_SHA256_V1",countryClass:"US",
  authorityClass:"OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
  evidenceClass:"SERVER_CANONICAL_DESTINATION_PROFILE_DIGEST",validationMethod:"EXACT_PROFILE_DIGEST_MATCH",
  boundAt:"2026-09-08T18:00:00.000Z"}
 const chrome={runtime:{id:"mhpkojahbbfdgodeaecggpjaplllgclk",lastError:null,getManifest:()=>manifest,
  onInstalled:{addListener(){}},onMessageExternal:{addListener(){}},
  onConnectExternal:{addListener(fn){connect=fn}},onMessage:{addListener(){}}},
  tabs:{create:async()=>{navigations++;return{id:7}},update:async()=>{navigations++},
   query(_query,cb){cb([{id:7}])},sendMessage(_id,msg,_options,cb){
    if(msg.type==="SELLER_OS_LUNA_CHECKOUT_OBSERVER_HELLO_V1") {
     cb({contract:"LUNA_CHECKOUT_OBSERVER_HANDSHAKE_V1",nonce:msg.nonce,version:"1.0.57",loaded:true});return
    }
    assert.equal(msg.type,"SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1")
    cb({contractVersion:"LUNA_BIND_ELIGIBILITY_PROBE_V1",checkoutHostClassification:"SHOP_PAY_CHECKOUT_HOST",
     eligible:ready,checkoutPageDetected:ready,shipToMarker:ready,shippingMarker:ready,
     subtotalMarker:ready,totalMarker:ready,payNowMarker:ready})},
   onRemoved:{addListener(){}},onUpdated:{addListener(fn){tabUpdated=fn}}},
  storage:{local:{get(_key,cb){cb({sellerOsLunaCanonicalDestinationBindingV1:binding})},set(_v,cb){cb()}}},
  permissions:{contains(_q,cb){cb(true)}},
  scripting:{executeScript:async()=>{throw Error("UNNECESSARY_INJECTION")}},
  webNavigation:{getFrame(_q,cb){cb({parentFrameId:-1,documentId:"current",url:"https://shop.app/checkouts/existing"})},onCommitted:{addListener(){}},onCompleted:{addListener(){}}}}
 runInNewContext(read("tools/browser-extensions/luna-shipping-capture/background.js"),
  {chrome,crypto:webcrypto,URL,TextDecoder,TextEncoder,Uint8Array,atob,btoa,setTimeout,clearTimeout,
   fetch:()=>{network++;throw Error("NETWORK_FORBIDDEN")}})
 connect({name:"SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",sender:{url:"https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture"},disconnect(){},postMessage(v){posted.push(v)},onMessage:{addListener(fn){portMessage=fn}},onDisconnect:{addListener(){}}})
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0))
 portMessage({type:"SELLER_OS_GET_LUNA_CAPTURE_CAPABILITY_V1"});await settle()
 assert.equal(posted.at(-1).probe.captureAvailable,false)
 // The service's existing DOM becomes usable: Chrome emits one lifecycle event.
 ready=true;tabUpdated(7,{status:"complete"},{url:"https://shop.app/checkouts/existing"});await settle()
 assert.equal(posted.at(-1).probe.captureAvailable,true)
 assert.equal(network,0);assert.equal(navigations,0)
 assert.equal(posted.filter(p=>p.type==="LUNA_SHIPPING_JOB_RESULT").length,0)
})

test("RETRY_AFTER_AUTHORITY_PRESERVED_PASS",async()=>{
 const {shippingRetryAfterAtV1}=await import("../seller-os/economic-shipping-refresh-reclaim-loop-v1.ts")
 const now=Date.parse("2026-09-10T13:00:00Z")
 assert.equal(shippingRetryAfterAtV1("3600",now),"2026-09-10T14:00:00.000Z")
 assert.equal(shippingRetryAfterAtV1("Thu, 10 Sep 2026 14:00:00 GMT",now),"2026-09-10T14:00:00.000Z")
 assert.equal(shippingRetryAfterAtV1(null,now),null)
 assert.equal(shippingRetryAfterAtV1(false,now),null)
 assert.equal(shippingRetryAfterAtV1("invalid",now),null)
})
