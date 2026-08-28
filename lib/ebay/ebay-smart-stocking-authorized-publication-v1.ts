import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  evaluatePublishWithStockguardContractV1,
} from "./ebay-current-future-listing-stockguard-wiring-v1"
import { canonicalEbayPackageSku } from "./ebay-sku"
import {
  isSmartStockingListingIntakeV1,
  resolveSmartStockingListingWorkspaceEvidenceV1,
  type SmartStockingListingWorkspaceEvidenceV1,
} from "./ebay-smart-stocking-listing-intake-v1"

export const SMART_STOCKING_AUTHORIZED_PUBLICATION_VERSION =
  "SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
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

function exactMoney(left: unknown, right: number) {
  return Number.isFinite(Number(left)) &&
    Math.round(Number(left) * 100) === Math.round(right * 100)
}

export function buildSmartStockingAuthorizedPublicationV1(input: Readonly<{
  accountKey: string
  actorUserId: string
  listingPackage: JsonRecord
  opportunity: JsonRecord
  evidence: SmartStockingListingWorkspaceEvidenceV1
  canonicalLunaUrl: string
}>) {
  const packageId = text(input.listingPackage.id)
  const opportunityId = text(input.opportunity.id)
  const candidateKey = text(input.listingPackage.candidate_key)
  const packageData = record(input.listingPackage.package_data)
  const pricing = record(packageData.pricing)
  const evidenceBinding = record(pricing.evidenceBinding)
  const boundProductTruth = record(evidenceBinding.productTruth)
  const boundStock = record(evidenceBinding.stock)
  const assessment = record(input.opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  const productTruthStock = record(productTruth.stock)
  const productTruthBrand = record(productTruth.brand)
  const lunaProductId = text(productTruth.lunaProductId)
  const lunaVariantId = text(productTruth.lunaVariantId)
  const supplierSku = text(productTruth.supplierSku)
  const gtin = text(productTruth.gtin)
  const expectedSku = canonicalEbayPackageSku(packageId)
  let lunaUrl = ""
  try {
    const parsed = new URL(input.canonicalLunaUrl)
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password &&
        ["lunaportex.com", "www.lunaportex.com"].includes(
          parsed.hostname.toLowerCase(),
        ) && /^\/products\/[A-Za-z0-9%._~-]+$/.test(parsed.pathname)) {
      parsed.hash = ""
      lunaUrl = parsed.toString()
    }
  } catch {
    lunaUrl = ""
  }
  if (
    !/^[0-9a-f-]{36}$/i.test(packageId) ||
    !/^[0-9a-f-]{36}$/i.test(opportunityId) ||
    !/^[0-9a-f-]{36}$/i.test(input.actorUserId) ||
    !input.accountKey || !expectedSku || !lunaUrl ||
    text(input.listingPackage.created_by) !== input.actorUserId ||
    text(input.listingPackage.account_key) !== input.accountKey ||
    text(input.listingPackage.opportunity_id) !== opportunityId ||
    text(input.opportunity.candidate_key) !== candidateKey ||
    text(input.opportunity.queue_status) !== "ready" ||
    text(input.opportunity.decision) !== "LISTING_READY" ||
    !isSmartStockingListingIntakeV1(assessment) ||
    evidenceBinding.authorityClass !== input.evidence.authorityClass ||
    evidenceBinding.decisionPackageId !== input.evidence.decisionPackageId ||
    Number(evidenceBinding.entryPotentialScore) !==
      input.evidence.entryPotentialScore ||
    evidenceBinding.entrySnapshotHash !== input.evidence.entrySnapshotHash ||
    evidenceBinding.decisionSnapshotHash !==
      input.evidence.decisionSnapshotHash ||
    evidenceBinding.launchTier !== input.evidence.launchTier ||
    evidenceBinding.frontierId !== input.evidence.frontierId ||
    evidenceBinding.frontierDigest !== input.evidence.frontierDigest ||
    evidenceBinding.snapshotDigest !== input.evidence.snapshotDigest ||
    boundProductTruth.evidenceDigest !==
      input.evidence.productTruth.evidenceDigest ||
    boundStock.state !== input.evidence.stock.state ||
    boundStock.quantity !== input.evidence.stock.quantity ||
    boundStock.safeCapacity !== input.evidence.stock.safeCapacity ||
    boundStock.observedAt !== input.evidence.stock.observedAt ||
    text(packageData.categoryId) !== input.evidence.category.categoryId ||
    !exactMoney(pricing.targetPrice, input.evidence.salePriceUsd) ||
    !exactMoney(pricing.supplierCost, input.evidence.supplierCostUsd) ||
    !exactMoney(pricing.estimatedOutboundShipping,
      input.evidence.supplierShippingUsd) ||
    !exactMoney(pricing.estimatedEbayFees,
      input.evidence.estimatedEbayFeesUsd) ||
    !exactMoney(pricing.estimatedNetProfit,
      input.evidence.contributionProfitUsd) ||
    !exactMoney(pricing.estimatedNetMarginPercent,
      input.evidence.contributionMarginPercent) ||
    !exactMoney(pricing.estimatedRoiPercent, input.evidence.roiPercent) ||
    pricing.passesProfitGate !== true ||
    !/^\d{1,30}$/.test(lunaProductId) ||
    !/^\d{1,30}$/.test(lunaVariantId) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(supplierSku) ||
    !/^[A-Za-z0-9]{6,32}$/.test(gtin) ||
    text(productTruth.candidateKey) !== candidateKey ||
    text(input.opportunity.supplier_product_id) !== lunaProductId ||
    text(input.opportunity.supplier_variant_id) !== lunaVariantId ||
    text(input.opportunity.supplier_sku) !== supplierSku ||
    text(input.opportunity.gtin) !== gtin ||
    input.opportunity.supplier_available !== true ||
    !exactMoney(input.opportunity.supplier_price,
      input.evidence.supplierCostUsd) ||
    input.opportunity.supplier_inventory_quantity !==
      input.evidence.stock.quantity ||
    productTruth.evidenceDigest !==
      input.evidence.productTruth.evidenceDigest ||
    productTruthStock.state !== input.evidence.stock.state ||
    productTruthStock.freshness !== "FRESH" ||
    productTruthStock.exactIdentityVerified !== true ||
    productTruthStock.safeCapacity !== null ||
    productTruthStock.supplierStatedQuantity !== input.evidence.stock.quantity ||
    productTruthBrand.noManufacturerBrandClaim !==
      input.evidence.productTruth.noManufacturerBrandClaim ||
    productTruthBrand.ebayBrandSemantics !==
      input.evidence.productTruth.ebayBrandSemantics ||
    productTruthBrand.taxonomyBrandValue !==
      input.evidence.productTruth.taxonomyBrandValue
  ) throw new Error("SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH")

  const authorizationCore = Object.freeze({
    version: SMART_STOCKING_AUTHORIZED_PUBLICATION_VERSION,
    validated: true as const,
    accountKey: input.accountKey,
    actorUserId: input.actorUserId,
    listingPackageId: packageId,
    opportunityId,
    candidateKey,
    workspaceEvidenceAuthorityClass: input.evidence.authorityClass,
    decisionPackageId: input.evidence.decisionPackageId,
    entrySnapshotHash: input.evidence.entrySnapshotHash,
    decisionSnapshotHash: input.evidence.decisionSnapshotHash,
    productTruthDigest: input.evidence.productTruth.evidenceDigest,
    frontierId: input.evidence.frontierId,
    frontierDigest: input.evidence.frontierDigest,
    frontierSnapshotDigest: input.evidence.snapshotDigest,
    lunaProductId,
    lunaVariantId,
    supplierSku,
    gtin,
    canonicalLunaUrl: lunaUrl,
    stockState: input.evidence.stock.state,
    supplierInventoryQuantity: input.evidence.stock.quantity,
    safeCapacity: input.evidence.stock.safeCapacity,
    stockObservedAt: input.evidence.stock.observedAt,
    finalEconomicsStatus: "PASS" as const,
    thresholdResult: "PASS" as const,
    launchTier: input.evidence.launchTier,
    entryPotentialScore: input.evidence.entryPotentialScore,
    salePriceUsd: input.evidence.salePriceUsd,
    supplierCostUsd: input.evidence.supplierCostUsd,
    supplierShippingUsd: input.evidence.supplierShippingUsd,
    estimatedEbayFeesUsd: input.evidence.estimatedEbayFeesUsd,
    contributionProfitUsd: input.evidence.contributionProfitUsd,
    contributionMarginPercent: input.evidence.contributionMarginPercent,
    roiPercent: input.evidence.roiPercent,
    sourceRevalidationAuthority:
      "SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1",
    finalHumanAuthorizationRequired: true as const,
    unattendedPublicationAllowed: false as const,
  })
  const authorization = Object.freeze({
    ...authorizationCore,
    authorizationDigest: digest(authorizationCore),
  })
  const publishWithStockguardContract =
    evaluatePublishWithStockguardContractV1({
      sellerSku: expectedSku,
      expectedComponentCount: 1,
      economicsReady: true,
      monitorEnrollmentIntentPrepared: true,
      components: [{
        productId: authorization.lunaProductId,
        variantId: authorization.lunaVariantId,
        supplierSku: authorization.supplierSku,
        canonicalLunaUrl: lunaUrl,
        quantityRequiredPerBundle: 1,
        identityCertified: true,
        stockIdentityResolved: true,
        stockState: "IN_STOCK",
        sourceHealth: "HEALTHY",
        freshness: "FRESH",
        safeCapacity: null,
      }],
    })
  if (!publishWithStockguardContract.publishAllowed) {
    throw new Error("SMART_STOCKING_PUBLICATION_STOCKGUARD_NOT_READY")
  }
  return Object.freeze({
    authorization,
    economicsConfig: Object.freeze({
      estimatedOutboundShipping: input.evidence.supplierShippingUsd,
    }),
    publishWithStockguardContract,
  })
}

