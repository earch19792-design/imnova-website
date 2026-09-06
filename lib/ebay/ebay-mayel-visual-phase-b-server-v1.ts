import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  readOfficialActiveListingBrowseSnapshotV1,
  readOfficialActiveListingImageSnapshotV1,
  verifyOfficialOrderedImageSetV1,
} from "./ebay-active-listing-image-revision-service"
import { readCanonicalEbayListingManagementResourcesV1 } from
  "./ebay-account-policy-readonly-gateway"
import {
  classifyEbayListingManagementModelEvidenceV1,
  executeEbayInventoryManagedImageMutationV1,
  getEbayProductionMediaAccessTokenV1,
  getEbayDraftOnlyGatewayConfig,
  prepareEbayActiveListingManagementExecutorV1,
} from "./ebay-draft-only-gateway"
import { getEbayTradingReadOnlyAccessToken } from
  "./ebay-manual-listing-trading-readonly"
import {
  buildMayelVisualPhaseBRebaseV1,
  buildMayelVisualPhaseBPlanV1,
  ebayOfficialImageSetDigestV1,
} from "./ebay-mayel-visual-phase-b-v1"
import {
  buildExactMayelTradingPictureSetV1,
  buildDelegatedMayelTradingPictureSetV1,
  buildMayelTradingVisualDryRunV1,
  buildMayelTradingVisualIdempotencyBindingV1,
  classifyMayelTradingImageHostV1,
  MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
  MAYEL_TRADING_VISUAL_EXECUTOR_V1,
  prepareMayelAssetWithEbayMediaV1,
  reviseMayelTradingPicturesOnceV1,
} from
  "./ebay-mayel-trading-visual-executor-v1"

export const MAYEL_TRADING_VISUAL_LIVE_CANARY_CONFIRMATION =
  "EJECUTAR MAYEL TRADING VISUAL LIVE CANARY V1" as const
const MAYEL_TRADING_MEDIA_LEDGER_MECHANISM =
  "MAYEL_TRADING_VISUAL_EXECUTOR_V4" as const
const MAYEL_TRADING_MEDIA_LEGACY_LEDGER_MECHANISMS = [
  "MAYEL_TRADING_VISUAL_EXECUTOR_V3",
  "MAYEL_TRADING_VISUAL_EXECUTOR_V2",
] as const
const MAYEL_TRADING_MEDIA_LEDGER_INVARIANT =
  "MAYEL_APPROVED_ASSET_HAS_DURABLE_EPS_REPRESENTATION" as const

export const MAYEL_VISUAL_PHASE_B_OWNER_CONFIRMATION =
  "AUTORIZAR ACTUALIZACION DE IMAGENES"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function canonicalAssetUrlAllowed(value: string) {
  try {
    const url = new URL(value)
    const configured = new URL(process.env.SUPABASE_URL
      ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    return url.protocol === "https:" && url.origin === configured.origin
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(
        "/storage/v1/object/public/ebay-listing-images/mayel-visual/",
      )
  } catch { return false }
}

async function canonicalAssetsRecoverable(
  urls: readonly string[],
  fetchImpl: FetchLike,
) {
  for (const url of urls) {
    if (!canonicalAssetUrlAllowed(url)) return false
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      await response.body?.cancel().catch(() => undefined)
      if (!response.ok) return false
    } catch { return false }
  }
  return true
}

function withoutImages(value: unknown) {
  const payload = JSON.parse(JSON.stringify(record(value))) as JsonRecord
  const product = record(payload.product)
  if (Object.prototype.hasOwnProperty.call(product, "imageUrls")) {
    product.imageUrls = ["__AUTHORIZED_IMAGE_SET__"]
    payload.product = product
  }
  delete payload.sku
  delete payload.locale
  delete payload.groupIds
  delete payload.inventoryItemGroupKeys
  return JSON.stringify(stable(payload))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

function managementReadErrors(value: unknown) {
  const errors = Array.isArray(record(value).errors)
    ? record(value).errors as unknown[] : []
  return errors.slice(0, 3).map((entry) => {
    const error = record(entry)
    return Object.freeze({
      errorId: text(error.errorId, 40) || null,
      domain: text(error.domain, 80) || null,
      category: text(error.category, 80) || null,
      message: text(error.message, 240) || null,
    })
  })
}

async function readCanonicalListingManagementEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  sku: string
  itemId: string
  fetchImpl: FetchLike
}) {
  const observedAt = new Date().toISOString()
  const [{ data: vaultRefreshToken, error: vaultError },
    { data: profile, error: profileError }] = await Promise.all([
    input.supabase.rpc("get_ebay_account_policy_readonly_refresh_token_v1", {
      p_account_key: input.accountKey,
    }),
    input.supabase.from("ebay_account_policy_profiles")
      .select("verified_at,expires_at,verification_source")
      .eq("account_key", input.accountKey)
      .eq("marketplace_id", "EBAY_US")
      .eq("verification_source", "EBAY_ACCOUNT_API_GET")
      .gt("expires_at", observedAt)
      .maybeSingle(),
  ])
  if (vaultError) {
    throw new Error("EBAY_LISTING_MANAGEMENT_OAUTH_VAULT_READ_FAILED")
  }
  if (profileError) {
    throw new Error("EBAY_LISTING_MANAGEMENT_ACCOUNT_PROFILE_READ_FAILED")
  }
  const refreshToken = text(vaultRefreshToken, 4_096)
  const durableVerifiedAt = text(profile?.verified_at, 80)
  const durableExpiresAt = text(profile?.expires_at, 80)
  if (!refreshToken || !durableVerifiedAt || !durableExpiresAt
    || Date.parse(durableExpiresAt) <= Date.now()) {
    throw new Error("EBAY_LISTING_MANAGEMENT_ACCOUNT_AUTHORITY_UNPROVEN")
  }
  const resources = await readCanonicalEbayListingManagementResourcesV1({
    sku: input.sku,
    durableAccountIdentityProven: true,
    refreshTokenOverride: refreshToken,
    fetchImpl: input.fetchImpl,
  })
  const management = classifyEbayListingManagementModelEvidenceV1({
    sku: input.sku,
    itemId: input.itemId,
    inventory: resources.inventory,
    offers: resources.offers,
  })
  return Object.freeze({
    ...management,
    managementEvidenceSource: [
      management.managementEvidenceSource,
      resources.sourceAuthority,
      "FRESH_VERIFIED_EBAY_ACCOUNT_POLICY_PROFILE_V1",
    ].join("+"),
    managementObservedAt: resources.observedAt,
    durableAccountIdentityObservedAt: durableVerifiedAt,
    accountIdentityProven: true as const,
    marketplaceId: resources.marketplaceId,
    resourceErrors: Object.freeze({
      inventory: Object.freeze(managementReadErrors(resources.inventory.body)),
      offers: Object.freeze(managementReadErrors(resources.offers.body)),
    }),
  })
}

function reconcileManagementWithOfficialTradingListing(
  management: Awaited<ReturnType<
    typeof readCanonicalListingManagementEvidence>>,
  official: Awaited<ReturnType<
    typeof readOfficialActiveListingImageSnapshotV1>> | null,
) {
  const tradingListingProven = Boolean(official
    && official.listingStatus.toLowerCase() === "active"
    && ["fixedpriceitem", "storesfixedprice"].includes(
      official.listingType.toLowerCase()))
  const noInventoryOfferControlsListing = management.offersReadComplete
    && management.exactPublishedOfferCount === 0
    && management.otherPublishedOfferCount === 0
    && management.publishedOfferCount === 0
  if (management.managementModel !== "MANAGEMENT_MODEL_UNPROVEN"
    || !tradingListingProven || !noInventoryOfferControlsListing) {
    return management
  }
  return Object.freeze({
    ...management,
    managementModel: "TRADING_MANAGED" as const,
    managementEvidenceSource: [
      official?.sourceAuthority
        ?? "OFFICIAL_TRADING_GET_ITEM_ACTIVE_OWNED_FIXED_PRICE",
      "NO_PUBLISHED_INVENTORY_OFFER_LINKAGE",
      management.managementEvidenceSource,
    ].join("+"),
  })
}

