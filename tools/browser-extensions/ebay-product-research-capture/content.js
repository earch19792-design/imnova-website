(() => {
  "use strict"

  const SELLER_OS_ORIGIN = "https://imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
  const RECEIVER_URL = `${SELLER_OS_ORIGIN}/admin/ebay/mobile-review/product-research-capture`
  const SELLER_OS_HOME_URL = `${SELLER_OS_ORIGIN}/admin/ebay-seller-os`
  const CAPTURE_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_VISIBLE_CAPTURE_V1"
  const RECEIVER_READY_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_RECEIVER_READY_V1"
  const CAPTURE_RESULT_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_CAPTURE_RESULT_V1"
  const VISUAL_PATTERN_SCHEMA_VERSION = "PRODUCT_RESEARCH_VISUAL_PATTERN_V1_2026_07_17"
  const VISUAL_PATTERN_ALGORITHM_VERSION = "PR_VISIBLE_THUMBNAIL_LOCAL_V1"
  const OFFICIAL_RESEARCH_PATH = /^\/sh\/research\/?$/
  const GLOBAL_EBAY_SEARCH_SCOPE = [
    "#gh", "#gh-top", '[role="banner"]',
    '[data-testid*="global-header" i]', '[class*="global-header" i]',
  ].join(",")
  const MAX_ITEM_LINKS = 200
  const MAX_COORDINATE_CONTAINERS = 6
  const MAX_FALLBACK_HEADERS = 200
  const MAX_FALLBACK_CONTAINERS = 80
  const REQUIRED_FIELDS = ["temporaryTitle", "averageSoldPrice", "totalSold", "lastSoldDate"]
  const HEADER_SELECTOR = [
    "th", '[role="columnheader"]', '[data-testid*="header" i]',
    '[data-testid*="column" i]', '[class*="header" i]', '[class*="column" i]',
  ].join(",")
  const ROW_SELECTOR = [
    "tbody tr", '[role="row"]', '[data-testid*="row" i]',
    '[data-testid*="result" i]', '[class*="row" i]', '[class*="result" i]',
  ].join(",")
  const CELL_SELECTOR = [
    "td", '[role="cell"]', '[role="gridcell"]', '[data-testid*="cell" i]',
    '[class*="cell" i]',
  ].join(",")
  const HEADER_ALIASES = {
    temporaryTitle: ["title", "listing", "listing title", "item", "item title", "product",
      "titulo", "anuncio", "articulo", "producto"],
    listingId: ["item id", "listing id", "ebay item id"],
    averageSoldPrice: ["average sold price", "avg sold price", "average price",
      "precio medio de venta", "precio promedio de venta"],
    averageShipping: ["average shipping", "avg shipping", "shipping",
      "envio medio", "envio promedio", "gastos de envio medios"],
    totalSold: ["total sold", "quantity sold", "sold quantity", "total vendido",
      "cantidad vendida", "unidades vendidas"],
    itemSales: ["item sales", "total item sales", "total sales", "sales",
      "ventas del articulo", "ventas totales"],
    lastSoldDate: ["last sold date", "last sold", "sold date", "ultima venta",
      "fecha de ultima venta"],
    listingFormat: ["listing format", "format", "formato del anuncio", "formato"],
    freeShippingPercent: ["free shipping", "free shipping percent", "% free shipping",
      "envio gratis", "porcentaje de envio gratis"],
    bids: ["bids", "bid count", "pujas", "numero de pujas"],
  }

  let pending = null
  let receiver = null
  let statusElement = null
  let captureButton = null
  let receiverReadyTimeout = null
  let captureContext = null
  let nextQueryPanel = null
  let nextQueryField = null
  let nextQueryProgress = null
  let nextQueryInstruction = null
  let applyNextQueryButton = null
  let copyNextQueryButton = null
  let nextQueryState = null
  let nextQueryWatchTimer = null
  let nextQueryCheckPending = false
  let nextQueryApplyPending = false
  let guidedPlanCompleted = false

  const ERROR_MESSAGES = {
    PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND:
      "No encontré una tabla visible compatible. Espera a que carguen los resultados y vuelve a intentar.",
    PRODUCT_RESEARCH_QUERY_CONTEXT_NOT_FOUND:
      "No pude confirmar la búsqueda o el rango de fechas. Ejecuta la búsqueda y vuelve a intentar.",
    PRODUCT_RESEARCH_CAPTURE_POPUP_BLOCKED:
      "El navegador bloqueó la ventana de Seller OS. Permite popups para ebay.com y vuelve a intentar.",
    PRODUCT_RESEARCH_RECEIVER_NOT_READY:
      "Seller OS no respondió. Confirma que estás autenticado en Preview y vuelve a intentar.",
    PRODUCT_RESEARCH_NEXT_QUERY_MISMATCH:
      "La búsqueda visible no coincide con la próxima consulta de Seller OS. Usa Aplicar y buscar próxima consulta.",
    PRODUCT_RESEARCH_NEXT_QUERY_RESULTS_PENDING:
      "Estoy esperando los resultados de la próxima consulta. No captures todavía.",
    PRODUCT_RESEARCH_SAFE_SUBMIT_NOT_FOUND:
      "La consulta quedó preparada, pero eBay no expuso un control seguro dentro de Product Research. Pulsa Search en esta misma página; Seller OS nunca usará la búsqueda pública.",
  }

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""
  const key = (value) => text(value).toLowerCase().replace(/[^a-z0-9%]/g, "")
  const elementRect = (element) => {
    const cached = captureContext?.rects.get(element)
    if (cached) return cached
    const value = element.getBoundingClientRect()
    captureContext?.rects.set(element, value)
    return value
  }
  const visible = (element) => {
    const cached = captureContext?.visibility.get(element)
    if (cached !== undefined) return cached
    const view = element.ownerDocument?.defaultView ?? window
    const style = view.getComputedStyle(element)
    const box = elementRect(element)
    const value = !element.hidden && element.getAttribute?.("aria-hidden") !== "true" &&
      style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
    captureContext?.visibility.set(element, value)
    return value
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
  const listingIdFromLink = (link) => link?.getAttribute?.("href")
    ?.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})/)?.[1] ?? null
  const accessibleLinkText = (link) => {
    if (!link) return ""
    const imageAlt = [...link.querySelectorAll?.("img[alt]") ?? []]
      .map((image) => text(image.getAttribute("alt"))).find((value) => value.length >= 4)
    return [
      text(link.innerText || link.textContent),
      text(link.getAttribute?.("aria-label")),
      text(link.getAttribute?.("title")),
      imageAlt,
    ].find((value) => value && value.length >= 4) ?? ""
  }
  const canonicalHeader = (header) => {
    const normalized = key(header)
    return Object.entries(HEADER_ALIASES).find(([, aliases]) =>
      aliases.some((alias) => normalized === key(alias) || normalized.includes(key(alias))))?.[0] ?? null
  }

  function deepRoots(root = document) {
    const cached = captureContext?.roots.get(root)
    if (cached) return cached
    const roots = []
    const visited = new Set()
    const visit = (scope) => {
      if (!scope || visited.has(scope)) return
      visited.add(scope)
      roots.push(scope)
      for (const element of scope.querySelectorAll?.("*") ?? []) {
        if (element.shadowRoot) visit(element.shadowRoot)
        if (element.tagName === "IFRAME") {
          try {
            const frameDocument = element.contentDocument
            if (frameDocument?.location?.hostname === "www.ebay.com") visit(frameDocument)
          } catch {
            // Cross-origin frames are intentionally not inspected.
          }
        }
      }
    }
    visit(root)
    captureContext?.roots.set(root, roots)
    return roots
  }

  function deepQueryAll(selector, root = document) {
    const queryCache = captureContext?.queries.get(root)
    const cached = queryCache?.get(selector)
    if (cached) return cached
    const matches = new Set()
    const scopes = captureContext?.shallow ? [root] : deepRoots(root)
    for (const scope of scopes) {
      for (const element of scope.querySelectorAll?.(selector) ?? []) matches.add(element)
    }
    const result = [...matches]
    if (captureContext) {
      const cache = queryCache ?? new Map()
      cache.set(selector, result)
      captureContext.queries.set(root, cache)
    }
    return result
  }

  function smallestVisibleMatches(container, selector) {
    const matches = deepQueryAll(selector, container).filter(visible).filter((element) =>
      text(element.innerText || element.textContent))
    const byText = new Map()
    for (const element of matches) {
      const value = text(element.innerText || element.textContent)
      byText.set(value, [...(byText.get(value) ?? []), element])
    }
    return matches.filter((element) => {
      const own = text(element.innerText || element.textContent)
      return !(byText.get(own) ?? []).some((child) =>
        child !== element && element.contains(child))
    })
  }

  function headerElementsFor(container) {
    const semanticMatches = smallestVisibleMatches(container, HEADER_SELECTOR)
    const visualMatches = smallestVisibleMatches(container, "div,span,p,a,button")
      .filter((element) => text(element.innerText || element.textContent).length <= 80)
    const matches = [...new Set([...semanticMatches, ...visualMatches])]
      .filter((element) => canonicalHeader(text(element.innerText || element.textContent)))
      .sort((left, right) => elementRect(left).top - elementRect(right).top)
    const groups = []
    for (const element of matches) {
      const top = elementRect(element).top
      const group = groups.find((candidate) => Math.abs(candidate.top - top) <= 24)
      if (group) {
        group.elements.push(element)
        group.top = (group.top * (group.elements.length - 1) + top) / group.elements.length
      } else groups.push({ top, elements: [element] })
    }
    const bestGroup = groups.sort((left, right) => {
      const score = (group) => {
        const fields = new Set(group.elements.map((element) =>
          canonicalHeader(text(element.innerText || element.textContent))))
        return REQUIRED_FIELDS.filter((field) => fields.has(field)).length * 100 + fields.size
      }
      return score(right) - score(left)
    })[0]
    const byField = new Map()
    for (const element of bestGroup?.elements ?? matches) {
      const field = canonicalHeader(text(element.innerText || element.textContent))
      if (field && !byField.has(field)) byField.set(field, element)
    }
    return [...byField.values()].sort((left, right) =>
      elementRect(left).left - elementRect(right).left)
  }

  function rowCells(row, expectedCount) {
    const semantic = smallestVisibleMatches(row, CELL_SELECTOR)
    if (semantic.length >= expectedCount) return semantic
    const direct = [...row.children].filter(visible).filter((element) =>
      text(element.innerText || element.textContent))
    if (direct.length >= expectedCount) return direct
    for (const child of direct) {
      const nested = [...child.children].filter(visible).filter((element) =>
        text(element.innerText || element.textContent))
      if (nested.length >= expectedCount) return nested
    }
    const visual = smallestVisibleMatches(row, "div,span,p,a")
      .filter((element) => text(element.innerText || element.textContent).length <= 500)
      .sort((left, right) => elementRect(left).left - elementRect(right).left)
    if (visual.length >= expectedCount) return visual
    return []
  }

  function dateText(value) {
    const normalized = text(value)
    if (!normalized) return null
    const lowered = normalized.toLowerCase()
      .replace(/^(?:last\s+sold(?:\s+date)?|sold\s+date|fecha\s+de\s+(?:la\s+)?[úu]ltima\s+venta)\s*:?\s*/i, "")
    const now = new Date()
    const toIsoDate = (date) => date.toISOString().slice(0, 10)
    if (lowered === "today" || lowered === "hoy") return toIsoDate(now)
    if (lowered === "yesterday" || lowered === "ayer") {
      return toIsoDate(new Date(now.getTime() - 86_400_000))
    }
    const relative = lowered.match(/^(\d{1,3})\s*(?:d|day|days|dia|dias|w|week|weeks|h|hour|hours)\s*(?:ago)?$/)
    if (relative) {
      const amount = Number(relative[1])
      const unit = lowered.match(/\b(?:d|day|days|dia|dias|w|week|weeks|h|hour|hours)\b/)?.[0] ?? ""
      const offset = unit.startsWith("w") ? amount * 7 * 86_400_000
        : unit.startsWith("h") ? amount * 3_600_000
        : amount * 86_400_000
      return toIsoDate(new Date(now.getTime() - offset))
    }
    const parsed = new Date(normalized)
    return Number.isFinite(parsed.getTime()) && parsed.getTime() <= now.getTime() + 86_400_000
      ? toIsoDate(parsed) : null
  }

  function requiredFieldValid(field, value) {
    if (field === "temporaryTitle") return text(value).length >= 4
    if (field === "averageSoldPrice") return money(value) !== null
    if (field === "totalSold") return (integer(value) ?? 0) > 0
    if (field === "lastSoldDate") return dateText(value) !== null
    return true
  }

  function valuesFromCells(cells, mapped) {
    return Object.fromEntries(mapped.flatMap((field, index) => field
      ? [[field, text(cells[index]?.innerText || cells[index]?.textContent)]] : []))
  }

  function textAfterAnyAlias(source, aliases, length = 140) {
    const lowered = source.toLowerCase()
    let bestStart = -1
    let bestAliasLength = 0
    for (const alias of aliases) {
      const index = lowered.indexOf(alias)
      if (index === -1) continue
      if (bestStart === -1 || index < bestStart) {
        bestStart = index
        bestAliasLength = alias.length
      }
    }
    if (bestStart === -1) return source
    return source.slice(bestStart + bestAliasLength, bestStart + bestAliasLength + length)
  }

  function titleFromBlockContent(content) {
    const chunks = content
      .split(/\n|[•|·]/)
      .map((chunk) => text(chunk))
      .filter((chunk) => chunk.length >= 8 && /[a-z]/i.test(chunk) && !/^\d+(\.\d+)?$/.test(chunk))
    const blocked = /(average sold price|avg sold price|average shipping|total sold|last sold|sold date|price|shipping|bids|auction|buy it now|free shipping)/i
    return chunks.find((chunk) => !blocked.test(chunk)) ?? chunks[0] ?? null
  }

  function bestEffortValuesForBlock(block, itemLink) {
    const content = text(block.innerText || block.textContent)
    const title = accessibleLinkText(itemLink) || titleFromBlockContent(content)
    const values = {}
    if (title) values.temporaryTitle = title
    const priceSource = textAfterAnyAlias(content, [
      "average sold price", "avg sold price", "average price", "price", "precio",
    ])
    const priceMatch = priceSource.match(/[$€£]\s*[\d,.]+|\bfree\b/i) ?? content.match(/[$€£]\s*[\d,.]+|\bfree\b/i)
    if (priceMatch) values.averageSoldPrice = priceMatch[0]
    const totalSoldSource = textAfterAnyAlias(content, [
      "total sold", "quantity sold", "sold quantity", "total vendido", "cantidad vendida",
      "unidades vendidas", "sold",
    ])
    const totalSoldMatch = totalSoldSource.match(/\b[\d,]+\b/) ?? content.match(/\b[\d,]+\b/)
    if (totalSoldMatch) values.totalSold = totalSoldMatch[0]
    const dateSource = textAfterAnyAlias(content, [
      "last sold date", "last sold", "sold date", "ultima venta", "última venta",
      "fecha de ultima venta", "fecha de última venta",
    ])
    const dateMatch = dateText(dateSource) ?? dateText(content)
    if (dateMatch) values.lastSoldDate = dateMatch
    const listingFormatSource = content.toLowerCase()
    if (/\bauction\b|\bsubasta\b/.test(listingFormatSource)) values.listingFormat = "AUCTION"
    else if (/\bbuy it now\b|\bfixed price\b|\bprecio fijo\b/.test(listingFormatSource)) {
      values.listingFormat = "FIXED_PRICE"
    }
    const shippingSource = textAfterAnyAlias(content, [
      "average shipping", "avg shipping", "shipping", "envio", "envío",
    ])
    const shippingMatch = shippingSource.match(/[$€£]\s*[\d,.]+|\bfree\b/i)
    if (shippingMatch) values.averageShipping = shippingMatch[0]
    return values
  }

  function candidateBlocksForGenericCapture(container, headerBottom) {
    const blocks = deepQueryAll([
      "li", "article", '[role="listitem"]', '[role="article"]',
      '[data-testid*="card" i]', '[data-testid*="result" i]',
      '[class*="card" i]', '[class*="result" i]', '[class*="item" i]',
      '[class*="listing" i]',
    ].join(","), container).filter(visible)
      .filter((element) => elementRect(element).top >= headerBottom - 4)
    return blocks.map((element) => {
      const content = text(element.innerText || element.textContent)
      const score = [
        /\b[$€£]\s*[\d,.]+|\bfree\b/i.test(content),
        /\b[\d,]+\s+(?:sold|bids?)\b/i.test(content),
        /\b(?:last sold|sold date|yesterday|today|\d{1,3}\s*(?:days?|weeks?|hours?)\s*ago)\b/i.test(content),
        content.length >= 24,
      ].filter(Boolean).length
      return { element, score, content }
    }).filter(({ score }) => score >= 2)
      .sort((left, right) => elementRect(left.element).top - elementRect(right.element).top)
      .slice(0, MAX_ITEM_LINKS)
      .map(({ element }) => element)
  }

  function coordinateValuesForRow(row, headerElements, mapped) {
    const headerCenters = headerElements.map((element) => {
      const box = elementRect(element)
      return box.left + box.width / 2
    })
    const boundaries = headerCenters.slice(0, -1).map((center, index) =>
      (center + headerCenters[index + 1]) / 2)
    const candidates = smallestVisibleMatches(row,
      `${CELL_SELECTOR},div,span,p,a`).filter((element) => {
      const value = text(element.innerText || element.textContent)
      const box = elementRect(element)
      return value && value.length <= 500 && box.width < elementRect(row).width * 0.9
    })
    const values = {}
    mapped.forEach((field, index) => {
      if (!field) return
      const lower = index === 0 ? Number.NEGATIVE_INFINITY : boundaries[index - 1]
      const upper = index === mapped.length - 1 ? Number.POSITIVE_INFINITY : boundaries[index]
      const matches = candidates.filter((element) => {
        const box = elementRect(element)
        const center = box.left + box.width / 2
        return center >= lower && center < upper
      }).map((element) => {
        const value = text(element.innerText || element.textContent)
        const box = elementRect(element)
        let score = requiredFieldValid(field, value) ? 100 : 0
        if (field === "temporaryTitle" && element.matches('a[href*="/itm/"]')) score += 100
        if (field === "averageSoldPrice" && /[$€£]|\bfree\b/i.test(value)) score += 30
        if (field === "totalSold" && /^\s*[\d,]+(?:\s+sold)?\s*$/i.test(value)) score += 30
        if (field === "lastSoldDate" && dateText(value)) score += 30
        return { element, value, score, area: box.width * box.height }
      }).sort((left, right) => right.score - left.score || left.area - right.area ||
        left.value.length - right.value.length)
      if (matches[0]) values[field] = field === "lastSoldDate"
        ? dateText(matches[0].value) ?? matches[0].value : matches[0].value
    })
    const itemLink = deepQueryAll('a[href*="/itm/"]', row).filter(visible)[0]
    const itemTitle = accessibleLinkText(itemLink)
    if (itemTitle) values.temporaryTitle = itemTitle
    return values
  }

  function candidateFieldValues(element, field) {
    const values = [
      text(element.innerText || element.textContent),
      text(element.getAttribute?.("aria-label")),
      text(element.getAttribute?.("title")),
      text(element.getAttribute?.("data-value")),
    ]
    if (field === "lastSoldDate") values.push(dateText(element.getAttribute?.("datetime")))
    if (field === "temporaryTitle" && element.matches?.('a[href*="/itm/"]')) {
      values.push(accessibleLinkText(element))
    }
    return [...new Set(values.filter(Boolean))]
  }

  function coordinateValuesForBand(container, headerElements, mapped, band, itemLink,
    preparedCandidates = null) {
    const headerCenters = headerElements.map((element) => {
      const box = elementRect(element)
      return box.left + box.width / 2
    })
    const boundaries = headerCenters.slice(0, -1).map((center, index) =>
      (center + headerCenters[index + 1]) / 2)
    const candidates = (preparedCandidates ?? smallestVisibleMatches(container,
      `${CELL_SELECTOR},div,span,p,a,time`)).filter((element) => {
      const box = elementRect(element)
      const centerY = box.top + box.height / 2
      return centerY >= band.lower && centerY < band.upper && box.width > 0 && box.height > 0
    })
    const values = {}
    mapped.forEach((field, index) => {
      if (!field) return
      const lower = index === 0 ? Number.NEGATIVE_INFINITY : boundaries[index - 1]
      const upper = index === mapped.length - 1 ? Number.POSITIVE_INFINITY : boundaries[index]
      const matches = candidates.flatMap((element) => {
        const box = elementRect(element)
        const center = box.left + box.width / 2
        if (center < lower || center >= upper) return []
        return candidateFieldValues(element, field).map((value) => {
          let score = requiredFieldValid(field, value) ? 100 : 0
          if (field === "temporaryTitle" && element === itemLink) score += 160
          if (field === "averageSoldPrice" && /[$€£]|\bfree\b/i.test(value)) score += 30
          if (field === "totalSold" && /^\s*[\d,]+(?:\s+sold)?\s*$/i.test(value)) score += 30
          if (field === "lastSoldDate" && dateText(value)) score += 30
          return { value, score, area: box.width * box.height }
        })
      }).sort((left, right) => right.score - left.score || left.area - right.area ||
        left.value.length - right.value.length)
      if (matches[0]) values[field] = field === "lastSoldDate"
        ? dateText(matches[0].value) ?? matches[0].value : matches[0].value
    })
    const itemTitle = accessibleLinkText(itemLink)
    if (itemTitle) values.temporaryTitle = itemTitle
    return values
  }

  function coordinateRowsFromItemLinks(container, headerElements, mapped) {
    const headerBottom = Math.max(...headerElements.map((element) =>
      elementRect(element).bottom))
    const rawLinks = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
      .filter((link) => listingIdFromLink(link))
      .filter((link) => elementRect(link).top >= headerBottom - 4)
      .sort((left, right) => elementRect(left).top - elementRect(right).top)
      .slice(0, MAX_ITEM_LINKS)
    const linksByListing = new Map()
    for (const link of rawLinks) {
      const listingId = listingIdFromLink(link)
      const current = linksByListing.get(listingId)
      if (!current || accessibleLinkText(link).length > accessibleLinkText(current).length) {
        linksByListing.set(listingId, link)
      }
    }
    const links = [...linksByListing.values()].sort((left, right) =>
      elementRect(left).top - elementRect(right).top)
    const bands = []
    for (const link of links) {
      const box = elementRect(link)
      const center = box.top + box.height / 2
      const duplicate = bands.find((entry) => Math.abs(entry.center - center) <= 8)
      if (!duplicate) bands.push({ center, link })
      else if (accessibleLinkText(link).length >
        accessibleLinkText(duplicate.link).length) duplicate.link = link
    }
    const gaps = bands.slice(1).map((entry, index) => entry.center - bands[index].center)
      .filter((gap) => gap > 8 && gap < 400).sort((left, right) => left - right)
    const typicalGap = gaps[Math.floor(gaps.length / 2)] ?? 72
    const preparedCandidates = smallestVisibleMatches(container,
      `${CELL_SELECTOR},div,span,p,a,time`)
    return bands.flatMap((entry, index) => {
      const previous = bands[index - 1]
      const next = bands[index + 1]
      const lower = Math.max(headerBottom,
        previous ? (previous.center + entry.center) / 2 : entry.center - typicalGap / 2)
      const upper = next ? (entry.center + next.center) / 2 : entry.center + typicalGap / 2
      const values = coordinateValuesForBand(container, headerElements, mapped,
        { lower, upper }, entry.link, preparedCandidates)
      return requiredValuesValid(values) ? [{ values, itemLink: entry.link }] : []
    })
  }

  // eBay can collapse the research grid into a responsive layout where the
  // visible column labels remain in the document but no longer align with the
  // values. Keep the Item ID as the row anchor and read the values in its
  // vertical band without relying on horizontal cell coordinates.
  function relaxedRowsFromItemLinks(container, headerElements = []) {
    const recognizedHeaders = headerElements.length ? headerElements : deepQueryAll(
      "th,[role='columnheader'],div,span,p,a,button", container,
    ).filter(visible).filter((element) =>
      canonicalHeader(text(element.innerText || element.textContent)))
    const headerBottom = recognizedHeaders.length
      ? Math.max(...recognizedHeaders.map((element) => elementRect(element).bottom))
      : Number.NEGATIVE_INFINITY
    const rawLinks = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
      .filter((link) => listingIdFromLink(link))
      .filter((link) => elementRect(link).top >= headerBottom - 4)
      .sort((left, right) => elementRect(left).top - elementRect(right).top)
      .slice(0, MAX_ITEM_LINKS)
    const linksByListing = new Map()
    for (const link of rawLinks) {
      const listingId = listingIdFromLink(link)
      const current = linksByListing.get(listingId)
      if (!current || accessibleLinkText(link).length > accessibleLinkText(current).length) {
        linksByListing.set(listingId, link)
      }
    }
    const links = [...linksByListing.values()].sort((left, right) =>
      elementRect(left).top - elementRect(right).top)
    const bands = []
    for (const link of links) {
      const box = elementRect(link)
      const center = box.top + box.height / 2
      const duplicate = bands.find((entry) => Math.abs(entry.center - center) <= 8)
      if (!duplicate) bands.push({ center, link })
      else if (accessibleLinkText(link).length > accessibleLinkText(duplicate.link).length) {
        duplicate.link = link
      }
    }
    const gaps = bands.slice(1).map((entry, index) => entry.center - bands[index].center)
      .filter((gap) => gap > 8 && gap < 400).sort((left, right) => left - right)
    const typicalGap = gaps[Math.floor(gaps.length / 2)] ?? 72
    const candidates = smallestVisibleMatches(container, `${CELL_SELECTOR},div,span,p,a,time`)
    const aliasesFor = (field) => HEADER_ALIASES[field]?.map((alias) => key(alias)) ?? []
    const valueForField = (field, rowCandidates) => rowCandidates.flatMap((element) => {
      const box = elementRect(element)
      return candidateFieldValues(element, field).flatMap((value) => {
        const normalized = text(value)
        if (normalized.length > 100 || !requiredFieldValid(field, normalized)) return []
        const valueKey = key(normalized)
        let score = 100
        if (aliasesFor(field).some((alias) => alias && valueKey.includes(alias))) score += 120
        if (field === "averageSoldPrice") {
          if (/[$€£]|\bfree\b/i.test(normalized)) score += 30
          if (/shipping|item\s+sales|total\s+sales|ventas|env[ií]o/i.test(normalized)) score -= 140
        }
        if (field === "totalSold") {
          if (/^\s*[\d,]+(?:\s+sold)?\s*$/i.test(normalized)) score += 40
          if (/item\s+sales|total\s+sales|average\s+sold\s+price|shipping|ventas|env[ií]o/i.test(normalized)) score -= 140
        }
        if (field === "lastSoldDate") {
          if (dateText(normalized)) score += 40
          if (/sold|venta|date|fecha/i.test(normalized)) score += 40
        }
        return [{ value: field === "lastSoldDate" ? dateText(normalized) ?? normalized : normalized,
          score, area: box.width * box.height }]
      })
    }).sort((left, right) => right.score - left.score || left.area - right.area ||
      left.value.length - right.value.length)[0]?.value
    return bands.flatMap((entry, index) => {
      const previous = bands[index - 1]
      const next = bands[index + 1]
      const lower = Math.max(headerBottom,
        previous ? (previous.center + entry.center) / 2 : entry.center - typicalGap / 2)
      const upper = next ? (entry.center + next.center) / 2 : entry.center + typicalGap / 2
      const rowCandidates = candidates.filter((element) => {
        const box = elementRect(element)
        const center = box.top + box.height / 2
        return center >= lower && center < upper && box.width > 0 && box.height > 0
      })
      const values = {
        temporaryTitle: accessibleLinkText(entry.link),
        averageSoldPrice: valueForField("averageSoldPrice", rowCandidates),
        totalSold: valueForField("totalSold", rowCandidates),
        lastSoldDate: valueForField("lastSoldDate", rowCandidates),
      }
      if (!requiredValuesValid(values)) return []
      return [{ values, itemLink: entry.link, row: entry.link.parentElement }]
    })
  }

  function requiredValuesValid(values) {
    return REQUIRED_FIELDS.every((field) => requiredFieldValid(field, values[field]))
  }

  function valuesForRow(row, headerElements, mapped, semanticTable) {
    const attempts = []
    if (semanticTable) attempts.push(valuesFromCells([...row.querySelectorAll("td")], mapped))
    else {
      attempts.push(coordinateValuesForRow(row, headerElements, mapped))
      const cells = rowCells(row, mapped.length)
      if (cells.length) attempts.push(valuesFromCells(cells, mapped))
    }
    return attempts.sort((left, right) =>
      REQUIRED_FIELDS.filter((field) => requiredFieldValid(field, right[field])).length -
      REQUIRED_FIELDS.filter((field) => requiredFieldValid(field, left[field])).length)[0] ?? {}
  }

  function genericRowElements(container, headerElements, mapped) {
    const headerBottom = Math.max(...headerElements.map((element) =>
      elementRect(element).bottom))
    const itemLinks = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
    const candidates = []
    for (const link of itemLinks) {
      let ancestor = link.parentElement
      for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
        if (elementRect(ancestor).top < headerBottom - 4) continue
        const values = valuesForRow(ancestor, headerElements, mapped, false)
        if (requiredValuesValid(values)) {
          candidates.push(ancestor)
          break
        }
      }
    }
    if (!candidates.length) {
      candidates.push(...deepQueryAll("tr,li,[role='listitem'],[data-testid*='row' i],[class*='row' i]", container))
    }
    return [...new Set(candidates)].filter(visible)
      .filter((element) => elementRect(element).top >= headerBottom - 4)
      .filter((element) => !element.querySelector?.(HEADER_SELECTOR))
      .filter((element) => requiredValuesValid(valuesForRow(element, headerElements, mapped, false)))
      .sort((left, right) => {
        const leftBox = elementRect(left)
        const rightBox = elementRect(right)
        return leftBox.height - rightBox.height || leftBox.top - rightBox.top
      })
  }

  function bestEffortRowElements(container, headerElements, mapped) {
    const headerBottom = Math.max(...headerElements.map((element) =>
      elementRect(element).bottom))
    const itemLinks = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
      .filter((link) => listingIdFromLink(link))
      .filter((link) => elementRect(link).top >= headerBottom - 4)
    const candidates = []
    for (const link of itemLinks) {
      let ancestor = link.parentElement
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        if (!visible(ancestor) || elementRect(ancestor).top < headerBottom - 4) continue
        const values = bestEffortValuesForBlock(ancestor, link)
        if (requiredFieldValid("temporaryTitle", values.temporaryTitle)
          && requiredFieldValid("averageSoldPrice", values.averageSoldPrice)
          && requiredFieldValid("totalSold", values.totalSold)
          && requiredFieldValid("lastSoldDate", values.lastSoldDate)) {
          candidates.push({ values, itemLink: link, row: ancestor })
          break
        }
      }
    }
    return [...new Map(candidates.map((entry) => [listingIdFromLink(entry.itemLink) ?? entry.values.temporaryTitle, entry])).values()]
  }

  function bestEffortCardRows(container, headerElements) {
    const headerBottom = Math.max(...headerElements.map((element) =>
      elementRect(element).bottom))
    const blocks = candidateBlocksForGenericCapture(container, headerBottom)
    const rows = []
    for (const block of blocks) {
      const itemLink = deepQueryAll('a[href*="/itm/"]', block).filter(visible)[0] ?? null
      const values = bestEffortValuesForBlock(block, itemLink)
      if (requiredFieldValid("temporaryTitle", values.temporaryTitle)
        && requiredFieldValid("averageSoldPrice", values.averageSoldPrice)
        && requiredFieldValid("totalSold", values.totalSold)
        && requiredFieldValid("lastSoldDate", values.lastSoldDate)) {
        rows.push({ values, itemLink, row: block })
      }
    }
    return rows
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

  function visibleInViewport(element) {
    if (!visible(element)) return false
    const box = elementRect(element)
    return box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth
  }

  function thumbnailForListing(row, itemLink) {
    let ancestor = itemLink ?? row ?? null
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const images = deepQueryAll("img", ancestor).filter(visibleInViewport)
      if (images.length) return images[0]
    }
    return row ? deepQueryAll("img", row).filter(visibleInViewport)[0] ?? null : null
  }

  function thumbnailResolutionBucket(image) {
    const area = Math.max(0, Number(image?.naturalWidth ?? 0) * Number(image?.naturalHeight ?? 0))
    if (!area) return "UNKNOWN"
    if (area < 10_000) return "LOW"
    if (area < 90_000) return "MEDIUM"
    return "HIGH"
  }

  function unavailableVisualPattern(image, facts, status = "UNAVAILABLE") {
    const naturalWidth = Number(image?.naturalWidth ?? 0)
    const naturalHeight = Number(image?.naturalHeight ?? 0)
    const ratio = naturalWidth > 0 && naturalHeight > 0 ? Number((naturalWidth / naturalHeight).toFixed(3)) : null
    return {
      imagePresent: Boolean(image),
      thumbnailAspectRatio: ratio,
      thumbnailResolutionBucket: thumbnailResolutionBucket(image),
      backgroundType: "UNKNOWN", backgroundConfidence: "UNKNOWN", frameCoverage: "UNKNOWN",
      visualComplexity: "UNKNOWN", textOverlayLikelihood: "UNKNOWN", badgeOrCalloutLikelihood: "UNKNOWN",
      presentationType: "UNKNOWN", productCountVisible: null, packClarity: "UNKNOWN",
      dominantComposition: "UNKNOWN", visualPatternConfidence: "UNKNOWN", analysisStatus: status,
      algorithmVersion: VISUAL_PATTERN_ALGORITHM_VERSION, analyzedAt: new Date().toISOString(),
      evidence: {
        visual: { presentationType: "UNKNOWN", confidence: "UNKNOWN" },
        titleDerived: { detectedPackCount: facts.detectedOfferPackCount, detectedUnitCount: facts.detectedUnitCount },
        combinedConclusion: { presentationType: "UNKNOWN", confidence: "UNKNOWN", basis: [] },
      },
    }
  }

  function rgbStats(data, width, height) {
    const total = Math.max(1, width * height)
    const samples = []
    const step = Math.max(1, Math.floor(Math.min(width, height) / 18))
    for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
      if (x > step && y > step && x < width - step && y < height - step) continue
      const offset = (y * width + x) * 4
      samples.push([data[offset], data[offset + 1], data[offset + 2]])
    }
    const edge = samples.length ? samples : [[255, 255, 255]]
    const average = edge.reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
      .map((value) => value / edge.length)
    let neutralEdge = 0
    let coloredEdge = 0
    for (const color of edge) {
      const spread = Math.max(...color) - Math.min(...color)
      const brightness = (color[0] + color[1] + color[2]) / 3
      if (spread < 26 && brightness > 155) neutralEdge += 1
      if (spread > 48) coloredEdge += 1
    }
    let foreground = 0
    let transitions = 0
    let centerX = 0
    let centerY = 0
    const scanStep = Math.max(1, Math.floor(Math.sqrt(total / 3_600)))
    for (let y = 0; y < height; y += scanStep) for (let x = 0; x < width; x += scanStep) {
      const offset = (y * width + x) * 4
      const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
      const distance = Math.abs(red - average[0]) + Math.abs(green - average[1]) + Math.abs(blue - average[2])
      if (distance > 76) { foreground += 1; centerX += x; centerY += y }
      if (x >= scanStep) {
        const previous = offset - scanStep * 4
        if (Math.abs(red - data[previous]) + Math.abs(green - data[previous + 1]) + Math.abs(blue - data[previous + 2]) > 90) transitions += 1
      }
    }
    const scanned = Math.max(1, Math.ceil(width / scanStep) * Math.ceil(height / scanStep))
    return {
      neutralEdgeRatio: neutralEdge / edge.length, coloredEdgeRatio: coloredEdge / edge.length,
      foregroundRatio: foreground / scanned, transitionRatio: transitions / scanned,
      foregroundCenterX: foreground ? centerX / foreground / width : .5,
      foregroundCenterY: foreground ? centerY / foreground / height : .5,
    }
  }

  function analyzedVisualPattern(image, facts) {
    if (!image || !Number(image.naturalWidth) || !Number(image.naturalHeight)) {
      return unavailableVisualPattern(image, facts)
    }
    const maxDimension = 128
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement("canvas")
    let pixelData = null
    try {
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) return unavailableVisualPattern(image, facts, "PARTIAL")
      context.drawImage(image, 0, 0, width, height)
      pixelData = context.getImageData(0, 0, width, height)
      const stats = rgbStats(pixelData.data, width, height)
      const backgroundType = stats.neutralEdgeRatio >= .72 ? "WHITE_OR_NEUTRAL"
        : stats.coloredEdgeRatio >= .72 && stats.transitionRatio > .28 ? "LIFESTYLE_LIKELY"
          : stats.coloredEdgeRatio >= .48 ? "COLORED" : "MIXED"
      const backgroundConfidence = stats.neutralEdgeRatio >= .82 || stats.coloredEdgeRatio >= .78 ? "MEDIUM" : "LOW"
      const frameCoverage = stats.foregroundRatio < .24 ? "LOW" : stats.foregroundRatio < .58 ? "MEDIUM" : "HIGH"
      const visualComplexity = stats.transitionRatio < .12 ? "LOW" : stats.transitionRatio < .3 ? "MEDIUM" : "HIGH"
      const composition = stats.foregroundRatio > .76 ? "FULL_FRAME"
        : stats.foregroundCenterX < .39 ? "LEFT_WEIGHTED"
          : stats.foregroundCenterX > .61 ? "RIGHT_WEIGHTED" : "CENTERED"
      const presentationType = backgroundType === "LIFESTYLE_LIKELY" ? "LIFESTYLE_LIKELY"
        : backgroundType === "WHITE_OR_NEUTRAL" && frameCoverage !== "LOW" ? "PRODUCT_ONLY" : "UNKNOWN"
      const confidence = backgroundConfidence === "MEDIUM" && visualComplexity !== "HIGH" ? "MEDIUM" : "LOW"
      // The title may corroborate a pack-oriented presentation, but never supplies a
      // visual unit count. Keep visual and title-derived evidence separate.
      const combinedPresentation = facts.detectedOfferPackCount && facts.detectedOfferPackCount > 1 &&
        presentationType !== "UNKNOWN" ? "MULTIPACK_LIKELY" : presentationType
      const combinedConfidence = combinedPresentation === "MULTIPACK_LIKELY" && confidence === "MEDIUM"
        ? "MEDIUM" : confidence
      const combinedBasis = combinedPresentation === "MULTIPACK_LIKELY"
        ? ["VISUAL", "TITLE_DERIVED"] : ["VISUAL"]
      return {
        ...unavailableVisualPattern(image, facts, "ANALYZED"),
        backgroundType, backgroundConfidence, frameCoverage, visualComplexity,
        textOverlayLikelihood: "UNKNOWN", badgeOrCalloutLikelihood: "UNKNOWN",
        presentationType, productCountVisible: null, packClarity: "UNKNOWN",
        dominantComposition: composition, visualPatternConfidence: confidence,
        evidence: {
          visual: { presentationType, confidence },
          titleDerived: { detectedPackCount: facts.detectedOfferPackCount, detectedUnitCount: facts.detectedUnitCount },
          combinedConclusion: { presentationType: combinedPresentation, confidence: combinedConfidence, basis: combinedBasis },
        },
      }
    } catch {
      return unavailableVisualPattern(image, facts)
    } finally {
      if (pixelData?.data) pixelData.data.fill(0)
      pixelData = null
      canvas.width = 0
      canvas.height = 0
    }
  }

  function visibleVisualPatternForRow(row, itemLink, title) {
    const facts = offerFacts(title)
    try {
      return analyzedVisualPattern(thumbnailForListing(row, itemLink), facts)
    } catch {
      return unavailableVisualPattern(null, facts, "REJECTED")
    }
  }

  function tableParts(container) {
    const semanticTable = container.matches("table")
    const headerElements = semanticTable
      ? [...container.querySelectorAll("thead th")]
      : headerElementsFor(container)
    const headers = headerElements.map((element) => text(element.innerText || element.textContent))
    const mapped = headers.map(canonicalHeader)
    if (!REQUIRED_FIELDS.every((field) => mapped.includes(field))) return null
    const rowElements = semanticTable
      ? deepQueryAll("tbody tr", container)
      : [...new Set([
        ...deepQueryAll(ROW_SELECTOR, container),
        ...genericRowElements(container, headerElements, mapped),
      ])].filter((row) => !headerElements.includes(row) && !row.querySelector?.(HEADER_SELECTOR))
    const elementRows = rowElements.filter(visible).flatMap((row) => {
      const values = valuesForRow(row, headerElements, mapped, semanticTable)
      if (!requiredValuesValid(values)) return []
      const itemLink = deepQueryAll('a[href*="/itm/"]', row)[0]
      return [{ values, itemLink, row }]
    })
    const coordinateRows = semanticTable || elementRows.length
      ? []
      : coordinateRowsFromItemLinks(container, headerElements, mapped)
    const relaxedRows = elementRows.length || coordinateRows.length
      ? [] : relaxedRowsFromItemLinks(container, headerElements)
    const bestEffortRows = elementRows.length || coordinateRows.length || relaxedRows.length
      ? [] : bestEffortRowElements(container, headerElements, mapped)
    const syntheticRows = elementRows.length || coordinateRows.length || relaxedRows.length || bestEffortRows.length
      ? [] : bestEffortCardRows(container, headerElements)
    const rows = [...elementRows, ...coordinateRows, ...relaxedRows, ...bestEffortRows, ...syntheticRows].map(({ values, itemLink, row }) => {
      const listingId = values.listingId || listingIdFromLink(itemLink)
      const facts = offerFacts(values.temporaryTitle)
      const visualRow = row ?? itemLink?.parentElement ?? null
      const visualPattern = visibleVisualPatternForRow(visualRow, itemLink, values.temporaryTitle)
      return {
        temporaryTitle: values.temporaryTitle,
        listingId,
        averageSoldPrice: money(values.averageSoldPrice),
        averageShipping: values.averageShipping ? money(values.averageShipping) : null,
        totalSold: integer(values.totalSold),
        itemSales: values.itemSales ? money(values.itemSales) : null,
        lastSoldDate: dateText(values.lastSoldDate) ?? values.lastSoldDate,
        listingFormat: values.listingFormat || "UNKNOWN",
        freeShippingPercent: values.freeShippingPercent ? percentage(values.freeShippingPercent) : null,
        bids: values.bids ? integer(values.bids) : null,
        visibleImageCount: visualPattern.imagePresent ? 1 : 0,
        visualPattern,
        ...facts,
      }
    })
    return rows.length ? { headers, rows } : null
  }

  function coordinateTableParts() {
    const itemLinks = deepQueryAll('a[href*="/itm/"]').filter(visible)
      .filter((link) => listingIdFromLink(link))
      .slice(0, MAX_ITEM_LINKS)
    const ancestorCounts = new Map()
    for (const link of itemLinks) {
      let ancestor = link.parentElement
      for (let depth = 0; ancestor && depth < 9; depth += 1, ancestor = ancestor.parentElement) {
        ancestorCounts.set(ancestor, (ancestorCounts.get(ancestor) ?? 0) + 1)
      }
    }
    const candidates = [...ancestorCounts.entries()]
      .filter(([, count]) => count >= Math.min(3, itemLinks.length))
      .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount ||
        elementRect(left).width * elementRect(left).height -
        elementRect(right).width * elementRect(right).height)
      .slice(0, MAX_COORDINATE_CONTAINERS).map(([container]) => container)
    if (!candidates.includes(document)) candidates.push(document)
    for (const container of candidates) {
      const headerElements = headerElementsFor(container)
      const headers = headerElements.map((element) => text(element.innerText || element.textContent))
      const mapped = headers.map(canonicalHeader)
      const hasRequiredHeaders = REQUIRED_FIELDS.every((field) => mapped.includes(field))
      const coordinateRows = hasRequiredHeaders
        ? coordinateRowsFromItemLinks(container, headerElements, mapped) : []
      const relaxedRows = coordinateRows.length ? [] : relaxedRowsFromItemLinks(container, headerElements)
      const bestEffortRows = coordinateRows.length || relaxedRows.length || !hasRequiredHeaders
        ? [] : bestEffortRowElements(container, headerElements, mapped)
      const syntheticRows = coordinateRows.length || relaxedRows.length || bestEffortRows.length || !hasRequiredHeaders
        ? [] : bestEffortCardRows(container, headerElements)
      const rows = [...coordinateRows, ...relaxedRows, ...bestEffortRows, ...syntheticRows].map(({ values, itemLink, row }) => {
        const listingId = values.listingId || listingIdFromLink(itemLink)
        const visualRow = row ?? itemLink?.parentElement ?? null
        const visualPattern = visibleVisualPatternForRow(visualRow, itemLink, values.temporaryTitle)
        return {
          temporaryTitle: values.temporaryTitle,
          listingId,
          averageSoldPrice: money(values.averageSoldPrice),
          averageShipping: values.averageShipping ? money(values.averageShipping) : null,
          totalSold: integer(values.totalSold),
          itemSales: values.itemSales ? money(values.itemSales) : null,
          lastSoldDate: dateText(values.lastSoldDate) ?? values.lastSoldDate,
          listingFormat: values.listingFormat || "UNKNOWN",
          freeShippingPercent: values.freeShippingPercent ? percentage(values.freeShippingPercent) : null,
          bids: values.bids ? integer(values.bids) : null,
          visibleImageCount: visualPattern.imagePresent ? 1 : 0,
          visualPattern,
          ...offerFacts(values.temporaryTitle),
        }
      })
      if (rows.length) return { headers, rows }
    }
    return null
  }

  function findVisibleResults() {
    // Product Research currently renders a virtualized grid. The coordinate
    // parser is both the most reliable and the cheapest path, so attempt it
    // before the legacy generic-container fallback.
    if (captureContext) captureContext.shallow = true
    const coordinateResult = coordinateTableParts()
    if (coordinateResult) return coordinateResult
    if (captureContext) {
      captureContext.shallow = false
      captureContext.queries = new WeakMap()
    }
    const containers = deepQueryAll([
      "table", '[role="table"]', '[role="grid"]', '[data-testid*="table" i]',
      '[data-testid*="grid" i]', '[class*="table" i]', '[class*="grid" i]',
    ].join(",")).filter(visible)
    const headerCandidates = [...new Set([
      ...deepQueryAll(HEADER_SELECTOR),
      ...deepQueryAll("div,span,p,a,button").filter((element) =>
        text(element.innerText || element.textContent).length <= 80),
    ])].filter(visible).slice(0, MAX_FALLBACK_HEADERS)
      .filter((element) => canonicalHeader(text(element.innerText || element.textContent)))
    for (const header of headerCandidates) {
      let ancestor = header.parentElement
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        if (!visible(ancestor)) continue
        const fields = new Set(headerElementsFor(ancestor).map((element) =>
          canonicalHeader(text(element.innerText || element.textContent))))
        if (REQUIRED_FIELDS.every((field) => fields.has(field))) containers.push(ancestor)
      }
    }
    const uniqueContainers = [...new Set(containers)].sort((left, right) => {
      const leftBox = elementRect(left)
      const rightBox = elementRect(right)
      return leftBox.width * leftBox.height - rightBox.width * rightBox.height
    })
    const results = uniqueContainers.slice(0, MAX_FALLBACK_CONTAINERS)
      .map((container) => tableParts(container)).filter(Boolean)
    results.sort((left, right) => right.rows.length - left.rows.length ||
      right.headers.length - left.headers.length)
    if (results[0]) return results[0]
    throw new Error("PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND")
  }

  function safeStructureDiagnostics() {
    const roots = deepRoots()
    const fields = new Set(deepQueryAll("th,div,span,p,a,button")
      .filter(visible)
      .filter((element) => text(element.innerText || element.textContent).length <= 80)
      .map((element) => canonicalHeader(text(element.innerText || element.textContent)))
      .filter(Boolean))
    const headerElements = headerElementsFor(document)
    const mapped = headerElements.map((element) =>
      canonicalHeader(text(element.innerText || element.textContent)))
    return {
      roots: roots.length,
      sameOriginFrames: roots.filter((root) => root.nodeType === Node.DOCUMENT_NODE && root !== document).length,
      recognizedFields: [...fields].sort(),
      itemLinks: deepQueryAll('a[href*="/itm/"]').filter(visible).length,
      coordinateRows: REQUIRED_FIELDS.every((field) => mapped.includes(field))
        ? coordinateRowsFromItemLinks(document, headerElements, mapped).length : 0,
    }
  }

  function isOfficialResearchTarget(value) {
    try {
      const target = new URL(value || window.location.href, window.location.href)
      return target.origin === "https://www.ebay.com" &&
        OFFICIAL_RESEARCH_PATH.test(target.pathname)
    } catch {
      return false
    }
  }

  function closestAcrossOpenRoots(element, selector) {
    let current = element
    while (current) {
      const match = current.closest?.(selector)
      if (match) return match
      const root = current.getRootNode?.()
      current = root?.host ?? null
    }
    return null
  }

  function isGlobalEbaySearchInput(input) {
    const id = text(input?.id).toLowerCase()
    const name = text(input?.getAttribute?.("name")).toLowerCase()
    const hint = text([
      input?.getAttribute?.("aria-label"), input?.getAttribute?.("placeholder"),
    ].filter(Boolean).join(" ")).toLowerCase()
    const form = input?.form || input?.closest?.("form")
    const rawAction = text(form?.getAttribute?.("action"))
    let actionPath = ""
    try {
      actionPath = rawAction ? new URL(rawAction, window.location.href).pathname : ""
    } catch {
      return true
    }
    const unsafeExplicitAction = Boolean(rawAction && !isOfficialResearchTarget(rawAction))
    return Boolean(closestAcrossOpenRoots(input, GLOBAL_EBAY_SEARCH_SCOPE)) || id === "gh-ac" ||
      name === "_nkw" || /search for anything|buscar cualquier cosa/.test(hint) ||
      /^\/sch(?:\/|$)/.test(actionPath) || unsafeExplicitAction
  }

  function officialResearchFormFor(input) {
    if (!input || isGlobalEbaySearchInput(input)) return null
    const form = input.form || input.closest?.("form")
    if (!form) return null
    const method = text(form.getAttribute("method")).toLowerCase()
    if (method && method !== "get") return null
    const rawAction = text(form.getAttribute("action"))
    const action = rawAction || window.location.href
    const localMainControl = Boolean(closestAcrossOpenRoots(input, 'main,[role="main"]'))
    const explicitResearchAction = rawAction ? isOfficialResearchTarget(rawAction) : false
    return isOfficialResearchTarget(action) && (localMainControl || explicitResearchAction)
      ? form : null
  }

  function isProductResearchInput(input) {
    if (!input || isGlobalEbaySearchInput(input)) return false
    if (input.disabled || input.readOnly || input.type === "hidden") return false
    if (closestAcrossOpenRoots(input, 'main,[role="main"]')) return true
    const form = input.form || input.closest?.("form")
    const rawAction = text(form?.getAttribute?.("action"))
    return Boolean(rawAction && isOfficialResearchTarget(rawAction))
  }

  function researchInputHint(input) {
    const labels = [...(input?.labels ?? [])]
      .map((label) => text(label.innerText || label.textContent))
    const labelledBy = text(input?.getAttribute?.("aria-labelledby"))
      .split(" ").filter(Boolean).map((id) => {
        const label = input?.ownerDocument?.getElementById?.(id)
        return text(label?.innerText || label?.textContent)
      })
    return text([
      input?.id,
      input?.getAttribute?.("name"),
      input?.getAttribute?.("role"),
      input?.getAttribute?.("aria-label"),
      input?.getAttribute?.("placeholder"),
      input?.getAttribute?.("data-testid"),
      ...labels,
      ...labelledBy,
    ].filter(Boolean).join(" ")).toLowerCase()
  }

  function isLikelyResearchQueryInput(input) {
    if (!isProductResearchInput(input)) return false
    const hint = researchInputHint(input)
    if (/categor|seller|vendedor|date|fecha|condition|condici[oó]n|filter|filtro/.test(hint)) {
      return false
    }
    const name = text(input.getAttribute?.("name")).toLowerCase()
    const role = text(input.getAttribute?.("role")).toLowerCase()
    return input.type === "search" || role === "searchbox" ||
      ["q", "query", "keyword", "keywords"].includes(name) ||
      /search|keyword|query|item|product|buscar|palabra|art[ií]culo|producto/.test(hint)
  }

  function researchSearchInputs() {
    const selector = [
      'input[type="search"]', 'input[aria-label*="search" i]',
      'input[placeholder*="search" i]', 'input[aria-label*="keyword" i]',
      'input[placeholder*="keyword" i]', 'input[aria-label*="buscar" i]',
      'input[placeholder*="buscar" i]', 'input[role="searchbox"]',
      'input[name="q" i]', 'input[name="query" i]',
      'input[name="keyword" i]', 'input[name="keywords" i]',
      'input[data-testid*="search" i]', 'input[data-testid*="keyword" i]',
    ].join(",")
    return deepQueryAll(selector).filter(visible)
      .filter((input) => isLikelyResearchQueryInput(input))
  }

  function researchSearchInput() {
    const inputs = researchSearchInputs()
    return inputs.sort((left, right) => {
      const score = (input) => {
        const hint = `${researchInputHint(input)} ${text(input.value).toLowerCase()}`
        return (officialResearchFormFor(input) ? 200 : 0) +
          (closestAcrossOpenRoots(input, 'main,[role="main"]') ? 100 : 0) +
          (/product|research|keyword|item|producto|palabra/.test(hint) ? 30 : 0) +
          (text(input.value) ? 10 : 0)
      }
      return score(right) - score(left)
    })[0] ?? null
  }

  const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

  async function waitForResearchSearchInput() {
    // Product Research occasionally remounts its controls while a receiver
    // popup closes. Wait briefly for the verified in-page control instead of
    // immediately presenting a contradictory manual-action error.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const input = researchSearchInput()
      if (input) return input
      await delay(350)
    }
    return null
  }

  const normalizedQuery = (value) => text(value).toLocaleLowerCase("en-US")

  function positivePlanInteger(value) {
    if (value === null || value === undefined || value === "") return null
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function nextQueryTransitionLead() {
    if (nextQueryState?.transitionSource === "CAPTURE_ACCEPTED") {
      return "La captura anterior quedó guardada."
    }
    if (nextQueryState?.transitionSource === "CAPTURE_DISCARDED") {
      return "La tabla anterior fue descartada y no se guardó."
    }
    return "Seller OS preparó esta consulta para Product Research."
  }

  async function resultsFingerprint(value) {
    const bytes = new TextEncoder().encode(value)
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    bytes.fill(0)
    const fingerprint = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    digest.fill(0)
    return fingerprint
  }

  function guidedQueryFragment() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    const previousResultsFingerprint = text(params.get("seller-os-previous-results"))
    const stage = text(params.get("seller-os-query-stage"))
    return {
      query: text(params.get("seller-os-query")).slice(0, 100),
      previousResultsFingerprint: /^[0-9a-f]{64}$/.test(previousResultsFingerprint)
        ? previousResultsFingerprint : null,
      applied: stage === "AWAITING_RESULTS" || stage === "RESULTS_READY",
    }
  }

  function persistGuidedQueryFragment(query, previousResultsFingerprint, stage) {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    params.set("seller-os-query", query)
    params.set("seller-os-query-stage", stage)
    if (previousResultsFingerprint) {
      params.set("seller-os-previous-results", previousResultsFingerprint)
    } else params.delete("seller-os-previous-results")
    window.history.replaceState(window.history.state, "",
      `${window.location.pathname}${window.location.search}#${params.toString()}`)
  }

  function clearGuidedQueryFragment() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    params.delete("seller-os-query")
    params.delete("seller-os-query-stage")
    params.delete("seller-os-previous-results")
    const suffix = params.toString()
    window.history.replaceState(window.history.state, "",
      `${window.location.pathname}${window.location.search}${suffix ? `#${suffix}` : ""}`)
  }

  function visibleResultsSignature() {
    const ids = deepQueryAll('a[href*="/itm/"]').filter(visible)
      .map((link) => listingIdFromLink(link)).filter(Boolean).slice(0, 12)
    return ids.length ? [...new Set(ids)].join(",") : ""
  }

  function stopNextQueryWatch() {
    if (nextQueryWatchTimer) window.clearInterval(nextQueryWatchTimer)
    nextQueryWatchTimer = null
  }

  function updateCaptureAvailability() {
    if (!captureButton) return
    if (guidedPlanCompleted) {
      captureButton.disabled = false
      captureButton.textContent = "VOLVER A SELLER OS"
      captureButton.style.opacity = "1"
      captureButton.style.cursor = "pointer"
      captureButton.style.background = "#bbf7d0"
      captureButton.style.color = "#052e16"
      return
    }
    const waitingForResults = Boolean(nextQueryState && !nextQueryState.resultsReady)
    captureButton.disabled = waitingForResults
    captureButton.textContent = nextQueryState
      ? waitingForResults ? "3. Capturar cuando carguen resultados" : "3. Capturar y continuar"
      : "Capturar y continuar"
    captureButton.style.opacity = waitingForResults ? ".72" : "1"
    captureButton.style.cursor = waitingForResults ? "not-allowed" : "pointer"
    captureButton.style.background = waitingForResults ? "#1e293b" : "#a5f3fc"
    captureButton.style.color = waitingForResults ? "#94a3b8" : "#082f49"
    captureButton.setAttribute("aria-current", waitingForResults ? "false" : "step")
  }

  function setNextQueryWorkflowStage(stage) {
    if (!nextQueryState) return
    nextQueryState.workflowStage = stage
    const ordinal = nextQueryState.ordinal ?? "siguiente"
    const applying = stage === "APPLYING_QUERY"
    const manualCopy = stage === "MANUAL_COPY_REQUIRED"
    const manualSearch = stage === "MANUAL_SEARCH_REQUIRED"
    const waiting = stage === "WAITING_RESULTS"
    const ready = stage === "READY_TO_CAPTURE"
    if (applyNextQueryButton) {
      applyNextQueryButton.hidden = !applying
      applyNextQueryButton.disabled = true
      applyNextQueryButton.textContent = `1. Aplicando consulta ${ordinal}…`
      applyNextQueryButton.style.opacity = ".72"
      applyNextQueryButton.style.cursor = "wait"
      applyNextQueryButton.setAttribute("aria-current", applying ? "step" : "false")
    }
    if (copyNextQueryButton) {
      copyNextQueryButton.hidden = !manualCopy
      copyNextQueryButton.disabled = false
      copyNextQueryButton.textContent = `1. Copiar consulta ${ordinal}`
      copyNextQueryButton.style.background = "#a5f3fc"
      copyNextQueryButton.style.color = "#082f49"
      copyNextQueryButton.style.opacity = "1"
      copyNextQueryButton.setAttribute("aria-current", manualCopy ? "step" : "false")
    }
    if (nextQueryInstruction) {
      nextQueryInstruction.textContent = applying
          ? "TRABAJANDO: Seller OS está buscando el control seguro dentro de Product Research."
        : manualCopy
          ? "AHORA: pulsa el botón 1. Después pega la consulta en Product Research y ejecuta Search."
          : manualSearch
            ? "AHORA · PASO 2: la consulta ya está colocada. Pulsa Search dentro de Product Research."
            : waiting
              ? "PASO 2 · TRABAJANDO: esperando que eBay cargue resultados nuevos…"
              : ready
                ? "AHORA · PASO 3: resultados confirmados. Pulsa Capturar y continuar."
                : ""
      nextQueryInstruction.hidden = !nextQueryInstruction.textContent
    }
    updateCaptureAvailability()
  }

  async function confirmNextQueryResults() {
    if (!nextQueryState || nextQueryCheckPending) return false
    nextQueryCheckPending = true
    try {
      const current = normalizedQuery(queryContext().searchQuery)
      if (current !== normalizedQuery(nextQueryState.query)) return false
      const signature = visibleResultsSignature()
      if (!signature || signature === nextQueryState.previousResultsSignature) return false
      const fingerprint = await resultsFingerprint(signature)
      if (fingerprint === nextQueryState.previousResultsFingerprint) return false
      nextQueryState.resultsReady = true
      persistGuidedQueryFragment(
        nextQueryState.query, nextQueryState.previousResultsFingerprint, "RESULTS_READY",
      )
      stopNextQueryWatch()
      setNextQueryWorkflowStage("READY_TO_CAPTURE")
      setStatus("Resultados nuevos listos. Revísalos y pulsa Capturar y continuar.", "success")
      return true
    } finally {
      nextQueryCheckPending = false
    }
  }

  function watchForNextQueryResults() {
    stopNextQueryWatch()
    if (!nextQueryState) return
    void confirmNextQueryResults()
    nextQueryWatchTimer = window.setInterval(() => void confirmNextQueryResults(), 700)
  }

  function assertExpectedQuery(context) {
    if (!nextQueryState) return
    if (normalizedQuery(context.searchQuery) !== normalizedQuery(nextQueryState.query)) {
      throw new Error("PRODUCT_RESEARCH_NEXT_QUERY_MISMATCH")
    }
    if (!nextQueryState.resultsReady) {
      throw new Error("PRODUCT_RESEARCH_NEXT_QUERY_RESULTS_PENDING")
    }
  }

  function setSearchInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function requestResearchSubmitWithGuidedFragment(form) {
    if (!form || typeof form.requestSubmit !== "function") return false
    const method = text(form.getAttribute("method")).toLowerCase()
    if (method && method !== "get") return false
    const originalAction = form.getAttribute("action")
    const target = new URL(originalAction || window.location.href, window.location.href)
    if (!isOfficialResearchTarget(target.href)) return false
    // A native same-path form navigation normally drops the current fragment.
    // Carry the local guided state in the action so a reload restores the query
    // and previous-results fingerprint with capture still disabled.
    target.hash = window.location.hash
    form.setAttribute("action", target.href)
    const restoreAction = () => {
      if (!form.isConnected) return
      if (originalAction === null) form.removeAttribute("action")
      else form.setAttribute("action", originalAction)
    }
    try {
      form.requestSubmit()
    } catch {
      restoreAction()
      return false
    }
    window.setTimeout(restoreAction, 0)
    return true
  }

  async function applyAndSearchNextQuery() {
    if (nextQueryApplyPending) return
    const query = nextQueryState?.query ?? ""
    if (query.length < 3) return
    const applyingState = nextQueryState
    nextQueryApplyPending = true
    try {
      setNextQueryWorkflowStage("APPLYING_QUERY")
      // Persist the expected query before looking for the eBay control. The
      // manual fallback must retain the same capture gate even if Product
      // Research remounts its SPA while the operator completes Search.
      nextQueryState.previousResultsSignature = visibleResultsSignature()
      nextQueryState.previousResultsFingerprint = nextQueryState.previousResultsSignature
        ? await resultsFingerprint(nextQueryState.previousResultsSignature) : null
      nextQueryState.resultsReady = false
      persistGuidedQueryFragment(
        query, nextQueryState.previousResultsFingerprint, "AWAITING_RESULTS",
      )
      const input = await waitForResearchSearchInput()
      if (nextQueryState !== applyingState) return
      if (!input) {
        setNextQueryWorkflowStage("MANUAL_COPY_REQUIRED")
        setStatus(
          `${nextQueryTransitionLead()} Para continuar con la consulta ${nextQueryState?.ordinal ?? "siguiente"}, usa el paso 1 habilitado.`,
          "warning",
        )
        return
      }
      const form = officialResearchFormFor(input)
      setSearchInputValue(input, query)
      input.focus()
      setNextQueryWorkflowStage(form ? "WAITING_RESULTS" : "MANUAL_SEARCH_REQUIRED")
      watchForNextQueryResults()
      if (!form || typeof form.requestSubmit !== "function") {
        setStatus(
          `${nextQueryTransitionLead()} La consulta ${nextQueryState?.ordinal ?? "siguiente"} ya está colocada. Pulsa Search dentro de Product Research.`,
          "warning",
        )
        return
      }
      // Fail closed: requestSubmit is permitted only after the candidate input and
      // its resolved form action both prove that they belong to /sh/research.
      // Never fall back to Enter because eBay's global header handles it by
      // navigating to the public /sch search surface.
      if (!requestResearchSubmitWithGuidedFragment(form)) {
        setNextQueryWorkflowStage("MANUAL_SEARCH_REQUIRED")
        setStatus(
          `${nextQueryTransitionLead()} La consulta ${nextQueryState?.ordinal ?? "siguiente"} ya está colocada. Pulsa Search dentro de Product Research.`,
          "warning",
        )
        return
      }
      setNextQueryWorkflowStage("WAITING_RESULTS")
      setStatus("Próxima consulta aplicada. Esperando resultados nuevos de eBay…")
    } finally {
      nextQueryApplyPending = false
    }
  }

  function advanceAfterAcceptedCapture(value, ordinal, total) {
    showNextQuery(value, ordinal, total, null, "CAPTURE_ACCEPTED")
    if (!nextQueryState) return
    setStatus("Captura aceptada. Cambiando automáticamente a la próxima consulta…", "success")
    // The capture itself is the user's authorization for this guided plan.
    // Continue with the next prepared query without requiring another button,
    // while keeping capture disabled until both the visible query and result
    // signature prove that eBay loaded a different table.
    window.setTimeout(() => void applyAndSearchNextQuery(), 0)
  }

  function advanceAfterCorrectedCapture(value, ordinal, total) {
    showNextQuery(value, ordinal, total, null, "CAPTURE_DISCARDED")
    if (!nextQueryState) return
    setStatus("La tabla anterior fue descartada. Aplicando la consulta correcta dentro de Product Research…", "success")
    window.setTimeout(() => void applyAndSearchNextQuery(), 0)
  }

  function queryContext() {
    const params = new URLSearchParams(window.location.search)
    const searchQuery = text(researchSearchInput()?.value) ||
      ["q", "query", "keywords", "keyword"].map((name) => params.get(name)).find(Boolean) || ""
    const start = ["start_date", "startDate", "from"].map((name) => params.get(name)).find(Boolean) || null
    const end = ["end_date", "endDate", "to"].map((name) => params.get(name)).find(Boolean) || null
    const rangeParameter = ["date_range", "dateRange", "range"].map((name) => params.get(name)).find(Boolean)
    const selectedRange = [...document.querySelectorAll('[aria-label*="date" i],[data-testid*="date" i],button')]
      .filter(visible).map((element) => text(element.innerText || element.getAttribute("aria-label")))
      .find((value) => /(?:last|past|days?|months?|\d{4}.+\d{4})/i.test(value) && value.length <= 120)
    return { searchQuery, dateRange: { label: rangeParameter || selectedRange || null, start, end } }
  }

  function buildCapture() {
    if (!isOfficialResearchTarget(window.location.href)) {
      throw new Error("PRODUCT_RESEARCH_OFFICIAL_PAGE_REQUIRED")
    }
    const context = queryContext()
    if (!context.searchQuery || !(context.dateRange.label || context.dateRange.start && context.dateRange.end)) {
      throw new Error("PRODUCT_RESEARCH_QUERY_CONTEXT_NOT_FOUND")
    }
    assertExpectedQuery(context)
    const result = findVisibleResults()
    return {
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      visualPatternSchemaVersion: VISUAL_PATTERN_SCHEMA_VERSION,
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
    if (!statusElement) return
    statusElement.textContent = ERROR_MESSAGES[message] ?? message
    statusElement.style.color = tone === "error" ? "#fecaca"
      : tone === "success" ? "#bbf7d0" : tone === "warning" ? "#fde68a" : "#cffafe"
  }

  function resetReceiverTimeout() {
    if (receiverReadyTimeout) window.clearTimeout(receiverReadyTimeout)
    receiverReadyTimeout = null
  }

  function finishCapture() {
    resetReceiverTimeout()
    updateCaptureAvailability()
  }

  function showNextQuery(value, ordinal, total, restored = null, transitionSource = "INITIAL") {
    const query = text(value).slice(0, 100)
    if (query.length < 3 || !nextQueryPanel || !nextQueryField || !nextQueryProgress) return
    const parsedOrdinal = positivePlanInteger(ordinal)
    const parsedTotal = positivePlanInteger(total)
    nextQueryState = {
      query,
      ordinal: parsedOrdinal,
      total: parsedTotal,
      transitionSource,
      previousResultsSignature: restored?.applied ? "" : visibleResultsSignature(),
      previousResultsFingerprint: restored?.previousResultsFingerprint ?? null,
      resultsReady: false,
      workflowStage: "APPLYING_QUERY",
    }
    nextQueryField.value = query
    nextQueryProgress.textContent = parsedOrdinal && parsedTotal
      ? `Próxima consulta: ${parsedOrdinal} de ${parsedTotal}` : "Consulta preparada"
    nextQueryPanel.hidden = false
    watchForNextQueryResults()
    setNextQueryWorkflowStage(restored?.applied ? "WAITING_RESULTS" : "APPLYING_QUERY")
  }

  function clearNextQuery() {
    nextQueryState = null
    stopNextQueryWatch()
    clearGuidedQueryFragment()
    if (nextQueryPanel) nextQueryPanel.hidden = true
    if (nextQueryInstruction) nextQueryInstruction.hidden = true
  }

  function completeGuidedPlan(queryCount) {
    const total = positivePlanInteger(queryCount)
    guidedPlanCompleted = true
    clearNextQuery()
    setStatus(
      total
        ? `PROCESO COMPLETADO · ${total} de ${total} consultas. Regresa a Seller OS para revisar el resultado y la siguiente acción.`
        : "PROCESO COMPLETADO. Regresa a Seller OS para revisar el resultado y la siguiente acción.",
      "success",
    )
    updateCaptureAvailability()
  }

  function startCapture() {
    try {
      assertExpectedQuery(queryContext())
      receiver = window.open(RECEIVER_URL, "imnovaProductResearchCapture",
        "popup=yes,width=720,height=780,resizable=yes,scrollbars=yes")
      if (!receiver) throw new Error("PRODUCT_RESEARCH_CAPTURE_POPUP_BLOCKED")
    } catch (error) {
      const code = error instanceof Error ? error.message : "PRODUCT_RESEARCH_CAPTURE_FAILED"
      setStatus(code, "error")
      finishCapture()
      return
    }
    setStatus("Leyendo la tabla visible de Product Research…")
    if (captureButton) {
      captureButton.disabled = true
      captureButton.textContent = "Preparando captura…"
      captureButton.style.opacity = ".7"
    }
    // Let the button/status paint before reading the eBay grid. Cached DOM
    // geometry prevents repeated forced layouts during the capture.
    window.requestAnimationFrame(() => window.setTimeout(() => {
      const startedAt = performance.now()
      captureContext = { roots: new WeakMap(), queries: new WeakMap(),
        rects: new WeakMap(), visibility: new WeakMap() }
      try {
        pending = buildCapture()
        const elapsed = Math.max(1, Math.round(performance.now() - startedAt))
        setStatus(`Captura preparada: ${pending.visibleResultCount} filas en ${elapsed} ms. Esperando Seller OS…`)
        resetReceiverTimeout()
        receiverReadyTimeout = window.setTimeout(() => {
          if (!pending) return
          pending = null
          setStatus("PRODUCT_RESEARCH_RECEIVER_NOT_READY", "error")
          finishCapture()
        }, 20_000)
      } catch (error) {
        pending = null
        const code = error instanceof Error ? error.message : "PRODUCT_RESEARCH_CAPTURE_FAILED"
        if (receiver && !receiver.closed) receiver.close()
        receiver = null
        if (code === "PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND") {
          const diagnostic = safeStructureDiagnostics()
          setStatus(`${ERROR_MESSAGES[code]} Diagnóstico seguro: roots=${diagnostic.roots}; frames=${diagnostic.sameOriginFrames}; fields=${diagnostic.recognizedFields.join(",") || "none"}; itemLinks=${diagnostic.itemLinks}; coordinateRows=${diagnostic.coordinateRows}.`, "error")
        } else setStatus(code, "error")
        finishCapture()
      } finally {
        captureContext = null
      }
    }, 0))
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SELLER_OS_ORIGIN || event.source !== receiver || !event.data) return
    if (event.data.type === RECEIVER_READY_MESSAGE && pending) {
      resetReceiverTimeout()
      receiver.postMessage({ type: CAPTURE_MESSAGE, capture: pending }, SELLER_OS_ORIGIN)
      setStatus("Enviando datos estructurados a Seller OS…")
    }
    if (event.data.type === CAPTURE_RESULT_MESSAGE && event.data.captureId === pending?.captureId) {
      const navigationOnly = event.data.success && event.data.navigationOnly === true &&
        event.data.captureQueryCorrected === true
      setStatus(navigationOnly
        ? "La tabla no correspondía y no fue guardada. Preparando la consulta correcta…"
        : event.data.success
          ? `Captura procesada: ${event.data.validCount || 0} válidas; ${event.data.importedCount || 0} nuevas; ${event.data.duplicateCount || 0} duplicadas; ${event.data.rejectedCount || 0} rechazadas.`
          : `Captura rechazada: ${event.data.error || "ERROR"}`,
      event.data.success ? "success" : "error")
      pending = null
      if (event.data.success && event.data.nextQuery) {
        const advance = navigationOnly ? advanceAfterCorrectedCapture : advanceAfterAcceptedCapture
        advance(event.data.nextQuery, event.data.nextQueryOrdinal, event.data.queryCount)
      } else if (event.data.success && positivePlanInteger(event.data.queryCount)) {
        completeGuidedPlan(event.data.queryCount)
      } else if (event.data.success) clearNextQuery()
      finishCapture()
    }
  })

  const host = document.createElement("div")
  host.id = "imnova-product-research-capture-host"
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647"
  const shadow = host.attachShadow({ mode: "closed" })
  const panel = document.createElement("section")
  panel.style.cssText = "width:300px;border:1px solid rgba(255,255,255,.28);border-radius:16px;background:#07111a;color:white;padding:14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.38)"
  const title = document.createElement("strong")
  title.textContent = "Seller OS · Product Research · v1.2.5"
  captureButton = document.createElement("button")
  captureButton.type = "button"
  captureButton.textContent = "Capturar y continuar"
  captureButton.style.cssText = "display:block;width:100%;margin-top:10px;padding:11px;border:0;border-radius:11px;background:#a5f3fc;color:#082f49;font-weight:800;cursor:pointer"
  captureButton.addEventListener("click", () => {
    if (!guidedPlanCompleted) {
      startCapture()
      return
    }
    const sellerOsWindow = window.open(SELLER_OS_HOME_URL, "sellerOsDashboard")
    sellerOsWindow?.focus()
  })
  const status = document.createElement("p")
  status.id = "imnova-product-research-capture-status"
  status.textContent = "Captura sólo la tabla actualmente visible."
  status.style.cssText = "margin:9px 0 0;color:#cffafe;font-size:11px"
  statusElement = status
  nextQueryPanel = document.createElement("div")
  nextQueryPanel.hidden = true
  nextQueryPanel.style.cssText = "margin-top:10px;border-top:1px solid rgba(255,255,255,.18);padding-top:10px"
  nextQueryProgress = document.createElement("strong")
  nextQueryProgress.style.cssText = "display:block;margin-bottom:6px;color:#cffafe"
  nextQueryField = document.createElement("textarea")
  nextQueryField.readOnly = true
  nextQueryField.rows = 2
  nextQueryField.setAttribute("aria-label", "Próxima consulta de Product Research")
  nextQueryField.style.cssText = "box-sizing:border-box;width:100%;resize:none;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#020617;color:white;padding:7px;font:11px/1.35 system-ui,sans-serif"
  nextQueryInstruction = document.createElement("p")
  nextQueryInstruction.style.cssText = "margin:7px 0 0;color:#fde68a;font-size:11px"
  copyNextQueryButton = document.createElement("button")
  copyNextQueryButton.type = "button"
  copyNextQueryButton.textContent = "1. Copiar consulta"
  copyNextQueryButton.style.cssText = "display:block;width:100%;margin-top:7px;padding:8px;border:1px solid rgba(165,243,252,.45);border-radius:8px;background:transparent;color:#cffafe;font-weight:800;cursor:pointer"
  copyNextQueryButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(nextQueryField?.value ?? "")
      copyNextQueryButton.disabled = true
      copyNextQueryButton.textContent = "1. Consulta copiada ✓"
      copyNextQueryButton.style.opacity = ".7"
      copyNextQueryButton.style.cursor = "not-allowed"
      setStatus("Consulta copiada. Completa el paso 2 dentro de Product Research.", "success")
    } catch {
      nextQueryField?.focus()
      nextQueryField?.select()
      setStatus("Seleccioné la consulta. Usa Ctrl+C para copiarla.")
    }
  })
  applyNextQueryButton = document.createElement("button")
  applyNextQueryButton.type = "button"
  applyNextQueryButton.textContent = "Aplicar y buscar próxima consulta"
  applyNextQueryButton.style.cssText = "display:block;width:100%;margin-top:7px;padding:9px;border:0;border-radius:8px;background:#a5f3fc;color:#082f49;font-weight:800;cursor:pointer"
  applyNextQueryButton.addEventListener("click", () => void applyAndSearchNextQuery())
  nextQueryPanel.append(
    nextQueryProgress, nextQueryField, applyNextQueryButton,
    copyNextQueryButton, nextQueryInstruction,
  )
  // Keep the visual order identical to the operating order. The capture
  // action is step 3 and must never appear above steps 1 and 2.
  panel.append(title, status, nextQueryPanel, captureButton)
  shadow.append(panel)
  document.documentElement.append(host)
  const sellerOsSeed = guidedQueryFragment()
  if (sellerOsSeed.query.length >= 3) {
    showNextQuery(sellerOsSeed.query, null, null, sellerOsSeed)
    if (sellerOsSeed.applied) {
      setStatus("Consulta guiada restaurada. Verificando que eBay cargó resultados nuevos…")
    } else {
      setStatus("Consulta recibida de Seller OS. Aplicándola automáticamente…")
      window.setTimeout(() => void applyAndSearchNextQuery(), 0)
    }
  }
})()
