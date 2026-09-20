(() => {
  "use strict"

  const CAPTURE_MESSAGE = "IMNOVA_AUTOMATED_ENDED_ITEM_DETAIL_CAPTURE_V1"

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""

  function visible(element) {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== "none" && style.visibility !== "hidden" &&
      rect.width > 0 && rect.height > 0
  }

  function elementsAcrossOpenRoots(selector) {
    const found = []
    const roots = [document]
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index]
      found.push(...root.querySelectorAll(selector))
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) roots.push(element.shadowRoot)
      }
    }
    return found
  }

  function currentItemId() {
    return window.location.pathname.match(
      /^\/itm\/(?:[^/?#]+\/)?(\d{9,20})(?:[/?#]|$)/,
    )?.[1] ?? null
  }

  function exactUsdAmount(value) {
    const normalized = text(value)
    if (!/(?:US\s*)?\$/i.test(normalized)) return null
    const amounts = [...normalized.replace(/,/g, "").matchAll(
      /(?:US\s*)?\$\s*(\d+(?:\.\d{1,2})?)/gi,
    )].map((match) => Number(match[1])).filter(Number.isFinite)
    const unique = [...new Set(amounts)]
    return unique.length === 1 ? unique[0] : null
  }

  function endedProof(body) {
    const marker = [...document.querySelectorAll(
      "[data-testid*='ended' i],.x-item-ended,[class*='ended' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
      .find((value) => /listing (?:has |was )?ended|this item (?:has )?sold|sold on\b/i.test(value))
    const bodyMarker = body.match(
      /(?:this listing (?:has |was )?ended(?: on| by the seller)?|this item (?:has )?sold|sold on\s+[A-Z][a-z]{2,8}\s+\d{1,2},\s+20\d{2})/i,
    )?.[0]
    return marker || bodyMarker || null
  }

  function stableSellerUsername(value) {
    const candidate = text(value)
    return /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidate) &&
        !/^(?:seller|shop|vendedor|vendeur|verk[aä]ufer|venditore|ebay)$/i.test(candidate)
      ? candidate : null
  }

  function officialEbayUrl(value) {
    try {
      const url = new URL(value, window.location.href)
      return url.protocol === "https:" && /(^|\.)ebay\.com$/i.test(url.hostname)
        ? url : null
    } catch { return null }
  }

  function decoded(value) {
    try { return decodeURIComponent(value) } catch { return "" }
  }

  function sellerLinkScope(link) {
    return link.closest?.(
      ".x-sellercard-atf_main,.x-evo-btf-seller-card-river__container," +
      "[data-testid*='seller' i],.x-item-condensed-card",
    ) ?? null
  }

  function sellerIdentity(itemId) {
    const links = elementsAcrossOpenRoots(
      "a[href*='/usr/' i],a[href*='/str/' i],a[href*='/sch/' i]," +
      "a[href*='_ssn=' i],a[href*='seller=' i],a[href*='username=' i]," +
      "a[href*='sid=' i]",
    )
    const usernames = new Map()
    for (const link of links) {
      const url = officialEbayUrl(link.href)
      if (!url) continue
      const scoped = Boolean(sellerLinkScope(link))
      const itemBound = url.searchParams.get("item") === itemId ||
        url.searchParams.get("item_id") === itemId
      const userPath = url.pathname.match(/^\/usr\/([^/?#]{2,80})/i)?.[1]
      const sellerSearchPath = url.pathname.match(
        /^\/sch\/([^/?#]{2,80})\/m\.html$/i,
      )?.[1]
      const condensedSeller = scoped &&
        url.pathname.toLocaleLowerCase("en-US") === "/sch/i.html"
        ? url.searchParams.get("sid") : null
      const username = stableSellerUsername(decoded(userPath ||
        (itemBound ? sellerSearchPath || url.searchParams.get("username") : "") ||
        (scoped ? url.searchParams.get("_ssn") ||
          url.searchParams.get("seller") || condensedSeller : "") || ""))
      if (!username || (!scoped && !itemBound)) continue
      usernames.set(username.toLocaleLowerCase("en-US"), username)
    }
    if (usernames.size === 1) {
      const username = [...usernames.values()][0]
      return { sellerUsername: username,
          sellerProfileUrl: `https://www.ebay.com/usr/${encodeURIComponent(username)}`,
          stableSellerIdentity: `SELLER:${username.toLocaleLowerCase("en-US")}`,
          sellerIdentityStatus: "PROVEN", sellerIdentitySource: "ENDED_ITEM_SELLER_PROFILE_LINK",
          sellerIdentityKey: `SELLER:${username.toLocaleLowerCase("en-US")}` }
    }
    if (usernames.size > 1) return { sellerUsername: null,
      sellerProfileUrl: null, stableSellerIdentity: null,
      sellerIdentityStatus: "UNKNOWN",
      sellerIdentitySource: "AMBIGUOUS_PUBLIC_SELLER_PROFILES",
      sellerIdentityKey: "SELLER_IDENTITY_UNKNOWN" }
    const stores = new Map()
    for (const link of links) {
      const url = officialEbayUrl(link.href)
      const storePath = url?.pathname.match(/^\/str\/([^/?#]{2,80})/i)?.[1]
      if (!url || !storePath || !sellerLinkScope(link)) continue
      const storeId = stableSellerUsername(decoded(storePath))
      if (!storeId) continue
      const canonicalProfile = `https://www.ebay.com/str/${encodeURIComponent(storeId)}`
      stores.set(canonicalProfile.toLocaleLowerCase("en-US"),
        { storeId, canonicalProfile })
    }
    if (stores.size === 1) {
      const { storeId, canonicalProfile } = [...stores.values()][0]
      return { sellerUsername: storeId,
          sellerProfileUrl: canonicalProfile,
          stableSellerIdentity: `SELLER_PROFILE:${canonicalProfile.toLocaleLowerCase("en-US")}`,
          sellerIdentityStatus: "PROVEN",
          sellerIdentitySource: "ENDED_ITEM_STABLE_SELLER_PROFILE_URL",
          sellerIdentityKey: `SELLER_PROFILE:${canonicalProfile.toLocaleLowerCase("en-US")}` }
    }
    return { sellerUsername: null, sellerProfileUrl: null,
      stableSellerIdentity: null,
      sellerIdentityStatus: "UNKNOWN", sellerIdentitySource: stores.size > 1
        ? "AMBIGUOUS_PUBLIC_SELLER_PROFILES" : "NONE",
      sellerIdentityKey: "SELLER_IDENTITY_UNKNOWN" }
  }

  function shippingEvidence() {
    const candidates = [...document.querySelectorAll(
      "[data-testid*='shipping' i],[data-testid*='delivery' i],#shSummary,.ux-labels-values--shipping,[class*='shipping' i]",
    )].filter(visible).map((element) => text(element.innerText || element.textContent))
      .filter((value) => /shipping|delivery|env[ií]o|entrega|livraison|versand|spedizione/i.test(value))
    if (!candidates.length) return { visibleShippingAmount: null,
      shippingStatus: "UNAVAILABLE" }
    if (candidates.some((value) => /free shipping|free delivery|env[ií]o gratis|entrega gratis|livraison gratuite|kostenloser versand|spedizione gratuita/i.test(value))) {
      return { visibleShippingAmount: 0, shippingStatus: "OBSERVED" }
    }
    const amounts = [...new Set(candidates.map(exactUsdAmount).filter((value) => value !== null))]
    return amounts.length === 1
      ? { visibleShippingAmount: amounts[0], shippingStatus: "OBSERVED" }
      : { visibleShippingAmount: null, shippingStatus: "AMBIGUOUS" }
  }

  function priceEvidence(body) {
    const bestOfferPresent = /best offer accepted|offer accepted|mejor oferta aceptada|offre accept[eé]e/i.test(body)
    const realizedMatch = body.match(
      /(?:sold for|winning bid)\s*(?:US\s*)?\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i,
    )
    const condensedCards = [...document.querySelectorAll(
      ".x-item-condensed-card",
    )].filter(visible)
    const explicitSoldPrices = condensedCards.flatMap((card) => {
      const banner = text(card.querySelector?.(
        ".x-item-condensed-card__banner",
      )?.innerText || card.querySelector?.(
        ".x-item-condensed-card__banner",
      )?.textContent)
      if (banner.toLocaleUpperCase("en-US") !== "SOLD") return []
      const cardText = text(card.innerText || card.textContent)
      if (/best offer accepted|offer accepted/i.test(cardText)) return []
      const amount = exactUsdAmount(card.querySelector?.(
        ".x-item-condensed-card__sold-price",
      )?.innerText || card.querySelector?.(
        ".x-item-condensed-card__sold-price",
      )?.textContent)
      return amount === null ? [] : [amount]
    })
    const uniqueExplicitSoldPrices = [...new Set(explicitSoldPrices)]
    const realized = !bestOfferPresent && realizedMatch
      ? Number(realizedMatch[1].replace(/,/g, ""))
      : !bestOfferPresent && uniqueExplicitSoldPrices.length === 1
        ? uniqueExplicitSoldPrices[0] : null
    const displayedCandidates = [...document.querySelectorAll(
      ".x-price-primary,[itemprop='price'],[data-testid*='price' i]",
    )].filter(visible).map((element) => exactUsdAmount(
      element.innerText || element.textContent || element.getAttribute("content"),
    )).filter((value) => value !== null)
    const uniqueDisplayed = [...new Set(displayedCandidates)]
    const displayed = realized !== null ? realized
      : uniqueDisplayed.length === 1 ? uniqueDisplayed[0] : null
    return { displayedSoldPriceAmount: displayed,
      displayedPriceStatus: displayed === null ? "UNKNOWN" : "DISPLAYED_PRICE_CONFIRMED",
      realizedTransactionPriceAmount: realized,
      realizedPriceStatus: realized === null ? "UNPROVEN" : "REALIZED_PRICE_CONFIRMED",
      bestOfferStatus: bestOfferPresent ? "EXPLICIT_PRESENT"
        : realized === null ? "UNKNOWN" : "EXPLICIT_ABSENT" }
  }

  function capture(expectedItemId) {
    if (window.location.protocol !== "https:" || window.location.hostname !== "www.ebay.com" ||
      currentItemId() !== expectedItemId) throw new Error("ENDED_ITEM_IDENTITY_MISMATCH")
    const body = text(document.body?.innerText).slice(0, 150_000)
    if (/pardon our interruption|verify you are human|security measure|access denied|captcha/i.test(body)) {
      throw new Error("ENDED_ITEM_ACCESS_CHALLENGE")
    }
    const capturedAt = new Date().toISOString()
    const seller = sellerIdentity(expectedItemId)
    const endedMarker = endedProof(body)
    if (!endedMarker) {
      if (seller.sellerIdentityStatus !== "PROVEN") {
        throw new Error("ENDED_ITEM_STATUS_AND_SELLER_NOT_PROVEN")
      }
      return { itemId: expectedItemId, capturedAt,
        listingIdentityStatus: "PROVEN_SAME_ITEM_ID",
        endedItemIdentityStatus: "NOT_PROVEN",
        ...seller,
        visibleShippingAmount: null, shippingStatus: "UNAVAILABLE",
        displayedSoldPriceAmount: null, displayedPriceStatus: "UNKNOWN",
        realizedTransactionPriceAmount: null, realizedPriceStatus: "UNPROVEN",
        bestOfferStatus: "UNKNOWN",
        fieldProvenance: {
          sellerIdentity: { source: "SOLD_ITEM_PUBLIC_DETAIL_SAME_ITEM_ID",
            status: "CONFIRMED", observedAt: capturedAt,
            evidenceItemId: expectedItemId },
          shipping: { source: "SOLD_SEARCH_ROW", status: "UNKNOWN",
            observedAt: capturedAt, evidenceItemId: expectedItemId },
          displayedPrice: { source: "SOLD_SEARCH_ROW", status: "UNKNOWN",
            observedAt: capturedAt, evidenceItemId: expectedItemId },
          bestOffer: { source: "SOLD_SEARCH_ROW", status: "UNKNOWN",
            observedAt: capturedAt, evidenceItemId: expectedItemId },
          realizedPrice: { source: "SOLD_SEARCH_ROW", status: "UNPROVEN",
            observedAt: capturedAt, evidenceItemId: expectedItemId },
        } }
    }
    const shipping = shippingEvidence()
    const price = priceEvidence(body)
    return { itemId: expectedItemId, capturedAt,
      listingIdentityStatus: "PROVEN_SAME_ITEM_ID",
      endedItemIdentityStatus: "PROVEN_SAME_ENDED_ITEM",
      ...seller, ...shipping, ...price,
      fieldProvenance: {
        sellerIdentity: { source: "ENDED_ITEM_PUBLIC_DETAIL",
          status: seller.sellerIdentityStatus === "PROVEN" ? "CONFIRMED" : "UNKNOWN",
          observedAt: capturedAt, evidenceItemId: expectedItemId },
        shipping: { source: "ENDED_ITEM_PUBLIC_DETAIL",
          status: shipping.shippingStatus === "OBSERVED" ? "OBSERVED"
            : shipping.shippingStatus === "AMBIGUOUS" ? "AMBIGUOUS" : "UNKNOWN",
          observedAt: capturedAt, evidenceItemId: expectedItemId },
        displayedPrice: { source: "ENDED_ITEM_PUBLIC_DETAIL",
          status: price.displayedPriceStatus === "DISPLAYED_PRICE_CONFIRMED"
            ? "CONFIRMED" : "UNKNOWN", observedAt: capturedAt,
          evidenceItemId: expectedItemId },
        bestOffer: { source: "ENDED_ITEM_PUBLIC_DETAIL",
          status: price.bestOfferStatus === "UNKNOWN" ? "UNKNOWN" : "CONFIRMED",
          observedAt: capturedAt, evidenceItemId: expectedItemId },
        realizedPrice: { source: "ENDED_ITEM_PUBLIC_DETAIL",
          status: price.realizedPriceStatus === "REALIZED_PRICE_CONFIRMED"
            ? "CONFIRMED" : "UNPROVEN", observedAt: capturedAt,
          evidenceItemId: expectedItemId },
      },
      marketplaceWrites: 0 }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== CAPTURE_MESSAGE || sender?.id !== chrome.runtime.id) return false
    const expectedItemId = text(message.expectedItemId)
    if (!/^\d{9,20}$/.test(expectedItemId)) {
      sendResponse({ success: false, status: "FAILED", error: "ENDED_ITEM_ID_INVALID" })
      return false
    }
    try {
      sendResponse({ success: true, status: "READY", ...capture(expectedItemId) })
    } catch (error) {
      sendResponse({ success: false, status: "FAILED",
        error: error instanceof Error ? error.message : "ENDED_ITEM_CAPTURE_FAILED" })
    }
    return false
  })
})()
