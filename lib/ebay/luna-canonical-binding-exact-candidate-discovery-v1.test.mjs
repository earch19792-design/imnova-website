import assert from "node:assert/strict"
import { webcrypto } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"
import { runInNewContext } from "node:vm"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  evaluateLunaCanonicalBindCandidateDiscoveryV1,
  LUNA_CANONICAL_BIND_BOOTSTRAP_IDENTITY_V1,
  LUNA_CANONICAL_BIND_EXACT_MATCH_PREDICATE_V1,
  resolveLunaChromeShippingJobsV1,
  selectSingleLunaCanonicalBindCandidateV1,
} = await import("./ebay-luna-chrome-shipping-capture-server-v1.ts")
const { deriveCurrentCommercialCandidateIdentityV1 } = await import(
  "./ebay-current-commercial-candidate-identity-v1.ts")

const ACCOUNT_KEY =
  "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12"
const EXACT_IDENTITY = LUNA_CANONICAL_BIND_BOOTSTRAP_IDENTITY_V1
const CURRENT_CANDIDATE_ID = deriveCurrentCommercialCandidateIdentityV1({
  accountKey: ACCOUNT_KEY,
  productId: EXACT_IDENTITY.lunaProductId,
  variantId: EXACT_IDENTITY.lunaVariantId,
  supplierSku: EXACT_IDENTITY.supplierSku,
}).canonicalCandidateId

function exactCandidate(overrides = {}) {
  return Object.freeze({
    candidateId: CURRENT_CANDIDATE_ID,
    lunaProductId: EXACT_IDENTITY.lunaProductId,
    lunaVariantId: EXACT_IDENTITY.lunaVariantId,
    supplierSku: EXACT_IDENTITY.supplierSku,
    productFitStrongDurable: true,
    freshProductPageOos: false,
    ...overrides,
  })
}

test("PASS_EXACT_CANDIDATE_DISCOVERY", () => {
  const decoy = exactCandidate({
    candidateId: `sha256:${"d".repeat(64)}`,
    lunaProductId: "decoy-product",
  })
  const discovery = evaluateLunaCanonicalBindCandidateDiscoveryV1({
    accountKey: ACCOUNT_KEY, candidates: [decoy, exactCandidate()],
  })
  assert.equal(discovery.diagnostic.candidatesObserved.length, 2)
  assert.equal(discovery.diagnostic.candidatesEligible.length, 1)
  assert.equal(discovery.diagnostic.exactMatchPredicate,
    LUNA_CANONICAL_BIND_EXACT_MATCH_PREDICATE_V1)
  assert.equal(discovery.eligible[0].candidateId, CURRENT_CANDIDATE_ID)
  assert.equal(CURRENT_CANDIDATE_ID,
    "sha256:8e070c49695f0b244f9d79e929b6bf65135c083deccece31e878df135e3b1958")
  assert.notEqual(CURRENT_CANDIDATE_ID,
    "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60")
  assert.deepEqual(discovery.diagnostic.rejectionReasonPerCandidate[0]
    .rejectionReasons, ["EXACT_SUPPLIER_IDENTITY_MISMATCH",
    "CURRENT_ACCOUNT_CANDIDATE_ID_MISMATCH"])
})

test("PASS_ZERO_CANDIDATE_FAIL_CLOSED", () => {
  const discovery = evaluateLunaCanonicalBindCandidateDiscoveryV1({
    accountKey: ACCOUNT_KEY, candidates: [],
  })
  assert.throws(() => selectSingleLunaCanonicalBindCandidateV1(
    discovery.eligible), /LUNA_SHIPPING_EXTENSION_EXACT_CANDIDATE_NOT_FOUND/)
})

test("PASS_MULTI_CANDIDATE_FAIL_CLOSED", () => {
  const discovery = evaluateLunaCanonicalBindCandidateDiscoveryV1({
    accountKey: ACCOUNT_KEY,
    candidates: [exactCandidate(), exactCandidate()],
  })
  assert.throws(() => selectSingleLunaCanonicalBindCandidateV1(
    discovery.eligible), /LUNA_SHIPPING_EXTENSION_EXACT_CANDIDATE_AMBIGUOUS/)
})

