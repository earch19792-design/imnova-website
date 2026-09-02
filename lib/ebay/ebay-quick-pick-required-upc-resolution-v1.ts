import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDirectedLunaProduct } from
  "./ebay-luna-directed-product-import"
import { buildQuickPickMarketTestListingReviewV1 } from
  "./ebay-quick-pick-market-test-package-v1"
import { validateGtinChecksum } from "./ebay-winner-evidence-v2"

export const CAN_READER_REQUIRED_UPC_AUTOMATIC_RESOLUTION_V1 =
  "CAN_READER_REQUIRED_UPC_AUTOMATIC_RESOLUTION_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 1_000) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

function potentialMultipack(...values: unknown[]) {
  const joined = values.map((value) => text(value, 500) ?? "")
    .join(" ").toLocaleLowerCase("en-US")
  return /\b(?:pack\s+of\s+[2-9]|[2-9]\d?\s*[- ]?pack|set\s+of\s+[2-9])\b/
    .test(joined)
}

export async function resolveExactLunaUpcEvidenceV1(input: Readonly<{
  productUrl: string
  lunaProductId: string
  lunaVariantId: string
  sourceSku: string
  productTitle?: string | null
  variantTitle?: string | null
  fetchImpl?: typeof fetch
}>) {
  const product = await fetchDirectedLunaProduct(input.productUrl,
    input.fetchImpl ?? fetch)
  const exactVariants = product.variants.filter((variant) =>
    variant.id === input.lunaVariantId && variant.sku === input.sourceSku)
  const exactVariant = exactVariants.length === 1 ? exactVariants[0] : null
  const exactIdentityMatch = product.productId === input.lunaProductId
    && exactVariant !== null
  if (!exactIdentityMatch) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_EXACT_IDENTITY_MISMATCH")
  }
  const upc = text(exactVariant.sourceUnitBarcode, 32)
    ?.replace(/[\s-]/g, "") ?? null
  if (!upc || !/^\d{12}$/.test(upc) || !validateGtinChecksum(upc)) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_EXACT_VALUE_UNAVAILABLE")
  }
  if (potentialMultipack(input.productTitle, input.variantTitle,
    product.title, exactVariant.title)) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_MULTIPACK_IDENTITY_UNPROVEN")
  }
  const core = Object.freeze({
    contractVersion: CAN_READER_REQUIRED_UPC_AUTOMATIC_RESOLUTION_V1,
    sourceClass: "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK" as const,
    lunaProductId: product.productId,
    lunaVariantId: exactVariant.id,
    sourceSku: exactVariant.sku,
    canonicalProductUrl: product.canonicalUrl,
    upc,
    exactIdentityMatch: true as const,
    checksumValid: true as const,
    unitIdentifierSemantics: "SINGLE_EXACT_VARIANT" as const,
    factInvented: false as const,
  })
  return Object.freeze({ ...core, evidenceDigest: digest(core) })
}

export function buildRequiredUpcPackageProjectionV1(input: Readonly<{
  packageData: JsonRecord
  review: ReturnType<typeof buildQuickPickMarketTestListingReviewV1>
  evidence: Awaited<ReturnType<typeof resolveExactLunaUpcEvidenceV1>>
  actorUserId: string
  now: string
}>) {
  const previousOwnerReview = record(input.packageData.quickPickOwnerReviewV1)
  return Object.freeze({
    ...input.packageData,
    productIdentifiers: {
      ...record(input.packageData.productIdentifiers),
      upc: input.evidence.upc,
      source: input.evidence.sourceClass,
      exactIdentityMatch: true,
      evidenceDigest: input.evidence.evidenceDigest,
    },
    exactProductIdentifierResolutionV1: {
      ...input.evidence,
      resolvedAt: input.now,
    },
    quickPickMarketTestPackageV1: input.review,
    quickPickOwnerReviewV1: {
      ...previousOwnerReview,
      status: "EDITED_PENDING_CONFIRMATION",
      invalidatedBy: input.actorUserId,
      invalidatedAt: input.now,
      invalidationReason:
        "EXACT_UPC_ENRICHED_AFTER_EBAY_CATEGORY_POLICY_PREFLIGHT",
      readyForOwnerPublishAuthorization: false,
      marketplaceWriteAuthorized: false,
      marketplaceWrites: 0,
    },
  })
}

