import type { ExactProductMarketCandidateV1,
  ExactProductVisualAiEvaluationV1 } from "./exact-product-visual-matcher-v1"

export const TOP_SELLER_FIELD_CONSENSUS_V1 =
  "TOP_SELLER_FIELD_CONSENSUS_V1" as const

export const MARKETPLACE_SEMANTIC_FIELDS = Object.freeze(new Set([
  "type", "form factor", "department", "style", "features",
  "connectivity", "compatible brand", "compatible model",
]))
export const STRICT_PRODUCT_FACT_FIELDS = Object.freeze(new Set([
  "brand", "model", "dimensions", "item dimensions", "color", "material",
  "size", "item height", "item length", "item width",
]))

type IdentityClassification = "EXACT_PRODUCT_MATCH" |
  "STRONG_EXACT_MATCH" | "FAMILY_ONLY" | "REJECTED"

export type ClassifiedMarketCandidateV1 = Readonly<{
  candidate: ExactProductMarketCandidateV1
  classification: IdentityClassification
  physicalIdentityConfidence: "HIGH" | "LOW" | "REJECTED"
  conflictCount: number
  lunaVisibleBrandText?: string | null
  candidateVisibleBrandText?: string | null
}>

type JsonRecord = Record<string, unknown>

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return text(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function stem(value: string) {
  if (value.endsWith("ies") && value.length > 5) return `${value.slice(0, -3)}y`
  if (value.endsWith("s") && value.length > 4) return value.slice(0, -1)
  return value
}

const CONCEPT_ALIASES: Record<string, string> = {
  microphones: "microphone", mic: "microphone", mics: "microphone",
  lavalier: "lapel", earbuds: "earbud", earphones: "earbud",
  headphones: "headphone", strips: "strip", televisions: "tv",
  television: "tv", childrens: "children", child: "children",
  boys: "boy", girls: "girl", mens: "men", womens: "women",
}

const SEMANTIC_STOP = new Set([
  "a", "an", "and", "for", "from", "in", "of", "on", "the", "to",
  "with", "other", "product", "item", "type", "style",
])

function conceptTokens(value: unknown) {
  return normalized(value).split(/\s+/).filter(Boolean).map(stem)
    .map((token) => CONCEPT_ALIASES[token] ?? token)
    .filter((token) => token.length > 1 && !SEMANTIC_STOP.has(token))
}

function number(value: unknown) {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : 0
}

function aspectValue(candidate: ExactProductMarketCandidateV1, name: string) {
  const target = normalized(name)
  const aliases = target === "type" ? new Set(["type", "product type"])
    : target === "dimensions" ? new Set([
      "dimensions", "item dimensions", "product dimensions"])
      : target === "compatible brand" ? new Set([
        "compatible brand", "compatible brands"])
        : new Set([target])
  const aspect = candidate.aspects.find((entry) =>
    aliases.has(normalized(entry.name)))
  if (aspect) return text(aspect.value, 500)
  if (target === "brand") return text(candidate.brand, 160)
  if (target === "model") return text(candidate.model ?? candidate.mpn, 160)
  if (target === "material") return candidate.material[0] ?? null
  if (target === "color") return candidate.colorOrVariant[0] ?? null
  if (["size", "dimensions", "item dimensions"].includes(target)) {
    return candidate.dimensions[0] ?? null
  }
  return null
}

function recencyWeight(value: unknown, now: Date) {
  const parsed = Date.parse(String(value ?? ""))
  if (!Number.isFinite(parsed)) return .6
  const days = Math.max(0, (now.getTime() - parsed) / 86_400_000)
  return days <= 30 ? 1 : days <= 90 ? .85 : days <= 365 ? .7 : .5
}

function commercialWeight(entry: ClassifiedMarketCandidateV1, now: Date) {
  const identity = entry.classification === "EXACT_PRODUCT_MATCH" ? 1 : .82
  const sold = number(entry.candidate.soldVolume)
  const velocity = number(entry.candidate.salesVelocity)
  return (1 + sold * 4 + velocity * 2) * identity
    * recencyWeight(entry.candidate.observedAt, now)
}

function exactCluster(entries: readonly ClassifiedMarketCandidateV1[]) {
  return entries.filter((entry) => entry.conflictCount === 0
    && ["EXACT_PRODUCT_MATCH", "STRONG_EXACT_MATCH"]
      .includes(entry.classification))
}

function productTruthSupport(input: Readonly<{
  fieldName: string
  candidateValue: string
  exactEvidence: readonly Readonly<{ sourceField: string, text: string }>[]
}>) {
  const field = normalized(input.fieldName)
  const valueTokens = [...new Set(conceptTokens(input.candidateValue))]
  if (!valueTokens.length) return null
  for (const source of input.exactEvidence) {
    const sourceTokens = new Set(conceptTokens(source.text))
    const matched = valueTokens.filter((token) => sourceTokens.has(token))
    const direct = normalized(source.text).includes(normalized(
      input.candidateValue))
    const enough = direct || matched.length >= Math.max(1,
      Math.ceil(valueTokens.length * .5))
    if (!enough) continue
    // Department is sensitive to audience. It requires the exact audience
    // word, rather than a category-level assumption (for example Spider-Man
    // does not by itself mean Boys or Kids).
    if (field === "department" && !valueTokens.every((token) =>
      sourceTokens.has(token))) continue
    // Compatible Brand must be expressed as compatibility/replacement truth,
    // never merely as the product's own brand.
    if (field === "compatible brand") {
      const normalizedSource = normalized(source.text)
      if (!/(compatible|replacement|universal|works with|for )/.test(
        normalizedSource)) continue
    }
    return Object.freeze({ sourceField: source.sourceField,
      sourceExcerpt: text(source.text, 500)! })
  }
  return null
}

function consensusForField(input: Readonly<{
  fieldName: string
  cluster: readonly ClassifiedMarketCandidateV1[]
  now: Date
}>) {
  const votes = new Map<string, { value: string, weight: number,
    references: Set<string>, sellers: Set<string>, soldVolume: number,
    salesVelocity: number }>()
  for (const entry of input.cluster) {
    const value = aspectValue(entry.candidate, input.fieldName)
    if (!value) continue
    const key = normalized(value)
    const current = votes.get(key) ?? { value, weight: 0,
      references: new Set(), sellers: new Set(), soldVolume: 0,
      salesVelocity: 0 }
    current.weight += commercialWeight(entry, input.now)
    current.references.add(entry.candidate.candidateReference)
    if (entry.candidate.sellerReference) {
      current.sellers.add(entry.candidate.sellerReference)
    }
    current.soldVolume += number(entry.candidate.soldVolume)
    current.salesVelocity += number(entry.candidate.salesVelocity)
    votes.set(key, current)
  }
  const ranked = [...votes.values()].sort((left, right) =>
    right.weight - left.weight || right.soldVolume - left.soldVolume
    || right.salesVelocity - left.salesVelocity
    || left.value.localeCompare(right.value))
  const totalWeight = ranked.reduce((sum, vote) => sum + vote.weight, 0)
  const winner = ranked[0] ?? null
  const share = winner && totalWeight > 0 ? winner.weight / totalWeight : 0
  // One commercially successful seller is a useful primary reference, but it
  // is not a field consensus. Mapping requires at least two independent exact
  // listing references (and therefore cannot be created by volume alone).
  const sufficient = Boolean(winner && share >= .7
    && winner.references.size >= 2 && winner.sellers.size >= 2)
  return Object.freeze({ winner, share: Number(share.toFixed(4)),
    sufficient, conflictingValueCount: Math.max(0, ranked.length - 1),
    weightedValues: Object.freeze(ranked.map((vote) => ({
      value: vote.value, weight: Number(vote.weight.toFixed(4)),
      soldVolume: vote.soldVolume, salesVelocity: vote.salesVelocity,
      referenceCount: vote.references.size,
    }))) })
}

export function resolveTopSellerMarketplaceFieldMappingV1(input: Readonly<{
  classifiedCandidates: readonly ClassifiedMarketCandidateV1[]
  residualSpecificNames: readonly string[]
  exactEvidence: readonly Readonly<{ sourceField: string, text: string }>[]
  existingProductTruth: Readonly<Record<string, string>>
  officialAllowedValues?: Readonly<Record<string, readonly string[]>>
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const cluster = exactCluster(input.classifiedCandidates)
  const rankedReferences = [...cluster].sort((left, right) =>
    commercialWeight(right, now) - commercialWeight(left, now)
    || right.candidate.soldVolume - left.candidate.soldVolume
    || right.candidate.salesVelocity - left.candidate.salesVelocity
    || left.candidate.candidateReference.localeCompare(
      right.candidate.candidateReference))
  const commercialReferences = rankedReferences.filter((entry) =>
    entry.candidate.soldVolume > 0 || entry.candidate.salesVelocity > 0)
  // PRIMARY_REFERENCE has a reporting and audit contract that requires the
  // official eBay item ID. A durable hashed reference can retain sold evidence
  // in the top set, but must not be mislabeled as the primary listing.
  const primary = commercialReferences.find((entry) =>
    Boolean(entry.candidate.itemId)) ?? null
  const topReferenceSet = (commercialReferences.length
    ? commercialReferences : rankedReferences).slice(0, 5)
  const semanticMappings: Array<Readonly<{
    specificName: string
    resolvedValue: string
    productTruthSemanticSupport: true
    sourceField: string
    sourceExcerpt: string
    consensusShare: number
    topSellerFieldConsensusSufficient: true
    factInvented: false
  }>> = []
  const strictPromotions: Record<string, string> = {}
  const fieldConsensus: JsonRecord[] = []
  const strictFactsCorroborated = new Set<string>()

  for (const name of input.residualSpecificNames) {
    const field = normalized(name)
    if (![...MARKETPLACE_SEMANTIC_FIELDS, ...STRICT_PRODUCT_FACT_FIELDS]
      .includes(field)) continue
    const consensus = consensusForField({ fieldName: name, cluster, now })
    const rawValue = consensus.winner?.value ?? null
    const allowed = Object.entries(input.officialAllowedValues ?? {})
      .find(([candidate]) => normalized(candidate) === field)?.[1] ?? []
    const resolvedValue = rawValue && allowed.length
      ? allowed.find((value) => normalized(value) === normalized(rawValue))
        ?? null : rawValue
    fieldConsensus.push({ specificName: name,
      selectedValue: resolvedValue, consensusShare: consensus.share,
      sufficient: consensus.sufficient,
      conflictingValueCount: consensus.conflictingValueCount,
      weightedValues: consensus.weightedValues })
    if (!resolvedValue || !consensus.sufficient) continue
    if (MARKETPLACE_SEMANTIC_FIELDS.has(field)) {
      const support = productTruthSupport({ fieldName: name,
        candidateValue: resolvedValue, exactEvidence: input.exactEvidence })
      if (support) semanticMappings.push(Object.freeze({
        specificName: name, resolvedValue,
        productTruthSemanticSupport: true as const,
        sourceField: support.sourceField,
        sourceExcerpt: support.sourceExcerpt,
        consensusShare: consensus.share,
        topSellerFieldConsensusSufficient: true as const,
        factInvented: false as const,
      }))
      continue
    }
    const existing = Object.entries(input.existingProductTruth).find(
      ([candidate]) => normalized(candidate) === field)?.[1]
    if (existing) {
      if (normalized(existing) === normalized(resolvedValue)) {
        strictFactsCorroborated.add(field)
      }
      // Marketplace evidence may corroborate or normalize an existing strict
      // fact, but it can never overwrite contradictory Product Truth.
      continue
    }
    if (field !== "brand" || normalized(resolvedValue) === "unbranded"
        || normalized(resolvedValue) === "does not apply"
        || cluster.length < 2) continue
    const visibleLunaBrands = cluster.flatMap((entry) => {
      const value = text(entry.lunaVisibleBrandText, 120)
      return value ? [value] : []
    })
    const visibleCandidateConflicts = cluster.some((entry) => {
      const value = text(entry.candidateVisibleBrandText, 120)
      return Boolean(value && normalized(value) !== normalized(resolvedValue))
    })
    const declaredMarketBrandConflict = cluster.some((entry) => {
      const value = text(entry.candidate.brand, 120)
      return Boolean(value && normalized(value) !== normalized(resolvedValue))
    })
    if (!visibleCandidateConflicts && !declaredMarketBrandConflict
        && visibleLunaBrands.some((value) =>
      normalized(value) === normalized(resolvedValue))) {
      strictPromotions[name] = resolvedValue
    }
  }

  // Corroboration is also reported for strict facts already certified, but it
  // never rewrites them.
  for (const [name, existing] of Object.entries(input.existingProductTruth)) {
    if (!STRICT_PRODUCT_FACT_FIELDS.has(normalized(name))) continue
    const consensus = consensusForField({ fieldName: name, cluster, now })
    if (consensus.sufficient && normalized(consensus.winner?.value)
        === normalized(existing)) strictFactsCorroborated.add(normalized(name))
  }

  const marketIdentifierCandidates = cluster.flatMap((entry) => [
    entry.candidate.gtin ? { identifierType: "UPC_EAN",
      candidateValue: entry.candidate.gtin } : null,
    entry.candidate.mpn ? { identifierType: "MPN",
      candidateValue: entry.candidate.mpn } : null,
  ].flatMap((value) => value ? [{ ...value,
    sourceReference: entry.candidate.candidateReference,
    promotionToProductTruthAllowed: false as const,
    officialCategoryPolicyRequired: true as const }] : []))

  return Object.freeze({ contractVersion: TOP_SELLER_FIELD_CONSENSUS_V1,
    physicalIdentitySeparatedFromMarketplaceFieldInterpretation: true as const,
    exactProductClusterCount: cluster.filter((entry) =>
      entry.classification === "EXACT_PRODUCT_MATCH").length,
    strongProductClusterCount: cluster.filter((entry) =>
      entry.classification === "STRONG_EXACT_MATCH").length,
    primaryReference: primary ? Object.freeze({
      itemId: primary.candidate.itemId,
      soldVolume: primary.candidate.soldVolume,
      salesVelocity: primary.candidate.salesVelocity,
      identityClass: primary.classification,
    }) : null,
    topReferenceSet: Object.freeze(topReferenceSet.map((entry) => ({
      itemId: entry.candidate.itemId,
      candidateReference: entry.candidate.candidateReference,
      soldVolume: entry.candidate.soldVolume,
      salesVelocity: entry.candidate.salesVelocity,
      identityClass: entry.classification,
    }))),
    fieldConsensus: Object.freeze(fieldConsensus),
    semanticMappings: Object.freeze(semanticMappings),
    strictPromotions: Object.freeze(strictPromotions),
    strictFactsCorroborated: strictFactsCorroborated.size,
    marketIdentifierCandidates: Object.freeze(marketIdentifierCandidates),
    productTruthOverrideBySeller: false as const,
    familyEvidencePromotedToProductTruth: false as const,
    conditionFromSoldEvidenceAllowed: false as const,
    identifiersRequireOfficialCategoryPolicy: true as const,
    factInvented: false as const,
  })
}

// Kept as an explicit type-level bridge for callers that store sanitized AI
// comparisons separately from marketplace mapping evidence.
export function visualEvaluationsByCandidateV1(
  evaluations: readonly ExactProductVisualAiEvaluationV1[],
) {
  return new Map(evaluations.map((entry) => [entry.candidateReference, entry]))
}
