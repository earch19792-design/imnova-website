import type {
  MarketRadarEventRow,
  MarketRadarProductRow,
} from "./market-radar-types"

export type MarketRadarStockValidationStatus =
  | "stock_confirmed"
  | "stock_needs_validation"
  | "out_of_stock"
  | "stock_unknown"

export type MarketRadarActionStatus =
  | "actionable"
  | "reviewed"

export type MarketRadarActionableReason =
  | "new_product_not_reviewed"
  | "price_down_after_review"
  | "discount_started_after_review"
  | "restocked_after_review"
  | "stock_increased_after_review"
  | "quantity_changed_after_review"
  | "collection_changed_after_review"
  | "price_up_after_review"
  | "pipeline_candidate_not_evaluated"
  | "reviewed_no_new_signal"

export type MarketRadarPipelineCandidateSummary = {
  id?: string | null
  state?: string | null
  last_evaluated_at?: string | null
  updated_at?: string | null
}

export function isSuspiciousInventoryQuantity(
  value: number | string | null | undefined
): boolean

export function getManualStockQuantity(
  value: number | string | null | undefined
): number | null

export function isConfirmedVariantStock(
  product: Partial<MarketRadarProductRow> | null | undefined
): boolean

export function getStockValidationStatus(
  product: Partial<MarketRadarProductRow> | null | undefined
): MarketRadarStockValidationStatus

export function getMaterialChangeAfterReview(input: {
  candidate?: MarketRadarPipelineCandidateSummary | null
  events?: Array<Partial<MarketRadarEventRow>> | null
}): {
  has_material_change_since_pipeline_review: boolean
  actionable_reason: MarketRadarActionableReason | null
  event: Partial<MarketRadarEventRow> | null
}

export function getMarketRadarActionability(input: {
  product: Partial<MarketRadarProductRow>
  candidate?: MarketRadarPipelineCandidateSummary | null
  events?: Array<Partial<MarketRadarEventRow>> | null
}): {
  pipeline_candidate_id: string | null
  pipeline_candidate_state: string | null
  pipeline_last_evaluated_at: string | null
  has_material_change_since_pipeline_review: boolean
  actionable_reason: MarketRadarActionableReason
  stock_validation_status: MarketRadarStockValidationStatus
  radar_action_status: MarketRadarActionStatus
}

export function decorateMarketRadarProductActionability<
  Product extends Partial<MarketRadarProductRow>,
>(input: {
  product: Product
  candidate?: MarketRadarPipelineCandidateSummary | null
  events?: Array<Partial<MarketRadarEventRow>> | null
}): Product & ReturnType<typeof getMarketRadarActionability>
