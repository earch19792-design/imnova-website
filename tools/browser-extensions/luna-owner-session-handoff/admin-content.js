(() => {
  "use strict"

  const ORIGIN = "https://imnova-seller-os-preprod.vercel.app"
  const BUILD_ID = "LUNA_OWNER_SESSION_HANDOFF_EXTENSION_V1"
  const VERSION = "1.0.2"
  const PREPARE = "SELLER_OS_LUNA_OWNER_EXTENSION_PREPARE_V1"
  const PROBE = "SELLER_OS_LUNA_OWNER_EXTENSION_PROBE_V1"
  const PREPARED = "SELLER_OS_LUNA_OWNER_EXTENSION_PREPARED_V1"
  const READY = "SELLER_OS_LUNA_OWNER_EXTENSION_READY_V1"
  const GET_CHALLENGE = "SELLER_OS_LUNA_OWNER_EXTENSION_GET_CHALLENGE_V1"
  const ADMIN_CONTEXT_PROBE =
    "SELLER_OS_LUNA_OWNER_EXTENSION_ADMIN_CONTEXT_PROBE_V1"
  const DELIVER_ENVELOPE = "SELLER_OS_LUNA_OWNER_EXTENSION_ENVELOPE_V1"
  const PAGE_ENVELOPE = "SELLER_OS_LUNA_OWNER_EXTENSION_PAGE_ENVELOPE_V1"
  let prepared = null

  function post(message) {
    window.postMessage(message, ORIGIN)
  }

  function challengeLooksBound(value) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      value.contractVersion === "SELLER_OS_LUNA_OWNER_REAUTH_HANDOFF_V1" &&
      value.targetOrigin === ORIGIN &&
      value.uploadPath === "/api/admin/ebay/luna-protected-session" &&
      value.oneTime === true && value.ownerAdminCreated === true &&
      value.plaintextSessionAccepted === false &&
      typeof value.expiresAt === "string" &&
      Date.parse(value.expiresAt) > Date.now()
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return
    if (event.data?.type === PROBE) {
      post({ type: READY, buildId: BUILD_ID, version: VERSION })
      return
    }
    if (event.data?.type !== PREPARE ||
        typeof event.data.transferId !== "string" ||
        !challengeLooksBound(event.data.challenge)) return
    prepared = Object.freeze({
      transferId: event.data.transferId,
      challenge: event.data.challenge,
    })
    post({ type: PREPARED, transferId: prepared.transferId,
      buildId: BUILD_ID, version: VERSION })
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false
    if (message?.type === ADMIN_CONTEXT_PROBE) {
      const challengeStatePresent = Boolean(prepared &&
        Date.parse(prepared.challenge.expiresAt) > Date.now())
      if (prepared && !challengeStatePresent) prepared = null
      sendResponse({
        success: true,
        adminContextConfirmed: true,
        challengeStatePresent,
        buildId: BUILD_ID,
        version: VERSION,
      })
      return false
    }
    if (message?.type === GET_CHALLENGE) {
      if (!prepared || Date.parse(prepared.challenge.expiresAt) <= Date.now()) {
        prepared = null
        sendResponse({ success: false, error: "LUNA_OWNER_HANDOFF_EXPIRED" })
      } else {
        sendResponse({ success: true, transferId: prepared.transferId,
          challenge: prepared.challenge })
      }
      return false
    }
    if (message?.type === DELIVER_ENVELOPE && prepared &&
        message.transferId === prepared.transferId && message.envelope &&
        typeof message.envelope === "object") {
      const transferId = prepared.transferId
      prepared = null
      post({ type: PAGE_ENVELOPE, transferId, envelope: message.envelope,
        buildId: BUILD_ID, version: VERSION })
      sendResponse({ accepted: true })
      return false
    }
    return false
  })

  post({ type: READY, buildId: BUILD_ID, version: VERSION })
})()
