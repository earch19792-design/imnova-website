export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { loadSellerOsAssistantMonitorSnapshotV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { buildDailyStrategicBriefFallbackV1, buildDailyStrategicReviewScheduleContractV1,
  buildLargeVolumeAiPolicyV1, buildSystemReviewBundleV1,
  planEventDrivenStrategicReviewV1 } from
  "@/lib/ebay/ebay-seller-os-ai-strategic-intelligence-v1"
import { getSellerOsAiRuntimeStatusV1, runSellerOsStrategicReviewV1 } from
  "@/lib/ebay/ebay-seller-os-strategic-agent-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSellerOsChatGptConnectionStateV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-server-v1"
import { buildSellerOsCurrentLiveVisualQualityV1 } from
  "@/lib/ebay/ebay-seller-os-visual-quality-v1"
import { createSellerOsVisualVariantsV1, loadSellerOsVisualVariantsV1,
  sellerOsVisualVariantSafeCodeV1, updateSellerOsVisualVariantV1 } from
  "@/lib/ebay/ebay-seller-os-visual-variant-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

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
  const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw new Error("SELLER_ACCOUNT_SCOPE_REQUIRED")
  const [visualQuality, visualVariants] = await Promise.all([
    buildSellerOsCurrentLiveVisualQualityV1({ monitor }),
    loadSellerOsVisualVariantsV1({ supabase: getSupabaseAdminClient(),
      accountKey }),
  ])
  const bundle = { ...buildSystemReviewBundleV1({ monitor }), visualQuality,
    visualVariants }
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
    safety: { operatorEbayLoginRequired: false, secretExposure: 0,
      marketplaceWrites: 0, customerProductionUntouched: true },
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
    ebayItemId?: unknown; findingCode?: unknown; variantCount?: unknown;
    assetId?: unknown; action?: unknown;
    event?: { eventType?: unknown; entityRefs?: unknown; observedAt?: unknown;
      previousEventFingerprint?: unknown; previousReviewedAt?: unknown } } = {}
  try { body = await req.json() as typeof body } catch {
    return NextResponse.json({ success: false, error: "STRATEGIC_REVIEW_INVALID_JSON" },
      { status: 400 })
  }
  const previousMaterialFingerprint = typeof body.previousMaterialFingerprint === "string"
    ? body.previousMaterialFingerprint.slice(0, 100) : null
  if (body.mode === "VISUAL_VARIANT_ACTION") {
    const action = body.action === "USE_IN_EXPERIMENT" || body.action === "DISCARD"
      ? body.action : null
    const assetId = typeof body.assetId === "string" &&
      /^[0-9a-f-]{36}$/i.test(body.assetId) ? body.assetId : null
    if (!action || !assetId) return NextResponse.json({ success: false,
      error: "VISUAL_VARIANT_ACTION_INVALID" }, { status: 400 })
    try {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("SELLER_ACCOUNT_SCOPE_REQUIRED")
      const result = await updateSellerOsVisualVariantV1({
        supabase: getSupabaseAdminClient(),
        accountKey,
        assetId, action })
      return NextResponse.json({ success: true, visualVariantAction: result,
        marketplaceWrites: 0 }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false,
        error: sellerOsVisualVariantSafeCodeV1(error), marketplaceWrites: 0 },
      { status: 409 })
    }
  }
  if (body.mode === "VISUAL_VARIANT_CREATE") {
    const ebayItemId = typeof body.ebayItemId === "string" &&
      /^\d{9,15}$/.test(body.ebayItemId) ? body.ebayItemId : ""
    const findingCode = typeof body.findingCode === "string"
      ? body.findingCode.slice(0, 80) : ""
    const allowedFinding = ["LOW_FRAME_UTILIZATION", "EXCESS_DEAD_SPACE",
      "OFF_CENTER_PRODUCT", "EDGE_CROPPING_RISK",
      "WHITE_BACKGROUND_NOT_PROVEN"].includes(findingCode)
    if (!ebayItemId || !allowedFinding) return NextResponse.json({ success: false,
      error: "VISUAL_VARIANT_CREATE_INVALID" }, { status: 400 })
    try {
      const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("SELLER_ACCOUNT_SCOPE_REQUIRED")
      const result = await createSellerOsVisualVariantsV1({
        supabase: getSupabaseAdminClient(), monitor,
        accountKey,
        actorId: access.auth.userId ?? null, ebayItemId,
        findingCode: findingCode as "LOW_FRAME_UTILIZATION" |
          "EXCESS_DEAD_SPACE" | "OFF_CENTER_PRODUCT" |
          "EDGE_CROPPING_RISK" | "WHITE_BACKGROUND_NOT_PROVEN",
        variantCount: Number(body.variantCount ?? 1),
        apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
        model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
      })
      return NextResponse.json({ success: true, visualVariantGeneration: result,
        marketplaceWrites: 0 }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false,
        error: sellerOsVisualVariantSafeCodeV1(error), marketplaceWrites: 0,
        automaticRetryOccurred: false }, { status: 409 })
    }
  }
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
