import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { SELLER_OS_888LOTS_SOURCE_KEY } from
  "./seller-os-888lots-supplier-onboarding-v1"

export const SELLER_OS_888LOTS_PUBLIC_RADAR_V1 =
  "SELLER_OS_888LOTS_PUBLIC_RADAR_V1" as const

export const SELLER_OS_888LOTS_PUBLIC_VIEWS_V1 = [
  "trending", "newest", "price_drop", "staff_picks",
] as const

export type SellerOs888LotsPublicViewV1 =
  typeof SELLER_OS_888LOTS_PUBLIC_VIEWS_V1[number]

const VIEW_URLS: Record<SellerOs888LotsPublicViewV1, string> = {
  trending: "https://888lots.com/items/trending",
  newest: "https://888lots.com/newest",
  price_drop: "https://888lots.com/items/recent-price-drop",
  staff_picks: "https://888lots.com/items/staff-picks",
}

const MAX_PUBLIC_RESPONSE_BYTES = 5_000_000
const MAX_PUBLIC_ITEMS_PER_CAPTURE = 100
const REPLAY_WINDOW_MS = 6 * 60 * 60 * 1000

type UnknownRecord = Record<string, unknown>

export type SellerOs888LotsPublicCandidateV1 = {
  contractVersion: typeof SELLER_OS_888LOTS_PUBLIC_RADAR_V1
  sourceView: SellerOs888LotsPublicViewV1
  capturedAt: string
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  handle: string
  title: string
  brand: string | null
  department: string | null
  category: string | null
  productUrl: string
  imageUrl: string | null
  asin: string | null
  upc: string | null
  conditionCode: string | null
  conditionLabel: string | null
  availableQuantity: number | null
  minimumOrderQuantity: number | null
  currentUnitCostUsd: number | null
  regularUnitCostUsd: number | null
  publicShippingEstimateUsd: number | null
  supplierAmazonPriceEstimateUsd: number | null
  supplierAmazonOfferCount: number | null
  supplierAmazonSalesRank: number | null
  promotion: {
    active: boolean
    name: string | null
    discountPercent: number | null
    firstOrderOnly: boolean
  }
  estimatedGrossSpreadUsd: number | null
  estimatedGrossSpreadPercent: number | null
  researchScore: number
  researchLane: "RESEARCH_NOW" | "REVIEW_RISK" | "WAIT_SUPPLIER" |
    "LOW_PRIORITY"
  nextBestEvidence: "VERIFY_AMAZON_ASIN" | "VERIFY_AMAZON_ELIGIBILITY" |
    "GET_AMAZON_DEMAND" | "CAPTURE_DELIVERED_COST" | "WAIT_UPSTREAM"
  blockers: string[]
  riskFlags: string[]
  observationDigest: string
}

