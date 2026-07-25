import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildTop20TargetManifest,
  calculateTop20RateLimitPause,
  compareTop20ClaimedTargets,
  createTop20ContinuationToken,
  evaluateTop20DiscoveryPreselection,
  getTop20AutomationConfiguration,
  hashTop20ContinuationToken,
  isTop20RateLimitError,
  shouldRecoverEmptyTop20Completion,
  shouldRecoverIncompleteTop20Completion,
  shouldReanalyzeTop20ForPolicyUpgrade,
  top20ReanalysisScope,
  top20ReleasedTargetStatus,
  verifyTop20ContinuationToken,
} from "./ebay-listing-ai-top20-automation.ts"
import { parseEbayRetryAfter } from "./ebay-readonly-rate-limit.ts"
import {
  classifyTop20DispatchError,
  classifyTop20DispatchHttp,
  dispatchTop20ContinuationHttp,
  publishTop20ContinuationQueue,
  Top20DispatchFailure,
} from "./ebay-listing-ai-top20-dispatch.ts"
import {
  classifyEbayFirstLunaMatch,
  ebayFirstEvidenceSnapshot,
  matchEbayFirstProductsToLuna,
} from "./ebay-listing-ai-hybrid-discovery.ts"

function candidate(index, overrides = {}) {
  return {
    productId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    supplierProductId: `product-${index}`,
    supplierVariantId: `variant-${index}`,
    supplierSku: `SKU-${index}`,
    priorityScore: 2_000 - index,
    ...overrides,
  }
}

test("selective sold-evidence targets retain priority after the claim RPC", () => {
  const targets = [
    { ordinal: 1, evidence_reanalysis_priority: 0, supplier_sku: "UNRELATED" },
    { ordinal: 900, evidence_reanalysis_priority: 100, supplier_sku: "ITEM3995" },
    { ordinal: 2, evidence_reanalysis_priority: null, supplier_sku: "ALSO_UNRELATED" },
  ]

  targets.sort(compareTop20ClaimedTargets)

  assert.deepEqual(targets.map((target) => target.supplier_sku), [
    "ITEM3995",
    "UNRELATED",
    "ALSO_UNRELATED",
  ])
})

test("1,513 variants are deduplicated and ordered Radar, prior intelligence, then catalog", () => {
  const catalog = Array.from({ length: 1_513 }, (_, index) => candidate(index + 1))
  catalog.push(candidate(2, { productId: "duplicate-row" }))
  const radar = catalog.slice(10, 15).map((row) => row.productId)
  const prior = catalog.slice(100, 170).map((row) => row.productId)
  const manifest = buildTop20TargetManifest({
    catalog, radarProductIds: radar, priorIntelligenceProductIds: prior,
  })
  assert.equal(manifest.length, 1_513)
  assert.equal(manifest.filter((row) => row.source === "RADAR_TOP5").length, 5)
  assert.equal(manifest.filter((row) => row.source === "PRIOR_INTELLIGENCE").length, 70)
  assert.ok(manifest.slice(0, 5).every((row) => row.source === "RADAR_TOP5"))
  assert.ok(manifest.slice(5, 75).every((row) => row.source === "PRIOR_INTELLIGENCE"))
  assert.deepEqual(manifest.map((row) => row.ordinal),
    Array.from({ length: 1_513 }, (_, index) => index))
})

