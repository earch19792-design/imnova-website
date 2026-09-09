export const GENERATABLE_VISUAL_FINDINGS_V1 = Object.freeze([
  "LOW_FRAME_UTILIZATION", "EXCESS_DEAD_SPACE", "OFF_CENTER_PRODUCT",
  "EDGE_CROPPING_RISK", "WHITE_BACKGROUND_NOT_PROVEN",
] as const)

export function canGenerateVisualFindingV1(code: unknown): boolean {
  return GENERATABLE_VISUAL_FINDINGS_V1.some(value => value === code)
}
