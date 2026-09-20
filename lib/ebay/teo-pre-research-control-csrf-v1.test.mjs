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

const csrf = await import("./teo-pre-research-control-csrf-v1.ts")
const route = readFileSync(
  "app/api/admin/ebay/pre-research-control/capability/route.ts", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260920155748_control_oauth_durable_csrf_v1.sql",
  "utf8")

const NOW = Date.parse("2026-09-20T16:00:00.000Z")
const OWNER = "79bdf9e4-9daa-476b-93f5-a38f39e10ee7"
const SESSION = "session-token-".padEnd(80, "s")
const SECRET = "service-role-authority-".padEnd(80, "k")
const ENDPOINT =
  "https://imnova-seller-os-preprod.vercel.app/api/admin/ebay/pre-research-control/capability"

function context(overrides = {}) {
  return { actorUserId: OWNER, adminSessionToken: SESSION,
    requestUrl: ENDPOINT, origin: null, secFetchSite: "same-origin",
    operation: "TEO_CONTROL_AUTHORIZATION", ...overrides }
}

function issue(at = NOW) {
  return csrf.issueSellerOsControlCsrfV1(context(), {
    signingSecret: SECRET,
    now: () => at,
    random: (bytes) => Buffer.alloc(bytes, 7),
  })
}

function consumer(token, consumeReplay, overrides = {}) {
  return csrf.consumeSellerOsControlCsrfV1(context({
    origin: "https://imnova-seller-os-preprod.vercel.app",
    contentType: "application/json",
    csrfHeader: token,
    csrfCookie: token,
    ...overrides,
  }), { signingSecret: SECRET, now: () => NOW, consumeReplay })
}

test("login then authenticated consent issues a fresh cross-instance CSRF token", async () => {
  const issued = issue()
  assert.match(issued.csrfToken,
    /^pr2\.[0-9a-z]{6,12}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(issued.singleUse, true)
  let stored = null
  const receipt = await consumer(issued.csrfToken, async (entry) => {
    stored = entry
    return true
  })
  assert.equal(receipt.actorUserId, OWNER)
  assert.match(stored.tokenDigest, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(stored).includes(issued.csrfToken), false)
})

test("missing header or cookie remains rejected", async () => {
  const token = issue().csrfToken
  for (const overrides of [
    { csrfHeader: null },
    { csrfCookie: null },
  ]) await assert.rejects(
    consumer(token, async () => true, overrides), /CSRF_REJECTED/)
})

test("incorrect token and cookie-header mismatch remain rejected", async () => {
  const token = issue().csrfToken
  const replacement = token.endsWith("A") ? "B" : "A"
  const incorrect = `${token.slice(0, -1)}${replacement}`
  await assert.rejects(consumer(incorrect, async () => true),
    /CSRF_SUBJECT_MISMATCH/)
  await assert.rejects(consumer(token, async () => true, {
    csrfCookie: incorrect,
  }), /CSRF_REJECTED/)
})

test("old token is rejected before the durable replay store", async () => {
  const old = issue(NOW - csrf.SELLER_OS_CONTROL_CSRF_TTL_MS - 2_000)
  let called = false
  await assert.rejects(consumer(old.csrfToken, async () => {
    called = true
    return true
  }), /CSRF_EXPIRED/)
  assert.equal(called, false)
})

test("consumed token and replay are rejected atomically", async () => {
  const token = issue().csrfToken
  const consumed = new Set()
  const durableConsume = async ({ tokenDigest }) => {
    if (consumed.has(tokenDigest)) return false
    consumed.add(tokenDigest)
    return true
  }
  await assert.doesNotReject(consumer(token, durableConsume))
  await assert.rejects(consumer(token, durableConsume), /CSRF_REUSED/)
})

test("session, owner, origin, operation, and content type stay bound", async () => {
  const token = issue().csrfToken
  for (const overrides of [
    { adminSessionToken: "other-session-".padEnd(80, "x") },
    { actorUserId: "11111111-1111-4111-8111-111111111111" },
    { origin: "https://evil.example.test", secFetchSite: "cross-site" },
    { operation: "NORMAL_PRE_RESEARCH" },
    { contentType: "text/plain" },
  ]) await assert.rejects(consumer(token, async () => true, overrides),
    /CSRF_(?:REJECTED|SUBJECT_MISMATCH)/)
})

test("route emits only after OWNER login and consumes before OAuth approval", () => {
  const get = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function DELETE"))
  const post = route.slice(route.indexOf("export async function POST"))
  assert.ok(get.indexOf("validateAdminApiRequest(request)") >= 0)
  assert.ok(get.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)") >
    get.indexOf("validateAdminApiRequest(request)"))
  assert.ok(get.indexOf("issueSellerOsControlCsrfV1(") >
    get.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)"))
  assert.ok(post.indexOf("await consumeControlCsrf(") >
    post.indexOf("assertSellerOsOwnerAdminPreResearchV1(auth)"))
  assert.ok(post.indexOf("authorizeSellerOsControlConsentV1({") >
    post.indexOf("await consumeControlCsrf("))
  assert.match(route, /httpOnly: true/)
  assert.match(route, /sameSite: "strict"/)
  assert.match(route, /secure: request\.nextUrl\.protocol === "https:"/)
  assert.match(route, /path: ENDPOINT/)
})

test("durable replay ledger is service-role-only and cannot grant authority", () => {
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i)
  assert.match(migration, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/i)
  assert.match(migration, /on conflict \(token_digest\) do nothing/i)
  assert.match(migration, /get diagnostics v_inserted = row_count/i)
  assert.match(migration,
    /revoke all[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute[\s\S]*to service_role/i)
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from)\s+(?:auth\.oauth_|public\.seller_os_pre_research_command_capabilities_v1|public\.seller_os_pre_research_batches_v1)/i)
})
