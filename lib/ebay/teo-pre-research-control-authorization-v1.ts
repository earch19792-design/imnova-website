const EXPECTED_CLIENT_ID = "9ab58207-f8b2-4c8a-9f10-047efc97b325"
const EXPECTED_REDIRECT_URI =
  "https://chatgpt.com/connector/oauth/YZ_2z2gp8NQJ"
const EXPECTED_RESOURCE =
  "https://imnova-seller-os-preprod.vercel.app/api/seller-os/control/mcp"

const REQUIRED_SCOPES = new Set(["openid", "profile"])
const ALLOWED_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "offline_access",
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(code: string): never {
  throw new Error(code)
}

export function isValidOpaqueAuthorizationId(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false
  if (value.length < 1 || value.length > 512) return false
  if (value !== value.trim()) return false
  if (/[\u0000-\u0020\u007F]/.test(value)) return false
  return true
}

export function parseSellerOsControlAuthorizationRequestV1(value: unknown) {
  if (!record(value) ||
      Object.keys(value).sort().join(",") !== "action,authorizationId" ||
      value.action !== "AUTHORIZE" ||
      !isValidOpaqueAuthorizationId(value.authorizationId)) {
    fail("TEO_CONTROL_AUTHORIZATION_REQUEST_REJECTED")
  }
  return Object.freeze({ authorizationId: value.authorizationId })
}

export function validateSellerOsControlAuthorizationDetailsV1(input: Readonly<{
  details: unknown
  authorizationId: string
  actorUserId: string
}>) {
  if (!record(input.details) || !record(input.details.client) ||
      !record(input.details.user) ||
      input.details.authorization_id !== input.authorizationId ||
      input.details.user.id !== input.actorUserId ||
      input.details.client.id !== EXPECTED_CLIENT_ID ||
      input.details.redirect_uri !== EXPECTED_REDIRECT_URI ||
      input.details.resource !== EXPECTED_RESOURCE ||
      typeof input.details.scope !== "string") {
    fail("TEO_CONTROL_AUTHORIZATION_BINDING_INVALID")
  }

  const requestedScopes = new Set(input.details.scope.split(/\s+/)
    .map((scope) => scope.trim()).filter(Boolean))
  if ([...REQUIRED_SCOPES].some((scope) => !requestedScopes.has(scope)) ||
      [...requestedScopes].some((scope) => !ALLOWED_SCOPES.has(scope))) {
    fail("TEO_CONTROL_AUTHORIZATION_BINDING_INVALID")
  }

  return Object.freeze({ clientId: EXPECTED_CLIENT_ID,
    requestedScopes: Object.freeze([...requestedScopes]) })
}

export async function authorizeSellerOsControlConsentV1<TCapability>(
  input: Readonly<{ authorizationId: string; actorUserId: string }>,
  dependencies: Readonly<{
    getAuthorizationDetails: (authorizationId: string) => Promise<unknown>
    approveAuthorization: (authorizationId: string) => Promise<string>
    persistCapability: (clientId: string) => Promise<TCapability>
  }>,
) {
  const details = await dependencies.getAuthorizationDetails(
    input.authorizationId)
  const binding = validateSellerOsControlAuthorizationDetailsV1({
    details,
    authorizationId: input.authorizationId,
    actorUserId: input.actorUserId,
  })
  const redirectUrl = await dependencies.approveAuthorization(
    input.authorizationId)
  if (typeof redirectUrl !== "string" || redirectUrl.length < 1) {
    fail("TEO_CONTROL_OAUTH_CONSENT_FAILED")
  }
  const capability = await dependencies.persistCapability(binding.clientId)
  return Object.freeze({ redirectUrl, capability, clientId: binding.clientId })
}
