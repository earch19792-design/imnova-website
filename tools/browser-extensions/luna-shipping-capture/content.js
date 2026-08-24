"use strict"

const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const JOB_RESULT = "LUNA_SHIPPING_JOB_RESULT"
const GET_ACTIVE_JOB = "GET_ACTIVE_LUNA_SHIPPING_JOB"
const JOB_PROGRESS = "LUNA_SHIPPING_JOB_PROGRESS"
const JOB_RUNTIME_FAILURE = "LUNA_SHIPPING_JOB_RUNTIME_FAILURE"
const SET_ACTIVE_JOB_PHASE = "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE"
const CART_PHASE = "AWAITING_CART_CONFIRMATION"
const ACQUISITION_METHOD = "NORMAL_CHROME_EXTENSION_VISIBLE_DOM"
const MAX_ATTEMPTS_PER_STEP = 2
const MAXIMUM_PRODUCT_JSON_BYTES = 256_000
const MAXIMUM_CART_ITEMS = 50
const STEP_TIMEOUT_MS = 15_000
const MONEY = /(?:\$\s*([0-9][0-9,]*(?:\.\d{2})?)|([0-9][0-9,]*(?:\.\d{2})?)\s*USD)\b/gi

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
          (response?.phase !== CART_PHASE || originalCartSnapshot !== null)) {
        resolve({ job, phase: response?.phase, originalCartSnapshot })
      }
      else reject(new Error(typeof response?.error === "string" ? response.error
        : jobValidationReason(response?.job) ??
          (response?.phase === CART_PHASE
            ? "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN"
            : "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")))
    })
  })
}

function progress(job, state, details = {}) {
  chrome.runtime.sendMessage({ type: JOB_PROGRESS, state,
    ...(job ? { captureSessionId: job.captureSessionId,
      candidateId: job.identity.candidateId } : {}),
    ...(Number.isFinite(details.cartSubtotalUsd)
      ? { cartSubtotalUsd: details.cartSubtotalUsd } : {}) })
}

