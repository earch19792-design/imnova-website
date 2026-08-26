(() => {
  "use strict"

  const CAPTURE_MESSAGE = "IMNOVA_AUTOMATED_MAIN_SEARCH_SOLD_CAPTURE_V1"
  const SOLD_PATH = /^\/sch\//
  const MAX_ROWS = 200

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""

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

  function visibleShipping(card) {
    const candidates = [...card.querySelectorAll(
      ".s-item__shipping,.s-item__logisticsCost,[data-testid*='shipping' i],[class*='shipping' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
      .filter((value) => /shipping|delivery/i.test(value))
    if (!candidates.length) return { amount: null, status: "UNAVAILABLE" }
    if (candidates.some((value) => /free shipping|free delivery/i.test(value))) {
      return { amount: 0, status: "OBSERVED" }
    }
    const amounts = candidates.map(exactUsdAmount).filter((value) => value !== null)
    if (amounts.length === 1) return { amount: amounts[0], status: "OBSERVED" }
    return { amount: null, status: "AMBIGUOUS" }
  }

  function bestOfferStatus(card) {
    const visibleText = text(card.innerText || card.textContent)
    return /best offer(?: accepted)?|offer accepted/i.test(visibleText)
      ? "EXPLICIT_PRESENT" : "UNKNOWN"
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

  function capture(maxRows, queryIdentity) {
    if (window.location.protocol !== "https:" || window.location.hostname !== "www.ebay.com" ||
      !SOLD_PATH.test(window.location.pathname)) throw new Error("EBAY_SOLD_PAGE_SCOPE_INVALID")
    const params = new URLSearchParams(window.location.search)
    if (params.get("LH_Sold") !== "1" || params.get("LH_Complete") !== "1" ||
      text(params.get("_nkw")) !== queryIdentity) {
      throw new Error("EBAY_SOLD_FILTER_NOT_PROVEN")
    }
    if (blockedPage()) throw new Error("EBAY_SOLD_ACCESS_CHALLENGE")
    const capturedAt = new Date().toISOString()
    const rows = cards().flatMap(({ itemId, link, card }) => {
      const title = titleFor(card, link)
      const soldAt = soldDate(card)
      const displayedSoldPriceAmount = displayedPrice(card)
      if (!title || !soldAt || displayedSoldPriceAmount === null) return []
      const shipping = visibleShipping(card)
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
        bestOfferStatus: bestOfferStatus(card),
        visibleShippingAmount: shipping.amount,
        visibleShippingCurrency: shipping.amount === null ? null : "USD",
        shippingStatus: shipping.status,
        priceEvidenceProvenance: "MAIN_SEARCH_VISIBLE_SOLD_ROW",
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
      marketplaceWrites: 0,
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== CAPTURE_MESSAGE || sender?.id !== chrome.runtime.id) return false
    const maxRows = Number(message.maxRows)
    const queryIdentity = text(message.queryIdentity).slice(0, 100)
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS ||
      queryIdentity.length < 3) {
      sendResponse({ success: false, error: "EBAY_SOLD_CAPTURE_BOUNDS_INVALID" })
      return false
    }
    try {
      sendResponse({ success: true, status: "READY", ...capture(maxRows, queryIdentity) })
    } catch (error) {
      sendResponse({ success: false, status: "FAILED",
        error: error instanceof Error ? error.message : "EBAY_SOLD_CAPTURE_FAILED" })
    }
    return false
  })
})()
