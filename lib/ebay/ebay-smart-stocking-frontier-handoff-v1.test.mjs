import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  buildCakeTurntableFrontierHandoffV1,
  CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1,
  persistCakeTurntableFrontierHandoffV1,
} = await import("./ebay-smart-stocking-frontier-handoff-v1.ts")
const {
  buildSmartStockingLearningProfileV1,
} = await import("./ebay-smart-stocking-learning-profile-v1.ts")

const accountKey = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const capturedAt = "2026-08-27T06:27:57.920Z"

function learningProfile() {
  return buildSmartStockingLearningProfileV1({
    scoreBreakdown: {
      marketDemandScore: 8,
      economicsPotentialScore: 18,
      merchandisingScore: 16,
      lunaAdvantageScore: 13,
      operationalSimplicityScore: 5,
      portfolioDiversificationScore: 4,
      evidenceQualityScore: 3,
    },
    riskPenalty: 10,
    whyPrioritized: ["Low-cost, clear Luna product with strong merchandising potential."],
    knownUncertainties: ["No canonical exact Sold comparable survived validation."],
    entrySnapshotOrigin: "RECORDED_BEFORE_COMMERCIALIZATION",
    decisionSnapshot: {
      launchPotentialScore: 57,
      launchTier: "PARK",
      evidenceProfile: ["ACTIVE_ASK_CONTEXT_ONLY", "EXACT_LUNA_PRODUCT_TRUTH"],
      finalEconomics: {
        status: "NOT_RUN",
        salePriceUsd: null,
        ebayFeesUsd: null,
        lunaProductCostUsd: 3.8,
        lunaShippingUsd: null,
        landedCostUsd: null,
        contributionProfitUsd: null,
        contributionMarginPercent: null,
        roiPercent: null,
        thresholdResult: "UNAVAILABLE",
      },
      rescueUsed: true,
      rescueType: "PRODUCT_TRUTH_ECONOMICS_RESCUE",
      whyPublishedOrParked: "Authoritative shipping remains the next decision-changing fact.",
      parkReason: "AUTHORITATIVE_SHIPPING_REQUIRED",
      reopenCondition: "Capture authoritative Luna shipping without purchase.",
    },
  })
}

function decisionPackage(overrides = {}) {
  return {
    packageId: CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.packageId,
    status: "GENERATED",
    packageHash: `sha256:${"b".repeat(64)}`,
    supplierSku: "ITEM3525",
    supplierVariantId: "48809646653664",
    gtin: "740119084743",
    normalizedProductName: "11 in revolving cake turntable",
    supplierPackageCostUsd: 3.8,
    packCount: null,
    complianceBlocked: false,
    learningProfile: learningProfile(),
    ...overrides,
  }
}

function researchTask(overrides = {}) {
  return {
    planId: CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.researchPlanId,
    planStatus: "COMPLETED",
    taskStatus: "PROCESSED",
    searchQuery: "740119084743 11 inch revolving plastic cake turntable non slip base",
    queryHash: `sha256:${"c".repeat(64)}`,
    categoryId: "183353",
    capturedAt,
    lastErrorCode: null,
    ...overrides,
  }
}

function lunaProduct(overrides = {}, variantOverrides = {}) {
  return {
    productId: "9220835475680",
    handle: "11in-revolving-plastic-cake-turntable-non-slip-base",
    title: "11\" Revolving Plastic Cake Turntable / Stand with Non-Slip Base",
    vendor: null,
    productType: null,
    canonicalUrl: "https://lunaportex.com/products/11in-revolving-plastic-cake-turntable-non-slip-base",
    imageUrls: [],
    sourceMode: "PUBLIC_READ_ONLY_PRODUCT_PAGE",
    sourceParserVersion: "SELLER_OS_LUNA_PUBLIC_PRODUCT_PARSER_V1",
    variants: [{
      id: "48809646653664",
      title: "Default Title",
      sku: "ITEM3525",
      sourceUnitBarcode: "740119084743",
      sourceUnitPrice: 3.8,
      sourceCompareAtPrice: null,
      available: true,
      weight: 401,
      weightUnit: null,
      ...variantOverrides,
    }],
    ...overrides,
  }
}

function build(overrides = {}) {
  return buildCakeTurntableFrontierHandoffV1({
    accountKey,
    decisionPackage: decisionPackage(overrides.decisionPackage),
    researchTask: researchTask(overrides.researchTask),
    lunaProduct: lunaProduct(overrides.lunaProduct, overrides.variant),
    evaluatedAt: "2026-08-27T07:00:00.000Z",
  })
}

