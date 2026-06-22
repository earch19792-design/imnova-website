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
  supabase,
} from "@/lib/supabase"
import {
  type MarketRadarDashboard,
  type MarketRadarEventRow,
  type MarketRadarProductRow,
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
  "manual",
  "aiprice",
  "terapeak",
  "zik",
  "ebay_api",
  "other",
]

const productMatchOptions = [
  "exact",
  "same_model",
  "similar",
  "category_only",
  "unknown",
]

const sourceConfidenceOptions = [
  "low",
  "medium",
  "high",
]

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

function formatInventoryQuantity(
  value: number | null | undefined
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "Cantidad no expuesta"
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

function getProductStatusLabel(
  product: MarketRadarProductRow
) {
  if (product.available === true) {
    return "Disponible"
  }

  if (product.available === false) {
    return "Agotado"
  }

  return "Sin dato"
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

function createPriceIntelligenceForm(
  product: MarketRadarProductRow
): PriceIntelligenceFormState {
  return {
    source_type:
      "manual",
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

function buildPriceIntelligencePayload(
  product: MarketRadarProductRow,
  form: PriceIntelligenceFormState
) {
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
      form.source_type,
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
      getNullableFormValue(
        form.recommended_sale_price
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="block min-w-0">
      <span className="block break-words text-[10px] uppercase leading-4 tracking-[0.16em] text-white/35">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={event =>
          onChange(event.target.value)
        }
        className="
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
        "
      />
    </label>
  )
}

function PriceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block min-w-0">
      <span className="block break-words text-[10px] uppercase leading-4 tracking-[0.16em] text-white/35">
        {label}
      </span>
      <select
        value={value}
        onChange={event =>
          onChange(event.target.value)
        }
        className="
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
          focus:border-cyan-300/30
        "
      >
        {options.map(option => (
          <option
            key={option}
            value={option}
          >
            {option}
          </option>
        ))}
      </select>
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
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-5">
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
          w-[min(100%,56rem)]
          max-w-[calc(100vw-1.5rem)]
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
              Agregar precio de mercado
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 md:px-6">
          <PriceFormGroup title="Fuente y confianza">
            <div className="grid gap-4 md:grid-cols-3">
          <PriceSelect
            label="source_type"
            value={form.source_type}
            options={priceSourceOptions}
            onChange={value =>
              onChange(
                "source_type",
                value
              )
            }
          />
          <PriceSelect
            label="match_type"
            value={form.product_match_type}
            options={productMatchOptions}
            onChange={value =>
              onChange(
                "product_match_type",
                value
              )
            }
          />
          <PriceSelect
            label="confidence"
            value={form.source_confidence}
            options={sourceConfidenceOptions}
            onChange={value =>
              onChange(
                "source_confidence",
                value
              )
            }
          />
            </div>

            <div className="mt-4">
              <PriceInput
                label="search_query"
                value={form.search_query}
                onChange={value =>
                  onChange(
                    "search_query",
                    value
                  )
                }
              />
            </div>
          </PriceFormGroup>

          <PriceFormGroup title="Precios vendidos">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PriceInput
            label="sold_avg_price"
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
            label="sold_median_price"
            type="number"
            value={form.sold_median_price}
            onChange={value =>
              onChange(
                "sold_median_price",
                value
              )
            }
          />
          <PriceInput
            label="sold_min_price"
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
            label="sold_max_price"
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
            label="sold_comp_count"
            type="number"
            value={form.sold_comp_count}
            onChange={value =>
              onChange(
                "sold_comp_count",
                value
              )
            }
          />
            </div>
          </PriceFormGroup>

          <PriceFormGroup title="Precios activos">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PriceInput
            label="active_avg_price"
            type="number"
            value={form.active_avg_price}
            onChange={value =>
              onChange(
                "active_avg_price",
                value
              )
            }
          />
          <PriceInput
            label="active_min_price"
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
            label="active_max_price"
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
            label="active_comp_count"
            type="number"
            value={form.active_comp_count}
            onChange={value =>
              onChange(
                "active_comp_count",
                value
              )
            }
          />
            </div>
          </PriceFormGroup>

          <PriceFormGroup title="Shipping y precio recomendado">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PriceInput
            label="estimated_shipping_cost"
            type="number"
            value={form.estimated_shipping_cost}
            onChange={value =>
              onChange(
                "estimated_shipping_cost",
                value
              )
            }
          />
          <PriceInput
            label="recommended_sale_price"
            type="number"
            value={form.recommended_sale_price}
            onChange={value =>
              onChange(
                "recommended_sale_price",
                value
              )
            }
          />
          <PriceInput
            label="confidence_score"
            type="number"
            value={form.confidence_score}
            onChange={value =>
              onChange(
                "confidence_score",
                value
              )
            }
          />
            </div>
          </PriceFormGroup>

          <PriceFormGroup title="Evidencia y categoria">
            <div className="grid gap-4 md:grid-cols-2">
          <PriceInput
            label="category_id"
            value={form.category_id}
            onChange={value =>
              onChange(
                "category_id",
                value
              )
            }
          />
          <PriceInput
            label="category_name"
            value={form.category_name}
            onChange={value =>
              onChange(
                "category_name",
                value
              )
            }
          />
        </div>

        <div className="mt-4">
          <PriceInput
            label="evidence_url"
            value={form.evidence_url}
            onChange={value =>
              onChange(
                "evidence_url",
                value
              )
            }
          />
        </div>

            <label className="mt-4 block min-w-0">
          <span className="block break-words text-[10px] uppercase leading-4 tracking-[0.16em] text-white/35">
            evidence_notes
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
            className="
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
            "
          />
            </label>
          </PriceFormGroup>
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
            onClick={onSubmit}
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
            ${
              product.available === true
                ? "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
                : product.available === false
                ? "border-red-300/25 bg-red-300/[0.10] text-red-100"
                : "border-white/10 bg-white/[0.04] text-white/45"
            }
          `}
        >
          {getProductStatusLabel(product)}
        </span>
        <p className="mt-2 text-xs font-semibold text-white/70">
          {formatInventoryQuantity(product.inventory_quantity)}
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          Cantidad disponible proveedor
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

export function MarketRadarPanel() {
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

  const requestDashboard =
    useCallback(async (
      options?: {
        action?: "sync_lunaportex" | "notify_ebay_opportunities"
      }
    ) => {
      const token =
        await getAccessToken()

      const response =
        await fetch(
          "/api/admin/market-radar",
          {
            method:
              options?.action
                ? "POST"
                : "GET",
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

      const payload =
        await response.json() as MarketRadarApiResponse

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
          await response.json() as PriceIntelligenceApiResponse

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
          await response.json() as EbayPipelineApiResponse

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

  const hotProducts =
    useMemo(
      () =>
        (
          dashboard?.products || []
        ).slice(
          0,
          25
        ),
      [dashboard]
    )

  const summary =
    dashboard?.summary

  return (
    <div className="mt-16 space-y-6">
      {priceIntelligenceProduct &&
      priceIntelligenceForm ? (
        <PriceIntelligenceModal
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
                      Ejecuta el primer sync para llenar el ranking.
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
