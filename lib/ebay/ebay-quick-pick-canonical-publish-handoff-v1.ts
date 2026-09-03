import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  evaluatePublishWithStockguardContractV1,
} from "./ebay-current-future-listing-stockguard-wiring-v1"
import { evaluateEbayListingWorkspaceEligibility } from
  "./ebay-first-luna-opportunity-queue"
import {
  readLunaQuickPickProgressV1,
  type LunaQuickPickCardV1,
} from "./ebay-luna-quick-pick-v1"
import { canonicalEbayPackageSku } from "./ebay-sku"

export const QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_V1 =
  "QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_AND_LEGACY_GATE_BYPASS_V1" as const
export const QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1 =
  "SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function exactMoney(left: unknown, right: unknown) {
  const a = number(left)
  const b = number(right)
  return a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100)
}

function exactLunaUrl(value: unknown) {
  try {
    const parsed = new URL(text(value, 2_000))
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        !["lunaportex.com", "www.lunaportex.com"].includes(
          parsed.hostname.toLowerCase()) ||
        !/^\/products\/[A-Za-z0-9%._~-]+\/?$/.test(parsed.pathname)) return ""
    parsed.hash = ""
    parsed.search = ""
    return parsed.toString()
  } catch {
    return ""
  }
}

function safeLegacyState(blockers: readonly string[], guard: string) {
  return blockers.some((value) => value === guard || value.endsWith(guard))
    ? "BLOCKED" : "PASS"
}

export function isQuickPickCanonicalPublishPackageV1(value: unknown) {
  const data = record(value)
  const review = record(data.quickPickOwnerReviewV1)
  return review.contractVersion === "QUICK_PICK_REMOTE_OWNER_REVIEW_V1"
}

