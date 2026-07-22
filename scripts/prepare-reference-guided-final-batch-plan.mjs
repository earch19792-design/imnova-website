import { createClient } from "@supabase/supabase-js"

import { buildReferenceGuidedFinalBatchPlan } from
  "../lib/ebay/reference-guided-final-batch-plan.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("FINAL_BATCH_PLAN_REQUIRES_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function loadState() {
  const [{ data: attempt, error: attemptError },
    { data: revision, error: revisionError },
    { data: jobs, error: jobsError },
    { data: selection, error: selectionError }] = await Promise.all([
    supabase.from("ebay_reference_guided_generation_attempts")
      .select("id,revision_id,composition_manifest_hash,status,provider_calls,max_provider_calls,retry_consumed,ebay_writes,production_changed")
      .eq("id", ATTEMPT_ID).maybeSingle(),
    supabase.from("ebay_same_day_pilot_image_revisions")
      .select("id,status,strategy_version,revision_contract,product_dossier_hash,market_visual_brief_hash,main_source_hash,side_source_hash")
      .eq("id", REVISION_ID).maybeSingle(),
    supabase.from("ebay_reference_guided_generation_jobs")
      .select("id,position,commercial_role,status,prompt_hash,allowed_product_facts,allowed_generated_context,prohibited_claims,lease_owner,lease_expires_at,provider_call_started_at,output_storage_path,output_sha256")
      .eq("generation_attempt_id", ATTEMPT_ID).gte("position", 2)
      .lte("position", 6).order("position"),
    supabase.from("ebay_reference_guided_final_asset_selection_events")
      .select("primary_sha256,primary_verdict,material_detail_sha256,material_detail_source,material_detail_verdict")
      .eq("attempt_id", ATTEMPT_ID).maybeSingle(),
  ])
  if (attemptError || revisionError || jobsError || selectionError || !attempt ||
    !revision || !selection || jobs?.length !== 5) {
    throw new Error("FINAL_BATCH_PLAN_STATE_LOAD_FAILED")
  }
  return { attempt, revision, jobs, selection }
}

function assertPristine(state) {
  if (state.attempt.revision_id !== REVISION_ID ||
    Number(state.attempt.provider_calls) !== 2 ||
    Number(state.attempt.max_provider_calls) !== 6 ||
    state.attempt.retry_consumed !== false ||
    Number(state.attempt.ebay_writes) !== 0 ||
    state.attempt.production_changed !== false ||
    state.revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
    state.revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
    state.selection.primary_verdict !== "APPROVED" ||
    state.selection.material_detail_verdict !== "APPROVED" ||
    state.selection.material_detail_source !== "SIDE" ||
    state.jobs.some((job) => job.status !== "PENDING" ||
      job.lease_owner != null || job.lease_expires_at != null ||
      job.provider_call_started_at != null || job.output_storage_path != null ||
      job.output_sha256 != null)) {
    throw new Error("FINAL_BATCH_PLAN_PREFLIGHT_FAILED")
  }
}

const before = await loadState()
assertPristine(before)
const built = buildReferenceGuidedFinalBatchPlan({
  attemptId: ATTEMPT_ID,
  revisionId: REVISION_ID,
  compositionManifestHash: before.attempt.composition_manifest_hash,
  productDossierHash: before.revision.product_dossier_hash,
  marketVisualBriefHash: before.revision.market_visual_brief_hash,
  mainSourceHash: before.revision.main_source_hash,
  sideSourceHash: before.revision.side_source_hash,
  approvedPrimarySha256: before.selection.primary_sha256,
  approvedMaterialDetailSha256: before.selection.material_detail_sha256,
  jobs: before.jobs,
})
const prepared = await supabase.rpc(
  "prepare_ebay_reference_guided_final_batch_plan", {
    p_attempt_id: ATTEMPT_ID,
    p_plan_text: built.planText,
    p_plan_hash: built.planHash,
  })
if (prepared.error || !Array.isArray(prepared.data) ||
  prepared.data.length !== 1) throw new Error("FINAL_BATCH_PLAN_RECORD_FAILED")

const after = await loadState()
assertPristine(after)
if (JSON.stringify(before.jobs) !== JSON.stringify(after.jobs) ||
  JSON.stringify(before.attempt) !== JSON.stringify(after.attempt)) {
  throw new Error("FINAL_BATCH_PLAN_EXECUTION_STATE_CHANGED")
}
const [{ data: plan, error: planError },
  { data: positions, error: positionsError }] = await Promise.all([
  supabase.from("ebay_reference_guided_final_batch_plans")
    .select("id,plan_hash,status,lifetime_provider_budget_used,lifetime_provider_budget_max,lifetime_provider_budget_remaining,planned_new_provider_calls,max_concurrency,automatic_retries")
    .eq("attempt_id", ATTEMPT_ID).maybeSingle(),
  supabase.from("ebay_reference_guided_final_batch_plan_positions")
    .select("position,execution_mode,planned_provider_calls,prompt_hash")
    .eq("attempt_id", ATTEMPT_ID).order("position"),
])
if (planError || positionsError || !plan || positions?.length !== 5 ||
  plan.plan_hash !== built.planHash || plan.status !==
    "AWAITING_HUMAN_BATCH_AUTHORIZATION" ||
  positions.reduce((sum, row) => sum + row.planned_provider_calls, 0) !== 4) {
  throw new Error("FINAL_BATCH_PLAN_POSTCONDITION_FAILED")
}
console.log(JSON.stringify({ planId: plan.id, planHash: built.planHash,
  reused: prepared.data[0].reused, plan: built.plan, leasesCreated: 0,
  providerReservationsCreated: 0, providerCalls: 2, providerCallsThisRun: 0,
  ebayWrites: 0, productionChanged: false }))
