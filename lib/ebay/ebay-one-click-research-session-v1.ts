export const EBAY_ONE_CLICK_RESEARCH_SESSION_VERSION =
  "EBAY_ONE_CLICK_RESEARCH_SESSION_V1_2026_08_26"

export const EBAY_ONE_CLICK_RESEARCH_SESSION_SCOPE =
  "EBAY_RESEARCH_CAPTURE_ONLY" as const

export const EBAY_ONE_CLICK_RESEARCH_COMMAND =
  "IMNOVA_EBAY_ONE_CLICK_RESEARCH_COMMAND_V1"
export const EBAY_ONE_CLICK_RESEARCH_RESULT =
  "IMNOVA_EBAY_ONE_CLICK_RESEARCH_RESULT_V1"
export const EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE =
  "IMNOVA_EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE_V1"

export const EBAY_ONE_CLICK_RESEARCH_EXTENSION_ARTIFACT = Object.freeze({
  version: "1.2.27",
  buildId: "e48924c20aa5ec439224a34c0a696e5b85ed19ba",
  archivePath:
    "/seller-os-tools/ebay-product-research-capture-extension-v1.2.27.zip",
})

export function attestEbayOneClickResearchExtensionArtifact(input: Readonly<{
  extensionVersion: unknown
  manifestOriginMatch: unknown
}>) {
  if (input.extensionVersion !== EBAY_ONE_CLICK_RESEARCH_EXTENSION_ARTIFACT.version ||
    input.manifestOriginMatch !== true) {
    throw new Error("ONE_CLICK_RESEARCH_EXTENSION_ARTIFACT_MISMATCH")
  }
  return Object.freeze({
    extensionVersion: EBAY_ONE_CLICK_RESEARCH_EXTENSION_ARTIFACT.version,
    buildId: EBAY_ONE_CLICK_RESEARCH_EXTENSION_ARTIFACT.buildId,
    manifestOriginMatch: true as const,
  })
}

export const EBAY_ONE_CLICK_NO_VALID_SOLD_EVIDENCE =
  "NO_VALID_SOLD_EVIDENCE" as const

export const EBAY_ONE_CLICK_RESEARCH_BOUNDS = Object.freeze({
  maxRuntimeMs: 15 * 60_000,
  maxQueries: 15,
  maxRows: 200,
  maxRowsPerCapture: 200,
  maxPagesPerQuery: 2,
  maxRetries: 1,
})

export const EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS = Object.freeze({
  maxRuntimeMs: 8_000,
  attemptTimeoutMs: 750,
  retryDelayMs: 250,
})

export async function establishEbayOneClickResearchHandshake<T>(input: Readonly<{
  probe: (attemptTimeoutMs: number) => Promise<T>
  now?: () => number
  wait?: (delayMs: number) => Promise<void>
}>): Promise<T> {
  const now = input.now ?? Date.now
  const wait = input.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  }))
  const startedAt = now()
  while (true) {
    const remainingMs = EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.maxRuntimeMs -
      (now() - startedAt)
    if (remainingMs <= 0) break
    try {
      return await input.probe(Math.min(
        EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.attemptTimeoutMs,
        remainingMs,
      ))
    } catch {
      const retryRemainingMs = EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.maxRuntimeMs -
        (now() - startedAt)
      if (retryRemainingMs <= 0) break
      await wait(Math.min(
        EBAY_ONE_CLICK_RESEARCH_HANDSHAKE_BOUNDS.retryDelayMs,
        retryRemainingMs,
      ))
    }
  }
  throw new Error("ONE_CLICK_RESEARCH_EXTENSION_HANDSHAKE_TIMEOUT")
}

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
  noValidSoldEvidenceTasks?: unknown
  freshSoldRows: unknown
  evidenceMaxAgeDays: unknown
  durableReadback: unknown
  displayedVsRealizedGuard: unknown
  bestOfferGuard: unknown
  marketplaceWrites: unknown
}) {
  const freshSoldRows = Number(input.freshSoldRows)
  const evidenceMaxAgeDays = Number(input.evidenceMaxAgeDays)
  const noValidSoldEvidenceTasks = Number(input.noValidSoldEvidenceTasks ?? 0)
  const sessionStatusValid = input.sessionStatus === "COMPLETED"
    ? noValidSoldEvidenceTasks === 0
    : input.sessionStatus === "COMPLETED_WITH_REJECTIONS" && noValidSoldEvidenceTasks > 0
  const freshEvidenceValid = Number.isInteger(freshSoldRows) && freshSoldRows >= 0 &&
    (freshSoldRows > 0 || noValidSoldEvidenceTasks > 0)
  if (!sessionStatusValid || !Number.isInteger(noValidSoldEvidenceTasks) ||
    noValidSoldEvidenceTasks < 0 || !freshEvidenceValid || !Number.isFinite(evidenceMaxAgeDays) ||
    evidenceMaxAgeDays < 0 || evidenceMaxAgeDays > 30 ||
    input.durableReadback !== "PASS" ||
    input.displayedVsRealizedGuard !== "PASS" ||
    input.bestOfferGuard !== "PASS" || input.marketplaceWrites !== 0) {
    throw new Error("ONE_CLICK_RESEARCH_COMPLETION_NOT_PROVEN")
  }
  return Object.freeze({
    status: "PASS" as const,
    sessionStatus: input.sessionStatus as "COMPLETED" | "COMPLETED_WITH_REJECTIONS",
    noValidSoldEvidenceTasks,
    freshSoldRows,
    evidenceMaxAgeDays,
    durableReadback: "PASS" as const,
    displayedVsRealizedGuard: "PASS" as const,
    bestOfferGuard: "PASS" as const,
    marketplaceWrites: 0 as const,
  })
}

