export type MarketRadarEventType =
  | "new_product"
  | "restocked"
  | "out_of_stock"
  | "price_up"
  | "price_down"
  | "entered_collection"
  | "exited_collection"
  | "discount_started"
  | "discount_ended"

export type MarketRadarSource = {
  id: string
  key: string
  name: string
  base_url: string
  is_active: boolean
  poll_interval_minutes: number
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
}

export type MarketRadarProductRow = {
  product_id: string
  source_id: string
  source_key: string
  source_name: string
  supplier_product_id: string
  handle: string
  title: string
  vendor: string | null
  product_type: string | null
  tags: string[] | null
  product_url: string | null
  featured_image_url: string | null
  image_urls: string[] | null
  first_seen_at: string | null
  last_seen_at: string | null
  updated_at_source: string | null
  snapshot_id: string | null
  supplier_variant_id: string | null
  variant_title: string | null
  sku: string | null
  price: number | string | null
  compare_at_price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  collections: string[] | null
  discount_percent: number | string | null
  last_captured_at: string | null
  opportunity_score: number | string | null
  rotation_score: number | string | null
  price_score: number | string | null
  stock_score: number | string | null
  discount_score: number | string | null
  collection_score: number | string | null
  event_count_24h: number | null
  event_count_7d: number | null
  restock_count_7d: number | null
  out_of_stock_count_7d: number | null
  price_change_count_7d: number | null
  last_event_at: string | null
  score_updated_at: string | null
}

export type MarketRadarEventRow = {
  id: string
  source_id: string
  product_id: string
  supplier_variant_id: string
  event_type: MarketRadarEventType
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  event_strength: number
  created_at: string
  product?: {
    title: string | null
    handle: string | null
    product_url: string | null
    featured_image_url: string | null
  } | null
}

export type RadarAdvisorAlert = {
  event_type: string
  product_id: string | null
  product_title: string
  supplier_sku: string | null
  previous_value: Record<string, unknown> | null
  current_value: Record<string, unknown> | null
  severity: "critical" | "high" | "medium" | "low"
  business_signal: string
  advisor_message: string
  recommended_action: string
  automation_available: boolean
  automation_level: number
  required_human_approval: boolean
  proposed_next_step: string
  candidate_state: string | null
  candidate_id: string | null
  created_at: string | null
}

export type MarketRadarSummary = {
  source: MarketRadarSource | null
  totalProducts: number
  availableProducts: number
  outOfStockProducts: number
  discountedProducts: number
  highOpportunityProducts: number
  priceChanges24h: number
  restocks7d: number
  stockOuts7d: number
  lastRunAt: string | null
  lastSuccessAt: string | null
}

export type MarketRadarDashboard = {
  summary: MarketRadarSummary
  products: MarketRadarProductRow[]
  recentEvents: MarketRadarEventRow[]
  advisorAlerts: RadarAdvisorAlert[]
}

export type MarketRadarSyncResult = {
  success: boolean
  sourceKey: string
  fetchedProducts: number
  fetchedVariants: number
  snapshotsInserted: number
  eventsInserted: number
  scoredProducts: number
  startedAt: string
  finishedAt: string
}
