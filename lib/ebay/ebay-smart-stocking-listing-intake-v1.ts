import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1,
} from "./ebay-smart-stocking-frontier-handoff-v1"
import {
  fetchPublicLunaProductForActiveListingMonitor,
} from "./ebay-targeted-active-listing-luna-monitor"
import type { DirectedLunaProduct } from "./ebay-luna-directed-product-import"
import {
  readWinnerEvidenceDecisionPackage,
} from "./ebay-winner-evidence-v2-service"
import {
  LUNA_CANONICAL_SINGLE_RATE_PROOF_V1,
  LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1,
} from "./ebay-luna-chrome-shipping-capture-v1"

export const SMART_STOCKING_LISTING_INTAKE_VERSION =
  "SELLER_OS_SMART_STOCKING_LISTING_INTAKE_V1" as const

export const CAKE_TURNTABLE_LISTING_INTAKE_KEY =
  "smart-stocking:EBAY_US:9220835475680:48809646653664" as const

export const WINDOW_FILM_LISTING_INTAKE_KEY =
  "smart-stocking:EBAY_US:9220837146848:48809648488672" as const

export const WINDOW_FILM_LISTING_INTAKE_TARGET_V1 = Object.freeze({
  decisionPackageId: "5f72bb09-c1f2-48b2-be81-7333d8dd39fd",
  candidateKey: WINDOW_FILM_LISTING_INTAKE_KEY,
  lunaProductId: "9220837146848",
  lunaVariantId: "48809648488672",
  lunaSku: "ITEM3404",
  gtin: "740145348659",
  unitCostUsd: 5,
  entryPotentialScore: 55,
  salePriceUsd: 24.99,
  supplierShippingUsd: 6.99,
  estimatedEbayFeesUsd: 4.22,
  contributionProfitUsd: 6.53,
  contributionMarginPercent: 26.12,
  roiPercent: 130.55,
  categoryId: "175757",
  categoryName: "Window Film",
  listingTitle:
    "Window Privacy Film One Way 23.6 in x 9.84 ft Tint for Home",
})

const LISTING_TITLE =
  "11 in Revolving Plastic Cake Turntable Non-Slip Base Decorating Stand"
const LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY =
  "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1" as const

