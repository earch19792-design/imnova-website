type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}
}
function text(value: unknown) { return typeof value === "string" ? value.slice(0, 120) : null }
function date(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

/** Projections deliberately exclude the original account response and personal data. */
export function projectEbayFeePerformanceV1(kind: "STANDARDS" | "SERVICE", value: unknown) {
  const body = record(value), cycle = record(kind === "STANDARDS" ? body.cycle : body.evaluationCycle)
  const cycleType = kind === "STANDARDS" ? cycle.cycleType : cycle.evaluationType
  const evaluation = { evaluationType: text(cycleType), evaluationMonth: text(cycle.evaluationMonth),
    evaluationDate: date(cycle.evaluationDate), startDate: date(cycle.startDate), endDate: date(cycle.endDate) }
  if (kind === "STANDARDS") {
    const level = text(body.standardsLevel)
    const valid = body.program === "PROGRAM_US" && cycleType === "CURRENT" &&
      Boolean(evaluation.evaluationDate) && ["TOP_RATED", "ABOVE_STANDARD", "BELOW_STANDARD"].includes(level ?? "")
    return { status: valid ? "AVAILABLE" : "UNPROVEN", program: text(body.program),
      standardsLevel: valid ? level : null, evaluation }
  }
  const dimensions = Array.isArray(body.dimensionMetrics) ? body.dimensionMetrics : []
  const valid = body.marketplaceId === "EBAY_US" &&
    cycle.evaluationType === "CURRENT" && Boolean(evaluation.evaluationDate) && dimensions.length <= 100
  const categories = dimensions.slice(0, 100).flatMap((entry) => {
    const item = record(entry), dimension = record(item.dimension)
    if (dimension.dimensionKey !== "LISTING_CATEGORY" || !/^\d{1,12}$/.test(String(dimension.value))) return []
    const rates = (Array.isArray(item.metrics) ? item.metrics : []).map(record).filter((metric) => metric.metricKey === "RATE")
    const benchmark = rates.length === 1 ? record(rates[0].benchmark) : {}
    const rating = benchmark.basis === "PEER_BENCHMARK" ? text(benchmark.rating) : null
    return [{ categoryId: String(dimension.value), rating: valid &&
      ["LOW", "AVERAGE", "HIGH", "VERY_HIGH", "NOT_APPLICABLE"].includes(rating ?? "") ? rating : null }]
  })
  return { status: valid && categories.length > 0 && categories.every((entry) => entry.rating !== null) ? "AVAILABLE" : "UNPROVEN",
    marketplace: text(body.marketplaceId), metricType: "ITEM_NOT_AS_DESCRIBED", evaluation,
    categories, listingCategoryApplicability: "UNRESOLVED" }
}

export function feeContextSafeErrorV1(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  // Only controlled identifiers may leave the gateway; upstream response text may contain PII.
  return /^EBAY_[A-Z0-9_]{1,100}$/.test(message) ? message : "EBAY_FEE_CONTEXT_READ_UNAVAILABLE"
}

export function resolveEbayFeeStoreContextV1(subscription: unknown, performance: unknown) {
  const store = record(subscription), account = record(performance)
  const officialNoStore = account.accountBindingExact === true && account.storeOwner === false
  if (store.status === "AVAILABLE" || store.status === "NO_STORE") {
    if ((store.status === "AVAILABLE" && officialNoStore) ||
      (store.status === "NO_STORE" && account.storeOwner === true)) {
      return { status: "UNPROVEN", storeSubscriptionLevel: null, source: null, errorCode: "EBAY_STORE_CONTEXT_CONFLICT" }
    }
    return { status: "PROVEN", storeSubscriptionLevel: store.storeSubscriptionLevel,
      source: "https://api.ebay.com/sell/account/v1/subscription", errorCode: null }
  }
  if (officialNoStore && store.status !== "AMBIGUOUS") return {
    status: "PROVEN", storeSubscriptionLevel: "NO_STORE",
    source: "https://developer.ebay.com/devzone/xml/docs/Reference/ebay/GetUser.html#Response.User.SellerInfo.StoreOwner", errorCode: null,
  }
  return { status: "UNPROVEN", storeSubscriptionLevel: null, source: null, errorCode: "EBAY_STORE_TIER_UNPROVEN" }
}
