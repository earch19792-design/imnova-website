import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

import {
  EBAY_SELLER_OS_API_PATHS,
} from "../lib/ebay/environment-boundaries.ts"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

const scopeSource = readFileSync(
  "lib/ebay/ebay-seller-account-scope.ts",
  "utf8",
)
const tradingSource = readFileSync(
  "lib/ebay/ebay-manual-listing-trading-readonly.ts",
  "utf8",
)
  .replace(/import type \{ SafeListingDefaults \} from "\.\/ebay-manual-listing-domain"\n/, "")
  .replace(
    'from "./ebay-seller-account-scope"',
    `from "${moduleUrl(scopeSource)}"`,
  )
const tradingModuleUrl = moduleUrl(tradingSource)
const {
  probeEbayProductionIdentityReadOnly,
} = await import(tradingModuleUrl)
const bootstrapSource = readFileSync(
  "lib/ebay/ebay-production-identity-bootstrap.ts",
  "utf8",
).replace(
  'from "./ebay-manual-listing-trading-readonly"',
  `from "${tradingModuleUrl}"`,
)
const {
  EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION,
  handleEbayProductionIdentityBootstrapRequest,
} = await import(moduleUrl(bootstrapSource))

const safeEnvironment = {
  EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
  EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
  EBAY_SELLER_WHATSAPP_ENABLED: "false",
  EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
}

const unboundIdentityEnvironment = {
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: undefined,
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT: undefined,
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: undefined,
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

function request(body, authorization = "Bearer admin-test-token") {
  return new Request("https://preview.example/api/admin/ebay/identity/bootstrap", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function acceptedGetUserXml(userId) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserResponse xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<Ack>Success</Ack>" +
    `<User><UserID>${userId}</UserID></User>` +
    "</GetUserResponse>"
}

test("bootstrap rejects a request without an Admin before probing eBay", async () => {
  let probeCalls = 0
  const response = await handleEbayProductionIdentityBootstrapRequest(
    request({ confirmation: EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION }, ""),
    {
      validateAdminApiRequest: async (req) => req.headers.get("authorization")
        ? { ok: true, status: 200 }
        : { ok: false, status: 401, error: "admin_token_required" },
      environment: safeEnvironment,
      probe: async () => {
        probeCalls += 1
        throw new Error("must not run")
      },
    },
  )
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(probeCalls, 0)
})

test("bootstrap requires the exact confirmation body", async () => {
  for (const body of [
    { confirmation: "WRONG" },
    { confirmation: EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION, extra: true },
    {},
  ]) {
    let probeCalls = 0
    const response = await handleEbayProductionIdentityBootstrapRequest(
      request(body),
      {
        validateAdminApiRequest: async () => ({ ok: true, status: 200 }),
        environment: safeEnvironment,
        probe: async () => {
          probeCalls += 1
          throw new Error("must not run")
        },
      },
    )
    assert.equal(response.status, 400)
    assert.equal(probeCalls, 0)
  }
})

test("bootstrap fails closed on every unsafe runtime flag", async () => {
  const cases = [
    ["EBAY_DRAFT_ONLY_WRITES_ENABLED", "true", "UNSAFE_GLOBAL_WRITES_FLAG"],
    ["EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED", "true", "UNSAFE_PRODUCTION_WRITES_FLAG"],
    ["EBAY_SELLER_WHATSAPP_ENABLED", "true", "UNSAFE_WHATSAPP_FLAG"],
    ["EBAY_DRAFT_ONLY_TARGET", "PRODUCTION", "UNSAFE_DRAFT_TARGET"],
  ]
  for (const [name, value, expectedError] of cases) {
    let probeCalls = 0
    const response = await handleEbayProductionIdentityBootstrapRequest(
      request({ confirmation: EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION }),
      {
        validateAdminApiRequest: async () => ({ ok: true, status: 200 }),
        environment: { ...safeEnvironment, [name]: value },
        probe: async () => {
          probeCalls += 1
          throw new Error("must not run")
        },
      },
    )
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: expectedError })
    assert.equal(probeCalls, 0)
  }
})

test("identity probe fails closed when Production read-only credentials are absent", async () => {
  await withEnvironment({
    ...unboundIdentityEnvironment,
    EBAY_CLIENT_ID: undefined,
    EBAY_CLIENT_SECRET: undefined,
    EBAY_SELLER_REFRESH_TOKEN: undefined,
  }, async () => {
    let fetchCalls = 0
    await assert.rejects(
      probeEbayProductionIdentityReadOnly(async () => {
        fetchCalls += 1
        throw new Error("must not run")
      }),
      /EBAY_TRADING_READONLY_NOT_CONFIGURED/,
    )
    assert.equal(fetchCalls, 0)
  })
})