type JsonRecord = Record<string, unknown>
const SHA256 = /^sha256:[0-9a-f]{64}$/

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function money(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function sameInstant(left: string | null, right: string | null) {
  return Boolean(left && right && Date.parse(left) === Date.parse(right))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

export type CakeTurntableListingWorkspaceEvidenceV1 = Readonly<{
  authorityClass: "SELLER_OS_ITEM3525_FINAL_WORKSPACE_EVIDENCE_V1"
  decisionPackageId: string
  entrySnapshotHash: string
  decisionSnapshotHash: string
  frontierId: string
  frontierDigest: string
  snapshotDigest: string
  salePriceUsd: 25.99
  supplierCostUsd: 3.8
  supplierShippingUsd: 9.99
  estimatedEbayFeesUsd: 4.38
  contributionProfitUsd: 5.48
  contributionMarginPercent: 21.1
  roiPercent: 144.33
  launchTier: "CONTROLLED_MERCHANDISING_BET"
  entryPotentialScore: 57
  productTruth: Readonly<{
    authorityClass: typeof LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY
    evidenceDigest: string
    noManufacturerBrandClaim: "PROVEN"
    ebayBrandSemantics: "UNBRANDED_SUPPORTED"
    taxonomyBrandValue: "Unbranded"
  }>
  stock: Readonly<{
    state: "IN_STOCK_SUPPLIER_STATED"
    available: true
    quantity: number
    safeCapacity: null
    observedAt: string
  }>
  category: Readonly<{
    categoryId: "183335"
    categoryName: "Icing Turntables"
  }>
  shipping: Readonly<{
    status: "SHIPPING_DURABLY_PERSISTED"
    canonicalDestinationMatch: true
    canonicalDestinationCountryClass: "US"
    acquisitionAuthority: typeof LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1
    selectedShippingStateProof: typeof LUNA_CANONICAL_SINGLE_RATE_PROOF_V1
    noPurchase: true
    buyerFacingShipping: false
  }>
}>

export type WindowFilmListingWorkspaceEvidenceV1 = Readonly<{
  authorityClass: "SELLER_OS_ITEM3404_FINAL_WORKSPACE_EVIDENCE_V1"
  decisionPackageId: string
  entrySnapshotHash: string
  decisionSnapshotHash: string
  frontierId: string
  frontierDigest: string
  snapshotDigest: string
  salePriceUsd: 24.99
  supplierCostUsd: 5
  supplierShippingUsd: 6.99
  estimatedEbayFeesUsd: 4.22
  contributionProfitUsd: 6.53
  contributionMarginPercent: 26.12
  roiPercent: 130.55
  launchTier: "CONTROLLED_MERCHANDISING_BET"
  entryPotentialScore: 55
  productTruth: Readonly<{
    authorityClass: typeof LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY
    evidenceDigest: string
    noManufacturerBrandClaim: "UNPROVEN"
    ebayBrandSemantics: "UNKNOWN"
    taxonomyBrandValue: null
  }>
  stock: Readonly<{
    state: "IN_STOCK_SUPPLIER_STATED"
    available: true
    quantity: null
    safeCapacity: null
    observedAt: string
  }>
  category: Readonly<{
    categoryId: "175757"
    categoryName: "Window Film"
  }>
  shipping: Readonly<{
    status: "SHIPPING_DURABLY_PERSISTED"
    canonicalDestinationMatch: true
    canonicalDestinationCountryClass: "US"
    acquisitionAuthority: typeof LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1
    selectedShippingStateProof: typeof LUNA_CANONICAL_SINGLE_RATE_PROOF_V1
    noPurchase: true
    buyerFacingShipping: false
  }>
}>

export type SmartStockingListingWorkspaceEvidenceV1 =
  | CakeTurntableListingWorkspaceEvidenceV1
  | WindowFilmListingWorkspaceEvidenceV1

export function buildCakeTurntableListingWorkspaceEvidenceV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  opportunity: JsonRecord
  profitabilityFrontiers: unknown
}>): CakeTurntableListingWorkspaceEvidenceV1 {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const assessment = record(input.opportunity.assessment)
  const candidate = record(assessment.candidate)
  const assessmentEconomics = record(assessment.economics)
  const productTruth = record(assessment.productTruth)
  const productTruthStock = record(productTruth.stock)
  const productTruthBrand = record(productTruth.brand)
  const productTruthDigest = text(productTruth.evidenceDigest)
  const supplierQuantity = positiveInteger(
    productTruthStock.supplierStatedQuantity,
  )
  const productTruthObservedAt = text(productTruthStock.observedAt)
  const profile = input.decisionPackage.smartStockingLearningProfile
  const decision = profile?.decisionSnapshot
  const economics = decision?.finalEconomics
  const stockObservedAt = text(input.opportunity.supplier_snapshot_at)
  const frontierRow = records(record(input.profitabilityFrontiers).frontiers)
    .find((outer) => {
      const frontier = record(outer.frontier)
      return frontier.lunaProductId === target.lunaProductId &&
        frontier.lunaVariantId === target.lunaVariantId &&
        frontier.lunaSku === target.lunaSku &&
        frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED"
    })
  const frontier = record(frontierRow?.frontier)
  const shipping = record(frontier.shippingCaptureEvidence)
  if (
    input.decisionPackage.packageId !== target.packageId ||
    input.decisionPackage.status !== "GENERATED" ||
    !profile || !decision || !economics ||
    profile.entrySnapshot.entryPotentialScore !== 57 ||
    decision.launchTier !== "CONTROLLED_MERCHANDISING_BET" ||
    decision.parkReason !== null ||
    economics.status !== "PASS" || economics.thresholdResult !== "PASS" ||
    money(economics.salePriceUsd) !== 25.99 ||
    money(economics.ebayFeesUsd) !== 4.38 ||
    money(economics.lunaProductCostUsd) !== 3.8 ||
    money(economics.lunaShippingUsd) !== 9.99 ||
    money(economics.contributionProfitUsd) !== 5.48 ||
    money(economics.contributionMarginPercent) !== 21.1 ||
    money(economics.roiPercent) !== 144.33 ||
    !isSmartStockingListingIntakeV1(assessment) ||
    input.opportunity.candidate_key !== CAKE_TURNTABLE_LISTING_INTAKE_KEY ||
    input.opportunity.supplier_product_id !== target.lunaProductId ||
    input.opportunity.supplier_variant_id !== target.lunaVariantId ||
    input.opportunity.supplier_sku !== target.lunaSku ||
    input.opportunity.gtin !== target.gtin ||
    money(input.opportunity.supplier_price) !== target.unitCostUsd ||
    input.opportunity.supplier_available !== true ||
    supplierQuantity === null ||
    input.opportunity.supplier_inventory_quantity !== supplierQuantity ||
    candidate.available !== true ||
    candidate.inventoryQuantity !== supplierQuantity ||
    !stockObservedAt || !Number.isFinite(Date.parse(stockObservedAt)) ||
    !productTruthObservedAt ||
    !Number.isFinite(Date.parse(productTruthObservedAt)) ||
    !sameInstant(stockObservedAt, productTruthObservedAt) ||
    !sameInstant(text(candidate.stockCapturedAt), productTruthObservedAt) ||
    productTruth.authorityClass !== LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY ||
    !productTruthDigest || !SHA256.test(productTruthDigest) ||
    productTruth.candidateKey !== CAKE_TURNTABLE_LISTING_INTAKE_KEY ||
    productTruth.lunaProductId !== target.lunaProductId ||
    productTruth.lunaVariantId !== target.lunaVariantId ||
    productTruth.supplierSku !== target.lunaSku ||
    productTruth.gtin !== target.gtin ||
    money(productTruth.supplierPriceUsd) !== target.unitCostUsd ||
    productTruth.rawHtmlStored !== false ||
    productTruth.marketplaceWrites !== 0 ||
    productTruthStock.state !== "IN_STOCK_SUPPLIER_STATED" ||
    productTruthStock.freshness !== "FRESH" ||
    productTruthStock.exactIdentityVerified !== true ||
    productTruthStock.safeCapacity !== null ||
    productTruthStock.safeCapacityStatus !== "UNPROVEN_NOT_INFERRED" ||
    productTruthBrand.noManufacturerBrandClaim !== "PROVEN" ||
    productTruthBrand.ebayBrandSemantics !== "UNBRANDED_SUPPORTED" ||
    productTruthBrand.taxonomyBrandValue !== "Unbranded" ||
    productTruthBrand.brandMetadataPresent !== false ||
    productTruthBrand.manufacturerMetadataPresent !== false ||
    productTruthBrand.visibleManufacturerBrandingPresent !== false ||
    productTruthBrand.supplierImageBrandConflictFound !== false ||
    money(assessmentEconomics.authoritativeSupplierShippingUsd) !== 9.99 ||
    money(assessmentEconomics.estimatedNetProfit) !== 5.48 ||
    money(assessmentEconomics.estimatedNetMarginPercent) !== 21.1 ||
    money(assessmentEconomics.estimatedRoiPercent) !== 144.33 ||
    !frontierRow || !SHA256.test(String(frontierRow.snapshotDigest ?? "")) ||
    !SHA256.test(String(frontier.frontierDigest ?? "")) ||
    frontier.shippingStatus !== "SHIPPING_DURABLY_PERSISTED" ||
    money(frontier.shippingValue) !== 9.99 ||
    shipping.lunaProductId !== target.lunaProductId ||
    shipping.lunaVariantId !== target.lunaVariantId ||
    shipping.supplierSku !== target.lunaSku ||
    money(shipping.shippingUsd) !== 9.99 ||
    shipping.canonicalDestinationAuthority !==
      LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1 ||
    shipping.canonicalDestinationCountryClass !== "US" ||
    shipping.canonicalDestinationMatch !== true ||
    !SHA256.test(String(shipping.canonicalDestinationFingerprint ?? "")) ||
    shipping.selectedShippingStateProof !== LUNA_CANONICAL_SINGLE_RATE_PROOF_V1 ||
    shipping.noPurchase !== true
  ) throw new Error("CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH")

  return Object.freeze({
    authorityClass: "SELLER_OS_ITEM3525_FINAL_WORKSPACE_EVIDENCE_V1" as const,
    decisionPackageId: target.packageId,
    entrySnapshotHash: profile.entrySnapshotHash,
    decisionSnapshotHash: profile.decisionSnapshotHash,
    frontierId: String(frontierRow.frontierId ?? ""),
    frontierDigest: String(frontier.frontierDigest),
    snapshotDigest: String(frontierRow.snapshotDigest),
    salePriceUsd: 25.99 as const,
    supplierCostUsd: 3.8 as const,
    supplierShippingUsd: 9.99 as const,
    estimatedEbayFeesUsd: 4.38 as const,
    contributionProfitUsd: 5.48 as const,
    contributionMarginPercent: 21.1 as const,
    roiPercent: 144.33 as const,
    launchTier: "CONTROLLED_MERCHANDISING_BET" as const,
    entryPotentialScore: 57 as const,
    productTruth: Object.freeze({
      authorityClass: LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY,
      evidenceDigest: productTruthDigest,
      noManufacturerBrandClaim: "PROVEN" as const,
      ebayBrandSemantics: "UNBRANDED_SUPPORTED" as const,
      taxonomyBrandValue: "Unbranded" as const,
    }),
    stock: Object.freeze({
      state: "IN_STOCK_SUPPLIER_STATED" as const,
      available: true as const,
      quantity: supplierQuantity,
      safeCapacity: null,
      observedAt: new Date(productTruthObservedAt).toISOString(),
    }),
    category: Object.freeze({
      categoryId: "183335" as const,
      categoryName: "Icing Turntables" as const,
    }),
    shipping: Object.freeze({
      status: "SHIPPING_DURABLY_PERSISTED" as const,
      canonicalDestinationMatch: true as const,
      canonicalDestinationCountryClass: "US" as const,
      acquisitionAuthority: LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1,
      selectedShippingStateProof: LUNA_CANONICAL_SINGLE_RATE_PROOF_V1,
      noPurchase: true as const,
      buyerFacingShipping: false as const,
    }),
  })
}

