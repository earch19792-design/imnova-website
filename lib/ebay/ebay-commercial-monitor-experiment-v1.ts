export const EXPERIMENT_REGISTRY_CONTRACT_VERSION =
  "EBAY_EXPERIMENT_REGISTRY_V1" as const

export const EXPERIMENT_LIFECYCLE_STATES = [
  "DRAFT",
  "READY",
  "RUNNING",
  "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE",
  "PAUSED_FOR_EXTERNAL_SIGNAL",
  "COMPLETED",
  "INCONCLUSIVE",
  "CANCELLED",
] as const

export type ExperimentLifecycleStateV1 =
  typeof EXPERIMENT_LIFECYCLE_STATES[number]

export type ExperimentEvidenceMetricV1 =
  | "IMPRESSIONS"
  | "LISTING_VIEWS"
  | "QUANTITY_SOLD"
  | "DATA_QUALITY_RESOLUTION"

export type ExperimentRegistryRecordV1 = {
  contractVersion: typeof EXPERIMENT_REGISTRY_CONTRACT_VERSION
  experimentId: string
  accountKey: string
  marketplace: "EBAY_US"
  ebayItemId: string
  sku: string | null
  hypothesis: string
  diagnosisClass: "VISIBILITY" | "CTR" | "CONVERSION" | "DATA_QUALITY"
  experimentType: string
  variableChanged: string
  changedAt: string
  baselineEvidenceRef: string | null
  baselineMetric: ExperimentEvidenceMetricV1
  baselineValue: number | null
  lifecycleState: ExperimentLifecycleStateV1
  frozenVariables: string[]
  minimumObservationDurationHours: number
  minimumEvidenceMetric: ExperimentEvidenceMetricV1
  minimumEvidenceValue: number
  currentEvidenceValue: number | null
  nextReviewAt: string | null
  createdAt: string
  updatedAt: string
}

export type ExternalEbaySignalV1 = {
  code: string
  observedAt: string
  source: string
}

export type ExternalSignalClassificationV1 =
  | "HARD_OVERRIDE"
  | "SOFT_SIGNAL"
  | "NON_CONFLICTING_SIGNAL"
  | "UNPROVEN"

const HARD_OVERRIDE_CODES = new Set([
  "OUT_OF_STOCK",
  "LISTING_NOT_LIVE",
  "POLICY_COMPLIANCE_ISSUE",
  "AUTHORITATIVE_IDENTITY_CORRUPTION",
  "CRITICAL_REQUIRED_DATA_MISSING",
])

const SOFT_SIGNAL_CODES = new Set([
  "TITLE_SUGGESTION",
  "IMAGE_SUGGESTION",
  "ITEM_SPECIFIC_RECOMMENDATION",
  "PROMOTED_LISTING_SUGGESTION",
  "LISTING_QUALITY_GUIDANCE",
])

export function classifyExternalEbaySignalV1(
  signal: ExternalEbaySignalV1,
): ExternalSignalClassificationV1 {
  if (!signal.code.trim() || !signal.source.trim() ||
      !Number.isFinite(Date.parse(signal.observedAt))) return "UNPROVEN"
  if (HARD_OVERRIDE_CODES.has(signal.code)) return "HARD_OVERRIDE"
  if (SOFT_SIGNAL_CODES.has(signal.code)) return "SOFT_SIGNAL"
  return "NON_CONFLICTING_SIGNAL"
}

export type ExperimentGuardianAssessmentV1 = {
  active: boolean
  protectionState: "NONE" | "DO_NOT_TOUCH" | "PAUSE_FOR_HUMAN_REVIEW"
  operationalAction:
    | "CONTINUE_EXPERIMENT"
    | "QUEUE_FOR_NEXT_REVIEW"
    | "PAUSE_FOR_HUMAN_REVIEW"
    | "HARD_OVERRIDE_REQUIRED"
    | "REVIEW_EXPERIMENT_RESULT"
  timeGateSatisfied: boolean
  evidenceGateSatisfied: boolean
  readyToEvaluate: boolean
  elapsedObservationHours: number | null
  nextReviewAt: string | null
  nextReviewEvidenceRemaining: number | null
  nextReviewReason:
    | "WAIT_MINIMUM_TIME"
    | "WAIT_MINIMUM_EVIDENCE"
    | "WAIT_MINIMUM_TIME_AND_EVIDENCE"
    | "EXTERNAL_SIGNAL_REVIEW"
    | "READY_TO_EVALUATE"
    | "MANUAL_REVIEW"
  frozenVariables: string[]
  externalSignalClassification: ExternalSignalClassificationV1
  externalSignalCount: number
}

