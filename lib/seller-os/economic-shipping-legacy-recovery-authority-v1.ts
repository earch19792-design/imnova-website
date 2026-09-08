import { createHash } from "node:crypto"

export const SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_CONTRACT_V1 =
  "SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_AUTHORITY_V1" as const
export const SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1 =
  "b618350a9848e8b49f3c0590270afe2d0ec91c14" as const
export const SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_MAX_ATTEMPTS_V1 = 5
export const SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_BATCH_LIMIT_V1 = 1
export const SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_BACKOFF_MINUTES_V1 =
  Object.freeze([1, 2, 4, 8, 15] as const)

export type SellerOsEconomicShippingLegacyRecoveryGateV1 = Readonly<{
  legacyShippingRuntimeActive: false
  heartbeatV1Total: 0
  phaseAV2Active: true
  b618RuntimeActive: true
  jobLegacyClassificationProven: true
}>

export function certifySellerOsEconomicShippingLegacyRecoveryGateV1(
  input: Readonly<{
    legacyShippingRuntimeActive: unknown
    heartbeatV1Total: unknown
    phaseAV2Active: unknown
    b618RuntimeActive: unknown
    jobLegacyClassificationProven: unknown
  }>,
): SellerOsEconomicShippingLegacyRecoveryGateV1 {
  if (input.legacyShippingRuntimeActive !== false ||
      input.heartbeatV1Total !== 0 || input.phaseAV2Active !== true ||
      input.b618RuntimeActive !== true ||
      input.jobLegacyClassificationProven !== true) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_GATE_FAILED")
  }
  return Object.freeze({
    legacyShippingRuntimeActive: false,
    heartbeatV1Total: 0,
    phaseAV2Active: true,
    b618RuntimeActive: true,
    jobLegacyClassificationProven: true,
  })
}

export function sellerOsEconomicShippingLegacyRecoveryDelayMinutesV1(
  recoveryAttempt: number,
) {
  if (!Number.isSafeInteger(recoveryAttempt) || recoveryAttempt < 1) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_ATTEMPT_INVALID")
  }
  return SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_BACKOFF_MINUTES_V1[
    Math.min(recoveryAttempt,
      SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_MAX_ATTEMPTS_V1) - 1]
}

export function sellerOsEconomicShippingLegacyRecoveryGenerationV1(
  input: Readonly<{
    accountKey: string
    jobId: string
    classificationFingerprint: string
  }>,
) {
  if (!input.accountKey.trim() ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(input.jobId) ||
      !/^sha256:[0-9a-f]{64}$/.test(input.classificationFingerprint)) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_BINDING_INVALID")
  }
  const digest = createHash("sha256").update(JSON.stringify({
    contractVersion:
      SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_CONTRACT_V1,
    accountKey: input.accountKey,
    jobId: input.jobId.toLowerCase(),
    classificationFingerprint: input.classificationFingerprint,
    runtimeCommitSha:
      SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1,
  })).digest("hex")
  return `economic-shipping-legacy-recovery-v1:sha256:${digest}`
}
