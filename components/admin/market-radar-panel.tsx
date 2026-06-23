"use client"

import {
  type ElementType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  DollarSign,
  ExternalLink,
  FileSearch,
  PackageCheck,
  Radar,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react"
import {
  createPortal,
} from "react-dom"
import {
  supabase,
} from "@/lib/supabase"
import {
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
  type RadarAdvisorAlert,
  type MarketRadarSyncResult,
} from "@/lib/market-radar-types"

type MarketRadarApiResponse = {
  success: boolean
  dashboard?: MarketRadarDashboard
  sync?: MarketRadarSyncResult
  notification?: {
    success?: boolean
    total?: number
    successful?: number
    failed?: number
    opportunityCount?: number
    templateName?: string
    skipped?: boolean
    message?: string
    error?: string
  }
  error?: string
}

const MARKET_RADAR_REQUEST_TIMEOUT_MS =
  90000

function getAbortErrorMessage(
  fallbackMessage: string
) {
  return `${fallbackMessage} La sincronización tardó demasiado. Revisa el dashboard en unos minutos o intenta de nuevo.`
}

async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const responseText =
    await response.text()

  if (!responseText.trim()) {
    return {
      success:
        response.ok,
    } as T
  }

  try {
    return JSON.parse(responseText) as T
  } catch {
    const excerpt =
      responseText
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180)

    throw new Error(
      `${fallbackMessage}${excerpt ? ` Respuesta no JSON: ${excerpt}` : ""}`
    )
  }
}

type EbayPipelineApiResponse = {
  success: boolean
  dryRun?: boolean
  result?: {
    candidate?: {
      candidate_key?: string
      state?: string
    }
    persisted?: {
      candidate?: {
        id?: string
        candidate_key?: string
        state?: string
      }
    }
  }
  error?: string
}

type EbayPipelineEvaluationState = {
  status: "success" | "error"
  message: string
  candidateId?: string
  candidateKey?: string
  candidateState?: string
}

type PriceIntelligenceApiResponse = {
  success: boolean
  snapshot?: {
    id?: string
    recommended_sale_price?: number | string | null
    source_type?: string | null
    source_confidence?: string | null
  }
  error?: string
}

type PriceIntelligenceSaveState = {
  status: "success" | "error"
  message: string
  recommendedSalePrice?: number | string | null
}

type PriceIntelligenceFormState = {
  source_type: string
  price_capture_type: "sold" | "active"
  pasted_price_text: string
  shipping_scope: "us_domestic" | "international" | "unknown"
  buyer_location_country: string
  competitor_item_price: string
  competitor_shipping_price: string
  competitor_landed_price: string
  competitor_domestic_shipping_price: string
  competitor_domestic_landed_price: string
  competitor_international_shipping_price: string
  competitor_international_landed_price: string
  search_query: string
  product_match_type: string
  sold_avg_price: string
  sold_median_price: string
  sold_min_price: string
  sold_max_price: string
  sold_comp_count: string
  active_avg_price: string
  active_min_price: string
  active_max_price: string
  active_comp_count: string
  estimated_shipping_cost: string
  recommended_sale_price: string
  source_confidence: string
  confidence_score: string
  category_id: string
  category_name: string
  evidence_url: string
  evidence_notes: string
}

const priceSourceOptions = [
  "terapeak",
  "ebay_research",
  "manual",
  "aiprice",
  "zik",
  "serpapi",
  "ebay_api",
  "other",
]

const priceSourceLabels: Record<string, string> = {
  terapeak:
    "Terapeak / eBay Research",
  ebay_research:
    "eBay Research",
  manual:
    "Manual",
  aiprice:
    "Aiprice",
  zik:
    "ZIK",
  serpapi:
    "SerpAPI",
  ebay_api:
    "eBay API",
  other:
    "Otro",
}

const priceCaptureTypeOptions = [
  "sold",
  "active",
]

const priceCaptureTypeLabels: Record<string, string> = {
  sold:
    "Precios vendidos",
  active:
    "Precios activos",
}

const shippingScopeOptions = [
  "us_domestic",
  "international",
  "unknown",
]

const shippingScopeLabels: Record<string, string> = {
  us_domestic:
    "Envio domestico EE. UU.",
  international:
    "Envio internacional observado",
  unknown:
    "No estoy seguro",
}

const productMatchOptions = [
  "exact",
  "same_model",
  "similar",
  "category_only",
  "unknown",
]

const productMatchLabels: Record<string, string> = {
  exact:
    "Mismo producto",
  same_model:
    "Muy similar",
  similar:
    "Similar",
  category_only:
    "Solo misma categoria",
  unknown:
    "No estoy seguro",
}

type ParsedPriceIntelligenceText = {
  prices: number[]
  count: number
  min: number
  max: number
  avg: number
  median: number
}

type SuggestedPriceConfidence = {
  source_confidence: string
  confidence_score: number
}

const sourceConfidenceOptions = [
  "low",
  "medium",
  "high",
]

const sourceConfidenceLabels: Record<string, string> = {
  low:
    "Baja",
  medium:
    "Media",
  high:
    "Alta",
}

const eventLabels: Record<string, string> = {
  new_product:
    "Nuevo producto",
  restocked:
    "Volvio a stock",
  out_of_stock:
    "Agotado",
  price_up:
    "Precio subio",
  price_down:
    "Precio bajo",
  entered_collection:
    "Entro a coleccion",
  exited_collection:
    "Salio de coleccion",
  discount_started:
    "Inicio descuento",
  discount_ended:
    "Termino descuento",
}

const eventClassNames: Record<string, string> = {
  restocked:
    "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  out_of_stock:
    "border-red-300/25 bg-red-300/[0.10] text-red-100",
  price_down:
    "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  price_up:
    "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
  new_product:
    "border-violet-300/25 bg-violet-300/[0.10] text-violet-100",
  entered_collection:
    "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  exited_collection:
    "border-white/10 bg-white/[0.04] text-white/45",
  discount_started:
    "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  discount_ended:
    "border-white/10 bg-white/[0.04] text-white/45",
}

const collectionLabels: Record<string, string> = {
  products:
    "Products",
  "flash-sale":
    "Flash Sale",
  "weekly-deals":
    "Weekly Deals",
  "out-of-stock":
    "Out of Stock",
}

function toNumber(
  value: number | string | null | undefined
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function formatCurrency(
  value: number | string | null | undefined
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "-"
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
    }
  ).format(numericValue)
}

function formatNumber(
  value: number | string | null | undefined
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "0"
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 1,
    }
  ).format(numericValue)
}

function roundPriceValue(
  value: number
) {
  return Math.round(
    (value + 1e-8) * 100
  ) / 100
}

function formatPriceFormValue(
  value: number
) {
  return roundPriceValue(value).toFixed(2)
}

function calculatePriceMetrics(
  prices: number[]
): ParsedPriceIntelligenceText | null {
  if (prices.length === 0) {
    return null
  }

  const sortedPrices =
    [...prices].sort(
      (left, right) => left - right
    )

  const count =
    sortedPrices.length

  const avg =
    roundPriceValue(
      sortedPrices.reduce(
        (total, value) => total + value,
        0
      ) / count
    )

  const middleIndex =
    Math.floor(count / 2)

  const median =
    count % 2 === 0
      ? roundPriceValue(
          (
            sortedPrices[middleIndex - 1] +
            sortedPrices[middleIndex]
          ) / 2
        )
      : sortedPrices[middleIndex]

  return {
    prices:
      sortedPrices,
    count,
    min:
      sortedPrices[0],
    max:
      sortedPrices[count - 1],
    avg,
    median:
      roundPriceValue(median),
  }
}

function normalizeComparablePrices(
  text: string
) {
  return Array.from(
    text.matchAll(
      /(?:USD\s*)?\$?\s*(-?(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e\d+)?|nan|infinity))/gi
    )
  )
    .map(match => {
      const rawNumber =
        match[1]

      if (
        rawNumber.startsWith("-") ||
        /^(?:nan|infinity)$/i.test(rawNumber) ||
        /^0x[0-9a-f]+$/i.test(rawNumber) ||
        /^\d+(?:\.\d+)?e\d+$/i.test(rawNumber)
      ) {
        return null
      }

      const value =
        Number(rawNumber)

      return Number.isFinite(value) &&
        value >= 0
        ? roundPriceValue(value)
        : null
    })
    .filter((value): value is number =>
      value !== null
    )
}

function parsePriceIntelligenceText(
  text: string
): ParsedPriceIntelligenceText | null {
  return calculatePriceMetrics(
    normalizeComparablePrices(text)
  )
}

function normalizePriceSourceForPayload(
  sourceType: string
) {
  if (
    sourceType === "ebay_research" ||
    sourceType === "serpapi"
  ) {
    return sourceType === "ebay_research"
      ? "terapeak"
      : "other"
  }

  return sourceType
}

function suggestPriceConfidence({
  count,
  productMatchType,
  captureType,
  sourceType,
}: {
  count: number
  productMatchType: string
  captureType: "sold" | "active"
  sourceType: string
}): SuggestedPriceConfidence {
  const normalizedSourceType =
    normalizePriceSourceForPayload(
      sourceType
    )

  if (productMatchType === "unknown") {
    return {
      source_confidence:
        "low",
      confidence_score:
        count >= 5 ? 40 : 25,
    }
  }

  if (
    (
      productMatchType === "exact" ||
      productMatchType === "same_model"
    ) &&
    captureType === "sold" &&
    normalizedSourceType === "terapeak" &&
    count >= 5
  ) {
    return {
      source_confidence:
        "high",
      confidence_score:
        85,
    }
  }

  if (
    normalizedSourceType === "terapeak" &&
    captureType === "sold" &&
    count >= 8
  ) {
    return {
      source_confidence:
        "high",
      confidence_score:
        80,
    }
  }

  if (
    productMatchType === "similar" &&
    captureType === "sold" &&
    count >= 5
  ) {
    return {
      source_confidence:
        "medium",
      confidence_score:
        70,
    }
  }

  if (
    captureType === "active" &&
    count >= 8
  ) {
    return {
      source_confidence:
        normalizedSourceType === "aiprice"
          ? "low"
          : "medium",
      confidence_score:
        normalizedSourceType === "aiprice"
          ? 45
          : 55,
    }
  }

  return {
    source_confidence:
      "low",
    confidence_score:
      count >= 4 ? 45 : 35,
  }
}

function formatInventoryQuantity(
  value: number | null | undefined
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "Unidades sin confirmar"
  }

  return `${new Intl.NumberFormat(
    "en-US"
  ).format(value)} unidades`
}

function formatDate(
  value?: string | null
) {
  if (!value) {
    return "Sin registro"
  }

  try {
    return new Intl.DateTimeFormat(
      "es-NI",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone:
          "America/Managua",
      }
    ).format(
      new Date(value)
    )
  } catch {
    return "Fecha no disponible"
  }
}