const ACTIVE_EXPERIMENT_STATES = new Set<ExperimentLifecycleStateV1>([
  "RUNNING",
  "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE",
  "PAUSED_FOR_EXTERNAL_SIGNAL",
])

export function assessExperimentGuardianV1(input: {
  experiment: ExperimentRegistryRecordV1
  observedAt: string
  currentEvidenceValue?: number | null
  externalSignals?: ExternalEbaySignalV1[]
}): ExperimentGuardianAssessmentV1 {
  const observedAtMs = Date.parse(input.observedAt)
  const changedAtMs = Date.parse(input.experiment.changedAt)
  const elapsedObservationHours = Number.isFinite(observedAtMs) &&
      Number.isFinite(changedAtMs) && observedAtMs >= changedAtMs
    ? (observedAtMs - changedAtMs) / 3_600_000
    : null
  const currentEvidence = input.currentEvidenceValue ??
    input.experiment.currentEvidenceValue
  const timeGateSatisfied = elapsedObservationHours !== null &&
    elapsedObservationHours >= input.experiment.minimumObservationDurationHours
  const evidenceGateSatisfied = currentEvidence !== null &&
    currentEvidence >= input.experiment.minimumEvidenceValue
  const classifications = (input.externalSignals ?? []).map(
    classifyExternalEbaySignalV1,
  )
  const externalSignalClassification: ExternalSignalClassificationV1 =
    classifications.includes("HARD_OVERRIDE")
      ? "HARD_OVERRIDE"
      : classifications.includes("SOFT_SIGNAL")
        ? "SOFT_SIGNAL"
        : classifications.includes("UNPROVEN")
          ? "UNPROVEN"
          : "NON_CONFLICTING_SIGNAL"
  const active = ACTIVE_EXPERIMENT_STATES.has(input.experiment.lifecycleState)
  const hardOverride = active && externalSignalClassification === "HARD_OVERRIDE"
  const readyToEvaluate = active && timeGateSatisfied && evidenceGateSatisfied &&
    !hardOverride
  const nextReviewEvidenceRemaining = currentEvidence === null
    ? input.experiment.minimumEvidenceValue
    : Math.max(0, input.experiment.minimumEvidenceValue - currentEvidence)
  const nextReviewAt = Number.isFinite(changedAtMs)
    ? new Date(changedAtMs +
        input.experiment.minimumObservationDurationHours * 3_600_000).toISOString()
    : input.experiment.nextReviewAt
  const nextReviewReason = hardOverride
    ? "EXTERNAL_SIGNAL_REVIEW" as const
    : readyToEvaluate
      ? "READY_TO_EVALUATE" as const
      : !timeGateSatisfied && !evidenceGateSatisfied
        ? "WAIT_MINIMUM_TIME_AND_EVIDENCE" as const
        : !timeGateSatisfied
          ? "WAIT_MINIMUM_TIME" as const
          : !evidenceGateSatisfied
            ? "WAIT_MINIMUM_EVIDENCE" as const
            : "MANUAL_REVIEW" as const
  return {
    active,
    protectionState: hardOverride
      ? "PAUSE_FOR_HUMAN_REVIEW"
      : active ? "DO_NOT_TOUCH" : "NONE",
    operationalAction: hardOverride
      ? "HARD_OVERRIDE_REQUIRED"
      : readyToEvaluate
        ? "REVIEW_EXPERIMENT_RESULT"
        : externalSignalClassification === "SOFT_SIGNAL"
          ? "QUEUE_FOR_NEXT_REVIEW"
          : "CONTINUE_EXPERIMENT",
    timeGateSatisfied,
    evidenceGateSatisfied,
    readyToEvaluate,
    elapsedObservationHours,
    nextReviewAt,
    nextReviewEvidenceRemaining,
    nextReviewReason,
    frozenVariables: [...new Set(input.experiment.frozenVariables)].sort(),
    externalSignalClassification,
    externalSignalCount: classifications.length,
  }
}

