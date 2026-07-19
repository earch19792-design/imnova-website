import { createHash } from "node:crypto"

export const OFFICIAL_MANUFACTURER_FACTS_ADAPTER_VERSION =
  "OFFICIAL_MANUFACTURER_FACTS_V1_2026_07_19"

const MAX_OFFICIAL_PAGE_BYTES = 750_000
const REQUEST_TIMEOUT_MS = 8_000

type OfficialFact = {
  key: string
  value: string
  unit: string | null
}

type OfficialSourceDefinition = {
  id: string
  brand: string
  origin: string
  path: string
  identityTerms: string[]
  extractors?: Array<{ key: string; value: string; pattern: RegExp; unit?: string | null }>
}

// This registry is intentionally closed. A new source must be reviewed as the
// manufacturer's own public domain and bound to one exact product identity.
// Never accept a URL supplied by a candidate, eBay listing or request body.
const OFFICIAL_SOURCES: readonly OfficialSourceDefinition[] = [
  {
    id: "IF_YOU_CARE_PAPER_SNACK_SANDWICH_BAGS",
    brand: "If You Care",
    origin: "https://ifyoucare.com",
    path: "/products/sandwich-bags-fcs-certified",
    identityTerms: ["paper", "snack", "sandwich", "bags"],
    extractors: [
      { key: "countryOfManufacture", value: "Sweden", pattern: /made in sweden/i },
      { key: "material", value: "Unbleached paper", pattern: /unbleached pulp|unbleached paper/i },
    ],
  },
]

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    : ""
}

function decodedText(value: string) {
  return value.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ").trim().slice(0, 500)
}

function sourceReference(source: OfficialSourceDefinition) {
  const digest = createHash("sha256")
    .update(`${source.origin}${source.path}`)
    .digest("hex").slice(0, 24)
  return `MANUFACTURER_OFFICIAL_PUBLIC:sha256:${digest}`
}

function sourceForProduct(productTitle: string) {
  const title = normalized(productTitle)
  return OFFICIAL_SOURCES.find((source) =>
    source.identityTerms.every((term) => title.includes(normalized(term)))) ?? null
}

function jsonLdProduct(html: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  const products: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object") return
    const entry = value as Record<string, unknown>
    const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]]
    if (types.some((type) => normalized(type) === "product")) products.push(entry)
    if (Array.isArray(entry["@graph"])) entry["@graph"].forEach(visit)
  }
  for (const match of scripts) {
    try { visit(JSON.parse(match[1])) } catch { /* malformed metadata is ignored */ }
  }
  return products[0] ?? null
}

function productTitle(html: string, product: Record<string, unknown> | null) {
  const structured = typeof product?.name === "string" ? decodedText(product.name) : ""
  if (structured) return structured
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  if (h1) return decodedText(h1)
  const meta = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
  return meta ? decodedText(meta) : ""
}

function structuredBrand(product: Record<string, unknown> | null) {
  const brand = product?.brand
  if (typeof brand === "string") return decodedText(brand)
  if (brand && typeof brand === "object" && typeof (brand as Record<string, unknown>).name === "string") {
    return decodedText(String((brand as Record<string, unknown>).name))
  }
  return ""
}

async function boundedHtml(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let html = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_OFFICIAL_PAGE_BYTES) throw new Error("OFFICIAL_PAGE_TOO_LARGE")
      html += decoder.decode(value, { stream: true })
    }
    html += decoder.decode()
    return html
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export async function fetchOfficialManufacturerFacts(input: {
  productTitle: string
  fetchImpl?: typeof fetch
  now?: Date
}) {
  const source = sourceForProduct(input.productTitle)
  const observedAt = (input.now ?? new Date()).toISOString()
  if (!source) return {
    status: "NOT_ALLOWLISTED" as const,
    observedAt,
    sourceReference: null,
    facts: [] as OfficialFact[],
    audit: { allowlistedOfficialDomainConfigured: false, externalPageFetched: false,
      identityMatched: false, rawHtmlStored: false, sourceUrlStored: false },
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const url = new URL(source.path, source.origin)
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    })
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? ""
    if (!response.ok || response.status >= 300 || !contentType.includes("text/html")) {
      return { status: "REQUEST_FAILED" as const, observedAt,
        sourceReference: sourceReference(source), facts: [] as OfficialFact[],
        audit: { allowlistedOfficialDomainConfigured: true, externalPageFetched: false,
          identityMatched: false, rawHtmlStored: false, sourceUrlStored: false } }
    }
    const html = await boundedHtml(response)
    const structured = jsonLdProduct(html)
    const officialTitle = productTitle(html, structured)
    const expected = normalized(input.productTitle)
    const observed = normalized(officialTitle)
    const identityMatched = source.identityTerms.every((term) =>
      expected.includes(normalized(term)) && observed.includes(normalized(term)))
    if (!identityMatched) return { status: "NO_MATCH" as const, observedAt,
      sourceReference: sourceReference(source), facts: [] as OfficialFact[],
      audit: { allowlistedOfficialDomainConfigured: true, externalPageFetched: true,
        identityMatched: false, rawHtmlStored: false, sourceUrlStored: false } }
    const officialBrand = structuredBrand(structured)
    const facts: OfficialFact[] = [
      { key: "brand", value: officialBrand || source.brand, unit: null },
      { key: "exactProductName", value: officialTitle, unit: null },
      ...(source.extractors ?? []).filter((extractor) => extractor.pattern.test(html))
        .map((extractor) => ({ key: extractor.key, value: extractor.value, unit: extractor.unit ?? null })),
    ]
    // Raw markup and the URL exist only for this stack frame. The returned
    // payload contains a one-way reference and structured facts only.
    return { status: "AVAILABLE" as const, observedAt,
      sourceReference: sourceReference(source), facts,
      audit: { allowlistedOfficialDomainConfigured: true, externalPageFetched: true,
        identityMatched: true, rawHtmlStored: false, sourceUrlStored: false } }
  } catch {
    return { status: "REQUEST_FAILED" as const, observedAt,
      sourceReference: sourceReference(source), facts: [] as OfficialFact[],
      audit: { allowlistedOfficialDomainConfigured: true, externalPageFetched: false,
        identityMatched: false, rawHtmlStored: false, sourceUrlStored: false } }
  } finally {
    clearTimeout(timeout)
  }
}
