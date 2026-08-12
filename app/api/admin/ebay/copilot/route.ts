export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 40

import { NextResponse } from "next/server"

import { loadSellerOsAssistantMonitorV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { getSellerOsAiRuntimeStatusV1, runSellerOsCopilotV1,
  type SellerOsCopilotContextRefV1 } from
  "@/lib/ebay/ebay-seller-os-strategic-agent-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const requestWindows = new Map<string, number[]>()

function rateAllowed(key: string, now = Date.now()) {
  const recent = (requestWindows.get(key) ?? []).filter((value) => now - value < 60_000)
  if (recent.length >= 6) return false
  requestWindows.set(key, [...recent, now])
  if (requestWindows.size > 200) requestWindows.clear()
  return true
}

async function authorize(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return { response: NextResponse.json({ success: false,
    error: auth.error ?? "admin_forbidden" }, { status: auth.status || 403 }), auth }
  const boundary = getEbayProRuntimeBoundary({ pathname: new URL(req.url).pathname,
    method: req.method })
  if (boundary.blocked) return { response: NextResponse.json({ success: false,
    error: "SELLER_OS_COPILOT_PREVIEW_ONLY" }, { status: 403 }), auth }
  return { response: null, auth }
}

export async function GET(req: Request) {
  const access = await authorize(req)
  if (access.response) return access.response
  return NextResponse.json({ success: true,
    name: "Seller OS Copilot",
    scope: "INTERNAL_SELLER_OS_AGENT_NOT_CHATGPT_SESSION",
    status: getSellerOsAiRuntimeStatusV1(),
    policy: { readOnly: true, maximumTurns: 4, maximumRequestsPerMinute: 6,
      arbitrarySqlAllowed: false, arbitraryUrlFetchAllowed: false,
      imageGenerationEnabled: false, marketplaceWrites: 0, whatsappSends: 0 } })
}

export async function POST(req: Request) {
  const access = await authorize(req)
  if (access.response) return access.response
  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 20_000) return NextResponse.json({ success: false,
    error: "COPILOT_REQUEST_TOO_LARGE" }, { status: 413 })
  const key = access.auth.userId ?? "service-role-admin"
  if (!rateAllowed(key)) return NextResponse.json({ success: false,
    error: "COPILOT_RATE_LIMITED" }, { status: 429 })
  let body: { prompt?: unknown; contextRef?: SellerOsCopilotContextRefV1 | null }
  try { body = await req.json() as typeof body } catch {
    return NextResponse.json({ success: false, error: "COPILOT_INVALID_JSON" }, { status: 400 })
  }
  let result: Awaited<ReturnType<typeof runSellerOsCopilotV1>>
  try {
    const monitor = await loadSellerOsAssistantMonitorV1()
    result = await runSellerOsCopilotV1({ monitor, prompt: body.prompt,
      contextRef: body.contextRef })
  } catch {
    return NextResponse.json({ success: false, error: "COPILOT_EVIDENCE_READ_FAILED_CLOSED",
      credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }, { status: 503 })
  }
  const failed = ["COPILOT_PROMPT_REQUIRED", "COPILOT_SENSITIVE_INPUT_REJECTED"].includes(result.status)
  return NextResponse.json({ success: !failed, result }, { status: failed ? 400 : 200,
    headers: { "Cache-Control": "private, no-store", "X-Seller-OS-Copilot": "READ_ONLY" } })
}
