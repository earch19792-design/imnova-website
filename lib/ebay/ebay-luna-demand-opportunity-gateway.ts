import {
  buildEbayDemandCandidateFromLuna,
  normalizeLunaOpportunityCandidate,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-luna-catalog-normalization.ts"
import {
  buildEbayLunaOpportunityAssessment,
  matchEbayBestSellingProductsToLuna,
  rankEbayLunaOpportunities,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-luna-demand-opportunity-engine.ts"
import {
  discoverEbayBestSellingProducts,
  getEbayTaxonomyListingIntelligence,
  runEbaySellerKeywordDemandValidation,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-seller-keyword-demand-gateway.ts"
import type {
  EbayCategoryLearningAdjustmentInput,
  EbayListingObservation,
  LunaOpportunityCandidateInput,
  OpportunityEngineOptions,
} from "./ebay-luna-opportunity-types.ts"

const MAX_CANDIDATES_PER_REQUEST = 5
const MAX_BEST_SELLING_CATEGORIES_PER_REQUEST = 3

export type EbayLunaOpportunityScanInput = {
  candidates: LunaOpportunityCandidateInput[]
  observationHistoryByCandidate?: Record<string, EbayListingObservation[]>
  bestSellingCategoryIds?: string[]
  options?: OpportunityEngineOptions
  categoryLearningAdjustmentsByCategory?: Record<
    string,
    EbayCategoryLearningAdjustmentInput
  >
}

export async function runEbayLunaOpportunityScan(
  input: EbayLunaOpportunityScanInput
) {
  const candidates = input.candidates.slice(0, MAX_CANDIDATES_PER_REQUEST)
  const assessments = []
  for (const rawCandidate of candidates) {
    const normalized = normalizeLunaOpportunityCandidate(
      rawCandidate,
      input.options?.now
    )
    const demandReport = await runEbaySellerKeywordDemandValidation(
      buildEbayDemandCandidateFromLuna(normalized)
    )
    const taxonomyIntelligence = await getEbayTaxonomyListingIntelligence(
      demandReport.searchQuery,
      demandReport.topSellingListings[0]?.categoryId ?? normalized.categoryId
    )
    const resolvedCategoryId = taxonomyIntelligence.categoryId ??
      demandReport.topSellingListings[0]?.categoryId ?? normalized.categoryId
    const categoryLearningAdjustment = input.categoryLearningAdjustmentsByCategory
      ? resolvedCategoryId
        ? input.categoryLearningAdjustmentsByCategory[resolvedCategoryId] ?? null
        : null
      : input.options?.categoryLearningAdjustment
    assessments.push(buildEbayLunaOpportunityAssessment({
      candidate: rawCandidate,
      demandReport,
      observationHistory:
        input.observationHistoryByCandidate?.[normalized.candidateKey] ?? [],
      taxonomyIntelligence,
    }, {
      ...input.options,
      categoryLearningAdjustment,
    }))
  }

  const bestSellingDiscovery = []
  for (const categoryId of (input.bestSellingCategoryIds ?? [])
    .filter((value) => /^\d+$/.test(value))
    .slice(0, MAX_BEST_SELLING_CATEGORIES_PER_REQUEST)) {
    const discovery = await discoverEbayBestSellingProducts(categoryId)
    bestSellingDiscovery.push({
      categoryId,
      ...discovery,
      lunaMatches: matchEbayBestSellingProductsToLuna(
        discovery.products,
        candidates
      ),
    })
  }

  return {
    scanVersion: "EBAY-LUNA-DEMAND-TO-INVENTORY-OPPORTUNITY-SCAN-V2",
    requestedCandidateCount: input.candidates.length,
    processedCandidateCount: candidates.length,
    hasMoreCandidates: input.candidates.length > candidates.length,
    nextOffset: input.candidates.length > candidates.length
      ? candidates.length
      : null,
    rankedOpportunities: rankEbayLunaOpportunities(assessments),
    bestSellingDiscovery,
    evidencePolicy: {
      browseEstimatedSoldQuantityIsVerifiedHistory: false,
      observedEstimatedDeltaIsVerifiedHistory: false,
      marketplaceInsightsRequired: false,
      singleSellerCanProveMarketDemand: false,
      humanApprovalRequired: true,
    },
    categoryLearningPolicy: {
      source: "EBAY_SELL_ANALYTICS_READONLY",
      ownSellerAccountOnly: true,
      competitorPerformanceUsed: false,
      minimumLinkedListings: 10,
      minimumObservationDays: 14,
      minimumTotalImpressions: 500,
      maximumAbsoluteAdjustmentPoints: 5,
      adjustsRankingOnly: true,
      safetyGatesChanged: false,
    },
    safety: {
      ebayMode: "OFFICIAL_READ_ONLY_GET",
      ebayWriteUsed: false,
      supabaseWriteUsedInGateway: false,
      tokensReturned: false,
      competitorImagesCopied: false,
      draftsCreated: false,
      offersCreated: false,
      listingsPublished: false,
      canPublish: false,
    },
  }
}
