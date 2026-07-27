import { createHash } from "node:crypto"

import { EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION } from
  "./ebay-listing-image-factory"

export const SAME_DAY_IMAGE_JOB_LINEAGE_VERSION =
  "VISUAL_V3_FACT_RUN_BOUND_V1_2026_07_23"
export const SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION =
  "IMAGE_PREPARATION_ORPHAN_RECOVERY_V2_2026_07_26"
export const SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION =
  "IMAGE_SINGLE_UNIT_VISUAL_STRATEGY_RECOVERY_V6_2026_07_24"
export const SAME_DAY_IMAGE_DETERMINISTIC_FALLBACK_RECOVERY_VERSION =
  "IMAGE_POST_AI_DETERMINISTIC_FALLBACK_V1_2026_07_24"
export const SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION =
  "IMAGE_PROFESSIONAL_MARKET_FALLBACK_V1_2026_07_24"
export const SAME_DAY_IMAGE_SOURCE_REUSE_PREVIOUS_RECOVERY_VERSION =
  "IMAGE_SOURCE_REUSE_CONSTRAINED_CAP3_RECOVERY_V1_2026_07_26"
export const SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION =
  "IMAGE_SOURCE_REUSE_CONSTRAINED_CAP3_RECOVERY_V2_2026_07_27"
export const SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION =
  "IMAGE_AUTHORIZED_CATALOG_COMPLETION_CAP3_RECOVERY_V1_2026_07_26"

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
    deterministicFallbackRecoveryVersion?:
      typeof SAME_DAY_IMAGE_DETERMINISTIC_FALLBACK_RECOVERY_VERSION
    forceDeterministicImageFallback?: true
    professionalMarketFallbackRecoveryVersion?:
      typeof SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION
    sourceReuseRecoveryVersion?:
      typeof SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION
    preGenerationHash?: string
    authorizedCatalogCompletionRecoveryVersion?:
      typeof SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION
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

export function buildSameDaySourceReusePreGenerationHash(input: {
  accountKey: unknown
  actorId: unknown
  runId: unknown
  candidateId: unknown
  listingPackageId: unknown
  factRunId: unknown
  packageHash: unknown
  sourceReuseRecoveryVersion: unknown
}) {
  const accountKey = text(input.accountKey)
  const actorId = text(input.actorId)
  const runId = text(input.runId)
  const candidateId = text(input.candidateId)
  const listingPackageId = text(input.listingPackageId)
  const factRunId = text(input.factRunId)
  const packageHash = text(input.packageHash)
  if (
    !accountKey ||
    !UUID_PATTERN.test(actorId) ||
    !UUID_PATTERN.test(runId) ||
    !UUID_PATTERN.test(candidateId) ||
    !UUID_PATTERN.test(listingPackageId) ||
    !UUID_PATTERN.test(factRunId) ||
    !/^[0-9a-f]{64}$/i.test(packageHash) ||
    text(input.sourceReuseRecoveryVersion) !==
      SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION
  ) return null
  return createHash("sha256").update([
    accountKey,
    actorId,
    runId,
    candidateId,
    listingPackageId,
    factRunId,
    packageHash,
    "deterministic",
    EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
  ].join(":")).digest("hex")
}

export function buildSameDayImageGenerationJobSpec(input: {
  accountKey?: unknown
  actorId?: unknown
  runId: unknown
  candidateId: unknown
  listingPackageId?: unknown
  productResearchCaptureBatchId: unknown
  factRunId: unknown
  packageHash: unknown
  orphanRecovery?: boolean
  visualStrategyRecovery?: boolean
  deterministicFallbackRecovery?: boolean
  professionalMarketFallbackRecovery?: boolean
  sourceReuseRecovery?: boolean
  authorizedCatalogCompletionRecovery?: boolean
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
    !SHA256_PATTERN.test(packageHash) ||
    // A deterministic recovery can only restyle one authorized photograph;
    // it cannot turn that photograph into six truthful commercial views.
    input.deterministicFallbackRecovery === true
  ) return null
  const sourceReusePreGenerationHash = input.sourceReuseRecovery
    ? buildSameDaySourceReusePreGenerationHash({
      accountKey: input.accountKey,
      actorId: input.actorId,
      runId,
      candidateId,
      listingPackageId: input.listingPackageId,
      factRunId,
      packageHash,
      sourceReuseRecoveryVersion:
        SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION,
    })
    : null
  if (input.sourceReuseRecovery && !sourceReusePreGenerationHash) return null

  const recoverySegments = [
    ...(input.orphanRecovery
      ? [SAME_DAY_IMAGE_ORPHAN_RECOVERY_VERSION]
      : []),
    ...(input.visualStrategyRecovery
      ? [SAME_DAY_IMAGE_VISUAL_STRATEGY_RECOVERY_VERSION]
      : []),
    ...(input.professionalMarketFallbackRecovery
      ? [SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION]
      : []),
    ...(input.sourceReuseRecovery
      ? [SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION]
      : []),
    ...(input.authorizedCatalogCompletionRecovery
      ? [SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION]
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
      ...(sourceReusePreGenerationHash
        ? [sourceReusePreGenerationHash]
        : []),
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
      ...(input.professionalMarketFallbackRecovery
        ? {
            professionalMarketFallbackRecoveryVersion:
              SAME_DAY_IMAGE_PROFESSIONAL_MARKET_FALLBACK_RECOVERY_VERSION,
          }
        : {}),
      ...(input.sourceReuseRecovery
        ? {
            sourceReuseRecoveryVersion:
              SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_VERSION,
            preGenerationHash: sourceReusePreGenerationHash!,
          }
        : {}),
      ...(input.authorizedCatalogCompletionRecovery
        ? {
            authorizedCatalogCompletionRecoveryVersion:
              SAME_DAY_IMAGE_AUTHORIZED_CATALOG_COMPLETION_RECOVERY_VERSION,
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
