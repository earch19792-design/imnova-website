import { sellerOsRoiMarginPolicyContractV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

export const SELLER_OS_UNIT_FIRST_PACK_POLICY_V1 = Object.freeze({
  contractVersion: "SELLER_OS_UNIT_FIRST_MARKET_EVIDENCED_PACK_POLICY_V1",
  minimumNetProfitUsd: 0,
  economicPolicy: sellerOsRoiMarginPolicyContractV2(),
  sequence: Object.freeze(["SINGLE_UNIT", "MARKET_EVIDENCED_PACK_FALLBACK"]),
  packCountsSource: "REVIEWED_EBAY_SOLD_EVIDENCE_ONLY",
  maximumPackScenariosPerProduct: 3,
  maximumSupplierQuantityPerOffer: 20,
  stopAfterFirstGo: true,
  marketplaceWrites: 0,
  supplierPurchases: 0,
})

type FamilyEvidence = Readonly<{
  evidenceId?: unknown
  listingState?: unknown
  reviewed?: unknown
  identity?: Readonly<{ packCount?: unknown }>
  soldQuantity?: unknown
  fresh?: unknown
  reasonCodes?: ReadonlyArray<unknown>
}>

export type GoldenUnitEvaluationForPackPolicyV1 = Readonly<{
  candidate: Readonly<{ supplierQuantity: number }>
  decision: string
  reasonCodes: ReadonlyArray<string>
  offer: Readonly<{ includedCount: number | null | undefined }>
  economics: Readonly<{
    expectedNetProfit: number | null
    economicPolicyEvaluation?: Readonly<{ passesPolicy?: boolean }>
  }>
  market: Readonly<{ familyEvidence: ReadonlyArray<FamilyEvidence> }>
}>

export type GoldenPackFallbackScenarioV1 = Readonly<{
  supplierQuantity: number
  includedCount: number
  demandScore: number
  marketEvidenceIds: ReadonlyArray<string>
}>

const HARD_STOP_REASON_CODES = new Set([
  "DUPLICATE_IMNOVA_LIVE",
  "LUNA_IDENTITY_PRODUCT_TRUTH_UNPROVEN",
  "PRODUCT_TRUTH_CONTRADICTION",
  "SUPPLIER_BASE_INCLUDED_UNIT_COUNT_CONFLICT",
  "SUPPLIER_OUT_OF_STOCK",
])

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function planGoldenPackFallbackV1(
  unit: GoldenUnitEvaluationForPackPolicyV1,
): Readonly<{
  status: "NOT_NEEDED" | "BLOCKED" | "NO_MARKET_EVIDENCE" | "PLANNED"
  reasonCode: string
  scenarios: ReadonlyArray<GoldenPackFallbackScenarioV1>
}> {
  if (unit.candidate.supplierQuantity !== 1) return Object.freeze({
    status: "BLOCKED" as const,
    reasonCode: "PACK_POLICY_REQUIRES_BASE_UNIT_EVALUATION",
    scenarios: Object.freeze([] as GoldenPackFallbackScenarioV1[]),
  })
  if (unit.decision === "GO") return Object.freeze({
    status: "NOT_NEEDED" as const,
    reasonCode: "SINGLE_UNIT_MEETS_TARGET_NET_PROFIT",
    scenarios: Object.freeze([] as GoldenPackFallbackScenarioV1[]),
  })
  const hardStop = unit.reasonCodes.find((code) => HARD_STOP_REASON_CODES.has(code))
  if (hardStop) return Object.freeze({
    status: "BLOCKED" as const,
    reasonCode: `PACK_FALLBACK_BLOCKED_BY_${hardStop}`,
    scenarios: Object.freeze([] as GoldenPackFallbackScenarioV1[]),
  })
  const baseIncludedCount = positiveInteger(unit.offer.includedCount)
  if (baseIncludedCount === null) return Object.freeze({
    status: "BLOCKED" as const,
    reasonCode: "SUPPLIER_BASE_INCLUDED_UNIT_COUNT_UNPROVEN",
    scenarios: Object.freeze([] as GoldenPackFallbackScenarioV1[]),
  })

  const allowedFamilyReasons = new Set([
    "OFFER_COUNT_MISMATCH",
    "COMPARABLE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN",
  ])
  const grouped = new Map<number, { includedCount: number; demandScore: number; ids: string[] }>()
  for (const evidence of unit.market.familyEvidence) {
    const includedCount = positiveInteger(evidence.identity?.packCount)
    const soldQuantity = positiveInteger(evidence.soldQuantity)
    const reasons = Array.isArray(evidence.reasonCodes)
      ? evidence.reasonCodes.map(String) : []
    if (
      evidence.listingState !== "SOLD" || evidence.reviewed !== true
      || evidence.fresh !== true
      || includedCount === null || soldQuantity === null
      || includedCount <= baseIncludedCount
      || includedCount % baseIncludedCount !== 0
      || !reasons.some((reason) => allowedFamilyReasons.has(reason))
    ) continue
    const supplierQuantity = includedCount / baseIncludedCount
    if (
      supplierQuantity < 2
      || supplierQuantity > SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.maximumSupplierQuantityPerOffer
    ) continue
    const current = grouped.get(supplierQuantity) ?? {
      includedCount, demandScore: 0, ids: [],
    }
    current.demandScore += Math.min(1_000, soldQuantity)
    const evidenceId = String(evidence.evidenceId ?? "")
    if (evidenceId && !current.ids.includes(evidenceId)) current.ids.push(evidenceId)
    grouped.set(supplierQuantity, current)
  }
  const scenarios = [...grouped.entries()]
    .map(([supplierQuantity, value]) => Object.freeze({
      supplierQuantity, includedCount: value.includedCount,
      demandScore: value.demandScore,
      marketEvidenceIds: Object.freeze([...value.ids]),
    }))
    .sort((left, right) => right.demandScore - left.demandScore
      || left.supplierQuantity - right.supplierQuantity)
    .slice(0, SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.maximumPackScenariosPerProduct)
  if (!scenarios.length) return Object.freeze({
    status: "NO_MARKET_EVIDENCE" as const,
    reasonCode: "NO_REVIEWED_SAME_PRODUCT_PACK_SOLD_EVIDENCE",
    scenarios: Object.freeze([] as GoldenPackFallbackScenarioV1[]),
  })
  return Object.freeze({
    status: "PLANNED" as const,
    reasonCode: "SINGLE_UNIT_DID_NOT_REACH_GO_PACK_FALLBACK_PLANNED",
    scenarios: Object.freeze(scenarios),
  })
}
