import type { SupabaseClient } from "@supabase/supabase-js"

import {
  evaluateManualListingProductSkuIdentity,
  hasReusableListingDefaults,
  parseSafeListingDefaults,
  safeDefaultsTemplateKey,
  safeDefaultsTemplatePriorityKeys,
  type ManualListingRegistrationInput,
  type ManualListingVerification,
  type SafeListingDefaults,
} from "@/lib/ebay/ebay-manual-listing-domain"
import {
  EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
  getTradingManualListingReadonlyConfiguration,
  readManualListingFromTradingApi,
  type TradingManualListingResult,
} from "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { expectedEbayDraftOnlySku } from "@/lib/ebay/ebay-draft-only-readiness"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"

type JsonRecord = Record<string, unknown>

export const EBAY_MANUAL_LISTING_REVERIFICATION_MAX_AGE_HOURS = 36

type OpportunityIdentity = {
  id: string
  candidate_key: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  listing_package_id: string | null
  expected_ebay_sku: string | null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null
}

function safeDatabaseErrorCode(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback
  const values = [
    "message" in error ? error.message : null,
    "details" in error ? error.details : null,
    "hint" in error ? error.hint : null,
  ]
  for (const value of values) {
    if (typeof value !== "string") continue
    const match = value.match(/MANUAL_LISTING_[A-Z0-9_]+/)
    if (match) return match[0]
  }
  return fallback
}

export function getManualListingAccountKey() {
  const scope = getEbaySellerAccountScopeConfiguration()
  if (scope.accountKey) return scope.accountKey
  const reasons: Record<string, string> = {
    ACCOUNT_KEY_REQUIRED: "MANUAL_LISTING_ACCOUNT_KEY_REQUIRED",
    ACCOUNT_KEY_INVALID: "MANUAL_LISTING_ACCOUNT_KEY_INVALID",
    OFFICIAL_ACCOUNT_IDENTITY_REQUIRED:
      "MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_REQUIRED",
    OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT:
      "MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT",
  }
  throw new Error(
    reasons[scope.reason ?? ""] ?? "MANUAL_LISTING_ACCOUNT_SCOPE_INVALID",
  )
}

export function getManualListingRegistrationConfiguration() {
  const trading = getTradingManualListingReadonlyConfiguration()
  const scope = getEbaySellerAccountScopeConfiguration()
  return {
    accountKey: scope.accountKey,
    accountAlias: scope.accountAlias,
    accountScopeConfigured: scope.configured,
    accountScopeReason: scope.reason,
    marketplaceId: "EBAY_US" as const,
    readonlyConnectorConfigured:
      scope.configured && trading.configured && trading.identityBound,
    verificationConnector: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
    expectedIdentityConfigured: trading.identityBound,
    verifiedRequiresOfficialAccountEvidence: true as const,
    pendingRegistrationAllowed: true as const,
    templatesRequireVerifiedOwnership: true as const,
    ebayWriteUsed: false as const,
    canPublish: false as const,
  }
}

async function loadOpportunityIdentity(
  supabase: SupabaseClient,
  input: ManualListingRegistrationInput,
) {
  let query = supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,market_radar_product_id,supplier_variant_id,supplier_sku")

  query = input.opportunityId
    ? query.eq("id", input.opportunityId)
    : query.eq("candidate_key", input.candidateKey as string)

  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error("MANUAL_LISTING_OPPORTUNITY_READ_FAILED")
  if (!data) throw new Error("MANUAL_LISTING_OPPORTUNITY_NOT_FOUND")

  const opportunity = data as Omit<
    OpportunityIdentity,
    "listing_package_id" | "expected_ebay_sku"
  >
  if (
    input.candidateKey &&
    opportunity.candidate_key !== input.candidateKey
  ) {
    throw new Error("MANUAL_LISTING_CANDIDATE_MISMATCH")
  }
  if (
    input.supplierSku &&
    opportunity.supplier_sku &&
    opportunity.supplier_sku !== input.supplierSku
  ) {
    throw new Error("MANUAL_LISTING_SUPPLIER_SKU_MISMATCH")
  }
  if (
    input.supplierVariantId &&
    opportunity.supplier_variant_id &&
    opportunity.supplier_variant_id !== input.supplierVariantId
  ) {
    throw new Error("MANUAL_LISTING_SUPPLIER_VARIANT_MISMATCH")
  }
  const { data: listingPackage, error: listingPackageError } = await supabase
    .from("ebay_listing_packages")
    .select("id,candidate_key")
    .eq("opportunity_id", opportunity.id)
    .maybeSingle()
  if (listingPackageError) {
    throw new Error("MANUAL_LISTING_PACKAGE_READ_FAILED")
  }
  if (
    listingPackage &&
    text(listingPackage.candidate_key) !== opportunity.candidate_key
  ) {
    throw new Error("MANUAL_LISTING_PACKAGE_CANDIDATE_MISMATCH")
  }
  const listingPackageId = text(listingPackage?.id)
  const expectedEbaySku = listingPackageId
    ? expectedEbayDraftOnlySku({ id: listingPackageId })
    : ""
  return {
    ...opportunity,
    listing_package_id: listingPackageId,
    expected_ebay_sku: expectedEbaySku || null,
  }
}

