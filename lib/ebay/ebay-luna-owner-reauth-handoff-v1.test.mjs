import assert from "node:assert/strict"
import {
  constants,
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true }
  }
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const domain = await import("./ebay-luna-owner-reauth-handoff-v1.ts")

const ACTOR = "11111111-1111-4111-8111-111111111111"
const CHALLENGE = "22222222-2222-4222-8222-222222222222"
const NOW = Date.parse("2026-08-30T03:00:00.000Z")

function dedicatedPreprod() {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    VERCEL_PROJECT_ID: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
    VERCEL_PROJECT_PRODUCTION_URL: "imnova-seller-os-preprod.vercel.app",
    EBAY_PRO_RUNTIME: "staging",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
  }
}

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) =>
    [key, process.env[key]]))
  Object.assign(process.env, values)
  try { return await run() } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function fakeRpc(options = {}) {
  const state = {
    claimed: false,
    storedPayload: null,
    completeCalls: [],
    privateKeyPem: null,
    expiresAt: null,
  }
  return {
    state,
    client: {
      async rpc(name, args) {
        if (name === "create_seller_os_luna_owner_handoff_v1") {
          state.privateKeyPem = args.p_private_key_pem
          state.expiresAt = args.p_expires_at
          return { data: CHALLENGE, error: null }
        }
        if (name === "claim_seller_os_luna_owner_handoff_v1") {
          if (options.claimError) {
            return { data: null, error: { code: "SAFE_TEST_RPC_ERROR" } }
          }
          if (state.claimed) return { data: null, error: null }
          state.claimed = true
          return { data: {
            actorUserId: ACTOR,
            privateKeyPem: state.privateKeyPem,
            expiresAt: options.claimExpiresAt ??
              state.expiresAt.replace(/Z$/, "+00:00"),
            environmentBinding: options.claimEnvironment ??
              domain.SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
          }, error: null }
        }
        if (name === "store_seller_os_luna_protected_session_v1") {
          state.storedPayload = args.p_session_payload
          return { data: true, error: null }
        }
        if (name === "get_seller_os_luna_protected_session_v1") {
          return { data: state.storedPayload, error: null }
        }
        if (name === "complete_seller_os_luna_owner_handoff_v1") {
          state.completeCalls.push(args)
          return { data: true, error: null }
        }
        return { data: null, error: { code: "UNEXPECTED_RPC" } }
      },
    },
  }
}

function encrypt(challenge, privateKeyPem) {
  const session = Buffer.from(JSON.stringify({
    contractVersion: "SELLER_OS_LUNA_PROTECTED_SESSION_V1",
    cookieHeader: "customer_account_session=owner-session-fixture",
    capturedAt: new Date(NOW - 1_000).toISOString(),
    validatedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
  }))
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from([
    domain.SELLER_OS_LUNA_OWNER_HANDOFF_VERSION,
    challenge.challengeId,
    domain.SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
    challenge.expiresAt,
  ].join("\u0000")))
  const ciphertext = Buffer.concat([cipher.update(session), cipher.final()])
  const publicKeyPem = (awaitablePublicKey(privateKeyPem))
  const wrappedKey = publicEncrypt({ key: publicKeyPem,
    padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key)
  const result = {
    contractVersion: domain.SELLER_OS_LUNA_OWNER_HANDOFF_VERSION,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    environmentBinding: domain.SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
    expiresAt: challenge.expiresAt,
    wrappedKey: wrappedKey.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  }
  session.fill(0); key.fill(0); iv.fill(0); ciphertext.fill(0); wrappedKey.fill(0)
  return result
}

function awaitablePublicKey(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "pem" })
}

