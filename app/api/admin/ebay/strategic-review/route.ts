export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 40

import { NextResponse } from "next/server"

import { loadSellerOsAssistantMonitorV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { buildDailyStrategicBriefFallbackV1, buildDailyStrategicReviewScheduleContractV1,
  buildLargeVolumeAiPolicyV1, buildSystemReviewBundleV1,
  planEventDrivenStrategicReviewV1 } from
  "@/lib/ebay/ebay-seller-os-ai-strategic-intelligence-v1"
import { getSellerOsAiRuntimeStatusV1, runSellerOsStrategicReviewV1 } from
  "@/lib/ebay/ebay-seller-os-strategic-agent-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { getSellerOsChatGptConnectionStateV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-server-v1"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const requestWindows = new Map<string, number[]>()

function rateAllowed(key: string, now = Date.now()) {
  const recent = (requestWindows.get(key) ?? []).filter((value) => now - value < 60_000)
  if (recent.length >= 3) return false
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
    error: "SELLER_OS_STRATEGIC_REVIEW_PREVIEW_ONLY" }, { status: 403 }), auth }
  return { response: null, auth }
}

async function evidence() {
  const monitor = await loadSellerOsAssistantMonitorV1()
  const bundle = buildSystemReviewBundleV1({ monitor })
  return { monitor, bundle,
    deterministicBrief: buildDailyStrategicBriefFallbackV1({ bundle }) }
}

export async function GET(req: Request) {
  const access = await authorize(req)
  if (access.response) return access.response
  let current: Awaited<ReturnType<typeof evidence>>
  try { current = await evidence() } catch {
    return NextResponse.json({ success: false,
      error: "STRATEGIC_REVIEW_EVIDENCE_READ_FAILED_CLOSED",
      credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }, { status: 503 })
  }
  return NextResponse.json({ success: true, bundle: current.bundle,
    dailyBrief: current.deterministicBrief,
    aiRuntime: getSellerOsAiRuntimeStatusV1(),
    chatGptConnection: getSellerOsChatGptConnectionStateV1(),
    scheduler: buildDailyStrategicReviewScheduleContractV1({}),
    scalePolicy: [27, 100, 1_000, 5_000].map(buildLargeVolumeAiPolicyV1),
    persistence: { findings: "PREVIEW_EPHEMERAL",
      activation: "PERSISTENCE_ACTIVATION_REQUIRES_AUTHORIZATION", remoteDdlExecuted: false },
  }, { headers: { "Cache-Control": "private, no-store",
    "X-Seller-OS-Strategic-Review": "READ_ONLY" } })
}

export async function POST(req: Request) {
  const access = await authorize(req)
  if (access.response) return access.response
  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 5_000) return NextResponse.json({ success: false,
    error: "STRATEGIC_REVIEW_REQUEST_TOO_LARGE" }, { status: 413 })
  const key = access.auth.userId ?? "service-role-admin"
  if (!rateAllowed(key)) return NextResponse.json({ success: false,
    error: "STRATEGIC_REVIEW_RATE_LIMITED" }, { status: 429 })
  let body: { previousMaterialFingerprint?: unknown; mode?: unknown;
    event?: { eventType?: unknown; entityRefs?: unknown; observedAt?: unknown;
      previousEventFingerprint?: unknown; previousReviewedAt?: unknown } } = {}
  try { body = await req.json() as typeof body } catch {
    return NextResponse.json({ success: false, error: "STRATEGIC_REVIEW_INVALID_JSON" },
      { status: 400 })
  }
  const previousMaterialFingerprint = typeof body.previousMaterialFingerprint === "string"
    ? body.previousMaterialFingerprint.slice(0, 100) : null
  let current: Awaited<ReturnType<typeof evidence>>
  try { current = await evidence() } catch {
    return NextResponse.json({ success: false,
      error: "STRATEGIC_REVIEW_EVIDENCE_READ_FAILED_CLOSED",
      credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }, { status: 503 })
  }
  const eventPlan = body.mode === "EVENT" && body.event ? planEventDrivenStrategicReviewV1({
    eventType: typeof body.event.eventType === "string"
      ? body.event.eventType.slice(0, 80) : "INVALID_EVENT",
    entityRefs: Array.isArray(body.event.entityRefs) ? body.event.entityRefs
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120))
      .filter(Boolean).slice(0, 25) : [],
    observedAt: typeof body.event.observedAt === "string" &&
      Number.isFinite(Date.parse(body.event.observedAt))
      ? body.event.observedAt : current.monitor.generatedAt,
    previousEventFingerprint: typeof body.event.previousEventFingerprint === "string"
      ? body.event.previousEventFingerprint.slice(0, 100) : null,
    previousReviewedAt: typeof body.event.previousReviewedAt === "string"
      ? body.event.previousReviewedAt : null,
  }) : null
  if (eventPlan && !eventPlan.shouldQueueReview) return NextResponse.json({ success: true,
    review: { status: "EVENT_DEFERRED_BY_DETERMINISTIC_GATE", eventPlan,
      dailyBrief: current.deterministicBrief, aiCallCount: 0, marketplaceWrites: 0 },
    persistence: "PREVIEW_EPHEMERAL_NO_REMOTE_DDL", marketplaceWrites: 0 },
  { headers: { "Cache-Control": "private, no-store",
    "X-Seller-OS-Strategic-Review": "READ_ONLY" } })
  const review = await runSellerOsStrategicReviewV1({ monitor: current.monitor,
    bundle: current.bundle, previousMaterialFingerprint })
  return NextResponse.json({ success: true, review: { ...review, eventPlan },
    persistence: "PREVIEW_EPHEMERAL_NO_REMOTE_DDL", marketplaceWrites: 0 },
  { headers: { "Cache-Control": "private, no-store",
    "X-Seller-OS-Strategic-Review": "READ_ONLY" } })
}
