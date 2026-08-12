import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose"
import { z } from "zod"

export const SELLER_OS_MCP_OAUTH_VERSION = "SELLER_OS_MCP_OAUTH_2_1_V1_2026_08_12"
export const SELLER_OS_MCP_REQUIRED_SCOPE = "seller_os.read"
export const SELLER_OS_MCP_OAUTH_ENVIRONMENT = Object.freeze({
  issuer: "SELLER_OS_MCP_OAUTH_ISSUER",
  resource: "SELLER_OS_MCP_OAUTH_RESOURCE",
  discoveryUrl: "SELLER_OS_MCP_OAUTH_DISCOVERY_URL",
})

const ALLOWED_SIGNING_ALGORITHMS = ["RS256", "PS256", "ES256"] as const
const DISCOVERY_MAX_BYTES = 64 * 1024
const DISCOVERY_TIMEOUT_MS = 5_000
const DISCOVERY_CACHE_MS = 5 * 60 * 1_000

const authorizationServerMetadataSchema = OAuthMetadataSchema.extend({
  jwks_uri: z.string().url(),
  scopes_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()).min(1),
})

export type SellerOsMcpOAuthConfigurationV1 = Readonly<{
  issuer: string
  resource: string
  discoveryUrl: string
  resourceMetadataUrl: string
  requiredScope: typeof SELLER_OS_MCP_REQUIRED_SCOPE
  allowedSigningAlgorithms: readonly string[]
}>

export type SellerOsMcpAuthorizationServerMetadataV1 = Readonly<{
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  scopesSupported: readonly string[]
  tokenEndpointAuthMethods: readonly string[]
  pkceS256: true
  registrationMode: "CLIENT_ID_METADATA_DOCUMENT" | "DYNAMIC_CLIENT_REGISTRATION" |
    "PRE_REGISTERED_CLIENT_REQUIRED"
}>

export type SellerOsMcpOAuthFailureCodeV1 =
  | "OAUTH_NOT_CONFIGURED"
  | "OAUTH_CONFIGURATION_INVALID"
  | "AUTH_SERVER_DISCOVERY_UNAVAILABLE"
  | "AUTH_SERVER_DISCOVERY_INVALID"
  | "NO_TOKEN"
  | "MALFORMED_TOKEN"
  | "INVALID_SIGNATURE"
  | "INVALID_ISSUER"
  | "WRONG_AUDIENCE"
  | "EXPIRED_TOKEN"
  | "TOKEN_NOT_ACTIVE"
  | "TOKEN_EXPIRY_REQUIRED"
  | "WRONG_SCOPE"
  | "USER_SCOPED_TOKEN_REQUIRED"
  | "CLIENT_ID_REQUIRED"

export type SellerOsMcpOAuthPrincipalV1 = Readonly<{
  subject: string
  clientId: string
  scopes: readonly string[]
  issuer: string
  resource: string
  expiresAt: number
}>

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type DiscoveryCacheEntry = {
  cacheKey: string
  expiresAt: number
  metadata: SellerOsMcpAuthorizationServerMetadataV1
}

let discoveryCache: DiscoveryCacheEntry | null = null
const remoteJwksResolvers = new Map<string, JWTVerifyGetKey>()

function normalizeHttpsUrl(value: string, field: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${field}_INVALID`)
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
      parsed.search) throw new Error(`${field}_INVALID`)
  return parsed.href
}

function discoveryUrlForIssuer(issuer: string) {
  return `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
}

export function getSellerOsMcpProtectedResourceMetadataUrlV1(resource: string) {
  const parsed = new URL(resource)
  const resourcePath = parsed.pathname === "/" ? "" : parsed.pathname
  return new URL(`/.well-known/oauth-protected-resource${resourcePath}`, parsed).href
}

export function loadSellerOsMcpOAuthConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
): { ok: true; config: SellerOsMcpOAuthConfigurationV1 } |
  { ok: false; code: "OAUTH_NOT_CONFIGURED" | "OAUTH_CONFIGURATION_INVALID" } {
  const issuerValue = environment[SELLER_OS_MCP_OAUTH_ENVIRONMENT.issuer]?.trim()
  const resourceValue = environment[SELLER_OS_MCP_OAUTH_ENVIRONMENT.resource]?.trim()
  if (!issuerValue || !resourceValue) return { ok: false, code: "OAUTH_NOT_CONFIGURED" }
  try {
    const issuer = normalizeHttpsUrl(issuerValue, "OAUTH_ISSUER")
    const resource = normalizeHttpsUrl(resourceValue, "OAUTH_RESOURCE")
    const discoveryUrl = normalizeHttpsUrl(
      environment[SELLER_OS_MCP_OAUTH_ENVIRONMENT.discoveryUrl]?.trim() ||
        discoveryUrlForIssuer(issuer),
      "OAUTH_DISCOVERY_URL",
    )
    if (new URL(discoveryUrl).origin !== new URL(issuer).origin) {
      return { ok: false, code: "OAUTH_CONFIGURATION_INVALID" }
    }
    return { ok: true, config: Object.freeze({
      issuer,
      resource,
      discoveryUrl,
      resourceMetadataUrl: getSellerOsMcpProtectedResourceMetadataUrlV1(resource),
      requiredScope: SELLER_OS_MCP_REQUIRED_SCOPE,
      allowedSigningAlgorithms: ALLOWED_SIGNING_ALGORITHMS,
    }) }
  } catch {
    return { ok: false, code: "OAUTH_CONFIGURATION_INVALID" }
  }
}

