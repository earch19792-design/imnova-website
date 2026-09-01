export type SellerOsQuickPickPresentationIdentityV1 = Readonly<{
  sourceUrl: string
  canonicalUrl?: string | null
  sourceSku?: string | null
  lunaProductId?: string | null
  lunaVariantId?: string | null
  opportunityId?: string | null
  candidateKey?: string | null
  stages?: Readonly<Record<string, unknown>>
}>

function normalizedOperationUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    parsed.hash = ""
    parsed.searchParams.sort()
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/"
    return parsed.toString()
  } catch {
    return value
  }
}

function identityAliases(value: SellerOsQuickPickPresentationIdentityV1) {
  const sourceUrl = normalizedOperationUrl(value.sourceUrl)
  const canonicalUrl = normalizedOperationUrl(value.canonicalUrl)
  return new Set([
    value.opportunityId ? `opportunity:${value.opportunityId}` : null,
    value.candidateKey ? `candidate:${value.candidateKey}` : null,
    value.lunaProductId && value.lunaVariantId && value.sourceSku
      ? `supplier:${value.lunaProductId}:${value.lunaVariantId}:${value.sourceSku}`
      : null,
    sourceUrl ? `source:${sourceUrl}` : null,
    canonicalUrl ? `canonical:${canonicalUrl}` : null,
  ].flatMap((entry) => entry ? [entry] : []))
}

export function mergeSellerOsQuickPickPresentationV1<
  T extends SellerOsQuickPickPresentationIdentityV1>(
  ...collections: ReadonlyArray<readonly T[]>) {
  const merged: T[] = []
  for (const card of collections.flat()) {
    const aliases = identityAliases(card)
    const existingIndex = merged.findIndex((existing) => {
      const existingAliases = identityAliases(existing)
      return [...aliases].some((alias) => existingAliases.has(alias))
    })
    if (existingIndex < 0) {
      merged.push(card)
      continue
    }
    const existing = merged[existingIndex]
    merged[existingIndex] = Object.freeze({ ...existing, ...card,
      stages: Object.freeze({ ...existing.stages, ...card.stages }) }) as T
  }
  return Object.freeze(merged)
}
