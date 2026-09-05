import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const subject = await import("./ebay-daily-dollar-radar-autopilot-runtime-v1.ts")

const {
  resolveSellerOsDailyDollarRadarRuntimeConfigurationV1,
  runSellerOsDailyDollarRadarAutopilotV1,
  sellerOsDailyDollarRadarLogicalWindowV1,
} = subject

function environment(overrides = {}) {
  return {
    SELLER_OS_DAILY_DOLLAR_RADAR_ENABLED: "true",
    SELLER_OS_DAILY_DOLLAR_RADAR_TIME_ZONE: "America/New_York",
    SELLER_OS_DAILY_DOLLAR_RADAR_LOCAL_HOUR: "6",
    EBAY_SELLER_ACCOUNT_KEY: "canonical-ebay-account",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "test-official-user",
    ...overrides,
  }
}

function queryResult(data) {
  const calls = []
  const chain = {
    calls,
    select(...args) { calls.push(["select", ...args]); return chain },
    eq(...args) { calls.push(["eq", ...args]); return chain },
    in(...args) { calls.push(["in", ...args]); return chain },
    order(...args) { calls.push(["order", ...args]); return chain },
    limit(...args) { calls.push(["limit", ...args]); return chain },
    then(resolve, reject) {
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    },
  }
  return chain
}

function fakeSupabase(options = {}) {
  const rpcCalls = []
  const tableCalls = []
  const client = {
    rpc(name, parameters = {}) {
      rpcCalls.push({ name, parameters })
      if (name === "get_seller_os_family_market_radar_v1") {
        return Promise.resolve({ data: options.radar ?? {
          status: "AVAILABLE", familyCount: 0, families: [],
        }, error: options.radarError ?? null })
      }
      if (name === "get_seller_os_latest_profitability_frontiers_v1") {
        return Promise.resolve({ data: options.frontiers ?? {
          status: "UNAVAILABLE",
          reason: "COMPLETE_CANONICAL_I02V_FRONTIER_DURABILITY_UNAVAILABLE",
          resultCount: 0, frontiers: [],
          provisionalFastLaneEconomics: true,
          phase6CanonicalAuthority: false,
        }, error: options.frontierError ?? null })
      }
      if (name === "get_seller_os_morning_dollar_opportunity_queue_v1") {
        return Promise.resolve({ data: options.queueRead ?? {
          status: "UNAVAILABLE", reason: "MORNING_DOLLAR_QUEUE_NOT_PERSISTED",
          resultCount: 0, entries: [], schedulerPolicy: {
            authority: "VERCEL_CRON", enabled: true, status: "ACTIVE",
            businessTimeZone: "America/New_York",
            utcCronSchedule: "0 9 * * *",
          },
        }, error: options.queueReadError ?? null })
      }
      if (name === "claim_seller_os_daily_dollar_radar_run_v1") {
        return Promise.resolve({ data: options.claim ?? {
          outcome: "CLAIMED", status: "RUNNING",
          runId: `daily-dollar-radar-run-v1:sha256:${"a".repeat(64)}`,
          leaseToken: "b".repeat(64),
        }, error: options.claimError ?? null })
      }
      if (name === "complete_seller_os_daily_dollar_radar_run_v1") {
        return Promise.resolve({ data: { status: "COMPLETED" },
          error: options.completeError ?? null })
      }
      if (name === "fail_seller_os_daily_dollar_radar_run_v1") {
        return Promise.resolve({ data: { status: "FAILED_RECORDED" },
          error: options.failError ?? null })
      }
      return Promise.resolve({ data: null, error: { code: "UNEXPECTED_RPC" } })
    },
    from(table) {
      tableCalls.push(table)
      if (table === "marketplace_product_research_capture_observations") {
        return queryResult(options.research ?? [])
      }
      if (table === "market_radar_latest_variants") {
        return queryResult(options.luna ?? [])
      }
      throw new Error("UNEXPECTED_TABLE")
    },
  }
  return { client, rpcCalls, tableCalls }
}

