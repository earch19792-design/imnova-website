import type { SupabaseClient } from "@supabase/supabase-js"

import {
  evaluateManualListingProductSkuIdentity,
  hasReusableListingDefaults,
  normalizeAuthoritativeEbayCustomLabel,
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
import { reconcileSellerOsStockIdentityV1 } from
  "@/lib/ebay/ebay-stock-identity-auto-reconciliation-v1"
import { ensureStockguardAuthorityFromDecisionP0,
  readStockguardListingLinkAuthorityP0 } from
  "@/lib/ebay/stockguard-listing-link-authority-p0"

type JsonRecord = Record<string, unknown>

export const EBAY_MANUAL_LISTING_REVERIFICATION_MAX_AGE_HOURS = 36

type OpportunityIdentity = {
  id: string
  candidate_key: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_price: number | string | null
  listing_package_id: string | null
  expected_ebay_sku: string | null
  authoritative_handoff_custom_label: string | null
  authoritative_ebay_skus: string[]
}

function text(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

const exposedManualSuccessorDatabaseErrors = new Set([
  "POST_PUBLISH_LUNA_LINEAGE_HANDOFF_INPUT_INVALID",
  "POST_PUBLISH_LUNA_LINEAGE_PUBLICATION_NOT_EXACT",
  "POST_PUBLISH_LUNA_LINEAGE_IDENTITY_MISMATCH",
  "POST_PUBLISH_LUNA_LINEAGE_COMPONENT_INVALID",
  "POST_PUBLISH_LUNA_LINEAGE_EXISTING_DECISION_CONFLICT",
  "MANUAL_LIVE_LINKAGE_INPUT_INVALID",
  "MANUAL_LIVE_LINKAGE_IDENTITY_MISMATCH",
  "MANUAL_LIVE_LINKAGE_COMPONENT_INVALID",
  "MANUAL_LIVE_LINKAGE_EXISTING_DECISION_CONFLICT",
  "MANUAL_LIVE_SUCCESSOR_DUPLICATE_OR_HISTORY_MISMATCH",
  "MANUAL_LIVE_SUCCESSOR_PREDECESSOR_NOT_EXACT",
  "MANUAL_LIVE_SUCCESSOR_LINEAGE_RETIREMENT_FAILED",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_INVALID",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_NOT_FOUND",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_CONFLICT",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_NOT_FOUND",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_NOT_CURRENT",
  "MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_SKU_MISMATCH",
  "MANUAL_LISTING_CURRENT_LUNA_IDENTITY_NOT_UNIQUE",
])

export function isSafeManualListingErrorCode(value: unknown): value is string {
  return typeof value === "string" && (
    /^MANUAL_LISTING_[A-Z0-9_]+$/.test(value) ||
    exposedManualSuccessorDatabaseErrors.has(value)
  )
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
    const matches = value.match(/[A-Z][A-Z0-9_]{2,}/g) ?? []
    const safeCode = matches.find(isSafeManualListingErrorCode)
    if (safeCode) return safeCode
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
  accountKey: string,
  options: { automatedDeterministic?: boolean } = {},
) {
  let query = supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_price")

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
    .eq("account_key", accountKey)
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
  let authoritativeHandoffCustomLabel: string | null = null
  const { data: pilotCandidate, error: pilotCandidateError } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .select("id,run_id,state,machine_state,manual_handoff_package,updated_at,run:ebay_same_day_pilot_runs!inner(marketplace_account_key)")
    .eq("opportunity_id", opportunity.id)
    .eq("candidate_key", opportunity.candidate_key)
    .eq("run.marketplace_account_key", accountKey)
    .in("state", [
      "READY_FOR_MANUAL_PUBLICATION",
      "PUBLISHED_PENDING_VERIFICATION",
      "VERIFIED_ACTIVE",
    ])
    .in("machine_state", [
      "READY_FOR_MANUAL_PUBLICATION",
      "WAITING_ITEM_ID",
      "VERIFYING_PUBLISHED_LISTING",
      "REGISTERING_COMMERCIAL_MONITOR",
      "VERIFIED_ACTIVE",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (pilotCandidateError) {
    throw new Error("MANUAL_LISTING_HANDOFF_READ_FAILED")
  }
  if (pilotCandidate) {
    const { data: handoff, error: handoffError } = await supabase
      .from("ebay_same_day_pilot_handoffs")
      .select("run_id,candidate_id,status,package_data,package_hash,created_at")
      .eq("run_id", pilotCandidate.run_id)
      .eq("candidate_id", pilotCandidate.id)
      .eq("status", "READY_FOR_MANUAL_PUBLICATION")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (handoffError) {
      throw new Error("MANUAL_LISTING_HANDOFF_READ_FAILED")
    }
    const candidateHandoff = record(pilotCandidate.manual_handoff_package)
    const candidatePackage = record(candidateHandoff.package)
    const handoffPackage = record(handoff?.package_data)
    const candidateLabel = normalizeAuthoritativeEbayCustomLabel(
      candidatePackage.customLabel,
    )
    const handoffLabel = normalizeAuthoritativeEbayCustomLabel(
      handoffPackage.customLabel,
    )
    const packageHash = text(candidateHandoff.packageHash)
    if (
      handoff &&
      candidateLabel &&
      candidateLabel === handoffLabel &&
      text(candidatePackage.candidateId) === text(pilotCandidate.id) &&
      text(handoffPackage.candidateId) === text(pilotCandidate.id) &&
      packageHash &&
      /^[0-9a-f]{64}$/.test(packageHash) &&
      packageHash === text(handoff.package_hash)
    ) {
      authoritativeHandoffCustomLabel = candidateLabel
    }
  }
  const authoritativeEbaySkus = [...new Set([
    expectedEbaySku,
    authoritativeHandoffCustomLabel,
    ...(options.automatedDeterministic && input.supplierSku &&
      input.supplierSku === opportunity.supplier_sku
      ? [opportunity.supplier_sku]
      : []),
  ].filter((value): value is string => Boolean(value)))]
  return {
    ...opportunity,
    listing_package_id: listingPackageId,
    expected_ebay_sku: expectedEbaySku || null,
    authoritative_handoff_custom_label: authoritativeHandoffCustomLabel,
    authoritative_ebay_skus: authoritativeEbaySkus,
  }
}

type VerificationWithDefaults = ManualListingVerification & {
  learnedSafeDefaults: SafeListingDefaults
  connectorObservedAt: string | null
  connectorListingSnapshot?: {
    title: string | null
    availableQuantity: number | null
    price: number | null
    currency: string | null
  } | null
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
    opportunity?.authoritative_handoff_custom_label
      ? [opportunity.authoritative_handoff_custom_label]
      : [],
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
    reason: productIdentity.reason ===
      "PRODUCT_AUTHORITATIVE_HANDOFF_CUSTOM_LABEL_CONFIRMED"
      ? "OWNERSHIP_AND_AUTHORITATIVE_HANDOFF_CUSTOM_LABEL_CONFIRMED_TRADING_READONLY"
      : "OWNERSHIP_AND_PRODUCT_IDENTITY_CONFIRMED_TRADING_READONLY",
    connectorListingId: null,
    connectorListingStatus: "active",
    connectorEbaySku: trading.ebaySku,
    learnedSafeDefaults: trading.safeDefaults,
    connectorObservedAt: trading.observedAt,
    connectorListingSnapshot: {
      title: trading.title,
      availableQuantity: trading.availableQuantity,
      price: trading.price,
      currency: trading.currency,
    },
  }
}

function positiveNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function hydrateVerifiedManualActiveListing(
  supabase: SupabaseClient,
  input: {
    accountKey: string
    ebayItemId: string
    opportunity: OpportunityIdentity
    verification: VerificationWithDefaults
  },
) {
  const snapshot = input.verification.connectorListingSnapshot
  const observedAt = input.verification.connectorObservedAt
  if (
    input.verification.status !== "verified" ||
    !snapshot?.title ||
    snapshot.availableQuantity === null ||
    snapshot.price === null ||
    !snapshot.currency ||
    !input.verification.connectorEbaySku ||
    !observedAt
  ) {
    throw new Error("MANUAL_LISTING_GET_ITEM_SNAPSHOT_INCOMPLETE")
  }

  const { data: current, error: currentError } = await supabase
    .from("ebay_active_listings")
    .select("id,supplier_cost_at_linking,raw_payload")
    .eq("account_key", input.accountKey)
    .eq("source", input.verification.method)
    .eq("ebay_item_id", input.ebayItemId)
    .limit(1)
    .maybeSingle()
  if (currentError || !current?.id) {
    throw new Error("MANUAL_LISTING_ACTIVE_SNAPSHOT_TARGET_MISSING")
  }

  const supplierCostAtLinking =
    positiveNumberOrNull(current.supplier_cost_at_linking) ??
    positiveNumberOrNull(input.opportunity.supplier_price)
  if (supplierCostAtLinking === null) {
    throw new Error("MANUAL_LISTING_SUPPLIER_COST_REQUIRED")
  }

  const { data: hydrated, error: hydrateError } = await supabase
    .from("ebay_active_listings")
    .update({
      title: snapshot.title,
      ebay_sku: input.verification.connectorEbaySku,
      ebay_quantity: snapshot.availableQuantity,
      ebay_price: snapshot.price,
      currency: snapshot.currency,
      supplier_cost_at_linking: supplierCostAtLinking,
      last_ebay_sync_at: observedAt,
      raw_payload: {
        ...record(current.raw_payload),
        getItemSnapshot: {
          title: snapshot.title,
          ebaySku: input.verification.connectorEbaySku,
          availableQuantity: snapshot.availableQuantity,
          price: snapshot.price,
          currency: snapshot.currency,
          observedAt,
        },
      },
      updated_at: observedAt,
    })
    .eq("id", current.id)
    .eq("account_key", input.accountKey)
    .eq("ebay_item_id", input.ebayItemId)
    .select("id,title,ebay_sku,ebay_quantity,ebay_price,currency,supplier_cost_at_linking,last_ebay_sync_at")
    .maybeSingle()
  if (hydrateError || !hydrated?.id) {
    throw new Error("MANUAL_LISTING_GET_ITEM_SNAPSHOT_WRITE_FAILED")
  }
  return {
    status: "HYDRATED_OFFICIAL_GET_ITEM" as const,
    ...hydrated,
  }
}

async function refreshCertifiedManualListingStockGuard(
  supabase: SupabaseClient,
  input: { accountKey: string; ebayItemId: string },
) {
  const { data: decisions, error } = await supabase
    .from("seller_os_luna_linkage_decisions")
    .select("decision,decision_version")
    .eq("account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", input.ebayItemId)
    .order("decision_version", { ascending: false })
    .limit(1)
  if (error) {
    return {
      status: "REFRESH_FAILED" as const,
      reasonCode: "MANUAL_LISTING_STOCKGUARD_DECISION_READ_FAILED",
      marketplaceWrites: 0 as const,
    }
  }
  if (decisions?.[0]?.decision !== "APPROVE_EXACT_LINKAGE") {
    return {
      status: "NOT_CERTIFIED" as const,
      reasonCode: "MANUAL_LISTING_STOCKGUARD_CERTIFIED_LINKAGE_REQUIRED",
      marketplaceWrites: 0 as const,
    }
  }
  try {
    const refreshed = await reconcileSellerOsStockIdentityV1(supabase, {
      accountKey: input.accountKey,
      targetItemIds: [input.ebayItemId],
    })
    return {
      status: refreshed.inStockCount === 1
        ? "IN_STOCK_SIGNAL" as const
        : refreshed.certifiedOosCount === 1
          ? "CERTIFIED_OOS" as const
          : "REFRESHED_WITHOUT_IN_STOCK_SIGNAL" as const,
      reasonCode: text(record(refreshed.outcomes[0]).status),
      refresh: refreshed,
      marketplaceWrites: 0 as const,
    }
  } catch (error) {
    const reasonCode = error instanceof Error &&
      /^[A-Z0-9_]{3,160}$/.test(error.message)
      ? error.message
      : "MANUAL_LISTING_STOCKGUARD_REFRESH_FAILED"
    return {
      status: "REFRESH_FAILED" as const,
      reasonCode,
      marketplaceWrites: 0 as const,
    }
  }
}

async function readCertifiedManualLiveLinkage(
  supabase: SupabaseClient,
  input: { connectorListingId: string | null },
) {
  if (!input.connectorListingId) return null
  const { data, error } = await supabase
    .from("ebay_active_listings")
    .select("raw_payload")
    .eq("id", input.connectorListingId)
    .maybeSingle()
  if (error || !data) return null
  const lineage = record(record(data.raw_payload).canonicalSupplierLineage)
  const mode = text(lineage.mode)
  return lineage.status === "CERTIFIED" && (
    mode === "AUTO_LINEAGE_SUCCESSOR" ||
    mode === "NET_NEW_MANUAL_LIVE"
  )
    ? {
        status: "CERTIFIED" as const,
        mode,
        itemId: text(lineage.itemId),
        productId: text(lineage.productId),
        variantId: text(lineage.variantId),
        sourceSku: text(lineage.sourceSku),
        decisionReference: text(lineage.decisionReference),
        legacyLineageSuperseded: mode === "AUTO_LINEAGE_SUCCESSOR",
        marketplaceWrites: 0 as const,
      }
    : null
}

export async function registerManualEbayListing(
  supabase: SupabaseClient,
  input: ManualListingRegistrationInput,
  actorUserId: string | null,
  options: { automatedDeterministic?: boolean } = {},
) {
  const accountKey = getManualListingAccountKey()
  const opportunity = await loadOpportunityIdentity(
    supabase, input, accountKey, options,
  )
  const observedVerification = await verifyManualListingOwnershipReadonly(
    input.ebayItemId,
    opportunity,
  )
  const verification = options.automatedDeterministic &&
      observedVerification.status === "verified"
    ? { ...observedVerification,
        reason: "OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY" }
    : observedVerification
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
        opportunity.supplier_variant_id,
      p_supplier_sku:
        opportunity.supplier_sku,
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
      !opportunity.authoritative_ebay_skus.includes(
        persistedVerification.connectorEbaySku ?? "",
      ))
  ) {
    throw new Error("MANUAL_LISTING_VERIFICATION_EVIDENCE_NOT_PERSISTED")
  }

  const activeListingHydration = persistedVerification.status === "verified"
    ? await hydrateVerifiedManualActiveListing(supabase, {
        accountKey,
        ebayItemId: input.ebayItemId,
        opportunity,
        verification: persistedVerification,
      })
    : null
  const manualLiveLinkage = persistedVerification.status === "verified"
    ? await readCertifiedManualLiveLinkage(supabase, {
        connectorListingId: persistedVerification.connectorListingId,
      })
    : null
  const linkAuthority = manualLiveLinkage?.decisionReference
    ? await ensureStockguardAuthorityFromDecisionP0({ supabase, accountKey,
        ebayItemId: input.ebayItemId,
        sourceDecisionId: manualLiveLinkage.decisionReference,
        actorUserId, automatedDeterministic: Boolean(options.automatedDeterministic) })
    : null
  const stockGuardRefresh = linkAuthority?.stockguardEligible
    ? await refreshCertifiedManualListingStockGuard(supabase, {
        accountKey, ebayItemId: input.ebayItemId,
      }) : null

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
    activeListingHydration,
    manualLiveLinkage,
    linkAuthority,
    stockGuardRefresh,
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
      .select("id,account_key,marketplace_id,template_key,source_link_id,fulfillment_policy_id,payment_policy_id,return_policy_id,condition_id,category_id,status,verified_source_at,created_at,updated_at")
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

export async function getManualEbayListingResolutionContext(
  supabase: SupabaseClient,
  ebayItemId: string | null,
) {
  const accountKey = getManualListingAccountKey()
  const itemId = text(ebayItemId)
  if (itemId && !/^\d{9,20}$/.test(itemId)) {
    throw new Error("MANUAL_LISTING_ITEM_ID_INVALID")
  }
  const targetRead = itemId
    ? supabase.from("ebay_active_listings")
      .select("id,ebay_item_id,title,ebay_sku,listing_status,last_ebay_sync_at,raw_payload")
      .eq("account_key", accountKey)
      .eq("ebay_item_id", itemId)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null })
  const [targetResult, decisionsResult] = await Promise.all([
    targetRead,
    supabase.from("seller_os_luna_linkage_decisions")
      .select("decision_id,decision,decision_version,decision_at,ebay_item_id,ebay_sku,listing_title,luna_product_id,luna_variant_id,luna_sku,components")
      .eq("account_key", accountKey)
      .eq("marketplace_id", "EBAY_US")
      .order("decision_version", { ascending: false })
      .limit(250),
  ])
  if (targetResult.error) {
    throw new Error("MANUAL_LISTING_ACTIVE_TARGET_READ_FAILED")
  }
  if (decisionsResult.error) {
    throw new Error("MANUAL_LISTING_CERTIFIED_IDENTITIES_READ_FAILED")
  }
  const latestByItem = new Map<string, JsonRecord>()
  for (const value of decisionsResult.data ?? []) {
    const row = value as JsonRecord
    const sourceItemId = text(row.ebay_item_id)
    if (sourceItemId && !latestByItem.has(sourceItemId)) {
      latestByItem.set(sourceItemId, row)
    }
  }
  const sourceItemIds = [...latestByItem.keys()].filter((value) =>
    value !== itemId)
  const sourceListingsResult = sourceItemIds.length
    ? await supabase.from("ebay_active_listings")
      .select("ebay_item_id,raw_payload")
      .eq("account_key", accountKey)
      .in("ebay_item_id", sourceItemIds)
      .limit(250)
    : { data: [], error: null }
  const sourcePrimaryImages = new Map((sourceListingsResult.data ?? [])
    .flatMap((listing) => {
      const sourceItemId = text(listing.ebay_item_id)
      const primaryImageUrl = text(record(listing.raw_payload).primaryImageUrl)
      return sourceItemId && primaryImageUrl
        ? [[sourceItemId, primaryImageUrl] as const] : []
    }))
  const targetPrimaryImageUrl = text(record(targetResult.data?.raw_payload)
    .primaryImageUrl)
  const identities = new Map<string, JsonRecord>()
  for (const row of latestByItem.values()) {
    const productId = text(row.luna_product_id)
    const variantId = text(row.luna_variant_id)
    const supplierSku = text(row.luna_sku)
    const sourceItemId = text(row.ebay_item_id)
    if (row.decision !== "APPROVE_EXACT_LINKAGE" || !productId ||
        !variantId || !supplierSku || !sourceItemId || sourceItemId === itemId) {
      continue
    }
    const components = Array.isArray(row.components) ? row.components : []
    const component = components.length === 1 ? record(components[0]) : {}
    const supplierQuantityRequired =
      Number(component.supplierQuantityRequired)
    if (components.length !== 1 || supplierQuantityRequired !== 1) continue
    const identityKey = `${productId}:${variantId}:${supplierSku}`
    if (!identities.has(identityKey)) {
      identities.set(identityKey, {
        sourceDecisionId: row.decision_id,
        sourceItemId,
        sourceListingTitle: row.listing_title,
        sourceEbaySku: row.ebay_sku,
        lunaProductId: productId,
        lunaVariantId: variantId,
        lunaSku: supplierSku,
        productTitle: text(component.productTitle),
        variantTitle: text(component.variantTitle),
        supplierQuantityRequired,
        decisionAt: row.decision_at,
        exactPrimaryImageMatch: Boolean(
          targetPrimaryImageUrl &&
          sourcePrimaryImages.get(sourceItemId) === targetPrimaryImageUrl,
        ),
      })
    }
  }
  const target = targetResult.data
  const linkAuthority = target
    ? await readStockguardListingLinkAuthorityP0({ supabase, accountKey,
        ebayItemId: String(target.ebay_item_id) }) : null
  return {
    targetListing: target ? {
      itemId: target.ebay_item_id,
      title: target.title,
      ebaySku: target.ebay_sku,
      listingStatus: target.listing_status,
      lastObservedAt: target.last_ebay_sync_at,
      primaryImageUrl: targetPrimaryImageUrl,
      ebayUrl: `https://www.ebay.com/itm/${target.ebay_item_id}`,
      linked: linkAuthority?.stockguardEligible === true,
    } : null,
    linkAuthority,
    certifiedIdentities: [...identities.values()].sort((left, right) =>
      Number(Boolean(right.exactPrimaryImageMatch)) -
        Number(Boolean(left.exactPrimaryImageMatch))),
  }
}

