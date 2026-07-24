export const SAME_DAY_IMAGE_JOB_LINEAGE_VERSION =
  "VISUAL_V3_FACT_RUN_BOUND_V1_2026_07_23"
export const SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION =
  "IMAGE_PREPARATION_ORPHAN_RECOVERY_V1_2026_07_23"
export const SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION =
  "IMAGE_SINGLE_UNIT_VISUAL_STRATEGY_RECOVERY_V4_2026_07_23"

export type SameDayImageGenerationJobSpec = {
  jobType: "GENERATE_SIX_IMAGE_PACKAGE"
  idempotencyKey: string
  checkpoint: {
    packageHash: string
    factRunId: string
    productResearchCaptureBatchId: string
    generationAttemptVersion: typeof SAME_DAY_IMAGE_JOB_LINEAGE_VERSION
    orphanRecoveryVersion?: typeof SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION
    visualStrategyRecoveryVersion?:
      typeof SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION
    maximumOpenAiCalls: 1
    competitorImages: 0
    ebayWrites: 0
  }
  maxAttempts: 4
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/i

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

export function buildSameDayImageGenerationJobSpec(input: {
  runId: unknown
  candidateId: unknown
  productResearchCaptureBatchId: unknown
  factRunId: unknown
  packageHash: unknown
  orphanRecovery?: boolean
  visualStrategyRecovery?: boolean
}): SameDayImageGenerationJobSpec | null {
  const runId = text(input.runId)
  const candidateId = text(input.candidateId)
  const productResearchCaptureBatchId = text(
    input.productResearchCaptureBatchId,
  )
  const factRunId = text(input.factRunId)
  const packageHash = text(input.packageHash)
  if (
    !UUID_PATTERN.test(runId) ||
    !UUID_PATTERN.test(candidateId) ||
    !UUID_PATTERN.test(productResearchCaptureBatchId) ||
    !UUID_PATTERN.test(factRunId) ||
    !SHA256_PATTERN.test(packageHash)
  ) return null

  const recoverySegments = [
    ...(input.orphanRecovery
      ? [SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION]
      : []),
    ...(input.visualStrategyRecovery
      ? [SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION]
      : []),
  ]
  return {
    jobType: "GENERATE_SIX_IMAGE_PACKAGE",
    idempotencyKey: [
      runId,
      candidateId,
      "GENERATE_SIX_IMAGE_PACKAGE",
      SAME_DAY_IMAGE_JOB_LINEAGE_VERSION,
      productResearchCaptureBatchId,
      factRunId,
      packageHash,
    ].join(":") + (recoverySegments.length
      ? `:${recoverySegments.join(":")}`
      : ""),
    checkpoint: {
      packageHash,
      factRunId,
      productResearchCaptureBatchId,
      generationAttemptVersion: SAME_DAY_IMAGE_JOB_LINEAGE_VERSION,
      ...(input.orphanRecovery
        ? { orphanRecoveryVersion: SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION }
        : {}),
      ...(input.visualStrategyRecovery
        ? {
            visualStrategyRecoveryVersion:
              SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION,
          }
        : {}),
      maximumOpenAiCalls: 1,
      competitorImages: 0,
      ebayWrites: 0,
    },
    maxAttempts: 4,
  }
}

export function isSameDayImagePreparationOrphan(input: {
  machineState: unknown
  handoffStatus: unknown
  packageHash: unknown
  productResearchCaptureBatchId: unknown
  factRunId: unknown
  openPrimaryHumanTasks: number
  imageJobStatuses: unknown[]
}) {
  if (
    text(input.machineState) !== "PREPARING_IMAGE_PACKAGE" ||
    text(input.handoffStatus) !== "AWAITING_IMAGE_APPROVAL" ||
    !SHA256_PATTERN.test(text(input.packageHash)) ||
    !UUID_PATTERN.test(text(input.productResearchCaptureBatchId)) ||
    !UUID_PATTERN.test(text(input.factRunId)) ||
    input.openPrimaryHumanTasks > 0
  ) return false

  return !input.imageJobStatuses.some((status) =>
    ["PENDING", "WAITING_RETRY", "LEASED", "DEAD_LETTER"].includes(
      text(status),
    ))
}
