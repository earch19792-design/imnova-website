import { createHash } from "node:crypto"

export const TOP20_HYBRID_DISCOVERY_VERSION =
  "EBAY_LISTING_AI_TOP20_HYBRID_DISCOVERY_V1_2026_07_17"

export type EbayFirstLunaMatchStatus =
  | "EXACT_LUNA_MATCH"
  | "NEAR_LUNA_MATCH"
  | "DIFFERENT_VARIANT"
  | "DIFFERENT_SIZE"
  | "DIFFERENT_PACK"
  | "NO_LUNA_MATCH"
  | "CONFLICTED"

export type HybridLunaCandidate = {
  productId: string
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  productName: string | null
  brand: string | null
  gtin: string | null
  mpn: string | null
  model: string | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  packCount: number | null
  available: boolean
}

export type HybridEbayProduct = {
  sourceKey: string
  categoryId: string | null
  title: string | null
  brand: string | null
  gtins: string[]
  mpns: string[]
  aspects: Array<{ name: string; values: string[] }>
  demandEvidence: "CONFIRMED_SOLD" | "ESTIMATED_MOVEMENT" | "ACTIVE_ONLY"
  demandConfidence: number
  sellerCount: number | null
  activeListingCount: number | null
  landedPriceRange: { minimum: number; maximum: number } | null
  observedAt: string
}

export type EbayFirstLunaMatch = {
  status: EbayFirstLunaMatchStatus
  candidate: HybridLunaCandidate | null
  score: number
  evidence: {
    exactIdentifier: "GTIN" | "BRAND_MPN" | null
    nameSimilarity: number
    matchingFields: string[]
    conflictingFields: string[]
  }
}

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : ""
}

function normalizedGtin(value: unknown) {
  const gtin = String(value ?? "").replace(/[^0-9]/g, "")
  if (![8, 12, 13, 14].includes(gtin.length)) return ""
  const digits = [...gtin].map(Number)
  const check = digits.pop()
  const sum = digits.reverse().reduce((total, digit, index) =>
    total + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - sum % 10) % 10 === check ? gtin : ""
}

function tokens(value: unknown) {
  return new Set(normalized(value).split(" ").filter((entry) => entry.length > 1))
}

function similarity(left: unknown, right: unknown) {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((entry) => b.has(entry)).length
  return intersection / new Set([...a, ...b]).size
}

function aspect(product: HybridEbayProduct, names: string[]) {
  const expected = new Set(names.map(normalized))
  for (const entry of product.aspects) {
    if (!expected.has(normalized(entry.name))) continue
    const value = entry.values.map(normalized).find(Boolean)
    if (value) return value
  }
  return ""
}

function positiveInteger(value: unknown) {
  const match = String(value ?? "").match(/^\s*(\d{1,3})\s*$/)
  const parsed = Number(match?.[1])
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null
}

function ebayFacts(product: HybridEbayProduct) {
  return {
    gtins: product.gtins.map(normalizedGtin).filter(Boolean),
    mpns: product.mpns.map(normalized).filter(Boolean),
    brand: normalized(product.brand ?? aspect(product, ["brand"])),
    packCount: positiveInteger(aspect(product, ["number in pack", "pack quantity", "pack size"])),
    size: aspect(product, ["size", "capacity", "volume"]),
    color: aspect(product, ["color", "colour"]),
    scent: aspect(product, ["scent", "fragrance"]),
    variant: aspect(product, ["variant", "type", "formulation"]),
    model: aspect(product, ["model"]),
  }
}

function compareField(
  name: string,
  lunaValue: unknown,
  ebayValue: unknown,
  matching: string[],
  conflicting: string[],
) {
  const left = normalized(lunaValue), right = normalized(ebayValue)
  if (!left || !right) return
  if (left === right) matching.push(name)
  else conflicting.push(name)
}

