"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSearch,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react"
import {
  supabase,
} from "@/lib/supabase"

type EbaySummary = {
  dryRunOnly: boolean
  totalCandidates: number
  validated: number
  draftCreated: number
  blockedNeedsData: number
  localDrafts: number
  realEbayDraftsDetected: number
}

type EbayScore = {
  winner_score?: number | string | null
  demand_score?: number | string | null
  profitability_score?: number | string | null
  competition_score?: number | string | null
  stock_stability_score?: number | string | null
  data_quality_score?: number | string | null
  inverse_operational_risk_score?: number | string | null
  explanation?: string | null
  calculated_at?: string | null
  score_payload?: unknown
}

type EbayProfitScenario = {
  estimated_sale_price?: number | string | null
  luna_cost?: number | string | null
  fulfillment_cost?: number | string | null
  packaging_cost?: number | string | null
  estimated_shipping_cost?: number | string | null
  estimated_ebay_fee?: number | string | null
  estimated_payment_fee?: number | string | null
  estimated_advertising_cost?: number | string | null
  return_reserve?: number | string | null
  total_estimated_cost?: number | string | null
  net_profit?: number | string | null
  net_margin_percent?: number | string | null
  roi_percent?: number | string | null
  passes_minimums?: boolean | null
  assumptions?: unknown
  calculated_at?: string | null
}

type TargetPriceAdvisor = {
  current_sale_price?: number | string | null
  current_net_profit?: number | string | null
  current_net_margin_percent?: number | string | null
  minimum_target_margin_percent?: number | string | null
  variable_rate_percent?: number | string | null
  fixed_costs?: number | string | null
  minimum_profitable_price?: number | string | null
  suggested_target_price?: number | string | null
  ideal_target_margin_percent?: number | string | null
  ideal_target_price?: number | string | null
}

type ProfitAssumptions = {
  minimumProfitUsd?: number
  idealProfitUsd?: number
  minimumRoiPercent?: number
  minimumNetMarginPercent?: number
  roiBlocksMinimums?: boolean
  ebayFeePercent?: number
  paymentFeePercent?: number
  advertisingPercent?: number
  returnReservePercent?: number
  targetPriceAdvisor?: TargetPriceAdvisor
}

type EbayCompliance = {
  overall_status?: string | null
  blocker_count?: number | null
  findings?: unknown
  checked_at?: string | null
}

