import type { SupabaseClient } from "@supabase/supabase-js"

export const VISUAL_STRATEGY_V3 = "VISUAL_STRATEGY_V3"
export const REFERENCE_GUIDED_PRODUCT_GENERATION_V1 =
  "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"

type Revision = {
  id: string
  status: string
  strategy_version: string
  revision_contract: string
}

type Attempt = {
  id: string
  revision_id: string
  expected_job_count: number
  completed_job_count: number
}

type Job = { position: number; status: string }

export type VisualStrategyV3PublicationGate = {
  required: boolean
  allowed: boolean
  reason: string | null
  revisionId: string | null
  revisionStatus: string | null
  attemptId: string | null
  passedJobs: number
  totalJobs: number
}

export function evaluateVisualStrategyV3PublicationGate(input: {
  revision: Revision | null
  attempt: Attempt | null
  jobs: Job[]
}): VisualStrategyV3PublicationGate {
  if (!input.revision) {
    return {
      required: false,
      allowed: true,
      reason: null,
      revisionId: null,
      revisionStatus: null,
      attemptId: null,
      passedJobs: 0,
      totalJobs: 0,
    }
  }

  const base = {
    required: true,
    revisionId: input.revision.id,
    revisionStatus: input.revision.status,
    attemptId: input.attempt?.id ?? null,
    passedJobs: input.jobs.filter((job) => job.status === "PASSED").length,
    totalJobs: input.jobs.length,
  }
  if (
    input.revision.strategy_version !== VISUAL_STRATEGY_V3
    || input.revision.revision_contract !== REFERENCE_GUIDED_PRODUCT_GENERATION_V1
  ) {
    return { ...base, allowed: false, reason: "VISUAL_STRATEGY_V3_CONTRACT_INVALID" }
  }
  if (input.revision.status !== "APPROVED") {
    return { ...base, allowed: false, reason: "VISUAL_STRATEGY_V3_NOT_APPROVED" }
  }
  if (!input.attempt || input.attempt.revision_id !== input.revision.id) {
    return { ...base, allowed: false, reason: "VISUAL_STRATEGY_V3_ATTEMPT_REQUIRED" }
  }
  const positions = input.jobs.map((job) => job.position)
  const exactPositions = input.jobs.length === 6
    && new Set(positions).size === 6
    && [1, 2, 3, 4, 5, 6].every((position) => positions.includes(position))
  if (
    input.attempt.expected_job_count !== 6
    || input.attempt.completed_job_count !== 6
    || !exactPositions
    || input.jobs.some((job) => job.status !== "PASSED")
  ) {
    return { ...base, allowed: false, reason: "VISUAL_STRATEGY_V3_JOBS_NOT_PASSED" }
  }
  return { ...base, allowed: true, reason: null }
}

export async function loadVisualStrategyV3PublicationGate(input: {
  supabase: SupabaseClient
  listingPackageId: string
  actorId?: string
  accountKey?: string
}): Promise<VisualStrategyV3PublicationGate> {
  let revisionQuery = input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("id,status,strategy_version,revision_contract")
    .eq("listing_package_id", input.listingPackageId)
    .eq("strategy_version", VISUAL_STRATEGY_V3)
    .order("revision_number", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
  if (input.accountKey) {
    revisionQuery = revisionQuery.eq("marketplace_account_key", input.accountKey)
  }
  const { data: revision, error: revisionError } = await revisionQuery.maybeSingle()
  if (revisionError) throw new Error("VISUAL_STRATEGY_V3_GATE_LOOKUP_FAILED")
  if (!revision) {
    return evaluateVisualStrategyV3PublicationGate({ revision: null, attempt: null, jobs: [] })
  }

  const { data: attempt, error: attemptError } = await input.supabase
    .from("ebay_reference_guided_generation_attempts")
    .select("id,revision_id,expected_job_count,completed_job_count")
    .eq("revision_id", revision.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (attemptError) throw new Error("VISUAL_STRATEGY_V3_GATE_LOOKUP_FAILED")
  const { data: jobs, error: jobsError } = attempt?.id
    ? await input.supabase
      .from("ebay_reference_guided_generation_jobs")
      .select("position,status")
      .eq("generation_attempt_id", attempt.id)
      .order("position", { ascending: true })
    : { data: [], error: null }
  if (jobsError) throw new Error("VISUAL_STRATEGY_V3_GATE_LOOKUP_FAILED")
  return evaluateVisualStrategyV3PublicationGate({
    revision: revision as Revision,
    attempt: attempt as Attempt | null,
    jobs: (jobs ?? []) as Job[],
  })
}

export function assertVisualStrategyV3PublicationAllowed(
  gate: VisualStrategyV3PublicationGate,
) {
  if (!gate.allowed) throw new Error(gate.reason ?? "VISUAL_STRATEGY_V3_PUBLICATION_BLOCKED")
}
