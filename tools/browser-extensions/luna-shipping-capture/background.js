"use strict"

const SELLER_OS_ORIGIN =
  "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app"
const CONTROL_PAGE = `${SELLER_OS_ORIGIN}/admin/ebay/luna-shipping-capture`
const PORT_NAME = "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1"
const JOB_RESULT = "LUNA_SHIPPING_JOB_RESULT"
const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const EXACT_EXTENSION_ID = "mhpkojahbbfdgodeaecggpjaplllgclk"
const EXTENSION_PING = "SELLER_OS_LUNA_SHIPPING_PING"
const EXTENSION_READY = "LUNA_SHIPPING_EXTENSION_READY"
const JOB_RESUME = "SELLER_OS_LUNA_SHIPPING_JOB_RESUME"
const JOB_PROGRESS = "LUNA_SHIPPING_JOB_PROGRESS"

let sellerPort = null
let activeTabId = null
let activeJob = null

function safeSellerSender(sender) {
  try {
    return new URL(sender?.url ?? "").origin === SELLER_OS_ORIGIN
  } catch { return false }
}

function exactLunaUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" ||
        !new Set(["lunaportex.com", "www.lunaportex.com"]).has(url.hostname) ||
        !/^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/.test(url.pathname) ||
        url.username || url.password || url.port) return null
    url.hostname = "www.lunaportex.com"
    url.search = ""
    return url
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
      .test(job.captureSessionId)) return "JOB_INVALID_TYPE:captureSessionId"
  if (!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(job.nonce)) {
    return "JOB_INVALID_TYPE:nonce"
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(identity.candidateId) ||
      !/^\d{8,24}$/.test(identity.lunaProductId) ||
      !/^\d{8,24}$/.test(identity.lunaVariantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/.test(identity.supplierSku)) {
    return "JOB_IDENTITY_MISMATCH:identity"
  }
  if (!Number.isInteger(identity.quantity) || identity.quantity < 1 ||
      identity.quantity > 20) return "JOB_INVALID_TYPE:identity.quantity"
  if (!exactLunaUrl(identity.canonicalProductUrl)) {
    return "JOB_IDENTITY_MISMATCH:identity.canonicalProductUrl"
  }
  if (!/^[A-Z0-9_-]{3,80}$/.test(destination.profileId) ||
      !/^sha256:[0-9a-f]{64}$/.test(destination.profileDigest) ||
      destination.country !== "US" || !/^[A-Z]{2}$/.test(destination.province) ||
      !/^\d{5}(?:-\d{4})?$/.test(destination.postalCode)) {
    return "JOB_INVALID_TYPE:destination"
  }
  if (!Number.isFinite(job.salePriceUsd) || job.salePriceUsd <= 0 ||
      !Number.isFinite(job.supplierCostUsd) || job.supplierCostUsd < 0 ||
      job.productName.trim().length < 2 || job.productName.length > 240) {
    return "JOB_INVALID_TYPE:commercialFacts"
  }
  return null
}

function safeJob(value) {
  return jobValidationReason(value) === null ? value : null
}

function sameJob(left, right) {
  return left?.captureSessionId === right?.captureSessionId &&
    left?.nonce === right?.nonce &&
    left?.identity?.candidateId === right?.identity?.candidateId
}

function encodeJob(job) {
  const bytes = new TextEncoder().encode(JSON.stringify(job))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function startJob(job) {
  const invalidReason = jobValidationReason(job)
  if (invalidReason) throw new Error(invalidReason)
  const exact = safeJob(job)
  const url = exact && exactLunaUrl(exact.identity.canonicalProductUrl)
  if (!exact || !url) throw new Error("JOB_IDENTITY_MISMATCH:identity.canonicalProductUrl")
  activeJob = exact
  url.hash = `seller-os-luna-shipping-v1=${encodeJob(exact)}`
  if (activeTabId === null) {
    const tab = await chrome.tabs.create({ url: url.toString(), active: true })
    if (!Number.isInteger(tab.id)) throw new Error("LUNA_SHIPPING_TAB_UNAVAILABLE")
    activeTabId = tab.id
  } else {
    await chrome.tabs.update(activeTabId, { url: url.toString(), active: true })
  }
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.runtime.id !== EXACT_EXTENSION_ID) return
  void chrome.tabs.create({ url: `${CONTROL_PAGE}?bridgeOnly=1`, active: true })
})

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== EXTENSION_PING || !safeSellerSender(sender) ||
      chrome.runtime.id !== EXACT_EXTENSION_ID) return false
  if (sellerPort) sellerPort.disconnect()
  sellerPort = null
  activeJob = null
  sendResponse({
    type: EXTENSION_READY,
    extensionId: EXACT_EXTENSION_ID,
    extensionVersion: chrome.runtime.getManifest().version,
    sellerOsOriginValidated: true,
  })
  return false
})

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME || !safeSellerSender(port.sender) || sellerPort) {
    port.disconnect()
    return
  }
  sellerPort = port
  port.onMessage.addListener((message) => {
    if (message?.type !== "START_SHIPPING_JOB") return
    void startJob(message.job).catch((error) => port.postMessage({
      type: JOB_RESULT, success: false,
      error: error instanceof Error ? error.message : "LUNA_SHIPPING_JOB_FAILED",
      capture: { candidateId: message.job?.identity?.candidateId ?? null },
    }))
  })
  port.onDisconnect.addListener(() => {
    if (sellerPort !== port) return
    sellerPort = null
    activeJob = null
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === JOB_RESUME) {
    const invalidReason = jobValidationReason(message.job)
    if (invalidReason || !Number.isInteger(sender.tab?.id) ||
        (activeJob && !sameJob(activeJob, message.job))) {
      sendResponse({ accepted: false,
        error: invalidReason ?? "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED" })
      return false
    }
    activeJob = message.job
    activeTabId = sender.tab.id
    sendResponse({ accepted: true, captureSessionId: activeJob.captureSessionId })
    return false
  }
  if (message?.type === JOB_PROGRESS && sellerPort && activeJob &&
      sender.tab?.id === activeTabId &&
      message.captureSessionId === activeJob.captureSessionId &&
      message.candidateId === activeJob.identity.candidateId &&
      new Set(["PRODUCT_PAGE_OPENED", "PRODUCT_IDENTITY_VERIFIED",
        "ADD_TO_CART_DISPATCHED", "CART_CONFIRMED",
        "SHIPPING_CAPTURE_STARTED", "RESULT_POSTED"]).has(message.state)) {
    sellerPort.postMessage({ type: JOB_PROGRESS, state: message.state,
      candidateId: activeJob.identity.candidateId })
    return false
  }
  if (message?.type !== JOB_RESULT || !sellerPort ||
      sender.tab?.id !== activeTabId || !activeJob) return false
  const capture = message.capture && typeof message.capture === "object"
    ? message.capture : {}
  if (capture.candidateId !== activeJob.identity.candidateId ||
      capture.captureSessionId !== activeJob.captureSessionId ||
      capture.nonce !== activeJob.nonce) return false
  sellerPort.postMessage({ type: JOB_RESULT,
    success: message.success === true,
    ...(message.success === true ? { capture }
      : { error: typeof message.error === "string"
        ? message.error : "LUNA_SHIPPING_JOB_FAILED", capture }) })
  activeJob = null
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    activeTabId = null
    activeJob = null
  }
})