type EbayDraft = {
  draft_status?: string | null
  title?: string | null
  description_html?: string | null
  category_id?: string | null
  condition_id?: string | null
  price?: number | string | null
  quantity?: number | null
  supplier_sku?: string | null
  brand?: string | null
  image_urls?: string[] | null
  aspects?: unknown
  shipping_policy?: unknown
  return_policy?: unknown
  payment_policy?: unknown
  dry_run_only?: boolean | null
  ebay_draft_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type EbayCandidate = {
  id: string
  candidate_key: string
  supplier_sku?: string | null
  title: string
  product_url?: string | null
  brand?: string | null
  product_type?: string | null
  state: string
  last_evaluated_at?: string | null
  blocked_reason?: string | null
  needs_data?: unknown
  created_at?: string | null
  updated_at?: string | null
  score?: EbayScore | null
  profitScenario?: EbayProfitScenario | null
  compliance?: EbayCompliance | null
  draft?: EbayDraft | null
}

type EbayValidation = {
  validation_status?: string | null
  required_fields?: unknown
  missing_fields?: unknown
  critical_reasons?: unknown
  validated_at?: string | null
}

type EbayDecision = {
  decision?: string | null
  decision_channel?: string | null
  message_id?: string | null
  decided_by?: string | null
  decision_payload?: unknown
  decided_at?: string | null
}

type EbayAuditLog = {
  event_type?: string | null
  from_state?: string | null
  to_state?: string | null
  actor?: string | null
  payload?: unknown
  created_at?: string | null
}

type PriceIntelligenceSnapshot = {
  id: string
  source_type?: string | null
  marketplace?: string | null
  search_query?: string | null
  product_match_type?: string | null
  sold_avg_price?: number | string | null
  sold_median_price?: number | string | null
  sold_min_price?: number | string | null
  sold_max_price?: number | string | null
  sold_comp_count?: number | null
  active_avg_price?: number | string | null
  active_min_price?: number | string | null
  active_max_price?: number | string | null
  active_comp_count?: number | null
  estimated_shipping_cost?: number | string | null
  recommended_sale_price?: number | string | null
  confidence_score?: number | string | null
  source_confidence?: string | null
  category_id?: string | null
  category_name?: string | null
  evidence_url?: string | null
  evidence_notes?: string | null
  created_at?: string | null
}

type CostScenario = {
  sale_price?: number | string | null
  luna_cost?: number | string | null
  shipping_cost?: number | string | null
  ebay_fee_percent?: number | string | null
  ebay_fee_amount?: number | string | null
  payment_fee_percent?: number | string | null
  payment_fee_amount?: number | string | null
  promotion_percent?: number | string | null
  promotion_amount?: number | string | null
  fulfillment_cost?: number | string | null
  packaging_cost?: number | string | null
  return_reserve_percent?: number | string | null
  return_reserve_amount?: number | string | null
  direct_cost?: number | string | null
  marketplace_cost?: number | string | null
  operating_cost?: number | string | null
  total_estimated_cost?: number | string | null
  net_profit?: number | string | null
  net_margin_percent?: number | string | null
  roi_percent?: number | string | null
  break_even_price?: number | string | null
  minimum_price_for_10_percent_margin?: number | string | null
  suggested_target_price?: number | string | null
  pass_10_percent_margin?: boolean | null
}

type CostBreakdown = CostScenario & {
  shipping_source?: string | null
  shipping_note?: string | null
  shipping_review_required?: boolean | null
  minimum_target_margin_percent?: number | string | null
  scenario_current?: CostScenario | null
  scenario_without_promotion?: CostScenario | null
  scenario_with_max_promotion?: CostScenario | null
}

type EbayDecisionAdvisor = {
  decision_label?: string
  human_summary?: string
  block_reasons?: string[]
  missing_data?: string[]
  profit_reasons?: string[]
  market_price_reasons?: string[]
  target_price?: {
    current_sale_price?: number | string | null
    current_net_profit?: number | string | null
    current_net_margin_percent?: number | string | null
    minimum_price_for_10_percent_margin?: number | string | null
    suggested_target_price?: number | string | null
    ideal_target_price?: number | string | null
    is_target_price_competitive?: boolean | null
    market_reference_price?: number | string | null
    market_reference_source?: string | null
    market_confidence?: number | string | null
  }
  cost_breakdown?: CostBreakdown | null
  recommended_next_action?: string
}

type EbayCandidateDetail = {
  candidate: EbayCandidate
  validation?: EbayValidation | null
  validations?: EbayValidation[]
  profitScenario?: EbayProfitScenario | null
  compliance?: EbayCompliance | null
  score?: EbayScore | null
  decisions?: EbayDecision[]
  localDraft?: EbayDraft | null
  auditLog?: EbayAuditLog[]
  priceIntelligence?: PriceIntelligenceSnapshot | null
  priceIntelligenceSnapshots?: PriceIntelligenceSnapshot[]
  decisionAdvisor?: EbayDecisionAdvisor | null
}

type EbayDashboard = {
  summary: EbaySummary
  candidates: EbayCandidate[]
  pagination: {
    page: number
    limit: number
    total: number
    hasNextPage: boolean
  }
}

type EbayDashboardResponse = {
  success: boolean
  dryRunOnly?: boolean
  dashboard?: EbayDashboard
  detail?: EbayCandidateDetail | null
  error?: string
}

type ReprocessStatus = {
  status: "success" | "error"
  message: string
}

const candidateStateOptions = [
  "",
  "DETECTED",
  "ENRICHING",
  "NEEDS_DATA",
  "BLOCKED",
  "VALIDATED",
  "APPROVAL_PENDING",
  "APPROVED",
  "DRAFT_CREATED",
  "PAUSED",
  "REJECTED",
]

const complianceOptions = [
  "",
  "passed",
  "blocked",
  "needs_review",
]

const draftOptions = [
  "",
  "created",
  "paused",
  "rejected",
  "no_draft",
]

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

function formatNumber(
  value: number | string | null | undefined,
  suffix = ""
) {
  const numericValue =
    toNumber(value)

  if (numericValue === null) {
    return "-"
  }

  return `${new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 2,
    }
  ).format(numericValue)}${suffix}`
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

function roundMoney(
  value: number
) {
  return Math.round(
    (value + 1e-8) * 100
  ) / 100
}

function roundUpMarketPrice(
  value: number | null
) {
  if (
    value === null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null
  }

  return roundMoney(
    Math.ceil((value + 0.01) / 5) * 5 - 0.01
  )
}

function parseEditableNumber(
  value: string
) {
  const parsed =
    Number(value)

  return Number.isFinite(parsed)
    ? parsed
    : null
}

function calculateEditableCostScenario(
  base: CostBreakdown,
  {
    shippingCost,
    promotionPercent,
  }: {
    shippingCost: number
    promotionPercent: number
  }
): CostScenario {
  const salePrice =
    toNumber(base.sale_price) || 0

  const lunaCost =
    toNumber(base.luna_cost) || 0

  const fulfillmentCost =
    toNumber(base.fulfillment_cost) || 0

  const packagingCost =
    toNumber(base.packaging_cost) || 0

  const ebayFeePercent =
    toNumber(base.ebay_fee_percent) || 0

  const paymentFeePercent =
    toNumber(base.payment_fee_percent) || 0

  const returnReservePercent =
    toNumber(base.return_reserve_percent) || 0

  const targetMarginPercent =
    toNumber(base.minimum_target_margin_percent) || 10

  const safeShippingCost =
    Math.max(
      6.99,
      shippingCost
    )

  const safePromotionPercent =
    Math.min(
      Math.max(
        promotionPercent,
        0
      ),
      5
    )

  const ebayFeeAmount =
    roundMoney(
      salePrice * (ebayFeePercent / 100)
    )

  const paymentFeeAmount =
    roundMoney(
      salePrice * (paymentFeePercent / 100)
    )

  const promotionAmount =
    roundMoney(
      salePrice * (safePromotionPercent / 100)
    )

  const returnReserveAmount =
    roundMoney(
      salePrice * (returnReservePercent / 100)
    )

  const directCost =
    roundMoney(
      lunaCost + safeShippingCost
    )

  const marketplaceCost =
    roundMoney(
      ebayFeeAmount +
      paymentFeeAmount +
      promotionAmount
    )

  const operatingCost =
    roundMoney(
      fulfillmentCost +
      packagingCost +
      returnReserveAmount
    )

  const totalEstimatedCost =
    roundMoney(
      directCost +
      marketplaceCost +
      operatingCost
    )

  const netProfit =
    roundMoney(
      salePrice - totalEstimatedCost
    )

  const netMarginPercent =
    salePrice > 0
      ? roundMoney(
          (netProfit / salePrice) * 100
        )
      : 0

  const roiPercent =
    lunaCost > 0
      ? roundMoney(
          (netProfit / lunaCost) * 100
        )
      : 0

  const variableRate =
    (
      ebayFeePercent +
      paymentFeePercent +
      safePromotionPercent +
      returnReservePercent
    ) / 100

  const fixedCosts =
    lunaCost +
    safeShippingCost +
    fulfillmentCost +
    packagingCost

  const breakEvenPrice =
    1 - variableRate > 0
      ? roundMoney(
          fixedCosts / (1 - variableRate)
        )
      : null

  const minimumPriceForMargin =
    1 - variableRate - targetMarginPercent / 100 > 0
      ? roundMoney(
          fixedCosts /
            (1 - variableRate - targetMarginPercent / 100)
        )
      : null

  return {
    sale_price:
      salePrice,
    luna_cost:
      lunaCost,
    shipping_cost:
      safeShippingCost,
    ebay_fee_percent:
      ebayFeePercent,
    ebay_fee_amount:
      ebayFeeAmount,
    payment_fee_percent:
      paymentFeePercent,
    payment_fee_amount:
      paymentFeeAmount,
    promotion_percent:
      safePromotionPercent,
    promotion_amount:
      promotionAmount,
    fulfillment_cost:
      fulfillmentCost,
    packaging_cost:
      packagingCost,
    return_reserve_percent:
      returnReservePercent,
    return_reserve_amount:
      returnReserveAmount,
    direct_cost:
      directCost,
    marketplace_cost:
      marketplaceCost,
    operating_cost:
      operatingCost,
    total_estimated_cost:
      totalEstimatedCost,
    net_profit:
      netProfit,
    net_margin_percent:
      netMarginPercent,
    roi_percent:
      roiPercent,
    break_even_price:
      breakEvenPrice,
    minimum_price_for_10_percent_margin:
      minimumPriceForMargin,
    suggested_target_price:
      roundUpMarketPrice(
        minimumPriceForMargin
      ),
    pass_10_percent_margin:
      netProfit > 0 &&
      netMarginPercent >= targetMarginPercent,
  }
}

function formatDate(
  value?: string | null
) {
  if (!value) {
    return "Sin registro"
  }

  try {
    return new Intl.DateTimeFormat(
      "es-GT",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone:
          "America/Guatemala",
      }
    ).format(
      new Date(value)
    )
  } catch {
    return "Fecha no disponible"
  }
}

function isSafeHttpUrl(
  value?: string | null
) {
  if (!value) {
    return false
  }

  try {
    const url =
      new URL(value)

    return url.protocol === "http:" ||
      url.protocol === "https:"
  } catch {
    return false
  }
}

function getStateClassName(
  state?: string | null
) {
  if (
    state === "VALIDATED" ||
    state === "APPROVED" ||
    state === "DRAFT_CREATED"
  ) {
    return "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
  }

  if (
    state === "BLOCKED" ||
    state === "REJECTED"
  ) {
    return "border-red-300/25 bg-red-300/[0.10] text-red-100"
  }

  if (
    state === "NEEDS_DATA" ||
    state === "APPROVAL_PENDING"
  ) {
    return "border-amber-300/25 bg-amber-300/[0.10] text-amber-100"
  }

  return "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100"
}

function getComplianceClassName(
  status?: string | null
) {
  if (status === "passed") {
    return "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100"
  }

  if (status === "blocked") {
    return "border-red-300/25 bg-red-300/[0.10] text-red-100"
  }

  if (status === "needs_review") {
    return "border-amber-300/25 bg-amber-300/[0.10] text-amber-100"
  }

  return "border-white/10 bg-white/[0.04] text-white/45"
}

function StatusBadge({
  value,
  className,
}: {
  value?: string | null
  className: string
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
        ${className}
      `}
    >
      {value || "sin dato"}
    </span>
  )
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  isWarning = false,
}: {
  title: string
  value: string | number
  detail: string
  icon: typeof BarChart3
  isWarning?: boolean
}) {
  return (
    <div
      className={`
        rounded-lg
        border
        p-4
        ${
          isWarning
            ? "border-red-300/20 bg-red-300/[0.07]"
            : "border-white/10 bg-black/25"
        }
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          {title}
        </p>
        <Icon
          className={`
            h-4
            w-4
            ${isWarning ? "text-red-100/70" : "text-cyan-100/55"}
          `}
        />
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

function JsonPreview({
  value,
}: {
  value: unknown
}) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (
      Array.isArray(value) &&
      value.length === 0
    )
  ) {
    return (
      <p className="text-xs text-white/35">
        Sin datos
      </p>
    )
  }

  return (
    <pre
      className="
        max-h-52
        overflow-auto
        whitespace-pre-wrap
        rounded-lg
        border
        border-white/10
        bg-black/35
        p-3
        text-xs
        leading-5
        text-white/55
      "
    >
      {typeof value === "string"
        ? value
        : JSON.stringify(
            value,
            null,
            2
          )}
    </pre>
  )
}

function DetailSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      className="
        rounded-lg
        border
        border-white/10
        bg-white/[0.03]
        p-4
      "
    >
      <h4 className="text-sm font-black text-white">
        {title}
      </h4>
      <div className="mt-4 space-y-3">
        {children}
      </div>
    </section>
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value?: string | number | boolean | null
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-white/70">
        {value === null ||
        value === undefined ||
        value === ""
          ? "-"
          : String(value)}
      </p>
    </div>
  )
}

type HumanBlockReason = {
  title: string
  detail: string
  tone: "danger" | "warning" | "success" | "info"
}

function unknownToStringArray(
  value: unknown
) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item =>
        typeof item === "string"
          ? item
          : JSON.stringify(item)
      )
      .filter(Boolean)
  }

  if (typeof value === "string") {
    return [
      value,
    ]
  }

  return [
    JSON.stringify(value),
  ]
}

function getComplianceMessages(
  value: unknown
) {
  if (!Array.isArray(value)) {
    return unknownToStringArray(value)
  }

  return value
    .map(item => {
      if (
        item &&
        typeof item === "object"
      ) {
        const finding =
          item as {
            code?: string
            message?: string
          }

        return finding.message ||
          finding.code ||
          JSON.stringify(item)
      }

      return String(item)
    })
    .filter(Boolean)
}

function hasAnyField(
  fields: string[],
  patterns: string[]
) {
  return fields.some(field =>
    patterns.some(pattern =>
      field.toLowerCase().includes(pattern)
    )
  )
}

