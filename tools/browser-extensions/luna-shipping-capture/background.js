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

function safeJob(value) {
  const job = value && typeof value === "object" ? value : {}
  const identity = job.identity && typeof job.identity === "object"
    ? job.identity : {}
  if (job.contractVersion !== CONTRACT ||
      !/^[0-9a-f-]{36}$/i.test(job.captureSessionId ?? "") ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(job.nonce ?? "") ||
      !/^sha256:[0-9a-f]{64}$/.test(identity.candidateId ?? "") ||
      !/^\d{8,24}$/.test(identity.lunaProductId ?? "") ||
      !/^\d{8,24}$/.test(identity.lunaVariantId ?? "") ||
      typeof identity.supplierSku !== "string" ||
      !Number.isInteger(identity.quantity) || identity.quantity < 1 ||
      identity.quantity > 20 || !exactLunaUrl(identity.canonicalProductUrl)) return null
  return job
}

function encodeJob(job) {
  const bytes = new TextEncoder().encode(JSON.stringify(job))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function startJob(job) {
  const exact = safeJob(job)
  const url = exact && exactLunaUrl(exact.identity.canonicalProductUrl)
  if (!exact || !url) throw new Error("LUNA_SHIPPING_EXTENSION_JOB_INVALID")
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
  void chrome.tabs.create({ url: `${CONTROL_PAGE}?autostart=1`, active: true })
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

chrome.runtime.onMessage.addListener((message, sender) => {
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
