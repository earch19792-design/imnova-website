import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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
  certifyLunaChromeShippingVisibleCaptureV1,
  certifyLunaShippingCapturePostV1,
  LUNA_SHIPPING_EXTENSION_ID,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  normalizeLunaChromeShippingJobV1,
} = await import("./ebay-luna-chrome-shipping-capture-v1.ts")
const {
  issueLunaShippingCaptureSessionV1,
  verifyLunaShippingCaptureSessionV1,
} = await import("./ebay-luna-chrome-shipping-capture-server-v1.ts")

const NOW = Date.parse("2026-08-24T18:00:00.000Z")
const CANARY_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60"

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
  assert.equal(manifest.version, "1.0.13")
  assert.equal(manifest.name, "Seller OS — Luna Shipping Capture")
  assert.deepEqual(manifest.permissions, ["scripting", "webNavigation"])
  assert.deepEqual(manifest.host_permissions, [
    "https://lunaportex.com/*",
    "https://www.lunaportex.com/*",
    "https://account.lunaportex.com/*",
    "https://shop.app/*",
  ])
  assert.ok(manifest.content_scripts[0].matches.includes("https://shop.app/*"))
  assert.match(background, /EXTENSION_BUILD_VERSION = "1\.0\.13"/)
  assert.match(background, /SHOP_APP_HOST_PATTERN = "https:\/\/shop\.app\/\*"/)
  assert.match(background, /CHECKOUT_HOSTS\.has\("shop\.app"\)/)
  assert.match(content, /extensionBuildVersion: "1\.0\.13"/)
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"))
  assert.deepEqual(manifest.externally_connectable.matches, [
    "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/*",
  ])
  const key = Buffer.from(manifest.key, "base64")
  const id = [...createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("")
  assert.equal(id, LUNA_SHIPPING_EXTENSION_ID)
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
  assert.match(page, /EXPECTED_EXTENSION_VERSION = "1\.0\.13"/)
  assert.match(page, /shopAppManifestPermission !== true/)
  assert.match(page, /shopAppRuntimeAllowlist !== true/)
  assert.match(page, /runtime\.sendMessage\(EXTENSION_ID/)
  assert.ok(page.indexOf("await pingExtension") <
    page.indexOf("runtime.connect"))
  assert.match(page, /Ejecutar canary de shipping/)
  assert.match(page, /params\.get\("runShipping"\) === "1"/)
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
    "CHECKOUT_PAGE_DETECTED", "NORMAL_GUEST_CHECKOUT",
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
      getManifest: () => ({ version: "1.0.13" }),
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
  runInNewContext(background, { chrome, URL, TextDecoder, TextEncoder,
    Uint8Array, atob, btoa, setTimeout, clearTimeout })
  assert.equal(typeof connectListener, "function")
  let messageListener = null
  connectListener({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture" },
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
  messageListener({ type: "START_SHIPPING_JOB", job: pageCanaryJob })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(createdTabs.length, 1)
  assert.equal(posted.length, 0)
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

test("SHOP_APP_CHECKOUT_ALLOWLIST_REGRESSION_GUARD permits only an active bounded job", async () => {
  const background = await readFile(new URL(
    "../../tools/browser-extensions/luna-shipping-capture/background.js",
    import.meta.url), "utf8")
  let connectListener = null
  let runtimeMessageListener = null
  let firstPortMessage = null
  let firstPortDisconnect = null
  let secondPortMessage = null
  let navigationCommitted = null
  let navigationCompleted = null
  const progress = []
  const createdTabs = []
  const injected = []
  const activeJob = { ...job(), ...issueLunaShippingCaptureSessionV1({
    secret: "test-only-secret-not-a-production-value".repeat(2),
    candidateId: job().identity.candidateId,
    snapshotDigest: `sha256:${"e".repeat(64)}`,
    now: NOW,
  }) }
  const chrome = {
    runtime: {
      id: LUNA_SHIPPING_EXTENSION_ID,
      getManifest: () => ({ version: "1.0.13" }),
      onInstalled: { addListener() {} },
      onMessageExternal: { addListener() {} },
      onConnectExternal: { addListener(listener) { connectListener = listener } },
      onMessage: { addListener(listener) { runtimeMessageListener = listener } },
    },
    tabs: {
      create: async ({ url }) => { createdTabs.push(url); return { id: 11 } },
      update: async () => ({}),
      onRemoved: { addListener() {} },
    },
    scripting: { executeScript: async (value) => {
      injected.push(value)
      return [{ frameId: 0, result: undefined }]
    } },
    webNavigation: {
      onCommitted: { addListener(listener) { navigationCommitted = listener } },
      onCompleted: { addListener(listener) { navigationCompleted = listener } },
    },
  }
  runInNewContext(background, { chrome, URL, TextDecoder, TextEncoder,
    Uint8Array, atob, btoa, setTimeout, clearTimeout })
  const port = (slot) => ({
    name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
    sender: { url: "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/admin/ebay/luna-shipping-capture" },
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
  firstPortMessage({ type: "START_SHIPPING_JOB", job: activeJob })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const productSender = { tab: { id: 11 }, url: createdTabs[0] }
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
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_INJECTION_API_SUCCEEDED" &&
    entry.checkoutInjectionFrameId === 0))
  assert.ok(progress.some((entry) => entry.state === "CHECKOUT_SCRIPT_INJECTED"))
  assert.equal(injected.length, 1)
  assert.equal(injected[0].target.tabId, 11)
  assert.equal(injected[0].target.frameIds[0], 0)
  assert.equal(injected[0].target.allFrames, undefined)
  assert.equal(injected[0].world, "ISOLATED")
  assert.equal(injected[0].files[0], "content.js")
  let wrongFrameAck = null
  runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
    extensionBuildVersion: "1.0.13" },
    { tab: { id: 11 }, frameId: 1,
      url: "https://shop.app/pay/opaque-checkout" },
  (value) => { wrongFrameAck = value })
  assert.equal(wrongFrameAck?.accepted, false)
  assert.equal(wrongFrameAck?.error, "WRONG_FRAME_TARGET")
  let bootstrapAck = null
  runtimeMessageListener({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
    extensionBuildVersion: "1.0.13" },
    { tab: { id: 11 }, frameId: 0,
      url: "https://shop.app/pay/opaque-checkout" },
  (value) => { bootstrapAck = value })
  assert.equal(bootstrapAck?.accepted, true)
  assert.ok(progress.some((entry) =>
    entry.state === "CHECKOUT_SCRIPT_BOOTSTRAP_ACK" &&
    entry.checkoutScriptBootstrapAck === true))
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
  let shopPayPull = null
  runtimeMessageListener({ type: "GET_ACTIVE_LUNA_SHIPPING_JOB" },
    { tab: { id: 11 }, url: "https://shop.app/pay/opaque-checkout" },
  (value) => { shopPayPull = value })
  assert.equal(shopPayPull?.accepted, true)
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
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CART_CONFIRMATION",
    captureSessionId: activeJob.captureSessionId,
    originalCartSnapshot: [] }, productSender, () => {})
  runtimeMessageListener({ type: "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE",
    phase: "AWAITING_CHECKOUT_SHIPPING",
    captureSessionId: activeJob.captureSessionId, cartSubtotalUsd: 10.96 },
  { tab: { id: 11 }, url: "https://www.lunaportex.com/cart" }, () => {})
  navigationCommitted({ tabId: 11, frameId: 0,
    url: "https://shop.app/pay/second-checkout" })
  navigationCompleted({ tabId: 11, frameId: 0,
    url: "https://shop.app/pay/second-checkout" })
  await new Promise((resolve) => setTimeout(resolve, 2_600))
  const bootstrapFailure = progress.findLast((entry) =>
    entry.type === "LUNA_SHIPPING_JOB_RESULT")
  assert.equal(bootstrapFailure?.error,
    "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED")
  assert.equal(bootstrapFailure?.lastRuntimeState, "CHECKOUT_SCRIPT_INJECTED")
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
    chrome: { runtime: { sendMessage() {} } },
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
  const shopShipTo = visible({
    textContent: "Ship to United States FL 33487",
    getAttribute: () => null,
  })
  const shopShippingSection = visible({ textContent: "Shipping Standard",
    getAttribute: () => null })
  const shopPayment = visible({ textContent: "Payment",
    getAttribute: () => null })
  const payNow = visible({ textContent: "Pay Now",
    click() { paymentClicked = true } })
  const shopSelectors = (selector) => selector.includes(
    '[data-testid*="line-item"')
    ? [shopLine]
    : selector.startsWith("h1,h2,h3")
      ? [shopShipTo, shopShippingSection, shopPayment, payNow]
      : selector.startsWith("dt,th")
        ? [shopSubtotal, shopShipping, shopTotal]
        : selector.startsWith("[data-shipping-address]") ? [shopShipTo]
          : selector.startsWith("[data-shipping-method]")
            ? [shopShippingSection]
            : selector.includes("button") ? [payNow] : []
  selectors = shopSelectors
  assert.equal(context.checkoutHostClassification(), "SHOP_PAY_CHECKOUT_HOST")
  assert.equal(context.checkoutHostPermissionMatch(), true)
  assert.equal(context.checkoutPageClassification(),
    "NORMAL_CHECKOUT_WITH_SHIPPING")
  assert.equal(context.shopPayCanonicalShippingProfile(job()), true)
  const shopQuote = await context.checkoutShipping(job(), 10.96)
  assert.equal(shopQuote.subtotalUsd, 10.96)
  assert.equal(shopQuote.shippingUsd, 6.99)
  assert.equal(shopQuote.totalUsd, 17.95)
  assert.equal(shopQuote.shippingMethod, "Shipping Standard")
  assert.deepEqual([...context.moneyValues("Total USD $17.95")], [17.95])
  assert.deepEqual([...context.moneyValues("Total 17.95 USD")], [17.95])
  assert.equal(paymentClicked, false)

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
    ? [wrongShipTo] : shopSelectors(selector)
  assert.equal(context.shopPayCanonicalShippingProfile(job()), false)
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
  assert.match(server, /SHIPPING_DURABLY_PERSISTED/)
  assert.match(server, /capturePostAccepted: true/)
  assert.match(server, /captureResultDurable: true/)
  assert.match(server, /durableReadbackMatch: true/)
  assert.match(migration, /SELLER_OS_PROFITABILITY_FRONTIER_APPEND_ONLY/)
  assert.doesNotMatch(server + route + page,
    /create table|alter table|create migration/i)
})

test("existing eBay Product Research extension remains a separate boundary", async () => {
  const manifest = JSON.parse(await readFile(new URL(
    "../../tools/browser-extensions/ebay-product-research-capture/manifest.json",
    import.meta.url), "utf8"))
  assert.equal(manifest.name, "Seller OS — eBay Product Research Capture")
  assert.ok(manifest.host_permissions.every((entry) => !entry.includes("lunaportex")))
})
