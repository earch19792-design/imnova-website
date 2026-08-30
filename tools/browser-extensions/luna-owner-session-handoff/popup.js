import {
  BUILD_ID,
  BUILD_VERSION,
  OPTIONAL_LUNA_ORIGINS,
} from "./contract.mjs"

const checkButton = document.querySelector("#check")
const transferButton = document.querySelector("#transfer")
const status = document.querySelector("#status")
const ADMIN_CONTEXT_PROBE =
  "SELLER_OS_LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_PROBE_V1"
let confirmedAdminTabId = null

function safeStatus(value) {
  status.textContent = /^[A-Z0-9_]{3,160}$/.test(String(value ?? ""))
    ? value : "LUNA_OWNER_EXTENSION_FAILED_CLOSED"
}

async function confirmAdminContext() {
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
  if (response.challengeStatePresent !== true) {
    throw new Error("LUNA_OWNER_EXTENSION_FRESH_CHALLENGE_REQUIRED")
  }
  confirmedAdminTabId = tabs[0].id
  return confirmedAdminTabId
}

function resetConfirmation() {
  confirmedAdminTabId = null
  transferButton.disabled = true
}

checkButton.addEventListener("click", async () => {
  checkButton.disabled = true
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
  }
})

transferButton.addEventListener("click", async () => {
  transferButton.disabled = true
  checkButton.disabled = true
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
  }
})
