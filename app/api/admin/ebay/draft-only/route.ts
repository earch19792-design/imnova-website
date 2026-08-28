export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { createHash, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import {
  createEbayUnpublishedOffer,
  createOrReplaceEbayDraftInventoryItem,
  discoverEbayUnpublishedOfferBySku,
  EBAY_FINAL_PUBLISH_CONFIRMATION,
  ebayDraftOnlyRuntimeStatus,
  inspectEbayDraftSkuState,
  preflightEbayDraftDependencies,
  preflightEbayDraftOnlyMobile,
  preflightEbayDraftSkuCollision,
  publishEbayOfferOnce,
  sanitizeEbayOfferId,
  verifyEbayDraftInventoryItem,
  verifyEbayCompensatedOfferRecoveryState,
  verifyEbayPublishedOffer,
  verifyEbayUnpublishedOffer,
} from "@/lib/ebay/ebay-draft-only-gateway"
import { registerManualEbayListing } from "@/lib/ebay/ebay-manual-listing-service"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { compensatePublishedListingAttachmentFailureV1 } from
  "@/lib/ebay/ebay-commercial-improvement-action-service"
import { saveVerifiedEbayAccountPolicyProfile } from "@/lib/ebay/ebay-account-policy-profile"
import {
  approvalExpiresAt,
  buildEbayDraftOnlyPayload,
  ebayDraftOnlyApprovalPhrase,
  evaluateEbayDraftOnlyReadiness,
  expectedEbayDraftOnlySku,
  hashEbayDraftOnlyPayload,
  type EbayDraftOnlyTarget,
  type JsonRecord,
} from "@/lib/ebay/ebay-draft-only-readiness"
import {
  buildPostPublishStockguardAttachmentV1,
  revalidateMaterializedPublishWithStockguardContractV1,
} from "@/lib/ebay/ebay-current-future-listing-stockguard-wiring-v1"
import { isCanonicalEbayPackageSku } from "@/lib/ebay/ebay-sku"
import {
  canRetireSupersededSkuPreflight,
} from "@/lib/ebay/ebay-draft-only-prewrite-retirement"
import {
  isCommandCenterCommercialFreshnessRecheck,
} from "@/lib/ebay/ebay-command-center-commercial-freshness"
import {
  getEbayTaxonomyListingIntelligence,
  type EbayTaxonomyListingIntelligence,
} from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import {
  assertOneClickControlledPublicationIntentV1,
  bindOneClickControlledPublicationIntentV1,
  EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION,
  EBAY_ONE_CLICK_PUBLICATION_LABEL,
  EBAY_ONE_CLICK_PUBLICATION_SURFACE,
  validateOneClickControlledPublicationIntentV1,
} from "@/lib/ebay/ebay-one-click-controlled-publication-v1"
import {
  buildEbayListingTaxonomyPreflightV1,
} from "@/lib/ebay/ebay-listing-taxonomy-preflight-v1"
import {
  buildEbayCategoryResolverProductTruthV1,
  recordEbayCategoryListingAcceptanceV1,
} from "@/lib/ebay/ebay-category-resolver-v1"
import {
  applyHumanConfirmedProductTruthEvidenceV1,
  buildHumanConfirmedProductTruthEvidenceV1,
  humanConfirmedProductTruthValuesV1,
} from "@/lib/ebay/ebay-human-product-truth-evidence-v1"
import {
  assertLifecycleStateContextV1,
  assertListingPackageContextV1,
  assertTaxonomySnapshotContextV1,
  taxonomySnapshotMatchesContextV1,
  type EbayListingContextIdentityV1,
} from "@/lib/ebay/ebay-listing-context-isolation-v1"
import { enqueueSellerWhatsAppAlert } from "@/lib/ebay/ebay-seller-whatsapp-alerts"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { loadSameDayAuthorizedPublicationContext } from "@/lib/ebay/ebay-same-day-authorized-publication"
import {
  isSmartStockingListingIntakeV1,
} from
  "@/lib/ebay/ebay-smart-stocking-listing-intake-v1"
import { resolveSmartStockingAuthorizedPublicationV1 } from
  "@/lib/ebay/ebay-smart-stocking-authorized-publication-v1"
import {
  bindCanonicalPublicationImageSet,
  loadFinalListingReviewPublicationGate,
  type FinalListingReviewPublicationGate,
} from "@/lib/ebay/final-listing-review-publication-gate"
import {
  packageWithV3PublicationAssets,
  validateV3PublicationAssets,
  withV3FinalSetAuthorization,
} from "@/lib/ebay/ebay-v3-unpublished-offer-authorization"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function exactTextRecordMatch(left: unknown, right: unknown) {
  const leftRecord = record(left)
  const rightRecord = record(right)
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ])
  return [...keys].every((name) =>
    text(leftRecord[name]) === text(rightRecord[name]))
}

function evidenceTimestamp(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value)
    if (Number.isFinite(Date.parse(candidate))) return new Date(candidate).toISOString()
  }
  return ""
}

function uuid(value: unknown) {
  const parsed = text(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)
    ? parsed
    : null
}

function idempotencyKey(value: unknown) {
  const parsed = text(value)
  return /^[A-Za-z0-9._:-]{8,120}$/.test(parsed) ? parsed : null
}

function responseTarget(): EbayDraftOnlyTarget | "BLOCKED" {
  const value = process.env.EBAY_DRAFT_ONLY_TARGET?.trim().toUpperCase() || "SANDBOX"
  return value === "SANDBOX" || value === "PRODUCTION" ? value : "BLOCKED"
}

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+(?:_[0-9]{3})?$/.test(value)
    ? value
    : "EBAY_DRAFT_ONLY_REQUEST_FAILED"
}

function databaseExceptionCode(error: unknown, fallback: string) {
  const value = record(error)
  const combined = [value.message, value.details, value.hint, value.code]
    .map((entry) => text(entry))
    .join(" ")
  return combined.match(/EBAY_[A-Z0-9_]{3,180}/)?.[0] ?? fallback
}

function configurationFromApprovedPayload(payload: JsonRecord) {
  const inventory = record(payload.inventoryItemPayload)
  const availability = record(record(inventory.availability).shipToLocationAvailability)
  const offer = record(payload.offerPayload)
  const compliance = record(payload.compliance)
  return {
    sku: payload.sku,
    quantity: availability.quantity,
    condition: inventory.condition,
    packageWeightAndSize: inventory.packageWeightAndSize,
    merchantLocationKey: offer.merchantLocationKey,
    businessPolicies: offer.listingPolicies,
    imageAuthorization: compliance.imageAuthorization,
    aspectValidation: compliance.aspectValidation,
    skuCollisionCheck: compliance.skuCollisionCheck,
    ebayPreflightSnapshot: compliance.ebayPreflightSnapshot,
    publishWithStockguardContract: compliance.publishWithStockguardContract,
  }
}

