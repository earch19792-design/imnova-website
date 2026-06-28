export type RadarAdvisorEvent = {
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

export function getNormalizedInventoryContext(
  value?: Record<string, any> | null
): NonNullable<RadarAdvisorEvent["stock_context"]>

export function getRadarAdvisorEvent(
  event: Record<string, any>,
  product?: Record<string, any> | null,
  candidate?: Record<string, any> | null
): RadarAdvisorEvent | null
