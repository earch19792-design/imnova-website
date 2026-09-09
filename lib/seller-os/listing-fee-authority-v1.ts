export const LISTING_FEE_AUTHORITY_V1 = "SELLER_OS_LISTING_FEE_AUTHORITY_V1"
export const REQUIRED_FEE_COMPONENTS_V1 = ["FINAL_VALUE_PERCENT", "PER_ORDER", "SELLER_PERFORMANCE",
  "SERVICE_METRICS", "INTERNATIONAL", "CURRENCY_CONVERSION", "REGULATORY_OPERATING", "TAX_ON_FEES"] as const
type RecordValue = Record<string, unknown>
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {}
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
function official(v: unknown) {
  if (!text(v)) return false
  try { const u = new URL(v); return u.protocol === "https:" && (u.hostname === "ebay.com" || u.hostname.endsWith(".ebay.com")) } catch { return false }
}

// This consumer accepts a versioned official estimate; historical actual fees
// cannot activate it. No percentage, category mapping or missing zero lives here.
export function consumeListingFeeAuthorityV1(input: { metadata: unknown; accountKey: string;
  itemId: string; categoryId: string | null; salePrice: number | null; now: Date }) {
  const a = record(record(input.metadata).feeAuthorityV1)
  const components = Array.isArray(a.components) ? a.components.map(record) : []
  const unknown = REQUIRED_FEE_COMPONENTS_V1.filter(type => {
    const matches = components.filter(c => c.type === type)
    if (matches.length !== 1) return true
    const c = matches[0]
    return !official(c.source) || !text(c.sourceVersion) || !text(c.reference) ||
      !["PROVEN", "NOT_APPLICABLE"].includes(String(c.status)) || !money(c.amount) ||
      (c.status === "NOT_APPLICABLE" && (c.amount !== 0 || !text(c.applicabilityEvidence))) ||
      (type === "FINAL_VALUE_PERCENT" && (!money(c.ratePct) || c.ratePct > 100 || !money(c.basisAmount)))
  })
  const blockers: string[] = unknown.map(c => `FEE_COMPONENT_UNPROVEN:${c}`)
  if (a.contractVersion !== LISTING_FEE_AUTHORITY_V1 || a.evidenceClass !== "PRE_SALE_FEE_ESTIMATE") blockers.push("CURRENT_PRE_SALE_AUTHORITY_REQUIRED")
  if (a.marketplaceAccountKey !== input.accountKey || a.marketplace !== "EBAY_US" || a.itemId !== input.itemId ||
    !input.categoryId || a.categoryId !== input.categoryId || !text(a.storeContextReference) || !text(a.accountContextReference)) blockers.push("FEE_ACCOUNT_CATEGORY_CONTEXT_UNPROVEN")
  if (!text(a.sourceVersion) || !official(a.source) || !text(a.reference) ||
    !text(a.observedAt) || !text(a.freshUntil) || !Number.isFinite(Date.parse(a.observedAt)) ||
    Date.parse(a.observedAt) > input.now.getTime() || !(Date.parse(a.freshUntil) > input.now.getTime())) blockers.push("FEE_SOURCE_VERSION_OR_FRESHNESS_UNPROVEN")
  const basis = record(a.feeBasis)
  const coveredComponents = Array.isArray(basis.coveredComponents) ? basis.coveredComponents : []
  // Tax/buyer-dependent amounts must be demonstrated or bounded explicitly.
  // Merely naming a future component does not prove its value or ceiling.
  if (basis.status !== "PROVEN" || !text(basis.reference) || !money(basis.amount) ||
    !money(input.salePrice) || basis.salePrice !== input.salePrice || basis.amount < input.salePrice ||
    !["EXACT_SCENARIO", "PROVEN_UPPER_BOUND"].includes(String(basis.method)) ||
    !["ITEM_PRICE", "BUYER_SHIPPING", "HANDLING", "BUYER_TAX"].every(k => coveredComponents.includes(k))) blockers.push("TOTAL_FEE_BASIS_UNPROVEN")
  if (components.some(c => !REQUIRED_FEE_COMPONENTS_V1.includes(c.type as typeof REQUIRED_FEE_COMPONENTS_V1[number]))) blockers.push("UNRECOGNIZED_FEE_COMPONENT")
  const total = components.every(c => money(c.amount)) ? Math.ceil((components.reduce((sum, c) => sum + Number(c.amount), 0) - 1e-9) * 100) / 100 : null
  if (!money(a.amount) || a.amount !== total) blockers.push("FEE_COMPONENT_TOTAL_MISMATCH")
  const proven = blockers.length === 0
  return { contractVersion: LISTING_FEE_AUTHORITY_V1, evidenceClass: "PRE_SALE_FEE_ESTIMATE" as const,
    status: proven ? "PROVEN" as const : "NEEDS_EVIDENCE" as const, amount: proven ? total : null,
    adFeeBasis: proven && basis.adBasisCovered === true ? Number(basis.amount) : null,
    reference: proven ? String(a.reference) : null, source: official(a.source) ? String(a.source) : null,
    unknownFeeComponentCount: unknown.length, blockers, actualPostSaleFee: null,
    actualFeesSubstitutedForCurrentAuthority: false }
}