function trustedAuthorizationServerUrl(value: string, issuer: string) {
  const normalized = normalizeHttpsUrl(value, "AUTHORIZATION_SERVER_ENDPOINT")
  if (new URL(normalized).origin !== new URL(issuer).origin) {
    throw new Error("AUTHORIZATION_SERVER_ENDPOINT_ORIGIN_MISMATCH")
  }
  return normalized
}

export function validateSellerOsMcpAuthorizationServerMetadataV1(
  candidate: unknown,
  config: SellerOsMcpOAuthConfigurationV1,
): { ok: true; metadata: SellerOsMcpAuthorizationServerMetadataV1 } |
  { ok: false; code: "AUTH_SERVER_DISCOVERY_INVALID" } {
  const parsed = authorizationServerMetadataSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, code: "AUTH_SERVER_DISCOVERY_INVALID" }
  try {
    const issuer = normalizeHttpsUrl(parsed.data.issuer, "DISCOVERED_ISSUER")
    if (issuer !== config.issuer || !parsed.data.response_types_supported.includes("code") ||
        (parsed.data.grant_types_supported &&
          !parsed.data.grant_types_supported.includes("authorization_code")) ||
        !parsed.data.code_challenge_methods_supported.includes("S256") ||
        !parsed.data.scopes_supported.includes(config.requiredScope)) {
      return { ok: false, code: "AUTH_SERVER_DISCOVERY_INVALID" }
    }
    const authorizationEndpoint = trustedAuthorizationServerUrl(
      parsed.data.authorization_endpoint,
      issuer,
    )
    const tokenEndpoint = trustedAuthorizationServerUrl(parsed.data.token_endpoint, issuer)
    const jwksUri = trustedAuthorizationServerUrl(parsed.data.jwks_uri, issuer)
    const registrationMode = parsed.data.client_id_metadata_document_supported === true
      ? "CLIENT_ID_METADATA_DOCUMENT" as const
      : parsed.data.registration_endpoint
        ? "DYNAMIC_CLIENT_REGISTRATION" as const
        : "PRE_REGISTERED_CLIENT_REQUIRED" as const
    const tokenEndpointAuthMethods = parsed.data.token_endpoint_auth_methods_supported
    const chatGptCompatibleMethods = registrationMode === "CLIENT_ID_METADATA_DOCUMENT"
      ? ["none", "private_key_jwt"]
      : ["none", "private_key_jwt", "client_secret_post", "client_secret_basic"]
    if (!tokenEndpointAuthMethods.some((method) => chatGptCompatibleMethods.includes(method))) {
      return { ok: false, code: "AUTH_SERVER_DISCOVERY_INVALID" }
    }
    return { ok: true, metadata: Object.freeze({
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      scopesSupported: Object.freeze([...parsed.data.scopes_supported]),
      tokenEndpointAuthMethods: Object.freeze([...tokenEndpointAuthMethods]),
      pkceS256: true,
      registrationMode,
    }) }
  } catch {
    return { ok: false, code: "AUTH_SERVER_DISCOVERY_INVALID" }
  }
}