test("continuation token is unpredictable, hashed, and rejects reuse with another token", () => {
  const first = createTop20ContinuationToken()
  const second = createTop20ContinuationToken()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
  const hash = hashTop20ContinuationToken(first)
  assert.match(hash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(verifyTop20ContinuationToken(first, hash), true)
  assert.equal(verifyTop20ContinuationToken(second, hash), false)
})

test("batch, time budget, preselection, and continuation limits are bounded server-side", () => {
  const configuration = getTop20AutomationConfiguration({
    EBAY_LISTING_TOP20_BATCH_SIZE: "999",
    EBAY_LISTING_TOP20_TIME_BUDGET_SECONDS: "999",
    EBAY_LISTING_TOP20_PRESELECTION_SIZE: "999",
    EBAY_LISTING_TOP20_MAX_CONTINUATIONS: "99999",
  })
  assert.equal(configuration.batchSize, 10)
  assert.equal(configuration.timeBudgetSeconds, 240)
  assert.equal(configuration.preselectionSize, 100)
  assert.equal(configuration.maxContinuations, 5_000)
  assert.equal(configuration.automaticCronEnabled, false)
})

test("eBay 429 and sanitized rate-limit errors pause the run", () => {
  assert.equal(isTop20RateLimitError(new Error("EBAY_READONLY_GET_429")), true)
  assert.equal(isTop20RateLimitError(new Error("LISTING_AI_RATE_LIMITED")), true)
  assert.equal(isTop20RateLimitError(new Error("EBAY_READONLY_GET_500")), false)
})

test("Retry-After seconds and HTTP dates are normalized without retaining raw headers", () => {
  assert.deepEqual(parseEbayRetryAfter("120", Date.parse("2026-07-17T13:00:00Z")), {
    retryAfterSeconds: 120,
    retryAfterSource: "RETRY_AFTER_SECONDS",
  })
  assert.deepEqual(parseEbayRetryAfter(
    "Fri, 17 Jul 2026 13:05:00 GMT",
    Date.parse("2026-07-17T13:00:00Z"),
  ), {
    retryAfterSeconds: 300,
    retryAfterSource: "RETRY_AFTER_HTTP_DATE",
  })
  assert.deepEqual(parseEbayRetryAfter("secret-or-malformed", 0), {
    retryAfterSeconds: null,
    retryAfterSource: "UNAVAILABLE",
  })
})

test("Top 20 rate-limit pause respects official delay and escalates missing hints", () => {
  const now = new Date("2026-07-17T13:00:00Z")
  const official = calculateTop20RateLimitPause({
    now,
    previousConsecutiveCount: 0,
    retryAfterSeconds: 3_600,
    retryAfterSource: "RETRY_AFTER_SECONDS",
    random: () => 0,
  })
  assert.equal(official.consecutiveCount, 1)
  assert.equal(official.backoffSeconds, 3_605)
  assert.equal(official.nextRetryAt, "2026-07-17T14:00:05.000Z")
  assert.equal(official.source, "RETRY_AFTER_SECONDS")

  const adaptive = calculateTop20RateLimitPause({
    now,
    previousConsecutiveCount: 3,
    retryAfterSeconds: null,
    retryAfterSource: "UNAVAILABLE",
    random: () => 0,
  })
  assert.equal(adaptive.consecutiveCount, 4)
  assert.equal(adaptive.backoffSeconds, 7_200)
  assert.equal(adaptive.source, "ADAPTIVE_BACKOFF")
  assert.equal(adaptive.nextRetryAt, "2026-07-17T15:00:00.000Z")
})

test("sold evidence reanalysis stays selective while policy upgrades stay full", () => {
  assert.equal(top20ReanalysisScope({
    policyUpgradeNeedsReanalysis: false,
    soldEvidenceNeedsReanalysis: true,
  }), "SELECTIVE_SOLD_EVIDENCE")
  assert.equal(top20ReanalysisScope({
    policyUpgradeNeedsReanalysis: true,
    soldEvidenceNeedsReanalysis: true,
  }), "FULL_POLICY_UPGRADE")
  assert.equal(top20ReanalysisScope({
    policyUpgradeNeedsReanalysis: false,
    soldEvidenceNeedsReanalysis: false,
  }), "NONE")
})

test("released work remains claimable in its current phase", () => {
  assert.equal(top20ReleasedTargetStatus("DISCOVERY"), "PENDING")
  assert.equal(top20ReleasedTargetStatus("LOOP1_ANALYSIS"), "PRESELECTED")
})

test("provisional discovery identity reaches Loop 1 without weakening READY gates", () => {
  const provisional = evaluateTop20DiscoveryPreselection({
    supplierAvailable: true,
    returnedCandidateCount: 50,
    discoveryScore: 52,
    identitySignalScore: 20,
    riskCodes: ["WEAK_DISCOVERY_IDENTITY_SIGNAL"],
  })
  assert.equal(provisional.eligible, true)
  assert.equal(provisional.identityStatus, "LOOP1_ENRICHMENT_REQUIRED")
  assert.deepEqual(provisional.reasons, [])

  const insufficient = evaluateTop20DiscoveryPreselection({
    supplierAvailable: true,
    returnedCandidateCount: 50,
    discoveryScore: 52,
    identitySignalScore: 14,
    riskCodes: ["WEAK_DISCOVERY_IDENTITY_SIGNAL"],
  })
  assert.equal(insufficient.eligible, false)
  assert.match(insufficient.reasons.join(","), /DISCOVERY_IDENTITY_SIGNAL_INSUFFICIENT/)
})

test("discovery still blocks no-match, unavailable, and compliance-risk products", () => {
  for (const input of [
    { supplierAvailable: false, returnedCandidateCount: 50, riskCodes: ["LUNA_OUT_OF_STOCK"] },
    { supplierAvailable: true, returnedCandidateCount: 0, riskCodes: ["NO_EBAY_CANDIDATES"] },
    { supplierAvailable: true, returnedCandidateCount: 50, riskCodes: ["COMPLIANCE_BLOCKED"] },
  ]) {
    assert.equal(evaluateTop20DiscoveryPreselection({
      ...input, discoveryScore: 60, identitySignalScore: 25,
    }).eligible, false)
  }
})

test("a completed zero-output run is recoverable without repeating Discovery", () => {
  assert.equal(shouldRecoverEmptyTop20Completion({
    automationStatus: "COMPLETED", catalogTotal: 1_513, discoveryExamined: 1_513,
    preselected: 0, deepAnalyzed: 0, ready: 0,
  }), true)
  assert.equal(shouldRecoverEmptyTop20Completion({
    automationStatus: "COMPLETED", catalogTotal: 1_513, discoveryExamined: 1_513,
    preselected: 70, deepAnalyzed: 70, ready: 0,
  }), false)
})

test("a completed run with stranded preselected targets resumes Loop 1", () => {
  assert.equal(shouldRecoverIncompleteTop20Completion({
    automationStatus: "COMPLETED", preselected: 70, deepAnalyzed: 3,
  }), true)
  assert.equal(shouldRecoverIncompleteTop20Completion({
    automationStatus: "COMPLETED", preselected: 70, deepAnalyzed: 70,
  }), false)
})

test("a completed run reuses Discovery when the enrichment policy changes", () => {
  assert.equal(shouldReanalyzeTop20ForPolicyUpgrade({
    automationStatus: "COMPLETED", preselected: 70,
    persistedVersion: "V1", currentVersion: "V2",
  }), true)
  assert.equal(shouldReanalyzeTop20ForPolicyUpgrade({
    automationStatus: "COMPLETED", preselected: 70,
    persistedVersion: "V2", currentVersion: "V2",
  }), false)
})

test("a policy upgrade also reopens a paused run instead of mixing versions", () => {
  assert.equal(shouldReanalyzeTop20ForPolicyUpgrade({
    automationStatus: "PAUSED_RATE_LIMIT", preselected: 70,
    persistedVersion: "V1", currentVersion: "V2",
  }), true)
  assert.equal(shouldReanalyzeTop20ForPolicyUpgrade({
    automationStatus: "FAILED", preselected: 70,
    persistedVersion: "V1", currentVersion: "V2",
  }), false)
})

test("one-click route publishes a durable queue continuation and never accepts client batch size", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/listing-ai/approval-queue/route.ts", import.meta.url,
  ), "utf8")
  const continuation = readFileSync(new URL(
    "../../app/api/admin/ebay/listing-ai/approval-queue/continue/route.ts", import.meta.url,
  ), "utf8")
  const consumer = readFileSync(new URL(
    "../../app/api/queues/ebay-listing-top20-continuation/route.ts", import.meta.url,
  ), "utf8")
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"))
  assert.match(route, /startListingAiApprovalQueueScan/)
  assert.match(route, /enqueueListingAiTop20Continuation/)
  assert.doesNotMatch(route, /after\(async|fetch\(new URL\(CONTINUATION_PATH/)
  assert.doesNotMatch(route, /body\.batchSize/)
  assert.match(continuation, /validateListingAiApprovalQueueContinuation/)
  assert.match(continuation, /continueListingAiApprovalQueueScan/)
  assert.match(continuation, /maxDuration = 300/)
  assert.match(consumer, /handleCallback/)
  assert.match(consumer, /continueListingAiApprovalQueueScanFromQueue/)
  assert.equal(vercel.functions["app/api/queues/ebay-listing-top20-continuation/route.ts"]
    .experimentalTriggers[0].type, "queue/v2beta")
  assert.doesNotMatch(route, /continuationToken:\s*result\.continuationToken/)
})

test("dispatch classifies Deployment Protection, auth, token, rate limits, and server errors", () => {
  assert.equal(classifyTop20DispatchHttp({ status: 401, protectionRejected: true }), "PROTECTION_REJECTED")
  assert.equal(classifyTop20DispatchHttp({ status: 403 }), "AUTH_REJECTED")
  assert.equal(classifyTop20DispatchHttp({ status: 409,
    errorCode: "TOP20_CONTINUATION_TOKEN_REJECTED" }), "TOKEN_REJECTED")
  assert.equal(classifyTop20DispatchHttp({ status: 429 }), "RATE_LIMITED")
  assert.equal(classifyTop20DispatchHttp({ status: 500 }), "SERVER_ERROR")
  assert.equal(classifyTop20DispatchError(new DOMException("timed out", "TimeoutError")), "TIMEOUT")
  assert.equal(classifyTop20DispatchError(new TypeError("fetch failed")), "NETWORK_ERROR")
})

test("HTTP dispatch records 401 Protection and 403 auth without retrying permanent rejection", async () => {
  for (const scenario of [
    { status: 401, headers: { "x-vercel-mitigated": "challenge" }, expected: "PROTECTION_REJECTED" },
    { status: 403, headers: {}, expected: "AUTH_REJECTED" },
  ]) {
    const diagnostics = []
    await assert.rejects(() => dispatchTop20ContinuationHttp({
      origin: "https://preview.example.vercel.app", runId: crypto.randomUUID(),
      token: createTop20ContinuationToken(), maxAttempts: 3,
      fetchImpl: async () => new Response(null, { status: scenario.status, headers: scenario.headers }),
      sleep: async () => undefined, onAttempt: (row) => diagnostics.push(row),
    }), Top20DispatchFailure)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].errorClass, scenario.expected)
    assert.equal(diagnostics[0].httpStatus, scenario.status)
  }
})