export async function resolveSmartStockingAuthorizedPublicationV1(input:
Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  listingPackage: JsonRecord
  opportunity: JsonRecord
}>) {
  const evidence = await resolveSmartStockingListingWorkspaceEvidenceV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    opportunity: input.opportunity,
  })
  if (!evidence) {
    throw new Error("SMART_STOCKING_PUBLICATION_EVIDENCE_NOT_FOUND")
  }
  const productTruth = record(record(input.opportunity.assessment).productTruth)
  const lunaProductId = text(productTruth.lunaProductId)
  const lunaVariantId = text(productTruth.lunaVariantId)
  const supplierSku = text(productTruth.supplierSku)
  const catalog = await input.supabase.from("market_radar_latest_variants")
    .select("source_key,supplier_product_id,supplier_variant_id,sku,product_url")
    .eq("source_key", "lunaportex")
    .eq("supplier_product_id", lunaProductId)
    .eq("supplier_variant_id", lunaVariantId)
    .eq("sku", supplierSku)
    .maybeSingle()
  if (catalog.error || !catalog.data ||
      text(catalog.data.product_url) === "") {
    throw new Error("SMART_STOCKING_PUBLICATION_LUNA_SOURCE_NOT_FOUND")
  }
  return buildSmartStockingAuthorizedPublicationV1({
    accountKey: input.accountKey,
    actorUserId: input.actorUserId,
    listingPackage: input.listingPackage,
    opportunity: input.opportunity,
    evidence,
    canonicalLunaUrl: text(catalog.data.product_url),
  })
}
