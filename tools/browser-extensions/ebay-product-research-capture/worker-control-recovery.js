"use strict"

globalThis.SELLER_OS_PRODUCT_RESEARCH_CONTROL_RECOVERY_V1 = (() => {
  const VERSION = "PRODUCT_RESEARCH_BROWSER_RESTART_RECOVERY_V1"
  const CONTROL_PATH = "/admin/ebay/opportunity-queue/research"
  const LOGIN_PATH = "/admin/login"

  function parsedUrl(value) {
    try { return new URL(typeof value === "string" ? value : "") }
    catch { return null }
  }

  function isControlUrl(value) {
    const url = parsedUrl(value)
    return Boolean(url && url.pathname === CONTROL_PATH &&
      url.searchParams.get("mayelResearchWorker") === "auto" &&
      url.searchParams.get("browserWorkerControl") === "1")
  }

  function isControlAuthRedirect(value) {
    const url = parsedUrl(value)
    if (!url || url.pathname !== LOGIN_PATH) return false
    const returnTo = url.searchParams.get("returnTo")
    if (!returnTo) return false
    try {
      const target = new URL(returnTo, url.origin)
      return target.origin === url.origin && isControlUrl(target.href)
    } catch { return false }
  }

  function classifyTabs(tabs) {
    const controlTabs = []
    const waitingAuthTabs = []
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!Number.isInteger(tab?.id)) continue
      if (isControlUrl(tab?.url)) controlTabs.push(tab)
      else if (isControlAuthRedirect(tab?.url)) waitingAuthTabs.push(tab)
    }
    return Object.freeze({
      controlTabs: Object.freeze(controlTabs),
      waitingAuthTabs: Object.freeze(waitingAuthTabs),
    })
  }

  function decide(tabs, forceReloadExisting = false) {
    const classified = classifyTabs(tabs)
    if (classified.controlTabs.length > 0) return Object.freeze({
      version: VERSION,
      action: forceReloadExisting ? "RELOAD_CONTROL_PAGE" :
        "REUSE_CONTROL_PAGE",
      primaryTabId: classified.controlTabs[0].id,
      duplicateTabIds: Object.freeze([
        ...classified.controlTabs.slice(1), ...classified.waitingAuthTabs,
      ].map((tab) => tab.id)),
      workerState: "RECOVERING",
      blockerCode: null,
    })
    if (classified.waitingAuthTabs.length > 0) return Object.freeze({
      version: VERSION,
      action: "WAIT_FOR_AUTH",
      primaryTabId: classified.waitingAuthTabs[0].id,
      duplicateTabIds: Object.freeze(
        classified.waitingAuthTabs.slice(1).map((tab) => tab.id)),
      workerState: "WAITING_AUTH_REQUIRED",
      blockerCode: "AUTHENTICATED_CONTROL_PAGE_NOT_BOOTSTRAPPED",
    })
    return Object.freeze({
      version: VERSION,
      action: "CREATE_CONTROL_PAGE",
      primaryTabId: null,
      duplicateTabIds: Object.freeze([]),
      workerState: "RECOVERING",
      blockerCode: null,
    })
  }

  return Object.freeze({ VERSION, isControlUrl, isControlAuthRedirect,
    classifyTabs, decide })
})()
