export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"
import {
  getEbayTaxonomyListingIntelligence,
  runEbaySellerKeywordDemandValidation,
} from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { getEbayReadonlyRateLimitMetadata } from "@/lib/ebay/ebay-readonly-rate-limit"
import { buildEbayLunaOpportunityAssessment } from "@/lib/ebay/ebay-luna-demand-opportunity-engine"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
} from "@/lib/ebay/ebay-persistent-quota-coordinator"
import { buildWinnerEvidenceDecisionPackage } from "@/lib/ebay/ebay-winner-evidence-v2"
import {
  sanitizeWinnerEvidencePackage,
  winnerComparablesFromKeywordReport,
  type WinnerEvidenceClientInput,
} from "@/lib/ebay/ebay-winner-evidence-v2-service"

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

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const quota = await assertEbayLaneAvailable(
      getSupabaseAdminClient(),
      "BROWSE",
      "EXACT_VERIFICATION",
    )
    return NextResponse.json({
      success: true,
      quota: {
        available: quota.available,
        status: quota.status,
        resumeAt: quota.resumeAt,
        affectedLane: quota.ownerLane ?? "P1_EXACT_VERIFICATION",
      },
      safety: {
        ebayCalls: 0,
        ebayWrites: 0,
        openAiCalls: 0,
        piiReturned: false,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: "EBAY_QUOTA_STATE_READ_FAILED" },
      { status: 502 },
    )
  }
}

