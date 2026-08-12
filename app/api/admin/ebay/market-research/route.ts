import { NextResponse } from "next/server"

import {
  EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1,
  buildMarketOpportunityResearchV1,
  marketEvidenceFromKeywordDemandReportV1,
  normalizeMarketResearchRequestV1,
  parseManualMarketEvidenceV1,
  type MarketEvidenceV1,
} from "@/lib/ebay/ebay-market-opportunity-research-v1"
import { runEbaySellerKeywordDemandValidation } from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import type { OfficialSoldEvidenceExport } from "@/lib/ebay/ebay-official-sold-evidence-import"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const SAFE_ERROR = /^[A-Z0-9_]+$/
const MANUAL_EXPORTS = new Set<OfficialSoldEvidenceExport>([
  "EBAY_PRODUCT_RESEARCH_EXPORT",
  "EBAY_SELLER_HUB_EXPORT",
  "EBAY_MARKETPLACE_INSIGHTS_EXPORT",
])

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return SAFE_ERROR.test(message) ? message : "MARKET_RESEARCH_READ_FAILED"
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }

  return NextResponse.json({
    success: true,
    sourceCapabilities: EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1,
    executionMode: "READ_ONLY",
    marketplaceWrites: 0,
    productCaseMutations: 0,
  })
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }

  try {
    const raw = record(await req.json())
    const request = normalizeMarketResearchRequestV1(raw.request)
    const manual = record(raw.manualEvidence)
    const sourceLimitations: string[] = []
    let manualEvidence: MarketEvidenceV1[] = []
    if (typeof manual.content === "string" && manual.content.trim()) {
      const sourceExportType = MANUAL_EXPORTS.has(manual.sourceExportType as OfficialSoldEvidenceExport)
        ? manual.sourceExportType as OfficialSoldEvidenceExport
        : "EBAY_PRODUCT_RESEARCH_EXPORT"
      const parsed = parseManualMarketEvidenceV1({
        format: manual.format === "JSON" ? "JSON" : "CSV",
        sourceExportType,
        content: manual.content,
        now: new Date(),
      })
      if (parsed.evidenceScope === "MARKET_WIDE_SOLD_EVIDENCE" &&
          parsed.marketWideSchemaConfirmed) {
        manualEvidence = parsed.observations
      } else {
        sourceLimitations.push("MANUAL_EVIDENCE_NOT_MARKET_WIDE")
      }
    }

    let liveEvidence: MarketEvidenceV1[] = []
    try {
      const report = await runEbaySellerKeywordDemandValidation({
        productName: request.seedValue,
        productTitle: request.seedType === "SEED_PRODUCT_TITLE" ? request.seedValue : null,
        variantTitle: request.seedType === "SEED_PRODUCT_FAMILY" ? request.seedValue : null,
      })
      liveEvidence = marketEvidenceFromKeywordDemandReportV1(report)
    } catch (error) {
      sourceLimitations.push(safeError(error))
    }

    const evidence = [...liveEvidence, ...manualEvidence]
    const activeMarketStatus = evidence.some((row) => row.activeListing)
      ? "AVAILABLE" as const : "UNPROVEN" as const
    const soldHistoryStatus = evidence.some((row) => row.confirmedSold)
      ? "PARTIAL" as const : "UNAVAILABLE" as const
    const research = buildMarketOpportunityResearchV1({
      request,
      evidence,
      activeMarketStatus,
      soldHistoryStatus,
      paginationCoverage: "BOUNDED_QUERY_AND_DETAIL_SAMPLE",
      sourceLimitations,
      observedAt: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      research,
      executionMode: "READ_ONLY",
      marketplaceWrites: 0,
      registryBusinessDataMutations: 0,
      productCaseMutations: 0,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 400 },
    )
  }
}