test("configuration requires an explicit enabled scheduler and allowlisted time policy", () => {
  assert.equal(resolveSellerOsDailyDollarRadarRuntimeConfigurationV1({}).status,
    "AUTOPILOT_DISABLED")
  assert.equal(resolveSellerOsDailyDollarRadarRuntimeConfigurationV1(environment({
    SELLER_OS_DAILY_DOLLAR_RADAR_TIME_ZONE: "Europe/Paris",
  })).status, "SCHEDULER_TIMEZONE_POLICY_BLOCKED_NEEDS_POLICY")
  assert.equal(resolveSellerOsDailyDollarRadarRuntimeConfigurationV1(environment({
    SELLER_OS_DAILY_DOLLAR_RADAR_LOCAL_HOUR: "",
  })).status, "SCHEDULER_TIMEZONE_POLICY_BLOCKED_NEEDS_POLICY")
  assert.equal(resolveSellerOsDailyDollarRadarRuntimeConfigurationV1(
    environment()).status, "READY")
})

test("logical window is the previous fully closed local calendar day", () => {
  assert.deepEqual(sellerOsDailyDollarRadarLogicalWindowV1(
    new Date("2026-08-23T15:00:00.000Z"), "America/New_York"), {
    startAt: "2026-08-22T04:00:00.000Z",
    endAt: "2026-08-23T04:00:00.000Z",
  })
})

test("logical New York days remain calendar-bound across both DST transitions", () => {
  const spring = sellerOsDailyDollarRadarLogicalWindowV1(
    new Date("2026-03-09T12:00:00.000Z"), "America/New_York")
  assert.deepEqual(spring, {
    startAt: "2026-03-08T05:00:00.000Z",
    endAt: "2026-03-09T04:00:00.000Z",
  })
  assert.equal(Date.parse(spring.endAt) - Date.parse(spring.startAt), 23 * 3600e3)

  const fall = sellerOsDailyDollarRadarLogicalWindowV1(
    new Date("2026-11-02T12:00:00.000Z"), "America/New_York")
  assert.deepEqual(fall, {
    startAt: "2026-11-01T04:00:00.000Z",
    endAt: "2026-11-02T05:00:00.000Z",
  })
  assert.equal(Date.parse(fall.endAt) - Date.parse(fall.startAt), 25 * 3600e3)
})

test("blocked policy performs no database read or write", async () => {
  const database = fakeSupabase()
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client,
    environment: environment({ SELLER_OS_DAILY_DOLLAR_RADAR_TIME_ZONE: "" }),
  })
  assert.equal(result.status, "SCHEDULER_TIMEZONE_POLICY_BLOCKED_NEEDS_POLICY")
  assert.equal(result.schedulerTimezonePolicy, "BLOCKED_NEEDS_POLICY")
  assert.equal(database.rpcCalls.length, 0)
  assert.equal(database.tableCalls.length, 0)
})

test("disabled runtime still reports an unproven canonical timezone policy", async () => {
  const database = fakeSupabase()
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client,
    environment: {},
  })
  assert.equal(result.status, "AUTOPILOT_DISABLED")
  assert.equal(result.schedulerTimezonePolicy, "BLOCKED_NEEDS_POLICY")
  assert.equal(database.rpcCalls.length, 0)
  assert.equal(database.tableCalls.length, 0)
})

test("empty complete-frontier set is a valid fail-closed persisted snapshot", async () => {
  const database = fakeSupabase()
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client,
    environment: environment(),
    workerId: "test-worker",
    now: () => new Date("2026-08-23T15:00:00.000Z"),
  })
  assert.equal(result.status, "COMPLETED")
  assert.equal(result.operationalReadiness,
    "PARTIAL_DURABLE_FRONTIER_INPUT_UNAVAILABLE")
  assert.equal(result.queueCount, 0)
  assert.deepEqual(database.rpcCalls.map((call) => call.name), [
    "get_seller_os_morning_dollar_opportunity_queue_v1",
    "get_seller_os_family_market_radar_v1",
    "get_seller_os_latest_profitability_frontiers_v1",
    "claim_seller_os_daily_dollar_radar_run_v1",
    "complete_seller_os_daily_dollar_radar_run_v1",
  ])
  const completion = database.rpcCalls.at(-1).parameters
  assert.deepEqual(completion.p_entries, [])
  assert.equal(completion.p_metrics.eBayTradingCalls, 0)
  assert.equal(completion.p_metrics.eBayApiCalls, 0)
  assert.equal(completion.p_metrics.eBaySellCalls, 0)
  assert.equal(completion.p_metrics.eBayMarketplaceApiCalls, 0)
  assert.equal(completion.p_metrics.lunaNetworkReads, 0)
  assert.equal(completion.p_metrics.t1Writes, 0)
  assert.equal(completion.p_metrics.failureStage, "NONE")
  assert.equal(completion.p_metrics.morningQueueCount,
    completion.p_metrics.queueCount)
  assert.match(completion.p_input_digest, /^sha256:[0-9a-f]{64}$/)
  assert.match(completion.p_output_digest, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(database.tableCalls, [
    "marketplace_product_research_capture_observations",
    "market_radar_latest_variants",
  ])
})

