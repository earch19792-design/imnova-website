import { consumeListingFeeAuthorityV1, LISTING_FEE_AUTHORITY_V1,
  REQUIRED_FEE_COMPONENTS_V1 } from "./listing-fee-authority-v1"

export const LISTING_FEE_RESOLVER_V1 = "SELLER_OS_CATEGORY_PRE_SALE_FEE_RESOLVER_V1"
type R = Record<string, unknown>
const record = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const records = (v: unknown): R[] => Array.isArray(v) ? v.map(record) : []
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const rate = (v: unknown): v is number => money(v) && v <= 100
const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const includes = (v: unknown, key: unknown) => Array.isArray(v) && v.length <= 100 && v.includes(key)
function official(v: unknown) {
  if (!text(v)) return false
  try { const u = new URL(v); return u.protocol === "https:" &&
    (u.hostname === "ebay.com" || u.hostname.endsWith(".ebay.com")) } catch { return false }
}
function validEvidence(e: R, now: number) {
  return e.status === "PROVEN" && official(e.source) && text(e.sourceVersion) && text(e.reference) &&
    text(e.observedAt) && Date.parse(e.observedAt) <= now && text(e.freshUntil) && Date.parse(e.freshUntil) > now
}
function effective(e: R, now: number) {
  return text(e.effectiveFrom) && Date.parse(e.effectiveFrom) <= now &&
    text(e.effectiveUntil) && Date.parse(e.effectiveUntil) > now
}

/** Policies and applicability evidence must come from the trusted durable evidence
 * path, never from an operator-supplied rate or an inferred product title.
 * No implicit default category, Store tier, date, surcharge or tax exists here.
 */
