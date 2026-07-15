import type { EbayMarketIntelligenceReport } from "../market-intelligence/types.ts"

export type OptimizationIssue = {
  code: string
  severity: "blocking" | "high" | "medium" | "low"
  field: string
  message: string
  evidence: string[]
}

export type ProductFacts = {
  brand: string
  productName: string
  productType: string
  quantityIncluded: number
  unitsPerPackage: number
  totalUnits: number
  scent: string | null
  condition: string
  upc: string | null
  manufacturerPartNumber: string | null
  epaRegistrationNumber: string | null
  packageContents: string[]
  dimensions: { length: number; width: number; height: number; unit: string } | null
  weight: { value: number; unit: string } | null
  permittedClaims: string[]
  prohibitedClaims: string[]
  verifiedUseCases: string[]
  verifiedCompatibility: string[]
  shippingOrigin: string | null
  handlingTime: number | null
  returnPolicy: string | null
}

export type SellerProfile = {
  accountAge: number
  sellerFeedbackPercent: number | null
  sellerFeedbackCount: number
  topRatedStatus: boolean
  freeShipping: boolean
  sellerPaidReturns: boolean
  promotedListingPercent: number
  targetMarginPercent: number
}

export type ListingDraft = {
  title: string
  subtitle: string | null
  price: number
  quantity: number
  category: string
  itemSpecifics: Record<string, string>
  description: string
  shippingPolicy: string
  returnPolicy: string
  bestOfferEnabled: boolean
  immediatePaymentEnabled: boolean
  volumePricing: Array<{ minimumQuantity: number; discountPercent: number }>
  images: string[]
}

export type ImageAsset = {
  id: string
  url: string
  status: "pending" | "approved" | "rejected"
  observedText: string[]
  observedQuantity: number | null
  observedTotalUnits: number | null
  medicalTextDetected: boolean
  background: string | null
  productCoveragePercent: number | null
  imageSharpness: number | null
  mobileReadability: number | null
  factsDepicted: string[]
}

export type RegulatoryData = {
  confirmedEpaRegistrationNumber: string | null
  confirmedRegulatoryClaims: string[]
  brandUsageAuthorized: boolean | null
  madeInUsaConfirmed: boolean
  usaSellerConfirmed: boolean
  tsaApprovedConfirmed: boolean
}

export type PlatformConstraints = {
  maximumTitleLength: number
  maximumImages: number
  prohibitedTerms: string[]
  minimumPrice: number | null
  maximumPrice: number | null
}

export type ListingOptimizationInput = {
  marketIntelligenceReport: EbayMarketIntelligenceReport
  productFacts: ProductFacts
  sellerProfile: SellerProfile
  listingDraft: ListingDraft
  imageAssets: ImageAsset[]
  regulatoryData: RegulatoryData
  platformConstraints: PlatformConstraints
}

export type TitleCandidate = {
  title: string
  score: number
  scoreAxes: {
    keywordRelevance: number
    clarity: number
    quantityClarity: number
    mobileReadability: number
    compliance: number
    duplicationPenalty: number
  }
  evidence: string[]
}

export type ImageBrief = {
  imageNumber: number
  name: string
  purpose: string
  conversionGoal: string
  composition: string
  productCoveragePercent: number
  allowedText: string[]
  prohibitedText: string[]
  requiredFacts: string[]
  riskChecks: string[]
  generationPrompt: string
}

export type ListingScore = {
  total: number
  uncappedTotal: number
  cappedByBlockingIssue: boolean
  components: {
    titleSeo: number
    priceCompetitiveness: number
    mainImage: number
    secondaryImages: number
    itemSpecifics: number
    description: number
    shipping: number
    returns: number
    compliance: number
  }
}

export type OptimizationIteration = {
  iteration: number
  scoreBefore: number
  scoreAfter: number
  weaknesses: string[]
  automaticCorrections: string[]
  approvalProposals: Array<{
    field: string
    currentValue: unknown
    proposedValue: unknown
    reason: string
    requiresHumanApproval: true
  }>
  stoppedReason: string | null
}

export type ExperimentPlan = {
  variable: "mainImage" | "title" | "price" | "promotedListingPercent" | "volumePricing"
  hypothesis: string
  control: unknown
  variant: unknown
  metric: string
  duration: string
  minimumImpressions: number
  successThreshold: string
  rollbackCondition: string
  status: "proposed"
}

export type ListingMetrics = {
  impressions: number
  clicks: number
  ctr: number
  watchers: number
  addToCart: number
  purchases: number
  conversionRate: number
  averageOrderValue: number
  returnRate: number
  cancellationRate: number
  profitPerOrder: number
}

export type ListingOptimizationResult = {
  version: "EBAY_LISTING_OPTIMIZATION_LOOP_V1"
  generatedAt: string
  listingDraft: ListingDraft
  titleCandidates: TitleCandidate[]
  recommendedTitle: TitleCandidate
  description: string
  imageBrief: ImageBrief[]
  review: {
    blockingIssues: OptimizationIssue[]
    warnings: OptimizationIssue[]
    passedChecks: string[]
    score: ListingScore
    priceProposal: number | null
    regulatoryProposals: OptimizationIssue[]
  }
  experimentPlan: ExperimentPlan
  optimizationHistory: OptimizationIteration[]
  metricsTemplate: ListingMetrics
  diagnostics: string[]
  stopReason: string
  safety: {
    productFactsOnlySourceOfTruth: true
    priceChangedAutomatically: false
    regulatoryDataChangedAutomatically: false
    ebayWriteUsed: false
    canPublish: false
  }
}
