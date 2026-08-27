import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildSellerOsMarketFamilyIdV1,
  normalizeSellerOsMarketFamilyIdentityV1,
} from "./ebay-prelinked-family-market-observation-v1"
import {
  buildSellerOsPrelinkedLaunchConfigurationV1,
} from "./ebay-prelinked-listing-fast-lane-foundation-v1"
import {
  calculateSellerOsProfitabilityFrontierV1,
} from "./ebay-prelinked-profitability-frontier-v1"
import {
  sellerOsShippingCandidateIdV1,
} from "./ebay-product-fit-durable-promotion-v1"
import {
  fetchPublicLunaProductForActiveListingMonitor,
} from "./ebay-targeted-active-listing-luna-monitor"
import type { DirectedLunaProduct } from "./ebay-luna-directed-product-import"
import {
  calculateEbayUnitEconomics,
  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
} from "./ebay-unit-economics"
import {
  readWinnerEvidenceDecisionPackage,
  winnerEvidencePreviewConfiguration,
} from "./ebay-winner-evidence-v2-service"
import {
  validateSmartStockingLearningProfileV1,
  type SmartStockingLearningProfile,
} from "./ebay-smart-stocking-learning-profile-v1"
import {
  resolveLunaChromeShippingJobsV1,
} from "./ebay-luna-chrome-shipping-capture-server-v1"

export const SELLER_OS_SMART_STOCKING_FRONTIER_HANDOFF_VERSION =
  "SELLER_OS_SMART_STOCKING_FRONTIER_HANDOFF_V1" as const

export const CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1 = Object.freeze({
  packageId: "67a72068-c052-4472-a022-9da7bb2b81bc",
  researchPlanId: "c99cbce0-cb00-4473-a6ba-d9a8abd9157e",
  lunaProductId: "9220835475680",
  lunaVariantId: "48809646653664",
  lunaSku: "ITEM3525",
  gtin: "740119084743",
  unitCostUsd: 3.80,
  weightGrams: 401,
  entryPotentialScore: 57,
  categoryId: "183353",
  familyName: "11 in revolving plastic cake turntable",
  familyIdentity: Object.freeze({
    productFunction: "11 in revolving plastic cake turntable",
    buyerUseCase: "cake decorating and serving",
    category: "ebay-us-category:183353",
    structuredDefinition: Object.freeze({
      "category id": "183353",
      feature: "non-slip base",
      material: "plastic",
      "nominal size": "11 in",
      "product family": "revolving cake turntable",
    }),
  }),
  activeAskPricesUsd: Object.freeze([16.50, 19.95, 20.00, 22.46, 24.99]),
  commercialPriceMatrixUsd: Object.freeze([19.99, 20.99, 21.99, 22.99]),
  targetPriceUsd: 21.99,
  maximumShippingAtTargetUsd: 7.44,
} as const)

type JsonRecord = Record<string, unknown>

export type CakeTurntableDecisionPackageEvidenceV1 = Readonly<{
  packageId: string
  status: string
  packageHash: string
  supplierSku: string
  supplierVariantId: string | null
  gtin: string | null
  normalizedProductName: string | null
  supplierPackageCostUsd: number | null
  packCount: number | null
  complianceBlocked: boolean
  learningProfile: SmartStockingLearningProfile
}>

export type CakeTurntableResearchTaskEvidenceV1 = Readonly<{
  planId: string
  planStatus: string
  taskStatus: string
  searchQuery: string
  queryHash: string
  categoryId: string | null
  capturedAt: string
  lastErrorCode: string | null
}>

