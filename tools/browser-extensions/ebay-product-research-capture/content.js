(() => {
  "use strict"

  const SELLER_OS_ORIGIN = "https://imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
  const RECEIVER_URL = `${SELLER_OS_ORIGIN}/admin/ebay/mobile-review/product-research-capture`
  const CAPTURE_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_VISIBLE_CAPTURE_V1"
  const RECEIVER_READY_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_RECEIVER_READY_V1"
  const CAPTURE_RESULT_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_CAPTURE_RESULT_V1"
  const REQUIRED_FIELDS = ["temporaryTitle", "averageSoldPrice", "totalSold", "lastSoldDate"]
  const HEADER_ALIASES = {
    temporaryTitle: ["title", "listing title", "item title", "product"],
    listingId: ["item id", "listing id", "ebay item id"],
    averageSoldPrice: ["average sold price", "avg sold price", "average price"],
    averageShipping: ["average shipping", "avg shipping", "shipping"],
    totalSold: ["total sold", "quantity sold", "sold quantity"],
    itemSales: ["item sales", "total sales", "sales"],
    lastSoldDate: ["last sold date", "last sold", "sold date"],
    listingFormat: ["listing format", "format"],
    freeShippingPercent: ["free shipping", "free shipping percent", "% free shipping"],
    bids: ["bids", "bid count"],
  }

  let pending = null
  let receiver = null

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""
  const key = (value) => text(value).toLowerCase().replace(/[^a-z0-9%]/g, "")
  const visible = (element) => {
    const style = window.getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
  }
  const money = (value) => {
    const normalized = text(value)
    if (/\bfree\b/i.test(normalized)) return 0
    const match = normalized.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)
    return match ? Number(match[0]) : null
  }
  const integer = (value) => {
    const match = text(value).replace(/,/g, "").match(/\d+/)
    return match ? Number(match[0]) : null
  }
  const percentage = (value) => {
    const parsed = money(value)
    return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null
  }
  const canonicalHeader = (header) => {
    const normalized = key(header)
    return Object.entries(HEADER_ALIASES).find(([, aliases]) =>
      aliases.some((alias) => normalized === key(alias) || normalized.includes(key(alias))))?.[0] ?? null
  }
  const offerFacts = (title) => {
    const normalized = text(title).toLowerCase()
    const pack = normalized.match(/\b(?:lot|pack|set)\s+of\s+(\d{1,3})\b/) ??
      normalized.match(/\b(\d{1,3})\s*[- ]?(?:pack|pk)\b/) ??
      normalized.match(/\bqty\s*[:x-]?\s*(\d{1,3})\b/) ??
      normalized.match(/\b(\d{1,3})\s*[x×]\s*\d{1,4}\s*(?:ct|count)\b/)
    const perPack = normalized.match(/\b(\d{1,4})\s*(?:ct|count)\s*(?:each|per\s+(?:pack|unit))\b/)
    const multiplied = normalized.match(/\b\d{1,3}\s*[x×]\s*(\d{1,4})\s*(?:ct|count)\b/)
    const count = perPack ?? multiplied ?? normalized.match(/\b(\d{1,4})\s*(?:ct|count)\b/)
    const size = normalized.match(/\b\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|ct|count)\b/)?.[0] ?? null
    const variants = ["lemon", "lavender", "fresh", "citrus", "unscented", "original",
      "blue", "red", "black", "white", "green"]
    return {
      detectedOfferPackCount: pack ? Number(pack[1]) : /\bsingle\b/.test(normalized) ? 1 : null,
      detectedUnitCount: count ? Number(count[1]) : null,
      detectedSize: size,
      detectedVariant: variants.find((variant) => normalized.includes(variant)) ?? null,
    }
  }

  function tableParts(container) {
    const semanticTable = container.matches("table")
    const headerElements = semanticTable
      ? [...container.querySelectorAll("thead th")]
      : [...container.querySelectorAll('[role="columnheader"]')]
    const headers = headerElements.map((element) => text(element.innerText || element.textContent))
    const mapped = headers.map(canonicalHeader)
    if (!REQUIRED_FIELDS.every((field) => mapped.includes(field))) return null
    const rowElements = semanticTable
      ? [...container.querySelectorAll("tbody tr")]
      : [...container.querySelectorAll('[role="row"]')].filter((row) =>
        !row.querySelector('[role="columnheader"]'))
    const rows = rowElements.filter(visible).flatMap((row) => {
      const cells = semanticTable ? [...row.querySelectorAll("td")]
        : [...row.querySelectorAll('[role="cell"],[role="gridcell"]')]
      if (!cells.length) return []
      const values = Object.fromEntries(mapped.flatMap((field, index) => field
        ? [[field, text(cells[index]?.innerText || cells[index]?.textContent)]] : []))
      if (!values.temporaryTitle) return []
      const itemLink = row.querySelector('a[href*="/itm/"]')
      const listingId = values.listingId || itemLink?.getAttribute("href")?.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})/)?.[1] || null
      const facts = offerFacts(values.temporaryTitle)
      return [{
        temporaryTitle: values.temporaryTitle,
        listingId,
        averageSoldPrice: money(values.averageSoldPrice),
        averageShipping: values.averageShipping ? money(values.averageShipping) : null,
        totalSold: integer(values.totalSold),
        itemSales: values.itemSales ? money(values.itemSales) : null,
        lastSoldDate: values.lastSoldDate,
        listingFormat: values.listingFormat || "UNKNOWN",
        freeShippingPercent: values.freeShippingPercent ? percentage(values.freeShippingPercent) : null,
        bids: values.bids ? integer(values.bids) : null,
        visibleImageCount: row.querySelectorAll("img").length,
        ...facts,
      }]
    })
    return rows.length ? { headers, rows } : null
  }

  function findVisibleResults() {
    const containers = [...document.querySelectorAll('table,[role="table"],[role="grid"]')]
      .filter(visible)
    for (const container of containers) {
      const result = tableParts(container)
      if (result) return result
    }
    throw new Error("PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND")
  }

  function queryContext() {
    const params = new URLSearchParams(window.location.search)
    const searchQuery = ["q", "query", "keywords", "keyword"].map((name) => params.get(name))
      .find(Boolean) || [...document.querySelectorAll('input[type="search"],input[aria-label*="search" i],input[placeholder*="search" i]')]
        .map((input) => text(input.value)).find(Boolean) || ""
    const start = ["start_date", "startDate", "from"].map((name) => params.get(name)).find(Boolean) || null
    const end = ["end_date", "endDate", "to"].map((name) => params.get(name)).find(Boolean) || null
    const rangeParameter = ["date_range", "dateRange", "range"].map((name) => params.get(name)).find(Boolean)
    const selectedRange = [...document.querySelectorAll('[aria-label*="date" i],[data-testid*="date" i],button')]
      .filter(visible).map((element) => text(element.innerText || element.getAttribute("aria-label")))
      .find((value) => /(?:last|past|days?|months?|\d{4}.+\d{4})/i.test(value) && value.length <= 120)
    return { searchQuery, dateRange: { label: rangeParameter || selectedRange || null, start, end } }
  }

  function buildCapture() {
    if (window.location.hostname !== "www.ebay.com" || !/^\/sh\/research\/?$/.test(window.location.pathname)) {
      throw new Error("PRODUCT_RESEARCH_OFFICIAL_PAGE_REQUIRED")
    }
    const result = findVisibleResults()
    const context = queryContext()
    if (!context.searchQuery || !(context.dateRange.label || context.dateRange.start && context.dateRange.end)) {
      throw new Error("PRODUCT_RESEARCH_QUERY_CONTEXT_NOT_FOUND")
    }
    return {
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      captureId: crypto.randomUUID(),
      listingSite: window.location.hostname,
      pagePath: window.location.pathname,
      searchQuery: context.searchQuery,
      dateRange: context.dateRange,
      capturedAt: new Date().toISOString(),
      visibleResultCount: result.rows.length,
      visibleColumns: result.headers,
      rows: result.rows,
    }
  }

  function setStatus(message, tone = "neutral") {
    const status = document.getElementById("imnova-product-research-capture-status")
    if (!status) return
    status.textContent = message
    status.style.color = tone === "error" ? "#fecaca" : tone === "success" ? "#bbf7d0" : "#cffafe"
  }

  function startCapture() {
    try {
      pending = buildCapture()
      receiver = window.open(RECEIVER_URL, "imnovaProductResearchCapture",
        "popup=yes,width=720,height=780,resizable=yes,scrollbars=yes")
      if (!receiver) throw new Error("PRODUCT_RESEARCH_CAPTURE_POPUP_BLOCKED")
      setStatus(`Captura preparada: ${pending.visibleResultCount} filas visibles. Esperando Seller OS…`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PRODUCT_RESEARCH_CAPTURE_FAILED", "error")
    }
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SELLER_OS_ORIGIN || event.source !== receiver || !event.data) return
    if (event.data.type === RECEIVER_READY_MESSAGE && pending) {
      receiver.postMessage({ type: CAPTURE_MESSAGE, capture: pending }, SELLER_OS_ORIGIN)
      setStatus("Enviando datos estructurados a Seller OS…")
    }
    if (event.data.type === CAPTURE_RESULT_MESSAGE && event.data.captureId === pending?.captureId) {
      setStatus(event.data.success
        ? `Captura completada: ${event.data.importedCount || 0} filas importadas.`
        : `Captura rechazada: ${event.data.error || "ERROR"}`,
      event.data.success ? "success" : "error")
      pending = null
    }
  })

  const host = document.createElement("div")
  host.id = "imnova-product-research-capture-host"
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647"
  const shadow = host.attachShadow({ mode: "closed" })
  const panel = document.createElement("section")
  panel.style.cssText = "width:300px;border:1px solid rgba(255,255,255,.28);border-radius:16px;background:#07111a;color:white;padding:14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.38)"
  const title = document.createElement("strong")
  title.textContent = "Seller OS · Product Research"
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = "Capturar resultados para Seller OS"
  button.style.cssText = "display:block;width:100%;margin-top:10px;padding:11px;border:0;border-radius:11px;background:#a5f3fc;color:#082f49;font-weight:800;cursor:pointer"
  button.addEventListener("click", startCapture)
  const status = document.createElement("p")
  status.id = "imnova-product-research-capture-status"
  status.textContent = "Captura sólo la tabla actualmente visible."
  status.style.cssText = "margin:9px 0 0;color:#cffafe;font-size:11px"
  panel.append(title, button, status)
  shadow.append(panel)
  document.documentElement.append(host)
})()
