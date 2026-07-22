import { writeFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

import {
  createDeterministicPositionOneCrop,
  persistDeterministicPositionOneCrop,
  POSITION_ONE_CROP,
} from "../lib/ebay/reference-guided-deterministic-source-crop.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const JOB_ID = "6076325e-4fe8-4d41-b9e6-7ea255a58a1f"
const SOURCE_SHA256 = "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SOURCE_STORAGE_PATH = "75c9d5d5-03d2-478e-8999-714ba84ee994/catalog-source-packs/content-addressed/3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1-native.jpg"
const ORIGINAL_OUTPUT_SHA256 = "cc0ef29aba4ea671d64811bd5126c3a6c9d387028e330f88330de3fc9fc8aa20"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const [{ data: attempt, error: attemptError }, { data: jobs, error: jobsError },
  { data: existing, error: existingError }] = await Promise.all([
  supabase.from("ebay_reference_guided_generation_attempts")
    .select("id,revision_id,provider_calls,retry_consumed,ebay_writes,production_changed")
    .eq("id", ATTEMPT_ID).maybeSingle(),
  supabase.from("ebay_reference_guided_generation_jobs")
    .select("id,position,status,lease_owner,lease_expires_at,commercial_role,output_storage_path,output_sha256")
    .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
  supabase.from("ebay_reference_guided_deterministic_previews")
    .select("*").eq("attempt_id", ATTEMPT_ID).eq("job_id", JOB_ID)
    .eq("contract_version", "DETERMINISTIC_SOURCE_CROP_V1").maybeSingle(),
])
if (attemptError || jobsError || existingError || !attempt ||
  attempt.revision_id !== REVISION_ID || Number(attempt.provider_calls) !== 2 ||
  attempt.retry_consumed !== false || Number(attempt.ebay_writes) !== 0 ||
  attempt.production_changed !== false || jobs?.length !== 6 ||
  jobs[0]?.id !== JOB_ID || jobs[0]?.commercial_role !== "MATERIAL_AND_FINISH_DETAIL" ||
  !["QA_PENDING", "BLOCKED_FIDELITY"].includes(jobs[0]?.status) ||
  jobs[0]?.output_sha256 !== ORIGINAL_OUTPUT_SHA256 ||
  jobs.slice(1).some((job) => job.status !== "PENDING" || job.lease_owner != null ||
    job.lease_expires_at != null || job.output_storage_path != null)) {
  throw new Error("DETERMINISTIC_SOURCE_CROP_PREFLIGHT_FAILED")
}
if (existing) {
  console.log(JSON.stringify({ reused: true, preview: existing,
    providerCalls: 2, ebayWrites: 0, productionChanged: false }))
  process.exit(0)
}

const sourceDownload = await supabase.storage.from("ebay-listing-image-sources")
  .download(SOURCE_STORAGE_PATH)
if (sourceDownload.error || !sourceDownload.data) {
  throw new Error("DETERMINISTIC_SOURCE_CROP_SOURCE_DOWNLOAD_FAILED")
}
const source = Buffer.from(await sourceDownload.data.arrayBuffer())
const crop = await createDeterministicPositionOneCrop({
  attemptId: ATTEMPT_ID,
  revisionId: REVISION_ID,
  jobId: JOB_ID,
  source,
  sourceSha256: SOURCE_SHA256,
  sourceStoragePath: SOURCE_STORAGE_PATH,
  sourceNativeWidth: 1500,
  sourceNativeHeight: 905,
})
const storagePath = `75c9d5d5-03d2-478e-8999-714ba84ee994/reference-guided-deterministic/${ATTEMPT_ID}/secondary-1-material-detail/${crop.transformManifestHash}/${crop.outputSha256}.png`
await persistDeterministicPositionOneCrop({ supabase, output: crop.output,
  outputSha256: crop.outputSha256, storagePath })

let recorded
try {
  const result = await supabase.rpc(
    "record_ebay_reference_guided_position_1_rejection_and_crop",
    { p_attempt_id: ATTEMPT_ID, p_source_sha256: SOURCE_SHA256,
      p_source_storage_path: SOURCE_STORAGE_PATH,
      p_crop_left: POSITION_ONE_CROP.left, p_crop_top: POSITION_ONE_CROP.top,
      p_crop_width: POSITION_ONE_CROP.width, p_crop_height: POSITION_ONE_CROP.height,
      p_upscale_factor: crop.upscaleFactor, p_output_storage_path: storagePath,
      p_output_sha256: crop.outputSha256,
      p_transform_manifest_text: crop.transformManifestText,
      p_transform_manifest_hash: crop.transformManifestHash },
  )
  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "DETERMINISTIC_SOURCE_CROP_RECORD_FAILED")
  }
  recorded = result.data
} catch (error) {
  await supabase.storage.from("ebay-listing-image-staging").remove([storagePath])
  throw error
}
await writeFile("/tmp/reference-guided-deterministic-secondary-1.png", crop.output,
  { mode: 0o600 })
crop.output.fill(0)
source.fill(0)
console.log(JSON.stringify({ reused: false, preview: recorded,
  dimensions: "1600x1600", upscaleFactor: crop.upscaleFactor,
  transformManifestHash: crop.transformManifestHash,
  storageRoundtrip: true, providerCalls: 2, providerCallsThisRun: 0,
  ebayWrites: 0, productionChanged: false }))