test("admin creates one short-lived environment-bound challenge without session material", async () => {
  const fake = fakeRpc()
  const result = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  assert.equal(result.challengeId, CHALLENGE)
  assert.equal(result.oneTime, true)
  assert.equal(result.ownerAdminCreated, true)
  assert.equal(result.plaintextSessionAccepted, false)
  assert.equal(Date.parse(result.expiresAt) - NOW,
    domain.SELLER_OS_LUNA_OWNER_HANDOFF_TTL_MS)
  assert.match(fake.state.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|cookieHeader/)
})

test("encrypted owner upload is claimed once, officially probed and stored in existing Vault contract", async () => {
  const fake = fakeRpc()
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  const fetchImpl = async () => new Response("", { status: 200 })
  const result = await withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client, fetchImpl,
    }))
  assert.equal(result.status, "SESSION_READY")
  assert.equal(result.challengeConsumed, true)
  assert.equal(result.privateKeyDestroyedAtClaim, true)
  assert.equal(result.plaintextSessionReturned, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.match(fake.state.storedPayload, /SELLER_OS_LUNA_PROTECTED_SESSION_V1/)
  assert.equal(fake.state.completeCalls.length, 1)
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client, fetchImpl,
    })), /LUNA_OWNER_HANDOFF_REPLAY_OR_EXPIRED/)
})

test("Postgres offset and JavaScript Z expiry representations bind to the same instant", async () => {
  assert.equal(domain.sellerOsLunaOwnerHandoffSameInstantV1(
    "2026-08-30T03:08:00.000+00:00",
    "2026-08-30T03:08:00.000Z",
  ), true)
  assert.equal(domain.sellerOsLunaOwnerHandoffSameInstantV1(
    "2026-08-30T03:08:01.000+00:00",
    "2026-08-30T03:08:00.000Z",
  ), false)
})

test("every validation failure after a successful claim closes the ledger as FAILED", async () => {
  const fake = fakeRpc({ claimEnvironment: "WRONG_SAFE_TEST_ENVIRONMENT" })
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client,
    })), /LUNA_OWNER_HANDOFF_POST_CLAIM_VALIDATION_FAILED/)
  assert.equal(fake.state.completeCalls.length, 1)
  assert.equal(fake.state.completeCalls[0].p_success, false)
  assert.equal(fake.state.completeCalls[0].p_result_code,
    "LUNA_OWNER_HANDOFF_POST_CLAIM_VALIDATION_FAILED")
})

test("failed pre-Vault probes persist their canonical bounded classification", async () => {
  const fake = fakeRpc()
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client,
      fetchImpl: async () => new Response("", { status: 401 }),
    })), /LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_AUTH_REQUIRED_4XX_LUNA_ACCOUNT/)
  assert.equal(fake.state.storedPayload, null)
  assert.equal(fake.state.completeCalls.length, 1)
  assert.equal(fake.state.completeCalls[0].p_success, false)
  assert.equal(fake.state.completeCalls[0].p_result_code,
    "LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_AUTH_REQUIRED_4XX_LUNA_ACCOUNT")
})

test("login redirects remain distinguishable without persisting URLs or bodies", async () => {
  const fake = fakeRpc()
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  const fetchImpl = async (url) => String(url).includes("authentication/login")
    ? new Response("", { status: 200 })
    : new Response("", { status: 302, headers: {
      Location: "https://account.lunaportex.com/authentication/login",
    } })
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client, fetchImpl,
    })), /LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_SOURCE_UNAVAILABLE_2XX_AUTHENTICATION_REQUIRED/)
  assert.equal(fake.state.storedPayload, null)
  assert.equal(fake.state.completeCalls.length, 1)
  assert.equal(fake.state.completeCalls[0].p_result_code,
    "LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_SOURCE_UNAVAILABLE_2XX_AUTHENTICATION_REQUIRED")
})

test("claim RPC failures remain distinct from a real null replay result", async () => {
  const fake = fakeRpc({ claimError: true })
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: NOW, client: fake.client,
    })), /LUNA_OWNER_HANDOFF_CLAIM_UNAVAILABLE/)
  assert.equal(fake.state.completeCalls.length, 0)
})

