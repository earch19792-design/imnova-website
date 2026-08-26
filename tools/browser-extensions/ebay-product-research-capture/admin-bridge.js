(() => {
  "use strict"

  const ADMIN_ORIGIN = "https://imnova-website-z1qh-canonical-preview.vercel.app"
  const ADMIN_PATH = /^\/admin\/ebay\/mobile-review\/?$/
  const COMMAND = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
  const RESULT = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"

  if (window.top !== window || window.location.origin !== ADMIN_ORIGIN ||
    !ADMIN_PATH.test(window.location.pathname)) return

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ADMIN_ORIGIN ||
      event.data?.type !== COMMAND ||
      !/^[0-9a-f-]{36}$/i.test(event.data.requestId ?? "")) return
    const requestId = event.data.requestId
    chrome.runtime.sendMessage(event.data.command).then(
      (payload) => window.postMessage({
        type: RESULT,
        requestId,
        success: payload?.success === true,
        payload: payload?.success === true ? payload : null,
        error: payload?.success === true ? null : payload?.error ?? "RESEARCH_EXTENSION_FAILED",
        diagnosticTrace: payload?.diagnosticTrace ?? null,
        extensionId: chrome.runtime.id,
      }, ADMIN_ORIGIN),
      () => window.postMessage({
        type: RESULT,
        requestId,
        success: false,
        payload: null,
        error: "RESEARCH_EXTENSION_BRIDGE_DISCONNECTED",
        diagnosticTrace: null,
        extensionId: chrome.runtime.id,
      }, ADMIN_ORIGIN),
    )
  })

  window.postMessage({
    type: RESULT,
    requestId: "00000000-0000-4000-8000-000000000000",
    success: true,
    payload: { success: true, ready: true, version: "1.2.21" },
    extensionId: chrome.runtime.id,
  }, ADMIN_ORIGIN)
})()
