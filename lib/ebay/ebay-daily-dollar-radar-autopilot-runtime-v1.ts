import { createHash, randomUUID } from "node:crypto"

import {
  buildSellerOsDailyDollarRadarAutopilotV1,
  type SellerOsDailyDollarRadarAutopilotInputV1,
} from "./ebay-daily-dollar-radar-autopilot-v1"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

export const SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION =
  "SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_V1" as const

export const SELLER_OS_COMMERCIAL_TIMEZONE_V1 = "America/New_York" as const
export const SELLER_OS_DAILY_DOLLAR_RADAR_TRIGGER_UTC_V1 = "0 9 * * *" as const
export const SELLER_OS_DAILY_DOLLAR_RADAR_MORNING_READY_BY_HOUR_V1 = 6 as const
export const SELLER_OS_DAILY_DOLLAR_RADAR_ALLOWED_TIME_ZONES_V1 =
  Object.freeze([SELLER_OS_COMMERCIAL_TIMEZONE_V1] as const)

const MARKETPLACE_ID = "EBAY_US" as const
const MAXIMUM_QUEUE_ENTRIES = 5
const MAXIMUM_RUNTIME_MS = 55_000
const DEFAULT_LEASE_SECONDS = 300
const ACCOUNT_KEY = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/
const CANONICAL_CONFIGURATION_ID =
  /^launch-configuration-v1:sha256:[0-9a-f]{64}$/
const RUN_ID = /^daily-dollar-radar-run-v1:sha256:[0-9a-f]{64}$/
const LEASE_TOKEN = /^[0-9a-f]{64}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,119}$/

type JsonRecord = Record<string, unknown>

export type SellerOsDailyDollarRadarSupabaseV1 = Readonly<{
  rpc: (name: string, parameters?: JsonRecord) => PromiseLike<{
    data: unknown
    error: unknown
  }>
  from: (table: string) => any
}>

export type SellerOsDailyDollarRadarRuntimeConfigurationV1 = Readonly<{
  enabled: boolean
  timeZone: string | null
  localHour: number | null
  accountKey: string | null
  marketplaceId: typeof MARKETPLACE_ID
  maximumQueueEntries: number
  status:
    | "READY"
    | "AUTOPILOT_DISABLED"
    | "SCHEDULER_TIMEZONE_POLICY_BLOCKED_NEEDS_POLICY"
    | "CANONICAL_ACCOUNT_BINDING_UNAVAILABLE"
}>

export type SellerOsDailyDollarRadarRuntimeDependenciesV1 = Readonly<{
  supabase: SellerOsDailyDollarRadarSupabaseV1
  environment?: NodeJS.ProcessEnv
  now?: () => Date
  workerId?: string
  timeoutMs?: number
  planner?: typeof buildSellerOsDailyDollarRadarAutopilotV1
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.filter((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)) as JsonRecord[] : []
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function morningQueueEntryId(familyId: string, configurationId: string,
  frontierDigest: string) {
  const hexadecimal = createHash("sha256").update(
    `SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1\n${familyId}\n${configurationId}\n${frontierDigest}`,
    "utf8").digest("hex")
  return `morning-dollar-queue-entry-v1:sha256:${hexadecimal}`
}

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value
  return Number.isInteger(parsed) && Number(parsed) >= minimum &&
    Number(parsed) <= maximum ? Number(parsed) : null
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return ""
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized.length <= maximum ? normalized : ""
}

function safeFailureCode(error: unknown) {
  const candidate = safeText(error instanceof Error ? error.message : error, 120)
  return SAFE_CODE.test(candidate) ? candidate : "DAILY_DOLLAR_RADAR_RUNTIME_FAILED"
}

function zeroSafetyCounters() {
  return Object.freeze({
    eBayTradingCalls: 0,
    eBayApiCalls: 0,
    eBaySellCalls: 0,
    eBayBrowseCalls: 0,
    eBayMarketplaceApiCalls: 0,
    eBayDeveloperAnalyticsCalls: 0,
    marketplaceWrites: 0,
    lunaNetworkReads: 0,
    lunaStockReads: 0,
    lunaMutations: 0,
    p2Mutations: 0,
    t0Writes: 0,
    t1Writes: 0,
    skuReservations: 0,
  })
}