test("wrong runtime boundary and expired upload fail before Vault persistence", async () => {
  const fake = fakeRpc()
  await assert.rejects(domain.createSellerOsLunaOwnerHandoffV1({
    actorUserId: ACTOR, now: NOW, client: fake.client,
  }), /LUNA_OWNER_HANDOFF_DEDICATED_PREPROD_REQUIRED/)
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: NOW, client: fake.client,
    }))
  const envelope = encrypt(challenge, fake.state.privateKeyPem)
  await assert.rejects(withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: Date.parse(challenge.expiresAt) + 1, client: fake.client,
    })), /LUNA_OWNER_HANDOFF_EXPIRED/)
  assert.equal(fake.state.storedPayload, null)
})

test("SQL challenge ledger is RLS-closed, Vault-backed, bounded and destroys key at claim", async () => {
  const sql = await readFile(
    "supabase/migrations/20260830023000_create_luna_owner_reauth_handoff_v1.sql",
    "utf8",
  )
  assert.match(sql, /enable row level security/)
  assert.match(sql, /force row level security/)
  assert.match(sql, /LUNA_OWNER_HANDOFF_OWNER_ADMIN_REQUIRED/)
  assert.match(sql, /vault\.create_secret/)
  assert.match(sql, /delete from vault\.secrets/)
  assert.match(sql, /status = 'PENDING'[\s\S]*expires_at > p_now/)
  assert.match(sql, /status = 'CLAIMED'/)
  assert.doesNotMatch(sql, /cookieHeader|session_payload|raw_session/)
})

test("existing Vault RPC accepts versioned V2 jar while preserving legacy V1", async () => {
  const sql = await readFile(
    "supabase/migrations/20260830060648_extend_luna_protected_session_cookie_jar_v2.sql",
    "utf8",
  )
  assert.match(sql,
    /create or replace function public\.store_seller_os_luna_protected_session_v1/)
  assert.match(sql, /SELLER_OS_LUNA_PROTECTED_SESSION_V1/)
  assert.match(sql, /SELLER_OS_LUNA_PROTECTED_SESSION_V2/)
  assert.match(sql, /jsonb_array_length\(v_payload->'cookieJar'\) not between 1 and 24/)
  assert.match(sql, /www\.lunaportex\.com', 'account\.lunaportex\.com/)
  assert.doesNotMatch(sql, /create table|create schema|scheduler|pipeline/i)
})