export function classifyEbayFirstLunaMatch(
  product: HybridEbayProduct,
  candidate: HybridLunaCandidate,
): EbayFirstLunaMatch {
  const facts = ebayFacts(product)
  const matchingFields: string[] = []
  const conflictingFields: string[] = []
  const candidateGtin = normalizedGtin(candidate.gtin)
  const exactGtin = Boolean(candidateGtin && facts.gtins.includes(candidateGtin))
  const candidateMpn = normalized(candidate.mpn ?? candidate.model)
  const brandMatch = Boolean(normalized(candidate.brand) && normalized(candidate.brand) === facts.brand)
  const exactBrandMpn = Boolean(brandMatch && candidateMpn &&
    [...facts.mpns, facts.model].filter(Boolean).includes(candidateMpn))
  compareField("brand", candidate.brand, facts.brand, matchingFields, conflictingFields)
  if (candidate.packCount && facts.packCount) {
    if (candidate.packCount === facts.packCount) matchingFields.push("pack")
    else conflictingFields.push("pack")
  }
  compareField("size", candidate.size, facts.size, matchingFields, conflictingFields)
  compareField("color", candidate.color, facts.color, matchingFields, conflictingFields)
  compareField("scent", candidate.scent, facts.scent, matchingFields, conflictingFields)
  compareField("variant", candidate.variant, facts.variant, matchingFields, conflictingFields)
  const nameSimilarity = similarity(candidate.productName, product.title)
  const hardConflicts = conflictingFields.filter((entry) =>
    ["brand", "pack", "size", "color", "scent", "variant"].includes(entry))
  const exactIdentifier = exactGtin ? "GTIN" as const : exactBrandMpn ? "BRAND_MPN" as const : null
  const structuredExact = brandMatch && nameSimilarity >= .82 && matchingFields.filter((entry) =>
    ["pack", "size", "color", "scent", "variant"].includes(entry)).length >= 2
  let status: EbayFirstLunaMatchStatus
  if ((exactIdentifier || structuredExact) && !hardConflicts.length) status = "EXACT_LUNA_MATCH"
  else if (conflictingFields.includes("pack")) status = "DIFFERENT_PACK"
  else if (conflictingFields.includes("size")) status = "DIFFERENT_SIZE"
  else if (conflictingFields.some((entry) => ["color", "scent", "variant"].includes(entry))) {
    status = "DIFFERENT_VARIANT"
  } else if (conflictingFields.includes("brand") || (candidateGtin && facts.gtins.length && !exactGtin) ||
    (candidateMpn && facts.mpns.length && !exactBrandMpn)) status = "CONFLICTED"
  else if (nameSimilarity >= .65) status = "NEAR_LUNA_MATCH"
  else status = "NO_LUNA_MATCH"
  const score = Math.max(0, Math.min(100, Math.round(
    (exactGtin ? 65 : exactBrandMpn ? 60 : brandMatch ? 25 : 0) +
    nameSimilarity * 25 + matchingFields.length * 4 - hardConflicts.length * 25,
  )))
  return { status, candidate: status === "NO_LUNA_MATCH" ? null : candidate, score,
    evidence: { exactIdentifier, nameSimilarity, matchingFields, conflictingFields } }
}

export function matchEbayFirstProductsToLuna(
  products: HybridEbayProduct[],
  candidates: HybridLunaCandidate[],
) {
  return products.map((product) => {
    const ranked = candidates.map((candidate) => classifyEbayFirstLunaMatch(product, candidate))
      .sort((left, right) => right.score - left.score ||
        String(left.candidate?.supplierSku ?? "").localeCompare(String(right.candidate?.supplierSku ?? "")))
    const exact = ranked.filter((entry) => entry.status === "EXACT_LUNA_MATCH")
    const selected = exact.length === 1 ? exact[0] : exact.length > 1
      ? { ...exact[0], status: "CONFLICTED" as const } : ranked[0] ?? {
        status: "NO_LUNA_MATCH" as const, candidate: null, score: 0,
        evidence: { exactIdentifier: null, nameSimilarity: 0, matchingFields: [], conflictingFields: [] },
      }
    return { product, match: selected }
  })
}

export function ebayFirstEvidenceSnapshot(input: {
  product: HybridEbayProduct
  match: EbayFirstLunaMatch
  rank: number
}) {
  return {
    version: TOP20_HYBRID_DISCOVERY_VERSION,
    origin: "EBAY_FIRST" as const,
    source: "EBAY_OFFICIAL_READONLY" as const,
    rank: input.rank,
    categoryId: input.product.categoryId,
    demandEvidence: input.product.demandEvidence,
    demandConfidence: input.product.demandConfidence,
    activeListingCount: input.product.activeListingCount,
    sellerCount: input.product.sellerCount,
    landedPriceRange: input.product.landedPriceRange,
    lunaMatchStatus: input.match.status,
    matchScore: input.match.score,
    evidence: input.match.evidence,
    sourceFingerprint: `sha256:${createHash("sha256").update(input.product.sourceKey).digest("hex").slice(0, 16)}`,
    observedAt: input.product.observedAt,
    confirmedSoldEvidence: input.product.demandEvidence === "CONFIRMED_SOLD",
    estimatedMovementSeparated: input.product.demandEvidence === "ESTIMATED_MOVEMENT",
    competitorTitleStored: false,
    competitorImageStored: false,
    competitorUrlStored: false,
    openAiCalls: 0,
    ebayWrites: 0,
  }
}
