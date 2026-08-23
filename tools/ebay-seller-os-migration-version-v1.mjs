export const SELLER_OS_MIGRATION_VERSION_PATTERN_V1 =
  /^(?:[0-9]{12}|[0-9]{14})$/

export function preserveSellerOsMigrationVersionIdV1(value) {
  return typeof value === "string" &&
      SELLER_OS_MIGRATION_VERSION_PATTERN_V1.test(value)
    ? value
    : null
}

export function sellerOsMigrationVersionFromFilenameV1(name) {
  if (typeof name !== "string") return null
  const separator = name.indexOf("_")
  if (separator <= 0) return null
  return preserveSellerOsMigrationVersionIdV1(name.slice(0, separator))
}
