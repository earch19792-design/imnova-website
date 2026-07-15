export const EVIDENCE_LEVELS = [
  "verified",
  "visible",
  "inferred",
  "unavailable",
] as const

export type EvidenceLevel = typeof EVIDENCE_LEVELS[number]

export const SECONDARY_IMAGE_CATEGORIES = [
  "packageContents",
  "benefits",
  "useCase",
  "lifestyle",
  "dimensions",
  "instructions",
  "comparison",
  "compatibility",
  "closeUp",
  "socialProof",
  "shipping",
  "other",
] as const

export type SecondaryImageCategory = typeof SECONDARY_IMAGE_CATEGORIES[number]

export type MainImageAnalysis = {
  background?: string | null
  productCoveragePercent?: number | null
  quantityClarity?: number | null
  textAmount?: number | null
  badgeUsage?: boolean | null
  shippingBadge?: boolean | null
  brandVisibility?: number | null
  imageSharpness?: number | null
  visualClutter?: number | null
  mobileReadability?: number | null
  trustScore?: number | null
  estimatedCtrScore?: number | null
}

export type CompetitorListingInput = {
  url: string
  title: string
  price: number
  shippingCost: number
  quantityIncluded: number | null
  totalUnitCount: number | null
  soldCountVisible: number | null
  watchersVisible: number | null
  sellerFeedbackPercent: number | null
  sellerFeedbackCount: number | null
  sellerLevel: string | null
  returnsAccepted: boolean | null
  returnPeriodDays: number | null
  returnShippingPaidBy: "seller" | "buyer" | "unknown" | null
  handlingTimeDays: number | null
  estimatedDelivery: string | null
  promotedVisible: boolean | null
  mainImageUrl: string | null
  secondaryImageUrls: string[]
  itemSpecifics: Record<string, string | number | boolean | null>
  description: string | null
  notes: string | null
  evidenceLevel: EvidenceLevel
  fieldEvidence: Record<string, EvidenceLevel>
  condition?: "new" | "used" | "refurbished" | "unknown" | null
  internationalShipping?: boolean | null
  additionalProductsIncluded?: boolean | null
  searchPosition?: number | null
  reviewCount?: number | null
  badges?: string[]
  listingQualityScore?: number | null
  bestOfferVisible?: boolean | null
  volumePricingVisible?: boolean | null
  mainImageAnalysis?: MainImageAnalysis | null
  secondaryImageClassifications?: SecondaryImageCategory[]
}

export type EbayMarketIntelligenceInput = {
  productName: string
  productBrand: string
  productCategory: string
  unitsPerListing: number
  unitsPerPackage: number
  totalUnits: number
  sellerProductCost: number
  packagingCost: number
  shippingCost: number
  expectedReturnCost: number
  ebayFeePercent: number
  promotedListingPercent: number
  targetMarginPercent: number
  competitorListings: CompetitorListingInput[]
  sourceDate: string
  currency: string
}

export type ExclusionReason =
  | "CRITICAL_PRICE_MISSING"
  | "QUANTITY_NOT_NORMALIZABLE"
  | "USED_OR_REFURBISHED"
  | "INTERNATIONAL_SHIPPING_NOT_COMPARABLE"
  | "ADDITIONAL_PRODUCTS_INCLUDED"
  | "CRITICAL_DATA_INCOMPLETE"

export type NormalizedCompetitor = {
  index: number
  url: string
  title: string
  itemPrice: number
  shippingCost: number
  landedPrice: number
  quantityIncluded: number
  totalUnitCount: number
  pricePerPackage: number
  pricePerUnit: number
  quantityEvidence: EvidenceLevel
  listing: CompetitorListingInput
  evidence: Record<string, EvidenceLevel>
  weight: number
  demandSignalScore: number
  demandSignals: string[]
}

export type ExcludedCompetitor = {
  index: number
  url: string
  title: string
  reasons: ExclusionReason[]
  retainedForQualitativePatterns: true
}

export type MarketMetrics = {
  minimumLandedPrice: number
  maximumLandedPrice: number
  averageLandedPrice: number
  medianLandedPrice: number
  minimumPricePerUnit: number
  averagePricePerUnit: number
  medianPricePerUnit: number
  premiumQuartilePrice: number
  weightedMarketPrice: number
  competitorCountUsed: number
  competitorCountExcluded: number
}

export type ListingEconomics = {
  salePrice: number
  totalProductCost: number
  estimatedMarketplaceCost: number
  estimatedProfit: number
  estimatedMarginPercent: number
}

export type PriceScenario = ListingEconomics & {
  name: "floorPrice" | "launchPrice" | "competitivePrice" | "targetPrice" | "premiumPrice"
  rationale: string[]
}

export type EbayMarketIntelligenceReport = {
  reportVersion: "EBAY_MARKET_INTELLIGENCE_LOOP_V1"
  generatedAt: string
  sourceDate: string
  currency: string
  product: {
    name: string
    brand: string
    category: string
    unitsPerListing: number
    unitsPerPackage: number
    totalUnits: number
  }
  executiveSummary: string[]
  marketRange: MarketMetrics
  pricePerUnitAnalysis: {
    marketMedian: number
    recommended: number
    recommendedPerUnit: number
  }
  competitorTable: Array<Omit<NormalizedCompetitor, "listing">>
  excludedListings: ExcludedCompetitor[]
  demandSignals: Array<{
    url: string
    score: number
    signals: string[]
    soldCountVisible: number | null
    soldCountEvidence: EvidenceLevel
  }>
  imagePatternAnalysis: {
    competitorsWithManualAnalysis: number
    mainImageAverages: Record<string, number | null>
    backgroundFrequency: Record<string, number>
    badgeUsageCount: number
    shippingBadgeCount: number
    perListing: Array<{
      competitorIndex: number
      analysis: MainImageAnalysis | null
      secondaryCategories: SecondaryImageCategory[]
      evidence: EvidenceLevel
    }>
    secondaryImageFrequency: Record<SecondaryImageCategory, number>
    secondaryImageFrequencyLabels: string[]
    limitation: string
  }
  titleKeywordAnalysis: {
    keywords: string[]
    keywordFrequency: Record<string, number>
    averageTitleLength: number
    commonKeywordOrder: string[]
    quantityTerms: string[]
    scentTerms: string[]
    packTerms: string[]
    prohibitedOrRiskyTerms: string[]
  }
  shippingAndReturnAnalysis: Record<string, number>
  riskFlags: string[]
  recommendedLaunchStrategy: string[]
  recommendedMatureStrategy: string[]
  recommendedPrice: PriceScenario
  minimumSafePrice: PriceScenario
  priceScenarios: PriceScenario[]
  volumePricingProposal: Array<{
    quantity: number
    discountPercent: number
    unitListingPrice: number
    marginPercent: number
  }>
  confidenceScore: number
  evidenceSummary: {
    byLevel: Record<EvidenceLevel, number>
    limitations: string[]
    recommendationEvidence: string[]
  }
}
