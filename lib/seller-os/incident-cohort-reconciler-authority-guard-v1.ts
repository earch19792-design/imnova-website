export const SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_ID_V1 =
  "legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba" as const

export const SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_AUTHORITY_V2 =
  "close_seller_os_economic_shipping_legacy_out_of_scope_v2" as const

export const SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_CONTRACT_V2 =
  "SELLER_OS_LEGACY_SHIPPING_OUT_OF_SCOPE_DISPOSITION_CONTRACT_V2" as const

export const SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_REASON_V2 =
  "LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED" as const

export type IncidentCohortMemberV1 = Readonly<{
  jobId: string
  idempotencyKey: string
  incidentClassification: "RECOVERABLE_VALID_SCOPE" |
    "OUT_OF_SCOPE_NO_ACTIVE_LISTING"
}>

export function guardIncidentCohortFromGenericReconciliationV1<
  T extends Readonly<{ idempotency_key: string }>,
>(input: Readonly<{
  detectedRows: readonly T[]
  incidentMembers: readonly IncidentCohortMemberV1[]
}>) {
  const protectedKeys = new Set(input.incidentMembers.map((member) =>
    member.idempotencyKey))
  const protectedRows: T[] = []
  const genericRows: T[] = []
  for (const row of input.detectedRows) {
    if (protectedKeys.has(row.idempotency_key)) protectedRows.push(row)
    else genericRows.push(row)
  }
  return Object.freeze({
    genericRows: Object.freeze(genericRows),
    protectedRows: Object.freeze(protectedRows),
    protectedJobIds: Object.freeze(input.incidentMembers.map((member) =>
      member.jobId).sort()),
    cohortMembershipSource:
      "SELLER_OS_LEGACY_SHIPPING_INCIDENT_MEMBERS_V1" as const,
    currentEconomicJobEligibilityUsedForMembership: false as const,
    outOfScopeDispositionAuthority:
      SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_AUTHORITY_V2,
  })
}