test("HTTP dispatch retries 429/500, timeout and network errors, then succeeds", async () => {
  const scenarios = [
    () => new Response(null, { status: 429 }),
    () => new Response(null, { status: 500 }),
    () => { throw new DOMException("timed out", "TimeoutError") },
    () => { throw new TypeError("fetch failed") },
    () => new Response(null, { status: 202, headers: { "x-vercel-id": "iad1::abc" } }),
  ]
  let cursor = 0
  const diagnostics = []
  const result = await dispatchTop20ContinuationHttp({
    origin: "https://preview.example.vercel.app", runId: crypto.randomUUID(),
    token: createTop20ContinuationToken(), maxAttempts: 5,
    fetchImpl: async () => scenarios[cursor++](), sleep: async () => undefined,
    random: () => 0, onAttempt: (row) => diagnostics.push(row),
  })
  assert.equal(result.outcome, "ACCEPTED")
  assert.deepEqual(diagnostics.map((row) => row.errorClass),
    ["RATE_LIMITED", "SERVER_ERROR", "TIMEOUT", "NETWORK_ERROR", null])
  assert.equal(result.xVercelId, "iad1::abc")
})

test("three failed dispatch attempts end recoverable and diagnostics contain no secrets", async () => {
  const diagnostics = []
  let failure
  try {
    await dispatchTop20ContinuationHttp({
      origin: "https://preview.example.vercel.app", runId: crypto.randomUUID(),
      token: createTop20ContinuationToken(), protectionBypass: "do-not-store-this",
      protectionCookie: "_vercel_jwt=do-not-store-this-either", maxAttempts: 3,
      fetchImpl: async () => { throw new TypeError("fetch failed") },
      sleep: async () => undefined, random: () => 0,
      onAttempt: (row) => diagnostics.push(row),
    })
  } catch (error) { failure = error }
  assert.ok(failure instanceof Top20DispatchFailure)
  assert.equal(failure.diagnostic.outcome, "PAUSED_RECOVERABLE")
  assert.equal(diagnostics.length, 3)
  assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-store-this|_vercel_jwt/)
})

