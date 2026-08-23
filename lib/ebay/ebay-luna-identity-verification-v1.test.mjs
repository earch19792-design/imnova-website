import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const identity = await import("./ebay-luna-identity-verification-v1.ts")
const server = await import("./ebay-luna-identity-verification-server-v1.ts")

const NOW = "2026-08-22T18:00:00.000Z"

function target(overrides = {}) {
  return identity.createSellerOsLunaIdentityVerificationTargetV1({
    currentCohortId: "current-live:EBAY_US:scope-v1",
    candidateId: "luna-review-candidate-v1:abc123",
    candidateEvidenceDigest: `sha256:${"a".repeat(64)}`,
    ebayItemId: "366582586826",
    lunaProductId: "9220805755104",
    lunaVariantId: "48809607659744",
    lunaSku: "ITEM5810",
    canonicalSourceUrl:
      "https://www.lunaportex.com/products/z6-portable-language-translator-device-black",
    ...overrides,
  })
}

function payload(overrides = {}, variantOverrides = {}) {
  return {
    id: 9220805755104,
    handle: "z6-portable-language-translator-device-black",
    title: "Z6 Portable Language Translator Device - Black",
    options: [{ name: "Color", values: ["Black"] }],
    price: 4999,
    available: true,
    inventory_quantity: 9,
    variants: [{
      id: 48809607659744,
      sku: "ITEM5810",
      title: "Black",
      barcode: "123456789012",
      options: ["Black"],
      price: 4999,
      compare_at_price: 5999,
      available: true,
      inventory_quantity: 9,
      ...variantOverrides,
    }],
    ...overrides,
  }
}

function evidence(source = payload(), selectedTarget = target()) {
  return identity.buildSellerOsLunaIdentityVerificationEvidenceV1({
    target: selectedTarget, payload: source, observedAt: NOW,
  })
}