export function validateEbayOneClickDurableSoldEvidenceOutcome(
  input: Record<string, unknown>,
) {
  const integer = (value: unknown) => Number.isInteger(value) ? Number(value) : null
  const status = input.status === "PASS" || input.status === "PASS_WITH_PACK_SIGNALS"
    ? input.status : null
  const readbackCount = integer(input.readbackCount)
  const freshSoldRows = integer(input.freshSoldRows)
  const commercialPackSignalsPreserved = integer(input.commercialPackSignalsPreserved)
  const evidenceMaxAgeDays = typeof input.evidenceMaxAgeDays === "number"
    ? input.evidenceMaxAgeDays : Number.NaN
  const packStatusValid = commercialPackSignalsPreserved !== null &&
    (status === "PASS"
      ? commercialPackSignalsPreserved === 0
      : status === "PASS_WITH_PACK_SIGNALS" && commercialPackSignalsPreserved > 0)
  if (!status || readbackCount === null || readbackCount < 1 ||
    freshSoldRows === null || freshSoldRows < 1 ||
    commercialPackSignalsPreserved === null || commercialPackSignalsPreserved < 0 ||
    readbackCount !== freshSoldRows + commercialPackSignalsPreserved ||
    !packStatusValid || !Number.isFinite(evidenceMaxAgeDays) ||
    evidenceMaxAgeDays < 0 || evidenceMaxAgeDays > 30 ||
    input.displayedVsRealizedGuard !== "PASS" || input.bestOfferGuard !== "PASS" ||
    input.marketplaceWrites !== 0) {
    throw new Error("ONE_CLICK_RESEARCH_DURABLE_VALIDATION_FAILED")
  }
  return Object.freeze({
    status,
    readbackCount,
    freshSoldRows,
    commercialPackSignalsPreserved,
    evidenceMaxAgeDays,
    displayedVsRealizedGuard: "PASS" as const,
    bestOfferGuard: "PASS" as const,
    marketplaceWrites: 0 as const,
  })
}

export type EbayOneClickNoValidSoldEvidenceOutcome = Readonly<{
  taskOutcome: typeof EBAY_ONE_CLICK_NO_VALID_SOLD_EVIDENCE
  sourceStatus: "HEALTHY"
  parserStatus: "HEALTHY"
  normalizationStatus: "COMPLETE"
  observedCount: number
  parsedCount: number
  normalizedCount: number
  validCount: 0
  rejectedCount: number
  duplicateStatus: "NOT_REACHED"
  rejectionReasonCounts: Readonly<Record<string, number>>
  exactSoldComparablesCreated: 0
  marketplaceWrites: 0
}>

export function validateEbayOneClickNoValidSoldEvidenceOutcome(
  input: Record<string, unknown>,
): EbayOneClickNoValidSoldEvidenceOutcome {
  const integer = (value: unknown) => Number.isInteger(value) ? Number(value) : null
  const observedCount = integer(input.observedCount)
  const parsedCount = integer(input.parsedCount)
  const normalizedCount = integer(input.normalizedCount)
  const rejectedCount = integer(input.rejectedCount)
  const reasonsInput = input.rejectionReasonCounts &&
    typeof input.rejectionReasonCounts === "object" &&
    !Array.isArray(input.rejectionReasonCounts)
    ? input.rejectionReasonCounts as Record<string, unknown> : {}
  const rejectionReasonCounts = Object.fromEntries(Object.entries(reasonsInput)
    .filter(([code, count]) => /^[A-Z0-9_]+$/.test(code) &&
      Number.isInteger(count) && Number(count) > 0)
    .sort((left, right) => left[0].localeCompare(right[0], "en-US"))) as Record<string, number>
  const rejectionTotal = Object.values(rejectionReasonCounts)
    .reduce((total, count) => total + count, 0)
  if (input.taskOutcome !== EBAY_ONE_CLICK_NO_VALID_SOLD_EVIDENCE ||
    input.sourceStatus !== "HEALTHY" || input.parserStatus !== "HEALTHY" ||
    input.normalizationStatus !== "COMPLETE" || observedCount === null || observedCount < 1 ||
    parsedCount === null || parsedCount < 1 || parsedCount > observedCount ||
    normalizedCount === null || normalizedCount !== parsedCount || input.validCount !== 0 ||
    rejectedCount === null || rejectedCount !== normalizedCount ||
    rejectionTotal !== rejectedCount || !Object.keys(rejectionReasonCounts).length ||
    input.duplicateStatus !== "NOT_REACHED" || input.exactSoldComparablesCreated !== 0 ||
    input.marketplaceWrites !== 0) {
    throw new Error("ONE_CLICK_RESEARCH_NO_VALID_SOLD_OUTCOME_INVALID")
  }
  return Object.freeze({
    taskOutcome: EBAY_ONE_CLICK_NO_VALID_SOLD_EVIDENCE,
    sourceStatus: "HEALTHY" as const,
    parserStatus: "HEALTHY" as const,
    normalizationStatus: "COMPLETE" as const,
    observedCount,
    parsedCount,
    normalizedCount,
    validCount: 0 as const,
    rejectedCount,
    duplicateStatus: "NOT_REACHED" as const,
    rejectionReasonCounts: Object.freeze(rejectionReasonCounts),
    exactSoldComparablesCreated: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
