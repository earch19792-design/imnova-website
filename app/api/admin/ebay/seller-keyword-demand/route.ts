export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"
import {
  getEbayTaxonomyListingIntelligence,
  runEbaySellerKeywordDemandValidation,
} from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { buildEbayLunaOpportunityAssessment } from "@/lib/ebay/ebay-luna-demand-opportunity-engine"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { buildWinnerEvidenceDecisionPackage } from "@/lib/ebay/ebay-winner-evidence-v2"
import { winnerComparablesFromKeywordReport } from "@/lib/ebay/ebay-winner-evidence-v2-service"

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_READONLY_MARKET_VALIDATION_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 }
    )
  }

  try {
    const raw = await req.json() as Record<string, unknown>
    const candidate = {
      productName: text(raw.productName, 240),
      productTitle: text(raw.productTitle, 240),
      variantTitle: text(raw.variantTitle, 160),
      supplierSku: text(raw.supplierSku, 100),
      categoryId: text(raw.categoryId, 20),
      gtin: text(raw.gtin, 20),
      brand: text(raw.brand, 120),
      mpn: text(raw.mpn, 120),
      color: text(raw.color, 80),
      size: text(raw.size, 80),
      packQuantity: numberOrNull(raw.packQuantity),
      productType: text(raw.productType, 120),
      description: text(raw.description, 500),
    }
    if (!candidate.productName && !candidate.productTitle) {
      return NextResponse.json(
        { success: false, error: "EBAY_CANDIDATE_NAME_REQUIRED" },
        { status: 400 }
      )
    }

    const report = await runEbaySellerKeywordDemandValidation(candidate)
    const taxonomyIntelligence = await getEbayTaxonomyListingIntelligence(
      report.searchQuery,
      report.topSellingListings[0]?.categoryId ?? candidate.categoryId
    )
    const opportunityAssessment = buildEbayLunaOpportunityAssessment({
      candidate: {
        candidateKey: text(raw.candidateKey, 240),
        marketRadarProductId: text(raw.marketRadarProductId, 80),
        supplierProductId: text(raw.supplierProductId, 120),
        supplierVariantId: text(raw.supplierVariantId, 120),
        sku: candidate.supplierSku,
        title: candidate.productName || candidate.productTitle,
        variantTitle: candidate.variantTitle,
        brand: candidate.brand,
        mpn: candidate.mpn,
        gtin: candidate.gtin,
        color: candidate.color,
        size: candidate.size,
        packQuantity: candidate.packQuantity,
        productType: candidate.productType,
        categoryId: candidate.categoryId,
        description: candidate.description,
        supplierCost: numberOrNull(raw.supplierCost),
        available: raw.available === true ? true : raw.available === false ? false : null,
        inventoryQuantity: numberOrNull(raw.inventoryQuantity),
        stockCapturedAt: text(raw.stockCapturedAt, 80),
        weight: numberOrNull(raw.weight),
        weightUnit: text(raw.weightUnit, 20),
        dimensions: raw.dimensions && typeof raw.dimensions === "object"
          ? raw.dimensions as Record<string, unknown>
          : null,
        imageUrls: Array.isArray(raw.imageUrls)
          ? raw.imageUrls.filter((value): value is string => typeof value === "string").slice(0, 12)
          : [],
        imageAuthorized: raw.imageAuthorized === true,
        restrictionGuards: Array.isArray(raw.restrictionGuards)
          ? raw.restrictionGuards.filter((value): value is string => typeof value === "string").slice(0, 20)
          : [],
      },
      demandReport: report,
      observationHistory: [],
      taxonomyIntelligence,
    })
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    const visualWinnerEvidence = accountKey && candidate.supplierSku
      ? buildWinnerEvidenceDecisionPackage({
          marketplaceAccountKey: accountKey,
          candidateId: null,
          supplierSku: candidate.supplierSku,
          supplierVariantId: text(raw.supplierVariantId, 120) || null,
          identity: {
            manufacturerBrand: candidate.brand || null,
            gtin: candidate.gtin || null,
            mpn: candidate.mpn || null,
            model: candidate.mpn || null,
            productName: candidate.productName || candidate.productTitle,
            packCount: candidate.packQuantity,
            unitCount: null,
            size: candidate.size || null,
            color: candidate.color || null,
            scent: null,
            variant: candidate.variantTitle || null,
            condition: "New",
          },
          comparables: winnerComparablesFromKeywordReport(report),
          supplierPackageCost: numberOrNull(raw.supplierCost),
          packagingCost: null,
          outboundShippingCost: null,
          fixedFulfillmentCost: null,
          authorizedKeywords: [],
          stockAvailable: numberOrNull(raw.inventoryQuantity),
          stockObservedAt: text(raw.stockCapturedAt, 80) || null,
          costObservedAt: text(raw.stockCapturedAt, 80) || null,
          complianceBlocked: false,
          now: report.evidenceAsOf,
        }).visualEvidenceAnalysis
      : null
    return NextResponse.json({
      success: true,
      report,
      taxonomyIntelligence,
      opportunityAssessment,
      visualWinnerEvidence,
      safety: {
        mode: "EBAY_OFFICIAL_READ_ONLY",
        ebayWriteUsed: false,
        supabaseWriteUsed: false,
        tokenReturnedToBrowser: false,
        imagesCopied: false,
        competitorImagesDownloaded: 0,
        imageGenerationStarted: false,
        canPublish: false,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    const status = code === "EBAY_READONLY_ENV_MISSING" ? 503 : 502
    return NextResponse.json(
      { success: false, error: code },
      { status }
    )
  }
}
