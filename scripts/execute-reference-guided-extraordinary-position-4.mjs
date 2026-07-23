import { createHash, randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

import { requestReferenceGuidedProductGeneration } from
  "../lib/ebay/ebay-listing-image-factory.ts"
import {
  persistReferenceGuidedCanaryPng,
  REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET,
} from "../lib/ebay/reference-guided-canary-persistence.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const PLAN_ID = "7ac6e2f4-d1f7-44f8-a026-064ca474904b"
const PLAN_HASH = "9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3"
const AMENDMENT_ID = "cc870df1-7d04-4fb3-ab9a-4f07c978ffde"
const AMENDMENT_HASH = "8dbe3c4c8068a31d4c18153434faf7d7b88b25c17542cb67ad37f8aca80c1c8f"
const CONTRACT_HASH = "6cac13ae461915ba22d79b381c98eb53de93bd1f052e54716f67901013ca582a"
const PROMPT_HASH = "4aca1c9ca9623e238c2f3714a01ed8d8931779d8fd06741c8173f8e9786ced91"
const MAIN_SHA256 = "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SIDE_SHA256 = "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21"
const FEATURE_FLAG = "OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const apiKey = process.env.OPENAI_API_KEY?.trim()
let projectRef = ""
try { projectRef = new URL(url ?? "").hostname.split(".")[0] ?? "" } catch {}
if (!url || !key || projectRef !== "vsfthqydfrdzulldbfbe") {
  throw new Error("EXTRAORDINARY_POSITION_4_STAGING_SERVICE_ROLE_REQUIRED")
}
if (!apiKey || process.env[FEATURE_FLAG] !== "true" ||
  process.env.OPENAI_IMAGE_MODEL?.trim() !== "gpt-image-2" ||
  process.env.CANARY_EXECUTION_ENVIRONMENT !== "preview") {
  throw new Error("EXTRAORDINARY_POSITION_4_PREVIEW_CONFIGURATION_INVALID")
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const rows = (value) => Array.isArray(value) ? value : []

async function loadState() {
  const [attemptResult, revisionResult, planResult, positionsResult,
    jobsResult, authorizationsResult, extraordinaryEventsResult,
    successorEventsResult] = await Promise.all([
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,revision_id,status,composition_manifest_hash,provider_calls,max_provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_same_day_pilot_image_revisions")
      .select("id,strategy_version,revision_contract,product_dossier_hash,main_source_hash,side_source_hash,listing_package_id,created_by")
      .eq("id", REVISION_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_extraordinary_replacement_plans")
      .select("*").eq("id", PLAN_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_extraordinary_replacement_positions")
      .select("*").eq("correction_plan_id", PLAN_ID).order("position"),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,status,provider_request_id,provider_call_started_at,provider_call_completed_at,output_storage_path,output_sha256,qa_result,error_code,lease_owner,lease_expires_at")
      .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
    supabase.from("ebay_reference_guided_extraordinary_authorization_events")
      .select("*").eq("correction_plan_id", PLAN_ID),
    supabase.from("ebay_reference_guided_extraordinary_provider_events")
      .select("*").eq("correction_plan_id", PLAN_ID),
    supabase.from("ebay_reference_guided_successor_provider_events")
      .select("id,event_type,authorization_event_id")
      .eq("attempt_id", ATTEMPT_ID),
  ])
  const results = [attemptResult, revisionResult, planResult, positionsResult,
    jobsResult, authorizationsResult, extraordinaryEventsResult, successorEventsResult]
  if (results.some((result) => result.error) || !attemptResult.data ||
    !revisionResult.data || !planResult.data || jobsResult.data?.length !== 6 ||
    positionsResult.data?.length !== 2) {
    throw new Error("EXTRAORDINARY_POSITION_4_STATE_LOAD_FAILED")
  }
  return { attempt: attemptResult.data, revision: revisionResult.data,
    plan: planResult.data, positions: positionsResult.data,
    jobs: jobsResult.data, authorizations: authorizationsResult.data ?? [],
    events: extraordinaryEventsResult.data ?? [],
    successorEvents: successorEventsResult.data ?? [] }
}

function activeReservations(events, idKey = "authorization_event_id") {
  return events.filter((event) => event.event_type === "CONSUMED" &&
    !events.some((terminal) => terminal[idKey] === event[idKey] &&
      ["OUTPUT_PERSISTED", "FAILED_FINAL"].includes(terminal.event_type))).length
}

function assertPreflight(state) {
  const p4 = state.positions.find((position) => Number(position.position) === 4)
  const p6 = state.positions.find((position) => Number(position.position) === 6)
  const j4 = state.jobs.find((job) => Number(job.position) === 4)
  const j6 = state.jobs.find((job) => Number(job.position) === 6)
  const passed = state.jobs.filter((job) => [2, 3, 5].includes(Number(job.position)))
  if (state.attempt.id !== ATTEMPT_ID || state.attempt.revision_id !== REVISION_ID ||
    state.attempt.status !== "GENERATING" || Number(state.attempt.provider_calls) !== 6 ||
    Number(state.attempt.max_provider_calls) !== 6 || state.attempt.retry_consumed ||
    Number(state.attempt.ebay_writes) !== 0 || state.attempt.production_changed ||
    state.revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
    state.revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
    state.revision.main_source_hash !== MAIN_SHA256 ||
    state.revision.side_source_hash !== SIDE_SHA256 ||
    state.plan.id !== PLAN_ID || state.plan.plan_hash !== PLAN_HASH ||
    sha256(Buffer.from(state.plan.plan_text, "utf8")) !== PLAN_HASH ||
    Number(state.plan.absolute_cap) !== 8 || Number(state.plan.max_concurrency) !== 1 ||
    state.plan.automatic_retries || state.plan.feature_flags_enabled ||
    state.authorizations.length !== 0 || state.events.length !== 0 ||
    !p4 || p4.extraordinary_ordinal !== 7 || p4.amendment_id !== AMENDMENT_ID ||
    p4.amendment_hash !== AMENDMENT_HASH ||
    p4.final_effective_contract_hash !== CONTRACT_HASH ||
    p4.final_effective_prompt_hash !== PROMPT_HASH ||
    sha256(Buffer.from(p4.final_effective_prompt_text, "utf8")) !== PROMPT_HASH ||
    p4.authorization_state !== "READY_FOR_SEPARATE_HUMAN_AUTHORIZATION" ||
    !p6 || p6.extraordinary_ordinal !== 8 ||
    p6.authorization_state !== "BLOCKED_UNTIL_POSITION_4_PASSED" ||
    !p6.requires_position_4_passed || !j4 || j4.status !== "BLOCKED_FIDELITY" ||
    j4.output_sha256 !== "988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123" ||
    !j6 || j6.status !== "BLOCKED_FIDELITY" ||
    j6.output_sha256 !== "0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14" ||
    passed.length !== 3 || passed.some((job) => job.status !== "PASSED") ||
    state.jobs.some((job) => job.lease_owner != null || job.lease_expires_at != null) ||
    activeReservations(state.events) !== 0 ||
    activeReservations(state.successorEvents) !== 0) {
    throw new Error("EXTRAORDINARY_POSITION_4_PREFLIGHT_FAILED")
  }
}

function semanticQa(technicalQa) {
  const human = "REQUIRES_HUMAN_CONFIRMATION"
  return {
    automaticStatus: "HUMAN_REVIEW_REQUIRED",
    evaluatorVersion: "EXTRAORDINARY_POSITION_4_FIDELITY_QA_V1_2026_07_22",
    batchPlanHash: PLAN_HASH,
    amendmentHash: AMENDMENT_HASH,
    effectiveContractHash: CONTRACT_HASH,
    effectivePromptHash: PROMPT_HASH,
    technicalChecks: technicalQa.technicalChecks,
    runningWaterCheck: human,
    handsOrHumanPartsCheck: human,
    strawberryCountCheck: human,
    productDeformationCheck: human,
    textOrLogoCheck: human,
    productIdentityChecks: {
      exactCompleteProduct: human, exactTwoHandles: human,
      handleGeometryAndAttachment: human, continuousMetalRim: human,
      raisedBaseAndLowerRing: human, exactPerforationPattern: human,
      whiteEnamelFinish: human, proportions: human,
    },
    humanApprovalRequired: true,
    autoApproved: false,
    publicationAuthorized: false,
  }
}

const before = await loadState()
assertPreflight(before)
const unchangedPassed = JSON.stringify(before.jobs.filter((job) =>
  [1, 2, 3, 5].includes(Number(job.position))))
const unchangedPosition6 = JSON.stringify(before.jobs.find((job) =>
  Number(job.position) === 6))

const auth = await supabase.rpc(
  "authorize_ebay_reference_guided_extraordinary_replacement", {
    p_attempt_id: ATTEMPT_ID, p_position: 4,
    p_human_authorized_by: before.plan.created_by,
  })
if (auth.error || rows(auth.data).length !== 1) {
  throw new Error(`EXTRAORDINARY_POSITION_4_AUTHORIZATION_FAILED:${auth.error?.message ?? "UNKNOWN"}`)
}
const authorization = auth.data[0]
if (authorization.authorized_position !== 4 ||
  Number(authorization.extraordinary_ordinal) !== 7 || authorization.reused) {
  throw new Error("EXTRAORDINARY_POSITION_4_AUTHORIZATION_RESULT_INVALID")
}
const authRowResult = await supabase.from(
  "ebay_reference_guided_extraordinary_authorization_events")
  .select("id,human_confirmation_hash").eq("id", authorization.authorization_id)
  .maybeSingle()
if (authRowResult.error || !authRowResult.data) {
  throw new Error("EXTRAORDINARY_POSITION_4_AUTHORIZATION_EVIDENCE_MISSING")
}

const disabled = await supabase.rpc(
  "consume_ebay_reference_guided_extraordinary_position_4", {
    p_correction_plan_id: PLAN_ID,
    p_authorization_event_id: authorization.authorization_id,
    p_human_confirmation_hash: authRowResult.data.human_confirmation_hash,
    p_lease_owner: `extraordinary-position-4-disabled:${randomUUID()}`,
    p_feature_enabled: false,
  })
if (!disabled.error) throw new Error("EXTRAORDINARY_POSITION_4_DISABLED_GATE_FAILED")

const bindingResult = await supabase.from("luna_catalog_source_pack_dossier_bindings")
  .select("source_pack_id").eq("listing_package_id", before.revision.listing_package_id)
  .eq("dossier_hash", before.revision.product_dossier_hash)
  .eq("policy_version", "REFERENCE_GUIDED_PRODUCT_GENERATION_V1")
  .order("verified_at", { ascending: false }).limit(1).maybeSingle()
if (bindingResult.error || !bindingResult.data) {
  throw new Error("EXTRAORDINARY_POSITION_4_SOURCE_BINDING_MISSING")
}
const packResult = await supabase.from("luna_catalog_authorized_source_packs")
  .select("source_assets").eq("id", bindingResult.data.source_pack_id).maybeSingle()
if (packResult.error || !packResult.data) {
  throw new Error("EXTRAORDINARY_POSITION_4_SOURCE_PACK_MISSING")
}
const mainAsset = rows(packResult.data.source_assets).find((asset) =>
  asset.sourceImageId === "MAIN" && asset.sha256 === MAIN_SHA256 &&
  asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
const sideAsset = rows(packResult.data.source_assets).find((asset) =>
  asset.sourceImageId === "SIDE" && asset.sha256 === SIDE_SHA256 &&
  asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
if (!mainAsset?.storagePath || !sideAsset?.storagePath) {
  throw new Error("EXTRAORDINARY_POSITION_4_PROTECTED_SOURCES_INVALID")
}
const [mainDownload, sideDownload] = await Promise.all([
  supabase.storage.from("ebay-listing-image-sources").download(mainAsset.storagePath),
  supabase.storage.from("ebay-listing-image-sources").download(sideAsset.storagePath),
])
if (mainDownload.error || sideDownload.error || !mainDownload.data || !sideDownload.data) {
  throw new Error("EXTRAORDINARY_POSITION_4_SOURCE_DOWNLOAD_FAILED")
}
const main = Buffer.from(await mainDownload.data.arrayBuffer())
const side = Buffer.from(await sideDownload.data.arrayBuffer())
if (sha256(main) !== MAIN_SHA256 || sha256(side) !== SIDE_SHA256) {
  throw new Error("EXTRAORDINARY_POSITION_4_SOURCE_BYTES_MISMATCH")
}

const leaseOwner = `extraordinary-position-4:${randomUUID()}`
let consumedEventId = null
let jobId = null
let httpStatus = null
let providerRequestId = null
let outputSha256 = null
let outputStoragePath = null
let automaticQa = null
let providerFetches = 0
let budgetConsumed = false
let outputUploaded = false
try {
  const consumed = await supabase.rpc(
    "consume_ebay_reference_guided_extraordinary_position_4", {
      p_correction_plan_id: PLAN_ID,
      p_authorization_event_id: authorization.authorization_id,
      p_human_confirmation_hash: authRowResult.data.human_confirmation_hash,
      p_lease_owner: leaseOwner, p_feature_enabled: true,
    })
  if (consumed.error || rows(consumed.data).length !== 1) {
    throw new Error(`EXTRAORDINARY_POSITION_4_ATOMIC_RESERVATION_FAILED:${consumed.error?.message ?? "UNKNOWN"}`)
  }
  const reserved = consumed.data[0]
  consumedEventId = reserved.consumed_event_id
  jobId = reserved.job_id
  budgetConsumed = Number(reserved.provider_calls) === 7
  if (!budgetConsumed || reserved.batch_plan_hash !== PLAN_HASH ||
    reserved.amendment_id !== AMENDMENT_ID || reserved.amendment_hash !== AMENDMENT_HASH ||
    reserved.effective_contract_hash !== CONTRACT_HASH ||
    reserved.exact_prompt_hash !== PROMPT_HASH ||
    sha256(Buffer.from(reserved.exact_prompt_text, "utf8")) !== PROMPT_HASH ||
    reserved.main_source_hash !== MAIN_SHA256 || reserved.side_source_hash !== SIDE_SHA256 ||
    reserved.main_storage_path !== mainAsset.storagePath ||
    reserved.side_storage_path !== sideAsset.storagePath) {
    throw new Error("EXTRAORDINARY_POSITION_4_RESERVATION_RESULT_INVALID")
  }
  const providerPlan = {
    version: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1", model: "gpt-image-2",
    size: "1600x1600", quality: "high", outputFormat: "png",
    productBytesSentToProvider: true, competitorImagesSentToProvider: false,
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
      throw new Error("EXTRAORDINARY_POSITION_4_HTTP_BUDGET_EXCEEDED")
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
    plan: providerPlan, main, side, apiKey, fetchImpl: fetchOnce,
    shouldContinue: () => providerFetches === 0 &&
      process.env[FEATURE_FLAG] === "true",
  })
  const output = outputs[0]
  providerRequestId = providerRequestId || output.providerRequestId
  if (!providerRequestId) throw new Error("EXTRAORDINARY_POSITION_4_REQUEST_ID_MISSING")
  outputSha256 = output.outputSha256
  outputStoragePath = `${before.revision.created_by}/reference-guided-extraordinary/${ATTEMPT_ID}/position-4/ordinal-7/${PLAN_HASH}/${outputSha256}.png`
  const persisted = await persistReferenceGuidedCanaryPng({
    supabase, output: output.output, expectedSha256: outputSha256,
    storagePath: outputStoragePath,
  })
  outputUploaded = persisted.uploaded === true
  if (!outputUploaded || !persisted.downloaded || !persisted.hashMatch) {
    throw new Error("EXTRAORDINARY_POSITION_4_STORAGE_ROUNDTRIP_FAILED")
  }
  automaticQa = semanticQa(persisted.qaResult)
  const completed = await supabase.rpc(
    "complete_ebay_reference_guided_extraordinary_position_4", {
      p_authorization_event_id: authorization.authorization_id,
      p_consumed_event_id: consumedEventId, p_job_id: jobId,
      p_lease_owner: leaseOwner, p_http_status: httpStatus,
      p_provider_request_id: providerRequestId,
      p_output_storage_path: outputStoragePath,
      p_output_sha256: outputSha256, p_qa_result: automaticQa,
    })
  if (completed.error || completed.data?.status !== "QA_PENDING") {
    throw new Error(`EXTRAORDINARY_POSITION_4_COMPLETION_FAILED:${completed.error?.message ?? "UNKNOWN"}`)
  }
  output.output.fill(0)
} catch (error) {
  process.env[FEATURE_FLAG] = "false"
  if (budgetConsumed && consumedEventId && jobId) {
    const code = (error instanceof Error ? error.message : "EXTRAORDINARY_POSITION_4_FAILED")
      .match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0] ?? "EXTRAORDINARY_POSITION_4_FAILED"
    const failed = await supabase.rpc(
      "fail_ebay_reference_guided_extraordinary_position_4", {
        p_authorization_event_id: authorization.authorization_id,
        p_consumed_event_id: consumedEventId, p_job_id: jobId,
        p_lease_owner: leaseOwner, p_http_status: httpStatus,
        p_provider_request_id: providerRequestId ?? "", p_error_code: code,
        p_output_storage_path: outputUploaded ? outputStoragePath : null,
        p_output_sha256: outputUploaded ? outputSha256 : null,
      })
    if (failed.error) throw new Error(`${code}:FAILURE_RECORD_FAILED:${failed.error.message}`)
  }
  throw error
} finally {
  process.env[FEATURE_FLAG] = "false"
  main.fill(0)
  side.fill(0)
}

const after = await loadState()
const position4 = after.jobs.find((job) => Number(job.position) === 4)
const passedUnchanged = JSON.stringify(after.jobs.filter((job) =>
  [1, 2, 3, 5].includes(Number(job.position)))) === unchangedPassed
const position6Unchanged = JSON.stringify(after.jobs.find((job) =>
  Number(job.position) === 6)) === unchangedPosition6
const activeLeases = after.jobs.filter((job) =>
  job.lease_owner != null || job.lease_expires_at != null).length
if (providerFetches !== 1 || Number(after.attempt.provider_calls) !== 7 ||
  Number(after.attempt.max_provider_calls) !== 8 || position4?.status !== "QA_PENDING" ||
  position4.output_sha256 !== outputSha256 ||
  position4.output_storage_path !== outputStoragePath ||
  position4.provider_request_id !== providerRequestId || !passedUnchanged ||
  !position6Unchanged || activeLeases !== 0 || process.env[FEATURE_FLAG] !== "false") {
  throw new Error("EXTRAORDINARY_POSITION_4_POSTCONDITION_FAILED")
}
const signed = await supabase.storage.from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
  .createSignedUrl(outputStoragePath, 300)
if (signed.error || !signed.data?.signedUrl) {
  throw new Error("EXTRAORDINARY_POSITION_4_SIGNED_PREVIEW_FAILED")
}

export const executionResult = {
  position4ExtraordinaryOrdinalBound: true,
  position4AuthorizationConsumed: true,
  position4ProviderCallStarted: true,
  providerCalls: 7, httpStatus, providerRequestId,
  outputPersisted: true, outputDimensions: "1600x1600", outputSha256,
  privateStoragePath: outputStoragePath, storageRoundtrip: true,
  persistedBatchPlanHash: PLAN_HASH, persistedAmendmentHash: AMENDMENT_HASH,
  persistedEffectiveContractHash: CONTRACT_HASH,
  persistedEffectivePromptHash: PROMPT_HASH,
  automaticQaStatus: automaticQa.automaticStatus,
  runningWaterCheck: automaticQa.runningWaterCheck,
  handsOrHumanPartsCheck: automaticQa.handsOrHumanPartsCheck,
  strawberryCountCheck: automaticQa.strawberryCountCheck,
  productDeformationCheck: automaticQa.productDeformationCheck,
  productIdentityChecks: automaticQa.productIdentityChecks,
  textOrLogoCheck: automaticQa.textOrLogoCheck,
  automaticRetryOccurred: false, featureFlagDisabledAfterRun: true,
  position6Unchanged, passedAssetsUnchanged: passedUnchanged,
  activeLeases, providerReservationsCreated: 1,
  ebayWrites: 0, productionChanged: false,
  readyForPosition4HumanReview: true,
}
console.log(JSON.stringify(executionResult))
