"use strict"

const checkoutBootstrapAckPromise = new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage({ type: "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK",
      extensionBuildVersion: "1.0.28" },
      (response) => {
        const runtimeUnavailable = Boolean(chrome.runtime.lastError)
        resolve(!runtimeUnavailable && response?.accepted === true)
      })
  } catch { resolve(false) }
})

const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const JOB_RESULT = "LUNA_SHIPPING_JOB_RESULT"
const GET_ACTIVE_JOB = "GET_ACTIVE_LUNA_SHIPPING_JOB"
const JOB_PROGRESS = "LUNA_SHIPPING_JOB_PROGRESS"
const JOB_RUNTIME_FAILURE = "LUNA_SHIPPING_JOB_RUNTIME_FAILURE"
const SET_ACTIVE_JOB_PHASE = "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE"
const GET_CANONICAL_DESTINATION_BINDING =
  "GET_LUNA_CANONICAL_DESTINATION_BINDING"
const BIND_CANONICAL_DESTINATION = "BIND_LUNA_CANONICAL_DESTINATION"
const PROBE_CANONICAL_DESTINATION = "PROBE_LUNA_CANONICAL_DESTINATION"
const BIND_ELIGIBILITY_PROBE =
  "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1"
const VALIDATE_CANONICAL_DESTINATION = "VALIDATE_LUNA_CANONICAL_DESTINATION"
const DESTINATION_FINGERPRINT_VERSION =
  "LUNA_SHOP_PAY_DESTINATION_SHA256_V1"
const CART_PHASE = "AWAITING_CART_CONFIRMATION"
const CHECKOUT_PHASE = "AWAITING_CHECKOUT_SHIPPING"
const ACQUISITION_METHOD = "NORMAL_CHROME_EXTENSION_VISIBLE_DOM"
const MAX_ATTEMPTS_PER_STEP = 2
const MAXIMUM_PRODUCT_JSON_BYTES = 256_000
const MAXIMUM_CART_ITEMS = 50
const STEP_TIMEOUT_MS = 15_000
const SHOP_PAY_DOM_TIMEOUT_MS = 20_000
const MONEY = /(?:\$\s*([0-9][0-9,]*(?:\.\d{2})?)|([0-9][0-9,]*(?:\.\d{2})?)\s*USD\b|\bUSD\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?))/gi

function exactProductUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      new Set(["lunaportex.com", "www.lunaportex.com"]).has(url.hostname) &&
      /^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/.test(url.pathname) &&
      !url.username && !url.password && !url.port ? url : null
  } catch { return null }
}

function jobValidationReason(value) {
  const job = value && typeof value === "object" ? value : {}
  const identity = job.identity && typeof job.identity === "object"
    ? job.identity : {}
  const destination = job.destination && typeof job.destination === "object"
    ? job.destination : {}
  if (!("contractVersion" in job)) return "JOB_MISSING_FIELD:contractVersion"
  if (job.contractVersion !== CONTRACT) return "JOB_INVALID_CONTRACT_VERSION"
  for (const [field, owner] of [
    ["captureSessionId", job], ["nonce", job], ["productName", job],
    ["salePriceUsd", job], ["supplierCostUsd", job],
    ["candidateId", identity], ["canonicalProductUrl", identity],
    ["lunaProductId", identity], ["lunaVariantId", identity],
    ["supplierSku", identity], ["quantity", identity],
    ["profileId", destination], ["profileDigest", destination],
    ["country", destination], ["province", destination],
    ["postalCode", destination],
  ]) if (!(field in owner)) return `JOB_MISSING_FIELD:${
    owner === identity ? "identity." : owner === destination ? "destination." : ""}${field}`
  if (typeof job.captureSessionId !== "string" || typeof job.nonce !== "string" ||
      typeof job.productName !== "string" || typeof job.salePriceUsd !== "number" ||
      typeof job.supplierCostUsd !== "number") return "JOB_INVALID_TYPE:job"
  if (typeof identity.candidateId !== "string" ||
      typeof identity.canonicalProductUrl !== "string" ||
      typeof identity.lunaProductId !== "string" ||
      typeof identity.lunaVariantId !== "string" ||
      typeof identity.supplierSku !== "string" ||
      typeof identity.quantity !== "number") return "JOB_INVALID_TYPE:identity"
  if (typeof destination.profileId !== "string" ||
      typeof destination.profileDigest !== "string" ||
      typeof destination.country !== "string" ||
      typeof destination.province !== "string" ||
      typeof destination.postalCode !== "string") return "JOB_INVALID_TYPE:destination"
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(job.captureSessionId) || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(job.nonce)) {
    return "JOB_INVALID_TYPE:session"
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(identity.candidateId) ||
      !/^\d{8,24}$/.test(identity.lunaProductId) ||
      !/^\d{8,24}$/.test(identity.lunaVariantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/.test(identity.supplierSku)) {
    return "JOB_IDENTITY_MISMATCH:identity"
  }
  if (!Number.isInteger(identity.quantity) || identity.quantity < 1 ||
      identity.quantity > 20) return "JOB_INVALID_TYPE:identity.quantity"
  if (!exactProductUrl(identity.canonicalProductUrl)) {
    return "JOB_IDENTITY_MISMATCH:identity.canonicalProductUrl"
  }
  if (!/^[A-Z0-9_-]{3,80}$/.test(destination.profileId) ||
      !/^sha256:[0-9a-f]{64}$/.test(destination.profileDigest) ||
      destination.country !== "US" || !/^[A-Z]{2}$/.test(destination.province) ||
      !/^\d{5}(?:-\d{4})?$/.test(destination.postalCode) ||
      !Number.isFinite(job.salePriceUsd) || job.salePriceUsd <= 0 ||
      !Number.isFinite(job.supplierCostUsd) || job.supplierCostUsd < 0 ||
      job.productName.trim().length < 2 || job.productName.length > 240) {
    return "JOB_INVALID_TYPE:job"
  }
  return null
}

function validateJob(value) {
  return jobValidationReason(value) === null ? value : null
}

function getActiveJob() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")), 5_000)
    chrome.runtime.sendMessage({ type: GET_ACTIVE_JOB }, (response) => {
      clearTimeout(timeout)
      const job = validateJob(response?.job)
      const originalCartSnapshot = Array.isArray(response?.originalCartSnapshot)
        ? cartSnapshot(response.originalCartSnapshot) : null
      if (response?.accepted === true && job &&
          (![CART_PHASE, CHECKOUT_PHASE].includes(response?.phase) ||
            originalCartSnapshot !== null) &&
          (response?.phase !== CHECKOUT_PHASE ||
            Number.isFinite(response?.cartSubtotalUsd))) {
        resolve({ job, phase: response?.phase, originalCartSnapshot,
          cartSubtotalUsd: response?.cartSubtotalUsd })
      }
      else reject(new Error(typeof response?.error === "string" ? response.error
        : jobValidationReason(response?.job) ??
          ([CART_PHASE, CHECKOUT_PHASE].includes(response?.phase)
            ? "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN"
            : "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")))
    })
  })
}

function progress(job, state, details = {}) {
  const markerDetails = {}
  for (const field of ["shopPayMarkerOrderSummary", "shopPayMarkerProduct",
    "shopPayMarkerQuantity", "shopPayMarkerShipTo", "shopPayMarkerShipping",
    "shopPayMarkerSubtotal", "shopPayMarkerShippingAmount",
    "shopPayMarkerTotal", "shopPayMarkerShippingMethod",
    "shopPayMarkerPayment", "shopPayMarkerPayNow", "subtotalLabelFound",
    "subtotalAmountCandidateFound", "subtotalCurrencyFound", "subtotalParsed",
    "shippingLabelFound", "shippingAmountCandidateFound",
    "shippingCurrencyFound", "shippingParsed", "totalLabelFound",
    "totalAmountCandidateFound", "totalCurrencyFound", "totalParsed"]) {
    if (typeof details[field] === "boolean") markerDetails[field] = details[field]
  }
  chrome.runtime.sendMessage({ type: JOB_PROGRESS, state,
    ...(job ? { captureSessionId: job.captureSessionId,
      candidateId: job.identity.candidateId } : {}),
    ...(Number.isFinite(details.cartSubtotalUsd)
      ? { cartSubtotalUsd: details.cartSubtotalUsd } : {}),
    ...(Number.isFinite(details.subtotalUsd)
      ? { subtotalUsd: details.subtotalUsd } : {}),
    ...(Number.isFinite(details.shippingUsd)
      ? { shippingUsd: details.shippingUsd } : {}),
    ...(Number.isFinite(details.totalUsd)
      ? { totalUsd: details.totalUsd } : {}),
    ...(typeof details.checkoutHostClassification === "string"
      ? { checkoutHostClassification: details.checkoutHostClassification } : {}),
    ...(typeof details.checkoutNavigationHost === "string"
      ? { checkoutNavigationHost: details.checkoutNavigationHost } : {}),
    ...(typeof details.checkoutNavigationOrigin === "string"
      ? { checkoutNavigationOrigin: details.checkoutNavigationOrigin } : {}),
    ...(details.checkoutHostPermissionMatch === true
      ? { checkoutHostPermissionMatch: true } : {}),
    ...(typeof details.authSignal === "string"
      ? { authSignal: details.authSignal } : {}),
    ...(typeof details.authSignalSource === "string"
      ? { authSignalSource: details.authSignalSource } : {}),
    ...(new Set(["NORMAL_CHECKOUT_WITH_SHIPPING", "UNKNOWN_CHECKOUT_PAGE"])
      .has(details.checkoutPageClassification)
      ? { checkoutPageClassification: details.checkoutPageClassification } : {}),
    ...markerDetails })
}

