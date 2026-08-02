export const SINGLE_PRODUCT_LAB_MODE = "SINGLE_PRODUCT_LAB" as const
export const SINGLE_PRODUCT_LAB_BANNER =
  "PILOT MODE — ONE PRODUCT — NO AUTOMATIC ACTIONS."
export const SINGLE_PRODUCT_LAB_UNAVAILABLE = "MISSING / UNAVAILABLE"
export const SINGLE_PRODUCT_LAB_BLOCK_ERROR =
  "SINGLE_PRODUCT_LAB_ACTION_BLOCKED"

type JsonRecord = Record<string, unknown>

export type SingleProductLabRequest = {
  pathname: string
  method: string
  body?: JsonRecord | null
}

export type SingleProductLabBlock = {
  blocked: true
  status: 423
  reason:
    | "ACCOUNT_OR_PUBLICATION_OAUTH_BLOCKED"
    | "AUTOMATIC_LEARNING_BLOCKED"
    | "AUTOMATIC_QUEUE_BLOCKED"
    | "COMMERCIAL_ACTION_BLOCKED"
    | "DRAFT_OR_PUBLICATION_BLOCKED"
    | "EBAY_MUTATION_BLOCKED"
    | "IMAGE_OR_OPENAI_BLOCKED"
    | "MASS_SCAN_BLOCKED"
    | "REPRICING_BLOCKED"
    | "SAME_DAY_AUTOMATION_BLOCKED"
    | "THREE_SIX_TWELVE_IMPORT_BLOCKED"
    | "WHATSAPP_OR_OUTBOX_BLOCKED"
  action: string | null
}

const STATIC_MUTATION_BLOCKS: ReadonlyArray<{
  route: string
  reason: SingleProductLabBlock["reason"]
}> = [
  {
    route: "/api/admin/ebay/same-day-pilot",
    reason: "SAME_DAY_AUTOMATION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/product-case-runner",
    reason: "COMMERCIAL_ACTION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/listings/register",
    reason: "COMMERCIAL_ACTION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/luna-product-import",
    reason: "THREE_SIX_TWELVE_IMPORT_BLOCKED",
  },
  {
    route: "/api/admin/ebay/images",
    reason: "IMAGE_OR_OPENAI_BLOCKED",
  },
  {
    route: "/api/admin/ebay/listing-ai",
    reason: "IMAGE_OR_OPENAI_BLOCKED",
  },
  {
    route: "/api/admin/ebay/listing-factory",
    reason: "IMAGE_OR_OPENAI_BLOCKED",
  },
  {
    route: "/api/admin/ebay/strategic-advisor",
    reason: "AUTOMATIC_LEARNING_BLOCKED",
  },
  {
    route: "/api/admin/ebay/draft-only",
    reason: "DRAFT_OR_PUBLICATION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/unpublished-offer-authorization",
    reason: "DRAFT_OR_PUBLICATION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/publication-oauth/start",
    reason: "DRAFT_OR_PUBLICATION_BLOCKED",
  },
  {
    route: "/api/admin/ebay/listing-optimization",
    reason: "REPRICING_BLOCKED",
  },
  {
    route: "/api/admin/ebay-winner-pipeline/price-intelligence",
    reason: "REPRICING_BLOCKED",
  },
  {
    route: "/api/admin/ebay/luna-opportunity-queue",
    reason: "MASS_SCAN_BLOCKED",
  },
  {
    route: "/api/admin/ebay/luna-opportunities",
    reason: "MASS_SCAN_BLOCKED",
  },
  {
    route: "/api/admin/ebay/seller-whatsapp-alerts",
    reason: "WHATSAPP_OR_OUTBOX_BLOCKED",
  },
  {
    route: "/api/admin/ebay/account-policies",
    reason: "ACCOUNT_OR_PUBLICATION_OAUTH_BLOCKED",
  },
  {
    route: "/api/admin/ebay/commercial-orders-oauth/start",
    reason: "ACCOUNT_OR_PUBLICATION_OAUTH_BLOCKED",
  },
  {
    route: "/api/admin/ebay/fulfillment-tracking-oauth/start",
    reason: "EBAY_MUTATION_BLOCKED",
  },
  {
    route: "/api/admin/marketplace/fulfillment",
    reason: "EBAY_MUTATION_BLOCKED",
  },
]

const EFFECTFUL_GET_BLOCKS: ReadonlyArray<{
  route: string
  reason: SingleProductLabBlock["reason"]
}> = [
  {
    route: "/api/admin/ebay/commercial-orders-oauth/callback",
    reason: "ACCOUNT_OR_PUBLICATION_OAUTH_BLOCKED",
  },
  {
    route: "/api/admin/ebay/fulfillment-tracking-oauth/callback",
    reason: "EBAY_MUTATION_BLOCKED",
  },
]

