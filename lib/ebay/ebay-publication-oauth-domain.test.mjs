import assert from "node:assert/strict"
import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildEbayPublicationConsentUrl,
  createEbayPublicationOAuthState,
  EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION,
  EBAY_PUBLICATION_OAUTH_SCOPES,
  encryptEbayPublicationCredentialBundle,
  publicationIdentityConfirmed,
  publicationScopesConfirmed,
  validateEbayPublicationOAuthPublicKey,
} from "./ebay-publication-oauth-domain.ts"

function decryptBundle(envelope, privateKey) {
  const parsed = JSON.parse(envelope)
  const key = privateDecrypt({
    key: privateKey,
    oaepHash: "sha256",
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  }, Buffer.from(parsed.encryptedKey, "base64"))
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"))
}

test("publication consent requests the exact write, account and identity scopes", () => {
  const state = createEbayPublicationOAuthState()
  const authorizationUrl = buildEbayPublicationConsentUrl({
    clientId: "official-client-id",
    runame: "official-runame",
    state,
  })
  const parsed = new URL(authorizationUrl)
  assert.equal(parsed.origin, "https://auth.ebay.com")
  assert.equal(parsed.pathname, "/oauth2/authorize")
  assert.equal(parsed.searchParams.get("client_id"), "official-client-id")
  assert.equal(parsed.searchParams.get("redirect_uri"), "official-runame")
  assert.equal(parsed.searchParams.get("state"), state)
  assert.deepEqual(
    parsed.searchParams.get("scope")?.split(" "),
    [...EBAY_PUBLICATION_OAUTH_SCOPES],
  )
  assert.doesNotMatch(authorizationUrl, /prompt=|\+|%252F/)
  assert.equal(
    publicationScopesConfirmed(EBAY_PUBLICATION_OAUTH_SCOPES.join(" ")),
    true,
  )
  assert.equal(publicationScopesConfirmed(EBAY_PUBLICATION_OAUTH_SCOPES[0]), false)
  assert.equal(publicationScopesConfirmed(undefined), null)
})

test("publication identity accepts the default eBay identity response safely", () => {
  assert.equal(publicationIdentityConfirmed({ userId: "immutable-user-id" }), true)
  assert.equal(publicationIdentityConfirmed({
    userId: "immutable-user-id",
    status: "CONFIRMED",
  }), true)
  assert.equal(publicationIdentityConfirmed({
    userId: "immutable-user-id",
    status: "ACCOUNTONHOLD",
  }), false)
  assert.equal(publicationIdentityConfirmed({ status: "CONFIRMED" }), false)
})

test("credential handoff encrypts the full isolated profile for the operator only", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  assert.equal(validateEbayPublicationOAuthPublicKey(publicKey), true)
  const input = {
    clientId: "publication-client",
    clientSecret: "publication-secret",
    refreshToken: "publication-refresh-token",
    publicKeyPem: publicKey,
  }
  const encrypted = encryptEbayPublicationCredentialBundle(input)
  assert.doesNotMatch(
    encrypted,
    /publication-client|publication-secret|publication-refresh-token/,
  )
  assert.deepEqual(decryptBundle(encrypted, privateKey), {
    version: EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION,
    clientId: "publication-client",
    clientSecret: "publication-secret",
    refreshToken: "publication-refresh-token",
  })
  assert.equal(input.clientId, "")
  assert.equal(input.clientSecret, "")
  assert.equal(input.refreshToken, "")
})

test("publication OAuth remains environment-bound, ciphertext-only and zero-write", async () => {
  const [service, startRoute, statusRoute, callback, migration, boundaries] =
    await Promise.all([
      readFile("lib/ebay/ebay-publication-oauth-authorization.ts", "utf8"),
      readFile("app/api/admin/ebay/publication-oauth/start/route.ts", "utf8"),
      readFile("app/api/admin/ebay/publication-oauth/status/route.ts", "utf8"),
      readFile(
        "app/api/admin/ebay/commercial-orders-oauth/callback/route.ts",
        "utf8",
      ),
      readFile(
        "supabase/migrations/20260721050000_create_ebay_publication_oauth_handoff.sql",
        "utf8",
      ),
      readFile("lib/ebay/environment-boundaries.ts", "utf8"),
    ])
  assert.match(service, /EBAY_PUBLICATION_OAUTH_WRITE_GATES_MUST_REMAIN_OFF/)
  assert.match(service, /EBAY_PUBLICATION_OAUTH_ENVIRONMENT_BLOCKED/)
  assert.match(service, /getEbayPublicationOAuthEnvironmentBoundary/)
  assert.match(service, /environmentAllowed/)
  assert.match(boundaries, /SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION/)
  assert.match(service, /encrypted_credential_bundle: encrypted/)
  assert.match(service, /inventory_scope_confirmed: true/)
  assert.match(service, /account_scope_confirmed: true/)
  assert.match(service, /ebayWrites: 0/)
  assert.match(startRoute, /validateAdminApiRequest/)
  assert.match(statusRoute, /validateAdminApiRequest/)
  assert.doesNotMatch(startRoute, /clientSecret|refreshToken|accessToken/)
  assert.match(callback, /hasPendingEbayPublicationOAuth/)
  assert.match(callback, /completeEbayPublicationOAuth/)
  assert.match(callback, /ebay-seller-os/)
  assert.match(migration, /force row level security/i)
  assert.match(
    migration,
    /revoke all on table public\.ebay_publication_oauth_handoffs\s+from anon, authenticated/is,
  )
  assert.match(migration, /grant select, insert, update.*service_role/is)
  assert.match(migration, /encrypted_credential_bundle is null/is)
  assert.match(boundaries, /\/api\/admin\/ebay\/publication-oauth/)
})
