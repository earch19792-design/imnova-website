export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  assessProductCaseOperationalReadinessV1,
  assessStockGuardV2,
  calculateCommercialEconomicsV1,
  captureLunaProductVariantV1,
  linkSupplierToEbayIdentityV1,
} from "@/lib/ebay/ebay-commercial-operational-readiness-v1"
import { parseEbayListingQualityReportV1 } from
  "@/lib/ebay/ebay-listing-quality-report-import-v1"
import { renderCommercialWhatsAppAlertDryRunV1,
  WHATSAPP_TEMPLATE_DEFINITIONS_V1 } from
  "@/lib/ebay/ebay-commercial-whatsapp-alert-engine-v1"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "OPERATIONAL_READINESS_FAILED"
  return /^[A-Z0-9_]+$/.test(message) ? message : "OPERATIONAL_READINESS_FAILED"
}

function capabilities() {
  const ordersConfigured = Boolean(process.env.EBAY_COMMERCIAL_ORDERS_CLIENT_ID &&
    process.env.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET &&
    process.env.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN)
  return {
    marketResearch: "AVAILABLE",
    qualityReport: "READY_FOR_REAL_SAMPLE",
    qualityReportAcquisition: "HUMAN_ASSISTED_CSV_JSON",
    orders: ordersConfigured ? "READY_FOR_READONLY_RUNTIME" : "AUTH_PENDING",
    lunaCapture: "READY_BUT_NOT_ACTIVATED",
    supplierIdentity: "EVIDENCE_GATED",
    stockGuard: "READY_BUT_NOT_ACTIVATED",
    economics: "EVIDENCE_GATED",
    whatsapp: "DRY_RUN_ONLY",
    experimentHardOverride: "AVAILABLE",
    remoteDdlRequired: false,
  }
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" },
    { status: auth.status || 403 })
  const current = capabilities()
  return NextResponse.json({
    success: true,
    capabilities: current,
    templates: WHATSAPP_TEMPLATE_DEFINITIONS_V1,
    readiness: assessProductCaseOperationalReadinessV1({
      marketResearchReady: true, supplierCaptureReady: true, supplierIdentityReady: false,
      stockGuardReady: true, economicsReady: false, qualityReportReady: false,
      ordersReady: current.orders !== "AUTH_PENDING", whatsappDryRunReady: true,
      experimentOverrideReady: true,
    }),
    safety: { ebayWrites: 0, registryWrites: 0, inventoryWrites: 0,
      fulfillmentWrites: 0, whatsappSends: 0, productCaseMutations: 0, remoteDdl: 0 },
  })
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" },
    { status: auth.status || 403 })
  try {
    const body = record(await req.json())
    const input = record(body.input)
    let result: unknown
    if (body.action === "IMPORT_QUALITY_REPORT") {
      result = parseEbayListingQualityReportV1({
        format: input.format === "JSON" ? "JSON" : "CSV",
        fileName: typeof input.fileName === "string" ? input.fileName : "quality-report",
        content: typeof input.content === "string" ? input.content : "",
      })
    } else if (body.action === "CAPTURE_LUNA") {
      result = captureLunaProductVariantV1(input as never)
    } else if (body.action === "LINK_SUPPLIER_IDENTITY") {
      result = linkSupplierToEbayIdentityV1(input as never)
    } else if (body.action === "ASSESS_STOCK_GUARD") {
      result = assessStockGuardV2(input as never)
    } else if (body.action === "CALCULATE_ECONOMICS") {
      result = calculateCommercialEconomicsV1(input as never)
    } else if (body.action === "PREVIEW_WHATSAPP") {
      result = renderCommercialWhatsAppAlertDryRunV1(input as never)
    } else throw new Error("OPERATIONAL_READINESS_ACTION_INVALID")
    return NextResponse.json({ success: true, result, dispatchAllowed: false,
      marketplaceWrites: 0, registryBusinessDataMutations: 0, whatsappSends: 0,
      productCaseMutations: 0 })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 400 })
  }
}