export type CakeTurntableFrontierHandoffV1 = Readonly<{
  contractVersion: typeof SELLER_OS_SMART_STOCKING_FRONTIER_HANDOFF_VERSION
  packageId: string
  entrySnapshotHash: string
  familyId: string
  configurationId: string
  componentId: string
  candidateId: string
  productFitStatus: "STRONG"
  opportunityCaseId: null
  marketPriceEvidenceSemantics: "ACTIVE_ASK_CONTEXT_DERIVED_NOT_SOLD"
  realizedTransactionPriceStatus: "UNPROVEN"
  targetPriceUsd: number
  maximumShippingAtTargetUsd: number
  productTruthLimitations: readonly string[]
  frontier: ReturnType<typeof calculateSellerOsProfitabilityFrontierV1>
  persistence: Readonly<{
    marketPriceEvidenceReference: string
    marketPriceEvidenceDigest: string
    ebayFeePolicyReference: string
    economicPolicyReference: string
    economicPolicyDigest: string
    sourceUpdatedAt: string
    evidenceCutoffAt: string
  }>
  safety: Readonly<{
    entrySnapshotImmutable: true
    exactSoldClaimed: false
    activeAskTreatedAsRealizedPrice: false
    unknownShippingTreatedAsZero: false
    listingAuthorized: false
    shippingCaptureExecuted: false
    purchaseExecuted: false
    marketplaceWrites: 0
  }>
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
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

function finiteMoney(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
}

function exactInstant(value: string, code: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(code)
  return new Date(parsed).toISOString()
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function exactQueryMatches(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase()
  return normalized.includes(CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.gtin) &&
    normalized.includes("11 inch") && normalized.includes("revolving") &&
    normalized.includes("plastic") && normalized.includes("cake turntable") &&
    normalized.includes("non slip base")
}

function exactProductTitleMatches(value: string) {
  const source = value.normalize("NFKC").toLowerCase()
  const sizeMatches = /(?:^|\s)11\s*(?:"|in(?:ch)?\b)/.test(source)
  const normalized = source
    .replace(/[^a-z0-9]+/g, " ").trim()
  return sizeMatches && normalized.includes("revolving") &&
    normalized.includes("plastic") && normalized.includes("cake turntable") &&
    normalized.includes("non slip base")
}

export function buildCakeTurntableFrontierHandoffV1(input: Readonly<{
  accountKey: string
  decisionPackage: CakeTurntableDecisionPackageEvidenceV1
  researchTask: CakeTurntableResearchTaskEvidenceV1
  lunaProduct: DirectedLunaProduct
  evaluatedAt: string
}>): CakeTurntableFrontierHandoffV1 {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const accountKey = text(input.accountKey)
  if (!accountKey) throw new Error("CAKE_TURNTABLE_ACCOUNT_KEY_INVALID")
  const evaluatedAt = exactInstant(input.evaluatedAt,
    "CAKE_TURNTABLE_HANDOFF_EVALUATED_AT_INVALID")
  const decision = input.decisionPackage
  validateSmartStockingLearningProfileV1(decision.learningProfile)
  if (decision.packageId !== target.packageId || decision.status !== "GENERATED" ||
      !/^sha256:[0-9a-f]{64}$/.test(decision.packageHash) ||
      decision.supplierSku !== target.lunaSku ||
      decision.supplierVariantId !== target.lunaVariantId ||
      decision.gtin !== target.gtin ||
      decision.normalizedProductName !== "11 in revolving cake turntable" ||
      finiteMoney(decision.supplierPackageCostUsd) !== target.unitCostUsd ||
      ![null, 1].includes(decision.packCount) || decision.complianceBlocked ||
      decision.learningProfile.entrySnapshot.entryPotentialScore !==
        target.entryPotentialScore) {
    throw new Error("CAKE_TURNTABLE_DECISION_PACKAGE_IDENTITY_INVALID")
  }
  const task = input.researchTask
  if (task.planId !== target.researchPlanId || task.planStatus !== "COMPLETED" ||
      task.taskStatus !== "PROCESSED" || task.categoryId !== target.categoryId ||
      !/^sha256:[0-9a-f]{64}$/.test(task.queryHash) ||
      !Number.isFinite(Date.parse(task.capturedAt)) || task.lastErrorCode !== null ||
      !exactQueryMatches(task.searchQuery)) {
    throw new Error("CAKE_TURNTABLE_RESEARCH_TASK_BINDING_INVALID")
  }
  const product = input.lunaProduct
  const exactVariants = product.variants.filter((variant) =>
    variant.id === target.lunaVariantId && variant.sku === target.lunaSku)
  const variant = exactVariants[0]
  if (product.productId !== target.lunaProductId || exactVariants.length !== 1 ||
      product.sourceMode !== "PUBLIC_READ_ONLY_PRODUCT_PAGE" ||
      !exactProductTitleMatches(product.title) ||
      !/^https:\/\/(?:www\.)?lunaportex\.com\/products\//.test(
        product.canonicalUrl) ||
      variant.sourceUnitBarcode !== target.gtin ||
      finiteMoney(variant.sourceUnitPrice) !== target.unitCostUsd ||
      variant.weight !== target.weightGrams ||
      ![null, "g"].includes(variant.weightUnit) ||
      variant.available !== true) {
    throw new Error("CAKE_TURNTABLE_LUNA_PRODUCT_TRUTH_INVALID")
  }

  const configuration = buildSellerOsPrelinkedLaunchConfigurationV1({
    accountKey,
    marketplaceId: "EBAY_US",
    configurationMode: "SINGLE_COMPONENT",
    expectedComponentCount: 1,
    components: [{ lunaProductId: target.lunaProductId,
      lunaVariantId: target.lunaVariantId, lunaSku: target.lunaSku,
      supplierQuantityRequired: 1, supplierIdentityStatus: "EXACT_PRELINKED" }],
  })
  if (!configuration.complete || configuration.components.length !== 1) {
    throw new Error("CAKE_TURNTABLE_CONFIGURATION_INVALID")
  }
  const familyIdentity = normalizeSellerOsMarketFamilyIdentityV1(
    target.familyIdentity)
  const familyId = buildSellerOsMarketFamilyIdV1(familyIdentity)
  const candidateId = sellerOsShippingCandidateIdV1({ familyId,
    lunaProductId: target.lunaProductId,
    lunaVariantId: target.lunaVariantId, supplierSku: target.lunaSku })
  const component = configuration.components[0]
  const lunaEvidence = Object.freeze({
    contractVersion: product.sourceParserVersion ?? "SELLER_OS_LUNA_PUBLIC_PRODUCT_PARSER_V1",
    productId: product.productId,
    variantId: variant.id,
    sku: variant.sku,
    gtin: variant.sourceUnitBarcode,
    unitCostUsd: finiteMoney(variant.sourceUnitPrice),
    weightValue: variant.weight,
    weightUnit: variant.weightUnit,
    weightGrams: variant.weightUnit === "g" ? variant.weight : null,
    weightUnitStatus: variant.weightUnit === "g" ? "PROVEN_GRAMS" :
      "UNIT_UNPROVEN",
    available: variant.available,
    canonicalUrl: product.canonicalUrl,
    observedAt: evaluatedAt,
  })
  const lunaEvidenceDigest = digest(lunaEvidence)
  const priceEvidence = Object.freeze({
    evidenceClass: "ACTIVE_ASK_CONTEXT_ONLY",
    activeAskPricesUsd: target.activeAskPricesUsd,
    commercialPriceMatrixUsd: target.commercialPriceMatrixUsd,
    targetPriceUsd: target.targetPriceUsd,
    derivation: "BOUNDED_MERCHANDISING_PRICE_SCENARIOS_WITHIN_ACTIVE_ASK_CONTEXT",
    exactSoldClaimed: false,
    realizedTransactionPriceStatus: "UNPROVEN",
    packageHash: decision.packageHash,
    researchQueryHash: task.queryHash,
  })
  const marketPriceEvidenceDigest = digest(priceEvidence)
  const economicPolicyDigest = digest({
    source: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1",
    config: DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
  })
  const marketEvidence = Object.freeze({
    authorityClass: "DERIVED_FACT" as const,
    reference: `smart-stocking-active-ask-context:${decision.packageId}`,
    evidenceDigest: marketPriceEvidenceDigest,
    observedAt: exactInstant(task.capturedAt,
      "CAKE_TURNTABLE_RESEARCH_CAPTURED_AT_INVALID"),
    maximumAgeSeconds: 30 * 24 * 60 * 60,
  })
  const frontier = calculateSellerOsProfitabilityFrontierV1({
    configurationId: configuration.configurationIdentity,
    familyId, familyName: target.familyName,
    familyDemandStatus: "FAMILY_DEMAND_UNPROVEN",
    lunaProductId: target.lunaProductId,
    lunaVariantId: target.lunaVariantId, lunaSku: target.lunaSku,
    productFit: "STRONG",
    components: [{ componentId: component.componentIdentityId,
      unitCostUsd: target.unitCostUsd, supplierQuantityRequired: 1,
      costEvidence: { authorityClass: "OFFICIAL_EXTERNAL_FACT",
        reference: `luna-public-product-json:${target.lunaProductId}`,
        evidenceDigest: lunaEvidenceDigest, observedAt: evaluatedAt,
        maximumAgeSeconds: 6 * 60 * 60 },
      quantityEvidence: { authorityClass: "DIRECT_OBSERVATION",
        reference: `luna-single-supplier-variant:${target.lunaVariantId}`,
        evidenceDigest: lunaEvidenceDigest, observedAt: evaluatedAt,
        maximumAgeSeconds: 6 * 60 * 60 } }],
    marketPrices: {
      low: { valueUsd: 19.99, support: "SUPPORTED", evidence: marketEvidence },
      median: { valueUsd: target.targetPriceUsd,
        support: "SUPPORTED", evidence: marketEvidence },
      high: { valueUsd: 22.99, support: "SUPPORTED", evidence: marketEvidence },
    },
    shipping: { status: "SHIPPING_UNPROVEN", valueUsd: null,
      evidence: { authorityClass: "UNPROVEN",
        reference: `luna-shipping-candidate:${candidateId}`,
        evidenceDigest: digest({ candidateId, shippingStatus: "UNPROVEN" }),
        observedAt: evaluatedAt, maximumAgeSeconds: 6 * 60 * 60 } },
    complianceStatus: "PASS",
    currentHardBlockers: ["ACTIVE_ASK_CONTEXT_ONLY",
      "FAMILY_DEMAND_UNPROVEN", "REALIZED_TRANSACTION_PRICE_UNPROVEN",
      "AUTHORITATIVE_SHIPPING_REQUIRED"],
    evidenceAcquisitionCost: "LOW",
    evaluatedAt,
  })
  if (frontier.productFit !== "STRONG" ||
      frontier.shippingStatus !== "SHIPPING_UNPROVEN" ||
      frontier.marketPriceMedian !== target.targetPriceUsd ||
      frontier.unknownShippingTreatedAsZero !== false ||
      frontier.shippingEvidenceRequired !== true ||
      frontier.nextBestEvidence !== "ACTUAL_LUNA_SHIPPING" ||
      frontier.passesTargetAtZeroShippingAtMedian !== true ||
      frontier.listingAuthorized !== false) {
    throw new Error("CAKE_TURNTABLE_FRONTIER_SAFETY_INVARIANT_FAILED")
  }
  const shippingBoundary = calculateEbayUnitEconomics({
    salePrice: target.targetPriceUsd, supplierCost: target.unitCostUsd,
  }, { estimatedOutboundShipping: target.maximumShippingAtTargetUsd })
  const aboveShippingBoundary = calculateEbayUnitEconomics({
    salePrice: target.targetPriceUsd, supplierCost: target.unitCostUsd,
  }, { estimatedOutboundShipping: target.maximumShippingAtTargetUsd + 0.01 })
  if (!shippingBoundary.ready || !shippingBoundary.passesProfitGate ||
      !aboveShippingBoundary.ready || aboveShippingBoundary.passesProfitGate) {
    throw new Error("CAKE_TURNTABLE_MAXIMUM_SHIPPING_BOUNDARY_INVALID")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_SMART_STOCKING_FRONTIER_HANDOFF_VERSION,
    packageId: decision.packageId,
    entrySnapshotHash: decision.learningProfile.entrySnapshotHash,
    familyId, configurationId: configuration.configurationIdentity,
    componentId: component.componentIdentityId, candidateId,
    productFitStatus: "STRONG", opportunityCaseId: null,
    marketPriceEvidenceSemantics: "ACTIVE_ASK_CONTEXT_DERIVED_NOT_SOLD",
    realizedTransactionPriceStatus: "UNPROVEN",
    targetPriceUsd: target.targetPriceUsd,
    maximumShippingAtTargetUsd: target.maximumShippingAtTargetUsd,
    productTruthLimitations: Object.freeze(variant.weightUnit === "g" ? [] :
      ["LUNA_PUBLIC_WEIGHT_UNIT_UNAVAILABLE"]),
    frontier,
    persistence: Object.freeze({
      marketPriceEvidenceReference: marketEvidence.reference,
      marketPriceEvidenceDigest,
      ebayFeePolicyReference:
        "EBAY_US_SELLING_FEES_2026_07_01_PRE_TAXONOMY_RESERVE_V1",
      economicPolicyReference: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1",
      economicPolicyDigest,
      sourceUpdatedAt: exactInstant(task.capturedAt,
        "CAKE_TURNTABLE_RESEARCH_CAPTURED_AT_INVALID"),
      evidenceCutoffAt: exactInstant(task.capturedAt,
        "CAKE_TURNTABLE_RESEARCH_CAPTURED_AT_INVALID"),
    }),
    safety: Object.freeze({ entrySnapshotImmutable: true,
      exactSoldClaimed: false, activeAskTreatedAsRealizedPrice: false,
      unknownShippingTreatedAsZero: false, listingAuthorized: false,
      shippingCaptureExecuted: false, purchaseExecuted: false,
      marketplaceWrites: 0 }),
  })
}

type ShippingResolver = typeof resolveLunaChromeShippingJobsV1

export async function persistCakeTurntableFrontierHandoffV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  handoff: CakeTurntableFrontierHandoffV1
  sessionSecret: string
  resolveShippingJobs?: ShippingResolver
}>) {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  if (input.handoff.packageId !== target.packageId ||
      input.handoff.frontier.lunaProductId !== target.lunaProductId ||
      input.handoff.frontier.lunaVariantId !== target.lunaVariantId ||
      input.handoff.frontier.lunaSku !== target.lunaSku ||
      input.handoff.productFitStatus !== "STRONG" ||
      input.handoff.frontier.frontierDigest === "" ||
      input.handoff.safety.entrySnapshotImmutable !== true ||
      input.sessionSecret.trim().length < 32) {
    throw new Error("CAKE_TURNTABLE_HANDOFF_PERSISTENCE_INPUT_INVALID")
  }
  const persistence = input.handoff.persistence
  const write = await input.supabase.rpc("put_seller_os_profitability_frontier_v1", {
    p_account_key: input.accountKey,
    p_marketplace_id: "EBAY_US",
    p_opportunity_case_id: null,
    p_market_price_evidence_reference:
      persistence.marketPriceEvidenceReference,
    p_market_price_evidence_digest: persistence.marketPriceEvidenceDigest,
    p_ebay_fee_policy_reference: persistence.ebayFeePolicyReference,
    p_economic_policy_reference: persistence.economicPolicyReference,
    p_economic_policy_digest: persistence.economicPolicyDigest,
    p_source_updated_at: persistence.sourceUpdatedAt,
    p_evidence_cutoff_at: persistence.evidenceCutoffAt,
    p_frontier: input.handoff.frontier,
  })
  const writeResult = record(write.data)
  if (write.error || !["CREATED", "IDEMPOTENT_SUCCESS"].includes(
    String(writeResult.outcome ?? "")) ||
      !/^profitability-frontier-v1:sha256:[0-9a-f]{64}$/.test(
        String(writeResult.frontierId ?? "")) ||
      !/^sha256:[0-9a-f]{64}$/.test(String(writeResult.snapshotDigest ?? ""))) {
    throw new Error("CAKE_TURNTABLE_FRONTIER_DURABLE_WRITE_FAILED")
  }
  const readback = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: [input.handoff.familyId], p_limit: 10,
    })
  const durable = Array.isArray(record(readback.data).frontiers)
    ? (record(readback.data).frontiers as unknown[]).map(record).find((outer) => {
      const frontier = record(outer.frontier)
      return frontier.frontierDigest === input.handoff.frontier.frontierDigest &&
        outer.snapshotDigest === writeResult.snapshotDigest
    }) : undefined
  if (readback.error || !durable) {
    throw new Error("CAKE_TURNTABLE_FRONTIER_DURABLE_READBACK_FAILED")
  }
  const resolveShippingJobs = input.resolveShippingJobs ??
    resolveLunaChromeShippingJobsV1
  const jobs = await resolveShippingJobs({ supabase: input.supabase,
    accountKey: input.accountKey, candidateIds: [input.handoff.candidateId],
    sessionSecret: input.sessionSecret,
    now: Date.parse(input.handoff.frontier.evaluatedAt) })
  const job = jobs[0]
  if (jobs.length !== 1 || job.identity.candidateId !== input.handoff.candidateId ||
      job.identity.lunaProductId !== target.lunaProductId ||
      job.identity.lunaVariantId !== target.lunaVariantId ||
      job.identity.supplierSku !== target.lunaSku ||
      job.salePriceUsd !== target.targetPriceUsd ||
      job.supplierCostUsd !== target.unitCostUsd) {
    throw new Error("CAKE_TURNTABLE_SHIPPING_CANARY_NOT_ELIGIBLE")
  }
  return Object.freeze({ exactCandidateHandoff: true as const,
    productFitMaterialized: true as const,
    productFitAuthority: "SELLER_OS_PROFITABILITY_FRONTIER_V1" as const,
    profitabilityFrontierMaterialized: true as const,
    frontierId: String(writeResult.frontierId),
    frontierDigest: input.handoff.frontier.frontierDigest,
    snapshotDigest: String(writeResult.snapshotDigest),
    durableReadback: "PASS" as const,
    shippingCanaryEligible: true as const,
    candidateId: input.handoff.candidateId,
    entrySnapshotHash: input.handoff.entrySnapshotHash,
    marketplaceWrites: 0 as const,
    shippingCaptureExecuted: false as const,
    purchaseExecuted: false as const,
  })
}

