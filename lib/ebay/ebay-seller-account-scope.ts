import { createHash } from "node:crypto"

function normalizedFingerprint(value: unknown) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : ""
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ""
}

export function ebayProductionAccountFingerprint(userId: string) {
  return createHash("sha256")
    .update(`PRODUCTION:${userId}`)
    .digest("hex")
}

/**
 * Older Seller OS Preview configuration stored the already-scoped value as
 * `alias:fingerprint`. Only the alias is configuration input here; the trusted
 * fingerprint is always recomputed from the separate official identity
 * binding below.
 */
export function normalizeEbaySellerAccountAlias(
  raw: string | undefined | null,
) {
  const normalized = (raw ?? "").trim()
  if (!normalized) return ""
  if (!normalized.includes(":")) return normalized
  return normalized.split(":")[0]?.trim() ?? ""
}

export function getEbayProductionIdentityBindingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const expectedUserId =
    environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID?.trim() ?? ""
  const rawConfiguredFingerprint =
    environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
      ?.trim()
    || environment.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
      ?.trim()
    || ""
  const configuredFingerprint = normalizedFingerprint(
    rawConfiguredFingerprint,
  )
  const configuredFingerprintValid =
    !rawConfiguredFingerprint || Boolean(configuredFingerprint)
  const expectedUserIdValid = !expectedUserId || (
    expectedUserId.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(expectedUserId)
  )
  const derivedFingerprint = expectedUserId
    ? ebayProductionAccountFingerprint(expectedUserId)
    : ""
  const consistent = configuredFingerprintValid && expectedUserIdValid && !(
      configuredFingerprint &&
      derivedFingerprint &&
      configuredFingerprint !== derivedFingerprint
    )

  return {
    expectedUserId,
    expectedAccountFingerprint:
      configuredFingerprint || derivedFingerprint,
    configuredFingerprintValid,
    expectedUserIdValid,
    consistent,
    bound: Boolean(configuredFingerprint || derivedFingerprint) && consistent,
  }
}

/**
 * The database scope deliberately includes the expected production-account
 * fingerprint. Rotating a refresh token to another seller can therefore never
 * inherit templates or performance adjustments from the previous account.
 */
export function getEbaySellerAccountScopeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const accountAlias = normalizeEbaySellerAccountAlias(
    environment.EBAY_SELLER_ACCOUNT_KEY,
  )
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const aliasValid = /^[A-Za-z0-9._-]{1,80}$/.test(accountAlias)
  const reason = !accountAlias
    ? "ACCOUNT_KEY_REQUIRED"
    : !aliasValid
      ? "ACCOUNT_KEY_INVALID"
      : !identity.consistent
        ? "OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT"
        : !identity.bound
          ? "OFFICIAL_ACCOUNT_IDENTITY_REQUIRED"
          : null
  const accountKey = !reason
    ? `${accountAlias}:${identity.expectedAccountFingerprint}`
    : null

  return {
    configured: Boolean(accountKey),
    reason,
    accountAlias: aliasValid ? accountAlias : null,
    accountKey,
    identity,
  }
}
