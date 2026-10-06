export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  capture888LotsManualDualMarketV1,
  SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
} from "@/lib/marketplace/seller-os-888lots-manual-capture-v1"
import {
  preview888LotsAuthorizedExportV1,
  preview888LotsDualMarketplaceSourcingV1,
  SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1,
  SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
  SELLER_OS_888LOTS_MAX_PREVIEW_ROWS,
  SELLER_OS_888LOTS_SOURCE_KEY,
  SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1,
} from "@/lib/marketplace/seller-os-888lots-supplier-onboarding-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status,
    headers: { "Cache-Control": "private, no-store, max-age=0" } })
}

async function authorized(req: Request) {
  const auth = await validateAdminApiRequest(req)
  return auth.ok && auth.authenticationMode === "admin_user" && auth.userId
    ? auth : null
}

export async function GET(req: Request) {
  const auth = await authorized(req)
  if (!auth) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) {
    return json({ success: false, error: "SELLER_OS_CANONICAL_ACCOUNT_REQUIRED" }, 503)
  }
  const supabase = getSupabaseAdminClient()
  const recent = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,product_title,commercial_lifecycle_stage,commercial_decision,commercial_next_best_evidence,commercial_evidence_freshness,commercial_memory,commercial_updated_at")
    .eq("commercial_account_key", account.accountKey)
    .like("candidate_key", `${SELLER_OS_888LOTS_SOURCE_KEY}:%`)
    .order("commercial_updated_at", { ascending: false }).limit(25)
  if (recent.error) {
    return json({ success: false, error: "SELLER_OS_888LOTS_MEMORY_READ_FAILED" }, 503)
  }
  return json({
    success: true,
    contractVersion: SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    supplierAccountStatus: "PUBLIC_CATALOG_AVAILABLE_ACCOUNT_PENDING_APPROVAL",
    integrationMode: "PUBLIC_CATALOG_OWNER_MANUAL_CAPTURE",
    marketplaces: ["EBAY_US", "AMAZON_US"],
    dualMarketContractVersion: SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1,
    templateHeaders: SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1,
    maximumRows: SELLER_OS_888LOTS_MAX_PREVIEW_ROWS,
    manualCaptureContractVersion: SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
    recentCandidates: recent.data ?? [],
    nextStep: "CAPTURE_PUBLIC_888LOTS_PRODUCT_AND_MARKETPLACE_EVIDENCE",
    safety: { scrapeRequests: 0, internalDatabaseWrites: true, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0, canPublish: false },
  })
}

export async function POST(req: Request) {
  const auth = await authorized(req)
  if (!auth) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const body = record(await req.json())
    if (body.action === "CAPTURE_MANUAL_DUAL_MARKETPLACE_SOURCING") {
      const now = new Date()
      const capturedAt = typeof body.capturedAt === "string"
        ? body.capturedAt : now.toISOString()
      const evaluation = preview888LotsDualMarketplaceSourcingV1({
        supplierRow: body.supplierRow,
        capturedAt,
        marketplaceEvidence: body.marketplaceEvidence,
        now,
        sourceFileDigest: typeof body.sourceFileDigest === "string"
          ? body.sourceFileDigest : null,
      })
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey || !account.accountAlias) {
        return json({ success: false,
          error: "SELLER_OS_CANONICAL_ACCOUNT_REQUIRED" }, 503)
      }
      const persistence = await capture888LotsManualDualMarketV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        accountAlias: account.accountAlias, ownerUserId: auth.userId,
        evaluation, now,
      })
      return json({ success: true, ...evaluation, status: "CAPTURED",
        persistence })
    }
    if (body.action === "PREVIEW_DUAL_MARKETPLACE_SOURCING") {
      const capturedAt = typeof body.capturedAt === "string"
        ? body.capturedAt : new Date().toISOString()
      const result = preview888LotsDualMarketplaceSourcingV1({
        supplierRow: body.supplierRow,
        capturedAt,
        marketplaceEvidence: body.marketplaceEvidence,
        sourceFileDigest: typeof body.sourceFileDigest === "string"
          ? body.sourceFileDigest : null,
      })
      return json({ success: true, ...result })
    }
    if (body.action !== "PREVIEW_AUTHORIZED_EXPORT") {
      return json({ success: false,
        error: "SELLER_OS_888LOTS_ACTION_REQUIRED" }, 400)
    }
    const capturedAt = typeof body.capturedAt === "string"
      ? body.capturedAt : new Date().toISOString()
    const result = preview888LotsAuthorizedExportV1({
      rows: body.rows,
      capturedAt,
      sourceFileDigest: typeof body.sourceFileDigest === "string"
        ? body.sourceFileDigest : null,
    })
    return json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    return json({ success: false,
      error: /^SELLER_OS_888LOTS_[A-Z0-9_]+$/.test(message)
        ? message : "SELLER_OS_888LOTS_CAPTURE_FAILED" }, 409)
  }
}