export function resolveListingPreSaleFeesV1(input: { accountKey: string; itemId: string;
  categoryId: string | null; salePrice: number | null; now: Date; bundle: unknown }) {
  const bundle = record(input.bundle), context = record(bundle.context), basis = record(bundle.basis)
  const now = input.now.getTime(), blockers: string[] = []
  const contextValid = validEvidence(context, now) && effective(context, now) &&
    context.marketplaceAccountKey === input.accountKey && context.marketplace === "EBAY_US" &&
    context.itemId === input.itemId && input.categoryId !== null && context.categoryId === input.categoryId &&
    text(context.categoryReference) && text(context.storeReference) && text(context.formatReference) &&
    context.currency === "USD" && text(context.saleFormat) && text(context.storeLevel)
  if (!contextValid) blockers.push("FEE_ACCOUNT_CATEGORY_FORMAT_STORE_CONTEXT_UNPROVEN")
  const allPolicies = records(bundle.policies)
  const matching = allPolicies.filter(p => includes(p.categoryIds, input.categoryId) &&
    p.marketplace === context.marketplace && p.currency === "USD" &&
    (p.marketplaceAccountKey === undefined || p.marketplaceAccountKey === input.accountKey) &&
    (p.itemId === undefined || p.itemId === input.itemId) && includes(p.saleFormats, context.saleFormat) &&
    includes(p.storeLevels, context.storeLevel) && effective(p, now))
  const policy = matching.length === 1 ? matching[0] : {}
  const policyValid = contextValid && allPolicies.length <= 32 && matching.length === 1 && validEvidence(policy, now)
  if (!policyValid) blockers.push(matching.length > 1 ? "FEE_POLICY_AMBIGUOUS" : "OFFICIAL_CATEGORY_FEE_POLICY_UNPROVEN")
  // V1 handles one item/unit per order. It never duplicates a per-order fee across a cart.
  if (basis.quantity !== 1 || basis.orderItemCount !== 1) blockers.push("FEE_MULTI_ITEM_ALLOCATION_UNPROVEN")
  const amounts = [basis.itemPrice, basis.buyerShipping, basis.handling, basis.buyerTax]
  const basisValid = validEvidence(basis, now) && basis.marketplaceAccountKey === input.accountKey &&
    basis.itemId === input.itemId && basis.categoryId === input.categoryId && basis.currency === "USD" && amounts.every(money) &&
    basis.itemPrice === input.salePrice && money(input.salePrice) &&
    ["EXACT_SCENARIO", "PROVEN_UPPER_BOUND"].includes(String(basis.method)) && text(basis.scenarioReference) &&
    money(basis.amount) && basis.amount === cents(amounts.reduce<number>((s, v) => s + Number(v), 0))
  if (!basisValid) blockers.push("TOTAL_FEE_BASIS_UNPROVEN")
  const components: R[] = []
  const add = (type: string, amount: number, evidence: R, extra: R = {}) => components.push({
    type, status: "PROVEN", amount: cents(amount), source: evidence.source,
    sourceVersion: evidence.sourceVersion, reference: evidence.reference, ...extra,
  })
  if (policyValid && basisValid && basis.quantity === 1 && basis.orderItemCount === 1) {
    const tiers = records(policy.tiers)
    const tiersValid = tiers.length > 0 && tiers.length <= 10 &&
      tiers.every((t, i) => rate(t.ratePct) &&
        (i === tiers.length - 1 ? t.upTo === null : money(t.upTo) && t.upTo > 0) &&
        (i === 0 || t.upTo === null || Number(t.upTo) > Number(tiers[i - 1].upTo)))
    const amount = Number(basis.amount)
    if (tiersValid && ["MARGINAL", "WHOLE_AMOUNT"].includes(String(policy.tierMethod))) {
      let charge = 0, lower = 0
      if (policy.tierMethod === "WHOLE_AMOUNT") {
        const tier = tiers.find(t => t.upTo === null || amount <= Number(t.upTo))!
        charge = amount * Number(tier.ratePct) / 100
      } else for (const tier of tiers) {
        const upper = tier.upTo === null ? amount : Number(tier.upTo)
        charge += Math.max(0, Math.min(amount, upper) - lower) * Number(tier.ratePct) / 100
        lower = upper
      }
      add("FINAL_VALUE_PERCENT", charge, policy, { ratePct: amount > 0 ? charge / amount * 100 : 0,
        basisAmount: amount, tiers, tierMethod: policy.tierMethod })
    }
    const fixed = record(policy.perOrder)
    if (money(fixed.threshold) && money(fixed.atOrBelow) && money(fixed.above)) {
      add("PER_ORDER", amount <= fixed.threshold ? fixed.atOrBelow : fixed.above, policy)
    }
    const adjustments = records(bundle.adjustments)
    if (adjustments.length > 16 || adjustments.some(a =>
      !REQUIRED_FEE_COMPONENTS_V1.slice(2).includes(a.type as typeof REQUIRED_FEE_COMPONENTS_V1[2]))) {
      blockers.push("FEE_ADJUSTMENT_CONTRACT_INVALID")
    }
    for (const type of REQUIRED_FEE_COMPONENTS_V1.slice(2)) {
      const matches = adjustments.filter(a => a.type === type)
      if (matches.length !== 1) continue
      const a = matches[0]
      if (!validEvidence(a, now) || !effective(a, now) || a.marketplaceAccountKey !== input.accountKey ||
          a.itemId !== input.itemId || a.categoryId !== input.categoryId || a.currency !== "USD" ||
          a.scenarioReference !== basis.scenarioReference || !text(a.applicabilityEvidence)) continue
      if (a.applicability === "NOT_APPLICABLE") {
        // An explicit zero decision still needs current official applicability evidence.
        if (a.amount !== 0) continue
        add(type, 0, a, { status: "NOT_APPLICABLE", applicabilityEvidence: a.applicabilityEvidence })
      } else if (a.applicability === "APPLICABLE" && money(a.amount)) {
        // Rate components must prove their own basis; tax on fees is not buyer sales tax.
        if (a.ratePct !== undefined && (!rate(a.ratePct) || !money(a.basisAmount) ||
          cents(a.basisAmount * a.ratePct / 100) !== a.amount)) continue
        add(type, a.amount, a, { applicabilityEvidence: a.applicabilityEvidence,
          ratePct: a.ratePct, basisAmount: a.basisAmount })
      }
    }
    const seller = components.find(c => c.type === "SELLER_PERFORMANCE")
    const service = components.find(c => c.type === "SERVICE_METRICS")
    if (Number(seller?.amount) > 0 && Number(service?.amount) > 0) blockers.push("MUTUALLY_EXCLUSIVE_SURCHARGES_STACKED")
  }
  const unknown = REQUIRED_FEE_COMPONENTS_V1.filter(t => !components.some(c => c.type === t))
  blockers.push(...unknown.map(t => `FEE_COMPONENT_UNPROVEN:${t}`))
  const candidate = { contractVersion: LISTING_FEE_AUTHORITY_V1, evidenceClass: "PRE_SALE_FEE_ESTIMATE",
    marketplaceAccountKey: input.accountKey, marketplace: "EBAY_US", itemId: input.itemId,
    categoryId: input.categoryId, saleFormat: context.saleFormat, storeLevel: context.storeLevel,
    storeContextReference: context.storeReference, accountContextReference: context.reference,
    source: policy.source, sourceVersion: policy.sourceVersion,
    reference: `${LISTING_FEE_RESOLVER_V1}:${String(policy.reference)}:${String(basis.reference)}:${input.itemId}`,
    observedAt: input.now.toISOString(), freshUntil: new Date(Math.min(...[
      context, policy, basis, ...records(bundle.adjustments),
    ].flatMap(e => [Date.parse(String(e.freshUntil)), ...(e.effectiveUntil ? [Date.parse(String(e.effectiveUntil))] : [])])
      .filter(Number.isFinite), now + 86400000)).toISOString(),
    amount: cents(components.reduce((s, c) => s + Number(c.amount), 0)), components,
    feeBasis: { status: "PROVEN", reference: basis.reference, amount: basis.amount, salePrice: input.salePrice,
      method: basis.method, scenarioReference: basis.scenarioReference,
      coveredComponents: ["ITEM_PRICE", "BUYER_SHIPPING", "HANDLING", "BUYER_TAX"], adBasisCovered: basis.adBasisCovered === true } }
  const checked = consumeListingFeeAuthorityV1({ ...input, metadata: { feeAuthorityV1: candidate } })
  const proven = blockers.length === 0 && checked.status === "PROVEN"
  return { contractVersion: LISTING_FEE_RESOLVER_V1, status: proven ? "PROVEN" : "NEEDS_EVIDENCE",
    authority: proven ? candidate : null, amount: proven ? checked.amount : null,
    categorySpecificFeeResolution: true, globalFlatFeeRate: false,
    officialCategoryFeePolicyBound: policyValid,
    accountSurchargeContextResolved: ["SELLER_PERFORMANCE", "SERVICE_METRICS"].every(t => !unknown.includes(t as typeof unknown[number])) &&
      !blockers.includes("MUTUALLY_EXCLUSIVE_SURCHARGES_STACKED"),
    unknownMaterialFeeComponentCount: unknown.length,
    blockers: [...new Set([...blockers, ...(proven ? [] : checked.blockers)])],
    actualFeesSubstitutedForCurrentAuthority: false, marketplaceWrites: 0, ebayAdsWrites: 0 }
}

/** Called on normal Mayel reads. New durable evidence re-evaluates automatically,
 * with no network request, polling, persistence or legacy-rate fallback. */
export function resolveDurableListingFeeMetadataV1(input: Omit<Parameters<typeof resolveListingPreSaleFeesV1>[0], "bundle"> & { metadata: unknown }) {
  const metadata = record(input.metadata)
  if (!Object.hasOwn(metadata, "feeResolutionInputsV1")) return { metadata, resolution: null }
  const resolution = resolveListingPreSaleFeesV1({ ...input, bundle: metadata.feeResolutionInputsV1 })
  // An incomplete newer bundle must not fall back to an older successful amount.
  return { metadata: { ...metadata, feeAuthorityV1: resolution.authority }, resolution }
}
