import "server-only"

import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildMayelChatGptVisualPromptV1,
  buildMayelProductEvidencePackV1,
  buildMayelVisualManifestV1,
  MAYEL_CHATGPT_VISUAL_PROMPT_VERSION,
  MAYEL_PRODUCT_EVIDENCE_PACK_VERSION,
  MAYEL_VISUAL_OUTPUT_ROLES,
  mayelVisualDigestV1,
  type MayelProductEvidencePackV1,
  type MayelSourceImageReferenceV1,
  type MayelVisualOutputRole,
  validateMayelHumanQaV1,
} from "./ebay-mayel-visual-workstation-v1"
import { normalizeMayelVisualQuarantineOutputV1 } from
  "./ebay-image-optimization-service"

type JsonRecord = Record<string, unknown>

const SOURCE_BUCKET = "ebay-listing-image-sources"
const STAGING_BUCKET = "ebay-listing-image-staging"
const PUBLIC_BUCKET = "ebay-listing-images"
const ACTIVE_EXPERIMENT_STATES = ["READY", "RUNNING", "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE", "PAUSED_FOR_EXTERNAL_SIGNAL"]
const OPEN_TASK_STATES = ["PROMPT_READY", "OUTPUTS_UPLOADED",
  "MAYEL_REVIEW_PENDING", "OWNER_PREVIEW_READY"]

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 1000) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized && normalized.length <= maximum ? normalized : null
}

function uuid(value: unknown) {
  const found = text(value, 40)
  return found && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(found) ? found : null
}

function sha(value: unknown) {
  const found = text(value, 100)
  if (!found) return null
  if (/^sha256:[0-9a-f]{64}$/.test(found)) return found.slice(7)
  return /^[0-9a-f]{64}$/.test(found) ? found : null
}

function httpsUrl(value: unknown) {
  const found = text(value, 3000)
  if (!found) return null
  try {
    const url = new URL(found)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href : null
  } catch {
    return null
  }
}

function sourceReferences(packageDataValue: unknown, sourcePackValue: unknown) {
  const packageData = record(packageDataValue)
  const sourcePack = record(sourcePackValue)
  const sourceAssets = Array.isArray(sourcePack.source_assets)
    ? sourcePack.source_assets.map(record) : []
  const authorizedPack = sourceAssets.flatMap((asset, position) => {
    const storagePath = text(asset.storagePath, 500)
    const digest = sha(asset.sha256 ?? asset.sourceSha256)
    const authorizationStatus = text(asset.authorizationStatus, 100)
    if (!storagePath || !digest ||
        !authorizationStatus?.startsWith("AUTHORIZED_CATALOG")) return []
    return [{ referenceId: text(asset.sourceImageId, 100) ??
      `LUNA_SOURCE_${position + 1}`, sha256: digest,
      url: httpsUrl(asset.sourceUrl), storagePath,
      authority: "AUTHORIZED_LUNA_SOURCE_PACK" as const, position }]
  })
  if (authorizedPack.length) return authorizedPack.slice(0, 24)
  const manifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(record) : []
  return manifest.flatMap((asset, position) => {
    const url = httpsUrl(asset.url)
    const digest = sha(asset.sha256)
    const referenceId = uuid(asset.assetId)
    if (!url || !digest || !referenceId || asset.automaticQa !== "PASSED") return []
    return [{ referenceId, sha256: digest, url, storagePath: null,
      authority: "APPROVED_CANONICAL_LISTING_ASSET" as const, position }]
  }).slice(0, 24)
}

function currentImageUrls(packageDataValue: unknown) {
  const packageData = record(packageDataValue)
  const values = Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls : []
  return [...new Set(values.map(httpsUrl)
    .filter((value): value is string => Boolean(value)))].slice(0, 24)
}

export type MayelVisualWorkstationTaskV1 = Readonly<{
  visualTaskId: string
  ebayItemId: string
  sku: string
  productTitle: string
  status: string
  evidencePack: JsonRecord
  prompt: string
  promptVersion: string
  promptDigest: string
  sourceImageSetDigest: string
  productTruthDigest: string
  sourceImages: readonly MayelSourceImageReferenceV1[]
  currentImages: readonly string[]
  outputs: readonly JsonRecord[]
  visualManifest: JsonRecord | null
  visualManifestDigest: string | null
  marketplaceWriteCapability: false
}>

