(() => {
  "use strict"

  const INSTALLATION_MARKER = "__IMNOVA_SOLD_CONTENT_V1_2_38__"
  if (globalThis[INSTALLATION_MARKER] === true) return
  globalThis[INSTALLATION_MARKER] = true

  const CAPTURE_MESSAGE = "IMNOVA_AUTOMATED_MAIN_SEARCH_SOLD_CAPTURE_V1"
  const SOLD_PATH = /^\/sch\//
  const MAX_ROWS = 200

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""

  function freeShippingCaptureBinding(value, queryIdentity) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Number.isInteger(Number(value.tabId)) ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(text(value.documentId)) ||
        value.branch !== "FREE_SHIPPING_ONLY" ||
        text(value.query).slice(0, 100) !== queryIdentity ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(text(value.captureNonce))) return null
    try {
      const expected = new URL(text(value.effectiveUrl))
      if (expected.href !== window.location.href ||
          expected.protocol !== "https:" || expected.hostname !== "www.ebay.com" ||
          !SOLD_PATH.test(expected.pathname) ||
          text(expected.searchParams.get("_nkw")).slice(0, 100) !== queryIdentity ||
          expected.searchParams.get("LH_Sold") !== "1" ||
          expected.searchParams.get("LH_Complete") !== "1" ||
          expected.searchParams.get("LH_FS") !== "1") return null
    } catch {
      return null
    }
    return Object.freeze({
      tabId: Number(value.tabId),
      documentId: text(value.documentId),
      effectiveUrl: text(value.effectiveUrl),
      query: queryIdentity,
      branch: "FREE_SHIPPING_ONLY",
      captureNonce: text(value.captureNonce),
    })
  }

  function visible(element) {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== "none" && style.visibility !== "hidden" &&
      rect.width > 0 && rect.height > 0
  }

  function blockedPage() {
    const body = text(document.body?.innerText).slice(0, 50_000)
    return document.querySelector(".g-recaptcha,[data-captcha],iframe[src*='captcha']") ||
      /pardon our interruption|verify you are human|security measure|access denied|captcha/i.test(body)
  }

  function listingId(link) {
    return link?.href?.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,20})(?:[/?#]|$)/)?.[1] ?? null
  }

  function titleFor(card, link) {
    return [
      card.querySelector(".s-item__title"),
      card.querySelector("[role='heading']"),
      link,
    ].map((element) => text(element?.innerText || element?.textContent ||
      element?.getAttribute?.("aria-label"))).find((value) =>
      value.length >= 4 && !/^shop on ebay$/i.test(value)) ?? ""
  }

  function soldDate(card) {
    const candidates = [
      ...card.querySelectorAll(".s-item__caption-section,.s-item__title--tagblock,[class*='caption'],[class*='sold']"),
      card,
    ].filter(visible).map((element) => text(element.innerText || element.textContent))
    for (const candidate of candidates) {
      const match = candidate.match(/\bSold\s+(?:on\s+)?([A-Z][a-z]{2,8}\s+\d{1,2},\s+20\d{2})\b/i)
      if (!match) continue
      const parsed = new Date(`${match[1]} 12:00:00 UTC`)
      if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
    }
    return null
  }

  function exactUsdAmount(value) {
    const normalized = text(value)
    if (!/(?:US\s*)?\$/i.test(normalized)) return null
    const amounts = [...normalized.replace(/,/g, "").matchAll(/(?:US\s*)?\$\s*(\d+(?:\.\d{1,2})?)/gi)]
      .map((match) => Number(match[1])).filter((amount) => Number.isFinite(amount))
    const unique = [...new Set(amounts)]
    return unique.length === 1 ? unique[0] : null
  }

  function displayedPrice(card) {
    const candidates = [...card.querySelectorAll(
      ".s-item__price,[data-testid*='price' i],[class*='price' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
    return candidates.map(exactUsdAmount).find((amount) => amount !== null) ?? null
  }

  function visibleShipping(card, freeShippingFilterProven) {
    const candidates = [...card.querySelectorAll(
      ".s-item__shipping,.s-item__logisticsCost,[data-testid*='shipping' i],[class*='shipping' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
      .filter((value) => /shipping|delivery|env[ií]o|entrega|livraison|versand|spedizione/i.test(value))
    if (!candidates.length && freeShippingFilterProven) return { amount: 0,
      status: "OBSERVED", evidence: "PROVEN_ZERO_BY_SEARCH_FILTER",
      provenanceSource: "SOLD_SEARCH_FREE_SHIPPING_FILTER" }
    if (!candidates.length) return { amount: null, status: "UNAVAILABLE",
      evidence: "UNKNOWN", provenanceSource: "SOLD_SEARCH_ROW" }
    if (candidates.some((value) => /free shipping|free delivery|env[ií]o gratis|entrega gratis|livraison gratuite|kostenloser versand|spedizione gratuita/i.test(value))) {
      return { amount: 0, status: "OBSERVED",
        evidence: "PROVEN_ZERO_BY_RESULT_TEXT",
        provenanceSource: "SOLD_SEARCH_ROW" }
    }
    const amounts = candidates.map(exactUsdAmount).filter((value) => value !== null)
    if (freeShippingFilterProven && amounts.length === 0) return { amount: 0,
      status: "OBSERVED", evidence: "PROVEN_ZERO_BY_SEARCH_FILTER",
      provenanceSource: "SOLD_SEARCH_FREE_SHIPPING_FILTER" }
    if (freeShippingFilterProven && amounts.some((value) => value > 0)) {
      return { amount: null, status: "AMBIGUOUS", evidence: "AMBIGUOUS",
        provenanceSource: "SOLD_SEARCH_ROW" }
    }
    if (amounts.length === 1) return { amount: amounts[0], status: "OBSERVED",
      evidence: "PROVEN_AMOUNT_BY_RESULT_TEXT",
      provenanceSource: "SOLD_SEARCH_ROW" }
    return { amount: null, status: "AMBIGUOUS", evidence: "AMBIGUOUS",
      provenanceSource: "SOLD_SEARCH_ROW" }
  }

  function bestOfferStatus(card) {
    const visibleText = text(card.innerText || card.textContent)
    return /best offer(?: accepted)?|offer accepted|mejor oferta|oferta aceptada|meilleure offre|offre accept[eé]e/i.test(visibleText)
      ? "EXPLICIT_PRESENT" : "UNKNOWN"
  }

  function stableSellerUsername(value) {
    const candidate = text(value)
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidate)) return null
    return /^(?:seller|shop|vendedor|vendeur|verk[aä]ufer|venditore|ebay)$/i.test(candidate)
      ? null : candidate
  }

  function sellerIdentity(card, itemId) {
    const links = [...card.querySelectorAll(
      "a[href*='/usr/' i],a[href*='/str/' i],a[href*='_ssn=' i],a[href*='seller=' i],.s-item__seller-info a,[data-testid*='seller' i] a",
    )].filter(visible)
    const usernames = new Map()
    const stores = new Map()
    for (const link of links) {
      try {
        const url = new URL(link.href, window.location.href)
        if (url.protocol !== "https:" || !/(^|\.)ebay\.com$/i.test(url.hostname)) continue
        const pathUsername = url.pathname.match(/^\/usr\/([^/?#]{2,80})/i)?.[1]
        const username = stableSellerUsername(decodeURIComponent(pathUsername ||
          url.searchParams.get("_ssn") || url.searchParams.get("seller") || ""))
        if (username) usernames.set(username.toLocaleLowerCase("en-US"), {
          username,
          profileUrl: `https://www.ebay.com/usr/${encodeURIComponent(username)}` })
        const storePath = url.pathname.match(/^\/str\/([^/?#]{2,80})/i)?.[1]
        const storeId = stableSellerUsername(decodeURIComponent(storePath || ""))
        if (storeId) {
          const profileUrl = `https://www.ebay.com/str/${encodeURIComponent(storeId)}`
          stores.set(profileUrl.toLocaleLowerCase("en-US"), {
            username: storeId, profileUrl })
        }
      } catch { /* keep looking for a stable link */ }
    }
    const candidates = [...card.querySelectorAll(
      ".s-item__seller-info-text,.s-item__seller-info,[data-testid*='seller' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
    for (const candidate of candidates) {
      const username = stableSellerUsername(candidate.match(
        /^([^\s(]{2,64})(?:\s|\(|$)/)?.[1])
      if (!username) continue
      usernames.set(username.toLocaleLowerCase("en-US"), { username,
        profileUrl: `https://www.ebay.com/usr/${encodeURIComponent(username)}` })
    }
    if (usernames.size === 1) {
      const identity = [...usernames.values()][0]
      const stable = `SELLER:${identity.username.toLocaleLowerCase("en-US")}`
      return { sellerUsername: identity.username,
        sellerProfileUrl: identity.profileUrl, stableSellerIdentity: stable,
        sellerIdentityStatus: "PROVEN",
        sellerIdentitySource: "UNIQUE_PUBLIC_SOLD_RESULT_SELLER",
        sellerIdentityKey: stable }
    }
    if (usernames.size === 0 && stores.size === 1) {
      const identity = [...stores.values()][0]
      const stable = `SELLER_PROFILE:${identity.profileUrl.toLocaleLowerCase("en-US")}`
      return { sellerUsername: identity.username,
        sellerProfileUrl: identity.profileUrl, stableSellerIdentity: stable,
        sellerIdentityStatus: "PROVEN",
        sellerIdentitySource: "UNIQUE_PUBLIC_SOLD_RESULT_SELLER_PROFILE",
        sellerIdentityKey: stable }
    }
    return { sellerUsername: null, sellerProfileUrl: null,
      stableSellerIdentity: null, sellerIdentityStatus: "UNKNOWN",
      sellerIdentitySource: usernames.size > 1 || stores.size > 1
        ? "AMBIGUOUS_PUBLIC_SELLER_IDENTITIES" : "NONE",
      sellerIdentityKey: "SELLER_IDENTITY_UNKNOWN" }
  }

  function cards() {
    const byId = new Map()
    for (const link of [...document.querySelectorAll('a[href*="/itm/"]')].filter(visible)) {
      const itemId = listingId(link)
      const card = link.closest("li.s-item,.s-item,[data-testid*='item' i],article,li")
      if (itemId && card && visible(card) && !byId.has(itemId)) byId.set(itemId, { itemId, link, card })
    }
    return [...byId.values()]
  }

  function officialZeroResults() {
    return [...document.querySelectorAll(
      ".srp-controls__count-heading,.srp-save-null-search,[data-testid*='no-result' i]",
    )].filter(visible).some((element) =>
      /(?:^|\b)0\s+results?\b|no exact matches found|no results found/i.test(
        text(element.innerText || element.textContent),
      ))
  }

  function nextPageAvailable() {
    const next = document.querySelector("a.pagination__next,a[aria-label*='next' i]")
    return Boolean(next && visible(next) && next.getAttribute("aria-disabled") !== "true")
  }

  function capture(maxRows, queryIdentity, freeShippingFilterRequired) {
    if (window.location.protocol !== "https:" || window.location.hostname !== "www.ebay.com" ||
      !SOLD_PATH.test(window.location.pathname)) throw new Error("EBAY_SOLD_PAGE_SCOPE_INVALID")
    const params = new URLSearchParams(window.location.search)
    if (params.get("LH_Sold") !== "1" || params.get("LH_Complete") !== "1" ||
      text(params.get("_nkw")) !== queryIdentity) {
      throw new Error("EBAY_SOLD_FILTER_NOT_PROVEN")
    }
    const freeShippingFilterProven = params.get("LH_FS") === "1"
    if (freeShippingFilterRequired && !freeShippingFilterProven) {
      throw new Error("EBAY_FREE_SHIPPING_FILTER_NOT_PROVEN")
    }
    if (blockedPage()) throw new Error("EBAY_SOLD_ACCESS_CHALLENGE")
    const capturedAt = new Date().toISOString()
    const rows = cards().flatMap(({ itemId, link, card }) => {
      const title = titleFor(card, link)
      const soldAt = soldDate(card)
      const displayedSoldPriceAmount = displayedPrice(card)
      if (!title || !soldAt || displayedSoldPriceAmount === null) return []
      const shipping = visibleShipping(card, freeShippingFilterProven)
      const seller = sellerIdentity(card, itemId)
      const offerStatus = bestOfferStatus(card)
      return [{
        itemId,
        title,
        soldAt,
        capturedAt,
        queryOrResearchIdentity: queryIdentity,
        displayedSoldPriceAmount,
        displayedSoldPriceCurrency: "USD",
        realizedTransactionPriceAmount: null,
        realizedTransactionPriceCurrency: null,
        realizedPriceStatus: "UNPROVEN",
        soldConfirmationStatus: "SOLD_CONFIRMED",
        displayedPriceStatus: "DISPLAYED_PRICE_CONFIRMED",
        bestOfferStatus: offerStatus,
        visibleShippingAmount: shipping.amount,
        visibleShippingCurrency: shipping.amount === null ? null : "USD",
        shippingStatus: shipping.status,
        shippingEvidence: shipping.evidence,
        displayedSoldPrice: displayedSoldPriceAmount,
        displayedDeliveredPrice: shipping.amount === null ? null
          : Math.round((displayedSoldPriceAmount + shipping.amount) * 100) / 100,
        realizedPrice: null,
        searchBranch: freeShippingFilterProven
          ? "FREE_SHIPPING_ONLY" : "ALL_SOLD",
        freeShippingFilterProven,
        ...seller,
        priceEvidenceProvenance: "MAIN_SEARCH_VISIBLE_SOLD_ROW",
        endedItemIdentityStatus: "NOT_PROVEN",
        fieldProvenance: {
          sellerIdentity: { source: "SOLD_SEARCH_ROW",
            status: seller.sellerIdentityStatus === "PROVEN" ? "CONFIRMED" : "UNKNOWN",
            observedAt: capturedAt, evidenceItemId: itemId },
          shipping: { source: shipping.provenanceSource,
            status: shipping.status === "OBSERVED" ? "OBSERVED"
              : shipping.status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNKNOWN",
            observedAt: capturedAt, evidenceItemId: itemId },
          displayedPrice: { source: "SOLD_SEARCH_ROW", status: "CONFIRMED",
            observedAt: capturedAt, evidenceItemId: itemId },
          bestOffer: { source: "SOLD_SEARCH_ROW",
            status: offerStatus === "UNKNOWN" ? "UNKNOWN" : "CONFIRMED",
            observedAt: capturedAt, evidenceItemId: itemId },
          realizedPrice: { source: "SOLD_SEARCH_ROW", status: "UNPROVEN",
            observedAt: capturedAt, evidenceItemId: itemId },
        },
      }]
    }).slice(0, maxRows)
    if (!rows.length && !officialZeroResults()) {
      throw new Error("EBAY_SOLD_MARKER_OR_DOM_UNAVAILABLE")
    }
    return {
      rows,
      capturedAt,
      resultState: rows.length ? "SOLD_ROWS_VISIBLE" : "NO_SOLD_RESULTS",
      nextPageAvailable: rows.length > 0 && nextPageAvailable(),
      soldFilterProven: true,
      freeShippingFilterProven,
      marketplaceWrites: 0,
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== CAPTURE_MESSAGE || sender?.id !== chrome.runtime.id) return false
    const maxRows = Number(message.maxRows)
    const queryIdentity = text(message.queryIdentity).slice(0, 100)
    const freeShippingRequired = message.freeShippingFilterRequired === true
    const captureBinding = freeShippingRequired
      ? freeShippingCaptureBinding(message.captureBinding, queryIdentity) : null
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS ||
      queryIdentity.length < 3 || (freeShippingRequired && !captureBinding)) {
      sendResponse({ success: false, error: freeShippingRequired && !captureBinding
        ? "STALE_DOCUMENT_RESPONSE" : "EBAY_SOLD_CAPTURE_BOUNDS_INVALID" })
      return false
    }
    try {
      sendResponse({ success: true, status: "READY", ...capture(maxRows,
        queryIdentity, freeShippingRequired),
        documentUrl: window.location.href,
        documentId: captureBinding?.documentId ?? null,
        captureBinding,
        navigationBindingId: typeof message.navigationBindingId === "string"
          ? message.navigationBindingId : null })
    } catch (error) {
      sendResponse({ success: false, status: "FAILED",
        error: error instanceof Error ? error.message : "EBAY_SOLD_CAPTURE_FAILED",
        documentUrl: window.location.href,
        documentId: captureBinding?.documentId ?? null,
        captureBinding,
        navigationBindingId: typeof message.navigationBindingId === "string"
          ? message.navigationBindingId : null })
    }
    return false
  })
})()