export async function discoverSellerOsMcpAuthorizationServerV1(
  config: SellerOsMcpOAuthConfigurationV1,
  options: { fetchImpl?: FetchLike; now?: number; useCache?: boolean } = {},
): Promise<{ ok: true; metadata: SellerOsMcpAuthorizationServerMetadataV1 } |
  { ok: false; code: "AUTH_SERVER_DISCOVERY_UNAVAILABLE" | "AUTH_SERVER_DISCOVERY_INVALID" }> {
  const now = options.now ?? Date.now()
  const cacheKey = `${config.issuer}|${config.discoveryUrl}|${config.requiredScope}`
  if (options.useCache !== false && discoveryCache?.cacheKey === cacheKey &&
      discoveryCache.expiresAt > now) return { ok: true, metadata: discoveryCache.metadata }
  try {
    const response = await (options.fetchImpl ?? fetch)(config.discoveryUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    const declaredLength = Number(response.headers.get("content-length") ?? 0)
    if (!response.ok || (Number.isFinite(declaredLength) && declaredLength >
      DISCOVERY_MAX_BYTES)) return { ok: false, code: "AUTH_SERVER_DISCOVERY_UNAVAILABLE" }
    const body = await response.text()
    if (body.length > DISCOVERY_MAX_BYTES) {
      return { ok: false, code: "AUTH_SERVER_DISCOVERY_UNAVAILABLE" }
    }
    const result = validateSellerOsMcpAuthorizationServerMetadataV1(JSON.parse(body), config)
    if (!result.ok) return result
    if (options.useCache !== false) discoveryCache = {
      cacheKey,
      expiresAt: now + DISCOVERY_CACHE_MS,
      metadata: result.metadata,
    }
    return result
  } catch {
    return { ok: false, code: "AUTH_SERVER_DISCOVERY_UNAVAILABLE" }
  }
}

function getRemoteJwksResolver(jwksUri: string) {
  const existing = remoteJwksResolvers.get(jwksUri)
  if (existing) return existing
  if (remoteJwksResolvers.size >= 4) remoteJwksResolvers.clear()
  const resolver = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: DISCOVERY_TIMEOUT_MS,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1_000,
  })
  remoteJwksResolvers.set(jwksUri, resolver)
  return resolver
}

function mapJwtVerificationFailure(error: unknown): SellerOsMcpOAuthFailureCodeV1 {
  if (!error || typeof error !== "object") return "MALFORMED_TOKEN"
  const candidate = error as { code?: unknown; claim?: unknown }
  if (candidate.code === "ERR_JWT_EXPIRED") return "EXPIRED_TOKEN"
  if (candidate.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    if (candidate.claim === "iss") return "INVALID_ISSUER"
    if (candidate.claim === "aud") return "WRONG_AUDIENCE"
    if (candidate.claim === "nbf") return "TOKEN_NOT_ACTIVE"
    if (candidate.claim === "exp") return "TOKEN_EXPIRY_REQUIRED"
  }
  if (candidate.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
      candidate.code === "ERR_JWKS_NO_MATCHING_KEY") return "INVALID_SIGNATURE"
  return "MALFORMED_TOKEN"
}

function parseScopeClaim(payload: JWTPayload) {
  if (typeof payload.scope !== "string") return []
  return [...new Set(payload.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))]
}

function resolveClientId(payload: JWTPayload) {
  if (typeof payload.client_id === "string" && payload.client_id.trim()) {
    return payload.client_id.trim()
  }
  if (typeof payload.azp === "string" && payload.azp.trim()) return payload.azp.trim()
  return null
}

function isMachineOnlyGrant(payload: JWTPayload) {
  const grantType = typeof payload.gty === "string" ? payload.gty :
    typeof payload.grant_type === "string" ? payload.grant_type : null
  return grantType === "client_credentials" || grantType === "client-credentials" ||
    (typeof payload.sub === "string" && payload.sub.endsWith("@clients"))
}

export async function verifySellerOsMcpAccessTokenV1(input: {
  token: string
  config: SellerOsMcpOAuthConfigurationV1
  metadata: SellerOsMcpAuthorizationServerMetadataV1
  keyResolver?: JWTVerifyGetKey
  currentDate?: Date
}): Promise<{ ok: true; principal: SellerOsMcpOAuthPrincipalV1 } |
  { ok: false; code: SellerOsMcpOAuthFailureCodeV1 }> {
  try {
    const verified = await jwtVerify(input.token,
      input.keyResolver ?? getRemoteJwksResolver(input.metadata.jwksUri), {
        issuer: input.config.issuer,
        audience: input.config.resource,
        algorithms: [...input.config.allowedSigningAlgorithms],
        requiredClaims: ["iss", "aud", "exp", "sub"],
        clockTolerance: 5,
        currentDate: input.currentDate,
      })
    const scopes = parseScopeClaim(verified.payload)
    if (!scopes.includes(input.config.requiredScope)) return { ok: false, code: "WRONG_SCOPE" }
    if (typeof verified.payload.sub !== "string" || !verified.payload.sub.trim() ||
        isMachineOnlyGrant(verified.payload)) {
      return { ok: false, code: "USER_SCOPED_TOKEN_REQUIRED" }
    }
    const clientId = resolveClientId(verified.payload)
    if (!clientId) return { ok: false, code: "CLIENT_ID_REQUIRED" }
    if (typeof verified.payload.exp !== "number") {
      return { ok: false, code: "TOKEN_EXPIRY_REQUIRED" }
    }
    return { ok: true, principal: Object.freeze({
      subject: verified.payload.sub,
      clientId,
      scopes: Object.freeze(scopes),
      issuer: input.config.issuer,
      resource: input.config.resource,
      expiresAt: verified.payload.exp,
    }) }
  } catch (error) {
    return { ok: false, code: mapJwtVerificationFailure(error) }
  }
}

