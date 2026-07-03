export type MarketRadarEventType =
  | "new_product"
  | "restocked"
  | "out_of_stock"
  | "low_stock"
  | "stock_increased"
  | "stock_decreased_fast"
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
  is_active?: boolean | null
  first_seen_at: string | null
  last_seen_at: string | null
  updated_at_source: string | null
  snapshot_id: string | null
  supplier_variant_id: string | null
  variant_title: string | null
  sku: string | null
  price: number | string | null
  estimated_sale_price?: number | string | null
  compare_at_price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  product_available_quantity?: number | null
  inventory_status: "in_stock" | "out_of_stock" | "unknown"
  inventory_source:
    | "luna_numeric"
    | "luna_authenticated_html"
    | "luna_authenticated_html_product"
    | "luna_availability"
    | "manual_admin_confirmation"
    | "not_exposed"
  inventory_confidence: "high" | "medium" | "low"
  inventory_scope:
    | "variant_level"
    | "product_level"
    | "product_or_category_signal"
    | "availability_only"
    | "unknown"
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
  pipeline_candidate_id?: string | null
  pipeline_candidate_state?: string | null
  pipeline_blocked_reason?: string | null
  pipeline_last_evaluated_at?: string | null
  has_material_change_since_pipeline_review?: boolean
  actionable_reason?:
    | "new_product_not_reviewed"
    | "price_down_after_review"
    | "discount_started_after_review"
    | "restocked_after_review"
    | "stock_increased_after_review"
    | "quantity_changed_after_review"
    | "collection_changed_after_review"
    | "price_up_after_review"
    | "pipeline_candidate_not_evaluated"
    | "out_of_stock_not_listable"
    | "reviewed_no_new_signal"
  stock_validation_status?:
    | "stock_confirmed"
    | "stock_needs_validation"
    | "out_of_stock"
    | "stock_unknown"
  radar_action_status?:
    | "actionable"
    | "reviewed"
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
  supplier_variant_id?: string | null
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
  event_intelligence_label: string
  event_intelligence_summary: string
  event_intelligence_severity: "critical" | "high" | "medium" | "low"
  event_intelligence_advisory_only: true
  seller_risk_label?: string | null
  seller_risk_summary?: string | null
  seller_risk_severity?: "critical" | "high" | "medium" | "low" | null
  seller_action_label: string
  seller_priority: "Urgente" | "Alta" | "Media" | "Baja"
  seller_reason: string
  seller_next_step: string
  commercial_playbook?: {
    label: string
    recommendation: string
    next_step: string
    risk_level: "critical" | "high" | "medium" | "low"
    guardrail: string
    advisory_only: true
  } | null
  stock_context?: {
    inventory_quantity: number | null
    product_available_quantity?: number | null
    inventory_status: "in_stock" | "out_of_stock" | "unknown"
    inventory_source:
      | "luna_numeric"
      | "luna_authenticated_html"
      | "luna_authenticated_html_product"
      | "luna_availability"
      | "manual_admin_confirmation"
      | "not_exposed"
    inventory_confidence: "high" | "medium" | "low"
    inventory_scope?:
      | "variant_level"
      | "product_level"
      | "product_or_category_signal"
      | "availability_only"
      | "unknown"
    stock_message: string
  }
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
  inventoryNumericVariants?: number
  inventoryAvailabilityOnlyVariants?: number
  inventoryUnknownVariants?: number
  inventoryHydrationEnabled?: boolean
  inventoryHydrationCandidates?: number
  inventoryHydratedProducts?: number
  inventoryHydrationSuccessfulFetches?: number
  inventoryHydrationFailedFetches?: number
  inventoryHydrationWithoutNumericInventory?: number
  lunaAuthState?: "approved" | "restricted" | "unknown" | "not_configured"
  lunaAuthMessage?: string
  lunaAuthCheckedHandle?: string | null
  startedAt: string
  finishedAt: string
}
