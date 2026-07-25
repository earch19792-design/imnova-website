import { createHash,randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { requestReferenceGuidedProductGeneration } from
  "../lib/ebay/ebay-listing-image-factory.ts"
import { persistReferenceGuidedCanaryPng,REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET } from
  "../lib/ebay/reference-guided-canary-persistence.ts"

const ATTEMPT_ID="f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID="3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const PLAN_ID="7ac6e2f4-d1f7-44f8-a026-064ca474904b"
const PLAN_HASH="9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3"
const AMENDMENT_ID="322226f9-31d0-4881-987d-1040d56a650a"
const AMENDMENT_HASH="cfa89ed6ceebc0f6899af917d9cc114638d4b4840e46f0dd37990f0f291c049a"
const CONTRACT_HASH="2f24eb0993cd71a076e1229fcf54cbdf629cecc85368157cf4247c8bc0909347"
const PROMPT_HASH="ac8c72b757de68715bd7517460f5b69365305202b7a2a297e2636b128aecdb65"
const MAIN_SHA256="3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SIDE_SHA256="f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21"
const FEATURE_FLAG="OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED"

const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const apiKey=process.env.OPENAI_API_KEY?.trim()
let projectRef=""
try{projectRef=new URL(url??"").hostname.split(".")[0]??""}catch{}
if(!url||!key||projectRef!=="vsfthqydfrdzulldbfbe")
  throw new Error("EXTRAORDINARY_POSITION_6_STAGING_SERVICE_ROLE_REQUIRED")
if(!apiKey||process.env[FEATURE_FLAG]!=="true"||
  process.env.OPENAI_IMAGE_MODEL?.trim()!=="gpt-image-2"||
  process.env.CANARY_EXECUTION_ENVIRONMENT!=="preview")
  throw new Error("EXTRAORDINARY_POSITION_6_PREVIEW_CONFIGURATION_INVALID")

const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const sha256=(value)=>createHash("sha256").update(value).digest("hex")
const rows=(value)=>Array.isArray(value)?value:[]

async function loadState(){
  const [attempt,revision,plan,positions,jobs,authorizations,events,selection,p4Approval]=
    await Promise.all([
      supabase.from("ebay_reference_guided_generation_attempts")
        .select("id,revision_id,status,composition_manifest_hash,provider_calls,max_provider_calls,retry_consumed,ebay_writes,production_changed")
        .eq("id",ATTEMPT_ID).maybeSingle(),
      supabase.from("ebay_same_day_pilot_image_revisions")
        .select("id,strategy_version,revision_contract,product_dossier_hash,main_source_hash,side_source_hash,listing_package_id,created_by")
        .eq("id",REVISION_ID).maybeSingle(),
      supabase.from("ebay_reference_guided_extraordinary_replacement_plans")
        .select("*").eq("id",PLAN_ID).maybeSingle(),
      supabase.from("ebay_reference_guided_extraordinary_replacement_positions")
        .select("*").eq("correction_plan_id",PLAN_ID).order("position"),
      supabase.from("ebay_reference_guided_generation_jobs")
        .select("id,position,status,provider_request_id,provider_call_started_at,provider_call_completed_at,output_storage_path,output_sha256,qa_result,error_code,lease_owner,lease_expires_at")
        .eq("generation_attempt_id",ATTEMPT_ID).order("position"),
      supabase.from("ebay_reference_guided_extraordinary_authorization_events")
        .select("*").eq("correction_plan_id",PLAN_ID).eq("position",6),
      supabase.from("ebay_reference_guided_extraordinary_provider_events")
        .select("*").eq("correction_plan_id",PLAN_ID),
      supabase.from("ebay_reference_guided_final_asset_selection_events")
        .select("primary_verdict,material_detail_verdict,primary_sha256,material_detail_sha256")
        .eq("attempt_id",ATTEMPT_ID).maybeSingle(),
      // Use the long-lived visual-review ledger for runtime hydration. The
      // ordinal-7 consume RPC independently validates the dedicated immutable
      // extraordinary verdict table inside PostgreSQL.
      supabase.from("ebay_reference_guided_asset_review_events")
        .select("decision,preview_sha256,reason").eq("attempt_id",ATTEMPT_ID)
        .eq("asset_ordinal",4).eq("decision","APPROVED")
        .eq("preview_sha256","d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24")
        .maybeSingle(),
    ])
  const results=[attempt,revision,plan,positions,jobs,authorizations,events,selection,p4Approval]
  if(results.some((result)=>result.error)||!attempt.data||!revision.data||!plan.data||
    !selection.data||!p4Approval.data||jobs.data?.length!==6||positions.data?.length!==2)
    throw new Error("EXTRAORDINARY_POSITION_6_STATE_LOAD_FAILED")
  return {attempt:attempt.data,revision:revision.data,plan:plan.data,
    positions:positions.data,jobs:jobs.data,authorizations:authorizations.data??[],
    events:events.data??[],selection:selection.data,p4Approval:p4Approval.data}
}

function openReservations(events){
  return events.filter((event)=>event.event_type==="CONSUMED"&&
    !events.some((terminal)=>terminal.consumed_event_id===event.id&&
      ["OUTPUT_PERSISTED","FAILED_FINAL"].includes(terminal.event_type))).length
}

function assertPreflight(state){
  const binding=state.positions.find((item)=>Number(item.position)===6)
  const p4=state.jobs.find((job)=>Number(job.position)===4)
  const p6=state.jobs.find((job)=>Number(job.position)===6)
  const auth=state.authorizations[0]
  if(state.attempt.id!==ATTEMPT_ID||state.attempt.revision_id!==REVISION_ID||
    state.attempt.status!=="GENERATING"||Number(state.attempt.provider_calls)!==7||
    Number(state.attempt.max_provider_calls)!==8||state.attempt.retry_consumed||
    Number(state.attempt.ebay_writes)!==0||state.attempt.production_changed||
    state.revision.strategy_version!=="VISUAL_STRATEGY_V3"||
    state.revision.revision_contract!=="REFERENCE_GUIDED_PRODUCT_GENERATION_V1"||
    state.revision.main_source_hash!==MAIN_SHA256||state.revision.side_source_hash!==SIDE_SHA256||
    state.plan.id!==PLAN_ID||state.plan.plan_hash!==PLAN_HASH||
    sha256(Buffer.from(state.plan.plan_text,"utf8"))!==PLAN_HASH||
    Number(state.plan.absolute_cap)!==8||Number(state.plan.max_concurrency)!==1||
    state.plan.automatic_retries||state.plan.feature_flags_enabled||
    state.authorizations.length>1||(auth&&(Number(auth.position)!==6||
      Number(auth.extraordinary_ordinal)!==8||auth.event_type!=="AUTHORIZED"))||
    state.events.some((event)=>Number(event.extraordinary_ordinal)===8)||
    !binding||binding.asset_role!=="SECONDARY_HUMAN_CONTEXT"||
    Number(binding.extraordinary_ordinal)!==8||binding.amendment_id!==AMENDMENT_ID||
    binding.amendment_hash!==AMENDMENT_HASH||binding.final_effective_contract_hash!==CONTRACT_HASH||
    binding.final_effective_prompt_hash!==PROMPT_HASH||
    sha256(Buffer.from(binding.final_effective_prompt_text,"utf8"))!==PROMPT_HASH||
    state.selection.primary_verdict!=="APPROVED"||
    state.selection.material_detail_verdict!=="APPROVED"||
    state.p4Approval.decision!=="APPROVED"||
    state.p4Approval.preview_sha256!=="d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24"||
    !p4||p4.status!=="PASSED"||p4.output_sha256!==state.p4Approval.preview_sha256||
    !p6||p6.status!=="BLOCKED_FIDELITY"||
    p6.output_sha256!=="0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14"||
    state.jobs.filter((job)=>[2,3,5].includes(Number(job.position)))
      .some((job)=>job.status!=="PASSED")||
    state.jobs.some((job)=>job.lease_owner!=null||job.lease_expires_at!=null)||
    openReservations(state.events)!==0)
    throw new Error("EXTRAORDINARY_POSITION_6_PREFLIGHT_FAILED")
}

function semanticQa(technicalQa){
  const human="REQUIRES_HUMAN_CONFIRMATION"
  return {automaticStatus:"HUMAN_REVIEW_REQUIRED",
    evaluatorVersion:"EXTRAORDINARY_POSITION_6_EMPTY_BACKGROUND_QA_V1_2026_07_22",
    batchPlanHash:PLAN_HASH,amendmentHash:AMENDMENT_HASH,
    effectiveContractHash:CONTRACT_HASH,effectivePromptHash:PROMPT_HASH,
    technicalChecks:technicalQa.technicalChecks,exactlyTwoHandsCheck:human,
    oneHandPerHandleCheck:human,naturalAnatomyCheck:human,emptyBackgroundCheck:human,
    backgroundPropsCheck:human,productDeformationCheck:human,textOrLogoCheck:human,
    productIdentityChecks:{exactCompleteEmptyProduct:human,exactTwoHandles:human,
      handleGeometryAndAttachment:human,continuousMetalRim:human,
      raisedBaseAndLowerRing:human,exactPerforationPattern:human,
      whiteEnamelFinish:human,proportions:human},
    humanApprovalRequired:true,autoApproved:false,publicationAuthorized:false}
}

const before=await loadState()
assertPreflight(before)
const passedBefore=JSON.stringify({selection:before.selection,
  jobs:before.jobs.filter((job)=>[1,2,3,4,5].includes(Number(job.position)))})

const authorized=await supabase.rpc("authorize_ebay_reference_guided_extraordinary_replacement",{
  p_attempt_id:ATTEMPT_ID,p_position:6,p_human_authorized_by:before.plan.created_by})
if(authorized.error||rows(authorized.data).length!==1)
  throw new Error(`EXTRAORDINARY_POSITION_6_AUTHORIZATION_FAILED:${authorized.error?.message??"UNKNOWN"}`)
const authorization=authorized.data[0]
if(Number(authorization.authorized_position)!==6||Number(authorization.extraordinary_ordinal)!==8||
  Boolean(authorization.reused)!==(before.authorizations.length===1))
  throw new Error("EXTRAORDINARY_POSITION_6_AUTHORIZATION_RESULT_INVALID")
const authRow=await supabase.from("ebay_reference_guided_extraordinary_authorization_events")
  .select("id,human_confirmation_hash").eq("id",authorization.authorization_id).maybeSingle()
if(authRow.error||!authRow.data)throw new Error("EXTRAORDINARY_POSITION_6_AUTHORIZATION_EVIDENCE_MISSING")

const disabled=await supabase.rpc("consume_ebay_reference_guided_extraordinary_position_6",{
  p_correction_plan_id:PLAN_ID,p_authorization_event_id:authorization.authorization_id,
  p_human_confirmation_hash:authRow.data.human_confirmation_hash,
  p_lease_owner:`extraordinary-position-6-disabled:${randomUUID()}`,p_feature_enabled:false})
if(!disabled.error)throw new Error("EXTRAORDINARY_POSITION_6_DISABLED_GATE_FAILED")

const sourceBinding=await supabase.from("luna_catalog_source_pack_dossier_bindings")
  .select("source_pack_id").eq("listing_package_id",before.revision.listing_package_id)
  .eq("dossier_hash",before.revision.product_dossier_hash)
  .eq("policy_version","REFERENCE_GUIDED_PRODUCT_GENERATION_V1")
  .order("verified_at",{ascending:false}).limit(1).maybeSingle()
if(sourceBinding.error||!sourceBinding.data)throw new Error("EXTRAORDINARY_POSITION_6_SOURCE_BINDING_MISSING")
const pack=await supabase.from("luna_catalog_authorized_source_packs")
  .select("source_assets").eq("id",sourceBinding.data.source_pack_id).maybeSingle()
if(pack.error||!pack.data)throw new Error("EXTRAORDINARY_POSITION_6_SOURCE_PACK_MISSING")
const mainAsset=rows(pack.data.source_assets).find((asset)=>asset.sourceImageId==="MAIN"&&
  asset.sha256===MAIN_SHA256&&asset.authorizationStatus==="AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
const sideAsset=rows(pack.data.source_assets).find((asset)=>asset.sourceImageId==="SIDE"&&
  asset.sha256===SIDE_SHA256&&asset.authorizationStatus==="AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
if(!mainAsset?.storagePath||!sideAsset?.storagePath)
  throw new Error("EXTRAORDINARY_POSITION_6_PROTECTED_SOURCES_INVALID")
const [mainDownload,sideDownload]=await Promise.all([
  supabase.storage.from("ebay-listing-image-sources").download(mainAsset.storagePath),
  supabase.storage.from("ebay-listing-image-sources").download(sideAsset.storagePath)])
if(mainDownload.error||sideDownload.error||!mainDownload.data||!sideDownload.data)
  throw new Error("EXTRAORDINARY_POSITION_6_SOURCE_DOWNLOAD_FAILED")
const main=Buffer.from(await mainDownload.data.arrayBuffer())
const side=Buffer.from(await sideDownload.data.arrayBuffer())
if(sha256(main)!==MAIN_SHA256||sha256(side)!==SIDE_SHA256)
  throw new Error("EXTRAORDINARY_POSITION_6_SOURCE_BYTES_MISMATCH")

const leaseOwner=`extraordinary-position-6:${randomUUID()}`
let consumedEventId=null,jobId=null,httpStatus=null,providerRequestId=null
let outputSha256=null,outputStoragePath=null,automaticQa=null
let providerFetches=0,budgetConsumed=false,outputUploaded=false
try{
  const consumed=await supabase.rpc("consume_ebay_reference_guided_extraordinary_position_6",{
    p_correction_plan_id:PLAN_ID,p_authorization_event_id:authorization.authorization_id,
    p_human_confirmation_hash:authRow.data.human_confirmation_hash,
    p_lease_owner:leaseOwner,p_feature_enabled:true})
  if(consumed.error||rows(consumed.data).length!==1)
    throw new Error(`EXTRAORDINARY_POSITION_6_ATOMIC_RESERVATION_FAILED:${consumed.error?.message??"UNKNOWN"}`)
  const reserved=consumed.data[0]
  consumedEventId=reserved.consumed_event_id;jobId=reserved.job_id
  budgetConsumed=Number(reserved.provider_calls)===8
  if(!budgetConsumed||reserved.batch_plan_hash!==PLAN_HASH||reserved.amendment_id!==AMENDMENT_ID||
    reserved.amendment_hash!==AMENDMENT_HASH||reserved.effective_contract_hash!==CONTRACT_HASH||
    reserved.exact_prompt_hash!==PROMPT_HASH||
    sha256(Buffer.from(reserved.exact_prompt_text,"utf8"))!==PROMPT_HASH||
    reserved.main_source_hash!==MAIN_SHA256||reserved.side_source_hash!==SIDE_SHA256||
    reserved.main_storage_path!==mainAsset.storagePath||reserved.side_storage_path!==sideAsset.storagePath)
    throw new Error("EXTRAORDINARY_POSITION_6_RESERVATION_RESULT_INVALID")
  const providerPlan={version:"REFERENCE_GUIDED_PRODUCT_GENERATION_V1",model:"gpt-image-2",
    size:"1600x1600",quality:"high",outputFormat:"png",productBytesSentToProvider:true,
    competitorImagesSentToProvider:false,excludedSourceSha256s:rows(mainAsset.excludedSourceSha256s),
    compositionManifestHash:before.attempt.composition_manifest_hash,
    jobs:[{slot:"HUMAN_CONTEXT",salesObjective:"REAL_HUMAN_USE",
      prompt:reserved.exact_prompt_text,promptHash:reserved.exact_prompt_hash,
      sourceImageIds:["MAIN","SIDE"],sourceHashes:[reserved.main_source_hash,reserved.side_source_hash]}]}
  const fetchOnce=async(endpoint,init)=>{
    providerFetches+=1
    if(providerFetches!==1||String(endpoint)!=="https://api.openai.com/v1/images/edits")
      throw new Error("EXTRAORDINARY_POSITION_6_HTTP_BUDGET_EXCEEDED")
    try{const response=await fetch(endpoint,{...init,signal:AbortSignal.timeout(230_000)})
      httpStatus=response.status;providerRequestId=response.headers.get("x-request-id");return response}
    finally{process.env[FEATURE_FLAG]="false"}
  }
  const outputs=await requestReferenceGuidedProductGeneration({plan:providerPlan,main,side,apiKey,
    fetchImpl:fetchOnce,shouldContinue:()=>providerFetches===0&&process.env[FEATURE_FLAG]==="true"})
  const output=outputs[0]
  providerRequestId=providerRequestId||output.providerRequestId
  if(!providerRequestId)throw new Error("EXTRAORDINARY_POSITION_6_REQUEST_ID_MISSING")
  outputSha256=output.outputSha256
  outputStoragePath=`${before.revision.created_by}/reference-guided-extraordinary/${ATTEMPT_ID}/position-6/ordinal-8/${PLAN_HASH}/${outputSha256}.png`
  const persisted=await persistReferenceGuidedCanaryPng({supabase,output:output.output,
    expectedSha256:outputSha256,storagePath:outputStoragePath})
  outputUploaded=persisted.uploaded===true
  if(!outputUploaded||!persisted.downloaded||!persisted.hashMatch)
    throw new Error("EXTRAORDINARY_POSITION_6_STORAGE_ROUNDTRIP_FAILED")
  automaticQa=semanticQa(persisted.qaResult)
  const completed=await supabase.rpc("complete_ebay_reference_guided_extraordinary_position_6",{
    p_authorization_event_id:authorization.authorization_id,p_consumed_event_id:consumedEventId,
    p_job_id:jobId,p_lease_owner:leaseOwner,p_http_status:httpStatus,
    p_provider_request_id:providerRequestId,p_output_storage_path:outputStoragePath,
    p_output_sha256:outputSha256,p_qa_result:automaticQa})
  if(completed.error||completed.data?.status!=="QA_PENDING")
    throw new Error(`EXTRAORDINARY_POSITION_6_COMPLETION_FAILED:${completed.error?.message??"UNKNOWN"}`)
  output.output.fill(0)
}catch(error){
  process.env[FEATURE_FLAG]="false"
  if(budgetConsumed&&consumedEventId&&jobId){
    const code=(error instanceof Error?error.message:"EXTRAORDINARY_POSITION_6_FAILED")
      .match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0]??"EXTRAORDINARY_POSITION_6_FAILED"
    const failed=await supabase.rpc("fail_ebay_reference_guided_extraordinary_position_6",{
      p_authorization_event_id:authorization.authorization_id,p_consumed_event_id:consumedEventId,
      p_job_id:jobId,p_lease_owner:leaseOwner,p_http_status:httpStatus,
      p_provider_request_id:providerRequestId??"",p_error_code:code,
      p_output_storage_path:outputUploaded?outputStoragePath:null,
      p_output_sha256:outputUploaded?outputSha256:null})
    if(failed.error)throw new Error(`${code}:FAILURE_RECORD_FAILED:${failed.error.message}`)
  }
  throw error
}finally{process.env[FEATURE_FLAG]="false";main.fill(0);side.fill(0)}

const after=await loadState()
const position6=after.jobs.find((job)=>Number(job.position)===6)
const passedUnchanged=JSON.stringify({selection:after.selection,
  jobs:after.jobs.filter((job)=>[1,2,3,4,5].includes(Number(job.position)))})===passedBefore
const activeLeases=after.jobs.filter((job)=>job.lease_owner!=null||job.lease_expires_at!=null).length
if(providerFetches!==1||Number(after.attempt.provider_calls)!==8||
  position6?.status!=="QA_PENDING"||position6.output_sha256!==outputSha256||
  position6.output_storage_path!==outputStoragePath||position6.provider_request_id!==providerRequestId||
  !passedUnchanged||activeLeases!==0||process.env[FEATURE_FLAG]!=="false")
  throw new Error("EXTRAORDINARY_POSITION_6_POSTCONDITION_FAILED")
const signed=await supabase.storage.from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
  .createSignedUrl(outputStoragePath,300)
if(signed.error||!signed.data?.signedUrl)throw new Error("EXTRAORDINARY_POSITION_6_SIGNED_PREVIEW_FAILED")

export const executionResult={position6ExtraordinaryOrdinalBound:true,
  position6AuthorizationConsumed:true,position6ProviderCallStarted:true,providerCalls:8,
  httpStatus,providerRequestId,outputPersisted:true,outputDimensions:"1600x1600",
  outputSha256,privateStoragePath:outputStoragePath,storageRoundtrip:true,
  persistedBatchPlanHash:PLAN_HASH,persistedAmendmentHash:AMENDMENT_HASH,
  persistedEffectiveContractHash:CONTRACT_HASH,persistedEffectivePromptHash:PROMPT_HASH,
  automaticQaStatus:automaticQa.automaticStatus,
  exactlyTwoHandsCheck:automaticQa.exactlyTwoHandsCheck,
  oneHandPerHandleCheck:automaticQa.oneHandPerHandleCheck,
  naturalAnatomyCheck:automaticQa.naturalAnatomyCheck,
  emptyBackgroundCheck:automaticQa.emptyBackgroundCheck,
  backgroundPropsCheck:automaticQa.backgroundPropsCheck,
  productDeformationCheck:automaticQa.productDeformationCheck,
  productIdentityChecks:automaticQa.productIdentityChecks,
  textOrLogoCheck:automaticQa.textOrLogoCheck,automaticRetryOccurred:false,
  featureFlagDisabledAfterRun:true,passedAssetsUnchanged:passedUnchanged,
  activeLeases,providerReservationsCreated:1,ebayWrites:0,productionChanged:false,
  readyForPosition6HumanReview:true}
console.log(JSON.stringify(executionResult))
