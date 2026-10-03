import { createHash } from "node:crypto"
// @ts-expect-error Native Node verification uses the explicit TypeScript suffix.
import { evaluateLunaTraceProductTruthGateV1 } from "../seller-os/luna-trace-product-truth-gate-v1.ts"
// @ts-expect-error Native Node verification uses the explicit TypeScript suffix.
import { classifyWinnerComparable, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2"

export const GOLDEN_PATH_V1 = "COMMERCIAL_GOLDEN_PATH_V1"
export type GoldenRecord = Record<string, unknown>
export const goldenRecord = (value: unknown): GoldenRecord => value && typeof value === "object" && !Array.isArray(value) ? value as GoldenRecord : {}
export const goldenArray = (value: unknown): GoldenRecord[] => Array.isArray(value) ? value.map(goldenRecord) : []
export const goldenNumber = (value: unknown): number | null => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value)
export const goldenDigest = (value: unknown): string => {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`
}
const cents = (n: number) => Math.round(n * 100) / 100
const date = (v: unknown) => Date.parse(String(v ?? ""))
export function goldenFresh(v: GoldenRecord, now: Date, maximumMs: number) {
  const observed = date(v.observedAt), until = date(v.freshUntil)
  return observed <= now.getTime() && now.getTime() - observed < maximumMs && until > now.getTime() && until - observed <= maximumMs
}
export type GoldenCandidateKey = { productId: string; variantId: string; supplierSku: string; supplierQuantity: number }
export type GoldenMarketEvidence = {
  evidenceId: string; source: string; sourceLocator: string; sourceDigest: string
  listingState: "SOLD" | "ACTIVE"; identity: ProductIdentityInput
  requestedClassification?: "EXACT" | "CLOSE" | "FAMILY" | "REJECTED_COMPARABLE"
  reviewed: boolean; reviewReason: string | null; soldQuantity: number | null
  realizedSoldPrice: number | null; activeListingPrice?: number | null; buyerShipping: number | null
  currency: string; lastSoldDate: string | null; capturedAt: string
  realizedPriceStatus: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
}
export type GoldenAuthority = GoldenRecord & { status: string; receiptId?: string | null }
export type GoldenEvaluationInput = {
  candidate: GoldenCandidateKey; accountKey: string; now: Date; targetNetProfit: number
  source: GoldenRecord | null; market: GoldenMarketEvidence[]; marketComplete: boolean
  duplicate: GoldenAuthority; shipping: GoldenAuthority; fee: GoldenAuthority
  compliance: GoldenAuthority; policy: GoldenAuthority
}
export function verifiedGoldenFields(source: GoldenRecord | null, now: Date) {
  const receipt = goldenRecord(source?.field_truth_v1)
  const binding = { snapshotId: String(source?.snapshot_id ?? ""), productId: String(source?.product_id ?? ""), variantId: String(source?.variant_id ?? ""), supplierSku: String(source?.sku ?? ""), sourceFingerprint: String(source?.source_fingerprint ?? ""), canonicalUrl: String(source?.canonical_url ?? ""), exactSingleVariantBinding: Boolean(source), supplierCost: goldenNumber(source?.price), supplierAvailability: typeof source?.availability === "boolean" ? source.availability : null }
  const gate = evaluateLunaTraceProductTruthGateV1({ receipt, binding, now })
  const fields = gate.bindingValid && gate.receiptShapeValid ? goldenArray(receipt.fields) : []
  const productReceipt = `luna_catalog:${binding.snapshotId}:${binding.productId}`
  const proven = fields.filter(f => {
    const evidence = goldenArray(f.SOURCE_EVIDENCE)
    return f.SEMANTIC_CLASS === "FACT" && f.EVIDENCE_STATUS === "PROVEN" && f.CONTRADICTION !== true && f.VALUE != null && /^sha256:[0-9a-f]{64}$/.test(String(f.EVIDENCE_ID ?? "")) && evidence.length > 0 && evidence.every(e => /^sha256:[0-9a-f]{64}$/.test(String(e.EVIDENCE_ID ?? "")) && [productReceipt, `${productReceipt}:${binding.variantId}`].includes(String(e.SOURCE_RECEIPT_ID ?? ""))) && date(f.OBSERVED_AT) <= now.getTime() && (!f.FRESH_UNTIL || date(f.FRESH_UNTIL) > now.getTime())
  })
  return { gate, receipt, fields, proven, values: Object.fromEntries(proven.map(f => [String(f.FIELD), f.VALUE])) }
}
export function goldenComparableIdentity(source: GoldenRecord | null, quantity: number, now: Date): ProductIdentityInput {
  const truth = verifiedGoldenFields(source, now).values
  const count = goldenNumber(truth.QUANTITY_OR_SET_COUNT)
  return { productName: typeof truth.TITLE === "string" ? truth.TITLE : null,
    manufacturerBrand: typeof truth.BRAND === "string" ? truth.BRAND : null,
    gtin: quantity === 1 && typeof truth.GTIN === "string" ? truth.GTIN : null,
    mpn: typeof truth.MPN === "string" ? truth.MPN : null, model: typeof truth.MODEL === "string" ? truth.MODEL : null,
    color: typeof truth.COLOR === "string" ? truth.COLOR : null,
    packCount: count !== null && Number.isSafeInteger(count) && count > 0 ? count * quantity : null }
}
/** Discovery routing only. Supplier category labels never become Product Truth or market authority. */
export function goldenCategoryDiscoveryMatchesV1(category: string, source: GoldenRecord, now: Date) {
  if (category.trim().toLowerCase().replace(/[^a-z0-9]/g, "") !== "personalcare") return source.product_type === category
  const title = verifiedGoldenFields(source, now).values.TITLE
  return typeof title === "string" && !/\b(?:laptop|desktop|ipad|iphone|ddr[2345]|dimm|gpu|pcie|processor|hvac|furnace|humidifier|chair)\b/i.test(title) && /\b(?:mouthwash|toothbrush|toothpaste|dental|floss|hair|comb|razor|shaver|shaving|manicure|pedicure|nail|skin|soap|lotion|cream|serum|sunscreen|lip\s+balm|dusting\s+powder|deodorant|perfume|body\s+wash|bath\s+brush|cosmetic|makeup)\b/i.test(title)
}
/** Manual match labels are reviewed market observations. They cannot repair supplier truth. */
export function classifyGoldenComparable(target: ProductIdentityInput, evidence: GoldenMarketEvidence) {
  const a = normalizeProductIdentity(target), b = normalizeProductIdentity(evidence.identity)
  const base = classifyWinnerComparable(target, evidence.identity)
  const reasons: string[] = []
  if (evidence.requestedClassification === "REJECTED_COMPARABLE") reasons.push("OPERATOR_REJECTED_COMPARABLE")
  if (b.manufacturerBrand && b.manufacturerBrand !== a.manufacturerBrand) reasons.push("BRAND_TRANSFER_PROHIBITED")
  if (["INVALID_COMPARABLE", "DIFFERENT_VARIANT"].includes(base.classification)) reasons.push(...base.reasons)
  if (reasons.length) return { classification: "REJECTED_COMPARABLE" as const, reasonCodes: reasons }
  if (a.packCount === null || b.packCount === null || a.packCount !== b.packCount) return { classification: "FAMILY" as const, reasonCodes: ["OFFER_COUNT_NOT_EXACT"] }
  if (evidence.requestedClassification === "FAMILY") return { classification: "FAMILY" as const, reasonCodes: ["OPERATOR_FAMILY_ONLY"] }
  if (base.classification === "EXACT_MATCH") return { classification: "EXACT" as const, reasonCodes: base.reasons }
  const reviewedClose = evidence.reviewed && Boolean(evidence.reviewReason) && evidence.requestedClassification === "CLOSE" && a.normalizedProductName === b.normalizedProductName
  if (base.classification === "NEAR_MATCH" || reviewedClose) return { classification: "CLOSE" as const, reasonCodes: reviewedClose ? ["HUMAN_REVIEWED_SAME_PRODUCT_OFFER"] : base.reasons }
  return { classification: "FAMILY" as const, reasonCodes: ["EXACT_CLOSE_IDENTITY_UNPROVEN"] }
}
export function evaluateGoldenCandidateV1(input: GoldenEvaluationInput) {
  if (!Number.isFinite(input.targetNetProfit) || input.targetNetProfit < 4 || input.targetNetProfit > 10000) throw Error("TARGET_NET_PROFIT_OUTSIDE_AUTHORIZED_BOUND")
  const { candidate: key, source, now } = input
  const reasons: string[] = [], holds: string[] = [], rejects: string[] = []
  const truth = verifiedGoldenFields(source, now), identity = goldenComparableIdentity(source, key.supplierQuantity, now)
  const exactBinding = source?.product_id === key.productId && source?.variant_id === key.variantId && source?.sku === key.supplierSku
  if (!exactBinding || !truth.gate.traceProductTruthSufficient || source?.preflight_status !== "PREFLIGHT_PASS") reasons.push("LUNA_IDENTITY_PRODUCT_TRUTH_UNPROVEN")
  if (truth.fields.some(f => f.CONTRADICTION === true)) holds.push("PRODUCT_TRUTH_CONTRADICTION")
  const classified = input.market.slice(0, 200).map(e => ({ ...e, ...classifyGoldenComparable(identity, e), buyerLandedPrice: e.listingState === "SOLD" && e.realizedSoldPrice !== null && e.buyerShipping !== null ? cents(e.realizedSoldPrice + e.buyerShipping) : null,
    fresh: e.listingState === "SOLD" && date(e.lastSoldDate) <= now.getTime() && now.getTime() - date(e.lastSoldDate) <= 90 * 86400000 && date(e.capturedAt) <= now.getTime() && now.getTime() - date(e.capturedAt) <= 90 * 86400000 }))
  const sold = classified.filter(e => e.listingState === "SOLD")
  const exact = sold.filter(e => e.classification === "EXACT"), close = sold.filter(e => e.classification === "CLOSE"), family = sold.filter(e => e.classification === "FAMILY")
  const priced = [...exact, ...close].filter(e => e.fresh && e.currency === "USD" && e.soldQuantity !== null && Number.isSafeInteger(e.soldQuantity) && e.soldQuantity > 0 && e.buyerShipping !== null && e.buyerShipping >= 0 && e.realizedPriceStatus === "PROVEN" && e.realizedSoldPrice !== null && e.realizedSoldPrice > 0 && e.buyerLandedPrice !== null && /^sha256:[0-9a-f]{64}$/.test(e.sourceDigest))
  if (!input.marketComplete) reasons.push("MARKET_EVIDENCE_READ_INCOMPLETE")
  if (!priced.length) reasons.push("EXACT_CLOSE_REALIZED_SOLD_UNPROVEN")
  // Use the lower weighted median of realized buyer-landed prices. Never raise it to the profit floor.
  const ordered = [...priced].sort((a, b) => a.buyerLandedPrice! - b.buyerLandedPrice! || a.evidenceId.localeCompare(b.evidenceId))
  const soldUnits = priced.reduce((n, e) => n + e.soldQuantity!, 0)
  let cumulative = 0, marketPrice: number | null = null
  for (const e of ordered) { cumulative += e.soldQuantity!; if (cumulative >= soldUnits / 2) { marketPrice = e.buyerLandedPrice; break } }
  if (key.supplierQuantity > 1 && !priced.length) reasons.push("PACK_COMMERCIAL_EVIDENCE_UNPROVEN")
  if (input.duplicate.status === "DUPLICATE") rejects.push("DUPLICATE_IMNOVA_LIVE")
  else if (input.duplicate.status !== "PASS") reasons.push("DUPLICATE_GATE_UNPROVEN")
  if (truth.values.SUPPLIER_AVAILABILITY === "OUT_OF_STOCK") holds.push("SUPPLIER_OUT_OF_STOCK")
  else if (truth.values.SUPPLIER_AVAILABILITY !== "AVAILABLE") reasons.push("SUPPLIER_AVAILABILITY_UNPROVEN")
  const unitCost = goldenNumber(truth.values.SUPPLIER_COST), cost = unitCost === null ? null : cents(unitCost * key.supplierQuantity)
  if (cost === null) reasons.push("SUPPLIER_COST_UNPROVEN")
  const shippingValid = input.shipping.status === "PROVEN" && input.shipping.supplierQuantity === key.supplierQuantity && input.shipping.productId === key.productId && input.shipping.variantId === key.variantId && input.shipping.supplierSku === key.supplierSku && input.shipping.sourceFingerprint === source?.source_fingerprint && input.shipping.currency === "USD" && goldenNumber(input.shipping.amountUsd) !== null && goldenNumber(input.shipping.amountUsd)! >= 0 && input.shipping.noPurchase === true && input.shipping.noPayment === true && Boolean(input.shipping.receiptId) && goldenFresh(input.shipping, now, 6 * 3600000)
  const shippingCost = shippingValid ? goldenNumber(input.shipping.amountUsd) : null
  if (shippingCost === null || shippingCost < 0) reasons.push("REAL_OFFER_SHIPPING_UNPROVEN")
  const feeValid = input.fee.status === "PROVEN" && input.fee.accountKey === input.accountKey && input.fee.productId === key.productId && input.fee.variantId === key.variantId && input.fee.supplierSku === key.supplierSku && input.fee.supplierQuantity === key.supplierQuantity && input.fee.price === marketPrice && input.fee.buyerShipping === 0 && input.fee.currency === "USD" && Boolean(input.fee.receiptId) && goldenFresh(input.fee, now, 24 * 3600000)
  const fees = feeValid ? goldenNumber(input.fee.amountUsd) : null
  if (fees === null || fees < 0) reasons.push("EBAY_FEE_AUTHORITY_UNPROVEN")
  const policyValid = input.policy.status === "PROVEN" && input.policy.accountKey === input.accountKey
  const reserveRate = policyValid ? goldenNumber(input.policy.returnsReserveRate) : null
  if (reserveRate === null || reserveRate < 0 || reserveRate > 0.5) reasons.push("RETURNS_RESERVE_POLICY_UNPROVEN")
  // Packages explicitly leave Promoted Listings OFF. No default ad reserve or silent zero for UNKNOWN.
  const promoted = policyValid && input.policy.promotedState === "NOT_APPLICABLE" ? 0 : null
  if (promoted === null) reasons.push("PROMOTED_FEE_APPLICABILITY_UNPROVEN")
  const other = policyValid && input.policy.otherState === "NOT_APPLICABLE" ? 0 : goldenNumber(input.policy.otherAmountUsd)
  if (other === null || other < 0) reasons.push("OTHER_REQUIRED_COSTS_UNPROVEN")
  const returns = marketPrice !== null && reserveRate !== null && reserveRate >= 0 && reserveRate <= 0.5 ? cents(marketPrice * reserveRate) : null
  const ready = exactBinding && truth.gate.traceProductTruthSufficient && !reasons.some(r => /SHIPPING|COST|FEE|RESERVE|COSTS/.test(r)) && marketPrice !== null && cost !== null && shippingCost !== null && fees !== null && returns !== null && promoted !== null && other !== null
  const net = ready ? Math.floor((marketPrice! - cost! - shippingCost! - fees! - returns! - promoted! - other! + 1e-9) * 100) / 100 : null
  const floor = net !== null && reserveRate !== null ? Math.ceil((marketPrice! + (input.targetNetProfit - net) / (1 - reserveRate)) * 100) / 100 : null
  // Fixed-price fee quote cannot prove an interval-wide floor; keep the threshold explicit instead.
  if (net !== null && net < input.targetNetProfit) rejects.push("SOLD_MARKET_DOES_NOT_SUPPORT_TARGET_NET")
  const complianceValid = input.compliance.status === "PROVEN" && input.compliance.productId === key.productId && input.compliance.variantId === key.variantId && input.compliance.supplierSku === key.supplierSku && input.compliance.supplierQuantity === key.supplierQuantity && input.compliance.sourceFingerprint === source?.source_fingerprint && Boolean(input.compliance.receiptId) && goldenFresh(input.compliance, now, 24 * 3600000)
  const blockers = Array.isArray(input.compliance.blockers) ? input.compliance.blockers.map(String) : []
  if (blockers.length) holds.push(...blockers)
  if (!complianceValid) reasons.push("COMPLIANCE_CATEGORY_SPECIFICS_UNPROVEN")
  const decision = rejects.length ? "REJECT" as const : holds.length ? "HOLD" as const : reasons.length ? "UNPROVEN" as const : "GO" as const
  const result = { contractVersion: GOLDEN_PATH_V1, evaluatedAt: now.toISOString(), candidate: key,
    sourceIdentity: { title: typeof truth.values.TITLE === "string" ? truth.values.TITLE : null, observedSourceTitle: source?.title ?? null, canonicalUrl: source?.canonical_url ?? null, sourceFingerprint: source?.source_fingerprint ?? null, snapshotId: source?.snapshot_id ?? null, observedAt: source?.observed_at ?? null },
    offer: { type: identity.packCount === null ? "UNPROVEN" : key.supplierQuantity === 1 && identity.packCount === 1 ? "single" : "pack", supplierQuantity: key.supplierQuantity, includedCount: identity.packCount, listingSku: key.supplierSku },
    market: { status: input.marketComplete ? "AVAILABLE" : "UNPROVEN", exactSold: exact, closeSold: close, familyEvidence: family, rejectedComparables: classified.filter(e => e.classification === "REJECTED_COMPARABLE"), activeCompetition: classified.filter(e => e.listingState === "ACTIVE"), activeCompetitionAuthority: { status: "UNPROVEN", scope: "MANUAL_OBSERVATIONS_ONLY_NO_COMPLETE_COMPETITION_SCAN", exhaustive: false }, soldQuantity: priced.length ? soldUnits : null, realizedBuyerLandedPrice: marketPrice, realizedPriceBasis: "LOWER_QUANTITY_WEIGHTED_MEDIAN_EXACT_CLOSE_SOLD", activePriceUsedForEconomics: false, familyUsedForEconomics: false },
    duplicateGate: input.duplicate, supplier: { availability: truth.values.SUPPLIER_AVAILABILITY ?? null, unitCostUsd: unitCost, offerCostUsd: cost, stock: goldenNumber(truth.values.SUPPLIER_STOCK), stockStatus: truth.values.SUPPLIER_STOCK == null ? "UNPROVEN" : "PROVEN" },
    shipping: shippingValid ? input.shipping : { ...input.shipping, status: "UNPROVEN", amountUsd: null, supplierQuantity: key.supplierQuantity, reasonCode: input.shipping.reasonCode ?? "REAL_OFFER_SHIPPING_UNPROVEN", validationReasonCode: "REAL_OFFER_SHIPPING_UNPROVEN" },
    economics: { status: ready ? "PROVEN" : "UNPROVEN", targetNetProfit: input.targetNetProfit, recommendedPrice: marketPrice, buyerShipping: 0, pricingStrategy: "FREE_BUYER_SHIPPING_WITHIN_OBSERVED_LANDED_PRICE", feeAuthority: input.fee, ebayFees: fees, returnsReserve: returns, promotedFee: promoted, promotedState: input.policy.promotedState ?? "UNKNOWN", otherExplicitCosts: other, expectedNetProfit: net, profitFloor: { netProfitUsd: input.targetNetProfit, requiredPrice: null, status: "INTERVAL_FEE_BOUND_UNPROVEN", diagnosticAtFixedFee: floor }, marginPercent: net !== null ? cents(net / marketPrice! * 100) : null, roiPercent: net !== null && cost! + shippingCost! > 0 ? cents(net / (cost! + shippingCost!) * 100) : null },
    productTruth: { status: truth.gate.traceProductTruthSufficient ? "CORE_PROVEN" : "UNPROVEN", receiptId: truth.gate.receiptEvidenceDigest, verifiedSpecifics: truth.proven, missingFields: truth.fields.filter(f => f.VALUE == null).map(f => f.FIELD), supplierClaimsExcluded: true },
    compliance: input.compliance, decision, reasonCodes: [...rejects, ...holds, ...reasons], safety: { marketplaceWrites: 0, publish: false, end: false, supplierPurchases: 0, draftIsLive: false } }
  return { ...result, evidenceDigest: goldenDigest(result) }
}
export function prepareGoldenDraftV1(evaluation: ReturnType<typeof evaluateGoldenCandidateV1>) {
  if (evaluation.decision !== "GO") throw Error("GO_REQUIRED_FOR_LISTING_PACKAGE")
  const category = goldenRecord(evaluation.compliance.category)
  if (!category.id || !evaluation.sourceIdentity.title || evaluation.offer.includedCount === null) throw Error("VERIFIED_DRAFT_CATEGORY_TITLE_CONTENTS_REQUIRED")
  // Only field-level verified facts appear in prose. No model, dimensions, brand or claims are manufactured.
  const prefix = evaluation.candidate.supplierQuantity > 1 ? `${evaluation.offer.includedCount} Count / ${evaluation.candidate.supplierQuantity} Supplier Units - ` : ""
  const title = `${prefix}${evaluation.sourceIdentity.title}`.slice(0, 80)
  return { contractVersion: "COMMERCIAL_GOLDEN_PATH_LISTING_PACKAGE_V1", state: "DRAFT_ONLY", published: false, itemId: null, sku: evaluation.candidate.supplierSku,
    supplierQuantity: evaluation.candidate.supplierQuantity, includedCount: evaluation.offer.includedCount, title, keywords: [...new Set(title.toLowerCase().match(/[a-z0-9]+/g) ?? [])], category,
    specifics: evaluation.productTruth.verifiedSpecifics.filter(f => !["SUPPLIER_COST", "SUPPLIER_STOCK", "SUPPLIER_AVAILABILITY", "QUANTITY_OR_SET_COUNT"].includes(String(f.FIELD)) && !(evaluation.candidate.supplierQuantity > 1 && f.FIELD === "GTIN")),
    offerContents: { supplierUnits: evaluation.candidate.supplierQuantity, totalVerifiedCount: evaluation.offer.includedCount, supplierUnitFacts: evaluation.productTruth.verifiedSpecifics.filter(f => ["PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "GTIN"].includes(String(f.FIELD))) },
    description: `Offer contains ${evaluation.candidate.supplierQuantity} supplier unit(s); total verified count: ${evaluation.offer.includedCount}.\n` + evaluation.productTruth.verifiedSpecifics.filter(f => ["TITLE", "MATERIAL", "COLOR", "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "SIZE_SET", "MODEL"].includes(String(f.FIELD))).map(f => `Supplier unit ${f.FIELD}: ${typeof f.VALUE === "string" ? f.VALUE : JSON.stringify(f.VALUE)}`).join("\n"),
    recommendedPrice: evaluation.economics.recommendedPrice, buyerShipping: 0, promotedListings: "OFF", economics: evaluation.economics,
    imagePlan: { source: "VERIFIED_SUPPLIER_IMAGES_ONLY", imageFieldReceipts: evaluation.productTruth.verifiedSpecifics.filter(f => f.FIELD === "IMAGES"), needsOwnerRightsAndImageReview: true, unsupportedClaimsAllowed: false },
    evidenceReceipts: [evaluation.evidenceDigest, evaluation.productTruth.receiptId, evaluation.shipping.receiptId, evaluation.compliance.receiptId, evaluation.economics.feeAuthority.receiptId].filter(Boolean),
    publication: { mode: "OWNER_MANUAL", marketplaceWrites: 0, publishCapability: false, postPublicationTool: "seller_os_reconcile_and_enroll_listing_v1" } }
}
