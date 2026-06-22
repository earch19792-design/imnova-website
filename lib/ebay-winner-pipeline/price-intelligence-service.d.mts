export type PriceIntelligenceSourceType =
  | "manual"
  | "aiprice"
  | "terapeak"
  | "zik"
  | "ebay_api"
  | "other"

export type PriceIntelligenceSourceConfidence =
  | "low"
  | "medium"
  | "high"

export type PriceIntelligenceProductMatchType =
  | "exact"
  | "same_model"
  | "similar"
  | "category_only"
  | "unknown"

export type PriceIntelligenceSnapshotInput = {
  candidate_id?: string | null
  candidateId?: string | null
  market_radar_product_id?: string | null
  marketRadarProductId?: string | null
  supplier_sku?: string | null
  supplierSku?: string | null
  candidate_key?: string | null
  candidateKey?: string | null
  source_type?: PriceIntelligenceSourceType | string | null
  sourceType?: PriceIntelligenceSourceType | string | null
  marketplace?: "ebay" | string | null
  search_query?: string | null
  searchQuery?: string | null
  product_match_type?: PriceIntelligenceProductMatchType | string | null
  productMatchType?: PriceIntelligenceProductMatchType | string | null
  sold_avg_price?: number | string | null
  sold_median_price?: number | string | null
  sold_min_price?: number | string | null
  sold_max_price?: number | string | null
  sold_comp_count?: number | string | null
  active_avg_price?: number | string | null
  active_min_price?: number | string | null
  active_max_price?: number | string | null
  active_comp_count?: number | string | null
  estimated_shipping_cost?: number | string | null
  recommended_sale_price?: number | string | null
  confidence_score?: number | string | null
  confidenceScore?: number | string | null
  source_confidence?: PriceIntelligenceSourceConfidence | string | null
  sourceConfidence?: PriceIntelligenceSourceConfidence | string | null
  category_id?: string | null
  categoryId?: string | null
  category_name?: string | null
  categoryName?: string | null
  evidence_url?: string | null
  evidenceUrl?: string | null
  evidence_notes?: string | null
  evidenceNotes?: string | null
}

export type PriceIntelligenceSnapshot = {
  id: string
  candidate_id: string | null
  market_radar_product_id: string | null
  supplier_sku: string
  candidate_key: string | null
  source_type: PriceIntelligenceSourceType
  marketplace: "ebay"
  search_query: string | null
  product_match_type: PriceIntelligenceProductMatchType | null
  sold_avg_price: number | string | null
  sold_median_price: number | string | null
  sold_min_price: number | string | null
  sold_max_price: number | string | null
  sold_comp_count: number | null
  active_avg_price: number | string | null
  active_min_price: number | string | null
  active_max_price: number | string | null
  active_comp_count: number | null
  estimated_shipping_cost: number | string | null
  recommended_sale_price: number | string | null
  confidence_score: number | string | null
  source_confidence: PriceIntelligenceSourceConfidence | null
  category_id: string | null
  category_name: string | null
  evidence_url: string | null
  evidence_notes: string | null
  raw_payload: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export function createPriceIntelligenceSnapshot(args: {
  supabase: unknown
  input: PriceIntelligenceSnapshotInput
  actor?: string
}): Promise<PriceIntelligenceSnapshot>

export function getLatestPriceIntelligenceForSku(args: {
  supabase: unknown
  supplierSku?: string | null
}): Promise<PriceIntelligenceSnapshot | null>

export function getPriceIntelligenceForCandidate(args: {
  supabase: unknown
  candidateId?: string | null
  supplierSku?: string | null
}): Promise<PriceIntelligenceSnapshot[]>

export function listPriceIntelligenceSnapshots(args?: {
  supabase: unknown
  filters?: {
    supplierSku?: string | null
    supplier_sku?: string | null
    candidateId?: string | null
    candidate_id?: string | null
  }
  page?: number
  limit?: number
}): Promise<{
  snapshots: PriceIntelligenceSnapshot[]
  pagination: {
    page: number
    limit: number
    total: number
    hasNextPage: boolean
  }
}>