export function buildQuickPickCanonicalPublishHandoffV1(input: Readonly<{
  accountKey: string
  actorUserId: string
  listingPackage: JsonRecord
  opportunity: JsonRecord
  card: LunaQuickPickCardV1
  policyProfile: JsonRecord
  canonicalLunaUrl: string
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const listingPackage = input.listingPackage
  const opportunity = input.opportunity
  const packageData = record(listingPackage.package_data)
  const ownerMarker = record(packageData.quickPickOwnerReviewV1)
  const review = record(input.card.listingReview)
  const ownerReview = record(review.ownerReview)
  const publishHandoff = record(review.publishAuthorizationHandoff)
  const dollarCheck = record(review.dollarCheck)
  const reviewShipping = record(review.shipping)
  const pricing = record(packageData.pricing)
  const assessment = record(opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  const stock = record(productTruth.stock)
  const canonicalReadiness = record(
    assessment.canonicalMarketplaceReadinessV1,
  )
  const factory = record(packageData.factoryPreparationAuthority)
  const factoryStages = record(factory.stageStatuses)
  const packageId = text(listingPackage.id, 80)
  const opportunityId = text(opportunity.id, 80)
  const candidateKey = text(listingPackage.candidate_key, 120)
  const lunaProductId = text(opportunity.supplier_product_id, 80)
  const lunaVariantId = text(opportunity.supplier_variant_id, 80)
  const supplierSku = text(opportunity.supplier_sku, 160)
  const stockQuantity = number(stock.supplierStatedQuantity)
  const targetPrice = number(dollarCheck.targetPrice)
  const supplierCost = number(dollarCheck.supplierCost)
  const shipping = number(dollarCheck.shipping)
  const ebayFees = number(dollarCheck.ebayFees)
  const profit = number(dollarCheck.expectedContribution)
  const margin = number(dollarCheck.expectedMargin)
  const roi = number(dollarCheck.expectedRoi)
  const policySelection = Object.freeze({
    fulfillmentPolicyId: text(input.policyProfile.fulfillment_policy_id, 100),
    paymentPolicyId: text(input.policyProfile.payment_policy_id, 100),
    returnPolicyId: text(input.policyProfile.return_policy_id, 100),
    merchantLocationKey: text(input.policyProfile.merchant_location_key, 100),
  })
  const policiesBound = input.policyProfile.account_key === input.accountKey &&
    input.policyProfile.marketplace_id === "EBAY_US" &&
    Number.isFinite(Date.parse(text(input.policyProfile.verified_at, 80))) &&
    Date.parse(text(input.policyProfile.expires_at, 80)) > now.getTime() &&
    Object.values(policySelection).every(Boolean)
  const canonicalProductIdentity = Boolean(
    /^sha256:[0-9a-f]{64}$/.test(text(productTruth.evidenceDigest, 80)) &&
    input.card.lunaProductId === lunaProductId &&
    input.card.lunaVariantId === lunaVariantId &&
    input.card.sourceSku === supplierSku &&
    text(productTruth.candidateKey, 120) === candidateKey &&
    text(productTruth.lunaProductId, 80) === lunaProductId &&
    text(productTruth.lunaVariantId, 80) === lunaVariantId &&
    text(productTruth.supplierSku, 160) === supplierSku &&
    text(factory.supplierProductId, 80) === lunaProductId &&
    text(factory.supplierVariantId, 80) === lunaVariantId &&
    text(factory.supplierSku, 160) === supplierSku)
  const stockReady = input.card.stages.STOCK === "PASS" &&
    stock.state === "IN_STOCK_SUPPLIER_STATED" &&
    stock.freshness === "FRESH" && stock.exactIdentityVerified === true &&
    (stockQuantity === null || (Number.isInteger(stockQuantity) &&
      stockQuantity > 0)) && Number.isFinite(Date.parse(text(
        stock.observedAt, 80)))
  const economicsReady = input.card.stages.ECONOMICS === "PASS" &&
    factoryStages.ECONOMICS_READY === "READY" && dollarCheck.ready === true &&
    [targetPrice, supplierCost, shipping, ebayFees, profit, margin, roi]
      .every((value) => value !== null) &&
    exactMoney(pricing.targetPrice, targetPrice) &&
    exactMoney(pricing.supplierCost, supplierCost) &&
    exactMoney(pricing.estimatedOutboundShipping, shipping) &&
    exactMoney(pricing.estimatedEbayFees, ebayFees) &&
    exactMoney(pricing.estimatedNetProfit, profit) &&
    exactMoney(pricing.estimatedNetMarginPercent, margin) &&
    exactMoney(pricing.estimatedRoiPercent, roi) && Number(profit) >= 0 &&
    Number(margin) >= 20
  const requiredSpecificsReady =
    input.card.requiredItemSpecificsReady === true &&
    canonicalReadiness.requiredItemSpecificsReady === true &&
    input.card.unresolvedRequiredAspects.length === 0
  const marketplaceReadinessReady =
    input.card.marketplaceReadinessReady === true &&
    canonicalReadiness.ready === true && input.card.conditionReady === true
  const finalPackageReady = review.finalListingPackageReady === true &&
    factoryStages.LISTING_PACKAGE_READY === "READY" &&
    text(review.listingPackageId, 80) === packageId
  const ownerReviewConfirmed = ownerMarker.status === "CONFIRMED" &&
    ownerMarker.readyForOwnerPublishAuthorization === true &&
    ownerReview.ownerReviewConfirmed === true
  const packageMatch = ownerReview.packageMatch === true &&
    ownerReview.currentListingPackageId === packageId &&
    ownerReview.confirmedPackageId === packageId &&
    publishHandoff.finalListingPackageMatch === true &&
    /^sha256:[0-9a-f]{64}$/.test(text(review.packageDigest, 100)) &&
    text(review.packageDigest, 100) ===
      text(ownerMarker.reviewedPackageDigest, 100) &&
    ownerMarker.authorizedPackageId === packageId &&
    ownerMarker.authorizedSku === supplierSku &&
    number(ownerMarker.authorizedQuantity) ===
      number(record(review.authorizationBinding).quantity) &&
    record(ownerMarker.exactProductLineage).lunaProductId === lunaProductId &&
    record(ownerMarker.exactProductLineage).lunaVariantId === lunaVariantId &&
    ownerMarker.materialPackageDigestVersion ===
      "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1" &&
    ownerMarker.materialPackageChangeInvalidatesAuthorization === true
  const marketTestReady = input.card.marketTestReady === true &&
    input.card.disposition === "MARKET_TEST_READY" &&
    opportunity.decision === "MARKET_TEST_READY" &&
    publishHandoff.marketTestReadiness === "PASS" &&
    publishHandoff.publishableAsMarketTest === true &&
    publishHandoff.demandProven === false &&
    publishHandoff.demandUnprovenDoesNotBlockMarketTest === true
  const duplicateGuardReady = input.card.alreadyLive === false &&
    input.card.linkedLiveItemIds.length === 0
  const legacy = evaluateEbayListingWorkspaceEligibility(opportunity)
  const legacyBlockers = legacy.blockers
  const guardReconciliation = Object.freeze([
    Object.freeze({ legacyGuard: "UNIT_ECONOMICS_REQUIRED",
      canonicalAuthority: "QUICK_PICK_DOLLAR_CHECK_AND_ECONOMICS_FRONTIER",
      canonicalCurrentState: economicsReady ? "PASS" : "BLOCKED",
      legacyState: safeLegacyState(legacyBlockers,
        "UNIT_ECONOMICS_REQUIRED"), staleOrApplicable: economicsReady
        ? "STALE" : "APPLICABLE" }),
    Object.freeze({ legacyGuard: "LUNA_STOCK_UNAVAILABLE",
      canonicalAuthority: "EXACT_LUNA_PRODUCT_TRUTH_STOCK_FRESHNESS",
      canonicalCurrentState: stockReady ? "PASS" : "BLOCKED",
      legacyState: safeLegacyState(legacyBlockers,
        "LUNA_STOCK_UNAVAILABLE"), staleOrApplicable: stockReady
        ? "STALE" : "APPLICABLE" }),
    Object.freeze({ legacyGuard: "POTENTIAL_SCORE_BELOW_70",
      canonicalAuthority: "MARKET_TEST_READY_CONTRACT",
      canonicalCurrentState: marketTestReady ? "NOT_APPLICABLE" : "BLOCKED",
      legacyState: safeLegacyState(legacyBlockers,
        "POTENTIAL_SCORE_BELOW_70"), staleOrApplicable: marketTestReady
        ? "STALE" : "APPLICABLE" }),
    Object.freeze({ legacyGuard:
      "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN",
      canonicalAuthority: "CANONICAL_MARKETPLACE_READINESS",
      canonicalCurrentState: requiredSpecificsReady ? "PASS" : "BLOCKED",
      legacyState: safeLegacyState(legacyBlockers,
        "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN"),
      staleOrApplicable: requiredSpecificsReady ? "STALE" : "APPLICABLE" }),
  ])
  const legacyFalseGuards = guardReconciliation.filter((entry) =>
    entry.legacyState === "BLOCKED" && entry.staleOrApplicable === "STALE")
  const blockers = [
    ...(!input.accountKey || !input.actorUserId ?
      ["QUICK_PICK_PUBLISH_ACCOUNT_OR_ACTOR_REQUIRED"] : []),
    ...(text(listingPackage.account_key, 120) !== input.accountKey ||
      text(listingPackage.created_by, 80) !== input.actorUserId ||
      text(listingPackage.opportunity_id, 80) !== opportunityId ||
      candidateKey !== text(opportunity.candidate_key, 120) ||
      input.card.candidateKey !== candidateKey ||
      input.card.opportunityId !== opportunityId ||
      input.card.listingPackageId !== packageId
      ? ["QUICK_PICK_PUBLISH_PACKAGE_IDENTITY_MISMATCH"] : []),
    ...(!canonicalProductIdentity ?
      ["QUICK_PICK_PUBLISH_EXACT_PRODUCT_IDENTITY_REQUIRED"] : []),
    ...(!duplicateGuardReady ?
      ["QUICK_PICK_PUBLISH_ALREADY_LIVE_OR_DUPLICATE"] : []),
    ...(!stockReady ? ["QUICK_PICK_PUBLISH_STOCK_NOT_READY"] : []),
    ...(!economicsReady ? ["QUICK_PICK_PUBLISH_ECONOMICS_NOT_READY"] : []),
    ...(!requiredSpecificsReady ?
      ["QUICK_PICK_PUBLISH_REQUIRED_SPECIFICS_NOT_READY"] : []),
    ...(!marketplaceReadinessReady ?
      ["QUICK_PICK_PUBLISH_MARKETPLACE_READINESS_NOT_READY"] : []),
    ...(!finalPackageReady ?
      ["QUICK_PICK_PUBLISH_FINAL_PACKAGE_NOT_READY"] : []),
    ...(!ownerReviewConfirmed ?
      ["QUICK_PICK_PUBLISH_OWNER_REVIEW_NOT_CONFIRMED"] : []),
    ...(!packageMatch ? ["QUICK_PICK_PUBLISH_PACKAGE_CHANGED"] : []),
    ...(!marketTestReady ?
      ["QUICK_PICK_PUBLISH_MARKET_TEST_NOT_READY"] : []),
    ...(!policiesBound ?
      ["QUICK_PICK_PUBLISH_ACCOUNT_POLICIES_NOT_BOUND"] : []),
    ...(!input.canonicalLunaUrl ?
      ["QUICK_PICK_PUBLISH_CANONICAL_LUNA_URL_REQUIRED"] : []),
  ]
  const publishWithStockguardContract = blockers.length === 0
    ? evaluatePublishWithStockguardContractV1({
      sellerSku: canonicalEbayPackageSku(packageId),
      expectedComponentCount: 1,
      economicsReady: true,
      monitorEnrollmentIntentPrepared: true,
      components: [{ productId: lunaProductId, variantId: lunaVariantId,
        supplierSku, canonicalLunaUrl: input.canonicalLunaUrl,
        quantityRequiredPerBundle: 1, identityCertified: true,
        stockIdentityResolved: true, stockState: "IN_STOCK",
        sourceHealth: "HEALTHY", freshness: "FRESH",
        safeCapacity: null }],
    }) : null
  if (publishWithStockguardContract &&
      !publishWithStockguardContract.publishAllowed) {
    blockers.push("QUICK_PICK_PUBLISH_STOCKGUARD_NOT_READY")
  }
  const core = Object.freeze({
    version: QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1,
    validated: blockers.length === 0,
    accountKey: input.accountKey,
    actorUserId: input.actorUserId,
    listingPackageId: packageId,
    opportunityId,
    candidateKey,
    packageDigest: text(review.packageDigest, 100),
    ownerReviewedPackageDigest: text(ownerMarker.reviewedPackageDigest, 100),
    lunaProductId,
    lunaVariantId,
    supplierSku,
    quantity: number(record(review.authorizationBinding).quantity),
    gtin: text(productTruth.gtin, 80),
    canonicalLunaUrl: input.canonicalLunaUrl,
    productTruthDigest: text(productTruth.evidenceDigest, 100),
    stockState: text(stock.state, 80),
    stockFreshness: text(stock.freshness, 80),
    supplierInventoryQuantity: stockQuantity,
    safeCapacity: null,
    stockObservedAt: text(stock.observedAt, 80),
    finalEconomicsStatus: economicsReady ? "PASS" : "BLOCKED",
    requiredSpecificsStatus: requiredSpecificsReady ? "PASS" : "BLOCKED",
    marketplaceReadinessStatus:
      marketplaceReadinessReady ? "PASS" : "BLOCKED",
    marketTestReadiness: marketTestReady ? "PASS" : "BLOCKED",
    demandProven: false,
    publishableAsMarketTest: marketTestReady,
    targetPriceUsd: targetPrice,
    supplierCostUsd: supplierCost,
    supplierShippingUsd: shipping,
    estimatedEbayFeesUsd: ebayFees,
    contributionProfitUsd: profit,
    contributionMarginPercent: margin,
    roiPercent: roi,
    policyProfileDigest: policiesBound ? digest(policySelection) : null,
    sourceRevalidationAuthority:
      "QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1",
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  })
  const authorization = Object.freeze({ ...core,
    authorizationDigest: digest(core) })
  const publishAuthorizationReady = blockers.length === 0
  return Object.freeze({
    contractVersion: QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_V1,
    handoffSourceContract:
      "QUICK_PICK_OWNER_CONFIRM_TO_PUBLISH_AUTHORIZATION_HANDOFF_V1",
    handoffDestinationContract:
      "EBAY_DRAFT_ONLY_EXISTING_CONTROLLED_PUBLISHER_V1",
    legacyGuardEvaluatorUsedForAuthorization: false as const,
    legacyGuardEvaluatorObservedForAudit: true as const,
    canonicalQuickPickPackageUsed: true as const,
    canonicalPackageIsPublishAuthority: true as const,
    marketTestReady,
    ownerReviewConfirmed,
    packageMatch,
    economicsReady,
    stockReady,
    requiredSpecificsReady,
    marketplaceReadinessReady,
    policiesBound,
    policySelection,
    finalListingPackageReady: finalPackageReady,
    publishableAsMarketTest: marketTestReady,
    publishAuthorizationReady,
    blockers: Object.freeze([...blockers]),
    guardReconciliation,
    legacyFalseGuards: Object.freeze(legacyFalseGuards),
    legacyFalseGuardCountBefore: legacyFalseGuards.length,
    legacyFalseGuardCount: blockers.length === 0 ? 0 : legacyFalseGuards.length,
    legacyWorkspaceMayOverrideQuickPickReady: false as const,
    potentialScoreLegacyGateMayBlockMarketTest: false as const,
    staleLegacyGuardMayBlockPublish: false as const,
    authorization,
    economicsConfig: Object.freeze(shipping === null
      ? {} : { estimatedOutboundShipping: shipping }),
    publishWithStockguardContract,
    summary: Object.freeze({ title: text(review.title, 80),
      price: targetPrice, expectedProfit: profit, margin, shipping,
      policiesBound }),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      listingPublications: 0 as const, canPublishWithoutNewOwnerClick: false,
      customerProductionUntouched: true as const }),
  })
}

