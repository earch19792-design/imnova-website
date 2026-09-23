import { createHash } from "node:crypto"
import savedPolicy from "../../docs/commercial-trace-owner-price-policy-v1.json" with { type: "json" }

const SHA256 = /^sha256:[0-9a-f]{64}$/
type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}
const fractional = (value: unknown) => typeof value === "number" &&
  Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
const date = (value: unknown) => typeof value === "string"
  ? Date.parse(value) : Number.NaN
const digest = (value: string) => `sha256:${createHash("sha256")
  .update(value, "utf8").digest("hex")}`
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]))
    : value

export function ownerPricePolicyDigestV1(value: unknown) {
  const policy = record(value)
  const approved = Object.fromEntries(Object.entries(policy).filter(([key]) =>
    !["policyDigest", "status"].includes(key)))
  return digest(JSON.stringify(canonical(approved)))
}

export const OWNER_PRICE_POLICY_V1 =
  "SELLER_OS_COMMERCIAL_TRACE_OWNER_PRICE_POLICY_V1" as const

/** Repository-persisted, account-scoped OWNER approval. No DB or marketplace
 * write occurs when resolving it. Invalid provenance never becomes zero. */
export function resolveCommercialTraceOwnerPricePolicyV1(input: Readonly<{
  marketplaceAccountKey: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  sourceFingerprint: string
  promotionOptIn?: unknown
  additionalCostEvidence?: unknown
  policy?: unknown
  now?: Date
}>) {
  const now = (input.now ?? new Date()).getTime()
  const policy = record(input.policy ?? savedPolicy)
  const promotion = record(policy.promotedListings)
  const returns = record(policy.returnsReserve)
  const other = record(policy.otherExplicitCosts)
  const gates = record(policy.profitabilityGates)
  const created = date(policy.createdAt), updated = date(policy.updatedAt)
  const effective = date(policy.effectiveAt)
  const valid = policy.contractVersion === OWNER_PRICE_POLICY_V1 &&
    typeof policy.policyVersion === "string" &&
    policy.policyVersion.startsWith("OWNER_PRICE_POLICY_V1_") &&
    policy.marketplace === "EBAY_US" &&
    policy.marketplaceAccountKey === input.marketplaceAccountKey &&
    policy.currency === "USD" && policy.approvedByOwner === true &&
    policy.source === "OWNER_CERTIFIED_ACCOUNT_PRICE_POLICY_V1" &&
    typeof policy.approvalSource === "string" &&
    policy.approvalSource.startsWith("OWNER_EXPLICIT_") &&
    typeof policy.approvalStatement === "string" &&
    policy.approvalStatement.length > 80 &&
    policy.authorizationReferenceDigest === digest(policy.approvalStatement) &&
    policy.policyDigest === ownerPricePolicyDigestV1(policy) &&
    Number.isFinite(created) && Number.isFinite(updated) &&
    Number.isFinite(effective) && created <= updated && updated <= now &&
    effective >= created && effective <= now &&
    (policy.freshUntil === null ||
      Number.isFinite(date(policy.freshUntil)) && date(policy.freshUntil) > now) &&
    promotion.mode === "OPT_IN" &&
    promotion.defaultState === "NOT_APPLICABLE" &&
    promotion.state === "NOT_APPLICABLE" &&
    returns.state === "CONFIGURED" && returns.basis === "SALE_PRICE" &&
    fractional(returns.rateFraction) !== null &&
    other.state === "NOT_APPLICABLE" &&
    gates.state === "CONFIGURED" &&
    typeof gates.minNetProfit === "number" &&
    Number.isFinite(gates.minNetProfit) && gates.minNetProfit >= 0 &&
    fractional(gates.minNetMarginFraction) !== null &&
    typeof gates.minRoiFraction === "number" &&
    Number.isFinite(gates.minRoiFraction) && gates.minRoiFraction >= 0
  if (!valid) return Object.freeze({ status: "UNKNOWN" as const,
    marketplaceAccountKey: input.marketplaceAccountKey,
    reason: "OWNER_PRICE_POLICY_AUTHORITY_INVALID" })

  let promotedListings: R = { ...promotion }
  if (input.promotionOptIn !== undefined && input.promotionOptIn !== null) {
    const optIn = record(input.promotionOptIn)
    const exact = optIn.status === "PROVEN" &&
      optIn.source === "OWNER_EXPLICIT_PROMOTION_OPT_IN_V1" &&
      optIn.marketplaceAccountKey === input.marketplaceAccountKey &&
      optIn.lunaProductId === input.lunaProductId &&
      optIn.lunaVariantId === input.lunaVariantId &&
      optIn.supplierSku === input.supplierSku &&
      optIn.sourceFingerprint === input.sourceFingerprint &&
      SHA256.test(String(optIn.evidenceDigest ?? "")) &&
      Number.isFinite(date(optIn.observedAt)) &&
      date(optIn.observedAt) <= now && date(optIn.freshUntil) > now &&
      fractional(optIn.rateFraction) !== null
    promotedListings = exact ? { state: "CONFIGURED",
      ratePercent: Number(optIn.rateFraction) * 100, basis: "SALE_PRICE",
      reason: "OWNER_EXACT_CANDIDATE_PROMOTION_OPT_IN",
      provenance: optIn.evidenceDigest } : { state: "UNKNOWN" }
  }
  let otherExplicitCosts: R = { ...other }
  if (input.additionalCostEvidence !== undefined &&
      input.additionalCostEvidence !== null) {
    const cost = record(input.additionalCostEvidence)
    const exact = cost.status === "PROVEN" &&
      cost.source === "OWNER_EXPLICIT_OTHER_COST_V1" &&
      cost.marketplaceAccountKey === input.marketplaceAccountKey &&
      cost.lunaProductId === input.lunaProductId &&
      cost.lunaVariantId === input.lunaVariantId &&
      cost.supplierSku === input.supplierSku &&
      cost.sourceFingerprint === input.sourceFingerprint &&
      SHA256.test(String(cost.evidenceDigest ?? "")) &&
      Number.isFinite(date(cost.observedAt)) &&
      date(cost.observedAt) <= now && date(cost.freshUntil) > now &&
      typeof cost.amountUsd === "number" &&
      Number.isFinite(cost.amountUsd) && cost.amountUsd >= 0
    otherExplicitCosts = exact ? { state: "CONFIGURED",
      amountUsd: cost.amountUsd,
      reason: "OWNER_EXACT_CANDIDATE_ADDITIONAL_COST",
      provenance: cost.evidenceDigest } : { state: "UNKNOWN" }
  }
  return Object.freeze({ ...policy, status: "PROVEN" as const,
    promotedListings, otherExplicitCosts,
    returnsReserve: { ...returns,
      ratePercent: Number(returns.rateFraction) * 100 },
    profitabilityGates: { ...gates,
      minNetMarginPercent: Number(gates.minNetMarginFraction) * 100,
      minRoiPercent: Number(gates.minRoiFraction) * 100 } })
}