function setActiveJobPhase(job, phase, details = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN")), 5_000)
    chrome.runtime.sendMessage({ type: SET_ACTIVE_JOB_PHASE,
      phase, captureSessionId: job.captureSessionId,
      ...(Array.isArray(details.originalCartSnapshot)
        ? { originalCartSnapshot: details.originalCartSnapshot } : {}),
      ...(Number.isFinite(details.cartSubtotalUsd)
        ? { cartSubtotalUsd: details.cartSubtotalUsd } : {}) }, (response) => {
      clearTimeout(timeout)
      if (response?.accepted === true && response?.phase === phase) resolve()
      else reject(new Error(typeof response?.error === "string" ? response.error
        : "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN"))
    })
  })
}

function reportRuntimeFailure(value) {
  const error = value instanceof Error ? value.message
    : "LUNA_SHIPPING_RUNTIME_FAILURE"
  chrome.runtime.sendMessage({ type: JOB_RUNTIME_FAILURE, error })
}

function send(success, job, value) {
  const capture = success ? value : {
    captureSessionId: job.captureSessionId,
    nonce: job.nonce,
    candidateId: job.identity.candidateId,
  }
  chrome.runtime.sendMessage({ type: JOB_RESULT, success, capture,
    ...(success ? {} : { error: typeof value === "string"
      ? value : "LUNA_SHIPPING_JOB_FAILED" }) })
}

function isVisible(element) {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== "none" && style.visibility !== "hidden" &&
    Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0
}

function visibleMatch(selectors) {
  return selectors.some((selector) => [...document.querySelectorAll(selector)]
    .some((element) => isVisible(element)))
}

function classifyPageAuth() {
  const challenge = visibleMatch([
    'iframe[src*="captcha" i]', '[data-cf-challenge]', '[id*="challenge" i]',
    'input[name*="verification" i]', 'input[autocomplete="one-time-code"]',
  ]) || [...document.querySelectorAll("h1,h2,p,label")].slice(0, 300)
    .some((element) => isVisible(element) &&
      /verify you are human|security challenge|verification code|captcha/i
        .test(element.textContent ?? ""))
  if (challenge) return "AUTH_CHALLENGE_PRESENT"
  const explicitLogin = location.hostname === "account.lunaportex.com" &&
      /\/(?:login|signin|auth|code|verify)(?:\/|$)/i.test(location.pathname) ||
    /\/account\/(?:login|signin)(?:\/|$)/i.test(location.pathname) ||
    visibleMatch(['input[type="password"]', 'form[action*="/account/login"]',
      'form[action*="/login"]'])
  return explicitLogin ? "AUTH_EXPLICITLY_FAILED" : "AUTH_NOT_YET_REQUIRED"
}

async function boundedJson(response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAXIMUM_PRODUCT_JSON_BYTES) throw new Error("LUNA_PRODUCT_JSON_TOO_LARGE")
  const raw = await response.text()
  if (new TextEncoder().encode(raw).byteLength > MAXIMUM_PRODUCT_JSON_BYTES) {
    throw new Error("LUNA_PRODUCT_JSON_TOO_LARGE")
  }
  return JSON.parse(raw)
}

async function request(path, options = {}) {
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin ||
      !new Set(["/cart.js", "/cart/clear.js", "/cart/add.js"])
        .has(url.pathname)) throw new Error("LUNA_CART_ENDPOINT_DENIED")
  let response
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "same-origin", redirect: "manual", cache: "no-store",
      headers: { Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    })
  } catch { throw new Error("LUNA_CART_TRANSPORT_UNAVAILABLE") }
  if (response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400) || response.status === 401) {
    throw new Error("LUNA_SESSION_EXPIRED")
  }
  if (response.status === 403) throw new Error("LUNA_AUTH_CHALLENGE_REQUIRED")
  if (!response.ok) throw new Error(`LUNA_CART_HTTP_${response.status}`)
  return boundedJson(response)
}

async function exactProduct(job) {
  const expected = exactProductUrl(job.identity.canonicalProductUrl)
  if (!expected || expected.pathname.replace(/\/$/, "") !==
      location.pathname.replace(/\/$/, "")) {
    throw new Error("LUNA_EXACT_PRODUCT_URL_MISMATCH")
  }
  const productUrl = new URL(`${expected.pathname.replace(/\/$/, "")}.js`,
    location.origin)
  const response = await fetch(productUrl, { method: "GET",
    credentials: "same-origin", redirect: "error", cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS) })
  if (!response.ok) throw new Error("LUNA_PRODUCT_IDENTITY_UNAVAILABLE")
  const product = await boundedJson(response)
  const variant = (Array.isArray(product.variants) ? product.variants : [])
    .find((entry) => String(entry?.id ?? "") === job.identity.lunaVariantId)
  if (String(product.id ?? "") !== job.identity.lunaProductId || !variant ||
      String(variant.sku ?? "") !== job.identity.supplierSku) {
    throw new Error("LUNA_EXACT_PRODUCT_IDENTITY_MISMATCH")
  }
  return { product, variant }
}

function boundedDomWait(probe, failureCode, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    let observer = null
    const finish = (value, error) => {
      if (settled) return
      settled = true
      observer?.disconnect()
      clearInterval(interval)
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(value)
    }
    const inspect = () => {
      try {
        const value = probe()
        if (value) finish(value)
      } catch (error) { finish(null, error) }
    }
    const interval = setInterval(inspect, 250)
    const timeout = setTimeout(() => finish(null, new Error(failureCode)),
      timeoutMs)
    if (document.documentElement) {
      observer = new MutationObserver(inspect)
      observer.observe(document.documentElement, { childList: true, subtree: true,
        attributes: true, attributeFilter: ["disabled", "aria-disabled", "value"] })
    }
    inspect()
  })
}

function productPageReady(job) {
  const expected = exactProductUrl(job.identity.canonicalProductUrl)
  return boundedDomWait(() => document.readyState !== "loading" && document.body &&
    expected && expected.pathname.replace(/\/$/, "") ===
      location.pathname.replace(/\/$/, "") &&
    document.querySelector('form[action*="/cart/add"]'),
  "PRODUCT_IDENTITY_DOM_EVIDENCE_NOT_FOUND")
}

function findVisibleAddToCartControl(job) {
  const semanticControls = [...document.querySelectorAll([
    'form[action*="/cart/add"] button[type="submit"]',
    'form[action*="/cart/add"] input[type="submit"]',
    'button[name="add"]', '[data-add-to-cart]', '[data-testid="add-to-cart"]',
    '.product-form__submit',
  ].join(","))]
  const exactTextControls = [...document.querySelectorAll(
    'button,input[type="submit"]')].filter((element) =>
    /^(?:ADD TO CART)$/i.test(
      `${element.textContent ?? ""} ${element.value ?? ""}`.trim()))
  const controls = [...new Set([...semanticControls, ...exactTextControls])]
  const control = controls.find((element) => isVisible(element))
  if (!control) return null
  const form = control.form ?? control.closest("form")
  const variantField = form?.querySelector('[name="id"]')
  if (!form || !variantField) {
    return { error: "ADD_TO_CART_SELECTOR_NOT_FOUND" }
  }
  variantField.value = job.identity.lunaVariantId
  variantField.dispatchEvent(new Event("input", { bubbles: true }))
  variantField.dispatchEvent(new Event("change", { bubbles: true }))
  if (String(variantField.value) !== job.identity.lunaVariantId) {
    return { error: "LUNA_EXACT_PRODUCT_IDENTITY_MISMATCH" }
  }
  if (control.disabled || control.getAttribute("aria-disabled") === "true") {
    return { error: "ADD_TO_CART_DISABLED" }
  }
  return { control }
}

async function visibleAddToCartControl(job) {
  let lastReason = "ADD_TO_CART_SELECTOR_NOT_FOUND"
  try {
    return await boundedDomWait(() => {
      const found = findVisibleAddToCartControl(job)
      if (!found) return null
      if (found.error) { lastReason = found.error; return null }
      return found.control
    }, "ADD_TO_CART_SELECTOR_NOT_FOUND")
  } catch {
    throw new Error(lastReason)
  }
}

function exactCartEvidence(cart, job) {
  const items = Array.isArray(cart?.items) ? cart.items : []
  if (items.length !== 1) throw new Error("LUNA_CART_EXPECTED_PRODUCT_NOT_FOUND")
  const item = items[0]
  if (String(item?.product_id ?? "") !== job.identity.lunaProductId ||
      String(item?.variant_id ?? item?.id ?? "") !== job.identity.lunaVariantId ||
      String(item?.sku ?? "") !== job.identity.supplierSku) {
    throw new Error("LUNA_CART_EXPECTED_PRODUCT_NOT_FOUND")
  }
  if (Number(item?.quantity) !== job.identity.quantity) {
    throw new Error("LUNA_CART_EXPECTED_QUANTITY_NOT_FOUND")
  }
  const minor = Number(item?.final_line_price ?? item?.line_price)
  if (!Number.isFinite(minor) || minor < 0) {
    throw new Error("LUNA_CART_SUBTOTAL_UNPROVEN")
  }
  return { item, subtotalUsd: Math.round(minor) / 100 }
}

