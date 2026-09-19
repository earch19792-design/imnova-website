(() => {
  "use strict"

  const RETRYABLE = new Set(["STALE_DOCUMENT_RESPONSE", "NAVIGATION_TIMEOUT"])

  function clean(value, maximum = 1_000) {
    return typeof value === "string"
      ? value.normalize("NFKC").trim().slice(0, maximum) : ""
  }

  function iso(value) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }

  function filterProofStatus(value, expectedQuery) {
    try {
      const url = new URL(clean(value))
      if (url.protocol !== "https:" || url.hostname !== "www.ebay.com" ||
          !/^\/sch\//.test(url.pathname)) return "STALE_DOCUMENT_RESPONSE"
      const normalizedQuery = clean(url.searchParams.get("_nkw"), 100)
      if (normalizedQuery !== clean(expectedQuery, 100) ||
          url.searchParams.get("LH_Sold") !== "1" ||
          url.searchParams.get("LH_Complete") !== "1") {
        return "STALE_DOCUMENT_RESPONSE"
      }
      return url.searchParams.get("LH_FS") === "1"
        ? "FREE_SHIPPING_FILTER_PROVEN" : "FILTER_REMOVED_BY_EBAY"
    } catch {
      return "STALE_DOCUMENT_RESPONSE"
    }
  }

  function failure(code, evidence) {
    const error = new Error(code)
    error.navigationEvidence = Object.freeze({ ...evidence,
      filterProofStatus: code })
    return error
  }

  function captureBinding(navigation, expectedQuery, captureNonce) {
    const binding = Object.freeze({
      tabId: Number(navigation?.tabId),
      documentId: clean(navigation?.documentId, 100),
      effectiveUrl: clean(navigation?.effectiveUrl),
      query: clean(expectedQuery, 100),
      branch: "FREE_SHIPPING_ONLY",
      captureNonce: clean(captureNonce, 100),
    })
    if (!Number.isInteger(binding.tabId) || !binding.documentId ||
        !binding.captureNonce || filterProofStatus(binding.effectiveUrl,
          binding.query) !== "FREE_SHIPPING_FILTER_PROVEN") {
      throw failure("NAVIGATION_BINDING_UNAVAILABLE", navigation ?? {})
    }
    return binding
  }

  function sameCaptureBinding(expected, observed) {
    return Number(observed?.tabId) === Number(expected?.tabId) &&
      clean(observed?.documentId, 100) === clean(expected?.documentId, 100) &&
      clean(observed?.effectiveUrl) === clean(expected?.effectiveUrl) &&
      clean(observed?.query, 100) === clean(expected?.query, 100) &&
      observed?.branch === "FREE_SHIPPING_ONLY" &&
      clean(observed?.captureNonce, 100) === clean(expected?.captureNonce, 100)
  }

  async function assertAuthoritativeDocument(chromeApi, binding, navigation) {
    let frame
    try {
      frame = await chromeApi?.webNavigation?.getFrame?.({
        tabId: binding.tabId, frameId: 0,
      })
    } catch {
      throw failure("STALE_DOCUMENT_RESPONSE", navigation)
    }
    const currentDocumentId = clean(frame?.documentId, 100)
    const currentUrl = clean(frame?.url)
    if (currentDocumentId !== binding.documentId ||
        currentUrl !== binding.effectiveUrl ||
        filterProofStatus(currentUrl, binding.query) !==
          "FREE_SHIPPING_FILTER_PROVEN") {
      throw failure("STALE_DOCUMENT_RESPONSE", Object.freeze({
        ...navigation, effectiveUrl: currentUrl || navigation?.effectiveUrl,
        documentId: currentDocumentId || navigation?.documentId,
        filterProofStatus: "STALE_DOCUMENT_RESPONSE",
      }))
    }
    return Object.freeze({ documentId: currentDocumentId, url: currentUrl })
  }

  function waitForFreeShippingNavigation(input) {
    const chromeApi = input.chromeApi
    const requestedUrl = clean(input.requestedUrl)
    const expectedQuery = clean(input.expectedQuery, 100)
    const tabId = Number(input.tabId)
    const timeoutMs = Math.max(250, Math.min(30_000,
      Number(input.timeoutMs) || 12_000))
    const now = typeof input.now === "function" ? input.now : Date.now
    const navigationStartedAt = iso(now())
    const bindingId = clean(input.bindingId, 100)
    if (!Number.isInteger(tabId) || !requestedUrl || !expectedQuery || !bindingId ||
        !chromeApi?.tabs?.update || !chromeApi?.tabs?.onUpdated ||
        !chromeApi?.webNavigation?.onCommitted ||
        !chromeApi?.webNavigation?.onCompleted) {
      return Promise.reject(failure("NAVIGATION_BINDING_UNAVAILABLE", {
        requestedUrl, pendingUrl: null, effectiveUrl: null, tabId,
        documentId: null, navigationStartedAt, navigationCompletedAt: null,
        bindingId,
      }))
    }
    return new Promise((resolve, reject) => {
      let previousDocumentId = null
      let pendingUrl = requestedUrl
      let committed = null
      let completed = null
      let tabComplete = null
      let settled = false

      const evidence = (status, effectiveUrl = null, documentId = null,
        completedAt = null) => Object.freeze({ requestedUrl, pendingUrl,
        effectiveUrl, tabId, documentId, navigationStartedAt,
        navigationCompletedAt: completedAt, filterProofStatus: status,
        bindingId })
      const cleanup = () => {
        clearTimeout(timer)
        chromeApi.tabs.onUpdated.removeListener(onTabUpdated)
        chromeApi.webNavigation.onCommitted.removeListener(onCommitted)
        chromeApi.webNavigation.onCompleted.removeListener(onCompleted)
        chromeApi.webNavigation.onErrorOccurred?.removeListener?.(onError)
      }
      const finish = () => {
        if (settled || !committed || !completed || !tabComplete) return
        if (committed.documentId && completed.documentId &&
            committed.documentId !== completed.documentId) return
        const documentId = clean(completed.documentId || committed.documentId, 100)
        if (!documentId || documentId === previousDocumentId) return
        const effectiveUrl = clean(completed.url || committed.url || tabComplete.url)
        const proof = filterProofStatus(effectiveUrl, expectedQuery)
        const completedAt = iso(Math.max(completed.timeStamp || 0,
          tabComplete.timeStamp || 0, now()))
        const result = evidence(proof, effectiveUrl, documentId, completedAt)
        settled = true
        cleanup()
        if (proof !== "FREE_SHIPPING_FILTER_PROVEN") reject(failure(proof, result))
        else resolve(result)
      }
      const onCommitted = (details) => {
        if (details?.tabId !== tabId || details?.frameId !== 0) return
        const proof = filterProofStatus(details.url, expectedQuery)
        if (proof === "STALE_DOCUMENT_RESPONSE") return
        committed = details
        finish()
      }
      const onCompleted = (details) => {
        if (details?.tabId !== tabId || details?.frameId !== 0) return
        const proof = filterProofStatus(details.url, expectedQuery)
        if (proof === "STALE_DOCUMENT_RESPONSE") return
        completed = details
        finish()
      }
      const onTabUpdated = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId || changeInfo?.status !== "complete") return
        const effectiveUrl = clean(tab?.url || changeInfo?.url)
        const proof = filterProofStatus(effectiveUrl, expectedQuery)
        if (proof === "STALE_DOCUMENT_RESPONSE") return
        tabComplete = { url: effectiveUrl, timeStamp: now() }
        finish()
      }
      const onError = (details) => {
        if (details?.tabId !== tabId || details?.frameId !== 0 || settled) return
        settled = true
        cleanup()
        reject(failure("NAVIGATION_FAILED", evidence("NAVIGATION_FAILED",
          clean(details.url), clean(details.documentId, 100), iso(now()))))
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(failure("NAVIGATION_TIMEOUT", evidence("NAVIGATION_TIMEOUT",
          clean(completed?.url || committed?.url || tabComplete?.url),
          clean(completed?.documentId || committed?.documentId, 100), null)))
      }, timeoutMs)

      chromeApi.tabs.onUpdated.addListener(onTabUpdated)
      chromeApi.webNavigation.onCommitted.addListener(onCommitted)
      chromeApi.webNavigation.onCompleted.addListener(onCompleted)
      chromeApi.webNavigation.onErrorOccurred?.addListener?.(onError)
      void (async () => {
        try {
          const previous = await chromeApi.webNavigation.getFrame?.({ tabId,
            frameId: 0 })
          previousDocumentId = clean(previous?.documentId, 100) || null
          const updated = await chromeApi.tabs.update(tabId, {
            url: requestedUrl, active: false })
          pendingUrl = clean(updated?.pendingUrl || updated?.url) || requestedUrl
        } catch {
          if (settled) return
          settled = true
          cleanup()
          reject(failure("NAVIGATION_FAILED", evidence("NAVIGATION_FAILED")))
        }
      })()
    })
  }

  function verifyBoundCapture(navigation, response, expectedBinding) {
    const responseUrl = clean(response?.documentUrl)
    const responseDocumentId = clean(response?.documentId, 100)
    const expectedDocumentId = clean(navigation?.documentId, 100)
    const bindingMatches = clean(response?.navigationBindingId, 100) ===
      clean(navigation?.bindingId, 100)
    const urlProof = filterProofStatus(responseUrl,
      new URL(navigation.requestedUrl).searchParams.get("_nkw"))
    if (!bindingMatches || !sameCaptureBinding(expectedBinding,
        response?.captureBinding) ||
        urlProof !== "FREE_SHIPPING_FILTER_PROVEN" ||
        !expectedDocumentId || responseDocumentId !== expectedDocumentId) {
      throw failure("STALE_DOCUMENT_RESPONSE", navigation)
    }
    return response
  }

  function mergeFreeShippingEvidence(current, candidate) {
    const observation = Object.freeze({
      itemId: clean(candidate?.itemId, 30),
      soldAt: clean(candidate?.soldAt, 80) || null,
      capturedAt: clean(candidate?.capturedAt, 80) || null,
      query: clean(candidate?.queryOrResearchIdentity, 100),
      branch: "FREE_SHIPPING_ONLY",
      shippingAmount: 0,
      shippingEvidence: "PROVEN_ZERO_BY_SEARCH_FILTER",
      evidenceScope: "SINGLE_CAPTURED_SOLD_OBSERVATION",
      navigationEvidence: candidate?.navigationEvidence ?? null,
    })
    if (!current) return { ...candidate,
      shippingSearchBranch: "FREE_SHIPPING_ONLY",
      shippingEvidenceScope: "SINGLE_CAPTURED_SOLD_OBSERVATION",
      shippingEvidenceAppliesToConfirmedSoldQuantity: 1,
      shippingObservations: [observation] }
    const sameItem = clean(current.itemId, 30) === clean(candidate?.itemId, 30)
    const sameQuery = clean(current.queryOrResearchIdentity, 100) ===
      clean(candidate?.queryOrResearchIdentity, 100)
    const shipping = candidate?.fieldProvenance?.shipping
    if (!sameItem || !sameQuery || candidate?.visibleShippingAmount !== 0 ||
        candidate?.shippingStatus !== "OBSERVED" ||
        candidate?.shippingEvidence !== "PROVEN_ZERO_BY_SEARCH_FILTER" ||
        candidate?.searchBranch !== "FREE_SHIPPING_ONLY" ||
        candidate?.freeShippingFilterProven !== true ||
        candidate?.navigationEvidence?.filterProofStatus !==
          "FREE_SHIPPING_FILTER_PROVEN" ||
        shipping?.source !== "SOLD_SEARCH_FREE_SHIPPING_FILTER") return current
    const priorObservations = Array.isArray(current.shippingObservations)
      ? current.shippingObservations : []
    const shippingObservations = [...priorObservations, observation]
    const historicalQuantity = Math.max(0,
      Number(current.confirmedSoldQuantity) || 0,
      Number(current.totalSoldQuantity) || 0,
      Number(current.soldQuantity) || 0)
    if (historicalQuantity > 1) return { ...current,
      shippingSearchBranch: "FREE_SHIPPING_ONLY",
      shippingNavigationEvidence: candidate.navigationEvidence,
      shippingEvidenceScope: "SINGLE_CAPTURED_SOLD_OBSERVATION",
      shippingEvidenceAppliesToConfirmedSoldQuantity: 1,
      shippingObservations,
    }
    const displayed = Number(current.displayedSoldPriceAmount)
    return { ...current,
      visibleShippingAmount: 0,
      visibleShippingCurrency: "USD",
      shippingStatus: "OBSERVED",
      shippingEvidence: "PROVEN_ZERO_BY_SEARCH_FILTER",
      displayedDeliveredPrice: Number.isFinite(displayed) ? displayed : null,
      freeShippingFilterProven: true,
      shippingSearchBranch: "FREE_SHIPPING_ONLY",
      shippingNavigationEvidence: candidate.navigationEvidence,
      shippingEvidenceScope: "SINGLE_CAPTURED_SOLD_OBSERVATION",
      shippingEvidenceAppliesToConfirmedSoldQuantity: 1,
      shippingObservations,
      fieldProvenance: { ...(current.fieldProvenance || {}), shipping },
    }
  }

  globalThis.IMNOVA_FREE_SHIPPING_NAVIGATION_BINDING_V1 = Object.freeze({
    RETRYABLE,
    filterProofStatus,
    captureBinding,
    sameCaptureBinding,
    assertAuthoritativeDocument,
    waitForFreeShippingNavigation,
    verifyBoundCapture,
    mergeFreeShippingEvidence,
  })
})()
