export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { after } from "next/server"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiJson,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  getListingAiApprovalQueueStatus,
  markListingAiApprovalQueueScanFailed,
  startListingAiApprovalQueueScan,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"

const CONTINUATION_PATH = "/api/admin/ebay/listing-ai/approval-queue/continue"

function continuationOrigin(req: Request) {
  const deploymentHost = process.env.VERCEL_URL?.trim()
  if (deploymentHost && /^[a-z0-9.-]+$/i.test(deploymentHost)) return `https://${deploymentHost}`
  const origin = new URL(req.url).origin
  if (process.env.VERCEL_ENV === "preview" && !origin.endsWith(".vercel.app")) {
    throw new Error("TOP20_CONTINUATION_ORIGIN_INVALID")
  }
  return origin
}

function vercelProtectionCookie(req: Request) {
  const cookie = req.headers.get("cookie") ?? ""
  const match = cookie.match(/(?:^|;\s*)(_vercel_jwt)=([^;\s]{20,4096})(?:;|$)/)
  return match ? `${match[1]}=${match[2]}` : null
}

async function dispatchContinuation(
  origin: string,
  runId: string,
  token: string,
  protectionCookie: string | null,
) {
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(new URL(CONTINUATION_PATH, origin), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Top20-Continuation-Token": token,
          ...(protectionBypass ? { "X-Vercel-Protection-Bypass": protectionBypass } : {}),
          ...(!protectionBypass && protectionCookie ? { Cookie: protectionCookie } : {}) },
        body: JSON.stringify({ runId }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      })
      if (response.ok) return
      if (response.status < 500 && response.status !== 429) break
    } catch {
      // A bounded retry is safe: the worker lease and target claim are idempotent.
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)))
  }
  throw new Error("TOP20_CONTINUATION_DISPATCH_FAILED")
}

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true,
      ...(await getListingAiApprovalQueueStatus(auth.supabase, auth.accountKey)) })
  } catch (error) {
    return listingAiFailure(error)
  }
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const body = await listingAiJson(req)
    if (body.action !== "scan") throw new Error("TOP20_ACTION_INVALID")
    const result = await startListingAiApprovalQueueScan({
      supabase: auth.supabase, accountKey: auth.accountKey,
    })
    if (result.shouldSchedule && result.continuationToken) {
      const origin = continuationOrigin(req)
      const token = result.continuationToken
      const protectionCookie = vercelProtectionCookie(req)
      after(async () => {
        try {
          await dispatchContinuation(origin, result.runId, token, protectionCookie)
        } catch {
          await markListingAiApprovalQueueScanFailed({
            supabase: auth.supabase, runId: result.runId, continuationToken: token,
            errorCode: "TOP20_CONTINUATION_DISPATCH_FAILED",
          })
        }
      })
    }
    return listingAiResponse({ success: true, result: {
      runId: result.runId, status: result.status,
      catalogTotal: "catalogTotal" in result ? result.catalogTotal : undefined,
      alreadyRunning: "alreadyRunning" in result ? result.alreadyRunning : false,
      reusedFresh: "reusedFresh" in result ? result.reusedFresh : false,
      openAiCalls: 0, ebayWrites: 0, canPublish: false,
    } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