function visibleCartEvidence(job, subtotalUsd) {
  const expected = exactProductUrl(job.identity.canonicalProductUrl)
  return boundedDomWait(() => {
    const rows = [...document.querySelectorAll([
      "[data-cart-item]", "[data-line-item]", ".cart-item", "tr.cart-item",
      "li.cart-item",
    ].join(","))]
    let exactProductRow = null
    for (const row of rows) {
      const links = [...row.querySelectorAll('a[href*="/products/"]')]
      const exactLink = links.some((link) => {
        try {
          const url = new URL(link.getAttribute("href") ?? link.href,
            location.origin)
          return expected && url.pathname.replace(/\/$/, "") ===
            expected.pathname.replace(/\/$/, "")
        } catch { return false }
      })
      const variantField = row.querySelector(
        `[data-quantity-variant-id="${job.identity.lunaVariantId}"],` +
        `[data-variant-id="${job.identity.lunaVariantId}"]`)
      if (exactLink && variantField) { exactProductRow = row; break }
    }
    if (!exactProductRow) return null
    const quantityField = exactProductRow.querySelector(
      'input[name="updates[]"],input.quantity__input,[data-cart-item-quantity]')
    const quantity = Number(quantityField?.value ??
      quantityField?.getAttribute?.("data-cart-item-quantity"))
    if (quantity !== job.identity.quantity) {
      throw new Error("LUNA_CART_EXPECTED_QUANTITY_NOT_FOUND")
    }
    const amounts = moneyValues(exactProductRow.textContent)
    if (!amounts.some((value) => Math.abs(value - subtotalUsd) <= 0.01)) {
      throw new Error("LUNA_CART_VISIBLE_SUBTOTAL_UNPROVEN")
    }
    return { subtotalUsd }
  }, "LUNA_CART_EXPECTED_PRODUCT_NOT_FOUND")
}

function cartSnapshot(cart) {
  const rows = Array.isArray(cart) ? cart
    : Array.isArray(cart?.items) ? cart.items : []
  if (rows.length > MAXIMUM_CART_ITEMS) throw new Error("LUNA_CART_SNAPSHOT_TOO_LARGE")
  return rows.map((item) => {
    const id = String(item?.variant_id ?? item?.id ?? "")
    const quantity = Number(item?.quantity)
    if (!/^\d{8,24}$/.test(id) || !Number.isInteger(quantity) ||
        quantity < 1 || quantity > 1_000) throw new Error("LUNA_CART_SNAPSHOT_UNPROVEN")
    return { id, quantity }
  })
}

function moneyValues(text) {
  const values = []
  for (const match of String(text ?? "").matchAll(MONEY)) {
    const value = Number((match[1] ?? match[2] ?? match[3] ?? "")
      .replace(/,/g, ""))
    if (Number.isFinite(value) && value >= 0) values.push(Math.round(value * 100) / 100)
  }
  return [...new Set(values)]
}

function firstVisible(root, selectors) {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (isVisible(element)) return element
    }
  }
  return null
}

