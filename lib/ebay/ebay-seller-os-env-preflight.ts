export type SellerOsVariableStatus =
  | "PRESENT"
  | "MISSING"
  | "INVALID_FORMAT"
  | "IDENTITY_UNBOUND"
  | "SCOPE_NOT_VERIFIED"

type Environment = Record<string, string | undefined>

const SELLER_OS_VARIABLES = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_SELLER_REFRESH_TOKEN",
  "EBAY_SELLER_ACCOUNT_KEY",
  "EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID",
  "EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET",
  "EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN",
  "EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID",
  "EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_CREDENTIAL_FINGERPRINT",
  "EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT",
  "EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_HMAC_SECRET",
  "EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID",
  "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT",
  "EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_HMAC_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED",
  "EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH",
  "EBAY_DRAFT_ONLY_WRITES_ENABLED",
  "EBAY_DRAFT_ONLY_TARGET",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "EBAY_PRO_RUNTIME",
  "EBAY_MARKETPLACE_INSIGHTS_ENABLED",
  "EBAY_MARKET_OBSERVATION_WRITES_ENABLED",
  "EBAY_LUNA_BEST_SELLING_CATEGORY_IDS",
  "EBAY_IMAGE_SOURCE_HOSTS",
  "EBAY_SELLER_WHATSAPP_ENABLED",
  "EBAY_SELLER_WHATSAPP_RECIPIENT",
  "EBAY_SELLER_WHATSAPP_TEMPLATE_NAME",
  "EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME",
  "EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE",
  "EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC",
  "EBAY_SELLER_COMMAND_CENTER_URL",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
] as const

export type SellerOsVariableName = typeof SELLER_OS_VARIABLES[number]

function value(environment: Environment, name: SellerOsVariableName) {
  return environment[name]?.trim() ?? ""
}

function basic(valueToCheck: string): SellerOsVariableStatus {
  if (!valueToCheck) return "MISSING"
  return /[\u0000-\u001f\u007f]/.test(valueToCheck)
    ? "INVALID_FORMAT"
    : "PRESENT"
}

function booleanFlag(valueToCheck: string): SellerOsVariableStatus {
  if (!valueToCheck) return "MISSING"
  return ["true", "false"].includes(valueToCheck)
    ? "PRESENT"
    : "INVALID_FORMAT"
}

function url(valueToCheck: string): SellerOsVariableStatus {
  if (!valueToCheck) return "MISSING"
  try {
    const parsed = new URL(valueToCheck)
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? "PRESENT"
      : "INVALID_FORMAT"
  } catch {
    return "INVALID_FORMAT"
  }
}

function identityStatus(
  environment: Environment,
  target: "SANDBOX" | "PRODUCTION",
) {
  const userId = value(
    environment,
    `EBAY_DRAFT_ONLY_${target}_EXPECTED_USER_ID` as SellerOsVariableName,
  )
  const credentialFingerprint = value(
    environment,
    `EBAY_DRAFT_ONLY_${target}_EXPECTED_CREDENTIAL_FINGERPRINT` as SellerOsVariableName,
  )
  const accountFingerprint = value(
    environment,
    `EBAY_DRAFT_ONLY_${target}_EXPECTED_ACCOUNT_FINGERPRINT` as SellerOsVariableName,
  )
  const fingerprint = credentialFingerprint || accountFingerprint
  if (!userId && !fingerprint) return "IDENTITY_UNBOUND" as const
  if (userId && (userId.length > 200 || /[\u0000-\u001f\u007f]/.test(userId))) {
    return "INVALID_FORMAT" as const
  }
  if (fingerprint && !/^[0-9a-f]{64}$/.test(fingerprint)) {
    return "INVALID_FORMAT" as const
  }
  return "PRESENT" as const
}

export function getEbaySellerOsEnvironmentPreflight(
  environment: Environment = process.env,
) {
  const statuses = {} as Record<SellerOsVariableName, SellerOsVariableStatus>
  const sandboxIdentity = identityStatus(environment, "SANDBOX")
  const productionIdentity = identityStatus(environment, "PRODUCTION")

  for (const name of SELLER_OS_VARIABLES) {
    const current = value(environment, name)
    if (name.endsWith("REFRESH_TOKEN")) {
      statuses[name] = current ? "SCOPE_NOT_VERIFIED" : "MISSING"
    } else if (name.endsWith("WRITES_ENABLED") || name === "EBAY_SELLER_WHATSAPP_ENABLED"
      || name === "EBAY_MARKETPLACE_INSIGHTS_ENABLED") {
      statuses[name] = booleanFlag(current)
    } else if (name.includes("EXPECTED_USER_ID") || name.includes("EXPECTED_CREDENTIAL_FINGERPRINT")
      || name.includes("EXPECTED_ACCOUNT_FINGERPRINT")) {
      statuses[name] = name.includes("SANDBOX") ? sandboxIdentity : productionIdentity
    } else if (name.includes("PREFLIGHT_HMAC_SECRET") || name.includes("PREFLIGHT_SNAPSHOT_SECRET")) {
      statuses[name] = !current
        ? "MISSING"
        : current.length >= 32 ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "EBAY_SELLER_ACCOUNT_KEY") {
      statuses[name] = !current
        ? "MISSING"
        : /^[A-Za-z0-9._-]{1,80}$/.test(current) ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "EBAY_DRAFT_ONLY_TARGET") {
      statuses[name] = !current
        ? "MISSING"
        : ["SANDBOX", "PRODUCTION"].includes(current.toUpperCase())
          ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "VERCEL_ENV") {
      statuses[name] = !current
        ? "MISSING"
        : ["development", "preview", "production"].includes(current)
          ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "NEXT_PUBLIC_SUPABASE_URL"
      || name === "EBAY_SELLER_COMMAND_CENTER_URL") {
      statuses[name] = url(current)
    } else if (name === "CRON_SECRET") {
      statuses[name] = !current
        ? "MISSING"
        : current.length >= 16 ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "EBAY_SELLER_WHATSAPP_RECIPIENT") {
      const digits = current.replace(/\D/g, "")
      statuses[name] = !current
        ? "MISSING"
        : digits.length >= 8 && digits.length <= 15
          ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC") {
      statuses[name] = !current
        ? "MISSING"
        : /^([01]?\d|2[0-3])$/.test(current) ? "PRESENT" : "INVALID_FORMAT"
    } else if (name === "EBAY_MARKET_OBSERVATION_WRITES_ENABLED") {
      statuses[name] = booleanFlag(current)
    } else {
      statuses[name] = basic(current)
    }
  }

  return statuses
}