function getScoreClassName(
  value: number | string | null | undefined
) {
  const score =
    toNumber(value) || 0

  if (score >= 70) {
    return "text-emerald-100"
  }

  if (score >= 45) {
    return "text-cyan-100"
  }

  if (score >= 25) {
    return "text-amber-100"
  }

  return "text-white/45"
}

function getEventValue(
  event: MarketRadarEventRow
) {
  if (
    event.event_type === "price_down" ||
    event.event_type === "price_up"
  ) {
    return `${formatCurrency(
      event.old_value?.price as number | string | null
    )} -> ${formatCurrency(
      event.new_value?.price as number | string | null
    )}`
  }

  if (
    event.event_type === "entered_collection" ||
    event.event_type === "exited_collection"
  ) {
    const collection =
      (
        event.new_value?.collection ||
        event.old_value?.collection ||
        ""
      ) as string

    return collectionLabels[collection] ||
      collection ||
      "-"
  }

  if (
    event.event_type === "restocked" ||
    event.event_type === "out_of_stock"
  ) {
    return event.new_value?.available === true
      ? "Disponible"
      : "Agotado"
  }

  return "-"
}

function getAdvisorSeverityClassName(
  severity: RadarAdvisorAlert["severity"]
) {
  if (severity === "critical") {
    return "border-red-300/30 bg-red-300/[0.12] text-red-100"
  }

  if (severity === "high") {
    return "border-amber-300/30 bg-amber-300/[0.12] text-amber-100"
  }

  if (severity === "medium") {
    return "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100"
  }

  return "border-white/10 bg-white/[0.04] text-white/55"
}

function getProductStatusLabel(
  product: MarketRadarProductRow
) {
  if (product.inventory_status === "out_of_stock") {
    return "Agotado"
  }

  if (
    product.inventory_status === "in_stock" &&
    product.inventory_source === "luna_availability"
  ) {
    return "Disponible sin cantidad"
  }

  if (product.inventory_status === "in_stock") {
    return "Disponible"
  }

  if (product.inventory_status === "unknown") {
    return "Sin dato"
  }

  if (
    product.available === true &&
    (
      product.inventory_quantity === null ||
      product.inventory_quantity === undefined
    )
  ) {
    return "Disponible sin cantidad"
  }

  if (product.available === true) {
    return "Disponible"
  }

  if (product.available === false) {
    return "Agotado"
  }

  return "Sin dato"
}

function getProductStatusClassName(
  product: MarketRadarProductRow
) {
  if (product.inventory_status === "out_of_stock") {
    return "border-red-300/25 bg-red-300/[0.10] text-red-100"
  }

  if (
    product.inventory_status === "in_stock" &&
    product.inventory_source === "luna_numeric"
  ) {
    return "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
  }

  if (
    product.inventory_status === "in_stock" &&
    product.inventory_source === "luna_availability"
  ) {
    return "border-amber-300/25 bg-amber-300/[0.10] text-amber-100"
  }

  if (product.inventory_status === "unknown") {
    return "border-white/10 bg-white/[0.04] text-white/45"
  }

  if (
    product.available === true &&
    (
      product.inventory_quantity === null ||
      product.inventory_quantity === undefined
    )
  ) {
    return "border-amber-300/25 bg-amber-300/[0.10] text-amber-100"
  }

  if (product.available === true) {
    return "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
  }

  if (product.available === false) {
    return "border-red-300/25 bg-red-300/[0.10] text-red-100"
  }

  return "border-white/10 bg-white/[0.04] text-white/45"
}

function getStockContextMessage(
  stockContext: RadarAdvisorAlert["stock_context"] | null | undefined
) {
  if (!stockContext) {
    return null
  }

  return stockContext.stock_message
}

function getStockContextClassName(
  stockContext: RadarAdvisorAlert["stock_context"] | null | undefined
) {
  if (!stockContext) {
    return "border-white/10 bg-white/[0.04] text-white/45"
  }

  if (stockContext.inventory_status === "out_of_stock") {
    return "border-red-300/25 bg-red-300/[0.08] text-red-100"
  }

  if (stockContext.inventory_source === "luna_numeric") {
    return "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100"
  }

  if (stockContext.inventory_status === "in_stock") {
    return "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
  }

  return "border-white/10 bg-white/[0.04] text-white/45"
}

function getProductEvaluationKey(
  product: MarketRadarProductRow
) {
  return [
    product.product_id,
    product.supplier_variant_id ||
      product.sku ||
      "default",
  ].join(":")
}

function getNullableString(
  value: string | null | undefined
) {
  const text =
    typeof value === "string"
      ? value.trim()
      : ""

  return text || null
}

function getRealProductSku(
  product: MarketRadarProductRow
) {
  const optionalProduct =
    product as MarketRadarProductRow & {
      supplier_sku?: string | null
    }

  return (
    getNullableString(
      product.sku
    ) ||
    getNullableString(
      optionalProduct.supplier_sku
    )
  )
}

function buildEbayPipelineRadarProduct(
  product: MarketRadarProductRow
) {
  const imageUrls =
    product.image_urls || []

  return {
    source_key:
      product.source_key,
    source_name:
      product.source_name,
    source_id:
      getNullableString(
        product.source_id
      ),
    product_id:
      getNullableString(
        product.product_id
      ),
    market_radar_product_id:
      getNullableString(
        product.product_id
      ),
    snapshot_id:
      getNullableString(
        product.snapshot_id
      ),
    market_radar_snapshot_id:
      getNullableString(
        product.snapshot_id
      ),
    supplier_product_id:
      product.supplier_product_id,
    supplier_variant_id:
      product.supplier_variant_id ||
      product.sku ||
      "default",
    sku:
      getRealProductSku(
        product
      ),
    title:
      product.title,
    product_url:
      product.product_url,
    vendor:
      product.vendor,
    product_type:
      product.product_type,
    tags:
      product.tags || [],
    price:
      product.price,
    compare_at_price:
      product.compare_at_price,
    available:
      product.available,
    inventory_quantity:
      product.inventory_quantity,
    collections:
      product.collections || [],
    featured_image_url:
      product.featured_image_url,
    image_urls:
      imageUrls,
    images_authorized:
      false,
    opportunity_score:
      product.opportunity_score,
    restock_count_7d:
      product.restock_count_7d,
    out_of_stock_count_7d:
      product.out_of_stock_count_7d,
    event_count_7d:
      product.event_count_7d,
    last_captured_at:
      product.last_captured_at,
  }
}

function getStableSupplierSku(
  product: MarketRadarProductRow
) {
  const optionalProduct =
    product as MarketRadarProductRow & {
      id?: string | null
      supplier_sku?: string | null
    }

  return (
    product.sku ||
    optionalProduct.supplier_sku ||
    product.supplier_variant_id ||
    product.handle ||
    product.supplier_product_id ||
    product.product_id ||
    optionalProduct.id ||
    ""
  )
}

function getProductPreviewImageUrl(
  product: MarketRadarProductRow
) {
  const optionalProduct =
    product as MarketRadarProductRow & {
      image_url?: string | null
      image?: string | null
      images?: string[] | null
    }

  return (
    getNullableString(
      product.featured_image_url
    ) ||
    getNullableString(
      optionalProduct.image_url
    ) ||
    getNullableString(
      optionalProduct.image
    ) ||
    getNullableString(
      optionalProduct.images?.[0]
    ) ||
    getNullableString(
      product.image_urls?.[0]
    )
  )
}

function createPriceIntelligenceForm(
  product: MarketRadarProductRow
): PriceIntelligenceFormState {
  return {
    source_type:
      "terapeak",
    price_capture_type:
      "sold",
    pasted_price_text:
      "",
    shipping_scope:
      "us_domestic",
    buyer_location_country:
      "",
    competitor_item_price:
      "",
    competitor_shipping_price:
      "",
    competitor_landed_price:
      "",
    competitor_domestic_shipping_price:
      "",
    competitor_domestic_landed_price:
      "",
    competitor_international_shipping_price:
      "",
    competitor_international_landed_price:
      "",
    search_query:
      product.title,
    product_match_type:
      "similar",
    sold_avg_price:
      "",
    sold_median_price:
      "",
    sold_min_price:
      "",
    sold_max_price:
      "",
    sold_comp_count:
      "",
    active_avg_price:
      "",
    active_min_price:
      "",
    active_max_price:
      "",
    active_comp_count:
      "",
    estimated_shipping_cost:
      "",
    recommended_sale_price:
      "",
    source_confidence:
      "medium",
    confidence_score:
      "",
    category_id:
      "",
    category_name:
      "",
    evidence_url:
      "",
    evidence_notes:
      "",
  }
}

function getNullableFormValue(
  value: string
) {
  const text =
    value.trim()

  return text || null
}

function getPriceFormNumber(
  value: string
) {
  const number =
    toNumber(value)

  return number !== null &&
    number >= 0
    ? number
    : null
}

function getDomesticLandedPriceFromForm(
  form: PriceIntelligenceFormState
) {
  const competitorItemPrice =
    getPriceFormNumber(
      form.competitor_item_price
    )

  const competitorShippingPrice =
    getPriceFormNumber(
      form.competitor_shipping_price
    )

  const domesticShippingPrice =
    getPriceFormNumber(
      form.competitor_domestic_shipping_price
    ) ??
    (
      form.shipping_scope === "us_domestic"
        ? competitorShippingPrice
        : null
    )

  return (
    form.shipping_scope === "us_domestic" ||
    getPriceFormNumber(
      form.competitor_domestic_shipping_price
    ) !== null
  ) &&
  (
    competitorItemPrice !== null ||
    domesticShippingPrice !== null
  )
    ? roundPriceValue(
        (competitorItemPrice || 0) +
        (domesticShippingPrice || 0)
      )
    : getPriceFormNumber(
        form.competitor_domestic_landed_price
      )
}

function getEffectiveRecommendedSalePrice(
  form: PriceIntelligenceFormState
) {
  return getPriceFormNumber(
    form.recommended_sale_price
  ) ??
    getDomesticLandedPriceFromForm(
      form
    )
}

function getRequiredPriceNumberError(
  value: string,
  label: string
) {
  if (!value.trim()) {
    return `${label} es obligatorio.`
  }

  return getPriceFormNumber(value) === null
    ? `${label} debe ser 0 o mayor.`
    : null
}