export function resolveSellerOsDailyDollarRadarRuntimeConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
): SellerOsDailyDollarRadarRuntimeConfigurationV1 {
  const enabled = environment.SELLER_OS_DAILY_DOLLAR_RADAR_ENABLED === "true"
  const configuredTimeZone = safeText(
    environment.SELLER_OS_DAILY_DOLLAR_RADAR_TIME_ZONE, 80)
  const timeZone = SELLER_OS_DAILY_DOLLAR_RADAR_ALLOWED_TIME_ZONES_V1
    .includes(configuredTimeZone as never) ? configuredTimeZone : null
  const localHour = integer(
    environment.SELLER_OS_DAILY_DOLLAR_RADAR_LOCAL_HOUR, 0, 23)
  const maximumQueueEntries = integer(
    environment.SELLER_OS_DAILY_DOLLAR_RADAR_MAX_QUEUE_ENTRIES, 0,
    MAXIMUM_QUEUE_ENTRIES) ?? MAXIMUM_QUEUE_ENTRIES
  const account = getEbaySellerAccountScopeConfiguration(environment)
  const accountKey = account.accountKey && ACCOUNT_KEY.test(account.accountKey)
    ? account.accountKey : null
  const status = !enabled
    ? "AUTOPILOT_DISABLED" as const
    : timeZone !== SELLER_OS_COMMERCIAL_TIMEZONE_V1 ||
        localHour !== SELLER_OS_DAILY_DOLLAR_RADAR_MORNING_READY_BY_HOUR_V1
        ? "SCHEDULER_TIMEZONE_POLICY_BLOCKED_NEEDS_POLICY" as const
        : !accountKey
          ? "CANONICAL_ACCOUNT_BINDING_UNAVAILABLE" as const
          : "READY" as const
  return Object.freeze({ enabled, timeZone, localHour,
    accountKey, marketplaceId: MARKETPLACE_ID, maximumQueueEntries, status })
}

type LocalDate = Readonly<{ year: number; month: number; day: number }>

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month),
    day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute),
    second: Number(values.second) }
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate() }
}

function zonedMidnight(date: LocalDate, timeZone: string) {
  const desired = Date.UTC(date.year, date.month - 1, date.day)
  let candidate = desired
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(candidate), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second)
    candidate += desired - represented
  }
  const verified = zonedParts(new Date(candidate), timeZone)
  if (verified.year !== date.year || verified.month !== date.month ||
      verified.day !== date.day || verified.hour !== 0 || verified.minute !== 0 ||
      verified.second !== 0) {
    throw new Error("SCHEDULER_TIMEZONE_WINDOW_DERIVATION_FAILED")
  }
  return new Date(candidate).toISOString()
}

export function sellerOsDailyDollarRadarLogicalWindowV1(now: Date, timeZone: string) {
  const current = zonedParts(now, timeZone)
  const today = { year: current.year, month: current.month, day: current.day }
  const yesterday = addLocalDays(today, -1)
  return Object.freeze({
    startAt: zonedMidnight(yesterday, timeZone),
    endAt: zonedMidnight(today, timeZone),
  })
}

function schedulerStoragePolicyReady(policy: JsonRecord,
  configuration: SellerOsDailyDollarRadarRuntimeConfigurationV1, now: Date) {
  if (policy.authority !== "VERCEL_CRON" || policy.enabled !== true ||
      policy.status !== "ACTIVE" ||
      policy.businessTimeZone !== configuration.timeZone ||
      configuration.localHour === null || !configuration.timeZone) return false
  const schedule = safeText(policy.utcCronSchedule, 40)
  if (schedule !== SELLER_OS_DAILY_DOLLAR_RADAR_TRIGGER_UTC_V1) return false
  const match = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.exec(schedule)
  if (!match || Number(match[1]) !== 0) return false
  const utcTrigger = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate(), Number(match[2]), 0, 0))
  const localTrigger = zonedParts(utcTrigger, configuration.timeZone)
  return localTrigger.hour < configuration.localHour && localTrigger.minute === 0
}

