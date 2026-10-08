export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { readFastLunaTestBatchV1, startUniversalLunaDirectBatchV1 } from
  "@/lib/ebay/ebay-autonomous-stocking-batch-server-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const OWNER_ADMIN_CLIENT = "seller-os-owner-admin-ui-v1"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
  } })
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "FAST_LUNA_TEST_BATCH_FAILED_CLOSED"
}

async function ownerContext(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok || auth.authenticationMode !== "admin_user" ||
      auth.accessRole !== "OWNER_ADMIN" || !auth.userId) return null
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw new Error("EBAY_US_ACCOUNT_SCOPE_MISSING")
  return { supabase: getSupabaseAdminClient(), accountKey,
    ownerUserId: auth.userId }
}

export async function GET(request: Request) {
  try {
    const context = await ownerContext(request)
    if (!context) return response({ success: false,
      error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
    const batchId = new URL(request.url).searchParams.get("batchId")?.trim()
    if (batchId && !UUID.test(batchId)) return response({ success: false,
      error: "FAST_LUNA_TEST_BATCH_ID_INVALID" }, 400)
    const result = await readFastLunaTestBatchV1({
      ...context, batchId: batchId || undefined,
    })
    return response({ success: true, result,
      safety: { commandWrites: 0, marketplaceWrites: 0,
        publicationWrites: 0 } })
  } catch (error) {
    return response({ success: false, error: safeCode(error),
      safety: { commandWrites: 0, marketplaceWrites: 0,
        publicationWrites: 0 } }, 409)
  }
}

export async function POST(request: Request) {
  try {
    const context = await ownerContext(request)
    if (!context) return response({ success: false,
      error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
    const body = await request.json() as Record<string, unknown>
    const targetCount = Number(body.targetCount)
    const clientIdempotencyKey = typeof body.clientIdempotencyKey === "string"
      ? body.clientIdempotencyKey.trim() : ""
    const productReferences = Array.isArray(body.productReferences)
      ? body.productReferences.map((entry) => typeof entry === "string"
        ? entry.trim() : "") : []
    const result = await startUniversalLunaDirectBatchV1({
      ...context,
      commandClientId: OWNER_ADMIN_CLIENT,
      targetCount,
      productReferences,
      clientIdempotencyKey,
    })
    return response({ success: true, result,
      safety: { commandWrites: 1, marketplaceWrites: 0,
        publicationWrites: 0,
        execution: "SEQUENTIAL_BACKGROUND_CURRENT_PUBLISHER" } }, 202)
  } catch (error) {
    const code = safeCode(error)
    const status = code === "FAST_LUNA_TEST_BATCH_REQUEST_INVALID" ||
      code.startsWith("UNIVERSAL_LUNA_PRODUCT_") ||
      code === "UNIVERSAL_LUNA_DIRECT_REQUEST_INVALID"
      ? 400 : code === "FAST_LUNA_TEST_BATCH_ALREADY_ACTIVE" ? 409 : 409
    return response({ success: false, error: code,
      safety: { commandWrites: 0, marketplaceWrites: 0,
        publicationWrites: 0 } }, status)
  }
}
