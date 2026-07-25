import { createHash } from "node:crypto"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { validateGtinChecksum } from "./ebay-winner-evidence-v2.ts"

export const LUNA_OFFICIAL_DESCRIPTION_IDENTITY_VERSION =
  "LUNA_OFFICIAL_DESCRIPTION_IDENTITY_V1_2026_07_18"

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "-", mdash: "-",
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x"
      const parsed = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(parsed) && parsed >= 32 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed) : " "
    }
    return named[entity.toLowerCase()] ?? " "
  })
}

function officialDescriptionText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return ""
  return decodeEntities(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*\/?\s*(?:p|div|li|ul|ol|br|tr|td|th|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

function cleaned(value: string | undefined, maximum = 100) {
  const normalized = value?.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").replace(/^[\s:;#\-/]+|[\s;|]+$/g, "").trim().slice(0, maximum)
  return normalized || null
}

function label(text: string, pattern: string, maximum = 100) {
  const expression = new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*(?:number|no\\.?|/\\s*part\\s*#)?\\s*[:#-]\\s*([^\\n|\u2022]{1,${maximum + 30}})`, "i")
  return cleaned(expression.exec(text)?.[1], maximum)
}

function integer(value: string | null) {
  const parsed = Number(value?.match(/\d+/)?.[0])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function extractLunaOfficialDescriptionIdentity(input: {
  bodyHtml: unknown
  nativePackCount?: number | null
}) {
  const text = officialDescriptionText(input.bodyHtml)
  const rawGtin = label(text, "gtin|upc|ean", 32)?.replace(/[\s-]/g, "") ?? null
  const gtin = rawGtin && validateGtinChecksum(rawGtin) ? rawGtin : null
  const brand = label(text, "brand|manufacturer brand", 100)
  const mpn = label(text, "mpn|manufacturer part number", 100)
  const model = label(text, "model", 100)
  const packCount = integer(label(text, "number in pack|pack quantity|pack count", 30)) ??
    (Number.isInteger(input.nativePackCount) && Number(input.nativePackCount) > 0
      ? Number(input.nativePackCount) : null)
  const size = label(text, "size|unit size|net content", 100)
  const blockers = [
    rawGtin && !gtin ? "LUNA_DESCRIPTION_GTIN_INVALID" : "",
    !gtin && !(brand && (mpn || model)) ? "LUNA_DESCRIPTION_STRONG_IDENTITY_MISSING" : "",
    packCount === null ? "LUNA_DESCRIPTION_PACK_IDENTITY_MISSING" : "",
  ].filter(Boolean)
  return {
    version: LUNA_OFFICIAL_DESCRIPTION_IDENTITY_VERSION,
    readyForExactResearchQuery: blockers.length === 0,
    facts: { brand, gtin, mpn, model, packCount, size },
    blockers,
    source: "LUNA_OFFICIAL_PRODUCT_DESCRIPTION" as const,
    sourceAuthority: "SUPPLIER" as const,
    evidenceHash: text ? `sha256:${createHash("sha256").update(text).digest("hex")}` : null,
    rawHtmlStored: false,
    rawTextStored: false,
  }
}
