import { PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding,
  verifyProductionStockServiceIdentityV1 } from "./ebay-production-stock-authority-binding-v1"

export const PRODUCTION_STOCK_READ_PATH = "/api/runtime/stockguard-read"
export const PRODUCTION_STOCK_READ_CALLER = "SELLER_OS_STOCKGUARD_MONITOR_V1"
export const PRODUCTION_STOCK_READ_VERSION = "SELLER_OS_PRODUCTION_STOCK_READ_V1"
export const PRODUCTION_STOCK_READ_CAPABILITIES = Object.freeze([
  "CURRENT_LIVE_LISTING_READ", "SUPPLIER_LINKAGE_READ",
  "CERTIFIED_COMPONENT_STOCK_READ", "STOCK_FRESHNESS_READ",
  "STOCKGUARD_EVALUATION",
])

// Separate service capability, not an exception to the eBay Pro boundary.
// Authenticate the production workload, never a caller-supplied database/eBay
// token. The data credential stays exclusively inside its production runtime.
export async function authorizeProductionStockReadV1(request: Request,
  environment: NodeJS.ProcessEnv = process.env,
  verifyIdentity: (assertion: string) => Promise<boolean> = verifyProductionStockServiceIdentityV1) {
  const denied = (reason: string) => ({ allowed: false as const, reason,
    itemId: null, capability: null })
  const url = new URL(request.url)
  if (environment.VERCEL_ENV !== "production" ||
      environment.VERCEL_TARGET_ENV !== "production" ||
      environment.VERCEL_PROJECT_ID !== "prj_a6N1XDfeaKAiR5QmmNFYF16Nmqe5" ||
      environment.VERCEL_PROJECT_PRODUCTION_URL !== "imnova-website-z1qh.vercel.app") {
    return denied("PRODUCTION_STOCK_READ_ENVIRONMENT_DENIED")
  }
  if (request.method !== "GET" || url.pathname !== PRODUCTION_STOCK_READ_PATH ||
      request.body !== null) return denied("PRODUCTION_STOCK_READ_OPERATION_DENIED")
  const keys = [...url.searchParams.keys()]
  if (keys.some(key => !["capability", "itemId"].includes(key)) ||
      new Set(keys).size !== keys.length) return denied("PRODUCTION_STOCK_READ_ARGUMENT_DENIED")
  const capability = url.searchParams.get("capability")
  if (!capability || !PRODUCTION_STOCK_READ_CAPABILITIES.includes(capability)) {
    return denied("PRODUCTION_STOCK_READ_CAPABILITY_DENIED")
  }
  const itemId = url.searchParams.get("itemId")
  if (itemId !== null && !/^\d{9,20}$/.test(itemId)) return denied("PRODUCTION_STOCK_READ_ARGUMENT_DENIED")
  if (request.headers.get("x-seller-os-caller") !== PRODUCTION_STOCK_READ_CALLER) {
    return denied("PRODUCTION_STOCK_READ_CALLER_DENIED")
  }
  const assertion = request.headers.get("x-seller-os-service-assertion") ?? ""
  if (request.headers.has("authorization") || !assertion || !await verifyIdentity(assertion)) {
    return denied("PRODUCTION_STOCK_READ_AUTHENTICATION_DENIED")
  }
  return { allowed: true as const, reason: null, itemId, capability }
}

const TABLES = new Set(["ebay_active_listings", "ebay_active_listing_sync_state",
  "seller_os_luna_linkage_decisions", "seller_os_luna_stock_check_jobs",
  "seller_os_luna_stock_observations"])

// Second boundary at transport: even an accidental future writer import cannot
// reach an RPC, marketplace, redirect, other table, or non-GET operation.
export function productionStockReadTransportV1(input: {
  databaseUrl: string; accountKey: string; fetcher?: typeof fetch
  deadlineAt: number
  onFailure?: (code: string) => void
}): typeof fetch {
  const database = new URL(input.databaseUrl)
  if (database.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(database.hostname) ||
      database.username || database.password || database.port || database.pathname !== "/" ||
      database.search || database.hash || database.origin !== binding.databaseUrl ||
      input.accountKey !== binding.accountKey) throw Error("PRODUCTION_STOCK_DATABASE_CONFIGURATION_INVALID")
  let calls = 0
  return async (target, init) => {
    const url = new URL(target instanceof Request ? target.url : String(target))
    const method = init?.method ?? (target instanceof Request ? target.method : "GET")
    const table = url.pathname.replace(/^\/rest\/v1\//, "")
    const remaining = input.deadlineAt - Date.now()
    if (method !== "GET" || url.origin !== database.origin || url.username || url.password ||
        url.hash || !url.pathname.startsWith("/rest/v1/") || !TABLES.has(table) ||
        url.searchParams.get("account_key") !== `eq.${input.accountKey}` ||
        !url.searchParams.get("select") || url.searchParams.get("select")!.includes("*") ||
        !/^\d{1,4}$/.test(url.searchParams.get("limit") ?? "") ||
        Number(url.searchParams.get("limit")) > 1501 || ++calls > 5 || remaining <= 0) {
      throw Error("PRODUCTION_STOCK_READ_TRANSPORT_DENIED")
    }
    const response = await (input.fetcher ?? fetch)(target, { ...init,
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(remaining) })
    // Do not forward upstream diagnostics, HTML, URLs, or credentials.
    if (!response.ok) {
      const error = response.status === 400 ? await response.json().catch(() => null) : null
      const code = response.status === 404
        ? `PRODUCTION_STOCK_AUTHORITY_TABLE_MISSING:${table}`
        : error?.code === "42703"
          ? `PRODUCTION_STOCK_AUTHORITY_COLUMN_MISSING:${table}`
        : response.status === 401 || response.status === 403
          ? "PRODUCTION_STOCK_DATABASE_SERVICE_AUTH_REJECTED"
          : "PRODUCTION_STOCK_DATABASE_READ_FAILED"
      input.onFailure?.(code)
      throw Error(code)
    }
    return response
  }
}
