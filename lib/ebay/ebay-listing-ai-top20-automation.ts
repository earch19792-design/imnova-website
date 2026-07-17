import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const TOP20_AUTOMATION_STATUSES = [
  "NOT_STARTED",
  "RUNNING",
  "PAUSED_RATE_LIMIT",
  "PARTIAL_AUTO_CONTINUING",
  "COMPLETED",
  "FAILED",
] as const

export type Top20AutomationStatus = typeof TOP20_AUTOMATION_STATUSES[number]

export type Top20TargetSource = "RADAR_TOP5" | "PRIOR_INTELLIGENCE" | "LUNA_CATALOG"

export type Top20TargetCandidate = {
  productId: string
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  priorityScore: number
}

export type Top20TargetManifestRow = Top20TargetCandidate & {
  ordinal: number
  source: Top20TargetSource
  deduplicationKeyHash: string
}

const DEFAULT_BATCH_SIZE = 3
const DEFAULT_TIME_BUDGET_SECONDS = 45
const DEFAULT_MAX_CONTINUATIONS = 1_000
const DEFAULT_PRESELECTION_SIZE = 70

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function normalize(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function getTop20AutomationConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  return {
    batchSize: boundedInteger(environment.EBAY_LISTING_TOP20_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 10),
    timeBudgetSeconds: boundedInteger(
      environment.EBAY_LISTING_TOP20_TIME_BUDGET_SECONDS,
      DEFAULT_TIME_BUDGET_SECONDS,
      10,
      240,
    ),
    maxContinuations: boundedInteger(
      environment.EBAY_LISTING_TOP20_MAX_CONTINUATIONS,
      DEFAULT_MAX_CONTINUATIONS,
      1,
      5_000,
    ),
    preselectionSize: boundedInteger(
      environment.EBAY_LISTING_TOP20_PRESELECTION_SIZE,
      DEFAULT_PRESELECTION_SIZE,
      50,
      100,
    ),
    automaticCronEnabled: false as const,
    openAiCalls: 0 as const,
    ebayWrites: 0 as const,
  }
}

export function createTop20ContinuationToken() {
  return randomBytes(32).toString("base64url")
}

export function hashTop20ContinuationToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("TOP20_CONTINUATION_TOKEN_INVALID")
  return sha256(token)
}

export function verifyTop20ContinuationToken(token: string, expectedHash: string | null) {
  if (!expectedHash || !/^sha256:[0-9a-f]{64}$/.test(expectedHash)) return false
  let actual: string
  try {
    actual = hashTop20ContinuationToken(token)
  } catch {
    return false
  }
  return timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expectedHash, "utf8"))
}

function targetDeduplicationKey(candidate: Top20TargetCandidate) {
  return [
    normalize(candidate.supplierProductId) || normalize(candidate.productId),
    normalize(candidate.supplierVariantId) || "default",
    normalize(candidate.supplierSku) || "unknown",
  ].join(":")
}

function deterministicOrder(left: Top20TargetCandidate, right: Top20TargetCandidate) {
  return right.priorityScore - left.priorityScore || left.productId.localeCompare(right.productId)
}

export function buildTop20TargetManifest(input: {
  catalog: Top20TargetCandidate[]
  radarProductIds: string[]
  priorIntelligenceProductIds: string[]
}) {
  const radar = new Set(input.radarProductIds.slice(0, 5))
  const prior = new Set(input.priorIntelligenceProductIds)
  const seen = new Set<string>()
  const ordered: Top20TargetManifestRow[] = []

  const append = (source: Top20TargetSource, candidates: Top20TargetCandidate[]) => {
    for (const candidate of [...candidates].sort(deterministicOrder)) {
      const key = targetDeduplicationKey(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      ordered.push({
        ...candidate,
        ordinal: ordered.length,
        source,
        deduplicationKeyHash: sha256(key),
      })
    }
  }

  append("RADAR_TOP5", input.catalog.filter((candidate) => radar.has(candidate.productId)))
  append("PRIOR_INTELLIGENCE", input.catalog.filter((candidate) =>
    !radar.has(candidate.productId) && prior.has(candidate.productId)))
  append("LUNA_CATALOG", input.catalog.filter((candidate) =>
    !radar.has(candidate.productId) && !prior.has(candidate.productId)))
  return ordered
}

export function isTop20RateLimitError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error ?? "")
  return code === "LISTING_AI_RATE_LIMITED" || /(?:^|_)429$/.test(code) || code.includes("RATE_LIMIT")
}

export function isTop20AutomationActive(status: unknown) {
  return status === "RUNNING" || status === "PARTIAL_AUTO_CONTINUING"
}

export function top20ProgressPercent(examined: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(examined / total * 1_000) / 10))
}