test("exact Cake Turntable evidence creates one fail-closed Product Fit and frontier handoff", () => {
  const handoff = build()
  assert.match(handoff.familyId, /^market-family-v1:sha256:[0-9a-f]{64}$/)
  assert.match(handoff.configurationId, /^launch-configuration-v1:sha256:[0-9a-f]{64}$/)
  assert.match(handoff.candidateId, /^sha256:[0-9a-f]{64}$/)
  assert.equal(handoff.productFitStatus, "STRONG")
  assert.equal(handoff.opportunityCaseId, null)
  assert.equal(handoff.frontier.familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(handoff.frontier.productFit, "STRONG")
  assert.equal(handoff.frontier.lunaProductId, "9220835475680")
  assert.equal(handoff.frontier.lunaVariantId, "48809646653664")
  assert.equal(handoff.frontier.lunaSku, "ITEM3525")
  assert.equal(handoff.frontier.lunaUnitCost, 3.8)
  assert.equal(handoff.frontier.supplierQuantityRequired, 1)
  assert.equal(handoff.frontier.marketPriceMedian, 21.99)
  assert.equal(handoff.maximumShippingAtTargetUsd, 7.44)
  assert.deepEqual(handoff.productTruthLimitations,
    ["LUNA_PUBLIC_WEIGHT_UNIT_UNAVAILABLE"])
  assert.equal(handoff.frontier.shippingStatus, "SHIPPING_UNPROVEN")
  assert.equal(handoff.frontier.shippingValue, null)
  assert.equal(handoff.frontier.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
  assert.equal(handoff.frontier.unknownShippingTreatedAsZero, false)
  assert.equal(handoff.frontier.listingAuthorized, false)
  assert.equal(handoff.marketPriceEvidenceSemantics,
    "ACTIVE_ASK_CONTEXT_DERIVED_NOT_SOLD")
  assert.equal(handoff.realizedTransactionPriceStatus, "UNPROVEN")
  assert.equal(handoff.persistence.sourceUpdatedAt, capturedAt)
  assert.equal(handoff.safety.entrySnapshotImmutable, true)
  assert.equal(handoff.safety.shippingCaptureExecuted, false)
  assert.equal(handoff.safety.purchaseExecuted, false)
  assert.equal(handoff.safety.marketplaceWrites, 0)
})

test("exact package, plan and live Luna identities fail closed independently", () => {
  assert.throws(() => build({ decisionPackage: { gtin: "740119084744" } }),
    /CAKE_TURNTABLE_DECISION_PACKAGE_IDENTITY_INVALID/)
  assert.throws(() => build({ researchTask: { planStatus: "ACTIVE" } }),
    /CAKE_TURNTABLE_RESEARCH_TASK_BINDING_INVALID/)
  assert.throws(() => build({ researchTask: { categoryId: "999" } }),
    /CAKE_TURNTABLE_RESEARCH_TASK_BINDING_INVALID/)
  assert.throws(() => build({ variant: { sku: "OTHER" } }),
    /CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID/)
  assert.throws(() => build({ variant: { sourceUnitPrice: 4.2 } }),
    /CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID/)
  assert.throws(() => build({ variant: { available: false } }),
    /CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID/)
  assert.throws(() => build({ variant: { weightUnit: "oz" } }),
    /CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID/)
  assert.throws(() => build({ lunaProduct: { title: "Different product" } }),
    /CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID/)
})

test("tampering with immutable ENTRY score is rejected before materialization", () => {
  const profile = learningProfile()
  const tampered = structuredClone(profile)
  tampered.entrySnapshot.entryPotentialScore = 58
  assert.throws(() => build({ decisionPackage: { learningProfile: tampered } }),
    /SMART_STOCKING_PROFILE_INTEGRITY_MISMATCH/)
})

function supabaseFor(handoff, options = {}) {
  const calls = []
  const snapshotDigest = `sha256:${"d".repeat(64)}`
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args })
        if (name === "put_seller_os_profitability_frontier_v1") {
          return { data: {
            outcome: options.outcome ?? "CREATED",
            frontierId: `profitability-frontier-v1:sha256:${"e".repeat(64)}`,
            snapshotDigest,
          }, error: options.writeError ?? null }
        }
        if (name === "get_seller_os_latest_profitability_frontiers_v1") {
          return { data: { frontiers: options.readbackMissing ? [] : [{
            snapshotDigest,
            frontier: handoff.frontier,
          }] }, error: options.readError ?? null }
        }
        throw new Error(`UNEXPECTED_RPC_${name}`)
      },
    },
  }
}

