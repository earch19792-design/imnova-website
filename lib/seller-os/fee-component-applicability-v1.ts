type R = Record<string, unknown>
const record = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

/** Project independently proven applicability even while a different component
 * awaits order context. A published percentage alone is never a monetary bound. */
export function classifyFeeComponentsV1(input: { components: unknown[]; normalCategoryFee: number | null;
  contingentFeeOnTax: number | null; sourceFresh: boolean; completeBoundProven: boolean }) {
  const rows = input.components.map(record).map(c => {
    const normalFee = c.type === "FINAL_VALUE_PERCENT" ? input.normalCategoryFee : null
    const amount = input.sourceFresh ? normalFee ?? (money(c.amount) ? c.amount : null) : null
    const provenNA = input.sourceFresh && amount === 0 &&
      (c.status === "NOT_APPLICABLE" || c.classification === "NOT_APPLICABLE")
    return { component: c.type, classification: provenNA ? "PROVEN_NOT_APPLICABLE" :
      amount !== null ? input.completeBoundProven && !["FINAL_VALUE_PERCENT", "PER_ORDER"].includes(String(c.type))
        ? "CONTINGENT_BOUNDED" : "PROVEN_APPLICABLE" : "CONTINGENT_UNBOUNDED",
      applies: provenNA ? false : amount !== null ? true : null,
      amount, rateOrAmount: c.rateOrAmount ?? c.ratePct ?? null,
      officialAuthority: c.officialAuthority ?? c.source ?? null,
      pendingDependency: provenNA || amount !== null ? null : c.pendingDependency ?? "CURRENT_COMPONENT_AUTHORITY_REQUIRED" }
  })
  rows.push({ component: "CONTINGENT_FEE_ON_TAX", classification: input.sourceFresh && input.contingentFeeOnTax !== null
    ? "CONTINGENT_BOUNDED" : "CONTINGENT_UNBOUNDED", applies: null,
    amount: input.sourceFresh ? input.contingentFeeOnTax : null, rateOrAmount: null,
    officialAuthority: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822",
    pendingDependency: input.sourceFresh && input.contingentFeeOnTax !== null ? null : "ALL_ELIGIBLE_ORDERS_BUYER_TAX_FEE_BOUND" })
  return rows
}
