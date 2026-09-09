import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "../supabase-admin"
import { SELLER_OS_ACCESS_ROLES, type SellerOsAccessRole } from "../seller-os-access-control"
import { getEbaySellerAccountScopeConfiguration } from "../ebay/ebay-seller-account-scope"
import { readMayelImageWorkspaceV1, prepareMayelImageReviewV1, confirmMayelImageQueueV1 } from "./mayel-image-workspace-v1"

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
// Invoked only after the existing revenue-engine route's user authentication,
// same-origin and dedicated-preprod checks. No additional API surface or monitor.
export async function handleMayelImageWorkspaceV1(input: {
  body: unknown; actorUserId: string; accessRole: SellerOsAccessRole; traceId: string
}) {
  const { traceId } = input
  if (![SELLER_OS_ACCESS_ROLES.owner, SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator].includes(input.accessRole))
    return reply({ success: false, error: "MAYEL_WORKSPACE_ROLE_REQUIRED", traceId }, 403)
  try {
    if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
    const body = input.body as Record<string, unknown>
    if (body.mode !== "IMAGE_WORKSPACE" || !["READ", "PREPARE_REVIEW", "CONFIRM_QUEUE"].includes(String(body.action)) ||
        Object.keys(body).some(key => !["mode", "action", "itemIds", "itemId", "taskId", "assetId", "experimentId", "humanQa", "replaceMainImage", "expectedSourceDigest"].includes(key)))
      throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw Error("MAYEL_WORKSPACE_ACCOUNT_REQUIRED")
    const scope = { supabase: getSupabaseAdminClient(), accountKey, actorUserId: input.actorUserId }
    if (body.action === "READ") {
      if (!Array.isArray(body.itemIds) || body.itemIds.some(id => typeof id !== "string")) throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
      return reply({ success: true, ...await readMayelImageWorkspaceV1({ ...scope, itemIds: body.itemIds as string[] }), traceId })
    }
    const itemId = body.itemId
    if (typeof itemId !== "string" || !/^\d{9,20}$/.test(itemId) ||
        [body.assetId, ...(body.action === "PREPARE_REVIEW" && body.taskId === null ? [] : [body.taskId])].some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)))
      throw Error("MAYEL_WORKSPACE_INPUT_INVALID")
    const authority = await scope.supabase.from("ebay_mayel_visual_delegation_authorities_v1")
      .select("id,main_image_authority,owner_per_image_approval,owner_per_listing_visual_approval")
      .eq("marketplace_account_key", accountKey).eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE").is("revoked_at", null).maybeSingle()
    if (authority.error || !authority.data || authority.data.main_image_authority !== true ||
        authority.data.owner_per_image_approval !== false || authority.data.owner_per_listing_visual_approval !== false)
      return reply({ success: false, error: "MAYEL_VISUAL_DELEGATION_REQUIRED", traceId }, 403)
    if (body.action === "PREPARE_REVIEW") {
      await prepareMayelImageReviewV1({ ...scope, itemId, taskId: body.taskId === null ? null : String(body.taskId), experimentId: String(body.experimentId), assetId: String(body.assetId) })
    } else {
      await confirmMayelImageQueueV1({ ...scope, itemId, taskId: String(body.taskId), assetId: String(body.assetId),
        humanQa: body.humanQa, replaceMainImage: body.replaceMainImage === true, expectedSourceDigest: typeof body.expectedSourceDigest === "string" ? body.expectedSourceDigest : "" })
    }
    return reply({ success: true, ...await readMayelImageWorkspaceV1({ ...scope, itemIds: [itemId] }), traceId })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "MAYEL_WORKSPACE_REQUEST_FAILED"
    return reply({ success: false, error: code, traceId }, code.includes("FAILED") ? 503 : 409)
  }
}
