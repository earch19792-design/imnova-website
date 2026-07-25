const CANONICAL_PACKAGE_SKU = /^IMNOVA[A-Z0-9]{16,32}$/
const LEGACY_PACKAGE_SKU = /^IMNOVA-[A-Z0-9]{16,32}$/

export function canonicalEbayPackageSku(packageId: unknown) {
  const normalized = typeof packageId === "string"
    ? packageId.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
    : ""
  return normalized.length >= 16
    ? `IMNOVA${normalized.slice(0, 32)}`
    : ""
}

export function isCanonicalEbayPackageSku(value: unknown) {
  return typeof value === "string"
    && CANONICAL_PACKAGE_SKU.test(value.trim())
}

export function isKnownEbayPackageSku(value: unknown) {
  if (typeof value !== "string") return false
  const normalized = value.trim()
  return CANONICAL_PACKAGE_SKU.test(normalized)
    || LEGACY_PACKAGE_SKU.test(normalized)
}

export function isReservedEbaySku(value: unknown) {
  return typeof value === "string"
    && /^IMNOVA/i.test(value.trim())
}

export function listingPackageIdFromEbaySku(value: unknown) {
  if (typeof value !== "string") return null
  const match = /^(?:IMNOVA|IMNOVA-)([0-9A-F]{32})$/.exec(value.trim())
  if (!match) return null
  const compact = match[1].toLowerCase()
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-")
}