export async function resolveCakeTurntableListingWorkspaceEvidenceV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunity: JsonRecord
  }>,
) {
  const [decisionPackage, frontiers] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase,
      CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.packageId, input.accountKey),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
  ])
  if (frontiers.error) {
    throw new Error("CAKE_TURNTABLE_WORKSPACE_SHIPPING_READBACK_FAILED")
  }
  return buildCakeTurntableListingWorkspaceEvidenceV1({
    decisionPackage,
    opportunity: input.opportunity,
    profitabilityFrontiers: frontiers.data,
  })
}

function windowFilmCommercialAuthoritiesV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  profitabilityFrontiers: unknown
}>) {
  const target = WINDOW_FILM_LISTING_INTAKE_TARGET_V1
  const profile = input.decisionPackage.smartStockingLearningProfile
  const identity = input.decisionPackage.package.productIdentity.identity
  const frontierRow = records(record(input.profitabilityFrontiers).frontiers)
    .find((outer) => {
      const frontier = record(outer.frontier)
      return frontier.lunaProductId === target.lunaProductId
        && frontier.lunaVariantId === target.lunaVariantId
        && frontier.lunaSku === target.lunaSku
        && frontier.shippingStatus === "SHIPPING_DURABLY_PERSISTED"
    })
  const frontier = record(frontierRow?.frontier)
  const shipping = record(frontier.shippingCaptureEvidence)
  const median = record(record(frontier.scenarios).median)
  if (
    input.decisionPackage.packageId !== target.decisionPackageId
    || input.decisionPackage.status !== "GENERATED"
    || input.decisionPackage.package.supplierSku !== target.lunaSku
    || input.decisionPackage.package.supplierVariantId !== target.lunaVariantId
    || identity.gtin !== target.gtin
    || !profile
    || profile.entrySnapshot.entryPotentialScore !== target.entryPotentialScore
    || !frontierRow
    || !SHA256.test(String(frontierRow.snapshotDigest ?? ""))
    || !SHA256.test(String(frontier.frontierDigest ?? ""))
    || frontier.lunaProductId !== target.lunaProductId
    || frontier.lunaVariantId !== target.lunaVariantId
    || frontier.lunaSku !== target.lunaSku
    || frontier.productFit !== "STRONG"
    || frontier.familyDemandStatus !== "FAMILY_DEMAND_SUPPORTED"
    || money(frontier.lunaUnitCost) !== target.unitCostUsd
    || money(frontier.marketPriceMedian) !== target.salePriceUsd
    || frontier.shippingStatus !== "SHIPPING_DURABLY_PERSISTED"
    || money(frontier.shippingValue) !== target.supplierShippingUsd
    || money(frontier.ebayFeeEstimateAtMedian) !== target.estimatedEbayFeesUsd
    || money(frontier.contributionProfitAtMarketMedian)
      !== target.contributionProfitUsd
    || money(frontier.contributionMarginAtMarketMedian)
      !== target.contributionMarginPercent
    || median.passesTargetPolicy !== true
    || frontier.economicClassification !== "ECONOMICALLY_PROMISING"
    || frontier.nextBestEvidence !== "NONE"
    || shipping.lunaProductId !== target.lunaProductId
    || shipping.lunaVariantId !== target.lunaVariantId
    || shipping.supplierSku !== target.lunaSku
    || money(shipping.subtotalUsd) !== target.unitCostUsd
    || money(shipping.shippingUsd) !== target.supplierShippingUsd
    || shipping.canonicalDestinationAuthority
      !== LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1
    || shipping.canonicalDestinationCountryClass !== "US"
    || shipping.canonicalDestinationMatch !== true
    || !SHA256.test(String(shipping.canonicalDestinationFingerprint ?? ""))
    || shipping.selectedShippingStateProof !== LUNA_CANONICAL_SINGLE_RATE_PROOF_V1
    || shipping.noPurchase !== true
  ) throw new Error("WINDOW_FILM_LISTING_INTAKE_AUTHORITY_MISMATCH")
  return { target, profile, frontierRow, frontier, shipping }
}