async function existingOpenTask(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
}) {
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .select("*")
    .eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId)
    .in("status", OPEN_TASK_STATES)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("MAYEL_VISUAL_TASK_READ_FAILED")
  return data as JsonRecord | null
}

export async function ensureMayelVisualTaskV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
}) {
  const existing = await existingOpenTask(input)
  if (existing) return { created: false, task: existing,
    canaryAvailable: true }

  const { data: signalRows, error: signalError } = await input.supabase
    .from("ebay_listing_quality_report_signals")
    .select("id,item_id,signal_type,priority_class,product_truth_supported,operator_action_required,report_observed_at,what_is_happening,why_it_matters,seller_os_recommendation")
    .eq("marketplace_account_key", input.accountKey)
    .eq("current_live", true).eq("exact_item_id_match", true)
    .in("signal_type", ["IMAGE_REVIEW", "VISUAL_COVERAGE_REVIEW",
      "GENERAL_LISTING_QUALITY", "LISTING_QUALITY_SPECIFIC_RECOMMENDATION"])
    .order("report_observed_at", { ascending: false }).limit(50)
  if (signalError) throw new Error("MAYEL_VISUAL_SIGNAL_READ_FAILED")
  for (const signal of (signalRows ?? []) as JsonRecord[]) {
    const itemId = text(signal.item_id, 20)
    if (!itemId || !/^\d{9,20}$/.test(itemId)) continue
    const [{ data: link, error: linkError }, { data: active, error: activeError },
      { data: experiment, error: experimentError },
      { data: duplicateTask, error: duplicateError }] = await Promise.all([
      input.supabase.from("ebay_manual_listing_links")
        .select("id,opportunity_id,candidate_key,supplier_variant_id,supplier_sku,connector_listing_id")
        .eq("account_key", input.accountKey).eq("ebay_item_id", itemId)
        .eq("verification_status", "verified").maybeSingle(),
      input.supabase.from("ebay_active_listings")
        .select("id,title,ebay_sku,supplier_sku,listing_status,raw_payload")
        .eq("ebay_item_id", itemId).eq("listing_status", "active")
        .maybeSingle(),
      input.supabase.from("ebay_listing_experiments_v1")
        .select("experiment_id,lifecycle_status").eq("account_key", input.accountKey)
        .eq("ebay_item_id", itemId).in("lifecycle_status",
          ACTIVE_EXPERIMENT_STATES).limit(1).maybeSingle(),
      input.supabase.from("ebay_mayel_visual_tasks_v1").select("id")
        .eq("marketplace_account_key", input.accountKey)
        .eq("ebay_item_id", itemId).in("status", OPEN_TASK_STATES)
        .limit(1).maybeSingle(),
    ])
    if (linkError || activeError || experimentError || duplicateError) {
      throw new Error("MAYEL_VISUAL_ELIGIBILITY_READ_FAILED")
    }
    if (!link || !active || experiment || duplicateTask ||
        link.connector_listing_id !== active.id) continue
    const { data: listingPackage, error: packageError } = await input.supabase
      .from("ebay_listing_packages").select("id,opportunity_id,candidate_key,status,package_data")
      .eq("opportunity_id", link.opportunity_id).eq("status", "approved")
      .maybeSingle()
    if (packageError) throw new Error("MAYEL_VISUAL_PACKAGE_READ_FAILED")
    if (!listingPackage || listingPackage.candidate_key !== link.candidate_key) continue
    const { data: sourcePack, error: sourceError } = await input.supabase
      .from("luna_catalog_authorized_source_packs")
      .select("id,source_assets,source_pack_hash")
      .eq("marketplace_account_key", input.accountKey)
      .eq("listing_package_id", listingPackage.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (sourceError) throw new Error("MAYEL_VISUAL_SOURCE_PACK_READ_FAILED")
    const refs = sourceReferences(listingPackage.package_data, sourcePack)
    const currentImages = currentImageUrls(listingPackage.package_data)
    if (!refs.length || !currentImages.length) continue
    let evidencePack
    try {
      evidencePack = buildMayelProductEvidencePackV1({ ebayItemId: itemId,
        sku: text(link.supplier_sku ?? active.supplier_sku ?? active.ebay_sku,
          100) ?? "",
        packageData: listingPackage.package_data, sourceImages: refs })
    } catch {
      continue
    }
    const prompt = buildMayelChatGptVisualPromptV1(evidencePack)
    const selectionSignal = {
      signalId: uuid(signal.id), signalType: text(signal.signal_type, 80),
      priorityClass: text(signal.priority_class, 40),
      observedAt: text(signal.report_observed_at, 80),
      productTruthSupported: signal.product_truth_supported === true,
      summary: text(signal.what_is_happening, 500),
      whyItMatters: text(signal.why_it_matters, 500),
      recommendation: text(signal.seller_os_recommendation, 500),
    }
    const row = {
      marketplace_account_key: input.accountKey, ebay_item_id: itemId,
      active_listing_id: active.id, manual_listing_link_id: link.id,
      opportunity_id: link.opportunity_id,
      listing_package_id: listingPackage.id,
      candidate_key: listingPackage.candidate_key,
      assigned_operator_user_id: input.actorUserId,
      selection_authority: "EBAY_LISTING_QUALITY_VISUAL_SIGNAL",
      selection_signal: selectionSignal,
      evidence_pack_version: MAYEL_PRODUCT_EVIDENCE_PACK_VERSION,
      evidence_pack: evidencePack,
      product_truth_version: evidencePack.productTruthVersion,
      product_truth_digest: evidencePack.productTruthDigest,
      source_image_references: refs,
      source_image_set_digest: evidencePack.sourceImageSetDigest,
      current_image_set: currentImages,
      prompt_contract_version: MAYEL_CHATGPT_VISUAL_PROMPT_VERSION,
      prompt_text: prompt.text, prompt_digest: prompt.digest,
      status: "PROMPT_READY",
    }
    const { data: created, error: createError } = await input.supabase
      .from("ebay_mayel_visual_tasks_v1").insert(row).select("*").single()
    if (!createError && created) return { created: true, task: created,
      canaryAvailable: true }
    if (createError?.code === "23505") {
      const reconciled = await existingOpenTask(input)
      if (reconciled) return { created: false, task: reconciled,
        canaryAvailable: true }
    }
    throw new Error("MAYEL_VISUAL_TASK_CREATE_FAILED")
  }
  return { created: false, task: null, canaryAvailable: false }
}

async function taskForActor(input: { supabase: SupabaseClient
  accountKey: string; actorUserId: string; taskId: string }) {
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1").select("*")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId).maybeSingle()
  if (error || !data || data.status === "CANCELLED") {
    throw new Error("MAYEL_VISUAL_TASK_NOT_AVAILABLE")
  }
  return data as JsonRecord
}

export async function uploadMayelVisualOutputV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  taskId: string
  role: MayelVisualOutputRole
  declaredMimeType: string
  file: Buffer
  rightsConfirmed: boolean
}) {
  if (!MAYEL_VISUAL_OUTPUT_ROLES.includes(input.role) ||
      input.rightsConfirmed !== true) {
    input.file.fill(0)
    throw new Error("MAYEL_VISUAL_UPLOAD_CONTRACT_INVALID")
  }
  const task = await taskForActor(input)
  const slot = buildMayelChatGptVisualPromptV1(
    task.evidence_pack as MayelProductEvidencePackV1,
  ).slots.find((entry) => entry.role === input.role)
  if (!slot || slot.status !== "READY") {
    input.file.fill(0)
    throw new Error("MAYEL_VISUAL_SLOT_BLOCKED_MISSING_EVIDENCE")
  }
  const { count, error: countError } = await input.supabase
    .from("ebay_listing_image_assets").select("id", { count: "exact",
      head: true }).eq("mayel_visual_task_id", input.taskId)
    .in("status", ["pending_review", "approved"])
  if (countError) throw new Error("MAYEL_VISUAL_OUTPUT_COUNT_FAILED")
  if ((count ?? 0) >= 6) {
    input.file.fill(0)
    throw new Error("MAYEL_VISUAL_OUTPUT_LIMIT_REACHED")
  }
  const normalized = await normalizeMayelVisualQuarantineOutputV1({
    source: input.file, declaredMimeType: input.declaredMimeType })
  const assetId = randomUUID()
  const extension = normalized.source.format === "jpeg" ? "jpg" :
    normalized.source.format
  const sourcePath = `mayel-visual/${input.taskId}/${assetId}/source-${normalized.sourceSha256}.${extension}`
  const stagingPath = `mayel-visual/${input.taskId}/${assetId}/normalized-${normalized.outputSha256}.jpg`
  const raw = Buffer.from(input.file)
  const sourceUpload = await input.supabase.storage.from(SOURCE_BUCKET)
    .upload(sourcePath, raw, { contentType: normalized.actualMimeType,
      upsert: false })
  raw.fill(0)
  input.file.fill(0)
  if (sourceUpload.error) {
    normalized.output.fill(0)
    throw new Error("MAYEL_VISUAL_QUARANTINE_UPLOAD_FAILED")
  }
  const stagingUpload = await input.supabase.storage.from(STAGING_BUCKET)
    .upload(stagingPath, normalized.output, { contentType: "image/jpeg",
      upsert: false })
  if (stagingUpload.error) {
    await input.supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
    normalized.output.fill(0)
    throw new Error("MAYEL_VISUAL_STAGING_UPLOAD_FAILED")
  }
  const roleMap: Record<MayelVisualOutputRole,
    "detail" | "packaging" | "label" | "lifestyle"> = {
    DETAIL: "detail", PACKAGE_CONTENTS: "packaging", DIMENSIONS: "label",
    PRIMARY_BENEFIT: "detail", LIFESTYLE: "lifestyle",
    HUMAN_USE: "lifestyle",
  }
  const uploadedAt = new Date().toISOString()
  const provenance = {
    sourceType: "CHATGPT_SUBSCRIPTION_MAYEL", uploadedByRole: "MAYEL",
    uploadedByUserId: input.actorUserId,
    uploadedAt,
    visualTaskId: input.taskId, ebayItemId: task.ebay_item_id,
    outputRole: input.role,
    sourceImageReferences: task.source_image_references,
    sourceImageSetDigest: task.source_image_set_digest,
    productTruthVersion: task.product_truth_version,
    productTruthDigest: task.product_truth_digest,
    promptContractVersion: task.prompt_contract_version,
    generatedImageIsPresentationAsset: true,
    generatedImageIsProductTruthAuthority: false,
    chatGptCredentialStored: false, chatGptConversationStored: false,
  }
  const { data: asset, error: assetError } = await input.supabase
    .from("ebay_listing_image_assets").insert({ id: assetId,
      created_by: input.actorUserId, opportunity_id: task.opportunity_id,
      listing_package_id: null, candidate_key: task.candidate_key,
      asset_role: roleMap[input.role], status: "pending_review",
      source_kind: "owned_upload", source_url: null,
      source_storage_path: sourcePath, output_storage_path: stagingPath,
      source_sha256: normalized.sourceSha256,
      output_sha256: normalized.outputSha256,
      source_width: normalized.source.width,
      source_height: normalized.source.height,
      output_width: 1600, output_height: 1600,
      output_bytes: normalized.outputMetadata.bytes,
      rights_basis: "owned",
      authorization_reference: `MAYEL_CHATGPT_SUBSCRIPTION:${input.taskId}`,
      rights_evidence_confirmed: true,
      transformation_version: "MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1",
      transformation: { method: "PRESERVED_FULL_FRAME",
        output: "1600_SQUARE_JPEG", generativeAiUsedBySellerOs: false },
      qa_result: normalized.qa,
      position: MAYEL_VISUAL_OUTPUT_ROLES.indexOf(input.role),
      mayel_visual_task_id: input.taskId, uploaded_by: input.actorUserId,
      source_type: "CHATGPT_SUBSCRIPTION_MAYEL",
      mayel_output_role: input.role,
      declared_mime_type: input.declaredMimeType,
      actual_mime_type: normalized.actualMimeType,
      source_image_references: task.source_image_references,
      source_image_set_digest: task.source_image_set_digest,
      product_truth_version: task.product_truth_version,
      product_truth_digest: task.product_truth_digest,
      prompt_contract_version: task.prompt_contract_version,
      mayel_approval_status: "PENDING", owner_approval_status: "PENDING",
      provenance, created_at: uploadedAt,
    }).select("*").single()
  normalized.output.fill(0)
  if (assetError || !asset) {
    await Promise.all([
      input.supabase.storage.from(SOURCE_BUCKET).remove([sourcePath]),
      input.supabase.storage.from(STAGING_BUCKET).remove([stagingPath]),
    ])
    throw new Error(assetError?.code === "23505"
      ? "MAYEL_VISUAL_DUPLICATE_ROLE_OR_HASH" :
        "MAYEL_VISUAL_ASSET_PERSIST_FAILED")
  }
  const { error: taskError } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .update({ status: "MAYEL_REVIEW_PENDING",
      updated_at: new Date().toISOString() }).eq("id", input.taskId)
    .eq("assigned_operator_user_id", input.actorUserId)
  if (taskError) throw new Error("MAYEL_VISUAL_TASK_STATE_UPDATE_FAILED")
  return asset
}

