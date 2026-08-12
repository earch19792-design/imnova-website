import { NextResponse } from "next/server"

import {
  EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1,
  buildMarketOpportunityResearchV1,
  marketEvidenceFromKeywordDemandReportV1,
  normalizeMarketResearchRequestV1,
  parseManualMarketEvidenceV1,
  type MarketEvidenceV1,
  type MarketResearchRequestV1,
} from "@/lib/ebay/ebay-market-opportunity-research-v1"
import {
  buildCommercialIntelligenceUpgradeV1,
  deriveItemIdCanonicalFamilyBridgeV1,
  resolveCanonicalProductFamilyV1,
} from "@/lib/ebay/ebay-commercial-intelligence-upgrade-v1"
import { buildEbaySellerKeywordDemandValidation } from
  "@/lib/ebay/ebay-seller-keyword-demand-validation"
import { getEbayListingIdentityByLegacyItemId,
  runEbaySellerKeywordDemandValidation } from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
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

function detectedRequest(request: MarketResearchRequestV1): MarketResearchRequestV1 {
  if (request.seedType !== "SEED_AUTO") return request
  const seedType = /^\d{9,19}$/.test(request.seedValue) ? "SEED_ITEM_ID" as const
    : request.seedValue.trim().split(/\s+/).length >= 5 ? "SEED_PRODUCT_TITLE" as const
      : "SEED_QUERY" as const
  return { ...request, seedType }
}

