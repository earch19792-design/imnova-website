import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  readOfficialActiveListingImageSnapshotV1,
  verifyOfficialOrderedImageSetV1,
} from "./ebay-active-listing-image-revision-service"
import {
  executeEbayInventoryManagedImageMutationV1,
  prepareEbayActiveListingManagementExecutorV1,
} from "./ebay-draft-only-gateway"
import { getEbayTradingReadOnlyAccessToken } from
  "./ebay-manual-listing-trading-readonly"
import {
  buildMayelVisualPhaseBRebaseV1,
  buildMayelVisualPhaseBPlanV1,
  ebayOfficialImageSetDigestV1,
} from "./ebay-mayel-visual-phase-b-v1"

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
    { data: anyExecution, error: anyExecutionError }] = await Promise.all([
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
      .select("id,visual_manifest_digest,phase,marketplace_write_count")
      .eq("visual_task_id", task.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (activeError || !active || active.listing_status !== "active"
    || assetsError || executionError || anyExecutionError) {
    throw new Error("MAYEL_VISUAL_PHASE_B_DURABLE_CONTEXT_INVALID")
  }
  const sku = text(active.ebay_sku, 50)
  if (!sku) throw new Error("MAYEL_VISUAL_PHASE_B_EBAY_SKU_MISSING")
  const [accessToken, management] = await Promise.all([
    getEbayTradingReadOnlyAccessToken(input.fetchImpl),
    prepareEbayActiveListingManagementExecutorV1({
      sku, itemId: String(task.ebay_item_id), accountKey: input.accountKey,
    }, input.fetchImpl),
  ])
  const official = await readOfficialActiveListingImageSnapshotV1({
    accessToken, itemId: String(task.ebay_item_id), expectedSku: sku,
    accountKey: input.accountKey, fetchImpl: input.fetchImpl,
  })
  const inventoryImageUrls = Array.isArray(record(
    record(management.inventoryItemPayload).product).imageUrls)
    ? record(record(management.inventoryItemPayload).product).imageUrls as unknown[]
    : []
  const currentOfficialImageUrls = management.managementModel ===
    "INVENTORY_API_MANAGED"
    ? inventoryImageUrls.map((value) => text(value, 1_000)).filter(Boolean)
    : official.pictureUrls
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
    canonicalPublicAssetUrlAllowed: canonicalAssetUrlAllowed,
  })
  const managementReady = management.managementModel === "INVENTORY_API_MANAGED"
  const managementBlocker = management.managementModel === "TRADING_MANAGED"
    ? "MAYEL_VISUAL_TRADING_EXECUTOR_EXPLICITLY_GATED_SINGLE_WRITE_CONTRACT"
    : management.managementModel === "MANAGEMENT_MODEL_UNPROVEN"
      ? "MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN" : null
  return { task: task as JsonRecord, active: active as JsonRecord,
    assets: (assets ?? []) as JsonRecord[], execution: execution as JsonRecord | null,
    anyExecution: anyExecution as JsonRecord | null,
    official, currentOfficialImageUrls, plan, management, sku,
    managementReady, managementBlocker, rebase }
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
  return {
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
    account: "Cuenta eBay vinculada",
    marketplace: "EBAY_US",
    managementModel: context.management.managementModel,
    managementModelAuthority: context.management.managementEvidenceSource,
    managementDiagnostics: {
      inventoryHttpStatus: context.management.inventoryHttpStatus,
      offersHttpStatus: context.management.offersHttpStatus,
      inventoryItemPresent: context.management.inventoryItemPresent,
      offersReadComplete: context.management.offersReadComplete,
      exactPublishedOfferCount: context.management.exactPublishedOfferCount,
      groupedInventoryItem: context.management.groupedInventoryItem,
    },
    safeRebaseAvailable: context.plan.blocker ===
      "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
      && context.rebase.safe
      && context.management.managementModel !== "MANAGEMENT_MODEL_UNPROVEN"
      && !context.anyExecution,
    mayelAssetPreserved: context.rebase.mayelAssetPreserved,
    mayelReworkRequired: context.rebase.mayelReworkRequired,
    rebaseBlocker: context.rebase.blocker,
    ownerCtaAvailable: context.plan.ready && context.managementReady
      && !context.execution,
    blocker: context.plan.blocker ?? context.managementBlocker,
    tradingExecutorExplicitlyGated:
      context.management.managementModel === "TRADING_MANAGED",
    execution: publicExecution(context.execution),
    safety: { getIsReadOnly: true, mainImageProtected: true,
      localFileDirectToEbay: false, autoPublish: false,
      ownerApprovalRequired: true },
  }
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
  if (context.anyExecution) {
    throw new Error("MAYEL_VISUAL_REBASE_OWNER_AUTHORIZATION_EXISTS")
  }
  if (context.task.visual_manifest_digest !== input.expectedVisualManifestDigest) {
    throw new Error("MAYEL_VISUAL_REBASE_STALE_PREVIEW")
  }
  if (context.management.managementModel === "MANAGEMENT_MODEL_UNPROVEN") {
    throw new Error("MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN")
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