test("family evaluations stay inside the certified bounded radar RPC", async () => {
  const familyId = `market-family-v1:sha256:${"1".repeat(64)}`
  const database = fakeSupabase({ radar: {
    status: "AVAILABLE", familyCount: 1, families: [{
      familyId,
      currentEvaluations: [{
        evaluationId: "prelinked-family-evaluation:test",
        evaluatedAt: "2026-08-23T14:00:00.000Z",
      }],
    }],
  } })
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client,
    environment: environment(),
    workerId: "test-worker",
    now: () => new Date("2026-08-23T15:00:00.000Z"),
  })
  assert.equal(result.status, "COMPLETED")
  assert.equal(result.sourceReceipt.familyEvaluationRows, 1)
  assert.deepEqual(database.tableCalls, [
    "marketplace_product_research_capture_observations",
    "market_radar_latest_variants",
  ])
  assert.equal(database.rpcCalls.filter((call) =>
    call.name === "get_seller_os_family_market_radar_v1").length, 1)
})

test("an unowned replay stops before planning and completion", async () => {
  const database = fakeSupabase({ claim: {
    outcome: "IDEMPOTENT_COMPLETED", status: "COMPLETED",
  } })
  let plannerCalls = 0
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client, environment: environment(),
    now: () => new Date("2026-08-23T15:00:00.000Z"),
    planner() { plannerCalls += 1; throw new Error("MUST_NOT_RUN") },
  })
  assert.equal(result.status, "IDEMPOTENT_SUCCESS")
  assert.equal(plannerCalls, 0)
  assert.equal(database.rpcCalls.some((call) =>
    call.name === "complete_seller_os_daily_dollar_radar_run_v1"), false)
})

test("durable blocked scheduler policy prevents a run claim", async () => {
  const database = fakeSupabase({ queueRead: {
    status: "UNAVAILABLE", resultCount: 0, entries: [], schedulerPolicy: {
      enabled: false, status: "BLOCKED_TIMEZONE_POLICY_UNPROVEN",
      businessTimeZone: null,
    },
  } })
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client, environment: environment(),
    now: () => new Date("2026-08-23T15:00:00.000Z"),
  })
  assert.equal(result.status, "SCHEDULER_STORAGE_POLICY_NOT_READY")
  assert.equal(database.rpcCalls.length, 1)
  assert.equal(database.rpcCalls[0].name,
    "get_seller_os_morning_dollar_opportunity_queue_v1")
})