async function reconcilePublicUpload(input: { supabase: SupabaseClient
  path: string; bytes: Buffer; outputSha256: string }) {
  const upload = await input.supabase.storage.from(PUBLIC_BUCKET)
    .upload(input.path, input.bytes, { contentType: "image/jpeg",
      upsert: false, cacheControl: "31536000" })
  if (!upload.error) return
  const existing = await input.supabase.storage.from(PUBLIC_BUCKET)
    .download(input.path)
  if (existing.error) throw new Error("MAYEL_VISUAL_CANONICAL_UPLOAD_FAILED")
  const existingBytes = Buffer.from(await existing.data.arrayBuffer())
  const digest = createHash("sha256").update(existingBytes).digest("hex")
  existingBytes.fill(0)
  if (digest !== input.outputSha256) {
    throw new Error("MAYEL_VISUAL_CANONICAL_PATH_CONFLICT")
  }
}

async function refreshManifest(input: { supabase: SupabaseClient
  task: JsonRecord }) {
  const { data: rows, error } = await input.supabase
    .from("ebay_listing_image_assets")
    .select("id,mayel_output_role,output_sha256,public_url")
    .eq("mayel_visual_task_id", input.task.id).eq("status", "approved")
    .eq("mayel_approval_status", "APPROVED")
  if (error) throw new Error("MAYEL_VISUAL_MANIFEST_ASSET_READ_FAILED")
  const assets = (rows ?? []).flatMap((row) => {
    const role = text(row.mayel_output_role, 40) as MayelVisualOutputRole | null
    const publicUrl = httpsUrl(row.public_url)
    const outputSha256 = sha(row.output_sha256)
    return uuid(row.id) && role && MAYEL_VISUAL_OUTPUT_ROLES.includes(role) &&
      publicUrl && outputSha256 ? [{ assetId: row.id, role, outputSha256,
        publicUrl }] : []
  })
  if (!assets.length) return null
  const manifest = buildMayelVisualManifestV1({
    visualTaskId: String(input.task.id),
    ebayItemId: String(input.task.ebay_item_id),
    currentImages: Array.isArray(input.task.current_image_set)
      ? input.task.current_image_set.filter((url): url is string =>
        Boolean(httpsUrl(url)))
      : [], assets,
    productTruthDigest: String(input.task.product_truth_digest),
    sourceImageSetDigest: String(input.task.source_image_set_digest) })
  const { error: updateError } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .update({ status: "OWNER_PREVIEW_READY", visual_manifest: manifest,
      visual_manifest_digest: manifest.visualManifestDigest,
      updated_at: new Date().toISOString() }).eq("id", input.task.id)
  if (updateError) throw new Error("MAYEL_VISUAL_MANIFEST_PERSIST_FAILED")
  return manifest
}

