export const EBAY_PIPELINE_STATES: string[]
export const DEFAULT_EBAY_PIPELINE_CONFIG: Record<string, unknown>
export function toNumber(value: unknown): number | null
export function getCandidateKey(candidate: Record<string, any>): string
export function getListingQuantityPolicy(inventoryContext?: Record<string, any>): Record<string, any>
export function getPipelineReanalysisAdvisor(args?: {
  existingCandidate?: Record<string, any> | null,
  radarProduct?: Record<string, any> | null,
  latestSnapshot?: Record<string, any> | null,
  advisorEvents?: Array<Record<string, any>>,
  inventoryContext?: Record<string, any> | null,
  lunaAuthState?: string | null,
}): Record<string, any>
export function normalizeRadarProductToEbayCandidate(radarProduct: Record<string, any>): Record<string, any>
export function validateCandidateData(candidate: Record<string, any>, config?: Record<string, any>): Record<string, any>
export function calculateProfitScenario(candidate: Record<string, any>, config?: Record<string, any>): Record<string, any>
export function runComplianceChecks(candidate: Record<string, any>, profitScenario: Record<string, any>, config?: Record<string, any>): Record<string, any>
export function calculateWinnerScore(candidate: Record<string, any>, validation: Record<string, any>, profitScenario: Record<string, any>, compliance: Record<string, any>): Record<string, any>
export function decideCandidateState(validation: Record<string, any>, profitScenario: Record<string, any>, compliance: Record<string, any>): string
export function buildHumanExplanation(candidate: Record<string, any>, profitScenario: Record<string, any>, compliance: Record<string, any>, score: Record<string, any>): string
export function buildWhatsAppDryRunPayload(candidate: Record<string, any>, profitScenario: Record<string, any>, score: Record<string, any>, explanation: string): Record<string, any>
export function processRadarCandidate(radarProduct: Record<string, any>, config?: Record<string, any>): Record<string, any>
export function normalizeDecisionAction(action: string): string | null
export function buildDecisionIdempotencyKey(args: { candidateKey: string, messageId?: string, action: string }): string
