(() => {
  "use strict"

  const ADMIN_ORIGINS = new Set([
    "https://imnova-website-z1qh-canonical-preview.vercel.app",
    "https://imnova-seller-os-preprod.vercel.app",
    "https://imnova-ebay-mobile-preprod.vercel.app",
  ])
  const ADMIN_SCOPE_PATH = /^\/admin\/(?:ebay(?:\/|$)|ebay-seller-os(?:\/|$))/
  const OPERATIONAL_PATH = /^\/admin\/(?:ebay\/(?:mobile-review|opportunity-queue\/research|commercial-trace)|ebay-seller-os)\/?$/
  const COMMAND = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
  const RESULT = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"
  const LIFECYCLE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1"
  const PROBE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"
  const TRACE_VERSION = "ONE_CLICK_EXTENSION_HANDSHAKE_TRACE_V1"
  const BRIDGE_VERSION = "PRODUCT_RESEARCH_ADMIN_BRIDGE_V2"
  const PASSIVE_REQUEST_ID = "00000000-0000-4000-8000-000000000000"
  // The versioned key is intentional. After an extension reload Chrome can
  // leave the old, invalidated isolated world alive in an already-open tab.
  // A newly injected build must never mistake that obsolete bridge for itself.
  const INSTANCE_KEY = "__IMNOVA_EBAY_ONE_CLICK_ADMIN_BRIDGE_V2__"

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
  const bridgeInstanceId = globalThis.crypto?.randomUUID?.() ??
    `bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`

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
      bridgeVersion: BRIDGE_VERSION,
      bridgeInstanceId,
      extensionVersion: extensionVersion(),
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

  function classifiedRuntimeFailure(error) {
    if (extensionContextState() !== "ACTIVE") {
      return "CONTENT_SCRIPT_CONTEXT_INVALIDATED"
    }
    const message = String(error?.message ?? error ?? "").toLowerCase()
    if (/extension[_ ]context[_ ]invalidated|context[_ ]invalidated|runtime\.id/.test(message)) {
      return "CONTENT_SCRIPT_CONTEXT_INVALIDATED"
    }
    if (/receiving end does not exist|could not establish connection|message port closed/.test(message)) {
      return "EXTENSION_RUNTIME_UNREACHABLE"
    }
    return "SERVICE_WORKER_MESSAGE_FAILED"
  }

  function postResult(requestId, payload, error = null) {
    const success = payload?.success === true && !error
    window.postMessage({
      type: RESULT,
      requestId,
      success,
      payload: success ? payload : null,
      error: success ? null : error ?? payload?.error ??
        "SERVICE_WORKER_MESSAGE_FAILED",
      diagnosticTrace: payload?.diagnosticTrace ?? null,
      extensionId: extensionId(),
      bridgeVersion: BRIDGE_VERSION,
      bridgeInstanceId,
      bridgeExtensionVersion: extensionVersion(),
      runtimeReachable: success && payload?.runtimeReachable === true,
      serviceWorkerResponse: payload?.serviceWorkerResponse ??
        (success ? "RESPONSE_RECEIVED" : "FAILED"),
    }, adminOrigin)
  }

  function receiveCommand(event) {
    if (!bridgeActive || !OPERATIONAL_PATH.test(window.location.pathname) ||
      window.location.origin !== adminOrigin) return
    if (event.source !== window || event.origin !== adminOrigin ||
      event.data?.type !== COMMAND ||
      !/^[0-9a-f-]{36}$/i.test(event.data.requestId ?? "")) return
    const requestId = event.data.requestId
    if (event.data.requiredBridgeVersion &&
      event.data.requiredBridgeVersion !== BRIDGE_VERSION) return
    const isProbe = event.data.command?.type === PROBE
    if (isProbe) {
      probeEventsReceived += 1
      postLifecycle(requestId, "PROBE_RECEIVED_BY_BRIDGE", "PENDING")
    }
    let response
    try {
      response = chrome.runtime.sendMessage(event.data.command)
    } catch (error) {
      const code = classifiedRuntimeFailure(error)
      if (isProbe) postLifecycle(requestId, "SERVICE_WORKER_RESPONSE_FAILED", "FAILED")
      postResult(requestId, null, code)
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
        postResult(requestId, payload,
          payload?.success === true ? null : payload?.error ??
            "SERVICE_WORKER_MESSAGE_FAILED")
      },
      (error) => {
        if (isProbe) postLifecycle(requestId, "SERVICE_WORKER_RESPONSE_FAILED", "FAILED")
        postResult(requestId, null, classifiedRuntimeFailure(error))
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
      payload: { success: true, ready: true, version: extensionVersion(),
        bridgeVersion: BRIDGE_VERSION, bridgeInstanceId,
        runtimeReachable: false, serviceWorkerResponse: "UNOBSERVED" },
      extensionId: extensionId(),
      bridgeVersion: BRIDGE_VERSION,
      bridgeInstanceId,
      bridgeExtensionVersion: extensionVersion(),
      runtimeReachable: false,
      serviceWorkerResponse: "UNOBSERVED",
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
