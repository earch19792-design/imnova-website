export const EBAY_VERIFIED_TITLE_STRATEGY_VERSION =
  "EBAY_VERIFIED_TITLE_STRATEGY_V1_2026_07_20"

const MAX_TITLE_LENGTH = 80
const GENERIC_BRANDS = new Set([
  "", "unbranded", "generic", "n/a", "na", "not applicable", "does not apply",
])

function clean(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
    : ""
}

function key(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "")
}

function packFromVerifiedName(value: string) {
  const match = value.match(/(?:^|\b)(\d{1,3})\s*(?:pcs?|pieces?|count|ct)(?:\s*\/\s*set)?\b/i)
    ?? value.match(/\b(?:set|pack)\s+of\s+(\d{1,3})\b/i)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 999 ? parsed : null
}

function stripPackClaim(value: string, packCount: number | null) {
  let result = value
    .replace(/^\s*\d{1,3}\s*(?:pcs?|pieces?|count|ct)(?:\s*\/\s*set)?\s*[-,:/]?\s*/i, "")
    .replace(/^\s*(?:set|pack)\s+of\s+\d{1,3}\s*[-,:/]?\s*/i, "")
  if (packCount) {
    result = result
      .replace(new RegExp(`\\b${packCount}\\s*(?:count|ct|pcs?|pieces?)\\b`, "ig"), "")
      .replace(new RegExp(`\\b(?:set|pack)\\s+of\\s+${packCount}\\b`, "ig"), "")
  }
  return clean(result)
    .replace(/\bkeychains?\s+set\b/gi, "Keychain Set")
    .replace(/\bset\s+set\b/gi, "Set")
}

function truncateWords(value: string, maximum: number) {
  if (value.length <= maximum) return value
  const clipped = value.slice(0, maximum + 1)
  const boundary = clipped.lastIndexOf(" ")
  return clean(boundary >= Math.floor(maximum * 0.55)
    ? clipped.slice(0, boundary)
    : value.slice(0, maximum))
}

function addUnique(parts: string[], value: string) {
  const normalized = clean(value)
  if (!normalized) return
  const normalizedKey = key(normalized)
  const currentKey = key(parts.join(" "))
  if (!normalizedKey || currentKey.includes(normalizedKey)) return
  parts.push(normalized)
}

export function buildVerifiedEbayTitle(input: {
  productTitle: string
  brand?: string | null
  productType?: string | null
  packCount?: number | null
  color?: string | null
  audience?: string | null
  relationship?: string | null
}) {
  const verifiedName = clean(input.productTitle)
  const explicitPack = Number(input.packCount)
  const packCount = Number.isInteger(explicitPack) && explicitPack >= 2 && explicitPack <= 999
    ? explicitPack
    : packFromVerifiedName(verifiedName)
  const core = stripPackClaim(verifiedName, packCount)
  const brand = clean(input.brand)
  const productType = clean(input.productType)
  const color = clean(input.color)
  const audience = clean(input.audience)
  const relationship = clean(input.relationship)
  const parts: string[] = []

  if (!GENERIC_BRANDS.has(brand.toLocaleLowerCase("en-US"))) addUnique(parts, brand)
  if (packCount) {
    const piecePresentation = /\bset\b/i.test(core) || /\b(?:key\s*chain|keychain|set)\b/i.test(productType)
    parts.push(`${packCount}-${piecePresentation ? "Piece" : "Pack"}`)
  }
  addUnique(parts, core)
  addUnique(parts, productType)
  addUnique(parts, audience)
  addUnique(parts, relationship)
  addUnique(parts, color)

  const relationshipEvidence = `${core} ${audience} ${relationship}`
  if (/\bbig sister\b/i.test(relationshipEvidence) && /\blittle sister\b/i.test(relationshipEvidence)) {
    addUnique(parts, "Sister Gift")
  }

  while (parts.join(" ").length > MAX_TITLE_LENGTH && parts.length > 2) {
    parts.pop()
  }
  return truncateWords(parts.join(" "), MAX_TITLE_LENGTH)
}
