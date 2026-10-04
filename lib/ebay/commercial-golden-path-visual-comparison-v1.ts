import { createHash } from "node:crypto"

export const GOLDEN_VISUAL_COMPARISON_EVIDENCE_V1 =
  "SELLER_OS_VISUAL_COMPARISON_EVIDENCE_V1" as const

export const GOLDEN_VISUAL_COMPARISON_POLICY_V1 =
  "SELLER_OS_VISUAL_CLOSE_ONLY_POLICY_V1" as const

export type GoldenVisualSourceRoleV1 =
  | "SUPPLIER_IMAGE"
  | "MARKETPLACE_SOLD_IMAGE"
  | "MARKETPLACE_ACTIVE_IMAGE"

export type GoldenVisualFactClassV1 =
  | "VISIBLE_TEXT"
  | "VISIBLE_LOGO"
  | "VISIBLE_BRAND_MARKING"
  | "OBSERVED_MARKING"
  | "PRODUCT_SHAPE"
  | "COLOR_PATTERN"
  | "HANDLE_DESIGN"
  | "VISIBLE_PACKAGING"
  | "EXPLICIT_OFFER_QUANTITY"

export type GoldenVisualConfidenceV1 = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
export type GoldenVisualOutcomeV1 = "SUPPORTS_CLOSE" | "CONTRADICTS" | "INCONCLUSIVE"

export type GoldenVisualFactV1 = Readonly<{
  factClass: GoldenVisualFactClassV1
  value: string
  confidence: GoldenVisualConfidenceV1
  evidenceStatement: string
}>

export type GoldenVisualSourceObservationV1 = Readonly<{
  sourceRole: GoldenVisualSourceRoleV1
  mediaReference: string
  sourceLocator: string
  sourceDigest: string
  capturedAt: string
  method: "OWNER_REVIEWED" | "MODEL_ASSISTED_OWNER_REVIEW"
  methodVersion: string
  imageWidthPixels: number
  imageHeightPixels: number
  subjectRegionWidthPixels: number
  subjectRegionHeightPixels: number
  cropStatus: "FULL_FRAME" | "CROPPED" | "UNKNOWN"
  facts: ReadonlyArray<GoldenVisualFactV1>
}>

export type GoldenVisualRelationV1 = Readonly<{
  factClass: GoldenVisualFactClassV1
  relation: "MATCH" | "CONFLICT" | "UNPROVEN"
  confidence: GoldenVisualConfidenceV1
  evidenceStatement: string
}>

export type GoldenVisualMarketBindingV1 = Readonly<{
  evidenceId: string
  listingState: "SOLD" | "ACTIVE"
  sourceLocator: string
  sourceDigest: string
}>

export type GoldenVisualCandidateV1 = Readonly<{
  productId: string
  variantId: string
  supplierSku: string
  supplierQuantity: number
}>

export type GoldenVisualComparisonEvidenceV1 = Readonly<{
  schemaVersion: typeof GOLDEN_VISUAL_COMPARISON_EVIDENCE_V1
  policyVersion: typeof GOLDEN_VISUAL_COMPARISON_POLICY_V1
  evidenceId: string
  evidenceDigest: string
  authorityClass: "OWNER_ATTESTED_VISUAL_COMPARISON"
  candidate: GoldenVisualCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  marketEvidenceId: string
  supplierObservation: GoldenVisualSourceObservationV1
  marketplaceObservation: GoldenVisualSourceObservationV1
  relations: ReadonlyArray<GoldenVisualRelationV1>
  outcome: GoldenVisualOutcomeV1
  reasonCodes: ReadonlyArray<string>
  visualSimilaritySupport: boolean
  exactAuthority: false
  manufacturerBrandInferred: false
  offerDifferenceHidden: false
  supplierTruthModified: false
  operatorAttested: true
  marketplaceWrites: 0
  supplierPurchases: 0
  draftIsLive: false
}>

type JsonRecord = Record<string, unknown>

const record = (value: unknown): JsonRecord => value && typeof value === "object"
  && !Array.isArray(value) ? value as JsonRecord : {}

const cleanText = (value: unknown, maximum = 2_000) => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  : ""

const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]))
    : value

const digest = (value: unknown) => `sha256:${createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex")}`

const confidenceRank: Record<GoldenVisualConfidenceV1, number> = {
  UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3,
}

const factClasses: readonly GoldenVisualFactClassV1[] = [
  "VISIBLE_TEXT", "VISIBLE_LOGO", "VISIBLE_BRAND_MARKING",
  "OBSERVED_MARKING", "PRODUCT_SHAPE", "COLOR_PATTERN", "HANDLE_DESIGN",
  "VISIBLE_PACKAGING", "EXPLICIT_OFFER_QUANTITY",
]

