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

function fakeRpc() {
  const state = {
    claimed: false,
    storedPayload: null,
    completeCalls: [],
    privateKeyPem: null,
  }
  return {
    state,
    client: {
      async rpc(name, args) {
        if (name === "create_seller_os_luna_owner_handoff_v1") {
          state.privateKeyPem = args.p_private_key_pem
          return { data: CHALLENGE, error: null }
        }
        if (name === "claim_seller_os_luna_owner_handoff_v1") {
          if (state.claimed) return { data: null, error: null }
          state.claimed = true
          return { data: {
            actorUserId: ACTOR,
            privateKeyPem: state.privateKeyPem,
            expiresAt: new Date(NOW + domain.SELLER_OS_LUNA_OWNER_HANDOFF_TTL_MS)
              .toISOString(),
            environmentBinding: domain.SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
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

test("owner helper is visible, one-shot, exact-origin and never persists or logs session plaintext", async () => {
  const helper = await readFile("tools/luna-owner-reauth-handoff.mjs", "utf8")
  const route = await readFile(
    "app/api/admin/ebay/luna-protected-session/route.ts",
    "utf8",
  )
  const page = await readFile(
    "app/admin/ebay/luna-protected-session/page.tsx", "utf8")
  assert.match(helper, /headless: false/)
  assert.match(helper, /browser\.newContext/)
  assert.match(helper, /await unlink\(challengePath\)/)
  assert.match(helper, /createCipheriv\("aes-256-gcm"/)
  assert.match(helper, /RSA_PKCS1_OAEP_PADDING/)
  assert.match(helper, /sessionPayload\?\.fill\(0\)/)
  assert.doesNotMatch(helper, /storageState|launchServer|connectOverCDP|listen\(/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /console\.(?:log|error)|request\.json\(\).*console/)
  assert.match(page, /Luna necesita volver a iniciar sesión/)
  assert.match(page, /Renovar sesión/)
  assert.match(page, /action: "OWNER_HANDOFF"/)
})