test("identity probe rejects OAuth safely without exposing the eBay response", async () => {
  await withEnvironment({
    ...unboundIdentityEnvironment,
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: "client-secret-sensitive",
    EBAY_SELLER_REFRESH_TOKEN: "refresh-token-sensitive",
  }, async () => {
    await assert.rejects(
      probeEbayProductionIdentityReadOnly(async () => new Response(
        JSON.stringify({ error_description: "sensitive upstream detail" }),
        { status: 401 },
      )),
      (error) => error instanceof Error && error.message === "EBAY_TRADING_OAUTH_401",
    )
  })
})

test("identity probe calls only Production OAuth and Trading GetUser", async () => {
  const fullUserId = "abOfficialSellerzy"
  const accessToken = "access-token-sensitive"
  const calls = []
  await withEnvironment({
    ...unboundIdentityEnvironment,
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: "client-secret-sensitive",
    EBAY_SELLER_REFRESH_TOKEN: "refresh-token-sensitive",
  }, async () => {
    const fetchMock = async (input, init = {}) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === "https://api.ebay.com/identity/v1/oauth2/token") {
        return new Response(JSON.stringify({
          access_token: accessToken,
          expires_in: 7200,
        }), { status: 200 })
      }
      if (url === "https://api.ebay.com/ws/api.dll") {
        return new Response(acceptedGetUserXml(fullUserId), { status: 200 })
      }
      throw new Error(`unexpected endpoint: ${url}`)
    }

    const result = await probeEbayProductionIdentityReadOnly(fetchMock)
    const expectedFingerprint = createHash("sha256")
      .update(`PRODUCTION:${fullUserId}`)
      .digest("hex")

    assert.deepEqual(result, {
      oauthValid: true,
      accessTokenReceived: true,
      getUserValid: true,
      environment: "PRODUCTION",
      maskedUserId: "ab******zy",
      fingerprint: expectedFingerprint,
      fingerprintFormatValid: true,
      configuredFingerprintPresent: false,
      configuredFingerprintMatches: false,
      identityBindingStatus: "UNBOUND",
      scopesVerified: true,
      ebayWriteUsed: false,
      canPublish: false,
    })
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/)

    assert.deepEqual(calls.map(({ url }) => url), [
      "https://api.ebay.com/identity/v1/oauth2/token",
      "https://api.ebay.com/ws/api.dll",
    ])
    const oauthBody = String(calls[0].init.body)
    assert.match(oauthBody, /scope=https%3A%2F%2Fapi\.ebay\.com%2Foauth%2Fapi_scope/)
    assert.equal(calls[1].init.headers["X-EBAY-API-CALL-NAME"], "GetUser")
    assert.match(String(calls[1].init.body), /<GetUserRequest/)
    assert.match(String(calls[1].init.body), /<OutputSelector>User\.UserID<\/OutputSelector>/)

    const allOutbound = calls.map(({ url, init }) =>
      `${url}\n${String(init.body ?? "")}\n${JSON.stringify(init.headers ?? {})}`
    ).join("\n")
    assert.doesNotMatch(allOutbound, /GetItem|Inventory|createOffer/)

    const serialized = JSON.stringify(result)
    for (const sensitive of [
      fullUserId,
      accessToken,
      "client-id-sensitive",
      "client-secret-sensitive",
      "refresh-token-sensitive",
    ]) assert.equal(serialized.includes(sensitive), false)
  })
})

