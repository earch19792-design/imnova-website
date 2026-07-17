(() => {
  "use strict"

  const SELLER_OS_ORIGIN = "https://imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
  const RECEIVER_URL = `${SELLER_OS_ORIGIN}/admin/ebay/mobile-review/product-research-capture`
  const CAPTURE_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_VISIBLE_CAPTURE_V1"
  const RECEIVER_READY_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_RECEIVER_READY_V1"
  const CAPTURE_RESULT_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_CAPTURE_RESULT_V1"
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

  const ERROR_MESSAGES = {
    PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND:
      "No encontré una tabla visible compatible. Espera a que carguen los resultados y vuelve a intentar.",
    PRODUCT_RESEARCH_QUERY_CONTEXT_NOT_FOUND:
      "No pude confirmar la búsqueda o el rango de fechas. Ejecuta la búsqueda y vuelve a intentar.",
    PRODUCT_RESEARCH_CAPTURE_POPUP_BLOCKED:
      "El navegador bloqueó la ventana de Seller OS. Permite popups para ebay.com y vuelve a intentar.",
    PRODUCT_RESEARCH_RECEIVER_NOT_READY:
      "Seller OS no respondió. Confirma que estás autenticado en Preview y vuelve a intentar.",
  }

  const text = (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : ""
  const key = (value) => text(value).toLowerCase().replace(/[^a-z0-9%]/g, "")
  const visible = (element) => {
    const view = element.ownerDocument?.defaultView ?? window
    const style = view.getComputedStyle(element)
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

  function deepRoots(root = document) {
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
    return roots
  }

  function deepQueryAll(selector, root = document) {
    const matches = new Set()
    for (const scope of deepRoots(root)) {
      for (const element of scope.querySelectorAll?.(selector) ?? []) matches.add(element)
    }
    return [...matches]
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
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
    const groups = []
    for (const element of matches) {
      const top = element.getBoundingClientRect().top
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
      left.getBoundingClientRect().left - right.getBoundingClientRect().left)
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
      .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)
    if (visual.length >= expectedCount) return visual
    return []
  }

  function dateText(value) {
    const normalized = text(value)
    return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null
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

  function coordinateValuesForRow(row, headerElements, mapped) {
    const headerCenters = headerElements.map((element) => {
      const box = element.getBoundingClientRect()
      return box.left + box.width / 2
    })
    const boundaries = headerCenters.slice(0, -1).map((center, index) =>
      (center + headerCenters[index + 1]) / 2)
    const candidates = smallestVisibleMatches(row,
      `${CELL_SELECTOR},div,span,p,a`).filter((element) => {
      const value = text(element.innerText || element.textContent)
      const box = element.getBoundingClientRect()
      return value && value.length <= 500 && box.width < row.getBoundingClientRect().width * 0.9
    })
    const values = {}
    mapped.forEach((field, index) => {
      if (!field) return
      const lower = index === 0 ? Number.NEGATIVE_INFINITY : boundaries[index - 1]
      const upper = index === mapped.length - 1 ? Number.POSITIVE_INFINITY : boundaries[index]
      const matches = candidates.filter((element) => {
        const box = element.getBoundingClientRect()
        const center = box.left + box.width / 2
        return center >= lower && center < upper
      }).map((element) => {
        const value = text(element.innerText || element.textContent)
        const box = element.getBoundingClientRect()
        let score = requiredFieldValid(field, value) ? 100 : 0
        if (field === "temporaryTitle" && element.matches('a[href*="/itm/"]')) score += 100
        if (field === "averageSoldPrice" && /[$€£]|\bfree\b/i.test(value)) score += 30
        if (field === "totalSold" && /^\s*[\d,]+(?:\s+sold)?\s*$/i.test(value)) score += 30
        if (field === "lastSoldDate" && dateText(value)) score += 30
        return { element, value, score, area: box.width * box.height }
      }).sort((left, right) => right.score - left.score || left.area - right.area ||
        left.value.length - right.value.length)
      if (matches[0]) values[field] = matches[0].value
    })
    const itemLink = deepQueryAll('a[href*="/itm/"]', row).filter(visible)[0]
    const itemTitle = text(itemLink?.innerText || itemLink?.textContent)
    if (itemTitle) values.temporaryTitle = itemTitle
    return values
  }

  function candidateFieldValues(element, field) {
    const values = [text(element.innerText || element.textContent)]
    if (field === "lastSoldDate") {
      values.push(text(element.getAttribute?.("datetime")))
      values.push(text(element.getAttribute?.("aria-label")))
      values.push(text(element.getAttribute?.("title")))
      values.push(text(element.getAttribute?.("data-value")))
    }
    return [...new Set(values.filter(Boolean))]
  }

  function coordinateValuesForBand(container, headerElements, mapped, band, itemLink) {
    const headerCenters = headerElements.map((element) => {
      const box = element.getBoundingClientRect()
      return box.left + box.width / 2
    })
    const boundaries = headerCenters.slice(0, -1).map((center, index) =>
      (center + headerCenters[index + 1]) / 2)
    const candidates = smallestVisibleMatches(container,
      `${CELL_SELECTOR},div,span,p,a,time`).filter((element) => {
      const box = element.getBoundingClientRect()
      const centerY = box.top + box.height / 2
      return centerY >= band.lower && centerY < band.upper && box.width > 0 && box.height > 0
    })
    const values = {}
    mapped.forEach((field, index) => {
      if (!field) return
      const lower = index === 0 ? Number.NEGATIVE_INFINITY : boundaries[index - 1]
      const upper = index === mapped.length - 1 ? Number.POSITIVE_INFINITY : boundaries[index]
      const matches = candidates.flatMap((element) => {
        const box = element.getBoundingClientRect()
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
      if (matches[0]) values[field] = matches[0].value
    })
    const itemTitle = text(itemLink?.innerText || itemLink?.textContent)
    if (itemTitle) values.temporaryTitle = itemTitle
    return values
  }

  function coordinateRowsFromItemLinks(container, headerElements, mapped) {
    const headerBottom = Math.max(...headerElements.map((element) =>
      element.getBoundingClientRect().bottom))
    const links = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
      .filter((link) => text(link.innerText || link.textContent).length >= 4)
      .filter((link) => link.getBoundingClientRect().top >= headerBottom - 4)
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
    const bands = []
    for (const link of links) {
      const box = link.getBoundingClientRect()
      const center = box.top + box.height / 2
      const duplicate = bands.find((entry) => Math.abs(entry.center - center) <= 8)
      if (!duplicate) bands.push({ center, link })
      else if (text(link.innerText || link.textContent).length >
        text(duplicate.link.innerText || duplicate.link.textContent).length) duplicate.link = link
    }
    const gaps = bands.slice(1).map((entry, index) => entry.center - bands[index].center)
      .filter((gap) => gap > 8 && gap < 400).sort((left, right) => left - right)
    const typicalGap = gaps[Math.floor(gaps.length / 2)] ?? 72
    return bands.flatMap((entry, index) => {
      const previous = bands[index - 1]
      const next = bands[index + 1]
      const lower = Math.max(headerBottom,
        previous ? (previous.center + entry.center) / 2 : entry.center - typicalGap / 2)
      const upper = next ? (entry.center + next.center) / 2 : entry.center + typicalGap / 2
      const values = coordinateValuesForBand(container, headerElements, mapped,
        { lower, upper }, entry.link)
      return requiredValuesValid(values) ? [{ values, itemLink: entry.link }] : []
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
      element.getBoundingClientRect().bottom))
    const itemLinks = deepQueryAll('a[href*="/itm/"]', container).filter(visible)
    const candidates = []
    for (const link of itemLinks) {
      let ancestor = link.parentElement
      for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.getBoundingClientRect().top < headerBottom - 4) continue
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
      .filter((element) => element.getBoundingClientRect().top >= headerBottom - 4)
      .filter((element) => !element.querySelector?.(HEADER_SELECTOR))
      .filter((element) => requiredValuesValid(valuesForRow(element, headerElements, mapped, false)))
      .sort((left, right) => {
        const leftBox = left.getBoundingClientRect()
        const rightBox = right.getBoundingClientRect()
        return leftBox.height - rightBox.height || leftBox.top - rightBox.top
      })
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
    const rows = [...elementRows, ...coordinateRows].map(({ values, itemLink, row }) => {
      const listingId = values.listingId || itemLink?.getAttribute("href")?.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})/)?.[1] || null
      const facts = offerFacts(values.temporaryTitle)
      return {
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
        visibleImageCount: row ? deepQueryAll("img", row).length : 0,
        ...facts,
      }
    })
    return rows.length ? { headers, rows } : null
  }

  function coordinateTableParts() {
    const headerElements = headerElementsFor(document)
    const headers = headerElements.map((element) => text(element.innerText || element.textContent))
    const mapped = headers.map(canonicalHeader)
    if (!REQUIRED_FIELDS.every((field) => mapped.includes(field))) return null
    const coordinateRows = coordinateRowsFromItemLinks(document, headerElements, mapped)
    const rows = coordinateRows.map(({ values, itemLink }) => {
      const listingId = values.listingId || itemLink?.getAttribute("href")
        ?.match(/\/itm\/(?:[^/]+\/)?(\d{9,20})/)?.[1] || null
      return {
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
        visibleImageCount: 0,
        ...offerFacts(values.temporaryTitle),
      }
    })
    return rows.length ? { headers, rows } : null
  }

  function findVisibleResults() {
    const containers = deepQueryAll([
      "table", '[role="table"]', '[role="grid"]', '[data-testid*="table" i]',
      '[data-testid*="grid" i]', '[class*="table" i]', '[class*="grid" i]',
    ].join(",")).filter(visible)
    const headerCandidates = [...new Set([
      ...deepQueryAll(HEADER_SELECTOR),
      ...deepQueryAll("div,span,p,a,button").filter((element) =>
        text(element.innerText || element.textContent).length <= 80),
    ])].filter(visible)
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
      const leftBox = left.getBoundingClientRect()
      const rightBox = right.getBoundingClientRect()
      return leftBox.width * leftBox.height - rightBox.width * rightBox.height
    })
    const results = uniqueContainers.map((container) => tableParts(container)).filter(Boolean)
    const coordinateResult = coordinateTableParts()
    if (coordinateResult) results.push(coordinateResult)
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
    if (!statusElement) return
    statusElement.textContent = ERROR_MESSAGES[message] ?? message
    statusElement.style.color = tone === "error" ? "#fecaca"
      : tone === "success" ? "#bbf7d0" : "#cffafe"
  }

  function resetReceiverTimeout() {
    if (receiverReadyTimeout) window.clearTimeout(receiverReadyTimeout)
    receiverReadyTimeout = null
  }

  function finishCapture() {
    resetReceiverTimeout()
    if (captureButton) {
      captureButton.disabled = false
      captureButton.textContent = "Capturar resultados para Seller OS"
      captureButton.style.opacity = "1"
    }
  }

  function startCapture() {
    setStatus("Leyendo la tabla visible de Product Research…")
    if (captureButton) {
      captureButton.disabled = true
      captureButton.textContent = "Preparando captura…"
      captureButton.style.opacity = ".7"
    }
    try {
      pending = buildCapture()
      receiver = window.open(RECEIVER_URL, "imnovaProductResearchCapture",
        "popup=yes,width=720,height=780,resizable=yes,scrollbars=yes")
      if (!receiver) throw new Error("PRODUCT_RESEARCH_CAPTURE_POPUP_BLOCKED")
      setStatus(`Captura preparada: ${pending.visibleResultCount} filas visibles. Esperando Seller OS…`)
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
      if (code === "PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND") {
        const diagnostic = safeStructureDiagnostics()
        setStatus(`${ERROR_MESSAGES[code]} Diagnóstico seguro: roots=${diagnostic.roots}; frames=${diagnostic.sameOriginFrames}; fields=${diagnostic.recognizedFields.join(",") || "none"}; itemLinks=${diagnostic.itemLinks}; coordinateRows=${diagnostic.coordinateRows}.`, "error")
      } else setStatus(code, "error")
      finishCapture()
    }
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SELLER_OS_ORIGIN || event.source !== receiver || !event.data) return
    if (event.data.type === RECEIVER_READY_MESSAGE && pending) {
      resetReceiverTimeout()
      receiver.postMessage({ type: CAPTURE_MESSAGE, capture: pending }, SELLER_OS_ORIGIN)
      setStatus("Enviando datos estructurados a Seller OS…")
    }
    if (event.data.type === CAPTURE_RESULT_MESSAGE && event.data.captureId === pending?.captureId) {
      setStatus(event.data.success
        ? `Captura procesada: ${event.data.validCount || 0} válidas; ${event.data.importedCount || 0} nuevas; ${event.data.duplicateCount || 0} duplicadas; ${event.data.rejectedCount || 0} rechazadas.`
        : `Captura rechazada: ${event.data.error || "ERROR"}`,
      event.data.success ? "success" : "error")
      pending = null
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
  title.textContent = "Seller OS · Product Research · v1.0.6"
  captureButton = document.createElement("button")
  captureButton.type = "button"
  captureButton.textContent = "Capturar resultados para Seller OS"
  captureButton.style.cssText = "display:block;width:100%;margin-top:10px;padding:11px;border:0;border-radius:11px;background:#a5f3fc;color:#082f49;font-weight:800;cursor:pointer"
  captureButton.addEventListener("click", startCapture)
  const status = document.createElement("p")
  status.id = "imnova-product-research-capture-status"
  status.textContent = "Captura sólo la tabla actualmente visible."
  status.style.cssText = "margin:9px 0 0;color:#cffafe;font-size:11px"
  statusElement = status
  panel.append(title, captureButton, status)
  shadow.append(panel)
  document.documentElement.append(host)
})()