async function loadContext(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  fetchImpl: FetchLike
}) {
  const { data: task, error: taskError } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1").select("*")
    .eq("id", input.taskId)
    .eq("marketplace_account_key", input.accountKey).maybeSingle()
  if (taskError || !task || task.status !== "OWNER_PREVIEW_READY") {
    throw new Error("MAYEL_VISUAL_PHASE_B_TASK_NOT_READY")
  }
  const [{ data: active, error: activeError },
    { data: assets, error: assetsError },
    { data: execution, error: executionError },
    { data: anyExecution, error: anyExecutionError },
    { data: priorExecutions, error: priorExecutionsError }] = await Promise.all([
    input.supabase.from("ebay_active_listings")
      .select("id,ebay_item_id,ebay_sku,title,listing_status,raw_payload")
      .eq("id", task.active_listing_id).eq("ebay_item_id", task.ebay_item_id)
      .maybeSingle(),
    input.supabase.from("ebay_listing_image_assets")
      .select("id,status,mayel_approval_status,owner_approval_status,mayel_output_role,output_sha256,public_url,published_storage_path,product_truth_digest,source_image_set_digest")
      .eq("mayel_visual_task_id", task.id).eq("account_key", input.accountKey)
      .eq("status", "approved").eq("mayel_approval_status", "APPROVED"),
    input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
      .select("*").eq("visual_task_id", task.id)
      .eq("visual_manifest_digest", task.visual_manifest_digest)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
      .select("id,visual_manifest_digest,phase,final_state,ebay_response_class,marketplace_write_count,canonical_asset_ids,media_eps_url,proposed_final_ordered_image_urls")
      .eq("visual_task_id", task.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
      .select("phase,canonical_asset_ids,media_eps_url,media_assets")
      .eq("visual_task_id", task.id)
      .eq("phase", "APPLIED_AND_OFFICIALLY_VERIFIED")
      .order("created_at", { ascending: false }).limit(24),
  ])
  if (activeError || !active || active.listing_status !== "active"
    || assetsError || executionError || anyExecutionError
    || priorExecutionsError) {
    throw new Error("MAYEL_VISUAL_PHASE_B_DURABLE_CONTEXT_INVALID")
  }
  const sku = text(active.ebay_sku, 50)
  if (!sku) throw new Error("MAYEL_VISUAL_PHASE_B_EBAY_SKU_MISSING")
  const [accessToken, baseManagement] = await Promise.all([
    getEbayTradingReadOnlyAccessToken(input.fetchImpl),
    readCanonicalListingManagementEvidence({
      supabase: input.supabase,
      sku,
      itemId: String(task.ebay_item_id),
      accountKey: input.accountKey,
      fetchImpl: input.fetchImpl,
    }),
  ])
  let official: Awaited<ReturnType<
    typeof readOfficialActiveListingImageSnapshotV1>> | null = null
  let officialReadFailureClass: string | null = null
  let tradingReadFailureClass: string | null = null
  try {
    official = await readOfficialActiveListingImageSnapshotV1({
      accessToken, itemId: String(task.ebay_item_id), expectedSku: sku,
      accountKey: input.accountKey, fetchImpl: input.fetchImpl,
      durableAccountIdentityProven: baseManagement.accountIdentityProven,
    })
  } catch (error) {
    officialReadFailureClass = error instanceof Error
      ? text(error.message, 160) : "EBAY_ACTIVE_IMAGE_REVISION_OFFICIAL_READ_FAILED"
    tradingReadFailureClass = officialReadFailureClass
    if (officialReadFailureClass.endsWith("_EBAY_ERROR_518")) {
      try {
        official = await readOfficialActiveListingBrowseSnapshotV1({
          itemId: String(task.ebay_item_id),
          accountKey: input.accountKey, fetchImpl: input.fetchImpl,
        })
        officialReadFailureClass = null
      } catch (fallbackError) {
        const fallbackClass = fallbackError instanceof Error
          ? text(fallbackError.message, 160)
          : "EBAY_ACTIVE_IMAGE_BROWSE_OFFICIAL_READ_FAILED"
        officialReadFailureClass = [tradingReadFailureClass, fallbackClass]
          .filter(Boolean).join("+")
      }
    }
  }
  const management = reconcileManagementWithOfficialTradingListing(
    baseManagement, official)
  const tradingRateLimited = tradingReadFailureClass?.endsWith(
    "_EBAY_ERROR_518") === true
  const inventoryImageUrls = Array.isArray(record(
    record(management.inventoryItemPayload).product).imageUrls)
    ? record(record(management.inventoryItemPayload).product).imageUrls as unknown[]
    : []
  const currentOfficialImageUrls = management.managementModel ===
    "INVENTORY_API_MANAGED"
    ? inventoryImageUrls.map((value) => text(value, 1_000)).filter(Boolean)
    : official?.pictureUrls ?? []
  const plan = buildMayelVisualPhaseBPlanV1({
    visualTaskId: String(task.id),
    ebayItemId: String(task.ebay_item_id),
    visualManifest: task.visual_manifest,
    visualManifestDigest: task.visual_manifest_digest,
    currentOfficialImageUrls,
    approvedAssets: assets ?? [],
    canonicalPublicAssetUrlAllowed: canonicalAssetUrlAllowed,
  })
  const rebase = buildMayelVisualPhaseBRebaseV1({
    visualTaskId: String(task.id),
    ebayItemId: String(task.ebay_item_id),
    visualManifest: task.visual_manifest,
    visualManifestDigest: task.visual_manifest_digest,
    taskProductTruthDigest: task.product_truth_digest,
    taskSourceImageSetDigest: task.source_image_set_digest,
    currentOfficialImageUrls,
    approvedAssets: assets ?? [],
    appliedMayelOfficialImages: (priorExecutions ?? []).flatMap((row) => {
      const mediaAssets = Array.isArray(row.media_assets)
        ? row.media_assets.map(record) : []
      const explicit = mediaAssets.flatMap((media) => {
        const assetId = uuid(media.assetId)
        const officialUrl = text(media.epsImageUrl, 1_000)
        return assetId && officialUrl ? [{ assetId, officialUrl }] : []
      })
      if (explicit.length) return explicit
      const assetIds = Array.isArray(row.canonical_asset_ids)
        ? row.canonical_asset_ids.map(uuid).filter(Boolean) : []
      const officialUrl = text(row.media_eps_url, 1_000)
      return assetIds.length === 1 && officialUrl
        ? [{ assetId: String(assetIds[0]), officialUrl }] : []
    }),
    canonicalPublicAssetUrlAllowed: canonicalAssetUrlAllowed,
  })
  const managementReady = management.managementModel === "INVENTORY_API_MANAGED"
  const managementBlocker = management.managementModel === "TRADING_MANAGED"
    ? tradingRateLimited
      ? "TRADING_API_RATE_LIMIT"
      : "MAYEL_VISUAL_TRADING_EXECUTOR_EXPLICITLY_GATED_SINGLE_WRITE_CONTRACT"
    : management.managementModel === "MANAGEMENT_MODEL_UNPROVEN"
      ? "MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN" : null
  const inventoryManagedIdentityProven = management.managementModel ===
    "INVENTORY_API_MANAGED" && management.inventoryItemPresent
    && management.exactPublishedOfferCount === 1
  const tradingManagedIdentityProven = management.managementModel ===
    "TRADING_MANAGED" && official?.itemId === String(task.ebay_item_id)
    && (official.sourceAuthority === "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1"
      || official.ebaySku === sku)
    && official.listingStatus.toLowerCase() === "active"
  return { task: task as JsonRecord, active: active as JsonRecord,
    assets: (assets ?? []) as JsonRecord[], execution: execution as JsonRecord | null,
    anyExecution: anyExecution as JsonRecord | null,
    official, currentOfficialImageUrls, plan, management, sku,
    managementReady, managementBlocker, rebase,
    accountIdentityProven: management.accountIdentityProven,
    listingIdentityProven: inventoryManagedIdentityProven
      || tradingManagedIdentityProven,
    currentImageSetProven: currentOfficialImageUrls.length > 0
      && (management.managementModel === "INVENTORY_API_MANAGED"
        || (official?.pictureUrls.length ?? 0) > 0),
    correctEbayApi: management.managementModel === "INVENTORY_API_MANAGED"
      ? "INVENTORY_API" : management.managementModel === "TRADING_MANAGED"
        ? "TRADING_API" : null,
    officialReadStatus: official?.sourceAuthority ===
      "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1"
      ? "PASS_BROWSE_FALLBACK" : official ? "PASS" : "FAILED",
    officialReadAuthority: official?.sourceAuthority
      ?? (official ? "EBAY_TRADING_GET_ITEM_V1" : null),
    officialReadFailureClass,
    tradingReadFailureClass,
    tradingRateLimited,
  }
}

const SETTLED_MAYEL_VISUAL_EXECUTION_PHASES = new Set([
  "APPLIED_AND_OFFICIALLY_VERIFIED",
  "AUTHORIZATION_INVALIDATED",
  "PREFLIGHT_FAILED",
  "WRITE_FAILED",
  "READBACK_MISMATCH",
])

function priorExecutionBlocksCurrentManifest(context: {
  task: JsonRecord
  anyExecution: JsonRecord | null
}) {
  const execution = context.anyExecution
  if (!execution) return false
  if (text(execution.visual_manifest_digest, 100) ===
      text(context.task.visual_manifest_digest, 100)) return true
  // A proven terminal execution belongs to an older immutable manifest and
  // must not freeze later Mayel work. Unknown/ambiguous readback remains
  // fail-closed because a listing write may still have taken effect.
  return !SETTLED_MAYEL_VISUAL_EXECUTION_PHASES.has(
    text(execution.phase, 80))
}

function publicExecution(value: JsonRecord | null) {
  if (!value) return null
  return {
    ownerApprovalId: uuid(value.owner_approval_id),
    executionId: uuid(value.id),
    phase: text(value.phase, 80),
    managementModel: text(value.management_model, 80),
    executor: text(value.executor, 120),
    marketplaceWriteCount: Number(value.marketplace_write_count) || 0,
    finalState: text(value.final_state, 80) || null,
    errorCode: text(value.last_error_code, 160) || null,
    appliedAndOfficiallyVerified:
      value.phase === "APPLIED_AND_OFFICIALLY_VERIFIED",
  }
}

export async function readMayelVisualPhaseBPreviewV1(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  fetchImpl?: FetchLike
}) {
  const context = await loadContext({ ...input, fetchImpl: input.fetchImpl ?? fetch })
  const safeRebaseAvailable = context.plan.blocker ===
    "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
    && context.rebase.safe
    && !priorExecutionBlocksCurrentManifest(context)
  const visualOnlyDiff = context.plan.ready
    && context.plan.fieldsToChange.length === 1
    && context.plan.fieldsToChange[0] === "IMAGES_ONLY"
  const mayelManifestValid = context.plan.ready
  const unauthorizedFieldDiffCount = visualOnlyDiff ? 0 : null
  const mediaGateway = getEbayDraftOnlyGatewayConfig()
  const mediaPreparationAvailable = mediaGateway.target === "PRODUCTION"
    && mediaGateway.configured && mediaGateway.oauthConfigured
    && mediaGateway.identityBound
  const mediaPreparationAuthorized = mediaPreparationAvailable
    && mediaGateway.enabled && mediaGateway.environmentAllowed
  const tradingExecutorDryRun = context.management.managementModel ===
    "TRADING_MANAGED" && context.plan.newMayelSecondaryImages.length === 1
    ? buildMayelTradingVisualDryRunV1({
      accountKey: input.accountKey,
      itemId: String(context.task.ebay_item_id),
      manifestId: uuid(context.task.visual_manifest_id),
      manifestDigest: context.plan.visualManifestDigest ?? "",
      managementModel: context.management.managementModel,
      correctEbayApi: context.correctEbayApi,
      accountIdentityProven: context.accountIdentityProven,
      listingIdentityProven: context.listingIdentityProven,
      listingActive: context.official?.listingStatus.toLowerCase() === "active",
      manifestValid: mayelManifestValid,
      visualOnlyDiff,
      unauthorizedFieldDiffs: visualOnlyDiff ? [] : ["NON_VISUAL_DIFF"],
      currentOfficialImageUrls: context.currentOfficialImageUrls,
      expectedCurrentImageDigest:
        context.plan.currentOfficialImageSetDigest,
      proposedSourceImageUrls:
        context.plan.proposedFinalOrderedImageUrls,
      mayelAssetUrl: context.plan.newMayelSecondaryImages[0],
      mayelAssetAuthorized: true,
      approvedMayelStorageUrl: canonicalAssetUrlAllowed,
      pictureSource: context.official?.pictureSource ?? null,
      // Media API requires the production publisher credential carrying
      // sell.inventory. Trading's base-scope token is not treated as proof.
      mediaPreparationAvailable,
      mediaPreparationAuthorized,
      durableReviseAttemptCount:
        Number(context.anyExecution?.marketplace_write_count) || 0,
    }) : null
  const baseSafeToExecute = context.accountIdentityProven
    && context.listingIdentityProven
    && context.currentImageSetProven
    && mayelManifestValid
    && visualOnlyDiff
    && unauthorizedFieldDiffCount === 0
    && !context.execution
  const safeToExecuteVisualChange = baseSafeToExecute
    && (context.managementReady
      || tradingExecutorDryRun?.safeToExecuteVisualChange === true)
  const applicationStatus = context.tradingRateLimited
    ? "WAITING_FOR_EBAY" as const
    : safeToExecuteVisualChange ? "READY" as const : "BLOCKED" as const
  const applicationReason = context.tradingRateLimited
    ? "eBay Trading alcanzó temporalmente su límite de llamadas. Tu trabajo está guardado y se aplicará cuando vuelva a estar disponible."
    : null
  const preview = {
    contractVersion: "MAYEL_VISUAL_WORKSTATION_PHASE_B_V1",
    visualManifestId: uuid(context.task.visual_manifest_id),
    visualManifestDigest: context.plan.visualManifestDigest,
    ownerAuthorizationDigest: context.plan.ownerAuthorizationDigest,
    currentOfficialImageSetDigest: context.plan.currentOfficialImageSetDigest,
    currentImages: context.currentOfficialImageUrls,
    currentMainImage: context.plan.currentMainImage,
    currentSecondaryImages: context.plan.currentSecondaryImages,
    newMayelSecondaryImages: context.plan.newMayelSecondaryImages,
    proposedFinalImages: context.plan.proposedFinalOrderedImageUrls,
    finalOrder: context.plan.proposedFinalOrderedImageUrls.map((url, index) => ({
      position: index + 1,
      url,
      role: index === 0 ? "CURRENT_MAIN" :
        context.plan.newMayelSecondaryImages.includes(url)
          ? "MAYEL_APPROVED_SECONDARY" : "CURRENT_SECONDARY",
    })),
    fieldsToChange: context.plan.fieldsToChange,
    mainImageProtected: context.plan.mainImageProtected,
    mainImageChanged: context.plan.mainImageChanged,
    marketplace: "EBAY_US",
    managementModel: context.management.managementModel,
    managementModelAuthority: context.management.managementEvidenceSource,
    managementObservedAt: context.management.managementObservedAt,
    accountIdentityProven: context.accountIdentityProven,
    listingIdentityProven: context.listingIdentityProven,
    correctEbayApi: context.correctEbayApi,
    correctEbayApiResolved: context.correctEbayApi !== null,
    officialReadStatus: context.officialReadStatus,
    officialReadAuthority: context.officialReadAuthority,
    officialReadFailureClass: context.officialReadFailureClass,
    tradingReadFailureClass: context.tradingReadFailureClass,
    currentImageSetProven: context.currentImageSetProven,
    mayelManifestValid,
    visualOnlyDiff,
    unauthorizedFieldDiffCount,
    safeToExecuteVisualChange,
    readyForMayelPhysicalCanary: safeToExecuteVisualChange,
    applicationStatus,
    applicationReason,
    managementDiagnostics: {
      inventoryHttpStatus: context.management.inventoryHttpStatus,
      offersHttpStatus: context.management.offersHttpStatus,
      inventoryItemPresent: context.management.inventoryItemPresent,
      inventoryItemAuthoritativelyAbsent:
        context.management.inventoryItemAuthoritativelyAbsent,
      offersReadComplete: context.management.offersReadComplete,
      exactPublishedOfferCount: context.management.exactPublishedOfferCount,
      otherPublishedOfferCount: context.management.otherPublishedOfferCount,
      publishedOfferCount: context.management.publishedOfferCount,
      totalOfferCount: context.management.totalOfferCount,
      groupedInventoryItem: context.management.groupedInventoryItem,
      resourceErrors: context.management.resourceErrors,
    },
    safeRebaseAvailable,
    rebaseEligible: context.plan.blocker ===
      "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
      && !priorExecutionBlocksCurrentManifest(context),
    imageSetChangeClassification: context.rebase.safe
      ? "SAFE_REBASE" : "MATERIAL_CONFLICT",
    currentOfficialImageCount: context.currentOfficialImageUrls.length,
    tradingOfficialImageReadback:
      context.official?.tradingPictureReadback ?? null,
    tradingPictureContext: context.official?.tradingPictureReadback
      ? {
        pictureSource: context.official.pictureSource,
        galleryUrlPresent: Boolean(context.official.galleryUrl),
        galleryUrlIncludedInDigest: false as const,
      } : null,
    manifestBoundImageCount: [record(context.task.visual_manifest).currentMainImage,
      ...(Array.isArray(record(context.task.visual_manifest).currentSecondaryImages)
        ? record(context.task.visual_manifest).currentSecondaryImages as unknown[]
        : [])].filter(Boolean).length,
    mayelAssetPreserved: context.rebase.mayelAssetPreserved,
    mayelReworkRequired: context.rebase.mayelReworkRequired,
    rebaseBlocker: context.rebase.blocker,
    ownerCtaAvailable: context.plan.ready && context.managementReady
      && !context.execution,
    blocker: !context.listingIdentityProven
      && context.officialReadFailureClass
      ? context.officialReadFailureClass
      : context.plan.blocker ?? (tradingExecutorDryRun
        ? tradingExecutorDryRun.blocker : context.managementBlocker),
    tradingExecutorExplicitlyGated:
      context.management.managementModel === "TRADING_MANAGED"
      && tradingExecutorDryRun?.executorImplemented !== true,
    tradingExecutorDryRun,
    execution: publicExecution(context.execution),
    safety: { getIsReadOnly: true, mainImageProtected: true,
      localFileDirectToEbay: false, autoPublish: false,
      ownerApprovalRequired: false },
  }
  console.info("MAYEL_VISUAL_PHASE_B_READ_MODEL_V1", {
    visualTaskId: context.task.id,
    ebayItemId: context.task.ebay_item_id,
    managementModel: context.management.managementModel,
    managementEvidenceSource: context.management.managementEvidenceSource,
    inventoryHttpStatus: context.management.inventoryHttpStatus,
    offersHttpStatus: context.management.offersHttpStatus,
    inventoryItemPresent: context.management.inventoryItemPresent,
    inventoryItemAuthoritativelyAbsent:
      context.management.inventoryItemAuthoritativelyAbsent,
    offersReadComplete: context.management.offersReadComplete,
    exactPublishedOfferCount: context.management.exactPublishedOfferCount,
    groupedInventoryItem: context.management.groupedInventoryItem,
    accountIdentityProven: context.accountIdentityProven,
    listingIdentityProven: context.listingIdentityProven,
    correctEbayApi: context.correctEbayApi,
    officialReadStatus: context.officialReadStatus,
    officialReadAuthority: context.officialReadAuthority,
    officialReadFailureClass: context.officialReadFailureClass,
    tradingReadFailureClass: context.tradingReadFailureClass,
    applicationStatus,
    currentImageSetProven: context.currentImageSetProven,
    mayelManifestValid,
    visualOnlyDiff,
    unauthorizedFieldDiffCount,
    safeToExecuteVisualChange,
    planBlocker: context.plan.blocker,
    safeRebaseAvailable,
    rebaseBlocker: context.rebase.blocker,
    currentOfficialImageCount: context.currentOfficialImageUrls.length,
    manifestBoundImageCount: preview.manifestBoundImageCount,
    marketplaceWrites: 0,
  })
  return preview
}