function safeWwwAuthenticateValue(value: string) {
  return value.replace(/["\\\r\n]/g, "")
}

export function buildSellerOsMcpWwwAuthenticateV1(
  config: SellerOsMcpOAuthConfigurationV1,
  error?: "invalid_token" | "insufficient_scope",
) {
  const parts = [
    `Bearer resource_metadata="${safeWwwAuthenticateValue(config.resourceMetadataUrl)}"`,
    `scope="${config.requiredScope}"`,
  ]
  if (error) parts.push(`error="${error}"`)
  return parts.join(", ")
}

function oauthFailureResponse(
  config: SellerOsMcpOAuthConfigurationV1,
  code: SellerOsMcpOAuthFailureCodeV1,
) {
  const insufficientScope = code === "WRONG_SCOPE"
  return Response.json({
    error: insufficientScope ? "insufficient_scope" : "invalid_token",
    error_description: insufficientScope
      ? "The exact seller_os.read scope is required."
      : "The bearer access token was rejected.",
  }, {
    status: insufficientScope ? 403 : 401,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "WWW-Authenticate": buildSellerOsMcpWwwAuthenticateV1(
        config,
        insufficientScope ? "insufficient_scope" : "invalid_token",
      ),
      "X-Seller-OS-Assistant-Mode": "READ_ONLY",
      "X-Seller-OS-MCP-OAuth-Version": SELLER_OS_MCP_OAUTH_VERSION,
    },
  })
}

export async function authenticateSellerOsMcpRequestV1(
  request: Request,
  options: {
    config?: SellerOsMcpOAuthConfigurationV1
    metadata?: SellerOsMcpAuthorizationServerMetadataV1
    keyResolver?: JWTVerifyGetKey
    fetchImpl?: FetchLike
    currentDate?: Date
  } = {},
): Promise<{ ok: true; principal: SellerOsMcpOAuthPrincipalV1 } |
  { ok: false; code: SellerOsMcpOAuthFailureCodeV1; response: Response }> {
  const loaded = options.config
    ? { ok: true as const, config: options.config }
    : loadSellerOsMcpOAuthConfigurationV1()
  if (!loaded.ok) return { ok: false, code: loaded.code, response: Response.json({
    error: "temporarily_unavailable",
    error_description: "Seller OS MCP OAuth activation is not configured.",
  }, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } }) }

  const authorization = request.headers.get("authorization")
  if (!authorization) return { ok: false, code: "NO_TOKEN",
    response: oauthFailureResponse(loaded.config, "NO_TOKEN") }
  const bearer = /^Bearer\s+([^\s,]+)$/i.exec(authorization)
  if (!bearer) return { ok: false, code: "MALFORMED_TOKEN",
    response: oauthFailureResponse(loaded.config, "MALFORMED_TOKEN") }

  const discovered = options.metadata
    ? { ok: true as const, metadata: options.metadata }
    : await discoverSellerOsMcpAuthorizationServerV1(loaded.config, {
      fetchImpl: options.fetchImpl,
    })
  if (!discovered.ok) return { ok: false, code: discovered.code,
    response: Response.json({ error: "temporarily_unavailable",
      error_description: "The OAuth authorization server is not ready." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    }) }
  const verified = await verifySellerOsMcpAccessTokenV1({
    token: bearer[1],
    config: loaded.config,
    metadata: discovered.metadata,
    keyResolver: options.keyResolver,
    currentDate: options.currentDate,
  })
  if (!verified.ok) return { ok: false, code: verified.code,
    response: oauthFailureResponse(loaded.config, verified.code) }
  return verified
}

export function buildSellerOsMcpProtectedResourceMetadataV1(
  config: SellerOsMcpOAuthConfigurationV1,
) {
  return OAuthProtectedResourceMetadataSchema.parse({
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ["header"],
    resource_name: "Seller OS private read-only MCP",
  })
}

export function handleSellerOsMcpProtectedResourceMetadataV1() {
  const loaded = loadSellerOsMcpOAuthConfigurationV1()
  if (!loaded.ok) return Response.json({
    error: "temporarily_unavailable",
    error_description: "Seller OS MCP OAuth activation is not configured.",
  }, { status: 503, headers: { "Cache-Control": "public, max-age=60" } })
  return Response.json(buildSellerOsMcpProtectedResourceMetadataV1(loaded.config), {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "X-Seller-OS-MCP-OAuth-Version": SELLER_OS_MCP_OAUTH_VERSION,
    },
  })
}
