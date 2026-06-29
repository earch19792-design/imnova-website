export type ProductSelectionDecision =
  | "approve"
  | "review"
  | "reject"
  | "blocked"

export type ProductSelectionState =
  | "NEW_CANDIDATE"
  | "DATA_INCOMPLETE"
  | "MARGIN_REVIEW"
  | "RISK_REVIEW"
  | "APPROVED_FOR_DRAFT"
  | "BLOCKED"
  | "REJECTED"

export type ProductSelectionRiskSeverity =
  | "blocker"
  | "review"

export type ProductSelectionRiskFlag = {
  code: string
  severity: ProductSelectionRiskSeverity
  message: string
}

export type ProductSelectionDimensions = {
  length?: number | string | null
  width?: number | string | null
  height?: number | string | null
}

export type ProductSelectionCandidate = {
  productName?: string | null
  supplierName?: string | null
  supplierSku?: string | null
  internalSku?: string | null
  category?: string | null
  niche?: string | null
  supplierCost?: number | string | null
  supplierShippingCost?: number | string | null
  estimatedEbayPrice?: number | string | null
  estimatedEbayFees?: number | string | null
  buyerShippingCharge?: number | string | null
  stockAvailable?: number | string | null
  stockStatus?: string | null
  shippingTimeDays?: number | string | null
  weight?: number | string | null
  dimensions?: ProductSelectionDimensions | null
  fragile?: boolean | null
  returnRisk?: string | boolean | null
  brandRisk?: string | boolean | null
  veroRisk?: string | boolean | null
  medicalClaimsRisk?: string | boolean | null
  categoryRisk?: string | boolean | null
  imageAuthorizationStatus?: string | null
  competitorCount?: number | string | null
  soldCompsMedianPrice?: number | string | null
  marketConfidence?: string | number | null
}

export type ProductSelectionConfig = {
  ebayFeePercent?: number
  ebayFixedFee?: number
  defaultShippingCost?: number
  minimumProfitUsd?: number
  idealProfitUsd?: number
  minimumRoiPercent?: number
  recommendedNetMarginPercent?: number
  marketPriceReviewBufferPercent?: number
  slowShippingDays?: number
}

export type ProductSelectionEconomics = {
  supplierCost: number
  estimatedEbayPrice: number
  buyerShippingCharge: number
  totalRevenue: number
  estimatedShippingCost: number
  estimatedEbayFees: number
  totalCost: number
  netProfit: number
  roiPercent: number
  netMarginPercent: number
  thresholds: {
    minimumProfitUsd: number
    idealProfitUsd: number
    minimumRoiPercent: number
    recommendedNetMarginPercent: number
  }
}

export type ProductSelectionRiskClassification = {
  riskLevel: "critical" | "review" | "low"
  riskFlags: ProductSelectionRiskFlag[]
}

export type ProductSelectionEvaluation = {
  normalizedCandidate: ProductSelectionCandidate
  config: Required<ProductSelectionConfig>
  economics: ProductSelectionEconomics
  operationalRisk: ProductSelectionRiskClassification
  ebayRisk: ProductSelectionRiskClassification
  marketReview: ProductSelectionRiskFlag | null
}

export type ProductSelectionDecisionResult = {
  decision: ProductSelectionDecision
  state: ProductSelectionState
}

export type ProductSelectionAdvisorOutput = ProductSelectionDecisionResult & {
  mainReason: string
  riskFlags: ProductSelectionRiskFlag[]
  keyNumbers: {
    netProfit: number
    roiPercent: number
    netMarginPercent: number
    estimatedEbayFees: number
    estimatedShippingCost: number
  }
  nextHumanAction: string
  advisoryOnly: true
}

export const DEFAULT_PRODUCT_SELECTION_CONFIG: Required<ProductSelectionConfig>

export function evaluateProductSelectionCandidate(
  candidate?: ProductSelectionCandidate,
  options?: ProductSelectionConfig
): ProductSelectionAdvisorOutput

export function calculateProductEconomics(
  candidate?: ProductSelectionCandidate,
  config?: ProductSelectionConfig
): ProductSelectionEconomics

export function classifyOperationalRisk(
  candidate?: ProductSelectionCandidate,
  config?: ProductSelectionConfig
): ProductSelectionRiskClassification

export function classifyEbayRisk(
  candidate?: ProductSelectionCandidate
): ProductSelectionRiskClassification

export function determineProductSelectionDecision(
  evaluation: ProductSelectionEvaluation
): ProductSelectionDecisionResult

export function buildProductSelectionAdvisorOutput(
  evaluation: ProductSelectionEvaluation & {
    decisionResult?: ProductSelectionDecisionResult
  }
): ProductSelectionAdvisorOutput