export async function reviewMayelVisualOutputV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  taskId: string
  assetId: string
  decision: "APPROVE" | "REJECT"
  humanQa?: unknown
  rejectionReason?: string | null
}) {
  const task = await taskForActor(input)
  const { data: asset, error } = await input.supabase
    .from("ebay_listing_image_assets").select("*")
    .eq("id", input.assetId).eq("mayel_visual_task_id", input.taskId)
    .eq("uploaded_by", input.actorUserId).maybeSingle()
  if (error || !asset) throw new Error("MAYEL_VISUAL_ASSET_NOT_FOUND")
  if (asset.status === "approved" && input.decision === "APPROVE") {
    return { asset, manifest: await refreshManifest({ supabase: input.supabase,
      task }), idempotent: true }
  }
  if (asset.status !== "pending_review" ||
      asset.mayel_approval_status !== "PENDING") {
    throw new Error("MAYEL_VISUAL_REVIEW_ALREADY_FINAL")
  }
  if (input.decision === "REJECT") {
    const allowed = ["IDENTITY_DRIFT", "INCORRECT_COLOR",
      "INVENTED_ACCESSORY", "INCORRECT_TEXT", "INCORRECT_DIMENSION",
      "LOW_QUALITY", "ROLE_MISMATCH", "OTHER_SAFE_REASON"]
    if (!input.rejectionReason || !allowed.includes(input.rejectionReason)) {
      throw new Error("MAYEL_VISUAL_REJECTION_REASON_REQUIRED")
    }
    const { data: rejected, error: rejectError } = await input.supabase
      .from("ebay_listing_image_assets").update({ status: "rejected",
        mayel_approval_status: "REJECTED", rejected_at: new Date().toISOString(),
        qa_result: { ...record(asset.qa_result), humanReview: {
          decision: "REJECT", reason: input.rejectionReason,
          reviewedBy: input.actorUserId } } })
      .eq("id", input.assetId).eq("status", "pending_review")
      .select("*").single()
    if (rejectError || !rejected) throw new Error("MAYEL_VISUAL_REJECT_FAILED")
    return { asset: rejected, manifest: null, idempotent: false }
  }
  const role = text(asset.mayel_output_role, 40) as MayelVisualOutputRole
  if (!MAYEL_VISUAL_OUTPUT_ROLES.includes(role) ||
      !validateMayelHumanQaV1(input.humanQa, role)) {
    throw new Error("MAYEL_VISUAL_HUMAN_QA_INCOMPLETE")
  }
  const staged = await input.supabase.storage.from(STAGING_BUCKET)
    .download(String(asset.output_storage_path))
  if (staged.error) throw new Error("MAYEL_VISUAL_STAGING_READ_FAILED")
  const bytes = Buffer.from(await staged.data.arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== asset.output_sha256 || bytes.length !== asset.output_bytes) {
    bytes.fill(0)
    throw new Error("MAYEL_VISUAL_STAGING_READBACK_MISMATCH")
  }
  const publicPath = `mayel-visual/${input.taskId}/${input.assetId}/${asset.output_sha256}.jpg`
  await reconcilePublicUpload({ supabase: input.supabase, path: publicPath,
    bytes, outputSha256: asset.output_sha256 })
  bytes.fill(0)
  const publicUrl = input.supabase.storage.from(PUBLIC_BUCKET)
    .getPublicUrl(publicPath).data.publicUrl
  const { data: approved, error: approveError } = await input.supabase
    .from("ebay_listing_image_assets").update({ status: "approved",
      mayel_approval_status: "APPROVED", approved_at: new Date().toISOString(),
      approved_by: input.actorUserId, published_storage_path: publicPath,
      public_url: publicUrl, qa_result: { ...record(asset.qa_result),
        humanReview: { decision: "APPROVE", checks: input.humanQa,
          reviewedBy: input.actorUserId } } })
    .eq("id", input.assetId).eq("status", "pending_review")
    .select("*").single()
  if (approveError || !approved) {
    throw new Error("MAYEL_VISUAL_APPROVAL_PERSIST_FAILED")
  }
  return { asset: approved,
    manifest: await refreshManifest({ supabase: input.supabase, task }),
    idempotent: false }
}