function setField(element, value) {
  if (!element) return false
  element.value = value
  element.dispatchEvent(new Event("input", { bubbles: true }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}

async function retry(step) {
  let last = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STEP; attempt += 1) {
    try { return await step() } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw last ?? new Error("LUNA_SHIPPING_DOM_CONTRACT_CHANGED")
}

function checkoutHostClassification() {
  if (new Set(["lunaportex.com", "www.lunaportex.com"])
      .has(location.hostname)) return "LUNA_STOREFRONT_CHECKOUT_HOST"
  if (location.hostname === "account.lunaportex.com") {
    return "LUNA_ACCOUNT_HOST"
  }
  if (location.hostname === "shop.app") {
    return "SHOP_PAY_CHECKOUT_HOST"
  }
  return "UNSUPPORTED_CHECKOUT_HOST"
}

function checkoutHostPermissionMatch() {
  return checkoutHostClassification() !== "UNSUPPORTED_CHECKOUT_HOST"
}

function semanticMoneyLabelPattern(label) {
  if (label === "subtotal") return /^subtotal\b/i
  if (label === "shipping") return /^(?:shipping|delivery)\b/i
  if (label === "tax") return /^(?:tax|taxes)\b/i
  if (label === "discount") return /^(?:discount|discounts)\b/i
  return /^total\b/i
}

const SEMANTIC_MONEY_SELECTOR =
  'dt,dd,th,td,label,p,strong,b,h1,h2,h3,h4,h5,h6,' +
  '[role="rowheader"],[role="cell"],[role="row"],[role="term"],' +
  '[role="definition"],[role="group"],[role="status"],[aria-label],' +
  '[data-testid],li,section,footer,div,span'
const ORDER_SUMMARY_SELECTOR =
  '[data-order-summary],[data-testid*="order-summary" i],' +
  '[aria-label*="order summary" i],[role="table"],table,dl'

function visibleElementText(element) {
  const rendered = typeof element?.innerText === "string"
    ? element.innerText : element?.textContent ?? ""
  return String(rendered).replace(/[\s\u00a0]+/g, " ").trim()
}

function semanticMoneyText(element) {
  return `${element?.getAttribute?.("aria-label") ?? ""} ${
    element?.getAttribute?.("data-value") ?? ""} ${
    element?.value ?? ""} ${visibleElementText(element)}`
    .replace(/[\s\u00a0]+/g, " ").trim()
}

function semanticMoneyLabel(element) {
  const directText = Array.from(element?.childNodes ?? [])
    .filter((node) => node?.nodeType === 3)
    .map((node) => node.textContent ?? "").join(" ")
  const leafText = (element?.children?.length ?? 0) === 0
    ? visibleElementText(element) : ""
  const identities = [element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("data-testid"),
    element?.getAttribute?.("data-label"), element?.getAttribute?.("name"),
    directText || leafText].map(normalizeVisibleText).filter(Boolean)
  for (const label of ["subtotal", "shipping", "tax", "discount", "total"]) {
    const pattern = semanticMoneyLabelPattern(label)
    if (identities.some((identity) => pattern.test(identity) &&
        (label !== "total" || !/\bsubtotal\b/.test(identity)))) return label
  }
  return null
}

function elementAncestors(element, maximum = 16) {
  const result = []
  for (let current = element, depth = 0; current && depth < maximum;
    current = current.parentElement, depth += 1) result.push(current)
  return result
}

function orderSummaryRegion(snapshotRecords) {
  const labelsIn = (region) => new Set(snapshotRecords
    .filter((record) => elementWithin(record.element, region))
    .map((record) => record.label).filter(Boolean))
  const candidates = new Map()
  for (const record of snapshotRecords) {
    const element = record.element
    const explicit = element?.matches?.(ORDER_SUMMARY_SELECTOR) === true ||
      /\border summary\b/.test(normalizeVisibleText(
        `${element?.getAttribute?.("aria-label") ?? ""} ${
          element?.getAttribute?.("data-testid") ?? ""}`))
    if (explicit) candidates.set(element, true)
  }
  const subtotals = snapshotRecords.filter((record) => record.label === "subtotal")
  const totals = snapshotRecords.filter((record) => record.label === "total")
  for (const subtotal of subtotals) {
    for (const total of totals) {
      for (const ancestor of elementAncestors(subtotal.element)) {
        if (elementWithin(total.element, ancestor) && !candidates.has(ancestor)) {
          candidates.set(ancestor, false)
        }
      }
    }
  }
  const qualified = [...candidates].flatMap(([element, explicit]) => {
    const members = snapshotRecords.filter((record) =>
      elementWithin(record.element, element))
    const labels = labelsIn(element)
    const requiredLabelCount = ["subtotal", "shipping", "total"]
      .filter((label) => labels.has(label)).length
    const textLength = visibleElementText(element).length
    const sufficientlyScoped = explicit ? requiredLabelCount >= 2
      : requiredLabelCount === 3
    return sufficientlyScoped && members.length <= 360 && textLength <= 12_000
      ? [{ element, breadth: members.length, textLength,
        requiredLabelCount }] : []
  }).sort((left, right) => right.requiredLabelCount - left.requiredLabelCount ||
    left.breadth - right.breadth ||
    left.textLength - right.textLength)
  if (!qualified.length) return { region: null, ambiguous: false }
  const best = qualified[0]
  const disjoint = qualified.filter((candidate) =>
    candidate.element !== best.element &&
    !elementWithin(best.element, candidate.element) &&
    !elementWithin(candidate.element, best.element))
  return disjoint.length ? { region: null, ambiguous: true }
    : { region: best.element, ambiguous: false }
}

function createShopPayMoneyDomSnapshot() {
  const elements = [...new Set([...document.querySelectorAll(
    `${ORDER_SUMMARY_SELECTOR},${SEMANTIC_MONEY_SELECTOR}`)])]
    .filter((element) => isVisible(element)).slice(0, 800)
  const records = elements.map((element) => Object.freeze({ element,
    label: semanticMoneyLabel(element), text: semanticMoneyText(element) }))
  const resolved = orderSummaryRegion(records)
  return Object.freeze({ records: Object.freeze(records),
    region: resolved.region, orderSummaryAmbiguous: resolved.ambiguous })
}

function directUsdRowValue(value) {
  const text = String(value ?? "").replace(/[\s\u00a0]+/g, " ").trim()
  if (/^free$/i.test(text)) return { value: 0, explicitFree: true,
    currencyDetected: false }
  const match = text.match(/^(?:\$\s*([0-9][0-9,]*(?:\.\d{2})?)(?:\s*USD)?|\bUSD\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)|([0-9][0-9,]*(?:\.\d{2})?)\s*USD\b)$/i)
  if (!match) return null
  const parsed = Number((match[1] ?? match[2] ?? match[3] ?? "")
    .replace(/,/g, ""))
  return Number.isFinite(parsed) && parsed >= 0
    ? { value: Math.round(parsed * 100) / 100, explicitFree: false,
      currencyDetected: true } : null
}

function boundedLeafText(element, maximum = 48) {
  const leaves = []
  const visit = (current, depth) => {
    if (!current || depth > 8 || leaves.length >= maximum) return
    const children = Array.from(current.children ?? []).slice(0, maximum)
    if (!children.length) {
      const text = visibleElementText(current)
      if (text) leaves.push(text)
      return
    }
    for (const child of children) visit(child, depth + 1)
  }
  visit(element, 0)
  return leaves.join(" ").replace(/[\s\u00a0]+/g, " ").trim()
}

function boundMoneyRowValueCandidates(label, container) {
  const labelSource = label === "shipping" ? "(?:shipping|delivery)"
    : label === "tax" ? "(?:tax|taxes)"
      : label === "discount" ? "(?:discount|discounts)" : label
  const labelAtStart = new RegExp(`^${labelSource}\\b`, "i")
  const sources = [visibleElementText(container), boundedLeafText(container),
    container?.getAttribute?.("aria-label") ?? "",
    `${container?.getAttribute?.("data-label") ?? ""} ${
      container?.getAttribute?.("data-value") ?? ""}`]
    .map((value) => String(value).replace(/[\s\u00a0]+/g, " ").trim())
    .filter(Boolean)
  const visible = sources[0] ?? ""
  if (!labelAtStart.test(visible)) {
    for (const identity of [container?.getAttribute?.("aria-label"),
      container?.getAttribute?.("data-label")]) {
      const boundedIdentity = String(identity ?? "")
        .replace(/[\s\u00a0]+/g, " ").trim()
      const identityLabel = boundedIdentity.match(labelAtStart)?.[0]
      if (identityLabel) {
        sources.push(`${identityLabel} ${visible}`.trim())
      }
    }
  }
  return [...new Set(sources)].flatMap((source) => {
    const matched = source.match(new RegExp(
      `^${labelSource}\\b\\s*(?:[:–—-]\\s*)?(.*)$`, "i"))
    if (!matched) return []
    const valueText = matched[1].trim()
    return [{ valueText, parsed: directUsdRowValue(valueText),
      amountSignal: /(?:\$|\bUSD\b|\bfree\b)/i.test(valueText) }]
  })
}

function parseSemanticMoneyRowContainer(label, container) {
  const text = visibleElementText(container)
  const normalizedText = normalizeVisibleText(text)
  const nonMonetaryShippingContext = label === "shipping" &&
    /\b(?:free shipping|shipping (?:option|plan|method|section))\b/
      .test(normalizedText)
  if (nonMonetaryShippingContext) return { container, labelFound: true,
    rowContainerFound: false, amountCandidateFound: false,
    currencyDetected: false, explicitFree: false, explicitZeroAmount: false,
    parsedUsd: null, ambiguityReason: null }
  const candidates = boundMoneyRowValueCandidates(label, container)
  const parsedCandidates = candidates.filter((candidate) => candidate.parsed)
  const values = [...new Set(parsedCandidates.map((candidate) =>
    candidate.parsed.value))]
  const ambiguous = values.length > 1
  const parsedUsd = ambiguous || values.length !== 1 ? null : values[0]
  const explicitFree = parsedUsd === 0 && parsedCandidates.some((candidate) =>
    candidate.parsed.value === 0 && candidate.parsed.explicitFree)
  const explicitZeroAmount = parsedUsd === 0 && parsedCandidates.some(
    (candidate) => candidate.parsed.value === 0 &&
      !candidate.parsed.explicitFree)
  const currencyDetected = parsedCandidates.some((candidate) =>
    candidate.parsed.currencyDetected)
  return { container, labelFound: true, rowContainerFound: true,
    amountCandidateFound: candidates.some((candidate) =>
      candidate.amountSignal), currencyDetected,
    explicitFree, explicitZeroAmount, parsedUsd,
    ambiguityReason: ambiguous ? `SHOP_PAY_${label.toUpperCase()}_ROW_AMBIGUOUS`
      : null }
}

function semanticMoneyRow(label, snapshot = createShopPayMoneyDomSnapshot()) {
  const inRegion = snapshot.region ? snapshot.records.filter((record) =>
    elementWithin(record.element, snapshot.region)) : []
  const anchors = inRegion.filter((record) => record.label === label)
  if (!snapshot.region || snapshot.orderSummaryAmbiguous) return {
    labelFound: anchors.length > 0, rowContainerFound: false,
    amountCandidateFound: false, currencyDetected: false,
    explicitFree: false, explicitZeroAmount: false, parsedUsd: null,
    ambiguityReason: snapshot.orderSummaryAmbiguous
      ? "SHOP_PAY_ORDER_SUMMARY_AMBIGUOUS" : null,
  }
  const containers = []
  for (const anchor of anchors) {
    for (const container of elementAncestors(anchor.element, 10)) {
      if (!elementWithin(container, snapshot.region)) break
      const members = inRegion.filter((record) =>
        elementWithin(record.element, container))
      const labels = new Set(members.map((record) => record.label).filter(Boolean))
      if (labels.size !== 1 || !labels.has(label)) {
        if (container === snapshot.region) break
        continue
      }
      const parsed = parseSemanticMoneyRowContainer(label, container)
      if (parsed.amountCandidateFound) { containers.push(parsed); break }
      if (container === snapshot.region) break
    }
  }
  const unique = [...new Map(containers.map((entry) =>
    [entry.container, entry])).values()].filter((entry, index, all) =>
    !all.some((other, otherIndex) => otherIndex !== index &&
      elementWithin(other.container, entry.container)))
  if (unique.length > 1) return { labelFound: anchors.length > 0,
    rowContainerFound: true, amountCandidateFound: true,
    currencyDetected: unique.some((entry) => entry.currencyDetected),
    explicitFree: false, explicitZeroAmount: false, parsedUsd: null,
    ambiguityReason: `SHOP_PAY_${label.toUpperCase()}_ROW_AMBIGUOUS` }
  if (unique.length === 1) return unique[0]
  return { labelFound: anchors.length > 0, rowContainerFound: false,
    amountCandidateFound: false, currencyDetected: false,
    explicitFree: false, explicitZeroAmount: false, parsedUsd: null,
    ambiguityReason: null }
}

function semanticMoneyRows(snapshot = createShopPayMoneyDomSnapshot()) {
  return Object.freeze({ orderSummaryFound: Boolean(snapshot.region),
    orderSummaryAmbiguous: snapshot.orderSummaryAmbiguous,
    subtotal: semanticMoneyRow("subtotal", snapshot),
    shipping: semanticMoneyRow("shipping", snapshot),
    tax: semanticMoneyRow("tax", snapshot),
    discount: semanticMoneyRow("discount", snapshot),
    total: semanticMoneyRow("total", snapshot) })
}

function checkoutSummaryQuote(expectedSubtotal, rows = semanticMoneyRows()) {
  const subtotalUsd = rows.subtotal.parsedUsd
  const shippingUsd = rows.shipping.parsedUsd
  const taxUsd = rows.tax.parsedUsd
  const discountUsd = rows.discount.parsedUsd
  const totalUsd = rows.total.parsedUsd
  const authoritativeZero = shippingUsd !== 0 || rows.shipping.explicitFree ||
    rows.shipping.explicitZeroAmount
  if (!rows.orderSummaryFound || rows.orderSummaryAmbiguous ||
      [rows.subtotal, rows.shipping, rows.total]
        .some((row) => Boolean(row.ambiguityReason)) || !authoritativeZero ||
      ![subtotalUsd, shippingUsd, totalUsd].every(Number.isFinite) ||
      Math.abs(subtotalUsd - expectedSubtotal) > 0.01 ||
      Math.abs(subtotalUsd + shippingUsd +
        (Number.isFinite(taxUsd) ? taxUsd : 0) -
        (Number.isFinite(discountUsd) ? discountUsd : 0) - totalUsd) > 0.02) return null
  return { subtotalUsd, shippingUsd, totalUsd,
    shippingZeroAuthoritative: authoritativeZero,
    ...(Number.isFinite(taxUsd) ? { taxUsd } : {}),
    ...(Number.isFinite(discountUsd) ? { discountUsd } : {}),
    shippingMethod: visibleShippingMethod() }
}

function normalizeVisibleText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function checkoutExpectedLineMarkers(job) {
  const candidates = [...document.querySelectorAll(
    '[data-order-summary] [data-line-item], [data-testid*="line-item" i], ' +
    '[data-testid*="product" i], [class*="line-item" i], ' +
    '[class*="product" i], [role="listitem"], [role="row"], ' +
    '[aria-label], article, li')]
    .slice(0, 180)
  const normalizedName = normalizeVisibleText(job.productName)
  let product = false
  let quantity = false
  for (const element of candidates) {
    if (!isVisible(element)) continue
    const text = normalizeVisibleText(element.textContent)
    const quantityElement = element.querySelector?.(
      '[data-quantity], [data-testid*="quantity" i], [class*="quantity" i]')
    const quantityMatches = new RegExp(`(?:qty|quantity|×|x)\\s*${
      job.identity.quantity}(?:\\b|$)`, "i").test(element.textContent ?? "") ||
      Number(element.getAttribute?.("data-quantity")) === job.identity.quantity ||
      Number(String(quantityElement?.textContent ?? "").trim()) ===
        job.identity.quantity
    if (!text.includes(normalizedName)) continue
    product = true
    if (quantityMatches) quantity = true
  }
  return { product, quantity }
}

function checkoutExpectedLine(job) {
  const markers = checkoutExpectedLineMarkers(job)
  return markers.product && markers.quantity
}

function semanticCheckoutSignal(pattern) {
  return [...document.querySelectorAll(
    'h1,h2,h3,dt,th,label,[role="heading"],[role="rowheader"],' +
    '[aria-label],button,section,div,span')].slice(0, 260)
    .some((element) => isVisible(element) && pattern.test(
      normalizeVisibleText(`${element.getAttribute?.("aria-label") ?? ""} ${
        element.textContent ?? ""}`)))
}

function shopPayCheckoutPopulated(rows = semanticMoneyRows()) {
  if (location.hostname !== "shop.app") return false
  const shipTo = shopPayDestinationSnapshot().markerFound
  const shipping = semanticCheckoutSignal(/^shipping\b/) ||
    Number.isFinite(rows.shipping.parsedUsd)
  const paymentBoundary = semanticCheckoutSignal(/^(?:payment|pay now)\b/)
  const summary = [rows.subtotal, rows.shipping, rows.total]
    .every((row) => Number.isFinite(row.parsedUsd))
  return shipTo && shipping && paymentBoundary && summary
}

function shopPayMarkerSnapshot(rows = semanticMoneyRows(),
  destination = shopPayDestinationSnapshot()) {
  const subtotal = rows.subtotal.parsedUsd
  const shipping = rows.shipping.parsedUsd
  const total = rows.total.parsedUsd
  const shippingMethod = visibleShippingMethod()
  const firstRowAmbiguity = [rows.subtotal, rows.shipping, rows.total]
    .map((row) => row.ambiguityReason).find((reason) => typeof reason === "string")
  const shippingValueConflict = shipping === 0 &&
    !rows.shipping.explicitFree && !rows.shipping.explicitZeroAmount
  return {
    shopPayMarkerOrderSummary: rows.orderSummaryFound &&
      !rows.orderSummaryAmbiguous,
    orderSummaryAmbiguous: rows.orderSummaryAmbiguous,
    firstRowAmbiguity: firstRowAmbiguity ?? null,
    shippingValueConflict,
    shopPayMarkerProduct: false,
    shopPayMarkerQuantity: false,
    shopPayMarkerShipTo: destination.markerFound,
    shopPayMarkerShipping: rows.shipping.labelFound,
    shopPayMarkerSubtotal: rows.subtotal.labelFound,
    shopPayMarkerShippingAmount: Number.isFinite(shipping),
    shopPayMarkerTotal: rows.total.labelFound,
    shopPayMarkerShippingMethod: typeof shippingMethod === "string" &&
      shippingMethod.length > 0,
    shopPayMarkerPayment: semanticCheckoutSignal(/^payment\b/),
    shopPayMarkerPayNow: semanticCheckoutSignal(/^pay now\b/),
    subtotalLabelFound: rows.subtotal.labelFound,
    subtotalAmountCandidateFound: rows.subtotal.amountCandidateFound,
    subtotalCurrencyFound: rows.subtotal.currencyDetected,
    subtotalParsed: Number.isFinite(subtotal),
    shippingLabelFound: rows.shipping.labelFound,
    shippingAmountCandidateFound: rows.shipping.amountCandidateFound,
    shippingCurrencyFound: rows.shipping.currencyDetected,
    shippingParsed: Number.isFinite(shipping),
    totalLabelFound: rows.total.labelFound,
    totalAmountCandidateFound: rows.total.amountCandidateFound,
    totalCurrencyFound: rows.total.currencyDetected,
    totalParsed: Number.isFinite(total),
    ...(Number.isFinite(subtotal) ? { subtotalUsd: subtotal } : {}),
    ...(Number.isFinite(shipping) ? { shippingUsd: shipping } : {}),
    ...(Number.isFinite(total) ? { totalUsd: total } : {}),
  }
}

function shopPayMarkersSufficient(markers) {
  return markers.shopPayMarkerOrderSummary &&
    markers.shopPayMarkerShipping && markers.shopPayMarkerSubtotal &&
    markers.shopPayMarkerTotal && markers.subtotalParsed &&
    markers.shippingParsed && markers.totalParsed &&
    (markers.shopPayMarkerPayment || markers.shopPayMarkerPayNow)
}

function shopPayQuoteFailure(markers, quote, timedOut = false) {
  if (markers.orderSummaryAmbiguous) return "SHOP_PAY_ORDER_SUMMARY_AMBIGUOUS"
  if (!markers.shopPayMarkerOrderSummary) return timedOut
    ? "SHOP_PAY_ORDER_SUMMARY_NOT_FOUND" : "SHOP_PAY_DOM_NOT_READY"
  if (timedOut && !markers.subtotalLabelFound &&
      !markers.shippingLabelFound && !markers.totalLabelFound) {
    return "SHOP_PAY_DOM_READY_TIMEOUT"
  }
  if (typeof markers.firstRowAmbiguity === "string") {
    return markers.firstRowAmbiguity
  }
  if (markers.shippingValueConflict === true) {
    return "SHOP_PAY_SHIPPING_ROW_VALUE_CONFLICT"
  }
  for (const [name, row] of [["SUBTOTAL", {
    label: markers.subtotalLabelFound,
    amount: markers.subtotalAmountCandidateFound,
    parsed: markers.subtotalParsed,
  }], ["SHIPPING", {
    label: markers.shippingLabelFound,
    amount: markers.shippingAmountCandidateFound,
    parsed: markers.shippingParsed,
  }], ["TOTAL", {
    label: markers.totalLabelFound,
    amount: markers.totalAmountCandidateFound,
    parsed: markers.totalParsed,
  }]]) {
    if (!row.label) return `SHOP_PAY_${name}_LABEL_NOT_FOUND`
    if (!row.amount) return `SHOP_PAY_${name}_AMOUNT_NOT_FOUND`
    if (!row.parsed) return `SHOP_PAY_${name}_PARSE_FAILED`
  }
  if (!quote) return "SHOP_PAY_QUOTE_RECONCILIATION_FAILED"
  return "OTHER:SHOP_PAY_COMMERCIAL_BOUNDARY_INSUFFICIENT"
}

function visibleShippingMethod() {
  const candidates = [...document.querySelectorAll(
    '[data-shipping-method],[data-shipping-rate],' +
    '[data-testid*="shipping-method" i],[aria-label*="shipping" i],' +
    'input[name*="shipping_method" i],input[name*="shipping_rate" i]')]
    .slice(0, 80)
  for (const element of candidates) {
    if (!isVisible(element)) continue
    const root = element.closest?.('label,[role="row"],section,li,div') ?? element
    const normalized = String(root.textContent ?? element.getAttribute?.("aria-label") ?? "")
      .replace(MONEY, " ").replace(/\s+/g, " ").trim()
    if (/^[A-Za-z0-9][A-Za-z0-9 ._+()/-]{1,79}$/.test(normalized)) {
      return normalized
    }
  }
  return null
}

function checkoutPageClassification(shopPayRows = null) {
  const explicitChallenge = visibleMatch([
    'iframe[src*="captcha" i]', '[data-cf-challenge]',
    '[id*="challenge" i]', 'form[action*="/challenge" i]',
  ]) || [...document.querySelectorAll("h1,h2,p,label")].slice(0, 300)
    .some((element) => isVisible(element) &&
      /verify you are human|authentication required|security challenge/i
        .test(element.textContent ?? ""))
  if (explicitChallenge) return "EXPLICIT_AUTH_CHALLENGE"
  const sessionExpired = [...document.querySelectorAll("h1,h2,p")].slice(0, 300)
    .some((element) => isVisible(element) &&
      /session (?:has )?expired|please sign in again/i
        .test(element.textContent ?? ""))
  if (sessionExpired) return "SESSION_EXPIRED"
  const checkoutFields = visibleMatch([
    'input[name*="shipping" i]', 'select[name*="shipping" i]',
    'input[name*="address" i]', 'select[name*="address" i]',
    '[data-shipping-address]', '[data-delivery-address]',
  ])
  const contactFields = visibleMatch([
    'input[type="email"]', 'input[name*="contact" i]',
    '[data-contact-information]',
  ])
  const shippingOptions = visibleMatch([
    '[data-shipping-method]', '[data-shipping-rate]',
    'input[name*="shipping_method" i]', 'input[name*="shipping_rate" i]',
  ])
  const checkoutShell = /^\/checkouts?(?:\/|$)/.test(location.pathname) &&
    visibleMatch(['[data-checkout-root]', '[data-order-summary]',
      '[data-checkout-subtotal]', 'form[action*="/checkout"]'])
  const shopPayShell = location.hostname === "shop.app" &&
    (visibleMatch(['[data-order-summary]', '[data-testid*="order-summary" i]',
      '[data-testid*="subtotal" i]', '[data-testid*="shipping" i]']) ||
      shopPayCheckoutPopulated(shopPayRows ?? semanticMoneyRows()))
  if (location.hostname === "shop.app" &&
      (checkoutFields || shippingOptions || shopPayShell)) {
    return "NORMAL_CHECKOUT_WITH_SHIPPING"
  }
  if (checkoutFields) {
    return "NORMAL_CHECKOUT_WITH_SHIPPING_FORM"
  }
  if (contactFields) return "NORMAL_CHECKOUT_WITH_CONTACT_FORM"
  if (shippingOptions || checkoutShell) {
    return "NORMAL_GUEST_CHECKOUT"
  }
  const explicitLogin = location.hostname === "account.lunaportex.com" &&
      /\/(?:login|signin|auth|code|verify)(?:\/|$)/i.test(location.pathname) ||
    visibleMatch(['form[action*="/account/login"]',
      'form[action*="/login"] input[type="password"]'])
  return explicitLogin ? "EXPLICIT_LOGIN_PAGE" : "UNKNOWN_CHECKOUT_PAGE"
}

function irreversibleCommerceControl(element) {
  const value = `${element?.textContent ?? ""} ${element?.value ?? ""} ` +
    `${element?.getAttribute?.("name") ?? ""} ${element?.id ?? ""}`
  return /place order|complete order|submit order|pay now|payment|purchase/i
    .test(value)
}

function visibleCheckoutControl() {
  const controls = [...document.querySelectorAll(
    'button[name="checkout"],input[name="checkout"],a[href*="/checkout"],button,input[type="submit"]')]
  return controls.find((element) => isVisible(element) &&
    !irreversibleCommerceControl(element) &&
    /checkout|continue to checkout/i.test(
      `${element.textContent ?? ""} ${element.value ?? ""} ` +
      `${element.getAttribute?.("name") ?? ""}`)) ?? null
}

function requiredFieldMissing(selectors) {
  return selectors.some((selector) => [...document.querySelectorAll(selector)]
    .some((element) => isVisible(element) && element.required &&
      String(element.value ?? "").trim() === ""))
}

function canonicalShippingProfile(job) {
  if (location.hostname === "shop.app") return false
  const country = firstVisible(document, [
    'select[name*="country" i]', 'input[name*="country" i]',
    '[data-shipping-country]',
  ])
  const province = firstVisible(document, [
    'select[name*="province" i]', 'input[name*="province" i]',
    'select[name*="state" i]', 'input[name*="state" i]',
    '[data-shipping-province]',
  ])
  const postal = firstVisible(document, [
    'input[name*="postal" i]', 'input[name*="zip" i]',
    '[data-shipping-postal-code]',
  ])
  const shippingOptions = firstVisible(document, [
    '[data-shipping-method]', '[data-shipping-rate]',
    'input[name*="shipping_method" i]', 'input[name*="shipping_rate" i]',
  ])
  if (!country && !province && !postal && shippingOptions) return true
  if (!country || !province || !postal) return false
  if (requiredFieldMissing([
    'input[name*="address1" i]', 'input[name*="address_1" i]',
    'input[name*="city" i]', 'input[name*="first_name" i]',
    'input[name*="last_name" i]', 'input[type="email"]',
  ])) return false
  return setField(country, "US") &&
    setField(province, job.destination.province) &&
    setField(postal, job.destination.postalCode)
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY",
])

