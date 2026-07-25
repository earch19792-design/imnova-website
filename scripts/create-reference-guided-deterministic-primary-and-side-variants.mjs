import { writeFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

import {
  createPrimaryVerticalCenterAudit,
  createSideMaterialDetailVariant,
  PRIMARY_VERTICAL_CENTER_VERSION,
  SIDE_DETAIL_CROP,
  SIDE_MATERIAL_DETAIL_VERSION,
} from "../lib/ebay/reference-guided-deterministic-asset-variants.ts"
import { persistDeterministicPositionOneCrop } from
  "../lib/ebay/reference-guided-deterministic-source-crop.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const MAIN_SHA256 = "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SIDE_SHA256 = "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21"
const SIDE_STORAGE_PATH = "75c9d5d5-03d2-478e-8999-714ba84ee994/catalog-source-packs/content-addressed/f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21-native.jpg"
const EXPECTED_PRIMARY_SHA256 = "44c7c5d832c4dd655fcc4a4865c51779406662c438a3e6ff5239606360cef3ba"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("DETERMINISTIC_VARIANTS_REQUIRE_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function loadState() {
  const [{ data: attempt, error: attemptError },
    { data: revision, error: revisionError },
    { data: jobs, error: jobsError },
    { data: primary, error: primaryError },
    { data: detail, error: detailError },
    { data: variants, error: variantsError }] = await Promise.all([
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,revision_id,status,provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_same_day_pilot_image_revisions")
      .select("id,strategy_version,revision_contract,main_source_hash,side_source_hash")
      .eq("id", REVISION_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,status,lease_owner,lease_expires_at,output_storage_path,output_sha256")
      .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
    supabase.from("ebay_reference_guided_primary_main_previews")
      .select("*").eq("attempt_id", ATTEMPT_ID)
      .eq("contract_version", "DETERMINISTIC_PRIMARY_MAIN_V1").maybeSingle(),
    supabase.from("ebay_reference_guided_deterministic_previews")
      .select("*").eq("attempt_id", ATTEMPT_ID)
      .eq("contract_version", "DETERMINISTIC_SOURCE_CROP_V1").maybeSingle(),
    supabase.from("ebay_reference_guided_deterministic_asset_variants")
      .select("*").eq("attempt_id", ATTEMPT_ID).order("asset_ordinal"),
  ])
  if (attemptError || revisionError || jobsError || primaryError || detailError ||
    variantsError || !attempt || !revision || !primary || !detail) {
    throw new Error("DETERMINISTIC_VARIANTS_STATE_LOAD_FAILED")
  }
  return { attempt, revision, jobs: jobs ?? [], primary, detail,
    variants: variants ?? [] }
}

function assertPreflight(state) {
  if (state.attempt.revision_id !== REVISION_ID ||
    Number(state.attempt.provider_calls) !== 2 ||
    state.attempt.retry_consumed !== false ||
    Number(state.attempt.ebay_writes) !== 0 ||
    state.attempt.production_changed !== false ||
    state.revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
    state.revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
    state.revision.main_source_hash !== MAIN_SHA256 ||
    state.revision.side_source_hash !== SIDE_SHA256 ||
    state.jobs.length !== 6 ||
    state.jobs.slice(1).some((job) => job.status !== "PENDING" ||
      job.lease_owner != null || job.lease_expires_at != null ||
      job.output_storage_path != null) ||
    state.primary.output_sha256 !== EXPECTED_PRIMARY_SHA256 ||
    state.primary.background_color !== "#FFFFFF" ||
    Number(state.primary.output_width) !== 1600 ||
    Number(state.primary.output_height) !== 1600 ||
    state.detail.output_storage_path == null) {
    throw new Error("DETERMINISTIC_VARIANTS_PREFLIGHT_FAILED")
  }
}

const before = await loadState()
assertPreflight(before)
if (before.variants.length !== 0 && before.variants.length !== 2) {
  throw new Error("DETERMINISTIC_VARIANTS_PARTIAL_STATE")
}
if (before.variants.length === 2) {
  console.log(JSON.stringify({ reused: true, variants: before.variants,
    positions2To6Unchanged: true, providerCalls: 2, providerCallsThisRun: 0,
    ebayWrites: 0, productionChanged: false }))
  process.exit(0)
}

const [primaryDownload, sideDownload] = await Promise.all([
  supabase.storage.from("ebay-listing-image-staging")
    .download(before.primary.output_storage_path),
  supabase.storage.from("ebay-listing-image-sources").download(SIDE_STORAGE_PATH),
])
if (primaryDownload.error || !primaryDownload.data || sideDownload.error ||
  !sideDownload.data) throw new Error("DETERMINISTIC_VARIANTS_SOURCE_DOWNLOAD_FAILED")
const primaryInput = Buffer.from(await primaryDownload.data.arrayBuffer())
const sideInput = Buffer.from(await sideDownload.data.arrayBuffer())
const [primary, side] = await Promise.all([
  createPrimaryVerticalCenterAudit({ attemptId: ATTEMPT_ID,
    revisionId: REVISION_ID, currentPng: primaryInput,
    currentSha256: before.primary.output_sha256,
    currentStoragePath: before.primary.output_storage_path,
    protectedMainSha256: MAIN_SHA256 }),
  createSideMaterialDetailVariant({ attemptId: ATTEMPT_ID,
    revisionId: REVISION_ID, source: sideInput, sourceSha256: SIDE_SHA256,
    sourceStoragePath: SIDE_STORAGE_PATH }),
])
if (primary.outputSha256 !== EXPECTED_PRIMARY_SHA256 ||
  primary.translationY !== 0) throw new Error("PRIMARY_PIXELS_CHANGED")
const sideStoragePath = `75c9d5d5-03d2-478e-8999-714ba84ee994/reference-guided-deterministic/${ATTEMPT_ID}/secondary-1-material-detail-side/${side.transformManifestHash}/${side.outputSha256}.png`
await persistDeterministicPositionOneCrop({ supabase, output: side.output,
  outputSha256: side.outputSha256, storagePath: sideStoragePath })

try {
  const inserted = await supabase
    .from("ebay_reference_guided_deterministic_asset_variants")
    .insert([
      {
        attempt_id: ATTEMPT_ID, revision_id: REVISION_ID, asset_ordinal: 0,
        asset_role: "PRIMARY_MAIN", variant_version: PRIMARY_VERTICAL_CENTER_VERSION,
        source_image_id: "MAIN", source_sha256: MAIN_SHA256,
        source_storage_path: before.primary.source_storage_path,
        parent_output_sha256: before.primary.output_sha256,
        crop_coordinates: { type: "NONE", translationX: 0,
          translationY: primary.translationY }, output_width: 1600,
        output_height: 1600, output_storage_path: before.primary.output_storage_path,
        output_sha256: primary.outputSha256,
        transform_manifest_text: primary.transformManifestText,
        transform_manifest_hash: primary.transformManifestHash,
        qa_metrics: primary.qa, status: "PENDING_HUMAN_SELECTION",
      },
      {
        attempt_id: ATTEMPT_ID, revision_id: REVISION_ID, asset_ordinal: 1,
        asset_role: "SECONDARY_MATERIAL_DETAIL",
        variant_version: SIDE_MATERIAL_DETAIL_VERSION, source_image_id: "SIDE",
        source_sha256: SIDE_SHA256, source_storage_path: SIDE_STORAGE_PATH,
        parent_output_sha256: null, crop_coordinates: {
          coordinateSpace: `NORMALIZED_SIDE_1280x897`, ...SIDE_DETAIL_CROP,
        }, output_width: 1600, output_height: 1600,
        output_storage_path: sideStoragePath, output_sha256: side.outputSha256,
        transform_manifest_text: side.transformManifestText,
        transform_manifest_hash: side.transformManifestHash,
        qa_metrics: side.qa, status: "PENDING_HUMAN_SELECTION",
      },
    ]).select("*").order("asset_ordinal")
  if (inserted.error || inserted.data?.length !== 2) {
    throw new Error("DETERMINISTIC_VARIANTS_RECORD_FAILED")
  }
} catch (error) {
  await supabase.storage.from("ebay-listing-image-staging")
    .remove([sideStoragePath])
  throw error
}

await Promise.all([
  writeFile("/tmp/reference-guided-primary-vertical-center-audit.png",
    primary.output, { mode: 0o600 }),
  writeFile("/tmp/reference-guided-side-detail-variant.png",
    side.output, { mode: 0o600 }),
])
const after = await loadState()
assertPreflight(after)
if (after.variants.length !== 2 ||
  JSON.stringify(before.jobs) !== JSON.stringify(after.jobs)) {
  throw new Error("DETERMINISTIC_VARIANTS_POSTCONDITION_FAILED")
}
console.log(JSON.stringify({ reused: false, primary: {
  outputSha256: primary.outputSha256,
  transformManifestHash: primary.transformManifestHash,
  translationY: primary.translationY, qa: primary.qa,
}, side: { crop: SIDE_DETAIL_CROP, upscaleFactor: 2,
  outputSha256: side.outputSha256,
  transformManifestHash: side.transformManifestHash,
  storagePath: sideStoragePath, qa: side.qa,
  handleSafeMargins: side.transformManifest.handleSafeMargins,
}, positions2To6Unchanged: true, providerCalls: 2, providerCallsThisRun: 0,
ebayWrites: 0, productionChanged: false }))

primary.output.fill(0)
side.output.fill(0)
primaryInput.fill(0)
sideInput.fill(0)