test("owner-only extension is separate, optional, exact-host and contains no browser automation", async () => {
  const extensionRoot =
    "tools/browser-extensions/luna-owner-session-handoff"
  const manifest = JSON.parse(await readFile(
    `${extensionRoot}/manifest.json`, "utf8"))
  const contract = await readFile(`${extensionRoot}/contract.mjs`, "utf8")
  const background = await readFile(`${extensionRoot}/background.mjs`, "utf8")
  const content = await readFile(`${extensionRoot}/admin-content.js`, "utf8")
  const popup = await readFile(`${extensionRoot}/popup.js`, "utf8")
  const popupHtml = await readFile(`${extensionRoot}/popup.html`, "utf8")
  const readme = await readFile(`${extensionRoot}/README.md`, "utf8")
  const shippingManifest = JSON.parse(await readFile(
    "tools/browser-extensions/luna-shipping-capture/manifest.json", "utf8"))
  const retiredHelper = await readFile(
    "tools/luna-owner-reauth-handoff.mjs", "utf8")
  const route = await readFile(
    "app/api/admin/ebay/luna-protected-session/route.ts",
    "utf8",
  )
  const protectedSessionServer = await readFile(
    "lib/ebay/ebay-luna-protected-session-server-v1.ts", "utf8")
  const shippingServer = await readFile(
    "lib/ebay/ebay-luna-authoritative-shipping-server-v1.ts", "utf8")
  const page = await readFile(
    "app/admin/ebay/luna-protected-session/page.tsx", "utf8")
  assert.equal(manifest.name, "Seller OS — Luna Owner Session Handoff")
  assert.deepEqual(manifest.permissions, ["scripting"])
  assert.deepEqual(manifest.optional_permissions, ["cookies"])
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://www.lunaportex.com/*",
    "https://account.lunaportex.com/*",
  ])
  assert.equal(manifest.host_permissions, undefined)
  assert.equal(manifest.externally_connectable, undefined)
  assert.equal(manifest.permissions.includes("storage"), false)
  assert.equal(manifest.optional_host_permissions.includes("<all_urls>"), false)
  assert.equal(shippingManifest.permissions.includes("cookies"), false)
  assert.equal(shippingManifest.optional_permissions, undefined)
  assert.match(contract, /AES-GCM/)
  assert.match(contract, /RSA-OAEP/)
  assert.match(contract, /SHA-256/)
  assert.match(contract, /sessionBytes\?\.fill\(0\)/)
  assert.match(background, /chrome\.permissions\.remove/)
  assert.match(background, /exactAdminTabId\(adminTabIdInput\)/)
  assert.match(background, /sendMessage\(adminTabId/)
  assert.doesNotMatch(background, /tabs\.query\(\{\s*url:\s*ADMIN_PATTERN/)
  assert.match(background, /chrome\.cookies\.getAll/)
  assert.match(background, /chrome\.scripting\.executeScript/)
  assert.doesNotMatch([contract, background, content, popup].join("\n"),
    /chrome\.storage|localStorage|sessionStorage|clipboard|console\.(?:log|error)|connectOverCDP|playwright|chromium\.launch|debugger/)
  assert.match(popup, /chrome\.permissions\.request/)
  assert.match(popup, /tabs\.query\(\{ active: true, currentWindow: true \}\)/)
  assert.match(popup, /SELLER_OS_LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_PROBE_V1/)
  assert.match(popup, /response\.adminContextConfirmed !== true/)
  assert.match(popup, /response\.challengeStatePresent !== true/)
  assert.match(popup, /adminTabId,/)
  assert.match(content, /message\?\.type === ADMIN_CONTEXT_PROBE/)
  assert.match(content, /adminContextConfirmed: true/)
  assert.match(content, /challengeStatePresent,/)
  assert.doesNotMatch(content, /chrome\.cookies|chrome\.permissions/)
  assert.match(popupHtml, /id="check"/)
  assert.match(popupHtml, /id="transfer" type="button" disabled/)
  assert.ok(popup.indexOf("await confirmAdminContext()") <
    popup.indexOf("chrome.permissions.request"),
  "admin content-script handshake must precede optional cookie permission")
  assert.equal(manifest.version, "1.1.0")
  assert.match(contract, /BUILD_VERSION = "1\.1\.0"/)
  assert.match(content, /VERSION = "1\.1\.0"/)
  assert.match(contract,
    /LUNA_SESSION_CONSUMER_URL =\s*\n\s*"https:\/\/www\.lunaportex\.com\/account"/)
  assert.match(protectedSessionServer,
    /SESSION_PROBE_ENTRYPOINT = "https:\/\/www\.lunaportex\.com\/account"/)
  assert.match(shippingServer,
    /LUNA_ORIGIN = "https:\/\/www\.lunaportex\.com"/)
  assert.equal((background.match(/chrome\.cookies\.getAll\(\{/g) ?? []).length,
    2)
  assert.match(background,
    /chrome\.cookies\.getAll\(\{\s*\n\s*url: LUNA_SESSION_CONSUMER_URL/)
  assert.doesNotMatch(background,
    /chrome\.cookies\.getAll\(\{ url: "https:\/\/(?:lunaportex|account\.lunaportex)/)
  assert.match(background, /cookieSetCandidateCount: 1/)
  assert.match(background, /diagnoseAuthenticatedCookieContexts/)
  assert.match(background, /ownerBrowserProtectedPageAuthenticated: true/)
  assert.match(background, /url\.hostname !== "account\.lunaportex\.com"/)
  assert.match(background,
    /cookieApplicabilityUrl: `\$\{url\.origin\}\$\{url\.pathname \|\| "\/"\}`/)
  assert.match(popup, /confirmAdminContext\(\{ requireChallenge: false \}\)/)
  assert.match(popup, /ACCOUNT_ONLY_COOKIE_IDENTITY_COUNT/)
  assert.match(popup, /result\.cookieSetCandidateCount !== 1/)
  assert.match(popup,
    /LUNA_OWNER_EXTENSION_ENCRYPTED_HANDOFF_DELIVERED_MULTI_HOST/)
  assert.match(readme, /No usa Playwright, CDP/)
  assert.match(retiredHelper, /LUNA_OWNER_SESSION_HANDOFF_EXTENSION_REQUIRED/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /console\.(?:log|error)|request\.json\(\).*console/)
  assert.match(route, /playwrightOwnerHandoffEligible: false/)
  assert.match(route, /cdpOwnerHandoffEligible: false/)
  assert.match(route, /lunaShippingExtensionReadsCookies: false/)
  assert.match(page, /Luna necesita volver a iniciar sesión/)
  assert.match(page, /Renovar sesión/)
  assert.match(page, /Seller OS — Luna Owner Session Handoff/)
  assert.doesNotMatch(page, /createObjectURL|anchor\.download|luna-owner-reauth-handoff\.mjs/)
  assert.match(page, /action: "OWNER_HANDOFF"/)
})

test("extension V2 envelope keeps exclusive www and account cookies scoped across redirects", async () => {
  const extension = await import(new URL(
    "../../tools/browser-extensions/luna-owner-session-handoff/contract.mjs",
    import.meta.url,
  ))
  const fake = fakeRpc()
  const challenge = await withEnvironment(dedicatedPreprod(), () =>
    domain.createSellerOsLunaOwnerHandoffV1({
      actorUserId: ACTOR, now: Date.now(), client: fake.client,
    }))
  const capturedAt = Date.now()
  const expiresAt = new Date(capturedAt + 3_600_000).toISOString()
  const envelope = await extension.encryptSessionPayload(challenge, {
    cookieJar: [{
      name: "customer_account_session", value: "www-owner-extension-fixture",
      domain: "www.lunaportex.com", path: "/account", secure: true,
      hostOnly: true, expiresAt,
    }, {
      name: "account_session", value: "account-owner-extension-fixture",
      domain: "account.lunaportex.com", path: "/orders", secure: true,
      hostOnly: true, expiresAt,
    }],
    capturedAt: new Date(capturedAt).toISOString(),
    validatedAt: new Date(capturedAt).toISOString(),
    expiresAt,
  })
  const observed = []
  const result = await withEnvironment(dedicatedPreprod(), () =>
    domain.consumeSellerOsLunaOwnerHandoffV1({
      envelope, now: capturedAt, client: fake.client,
      fetchImpl: async (url, init) => {
        const parsed = new URL(String(url))
        const cookie = new Headers(init?.headers).get("cookie")
        observed.push({ host: parsed.hostname, cookie })
        if (parsed.hostname === "www.lunaportex.com") {
          assert.equal(cookie,
            "customer_account_session=www-owner-extension-fixture")
          assert.doesNotMatch(cookie, /account-owner-extension-fixture/)
          return new Response(null, { status: 302, headers: {
            location: "https://account.lunaportex.com/orders",
          } })
        }
        assert.equal(parsed.hostname, "account.lunaportex.com")
        assert.equal(cookie, "account_session=account-owner-extension-fixture")
        assert.doesNotMatch(cookie, /www-owner-extension-fixture/)
        return new Response("", { status: 200 })
      },
    }))
  assert.equal(result.status, "SESSION_READY")
  assert.equal(result.challengeConsumed, true)
  assert.equal(result.plaintextSessionReturned, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(observed.length, 4)
  assert.deepEqual([...new Set(observed.map((entry) => entry.host))].sort(), [
    "account.lunaportex.com", "www.lunaportex.com",
  ])
})

test("owner extension selects one exact consumer cookie set and keeps conflicts fail-closed", async () => {
  const extension = await import(new URL(
    "../../tools/browser-extensions/luna-owner-session-handoff/contract.mjs",
    import.meta.url,
  ))
  const expiry = (Date.now() + 3_600_000) / 1_000
  const canonical = Object.freeze({
    name: "customer_account_session",
    value: "safe-test-fixture-a",
    domain: ".lunaportex.com",
    path: "/",
    secure: true,
    expirationDate: expiry,
  })
  const selected = extension.selectSessionCookies([canonical, canonical])
  assert.equal(selected.values.length, 1)
  assert.throws(() => extension.selectSessionCookies([
    canonical,
    { ...canonical, value: "safe-test-fixture-b" },
  ]), /LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_AMBIGUOUS/)
  assert.throws(() => extension.selectSessionCookies([{
    ...canonical,
    domain: "account.lunaportex.com",
  }]), /LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_INVALID/)
})

test("owner extension compares authenticated account-host and www consumer cookies without exposing identities", async () => {
  const extension = await import(new URL(
    "../../tools/browser-extensions/luna-owner-session-handoff/contract.mjs",
    import.meta.url,
  ))
  const expiry = (Date.now() + 3_600_000) / 1_000
  const parent = {
    name: "customer_account_session", value: "safe-test-fixture-a",
    domain: ".lunaportex.com", path: "/", secure: true,
    expirationDate: expiry,
  }
  const accountOnly = {
    name: "account_host_only", value: "safe-test-fixture-b",
    domain: "account.lunaportex.com", path: "/orders", secure: true,
    expirationDate: expiry,
  }
  const wwwOnly = {
    name: "www_host_only", value: "safe-test-fixture-c",
    domain: "www.lunaportex.com", path: "/account", secure: true,
    expirationDate: expiry,
  }
  const result = extension.diagnoseAuthenticatedCookieContexts(
    [parent, accountOnly],
    [parent, wwwOnly],
  )
  assert.deepEqual(result, {
    browserApplicableCookieCountForAccountHost: 2,
    browserApplicableCookieCountForWwwAccountUrl: 2,
    overlapCookieIdentityCount: 1,
    accountOnlyCookieIdentityCount: 1,
    wwwOnlyCookieIdentityCount: 1,
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized,
    /customer_account_session|account_host_only|www_host_only|safe-test-fixture/)
})

test("owner extension captures a bounded multi-host jar without flattening host identity", async () => {
  const extension = await import(new URL(
    "../../tools/browser-extensions/luna-owner-session-handoff/contract.mjs",
    import.meta.url,
  ))
  const now = Date.now()
  const expirationDate = (now + 3_600_000) / 1_000
  const selected = extension.selectSessionCookieJar([{
    name: "account_session", value: "account-only-fixture",
    domain: "account.lunaportex.com", path: "/orders", secure: true,
    hostOnly: true, expirationDate,
  }], [{
    name: "customer_account_session", value: "www-only-fixture",
    domain: "www.lunaportex.com", path: "/account", secure: true,
    hostOnly: true, expirationDate,
  }], now)
  assert.equal(selected.values.length, 2)
  assert.deepEqual(selected.values.map((cookie) => ({
    domain: cookie.domain, path: cookie.path, hostOnly: cookie.hostOnly,
  })), [{
    domain: "account.lunaportex.com", path: "/orders", hostOnly: true,
  }, {
    domain: "www.lunaportex.com", path: "/account", hostOnly: true,
  }])
})
