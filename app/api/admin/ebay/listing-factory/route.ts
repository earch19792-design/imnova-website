export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  approveListingGeneration,
  approveWinnerDecisionPackage,
  generateListingFactoryPackage,
  getOpenAiListingFactoryConfiguration,
} from "@/lib/ebay/ebay-openai-listing-factory-service"
import {
  runResilientBatchDryRun,
  sha256Hex,
  type FactorySimulationCandidate,
} from "@/lib/ebay/ebay-resilient-listing-factory-domain"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(code) ? code : "LISTING_FACTORY_REQUEST_FAILED"
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAGING_PROJECT_REF = "vsfthqydfrdzulldbfbe"

function assertResilientFactoryStagingBoundary() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("LISTING_FACTORY_PRODUCTION_RUNTIME_FORBIDDEN")
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (process.env.VERCEL_ENV && url) {
    const projectRef = new URL(url).hostname.split(".")[0]
    if (projectRef !== STAGING_PROJECT_REF) {
      throw new Error("LISTING_FACTORY_STAGING_DATABASE_REQUIRED")
    }
  }
}

function assertResilientFactoryEnabled() {
  if (process.env.EBAY_RESILIENT_LISTING_FACTORY_ENABLED !== "true") {
    throw new Error("LISTING_FACTORY_FEATURE_DISABLED")
  }
}

async function assertRunAccountScope(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  runId: string,
  accountKey: string,
) {
  const { data, error } = await supabase
    .from("ebay_same_day_pilot_runs")
    .select("id,marketplace_account_key")
    .eq("id", runId)
    .maybeSingle()
  if (error || !data || data.marketplace_account_key !== accountKey) {
    throw new Error("LISTING_FACTORY_RUN_ACCOUNT_MISMATCH")
  }
}

async function admin(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return {
    error: response(
      { success: false, error: validation.error ?? "LISTING_FACTORY_HUMAN_ADMIN_REQUIRED" },
      validation.status || 403,
    ),
    actorId: "",
  }
  return { error: null, actorId: validation.userId }
}

export async function GET(req: Request) {
  const auth = await admin(req)
  if (auth.error) return auth.error
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  const supabase = getSupabaseAdminClient()
  const runResult = accountKey
    ? await supabase.from("ebay_listing_factory_run_metrics_v1")
      .select("*")
      .eq("marketplace_account_key", accountKey)
      .order("operation_date", { ascending: false })
      .limit(20)
    : { data: [], error: null }
  const runIds = (runResult.data ?? []).map((run) => String(run.run_id))
  const [quarantineResult, circuitResult] = await Promise.all([
    runIds.length
      ? supabase.from("ebay_listing_factory_quarantine_cases")
        .select("id,run_id,candidate_id,sku,phase,error_code,error_category,dependency,attempt_count,impact,suggested_action,replay_safe,status,created_at")
        .in("run_id", runIds)
        .in("status", ["OPEN", "REPLAYING"])
        .order("created_at", { ascending: false })
        .limit(50)
      : Promise.resolve({ data: [], error: null }),
    accountKey
      ? supabase.from("ebay_listing_factory_dependency_circuits")
        .select("id,marketplace_account_key,marketplace,dependency,status,failure_count,opened_at,retry_after,last_error_code,updated_at")
        .eq("marketplace_account_key", accountKey)
        .neq("status", "CLOSED")
        .order("updated_at", { ascending: false })
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])
  const resilientError = runResult.error ?? quarantineResult.error ?? circuitResult.error
  return response({
    success: true,
    configuration: getOpenAiListingFactoryConfiguration(),
    safety: {
      serverSideOnly: true,
      secretsReturned: false,
      ebayWrites: 0,
      canPublish: false,
    },
    resilientFactory: {
      migrationReady: !resilientError,
      error: resilientError ? "LISTING_FACTORY_MIGRATION_NOT_READY" : null,
      safety: {
        environment: "STAGING_ONLY",
        defaultMode: "DRY_RUN",
        externalWritesAllowed: false,
        automaticPublishAllowed: false,
        publishOfferCalls: 0,
      },
      runs: runResult.data ?? [],
      quarantine: quarantineResult.data ?? [],
      circuits: circuitResult.data ?? [],
    },
  })
}

