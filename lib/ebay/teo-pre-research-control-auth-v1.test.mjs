import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const oauth = await import("./teo-pre-research-control-oauth-v1.ts")
const route = readFileSync(
  "app/api/admin/ebay/pre-research-control/capability/route.ts", "utf8")
const consent = readFileSync(
  "app/admin/ebay/pre-research-control/oauth/consent/control-oauth-consent.tsx",
  "utf8")

test("control OAuth configuration is isolated from read-only MCP configuration", () => {
  const config = oauth.loadSellerOsControlOAuthConfigurationV1({
    SELLER_OS_CONTROL_OAUTH_ISSUER: "https://auth.example.test/auth/v1",
    SELLER_OS_CONTROL_OAUTH_RESOURCE:
      "https://seller.example.test/api/seller-os/control/mcp",
  })
  assert.equal(config.resource,
    "https://seller.example.test/api/seller-os/control/mcp")
  assert.equal(config.metadataUrl,
    "https://seller.example.test/.well-known/oauth-protected-resource/api/seller-os/control/mcp")
  assert.equal(oauth.loadSellerOsControlOAuthConfigurationV1({}), null)
})

test("owner consent derives owner/client bindings server-side before service role", () => {
  const post = route.slice(route.indexOf("export async function POST"))
  const authAt = post.indexOf("validateAdminApiRequest(request)")
  const ownerAt = post.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)")
  const csrfAt = post.indexOf(".consume({")
  const detailsAt = post.indexOf("authorizationDetails(")
  const serviceAt = post.indexOf("getSupabaseAdminClient().rpc(")
  assert.ok(authAt >= 0 && ownerAt > authAt && csrfAt > ownerAt &&
    detailsAt > csrfAt && serviceAt > detailsAt)
  assert.match(route, /user\?\.id !== actor\.actorSubject/)
  assert.match(route, /p_command_client_id: clientId/)
  assert.doesNotMatch(post, /body\.(?:ownerUserId|actorSubject|commandClientId)/)
})

test("capability UI supports explicit approval and fail-closed revocation", () => {
  assert.match(consent, /Autorizar control acotado/)
  assert.match(consent, /action: "AUTHORIZE"/)
  assert.match(consent, /action: "DISABLE"/)
  assert.match(route, /disable_seller_os_pre_research_command_v1/)
  assert.match(route, /sameSite: "strict"/)
  assert.match(route, /httpOnly: true/)
})
