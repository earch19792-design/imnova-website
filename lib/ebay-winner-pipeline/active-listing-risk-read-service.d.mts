export type ActiveListingRiskPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"

export type ActiveListingRiskType =
  | "out_of_stock"
  | "stock_unknown"
  | "price_up"
  | "margin_review"
  | "listing_stale"
  | "manual_review"

export type ActiveListingRiskRow = {
  active_listing_id: string | null
  risk_event_id: string | null
  ebay_item_id: string | null
  ebay_sku: string | null
  supplier_sku: string | null
  title: string | null
  listing_status: string | null
  ebay_quantity: number | null
  ebay_price: number | null
  currency: string | null
  risk_type: ActiveListingRiskType | string | null
  risk_priority: ActiveListingRiskPriority | string | null
  risk_summary: string | null
  recommended_action: string | null
  created_at: string | null
  resolved_at: string | null
}

export type ActiveListingRiskSummary = {
  total_open: number
  by_priority: Record<ActiveListingRiskPriority, number>
  by_type: Record<ActiveListingRiskType, number>
}

export function getOpenActiveListingRisks(args?: {
  supabase: any
  limit?: number
}): Promise<ActiveListingRiskRow[]>

export function getActiveListingRiskSummary(args?: {
  supabase: any
  limit?: number
}): Promise<ActiveListingRiskSummary>

export function getRisksByEbaySku(args?: {
  supabase: any
  sku: string
  limit?: number
}): Promise<ActiveListingRiskRow[]>

export function getRisksBySupplierSku(args?: {
  supabase: any
  supplierSku: string
  limit?: number
}): Promise<ActiveListingRiskRow[]>