test("exact external product and exact variant produce bounded identity evidence", () => {
  const result = evidence()
  assert.equal(result.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(result.currentLunaIdentity.productId, "9220805755104")
  assert.equal(result.currentLunaIdentity.variantId, "48809607659744")
  assert.equal(result.currentLunaIdentity.sku, "ITEM5810")
  assert.deepEqual(result.currentLunaIdentity.structuredVariantAttributes,
    [{ name: "Color", value: "Black" }])
  assert.equal(result.commerceFactsUsedForIdentity, false)
  assert.equal(result.rawSourceIncluded, false)
})

test("commerce facts never alter the output or identity digest", () => {
  const left = evidence(payload({ price: 1, available: false,
    inventory_quantity: 0 }, { price: 1, compare_at_price: 2,
    available: false, inventory_quantity: 0 }))
  const right = evidence(payload({ price: 999999, available: true,
    inventory_quantity: 50000 }, { price: 999999, compare_at_price: 1000000,
    available: true, inventory_quantity: 50000 }))
  assert.deepEqual(left, right)
  const serialized = JSON.stringify(left)
  assert.doesNotMatch(serialized,
    /inventory_quantity|compare_at_price|"available"|"price"|999999|50000/)
})

test("identity changes alter the digest", () => {
  const first = evidence()
  const changed = evidence(payload({}, { title: "Negro" }))
  assert.notEqual(first.evidenceDigest, changed.evidenceDigest)
})

test("a plain JSON object cannot forge the opaque server target", () => {
  const plain = { ...target() }
  assert.equal(identity.isSellerOsLunaIdentityVerificationTargetV1(plain), false)
  assert.equal(JSON.stringify(target()).includes("lunaportex.com"), false)
  assert.throws(() => evidence(payload(), plain),
    /LUNA_IDENTITY_TARGET_NOT_SERVER_RESOLVED/)
})

test("caller target extras, internal UUIDs, arbitrary hosts and paths fail closed", () => {
  assert.throws(() => identity.createSellerOsLunaIdentityVerificationTargetV1({
    ...target(), cookie: "caller-cookie",
  }), /LUNA_IDENTITY_TARGET_INVALID/)
  assert.throws(() => target({
    lunaProductId: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
  }), /LUNA_IDENTITY_TARGET_INVALID/)
  assert.throws(() => target({
    canonicalSourceUrl: "https://example.com/products/z6",
  }), /LUNA_IDENTITY_TARGET_URL_REJECTED/)
  assert.throws(() => target({
    canonicalSourceUrl: "https://www.lunaportex.com/collections/products",
  }), /LUNA_IDENTITY_TARGET_URL_REJECTED/)
  assert.throws(() => target({
    canonicalSourceUrl: "https://www.lunaportex.com/products/a%2Fb",
  }), /LUNA_IDENTITY_TARGET_URL_REJECTED/)
  assert.throws(() => target({
    canonicalSourceUrl: "https://www.lunaportex.com/products/%ZZ",
  }), /LUNA_IDENTITY_TARGET_URL_REJECTED/)
})

test("a canonical single-segment Shopify handle may contain encoded Unicode", () => {
  const selected = target({
    canonicalSourceUrl:
      "https://lunaportex.com/products/%F0%9F%92%A5electronic-pest-repeller",
  })
  assert.equal(identity.sellerOsLunaIdentityProductJsonUrlV1(selected),
    "https://lunaportex.com/products/%F0%9F%92%A5electronic-pest-repeller.js")
})

test("duplicate exact variants are ambiguous", () => {
  const source = payload()
  source.variants.push({ ...source.variants[0] })
  assert.equal(evidence(source).classification, "AMBIGUOUS_MATCH")
})

test("product mismatch and variant tuple conflicts fail closed", () => {
  assert.equal(evidence(payload({ id: 9220805755105 })).classification,
    "CONFLICTING_MATCH")
  assert.equal(evidence(payload({}, { sku: "OTHER" })).classification,
    "CONFLICTING_MATCH")
  assert.equal(evidence(payload({}, { id: 48809607659745,
    sku: "OTHER" })).classification, "NO_MATCH")
})

test("default title alone never proves configuration", () => {
  const result = evidence(payload({ options: [] }, {
    title: "Default Title", options: ["Default Title"],
  }))
  assert.equal(result.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(result.defaultTitleOnly, true)
  assert.equal(result.configurationProven, false)
  assert.deepEqual(result.currentLunaIdentity.structuredVariantAttributes, [])
})

test("malformed source and invalid clocks fail closed", () => {
  assert.throws(() => evidence({ id: 1, variants: [] }),
    /LUNA_IDENTITY_PARSE_CONTRACT_CHANGED/)
  assert.throws(() => identity.buildSellerOsLunaIdentityVerificationEvidenceV1({
    target: target(), payload: payload(), observedAt: "invalid",
  }), /LUNA_IDENTITY_CLOCK_INVALID/)
})

function response(body, init = {}) {
  return new Response(body, { status: 200,
    headers: { "Content-Type": "application/json" }, ...init })
}

test("server reader performs exactly one fixed bounded GET with server session", async () => {
  const requests = []
  const verify = server.createSellerOsLunaIdentityVerificationServerV1({
    resolveSession: async () => "opaque-server-session",
    now: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response(JSON.stringify(payload()))
    },
  })
  const result = await verify(target())
  assert.equal(result.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url,
    "https://www.lunaportex.com/products/z6-portable-language-translator-device-black.js")
  assert.equal(requests[0].options.method, "GET")
  assert.equal(requests[0].options.redirect, "manual")
  assert.equal(requests[0].options.cache, "no-store")
  assert.equal(JSON.stringify(result).includes("opaque-server-session"), false)
})

test("session absence blocks before network", async () => {
  let calls = 0
  const verify = server.createSellerOsLunaIdentityVerificationServerV1({
    resolveSession: async () => null,
    fetchImpl: async () => { calls += 1; return response("{}") },
  })
  await assert.rejects(verify(target()), /LUNA_REAUTH_REQUIRED/)
  assert.equal(calls, 0)
})

test("plain caller object is rejected before session or network", async () => {
  let sessionReads = 0
  const verify = server.createSellerOsLunaIdentityVerificationServerV1({
    resolveSession: async () => { sessionReads += 1; return "session" },
    fetchImpl: async () => response("{}"),
  })
  await assert.rejects(verify({ ...target() }),
    /LUNA_IDENTITY_TARGET_NOT_SERVER_RESOLVED/)
  assert.equal(sessionReads, 0)
})

test("redirect, auth, content type, oversized body and malformed JSON fail closed", async () => {
  const forResponse = (value) =>
    server.createSellerOsLunaIdentityVerificationServerV1({
      resolveSession: async () => "session", fetchImpl: async () => value,
    })(target())
  await assert.rejects(forResponse(response(null, { status: 302,
    headers: { Location: "https://example.com/products/z6" } })),
  /LUNA_IDENTITY_REDIRECT_REJECTED/)
  await assert.rejects(forResponse(response(null, { status: 401 })),
    /LUNA_REAUTH_REQUIRED/)
  await assert.rejects(forResponse(response("<html></html>", {
    headers: { "Content-Type": "text/html" },
  })), /LUNA_IDENTITY_PARSE_CONTRACT_CHANGED/)
  await assert.rejects(forResponse(response("{}", {
    headers: { "Content-Type": "application/json",
      "Content-Length": "1000001" },
  })), /LUNA_IDENTITY_RESPONSE_TOO_LARGE/)
  await assert.rejects(forResponse(response("not-json")),
    /LUNA_IDENTITY_PARSE_CONTRACT_CHANGED/)
})

test("server output never includes raw source, session, or commerce facts", async () => {
  const secretMarker = "never-return-this-session"
  const verify = server.createSellerOsLunaIdentityVerificationServerV1({
    resolveSession: async () => secretMarker, now: () => NOW,
    fetchImpl: async () => response(JSON.stringify(payload({
      available: false, inventory_quantity: 0, price: 777777,
    }))),
  })
  const serialized = JSON.stringify(await verify(target()))
  assert.doesNotMatch(serialized,
    /never-return-this-session|inventory_quantity|"available"|"price"|777777/)
})
