import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import ts from "typescript"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

async function withEnvironment(values, callback) {
  const prior = new Map()
  for (const [name, next] of Object.entries(values)) {
    prior.set(name, process.env[name])
    if (next === undefined) delete process.env[name]
    else process.env[name] = next
  }
  try {
    return await callback()
  } finally {
    for (const [name, previous] of prior) {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  }
}

function userFingerprint(userId) {
  return createHash("sha256").update(`PRODUCTION:${userId}`).digest("hex")
}

function buildScopeModule() {
  const accountScopeSource = readFileSync(
    "lib/ebay/ebay-seller-account-scope.ts",
    "utf8",
  )
  const rateLimitSource = readFileSync(
    "lib/ebay/ebay-readonly-rate-limit.ts",
    "utf8",
  )
  const tradingSource = readFileSync(
    "lib/ebay/ebay-manual-listing-trading-readonly.ts",
    "utf8",
  )
    .replace(
      'from "./ebay-seller-account-scope"',
      `from "${moduleUrl(accountScopeSource)}"`,
    )
    .replace(
      'from "./ebay-readonly-rate-limit"',
      `from "${moduleUrl(rateLimitSource)}"`,
    )

  const sameDayScopeSource = readFileSync(
    "lib/ebay/ebay-same-day-account-scope.ts",
    "utf8",
  )
    .replace(
      'from "./ebay-manual-listing-trading-readonly"',
      `from "${moduleUrl(tradingSource)}"`,
    )
    .replace(
      'from "./ebay-seller-account-scope"',
      `from "${moduleUrl(accountScopeSource)}"`,
    )

  return import(moduleUrl(sameDayScopeSource))
}

function fakeEbayFetch(runtimeUserId) {
  return async (input) => {
    const url = String(input)
    if (url === "https://api.ebay.com/identity/v1/oauth2/token") {
      return new Response(JSON.stringify({
        access_token: "access-token",
        expires_in: 7200,
      }), { status: 200 })
    }
    if (url === "https://api.ebay.com/ws/api.dll") {
      return new Response(
        `<?xml version="1.0" encoding="utf-8"?>\n<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>${runtimeUserId}</UserID></User></GetUserResponse>`,
        { status: 200 },
      )
    }
    throw new Error(`unexpected ebay endpoint: ${url}`)
  }
}

const scopeServicePromise = buildScopeModule()

test("el rescate Same-Day usa fingerprint runtime en preview cuando la scope está inconsistente", async () => {
  const configuredUserId = "ConfiguredSeller"
  const runtimeUserId = "RuntimeSeller"
  const { resolveSameDayPilotAccountScope } = await scopeServicePromise
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeEbayFetch(runtimeUserId)

  try {
    await withEnvironment({
      VERCEL_ENV: "preview",
      EBAY_SELLER_ACCOUNT_KEY: "luna",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: configuredUserId,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: "b".repeat(64),
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_SELLER_REFRESH_TOKEN: "refresh-token",
    }, async () => {
      const resolution = await resolveSameDayPilotAccountScope()
      assert.equal(resolution.source, "RUNTIME_FALLBACK")
      assert.equal(resolution.fallbackAttempted, true)
      assert.equal(resolution.accountKey, `luna:${userFingerprint(runtimeUserId)}`)
      assert.equal(resolution.scopeResolutionReason, "OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT")
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("el rescate Same-Day queda deshabilitado en producción sin override explícito", async () => {
  const { resolveSameDayPilotAccountScope } = await scopeServicePromise
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeEbayFetch("RuntimeSeller")

  try {
    await withEnvironment({
      VERCEL_ENV: "production",
      EBAY_SELLER_ACCOUNT_KEY: "luna",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "ConfiguredSeller",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: "b".repeat(64),
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_SELLER_REFRESH_TOKEN: "refresh-token",
    }, async () => {
      const resolution = await resolveSameDayPilotAccountScope()
      assert.equal(resolution.source, "UNRESOLVED")
      assert.equal(resolution.accountKey, null)
      assert.equal(resolution.fallbackAttempted, false)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("el rescate Same-Day se habilita en producción con override", async () => {
  const runtimeUserId = "RuntimeSeller"
  const { resolveSameDayPilotAccountScope } = await scopeServicePromise
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeEbayFetch(runtimeUserId)

  try {
    await withEnvironment({
      VERCEL_ENV: "production",
      EBAY_SAME_DAY_PILOT_SCOPE_RECOVERY: "enabled",
      EBAY_SELLER_ACCOUNT_KEY: "luna",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "ConfiguredSeller",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: "b".repeat(64),
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_SELLER_REFRESH_TOKEN: "refresh-token",
    }, async () => {
      const resolution = await resolveSameDayPilotAccountScope()
      assert.equal(resolution.source, "RUNTIME_FALLBACK")
      assert.equal(resolution.fallbackAttempted, true)
      assert.equal(resolution.accountKey, `luna:${userFingerprint(runtimeUserId)}`)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("el rescate Same-Day reutiliza el set Production completo cuando las credenciales genéricas faltan", async () => {
  const runtimeUserId = "RuntimeSeller"
  const { resolveSameDayPilotAccountScope } = await scopeServicePromise
  const originalFetch = globalThis.fetch
  globalThis.fetch = fakeEbayFetch(runtimeUserId)

  try {
    await withEnvironment({
      VERCEL_ENV: "preview",
      EBAY_SELLER_ACCOUNT_KEY: "imnova-ebay-us-primary",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "ConfiguredSeller",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: "b".repeat(64),
      EBAY_CLIENT_ID: undefined,
      EBAY_CLIENT_SECRET: undefined,
      EBAY_SELLER_REFRESH_TOKEN: undefined,
      EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client-id",
      EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-client-secret",
      EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh-token",
    }, async () => {
      const resolution = await resolveSameDayPilotAccountScope()
      assert.equal(resolution.source, "RUNTIME_FALLBACK")
      assert.equal(resolution.fallbackAttempted, true)
      assert.equal(
        resolution.accountKey,
        `imnova-ebay-us-primary:${userFingerprint(runtimeUserId)}`,
      )
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
