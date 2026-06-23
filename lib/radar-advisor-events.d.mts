export type RadarAdvisorEvent = {
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

export function getRadarAdvisorEvent(
  event: Record<string, any>,
  product?: Record<string, any> | null,
  candidate?: Record<string, any> | null
): RadarAdvisorEvent | null