export async function POST(req: Request) {
  const auth = await admin(req)
  if (auth.error) return auth.error
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({ success: false, error: "LISTING_FACTORY_ACCOUNT_REQUIRED" }, 400)
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 500_000) return response({ success: false, error: "LISTING_FACTORY_INPUT_TOO_LARGE" }, 413)
  try {
    const body = record(await req.json())
    const action = string(body.action)
    const supabase = getSupabaseAdminClient()
    if (action === "INITIALIZE_EXISTING_RUN") {
      assertResilientFactoryStagingBoundary()
      assertResilientFactoryEnabled()
      const runId = string(body.runId)
      if (!UUID_PATTERN.test(runId)) {
        throw new Error("LISTING_FACTORY_RUN_ID_INVALID")
      }
      await assertRunAccountScope(supabase, runId, accountKey)
      const { data, error } = await supabase.rpc(
        "initialize_ebay_listing_factory_run_v1",
        {
          p_run_id: runId,
          p_actor: auth.actorId,
          p_correlation_id: crypto.randomUUID(),
        },
      )
      if (error) throw new Error("LISTING_FACTORY_INITIALIZE_FAILED")
      return response({ success: true, action, result: data, ebayWrites: 0 })
    }
    if (action === "REPLAY_FROM_LAST_CHECKPOINT") {
      assertResilientFactoryStagingBoundary()
      assertResilientFactoryEnabled()
      const caseId = string(body.quarantineCaseId)
      if (!UUID_PATTERN.test(caseId)) {
        throw new Error("LISTING_FACTORY_QUARANTINE_ID_INVALID")
      }
      if (body.evidenceRevalidated !== true) {
        throw new Error("LISTING_FACTORY_EVIDENCE_REVALIDATION_REQUIRED")
      }
      const { data: quarantineCase, error: caseError } = await supabase
        .from("ebay_listing_factory_quarantine_cases")
        .select("run_id")
        .eq("id", caseId)
        .maybeSingle()
      if (caseError || !quarantineCase) {
        throw new Error("LISTING_FACTORY_OPEN_QUARANTINE_NOT_FOUND")
      }
      await assertRunAccountScope(supabase, String(quarantineCase.run_id), accountKey)
      const correlationId = crypto.randomUUID()
      const { data, error } = await supabase.rpc(
        "replay_ebay_listing_factory_quarantine_v1",
        {
          p_quarantine_case_id: caseId,
          p_actor_id: auth.actorId,
          p_evidence_revalidated: true,
          p_correlation_id: correlationId,
          p_idempotency_key: sha256Hex({ action, caseId, correlationId }),
        },
      )
      if (error) throw new Error("LISTING_FACTORY_REPLAY_FAILED")
      return response({ success: true, action, result: data, ebayWrites: 0 })
    }
    if (action === "RECOMPUTE_RUN_PROJECTION") {
      assertResilientFactoryStagingBoundary()
      assertResilientFactoryEnabled()
      const runId = string(body.runId)
      if (!UUID_PATTERN.test(runId)) {
        throw new Error("LISTING_FACTORY_RUN_ID_INVALID")
      }
      await assertRunAccountScope(supabase, runId, accountKey)
      const { data, error } = await supabase.rpc(
        "recompute_ebay_listing_factory_run_v1",
        { p_run_id: runId },
      )
      if (error) throw new Error("LISTING_FACTORY_RECOMPUTE_FAILED")
      return response({ success: true, action, status: data, ebayWrites: 0 })
    }
    if (action === "CLAIM_DEPENDENCY_CIRCUIT_PROBE") {
      assertResilientFactoryStagingBoundary()
      assertResilientFactoryEnabled()
      const dependency = string(body.dependency)
      if (!["EBAY", "LUNA", "OPENAI"].includes(dependency)) {
        throw new Error("LISTING_FACTORY_DEPENDENCY_INVALID")
      }
      const worker = `admin-probe:${auth.actorId}:${crypto.randomUUID()}`
      const { data, error } = await supabase.rpc(
        "claim_ebay_listing_factory_circuit_probe_v1",
        {
          p_marketplace_account_key: accountKey,
          p_marketplace: "EBAY_US",
          p_dependency: dependency,
          p_worker: worker,
          p_now: new Date().toISOString(),
          p_lease_seconds: 300,
        },
      )
      if (error) throw new Error("LISTING_FACTORY_CIRCUIT_PROBE_CLAIM_FAILED")
      return response({
        success: true,
        action,
        dependency,
        claimed: data === true,
        probeOwner: data === true ? worker : null,
        ebayWrites: 0,
      })
    }
    if (action === "RESOLVE_DEPENDENCY_CIRCUIT_PROBE") {
      assertResilientFactoryStagingBoundary()
      assertResilientFactoryEnabled()
      const dependency = string(body.dependency)
      const probeOwner = string(body.probeOwner)
      const evidenceHash = string(body.probeEvidenceHash)
      if (!["EBAY", "LUNA", "OPENAI"].includes(dependency)) {
        throw new Error("LISTING_FACTORY_DEPENDENCY_INVALID")
      }
      if (!probeOwner.startsWith(`admin-probe:${auth.actorId}:`) ||
        !/^[0-9a-f]{64}$/.test(evidenceHash)) {
        throw new Error("LISTING_FACTORY_CIRCUIT_PROBE_EVIDENCE_REQUIRED")
      }
      if (typeof body.recovered !== "boolean") {
        throw new Error("LISTING_FACTORY_CIRCUIT_PROBE_RESULT_REQUIRED")
      }
      const { data, error } = await supabase.rpc(
        "resolve_ebay_listing_factory_circuit_probe_v1",
        {
          p_marketplace_account_key: accountKey,
          p_marketplace: "EBAY_US",
          p_dependency: dependency,
          p_worker: probeOwner,
          p_recovered: body.recovered,
          p_error_code: body.recovered ? null : "DEPENDENCY_PROBE_FAILED",
          p_sanitized_error: body.recovered
            ? null
            : `Probe seguro sin recuperación; evidencia ${evidenceHash.slice(0, 12)}.`,
          p_retry_after: body.recovered
            ? null
            : new Date(Date.now() + 5 * 60_000).toISOString(),
          p_now: new Date().toISOString(),
        },
      )
      if (error) throw new Error("LISTING_FACTORY_CIRCUIT_PROBE_RESOLVE_FAILED")
      return response({
        success: true,
        action,
        dependency,
        status: data,
        probeEvidenceHash: evidenceHash,
        ebayWrites: 0,
      })
    }
    if (action === "SIMULATE_DRY_RUN") {
      assertResilientFactoryStagingBoundary()
      const candidates = Array.isArray(body.candidates)
        ? body.candidates as FactorySimulationCandidate[]
        : []
      const reserves = Array.isArray(body.reserves)
        ? body.reserves as FactorySimulationCandidate[]
        : []
      const result = await runResilientBatchDryRun({ candidates, reserves })
      return response({ success: true, action, result, ebayWrites: 0 })
    }
    if (action === "approve_decision_package") {
      const result = await approveWinnerDecisionPackage({
        supabase,
        accountKey,
        packageId: string(body.packageId),
        packageHash: string(body.packageHash),
        actorId: auth.actorId,
        confirmed: body.confirmed === true,
      })
      return response({ success: true, action, result })
    }
    if (action === "generate") {
      const result = await generateListingFactoryPackage({
        supabase,
        accountKey,
        packageId: string(body.packageId),
        packageHash: string(body.packageHash),
        context: record(body.context),
        adapterMode: body.adapterMode === "real" ? "real" : "fake",
      })
      return response({ success: true, action, result })
    }
    if (action === "approve_generation") {
      const result = await approveListingGeneration({
        supabase,
        accountKey,
        generationId: string(body.generationId),
        outputHash: string(body.outputHash),
        actorId: auth.actorId,
        confirmed: body.confirmed === true,
      })
      return response({ success: true, action, result })
    }
    return response({ success: false, error: "LISTING_FACTORY_ACTION_INVALID" }, 400)
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 400)
  }
}
