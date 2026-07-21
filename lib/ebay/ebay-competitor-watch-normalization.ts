type ActiveCompetitorObservation = {
  itemReferenceHash: string
  identityMatchQuality: "EXACT_IDENTIFIER" | "EXACT" | "STRONG"
  evidenceClass: "ACTIVE_ONLY" | "ESTIMATED_ACTIVITY"
  packQuantity: number | null
  imageCount: number | null
  estimatedSoldQuantity: number
}

function positiveIntegerOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function nonnegativeIntegerOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function observationPriority(value: ActiveCompetitorObservation) {
  const evidence = value.evidenceClass === "ESTIMATED_ACTIVITY" ? 3 : 0
  const identity = value.identityMatchQuality === "EXACT_IDENTIFIER"
    ? 3
    : value.identityMatchQuality === "EXACT" ? 2 : 1
  return evidence * 1_000_000 + Math.max(0, Math.trunc(value.estimatedSoldQuantity)) * 10 + identity
}

/**
 * Browse can return multiple variations of one legacy Item ID. The watch
 * schema intentionally fingerprints that stable legacy ID so Product Research
 * can reconcile it later; collapse those variations before persistence.
 */
export function normalizeEbayActiveCompetitorObservations<
  T extends ActiveCompetitorObservation,
>(values: readonly T[]): T[] {
  const byItem = new Map<string, T>()
  for (const value of values) {
    const normalized = {
      ...value,
      packQuantity: positiveIntegerOrNull(value.packQuantity),
      imageCount: nonnegativeIntegerOrNull(value.imageCount),
      estimatedSoldQuantity: Math.max(0, Math.trunc(Number(value.estimatedSoldQuantity) || 0)),
    } as T
    const previous = byItem.get(normalized.itemReferenceHash)
    if (!previous || observationPriority(normalized) > observationPriority(previous)) {
      byItem.set(normalized.itemReferenceHash, normalized)
    }
  }
  return [...byItem.values()]
}
