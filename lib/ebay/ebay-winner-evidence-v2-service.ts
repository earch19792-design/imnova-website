import type { SupabaseClient } from "@supabase/supabase-js"

import {
  runEbaySellerKeywordDemandValidation,
} from "./ebay-seller-keyword-demand-gateway"
import {
  buildWinnerEvidenceDecisionPackage,
  normalizeWinnerComparableOfferCounts,
  verifyWinnerEvidenceDecisionPackageIntegrity,
  type ProductIdentityInput,
  type WinnerComparableInput,
  type WinnerEvidenceDecisionPackage,
  type WinnerEvidenceInput,
} from "./ebay-winner-evidence-v2"
import {
  validateSmartStockingLearningProfileV1,
  type SmartStockingLearningProfile,
} from "./ebay-smart-stocking-learning-profile-v1"

const STAGING_REF = "vsfthqydfrdzulldbfbe"

type JsonRecord = Record<string, unknown>

export type WinnerEvidenceClientInput = Omit<
  WinnerEvidenceInput,
  "marketplaceAccountKey"
>

export type SanitizedWinnerEvidenceDecisionPackage = Omit<
  WinnerEvidenceDecisionPackage,
  "marketplaceAccountKey"
> & {
  accountScopeBound: true
  secretsExposed: false
  piiExposed: false
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function aspectValue(value: unknown, names: string[]) {
  const aliases = new Set(names.map((name) => name.toLowerCase()))
  const aspects = Array.isArray(value) ? value : []
  for (const entry of aspects) {
    const aspect = record(entry)
    if (aliases.has(String(aspect.name ?? "").trim().toLowerCase())) {
      return text(aspect.value)
    }
  }
  return null
}

function variantFromComparable(comparable: JsonRecord): ProductIdentityInput {
  const aspects = comparable.localizedAspects
  const offerCounts = normalizeWinnerComparableOfferCounts({
    title: text(comparable.title),
    packCount: numberOrNull(aspectValue(aspects, ["pack quantity", "number in pack"])),
    unitCount: numberOrNull(aspectValue(aspects, ["unit count", "count per pack"])),
  })
  return {
    manufacturerBrand: text(comparable.brand) ?? aspectValue(aspects, ["brand"]),
    gtin: text(comparable.gtin) ?? aspectValue(aspects, ["upc", "ean", "gtin"]),
    mpn: text(comparable.mpn) ?? aspectValue(aspects, ["mpn", "manufacturer part number"]),
    model: aspectValue(aspects, ["model"]),
    productName: text(comparable.title),
    // Count/ct describes contents and must never become the offer pack.
    packCount: offerCounts.packCount,
    unitCount: offerCounts.unitCount,
    size: text(comparable.size) ?? aspectValue(aspects, ["size", "capacity", "volume"]),
    color: text(comparable.color) ?? aspectValue(aspects, ["color", "colour"]),
    scent: aspectValue(aspects, ["scent", "fragrance"]),
    variant: aspectValue(aspects, ["variant", "type", "formulation"]),
    condition: text(comparable.condition) ?? "new",
  }
}

export function winnerComparablesFromKeywordReport(report: unknown): WinnerComparableInput[] {
  const root = record(report)
  const rows = Array.isArray(root.comparableEvidence) ? root.comparableEvidence : []
  return rows.map((value): WinnerComparableInput | null => {
    const comparable = record(value)
    const source = text(comparable.evidenceSource)
    if (!source || ![
      "EBAY_BROWSE_ACTIVE_LISTING",
      "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
    ].includes(source)) return null
    return {
      source: source as WinnerComparableInput["source"],
      sourceListingId: text(comparable.comparableId),
      observedAt: text(root.evidenceAsOf) ?? text(root.asOf),
      identity: variantFromComparable(comparable),
      itemPrice: numberOrNull(comparable.price),
      shippingCost: numberOrNull(comparable.shippingCost),
      currency: text(comparable.currency) ?? "USD",
      confirmedSoldQuantity: numberOrNull(comparable.verifiedSoldQuantity),
      estimatedSoldQuantity: numberOrNull(comparable.estimatedSoldQuantity),
      keywords: Array.isArray(comparable.matchedKeywords)
        ? comparable.matchedKeywords.filter((entry): entry is string => typeof entry === "string")
        : [],
      shippingPattern: null,
      returnsPattern: comparable.returnsAccepted === true ? "RETURNS_ACCEPTED" : null,
      imageCount: null,
      visualEvidence: record(comparable.visualEvidence) as WinnerComparableInput["visualEvidence"],
      evidenceReviewed: true,
    }
  }).filter((value): value is WinnerComparableInput => value !== null)
}

export function winnerEvidencePreviewConfiguration(environment = process.env) {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  let detectedRef: string | null = null
  try {
    detectedRef = new URL(supabaseUrl).hostname.split(".")[0] || null
  } catch {
    detectedRef = null
  }
  const preview = environment.VERCEL_ENV === "preview"
  const staging = detectedRef === STAGING_REF
  return {
    configured: preview && staging,
    preview,
    staging,
    detectedRef,
    expectedRef: STAGING_REF,
    productionBlocked: true,
    ebayWriteAllowed: false,
  }
}

function uuidOrNull(value: unknown) {
  const candidate = text(value)
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null
}

export function sanitizeWinnerEvidencePackage(
  value: WinnerEvidenceDecisionPackage,
): SanitizedWinnerEvidenceDecisionPackage {
  const { marketplaceAccountKey: _marketplaceAccountKey, ...safe } = value
  return {
    ...safe,
    accountScopeBound: true,
    secretsExposed: false,
    piiExposed: false,
  }
}

export async function readWinnerEvidenceDecisionPackage(
  supabase: SupabaseClient,
  packageId: string,
  marketplaceAccountKey: string,
) {
  if (!winnerEvidencePreviewConfiguration().configured) {
    throw new Error("WINNER_EVIDENCE_PREVIEW_STAGING_REQUIRED")
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(packageId)) {
    throw new Error("WINNER_EVIDENCE_PACKAGE_ID_INVALID")
  }
  const { data, error } = await supabase
    .from("marketplace_listing_decision_packages")
    .select("id,status,package_version,package_hash,verdict,generated_at,package_payload,smart_stocking_learning_profile,smart_stocking_learning_profile_updated_at")
    .eq("id", packageId)
    .eq("marketplace_account_key", marketplaceAccountKey)
    .eq("marketplace", "EBAY_US")
    .maybeSingle()
  if (error) throw new Error("WINNER_EVIDENCE_PACKAGE_READ_FAILED")
  if (!data) throw new Error("WINNER_EVIDENCE_PACKAGE_NOT_FOUND")
  const payload = data.package_payload as WinnerEvidenceDecisionPackage
  if (
    payload.marketplaceAccountKey !== marketplaceAccountKey ||
    payload.marketplace !== "EBAY_US" ||
    payload.packageHash !== data.package_hash ||
    payload.packageVersion !== data.package_version ||
    payload.decision.verdict !== data.verdict ||
    !verifyWinnerEvidenceDecisionPackageIntegrity(payload)
  ) {
    throw new Error("WINNER_EVIDENCE_PACKAGE_INTEGRITY_MISMATCH")
  }
  const learningProfile = data.smart_stocking_learning_profile
  if (learningProfile !== null) validateSmartStockingLearningProfileV1(learningProfile)
  return {
    packageId: data.id as string,
    status: data.status as string,
    generatedAt: data.generated_at as string,
    package: sanitizeWinnerEvidencePackage(payload),
    smartStockingLearningProfile: learningProfile as SmartStockingLearningProfile | null,
    smartStockingLearningProfileUpdatedAt:
      data.smart_stocking_learning_profile_updated_at as string | null,
    safety: {
      previewOnly: true,
      stagingOnly: true,
      canPublish: false,
      ebayWrites: 0,
      openAiCalls: 0,
      imagesGenerated: 0,
      draftsCreated: 0,
      publicationsCreated: 0,
    },
  }
}

export async function persistSmartStockingLearningProfileV1(
  supabase: SupabaseClient,
  input: {
    packageId: string
    marketplaceAccountKey: string
    profile: SmartStockingLearningProfile
  },
) {
  if (!winnerEvidencePreviewConfiguration().configured) {
    throw new Error("SMART_STOCKING_PROFILE_PREVIEW_STAGING_REQUIRED")
  }
  const packageId = uuidOrNull(input.packageId)
  if (!packageId) throw new Error("SMART_STOCKING_PROFILE_PACKAGE_ID_INVALID")
  validateSmartStockingLearningProfileV1(input.profile)

  const { data: existing, error: readError } = await supabase
    .from("marketplace_listing_decision_packages")
    .select("id,supplier_sku,supplier_variant_id,smart_stocking_learning_profile")
    .eq("id", packageId)
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", "EBAY_US")
    .maybeSingle()
  if (readError) throw new Error("SMART_STOCKING_PROFILE_PACKAGE_READ_FAILED")
  if (!existing) throw new Error("SMART_STOCKING_PROFILE_PACKAGE_NOT_FOUND")

  const durableProfile = existing.smart_stocking_learning_profile
  if (durableProfile !== null) {
    validateSmartStockingLearningProfileV1(durableProfile)
    if (durableProfile.entrySnapshotHash !== input.profile.entrySnapshotHash) {
      throw new Error("SMART_STOCKING_ENTRY_SNAPSHOT_IMMUTABLE")
    }
  }

  const { data: written, error: writeError } = await supabase
    .from("marketplace_listing_decision_packages")
    .update({ smart_stocking_learning_profile: input.profile })
    .eq("id", packageId)
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", "EBAY_US")
    .select("id,supplier_sku,supplier_variant_id,smart_stocking_learning_profile,smart_stocking_learning_profile_updated_at")
    .single()
  if (writeError) throw new Error("SMART_STOCKING_PROFILE_DURABLE_WRITE_FAILED")
  validateSmartStockingLearningProfileV1(written.smart_stocking_learning_profile)
  if (written.smart_stocking_learning_profile.entrySnapshotHash !==
        input.profile.entrySnapshotHash ||
      written.smart_stocking_learning_profile.decisionSnapshotHash !==
        input.profile.decisionSnapshotHash) {
    throw new Error("SMART_STOCKING_PROFILE_DURABLE_READBACK_MISMATCH")
  }
  return {
    packageId: written.id as string,
    supplierSku: written.supplier_sku as string,
    supplierVariantId: written.supplier_variant_id as string | null,
    profile: written.smart_stocking_learning_profile as SmartStockingLearningProfile,
    updatedAt: written.smart_stocking_learning_profile_updated_at as string,
    entrySnapshotImmutable: true as const,
    durableReadback: "PASS" as const,
    safety: {
      ebayWrites: 0,
      productionAllowed: false,
      publishingAllowed: false,
    },
  }
}

export async function readSmartStockingLearningProfileV1(
  supabase: SupabaseClient,
  input: {
    marketplaceAccountKey: string
    supplierSku: string
    supplierVariantId?: string | null
  },
) {
  if (!winnerEvidencePreviewConfiguration().configured) {
    throw new Error("SMART_STOCKING_PROFILE_PREVIEW_STAGING_REQUIRED")
  }
  let query = supabase
    .from("marketplace_listing_decision_packages")
    .select("id,supplier_sku,supplier_variant_id,smart_stocking_learning_profile,smart_stocking_learning_profile_updated_at")
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", "EBAY_US")
    .eq("supplier_sku", input.supplierSku)
    .not("smart_stocking_learning_profile", "is", null)
  if (input.supplierVariantId) {
    query = query.eq("supplier_variant_id", input.supplierVariantId)
  }
  const { data, error } = await query
    .order("smart_stocking_learning_profile_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("SMART_STOCKING_PROFILE_READ_FAILED")
  if (!data) throw new Error("SMART_STOCKING_PROFILE_NOT_FOUND")
  validateSmartStockingLearningProfileV1(data.smart_stocking_learning_profile)
  return {
    packageId: data.id as string,
    supplierSku: data.supplier_sku as string,
    supplierVariantId: data.supplier_variant_id as string | null,
    profile: data.smart_stocking_learning_profile as SmartStockingLearningProfile,
    updatedAt: data.smart_stocking_learning_profile_updated_at as string,
    durableReadback: "PASS" as const,
  }
}

export async function createWinnerEvidenceDecisionPackage(
  supabase: SupabaseClient,
  input: WinnerEvidenceInput,
  options: {
    useOfficialRead?: boolean
    persist?: boolean
    candidateRecordId?: string | null
  } = {},
) {
  const configuration = winnerEvidencePreviewConfiguration()
  if (!configuration.configured) throw new Error("WINNER_EVIDENCE_PREVIEW_STAGING_REQUIRED")
  let comparables = input.comparables ?? []
  let officialRead = {
    requested: options.useOfficialRead === true,
    executed: false,
    source: null as string | null,
    marketplaceInsights: "NOT_REQUESTED" as string,
    errors: [] as string[],
  }
  if (options.useOfficialRead === true) {
    const report = await runEbaySellerKeywordDemandValidation({
      productName: input.identity.productName,
      variantTitle: input.identity.variant,
      supplierSku: input.supplierSku,
      gtin: input.identity.gtin,
      brand: input.identity.manufacturerBrand,
      mpn: input.identity.mpn ?? input.identity.model,
      color: input.identity.color,
      size: input.identity.size,
      packQuantity: input.identity.packCount,
    })
    comparables = winnerComparablesFromKeywordReport(report)
    officialRead = {
      requested: true,
      executed: true,
      source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY",
      marketplaceInsights: String(record(report).marketplaceInsightsAvailability ?? "UNKNOWN"),
      errors: [],
    }
  }
  const decisionPackage = buildWinnerEvidenceDecisionPackage({
    ...input,
    comparables,
  })
  let packageId: string | null = null
  if (options.persist !== false) {
    const payload = {
      marketplace_account_key: decisionPackage.marketplaceAccountKey,
      marketplace: "EBAY_US",
      // `candidate_id` belongs exclusively to ebay_product_candidates. Other
      // source identities remain versioned in package_payload and their own
      // marketplace-neutral mapping tables.
      candidate_id: options.candidateRecordId === undefined
        ? uuidOrNull(decisionPackage.candidateId)
        : uuidOrNull(options.candidateRecordId),
      supplier_sku: decisionPackage.supplierSku,
      supplier_variant_id: decisionPackage.supplierVariantId,
      product_identity_fingerprint: decisionPackage.productIdentity.fingerprint,
      identity_version: decisionPackage.productIdentity.version,
      package_version: decisionPackage.packageVersion,
      input_hash: decisionPackage.inputHash,
      package_hash: decisionPackage.packageHash,
      verdict: decisionPackage.decision.verdict,
      status: "GENERATED",
      package_payload: decisionPackage,
      generated_at: decisionPackage.generatedAt,
      updated_at: decisionPackage.generatedAt,
    }
    const { data, error } = await supabase
      .from("marketplace_listing_decision_packages")
      .upsert(payload, {
        onConflict: "marketplace_account_key,marketplace,package_hash",
        ignoreDuplicates: false,
      })
      .select("id")
      .single()
    if (error) throw new Error("WINNER_EVIDENCE_PACKAGE_PERSIST_FAILED")
    packageId = data.id
  }
  return {
    packageId,
    package: sanitizeWinnerEvidencePackage(decisionPackage),
    officialRead,
    persistence: options.persist === false ? "NO" as const : "YES" as const,
    safety: {
      previewOnly: true,
      stagingOnly: true,
      ebayMethods: officialRead.executed ? ["GET"] : [],
      ebayWrites: 0,
      openAiCalls: 0,
      imagesGenerated: 0,
      draftsCreated: 0,
      publicationsCreated: 0,
      canPublish: false,
      browserAutomationUsed: false,
      scrapingUsed: false,
      competitorContentCopied: false,
    },
  }
}
