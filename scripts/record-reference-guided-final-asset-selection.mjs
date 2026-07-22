import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const EXPECTED = {
  primary: "44c7c5d832c4dd655fcc4a4865c51779406662c438a3e6ff5239606360cef3ba",
  materialSide: "38a8a2134ea3f1ce6415df061ee293690d09f6f8da82e66660b156eda6d53464",
  rejectedMain: "bed9da07b768d37f3feeef5aaf4be11868f63a9e7946e3ab35c0cfff0df218f0",
  rejectedCanary: "cc0ef29aba4ea671d64811bd5126c3a6c9d387028e330f88330de3fc9fc8aa20",
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("FINAL_SELECTION_REQUIRES_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

async function state() {
  const [{ data: attempt, error: attemptError },
    { data: jobs, error: jobsError }, { data: primary, error: primaryError },
    { data: detail, error: detailError },
    { data: variants, error: variantsError }] = await Promise.all([
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,status,lease_owner,lease_expires_at,output_storage_path,output_sha256")
      .eq("generation_attempt_id", ATTEMPT_ID).order("position"),
    supabase.from("ebay_reference_guided_primary_main_previews")
      .select("output_storage_path,output_sha256").eq("attempt_id", ATTEMPT_ID)
      .maybeSingle(),
    supabase.from("ebay_reference_guided_deterministic_previews")
      .select("output_storage_path,output_sha256,source_image_id")
      .eq("attempt_id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_deterministic_asset_variants")
      .select("asset_ordinal,variant_version,source_image_id,output_storage_path,output_sha256,qa_metrics")
      .eq("attempt_id", ATTEMPT_ID).order("asset_ordinal"),
  ])
  if (attemptError || jobsError || primaryError || detailError || variantsError ||
    !attempt || !primary || !detail || variants?.length !== 2 ||
    jobs?.length !== 6) throw new Error("FINAL_SELECTION_STATE_LOAD_FAILED")
  return { attempt, jobs, primary, detail, variants }
}

function assertState(value) {
  if (Number(value.attempt.provider_calls) !== 2 ||
    value.attempt.retry_consumed !== false ||
    Number(value.attempt.ebay_writes) !== 0 ||
    value.attempt.production_changed !== false ||
    value.jobs[0].status !== "BLOCKED_FIDELITY" ||
    value.jobs[0].output_sha256 !== EXPECTED.rejectedCanary ||
    value.jobs.slice(1).some((job) => job.status !== "PENDING" ||
      job.lease_owner != null || job.lease_expires_at != null ||
      job.output_storage_path != null || job.output_sha256 != null)) {
    throw new Error("FINAL_SELECTION_PREFLIGHT_FAILED")
  }
}

const before = await state()
assertState(before)
const side = before.variants.find((row) => row.source_image_id === "SIDE")
if (!side || before.primary.output_sha256 !== EXPECTED.primary ||
  side.output_sha256 !== EXPECTED.materialSide ||
  before.detail.output_sha256 !== EXPECTED.rejectedMain) {
  throw new Error("FINAL_SELECTION_PERSISTED_HASH_MISMATCH")
}
const sources = [
  ["primary", before.primary.output_storage_path],
  ["materialSide", side.output_storage_path],
  ["rejectedMain", before.detail.output_storage_path],
  ["rejectedCanary", before.jobs[0].output_storage_path],
]
const recalculated = {}
for (const [name, path] of sources) {
  const downloaded = await supabase.storage.from("ebay-listing-image-staging")
    .download(path)
  if (downloaded.error || !downloaded.data) {
    throw new Error("FINAL_SELECTION_PRIVATE_OBJECT_DOWNLOAD_FAILED")
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  const metadata = await sharp(bytes).metadata()
  recalculated[name] = sha256(bytes)
  if (recalculated[name] !== EXPECTED[name] || metadata.format !== "png" ||
    metadata.width !== 1600 || metadata.height !== 1600) {
    throw new Error("FINAL_SELECTION_PRIVATE_OBJECT_HASH_MISMATCH")
  }
  bytes.fill(0)
}

const recorded = await supabase.rpc(
  "record_ebay_reference_guided_final_asset_selection", {
    p_attempt_id: ATTEMPT_ID,
    p_primary_sha256: recalculated.primary,
    p_material_detail_sha256: recalculated.materialSide,
    p_rejected_main_detail_sha256: recalculated.rejectedMain,
    p_rejected_canary_sha256: recalculated.rejectedCanary,
  })
if (recorded.error || !Array.isArray(recorded.data) ||
  recorded.data.length !== 1) throw new Error("FINAL_SELECTION_RECORD_FAILED")
const after = await state()
assertState(after)
if (JSON.stringify(before.jobs) !== JSON.stringify(after.jobs)) {
  throw new Error("FINAL_SELECTION_JOBS_CHANGED")
}
const [{ data: selection, error: selectionError },
  { data: reviews, error: reviewsError }] = await Promise.all([
  supabase.from("ebay_reference_guided_final_asset_selection_events")
    .select("*").eq("attempt_id", ATTEMPT_ID).maybeSingle(),
  supabase.from("ebay_reference_guided_asset_review_events")
    .select("asset_ordinal,preview_sha256,decision,reason")
    .eq("attempt_id", ATTEMPT_ID).order("created_at"),
])
if (selectionError || reviewsError || !selection || reviews?.length !== 3 ||
  selection.primary_sha256 !== recalculated.primary ||
  selection.material_detail_sha256 !== recalculated.materialSide ||
  selection.rejected_main_detail_sha256 !== recalculated.rejectedMain ||
  selection.rejected_canary_sha256 !== recalculated.rejectedCanary) {
  throw new Error("FINAL_SELECTION_POSTCONDITION_FAILED")
}
console.log(JSON.stringify({ selectionId: selection.id,
  reused: recorded.data[0].reused, primaryVerdict: selection.primary_verdict,
  primaryBackground: selection.primary_background,
  primarySafeMarginPixels: selection.primary_safe_margin_pixels,
  materialDetailSource: selection.material_detail_source,
  materialDetailVerdict: selection.material_detail_verdict,
  rejectedVariantsPreserved: true, privateObjectHashesRecalculated: recalculated,
  positions2To6Unchanged: true, providerCalls: 2, providerCallsThisRun: 0,
  ebayWrites: 0, productionChanged: false }))
