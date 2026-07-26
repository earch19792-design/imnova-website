export const EBAY_DEMAND_EVIDENCE_POLICY_VERSION =
  "EBAY_CONFIRMED_DEMAND_V2" as const

export const EBAY_DEMAND_EVIDENCE_POLICY_FLAGS = {
  enabled: "EBAY_CONFIRMED_DEMAND_V2_ENABLED",
  shadowMode: "EBAY_CONFIRMED_DEMAND_V2_SHADOW_MODE",
} as const

export type EbayDemandEvidenceClass =
  | "CONFIRMED_SOLD_EXACT"
  | "OBSERVED_ESTIMATED_ROTATION"
  | "POPULARITY_OR_RELATED"
  | "ACTIVE_ONLY"
  | "UNKNOWN"

export type EbayDemandEvidenceBlockerCode =
  | "POLICY_DISABLED_FAIL_CLOSED"
  | "SHADOW_MODE_NO_ADVANCEMENT"
  | "CONFIRMED_SOLD_EXACT_REQUIRED"
  | "OFFICIAL_EBAY_SOURCE_REQUIRED"
  | "REVIEWED_EVIDENCE_REQUIRED"
  | "EXACT_IDENTITY_REQUIRED"
  | "SAME_PACK_REQUIRED"
  | "SAME_VARIANT_REQUIRED"
  | "SAME_CONDITION_REQUIRED"
  | "FRESH_EVIDENCE_REQUIRED"
  | "SOLD_EXACT_UNITS_REQUIRED"
  | "SOLD_EXACT_SELLERS_REQUIRED"
  | "SOLD_EXACT_COMPARABLES_REQUIRED"

export interface EbayDemandEvidencePolicyInput {
  evidenceClass?: EbayDemandEvidenceClass | null
  officialEbaySource?: boolean | null
  reviewed?: boolean | null
  exactIdentity?: boolean | null
  samePack?: boolean | null
  sameVariant?: boolean | null
  sameCondition?: boolean | null
  observedAt?: string | null
  expiresAt?: string | null
  soldExactUnits?: unknown
  soldExactSellerCount?: unknown
  soldExactComparableCount?: unknown
}

export interface EbayDemandEvidencePolicyRuntime {
  enabled: boolean
  shadowMode: boolean
  now: string
  minimumSoldExactUnits: number
  minimumSoldExactSellerCount: number
  minimumSoldExactComparableCount: number
}

export interface EbayDemandEvidencePolicyResult {
  policyVersion: typeof EBAY_DEMAND_EVIDENCE_POLICY_VERSION
  mode: "DISABLED_FAIL_CLOSED" | "SHADOW" | "ENFORCED"
  evidenceClass: EbayDemandEvidenceClass
  demandValidated: boolean
  shadowDemandValidated: boolean
  researchEligible: boolean
  soldExactUnits: number
  soldExactSellerCount: number
  soldExactComparableCount: number
  blockerCodes: EbayDemandEvidenceBlockerCode[]
}

function nonNegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    return 0
  }
  return value
}

function positiveInteger(value: unknown, fallback: number): number {
  const normalized = nonNegativeInteger(value)
  return normalized > 0 ? normalized : fallback
}

function validInstant(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function getEbayDemandEvidencePolicyRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): EbayDemandEvidencePolicyRuntime {
  return {
    enabled:
      environment[EBAY_DEMAND_EVIDENCE_POLICY_FLAGS.enabled] === "true",
    shadowMode:
      environment[EBAY_DEMAND_EVIDENCE_POLICY_FLAGS.shadowMode] !== "false",
    now: now.toISOString(),
    minimumSoldExactUnits: 3,
    minimumSoldExactSellerCount: 2,
    minimumSoldExactComparableCount: 1,
  }
}

