export const KEEPA_MARKET_DEMAND_READONLY_V1 =
  "KEEPA_MARKET_DEMAND_READONLY_V1" as const

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value) : null
}

function keepaTime(value: unknown) {
  const minutes = integer(value)
  if (minutes === null) return null
  return new Date((minutes + 21_564_000) * 60_000).toISOString()
}

export type KeepaMarketDemandV1 = Readonly<{
  asin: string
  monthlySoldEstimate: number | null
  salesRankDrops30: number | null
  salesRankDrops90: number | null
  salesRankDrops180: number | null
  state: "AVAILABLE" | "UNAVAILABLE"
  method: "KEEPA_MONTHLY_SOLD" | "KEEPA_RANK_DROPS_PROXY" | "UNAVAILABLE"
  observedAt: string
}>

export function getKeepaMarketDemandConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Object.freeze({
    status: environment.KEEPA_API_KEY?.trim() ? "READY" as const
      : "NOT_CONFIGURED" as const,
    credentialsStored: false,
  })
}

export function parseKeepaMarketDemandResponseV1(value: unknown,
  options: { now?: Date } = {}) {
  const signals = new Map<string, KeepaMarketDemandV1>()
  const products = Array.isArray(record(value).products)
    ? record(value).products as unknown[] : []
  for (const raw of products) {
    const product = record(raw)
    const asin = typeof product.asin === "string"
      ? product.asin.trim().toUpperCase() : ""
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue
    const stats = record(product.stats)
    const monthlySoldEstimate = integer(product.monthlySold)
    const salesRankDrops30 = integer(stats.salesRankDrops30)
    const salesRankDrops90 = integer(stats.salesRankDrops90)
    const salesRankDrops180 = integer(stats.salesRankDrops180)
    const method = monthlySoldEstimate !== null
      ? "KEEPA_MONTHLY_SOLD" as const
      : salesRankDrops30 !== null
        ? "KEEPA_RANK_DROPS_PROXY" as const : "UNAVAILABLE" as const
    signals.set(asin, Object.freeze({ asin, monthlySoldEstimate,
      salesRankDrops30, salesRankDrops90, salesRankDrops180,
      state: method === "UNAVAILABLE" ? "UNAVAILABLE" as const
        : "AVAILABLE" as const,
      method, observedAt: keepaTime(product.lastUpdate) ??
        (options.now ?? new Date()).toISOString() }))
  }
  return signals
}

export async function readKeepaMarketDemandV1(input: {
  asins: readonly string[]
  environment?: NodeJS.ProcessEnv
  fetcher?: typeof fetch
  now?: Date
}) {
  const apiKey = input.environment?.KEEPA_API_KEY?.trim() ??
    process.env.KEEPA_API_KEY?.trim()
  if (!apiKey) throw new Error("KEEPA_API_CONNECTION_REQUIRED")
  const asins = [...new Set(input.asins.map((asin) => asin.toUpperCase()))]
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)).slice(0, 100)
  if (!asins.length) return new Map<string, KeepaMarketDemandV1>()
  const params = new URLSearchParams({ key: apiKey, domain: "1",
    asin: asins.join(","), history: "0", stats: "180" })
  const response = await (input.fetcher ?? fetch)(
    `https://api.keepa.com/product?${params.toString()}`, {
      method: "GET", headers: { Accept: "application/json" },
      cache: "no-store",
    })
  if (!response.ok) {
    throw new Error(response.status === 429
      ? "KEEPA_API_UPSTREAM_RETRYABLE" : "KEEPA_API_READ_FAILED")
  }
  return parseKeepaMarketDemandResponseV1(await response.json(), {
    now: input.now,
  })
}
