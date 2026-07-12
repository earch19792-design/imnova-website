import type {
  EbaySellerKeywordDemandReport,
} from "./ebay-seller-keyword-demand-validation.ts"
import type {
  EbayTaxonomyListingIntelligence,
} from "./ebay-seller-keyword-demand-gateway.ts"

export type LunaOpportunityCandidateInput = {
  candidateKey?: string | null
  marketRadarProductId?: string | null
  supplierProductId?: string | null
  supplierVariantId?: string | null
  sku?: string | null
  title?: string | null
  productName?: string | null
  variantTitle?: string | null
  brand?: string | null
  vendor?: string | null
  mpn?: string | null
  gtin?: string | null
  upc?: string | null
  barcode?: string | null
  color?: string | null
  size?: string | null
  packQuantity?: number | string | null
  productType?: string | null
  categoryId?: string | null
  categoryHint?: string | null
  description?: string | null
  tags?: string[] | null
  supplierCost?: number | string | null
  price?: number | string | null
  available?: boolean | null
  inventoryQuantity?: number | string | null
  stockCapturedAt?: string | null
  weight?: number | string | null
  weightUnit?: string | null
  dimensions?: {
    length?: number | string | null
    width?: number | string | null
    height?: number | string | null
    unit?: string | null
  } | null
  imageUrls?: string[] | null
  imageAuthorized?: boolean | null
  restrictionGuards?: string[] | null
  metadata?: Record<string, unknown> | null
}

export type NormalizedLunaOpportunityCandidate = {
  candidateKey: string
  marketRadarProductId: string | null
  supplierProductId: string | null
  supplierVariantId: string | null
  sku: string | null
  title: string
  variantTitle: string | null
  brand: string | null
  mpn: string | null
  gtin: string | null
  color: string | null
  size: string | null
  packQuantity: number | null
  productType: string | null
  categoryId: string | null
  categoryHint: string | null
  description: string | null
  tags: string[]
  supplierCost: number | null
  available: boolean | null
  inventoryQuantity: number | null
  stockCapturedAt: string | null
  stockAgeHours: number | null
  weight: number | null
  weightUnit: string | null
  dimensions: {
    length: number
    width: number
    height: number
    unit: string
  } | null
  imageUrls: string[]
  imageAuthorized: boolean
  restrictionGuards: string[]
  identityDataCompleteness: number
  missingIdentityFields: string[]
  source: "LUNA_PORTEX"
}

export type EbayListingObservation = {
  candidateKey: string
  itemId: string
  sellerId: string
  observedAt: string
  estimatedSoldQuantity: number | null
  price: number | null
  shippingCost: number | null
  identityMatchScore: number
  identityMatchType: string
  evidenceSource: string
}

export type EbayListingRotationSignal = {
  itemId: string
  sellerId: string
  observationDays: number
  estimatedSoldDelta: number | null
  estimatedSoldDelta7d: number | null
  estimatedSoldDelta30d: number | null
  estimatedWeeklyVelocity: number | null
  evidenceClass:
    | "OBSERVED_ESTIMATED_SALES_DELTA"
    | "SINGLE_ESTIMATED_SALES_SNAPSHOT"
    | "ACTIVE_LISTING_ONLY"
    | "COUNTER_RESET_OR_RELIST_REVIEW"
  safeToCallVerifiedSales: false
}

export type OpportunityEngineOptions = {
  now?: string | Date
  stockFreshnessHours?: number
  estimatedEbayFeeRate?: number
  fixedOrderFee?: number
  estimatedOutboundShipping?: number
  returnsReserveRate?: number
  promotedListingsReserveRate?: number
  minimumNetProfit?: number
  minimumNetMarginPercent?: number
  minimumRoiPercent?: number
}

export type EbayLunaCandidateMarketInput = {
  candidate: LunaOpportunityCandidateInput
  demandReport: EbaySellerKeywordDemandReport
  observationHistory?: EbayListingObservation[] | null
  taxonomyIntelligence?: EbayTaxonomyListingIntelligence | null
}
