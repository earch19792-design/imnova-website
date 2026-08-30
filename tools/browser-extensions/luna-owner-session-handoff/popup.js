import { OPTIONAL_LUNA_ORIGINS } from "./contract.mjs"

const button = document.querySelector("#transfer")
const status = document.querySelector("#status")

function safeStatus(value) {
  status.textContent = /^[A-Z0-9_]{3,160}$/.test(String(value ?? ""))
    ? value : "LUNA_OWNER_EXTENSION_FAILED_CLOSED"
}

button.addEventListener("click", async () => {
  button.disabled = true
  safeStatus("LUNA_OWNER_EXTENSION_PERMISSION_REQUEST")
  try {
    const granted = await chrome.permissions.request({
      permissions: ["cookies"], origins: [...OPTIONAL_LUNA_ORIGINS],
    })
    if (!granted) throw new Error("LUNA_OWNER_EXTENSION_PERMISSION_DENIED")
    safeStatus("LUNA_OWNER_EXTENSION_CAPTURING_IN_MEMORY")
    const result = await chrome.runtime.sendMessage({
      type: "SELLER_OS_LUNA_OWNER_EXTENSION_EXECUTE_V1",
    })
    if (!result?.success) {
      throw new Error(result?.error ?? "LUNA_OWNER_EXTENSION_FAILED_CLOSED")
    }
    safeStatus("LUNA_OWNER_EXTENSION_ENCRYPTED_HANDOFF_DELIVERED")
  } catch (cause) {
    safeStatus(cause instanceof Error ? cause.message : cause)
  } finally {
    button.disabled = false
  }
})