export async function resolveQuickPickCanonicalPublishHandoffV1(input:
Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  candidateKey: string
  listingPackageId: string
  now?: Date
}>) {
  const [progress, packageRead] = await Promise.all([
    readLunaQuickPickProgressV1({ supabase: input.supabase,
      candidateKeys: [input.candidateKey], accountKey: input.accountKey }),
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("id", input.listingPackageId)
      .eq("candidate_key", input.candidateKey)
      .eq("account_key", input.accountKey)
      .eq("created_by", input.actorUserId).maybeSingle(),
  ])
  const card = progress.find((entry) =>
    entry.candidateKey === input.candidateKey &&
    entry.listingPackageId === input.listingPackageId)
  if (!card || packageRead.error || !packageRead.data) {
    throw new Error("QUICK_PICK_CANONICAL_PUBLISH_PACKAGE_NOT_FOUND")
  }
  const listingPackage = packageRead.data as JsonRecord
  if (!isQuickPickCanonicalPublishPackageV1(listingPackage.package_data)) {
    throw new Error("QUICK_PICK_CANONICAL_PUBLISH_CONTRACT_REQUIRED")
  }
  const opportunityId = text(listingPackage.opportunity_id, 80)
  const opportunityRead = await input.supabase
    .from("ebay_luna_opportunity_queue").select("*")
    .eq("id", opportunityId).eq("candidate_key", input.candidateKey)
    .maybeSingle()
  if (opportunityRead.error || !opportunityRead.data) {
    throw new Error("QUICK_PICK_CANONICAL_PUBLISH_OPPORTUNITY_NOT_FOUND")
  }
  const opportunity = opportunityRead.data as JsonRecord
  const [profileRead, catalogRead] = await Promise.all([
    input.supabase.from("ebay_account_policy_profiles")
      .select("account_key,marketplace_id,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,verification_source,verified_at,expires_at")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .gt("expires_at", (input.now ?? new Date()).toISOString())
      .order("verified_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("market_radar_latest_variants")
      .select("source_key,supplier_product_id,supplier_variant_id,sku,product_url")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", opportunity.supplier_product_id)
      .eq("supplier_variant_id", opportunity.supplier_variant_id)
      .eq("sku", opportunity.supplier_sku).limit(2),
  ])
  if (profileRead.error) {
    throw new Error("QUICK_PICK_CANONICAL_PUBLISH_POLICY_PROFILE_READ_FAILED")
  }
  const catalogRows = catalogRead.error || !Array.isArray(catalogRead.data)
    ? [] : catalogRead.data
  const canonicalLunaUrl = catalogRows.length === 1
    ? exactLunaUrl(catalogRows[0].product_url) : ""
  const handoff = buildQuickPickCanonicalPublishHandoffV1({
    accountKey: input.accountKey, actorUserId: input.actorUserId,
    listingPackage, opportunity, card,
    policyProfile: record(profileRead.data), canonicalLunaUrl,
    now: input.now,
  })
  if (!handoff.publishAuthorizationReady ||
      !handoff.publishWithStockguardContract?.publishAllowed) {
    const error = new Error(handoff.blockers[0]
      ?? "QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_NOT_READY") as Error & {
        handoff?: typeof handoff
      }
    error.handoff = handoff
    throw error
  }
  return Object.freeze({ listingPackage, opportunity, card, handoff })
}