function getPriceIntelligenceFieldErrors(
  form: PriceIntelligenceFormState
) {
  const errors: Partial<
    Record<keyof PriceIntelligenceFormState, string>
  > = {}

  const competitorItemPriceError =
    getRequiredPriceNumberError(
      form.competitor_item_price,
      "Precio del competidor"
    )

  if (competitorItemPriceError) {
    errors.competitor_item_price =
      competitorItemPriceError
  }

  const competitorShippingError =
    getRequiredPriceNumberError(
      form.competitor_domestic_shipping_price,
      "Envio USA"
    )

  if (competitorShippingError) {
    errors.competitor_domestic_shipping_price =
      competitorShippingError
  }

  const recommendedSalePrice =
    getEffectiveRecommendedSalePrice(
      form
    )

  const recommendedSalePriceError =
    form.recommended_sale_price.trim() &&
    getPriceFormNumber(
      form.recommended_sale_price
    ) === null
      ? "Precio recomendado debe ser 0 o mayor."
      : recommendedSalePrice === null
        ? "Precio recomendado se calcula con precio del competidor + envio USA."
        : null

  if (recommendedSalePriceError) {
    errors.recommended_sale_price =
      recommendedSalePriceError
  }

  const confidenceScoreError =
    getRequiredPriceNumberError(
      form.confidence_score,
      "Puntaje de confianza"
    )

  if (confidenceScoreError) {
    errors.confidence_score =
      confidenceScoreError
  } else {
    const confidenceScore =
      getPriceFormNumber(
        form.confidence_score
      )

    if (
      confidenceScore !== null &&
      confidenceScore > 100
    ) {
      errors.confidence_score =
        "Puntaje de confianza debe estar entre 0 y 100."
    }
  }

  if (!form.evidence_notes.trim()) {
    errors.evidence_notes =
      "Notas de evidencia es obligatorio."
  }

  return errors
}

function getShippingStrategy(
  itemPrice: number | null,
  shippingPrice: number | null
) {
  if (shippingPrice === null) {
    return "unknown"
  }

  if (shippingPrice === 0) {
    return "free_shipping"
  }

  if (
    itemPrice !== null &&
    shippingPrice >= itemPrice * 0.75
  ) {
    return "high_shipping"
  }

  return "paid_shipping"
}

function buildPriceIntelligencePayload(
  product: MarketRadarProductRow,
  form: PriceIntelligenceFormState
) {
  const competitorItemPrice =
    getPriceFormNumber(
      form.competitor_item_price
    )

  const competitorShippingPrice =
    getPriceFormNumber(
      form.competitor_shipping_price
    )

  const domesticShippingPrice =
    getPriceFormNumber(
      form.competitor_domestic_shipping_price
    ) ??
    (
      form.shipping_scope === "us_domestic"
        ? competitorShippingPrice
        : null
    )

  const internationalShippingPrice =
    getPriceFormNumber(
      form.competitor_international_shipping_price
    ) ??
    (
      form.shipping_scope === "international"
        ? competitorShippingPrice
        : null
    )

  const domesticLandedPrice =
    getPriceFormNumber(
      form.competitor_domestic_landed_price
    ) ??
    (
      (
        form.shipping_scope === "us_domestic" ||
        getPriceFormNumber(
          form.competitor_domestic_shipping_price
        ) !== null
      ) &&
      (
        competitorItemPrice !== null ||
        domesticShippingPrice !== null
      )
        ? roundPriceValue(
            (competitorItemPrice || 0) +
            (domesticShippingPrice || 0)
          )
        : null
    )

  const internationalLandedPrice =
    getPriceFormNumber(
      form.competitor_international_landed_price
    ) ??
    (
      competitorItemPrice !== null ||
      internationalShippingPrice !== null
        ? roundPriceValue(
            (competitorItemPrice || 0) +
            (internationalShippingPrice || 0)
          )
        : null
    )

  const competitorLandedPrice =
    form.shipping_scope === "us_domestic"
      ? domesticLandedPrice
      : form.shipping_scope === "international"
        ? internationalLandedPrice
        : getPriceFormNumber(
            form.competitor_landed_price
          )

  const recommendedSalePrice =
    getEffectiveRecommendedSalePrice(
      form
    )

  return {
    market_radar_product_id:
      getNullableString(
        product.product_id
      ),
    supplier_sku:
      getStableSupplierSku(
        product
      ),
    source_type:
      normalizePriceSourceForPayload(
        form.source_type
      ),
    marketplace:
      "ebay",
    search_query:
      getNullableFormValue(
        form.search_query
      ),
    product_match_type:
      getNullableFormValue(
        form.product_match_type
      ),
    sold_avg_price:
      getNullableFormValue(
        form.sold_avg_price
      ),
    sold_median_price:
      getNullableFormValue(
        form.sold_median_price
      ),
    sold_min_price:
      getNullableFormValue(
        form.sold_min_price
      ),
    sold_max_price:
      getNullableFormValue(
        form.sold_max_price
      ),
    sold_comp_count:
      getNullableFormValue(
        form.sold_comp_count
      ),
    active_avg_price:
      getNullableFormValue(
        form.active_avg_price
      ),
    active_min_price:
      getNullableFormValue(
        form.active_min_price
      ),
    active_max_price:
      getNullableFormValue(
        form.active_max_price
      ),
    active_comp_count:
      getNullableFormValue(
        form.active_comp_count
      ),
    estimated_shipping_cost:
      getNullableFormValue(
        form.estimated_shipping_cost
      ),
    recommended_sale_price:
      recommendedSalePrice === null
        ? null
        : formatPriceFormValue(
            recommendedSalePrice
          ),
    source_confidence:
      getNullableFormValue(
        form.source_confidence
      ),
    confidence_score:
      getNullableFormValue(
        form.confidence_score
      ),
    category_id:
      getNullableFormValue(
        form.category_id
      ),
    category_name:
      getNullableFormValue(
        form.category_name
      ),
    evidence_url:
      getNullableFormValue(
        form.evidence_url
      ),
    evidence_notes:
      getNullableFormValue(
        form.evidence_notes
      ),
    shipping_scope:
      form.shipping_scope,
    buyer_location_country:
      getNullableFormValue(
        form.buyer_location_country
      ),
    competitor_item_price:
      getNullableFormValue(
        form.competitor_item_price
      ),
    competitor_shipping_price:
      getNullableFormValue(
        form.competitor_shipping_price
      ),
    competitor_landed_price:
      competitorLandedPrice === null
        ? null
        : formatPriceFormValue(
            competitorLandedPrice
          ),
    competitor_domestic_shipping_price:
      domesticShippingPrice === null
        ? null
        : formatPriceFormValue(
            domesticShippingPrice
          ),
    competitor_domestic_landed_price:
      domesticLandedPrice === null
        ? null
        : formatPriceFormValue(
            domesticLandedPrice
          ),
    competitor_international_shipping_price:
      internationalShippingPrice === null
        ? null
        : formatPriceFormValue(
            internationalShippingPrice
          ),
    competitor_international_landed_price:
      internationalLandedPrice === null
        ? null
        : formatPriceFormValue(
            internationalLandedPrice
          ),
    shipping_strategy:
      getShippingStrategy(
        competitorItemPrice,
        domesticShippingPrice
      ),
    landed_price_source:
      competitorItemPrice !== null ||
      domesticShippingPrice !== null ||
      domesticLandedPrice !== null ||
      internationalShippingPrice !== null ||
      internationalLandedPrice !== null
        ? "manual_observed"
        : null,
  }
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string | number
  detail: string
  icon: ElementType
}) {
  return (
    <div
      className="
        rounded-lg
        border
        border-white/10
        bg-black/25
        p-4
      "
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          {title}
        </p>
        <Icon className="h-4 w-4 text-cyan-100/55" />
      </div>
      <p className="mt-4 text-3xl font-black text-white">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-white/45">
        {detail}
      </p>
    </div>
  )
}

function EventBadge({
  type,
}: {
  type: string
}) {
  return (
    <span
      className={`
        inline-flex
        rounded-md
        border
        px-2
        py-1
        text-[10px]
        uppercase
        tracking-[0.14em]
        ${eventClassNames[type] || eventClassNames.new_product}
      `}
    >
      {eventLabels[type] || type}
    </span>
  )
}

function PriceInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  helpText,
  error,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  helpText?: string
  techName?: string
  error?: string
  required?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span
        className={`
          block
          break-words
          text-xs
          font-bold
          leading-5
          ${error ? "text-red-200" : "text-white/80"}
        `}
      >
        {label}
        {required ? (
          <span className="text-red-300"> *</span>
        ) : null}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={event =>
          onChange(event.target.value)
        }
        className={`
          mt-2
          w-full
          rounded-lg
          border
          ${error ? "border-red-400/60 bg-red-950/20" : "border-white/10 bg-black/35"}
          px-3
          py-2
          text-sm
          text-white
          outline-none
          transition
          placeholder:text-white/25
          ${error ? "focus:border-red-300" : "focus:border-cyan-300/30"}
        `}
      />
      {error ? (
        <span className="mt-2 block text-xs font-semibold leading-5 text-red-300">
          {error}
        </span>
      ) : null}
      {helpText ? (
        <span className="mt-2 block text-xs leading-5 text-white/40">
          {helpText}
        </span>
      ) : null}
    </label>
  )
}

function PriceSelect({
  label,
  value,
  options,
  onChange,
  optionLabels,
  helpText,
  error,
  required = false,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  optionLabels?: Record<string, string>
  helpText?: string
  techName?: string
  error?: string
  required?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span
        className={`
          block
          break-words
          text-xs
          font-bold
          leading-5
          ${error ? "text-red-200" : "text-white/80"}
        `}
      >
        {label}
        {required ? (
          <span className="text-red-300"> *</span>
        ) : null}
      </span>
      <select
        value={value}
        onChange={event =>
          onChange(event.target.value)
        }
        className={`
          mt-2
          w-full
          rounded-lg
          border
          ${error ? "border-red-400/60 bg-red-950/20" : "border-white/10 bg-black/35"}
          px-3
          py-2
          text-sm
          text-white
          outline-none
          transition
          ${error ? "focus:border-red-300" : "focus:border-cyan-300/30"}
        `}
      >
        {options.map(option => (
          <option
            key={option}
            value={option}
          >
            {optionLabels?.[option] || option}
          </option>
        ))}
      </select>
      {error ? (
        <span className="mt-2 block text-xs font-semibold leading-5 text-red-300">
          {error}
        </span>
      ) : null}
      {helpText ? (
        <span className="mt-2 block text-xs leading-5 text-white/40">
          {helpText}
        </span>
      ) : null}
    </label>
  )
}

function PriceFormGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section
      className="
        rounded-lg
        border
        border-white/10
        bg-white/[0.025]
        p-4
      "
    >
      <h4 className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
        {title}
      </h4>
      <div className="mt-4">
        {children}
      </div>
    </section>
  )
}

