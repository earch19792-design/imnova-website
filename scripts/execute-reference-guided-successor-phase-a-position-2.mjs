import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

import { createDeterministicPackageContents } from
  "../lib/ebay/reference-guided-deterministic-package-contents.ts"
import { persistDeterministicPositionOneCrop } from
  "../lib/ebay/reference-guided-deterministic-source-crop.ts"

const PLAN_ID = "c54a0bbc-b16c-47b3-8f4e-93d2152e3b34"
const PLAN_HASH = "a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7"
const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const SIDE_SHA256 = "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21"
const SIDE_STORAGE_PATH = "75c9d5d5-03d2-478e-8999-714ba84ee994/catalog-source-packs/content-addressed/f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21-native.jpg"
const AUTHORIZATION_HASH = createHash("sha256").update(Buffer.from(
  `AUTHORIZE_PHASE_A|${PLAN_ID}|${PLAN_HASH}|POSITION=2|ASSET_ROLE=SECONDARY_PACKAGE_CONTENTS|MODE=DETERMINISTIC`,
  "utf8")).digest("hex")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("PHASE_A_REQUIRES_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function loadState() {
  const [{ data: plan, error: planError },
    { data: position, error: positionError },
    { data: attempt, error: attemptError },
    { data: revision, error: revisionError },
    { data: jobs, error: jobsError },
    { data: selection, error: selectionError },
    { data: asset, error: assetError }] = await Promise.all([
    supabase.from("ebay_reference_guided_batch_plan_successors_v2")
      .select("*").eq("id", PLAN_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_batch_plan_successor_positions_v2")
      .select("*").eq("successor_plan_id", PLAN_ID).eq("position", 2)
      .maybeSingle(),
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,revision_id,status,provider_calls,max_provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_same_day_pilot_image_revisions")
      .select("id,strategy_version,revision_contract,side_source_hash")
      .eq("id", REVISION_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,commercial_role,status,provider_request_id,provider_call_started_at,provider_call_completed_at,output_storage_path,output_sha256,qa_result,error_code,lease_owner,lease_expires_at")
      .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
    supabase.from("ebay_reference_guided_final_asset_selection_events")
      .select("*").eq("attempt_id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_phase_a_position_2_assets")
      .select("*").eq("successor_plan_id", PLAN_ID).maybeSingle(),
  ])
  if (planError || positionError || attemptError || revisionError || jobsError ||
    selectionError || assetError || !plan || !position || !attempt || !revision ||
    !selection || jobs?.length !== 6) {
    throw new Error("PHASE_A_STATE_LOAD_FAILED")
  }
  return { plan, position, attempt, revision, jobs, selection, asset }
}

function assertCommon(state) {
  if (state.plan.plan_hash !== PLAN_HASH || state.plan.attempt_id !== ATTEMPT_ID ||
    state.plan.revision_id !== REVISION_ID ||
    state.plan.status !== "AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION" ||
    state.position.asset_role !== "SECONDARY_PACKAGE_CONTENTS" ||
    state.position.commercial_objective !== "CONFIRMED_PACKAGE_CONTENTS" ||
    state.position.execution_mode !== "DETERMINISTIC" ||
    Number(state.position.planned_provider_calls) !== 0 ||
    state.attempt.revision_id !== REVISION_ID ||
    Number(state.attempt.provider_calls) !== 2 ||
    Number(state.attempt.max_provider_calls) !== 6 ||
    state.attempt.retry_consumed !== false ||
    Number(state.attempt.ebay_writes) !== 0 ||
    state.attempt.production_changed !== false ||
    state.revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
    state.revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
    state.revision.side_source_hash !== SIDE_SHA256 ||
    state.selection.primary_verdict !== "APPROVED" ||
    state.selection.material_detail_verdict !== "APPROVED") {
    throw new Error("PHASE_A_COMMON_PREFLIGHT_FAILED")
  }
}

function assertBefore(state) {
  assertCommon(state)
  const position2 = state.jobs.find((job) => job.position === 2)
  if (!position2 || position2.commercial_role !== "CONFIRMED_PACKAGE_CONTENTS" ||
    position2.status !== "PENDING" || position2.lease_owner != null ||
    position2.lease_expires_at != null || position2.provider_request_id != null ||
    position2.provider_call_started_at != null ||
    position2.provider_call_completed_at != null ||
    position2.output_storage_path != null || position2.output_sha256 != null ||
    state.jobs.filter((job) => job.position >= 3).some((job) =>
      job.status !== "PENDING" || job.lease_owner != null ||
      job.lease_expires_at != null || job.provider_request_id != null ||
      job.provider_call_started_at != null ||
      job.provider_call_completed_at != null ||
      job.output_storage_path != null || job.output_sha256 != null)) {
    throw new Error("PHASE_A_EXECUTION_PREFLIGHT_FAILED")
  }
  return position2
}

function summary(asset, signedPreviewCreated, reused) {
  return { position2Created: true, reused,
    outputSha256: asset.output_sha256, storagePath: asset.output_storage_path,
    storageRoundtrip: true,
    outputDimensions: `${asset.output_width}x${asset.output_height}`,
    backgroundPureWhite: asset.qa_result.backgroundPureWhite,
    singleCompleteUnit: asset.qa_result.singleCompleteUnit,
    safeMargins: asset.qa_result.safeMargins,
    clippingDetected: asset.qa_result.clippingDetected,
    textDetected: asset.qa_result.textDetected,
    transformManifestHash: asset.transform_manifest_hash,
    position2Status: asset.status, signedPreviewCreated,
    positions0And1Unchanged: true, positions3To6Unchanged: true,
    providerCalls: 2, activeLeases: 0, providerReservationsCreated: 0,
    providerCallsThisRun: 0, ebayWrites: 0, productionChanged: false }
}

const before = await loadState()
assertCommon(before)
if (before.asset) {
  const signed = await supabase.storage.from("ebay-listing-image-staging")
    .createSignedUrl(before.asset.output_storage_path, 300)
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("PHASE_A_SIGNED_PREVIEW_FAILED")
  }
  console.log(JSON.stringify(summary(before.asset, true, true)))
  process.exit(0)
}
const position2 = assertBefore(before)
const sourceDownload = await supabase.storage
  .from("ebay-listing-image-sources").download(SIDE_STORAGE_PATH)
if (sourceDownload.error || !sourceDownload.data) {
  throw new Error("PHASE_A_PROTECTED_SIDE_DOWNLOAD_FAILED")
}
const source = Buffer.from(await sourceDownload.data.arrayBuffer())
const result = await createDeterministicPackageContents({ planId: PLAN_ID,
  planHash: PLAN_HASH, attemptId: ATTEMPT_ID, revisionId: REVISION_ID,
  jobId: position2.id, source, sourceSha256: SIDE_SHA256,
  sourceStoragePath: SIDE_STORAGE_PATH })
const storagePath = `75c9d5d5-03d2-478e-8999-714ba84ee994/reference-guided-deterministic/${ATTEMPT_ID}/phase-a-position-2/${result.transformManifestHash}/${result.outputSha256}.png`
const roundtrip = await persistDeterministicPositionOneCrop({ supabase,
  output: result.output, outputSha256: result.outputSha256, storagePath })
try {
  const recorded = await supabase.rpc(
    "record_ebay_reference_guided_phase_a_position_2", {
      p_plan_id: PLAN_ID, p_plan_hash: PLAN_HASH,
      p_authorization_hash: AUTHORIZATION_HASH,
      p_source_sha256: SIDE_SHA256,
      p_source_storage_path: SIDE_STORAGE_PATH,
      p_output_storage_path: storagePath,
      p_output_sha256: result.outputSha256,
      p_transform_manifest_text: result.transformManifestText,
      p_transform_manifest_hash: result.transformManifestHash,
      p_qa_result: result.qa,
    })
  if (recorded.error || !recorded.data) {
    throw new Error(`PHASE_A_RECORD_FAILED:${recorded.error?.message ?? "UNKNOWN"}`)
  }
} catch (error) {
  await supabase.storage.from("ebay-listing-image-staging")
    .remove([storagePath])
  throw error
}
const after = await loadState()
assertCommon(after)
if (!after.asset || after.asset.output_sha256 !== result.outputSha256 ||
  after.asset.transform_manifest_hash !== result.transformManifestHash ||
  after.asset.status !== "HUMAN_REVIEW_REQUIRED" ||
  after.jobs.find((job) => job.position === 2)?.status !== "QA_PENDING" ||
  JSON.stringify(before.jobs.find((job) => job.position === 1)) !==
    JSON.stringify(after.jobs.find((job) => job.position === 1)) ||
  JSON.stringify(before.jobs.filter((job) => job.position >= 3)) !==
    JSON.stringify(after.jobs.filter((job) => job.position >= 3)) ||
  JSON.stringify(before.selection) !== JSON.stringify(after.selection) ||
  Number(after.attempt.provider_calls) !== 2 ||
  after.jobs.some((job) => job.lease_owner != null ||
    job.lease_expires_at != null)) {
  throw new Error("PHASE_A_POSTCONDITION_FAILED")
}
const signed = await supabase.storage.from("ebay-listing-image-staging")
  .createSignedUrl(storagePath, 300)
if (signed.error || !signed.data?.signedUrl) {
  throw new Error("PHASE_A_SIGNED_PREVIEW_FAILED")
}
console.log(JSON.stringify({ ...summary(after.asset, true, false),
  storageRoundtrip: roundtrip.roundtrip,
  outputDimensions: roundtrip.dimensions }))
source.fill(0)
result.output.fill(0)
