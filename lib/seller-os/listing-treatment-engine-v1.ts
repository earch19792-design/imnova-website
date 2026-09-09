import type { CommercialListingReadModel, Observation } from "../ebay/commercial-monitor-readonly-contract"

export const LISTING_TREATMENT_ENGINE_V1 = "SELLER_OS_ASSISTANT_LISTING_TREATMENT_ENGINE_V1"
export const PROMOTION_PROFIT_GUARD_V1 = "SELLER_OS_PROMOTION_PROFIT_GUARD_V1"
export const TREATMENT_RECEIPT_V1 = "SELLER_OS_ASSISTANT_TREATMENT_RECEIPT_V1"
export const PROMOTION_CONTROL_V1 = "SELLER_OS_ASSISTANT_REVENUE_PROMOTION_CONTROL_V1"
export const FRIENDLY_MENU_V1 = "ASSISTANT_FRIENDLY_MENU_V1"
export const MAX_TREATMENT_LISTINGS = 20
export const METRIC_WINDOWS = ["24H", "7D", "30D"] as const
export type MetricWindow = typeof METRIC_WINDOWS[number]
export const FRIENDLY_ACTIONS = ["✨ Mejorar listings", "🚀 Impulsar ventas", "📦 Publicar", "📊 Oportunidades"] as const
export type Treatment = "SCALE" | "OPTIMIZE" | "TEST" | "RESTOCK" | "HOLD" | "PROFIT_PROTECT"
export const TREATMENT_LABELS: Record<Treatment, string> = { SCALE: "🚀 Impulsar", OPTIMIZE: "✨ Mejorar", TEST: "🧪 Obtener más datos", RESTOCK: "📦 Reponer", HOLD: "⏸ Esperar", PROFIT_PROTECT: "💰 Proteger margen" }
export type ProvenAmount = { value: number | null; reference: string | null; fresh: boolean }
export type Economics = Record<"salePrice" | "productCost" | "shippingCost" | "ebayFees" | "otherCosts" | "adFeeBasis", ProvenAmount>
export type PromotionPolicy = { mode: "OFF" | "MANUAL" | "AUTO"; minRate: number; maxRate: number; minProfit: number; minMargin: number;
  window: "NOW" | "WEEKEND" | "SCHEDULE"; timeZone: string; startsAt: string | null; endsAt: string | null }
export const SIMULATION_SAFETY = Object.freeze({ marketplaceWrites: 0, ebayAdsWrites: 0, ebayAdsWriteEnabled: false, newPollers: 0, newWorkers: 0 })
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)
const cents = (n: number) => Math.round(n * 100) / 100
const down = (n: number) => Math.floor(n * 100 + 1e-9) / 100
const proven = (v: ProvenAmount) => valid(v.value) && v.value >= 0 && v.fresh && Boolean(v.reference)