test("Vercel Queue dispatch is idempotent, retries once, and never stores continuation tokens", async () => {
  const calls = []
  const diagnostics = []
  const result = await publishTop20ContinuationQueue({
    runId: crypto.randomUUID(), continuationGeneration: 2, expectedBatch: 5,
    attemptOffset: 4, deploymentHost: "preview.example.vercel.app",
    send: async (topic, message, options) => {
      calls.push({ topic, message, options })
      if (calls.length === 1) throw new TypeError("fetch failed")
      return { messageId: "queue-message-1" }
    },
    sleep: async () => undefined, random: () => 0,
    onAttempt: (row) => diagnostics.push(row),
  })
  assert.equal(result.outcome, "ACCEPTED")
  assert.equal(calls.length, 2)
  assert.equal(calls[1].message.expectedBatch, 5)
  assert.equal(calls[1].message.continuationToken, undefined)
  assert.match(calls[1].options.idempotencyKey, /^sha256:[0-9a-f]{16}$/)
  assert.deepEqual(diagnostics.map((row) => row.attemptNumber), [5, 6])
  assert.doesNotMatch(JSON.stringify(calls), /authorization|cookie|jwt|secret/i)
})

test("migration provides phase-aware SKIP LOCKED claims, checkpoints, and no permanent cron", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260717010000_automate_listing_ai_top20_scan.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /scan_phase in \('DISCOVERY','PRESELECTION','LOOP1_ANALYSIS','COMPLETED'\)/)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /RADAR_TOP5.*PRIOR_INTELLIGENCE.*LUNA_CATALOG/s)
  assert.match(migration, /continuation_token_hash/)
  assert.doesNotMatch(migration, /cron\.schedule|create extension.*pg_cron/i)
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i)
})