async function getExactProductResearchEvidence(input: {
  accountKey: string | null
  supplierVariantId: string
  searchQuery: string
}) {
  const base = { source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE" as const,
    searchQuery: input.searchQuery, recencyDays: 90 }
  if (!input.accountKey || !input.supplierVariantId) {
    return { ...base, status: "CAPTURE_REQUIRED" as const,
      exactObservationCount: 0, confirmedSoldQuantity: 0, latestSoldAt: null }
  }
  try {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data, error } = await getSupabaseAdminClient()
      .from("marketplace_product_research_capture_observations")
      .select("confirmed_sold_quantity,last_sold_date")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US")
      .eq("matched_supplier_variant_id", input.supplierVariantId)
      .eq("match_classification", "EXACT_LUNA_MATCH")
      .eq("evidence_reviewed", true)
      .gte("last_sold_date", since)
      .order("last_sold_date", { ascending: false })
      .limit(200)
    if (error) throw error
    const rows = data ?? []
    return { ...base, status: rows.length ? "AVAILABLE" as const : "CAPTURE_REQUIRED" as const,
      exactObservationCount: rows.length,
      confirmedSoldQuantity: rows.reduce((total, row) =>
        total + Math.max(0, Number(row.confirmed_sold_quantity ?? 0)), 0),
      latestSoldAt: rows[0]?.last_sold_date ?? null }
  } catch {
    return { ...base, status: "UNAVAILABLE" as const,
      exactObservationCount: 0, confirmedSoldQuantity: 0, latestSoldAt: null }
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 }
    )
  }

  let quotaCheckpoint: Record<string, unknown> = {}
  try {
    const raw = await req.json() as Record<string, unknown>
    const candidate = {
      productName: text(raw.productName, 240),
      productTitle: text(raw.productTitle, 240),
      variantTitle: text(raw.variantTitle, 160),
      supplierSku: text(raw.supplierSku, 100),
      categoryId: text(raw.categoryId, 20),
      gtin: text(raw.gtin, 20),
      brand: text(raw.manufacturerBrand, 120),
      supplierVendor: text(raw.supplierVendor, 120),
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

    quotaCheckpoint = {
      candidateKey: text(raw.candidateKey, 240),
      supplierVariantId: text(raw.supplierVariantId, 120),
      stage: "MANUAL_MARKET_VERIFICATION",
    }
    const quotaLane = await assertEbayLaneAvailable(
      getSupabaseAdminClient(),
      "BROWSE",
      "EXACT_VERIFICATION",
    )
    if (!quotaLane.available) {
      const retryAt = quotaLane.resumeAt
      const retryAfterSeconds = retryAt
        ? Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1_000))
        : 60
      return NextResponse.json({
        success: false,
        error: "EBAY_READONLY_GET_429",
        retryAfterSeconds,
        retryAt,
        affectedLane: quotaLane.ownerLane ?? "P1_EXACT_VERIFICATION",
        pauseSource: "PERSISTENT_QUOTA_COORDINATOR",
        checkpointPreserved: true,
        localFlowAvailable: true,
      }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } })
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
    const productResearchEvidence = await getExactProductResearchEvidence({
      accountKey,
      supplierVariantId: text(raw.supplierVariantId, 120),
      searchQuery: report.searchQuery,
    })
    const keywordTerms = [
      ...report.keywordEvidenceGroups.verifiedHistoricalMultiSeller,
      ...report.keywordEvidenceGroups.estimatedMultiSellerSignal,
      ...report.keywordEvidenceGroups.activeListingFrequencyOnly,
    ].map((entry) => entry.term).filter(Boolean).slice(0, 30)
    const restrictionGuards = Array.isArray(raw.restrictionGuards)
      ? raw.restrictionGuards.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
      : []
    const winnerDecisionPackageInput: WinnerEvidenceClientInput | null = candidate.supplierSku
      ? {
          candidateId: null,
          supplierSku: candidate.supplierSku,
          supplierVariantId: text(raw.supplierVariantId, 120) || null,
          identity: {
            manufacturerBrand: candidate.brand || null,
            distributor: "Luna Portex",
            vendor: candidate.supplierVendor || null,
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
          outboundShippingCost: opportunityAssessment.economics.estimatedOutboundShipping,
          fixedFulfillmentCost: null,
          authorizedKeywords: keywordTerms,
          requiredKeywordCount: 5,
          stockAvailable: numberOrNull(raw.inventoryQuantity),
          stockObservedAt: text(raw.stockCapturedAt, 80) || null,
          costObservedAt: text(raw.stockCapturedAt, 80) || null,
          complianceBlocked: restrictionGuards.length > 0,
          complianceFindings: restrictionGuards,
          now: report.evidenceAsOf,
        }
      : null
    const winnerDecisionPackage = accountKey && winnerDecisionPackageInput &&
      productResearchEvidence.status === "AVAILABLE"
      ? buildWinnerEvidenceDecisionPackage({
          ...winnerDecisionPackageInput,
          marketplaceAccountKey: accountKey,
        })
      : null
    const visualWinnerEvidence = winnerDecisionPackage?.visualEvidenceAnalysis ?? null
    return NextResponse.json({
      success: true,
      report,
      taxonomyIntelligence,
      opportunityAssessment,
      visualWinnerEvidence,
      winnerDecisionPackage: winnerDecisionPackage
        ? sanitizeWinnerEvidencePackage(winnerDecisionPackage)
        : null,
      winnerDecisionPackageInput,
      productResearchEvidence,
      safety: {
        mode: "EBAY_OFFICIAL_READ_ONLY",
        ebayWriteUsed: false,
        supabaseWriteUsed: false,
        tokenReturnedToBrowser: false,
        imagesCopied: false,
        competitorImagesDownloaded: 0,
        imageGenerationStarted: false,
        openAiCalls: 0,
        draftsCreated: 0,
        publicationsCreated: 0,
        canPublish: false,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    const rateLimit = getEbayReadonlyRateLimitMetadata(error)
    if (rateLimit) {
      const persisted = await recordPersistentEbayRateLimit(getSupabaseAdminClient(), {
        error,
        apiFamily: "BROWSE",
        endpoint: "BUY_BROWSE_ITEM_SUMMARY_SEARCH",
        operation: "EXACT_VERIFICATION",
        lane: "P1_EXACT_VERIFICATION",
        checkpoint: quotaCheckpoint,
      }).catch(() => null)
      const retryAfterSeconds = rateLimit.retryAfterSeconds ?? 15 * 60
      const retryAt = persisted?.resumeAt ??
        new Date(Date.now() + retryAfterSeconds * 1_000).toISOString()
      return NextResponse.json({
        success: false,
        error: code,
        retryAfterSeconds,
        retryAt,
        affectedLane: persisted?.affectedLane ?? "P1_EXACT_VERIFICATION",
        pauseSource: persisted ? "PERSISTENT_QUOTA_COORDINATOR" : "RESPONSE_FALLBACK",
        checkpointPreserved: true,
        localFlowAvailable: true,
      }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } })
    }
    const status = code === "EBAY_READONLY_ENV_MISSING" ? 503 : 502
    return NextResponse.json(
      { success: false, error: code },
      { status }
    )
  }
}
