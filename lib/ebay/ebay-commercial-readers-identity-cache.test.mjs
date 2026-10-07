import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20{}" }
    }
    const value = String(specifier)
    if (value.startsWith(".") &&
        !String(context.parentURL).includes("/node_modules/") &&
        !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { verifyEbayCommercialOfficialAccount } = await import(
  "./ebay-commercial-readers.ts"
)

const USER_ID = "official-seller-test-only"
const ENV_KEYS = [
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT",
  "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT",
]

function withIdentityBinding() {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = USER_ID
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function getUserResponse(userId = USER_ID) {
  return new Response(
    `<GetUserResponse><Ack>Success</Ack><User><UserID>${userId}</UserID>` +
      "</User></GetUserResponse>",
    { status: 200, headers: { "Content-Type": "text/xml" } },
  )
}

test("GetUser se deduplica por access token y conserva single-flight", async () => {
  const restore = withIdentityBinding()
  try {
    let calls = 0
    const fetchImpl = async (_url, init) => {
      calls += 1
      assert.equal(init?.headers?.["X-EBAY-API-CALL-NAME"], "GetUser")
      assert.equal(init?.method, "POST")
      return getUserResponse()
    }
    const firstBatch = await Promise.all(Array.from({ length: 6 }, () =>
      verifyEbayCommercialOfficialAccount("shared-access-token", fetchImpl)))
    assert.equal(firstBatch.every((result) =>
      result.identityMatch && result.fingerprintMatches), true)
    assert.equal(calls, 1)

    await verifyEbayCommercialOfficialAccount("shared-access-token", fetchImpl)
    assert.equal(calls, 1)

    await verifyEbayCommercialOfficialAccount("rotated-access-token", fetchImpl)
    assert.equal(calls, 2)
  } finally {
    restore()
  }
})

test("GetUser fallido nunca se conserva en cache", async () => {
  const restore = withIdentityBinding()
  try {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return calls === 1
        ? new Response("<GetUserResponse><Ack>Failure</Ack></GetUserResponse>", {
          status: 200,
        })
        : getUserResponse()
    }
    await assert.rejects(
      verifyEbayCommercialOfficialAccount("retry-token", fetchImpl),
      /EBAY_COMMERCIAL_ACCOUNT_IDENTITY_UNAVAILABLE/,
    )
    const recovered = await verifyEbayCommercialOfficialAccount(
      "retry-token",
      fetchImpl,
    )
    assert.equal(recovered.identityMatch, true)
    assert.equal(calls, 2)
  } finally {
    restore()
  }
})