function PriceIntelligenceModal({
  product,
  form,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  product: MarketRadarProductRow
  form: PriceIntelligenceFormState
  isSaving: boolean
  onChange: (
    field: keyof PriceIntelligenceFormState,
    value: string
  ) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const [
    showAdvancedFields,
    setShowAdvancedFields,
  ] = useState(false)

  const [
    hasSubmitted,
    setHasSubmitted,
  ] = useState(false)

  const fieldErrors =
    hasSubmitted
      ? getPriceIntelligenceFieldErrors(
          form
        )
      : {}

  const missingFieldCount =
    Object.keys(fieldErrors).length

  const quickCaptureAnalysis =
    parsePriceIntelligenceText(
      form.pasted_price_text
    )

  const suggestedConfidence =
    quickCaptureAnalysis
      ? suggestPriceConfidence({
          count:
            quickCaptureAnalysis.count,
          productMatchType:
            form.product_match_type,
          captureType:
            form.price_capture_type,
          sourceType:
            form.source_type,
        })
      : null

  const recommendedQuickPrice =
    quickCaptureAnalysis
      ? form.price_capture_type === "sold"
        ? quickCaptureAnalysis.median
        : quickCaptureAnalysis.avg
      : null

  const competitorItemPrice =
    getPriceFormNumber(
      form.competitor_item_price
    )

  const competitorShippingPrice =
    getPriceFormNumber(
      form.competitor_shipping_price
    )

  const competitorDomesticShippingPrice =
    getPriceFormNumber(
      form.competitor_domestic_shipping_price
    ) ??
    (
      form.shipping_scope === "us_domestic"
        ? competitorShippingPrice
        : null
    )

  const competitorInternationalShippingPrice =
    getPriceFormNumber(
      form.competitor_international_shipping_price
    ) ??
    (
      form.shipping_scope === "international"
        ? competitorShippingPrice
        : null
    )

  const competitorDomesticLandedPrice =
    (
      form.shipping_scope === "us_domestic" ||
      getPriceFormNumber(
        form.competitor_domestic_shipping_price
      ) !== null
    ) &&
    (
      competitorItemPrice !== null ||
      competitorDomesticShippingPrice !== null
    )
      ? roundPriceValue(
          (competitorItemPrice || 0) +
          (competitorDomesticShippingPrice || 0)
        )
      : getPriceFormNumber(
          form.competitor_domestic_landed_price
        )

  const competitorInternationalLandedPrice =
    competitorItemPrice !== null ||
    competitorInternationalShippingPrice !== null
      ? roundPriceValue(
          (competitorItemPrice || 0) +
          (competitorInternationalShippingPrice || 0)
        )
      : getPriceFormNumber(
          form.competitor_international_landed_price
        )

  const competitorLandedPrice =
    form.shipping_scope === "us_domestic"
      ? competitorDomesticLandedPrice
      : form.shipping_scope === "international"
        ? competitorInternationalLandedPrice
        : getPriceFormNumber(
            form.competitor_landed_price
          )

  const effectiveRecommendedSalePrice =
    getEffectiveRecommendedSalePrice(
      form
    )

  const isRecommendedSalePriceAuto =
    !form.recommended_sale_price.trim() &&
    effectiveRecommendedSalePrice !== null

  const competitorShippingStrategy =
    competitorDomesticShippingPrice === null
      ? "unknown"
      : competitorDomesticShippingPrice === 0
        ? "free_shipping"
        : competitorItemPrice !== null &&
          competitorDomesticShippingPrice >= competitorItemPrice * 0.75
          ? "high_shipping"
          : "paid_shipping"

  const ebaySearchQuery =
    [
      product.title,
      getStableSupplierSku(product),
    ]
      .filter(Boolean)
      .join(" ")

  const ebaySearchUrl =
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebaySearchQuery)}`

  const productPreviewImageUrl =
    getProductPreviewImageUrl(
      product
    )

  function openEbaySearch() {
    window.open(
      ebaySearchUrl,
      "_blank",
      "noopener,noreferrer"
    )
  }

  async function copyEbaySearch() {
    await navigator.clipboard.writeText(
      ebaySearchQuery
    )
  }

  function applyQuickPriceCapture() {
    if (!quickCaptureAnalysis) {
      return
    }

    const captureType =
      form.price_capture_type

    if (captureType === "sold") {
      onChange(
        "sold_min_price",
        formatPriceFormValue(quickCaptureAnalysis.min)
      )
      onChange(
        "sold_max_price",
        formatPriceFormValue(quickCaptureAnalysis.max)
      )
      onChange(
        "sold_avg_price",
        formatPriceFormValue(quickCaptureAnalysis.avg)
      )
      onChange(
        "sold_median_price",
        formatPriceFormValue(quickCaptureAnalysis.median)
      )
      onChange(
        "sold_comp_count",
        String(quickCaptureAnalysis.count)
      )
      onChange(
        "recommended_sale_price",
        formatPriceFormValue(quickCaptureAnalysis.median)
      )
    } else {
      onChange(
        "active_min_price",
        formatPriceFormValue(quickCaptureAnalysis.min)
      )
      onChange(
        "active_max_price",
        formatPriceFormValue(quickCaptureAnalysis.max)
      )
      onChange(
        "active_avg_price",
        formatPriceFormValue(quickCaptureAnalysis.avg)
      )
      onChange(
        "active_comp_count",
        String(quickCaptureAnalysis.count)
      )
      onChange(
        "recommended_sale_price",
        formatPriceFormValue(quickCaptureAnalysis.avg)
      )
    }

    if (suggestedConfidence) {
      onChange(
        "source_confidence",
        suggestedConfidence.source_confidence
      )
      onChange(
        "confidence_score",
        String(suggestedConfidence.confidence_score)
      )
    }
  }

  function applyLandedPriceCapture() {
    if (
      form.shipping_scope !== "us_domestic" ||
      competitorDomesticLandedPrice === null
    ) {
      return
    }

    const landedPrice =
      formatPriceFormValue(
        competitorDomesticLandedPrice
      )

    onChange(
      "competitor_domestic_landed_price",
      landedPrice
    )
    onChange(
      "recommended_sale_price",
      landedPrice
    )

    if (form.price_capture_type === "sold") {
      onChange(
        "sold_median_price",
        landedPrice
      )
      onChange(
        "sold_avg_price",
        landedPrice
      )
      onChange(
        "sold_comp_count",
        form.sold_comp_count || "1"
      )
    } else {
      onChange(
        "active_avg_price",
        landedPrice
      )
      onChange(
        "active_comp_count",
        form.active_comp_count || "1"
      )
    }
  }

  function handleSubmit() {
    setHasSubmitted(true)

    const errors =
      getPriceIntelligenceFieldErrors(
        form
      )

    if (Object.keys(errors).length > 0) {
      return
    }

    onSubmit()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/80 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Cerrar Price Intelligence"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        className="
          relative
          z-10
          flex
          max-h-[90vh]
          w-full
          max-w-[960px]
          flex-col
          overflow-hidden
          rounded-lg
          border
          border-white/10
          bg-zinc-950
          shadow-2xl
        "
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-zinc-950 px-5 py-5 md:px-6">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.26em] text-cyan-100/55">
              Price Intelligence
            </p>
            <h3 className="mt-3 text-xl font-black text-white md:text-2xl">
              Analizar precio de mercado
            </h3>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-white/55">
              {product.title}
            </p>
            <p className="mt-1 break-all text-xs text-white/35">
              SKU: {getStableSupplierSku(product)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="
              rounded-lg
              border
              border-white/10
              bg-white/[0.04]
              p-2
              shrink-0
              text-white/60
              transition
              hover:border-cyan-300/25
              hover:text-cyan-100
            "
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-5 py-5 md:px-6">
          <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h4 className="text-base font-black text-white">
                  Paso 1: busca un comparable en eBay
                </h4>
                <p className="mt-2 text-sm leading-6 text-cyan-50/70">
                  Usa ventas reales si puedes. Despues llena los datos minimos marcados con *.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openEbaySearch}
                className="
                  rounded-lg
                  border
                  border-cyan-300/30
                  bg-cyan-300
                  px-4
                  py-3
                  text-sm
                  font-black
                  text-black
                  transition
                  hover:bg-cyan-200
                "
              >
                Abrir busqueda en eBay
              </button>
              <button
                type="button"
                onClick={copyEbaySearch}
                className="
                  rounded-lg
                  border
                  border-white/10
                  bg-white/[0.04]
                  px-4
                  py-3
                  text-sm
                  font-semibold
                  text-white/70
                  transition
                  hover:border-cyan-300/25
                  hover:text-white
                "
              >
                Copiar busqueda
              </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="flex h-44 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/35 md:h-40 md:w-40">
                {productPreviewImageUrl ? (
                  <img
                    src={productPreviewImageUrl}
                    alt={product.title}
                    className="h-full w-full object-contain p-2"
                  />
                ) : (
                  <span className="px-4 text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
                    Sin imagen disponible
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                  Producto de referencia
                </p>
                <h4 className="mt-2 break-words text-base font-black leading-6 text-white">
                  {product.title}
                </h4>
                <div className="mt-3 grid gap-2 text-xs text-white/45 sm:grid-cols-2">
                  <p className="break-all">
                    SKU: <span className="text-white/70">{getStableSupplierSku(product) || "-"}</span>
                  </p>
                  <p>
                    Costo Luna: <span className="text-white/70">{formatCurrency(product.price)}</span>
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Usa esta imagen para confirmar que los precios comparables corresponden al mismo producto o a uno realmente equivalente.
                </p>
                {product.product_url ? (
                  <a
                    href={product.product_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-cyan-100 transition hover:text-cyan-50"
                  >
                    Abrir producto fuente
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <PriceFormGroup title="Datos minimos para analizar">
            <p className="mb-4 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-sm leading-6 text-cyan-50/75">
              Llena precio del competidor, envio USA, confianza y notas. El precio recomendado se calcula solo con precio + envio, y puedes editarlo si quieres.
            </p>
            {missingFieldCount > 0 ? (
              <p className="mb-4 rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm font-semibold leading-6 text-red-200">
                Faltan {missingFieldCount} dato{missingFieldCount === 1 ? "" : "s"} obligatorio{missingFieldCount === 1 ? "" : "s"} antes de guardar.
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <PriceSelect
                label="Fuente del precio"
                techName="source_type"
                value={form.source_type}
                options={priceSourceOptions}
                optionLabels={priceSourceLabels}
                helpText="Usa Terapeak/eBay Research si tienes ventas reales."
                onChange={value =>
                  onChange(
                    "source_type",
                    value
                  )
                }
              />
              <PriceSelect
                label="Tipo de precios pegados"
                techName="price_capture_type"
                value={form.price_capture_type}
                options={priceCaptureTypeOptions}
                optionLabels={priceCaptureTypeLabels}
                helpText="Vendidos es mejor que listados activos."
                onChange={value =>
                  onChange(
                    "price_capture_type",
                    value
                  )
                }
              />
              <PriceSelect
                label="Que tan parecido es"
                techName="product_match_type"
                value={form.product_match_type}
                options={productMatchOptions}
                optionLabels={productMatchLabels}
                helpText="Mientras mas parecido sea, mas confiable es el dato."
                onChange={value =>
                  onChange(
                    "product_match_type",
                    value
                  )
                }
              />
              <PriceSelect
                label="Este envio observado es dentro de EE. UU. o internacional?"
                techName="shipping_scope"
                value={form.shipping_scope}
                options={shippingScopeOptions}
                optionLabels={shippingScopeLabels}
                helpText="Para eBay usa mercado USA domestico."
                onChange={value =>
                  onChange(
                    "shipping_scope",
                    value as PriceIntelligenceFormState["shipping_scope"]
                  )
                }
              />
              <PriceInput
                label="Shipping estimado"
                techName="estimated_shipping_cost"
                type="number"
                placeholder="6.99"
                value={form.estimated_shipping_cost}
                helpText="Costo interno estimado de IMNOVA, si lo sabes."
                onChange={value =>
                  onChange(
                    "estimated_shipping_cost",
                    value
                  )
                }
              />
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-black text-white">
                    Mercado USA
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    Compara por defecto contra el total que paga un comprador dentro de EE. UU. Si el vendedor ofrece free shipping domestico, el envio USA es $0.00.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={applyLandedPriceCapture}
                  disabled={
                    form.shipping_scope !== "us_domestic" ||
                    competitorDomesticLandedPrice === null
                  }
                  className="
                    inline-flex
                    items-center
                    justify-center
                    rounded-lg
                    border
                    border-cyan-300/30
                    bg-cyan-300
                    px-4
                    py-2
                    text-xs
                    font-black
                    text-black
                    transition
                    hover:bg-cyan-200
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                >
                  Usar total USA
                </button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <PriceInput
                  label="Precio del competidor"
                  techName="competitor_item_price"
                  type="number"
                  placeholder="28.99"
                  value={form.competitor_item_price}
                  required
                  error={fieldErrors.competitor_item_price}
                  helpText="Precio visible del articulo, sin envio."
                  onChange={value =>
                    onChange(
                      "competitor_item_price",
                      value
                    )
                  }
                />
                <PriceInput
                  label="Envio USA"
                  techName="competitor_domestic_shipping_price"
                  type="number"
                  placeholder="0.00"
                  value={form.competitor_domestic_shipping_price}
                  required
                  error={fieldErrors.competitor_domestic_shipping_price}
                  helpText="Pon 0 si el competidor ofrece free shipping."
                  onChange={value =>
                    onChange(
                      "competitor_domestic_shipping_price",
                      value
                    )
                  }
                />
                <PriceInput
                  label="Total comprador USA"
                  techName="competitor_domestic_landed_price"
                  type="number"
                  placeholder="28.99"
                  value={form.competitor_domestic_landed_price}
                  helpText="Se calcula con precio + envio. Puedes escribirlo manualmente si hace falta."
                  onChange={value =>
                    onChange(
                      "competitor_domestic_landed_price",
                      value
                    )
                  }
                />
              </div>

              {competitorDomesticLandedPrice !== null ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-white/60">
                  Total comprador USA: <strong className="text-white">{formatCurrency(competitorDomesticLandedPrice)}</strong>
                  {" "} Estrategia shipping: <strong className="text-white">{competitorShippingStrategy}</strong>.
                  {competitorShippingStrategy === "high_shipping"
                    ? " Competidor usa envio domestico alto; valida ventas reales antes de copiar esa estrategia."
                    : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-4">
              <p className="text-sm font-black text-white">
                Observacion internacional
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/65">
                No usar como referencia principal si vendes dentro de EE. UU.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <PriceInput
                  label="Envio internacional observado"
                  techName="competitor_international_shipping_price"
                  type="number"
                  placeholder="34.86"
                  value={form.competitor_international_shipping_price}
                  helpText="Shipping internacional cobrado al comprador observado; no es costo interno de IMNOVA."
                  onChange={value =>
                    onChange(
                      "competitor_international_shipping_price",
                      value
                    )
                  }
                />
                <PriceInput
                  label="Total internacional observado"
                  techName="competitor_international_landed_price"
                  type="number"
                  placeholder="63.85"
                  value={form.competitor_international_landed_price}
                  helpText="Solo se usa si cambias explicitamente el analisis a mercado internacional."
                  onChange={value =>
                    onChange(
                      "competitor_international_landed_price",
                      value
                    )
                  }
                />
                <PriceInput
                  label="Pais comprador"
                  techName="buyer_location_country"
                  placeholder="US"
                  value={form.buyer_location_country}
                  helpText="Pais desde donde se observo el shipping, si lo sabes."
                  onChange={value =>
                    onChange(
                      "buyer_location_country",
                      value
                    )
                  }
                />
              </div>
              {form.shipping_scope === "international" ? (
                <div className="mt-4 rounded-lg border border-amber-200/20 bg-black/20 p-3 text-xs leading-5 text-amber-50/75">
                  Este precio incluye envio internacional. Para competir dentro de EE. UU., valida el precio domestico/free shipping. No se copiara automaticamente a recommended_sale_price.
                </div>
              ) : null}
              {competitorInternationalLandedPrice !== null ? (
                <div className="mt-4 text-xs leading-5 text-amber-50/65">
                  Total internacional observado: <strong className="text-white">{formatCurrency(competitorInternationalLandedPrice)}</strong>
                </div>
              ) : null}
            </div>

            <label className="mt-4 block min-w-0">
              <span className="block break-words text-xs font-bold leading-5 text-white/80">
                Pegar precios
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-white/30">
                pasted_price_text
              </span>
              <textarea
                value={form.pasted_price_text}
                onChange={event =>
                  onChange(
                    "pasted_price_text",
                    event.target.value
                  )
                }
                rows={4}
                placeholder="Pega precios vendidos o datos de Terapeak/eBay Research. Ejemplo: $24.99, $29.99, $31.50, $34.99"
                className={`
                  mt-2
                  w-full
                  rounded-lg
                  border
                  border-white/10
                  bg-black/35
                  px-3
                  py-2
                  text-sm
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/25
                  focus:border-cyan-300/30
                `}
              />
              <span className="mt-2 block text-xs leading-5 text-white/40">
                Este texto solo se usa en el navegador para calcular los campos. No se envia ni se guarda completo.
              </span>
            </label>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={applyQuickPriceCapture}
                disabled={!quickCaptureAnalysis}
                className="
                  inline-flex
                  items-center
                  justify-center
                  rounded-lg
                  border
                  border-cyan-300/30
                  bg-cyan-300
                  px-4
                  py-3
                  text-sm
                  font-black
                  text-black
                  transition
                  hover:bg-cyan-200
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              >
                Analizar precios
              </button>
              {!quickCaptureAnalysis &&
              form.pasted_price_text.trim() ? (
                <p className="text-xs leading-5 text-amber-100/75">
                  No se detectaron precios validos. Evita negativos, notacion cientifica, hex, NaN o Infinity.
                </p>
              ) : null}
            </div>

            {quickCaptureAnalysis ? (
              <div className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-black/25 p-4 text-xs text-white/55 md:grid-cols-3">
                <span>
                  Precios detectados: <strong className="text-white">{quickCaptureAnalysis.count}</strong>
                </span>
                <span>
                  Minimo: <strong className="text-white">{formatCurrency(quickCaptureAnalysis.min)}</strong>
                </span>
                <span>
                  Maximo: <strong className="text-white">{formatCurrency(quickCaptureAnalysis.max)}</strong>
                </span>
                <span>
                  Promedio: <strong className="text-white">{formatCurrency(quickCaptureAnalysis.avg)}</strong>
                </span>
                <span>
                  Mediana: <strong className="text-white">{formatCurrency(quickCaptureAnalysis.median)}</strong>
                </span>
                <span>
                  Precio recomendado: <strong className="text-white">{formatCurrency(recommendedQuickPrice)}</strong>
                </span>
                <span className="md:col-span-3">
                  Confianza sugerida: <strong className="text-white">{suggestedConfidence?.source_confidence || "-"}</strong>
                  {" "}({suggestedConfidence?.confidence_score || 0}/100)
                </span>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <PriceInput
                label="Precio vendido mediano"
                techName="sold_median_price"
                type="number"
                value={form.sold_median_price}
                helpText="Campo humano editable despues del analisis."
                onChange={value =>
                  onChange(
                    "sold_median_price",
                    value
                  )
                }
              />
              <PriceInput
                label="Precio vendido promedio"
                techName="sold_avg_price"
                type="number"
                value={form.sold_avg_price}
                helpText="Campo humano editable despues del analisis."
                onChange={value =>
                  onChange(
                    "sold_avg_price",
                    value
                  )
                }
              />
              <PriceInput
                label="Precio activo promedio"
                techName="active_avg_price"
                type="number"
                value={form.active_avg_price}
                helpText="Campo humano editable despues del analisis."
                onChange={value =>
                  onChange(
                    "active_avg_price",
                    value
                  )
                }
              />
              <PriceInput
                label="Precio recomendado override"
                techName="recommended_sale_price"
                type="number"
                placeholder={
                  effectiveRecommendedSalePrice === null
                    ? "Se calcula automatico"
                    : formatPriceFormValue(
                        effectiveRecommendedSalePrice
                      )
                }
                value={form.recommended_sale_price}
                error={fieldErrors.recommended_sale_price}
                helpText={
                  isRecommendedSalePriceAuto
                    ? `Automatico: ${formatCurrency(effectiveRecommendedSalePrice)}. Escribe aqui solo si quieres cambiarlo.`
                    : "Override manual. Si lo borras, vuelve a calcularse con precio del competidor + envio USA."
                }
                onChange={value =>
                  onChange(
                    "recommended_sale_price",
                    value
                  )
                }
              />
              <PriceSelect
                label="Confianza del dato"
                techName="source_confidence"
                value={form.source_confidence}
                options={sourceConfidenceOptions}
                optionLabels={sourceConfidenceLabels}
                helpText="Terapeak con ventas reales, STR alto y mismo producto/modelo debe ser alta. Activos o Aiprice suelen ser media/baja."
                onChange={value =>
                  onChange(
                    "source_confidence",
                    value
                  )
                }
              />
              <PriceInput
                label="Puntaje de confianza"
                techName="confidence_score"
                type="number"
                placeholder="0 a 100"
                value={form.confidence_score}
                required
                error={fieldErrors.confidence_score}
                helpText="0 a 100. Ventas reales pesan mas que listados activos."
                onChange={value =>
                  onChange(
                    "confidence_score",
                    value
                  )
                }
              />
            </div>

            <label className="mt-4 block min-w-0">
              <span
                className={`
                  block
                  break-words
                  text-xs
                  font-bold
                  leading-5
                  ${fieldErrors.evidence_notes ? "text-red-200" : "text-white/80"}
                `}
              >
                Notas de evidencia
                <span className="text-red-300"> *</span>
              </span>
              <textarea
                value={form.evidence_notes}
                onChange={event =>
                  onChange(
                    "evidence_notes",
                    event.target.value
                  )
                }
                rows={4}
                placeholder="Ejemplo: Revisado en Terapeak/eBay Research. Mismo part number. 8 vendidos similares, STR alto."
                className={`
                  mt-2
                  w-full
                  rounded-lg
                  border
                  ${fieldErrors.evidence_notes ? "border-red-400/60 bg-red-950/20" : "border-white/10 bg-black/35"}
                  px-3
                  py-2
                  text-sm
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/25
                  ${fieldErrors.evidence_notes ? "focus:border-red-300" : "focus:border-cyan-300/30"}
                `}
              />
              {fieldErrors.evidence_notes ? (
                <span className="mt-2 block text-xs font-semibold leading-5 text-red-300">
                  {fieldErrors.evidence_notes}
                </span>
              ) : null}
              <span className="mt-2 block text-xs leading-5 text-white/40">
                Que viste, que comparaste, si era el mismo modelo o parecido.
              </span>
            </label>
          </PriceFormGroup>

          <section className="rounded-lg border border-white/10 bg-white/[0.025]">
            <button
              type="button"
              onClick={() =>
                setShowAdvancedFields(current => !current)
              }
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            >
              <span className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
                Captura manual avanzada
              </span>
              <span className="text-xs font-bold text-cyan-100/70">
                {showAdvancedFields ? "Ocultar" : "Mostrar"}
              </span>
            </button>

            {showAdvancedFields ? (
              <div className="border-t border-white/10 p-4">
            <div className="grid gap-4 md:grid-cols-2">
          <PriceInput
            label="Precio vendido promedio"
            techName="sold_avg_price"
            type="number"
            value={form.sold_avg_price}
            onChange={value =>
              onChange(
                "sold_avg_price",
                value
              )
            }
          />
          <PriceInput
            label="Precio minimo vendido"
            techName="sold_min_price"
            type="number"
            value={form.sold_min_price}
            onChange={value =>
              onChange(
                "sold_min_price",
                value
              )
            }
          />
          <PriceInput
            label="Precio maximo vendido"
            techName="sold_max_price"
            type="number"
            value={form.sold_max_price}
            onChange={value =>
              onChange(
                "sold_max_price",
                value
              )
            }
          />
          <PriceInput
            label="Cantidad de vendidos comparables"
            techName="sold_comp_count"
            type="number"
            value={form.sold_comp_count}
            onChange={value =>
              onChange(
                "sold_comp_count",
                value
              )
            }
          />
          <PriceInput
            label="Precio activo minimo"
            techName="active_min_price"
            type="number"
            value={form.active_min_price}
            onChange={value =>
              onChange(
                "active_min_price",
                value
              )
            }
          />
          <PriceInput
            label="Precio activo maximo"
            techName="active_max_price"
            type="number"
            value={form.active_max_price}
            onChange={value =>
              onChange(
                "active_max_price",
                value
              )
            }
          />
          <PriceInput
            label="Cantidad de activos comparables"
            techName="active_comp_count"
            type="number"
            value={form.active_comp_count}
            onChange={value =>
              onChange(
                "active_comp_count",
                value
              )
            }
          />
          <PriceInput
            label="Busqueda usada"
            techName="search_query"
            value={form.search_query}
            onChange={value =>
              onChange(
                "search_query",
                value
              )
            }
          />
          <PriceInput
            label="Link de evidencia"
            techName="evidence_url"
            value={form.evidence_url}
            onChange={value =>
              onChange(
                "evidence_url",
                value
              )
            }
          />
          <PriceInput
            label="ID categoria"
            techName="category_id"
            value={form.category_id}
            onChange={value =>
              onChange(
                "category_id",
                value
              )
            }
          />
          <PriceInput
            label="Nombre categoria"
            techName="category_name"
            value={form.category_name}
            onChange={value =>
              onChange(
                "category_name",
                value
              )
            }
          />
        </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-white/10 bg-zinc-950 px-5 py-4 sm:flex-row sm:justify-end md:px-6">
          <button
            type="button"
            onClick={onClose}
            className="
              rounded-lg
              border
              border-white/10
              bg-white/[0.04]
              px-4
              py-3
              text-sm
              font-semibold
              sm:min-w-32
              text-white/70
              transition
              hover:border-white/20
              hover:text-white
            "
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="
              inline-flex
              items-center
              gap-2
              rounded-lg
              border
              border-cyan-300/30
              bg-cyan-300
              px-4
              py-3
              text-sm
              font-black
              sm:min-w-56
              text-black
              transition
              hover:bg-cyan-200
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            <DollarSign
              className={`
                h-4
                w-4
                ${isSaving ? "animate-pulse" : ""}
              `}
            />
            {isSaving ? "Guardando" : "Guardar Price Intelligence"}
          </button>
        </div>
      </section>
    </div>
  )
}

function PriceIntelligenceModalPortal({
  product,
  form,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  product: MarketRadarProductRow
  form: PriceIntelligenceFormState
  isSaving: boolean
  onChange: (
    field: keyof PriceIntelligenceFormState,
    value: string
  ) => void
  onClose: () => void
  onSubmit: () => void
}) {
  if (typeof document === "undefined") {
    return null
  }

  return createPortal(
    <PriceIntelligenceModal
      product={product}
      form={form}
      isSaving={isSaving}
      onChange={onChange}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
    document.body
  )
}

function ProductRow({
  product,
  evaluation,
  priceIntelligence,
  isEvaluating,
  onOpenPriceIntelligence,
  onEvaluate,
}: {
  product: MarketRadarProductRow
  evaluation?: EbayPipelineEvaluationState
  priceIntelligence?: PriceIntelligenceSaveState
  isEvaluating?: boolean
  onOpenPriceIntelligence: (
    product: MarketRadarProductRow
  ) => void
  onEvaluate: (
    product: MarketRadarProductRow
  ) => void
}) {
  const score =
    formatNumber(
      product.opportunity_score
    )

  const collections =
    product.collections || []

  return (
    <tr className="border-b border-white/5 align-top">
      <td className="w-[42%] px-4 py-4">
        <div className="flex gap-3">
          <div
            className="
              h-14
              w-14
              shrink-0
              overflow-hidden
              rounded-md
              border
              border-white/10
              bg-white/[0.04]
            "
          >
            {product.featured_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.featured_image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <p className="line-clamp-2 text-sm font-semibold leading-5 text-white">
                {product.title}
              </p>
              {product.product_url && (
                <a
                  href={product.product_url}
                  target="_blank"
                  rel="noreferrer"
                  className="
                    mt-0.5
                    shrink-0
                    rounded-md
                    border
                    border-white/10
                    p-1
                    text-white/45
                    transition
                    hover:border-cyan-300/30
                    hover:text-cyan-100
                  "
                  aria-label="Abrir producto"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/35">
              {product.sku || product.handle}
            </p>

            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onOpenPriceIntelligence(product)
                  }
                  className="
                    inline-flex
                    items-center
                    gap-2
                    rounded-lg
                    border
                    border-emerald-300/20
                    bg-emerald-300/[0.08]
                    px-3
                    py-2
                    text-xs
                    font-bold
                    text-emerald-50
                    transition
                    hover:bg-emerald-300/[0.13]
                  "
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  Agregar precio de mercado
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onEvaluate(product)
                  }
                  disabled={isEvaluating}
                  className="
                    inline-flex
                    items-center
                    gap-2
                    rounded-lg
                    border
                    border-cyan-300/20
                    bg-cyan-300/[0.08]
                    px-3
                    py-2
                    text-xs
                    font-bold
                    text-cyan-50
                    transition
                    hover:bg-cyan-300/[0.13]
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                >
                  <FileSearch
                    className={`
                      h-3.5
                      w-3.5
                      ${isEvaluating ? "animate-pulse" : ""}
                    `}
                  />
                  {isEvaluating
                    ? "Evaluando"
                    : "Evaluar en eBay Pipeline (dryRun)"}
                </button>
              </div>

              {priceIntelligence && (
                <div
                  className={`
                    mt-3
                    rounded-lg
                    border
                    p-3
                    text-xs
                    leading-5
                    ${
                      priceIntelligence.status === "success"
                        ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-50/80"
                        : "border-red-300/20 bg-red-300/[0.08] text-red-100"
                    }
                  `}
                >
                  <p>{priceIntelligence.message}</p>
                  {priceIntelligence.recommendedSalePrice && (
                    <p className="mt-1 text-white/45">
                      Recommended: {formatCurrency(
                        priceIntelligence.recommendedSalePrice
                      )}
                    </p>
                  )}
                </div>
              )}

              {evaluation && (
                <div
                  className={`
                    mt-3
                    rounded-lg
                    border
                    p-3
                    text-xs
                    leading-5
                    ${
                      evaluation.status === "success"
                        ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-50/80"
                        : "border-red-300/20 bg-red-300/[0.08] text-red-100"
                    }
                  `}
                >
                  <p>{evaluation.message}</p>
                  {evaluation.candidateState && (
                    <p className="mt-1 text-white/45">
                      Estado: {evaluation.candidateState}
                    </p>
                  )}
                  {evaluation.candidateKey && (
                    <p className="mt-1 break-all text-white/35">
                      {evaluation.candidateKey}
                    </p>
                  )}
                  {evaluation.status === "success" && (
                    <p className="mt-2 font-semibold text-cyan-100">
                      Ver en eBay Pipeline
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="text-sm font-bold text-white">
          {formatCurrency(product.price)}
        </p>
        {toNumber(product.compare_at_price) ? (
          <p className="mt-1 text-xs text-white/35 line-through">
            {formatCurrency(
              product.compare_at_price
            )}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-4">
        <span
          className={`
            rounded-md
            border
            px-2
            py-1
            text-[10px]
            uppercase
            tracking-[0.14em]
            ${getProductStatusClassName(product)}
          `}
        >
          {getProductStatusLabel(product)}
        </span>
        <p className="mt-2 text-xs font-semibold text-white/70">
          {formatInventoryQuantity(product.inventory_quantity)}
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          {product.inventory_source === "luna_numeric"
            ? "Cantidad disponible proveedor"
            : product.inventory_source === "luna_availability"
              ? "Luna confirma disponibilidad sin unidades"
              : "Cantidad no expuesta por Luna"}
        </p>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          {collections.slice(0, 3).map(collection => (
            <span
              key={collection}
              className="
                rounded-md
                border
                border-cyan-300/15
                bg-cyan-300/[0.07]
                px-2
                py-1
                text-[10px]
                uppercase
                tracking-[0.12em]
                text-cyan-50/70
              "
            >
              {collectionLabels[collection] || collection}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <p
          className={`
            text-lg
            font-black
            ${getScoreClassName(product.opportunity_score)}
          `}
        >
          {score}
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          {product.event_count_7d || 0} eventos 7d
        </p>
      </td>
      <td className="px-4 py-4 text-xs leading-5 text-white/45">
        {formatDate(
          product.last_event_at ||
          product.last_captured_at
        )}
      </td>
    </tr>
  )
}

function RecentEventItem({
  event,
}: {
  event: MarketRadarEventRow
}) {
  return (
    <div
      className="
        rounded-lg
        border
        border-white/10
        bg-white/[0.03]
        p-4
      "
    >
      <div className="flex items-start justify-between gap-3">
        <EventBadge type={event.event_type} />
        <span className="text-[11px] text-white/35">
          {formatDate(event.created_at)}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-white">
        {event.product?.title || "Producto sin titulo"}
      </p>
      <p className="mt-2 text-xs text-white/45">
        {getEventValue(event)}
      </p>
    </div>
  )
}

function RadarAdvisorAlertItem({
  alert,
}: {
  alert: RadarAdvisorAlert
}) {
  const stockMessage =
    getStockContextMessage(
      alert.stock_context
    )

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className={`
            rounded-md
            border
            px-2
            py-1
            text-[10px]
            font-bold
            uppercase
            tracking-[0.14em]
            ${getAdvisorSeverityClassName(alert.severity)}
          `}
        >
          {alert.severity}
        </span>
        <span className="text-[11px] text-white/35">
          {formatDate(alert.created_at)}
        </span>
      </div>

      <p className="mt-3 break-words text-sm font-black leading-5 text-white">
        {alert.product_title}
      </p>
      <p className="mt-2 break-words text-sm leading-6 text-white/70">
        {alert.advisor_message}
      </p>

      {stockMessage && (
        <div
          className={`
            mt-3
            rounded-md
            border
            px-3
            py-2
            text-xs
            font-semibold
            leading-5
            ${getStockContextClassName(alert.stock_context)}
          `}
        >
          {stockMessage}
        </div>
      )}

      <div className="mt-4 space-y-4 text-xs leading-5 text-white/45">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">
            Recomendacion
          </p>
          <p className="mt-1 break-words text-white/70">
            {alert.recommended_action}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">
            Proximo paso
          </p>
          <p className="mt-1 break-words text-white/70">
            {alert.proposed_next_step}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.08em]">
        {alert.candidate_state && (
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-white/45">
            {alert.candidate_state}
          </span>
        )}
        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-white/45">
          {alert.required_human_approval
            ? "Requiere aprobacion humana"
            : "Solo recomendacion"}
        </span>
        {alert.automation_available && (
          <span className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.08] px-2 py-1 text-cyan-100/75">
            Automation L{alert.automation_level}
          </span>
        )}
      </div>
    </div>
  )
}

export function MarketRadarPanel() {
  const [
    isMounted,
    setIsMounted,
  ] = useState(false)

  const [
    dashboard,
    setDashboard,
  ] = useState<MarketRadarDashboard | null>(null)

  const [
    isLoading,
    setIsLoading,
  ] = useState(true)

  const [
    isSyncing,
    setIsSyncing,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState("")

  const [
    syncResult,
    setSyncResult,
  ] = useState<MarketRadarSyncResult | null>(null)

  const [
    evaluatingProductKey,
    setEvaluatingProductKey,
  ] = useState("")

  const [
    ebayPipelineEvaluations,
    setEbayPipelineEvaluations,
  ] = useState<Record<string, EbayPipelineEvaluationState>>({})

  const [
    priceIntelligenceProduct,
    setPriceIntelligenceProduct,
  ] = useState<MarketRadarProductRow | null>(null)

  const [
    priceIntelligenceForm,
    setPriceIntelligenceForm,
  ] = useState<PriceIntelligenceFormState | null>(null)

  const [
    isSavingPriceIntelligence,
    setIsSavingPriceIntelligence,
  ] = useState(false)

  const [
    priceIntelligenceResults,
    setPriceIntelligenceResults,
  ] = useState<Record<string, PriceIntelligenceSaveState>>({})

  const [
    stockFilter,
    setStockFilter,
  ] = useState<"all" | "confirmed" | "missing">("confirmed")

  const getAccessToken =
    useCallback(async () => {
      const {
        data,
        error:
          sessionError,
      } =
        await supabase.auth.getSession()

      if (
        sessionError ||
        !data.session?.access_token
      ) {
        throw new Error(
          "No hay sesion admin activa."
        )
      }

      return data.session.access_token
    }, [])

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const requestDashboard =
    useCallback(async (
      options?: {
        action?: "sync_lunaportex" | "notify_ebay_opportunities"
      }
    ) => {
      const token =
        await getAccessToken()

      const controller =
        new AbortController()

      const timeoutId =
        window.setTimeout(
          () =>
            controller.abort(),
          MARKET_RADAR_REQUEST_TIMEOUT_MS
        )

      let response: Response

      try {
        response =
          await fetch(
            "/api/admin/market-radar",
            {
              method:
                options?.action
                  ? "POST"
                  : "GET",
              cache:
                "no-store",
              signal:
                controller.signal,
              headers: {
                Authorization:
                  `Bearer ${token}`,
                "Content-Type":
                  "application/json",
              },
              body:
                options?.action
                  ? JSON.stringify({
                      action:
                        options.action,
                    })
                  : undefined,
            }
          )
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          throw new Error(
            getAbortErrorMessage(
              "Market Radar no respondió a tiempo."
            )
          )
        }

        throw error
      } finally {
        window.clearTimeout(
          timeoutId
        )
      }

      const payload =
        await readJsonResponse<MarketRadarApiResponse>(
          response,
          "Market Radar devolvio una respuesta invalida."
        )

      if (
        !response.ok ||
        !payload.success ||
        !payload.dashboard
      ) {
        throw new Error(
          payload.error ||
          "No se pudo cargar Market Radar."
        )
      }

      setDashboard(
        payload.dashboard
      )

      if (payload.sync) {
        setSyncResult(
          payload.sync
        )
      }
    }, [getAccessToken])

  const loadDashboard =
    useCallback(async () => {
      setIsLoading(true)
      setError("")

      try {
        await requestDashboard()
      } catch (loadError) {
        console.error(
          "LOAD MARKET RADAR ERROR:",
          loadError
        )

        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar Market Radar."
        )
      } finally {
        setIsLoading(false)
      }
    }, [requestDashboard])

  const syncLunaPortex =
    useCallback(async () => {
      setIsSyncing(true)
      setError("")

      try {
        await requestDashboard({
          action:
            "sync_lunaportex",
        })
      } catch (syncError) {
        console.error(
          "SYNC MARKET RADAR ERROR:",
          syncError
        )

        setError(
          syncError instanceof Error
            ? syncError.message
            : "No se pudo sincronizar Luna Portex."
        )
      } finally {
        setIsSyncing(false)
      }
    }, [requestDashboard])

  const openPriceIntelligenceModal =
    useCallback((
      product: MarketRadarProductRow
    ) => {
      setPriceIntelligenceProduct(
        product
      )
      setPriceIntelligenceForm(
        createPriceIntelligenceForm(
          product
        )
      )
    }, [])

  const closePriceIntelligenceModal =
    useCallback(() => {
      if (isSavingPriceIntelligence) {
        return
      }

      setPriceIntelligenceProduct(null)
      setPriceIntelligenceForm(null)
    }, [isSavingPriceIntelligence])

  const updatePriceIntelligenceForm =
    useCallback((
      field: keyof PriceIntelligenceFormState,
      value: string
    ) => {
      setPriceIntelligenceForm(current =>
        current
          ? {
              ...current,
              [field]:
                value,
            }
          : current
      )
    }, [])

  const savePriceIntelligence =
    useCallback(async () => {
      if (
        !priceIntelligenceProduct ||
        !priceIntelligenceForm
      ) {
        return
      }

      const productKey =
        getProductEvaluationKey(
          priceIntelligenceProduct
        )

      setIsSavingPriceIntelligence(true)
      setError("")

      try {
        const token =
          await getAccessToken()

        const response =
          await fetch(
            "/api/admin/ebay-winner-pipeline/price-intelligence",
            {
              method:
                "POST",
              headers: {
                Authorization:
                  `Bearer ${token}`,
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  buildPriceIntelligencePayload(
                    priceIntelligenceProduct,
                    priceIntelligenceForm
                  )
                ),
            }
          )

        const payload =
          await readJsonResponse<PriceIntelligenceApiResponse>(
            response,
            "Price Intelligence devolvio una respuesta invalida."
          )

        if (
          !response.ok ||
          !payload.success
        ) {
          throw new Error(
            payload.error ||
            "No se pudo guardar Price Intelligence."
          )
        }

        setPriceIntelligenceResults(current => ({
          ...current,
          [productKey]: {
            status:
              "success",
            message:
              "Price Intelligence guardado.",
            recommendedSalePrice:
              payload.snapshot?.recommended_sale_price,
          },
        }))

        setPriceIntelligenceProduct(null)
        setPriceIntelligenceForm(null)
      } catch (saveError) {
        console.error(
          "PRICE INTELLIGENCE SAVE ERROR:",
          saveError
        )

        setPriceIntelligenceResults(current => ({
          ...current,
          [productKey]: {
            status:
              "error",
            message:
              saveError instanceof Error
                ? saveError.message
                : "No se pudo guardar Price Intelligence.",
          },
        }))
      } finally {
        setIsSavingPriceIntelligence(false)
      }
    }, [
      getAccessToken,
      priceIntelligenceForm,
      priceIntelligenceProduct,
    ])


  const evaluateInEbayPipeline =
    useCallback(async (
      product: MarketRadarProductRow
    ) => {
      const productKey =
        getProductEvaluationKey(
          product
        )

      setEvaluatingProductKey(
        productKey
      )
      setError("")

      try {
        const token =
          await getAccessToken()

        const response =
          await fetch(
            "/api/admin/ebay-winner-pipeline",
            {
              method:
                "POST",
              headers: {
                Authorization:
                  `Bearer ${token}`,
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  action:
                    "process_radar_candidate",
                  persist:
                    true,
                  radarProduct:
                    buildEbayPipelineRadarProduct(
                      product
                    ),
                }),
            }
          )

        const payload =
          await readJsonResponse<EbayPipelineApiResponse>(
            response,
            "eBay Pipeline devolvio una respuesta invalida."
          )

        if (
          !response.ok ||
          !payload.success
        ) {
          throw new Error(
            payload.error ||
            "No se pudo evaluar en eBay Pipeline."
          )
        }

        const persistedCandidate =
          payload.result?.persisted?.candidate

        setEbayPipelineEvaluations(current => ({
          ...current,
          [productKey]: {
            status:
              "success",
            message:
              "Candidato enviado al eBay Pipeline en modo dryRun.",
            candidateId:
              persistedCandidate?.id,
            candidateKey:
              persistedCandidate?.candidate_key ||
              payload.result?.candidate?.candidate_key,
            candidateState:
              persistedCandidate?.state ||
              payload.result?.candidate?.state,
          },
        }))
      } catch (evaluationError) {
        console.error(
          "EBAY PIPELINE DRYRUN EVALUATION ERROR:",
          evaluationError
        )

        setEbayPipelineEvaluations(current => ({
          ...current,
          [productKey]: {
            status:
              "error",
            message:
              evaluationError instanceof Error
                ? evaluationError.message
                : "No se pudo evaluar en eBay Pipeline.",
          },
        }))
      } finally {
        setEvaluatingProductKey("")
      }
    }, [getAccessToken])


  useEffect(() => {
    loadDashboard()

    const interval =
      window.setInterval(
        () => {
          loadDashboard()
        },
        60 * 1000
      )

    return () =>
      window.clearInterval(interval)
  }, [loadDashboard])

  const inventoryCounts =
    useMemo(
      () => {
        const products =
          dashboard?.products || []

        const confirmed =
          products.filter(product =>
            product.inventory_quantity !== null &&
            product.inventory_quantity !== undefined
          ).length

        return {
          confirmed,
          missing:
            products.length - confirmed,
        }
      },
      [dashboard]
    )

  const hotProducts =
    useMemo(
      () => {
        const products =
          dashboard?.products || []

        return products
          .filter(product => {
            if (stockFilter === "confirmed") {
              return (
                product.inventory_quantity !== null &&
                product.inventory_quantity !== undefined
              )
            }

            if (stockFilter === "missing") {
              return (
                product.inventory_quantity === null ||
                product.inventory_quantity === undefined
              )
            }

            return true
          })
          .slice(
          0,
          25
        )
      },
      [
        dashboard,
        stockFilter,
      ]
    )

  const summary =
    dashboard?.summary

  return (
    <div className="mt-16 space-y-6">
      {isMounted &&
      priceIntelligenceProduct &&
      priceIntelligenceForm ? (
        <PriceIntelligenceModalPortal
          product={priceIntelligenceProduct}
          form={priceIntelligenceForm}
          isSaving={isSavingPriceIntelligence}
          onChange={updatePriceIntelligenceForm}
          onClose={closePriceIntelligenceModal}
          onSubmit={savePriceIntelligence}
        />
      ) : null}

      <section
        className="
          rounded-lg
          border
          border-cyan-300/15
          bg-cyan-300/[0.04]
          p-5
          md:p-6
        "
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/60">
              Luna Portex
            </p>
            <h2 className="mt-3 text-3xl font-black text-white">
              Market Radar
            </h2>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
              <span>
                Ultimo sync: {formatDate(summary?.lastSuccessAt)}
              </span>
              <span>
                Fuente: {summary?.source?.base_url || "Pendiente"}
              </span>
              {summary?.source?.last_error && (
                <span className="text-red-100">
                  Error: {summary.source.last_error}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={loadDashboard}
              disabled={isLoading || isSyncing}
              className="
                inline-flex
                items-center
                gap-2
                rounded-lg
                border
                border-white/10
                bg-white/[0.04]
                px-4
                py-3
                text-sm
                font-semibold
                text-white
                transition
                hover:border-cyan-300/25
                hover:bg-cyan-300/[0.06]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              <RefreshCw
                className={`
                  h-4
                  w-4
                  ${isLoading ? "animate-spin" : ""}
                `}
              />
              Refrescar
            </button>

            <button
              onClick={syncLunaPortex}
              disabled={isSyncing}
              className="
                inline-flex
                items-center
                gap-2
                rounded-lg
                border
                border-cyan-300/30
                bg-cyan-300
                px-4
                py-3
                text-sm
                font-black
                text-black
                transition
                hover:bg-cyan-200
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              <Radar
                className={`
                  h-4
                  w-4
                  ${isSyncing ? "animate-spin" : ""}
                `}
              />
              {isSyncing ? "Sincronizando" : "Sync Luna"}
            </button>

          </div>
        </div>

        {syncResult && (
          <>
            <div
              className="
                mt-5
                grid
                gap-3
                rounded-lg
                border
                border-white/10
                bg-black/25
                p-4
                text-xs
                text-white/55
                md:grid-cols-5
              "
            >
              <span>
                Productos: <strong className="text-white">{syncResult.fetchedProducts}</strong>
              </span>
              <span>
                Variantes: <strong className="text-white">{syncResult.fetchedVariants}</strong>
              </span>
              <span>
                Snapshots: <strong className="text-white">{syncResult.snapshotsInserted}</strong>
              </span>
              <span>
                Eventos: <strong className="text-white">{syncResult.eventsInserted}</strong>
              </span>
              <span>
                Scores: <strong className="text-white">{syncResult.scoredProducts}</strong>
              </span>
            </div>
            <div
              className="
                mt-3
                grid
                gap-3
                rounded-lg
                border
                border-white/10
                bg-black/20
                p-4
                text-xs
                leading-5
                text-white/55
                md:grid-cols-3
              "
            >
              <span>
                Cantidad numérica:{" "}
                <strong className="text-white">
                  {syncResult.inventoryNumericVariants ?? 0}
                </strong>
              </span>
              <span>
                Solo disponibilidad:{" "}
                <strong className="text-white">
                  {syncResult.inventoryAvailabilityOnlyVariants ?? 0}
                </strong>
              </span>
              <span>
                Sin dato stock:{" "}
                <strong className="text-white">
                  {syncResult.inventoryUnknownVariants ?? 0}
                </strong>
              </span>
              <span>
                Cookie Luna:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydrationEnabled
                    ? "activa"
                    : "no activa"}
                </strong>
              </span>
              <span>
                Hidratados:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydratedProducts ?? 0}
                </strong>
              </span>
              <span>
                Candidatos hidratación:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydrationCandidates ?? 0}
                </strong>
              </span>
              <span>
                Fetch OK:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydrationSuccessfulFetches ?? 0}
                </strong>
              </span>
              <span>
                Fetch fallidos:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydrationFailedFetches ?? 0}
                </strong>
              </span>
              <span>
                OK sin cantidad:{" "}
                <strong className="text-white">
                  {syncResult.inventoryHydrationWithoutNumericInventory ?? 0}
                </strong>
              </span>
            </div>

          </>
        )}

        {error && (
          <div
            className="
              mt-5
              rounded-lg
              border
              border-red-300/20
              bg-red-300/[0.08]
              p-4
              text-sm
              text-red-100
            "
          >
            {error}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Productos"
          value={summary?.totalProducts || 0}
          detail={`${summary?.availableProducts || 0} disponibles`}
          icon={PackageCheck}
        />
        <MetricCard
          title="Agotados"
          value={summary?.outOfStockProducts || 0}
          detail={`${summary?.stockOuts7d || 0} eventos 7d`}
          icon={TriangleAlert}
        />
        <MetricCard
          title="Descuento"
          value={summary?.discountedProducts || 0}
          detail="Con compare-at price"
          icon={DollarSign}
        />
        <MetricCard
          title="Hot"
          value={summary?.highOpportunityProducts || 0}
          detail="Score 70+"
          icon={Activity}
        />
        <MetricCard
          title="Restocks"
          value={summary?.restocks7d || 0}
          detail="Ultimos 7 dias"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Precios"
          value={summary?.priceChanges24h || 0}
          detail="Cambios 24h"
          icon={Clock3}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.7fr]">
        <section
          className="
            overflow-hidden
            rounded-lg
            border
            border-white/10
            bg-black/30
          "
        >
          <div className="flex flex-col gap-3 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                Ranking
              </p>
              <h3 className="mt-2 text-xl font-black text-white">
                Productos con mayor oportunidad
              </h3>
              <p className="mt-2 text-xs text-white/40">
                {inventoryCounts.confirmed} con cantidad confirmada / {inventoryCounts.missing} sin cantidad
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    value:
                      "all" as const,
                    label:
                      "Todos",
                  },
                  {
                    value:
                      "confirmed" as const,
                    label:
                      "Con cantidad",
                  },
                  {
                    value:
                      "missing" as const,
                    label:
                      "Sin cantidad",
                  },
                ].map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setStockFilter(option.value)
                    }
                    className={`
                      rounded-md
                      border
                      px-3
                      py-2
                      text-xs
                      font-bold
                      transition
                      ${
                        stockFilter === option.value
                          ? "border-cyan-300/40 bg-cyan-300 text-black"
                          : "border-white/10 bg-white/[0.04] text-white/55 hover:border-cyan-300/25 hover:text-white"
                      }
                    `}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 text-[11px] text-white/40">
                <span className="inline-flex items-center gap-1">
                  <ArrowDown className="h-3.5 w-3.5 text-cyan-100" />
                  Baja precio
                </span>
                <span className="inline-flex items-center gap-1">
                  <ArrowUp className="h-3.5 w-3.5 text-amber-100" />
                  Sube precio
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left">
              <thead className="bg-white/[0.035] text-[10px] uppercase tracking-[0.18em] text-white/35">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    Producto
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Precio
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Stock / Cantidad
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Coleccion
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Score
                  </th>
                  <th className="px-4 py-3 font-medium">
                    Movimiento
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !dashboard ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-white/45"
                    >
                      Cargando radar...
                    </td>
                  </tr>
                ) : hotProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-white/45"
                    >
                      {dashboard
                        ? "No hay productos para este filtro."
                        : "Ejecuta el primer sync para llenar el ranking."}
                    </td>
                  </tr>
                ) : (
                  hotProducts.map(product => (
                    <ProductRow
                      key={`${product.product_id}-${product.supplier_variant_id || "default"}`}
                      product={product}
                      evaluation={
                        ebayPipelineEvaluations[
                          getProductEvaluationKey(
                            product
                          )
                        ]
                      }
                      priceIntelligence={
                        priceIntelligenceResults[
                          getProductEvaluationKey(
                            product
                          )
                        ]
                      }
                      isEvaluating={
                        evaluatingProductKey ===
                        getProductEvaluationKey(
                          product
                        )
                      }
                      onOpenPriceIntelligence={openPriceIntelligenceModal}
                      onEvaluate={evaluateInEbayPipeline}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="
            rounded-lg
            border
            border-white/10
            bg-black/30
            p-5
          "
        >
          <p className="text-[10px] uppercase tracking-[0.26em] text-white/40">
            Advisor
          </p>
          <h3 className="mt-2 text-xl font-black text-white">
            Alertas Advisor del Radar
          </h3>
          <p className="mt-2 text-xs leading-5 text-white/40">
            Eventos traducidos a recomendaciones estrategicas. No ejecutan acciones reales.
          </p>

          <div className="mt-5 space-y-3">
            {dashboard?.advisorAlerts.length ? (
              dashboard.advisorAlerts.map(alert => (
                <RadarAdvisorAlertItem
                  key={`${alert.product_id}-${alert.event_type}-${alert.created_at}`}
                  alert={alert}
                />
              ))
            ) : (
              <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                Sin alertas Advisor por ahora.
              </p>
            )}
          </div>
        </section>

        <section
          className="
            rounded-lg
            border
            border-white/10
            bg-black/30
            p-5
          "
        >
          <p className="text-[10px] uppercase tracking-[0.26em] text-white/40">
            Eventos
          </p>
          <h3 className="mt-2 text-xl font-black text-white">
            Movimiento reciente
          </h3>

          <div className="mt-5 space-y-3">
            {dashboard?.recentEvents.length ? (
              dashboard.recentEvents.slice(0, 12).map(event => (
                <RecentEventItem
                  key={event.id}
                  event={event}
                />
              ))
            ) : (
              <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                Sin eventos todavia.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
