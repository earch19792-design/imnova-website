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

export type Top20DiscoveryPreselectionInput = {
  supplierAvailable: boolean
  returnedCandidateCount: number
  discoveryScore: number
  identitySignalScore: number
  riskCodes: string[]
}

export type Top20DiscoveryIdentityStatus =
  | "DISCOVERY_STRONG"
  | "LOOP1_ENRICHMENT_REQUIRED"
  | "INSUFFICIENT"

const DEFAULT_BATCH_SIZE = 3
const DEFAULT_TIME_BUDGET_SECONDS = 45
const DEFAULT_MAX_CONTINUATIONS = 1_000
const DEFAULT_PRESELECTION_SIZE = 70
const MIN_DISCOVERY_SCORE = 35
const MIN_PROVISIONAL_IDENTITY_SCORE = 15
const HARD_DISCOVERY_RISKS = new Set([
  "LUNA_OUT_OF_STOCK",
  "COMPLIANCE_BLOCKED",
  "NO_EBAY_CANDIDATES",
])

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

/**
 * Discovery is deliberately provisional. Luna frequently has no verified GTIN or
 * manufacturer brand, so the 35-point strong-identity threshold cannot be a hard
 * gate before Catalog/comparable enrichment. A 15-point title signal corresponds
 * to at least 60% expected-word coverage when no GTIN or brand is available.
 * Loop 1 still owns the strong identity, exact-pack, economics and compliance gates.
 */
export function evaluateTop20DiscoveryPreselection(
  input: Top20DiscoveryPreselectionInput,
) {
  const reasons: string[] = []
  if (!input.supplierAvailable) reasons.push("LUNA_OUT_OF_STOCK")
  if (input.returnedCandidateCount < 1) reasons.push("NO_EBAY_CANDIDATES")
  if (input.discoveryScore < MIN_DISCOVERY_SCORE) reasons.push("DISCOVERY_SCORE_BELOW_THRESHOLD")
  if (input.identitySignalScore < MIN_PROVISIONAL_IDENTITY_SCORE) {
    reasons.push("DISCOVERY_IDENTITY_SIGNAL_INSUFFICIENT")
  }
  for (const code of input.riskCodes) {
    if (HARD_DISCOVERY_RISKS.has(code) && !reasons.includes(code)) reasons.push(code)
  }
  const identityStatus: Top20DiscoveryIdentityStatus = input.identitySignalScore >= 35
    ? "DISCOVERY_STRONG"
    : input.identitySignalScore >= MIN_PROVISIONAL_IDENTITY_SCORE
      ? "LOOP1_ENRICHMENT_REQUIRED"
      : "INSUFFICIENT"
  return { eligible: reasons.length === 0, identityStatus, reasons }
}

export function shouldRecoverEmptyTop20Completion(input: {
  automationStatus: unknown
  catalogTotal: number
  discoveryExamined: number
  preselected: number
  deepAnalyzed: number
  ready: number
}) {
  return input.automationStatus === "COMPLETED" && input.catalogTotal > 0 &&
    input.discoveryExamined >= input.catalogTotal && input.preselected === 0 &&
    input.deepAnalyzed === 0 && input.ready === 0
}

export function shouldRecoverIncompleteTop20Completion(input: {
  automationStatus: unknown
  preselected: number
  deepAnalyzed: number
}) {
  return input.automationStatus === "COMPLETED" && input.preselected > 0 &&
    input.deepAnalyzed < input.preselected
}

export function shouldReanalyzeTop20ForPolicyUpgrade(input: {
  automationStatus: unknown
  preselected: number
  persistedVersion: unknown
  currentVersion: string
}) {
  return input.automationStatus === "COMPLETED" && input.preselected > 0 &&
    input.persistedVersion !== input.currentVersion
}