export type SellerOs888LotsRadarCardV1 = SellerOs888LotsPublicCandidateV1 & {
  productId: string
  snapshotId: string
  lastObservedAt: string
  commercialDecision: string | null
  commercialLifecycleStage: string | null
  commercialNextBestEvidence: string | null
  commercialUpdatedAt: string | null
  commercialMaxSupplierUnitCostUsd: number | null
  preSearch: UnknownRecord | null
  operatingLane: "NEW_DISCOVERY" | "RESEARCH_PENDING" | "BUY_READY" |
    "HOLD" | "REJECTED" | "RESULT"
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function finite(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integer(value: unknown) {
  const parsed = finite(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function money(value: unknown) {
  const parsed = finite(value)
  return parsed === null || parsed < 0
    ? null : Number(parsed.toFixed(2))
}

function positiveMoney(value: unknown) {
  const parsed = money(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function absolute888LotsUrl(value: unknown) {
  try {
    const parsed = new URL(text(value), "https://888lots.com")
    return parsed.protocol === "https:" && parsed.hostname === "888lots.com" &&
      parsed.pathname.startsWith("/item/") && !parsed.username && !parsed.password
      ? parsed.href : ""
  } catch {
    return ""
  }
}

function externalImageUrl(value: unknown) {
  try {
    const parsed = new URL(text(value))
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href : null
  } catch {
    return null
  }
}

function exactAsin(value: unknown) {
  const normalized = text(value).toUpperCase()
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null
}

function categoryName(item: UnknownRecord) {
  const categories = record(item.categories)
  return text(record(categories.category).name) || null
}

function departmentName(item: UnknownRecord) {
  const tree = record(item.categories).tree
  const first = Array.isArray(tree) ? record(tree[0]) : {}
  return text(first.name) || null
}

function brandName(item: UnknownRecord) {
  const brand = record(item.brand)
  const azData = record(item.azData)
  return text(brand.name) || text(azData.brand) || null
}

function getRiskFlags(input: {
  title: string
  brand: string | null
  category: string | null
  department: string | null
  minimumOrderQuantity: number | null
  promotionActive: boolean
  firstOrderOnly: boolean
}) {
  const categoryText = [input.category, input.department]
    .filter(Boolean).join(" ").toLowerCase()
  const productText = [input.title, input.brand]
    .filter(Boolean).join(" ").toLowerCase()
  const haystack = `${categoryText} ${productText}`
  const risks: string[] = []
  if (/(beauty|health|personal care|grocery)/i.test(categoryText) ||
    /\b(supplement|vitamin|ointment|wax|shampoo|medicine|dewormer|food)\b/i
      .test(productText)) {
    risks.push("AMAZON_APPROVAL_OR_COMPLIANCE_REVIEW")
  }
  if (/(electronics|computer|mobile|appliance|video game|battery|electrical)/i
    .test(haystack)) {
    risks.push("RETURN_OR_FUNCTIONALITY_REVIEW")
  }
  if (/(clothing|fashion|shoe|boot|sneaker|dress|shirt|jacket|pants)/i
    .test(haystack)) {
    risks.push("VARIATION_AND_RETURN_RISK")
  }
  if (/(luxury|designer|prada|dior|gucci|burberry|versace|coach|michael kors)/i
    .test(haystack)) {
    risks.push("BRAND_AUTHENTICITY_OR_IP_REVIEW")
  }
  if ((input.minimumOrderQuantity ?? 0) > 3) {
    risks.push("MOQ_ABOVE_POLICY_LIMITED_TEST_CAP")
  }
  if (input.promotionActive && input.firstOrderOnly) {
    risks.push("FIRST_ORDER_PROMO_NON_RECURRING")
  }
  return [...new Set(risks)]
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getResearchPriority(input: {
  sourceView: SellerOs888LotsPublicViewV1
  asin: string | null
  availableQuantity: number | null
  minimumOrderQuantity: number | null
  currentUnitCostUsd: number | null
  amazonEstimateUsd: number | null
  spreadPercent: number | null
  conditionLabel: string | null
  riskFlags: string[]
}) {
  let score = 0
  if (input.asin) score += 20
  if ((input.availableQuantity ?? 0) > 0) score += 10
  if (input.availableQuantity !== null && input.minimumOrderQuantity !== null &&
    input.availableQuantity >= input.minimumOrderQuantity) score += 10
  if ((input.minimumOrderQuantity ?? 1000) <= 3) score += 15
  else if ((input.minimumOrderQuantity ?? 1000) <= 6) score += 8
  if ((input.currentUnitCostUsd ?? 0) > 0) score += 10
  if ((input.amazonEstimateUsd ?? 0) > 0) score += 15
  if ((input.spreadPercent ?? 0) >= 50) score += 15
  else if ((input.spreadPercent ?? 0) >= 30) score += 8
  if (/brand new|distribution|fulfilled by amazon/i.test(input.conditionLabel ?? "")) {
    score += 5
  }
  if (input.sourceView === "trending" || input.sourceView === "price_drop") score += 5
  score -= input.riskFlags.filter((flag) => flag !==
    "FIRST_ORDER_PROMO_NON_RECURRING").length * 7
  return clamp(score)
}

function extractBalancedJsonObject(source: string, start: number) {
  if (source[start] !== "{") throw new Error("SELLER_OS_888LOTS_PUBLIC_ITEMS_INVALID")
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error("SELLER_OS_888LOTS_PUBLIC_ITEMS_TRUNCATED")
}

export function parse888LotsPublicCatalogHtmlV1(input: {
  html: string
  sourceView: SellerOs888LotsPublicViewV1
  capturedAt: string
}) {
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("SELLER_OS_888LOTS_PUBLIC_CAPTURE_TIME_INVALID")
  }
  if (!input.html || input.html.length > MAX_PUBLIC_RESPONSE_BYTES) {
    throw new Error("SELLER_OS_888LOTS_PUBLIC_RESPONSE_SIZE_INVALID")
  }
  const marker = /\bitems\s*:\s*(?=\{"current_page")/.exec(input.html)
  if (!marker) throw new Error("SELLER_OS_888LOTS_PUBLIC_ITEMS_NOT_FOUND")
  const objectStart = input.html.indexOf("{", marker.index + marker[0].length - 1)
  const payload = record(JSON.parse(extractBalancedJsonObject(input.html, objectStart)))
  const rows = Array.isArray(payload.data)
    ? payload.data.slice(0, MAX_PUBLIC_ITEMS_PER_CAPTURE).map(record) : []
  if (rows.length === 0) throw new Error("SELLER_OS_888LOTS_PUBLIC_ITEMS_EMPTY")

  return rows.map((item): SellerOs888LotsPublicCandidateV1 | null => {
    const supplierProductId = String(integer(item.id) ?? "")
    const handle = text(item.slug)
    const supplierSku = text(item.sku)
    const supplierVariantId = text(item.sl_sku) || supplierSku
    const title = text(item.description)
    const productUrl = absolute888LotsUrl(item.href)
    if (!supplierProductId || !handle || !supplierSku || !supplierVariantId ||
      !title || !productUrl) return null
    const azData = record(item.azData)
    const images = record(item.images)
    const condition = record(item.cond)
    const promotion = record(item.promo)
    const asin = exactAsin(item.asin)
    const upcs = Array.isArray(azData.upc) ? azData.upc.map(text).filter(Boolean) : []
    const upc = text(item.upc) || upcs[0] || null
    const availableQuantity = integer(item.qty)
    const minimumOrderQuantity = integer(item.moq)
    const currentUnitCostUsd = positiveMoney(item.price)
    const regularUnitCostUsd = positiveMoney(promotion.old_price)
    const publicShippingEstimateUsd = money(item.flatShip)
    const supplierAmazonPriceEstimateUsd = positiveMoney(item.az_price)
    const supplierAmazonOfferCount = integer(azData.all_offers_count)
    const rawRank = integer(azData.sales_rank)
    const supplierAmazonSalesRank = rawRank !== null && rawRank >= 0 ? rawRank : null
    const estimatedGrossSpreadUsd = supplierAmazonPriceEstimateUsd !== null &&
      currentUnitCostUsd !== null
      ? Number((supplierAmazonPriceEstimateUsd - currentUnitCostUsd -
        (publicShippingEstimateUsd ?? 0)).toFixed(2)) : null
    const estimatedGrossSpreadPercent = estimatedGrossSpreadUsd !== null &&
      supplierAmazonPriceEstimateUsd !== null && supplierAmazonPriceEstimateUsd > 0
      ? Number((estimatedGrossSpreadUsd / supplierAmazonPriceEstimateUsd * 100)
        .toFixed(2)) : null
    const promotionActive = promotion.active === true
    const promotionName = text(promotion.name) || null
    const promotionTerms = text(promotion.terms).toLowerCase()
    const firstOrderOnly = /first order/.test(`${promotionName ?? ""} ${promotionTerms}`)
    const department = departmentName(item)
    const category = categoryName(item)
    const brand = brandName(item)
    const riskFlags = getRiskFlags({ title, brand, category, department,
      minimumOrderQuantity, promotionActive, firstOrderOnly })
    const blockers = [
      "DELIVERED_COST_CART_CONFIRMATION_REQUIRED",
      "MARKETPLACE_DEMAND_NOT_YET_VERIFIED",
      ...(availableQuantity === null ? ["SUPPLIER_QUANTITY_UNVERIFIED"] : []),
      ...(minimumOrderQuantity === null ? ["SUPPLIER_MOQ_UNVERIFIED"] : []),
      ...((availableQuantity ?? 0) < (minimumOrderQuantity ?? 1)
        ? ["SUPPLIER_STOCK_BELOW_MOQ"] : []),
      ...(supplierAmazonPriceEstimateUsd === null
        ? ["SUPPLIER_AMAZON_ESTIMATE_UNAVAILABLE"] : []),
    ]
    const researchScore = getResearchPriority({ sourceView: input.sourceView,
      asin, availableQuantity, minimumOrderQuantity, currentUnitCostUsd,
      amazonEstimateUsd: supplierAmazonPriceEstimateUsd,
      spreadPercent: estimatedGrossSpreadPercent,
      conditionLabel: text(condition.name) || null, riskFlags })
    const unavailable = availableQuantity !== null && availableQuantity < 1
    const researchLane = unavailable ||
      (availableQuantity ?? 0) < (minimumOrderQuantity ?? 1)
      ? "WAIT_SUPPLIER" as const
      : riskFlags.some((flag) => /APPROVAL|AUTHENTICITY|FUNCTIONALITY/.test(flag))
        ? "REVIEW_RISK" as const
        : researchScore >= 65 ? "RESEARCH_NOW" as const : "LOW_PRIORITY" as const
    const nextBestEvidence = unavailable ? "WAIT_UPSTREAM" as const
      : !asin ? "VERIFY_AMAZON_ASIN" as const
        : riskFlags.some((flag) => /APPROVAL|AUTHENTICITY/.test(flag))
          ? "VERIFY_AMAZON_ELIGIBILITY" as const
          : publicShippingEstimateUsd === null
            ? "CAPTURE_DELIVERED_COST" as const : "GET_AMAZON_DEMAND" as const
    const withoutDigest = {
      contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
      sourceView: input.sourceView,
      supplierProductId, supplierVariantId, supplierSku, handle, title, brand,
      department, category, productUrl,
      imageUrl: externalImageUrl(images.large) ?? externalImageUrl(images.thumbnail),
      asin, upc, conditionCode: text(item.condition) || null,
      conditionLabel: text(condition.name) || null,
      availableQuantity, minimumOrderQuantity, currentUnitCostUsd,
      regularUnitCostUsd, publicShippingEstimateUsd,
      supplierAmazonPriceEstimateUsd, supplierAmazonOfferCount,
      supplierAmazonSalesRank,
      promotion: { active: promotionActive, name: promotionName,
        discountPercent: finite(promotion.discount), firstOrderOnly },
      estimatedGrossSpreadUsd, estimatedGrossSpreadPercent, researchScore,
      researchLane, nextBestEvidence,
      blockers: [...new Set(blockers)], riskFlags,
    }
    return { ...withoutDigest, capturedAt: input.capturedAt,
      observationDigest: sha256(withoutDigest) }
  }).filter((entry): entry is SellerOs888LotsPublicCandidateV1 => Boolean(entry))
}

export function build888LotsPublicRadarSnapshotV1(
  candidate: SellerOs888LotsPublicCandidateV1,
) {
  return {
    supplier_variant_id: candidate.supplierVariantId,
    variant_title: candidate.title,
    sku: candidate.supplierSku,
    barcode: candidate.upc,
    price: candidate.currentUnitCostUsd,
    compare_at_price: candidate.regularUnitCostUsd,
    available: candidate.availableQuantity === null
      ? null : candidate.availableQuantity > 0,
    inventory_quantity: candidate.availableQuantity,
    collections: [...new Set(["888lots", candidate.sourceView,
      candidate.department, candidate.category].filter(Boolean) as string[])],
    discount_percent: candidate.promotion.discountPercent,
    raw: { contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
      observationDigest: candidate.observationDigest,
      publicCandidate: candidate,
      evidencePolicy: { supplierAmazonPriceIsEstimateOnly: true,
        publicShippingRequiresCartConfirmation: true,
        demandUnitsInvented: false },
      safety: { supplierPurchases: 0, marketplaceWrites: 0,
        publications: 0, repricing: 0 } },
    captured_at: candidate.capturedAt,
  }
}

function buildEvents(input: {
  sourceId: string
  productId: string
  candidate: SellerOs888LotsPublicCandidateV1
  previous: UnknownRecord | null
}) {
  const next = build888LotsPublicRadarSnapshotV1(input.candidate)
  const previousRaw = record(input.previous?.raw)
  const previousCandidate = record(previousRaw.publicCandidate)
  const previousPrice = money(input.previous?.price)
  const previousAvailable = typeof input.previous?.available === "boolean"
    ? input.previous.available : null
  const previousPromo = record(previousCandidate.promotion).active === true
  const nextPromo = input.candidate.promotion.active
  const events: Array<{ event_type: string, old_value: UnknownRecord | null,
    new_value: UnknownRecord, event_strength: number }> = []
  const newValue = { price: next.price, available: next.available,
    inventoryQuantity: next.inventory_quantity,
    promotionActive: nextPromo, observationDigest: input.candidate.observationDigest }
  if (!input.previous) {
    events.push({ event_type: "new_product", old_value: null,
      new_value: newValue, event_strength: 3 })
  } else {
    if (previousAvailable === false && next.available === true) {
      events.push({ event_type: "restocked", old_value: { available: false },
        new_value: newValue, event_strength: 4 })
    } else if (previousAvailable === true && next.available === false) {
      events.push({ event_type: "out_of_stock", old_value: { available: true },
        new_value: newValue, event_strength: 5 })
    }
    if (previousPrice !== null && next.price !== null && previousPrice !== next.price) {
      events.push({ event_type: next.price < previousPrice ? "price_down" : "price_up",
        old_value: { price: previousPrice }, new_value: newValue,
        event_strength: next.price < previousPrice ? 4 : 2 })
    }
    if (!previousPromo && nextPromo) {
      events.push({ event_type: "discount_started",
        old_value: { promotionActive: false }, new_value: newValue,
        event_strength: 3 })
    } else if (previousPromo && !nextPromo) {
      events.push({ event_type: "discount_ended",
        old_value: { promotionActive: true }, new_value: newValue,
        event_strength: 2 })
    }
  }
  return events.map((event) => ({ source_id: input.sourceId,
    product_id: input.productId,
    supplier_variant_id: input.candidate.supplierVariantId,
    ...event,
    idempotency_key: `888lots:${sha256({ productId: input.productId,
      eventType: event.event_type, oldValue: event.old_value,
      newValue: event.new_value })}`,
    created_at: input.candidate.capturedAt }))
}

async function fetchPublicView(input: {
  sourceView: SellerOs888LotsPublicViewV1
  fetchImpl?: typeof fetch
  capturedAt: string
}) {
  const fetchImpl = input.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetchImpl(VIEW_URLS[input.sourceView], {
      method: "GET", redirect: "follow", cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml",
        "User-Agent": "IMNOVA-Seller-OS-888Lots-Radar/1.0 (owner initiated)" },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error("SELLER_OS_888LOTS_PUBLIC_FETCH_FAILED")
    const contentLength = Number(response.headers.get("content-length") ?? "0")
    if (contentLength > MAX_PUBLIC_RESPONSE_BYTES) {
      throw new Error("SELLER_OS_888LOTS_PUBLIC_RESPONSE_SIZE_INVALID")
    }
    const html = await response.text()
    return parse888LotsPublicCatalogHtmlV1({ html,
      sourceView: input.sourceView, capturedAt: input.capturedAt })
  } finally {
    clearTimeout(timeout)
  }
}

export async function run888LotsPublicRadarSyncV1(input: {
  supabase: SupabaseClient
  sourceView: SellerOs888LotsPublicViewV1
  now?: Date
  fetchImpl?: typeof fetch
}) {
  const now = input.now ?? new Date()
  const capturedAt = now.toISOString()
  const source = await input.supabase.from("market_radar_sources").upsert({
    key: SELLER_OS_888LOTS_SOURCE_KEY, name: "888 Lots",
    base_url: "https://888lots.com", is_active: false,
    poll_interval_minutes: 1440, last_run_at: capturedAt,
  }, { onConflict: "key" }).select("id,key").single()
  if (source.error || !source.data) {
    throw new Error("SELLER_OS_888LOTS_RADAR_SOURCE_WRITE_FAILED")
  }
  try {
    const candidates = await fetchPublicView({ sourceView: input.sourceView,
      fetchImpl: input.fetchImpl, capturedAt })
    const productRows = candidates.map((candidate) => ({
      source_id: source.data.id,
      supplier_product_id: candidate.supplierProductId,
      handle: candidate.handle,
      title: candidate.title,
      vendor: candidate.brand,
      product_type: candidate.category,
      tags: ["888lots", "public-catalog", candidate.sourceView],
      product_url: candidate.productUrl,
      featured_image_url: candidate.imageUrl,
      image_urls: candidate.imageUrl ? [candidate.imageUrl] : [],
      last_seen_at: capturedAt,
      last_snapshot_at: capturedAt,
      is_active: (candidate.availableQuantity ?? 0) > 0,
      metadata: { contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
        asin: candidate.asin, upc: candidate.upc,
        minimumOrderQuantity: candidate.minimumOrderQuantity,
        conditionCode: candidate.conditionCode,
        conditionLabel: candidate.conditionLabel,
        latestResearchScore: candidate.researchScore,
        latestResearchLane: candidate.researchLane,
        captureMode: "OWNER_INITIATED_PUBLIC_CATALOG" },
    }))
    const products = await input.supabase.from("market_radar_products")
      .upsert(productRows, { onConflict: "source_id,supplier_product_id" })
      .select("id,supplier_product_id")
    if (products.error || !products.data) {
      throw new Error("SELLER_OS_888LOTS_RADAR_PRODUCT_WRITE_FAILED")
    }
    const productIdBySupplierId = new Map(products.data.map((entry) =>
      [String(entry.supplier_product_id), String(entry.id)]))
    const productIds = [...productIdBySupplierId.values()]
    const previousRows = productIds.length > 0
      ? await input.supabase.from("market_radar_latest_snapshots")
        .select("id,product_id,price,available,inventory_quantity,raw,captured_at")
        .in("product_id", productIds)
      : { data: [], error: null }
    if (previousRows.error) {
      throw new Error("SELLER_OS_888LOTS_RADAR_PREVIOUS_READ_FAILED")
    }
    const latestByProduct = new Map<string, UnknownRecord>()
    for (const row of previousRows.data ?? []) {
      const typed = record(row)
      const productId = text(typed.product_id)
      if (productId && !latestByProduct.has(productId)) latestByProduct.set(productId, typed)
    }
    const snapshots: UnknownRecord[] = []
    const events: UnknownRecord[] = []
    const scores: UnknownRecord[] = []
    let replayedProducts = 0
    for (const candidate of candidates) {
      const productId = productIdBySupplierId.get(candidate.supplierProductId)
      if (!productId) throw new Error("SELLER_OS_888LOTS_RADAR_PRODUCT_READBACK_FAILED")
      const previous = latestByProduct.get(productId) ?? null
      const previousDigest = text(record(previous?.raw).observationDigest)
      const previousAt = Date.parse(text(previous?.captured_at))
      const replay = previousDigest === candidate.observationDigest &&
        Number.isFinite(previousAt) && now.getTime() - previousAt < REPLAY_WINDOW_MS
      if (replay) replayedProducts += 1
      else {
        snapshots.push({ source_id: source.data.id, product_id: productId,
          ...build888LotsPublicRadarSnapshotV1(candidate) })
        events.push(...buildEvents({ sourceId: source.data.id, productId,
          candidate, previous }))
      }
      scores.push({ product_id: productId, source_id: source.data.id,
        opportunity_score: candidate.researchScore,
        rotation_score: 0,
        price_score: clamp(candidate.estimatedGrossSpreadPercent ?? 0),
        stock_score: (candidate.availableQuantity ?? 0) > 0 ? 50 : 0,
        discount_score: clamp(candidate.promotion.discountPercent ?? 0),
        collection_score: candidate.sourceView === "trending" ? 75 :
          candidate.sourceView === "price_drop" ? 65 : 50,
        updated_at: capturedAt })
    }
    let insertedSnapshots: Array<{ id: string, product_id: string }> = []
    if (snapshots.length > 0) {
      const result = await input.supabase.from("market_radar_snapshots")
        .insert(snapshots).select("id,product_id")
      if (result.error || !result.data) {
        throw new Error("SELLER_OS_888LOTS_RADAR_SNAPSHOT_WRITE_FAILED")
      }
      insertedSnapshots = result.data.map((entry) => ({ id: String(entry.id),
        product_id: String(entry.product_id) }))
    }
    if (events.length > 0) {
      const result = await input.supabase.from("market_radar_events")
        .upsert(events, { onConflict: "idempotency_key", ignoreDuplicates: true })
      if (result.error) throw new Error("SELLER_OS_888LOTS_RADAR_EVENT_WRITE_FAILED")
    }
    const scoreResult = await input.supabase.from("market_radar_scores")
      .upsert(scores, { onConflict: "product_id" })
    if (scoreResult.error) throw new Error("SELLER_OS_888LOTS_RADAR_SCORE_WRITE_FAILED")
    const readback = insertedSnapshots.length > 0
      ? await input.supabase.from("market_radar_snapshots").select("id")
        .in("id", insertedSnapshots.map((entry) => entry.id))
      : { data: [], error: null }
    if (readback.error || (readback.data?.length ?? 0) !== insertedSnapshots.length) {
      throw new Error("SELLER_OS_888LOTS_RADAR_READBACK_FAILED")
    }
    const sourceUpdate = await input.supabase.from("market_radar_sources").update({
      last_success_at: capturedAt, last_error: null,
    }).eq("id", source.data.id)
    if (sourceUpdate.error) {
      throw new Error("SELLER_OS_888LOTS_RADAR_SOURCE_RECEIPT_FAILED")
    }
    return { contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
      sourceView: input.sourceView, capturedAt,
      productsObserved: candidates.length,
      productsUpserted: products.data.length,
      snapshotsInserted: insertedSnapshots.length,
      replayedProducts,
      eventsObserved: events.length,
      topResearchCandidates: candidates.filter((candidate) =>
        candidate.researchLane === "RESEARCH_NOW").length,
      safety: { ownerInitiatedPublicReads: 1, automatedPolling: false,
        supplierPurchases: 0, marketplaceWrites: 0, publications: 0,
        repricing: 0 },
    }
  } catch (error) {
    await input.supabase.from("market_radar_sources").update({
      last_error: error instanceof Error ? error.message.slice(0, 500)
        : "SELLER_OS_888LOTS_RADAR_FAILED",
    }).eq("id", source.data.id)
    throw error
  }
}

function operatingLane(input: {
  candidate: SellerOs888LotsPublicCandidateV1
  memory: UnknownRecord | null
}) {
  const decision = text(input.memory?.commercial_decision)
  const stage = text(input.memory?.commercial_lifecycle_stage)
  if (stage === "RESULT" || stage === "PUBLISHED") return "RESULT" as const
  if (decision === "GO") return "BUY_READY" as const
  if (decision === "REJECT") return "REJECTED" as const
  if (decision === "HOLD") return "HOLD" as const
  if (input.candidate.researchLane === "RESEARCH_NOW") return "NEW_DISCOVERY" as const
  return "RESEARCH_PENDING" as const
}

export async function get888LotsRadarDashboardV1(input: {
  supabase: SupabaseClient
  accountKey: string
  limit?: number
}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200)
  const source = await input.supabase.from("market_radar_sources")
    .select("id,key,name,is_active,last_run_at,last_success_at,last_error")
    .eq("key", SELLER_OS_888LOTS_SOURCE_KEY).limit(1).maybeSingle()
  if (source.error) throw new Error("SELLER_OS_888LOTS_RADAR_SOURCE_READ_FAILED")
  if (!source.data) {
    return { contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
      source: null, summary: { total: 0, newDiscoveries: 0,
        researchPending: 0, buyReady: 0, hold: 0, rejected: 0, result: 0 },
      cards: [], safety: { automatedPolling: false, supplierPurchases: 0,
        marketplaceWrites: 0 } }
  }
  const products = await input.supabase.from("market_radar_products")
    .select("id,supplier_product_id,title,vendor,product_type,product_url,featured_image_url,metadata,last_seen_at")
    .eq("source_id", source.data.id).order("last_seen_at", { ascending: false })
    .limit(limit)
  if (products.error) throw new Error("SELLER_OS_888LOTS_RADAR_PRODUCT_READ_FAILED")
  const productIds = (products.data ?? []).map((entry) => String(entry.id))
  const snapshots = productIds.length > 0
    ? await input.supabase.from("market_radar_latest_snapshots")
      .select("id,product_id,raw,captured_at").in("product_id", productIds)
    : { data: [], error: null }
  if (snapshots.error) throw new Error("SELLER_OS_888LOTS_RADAR_SNAPSHOT_READ_FAILED")
  const latestByProduct = new Map<string, UnknownRecord>()
  for (const row of snapshots.data ?? []) {
    const typed = record(row)
    const productId = text(typed.product_id)
    if (productId && !latestByProduct.has(productId)) latestByProduct.set(productId, typed)
  }
  const opportunities = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("supplier_product_id,commercial_decision,commercial_lifecycle_stage,commercial_next_best_evidence,commercial_updated_at,commercial_memory")
    .eq("commercial_account_key", input.accountKey)
    .like("candidate_key", `${SELLER_OS_888LOTS_SOURCE_KEY}:%`)
    .order("commercial_updated_at", { ascending: false }).limit(limit)
  if (opportunities.error) {
    throw new Error("SELLER_OS_888LOTS_RADAR_MEMORY_READ_FAILED")
  }
  const memoryBySupplierProduct = new Map<string, UnknownRecord>()
  for (const row of opportunities.data ?? []) {
    const typed = record(row)
    const productId = text(typed.supplier_product_id)
    if (productId && !memoryBySupplierProduct.has(productId)) {
      memoryBySupplierProduct.set(productId, typed)
    }
  }
  const cards = (products.data ?? []).flatMap((row): SellerOs888LotsRadarCardV1[] => {
    const product = record(row)
    const snapshot = latestByProduct.get(text(product.id))
    const publicCandidate = record(record(snapshot?.raw).publicCandidate)
    if (text(publicCandidate.contractVersion) !== SELLER_OS_888LOTS_PUBLIC_RADAR_V1) {
      return []
    }
    const candidate = publicCandidate as SellerOs888LotsPublicCandidateV1
    const memory = memoryBySupplierProduct.get(text(product.supplier_product_id)) ?? null
    const commercialDocument = record(memory?.commercial_memory)
    const commercialEconomics = record(commercialDocument.economics)
    const preSearch = record(record(snapshot?.raw).preSearch)
    return [{ ...candidate, productId: text(product.id),
      snapshotId: text(snapshot?.id), lastObservedAt: text(snapshot?.captured_at),
      commercialDecision: text(memory?.commercial_decision) || null,
      commercialLifecycleStage: text(memory?.commercial_lifecycle_stage) || null,
      commercialNextBestEvidence: text(memory?.commercial_next_best_evidence) || null,
      commercialUpdatedAt: text(memory?.commercial_updated_at) || null,
      commercialMaxSupplierUnitCostUsd:
        finite(commercialEconomics.conservativeMaxSupplierUnitCostUsd),
      preSearch: text(preSearch.contractVersion) ? preSearch : null,
      operatingLane: operatingLane({ candidate, memory }) }]
  }).sort((left, right) => {
    const order = { BUY_READY: 0, NEW_DISCOVERY: 1, RESEARCH_PENDING: 2,
      HOLD: 3, REJECTED: 4, RESULT: 5 }
    return order[left.operatingLane] - order[right.operatingLane] ||
      right.researchScore - left.researchScore ||
      right.lastObservedAt.localeCompare(left.lastObservedAt)
  })
  const count = (lane: SellerOs888LotsRadarCardV1["operatingLane"]) =>
    cards.filter((card) => card.operatingLane === lane).length
  return { contractVersion: SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
    source: { ...source.data, automatedPolling: false,
      accountStatus: "PUBLIC_CATALOG_AVAILABLE_ACCOUNT_PENDING_APPROVAL" },
    summary: { total: cards.length, newDiscoveries: count("NEW_DISCOVERY"),
      researchPending: count("RESEARCH_PENDING"), buyReady: count("BUY_READY"),
      hold: count("HOLD"), rejected: count("REJECTED"), result: count("RESULT") },
    cards,
    policy: { minimumNetProfitUsd: 0, clickOnlyMaximumTestUnits: 3,
      exactVelocityCoverageDays: 14, supplierEstimateIsNotMarketProof: true,
      deliveredCostRequiresCartConfirmation: true,
      firstOrderPromotionIsNotRecurringEconomics: true },
    safety: { automatedPolling: false, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0 },
  }
}