function elementWithin(element, ancestor) {
  if (!ancestor || ancestor === document) return true
  for (let current = element, depth = 0; current && depth < 24;
    current = current.parentElement, depth += 1) {
    if (current === ancestor) return true
  }
  return false
}

function usDestinationEvidence(value) {
  const text = String(value ?? "").replace(/[\s\u00a0]+/g, " ").trim()
  const normalized = normalizeVisibleText(text)
  const literalCountry = /\b(?:us|usa|united states|united states of america)\b/
    .test(normalized)
  const statePostal = [...text.matchAll(
    /\b([A-Z]{2})[\s,]+(\d{5}(?:-\d{4})?)\b/gi)]
    .some((match) => US_STATE_CODES.has(match[1].toUpperCase()))
  return { literalCountry, statePostal, isUs: literalCountry || statePostal }
}

function shipToBoundaryText(element) {
  return `${element?.getAttribute?.("aria-label") ?? ""} ${
    visibleElementText(element)}`.replace(/[\s\u00a0]+/g, " ").trim()
}

function shopPayDestinationSnapshot(job = null) {
  const direct = [...document.querySelectorAll(
    '[data-shipping-address],[data-delivery-address],' +
    '[data-testid*="ship-to" i],[aria-label*="ship to" i]')]
  const semantic = [...document.querySelectorAll(
    'h1,h2,h3,dt,dd,label,button,[role="group"],[role="region"],section,div,span')]
    .filter((element) => /\bship\s+to\b/i.test(shipToBoundaryText(element)))
  const roots = [...new Set([...direct, ...semantic])]
    .filter((element) => isVisible(element)).slice(0, 240)
  const byContainer = new Map()
  for (const root of roots) {
    let current = root
    for (let depth = 0; current && depth < 6; depth += 1) {
      const raw = shipToBoundaryText(current)
      const normalizedBoundary = normalizeVisibleText(raw)
      if (raw.length >= 8 && raw.length <= 1_000 &&
          /\bship\s+to\b/i.test(raw) &&
          !/\b(?:subtotal|total|payment|pay now)\b/.test(normalizedBoundary)) {
        const evidence = usDestinationEvidence(raw)
        if (evidence.isUs) {
          const normalized = raw.normalize("NFKC").toLowerCase()
            .replace(/\bship\s+to\b/g, " ")
            .replace(/[^a-z0-9]+/g, " ").trim()
          if (normalized.length >= 8 && normalized.length <= 900) {
            byContainer.set(current, { element: current, normalized,
              countryClass: "US" })
            break
          }
        }
      }
      current = current.parentElement
    }
  }
  const candidates = [...byContainer.values()].filter((candidate, index, all) =>
    !all.some((other, otherIndex) => otherIndex !== index &&
      elementWithin(other.element, candidate.element)))
  const unique = [...new Map(candidates.map((candidate) =>
    [candidate.normalized, candidate])).values()]
  if (unique.length !== 1) return { markerFound: roots.length > 0,
    ambiguous: unique.length > 1, normalized: null, countryClass: "UNPROVEN",
    canonicalFieldsMatch: false }
  const [{ normalized, countryClass }] = unique
  const expectedPostal = typeof job?.destination?.postalCode === "string"
    ? normalizeVisibleText(job.destination.postalCode) : null
  const expectedProvince = typeof job?.destination?.province === "string"
    ? normalizeVisibleText(job.destination.province) : null
  const canonicalFieldsMatch = (!expectedPostal || new RegExp(
    `\\b${expectedPostal.replace(/\s+/g, " ")}\\b`).test(normalized)) &&
    (!expectedProvince || new RegExp(`\\b${expectedProvince}\\b`).test(normalized))
  return { markerFound: true, ambiguous: false, normalized, countryClass,
    canonicalFieldsMatch }
}

