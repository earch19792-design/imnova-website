const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/

function accountKey(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function assertEbayImageAccountScope(
  requestedAccountKey: unknown,
  packageAccountKey: unknown,
  assetAccountKey?: unknown,
) {
  const requested = accountKey(requestedAccountKey)
  const packageScope = accountKey(packageAccountKey)
  const assetScope = assetAccountKey === undefined
    ? packageScope
    : accountKey(assetAccountKey)
  if (
    !ACCOUNT_KEY_PATTERN.test(requested)
    || requested === "default"
    || !ACCOUNT_KEY_PATTERN.test(packageScope)
    || packageScope === "default"
  ) throw new Error("EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED")
  if (requested !== packageScope || assetScope !== packageScope) {
    throw new Error("EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH")
  }
  return requested
}

export function isIdempotentEbayImageRetry(
  input: {
    requestedAccountKey: unknown
    existingAccountKey: unknown
    requestedPackageId: unknown
    existingPackageId: unknown
    requestedSha256: unknown
    existingSha256: unknown
  },
) {
  const requestedAccount = accountKey(input.requestedAccountKey)
  assertEbayImageAccountScope(
    requestedAccount,
    input.existingAccountKey,
    input.existingAccountKey,
  )
  return Boolean(
    typeof input.requestedPackageId === "string"
    && input.requestedPackageId === input.existingPackageId
    && typeof input.requestedSha256 === "string"
    && /^[0-9a-f]{64}$/.test(input.requestedSha256)
    && input.requestedSha256 === input.existingSha256,
  )
}