test("reliability migration adds recoverable dispatch audit without destructive operations", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260717013000_harden_top20_continuation_dispatch.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /PAUSED_DISPATCH_RECOVERABLE/)
  assert.match(migration, /marketplace_listing_approval_queue_dispatch_attempts/)
  assert.match(migration, /PROTECTION_REJECTED.*AUTH_REJECTED.*TOKEN_REJECTED.*RATE_LIMITED/s)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all.*anon, authenticated, service_role/is)
  assert.match(migration, /discovery_strategy in \('EBAY_FIRST','LUNA_FIRST'\)/)
  assert.match(migration, /order by[\s\S]*EBAY_FIRST[\s\S]*ebay_first_rank[\s\S]*for update skip locked/i)
  assert.doesNotMatch(migration, /drop table|delete from|truncate|cron\.schedule/i)
})

function hybridProduct(overrides = {}) {
  return {
    sourceKey: "official:signal:1", categoryId: "123", title: "Acme Lemon Wipes 15 Count",
    brand: "Acme", gtins: ["036000291452"], mpns: ["MODEL-15"],
    aspects: [
      { name: "Number in Pack", values: ["1"] },
      { name: "Scent", values: ["Lemon"] },
      { name: "Size", values: ["15 Count"] },
    ],
    demandEvidence: "ESTIMATED_MOVEMENT", demandConfidence: 62,
    sellerCount: null, activeListingCount: null, landedPriceRange: null,
    observedAt: "2026-07-17T00:00:00.000Z", ...overrides,
  }
}