export function scheduledLocalTimeV1(local: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !timeZone) throw Error("PROMOTION_EXPLICIT_WINDOW_REQUIRED")
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const wall = (timestamp: number) => { const parts = Object.fromEntries(format.formatToParts(new Date(timestamp)).map(p => [p.type, p.value])); return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` }
  const base = Date.parse(`${local}:00Z`)
  if (!Number.isFinite(base)) throw Error("PROMOTION_EXPLICIT_WINDOW_REQUIRED")
  // Enumerate legal quarter-hour UTC offsets, including both sides of a DST fold.
  // A nonexistent or ambiguous local time is rejected, never silently shifted.
  const matches = []
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = base + offset * 60000
    if (wall(candidate) === local) matches.push(candidate)
  }
  if (matches.length !== 1) throw Error("PROMOTION_LOCAL_TIME_AMBIGUOUS_OR_INVALID")
  return new Date(matches[0]).toISOString()
}

export function validatePromotionPolicyV1(p: PromotionPolicy) {
  if (!p || ![p.minRate, p.maxRate, p.minProfit, p.minMargin].every(valid) ||
      p.minRate < 0 || p.maxRate > 100 || p.minRate > p.maxRate || p.minProfit < 0 ||
      p.minMargin < 0 || p.minMargin > 100 || !["OFF", "MANUAL", "AUTO"].includes(p.mode) ||
      !["NOW", "WEEKEND", "SCHEDULE"].includes(p.window)) throw Error("PROMOTION_POLICY_INVALID")
  try { new Intl.DateTimeFormat("en", { timeZone: p.timeZone }).format() } catch { throw Error("PROMOTION_TIMEZONE_REQUIRED") }
  if (!p.timeZone) throw Error("PROMOTION_TIMEZONE_REQUIRED")
  if (p.window !== "NOW") {
    if (!p.startsAt || !p.endsAt || !Number.isFinite(Date.parse(p.startsAt)) ||
        !(Date.parse(p.endsAt) > Date.parse(p.startsAt))) throw Error("PROMOTION_EXPLICIT_WINDOW_REQUIRED")
    if (p.window === "WEEKEND") {
      const day = new Intl.DateTimeFormat("en", { timeZone: p.timeZone, weekday: "short" })
      if (!["Fri", "Sat"].includes(day.format(new Date(p.startsAt))) ||
          !["Sun", "Mon"].includes(day.format(new Date(p.endsAt))) ||
          Date.parse(p.endsAt) - Date.parse(p.startsAt) > 4 * 86400000) throw Error("PROMOTION_WEEKEND_WINDOW_INVALID")
    }
  }
  return p
}

export function listingEconomicsV1(e: Economics) {
  const keys = ["salePrice", "productCost", "shippingCost", "ebayFees", "otherCosts"] as const
  const missing = keys.filter(key => !proven(e[key]))
  const profitBeforeAds = missing.length ? null : down(e.salePrice.value! - e.productCost.value! - e.shippingCost.value! - e.ebayFees.value! - e.otherCosts.value!)
  return { components: e, economicsUnproven: missing.length > 0 || !(e.salePrice.value! > 0), missing,
    profitBeforeAds, marginBeforeAds: profitBeforeAds !== null && e.salePrice.value! > 0 ? profitBeforeAds / e.salePrice.value! * 100 : null }
}

export function promotionProfitGuardV1(e: Economics, policy: PromotionPolicy) {
  validatePromotionPolicyV1(policy)
  const economics = listingEconomicsV1(e)
  const base = { contractVersion: PROMOTION_PROFIT_GUARD_V1, ...economics,
    maxSafeAdRate: null as number | null, recommendedAdRate: null as number | null,
    projectedAdCost: null as number | null, projectedProfitAfterAds: null as number | null,
    projectedMarginAfterAds: null as number | null, projectionUnit: "ONE_ATTRIBUTED_SALE" as const }
  if (economics.economicsUnproven || !proven(e.adFeeBasis) || e.adFeeBasis.value! < e.salePrice.value!)
    return { ...base, status: "BLOCKED_EVIDENCE" as const }
  const floor = Math.max(policy.minProfit, e.salePrice.value! * policy.minMargin / 100)
  const room = economics.profitBeforeAds! - floor
  const maxSafeAdRate = Math.max(0, Math.min(100, down(room / e.adFeeBasis.value! * 100)))
  const rate = Math.min(policy.maxRate, maxSafeAdRate)
  // Round cost upwards and recheck the actual cents charged; never round a rate up.
  const projectedAdCost = Math.ceil((e.adFeeBasis.value! * rate / 100 - 1e-9) * 100) / 100
  const projectedProfitAfterAds = cents(economics.profitBeforeAds! - projectedAdCost)
  const projectedMarginAfterAds = projectedProfitAfterAds / e.salePrice.value! * 100
  const blocked = room < 0 || maxSafeAdRate < policy.minRate || projectedProfitAfterAds + 1e-9 < policy.minProfit || projectedMarginAfterAds + 1e-9 < policy.minMargin
  return { ...base, maxSafeAdRate, recommendedAdRate: blocked ? null : rate,
    projectedAdCost: blocked ? null : projectedAdCost,
    projectedProfitAfterAds: blocked ? null : projectedProfitAfterAds,
    projectedMarginAfterAds: blocked ? null : projectedMarginAfterAds,
    status: blocked ? "BLOCKED_MARGIN" as const : policy.mode === "OFF" ? "OFF" as const : "SIMULATION_READY" as const }
}

export function projectListingMetricsV1(listing: CommercialListingReadModel) {
  const source = { impressions: listing.metrics.impressions, views: listing.metrics.ebay_views,
    ctr: listing.metrics.ctr_reported, unitsSold: listing.metrics.units_sold,
    conversion: listing.metrics.conversion, salesRevenue: listing.metrics.revenue }
  const metric = (o: Observation<number> | undefined, window: MetricWindow) => {
    const w = o?.reportingWindow
    const duration = w ? Date.parse(w.end) - Date.parse(w.start) : NaN
    const hours = { "24H": 24, "7D": 168, "30D": 720 }[window]
    const exact = o?.identity.itemId === listing.identity.itemId && o?.availability === "AVAILABLE" &&
      valid(o.value) && duration === hours * 3600000 && Boolean(o.source.evidenceReference)
    return { value: exact ? o!.value : null, reference: o?.source.evidenceReference ?? null,
      window: w ?? null, freshness: o?.freshness.status ?? "UNKNOWN",
      reason: exact ? null : "EXACT_ITEM_WINDOW_EVIDENCE_REQUIRED" }
  }
  return { itemId: listing.identity.itemId, windows: Object.fromEntries(METRIC_WINDOWS.map(window => [window,
    { ...(Object.fromEntries(Object.entries(source).map(([key, value]) => [key, metric(value, window)])) as Record<keyof typeof source, ReturnType<typeof metric>>),
      clicks: null, trafficTrend: null, conversionTrend: null, promotedImpressions: null, promotedClicks: null,
      adSpend: null, adAttributedSales: null, roas: null }])),
    inventory: listing.stock.quantity, listingAge: listing.identity.startTime,
    sourceObservations: source, unavailableValuesInvented: false }
}

// Assessments must come from an exact listing/window, with a contracted sample
// sufficiency rule and a provenance reference. No universal CTR cutoff exists here.
export type FunnelEvidence = { itemId: string; window: MetricWindow;
  basis: "OWN_HISTORY" | "STORE_MEDIAN" | "CATEGORY_BASELINE" | "SIMILAR_LISTINGS_BASELINE";
  reference: string; sampleRuleReference: string; sufficient: boolean; fresh: boolean;
  traffic: "LOW" | "HEALTHY" | "HIGH" | "UNKNOWN";
  ctr: "LOW" | "HEALTHY" | "UNKNOWN"; conversion: "LOW" | "HEALTHY" | "UNKNOWN" }
export function diagnoseListingTreatmentV1(input: { itemId: string; window: MetricWindow;
  comparison: FunnelEvidence | null; economics: Economics; policy: PromotionPolicy;
  stock: "LOW" | "AVAILABLE" | "UNKNOWN"; stockReference: string | null;
  protected: boolean; qualityReferences: string[]; keywordReferences: string[] }) {
  const e = listingEconomicsV1(input.economics)
  const c = input.comparison
  const enough = c?.itemId === input.itemId && c.window === input.window && c.sufficient && c.fresh && c.reference && c.sampleRuleReference
  let treatment: Treatment = "TEST", why = "Faltan datos comparables para decidir con confianza.", primaryMetricSignal = "INSUFFICIENT_EVIDENCE"
  let priorities: string[] = []
  if (input.protected) { treatment = "HOLD"; why = "Hay una prueba protegida en curso. Espera su revisión."; primaryMetricSignal = "EXPERIMENT_PROTECTED" }
  else if (input.stock === "LOW" && input.stockReference) { treatment = "RESTOCK"; why = "El stock comprobado no permite impulsar ventas."; primaryMetricSignal = "LOW_INVENTORY" }
  else if (!e.economicsUnproven && (e.profitBeforeAds! < input.policy.minProfit || e.marginBeforeAds! < input.policy.minMargin)) {
    treatment = "PROFIT_PROTECT"; why = "El beneficio actual no alcanza los límites de tu política."; primaryMetricSignal = "INSUFFICIENT_MARGIN"
  } else if (enough) {
    if (["HEALTHY", "HIGH"].includes(c!.traffic) && c!.ctr === "LOW") {
      treatment = "OPTIMIZE"; primaryMetricSignal = "TRAFFIC_WITH_LOW_CTR"; why = "Recibe exposición, pero consigue menos interés que su referencia.";
      priorities = ["MAIN_IMAGE", "TITLE", "KEYWORD_RELEVANCE", "PRICE_POSITION"]
    } else if (c!.ctr === "HEALTHY" && c!.conversion === "LOW") {
      treatment = "OPTIMIZE"; primaryMetricSignal = "HEALTHY_CTR_LOW_CONVERSION"; why = "Despierta interés, pero convierte menos que su referencia.";
      priorities = ["PRICE", "SHIPPING", "DELIVERY", "ITEM_SPECIFICS", "DESCRIPTION", "LISTING_QUALITY", "TRUST"]
    } else if (c!.traffic !== "UNKNOWN" && c!.ctr === "HEALTHY" && c!.conversion === "HEALTHY" && !e.economicsUnproven && input.stock === "AVAILABLE" && input.stockReference) {
      treatment = "SCALE"; primaryMetricSignal = c!.traffic === "LOW" ? "LOW_TRAFFIC_HEALTHY_FUNNEL" : "HEALTHY_FUNNEL";
      why = "El interés, la conversión y el beneficio permiten preparar un impulso."
    }
  }
  const actions: Record<Treatment, string> = { SCALE: "Simular promoción", OPTIMIZE: "Revisar la mejora propuesta", TEST: "Reunir evidencia comparable", RESTOCK: "Reponer antes de impulsar", HOLD: "Esperar la revisión", PROFIT_PROTECT: "Revisar costes y precio" }
  return { contractVersion: LISTING_TREATMENT_ENGINE_V1, itemId: input.itemId, treatment,
    label: TREATMENT_LABELS[treatment], why, primaryMetricSignal, diagnosticPriorities: priorities,
    supportingEvidence: [...(enough ? [c!.reference, c!.sampleRuleReference] : []), ...(input.stockReference ? [input.stockReference] : []),
      ...Object.values(input.economics).filter(proven).map(v => v.reference!),
      ...(treatment === "OPTIMIZE" ? [...input.qualityReferences, ...input.keywordReferences] : [])],
    recommendedAction: actions[treatment], needsEvidence: treatment === "TEST", economics: e,
    promotion: promotionProfitGuardV1(input.economics, input.policy), expectedRevenueOpportunity: null,
    priorityReason: "Prioridad por tratamiento; ingresos adicionales no estimados", safety: SIMULATION_SAFETY }
}

export function promotionPortfolioPreviewV1(rows: ReturnType<typeof diagnoseListingTreatmentV1>[]) {
  if (!rows.length || rows.length > MAX_TREATMENT_LISTINGS || new Set(rows.map(r => r.itemId)).size !== rows.length) throw Error("BOUNDED_UNIQUE_LISTINGS_REQUIRED")
  const ready = rows.filter(r => r.treatment === "SCALE" && r.promotion.status === "SIMULATION_READY")
  return { contractVersion: PROMOTION_CONTROL_V1, selected: rows.length, ready: ready.length, optimizeFirst: rows.filter(r => r.treatment === "OPTIMIZE").length,
    blockedMargin: rows.filter(r => r.treatment === "PROFIT_PROTECT" || r.promotion.status === "BLOCKED_MARGIN").length,
    blockedEvidence: rows.filter(r => r.treatment === "TEST" || r.promotion.status === "BLOCKED_EVIDENCE").length,
    blockedStock: rows.filter(r => r.treatment === "RESTOCK").length,
    projectedAdCost: ready.length ? cents(ready.reduce((sum, r) => sum + r.promotion.projectedAdCost!, 0)) : null,
    projectedProfitAfterAds: ready.length ? cents(ready.reduce((sum, r) => sum + r.promotion.projectedProfitAfterAds!, 0)) : null,
    projectionUnit: "ONE_ATTRIBUTED_SALE_PER_READY_LISTING", forecast: false, safety: SIMULATION_SAFETY }
}

export function compareTreatmentReceiptV1(before: { itemId: string; window: MetricWindow; values: Record<string, number | null>; reference: string; start: string; end: string }, after: typeof before) {
  const comparable = before.itemId === after.itemId && before.window === after.window && before.reference !== after.reference &&
    Boolean(before.reference && after.reference) && Date.parse(after.start) >= Date.parse(before.end) &&
    Date.parse(after.end) - Date.parse(after.start) === Date.parse(before.end) - Date.parse(before.start) && Date.parse(before.end) > Date.parse(before.start)
  const keys = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])]
  const outcomes = Object.fromEntries(keys.map(key => [key, !comparable || !valid(before.values[key]) || !valid(after.values[key])
    ? "INSUFFICIENT_EVIDENCE" : after.values[key]! > before.values[key]! ? "IMPROVED" : after.values[key]! < before.values[key]! ? "DECLINED" : "UNCHANGED"]))
  return { contractVersion: TREATMENT_RECEIPT_V1, before, after, outcomes, causalAttribution: false, safety: SIMULATION_SAFETY }
}