export async function rebaseMayelVisualPhaseBPreviewV1(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  expectedVisualManifestDigest: string
  fetchImpl?: FetchLike
}) {
  if (!uuid(input.taskId)
    || !/^sha256:[0-9a-f]{64}$/.test(input.expectedVisualManifestDigest)) {
    throw new Error("MAYEL_VISUAL_REBASE_REQUEST_INVALID")
  }
  const context = await loadContext({ ...input, fetchImpl: input.fetchImpl ?? fetch })
  if (priorExecutionBlocksCurrentManifest(context)) {
    throw new Error("MAYEL_VISUAL_REBASE_OWNER_AUTHORIZATION_EXISTS")
  }
  if (context.task.visual_manifest_digest !== input.expectedVisualManifestDigest) {
    throw new Error("MAYEL_VISUAL_REBASE_STALE_PREVIEW")
  }
  if (context.plan.blocker !==
      "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
      || !context.rebase.safe || !context.rebase.manifest
      || !context.rebase.visualManifestDigest) {
    throw new Error(context.rebase.blocker ??
      "MAYEL_VISUAL_REBASE_NOT_SAFE")
  }
  const oldManifestId = uuid(context.task.visual_manifest_id)
  const oldDigest = String(context.task.visual_manifest_digest)
  const { data: updated, error } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .update({
      current_image_set: context.currentOfficialImageUrls,
      visual_manifest: context.rebase.manifest,
      visual_manifest_digest: context.rebase.visualManifestDigest,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.taskId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("status", "OWNER_PREVIEW_READY")
    .eq("visual_manifest_digest", oldDigest)
    .eq("product_truth_digest", String(context.task.product_truth_digest))
    .eq("source_image_set_digest", String(context.task.source_image_set_digest))
    .select("id,visual_manifest_id,visual_manifest_digest,visual_manifest,current_image_set,product_truth_digest,source_image_set_digest")
    .maybeSingle()
  if (error || !updated) {
    throw new Error("MAYEL_VISUAL_REBASE_PERSISTENCE_CONFLICT")
  }
  const persistedManifest = record(updated.visual_manifest)
  if (updated.visual_manifest_digest !== context.rebase.visualManifestDigest
    || persistedManifest.visualManifestDigest !==
      context.rebase.visualManifestDigest
    || updated.product_truth_digest !== context.task.product_truth_digest
    || updated.source_image_set_digest !== context.task.source_image_set_digest
    || JSON.stringify(updated.current_image_set) !==
      JSON.stringify(context.currentOfficialImageUrls)
    || uuid(updated.visual_manifest_id) === oldManifestId) {
    throw new Error("MAYEL_VISUAL_REBASE_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({
    safeRebaseApplied: true,
    visualTaskId: input.taskId,
    oldVisualManifestDigest: oldDigest,
    newVisualManifestDigest: context.rebase.visualManifestDigest,
    oldVisualManifestId: oldManifestId,
    newVisualManifestId: uuid(updated.visual_manifest_id),
    currentOfficialImageSetDigest:
      context.rebase.currentOfficialImageSetDigest,
    currentOfficialImageCount: context.currentOfficialImageUrls.length,
    managementModel: context.management.managementModel,
    mayelAssetPreserved: true,
    mayelReuploadRequired: false,
    chatGptRegenerationRequired: false,
    mayelReapprovalRequired: false,
    mainImagePreserved: context.rebase.mainImagePreserved,
    marketplaceWrites: 0,
  })
}

async function updateExecution(input: { supabase: SupabaseClient
  executionId: string; patch: JsonRecord; phases?: string[] }) {
  let query = input.supabase.from("ebay_mayel_visual_phase_b_executions_v1")
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq("id", input.executionId)
  if (input.phases?.length) query = query.in("phase", input.phases)
  const { data, error } = await query.select("*").maybeSingle()
  if (error || !data) throw new Error("MAYEL_VISUAL_PHASE_B_LEDGER_UPDATE_FAILED")
  return data as JsonRecord
}

function digestCanonical(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stable(value))).digest("hex")}`
}

function protectedFieldDifferences(
  before: JsonRecord | null,
  after: JsonRecord | null,
) {
  if (!before || !after) return ["PROTECTED_SNAPSHOT_UNAVAILABLE"]
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
  return keys.filter((key) => JSON.stringify(before[key]) !==
    JSON.stringify(after[key])).map((key) => key.toUpperCase())
}

function validDurableEps(value: unknown) {
  const media = record(value)
  const epsImageUrl = text(media.epsImageUrl, 1_000)
  const expirationDate = text(media.expirationDate, 100) || null
  return Boolean(text(media.imageId, 200)
    && classifyMayelTradingImageHostV1(epsImageUrl) === "EBAY_EPS"
    && (!expirationDate || Date.parse(expirationDate) > Date.now() + 60_000))
}

async function resolveMayelAssetToDurableEpsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  itemId: string
  manifestId: string
  manifestDigest: string
  assetId: string
  assetSha256: string
  assetUrl: string
  fetchImpl: FetchLike
}) {
  const evidenceFingerprint = digestCanonical({
    account: input.accountKey,
    itemId: input.itemId,
    assetId: input.assetId,
    assetSha256: input.assetSha256,
    route: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
  })
  const current = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,status,evidence,recovery_attempt_count")
    .eq("marketplace_account_key", input.accountKey)
    .eq("invariant_code", MAYEL_TRADING_MEDIA_LEDGER_INVARIANT)
    .eq("mechanism_version", MAYEL_TRADING_MEDIA_LEDGER_MECHANISM)
    .eq("evidence_fingerprint", evidenceFingerprint).maybeSingle()
  if (current.error) {
    throw new Error("MAYEL_TRADING_MEDIA_LEDGER_READ_FAILED")
  }
  const legacy = current.data ? null : await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,status,evidence,recovery_attempt_count")
    .eq("marketplace_account_key", input.accountKey)
    .eq("invariant_code", MAYEL_TRADING_MEDIA_LEDGER_INVARIANT)
    .in("mechanism_version", [...MAYEL_TRADING_MEDIA_LEGACY_LEDGER_MECHANISMS])
    .eq("evidence_fingerprint", evidenceFingerprint)
    .eq("status", "RESOLVED").order("last_observed_at", {
      ascending: false }).limit(1).maybeSingle()
  if (legacy?.error) {
    throw new Error("MAYEL_TRADING_MEDIA_LEDGER_READ_FAILED")
  }
  const existing = current.data ?? legacy?.data ?? null
  const existingMedia = record(record(existing?.evidence)
    .mediaPreparation)
  if (existing?.status === "RESOLVED"
    && validDurableEps(existingMedia)) {
    return Object.freeze({
      ledgerId: String(existing.id),
      mediaApiWriteCount: 0 as const,
      imageId: text(existingMedia.imageId, 200),
      epsImageUrl: text(existingMedia.epsImageUrl, 1_000),
      expirationDate: text(existingMedia.expirationDate, 100) || null,
      sourceImageDigest: text(existingMedia.sourceImageDigest, 80),
      mediaReceiptDigest: text(existingMedia.mediaReceiptDigest, 80),
      reused: true as const,
    })
  }

  const observedAt = new Date().toISOString()
  const baseEvidence = {
    taskId: input.taskId, itemId: input.itemId,
    manifestId: input.manifestId, manifestDigest: input.manifestDigest,
    assetId: input.assetId, assetSha256: input.assetSha256,
    route: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
  }
  const inserted = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").upsert({
      marketplace_account_key: input.accountKey,
      failure_class: "MAYEL_EPS_ASSET_NOT_PREPARED",
      invariant_code: MAYEL_TRADING_MEDIA_LEDGER_INVARIANT,
      mechanism_version: MAYEL_TRADING_MEDIA_LEDGER_MECHANISM,
      evidence_fingerprint: evidenceFingerprint,
      recovery_policy_version: MAYEL_TRADING_MEDIA_LEDGER_MECHANISM,
      // This purpose-built one-shot claim is the only dispatcher. Generic
      // recovery must never repeat an ambiguous Media creation request.
      retry_safety: "ENGINEERING_REQUIRED",
      recovery_class: "ENGINEERING_REQUIRED",
      recovery_outcome: "OBSERVED",
      regression_guard: { mediaCreateMaxCalls: 1,
        ambiguousMediaCreateRetryAllowed: false },
      evidence: baseEvidence,
      status: "OPEN", first_observed_at: observedAt,
      last_observed_at: observedAt, resolved_at: null,
    }, { onConflict:
      "marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version",
      ignoreDuplicates: true }).select("id").maybeSingle()
  if (inserted.error) {
    throw new Error("MAYEL_TRADING_MEDIA_LEDGER_PERSIST_FAILED")
  }
  const reread = inserted.data ? inserted : await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("invariant_code", MAYEL_TRADING_MEDIA_LEDGER_INVARIANT)
    .eq("mechanism_version", MAYEL_TRADING_MEDIA_LEDGER_MECHANISM)
    .eq("evidence_fingerprint", evidenceFingerprint).maybeSingle()
  if (reread.error || !reread.data?.id) {
    throw new Error("MAYEL_TRADING_MEDIA_LEDGER_READBACK_FAILED")
  }
  const workerId = `mayel-media:${randomUUID()}`
  const claimed = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").update({
      lease_owner: workerId,
      lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
      recovery_attempt_count: 1,
      recovery_outcome: "CLAIMED",
      updated_at: new Date().toISOString(),
    }).eq("id", String(reread.data.id)).eq("status", "OPEN")
    .eq("recovery_attempt_count", 0).is("lease_owner", null)
    .select("id").maybeSingle()
  if (claimed.error || !claimed.data) {
    throw new Error("MAYEL_TRADING_MEDIA_SECOND_WRITE_BLOCKED")
  }

  let accessToken = ""
  try {
    accessToken = await getEbayProductionMediaAccessTokenV1(input.fetchImpl)
    const prepared = await prepareMayelAssetWithEbayMediaV1({
      accessToken, sourceImageUrl: input.assetUrl,
      approvedMayelStorageUrl: canonicalAssetUrlAllowed,
      fetchImpl: input.fetchImpl,
    })
    const mediaPreparation = { imageId: prepared.imageId,
      epsImageUrl: prepared.epsImageUrl,
      expirationDate: prepared.expirationDate,
      sourceImageDigest: prepared.sourceImageDigest,
      mediaReceiptDigest: prepared.mediaReceiptDigest }
    const completed = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
        evidence: { ...baseEvidence, mediaPreparation },
        status: "RESOLVED", recovery_outcome: "RECOVERED",
        resolved_at: new Date().toISOString(),
        last_observed_at: new Date().toISOString(),
        lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", String(claimed.data.id)).eq("lease_owner", workerId)
      .select("id,status,evidence").maybeSingle()
    if (completed.error || completed.data?.status !== "RESOLVED"
      || !validDurableEps(record(completed.data.evidence).mediaPreparation)) {
      throw new Error("MAYEL_TRADING_MEDIA_DURABLE_READBACK_FAILED")
    }
    return Object.freeze({ ledgerId: String(completed.data.id),
      mediaApiWriteCount: 1 as const, ...prepared, reused: false as const })
  } catch (error) {
    const errorClass = error instanceof Error
      ? text(error.message, 160) : "MAYEL_TRADING_MEDIA_PREPARATION_FAILED"
    await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
        evidence: { ...baseEvidence, mediaPreparation: {
          status: "FAILED_OR_AMBIGUOUS", errorClass } },
        recovery_outcome: "ENGINEERING_REQUIRED",
        last_observed_at: new Date().toISOString(),
        lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", String(claimed.data.id)).eq("lease_owner", workerId)
    throw error
  } finally {
    accessToken = ""
  }
}

export async function executeMayelTradingVisualLiveCanaryV1(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  expectedItemId: string
  expectedManifestId: string
  expectedBeforeImageDigest: string
  confirmation: string
  fetchImpl?: FetchLike
}) {
  if (!uuid(input.taskId) || !uuid(input.expectedManifestId)
    || !/^\d{9,20}$/.test(input.expectedItemId)
    || !/^sha256:[0-9a-f]{64}$/.test(input.expectedBeforeImageDigest)
    || input.confirmation !== MAYEL_TRADING_VISUAL_LIVE_CANARY_CONFIRMATION) {
    throw new Error("MAYEL_TRADING_VISUAL_CANARY_REQUEST_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const context = await loadContext({ ...input, fetchImpl })
  if (context.execution || context.anyExecution) {
    return Object.freeze({ repeatedRequest: true,
      execution: publicExecution(context.execution ?? context.anyExecution),
      mediaApiWriteCount: 0, tradingListingWriteCount: 0,
      totalEbayWriteOperations: 0,
      mayelVisualE2ePhysicalPass:
        (context.execution ?? context.anyExecution)?.phase ===
          "APPLIED_AND_OFFICIALLY_VERIFIED" })
  }
  if (String(context.task.ebay_item_id) !== input.expectedItemId
    || uuid(context.task.visual_manifest_id) !== input.expectedManifestId
    || context.management.managementModel !== "TRADING_MANAGED"
    || context.correctEbayApi !== "TRADING_API"
    || context.officialReadStatus !== "PASS"
    || context.official?.sourceAuthority ===
      "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1"
    || !context.accountIdentityProven || !context.listingIdentityProven
    || !context.currentImageSetProven || !context.plan.ready
    || typeof context.plan.visualManifestDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(context.plan.visualManifestDigest)
    || context.plan.currentOfficialImageSetDigest !==
      input.expectedBeforeImageDigest
    || context.currentOfficialImageUrls.length !== 1
    || context.plan.proposedFinalOrderedImageUrls.length !== 2
    || context.plan.proposedFinalOrderedImageUrls[0] !==
      context.currentOfficialImageUrls[0]
    || context.plan.fieldsToChange.length !== 1
    || context.plan.fieldsToChange[0] !== "IMAGES_ONLY"
    || !context.official?.protectedFields) {
    throw new Error(context.plan.currentOfficialImageSetDigest !==
      input.expectedBeforeImageDigest
      ? "SAFE_REBASE_REQUIRED" : "MAYEL_TRADING_VISUAL_CANARY_PREFLIGHT_FAILED")
  }
  const delegation = await input.supabase.from(
    "ebay_mayel_visual_delegation_authorities_v1").select("*")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .is("revoked_at", null).maybeSingle()
  if (delegation.error || !delegation.data
    || delegation.data.main_image_authority !== true
    || delegation.data.owner_per_image_approval !== false
    || delegation.data.owner_per_listing_visual_approval !== false) {
    throw new Error("MAYEL_TRADING_VISUAL_DELEGATION_UNAVAILABLE")
  }
  const mayelUrl = context.plan.newMayelSecondaryImages[0]
  const manifestDigest = context.plan.visualManifestDigest
  const asset = context.assets.find((candidate) =>
    text(candidate.public_url, 1_000) === mayelUrl)
  if (!asset || !uuid(asset.id) || !text(asset.output_sha256, 80)
    || !canonicalAssetUrlAllowed(mayelUrl)) {
    throw new Error("MAYEL_TRADING_VISUAL_ASSET_UNPROVEN")
  }
  const before = context.official
  const media = await resolveMayelAssetToDurableEpsV1({
    supabase: input.supabase, accountKey: input.accountKey,
    taskId: input.taskId, itemId: input.expectedItemId,
    manifestId: input.expectedManifestId,
    manifestDigest,
    assetId: uuid(asset.id), assetSha256: text(asset.output_sha256, 80),
    assetUrl: mayelUrl, fetchImpl,
  })
  const exactSet = buildExactMayelTradingPictureSetV1({
    currentOfficialImageUrls: context.currentOfficialImageUrls,
    proposedSourceImageUrls: context.plan.proposedFinalOrderedImageUrls,
    mayelAssetUrl: mayelUrl, preparedMayelEpsUrl: media.epsImageUrl,
  })
  const idempotencyBindingDigest =
    buildMayelTradingVisualIdempotencyBindingV1({
      accountKey: input.accountKey, itemId: input.expectedItemId,
      manifestId: input.expectedManifestId,
      manifestDigest,
      beforeImageDigest: input.expectedBeforeImageDigest,
      proposedImageDigest: exactSet.imageSetDigest,
    })
  const executionId = randomUUID()
  const managementEvidenceDigest = context.management.inventoryEvidenceDigest
    ?? digestCanonical({ model: context.management.managementModel,
      authority: context.management.managementEvidenceSource,
      itemId: input.expectedItemId, sku: context.sku })
  const executionInsert = await input.supabase.from(
    "ebay_mayel_visual_phase_b_executions_v1").insert({
      id: executionId,
      owner_approval_id: delegation.data.id,
      delegation_authority_id: delegation.data.id,
      visual_task_id: context.task.id,
      visual_manifest_id: context.task.visual_manifest_id,
      active_listing_id: context.task.active_listing_id,
      listing_package_id: context.task.listing_package_id,
      owner_user_id: delegation.data.owner_user_id,
      marketplace_account_key: input.accountKey,
      marketplace_id: "EBAY_US", ebay_item_id: input.expectedItemId,
      ebay_sku: context.sku,
      visual_manifest_digest: manifestDigest,
      owner_authorization_digest: delegation.data.authority_digest,
      authorized_current_image_set_digest: input.expectedBeforeImageDigest,
      proposed_final_ordered_image_urls: exactSet.pictureUrls,
      main_image_url: context.currentOfficialImageUrls[0],
      canonical_asset_ids: context.plan.canonicalAssetIds,
      canonical_asset_sha256s: context.plan.canonicalAssetSha256s,
      management_model: "TRADING_MANAGED",
      management_evidence_digest: managementEvidenceDigest,
      executor: MAYEL_TRADING_VISUAL_EXECUTOR_V1,
      phase: "PREFLIGHT", final_state: null,
      marketplace_write_count: 0,
      owner_approved_at: delegation.data.owner_confirmed_at,
      before_image_digest: input.expectedBeforeImageDigest,
      proposed_image_digest: exactSet.imageSetDigest,
      idempotency_binding_digest: idempotencyBindingDigest,
      media_preparation_route: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
      media_image_id: media.imageId, media_eps_url: media.epsImageUrl,
      media_receipt_digest: media.mediaReceiptDigest,
      media_preparation_write_count: media.mediaApiWriteCount,
    }).select("*").single()
  if (executionInsert.error || !executionInsert.data) {
    const databaseCode = text(executionInsert.error?.code, 10)
    const constraint = text(executionInsert.error?.message, 500)
      .match(/constraint\s+"([a-z0-9_]{3,120})"/i)?.[1]
      ?.toUpperCase() ?? null
    console.warn("MAYEL_TRADING_VISUAL_EXECUTION_INSERT_REJECTED", {
      databaseCode: databaseCode || null, constraint,
      mediaApiWriteCount: media.mediaApiWriteCount,
      tradingListingWriteCount: 0,
    })
    throw new Error(databaseCode === "23505"
      ? "MAYEL_TRADING_VISUAL_DUPLICATE_EXECUTION_BLOCKED"
      : constraint
        ? `MAYEL_TRADING_VISUAL_EXECUTION_PERSIST_FAILED_${constraint}`
        : databaseCode
          ? `MAYEL_TRADING_VISUAL_EXECUTION_PERSIST_FAILED_${databaseCode}`
          : "MAYEL_TRADING_VISUAL_EXECUTION_PERSIST_FAILED")
  }
  const claimToken = randomUUID()
  const preflightSnapshot = {
    currentImageDigest: input.expectedBeforeImageDigest,
    manifestBaselineDigest: context.plan.currentOfficialImageSetDigest,
    proposedImageDigest: exactSet.imageSetDigest,
    visualOnlyDiff: true, unauthorizedFieldDiffCount: 0,
    listingActive: true, protectedFields: before.protectedFields,
    mediaLedgerId: media.ledgerId,
  }
  const claim = await input.supabase.rpc(
    "claim_ebay_mayel_trading_visual_write_v1", {
      p_execution_id: executionId,
      p_idempotency_binding_digest: idempotencyBindingDigest,
      p_claim_token: claimToken, p_preflight_snapshot: preflightSnapshot,
    })
  const claimed = Array.isArray(claim.data) ? claim.data[0] : null
  if (claim.error || !claimed) {
    throw new Error("MAYEL_TRADING_VISUAL_DURABLE_CLAIM_FAILED")
  }

  let tradingToken = ""
  let write
  try {
    tradingToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
    write = await reviseMayelTradingPicturesOnceV1({
      accessToken: tradingToken, itemId: input.expectedItemId,
      pictureUrls: exactSet.pictureUrls, durableReviseAttemptCount: 0,
      idempotencyBindingDigest,
      durableSingleWriteClaim: { claimed: true, claimToken,
        idempotencyBindingDigest, reviseCallOrdinal: 1 }, fetchImpl,
    })
    if (write.status === "REJECTED") {
      const failed = await updateExecution({ supabase: input.supabase,
        executionId, phases: ["EXECUTING"], patch: {
          phase: "WRITE_FAILED", final_state: "WRITE_FAILED",
          ebay_response_class: "EBAY_WRITE_REJECTED",
          last_error_code: write.ebayErrorId
            ? `EBAY_TRADING_VISUAL_WRITE_REJECTED_${write.ebayErrorId}`
            : "EBAY_TRADING_VISUAL_WRITE_REJECTED",
          claim_token: null, lease_expires_at: null,
        } })
      return Object.freeze({ execution: publicExecution(failed),
        before, after: null, media, write,
        mediaApiWriteCount: media.mediaApiWriteCount,
        tradingListingWriteCount: 1,
        totalEbayWriteOperations: media.mediaApiWriteCount + 1,
        mayelVisualE2ePhysicalPass: false })
    }
    await updateExecution({ supabase: input.supabase,
      executionId, phases: ["EXECUTING"], patch: {
        phase: "OFFICIAL_READBACK_PENDING",
        ebay_response_class: write.status === "ACCEPTED"
          ? "EBAY_WRITE_ACCEPTED" : "EBAY_WRITE_OUTCOME_UNKNOWN",
        write_accepted_at: write.status === "ACCEPTED"
          ? new Date().toISOString() : null,
      } })
    const after = await readOfficialActiveListingImageSnapshotV1({
      accessToken: tradingToken, itemId: input.expectedItemId,
      expectedSku: context.sku, accountKey: input.accountKey, fetchImpl,
      durableAccountIdentityProven: true,
    })
    const differences = protectedFieldDifferences(
      before.protectedFields as JsonRecord,
      after.protectedFields as JsonRecord)
    const exactImages = JSON.stringify(after.pictureUrls) ===
      JSON.stringify(exactSet.pictureUrls)
    const mainImageUnchanged = after.pictureUrls[0] === before.pictureUrls[0]
    const mayelAssetPresent = after.pictureUrls[1] === media.epsImageUrl
    const verified = after.listingStatus.toLowerCase() === "active"
      && after.pictureUrls.length === 2 && exactImages
      && mainImageUnchanged && mayelAssetPresent && differences.length === 0
    const terminal = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["OFFICIAL_READBACK_PENDING"], patch: {
        phase: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED"
          : "READBACK_MISMATCH",
        final_state: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED"
          : "READBACK_MISMATCH",
        ebay_response_class: verified && write.status === "AMBIGUOUS"
          ? "EBAY_WRITE_CONFIRMED_BY_OFFICIAL_READBACK"
          : write.status === "ACCEPTED" ? "EBAY_WRITE_ACCEPTED"
            : "EBAY_WRITE_OUTCOME_UNKNOWN",
        postwrite_snapshot: {
          listingActive: after.listingStatus.toLowerCase() === "active",
          officialOrderedImageSetMatch: exactImages,
          nonAuthorizedFieldsUnchanged: differences.length === 0,
          mainImageUnchanged, mayelAssetPresent,
          afterImageCount: after.pictureUrls.length,
          afterImageDigest:
            after.tradingPictureReadback?.officialImageSetDigest ?? null,
          unauthorizedFieldDiffCount: differences.length,
          unauthorizedFieldDiffs: differences,
          protectedFields: after.protectedFields,
        },
        postwrite_readback_at: new Date().toISOString(),
        applied_verified_at: verified ? new Date().toISOString() : null,
        last_error_code: verified ? null
          : "MAYEL_TRADING_VISUAL_OFFICIAL_READBACK_MISMATCH",
        claim_token: null, lease_expires_at: null,
      } })
    return Object.freeze({ execution: publicExecution(terminal),
      before, after, media, write,
      beforeImageDigest: before.tradingPictureReadback?.officialImageSetDigest,
      afterImageDigest: after.tradingPictureReadback?.officialImageSetDigest,
      beforeHeroUrlSha256: before.tradingPictureReadback?.images[0]?.urlSha256,
      afterHeroUrlSha256: after.tradingPictureReadback?.images[0]?.urlSha256,
      mainImageChanged: !mainImageUnchanged, mayelAssetPresent,
      protectedFieldDifferences: Object.freeze(differences),
      unauthorizedFieldDiffCount: differences.length,
      mediaApiWriteCount: media.mediaApiWriteCount,
      tradingListingWriteCount: 1,
      totalEbayWriteOperations: media.mediaApiWriteCount + 1,
      ebayAck: write.ack, ebayError: write.ebayErrorId,
      mayelVisualE2ePhysicalPass: verified,
    })
  } catch (error) {
    const errorCode = error instanceof Error
      ? text(error.message, 160) : "MAYEL_TRADING_VISUAL_READBACK_FAILED"
    await updateExecution({ supabase: input.supabase,
      executionId, phases: ["EXECUTING", "OFFICIAL_READBACK_PENDING"],
      patch: { phase: "READBACK_FAILED", final_state: "READBACK_FAILED",
        ebay_response_class: write?.status === "ACCEPTED"
          ? "EBAY_WRITE_ACCEPTED" : "EBAY_WRITE_OUTCOME_UNKNOWN",
        last_error_code: errorCode,
        postwrite_readback_at: new Date().toISOString(),
        claim_token: null, lease_expires_at: null } }).catch(() => null)
    throw error
  } finally {
    tradingToken = ""
  }
}

export async function applyMayelVisualManifestToEbayV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  taskId: string
  visualManifestDigest: string
  confirmation: string
  fetchImpl?: FetchLike
}) {
  if (!uuid(input.ownerUserId) || !uuid(input.taskId)
    || input.confirmation !== MAYEL_VISUAL_PHASE_B_OWNER_CONFIRMATION
    || !/^sha256:[0-9a-f]{64}$/.test(input.visualManifestDigest)) {
    throw new Error("MAYEL_VISUAL_PHASE_B_OWNER_AUTHORIZATION_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let context = await loadContext({ ...input, fetchImpl })
  if (!context.plan.ready
    || context.plan.ownerAuthorizationDigest !== input.visualManifestDigest) {
    throw new Error(context.plan.blocker
      ?? "MAYEL_VISUAL_PHASE_B_AUTHORIZATION_DIGEST_MISMATCH")
  }
  if (!context.managementReady) {
    throw new Error(context.managementBlocker
      ?? "MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN")
  }
  if (context.execution) {
    return { ...publicExecution(context.execution), repeatedRequest: true,
      duplicateMarketplaceWriteCount: 0 }
  }
  const executionId = randomUUID()
  const ownerApprovalId = randomUUID()
  const executor = "EBAY_INVENTORY_CREATE_OR_REPLACE_INVENTORY_ITEM_IMAGE_ONLY_V1"
  const inserted = {
    id: executionId,
    owner_approval_id: ownerApprovalId,
    visual_task_id: context.task.id,
    visual_manifest_id: context.task.visual_manifest_id,
    active_listing_id: context.task.active_listing_id,
    listing_package_id: context.task.listing_package_id,
    owner_user_id: input.ownerUserId,
    marketplace_account_key: input.accountKey,
    marketplace_id: "EBAY_US",
    ebay_item_id: context.task.ebay_item_id,
    ebay_sku: context.sku,
    visual_manifest_digest: input.visualManifestDigest,
    owner_authorization_digest: input.visualManifestDigest,
    authorized_current_image_set_digest:
      context.plan.currentOfficialImageSetDigest,
    proposed_final_ordered_image_urls:
      context.plan.proposedFinalOrderedImageUrls,
    main_image_url: context.plan.currentMainImage,
    canonical_asset_ids: context.plan.canonicalAssetIds,
    canonical_asset_sha256s: context.plan.canonicalAssetSha256s,
    management_model: context.management.managementModel,
    management_evidence_digest: context.management.inventoryEvidenceDigest,
    executor,
    phase: "OWNER_APPROVED",
    final_state: null,
    marketplace_write_count: 0,
    owner_approved_at: new Date().toISOString(),
  }
  const { data: created, error: insertError } = await input.supabase
    .from("ebay_mayel_visual_phase_b_executions_v1")
    .insert(inserted).select("*").single()
  if (insertError || !created) {
    if (insertError?.code === "23505") {
      const { data: existing } = await input.supabase
        .from("ebay_mayel_visual_phase_b_executions_v1").select("*")
        .eq("visual_task_id", input.taskId)
        .eq("visual_manifest_digest", input.visualManifestDigest).maybeSingle()
      if (existing) return { ...publicExecution(existing as JsonRecord),
        repeatedRequest: true, duplicateMarketplaceWriteCount: 0 }
    }
    throw new Error("MAYEL_VISUAL_PHASE_B_OWNER_APPROVAL_PERSIST_FAILED")
  }
  let execution = await updateExecution({ supabase: input.supabase,
    executionId, phases: ["OWNER_APPROVED"], patch: { phase: "PREFLIGHT" } })

  context = await loadContext({ ...input, fetchImpl })
  const assetsRecoverable = await canonicalAssetsRecoverable(
    context.plan.newMayelSecondaryImages, fetchImpl)
  const preflightMatches = context.plan.ready
    && context.plan.visualManifestDigest === input.visualManifestDigest
    && context.plan.currentOfficialImageSetDigest ===
      inserted.authorized_current_image_set_digest
    && context.management.managementModel === inserted.management_model
    && context.management.inventoryEvidenceDigest ===
      inserted.management_evidence_digest
    && assetsRecoverable
  if (!preflightMatches) {
    execution = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["PREFLIGHT"], patch: {
        phase: "AUTHORIZATION_INVALIDATED",
        final_state: "AUTHORIZATION_INVALIDATED",
        last_error_code: "MAYEL_VISUAL_PHASE_B_PREFLIGHT_DRIFT",
        preflight_snapshot: { currentOfficialImageSetDigest:
          context.plan.currentOfficialImageSetDigest,
          visualManifestDigest: context.plan.visualManifestDigest,
          managementModel: context.management.managementModel,
          canonicalAssetsRecoverable: assetsRecoverable },
      } })
    return publicExecution(execution)
  }
  const claimToken = randomUUID()
  const { data: claimed, error: claimError } = await input.supabase
    .from("ebay_mayel_visual_phase_b_executions_v1")
    .update({ phase: "EXECUTING", marketplace_write_count: 1,
      claim_token: claimToken,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      preflight_snapshot: { currentOfficialImageSetDigest:
        context.plan.currentOfficialImageSetDigest,
        visualManifestDigest: context.plan.visualManifestDigest,
        managementModel: context.management.managementModel,
        listingActive: true, canonicalAssetsRecoverable: assetsRecoverable },
      write_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString() })
    .eq("id", executionId).eq("phase", "PREFLIGHT")
    .eq("marketplace_write_count", 0).is("claim_token", null)
    .select("*").maybeSingle()
  if (claimError || !claimed) {
    throw new Error("MAYEL_VISUAL_PHASE_B_WRITE_ALREADY_CLAIMED")
  }
  let write
  try {
    write = await executeEbayInventoryManagedImageMutationV1({
      sku: context.sku,
      itemId: String(context.task.ebay_item_id),
      accountKey: input.accountKey,
      targetImageUrls: context.plan.proposedFinalOrderedImageUrls,
      inventoryItemPayload: context.management.inventoryItemPayload ?? {},
      inventoryEvidenceDigest: context.management.inventoryEvidenceDigest ?? "",
    }, fetchImpl)
  } catch {
    execution = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["EXECUTING"], patch: {
        phase: "READBACK_FAILED", final_state: "READBACK_FAILED",
        ebay_response_class: "EBAY_WRITE_OUTCOME_UNKNOWN",
        last_error_code: "EBAY_INVENTORY_IMAGE_WRITE_OUTCOME_UNKNOWN",
        claim_token: null, lease_expires_at: null,
      } })
    return publicExecution(execution)
  }
  if (!write.ok) {
    execution = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["EXECUTING"], patch: {
        phase: write.outcomeKnown ? "WRITE_FAILED" : "READBACK_FAILED",
        final_state: write.outcomeKnown ? "WRITE_FAILED" : "READBACK_FAILED",
        ebay_response_class: write.outcomeKnown
          ? "EBAY_WRITE_REJECTED" : "EBAY_WRITE_OUTCOME_UNKNOWN",
        last_error_code: write.errorId
          ? `EBAY_INVENTORY_IMAGE_WRITE_REJECTED_${write.errorId}`
          : "EBAY_INVENTORY_IMAGE_WRITE_FAILED",
        claim_token: null, lease_expires_at: null,
      } })
    return publicExecution(execution)
  }
  execution = await updateExecution({ supabase: input.supabase,
    executionId, phases: ["EXECUTING"], patch: {
      phase: "WRITE_ACCEPTED", ebay_response_class: "EBAY_WRITE_ACCEPTED",
      write_accepted_at: new Date().toISOString(),
    } })
  execution = await updateExecution({ supabase: input.supabase,
    executionId, phases: ["WRITE_ACCEPTED"], patch: {
      phase: "OFFICIAL_READBACK_PENDING",
    } })
  try {
    const afterManagement = await prepareEbayActiveListingManagementExecutorV1({
      sku: context.sku, itemId: String(context.task.ebay_item_id),
      accountKey: input.accountKey,
    }, fetchImpl)
    const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
    const afterOfficial = await readOfficialActiveListingImageSnapshotV1({
      accessToken, itemId: String(context.task.ebay_item_id),
      expectedSku: context.sku, accountKey: input.accountKey, fetchImpl,
    })
    const inventoryUrls = record(
      record(afterManagement.inventoryItemPayload).product).imageUrls
    const inventoryImageUrls = Array.isArray(inventoryUrls)
      ? inventoryUrls.map((value) => text(value, 500)) : []
    const inventoryImagesMatch = JSON.stringify(inventoryImageUrls)
      === JSON.stringify(context.plan.proposedFinalOrderedImageUrls)
    const tradingVerification = await verifyOfficialOrderedImageSetV1(
      afterOfficial, context.plan.proposedFinalOrderedImageUrls, fetchImpl)
    const nonAuthorizedFieldsUnchanged = withoutImages(
      context.management.inventoryItemPayload) === withoutImages(
      afterManagement.inventoryItemPayload)
    const verified = afterManagement.managementModel === "INVENTORY_API_MANAGED"
      && inventoryImagesMatch && tradingVerification.verified
      && nonAuthorizedFieldsUnchanged
    execution = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["OFFICIAL_READBACK_PENDING"], patch: {
        phase: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED" : "READBACK_MISMATCH",
        final_state: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED" : "READBACK_MISMATCH",
        postwrite_snapshot: {
          inventoryImagesMatch,
          officialOrderedImageSetMatch: tradingVerification.verified,
          verificationMethod: tradingVerification.method,
          mainImageMatch: afterOfficial.pictureUrls[0] ===
            context.plan.proposedFinalOrderedImageUrls[0]
            || tradingVerification.verified,
          nonAuthorizedFieldsUnchanged,
          officialImageCount: afterOfficial.pictureUrls.length,
          postwriteImageSetDigest: ebayOfficialImageSetDigestV1(
            afterOfficial.pictureUrls),
        },
        postwrite_readback_at: new Date().toISOString(),
        last_error_code: verified ? null : "MAYEL_VISUAL_PHASE_B_READBACK_MISMATCH",
        applied_verified_at: verified ? new Date().toISOString() : null,
        claim_token: null, lease_expires_at: null,
      } })
  } catch {
    execution = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["OFFICIAL_READBACK_PENDING"], patch: {
        phase: "READBACK_FAILED", final_state: "READBACK_FAILED",
        last_error_code: "MAYEL_VISUAL_PHASE_B_OFFICIAL_READBACK_FAILED",
        postwrite_readback_at: new Date().toISOString(),
        claim_token: null, lease_expires_at: null,
      } })
  }
  return { ...publicExecution(execution), repeatedRequest: false,
    duplicateMarketplaceWriteCount: 0 }
}

/**
 * Normal Seller OS execution path for a Trading-managed ordered Mayel
 * manifest under the reusable visual delegation. This is intentionally not
 * exposed as an owner or operator action: the runtime discovers and invokes
 * it after a fresh official read and an atomic durable claim.
 */
export async function executeMayelTradingVisualDelegatedManifestV1(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  fetchImpl?: FetchLike
}) {
  if (!uuid(input.taskId)) {
    throw new Error("MAYEL_TRADING_VISUAL_RUNTIME_TASK_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const context = await loadContext({ ...input, fetchImpl })
  if (context.execution) return Object.freeze({
    status: "ALREADY_EXECUTED" as const,
    execution: publicExecution(context.execution),
    mediaApiWriteCount: 0,
    tradingListingWriteCount: 0,
  })
  if (priorExecutionBlocksCurrentManifest(context)) {
    throw new Error("MAYEL_TRADING_VISUAL_PRIOR_EXECUTION_UNSETTLED")
  }
  if (context.management.managementModel !== "TRADING_MANAGED"
    || context.correctEbayApi !== "TRADING_API"
    || context.officialReadStatus !== "PASS"
    || context.official?.sourceAuthority ===
      "EBAY_BROWSE_GET_ITEM_BY_LEGACY_ID_V1"
    || !context.accountIdentityProven || !context.listingIdentityProven
    || !context.currentImageSetProven || !context.plan.ready
    || context.plan.fieldsToChange.length !== 1
    || context.plan.fieldsToChange[0] !== "IMAGES_ONLY"
    || !context.official?.protectedFields
    || !uuid(context.task.visual_manifest_id)
    || !/^sha256:[0-9a-f]{64}$/.test(
      String(context.plan.visualManifestDigest ?? ""))) {
    throw new Error(context.plan.blocker
      ?? "MAYEL_TRADING_VISUAL_RUNTIME_PREFLIGHT_FAILED")
  }
  const delegation = await input.supabase.from(
    "ebay_mayel_visual_delegation_authorities_v1").select("*")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .is("revoked_at", null).maybeSingle()
  if (delegation.error || !delegation.data
    || delegation.data.main_image_authority !== true
    || delegation.data.owner_per_image_approval !== false
    || delegation.data.owner_per_listing_visual_approval !== false) {
    throw new Error("MAYEL_TRADING_VISUAL_DELEGATION_UNAVAILABLE")
  }
  const selectedAssets = context.plan.proposedFinalOrderedImageUrls.flatMap(
    (url) => {
      const asset = context.assets.find((candidate) =>
        text(candidate.public_url, 1_000) === url)
      return asset && uuid(asset.id) && text(asset.output_sha256, 80)
        && canonicalAssetUrlAllowed(url)
        ? [{ id: uuid(asset.id), sha256: text(asset.output_sha256, 80), url }]
        : []
    })
  const selectedAssetUrls = new Set(selectedAssets.map((asset) => asset.url))
  const unresolvedSources = context.plan.proposedFinalOrderedImageUrls.filter(
    (url) => classifyMayelTradingImageHostV1(url) !== "EBAY_EPS"
      && !selectedAssetUrls.has(url))
  if (!selectedAssets.length || unresolvedSources.length
    || new Set(selectedAssets.map((asset) => asset.id)).size !==
      selectedAssets.length) {
    throw new Error("MAYEL_TRADING_VISUAL_ASSET_UNPROVEN")
  }

  const manifestId = uuid(context.task.visual_manifest_id)
  const manifestDigest = String(context.plan.visualManifestDigest)
  const beforeImageDigest = context.plan.currentOfficialImageSetDigest
  const mediaAssets = [] as Array<Awaited<ReturnType<
    typeof resolveMayelAssetToDurableEpsV1>> & {
      assetId: string
      assetSha256: string
      sourceUrl: string
    }>
  for (const asset of selectedAssets) {
    const media = await resolveMayelAssetToDurableEpsV1({
      supabase: input.supabase, accountKey: input.accountKey,
      taskId: input.taskId, itemId: String(context.task.ebay_item_id),
      manifestId, manifestDigest, assetId: asset.id,
      assetSha256: asset.sha256, assetUrl: asset.url, fetchImpl,
    })
    mediaAssets.push({ ...media, assetId: asset.id,
      assetSha256: asset.sha256, sourceUrl: asset.url })
  }
  const exactSet = buildDelegatedMayelTradingPictureSetV1({
    currentOfficialImageUrls: context.currentOfficialImageUrls,
    proposedSourceImageUrls: context.plan.proposedFinalOrderedImageUrls,
    preparedAssets: mediaAssets.map((media) => ({
      sourceUrl: media.sourceUrl, epsImageUrl: media.epsImageUrl,
    })),
  })
  const idempotencyBindingDigest =
    buildMayelTradingVisualIdempotencyBindingV1({
      accountKey: input.accountKey,
      itemId: String(context.task.ebay_item_id), manifestId, manifestDigest,
      beforeImageDigest, proposedImageDigest: exactSet.imageSetDigest,
    })
  const executionId = randomUUID()
  const firstMedia = mediaAssets[0]
  const mediaWriteCount = mediaAssets.reduce((sum, media) =>
    sum + media.mediaApiWriteCount, 0)
  const aggregateMediaReceiptDigest = digestCanonical(mediaAssets.map(
    (media) => ({ assetId: media.assetId, assetSha256: media.assetSha256,
      imageId: media.imageId, epsImageUrl: media.epsImageUrl,
      mediaReceiptDigest: media.mediaReceiptDigest })))
  const managementEvidenceDigest = context.management.inventoryEvidenceDigest
    ?? digestCanonical({ model: context.management.managementModel,
      authority: context.management.managementEvidenceSource,
      itemId: context.task.ebay_item_id, sku: context.sku })
  const executionInsert = await input.supabase.from(
    "ebay_mayel_visual_phase_b_executions_v1").insert({
      id: executionId,
      owner_approval_id: delegation.data.id,
      delegation_authority_id: delegation.data.id,
      visual_task_id: context.task.id,
      visual_manifest_id: context.task.visual_manifest_id,
      active_listing_id: context.task.active_listing_id,
      listing_package_id: context.task.listing_package_id,
      owner_user_id: delegation.data.owner_user_id,
      marketplace_account_key: input.accountKey,
      marketplace_id: "EBAY_US",
      ebay_item_id: context.task.ebay_item_id,
      ebay_sku: context.sku,
      visual_manifest_digest: manifestDigest,
      owner_authorization_digest: delegation.data.authority_digest,
      authorized_current_image_set_digest: beforeImageDigest,
      proposed_final_ordered_image_urls: exactSet.pictureUrls,
      main_image_url: exactSet.pictureUrls[0],
      canonical_asset_ids: selectedAssets.map((asset) => asset.id),
      canonical_asset_sha256s: selectedAssets.map((asset) => asset.sha256),
      management_model: "TRADING_MANAGED",
      management_evidence_digest: managementEvidenceDigest,
      executor: MAYEL_TRADING_VISUAL_EXECUTOR_V1,
      phase: "PREFLIGHT", final_state: null,
      marketplace_write_count: 0,
      owner_approved_at: delegation.data.owner_confirmed_at,
      before_image_digest: beforeImageDigest,
      proposed_image_digest: exactSet.imageSetDigest,
      idempotency_binding_digest: idempotencyBindingDigest,
      media_preparation_route: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
      media_image_id: firstMedia.imageId,
      media_eps_url: firstMedia.epsImageUrl,
      media_receipt_digest: aggregateMediaReceiptDigest,
      media_preparation_write_count: mediaWriteCount,
      media_assets: mediaAssets.map((media) => ({
        assetId: media.assetId, assetSha256: media.assetSha256,
        imageId: media.imageId, epsImageUrl: media.epsImageUrl,
        expirationDate: media.expirationDate,
        mediaReceiptDigest: media.mediaReceiptDigest,
        reused: media.reused,
      })),
    }).select("*").single()
  if (executionInsert.error || !executionInsert.data) {
    if (executionInsert.error?.code === "23505") {
      return Object.freeze({ status: "ALREADY_CLAIMED" as const,
        execution: null, mediaApiWriteCount: mediaWriteCount,
        tradingListingWriteCount: 0 })
    }
    throw new Error("MAYEL_TRADING_VISUAL_RUNTIME_EXECUTION_PERSIST_FAILED")
  }
  const claimToken = randomUUID()
  const preflightSnapshot = {
    currentImageDigest: beforeImageDigest,
    manifestBaselineDigest: context.plan.currentOfficialImageSetDigest,
    proposedImageDigest: exactSet.imageSetDigest,
    visualOnlyDiff: true, unauthorizedFieldDiffCount: 0,
    listingActive: true, protectedFields: context.official.protectedFields,
    selectedAssetCount: selectedAssets.length,
    mainImageChange: exactSet.mainImageChanged,
  }
  const claim = await input.supabase.rpc(
    "claim_ebay_mayel_trading_visual_write_v1", {
      p_execution_id: executionId,
      p_idempotency_binding_digest: idempotencyBindingDigest,
      p_claim_token: claimToken,
      p_preflight_snapshot: preflightSnapshot,
    })
  const claimed = Array.isArray(claim.data) ? claim.data[0] : null
  if (claim.error || !claimed) {
    throw new Error("MAYEL_TRADING_VISUAL_DURABLE_CLAIM_FAILED")
  }

  let tradingToken = ""
  let write: Awaited<ReturnType<typeof reviseMayelTradingPicturesOnceV1>>
    | null = null
  try {
    tradingToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
    write = await reviseMayelTradingPicturesOnceV1({
      accessToken: tradingToken,
      itemId: String(context.task.ebay_item_id),
      pictureUrls: exactSet.pictureUrls,
      durableReviseAttemptCount: 0, idempotencyBindingDigest,
      durableSingleWriteClaim: { claimed: true, claimToken,
        idempotencyBindingDigest, reviseCallOrdinal: 1 }, fetchImpl,
    })
    if (write.status === "REJECTED") {
      const failed = await updateExecution({ supabase: input.supabase,
        executionId, phases: ["EXECUTING"], patch: {
          phase: "WRITE_FAILED", final_state: "WRITE_FAILED",
          ebay_response_class: "EBAY_WRITE_REJECTED",
          last_error_code: write.ebayErrorId
            ? `EBAY_TRADING_VISUAL_WRITE_REJECTED_${write.ebayErrorId}`
            : "EBAY_TRADING_VISUAL_WRITE_REJECTED",
          claim_token: null, lease_expires_at: null,
        } })
      return Object.freeze({ status: "WRITE_FAILED" as const,
        execution: publicExecution(failed), mediaApiWriteCount: mediaWriteCount,
        tradingListingWriteCount: 1 })
    }
    await updateExecution({ supabase: input.supabase, executionId,
      phases: ["EXECUTING"], patch: {
        phase: "OFFICIAL_READBACK_PENDING",
        ebay_response_class: write.status === "ACCEPTED"
          ? "EBAY_WRITE_ACCEPTED" : "EBAY_WRITE_OUTCOME_UNKNOWN",
        write_accepted_at: write.status === "ACCEPTED"
          ? new Date().toISOString() : null,
      } })
    const after = await readOfficialActiveListingImageSnapshotV1({
      accessToken: tradingToken, itemId: String(context.task.ebay_item_id),
      expectedSku: context.sku, accountKey: input.accountKey, fetchImpl,
      durableAccountIdentityProven: true,
    })
    const differences = protectedFieldDifferences(
      context.official.protectedFields as JsonRecord,
      after.protectedFields as JsonRecord)
    const exactImages = JSON.stringify(after.pictureUrls) ===
      JSON.stringify(exactSet.pictureUrls)
    const heroPositionMatch = after.pictureUrls[0] === exactSet.pictureUrls[0]
    const approvedAssetsPresent = mediaAssets.every((media) =>
      after.pictureUrls.includes(media.epsImageUrl))
    const verified = after.listingStatus.toLowerCase() === "active"
      && exactImages && heroPositionMatch && approvedAssetsPresent
      && differences.length === 0
    const terminal = await updateExecution({ supabase: input.supabase,
      executionId, phases: ["OFFICIAL_READBACK_PENDING"], patch: {
        phase: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED"
          : "READBACK_MISMATCH",
        final_state: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED"
          : "READBACK_MISMATCH",
        ebay_response_class: verified && write.status === "AMBIGUOUS"
          ? "EBAY_WRITE_CONFIRMED_BY_OFFICIAL_READBACK"
          : write.status === "ACCEPTED" ? "EBAY_WRITE_ACCEPTED"
            : "EBAY_WRITE_OUTCOME_UNKNOWN",
        postwrite_snapshot: {
          listingActive: after.listingStatus.toLowerCase() === "active",
          officialOrderedImageSetMatch: exactImages,
          nonAuthorizedFieldsUnchanged: differences.length === 0,
          heroPositionMatch, mainImageUnchanged:
            after.pictureUrls[0] === context.currentOfficialImageUrls[0],
          approvedAssetsPresent, mayelAssetPresent: approvedAssetsPresent,
          afterImageCount: after.pictureUrls.length,
          afterImageDigest:
            after.tradingPictureReadback?.officialImageSetDigest ?? null,
          unauthorizedFieldDiffCount: differences.length,
          unauthorizedFieldDiffs: differences,
          protectedFields: after.protectedFields,
        },
        postwrite_readback_at: new Date().toISOString(),
        applied_verified_at: verified ? new Date().toISOString() : null,
        last_error_code: verified ? null
          : "MAYEL_TRADING_VISUAL_OFFICIAL_READBACK_MISMATCH",
        claim_token: null, lease_expires_at: null,
      } })
    return Object.freeze({ status: verified
      ? "APPLIED_AND_OFFICIALLY_VERIFIED" as const
      : "READBACK_MISMATCH" as const,
    execution: publicExecution(terminal), mediaApiWriteCount: mediaWriteCount,
    tradingListingWriteCount: 1 })
  } catch (error) {
    const errorCode = error instanceof Error
      ? text(error.message, 160) : "MAYEL_TRADING_VISUAL_READBACK_FAILED"
    await updateExecution({ supabase: input.supabase, executionId,
      phases: ["EXECUTING", "OFFICIAL_READBACK_PENDING"], patch: {
        phase: "READBACK_FAILED", final_state: "READBACK_FAILED",
        ebay_response_class: write?.status === "ACCEPTED"
          ? "EBAY_WRITE_ACCEPTED" : "EBAY_WRITE_OUTCOME_UNKNOWN",
        last_error_code: errorCode,
        postwrite_readback_at: new Date().toISOString(),
        claim_token: null, lease_expires_at: null,
      } }).catch(() => null)
    throw error
  } finally {
    tradingToken = ""
  }
}
