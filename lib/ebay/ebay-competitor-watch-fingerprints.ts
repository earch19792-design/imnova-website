import { createHash, createHmac } from "node:crypto"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizedLegacyItemId(value: unknown) {
  const raw = text(value)
  if (/^\d{9,20}$/.test(raw)) return raw
  const restMatch = raw.match(/^v\d+\|(\d{9,20})\|[^|]*$/i)
  return restMatch?.[1] ?? ""
}

export function ebaySourceListingReferenceHash(value: unknown) {
  const itemId = normalizedLegacyItemId(value)
  return itemId
    ? `sha256:${createHash("sha256").update(itemId).digest("hex")}`
    : null
}

export function ebaySellerReferenceHash(input: {
  sellerUsername: unknown
  marketplaceAccountKey: string
  fingerprintSecret: string
}) {
  const seller = text(input.sellerUsername).toLocaleLowerCase("en-US")
  if (!seller || !input.marketplaceAccountKey || !input.fingerprintSecret) return null
  return `hmac-sha256:${createHmac("sha256", input.fingerprintSecret)
    .update(`${input.marketplaceAccountKey}\n${seller}`)
    .digest("hex")}`
}