type VerificationWithDefaults = ManualListingVerification & {
  learnedSafeDefaults: SafeListingDefaults
  connectorObservedAt: string | null
}

export async function verifyManualListingOwnershipReadonly(
  ebayItemId: string,
  opportunity?: OpportunityIdentity,
): Promise<VerificationWithDefaults> {
  const tradingConfiguration =
    getTradingManualListingReadonlyConfiguration()
  if (!tradingConfiguration.configured) {
    return {
      status: "pending_manual_verification",
      method: "NOT_EXECUTED",
      reason: "EBAY_READONLY_CONNECTOR_NOT_CONFIGURED",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  if (!tradingConfiguration.identityBound) {
    return {
      status: "pending_manual_verification",
      method: "NOT_EXECUTED",
      reason: "EBAY_OFFICIAL_ACCOUNT_IDENTITY_NOT_BOUND",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }

  let trading: TradingManualListingResult
  try {
    trading = await readManualListingFromTradingApi(ebayItemId)
  } catch {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      reason: "EBAY_READONLY_VERIFICATION_UNAVAILABLE",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  if (trading.ownership === "identity_mismatch") {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      reason: "EBAY_AUTHENTICATED_ACCOUNT_IDENTITY_MISMATCH",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  if (trading.ownership === "not_owned") {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      reason: "EBAY_ITEM_SELLER_DOES_NOT_MATCH_OFFICIAL_ACCOUNT",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  if (trading.ownership === "inactive") {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      reason: "EBAY_ITEM_NOT_ACTIVE_IN_OFFICIAL_ACCOUNT",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  const productIdentity = evaluateManualListingProductSkuIdentity(
    opportunity?.expected_ebay_sku,
    trading.ebaySku,
  )
  if (!productIdentity.verified) {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      reason: productIdentity.reason,
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
      learnedSafeDefaults: {},
      connectorObservedAt: null,
    }
  }
  return {
    status: "verified",
    method: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
    reason: "OWNERSHIP_AND_PRODUCT_IDENTITY_CONFIRMED_TRADING_READONLY",
    connectorListingId: null,
    connectorListingStatus: "active",
    connectorEbaySku: trading.ebaySku,
    learnedSafeDefaults: trading.safeDefaults,
    connectorObservedAt: trading.observedAt,
  }
}

export async function registerManualEbayListing(
  supabase: SupabaseClient,
  input: ManualListingRegistrationInput,
  actorUserId: string | null,
) {
  const accountKey = getManualListingAccountKey()
  const opportunity = await loadOpportunityIdentity(supabase, input)
  const verification = await verifyManualListingOwnershipReadonly(
    input.ebayItemId,
    opportunity,
  )
  // Browser-declared defaults are never promoted to a verified template. Only
  // fields returned by the authenticated eBay listing read are reusable.
  const declaredSafeDefaults = input.safeDefaults
  const effectiveSafeDefaults: SafeListingDefaults =
    verification.status === "verified"
      ? verification.learnedSafeDefaults
      : {}

  const { data, error } = await supabase.rpc(
    "register_ebay_manual_listing_link",
    {
      p_account_key: accountKey,
      p_ebay_item_id: input.ebayItemId,
      p_ebay_url: input.ebayUrl,
      p_opportunity_id: opportunity.id,
      p_candidate_key: opportunity.candidate_key,
      p_supplier_variant_id:
        opportunity.supplier_variant_id ?? input.supplierVariantId,
      p_supplier_sku:
        opportunity.supplier_sku ?? input.supplierSku,
      p_verification_status: verification.status,
      p_verification_method: verification.method,
      p_verification_reason: verification.reason,
      p_connector_ebay_sku: verification.status === "verified"
        ? verification.connectorEbaySku
        : null,
      p_connector_observed_at: verification.status === "verified"
        ? verification.connectorObservedAt
        : null,
      p_safe_defaults: effectiveSafeDefaults,
      p_actor_user_id: actorUserId,
    },
  )
  if (error) {
    throw new Error(
      safeDatabaseErrorCode(
        error,
        "MANUAL_LISTING_REGISTRATION_WRITE_FAILED",
      ),
    )
  }

  const registration = Array.isArray(data)
    ? data[0] as JsonRecord | undefined
    : data as JsonRecord | null
  if (!registration) {
    throw new Error("MANUAL_LISTING_REGISTRATION_WRITE_FAILED")
  }
  const persistedVerification: VerificationWithDefaults = {
    ...verification,
    connectorListingId:
      verification.status === "verified"
        ? text(registration.connector_listing_id)
        : null,
    connectorListingStatus:
      verification.status === "verified"
        ? text(registration.connector_listing_status)
        : null,
    connectorEbaySku:
      verification.status === "verified"
        ? text(registration.connector_ebay_sku)
        : null,
  }
  if (
    persistedVerification.status === "verified" &&
    (!persistedVerification.connectorListingId ||
      persistedVerification.connectorEbaySku !==
        opportunity.expected_ebay_sku)
  ) {
    throw new Error("MANUAL_LISTING_VERIFICATION_EVIDENCE_NOT_PERSISTED")
  }

  let template: JsonRecord | null = null
  if (
    verification.status === "verified" &&
    hasReusableListingDefaults(effectiveSafeDefaults)
  ) {
    const { data: templateData, error: templateError } = await supabase
      .from("ebay_seller_listing_templates")
      .select("*")
      .eq("account_key", accountKey)
      .eq("template_key", safeDefaultsTemplateKey(effectiveSafeDefaults))
      .maybeSingle()
    if (templateError) {
      throw new Error("MANUAL_LISTING_TEMPLATE_READ_FAILED")
    }
    template = templateData as JsonRecord | null
  }

  return {
    registration,
    verification: persistedVerification,
    learnedSafeDefaults: persistedVerification.learnedSafeDefaults,
    declaredSafeDefaults,
    declaredDefaultsActivated: false,
    effectiveSafeDefaults,
    template,
    templateActivated: Boolean(template),
  }
}

export async function listManualEbayListingRegistrations(
  supabase: SupabaseClient,
  limit: number,
) {
  const accountKey = getManualListingAccountKey()
  const [registrationsResult, templatesResult] = await Promise.all([
    supabase
      .from("ebay_manual_listing_links")
      .select("id,account_key,marketplace_id,ebay_item_id,ebay_url,opportunity_id,candidate_key,market_radar_product_id,supplier_variant_id,supplier_sku,verification_status,verification_method,verification_reason,connector_listing_id,connector_listing_status,connector_ebay_sku,safe_defaults,verified_at,last_verification_at,created_at,updated_at")
      .eq("account_key", accountKey)
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabase
      .from("ebay_seller_listing_templates")
      .select("id,account_key,marketplace_id,template_key,source_link_id,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,condition_code,condition_id,category_id,category_schema_version,dimension_unit,weight_unit,status,verified_source_at,created_at,updated_at")
      .eq("account_key", accountKey)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(limit),
  ])
  if (registrationsResult.error) {
    throw new Error("MANUAL_LISTING_LINKS_READ_FAILED")
  }
  if (templatesResult.error) {
    throw new Error("MANUAL_LISTING_TEMPLATES_READ_FAILED")
  }
  return {
    accountKey,
    registrations: registrationsResult.data ?? [],
    templates: templatesResult.data ?? [],
  }
}

/**
 * Rechecks the oldest Seller Hub links through Trading GetUser + GetItem.
 * The same transactional registration RPC promotes or downgrades ownership,
 * product identity and reusable defaults; no eBay write method is called.
 */
export async function reverifyManualEbayListingsReadonly(
  supabase: SupabaseClient,
  options: { limit?: number; timeBudgetMs?: number } = {},
) {
  const startedAt = Date.now()
  const configuration = getManualListingRegistrationConfiguration()
  if (!configuration.readonlyConnectorConfigured) {
    return {
      status: "CONNECTOR_NOT_READY" as const,
      accountScopeReason: configuration.accountScopeReason,
      selected: 0,
      verified: 0,
      downgraded: 0,
      failed: 0,
      deferred: 0,
      elapsedMs: Date.now() - startedAt,
    }
  }
  const accountKey = getManualListingAccountKey()
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 2), 10))
  const timeBudgetMs = Math.max(
    5_000,
    Math.min(Math.trunc(options.timeBudgetMs ?? 15_000), 30_000),
  )
  const { data, error } = await supabase
    .from("ebay_manual_listing_links")
    .select("id,ebay_item_id,ebay_url,opportunity_id,candidate_key,supplier_sku,supplier_variant_id,verification_method,last_verification_at")
    .eq("account_key", accountKey)
    .in("verification_method", [
      EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
      "NOT_EXECUTED",
    ])
    .order("last_verification_at", { ascending: true })
    .limit(limit)
  if (error) throw new Error("MANUAL_LISTING_REVERIFICATION_READ_FAILED")

  const links = (data ?? []) as Array<Record<string, unknown>>
  let verified = 0
  let downgraded = 0
  let failed = 0
  let processed = 0
  for (const link of links) {
    if (processed > 0 && Date.now() - startedAt >= timeBudgetMs) break
    processed += 1
    try {
      const result = await registerManualEbayListing(supabase, {
        ebayItemId: String(link.ebay_item_id ?? ""),
        ebayUrl: String(link.ebay_url ?? ""),
        opportunityId: text(link.opportunity_id),
        candidateKey: text(link.candidate_key),
        supplierSku: text(link.supplier_sku),
        supplierVariantId: text(link.supplier_variant_id),
        safeDefaults: {},
      }, null)
      if (result.verification.status === "verified") verified += 1
      else downgraded += 1
    } catch {
      failed += 1
    }
  }
  return {
    status: failed > 0 || processed < links.length
      ? "PARTIAL" as const
      : "COMPLETE" as const,
    selected: links.length,
    verified,
    downgraded,
    failed,
    deferred: Math.max(0, links.length - processed),
    elapsedMs: Date.now() - startedAt,
  }
}

export async function selectApplicableSafeListingDefaults(
  supabase: SupabaseClient,
  input: {
    categoryId: string
    condition?: string
  },
) {
  const accountKey = getManualListingAccountKey()
  const priorityKeys = safeDefaultsTemplatePriorityKeys(
    input.categoryId,
    input.condition ?? "NEW",
  )
  const freshnessCutoff = new Date(
    Date.now() -
      EBAY_MANUAL_LISTING_REVERIFICATION_MAX_AGE_HOURS * 60 * 60 * 1_000,
  ).toISOString()
  const { data, error } = await supabase
    .from("ebay_seller_listing_templates")
    .select("id,template_key,fulfillment_policy_id,payment_policy_id,return_policy_id,merchant_location_key,condition_code,condition_id,category_id,category_schema_version,dimension_unit,weight_unit,verified_source_at,source_link:ebay_manual_listing_links!inner(verification_status,account_key,marketplace_id,last_verification_at)")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("status", "active")
    .eq("source_link.verification_status", "verified")
    .eq("source_link.account_key", accountKey)
    .eq("source_link.marketplace_id", "EBAY_US")
    .gte("source_link.last_verification_at", freshnessCutoff)
    .in("template_key", priorityKeys)
  if (error) throw new Error("MANUAL_LISTING_DEFAULT_SELECTION_FAILED")

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const byKey = new Map(
    rows.map((row) => [text(row.template_key), row]),
  )
  const selected = priorityKeys
    .map((key) => byKey.get(key))
    .find((row): row is Record<string, unknown> => Boolean(row))
  if (!selected) return null

  const sourceTemplateId = text(selected.id)
  const verifiedSourceAt = text(selected.verified_source_at)
  if (!sourceTemplateId || !verifiedSourceAt) {
    throw new Error("MANUAL_LISTING_DEFAULT_SOURCE_INVALID")
  }

  const defaults = parseSafeListingDefaults({
    fulfillmentPolicyId: selected.fulfillment_policy_id,
    paymentPolicyId: selected.payment_policy_id,
    returnPolicyId: selected.return_policy_id,
    merchantLocationKey: selected.merchant_location_key,
    condition: selected.condition_code,
    conditionId: selected.condition_id,
    categoryId: selected.category_id,
    categorySchemaVersion: selected.category_schema_version,
    dimensionUnit: selected.dimension_unit,
    weightUnit: selected.weight_unit,
  })

  return {
    defaults,
    sourceTemplateId,
    verifiedSourceAt,
  }
}