function hybridLuna(overrides = {}) {
  return {
    productId: "00000000-0000-4000-8000-000000000001",
    supplierProductId: "luna-1", supplierVariantId: "variant-1", supplierSku: "SKU-1",
    productName: "Acme Lemon Wipes 15 Count", brand: "Acme", gtin: "036000291452",
    mpn: "MODEL-15", model: "MODEL-15", size: "15 Count", color: null,
    scent: "Lemon", variant: "Lemon", packCount: 1, available: true, ...overrides,
  }
}

test("eBay-first promotes only an exact Luna identity and excludes pack or variant conflicts", () => {
  assert.equal(classifyEbayFirstLunaMatch(hybridProduct(), hybridLuna()).status, "EXACT_LUNA_MATCH")
  assert.equal(classifyEbayFirstLunaMatch(hybridProduct({
    aspects: [{ name: "Number in Pack", values: ["3"] }],
  }), hybridLuna()).status, "DIFFERENT_PACK")
  assert.equal(classifyEbayFirstLunaMatch(hybridProduct({
    aspects: [{ name: "Scent", values: ["Fresh"] }, { name: "Number in Pack", values: ["1"] }],
  }), hybridLuna()).status, "DIFFERENT_VARIANT")
  assert.equal(matchEbayFirstProductsToLuna([hybridProduct()], [
    hybridLuna(), hybridLuna({ supplierVariantId: "variant-duplicate", supplierSku: "SKU-2" }),
  ])[0].match.status, "CONFLICTED")
})