function setActiveJobPhase(job, originalCartSnapshot) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN")), 5_000)
    chrome.runtime.sendMessage({ type: SET_ACTIVE_JOB_PHASE,
      phase: CART_PHASE, captureSessionId: job.captureSessionId,
      originalCartSnapshot }, (response) => {
      clearTimeout(timeout)
      if (response?.accepted === true && response?.phase === CART_PHASE) resolve()
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

function boundedDomWait(probe, failureCode) {
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
      STEP_TIMEOUT_MS)
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
    const value = Number((match[1] ?? match[2] ?? "").replace(/,/g, ""))
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

async function visibleShipping(job, expectedSubtotal) {
  const overlay = document.createElement("section")
  overlay.id = "seller-os-luna-shipping-capture"
  overlay.style.cssText = "position:fixed;inset:16px;z-index:2147483647;background:#07111a;border:2px solid #a5f3fc;border-radius:16px;padding:12px;box-shadow:0 20px 80px #000;color:white"
  const label = document.createElement("p")
  label.textContent = "Seller OS: calculando envío visible de Luna. No se realizará ninguna compra."
  label.style.cssText = "font:700 14px system-ui;margin:0 0 8px"
  const frame = document.createElement("iframe")
  frame.src = "/cart"
  frame.style.cssText = "width:100%;height:calc(100% - 30px);border:0;background:white"
  overlay.append(label, frame)
  document.documentElement.append(overlay)
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("LUNA_CART_DOM_TIMEOUT")),
        STEP_TIMEOUT_MS)
      frame.addEventListener("load", () => { clearTimeout(timeout); resolve() }, { once: true })
    })
    const root = frame.contentDocument
    if (!root) throw new Error("LUNA_AUTH_CHALLENGE_REQUIRED")
    if (root.querySelector('iframe[src*="captcha" i],[data-cf-challenge],input[autocomplete="one-time-code"]')) {
      throw new Error("LUNA_AUTH_CHALLENGE_REQUIRED")
    }
    if (root.querySelector('input[type="password"],form[action*="/account/login"],form[action*="/login"]')) {
      throw new Error("LUNA_SESSION_EXPIRED")
    }
    const subtotalElement = firstVisible(root, [
      "[data-cart-subtotal]", ".totals__total-value", ".cart-subtotal__price",
      "[data-cart-total]", ".cart__subtotal .money",
    ])
    const subtotalValues = moneyValues(subtotalElement?.textContent)
    if (!subtotalValues.some((value) => Math.abs(value - expectedSubtotal) <= 0.01)) {
      throw new Error("LUNA_VISIBLE_SUBTOTAL_MISMATCH")
    }
    const country = firstVisible(root, [
      'select[name="address[country]"]',
      'select[name="shipping_address[country]"]',
      '[data-shipping-country]',
    ])
    const province = firstVisible(root, [
      'select[name="address[province]"]', 'input[name="address[province]"]',
      'select[name="shipping_address[province]"]',
      'input[name="shipping_address[province]"]', '[data-shipping-province]',
    ])
    const postal = firstVisible(root, [
      'input[name="address[zip]"]', 'input[name="address[postal_code]"]',
      'input[name="shipping_address[zip]"]', '[data-shipping-postal-code]',
    ])
    if (!setField(country, "US") || !setField(province, job.destination.province) ||
        !setField(postal, job.destination.postalCode)) {
      throw new Error("LUNA_SHIPPING_DOM_CONTRACT_CHANGED")
    }
    const calculate = [...root.querySelectorAll("button,input[type=button],input[type=submit]")]
      .find((element) => isVisible(element) &&
        /calculate shipping|get rates|calculate|shipping rates/i
          .test(element.textContent ?? element.value ?? ""))
    if (!calculate) throw new Error("LUNA_SHIPPING_DOM_CONTRACT_CHANGED")
    calculate.click()
    const result = await retry(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750))
      const shippingElement = firstVisible(root, [
        "[data-shipping-rate-price]", "#shipping-rates li",
        ".shipping-rates li", ".shipping-calculator__response li",
        "[data-shipping-rates] li",
      ])
      const shippingValues = moneyValues(shippingElement?.textContent)
      if (shippingValues.length !== 1) throw new Error("LUNA_VISIBLE_SHIPPING_AMBIGUOUS")
      const shippingUsd = shippingValues[0]
      const totalExpected = Math.round((expectedSubtotal + shippingUsd) * 100) / 100
      const totalElement = firstVisible(root, [
        "[data-shipping-total]", "[data-order-total]", ".shipping-calculator__total",
        ".cart__grand-total", ".grand-total",
      ])
      const totalValues = moneyValues(totalElement?.textContent)
      if (!totalValues.some((value) => Math.abs(value - totalExpected) <= 0.01)) {
        throw new Error("LUNA_VISIBLE_TOTAL_UNAVAILABLE")
      }
      return { shippingUsd, totalUsd: totalExpected }
    })
    return result
  } finally {
    overlay.remove()
  }
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
    await setActiveJobPhase(job, original)
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
  let capture = null
  let operationError = null
  let restoreError = null
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
    progress(job, "SHIPPING_CAPTURE_STARTED")
    const visible = await visibleShipping(job, exact.subtotalUsd)
    progress(job, "AUTHENTICATED_OPERATION_CONFIRMED")
    const observedAt = new Date().toISOString()
    const evidenceInput = {
      candidateId: job.identity.candidateId,
      lunaProductId: job.identity.lunaProductId,
      lunaVariantId: job.identity.lunaVariantId,
      supplierSku: job.identity.supplierSku,
      quantity: job.identity.quantity,
      subtotalUsd: exact.subtotalUsd,
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
    try { await restoreCart(original) } catch (error) { restoreError = error }
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

if (isProductPage || isCartPage) {
  progress(null, "CONTENT_SCRIPT_LOADED")
  progress(null, "ACTIVE_JOB_REQUESTED")
  void recoverJobContext().then(async (context) => {
    if (isCartPage) {
      if (context.phase !== CART_PHASE ||
          !Array.isArray(context.originalCartSnapshot)) {
        throw new Error("ACTIVE_JOB_CART_CONTINUITY_UNPROVEN")
      }
      return { job: context.job,
        capture: await runCartStage(context.job, context.originalCartSnapshot) }
    }
    await runProductStage(context.job)
    return { job: context.job, capture: null }
  }).then(({ job, capture }) => {
      if (!capture) return
      progress(job, "RESULT_POSTED")
      send(true, job, capture)
    }).catch(reportRuntimeFailure)
}