function getHumanBlockReasons(
  detail: EbayCandidateDetail
): HumanBlockReason[] {
  const reasons: HumanBlockReason[] = []
  const state =
    detail.candidate.state

  const missingFields = [
    ...unknownToStringArray(
      detail.candidate.needs_data
    ),
    ...unknownToStringArray(
      detail.validation?.missing_fields
    ),
  ]

  const criticalReasons =
    unknownToStringArray(
      detail.validation?.critical_reasons
    )

  const complianceMessages =
    getComplianceMessages(
      detail.compliance?.findings
    )

  const netProfit =
    toNumber(
      detail.profitScenario?.net_profit
    )

  const margin =
    toNumber(
      detail.profitScenario?.net_margin_percent
    )

  const assumptions =
    detail.profitScenario?.assumptions &&
    typeof detail.profitScenario.assumptions === "object"
      ? detail.profitScenario.assumptions as {
          minimumProfitUsd?: number
          minimumNetMarginPercent?: number
          roiBlocksMinimums?: boolean
        }
      : {}

  if (
    detail.profitScenario &&
    detail.profitScenario.passes_minimums === false
  ) {
    if (
      netProfit !== null &&
      assumptions.minimumProfitUsd !== undefined &&
      netProfit <= assumptions.minimumProfitUsd
    ) {
      reasons.push({
        title:
          "Ganancia estimada insuficiente",
        detail:
          `Net profit ${formatCurrency(netProfit)} debe ser mayor que ${formatCurrency(assumptions.minimumProfitUsd)}.`,
        tone:
          "danger",
      })
    }

    if (
      margin !== null &&
      assumptions.minimumNetMarginPercent !== undefined &&
      margin < assumptions.minimumNetMarginPercent
    ) {
      reasons.push({
        title:
          "Margen neto insuficiente",
        detail:
          `Margen ${formatNumber(margin, "%")} esta por debajo del minimo ${formatNumber(assumptions.minimumNetMarginPercent, "%")}.`,
        tone:
          "danger",
      })
    }

    if (assumptions.roiBlocksMinimums === true) {
      reasons.push({
        title:
          "ROI insuficiente",
        detail:
          "La configuracion actual indica que ROI bloquea minimos.",
        tone:
          "danger",
      })
    }
  }

  if (missingFields.length > 0) {
    reasons.push({
      title:
        "Datos faltantes",
      detail:
        missingFields.join(", "),
      tone:
        state === "NEEDS_DATA"
          ? "warning"
          : "danger",
    })
  }

  if (
    hasAnyField(
      missingFields,
      [
        "authorized_images",
        "image",
      ]
    )
  ) {
    reasons.push({
      title:
        "Imagenes no autorizadas",
      detail:
        "El pipeline necesita confirmar que las imagenes se pueden usar antes de avanzar.",
      tone:
        "warning",
    })
  }

  if (
    hasAnyField(
      missingFields,
      [
        "supplier_sku",
        "sku",
      ]
    )
  ) {
    reasons.push({
      title:
        "Falta SKU real",
      detail:
        "El candidato no tiene una clave/SKU confiable para trazabilidad.",
      tone:
        "warning",
    })
  }

  if (
    hasAnyField(
      missingFields,
      [
        "weight",
        "dimensions",
        "weight_or_dimensions",
      ]
    )
  ) {
    reasons.push({
      title:
        "Falta peso/dimensiones",
      detail:
        "Faltan datos logisticos para estimar costos de fulfillment/shipping con confianza.",
      tone:
        "warning",
    })
  }

  if (
    detail.compliance?.overall_status === "blocked" ||
    complianceMessages.length > 0
  ) {
    reasons.push({
      title:
        "Riesgo compliance",
      detail:
        complianceMessages.length > 0
          ? complianceMessages.join(" | ")
          : "Compliance bloqueo o marco el candidato para revision.",
      tone:
        detail.compliance?.overall_status === "blocked"
          ? "danger"
          : "warning",
    })
  }

  if (criticalReasons.length > 0) {
    reasons.push({
      title:
        "Razones criticas de validacion",
      detail:
        criticalReasons.join(", "),
      tone:
        "danger",
    })
  }

  if (
    detail.priceIntelligence &&
    state === "BLOCKED"
  ) {
    const recommendedPrice =
      toNumber(
        detail.priceIntelligence.recommended_sale_price
      )

    const currentSalePrice =
      toNumber(
        detail.profitScenario?.estimated_sale_price
      )

    reasons.push({
      title:
        recommendedPrice !== null &&
        currentSalePrice !== recommendedPrice
          ? "Price Intelligence existe pero falta reevaluar"
          : "Evidencia de precio disponible",
      detail:
        "Hay evidencia de precio guardada. Usa 'Reevaluar con Price Intelligence' para recalcular.",
      tone:
        "info",
    })
  }

  if (
    !detail.priceIntelligence &&
    (
      state === "BLOCKED" ||
      state === "NEEDS_DATA"
    )
  ) {
    reasons.push({
      title:
        "Precio de mercado no aplicado todavia",
      detail:
        "Agrega evidencia de precio de mercado antes de decidir.",
      tone:
        "warning",
    })
  }

  if (
    state === "VALIDATED" &&
    reasons.length === 0
  ) {
    reasons.push({
      title:
        "Candidato validado",
      detail:
        detail.score?.explanation ||
        "El candidato paso las validaciones actuales del pipeline.",
      tone:
        "success",
    })
  }

  if (
    reasons.length === 0 &&
    detail.candidate.blocked_reason
  ) {
    reasons.push({
      title:
        "Razon registrada",
      detail:
        detail.candidate.blocked_reason,
      tone:
        "warning",
    })
  }

  if (
    reasons.length === 0 &&
    detail.score?.explanation
  ) {
    reasons.push({
      title:
        "Explicacion del score",
      detail:
        detail.score.explanation,
      tone:
        "info",
    })
  }

  return reasons
}

function getReasonClassName(
  tone: HumanBlockReason["tone"]
) {
  if (tone === "danger") {
    return "border-red-300/20 bg-red-300/[0.08] text-red-100"
  }

  if (tone === "warning") {
    return "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"
  }

  if (tone === "success") {
    return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
  }

  return "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100"
}

