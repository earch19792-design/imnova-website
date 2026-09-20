import { createClient } from "@supabase/supabase-js"

export const SELLER_OS_CONTROL_OAUTH_ENVIRONMENT_V1 = Object.freeze({
  issuer: "SELLER_OS_CONTROL_OAUTH_ISSUER",
  resource: "SELLER_OS_CONTROL_OAUTH_RESOURCE",
})

export type SellerOsControlPrincipalV1 = Readonly<{
  ownerUserId: string
  commandClientId: string
  scopes: readonly string[]
}>

function httpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash ? url.href : null
  } catch {
    return null
  }
}

export function loadSellerOsControlOAuthConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const issuer = httpsUrl(environment.SELLER_OS_CONTROL_OAUTH_ISSUER?.trim() ?? "")
  const resource = httpsUrl(environment.SELLER_OS_CONTROL_OAUTH_RESOURCE?.trim() ?? "")
  if (!issuer || !resource) return null
  const resourceUrl = new URL(resource)
  const metadataUrl = new URL(
    `/.well-known/oauth-protected-resource${resourceUrl.pathname === "/"
      ? "" : resourceUrl.pathname}`, resourceUrl).href
  return Object.freeze({ issuer, resource, metadataUrl })
}

function bearer(request: Request) {
  return /^Bearer\s+([^\s,]+)$/i.exec(
    request.headers.get("authorization") ?? "")?.[1] ?? null
}

function jwtPayload(token: string) {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function unauthorized(config: NonNullable<ReturnType<
  typeof loadSellerOsControlOAuthConfigurationV1>>, code = "invalid_token") {
  return Response.json({ error: code,
    error_description: "A verified user-scoped Seller OS control token is required." }, {
    status: code === "insufficient_scope" ? 403 : 401,
    headers: { "Cache-Control": "private, no-store, max-age=0",
      "WWW-Authenticate": `Bearer resource_metadata="${config.metadataUrl}", scope="openid profile"`,
      "X-Seller-OS-Control-Mode":
        "BOUNDED_PRE_RESEARCH_AND_COMMERCIAL_TRACE_V1" },
  })
}

export async function authenticateSellerOsControlRequestV1(request: Request) {
  const config = loadSellerOsControlOAuthConfigurationV1()
  if (!config) return { ok: false as const, response: Response.json({
    error: "temporarily_unavailable",
    error_description: "Seller OS Control OAuth is not configured.",
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } }) }
  const token = bearer(request)
  if (!token) return { ok: false as const, response: unauthorized(config) }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
  if (!url || !anon) return { ok: false as const, response: unauthorized(config) }
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const verified = await client.auth.getUser(token)
  const claims = jwtPayload(token)
  const userId = verified.data.user?.id ?? ""
  const subject = typeof claims?.sub === "string" ? claims.sub : ""
  const clientId = typeof claims?.client_id === "string" ? claims.client_id
    : typeof claims?.azp === "string" ? claims.azp : ""
  const issuer = typeof claims?.iss === "string" ? claims.iss : ""
  const role = typeof claims?.role === "string" ? claims.role : ""
  const expiry = typeof claims?.exp === "number" ? claims.exp : 0
  const scopes = typeof claims?.scope === "string"
    ? [...new Set(claims.scope.split(/\s+/).filter(Boolean))] : []
  if (verified.error || !verified.data.user || !userId || subject !== userId ||
      issuer.replace(/\/$/, "") !== config.issuer.replace(/\/$/, "") ||
      role !== "authenticated" || !clientId || expiry <= Date.now() / 1000 ||
      !scopes.includes("openid")) {
    return { ok: false as const, response: unauthorized(config) }
  }
  return { ok: true as const, config,
    principal: Object.freeze({ ownerUserId: userId,
      commandClientId: clientId, scopes: Object.freeze(scopes) }) }
}

export function handleSellerOsControlProtectedResourceMetadataV1() {
  const config = loadSellerOsControlOAuthConfigurationV1()
  if (!config) return Response.json({ error: "temporarily_unavailable" },
    { status: 503, headers: { "Cache-Control": "public, max-age=60" } })
  return Response.json({ resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ["openid", "profile"],
    bearer_methods_supported: ["header"],
    resource_name: "IMNOVA Seller OS - Control" }, {
    headers: { "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300" },
  })
}
