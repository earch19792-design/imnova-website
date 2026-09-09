export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateSellerOsApiRequest } from "@/lib/supabase-admin"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"
import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { readMayelImageWorkspaceV1, prepareMayelImageReviewV1, confirmMayelImageQueueV1 } from "@/lib/seller-os/mayel-image-workspace-v1"
import { revenueTraceIdV1 } from "@/lib/seller-os/revenue-first-diagnostics-v1"

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
export async function POST(request: Request) {
  const traceId = revenueTraceIdV1(request.headers.get("x-seller-os-trace-id"))
  if (getEbayProRuntimeBoundary({ pathname: new URL(request.url).pathname, method: request.method }).runtime !== "seller_os_dedicated_preprod" ||
      !isSameSellerOsAdminOriginV1({ requestUrl: request.url, origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site") }))
    return reply({ success: false, error: "MAYEL_WORKSPACE_PREPROD_REQUIRED", traceId }, 403)
  const auth = await validateSellerOsApiRequest(request)
  if (!auth.ok || auth.authenticationMode !== "seller_os_user" || !auth.userId ||
      ![SELLER_OS_ACCESS_ROLES.owner, SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator].includes(auth.accessRole!))
    return reply({ success: false, error: "MAYEL_WORKSPACE_ROLE_REQUIRED", traceId }, 403)
  try {
    const raw = await request.text()
    if (raw.length > 8000) return reply({ success: false, error: "MAYEL_WORKSPACE_INPUT_TOO_LARGE", traceId }, 413)
    const body = JSON.parse(raw)
    if (!body || !["READ", "PREPARE_REVIEW", "CONFIRM_QUEUE"].includes(body.mode) ||
        Object.keys(body).some(key => !["mode", "itemIds", "itemId", "taskId", "assetId", "experimentId", "humanQa", "replaceMainImage", "expectedSourceDigest"].includes(key)))
      throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw Error("MAYEL_WORKSPACE_ACCOUNT_REQUIRED")
    const input = { supabase: getSupabaseAdminClient(), accountKey, actorUserId: auth.userId }
    if (body.mode === "READ") {
      if (!Array.isArray(body.itemIds)) throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
      return reply({ success: true, ...await readMayelImageWorkspaceV1({ ...input, itemIds: body.itemIds }), traceId })
    }
    if (typeof body.itemId !== "string" || !/^\d{9,20}$/.test(body.itemId) ||
        [body.assetId, ...(body.mode === "PREPARE_REVIEW" && body.taskId === null ? [] : [body.taskId])].some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)))
      throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
    const authority = await input.supabase.from("ebay_mayel_visual_delegation_authorities_v1")
      .select("id,main_image_authority,owner_per_image_approval,owner_per_listing_visual_approval")
      .eq("marketplace_account_key", accountKey).eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE").is("revoked_at", null).maybeSingle()
    if (authority.error || !authority.data || authority.data.main_image_authority !== true ||
        authority.data.owner_per_image_approval !== false || authority.data.owner_per_listing_visual_approval !== false)
      return reply({ success: false, error: "MAYEL_VISUAL_DELEGATION_REQUIRED", traceId }, 403)
    if (body.mode === "PREPARE_REVIEW") {
      await prepareMayelImageReviewV1({ ...input, itemId: body.itemId, taskId: body.taskId, experimentId: body.experimentId, assetId: body.assetId })
    } else {
      await confirmMayelImageQueueV1({ ...input, itemId: body.itemId, taskId: body.taskId, assetId: body.assetId,
        humanQa: body.humanQa, replaceMainImage: body.replaceMainImage, expectedSourceDigest: body.expectedSourceDigest })
    }
    return reply({ success: true, ...await readMayelImageWorkspaceV1({ ...input, itemIds: [body.itemId] }), traceId })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "MAYEL_WORKSPACE_REQUEST_FAILED"
    return reply({ success: false, error: code, traceId }, code.includes("FAILED") ? 503 : 409)
  }
}