async function retireSupersededPrewriteSkuPreflight(input: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  approvalId: string
  sku: string
  target: EbayDraftOnlyTarget
  accountFingerprint: string
}) {
  const { data: executions, error: executionError } = await input.supabase
    .from("ebay_draft_only_execution_ledger")
    .select(
      "id,approval_id,phase,last_error_code,inventory_http_status,"
      + "inventory_confirmed_at,offer_create_started_at,offer_http_status,"
      + "offer_id,completed_at,lease_expires_at,sanitized_result",
    )
    .eq("target", input.target)
    .eq("account_fingerprint", input.accountFingerprint)
    .eq("sku", input.sku)
    .neq("approval_id", input.approvalId)
    .neq("phase", "terminal_failure")
    .limit(2)
  if (executionError) {
    throw new Error("EBAY_DRAFT_ONLY_SUPERSEDED_PREFLIGHT_READ_FAILED")
  }
  if (!executions?.length) return false
  if (executions.length !== 1) return false

  const candidate = record(executions[0])
  const priorApprovalId = uuid(candidate.approval_id)
  if (!priorApprovalId) return false
  const { data: priorApproval, error: priorApprovalError } = await input.supabase
    .from("ebay_draft_only_approvals")
    .select("id,status,expires_at,consumed_at,revoked_at")
    .eq("id", priorApprovalId)
    .maybeSingle()
  if (priorApprovalError) {
    throw new Error("EBAY_DRAFT_ONLY_SUPERSEDED_APPROVAL_READ_FAILED")
  }
  if (
    !priorApproval
    || !canRetireSupersededSkuPreflight(
      candidate,
      priorApproval as JsonRecord,
    )
  ) return false

  const nowIso = new Date().toISOString()
  const { data: retired, error: retirementError } = await input.supabase
    .from("ebay_draft_only_execution_ledger")
    .update({
      phase: "terminal_failure",
      last_error_code: "EBAY_SKU_PREFLIGHT_SUPERSEDED_BY_REAPPROVAL",
      sanitized_result: {
        ...record(candidate.sanitized_result),
        supersededPrewritePreflight: true,
        successorApprovalId: input.approvalId,
        retiredAt: nowIso,
      },
      lease_token: null,
      lease_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", text(candidate.id))
    .eq("approval_id", priorApprovalId)
    .eq("phase", "claimed")
    .eq("last_error_code", "EBAY_SKU_PREFLIGHT_UNAVAILABLE")
    .is("inventory_http_status", null)
    .is("inventory_confirmed_at", null)
    .is("offer_create_started_at", null)
    .is("offer_http_status", null)
    .is("offer_id", null)
    .is("completed_at", null)
    .or(`lease_expires_at.is.null,lease_expires_at.lte.${nowIso}`)
    .select("id")
    .maybeSingle()
  if (retirementError || !retired) {
    throw new Error("EBAY_DRAFT_ONLY_SUPERSEDED_PREFLIGHT_RETIRE_FAILED")
  }
  return true
}

function publicationPreviewHash(value: JsonRecord) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function hasOneClickControlledPublicationIntent(payload: JsonRecord) {
  return Object.keys(record(payload.controlledPublicationIntent)).length > 0
}

function oneClickPublicationRequirements(enabled: boolean) {
  return enabled ? {
    humanAuthorizationCount: 1,
    exactHumanIntent: EBAY_ONE_CLICK_PUBLICATION_LABEL,
    authorizationSurface: EBAY_ONE_CLICK_PUBLICATION_SURFACE,
    secondHumanAuthorizationRequired: false,
    finalMachinePreflightRequired: true,
    unpublishedOfferMachineValidationRequired: true,
    activeReadbackRequired: true,
  } : {
    humanAuthorizationCount: 2,
    secondHumanAuthorizationRequired: true,
  }
}

async function verifyExactUnpublishedPublicationState(input: {
  approvedPayload: JsonRecord
  offerId: string
  sku: string
}) {
  const inventoryItemPayload = record(input.approvedPayload.inventoryItemPayload)
  const offerPayload = record(input.approvedPayload.offerPayload)
  const [inventory, offer] = await Promise.all([
    verifyEbayDraftInventoryItem(input.sku, inventoryItemPayload),
    verifyEbayUnpublishedOffer(
      input.offerId,
      input.sku,
      "EBAY_US",
      offerPayload,
    ),
  ])
  if (!inventory.safe) {
    throw new Error(
      "EBAY_FINAL_PUBLICATION_INVENTORY_EXACT_READBACK_MISMATCH",
    )
  }
  if (!offer.safe) {
    throw new Error(offer.blocker ||
      "EBAY_FINAL_PUBLICATION_OFFER_EXACT_READBACK_MISMATCH")
  }
  return { inventory, offer }
}

function buildFinalPublicationPreview(
  approval: JsonRecord,
  execution: JsonRecord,
  visualPublicationGate: FinalListingReviewPublicationGate,
) {
  const payload = record(approval.approved_payload)
  const inventoryItemPayload = record(payload.inventoryItemPayload)
  const offerPayload = record(payload.offerPayload)
  const authorization = record(record(payload.compliance).imageAuthorization)
  const imageBinding = bindCanonicalPublicationImageSet({
    imageUrls: record(inventoryItemPayload.product).imageUrls,
    imageAuthorization: authorization,
    gate: visualPublicationGate,
  })
  const images = imageBinding.images
  const offerId = sanitizeEbayOfferId(execution.offer_id)
  const sku = text(payload.sku)
  const publishWithStockguardContract =
    finalPublicationStockguardContract(payload)
  if (
    approval.status !== "consumed"
    || !approval.consumed_at
    || execution.phase !== "completed"
    || !offerId
    || !isCanonicalEbayPackageSku(sku)
    || !imageBinding.allowed
    || offerPayload.marketplaceId !== "EBAY_US"
    || offerPayload.sku !== sku
  ) throw new Error("EBAY_FINAL_PUBLICATION_PREVIEW_NOT_READY")
  const preview: JsonRecord = {
    version: "EBAY_AUTHORIZED_LISTING_PUBLICATION_V1",
    draftExecutionId: text(execution.id),
    draftApprovalId: text(approval.id),
    listingPackageId: text(approval.listing_package_id),
    opportunityId: text(approval.opportunity_id),
    candidateKey: text(approval.candidate_key),
    target: text(execution.target),
    accountFingerprint: text(execution.account_fingerprint),
    approvedPayloadHash: text(approval.payload_hash),
    offerId,
    sku,
    marketplaceId: "EBAY_US",
    inventoryItemPayload,
    offerPayload,
    imageCount: images.length,
    imageUrls: images,
    imagePolicy: {
      canonicalPreflightCount: imageBinding.canonicalPreflightCount,
      hardMinimum: imageBinding.hardMinimum,
      qualityTarget: imageBinding.qualityTarget,
      qualityTargetMet: imageBinding.qualityTargetMet,
      qualityTargetBlocking: false,
    },
    pricingGuard: {
      exactApprovedPrice: record(record(offerPayload.pricingSummary).price).value,
      currency: record(record(offerPayload.pricingSummary).price).currency,
      promotionsIncluded: false,
      volumePricingIncluded: false,
    },
    publishWithStockguardContract,
    permittedOperation: "publishOffer",
  }
  return { preview, previewHash: publicationPreviewHash(preview), offerId, sku }
}

async function loadFinalPublicationContext(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  executionId: string,
  actor: string,
) {
  const { data: execution, error: executionError } = await supabase
    .from("ebay_draft_only_execution_ledger")
    .select("*")
    .eq("id", executionId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (executionError || !execution) throw new Error("EBAY_FINAL_PUBLICATION_EXECUTION_NOT_FOUND")
  const { data: approval, error: approvalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("*")
    .eq("id", execution.approval_id)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (approvalError || !approval) throw new Error("EBAY_FINAL_PUBLICATION_APPROVAL_NOT_FOUND")
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", execution.listing_package_id)
    .eq("created_by", actor)
    .maybeSingle()
  if (packageError || !listingPackage) throw new Error("EBAY_FINAL_PUBLICATION_PACKAGE_NOT_FOUND")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", execution.opportunity_id)
    .maybeSingle()
  if (opportunityError || !opportunity) throw new Error("EBAY_FINAL_PUBLICATION_OPPORTUNITY_NOT_FOUND")
  const runtime = ebayDraftOnlyRuntimeStatus()
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  const sameDayContext = accountKey
    ? await loadSameDayAuthorizedPublicationContext({
      supabase,
      accountKey,
      actorUserId: actor,
      listingPackage: listingPackage as JsonRecord,
      opportunity: opportunity as JsonRecord,
    })
    : null
  const effectiveOpportunity = sameDayContext?.opportunity ??
    (opportunity as JsonRecord)
  const smartStockingContext = accountKey &&
    isSmartStockingListingIntakeV1(record(effectiveOpportunity.assessment))
    ? await resolveSmartStockingAuthorizedPublicationV1({
      supabase,
      accountKey,
      actorUserId: actor,
      listingPackage: listingPackage as JsonRecord,
      opportunity: effectiveOpportunity,
    })
    : null
  if (!sameDayContext && !smartStockingContext) {
    throw new Error("EBAY_FINAL_PUBLICATION_SOURCE_BINDING_REQUIRED")
  }
  if (
    !runtime.enabled
    || !runtime.configured
    || runtime.target !== "PRODUCTION"
    || runtime.accountFingerprint !== execution.account_fingerprint
    || execution.target !== "PRODUCTION"
    || !accountKey
    || listingPackage.account_key !== accountKey
    || listingPackage.status !== "approved"
    || effectiveOpportunity.supplier_available !== true
    || (!smartStockingContext &&
      Number(effectiveOpportunity.supplier_inventory_quantity) < 1)
  ) throw new Error("EBAY_FINAL_PUBLICATION_SCOPE_OR_STOCK_INVALID")
  const approvedSourceEvidence = record(record(approval.approved_payload).sourceEvidence)
  const approvedCost = Number(approvedSourceEvidence.supplierPrice)
  const currentCost = Number(effectiveOpportunity.supplier_price)
  if (!Number.isFinite(approvedCost) || !Number.isFinite(currentCost)
    || Math.abs(approvedCost - currentCost) >= 0.005) {
    throw new Error("EBAY_FINAL_PUBLICATION_LUNA_COST_CHANGED")
  }
  if (sameDayContext) {
    const approvedPayload = record(approval.approved_payload)
    const approvedCompliance = record(approvedPayload.compliance)
    const approvedSameDayAuthorization = record(
      approvedCompliance.sameDayPilotAuthorization,
    )
    if (
      approvedSameDayAuthorization.validated !== true
      || text(approvedSameDayAuthorization.version)
        !== text(sameDayContext.authorization.version)
      || text(approvedSameDayAuthorization.runId)
        !== text(sameDayContext.authorization.runId)
      || text(approvedSameDayAuthorization.candidateId)
        !== text(sameDayContext.authorization.candidateId)
      || text(approvedSameDayAuthorization.handoffPackageHash)
        !== text(sameDayContext.authorization.handoffPackageHash)
    ) throw new Error("EBAY_FINAL_PUBLICATION_SAME_DAY_BINDING_CHANGED")
  }
  if (smartStockingContext) {
    const approvedPayload = record(approval.approved_payload)
    const approvedCompliance = record(approvedPayload.compliance)
    const approvedAuthorization = record(
      approvedCompliance.smartStockingPublicationAuthorization,
    )
    const approvedStockguard = record(
      approvedCompliance.publishWithStockguardContract,
    )
    if (
      hashEbayDraftOnlyPayload(approvedAuthorization) !==
        hashEbayDraftOnlyPayload(smartStockingContext.authorization) ||
      hashEbayDraftOnlyPayload(approvedStockguard) !==
        hashEbayDraftOnlyPayload(
          smartStockingContext.publishWithStockguardContract,
        )
    ) throw new Error("EBAY_FINAL_PUBLICATION_SMART_STOCKING_BINDING_CHANGED")
    if (hasOneClickControlledPublicationIntent(approvedPayload)) {
      assertOneClickControlledPublicationIntentV1({
        approvedPayload,
        actorUserId: actor,
        listingPackage: listingPackage as JsonRecord,
        opportunity: effectiveOpportunity,
        accountFingerprint: runtime.accountFingerprint,
      })
    }
  }
  return {
    execution: execution as JsonRecord,
    approval: approval as JsonRecord,
    listingPackage: listingPackage as JsonRecord,
    opportunity: effectiveOpportunity,
    sameDayPilotAuthorization: sameDayContext?.authorization ?? null,
    smartStockingPublicationAuthorization:
      smartStockingContext?.authorization ?? null,
    runtime,
    accountKey,
  }
}

async function revalidateFinalPublicationDependencies(approvedPayload: JsonRecord) {
  const offer = record(approvedPayload.offerPayload)
  const policies = record(offer.listingPolicies)
  const requested = {
    fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
    paymentPolicyId: text(policies.paymentPolicyId),
    returnPolicyId: text(policies.returnPolicyId),
    merchantLocationKey: text(offer.merchantLocationKey),
  }
  const preflight = await preflightEbayDraftOnlyMobile(requested)
  if (
    preflight.target !== "PRODUCTION"
    || preflight.identity.status !== "BOUND"
    || !preflight.privilege.usable
    || !preflight.selectionComplete
    || Object.entries(requested).some(([key, value]) =>
      preflight.selection[key as keyof typeof requested] !== value)
  ) throw new Error("EBAY_FINAL_PUBLICATION_ACCOUNT_PREFLIGHT_FAILED")
  const dependencies = await preflightEbayDraftDependencies({
    ...requested,
    preflightSnapshot: preflight.snapshot,
  })
  if (!dependencies.safe) {
    throw new Error(dependencies.blocker || "EBAY_FINAL_PUBLICATION_DEPENDENCIES_INVALID")
  }
  return { preflight, dependencies }
}

async function revalidateFinalPublicationSource(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  context: Awaited<ReturnType<typeof loadFinalPublicationContext>>,
) {
  if (context.smartStockingPublicationAuthorization) {
    return { authority: text(
      context.smartStockingPublicationAuthorization.sourceRevalidationAuthority,
    ) }
  }
  const approvedCompliance = record(
    record(context.approval.approved_payload).compliance,
  )
  const v3FinalSetAuthorization = record(
    approvedCompliance.v3FinalSetAuthorization,
  )
  const sourceSyncFunction = Object.keys(v3FinalSetAuthorization).length
    ? "sync_ebay_v3_source_before_authorized_publication"
    : "sync_same_day_source_before_authorized_publication"
  const { error } = await supabase.rpc(sourceSyncFunction, {
    p_draft_execution_id: text(context.execution.id),
    p_actor_user_id: text(context.execution.actor_user_id),
    p_marketplace_account_key: context.accountKey,
  })
  if (error) {
    throw new Error(databaseExceptionCode(
      error,
      "EBAY_FINAL_PUBLICATION_LUNA_SOURCE_SYNC_FAILED",
    ))
  }
  return { authority: sourceSyncFunction }
}

async function loadPackageContext(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  packageId: string,
  actorUserId: string,
  sku: string,
  target: EbayDraftOnlyTarget,
  accountFingerprint: string,
  excludeApprovalId?: string,
  allowFinalV3ReadOnlyFallback = false,
) {
  const sellerAccountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!sellerAccountKey) throw new Error("EBAY_DRAFT_ONLY_PACKAGE_ACCOUNT_SCOPE_REQUIRED")
  if (sku && !/^[A-Za-z0-9._-]{1,50}$/.test(sku)) {
    throw new Error("EBAY_DRAFT_ONLY_SKU_INVALID")
  }
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", packageId)
    .eq("created_by", actorUserId)
    .eq("account_key", sellerAccountKey)
    .maybeSingle()
  if (packageError || !listingPackage) throw new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", listingPackage.opportunity_id)
    .maybeSingle()
  if (opportunityError || !opportunity) throw new Error("EBAY_DRAFT_ONLY_OPPORTUNITY_NOT_FOUND")
  let sameDayContext: Awaited<ReturnType<
    typeof loadSameDayAuthorizedPublicationContext
  >> = null
  try {
    sameDayContext = await loadSameDayAuthorizedPublicationContext({
      supabase,
      accountKey: sellerAccountKey,
      actorUserId,
      listingPackage: listingPackage as JsonRecord,
      opportunity: opportunity as JsonRecord,
    })
  } catch (contextError) {
    const commercialFreshnessRecheck =
      isCommandCenterCommercialFreshnessRecheck(errorCode(contextError))
    if (
      !allowFinalV3ReadOnlyFallback
      || !commercialFreshnessRecheck
    ) throw contextError
    const finalReviewGate = await loadFinalListingReviewPublicationGate({
      supabase,
      listingPackageId: packageId,
      actorId: actorUserId,
    })
    if (!finalReviewGate.allowed) throw contextError
  }
  const effectiveOpportunity = sameDayContext?.opportunity ?? (opportunity as JsonRecord)
  const smartStockingContext = isSmartStockingListingIntakeV1(
    record(effectiveOpportunity.assessment),
  ) ? await resolveSmartStockingAuthorizedPublicationV1({
    supabase,
    accountKey: sellerAccountKey,
    actorUserId,
    listingPackage: listingPackage as JsonRecord,
    opportunity: effectiveOpportunity,
  }) : null
  const collisionSku = expectedEbayDraftOnlySku(listingPackage as JsonRecord)
  const candidateKey = text(listingPackage.candidate_key)
  const supplierSku = text(effectiveOpportunity.supplier_sku)
  const supplierVariantId = text(effectiveOpportunity.supplier_variant_id)
  const marketRadarProductId = uuid(effectiveOpportunity.market_radar_product_id)
  const gtin = text(effectiveOpportunity.gtin)
  const emptyCollision = () => Promise.resolve({ data: [] as Array<{ id: string }>, error: null })
  const ebaySkuQuery = collisionSku
    ? supabase.from("ebay_active_listings").select("id").eq("ebay_sku", collisionSku).neq("listing_status", "ended").limit(1)
    : emptyCollision()
  const supplierSkuQuery = supplierSku
    ? supabase.from("ebay_active_listings").select("id").eq("supplier_sku", supplierSku).neq("listing_status", "ended").limit(1)
    : emptyCollision()
  const supplierVariantQuery = supplierVariantId
    ? supabase.from("ebay_active_listings").select("id").eq("supplier_variant_id", supplierVariantId).neq("listing_status", "ended").limit(1)
    : emptyCollision()
  let marketRadarQuery = marketRadarProductId
    ? supabase.from("ebay_active_listings").select("id").eq("market_radar_product_id", marketRadarProductId).neq("listing_status", "ended")
    : null
  if (marketRadarQuery && supplierVariantId) {
    marketRadarQuery = marketRadarQuery.eq("supplier_variant_id", supplierVariantId)
  }
  const candidatePackageQuery = candidateKey
    ? supabase.from("ebay_listing_packages").select("id").eq("account_key", sellerAccountKey).eq("candidate_key", candidateKey).neq("id", packageId).in("status", ["draft", "ready_for_review", "approved"]).limit(1)
    : emptyCollision()
  let candidateApprovalQuery = candidateKey
    ? supabase.from("ebay_draft_only_approvals").select("id").eq("candidate_key", candidateKey).eq("target", target).in("status", ["approved", "consumed"]).neq("listing_package_id", packageId).limit(1)
    : null
  if (candidateApprovalQuery) {
    candidateApprovalQuery = candidateApprovalQuery.or(`account_fingerprint.eq.${accountFingerprint || "__unconfigured__"},account_fingerprint.is.null`)
  }
  let gtinApprovalQuery = gtin
    ? supabase.from("ebay_draft_only_approvals").select("id").eq("target", target).in("status", ["approved", "consumed"]).neq("listing_package_id", packageId).contains("approved_payload", { sourceEvidence: { gtin } }).limit(1)
    : null
  if (gtinApprovalQuery) {
    gtinApprovalQuery = gtinApprovalQuery.or(`account_fingerprint.eq.${accountFingerprint || "__unconfigured__"},account_fingerprint.is.null`)
  }
  const gtinOpportunityQuery = gtin
    ? supabase.from("ebay_luna_opportunity_queue").select("id").eq("gtin", gtin).neq("id", text(opportunity.id)).limit(20)
    : emptyCollision()
  let ledgerQuery = supabase
    .from("ebay_draft_only_execution_ledger")
    .select("id")
    .eq("target", target)
    .or(`account_fingerprint.eq.${accountFingerprint || "__unconfigured__"},account_fingerprint.is.null`)
    .eq("sku", collisionSku || "__missing__")
    .neq("phase", "terminal_failure")
    .limit(1)
  if (excludeApprovalId) ledgerQuery = ledgerQuery.neq("approval_id", excludeApprovalId)
  const [
    ebaySkuResult,
    supplierSkuResult,
    supplierVariantResult,
    marketRadarResult,
    candidatePackageResult,
    candidateApprovalResult,
    gtinApprovalResult,
    gtinOpportunityResult,
    ledgerResult,
  ] = await Promise.all([
    ebaySkuQuery,
    supplierSkuQuery,
    supplierVariantQuery,
    marketRadarQuery ?? emptyCollision(),
    candidatePackageQuery,
    candidateApprovalQuery ?? emptyCollision(),
    gtinApprovalQuery ?? emptyCollision(),
    gtinOpportunityQuery,
    ledgerQuery,
  ])
  const duplicateOpportunityIds = (gtinOpportunityResult.data ?? [])
    .map((row) => text(row.id))
    .filter(Boolean)
  const gtinPackageResult = duplicateOpportunityIds.length
    ? await supabase.from("ebay_listing_packages").select("id").eq("account_key", sellerAccountKey).in("opportunity_id", duplicateOpportunityIds).in("status", ["draft", "ready_for_review", "approved"]).limit(1)
    : { data: [] as Array<{ id: string }>, error: null }
  if (
    ebaySkuResult.error || supplierSkuResult.error || supplierVariantResult.error ||
    marketRadarResult.error || candidatePackageResult.error || candidateApprovalResult.error ||
    gtinApprovalResult.error || gtinOpportunityResult.error || gtinPackageResult.error ||
    ledgerResult.error
  ) throw new Error("EBAY_DRAFT_ONLY_COLLISION_READ_FAILED")
  const identityCollisionReasons = [
    supplierSkuResult.data?.length ? "ACTIVE_SUPPLIER_SKU" : "",
    supplierVariantResult.data?.length ? "ACTIVE_SUPPLIER_VARIANT" : "",
    marketRadarResult.data?.length ? "ACTIVE_MARKET_RADAR_PRODUCT_VARIANT" : "",
    candidatePackageResult.data?.length ? "LISTING_PACKAGE_CANDIDATE_KEY" : "",
    candidateApprovalResult.data?.length ? "DRAFT_APPROVAL_CANDIDATE_KEY" : "",
    gtinApprovalResult.data?.length ? "DRAFT_APPROVAL_GTIN" : "",
    gtinPackageResult.data?.length ? "LISTING_PACKAGE_GTIN" : "",
  ].filter(Boolean)
  return {
    listingPackage: listingPackage as JsonRecord,
    opportunity: effectiveOpportunity,
    sameDayPilotAuthorization: sameDayContext?.authorization ?? null,
    smartStockingPublicationAuthorization:
      smartStockingContext?.authorization ?? null,
    economicsConfig: sameDayContext?.economicsConfig ??
      smartStockingContext?.economicsConfig,
    publishWithStockguardContract:
      smartStockingContext?.publishWithStockguardContract ?? null,
    activeSkuCollision: Boolean(ebaySkuResult.data?.length),
    ledgerSkuCollision: Boolean(ledgerResult.data?.length),
    identityCollisionReasons,
  }
}

function serverApprovedConfiguration(
  raw: JsonRecord,
  listingPackage: JsonRecord,
  opportunity: JsonRecord,
  actor: string,
  now: Date,
  imagesConfirmed: boolean,
  finalReviewGate: FinalListingReviewPublicationGate,
  liveTaxonomy?: EbayTaxonomyListingIntelligence,
) {
  const packageData = record(listingPackage.package_data)
  const images = Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls.filter((item): item is string => typeof item === "string")
    : []
  const approvedImageManifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(record).filter((asset) =>
        text(asset.url) && text(asset.humanApprovedAt) &&
        asset.automaticQa === "PASSED" &&
        /^[0-9a-f]{64}$/.test(text(asset.sha256))
      )
    : []
  const approvedManifestUrls = approvedImageManifest
    .map((asset) => text(asset.url))
    .filter(Boolean)
  const imageManifestConfirmed = images.length > 0
    && images.every((url) => approvedManifestUrls.includes(url))
  const canonicalImageAuthorization = {
    approved: true,
    approvedAt: now.toISOString(),
    approvedBy: actor,
    approvedImageUrls: images,
    protectedManifestVerified: true,
    protectedManifestAssetCount: images.length,
    rightsBasis: finalReviewGate.source ===
      "APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA"
      ? "supplier_authorized"
      : text(record(raw.imageAuthorization).rightsBasis),
    source: finalReviewGate.source ===
      "APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA"
      ? "luna"
      : text(record(raw.imageAuthorization).source),
  }
  const canonicalImageBinding = bindCanonicalPublicationImageSet({
    imageUrls: images,
    imageAuthorization: canonicalImageAuthorization,
    gate: finalReviewGate,
  })
  const assessment = record(opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const category = record(intelligence.categoryRecommendation)
  const liveTaxonomyAvailable = liveTaxonomy?.status === "AVAILABLE"
    && liveTaxonomy.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && Boolean(text(liveTaxonomy.observedAt))
    && Boolean(text(liveTaxonomy.categoryTreeId))
    && Boolean(text(liveTaxonomy.categoryTreeVersion))
  const liveAspectConstraints = liveTaxonomyAvailable
    ? liveTaxonomy.aspects ?? []
    : []
  const taxonomyConstraintsCaptured = liveTaxonomyAvailable
  const persistedTaxonomy = record(packageData.taxonomyPreflight)
  const persistedTaxonomyContext: EbayListingContextIdentityV1 = {
    marketplaceId: "EBAY_US",
    listingPackageId: text(listingPackage.id),
    opportunityId: text(listingPackage.opportunity_id),
    candidateKey: text(listingPackage.candidate_key),
  }
  const persistedTaxonomyAvailable =
    persistedTaxonomy.status === "CONSULTADO"
    && persistedTaxonomy.officialStatus === "AVAILABLE"
    && persistedTaxonomy.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && /^sha256:[0-9a-f]{64}$/.test(text(
      persistedTaxonomy.evidenceDigest,
    ))
    && taxonomySnapshotMatchesContextV1({
      expected: persistedTaxonomyContext,
      taxonomyPreflight: persistedTaxonomy,
      categoryId: packageData.categoryId,
    })
  const persistedRequiredAspects = Array.isArray(
    persistedTaxonomy.requiredAspects,
  ) ? persistedTaxonomy.requiredAspects.map(record) : []
  const persistedAspectConstraints = Array.isArray(persistedTaxonomy.aspects)
    ? persistedTaxonomy.aspects.map(record) : []
  const requiredAspects = liveTaxonomyAvailable
    ? liveTaxonomy.requiredAspects.map((item) => text(item.name)).filter(Boolean)
    : persistedTaxonomyAvailable
      ? persistedRequiredAspects.map((item) => text(item.name)).filter(Boolean)
    : Array.isArray(category.requiredAspects)
      ? category.requiredAspects.map((item) => text(record(item).name)).filter(Boolean)
      : []
  const requestedAuthorization = record(raw.imageAuthorization)
  const packageCategoryId = text(packageData.categoryId)
  const taxonomyConfirmed = liveTaxonomyAvailable
    ? text(liveTaxonomy.categoryId) === packageCategoryId
    : persistedTaxonomyAvailable
      ? text(persistedTaxonomy.categoryId) === packageCategoryId
    : text(category.categoryId) === packageCategoryId
      && text(category.taxonomyStatus) === "AVAILABLE"
  const taxonomyObservedAt = liveTaxonomyAvailable
    ? evidenceTimestamp(liveTaxonomy.observedAt)
    : persistedTaxonomyAvailable
      ? evidenceTimestamp(persistedTaxonomy.observedAt)
    : evidenceTimestamp(
      category.observedAt,
      category.fetchedAt,
      category.validatedAt,
      assessment.assessedAt,
      opportunity.last_scanned_at,
      listingPackage.source_observed_at,
  )
  const packageMeasurements = record(raw.packageWeightAndSize)
  const packageDimensions = record(packageMeasurements.dimensions)
  const packageWeight = record(packageMeasurements.weight)
  const dimensionValues = [
    packageDimensions.length,
    packageDimensions.width,
    packageDimensions.height,
  ].map((value) => Number(value))
  const packageMeasurementsComplete = dimensionValues.every((value) =>
    Number.isFinite(value) && value > 0)
    && ["INCH", "CENTIMETER"].includes(
      text(packageDimensions.unit).toUpperCase(),
    )
    && Number.isFinite(Number(packageWeight.value))
    && Number(packageWeight.value) > 0
    && ["POUND", "KILOGRAM", "OUNCE", "GRAM"].includes(
      text(packageWeight.unit).toUpperCase(),
    )
  return {
    sku: expectedEbayDraftOnlySku(listingPackage),
    quantity: raw.quantity,
    condition: raw.condition,
    merchantLocationKey: raw.merchantLocationKey,
    businessPolicies: raw.businessPolicies,
    packageWeightAndSize: packageMeasurementsComplete
      ? raw.packageWeightAndSize
      : undefined,
    imageAuthorization: canonicalImageBinding.allowed
      ? canonicalImageAuthorization
      : {
        approved: imagesConfirmed && imageManifestConfirmed,
        approvedAt: imagesConfirmed && imageManifestConfirmed
          ? now.toISOString()
          : null,
        approvedBy: imagesConfirmed && imageManifestConfirmed ? actor : null,
        approvedImageUrls: imageManifestConfirmed ? images : [],
        protectedManifestVerified: imageManifestConfirmed,
        protectedManifestAssetCount: approvedImageManifest.length,
        rightsBasis: requestedAuthorization.rightsBasis,
        source: requestedAuthorization.source,
      },
    aspectValidation: {
      validated: taxonomyConfirmed && Boolean(taxonomyObservedAt),
      validatedAt: taxonomyObservedAt,
      categoryId: packageCategoryId,
      categoryTreeId: liveTaxonomyAvailable
        ? liveTaxonomy.categoryTreeId
        : persistedTaxonomyAvailable
          ? persistedTaxonomy.categoryTreeId
          : null,
      categoryTreeVersion: liveTaxonomyAvailable
        ? liveTaxonomy.categoryTreeVersion
        : persistedTaxonomyAvailable
          ? persistedTaxonomy.categoryTreeVersion
          : null,
      requiredAspects,
      aspectConstraints: liveTaxonomyAvailable
        ? liveAspectConstraints
        : persistedTaxonomyAvailable
          ? persistedAspectConstraints
          : [],
      constraintSnapshotStatus: taxonomyConstraintsCaptured
        || persistedTaxonomyAvailable ? "AVAILABLE" : "UNAVAILABLE",
      source: liveTaxonomyAvailable
        ? liveTaxonomy.source
        : persistedTaxonomyAvailable
          ? persistedTaxonomy.source
        : "opportunity.assessment.listingIntelligencePackage.categoryRecommendation",
    },
    skuCollisionCheck: {
      sku: expectedEbayDraftOnlySku(listingPackage),
      serverPreflightRequiredAtExecution: true,
    },
    ebayPreflightSnapshot: text(raw.ebayPreflightSnapshot).slice(0, 4_096),
    publishWithStockguardContract: record(raw.publishWithStockguardContract),
  }
}

function bindServerPublicationContracts(
  draftConfiguration: JsonRecord,
  context: { publishWithStockguardContract?: unknown },
) {
  const stockguard = record(context.publishWithStockguardContract)
  return Object.keys(stockguard).length
    ? { ...draftConfiguration, publishWithStockguardContract: stockguard }
    : draftConfiguration
}

function finalPublicationStockguardContract(approvedPayload: JsonRecord) {
  const value = record(record(approvedPayload.compliance)
    .publishWithStockguardContract)
  return revalidateMaterializedPublishWithStockguardContractV1(value)
}

async function loadLivePackageTaxonomy(listingPackage: JsonRecord) {
  const packageData = record(listingPackage.package_data)
  const title = text(packageData.title).slice(0, 350)
  const categoryId = text(packageData.categoryId)
  return getEbayTaxonomyListingIntelligence(title, categoryId || null)
}

function jsonError(error: unknown, status = 502, blockers?: string[]) {
  return NextResponse.json({
    success: false,
    error: errorCode(error),
    ...(blockers ? { blockers } : {}),
    safety: { target: responseTarget(), canPublish: false },
  }, { status })
}

async function enqueueDraftFailure(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  approval: JsonRecord,
  context: { listingPackage: JsonRecord; opportunity: JsonRecord },
  code: string,
  terminalFailure: boolean,
) {
  await enqueueSellerWhatsAppAlert(supabase, {
    alertType: "draft_failure",
    entityType: "ebay_listing_package",
    entityId: text(approval.listing_package_id),
    candidateKey: text(context.listingPackage.candidate_key),
    title: text(context.opportunity.product_title) || "Draft eBay",
    summary: `El draft no publicado quedó detenido: ${code}. No se llamó a publishOffer.`,
    mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
    facts: { terminalFailure },
  }).catch(() => undefined)
}

async function authenticate(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return {
    response: jsonError(new Error(validation.error ?? "ADMIN_FORBIDDEN"), validation.status || 403),
    actor: null,
  }
  if (!validation.userId) return {
    response: jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403),
    actor: null,
  }
  return { response: null, actor: validation.userId }
}

export async function GET(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  if (!auth.actor) return jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403)
  const url = new URL(req.url)
  const packageId = uuid(url.searchParams.get("packageId"))
  const expectedOpportunityId = uuid(url.searchParams.get("opportunityId"))
  const expectedCandidateKey = text(url.searchParams.get("candidateKey"))
    .slice(0, 300)
  if (!packageId || !expectedOpportunityId || !expectedCandidateKey) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_CONTEXT_REQUIRED"), 400)
  }
  try {
    const runtime = ebayDraftOnlyRuntimeStatus()
    const target = runtime.target
    const fingerprint = runtime.accountFingerprint || ""
    const supabase = getSupabaseAdminClient()
    const expectedContext: EbayListingContextIdentityV1 = {
      marketplaceId: "EBAY_US",
      listingPackageId: packageId,
      opportunityId: expectedOpportunityId,
      candidateKey: expectedCandidateKey,
    }
    const { data: packageIdentity, error: packageIdentityError } = await supabase
      .from("ebay_listing_packages")
      .select("id,opportunity_id,candidate_key")
      .eq("id", packageId)
      .eq("created_by", auth.actor)
      .maybeSingle()
    if (packageIdentityError || !packageIdentity) {
      throw new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND")
    }
    assertListingPackageContextV1({
      expected: expectedContext,
      listingPackage: packageIdentity,
    })
    const { data: latestApproval, error: approvalError } = await supabase
      .from("ebay_draft_only_approvals")
      .select("id,listing_package_id,opportunity_id,candidate_key,status,target,payload_hash,approved_at,expires_at,consumed_at,revoked_at,approved_payload")
      .eq("listing_package_id", packageId)
      .eq("actor_user_id", auth.actor)
      .eq("target", target)
      .eq("account_fingerprint", fingerprint || "__unconfigured__")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (approvalError) throw new Error("EBAY_DRAFT_ONLY_APPROVAL_READ_FAILED")
    const approvedPayload = record(latestApproval?.approved_payload)
    const initialContext = await loadPackageContext(
      supabase,
      packageId,
      auth.actor,
      "",
      target,
      fingerprint,
      latestApproval?.id,
      true,
    )
    const packageConfig = record(initialContext.listingPackage.package_data).draftConfiguration
    const requestedConfiguration = latestApproval
      ? configurationFromApprovedPayload(approvedPayload)
      : record(packageConfig)
    const sku = text(record(requestedConfiguration).sku)
    const context = sku
      ? await loadPackageContext(
        supabase,
        packageId,
        auth.actor,
        sku,
        target,
        fingerprint,
        latestApproval?.id,
        true,
      )
      : initialContext
    const visualPublicationGate = await loadFinalListingReviewPublicationGate({
      supabase,
      listingPackageId: packageId,
      actorId: auth.actor,
    })
    const liveTaxonomy = await loadLivePackageTaxonomy(context.listingPackage)
    const draftConfiguration = bindServerPublicationContracts(
      serverApprovedConfiguration(
        record(requestedConfiguration),
        context.listingPackage,
        context.opportunity,
        auth.actor,
        new Date(),
        false,
        visualPublicationGate,
        liveTaxonomy,
      ),
      context,
    )
    const readiness = evaluateEbayDraftOnlyReadiness({
      ...context,
      draftConfiguration: record(draftConfiguration),
      target,
      accountFingerprint: fingerprint,
    })
    const oneClickEligible = target === "PRODUCTION"
      && Boolean(context.smartStockingPublicationAuthorization)
    const oneClickValidation = latestApproval
      && hasOneClickControlledPublicationIntent(approvedPayload)
      ? validateOneClickControlledPublicationIntentV1({
        approvedPayload,
        actorUserId: auth.actor,
        listingPackage: context.listingPackage,
        opportunity: context.opportunity,
        accountFingerprint: runtime.accountFingerprint,
      })
      : null
    const { data: ledger, error: ledgerError } = latestApproval?.id
      ? await supabase
        .from("ebay_draft_only_execution_ledger")
        .select("id,approval_id,listing_package_id,opportunity_id,phase,sku,target,offer_id,completed_at,last_error_code,updated_at")
        .eq("approval_id", latestApproval.id)
        .maybeSingle()
      : { data: null, error: null }
    if (ledgerError) throw new Error("EBAY_DRAFT_ONLY_LEDGER_READ_FAILED")
    const { data: publication, error: publicationError } = ledger?.id
      ? await supabase
        .from("ebay_authorized_listing_publications")
        .select("id,draft_execution_id,listing_package_id,opportunity_id,phase,offer_id,sku,preview_hash,preview,listing_id,publish_http_status,published_at,verified_active_at,monitor_registered_at,last_error_code,updated_at")
        .eq("draft_execution_id", ledger.id)
        .maybeSingle()
      : { data: null, error: null }
    if (publicationError) throw new Error("EBAY_FINAL_PUBLICATION_READ_FAILED")
    assertLifecycleStateContextV1({
      expected: expectedContext,
      approval: latestApproval,
      execution: ledger,
      publication,
    })
    return NextResponse.json({
      success: true,
      visualPublicationGate,
      readiness,
      approval: latestApproval ? { ...latestApproval, approved_payload: undefined } : null,
      execution: ledger,
      publication,
      runtime,
      controlledPublication: {
        eligible: oneClickEligible,
        authorized: oneClickValidation?.valid === true,
        blocker: oneClickValidation?.blocker ?? null,
        version: oneClickValidation?.valid
          ? EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION
          : null,
        ...oneClickPublicationRequirements(oneClickEligible),
      },
      approvalRequirements: {
        exactPhrase: ebayDraftOnlyApprovalPhrase(target),
        oneClickExactIntent: EBAY_ONE_CLICK_PUBLICATION_LABEL,
        singleHumanPublicationEligible: oneClickEligible,
        target,
        productionAccountConfirmationRequired: target === "PRODUCTION",
        oneTime: true,
        expires: true,
        serverDerivedEvidence: [
          "image approval actor and timestamp",
          "approved URLs from the saved package",
          "category tree version and aspect constraints from live eBay Taxonomy",
          "live eBay SKU absence immediately before the first PUT",
        ],
      },
      publicationRequirements: {
        exactConfirmPublish: EBAY_FINAL_PUBLISH_CONFIRMATION,
        finalPreviewRequired: true,
        productionAccountConfirmationRequired: true,
        publishOfferCallsAllowed: 1,
        promotionsAllowed: false,
        volumePricingAllowed: false,
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  if (!auth.actor) return jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403)
  let body: JsonRecord
  try {
    body = record(await req.json())
  } catch {
    return jsonError(new Error("EBAY_DRAFT_ONLY_JSON_INVALID"), 400)
  }
  const action = text(body.action)
  try {
    if (action === "taxonomy_preflight") {
      return taxonomyPreflight(body, auth.actor)
    }
    if (action === "confirm_product_truth_evidence") {
      return confirmProductTruthEvidence(body, auth.actor)
    }
    if (action === "preview") return previewDraft(body, auth.actor)
    if (action === "preflight") return preflightDraft(body, auth.actor)
    if (action === "account_preflight") return preflightAccount(body, auth.actor)
    if (action === "approve") return approveDraft(body, auth.actor)
    if (action === "execute") return executeDraft(body, auth.actor)
    if (action === "prepare_publish") return prepareFinalPublication(body, auth.actor)
    if (action === "publish") return publishFinalPublication(body, auth.actor)
    if (action === "rearm_publish") return rearmFinalPublication(body, auth.actor)
    if (action === "reconcile_publish") return reconcileFinalPublication(body, auth.actor)
    if (action === "revoke") return revokeApproval(body, auth.actor)
    return jsonError(new Error("EBAY_DRAFT_ONLY_ACTION_INVALID"), 400)
  } catch (error) {
    return jsonError(error)
  }
}

async function confirmProductTruthEvidence(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  const expectedOpportunityId = uuid(body.opportunityId)
  const expectedCandidateKey = text(body.candidateKey).slice(0, 300)
  const aspectName = text(body.aspectName).slice(0, 120)
  const normalizedValue = text(body.normalizedValue).slice(0, 500)
  const evidenceStatement = text(body.evidenceStatement).slice(0, 500)
  if (
    !packageId || !expectedOpportunityId || !expectedCandidateKey
    || !aspectName || !normalizedValue || evidenceStatement.length < 12
    || body.confirmEvidence !== true
  ) return jsonError(new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_INVALID"), 400)

  const sellerAccountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!sellerAccountKey) {
    return jsonError(new Error(
      "EBAY_DRAFT_ONLY_PACKAGE_ACCOUNT_SCOPE_REQUIRED",
    ), 503)
  }
  const supabase = getSupabaseAdminClient()
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("id,account_key,opportunity_id,candidate_key,created_by,status,readiness,source_observed_at,updated_at,package_data")
    .eq("id", packageId)
    .eq("created_by", actor)
    .eq("account_key", sellerAccountKey)
    .maybeSingle()
  if (packageError || !listingPackage) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND"), 404)
  }
  const context: EbayListingContextIdentityV1 = {
    marketplaceId: "EBAY_US",
    listingPackageId: packageId,
    opportunityId: expectedOpportunityId,
    candidateKey: expectedCandidateKey,
  }
  assertListingPackageContextV1({ expected: context, listingPackage })
  if (!["draft", "ready_for_review"].includes(text(listingPackage.status))) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_PACKAGE_STATUS_INVALID",
    ), 409)
  }

  const packageData = record(listingPackage.package_data)
  const categoryId = text(packageData.categoryId)
  const persistedPreflight = record(packageData.taxonomyPreflight)
  assertTaxonomySnapshotContextV1({
    expected: context,
    taxonomyPreflight: persistedPreflight,
    categoryId,
  })
  const unresolvedRequired = Array.isArray(
    persistedPreflight.unprovenRequiredAspectNames,
  ) ? persistedPreflight.unprovenRequiredAspectNames.map(text) : []
  if (!unresolvedRequired.some((name) =>
    name.toLocaleLowerCase("en-US") === aspectName.toLocaleLowerCase("en-US"))) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_REQUIRED_ASPECT_NOT_BLOCKED",
    ), 409)
  }

  const taxonomy = await getEbayTaxonomyListingIntelligence(
    text(packageData.title).slice(0, 350),
    categoryId,
    { allowTitleSuggestionFallback: false },
  )
  if (taxonomy.status !== "AVAILABLE") {
    return NextResponse.json({
      success: false,
      error: taxonomy.failureCode ?? "EBAY_LISTING_TAXONOMY_FETCH_FAILED",
      taxonomy,
      safety: { ebayWriteUsed: false, ebayResourceMethods: ["GET"] },
    }, { status: 502 })
  }
  const officialAspect = taxonomy.aspects.find((aspect) =>
    aspect.required
    && aspect.name.toLocaleLowerCase("en-US") ===
      aspectName.toLocaleLowerCase("en-US"))
  if (!officialAspect) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_OFFICIAL_REQUIRED_ASPECT_MISMATCH",
    ), 409)
  }

  const { data: sourceOpportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", expectedOpportunityId)
    .eq("candidate_key", expectedCandidateKey)
    .maybeSingle()
  if (opportunityError || !sourceOpportunity) {
    return jsonError(new Error(
      "EBAY_LISTING_TAXONOMY_PRODUCT_TRUTH_REQUIRED",
    ), 409)
  }

  const confirmedAt = new Date().toISOString()
  const evidence = buildHumanConfirmedProductTruthEvidenceV1({
    opportunity: sourceOpportunity as JsonRecord,
    listingPackageId: packageId,
    marketplaceId: "EBAY_US",
    actorId: actor,
    aspect: {
      name: officialAspect.name,
      required: officialAspect.required,
      mode: officialAspect.mode ?? "FREE_TEXT",
      valuesComplete: officialAspect.valuesComplete,
      values: officialAspect.values,
    },
    normalizedValue,
    evidenceStatement,
    confirmedAt,
  })
  const applied = applyHumanConfirmedProductTruthEvidenceV1({
    opportunity: sourceOpportunity as JsonRecord,
    evidence,
  })
  const { data: updatedOpportunity, error: updateError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .update({ assessment: applied.assessment, updated_at: confirmedAt })
    .eq("id", expectedOpportunityId)
    .eq("candidate_key", expectedCandidateKey)
    .eq("updated_at", sourceOpportunity.updated_at)
    .select("*")
    .maybeSingle()
  if (updateError || !updatedOpportunity) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_EVIDENCE_STALE_VERSION",
    ), 409)
  }
  const durableValues = humanConfirmedProductTruthValuesV1(
    updatedOpportunity as JsonRecord,
  )
  if (durableValues[officialAspect.name] !== evidence.normalizedValue) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_EVIDENCE_READBACK_MISMATCH",
    ), 502)
  }

  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: updatedOpportunity as JsonRecord,
    packageData,
  })
  const preflight = buildEbayListingTaxonomyPreflightV1({
    taxonomy,
    expectedCategoryId: categoryId,
    context,
    existingAspects: record(packageData.aspects),
    provenProductValues: productTruth.provenProductValues,
    knownUnknownAspectNames: productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements:
      productTruth.unprovenAspectEvidenceRequirements,
  })
  if (
    text(preflight.resolvedAspects[officialAspect.name]) !==
      evidence.normalizedValue
    || preflight.unprovenRequiredAspectNames.some((name) =>
      name.toLocaleLowerCase("en-US") ===
        officialAspect.name.toLocaleLowerCase("en-US"))
  ) return jsonError(new Error(
    "HUMAN_PRODUCT_TRUTH_TAXONOMY_BINDING_FAILED",
  ), 502)

  const nextPackageData = {
    ...packageData,
    categoryName: taxonomy.categoryName ?? packageData.categoryName,
    aspects: preflight.resolvedAspects,
    taxonomyPreflight: preflight,
  }
  const { data: savedData, error: saveError } = await supabase.rpc(
    "ebay_save_listing_package_guarded",
    {
      p_package_id: listingPackage.id,
      p_account_key: sellerAccountKey,
      p_actor: actor,
      p_opportunity_id: listingPackage.opportunity_id,
      p_candidate_key: listingPackage.candidate_key,
      p_operation: "save",
      p_package_patch: nextPackageData,
      p_status: listingPackage.status,
      p_readiness: listingPackage.readiness,
      p_source_observed_at: listingPackage.source_observed_at,
      p_expected_updated_at: listingPackage.updated_at,
    },
  )
  const saved = Array.isArray(savedData)
    ? record(savedData[0]) : record(savedData)
  if (saveError || !uuid(saved.id)) {
    const code = databaseExceptionCode(
      saveError,
      "HUMAN_PRODUCT_TRUTH_PACKAGE_SAVE_FAILED",
    )
    return jsonError(new Error(code), code.includes("STALE_VERSION") ? 409 : 502)
  }
  const readback = record(record(saved.package_data).taxonomyPreflight)
  assertTaxonomySnapshotContextV1({
    expected: context,
    taxonomyPreflight: readback,
    categoryId,
  })
  const unprovenReadback = Array.isArray(
    readback.unprovenRequiredAspectNames,
  ) ? readback.unprovenRequiredAspectNames : null
  const durableReadbackMatch = text(readback.evidenceDigest)
    === preflight.evidenceDigest
    && text(record(readback.resolvedAspects)[officialAspect.name])
      === evidence.normalizedValue
    && unprovenReadback !== null
    && !unprovenReadback.some((name) =>
        text(name).toLocaleLowerCase("en-US") ===
          officialAspect.name.toLocaleLowerCase("en-US"))
  if (!durableReadbackMatch) {
    return jsonError(new Error(
      "HUMAN_PRODUCT_TRUTH_PACKAGE_READBACK_MISMATCH",
    ), 502)
  }

  return NextResponse.json({
    success: true,
    evidence,
    taxonomy,
    preflight,
    listingPackage: saved,
    durableReadbackMatch,
    unresolvedRequiredAspectNames: preflight.unprovenRequiredAspectNames,
    safety: {
      ebayWriteUsed: false,
      ebayResourceMethods: ["GET"],
      internalProductTruthWrite: true,
      internalPackageWrite: true,
      canPublish: false,
    },
  })
}