export function evaluateEbayDemandEvidencePolicy(
  input: EbayDemandEvidencePolicyInput,
  runtime: Partial<EbayDemandEvidencePolicyRuntime> = {},
): EbayDemandEvidencePolicyResult {
  const defaults = getEbayDemandEvidencePolicyRuntime()
  const resolved: EbayDemandEvidencePolicyRuntime = {
    enabled: runtime.enabled ?? defaults.enabled,
    shadowMode: runtime.shadowMode ?? defaults.shadowMode,
    now: runtime.now ?? defaults.now,
    minimumSoldExactUnits: positiveInteger(
      runtime.minimumSoldExactUnits,
      defaults.minimumSoldExactUnits,
    ),
    minimumSoldExactSellerCount: positiveInteger(
      runtime.minimumSoldExactSellerCount,
      defaults.minimumSoldExactSellerCount,
    ),
    minimumSoldExactComparableCount: positiveInteger(
      runtime.minimumSoldExactComparableCount,
      defaults.minimumSoldExactComparableCount,
    ),
  }
  const evidenceClass = input.evidenceClass ?? "UNKNOWN"
  const soldExactUnits = nonNegativeInteger(input.soldExactUnits)
  const soldExactSellerCount = nonNegativeInteger(
    input.soldExactSellerCount,
  )
  const soldExactComparableCount = nonNegativeInteger(
    input.soldExactComparableCount,
  )
  const observedAt = validInstant(input.observedAt)
  const expiresAt = validInstant(input.expiresAt)
  const now = validInstant(resolved.now)
  const fresh =
    observedAt !== null &&
    expiresAt !== null &&
    now !== null &&
    observedAt <= now &&
    expiresAt > now
  const blockerCodes: EbayDemandEvidenceBlockerCode[] = []

  if (!resolved.enabled) blockerCodes.push("POLICY_DISABLED_FAIL_CLOSED")
  if (resolved.shadowMode) blockerCodes.push("SHADOW_MODE_NO_ADVANCEMENT")
  if (evidenceClass !== "CONFIRMED_SOLD_EXACT") {
    blockerCodes.push("CONFIRMED_SOLD_EXACT_REQUIRED")
  }
  if (input.officialEbaySource !== true) {
    blockerCodes.push("OFFICIAL_EBAY_SOURCE_REQUIRED")
  }
  if (input.reviewed !== true) {
    blockerCodes.push("REVIEWED_EVIDENCE_REQUIRED")
  }
  if (input.exactIdentity !== true) {
    blockerCodes.push("EXACT_IDENTITY_REQUIRED")
  }
  if (input.samePack !== true) blockerCodes.push("SAME_PACK_REQUIRED")
  if (input.sameVariant !== true) blockerCodes.push("SAME_VARIANT_REQUIRED")
  if (input.sameCondition !== true) {
    blockerCodes.push("SAME_CONDITION_REQUIRED")
  }
  if (!fresh) blockerCodes.push("FRESH_EVIDENCE_REQUIRED")
  if (soldExactUnits < resolved.minimumSoldExactUnits) {
    blockerCodes.push("SOLD_EXACT_UNITS_REQUIRED")
  }
  if (soldExactSellerCount < resolved.minimumSoldExactSellerCount) {
    blockerCodes.push("SOLD_EXACT_SELLERS_REQUIRED")
  }
  if (
    soldExactComparableCount < resolved.minimumSoldExactComparableCount
  ) {
    blockerCodes.push("SOLD_EXACT_COMPARABLES_REQUIRED")
  }

  const evidenceBlockers = blockerCodes.filter(
    (code) =>
      code !== "POLICY_DISABLED_FAIL_CLOSED" &&
      code !== "SHADOW_MODE_NO_ADVANCEMENT",
  )
  const shadowDemandValidated = evidenceBlockers.length === 0
  const demandValidated =
    resolved.enabled && !resolved.shadowMode && shadowDemandValidated

  return {
    policyVersion: EBAY_DEMAND_EVIDENCE_POLICY_VERSION,
    mode: !resolved.enabled
      ? "DISABLED_FAIL_CLOSED"
      : resolved.shadowMode
        ? "SHADOW"
        : "ENFORCED",
    evidenceClass,
    demandValidated,
    shadowDemandValidated,
    researchEligible: evidenceClass !== "UNKNOWN",
    soldExactUnits,
    soldExactSellerCount,
    soldExactComparableCount,
    blockerCodes,
  }
}
