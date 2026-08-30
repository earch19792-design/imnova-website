import {
  BUILD_ID,
  BUILD_VERSION,
  OPTIONAL_LUNA_ORIGINS,
} from "./contract.mjs"

const checkButton = document.querySelector("#check")
const transferButton = document.querySelector("#transfer")
const diagnoseButton = document.querySelector("#diagnose")
const status = document.querySelector("#status")
const diagnosis = document.querySelector("#diagnosis")
const ADMIN_CONTEXT_PROBE =
  "SELLER_OS_LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_PROBE_V1"
let confirmedAdminTabId = null

function safeStatus(value) {
  status.textContent = /^[A-Z0-9_]{3,160}$/.test(String(value ?? ""))
    ? value : "LUNA_OWNER_EXTENSION_FAILED_CLOSED"
}

async function confirmAdminContext({ requireChallenge = true } = {}) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tabs.length !== 1 || !Number.isInteger(tabs[0]?.id)) {
    throw new Error("LUNA_OWNER_EXTENSION_ADMIN_TAB_REQUIRED")
  }
  const response = await chrome.tabs.sendMessage(tabs[0].id, {
    type: ADMIN_CONTEXT_PROBE,
  }).catch(() => null)
  if (!response?.success || response.adminContextConfirmed !== true ||
      response.buildId !== BUILD_ID || response.version !== BUILD_VERSION) {
    throw new Error("LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_UNCONFIRMED")
  }
  if (requireChallenge && response.challengeStatePresent !== true) {
    throw new Error("LUNA_OWNER_EXTENSION_FRESH_CHALLENGE_REQUIRED")
  }
  confirmedAdminTabId = tabs[0].id
  return confirmedAdminTabId
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null
}

function renderDiagnosis(result) {
  const counts = [
    result.browserApplicableCookieCountForAccountHost,
    result.browserApplicableCookieCountForWwwAccountUrl,
    result.overlapCookieIdentityCount,
    result.accountOnlyCookieIdentityCount,
    result.wwwOnlyCookieIdentityCount,
  ].map(safeCount)
  if (result.ownerBrowserProtectedPageAuthenticated !== true ||
      counts.some((value) => value === null) ||
      !/^[A-Z_]{3,80}$/.test(result.finalAuthenticatedHostClass ?? "") ||
      !/^[A-Z_]{3,80}$/.test(result.finalAuthenticatedPathClass ?? "")) {
    throw new Error("LUNA_OWNER_EXTENSION_COOKIE_DIAGNOSIS_INVALID")
  }
  diagnosis.replaceChildren(...[
    `FINAL_AUTHENTICATED_HOST_CLASS=${result.finalAuthenticatedHostClass}`,
    `FINAL_AUTHENTICATED_PATH_CLASS=${result.finalAuthenticatedPathClass}`,
    `BROWSER_APPLICABLE_COOKIE_COUNT_FOR_ACCOUNT_HOST=${counts[0]}`,
    `BROWSER_APPLICABLE_COOKIE_COUNT_FOR_WWW_ACCOUNT_URL=${counts[1]}`,
    `OVERLAP_COOKIE_IDENTITY_COUNT=${counts[2]}`,
    `ACCOUNT_ONLY_COOKIE_IDENTITY_COUNT=${counts[3]}`,
    `WWW_ONLY_COOKIE_IDENTITY_COUNT=${counts[4]}`,
    "OWNER_BROWSER_PROTECTED_PAGE_AUTHENTICATED=true",
  ].flatMap((line) => [document.createTextNode(line),
    document.createElement("br")]))
  diagnosis.hidden = false
}

function resetConfirmation() {
  confirmedAdminTabId = null
  transferButton.disabled = true
}

checkButton.addEventListener("click", async () => {
  checkButton.disabled = true
  diagnoseButton.disabled = true
  resetConfirmation()
  safeStatus("LUNA_OWNER_EXTENSION_CHECKING_ADMIN_CONTEXT")
  try {
    await confirmAdminContext()
    transferButton.disabled = false
    safeStatus("LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_CONFIRMED")
  } catch (cause) {
    safeStatus(cause instanceof Error ? cause.message : cause)
  } finally {
    checkButton.disabled = false
    diagnoseButton.disabled = false
  }
})

diagnoseButton.addEventListener("click", async () => {
  diagnoseButton.disabled = true
  checkButton.disabled = true
  transferButton.disabled = true
  diagnosis.hidden = true
  diagnosis.replaceChildren()
  safeStatus("LUNA_OWNER_EXTENSION_COOKIE_DIAGNOSIS_RUNNING")
  try {
    const adminTabId = await confirmAdminContext({ requireChallenge: false })
    const granted = await chrome.permissions.request({
      permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
    })
    if (!granted) throw new Error("LUNA_OWNER_EXTENSION_PERMISSION_DENIED")
    const result = await chrome.runtime.sendMessage({
      type: "SELLER_OS_LUNA_OWNER_EXTENSION_DIAGNOSE_COOKIE_CONTRACT_V1",
      adminTabId,
    })
    if (!result?.success) {
      throw new Error(result?.error ?? "LUNA_OWNER_EXTENSION_FAILED_CLOSED")
    }
    renderDiagnosis(result)
    safeStatus("LUNA_OWNER_EXTENSION_COOKIE_CONTRACT_DIAGNOSIS_READY")
  } catch (cause) {
    safeStatus(cause instanceof Error ? cause.message : cause)
  } finally {
    diagnoseButton.disabled = false
    checkButton.disabled = false
  }
})

transferButton.addEventListener("click", async () => {
  transferButton.disabled = true
  checkButton.disabled = true
  diagnoseButton.disabled = true
  safeStatus("LUNA_OWNER_EXTENSION_PERMISSION_REQUEST")
  try {
    const adminTabId = await confirmAdminContext()
    const granted = await chrome.permissions.request({
      permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
    })
    if (!granted) throw new Error("LUNA_OWNER_EXTENSION_PERMISSION_DENIED")
    safeStatus("LUNA_OWNER_EXTENSION_CAPTURING_IN_MEMORY")
    const result = await chrome.runtime.sendMessage({
      type: "SELLER_OS_LUNA_OWNER_EXTENSION_EXECUTE_V1",
      adminTabId,
    })
    if (!result?.success) {
      throw new Error(result?.error ?? "LUNA_OWNER_EXTENSION_FAILED_CLOSED")
    }
    if (result.cookieSetCandidateCount !== 1) {
      throw new Error("LUNA_OWNER_EXTENSION_COOKIE_SET_NOT_UNIQUE")
    }
    safeStatus("LUNA_OWNER_EXTENSION_ENCRYPTED_HANDOFF_DELIVERED_SET_1")
  } catch (cause) {
    safeStatus(cause instanceof Error ? cause.message : cause)
  } finally {
    resetConfirmation()
    checkButton.disabled = false
    diagnoseButton.disabled = false
  }
})
