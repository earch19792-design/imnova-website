import {
  BUILD_ID,
  BUILD_VERSION,
  LUNA_SESSION_CONSUMER_URL,
  LUNA_TAB_PATTERNS,
  OPTIONAL_LUNA_ORIGINS,
  diagnoseAuthenticatedCookieContexts,
  encryptSessionPayload,
  exactChallenge,
  safeCode,
  selectSessionCookieJar,
} from "./contract.mjs"

const GET_CHALLENGE = "SELLER_OS_LUNA_OWNER_EXTENSION_GET_CHALLENGE_V1"
const DELIVER_ENVELOPE = "SELLER_OS_LUNA_OWNER_EXTENSION_ENVELOPE_V1"
const DIAGNOSE_COOKIE_CONTRACT =
  "SELLER_OS_LUNA_OWNER_EXTENSION_DIAGNOSE_COOKIE_CONTRACT_V1"
const AUTH_MARKERS = [
  "a[href*='/account/logout']",
  "form[action*='/account/logout']",
  "a[href*='/logout']",
  "form[action*='/logout']",
  "[data-customer-id]",
  "[data-testid='account-menu']",
]
const LOGIN_MARKERS = [
  "form[action*='/account/login']",
  "form[action*='/authentication/login']",
  "input[type='password']",
]

function exactAdminTabId(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("LUNA_OWNER_EXTENSION_ADMIN_TAB_REQUIRED")
  }
  return value
}

async function exactLunaTab() {
  const tabs = await chrome.tabs.query({ url: [...LUNA_TAB_PATTERNS] })
  if (tabs.length !== 1 || !Number.isInteger(tabs[0]?.id) ||
      typeof tabs[0].url !== "string") {
    throw new Error("LUNA_OWNER_EXTENSION_EXACTLY_ONE_LUNA_TAB_REQUIRED")
  }
  const url = new URL(tabs[0].url)
  if (!new Set(["www.lunaportex.com",
    "account.lunaportex.com"]).has(url.hostname) ||
      /\/(?:login|signin|callback)(?:\/|$)/i.test(url.pathname)) {
    throw new Error("LUNA_OWNER_HANDOFF_AUTHENTICATION_NOT_COMPLETE")
  }
  return tabs[0]
}

async function proveAuthenticated(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (authMarkers, loginMarkers) => ({
      authenticatedMarker: authMarkers.some((selector) =>
        Boolean(document.querySelector(selector))),
      loginForm: loginMarkers.some((selector) =>
        Boolean(document.querySelector(selector))),
    }),
    args: [AUTH_MARKERS, LOGIN_MARKERS],
  })
  const state = results.length === 1 ? results[0]?.result : null
  if (!state?.authenticatedMarker || state.loginForm) {
    throw new Error("LUNA_OWNER_HANDOFF_AUTHENTICATION_NOT_COMPLETE")
  }
}

async function cookieStoreForTab(tabId) {
  const stores = await chrome.cookies.getAllCookieStores()
  const matches = stores.filter((store) => store.tabIds.includes(tabId))
  if (matches.length !== 1) {
    throw new Error("LUNA_OWNER_EXTENSION_COOKIE_STORE_AMBIGUOUS")
  }
  return matches[0].id
}

async function exactAuthenticatedLunaTab() {
  const tab = await exactLunaTab()
  const url = new URL(tab.url)
  if (url.protocol !== "https:" || url.hostname !== "account.lunaportex.com" ||
      /\/(?:login|signin|callback)(?:\/|$)/i.test(url.pathname)) {
    throw new Error("LUNA_OWNER_EXTENSION_AUTHENTICATED_ACCOUNT_TAB_REQUIRED")
  }
  const pathClass = /^\/orders(?:\/|$)/i.test(url.pathname)
    ? "LUNA_CUSTOMER_ORDERS"
    : "LUNA_CUSTOMER_AUTHENTICATED_ROUTE"
  return Object.freeze({
    tab,
    cookieApplicabilityUrl: `${url.origin}${url.pathname || "/"}`,
    finalAuthenticatedHostClass: "LUNA_CUSTOMER_ACCOUNT",
    finalAuthenticatedPathClass: pathClass,
  })
}

