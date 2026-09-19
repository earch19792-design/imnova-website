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

const admin = await import("./luna-pre-research-admin-api-v1.ts")
const userId = "44444444-4444-4444-8444-444444444444"
const owner = Object.freeze({ ok: true, userId,
  authenticationMode: "admin_user", accessRole: "OWNER_ADMIN" })
const normalEndpoint = "https://seller.example.test/api/admin/ebay/pre-research"
const rerunEndpoint = `${normalEndpoint}/controlled-rerun`
const session = "a".repeat(64)

function csrfContext(overrides = {}) {
  return { actorUserId: userId, adminSessionToken: session,
    requestUrl: rerunEndpoint, origin: null, secFetchSite: "same-origin",
    operation: "CONTROLLED_RERUN", ...overrides }
}

test("only a verified owner-admin user becomes the durable actor", () => {
  assert.deepEqual(admin.assertSellerOsOwnerAdminPreResearchV1(owner), {
    actorSubject: userId,
    actorClientId: "SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1",
  })
  for (const denied of [
    { ok: false },
    { ...owner, authenticationMode: "service_role", userId: null },
    { ...owner, authenticationMode: "seller_os_user" },
    { ...owner, accessRole: "REMOTE_LIVE_OPTIMIZATION_OPERATOR" },
    { ...owner, userId: null },
  ]) assert.throws(() => admin.assertSellerOsOwnerAdminPreResearchV1(denied),
    /OWNER_ADMIN_REQUIRED/)
})

test("closed request schemas reject caller authority and preserve bounded inputs", () => {
  const candidate = { productId: "8028", variantId: "18028",
    sku: "ITEM-8028-PIN-LU-DE" }
  const rerun = { rerunCohortId: "22222222-2222-4222-8222-222222222222",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    reasonCode: "GOLDEN_PILOT_V2_FRESH_EXECUTION",
    expectedContractVersion: "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19",
    candidates: [candidate] }
  assert.equal(admin.parseControlledLunaPreResearchAdminRequestV1(rerun)
    .candidates.length, 1)
  assert.equal(admin.parseNormalLunaPreResearchAdminRequestV1({
    snapshotId: rerun.snapshotId, candidates: rerun.candidates,
  }).candidates.length, 1)
  for (const forbidden of ["actorSubject", "actorClientId", "userId", "role",
    "serviceRole", "authorizationOverride"]) {
    assert.throws(() => admin.parseControlledLunaPreResearchAdminRequestV1({
      ...rerun, [forbidden]: "spoofed",
    }), /REQUEST_REJECTED/)
  }
})

test("CSRF is same-origin, session-bound, single-use, and operation-bound", () => {
  let counter = 0
  const boundary = admin.createSellerOsAdminPreResearchCsrfBoundaryV1({
    random(bytes) { counter += 1; return Buffer.alloc(bytes, counter) },
  })
  const issued = boundary.issue(csrfContext())
  const consume = (overrides = {}) => boundary.consume({ ...csrfContext({
    origin: "https://seller.example.test",
  }), contentType: "application/json", csrfHeader: issued.csrfToken,
  csrfCookie: issued.csrfToken, ...overrides })
  assert.equal(consume().actorUserId, userId)
  assert.throws(() => consume(), /CSRF_REUSED/)

  const missing = boundary.issue(csrfContext())
  assert.throws(() => boundary.consume({ ...csrfContext({
    origin: "https://seller.example.test",
  }), contentType: "application/json", csrfHeader: null,
  csrfCookie: missing.csrfToken }), /CSRF_REJECTED/)

  const crossOrigin = boundary.issue(csrfContext())
  assert.throws(() => boundary.consume({ ...csrfContext({
    origin: "https://evil.example.test", secFetchSite: "cross-site",
  }), contentType: "application/json", csrfHeader: crossOrigin.csrfToken,
  csrfCookie: crossOrigin.csrfToken }), /CSRF_REJECTED/)

  const wrongOperation = boundary.issue(csrfContext())
  assert.throws(() => boundary.consume({ ...csrfContext({
    requestUrl: normalEndpoint, origin: "https://seller.example.test",
    operation: "NORMAL_PRE_RESEARCH",
  }), contentType: "application/json", csrfHeader: wrongOperation.csrfToken,
  csrfCookie: wrongOperation.csrfToken }), /CSRF_SUBJECT_MISMATCH/)
})

test("routes authorize and consume CSRF before constructing service-role client", () => {
  const routes = [
    readFileSync("app/api/admin/ebay/pre-research/route.ts", "utf8"),
    readFileSync(
      "app/api/admin/ebay/pre-research/controlled-rerun/route.ts", "utf8"),
  ]
  for (const source of routes) {
    const post = source.slice(source.indexOf("export async function POST"))
    const authAt = post.indexOf("validateAdminApiRequest(request)")
    const ownerAt = post.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)")
    const csrfAt = post.indexOf(".consume({")
    const serviceRoleAt = post.indexOf("getSupabaseAdminClient()")
    assert.ok(authAt >= 0 && ownerAt > authAt && csrfAt > ownerAt &&
      serviceRoleAt > csrfAt)
    assert.match(source, /sameSite: "strict"/)
    assert.match(source, /httpOnly: true/)
    assert.match(source, /private, no-store, no-cache/)
    assert.doesNotMatch(source, /export async function (?:PUT|PATCH|DELETE)/)
  }
})

test("MCP and tunnel catalogs remain read-only with both mutations absent", () => {
  const server = readFileSync("lib/ebay/ebay-seller-os-mcp-server-v1.ts", "utf8")
  const runtime = readFileSync("lib/ebay/ebay-seller-os-runtime-health-v1.ts", "utf8")
  const tunnel = readFileSync(
    "lib/ebay/ebay-seller-os-mcp-tunnel-development-v1.ts", "utf8")
  for (const source of [server, runtime]) {
    assert.doesNotMatch(source, /seller_os_request_luna_pre_research/)
  }
  assert.match(tunnel, /assistantWriteTools[^\n]*=== 0|ASSISTANT_WRITE_TOOLS_FORBIDDEN/)
  assert.doesNotMatch(server,
    /SellerOsMcpOAuthPrincipalV1|oauthPrincipal|seller_os\.command/)
})
