import { createClient } from "@supabase/supabase-js"

import { buildReferenceGuidedFinalBatchSuccessorV2 } from
  "../lib/ebay/reference-guided-final-batch-plan-v2.ts"

const ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const PREDECESSOR_PLAN_ID = "3cea1494-0f36-46ca-8db1-9d997b293e56"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) throw new Error("STAGING_SERVICE_ROLE_CONFIGURATION_REQUIRED")
if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true") {
  throw new Error("SUCCESSOR_BATCH_PLAN_REQUIRES_PROVIDER_DISABLED")
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function loadExecutionState() {
  const [{ data: attempt, error: attemptError },
    { data: revision, error: revisionError },
    { data: jobs, error: jobsError },
    { data: selection, error: selectionError },
    { data: predecessor, error: predecessorError }] = await Promise.all([
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
    supabase.from("ebay_reference_guided_final_batch_plans")
      .select("id,attempt_id,plan_hash,status,plan_text,lifetime_provider_budget_used,lifetime_provider_budget_max,lifetime_provider_budget_remaining,planned_new_provider_calls,max_concurrency,automatic_retries,created_at")
      .eq("id", PREDECESSOR_PLAN_ID).maybeSingle(),
  ])
  if (attemptError || revisionError || jobsError || selectionError ||
    predecessorError || !attempt || !revision || !selection || !predecessor ||
    jobs?.length !== 5) {
    throw new Error("SUCCESSOR_BATCH_PLAN_STATE_LOAD_FAILED")
  }
  return { attempt, revision, jobs, selection, predecessor }
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
    state.predecessor.id !== PREDECESSOR_PLAN_ID ||
    state.predecessor.status !== "AWAITING_HUMAN_BATCH_AUTHORIZATION" ||
    Number(state.predecessor.lifetime_provider_budget_used) !== 2 ||
    state.selection.primary_verdict !== "APPROVED" ||
    state.selection.material_detail_verdict !== "APPROVED" ||
    state.selection.material_detail_source !== "SIDE" ||
    state.jobs.some((job) => job.status !== "PENDING" ||
      job.lease_owner != null || job.lease_expires_at != null ||
      job.provider_call_started_at != null || job.output_storage_path != null ||
      job.output_sha256 != null)) {
    throw new Error("SUCCESSOR_BATCH_PLAN_PREFLIGHT_FAILED")
  }
}

const before = await loadExecutionState()
assertPristine(before)
const built = buildReferenceGuidedFinalBatchSuccessorV2({
  attemptId: ATTEMPT_ID,
  revisionId: REVISION_ID,
  predecessorPlanId: before.predecessor.id,
  predecessorPlanHash: before.predecessor.plan_hash,
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
  "prepare_ebay_reference_guided_batch_plan_successor_v2", {
    p_attempt_id: ATTEMPT_ID,
    p_predecessor_plan_id: PREDECESSOR_PLAN_ID,
    p_plan_text: built.planText,
    p_plan_hash: built.planHash,
  })
if (prepared.error || !Array.isArray(prepared.data) ||
  prepared.data.length !== 1) {
  throw new Error(`SUCCESSOR_BATCH_PLAN_RECORD_FAILED:${prepared.error?.message ?? "UNKNOWN"}`)
}

const after = await loadExecutionState()
assertPristine(after)
if (JSON.stringify(before.attempt) !== JSON.stringify(after.attempt) ||
  JSON.stringify(before.jobs) !== JSON.stringify(after.jobs) ||
  JSON.stringify(before.predecessor) !== JSON.stringify(after.predecessor)) {
  throw new Error("SUCCESSOR_BATCH_PLAN_EXECUTION_OR_HISTORY_CHANGED")
}
const [{ data: successor, error: successorError },
  { data: positions, error: positionsError }] = await Promise.all([
  supabase.from("ebay_reference_guided_batch_plan_successors_v2")
    .select("id,predecessor_plan_id,predecessor_plan_hash,plan_hash,status,lifetime_provider_budget_used,lifetime_provider_budget_max,lifetime_provider_budget_remaining,planned_provider_calls,max_concurrency,automatic_retries")
    .eq("attempt_id", ATTEMPT_ID).maybeSingle(),
  supabase.from("ebay_reference_guided_batch_plan_successor_positions_v2")
    .select("position,execution_mode,execution_phase,planned_provider_calls,must_include,must_exclude,camera_and_framing,required_product_visibility,contextual_objects_not_included,exact_prompt_text,exact_prompt_hash,automatic_checks,human_checks,distinct_commercial_composition")
    .eq("attempt_id", ATTEMPT_ID).order("position"),
])
if (successorError || positionsError || !successor || positions?.length !== 5 ||
  successor.plan_hash !== built.planHash ||
  successor.predecessor_plan_id !== PREDECESSOR_PLAN_ID ||
  positions.reduce((sum, row) => sum + row.planned_provider_calls, 0) !== 4 ||
  positions.some((row) => /\bmay\b/i.test(row.exact_prompt_text)) ||
  /unitGrossWeight|454|1\.5 quart/i.test(positions[1].exact_prompt_text)) {
  throw new Error("SUCCESSOR_BATCH_PLAN_POSTCONDITION_FAILED")
}
console.log(JSON.stringify({
  successorPlanId: successor.id,
  successorPlanHash: successor.plan_hash,
  predecessorPlanId: before.predecessor.id,
  predecessorPlanHash: before.predecessor.plan_hash,
  oldPlanPreserved: true,
  reused: prepared.data[0].reused,
  unitGrossWeightRemovedFromVisualPrompt: true,
  allPositionObjectivesMandatory: true,
  position2ReadyDeterministic: true,
  positions3To6DistinctnessEnforced: true,
  plannedProviderCalls: 4,
  providerCalls: 2,
  activeLeases: 0,
  providerReservationsCreated: 0,
  providerCallsThisRun: 0,
  ebayWrites: 0,
  productionChanged: false,
  plan: built.plan,
}))
