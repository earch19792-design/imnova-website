import { goldenNumber, goldenRecord, type GoldenRecord } from
  "./commercial-golden-path-domain-v1"

export const SELLER_OS_RAPID_STOCKING_POLICY_V1 = Object.freeze({
  contractVersion: "SELLER_OS_RAPID_STOCKING_POLICY_V1",
  marketplace: "EBAY_US",
  minimumExpectedNetProfitUsd: 4,
  targetQualifiedDrafts: 10,
  maximumSupplierCandidatesPerBatch: 100,
  maximumEvidenceAcquisitionCandidatesPerBatch: 30,
  sequence: Object.freeze([
    "PROVEN_SINGLE_UNIT",
    "MARKET_EVIDENCED_PACK_FALLBACK",
    "CONTROLLED_NEW_PRODUCT_TEST",
  ]),
  portfolioGuidePerTwenty: Object.freeze({
    provenSingleUnits: 12,
    marketEvidencedPacks: 5,
    controlledNewProductTests: 3,
  }),
  rules: Object.freeze({
    unitFirst: true,
    packRequiresReviewedSameProductSoldEvidence: true,
    packSizesAreNeverInvented: true,
    newProductTestIsNeverLabeledProven: true,
    newProductTestStillRequiresIdentityStockComplianceAndEconomics: true,
    ownerApprovalRequiredBeforePublication: true,
    marketplaceWrites: 0,
    supplierPurchases: 0,
  }),
})

export type RapidStockingDispositionV1 =
  | "PROVEN_UNIT_DRAFT"
  | "PROVEN_PACK_DRAFT"
  | "CONTROLLED_TEST_CANDIDATE"
  | "HOLD_DATA"
  | "OUT_OF_STOCK"
  | "REJECT_MARGIN"
  | "REJECT_DEMAND"
  | "REJECT_POLICY"

export function classifyRapidStockingEvaluationV1(
  evaluation: GoldenRecord,
): RapidStockingDispositionV1 {
  const decision = String(evaluation.decision ?? "UNPROVEN")
  const candidate = goldenRecord(evaluation.candidate)
  const economics = goldenRecord(evaluation.economics)
  const reasons = Array.isArray(evaluation.reasonCodes)
    ? evaluation.reasonCodes.map(String) : []
  const quantity = goldenNumber(candidate.supplierQuantity) ?? 1
  const expectedNet = goldenNumber(economics.expectedNetProfit)

  if (decision === "GO" && expectedNet !== null &&
      expectedNet >= SELLER_OS_RAPID_STOCKING_POLICY_V1
        .minimumExpectedNetProfitUsd) {
    return quantity > 1 ? "PROVEN_PACK_DRAFT" : "PROVEN_UNIT_DRAFT"
  }
  if (reasons.includes("SUPPLIER_OUT_OF_STOCK")) return "OUT_OF_STOCK"
  if (reasons.includes("SOLD_MARKET_DOES_NOT_SUPPORT_TARGET_NET") ||
      expectedNet !== null && expectedNet <
        SELLER_OS_RAPID_STOCKING_POLICY_V1.minimumExpectedNetProfitUsd) {
    return "REJECT_MARGIN"
  }
  if (decision === "REJECT") return reasons.some(reason =>
    reason.includes("DEMAND") || reason.includes("SOLD_MARKET"))
    ? "REJECT_DEMAND" : "REJECT_POLICY"
  if (reasons.includes("EXACT_CLOSE_REALIZED_SOLD_UNPROVEN") &&
      !reasons.some(reason => reason.includes("CONTRADICTION") ||
        reason.includes("OUT_OF_STOCK") || reason.includes("RESTRICTED"))) {
    return "CONTROLLED_TEST_CANDIDATE"
  }
  return "HOLD_DATA"
}
