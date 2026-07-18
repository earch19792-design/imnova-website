import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  EBAY_CATEGORY_LEARNING_POLICY,
  collectOwnEbayPerformanceForLearning,
  getEbayCategoryLearningActivationConfiguration,
  loadEbayCategoryLearningAdjustments,
} from "./ebay-category-performance-learning.ts"
import {
  assertEbayStrategicAdvisorPreviewActivation,
  getEbayStrategicAdvisorConfiguration,
} from "./ebay-strategic-advisor.ts"

const previewBoundary = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
  NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
}

test("performance learning remains closed until every Preview activation gate matches", () => {
  const enabled = {
    ...previewBoundary,
    EBAY_CATEGORY_PERFORMANCE_LEARNING_PREVIEW_ENABLED: "true",
  }
  assert.equal(getEbayCategoryLearningActivationConfiguration({}).active, false)
  assert.equal(getEbayCategoryLearningActivationConfiguration({
    ...enabled,
    VERCEL_ENV: "production",
  }).active, false)
  assert.equal(getEbayCategoryLearningActivationConfiguration({
    ...enabled,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  }).active, false)
  assert.equal(getEbayCategoryLearningActivationConfiguration({
    ...enabled,
    VERCEL_GIT_COMMIT_REF: "main",
  }).active, false)

  const configuration = getEbayCategoryLearningActivationConfiguration(enabled)
  assert.equal(configuration.status, "ACTIVE_PREVIEW_ONLY")
  assert.equal(configuration.active, true)
  assert.equal(configuration.safety.verifiedOwnListingsOnly, true)
  assert.equal(configuration.safety.ebayWrites, 0)
  assert.equal(configuration.safety.openAiCalls, 0)
  assert.equal(configuration.safety.automaticPriceChanges, 0)
  assert.equal(configuration.safety.automaticDeployments, 0)
})

test("disabled learning touches neither the database nor an external reader", async () => {
  const database = {
    from() {
      throw new Error("DATABASE_MUST_NOT_BE_TOUCHED")
    },
  }
  const result = await collectOwnEbayPerformanceForLearning(database, {
    environment: {
      ...previewBoundary,
      EBAY_CATEGORY_PERFORMANCE_LEARNING_PREVIEW_ENABLED: "false",
    },
  })
  assert.equal(result.status, "PREVIEW_LEARNING_DISABLED")
  assert.equal(result.persistencePerformed, false)
  assert.equal(result.externalReadsPerformed, false)
  assert.equal(result.rankingAdjustmentApplied, false)

  const adjustments = await loadEbayCategoryLearningAdjustments(
    database,
    "TEST-ENGINE",
    { environment: {} },
  )
  assert.deepEqual(adjustments, {})
})

test("the conservative learning sample and adjustment caps remain unchanged", () => {
  assert.deepEqual(EBAY_CATEGORY_LEARNING_POLICY, {
    minimumLinkedListings: 10,
    minimumObservationDays: 14,
    minimumTotalImpressions: 500,
    maximumAdjustmentPoints: 5,
    fullReliabilityLinkedListings: 20,
    fullReliabilityObservationDays: 28,
    fullReliabilityImpressions: 2_000,
    neutralClickThroughRatePercent: 3,
    neutralSalesConversionRatePercent: 4,
    clickThroughWeight: 0.4,
    salesConversionWeight: 0.6,
  })
})