async function taxonomyPreflight(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  const expectedOpportunityId = uuid(body.opportunityId)
  const expectedCandidateKey = text(body.candidateKey).slice(0, 300)
  if (!packageId || !expectedOpportunityId || !expectedCandidateKey) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_REQUIRED"), 400)
  }
  const sellerAccountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!sellerAccountKey) {
    return jsonError(new Error(
      "EBAY_DRAFT_ONLY_PACKAGE_ACCOUNT_SCOPE_REQUIRED",
    ), 503)
  }
  const supabase = getSupabaseAdminClient()
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("id,account_key,opportunity_id,candidate_key,created_by,status,readiness,source_observed_at,updated_at,package_data")
    .eq("id", packageId)
    .eq("created_by", actor)
    .eq("account_key", sellerAccountKey)
    .maybeSingle()
  if (packageError || !listingPackage) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND"), 404)
  }
  const context: EbayListingContextIdentityV1 = {
    marketplaceId: "EBAY_US",
    listingPackageId: packageId,
    opportunityId: expectedOpportunityId,
    candidateKey: expectedCandidateKey,
  }
  assertListingPackageContextV1({ expected: context, listingPackage })
  if (!["draft", "ready_for_review"].includes(text(listingPackage.status))) {
    return jsonError(new Error(
      "EBAY_LISTING_TAXONOMY_PACKAGE_STATUS_INVALID",
    ), 409)
  }

  const packageData = record(listingPackage.package_data)
  const categoryId = text(packageData.categoryId)
  if (!/^\d{1,12}$/.test(categoryId)) {
    return jsonError(new Error(
      "EBAY_LISTING_TAXONOMY_CATEGORY_REQUIRED",
    ), 409)
  }
  const taxonomy = await getEbayTaxonomyListingIntelligence(
    text(packageData.title).slice(0, 350),
    categoryId,
    { allowTitleSuggestionFallback: false },
  )
  if (taxonomy.status !== "AVAILABLE") {
    return NextResponse.json({
      success: false,
      error: taxonomy.failureCode ?? "EBAY_LISTING_TAXONOMY_FETCH_FAILED",
      taxonomy,
      safety: {
        ebayWriteUsed: false,
        ebayResourceMethods: ["GET"],
        canPublish: false,
      },
    }, { status: 502 })
  }

  const { data: sourceOpportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", expectedOpportunityId)
    .eq("candidate_key", expectedCandidateKey)
    .maybeSingle()
  if (opportunityError || !sourceOpportunity) {
    return jsonError(new Error(
      "EBAY_LISTING_TAXONOMY_PRODUCT_TRUTH_REQUIRED",
    ), 409)
  }
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: sourceOpportunity as JsonRecord,
    packageData,
  })
  const preflight = buildEbayListingTaxonomyPreflightV1({
    taxonomy,
    expectedCategoryId: categoryId,
    context,
    existingAspects: record(packageData.aspects),
    provenProductValues: productTruth.provenProductValues,
    knownUnknownAspectNames: productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements:
      productTruth.unprovenAspectEvidenceRequirements,
  })
  const nextPackageData = {
    ...packageData,
    categoryName: taxonomy.categoryName ?? packageData.categoryName,
    aspects: preflight.resolvedAspects,
    taxonomyPreflight: preflight,
  }
  const { data: savedData, error: saveError } = await supabase.rpc(
    "ebay_save_listing_package_guarded",
    {
      p_package_id: listingPackage.id,
      p_account_key: sellerAccountKey,
      p_actor: actor,
      p_opportunity_id: listingPackage.opportunity_id,
      p_candidate_key: listingPackage.candidate_key,
      p_operation: "save",
      p_package_patch: nextPackageData,
      p_status: listingPackage.status,
      p_readiness: listingPackage.readiness,
      p_source_observed_at: listingPackage.source_observed_at,
      p_expected_updated_at: listingPackage.updated_at,
    },
  )
  const saved = Array.isArray(savedData)
    ? record(savedData[0]) : record(savedData)
  if (saveError || !uuid(saved.id)) {
    const code = databaseExceptionCode(
      saveError,
      "EBAY_LISTING_TAXONOMY_PREFLIGHT_SAVE_FAILED",
    )
    return jsonError(new Error(code), code.includes("STALE_VERSION") ? 409 : 502)
  }
  const readback = record(record(saved.package_data).taxonomyPreflight)
  assertTaxonomySnapshotContextV1({
    expected: context,
    taxonomyPreflight: readback,
    categoryId,
  })
  const durableReadbackMatch = text(readback.evidenceDigest)
    === preflight.evidenceDigest
    && text(readback.categoryId) === categoryId
    && text(readback.status) === "CONSULTADO"
    && exactTextRecordMatch(
      readback.resolvedAspects,
      preflight.resolvedAspects,
    )
    && JSON.stringify(readback.unprovenRequiredAspectNames)
      === JSON.stringify(preflight.unprovenRequiredAspectNames)
  if (!durableReadbackMatch) {
    return jsonError(new Error(
      "EBAY_LISTING_TAXONOMY_PREFLIGHT_READBACK_MISMATCH",
    ), 502)
  }

  return NextResponse.json({
    success: true,
    taxonomy,
    preflight,
    listingPackage: saved,
    durableReadbackMatch,
    unresolvedRequiredAspectNames: preflight.unprovenRequiredAspectNames,
    unprovenAspectEvidenceRequirements:
      preflight.unprovenAspectEvidenceRequirements,
    safety: {
      ebayWriteUsed: false,
      ebayResourceMethods: ["GET"],
      internalPackageWrite: true,
      canPublish: false,
    },
  })
}

