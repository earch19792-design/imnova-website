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

function CandidateDetailDrawer({
  detail,
  isLoading,
  onClose,
}: {
  detail: EbayCandidateDetail | null
  isLoading: boolean
  onClose: () => void
}) {
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
              Detalle read-only
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

            <DetailSection title="Profit scenario">
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="sale_price"
                  value={formatCurrency(
                    detail.profitScenario?.estimated_sale_price
                  )}
                />
                <Field
                  label="luna_cost"
                  value={formatCurrency(
                    detail.profitScenario?.luna_cost
                  )}
                />
                <Field
                  label="total_cost"
                  value={formatCurrency(
                    detail.profitScenario?.total_estimated_cost
                  )}
                />
                <Field
                  label="net_profit"
                  value={formatCurrency(
                    detail.profitScenario?.net_profit
                  )}
                />
                <Field
                  label="margin"
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
                  label="passes_minimums"
                  value={detail.profitScenario?.passes_minimums}
                />
                <Field
                  label="calculated_at"
                  value={formatDate(
                    detail.profitScenario?.calculated_at
                  )}
                />
              </div>
              <JsonPreview
                value={detail.profitScenario?.assumptions}
              />
            </DetailSection>

            <DetailSection title="Price Intelligence">
              {detail.priceIntelligence ? (
                <>
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
          onClose={() => {
            setSelectedCandidateId("")
            setDetail(null)
          }}
        />
      )}
    </div>
  )
}