test("strategic advisor Preview activation never implies OpenAI activation", () => {
  const environment = {
    ...previewBoundary,
    EBAY_STRATEGIC_ADVISOR_PREVIEW_ENABLED: "true",
  }
  const configuration = getEbayStrategicAdvisorConfiguration(environment)
  assert.equal(configuration.activationStatus, "ACTIVE_PREVIEW_ONLY")
  assert.equal(configuration.previewReady, true)
  assert.equal(configuration.openAiEnabled, false)
  assert.equal(configuration.realReady, false)
  assert.equal(configuration.ebayWritesAllowed, false)
  assert.equal(configuration.automaticPriceChangesAllowed, false)
  assert.equal(configuration.automaticDeploymentsAllowed, false)
  assert.equal(configuration.proposalsRequireSecondOperatorApproval, true)
  assert.doesNotThrow(() =>
    assertEbayStrategicAdvisorPreviewActivation(environment))
  assert.throws(
    () => assertEbayStrategicAdvisorPreviewActivation({
      ...environment,
      VERCEL_ENV: "production",
    }),
    /STRATEGIC_ADVISOR_PREVIEW_ACTIVATION_REQUIRED/,
  )
})

test("routes and service expose the gate without adding an executor", () => {
  const learningCron = fs.readFileSync(
    "app/api/cron/ebay-seller-performance-learning/route.ts",
    "utf8",
  )
  const advisorRoute = fs.readFileSync(
    "app/api/admin/ebay/strategic-advisor/route.ts",
    "utf8",
  )
  const advisorService = fs.readFileSync(
    "lib/ebay/ebay-strategic-advisor-service.ts",
    "utf8",
  )
  const activationIndex = learningCron.indexOf(
    "getEbayCategoryLearningActivationConfiguration()",
  )
  const databaseIndex = learningCron.indexOf("getSupabaseAdminClient()")
  assert.ok(activationIndex >= 0)
  assert.ok(databaseIndex > activationIndex)
  assert.match(learningCron, /EBAY_PERFORMANCE_LEARNING_CRON_FAILED/)
  assert.doesNotMatch(
    learningCron,
    /OPENAI_API_KEY|api\.openai\.com|ReviseItem|publishOffer|createOffer/,
  )

  assert.match(advisorRoute, /assertEbayStrategicAdvisorPreviewActivation\(\)/)
  assert.doesNotMatch(
    advisorRoute,
    /invokeApprovedEbayStrategicAdvisor|api\.openai\.com|ReviseItem|publishOffer|createOffer/,
  )
  assert.match(advisorService, /\.from\("ebay_manual_listing_links"\)/)
  assert.match(advisorService, /\.eq\("verification_status", "verified"\)/)
  assert.match(advisorService, /STRATEGIC_ADVISOR_VERIFIED_OWN_LISTING_REQUIRED/)
  assert.match(advisorService, /nextHumanAction: "APPROVE_OPENAI_API_SPEND"/)
  assert.match(
    advisorService,
    /nextHumanAction: "APPROVE_ONE_VARIABLE_MANUAL_EXPERIMENT"/,
  )
  for (const mutationName of [
    "createEbayStrategicAdvisorRun",
    "decideEbayStrategicAdvisorOpenAiSpend",
    "recordEbayStrategicAdvisorProposal",
    "decideEbayStrategicAdvisorManualExperiment",
  ]) {
    const mutationStart = advisorService.indexOf(
      `export async function ${mutationName}`,
    )
    const nextExport = advisorService.indexOf(
      "\nexport async function ",
      mutationStart + 1,
    )
    const mutation = advisorService.slice(
      mutationStart,
      nextExport < 0 ? advisorService.length : nextExport,
    )
    const gateIndex = mutation.indexOf(
      "assertEbayStrategicAdvisorPreviewActivation",
    )
    const databaseReadIndex = mutation.search(
      /loadServerVerifiedEvidence|input\.supabase\.(?:from|rpc)/,
    )
    assert.ok(mutationStart >= 0, `${mutationName} must exist`)
    assert.ok(gateIndex >= 0, `${mutationName} must enforce Preview activation`)
    assert.ok(
      databaseReadIndex < 0 || gateIndex < databaseReadIndex,
      `${mutationName} must reject before touching the database`,
    )
  }
  assert.doesNotMatch(
    advisorService,
    /ReviseItem|publishOffer|createOffer|automaticDeploy|autoDeploy/,
  )
})