function normalizedShopPayDestination(job = null) {
  const snapshot = shopPayDestinationSnapshot(job)
  return snapshot.normalized && snapshot.countryClass === "US" ? snapshot : null
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value)
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256:${[...result].map((byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`
}

function getCanonicalDestinationBinding(job) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: GET_CANONICAL_DESTINATION_BINDING,
      captureSessionId: job.captureSessionId }, (response) => {
      if (chrome.runtime.lastError ||
          response?.error === "BIND_STORAGE_READBACK_FAILED") {
        reject(new Error("BIND_STORAGE_READBACK_FAILED"))
        return
      }
      const binding = response?.binding
      if (response?.accepted !== true ||
          binding?.fingerprintVersion !== DESTINATION_FINGERPRINT_VERSION ||
          !/^sha256:[0-9a-f]{64}$/.test(binding?.canonicalDestinationFingerprint ?? "") ||
          binding?.countryClass !== "US") {
        resolve(null)
        return
      }
      resolve(binding)
    })
  })
}

async function canonicalDestinationFingerprintMatch(job, binding) {
  const current = normalizedShopPayDestination(job)
  if (!current || current.countryClass !== "US" || !binding) return false
  return await sha256Text(current.normalized) ===
    binding.canonicalDestinationFingerprint
}

async function shopPayCanonicalShippingProfileStatus(job) {
  const current = normalizedShopPayDestination(job)
  if (!current) return "UNAVAILABLE"
  const binding = await getCanonicalDestinationBinding(job)
  if (!binding) return "UNAVAILABLE"
  return await canonicalDestinationFingerprintMatch(job, binding)
    ? "MATCH" : "MISMATCH"
}

async function shopPayCanonicalShippingProfile(job) {
  return await shopPayCanonicalShippingProfileStatus(job) === "MATCH"
}

async function checkoutClassificationWhenReady(job, expectedSubtotal) {
  progress(job, "CHECKOUT_CLASSIFIER_STARTED", {
    checkoutHostClassification: checkoutHostClassification(),
  })
  progress(job, "CHECKOUT_HOST_CLASSIFIED", {
    checkoutHostClassification: checkoutHostClassification(),
  })
  if (location.hostname !== "shop.app") {
    const classification = checkoutPageClassification()
    progress(job, "CHECKOUT_PAGE_CLASSIFIED", {
      checkoutHostClassification: checkoutHostClassification(),
      checkoutPageClassification: classification,
    })
    return { classification, quote: checkoutSummaryQuote(expectedSubtotal) }
  }
  progress(job, "CHECKOUT_PAGE_DETECTED", {
    checkoutHostClassification: checkoutHostClassification(),
  })
  let rows = semanticMoneyRows()
  let markers = shopPayMarkerSnapshot(rows)
  progress(job, "SHOP_PAY_DOM_WAITING", {
    checkoutHostClassification: checkoutHostClassification(),
    ...markers,
  })
  let ready = null
  try {
    ready = await boundedDomWait(() => {
      rows = semanticMoneyRows()
      const classification = checkoutPageClassification(rows)
      markers = shopPayMarkerSnapshot(rows)
      if (new Set(["EXPLICIT_AUTH_CHALLENGE", "EXPLICIT_LOGIN_PAGE",
        "SESSION_EXPIRED"]).has(classification)) {
        return { classification, quote: null, markers }
      }
      if (!shopPayMarkersSufficient(markers)) return null
      const quote = checkoutSummaryQuote(expectedSubtotal, rows)
      if (!quote) return null
      return { classification: "NORMAL_CHECKOUT_WITH_SHIPPING", quote, markers }
    }, "SHOP_PAY_BOUNDED_DOM_READINESS_EXHAUSTED", SHOP_PAY_DOM_TIMEOUT_MS)
  } catch {
    rows = semanticMoneyRows()
    markers = shopPayMarkerSnapshot(rows)
    const quote = checkoutSummaryQuote(expectedSubtotal, rows)
    ready = { classification: "UNKNOWN_CHECKOUT_PAGE", quote, markers,
      failureReason: shopPayQuoteFailure(markers, quote, true) }
  }
  progress(job, "SHOP_PAY_DOM_READY", {
    checkoutHostClassification: checkoutHostClassification(),
    ...ready.markers,
  })
  progress(job, "CHECKOUT_PAGE_CLASSIFIED", {
    checkoutHostClassification: checkoutHostClassification(),
    checkoutPageClassification: ready.classification,
    ...ready.markers,
  })
  return ready
}

function continueToShippingControl() {
  return [...document.querySelectorAll('button,input[type="submit"]')]
    .find((element) => isVisible(element) &&
      !irreversibleCommerceControl(element) &&
      /continue to shipping|shipping method|continue/i.test(
        `${element.textContent ?? ""} ${element.value ?? ""}`)) ?? null
}

async function checkoutShipping(job, expectedSubtotal) {
  const ready = await checkoutClassificationWhenReady(job, expectedSubtotal)
  const classification = ready.classification
  const authSignal = classification === "EXPLICIT_AUTH_CHALLENGE"
    ? "EXPLICIT_CHALLENGE_UI"
    : classification === "EXPLICIT_LOGIN_PAGE" ? "EXPLICIT_LOGIN_REQUIRED"
      : classification === "SESSION_EXPIRED" ? "SESSION_EXPIRED_UI"
        : "NO_EXPLICIT_AUTH_REQUIREMENT"
  const classificationDetails = {
    checkoutHostClassification: checkoutHostClassification(), authSignal,
    checkoutNavigationHost: location.hostname,
    checkoutNavigationOrigin: location.origin,
    checkoutHostPermissionMatch: checkoutHostPermissionMatch(),
    authSignalSource: "FIXED_HOST_PATH_AND_VISIBLE_DOM",
  }
  if (location.hostname !== "shop.app" &&
      classification !== "UNKNOWN_CHECKOUT_PAGE") {
    progress(job, "CHECKOUT_PAGE_DETECTED", classificationDetails)
  }
  progress(job, classification, { ...classificationDetails,
    checkoutPageClassification: classification,
    ...(ready.markers ?? {}),
  })
  if (classification === "EXPLICIT_AUTH_CHALLENGE") {
    throw new Error("LUNA_AUTH_CHALLENGE_REQUIRED")
  }
  if (classification === "EXPLICIT_LOGIN_PAGE" ||
      classification === "SESSION_EXPIRED") {
    throw new Error("LUNA_SESSION_EXPIRED")
  }
  if (classification === "UNKNOWN_CHECKOUT_PAGE") {
    throw new Error(ready.failureReason ?? "OTHER:SHOP_PAY_PAGE_AMBIGUOUS")
  }
  const summaryQuote = ready.quote ?? checkoutSummaryQuote(expectedSubtotal)
  const profile = location.hostname === "shop.app"
    ? await shopPayCanonicalShippingProfileStatus(job)
    : canonicalShippingProfile(job) ? "MATCH" : "UNAVAILABLE"
  if (profile !== "MATCH") throw new Error(
    location.hostname === "shop.app" && profile === "MISMATCH"
      ? "CANONICAL_US_SHIPPING_PROFILE_MISMATCH"
      : location.hostname === "shop.app"
        ? "CANONICAL_US_SHIPPING_PROFILE_VALIDATION_UNAVAILABLE"
        : "CANONICAL_US_SHIPPING_PROFILE_UNAVAILABLE")
  if (summaryQuote && location.hostname !== "shop.app" &&
      !checkoutExpectedLine(job)) {
    throw new Error("LUNA_CHECKOUT_EXPECTED_PRODUCT_UNPROVEN")
  }
  if (summaryQuote) {
    // The exact Luna product and quantity were already certified by the
    // product page and cart for this same captureSessionId. Shop Pay is quote
    // authority only and does not need to repeat Luna identity evidence.
    progress(job, "CHECKOUT_EXPECTED_PRODUCT_VERIFIED")
    progress(job, "CHECKOUT_EXPECTED_QUANTITY_VERIFIED")
  }
  progress(job, "CANONICAL_US_PROFILE_FOUND")
  progress(job, "SHOP_PAY_QUOTE_PARSER_STARTED", classificationDetails)
  progress(job, "SHIPPING_CAPTURE_STARTED", classificationDetails)
  if (summaryQuote) {
    progress(job, "SHIPPING_ADDRESS_ACCEPTED")
    progress(job, "SHIPPING_OPTIONS_DETECTED")
    return summaryQuote
  }
  let shippingOption = firstVisible(document, [
    '[data-shipping-method]', '[data-shipping-rate]',
    'input[name*="shipping_method" i]', 'input[name*="shipping_rate" i]',
  ])
  if (!shippingOption) {
    const proceed = continueToShippingControl()
    if (!proceed) throw new Error("LUNA_SHIPPING_CONTINUE_CONTROL_UNAVAILABLE")
    if (irreversibleCommerceControl(proceed)) {
      throw new Error("LUNA_PURCHASE_BOUNDARY_REACHED")
    }
    proceed.click()
    progress(job, "SHIPPING_ADDRESS_ACCEPTED")
    shippingOption = await boundedDomWait(() => firstVisible(document, [
      '[data-shipping-method]', '[data-shipping-rate]',
      'input[name*="shipping_method" i]', 'input[name*="shipping_rate" i]',
    ]), "LUNA_SHIPPING_OPTIONS_UNAVAILABLE")
  } else {
    progress(job, "SHIPPING_ADDRESS_ACCEPTED")
  }
  if (shippingOption.type === "radio" && !shippingOption.checked) {
    shippingOption.click()
  }
  progress(job, "SHIPPING_OPTIONS_DETECTED")
  return boundedDomWait(() => {
    const shippingRoot = shippingOption.closest?.("label,[data-shipping-method]," +
      "[data-shipping-rate]") ?? shippingOption.parentElement
    const shippingText = shippingRoot?.textContent ?? shippingOption.textContent ?? ""
    const shippingValues = moneyValues(shippingText)
    const shippingUsd = /\bfree\b/i.test(shippingText) ? 0
      : shippingValues.length === 1 ? shippingValues[0] : null
    if (shippingUsd === null) return null
    const subtotalElement = firstVisible(document, [
      '[data-checkout-subtotal]', '[data-order-summary-subtotal]',
      '[data-subtotal-price]', '.order-summary__emphasis',
    ])
    const subtotalValues = moneyValues(subtotalElement?.textContent)
    if (!subtotalValues.some((value) => Math.abs(value - expectedSubtotal) <= 0.01)) {
      return null
    }
    const totalElement = firstVisible(document, [
      '[data-checkout-total]', '[data-order-summary-total]',
      '[data-total-price]', '.payment-due__price',
    ])
    const totalValues = moneyValues(totalElement?.textContent)
    const minimumTotal = Math.round((expectedSubtotal + shippingUsd) * 100) / 100
    const totalUsd = totalValues.find((value) => value >= minimumTotal)
    if (!Number.isFinite(totalUsd)) return null
    return { shippingUsd, totalUsd }
  }, "LUNA_AUTHORITATIVE_SHIPPING_QUOTE_UNAVAILABLE")
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256:${[...result].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

async function restoreCart(original) {
  await retry(() => request("/cart/clear.js", { method: "POST", body: {} }))
  if (original.length) await retry(() => request("/cart/add.js", {
    method: "POST", body: { items: original },
  }))
}

async function runProductStage(job) {
  progress(job, "ACTIVE_JOB_RECOVERED")
  await productPageReady(job)
  progress(job, "PRODUCT_PAGE_DOM_READY")
  const authClassification = classifyPageAuth()
  progress(job, authClassification)
  if (authClassification === "AUTH_EXPLICITLY_FAILED") {
    throw new Error("LUNA_SESSION_EXPIRED")
  }
  if (authClassification === "AUTH_CHALLENGE_PRESENT") {
    throw new Error("LUNA_AUTH_CHALLENGE_REQUIRED")
  }
  progress(job, "PRODUCT_IDENTITY_CHECK_STARTED")
  await retry(() => exactProduct(job))
  progress(job, "PRODUCT_IDENTITY_VERIFIED")
  const original = cartSnapshot(await retry(() => request("/cart.js")))
  try {
    await retry(() => request("/cart/clear.js", { method: "POST", body: {} }))
    const addToCart = await visibleAddToCartControl(job)
    progress(job, "ADD_TO_CART_ELEMENT_FOUND")
    await setActiveJobPhase(job, CART_PHASE, {
      originalCartSnapshot: original,
    })
    addToCart.click()
    progress(job, "ADD_TO_CART_CLICK_DISPATCHED")
    const productPath = location.pathname
    setTimeout(() => {
      if (location.pathname === productPath) location.assign("/cart")
    }, 1_500)
  } catch (error) {
    try { await restoreCart(original) } catch {
      throw new Error("LUNA_CART_RESTORE_UNPROVEN")
    }
    throw error
  }
}

async function runCartStage(job, original) {
  progress(job, "ACTIVE_JOB_RECOVERED_ON_CART")
  progress(job, "CART_PAGE_DETECTED")
  try {
    const confirmedCart = await retry(() => request("/cart.js"))
    const exact = exactCartEvidence(confirmedCart, job)
    progress(job, "CART_EXPECTED_PRODUCT_FOUND")
    progress(job, "CART_EXPECTED_QUANTITY_FOUND")
    await visibleCartEvidence(job, exact.subtotalUsd)
    progress(job, "CART_MUTATION_CONFIRMED", {
      cartSubtotalUsd: exact.subtotalUsd,
    })
    progress(job, "SHIPPING_FLOW_RESUMED", {
      cartSubtotalUsd: exact.subtotalUsd,
    })
    await setActiveJobPhase(job, CHECKOUT_PHASE, {
      cartSubtotalUsd: exact.subtotalUsd,
    })
    const checkout = await boundedDomWait(visibleCheckoutControl,
      "LUNA_CHECKOUT_CONTROL_UNAVAILABLE")
    checkout.click()
    const cartPath = location.pathname
    setTimeout(() => {
      if (location.pathname === cartPath) location.assign("/checkout")
    }, 1_500)
  } catch (error) {
    try { await restoreCart(original) } catch {
      throw new Error("LUNA_CART_RESTORE_UNPROVEN")
    }
    throw error
  }
}

async function runCheckoutStage(job, original, subtotalUsd) {
  let capture = null
  let operationError = null
  let restoreError = null
  try {
    if (checkoutHostClassification() === "UNSUPPORTED_CHECKOUT_HOST") {
      throw new Error("LUNA_UNKNOWN_CHECKOUT_PAGE")
    }
    const visible = await checkoutShipping(job, subtotalUsd)
    if (location.hostname === "shop.app" && visible.shippingUsd === 0 &&
        visible.shippingZeroAuthoritative !== true) {
      throw new Error("SHOP_PAY_SHIPPING_ROW_VALUE_CONFLICT")
    }
    progress(job, "SHIPPING_QUOTE_CAPTURED", {
      checkoutHostClassification: checkoutHostClassification(),
      checkoutNavigationHost: location.hostname,
      checkoutNavigationOrigin: location.origin,
      checkoutHostPermissionMatch: true,
      subtotalUsd: Number.isFinite(visible.subtotalUsd)
        ? visible.subtotalUsd : subtotalUsd,
      shippingUsd: visible.shippingUsd,
      totalUsd: visible.totalUsd,
    })
    progress(job, "AUTHENTICATED_OPERATION_CONFIRMED")
    const observedAt = new Date().toISOString()
    const checkoutSubtotalUsd = Number.isFinite(visible.subtotalUsd)
      ? visible.subtotalUsd : subtotalUsd
    const evidenceInput = {
      candidateId: job.identity.candidateId,
      lunaProductId: job.identity.lunaProductId,
      lunaVariantId: job.identity.lunaVariantId,
      supplierSku: job.identity.supplierSku,
      quantity: job.identity.quantity,
      subtotalUsd: checkoutSubtotalUsd,
      shippingUsd: visible.shippingUsd, totalUsd: visible.totalUsd,
      currency: "USD", observedAt,
      acquisitionMethod: ACQUISITION_METHOD,
      destinationProfileDigest: job.destination.profileDigest,
    }
    capture = { contractVersion: CONTRACT,
      captureSessionId: job.captureSessionId, nonce: job.nonce,
      ...evidenceInput,
      extensionEvidenceDigest: await digest(evidenceInput),
      normalChromeAuthenticated: true,
      expectedProductIdMatch: true,
      expectedVariantIdMatch: true,
      expectedSupplierSkuMatch: true,
      subtotalPlusShippingReconciles: true,
      cartRestoreProven: true,
      cookieAccess: false,
      credentialAccess: false,
      lunaPurchases: 0,
    }
  } catch (error) {
    operationError = error
  } finally {
    if (new Set(["lunaportex.com", "www.lunaportex.com"])
        .has(location.hostname)) {
      try { await restoreCart(original) } catch (error) { restoreError = error }
    }
  }
  if (restoreError) throw new Error("LUNA_CART_RESTORE_UNPROVEN")
  if (operationError) throw operationError
  if (!capture) throw new Error("LUNA_SHIPPING_CAPTURE_UNAVAILABLE")
  return capture
}

async function recoverJobContext() {
  let lastError = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STEP; attempt += 1) {
    try { return await getActiveJob() } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  throw lastError ?? new Error("SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")
}

const isProductPage = /^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/
  .test(location.pathname)
const isCartPage = location.pathname.replace(/\/$/, "") === "/cart"
const isCheckoutPage = /^\/checkouts?(?:\/|$)/.test(location.pathname) ||
  location.hostname === "account.lunaportex.com" ||
  location.hostname === "shop.app"

function canonicalBindingCheckoutSnapshot() {
  const destination = shopPayDestinationSnapshot()
  const markers = {
    shopPayMarkerShipTo: destination.markerFound,
    shopPayMarkerShipping: semanticCheckoutSignal(/^shipping\b/),
    shopPayMarkerSubtotal: semanticCheckoutSignal(/^subtotal\b/),
    shopPayMarkerTotal: semanticCheckoutSignal(/^total\b/),
    shopPayMarkerPayment: semanticCheckoutSignal(/^payment\b/),
    shopPayMarkerPayNow: semanticCheckoutSignal(/^pay now\b/),
  }
  const safeCheckoutShellVerified = markers.shopPayMarkerShipping &&
    markers.shopPayMarkerSubtotal &&
    markers.shopPayMarkerTotal &&
    (markers.shopPayMarkerPayment || markers.shopPayMarkerPayNow)
  const safeCheckoutMarkersVerified = safeCheckoutShellVerified &&
    markers.shopPayMarkerShipTo
  return { destination, markers, safeCheckoutShellVerified,
    safeCheckoutMarkersVerified }
}

chrome.runtime.onMessage?.addListener?.((message, _sender, sendResponse) => {
  if (message?.type === BIND_ELIGIBILITY_PROBE) {
    if (location.hostname !== "shop.app") return false
    const snapshot = canonicalBindingCheckoutSnapshot()
    const response = {
      isShopPayCheckout: true,
      checkoutPageDetected: snapshot.safeCheckoutMarkersVerified &&
        snapshot.markers.shopPayMarkerPayNow,
      shipToMarker: snapshot.markers.shopPayMarkerShipTo,
      shippingMarker: snapshot.markers.shopPayMarkerShipping,
      subtotalMarker: snapshot.markers.shopPayMarkerSubtotal,
      totalMarker: snapshot.markers.shopPayMarkerTotal,
      payNowMarker: snapshot.markers.shopPayMarkerPayNow,
    }
    sendResponse(response)
    return false
  }
  if (message?.type === PROBE_CANONICAL_DESTINATION ||
      message?.type === BIND_CANONICAL_DESTINATION ||
      message?.type === VALIDATE_CANONICAL_DESTINATION) {
    if (location.hostname !== "shop.app") {
      sendResponse({ accepted: false,
        error: "CANONICAL_US_PROFILE_VALIDATION_UNAVAILABLE" })
      return false
    }
    void boundedDomWait(() => {
      const snapshot = canonicalBindingCheckoutSnapshot()
      if (snapshot.destination.ambiguous) {
        throw new Error("BIND_SHIP_TO_AMBIGUOUS")
      }
      return snapshot.safeCheckoutShellVerified ? snapshot : null
    }, "CANONICAL_BINDING_CHECKOUT_SHAPE_UNPROVEN",
    SHOP_PAY_DOM_TIMEOUT_MS).then(async (snapshot) => {
      const current = snapshot.destination
      if (current.ambiguous) throw new Error("BIND_SHIP_TO_AMBIGUOUS")
      if (!current.normalized || current.countryClass !== "US") {
        throw new Error("BIND_SHIP_TO_NOT_FOUND")
      }
      if (message.type === PROBE_CANONICAL_DESTINATION) {
        sendResponse({ accepted: true, shipToAvailable: true,
          safeCheckoutMarkersVerified: true })
        return
      }
      const canonicalDestinationFingerprint = await sha256Text(current.normalized)
      if (message.type === VALIDATE_CANONICAL_DESTINATION) {
        const binding = message.binding
        if (binding?.fingerprintVersion !== DESTINATION_FINGERPRINT_VERSION ||
            binding?.countryClass !== "US" ||
            !/^sha256:[0-9a-f]{64}$/.test(
              binding?.canonicalDestinationFingerprint ?? "")) {
          throw new Error("CANONICAL_DESTINATION_FINGERPRINT_UNAVAILABLE")
        }
        if (canonicalDestinationFingerprint !==
            binding.canonicalDestinationFingerprint) {
          throw new Error("CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
        }
        sendResponse({ accepted: true, canonicalDestinationMatch: true,
          fingerprintVersion: DESTINATION_FINGERPRINT_VERSION,
          countryClass: "US", safeCheckoutMarkersVerified: true })
        return
      }
      sendResponse({ accepted: true,
        canonicalDestinationFingerprint,
        fingerprintVersion: DESTINATION_FINGERPRINT_VERSION,
        countryClass: "US",
        safeCheckoutMarkersVerified: true })
    }).catch((error) => sendResponse({ accepted: false,
      error: error instanceof Error ? error.message
        : "CANONICAL_US_PROFILE_VALIDATION_UNAVAILABLE" }))
    return true
  }
  return false
})

if ((isProductPage || isCartPage || isCheckoutPage) &&
    globalThis.__sellerOsLunaShippingCaptureAttachedV1 !== true) {
  globalThis.__sellerOsLunaShippingCaptureAttachedV1 = true
  const bootstrapReady = isCheckoutPage ? checkoutBootstrapAckPromise
    : Promise.resolve(true)
  void bootstrapReady.then(async (acknowledged) => {
    if (!acknowledged) {
      throw new Error("CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED")
    }
    progress(null, "CONTENT_SCRIPT_LOADED")
    progress(null, "ACTIVE_JOB_REQUESTED")
    return recoverJobContext()
  }).then(async (context) => {
    if (isCheckoutPage) {
      if (context.phase !== CHECKOUT_PHASE ||
          !Array.isArray(context.originalCartSnapshot) ||
          !Number.isFinite(context.cartSubtotalUsd)) {
        throw new Error("ACTIVE_JOB_CHECKOUT_CONTINUITY_UNPROVEN")
      }
      progress(context.job, "ACTIVE_JOB_RECOVERED_ON_CHECKOUT", {
        checkoutHostClassification: checkoutHostClassification(),
        checkoutNavigationHost: location.hostname,
        checkoutNavigationOrigin: location.origin,
        checkoutHostPermissionMatch: checkoutHostPermissionMatch(),
      })
      return { job: context.job,
        capture: await runCheckoutStage(context.job,
          context.originalCartSnapshot, context.cartSubtotalUsd) }
    }
    if (isCartPage) {
      if (context.phase !== CART_PHASE ||
          !Array.isArray(context.originalCartSnapshot)) {
        throw new Error("ACTIVE_JOB_CART_CONTINUITY_UNPROVEN")
      }
      await runCartStage(context.job, context.originalCartSnapshot)
      return { job: context.job, capture: null }
    }
    await runProductStage(context.job)
    return { job: context.job, capture: null }
  }).then(({ job, capture }) => {
      if (!capture) return
      progress(job, "RESULT_POSTED")
      send(true, job, capture)
    }).catch(reportRuntimeFailure)
}