async function captureCookieContexts() {
  const authenticated = await exactAuthenticatedLunaTab()
  await proveAuthenticated(authenticated.tab.id)
  const storeId = await cookieStoreForTab(authenticated.tab.id)
  const accountHostCookies = await chrome.cookies.getAll({
    url: authenticated.cookieApplicabilityUrl,
    storeId,
  })
  const wwwAccountCookies = await chrome.cookies.getAll({
    url: LUNA_SESSION_CONSUMER_URL,
    storeId,
  })
  return { authenticated, accountHostCookies, wwwAccountCookies }
}

async function diagnoseCookieContract(adminTabIdInput) {
  exactAdminTabId(adminTabIdInput)
  const allowed = await chrome.permissions.contains({
    permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
  })
  if (!allowed) throw new Error("LUNA_OWNER_EXTENSION_PERMISSION_REQUIRED")
  const { authenticated, accountHostCookies, wwwAccountCookies } =
    await captureCookieContexts()
  try {
    return Object.freeze({
      success: true,
      code: "LUNA_OWNER_EXTENSION_COOKIE_CONTRACT_DIAGNOSIS_READY",
      buildId: BUILD_ID,
      version: BUILD_VERSION,
      ownerBrowserProtectedPageAuthenticated: true,
      finalAuthenticatedHostClass: authenticated.finalAuthenticatedHostClass,
      finalAuthenticatedPathClass: authenticated.finalAuthenticatedPathClass,
      ...diagnoseAuthenticatedCookieContexts(
        accountHostCookies,
        wwwAccountCookies,
      ),
    })
  } finally {
    accountHostCookies.length = 0
    wwwAccountCookies.length = 0
  }
}

async function captureSession(challenge) {
  exactChallenge(challenge)
  const allowed = await chrome.permissions.contains({
    permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
  })
  if (!allowed) throw new Error("LUNA_OWNER_EXTENSION_PERMISSION_REQUIRED")
  const { accountHostCookies, wwwAccountCookies } =
    await captureCookieContexts()
  const capturedAt = Date.now()
  const selected = selectSessionCookieJar(
    accountHostCookies,
    wwwAccountCookies,
    capturedAt,
  )
  try {
    return Object.freeze({
      envelope: await encryptSessionPayload(challenge, {
        cookieJar: selected.values,
        capturedAt: new Date(capturedAt).toISOString(),
        validatedAt: new Date(capturedAt).toISOString(),
        expiresAt: new Date(selected.expiresAt).toISOString(),
      }),
      cookieSetCandidateCount: 1,
      multiHostCookieSetCaptured: true,
    })
  } finally {
    selected.values.length = 0
    accountHostCookies.length = 0
    wwwAccountCookies.length = 0
  }
}

async function execute(adminTabIdInput) {
  const adminTabId = exactAdminTabId(adminTabIdInput)
  const prepared = await chrome.tabs.sendMessage(adminTabId, {
    type: GET_CHALLENGE,
  })
  if (!prepared?.success || typeof prepared.transferId !== "string") {
    throw new Error(prepared?.error === "LUNA_OWNER_HANDOFF_EXPIRED"
      ? prepared.error : "LUNA_OWNER_EXTENSION_FRESH_CHALLENGE_REQUIRED")
  }
  const challenge = exactChallenge(prepared.challenge)
  const captured = await captureSession(challenge)
  const delivered = await chrome.tabs.sendMessage(adminTabId, {
    type: DELIVER_ENVELOPE,
    transferId: prepared.transferId,
    envelope: captured.envelope,
  })
  if (!delivered?.accepted) {
    throw new Error("LUNA_OWNER_EXTENSION_ADMIN_HANDOFF_REJECTED")
  }
  return Object.freeze({
    success: true,
    code: "LUNA_OWNER_EXTENSION_ENCRYPTED_HANDOFF_DELIVERED",
    buildId: BUILD_ID,
    version: BUILD_VERSION,
    cookieSetCandidateCount: captured.cookieSetCandidateCount,
    multiHostCookieSetCaptured: captured.multiHostCookieSetCaptured,
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || ![
    "SELLER_OS_LUNA_OWNER_EXTENSION_EXECUTE_V1",
    DIAGNOSE_COOKIE_CONTRACT,
  ].includes(message?.type)) return false
  const operation = message.type === DIAGNOSE_COOKIE_CONTRACT
    ? diagnoseCookieContract(message.adminTabId)
    : execute(message.adminTabId)
  void operation.then(sendResponse).catch((cause) => sendResponse({
    success: false,
    error: safeCode(cause),
  })).finally(async () => {
    await chrome.permissions.remove({
      permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
    }).catch(() => false)
  })
  return true
})