export async function materializeCakeTurntableFrontierHandoffV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  sessionSecret: string
  evaluatedAt?: string
  readPublicProduct?: typeof fetchPublicLunaProductForActiveListingMonitor
}>) {
  if (!winnerEvidencePreviewConfiguration().configured) {
    throw new Error("CAKE_TURNTABLE_HANDOFF_PREVIEW_STAGING_REQUIRED")
  }
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const [decisionRead, planRead, taskRead, catalogRead] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase, target.packageId,
      input.accountKey),
    input.supabase.from("marketplace_product_research_query_plans")
      .select("id,status").eq("id", target.researchPlanId).maybeSingle(),
    input.supabase.from("marketplace_product_research_query_tasks")
      .select("plan_id,status,search_query,query_hash,category_id,captured_at,last_error_code")
      .eq("plan_id", target.researchPlanId).eq("ordinal", 1).maybeSingle(),
    input.supabase.from("market_radar_latest_variants")
      .select("source_key,supplier_product_id,supplier_variant_id,sku,product_url")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", target.lunaProductId)
      .eq("supplier_variant_id", target.lunaVariantId)
      .eq("sku", target.lunaSku).maybeSingle(),
  ])
  if (planRead.error || !planRead.data || taskRead.error || !taskRead.data ||
      catalogRead.error || !catalogRead.data) {
    throw new Error("CAKE_TURNTABLE_HANDOFF_SOURCE_READ_FAILED")
  }
  const productUrl = text(catalogRead.data.product_url)
  if (!productUrl) throw new Error("CAKE_TURNTABLE_LUNA_PRODUCT_URL_UNAVAILABLE")
  const readPublicProduct = input.readPublicProduct ??
    fetchPublicLunaProductForActiveListingMonitor
  const lunaProduct = await readPublicProduct(productUrl)
  const packageRecord = decisionRead.package
  const identity = packageRecord.productIdentity.identity
  const task = taskRead.data
  const handoff = buildCakeTurntableFrontierHandoffV1({
    accountKey: input.accountKey,
    decisionPackage: {
      packageId: decisionRead.packageId, status: decisionRead.status,
      packageHash: packageRecord.packageHash,
      supplierSku: packageRecord.supplierSku,
      supplierVariantId: packageRecord.supplierVariantId,
      gtin: identity.gtin,
      normalizedProductName: identity.normalizedProductName,
      supplierPackageCostUsd: packageRecord.economics.supplierPackageCost,
      packCount: identity.packCount,
      complianceBlocked: packageRecord.compliance.blocked,
      learningProfile: decisionRead.smartStockingLearningProfile!,
    },
    researchTask: { planId: String(task.plan_id),
      planStatus: String(planRead.data.status),
      taskStatus: String(task.status), searchQuery: String(task.search_query),
      queryHash: String(task.query_hash), categoryId: text(task.category_id),
      capturedAt: String(task.captured_at),
      lastErrorCode: text(task.last_error_code) },
    lunaProduct,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
  })
  const persisted = await persistCakeTurntableFrontierHandoffV1({
    supabase: input.supabase, accountKey: input.accountKey,
    handoff, sessionSecret: input.sessionSecret,
  })
  const decisionReadback = await readWinnerEvidenceDecisionPackage(
    input.supabase, target.packageId, input.accountKey)
  if (!decisionReadback.smartStockingLearningProfile ||
      decisionReadback.smartStockingLearningProfile.entrySnapshotHash !==
        handoff.entrySnapshotHash ||
      decisionReadback.smartStockingLearningProfile.entrySnapshot
        .entryPotentialScore !== target.entryPotentialScore) {
    throw new Error("CAKE_TURNTABLE_ENTRY_SNAPSHOT_CHANGED")
  }
  return Object.freeze({ ...persisted, entryPotentialScorePreserved: 57 as const,
    schemaChangeRequired: false as const, decisionPackageUpdated: false as const })
}