test("eBay-first demand remains estimated and the persisted snapshot contains no competitor content", () => {
  const product = hybridProduct()
  const match = classifyEbayFirstLunaMatch(product, hybridLuna())
  const snapshot = ebayFirstEvidenceSnapshot({ product, match, rank: 1 })
  assert.equal(snapshot.demandEvidence, "ESTIMATED_MOVEMENT")
  assert.equal(snapshot.confirmedSoldEvidence, false)
  assert.equal(snapshot.estimatedMovementSeparated, true)
  assert.equal(snapshot.competitorTitleStored, false)
  assert.equal(snapshot.competitorImageStored, false)
  assert.doesNotMatch(JSON.stringify(snapshot), /Acme Lemon Wipes|https?:\/\//)
})

test("hybrid orchestrator attempts eBay-first before the Luna-first target batch", () => {
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  const ebayFirst = service.indexOf("await ensureEbayFirstDiscovery")
  const targetClaim = service.indexOf('.rpc("claim_marketplace_listing_top20_targets"', ebayFirst)
  assert.ok(ebayFirst > 0 && targetClaim > ebayFirst)
  assert.match(service, /discoverEbayBestSellingProducts/)
  assert.match(service, /Marketing BEST_SELLING is a product-level demand signal, not a confirmed sale/)
  assert.match(service, /luna_match_status:[\s\S]*EXACT_LUNA_MATCH|ebay_first_luna_match_status/)
  assert.match(service, /run\.ebay_first_status === "NOT_STARTED"/)
  assert.match(service, /TOP20_EBAY_FIRST_PRESELECTION_FAILED/)
  assert.match(service, /preselected_count: preselectedCount/)
  assert.match(service, /promotionCapacity = Math\.max\(0, 100 -/)
})

test("failed dispatch is recoverable, reuses the same run, rotates token, and preserves checkpoints", () => {
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  assert.match(service, /RECOVERABLE_DISPATCH_ERRORS/)
  assert.match(service, /continuation_generation:\s*nextGeneration/)
  assert.match(service, /dispatch_recovery_count/)
  assert.match(service, /last_checkpoint_at:\s*run\.last_checkpoint_at/)
  assert.match(service, /recoverableDispatch[\s\S]*run = latest/)
  assert.match(service, /currentBatch >= expectedBatch[\s\S]*duplicate: true/)
  assert.match(service, /TOP20_CONTINUATION_TOKEN_REJECTED/)
})

test("Discovery Scanner precedes deep Loop 1 and stores only aggregate competitor evidence", () => {
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  const gateway = readFileSync(new URL(
    "./ebay-seller-keyword-demand-gateway.ts", import.meta.url,
  ), "utf8")
  assert.match(service, /run\.scan_phase === "DISCOVERY"[\s\S]*runTop20DiscoveryBatch/)
  assert.match(service, /preselectTop20DiscoveryTargets/)
  assert.match(service, /run\.scan_phase !== "LOOP1_ANALYSIS"/)
  assert.match(gateway, /One Browse search per Luna variant/)
  assert.match(gateway, /fullCompetitorContentStored: false/)
  assert.doesNotMatch(gateway.match(/export async function discoverEbayListingSignals[\s\S]*?\n}\n/)?.[0] ?? "",
    /enrichActiveListing|searchSoldHistory/)
})

test("UI has one orchestration button, polling, READY-only results, and no PARTIAL click instruction", () => {
  const panel = readFileSync(new URL(
    "../../app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", import.meta.url,
  ), "utf8")
  const parent = readFileSync(new URL(
    "../../app/admin/ebay/mobile-review/loop2-listing-ai-panel.tsx", import.meta.url,
  ), "utf8")
  assert.match(panel, /Analizar y actualizar oportunidades/)
  assert.match(panel, /window\.setInterval/)
  assert.match(panel, /Puedes cerrar esta página\. Seller OS continuará automáticamente/)
  assert.match(panel, /Procesados por Loop 1/)
  assert.match(panel, /eBay-first:/)
  assert.match(panel, /item\.discovery_strategy/)
  assert.match(panel, /match Luna/)
  assert.match(panel, /Backoff adaptativo:/)
  assert.match(panel, /rate_limit\?\.backoffSeconds/)
  assert.match(panel, /Pausa ordenada por eBay, no fallo de Seller OS/)
  assert.match(panel, /Faltan aproximadamente/)
  assert.match(panel, /Seller OS no hará llamadas antes/)
  assert.match(panel, /Pausa eBay ·/)
  assert.match(panel, /Reanudar desde checkpoint/)
  assert.match(panel, /response\.result\.status === "PAUSED_RATE_LIMIT"/)
  assert.match(panel, /Abrir Product Research/)
  assert.match(panel, /Copiar consulta exacta/)
  assert.match(panel, /Copiar es únicamente un respaldo visible/)
  assert.doesNotMatch(panel, /Abrir próxima búsqueda · consulta copiada/)
  assert.doesNotMatch(panel, /vuelve a pulsar para continuar/i)
  assert.match(parent, /A · Radar anterior/)
  assert.match(parent, /B · Top 20 automatizado/)
  assert.match(parent, /Paquete Loop 1 actualmente seleccionado/)
  assert.match(parent, /Generaciones OpenAI/)
})

test("eBay 429 uses one sanitized signal and persists adaptive Top 20 backoff", () => {
  const gateway = readFileSync(new URL(
    "./ebay-seller-keyword-demand-gateway.ts", import.meta.url,
  ), "utf8")
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260717132000_harden_top20_ebay_rate_limit_backoff.sql",
    import.meta.url,
  ), "utf8")
  const rateLimit = readFileSync(new URL(
    "./ebay-readonly-rate-limit.ts", import.meta.url,
  ), "utf8")
  assert.match(gateway, /response\.status === 429[\s\S]*createEbayReadonlyRateLimitError/)
  assert.match(rateLimit, /response\.headers\.get\("retry-after"\)/)
  assert.doesNotMatch(rateLimit, /response\.headers\.get\("authorization"\)/i)
  assert.match(service, /calculateTop20RateLimitPause/)
  assert.match(service, /last_rate_limit_retry_after_seconds: rateLimitPause\.retryAfterSeconds/)
  assert.match(service, /next_retry_at: rateLimitPause\.nextRetryAt/)
  assert.match(service, /next_continuation_at:[\s\S]*rateLimitPause\?\.nextRetryAt/)
  assert.match(migration, /rate_limit_consecutive_count/)
  assert.match(migration, /last_rate_limit_backoff_seconds/)
  assert.match(migration, /add column if not exists rate_limit_consecutive_count/)
  assert.match(migration, /create index if not exists marketplace_listing_approval_queue_runs_rate_limit_idx/)
  assert.doesNotMatch(migration, /drop\s+(table|column)|truncate|delete\s+from/i)
})

