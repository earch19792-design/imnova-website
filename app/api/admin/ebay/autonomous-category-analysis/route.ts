export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { runGoldenStockingBatchV1 } from
  "@/lib/ebay/commercial-golden-path-runtime-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const OWNER_ADMIN_GOLDEN_PATH_CLIENT_V1 = "seller-os-owner-admin-ui-v1"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "AUTONOMOUS_CATEGORY_ANALYSIS_FAILED_CLOSED"
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export async function POST(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok || !auth.userId) return response({ success: false,
    error: auth.ok ? "OWNER_ADMIN_USER_REQUIRED" : auth.error },
  auth.ok ? 403 : auth.status)

  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey || !account.accountAlias) return response({
    success: false, error: "GOLDEN_PATH_CANONICAL_ACCOUNT_REQUIRED" }, 400)

  try {
    const body = record(await request.json())
    const category = typeof body.category === "string"
      ? body.category.trim() : ""
    const scanLimit = body.scanLimit === undefined ? 100
      : Number(body.scanLimit)
    const targetDrafts = body.targetDrafts === undefined ? 10
      : Number(body.targetDrafts)
    if (body.action !== "RUN_STOCKING_BATCH" || !category ||
        category.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(category) ||
        !Number.isSafeInteger(scanLimit) || scanLimit < 10 ||
        scanLimit > 100 || !Number.isSafeInteger(targetDrafts) ||
        targetDrafts < 1 || targetDrafts > 10 || scanLimit < targetDrafts) {
      return response({ success: false,
        error: "AUTONOMOUS_CATEGORY_ANALYSIS_REQUEST_INVALID" }, 400)
    }

    const result = await runGoldenStockingBatchV1({
      supabase: getSupabaseAdminClient(),
      accountKey: account.accountKey,
      accountAlias: account.accountAlias,
      principal: { ownerUserId: auth.userId,
        commandClientId: OWNER_ADMIN_GOLDEN_PATH_CLIENT_V1,
        scopes: Object.freeze(["owner_admin"]) },
      now: new Date(),
      invocationSource: "OWNER_ADMIN_UI",
    }, category, { scanLimit, targetDrafts, targetNetProfit: 0 })

    return response({ success: true, result,
      safety: { marketplaceWrites: 0, supplierPurchases: 0,
        publicationAllowed: false, draftIsLive: false } })
  } catch (error) {
    return response({ success: false, error: safeCode(error),
      safety: { marketplaceWrites: 0, supplierPurchases: 0,
        publicationAllowed: false, draftIsLive: false } }, 400)
  }
}
