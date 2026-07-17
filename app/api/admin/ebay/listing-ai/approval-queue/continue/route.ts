export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { after } from "next/server"

import {
  continueListingAiApprovalQueueScan,
  markListingAiApprovalQueueScanFailed,
  validateListingAiApprovalQueueContinuation,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { getListingAiConfiguration } from "@/lib/ebay/ebay-openai-listing-factory-v2"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { listingAiFailure, listingAiJson, listingAiResponse } from "@/lib/ebay/ebay-listing-ai-api"

const CONTINUATION_PATH = "/api/admin/ebay/listing-ai/approval-queue/continue"

function safeOrigin(req: Request) {
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

async function dispatch(
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
        body: JSON.stringify({ runId }), cache: "no-store", signal: AbortSignal.timeout(15_000),
      })
      if (response.ok) return
      if (response.status < 500 && response.status !== 429) break
    } catch {
      // Bounded dispatch retry only; product work remains protected by leases and idempotency.
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)))
  }
  throw new Error("TOP20_CONTINUATION_DISPATCH_FAILED")
}

export async function POST(req: Request) {
  let runId = ""
  let token = ""
  try {
    const boundary = getListingAiConfiguration()
    if (!boundary.preview || !boundary.staging) throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
    token = req.headers.get("x-top20-continuation-token")?.trim() ?? ""
    const body = await listingAiJson(req)
    runId = typeof body.runId === "string" ? body.runId.trim() : ""
    if (!runId || !token) throw new Error("TOP20_CONTINUATION_AUTH_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const run = await validateListingAiApprovalQueueContinuation({
      supabase, runId, continuationToken: token,
    })
    const shouldRun = ["RUNNING", "PARTIAL_AUTO_CONTINUING"].includes(run.automation_status)
    if (shouldRun) {
      const origin = safeOrigin(req)
      const continuationToken = token
      const protectionCookie = vercelProtectionCookie(req)
      after(async () => {
        try {
          const result = await continueListingAiApprovalQueueScan({
            supabase, runId, continuationToken,
          })
          if (result.shouldContinue) await dispatch(origin, runId, continuationToken, protectionCookie)
        } catch (error) {
          const code = error instanceof Error ? error.message : "TOP20_CONTINUATION_FAILED"
          if (["TOP10_SCAN_LEASE_ACTIVE", "TOP10_SCAN_CONCURRENT_UPDATE"].includes(code)) return
          await markListingAiApprovalQueueScanFailed({
            supabase, runId, continuationToken,
            errorCode: /^[A-Z0-9_]+$/.test(code) ? code : "TOP20_CONTINUATION_FAILED",
          })
        }
      })
    }
    return listingAiResponse({ success: true, result: {
      runId, status: run.automation_status,
      accepted: shouldRun,
      openAiCalls: 0, ebayWrites: 0, canPublish: false,
    } }, shouldRun ? 202 : 200)
  } catch (error) {
    const code = error instanceof Error ? error.message : "TOP20_CONTINUATION_FAILED"
    if (runId && token && !code.includes("TOKEN_REJECTED") && !code.includes("AUTH_REQUIRED")) {
      try {
        await markListingAiApprovalQueueScanFailed({
          supabase: getSupabaseAdminClient(), runId, continuationToken: token,
          errorCode: /^[A-Z0-9_]+$/.test(code) ? code : "TOP20_CONTINUATION_FAILED",
        })
      } catch {
        // Never replace the original sanitized failure with cleanup detail.
      }
    }
    return listingAiFailure(error)
  } finally {
    token = ""
  }
}