async function beforeDeadline<T>(value: PromiseLike<T>, deadline: number,
  code: string) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(code)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), remaining)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function queryRows(query: PromiseLike<{ data: unknown; error: unknown }>,
  deadline: number) {
  const result = await beforeDeadline(query, deadline,
    "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
  if (result.error) throw new Error("DAILY_DOLLAR_RADAR_STORAGE_READ_FAILED")
  return rows(result.data)
}

export async function readSellerOsMorningDollarOpportunityQueueV1(
  supabase: SellerOsDailyDollarRadarSupabaseV1,
  input: Readonly<{
    environment?: NodeJS.ProcessEnv
    limit?: number
    deadline?: number
  }> = {},
) {
  const account = getEbaySellerAccountScopeConfiguration(
    input.environment ?? process.env)
  if (!account.accountKey || !ACCOUNT_KEY.test(account.accountKey)) {
    return Object.freeze({ status: "UNAVAILABLE" as const,
      reason: "CANONICAL_ACCOUNT_BINDING_UNAVAILABLE", resultCount: 0,
      schedulerPolicy: Object.freeze({}), entries: Object.freeze([]) })
  }
  const limit = integer(input.limit ?? MAXIMUM_QUEUE_ENTRIES, 1,
    MAXIMUM_QUEUE_ENTRIES)
  if (limit === null) throw new Error("MORNING_DOLLAR_QUEUE_LIMIT_INVALID")
  const result = await beforeDeadline(supabase.rpc(
    "get_seller_os_morning_dollar_opportunity_queue_v1", {
      p_account_key: account.accountKey,
      p_marketplace_id: MARKETPLACE_ID,
      p_logical_run_date: null,
      p_limit: limit,
    }), input.deadline ?? Date.now() + 10_000,
  "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
  if (result.error) throw new Error("DAILY_DOLLAR_RADAR_STORAGE_NOT_READY")
  const payload = record(result.data)
  return Object.freeze({
    status: safeText(payload.status, 120) || "UNAVAILABLE",
    reason: safeText(payload.reason, 160) || null,
    runId: safeText(payload.runId, 240) || null,
    logicalRunDate: safeText(payload.logicalRunDate, 20) || null,
    queueSnapshotId: safeText(payload.queueSnapshotId, 240) || null,
    inputDigest: safeText(payload.inputDigest, 80) || null,
    outputDigest: safeText(payload.outputDigest, 80) || null,
    snapshotDigest: safeText(payload.snapshotDigest, 80) || null,
    schedulerPolicy: Object.freeze(record(payload.schedulerPolicy)),
    entries: Object.freeze(rows(payload.entries).slice(0, limit)),
    resultCount: Math.min(integer(payload.resultCount, 0, limit) ?? 0, limit),
    rawMarketFactsDuplicated: payload.rawMarketFactsDuplicated === true,
    contractVersion: safeText(payload.contractVersion, 120) || null,
  })
}

export async function collectSellerOsDailyDollarRadarAutopilotInputV1(
  supabase: SellerOsDailyDollarRadarSupabaseV1,
  input: Readonly<{
    accountKey: string
    logicalWindow: Readonly<{ startAt: string; endAt: string }>
    evaluatedAt: string
    maximumQueueEntries: number
    deadline: number
  }>,
) {
  const radarResult = await beforeDeadline(
    supabase.rpc("get_seller_os_family_market_radar_v1", { p_limit: 100 }),
    input.deadline, "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
  if (radarResult.error) throw new Error("DAILY_DOLLAR_RADAR_STORAGE_READ_FAILED")
  const radar = record(radarResult.data)
  if (radar.status !== "AVAILABLE" || !Array.isArray(radar.families)) {
    throw new Error("PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE")
  }
  const familyIds = rows(radar.families).map((family) => safeText(family.familyId))
    .filter((familyId) => /^market-family-v1:sha256:[0-9a-f]{64}$/.test(familyId))
    .slice(0, 100)
  const evaluationRows = rows(radar.families)
    .flatMap((family) => rows(family.currentEvaluations))
    .sort((left, right) => safeText(right.evaluatedAt, 48)
      .localeCompare(safeText(left.evaluatedAt, 48), "en-US"))
    .slice(0, 100)

  const frontierResult = await beforeDeadline(supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: MARKETPLACE_ID,
      p_family_ids: familyIds,
      p_limit: 100,
    }), input.deadline, "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
  if (frontierResult.error) {
    throw new Error("COMPLETE_CANONICAL_I02V_FRONTIER_DURABILITY_UNAVAILABLE")
  }
  const frontierRead = record(frontierResult.data)
  const frontierRows = frontierRead.status === "AVAILABLE"
    ? rows(frontierRead.frontiers).slice(0, 100)
    : []

  const researchQuery = supabase
    .from("marketplace_product_research_capture_observations")
    .select("id,capture_batch_id,normalized_identity,detected_offer_pack_count,detected_unit_count,detected_size,detected_variant,average_sold_price,average_shipping,confirmed_sold_quantity,item_sales,last_sold_date,listing_format,free_shipping_percent,bids,visible_image_count,keyword_signals,match_classification,match_reasons,matched_supplier_variant_id,created_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE_ID)
    .eq("evidence_reviewed", true)
    .eq("quality_status", "VALID")
    .order("last_sold_date", { ascending: false })
    .limit(200)
  const lunaIdentityQuery = supabase
    .from("market_radar_latest_variants")
    .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,price,compare_at_price,snapshot_id,captured_at")
    .eq("source_key", "lunaportex")
    .order("captured_at", { ascending: false })
    .limit(100)
  const [researchRows, lunaIdentityRows] = await Promise.all([
    queryRows(researchQuery, input.deadline),
    queryRows(lunaIdentityQuery, input.deadline),
  ])

  // Frontiers are consumed exclusively through the bounded server RPC above.
  // A frontier alone does not supply an approved candidate identity, target
  // profile, or exact Luna identity authority, so this pre-activation adapter
  // still omits any row whose complete graph cannot be reconstructed. UNKNOWN
  // therefore never becomes a morning opportunity merely because storage exists.
  const plannerInput: SellerOsDailyDollarRadarAutopilotInputV1 = Object.freeze({
    logicalWindow: input.logicalWindow,
    evidenceCutoffAt: input.logicalWindow.endAt,
    evaluatedAt: input.evaluatedAt,
    maxQueueEntries: input.maximumQueueEntries,
    families: Object.freeze([]),
  })
  const sourceReceipt = Object.freeze({
    radarFamilyRows: familyIds.length,
    productResearchRows: researchRows.length,
    lunaVariantRows: lunaIdentityRows.length,
    familyEvaluationRows: evaluationRows.length,
    completeI02VFrontierRows: frontierRows.length,
    completeI02VFrontierReadStatus: safeText(frontierRead.status, 40) ||
      "UNAVAILABLE",
    incompleteFrontiersOmitted: frontierRows.length !== plannerInput.families.length,
    frontierReadBoundary: "get_seller_os_latest_profitability_frontiers_v1",
    rawMarketFactsCopied: false,
    rawProductResearchSignalsAssessed: researchRows.length > 0,
    discoveryUniverseBoundToCurrent5: false,
    discoveryUniverseBoundToShadow20: false,
    newStructuredFamiliesCreated: 0,
    sourceDigest: digest({ radar: radarResult.data, frontierRead,
      researchRows, lunaIdentityRows, evaluationRows }),
  })
  return Object.freeze({ plannerInput, sourceReceipt })
}

function rpcObject(data: unknown) {
  if (Array.isArray(data)) return record(data[0])
  return record(data)
}

function field(value: JsonRecord, camel: string, snake: string) {
  return value[camel] ?? value[snake]
}

function projectQueue(plan: ReturnType<typeof buildSellerOsDailyDollarRadarAutopilotV1>) {
  return plan.queue.slice(0, MAXIMUM_QUEUE_ENTRIES).map((entry) => {
    if (!CANONICAL_CONFIGURATION_ID.test(entry.configurationId)) {
      throw new Error("DAILY_DOLLAR_RADAR_CONFIGURATION_ID_NOT_CANONICAL")
    }
    if (entry.dollarPriorityScore === null ||
        !Number.isFinite(entry.dollarPriorityScore)) {
      throw new Error("DAILY_DOLLAR_RADAR_DOLLAR_SCORE_UNAVAILABLE")
    }
    if (entry.dollarPriorityRank !== entry.rank) {
      throw new Error("DAILY_DOLLAR_RADAR_PRIORITY_RANK_MISMATCH")
    }
    if (entry.currentHardBlockers.length > 20 ||
        entry.currentHardBlockers.some((code) => !SAFE_CODE.test(code)) ||
        JSON.stringify(entry.currentHardBlockers) !==
          JSON.stringify(entry.hardBlockers)) {
      throw new Error("DAILY_DOLLAR_RADAR_HARD_BLOCKER_CONTRACT_INVALID")
    }
    const reasonCodes = Object.freeze([...entry.currentHardBlockers])
    return Object.freeze({
      rank: entry.rank,
      dollarPriorityRank: entry.dollarPriorityRank,
      queueEntryId: morningQueueEntryId(entry.familyId, entry.configurationId,
        entry.frontierDigest),
      familyId: entry.familyId,
      familyName: entry.familyName,
      demandStatus: entry.demandStatus,
      demandEvidenceSummary: entry.demandEvidenceSummary,
      opportunityCaseId: entry.opportunityCaseId,
      currentMarketObservationId: entry.currentMarketObservationId,
      candidateId: entry.candidateId,
      configurationId: entry.configurationId,
      lunaProductId: entry.lunaProductId,
      lunaVariantId: entry.lunaVariantId,
      topLunaProductId: entry.topLunaProductId,
      topLunaVariantId: entry.topLunaVariantId,
      lunaSku: entry.lunaSku,
      exactProductVariantIdentity: entry.exactProductVariantIdentity,
      productFit: entry.productFit,
      competitionStatus: entry.competitionStatus,
      targetProfileDigest: entry.targetProfileDigest,
      frontierInterpretation: entry.frontierInterpretation,
      economicClassification: entry.economicClassification,
      dollarPriorityScore: entry.dollarPriorityScore,
      nextBestEvidence: entry.nextBestEvidence,
      nextAction: entry.nextAction,
      nextBestAction: entry.nextBestAction,
      nextEvidenceValue: entry.nextEvidenceValue,
      buyerIntent: entry.buyerIntent,
      buyerIntentTerms: entry.buyerIntentTerms,
      primaryKeyword: entry.primaryKeyword,
      primaryKeywords: entry.primaryKeywords,
      secondaryKeywords: entry.secondaryKeywords,
      targetProductProfileSummary: entry.targetProductProfileSummary,
      contributionPathSummary: entry.contributionPathSummary,
      currentHardBlockers: entry.currentHardBlockers,
      hardBlockers: entry.hardBlockers,
      shipping: entry.shipping,
      researchStatus: entry.researchStatus,
      ebayEscalationRequired: entry.ebayEscalationRequired,
      needsFreshEbayVerification: entry.needsFreshEbayVerification,
      ebayVerificationReason: entry.ebayVerificationReason,
      ebayVerificationPriority: entry.ebayVerificationPriority,
      ebayVerificationExpectedDecisionValue:
        entry.ebayVerificationExpectedDecisionValue,
      ebayEscalationId: entry.ebayEscalationId,
      listingAuthorized: entry.listingAuthorized,
      marketplaceWriteAllowed: entry.marketplaceWriteAllowed,
      p2MutationAllowed: entry.p2MutationAllowed,
      executionRoute: entry.ebayEscalationRequired
        ? "BOUNDED_EBAY_EVIDENCE_ESCALATION"
        : "DURABLE_EVIDENCE_ONLY",
      frontierDigest: entry.frontierDigest,
      reasonCodes,
    })
  })
}

export async function runSellerOsDailyDollarRadarAutopilotV1(
  dependencies: SellerOsDailyDollarRadarRuntimeDependenciesV1,
) {
  const environment = dependencies.environment ?? process.env
  const configuration = resolveSellerOsDailyDollarRadarRuntimeConfigurationV1(
    environment)
  const safety = zeroSafetyCounters()
  if (configuration.status !== "READY" || !configuration.accountKey ||
      !configuration.timeZone) {
    return Object.freeze({
      contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION,
      status: configuration.status,
      schedulerTimezonePolicy: !configuration.timeZone ||
        configuration.localHour === null
        ? "BLOCKED_NEEDS_POLICY" as const : "NOT_EVALUATED" as const,
      configuration, databaseWrites: 0, queueCount: 0, safety,
    })
  }

  const now = dependencies.now?.() ?? new Date()
  const evaluatedAt = now.toISOString()
  const logicalWindow = sellerOsDailyDollarRadarLogicalWindowV1(now,
    configuration.timeZone)
  const timeoutMs = Math.min(MAXIMUM_RUNTIME_MS,
    integer(dependencies.timeoutMs, 1, MAXIMUM_RUNTIME_MS) ?? MAXIMUM_RUNTIME_MS)
  const deadline = Date.now() + timeoutMs
  let runId = ""
  let leaseToken = ""
  let inputDigest = ""
  let sourceReceipt: Readonly<JsonRecord> = Object.freeze({})
  try {
    const queueRead = await readSellerOsMorningDollarOpportunityQueueV1(
      dependencies.supabase, { environment, limit: configuration.maximumQueueEntries || 1,
        deadline })
    const schedulerPolicy = record(queueRead.schedulerPolicy)
    if (!schedulerStoragePolicyReady(schedulerPolicy, configuration, now)) {
      return Object.freeze({
        contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION,
        status: "SCHEDULER_STORAGE_POLICY_NOT_READY" as const,
        schedulerTimezonePolicy: "BLOCKED_NEEDS_POLICY" as const,
        configuration, databaseWrites: 0, queueCount: 0, safety,
      })
    }
    const collected = await collectSellerOsDailyDollarRadarAutopilotInputV1(
      dependencies.supabase, { accountKey: configuration.accountKey,
        logicalWindow, evaluatedAt,
        maximumQueueEntries: configuration.maximumQueueEntries, deadline })
    sourceReceipt = collected.sourceReceipt
    inputDigest = digest({ plannerInput: collected.plannerInput, sourceReceipt })
    const workerId = safeText(dependencies.workerId, 120) ||
      `daily-dollar-radar:${randomUUID()}`
    const claimResult = await beforeDeadline(dependencies.supabase.rpc(
      "claim_seller_os_daily_dollar_radar_run_v1", {
        p_account_key: configuration.accountKey,
        p_marketplace_id: configuration.marketplaceId,
        p_logical_window_start: logicalWindow.startAt,
        p_logical_window_end: logicalWindow.endAt,
        p_evidence_cutoff_at: logicalWindow.endAt,
        p_worker_id: workerId,
        p_input_digest: inputDigest,
        p_lease_seconds: DEFAULT_LEASE_SECONDS,
      }), deadline, "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
    if (claimResult.error) throw new Error("DAILY_DOLLAR_RADAR_CLAIM_FAILED")
    const claim = rpcObject(claimResult.data)
    const claimOutcome = safeText(field(claim, "outcome", "outcome"), 120)
    const claimed = claimOutcome === "CLAIMED" ||
      field(claim, "claimed", "claimed") === true
    if (!claimed) {
      const replayStatus = claimOutcome === "IDEMPOTENT_COMPLETED"
        ? "IDEMPOTENT_SUCCESS" : claimOutcome
      return Object.freeze({
        contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION,
        status: replayStatus || safeText(field(claim, "status", "status"), 120) ||
          "RUN_NOT_CLAIMED",
        logicalWindow, inputDigest, sourceReceipt, configuration,
        databaseWrites: 0, queueCount: 0, safety,
      })
    }
    runId = safeText(field(claim, "runId", "run_id"), 240)
    leaseToken = safeText(field(claim, "leaseToken", "lease_token"), 240)
    if (!RUN_ID.test(runId) || !LEASE_TOKEN.test(leaseToken)) {
      throw new Error("DAILY_DOLLAR_RADAR_CLAIM_INVALID")
    }

    const planner = dependencies.planner ?? buildSellerOsDailyDollarRadarAutopilotV1
    const plan = planner(collected.plannerInput)
    const entries = projectQueue(plan)
    const allMatches = plan.familyAssessments.flatMap((family) => family.matches)
    const economicCount = (classification: string) => allMatches.filter((match) =>
      match.frontier.economicClassification === classification).length
    const metrics = Object.freeze({
      familyInputCount: plan.inputFamilyCount,
      eligibleFamilyCount: plan.logicalFamilyCount,
      configurationInputCount: plan.logicalMatchCount,
      queueCount: entries.length,
      escalationCount: plan.ebayEscalations.length,
      radarFamilyRows: Number(sourceReceipt.radarFamilyRows ?? 0),
      productResearchRows: Number(sourceReceipt.productResearchRows ?? 0),
      lunaVariantRows: Number(sourceReceipt.lunaVariantRows ?? 0),
      familyEvaluationRows: Number(sourceReceipt.familyEvaluationRows ?? 0),
      familiesEvaluated: plan.runMetrics.familiesEvaluated,
      newFamiliesDiscovered: plan.runMetrics.newFamiliesDiscovered,
      demandProvenCount: plan.runMetrics.demandProvenCount,
      demandSupportedCount: plan.runMetrics.demandSupportedCount,
      lunaMatchCount: plan.runMetrics.lunaMatchCount,
      productFitStrongCount: plan.runMetrics.productFitStrongCount,
      economicallyDeadCount: economicCount("ECONOMICALLY_DEAD"),
      economicallyRecoverableCount: economicCount("ECONOMICALLY_RECOVERABLE"),
      economicallyPromisingCount: economicCount("ECONOMICALLY_PROMISING"),
      economicsUnprovenCount: economicCount("ECONOMICS_UNPROVEN"),
      morningQueueCount: plan.runMetrics.morningQueueCount,
      needsFreshEbayVerificationCount:
        plan.runMetrics.needsFreshEbayVerificationCount,
      failureStage: "NONE",
      ...safety,
    })
    const outputDigest = digest({ autopilotDigest: plan.autopilotDigest,
      entries, metrics })
    const completion = await beforeDeadline(dependencies.supabase.rpc(
      "complete_seller_os_daily_dollar_radar_run_v1", {
        p_run_id: runId,
        p_lease_token: leaseToken,
        p_input_digest: inputDigest,
        p_output_digest: outputDigest,
        p_entries: entries,
        p_metrics: metrics,
      }), deadline, "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
    if (completion.error) throw new Error("DAILY_DOLLAR_RADAR_COMPLETE_FAILED")
    return Object.freeze({
      contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION,
      status: "COMPLETED" as const,
      operationalReadiness: Number(sourceReceipt.completeI02VFrontierRows) > 0 &&
          collected.plannerInput.families.length > 0
        ? "READY" as const
        : "PARTIAL_DURABLE_FRONTIER_INPUT_UNAVAILABLE" as const,
      runId, logicalWindow, inputDigest, outputDigest,
      queueCount: entries.length, entries, sourceReceipt, metrics,
      configuration, databaseWrites: 2, safety,
    })
  } catch (error) {
    const errorCode = safeFailureCode(error)
    let failureRecorded = false
    if (runId && leaseToken && inputDigest && Date.now() < deadline) {
      try {
        const failed = await beforeDeadline(dependencies.supabase.rpc(
          "fail_seller_os_daily_dollar_radar_run_v1", {
            p_run_id: runId,
            p_lease_token: leaseToken,
            p_input_digest: inputDigest,
            p_error_code: errorCode,
            p_metrics: { familyInputCount: 0, eligibleFamilyCount: 0,
              configurationInputCount: 0, queueCount: 0, escalationCount: 0,
              radarFamilyRows: Number(sourceReceipt.radarFamilyRows ?? 0),
              productResearchRows: Number(sourceReceipt.productResearchRows ?? 0),
              lunaVariantRows: Number(sourceReceipt.lunaVariantRows ?? 0),
              familyEvaluationRows: Number(sourceReceipt.familyEvaluationRows ?? 0),
              familiesEvaluated: 0, newFamiliesDiscovered: 0,
              demandProvenCount: 0, demandSupportedCount: 0, lunaMatchCount: 0,
              productFitStrongCount: 0, economicallyDeadCount: 0,
              economicallyRecoverableCount: 0, economicallyPromisingCount: 0,
              economicsUnprovenCount: 0, morningQueueCount: 0,
              needsFreshEbayVerificationCount: 0,
              failureStage: errorCode,
              ...safety },
          }), deadline, "DAILY_DOLLAR_RADAR_STORAGE_TIMEOUT")
        failureRecorded = !failed.error
      } catch { failureRecorded = false }
    }
    return Object.freeze({
      contractVersion: SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_RUNTIME_VERSION,
      status: "FAILED_CLOSED" as const,
      errorCode, runId: runId || null, logicalWindow, inputDigest: inputDigest || null,
      failureRecorded, sourceReceipt, configuration,
      databaseWrites: (runId ? 1 : 0) + (failureRecorded ? 1 : 0),
      queueCount: 0, safety,
    })
  }
}