export function buildWindowFilmListingWorkspaceEvidenceV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  opportunity: JsonRecord
  profitabilityFrontiers: unknown
}>): WindowFilmListingWorkspaceEvidenceV1 {
  const authority = windowFilmCommercialAuthoritiesV1(input)
  const { target, profile, frontierRow, frontier } = authority
  const assessment = record(input.opportunity.assessment)
  const candidate = record(assessment.candidate)
  const productTruth = record(assessment.productTruth)
  const stock = record(productTruth.stock)
  const observedAt = text(stock.observedAt)
  const productTruthDigest = text(productTruth.evidenceDigest)
  if (
    !isSmartStockingListingIntakeV1(assessment)
    || input.opportunity.candidate_key !== target.candidateKey
    || input.opportunity.supplier_product_id !== target.lunaProductId
    || input.opportunity.supplier_variant_id !== target.lunaVariantId
    || input.opportunity.supplier_sku !== target.lunaSku
    || input.opportunity.gtin !== target.gtin
    || money(input.opportunity.supplier_price) !== target.unitCostUsd
    || input.opportunity.supplier_available !== true
    || input.opportunity.supplier_inventory_quantity !== null
    || candidate.candidateKey !== target.candidateKey
    || candidate.available !== true
    || candidate.inventoryQuantity !== null
    || productTruth.authorityClass !== LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY
    || !productTruthDigest || !SHA256.test(productTruthDigest)
    || productTruth.candidateKey !== target.candidateKey
    || productTruth.lunaProductId !== target.lunaProductId
    || productTruth.lunaVariantId !== target.lunaVariantId
    || productTruth.supplierSku !== target.lunaSku
    || productTruth.gtin !== target.gtin
    || money(productTruth.supplierPriceUsd) !== target.unitCostUsd
    || stock.state !== "IN_STOCK_SUPPLIER_STATED"
    || stock.freshness !== "FRESH"
    || stock.exactIdentityVerified !== true
    || stock.supplierStatedQuantity !== null
    || stock.safeCapacity !== null
    || stock.safeCapacityStatus !== "UNPROVEN_NOT_INFERRED"
    || !observedAt || !Number.isFinite(Date.parse(observedAt))
    || !sameInstant(text(input.opportunity.supplier_snapshot_at), observedAt)
  ) throw new Error("WINDOW_FILM_WORKSPACE_EVIDENCE_MISMATCH")

  return Object.freeze({
    authorityClass: "SELLER_OS_ITEM3404_FINAL_WORKSPACE_EVIDENCE_V1" as const,
    decisionPackageId: target.decisionPackageId,
    entrySnapshotHash: profile.entrySnapshotHash,
    decisionSnapshotHash: profile.decisionSnapshotHash,
    frontierId: String(frontierRow.frontierId ?? ""),
    frontierDigest: String(frontier.frontierDigest),
    snapshotDigest: String(frontierRow.snapshotDigest),
    salePriceUsd: target.salePriceUsd,
    supplierCostUsd: target.unitCostUsd,
    supplierShippingUsd: target.supplierShippingUsd,
    estimatedEbayFeesUsd: target.estimatedEbayFeesUsd,
    contributionProfitUsd: target.contributionProfitUsd,
    contributionMarginPercent: target.contributionMarginPercent,
    roiPercent: target.roiPercent,
    launchTier: "CONTROLLED_MERCHANDISING_BET" as const,
    entryPotentialScore: target.entryPotentialScore,
    productTruth: Object.freeze({
      authorityClass: LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY,
      evidenceDigest: productTruthDigest,
      noManufacturerBrandClaim: "UNPROVEN" as const,
      ebayBrandSemantics: "UNKNOWN" as const,
      taxonomyBrandValue: null,
    }),
    stock: Object.freeze({
      state: "IN_STOCK_SUPPLIER_STATED" as const,
      available: true as const,
      quantity: null,
      safeCapacity: null,
      observedAt: new Date(observedAt).toISOString(),
    }),
    category: Object.freeze({
      categoryId: target.categoryId,
      categoryName: target.categoryName,
    }),
    shipping: Object.freeze({
      status: "SHIPPING_DURABLY_PERSISTED" as const,
      canonicalDestinationMatch: true as const,
      canonicalDestinationCountryClass: "US" as const,
      acquisitionAuthority: LUNA_OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1,
      selectedShippingStateProof: LUNA_CANONICAL_SINGLE_RATE_PROOF_V1,
      noPurchase: true as const,
      buyerFacingShipping: false as const,
    }),
  })
}