export async function persistQuickPickRequiredUpcResolutionV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  candidateKey: string
  listingPackageId: string
  fetchImpl?: typeof fetch
}>) {
  const packageRead = await input.supabase.from("ebay_listing_packages")
    .select("*").eq("id", input.listingPackageId)
    .eq("candidate_key", input.candidateKey)
    .eq("account_key", input.accountKey).maybeSingle()
  const listingPackage = record(packageRead.data)
  if (packageRead.error || !listingPackage.id) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_PACKAGE_NOT_FOUND")
  }
  const opportunityRead = await input.supabase
    .from("ebay_luna_opportunity_queue").select("*")
    .eq("id", listingPackage.opportunity_id)
    .eq("candidate_key", input.candidateKey).maybeSingle()
  const opportunity = record(opportunityRead.data)
  if (opportunityRead.error || !opportunity.id) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_OPPORTUNITY_NOT_FOUND")
  }
  const lunaProductId = text(opportunity.supplier_product_id, 80)
  const lunaVariantId = text(opportunity.supplier_variant_id, 80)
  const sourceSku = text(opportunity.supplier_sku, 160)
  if (!lunaProductId || !lunaVariantId || !sourceSku) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_EXACT_IDENTITY_REQUIRED")
  }
  const catalogRead = await input.supabase
    .from("market_radar_latest_variants").select("*")
    .eq("source_key", "lunaportex")
    .eq("supplier_product_id", lunaProductId)
    .eq("supplier_variant_id", lunaVariantId)
    .eq("sku", sourceSku).limit(2)
  const catalogRows = Array.isArray(catalogRead.data)
    ? catalogRead.data.map(record) : []
  const catalog = catalogRows.length === 1 ? catalogRows[0] : null
  const productUrl = text(catalog?.product_url, 2_000)
  if (catalogRead.error || !catalog || !productUrl) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_CATALOG_AUTHORITY_UNAVAILABLE")
  }
  const evidence = await resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId, lunaVariantId, sourceSku,
    productTitle: text(opportunity.product_title, 500),
    variantTitle: text(opportunity.variant_title, 500),
    fetchImpl: input.fetchImpl })
  const currentGtin = text(opportunity.gtin, 32)?.replace(/[\s-]/g, "")
  if (currentGtin && currentGtin !== evidence.upc) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_DURABLE_IDENTITY_CONFLICT")
  }
  const now = new Date().toISOString()
  const assessment = record(opportunity.assessment)
  const nextAssessment = {
    ...assessment,
    productTruth: { ...record(assessment.productTruth),
      gtin: evidence.upc,
      exactProductIdentifierResolutionV1: evidence },
    exactProductIdentifierResolutionV1: { ...evidence, resolvedAt: now },
  }
  const nextOpportunity = { ...opportunity, gtin: evidence.upc,
    assessment: nextAssessment }
  const preliminaryPackageData = {
    ...record(listingPackage.package_data),
    productIdentifiers: {
      ...record(record(listingPackage.package_data).productIdentifiers),
      upc: evidence.upc,
      source: evidence.sourceClass,
      exactIdentityMatch: true,
      evidenceDigest: evidence.evidenceDigest,
    },
  }
  const review = buildQuickPickMarketTestListingReviewV1({
    opportunity: nextOpportunity,
    listingPackage: { ...listingPackage, package_data: preliminaryPackageData },
    catalogRow: catalog,
  })
  const nextPackageData = buildRequiredUpcPackageProjectionV1({
    packageData: preliminaryPackageData, review, evidence,
    actorUserId: input.actorUserId, now,
  })

  const packageWrite = await input.supabase.from("ebay_listing_packages")
    .update({ package_data: nextPackageData, status: "ready_for_review",
      readiness: 100, updated_at: now })
    .eq("id", listingPackage.id)
    .eq("candidate_key", input.candidateKey)
    .eq("account_key", input.accountKey)
    .eq("updated_at", listingPackage.updated_at)
    .select("id,status,package_data,updated_at").maybeSingle()
  const storedPackage = record(packageWrite.data)
  const storedPackageData = record(storedPackage.package_data)
  const storedOwnerReview = record(storedPackageData.quickPickOwnerReviewV1)
  if (packageWrite.error || !storedPackage.id
      || record(storedPackageData.productIdentifiers).upc !== evidence.upc
      || storedOwnerReview.status !== "EDITED_PENDING_CONFIRMATION"
      || storedOwnerReview.readyForOwnerPublishAuthorization !== false) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_PACKAGE_WRITE_FAILED")
  }

  const opportunityWrite = await input.supabase
    .from("ebay_luna_opportunity_queue")
    .update({ gtin: evidence.upc, assessment: nextAssessment,
      updated_at: now })
    .eq("id", opportunity.id).eq("candidate_key", input.candidateKey)
    .eq("supplier_product_id", lunaProductId)
    .eq("supplier_variant_id", lunaVariantId)
    .eq("supplier_sku", sourceSku)
    .select("id,gtin,assessment,updated_at").maybeSingle()
  const storedOpportunity = record(opportunityWrite.data)
  const storedEvidence = record(record(storedOpportunity.assessment)
    .exactProductIdentifierResolutionV1)
  if (opportunityWrite.error || !storedOpportunity.id
      || storedOpportunity.gtin !== evidence.upc
      || storedEvidence.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error("QUICK_PICK_REQUIRED_UPC_OPPORTUNITY_WRITE_FAILED")
  }
  return Object.freeze({
    upcRequirement: "REQUIRED" as const,
    exactUpcFound: true as const,
    upcValue: evidence.upc,
    upcEvidenceSource: evidence.sourceClass,
    exactIdentityMatch: true as const,
    automaticResolutionExhausted: true as const,
    ownerReconfirmationRequired: true as const,
    packageChanged: true as const,
    packageId: String(listingPackage.id),
    packageStatus: storedPackage.status,
    previousOwnerConfirmationInvalidated: true as const,
    categoryId: text(record(listingPackage.package_data).categoryId, 30),
    inventoryItemPayload: { product: { upc: [evidence.upc] } },
    factInvented: false as const,
    marketplaceWrites: 0 as const,
    publishOfferCallIncrement: 0 as const,
    offerRecreations: 0 as const,
    inventoryItemRecreations: 0 as const,
  })
}
