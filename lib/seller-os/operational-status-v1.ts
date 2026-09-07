export const SELLER_OS_OPERATIONAL_STATES_V1 = Object.freeze([
  "OPERANDO",
  "SIN_TRABAJO",
  "RECUPERANDO",
  "BLOQUEADO",
  "DESCONOCIDO",
] as const)

export type SellerOsOperationalStateV1 =
  typeof SELLER_OS_OPERATIONAL_STATES_V1[number]

export const SELLER_OS_COMPACT_CAPABILITY_STATES_V1 = Object.freeze([
  "OPERATING",
  "IDLE_NO_WORK",
  "RECOVERING",
  "WAITING_FOR_WORKER",
  "STALE_NO_RECENT_OUTPUT",
  "BLOCKED",
  "DEGRADED",
  "UNKNOWN",
] as const)

export type SellerOsCompactCapabilityStateV1 =
  typeof SELLER_OS_COMPACT_CAPABILITY_STATES_V1[number]

export function sellerOsCompactCapabilityStateV1(
  value: unknown,
): SellerOsCompactCapabilityStateV1 {
  return SELLER_OS_COMPACT_CAPABILITY_STATES_V1.includes(value as never)
    ? value as SellerOsCompactCapabilityStateV1 : "UNKNOWN"
}

export function sellerOsCompactCapabilityLabelV1(
  state: SellerOsCompactCapabilityStateV1,
) {
  if (state === "OPERATING") return "OPERANDO"
  if (state === "IDLE_NO_WORK") return "SIN TRABAJO"
  if (state === "RECOVERING") return "RECUPERANDO"
  if (state === "WAITING_FOR_WORKER") return "ESPERANDO WORKER"
  if (state === "STALE_NO_RECENT_OUTPUT") return "ATRASADO"
  if (state === "BLOCKED") return "BLOQUEADO"
  if (state === "DEGRADED") return "DEGRADADO"
  return "DESCONOCIDO"
}

export function projectSellerOsCompactCapabilityStatesV1(input: Readonly<{
  lunaAuthorityAvailable: boolean
  lunaEligiblePendingJobCount: number | null
  lunaCapabilityProven: boolean
  productResearchAuthorityAvailable: boolean
  productResearchPlanStatus: string
  productResearchCapabilityFresh: boolean
  radarAuthorityAvailable: boolean
  radarOutputFresh: boolean
  radarOperationalState: SellerOsOperationalStateV1 | null
  commercialAuthorityAvailable: boolean
  orderAuthorityAvailable: boolean
  currentLiveAuthorityAvailable: boolean
  publisherPhysicalAcceptance: boolean
  mayelAuthorityAvailable: boolean
  mayelPendingCount: number | null
}>) {
  const lunaShipping: SellerOsCompactCapabilityStateV1 =
    !input.lunaAuthorityAvailable ? "UNKNOWN"
      : input.lunaEligiblePendingJobCount !== null &&
          input.lunaEligiblePendingJobCount > 0 &&
          !input.lunaCapabilityProven ? "WAITING_FOR_WORKER"
        : !input.lunaCapabilityProven ? "UNKNOWN"
          : input.lunaEligiblePendingJobCount === 0
            ? "IDLE_NO_WORK" : "RECOVERING"
  const productResearch: SellerOsCompactCapabilityStateV1 =
    !input.productResearchAuthorityAvailable ? "UNKNOWN"
      : Boolean(input.productResearchPlanStatus) &&
          input.productResearchPlanStatus !== "COMPLETE" &&
          !input.productResearchCapabilityFresh ? "WAITING_FOR_WORKER"
        : !input.productResearchCapabilityFresh ? "UNKNOWN"
          : input.productResearchPlanStatus === "COMPLETE"
            ? "IDLE_NO_WORK" : "OPERATING"
  const radar: SellerOsCompactCapabilityStateV1 =
    !input.radarAuthorityAvailable ? "UNKNOWN"
      : !input.radarOutputFresh ? "STALE_NO_RECENT_OUTPUT"
        : input.radarOperationalState === "BLOQUEADO" ? "BLOCKED"
          : input.radarOperationalState === "RECUPERANDO" ? "RECOVERING"
            : input.radarOperationalState === "SIN_TRABAJO"
              ? "IDLE_NO_WORK" : "OPERATING"
  const publisher: SellerOsCompactCapabilityStateV1 =
    input.publisherPhysicalAcceptance ? "OPERATING" : "BLOCKED"
  const ebay: SellerOsCompactCapabilityStateV1 =
    !input.commercialAuthorityAvailable ? "UNKNOWN"
      : !input.orderAuthorityAvailable ||
          !input.currentLiveAuthorityAvailable ||
          !input.publisherPhysicalAcceptance ? "DEGRADED" : "OPERATING"
  const mayelVisual: SellerOsCompactCapabilityStateV1 =
    !input.mayelAuthorityAvailable ? "UNKNOWN"
      : input.mayelPendingCount === null ? "UNKNOWN"
        : input.mayelPendingCount > 0 ? "OPERATING" : "IDLE_NO_WORK"
  const mayelCommercial: SellerOsCompactCapabilityStateV1 =
    !input.mayelAuthorityAvailable || !input.commercialAuthorityAvailable
      ? "UNKNOWN"
      : ebay === "DEGRADED" || !input.currentLiveAuthorityAvailable ||
          !input.orderAuthorityAvailable ? "DEGRADED"
        : input.mayelPendingCount === null ? "UNKNOWN"
          : input.mayelPendingCount > 0 ? "OPERATING" : "IDLE_NO_WORK"
  return Object.freeze({ lunaShipping, productResearch, radar, publisher,
    ebay, mayelVisual, mayelCommercial })
}