test("configured Production fingerprint matches in constant-time probe output", async () => {
  const fullUserId = "shopOfficialSellerMart"
  const expectedFingerprint = createHash("sha256")
    .update(`PRODUCTION:${fullUserId}`)
    .digest("hex")
  const accessToken = "access-token-sensitive"
  const clientSecret = "client-secret-sensitive"
  const refreshToken = "refresh-token-sensitive"
  const calls = []

  await withEnvironment({
    ...unboundIdentityEnvironment,
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: clientSecret,
    EBAY_SELLER_REFRESH_TOKEN: refreshToken,
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:
      expectedFingerprint,
  }, async () => {
    const fetchMock = async (input, init = {}) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === "https://api.ebay.com/identity/v1/oauth2/token") {
        return new Response(JSON.stringify({
          access_token: accessToken,
          expires_in: 7200,
        }), { status: 200 })
      }
      if (url === "https://api.ebay.com/ws/api.dll") {
        return new Response(acceptedGetUserXml(fullUserId), { status: 200 })
      }
      throw new Error(`unexpected endpoint: ${url}`)
    }

    const result = await probeEbayProductionIdentityReadOnly(fetchMock)
    assert.deepEqual(result, {
      oauthValid: true,
      accessTokenReceived: true,
      getUserValid: true,
      environment: "PRODUCTION",
      maskedUserId: "sh******rt",
      fingerprintFormatValid: true,
      configuredFingerprintPresent: true,
      configuredFingerprintMatches: true,
      identityBindingStatus: "BOUND_MATCH",
      scopesVerified: true,
      ebayWriteUsed: false,
      canPublish: false,
    })
    assert.equal(Object.hasOwn(result, "fingerprint"), false)

    const response = await handleEbayProductionIdentityBootstrapRequest(
      request({ confirmation: EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION }),
      {
        validateAdminApiRequest: async () => ({ ok: true, status: 200 }),
        environment: safeEnvironment,
        probe: async () => result,
      },
    )
    assert.equal(response.status, 200)
    const serialized = JSON.stringify(await response.json())
    for (const sensitive of [
      expectedFingerprint,
      fullUserId,
      accessToken,
      clientSecret,
      refreshToken,
    ]) assert.equal(serialized.includes(sensitive), false)

    assert.deepEqual(calls.map(({ url }) => url), [
      "https://api.ebay.com/identity/v1/oauth2/token",
      "https://api.ebay.com/ws/api.dll",
    ])
    const outbound = calls.map(({ init }) =>
      `${String(init.body ?? "")}\n${JSON.stringify(init.headers ?? {})}`
    ).join("\n")
    assert.doesNotMatch(outbound, /GetItem|Inventory|createOffer/)
  })
})

test("configured fingerprint mismatch and malformed values fail closed", async () => {
  const fullUserId = "shopOfficialSellerMart"
  const credentials = {
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: "client-secret-sensitive",
    EBAY_SELLER_REFRESH_TOKEN: "refresh-token-sensitive",
  }
  const fetchMock = async (input) => String(input).includes("oauth2/token")
    ? new Response(JSON.stringify({
      access_token: "access-token-sensitive",
      expires_in: 7200,
    }), { status: 200 })
    : new Response(acceptedGetUserXml(fullUserId), { status: 200 })

  for (const configuredFingerprint of ["0".repeat(64), "malformed"]) {
    await withEnvironment({
      ...unboundIdentityEnvironment,
      ...credentials,
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:
        configuredFingerprint,
    }, async () => {
      await assert.rejects(
        probeEbayProductionIdentityReadOnly(fetchMock),
        (error) => error instanceof Error &&
          error.message === "EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH",
      )
    })
  }

  const response = await handleEbayProductionIdentityBootstrapRequest(
    request({ confirmation: EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION }),
    {
      validateAdminApiRequest: async () => ({ ok: true, status: 200 }),
      environment: safeEnvironment,
      probe: async () => {
        throw new Error("EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH")
      },
    },
  )
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    error: "EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH",
  })
})

test("identity probe rejects failed GetUser and an empty UserID safely", async () => {
  await withEnvironment({
    ...unboundIdentityEnvironment,
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: "client-secret-sensitive",
    EBAY_SELLER_REFRESH_TOKEN: "refresh-token-sensitive",
  }, async () => {
    const oauth = () => new Response(JSON.stringify({
      access_token: "access-token-sensitive",
      expires_in: 7200,
    }), { status: 200 })

    let call = 0
    await assert.rejects(
      probeEbayProductionIdentityReadOnly(async () => {
        call += 1
        return call === 1
          ? oauth()
          : new Response("<GetUserResponse><Ack>Failure</Ack></GetUserResponse>", { status: 400 })
      }),
      /EBAY_TRADING_GETUSER_400/,
    )

    call = 0
    await assert.rejects(
      probeEbayProductionIdentityReadOnly(async () => {
        call += 1
        return call === 1
          ? oauth()
          : new Response(acceptedGetUserXml(""), { status: 200 })
      }),
      /EBAY_TRADING_GETUSER_IDENTITY_MISSING/,
    )
  })
})

test("route is POST-only, Admin-protected, no-store and inside the canonical boundary", () => {
  const route = readFileSync(
    "app/api/admin/ebay/identity/bootstrap/route.ts",
    "utf8",
  )
  const handler = readFileSync(
    "lib/ebay/ebay-production-identity-bootstrap.ts",
    "utf8",
  )
  assert.match(route, /export const runtime = "nodejs"/)
  assert.match(route, /export const dynamic = "force-dynamic"/)
  assert.match(route, /export async function POST\(req: Request\)/)
  assert.doesNotMatch(route, /export async function GET/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(handler, /"Cache-Control": "no-store"/)
  assert.equal(
    EBAY_SELLER_OS_API_PATHS.includes("/api/admin/ebay/identity/bootstrap"),
    true,
  )
})