export async function resolveWindowFilmListingWorkspaceEvidenceV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunity: JsonRecord
  }>,
) {
  const target = WINDOW_FILM_LISTING_INTAKE_TARGET_V1
  const [decisionPackage, frontiers] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase,
      target.decisionPackageId, input.accountKey),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
  ])
  if (frontiers.error) {
    throw new Error("WINDOW_FILM_WORKSPACE_SHIPPING_READBACK_FAILED")
  }
  return buildWindowFilmListingWorkspaceEvidenceV1({
    decisionPackage,
    opportunity: input.opportunity,
    profitabilityFrontiers: frontiers.data,
  })
}

export function isCakeTurntableListingIntakeV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return marker.contractVersion === SMART_STOCKING_LISTING_INTAKE_VERSION &&
    marker.decisionPackageId ===
      CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.packageId &&
    marker.finalDecision === "LISTING_READY" &&
    marker.finalPriceUsd === 25.99 &&
    marker.finalEconomicsStatus === "PASS" &&
    marker.entryPotentialScore === 57 &&
    marker.exactIdentityVerified === true &&
    marker.currentSupplierAvailabilityVerified === true
}

export function isWindowFilmListingIntakeV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  const target = WINDOW_FILM_LISTING_INTAKE_TARGET_V1
  return marker.contractVersion === SMART_STOCKING_LISTING_INTAKE_VERSION
    && marker.decisionPackageId === target.decisionPackageId
    && marker.candidateKey === target.candidateKey
    && marker.supplierSku === target.lunaSku
    && marker.finalDecision === "LISTING_READY"
    && marker.finalPriceUsd === target.salePriceUsd
    && marker.finalEconomicsStatus === "PASS"
    && marker.entryPotentialScore === target.entryPotentialScore
    && marker.exactIdentityVerified === true
    && marker.currentSupplierAvailabilityVerified === true
}

export function isSmartStockingListingIntakeV1(value: unknown) {
  return isCakeTurntableListingIntakeV1(value)
    || isWindowFilmListingIntakeV1(value)
}

export function buildCakeTurntableListingIntakeV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  lunaProduct: DirectedLunaProduct
  marketRadarProductId: string
  observedAt: string
}>) {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const profile = input.decisionPackage.smartStockingLearningProfile
  const identity = input.decisionPackage.package.productIdentity.identity
  const variant = input.lunaProduct.variants.find((entry) =>
    entry.id === target.lunaVariantId && entry.sku === target.lunaSku)
  if (
    input.decisionPackage.packageId !== target.packageId ||
    input.decisionPackage.status !== "GENERATED" ||
    !profile ||
    profile.entrySnapshot.entryPotentialScore !== 57 ||
    profile.decisionSnapshot.launchTier !== "CONTROLLED_MERCHANDISING_BET" ||
    profile.decisionSnapshot.parkReason !== null ||
    profile.decisionSnapshot.finalEconomics.status !== "PASS" ||
    profile.decisionSnapshot.finalEconomics.thresholdResult !== "PASS" ||
    profile.decisionSnapshot.finalEconomics.salePriceUsd !== 25.99 ||
    profile.decisionSnapshot.finalEconomics.lunaProductCostUsd !== 3.8 ||
    profile.decisionSnapshot.finalEconomics.lunaShippingUsd !== 9.99 ||
    identity.gtin !== target.gtin ||
    input.lunaProduct.productId !== target.lunaProductId ||
    !variant || variant.sourceUnitBarcode !== target.gtin ||
    variant.sourceUnitPrice !== target.unitCostUsd ||
    variant.available !== true ||
    input.lunaProduct.imageUrls.length < 1 ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !/^[0-9a-f-]{36}$/i.test(input.marketRadarProductId)
  ) throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_AUTHORITY_MISMATCH")

  const decision = profile.decisionSnapshot
  const economics = decision.finalEconomics
  const assessment = {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    smartStockingListingIntakeV1: {
      contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
      decisionPackageId: target.packageId,
      finalDecision: "LISTING_READY",
      finalPriceUsd: 25.99,
      finalEconomicsStatus: "PASS",
      entryPotentialScore: 57,
      exactIdentityVerified: true,
      currentSupplierAvailabilityVerified: true,
      safeCapacity: null,
    },
    candidate: {
      candidateKey: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
      marketRadarProductId: input.marketRadarProductId,
      supplierProductId: target.lunaProductId,
      supplierVariantId: target.lunaVariantId,
      sku: target.lunaSku,
      title: input.lunaProduct.title,
      variantTitle: variant.title,
      gtin: target.gtin,
      supplierCost: target.unitCostUsd,
      available: true,
      inventoryQuantity: null,
      stockCapturedAt: new Date(input.observedAt).toISOString(),
      weight: variant.weight,
      weightUnit: variant.weightUnit,
      dimensions: null,
      imageUrls: [...new Set(input.lunaProduct.imageUrls)],
      description:
        "Single 11-inch revolving plastic cake turntable with a non-slip base for cake decorating. Supplier brand is not specified.",
    },
    identity: { exactIdentityConfirmed: true, comparables: [] },
    economics: {
      ready: true,
      estimatedNetProfit: economics.contributionProfitUsd,
      estimatedNetMarginPercent: economics.contributionMarginPercent,
      estimatedRoiPercent: economics.roiPercent,
      authoritativeSupplierShippingUsd: economics.lunaShippingUsd,
    },
    market: {
      candidateListingsFound: 5,
      activeExactComparables: 0,
      soldExactCount: 0,
      executedQuery: "11 inch revolving plastic cake turntable non-slip base",
      evidenceSemantics: "ACTIVE_ASK_CONTEXT_NOT_SOLD_AUTHORITY",
    },
    scores: {
      opportunityScore: decision.launchPotentialScore,
      potentialScore: decision.launchPotentialScore,
      confidenceScore: 90,
      urgencyScore: 90,
      demandScore: 35,
      economicsScore: 82,
      identityScore: 100,
      competitionScore: 30,
      supplyScore: 80,
      listingReadinessScore: 85,
      sellerPriorityScore: decision.launchPotentialScore,
    },
    listingIntelligencePackage: {
      recommendedTitle: LISTING_TITLE,
      titleStrategy: {
        titleFormula: LISTING_TITLE,
        primarySearchPhrase: "11 inch revolving cake turntable",
        secondarySearchTerms: ["cake decorating", "plastic", "non-slip base"],
        confirmedAttributes: ["11 inch", "revolving", "plastic", "non-slip base"],
        strategyConfidence: "PRODUCT_TRUTH_SUPPORTED",
      },
      categoryRecommendation: {
        // Current official eBay US leaf for Icing Turntables. The historical
        // research-task category remains evidence provenance, not publication
        // taxonomy authority.
        categoryId: "183335",
        categoryName: "Icing & Decorating Turntables",
      },
      itemSpecifics: {
        supplierConfirmed: {
          Type: "Cake Turntable",
          Material: "Plastic",
          Size: "11 in",
        },
      },
      shippingRecommendation: {
        supplierShippingEconomicsUsd: 9.99,
        buyerFacingShippingPolicy: "USE_CANONICAL_ACCOUNT_POLICY",
      },
    },
    hardGates: [
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ],
    evidenceGuards: [],
    canProceedToListingPackage: false,
    safety: {
      exactSoldClaimed: false,
      activeAskTreatedAsSold: false,
      safeCapacityClaimed: false,
      listingAuthorized: false,
      marketplaceWrites: 0,
    },
  }

  return {
    candidate_key: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    market_radar_product_id: input.marketRadarProductId,
    supplier_product_id: target.lunaProductId,
    supplier_variant_id: target.lunaVariantId,
    supplier_sku: target.lunaSku,
    product_title: input.lunaProduct.title,
    variant_title: variant.title,
    gtin: target.gtin,
    queue_status: "ready",
    decision: "LISTING_READY",
    opportunity_score: decision.launchPotentialScore,
    demand_score: 35,
    economics_score: 82,
    identity_score: 100,
    competition_score: 30,
    supply_score: 80,
    listing_readiness_score: 85,
    active_comparables: 0,
    sellers_with_movement: 0,
    estimated_weekly_velocity: null,
    median_total_buyer_price: 25.99,
    estimated_net_profit: economics.contributionProfitUsd,
    supplier_price: target.unitCostUsd,
    supplier_available: true,
    supplier_inventory_quantity: null,
    supplier_snapshot_at: new Date(input.observedAt).toISOString(),
    best_selling_match_score: null,
    best_selling_matches: [],
    keyword_structure: assessment.listingIntelligencePackage.titleStrategy,
    hard_gates: assessment.hardGates,
    evidence_guards: [],
    assessment,
    last_scanned_at: new Date(input.observedAt).toISOString(),
    next_scan_at: new Date(Date.parse(input.observedAt) + 86_400_000).toISOString(),
    updated_at: new Date(input.observedAt).toISOString(),
  }
}

