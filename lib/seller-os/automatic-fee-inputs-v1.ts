const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}

/** Assemble inputs on the normal producer path. Package/official evidence may
 * precede the first economic observation: a previous listing fee row is not
 * required. Exact item-bound evidence is never copied from another listing.
 * Missing order exposure stays missing; an official rate alone is no bound. */
export function automaticFeeResolutionInputsV1(input: { context: unknown; packageData?: unknown; previousMetadata?: unknown }) {
  const c = record(input.context), p = record(input.packageData), previous = record(input.previousMetadata)
  // A newer incomplete handoff deliberately invalidates an older successful one.
  const supplied = Object.hasOwn(c, "feeResolutionInputsV1") ? c.feeResolutionInputsV1 :
    Object.hasOwn(p, "feeResolutionInputsV1") ? p.feeResolutionInputsV1 : previous.feeResolutionInputsV1
  const bundle = record(supplied), identity = record(c.identity), listing = record(c.listing)
  const policy = record(record(c.categoryFeePolicy).policy), store = record(c.resolvedStoreContext)
  const context = { status: "PROVEN", marketplaceAccountKey: c.marketplaceAccountKey, marketplace: identity.marketplace,
    itemId: identity.itemId, categoryId: listing.categoryId, currency: listing.currency ?? policy.currency,
    saleFormat: listing.saleFormat, storeLevel: store.storeSubscriptionLevel,
    source: policy.source, sourceVersion: policy.sourceVersion,
    reference: policy.reference, categoryReference: policy.reference,
    storeReference: store.source, formatReference: policy.reference,
    observedAt: c.observedAt, freshUntil: policy.freshUntil,
    effectiveFrom: policy.effectiveFrom, effectiveUntil: policy.effectiveUntil }
  // Do not overwrite a supplied, mismatching scope: the resolver must reject it.
  return { ...bundle, context: Object.hasOwn(bundle, "context") ? bundle.context : context,
    policies: policy.reference ? [policy] : [],
    automaticInputAssembly: true, previousListingFeeRequired: false }
}

/** Fill missing adjustments from current official producer decisions. Never
 * overwrite supplied contradictory evidence or invent a missing tax/basis bound. */
export function completeAutomaticFeeAdjustmentsV1(input: { bundle: ReturnType<typeof automaticFeeResolutionInputsV1>;
  components: { type: string; amount: number | null; source: string; rateOrAmount: unknown; pendingDependency: string | null }[];
  now: Date }) {
  const b = input.bundle as Record<string, unknown>, context = record(b.context), basis = record(b.basis)
  const adjustments = Array.isArray(b.adjustments) ? [...b.adjustments].map(record) : []
  const coverage = Array.isArray(b.boundCoverage) ? [...b.boundCoverage].map(record) : []
  if (basis.method !== "PROVEN_UPPER_BOUND" || basis.status !== "PROVEN" ||
    typeof basis.amount !== "number" || !Number.isFinite(basis.amount) || basis.amount < 0 ||
    basis.marketplaceAccountKey !== context.marketplaceAccountKey || basis.itemId !== context.itemId ||
    basis.categoryId !== context.categoryId || !basis.scenarioReference ||
    !(Date.parse(String(basis.freshUntil)) > input.now.getTime())) return input.bundle
  for (const c of input.components.filter(c => !["FINAL_VALUE_PERCENT", "PER_ORDER"].includes(c.type))) {
    if (adjustments.some(a => a.type === c.type)) continue
    let amount = c.amount
    // A published rate ceiling becomes a monetary bound only after the complete
    // future order basis is separately bounded. Exchange exposure is excluded.
    const rate = record(c.rateOrAmount).maximumRatePct
    if (amount === null && ["SERVICE_METRICS", "INTERNATIONAL"].includes(c.type) && typeof rate === "number" &&
      Number.isFinite(rate) && rate >= 0 && rate <= 100) amount = Math.ceil((basis.amount * rate / 100 - 1e-9) * 100) / 100
    if (amount === null) continue
    adjustments.push({ ...context, type: c.type, amount, source: c.source,
      applicability: amount === 0 ? "NOT_APPLICABLE" : "APPLICABLE", scenarioReference: basis.scenarioReference,
      applicabilityEvidence: `${context.reference}:${c.type}:${amount === 0 ? "CURRENT_NOT_APPLICABLE" : "OFFICIAL_MONETARY_BOUND"}` })
    const risk = c.type === "INTERNATIONAL" ? "INTERNATIONAL_APPLICABILITY" : c.type
    if (["INTERNATIONAL_APPLICABILITY", "CURRENCY_CONVERSION", "TAX_ON_FEES"].includes(risk) && !coverage.some(x => x.component === risk))
      coverage.push({ ...context, source: c.source, component: risk, maximumAmount: amount,
        scenarioReference: basis.scenarioReference, coversAllEligibleOrders: true })
  }
  return { ...input.bundle, adjustments, boundCoverage: coverage }
}
