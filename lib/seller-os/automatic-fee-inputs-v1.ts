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