function normalizedQuery(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim()
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
    let request = detectedRequest(normalizeMarketResearchRequestV1(raw.request))
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

    let sourceEvidence: MarketEvidenceV1 | null = null
    let itemIdBridge: ReturnType<typeof deriveItemIdCanonicalFamilyBridgeV1> | null = null
    const liveEvidence: MarketEvidenceV1[] = []
    const queryExecutions: Array<{ query: string; path: string; status: string;
      returnedEvidence: number }> = []
    const queries: Array<{ query: string; path: string }> = []

    if (request.seedType === "SEED_ITEM_ID") {
      try {
        const identity = await getEbayListingIdentityByLegacyItemId(request.seedValue)
        if (identity) {
          const sourceReport = buildEbaySellerKeywordDemandValidation({
            candidate: { productName: identity.title, productTitle: identity.title,
              categoryId: identity.categoryId, gtin: identity.gtin, brand: identity.brand,
              mpn: identity.mpn, model: identity.model, packQuantity: identity.lotSize },
            comparables: [identity], candidateFoundCount: 1, returnedCandidateCount: 1,
            enrichedSampleCount: 1, insightsAvailability: "NOT_CONFIGURED",
          })
          sourceEvidence = marketEvidenceFromKeywordDemandReportV1(sourceReport)[0] ?? null
          if (sourceEvidence) {
            sourceEvidence = { ...sourceEvidence, itemId: request.seedValue,
              source: "EBAY_BROWSE_ACTIVE_LISTING" }
            liveEvidence.push(sourceEvidence)
            request = { ...request, seedIdentity: {
              categoryId: sourceEvidence.categoryId,
              categoryName: sourceEvidence.categoryName,
              brand: sourceEvidence.brand,
              gtin: sourceEvidence.gtin,
              mpn: sourceEvidence.mpn,
              model: sourceEvidence.model,
              packCount: sourceEvidence.packCount,
              size: sourceEvidence.size,
              color: sourceEvidence.color,
            } }
          }
        }
      } catch (error) {
        sourceLimitations.push(safeError(error))
      }
      itemIdBridge = deriveItemIdCanonicalFamilyBridgeV1({ itemId: request.seedValue,
        evidence: sourceEvidence ? [sourceEvidence] : [] })
      if (itemIdBridge.marketExpansion.query) {
        queries.push({ query: itemIdBridge.marketExpansion.query, path: "CANONICAL_FAMILY_EXPANSION" })
      } else {
        sourceLimitations.push("ITEM_ID_CANONICAL_FAMILY_UNPROVEN")
      }
    } else {
      const family = resolveCanonicalProductFamilyV1({ seedValue: request.seedValue,
        title: request.seedType === "SEED_PRODUCT_TITLE" ? request.seedValue : null,
        categoryId: request.seedIdentity.categoryId,
        categoryName: request.seedIdentity.categoryName,
        packCount: request.seedIdentity.packCount,
        brand: request.seedIdentity.brand,
        model: request.seedIdentity.model })
      queries.push({ query: request.seedValue, path: request.seedType })
      if (family.canonicalFamily && family.confidence >= 70 &&
          normalizedQuery(family.canonicalFamily) !== normalizedQuery(request.seedValue)) {
        queries.push({ query: family.canonicalFamily, path: "CANONICAL_FAMILY_EXPANSION" })
      }
    }

    const maximumQueries = Math.min(2, request.queryBudget)
    const uniqueQueries = [...new Map(queries.map((row) => [normalizedQuery(row.query), row])).values()]
      .slice(0, maximumQueries)
    for (const query of uniqueQueries) {
      try {
        const familyExpansion = query.path === "CANONICAL_FAMILY_EXPANSION"
        const report = await runEbaySellerKeywordDemandValidation({
          productName: query.query,
          productTitle: query.path === "SEED_PRODUCT_TITLE" ? query.query : null,
          variantTitle: query.path === "CANONICAL_FAMILY_EXPANSION" ||
            query.path === "SEED_PRODUCT_FAMILY" ? query.query : null,
          categoryId: request.seedIdentity.categoryId,
          // Family expansion deliberately drops exact listing identifiers. They remain
          // available to Comparable V2, but must not collapse the search back to one SKU.
          gtin: familyExpansion ? null : request.seedIdentity.gtin,
          brand: familyExpansion ? null : request.seedIdentity.brand,
          mpn: familyExpansion ? null : request.seedIdentity.mpn,
          model: familyExpansion ? null : request.seedIdentity.model,
          packQuantity: request.seedIdentity.packCount,
        })
        const mapped = marketEvidenceFromKeywordDemandReportV1(report)
        liveEvidence.push(...mapped)
        queryExecutions.push({ query: query.query, path: query.path,
          status: "AVAILABLE", returnedEvidence: mapped.length })
      } catch (error) {
        const limitation = safeError(error)
        sourceLimitations.push(limitation)
        queryExecutions.push({ query: query.query, path: query.path,
          status: limitation, returnedEvidence: 0 })
      }
    }

    const evidence = [...new Map([...liveEvidence, ...manualEvidence]
      .map((row) => [row.evidenceId, row])).values()]
    const researchEvidence = evidence.filter((row) =>
      request.seedType !== "SEED_ITEM_ID" || row.itemId !== request.seedValue)
    const activeMarketStatus = researchEvidence.some((row) => row.activeListing)
      ? "AVAILABLE" as const : "UNPROVEN" as const
    const soldHistoryStatus = researchEvidence.some((row) => row.confirmedSold)
      ? "PARTIAL" as const : "UNAVAILABLE" as const
    const research = buildMarketOpportunityResearchV1({
      request,
      evidence: researchEvidence,
      activeMarketStatus,
      soldHistoryStatus,
      paginationCoverage: "BOUNDED_QUERY_AND_DETAIL_SAMPLE",
      sourceLimitations,
      observedAt: new Date().toISOString(),
    })
    const intelligenceV2 = buildCommercialIntelligenceUpgradeV1({
      request,
      evidence,
      sourceItemId: request.seedType === "SEED_ITEM_ID" ? request.seedValue : null,
      observedResultCount: researchEvidence.filter((row) => row.activeListing).length,
      searchResultCap: 50,
    })

    return NextResponse.json({
      success: true,
      research: { ...research, intelligenceV2, itemIdBridge,
        queryExecution: { mode: "BOUNDED_MULTI_SEED_CONSENSUS", maxQueries: maximumQueries,
          executedQueries: queryExecutions, cacheAware: true, deduplicated: true,
          rateLimitAware: true, sourceListingExcludedFromMarketEvidence:
            request.seedType === "SEED_ITEM_ID" } },
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