const ACTION_SENSITIVE_ROUTES = new Set([
  "/api/admin/market-radar",
  "/api/admin/ebay-winner-pipeline",
  "/api/admin/ebay/command-center",
  "/api/admin/ebay/commercial-monitor",
])

function startsAtRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function action(body: JsonRecord | null | undefined) {
  return typeof body?.action === "string" ? body.action.trim() : ""
}

function block(
  reason: SingleProductLabBlock["reason"],
  requestedAction = "",
): SingleProductLabBlock {
  return {
    blocked: true,
    status: 423,
    reason,
    action: requestedAction || null,
  }
}

export function singleProductLabRequestRequiresBody(
  pathname: string,
  method: string,
) {
  return method.toUpperCase() === "POST" &&
    ACTION_SENSITIVE_ROUTES.has(pathname)
}

export function evaluateSingleProductLabRequest(
  input: SingleProductLabRequest,
): SingleProductLabBlock | null {
  const method = input.method.toUpperCase()
  const pathname = input.pathname
  const requestedAction = action(input.body)

  if (startsAtRoute(pathname, "/api/cron")) {
    const reason = pathname.includes("seller-performance-learning")
      ? "AUTOMATIC_LEARNING_BLOCKED"
      : pathname.includes("commercial-alert-dispatcher")
        ? "WHATSAPP_OR_OUTBOX_BLOCKED"
        : pathname.includes("luna-opportunity-scan") ||
            pathname.includes("market-radar-luna-sync")
          ? "MASS_SCAN_BLOCKED"
          : pathname.includes("same-day-pilot")
            ? "SAME_DAY_AUTOMATION_BLOCKED"
            : "AUTOMATIC_QUEUE_BLOCKED"
    return block(reason, requestedAction)
  }

  if (startsAtRoute(pathname, "/api/queues")) {
    return block("AUTOMATIC_QUEUE_BLOCKED", requestedAction)
  }

  const effectfulGet = EFFECTFUL_GET_BLOCKS.find((entry) =>
    startsAtRoute(pathname, entry.route)
  )
  if (effectfulGet) return block(effectfulGet.reason, requestedAction)

  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null

  const staticBlock = STATIC_MUTATION_BLOCKS.find((entry) =>
    startsAtRoute(pathname, entry.route)
  )
  if (staticBlock) return block(staticBlock.reason, requestedAction)

  if (pathname === "/api/admin/market-radar") {
    return requestedAction === "confirm_stock_quantity"
      ? null
      : block(
          requestedAction === "notify_ebay_opportunities"
            ? "WHATSAPP_OR_OUTBOX_BLOCKED"
            : "MASS_SCAN_BLOCKED",
          requestedAction,
        )
  }

  if (pathname === "/api/admin/ebay-winner-pipeline") {
    return requestedAction === "record_decision"
      ? null
      : block("MASS_SCAN_BLOCKED", requestedAction)
  }

  if (pathname === "/api/admin/ebay/command-center") {
    return ["save_review", "open_active_maintenance"].includes(requestedAction)
      ? null
      : block(
          requestedAction === "active_title_apply"
            ? "EBAY_MUTATION_BLOCKED"
            : requestedAction.includes("price")
              ? "REPRICING_BLOCKED"
              : "DRAFT_OR_PUBLICATION_BLOCKED",
          requestedAction,
        )
  }

  if (pathname === "/api/admin/ebay/commercial-monitor") {
    const readOnlyAction =
      ["oauth_preflight", "compare_seller_hub", "revoke_scheduler"]
        .includes(requestedAction)
    const readOnlyRun = requestedAction === "run" &&
      input.body?.dryRun === true
    return readOnlyAction || readOnlyRun
      ? null
      : block(
          requestedAction.includes("improvement")
            ? "REPRICING_BLOCKED"
            : requestedAction.includes("whatsapp")
              ? "WHATSAPP_OR_OUTBOX_BLOCKED"
              : "COMMERCIAL_ACTION_BLOCKED",
          requestedAction,
        )
  }

  return null
}

export function singleProductLabBlockedPayload(
  blocked: SingleProductLabBlock,
) {
  return {
    success: false,
    error: SINGLE_PRODUCT_LAB_BLOCK_ERROR,
    mode: SINGLE_PRODUCT_LAB_MODE,
    reason: blocked.reason,
    action: blocked.action,
    nextAction: "HUMAN_REVIEW_REQUIRED",
    safety: {
      ebayWrites: 0,
      openAiCalls: 0,
      whatsappCalls: 0,
      publications: 0,
      repricingActions: 0,
      automaticLearningRuns: 0,
      productionChanged: false,
    },
  }
}

export function formatSingleProductLabMetric(
  input: unknown,
  options?: {
    maximumFractionDigits?: number
    suffix?: string
  },
) {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return SINGLE_PRODUCT_LAB_UNAVAILABLE
  }
  return `${new Intl.NumberFormat("es-US", {
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(input)}${options?.suffix ?? ""}`
}
