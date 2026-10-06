export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  preview888LotsAuthorizedExportV1,
  preview888LotsDualMarketplaceSourcingV1,
  SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1,
  SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
  SELLER_OS_888LOTS_MAX_PREVIEW_ROWS,
  SELLER_OS_888LOTS_SOURCE_KEY,
  SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1,
} from "@/lib/marketplace/seller-os-888lots-supplier-onboarding-v1"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

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
}

export async function GET(req: Request) {
  if (!await authorized(req)) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  return json({
    success: true,
    contractVersion: SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    supplierAccountStatus: "PENDING_APPROVAL",
    integrationMode: "AUTHORIZED_EXPORT_PREVIEW_ONLY",
    marketplaces: ["EBAY_US", "AMAZON_US"],
    dualMarketContractVersion: SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1,
    templateHeaders: SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1,
    maximumRows: SELLER_OS_888LOTS_MAX_PREVIEW_ROWS,
    nextStep: "UPLOAD_OFFICIAL_AUTHORIZED_EXPORT_AFTER_ACCOUNT_APPROVAL",
    safety: { scrapeRequests: 0, databaseWrites: 0, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0, canPublish: false },
  })
}

export async function POST(req: Request) {
  if (!await authorized(req)) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const body = record(await req.json())
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
        error: "SELLER_OS_888LOTS_PREVIEW_ACTION_REQUIRED" }, 400)
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
        ? message : "SELLER_OS_888LOTS_PREVIEW_FAILED" }, 409)
  }
}