export type ExperimentOutcomeV1 = {
  outcome: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "INCONCLUSIVE" |
    "INSUFFICIENT_EVIDENCE"
  metric: ExperimentEvidenceMetricV1
  baselineValue: number | null
  currentValue: number | null
  delta: number | null
  evidenceSufficient: boolean
  evidenceState: "COMPARABLE_CORRELATIONAL" | "UNPROVEN"
  reasonCodes: string[]
}

export function evaluateExperimentOutcomeV1(input: {
  guardian: ExperimentGuardianAssessmentV1
  metric: ExperimentEvidenceMetricV1
  baselineMetric: ExperimentEvidenceMetricV1
  baselineValue: number | null
  currentValue: number | null
  minimumMeaningfulDelta: number | null
  expectedDirection: "INCREASE" | "DECREASE"
}): ExperimentOutcomeV1 {
  const comparable = input.metric === input.baselineMetric &&
    input.baselineValue !== null && input.currentValue !== null &&
    input.minimumMeaningfulDelta !== null && input.minimumMeaningfulDelta >= 0
  if (!input.guardian.readyToEvaluate || !comparable) {
    return {
      outcome: "INSUFFICIENT_EVIDENCE",
      metric: input.metric,
      baselineValue: input.baselineValue,
      currentValue: input.currentValue,
      delta: null,
      evidenceSufficient: false,
      evidenceState: "UNPROVEN",
      reasonCodes: [!input.guardian.readyToEvaluate
        ? "EXPERIMENT_READINESS_GATES_NOT_SATISFIED"
        : "METRIC_DEFINITION_NOT_COMPARABLE"],
    }
  }
  const delta = (input.currentValue as number) - (input.baselineValue as number)
  const magnitude = Math.abs(delta)
  const neutral = magnitude < (input.minimumMeaningfulDelta as number)
  const expected = input.expectedDirection === "INCREASE" ? delta > 0 : delta < 0
  return {
    outcome: neutral ? "NEUTRAL" : expected ? "POSITIVE" : "NEGATIVE",
    metric: input.metric,
    baselineValue: input.baselineValue,
    currentValue: input.currentValue,
    delta,
    evidenceSufficient: true,
    evidenceState: "COMPARABLE_CORRELATIONAL",
    reasonCodes: [neutral
      ? "CHANGE_BELOW_CONFIGURED_MEANINGFUL_DELTA"
      : "OBSERVED_ASSOCIATION_NOT_CAUSAL_PROOF"],
  }
}

export type ExperimentLearningEntryV1 = {
  experimentId: string
  ebayItemId: string
  experimentType: string
  changeType: string
  result: ExperimentOutcomeV1["outcome"]
  evidenceQuality: ExperimentOutcomeV1["evidenceState"]
  lesson: string
  applicabilityScope:
    | "LISTING_ONLY"
    | "FAMILY_CANDIDATE"
    | "CATEGORY_CANDIDATE"
    | "INSUFFICIENT_FOR_GENERALIZATION"
  createdAt: string
}

export function buildExperimentLearningEntryV1(input: {
  experiment: ExperimentRegistryRecordV1
  outcome: ExperimentOutcomeV1
  lesson: string
  createdAt: string
}): ExperimentLearningEntryV1 {
  const conclusive = input.outcome.evidenceSufficient &&
    input.outcome.outcome !== "INCONCLUSIVE" &&
    input.outcome.outcome !== "INSUFFICIENT_EVIDENCE"
  return {
    experimentId: input.experiment.experimentId,
    ebayItemId: input.experiment.ebayItemId,
    experimentType: input.experiment.experimentType,
    changeType: input.experiment.variableChanged,
    result: input.outcome.outcome,
    evidenceQuality: input.outcome.evidenceState,
    lesson: input.lesson.trim().slice(0, 500),
    applicabilityScope: conclusive
      ? "LISTING_ONLY"
      : "INSUFFICIENT_FOR_GENERALIZATION",
    createdAt: input.createdAt,
  }
}