export function sellerOsOperationalStateV1(input: Readonly<{
  authorityAvailable: boolean
  pendingCount: number | null
  working?: boolean
  recovering?: boolean
  blocked?: boolean
}>): SellerOsOperationalStateV1 {
  if (!input.authorityAvailable) return "DESCONOCIDO"
  if (input.blocked) return "BLOQUEADO"
  if (input.working) return "OPERANDO"
  if (input.recovering) return "RECUPERANDO"
  if (input.pendingCount === null) return "DESCONOCIDO"
  return input.pendingCount > 0 ? "RECUPERANDO" : "SIN_TRABAJO"
}

export function sellerOsLunaWorkerStateV1(input: Readonly<{
  status: string
  connected: boolean
  canonicalBindingReady: boolean
  eligiblePendingJobCount: number | null
}>): SellerOsOperationalStateV1 {
  const status = input.status.toUpperCase()
  if (["BLOCKED", "OFFLINE", "DEGRADED"].includes(status)) return "BLOQUEADO"
  if (status === "WORKING") return "OPERANDO"
  if (["CONNECTING", "WAITING", "WORK_PENDING"].includes(status)) {
    return "RECUPERANDO"
  }
  if (!input.connected || !input.canonicalBindingReady) return "DESCONOCIDO"
  if (input.eligiblePendingJobCount === null) return "DESCONOCIDO"
  if (input.eligiblePendingJobCount > 0) return "RECUPERANDO"
  if (["IDLE_NO_PENDING_WORK", "WORKER_AVAILABLE", "READY"].includes(status)) {
    return "SIN_TRABAJO"
  }
  return "DESCONOCIDO"
}

export function sellerOsOperationalStateToneV1(
  state: SellerOsOperationalStateV1,
) {
  if (state === "OPERANDO") {
    return "border-emerald-200/25 bg-emerald-200/[0.08] text-emerald-50"
  }
  if (state === "SIN_TRABAJO") {
    return "border-slate-200/20 bg-slate-200/[0.06] text-slate-100"
  }
  if (state === "RECUPERANDO") {
    return "border-cyan-200/25 bg-cyan-200/[0.08] text-cyan-50"
  }
  if (state === "BLOQUEADO") {
    return "border-rose-200/25 bg-rose-200/[0.08] text-rose-50"
  }
  return "border-amber-200/20 bg-amber-200/[0.06] text-amber-50"
}

export function sellerOsCompactCapabilityToneV1(
  state: SellerOsCompactCapabilityStateV1,
) {
  if (state === "OPERATING") {
    return "border-emerald-200/25 bg-emerald-200/[0.08] text-emerald-50"
  }
  if (state === "IDLE_NO_WORK") {
    return "border-slate-200/20 bg-slate-200/[0.06] text-slate-100"
  }
  if (["RECOVERING", "WAITING_FOR_WORKER"].includes(state)) {
    return "border-cyan-200/25 bg-cyan-200/[0.08] text-cyan-50"
  }
  if (["BLOCKED", "STALE_NO_RECENT_OUTPUT"].includes(state)) {
    return "border-rose-200/25 bg-rose-200/[0.08] text-rose-50"
  }
  return "border-amber-200/20 bg-amber-200/[0.06] text-amber-50"
}
