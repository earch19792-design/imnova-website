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
  persistLunaChromeShippingCaptureV1,
  persistLunaShippingRuntimeTraceV1,
  resolveLunaChromeShippingJobsV1,
  verifyLunaShippingCaptureSessionV1,
} = await import("./ebay-luna-chrome-shipping-capture-server-v1.ts")
const {
  detectAndWakeLunaShippingExtensionV1,
} = await import("./ebay-luna-extension-detection-v1.ts")
const {
  canonicalSellerOsLunaPreviewOriginV1,
  SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN,
} = await import("./ebay-luna-shipping-preview-origin-v1.mjs")
const {
  getEbayProRuntimeBoundary,
  SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
} = await import("./environment-boundaries.ts")
const {
  getEbaySellerAccountScopeConfiguration,
} = await import("./ebay-seller-account-scope.ts")

const NOW = Date.parse("2026-08-24T18:00:00.000Z")
const CANARY_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60"

test("canonicalizes only immutable Preview hosts from the authorized Seller OS project", () => {
  for (const origin of [
    "https://imnova-website-z1qh-jfi221xil-earch19792-6888s-projects.vercel.app",
    "https://imnova-website-z1qh-rafzbri1y-earch19792-6888s-projects.vercel.app",
    SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN,
  ]) assert.equal(canonicalSellerOsLunaPreviewOriginV1(origin),
    SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN)

  for (const origin of [
    "https://unrelated-project-preview.vercel.app",
    "https://other-project-jfi221xil-earch19792-6888s-projects.vercel.app",
    "https://imnova-website-z1qh-jfi221xil-earch19792-6888s-projects.vercel.app.evil.example",
    "https://imnova-website-z1qh-jfi221xi-earch19792-6888s-projects.vercel.app",
    "https://imnova-website-z1qh-jfi221xil-earch19792-6888s-projects-vercel.app",
    "http://imnova-website-z1qh-jfi221xil-earch19792-6888s-projects.vercel.app",
    "https://imnova-website-z1qh-jfi221xil-earch19792-6888s-projects.vercel.app:8443",
    "https://imnova-website-z1qh.vercel.app",
  ]) assert.equal(canonicalSellerOsLunaPreviewOriginV1(origin), null)
})

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
    extensionVersion: "1.0.45",
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

test("operator-bound profile plus a single canonical cart rate certifies shipping", () => {
  const canonical = capture({
    acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    canonicalDestinationAuthority:
      "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    canonicalDestinationFingerprint: job().destination.profileDigest,
    canonicalDestinationMatch: true,
    selectedShippingStateProof: "SINGLE_CANONICAL_RATE",
  })
  const result = certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: canonical, now: NOW,
  })
  assert.equal(result.captureStatus, "AUTHORITATIVE_LUNA_SHIPPING_AVAILABLE")
  assert.equal(result.quote.acquisitionMethod,
    "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING")
  assert.equal(result.quote.destinationProfileDigest,
    job().destination.profileDigest)
  assert.equal(result.quote.shippingAmountUsd, 4.25)
  assert.equal(result.lunaPurchases, 0)
  assert.equal(result.marketplaceWrites, 0)

  for (const unsafe of [
    { canonicalDestinationFingerprint: `sha256:${"c".repeat(64)}` },
    { canonicalDestinationMatch: false },
    { selectedShippingStateProof: "PRICE_ONLY" },
    { canonicalDestinationAuthority: "SHOP_PAY_AMOUNT_ONLY" },
  ]) assert.throws(() => certifyLunaChromeShippingVisibleCaptureV1({
    job: job(), capture: { ...canonical, ...unsafe }, now: NOW,
  }), /LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN/)

  const post = {
    candidateId: canonical.candidateId,
    lunaProductId: canonical.lunaProductId,
    lunaVariantId: canonical.lunaVariantId,
    supplierSku: canonical.supplierSku,
    quantity: canonical.quantity,
    subtotalUsd: canonical.subtotalUsd,
    shippingUsd: canonical.shippingUsd,
    totalUsd: canonical.totalUsd,
    currency: canonical.currency,
    observedAt: canonical.observedAt,
    acquisitionMethod: canonical.acquisitionMethod,
    evidenceDigest: canonical.extensionEvidenceDigest,
    captureSessionId: canonical.captureSessionId,
    nonce: canonical.nonce,
    canonicalDestinationAuthority:
      canonical.canonicalDestinationAuthority,
    canonicalDestinationFingerprint:
      canonical.canonicalDestinationFingerprint,
    canonicalDestinationMatch: canonical.canonicalDestinationMatch,
    selectedShippingStateProof: canonical.selectedShippingStateProof,
  }
  assert.equal(certifyLunaShippingCapturePostV1({ job: job(), capture: post,
    now: NOW }).quote.acquisitionMethod,
  "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING")
  assert.throws(() => certifyLunaShippingCapturePostV1({ job: job(),
    capture: { ...post, rawAddress: "must never be accepted" }, now: NOW }),
  /LUNA_SHIPPING_CAPTURE_POST_CONTRACT_INVALID/)
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
  const longProductUrl =
    "https://lunaportex.com/products/language-translator-device-portable-translator-device-with-138-languages-4-1-touch-screen-smart-voice-photo-translator-real-time-offline-online-translation-for-business-learning-travel-black"
  assert.equal(normalizeLunaChromeShippingJobV1({ ...job(), identity: {
    ...job().identity, canonicalProductUrl: longProductUrl,
  } }).identity.canonicalProductUrl, longProductUrl.replace(
    "https://lunaportex.com", "https://www.lunaportex.com"))
})

test("effective unpacked MV3 artifact has only fixed hosts and coherent build", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [manifestRaw, background, content, startupProbeRaw] = await Promise.all([
    readFile(new URL("manifest.json", root), "utf8"),
    readFile(new URL("background.js", root), "utf8"),
    readFile(new URL("content.js", root), "utf8"),
    readFile(new URL("startup-probe.json", root), "utf8"),
  ])
  const manifest = JSON.parse(manifestRaw)
  const startupProbe = JSON.parse(startupProbeRaw)
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, "1.0.47")
  assert.equal(manifest.name, "Seller OS — Luna Shipping Capture")
  assert.deepEqual(manifest.permissions, ["scripting", "webNavigation", "storage"])
  assert.deepEqual(manifest.host_permissions, [
    "https://lunaportex.com/*",
    "https://www.lunaportex.com/*",
    "https://account.lunaportex.com/*",
    "https://shop.app/*",
  ])
  assert.ok(manifest.content_scripts[0].matches.includes("https://shop.app/*"))
  assert.match(background, /EXTENSION_BUILD_VERSION = "1\.0\.47"/)
  assert.match(background, /SHOP_APP_HOST_PATTERN = "https:\/\/shop\.app\/\*"/)
  assert.match(background, /CHECKOUT_HOSTS\.has\("shop\.app"\)/)
  assert.match(content, /extensionBuildVersion: "1\.0\.47"/)
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
    /bindOperatorCanonicalDestination\(existingBinding,[\s\S]*bootstrapJob\)/)
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
  assert.match(background,
    /CANONICAL_DESTINATION_EXPLICIT_OPERATOR_BIND_REQUIRED/)
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"))
  assert.deepEqual(manifest.externally_connectable.matches, [
    "https://imnova-seller-os-preprod.vercel.app/*",
  ])
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["startup-probe.json"],
    matches: [
      "https://imnova-seller-os-preprod.vercel.app/*",
    ],
  }])
  assert.deepEqual(startupProbe, {
    contractVersion: "SELLER_OS_LUNA_EXTENSION_STARTUP_PROBE_V1",
    extensionId: LUNA_SHIPPING_EXTENSION_ID,
    extensionVersion: "1.0.47",
  })
  const key = Buffer.from(manifest.key, "base64")
  const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("")
  assert.equal(id, LUNA_SHIPPING_EXTENSION_ID)
})