test("completion persists only the bounded MORNING queue projection", async () => {
  const database = fakeSupabase()
  const familyId = `market-family-v1:sha256:${"1".repeat(64)}`
  const configurationId = `launch-configuration-v1:sha256:${"2".repeat(64)}`
  const frontierDigest = `sha256:${"3".repeat(64)}`
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client, environment: environment(),
    now: () => new Date("2026-08-23T15:00:00.000Z"),
    planner() {
      const frontier = { economicClassification: "ECONOMICALLY_RECOVERABLE" }
      return {
        inputFamilyCount: 1, logicalFamilyCount: 1, logicalMatchCount: 1,
        familyAssessments: [{ familyDemandStatus: "FAMILY_DEMAND_PROVEN",
          matches: [{ productFit: "STRONG", frontier }] }],
        queue: [{ rank: 1, queueEntryId: "engine-private-id", familyId,
          dollarPriorityRank: 1,
          familyName: "Test family",
          demandStatus: "FAMILY_DEMAND_PROVEN",
          demandEvidenceSummary: { demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE",
            soldComparableCount: 3, soldQuantityEvidence: 5,
            priceMedianUsd: 27.17, limitations: [],
            evidenceReference:
              `family-market-observation-v1:sha256:${"5".repeat(64)}`,
            evidenceDigest: `sha256:${"8".repeat(64)}` },
          opportunityCaseId: `opportunity-case-v1:sha256:${"4".repeat(64)}`,
          currentMarketObservationId:
            `family-market-observation-v1:sha256:${"5".repeat(64)}`,
          candidateId: "prelinked-candidate:test", configurationId,
          lunaProductId: "9220000000000", lunaVariantId: "48800000000000",
          topLunaProductId: "9220000000000",
          topLunaVariantId: "48800000000000",
          lunaSku: "LUNA-TEST", targetProfileDigest: `sha256:${"6".repeat(64)}`,
          exactProductVariantIdentity: true, productFit: "STRONG",
          competitionStatus: "UNPROVEN", frontierInterpretation: "PASSTHROUGH_I02V",
          economicClassification: "ECONOMICALLY_RECOVERABLE",
          dollarPriorityScore: 72, nextBestEvidence: "BETTER_PRICE_DISTRIBUTION",
          nextAction: "BETTER_PRICE_DISTRIBUTION",
          nextBestAction: "BETTER_PRICE_DISTRIBUTION",
          nextEvidenceValue: "HIGH", ebayEscalationRequired: true,
          buyerIntent: ["test intent"], buyerIntentTerms: ["test intent"],
          primaryKeyword: "test intent", primaryKeywords: ["test intent"],
          secondaryKeywords: [],
          targetProductProfileSummary: { contractVersion: "PROFILE_V1",
            profileDigest: `sha256:${"6".repeat(64)}`,
            authority: "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION",
            requiredAttributes: [], preferredAttributes: [] },
          contributionPathSummary: {
            marketPriceMedianUsd: 27.17, totalProductCostUsd: 10,
            shippingStatus: "SHIPPING_PROVISIONAL_RESERVE",
            provisionalShippingReserveUsd: 6.99,
            contributionProfitAtMarketMedianUsd: 4,
            contributionMarginAtMarketMedianPercent: 14,
            maxShippingAtTargetMarginUsd: 3,
            minSellingPriceAtTargetMarginUsd: 29,
            strongRecoverablePath: true,
            authority: "CANONICAL_I02V_FRONTIER_PASSTHROUGH" },
          currentHardBlockers: [], hardBlockers: [],
          shipping: { status: "SHIPPING_PROVISIONAL_RESERVE",
            provisionalReserveUsd: 6.99,
            provisionalReserveClaimedAsObserved: false },
          researchStatus: "READY_FOR_BOUNDED_EVIDENCE_ACQUISITION",
          needsFreshEbayVerification: true,
          ebayVerificationReason: "BETTER_PRICE_DISTRIBUTION",
          ebayVerificationPriority: "HIGH",
          ebayVerificationExpectedDecisionValue: "HIGH",
          ebayEscalationId: "ebay-read-escalation-v1:test",
          listingAuthorized: false, marketplaceWriteAllowed: false,
          p2MutationAllowed: false, frontierDigest }],
        ebayEscalations: [{}], autopilotDigest: `sha256:${"7".repeat(64)}`,
        runMetrics: { familiesEvaluated: 1, newFamiliesDiscovered: 0,
          demandProvenCount: 1, demandSupportedCount: 0, lunaMatchCount: 1,
          productFitStrongCount: 1, economicallyDeadCount: 0,
          economicallyRecoverableCount: 1, economicallyPromisingCount: 0,
          economicsUnprovenCount: 0, morningQueueCount: 1,
          needsFreshEbayVerificationCount: 1, ebayApiCalls: 0 },
      }
    },
  })
  assert.equal(result.status, "COMPLETED")
  const entry = database.rpcCalls.at(-1).parameters.p_entries[0]
  const expectedHash = createHash("sha256").update(
    `SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1\n${familyId}\n${configurationId}\n${frontierDigest}`,
  "utf8").digest("hex")
  assert.equal(entry.queueEntryId,
    `morning-dollar-queue-entry-v1:sha256:${expectedHash}`)
  assert.equal(entry.rank, 1)
  assert.equal(entry.dollarPriorityRank, entry.rank)
  assert.equal(entry.executionRoute, "BOUNDED_EBAY_EVIDENCE_ESCALATION")
  assert.equal(entry.demandEvidenceSummary.soldComparableCount, 3)
  assert.equal(entry.targetProductProfileSummary.authority,
    "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION")
  assert.equal(entry.contributionPathSummary.authority,
    "CANONICAL_I02V_FRONTIER_PASSTHROUGH")
  assert.equal(entry.listingAuthorized, false)
  assert.equal(entry.marketplaceWriteAllowed, false)
  assert.equal(entry.p2MutationAllowed, false)
  assert.deepEqual(entry.reasonCodes, entry.hardBlockers)
  assert.deepEqual(entry.currentHardBlockers, entry.hardBlockers)
  assert.deepEqual(Object.keys(entry).sort(), [
    "queueEntryId", "rank", "dollarPriorityRank", "familyId", "familyName",
    "opportunityCaseId",
    "currentMarketObservationId", "demandStatus", "demandEvidenceSummary",
    "candidateId", "configurationId", "lunaProductId", "lunaVariantId",
    "topLunaProductId", "topLunaVariantId", "lunaSku",
    "exactProductVariantIdentity", "productFit", "competitionStatus",
    "targetProfileDigest", "targetProductProfileSummary",
    "economicClassification", "dollarPriorityScore", "nextBestEvidence",
    "nextAction", "nextBestAction", "nextEvidenceValue", "buyerIntent",
    "buyerIntentTerms", "primaryKeyword", "primaryKeywords",
    "secondaryKeywords", "contributionPathSummary", "currentHardBlockers",
    "hardBlockers", "shipping", "researchStatus", "ebayEscalationRequired",
    "needsFreshEbayVerification", "ebayVerificationReason",
    "ebayVerificationPriority", "ebayVerificationExpectedDecisionValue",
    "ebayEscalationId", "executionRoute", "frontierDigest",
    "frontierInterpretation", "reasonCodes", "listingAuthorized",
    "marketplaceWriteAllowed", "p2MutationAllowed",
  ].sort())
})

