export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiJson,
  listingAiResponse,
  listingAiText,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  createEbayStrategicAdvisorRun,
  decideEbayStrategicAdvisorManualExperiment,
  decideEbayStrategicAdvisorOpenAiSpend,
  getEbayStrategicAdvisorRun,
} from "@/lib/ebay/ebay-strategic-advisor-service"

function hash(value: unknown) {
  const result = listingAiText(value, 80)
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
    throw new Error("STRATEGIC_ADVISOR_HASH_REQUIRED")
  }
  return result
}

function runId(value: unknown) {
  const result = listingAiText(value, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error("STRATEGIC_ADVISOR_RUN_ID_REQUIRED")
  }
  return result
}

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const id = runId(new URL(req.url).searchParams.get("runId"))
    const result = await getEbayStrategicAdvisorRun({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      runId: id,
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const idempotencyKey = listingAiIdempotencyKey(req)
    const body = await listingAiJson(req)
    if (body.action === "CREATE_FROM_DETERMINISTIC_EVIDENCE") {
      const result = await createEbayStrategicAdvisorRun({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        actorId: auth.actorId,
        idempotencyKey,
        signalEventId: runId(body.signalEventId),
        performanceSnapshotId: runId(body.performanceSnapshotId),
        queueItemId: runId(body.queueItemId),
      })
      return listingAiResponse({ success: true, result }, 201)
    }
    if (body.action === "DECIDE_OPENAI_API_SPEND") {
      const result = await decideEbayStrategicAdvisorOpenAiSpend({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        runId: runId(body.runId),
        actorId: auth.actorId,
        evidenceHash: hash(body.evidenceHash),
        idempotencyKey,
        approved: body.approved === true,
        confirmed: body.confirmed === true,
      })
      return listingAiResponse({ success: true, result }, 202)
    }
    if (body.action === "DECIDE_MANUAL_EXPERIMENT") {
      const result = await decideEbayStrategicAdvisorManualExperiment({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        runId: runId(body.runId),
        actorId: auth.actorId,
        evidenceHash: hash(body.evidenceHash),
        proposalHash: hash(body.proposalHash),
        idempotencyKey,
        approved: body.approved === true,
        confirmed: body.confirmed === true,
      })
      return listingAiResponse({ success: true, result })
    }
    throw new Error("STRATEGIC_ADVISOR_ACTION_INVALID")
  } catch (error) {
    return listingAiFailure(error)
  }
}
