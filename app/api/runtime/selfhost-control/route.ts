export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, pattern: RegExp, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim().slice(0, maximum)
  return pattern.test(normalized) ? normalized : null
}

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed : null
}

function timestamp(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(message)
    ? message : "SELFHOST_RUNTIME_CONTROL_FAILED"
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdminClient()
  const authorized = await sellerOsPostRuntimeAuthorizedV1({ request, supabase,
    environmentSecrets: [process.env.CRON_SECRET,
      process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET] })
  if (!authorized) return NextResponse.json({ success: false,
    error: "RUNTIME_UNAUTHORIZED" }, { status: 401 })
  try {
    const body = record(await request.json())
    const action = text(body.action, /^[A-Z_]{3,40}$/, 40)
    let response: { data: unknown; error: { message?: string } | null }
    if (action === "STARTUP") {
      const instanceKey = text(body.instanceKey,
        /^[a-z0-9][a-z0-9_-]{2,63}$/, 64)
      const startedAt = timestamp(body.startedAt)
      const rawJobs = Array.isArray(body.jobs) ? body.jobs.slice(0, 16) : []
      if (!instanceKey || !startedAt || rawJobs.length === 0) {
        throw new Error("SELFHOST_RUNTIME_START_INPUT_INVALID")
      }
      const jobs = rawJobs.map((entry) => {
        const job = record(entry)
        const name = text(job.name, /^[a-z0-9][a-z0-9-]{2,79}$/, 80)
        const everyMinutes = integer(job.everyMinutes, 1, 10_080)
        const minuteOffset = integer(job.minuteOffset, 0, 10_079)
        const maxCatchUpMinutes = integer(job.maxCatchUpMinutes, 1, 10_080)
        if (!name || everyMinutes === null || minuteOffset === null ||
            maxCatchUpMinutes === null) {
          throw new Error("SELFHOST_RUNTIME_JOB_SPEC_INVALID")
        }
        return { name, everyMinutes, minuteOffset, maxCatchUpMinutes,
          catchUp: job.catchUp === true }
      })
      response = await supabase.rpc("start_seller_os_selfhost_runtime_v1", {
        p_instance_key: instanceKey, p_started_at: startedAt, p_jobs: jobs,
      })
    } else if (action === "HEARTBEAT") {
      const sessionId = text(body.sessionId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        36)
      const observedAt = timestamp(body.observedAt)
      if (!sessionId || !observedAt) throw new Error(
        "SELFHOST_RUNTIME_HEARTBEAT_INPUT_INVALID")
      response = await supabase.rpc("heartbeat_seller_os_selfhost_runtime_v1", {
        p_session_id: sessionId, p_observed_at: observedAt,
      })
    } else if (action === "CLAIM_JOB") {
      const sessionId = text(body.sessionId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        36)
      const jobName = text(body.jobName, /^[a-z0-9][a-z0-9-]{2,79}$/, 80)
      const scheduledSlot = integer(body.scheduledSlot, 1, Number.MAX_SAFE_INTEGER)
      const triggerKind = text(body.triggerKind,
        /^(SCHEDULE|CATCH_UP|ONCE|QUEUE)$/, 20)
      const leaseSeconds = integer(body.leaseSeconds, 30, 14_400)
      const observedAt = timestamp(body.observedAt)
      if (!sessionId || !jobName || scheduledSlot === null || !triggerKind ||
          leaseSeconds === null || !observedAt) {
        throw new Error("SELFHOST_RUNTIME_JOB_CLAIM_INPUT_INVALID")
      }
      response = await supabase.rpc("claim_seller_os_selfhost_runtime_job_v1", {
        p_session_id: sessionId, p_job_name: jobName,
        p_scheduled_slot: scheduledSlot, p_trigger_kind: triggerKind,
        p_lease_seconds: leaseSeconds, p_now: observedAt,
      })
    } else if (action === "COMPLETE_JOB") {
      const sessionId = text(body.sessionId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        36)
      const runId = text(body.runId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        36)
      const httpStatus = body.httpStatus === null ? null
        : integer(body.httpStatus, 100, 599)
      const outcomeCode = text(body.outcomeCode, /^[A-Z0-9_]{2,80}$/, 80)
      const elapsedMs = integer(body.elapsedMs, 0, 14_400_000)
      const completedAt = timestamp(body.completedAt)
      if (!sessionId || !runId || typeof body.succeeded !== "boolean" ||
          (body.httpStatus !== null && httpStatus === null) || !outcomeCode ||
          elapsedMs === null || !completedAt) {
        throw new Error("SELFHOST_RUNTIME_JOB_COMPLETION_INPUT_INVALID")
      }
      response = await supabase.rpc(
        "complete_seller_os_selfhost_runtime_job_v1", {
          p_session_id: sessionId, p_run_id: runId,
          p_succeeded: body.succeeded, p_http_status: httpStatus,
          p_outcome_code: outcomeCode, p_elapsed_ms: elapsedMs,
          p_completed_at: completedAt,
        })
    } else {
      throw new Error("SELFHOST_RUNTIME_ACTION_INVALID")
    }
    if (response.error) throw new Error("SELFHOST_RUNTIME_DATABASE_FAILED")
    return NextResponse.json({ success: true, result: response.data,
      safety: { secretValuesDisplayed: false, marketplaceWrites: 0,
        databaseBusinessMutations: 0 } })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error),
      safety: { secretValuesDisplayed: false, marketplaceWrites: 0,
        databaseBusinessMutations: 0 } }, { status: 400 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1({
    contractVersion: "SELLER_OS_SELFHOST_RUNTIME_CONTROL_V1",
  })
}
