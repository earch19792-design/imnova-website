export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { evaluateEbayListingWorkspaceEligibility } from "@/lib/ebay/ebay-first-luna-opportunity-queue"
import { getEbayFirstLunaQueueDashboard } from "@/lib/ebay/ebay-first-luna-scan-service"
import { selectApplicableSafeListingDefaults } from "@/lib/ebay/ebay-manual-listing-service"
import { ebayDraftOnlyEconomicsConfig } from "@/lib/ebay/ebay-draft-only-readiness"
import { calculateEbayUnitEconomics } from "@/lib/ebay/ebay-unit-economics"
import {
  buildSameDayAuthorizedWorkspacePackage,
  loadSameDayAuthorizedPublicationContext,
} from "@/lib/ebay/ebay-same-day-authorized-publication"
import {
  ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
  applyVerifiedTitleToActiveListing,
  prepareVerifiedActiveListingTitle,
} from "@/lib/ebay/ebay-active-listing-title-revision-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

const OPEN_REVIEW_STATUSES = ["in_progress", "blocked", "ready_for_package"]
const REVIEW_STEPS = ["luna", "ebay", "economics", "listing", "review"]

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strings(value: unknown, limit = 40) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : []
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "COMMAND_CENTER_REQUEST_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback
  const candidates = [
    "message" in error ? error.message : null,
    "details" in error ? error.details : null,
    "hint" in error ? error.hint : null,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const match = candidate.match(/EBAY_LISTING_PACKAGE_[A-Z0-9_]+/)
    if (match) return match[0]
  }
  return fallback
}

function guardedPackageRow(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null
}

function latestEvidenceTimestamp(row: Record<string, unknown>) {
  const candidates = [row.last_scanned_at, row.supplier_snapshot_at]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))
  return candidates[0] ?? null
}