test("fresh page, worker wake, and extension reload preserve one durable binding", async () => {
  const root = new URL("../../tools/browser-extensions/luna-shipping-capture/",
    import.meta.url)
  const [background, manifestRaw] = await Promise.all([
    readFile(new URL("background.js", root), "utf8"),
    readFile(new URL("manifest.json", root), "utf8"),
  ])
  const manifest = JSON.parse(manifestRaw)
  const controlUrl =
    "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture"
  const oldControlUrl =
    "https://unrelated-project-preview.vercel.app/admin/ebay/luna-shipping-capture"
  const durableBinding = {
    canonicalDestinationFingerprint: `sha256:${"a".repeat(64)}`,
    fingerprintVersion: "LUNA_CANONICAL_DESTINATION_PROFILE_SHA256_V1",
    countryClass: "US",
    authorityClass: "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    evidenceClass: "SERVER_CANONICAL_DESTINATION_PROFILE_DIGEST",
    validationMethod: "EXACT_PROFILE_DIGEST_MATCH",
    boundAt: "2026-08-24T18:00:00.000Z",
  }
  let persistedStorage = {
    sellerOsLunaCanonicalDestinationBindingV1: durableBinding,
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
  for (let wake = 0; wake < 3; wake += 1) {
    const worker = startWorker()
    let pong = null
    assert.equal(worker.externalMessageListener({
      type: "SELLER_OS_LUNA_SHIPPING_PING",
    }, { url: controlUrl }, (value) => { pong = value }), false)
    assert.deepEqual(JSON.parse(JSON.stringify(pong)), {
      type: "LUNA_SHIPPING_EXTENSION_READY",
      extensionId: LUNA_SHIPPING_EXTENSION_ID,
      extensionVersion: "1.0.47", extensionBuildVersion: "1.0.47",
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
    assert.equal(diagnostic?.extensionVersion, "1.0.47")
    assert.equal(diagnostic?.storageAreaUsed, "chrome.storage.local")
    assert.equal(diagnostic?.canonicalPrimaryKeyPresent, true)
    assert.equal(diagnostic?.canonicalLegacyKeyPresent, false)
    assert.equal(diagnostic?.canonicalEnvelopePresent, true)
    assert.equal(diagnostic?.canonicalEnvelopeSchemaVersion,
      "LUNA_CANONICAL_DESTINATION_PROFILE_SHA256_V1")
    assert.equal(diagnostic?.canonicalEnvelopeValid, true)
    assert.equal(diagnostic?.canonicalCountryClassPresent, true)
    assert.equal(diagnostic?.canonicalFingerprintPresent, true)
    assert.equal(diagnostic?.canonicalBoundAtPresent, true)
    assert.equal(diagnostic?.storageReadStatus, "READ_OK")
    assert.equal(diagnostic?.bindingClassification, "PRIMARY_BINDING_VALID")
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
    fingerprintVersion: "LUNA_CANONICAL_DESTINATION_PROFILE_SHA256_V1",
    canonicalDestinationFingerprint: "invalid", countryClass: "US",
    authorityClass: "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    evidenceClass: "SERVER_CANONICAL_DESTINATION_PROFILE_DIGEST",
    validationMethod: "EXACT_PROFILE_DIGEST_MATCH",
    boundAt: "2026-08-24T18:00:00.000Z",
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
  assert.match(page, /EXPECTED_EXTENSION_VERSION = "1\.0\.47"/)
  assert.match(page, /Vincular perfil canónico US de Seller OS/)
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
    /return connected && canonicalBindingStatusReady && canonicalDestinationBound &&[\s\S]*?!canonicalDestinationMismatch && !canaryRunInProgress/)
  assert.doesNotMatch(finalCanaryGate, /canonicalDestinationMatch/)
  assert.match(finalCanaryGate, /canonicalDestinationBound/)
  assert.match(page,
    /disabled=\{!canStartFinalCanary\}[\s\S]*?Ejecutar canary final/)
  assert.match(page,
    /if \(hasExactLiveTarget \|\| busy \|\| !extensionReady \|\|[\s\S]*?!canonicalBindingStatusRead \|\|[\s\S]*?!canonicalDestinationBindingPresent\) return/)
  const canStart = (connected, bindingStatusReady, bound, mismatch, running) =>
    connected && bindingStatusReady && bound && !mismatch && !running
  assert.equal(canStart(true, true, true, false, false), true)
  assert.equal(canStart(true, true, false, false, false), false)
  assert.equal(canStart(true, false, true, false, false), false)
  assert.equal(canStart(false, true, true, false, false), false)
  assert.equal(canStart(true, true, true, false, true), false)
  assert.equal(canStart(true, true, true, true, false), false)
  assert.match(page, /Acción explícita única\./)
  assert.match(page, /nunca guarda ni muestra la dirección\./)
  assert.match(page, /shopAppManifestPermission !== true/)
  assert.match(page, /shopAppRuntimeAllowlist !== true/)
  assert.match(page, /runtime\.sendMessage\(EXTENSION_ID/)
  assert.match(page, /ensureCanonicalExtensionOrigin\(\)/)
  assert.match(page,
    /SELLER_OS_EXTENSION_ORIGIN = SELLER_OS_LUNA_STABLE_PREVIEW_ORIGIN/)
  assert.match(page, /canonicalSellerOsLunaPreviewOriginV1/)
  assert.match(page, /LUNA_SHIPPING_EXTENSION_ORIGIN_REJECTED/)
  assert.match(page, /window\.location\.replace/)
  assert.match(page, /probeInstalledExtension/)
  assert.match(page, /startup-probe\.json/)
  assert.match(page, /if \(!response\.ok\) return null/)
  assert.doesNotMatch(page,
    /async function probeInstalledExtension[\s\S]*?catch \{\s*return false/)
  assert.ok(page.indexOf("detectAndWakeLunaShippingExtensionV1") <
    page.indexOf("runtime.connect"))
  assert.match(page, /Ejecutar canary de shipping/)
  assert.match(page, /params\.get\("runShipping"\) === "1"/)
})

test("idle bridge reconnect restores durable binding and restarts production without refresh", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const disconnectHandler = page.match(
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?\n        \}\)\n      \}/)?.[0] ?? ""
  assert.match(disconnectHandler, /if \(reconnecting\) return/)
  assert.doesNotMatch(disconnectHandler, /if \(!busy \|\| reconnecting\) return/)
  assert.match(disconnectHandler, /canonicalBindingStatusRead = false/)
  assert.match(disconnectHandler, /setCanonicalBindingStatusReady\(false\)/)
  assert.match(disconnectHandler, /activeJobStatusReady = false/)
  assert.match(disconnectHandler, /initialAutoClaimStarted = false/)
  assert.match(disconnectHandler, /wakeLunaShippingExtensionV1/)
  assert.match(disconnectHandler, /attachPort\(resumedPort\)/)
  assert.match(disconnectHandler, /if \(jobToResume\)/)
  assert.match(page,
    /const attachPort = \(nextPort[\s\S]*?SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS[\s\S]*?SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS/)
  assert.match(page,
    /const bound = message\.canonicalDestinationBound === true[\s\S]*?canonicalBindingStatusRead = true/)
  assert.match(page,
    /const startInitialProductionClaim = \(\) => \{[\s\S]*?INITIAL_AUTO_CLAIM_STARTED/)
  assert.match(page,
    /canonicalBindingStatusRead = true[\s\S]*?startInitialProductionClaim\(\)/)
  assert.match(page,
    /setStatus\("CANONICAL_OPERATOR_BIND_REQUIRED"\)[\s\S]*?setError\(""\)/)
  assert.match(page, /!canonicalDestinationBindingPresent/)
  assert.doesNotMatch(disconnectHandler,
    /SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION/)
})

test("BFCache restore closes and deterministically recreates the page port", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const pageHide = page.match(
    /const handlePageHide = \(\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""
  const pageShow = page.match(
    /const handlePageShow = \(event: PageTransitionEvent\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""

  assert.match(pageHide, /pageHidden = true/)
  assert.match(pageHide, /pageLifecycleReconnectPending = true/)
  assert.match(pageHide, /pageLifecycleJobToResume = busy \? jobs\[index\] : null/)
  assert.match(pageHide, /reconnectGeneration \+= 1/)
  assert.match(pageHide, /const hiddenPort = port[\s\S]*?port = null[\s\S]*?hiddenPort\?\.disconnect\(\)/)
  assert.doesNotMatch(pageHide, /setTimeout|wakeLunaShippingExtensionV1/)

  assert.match(pageShow, /event\.persisted/)
  assert.match(pageShow, /wakeLunaShippingExtensionV1\(runtime, pingExtensionOnce, wait\)/)
  assert.match(pageShow, /runtime\.connect\(EXTENSION_ID, \{ name: PORT_NAME \}\)/)
  assert.match(pageShow, /attachPort\(resumedPort\)/)
  assert.match(pageShow, /RESUME_ACTIVE_LUNA_SHIPPING_JOB/)
  assert.match(pageShow, /canonicalBindingStatusRead = false/)
  assert.match(pageShow, /activeJobStatusReady = false/)
  assert.match(page,
    /const attachPort = \(nextPort[\s\S]*?SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS[\s\S]*?SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS/)
  assert.match(page, /window\.addEventListener\("pagehide", handlePageHide\)/)
  assert.match(page, /window\.addEventListener\("pageshow", handlePageShow\)/)
  assert.match(page, /window\.removeEventListener\("pagehide", handlePageHide\)/)
  assert.match(page, /window\.removeEventListener\("pageshow", handlePageShow\)/)
  assert.match(page, /if \(hasExactLiveTarget \|\| !active/,
    "exact-target global auto-claim guard remains intact")
  assert.match(page, /if \(!hasExactLiveTarget\) \{[\s\S]*?read_runtime_trace/,
    "global trace behavior remains scoped outside exact-target mode")
  assert.match(page, /const EXPECTED_EXTENSION_VERSION = "1\.0\.47"/)
})

test("canary UI requires an explicit valid binding and fails closed otherwise", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const diagnosticHandler = page.match(
    /if \(message\?\.type === BINDING_STORAGE_DIAGNOSTIC\) \{[\s\S]*?\n        \}/)?.[0] ?? ""
  assert.match(diagnosticHandler,
    /storageReadStatus === "READ_OK"[\s\S]*?"NO_BINDING_PRESENT"/)
  assert.match(diagnosticHandler, /"PRIMARY_BINDING_VALID"/)
  assert.doesNotMatch(diagnosticHandler, /"LEGACY_BINDING_VALID"/)
  assert.match(diagnosticHandler,
    /canonicalBindingStatusRead = true[\s\S]*?setCanonicalBindingStatusReady\(true\)/)
  assert.match(diagnosticHandler,
    /bindingClassification === "PRIMARY_BINDING_VALID"/)
  assert.match(diagnosticHandler,
    /if \(!bindingStatusAccepted\) \{[\s\S]*?setCanonicalBindingStatusReady\(false\)[\s\S]*?fail\(/)
  assert.match(page,
    /message\.error === "CANONICAL_US_SHIPPING_PROFILE_MISMATCH"[\s\S]*?setCanonicalDestinationMismatch\(true\)/)
  assert.match(page,
    /finalCanaryStartEnabled\(connected,[\s\S]*?canonicalDestinationBound,[\s\S]*?canonicalDestinationMismatch, running\)/)
  assert.match(page, /Vincular perfil canónico US de Seller OS/)
  assert.doesNotMatch(page, /\.click\(\)/)

  const enabled = (connected, statusRead, bound, mismatch, busy) =>
    connected && statusRead && bound && !mismatch && !busy
  assert.equal(enabled(true, true, false, false, false), false,
    "NO_BINDING_PRESENT requires the one-time explicit operator bind")
  assert.equal(enabled(true, true, true, false, false), true,
    "an existing valid binding remains eligible")
  assert.equal(enabled(true, true, true, true, false), false,
    "a proven existing mismatch stays fail-closed")
  assert.equal(enabled(true, false, true, false, false), false,
    "storage read failure stays disabled")
  assert.equal(enabled(false, true, true, false, false), false,
    "extension unavailable stays disabled")
  assert.equal(enabled(true, true, true, false, true), false,
    "busy runtime state stays disabled")
})

test("canonical destination storage is stable and never silently rebound", async () => {
  const [background, manifestRaw] = await Promise.all([
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/background.js",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/manifest.json",
      import.meta.url), "utf8"),
  ])
  const manifest = JSON.parse(manifestRaw)
  assert.equal(typeof manifest.key, "string")
  assert.match(background,
    /DESTINATION_STORAGE_KEY = "sellerOsLunaCanonicalDestinationBindingV1"/)
  assert.match(background,
    /chrome\.storage\.local\.get\(\s*DESTINATION_STORAGE_KEY/)
  assert.match(background,
    /chrome\.storage\.local\.set\(\{\s*\[DESTINATION_STORAGE_KEY\]: binding/)
  assert.doesNotMatch(background,
    /chrome\.storage\.(?:local|sync|session)\.(?:clear|remove)\(/)
  assert.doesNotMatch(background,
    /onInstalled[\s\S]{0,500}writeDestinationBinding/)
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
    probeInstalledExtension: async () => false,
    wait: async () => {},
    runtimeAttempts: 3,
  }), /LUNA_SHIPPING_EXTENSION_NOT_INSTALLED/)

  await assert.rejects(() => detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => undefined,
    pingRuntime: async () => {},
    probeInstalledExtension: async () => true,
    wait: async () => {},
    runtimeAttempts: 1,
  }), /LUNA_SHIPPING_EXTENSION_RUNTIME_API_UNAVAILABLE/)

  await assert.rejects(() => detectAndWakeLunaShippingExtensionV1({
    readRuntime: () => undefined,
    pingRuntime: async () => {},
    wait: async () => {},
    runtimeAttempts: 1,
  }), /LUNA_SHIPPING_EXTENSION_PRESENCE_UNPROVEN/)

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

test("production page worker claims only after explicit canonical profile binding", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const initialClaim = page.match(
    /const startInitialProductionClaim = \(\) => \{[\s\S]*?\n    \}/)?.[0] ?? ""
  assert.match(initialClaim, /!extensionReady/)
  assert.match(initialClaim, /!canonicalBindingStatusRead/)
  assert.match(initialClaim, /!canonicalDestinationBindingPresent/)
  assert.doesNotMatch(initialClaim, /!canonicalBindingReady/)
  assert.match(initialClaim, /!activeJobStatusReady/)
  assert.match(initialClaim, /initialAutoClaimStarted = true/)
  assert.match(initialClaim, /loadJobs\(undefined, "AUTO"\)/)
  assert.doesNotMatch(initialClaim, /CANARY_ID|previous|capturePostAccepted/)
  assert.match(page, /SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS/)
  assert.match(page, /LUNA_SHIPPING_ACTIVE_JOB_STATUS/)
  assert.match(page, /WORKER_IDLE_NO_ELIGIBLE_JOB/)
  assert.match(page, /productionAutoClaim: mode === "AUTO"/)
  assert.match(page, /await loadJobs\(undefined, "AUTO"\)/)
  const noBindingStatus = page.match(
    /if \(message\?\.type === "LUNA_CANONICAL_DESTINATION_STATUS"\)[\s\S]*?\n        \}/)?.[0] ?? ""
  assert.match(noBindingStatus, /canonicalBindingStatusRead = true/)
  assert.match(noBindingStatus, /CANONICAL_OPERATOR_BIND_REQUIRED/)
  assert.match(noBindingStatus, /startInitialProductionClaim\(\)/)
  assert.match(page, /Vincular perfil canónico US de Seller OS/)
})

test("exact LIVE target is isolated from the global queue and presentation", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
  "utf8")
  const exactGuard = page.match(
    /const loadJobs = async[\s\S]*?\n    \}/)?.[0] ?? ""
  const canary = page.match(
    /const beginCanary = \(\) => \{[\s\S]*?\n    \}/)?.[0] ?? ""
  const start = page.match(
    /const start = async \(\) => \{[\s\S]*?const wait/)?.[0] ?? ""
  const oosCompletion = page.match(
    /setStatus\("PRODUCTION_JOB_COMPLETED"\)[\s\S]*?await loadJobs\(undefined, "AUTO"\)/)?.[0] ?? ""

  assert.match(exactGuard, /hasExactLiveTarget/)
  assert.match(exactGuard, /LUNA_EXACT_LIVE_TARGET_GLOBAL_QUEUE_FORBIDDEN/)
  assert.match(canary, /hasExactLiveTarget/)
  assert.match(start, /if \(!hasExactLiveTarget\)/)
  assert.match(oosCompletion, /if \(mode === "LIVE"\)[\s\S]*?return/)
  assert.match(page, /!exactLiveCandidateId \|\| event\.candidateId !== exactLiveCandidateId/)
  assert.match(page, /hasExactLiveTarget && !progressMatches/)
  assert.match(page, /hasExactLiveTarget[\s\S]*?setIgnoredOutOfScope\(true\)[\s\S]*?return/)
  assert.match(page, /exactJob\.identity\.lunaProductId/)
  assert.match(page, /exactJob\.identity\.lunaVariantId/)
  assert.match(page, /exactJob\.identity\.supplierSku/)
  assert.match(page, /TARGET_SCOPE=EXACT_LIVE/)
  assert.match(page, /\$\{liveTarget\.sourceSku\}_CAPTURE_ATTEMPTS=/)
  assert.match(page, /message\.capture\?\.lunaProductId === requestedLiveTarget\.lunaProductId/)
  assert.match(page, /message\.capture\?\.lunaVariantId === requestedLiveTarget\.lunaVariantId/)
  assert.match(page, /message\.capture\?\.supplierSku === requestedLiveTarget\.sourceSku/)
  assert.match(page, /SHIPPING=\$\{results\.length \? "AVAILABLE" : "UNPROVEN"\}/)
  assert.match(page, /ECONOMICS=\$\{results\.at\(-1\)\?\.economicsStatus \?\? "UNPROVEN"\}/)
  assert.match(page, /!liveTarget \? <button[\s\S]*?Ejecutar canary final/)
  assert.match(page, /!hasExactLiveTarget && params\.get\("runShipping"\)/)
  assert.match(page, /const EXPECTED_EXTENSION_VERSION = "1\.0\.47"/)
  assert.match(page, /requireDurableDispatchAck: mode === "LIVE"/)
  assert.match(page, /LIVE_LISTING_DISPATCH_PENDING_DURABLE_ACK/)
  assert.match(page, /event\.state === "JOB_DISPATCHED"/)
  assert.match(page, /persistRuntimeTraceSnapshot\(snapshot\)/)
  assert.match(page, /type: DURABLE_DISPATCH_ACK/)
  assert.match(page, /message\?\.type === JOB_DISPATCH_ACK/)
  assert.match(page, /setLiveCaptureAttempts\(\(current\) => current \+ 1\)/)
  assert.match(page, /if \(!exactLiveJobMatches\(candidate\)\)/)
  assert.match(page, /for \(const event of replay\) acceptRuntimeTraceEvent\(event\)/)
  assert.match(page, /loadJobs\(undefined, "AUTO"\)/,
    "global production worker remains available outside exact-target mode")
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
      getManifest: () => ({ version: "1.0.47" }),
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
    sender: { url: "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture" },
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

  const productSender = { tab: { id: 7 }, frameId: 0, url: createdTabs[0] }
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_PROGRESS",
    state: "PRODUCT_OOS_CONFIRMED",
    captureSessionId: pageCanaryJob.captureSessionId,
    candidateId: pageCanaryJob.identity.candidateId,
    productOosConfirmed: true,
    productPageStockStatus: "FRESH_OUT_OF_STOCK" }, productSender, () => {})
  runtimeMessageListener({ type: "LUNA_SHIPPING_JOB_RESULT", success: true,
    terminalDecision: "REJECT_STOCK", capture: {
      captureSessionId: pageCanaryJob.captureSessionId,
      nonce: pageCanaryJob.nonce,
      candidateId: pageCanaryJob.identity.candidateId,
      lunaProductId: pageCanaryJob.identity.lunaProductId,
      lunaVariantId: pageCanaryJob.identity.lunaVariantId,
      supplierSku: pageCanaryJob.identity.supplierSku,
      quantity: 1, productPageStockStatus: "FRESH_OUT_OF_STOCK",
      productOosConfirmed: true, soldOutMarker: true,
      outOfStockMarker: false,
      observedAt: "2026-08-24T17:59:00.000Z",
      acquisitionMethod: "NORMAL_CHROME_EXTENSION_VISIBLE_PRODUCT_PAGE",
      evidenceDigest: `sha256:${"a".repeat(64)}`,
    } }, productSender, () => {})
  const stockResult = posted.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_RESULT")
  assert.equal(stockResult?.terminalDecision, "REJECT_STOCK")
  assert.equal(stockResult?.capture?.productOosConfirmed, true)
  messageListener({ type: "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT",
    candidateId: pageCanaryJob.identity.candidateId, success: true,
    terminalDecision: "REJECT_STOCK" })
  const terminalStates = posted.map((entry) => entry.event?.state).filter(Boolean)
  assertOrderedSubsequence(terminalStates, ["PRODUCT_OOS_CONFIRMED",
    "STOCK_EVIDENCE_RECONCILED", "REJECTED_STOCK",
    "PRODUCTION_JOB_COMPLETED", "AUTO_NEXT", "PASS"])
  messageListener({ type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS" })
  assert.equal(posted.at(-1)?.active, false)
})

test("exact LIVE dispatch is durably acknowledged before navigation and recovers the same job", async () => {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  let connectListener = null
  const createdTabs = []
  const chrome = {
    runtime: {
      id: LUNA_SHIPPING_EXTENSION_ID,
      getManifest: () => ({ version: "1.0.47" }),
      onInstalled: { addListener() {} },
      onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener() {} },
    },
    tabs: {
      create: async ({ url }) => { createdTabs.push(url); return { id: 17 } },
      update: async () => ({}), onRemoved: { addListener() {} },
    },
  }
  runInNewContext(background, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  const session = issueLunaShippingCaptureSessionV1({
    secret: "test-only-secret-not-a-production-value".repeat(2),
    candidateId: job().identity.candidateId,
    snapshotDigest: `sha256:${"c".repeat(64)}`,
    now: NOW,
  })
  const exactJob = { ...job(), ...session }
  const connect = () => {
    const posted = []
    let onMessage = null
    let onDisconnect = null
    connectListener({
      name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
      sender: { url: "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture" },
      disconnect() {}, postMessage(value) { posted.push(value) },
      onMessage: { addListener(listener) { onMessage = listener } },
      onDisconnect: { addListener(listener) { onDisconnect = listener } },
    })
    return { posted, onMessage, disconnect: () => onDisconnect?.() }
  }
  const first = connect()
  first.onMessage({ type: "START_SHIPPING_JOB", job: exactJob,
    requireDurableDispatchAck: true })
  await waitForTestCondition(() => first.posted.some((entry) =>
    entry.event?.state === "JOB_DISPATCHED"))
  assert.equal(createdTabs.length, 0,
    "exact job must not navigate before durable Seller OS acknowledgement")
  const dispatch = first.posted.find((entry) =>
    entry.event?.state === "JOB_DISPATCHED")?.event
  assert.equal(dispatch?.candidateId, exactJob.identity.candidateId)
  first.onMessage({ type: "SELLER_OS_LUNA_SHIPPING_DURABLE_DISPATCH_ACK",
    candidateId: exactJob.identity.candidateId, traceId: dispatch.traceId })
  await waitForTestCondition(() => first.posted.some((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_DISPATCH_ACK"))
  assert.equal(createdTabs.length, 1)
  const acknowledgement = first.posted.find((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_DISPATCH_ACK")
  assert.equal(acknowledgement?.durableDispatchAcknowledged, true)

  first.disconnect()
  const reconnected = connect()
  reconnected.onMessage({ type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS" })
  const recovered = reconnected.posted.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_ACTIVE_JOB_STATUS")
  assert.equal(recovered?.active, true)
  assert.equal(recovered?.job?.captureSessionId, exactJob.captureSessionId)
  assert.equal(recovered?.job?.identity?.candidateId,
    exactJob.identity.candidateId)
  assert.equal(recovered?.dispatchCompleted, true)
  assert.equal(recovered?.traceEvents?.some((entry) =>
    entry.state === "JOB_DISPATCHED"), true)
  reconnected.onMessage({ type: "SELLER_OS_LUNA_SHIPPING_DURABLE_DISPATCH_ACK",
    candidateId: exactJob.identity.candidateId, traceId: dispatch.traceId })
  assert.equal(reconnected.posted.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_DISPATCH_ACK")
    ?.durableDispatchAcknowledged, true)
  assert.equal(createdTabs.length, 1,
    "reconnect acknowledgement must reuse the same exact dispatch")
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
    document: { readyState: "complete", body: {},
      querySelector: (selector) => selector.includes('form[action')
        ? control.form : null,
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

test("positive product-page OOS markers reject before cart mutation while absence fails open", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const runtimeMessages = []
  let fetchCount = 0
  const variantField = { value: "", dispatchEvent() {} }
  const marker = {
    textContent: "SOLD OUT", value: "", parentElement: null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
  }
  const form = {
    textContent: "", value: "", parentElement: null,
    querySelector: (selector) => selector === '[name="id"]' ? variantField : null,
    querySelectorAll: () => [marker], closest: () => null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 200, height: 100 }),
  }
  const context = {
    URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, atob,
    AbortSignal, Event, crypto: webcrypto, Date, setInterval, clearInterval,
    setTimeout, clearTimeout, MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    __sellerOsLunaShippingCaptureAttachedV1: true,
    location: { hash: "", hostname: "www.lunaportex.com",
      pathname: "/products/exact-microcurrent-device",
      origin: "https://www.lunaportex.com", assign() {} },
    document: { readyState: "complete", body: {}, documentElement: {},
      querySelector: (selector) => selector.includes('form[action') ? form : null,
      querySelectorAll: () => [] },
    getComputedStyle: () => ({ display: "block", visibility: "visible",
      opacity: "1" }),
    chrome: { runtime: { onMessage: { addListener() {} },
      sendMessage(message) { runtimeMessages.push(message) } } },
    fetch: async () => {
      fetchCount += 1
      return { ok: true, headers: { get: () => null },
        text: async () => JSON.stringify({ id: job().identity.lunaProductId,
          variants: [{ id: job().identity.lunaVariantId,
            sku: job().identity.supplierSku, available: false }] }) }
    },
  }
  runInNewContext(content, context)
  await context.runProductStage(job())
  assert.equal(fetchCount, 1)
  assert.ok(runtimeMessages.some((message) =>
    message.state === "PRODUCT_OOS_CONFIRMED" &&
    message.productPageStockStatus === "FRESH_OUT_OF_STOCK"))
  const terminal = runtimeMessages.find((message) =>
    message.type === "LUNA_SHIPPING_JOB_RESULT")
  assert.equal(terminal?.terminalDecision, "REJECT_STOCK")
  assert.equal(terminal?.capture?.soldOutMarker, true)
  assert.equal(runtimeMessages.some((message) =>
    message.state === "ADD_TO_CART_ELEMENT_FOUND"), false)
  assert.equal(runtimeMessages.some((message) =>
    message.state === "ADD_TO_CART_CLICK_DISPATCHED"), false)

  marker.textContent = "Temporarily unavailable"
  assert.equal(context.positiveProductPageOosEvidence(job()), null)
  marker.textContent = "OUT OF STOCK"
  assert.equal(context.positiveProductPageOosEvidence(job())?.outOfStockMarker,
    true)
})

test("operator-bound canonical US profile is durable, private, immutable, and mismatch-safe", async () => {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  let connectListener = null
  let portMessage = null
  let stored = {}
  let storageWriteFails = false
  let failReadbackAfterWrite = false
  let pendingReadbackFailure = false
  let storageWriteCount = 0
  const posted = []
  const chrome = {
    runtime: {
      id: LUNA_SHIPPING_EXTENSION_ID, lastError: null,
      getManifest: () => ({ version: "1.0.47" }),
      onInstalled: { addListener() {} },
      onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener() {} },
    },
    tabs: {
      create: async () => ({ id: 7 }), update: async () => ({}),
      query() { throw new Error("OPERATOR_BIND_MUST_NOT_ENUMERATE_TABS") },
      sendMessage() { throw new Error("OPERATOR_BIND_MUST_NOT_READ_CHECKOUT_DOM") },
      onRemoved: { addListener() {} },
    },
    storage: { local: {
      get(_key, callback) {
        if (pendingReadbackFailure) {
          pendingReadbackFailure = false
          chrome.runtime.lastError = { message: "test-readback-failure" }
          callback({})
          chrome.runtime.lastError = null
          return
        }
        callback(stored)
      },
      set(value, callback) {
        storageWriteCount += 1
        if (storageWriteFails) {
          chrome.runtime.lastError = { message: "test-write-failure" }
          callback()
          chrome.runtime.lastError = null
          return
        }
        stored = { ...value }
        if (failReadbackAfterWrite) pendingReadbackFailure = true
        callback()
      },
    } },
    scripting: { executeScript: async () => [] },
    webNavigation: {
      onCommitted: { addListener() {} },
      onCompleted: { addListener() {} },
    },
  }
  runInNewContext(background, { chrome, crypto: webcrypto, URL, TextDecoder,
    TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout })
  connectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url:
      "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture" },
    disconnect() {},
    postMessage(value) { posted.push(value) },
    onMessage: { addListener(listener) { portMessage = listener } },
    onDisconnect: { addListener() {} },
  })
  const bootstrapJob = { ...job(), ...issueLunaShippingCaptureSessionV1({
    secret: "test-only-secret-not-a-production-value".repeat(2),
    candidateId: job().identity.candidateId,
    snapshotDigest: `sha256:${"e".repeat(64)}`,
    now: NOW,
  }) }

  const bind = async (bootstrapJob) => {
    const start = posted.length
    portMessage({ type: "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION",
      bootstrapJob })
    await waitForTestCondition(() => posted.slice(start).some((entry) =>
      entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT"))
    return posted.slice(start).findLast((entry) =>
      entry.type === "LUNA_CANONICAL_DESTINATION_BINDING_RESULT")
  }

  const first = await bind(bootstrapJob)
  assert.equal(first.success, true, JSON.stringify(first))
  assert.equal(first.operation, "BIND_CANONICAL_DESTINATION")
  assert.equal(first.canonicalDestinationBound, true)
  assert.equal(first.canonicalDestinationMatch, true)
  assert.equal(storageWriteCount, 1)
  const envelope = stored.sellerOsLunaCanonicalDestinationBindingV1
  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), {
    fingerprintVersion: "LUNA_CANONICAL_DESTINATION_PROFILE_SHA256_V1",
    canonicalDestinationFingerprint: bootstrapJob.destination.profileDigest,
    countryClass: "US",
    authorityClass: "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    evidenceClass: "SERVER_CANONICAL_DESTINATION_PROFILE_DIGEST",
    validationMethod: "EXACT_PROFILE_DIGEST_MATCH",
    boundAt: envelope.boundAt,
  })
  assert.match(envelope.boundAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(Object.keys(envelope).some((key) =>
    /address|street|city|postal|province|email|phone|credential|cookie/i
      .test(key)), false)
  assert.doesNotMatch(JSON.stringify(posted), /33487|Boca Raton/i)

  const exactReplay = await bind(bootstrapJob)
  assert.equal(exactReplay.success, true)
  assert.equal(exactReplay.operation, "VALIDATE_CANONICAL_DESTINATION")
  assert.equal(storageWriteCount, 1,
    "an existing binding is never overwritten")

  const mismatch = await bind({ ...bootstrapJob, destination: {
    ...bootstrapJob.destination, profileDigest: `sha256:${"b".repeat(64)}`,
  } })
  assert.equal(mismatch.success, false)
  assert.equal(mismatch.error, "CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
  assert.equal(mismatch.canonicalDestinationBound, true)
  assert.equal(mismatch.canonicalDestinationMatch, false)
  assert.equal(storageWriteCount, 1)
  assert.equal(stored.sellerOsLunaCanonicalDestinationBindingV1
    .canonicalDestinationFingerprint, bootstrapJob.destination.profileDigest)

  stored = {}
  storageWriteFails = true
  const writeFailure = await bind(bootstrapJob)
  assert.equal(writeFailure.error, "BIND_STORAGE_WRITE_FAILED")
  assert.equal(writeFailure.canonicalDestinationBound, false)
  storageWriteFails = false

  stored = {}
  failReadbackAfterWrite = true
  const readbackFailure = await bind(bootstrapJob)
  assert.equal(readbackFailure.error, "BINDING_STORAGE_READ_FAILED")
  assert.equal(readbackFailure.canonicalDestinationMatch, false)
  failReadbackAfterWrite = false

  assert.match(background,
    /CANONICAL_DESTINATION_EXPLICIT_OPERATOR_BIND_REQUIRED/)
  assert.doesNotMatch(background,
    /chrome\.storage\.(?:local|sync|session)\.(?:clear|remove)\(/)
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

test("canonical cart rate is destination-bound, single-option, and privacy-safe", async () => {
  const content = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/content.js",
    import.meta.url), "utf8")
  const requests = []
  let rates = [{ name: "Standard", price: "9.99", currency: "USD" }]
  const context = {
    URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, AbortSignal,
    Event, crypto, setInterval, clearInterval, setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    location: { hostname: "www.lunaportex.com", pathname: "/",
      origin: "https://www.lunaportex.com", assign() {} },
    document: { readyState: "complete", body: {}, querySelector: () => null,
      querySelectorAll: () => [], documentElement: { append() {} } },
    getComputedStyle: () => ({ display: "block", visibility: "visible",
      opacity: "1" }),
    chrome: { runtime: { sendMessage() {} } },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options })
      return { ok: true, status: 200, type: "basic",
        headers: { get: () => null },
        text: async () => JSON.stringify({ shipping_rates: rates }) }
    },
  }
  runInNewContext(content, context)
  const result = await context.canonicalCartShippingRate(job())
  assert.equal(result.shippingUsd, 9.99)
  assert.equal(result.selectedShippingStateProof, "SINGLE_CANONICAL_RATE")
  assert.equal(requests[0].options.credentials, "same-origin")
  const requested = new URL(requests[0].url)
  assert.equal(requested.pathname, "/cart/shipping_rates.json")
  assert.equal(requested.searchParams.get("shipping_address[country]"), "US")
  assert.equal(requested.searchParams.get("shipping_address[province]"), "FL")
  assert.equal(requested.searchParams.get("shipping_address[zip]"), "33487")
  assert.equal(Object.hasOwn(requests[0].options, "body"), true)
  assert.equal(requests[0].options.body, undefined)

  rates = [
    { name: "Standard", price: "9.99", currency: "USD" },
    { name: "Express", price: "14.99", currency: "USD" },
  ]
  await assert.rejects(() => context.canonicalCartShippingRate(job()),
    /LUNA_SHIPPING_SERVICE_SELECTION_UNPROVEN/)
  rates = []
  await assert.rejects(() => context.canonicalCartShippingRate(job()),
    /LUNA_AUTHORITATIVE_SHIPPING_QUOTE_UNAVAILABLE/)
  await assert.rejects(() => context.canonicalCartShippingRate({ ...job(),
    destination: { ...job().destination, country: "CA" } }),
  /LUNA_CANONICAL_DESTINATION_QUERY_INVALID/)
  assert.doesNotMatch(JSON.stringify(requests),
    /street|address1|email|phone|Boca Raton/i)
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
  let autoBindFailure = null
  let autoBindRequestCount = 0
  let dropCheckoutMarkersAfterProfileValidation = false
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
          if (dropCheckoutMarkersAfterProfileValidation) selectors = () => []
          callback?.(destinationBinding ? { accepted: true,
            bindingStatus: "BINDING_PRESENT_VALID",
            binding: destinationBinding } : { accepted: true,
            bindingStatus: "NO_BINDING_PRESENT" })
          return
        }
        if (message.type === "AUTO_BIND_LUNA_CANONICAL_DESTINATION_V1") {
          autoBindRequestCount += 1
          if (autoBindFailure) {
            callback?.({ contractVersion:
              "LUNA_CANONICAL_DESTINATION_AUTO_BIND_V1", success: false,
            error: autoBindFailure })
            return
          }
          if (destinationBinding &&
              destinationBinding.canonicalDestinationFingerprint !==
                message.fingerprint) {
            callback?.({ contractVersion:
              "LUNA_CANONICAL_DESTINATION_AUTO_BIND_V1", success: false,
            error: "CANONICAL_US_SHIPPING_PROFILE_MISMATCH" })
            return
          }
          destinationBinding = destinationBinding ?? {
            fingerprintVersion: message.fingerprintVersion,
            canonicalDestinationFingerprint: message.fingerprint,
            countryClass: message.countryClass,
            boundAt: "2026-08-25T12:00:00.000Z",
          }
          callback?.({ contractVersion:
            "LUNA_CANONICAL_DESTINATION_AUTO_BIND_V1", success: true,
          canonicalDestinationBound: true, canonicalDestinationMatch: true,
          binding: destinationBinding })
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

  // A first production checkout waits for the selected profile and shipping
  // options to hydrate before establishing exactly one durable US binding.
  let profileHydrated = false
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? profileHydrated ? [shopShipTo] : []
    : selector.startsWith("[data-shipping-method]")
      ? profileHydrated ? [shopShippingSection] : []
      : selector.startsWith("h1,h2,h3")
        ? [visible({ textContent: "Ship to", getAttribute: () => null }),
          shopPayment, shopSubtotal, shopShipping, shopTotal, payNow]
        : shopSelectors(selector)
  assert.equal(destinationBinding, null)
  const delayedProfile = context.shopPayCanonicalShippingProfileStatus(
    activeCheckoutJob)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(autoBindRequestCount, 0)
  dropCheckoutMarkersAfterProfileValidation = true
  profileHydrated = true
  assert.equal(await delayedProfile, "MATCH")
  dropCheckoutMarkersAfterProfileValidation = false
  selectors = shopSelectors
  assert.equal(autoBindRequestCount, 1)
  const autoBindRequest = runtimeMessages.findLast((message) =>
    message.type === "AUTO_BIND_LUNA_CANONICAL_DESTINATION_V1")
  assert.equal(autoBindRequest?.contractVersion,
    "LUNA_CANONICAL_DESTINATION_AUTO_BIND_V1")
  assert.equal(autoBindRequest?.destinationUnambiguous, true)
  assert.equal(autoBindRequest?.acceptedUsDestination, true)
  assert.equal(autoBindRequest?.shippingAddressAccepted, true)
  assert.equal(autoBindRequest?.shippingOptionsDetected, true)
  assert.match(autoBindRequest?.fingerprint ?? "", /^sha256:[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(autoBindRequest),
    /Private Recipient|Private Street|33487|email|phone|authorization/i)
  assert.equal(paymentClicked, false)

  // A valid existing binding remains authoritative and is not rewritten.
  const firstAutoBinding = { ...destinationBinding }
  assert.equal(await context.shopPayCanonicalShippingProfileStatus(
    activeCheckoutJob), "MATCH")
  assert.equal(autoBindRequestCount, 1)
  assert.deepEqual(destinationBinding, firstAutoBinding)

  // A pre-existing different fingerprint fails closed and never auto-binds.
  destinationBinding = { ...firstAutoBinding,
    canonicalDestinationFingerprint: `sha256:${"d".repeat(64)}` }
  assert.equal(await context.shopPayCanonicalShippingProfileStatus(
    activeCheckoutJob), "MISMATCH")
  assert.equal(autoBindRequestCount, 1)
  destinationBinding = firstAutoBinding

  // Positive non-US or ambiguous Ship-to evidence cannot create a binding.
  const nonUsShipTo = visible({
    textContent: "Ship to Private Recipient Toronto ON M5V 2T6 Canada",
    getAttribute: () => null,
  })
  destinationBinding = null
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [nonUsShipTo] : selector.startsWith("h1,h2,h3")
      ? [nonUsShipTo, shopShippingSection, shopPayment, shopSubtotal,
        shopShipping, shopTotal, payNow] : shopSelectors(selector)
  await assert.rejects(() => context.shopPayCanonicalShippingProfileStatus(
    activeCheckoutJob), /BIND_COUNTRY_CLASS_UNPROVEN/)
  assert.equal(autoBindRequestCount, 1)
  const secondUsShipTo = visible({
    textContent: "Ship to Other Recipient 999 Other Street CA 90210",
    getAttribute: () => null,
  })
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [shopShipTo, secondUsShipTo] : selector.startsWith("h1,h2,h3")
      ? [shopShipTo, secondUsShipTo, shopShippingSection, shopPayment,
        shopSubtotal, shopShipping, shopTotal, payNow]
      : shopSelectors(selector)
  let ambiguousAutoBind = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "BIND",
  }, {}, (value) => { ambiguousAutoBind = value }), true)
  await waitForTestCondition(() => ambiguousAutoBind !== null)
  assert.equal(ambiguousAutoBind?.success, false)
  assert.equal(ambiguousAutoBind?.error, "BIND_SHIP_TO_AMBIGUOUS")
  assert.equal(autoBindRequestCount, 1)

  // A visible destination without an accepted shipping option is not enough
  // to bind; the browser-local execution fails closed without leaking it.
  selectors = (selector) => selector.startsWith("[data-shipping-address]")
    ? [shopShipTo] : selector.startsWith("[data-shipping-method]")
      ? [] : selector.startsWith("h1,h2,h3")
        ? [shopShipTo, shopPayment, shopSubtotal, shopShipping, shopTotal,
          payNow] : shopSelectors(selector)
  let unavailableProfile = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "BIND",
  }, {}, (value) => { unavailableProfile = value }), true)
  await waitForTestCondition(() => unavailableProfile !== null)
  assert.equal(unavailableProfile?.success, false)
  assert.equal(unavailableProfile?.error,
    "CANONICAL_US_SHIPPING_PROFILE_VALIDATION_UNAVAILABLE")

  // Durable write and readback failures are terminal; neither is converted
  // into an unavailable profile or a zero-value shipping quote.
  selectors = shopSelectors
  for (const failure of ["BIND_STORAGE_WRITE_FAILED",
    "BIND_STORAGE_READBACK_FAILED"]) {
    destinationBinding = null
    autoBindFailure = failure
    await assert.rejects(() => context.shopPayCanonicalShippingProfileStatus(
      activeCheckoutJob), new RegExp(failure))
  }
  autoBindFailure = null
  destinationBinding = firstAutoBinding
  assert.equal(paymentClicked, false)

  let bindingResponse = null
  assert.equal(contentRuntimeListener({
    type: "BIND_CANONICAL_DESTINATION_EXECUTE_V1",
    contractVersion: "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1",
    operation: "BIND",
  }, {},
  (value) => { bindingResponse = value }), true)
  await waitForTestCondition(() => bindingResponse !== null)
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
  await waitForTestCondition(() => validationResponse !== null)
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
  await waitForTestCondition(() => mismatchResponse !== null)
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
  await waitForTestCondition(() => missingShipToProbe !== null)
  assert.equal(missingShipToProbe?.success, false)
  assert.equal(missingShipToProbe?.error, "BIND_SHIP_TO_NOT_FOUND")
  payNowAvailable = true
  selectors = shopSelectors
  let eligibilityResponse = null
  assert.equal(contentRuntimeListener({
    type: "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1",
    contractVersion: "LUNA_BIND_ELIGIBILITY_PROBE_V1",
  }, {}, (value) => { eligibilityResponse = value }), true)
  await waitForTestCondition(() => eligibilityResponse !== null)
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

  // A provisional zero summary cannot pass before the accepted profile and
  // its real shipping option/amount have hydrated.
  const provisionalShipping = visible({ textContent: "Shipping $0.00 USD" })
  const provisionalTotal = visible({ textContent: "Total $10.96 USD" })
  const provisionalSummary = visible({
    textContent: "Subtotal $10.96 USD Shipping $0.00 USD Total $10.96 USD",
    children: [shopSubtotal, provisionalShipping, provisionalTotal],
    matches: (selector) => selector.includes("data-order-summary"),
  })
  for (const row of provisionalSummary.children) row.parentElement =
    provisionalSummary
  let quoteHydrated = false
  selectors = (selector) => selector.includes('[data-testid*="line-item"')
    ? [shopLine]
    : selector.startsWith("h1,h2,h3")
      ? [shopShipTo, shopShippingSection, shopPayment, shopSubtotal,
        ...(quoteHydrated ? [shopShipping, shopTotal]
          : [provisionalShipping, provisionalTotal]), payNow]
      : selector.includes("data-order-summary") ||
          selector.startsWith("dt,th") || selector.startsWith("dt,dd,th")
        ? quoteHydrated
          ? [shopSummary, shopSubtotal, shopShipping, shopTotal]
          : [provisionalSummary, shopSubtotal, provisionalShipping,
            provisionalTotal]
        : selector.startsWith("[data-shipping-address]") ? [shopShipTo]
          : selector.startsWith("[data-shipping-method]")
            ? [shopShippingSection]
            : selector.includes("button") ? [payNow] : []
  let provisionalSettled = false
  const hydratedQuotePromise = context.checkoutShipping(job(), 10.96)
    .finally(() => { provisionalSettled = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(provisionalSettled, false)
  assert.equal(runtimeMessages.some((message) =>
    message.state === "CANONICAL_US_PROFILE_FOUND"), false)
  for (const row of shopSummary.children) row.parentElement = shopSummary
  quoteHydrated = true
  const hydratedQuote = await hydratedQuotePromise
  assert.equal(hydratedQuote.shippingUsd, 6.99)
  assert.equal(hydratedQuote.totalUsd, 17.95)

  runtimeMessages.length = 0
  selectors = shopSelectors
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
  const [page, route, server, migration, captureIdentityMigration] = await Promise.all([
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
    readFile(new URL(
      "../../supabase/migrations/20260826034133_seller_os_profitability_frontier_capture_identity_v1.sql",
      import.meta.url), "utf8"),
  ])
  assert.match(page, /const certificationAction = mode === "LIVE"/)
  assert.match(page, /"certify_live_listing_capture" : "certify_capture"/)
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
  assert.match(server,
    /writeOutcome !== "CREATED" && writeOutcome !== "IDEMPOTENT_SUCCESS"/)
  const outcomeIndex = server.indexOf("const writeOutcome")
  const readbackIndex = server.indexOf(
    '"get_seller_os_latest_profitability_frontiers_v1"', outcomeIndex)
  const acceptedIndex = server.indexOf("capturePostAccepted: true", outcomeIndex)
  const economicsIndex = server.indexOf("economics: certified.economics", outcomeIndex)
  assert.ok(outcomeIndex > -1 && readbackIndex > outcomeIndex)
  assert.ok(acceptedIndex > readbackIndex && economicsIndex > readbackIndex)
  assert.match(captureIdentityMigration,
    /SELLER_OS_PROFITABILITY_FRONTIER_CAPTURE_ID_V1/)
  assert.match(captureIdentityMigration,
    /SELLER_OS_PROFITABILITY_FRONTIER_REPLAY_CONFLICT/)
  assert.match(migration, /SELLER_OS_PROFITABILITY_FRONTIER_APPEND_ONLY/)
  assert.doesNotMatch(server + route + page,
    /create table|alter table|create migration/i)
})

test("Luna Shipping uses dedicated-preprod admin authority without the Listing AI Preview gate", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-shipping-capture/route.ts",
    import.meta.url), "utf8")
  assert.doesNotMatch(route, /authorizeListingAiRequest/)
  assert.doesNotMatch(route,
    /getListingAiConfiguration|LISTING_AI_PREVIEW_STAGING_REQUIRED/)
  assert.match(route, /validateAdminApiRequest\(req\)/)
  assert.match(route, /!validation\.ok \|\| !validation\.userId/)
  assert.match(route, /LUNA_SHIPPING_ADMIN_REQUIRED/)
  assert.match(route, /getEbaySellerAccountScopeConfiguration\(\)/)
  assert.match(route, /if \(!account\.accountKey\)/)
  assert.match(route, /LUNA_SHIPPING_ACCOUNT_REQUIRED/)
  assert.match(route, /SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION/)
  assert.match(route, /!boundary\.dedicatedPreprod\.certified/)
  assert.match(route, /boundary\.isProductionRuntime/)
  assert.match(route, /LUNA_SHIPPING_DEDICATED_PREPROD_REQUIRED/)
  const authorization = route.indexOf(
    "authorizeLunaShippingCaptureRequest(req)")
  const bodyRead = route.indexOf("const body = await listingAiJson(req)")
  const canonicalBootstrap = route.indexOf(
    'body.purpose === "CANONICAL_BIND_BOOTSTRAP"')
  assert.ok(authorization >= 0 && bodyRead > authorization &&
    canonicalBootstrap > bodyRead)

  const dedicatedPreprod = getEbayProRuntimeBoundary({
    vercelEnv: "production",
    vercelTargetEnv: "production",
    vercelSystem: "1",
    vercelProjectId: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
    vercelProjectProductionUrl: "imnova-seller-os-preprod.vercel.app",
    nodeEnv: "production",
    ebayProRuntime: "staging",
    supabaseUrl: "https://vsfthqydfrdzulldbfbe.supabase.co",
    pathname: "/api/admin/ebay/luna-shipping-capture",
    method: "POST",
  })
  assert.equal(dedicatedPreprod.boundaryClassification,
    SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION)
  assert.equal(dedicatedPreprod.dedicatedPreprod.certified, true)
  assert.equal(dedicatedPreprod.isProductionRuntime, false)

  const customerProduction = getEbayProRuntimeBoundary({
    vercelEnv: "production",
    vercelTargetEnv: "production",
    vercelSystem: "1",
    vercelProjectId: "prj_customer_production",
    vercelProjectProductionUrl: "customer-production.example",
    nodeEnv: "production",
    ebayProRuntime: "production_core",
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    pathname: "/api/admin/ebay/luna-shipping-capture",
    method: "POST",
  })
  assert.notEqual(customerProduction.boundaryClassification,
    SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION)
  assert.equal(customerProduction.dedicatedPreprod.certified, false)
  assert.equal(customerProduction.isProductionRuntime, true)

  const wrongAccount = getEbaySellerAccountScopeConfiguration({})
  assert.equal(wrongAccount.accountKey, null)
  assert.equal(wrongAccount.reason, "ACCOUNT_KEY_REQUIRED")
})

test("operator-bound US destination proof survives durable shipping readback exactly", async () => {
  const familyId = `market-family-v1:sha256:${"f".repeat(64)}`
  const lunaProductId = "9220835475680"
  const lunaVariantId = "48809646653664"
  const supplierSku = "ITEM3525"
  const candidateId = `sha256:${createHash("sha256").update(JSON.stringify({
    familyId, productId: lunaProductId, variantId: lunaVariantId,
    sku: supplierSku,
  })).digest("hex")}`
  const snapshotDigest = `sha256:${"1".repeat(64)}`
  const source = {
    opportunityCaseId: null,
    marketPriceEvidenceReference: "official-sold-evidence:test",
    marketPriceEvidenceDigest: `sha256:${"2".repeat(64)}`,
    ebayFeePolicyReference: "seller-os-ebay-fee-policy:test",
    economicPolicyReference: "seller-os-economic-policy:test",
    economicPolicyDigest: `sha256:${"3".repeat(64)}`,
    calculatedAt: new Date(NOW - 60_000).toISOString(),
    snapshotDigest,
    frontier: {
      familyId,
      lunaProductId,
      lunaVariantId,
      lunaSku: supplierSku,
      productFit: "STRONG",
      lunaUnitCost: 3.8,
      marketPriceMedian: 25.99,
      economicClassification: "ECONOMICALLY_PROMISING",
      shippingStatus: "UNPROVEN",
      nextBestEvidence: "ACTUAL_LUNA_SHIPPING",
      nextEvidenceValue: "HIGH",
      inputAuthority: { productFit: "DURABLY_PERSISTED_FACT" },
      evaluatedAt: new Date(NOW - 60_000).toISOString(),
      frontierDigest: `sha256:${"4".repeat(64)}`,
    },
  }
  const catalog = [{
    product_id: "catalog-cake-turntable",
    supplier_product_id: lunaProductId,
    supplier_variant_id: lunaVariantId,
    sku: supplierSku,
    title: "11in Revolving Plastic Cake Turntable Non-Slip Base",
    variant_title: "Default Title",
    price: 3.8,
    product_url: "https://www.lunaportex.com/products/11in-revolving-cake-turntable",
    captured_at: new Date(NOW - 60_000).toISOString(),
  }]
  let persistedFrontier = null
  function resultQuery(result) {
    const query = {
      select() { return query }, eq() { return query }, in() { return query },
      order() { return query }, limit() { return query },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }
    return query
  }
  const supabase = {
    from(table) {
      if (table === "ebay_same_day_pilot_runs") {
        return resultQuery({ data: [], error: null })
      }
      if (table === "market_radar_latest_variants") {
        return resultQuery({ data: catalog, error: null })
      }
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    async rpc(name, params) {
      if (name === "get_seller_os_latest_profitability_frontiers_v1") {
        return params.p_family_ids
          ? { data: { frontiers: [{ ...source,
            frontier: persistedFrontier }] }, error: null }
          : { data: { frontiers: [source] }, error: null }
      }
      if (name === "put_seller_os_profitability_frontier_v1") {
        persistedFrontier = params.p_frontier
        return { data: { outcome: "CREATED", frontierId: "cake-frontier" },
          error: null }
      }
      throw new Error(`UNEXPECTED_RPC:${name}`)
    },
  }
  const sessionSecret = "shipping-session-test-secret".repeat(3)
  const [authority] = await resolveLunaChromeShippingJobsV1({
    supabase, accountKey: "seller-os-test", candidateIds: [candidateId],
    sessionSecret, now: NOW,
  })
  assert.equal(authority.identity.candidateId, candidateId)
  const capturePost = {
    candidateId,
    lunaProductId,
    lunaVariantId,
    supplierSku,
    quantity: 1,
    subtotalUsd: 3.8,
    shippingUsd: 9.99,
    totalUsd: 13.79,
    currency: "USD",
    observedAt: new Date(NOW - 1_000).toISOString(),
    acquisitionMethod: "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    evidenceDigest: `sha256:${"5".repeat(64)}`,
    captureSessionId: authority.captureSessionId,
    nonce: authority.nonce,
    canonicalDestinationAuthority:
      "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    canonicalDestinationFingerprint: authority.destination.profileDigest,
    canonicalDestinationMatch: true,
    selectedShippingStateProof: "SINGLE_CANONICAL_RATE",
  }
  const result = await persistLunaChromeShippingCaptureV1({
    supabase, accountKey: "seller-os-test", capture: capturePost,
    sessionSecret, now: NOW,
  })
  const evidence = persistedFrontier.shippingCaptureEvidence
  assert.equal(result.capturePostAccepted, true)
  assert.equal(result.captureResultDurable, true)
  assert.equal(result.durableReadbackMatch, true)
  assert.equal(result.economics.status.startsWith("PROVEN_"), true)
  assert.equal(evidence.canonicalDestinationAuthority,
    "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1")
  assert.equal(evidence.canonicalDestinationCountryClass, "US")
  assert.equal(evidence.canonicalDestinationFingerprint,
    authority.destination.profileDigest)
  assert.equal(evidence.canonicalDestinationMatch, true)
  assert.equal(evidence.selectedShippingStateProof, "SINGLE_CANONICAL_RATE")
  assert.doesNotMatch(JSON.stringify(evidence),
    /address|postal|province|33487/i)
})

test("product-page OOS terminal reuses durable candidate authority and auto-nexts", async () => {
  const [page, route, server, content, background] = await Promise.all([
    readFile(new URL(
      "../../app/admin/ebay/luna-shipping-capture/page.tsx", import.meta.url),
    "utf8"),
    readFile(new URL(
      "../../app/api/admin/ebay/luna-shipping-capture/route.ts", import.meta.url),
    "utf8"),
    readFile(new URL("./ebay-luna-chrome-shipping-capture-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/content.js",
      import.meta.url), "utf8"),
    readFile(new URL(
      "../../tools/browser-extensions/luna-shipping-capture/background.js",
      import.meta.url), "utf8"),
  ])
  const identityIndex = content.indexOf(
    'progress(job, "PRODUCT_IDENTITY_VERIFIED")')
  const oosIndex = content.indexOf('progress(job, "PRODUCT_OOS_CONFIRMED"')
  const cartReadIndex = content.indexOf(
    'const original = cartSnapshot(await retry(() => request("/cart.js")))')
  assert.ok(identityIndex >= 0 && oosIndex > identityIndex &&
    cartReadIndex > oosIndex)
  assert.match(content, /PRODUCT_OOS_TEXT[\s\S]*SOLD\\s\+OUT/)
  assert.match(content, /PRODUCT_OOS_TEXT[\s\S]*OUT\\s\+OF\\s\+STOCK/)
  assert.match(route, /body\.action === "reject_product_oos"/)
  assert.match(route, /persistLunaProductPageOosV1/)
  assert.match(server, /from\("ebay_same_day_pilot_events"\)\.upsert/)
  assert.match(server, /productPageStockStatus: "FRESH_OUT_OF_STOCK"/)
  assert.match(server, /stored\.productPageStockStatus !== "FRESH_OUT_OF_STOCK"/)
  assert.match(server, /!freshOosCandidateIds\.has\(candidate\.candidateId\)/)
  assert.match(page, /message\.terminalDecision === "REJECT_STOCK"/)
  assert.match(page, /adminPost\("reject_product_oos"/)
  assert.match(page, /await loadJobs\(undefined, "AUTO"\)/)
  assert.match(background, /emitRuntimeTrace\("REJECTED_STOCK"\)/)
  assert.match(background, /emitRuntimeTrace\("AUTO_NEXT"\)/)
  assert.doesNotMatch(server + route,
    /create table|alter table|create scheduler|create queue/i)
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