test("PASS_SINGLE_UNAMBIGUOUS_US_CANDIDATE", async () => {
  const discovery = evaluateLunaCanonicalBindCandidateDiscoveryV1({
    accountKey: ACCOUNT_KEY, candidates: [exactCandidate()],
  })
  assert.equal(selectSingleLunaCanonicalBindCandidateV1(discovery.eligible)
    .candidateId, CURRENT_CANDIDATE_ID)
  assert.equal(discovery.diagnostic.profileEvidencePresent, true)
  assert.equal(discovery.diagnostic.contentScriptReady,
    "NOT_REQUIRED_SERVER_PROFILE_BINDING")

  const calculatedAt = "2026-09-13T17:49:22.608Z"
  const source = {
    calculatedAt,
    snapshotDigest: `sha256:${"3".repeat(64)}`,
    frontier: {
      familyId: `market-family-v1:sha256:${"f".repeat(64)}`,
      lunaProductId: EXACT_IDENTITY.lunaProductId,
      lunaVariantId: EXACT_IDENTITY.lunaVariantId,
      lunaSku: EXACT_IDENTITY.supplierSku,
      productFit: "STRONG",
      economicClassification: "ECONOMICALLY_PROMISING",
      shippingStatus: "UNPROVEN",
      lunaUnitCost: 10.96,
      marketPriceMedian: 27.17,
      evaluatedAt: calculatedAt,
    },
  }
  function resultQuery(result) {
    const query = {
      select() { return query }, eq() { return query }, in() { return query },
      contains() { return query }, order() { return query }, limit() { return query },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }
    return query
  }
  const supabase = {
    async rpc(name) {
      assert.equal(name, "get_seller_os_latest_profitability_frontiers_v1")
      return { data: { frontiers: [source] }, error: null }
    },
    from(table) {
      if (table === "ebay_same_day_pilot_runs" ||
          table === "ebay_current_listing_packages_v1") {
        return resultQuery({ data: [], error: null })
      }
      if (table === "market_radar_latest_variants") {
        return resultQuery({ data: [{
          supplier_product_id: EXACT_IDENTITY.lunaProductId,
          supplier_variant_id: EXACT_IDENTITY.lunaVariantId,
          sku: EXACT_IDENTITY.supplierSku,
          title: "Exact microcurrent device",
          variant_title: "Default Title",
          price: 10.96,
          product_url:
            "https://www.lunaportex.com/products/exact-microcurrent-device",
          captured_at: calculatedAt,
        }], error: null })
      }
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
  }
  let observed = null
  const jobs = await resolveLunaChromeShippingJobsV1({
    supabase, accountKey: ACCOUNT_KEY,
    sessionSecret: "canonical-bind-test-secret".repeat(3),
    purpose: "CANONICAL_BIND_BOOTSTRAP",
    observeCanonicalBindDiscovery(value) { observed = value },
    now: Date.parse("2026-09-13T18:00:00.000Z"),
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].identity.candidateId, CURRENT_CANDIDATE_ID)
  assert.equal(observed.candidatesObserved.length, 1)
  assert.equal(observed.candidatesEligible.length, 1)
})

function bootstrapJob(profileDigest = `sha256:${"a".repeat(64)}`) {
  return {
    contractVersion: "LUNA_SHIPPING_QUOTE_CAPTURE_V1",
    captureSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nonce: `1724522400000.${"a".repeat(43)}`,
    snapshotDigest: `sha256:${"9".repeat(64)}`,
    identity: {
      candidateId: CURRENT_CANDIDATE_ID,
      canonicalProductUrl:
        "https://lunaportex.com/products/exact-microcurrent-device",
      lunaProductId: EXACT_IDENTITY.lunaProductId,
      lunaVariantId: EXACT_IDENTITY.lunaVariantId,
      supplierSku: EXACT_IDENTITY.supplierSku,
      quantity: 1,
    },
    destination: {
      profileId: "LUNA_BOCA_RATON_US",
      profileDigest,
      country: "US", province: "FL", postalCode: "33487",
    },
    salePriceUsd: 27.17,
    supplierCostUsd: 10.96,
    productName: "Exact microcurrent device",
  }
}

async function bindingHarness() {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  let connectListener = null
  let portMessage = null
  let stored = {}
  let storageWriteCount = 0
  const posted = []
  const chrome = {
    runtime: {
      id: "mhpkojahbbfdgodeaecggpjaplllgclk", lastError: null,
      getManifest: () => ({ version: "1.0.56" }),
      onInstalled: { addListener() {} }, onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener() {} },
    },
    tabs: {
      create: async () => ({ id: 7 }), update: async () => ({}),
      query() { throw new Error("BIND_MUST_NOT_ENUMERATE_TABS") },
      sendMessage() { throw new Error("BIND_MUST_NOT_READ_CHECKOUT_DOM") },
      onRemoved: { addListener() {} },
    },
    storage: { local: {
      get(_key, callback) { callback(stored) },
      set(value, callback) {
        storageWriteCount += 1
        stored = { ...value }
        callback()
      },
    } },
    scripting: { executeScript: async () => [] },
    webNavigation: {
      onCommitted: { addListener() {} }, onCompleted: { addListener() {} },
    },
  }
  runInNewContext(background, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  connectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url:
      "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture" },
    disconnect() {}, postMessage(value) { posted.push(value) },
    onMessage: { addListener(listener) { portMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  const bind = async (job) => {
    const start = posted.length
    portMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
      bootstrapJob: job })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = posted.slice(start).findLast((entry) =>
        entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
      if (result) return result
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error("BINDING_RESULT_TIMEOUT")
  }
  return {
    bind,
    getStored: () => stored,
    getWriteCount: () => storageWriteCount,
  }
}

test("PASS_BINDING_WRITE", async () => {
  const harness = await bindingHarness()
  const result = await harness.bind(bootstrapJob())
  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(result.operation, "BIND_CANONICAL_DESTINATION")
  assert.equal(harness.getWriteCount(), 1)
})

test("PASS_DURABLE_READBACK", async () => {
  const harness = await bindingHarness()
  const result = await harness.bind(bootstrapJob())
  const envelope = harness.getStored()
    .sellerOsLunaCanonicalDestinationBindingV1
  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(envelope.canonicalDestinationFingerprint,
    bootstrapJob().destination.profileDigest)
  assert.equal(envelope.validationMethod, "EXACT_PROFILE_DIGEST_MATCH")
})

test("PASS_CANONICAL_DESTINATION_MATCH", async () => {
  const harness = await bindingHarness()
  const result = await harness.bind(bootstrapJob())
  assert.equal(result.canonicalDestinationBound, true, JSON.stringify(result))
  assert.equal(result.canonicalDestinationMatch, true)
})

test("PASS_NO_RAW_ADDRESS_PERSISTENCE", async () => {
  const harness = await bindingHarness()
  await harness.bind(bootstrapJob())
  const serialized = JSON.stringify(harness.getStored())
  assert.doesNotMatch(serialized,
    /33487|Boca Raton|address|street|city|postal|province|credential|cookie/i)
})

test("PASS_EXISTING_BINDING_IMMUTABLE", async () => {
  const harness = await bindingHarness()
  const original = bootstrapJob().destination.profileDigest
  const first = await harness.bind(bootstrapJob())
  assert.equal(first.success, true, JSON.stringify(first))
  const mismatch = await harness.bind(bootstrapJob(`sha256:${"b".repeat(64)}`))
  assert.equal(mismatch.success, false)
  assert.equal(mismatch.error, "CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
  assert.equal(harness.getWriteCount(), 1)
  assert.equal(harness.getStored().sellerOsLunaCanonicalDestinationBindingV1
    .canonicalDestinationFingerprint, original)
})
