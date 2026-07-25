import { createHash, randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

import {
  requestReferenceGuidedProductGeneration,
} from "../lib/ebay/ebay-listing-image-factory.ts"
import {
  persistReferenceGuidedCanaryPng,
  REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET,
} from "../lib/ebay/reference-guided-canary-persistence.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const PLAN_ID = "c54a0bbc-b16c-47b3-8f4e-93d2152e3b34"
const PLAN_HASH = "a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7"
const MAIN_SHA256 = "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SIDE_SHA256 = "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21"
const POSITION_5_SHA256 = "c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c"
const POSITION_3_SHA256 = "7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da"
const AMENDMENT_ID = "5fdc0614-8467-4d0c-97e9-9fc4c99828f7"
const AMENDMENT_HASH = "d360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747"
const EFFECTIVE_CONTRACT_HASH = "f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2"
const EFFECTIVE_PROMPT_HASH = "54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40"
const FEATURE_FLAG = "OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED"
const CONFIRMATION = `AUTHORIZE_SUCCESSOR_POSITION_4|ATTEMPT=${ATTEMPT_ID}|PLAN=${PLAN_ID}|PLAN_HASH=${PLAN_HASH}|POSITION=4|ASSET_ROLE=SECONDARY_USE_CONTEXT|AMENDMENT_ID=${AMENDMENT_ID}|AMENDMENT_HASH=${AMENDMENT_HASH}|EFFECTIVE_CONTRACT_HASH=${EFFECTIVE_CONTRACT_HASH}|EFFECTIVE_PROMPT_HASH=${EFFECTIVE_PROMPT_HASH}|MAX_CALLS=1`
const CONFIRMATION_HASH = createHash("sha256")
  .update(Buffer.from(CONFIRMATION, "utf8")).digest("hex")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const apiKey = process.env.OPENAI_API_KEY?.trim()
let projectRef = ""
try { projectRef = new URL(url ?? "").hostname.split(".")[0] ?? "" } catch {}
if (!url || !key || projectRef !== "vsfthqydfrdzulldbfbe") {
  throw new Error("SUCCESSOR_POSITION_4_STAGING_SERVICE_ROLE_REQUIRED")
}
if (!apiKey || process.env[FEATURE_FLAG] !== "true" ||
  process.env.OPENAI_IMAGE_MODEL?.trim() !== "gpt-image-2" ||
  process.env.CANARY_EXECUTION_ENVIRONMENT !== "preview") {
  throw new Error("SUCCESSOR_POSITION_4_PREVIEW_PROVIDER_CONFIGURATION_INVALID")
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const rows = (value) => Array.isArray(value) ? value : []

async function loadState() {
  const [{ data: attempt, error: attemptError },
    { data: revision, error: revisionError },
    { data: plan, error: planError },
    { data: position, error: positionError },
    { data: jobs, error: jobsError },
    { data: reviews, error: reviewsError },
    { data: position5Verdict, error: position5VerdictError },
    { data: providerEvents, error: providerEventsError },
    { data: effectiveContract, error: effectiveContractError }] = await Promise.all([
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,revision_id,status,composition_manifest_hash,provider_calls,max_provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_same_day_pilot_image_revisions")
      .select("id,status,strategy_version,revision_contract,product_dossier_hash,market_visual_brief_hash,main_source_hash,side_source_hash,listing_package_id,created_by")
      .eq("id", REVISION_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_batch_plan_successors_v2")
      .select("id,attempt_id,revision_id,plan_hash,plan_text,status,max_concurrency,automatic_retries,approved_primary_sha256,approved_material_detail_sha256")
      .eq("id", PLAN_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_batch_plan_successor_positions_v2")
      .select("*").eq("successor_plan_id", PLAN_ID).eq("position", 4)
      .maybeSingle(),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,commercial_role,status,provider_request_id,provider_call_started_at,provider_call_completed_at,output_storage_path,output_sha256,qa_result,error_code,lease_owner,lease_expires_at")
      .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
    supabase.from("ebay_reference_guided_asset_review_events")
      .select("asset_ordinal,preview_sha256,decision,reason")
      .eq("attempt_id", ATTEMPT_ID),
    supabase.from("ebay_reference_guided_position_5_human_verdict_events")
      .select("position,output_sha256,human_verdict,verdict_reason")
      .eq("attempt_id", ATTEMPT_ID).eq("position", 5).maybeSingle(),
    supabase.from("ebay_reference_guided_successor_provider_events")
      .select("id,event_type,authorization_event_id,position,provider_call_ordinal,evidence")
      .eq("attempt_id", ATTEMPT_ID),
    supabase.from("ebay_reference_guided_position_contract_amendments")
      .select("id,amendment_hash,effective_position_contract_hash,effective_prompt_text,effective_prompt_hash")
      .eq("id", AMENDMENT_ID).eq("status", "ACTIVE"),
  ])
  if (attemptError || revisionError || planError || positionError || jobsError ||
    reviewsError || position5VerdictError || providerEventsError || effectiveContractError || !attempt ||
    !revision || !plan || !position || !position5Verdict || jobs?.length !== 6) {
    throw new Error("SUCCESSOR_POSITION_4_STATE_LOAD_FAILED")
  }
  return { attempt, revision, plan, position, jobs, reviews,
    position5Verdict, providerEvents, effectiveContract }
}

function activeReservationCount(events) {
  return events.filter((event) => event.event_type === "CONSUMED" &&
    !events.some((terminal) => terminal.authorization_event_id === event.authorization_event_id &&
      ["OUTPUT_PERSISTED", "FAILED_FINAL"].includes(terminal.event_type))).length
}

function assertPreflight(state) {
  const promptHash = sha256(Buffer.from(state.position.exact_prompt_text, "utf8"))
  const planHash = sha256(Buffer.from(state.plan.plan_text, "utf8"))
  const sources = state.position.authorized_sources
  const p3 = state.jobs.find((job) => Number(job.position) === 3)
  const p4 = state.jobs.find((job) => Number(job.position) === 4)
  const p5 = state.jobs.find((job) => Number(job.position) === 5)
  const p6 = state.jobs.find((job) => Number(job.position) === 6)
  const effective = rows(state.effectiveContract)[0]
  const activeLeases = state.jobs.filter((job) =>
    job.lease_owner != null || job.lease_expires_at != null)
  const position2Approved = state.reviews.some((review) =>
    Number(review.asset_ordinal) === 2 && review.decision === "APPROVED" &&
    review.preview_sha256 === "7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2")
  if (state.attempt.id !== ATTEMPT_ID || state.attempt.revision_id !== REVISION_ID ||
    state.attempt.status !== "GENERATING" || Number(state.attempt.provider_calls) !== 4 ||
    Number(state.attempt.max_provider_calls) !== 6 || state.attempt.retry_consumed !== false ||
    Number(state.attempt.ebay_writes) !== 0 || state.attempt.production_changed !== false ||
    state.plan.id !== PLAN_ID || state.plan.plan_hash !== PLAN_HASH || planHash !== PLAN_HASH ||
    state.plan.attempt_id !== ATTEMPT_ID || state.plan.revision_id !== REVISION_ID ||
    Number(state.plan.max_concurrency) !== 2 || state.plan.automatic_retries !== false ||
    state.revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
    state.revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
    state.revision.main_source_hash !== MAIN_SHA256 ||
    state.revision.side_source_hash !== SIDE_SHA256 ||
    state.position.asset_role !== "SECONDARY_USE_CONTEXT" ||
    state.position.commercial_objective !== "PRIMARY_BENEFIT_IN_ACTION" ||
    state.position.execution_mode !== "PROVIDER" ||
    Number(state.position.planned_provider_calls) !== 1 ||
    promptHash !== state.position.exact_prompt_hash ||
    !state.position.exact_prompt_text.includes("POSITION_MUST_INCLUDE MUST take priority") ||
    !Array.isArray(sources) || sources.length !== 2 ||
    sources[0]?.sourceImageId !== "MAIN" || sources[0]?.sha256 !== MAIN_SHA256 ||
    sources[1]?.sourceImageId !== "SIDE" || sources[1]?.sha256 !== SIDE_SHA256 ||
    !p3 || p3.status !== "PASSED" || p3.output_sha256 !== POSITION_3_SHA256 ||
    !p4 || p4.status !== "PENDING" ||
    p4.commercial_role !== "PRIMARY_BENEFIT_IN_ACTION" ||
    p4.lease_owner != null || p4.lease_expires_at != null ||
    p4.provider_request_id != null || p4.provider_call_started_at != null ||
    p4.provider_call_completed_at != null || p4.output_storage_path != null ||
    p4.output_sha256 != null || activeLeases.length !== 0 ||
    activeReservationCount(state.providerEvents) !== 0 || !position2Approved ||
    !p5 || p5.status !== "PASSED" || p5.output_sha256 !== POSITION_5_SHA256 ||
    state.position5Verdict.human_verdict !== "APPROVED" ||
    state.position5Verdict.output_sha256 !== POSITION_5_SHA256 || !p6 ||
    p6.status !== "PENDING" || p6.lease_owner != null || p6.lease_expires_at != null ||
    p6.provider_request_id != null || p6.provider_call_started_at != null ||
    p6.output_storage_path != null || p6.output_sha256 != null ||
    !effective || effective.id !== AMENDMENT_ID ||
    effective.amendment_hash !== AMENDMENT_HASH ||
    effective.effective_position_contract_hash !== EFFECTIVE_CONTRACT_HASH ||
    effective.effective_prompt_hash !== EFFECTIVE_PROMPT_HASH ||
    sha256(Buffer.from(effective.effective_prompt_text, "utf8")) !== EFFECTIVE_PROMPT_HASH ||
    !effective.effective_prompt_text.includes(
      "POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.")) {
    throw new Error("SUCCESSOR_POSITION_4_PREFLIGHT_FAILED")
  }
}

function semanticQa(technicalQa) {
  const human = "REQUIRES_HUMAN_CONFIRMATION"
  return {
    automaticStatus: "HUMAN_REVIEW_REQUIRED",
    evaluatorVersion: "REFERENCE_GUIDED_SUCCESSOR_POSITION_4_AMENDED_QA_V1_2026_07_22",
    amendmentHash: AMENDMENT_HASH,
    effectivePositionContractHash: EFFECTIVE_CONTRACT_HASH,
    effectivePromptHash: EFFECTIVE_PROMPT_HASH,
    technicalChecks: technicalQa.technicalChecks,
    semanticChecks: {
      exactCompleteProductUnderGentleWater: human,
      moderateGenericProduceInside: human,
      faucetOrWaterSourceOnlyAsContext: human,
      noHandsFingersArmsPeopleOrHumanParts: human,
      bothHandlesRimBaseAndPerforationsVisible: human,
      noDramaticSplash: human,
      noUtensilsOrAdditionalObjects: human,
      foodAndWaterNotIncluded: human,
      noPerformanceClaims: human,
      distinctFromScaleLifestyleAndHumanContext: human,
    },
    handsOrHumanPartsDetected: human,
    textDetected: human,
    extraObjectsDetected: human,
    logosDetected: human,
    deformationDetected: human,
    productIdentityChecks: {
      exactForm: human,
      twoHandles: human,
      metalRim: human,
      pedestalBase: human,
      perforationPattern: human,
      whiteEnamelFinish: human,
      proportions: human,
      noNewLogo: human,
    },
    humanApprovalRequired: true,
    autoApproved: false,
    publicationAuthorized: false,
  }
}

const resolvedPreflight = await supabase.rpc(
  "resolve_ebay_reference_guided_position_4_effective_contract", {
    p_attempt_id: ATTEMPT_ID,
  })
if (resolvedPreflight.error || rows(resolvedPreflight.data).length !== 1) {
  throw new Error("SUCCESSOR_POSITION_4_SERVER_RESOLUTION_FAILED")
}
const before = await loadState()
assertPreflight(before)
const beforePositions0To3And5 = JSON.stringify(before.jobs.filter((job) =>
  [1, 2, 3, 5].includes(Number(job.position))))
const beforePosition6 = JSON.stringify(before.jobs.find((job) =>
  Number(job.position) === 6))

const disabled = await supabase.rpc(
  "consume_ebay_reference_guided_successor_position_4", {
    p_successor_plan_id: PLAN_ID,
    p_human_confirmation_hash: CONFIRMATION_HASH,
    p_lease_owner: `successor-position-4:${randomUUID()}`,
    p_feature_enabled: false,
  })
if (!disabled.error) {
  throw new Error("SUCCESSOR_POSITION_4_DISABLED_PREFLIGHT_DID_NOT_FAIL")
}

const { data: binding, error: bindingError } = await supabase
  .from("luna_catalog_source_pack_dossier_bindings").select("source_pack_id")
  .eq("listing_package_id", before.revision.listing_package_id)
  .eq("dossier_hash", before.revision.product_dossier_hash)
  .eq("policy_version", "REFERENCE_GUIDED_PRODUCT_GENERATION_V1")
  .order("verified_at", { ascending: false }).limit(1).maybeSingle()
if (bindingError || !binding) throw new Error("SUCCESSOR_POSITION_4_BINDING_LOAD_FAILED")
const loadedSourcePack = await supabase.from("luna_catalog_authorized_source_packs")
  .select("source_assets").eq("id", binding.source_pack_id).maybeSingle()
if (loadedSourcePack.error || !loadedSourcePack.data) {
  throw new Error("SUCCESSOR_POSITION_4_SOURCE_PACK_LOAD_FAILED")
}
const mainAsset = rows(loadedSourcePack.data.source_assets).find((asset) =>
  asset.sourceImageId === "MAIN" && asset.sha256 === MAIN_SHA256 &&
  asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
const sideAsset = rows(loadedSourcePack.data.source_assets).find((asset) =>
  asset.sourceImageId === "SIDE" && asset.sha256 === SIDE_SHA256 &&
  asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
if (!mainAsset?.storagePath || !sideAsset?.storagePath) {
  throw new Error("SUCCESSOR_POSITION_4_PROTECTED_SOURCES_INVALID")
}
const [mainDownload, sideDownload] = await Promise.all([
  supabase.storage.from("ebay-listing-image-sources").download(mainAsset.storagePath),
  supabase.storage.from("ebay-listing-image-sources").download(sideAsset.storagePath),
])
if (mainDownload.error || sideDownload.error || !mainDownload.data || !sideDownload.data) {
  throw new Error("SUCCESSOR_POSITION_4_SOURCE_DOWNLOAD_FAILED")
}
const main = Buffer.from(await mainDownload.data.arrayBuffer())
const side = Buffer.from(await sideDownload.data.arrayBuffer())
if (sha256(main) !== MAIN_SHA256 || sha256(side) !== SIDE_SHA256) {
  throw new Error("SUCCESSOR_POSITION_4_SOURCE_BYTES_MISMATCH")
}

const leaseOwner = `successor-position-4:${randomUUID()}`
let authorizationEventId = null
let jobId = null
let httpStatus = null
let providerRequestId = null
let outputSha256 = null
let outputStoragePath = null
let storageRoundtrip = false
let automaticQa = null
let providerFetches = 0
let budgetConsumed = false
let outputUploaded = false
try {
  const consumed = await supabase.rpc(
    "consume_ebay_reference_guided_successor_position_4", {
      p_successor_plan_id: PLAN_ID,
      p_human_confirmation_hash: CONFIRMATION_HASH,
      p_lease_owner: leaseOwner,
      p_feature_enabled: true,
    })
  if (consumed.error || !Array.isArray(consumed.data) || consumed.data.length !== 1) {
    throw new Error(`SUCCESSOR_POSITION_4_ATOMIC_RESERVATION_FAILED:${consumed.error?.message ?? "UNKNOWN"}`)
  }
  const reserved = consumed.data[0]
  authorizationEventId = reserved.authorization_event_id
  jobId = reserved.job_id
  budgetConsumed = Number(reserved.provider_calls) === 5
  if (!budgetConsumed || sha256(Buffer.from(reserved.exact_prompt_text, "utf8")) !==
      reserved.exact_prompt_hash || reserved.amendment_id !== AMENDMENT_ID ||
    reserved.amendment_hash !== AMENDMENT_HASH ||
    reserved.effective_position_contract_hash !== EFFECTIVE_CONTRACT_HASH ||
    reserved.exact_prompt_hash !== EFFECTIVE_PROMPT_HASH ||
    !reserved.exact_prompt_text.includes(
      "POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.") ||
    reserved.main_source_hash !== MAIN_SHA256 || reserved.side_source_hash !== SIDE_SHA256 ||
    reserved.main_storage_path !== mainAsset.storagePath ||
    reserved.side_storage_path !== sideAsset.storagePath) {
    throw new Error("SUCCESSOR_POSITION_4_ATOMIC_RESERVATION_RESULT_INVALID")
  }
  const plan = {
    version: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
    model: "gpt-image-2",
    size: "1600x1600",
    quality: "high",
    outputFormat: "png",
    productBytesSentToProvider: true,
    competitorImagesSentToProvider: false,
    excludedSourceSha256s: rows(mainAsset.excludedSourceSha256s),
    compositionManifestHash: before.attempt.composition_manifest_hash,
    jobs: [{ slot: "USE_CONTEXT", salesObjective: "PRIMARY_USE",
      prompt: reserved.exact_prompt_text, promptHash: reserved.exact_prompt_hash,
      sourceImageIds: ["MAIN", "SIDE"],
      sourceHashes: [reserved.main_source_hash, reserved.side_source_hash] }],
  }
  const fetchOnce = async (endpoint, init) => {
    providerFetches += 1
    if (providerFetches !== 1 ||
      String(endpoint) !== "https://api.openai.com/v1/images/edits") {
      throw new Error("SUCCESSOR_POSITION_4_HTTP_BUDGET_EXCEEDED")
    }
    try {
      const response = await fetch(endpoint, { ...init,
        signal: AbortSignal.timeout(230_000) })
      httpStatus = response.status
      providerRequestId = response.headers.get("x-request-id")
      return response
    } finally {
      process.env[FEATURE_FLAG] = "false"
    }
  }
  const outputs = await requestReferenceGuidedProductGeneration({
    plan, main, side, apiKey, fetchImpl: fetchOnce,
    shouldContinue: () => providerFetches === 0 && process.env[FEATURE_FLAG] === "true",
  })
  const output = outputs[0]
  providerRequestId = providerRequestId || output.providerRequestId
  if (!providerRequestId) throw new Error("SUCCESSOR_POSITION_4_PROVIDER_REQUEST_ID_MISSING")
  outputSha256 = output.outputSha256
  outputStoragePath = `${before.revision.created_by}/reference-guided-successor/${ATTEMPT_ID}/position-4/${PLAN_HASH}/${outputSha256}.png`
  const persisted = await persistReferenceGuidedCanaryPng({
    supabase, output: output.output, expectedSha256: outputSha256,
    storagePath: outputStoragePath,
  })
  outputUploaded = true
  storageRoundtrip = persisted.uploaded && persisted.downloaded && persisted.hashMatch
  automaticQa = semanticQa(persisted.qaResult)
  const completed = await supabase.rpc(
    "complete_ebay_reference_guided_successor_position_4", {
      p_authorization_event_id: authorizationEventId,
      p_job_id: jobId,
      p_lease_owner: leaseOwner,
      p_http_status: httpStatus,
      p_provider_request_id: providerRequestId,
      p_output_storage_path: outputStoragePath,
      p_output_sha256: outputSha256,
      p_qa_result: automaticQa,
    })
  if (completed.error || !completed.data || completed.data.status !== "QA_PENDING") {
    throw new Error(`SUCCESSOR_POSITION_4_COMPLETION_FAILED:${completed.error?.message ?? "UNKNOWN"}`)
  }
  output.output.fill(0)
} catch (error) {
  process.env[FEATURE_FLAG] = "false"
  if (outputUploaded && outputStoragePath) {
    await supabase.storage.from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
      .remove([outputStoragePath])
    outputUploaded = false
  }
  if (budgetConsumed && authorizationEventId && jobId) {
    const code = (error instanceof Error ? error.message : "SUCCESSOR_POSITION_4_FAILED")
      .match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0] ?? "SUCCESSOR_POSITION_4_FAILED"
    const failed = await supabase.rpc(
      "fail_ebay_reference_guided_successor_position_4", {
        p_authorization_event_id: authorizationEventId,
        p_job_id: jobId,
        p_lease_owner: leaseOwner,
        p_http_status: httpStatus,
        p_provider_request_id: providerRequestId ?? "",
        p_error_code: code,
      })
    if (failed.error) {
      throw new Error(`${code}:FAILURE_RECORD_FAILED:${failed.error.message}`)
    }
  }
  throw error
} finally {
  process.env[FEATURE_FLAG] = "false"
  main.fill(0)
  side.fill(0)
}

const after = await loadState()
const position4 = after.jobs.find((job) => Number(job.position) === 4)
const positions0To3And5Unchanged = JSON.stringify(after.jobs.filter((job) =>
  [1, 2, 3, 5].includes(Number(job.position)))) === beforePositions0To3And5
const position6Unchanged = JSON.stringify(after.jobs.find((job) =>
  Number(job.position) === 6)) === beforePosition6
const activeLeases = after.jobs.filter((job) =>
  job.lease_owner != null || job.lease_expires_at != null).length
if (providerFetches !== 1 || Number(after.attempt.provider_calls) !== 5 ||
  position4?.status !== "QA_PENDING" || position4.output_sha256 !== outputSha256 ||
  position4.output_storage_path !== outputStoragePath ||
  position4.provider_request_id !== providerRequestId || !positions0To3And5Unchanged ||
  !position6Unchanged || activeLeases !== 0 || !storageRoundtrip ||
  process.env[FEATURE_FLAG] !== "false") {
  throw new Error("SUCCESSOR_POSITION_4_POSTCONDITION_FAILED")
}
const signed = await supabase.storage.from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
  .createSignedUrl(outputStoragePath, 300)
if (signed.error || !signed.data?.signedUrl) {
  throw new Error("SUCCESSOR_POSITION_4_SIGNED_PREVIEW_FAILED")
}

export const executionResult = {
  position4AmendmentBound: true,
  position4AuthorizationConsumed: true,
  position4ProviderCallStarted: true,
  providerCalls: 5,
  httpStatus,
  providerRequestId,
  outputPersisted: true,
  outputDimensions: "1600x1600",
  outputSha256,
  privateStoragePath: outputStoragePath,
  storageRoundtrip: true,
  automaticQaStatus: automaticQa.automaticStatus,
  persistedAmendmentHash: automaticQa.amendmentHash,
  persistedEffectiveContractHash: automaticQa.effectivePositionContractHash,
  persistedEffectivePromptHash: automaticQa.effectivePromptHash,
  handsOrHumanPartsDetected: automaticQa.handsOrHumanPartsDetected,
  textDetected: automaticQa.textDetected,
  extraObjectsDetected: automaticQa.extraObjectsDetected,
  productIdentityChecks: automaticQa.productIdentityChecks,
  positions0To3And5Unchanged,
  position6Unchanged,
  automaticRetryOccurred: false,
  featureFlagDisabledAfterRun: true,
  activeLeases,
  providerFetches,
  signedPreviewCreated: true,
  ebayWrites: 0,
  productionChanged: false,
  readyForPosition4HumanReview: true,
}
console.log(JSON.stringify(executionResult))