async function preflightDraft(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  if (!packageId) return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_REQUIRED"), 400)
  const supabase = getSupabaseAdminClient()
  const sellerAccountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!sellerAccountKey) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_ACCOUNT_SCOPE_REQUIRED"), 503)
  }
  const { data: listingPackage, error } = await supabase
    .from("ebay_listing_packages")
    .select("id")
    .eq("id", packageId)
    .eq("created_by", actor)
    .eq("account_key", sellerAccountKey)
    .maybeSingle()
  if (error || !listingPackage) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND"), 404)
  }
  return preflightAccountConfiguration(body, actor, supabase, sellerAccountKey)
}

async function preflightAccount(body: JsonRecord, actor: string) {
  const supabase = getSupabaseAdminClient()
  const sellerAccountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!sellerAccountKey) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_ACCOUNT_SCOPE_REQUIRED"), 503)
  }
  return preflightAccountConfiguration(body, actor, supabase, sellerAccountKey)
}

async function preflightAccountConfiguration(
  body: JsonRecord,
  actor: string,
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  sellerAccountKey: string,
) {
  const requested = record(body.selection)
  const preflight = await preflightEbayDraftOnlyMobile({
    fulfillmentPolicyId: text(requested.fulfillmentPolicyId),
    paymentPolicyId: text(requested.paymentPolicyId),
    returnPolicyId: text(requested.returnPolicyId),
    merchantLocationKey: text(requested.merchantLocationKey),
  })
  const accountPolicyProfileSaved = await saveVerifiedEbayAccountPolicyProfile({
    supabase,
    accountKey: sellerAccountKey,
    actorUserId: actor,
    preflight,
  })
  return NextResponse.json({
    success: true,
    preflight,
    accountPolicyProfileSaved,
    runtime: ebayDraftOnlyRuntimeStatus(),
    safety: {
      ebayWriteUsed: false,
      ebayResourceMethods: ["GET"],
      oauthTokenExchangeMethod: "POST",
      ebayWriteMethods: [],
      canPublish: false,
      target: preflight.target,
    },
  })
}