export async function resolveManualEbayListingWithCertifiedIdentity(
  supabase: SupabaseClient,
  input: Readonly<{
    ebayItemId: string
    sourceDecisionId: string
    actorUserId: string
  }>,
) {
  const accountKey = getManualListingAccountKey()
  if (!/^\d{9,20}$/.test(input.ebayItemId) ||
      !/^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$/.test(
        input.sourceDecisionId,
      ) || !/^[0-9a-f-]{36}$/.test(input.actorUserId)) {
    throw new Error("MANUAL_LISTING_CERTIFIED_IDENTITY_SOURCE_INVALID")
  }
  const trading = getTradingManualListingReadonlyConfiguration()
  if (!trading.configured || !trading.identityBound) {
    throw new Error("MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_REQUIRED")
  }
  let observed: TradingManualListingResult
  try {
    observed = await readManualListingFromTradingApi(input.ebayItemId)
  } catch {
    throw new Error("MANUAL_LISTING_EBAY_READONLY_VERIFICATION_UNAVAILABLE")
  }
  if (observed.ownership === "identity_mismatch") {
    throw new Error("MANUAL_LISTING_OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT")
  }
  if (observed.ownership === "not_owned") {
    throw new Error("MANUAL_LISTING_EBAY_ITEM_NOT_OWNED")
  }
  if (observed.ownership !== "verified" || !observed.ebaySku) {
    throw new Error("MANUAL_LISTING_EBAY_ITEM_NOT_ACTIVE")
  }
  const authorityBefore = await readStockguardListingLinkAuthorityP0({
    supabase, accountKey, ebayItemId: input.ebayItemId,
  })
  if (!authorityBefore.authority && (authorityBefore.quarantine ||
      authorityBefore.activeSkuAuthorityCardinality > 0)) {
    throw new Error("LISTING_LINK_AUTHORITY_ACTIVE_SKU_COLLISION")
  }
  const { data, error } = await supabase.rpc(
    "resolve_manual_existing_certified_identity_v1",
    {
      p_account_key: accountKey,
      p_item_id: input.ebayItemId,
      p_source_decision_id: input.sourceDecisionId,
      p_actor_user_id: input.actorUserId,
      p_observed_ebay_sku: observed.ebaySku,
      p_observed_at: observed.observedAt,
    },
  )
  if (error) {
    throw new Error(safeDatabaseErrorCode(
      error,
      "MANUAL_LISTING_CERTIFIED_IDENTITY_WRITE_FAILED",
    ))
  }
  const resolution = record(data)
  if (resolution.status !== "CERTIFIED") {
    const reason = text(resolution.reason)
    throw new Error(reason && /^MANUAL_LISTING_[A-Z0-9_]+$/.test(reason)
      ? reason : "MANUAL_LISTING_CERTIFIED_IDENTITY_WRITE_FAILED")
  }
  const decisionReference = text(resolution.decisionReference) ??
    text(resolution.decisionId)
  if (!decisionReference) {
    throw new Error("MANUAL_LISTING_CERTIFIED_IDENTITY_WRITE_FAILED")
  }
  const linkAuthority = await ensureStockguardAuthorityFromDecisionP0({
    supabase, accountKey, ebayItemId: input.ebayItemId,
    sourceDecisionId: decisionReference, actorUserId: input.actorUserId,
    automatedDeterministic: false,
  })
  const stockGuardRefresh = await refreshCertifiedManualListingStockGuard(
    supabase,
    { accountKey, ebayItemId: input.ebayItemId },
  )
  return {
    resolution,
    officialListing: {
      itemId: observed.itemId,
      title: observed.title,
      ebaySku: observed.ebaySku,
      listingStatus: observed.listingStatus,
      observedAt: observed.observedAt,
    },
    linkAuthority,
    stockGuardRefresh,
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
    .select("id,ebay_item_id,ebay_url,opportunity_id,candidate_key,supplier_sku,supplier_variant_id,verification_method,verification_reason,created_by,last_verification_at")
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
      }, null, {
        automatedDeterministic:
          link.created_by === null &&
          text(link.verification_reason) ===
            "OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY",
      })
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
    conditionId?: string
  },
) {
  const accountKey = getManualListingAccountKey()
  const priorityKeys = safeDefaultsTemplatePriorityKeys(
    input.categoryId,
    input.conditionId,
  )
  const freshnessCutoff = new Date(
    Date.now() -
      EBAY_MANUAL_LISTING_REVERIFICATION_MAX_AGE_HOURS * 60 * 60 * 1_000,
  ).toISOString()
  const { data, error } = await supabase
    .from("ebay_seller_listing_templates")
    .select("id,template_key,fulfillment_policy_id,payment_policy_id,return_policy_id,condition_id,category_id,verified_source_at,source_link:ebay_manual_listing_links!inner(verification_status,account_key,marketplace_id,last_verification_at)")
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
    conditionId: selected.condition_id,
    categoryId: selected.category_id,
  })

  return {
    defaults,
    sourceTemplateId,
    verifiedSourceAt,
  }
}