function eligibleJob(handoff, overrides = {}) {
  return {
    identity: {
      candidateId: handoff.candidateId,
      canonicalProductUrl: "https://lunaportex.com/products/cake-turntable",
      lunaProductId: "9220835475680",
      lunaVariantId: "48809646653664",
      supplierSku: "ITEM3525",
      quantity: 1,
    },
    salePriceUsd: 21.99,
    supplierCostUsd: 3.8,
    ...overrides,
  }
}

test("existing frontier RPC, durable readback and actual shipping resolver contract materialize eligibility", async () => {
  const handoff = build()
  const fake = supabaseFor(handoff)
  const result = await persistCakeTurntableFrontierHandoffV1({
    supabase: fake.client,
    accountKey,
    handoff,
    sessionSecret: "s".repeat(32),
    resolveShippingJobs: async () => [eligibleJob(handoff)],
  })
  assert.deepEqual(fake.calls.map((call) => call.name), [
    "put_seller_os_profitability_frontier_v1",
    "get_seller_os_latest_profitability_frontiers_v1",
  ])
  assert.equal(fake.calls[0].args.p_opportunity_case_id, null)
  assert.equal(fake.calls[0].args.p_frontier.productFit, "STRONG")
  assert.deepEqual(fake.calls[1].args.p_family_ids, [handoff.familyId])
  assert.equal(result.exactCandidateHandoff, true)
  assert.equal(result.productFitMaterialized, true)
  assert.equal(result.profitabilityFrontierMaterialized, true)
  assert.equal(result.shippingCanaryEligible, true)
  assert.equal(result.candidateId, handoff.candidateId)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(result.shippingCaptureExecuted, false)
  assert.equal(result.purchaseExecuted, false)
})

test("frontier replay is idempotent but readback and exact shipping eligibility remain mandatory", async () => {
  const handoff = build()
  const replay = supabaseFor(handoff, { outcome: "IDEMPOTENT_SUCCESS" })
  const replayed = await persistCakeTurntableFrontierHandoffV1({
    supabase: replay.client,
    accountKey,
    handoff,
    sessionSecret: "s".repeat(32),
    resolveShippingJobs: async () => [eligibleJob(handoff)],
  })
  assert.equal(replayed.durableReadback, "PASS")

  const missing = supabaseFor(handoff, { readbackMissing: true })
  await assert.rejects(() => persistCakeTurntableFrontierHandoffV1({
    supabase: missing.client,
    accountKey,
    handoff,
    sessionSecret: "s".repeat(32),
    resolveShippingJobs: async () => [eligibleJob(handoff)],
  }), /CAKE_TURNTABLE_FRONTIER_DURABLE_READBACK_FAILED/)

  const wrongJob = supabaseFor(handoff)
  await assert.rejects(() => persistCakeTurntableFrontierHandoffV1({
    supabase: wrongJob.client,
    accountKey,
    handoff,
    sessionSecret: "s".repeat(32),
    resolveShippingJobs: async () => [eligibleJob(handoff, { salePriceUsd: 20.99 })],
  }), /CAKE_TURNTABLE_SHIPPING_CANARY_NOT_ELIGIBLE/)
})

test("handoff adds no schema, Product Case, capture, purchase or marketplace-write path", () => {
  const source = readFileSync(new URL(
    "./ebay-smart-stocking-frontier-handoff-v1.ts",
    import.meta.url,
  ), "utf8")
  assert.doesNotMatch(source, /create table|alter table|from\(["']opportunity_cases/i)
  assert.doesNotMatch(source, /persistLunaChromeShippingCaptureV1/)
  assert.doesNotMatch(source, /createOrReplaceInventoryItem|createOffer|publishOffer/i)
  assert.match(source, /put_seller_os_profitability_frontier_v1/)
  assert.match(source, /resolveLunaChromeShippingJobsV1/)
  assert.match(source, /shippingCaptureExecuted: false/)
  assert.match(source, /purchaseExecuted: false/)
  assert.match(source, /marketplaceWrites: 0/)
})