async function revokeApproval(body: JsonRecord, actor: string) {
  const approvalId = uuid(body.approvalId)
  if (!approvalId) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_REQUIRED"), 400)
  const now = new Date().toISOString()
  const supabase = getSupabaseAdminClient()
  const { data, error } = await supabase
    .from("ebay_draft_only_approvals")
    .update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("id", approvalId)
    .eq("actor_user_id", actor)
    .eq("status", "approved")
    .select("id,status,target,revoked_at")
    .maybeSingle()
  if (error || !data) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_REVOCABLE"), 409)
  }
  return NextResponse.json({
    success: true,
    approval: data,
    safety: { ebayWriteUsed: false, canPublish: false, target: data.target },
  })
}

async function previewDraft(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  if (!packageId) return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_REQUIRED"), 400)
  const runtime = ebayDraftOnlyRuntimeStatus()
  const target = runtime.target
  const fingerprint = runtime.accountFingerprint || ""
  const requestedConfiguration = record(body.draftConfiguration)
  const supabase = getSupabaseAdminClient()
  const context = await loadPackageContext(
    supabase,
    packageId,
    actor,
    text(requestedConfiguration.sku),
    target,
    fingerprint,
  )
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: packageId,
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  const now = new Date()
  const liveTaxonomy = await loadLivePackageTaxonomy(context.listingPackage)
  const draftConfiguration = bindServerPublicationContracts(
    serverApprovedConfiguration(
      requestedConfiguration,
      context.listingPackage,
      context.opportunity,
      actor,
      now,
      body.confirmImagesAuthorized === true,
      visualPublicationGate,
      liveTaxonomy,
    ),
    context,
  )
  const readiness = evaluateEbayDraftOnlyReadiness({
    ...context,
    draftConfiguration,
    target,
    accountFingerprint: fingerprint,
  })
  return NextResponse.json({
    success: true,
    readiness,
    taxonomy: liveTaxonomy,
    runtime,
    controlledPublication: {
      eligible: target === "PRODUCTION"
        && Boolean(context.smartStockingPublicationAuthorization),
      authorized: false,
      blocker: null,
      version: EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION,
      ...oneClickPublicationRequirements(target === "PRODUCTION"
        && Boolean(context.smartStockingPublicationAuthorization)),
    },
    approvalRequirements: {
      exactPhrase: ebayDraftOnlyApprovalPhrase(target),
      oneClickExactIntent: EBAY_ONE_CLICK_PUBLICATION_LABEL,
      singleHumanPublicationEligible: target === "PRODUCTION"
        && Boolean(context.smartStockingPublicationAuthorization),
      target,
      productionAccountConfirmationRequired: target === "PRODUCTION",
    },
    safety: { ebayWriteUsed: false, canPublish: false, target },
  })
}

async function approveDraft(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  const approvalKey = idempotencyKey(body.idempotencyKey)
  if (!packageId || !approvalKey) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_INPUT_INVALID"), 400)
  const runtime = ebayDraftOnlyRuntimeStatus()
  const target = runtime.target
  const fingerprint = runtime.accountFingerprint || ""
  const oneClickRequested = text(body.authorizationMode) ===
    EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION
  const explicitApprovalValid = oneClickRequested
    ? target === "PRODUCTION"
      && text(body.confirmation) === EBAY_ONE_CLICK_PUBLICATION_LABEL
      && text(body.confirmTarget) === "PRODUCTION"
      && body.confirmControlledPublication === true
      && body.confirmExactPayload === true
      && body.confirmProductionAccount === true
      && text(body.authorizationSurface) ===
        EBAY_ONE_CLICK_PUBLICATION_SURFACE
    : text(body.confirmation) === ebayDraftOnlyApprovalPhrase(target)
      && text(body.confirmTarget) === target
      && body.confirmUnpublishedOnly === true
      && body.confirmNoPublish === true
      && body.confirmImagesAuthorized === true
      && (target !== "PRODUCTION" || body.confirmProductionAccount === true)
  if (!explicitApprovalValid) {
    return jsonError(new Error(
      oneClickRequested
        ? "EBAY_ONE_CLICK_PUBLICATION_EXPLICIT_INTENT_REQUIRED"
        : "EBAY_DRAFT_ONLY_EXPLICIT_APPROVAL_REQUIRED",
    ), 409)
  }
  const requestedConfiguration = record(body.draftConfiguration)
  const supabase = getSupabaseAdminClient()
  const context = await loadPackageContext(
    supabase,
    packageId,
    actor,
    text(requestedConfiguration.sku),
    target,
    fingerprint,
  )
  if (oneClickRequested && !context.smartStockingPublicationAuthorization) {
    return jsonError(new Error(
      "EBAY_ONE_CLICK_PUBLICATION_SMART_STOCKING_AUTHORITY_REQUIRED",
    ), 409)
  }
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: packageId,
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  const now = new Date()
  const liveTaxonomy = await loadLivePackageTaxonomy(context.listingPackage)
  const draftConfiguration = bindServerPublicationContracts(
    serverApprovedConfiguration(
      requestedConfiguration,
      context.listingPackage,
      context.opportunity,
      actor,
      now,
      oneClickRequested || body.confirmImagesAuthorized === true,
      visualPublicationGate,
      liveTaxonomy,
    ),
    context,
  )
  const readiness = evaluateEbayDraftOnlyReadiness({
    ...context,
    draftConfiguration,
    target,
    accountFingerprint: fingerprint,
  })
  if (!readiness.ready) return jsonError(new Error("EBAY_DRAFT_ONLY_BLOCKED"), 409, readiness.blockers)
  const approvedPayload = oneClickRequested
    ? bindOneClickControlledPublicationIntentV1({
      approvedPayload: readiness.payload,
      actorUserId: actor,
      listingPackage: context.listingPackage,
    })
    : readiness.payload
  const approvedPayloadHash = hashEbayDraftOnlyPayload(approvedPayload)
  const { data: approval, error } = await supabase
    .rpc("approve_ebay_draft_only_package", {
      p_listing_package_id: packageId,
      p_opportunity_id: context.listingPackage.opportunity_id,
      p_candidate_key: context.listingPackage.candidate_key,
      p_actor_user_id: actor,
      p_payload_hash: approvedPayloadHash,
      p_approved_payload: approvedPayload,
      p_idempotency_key: approvalKey,
      p_expires_at: approvalExpiresAt(now),
      p_target: target,
      p_account_fingerprint: fingerprint,
    })
    .single()
  if (error) {
    const { data: existing } = await supabase
      .from("ebay_draft_only_approvals")
      .select("id,status,target,payload_hash,approved_at,expires_at,actor_user_id")
      .eq("approval_idempotency_key", approvalKey)
      .maybeSingle()
    if (existing?.actor_user_id === actor && existing.payload_hash === approvedPayloadHash) {
      return NextResponse.json({
        success: true,
        approval: existing,
        idempotentReplay: true,
        controlledPublication: {
          eligible: oneClickRequested,
          authorized: oneClickRequested,
          version: oneClickRequested
            ? EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION
            : null,
          ...oneClickPublicationRequirements(oneClickRequested),
        },
        safety: { canPublish: false, target },
      })
    }
    return jsonError(new Error("EBAY_DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS"), 409)
  }
  return NextResponse.json({
    success: true,
    approval: {
      id: record(approval).id,
      status: record(approval).status,
      payload_hash: record(approval).payload_hash,
      approved_at: record(approval).approved_at,
      expires_at: record(approval).expires_at,
    },
    readiness: { ready: true, blockers: [], payloadHash: approvedPayloadHash },
    controlledPublication: {
      eligible: oneClickRequested,
      authorized: oneClickRequested,
      version: oneClickRequested
        ? EBAY_ONE_CLICK_CONTROLLED_PUBLICATION_VERSION
        : null,
      ...oneClickPublicationRequirements(oneClickRequested),
    },
    safety: {
      approvedForOneUnpublishedDraft: true,
      machineContinuationToOneShotPublishAuthorized: oneClickRequested,
      finalMachinePreflightRequired: true,
      canPublish: false,
      target,
    },
  }, { status: 201 })
}

