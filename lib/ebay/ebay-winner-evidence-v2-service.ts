import type { SupabaseClient } from "@supabase/supabase-js"

import {
  runEbaySellerKeywordDemandValidation,
} from "./ebay-seller-keyword-demand-gateway"
import {
  buildWinnerEvidenceDecisionPackage,
  type ProductIdentityInput,
  type WinnerComparableInput,
  type WinnerEvidenceDecisionPackage,
  type WinnerEvidenceInput,
} from "./ebay-winner-evidence-v2"

const STAGING_REF = "vsfthqydfrdzulldbfbe"

type JsonRecord = Record<string, unknown>

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

function packFromTitle(value: unknown) {
  const title = text(value)?.toLowerCase() ?? ""
  const match = title.match(/\b(\d{1,4})\s*(?:pack|pk|count|ct|piece|pc|set)\b/)
  return match ? Number(match[1]) : null
}

function variantFromComparable(comparable: JsonRecord): ProductIdentityInput {
  const aspects = comparable.localizedAspects
  return {
    manufacturerBrand: text(comparable.brand) ?? aspectValue(aspects, ["brand"]),
    gtin: text(comparable.gtin) ?? aspectValue(aspects, ["upc", "ean", "gtin"]),
    mpn: text(comparable.mpn) ?? aspectValue(aspects, ["mpn", "manufacturer part number"]),
    model: aspectValue(aspects, ["model"]),
    productName: text(comparable.title),
    packCount: packFromTitle(comparable.title) ?? numberOrNull(aspectValue(aspects, ["pack quantity", "number in pack"])),
    unitCount: numberOrNull(aspectValue(aspects, ["unit count", "count per pack"])),
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
      "EBAY_BROWSE_ESTIMATED_SALES",
    ].includes(source)) return null
    return {
      source: source as WinnerComparableInput["source"],
      sourceListingId: text(comparable.comparableId),
      observedAt: text(root.asOf),
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

export function sanitizeWinnerEvidencePackage(value: WinnerEvidenceDecisionPackage) {
  const { marketplaceAccountKey: _marketplaceAccountKey, ...safe } = value
  return {
    ...safe,
    accountScopeBound: true,
    secretsExposed: false,
    piiExposed: false,
  }
}

export async function createWinnerEvidenceDecisionPackage(
  supabase: SupabaseClient,
  input: WinnerEvidenceInput,
  options: { useOfficialRead?: boolean; persist?: boolean } = {},
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
      candidate_id: uuidOrNull(decisionPackage.candidateId),
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
      browserAutomationUsed: false,
      scrapingUsed: false,
      competitorContentCopied: false,
    },
  }
}
