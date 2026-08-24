"use strict"

const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const JOB_RESULT = "LUNA_SHIPPING_JOB_RESULT"
const JOB_RESUME = "SELLER_OS_LUNA_SHIPPING_JOB_RESUME"
const JOB_PROGRESS = "LUNA_SHIPPING_JOB_PROGRESS"
const ACQUISITION_METHOD = "NORMAL_CHROME_EXTENSION_VISIBLE_DOM"
const MAX_ATTEMPTS_PER_STEP = 2
const MAXIMUM_PRODUCT_JSON_BYTES = 256_000
const MAXIMUM_CART_ITEMS = 50
const STEP_TIMEOUT_MS = 15_000
const MONEY = /(?:\$\s*([0-9][0-9,]*(?:\.\d{2})?)|([0-9][0-9,]*(?:\.\d{2})?)\s*USD)\b/gi

function decodeJob() {
  const encoded = new URLSearchParams(location.hash.slice(1))
    .get("seller-os-luna-shipping-v1")
  if (!encoded || encoded.length > 12_000) return null
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - encoded.length % 4) % 4)
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch { return null }
}

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

function resumeJob(job) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED")), 5_000)
    chrome.runtime.sendMessage({ type: JOB_RESUME, job }, (response) => {
      clearTimeout(timeout)
      if (response?.accepted === true &&
          response.captureSessionId === job.captureSessionId) resolve()
      else reject(new Error(typeof response?.error === "string"
        ? response.error : "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED"))
    })
  })
}

function progress(job, state) {
  chrome.runtime.sendMessage({ type: JOB_PROGRESS, state,
    captureSessionId: job.captureSessionId,
    candidateId: job.identity.candidateId })
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

function authenticatedVisibleDom() {
  if (location.hostname === "account.lunaportex.com" ||
      /\/account\/(?:login|signin)/i.test(location.pathname) ||
      document.querySelector('input[type="password"]')) return false
  const selectors = [
    'a[href*="/account/logout"]', 'a[href*="/account/signout"]',
    '[data-customer-id]', '[data-customer-logged-in="true"]',
    '.customer-account', '[aria-label*="Log out" i]',
  ]
  return selectors.some((selector) => [...document.querySelectorAll(selector)]
    .some((element) => isVisible(element))) ||
    [...document.querySelectorAll("a,button")].slice(0, 400).some((element) =>
      isVisible(element) && /^(?:log out|sign out|cerrar sesi[oó]n)$/i
        .test((element.textContent ?? "").trim()))
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
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "same-origin", redirect: "error", cache: "no-store",
    headers: { Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  })
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

async function productPageReady() {
  await retry(async () => {
    if (document.readyState === "loading" || !document.body) {
      throw new Error("PRODUCT_PAGE_NOT_READY")
    }
    return true
  })
}

function visibleAddToCartControl(job) {
  const controls = [...document.querySelectorAll([
    'form[action*="/cart/add"] button[type="submit"]',
    'form[action*="/cart/add"] input[type="submit"]',
    'button[name="add"]', '[data-add-to-cart]', '.product-form__submit',
  ].join(","))]
  const control = controls.find((element) => isVisible(element) &&
    /add to cart|add to bag|agregar al carrito/i.test(
      `${element.textContent ?? ""} ${element.value ?? ""}`))
  if (!control) throw new Error("ADD_TO_CART_SELECTOR_NOT_FOUND")
  if (control.disabled || control.getAttribute("aria-disabled") === "true") {
    throw new Error("ADD_TO_CART_DISABLED")
  }
  const form = control.form ?? control.closest("form")
  const variantField = form?.querySelector('[name="id"]')
  if (!form || !variantField) {
    throw new Error("ADD_TO_CART_SELECTOR_NOT_FOUND")
  }
  variantField.value = job.identity.lunaVariantId
  variantField.dispatchEvent(new Event("input", { bubbles: true }))
  variantField.dispatchEvent(new Event("change", { bubbles: true }))
  if (String(variantField.value) !== job.identity.lunaVariantId) {
    throw new Error("LUNA_EXACT_PRODUCT_IDENTITY_MISMATCH")
  }
  return control
}

function exactCartMatch(cart, job) {
  const items = Array.isArray(cart?.items) ? cart.items : []
  return items.length === 1 &&
    String(items[0]?.product_id ?? "") === job.identity.lunaProductId &&
    String(items[0]?.variant_id ?? items[0]?.id ?? "") ===
      job.identity.lunaVariantId &&
    String(items[0]?.sku ?? "") === job.identity.supplierSku &&
    Number(items[0]?.quantity) === job.identity.quantity
}

function cartSnapshot(cart) {
  const rows = Array.isArray(cart?.items) ? cart.items : []
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
    if (!root) throw new Error("LUNA_CART_DOM_UNAVAILABLE")
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

async function run(job) {
  progress(job, "PRODUCT_PAGE_OPENED")
  await productPageReady()
  if (!authenticatedVisibleDom()) throw new Error("LUNA_NORMAL_CHROME_AUTH_UNPROVEN")
  await retry(() => exactProduct(job))
  progress(job, "PRODUCT_IDENTITY_VERIFIED")
  const original = cartSnapshot(await retry(() => request("/cart.js")))
  let cartTouched = false
  let capture = null
  let operationError = null
  let restoreError = null
  try {
    await retry(() => request("/cart/clear.js", { method: "POST", body: {} }))
    cartTouched = true
    const addToCart = await retry(() => visibleAddToCartControl(job))
    addToCart.click()
    progress(job, "ADD_TO_CART_DISPATCHED")
    const confirmedCart = await retry(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750))
      const cart = await request("/cart.js")
      if (!exactCartMatch(cart, job)) {
        throw new Error("LUNA_EXACT_CART_IDENTITY_MISMATCH")
      }
      return cart
    })
    progress(job, "CART_CONFIRMED")
    const added = confirmedCart.items[0]
    const minor = Number(added?.final_line_price ?? added?.line_price)
    if (!Number.isFinite(minor) || minor < 0) throw new Error("LUNA_CART_SUBTOTAL_UNPROVEN")
    const subtotalUsd = Math.round(minor) / 100
    progress(job, "SHIPPING_CAPTURE_STARTED")
    const visible = await visibleShipping(job, subtotalUsd)
    const observedAt = new Date().toISOString()
    const evidenceInput = {
      candidateId: job.identity.candidateId,
      lunaProductId: job.identity.lunaProductId,
      lunaVariantId: job.identity.lunaVariantId,
      supplierSku: job.identity.supplierSku,
      quantity: job.identity.quantity,
      subtotalUsd, shippingUsd: visible.shippingUsd, totalUsd: visible.totalUsd,
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
    if (cartTouched) {
      try {
        await retry(() => request("/cart/clear.js", { method: "POST", body: {} }))
        if (original.length) await retry(() => request("/cart/add.js", {
          method: "POST", body: { items: original },
        }))
      } catch (error) { restoreError = error }
    }
  }
  if (restoreError) throw new Error("LUNA_CART_RESTORE_UNPROVEN")
  if (operationError) throw operationError
  if (!capture) throw new Error("LUNA_SHIPPING_CAPTURE_UNAVAILABLE")
  return capture
}

const decoded = decodeJob()
const job = validateJob(decoded)
if (job) {
  void resumeJob(job).then(() => run(job)).then(
    (capture) => { progress(job, "RESULT_POSTED"); send(true, job, capture) },
    (error) => send(false, job, error instanceof Error
      ? error.message : "LUNA_SHIPPING_JOB_FAILED"),
  )
}