function CandidateDetailDrawer({
  detail,
  isLoading,
  isReprocessing,
  reprocessStatus,
  onReprocess,
  onReprocessSuggestedPrice,
  onClose,
}: {
  detail: EbayCandidateDetail | null
  isLoading: boolean
  isReprocessing: boolean
  reprocessStatus: ReprocessStatus | null
  onReprocess: (
    detail: EbayCandidateDetail
  ) => void
  onReprocessSuggestedPrice: (
    detail: EbayCandidateDetail
  ) => void
  onClose: () => void
}) {
  const recommendedSalePrice =
    toNumber(
      detail?.priceIntelligence?.recommended_sale_price
    )

  const confidenceScore =
    toNumber(
      detail?.priceIntelligence?.confidence_score
    )

  const hasLowConfidence =
    confidenceScore !== null &&
    confidenceScore < 50

  const humanBlockReasons =
    detail
      ? getHumanBlockReasons(
          detail
        )
      : []

  const profitAssumptions =
    detail?.profitScenario?.assumptions &&
    typeof detail.profitScenario.assumptions === "object"
      ? detail.profitScenario.assumptions as ProfitAssumptions
      : {}

  const targetPriceAdvisor =
    profitAssumptions.targetPriceAdvisor

  const costBreakdown =
    detail?.decisionAdvisor?.cost_breakdown

  const [
    editableShippingCost,
    setEditableShippingCost,
  ] = useState("")

  const [
    editablePromotionPercent,
    setEditablePromotionPercent,
  ] = useState("")

  useEffect(() => {
    setEditableShippingCost(
      costBreakdown?.shipping_cost === null ||
      costBreakdown?.shipping_cost === undefined
        ? ""
        : String(costBreakdown.shipping_cost)
    )
    setEditablePromotionPercent(
      costBreakdown?.promotion_percent === null ||
      costBreakdown?.promotion_percent === undefined
        ? "0"
        : String(costBreakdown.promotion_percent)
    )
  }, [
    detail?.candidate.id,
    costBreakdown?.shipping_cost,
    costBreakdown?.promotion_percent,
  ])

  const parsedEditableShippingCost =
    parseEditableNumber(
      editableShippingCost
    )

  const parsedEditablePromotionPercent =
    parseEditableNumber(
      editablePromotionPercent
    )

  const normalizedEditableShippingCost =
    Math.max(
      6.99,
      parsedEditableShippingCost ??
        toNumber(costBreakdown?.shipping_cost) ??
        6.99
    )

  const normalizedEditablePromotionPercent =
    Math.min(
      Math.max(
        parsedEditablePromotionPercent ??
          toNumber(costBreakdown?.promotion_percent) ??
          0,
        0
      ),
      5
    )

  const editableCurrentScenario =
    costBreakdown
      ? calculateEditableCostScenario(
          costBreakdown,
          {
            shippingCost:
              normalizedEditableShippingCost,
            promotionPercent:
              normalizedEditablePromotionPercent,
          }
        )
      : null

  const displayedCostBreakdown =
    editableCurrentScenario
      ? {
          ...costBreakdown,
          ...editableCurrentScenario,
        }
      : costBreakdown

  const costScenarios = [
    {
      label:
        "Escenario actual",
      value:
        editableCurrentScenario,
    },
    {
      label:
        "Sin promocion",
      value:
        costBreakdown
          ? calculateEditableCostScenario(
              costBreakdown,
              {
                shippingCost:
                  normalizedEditableShippingCost,
                promotionPercent:
                  0,
              }
            )
          : null,
    },
    {
      label:
        "Promo 5%",
      value:
        costBreakdown
          ? calculateEditableCostScenario(
              costBreakdown,
              {
                shippingCost:
                  normalizedEditableShippingCost,
                promotionPercent:
                  5,
              }
            )
          : null,
    },
  ].filter(scenario => Boolean(scenario.value))

  const suggestedTargetPrice =
    toNumber(
      targetPriceAdvisor?.suggested_target_price
    )

  const soldMedianPrice =
    toNumber(
      detail?.priceIntelligence?.sold_median_price
    )

  const soldAvgPrice =
    toNumber(
      detail?.priceIntelligence?.sold_avg_price
    )

  const activeAvgPrice =
    toNumber(
      detail?.priceIntelligence?.active_avg_price
    )

  const marketReferencePrice =
    soldMedianPrice ??
    soldAvgPrice ??
    activeAvgPrice

  const marketReferenceLabel =
    soldMedianPrice !== null
      ? "sold_median_price"
      : soldAvgPrice !== null
        ? "sold_avg_price"
        : activeAvgPrice !== null
          ? "active_avg_price"
          : "sin mercado"

  const soldMinPrice =
    toNumber(
      detail?.priceIntelligence?.sold_min_price
    )

  const soldMaxPrice =
    toNumber(
      detail?.priceIntelligence?.sold_max_price
    )

  const suggestedMarketDifference =
    suggestedTargetPrice !== null &&
    marketReferencePrice !== null
      ? suggestedTargetPrice - marketReferencePrice
      : null

  const suggestedPriceWithinSoldRange =
    suggestedTargetPrice !== null &&
    soldMinPrice !== null &&
    soldMaxPrice !== null &&
    suggestedTargetPrice >= soldMinPrice &&
    suggestedTargetPrice <= soldMaxPrice

  const suggestedPriceNearSoldMedian =
    suggestedTargetPrice !== null &&
    soldMedianPrice !== null &&
    Math.abs(
      suggestedTargetPrice - soldMedianPrice
    ) <= soldMedianPrice * 0.1

  const hasSoldMarketEvidence =
    soldMedianPrice !== null ||
    soldAvgPrice !== null ||
    (
      soldMinPrice !== null &&
      soldMaxPrice !== null
    )

  const suggestedPriceMarketMessage =
    suggestedTargetPrice === null
      ? "No hay precio sugerido calculado."
      : !detail?.priceIntelligence
        ? "No hay Price Intelligence para comparar contra mercado."
        : suggestedPriceWithinSoldRange ||
          suggestedPriceNearSoldMedian
          ? "El precio sugerido esta dentro del rango de mercado o cerca de ventas reales."
          : hasSoldMarketEvidence &&
            marketReferencePrice !== null &&
            suggestedTargetPrice >
              marketReferencePrice * 1.1
            ? "El precio sugerido esta por encima del mercado; no competitivo."
            : activeAvgPrice !== null &&
              !hasSoldMarketEvidence
              ? "Solo hay precios activos; revisar evidencia antes de decidir."
              : "Hace falta mejor evidencia de mercado para evaluar competitividad."

  const suggestedPriceTone =
    suggestedPriceMarketMessage.includes(
      "dentro del rango"
    )
      ? "success"
      : suggestedPriceMarketMessage.includes(
          "por encima"
        )
        ? "danger"
        : "warning"

  const canReprocessSuggestedPrice =
    suggestedTargetPrice !== null &&
    detail?.decisionAdvisor?.target_price?.is_target_price_competitive === true

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/65 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Cerrar detalle"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <aside
        className="
          relative
          z-10
          h-full
          w-full
          max-w-3xl
          overflow-y-auto
          border-l
          border-white/10
          bg-zinc-950
          p-5
          shadow-2xl
          md:p-6
        "
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/55">
              Detalle seguro
            </p>
            <h3 className="mt-3 text-2xl font-black text-white">
              {detail?.candidate.title ||
                "Candidato eBay"}
            </h3>
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

        {isLoading ? (
          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-white/50">
            Cargando detalle...
          </div>
        ) : detail ? (
          <div className="mt-6 space-y-5">
            <DetailSection title="Informacion base">
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="candidate_key"
                  value={detail.candidate.candidate_key}
                />
                <Field
                  label="supplier_sku"
                  value={detail.candidate.supplier_sku}
                />
                <Field
                  label="state"
                  value={detail.candidate.state}
                />
                <Field
                  label="last_evaluated_at"
                  value={formatDate(
                    detail.candidate.last_evaluated_at
                  )}
                />
                <Field
                  label="brand"
                  value={detail.candidate.brand}
                />
                <Field
                  label="product_type"
                  value={detail.candidate.product_type}
                />
                <Field
                  label="product_url"
                  value={detail.candidate.product_url}
                />
                <Field
                  label="blocked_reason"
                  value={detail.candidate.blocked_reason}
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                  needs_data
                </p>
                <div className="mt-2">
                  <JsonPreview
                    value={detail.candidate.needs_data}
                  />
                </div>
              </div>
            </DetailSection>

            <DetailSection title="Decision estrategica">
              {detail.decisionAdvisor ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field
                        label="decision_label"
                        value={detail.decisionAdvisor.decision_label}
                      />
                      <Field
                        label="next_action"
                        value={detail.decisionAdvisor.recommended_next_action}
                      />
                      <Field
                        label="target_competitive"
                        value={
                          detail.decisionAdvisor.target_price?.is_target_price_competitive
                        }
                      />
                    </div>
                    <p className="mt-4 text-sm leading-6 text-cyan-50/75">
                      {detail.decisionAdvisor.human_summary}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label="Precio actual"
                      value={formatCurrency(
                        detail.decisionAdvisor.target_price?.current_sale_price
                      )}
                    />
                    <Field
                      label="Minimo 10% margen"
                      value={formatCurrency(
                        detail.decisionAdvisor.target_price?.minimum_price_for_10_percent_margin
                      )}
                    />
                    <Field
                      label="Precio sugerido"
                      value={formatCurrency(
                        detail.decisionAdvisor.target_price?.suggested_target_price
                      )}
                    />
                    <Field
                      label="Precio ideal"
                      value={formatCurrency(
                        detail.decisionAdvisor.target_price?.ideal_target_price
                      )}
                    />
                    <Field
                      label="Precio mercado"
                      value={formatCurrency(
                        detail.decisionAdvisor.target_price?.market_reference_price
                      )}
                    />
                    <Field
                      label="Fuente mercado"
                      value={detail.decisionAdvisor.target_price?.market_reference_source}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">
                        Razones
                      </p>
                      <ul className="mt-3 space-y-2 text-xs leading-5 text-white/60">
                        {[
                          ...(detail.decisionAdvisor.block_reasons || []),
                          ...(detail.decisionAdvisor.profit_reasons || []),
                        ].map((reason, index) => (
                          <li key={`${reason}-${index}`}>
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">
                        Mercado y datos faltantes
                      </p>
                      <ul className="mt-3 space-y-2 text-xs leading-5 text-white/60">
                        {[
                          ...(detail.decisionAdvisor.market_price_reasons || []),
                          ...(detail.decisionAdvisor.missing_data || []),
                        ].map((reason, index) => (
                          <li key={`${reason}-${index}`}>
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {detail.priceIntelligence ? (
                    <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3 md:grid-cols-4">
                      <Field
                        label="PI source"
                        value={detail.priceIntelligence.source_type}
                      />
                      <Field
                        label="PI confidence"
                        value={
                          detail.priceIntelligence.source_confidence ||
                          formatNumber(
                            detail.priceIntelligence.confidence_score
                          )
                        }
                      />
                      <Field
                        label="sold comps"
                        value={detail.priceIntelligence.sold_comp_count}
                      />
                      <Field
                        label="active comps"
                        value={detail.priceIntelligence.active_comp_count}
                      />
                    </div>
                  ) : (
                    <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs leading-5 text-amber-100">
                      Falta evidencia de precio de mercado. Recomendado: buscar en Terapeak/eBay Research antes de decidir.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/40">
                  Sin decision estrategica calculada.
                </p>
              )}
            </DetailSection>

            <DetailSection title="Por que esta bloqueado">
              {humanBlockReasons.length > 0 ? (
                <div className="space-y-3">
                  {humanBlockReasons.map(
                    (reason, index) => (
                      <div
                        key={`${reason.title}-${index}`}
                        className={`
                          rounded-lg
                          border
                          p-3
                          ${getReasonClassName(reason.tone)}
                        `}
                      >
                        <p className="text-sm font-black">
                          {reason.title}
                        </p>
                        <p className="mt-2 text-xs leading-5 opacity-80">
                          {reason.detail}
                        </p>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/40">
                  No hay razon humana calculada para este candidato.
                </p>
              )}
            </DetailSection>

            <DetailSection title="Desglose de costeo">
              {costBreakdown ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-3 text-xs leading-5 text-cyan-50/70">
                    Regla minima: net profit mayor que $0 y margen neto minimo de {formatNumber(
                      costBreakdown.minimum_target_margin_percent,
                      "%"
                    )}. El envio minimo default es $6.99. La promocion eBay es opcional; este advisor permite simular de 0% a 5%.
                  </div>

                  <div className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                        Envio estimado editable
                      </span>
                      <input
                        type="number"
                        min="6.99"
                        step="0.01"
                        value={editableShippingCost}
                        onChange={event =>
                          setEditableShippingCost(
                            event.target.value
                          )
                        }
                        className="
                          mt-2
                          w-full
                          rounded-lg
                          border
                          border-white/10
                          bg-zinc-950
                          px-3
                          py-2
                          text-sm
                          text-white
                          outline-none
                          transition
                          focus:border-cyan-300/50
                        "
                      />
                      <span className="mt-2 block text-xs leading-5 text-white/45">
                        $6.99 es el minimo estandar. Si el producto es pesado o especial, sube este valor para simular el costo real.
                      </span>
                    </label>

                    <label className="block">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                        Promocion eBay editable
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={editablePromotionPercent}
                        onChange={event =>
                          setEditablePromotionPercent(
                            event.target.value
                          )
                        }
                        className="
                          mt-2
                          w-full
                          rounded-lg
                          border
                          border-white/10
                          bg-zinc-950
                          px-3
                          py-2
                          text-sm
                          text-white
                          outline-none
                          transition
                          focus:border-cyan-300/50
                        "
                      />
                      <span className="mt-2 block text-xs leading-5 text-white/45">
                        La promocion no es obligatoria. El calculo limita el advisor a maximo 5%.
                      </span>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">
                        Costo directo IMNOVA
                      </p>
                      <div className="mt-3 space-y-3">
                        <Field
                          label="Costo Luna"
                          value={formatCurrency(
                            displayedCostBreakdown?.luna_cost
                          )}
                        />
                        <Field
                          label="Envio estimado"
                          value={formatCurrency(
                            displayedCostBreakdown?.shipping_cost
                          )}
                        />
                        <Field
                          label="shipping_source"
                          value={costBreakdown.shipping_source}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">
                        Costos marketplace
                      </p>
                      <div className="mt-3 space-y-3">
                        <Field
                          label="Fee eBay"
                          value={`${formatCurrency(
                            displayedCostBreakdown?.ebay_fee_amount
                          )} (${formatNumber(
                            displayedCostBreakdown?.ebay_fee_percent,
                            "%"
                          )})`}
                        />
                        <Field
                          label="Payment fee"
                          value={`${formatCurrency(
                            displayedCostBreakdown?.payment_fee_amount
                          )} (${formatNumber(
                            displayedCostBreakdown?.payment_fee_percent,
                            "%"
                          )})`}
                        />
                        <Field
                          label="Promocion eBay"
                          value={`${formatCurrency(
                            displayedCostBreakdown?.promotion_amount
                          )} (${formatNumber(
                            displayedCostBreakdown?.promotion_percent,
                            "%"
                          )})`}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">
                        Operacion y resultado
                      </p>
                      <div className="mt-3 space-y-3">
                        <Field
                          label="Fulfillment/empaque"
                          value={`${formatCurrency(
                            displayedCostBreakdown?.fulfillment_cost
                          )} / ${formatCurrency(
                            displayedCostBreakdown?.packaging_cost
                          )}`}
                        />
                        <Field
                          label="Reserva/devolucion"
                          value={`${formatCurrency(
                            displayedCostBreakdown?.return_reserve_amount
                          )} (${formatNumber(
                            displayedCostBreakdown?.return_reserve_percent,
                            "%"
                          )})`}
                        />
                        <Field
                          label="Costo total"
                          value={formatCurrency(
                            displayedCostBreakdown?.total_estimated_cost
                          )}
                        />
                        <Field
                          label="Ganancia neta"
                          value={formatCurrency(
                            displayedCostBreakdown?.net_profit
                          )}
                        />
                        <Field
                          label="Margen neto"
                          value={formatNumber(
                            displayedCostBreakdown?.net_margin_percent,
                            "%"
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    className={`
                      rounded-lg
                      border
                      p-3
                      text-xs
                      leading-5
                      ${getReasonClassName(
                        costBreakdown.shipping_review_required
                          ? "warning"
                          : "info"
                      )}
                    `}
                  >
                    {costBreakdown.shipping_note ||
                      "Envio estimado estandar."}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {costScenarios.map(scenario => (
                      <div
                        key={scenario.label}
                        className={`
                          rounded-lg
                          border
                          p-3
                          ${getReasonClassName(
                            scenario.value?.pass_10_percent_margin
                              ? "success"
                              : "danger"
                          )}
                        `}
                      >
                        <p className="text-sm font-black">
                          {scenario.label}
                        </p>
                        <div className="mt-3 space-y-3">
                          <Field
                            label="Promocion"
                            value={formatNumber(
                              scenario.value?.promotion_percent,
                              "%"
                            )}
                          />
                          <Field
                            label="Net profit"
                            value={formatCurrency(
                              scenario.value?.net_profit
                            )}
                          />
                          <Field
                            label="Net margin"
                            value={formatNumber(
                              scenario.value?.net_margin_percent,
                              "%"
                            )}
                          />
                          <Field
                            label="Pasa 10%"
                            value={scenario.value?.pass_10_percent_margin}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label="Break-even"
                      value={formatCurrency(
                        displayedCostBreakdown?.break_even_price
                      )}
                    />
                    <Field
                      label="Minimo 10% margen"
                      value={formatCurrency(
                        displayedCostBreakdown?.minimum_price_for_10_percent_margin
                      )}
                    />
                    <Field
                      label="Precio sugerido"
                      value={formatCurrency(
                        displayedCostBreakdown?.suggested_target_price
                      )}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/40">
                  Sin desglose de costeo calculado.
                </p>
              )}
            </DetailSection>

            <DetailSection title="Profit scenario">
              <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-3 text-xs leading-5 text-cyan-50/70">
                Regla minima: net profit mayor que $0 y net margin minimo de 10%. ROI se muestra como metrica, pero no bloquea minimos en esta configuracion.
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="Sale price"
                  value={formatCurrency(
                    detail.profitScenario?.estimated_sale_price
                  )}
                />
                <Field
                  label="Luna cost"
                  value={formatCurrency(
                    detail.profitScenario?.luna_cost
                  )}
                />
                <Field
                  label="Shipping"
                  value={formatCurrency(
                    detail.profitScenario?.estimated_shipping_cost
                  )}
                />
                <Field
                  label="eBay fee"
                  value={formatCurrency(
                    detail.profitScenario?.estimated_ebay_fee
                  )}
                />
                <Field
                  label="Promo/ads"
                  value={formatCurrency(
                    detail.profitScenario?.estimated_advertising_cost
                  )}
                />
                <Field
                  label="Fulfillment"
                  value={formatCurrency(
                    detail.profitScenario?.fulfillment_cost
                  )}
                />
                <Field
                  label="Packaging"
                  value={formatCurrency(
                    detail.profitScenario?.packaging_cost
                  )}
                />
                <Field
                  label="Return reserve"
                  value={formatCurrency(
                    detail.profitScenario?.return_reserve
                  )}
                />
                <Field
                  label="Total cost"
                  value={formatCurrency(
                    detail.profitScenario?.total_estimated_cost
                  )}
                />
                <Field
                  label="Net profit"
                  value={formatCurrency(
                    detail.profitScenario?.net_profit
                  )}
                />
                <Field
                  label="Net margin"
                  value={formatNumber(
                    detail.profitScenario?.net_margin_percent,
                    "%"
                  )}
                />
                <Field
                  label="ROI"
                  value={formatNumber(
                    detail.profitScenario?.roi_percent,
                    "%"
                  )}
                />
                <Field
                  label="Pass minimums"
                  value={detail.profitScenario?.passes_minimums}
                />
                <Field
                  label="calculated_at"
                  value={formatDate(
                    detail.profitScenario?.calculated_at
                  )}
                />
              </div>
              {targetPriceAdvisor ? (
                <div className="rounded-lg border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-black text-white">
                        Precio sugerido para profit
                      </p>
                      <p className="mt-2 max-w-2xl text-xs leading-5 text-white/50">
                        El precio actual no es rentable. Para lograr {formatNumber(
                          targetPriceAdvisor.minimum_target_margin_percent,
                          "%"
                        )} de margen neto, IMNOVA necesita vender aproximadamente a {formatCurrency(
                          targetPriceAdvisor.suggested_target_price
                        )}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onReprocessSuggestedPrice(detail)
                      }
                      disabled={
                        isReprocessing ||
                        !canReprocessSuggestedPrice
                      }
                      className="
                        inline-flex
                        items-center
                        justify-center
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
                        disabled:opacity-50
                      "
                    >
                      <RefreshCw
                        className={`
                          h-4
                          w-4
                          ${isReprocessing ? "animate-spin" : ""}
                        `}
                      />
                      {isReprocessing
                        ? "Reevaluando"
                        : "Reevaluar con precio sugerido"}
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <Field
                      label="Precio actual"
                      value={formatCurrency(
                        targetPriceAdvisor.current_sale_price
                      )}
                    />
                    <Field
                      label="Minimo 10% margen"
                      value={formatCurrency(
                        targetPriceAdvisor.minimum_profitable_price
                      )}
                    />
                    <Field
                      label="Precio ideal sugerido"
                      value={formatCurrency(
                        targetPriceAdvisor.suggested_target_price
                      )}
                    />
                    <Field
                      label="Precio ideal opcional"
                      value={formatCurrency(
                        targetPriceAdvisor.ideal_target_price
                      )}
                    />
                    <Field
                      label="Mercado PI"
                      value={`${marketReferenceLabel}: ${formatCurrency(
                        marketReferencePrice
                      )}`}
                    />
                    <Field
                      label="Diferencia vs mercado"
                      value={formatCurrency(
                        suggestedMarketDifference
                      )}
                    />
                  </div>

                  <div
                    className={`
                      mt-4
                      rounded-lg
                      border
                      p-3
                      text-xs
                      leading-5
                      ${getReasonClassName(suggestedPriceTone)}
                    `}
                  >
                    {suggestedPriceMarketMessage}
                  </div>
                  {hasLowConfidence ? (
                    <p className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/[0.10] px-3 py-2 text-xs text-amber-100">
                      Confidence bajo: hace falta mejor evidencia antes de tomar decision comercial.
                    </p>
                  ) : null}
                  {!canReprocessSuggestedPrice ? (
                    <p className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/[0.10] px-3 py-2 text-xs text-amber-100">
                      La reevaluacion con precio sugerido queda deshabilitada hasta que Price Intelligence indique que el precio esta dentro del mercado.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <JsonPreview
                value={detail.profitScenario?.assumptions}
              />
            </DetailSection>

            <DetailSection title="Price Intelligence">
              {detail.priceIntelligence ? (
                <>
                  <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">
                          Reevaluar con Price Intelligence
                        </p>
                        <p className="mt-2 text-xs leading-5 text-white/50">
                          Usara el precio recomendado guardado como estimated_sale_price.
                        </p>
                        {hasLowConfidence ? (
                          <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/[0.10] px-2 py-1 text-xs text-amber-100">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Evidencia de precio con baja confianza.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onReprocess(detail)
                        }
                        disabled={
                          isReprocessing ||
                          recommendedSalePrice === null
                        }
                        className="
                          inline-flex
                          items-center
                          justify-center
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
                          disabled:opacity-50
                        "
                      >
                        <RefreshCw
                          className={`
                            h-4
                            w-4
                            ${isReprocessing ? "animate-spin" : ""}
                          `}
                        />
                        {isReprocessing
                          ? "Reevaluando"
                          : "Reevaluar con Price Intelligence"}
                      </button>
                    </div>
                    {recommendedSalePrice === null ? (
                      <p className="mt-3 text-xs leading-5 text-amber-100/75">
                        Este snapshot no tiene recommended_sale_price.
                      </p>
                    ) : null}
                    {reprocessStatus ? (
                      <p
                        className={`
                          mt-3
                          rounded-md
                          border
                          px-3
                          py-2
                          text-xs
                          ${
                            reprocessStatus.status === "success"
                              ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
                              : "border-red-300/20 bg-red-300/[0.08] text-red-100"
                          }
                        `}
                      >
                        {reprocessStatus.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label="recommended_sale_price"
                      value={formatCurrency(
                        detail.priceIntelligence.recommended_sale_price
                      )}
                    />
                    <Field
                      label="source_type"
                      value={detail.priceIntelligence.source_type}
                    />
                    <Field
                      label="source_confidence"
                      value={detail.priceIntelligence.source_confidence}
                    />
                    <Field
                      label="confidence_score"
                      value={formatNumber(
                        detail.priceIntelligence.confidence_score
                      )}
                    />
                    <Field
                      label="sold_median"
                      value={formatCurrency(
                        detail.priceIntelligence.sold_median_price
                      )}
                    />
                    <Field
                      label="sold_avg"
                      value={formatCurrency(
                        detail.priceIntelligence.sold_avg_price
                      )}
                    />
                    <Field
                      label="sold_range"
                      value={`${formatCurrency(
                        detail.priceIntelligence.sold_min_price
                      )} - ${formatCurrency(
                        detail.priceIntelligence.sold_max_price
                      )}`}
                    />
                    <Field
                      label="sold_comp_count"
                      value={detail.priceIntelligence.sold_comp_count}
                    />
                    <Field
                      label="active_avg"
                      value={formatCurrency(
                        detail.priceIntelligence.active_avg_price
                      )}
                    />
                    <Field
                      label="active_range"
                      value={`${formatCurrency(
                        detail.priceIntelligence.active_min_price
                      )} - ${formatCurrency(
                        detail.priceIntelligence.active_max_price
                      )}`}
                    />
                    <Field
                      label="active_comp_count"
                      value={detail.priceIntelligence.active_comp_count}
                    />
                    <Field
                      label="estimated_shipping"
                      value={formatCurrency(
                        detail.priceIntelligence.estimated_shipping_cost
                      )}
                    />
                    <Field
                      label="category"
                      value={
                        detail.priceIntelligence.category_name ||
                        detail.priceIntelligence.category_id
                      }
                    />
                    <Field
                      label="match_type"
                      value={detail.priceIntelligence.product_match_type}
                    />
                    <Field
                      label="created_at"
                      value={formatDate(
                        detail.priceIntelligence.created_at
                      )}
                    />
                  </div>
                  <Field
                    label="search_query"
                    value={detail.priceIntelligence.search_query}
                  />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                      evidence_url
                    </p>
                    {isSafeHttpUrl(
                      detail.priceIntelligence.evidence_url
                    ) ? (
                      <a
                        href={detail.priceIntelligence.evidence_url || ""}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex break-all text-sm font-semibold text-cyan-100 hover:text-cyan-50"
                      >
                        {detail.priceIntelligence.evidence_url}
                      </a>
                    ) : (
                      <p className="mt-1 break-words text-sm text-white/70">
                        {detail.priceIntelligence.evidence_url || "-"}
                      </p>
                    )}
                  </div>
                  <Field
                    label="evidence_notes"
                    value={detail.priceIntelligence.evidence_notes}
                  />
                </>
              ) : (
                <p className="text-sm text-white/40">
                  Sin evidencia Price Intelligence registrada.
                </p>
              )}
            </DetailSection>

            <DetailSection title="Compliance findings">
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="overall_status"
                  value={detail.compliance?.overall_status}
                />
                <Field
                  label="blocker_count"
                  value={detail.compliance?.blocker_count}
                />
                <Field
                  label="checked_at"
                  value={formatDate(
                    detail.compliance?.checked_at
                  )}
                />
              </div>
              <JsonPreview
                value={detail.compliance?.findings}
              />
            </DetailSection>

            <DetailSection title="Score breakdown">
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="winner_score"
                  value={formatNumber(
                    detail.score?.winner_score
                  )}
                />
                <Field
                  label="demand"
                  value={formatNumber(
                    detail.score?.demand_score
                  )}
                />
                <Field
                  label="profitability"
                  value={formatNumber(
                    detail.score?.profitability_score
                  )}
                />
                <Field
                  label="competition"
                  value={formatNumber(
                    detail.score?.competition_score
                  )}
                />
                <Field
                  label="stock_stability"
                  value={formatNumber(
                    detail.score?.stock_stability_score
                  )}
                />
                <Field
                  label="data_quality"
                  value={formatNumber(
                    detail.score?.data_quality_score
                  )}
                />
                <Field
                  label="operational_risk"
                  value={formatNumber(
                    detail.score?.inverse_operational_risk_score
                  )}
                />
              </div>
              <Field
                label="explanation"
                value={detail.score?.explanation}
              />
              <JsonPreview
                value={detail.score?.score_payload}
              />
            </DetailSection>

            <DetailSection title="Validation">
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="validation_status"
                  value={detail.validation?.validation_status}
                />
                <Field
                  label="validated_at"
                  value={formatDate(
                    detail.validation?.validated_at
                  )}
                />
              </div>
              <JsonPreview
                value={{
                  required_fields:
                    detail.validation?.required_fields,
                  missing_fields:
                    detail.validation?.missing_fields,
                  critical_reasons:
                    detail.validation?.critical_reasons,
                }}
              />
            </DetailSection>

            <DetailSection title="Decisions">
              {(detail.decisions || []).length > 0 ? (
                <div className="space-y-3">
                  {(detail.decisions || []).map(
                    (decision, index) => (
                      <div
                        key={`${decision.decided_at || index}`}
                        className="rounded-lg border border-white/10 bg-black/25 p-3"
                      >
                        <div className="grid gap-3 md:grid-cols-3">
                          <Field
                            label="decision"
                            value={decision.decision}
                          />
                          <Field
                            label="channel"
                            value={decision.decision_channel}
                          />
                          <Field
                            label="decided_at"
                            value={formatDate(
                              decision.decided_at
                            )}
                          />
                        </div>
                        <div className="mt-3">
                          <JsonPreview
                            value={decision.decision_payload}
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/40">
                  Sin decisiones registradas.
                </p>
              )}
            </DetailSection>

            <DetailSection title="Local draft">
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="draft_status"
                  value={detail.localDraft?.draft_status}
                />
                <Field
                  label="dry_run_only"
                  value={detail.localDraft?.dry_run_only}
                />
                <Field
                  label="ebay_draft_id"
                  value={
                    detail.localDraft?.ebay_draft_id ||
                    "null"
                  }
                />
                <Field
                  label="price"
                  value={formatCurrency(
                    detail.localDraft?.price
                  )}
                />
                <Field
                  label="quantity"
                  value={detail.localDraft?.quantity}
                />
                <Field
                  label="category_id"
                  value={detail.localDraft?.category_id}
                />
              </div>
              <Field
                label="description_html"
                value={detail.localDraft?.description_html}
              />
              <JsonPreview
                value={{
                  image_urls:
                    detail.localDraft?.image_urls,
                  aspects:
                    detail.localDraft?.aspects,
                  shipping_policy:
                    detail.localDraft?.shipping_policy,
                  return_policy:
                    detail.localDraft?.return_policy,
                  payment_policy:
                    detail.localDraft?.payment_policy,
                }}
              />
            </DetailSection>

            <DetailSection title="Audit log">
              {(detail.auditLog || []).length > 0 ? (
                <div className="space-y-3">
                  {(detail.auditLog || []).map(
                    (event, index) => (
                      <div
                        key={`${event.created_at || index}`}
                        className="rounded-lg border border-white/10 bg-black/25 p-3"
                      >
                        <div className="grid gap-3 md:grid-cols-4">
                          <Field
                            label="event"
                            value={event.event_type}
                          />
                          <Field
                            label="from"
                            value={event.from_state}
                          />
                          <Field
                            label="to"
                            value={event.to_state}
                          />
                          <Field
                            label="created_at"
                            value={formatDate(
                              event.created_at
                            )}
                          />
                        </div>
                        <div className="mt-3">
                          <JsonPreview
                            value={event.payload}
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/40">
                  Sin eventos de auditoria.
                </p>
              )}
            </DetailSection>
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-white/50">
            No se encontro detalle para este candidato.
          </div>
        )}
      </aside>
    </div>
  )
}

export function EbayWinnerPipelinePanel() {
  const [
    dashboard,
    setDashboard,
  ] = useState<EbayDashboard | null>(null)

  const [
    isLoading,
    setIsLoading,
  ] = useState(true)

  const [
    error,
    setError,
  ] = useState("")

  const [
    stateFilter,
    setStateFilter,
  ] = useState("")

  const [
    complianceFilter,
    setComplianceFilter,
  ] = useState("")

  const [
    draftFilter,
    setDraftFilter,
  ] = useState("")

  const [
    search,
    setSearch,
  ] = useState("")

  const [
    page,
    setPage,
  ] = useState(0)

  const [
    selectedCandidateId,
    setSelectedCandidateId,
  ] = useState("")

  const [
    detail,
    setDetail,
  ] = useState<EbayCandidateDetail | null>(null)

  const [
    isDetailLoading,
    setIsDetailLoading,
  ] = useState(false)

  const [
    isReprocessing,
    setIsReprocessing,
  ] = useState(false)

  const [
    reprocessStatus,
    setReprocessStatus,
  ] = useState<ReprocessStatus | null>(null)

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

  const buildDashboardUrl =
    useCallback(() => {
      const params =
        new URLSearchParams()

      params.set(
        "page",
        String(page)
      )
      params.set(
        "limit",
        "25"
      )

      if (stateFilter) {
        params.set(
          "state",
          stateFilter
        )
      }

      if (complianceFilter) {
        params.set(
          "complianceStatus",
          complianceFilter
        )
      }

      if (draftFilter) {
        params.set(
          "draftStatus",
          draftFilter
        )
      }

      if (search.trim()) {
        params.set(
          "search",
          search.trim()
        )
      }

      return `/api/admin/ebay-winner-pipeline/dashboard?${params.toString()}`
    }, [
      complianceFilter,
      draftFilter,
      page,
      search,
      stateFilter,
    ])

  const requestJson =
    useCallback(async (
      url: string
    ) => {
      const token =
        await getAccessToken()

      const response =
        await fetch(
          url,
          {
            method:
              "GET",
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        )

      const payload =
        await response.json() as EbayDashboardResponse

      if (
        !response.ok ||
        !payload.success
      ) {
        throw new Error(
          payload.error ||
          "No se pudo cargar eBay Pipeline."
        )
      }

      return payload
    }, [getAccessToken])

  const loadDashboard =
    useCallback(async () => {
      setIsLoading(true)
      setError("")

      try {
        const payload =
          await requestJson(
            buildDashboardUrl()
          )

        setDashboard(
          payload.dashboard || null
        )
      } catch (loadError) {
        console.error(
          "LOAD EBAY WINNER ADMIN ERROR:",
          loadError
        )

        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar eBay Pipeline."
        )
      } finally {
        setIsLoading(false)
      }
    }, [
      buildDashboardUrl,
      requestJson,
    ])

  const loadDetail =
    useCallback(async (
      candidateId: string
    ) => {
      setSelectedCandidateId(
        candidateId
      )
      setDetail(null)
      setReprocessStatus(null)
      setIsDetailLoading(true)
      setError("")

      try {
        const params =
          new URLSearchParams({
            candidateId,
          })

        const payload =
          await requestJson(
            `/api/admin/ebay-winner-pipeline/dashboard?${params.toString()}`
          )

        setDetail(
          payload.detail || null
        )
      } catch (detailError) {
        console.error(
          "LOAD EBAY WINNER DETAIL ERROR:",
          detailError
        )

        setError(
          detailError instanceof Error
            ? detailError.message
            : "No se pudo cargar el detalle."
        )
      } finally {
        setIsDetailLoading(false)
      }
    }, [requestJson])

  const reprocessWithPriceIntelligence =
    useCallback(async (
      currentDetail: EbayCandidateDetail
    ) => {
      const snapshot =
        currentDetail.priceIntelligence

      if (
        !snapshot ||
        toNumber(snapshot.recommended_sale_price) === null
      ) {
        setReprocessStatus({
          status:
            "error",
          message:
            "Falta recommended_sale_price para reevaluar.",
        })
        return
      }

      setIsReprocessing(true)
      setReprocessStatus(null)
      setError("")

      try {
        const token =
          await getAccessToken()

        const response =
          await fetch(
            "/api/admin/ebay-winner-pipeline/price-intelligence/reprocess",
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
                  candidateId:
                    currentDetail.candidate.id,
                  supplierSku:
                    currentDetail.candidate.supplier_sku,
                  candidateKey:
                    currentDetail.candidate.candidate_key,
                  priceIntelligenceSnapshotId:
                    snapshot.id,
                }),
            }
          )

        const payload =
          await response.json() as {
            success?: boolean
            error?: string
          }

        if (
          !response.ok ||
          !payload.success
        ) {
          throw new Error(
            payload.error ||
            "No se pudo reevaluar con Price Intelligence."
          )
        }

        await loadDetail(
          currentDetail.candidate.id
        )
        await loadDashboard()

        setReprocessStatus({
          status:
            "success",
          message:
            "Candidato reevaluado con Price Intelligence.",
        })
      } catch (reprocessError) {
        console.error(
          "REPROCESS PRICE INTELLIGENCE ERROR:",
          reprocessError
        )

        setReprocessStatus({
          status:
            "error",
          message:
            reprocessError instanceof Error
              ? reprocessError.message
              : "No se pudo reevaluar con Price Intelligence.",
        })
      } finally {
        setIsReprocessing(false)
      }
    }, [
      getAccessToken,
      loadDashboard,
      loadDetail,
    ])

  const reprocessWithSuggestedPrice =
    useCallback(async (
      currentDetail: EbayCandidateDetail
    ) => {
      const assumptions =
        currentDetail.profitScenario?.assumptions &&
        typeof currentDetail.profitScenario.assumptions === "object"
          ? currentDetail.profitScenario.assumptions as ProfitAssumptions
          : {}

      const suggestedTargetPrice =
        toNumber(
          assumptions.targetPriceAdvisor?.suggested_target_price
        )

      if (suggestedTargetPrice === null) {
        setReprocessStatus({
          status:
            "error",
          message:
            "Falta suggested_target_price para reevaluar.",
        })
        return
      }

      setIsReprocessing(true)
      setReprocessStatus(null)
      setError("")

      try {
        const token =
          await getAccessToken()

        const response =
          await fetch(
            "/api/admin/ebay-winner-pipeline/price-intelligence/reprocess",
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
                    "reprocess_with_suggested_price",
                  candidateId:
                    currentDetail.candidate.id,
                  supplierSku:
                    currentDetail.candidate.supplier_sku,
                  candidateKey:
                    currentDetail.candidate.candidate_key,
                  suggestedTargetPrice,
                }),
            }
          )

        const payload =
          await response.json() as {
            success?: boolean
            error?: string
          }

        if (
          !response.ok ||
          !payload.success
        ) {
          throw new Error(
            payload.error ||
            "No se pudo reevaluar con precio sugerido."
          )
        }

        await loadDetail(
          currentDetail.candidate.id
        )
        await loadDashboard()

        setReprocessStatus({
          status:
            "success",
          message:
            "Candidato reevaluado con precio sugerido.",
        })
      } catch (reprocessError) {
        console.error(
          "REPROCESS SUGGESTED PRICE ERROR:",
          reprocessError
        )

        setReprocessStatus({
          status:
            "error",
          message:
            reprocessError instanceof Error
              ? reprocessError.message
              : "No se pudo reevaluar con precio sugerido.",
        })
      } finally {
        setIsReprocessing(false)
      }
    }, [
      getAccessToken,
      loadDashboard,
      loadDetail,
    ])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const summary =
    dashboard?.summary

  const candidates =
    dashboard?.candidates || []

  const pagination =
    dashboard?.pagination

  const realDraftWarning =
    (summary?.realEbayDraftsDetected || 0) > 0

  const pageLabel =
    useMemo(
      () =>
        pagination
          ? `${pagination.page + 1} / ${Math.max(
              1,
              Math.ceil(
                pagination.total /
                  pagination.limit
              )
            )}`
          : "1 / 1",
      [pagination]
    )

  return (
    <div className="mt-16 space-y-6">
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
              eBay Winner Pipeline
            </p>
            <h2 className="mt-3 text-3xl font-black text-white">
              Admin read-only
            </h2>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-1 text-emerald-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Dry run only
              </span>
              <span>
                Solo lecturas GET protegidas
              </span>
              <span>
                Ultima carga: {formatDate(new Date().toISOString())}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={loadDashboard}
            disabled={isLoading}
            className="
              inline-flex
              items-center
              justify-center
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
            Refresh
          </button>
        </div>

        {realDraftWarning && (
          <div
            className="
              mt-5
              rounded-lg
              border
              border-red-300/25
              bg-red-300/[0.08]
              p-4
              text-sm
              text-red-100
            "
          >
            Se detectaron IDs de draft externo. Revisar antes de cualquier siguiente fase.
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
          title="Candidates"
          value={summary?.totalCandidates || 0}
          detail="Total detectado"
          icon={ClipboardList}
        />
        <MetricCard
          title="Validated"
          value={summary?.validated || 0}
          detail="Listos para revision"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Draft created"
          value={summary?.draftCreated || 0}
          detail="Estado local"
          icon={PackageCheck}
        />
        <MetricCard
          title="Blocked / data"
          value={summary?.blockedNeedsData || 0}
          detail="Requieren atencion"
          icon={AlertTriangle}
        />
        <MetricCard
          title="Local drafts"
          value={summary?.localDrafts || 0}
          detail="dry_run_only"
          icon={FileSearch}
        />
        <MetricCard
          title="Real drafts"
          value={summary?.realEbayDraftsDetected || 0}
          detail="Debe permanecer en 0"
          icon={ShieldCheck}
          isWarning={realDraftWarning}
        />
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
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
              State
            </span>
            <select
              value={stateFilter}
              onChange={(event) => {
                setPage(0)
                setStateFilter(
                  event.target.value
                )
              }}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
            >
              {candidateStateOptions.map(
                option => (
                  <option
                    key={option || "all"}
                    value={option}
                  >
                    {option || "Todos"}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
              Compliance
            </span>
            <select
              value={complianceFilter}
              onChange={(event) => {
                setPage(0)
                setComplianceFilter(
                  event.target.value
                )
              }}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
            >
              {complianceOptions.map(
                option => (
                  <option
                    key={option || "all"}
                    value={option}
                  >
                    {option || "Todos"}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
              Draft
            </span>
            <select
              value={draftFilter}
              onChange={(event) => {
                setPage(0)
                setDraftFilter(
                  event.target.value
                )
              }}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/35"
            >
              {draftOptions.map(
                option => (
                  <option
                    key={option || "all"}
                    value={option}
                  >
                    {option || "Todos"}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
              Search
            </span>
            <input
              value={search}
              onChange={(event) => {
                setPage(0)
                setSearch(
                  event.target.value
                )
              }}
              placeholder="SKU, titulo o key"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-300/35"
            />
          </label>
        </div>
      </section>

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
              Candidates
            </p>
            <h3 className="mt-2 text-xl font-black text-white">
              eBay winner candidates
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/45">
            <button
              type="button"
              onClick={() =>
                setPage(
                  Math.max(
                    0,
                    page - 1
                  )
                )
              }
              disabled={page === 0 || isLoading}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 transition hover:border-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Pagina anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-20 text-center">
              {pageLabel}
            </span>
            <button
              type="button"
              onClick={() =>
                setPage(page + 1)
              }
              disabled={!pagination?.hasNextPage || isLoading}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 transition hover:border-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Pagina siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1260px] border-collapse text-left">
            <thead className="bg-white/[0.035] text-[10px] uppercase tracking-[0.16em] text-white/35">
              <tr>
                <th className="px-4 py-3">state</th>
                <th className="px-4 py-3">supplier_sku</th>
                <th className="px-4 py-3">title</th>
                <th className="px-4 py-3">winner_score</th>
                <th className="px-4 py-3">net_profit</th>
                <th className="px-4 py-3">margin</th>
                <th className="px-4 py-3">ROI</th>
                <th className="px-4 py-3">compliance</th>
                <th className="px-4 py-3">draft_status</th>
                <th className="px-4 py-3">dry_run_only</th>
                <th className="px-4 py-3">ebay_draft_id</th>
                <th className="px-4 py-3">last_evaluated_at</th>
                <th className="px-4 py-3">detalle</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-10 text-center text-sm text-white/45"
                  >
                    Cargando candidatos...
                  </td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-10 text-center text-sm text-white/45"
                  >
                    Sin candidatos para los filtros actuales.
                  </td>
                </tr>
              ) : (
                candidates.map(candidate => (
                  <tr
                    key={candidate.id}
                    className="border-b border-white/5 align-top"
                  >
                    <td className="px-4 py-4">
                      <StatusBadge
                        value={candidate.state}
                        className={getStateClassName(
                          candidate.state
                        )}
                      />
                    </td>
                    <td className="px-4 py-4 text-xs font-semibold text-white/70">
                      {candidate.supplier_sku || "-"}
                    </td>
                    <td className="max-w-[260px] px-4 py-4">
                      <p className="line-clamp-2 text-sm font-semibold leading-5 text-white">
                        {candidate.title}
                      </p>
                      <p className="mt-2 line-clamp-1 text-[11px] text-white/35">
                        {candidate.candidate_key}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm font-black text-white">
                      {formatNumber(
                        candidate.score?.winner_score
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-white">
                      {formatCurrency(
                        candidate.profitScenario?.net_profit
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-white/65">
                      {formatNumber(
                        candidate.profitScenario?.net_margin_percent,
                        "%"
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-white/65">
                      {formatNumber(
                        candidate.profitScenario?.roi_percent,
                        "%"
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        value={candidate.compliance?.overall_status}
                        className={getComplianceClassName(
                          candidate.compliance?.overall_status
                        )}
                      />
                    </td>
                    <td className="px-4 py-4 text-xs text-white/55">
                      {candidate.draft?.draft_status || "Sin draft"}
                    </td>
                    <td className="px-4 py-4 text-xs text-white/55">
                      {candidate.draft
                        ? String(
                            candidate.draft.dry_run_only
                          )
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-xs text-white/55">
                      {candidate.draft?.ebay_draft_id ? (
                        <span className="text-red-100">
                          {candidate.draft.ebay_draft_id}
                        </span>
                      ) : (
                        "null"
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs leading-5 text-white/45">
                      {formatDate(
                        candidate.last_evaluated_at
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() =>
                          loadDetail(
                            candidate.id
                          )
                        }
                        className="
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
                        "
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCandidateId && (
        <CandidateDetailDrawer
          detail={detail}
          isLoading={isDetailLoading}
          isReprocessing={isReprocessing}
          reprocessStatus={reprocessStatus}
          onReprocess={reprocessWithPriceIntelligence}
          onReprocessSuggestedPrice={reprocessWithSuggestedPrice}
          onClose={() => {
            setSelectedCandidateId("")
            setDetail(null)
            setReprocessStatus(null)
          }}
        />
      )}
    </div>
  )
}
