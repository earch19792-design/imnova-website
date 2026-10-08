import { createHash } from "node:crypto"
// @ts-expect-error Native Node verification uses the explicit TypeScript suffix.
import { evaluateLunaTraceProductTruthGateV1 } from "../seller-os/luna-trace-product-truth-gate-v1.ts"
// @ts-expect-error Native Node verification uses the explicit TypeScript suffix.
import { classifyWinnerComparable, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2"
import { validGoldenOwnerFeePolicyV1 } from "./commercial-golden-path-owner-fee-policy-v1"
import { goldenOwnerBaseIncludedUnitCountV1,
  goldenOwnerObservedMarkingsV1 } from "./commercial-golden-path-owner-product-truth-v1"
import { goldenVisualComparisonForMarketEvidenceV1,
  type GoldenVisualOutcomeV1 } from "./commercial-golden-path-visual-comparison-v1"
import { sanitizedSourceIdentifier } from "./ebay-luna-product-identity-enrichment"
import { evaluateSellerOsRoiMarginPolicyV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

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
  marketplace?: "EBAY_US"
  listingState: "SOLD" | "ACTIVE"; identity: ProductIdentityInput
  requestedClassification?: "EXACT" | "CLOSE" | "FAMILY" | "REJECTED_COMPARABLE"
  reviewed: boolean; reviewReason: string | null; soldQuantity: number | null
  realizedSoldPrice: number | null; activeListingPrice?: number | null; buyerShipping: number | null
  currency: string; lastSoldDate: string | null; capturedAt: string
  realizedPriceStatus: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
}
export type GoldenAuthority = GoldenRecord & { status: string; receiptId?: string | null }
export type GoldenEvaluationInput = {
  candidate: GoldenCandidateKey; accountKey: string; ownerUserId?: string; now: Date; targetNetProfit: number
  source: GoldenRecord | null; market: GoldenMarketEvidence[]; marketComplete: boolean
  ownerProductTruthEvidence?: GoldenRecord[]
  autonomousIdentity?: GoldenAuthority
  visualComparisonEvidence?: GoldenRecord[]
  duplicate: GoldenAuthority; shipping: GoldenAuthority; fee: GoldenAuthority
  fulfillment?: GoldenAuthority
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
export function goldenComparableIdentity(
  source: GoldenRecord | null,
  quantity: number,
  now: Date,
  baseIncludedCountOverride?: number | null,
  autonomousIdentity?: ProductIdentityInput | null,
): ProductIdentityInput {
  const truth = verifiedGoldenFields(source, now).values
  const supplierCount = goldenNumber(truth.QUANTITY_OR_SET_COUNT)
  const count = baseIncludedCountOverride === undefined
    ? supplierCount
    : baseIncludedCountOverride
  return { productName: typeof truth.TITLE === "string" ? truth.TITLE
      : autonomousIdentity?.productName ?? null,
    manufacturerBrand: typeof truth.BRAND === "string" ? truth.BRAND
      : autonomousIdentity?.manufacturerBrand ?? null,
    gtin: quantity === 1 && typeof truth.GTIN === "string" ? truth.GTIN
      : quantity === 1 ? autonomousIdentity?.gtin ?? null : null,
    mpn: typeof truth.MPN === "string" ? truth.MPN : autonomousIdentity?.mpn ?? null,
    model: typeof truth.MODEL === "string" ? truth.MODEL : autonomousIdentity?.model ?? null,
    color: typeof truth.COLOR === "string" ? truth.COLOR : autonomousIdentity?.color ?? null,
    size: typeof truth.SIZE_SET === "string" ? truth.SIZE_SET : autonomousIdentity?.size ?? null,
    scent: typeof truth.SCENT === "string" ? truth.SCENT : autonomousIdentity?.scent ?? null,
    variant: autonomousIdentity?.variant ?? null,
    condition: autonomousIdentity?.condition ?? null,
    unitCount: autonomousIdentity?.unitCount ?? null,
    packCount: count !== null && Number.isSafeInteger(count) && count > 0 ? count * quantity : null }
}
/** Discovery routing only. Supplier category labels never become Product Truth or market authority. */
export function goldenCategoryDiscoveryMatchesV1(category: string, source: GoldenRecord, now: Date) {
  if (category.trim().toLowerCase().replace(/[^a-z0-9]/g, "") !== "personalcare") return source.product_type === category
  const title = verifiedGoldenFields(source, now).values.TITLE
  return typeof title === "string" && !/\b(?:laptop|desktop|ipad|iphone|ddr[2345]|dimm|gpu|pcie|processor|hvac|furnace|humidifier|chair)\b/i.test(title) && /\b(?:mouthwash|toothbrush|toothpaste|dental|floss|hair|comb|razor|shaver|shaving|manicure|pedicure|nail|skin|soap|lotion|cream|serum|sunscreen|lip\s+balm|dusting\s+powder|deodorant|perfume|body\s+wash|bath\s+brush|cosmetic|makeup)\b/i.test(title)
}
const identityTokens = (value: string | null) => new Set(
  value?.match(/[a-z0-9]+/g)?.filter(token => token.length > 1) ?? [],
)
const GENERIC_IDENTITY_TOKENS = new Set([
  "brand", "coastal", "color", "dog", "grooming", "no", "one", "pack",
  "pet", "size", "stainless", "steel", "tool",
])
function observedMarkingSupportsCloseV1(
  targetName: string | null,
  comparableName: string | null,
  markings: ReadonlyArray<string>,
) {
  const target = identityTokens(targetName), comparable = identityTokens(comparableName)
  for (const marking of markings) {
    const markingTokens = identityTokens(marking.toLocaleLowerCase("en-US"))
    if (!markingTokens.size || ![...markingTokens].every(token => comparable.has(token))) continue
    const core = [...target].filter(token => !markingTokens.has(token)
      && !GENERIC_IDENTITY_TOKENS.has(token))
    if (core.length >= 2 && core.filter(token => comparable.has(token)).length / core.length >= 0.75) {
      return marking
    }
  }
  return null
}

export const SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1 =
  "SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1" as const

type GoldenAutonomousIdentityResolutionV1 = Readonly<{
  status: "PROVEN" | "UNPROVEN" | "CONFLICTED"
  identity: ProductIdentityInput
  evidenceDigest: string | null
  enrichmentId: string | null
  observedAt: string | null
  freshUntil: string | null
  reasonCodes: readonly string[]
  listingSpecifics: readonly GoldenRecord[]
}>

const autonomousText = (value: unknown) => typeof value === "string" && value.trim()
  ? value.trim() : null
const autonomousInteger = (value: unknown) => Number.isSafeInteger(Number(value))
  && Number(value) > 0 ? Number(value) : null
const autonomousKey = (value: unknown) => typeof value === "string"
  ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
  : JSON.stringify(value)

function autonomousEvidenceSupportsV1(rows: GoldenRecord[], attribute: string,
  value: unknown) {
  const matching = rows.filter(row => row.attribute_name === attribute
    && row.conflict_status === "CLEAR"
    && autonomousKey(row.normalized_value) === autonomousKey(value))
  if (matching.some(row => row.source_type === "LUNA_STRUCTURED"
    && Number(row.confidence) >= .85)) return true
  if (matching.some(row => row.source_type === "EBAY_CATALOG"
    && Number(row.confidence) >= .85)) return true
  if (matching.some(row => row.source_type === "MANUFACTURER_OFFICIAL"
    && Number(row.confidence) >= .9)) return true
  return new Set(matching.filter(row => row.source_type === "EBAY_BROWSE"
    && Number(row.confidence) >= .88).map(row => String(row.source_identifier))).size >= 2
}

function autonomousSpecificV1(input: {
  field: string
  value: unknown
  authority: GoldenAuthority
}) {
  const evidenceDigest = String(input.authority.evidenceDigest ?? "")
  const enrichmentId = String(input.authority.enrichmentId ?? "")
  return Object.freeze({ FIELD: input.field, VALUE: input.value,
    SEMANTIC_CLASS: "FACT", EVIDENCE_STATUS: "PROVEN",
    EVIDENCE_ID: evidenceDigest, CONTRADICTION: false,
    OBSERVED_AT: input.authority.observedAt,
    FRESH_UNTIL: input.authority.freshUntil,
    SOURCE_EVIDENCE: [{ EVIDENCE_ID: evidenceDigest,
      SOURCE_RECEIPT_ID: `seller_os_identity_enrichment:${enrichmentId}` }],
    AUTHORITY_CLASS: SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1,
    SUPPLIER_TRUTH: false })
}

/**
 * A durable autonomous enrichment may fill a missing supplier identity fact.
 * It never replaces Supplier Truth, and any disagreement with a proven Luna
 * field makes the overlay conflicted instead of choosing a winner.
 */
export function resolveGoldenAutonomousIdentityV1(input: Readonly<{
  authority?: GoldenAuthority | null
  candidate: GoldenCandidateKey
  accountKey: string
  sourceFingerprint: string | null
  supplierIdentity: ProductIdentityInput
  now: Date
}>): GoldenAutonomousIdentityResolutionV1 {
  const authority = (input.authority ?? {}) as GoldenAuthority
  const identity = goldenRecord(authority.identity)
  const evidence = goldenArray(authority.evidence)
  const candidate = goldenRecord(authority.candidate)
  const observedAt = autonomousText(authority.observedAt)
  const freshUntil = autonomousText(authority.freshUntil)
  const structural = authority.status === "PROVEN"
    && authority.contractVersion === SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1
    && authority.accountKey === input.accountKey
    && candidate.productId === input.candidate.productId
    && candidate.variantId === input.candidate.variantId
    && candidate.supplierSku === input.candidate.supplierSku
    && authority.sourceFingerprint === input.sourceFingerprint
    && authority.supplierTruthModified === false
    && authority.operatorRequired === false
    && authority.marketplaceWrites === 0
    && /^sha256:[0-9a-f]{64}$/.test(String(authority.evidenceDigest ?? ""))
    && Boolean(autonomousText(authority.enrichmentId))
    && Boolean(observedAt && freshUntil)
    && date(observedAt) <= input.now.getTime()
    && date(freshUntil) > input.now.getTime()
    && Array.isArray(authority.conflictAttributes)
    && authority.conflictAttributes.length === 0
  if (!structural) return Object.freeze({ status: "UNPROVEN", identity: {},
    evidenceDigest: null, enrichmentId: null, observedAt: null,
    freshUntil: null, reasonCodes: ["AUTONOMOUS_IDENTITY_AUTHORITY_UNPROVEN"],
    listingSpecifics: [] })

  const expectedLunaSource = sanitizedSourceIdentifier("LUNA_STRUCTURED",
    `${input.candidate.productId}:${input.candidate.variantId}`)
  if (!evidence.some(row => row.attribute_name === "normalizedProductName"
    && row.source_type === "LUNA_STRUCTURED"
    && row.source_identifier === expectedLunaSource
    && row.conflict_status === "CLEAR")) {
    return Object.freeze({ status: "UNPROVEN", identity: {},
      evidenceDigest: null, enrichmentId: null, observedAt: null,
      freshUntil: null,
      reasonCodes: ["AUTONOMOUS_IDENTITY_LUNA_BINDING_UNPROVEN"],
      listingSpecifics: [] })
  }

  const supplemental: ProductIdentityInput = {
    productName: autonomousText(identity.normalizedProductName),
    manufacturerBrand: autonomousText(identity.brand),
    gtin: autonomousText(identity.validGtin), mpn: autonomousText(identity.mpn),
    model: autonomousText(identity.model),
    packCount: autonomousInteger(identity.packCount),
    unitCount: autonomousInteger(identity.unitCount),
    size: autonomousText(identity.size), color: autonomousText(identity.color),
    scent: autonomousText(identity.scent), variant: autonomousText(identity.variant),
    condition: autonomousText(identity.condition),
  }
  const mapping = [
    ["manufacturerBrand", "brand", "BRAND"], ["gtin", "validGtin", "GTIN"],
    ["mpn", "mpn", "MPN"], ["model", "model", "MODEL"],
    ["packCount", "packCount", "QUANTITY_OR_SET_COUNT"],
    ["unitCount", "unitCount", "UNIT_COUNT"], ["size", "size", "SIZE_SET"],
    ["color", "color", "COLOR"], ["scent", "scent", "SCENT"],
    ["variant", "variant", "VARIANT_OPTIONS"],
    ["condition", "condition", "CONDITION"],
  ] as const
  const reasonCodes: string[] = []
  const listingSpecifics: GoldenRecord[] = []
  for (const [property, attribute, field] of mapping) {
    const supplierValue = input.supplierIdentity[property]
    const supplementalValue = supplemental[property]
    if (supplierValue !== null && supplierValue !== undefined
      && supplementalValue !== null && supplementalValue !== undefined
      && autonomousKey(supplierValue) !== autonomousKey(supplementalValue)) {
      reasonCodes.push(`AUTONOMOUS_IDENTITY_${field}_CONFLICT`)
      continue
    }
    if ((supplierValue === null || supplierValue === undefined)
      && supplementalValue !== null && supplementalValue !== undefined) {
      if (!autonomousEvidenceSupportsV1(evidence, attribute, supplementalValue)) {
        reasonCodes.push(`AUTONOMOUS_IDENTITY_${field}_EVIDENCE_UNPROVEN`)
        continue
      }
      listingSpecifics.push(autonomousSpecificV1({ field,
        value: supplementalValue, authority }))
    }
  }
  if (reasonCodes.some(reason => reason.endsWith("_CONFLICT"))) {
    return Object.freeze({ status: "CONFLICTED", identity: {},
      evidenceDigest: String(authority.evidenceDigest),
      enrichmentId: String(authority.enrichmentId), observedAt, freshUntil,
      reasonCodes: Object.freeze(reasonCodes), listingSpecifics: [] })
  }
  const merged = Object.fromEntries(Object.keys(supplemental).map(property => {
    const key = property as keyof ProductIdentityInput
    const supplierValue = input.supplierIdentity[key]
    return [property, supplierValue ?? supplemental[key] ?? null]
  })) as ProductIdentityInput
  if (!merged.productName || !merged.packCount || !merged.condition
    || !(merged.gtin || merged.mpn || merged.model)) {
    reasonCodes.push("AUTONOMOUS_IDENTITY_MINIMUM_CORROBORATION_UNPROVEN")
  }
  return Object.freeze({ status: reasonCodes.length ? "UNPROVEN" : "PROVEN",
    identity: reasonCodes.length ? {} : merged,
    evidenceDigest: String(authority.evidenceDigest),
    enrichmentId: String(authority.enrichmentId), observedAt, freshUntil,
    reasonCodes: Object.freeze(reasonCodes),
    listingSpecifics: reasonCodes.length ? [] : Object.freeze(listingSpecifics) })
}

/** Manual match labels are reviewed market observations. They cannot repair supplier truth. */
export function classifyGoldenComparable(
  target: ProductIdentityInput,
  evidence: GoldenMarketEvidence,
  context?: Readonly<{
    observedMarkings?: ReadonlyArray<string>
    visualComparison?: Readonly<{
      outcome: GoldenVisualOutcomeV1
      reasonCodes: ReadonlyArray<string>
      evidenceIds: ReadonlyArray<string>
      visualSimilaritySupport: boolean
      exactAuthority: false
    }> | null
  }>,
) {
  const a = normalizeProductIdentity(target), b = normalizeProductIdentity(evidence.identity)
  const base = classifyWinnerComparable(target, evidence.identity)
  const reasons: string[] = []
  const markingSupport = observedMarkingSupportsCloseV1(
    a.normalizedProductName, b.normalizedProductName,
    context?.observedMarkings ?? [],
  )
  if (evidence.requestedClassification === "REJECTED_COMPARABLE") reasons.push("OPERATOR_REJECTED_COMPARABLE")
  if (b.manufacturerBrand && a.manufacturerBrand
    && b.manufacturerBrand !== a.manufacturerBrand) reasons.push("BRAND_CONFLICT")
  if (b.manufacturerBrand && !a.manufacturerBrand && !markingSupport) reasons.push("BRAND_TRANSFER_PROHIBITED")
  if (["INVALID_COMPARABLE", "DIFFERENT_VARIANT"].includes(base.classification)) reasons.push(...base.reasons)
  if (reasons.length) return { classification: "REJECTED_COMPARABLE" as const, reasonCodes: reasons, priceEligible: false }
  const visual = context?.visualComparison ?? null
  if (visual?.outcome === "CONTRADICTS"
    && !visual.reasonCodes.includes("MARKETPLACE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN")) {
    return { classification: "REJECTED_COMPARABLE" as const,
      reasonCodes: ["VISUAL_CONTRADICTION_REJECTS_COMPARABLE", ...visual.reasonCodes],
      priceEligible: false }
  }
  if (visual?.outcome === "CONTRADICTS") return { classification: "FAMILY" as const,
    reasonCodes: ["COMPARABLE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN",
      ...visual.reasonCodes], priceEligible: false }
  if (a.packCount !== null && b.packCount !== null && a.packCount !== b.packCount) {
    return { classification: "FAMILY" as const, reasonCodes: ["OFFER_COUNT_MISMATCH"], priceEligible: false }
  }
  if (a.packCount === null && b.packCount !== null && b.packCount > 1) {
    return { classification: "FAMILY" as const, reasonCodes: ["COMPARABLE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN"], priceEligible: false }
  }
  if (evidence.requestedClassification === "FAMILY") return { classification: "FAMILY" as const, reasonCodes: ["OPERATOR_FAMILY_ONLY"], priceEligible: false }
  const offerCountExact = a.packCount !== null && b.packCount !== null && a.packCount === b.packCount
  if (base.classification === "EXACT_MATCH") return { classification: "EXACT" as const, reasonCodes: base.reasons, priceEligible: offerCountExact }
  const reviewedClose = evidence.reviewed && Boolean(evidence.reviewReason) && evidence.requestedClassification === "CLOSE" && a.normalizedProductName === b.normalizedProductName
  if (base.classification === "NEAR_MATCH" || reviewedClose) return { classification: "CLOSE" as const, reasonCodes: reviewedClose ? ["HUMAN_REVIEWED_SAME_PRODUCT_OFFER"] : base.reasons, priceEligible: offerCountExact }
  const markingClose = markingSupport && evidence.reviewed && Boolean(evidence.reviewReason)
    && ["CLOSE", "EXACT"].includes(evidence.requestedClassification ?? "")
  if (markingClose) return { classification: "CLOSE" as const, reasonCodes: [
    "OWNER_OBSERVED_MARKING_SUPPORTS_IDENTITY_ONLY",
    ...(b.manufacturerBrand && !a.manufacturerBrand ? ["COMPARABLE_BRAND_NOT_TRANSFERRED"] : []),
    ...(evidence.requestedClassification === "EXACT" ? ["OBSERVED_MARKING_CANNOT_PROVE_EXACT"] : []),
    ...(!offerCountExact ? ["OFFER_COUNT_UNPROVEN_PRICE_INELIGIBLE"] : []),
  ], priceEligible: offerCountExact }
  const visualClose = visual?.outcome === "SUPPORTS_CLOSE"
    && visual.visualSimilaritySupport === true && visual.exactAuthority === false
    && evidence.reviewed && Boolean(evidence.reviewReason)
    && ["CLOSE", "EXACT"].includes(evidence.requestedClassification ?? "")
  if (visualClose) return { classification: "CLOSE" as const, reasonCodes: [
    "VISUAL_SIMILARITY_SUPPORT_CLOSE_ONLY",
    ...(evidence.requestedClassification === "EXACT"
      ? ["VISUAL_EVIDENCE_CANNOT_PROVE_EXACT"] : []),
    ...(!offerCountExact ? ["OFFER_COUNT_UNPROVEN_PRICE_INELIGIBLE"] : []),
  ], priceEligible: offerCountExact }
  if (a.packCount === null || b.packCount === null) return { classification: "FAMILY" as const, reasonCodes: ["OFFER_COUNT_NOT_EXACT"], priceEligible: false }
  return { classification: "FAMILY" as const, reasonCodes: ["EXACT_CLOSE_IDENTITY_UNPROVEN"], priceEligible: false }
}
export function evaluateGoldenCandidateV1(input: GoldenEvaluationInput) {
  if (!Number.isFinite(input.targetNetProfit) || input.targetNetProfit < 0 || input.targetNetProfit > 10000) throw Error("LEGACY_TARGET_NET_PROFIT_OUTSIDE_AUTHORIZED_BOUND")
  const { candidate: key, source, now } = input
  const reasons: string[] = [], holds: string[] = [], rejects: string[] = []
  const truth = verifiedGoldenFields(source, now)
  const baseCandidate = { ...key, supplierQuantity: 1 }
  const ownerBaseCount = goldenOwnerBaseIncludedUnitCountV1({
    evidence: input.ownerProductTruthEvidence ?? [], candidate: baseCandidate,
    accountKey: input.accountKey, ownerUserId: input.ownerUserId ?? "",
    sourceFingerprint: String(source?.source_fingerprint ?? ""),
    canonicalUrl: String(source?.canonical_url ?? ""), now,
  })
  const rawSupplierBaseCount = goldenNumber(truth.values.QUANTITY_OR_SET_COUNT)
  const supplierBaseCount = rawSupplierBaseCount !== null
    && Number.isSafeInteger(rawSupplierBaseCount) && rawSupplierBaseCount > 0
    ? rawSupplierBaseCount : null
  const baseCountConflict = ownerBaseCount.status === "CONFLICT"
    || supplierBaseCount !== null && ownerBaseCount.status === "PROVEN"
      && supplierBaseCount !== ownerBaseCount.value
  const baseIncludedCount = baseCountConflict ? null
    : supplierBaseCount ?? ownerBaseCount.value
  const supplierIdentity = goldenComparableIdentity(
    source, 1, now, baseIncludedCount,
  )
  const autonomousIdentity = resolveGoldenAutonomousIdentityV1({
    authority: input.autonomousIdentity, candidate: key,
    accountKey: input.accountKey,
    sourceFingerprint: typeof source?.source_fingerprint === "string"
      ? source.source_fingerprint : null,
    supplierIdentity, now,
  })
  if (autonomousIdentity.status === "CONFLICTED") {
    holds.push(...autonomousIdentity.reasonCodes)
  }
  const needsAutonomousIdentity = !supplierIdentity.manufacturerBrand
    || !(supplierIdentity.gtin || supplierIdentity.mpn || supplierIdentity.model)
    || baseIncludedCount === null
  if (needsAutonomousIdentity && autonomousIdentity.status !== "PROVEN") {
    reasons.push("AUTONOMOUS_IDENTITY_ENRICHMENT_REQUIRED")
  }
  const effectiveBaseIncludedCount = baseIncludedCount
    ?? (autonomousIdentity.status === "PROVEN"
      ? goldenNumber(autonomousIdentity.identity.packCount) : null)
  const identity = goldenComparableIdentity(
    source, key.supplierQuantity, now, effectiveBaseIncludedCount,
    autonomousIdentity.status === "PROVEN" ? autonomousIdentity.identity : null,
  )
  const observedMarkings = goldenOwnerObservedMarkingsV1({
    evidence: input.ownerProductTruthEvidence ?? [], candidate: baseCandidate,
    accountKey: input.accountKey, ownerUserId: input.ownerUserId ?? "",
    sourceFingerprint: String(source?.source_fingerprint ?? ""),
    canonicalUrl: String(source?.canonical_url ?? ""), now,
  })
  if (baseCountConflict) holds.push("SUPPLIER_BASE_INCLUDED_UNIT_COUNT_CONFLICT")
  if (identity.packCount === null) reasons.push("OFFER_COUNT_UNPROVEN")
  const exactBinding = source?.product_id === key.productId && source?.variant_id === key.variantId && source?.sku === key.supplierSku
  if (!exactBinding || !truth.gate.traceProductTruthSufficient || source?.preflight_status !== "PREFLIGHT_PASS") reasons.push("LUNA_IDENTITY_PRODUCT_TRUTH_UNPROVEN")
  if (truth.fields.some(f => f.CONTRADICTION === true)) holds.push("PRODUCT_TRUTH_CONTRADICTION")
  const classified = input.market.slice(0, 200).map(e => {
    const visualComparison = goldenVisualComparisonForMarketEvidenceV1({
      evidence: input.visualComparisonEvidence ?? [], candidate: key,
      accountKey: input.accountKey, ownerUserId: input.ownerUserId ?? "",
      sourceFingerprint: String(source?.source_fingerprint ?? ""),
      canonicalUrl: String(source?.canonical_url ?? ""),
      marketEvidence: { evidenceId: e.evidenceId, listingState: e.listingState,
        sourceLocator: e.sourceLocator, sourceDigest: e.sourceDigest }, now,
    })
    return { ...e, ...classifyGoldenComparable(identity, e,
      { observedMarkings, visualComparison }), visualComparison,
      buyerLandedPrice: e.listingState === "SOLD" && e.realizedSoldPrice !== null && e.buyerShipping !== null ? cents(e.realizedSoldPrice + e.buyerShipping) : null,
      fresh: e.listingState === "SOLD" && date(e.lastSoldDate) <= now.getTime() && now.getTime() - date(e.lastSoldDate) <= 90 * 86400000 && date(e.capturedAt) <= now.getTime() && now.getTime() - date(e.capturedAt) <= 90 * 86400000 }
  })
  const sold = classified.filter(e => e.listingState === "SOLD")
  const exact = sold.filter(e => e.classification === "EXACT"), close = sold.filter(e => e.classification === "CLOSE"), family = sold.filter(e => e.classification === "FAMILY")
  const priced = [...exact, ...close].filter(e => e.priceEligible === true && e.fresh && date(e.lastSoldDate) <= date(e.capturedAt) && e.currency === "USD" && e.soldQuantity !== null && Number.isSafeInteger(e.soldQuantity) && e.soldQuantity > 0 && e.buyerShipping !== null && e.buyerShipping >= 0 && e.realizedPriceStatus === "PROVEN" && e.realizedSoldPrice !== null && e.realizedSoldPrice > 0 && e.buyerLandedPrice !== null && /^sha256:[0-9a-f]{64}$/.test(e.sourceDigest))
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
  // A supplier quote to the merchant location does not prove delivery to the buyer.
  // Never silently treat forwarding as free or use a policy reserve as freight authority.
  const fulfillment = input.fulfillment ?? { status: "UNPROVEN", reasonCode: "BUYER_FULFILLMENT_SHIPPING_UNPROVEN" }
  const fulfillmentAmount = goldenNumber(fulfillment.amountUsd)
  const fulfillmentValid = shippingValid && fulfillment.status === "PROVEN" && fulfillment.accountKey === input.accountKey && fulfillment.productId === key.productId && fulfillment.variantId === key.variantId && fulfillment.supplierSku === key.supplierSku && fulfillment.supplierQuantity === key.supplierQuantity && fulfillment.sourceFingerprint === source?.source_fingerprint && fulfillment.supplierShippingReceiptId === input.shipping.receiptId && /^sha256:[0-9a-f]{64}$/.test(String(input.shipping.destinationProfileDigest ?? "")) && fulfillment.destinationProfileDigest === input.shipping.destinationProfileDigest && fulfillment.currency === "USD" && fulfillment.buyerShipping === 0 && fulfillment.buyerCoverageStatus === "PROVEN" && /^sha256:[0-9a-f]{64}$/.test(String(fulfillment.buyerCoverageDigest ?? "")) && /^sha256:[0-9a-f]{64}$/.test(String(fulfillment.sourceDigest ?? "")) && Boolean(fulfillment.receiptId) && fulfillmentAmount !== null && fulfillmentAmount >= 0 && goldenFresh(fulfillment, now, 6 * 3600000) && (
    fulfillment.source === "REAL_BUYER_FULFILLMENT_SERVICE_QUOTE_V1" && fulfillment.coverage === "ALL_OFFERED_BUYER_DESTINATIONS" ||
    fulfillment.source === "OWNER_CERTIFIED_DIRECT_SUPPLIER_FULFILLMENT_V1" && fulfillment.coverage === "SUPPLIER_QUOTE_COVERS_ALL_OFFERED_BUYER_DESTINATIONS" && fulfillmentAmount === 0
  )
  const fulfillmentCost = fulfillmentValid ? fulfillmentAmount : null
  if (fulfillmentCost === null) reasons.push("BUYER_FULFILLMENT_SHIPPING_UNPROVEN")
  const provisionalFee = validGoldenOwnerFeePolicyV1(input.fee, { candidate: key, accountKey: input.accountKey, sourceFingerprint: source?.source_fingerprint, price: marketPrice, now })
  const feeValid = provisionalFee || input.fee.status === "PROVEN" && input.fee.accountKey === input.accountKey && input.fee.productId === key.productId && input.fee.variantId === key.variantId && input.fee.supplierSku === key.supplierSku && input.fee.supplierQuantity === key.supplierQuantity && input.fee.price === marketPrice && input.fee.buyerShipping === 0 && input.fee.currency === "USD" && Boolean(input.fee.receiptId) && goldenFresh(input.fee, now, 24 * 3600000)
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
  const ready = exactBinding && truth.gate.traceProductTruthSufficient && !reasons.some(r => /SHIPPING|COST|FEE|RESERVE|COSTS/.test(r)) && marketPrice !== null && cost !== null && shippingCost !== null && fulfillmentCost !== null && fees !== null && returns !== null && promoted !== null && other !== null
  const net = ready ? Math.floor((marketPrice! - cost! - shippingCost! - fulfillmentCost! - fees! - returns! - promoted! - other! + 1e-9) * 100) / 100 : null
  const economicPolicyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
    revenueUsd: marketPrice,
    investmentBase: "EBAY_LUNA_ORDER_INVESTMENT",
    investmentBaseUsd: cost !== null && shippingCost !== null &&
        fulfillmentCost !== null
      ? cost + shippingCost + fulfillmentCost : null,
    costs: [
      { key: "supplier_offer_cost", amountUsd: cost,
        authority: "LUNA_PRODUCT_TRUTH", state: cost === null ? "UNKNOWN" : "KNOWN" },
      { key: "supplier_shipping", amountUsd: shippingCost,
        authority: "LUNA_QUOTE", state: shippingCost === null ? "UNKNOWN" : "KNOWN" },
      { key: "buyer_fulfillment", amountUsd: fulfillmentCost,
        authority: "FULFILLMENT_QUOTE", state: fulfillmentCost === null ? "UNKNOWN" : "KNOWN" },
      { key: "ebay_fees", amountUsd: fees,
        authority: "EBAY_FEE_AUTHORITY", state: fees === null ? "UNKNOWN" : "KNOWN" },
      { key: "returns_reserve", amountUsd: returns,
        authority: "OWNER_POLICY", state: returns === null ? "UNKNOWN" : "KNOWN" },
      { key: "promoted_fee", amountUsd: promoted,
        authority: "OWNER_POLICY", state: promoted === null ? "UNKNOWN" : "KNOWN" },
      { key: "other_required_costs", amountUsd: other,
        authority: "OWNER_POLICY", state: other === null ? "UNKNOWN" : "KNOWN" },
    ],
  })
  if (ready && !economicPolicyEvaluation.passesPolicy) {
    rejects.push(...economicPolicyEvaluation.blockerCodes)
  }
  const complianceValid = input.compliance.status === "PROVEN" && input.compliance.productId === key.productId && input.compliance.variantId === key.variantId && input.compliance.supplierSku === key.supplierSku && input.compliance.supplierQuantity === key.supplierQuantity && input.compliance.sourceFingerprint === source?.source_fingerprint && Boolean(input.compliance.receiptId) && goldenFresh(input.compliance, now, 24 * 3600000)
  const blockers = Array.isArray(input.compliance.blockers) ? input.compliance.blockers.map(String) : []
  if (blockers.length) holds.push(...blockers)
  if (!complianceValid) reasons.push("COMPLIANCE_CATEGORY_SPECIFICS_UNPROVEN")
  const decision = rejects.length ? "REJECT" as const : holds.length ? "HOLD" as const : reasons.length ? "UNPROVEN" as const : "GO" as const
  const supplierSpecifics = truth.proven
  const listingSpecifics = [...supplierSpecifics,
    ...autonomousIdentity.listingSpecifics.filter(specific =>
      !supplierSpecifics.some(field => field.FIELD === specific.FIELD))]
  const result = { contractVersion: GOLDEN_PATH_V1, evaluatedAt: now.toISOString(), candidate: key,
    sourceIdentity: { title: typeof truth.values.TITLE === "string" ? truth.values.TITLE : identity.productName ?? null, observedSourceTitle: source?.title ?? null, canonicalUrl: source?.canonical_url ?? null, sourceFingerprint: source?.source_fingerprint ?? null, snapshotId: source?.snapshot_id ?? null, observedAt: source?.observed_at ?? null, autonomousIdentityEvidenceDigest: autonomousIdentity.evidenceDigest },
    offer: { type: identity.packCount === null ? "UNPROVEN" : key.supplierQuantity === 1 && identity.packCount === 1 ? "single" : "pack", supplierQuantity: key.supplierQuantity, includedCount: identity.packCount, listingSku: key.supplierSku },
    market: { status: input.marketComplete ? "AVAILABLE" : "UNPROVEN", exactSold: exact, closeSold: close, familyEvidence: family, rejectedComparables: classified.filter(e => e.classification === "REJECTED_COMPARABLE"), activeCompetition: classified.filter(e => e.listingState === "ACTIVE"), activeCompetitionAuthority: { status: "UNPROVEN", scope: "MANUAL_OBSERVATIONS_ONLY_NO_COMPLETE_COMPETITION_SCAN", exhaustive: false }, visualComparisonEvidence: input.visualComparisonEvidence ?? [], visualComparisonPolicy: "CLOSE_SUPPORT_OR_CONTRADICTION_NEVER_EXACT", soldQuantity: priced.length ? soldUnits : null, realizedBuyerLandedPrice: marketPrice, realizedPriceBasis: "LOWER_QUANTITY_WEIGHTED_MEDIAN_EXACT_CLOSE_SOLD", activePriceUsedForEconomics: false, familyUsedForEconomics: false },
    duplicateGate: input.duplicate, supplier: { availability: truth.values.SUPPLIER_AVAILABILITY ?? null, unitCostUsd: unitCost, offerCostUsd: cost, stock: goldenNumber(truth.values.SUPPLIER_STOCK), stockStatus: truth.values.SUPPLIER_STOCK == null ? "UNPROVEN" : "PROVEN" },
    shipping: shippingValid ? input.shipping : { ...input.shipping, status: "UNPROVEN", amountUsd: null, supplierQuantity: key.supplierQuantity, reasonCode: input.shipping.reasonCode ?? "REAL_OFFER_SHIPPING_UNPROVEN", validationReasonCode: "REAL_OFFER_SHIPPING_UNPROVEN" },
    fulfillment: fulfillmentValid ? fulfillment : { ...fulfillment, status: "UNPROVEN", amountUsd: null, reasonCode: "BUYER_FULFILLMENT_SHIPPING_UNPROVEN" },
    economics: { status: ready ? provisionalFee ? "PROVISIONAL_OWNER_POLICY" : "PROVEN" : "UNPROVEN", legacyTargetNetProfitIgnored: input.targetNetProfit, recommendedPrice: marketPrice, buyerShipping: 0, pricingStrategy: "FREE_BUYER_SHIPPING_WITHIN_OBSERVED_LANDED_PRICE", feeAuthority: input.fee, ebayFees: fees, returnsReserve: returns, promotedFee: promoted, promotedState: input.policy.promotedState ?? "UNKNOWN", otherExplicitCosts: other, buyerFulfillmentShipping: fulfillmentCost, expectedNetProfit: net, expectedNetProfitBasis: provisionalFee ? "OWNER_PROVISIONAL_FEE_POLICY_PLUS_REAL_INPUTS" : "PRE_SALE_EVIDENCE_AND_EXPLICIT_OWNER_RESERVES", realizedNetProfit: null, realizedNetProfitStatus: "UNPROVEN", realizedNetProfitReasonCode: "REALIZED_ORDER_AND_EXPENSE_AUTHORITY_REQUIRED", realizedProfitUsedForDecision: false, profitFloor: { netProfitUsd: null, requiredPrice: null, status: "NO_MONETARY_PROFIT_FLOOR" }, economicPolicyEvaluation, marginPercent: economicPolicyEvaluation.contributionMarginPercent, roiPercent: economicPolicyEvaluation.estimatedRoiPercent, investmentBase: economicPolicyEvaluation.investmentBase, investmentBaseUsd: economicPolicyEvaluation.investmentBaseUsd },
    productTruth: { status: truth.gate.traceProductTruthSufficient
        ? autonomousIdentity.status === "PROVEN"
          ? "CORE_PLUS_AUTONOMOUS_ENRICHMENT" : "CORE_PROVEN"
        : "UNPROVEN", receiptId: truth.gate.receiptEvidenceDigest,
      verifiedSpecifics: supplierSpecifics, listingSpecifics,
      missingFields: truth.fields.filter(f => f.VALUE == null).map(f => f.FIELD),
      supplierClaimsExcluded: true,
      baseIncludedUnitCount: effectiveBaseIncludedCount,
      baseIncludedUnitCountStatus: baseCountConflict ? "CONFLICT" : supplierBaseCount !== null ? "PROVEN_SUPPLIER" : ownerBaseCount.status === "PROVEN" ? "PROVEN_OWNER_ATTESTED" : autonomousIdentity.status === "PROVEN" && effectiveBaseIncludedCount !== null ? "PROVEN_AUTONOMOUS_ENRICHMENT" : "UNPROVEN",
      ownerBaseIncludedUnitCountEvidenceIds: ownerBaseCount.evidenceIds,
      ownerObservedMarkings: observedMarkings,
      ownerEvidence: input.ownerProductTruthEvidence ?? [],
      autonomousIdentity: { status: autonomousIdentity.status,
        evidenceDigest: autonomousIdentity.evidenceDigest,
        enrichmentId: autonomousIdentity.enrichmentId,
        observedAt: autonomousIdentity.observedAt,
        freshUntil: autonomousIdentity.freshUntil,
        reasonCodes: autonomousIdentity.reasonCodes,
        operatorRequired: false, supplierTruthModified: false },
      manufacturerBrand: identity.manufacturerBrand ?? null,
      manufacturerBrandStatus: truth.values.BRAND != null
        ? "PROVEN_SUPPLIER" : autonomousIdentity.status === "PROVEN"
          && identity.manufacturerBrand ? "PROVEN_AUTONOMOUS_ENRICHMENT" : "UNPROVEN",
      ownerEvidencePromotedToManufacturerBrand: false,
      unknownFieldsPromoted: autonomousIdentity.status === "PROVEN" },
    compliance: input.compliance, decision, reasonCodes: [...rejects, ...holds, ...reasons, ...(provisionalFee ? ["OWNER_PROVISIONAL_FEE_POLICY_USED_EXPECTED_ONLY"] : [])], safety: { marketplaceWrites: 0, publish: false, end: false, supplierPurchases: 0, draftIsLive: false } }
  return { ...result, evidenceDigest: goldenDigest(result) }
}
export function prepareGoldenDraftV1(evaluation: ReturnType<typeof evaluateGoldenCandidateV1>) {
  if (evaluation.decision !== "GO") throw Error("GO_REQUIRED_FOR_LISTING_PACKAGE")
  const category = goldenRecord(evaluation.compliance.category)
  if (!category.id || !evaluation.sourceIdentity.title || evaluation.offer.includedCount === null) throw Error("VERIFIED_DRAFT_CATEGORY_TITLE_CONTENTS_REQUIRED")
  // Only field-level verified facts appear in prose. No model, dimensions, brand or claims are manufactured.
  const prefix = evaluation.candidate.supplierQuantity > 1 ? `${evaluation.offer.includedCount} Count / ${evaluation.candidate.supplierQuantity} Supplier Units - ` : ""
  const title = `${prefix}${evaluation.sourceIdentity.title}`.slice(0, 80)
  const listingSpecifics = Array.isArray(evaluation.productTruth.listingSpecifics)
    ? evaluation.productTruth.listingSpecifics : evaluation.productTruth.verifiedSpecifics
  return { contractVersion: "COMMERCIAL_GOLDEN_PATH_LISTING_PACKAGE_V1", state: "DRAFT_ONLY", published: false, itemId: null, sku: evaluation.candidate.supplierSku,
    supplierQuantity: evaluation.candidate.supplierQuantity, includedCount: evaluation.offer.includedCount, title, keywords: [...new Set(title.toLowerCase().match(/[a-z0-9]+/g) ?? [])], category,
    specifics: listingSpecifics.filter(f => !["SUPPLIER_COST", "SUPPLIER_STOCK", "SUPPLIER_AVAILABILITY", "QUANTITY_OR_SET_COUNT"].includes(String(f.FIELD)) && !(evaluation.candidate.supplierQuantity > 1 && f.FIELD === "GTIN")),
    offerContents: { supplierUnits: evaluation.candidate.supplierQuantity, totalVerifiedCount: evaluation.offer.includedCount, supplierUnitFacts: evaluation.productTruth.verifiedSpecifics.filter(f => ["PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "GTIN"].includes(String(f.FIELD))) },
    description: `Offer contains ${evaluation.candidate.supplierQuantity} supplier unit(s); total verified count: ${evaluation.offer.includedCount}.\n` + listingSpecifics.filter(f => ["TITLE", "MATERIAL", "COLOR", "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "SIZE_SET", "MODEL"].includes(String(f.FIELD))).map(f => `${f.SUPPLIER_TRUTH === false ? "Corroborated identity" : "Supplier unit"} ${f.FIELD}: ${typeof f.VALUE === "string" ? f.VALUE : JSON.stringify(f.VALUE)}`).join("\n"),
    recommendedPrice: evaluation.economics.recommendedPrice, buyerShipping: 0, promotedListings: "OFF", economics: evaluation.economics,
    imagePlan: { source: "VERIFIED_SUPPLIER_IMAGES_ONLY", imageFieldReceipts: evaluation.productTruth.verifiedSpecifics.filter(f => f.FIELD === "IMAGES"), needsOwnerRightsAndImageReview: true, unsupportedClaimsAllowed: false },
    evidenceReceipts: [evaluation.evidenceDigest, evaluation.productTruth.receiptId, evaluation.shipping.receiptId, evaluation.fulfillment.receiptId, evaluation.compliance.receiptId, evaluation.economics.feeAuthority.receiptId].filter(Boolean),
    publication: { mode: "OWNER_MANUAL", marketplaceWrites: 0, publishCapability: false, postPublicationTool: "seller_os_reconcile_and_enroll_listing_v1" } }
}