export async function readMayelVisualWorkstationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  ownerView: boolean
}) {
  let query = input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("*").eq("marketplace_account_key", input.accountKey)
    .in("status", OPEN_TASK_STATES).order("created_at", { ascending: false })
    .limit(input.ownerView ? 20 : 1)
  if (!input.ownerView) query = query.eq("assigned_operator_user_id",
    input.actorUserId)
  const { data: taskRows, error } = await query
  if (error) throw new Error("MAYEL_VISUAL_WORKSTATION_READ_FAILED")
  const tasks = []
  for (const task of (taskRows ?? []) as JsonRecord[]) {
    const { data: outputRows, error: outputError } = await input.supabase
      .from("ebay_listing_image_assets")
      .select("id,status,mayel_output_role,source_sha256,output_sha256,source_width,source_height,output_width,output_height,output_bytes,qa_result,mayel_approval_status,owner_approval_status,output_storage_path,public_url,created_at,approved_at")
      .eq("mayel_visual_task_id", task.id).order("position",
        { ascending: true })
    if (outputError) throw new Error("MAYEL_VISUAL_OUTPUT_READ_FAILED")
    const outputs = []
    for (const output of outputRows ?? []) {
      let previewUrl = httpsUrl(output.public_url)
      let previewExpiresInSeconds: number | null = null
      if (!previewUrl && output.status === "pending_review") {
        const signed = await input.supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(output.output_storage_path, 300)
        previewUrl = signed.error ? null : signed.data.signedUrl
        previewExpiresInSeconds = previewUrl ? 300 : null
      }
      outputs.push({ ...output, previewUrl, previewExpiresInSeconds })
    }
    const evidence = record(task.evidence_pack)
    const promptContract = buildMayelChatGptVisualPromptV1(
      evidence as MayelProductEvidencePackV1,
    )
    const sourceImages = []
    for (const rawSource of (Array.isArray(task.source_image_references)
      ? task.source_image_references : [])) {
      const source = record(rawSource)
      let url = httpsUrl(source.url)
      if (!url && text(source.storagePath, 500)) {
        const signed = await input.supabase.storage.from(SOURCE_BUCKET)
          .createSignedUrl(String(source.storagePath), 300)
        if (!signed.error) url = signed.data.signedUrl
      }
      sourceImages.push({ ...source, url })
    }
    tasks.push({ visualTaskId: String(task.id), ebayItemId: String(task.ebay_item_id),
      sku: String(evidence.sku ?? ""),
      productTitle: String(evidence.productTitle ?? ""),
      status: String(task.status), evidencePack: evidence,
      prompt: String(task.prompt_text),
      promptSlots: promptContract.slots,
      promptVersion: String(task.prompt_contract_version),
      promptDigest: String(task.prompt_digest),
      sourceImageSetDigest: String(task.source_image_set_digest),
      productTruthDigest: String(task.product_truth_digest),
      sourceImages: sourceImages as MayelSourceImageReferenceV1[],
      currentImages: task.current_image_set as string[], outputs,
      visualManifest: task.visual_manifest ? record(task.visual_manifest) : null,
      visualManifestDigest: text(task.visual_manifest_digest, 100),
      marketplaceWriteCapability: false as const })
  }
  return { contractVersion: "MAYEL_VISUAL_WORKSTATION_READ_MODEL_V1",
    tasks, counts: { visualTasks: tasks.length,
      separatePrompts: tasks.length,
      openAiTextCalls: 0, openAiImageCalls: 0, marketplaceWrites: 0 },
    safety: { chatGptUiAutomation: false, chatGptCredentialStorage: false,
      localFileDirectToEbay: false, canonicalAssetRequired: true,
      autoPublish: false, phaseAEbayWriteCapability: false } }
}