function positive(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function canonicalPackagePricing(
  supplierCost: unknown,
  targetPrice: unknown,
  economicsOverrides: Parameters<typeof ebayDraftOnlyEconomicsConfig>[0] = {},
) {
  const economics = calculateEbayUnitEconomics(
    { salePrice: targetPrice, supplierCost },
    ebayDraftOnlyEconomicsConfig(economicsOverrides),
  )
  return {
    currency: "USD",
    supplierCost: economics.supplierCost,
    targetPrice: economics.salePrice,
    estimatedEbayFees: economics.estimatedEbayFees,
    estimatedOutboundShipping: economics.estimatedOutboundShipping,
    returnsReserve: economics.returnsReserve,
    promotedListingsReserve: economics.promotedListingsReserve,
    estimatedNetProfit: economics.estimatedNetProfit,
    estimatedNetMarginPercent: economics.estimatedNetMarginPercent,
    estimatedRoiPercent: economics.estimatedRoiPercent,
    minimumProfitablePrice: economics.minimumProfitablePrice,
    passesProfitGate: economics.passesProfitGate,
    costAssumptions: economics.config,
    calculationSource: economics.calculationSource,
  }
}

function resolvedPackageHardGates(packageData: Record<string, unknown>) {
  const draft = object(packageData.draftConfiguration)
  const packageWeightAndSize = object(draft.packageWeightAndSize)
  const dimensions = object(packageWeightAndSize.dimensions)
  const weight = object(packageWeightAndSize.weight)
  const imageUrls = strings(packageData.imageUrls, 24)
  const imageManifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(object)
    : []
  const approvedImageUrls = new Set(imageManifest
    .filter((asset) =>
      typeof asset.humanApprovedAt === "string" && asset.humanApprovedAt &&
      typeof asset.sha256 === "string" && /^[0-9a-f]{64}$/.test(asset.sha256)
    )
    .map((asset) => typeof asset.url === "string" ? asset.url : "")
    .filter(Boolean))
  const imagesReady = imageUrls.length > 0
    && imageManifest.length > 0
    && imageUrls.every((url) => approvedImageUrls.has(url))
  const weightReady = positive(weight.value)
    && ["POUND", "OUNCE", "KILOGRAM", "GRAM"].includes(String(weight.unit ?? "").toUpperCase())
  const dimensionsReady = positive(dimensions.length)
    && positive(dimensions.width)
    && positive(dimensions.height)
    && ["INCH", "CENTIMETER"].includes(String(dimensions.unit ?? "").toUpperCase())
  const aspectEntries = Object.entries(object(packageData.aspects))
  const taxonomyReady = /^\d{1,12}$/.test(String(packageData.categoryId ?? ""))
    && aspectEntries.length > 0
    && aspectEntries.every(([, value]) => String(value ?? "").trim().length > 0)
  return new Set([
    ...(imagesReady ? ["NEED_AUTHORIZED_PRODUCT_IMAGES"] : []),
    ...(weightReady ? ["NEED_PACKAGE_WEIGHT"] : []),
    ...(dimensionsReady ? ["NEED_PACKAGE_DIMENSIONS"] : []),
    ...(weightReady && dimensionsReady ? ["NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"] : []),
    ...(taxonomyReady ? ["NEED_EBAY_TAXONOMY_CATEGORY", "NEED_REQUIRED_EBAY_ITEM_ASPECTS"] : []),
  ])
}

async function opportunity(supabase: ReturnType<typeof getSupabaseAdminClient>, opportunityId: string) {
  const { data, error } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", opportunityId)
    .maybeSingle()
  if (error || !data) throw new Error("COMMAND_CENTER_OPPORTUNITY_NOT_FOUND")
  return data as Record<string, unknown>
}

function buildInitialPackage(row: Record<string, unknown>) {
  const assessment = object(row.assessment)
  const intelligence = object(assessment.listingIntelligencePackage)
  const candidate = object(assessment.candidate)
  const category = object(intelligence.categoryRecommendation)
  const keywordStructure = object(row.keyword_structure)
  const recommended = object(intelligence.titleStrategy)
  const economics = object(assessment.economics)
  const itemSpecifics = object(intelligence.itemSpecifics)
  const imageUrls = strings(candidate.imageUrls, 24)
  const targetPrice = row.median_total_buyer_price
    ?? economics.conservativeTotalBuyerPrice
    ?? null
  return {
    title: String(
      intelligence.recommendedTitle
      ?? recommended.titleFormula
      ?? keywordStructure.titleFormula
      ?? row.product_title
      ?? "",
    ).slice(0, 80),
    categoryId: category.categoryId ?? null,
    categoryName: category.categoryName ?? null,
    aspects: object(itemSpecifics.supplierConfirmed),
    description: String(candidate.description ?? ""),
    imageUrls,
    pricing: canonicalPackagePricing(row.supplier_price, targetPrice),
    shipping: object(intelligence.shippingRecommendation),
    evidenceSnapshot: {
      opportunityScore: row.opportunity_score ?? 0,
      demandScore: row.demand_score ?? 0,
      economicsScore: row.economics_score ?? 0,
      identityScore: row.identity_score ?? 0,
      hardGates: strings(row.hard_gates),
      evidenceGuards: strings(row.evidence_guards),
      assessment,
    },
  }
}

type ApplicableSafeDefaults = NonNullable<Awaited<ReturnType<
  typeof selectApplicableSafeListingDefaults
>>>

function applySafeSellerDefaults(
  packageData: Record<string, unknown>,
  selected: ApplicableSafeDefaults | null,
) {
  if (!selected) return packageData
  const defaults = selected.defaults
  const currentDraft = object(packageData.draftConfiguration)
  const currentPolicies = object(currentDraft.businessPolicies)
  const withDefault = (current: unknown, fallback: unknown) => current || fallback || ""
  const canApply = (current: unknown, fallback: unknown) =>
    (current === null || current === undefined || String(current).trim() === "") &&
    Boolean(fallback)
  const appliedFields = [
    ...(canApply(packageData.categoryId, defaults.categoryId) ? ["categoryId"] : []),
    ...(canApply(packageData.conditionId, defaults.conditionId) ? ["conditionId"] : []),
    ...(canApply(currentPolicies.fulfillmentPolicyId, defaults.fulfillmentPolicyId)
      ? ["fulfillmentPolicyId"] : []),
    ...(canApply(currentPolicies.paymentPolicyId, defaults.paymentPolicyId)
      ? ["paymentPolicyId"] : []),
    ...(canApply(currentPolicies.returnPolicyId, defaults.returnPolicyId)
      ? ["returnPolicyId"] : []),
  ]
  return {
    ...packageData,
    categoryId: withDefault(packageData.categoryId, defaults.categoryId),
    conditionId: withDefault(packageData.conditionId, defaults.conditionId),
    draftConfiguration: {
      ...currentDraft,
      businessPolicies: {
        ...currentPolicies,
        fulfillmentPolicyId: withDefault(
          currentPolicies.fulfillmentPolicyId,
          defaults.fulfillmentPolicyId,
        ),
        paymentPolicyId: withDefault(
          currentPolicies.paymentPolicyId,
          defaults.paymentPolicyId,
        ),
        returnPolicyId: withDefault(
          currentPolicies.returnPolicyId,
          defaults.returnPolicyId,
        ),
      },
    },
    safeDefaults: {
      source: "EBAY_OBSERVED_OWN_LISTING_TEMPLATE",
      sourceTemplateId: selected.sourceTemplateId,
      verifiedSourceAt: selected.verifiedSourceAt,
      appliedFields,
      requiresLiveEbayPreflight: true,
      excludesCommercialContent: true,
    },
  }
}

async function applicableSafeDefaults(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  seed: Record<string, unknown>,
) {
  const categoryId = String(seed.categoryId ?? "")
  if (!/^\d{1,20}$/.test(categoryId)) return null
  // Defaults are an accelerator, never a prerequisite for preparing a listing.
  // The eBay preflight will revalidate every policy/location before approval.
  return selectApplicableSafeListingDefaults(supabase, {
    categoryId,
    conditionId: typeof seed.conditionId === "string" ? seed.conditionId : undefined,
  }).catch(() => null)
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (!validation.userId) return NextResponse.json(
    { success: false, error: "COMMAND_CENTER_REVIEWER_REQUIRED" },
    { status: 403 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    const reviewer = validation.userId
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    const url = new URL(req.url)
    const opportunityId = url.searchParams.get("opportunity") ?? ""
    const [dashboard, sessions, packages, alertOutbox] = await Promise.all([
      getEbayFirstLunaQueueDashboard(supabase),
      supabase
        .from("ebay_command_center_reviews")
        .select("*")
        .eq("user_id", reviewer)
        .in("status", OPEN_REVIEW_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("ebay_listing_packages")
        .select("*")
        .eq("created_by", reviewer)
        .eq("account_key", accountKey ?? "__unconfigured__")
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id,alert_type,priority,entity_type,entity_id,candidate_key,status,payload,due_at,created_at,delivered_at")
        .eq("payload->>accountKey", accountKey ?? "__unconfigured__")
        .in("status", ["pending", "leased", "failed", "dead_letter"])
        .order("created_at", { ascending: false })
        .limit(50),
    ])
    const firstError = sessions.error ?? packages.error ?? alertOutbox.error
    if (firstError) throw new Error("COMMAND_CENTER_STATE_READ_FAILED")
    const selectedOpportunity = opportunityId ? await opportunity(supabase, opportunityId) : null
    return NextResponse.json({
      success: true,
      dashboard,
      reviews: sessions.data ?? [],
      listingPackages: packages.data ?? [],
      alerts: {
        activeListingRisks: dashboard.activeListingRisks,
        outbox: alertOutbox.data ?? [],
      },
      selectedOpportunity,
      refreshedAt: new Date().toISOString(),
      safety: { ebayReadOnly: true, ebayWriteUsed: false, canPublish: false },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: errorCode(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (!validation.userId) return NextResponse.json(
    { success: false, error: "COMMAND_CENTER_REVIEWER_REQUIRED" },
    { status: 403 },
  )
  try {
    const body = object(await req.json())
    const action = typeof body.action === "string" ? body.action : ""
    const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : ""
    const candidateKey = typeof body.candidateKey === "string" ? body.candidateKey.slice(0, 300) : ""
    if (!/^[0-9a-f-]{36}$/i.test(opportunityId) || !candidateKey) {
      return NextResponse.json({ success: false, error: "COMMAND_CENTER_CANDIDATE_REQUIRED" }, { status: 400 })
    }
    const supabase = getSupabaseAdminClient()
    const reviewer = validation.userId
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) {
      return NextResponse.json({
        success: false,
        error: "COMMAND_CENTER_ACCOUNT_SCOPE_REQUIRED",
      }, { status: 503 })
    }
    const sourceOpportunity = await opportunity(supabase, opportunityId)
    if (sourceOpportunity.candidate_key !== candidateKey) {
      return NextResponse.json(
        { success: false, error: "COMMAND_CENTER_CANDIDATE_MISMATCH" },
        { status: 409 },
      )
    }

    if (action === "active_title_preview" || action === "active_title_apply") {
      const listingPackageId = typeof body.listingPackageId === "string"
        && /^[0-9a-f-]{36}$/i.test(body.listingPackageId)
        ? body.listingPackageId : ""
      const ebayItemId = typeof body.ebayItemId === "string"
        && /^\d{9,20}$/.test(body.ebayItemId) ? body.ebayItemId : ""
      const idempotencyKey = typeof body.idempotencyKey === "string"
        && /^[A-Za-z0-9._:-]{8,120}$/.test(body.idempotencyKey)
        ? body.idempotencyKey : ""
      if (!listingPackageId || !ebayItemId || !idempotencyKey) {
        return NextResponse.json({ success: false,
          error: "EBAY_ACTIVE_TITLE_REVISION_PREPARE_INVALID" }, { status: 400 })
      }
      const common = { supabase, accountKey, actorId: reviewer,
        listingPackageId, ebayItemId, idempotencyKey }
      try {
        if (action === "active_title_preview") {
          const revision = await prepareVerifiedActiveListingTitle(common)
          return NextResponse.json({ success: true, revision,
            confirmationPhrase: ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
            safety: { ebayWrites: 0, titleDerivedServerSide: true,
              canPublish: false } })
        }
        if (body.confirmation !== ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION) {
          return NextResponse.json({ success: false,
            error: "EBAY_ACTIVE_TITLE_REVISION_CONFIRMATION_INVALID" },
          { status: 400 })
        }
        const revision = await applyVerifiedTitleToActiveListing({ ...common,
          confirmation: ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION })
        const success = revision.phase === "applied_verified"
        return NextResponse.json({ success, revision, safety: {
          permittedMutation: "TITLE_ONLY", maxEbayWrites: 1,
          ebayWriteAttempts: revision.ebayWriteAttemptCount,
          imagesChanged: false, priceChanged: false, quantityChanged: false,
          policiesChanged: false, blindRetryAllowed: false,
        } }, { status: success ? 200 : 409 })
      } catch (titleError) {
        const code = errorCode(titleError)
        const status = /INVALID|REQUIRED|CONFIRMATION/.test(code) ? 400
          : /MISMATCH|CONFLICT|UNKNOWN|IN_PROGRESS|TERMINAL|WRITE_LIMIT/.test(code)
            ? 409 : 502
        return NextResponse.json({ success: false, error: code }, { status })
      }
    }

    if (action === "save_review") {
      const currentStep = REVIEW_STEPS.includes(String(body.currentStep)) ? String(body.currentStep) : "luna"
      const status = OPEN_REVIEW_STATUSES.includes(String(body.status)) ? String(body.status) : "in_progress"
      const { data: existing, error: readError } = await supabase
        .from("ebay_command_center_reviews")
        .select("*")
        .eq("user_id", reviewer)
        .eq("candidate_key", candidateKey)
        .maybeSingle()
      if (readError) throw new Error("COMMAND_CENTER_REVIEW_READ_FAILED")
      const nextState = { ...object(existing?.form_data), ...object(body.formData) }
      const values = {
        opportunity_id: opportunityId,
        candidate_key: candidateKey,
        status,
        current_step: currentStep,
        form_data: {
          ...nextState,
          confirmedFields: strings(body.confirmedFields),
          blockers: strings(body.blockers),
        },
        updated_at: new Date().toISOString(),
      }
      const result = existing?.id
        ? await supabase.from("ebay_command_center_reviews").update(values).eq("id", existing.id).select("*").single()
        : await supabase.from("ebay_command_center_reviews").insert({ ...values, user_id: reviewer }).select("*").single()
      if (result.error) throw new Error("COMMAND_CENTER_REVIEW_SAVE_FAILED")
      return NextResponse.json({ success: true, review: result.data, savedAt: new Date().toISOString(), safety: { ebayWriteUsed: false, canPublish: false } })
    }

    if (action === "open_active_maintenance") {
      const [packageResult, linkResult] = await Promise.all([
        supabase
          .from("ebay_listing_packages")
          .select("*")
          .eq("account_key", accountKey)
          .eq("opportunity_id", opportunityId)
          .eq("candidate_key", candidateKey)
          .maybeSingle(),
        supabase
          .from("ebay_manual_listing_links")
          .select("id,ebay_item_id,ebay_url,connector_listing_id,verified_at")
          .eq("account_key", accountKey)
          .eq("opportunity_id", opportunityId)
          .eq("candidate_key", candidateKey)
          .eq("verification_status", "verified")
          .eq("connector_listing_status", "active")
          .maybeSingle(),
      ])
      if (packageResult.error || linkResult.error) {
        throw new Error("COMMAND_CENTER_ACTIVE_MAINTENANCE_READ_FAILED")
      }
      const existing = packageResult.data
      const link = linkResult.data
      if (!existing || !link?.connector_listing_id || !link.verified_at) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_ACTIVE_MAINTENANCE_EVIDENCE_REQUIRED",
        }, { status: 409 })
      }
      if (existing.created_by !== reviewer) {
        throw new Error("COMMAND_CENTER_PACKAGE_OWNERSHIP_REQUIRED")
      }
      const { data: activeListing, error: activeListingError } = await supabase
        .from("ebay_active_listings")
        .select("id,ebay_item_id,listing_status,title,ebay_sku,last_ebay_sync_at")
        .eq("id", link.connector_listing_id)
        .eq("account_key", accountKey)
        .eq("ebay_item_id", link.ebay_item_id)
        .eq("listing_status", "active")
        .maybeSingle()
      if (activeListingError) {
        throw new Error("COMMAND_CENTER_ACTIVE_MAINTENANCE_READ_FAILED")
      }
      if (!activeListing) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_ACTIVE_MAINTENANCE_EVIDENCE_REQUIRED",
        }, { status: 409 })
      }
      return NextResponse.json({
        success: true,
        workspaceMode: "ACTIVE_MAINTENANCE",
        listingPackage: existing,
        created: false,
        evidenceRefreshed: false,
        maintenance: {
          manualLinkId: link.id,
          connectorListingId: activeListing.id,
          ebayItemId: activeListing.ebay_item_id,
          ebayUrl: link.ebay_url,
          listingStatus: activeListing.listing_status,
          title: activeListing.title,
          sku: activeListing.ebay_sku,
          verifiedAt: link.verified_at,
          lastEbaySyncAt: activeListing.last_ebay_sync_at,
        },
        safety: {
          ebayWriteUsed: false,
          canPublish: false,
          canMaintainVerifiedActiveListing: true,
        },
      })
    }

    if (action === "prepare_package") {
      const { data: existing, error: readError } = await supabase
        .from("ebay_listing_packages")
        .select("*")
        .eq("account_key", accountKey)
        .eq("opportunity_id", opportunityId)
        .eq("candidate_key", candidateKey)
        .maybeSingle()
      if (readError) throw new Error("COMMAND_CENTER_PACKAGE_READ_FAILED")
      if (existing && existing.created_by !== reviewer) {
        throw new Error("COMMAND_CENTER_PACKAGE_OWNERSHIP_REQUIRED")
      }
      const sameDayContext = existing
        ? await loadSameDayAuthorizedPublicationContext({
          supabase,
          accountKey,
          actorUserId: reviewer,
          listingPackage: existing,
          opportunity: sourceOpportunity,
        })
        : null
      const eligibility = evaluateEbayListingWorkspaceEligibility(sourceOpportunity)
      if (!eligibility.allowed && !sameDayContext) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_WORKSPACE_GATES_PENDING",
          blockers: eligibility.blockers,
        }, { status: 409 })
      }
      const effectiveOpportunity = sameDayContext?.opportunity ?? sourceOpportunity
      const initialSeed = buildInitialPackage(effectiveOpportunity)
      const existingPricing = object(object(existing?.package_data).pricing)
      const authorizedTargetPrice = sameDayContext
        ? sameDayContext.authorization.controlledRisk
          ? sameDayContext.handoffPackage.price
          : existingPricing.targetPrice ?? sameDayContext.handoffPackage.price
        : object(initialSeed.pricing).targetPrice
      const sameDayPricing = canonicalPackagePricing(
        effectiveOpportunity.supplier_price,
        authorizedTargetPrice,
        sameDayContext?.economicsConfig,
      )
      const seed = sameDayContext && existing
        ? buildSameDayAuthorizedWorkspacePackage({
          context: sameDayContext,
          currentPackageData: object(existing.package_data),
          pricing: sameDayPricing,
        })
        : initialSeed
      const selectedSafeDefaults = await applicableSafeDefaults(supabase, seed)
      if (existing) {
        if (existing.account_key !== accountKey) {
          throw new Error("COMMAND_CENTER_PACKAGE_ACCOUNT_SCOPE_REQUIRED")
        }
        const currentPackageData = sameDayContext ? object(seed) : object(existing.package_data)
        const currentPricing = object(currentPackageData.pricing)
        const seedPricing = object(seed.pricing)
        const refreshedPricing = canonicalPackagePricing(
          effectiveOpportunity.supplier_price ?? seedPricing.supplierCost,
          currentPricing.targetPrice ?? seedPricing.targetPrice,
          sameDayContext?.economicsConfig,
        )
        const refreshedPackageData = applySafeSellerDefaults({
          ...currentPackageData,
          pricing: refreshedPricing,
          evidenceSnapshot: sameDayContext
            ? currentPackageData.evidenceSnapshot
            : seed.evidenceSnapshot,
          sourceRefresh: {
            refreshedAt: new Date().toISOString(),
            strategy: sameDayContext
              ? "SAME_DAY_APPROVED_PACKAGE_AND_FRESH_LUNA_SOURCE"
              : "SAFE_EVIDENCE_ONLY_USER_FIELDS_PRESERVED",
          },
        }, selectedSafeDefaults)
        const { data: refreshedData, error: refreshError } = await supabase.rpc(
          "ebay_save_listing_package_guarded",
          {
            p_package_id: existing.id,
            p_account_key: accountKey,
            p_actor: reviewer,
            p_opportunity_id: opportunityId,
            p_candidate_key: candidateKey,
            p_operation: "refresh",
            p_package_patch: refreshedPackageData,
            p_status: "draft",
            p_readiness: 0,
            p_source_observed_at: sameDayContext?.sourceObservedAt
              ?? latestEvidenceTimestamp(sourceOpportunity),
            p_expected_updated_at: existing.updated_at,
          },
        )
        const refreshed = guardedPackageRow(refreshedData)
        if (refreshError || !refreshed) {
          const code = databaseErrorCode(
            refreshError,
            "COMMAND_CENTER_PACKAGE_REFRESH_FAILED",
          )
          if (code === "EBAY_LISTING_PACKAGE_STALE_VERSION") {
            return NextResponse.json({
              success: false,
              error: "COMMAND_CENTER_PACKAGE_CHANGED_RETRY",
            }, { status: 409 })
          }
          throw new Error(code)
        }
        const persistedRefreshedPackageData = object(refreshed.package_data)
        return NextResponse.json({
          success: true,
          listingPackage: refreshed,
          created: false,
          evidenceRefreshed: true,
          preservedUserFields: true,
          sameDayAuthorizedPublication: Boolean(sameDayContext),
          safeDefaultsApplied:
            strings(object(persistedRefreshedPackageData.safeDefaults).appliedFields).length > 0,
          safety: { ebayWriteUsed: false, canPublish: false },
        })
      }
      const packageSeed = applySafeSellerDefaults(seed, selectedSafeDefaults)
      const { data, error } = await supabase.from("ebay_listing_packages").insert({
        account_key: accountKey,
        opportunity_id: opportunityId,
        candidate_key: candidateKey,
        status: "draft",
        package_data: packageSeed,
        readiness: 0,
        source_observed_at: latestEvidenceTimestamp(sourceOpportunity),
        created_by: reviewer,
      }).select("*").single()
      if (error) throw new Error("COMMAND_CENTER_PACKAGE_CREATE_FAILED")
      return NextResponse.json({
        success: true,
        listingPackage: data,
        created: true,
        sameDayAuthorizedPublication: false,
        safeDefaultsApplied:
          strings(object(packageSeed.safeDefaults).appliedFields).length > 0,
        safety: { ebayWriteUsed: false, canPublish: false },
      })
    }

    if (action === "save_package") {
      const packageId = typeof body.packageId === "string" ? body.packageId : ""
      if (!/^[0-9a-f-]{36}$/i.test(packageId)) {
        return NextResponse.json({ success: false, error: "COMMAND_CENTER_PACKAGE_REQUIRED" }, { status: 400 })
      }
      const { data: currentPackage, error: currentPackageError } = await supabase
        .from("ebay_listing_packages")
        .select("id,package_data,updated_at")
        .eq("id", packageId)
        .eq("opportunity_id", opportunityId)
        .eq("candidate_key", candidateKey)
        .eq("created_by", reviewer)
        .eq("account_key", accountKey)
        .maybeSingle()
      if (currentPackageError || !currentPackage) throw new Error("COMMAND_CENTER_PACKAGE_OWNERSHIP_REQUIRED")
      const currentPackageData = object(currentPackage.package_data)
      const sameDayContext = await loadSameDayAuthorizedPublicationContext({
        supabase,
        accountKey,
        actorUserId: reviewer,
        listingPackage: {
          ...currentPackage,
          opportunity_id: opportunityId,
          candidate_key: candidateKey,
        },
        opportunity: sourceOpportunity,
      })
      const form = object(body.packageData)
      const effectiveOpportunity = sameDayContext?.opportunity ?? sourceOpportunity
      const sourceSeed = buildInitialPackage(effectiveOpportunity)
      const requestedPricing = object(form.pricing)
      const controlledRiskPrice = sameDayContext?.authorization.controlledRisk === true
        ? Number(sameDayContext.handoffPackage.price)
        : null
      if (controlledRiskPrice !== null
        && Number(requestedPricing.targetPrice) !== controlledRiskPrice) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_CONTROLLED_RISK_PRICE_CHANGED",
          blockers: ["CONTROLLED_RISK_APPROVED_PRICE_REQUIRED"],
        }, { status: 409 })
      }
      const canonicalPricing = canonicalPackagePricing(
        effectiveOpportunity.supplier_price ?? object(sourceSeed.pricing).supplierCost,
        requestedPricing.targetPrice,
        sameDayContext?.economicsConfig,
      )
      const packageForValidation = {
        ...form,
        imageAssetManifest: currentPackageData.imageAssetManifest,
      }
      const title = String(form.title ?? "").trim().slice(0, 80)
      const status = body.markReady === true ? "ready_for_review" : "draft"
      const resolvedHardGates = resolvedPackageHardGates(packageForValidation)
      const sourceGates = [
        ...(sameDayContext ? [] : strings(sourceOpportunity.hard_gates)
          .filter((gate) => !resolvedHardGates.has(gate))),
        ...(sameDayContext ? [] : strings(sourceOpportunity.evidence_guards)),
        ...(canonicalPricing.passesProfitGate ? [] : ["MINIMUM_NET_MARGIN_NOT_MET"]),
      ]
      const completeFields = [title, form.categoryId, String(form.description ?? ""), strings(form.imageUrls, 24)[0], canonicalPricing.targetPrice]
      const missingFields = [
        ...(!title ? ["TITLE_REQUIRED"] : []),
        ...(!form.categoryId ? ["CATEGORY_REQUIRED"] : []),
        ...(!String(form.description ?? "").trim() ? ["DESCRIPTION_REQUIRED"] : []),
        ...(!strings(form.imageUrls, 24).length ? ["IMAGE_REQUIRED"] : []),
        ...(!(Number(canonicalPricing.targetPrice) > 0) ? ["PRICE_REQUIRED"] : []),
      ]
      if (body.markReady === true && (sourceGates.length || missingFields.length)) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_PACKAGE_GATES_PENDING",
          blockers: [...sourceGates, ...missingFields],
        }, { status: 409 })
      }
      const readiness = Math.round((completeFields.filter(Boolean).length / completeFields.length) * 100)
      const values = {
        status,
        package_data: {
          title,
          categoryId: form.categoryId || null,
          conditionId: form.conditionId || currentPackageData.conditionId || null,
          categoryName: form.categoryName || null,
          aspects: object(form.aspects),
          description: String(form.description ?? "").slice(0, 100_000),
          imageUrls: strings(form.imageUrls, 24),
          imageAssetManifest: currentPackageData.imageAssetManifest,
          pricing: canonicalPricing,
          shipping: object(form.shipping),
          draftConfiguration: object(form.draftConfiguration),
          evidenceSnapshot: currentPackageData.evidenceSnapshot ?? sourceSeed.evidenceSnapshot,
          sourceRefresh: currentPackageData.sourceRefresh ?? null,
          safeDefaults: currentPackageData.safeDefaults ?? null,
          sameDayPilot: currentPackageData.sameDayPilot ?? null,
          controlledRiskPolicy: currentPackageData.controlledRiskPolicy ?? null,
          preferredImageRevisionId: currentPackageData.preferredImageRevisionId ?? null,
        },
        readiness,
      }
      const { data: savedData, error: saveError } = await supabase.rpc(
        "ebay_save_listing_package_guarded",
        {
          p_package_id: packageId,
          p_account_key: accountKey,
          p_actor: reviewer,
          p_opportunity_id: opportunityId,
          p_candidate_key: candidateKey,
          p_operation: "save",
          p_package_patch: values.package_data,
          p_status: values.status,
          p_readiness: values.readiness,
          p_source_observed_at: sameDayContext?.sourceObservedAt ?? null,
          p_expected_updated_at: currentPackage.updated_at,
        },
      )
      const savedPackage = guardedPackageRow(savedData)
      if (saveError || !savedPackage) {
        const code = databaseErrorCode(
          saveError,
          "COMMAND_CENTER_PACKAGE_SAVE_FAILED",
        )
        if (code === "EBAY_LISTING_PACKAGE_APPROVED_IMAGES_CHANGED") {
          return NextResponse.json({
            success: false,
            error: "COMMAND_CENTER_PACKAGE_GATES_PENDING",
            blockers: ["APPROVED_IMAGE_SET_CHANGED_REVIEW_REQUIRED"],
          }, { status: 409 })
        }
        if (code === "EBAY_LISTING_PACKAGE_STALE_VERSION") {
          return NextResponse.json({
            success: false,
            error: "COMMAND_CENTER_PACKAGE_CHANGED_RETRY",
          }, { status: 409 })
        }
        throw new Error(code)
      }
      return NextResponse.json({ success: true, listingPackage: savedPackage, savedAt: new Date().toISOString(), safety: { ebayWriteUsed: false, canPublish: false } })
    }

    return NextResponse.json({ success: false, error: "COMMAND_CENTER_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ success: false, error: errorCode(error) }, { status: 502 })
  }
}