test("selective sold evidence is prioritized without reopening unrelated targets", () => {
  const service = readFileSync(new URL(
    "./ebay-listing-ai-approval-queue-service.ts", import.meta.url,
  ), "utf8")
  const reconciliation = readFileSync(new URL(
    "./ebay-product-research-identity-reconciliation.ts", import.meta.url,
  ), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260717134000_prioritize_selective_sold_evidence_reanalysis.sql",
    import.meta.url,
  ), "utf8")
  assert.match(service, /top20ReanalysisScope/)
  assert.match(service, /reanalysisScope === "FULL_POLICY_UPGRADE"[\s\S]*TOP20_POLICY_REANALYSIS_RESTORE_FAILED/)
  assert.doesNotMatch(service, /if \(soldEvidenceNeedsReanalysis\)[\s\S]{0,500}TOP20_POLICY_REANALYSIS_RESTORE_FAILED/)
  assert.match(reconciliation, /evidence_reanalysis_priority: 100/)
  assert.match(reconciliation, /evidence_reanalysis_version: input\.soldEvidenceVersion/)
  assert.match(service, /evidence_reanalysis_priority: 0/)
  assert.match(service, /evidenceReanalysisRemaining/)
  assert.match(service, /sold_evidence_applied_version: \(evidenceReanalysisRemaining \?\? 0\) === 0/)
  assert.match(migration, /target\.evidence_reanalysis_priority desc/)
  assert.doesNotMatch(migration, /drop\s+(table|column)|truncate|delete\s+from/i)
})

test("automation path has zero OpenAI calls, drafts, publications, and eBay writes", () => {
  const files = [
    "./ebay-listing-ai-top20-automation.ts",
    "./ebay-listing-ai-approval-queue-service.ts",
    "../../app/api/admin/ebay/listing-ai/approval-queue/route.ts",
    "../../app/api/admin/ebay/listing-ai/approval-queue/continue/route.ts",
    "../../app/api/queues/ebay-listing-top20-continuation/route.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n")
  assert.doesNotMatch(files, /publishOffer|createDraft|shipping_fulfillment/)
  assert.doesNotMatch(files, /createRealOpenAi|generateListingAi/)
  assert.match(files, /openAiCalls: 0/)
  assert.match(files, /ebayWrites: 0/)
})
