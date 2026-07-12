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
    assessments.push(buildEbayLunaOpportunityAssessment({
      candidate: rawCandidate,
      demandReport,
      observationHistory:
        input.observationHistoryByCandidate?.[normalized.candidateKey] ?? [],
      taxonomyIntelligence,
    }, input.options))
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
    scanVersion: "EBAY-LUNA-DEMAND-TO-INVENTORY-OPPORTUNITY-SCAN-V1",
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
