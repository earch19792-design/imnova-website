const feeRecordV1 = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}

export const CONTINGENT_FEE_RISKS_V1 = ["BUYER_TAX", "INTERNATIONAL_APPLICABILITY", "CURRENCY_CONVERSION", "TAX_ON_FEES"] as const
/** A rate cap alone is insufficient: the evidence must cover the monetary
 * exposure and all admissible orders for this exact listing/account scenario.
 * Only trusted server evidence may supply this bundle. */
export function assessFeeBoundCoverageV1(bundleValue: unknown, now: Date) {
  const b = feeRecordV1(bundleValue), basis = feeRecordV1(b.basis), context = feeRecordV1(b.context)
  if (basis.method !== "PROVEN_UPPER_BOUND") return { pass: true, blockers: [] as string[] }
  const coverage = Array.isArray(b.boundCoverage) ? b.boundCoverage.map(feeRecordV1) : []
  const blockers = CONTINGENT_FEE_RISKS_V1.filter(risk => {
    const matches = coverage.filter(c => c.component === risk)
    if (matches.length !== 1) return true
    const c = matches[0]
    let official = false
    try { const url = new URL(String(c.source)); official = url.protocol === "https:" && (url.hostname === "ebay.com" || url.hostname.endsWith(".ebay.com")) } catch {}
    return !official || c.status !== "PROVEN" || c.coversAllEligibleOrders !== true ||
      typeof c.sourceVersion !== "string" || !c.sourceVersion || typeof c.reference !== "string" || !c.reference ||
      c.marketplaceAccountKey !== context.marketplaceAccountKey || c.itemId !== context.itemId ||
      c.categoryId !== context.categoryId || c.currency !== "USD" || c.scenarioReference !== basis.scenarioReference ||
      !(Date.parse(String(c.observedAt)) <= now.getTime()) || !(Date.parse(String(c.freshUntil)) > now.getTime()) ||
      typeof c.maximumAmount !== "number" || !Number.isFinite(c.maximumAmount) || c.maximumAmount < 0 ||
      (risk === "BUYER_TAX" && c.maximumAmount !== basis.buyerTax) ||
      (risk !== "BUYER_TAX" && !(Array.isArray(b.adjustments) && b.adjustments.some(raw => {
        const a = feeRecordV1(raw)
        return a.type === (risk === "INTERNATIONAL_APPLICABILITY" ? "INTERNATIONAL" : risk) &&
          typeof a.amount === "number" && a.amount >= Number(c.maximumAmount)
      })))
  }).map(risk => `CONSERVATIVE_BOUND_COVERAGE_UNPROVEN:${risk}`)
  return { pass: blockers.length === 0, blockers }
}
