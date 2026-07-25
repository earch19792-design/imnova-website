import { writeFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

import {
  createDeterministicPrimaryMainPreview,
  persistDeterministicPositionOneCrop,
} from "../lib/ebay/reference-guided-deterministic-source-crop.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const SOURCE_SHA256 = "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1"
const SOURCE_STORAGE_PATH = "75c9d5d5-03d2-478e-8999-714ba84ee994/catalog-source-packs/content-addressed/3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1-native.jpg"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("DETERMINISTIC_PRIMARY_REQUIRES_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const [{ data: attempt, error: attemptError },
  { data: revision, error: revisionError },
  { data: existing, error: existingError }] = await Promise.all([
  supabase.from("ebay_reference_guided_generation_attempts")
    .select("id,revision_id,provider_calls,retry_consumed,ebay_writes,production_changed")
    .eq("id", ATTEMPT_ID).maybeSingle(),
  supabase.from("ebay_same_day_pilot_image_revisions")
    .select("id,strategy_version,revision_contract,main_source_hash")
    .eq("id", REVISION_ID).maybeSingle(),
  supabase.from("ebay_reference_guided_primary_main_previews")
    .select("*").eq("attempt_id", ATTEMPT_ID)
    .eq("contract_version", "DETERMINISTIC_PRIMARY_MAIN_V1").maybeSingle(),
])
if (attemptError || revisionError || existingError || !attempt || !revision ||
  attempt.revision_id !== REVISION_ID || Number(attempt.provider_calls) !== 2 ||
  attempt.retry_consumed !== false || Number(attempt.ebay_writes) !== 0 ||
  attempt.production_changed !== false ||
  revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
  revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
  revision.main_source_hash !== SOURCE_SHA256) {
  throw new Error("DETERMINISTIC_PRIMARY_PREFLIGHT_FAILED")
}
if (existing) {
  console.log(JSON.stringify({ reused: true, preview: existing,
    providerCalls: 2, providerCallsThisRun: 0, ebayWrites: 0,
    productionChanged: false }))
  process.exit(0)
}

const downloaded = await supabase.storage.from("ebay-listing-image-sources")
  .download(SOURCE_STORAGE_PATH)
if (downloaded.error || !downloaded.data) {
  throw new Error("DETERMINISTIC_PRIMARY_SOURCE_DOWNLOAD_FAILED")
}
const source = Buffer.from(await downloaded.data.arrayBuffer())
const primary = await createDeterministicPrimaryMainPreview({
  attemptId: ATTEMPT_ID,
  revisionId: REVISION_ID,
  source,
  sourceSha256: SOURCE_SHA256,
  sourceStoragePath: SOURCE_STORAGE_PATH,
})
const storagePath = `75c9d5d5-03d2-478e-8999-714ba84ee994/reference-guided-deterministic/${ATTEMPT_ID}/primary-main/${primary.transformManifestHash}/${primary.outputSha256}.png`
await persistDeterministicPositionOneCrop({ supabase, output: primary.output,
  outputSha256: primary.outputSha256, storagePath })

const insert = await supabase.from("ebay_reference_guided_primary_main_previews")
  .insert({
    attempt_id: ATTEMPT_ID,
    revision_id: REVISION_ID,
    asset_ordinal: 0,
    asset_role: "PRIMARY_MAIN",
    contract_version: "DETERMINISTIC_PRIMARY_MAIN_V1",
    source_image_id: "MAIN",
    source_sha256: SOURCE_SHA256,
    source_storage_path: SOURCE_STORAGE_PATH,
    safe_margin_pixels: 120,
    background_color: "#FFFFFF",
    output_width: 1600,
    output_height: 1600,
    output_storage_path: storagePath,
    output_sha256: primary.outputSha256,
    transform_manifest_text: primary.transformManifestText,
    transform_manifest_hash: primary.transformManifestHash,
    status: "PENDING_HUMAN_REVIEW",
  }).select("*").single()
if (insert.error || !insert.data) {
  await supabase.storage.from("ebay-listing-image-staging").remove([storagePath])
  throw new Error("DETERMINISTIC_PRIMARY_RECORD_FAILED")
}
await writeFile("/tmp/reference-guided-deterministic-primary-main.png",
  primary.output, { mode: 0o600 })
primary.output.fill(0)
source.fill(0)
console.log(JSON.stringify({ reused: false, preview: insert.data,
  dimensions: "1600x1600", storageRoundtrip: true, providerCalls: 2,
  providerCallsThisRun: 0, ebayWrites: 0, productionChanged: false }))
