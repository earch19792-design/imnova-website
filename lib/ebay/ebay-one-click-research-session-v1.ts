export const EBAY_ONE_CLICK_RESEARCH_SESSION_VERSION =
  "EBAY_ONE_CLICK_RESEARCH_SESSION_V1_2026_08_26"

export const EBAY_ONE_CLICK_RESEARCH_SESSION_SCOPE =
  "EBAY_RESEARCH_CAPTURE_ONLY" as const

export const EBAY_ONE_CLICK_RESEARCH_COMMAND =
  "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
export const EBAY_ONE_CLICK_RESEARCH_RESULT =
  "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"

export const EBAY_ONE_CLICK_RESEARCH_BOUNDS = Object.freeze({
  maxRuntimeMs: 15 * 60_000,
  maxQueries: 15,
  maxRows: 200,
  maxRowsPerCapture: 200,
  maxPagesPerQuery: 2,
  maxRetries: 1,
})

type QueryPlanTask = Readonly<{
  id?: unknown
  ordinal?: unknown
  search_query?: unknown
  category_id?: unknown
  candidate_count?: unknown
  status?: unknown
}>

type QueryPlan = Readonly<{
  status?: unknown
  tasks?: readonly QueryPlanTask[] | null
}>

export type EbayOneClickResearchTask = Readonly<{
  id: string
  ordinal: number
  searchQuery: string
  categoryId: string | null
  candidateCount: number
  missionClass: "STRONG_FAMILY_EXPANSION"
}>

export type EbayOneClickResearchPlan = Readonly<{
  version: typeof EBAY_ONE_CLICK_RESEARCH_SESSION_VERSION
  tasks: readonly EbayOneClickResearchTask[]
  missionMix: Readonly<{
    newDiscovery: 0
    strongFamilyExpansion: number
    staleDemandRefresh: 0
    economicsRescue: 0
    totalQueries: number
  }>
  coverageLimitation:
    "EXISTING_QUERY_PLAN_CLASSIFIES_EXPANSION_ONLY;NEW_DISCOVERY_REFRESH_AND_ECONOMICS_RESCUE_NOT_YET_EXPOSED"
}>

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function buildEbayOneClickResearchPlan(
  queryPlan: QueryPlan | null | undefined,
): EbayOneClickResearchPlan {
  if (text(queryPlan?.status, 24).toUpperCase() !== "ACTIVE") {
    throw new Error("ONE_CLICK_RESEARCH_ACTIVE_QUERY_PLAN_REQUIRED")
  }
  const tasks = (Array.isArray(queryPlan?.tasks) ? queryPlan.tasks : [])
    .filter((task) => text(task.status, 24).toUpperCase() === "PENDING")
    .map((task): EbayOneClickResearchTask | null => {
      const id = text(task.id, 80)
      const ordinal = positiveInteger(task.ordinal)
      const searchQuery = text(task.search_query, 100)
      const categoryId = text(task.category_id, 30)
      const candidateCount = positiveInteger(task.candidate_count)
      if (!id || !ordinal || searchQuery.length < 3 || !candidateCount) return null
      if (categoryId && !/^\d+$/.test(categoryId)) return null
      return Object.freeze({
        id,
        ordinal,
        searchQuery,
        categoryId: categoryId || null,
        candidateCount,
        missionClass: "STRONG_FAMILY_EXPANSION" as const,
      })
    })
    .filter((task): task is EbayOneClickResearchTask => task !== null)
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(0, EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxQueries)
  if (!tasks.length) throw new Error("ONE_CLICK_RESEARCH_PENDING_QUERY_REQUIRED")
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length ||
    new Set(tasks.map((task) => task.ordinal)).size !== tasks.length) {
    throw new Error("ONE_CLICK_RESEARCH_QUERY_PLAN_AMBIGUOUS")
  }
  return Object.freeze({
    version: EBAY_ONE_CLICK_RESEARCH_SESSION_VERSION,
    tasks: Object.freeze(tasks),
    missionMix: Object.freeze({
      newDiscovery: 0 as const,
      strongFamilyExpansion: tasks.length,
      staleDemandRefresh: 0 as const,
      economicsRescue: 0 as const,
      totalQueries: tasks.length,
    }),
    coverageLimitation:
      "EXISTING_QUERY_PLAN_CLASSIFIES_EXPANSION_ONLY;NEW_DISCOVERY_REFRESH_AND_ECONOMICS_RESCUE_NOT_YET_EXPOSED" as const,
  })
}

export function buildEbayOneClickResearchLease(input: {
  sessionId: string
  now?: Date
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId)) {
    throw new Error("ONE_CLICK_RESEARCH_SESSION_ID_INVALID")
  }
  const issuedAt = (input.now ?? new Date()).getTime()
  if (!Number.isFinite(issuedAt)) throw new Error("ONE_CLICK_RESEARCH_CLOCK_INVALID")
  return Object.freeze({
    version: EBAY_ONE_CLICK_RESEARCH_SESSION_VERSION,
    sessionId: input.sessionId,
    scope: EBAY_ONE_CLICK_RESEARCH_SESSION_SCOPE,
    marketplace: "EBAY_US" as const,
    issuedAt,
    expiresAt: issuedAt + EBAY_ONE_CLICK_RESEARCH_BOUNDS.maxRuntimeMs,
    bounds: EBAY_ONE_CLICK_RESEARCH_BOUNDS,
    marketplaceWrites: 0 as const,
  })
}

export function validateEbayOneClickResearchCompletion(input: {
  sessionStatus: unknown
  freshSoldRows: unknown
  evidenceMaxAgeDays: unknown
  durableReadback: unknown
  displayedVsRealizedGuard: unknown
  bestOfferGuard: unknown
  marketplaceWrites: unknown
}) {
  const freshSoldRows = Number(input.freshSoldRows)
  const evidenceMaxAgeDays = Number(input.evidenceMaxAgeDays)
  if (input.sessionStatus !== "COMPLETED" || !Number.isInteger(freshSoldRows) ||
    freshSoldRows <= 0 || !Number.isFinite(evidenceMaxAgeDays) ||
    evidenceMaxAgeDays < 0 || evidenceMaxAgeDays > 30 ||
    input.durableReadback !== "PASS" ||
    input.displayedVsRealizedGuard !== "PASS" ||
    input.bestOfferGuard !== "PASS" || input.marketplaceWrites !== 0) {
    throw new Error("ONE_CLICK_RESEARCH_COMPLETION_NOT_PROVEN")
  }
  return Object.freeze({
    status: "PASS" as const,
    freshSoldRows,
    evidenceMaxAgeDays,
    durableReadback: "PASS" as const,
    displayedVsRealizedGuard: "PASS" as const,
    bestOfferGuard: "PASS" as const,
    marketplaceWrites: 0 as const,
  })
}
