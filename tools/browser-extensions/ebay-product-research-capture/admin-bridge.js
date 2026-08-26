(() => {
  "use strict"

  const ADMIN_ORIGIN = "https://imnova-website-z1qh-canonical-preview.vercel.app"
  const ADMIN_PATH = /^\/admin\/ebay\/mobile-review\/?$/
  const COMMAND = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
  const RESULT = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"
  const LIFECYCLE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1"
  const PROBE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"
  const TRACE_VERSION = "ONE_CLICK_EXTENSION_HANDSHAKE_TRACE_V1"
  const PASSIVE_REQUEST_ID = "00000000-0000-4000-8000-000000000000"

  if (window.top !== window || window.location.origin !== ADMIN_ORIGIN ||
    !ADMIN_PATH.test(window.location.pathname)) return

  let probeEventsReceived = 0
  let ackEventsSent = 0

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
    }, ADMIN_ORIGIN)
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ADMIN_ORIGIN ||
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
      }, ADMIN_ORIGIN)
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
        }, ADMIN_ORIGIN)
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
        }, ADMIN_ORIGIN)
      },
    )
  })

  postLifecycle(PASSIVE_REQUEST_ID, "BRIDGE_LISTENER_REGISTERED")
  window.postMessage({
    type: RESULT,
    requestId: PASSIVE_REQUEST_ID,
    success: true,
    payload: { success: true, ready: true, version: extensionVersion() },
    extensionId: extensionId(),
  }, ADMIN_ORIGIN)
})()