test("planner failure is sanitized and recorded through the bounded fail RPC", async () => {
  const database = fakeSupabase()
  const result = await runSellerOsDailyDollarRadarAutopilotV1({
    supabase: database.client, environment: environment(),
    now: () => new Date("2026-08-23T15:00:00.000Z"),
    planner() { throw new Error("raw database detail that is not a safe code") },
  })
  assert.equal(result.status, "FAILED_CLOSED")
  assert.equal(result.errorCode, "DAILY_DOLLAR_RADAR_RUNTIME_FAILED")
  assert.equal(result.failureRecorded, true)
  const failed = database.rpcCalls.at(-1)
  assert.equal(failed.name, "fail_seller_os_daily_dollar_radar_run_v1")
  assert.equal(failed.parameters.p_error_code,
    "DAILY_DOLLAR_RADAR_RUNTIME_FAILED")
  assert.equal("retryable" in failed.parameters, false)
})

test("runtime and route have static guards against external/eBay/Luna clients", async () => {
  const runtimeSource = await readFile(new URL(
    "./ebay-daily-dollar-radar-autopilot-runtime-v1.ts", import.meta.url), "utf8")
  const routeSource = await readFile(new URL(
    "../../app/api/cron/daily-dollar-radar-autopilot/route.ts", import.meta.url),
  "utf8")
  const combined = `${runtimeSource}\n${routeSource}`
  for (const forbidden of ["fetch(", "GetSellerList", "GetMyeBaySelling",
    "GetItem", "getRateLimits", "api.ebay.com", "ebay-commercial-monitor",
    "luna-protected-session", "publishOffer", "reviseInventoryStatus",
    "inventory_quantity", ",available,"]) {
    assert.equal(combined.includes(forbidden), false, forbidden)
  }
  assert.match(routeSource, /CRON_SECRET/)
  assert.match(routeSource, /maxDuration = 300/)
  assert.match(routeSource, /getSupabaseAdminClient/)
  assert.match(routeSource, /runSellerOsDemandFirstBroadNetNightlyV1/)
  assert.match(routeSource, /\^\[A-Z\]\[A-Z0-9_\]\{2,119\}\$/)
  assert.match(routeSource, /safeFailureCode\(error\)/)
  assert.ok(routeSource.lastIndexOf("runSellerOsDemandFirstBroadNetNightlyV1") <
    routeSource.lastIndexOf("runSellerOsDailyDollarRadarAutopilotV1"))
  assert.doesNotMatch(routeSource, /Shipping|publishOffer|externalAlerts/)
})

test("POST-only scheduler is registered after business-time policy certification", async () => {
  const scheduler = await readFile(new URL(
    "../../supabase/migrations/20260905090044_seller_os_post_only_runtime_dispatch_v1.sql",
    import.meta.url,
  ), "utf8")
  const vercel = JSON.parse(await readFile(new URL(
    "../../vercel.json", import.meta.url,
  )))
  assert.match(scheduler,
    /DAILY_DOLLAR_RADAR_AUTOPILOT[\s\S]*\/api\/cron\/daily-dollar-radar-autopilot[\s\S]*0 9 \* \* \*/)
  assert.match(scheduler, /net\.http_post\(/)
  assert.equal("crons" in vercel, false)
})