export function buildWindowFilmListingIntakeV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  lunaProduct: DirectedLunaProduct
  marketRadarProductId: string
  profitabilityFrontiers: unknown
  observedAt: string
}>) {
  const authority = windowFilmCommercialAuthoritiesV1(input)
  const { target, frontierRow, frontier } = authority
  const variant = input.lunaProduct.variants.find((entry) =>
    entry.id === target.lunaVariantId && entry.sku === target.lunaSku)
  if (
    input.lunaProduct.productId !== target.lunaProductId
    || !variant
    || variant.sourceUnitBarcode !== target.gtin
    || money(variant.sourceUnitPrice) !== target.unitCostUsd
    || variant.available !== true
    || input.lunaProduct.imageUrls.length < 1
    || !Number.isFinite(Date.parse(input.observedAt))
    || !/^[0-9a-f-]{36}$/i.test(input.marketRadarProductId)
  ) throw new Error("WINDOW_FILM_LISTING_INTAKE_PRODUCT_TRUTH_MISMATCH")

  const observedAt = new Date(input.observedAt).toISOString()
  const productTruthCore = {
    authorityClass: LUNA_EXACT_PRODUCT_TRUTH_AUTHORITY,
    candidateKey: target.candidateKey,
    lunaProductId: target.lunaProductId,
    lunaVariantId: target.lunaVariantId,
    supplierSku: target.lunaSku,
    gtin: target.gtin,
    supplierPriceUsd: target.unitCostUsd,
    title: input.lunaProduct.title,
    sourceUrl: input.lunaProduct.canonicalUrl,
    imageCount: [...new Set(input.lunaProduct.imageUrls)].length,
    rawHtmlStored: false,
    marketplaceWrites: 0,
    stock: {
      state: "IN_STOCK_SUPPLIER_STATED",
      freshness: "FRESH",
      observedAt,
      exactIdentityVerified: true,
      supplierStatedQuantity: null,
      safeCapacity: null,
      safeCapacityStatus: "UNPROVEN_NOT_INFERRED",
    },
    brand: {
      noManufacturerBrandClaim: "UNPROVEN",
      ebayBrandSemantics: "UNKNOWN",
      taxonomyBrandValue: null,
    },
  }
  const productTruth = {
    ...productTruthCore,
    evidenceDigest: digest(productTruthCore),
  }
  const marker = {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    decisionPackageId: target.decisionPackageId,
    candidateKey: target.candidateKey,
    supplierSku: target.lunaSku,
    finalDecision: "LISTING_READY",
    finalPriceUsd: target.salePriceUsd,
    finalEconomicsStatus: "PASS",
    entryPotentialScore: target.entryPotentialScore,
    exactIdentityVerified: true,
    currentSupplierAvailabilityVerified: true,
    safeCapacity: null,
    frontierId: String(frontierRow.frontierId ?? ""),
    frontierDigest: String(frontier.frontierDigest),
    frontierSnapshotDigest: String(frontierRow.snapshotDigest),
  }
  const assessment = {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    smartStockingListingIntakeV1: marker,
    candidate: {
      candidateKey: target.candidateKey,
      marketRadarProductId: input.marketRadarProductId,
      supplierProductId: target.lunaProductId,
      supplierVariantId: target.lunaVariantId,
      sku: target.lunaSku,
      title: input.lunaProduct.title,
      variantTitle: variant.title,
      gtin: target.gtin,
      supplierCost: target.unitCostUsd,
      available: true,
      inventoryQuantity: null,
      stockCapturedAt: observedAt,
      weight: variant.weight,
      weightUnit: variant.weightUnit,
      dimensions: { nominalSize: "23.6 in x 9.84 ft" },
      imageUrls: [...new Set(input.lunaProduct.imageUrls)],
      description:
        "Single window privacy film roll sized 23.6 in x 9.84 ft for home window tinting. No UV percentage, heat-blocking performance, energy-saving, color, material, brand, model, or MPN claim is made.",
    },
    productTruth,
    identity: { exactIdentityConfirmed: true, comparables: [] },
    economics: {
      ready: true,
      estimatedNetProfit: target.contributionProfitUsd,
      estimatedNetMarginPercent: target.contributionMarginPercent,
      estimatedRoiPercent: target.roiPercent,
      authoritativeSupplierShippingUsd: target.supplierShippingUsd,
    },
    market: {
      freshFamilySoldSignals: 5,
      activeExactComparables: 0,
      soldExactCount: 0,
      familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
      evidenceSemantics:
        "FAMILY_DEMAND_NOT_EXACT_PRICING_AUTHORITY;ACTIVE_CONTEXT_NOT_SOLD_AUTHORITY",
    },
    scores: {
      opportunityScore: target.entryPotentialScore,
      potentialScore: target.entryPotentialScore,
      confidenceScore: 75,
      urgencyScore: 80,
      demandScore: 55,
      economicsScore: 78,
      identityScore: 100,
      competitionScore: 40,
      supplyScore: 80,
      listingReadinessScore: 75,
      sellerPriorityScore: target.entryPotentialScore,
    },
    listingIntelligencePackage: {
      recommendedTitle: target.listingTitle,
      titleStrategy: {
        titleFormula: target.listingTitle,
        primarySearchPhrase: "window privacy film",
        secondarySearchTerms: ["one way", "23.6 in x 9.84 ft", "tint for home"],
        confirmedAttributes: ["window privacy film", "23.6 in x 9.84 ft"],
        strategyConfidence: "PRODUCT_TRUTH_AND_FAMILY_MARKET_SUPPORTED",
      },
      categoryRecommendation: {
        categoryId: target.categoryId,
        categoryName: target.categoryName,
      },
      itemSpecifics: {
        supplierConfirmed: {
          Type: "Window Film",
          Size: "23.6 in x 9.84 ft",
        },
      },
      shippingRecommendation: {
        supplierShippingEconomicsUsd: target.supplierShippingUsd,
        buyerFacingShippingPolicy: "USE_CANONICAL_ACCOUNT_POLICY",
      },
    },
    hardGates: [
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ],
    evidenceGuards: [],
    canProceedToListingPackage: false,
    safety: {
      exactSoldClaimed: false,
      activeAskTreatedAsSold: false,
      unsupportedPerformanceClaimsUsed: false,
      safeCapacityClaimed: false,
      listingAuthorized: false,
      marketplaceWrites: 0,
    },
  }

  return {
    candidate_key: target.candidateKey,
    market_radar_product_id: input.marketRadarProductId,
    supplier_product_id: target.lunaProductId,
    supplier_variant_id: target.lunaVariantId,
    supplier_sku: target.lunaSku,
    product_title: input.lunaProduct.title,
    variant_title: variant.title,
    gtin: target.gtin,
    queue_status: "ready",
    decision: "LISTING_READY",
    opportunity_score: target.entryPotentialScore,
    demand_score: 55,
    economics_score: 78,
    identity_score: 100,
    competition_score: 40,
    supply_score: 80,
    listing_readiness_score: 75,
    active_comparables: 0,
    sellers_with_movement: 0,
    estimated_weekly_velocity: null,
    median_total_buyer_price: target.salePriceUsd,
    estimated_net_profit: target.contributionProfitUsd,
    supplier_price: target.unitCostUsd,
    supplier_available: true,
    supplier_inventory_quantity: null,
    supplier_snapshot_at: observedAt,
    best_selling_match_score: null,
    best_selling_matches: [],
    keyword_structure: assessment.listingIntelligencePackage.titleStrategy,
    hard_gates: assessment.hardGates,
    evidence_guards: [],
    assessment,
    last_scanned_at: observedAt,
    next_scan_at: new Date(Date.parse(observedAt) + 86_400_000).toISOString(),
    updated_at: observedAt,
  }
}