async function executeDraft(body: JsonRecord, actor: string) {
  const approvalId = uuid(body.approvalId)
  const executionKey = idempotencyKey(body.idempotencyKey)
  if (!approvalId || !executionKey) return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_INPUT_INVALID"), 400)
  const supabase = getSupabaseAdminClient()
  const { data: approval, error: approvalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (approvalError || !approval) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_FOUND"), 404)
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: text(approval.listing_package_id),
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  const runtime = ebayDraftOnlyRuntimeStatus()
  const target = runtime.target
  const fingerprint = runtime.accountFingerprint || ""
  if (approval.target !== target || approval.account_fingerprint !== fingerprint) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_TARGET_MISMATCH"), 409)
  }
  const { data: existing, error: existingError } = await supabase
    .from("ebay_draft_only_execution_ledger")
    .select("*")
    .eq("approval_id", approvalId)
    .maybeSingle()
  if (existingError) throw new Error("EBAY_DRAFT_ONLY_LEDGER_READ_FAILED")
  const approvedPayload = record(approval.approved_payload)
  const approvedOfferPayload = record(approvedPayload.offerPayload)
  const approvedSku = text(approvedPayload.sku)
  if (existing && existing.idempotency_key !== executionKey) return jsonError(new Error("EBAY_DRAFT_ONLY_IDEMPOTENCY_MISMATCH"), 409)
  if (existing?.phase === "completed") return NextResponse.json({
    success: true,
    idempotentReplay: true,
    draft: {
      offerId: existing.offer_id,
      sku: existing.sku,
      verification: "UNPUBLISHED_VERIFIED_AT_CREATE",
      verifiedAt: existing.completed_at ?? null,
      target: existing.target,
    },
    safety: { pointInTimeStatusOnly: true, canPublish: false },
  })
  if (
    existing?.phase === "offer_create_in_flight"
    && Date.parse(text(existing.lease_expires_at)) > Date.now()
  ) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_BUSY"), 409)
  }
  if (['offer_create_in_flight', 'offer_outcome_unknown'].includes(existing?.phase)) {
    let verification = existing.offer_id
      ? await verifyEbayUnpublishedOffer(
        text(existing.offer_id),
        approvedSku,
        text(approvedOfferPayload.marketplaceId),
        approvedOfferPayload,
      )
      : await discoverEbayUnpublishedOfferBySku(approvedSku, approvedOfferPayload)
    const quarantinedOfferId = sanitizeEbayOfferId(verification.offerId)
    const ledgerId = uuid(existing.id)
    if (!quarantinedOfferId || !ledgerId) {
      await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: "offer_outcome_unknown",
        last_error_code: verification.blocker,
        sanitized_result: {
          verifiedStatus: verification.status,
          listingPresent: verification.listingPresent,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).in("phase", ["offer_create_in_flight", "offer_outcome_unknown"])
      return jsonError(
        new Error(verification.blocker),
        verification.blocker === "EBAY_OFFER_PUBLICATION_SAFETY_INCIDENT" ? 409 : 503,
      )
    }
    if (!verification.safe) {
      await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: "offer_outcome_unknown",
        offer_id: quarantinedOfferId,
        last_error_code: verification.blocker,
        sanitized_result: {
          verifiedStatus: verification.status,
          listingPresent: verification.listingPresent,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", ledgerId).in("phase", ["offer_create_in_flight", "offer_outcome_unknown"])
      return jsonError(
        new Error(verification.blocker),
        verification.blocker === "EBAY_OFFER_PUBLICATION_SAFETY_INCIDENT" ? 409 : 503,
      )
    }
    if (existing.phase === "offer_create_in_flight") {
      const { error: quarantineError } = await supabase
        .from("ebay_draft_only_execution_ledger")
        .update({
          phase: "offer_outcome_unknown",
          offer_id: quarantinedOfferId,
          last_error_code: "EBAY_OFFER_RECONCILED_AFTER_IN_FLIGHT",
          updated_at: new Date().toISOString(),
        })
        .eq("id", ledgerId)
        .eq("phase", "offer_create_in_flight")
      if (quarantineError) {
        return jsonError(new Error("EBAY_DRAFT_ONLY_RECONCILIATION_PERSIST_FAILED"), 503)
      }
    }
    const { data: reconciled, error: reconciliationError } = await supabase
      .rpc("reconcile_ebay_draft_only_execution", {
        p_ledger_id: ledgerId,
        p_actor_user_id: actor,
        p_offer_id: quarantinedOfferId,
        p_offer_http_status: verification.httpStatus,
        p_verified_status: verification.status,
        p_listing_present: verification.listingPresent,
        p_verified_sku: verification.sku,
        p_verified_marketplace_id: verification.marketplaceId,
        p_target: target,
        p_account_fingerprint: fingerprint,
      })
      .single()
    if (reconciliationError || !reconciled) {
      return jsonError(new Error("EBAY_DRAFT_ONLY_RECONCILIATION_PERSIST_FAILED"), 503)
    }
    return NextResponse.json({
      success: true,
      reconciled: true,
      draft: {
        offerId: quarantinedOfferId,
        sku: existing.sku,
        verification: "UNPUBLISHED_VERIFIED_AT_RECONCILIATION",
        verifiedAt: record(reconciled).completed_at ?? new Date().toISOString(),
        target,
      },
      execution: reconciled,
      safety: {
        readOnlyReconciliation: true,
        postCreateStatusVerified: true,
        publishOfferCalled: false,
        canPublish: false,
      },
    })
  }
  if (existing?.phase === "inventory_outcome_unknown") {
    const ledgerId = uuid(existing.id)
    if (!ledgerId) throw new Error("EBAY_DRAFT_ONLY_LEDGER_ID_INVALID")
    const inventoryVerification = await verifyEbayDraftInventoryItem(
      approvedSku,
      record(approvedPayload.inventoryItemPayload),
    )
    if (!inventoryVerification.safe) {
      await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: "inventory_outcome_unknown",
        last_error_code: "EBAY_INVENTORY_OUTCOME_UNKNOWN",
        sanitized_result: {
          readStatus: inventoryVerification.httpStatus,
          visible: !inventoryVerification.absent,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", ledgerId).eq("phase", "inventory_outcome_unknown")
      return jsonError(new Error("EBAY_INVENTORY_OUTCOME_UNKNOWN"), 503)
    }
    const { data: inventoryReconciled, error: inventoryReconciliationError } = await supabase
      .from("ebay_draft_only_execution_ledger")
      .update({
        phase: "inventory_confirmed",
        inventory_http_status: inventoryVerification.httpStatus,
        inventory_confirmed_at: new Date().toISOString(),
        last_error_code: null,
        sanitized_result: { reconciledAfterUnknownPut: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", ledgerId)
      .eq("phase", "inventory_outcome_unknown")
      .select("id")
      .maybeSingle()
    if (inventoryReconciliationError || !inventoryReconciled) {
      return jsonError(new Error("EBAY_INVENTORY_RECONCILIATION_PERSIST_FAILED"), 503)
    }
    existing.phase = "inventory_confirmed"
    existing.lease_token = null
    existing.lease_expires_at = null
  }
  const existingPhase = text(existing?.phase)
  const inactiveRecoverablePhase = [
    "claimed",
    "retryable_inventory_failure",
    "inventory_confirmed",
  ].includes(existingPhase)
  const approvalExpired = Date.parse(approval.expires_at) <= Date.now()
  const approvalInactive = approval.status !== "approved"
    || Boolean(approval.consumed_at)
    || Boolean(approval.revoked_at)
    || approvalExpired
  if (
    existing
    && inactiveRecoverablePhase
    && Date.parse(text(existing.lease_expires_at)) > Date.now()
  ) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_BUSY"), 409)
  }
  if (existing && inactiveRecoverablePhase && approvalInactive) {
    const ledgerId = uuid(existing.id)
    if (!ledgerId) throw new Error("EBAY_DRAFT_ONLY_LEDGER_ID_INVALID")
    const skuState = await inspectEbayDraftSkuState(approvedSku)
    if (skuState.blocker === "EBAY_SKU_PREFLIGHT_REQUEST_REJECTED") {
      return jsonError(new Error(skuState.blocker), 409)
    }
    if (skuState.blocker === "EBAY_SKU_PREFLIGHT_UNAVAILABLE") {
      return jsonError(new Error("EBAY_DRAFT_ONLY_REAPPROVAL_STATE_UNAVAILABLE"), 503)
    }
    let nextPhase = "inventory_outcome_unknown"
    let nextCode = "EBAY_INVENTORY_REAPPROVAL_QUARANTINED"
    if (skuState.offerCount > 0) {
      nextPhase = "offer_outcome_unknown"
      nextCode = "EBAY_OFFER_REAPPROVAL_QUARANTINED"
    } else if (skuState.inventoryExists) {
      const inventoryVerification = await verifyEbayDraftInventoryItem(
        approvedSku,
        record(approvedPayload.inventoryItemPayload),
      )
      if (inventoryVerification.safe) {
        nextPhase = "terminal_failure"
        nextCode = "EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED"
      }
    } else if (
      skuState.inventoryAbsent
      && ["claimed", "retryable_inventory_failure"].includes(existingPhase)
    ) {
      nextPhase = "terminal_failure"
      nextCode = "EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED"
    }
    const nowIso = new Date().toISOString()
    const { data: released, error: releaseError } = await supabase
      .from("ebay_draft_only_execution_ledger")
      .update({
        phase: nextPhase,
        last_error_code: nextCode,
        sanitized_result: {
          reapprovalRequired: true,
          inventoryExists: skuState.inventoryExists,
          inventoryAbsent: skuState.inventoryAbsent,
          offerCount: skuState.offerCount,
        },
        lease_token: null,
        lease_expires_at: null,
        updated_at: nowIso,
      })
      .eq("id", ledgerId)
      .eq("phase", existingPhase)
      .or(`lease_expires_at.is.null,lease_expires_at.lte.${nowIso}`)
      .select("id")
      .maybeSingle()
    if (releaseError || !released) {
      return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_BUSY"), 409)
    }
    if (approvalExpired) {
      await supabase.from("ebay_draft_only_approvals").update({
        status: "expired",
        updated_at: nowIso,
      }).eq("id", approvalId).eq("status", "approved")
    }
    return jsonError(
      new Error(nextCode),
      nextPhase === "terminal_failure" ? 409 : 503,
    )
  }
  if (existing?.phase === "terminal_failure") return jsonError(new Error("EBAY_DRAFT_ONLY_TERMINAL_FAILURE"), 409)
  if (approval.status !== "approved" || approval.consumed_at || approval.revoked_at) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_ACTIVE"), 409)
  if (Date.parse(approval.expires_at) <= Date.now()) {
    await supabase.from("ebay_draft_only_approvals").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", approvalId).eq("status", "approved")
    return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_EXPIRED"), 409)
  }
  const draftConfiguration = configurationFromApprovedPayload(approvedPayload)
  const sku = text(draftConfiguration.sku)
  await retireSupersededPrewriteSkuPreflight({
    supabase,
    approvalId,
    sku,
    target,
    accountFingerprint: fingerprint,
  })
  let context = await loadPackageContext(
    supabase,
    approval.listing_package_id,
    actor,
    sku,
    target,
    fingerprint,
    approvalId,
  )
  const v3Binding = record(record(approvedPayload.compliance).v3FinalSetAuthorization)
  let revalidatedExecutionEvidence:
    NonNullable<Parameters<typeof evaluateEbayDraftOnlyReadiness>[0][
      "revalidatedExecutionEvidence"
    ]> | undefined
  if (Object.keys(v3Binding).length) {
    const transportId = uuid(v3Binding.imageTransportId)
    const transportHash = text(v3Binding.imageTransportHash)
    const finalPreviewHash = text(v3Binding.finalPreviewHash)
    if (
      !transportId
      || !/^[0-9a-f]{64}$/.test(transportHash)
      || !/^[0-9a-f]{64}$/.test(finalPreviewHash)
    ) return jsonError(new Error("EBAY_V3_AUTHORIZATION_BINDING_INVALID"), 409)
    const { data: transport, error: transportError } = await supabase
      .from("ebay_v3_publication_image_transports")
      .select("*")
      .eq("id", transportId)
      .eq("transport_hash", transportHash)
      .eq("preview_hash", finalPreviewHash)
      .eq("listing_package_id", approval.listing_package_id)
      .eq("status", "READY")
      .eq("image_count", 7)
      .eq("scope", "EBAY_US_UNPUBLISHED_OFFER_ONLY")
      .eq("created_by", actor)
      .maybeSingle()
    if (transportError || !transport) {
      return jsonError(new Error("EBAY_V3_PUBLICATION_TRANSPORT_NOT_CURRENT"), 409)
    }
    const assets = validateV3PublicationAssets(transport.assets)
    if (
      hashEbayDraftOnlyPayload(assets)
      !== hashEbayDraftOnlyPayload(v3Binding.selectedAssets)
    ) return jsonError(new Error("EBAY_V3_PUBLICATION_ASSET_BINDING_CHANGED"), 409)
    const imageAuthorization = record(draftConfiguration.imageAuthorization)
    const approvedImageUrls = Array.isArray(
      imageAuthorization.approvedImageUrls,
    )
      ? imageAuthorization.approvedImageUrls.map((value) => text(value))
      : []
    const sameDayAuthorization = record(
      context.sameDayPilotAuthorization,
    )
    const exactV3ExecutionEvidence =
      v3Binding.version
        === "EBAY_V3_FINAL_SET_UNPUBLISHED_AUTHORIZATION_V1"
      && imageAuthorization.approved === true
      && imageAuthorization.protectedManifestVerified === true
      && Number(imageAuthorization.protectedManifestAssetCount) === 7
      && text(imageAuthorization.approvedBy) === actor
      && Number.isFinite(Date.parse(text(imageAuthorization.approvedAt)))
      && approvedImageUrls.length === 7
      && approvedImageUrls.every((url, index) =>
        url === assets[index]?.url)
      && sameDayAuthorization.validated === true
      && text(sameDayAuthorization.listingPackageId)
        === text(approval.listing_package_id)
      && sameDayAuthorization.finalHumanAuthorizationRequired === true
      && sameDayAuthorization.unattendedPublicationAllowed === false
      && Number.isFinite(Date.parse(
        text(sameDayAuthorization.sourceObservedAt),
      ))
    if (!exactV3ExecutionEvidence) {
      return jsonError(
        new Error("EBAY_V3_EXECUTION_EVIDENCE_INVALID"),
        409,
      )
    }
    revalidatedExecutionEvidence = {
      freshSameDaySourceVerified: true,
      finalV3ImageTransportVerified: true,
    }
    context = {
      ...context,
      listingPackage: packageWithV3PublicationAssets(
        context.listingPackage,
        assets,
      ),
    }
  }
  const readiness = evaluateEbayDraftOnlyReadiness({
    ...context,
    draftConfiguration,
    target,
    accountFingerprint: fingerprint,
    revalidatedExecutionEvidence,
  })
  const rebuiltPayload = buildEbayDraftOnlyPayload(
    context.listingPackage,
    context.opportunity,
    draftConfiguration,
    target,
    fingerprint,
    context.economicsConfig,
    context.sameDayPilotAuthorization,
    context.smartStockingPublicationAuthorization,
  )
  const currentBasePayload = Object.keys(v3Binding).length
    ? withV3FinalSetAuthorization(rebuiltPayload, v3Binding)
    : rebuiltPayload
  const oneClickIntentPresent = hasOneClickControlledPublicationIntent(
    approvedPayload,
  )
  if (oneClickIntentPresent) {
    assertOneClickControlledPublicationIntentV1({
      approvedPayload,
      actorUserId: actor,
      listingPackage: context.listingPackage,
      opportunity: context.opportunity,
      accountFingerprint: fingerprint,
    })
  }
  const currentPayload = oneClickIntentPresent
    ? bindOneClickControlledPublicationIntentV1({
      approvedPayload: currentBasePayload,
      actorUserId: actor,
      listingPackage: context.listingPackage,
    })
    : currentBasePayload
  const currentHash = hashEbayDraftOnlyPayload(currentPayload)
  if (!readiness.ready || currentHash !== approval.payload_hash) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED"), 409, [
      ...readiness.blockers,
      ...(currentHash !== approval.payload_hash ? ["APPROVED_PAYLOAD_CHANGED"] : []),
    ])
  }
  if (!runtime.enabled || !runtime.configured) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_RUNTIME_DISABLED"), 409)
  }

  const businessPolicies = record(draftConfiguration.businessPolicies)
  const dependencyPreflight = await preflightEbayDraftDependencies({
    merchantLocationKey: text(draftConfiguration.merchantLocationKey),
    fulfillmentPolicyId: text(businessPolicies.fulfillmentPolicyId),
    paymentPolicyId: text(businessPolicies.paymentPolicyId),
    returnPolicyId: text(businessPolicies.returnPolicyId),
    preflightSnapshot: text(draftConfiguration.ebayPreflightSnapshot),
  })
  if (!dependencyPreflight.safe) {
    const unavailable = dependencyPreflight.blocker === "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE"
    return jsonError(
      new Error(dependencyPreflight.blocker ?? "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE"),
      unavailable ? 503 : 409,
    )
  }

  const claimToken = randomUUID()
  const { data: claimedLedger, error: claimError } = await supabase
    .rpc("claim_ebay_draft_only_execution", {
      p_approval_id: approvalId,
      p_actor_user_id: actor,
      p_idempotency_key: executionKey,
      p_request_hash: currentHash,
      p_sku: sku,
      p_claim_token: claimToken,
      p_target: target,
      p_account_fingerprint: fingerprint,
    })
    .single()
  if (claimError || !claimedLedger) return jsonError(new Error("EBAY_DRAFT_ONLY_SKU_OR_EXECUTION_COLLISION"), 409)
  let ledger = claimedLedger as JsonRecord
  const ledgerId = uuid(ledger.id)
  if (!ledgerId) throw new Error("EBAY_DRAFT_ONLY_LEDGER_ID_INVALID")
  if (ledger.phase === "completed") return NextResponse.json({
    success: true,
    idempotentReplay: true,
    draft: {
      offerId: ledger.offer_id,
      sku: ledger.sku,
      verification: "UNPUBLISHED_VERIFIED_AT_CREATE",
      verifiedAt: ledger.completed_at ?? null,
      target: ledger.target,
    },
    safety: { pointInTimeStatusOnly: true, canPublish: false },
  })
  if (['offer_create_in_flight', 'offer_outcome_unknown'].includes(text(ledger.phase))) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_OFFER_RECONCILIATION_REQUIRED"), 409)
  }
  if (ledger.phase === "terminal_failure") return jsonError(new Error("EBAY_DRAFT_ONLY_TERMINAL_FAILURE"), 409)
  if (
    ['claimed', 'inventory_confirmed', 'retryable_inventory_failure'].includes(text(ledger.phase))
    && text(ledger.lease_token) !== claimToken
  ) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
  }

  if (ledger.phase === "claimed") {
    const preflight = await preflightEbayDraftSkuCollision(sku)
    if (!preflight.safe) {
      const ownedInventory = preflight.inventoryExists
        ? await verifyEbayDraftInventoryItem(
          sku,
          record(approvedPayload.inventoryItemPayload),
        )
        : null
      if (ownedInventory?.safe && preflight.offerCount === 0) {
        const { data: recovered, error: recoveryError } = await supabase
          .from("ebay_draft_only_execution_ledger")
          .update({
            phase: "inventory_confirmed",
            inventory_http_status: ownedInventory.httpStatus,
            inventory_confirmed_at: new Date().toISOString(),
            last_error_code: null,
            sanitized_result: { recoveredOwnedInventoryAfterCrash: true },
            updated_at: new Date().toISOString(),
          })
          .eq("id", ledgerId)
          .eq("lease_token", claimToken)
          .eq("phase", "claimed")
          .select("*")
          .single()
        if (recoveryError || !recovered) {
          return jsonError(new Error("EBAY_INVENTORY_RECOVERY_PERSIST_FAILED"), 503)
        }
        ledger = recovered as JsonRecord
      } else if (ownedInventory?.safe && preflight.offerCount > 0) {
        const { data: quarantined, error: quarantineError } = await supabase.from("ebay_draft_only_execution_ledger").update({
          phase: "offer_outcome_unknown",
          last_error_code: "EBAY_OFFER_DISCOVERED_AFTER_LEDGER_CRASH",
          sanitized_result: { offerCount: preflight.offerCount },
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", ledgerId).eq("lease_token", claimToken).eq("phase", "claimed").select("id").maybeSingle()
        if (quarantineError || !quarantined) {
          return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
        }
        return jsonError(new Error("EBAY_DRAFT_ONLY_OFFER_RECONCILIATION_REQUIRED"), 503)
      } else {
        const terminalPreflight = preflight.collision
          || preflight.requestRejected
        const { data: stopped, error: stopError } = await supabase.from("ebay_draft_only_execution_ledger").update({
          phase: terminalPreflight ? "terminal_failure" : "claimed",
          last_error_code: preflight.blocker,
          sanitized_result: {
            collision: preflight.collision,
            inventoryOwnershipVerified: false,
            inventoryHttpStatus: preflight.inventoryHttpStatus,
            offersHttpStatus: preflight.offersHttpStatus,
            inventoryReadAttempts: preflight.inventoryReadAttempts,
            offersReadAttempts: preflight.offersReadAttempts,
            inventoryErrorIds: preflight.inventoryErrorIds,
            offersErrorIds: preflight.offersErrorIds,
            inventoryErrors: preflight.inventoryErrors,
            offersErrors: preflight.offersErrors,
            offerResponseShape: preflight.offerResponseShape,
          },
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", ledgerId).eq("lease_token", claimToken).eq("phase", "claimed").select("id").maybeSingle()
        if (stopError || !stopped) {
          return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
        }
        return jsonError(
          new Error(preflight.blocker ?? "EBAY_SKU_PREFLIGHT_UNAVAILABLE"),
          terminalPreflight ? 409 : 503,
        )
      }
    }
  }

  if (ledger.phase === "claimed" || ledger.phase === "retryable_inventory_failure") {
    const inventoryResult = await createOrReplaceEbayDraftInventoryItem(
      sku,
      record(approvedPayload.inventoryItemPayload),
    )
    if (!inventoryResult.ok) {
      const unknown = !inventoryResult.outcomeKnown
      const retryable = inventoryResult.retryable && !unknown
      const { data: failedInventory, error: failedInventoryError } = await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: unknown
          ? "inventory_outcome_unknown"
          : retryable
            ? "retryable_inventory_failure"
            : "terminal_failure",
        inventory_http_status: inventoryResult.status || null,
        last_error_code: unknown
          ? "EBAY_INVENTORY_OUTCOME_UNKNOWN"
          : retryable
            ? "EBAY_INVENTORY_WRITE_RETRYABLE"
            : "EBAY_INVENTORY_WRITE_REJECTED",
        sanitized_result: inventoryResult.body,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
        .eq("id", ledgerId)
        .eq("lease_token", claimToken)
        .in("phase", ["claimed", "retryable_inventory_failure"])
        .select("id")
        .maybeSingle()
      if (failedInventoryError || !failedInventory) {
        return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
      }
      await enqueueDraftFailure(
        supabase,
        approval,
        context,
        unknown
          ? "EBAY_INVENTORY_OUTCOME_UNKNOWN"
          : retryable
            ? "EBAY_INVENTORY_WRITE_RETRYABLE"
            : "EBAY_INVENTORY_WRITE_REJECTED",
        !retryable || unknown,
      )
      return jsonError(
        new Error(
          unknown
            ? "EBAY_INVENTORY_OUTCOME_UNKNOWN"
            : retryable
              ? "EBAY_INVENTORY_WRITE_RETRYABLE"
              : "EBAY_INVENTORY_WRITE_REJECTED",
        ),
        unknown || retryable ? 503 : 409,
      )
    }
    const { data, error } = await supabase.from("ebay_draft_only_execution_ledger").update({
      phase: "inventory_confirmed",
      inventory_http_status: inventoryResult.status,
      inventory_confirmed_at: new Date().toISOString(),
      last_error_code: null,
      sanitized_result: {},
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).eq("lease_token", claimToken).in("phase", ["claimed", "retryable_inventory_failure"]).select("*").single()
    if (error || !data) throw new Error("EBAY_DRAFT_ONLY_INVENTORY_LEDGER_UPDATE_FAILED")
    ledger = data
  }

  const inFlightAt = new Date().toISOString()
  const { data: inFlight, error: inFlightError } = await supabase
    .from("ebay_draft_only_execution_ledger")
    .update({ phase: "offer_create_in_flight", offer_create_started_at: inFlightAt, updated_at: inFlightAt })
    .eq("id", ledgerId)
    .eq("lease_token", claimToken)
    .eq("phase", "inventory_confirmed")
    .select("id")
    .single()
  if (inFlightError || !inFlight) throw new Error("EBAY_DRAFT_ONLY_OFFER_LEDGER_CLAIM_FAILED")

  const offerResult = await createEbayUnpublishedOffer(record(approvedPayload.offerPayload))
  if (!offerResult.ok) {
    const unknown = !offerResult.outcomeKnown || offerResult.status >= 500
    const { data: failedOffer, error: failedOfferError } = await supabase.from("ebay_draft_only_execution_ledger").update({
      phase: unknown ? "offer_outcome_unknown" : "terminal_failure",
      offer_http_status: offerResult.status || null,
      last_error_code: unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED",
      sanitized_result: offerResult.body,
      lease_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).eq("lease_token", claimToken).eq("phase", "offer_create_in_flight").select("id").maybeSingle()
    if (failedOfferError || !failedOffer) {
      return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
    }
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED",
      true,
    )
    return jsonError(new Error(unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED"), unknown ? 503 : 409)
  }
  const offerId = sanitizeEbayOfferId(offerResult.body.offerId)
  if (!offerId) {
    const { data: missingOfferId, error: missingOfferIdError } = await supabase.from("ebay_draft_only_execution_ledger").update({ phase: "offer_outcome_unknown", offer_http_status: offerResult.status, last_error_code: "EBAY_OFFER_ID_MISSING", lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", ledgerId).eq("lease_token", claimToken).eq("phase", "offer_create_in_flight").select("id").maybeSingle()
    if (missingOfferIdError || !missingOfferId) {
      return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
    }
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      "EBAY_OFFER_ID_MISSING",
      true,
    )
    return jsonError(new Error("EBAY_OFFER_ID_MISSING"), 503)
  }
  const offerVerification = await verifyEbayUnpublishedOffer(
    offerId,
    sku,
    text(record(approvedPayload.offerPayload).marketplaceId),
    record(approvedPayload.offerPayload),
  )
  if (!offerVerification.safe) {
    const { data: quarantinedOffer, error: quarantinedOfferError } = await supabase.from("ebay_draft_only_execution_ledger").update({
      phase: "offer_outcome_unknown",
      offer_http_status: offerVerification.httpStatus || offerResult.status,
      offer_id: offerId,
      last_error_code: offerVerification.blocker,
      sanitized_result: {
        verifiedStatus: offerVerification.status,
        listingPresent: offerVerification.listingPresent,
      },
      lease_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).eq("lease_token", claimToken).eq("phase", "offer_create_in_flight").select("id").maybeSingle()
    if (quarantinedOfferError || !quarantinedOffer) {
      return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_LEASE_LOST"), 409)
    }
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      offerVerification.blocker,
      true,
    )
    return jsonError(new Error(offerVerification.blocker), 503)
  }
  const { data: completed, error: completionError } = await supabase
    .rpc("complete_ebay_draft_only_execution", {
      p_ledger_id: ledgerId,
      p_actor_user_id: actor,
      p_offer_id: offerId,
      p_offer_http_status: offerResult.status,
      p_verified_status: offerVerification.status,
      p_listing_present: offerVerification.listingPresent,
      p_verified_sku: offerVerification.sku,
      p_verified_marketplace_id: offerVerification.marketplaceId,
      p_target: target,
      p_account_fingerprint: fingerprint,
      p_claim_token: claimToken,
    })
    .single()
  if (completionError || !completed) {
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      "EBAY_DRAFT_ONLY_COMPLETION_PERSIST_FAILED",
      true,
    )
    throw new Error("EBAY_DRAFT_ONLY_COMPLETION_PERSIST_FAILED")
  }
  return NextResponse.json({
    success: true,
    draft: {
      offerId,
      sku,
      verification: "UNPUBLISHED_VERIFIED_AT_CREATE",
      verifiedAt: record(completed).completed_at ?? new Date().toISOString(),
      target,
    },
    execution: completed,
    safety: {
      inventoryItemCreated: true,
      unpublishedOfferCreated: true,
      postCreateStatusVerified: true,
      pointInTimeStatusOnly: true,
      publishOfferCalled: false,
      canPublish: false,
      target,
    },
  }, { status: 201 })
}

async function prepareFinalPublication(body: JsonRecord, actor: string) {
  const executionId = uuid(body.executionId)
  if (!executionId) return jsonError(new Error("EBAY_FINAL_PUBLICATION_EXECUTION_REQUIRED"), 400)
  const supabase = getSupabaseAdminClient()
  const context = await loadFinalPublicationContext(supabase, executionId, actor)
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: text(record(context.approval).listing_package_id),
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  const built = buildFinalPublicationPreview(
    context.approval,
    context.execution,
    visualPublicationGate,
  )
  const approvedPayload = record(context.approval.approved_payload)
  const oneClickAuthorized = hasOneClickControlledPublicationIntent(
    approvedPayload,
  )
  await revalidateFinalPublicationDependencies(approvedPayload)
  await verifyExactUnpublishedPublicationState({
    approvedPayload,
    offerId: built.offerId,
    sku: built.sku,
  })
  await revalidateFinalPublicationSource(supabase, context)
  const { data: publication, error } = await supabase
    .rpc("prepare_ebay_authorized_listing_publication", {
      p_draft_execution_id: executionId,
      p_actor_user_id: actor,
      p_marketplace_account_key: context.accountKey,
      p_preview_hash: built.previewHash,
      p_preview: built.preview,
      p_target: "PRODUCTION",
      p_account_fingerprint: context.runtime.accountFingerprint,
    })
    .single()
  if (error || !publication) {
    throw new Error(databaseExceptionCode(
      error,
      "EBAY_FINAL_PUBLICATION_PREVIEW_PERSIST_FAILED",
    ))
  }
  return NextResponse.json({
    success: true,
    publication,
    publicationRequirements: {
      exactConfirmPublish: EBAY_FINAL_PUBLISH_CONFIRMATION,
      finalPreviewRequired: true,
      productionAccountConfirmationRequired: true,
      publishOfferCallsAllowed: 1,
      promotionsAllowed: false,
      volumePricingAllowed: false,
      ...oneClickPublicationRequirements(oneClickAuthorized),
    },
    safety: {
      ebayWriteUsed: false,
      offerStatus: "UNPUBLISHED",
      previewPersisted: true,
      canPublishOnlyWithExactConfirmation: !oneClickAuthorized,
      machineContinuationAuthorized: oneClickAuthorized,
      exactInventoryAndOfferReadbackMatched: true,
    },
  }, { status: 201 })
}

async function compensateFinalPublicationAttachmentFailure(input: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  actor: string
  publication: JsonRecord
  context: Awaited<ReturnType<typeof loadFinalPublicationContext>>
  listingId: string
  failureCode: string
}) {
  let compensation: Awaited<ReturnType<
    typeof compensatePublishedListingAttachmentFailureV1
  >>
  try {
    compensation = await compensatePublishedListingAttachmentFailureV1({
      itemId: input.listingId,
      sku: text(input.publication.sku),
      failureCode: input.failureCode,
    })
  } catch {
    await input.supabase
      .from("ebay_authorized_listing_publications")
      .update({
        phase: "published_pending_verification",
        last_error_code:
          "EBAY_FINAL_PUBLICATION_COMPENSATING_END_UNVERIFIED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.publication.id)
      .eq("actor_user_id", input.actor)
      .eq("listing_id", input.listingId)
    return jsonError(new Error(
      "EBAY_FINAL_PUBLICATION_COMPENSATING_END_UNVERIFIED",
    ), 503)
  }
  const endedAt = new Date().toISOString()
  const { error: registryError } = await input.supabase
    .from("ebay_active_listings")
    .update({ listing_status: "ended", updated_at: endedAt })
    .eq("account_key", input.context.accountKey)
    .eq("ebay_item_id", input.listingId)
    .eq("listing_status", "active")
  const { error: publicationError } = await input.supabase
    .from("ebay_authorized_listing_publications")
    .update({
      phase: "terminal_failure",
      last_error_code: input.failureCode,
      sanitized_result: {
        attachmentFailed: true,
        compensatingEndVerified: true,
        officialReadbackNotCurrentLive:
          compensation.officialReadbackNotCurrentLive,
        marketplaceOperation: compensation.marketplaceOperation,
        endingReason: compensation.endingReason,
        ebayWriteCount: compensation.ebayWriteCount,
      },
      updated_at: endedAt,
    })
    .eq("id", input.publication.id)
    .eq("actor_user_id", input.actor)
    .eq("listing_id", input.listingId)
  return NextResponse.json({
    success: false,
    error: publicationError
      ? "EBAY_FINAL_PUBLICATION_COMPENSATION_LEDGER_FAILED"
      : input.failureCode,
    listing: {
      listingId: input.listingId,
      status: "NOT_CURRENT_LIVE",
    },
    compensation: {
      status: compensation.status,
      marketplaceOperation: compensation.marketplaceOperation,
      endingReason: compensation.endingReason,
      officialReadbackNotCurrentLive:
        compensation.officialReadbackNotCurrentLive,
      ebayWriteCount: compensation.ebayWriteCount,
      registrySynchronized: !registryError,
      ledgerSynchronized: !publicationError,
    },
    safety: {
      orphanLiveListingPrevented: true,
      publishOfferCalledAgain: false,
    },
  }, { status: publicationError ? 503 : 409 })
}

async function completeFinalPublicationMonitor(input: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  actor: string
  publication: JsonRecord
  context: Awaited<ReturnType<typeof loadFinalPublicationContext>>
  listingId: string
}) {
  const approvedPayload = record(input.context.approval.approved_payload)
  const expectedInventory = record(approvedPayload.inventoryItemPayload)
  const expectedOffer = record(approvedPayload.offerPayload)
  const [inventoryReadback, publishedOfferReadback] = await Promise.all([
    verifyEbayDraftInventoryItem(text(input.publication.sku), expectedInventory),
    verifyEbayPublishedOffer(
      text(input.publication.offer_id),
      text(input.publication.sku),
      expectedOffer,
    ),
  ])
  if (
    !inventoryReadback.safe
    || !publishedOfferReadback.safe
    || publishedOfferReadback.listingId !== input.listingId
  ) {
    return compensateFinalPublicationAttachmentFailure({
      ...input,
      failureCode: !inventoryReadback.safe
        ? "EBAY_FINAL_PUBLICATION_ACTIVE_INVENTORY_READBACK_MISMATCH"
        : "EBAY_FINAL_PUBLICATION_ACTIVE_OFFER_READBACK_MISMATCH",
    })
  }
  const registrationResult = await registerManualEbayListing(input.supabase, {
    ebayItemId: input.listingId,
    ebayUrl: `https://www.ebay.com/itm/${input.listingId}`,
    opportunityId: text(input.context.opportunity.id),
    candidateKey: text(input.context.opportunity.candidate_key),
    supplierSku: text(input.context.opportunity.supplier_sku) || null,
    supplierVariantId: text(input.context.opportunity.supplier_variant_id) || null,
    safeDefaults: {},
  }, input.actor)
  const verification = registrationResult.verification
  const expectedProduct = record(expectedInventory.product)
  const expectedPrice = record(record(expectedOffer.pricingSummary).price)
  const expectedPolicies = record(expectedOffer.listingPolicies)
  const activeSnapshot = record(verification.connectorListingSnapshot)
  const activeDefaults = record(verification.learnedSafeDefaults)
  const exactActiveReadback = verification.status === "verified"
    && text(activeSnapshot.title) === text(expectedProduct.title)
    && Number(activeSnapshot.availableQuantity) ===
      Number(expectedOffer.availableQuantity)
    && Math.abs(Number(activeSnapshot.price) - Number(expectedPrice.value))
      < 0.005
    && text(activeSnapshot.currency) === text(expectedPrice.currency)
    && text(activeDefaults.categoryId) === text(expectedOffer.categoryId)
    && text(activeDefaults.fulfillmentPolicyId) ===
      text(expectedPolicies.fulfillmentPolicyId)
    && text(activeDefaults.paymentPolicyId) ===
      text(expectedPolicies.paymentPolicyId)
    && text(activeDefaults.returnPolicyId) ===
      text(expectedPolicies.returnPolicyId)
  if (
    verification.status !== "verified"
    || verification.connectorListingStatus !== "active"
    || !uuid(verification.connectorListingId)
    || !exactActiveReadback
  ) {
    return compensateFinalPublicationAttachmentFailure({
      ...input,
      failureCode: verification.status === "verified"
        && verification.connectorListingStatus === "active"
        && uuid(verification.connectorListingId)
        ? "EBAY_FINAL_PUBLICATION_ACTIVE_READBACK_MISMATCH"
        : "EBAY_FINAL_PUBLICATION_ACTIVE_ATTACHMENT_FAILED",
    })
  }
  const registration = record(registrationResult.registration)
  const { data: completed, error: completionError } = await input.supabase
    .rpc("complete_ebay_authorized_listing_monitor_registration", {
      p_publication_id: input.publication.id,
      p_actor_user_id: input.actor,
      p_listing_id: input.listingId,
      p_active_listing_id: verification.connectorListingId,
      p_manual_registration_id: uuid(registration.id),
    })
    .single()
  if (completionError || !completed) {
    return compensateFinalPublicationAttachmentFailure({
      ...input,
      failureCode: "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED",
    })
  }
  const completedPublication = record(completed)
  const persistedStockguard = record(record(
    completedPublication.preview,
  ).publishWithStockguardContract)
  const persistedAttachmentIntent = record(
    persistedStockguard.attachmentIntent,
  )
  const persistedComponents = Array.isArray(
    persistedAttachmentIntent.components,
  ) ? persistedAttachmentIntent.components : []
  const stockguardEnrollmentPersisted =
    text(completedPublication.phase) === "monitor_registered" &&
    text(completedPublication.listing_id) === input.listingId &&
    persistedStockguard.publishAllowed === true &&
    persistedStockguard.exactLunaLinkageReady === true &&
    persistedStockguard.compositionReady === true &&
    persistedStockguard.stockguardReady === true &&
    persistedStockguard.monitorEnrollmentIntentPrepared === true &&
    text(persistedAttachmentIntent.sellerSku) ===
      text(completedPublication.sku) &&
    persistedComponents.length > 0 &&
    Number(persistedAttachmentIntent.expectedComponentCount) ===
      persistedComponents.length &&
    persistedAttachmentIntent.stockguardEnrollmentIntentPrepared === true &&
    persistedAttachmentIntent.monitorEnrollmentIntentPrepared === true
  if (!stockguardEnrollmentPersisted) {
    return compensateFinalPublicationAttachmentFailure({
      ...input,
      failureCode: "EBAY_FINAL_PUBLICATION_STOCKGUARD_ATTACH_FAILED",
    })
  }
  const listingPackageData = record(input.context.listingPackage.package_data)
  const learnedCategoryId = text(listingPackageData.categoryId)
  let categoryLearning: JsonRecord = {
    recorded: false,
    reason: "CATEGORY_RESOLVER_LEARNING_ID_UNAVAILABLE",
  }
  if (/^\d{1,12}$/.test(learnedCategoryId)) {
    try {
      categoryLearning = await recordEbayCategoryListingAcceptanceV1({
        supabase: input.supabase,
        accountKey: text(input.context.listingPackage.account_key),
        listingPackageId: text(input.context.listingPackage.id),
        packageData: listingPackageData,
        categoryId: learnedCategoryId,
        listingAcceptance: "ACCEPTED",
        ebayItemId: input.listingId,
        observedAt: verification.connectorObservedAt ?? undefined,
      })
    } catch {
      categoryLearning = {
        recorded: false,
        reason: "CATEGORY_RESOLVER_LISTING_ACCEPTANCE_WRITE_FAILED",
      }
    }
  }
  const stockguardAttachment = buildPostPublishStockguardAttachmentV1({
    prePublish: finalPublicationStockguardContract(
      record(input.context.approval.approved_payload),
    ),
    sellerSku: text(input.publication.sku),
    officialSellerSku: text(input.publication.sku),
    officialItemId: input.listingId,
    activeObservationVerified: true,
    stockguardEnrollmentPersisted,
    monitorEnrollmentPersisted:
      text(completedPublication.phase) === "monitor_registered" &&
      Boolean(completedPublication.monitor_registered_at),
  })
  return NextResponse.json({
    success: true,
    publication: completed,
    listing: {
      listingId: input.listingId,
      url: `https://www.ebay.com/itm/${input.listingId}`,
      status: "ACTIVE",
      verifiedAt: verification.connectorObservedAt,
    },
    monitoring: {
      registered: true,
      activeListingId: verification.connectorListingId,
      source: verification.method,
    },
    stockguard: stockguardAttachment,
    categoryLearning,
    safety: {
      publishOfferCalledAgain: false,
      activeOwnershipVerified: true,
      productIdentityVerified: true,
      exactActiveReadbackMatched: true,
    },
  })
}

async function publishFinalPublication(body: JsonRecord, actor: string) {
  const publicationId = uuid(body.publicationId)
  const executionKey = idempotencyKey(body.idempotencyKey)
  if (!publicationId || !executionKey) {
    return jsonError(new Error(
      "EBAY_FINAL_PUBLISH_EXPLICIT_CONFIRMATION_REQUIRED",
    ), 409)
  }
  const supabase = getSupabaseAdminClient()
  const { data: current, error: currentError } = await supabase
    .from("ebay_authorized_listing_publications")
    .select("*")
    .eq("id", publicationId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (currentError || !current) return jsonError(new Error("EBAY_FINAL_PUBLICATION_NOT_FOUND"), 404)
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: text(current.listing_package_id),
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  if (current.phase === "monitor_registered") {
    return NextResponse.json({
      success: true,
      idempotentReplay: true,
      publication: current,
      listing: {
        listingId: current.listing_id,
        url: `https://www.ebay.com/itm/${current.listing_id}`,
        status: "ACTIVE",
      },
      monitoring: { registered: true, activeListingId: current.active_listing_id },
      safety: { publishOfferCalledAgain: false },
    })
  }
  if (current.phase !== "preview_ready") {
    return jsonError(new Error("EBAY_FINAL_PUBLICATION_RECONCILIATION_REQUIRED"), 409)
  }
  const context = await loadFinalPublicationContext(
    supabase,
    text(current.draft_execution_id),
    actor,
  )
  const approvedPayload = record(context.approval.approved_payload)
  const oneClickIntentPresent = hasOneClickControlledPublicationIntent(
    approvedPayload,
  )
  const oneClickIntent = oneClickIntentPresent
    ? assertOneClickControlledPublicationIntentV1({
      approvedPayload,
      actorUserId: actor,
      listingPackage: context.listingPackage,
      opportunity: context.opportunity,
      accountFingerprint: context.runtime.accountFingerprint,
    })
    : null
  const oneClickRequestValid = Boolean(oneClickIntent)
    && text(body.authorizationSurface) === EBAY_ONE_CLICK_PUBLICATION_SURFACE
  const legacySecondAuthorizationValid = !oneClickIntentPresent
    && body.confirmPublish === EBAY_FINAL_PUBLISH_CONFIRMATION
    && body.confirmFinalPreview === true
    && body.confirmProductionAccount === true
  if (!oneClickRequestValid && !legacySecondAuthorizationValid) {
    return jsonError(new Error(
      oneClickIntentPresent
        ? "EBAY_ONE_CLICK_PUBLICATION_MACHINE_CONTINUATION_INVALID"
        : "EBAY_FINAL_PUBLISH_EXPLICIT_CONFIRMATION_REQUIRED",
    ), 409)
  }
  const machinePublishConfirmation = EBAY_FINAL_PUBLISH_CONFIRMATION
  finalPublicationStockguardContract(approvedPayload)
  const built = buildFinalPublicationPreview(
    context.approval,
    context.execution,
    visualPublicationGate,
  )
  if (built.previewHash !== current.preview_hash) {
    return jsonError(new Error("EBAY_FINAL_PUBLICATION_PREVIEW_CHANGED"), 409)
  }
  await revalidateFinalPublicationDependencies(approvedPayload)
  await verifyExactUnpublishedPublicationState({
    approvedPayload,
    offerId: built.offerId,
    sku: built.sku,
  })
  await revalidateFinalPublicationSource(supabase, context)
  const { data: refreshed, error: refreshError } = await supabase
    .rpc("prepare_ebay_authorized_listing_publication", {
      p_draft_execution_id: text(context.execution.id),
      p_actor_user_id: actor,
      p_marketplace_account_key: context.accountKey,
      p_preview_hash: built.previewHash,
      p_preview: built.preview,
      p_target: "PRODUCTION",
      p_account_fingerprint: context.runtime.accountFingerprint,
    })
    .single()
  const refreshedPublication = record(refreshed)
  if (
    refreshError
    || text(refreshedPublication.id) !== publicationId
    || text(refreshedPublication.phase) !== "preview_ready"
    || text(refreshedPublication.preview_hash) !== built.previewHash
  ) {
    return jsonError(new Error(databaseExceptionCode(
      refreshError,
      "EBAY_FINAL_PUBLICATION_PREVIEW_REFRESH_FAILED",
    )), 409)
  }
  const claimToken = randomUUID()
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_ebay_authorized_listing_publication", {
      p_publication_id: publicationId,
      p_actor_user_id: actor,
      p_idempotency_key: executionKey,
      p_preview_hash: built.previewHash,
      p_confirm_publish: machinePublishConfirmation,
      p_claim_token: claimToken,
    })
    .single()
  if (claimError || !claimed) {
    return jsonError(new Error(databaseExceptionCode(
      claimError,
      "EBAY_FINAL_PUBLICATION_CLAIM_FAILED",
    )), 409)
  }
  const claimedPublication = record(claimed)
  if (text(claimedPublication.phase) !== "publish_in_flight") {
    return jsonError(new Error("EBAY_FINAL_PUBLICATION_RECONCILIATION_REQUIRED"), 409)
  }
  const publishResult = await publishEbayOfferOnce({
    offerId: built.offerId,
    expectedSku: built.sku,
    expectedInventoryItemPayload: record(
      approvedPayload.inventoryItemPayload,
    ),
    expectedOfferPayload: record(approvedPayload.offerPayload),
    previewHash: built.previewHash,
    publicationControlId: publicationId,
    confirmPublish: machinePublishConfirmation,
  })
  if (!publishResult.ok || !publishResult.listingId) {
    await supabase.rpc("fail_ebay_authorized_listing_publication", {
      p_publication_id: publicationId,
      p_actor_user_id: actor,
      p_claim_token: claimToken,
      p_http_status: publishResult.status || null,
      p_error_code: publishResult.blocker,
      p_outcome_unknown: !publishResult.outcomeKnown,
      p_error_details: record(publishResult.body),
    })
    return NextResponse.json({
      success: false,
      error: publishResult.blocker,
      details: record(publishResult.body),
      safety: {
        target: "PRODUCTION",
        canPublish: false,
        publishRequestSent: publishResult.publishRequestSent,
        outcomeKnown: publishResult.outcomeKnown,
      },
    }, { status: publishResult.outcomeKnown ? 409 : 503 })
  }
  const { data: published, error: publishedError } = await supabase
    .rpc("record_ebay_authorized_listing_published", {
      p_publication_id: publicationId,
      p_actor_user_id: actor,
      p_listing_id: publishResult.listingId,
      p_http_status: publishResult.status,
      p_reconciled: publishResult.reconciled,
    })
    .single()
  if (publishedError || !published) {
    throw new Error("EBAY_FINAL_PUBLICATION_RESULT_PERSIST_FAILED")
  }
  return completeFinalPublicationMonitor({
    supabase,
    actor,
    publication: published as JsonRecord,
    context,
    listingId: publishResult.listingId,
  })
}

async function rearmFinalPublication(body: JsonRecord, actor: string) {
  const publicationId = uuid(body.publicationId)
  if (
    !publicationId
    || body.confirmPublish !== EBAY_FINAL_PUBLISH_CONFIRMATION
    || body.confirmFinalPreview !== true
    || body.confirmProductionAccount !== true
    || body.confirmRetryRejectedPublish !== true
  ) {
    return jsonError(
      new Error("EBAY_FINAL_PUBLISH_RECOVERY_CONFIRMATION_REQUIRED"),
      409,
    )
  }
  const supabase = getSupabaseAdminClient()
  const { data: publication, error } = await supabase
    .from("ebay_authorized_listing_publications")
    .select("*")
    .eq("id", publicationId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (error || !publication) {
    return jsonError(new Error("EBAY_FINAL_PUBLICATION_NOT_FOUND"), 404)
  }
  const rejectedWithoutListing =
    publication.phase === "terminal_failure" &&
    publication.publish_http_status === 400 &&
    publication.last_error_code === "EBAY_PUBLISH_WRITE_REJECTED" &&
    !publication.listing_id
  const sanitized = record(publication.sanitized_result)
  const compensatedMonitorFailure =
    publication.phase === "terminal_failure" &&
    publication.last_error_code ===
      "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED" &&
    /^\d{9,20}$/.test(text(publication.listing_id)) &&
    sanitized.compensatingEndVerified === true &&
    sanitized.officialReadbackNotCurrentLive === true
  if (!rejectedWithoutListing && !compensatedMonitorFailure) {
    return jsonError(
      new Error("EBAY_FINAL_PUBLISH_RECOVERY_NOT_ELIGIBLE"),
      409,
    )
  }
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: text(publication.listing_package_id),
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(
      visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY",
    )
  }
  const context = await loadFinalPublicationContext(
    supabase,
    text(publication.draft_execution_id),
    actor,
  )
  const built = buildFinalPublicationPreview(
    context.approval,
    context.execution,
    visualPublicationGate,
  )
  if (built.previewHash !== publication.preview_hash) {
    return jsonError(
      new Error("EBAY_FINAL_PUBLICATION_PREVIEW_CHANGED"),
      409,
    )
  }
  await revalidateFinalPublicationDependencies(
    record(context.approval.approved_payload),
  )
  if (compensatedMonitorFailure) {
    const priorListingId = text(publication.listing_id)
    const [offerRecovery, priorListing, activeDuplicates] = await Promise.all([
      verifyEbayCompensatedOfferRecoveryState(
        built.offerId,
        built.sku,
        priorListingId,
      ),
      readManualListingFromTradingApi(priorListingId),
      supabase
        .from("ebay_active_listings")
        .select("id", { count: "exact", head: true })
        .eq("account_key", context.accountKey)
        .eq("ebay_sku", built.sku)
        .eq("listing_status", "active"),
    ])
    if (
      !offerRecovery.safe ||
      priorListing.ownership !== "inactive" ||
      priorListing.listingStatus?.toLowerCase() === "active" ||
      priorListing.ebaySku !== built.sku ||
      activeDuplicates.error ||
      (activeDuplicates.count ?? 0) !== 0
    ) {
      const blocker = !offerRecovery.safe
        ? offerRecovery.blocker
        : priorListing.ownership !== "inactive" ||
            priorListing.listingStatus?.toLowerCase() === "active"
          ? "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_LISTING_STILL_ACTIVE"
          : priorListing.ebaySku !== built.sku
            ? "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_IDENTITY_MISMATCH"
            : "EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE"
      return jsonError(new Error(blocker), 409)
    }
  } else {
    const unpublished = await verifyEbayUnpublishedOffer(
      built.offerId,
      built.sku,
      "EBAY_US",
      record(record(context.approval.approved_payload).offerPayload),
    )
    if (!unpublished.safe) {
      return jsonError(
        new Error(unpublished.blocker || "EBAY_OFFER_NOT_PUBLISHABLE"),
        409,
      )
    }
  }
  const rearmRpc = compensatedMonitorFailure
    ? "rearm_ebay_authorized_listing_after_compensated_monitor_failure_once"
    : "rearm_ebay_authorized_listing_publication_once"
  const expectedErrorCode = compensatedMonitorFailure
    ? "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED"
    : "EBAY_PUBLISH_WRITE_REJECTED"
  const { data: rearmed, error: rearmError } = await supabase
    .rpc(rearmRpc, {
      p_publication_id: publicationId,
      p_actor_user_id: actor,
      p_confirm_publish: text(body.confirmPublish),
      p_expected_error_code: expectedErrorCode,
    })
    .single()
  if (rearmError || !rearmed) {
    throw new Error(databaseExceptionCode(
      rearmError,
      "EBAY_FINAL_PUBLISH_RECOVERY_FAILED",
    ))
  }
  return NextResponse.json({
    success: true,
    publication: rearmed,
    safety: {
      ebayWriteUsed: false,
      offerStatus: "UNPUBLISHED",
      recoveryAttemptsRemaining: 0,
      exactPreviewRevalidated: true,
      priorCompensatedListingInactive: compensatedMonitorFailure,
      activeDuplicateCount: 0,
    },
  })
}

async function reconcileFinalPublication(body: JsonRecord, actor: string) {
  const publicationId = uuid(body.publicationId)
  if (!publicationId) return jsonError(new Error("EBAY_FINAL_PUBLICATION_REQUIRED"), 400)
  const supabase = getSupabaseAdminClient()
  const { data: publication, error } = await supabase
    .from("ebay_authorized_listing_publications")
    .select("*")
    .eq("id", publicationId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (error || !publication) return jsonError(new Error("EBAY_FINAL_PUBLICATION_NOT_FOUND"), 404)
  if (publication.phase === "monitor_registered") {
    return NextResponse.json({
      success: true,
      idempotentReplay: true,
      publication,
      listing: { listingId: publication.listing_id, status: "ACTIVE" },
      monitoring: { registered: true, activeListingId: publication.active_listing_id },
      safety: { ebayWriteUsed: false },
    })
  }
  const visualPublicationGate = await loadFinalListingReviewPublicationGate({
    supabase,
    listingPackageId: text(publication.listing_package_id),
    actorId: actor,
  })
  if (!visualPublicationGate.allowed) {
    throw new Error(visualPublicationGate.reason ?? "FINAL_LISTING_REVIEW_NOT_READY")
  }
  const context = await loadFinalPublicationContext(
    supabase,
    text(publication.draft_execution_id),
    actor,
  )
  finalPublicationStockguardContract(record(context.approval.approved_payload))
  let reconciledPublication = publication as JsonRecord
  let listingId = text(publication.listing_id)
  if (["publish_in_flight", "outcome_unknown"].includes(text(publication.phase))) {
    const verification = await verifyEbayPublishedOffer(
      text(publication.offer_id),
      text(publication.sku),
      record(record(context.approval.approved_payload).offerPayload),
    )
    if (!verification.safe || !verification.listingId) {
      return jsonError(new Error(verification.blocker), 503)
    }
    listingId = verification.listingId
    const { data: recovered, error: recoveryError } = await supabase
      .rpc("record_ebay_authorized_listing_published", {
        p_publication_id: publicationId,
        p_actor_user_id: actor,
        p_listing_id: listingId,
        p_http_status: verification.httpStatus,
        p_reconciled: true,
      })
      .single()
    if (recoveryError || !recovered) {
      throw new Error("EBAY_FINAL_PUBLICATION_RECONCILIATION_PERSIST_FAILED")
    }
    reconciledPublication = recovered as JsonRecord
  }
  if (text(reconciledPublication.phase) !== "published_pending_verification" || !listingId) {
    return jsonError(new Error("EBAY_FINAL_PUBLICATION_NOT_RECONCILABLE"), 409)
  }
  return completeFinalPublicationMonitor({
    supabase,
    actor,
    publication: reconciledPublication,
    context,
    listingId,
  })
}
