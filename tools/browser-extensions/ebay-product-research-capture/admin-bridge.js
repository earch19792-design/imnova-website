(() => {
  "use strict"

  const ADMIN_ORIGINS = new Set([
    "https://imnova-website-z1qh-canonical-preview.vercel.app",
    "https://imnova-seller-os-preprod.vercel.app",
    "https://imnova-ebay-mobile-preprod.vercel.app",
  ])
  const ADMIN_SCOPE_PATH = /^\/admin\/ebay(?:\/|$)/
  const OPERATIONAL_PATH = /^\/admin\/ebay\/(?:mobile-review|opportunity-queue\/research)\/?$/
  const COMMAND = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
  const RESULT = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"
  const LIFECYCLE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1"
  const PROBE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"
  const TRACE_VERSION = "ONE_CLICK_EXTENSION_HANDSHAKE_TRACE_V1"
  const PASSIVE_REQUEST_ID = "00000000-0000-4000-8000-000000000000"
  const INSTANCE_KEY = "__IMNOVA_EBAY_ONE_CLICK_ADMIN_BRIDGE_V1__"

  if (window.top !== window || !ADMIN_ORIGINS.has(window.location.origin) ||
    !ADMIN_SCOPE_PATH.test(window.location.pathname)) return

  const adminOrigin = window.location.origin

  if (globalThis[INSTANCE_KEY]) {
    globalThis[INSTANCE_KEY].syncRoute()
    return
  }

  let probeEventsReceived = 0
  let ackEventsSent = 0
  let bridgeActive = false

  function extensionContextState() {
    try {
      return chrome.runtime?.id ? "ACTIVE" : "INVALIDATED"
    } catch {
      return "INVALIDATED"
    }
  }

  function extensionId() {
    try {
      return chrome.runtime?.id ?? "UNKNOWN"
    } catch {
      return "UNKNOWN"
    }
  }

  function extensionVersion() {
    try {
      return chrome.runtime?.getManifest?.().version ?? "UNKNOWN"
    } catch {
      return "UNKNOWN"
    }
  }

  function postLifecycle(requestId, stage, serviceWorkerResponse = "UNOBSERVED") {
    window.postMessage({
      type: LIFECYCLE,
      requestId,
      traceVersion: TRACE_VERSION,
      stage,
      adminBridgeInjected: true,
      adminBridgeBooted: true,
      bridgeListenerRegistered: true,
      probeEventsReceivedByBridge: Math.min(probeEventsReceived, 32),
      ackEventsSent: Math.min(ackEventsSent, 32),
      extensionContextState: extensionContextState(),
      serviceWorkerResponse,
    }, adminOrigin)
  }

  function receiveCommand(event) {
    if (!bridgeActive || !OPERATIONAL_PATH.test(window.location.pathname) ||
      window.location.origin !== adminOrigin) return
    if (event.source !== window || event.origin !== adminOrigin ||
      event.data?.type !== COMMAND ||
      !/^[0-9a-f-]{36}$/i.test(event.data.requestId ?? "")) return
    const requestId = event.data.requestId
    const isProbe = event.data.command?.type === PROBE
    if (isProbe) {
      probeEventsReceived += 1
      postLifecycle(requestId, "PROBE_RECEIVED_BY_BRIDGE", "PENDING")
    }
    let response
    try {
      response = chrome.runtime.sendMessage(event.data.command)
    } catch {
      if (isProbe) postLifecycle(requestId, "SERVICE_WORKER_RESPONSE_FAILED", "FAILED")
      window.postMessage({
        type: RESULT,
        requestId,
        success: false,
        payload: null,
        error: "RESEARCH_EXTENSION_BRIDGE_DISCONNECTED",
        diagnosticTrace: null,
        extensionId: extensionId(),
      }, adminOrigin)
      return
    }
    Promise.resolve(response).then(
      (payload) => {
        if (isProbe && payload?.success === true) {
          ackEventsSent += 1
          postLifecycle(requestId, "ACK_SENT_BY_BRIDGE", "ACK")
        } else if (isProbe) {
          postLifecycle(requestId, "SERVICE_WORKER_RESPONSE_FAILED", "FAILED")
        }
        window.postMessage({
          type: RESULT,
          requestId,
          success: payload?.success === true,
          payload: payload?.success === true ? payload : null,
          error: payload?.success === true ? null : payload?.error ?? "RESEARCH_EXTENSION_FAILED",
          diagnosticTrace: payload?.diagnosticTrace ?? null,
          extensionId: extensionId(),
        }, adminOrigin)
      },
      () => {
        if (isProbe) postLifecycle(requestId, "SERVICE_WORKER_RESPONSE_FAILED", "FAILED")
        window.postMessage({
          type: RESULT,
          requestId,
          success: false,
          payload: null,
          error: "RESEARCH_EXTENSION_BRIDGE_DISCONNECTED",
          diagnosticTrace: null,
          extensionId: extensionId(),
        }, adminOrigin)
      },
    )
  }

  function activateBridge() {
    if (bridgeActive) return
    bridgeActive = true
    window.addEventListener("message", receiveCommand)
    postLifecycle(PASSIVE_REQUEST_ID, "BRIDGE_LISTENER_REGISTERED")
    window.postMessage({
      type: RESULT,
      requestId: PASSIVE_REQUEST_ID,
      success: true,
      payload: { success: true, ready: true, version: extensionVersion() },
      extensionId: extensionId(),
    }, adminOrigin)
  }

  function deactivateBridge() {
    if (!bridgeActive) return
    bridgeActive = false
    window.removeEventListener("message", receiveCommand)
  }

  function syncRoute() {
    if (window.location.origin === adminOrigin &&
      OPERATIONAL_PATH.test(window.location.pathname)) activateBridge()
    else deactivateBridge()
  }

  const routeObserver = new MutationObserver(syncRoute)
  routeObserver.observe(document, { childList: true, subtree: true })
  for (const eventName of ["popstate", "hashchange", "pageshow"]) {
    window.addEventListener(eventName, syncRoute)
  }
  window.navigation?.addEventListener?.("navigatesuccess", syncRoute)

  globalThis[INSTANCE_KEY] = { syncRoute }
  syncRoute()
})()