const structuralSupportClasses = new Set<GoldenVisualFactClassV1>([
  "PRODUCT_SHAPE", "COLOR_PATTERN", "HANDLE_DESIGN",
])

function canonicalLunaUrl(value: unknown) {
  try {
    const url = new URL(cleanText(value))
    if (url.protocol !== "https:" || !["lunaportex.com", "www.lunaportex.com"]
      .includes(url.hostname) || !/^\/products\/[A-Za-z0-9][A-Za-z0-9._~%+-]*\/?$/
      .test(url.pathname) || url.username || url.password || url.hash) return ""
    url.hostname = "lunaportex.com"
    url.pathname = url.pathname.replace(/\/$/, "")
    url.search = ""
    return url.toString()
  } catch { return "" }
}

function validFact(value: unknown): value is GoldenVisualFactV1 {
  const fact = record(value)
  return factClasses.includes(fact.factClass as GoldenVisualFactClassV1)
    && cleanText(fact.value, 500).length > 0
    && ["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(String(fact.confidence))
    && cleanText(fact.evidenceStatement, 1_000).length >= 12
}

function validateObservation(
  value: GoldenVisualSourceObservationV1,
  expectedRole: GoldenVisualSourceRoleV1,
  now: Date,
) {
  if (value.sourceRole !== expectedRole
    || !cleanText(value.mediaReference, 2_000)
    || !cleanText(value.sourceLocator, 2_000)
    || !/^sha256:[0-9a-f]{64}$/.test(value.sourceDigest)
    || !Number.isFinite(Date.parse(value.capturedAt))
    || Date.parse(value.capturedAt) > now.getTime()
    || !["OWNER_REVIEWED", "MODEL_ASSISTED_OWNER_REVIEW"].includes(value.method)
    || !/^[A-Z][A-Z0-9_.-]{2,119}$/.test(value.methodVersion)
    || ![value.imageWidthPixels, value.imageHeightPixels,
      value.subjectRegionWidthPixels, value.subjectRegionHeightPixels]
      .every(dimension => Number.isSafeInteger(dimension)
        && dimension >= 1 && dimension <= 20_000)
    || value.subjectRegionWidthPixels > value.imageWidthPixels
    || value.subjectRegionHeightPixels > value.imageHeightPixels
    || !["FULL_FRAME", "CROPPED", "UNKNOWN"].includes(value.cropStatus)
    || value.facts.length < 1 || value.facts.length > 20
    || !value.facts.every(validFact)) {
    throw new Error("VISUAL_SOURCE_OBSERVATION_INVALID")
  }
}

function quantity(value: GoldenVisualSourceObservationV1) {
  return value.facts.filter(fact => fact.factClass === "EXPLICIT_OFFER_QUANTITY"
    && fact.confidence === "HIGH").map(fact => Number(fact.value))
    .find(candidate => Number.isSafeInteger(candidate) && candidate >= 1
      && candidate <= 1_000) ?? null
}

function sourceHasFact(source: GoldenVisualSourceObservationV1,
  factClass: GoldenVisualFactClassV1, minimum: GoldenVisualConfidenceV1) {
  return source.facts.some(fact => fact.factClass === factClass
    && confidenceRank[fact.confidence] >= confidenceRank[minimum])
}

function resolveOutcome(input: Readonly<{
  candidate: GoldenVisualCandidateV1
  supplier: GoldenVisualSourceObservationV1
  marketplace: GoldenVisualSourceObservationV1
  relations: ReadonlyArray<GoldenVisualRelationV1>
}>) {
  const marketplaceQuantity = quantity(input.marketplace)
  const explicitMultipackDifference = marketplaceQuantity !== null
    && marketplaceQuantity > input.candidate.supplierQuantity
    && input.candidate.supplierQuantity === 1
  const highQuality = input.supplier.subjectRegionWidthPixels >= 160
    && input.supplier.subjectRegionHeightPixels >= 160
    && input.marketplace.subjectRegionWidthPixels >= 160
    && input.marketplace.subjectRegionHeightPixels >= 160
    && input.supplier.cropStatus === "FULL_FRAME"
    && input.marketplace.cropStatus === "FULL_FRAME"
  const structuralConflict = highQuality && input.relations.some(relation =>
    structuralSupportClasses.has(relation.factClass)
    && relation.relation === "CONFLICT"
    && confidenceRank[relation.confidence] >= confidenceRank.MEDIUM
    && sourceHasFact(input.supplier, relation.factClass, "MEDIUM")
    && sourceHasFact(input.marketplace, relation.factClass, "MEDIUM"))
  if (explicitMultipackDifference) return {
    outcome: "CONTRADICTS" as const,
    reasonCodes: ["MARKETPLACE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN"],
  }
  if (structuralConflict) return {
    outcome: "CONTRADICTS" as const,
    reasonCodes: ["VISUAL_STRUCTURAL_CONTRADICTION"],
  }
  const supportClasses = new Set(input.relations.filter(relation =>
    structuralSupportClasses.has(relation.factClass)
    && relation.relation === "MATCH"
    && confidenceRank[relation.confidence] >= confidenceRank.MEDIUM
    && sourceHasFact(input.supplier, relation.factClass, "MEDIUM")
    && sourceHasFact(input.marketplace, relation.factClass, "MEDIUM"))
    .map(relation => relation.factClass))
  if (highQuality && supportClasses.size >= 2) return {
    outcome: "SUPPORTS_CLOSE" as const,
    reasonCodes: ["VISUAL_SIMILARITY_SUPPORT_CLOSE_ONLY"],
  }
  return {
    outcome: "INCONCLUSIVE" as const,
    reasonCodes: [
      ...(!highQuality ? ["VISUAL_QUALITY_INSUFFICIENT"] : []),
      ...(supportClasses.size < 2 ? ["VISUAL_CORROBORATION_INSUFFICIENT"] : []),
    ],
  }
}

function evidenceCore(value: JsonRecord) {
  const { evidenceId: _id, evidenceDigest: _digest, ...core } = value
  return core
}

export function buildGoldenVisualComparisonEvidenceV1(input: Readonly<{
  candidate: GoldenVisualCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  supplierObservation: GoldenVisualSourceObservationV1
  comparisons: ReadonlyArray<Readonly<{
    marketEvidence: GoldenVisualMarketBindingV1
    marketplaceObservation: GoldenVisualSourceObservationV1
    relations: ReadonlyArray<GoldenVisualRelationV1>
  }>>
  operatorAttested: true
  now: Date
}>) {
  const canonicalUrl = canonicalLunaUrl(input.canonicalUrl)
  if (!/^\d{1,30}$/.test(input.candidate.productId)
    || !/^\d{1,30}$/.test(input.candidate.variantId)
    || !cleanText(input.candidate.supplierSku, 160)
    || !Number.isSafeInteger(input.candidate.supplierQuantity)
    || input.candidate.supplierQuantity < 1 || input.candidate.supplierQuantity > 20
    || !cleanText(input.accountKey, 240) || !cleanText(input.ownerUserId, 80)
    || !/^sha256:[0-9a-f]{64}$/.test(input.sourceFingerprint)
    || !canonicalUrl || input.operatorAttested !== true
    || input.comparisons.length < 1 || input.comparisons.length > 20) {
    throw new Error("VISUAL_COMPARISON_EVIDENCE_INVALID")
  }
  validateObservation(input.supplierObservation, "SUPPLIER_IMAGE", input.now)
  if (canonicalLunaUrl(input.supplierObservation.sourceLocator) !== canonicalUrl) {
    throw new Error("VISUAL_SUPPLIER_SOURCE_BINDING_INVALID")
  }
  return Object.freeze(input.comparisons.map(comparison => {
    const market = comparison.marketEvidence
    const expectedRole = market.listingState === "SOLD"
      ? "MARKETPLACE_SOLD_IMAGE" as const : "MARKETPLACE_ACTIVE_IMAGE" as const
    validateObservation(comparison.marketplaceObservation, expectedRole, input.now)
    if (!cleanText(market.evidenceId, 160)
      || !["SOLD", "ACTIVE"].includes(market.listingState)
      || market.sourceLocator !== comparison.marketplaceObservation.sourceLocator
      || market.sourceDigest !== comparison.marketplaceObservation.sourceDigest
      || !/^sha256:[0-9a-f]{64}$/.test(market.sourceDigest)
      || comparison.relations.length < 1 || comparison.relations.length > 20
      || comparison.relations.some(relation => !factClasses.includes(relation.factClass)
        || !["MATCH", "CONFLICT", "UNPROVEN"].includes(relation.relation)
        || !["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(relation.confidence)
        || cleanText(relation.evidenceStatement, 1_000).length < 12)) {
      throw new Error("VISUAL_MARKET_COMPARISON_BINDING_INVALID")
    }
    const resolution = resolveOutcome({ candidate: input.candidate,
      supplier: input.supplierObservation,
      marketplace: comparison.marketplaceObservation,
      relations: comparison.relations })
    const core = {
      schemaVersion: GOLDEN_VISUAL_COMPARISON_EVIDENCE_V1,
      policyVersion: GOLDEN_VISUAL_COMPARISON_POLICY_V1,
      authorityClass: "OWNER_ATTESTED_VISUAL_COMPARISON" as const,
      candidate: { ...input.candidate }, accountKey: input.accountKey,
      ownerUserId: input.ownerUserId, sourceFingerprint: input.sourceFingerprint,
      canonicalUrl, marketEvidenceId: market.evidenceId,
      supplierObservation: input.supplierObservation,
      marketplaceObservation: comparison.marketplaceObservation,
      relations: Object.freeze([...comparison.relations]),
      outcome: resolution.outcome,
      reasonCodes: Object.freeze(resolution.reasonCodes),
      visualSimilaritySupport: resolution.outcome === "SUPPORTS_CLOSE",
      exactAuthority: false as const, manufacturerBrandInferred: false as const,
      offerDifferenceHidden: false as const, supplierTruthModified: false as const,
      operatorAttested: true as const, marketplaceWrites: 0 as const,
      supplierPurchases: 0 as const, draftIsLive: false as const,
    }
    const evidenceDigest = digest(core)
    return Object.freeze({ ...core, evidenceId: evidenceDigest, evidenceDigest })
  }))
}

export function isGoldenVisualComparisonEvidenceV1(input: Readonly<{
  evidence: unknown
  candidate: GoldenVisualCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  marketEvidence: GoldenVisualMarketBindingV1
  now: Date
}>) {
  const evidence = record(input.evidence)
  const candidate = record(evidence.candidate)
  if (evidence.schemaVersion !== GOLDEN_VISUAL_COMPARISON_EVIDENCE_V1
    || evidence.policyVersion !== GOLDEN_VISUAL_COMPARISON_POLICY_V1
    || evidence.authorityClass !== "OWNER_ATTESTED_VISUAL_COMPARISON"
    || evidence.accountKey !== input.accountKey || evidence.ownerUserId !== input.ownerUserId
    || candidate.productId !== input.candidate.productId
    || candidate.variantId !== input.candidate.variantId
    || candidate.supplierSku !== input.candidate.supplierSku
    || candidate.supplierQuantity !== input.candidate.supplierQuantity
    || evidence.sourceFingerprint !== input.sourceFingerprint
    || canonicalLunaUrl(evidence.canonicalUrl) !== canonicalLunaUrl(input.canonicalUrl)
    || evidence.marketEvidenceId !== input.marketEvidence.evidenceId
    || evidence.operatorAttested !== true || evidence.exactAuthority !== false
    || evidence.manufacturerBrandInferred !== false
    || evidence.offerDifferenceHidden !== false
    || evidence.supplierTruthModified !== false
    || evidence.marketplaceWrites !== 0 || evidence.supplierPurchases !== 0
    || evidence.draftIsLive !== false
    || evidence.evidenceId !== evidence.evidenceDigest
    || evidence.evidenceDigest !== digest(evidenceCore(evidence))) return false
  try {
    const rebuilt = buildGoldenVisualComparisonEvidenceV1({
      candidate: input.candidate, accountKey: input.accountKey,
      ownerUserId: input.ownerUserId, sourceFingerprint: input.sourceFingerprint,
      canonicalUrl: input.canonicalUrl,
      supplierObservation: evidence.supplierObservation as GoldenVisualSourceObservationV1,
      comparisons: [{ marketEvidence: input.marketEvidence,
        marketplaceObservation: evidence.marketplaceObservation as GoldenVisualSourceObservationV1,
        relations: Array.isArray(evidence.relations)
          ? evidence.relations as GoldenVisualRelationV1[] : [] }],
      operatorAttested: true, now: input.now,
    })[0]
    return rebuilt.evidenceDigest === evidence.evidenceDigest
  } catch { return false }
}

export function goldenVisualComparisonForMarketEvidenceV1(input: Readonly<{
  evidence: ReadonlyArray<unknown>
  candidate: GoldenVisualCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  marketEvidence: GoldenVisualMarketBindingV1
  now: Date
}>) {
  const valid = input.evidence.map(record).filter(evidence =>
    isGoldenVisualComparisonEvidenceV1({ ...input, evidence }))
  const precedence: Record<GoldenVisualOutcomeV1, number> = {
    CONTRADICTS: 3, SUPPORTS_CLOSE: 2, INCONCLUSIVE: 1,
  }
  const selected = [...valid].sort((left, right) =>
    precedence[right.outcome as GoldenVisualOutcomeV1]
    - precedence[left.outcome as GoldenVisualOutcomeV1]
    || String(left.evidenceId).localeCompare(String(right.evidenceId)))[0]
  return selected ? Object.freeze({
    outcome: selected.outcome as GoldenVisualOutcomeV1,
    reasonCodes: Object.freeze(Array.isArray(selected.reasonCodes)
      ? selected.reasonCodes.map(String) : []),
    evidenceIds: Object.freeze(valid.map(value => String(value.evidenceId)).sort()),
    visualSimilaritySupport: selected.visualSimilaritySupport === true,
    exactAuthority: false as const,
  }) : null
}
