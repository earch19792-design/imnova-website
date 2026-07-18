type JsonRecord = Record<string, unknown>
type Presence = "PRESENT" | "MISSING"

export const EBAY_COMMERCIAL_OAUTH_CATEGORIES = [
  "INVALID_SCOPE",
  "INVALID_GRANT",
  "CLIENT_CREDENTIAL_MISMATCH",
  "REFRESH_TOKEN_REVOKED_OR_EXPIRED",
  "TOKEN_ENDPOINT_UNAVAILABLE",
  "MALFORMED_REQUEST",
  "UNKNOWN_OAUTH_ERROR",
] as const

export type EbayCommercialOAuthCategory =
  typeof EBAY_COMMERCIAL_OAUTH_CATEGORIES[number]
export type EbayCommercialOAuthStatus = "READY" | EbayCommercialOAuthCategory

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function present(value: string) : Presence {
  return value ? "PRESENT" : "MISSING"
}

/**
 * Converts eBay OAuth failures to an allowlisted category. The raw payload is
 * used only in memory and is never returned, logged, persisted, or rendered.
 */
export function classifyEbayCommercialOAuthFailure(
  status: number,
  payload: unknown,
): EbayCommercialOAuthCategory {
  const source = record(payload)
  const error = text(source.error).toLowerCase()
  const description = text(source.error_description).toLowerCase()

  if (status === 429 || status >= 500) return "TOKEN_ENDPOINT_UNAVAILABLE"
  if (error === "invalid_scope" || description.includes("scope")) {
    return "INVALID_SCOPE"
  }
  if (
    error === "invalid_client" ||
    description.includes("client authentication failed") ||
    description.includes("issued to another client") ||
    description.includes("client credential mismatch")
  ) {
    return "CLIENT_CREDENTIAL_MISMATCH"
  }
  if (
    error === "invalid_grant" &&
    (description.includes("revoked") || description.includes("expired"))
  ) {
    return "REFRESH_TOKEN_REVOKED_OR_EXPIRED"
  }
  if (error === "invalid_grant") return "INVALID_GRANT"
  if (error === "invalid_request" || status === 422) return "MALFORMED_REQUEST"
  return "UNKNOWN_OAUTH_ERROR"
}

export function getEbayCommercialOAuthAction(status: EbayCommercialOAuthStatus) {
  const actions: Record<EbayCommercialOAuthStatus, string> = {
    READY: "Sin acción de autenticación; continuar con el dry run read-only.",
    INVALID_SCOPE:
      "Autorizar manualmente Orders con sell.fulfillment.readonly y guardar el nuevo refresh token sólo en EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN de Preview.",
    INVALID_GRANT:
      "Verificar manualmente que el refresh token de Orders corresponda a la aplicación eBay configurada; reautorizar si el error persiste.",
    CLIENT_CREDENTIAL_MISMATCH:
      "Alinear manualmente el refresh token de Orders con el Client ID/Secret que lo emitió; no reemplazar el token general validado.",
    REFRESH_TOKEN_REVOKED_OR_EXPIRED:
      "Completar una nueva autorización manual de eBay para Orders y actualizar únicamente el refresh token dedicado de Preview.",
    TOKEN_ENDPOINT_UNAVAILABLE:
      "Reintentar el preflight read-only después del backoff; no cambiar credenciales durante una falla temporal.",
    MALFORMED_REQUEST:
      "Configurar EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN en Preview y verificar que el par Client ID/Secret esté completo.",
    UNKNOWN_OAUTH_ERROR:
      "Revisar la configuración OAuth de Orders con soporte eBay sin copiar respuestas crudas ni credenciales a logs o UI.",
  }
  return actions[status]
}

export function oauthStatusFromCommercialError(code: string) : EbayCommercialOAuthStatus {
  for (const category of EBAY_COMMERCIAL_OAUTH_CATEGORIES) {
    if (code.endsWith(`_${category}`)) return category
  }
  if (/IDENTITY_MISMATCH|CONFIGURED_FINGERPRINT_MISMATCH/.test(code)) {
    return "CLIENT_CREDENTIAL_MISMATCH"
  }
  if (/NOT_CONFIGURED|ENV_MISSING|TOKEN_MISSING/.test(code)) {
    return "MALFORMED_REQUEST"
  }
  if (/OAUTH|TOKEN|_401$|_403$/.test(code)) return "UNKNOWN_OAUTH_ERROR"
  return "READY"
}

export function getEbayCommercialReaderAuthState(
  reader: "orders" | "analytics" | "watchers" | "messages",
  errorCode?: string,
) {
  const code = errorCode ?? ""
  const status = code ? oauthStatusFromCommercialError(code) : "READY"
  const identityMismatch = /IDENTITY_MISMATCH|FINGERPRINT_MISMATCH/.test(code)
  const identityUnavailable = /IDENTITY_REQUIRED|IDENTITY_UNAVAILABLE|IDENTITY_NOT_BOUND/.test(code)
  const authenticationFailed = status !== "READY"
  return {
    status,
    requiredScope: reader === "orders"
      ? "sell.fulfillment.readonly"
      : reader === "analytics"
        ? "sell.analytics.readonly"
        : "api_scope",
    scopeConfirmed: authenticationFailed ? false : true,
    identityMatch: identityMismatch
      ? false
      : identityUnavailable || authenticationFailed
        ? null
        : true,
    actionRequired: getEbayCommercialOAuthAction(status),
    rawOAuthDescriptionExposed: false as const,
  }
}

export function getEbayCommercialOrdersOAuthConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const genericClientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const genericClientSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const dedicatedClientId = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = environment.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN?.trim() ?? ""
  const genericRefreshToken = environment.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  const dedicatedClientPairPartial = Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)
  const clientId = dedicatedClientId && dedicatedClientSecret
    ? dedicatedClientId
    : genericClientId
  const clientSecret = dedicatedClientId && dedicatedClientSecret
    ? dedicatedClientSecret
    : genericClientSecret

  return {
    configured: Boolean(
      clientId && clientSecret && refreshToken && !dedicatedClientPairPartial
    ),
    clientId: present(clientId),
    clientSecret: present(clientSecret),
    dedicatedOrdersRefreshToken: present(refreshToken),
    genericSellerRefreshToken: present(genericRefreshToken),
    clientSource: dedicatedClientId && dedicatedClientSecret
      ? "DEDICATED_ORDERS_APPLICATION" as const
      : "GENERAL_APPLICATION_DEDICATED_REFRESH" as const,
    refreshTokenSource: "EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN" as const,
    generalRefreshTokenFallbackAllowed: false as const,
    dedicatedClientPairComplete: !dedicatedClientPairPartial,
    environment: "PRODUCTION" as const,
    requiredScope: "sell.fulfillment.readonly" as const,
    secretsReturned: false as const,
  }
}

export async function settleEbayCommercialReaderPromises<Orders, Analytics, Watchers>(
  input: {
    orders: Promise<Orders>
    analytics: Promise<Analytics>
    watchers: Promise<Watchers>
  },
) {
  const [orders, analytics, watchers] = await Promise.allSettled([
    input.orders,
    input.analytics,
    input.watchers,
  ])
  return { orders, analytics, watchers }
}