export async function materializeCakeTurntableListingIntakeV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  observedAt?: string
  readPublicProduct?: typeof fetchPublicLunaProductForActiveListingMonitor
}>) {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const [decisionPackage, catalog] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase, target.packageId,
      input.accountKey),
    input.supabase.from("market_radar_latest_variants")
      .select("product_id,product_url")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", target.lunaProductId)
      .eq("supplier_variant_id", target.lunaVariantId)
      .eq("sku", target.lunaSku).maybeSingle(),
  ])
  if (catalog.error || !catalog.data || !text(catalog.data.product_url)) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_PRODUCT_TRUTH_UNAVAILABLE")
  }
  const readPublicProduct = input.readPublicProduct ??
    fetchPublicLunaProductForActiveListingMonitor
  const product = await readPublicProduct(String(catalog.data.product_url))
  const row = buildCakeTurntableListingIntakeV1({
    decisionPackage,
    lunaProduct: product,
    marketRadarProductId: String(catalog.data.product_id),
    observedAt: input.observedAt ?? new Date().toISOString(),
  })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .upsert(row, { onConflict: "candidate_key" }).select("id,candidate_key,decision")
    .single()
  if (write.error || !write.data) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_WRITE_FAILED")
  }
  const readback = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,decision,assessment")
    .eq("id", write.data.id).maybeSingle()
  if (readback.error || !readback.data ||
      readback.data.candidate_key !== CAKE_TURNTABLE_LISTING_INTAKE_KEY ||
      readback.data.decision !== "LISTING_READY" ||
      !isSmartStockingListingIntakeV1(readback.data.assessment)) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_READBACK_FAILED")
  }
  return Object.freeze({
    opportunityId: String(readback.data.id),
    candidateKey: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    listingWorkspaceUrl: `/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(String(readback.data.id))}&candidate=${encodeURIComponent(CAKE_TURNTABLE_LISTING_INTAKE_KEY)}`,
    durableReadback: true as const,
    marketplaceWrites: 0 as const,
  })
}

