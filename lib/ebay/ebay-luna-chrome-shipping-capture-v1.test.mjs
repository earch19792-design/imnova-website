import assert from "node:assert/strict"
import { createHash, webcrypto } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"
import { runInNewContext, Script } from "node:vm"

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
  certifyLunaChromeShippingVisibleCaptureV1,
  certifyLunaShippingCapturePostV1,
  LUNA_SHIPPING_EXTENSION_ID,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS,
  LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
  normalizeLunaChromeShippingJobV1,
  normalizeLunaShippingRuntimeTraceEventV1,
} = await import("./ebay-luna-chrome-shipping-capture-v1.ts")
const {
  issueLunaShippingCaptureSessionV1,
  persistLunaShippingRuntimeTraceV1,
  verifyLunaShippingCaptureSessionV1,
} = await import("./ebay-luna-chrome-shipping-capture-server-v1.ts")
const {
  detectAndWakeLunaShippingExtensionV1,
} = await import("./ebay-luna-extension-detection-v1.ts")

const NOW = Date.parse("2026-08-24T18:00:00.000Z")
const CANARY_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60"

async function waitForTestCondition(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("TEST_CONDITION_TIMEOUT")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function assertOrderedSubsequence(actual, expected) {
  let cursor = -1
  for (const value of expected) {
    cursor = actual.indexOf(value, cursor + 1)
    assert.notEqual(cursor, -1, `${value} missing or out of order`)
  }
}

function job() {
  return {
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    captureSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nonce: "abcdefghijklmnopqrstuvwxyzABCDEFGH12345678_-",
    identity: {
      candidateId:
        "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60",
      canonicalProductUrl: "https://lunaportex.com/products/exact-microcurrent-device",
      lunaProductId: "9220832493792",
      lunaVariantId: "48809643540704",
      supplierSku: "ITEM3734",
      quantity: 1,
    },
    destination: {
      profileId: "LUNA_BOCA_RATON_US",
      profileDigest: `sha256:${"a".repeat(64)}`,
      country: "US",
      province: "FL",
      postalCode: "33487",
    },
    salePriceUsd: 27.17,
    supplierCostUsd: 10.96,
    productName: "Exact microcurrent device",
  }
}

function capture(overrides = {}) {
  return {
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    captureSessionId: job().captureSessionId,
    nonce: job().nonce,
    candidateId: job().identity.candidateId,
    lunaProductId: job().identity.lunaProductId,
    lunaVariantId: job().identity.lunaVariantId,
    supplierSku: job().identity.supplierSku,
    quantity: 1,
    subtotalUsd: 10.96,
    shippingUsd: 4.25,
    totalUsd: 15.21,
    currency: "USD",
    observedAt: "2026-08-24T17:59:00.000Z",
    acquisitionMethod: "NORMAL_CHROME_EXTENSION_VISIBLE_DOM",
    extensionEvidenceDigest: `sha256:${"b".repeat(64)}`,
    normalChromeAuthenticated: true,
    expectedProductIdMatch: true,
    expectedVariantIdMatch: true,
    expectedSupplierSkuMatch: true,
    subtotalPlusShippingReconciles: true,
    cartRestoreProven: true,
    cookieAccess: false,
    credentialAccess: false,
    lunaPurchases: 0,
    ...overrides,
  }
}

function traceEvent(overrides = {}) {
  return {
    contractVersion: LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
    traceId: `luna-shipping-trace-v1:sha256:${"c".repeat(64)}`,
    candidateId: CANARY_ID,
    sequence: 1,
    timestamp: "2026-08-24T17:59:00.000Z",
    extensionVersion: "1.0.39",
    captureSessionIdHash: `sha256:${"d".repeat(64)}`,
    state: "BRIDGE_CONNECTED",
    event: "BRIDGE_CONNECTED",
    success: true,
    reasonCode: "NONE",
    purchaseBoundaryEnforced: true,
    ...overrides,
  }
}

test("bounded runtime trace accepts only safe allowlisted evidence", () => {
  const event = normalizeLunaShippingRuntimeTraceEventV1(traceEvent(), NOW)
  assert.equal(event.state, "BRIDGE_CONNECTED")
  assert.equal(normalizeLunaShippingRuntimeTraceEventV1(traceEvent({
    state: "BIND_SHOP_APP_TAB_DISCOVERY_STARTED",
    event: "BIND_SHOP_APP_TAB_DISCOVERY_STARTED",
  }), NOW).state, "BIND_SHOP_APP_TAB_DISCOVERY_STARTED")
  for (const state of ["BIND_REQUEST_ACCEPTED",
    "BIND_EXISTING_CHECKOUT_SEARCH_STARTED",
    "BIND_EXISTING_CHECKOUT_FOUND", "BIND_CHECKOUT_BOOTSTRAP_REQUIRED",
    "BIND_START_JOB_INVOKED",
    "BIND_BOOTSTRAP_PRODUCT_OPENED", "BIND_BOOTSTRAP_PRODUCT_VERIFIED",
    "BIND_BOOTSTRAP_CART_CONFIRMED",
    "BIND_BOOTSTRAP_CHECKOUT_NAVIGATION_OBSERVED",
    "BIND_BOOTSTRAP_CHECKOUT_DETECTED", "BIND_SHIP_TO_DETECTED"]) {
    assert.equal(normalizeLunaShippingRuntimeTraceEventV1(traceEvent({
      state, event: state,
    }), NOW).state, state)
  }
  assert.equal(normalizeLunaShippingRuntimeTraceEventV1(traceEvent({
    state: "INITIAL_AUTO_CLAIM_STARTED",
    event: "INITIAL_AUTO_CLAIM_STARTED",
  }), NOW).state, "INITIAL_AUTO_CLAIM_STARTED")
  const totalDiagnostics = normalizeLunaShippingRuntimeTraceEventV1(traceEvent({
    subtotalLabelFound: true, subtotalAmountCandidateFound: true,
    subtotalCurrencyFound: true, subtotalParsed: true,
    shippingLabelFound: true, shippingAmountCandidateFound: true,
    shippingCurrencyFound: true, shippingParsed: true,
    totalLabelFound: true, totalCurrencyFound: true,
    totalAmountCandidateFound: true, totalParsed: true,
  }), NOW)
  assert.equal(totalDiagnostics.subtotalParsed, true)
  assert.equal(totalDiagnostics.shippingParsed, true)
  assert.equal(totalDiagnostics.totalParsed, true)
  const discoveryDiagnostics = normalizeLunaShippingRuntimeTraceEventV1(
    traceEvent({ state: "BIND_SHOP_APP_TAB_DISCOVERY_RESULT",
      event: "BIND_SHOP_APP_TAB_DISCOVERY_RESULT", tabsQueryTotalCount: 7,
      shopAppProbedCount: 7, tabsEnumeratedCount: 7,
      contentScriptResponderCount: 2,
      eligibleCheckoutCount: 1, probeAttemptCount: 7,
      probeResponseCount: 2, eligibleResponseCount: 1,
      probeErrorCount: 5, bindCheckoutDiscoveryValidCount: 1,
      bindCheckoutBootstrapRequired: true,
      bindCheckoutBootstrapAttempted: true,
      bindStartJobInvoked: true }), NOW)
  assert.equal(discoveryDiagnostics.tabsQueryTotalCount, 7)
  assert.equal(discoveryDiagnostics.tabsEnumeratedCount, 7)
  assert.equal(discoveryDiagnostics.contentScriptResponderCount, 2)
  assert.equal(discoveryDiagnostics.eligibleCheckoutCount, 1)
  assert.equal(discoveryDiagnostics.probeAttemptCount, 7)
  assert.equal(discoveryDiagnostics.probeResponseCount, 2)
  assert.equal(discoveryDiagnostics.eligibleResponseCount, 1)
  assert.equal(discoveryDiagnostics.probeErrorCount, 5)
  assert.equal(discoveryDiagnostics.bindCheckoutDiscoveryValidCount, 1)
  assert.equal(discoveryDiagnostics.bindCheckoutBootstrapRequired, true)
  assert.equal(discoveryDiagnostics.bindCheckoutBootstrapAttempted, true)
  assert.equal(discoveryDiagnostics.bindStartJobInvoked, true)
  assert.equal(LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS, 100)
  assert.throws(() => normalizeLunaShippingRuntimeTraceEventV1(
    traceEvent({ rawAddress: "forbidden" }), NOW),
  /LUNA_SHIPPING_RUNTIME_TRACE_CONTRACT_INVALID/)
  assert.throws(() => normalizeLunaShippingRuntimeTraceEventV1(
    traceEvent({ sequence: 101 }), NOW),
  /LUNA_SHIPPING_RUNTIME_TRACE_CONTRACT_INVALID/)
  assert.throws(() => normalizeLunaShippingRuntimeTraceEventV1(
    traceEvent({ purchaseBoundaryEnforced: false }), NOW),
  /LUNA_SHIPPING_RUNTIME_TRACE_CONTRACT_INVALID/)
})

test("runtime trace batch reuses the durable same-day event store with readback", async () => {
  let durableRows = []
  const supabase = { from(table) {
    return {
      select() { return this },
      eq() { return this },
      order() { return this },
      limit() { return this },
      maybeSingle() {
        if (table === "ebay_same_day_pilot_runs") {
          return Promise.resolve({ data: { id: "run-test" }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      upsert(rows) {
        durableRows = rows
        return Promise.resolve({ error: null })
      },
      in() {
        return Promise.resolve({ data: durableRows.map((row) => ({
          idempotency_key: row.idempotency_key,
          event_payload: row.event_payload,
        })), error: null })
      },
    }
  } }
  const events = [traceEvent(), traceEvent({ sequence: 2,
    state: "JOB_DISPATCHED", event: "JOB_DISPATCHED" })]
  const result = await persistLunaShippingRuntimeTraceV1({ supabase,
    accountKey: `test:${"a".repeat(64)}`, events, now: NOW })
  assert.equal(result.traceDurable, true)
  assert.equal(result.durableReadbackMatch, true)
  assert.equal(durableRows.length, 2)
  assert.equal(durableRows[0].event_type, LUNA_SHIPPING_RUNTIME_TRACE_VERSION)
  assert.equal(durableRows[0].ebay_writes, 0)
  assert.equal(JSON.stringify(durableRows).includes("rawAddress"), false)
})

test("exact visible Luna shipping becomes canonical economics without a write", () => {
  const result = certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(), now: NOW,
  })
  assert.equal(result.captureStatus, "AUTHORITATIVE_LUNA_SHIPPING_AVAILABLE")
  assert.equal(result.quote.shippingAmountUsd, 4.25)
  assert.equal(result.quote.acquisitionMethod,
    "NORMAL_CHROME_EXTENSION_VISIBLE_DOM")
  assert.equal(result.quote.exactLunaIdentity, true)
  assert.equal(result.economics.contributionProfitUsd, 4.96)
  assert.equal(result.lunaPurchases, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("product, variant and supplier SKU mismatches fail closed", () => {
  for (const mismatch of [
    { lunaProductId: "9220832493793" },
    { lunaVariantId: "48809643540705" },
    { supplierSku: "ITEM3734-WRONG" },
  ]) assert.throws(() => certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(mismatch), now: NOW,
  }), /LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN/)
})

test("bounded POST contract accepts only sanitized commercial evidence", () => {
  const visible = capture()
  const post = {
    candidateId: visible.candidateId,
    lunaProductId: visible.lunaProductId,
    lunaVariantId: visible.lunaVariantId,
    supplierSku: visible.supplierSku,
    quantity: visible.quantity,
    subtotalUsd: visible.subtotalUsd,
    shippingUsd: visible.shippingUsd,
    totalUsd: visible.totalUsd,
    currency: visible.currency,
    observedAt: visible.observedAt,
    acquisitionMethod: visible.acquisitionMethod,
    evidenceDigest: visible.extensionEvidenceDigest,
    captureSessionId: visible.captureSessionId,
    nonce: visible.nonce,
  }
  const result = certifyLunaShippingCapturePostV1({ job: job(), capture: post,
    now: NOW })
  assert.equal(result.quote.shippingAmountUsd, 4.25)
  assert.throws(() => certifyLunaShippingCapturePostV1({ job: job(),
    capture: { ...post, rawHtml: "<html>" }, now: NOW }),
  /LUNA_SHIPPING_CAPTURE_POST_CONTRACT_INVALID/)
})

test("capture session is snapshot-bound, fresh, signed, and invalid after authority changes", () => {
  const secret = "test-only-secret-not-a-production-value".repeat(2)
  const candidateId = job().identity.candidateId
  const snapshotDigest = `sha256:${"c".repeat(64)}`
  const session = issueLunaShippingCaptureSessionV1({ secret, candidateId,
    snapshotDigest, now: NOW })
  assert.ok(verifyLunaShippingCaptureSessionV1({ secret, candidateId,
    snapshotDigest, ...session, now: NOW + 1_000 }))
  assert.throws(() => verifyLunaShippingCaptureSessionV1({ secret, candidateId,
    snapshotDigest: `sha256:${"d".repeat(64)}`, ...session, now: NOW + 1_000 }),
  /LUNA_SHIPPING_CAPTURE_SESSION_INVALID/)
  assert.throws(() => verifyLunaShippingCaptureSessionV1({ secret, candidateId,
    snapshotDigest, ...session, now: NOW + 11 * 60_000 }),
  /LUNA_SHIPPING_CAPTURE_SESSION_INVALID/)
})

test("stale, unreconciled or unauthenticated captures fail closed", () => {
  for (const unsafe of [
    { observedAt: "2026-08-24T16:00:00.000Z" },
    { totalUsd: 15.22 },
    { normalChromeAuthenticated: false },
    { cartRestoreProven: false },
  ]) assert.throws(() => certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: capture(unsafe), now: NOW,
  }), /LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN/)
})

test("job normalization allows only exact Luna product URLs and canonical facts", () => {
  assert.equal(normalizeLunaChromeShippingJobV1(job()).identity.canonicalProductUrl,
    "https://www.lunaportex.com/products/exact-microcurrent-device")
  assert.throws(() => normalizeLunaChromeShippingJobV1({ ...job(), identity: {
    ...job().identity, canonicalProductUrl: "https://example.com/products/wrong",
  } }), /LUNA_SHIPPING_PRODUCT_URL_INVALID/)
})

test("effective unpacked MV3 artifact has only fixed hosts and coherent build", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [manifestRaw, background, content] = await Promise.all([
    readFile(new URL("manifest.json", root), "utf8"),
    readFile(new URL("background.js", root), "utf8"),
    readFile(new URL("content.js", root), "utf8"),
  ])
  const manifest = JSON.parse(manifestRaw)
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, "1.0.39")
  assert.equal(manifest.name, "Seller OS — Luna Shipping Capture")
  assert.deepEqual(manifest.permissions, ["scripting", "webNavigation", "storage"])
  assert.deepEqual(manifest.host_permissions, [
    "https://lunaportex.com/*",
    "https://www.lunaportex.com/*",
    "https://account.lunaportex.com/*",
    "https://shop.app/*",
  ])
  assert.ok(manifest.content_scripts[0].matches.includes("https://shop.app/*"))
  assert.match(background, /EXTENSION_BUILD_VERSION = "1\.0\.39"/)
  assert.match(background, /SHOP_APP_HOST_PATTERN = "https:\/\/shop\.app\/\*"/)
  assert.match(background, /CHECKOUT_HOSTS\.has\("shop\.app"\)/)
  assert.match(content, /extensionBuildVersion: "1\.0\.39"/)
  assert.match(background,
    /BIND_CANONICAL_DESTINATION_EXECUTE_V1/)
  assert.match(content,
    /BIND_CANONICAL_DESTINATION_EXECUTE_V1/)
  assert.match(background,
    /BIND_EXECUTION_CONTRACT = "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1"/)
  assert.match(background,
    /BIND_CHECKOUT_BOOTSTRAP_TIMEOUT_MS = 90_000/)
  assert.match(background,
    /CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS = 20_000/)
  assert.match(background,
    /initializeCheckoutNavigationObserver\(exact\)/)
  assert.match(background,
    /observeCheckoutNavigation\(\{ tabId: sender\.tab\.id, frameId: 0,[\s\S]*url: sender\.url \}, true\)/)
  assert.equal(background.match(/"REAL_CHECKOUT_HOST_NOT_ALLOWLISTED"/g)
    ?.length, 1)
  assert.match(background,
    /CANONICAL_BIND_COMPLETED[\s\S]*finalizeCanonicalBindRuntime\(bootstrapStarted\)[\s\S]*port\.postMessage\(bindingResponse\)/)
  assert.match(background,
    /initializeCheckoutNavigationObserver\(exact\)[\s\S]*PRODUCTION_OBSERVER_REARMED[\s\S]*INITIAL_AUTO_CLAIM_STARTED/)
  assert.match(background,
    /startJob\(bootstrapJob, false, true\)/)
  assert.match(background, /emitRuntimeTrace\("BIND_START_JOB_INVOKED"/)
  assert.equal(background.match(/throw new Error\("BIND_CHECKOUT_TAB_NOT_FOUND"\)/g)
    ?.length, 1)
  assert.match(content, /bindingBootstrap: response\?\.bindingBootstrap === true/)
  assert.match(content,
    /if \(context\.bindingBootstrap === true\)[\s\S]*capture: null/)
  assert.match(content,
    /BIND_EXECUTION_CONTRACT = "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1"/)
  assert.match(background,
    /type: BIND_CANONICAL_DESTINATION_EXECUTE,[\s\S]*contractVersion: BIND_EXECUTION_CONTRACT/)
  assert.match(content,
    /message\?\.type === BIND_CANONICAL_DESTINATION_EXECUTE/)
  assert.doesNotMatch(background, /chrome\.scripting\.executeScript/)
  assert.doesNotMatch(content, /CANONICAL_BINDING_CHECKOUT_SHAPE_UNPROVEN/)
  assert.match(background,
    /BIND_ELIGIBILITY_CONTRACT = "LUNA_BIND_ELIGIBILITY_PROBE_V1"/)
  assert.match(content,
    /BIND_ELIGIBILITY_CONTRACT = "LUNA_BIND_ELIGIBILITY_PROBE_V1"/)
  assert.match(background, /type: BIND_ELIGIBILITY_PROBE,[\s\S]*contractVersion: BIND_ELIGIBILITY_CONTRACT/)
  assert.match(content, /message\?\.type === BIND_ELIGIBILITY_PROBE/)
  assert.match(content,
    /message\?\.type === BIND_CANONICAL_DESTINATION_EXECUTE[\s\S]*return true/)
  assert.doesNotThrow(() => new Script(content, {
    filename: "luna-shipping-capture/content.js",
  }))
  assert.equal(content.match(/const checkoutBootstrapAckPromise\b/g)?.length, 1)
  assert.doesNotMatch(background, /files:\s*\["content\.js"\]/)
  assert.doesNotMatch(background, /storage\.local\.(?:clear|remove)/)
  assert.match(background, /BINDING_PRESENT_INVALID/)
  assert.match(background, /BINDING_STORAGE_READ_FAILED/)
  assert.match(background, /BINDING_STORAGE_MIGRATION_READBACK_FAILED/)
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"))
  assert.deepEqual(manifest.externally_connectable.matches, [
    "https://imnova-website-z1qh-git-codex-674439-earch19792-6888s-projects.vercel.app/*",
  ])
  const key = Buffer.from(manifest.key, "base64")
  const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("")
  assert.equal(id, LUNA_SHIPPING_EXTENSION_ID)
})

test("fresh page and service-worker wake use the same bounded external handshake", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [background, manifestRaw] = await Promise.all([
    readFile(new URL("background.js", root), "utf8"),
    readFile(new URL("manifest.json", root), "utf8"),
  ])
  const manifest = JSON.parse(manifestRaw)
  const controlUrl =
    "https://imnova-website-z1qh-git-codex-674439-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture"
  const oldControlUrl =
    "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture"
  const legacyDurableBinding = {
    canonicalDestinationFingerprint: `sha256:${"a".repeat(64)}`,
    fingerprintVersion: "LUNA_SHOP_PAY_DESTINATION_SHA256_V1",
    countryClass: "US",
  }
  let persistedStorage = {
    sellerOsLunaCanonicalDestinationBindingV1: legacyDurableBinding,
  }
  const startWorker = ({ readFails = false } = {}) => {
    let externalMessageListener = null
    let externalConnectListener = null
    const chrome = {
      runtime: {
        id: LUNA_SHIPPING_EXTENSION_ID, lastError: null,
        getManifest: () => manifest,
        onInstalled: { addListener() {} },
        onMessageExternal: { addListener(listener) {
          externalMessageListener = listener
        } },
        onConnectExternal: { addListener(listener) {
          externalConnectListener = listener
        } },
        onMessage: { addListener() {} },
      },
      tabs: {
        create: async () => ({ id: 7 }), update: async () => ({}),
        query(_query, callback) { callback([]) },
        sendMessage(_tabId, _message, _options, callback) { callback() },
        onRemoved: { addListener() {} },
      },
      storage: { local: {
        get(_key, callback) {
          if (readFails) {
            chrome.runtime.lastError = { message: "test-storage-read-failed" }
            callback({})
            chrome.runtime.lastError = null
            return
          }
          callback(persistedStorage)
        },
        set(value, callback) { persistedStorage = { ...value }; callback() },
      } },
      scripting: { executeScript: async () => [] },
      webNavigation: {
        onCommitted: { addListener() {} },
        onCompleted: { addListener() {} },
      },
    }
    runInNewContext(background, { chrome, crypto: webcrypto, URL, TextDecoder,
      TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
    return { externalMessageListener, externalConnectListener }
  }
  for (let wake = 0; wake < 2; wake += 1) {
    const worker = startWorker()
    let pong = null
    assert.equal(worker.externalMessageListener({
      type: "SELLER_OS_LUNA_SHIPPING_PING",
    }, { url: controlUrl }, (value) => { pong = value }), false)
    assert.deepEqual(JSON.parse(JSON.stringify(pong)), {
      type: "LUNA_SHIPPING_EXTENSION_READY",
      extensionId: LUNA_SHIPPING_EXTENSION_ID,
      extensionVersion: "1.0.39", extensionBuildVersion: "1.0.39",
      shopAppManifestPermission: true, shopAppContentScriptMatch: true,
      shopAppRuntimeAllowlist: true,
      shopAppCheckoutHostClassification: true,
      sellerOsOriginValidated: true,
    })
    let staleOriginPong = null
    assert.equal(worker.externalMessageListener({
      type: "SELLER_OS_LUNA_SHIPPING_PING",
    }, { url: oldControlUrl }, (value) => { staleOriginPong = value }), false)
    assert.equal(staleOriginPong, null)
    let portMessage = null
    const posted = []
    worker.externalConnectListener({
      name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
      sender: { url: controlUrl }, disconnect() {},
      postMessage(value) { posted.push(value) },
      onMessage: { addListener(listener) { portMessage = listener } },
      onDisconnect: { addListener() {} },
    })
    portMessage({
      type: "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1",
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const diagnostic = posted.at(-1)
    assert.equal(diagnostic?.type, "LUNA_BINDING_STORAGE_DIAGNOSTIC_V1")
    assert.equal(diagnostic?.extensionId, LUNA_SHIPPING_EXTENSION_ID)
    assert.equal(diagnostic?.expectedExtensionId, LUNA_SHIPPING_EXTENSION_ID)
    assert.equal(diagnostic?.extensionIdContinuity, true)
    assert.equal(diagnostic?.extensionVersion, "1.0.39")
    assert.equal(diagnostic?.storageAreaUsed, "chrome.storage.local")
    assert.equal(diagnostic?.canonicalPrimaryKeyPresent, true)
    assert.equal(diagnostic?.canonicalLegacyKeyPresent, false)
    assert.equal(diagnostic?.canonicalEnvelopePresent, true)
    assert.equal(diagnostic?.canonicalEnvelopeSchemaVersion,
      "LUNA_SHOP_PAY_DESTINATION_SHA256_V1")
    assert.equal(diagnostic?.canonicalEnvelopeValid, true)
    assert.equal(diagnostic?.canonicalCountryClassPresent, true)
    assert.equal(diagnostic?.canonicalFingerprintPresent, true)
    assert.equal(diagnostic?.canonicalBoundAtPresent, wake > 0)
    assert.equal(diagnostic?.storageReadStatus, "READ_OK")
    assert.equal(diagnostic?.bindingClassification, wake === 0
      ? "LEGACY_BINDING_VALID" : "PRIMARY_BINDING_VALID")
    assert.equal(diagnostic?.authoritiesAligned, true)
    assert.equal(diagnostic?.writeStorageAuthority,
      "chrome.storage.local:sellerOsLunaCanonicalDestinationBindingV1")
    assert.equal(diagnostic?.readStorageAuthority,
      diagnostic.writeStorageAuthority)
    assert.equal(diagnostic?.statusStorageAuthority,
      diagnostic.writeStorageAuthority)
    assert.equal(diagnostic?.autoClaimStorageAuthority,
      diagnostic.writeStorageAuthority)
    assert.equal(Object.hasOwn(diagnostic, "canonicalDestinationFingerprint"),
      false)
    assert.equal(Object.hasOwn(diagnostic, "canonicalProfileDigest"), false)
    if (wake === 0) assert.equal(Object.hasOwn(persistedStorage
      .sellerOsLunaCanonicalDestinationBindingV1, "boundAt"), false)
    portMessage({ type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(posted.at(-1)?.type, "LUNA_CANONICAL_DESTINATION_STATUS")
    assert.equal(posted.at(-1)?.canonicalDestinationBound, true)
    assert.equal(posted.at(-1)?.canonicalDestinationMatch, false)
    assert.equal(posted.at(-1)?.bindingStatus, "BINDING_PRESENT_VALID")
    assert.match(persistedStorage
      .sellerOsLunaCanonicalDestinationBindingV1.boundAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  }
  persistedStorage = {}
  const emptyWorker = startWorker()
  let emptyPortMessage = null
  const emptyPosted = []
  emptyWorker.externalConnectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: controlUrl }, disconnect() {},
    postMessage(value) { emptyPosted.push(value) },
    onMessage: { addListener(listener) { emptyPortMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  emptyPortMessage({
    type: "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(emptyPosted.at(-1)?.bindingClassification,
    "NO_BINDING_PRESENT")
  assert.equal(emptyPosted.at(-1)?.canonicalPrimaryKeyPresent, false)
  assert.equal(emptyPosted.at(-1)?.canonicalEnvelopePresent, false)
  emptyPortMessage({ type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(emptyPosted.at(-1)?.canonicalDestinationBound, false)
  assert.equal(emptyPosted.at(-1)?.bindingStatus, "NO_BINDING_PRESENT")
  persistedStorage = { sellerOsLunaCanonicalDestinationBindingV1: {
    fingerprintVersion: "LUNA_SHOP_PAY_DESTINATION_SHA256_V1",
    canonicalDestinationFingerprint: "invalid", countryClass: "US",
  } }
  const invalidWorker = startWorker()
  let invalidPortMessage = null
  const invalidPosted = []
  invalidWorker.externalConnectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: controlUrl }, disconnect() {},
    postMessage(value) { invalidPosted.push(value) },
    onMessage: { addListener(listener) { invalidPortMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  invalidPortMessage({
    type: "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(invalidPosted.at(-1)?.bindingClassification,
    "BINDING_PRESENT_FIELD_REJECTED")
  assert.equal(invalidPosted.at(-1)?.canonicalFingerprintPresent, true)
  assert.equal(invalidPosted.at(-1)?.canonicalEnvelopeValid, false)
  invalidPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(invalidPosted.at(-1)?.error, "BINDING_PRESENT_INVALID")
  assert.equal(invalidPosted.at(-1)?.canonicalDestinationBound, undefined)
  persistedStorage = { sellerOsLunaCanonicalDestinationBindingV1: {
    fingerprintVersion: "UNSUPPORTED_DESTINATION_SCHEMA",
    canonicalDestinationFingerprint: `sha256:${"b".repeat(64)}`,
    countryClass: "US", boundAt: "2026-08-24T18:00:00.000Z",
  } }
  const schemaWorker = startWorker()
  let schemaPortMessage = null
  const schemaPosted = []
  schemaWorker.externalConnectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: controlUrl }, disconnect() {},
    postMessage(value) { schemaPosted.push(value) },
    onMessage: { addListener(listener) { schemaPortMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  schemaPortMessage({
    type: "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(schemaPosted.at(-1)?.bindingClassification,
    "BINDING_PRESENT_SCHEMA_REJECTED")
  assert.equal(schemaPosted.at(-1)?.canonicalEnvelopeSchemaVersion,
    "UNSUPPORTED")
  const failingWorker = startWorker({ readFails: true })
  let failingPortMessage = null
  const failingPosted = []
  failingWorker.externalConnectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: controlUrl }, disconnect() {},
    postMessage(value) { failingPosted.push(value) },
    onMessage: { addListener(listener) { failingPortMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  failingPortMessage({
    type: "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(failingPosted.at(-1)?.storageReadStatus,
    "BINDING_STORAGE_READ_FAILED")
  assert.equal(failingPosted.at(-1)?.bindingClassification,
    "STORAGE_READ_FAILED")
  failingPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(failingPosted.at(-1)?.error, "BINDING_STORAGE_READ_FAILED")
  assert.equal(failingPosted.at(-1)?.canonicalDestinationBound, undefined)
})

test("shop.app static content authority parses, ACKs once, and answers capability probe", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  let runtimeListener = null
  let bootstrapAckCount = 0
  const element = (textContent, attributes = {}) => ({
    textContent, innerText: textContent, parentElement: null, children: [],
    getAttribute(name) { return attributes[name] ?? null },
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
  })
  const shipTo = element("Ship to Test Destination FL 33487", {
    "data-shipping-address": "true",
  })
  const shipping = element("Shipping $6.99 USD")
  const subtotal = element("Subtotal $10.96 USD")
  const total = element("Total USD $17.95")
  const summary = element(
    "Subtotal $10.96 USD Shipping $6.99 USD Total USD $17.95")
  summary.children = [subtotal, shipping, total]
  summary.matches = (selector) => selector.includes("data-order-summary")
  for (const row of summary.children) row.parentElement = summary
  const markers = [shipTo, summary, shipping, subtotal, total,
    element("Payment"), element("Pay now")]
  const context = {
    URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal, Event,
    crypto: webcrypto, setInterval, clearInterval, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    location: { hostname: "shop.app", pathname: "/pay/opaque-checkout",
      origin: "https://shop.app", assign() {} },
    document: { readyState: "complete", body: {}, documentElement: {},
      querySelector: () => null, querySelectorAll: () => markers },
    getComputedStyle: () => ({ display: "block", visibility: "visible",
      opacity: "1" }),
    __sellerOsLunaShippingCaptureAttachedV1: true,
    chrome: { runtime: {
      lastError: null,
      onMessage: { addListener(listener) { runtimeListener = listener } },
      sendMessage(message, callback) {
        if (message.type === "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK") {
          bootstrapAckCount += 1
          callback?.({ accepted: true })
        }
      },
    } },
  }
  assert.doesNotThrow(() => runInNewContext(content, context, {
    filename: "unpacked/luna-shipping-capture/content.js",
  }))
  assert.equal(bootstrapAckCount, 1)
  let response = null
  assert.equal(runtimeListener({
    type: "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1",
    contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_V1",
  }, {}, (value) => { response = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(Object.keys(response).sort(), [
    "checkoutHostClassification", "checkoutPageDetected", "contractVersion",
    "eligible", "payNowMarker", "shipToMarker", "shippingMarker",
    "subtotalMarker", "totalMarker",
  ])
  assert.equal(response.contractVersion, "LUNA_BIND_ELIGIBILITY_PROBE_V1")
  assert.equal(response.checkoutHostClassification, "SHOP_PAY_CHECKOUT_HOST")
  assert.ok(["eligible", "checkoutPageDetected", "payNowMarker",
    "shipToMarker", "shippingMarker", "subtotalMarker", "totalMarker"]
    .every((field) => response[field] === true))
  let mismatchedResponse = null
  assert.equal(runtimeListener({
    type: "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1",
    contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_WRONG",
  }, {}, (value) => { mismatchedResponse = value }), false)
  assert.equal(mismatchedResponse.contractVersion,
    "LUNA_BIND_ELIGIBILITY_PROBE_V1")
  assert.equal(mismatchedResponse.eligible, false)
  assert.equal(mismatchedResponse.checkoutPageDetected, false)
})

test("extension is shipping-only, bounded, and cannot inspect browser auth state", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [content, background] = await Promise.all([
    readFile(new URL("content.js", root), "utf8"),
    readFile(new URL("background.js", root), "utf8"),
  ])
  assert.match(content, /MAX_ATTEMPTS_PER_STEP = 2/)
  assert.match(content, /LUNA_SHIPPING_DOM_CONTRACT_CHANGED/)
  assert.match(content, /cart\/clear\.js/)
  assert.match(content, /cart\/add\.js/)
  assert.doesNotMatch(content + background,
    /localStorage|sessionStorage|document\.cookie|chrome\.cookies|webRequest|Authorization/)
  assert.doesNotMatch(content + background,
    /\/orders?(?:\/|\b)|payment_intent/i)
  assert.match(content, /irreversibleCommerceControl/)
  assert.match(content, /LUNA_PURCHASE_BOUNDARY_REACHED/)
  assert.ok(content.indexOf("SHOP_APP_CHECKOUT_BOOTSTRAP_ACK") <
    content.indexOf("const CONTRACT"))
  assert.ok(content.indexOf("bootstrapReady") <
    content.lastIndexOf("recoverJobContext()"))
  assert.match(background, /CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED/)
  assert.match(background, /INJECTION_API_ERROR/)
  assert.match(background, /WRONG_FRAME_TARGET/)
  assert.doesNotMatch(content, /frame\.contentDocument/)
  assert.match(background, /START_SHIPPING_JOB/)
  assert.match(background, /chrome\.runtime\.onMessageExternal\.addListener/)
  assert.match(background, /SELLER_OS_LUNA_SHIPPING_PING/)
  assert.match(background, /LUNA_SHIPPING_EXTENSION_READY/)
  assert.match(background, /sellerOsOriginValidated: true/)
  assert.match(background, /safeSellerSender\(sender\)/)
  assert.match(background, /if \(sellerPort !== port\) return/)
  assert.match(background, /chrome\.tabs\.update/)
  assert.match(content, /GET_ACTIVE_LUNA_SHIPPING_JOB/)
  assert.match(content, /MutationObserver/)
  assert.match(content, /AWAITING_CART_CONFIRMATION/)
  assert.match(content, /ACTIVE_JOB_RECOVERED_ON_CART/)
  assert.match(content, /CART_EXPECTED_PRODUCT_FOUND/)
  assert.match(content, /SHIPPING_FLOW_RESUMED/)
  assert.doesNotMatch(content, /LUNA_NORMAL_CHROME_AUTH_UNPROVEN/)
  assert.match(content, /AUTH_NOT_YET_REQUIRED/)
  assert.match(content, /AUTHENTICATED_OPERATION_CONFIRMED/)
})

test("Seller OS page proves the external bridge before opening the job port", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  assert.match(page, /SELLER_OS_LUNA_SHIPPING_PING/)
  assert.match(page, /LUNA_SHIPPING_EXTENSION_READY/)
  assert.match(page, /EXPECTED_EXTENSION_VERSION = "1\.0\.39"/)
  assert.match(page, /Usar destino actual como benchmark canónico/)
  assert.match(page, /SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS/)
  assert.match(page, /LUNA_CANONICAL_DESTINATION_STATUS/)
  assert.match(page, /SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1/)
  assert.match(page, /LUNA_BINDING_STORAGE_DIAGNOSTIC_V1/)
  assert.match(page, /REAL_BINDING_STORAGE_DIAGNOSTIC:/)
  assert.match(page, /CANONICAL_FINGERPRINT_PRESENT=/)
  assert.match(page, /purpose: "CANONICAL_BIND_BOOTSTRAP"/)
  assert.match(page,
    /SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION[\s\S]*bootstrapJob/)
  assert.doesNotMatch(page, /canonicalDestinationFingerprint}/)
  assert.match(page, /Ejecutar canary final/)
  const finalCanaryGate = page.match(
    /function finalCanaryStartEnabled[\s\S]*?\n\}/)?.[0] ?? ""
  assert.match(finalCanaryGate,
    /return connected && canonicalDestinationBound && !canaryRunInProgress/)
  assert.doesNotMatch(finalCanaryGate, /canonicalDestinationMatch/)
  assert.match(page,
    /disabled=\{!canStartFinalCanary\}[\s\S]*?Ejecutar canary final/)
  assert.match(page,
    /if \(busy \|\| !extensionReady \|\| !canonicalBindingReady\) return/)
  const canStart = (connected, bound, running) =>
    connected && bound && !running
  assert.equal(canStart(true, true, false), true)
  assert.equal(canStart(true, false, false), false)
  assert.equal(canStart(false, true, false), false)
  assert.equal(canStart(true, true, true), false)
  assert.match(page, /Configuración única\. Seller OS guarda sólo un fingerprint del destino,/)
  assert.match(page, /no la dirección\./)
  assert.match(page, /shopAppManifestPermission !== true/)
  assert.match(page, /shopAppRuntimeAllowlist !== true/)
  assert.match(page, /runtime\.sendMessage\(EXTENSION_ID/)
  assert.ok(page.indexOf("detectAndWakeLunaShippingExtensionV1") <
    page.indexOf("runtime.connect"))
  assert.match(page, /Ejecutar canary de shipping/)
  assert.match(page, /params\.get\("runShipping"\) === "1"/)
})

test("fresh Seller OS startup waits for runtime and wakes an asleep service worker", async () => {
  const runtime = { connect() {}, sendMessage() {} }
  let runtimeReads = 0
  let pingAttempts = 0
  const detected = await detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => {
      runtimeReads += 1
      return runtimeReads < 3 ? undefined : runtime
    },
    pingRuntime: async (candidate) => {
      assert.equal(candidate, runtime)
      pingAttempts += 1
      if (pingAttempts === 1) {
        throw new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED")
      }
    },
    wait: async () => {},
    runtimeAttempts: 4,
    pingAttempts: 2,
  })
  assert.equal(detected, runtime)
  assert.equal(runtimeReads, 3)
  assert.equal(pingAttempts, 2)
})

test("extension detection reserves NOT_INSTALLED for sustained API absence", async () => {
  await assert.rejects(() => detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => undefined,
    pingRuntime: async () => {},
    wait: async () => {},
    runtimeAttempts: 3,
  }), /LUNA_SHIPPING_EXTENSION_NOT_INSTALLED/)

  const runtime = { connect() {}, sendMessage() {} }
  await assert.rejects(() => detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => runtime,
    pingRuntime: async () => {
      throw new Error("LUNA_SHIPPING_EXTENSION_HANDSHAKE_INVALID")
    },
    wait: async () => {},
  }), /LUNA_SHIPPING_EXTENSION_HANDSHAKE_INVALID/)
  await assert.rejects(() => detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => runtime,
    pingRuntime: async () => {
      throw new Error("LUNA_SHIPPING_EXTENSION_PING_TIMEOUT")
    },
    wait: async () => {},
    pingAttempts: 2,
  }), /LUNA_SHIPPING_EXTENSION_PING_TIMEOUT/)
})

test("canary control exposes deterministic states and auto-drains existing eligible jobs", async () => {
  const [page, server] = await Promise.all([
    readFile(new URL(
      "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
    "utf8"),
    readFile(new URL("./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
  ])
  for (const state of ["EXTENSION_CONNECTED", "CANARY_DISPATCHED", "CAPTURING",
    "CONTENT_SCRIPT_LOADED", "ACTIVE_JOB_REQUESTED", "ACTIVE_JOB_RECOVERED",
    "PRODUCT_PAGE_DOM_READY", "PRODUCT_IDENTITY_CHECK_STARTED",
    "PRODUCT_IDENTITY_VERIFIED", "ADD_TO_CART_ELEMENT_FOUND",
    "AWAITING_CART_CONFIRMATION", "ADD_TO_CART_CLICK_DISPATCHED",
    "ACTIVE_JOB_RECOVERED_ON_CART", "CART_PAGE_DETECTED",
    "CART_EXPECTED_PRODUCT_FOUND", "CART_EXPECTED_QUANTITY_FOUND",
    "CART_MUTATION_CONFIRMED", "BRIDGE_RECONNECTED",
    "SHIPPING_FLOW_RESUMED", "AWAITING_CHECKOUT_SHIPPING",
    "CHECKOUT_NAVIGATION_OBSERVED", "CHECKOUT_HOST_ALLOWED",
    "CHECKOUT_INJECTION_REQUESTED", "CHECKOUT_INJECTION_API_SUCCEEDED",
    "CHECKOUT_SCRIPT_INJECTED", "CHECKOUT_SCRIPT_BOOTSTRAP_ACK",
    "CHECKOUT_CONTENT_SCRIPT_LOADED", "ACTIVE_JOB_RECOVERED_ON_CHECKOUT",
    "CHECKOUT_CLASSIFIER_STARTED", "CHECKOUT_HOST_CLASSIFIED",
    "SHOP_PAY_DOM_WAITING", "SHOP_PAY_DOM_READY", "CHECKOUT_PAGE_CLASSIFIED",
    "CHECKOUT_PAGE_DETECTED", "SHOP_PAY_QUOTE_PARSER_STARTED",
    "NORMAL_GUEST_CHECKOUT",
    "NORMAL_CHECKOUT_WITH_CONTACT_FORM", "NORMAL_CHECKOUT_WITH_SHIPPING_FORM",
    "NORMAL_CHECKOUT_WITH_SHIPPING", "SHOP_PAY_DOM_WAITING",
    "SHOP_PAY_DOM_READY", "CHECKOUT_EXPECTED_PRODUCT_VERIFIED",
    "CHECKOUT_EXPECTED_QUANTITY_VERIFIED",
    "EXPLICIT_LOGIN_PAGE", "EXPLICIT_AUTH_CHALLENGE", "SESSION_EXPIRED",
    "UNKNOWN_CHECKOUT_PAGE", "CANONICAL_US_PROFILE_FOUND",
    "SHIPPING_ADDRESS_ACCEPTED", "SHIPPING_OPTIONS_DETECTED",
    "SHIPPING_CAPTURE_STARTED", "SHIPPING_QUOTE_CAPTURED", "RESULT_POSTED",
    "RESULT_PERSISTED", "ECONOMICS_EVALUATED", "PASS", "FAIL"]) {
    assert.match(page, new RegExp(`\\"${state}\\"`))
  }
  assert.match(page, new RegExp(CANARY_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(page, /await loadJobs\(undefined, "AUTO"\)/)
  assert.match(page, /RESUME_ACTIVE_LUNA_SHIPPING_JOB/)
  assert.match(server, /SHIPPING_DURABLY_PERSISTED/)
  assert.match(server, /SHIPPING_OBSERVED/)
  assert.match(server, /if \(!requested\.length\) return Object\.freeze\(\[\]\)/)
})

test("production page worker claims its first eligible job without canary or capture bootstrap", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const initialClaim = page.match(
    /const startInitialProductionClaim = \(\) => \{[\s\S]*?\n    \}/)?.[0] ?? ""
  assert.match(initialClaim, /!extensionReady/)
  assert.match(initialClaim, /!canonicalBindingReady/)
  assert.match(initialClaim, /!activeJobStatusReady/)
  assert.match(initialClaim, /initialAutoClaimStarted = true/)
  assert.match(initialClaim, /loadJobs\(undefined, "AUTO"\)/)
  assert.doesNotMatch(initialClaim, /CANARY_ID|previous|capturePostAccepted/)
  assert.match(page, /SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS/)
  assert.match(page, /LUNA_SHIPPING_ACTIVE_JOB_STATUS/)
  assert.match(page, /WORKER_IDLE_NO_ELIGIBLE_JOB/)
  assert.match(page, /productionAutoClaim: mode === "AUTO"/)
  assert.match(page, /await loadJobs\(undefined, "AUTO"\)/)
})

test("page canary job passes the extension validator and missing fields fail closed", async () => {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  let connectListener = null
  let runtimeMessageListener = null
  const posted = []
  const createdTabs = []
  const chrome = {
    runtime: {
      id: LUNA_SHIPPING_EXTENSION_ID,
      getManifest: () => ({ version: "1.0.39" }),
      onInstalled: { addListener() {} },
      onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener(listener) { runtimeMessageListener = listener } },
    },
    tabs: {
      create: async ({ url }) => { createdTabs.push(url); return { id: 7 } },
      update: async () => ({}),
      onRemoved: { addListener() {} },
    },
  }
  runInNewContext(background, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  assert.equal(typeof connectListener, "function")
  let messageListener = null
  connectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: "https://imnova-website-z1qh-git-codex-674439-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture" },
    disconnect() {},
    postMessage(value) { posted.push(value) },
    onMessage: { addListener(listener) { messageListener = listener } },
    onDisconnect: { addListener() {} },
  })
  const session = issueLunaShippingCaptureSessionV1({
    secret: "test-only-secret-not-a-production-value".repeat(2),
    candidateId: job().identity.candidateId,
    snapshotDigest: `sha256:${"c".repeat(64)}`,
    now: NOW,
  })
  const pageCanaryJob = { ...job(), ...session }
  messageListener({ type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS" })
  assert.equal(posted.at(-1)?.type, "LUNA_SHIPPING_ACTIVE_JOB_STATUS")
  assert.equal(posted.at(-1)?.active, false)
  messageListener({ type: "START_SHIPPING_JOB", job: pageCanaryJob })
  await waitForTestCondition(() => createdTabs.length === 1)
  assert.equal(createdTabs.length, 1)
  assert.deepEqual(posted.map((entry) => entry.event?.state).filter(Boolean),
    ["BRIDGE_CONNECTED", "JOB_DISPATCHED"])
  messageListener({ type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS" })
  assert.equal(posted.at(-1)?.type, "LUNA_SHIPPING_ACTIVE_JOB_STATUS")
  assert.equal(posted.at(-1)?.active, true)
  assert.equal(posted.at(-1)?.job?.captureSessionId,
    pageCanaryJob.captureSessionId)
  messageListener({ type: "START_SHIPPING_JOB", job: pageCanaryJob,
    productionAutoClaim: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(createdTabs.length, 1)
  messageListener({ type: "START_SHIPPING_JOB", job: {
    ...pageCanaryJob,
    captureSessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    nonce: `1770000000000.${"a".repeat(43)}`,
    identity: { ...pageCanaryJob.identity,
      candidateId: `sha256:${"f".repeat(64)}` },
  }, productionAutoClaim: true })
  await waitForTestCondition(() => posted.some((entry) =>
    entry.error === "LUNA_SHIPPING_JOB_ALREADY_RUNNING"))
  assert.equal(createdTabs.length, 1)
  let pulledJob = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 7 }, url: createdTabs[0] },
    (value) => { pulledJob = value })
  assert.equal(pulledJob?.accepted, true)
  assert.equal(pulledJob?.job?.captureSessionId, pageCanaryJob.captureSessionId)
  assert.equal(pulledJob?.job?.identity?.candidateId,
    pageCanaryJob.identity.candidateId)
  let resumeResponse = null
  runtimeMessageListener({ type: "SELLER_OS_LUNA_SHIPPING_JOB_RESUME",
    job: pageCanaryJob }, { tab: { id: 7 } }, (value) => { resumeResponse = value })
  assert.equal(resumeResponse?.accepted, true)
  assert.equal(resumeResponse?.captureSessionId, pageCanaryJob.captureSessionId)
  let conflictingResume = null
  runtimeMessageListener({ type: "SELLER_OS_LUNA_SHIPPING_JOB_RESUME",
    job: { ...pageCanaryJob,
      captureSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
  { tab: { id: 7 } }, (value) => { conflictingResume = value })
  assert.equal(conflictingResume?.accepted, false)
  assert.equal(conflictingResume?.error,
    "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")
  const { lunaVariantId: _missingVariantId, ...identityWithoutVariant } =
    pageCanaryJob.identity
  messageListener({ type: "START_SHIPPING_JOB", job: {
    ...pageCanaryJob, identity: identityWithoutVariant,
  } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(posted.at(-1)?.error,
    "JOB_MISSING_FIELD:identity.lunaVariantId")
})

test("product page proves exact identity and dispatches its visible Add to Cart control", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const variantField = { value: "", dispatchEvent() {} }
  let clicked = false
  const control = {
    textContent: "Add to cart", value: "", disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 120, height: 40 }),
    form: { querySelector: () => variantField }, closest: () => null,
    click: () => { clicked = true },
  }
  const context = {
    URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, atob,
    AbortSignal, Event, crypto, setInterval, clearInterval, setTimeout,
    clearTimeout, MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    location: { hash: "", hostname: "www.lunaportex.com",
      pathname: "/", origin: "https://www.lunaportex.com" },
    document: { readyState: "complete", body: {}, querySelector: () => null,
      querySelectorAll: () => [control], documentElement: { append() {} } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    chrome: { runtime: { sendMessage() {} } },
    fetch: async () => ({ ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id: "9220832493792", variants: [{
        id: "48809643540704", sku: "ITEM3734",
      }] }),
    }),
  }
  runInNewContext(content, context)
  context.location.pathname = "/products/exact-microcurrent-device"
  const exact = await context.exactProduct(job())
  assert.equal(String(exact.product.id), job().identity.lunaProductId)
  assert.equal(String(exact.variant.id), job().identity.lunaVariantId)
  const selected = await context.visibleAddToCartControl(job())
  selected.click()
  assert.equal(variantField.value, job().identity.lunaVariantId)
  assert.equal(clicked, true)
  context.document.querySelectorAll = () => []
  assert.equal(context.findVisibleAddToCartControl(job()), null)
  context.fetch = async () => ({ ok: true, headers: { get: () => null },
    text: async () => JSON.stringify({ id: "9220832493793", variants: [] }) })
  await assert.rejects(() => context.exactProduct(job()),
    /LUNA_EXACT_PRODUCT_IDENTITY_MISMATCH/)
})

test("SHOP_APP_CHECKOUT_ALLOWLIST_REGRESSION_GUARD rearms AUTO_NEXT checkout observation", async () => {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  const acceleratedBackground = background
    .replace("const CHECKOUT_BOOTSTRAP_ACK_TIMEOUT_MS = 2_500",
      "const CHECKOUT_BOOTSTRAP_ACK_TIMEOUT_MS = 25")
    .replace("const BIND_STEP_TIMEOUT_MS = 2_000",
      "const BIND_STEP_TIMEOUT_MS = 25")
    .replace("const BIND_TOP_FRAME_TIMEOUT_MS = 25_000",
      "const BIND_TOP_FRAME_TIMEOUT_MS = 50")
    .replace("const BIND_CONTENT_RESPONSE_TIMEOUT_MS = 5_000",
      "const BIND_CONTENT_RESPONSE_TIMEOUT_MS = 25")
    .replace("const BIND_CHECKOUT_BOOTSTRAP_TIMEOUT_MS = 90_000",
      "const BIND_CHECKOUT_BOOTSTRAP_TIMEOUT_MS = 50")
    .replace("const CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS = 20_000",
      "const CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS = 50")
  assert.notEqual(acceleratedBackground, background)
  let connectListener = null
  let runtimeMessageListener = null
  let firstPortMessage = null
  let firstPortDisconnect = null
  let secondPortMessage = null
  let navigationCommitted = null
  let navigationCompleted = null
  let tabRemoved = null
  const progress = []
  const createdTabs = []
  const injected = []
  const tabMessages = []
  const tabQueries = []
  let enumeratedTabs = [
    { id: 99, active: true, windowId: 1 },
    { id: 11, active: false, windowId: 2 },
    { id: 13, active: false, windowId: 1 },
  ]
  let capabilityResponders = new Map([[11, true], [13, false]])
  let validationMatches = true
  let bindingRejectReason = null
  let shopTabQueryStalls = false
  let storageWriteFails = false
  let storageReadFails = false
  let bindMessageStalls = false
  let storedDestination = {}
  const activeJob = { ...job(), ...issueLunaShippingCaptureSessionV1({
    secret: "test-only-secret-not-a-production-value".repeat(2),
    candidateId: job().identity.candidateId,
    snapshotDigest: `sha256:${"e".repeat(64)}`,
    now: NOW,
  }) }
  const chrome = {
    runtime: {
      id: LUNA_SHIPPING_EXTENSION_ID,
      getManifest: () => ({ version: "1.0.39" }),
      onInstalled: { addListener() {} },
      onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener(listener) { runtimeMessageListener = listener } },
    },
    tabs: {
      create: async ({ url }) => { createdTabs.push(url); return { id: 11 } },
      update: async () => ({}),
      query(queryInfo, callback) {
        tabQueries.push({ ...queryInfo })
        if (!shopTabQueryStalls) callback(enumeratedTabs)
      },
      sendMessage(tabId, message, _options, callback) {
        tabMessages.push({ tabId, ...message })
        if (message.type === "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1") {
          assert.equal(message.contractVersion,
            "LUNA_BIND_ELIGIBILITY_PROBE_V1")
          if (!capabilityResponders.has(tabId)) {
            chrome.runtime.lastError = { message: "receiving-end-does-not-exist" }
            callback()
            chrome.runtime.lastError = null
            return
          }
          const capability = capabilityResponders.get(tabId)
          if (capability === "INVALID_SCHEMA") {
            callback({ contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_V1",
              eligible: true, checkoutPageDetected: true,
              checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST",
              shipToMarker: true, shippingMarker: true,
              subtotalMarker: true, payNowMarker: true })
            return
          }
          const eligible = capability === true
          callback({ contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_V1",
            eligible, checkoutPageDetected: eligible,
            checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST",
            shipToMarker: eligible,
            shippingMarker: eligible, subtotalMarker: eligible,
            totalMarker: eligible, payNowMarker: eligible })
          return
        }
        if (message.type === "BIND_CANONICAL_DESTINATION_EXECUTE_V1") {
          assert.equal(message.contractVersion,
            "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1")
          if (bindMessageStalls) return
          if (bindingRejectReason) {
            callback({ contractVersion:
              "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
            success: false, error: bindingRejectReason })
            return
          }
          if (message.operation === "VALIDATE" && !validationMatches) {
            callback({ contractVersion:
              "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
            success: false,
            error: "CANONICAL_US_SHIPPING_PROFILE_MISMATCH" })
            return
          }
          callback({ contractVersion:
            "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1", success: true,
            fingerprint: `sha256:${"b".repeat(64)}`,
            fingerprintVersion: "LUNA_SHOP_PAY_DESTINATION_SHA256_V1",
            countryClass: "US", canonicalDestinationMatch: true,
            safeMarkerBooleans: { shipTo: true, shipping: true,
              subtotal: true, total: true, payNow: true } })
          return
        }
        callback({ accepted: true })
      },
      onRemoved: { addListener(listener) { tabRemoved = listener } },
    },
    storage: { local: {
      get(_key, callback) {
        if (storageReadFails) {
          chrome.runtime.lastError = { message: "test-only-read-failure" }
          callback({})
          chrome.runtime.lastError = null
          return
        }
        callback(storedDestination)
      },
      set(value, callback) {
        if (storageWriteFails) {
          chrome.runtime.lastError = { message: "test-only-write-failure" }
          callback()
          chrome.runtime.lastError = null
          return
        }
        storedDestination = { ...value }
        callback()
      },
    } },
    scripting: { executeScript: async (value) => {
      injected.push(value)
      return [{ frameId: 0, result: undefined }]
    } },
    webNavigation: {
      onCommitted: { addListener(listener) { navigationCommitted = listener } },
      onCompleted: { addListener(listener) { navigationCompleted = listener } },
    },
  }
  runInNewContext(acceleratedBackground, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  const port = (slot) => ({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: "https://imnova-website-z1qh-git-codex-674439-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture" },
    disconnect() {},
    postMessage(value) { progress.push(value) },
    onMessage: { addListener(listener) {
      if (slot === 1) firstPortMessage = listener
      else secondPortMessage = listener
    } },
    onDisconnect: { addListener(listener) {
      if (slot === 1) firstPortDisconnect = listener
    } },
  })
  connectListener(port(1))
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://shop.app/checkout?authorization=must-not-escape" })
  assert.equal(progress.length, 0)
  storageWriteFails = true
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT"))
  assert.equal(progress.at(-1)?.canonicalDestinationBound, false)
  assert.equal(progress.at(-1)?.error, "BIND_STORAGE_WRITE_FAILED")
  assert.equal(storedDestination.sellerOsLunaCanonicalDestinationBindingV1,
    undefined)
  storageWriteFails = false
  progress.length = 0
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const firstBinding = progress.findLast((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
  assert.equal(firstBinding?.success, true)
  assert.equal(firstBinding?.canonicalDestinationBound, true)
  assert.equal(firstBinding?.canonicalDestinationMatch, true)
  assert.equal(firstBinding?.operation, "BIND_CANONICAL_DESTINATION")
  assert.ok(tabMessages.some((entry) =>
    entry.type === "BIND_CANONICAL_DESTINATION_EXECUTE_V1" &&
    entry.operation === "BIND"))
  assert.equal(tabMessages.find((entry) =>
    entry.type === "BIND_CANONICAL_DESTINATION_EXECUTE_V1")?.tabId, 11)
  assert.ok(!tabMessages.some((entry) =>
    entry.type === "BIND_CANONICAL_DESTINATION_EXECUTE_V1" &&
    entry.operation === "VALIDATE"))
  assert.ok(tabQueries.some((query) => Object.keys(query).length === 0))
  assert.ok(tabQueries.every((query) => !("url" in query) &&
    !("active" in query) && !("currentWindow" in query)))
  const bindTraceStates = progress.filter((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT")
    .map((entry) => entry.event.state)
  assert.deepEqual(bindTraceStates, [
    "CANONICAL_BIND_REQUESTED",
    "BIND_REQUEST_ACCEPTED",
    "BIND_SHOP_APP_TAB_DISCOVERY_STARTED",
    "BIND_EXISTING_CHECKOUT_SEARCH_STARTED",
    "BIND_SHOP_APP_TAB_DISCOVERY_RESULT",
    "BIND_SHOP_APP_TAB_SELECTED",
    "BIND_EXISTING_CHECKOUT_FOUND",
    "BIND_TOP_FRAME_EXECUTION_STARTED",
    "BIND_CHECKOUT_MARKERS_VERIFIED",
    "BIND_SHIP_TO_DETECTED",
    "BIND_SHIP_TO_AVAILABLE",
    "CANONICAL_FINGERPRINT_COMPUTED",
    "CANONICAL_FINGERPRINT_WRITE_STARTED",
    "CANONICAL_FINGERPRINT_WRITE_COMPLETE",
    "CANONICAL_FINGERPRINT_READBACK_VERIFIED",
    "CANONICAL_DESTINATION_MATCH",
    "CANONICAL_BIND_COMPLETED",
    "BIND_RUNTIME_CLEARED",
    "PASS",
  ])
  const discoveryTrace = progress.find((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_SHOP_APP_TAB_DISCOVERY_RESULT")?.event
  assert.equal(discoveryTrace?.tabsQueryTotalCount, 3)
  assert.equal(discoveryTrace?.tabsEnumeratedCount, 3)
  assert.equal(discoveryTrace?.shopAppProbedCount, 3)
  assert.equal(discoveryTrace?.contentScriptResponderCount, 2)
  assert.equal(discoveryTrace?.eligibleCheckoutCount, 1)
  assert.equal(discoveryTrace?.probeAttemptCount, 3)
  assert.equal(discoveryTrace?.probeResponseCount, 2)
  assert.equal(discoveryTrace?.eligibleResponseCount, 1)
  assert.equal(discoveryTrace?.probeErrorCount, 1)
  firstPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(progress.at(-1)?.canonicalDestinationBound, true)
  storageReadFails = true
  firstPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(progress.at(-1)?.error, "BINDING_STORAGE_READ_FAILED")
  assert.equal(progress.at(-1)?.canonicalDestinationBound, undefined)
  storageReadFails = false

  // A new MV3 service-worker instance must derive BOUND from durable
  // chrome.storage.local, independently of page/canary runtime state.
  runInNewContext(acceleratedBackground, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  connectListener(port(1))
  firstPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(progress.at(-1)?.canonicalDestinationBound, true)
  assert.equal(progress.at(-1)?.canonicalDestinationMatch, false)

  validationMatches = false
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const mismatch = progress.at(-1)
  assert.equal(mismatch?.canonicalDestinationBound, true)
  assert.equal(mismatch?.canonicalDestinationMatch, false)
  assert.equal(mismatch?.error, "CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
  validationMatches = true
  storedDestination = {}
  capabilityResponders = new Map()
  const bootstrapProgressStart = progress.length
  const createdBeforeBootstrap = createdTabs.length
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
    bootstrapJob: activeJob })
  await waitForTestCondition(() => createdTabs.length > createdBeforeBootstrap)
  const entrypointTraceBeforeNavigation = progress.slice(bootstrapProgressStart)
    .filter((entry) => entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT")
    .map((entry) => entry.event.state)
  assertOrderedSubsequence(entrypointTraceBeforeNavigation, [
    "CANONICAL_BIND_REQUESTED",
    "BIND_SHOP_APP_TAB_DISCOVERY_STARTED",
    "BIND_SHOP_APP_TAB_DISCOVERY_RESULT",
    "BIND_CHECKOUT_BOOTSTRAP_REQUIRED",
    "BIND_START_JOB_INVOKED",
    "BIND_BOOTSTRAP_PRODUCT_OPENED",
  ])
  const preBootstrapTabNotFound = progress.slice(bootstrapProgressStart)
    .find((entry) => entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
      entry.event.state === "FAIL" &&
      entry.event.reasonCode === "BIND_CHECKOUT_TAB_NOT_FOUND")
  assert.equal(preBootstrapTabNotFound, undefined)
  const initialDiscovery = progress.slice(bootstrapProgressStart).find((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_SHOP_APP_TAB_DISCOVERY_RESULT")?.event
  assert.equal(initialDiscovery?.bindCheckoutDiscoveryValidCount, 0)
  const bootstrapRequired = progress.slice(bootstrapProgressStart).find((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_CHECKOUT_BOOTSTRAP_REQUIRED")?.event
  assert.equal(bootstrapRequired?.bindCheckoutBootstrapRequired, true)
  assert.equal(bootstrapRequired?.bindCheckoutBootstrapAttempted, false)
  assert.equal(bootstrapRequired?.bindStartJobInvoked, false)
  const startJobInvoked = progress.slice(bootstrapProgressStart).find((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_START_JOB_INVOKED")?.event
  assert.equal(startJobInvoked?.bindCheckoutBootstrapAttempted, true)
  assert.equal(startJobInvoked?.bindStartJobInvoked, true)
  const bootstrapProductSender = { tab: { id: 11 }, frameId: 0,
    url: createdTabs.at(-1) }
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    state: "PRODUCT_IDENTITY_VERIFIED" }, bootstrapProductSender, () => {})
  let bootstrapCartPhase = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    captureSessionId: activeJob.captureSessionId,
    phase: "AWAITING_CART_CONFIRMATION", originalCartSnapshot: [] },
  bootstrapProductSender, (value) => { bootstrapCartPhase = value })
  assert.equal(bootstrapCartPhase?.accepted, true)
  const bootstrapCartSender = { tab: { id: 11 }, frameId: 0,
    url: "https://lunaportex.com/cart" }
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    state: "CART_MUTATION_CONFIRMED", cartSubtotalUsd: 10.96 },
  bootstrapCartSender, () => {})
  let bootstrapCheckoutPhase = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    captureSessionId: activeJob.captureSessionId,
    phase: "AWAITING_CHECKOUT_SHIPPING", cartSubtotalUsd: 10.96 },
  bootstrapCartSender, (value) => { bootstrapCheckoutPhase = value })
  assert.equal(bootstrapCheckoutPhase?.accepted, true)
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://shop.app/opaque-checkout?authorization=must-not-escape" })
  navigationCompleted({ tabId: 11, frameId: 0,
    url: "https://shop.app/opaque-checkout?authorization=must-not-escape" })
  let bootstrapContext = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, frameId: 0,
      url: "https://shop.app/opaque-checkout" },
  (value) => { bootstrapContext = value })
  assert.equal(bootstrapContext?.bindingBootstrap, true)
  capabilityResponders = new Map([[11, true]])
  let bindBootstrapAck = null
  runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
    extensionBuildVersion: "1.0.39" },
  { tab: { id: 11 }, frameId: 0,
    url: "https://shop.app/opaque-checkout" },
  (value) => { bindBootstrapAck = value })
  assert.equal(bindBootstrapAck?.accepted, true)
  await waitForTestCondition(() => progress.slice(bootstrapProgressStart)
    .some((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT" &&
    entry.success === true && entry.operation === "BIND_CANONICAL_DESTINATION"))
  const bootstrapTraceStates = progress.slice(bootstrapProgressStart)
    .filter((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT")
    .map((entry) => entry.event.state)
  assertOrderedSubsequence(bootstrapTraceStates, ["CANONICAL_BIND_REQUESTED",
    "BIND_REQUEST_ACCEPTED", "BIND_EXISTING_CHECKOUT_SEARCH_STARTED",
    "BIND_SHOP_APP_TAB_DISCOVERY_RESULT",
    "BIND_CHECKOUT_BOOTSTRAP_REQUIRED", "BIND_START_JOB_INVOKED",
    "BIND_BOOTSTRAP_PRODUCT_OPENED",
    "BIND_BOOTSTRAP_PRODUCT_VERIFIED", "BIND_BOOTSTRAP_CART_CONFIRMED",
    "BIND_BOOTSTRAP_CHECKOUT_NAVIGATION_OBSERVED",
    "BIND_BOOTSTRAP_CHECKOUT_DETECTED", "BIND_SHIP_TO_DETECTED",
    "CANONICAL_FINGERPRINT_WRITE_COMPLETE",
    "CANONICAL_FINGERPRINT_READBACK_VERIFIED", "CANONICAL_BIND_COMPLETED",
    "BIND_RUNTIME_CLEARED", "PASS"])

  const bindCompletedIndex = progress.findIndex((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "CANONICAL_BIND_COMPLETED")
  const bindClearedIndex = progress.findIndex((entry, entryIndex) =>
    entryIndex > bindCompletedIndex &&
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_RUNTIME_CLEARED")
  const bindAckIndex = progress.findIndex((entry, entryIndex) =>
    entryIndex > bindClearedIndex &&
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT" &&
    entry.success === true)
  assert.ok(bindCompletedIndex >= 0)
  assert.ok(bindClearedIndex > bindCompletedIndex)
  assert.ok(bindAckIndex > bindClearedIndex)
  const bindTrace = progress[bindClearedIndex]?.event
  assert.equal(bindTrace?.candidateId, null)

  const handoffJob = (sequence) => ({ ...activeJob,
    captureSessionId:
      `1000000${sequence}-0000-4000-8000-00000000000${sequence}`,
    nonce: `172452240100${sequence}.${String(sequence).repeat(43)}`,
    identity: { ...activeJob.identity,
      candidateId: `sha256:${String(sequence).repeat(64)}`,
      canonicalProductUrl:
        `https://www.lunaportex.com/products/bind-handoff-product-${sequence}`,
      lunaProductId: `922083249389${sequence}`,
      lunaVariantId: `4880964354170${sequence}`,
      supplierSku: `BIND-HANDOFF-${sequence}` },
    productName: `Bind handoff product ${sequence}`,
  })
  const runHandoffProductionJob = async (sequence, productTabId,
    checkoutTabId) => {
    const productionJob = handoffJob(sequence)
    const progressStart = progress.length
    firstPortMessage({ type: "START_SHIPPING_JOB", job: productionJob,
      productionAutoClaim: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const productSender = { tab: { id: productTabId }, frameId: 0,
      url: productionJob.identity.canonicalProductUrl }
    let cartPhase = null
    runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
      phase: "AWAITING_CART_CONFIRMATION",
      captureSessionId: productionJob.captureSessionId,
      originalCartSnapshot: [] }, productSender,
    (value) => { cartPhase = value })
    assert.equal(cartPhase?.accepted, true)
    const cartSender = { tab: { id: productTabId }, frameId: 0,
      url: "https://www.lunaportex.com/cart" }
    let checkoutPhase = null
    runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
      phase: "AWAITING_CHECKOUT_SHIPPING",
      captureSessionId: productionJob.captureSessionId,
      cartSubtotalUsd: 12.34 }, cartSender,
    (value) => { checkoutPhase = value })
    assert.equal(checkoutPhase?.accepted, true)
    const checkoutSender = { tab: { id: checkoutTabId }, frameId: 0,
      url: `https://shop.app/pay/bind-handoff-${sequence}` }
    let ack = null
    runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
      extensionBuildVersion: "1.0.39" }, checkoutSender,
    (value) => { ack = value })
    assert.equal(ack?.accepted, true)
    let recovered = null
    runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
      checkoutSender, (value) => { recovered = value })
    assert.equal(recovered?.job?.captureSessionId,
      productionJob.captureSessionId)
    runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
      state: "ACTIVE_JOB_RECOVERED_ON_CHECKOUT",
      captureSessionId: productionJob.captureSessionId,
      candidateId: productionJob.identity.candidateId,
      checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
    checkoutSender, () => {})
    runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
      state: "CHECKOUT_PAGE_DETECTED",
      captureSessionId: productionJob.captureSessionId,
      candidateId: productionJob.identity.candidateId,
      checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
    checkoutSender, () => {})
    firstPortMessage({ type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
      candidateId: productionJob.identity.candidateId, success: true,
      subtotalUsd: 12.34, shippingUsd: 6.99, totalUsd: 19.33 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const states = progress.slice(progressStart)
      .filter((entry) => entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT")
      .map((entry) => entry.event.state)
    assertOrderedSubsequence(states, ["PRODUCTION_OBSERVER_REARMED",
      "PRODUCTION_WORKER_READY", "INITIAL_AUTO_CLAIM_STARTED",
      "PRODUCTION_JOB_CLAIMED", "CHECKOUT_NAVIGATION_OBSERVED",
      "ACTIVE_JOB_RECOVERED_ON_CHECKOUT", "CHECKOUT_PAGE_CLASSIFIED",
      "CAPTURE_POST", "DURABLE_READBACK", "ECONOMICS_EVALUATED", "PASS"])
    const navigation = progress.slice(progressStart).find((entry) =>
      entry.type === "LUNA_SHIPPING_JOB_PROGRESS" &&
      entry.state === "CHECKOUT_NAVIGATION_OBSERVED")
    assert.equal(navigation?.checkoutNavigationOrigin, "https://shop.app")
    assert.equal(navigation?.checkoutHostPermissionMatch, true)
    assert.ok(!progress.slice(progressStart).some((entry) => entry.error ===
      "REAL_CHECKOUT_HOST_NOT_ALLOWLISTED"))
    return { productionJob, checkoutTabId }
  }
  const firstProduction = await runHandoffProductionJob(5, 11, 21)
  const secondProduction = await runHandoffProductionJob(6,
    firstProduction.checkoutTabId, 22)
  assert.notEqual(firstProduction.productionJob.identity.candidateId,
    activeJob.identity.candidateId)
  assert.notEqual(secondProduction.productionJob.identity.candidateId,
    activeJob.identity.candidateId)
  tabRemoved(22)
  enumeratedTabs = [{ id: 11, active: false, windowId: 2 }]
  capabilityResponders = new Map([[11, "INVALID_SCHEMA"]])
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(progress.at(-1)?.error, "BIND_BOOTSTRAP_JOB_INVALID")
  const schemaMismatchTrace = progress.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT" &&
    entry.event.state === "BIND_SHOP_APP_TAB_DISCOVERY_RESULT")?.event
  assert.equal(schemaMismatchTrace?.probeAttemptCount, 1)
  assert.equal(schemaMismatchTrace?.probeResponseCount, 1)
  assert.equal(schemaMismatchTrace?.contentScriptResponderCount, 0)
  assert.equal(schemaMismatchTrace?.eligibleResponseCount, 0)
  assert.equal(schemaMismatchTrace?.probeErrorCount, 1)
  capabilityResponders = new Map()
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
    bootstrapJob: activeJob })
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT" &&
    entry.error === "BIND_CHECKOUT_BOOTSTRAP_TIMEOUT"))
  assert.equal(progress.findLast((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")?.error,
  "BIND_CHECKOUT_BOOTSTRAP_TIMEOUT")
  capabilityResponders = new Map([[11, true]])
  bindMessageStalls = true
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT" &&
    entry.error === "BIND_CONTENT_SCRIPT_NOT_RESPONDING"))
  const bindTimeout = progress.findLast((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
  assert.equal(bindTimeout?.error, "BIND_CONTENT_SCRIPT_NOT_RESPONDING")
  assert.equal(progress.filter((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT").at(-1)?.event.state,
  "FAIL")
  bindMessageStalls = false
  enumeratedTabs = [{ id: 99, active: true, windowId: 1 },
    { id: 11, active: false, windowId: 2 },
    { id: 12, active: false, windowId: 3 }]
  capabilityResponders = new Map([[11, true], [12, true]])
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(progress.at(-1)?.error,
    "MULTIPLE_BIND_CHECKOUT_TABS_FOUND")
  enumeratedTabs = [{ id: 99, active: true, windowId: 1 },
    { id: 11, active: false, windowId: 2 },
    { id: 13, active: false, windowId: 1 }]
  capabilityResponders = new Map([[11, true], [13, false]])
  storedDestination = {}
  bindingRejectReason = "BIND_SHIP_TO_NOT_FOUND"
  firstPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(progress.at(-1)?.error, "BIND_SHIP_TO_NOT_FOUND")
  bindingRejectReason = null
  progress.length = 0
  firstPortMessage({ type: "START_SHIPPING_JOB", job: activeJob })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const productSender = { tab: { id: 11 }, url: createdTabs.at(-1) }
  let productPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    productSender, (value) => { productPull = value })
  assert.equal(productPull?.accepted, true)
  let prematureCartPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, url: "https://www.lunaportex.com/cart" },
    (value) => { prematureCartPull = value })
  assert.equal(prematureCartPull?.accepted, false)
  let phaseResponse = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CART_CONFIRMATION",
    captureSessionId: activeJob.captureSessionId,
    originalCartSnapshot: [] }, productSender,
  (value) => { phaseResponse = value })
  assert.equal(phaseResponse?.accepted, true)
  firstPortDisconnect()
  connectListener(port(2))
  secondPortMessage({ type: "RESUME_ACTIVE_LUNA_SHIPPING_JOB", job: activeJob,
    phase: "AWAITING_CART_CONFIRMATION" })
  let cartPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, url: "https://www.lunaportex.com/cart" },
    (value) => { cartPull = value })
  assert.equal(cartPull?.accepted, true)
  assert.equal(cartPull?.phase, "AWAITING_CART_CONFIRMATION")
  assert.equal(cartPull?.job?.captureSessionId, activeJob.captureSessionId)
  assert.deepEqual(cartPull?.originalCartSnapshot, [])
  assert.ok(progress.some((entry) => entry.state === "BRIDGE_RECONNECTED"))
  let checkoutPhase = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CHECKOUT_SHIPPING",
    captureSessionId: activeJob.captureSessionId, cartSubtotalUsd: 10.96 },
  { tab: { id: 11 }, url: "https://www.lunaportex.com/cart" },
  (value) => { checkoutPhase = value })
  assert.equal(checkoutPhase?.accepted, true)
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://shop.app/opaque-checkout?authorization=must-not-escape" })
  let wrongFrameAck = null
  runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
    extensionBuildVersion: "1.0.39" },
    { tab: { id: 11 }, frameId: 1,
      url: "https://shop.app/pay/opaque-checkout" },
  (value) => { wrongFrameAck = value })
  assert.equal(wrongFrameAck?.accepted, false)
  assert.equal(wrongFrameAck?.error, "WRONG_FRAME_TARGET")
  let bootstrapAck = null
  runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
    extensionBuildVersion: "1.0.39" },
    { tab: { id: 11 }, frameId: 0,
      url: "https://shop.app/pay/opaque-checkout" },
  (value) => { bootstrapAck = value })
  assert.equal(bootstrapAck?.accepted, true)
  navigationCompleted({ tabId: 11, frameId: 0,
    url: "https://shop.app/opaque-checkout?authorization=must-not-escape" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_NAVIGATION_OBSERVED" &&
    entry.checkoutNavigationHost === "shop.app" &&
    entry.checkoutNavigationOrigin === "https://shop.app"))
  assert.doesNotMatch(JSON.stringify(progress), /must-not-escape|authorization/)
  assert.ok(progress.some((entry) => entry.state === "CHECKOUT_HOST_ALLOWED"))
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_INJECTION_REQUESTED" &&
    entry.checkoutInjectionFrameId === 0))
  assert.ok(!progress.some((entry) =>
    entry.state === "CHECKOUT_INJECTION_API_SUCCEEDED"))
  assert.ok(!progress.some((entry) =>
    entry.state === "CHECKOUT_SCRIPT_INJECTED"))
  assert.equal(injected.length, 0)
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_SCRIPT_BOOTSTRAP_ACK" &&
    entry.checkoutScriptBootstrapAck === true))
  assert.equal(progress.filter((entry) =>
    entry.state === "CHECKOUT_SCRIPT_BOOTSTRAP_ACK").length, 1)
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_CONTENT_SCRIPT_LOADED" &&
    entry.checkoutScriptBootstrapAck === true))
  let checkoutPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 },
      url: "https://www.lunaportex.com/checkouts/cn/example" },
  (value) => { checkoutPull = value })
  assert.equal(checkoutPull?.accepted, true)
  assert.ok(progress.some((entry) => entry.state === "ACTIVE_JOB_REQUESTED"))
  assert.equal(checkoutPull?.phase, "AWAITING_CHECKOUT_SHIPPING")
  assert.equal(checkoutPull?.cartSubtotalUsd, 10.96)
  const checkoutSender = { tab: { id: 11 }, frameId: 0,
    url: "https://shop.app/pay/opaque-checkout" }
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "CHECKOUT_CLASSIFIER_STARTED",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
  checkoutSender, () => {})
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "CHECKOUT_HOST_CLASSIFIED",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
  checkoutSender, () => {})
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "SHOP_PAY_DOM_WAITING",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST",
    shopPayMarkerOrderSummary: true, shopPayMarkerProduct: true,
    shopPayMarkerQuantity: true, shopPayMarkerShipTo: true,
    shopPayMarkerShipping: true, shopPayMarkerSubtotal: true,
    shopPayMarkerShippingAmount: true, shopPayMarkerTotal: true,
    shopPayMarkerShippingMethod: true,
    shopPayMarkerPayment: true, shopPayMarkerPayNow: true },
  checkoutSender, () => {})
  const waitingIndex = progress.findLastIndex((entry) =>
    entry.state === "SHOP_PAY_DOM_WAITING")
  assert.ok(waitingIndex >= 0)
  assert.equal(progress[waitingIndex].shopPayMarkerShippingAmount, true)
  assert.equal(progress[waitingIndex].shopPayMarkerShippingMethod, true)
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "CHECKOUT_HOST_CLASSIFIED",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
  checkoutSender, () => {})
  assert.equal(progress.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_PROGRESS")?.state,
  "SHOP_PAY_DOM_WAITING")
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "NORMAL_CHECKOUT_WITH_SHIPPING",
    captureSessionId: activeJob.captureSessionId,
    candidateId: activeJob.identity.candidateId,
    checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST",
    checkoutPageClassification: "NORMAL_CHECKOUT_WITH_SHIPPING" },
  checkoutSender, () => {})
  let shopPayPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, url: "https://shop.app/pay/opaque-checkout" },
  (value) => { shopPayPull = value })
  assert.equal(shopPayPull?.accepted, true)
  secondPortMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const bindingResult = progress.findLast((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
  assert.equal(bindingResult?.success, true)
  assert.equal(bindingResult?.canonicalDestinationBound, true)
  assert.equal(bindingResult?.canonicalDestinationMatch, true)
  const storedBinding = storedDestination
    .sellerOsLunaCanonicalDestinationBindingV1
  assert.deepEqual(Object.keys(storedBinding).sort(), [
    "boundAt", "canonicalDestinationFingerprint", "countryClass",
    "fingerprintVersion",
  ])
  assert.match(storedBinding.boundAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.doesNotMatch(JSON.stringify(storedDestination),
    /name|street|city|postal|email|phone/i)
  assert.ok(!tabMessages.some((entry) =>
    entry.type === "RESUME_LUNA_SHIPPING_AFTER_DESTINATION_BINDING"))
  let postBindingJob = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    checkoutSender, (value) => { postBindingJob = value })
  assert.equal(postBindingJob?.job?.captureSessionId,
    activeJob.captureSessionId)
  assert.equal(postBindingJob?.phase, "AWAITING_CHECKOUT_SHIPPING")
  let storedBindingRead = null
  assert.equal(runtimeMessageListener({
    type: "GET_LUNA_CANONICAL_DESTINATION_BINDING",
    captureSessionId: activeJob.captureSessionId,
  }, checkoutSender, (value) => { storedBindingRead = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(storedBindingRead?.accepted, true)
  assert.equal(storedBindingRead?.binding?.canonicalDestinationFingerprint,
    `sha256:${"b".repeat(64)}`)
  let unrelatedShopPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, url: "https://shop.app/orders" },
  (value) => { unrelatedShopPull = value })
  assert.equal(unrelatedShopPull?.accepted, true)
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://unrelated.example/checkout" })
  assert.equal(progress.at(-1)?.error, "REAL_CHECKOUT_HOST_NOT_ALLOWLISTED")

  secondPortMessage({ type: "START_SHIPPING_JOB", job: activeJob })
  await new Promise((resolve) => setTimeout(resolve, 0))
  let secondCartPhase = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CART_CONFIRMATION",
    captureSessionId: activeJob.captureSessionId,
    originalCartSnapshot: [] }, productSender,
  (value) => { secondCartPhase = value })
  assert.equal(secondCartPhase?.accepted, true)
  let secondCheckoutPhase = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CHECKOUT_SHIPPING",
    captureSessionId: activeJob.captureSessionId, cartSubtotalUsd: 10.96 },
  { tab: { id: 11 }, url: "https://www.lunaportex.com/cart" },
  (value) => { secondCheckoutPhase = value })
  assert.equal(secondCheckoutPhase?.accepted, true)
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://shop.app/pay/second-checkout" })
  navigationCompleted({ tabId: 11, frameId: 0,
    url: "https://shop.app/pay/second-checkout" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_INJECTION_REQUESTED"))
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_RESULT" && entry.error ===
      "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED"))
  const bootstrapFailure = progress.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_RESULT")
  assert.equal(bootstrapFailure?.error,
    "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED")
  assert.equal(bootstrapFailure?.lastRuntimeState,
    "CHECKOUT_INJECTION_REQUESTED")

  // The real external production command must rearm checkout observation for
  // each AUTO_NEXT job. A static checkout script may ACK on a newly opened tab
  // before webNavigation.onCompleted; that ACK is bounded to the active job and
  // becomes the missing navigation authority instead of inheriting job #1.
  const sequentialJob = (sequence) => ({ ...activeJob,
    captureSessionId:
      `0000000${sequence}-0000-4000-8000-00000000000${sequence}`,
    nonce: `172452240000${sequence}.${String(sequence).repeat(43)}`,
    identity: { ...activeJob.identity,
      candidateId: `sha256:${String(sequence).repeat(64)}`,
      canonicalProductUrl:
        `https://www.lunaportex.com/products/auto-next-product-${sequence}`,
      lunaProductId: `922083249379${sequence}`,
      lunaVariantId: `4880964354070${sequence}`,
      supplierSku: `AUTO-NEXT-${sequence}` },
    productName: `Auto next product ${sequence}`,
  })
  const runSequentialCheckout = async (sequence, productTabId, checkoutTabId) => {
    const nextJob = sequentialJob(sequence)
    const progressStart = progress.length
    secondPortMessage({ type: "START_SHIPPING_JOB", job: nextJob,
      productionAutoClaim: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const nextProductSender = { tab: { id: productTabId }, frameId: 0,
      url: nextJob.identity.canonicalProductUrl }
    let cartPhase = null
    runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
      phase: "AWAITING_CART_CONFIRMATION",
      captureSessionId: nextJob.captureSessionId,
      originalCartSnapshot: [] }, nextProductSender,
    (value) => { cartPhase = value })
    assert.equal(cartPhase?.accepted, true)
    const nextCartSender = { tab: { id: productTabId }, frameId: 0,
      url: "https://www.lunaportex.com/cart" }
    runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
      state: "CART_MUTATION_CONFIRMED",
      captureSessionId: nextJob.captureSessionId,
      candidateId: nextJob.identity.candidateId, cartSubtotalUsd: 6 },
    nextCartSender, () => {})
    let checkoutPhase = null
    runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
      phase: "AWAITING_CHECKOUT_SHIPPING",
      captureSessionId: nextJob.captureSessionId, cartSubtotalUsd: 6 },
    nextCartSender, (value) => { checkoutPhase = value })
    assert.equal(checkoutPhase?.accepted, true)
    const nextCheckoutSender = { tab: { id: checkoutTabId }, frameId: 0,
      url: `https://shop.app/pay/auto-next-${sequence}` }
    let ack = null
    runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
      extensionBuildVersion: "1.0.39" }, nextCheckoutSender,
    (value) => { ack = value })
    assert.equal(ack?.accepted, true)
    let checkoutPull = null
    runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
      nextCheckoutSender, (value) => { checkoutPull = value })
    assert.equal(checkoutPull?.accepted, true)
    assert.equal(checkoutPull?.job?.captureSessionId, nextJob.captureSessionId)
    runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
      state: "ACTIVE_JOB_RECOVERED_ON_CHECKOUT",
      captureSessionId: nextJob.captureSessionId,
      candidateId: nextJob.identity.candidateId,
      checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
    nextCheckoutSender, () => {})
    runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
      state: "CHECKOUT_PAGE_DETECTED",
      captureSessionId: nextJob.captureSessionId,
      candidateId: nextJob.identity.candidateId,
      checkoutHostClassification: "SHOP_PAY_CHECKOUT_HOST" },
    nextCheckoutSender, () => {})
    const nextProgress = progress.slice(progressStart)
    const navigation = nextProgress.find((entry) =>
      entry.type === "LUNA_SHIPPING_JOB_PROGRESS" &&
      entry.state === "CHECKOUT_NAVIGATION_OBSERVED")
    assert.equal(navigation?.checkoutNavigationOrigin, "https://shop.app")
    assert.equal(navigation?.checkoutHostPermissionMatch, true)
    assert.ok(nextProgress.some((entry) =>
      entry.state === "CHECKOUT_CONTENT_SCRIPT_LOADED"))
    assert.ok(nextProgress.some((entry) =>
      entry.state === "ACTIVE_JOB_RECOVERED_ON_CHECKOUT"))
    assert.ok(nextProgress.some((entry) =>
      entry.state === "CHECKOUT_PAGE_DETECTED"))
    assert.ok(!nextProgress.some((entry) => entry.error ===
      "REAL_CHECKOUT_HOST_NOT_ALLOWLISTED"))
    secondPortMessage({ type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
      candidateId: nextJob.identity.candidateId, success: true,
      subtotalUsd: 6, shippingUsd: 6.99, totalUsd: 12.99 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { nextJob, checkoutTabId }
  }
  const sequentialOne = await runSequentialCheckout(2, 11, 22)
  const sequentialTwo = await runSequentialCheckout(3,
    sequentialOne.checkoutTabId, 33)
  assert.equal(sequentialTwo.nextJob.productName, "Auto next product 3")

  const unobservedJob = sequentialJob(4)
  secondPortMessage({ type: "START_SHIPPING_JOB", job: unobservedJob,
    productionAutoClaim: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  let unobservedCart = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CART_CONFIRMATION",
    captureSessionId: unobservedJob.captureSessionId,
    originalCartSnapshot: [] },
  { tab: { id: 33 }, frameId: 0,
    url: unobservedJob.identity.canonicalProductUrl },
  (value) => { unobservedCart = value })
  assert.equal(unobservedCart?.accepted, true)
  let unobservedCheckout = null
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CHECKOUT_SHIPPING",
    captureSessionId: unobservedJob.captureSessionId, cartSubtotalUsd: 6 },
  { tab: { id: 33 }, frameId: 0,
    url: "https://www.lunaportex.com/cart" },
  (value) => { unobservedCheckout = value })
  assert.equal(unobservedCheckout?.accepted, true)
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_RESULT" && entry.error ===
      "CHECKOUT_NAVIGATION_NOT_OBSERVED"))
  assert.ok(!progress.some((entry) => entry.type ===
    "LUNA_SHIPPING_JOB_RESULT" && entry.capture?.candidateId ===
      unobservedJob.identity.candidateId && entry.error ===
      "REAL_CHECKOUT_HOST_NOT_ALLOWLISTED"))

  // A fresh service-worker context has no canary memory, but must recover the
  // durable canonical configuration through a newly connected Seller OS page.
  runInNewContext(acceleratedBackground, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  let restartedPortMessage = null
  connectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: "https://imnova-website-z1qh-git-codex-674439-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture" },
    disconnect() {}, postMessage(value) { progress.push(value) },
    onMessage: { addListener(listener) { restartedPortMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  restartedPortMessage({
    type: "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS",
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(progress.at(-1)?.type,
    "LUNA_CANONICAL_DESTINATION_STATUS")
  assert.equal(progress.at(-1)?.canonicalDestinationBound, true)
  assert.equal(progress.at(-1)?.canonicalDestinationMatch, false)

  // A callback that never completes cannot leave the bind trace at only
  // CANONICAL_BIND_REQUESTED; it terminates with the exact stalled transition.
  storedDestination = {}
  shopTabQueryStalls = true
  restartedPortMessage({
    type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
  })
  await waitForTestCondition(() => progress.some((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT" &&
    entry.error === "BIND_TIMEOUT:BIND_SHOP_APP_TAB_DISCOVERY_STARTED"))
  const timeoutResult = progress.findLast((entry) =>
    entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
  assert.equal(timeoutResult?.success, false)
  assert.equal(timeoutResult?.error,
    "BIND_TIMEOUT:BIND_SHOP_APP_TAB_DISCOVERY_STARTED")
  const timeoutTrace = progress.filter((entry) =>
    entry.type === "LUNA_SHIPPING_RUNTIME_TRACE_EVENT")
  assert.ok(timeoutTrace.some((entry) =>
    entry.event.state === "BIND_SHOP_APP_TAB_DISCOVERY_STARTED"))
  assert.equal(timeoutTrace.at(-1)?.event.state, "FAIL")
  assert.doesNotMatch(JSON.stringify(progress),
    /opaque-checkout|authorization=|street|postal|email|phone/i)
  shopTabQueryStalls = false
})

test("cart document is authoritative for exact identity, quantity and visible subtotal", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const link = { getAttribute: () => "/products/exact-microcurrent-device" }
  const variant = {}
  const quantity = { value: "1", getAttribute: () => null }
  const row = {
    textContent: "$10.96 USD",
    querySelectorAll: () => [link],
    querySelector: (selector) => selector.includes("data-quantity-variant-id")
      ? variant : quantity,
  }
  const context = {
    URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal, Event, crypto,
    setInterval, clearInterval, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    location: { hostname: "www.lunaportex.com", pathname: "/",
      origin: "https://www.lunaportex.com", assign() {} },
    document: { readyState: "complete", body: {},
      querySelector: () => null, querySelectorAll: () => [row],
      documentElement: { append() {} } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    chrome: { runtime: { sendMessage() {} } },
    fetch: async () => ({ ok: true, status: 200, type: "basic",
      headers: { get: () => null }, text: async () => JSON.stringify({ items: [] }) }),
  }
  runInNewContext(content, context)
  const cart = { items: [{ product_id: job().identity.lunaProductId,
    variant_id: job().identity.lunaVariantId, sku: job().identity.supplierSku,
    quantity: 1, final_line_price: 1096 }] }
  assert.equal(context.exactCartEvidence(cart, job()).subtotalUsd, 10.96)
  assert.equal((await context.visibleCartEvidence(job(), 10.96)).subtotalUsd,
    10.96)
  assert.throws(() => context.exactCartEvidence({ items: [{ ...cart.items[0],
    product_id: "9220832493793" }] }, job()),
  /LUNA_CART_EXPECTED_PRODUCT_NOT_FOUND/)
  assert.throws(() => context.exactCartEvidence({ items: [{ ...cart.items[0],
    quantity: 2 }] }, job()), /LUNA_CART_EXPECTED_QUANTITY_NOT_FOUND/)
})

test("checkout distinguishes guest flow from explicit auth and captures a safe quote", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const visible = (overrides = {}) => ({
    textContent: "", value: "", required: false, checked: true, type: "text",
    getAttribute: () => null, getBoundingClientRect: () => ({ width: 120,
      height: 30 }), dispatchEvent() {}, click() {}, closest() { return this },
    ...overrides,
  })
  let selectors = () => []
  const runtimeMessages = []
  let contentRuntimeListener = null
  let destinationBinding = null
  const activeCheckoutJob = { ...job(), nonce: `${NOW}.${"a".repeat(43)}` }
  const context = {
    URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal, Event, crypto,
    setInterval, clearInterval, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    location: { hostname: "www.lunaportex.com", pathname: "/",
      origin: "https://www.lunaportex.com", assign() {} },
    document: { readyState: "complete", body: {}, querySelector: () => null,
      querySelectorAll: (selector) => selectors(selector),
      documentElement: { append() {} } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    chrome: { runtime: {
      onMessage: { addListener(listener) { contentRuntimeListener = listener } },
      sendMessage(message, callback) {
        runtimeMessages.push(message)
        if (message.type === "GET_ACTIVE_LUNA_SHIPPING_JOB") {
          callback?.({ accepted: true, job: activeCheckoutJob,
            phase: "AWAITING_CHECKOUT_SHIPPING",
            originalCartSnapshot: [], cartSubtotalUsd: 10.96 })
          return
        }
        if (message.type === "GET_LUNA_CANONICAL_DESTINATION_BINDING") {
          callback?.(destinationBinding ? { accepted: true,
            binding: destinationBinding } : { accepted: false })
          return
        }
        callback?.({ accepted: false })
      },
    } },
    fetch: async () => ({ ok: true, status: 200, type: "basic",
      headers: { get: () => null }, text: async () => JSON.stringify({ items: [] }) }),
  }
  runInNewContext(content, context)
  context.location.pathname = "/checkouts/cn/example"
  const email = visible({ value: "operator@example.invalid" })
  const optionalShopPay = visible({ textContent: "Sign in with Shop Pay" })
  selectors = (selector) => selector === 'input[type="email"]' ? [email]
    : selector.includes("button") ? [optionalShopPay] : []
  assert.equal(context.checkoutPageClassification(),
    "NORMAL_CHECKOUT_WITH_CONTACT_FORM")

  const shippingField = visible({ value: "saved" })
  selectors = (selector) => selector.includes('input[name*="shipping"')
    ? [shippingField] : []
  assert.equal(context.checkoutPageClassification(),
    "NORMAL_CHECKOUT_WITH_SHIPPING_FORM")

  const challenge = visible({ textContent: "Verify you are human" })
  selectors = (selector) => selector.includes("data-cf-challenge")
    ? [challenge] : []
  assert.equal(context.checkoutPageClassification(), "EXPLICIT_AUTH_CHALLENGE")
  await assert.rejects(() => context.checkoutShipping(job(), 10.96),
    /LUNA_AUTH_CHALLENGE_REQUIRED/)

  context.location.hostname = "account.lunaportex.com"
  context.location.pathname = "/auth/code"
  selectors = () => []
  assert.equal(context.checkoutPageClassification(), "EXPLICIT_LOGIN_PAGE")
  await assert.rejects(() => context.checkoutShipping(job(), 10.96),
    /LUNA_SESSION_EXPIRED/)

  context.location.hostname = "www.lunaportex.com"
  context.location.pathname = "/checkouts/cn/example"
  const shippingOption = visible({ type: "radio", checked: true,
    textContent: "$4.25 USD" })
  const subtotal = visible({ textContent: "$10.96 USD" })
  const total = visible({ textContent: "$15.21 USD" })
  selectors = (selector) => selector === "[data-shipping-method]"
    ? [shippingOption]
    : selector === "[data-checkout-subtotal]" ? [subtotal]
      : selector === "[data-checkout-total]" ? [total] : []
  assert.equal(context.checkoutPageClassification(), "NORMAL_GUEST_CHECKOUT")
  const quote = await context.checkoutShipping(job(), 10.96)
  assert.equal(quote.shippingUsd, 4.25)
  assert.equal(quote.totalUsd, 15.21)

  selectors = (selector) => selector === 'input[type="email"]' ? [email] : []
  await assert.rejects(() => context.checkoutShipping(job(), 10.96),
    /CANONICAL_US_SHIPPING_PROFILE_UNAVAILABLE/)
  let paymentClicked = false
  const payment = visible({ textContent: "Place Order",
    click() { paymentClicked = true } })
  selectors = (selector) => selector.includes("button") ? [payment] : []
  assert.equal(context.continueToShippingControl(), null)
  assert.equal(context.visibleCheckoutControl(), null)
  assert.equal(paymentClicked, false)

  context.location.hostname = "shop.app"
  context.location.pathname = "/pay/opaque-checkout"
  const shopLine = visible({
    textContent: `${job().productName} Qty 1`,
    getAttribute: () => null,
  })
  const shopSubtotal = visible({ textContent: "Subtotal $10.96 USD" })
  const shopShipping = visible({ textContent: "Shipping $6.99 USD" })
  const shopTotal = visible({ textContent: "Total $17.95 USD" })
  const shopSummary = visible({
    textContent: "Subtotal $10.96 USD Shipping $6.99 USD Total $17.95 USD",
    children: [shopSubtotal, shopShipping, shopTotal],
    matches: (selector) => selector.includes("data-order-summary"),
  })
  for (const row of shopSummary.children) row.parentElement = shopSummary
  const shopShipTo = visible({
    textContent: "Ship to Private Recipient 123 Private Street FL 33487",
    getAttribute: () => null,
  })
  const shopShippingSection = visible({ textContent: "Shipping Standard",
    getAttribute: () => null })
  const shopPayment = visible({ textContent: "Payment",
    getAttribute: () => null })
  const payNow = visible({ textContent: "Pay Now",
    click() { paymentClicked = true } })
  let payNowAvailable = true
  const shopSelectors = (selector) => selector.includes(
    '[data-testid*="line-item"')
    ? [shopLine]
    : selector.startsWith("h1,h2,h3")
      ? [shopShipTo, shopShippingSection, shopPayment,
        shopSubtotal, shopShipping, shopTotal,
        ...(payNowAvailable ? [payNow] : [])]
      : selector.includes("data-order-summary") ||
          selector.startsWith("dt,th") || selector.startsWith("dt,dd,th")
        ? [shopSummary, shopSubtotal, shopShipping, shopTotal]
        : selector.startsWith("[data-shipping-address]") ? [shopShipTo]
          : selector.startsWith("[data-shipping-method]")
            ? [shopShippingSection]
            : selector.includes("button") && payNowAvailable ? [payNow] : []
  selectors = shopSelectors
  let bindingResponse = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "BIND",
  }, {},
  (value) => { bindingResponse = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(bindingResponse?.success, true)
  assert.equal(bindingResponse?.contractVersion,
    "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1")
  assert.match(bindingResponse?.fingerprint ?? "",
    /^sha256:[0-9a-f]{64}$/)
  assert.equal(bindingResponse?.fingerprintVersion,
    "LUNA_SHOP_PAY_DESTINATION_SHA256_V1")
  assert.equal(bindingResponse?.countryClass, "US")
  assert.ok(["shipTo", "shipping", "subtotal", "total", "payNow"]
    .every((field) => bindingResponse?.safeMarkerBooleans?.[field] === true))
  assert.doesNotMatch(JSON.stringify(bindingResponse),
    /Private Recipient|Private Street|33487/)
  destinationBinding = {
    fingerprintVersion: bindingResponse.fingerprintVersion,
    canonicalDestinationFingerprint: bindingResponse.fingerprint,
    countryClass: bindingResponse.countryClass,
  }
  let validationResponse = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "VALIDATE",
    binding: destinationBinding,
  }, {}, (value) => { validationResponse = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(validationResponse?.success, true)
  assert.equal(validationResponse?.canonicalDestinationMatch, true)
  assert.equal(await context.canonicalDestinationFingerprintMatch(
    activeCheckoutJob, destinationBinding), true)
  const otherShipTo = visible({
    textContent: "Ship to Other Destination 999 Other Street United States FL 33487",
    getAttribute: () => null,
  })
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [otherShipTo] : selector.startsWith("h1,h2,h3")
      ? [otherShipTo, shopShippingSection, shopPayment, shopSubtotal,
        shopShipping, shopTotal, ...(payNowAvailable ? [payNow] : [])]
      : shopSelectors(selector)
  let mismatchResponse = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "VALIDATE",
    binding: destinationBinding,
  }, {}, (value) => { mismatchResponse = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(mismatchResponse?.success, false)
  assert.equal(mismatchResponse?.error,
    "CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
  assert.equal(await context.canonicalDestinationFingerprintMatch(
    activeCheckoutJob, destinationBinding), false)
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [] : selector.startsWith("h1,h2,h3")
      ? [shopShippingSection, shopPayment, shopSubtotal, shopShipping,
        shopTotal, ...(payNowAvailable ? [payNow] : [])]
      : shopSelectors(selector)
  let missingShipToProbe = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "BIND",
  }, {}, (value) => { missingShipToProbe = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(missingShipToProbe?.success, false)
  assert.equal(missingShipToProbe?.error, "BIND_SHIP_TO_NOT_FOUND")
  payNowAvailable = true
  selectors = shopSelectors
  let eligibilityResponse = null
  assert.equal(contentRuntimeListener({
    type: "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1",
    contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_V1",
  }, {}, (value) => { eligibilityResponse = value }), true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(Object.keys(eligibilityResponse).sort(), [
    "checkoutHostClassification", "checkoutPageDetected", "contractVersion",
    "eligible", "payNowMarker", "shipToMarker", "shippingMarker",
    "subtotalMarker", "totalMarker",
  ])
  assert.equal(eligibilityResponse.contractVersion,
    "LUNA_BIND_ELIGIBILITY_PROBE_V1")
  assert.equal(eligibilityResponse.checkoutHostClassification,
    "SHOP_PAY_CHECKOUT_HOST")
  for (const field of ["eligible", "checkoutPageDetected", "payNowMarker",
    "shipToMarker", "shippingMarker", "subtotalMarker", "totalMarker"]) {
    assert.equal(eligibilityResponse[field], true)
  }
  assert.doesNotMatch(JSON.stringify(eligibilityResponse),
    /Private Recipient|Private Street|33487|email|phone|authorization/i)
  assert.equal(context.checkoutHostClassification(), "SHOP_PAY_CHECKOUT_HOST")
  assert.equal(context.checkoutHostPermissionMatch(), true)
  assert.equal(context.checkoutPageClassification(),
    "NORMAL_CHECKOUT_WITH_SHIPPING")
  assert.equal(await context.shopPayCanonicalShippingProfile(job()), true)
  const markers = context.shopPayMarkerSnapshot()
  assert.equal(markers.shopPayMarkerProduct, false)
  assert.equal(markers.shopPayMarkerQuantity, false)
  assert.equal(markers.shopPayMarkerSubtotal, true)
  assert.equal(markers.shopPayMarkerShippingAmount, true)
  assert.equal(markers.shopPayMarkerTotal, true)
  assert.equal(markers.shopPayMarkerPayNow, true)
  runtimeMessages.length = 0
  const shopQuote = await context.checkoutShipping(job(), 10.96)
  assert.equal(shopQuote.subtotalUsd, 10.96)
  assert.equal(shopQuote.shippingUsd, 6.99)
  assert.equal(shopQuote.totalUsd, 17.95)
  assert.equal(shopQuote.shippingMethod, "Shipping Standard")
  assert.deepEqual([...context.moneyValues("Total USD $17.95")], [17.95])
  assert.deepEqual([...context.moneyValues("Subtotal $10.96")], [10.96])
  assert.deepEqual([...context.moneyValues("Subtotal $10.96 USD")], [10.96])
  assert.deepEqual([...context.moneyValues("Total 17.95 USD")], [17.95])

  // One semantic extractor owns both row markers and values, including
  // split siblings, nested spans, NBSP and a separately rendered currency.
  const splitRow = (label, parts) => {
    const labelElement = visible({ textContent: label })
    const partElements = parts.map((part) => visible({ textContent: part }))
    const row = visible({ textContent: `${label}\u00a0${parts.join("\u00a0")}`,
      children: [labelElement, ...partElements],
      querySelectorAll: () => [labelElement, ...partElements] })
    const children = [labelElement, ...partElements]
    children.forEach((element, index) => {
      element.parentElement = row
      element.previousElementSibling = children[index - 1] ?? null
      element.nextElementSibling = children[index + 1] ?? null
    })
    labelElement.closest = () => row
    return { elements: children, row }
  }
  const splitSubtotal = splitRow("Subtotal", ["$10.96"])
  const splitShipping = splitRow("Shipping", ["$6.99"])
  const splitTotal = splitRow("Total", ["USD", "17.95"])
  const scopedSummary = (rows) => {
    const summary = visible({
      textContent: rows.map((row) => row.textContent).join(" "),
      children: rows,
      matches: (selector) => selector.includes("data-order-summary"),
    })
    for (const row of rows) row.parentElement = summary
    return summary
  }
  const splitSummary = scopedSummary([
    splitSubtotal.row, splitShipping.row, splitTotal.row,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [splitSummary, splitSubtotal.row, splitShipping.row, splitTotal.row,
      ...splitSubtotal.elements, ...splitShipping.elements,
      ...splitTotal.elements] : []
  const sharedRows = context.semanticMoneyRows()
  assert.equal(sharedRows.subtotal.parsedUsd, 10.96)
  assert.equal(sharedRows.shipping.parsedUsd, 6.99)
  assert.equal(sharedRows.total.parsedUsd, 17.95)
  const sharedMarkers = context.shopPayMarkerSnapshot(sharedRows)
  assert.equal(sharedMarkers.shopPayMarkerSubtotal,
    sharedRows.subtotal.labelFound)
  assert.equal(sharedMarkers.shopPayMarkerShipping,
    sharedRows.shipping.labelFound)
  assert.equal(sharedMarkers.shopPayMarkerTotal, sharedRows.total.labelFound)
  assert.equal(sharedMarkers.subtotalParsed, true)
  assert.equal(sharedMarkers.shippingParsed, true)
  assert.equal(sharedMarkers.totalParsed, true)
  const splitQuote = context.checkoutSummaryQuote(10.96, sharedRows)
  assert.equal(splitQuote.subtotalUsd, 10.96)
  assert.equal(splitQuote.shippingUsd, 6.99)
  assert.equal(splitQuote.totalUsd, 17.95)
  const tightTotalLabel = visible({ textContent: "Total" })
  const tightTotalCurrency = visible({ textContent: "USD" })
  const tightTotalAmount = visible({ textContent: "$17.95" })
  const tightTotalRow = visible({ textContent: "TotalUSD$17.95",
    children: [tightTotalLabel, tightTotalCurrency, tightTotalAmount] })
  for (const child of tightTotalRow.children) child.parentElement = tightTotalRow
  const tightSummary = scopedSummary([
    splitSubtotal.row, splitShipping.row, tightTotalRow,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [tightSummary, splitSubtotal.row, splitShipping.row, tightTotalRow,
      ...splitSubtotal.elements, ...splitShipping.elements,
      ...tightTotalRow.children] : []
  assert.equal(context.semanticMoneyRows().total.parsedUsd, 17.95)
  assert.deepEqual([...context.moneyValues("USD\u00a0$17.95")], [17.95])
  assert.deepEqual([...context.moneyValues("$17.95\u00a0USD")], [17.95])
  assert.deepEqual([...context.moneyValues("USD\u00a017.95")], [17.95])
  const nestedSubtotalLabel = visible({ textContent: "Subtotal" })
  const nestedSubtotalValue = visible({ textContent: "$10.96" })
  const nestedSubtotalWrapper = visible({ textContent: "\u00a0$10.96",
    children: [nestedSubtotalValue],
    querySelectorAll: () => [nestedSubtotalValue] })
  const nestedSubtotalRow = visible({ textContent: "Subtotal\u00a0$10.96",
    children: [nestedSubtotalLabel, nestedSubtotalWrapper],
    querySelectorAll: () => [nestedSubtotalLabel, nestedSubtotalWrapper,
      nestedSubtotalValue] })
  nestedSubtotalLabel.parentElement = nestedSubtotalRow
  nestedSubtotalLabel.nextElementSibling = nestedSubtotalWrapper
  nestedSubtotalLabel.closest = () => nestedSubtotalRow
  nestedSubtotalWrapper.parentElement = nestedSubtotalRow
  nestedSubtotalValue.parentElement = nestedSubtotalWrapper
  const nestedSummary = scopedSummary([
    nestedSubtotalRow, splitShipping.row, splitTotal.row,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [nestedSummary, nestedSubtotalRow, nestedSubtotalLabel,
      nestedSubtotalWrapper, nestedSubtotalValue, splitShipping.row,
      splitTotal.row, ...splitShipping.elements, ...splitTotal.elements] : []
  assert.equal(context.semanticMoneyRow("subtotal").parsedUsd, 10.96)

  // Explicit tax changes Total; the parser must read the visible value and
  // must never synthesize it from subtotal plus shipping.
  const explicitTax = visible({ textContent: "Tax $1.00" })
  const taxedTotal = visible({ textContent: "Total USD $18.95" })
  const taxedSummary = scopedSummary([
    shopSubtotal, shopShipping, explicitTax, taxedTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [taxedSummary, shopSubtotal, shopShipping, explicitTax, taxedTotal] : []
  const taxedQuote = context.checkoutSummaryQuote(10.96)
  assert.equal(taxedQuote.totalUsd, 18.95)
  assert.equal(taxedQuote.taxUsd, 1)
  const explicitDiscount = visible({ textContent: "Discount $1.00" })
  const discountedTotal = visible({ textContent: "Total USD $16.95" })
  const discountedSummary = scopedSummary([
    shopSubtotal, shopShipping, explicitDiscount, discountedTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [discountedSummary, shopSubtotal, shopShipping, explicitDiscount,
      discountedTotal] : []
  const discountedQuote = context.checkoutSummaryQuote(10.96)
  assert.equal(discountedQuote.totalUsd, 16.95)
  assert.equal(discountedQuote.discountUsd, 1)
  const missingTotalSummary = scopedSummary([
    shopSubtotal, shopShipping, explicitTax,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [missingTotalSummary, shopSubtotal, shopShipping, explicitTax] : []
  assert.equal(context.checkoutSummaryQuote(10.96), null)
  const missingTotalMarkers = context.shopPayMarkerSnapshot()
  assert.equal(missingTotalMarkers.totalLabelFound, false)
  assert.equal(context.shopPayQuoteFailure(missingTotalMarkers, null, true),
    "SHOP_PAY_TOTAL_LABEL_NOT_FOUND")
  assert.equal(paymentClicked, false)
  const states = runtimeMessages.map((message) => message.state).filter(Boolean)
  const expectedOrder = ["CHECKOUT_CLASSIFIER_STARTED",
    "CHECKOUT_HOST_CLASSIFIED", "CHECKOUT_PAGE_DETECTED",
    "SHOP_PAY_DOM_WAITING", "SHOP_PAY_DOM_READY", "CHECKOUT_PAGE_CLASSIFIED",
    "NORMAL_CHECKOUT_WITH_SHIPPING", "CHECKOUT_EXPECTED_PRODUCT_VERIFIED",
    "CHECKOUT_EXPECTED_QUANTITY_VERIFIED", "CANONICAL_US_PROFILE_FOUND",
    "SHOP_PAY_QUOTE_PARSER_STARTED",
    "SHIPPING_CAPTURE_STARTED"]
  assert.deepEqual(states.slice(0, expectedOrder.length), expectedOrder)
  const classified = runtimeMessages.find((message) =>
    message.state === "CHECKOUT_PAGE_CLASSIFIED")
  assert.equal(classified?.checkoutHostClassification,
    "SHOP_PAY_CHECKOUT_HOST")
  assert.equal(classified?.checkoutPageClassification,
    "NORMAL_CHECKOUT_WITH_SHIPPING")
  assert.equal(classified?.shopPayMarkerShippingAmount, true)

  for (const row of shopSummary.children) row.parentElement = shopSummary
  const shopSelectorsWithoutCheckoutIdentity = (selector) =>
    selector.includes('[data-testid*="line-item"') ? [] : shopSelectors(selector)
  selectors = shopSelectorsWithoutCheckoutIdentity
  runtimeMessages.length = 0
  const authorityCarriedQuote = await context.checkoutShipping(job(), 10.96)
  assert.equal(authorityCarriedQuote.shippingUsd, 6.99)
  assert.equal(runtimeMessages.some((message) =>
    message.state === "CHECKOUT_EXPECTED_PRODUCT_VERIFIED"), true)

  // A shipping-method or promotion label outside the monetary order summary
  // cannot turn an independently priced summary row into zero shipping.
  const unrelatedFreeShipping = visible({ textContent: "Shipping plan FREE" })
  unrelatedFreeShipping.parentElement = shopSummary
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [shopSummary, shopSubtotal, shopShipping, shopTotal,
      unrelatedFreeShipping] : []
  const pricedShippingDespiteUnrelatedFree =
    context.checkoutSummaryQuote(10.96)
  assert.equal(pricedShippingDespiteUnrelatedFree.shippingUsd, 6.99)

  const freeShipping = visible({ textContent: "Shipping FREE" })
  const freeTotal = visible({ textContent: "Total 10.96 USD" })
  const freeSummary = scopedSummary([shopSubtotal, freeShipping, freeTotal])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [freeSummary, shopSubtotal, freeShipping, freeTotal] : []
  const freeQuote = context.checkoutSummaryQuote(10.96)
  assert.equal(freeQuote.shippingUsd, 0)
  assert.equal(freeQuote.totalUsd, 10.96)

  const explicitZeroShipping = visible({ textContent: "Shipping $0.00" })
  const zeroSummary = scopedSummary([
    shopSubtotal, explicitZeroShipping, freeTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [zeroSummary, shopSubtotal, explicitZeroShipping, freeTotal] : []
  const zeroQuote = context.checkoutSummaryQuote(10.96)
  assert.equal(zeroQuote.shippingUsd, 0)
  assert.equal(zeroQuote.shippingZeroAuthoritative, true)

  const unrelatedFreeInRow = visible({
    textContent: "Shipping Free returns",
  })
  const unrelatedFreeSummary = scopedSummary([
    shopSubtotal, unrelatedFreeInRow, freeTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [unrelatedFreeSummary, shopSubtotal, unrelatedFreeInRow, freeTotal] : []
  const unrelatedFreeRows = context.semanticMoneyRows()
  assert.equal(unrelatedFreeRows.shipping.parsedUsd, null)
  assert.equal(unrelatedFreeRows.shipping.explicitFree, false)
  assert.equal(context.checkoutSummaryQuote(10.96, unrelatedFreeRows), null)
  assert.equal(context.shopPayQuoteFailure(
    context.shopPayMarkerSnapshot(unrelatedFreeRows), null, true),
  "SHOP_PAY_SHIPPING_PARSE_FAILED")

  const unrelatedZeroInRow = visible({
    textContent: "Shipping $0 promotion",
  })
  const unrelatedZeroSummary = scopedSummary([
    shopSubtotal, unrelatedZeroInRow, freeTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [unrelatedZeroSummary, shopSubtotal, unrelatedZeroInRow, freeTotal] : []
  assert.equal(context.semanticMoneyRows().shipping.parsedUsd, null)

  const conflictingAccessibleShipping = visible({
    textContent: "$6.99",
    getAttribute: (name) => name === "aria-label" ? "Shipping FREE" : null,
  })
  const conflictingAccessibleSummary = scopedSummary([
    shopSubtotal, conflictingAccessibleShipping, shopTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [conflictingAccessibleSummary, shopSubtotal,
      conflictingAccessibleShipping, shopTotal] : []
  assert.equal(context.semanticMoneyRows().shipping.ambiguityReason,
    "SHOP_PAY_SHIPPING_ROW_AMBIGUOUS")

  const secondShipping = visible({ textContent: "Shipping $8.99 USD" })
  const ambiguousShippingSummary = scopedSummary([
    shopSubtotal, shopShipping, secondShipping, shopTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [ambiguousShippingSummary, shopSubtotal, shopShipping, secondShipping,
      shopTotal] : []
  const ambiguousRows = context.semanticMoneyRows()
  assert.equal(ambiguousRows.shipping.parsedUsd, null)
  assert.equal(ambiguousRows.shipping.ambiguityReason,
    "SHOP_PAY_SHIPPING_ROW_AMBIGUOUS")
  assert.equal(context.shopPayQuoteFailure(
    context.shopPayMarkerSnapshot(ambiguousRows), null, true),
  "SHOP_PAY_SHIPPING_ROW_AMBIGUOUS")

  const secondTotal = visible({ textContent: "Total USD $19.95" })
  const ambiguousTotalSummary = scopedSummary([
    shopSubtotal, shopShipping, shopTotal, secondTotal,
  ])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [ambiguousTotalSummary, shopSubtotal, shopShipping, shopTotal,
      secondTotal] : []
  const ambiguousTotalRows = context.semanticMoneyRows()
  assert.equal(ambiguousTotalRows.total.parsedUsd, null)
  assert.equal(ambiguousTotalRows.total.ambiguityReason,
    "SHOP_PAY_TOTAL_ROW_AMBIGUOUS")

  const missingShippingSummary = scopedSummary([shopSubtotal, shopTotal])
  selectors = (selector) => selector.includes("data-order-summary") ||
      selector.startsWith("dt,dd,th")
    ? [missingShippingSummary, shopSubtotal, shopTotal] : []
  const missingShippingMarkers = context.shopPayMarkerSnapshot()
  assert.equal(context.shopPayQuoteFailure(missingShippingMarkers, null, true),
    "SHOP_PAY_SHIPPING_LABEL_NOT_FOUND")

  assert.equal(context.shopPayQuoteFailure({
    shopPayMarkerOrderSummary: true, orderSummaryAmbiguous: false,
    subtotalLabelFound: true, subtotalAmountCandidateFound: true,
    subtotalParsed: true, shippingLabelFound: false,
    totalLabelFound: true, totalAmountCandidateFound: true,
    totalParsed: true,
  }, null, true), "SHOP_PAY_SHIPPING_LABEL_NOT_FOUND")
  assert.equal(context.shopPayQuoteFailure({
    shopPayMarkerOrderSummary: true, orderSummaryAmbiguous: false,
    subtotalLabelFound: true, subtotalAmountCandidateFound: true,
    subtotalParsed: true, shippingLabelFound: true,
    shippingAmountCandidateFound: false, shippingParsed: false,
    totalLabelFound: true, totalAmountCandidateFound: true,
    totalParsed: true,
  }, null, true), "SHOP_PAY_SHIPPING_AMOUNT_NOT_FOUND")
  assert.doesNotMatch(content, /SHOP_PAY_MONEY_PARSE_FAILED/)

  for (const row of shopSummary.children) row.parentElement = shopSummary
  let rendered = false
  selectors = (selector) => rendered ? shopSelectors(selector) : []
  setTimeout(() => { rendered = true }, 10)
  const asyncReady = await context.checkoutClassificationWhenReady(job(), 10.96)
  assert.equal(asyncReady.classification, "NORMAL_CHECKOUT_WITH_SHIPPING")
  assert.equal(asyncReady.quote.shippingUsd, 6.99)

  const wrongShipTo = visible({
    textContent: "Ship to United States GA 30301",
    getAttribute: () => null,
  })
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [wrongShipTo] : selector.startsWith("h1,h2,h3")
      ? [wrongShipTo, shopShippingSection, shopPayment, shopSubtotal,
        shopShipping, shopTotal, ...(payNowAvailable ? [payNow] : [])]
      : shopSelectors(selector)
  assert.equal(await context.shopPayCanonicalShippingProfile(job()), false)
  await assert.rejects(() => context.checkoutShipping(job(), 10.96),
    /CANONICAL_US_SHIPPING_PROFILE_MISMATCH/)

  selectors = () => []
  assert.equal(context.checkoutPageClassification(), "UNKNOWN_CHECKOUT_PAGE")
})

test("normal product pages continue without positive auth markers and real auth failures close", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const context = {
    URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal, Event, crypto,
    setInterval, clearInterval, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    location: { hostname: "www.lunaportex.com",
      pathname: "/",
      origin: "https://www.lunaportex.com" },
    document: { readyState: "complete", body: {},
      querySelector: () => null, querySelectorAll: () => [],
      documentElement: { append() {} } },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    chrome: { runtime: { sendMessage() {} } },
    fetch: async () => ({ ok: true, status: 200, type: "basic",
      headers: { get: () => null }, text: async () => JSON.stringify({ items: [] }) }),
  }
  runInNewContext(content, context)
  context.location.pathname = "/products/exact-microcurrent-device"
  assert.equal(context.classifyPageAuth(), "AUTH_NOT_YET_REQUIRED")
  const challenge = { textContent: "Verify you are human",
    getBoundingClientRect: () => ({ width: 100, height: 30 }) }
  context.document.querySelectorAll = (selector) =>
    selector.includes("data-cf-challenge") ? [challenge] : []
  assert.equal(context.classifyPageAuth(), "AUTH_CHALLENGE_PRESENT")
  context.document.querySelectorAll = () => []
  context.location.hostname = "account.lunaportex.com"
  context.location.pathname = "/auth/code"
  assert.equal(context.classifyPageAuth(), "AUTH_EXPLICITLY_FAILED")
  context.location.hostname = "www.lunaportex.com"
  context.location.pathname = "/products/exact-microcurrent-device"
  context.fetch = async () => ({ ok: false, status: 0, type: "opaqueredirect",
    headers: { get: () => null }, text: async () => "" })
  await assert.rejects(() => context.request("/cart.js"),
    /LUNA_SESSION_EXPIRED/)
  context.fetch = async () => ({ ok: false, status: 403, type: "basic",
    headers: { get: () => null }, text: async () => "" })
  await assert.rejects(() => context.request("/cart.js"),
    /LUNA_AUTH_CHALLENGE_REQUIRED/)
  context.fetch = async () => ({ ok: true, status: 200, type: "basic",
    headers: { get: () => null }, text: async () => JSON.stringify({ items: [] }) })
  assert.equal((await context.request("/cart.js")).items.length, 0)
})

test("capture handoff reuses append-only profitability facts and ACKs only after readback", async () => {
  const [page, route, server, migration] = await Promise.all([
    readFile(new URL(
      "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
    "utf8"),
    readFile(new URL(
      "../../app/api/admin/ebay/luna-shipping-capture/route.ts", import.meta.url),
    "utf8"),
    readFile(new URL("./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../supabase/migrations/20260823034507_create_seller_os_profitability_frontier_and_schedule_policy.sql",
      import.meta.url), "utf8"),
  ])
  assert.match(page, /adminPost\("certify_capture", \{ capture \}/)
  assert.doesNotMatch(page, /adminPost\("certify_capture", \{ job/)
  assert.match(route, /persistLunaChromeShippingCaptureV1/)
  assert.match(server, /createHmac\("sha256"/)
  assert.match(server, /LUNA_SHIPPING_CAPTURE_SESSION_REPLAYED/)
  assert.match(server, /put_seller_os_profitability_frontier_v1/)
  assert.match(server, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.match(route,
    /body\.purpose === "CANONICAL_BIND_BOOTSTRAP"/)
  assert.match(server,
    /input\.candidateIds\[0\] === LUNA_SHIPPING_CANARY_CANDIDATE_ID/)
  assert.match(server,
    /frontier\.economicClassification === "ECONOMICALLY_DEAD"[\s\S]*!certificationBootstrap/)
  assert.match(server, /SHIPPING_DURABLY_PERSISTED/)
  assert.match(server, /capturePostAccepted: true/)
  assert.match(server, /captureResultDurable: true/)
  assert.match(server, /durableReadbackMatch: true/)
  assert.match(migration, /SELLER_OS_PROFITABILITY_FRONTIER_APPEND_ONLY/)
  assert.doesNotMatch(server + route + page,
    /create table|alter table|create migration/i)
})

test("live monitor reuses the existing admin transport and same-day event store", async () => {
  const [page, route, server, background, content] = await Promise.all([
    readFile(new URL(
      "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
    "utf8"),
    readFile(new URL(
      "../../app/api/admin/ebay/luna-shipping-capture/route.ts", import.meta.url),
    "utf8"),
    readFile(new URL("./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/background.js",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/content.js",
      import.meta.url), "utf8"),
  ])
  assert.match(page, /Monitor de ejecución/)
  assert.match(page, /TRACE_ID=/)
  assert.match(page, /CURRENT_STATE=/)
  assert.match(page, /LAST_SUCCESSFUL_STATE=/)
  assert.match(page, /CURRENT_BLOCKER=/)
  assert.match(page, /"persist_runtime_trace"/)
  assert.match(page, /"read_runtime_trace"/)
  assert.doesNotMatch(page, /replayPendingBindAfterUpgrade/)
  assert.match(background, /CANONICAL_BIND_COMPLETED/)
  assert.doesNotMatch(page,
    /event\.extensionVersion !== EXPECTED_EXTENSION_VERSION/)
  assert.match(route, /persistLunaShippingRuntimeTraceV1/)
  assert.match(route, /readLatestLunaShippingRuntimeTraceV1/)
  assert.match(server, /ebay_same_day_pilot_events/)
  assert.match(server, /LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_READBACK_FAILED/)
  assert.match(background, /LUNA_SHIPPING_RUNTIME_TRACE_EVENT/)
  assert.match(background, /MAX_RUNTIME_TRACE_EVENTS = 100/)
  assert.match(background, /activeRuntimeTrace\.events\.push\(event\)/)
  assert.match(background,
    /for \(const event of activeRuntimeTrace\?\.events \?\? \[\]\)/)
  assert.match(background, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(background, /CANONICAL_FINGERPRINT_WRITE/)
  assert.match(background, /CANONICAL_FINGERPRINT_READBACK/)
  assert.match(background, /BIND_TIMEOUT:\$\{transition\}/)
  assert.match(background, /CANONICAL_BIND_COMPLETED/)
  assert.match(background, /SELLER_OS_LUNA_SHIPPING_SERVER_RESULT/)
  assert.doesNotMatch(background + content + page + route + server,
    /rawAddress|fullAddress|cardNumber|checkoutToken/)
  assert.doesNotMatch(background + content, /click\([^)]*(?:pay now|place order)/i)
  assert.doesNotMatch(route + server, /create table|alter table|create migration/i)
})

test("existing eBay Product Research extension remains a separate boundary", async () => {
  const manifest = JSON.parse(await readFile(new URL(
    "../../tools/browser-extensions/ebay-product-research-capture/manifest.json",
    import.meta.url), "utf8"))
  assert.equal(manifest.name, "Seller OS — eBay Product Research Capture")
  assert.ok(manifest.host_permissions.every((entry) => !entry.includes("lunaportex")))
})
