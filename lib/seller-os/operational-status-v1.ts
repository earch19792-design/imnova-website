export const SELLER_OS_OPERATIONAL_STATES_V1 = Object.freeze([
  "OPERANDO",
  "SIN_TRABAJO",
  "RECUPERANDO",
  "BLOQUEADO",
  "DESCONOCIDO",
] as const)

export type SellerOsOperationalStateV1 =
  typeof SELLER_OS_OPERATIONAL_STATES_V1[number]

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