export async function materializeWindowFilmListingIntakeV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  observedAt?: string
  readPublicProduct?: typeof fetchPublicLunaProductForActiveListingMonitor
}>) {
  const target = WINDOW_FILM_LISTING_INTAKE_TARGET_V1
  const [decisionPackage, catalog, frontiers] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase,
      target.decisionPackageId, input.accountKey),
    input.supabase.from("market_radar_latest_variants")
      .select("product_id,product_url")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", target.lunaProductId)
      .eq("supplier_variant_id", target.lunaVariantId)
      .eq("sku", target.lunaSku).maybeSingle(),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
  ])
  if (catalog.error || !catalog.data || !text(catalog.data.product_url)) {
    throw new Error("WINDOW_FILM_LISTING_INTAKE_PRODUCT_TRUTH_UNAVAILABLE")
  }
  if (frontiers.error) {
    throw new Error("WINDOW_FILM_LISTING_INTAKE_FRONTIER_READ_FAILED")
  }
  const readPublicProduct = input.readPublicProduct
    ?? fetchPublicLunaProductForActiveListingMonitor
  const product = await readPublicProduct(String(catalog.data.product_url))
  const row = buildWindowFilmListingIntakeV1({
    decisionPackage,
    lunaProduct: product,
    marketRadarProductId: String(catalog.data.product_id),
    profitabilityFrontiers: frontiers.data,
    observedAt: input.observedAt ?? new Date().toISOString(),
  })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .upsert(row, { onConflict: "candidate_key" })
    .select("id,candidate_key,decision").single()
  if (write.error || !write.data) {
    throw new Error("WINDOW_FILM_LISTING_INTAKE_WRITE_FAILED")
  }
  const readback = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,decision,assessment")
    .eq("id", write.data.id).maybeSingle()
  if (
    readback.error || !readback.data
    || readback.data.candidate_key !== target.candidateKey
    || readback.data.decision !== "LISTING_READY"
    || !isWindowFilmListingIntakeV1(readback.data.assessment)
  ) throw new Error("WINDOW_FILM_LISTING_INTAKE_READBACK_FAILED")
  return Object.freeze({
    opportunityId: String(readback.data.id),
    candidateKey: target.candidateKey,
    listingWorkspaceUrl:
      `/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(String(readback.data.id))}&candidate=${encodeURIComponent(target.candidateKey)}`,
    durableReadback: true as const,
    marketplaceWrites: 0 as const,
  })
}

export async function resolveSmartStockingListingWorkspaceEvidenceV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunity: JsonRecord
  }>,
): Promise<SmartStockingListingWorkspaceEvidenceV1 | null> {
  const candidateKey = text(input.opportunity.candidate_key)
  if (candidateKey === CAKE_TURNTABLE_LISTING_INTAKE_KEY) {
    return resolveCakeTurntableListingWorkspaceEvidenceV1(input)
  }
  if (candidateKey === WINDOW_FILM_LISTING_INTAKE_KEY) {
    return resolveWindowFilmListingWorkspaceEvidenceV1(input)
  }
  return null
}

export async function readWindowFilmListingIntakeSummaryV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const target = WINDOW_FILM_LISTING_INTAKE_TARGET_V1
  const [decisionPackage, frontiers, existingIntake] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase,
      target.decisionPackageId, input.accountKey),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
    input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,decision")
      .eq("candidate_key", target.candidateKey).maybeSingle(),
  ])
  if (frontiers.error || existingIntake.error) {
    throw new Error("WINDOW_FILM_LISTING_INTAKE_SUMMARY_READ_FAILED")
  }
  windowFilmCommercialAuthoritiesV1({
    decisionPackage,
    profitabilityFrontiers: frontiers.data,
  })
  const existing = existingIntake.data
  return Object.freeze({
    decisionPackageId: target.decisionPackageId,
    candidateKey: target.candidateKey,
    supplierSku: target.lunaSku,
    gtin: target.gtin,
    productTitle: "Window Privacy Film 23.6 in x 9.84 ft",
    finalDecision: "LISTING_READY" as const,
    finalPriceUsd: target.salePriceUsd,
    entryPotentialScore: target.entryPotentialScore,
    intakeMaterialized: Boolean(existing),
    listingWorkspaceUrl: existing
      ? `/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(String(existing.id))}&candidate=${encodeURIComponent(target.candidateKey)}`
      : null,
    publicationAuthorized: false as const,
  })
}
