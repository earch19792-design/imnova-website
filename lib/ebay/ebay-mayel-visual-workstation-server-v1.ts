import "server-only"

import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildMayelChatGptVisualPromptV1,
  buildMayelCurrentLiveVisualEvidencePackV1,
  buildMayelOrderedVisualManifestV2,
  buildMayelProductEvidencePackV1,
  deriveMayelVisualPromptSnapshotV1,
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
import { loadSellerOsAssistantMonitorV1 } from
  "./ebay-seller-os-assistant-runtime"
import { currentLiveListingsForMonitorV1 } from
  "./ebay-seller-os-live-portfolio-integrity-v1"

type JsonRecord = Record<string, unknown>

const SOURCE_BUCKET = "ebay-listing-image-sources"
const STAGING_BUCKET = "ebay-listing-image-staging"
const PUBLIC_BUCKET = "ebay-listing-images"
const ACTIVE_EXPERIMENT_STATES = ["READY", "RUNNING", "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE", "PAUSED_FOR_EXTERNAL_SIGNAL"]
const OPEN_TASK_STATES = ["PROMPT_READY", "OUTPUTS_UPLOADED",
  "MAYEL_REVIEW_PENDING", "OWNER_PREVIEW_READY"]

type AuthoritativeLiveVisualListingV1 = Readonly<{
  itemId: string
  title: string | null
  sku: string | null
  currentImageUrl: string
  observedAt: string | null
  highVisualPriority: boolean
}>

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

async function authoritativeLiveVisualPortfolioV1() {
  const monitor = await loadSellerOsAssistantMonitorV1()
  const listings = currentLiveListingsForMonitorV1(monitor).flatMap((listing) => {
    const itemId = text(listing.identity.itemId, 20)
    const currentImageUrl = httpsUrl(listing.identity.primaryImageUrl)
    const decision = monitor.backend.decisions.find((entry) =>
      entry.listingKey === listing.key)
    return itemId && currentImageUrl ? [Object.freeze({ itemId,
      title: text(listing.identity.title, 500),
      sku: text(listing.identity.sku, 100), currentImageUrl,
      observedAt: text(listing.identity.lastObservedAt, 80),
      highVisualPriority: (decision?.reasonCodes ?? []).includes(
        "LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"),
    })] : []
  })
  return Object.freeze({
    currentState: monitor.backend.currentLiveAuthority.currentState,
    lastCertifiedState:
      monitor.backend.currentLiveAuthority.lastCertifiedState,
    lastCertifiedListingCount:
      monitor.backend.currentLiveAuthority.lastCertifiedListingCount,
    lastCertifiedAt: monitor.backend.currentLiveAuthority.lastCertifiedAt,
    sourceFailureCode:
      monitor.backend.currentLiveAuthority.sourceFailureCode,
    listings: Object.freeze(listings),
  })
}

async function authoritativeLiveVisualListingsV1() {
  return (await authoritativeLiveVisualPortfolioV1()).listings
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
  targetItemId?: string | null
}) {
  let query = input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .select("*")
    .eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId)
    .in("status", OPEN_TASK_STATES)
  if (input.targetItemId) query = query.eq("ebay_item_id", input.targetItemId)
  const { data, error } = await query.order("created_at", {
    ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("MAYEL_VISUAL_TASK_READ_FAILED")
  return data as JsonRecord | null
}

function canonicalPromptForTask(task: JsonRecord) {
  const evidence = record(task.evidence_pack)
  const snapshot = deriveMayelVisualPromptSnapshotV1({
    evidencePack: evidence as MayelProductEvidencePackV1,
    storedContractVersion: task.prompt_contract_version,
    storedText: task.prompt_text, storedDigest: task.prompt_digest,
  })
  return { evidence, ...snapshot }
}

async function reconcileCanonicalPrompt(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  task: JsonRecord
}) {
  const { prompt, storedMatchesCanonical } = canonicalPromptForTask(input.task)
  if (storedMatchesCanonical) return input.task
  if (input.task.status !== "PROMPT_READY") {
    throw new Error("MAYEL_VISUAL_PROMPT_RECONCILIATION_REVIEW_REQUIRED")
  }
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1")
    .update({ prompt_contract_version: prompt.contractVersion,
      prompt_text: prompt.text, prompt_digest: prompt.digest,
      updated_at: new Date().toISOString() })
    .eq("id", input.task.id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId)
    .eq("prompt_digest", input.task.prompt_digest)
    .select("*").maybeSingle()
  if (error) throw new Error("MAYEL_VISUAL_PROMPT_RECONCILE_FAILED")
  if (data) return data as JsonRecord
  const { data: concurrent, error: concurrentError } = await input.supabase
    .from("ebay_mayel_visual_tasks_v1").select("*")
    .eq("id", input.task.id)
    .eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId).maybeSingle()
  if (concurrentError || !concurrent ||
      concurrent.prompt_contract_version !== prompt.contractVersion ||
      concurrent.prompt_text !== prompt.text ||
      concurrent.prompt_digest !== prompt.digest) {
    throw new Error("MAYEL_VISUAL_PROMPT_RECONCILE_CONFLICT")
  }
  return concurrent as JsonRecord
}

export async function ensureMayelVisualTaskV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  targetItemId?: string | null
  authoritativeListing?: AuthoritativeLiveVisualListingV1 | null
}) {
  const existing = await existingOpenTask(input)
  if (existing) return { created: false,
    task: await reconcileCanonicalPrompt({ ...input, task: existing }),
    canaryAvailable: true }

  const requestedItemId = text(input.targetItemId, 20)
  if (requestedItemId && !/^\d{9,20}$/.test(requestedItemId)) {
    throw new Error("MAYEL_VISUAL_TARGET_ITEM_INVALID")
  }
  let signalRows: JsonRecord[] = []
  if (!requestedItemId) {
    const signalRead = await input.supabase
      .from("ebay_listing_quality_report_signals")
      .select("id,item_id,signal_type,priority_class,product_truth_supported,operator_action_required,report_observed_at,what_is_happening,why_it_matters,seller_os_recommendation")
      .eq("marketplace_account_key", input.accountKey)
      .eq("current_live", true).eq("exact_item_id_match", true)
      .in("signal_type", ["IMAGE_REVIEW", "VISUAL_COVERAGE_REVIEW",
        "GENERAL_LISTING_QUALITY", "LISTING_QUALITY_SPECIFIC_RECOMMENDATION"])
      .order("report_observed_at", { ascending: false }).limit(50)
    if (signalRead.error) throw new Error("MAYEL_VISUAL_SIGNAL_READ_FAILED")
    signalRows = (signalRead.data ?? []) as JsonRecord[]
  }
  const signals = requestedItemId
    ? [{ item_id: requestedItemId,
      signal_type: "SELLER_OS_LIVE_PORTFOLIO_CONTINUOUS_REVIEW",
      priority_class: "PORTFOLIO", product_truth_supported: true,
      operator_action_required: false, report_observed_at:
        new Date().toISOString(),
      what_is_happening: "Revisión visual continua del portfolio LIVE",
      why_it_matters: "Todo listing LIVE elegible debe poder ser revisado",
      seller_os_recommendation: "Mayel revisa la presentación visual" }]
    : signalRows
  for (const signal of signals) {
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
        .eq("account_key", input.accountKey).eq("ebay_item_id", itemId)
        .eq("listing_status", "active")
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
    if (experiment || duplicateTask) continue
    const linkedPreparationAvailable = Boolean(link && active &&
      link.connector_listing_id === active.id)
    const packageRead = linkedPreparationAvailable && link
      ? await input.supabase.from("ebay_listing_packages")
        .select("id,opportunity_id,candidate_key,status,package_data")
        .eq("opportunity_id", link.opportunity_id).eq("status", "approved")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null, error: null }
    const { data: listingPackage, error: packageError } = packageRead
    if (packageError) throw new Error("MAYEL_VISUAL_PACKAGE_READ_FAILED")
    const linkedPackageAvailable = Boolean(linkedPreparationAvailable &&
      listingPackage && listingPackage.candidate_key === link?.candidate_key)
    if (!linkedPackageAvailable) {
      const authoritative = input.authoritativeListing?.itemId === itemId
        ? input.authoritativeListing
        : (await authoritativeLiveVisualListingsV1()).find((listing) =>
          listing.itemId === itemId) ?? null
      if (!authoritative) continue
      const evidencePack = buildMayelCurrentLiveVisualEvidencePackV1({
        ebayItemId: itemId, sku: authoritative.sku,
        title: authoritative.title,
        currentImageUrl: authoritative.currentImageUrl,
        observedAt: authoritative.observedAt,
      })
      const prompt = buildMayelChatGptVisualPromptV1(evidencePack)
      const row = {
        marketplace_account_key: input.accountKey, ebay_item_id: itemId,
        active_listing_id: active?.id ?? null,
        manual_listing_link_id: null, opportunity_id: null,
        listing_package_id: null, candidate_key: `mayel-live:${itemId}`,
        assigned_operator_user_id: input.actorUserId,
        selection_authority: "SELLER_OS_AUTHORITATIVE_LIVE_VISUAL_PORTFOLIO",
        selection_signal: { signalType: "CURRENT_LIVE_VISUAL_ELIGIBILITY",
          priorityClass: authoritative.highVisualPriority ? "HIGH" : "NORMAL",
          observedAt: authoritative.observedAt,
          productTruthSupported: false,
          creativeWorkAllowed: true, factClaimRestricted: true },
        evidence_pack_version: MAYEL_PRODUCT_EVIDENCE_PACK_VERSION,
        evidence_pack: evidencePack,
        product_truth_version: evidencePack.productTruthVersion,
        product_truth_digest: evidencePack.productTruthDigest,
        source_image_references: evidencePack.sourceImageSet,
        source_image_set_digest: evidencePack.sourceImageSetDigest,
        current_image_set: [authoritative.currentImageUrl],
        prompt_contract_version: MAYEL_CHATGPT_VISUAL_PROMPT_VERSION,
        prompt_text: prompt.text, prompt_digest: prompt.digest,
        status: "PROMPT_READY",
      }
      const createdRead = await input.supabase
        .from("ebay_mayel_visual_tasks_v1").insert(row).select("*").single()
      if (!createdRead.error && createdRead.data) return { created: true,
        task: createdRead.data, canaryAvailable: true }
      if (createdRead.error?.code === "23505") {
        const reconciled = await existingOpenTask(input)
        if (reconciled) return { created: false,
          task: await reconcileCanonicalPrompt({ ...input, task: reconciled }),
          canaryAvailable: true }
      }
      throw new Error("MAYEL_VISUAL_TASK_CREATE_FAILED")
    }
    if (!link || !active || !listingPackage) continue
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
      selection_authority: requestedItemId
        ? "SELLER_OS_LIVE_VISUAL_QUALITY_SIGNAL"
        : "EBAY_LISTING_QUALITY_VISUAL_SIGNAL",
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
      if (reconciled) return { created: false,
        task: await reconcileCanonicalPrompt({ ...input, task: reconciled }),
        canaryAvailable: true }
    }
    throw new Error("MAYEL_VISUAL_TASK_CREATE_FAILED")
  }
  return { created: false, task: null, canaryAvailable: false }
}

export async function ensureMayelVisualPortfolioTasksV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  limit?: number
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200))
  const portfolio = await authoritativeLiveVisualPortfolioV1()
  const authoritative = portfolio.listings
  const listings = authoritative.slice(0, limit)
  const count = portfolio.currentState === "CURRENT_FRESH"
    ? authoritative.length : null
  const itemIds = listings.map((listing) => listing.itemId)
  if (!itemIds.length) return Object.freeze({ discoveredCount: count,
    boundedCount: 0, prequalifiedCount: 0, eligibleCount: 0,
    createdCount: 0, reusedCount: 0, duplicateTaskCount: 0,
    partial: false, outcomes: Object.freeze([]),
    currentLiveAuthorityState: portfolio.currentState,
    lastCertifiedLiveCount: portfolio.lastCertifiedListingCount,
    lastCertifiedAt: portfolio.lastCertifiedAt,
    sourceFailureCode: portfolio.sourceFailureCode,
    ownerActionRequired: false as const, marketplaceWrites: 0 as const })
  const [experimentsRead, openTasksRead] = await Promise.all([
    input.supabase.from("ebay_listing_experiments_v1")
      .select("ebay_item_id").eq("account_key", input.accountKey)
      .in("ebay_item_id", itemIds).in("lifecycle_status",
        ACTIVE_EXPERIMENT_STATES),
    input.supabase.from("ebay_mayel_visual_tasks_v1")
      .select("id,ebay_item_id,assigned_operator_user_id")
      .eq("marketplace_account_key", input.accountKey)
      .in("ebay_item_id", itemIds).in("status", OPEN_TASK_STATES),
  ])
  if (experimentsRead.error || openTasksRead.error) {
    throw new Error("MAYEL_VISUAL_PORTFOLIO_ELIGIBILITY_READ_FAILED")
  }
  const experiments = new Set((experimentsRead.data ?? []).map((row) =>
    String(row.ebay_item_id)))
  const openTasks = new Map((openTasksRead.data ?? []).map((row) =>
    [String(row.ebay_item_id), row]))
  const outcomes: Record<string, unknown>[] = []
  for (const listing of listings) {
    const itemId = listing.itemId
    if (!itemId) continue
    const existing = openTasks.get(itemId)
    if (existing && existing.assigned_operator_user_id !== input.actorUserId) {
      outcomes.push({ itemId, eligible: false, taskId: existing.id,
        created: false, blocker: "MAYEL_TASK_ASSIGNEE_MISMATCH" })
      continue
    }
    try {
      const result = await ensureMayelVisualTaskV1({ ...input,
        targetItemId: itemId, authoritativeListing: listing })
      outcomes.push({ itemId, eligible: result.canaryAvailable,
        visualEligibility: "ELIGIBLE", taskId: result.task?.id ?? null,
        created: result.created,
        priority: listing.highVisualPriority ? "HIGH" : "NORMAL",
        activeExperimentPresent: experiments.has(itemId) })
    } catch (error) {
      const failureClass = error instanceof Error ? error.message :
        "MAYEL_VISUAL_PORTFOLIO_ITEM_FAILED"
      if (existing && failureClass ===
          "MAYEL_VISUAL_PROMPT_RECONCILIATION_REVIEW_REQUIRED") {
        outcomes.push({ itemId, eligible: true,
          visualEligibility: "ELIGIBLE", taskId: existing.id,
          created: false, priority: listing.highVisualPriority
            ? "HIGH" : "NORMAL",
          taskReadiness: "REQUIRES_PROMPT_REVIEW",
          nonGatingCondition: failureClass,
          activeExperimentPresent: experiments.has(itemId) })
        continue
      }
      outcomes.push({ itemId, eligible: false, taskId: existing?.id ?? null,
        created: false, blocker: failureClass })
    }
  }
  const taskIds = outcomes.flatMap((row) => typeof row.taskId === "string"
    ? [row.taskId] : [])
  return Object.freeze({ discoveredCount: count ?? null,
    boundedCount: outcomes.length,
    prequalifiedCount: outcomes.filter((row) => row.eligible === true ||
      row.blocker === undefined).length,
    eligibleCount: outcomes.filter((row) => row.eligible === true).length,
    createdCount: outcomes.filter((row) => row.created === true).length,
    reusedCount: outcomes.filter((row) => row.eligible === true &&
      row.created === false).length,
    duplicateTaskCount: taskIds.length - new Set(taskIds).size,
    partial: typeof count === "number" && count > limit,
    currentLiveAuthorityState: portfolio.currentState,
    lastCertifiedLiveCount: portfolio.lastCertifiedListingCount,
    lastCertifiedAt: portfolio.lastCertifiedAt,
    sourceFailureCode: portfolio.sourceFailureCode,
    ownerActionRequired: false as const,
    outcomes: Object.freeze(outcomes), marketplaceWrites: 0 as const })
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

async function recoverableMayelVisualAsset(input: {
  supabase: SupabaseClient
  accountKey: string
  taskId: string
  role: MayelVisualOutputRole
  outputSha256: string
}) {
  const { data, error } = await input.supabase
    .from("ebay_listing_image_assets").select("*")
    .eq("mayel_visual_task_id", input.taskId)
    .eq("account_key", input.accountKey)
    .in("status", ["pending_review", "approved"])
  if (error) return null
  const asset = (data ?? []).find((row) =>
    row.mayel_output_role === input.role ||
    row.output_sha256 === input.outputSha256)
  if (!asset || asset.listing_package_id !== null) return null
  const bucket = asset.status === "approved" ? PUBLIC_BUCKET : STAGING_BUCKET
  const path = text(asset.status === "approved"
    ? asset.published_storage_path : asset.output_storage_path, 1000)
  if (!path) return null
  const splitAt = path.lastIndexOf("/")
  if (splitAt < 1 || splitAt === path.length - 1) return null
  const folder = path.slice(0, splitAt)
  const filename = path.slice(splitAt + 1)
  const listed = await input.supabase.storage.from(bucket).list(folder, {
    limit: 10, search: filename,
  })
  if (listed.error || !listed.data.some((entry) => entry.name === filename)) {
    return null
  }
  return asset
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
  if (!slot || slot.creativeWorkAllowed !== true) {
    input.file.fill(0)
    throw new Error("MAYEL_VISUAL_SLOT_CREATIVE_WORK_NOT_ALLOWED")
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
      listing_package_id: null,
      account_key: input.accountKey, candidate_key: task.candidate_key,
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
    const durableDuplicate = assetError?.code === "23505"
      ? await recoverableMayelVisualAsset({ supabase: input.supabase,
        accountKey: input.accountKey, taskId: input.taskId, role: input.role,
        outputSha256: normalized.outputSha256 }) : null
    await Promise.all([
      input.supabase.storage.from(SOURCE_BUCKET).remove([sourcePath]),
      input.supabase.storage.from(STAGING_BUCKET).remove([stagingPath]),
    ])
    throw new Error(durableDuplicate
      ? "MAYEL_VISUAL_OUTPUT_ALREADY_RECEIVED" :
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

export async function uploadMayelVisualOutputBatchV1(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  taskId: string
  files: readonly Readonly<{ declaredMimeType: string; file: Buffer }>[]
  rightsConfirmed: boolean
}) {
  if (input.rightsConfirmed !== true || input.files.length < 1 ||
      input.files.length > 6) {
    input.files.forEach((entry) => entry.file.fill(0))
    throw new Error("MAYEL_VISUAL_BATCH_UPLOAD_CONTRACT_INVALID")
  }
  const current = await input.supabase.from("ebay_listing_image_assets")
    .select("mayel_output_role").eq("mayel_visual_task_id", input.taskId)
    .in("status", ["pending_review", "approved"])
  if (current.error) throw new Error("MAYEL_VISUAL_OUTPUT_COUNT_FAILED")
  const used = new Set((current.data ?? []).map((row) =>
    String(row.mayel_output_role)))
  const available = MAYEL_VISUAL_OUTPUT_ROLES.filter((role) => !used.has(role))
  if (input.files.length > available.length) {
    input.files.forEach((entry) => entry.file.fill(0))
    throw new Error("MAYEL_VISUAL_OUTPUT_LIMIT_REACHED")
  }
  const results: Record<string, unknown>[] = []
  for (let index = 0; index < input.files.length; index += 1) {
    const entry = input.files[index]
    try {
      const asset = await uploadMayelVisualOutputV1({ ...input,
        role: available[index], declaredMimeType: entry.declaredMimeType,
        file: entry.file })
      results.push({ fileIndex: index, status: "QUARANTINED",
        assetId: asset.id, outputSha256: asset.output_sha256 })
    } catch (error) {
      entry.file.fill(0)
      results.push({ fileIndex: index, status: "FAILED",
        error: error instanceof Error ? error.message :
          "MAYEL_VISUAL_UPLOAD_FAILED" })
    }
  }
  return Object.freeze({ results: Object.freeze(results),
    acceptedCount: results.filter((entry) => entry.status ===
      "QUARANTINED").length,
    failedCount: results.filter((entry) => entry.status === "FAILED").length,
    marketplaceWrites: 0 as const })
}

export async function saveMayelOrderedGalleryIntentV2(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  taskId: string
  expectedVisualManifestDigest?: string | null
  finalOrder: readonly Readonly<{ kind: "CURRENT_OFFICIAL" | "MAYEL_ASSET"
    publicUrl?: string | null; assetId?: string | null }>[]
}) {
  const task = await taskForActor(input)
  const assetsRead = await input.supabase.from("ebay_listing_image_assets")
    .select("id,mayel_output_role,output_sha256,public_url")
    .eq("mayel_visual_task_id", input.taskId).eq("status", "approved")
    .eq("mayel_approval_status", "APPROVED")
  if (assetsRead.error) throw new Error(
    "MAYEL_VISUAL_MANIFEST_ASSET_READ_FAILED")
  const assets = (assetsRead.data ?? []).flatMap((row) => {
    const role = text(row.mayel_output_role, 40) as MayelVisualOutputRole | null
    const publicUrl = httpsUrl(row.public_url)
    const outputSha256 = sha(row.output_sha256)
    return uuid(row.id) && role && MAYEL_VISUAL_OUTPUT_ROLES.includes(role) &&
      publicUrl && outputSha256 ? [{ assetId: row.id, role, outputSha256,
        publicUrl }] : []
  })
  const manifest = buildMayelOrderedVisualManifestV2({
    visualTaskId: String(task.id), ebayItemId: String(task.ebay_item_id),
    currentImages: Array.isArray(task.current_image_set)
      ? task.current_image_set.flatMap((url) => {
        const normalized = httpsUrl(url)
        return normalized ? [normalized] : []
      }) : [],
    assets, finalOrder: input.finalOrder,
    productTruthDigest: String(task.product_truth_digest),
    sourceImageSetDigest: String(task.source_image_set_digest),
  })
  let update = input.supabase.from("ebay_mayel_visual_tasks_v1")
    .update({ status: "OWNER_PREVIEW_READY", visual_manifest: manifest,
      visual_manifest_digest: manifest.visualManifestDigest,
      updated_at: new Date().toISOString() })
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey)
    .eq("assigned_operator_user_id", input.actorUserId)
  if (input.expectedVisualManifestDigest) {
    update = update.eq("visual_manifest_digest",
      input.expectedVisualManifestDigest)
  }
  const persisted = await update.select("visual_manifest_digest").maybeSingle()
  if (persisted.error || !persisted.data ||
      persisted.data.visual_manifest_digest !== manifest.visualManifestDigest) {
    throw new Error("MAYEL_VISUAL_ORDER_PERSISTENCE_CONFLICT")
  }
  return Object.freeze({ manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    selectedHeroAssetId: manifest.selectedHeroAssetId,
    keepOldHeroAsSecondary: manifest.keepOldHeroAsSecondary,
    removedAssetIds: manifest.removedAssetIds,
    finalOrderedImageCount: manifest.finalOrderedImageSet.length,
    marketplaceWrites: 0 as const })
}

async function reconcilePublicUpload(input: { supabase: SupabaseClient
  path: string; bytes: Buffer; outputSha256: string }) {
  const upload = await input.supabase.storage.from(PUBLIC_BUCKET)
    .upload(input.path, input.bytes, { contentType: "image/jpeg",
      upsert: false, cacheControl: "31536000" })
  if (!upload.error) return { created: true as const }
  const existing = await input.supabase.storage.from(PUBLIC_BUCKET)
    .download(input.path)
  if (existing.error) throw new Error("MAYEL_VISUAL_CANONICAL_UPLOAD_FAILED")
  const existingBytes = Buffer.from(await existing.data.arrayBuffer())
  const digest = createHash("sha256").update(existingBytes).digest("hex")
  existingBytes.fill(0)
  if (digest !== input.outputSha256) {
    throw new Error("MAYEL_VISUAL_CANONICAL_PATH_CONFLICT")
  }
  return { created: false as const }
}

async function removeUncommittedPublicUpload(input: {
  supabase: SupabaseClient
  path: string
}) {
  const removed = await input.supabase.storage.from(PUBLIC_BUCKET)
    .remove([input.path])
  if (removed.error) {
    throw new Error("MAYEL_VISUAL_APPROVAL_COMPENSATION_FAILED")
  }
}

function orderedIntentForManifest(input: { task: JsonRecord
  currentImages: readonly string[]
  assets: readonly { assetId: string; role: MayelVisualOutputRole
    outputSha256: string; publicUrl: string }[] }) {
  const assetIds = new Set(input.assets.map((asset) => asset.assetId))
  const currentUrls = new Set(input.currentImages)
  const previous = Array.isArray(record(input.task.visual_manifest)
    .proposedOrderedImages)
    ? record(input.task.visual_manifest).proposedOrderedImages as unknown[] : []
  const retained: Array<{ kind: "MAYEL_ASSET"; assetId: string } |
    { kind: "CURRENT_OFFICIAL"; publicUrl: string }> = []
  for (const value of previous) {
    const entry = record(value)
    const assetId = uuid(entry.assetId)
    if (assetId && assetIds.has(assetId)) {
      retained.push({ kind: "MAYEL_ASSET", assetId })
      continue
    }
    const publicUrl = httpsUrl(entry.publicUrl)
    if (publicUrl && currentUrls.has(publicUrl)) {
      retained.push({ kind: "CURRENT_OFFICIAL", publicUrl })
    }
  }
  const representedAssets = new Set(retained.flatMap((entry) =>
    entry.kind === "MAYEL_ASSET" ? [entry.assetId] : []))
  const representedCurrent = new Set(retained.flatMap((entry) =>
    entry.kind === "CURRENT_OFFICIAL" ? [entry.publicUrl] : []))
  return [
    ...retained,
    ...input.currentImages.filter((url) => !representedCurrent.has(url))
      .map((publicUrl) => ({ kind: "CURRENT_OFFICIAL" as const, publicUrl })),
    ...input.assets.filter((asset) => !representedAssets.has(asset.assetId))
      .map((asset) => ({ kind: "MAYEL_ASSET" as const,
        assetId: asset.assetId })),
  ]
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
  const currentImages = Array.isArray(input.task.current_image_set)
    ? input.task.current_image_set.filter((url): url is string =>
      Boolean(httpsUrl(url))) : []
  const manifest = buildMayelOrderedVisualManifestV2({
    visualTaskId: String(input.task.id),
    ebayItemId: String(input.task.ebay_item_id),
    currentImages, assets,
    finalOrder: orderedIntentForManifest({ task: input.task,
      currentImages, assets }),
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

async function manifestForApproval(input: {
  supabase: SupabaseClient
  task: JsonRecord
  asset: { id: string; mayel_output_role: MayelVisualOutputRole
    output_sha256: string }
  publicUrl: string
}) {
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
  assets.push({ assetId: input.asset.id,
    role: input.asset.mayel_output_role,
    outputSha256: input.asset.output_sha256, publicUrl: input.publicUrl })
  const currentImages = Array.isArray(input.task.current_image_set)
    ? input.task.current_image_set.filter((url): url is string =>
      Boolean(httpsUrl(url))) : []
  return buildMayelOrderedVisualManifestV2({
    visualTaskId: String(input.task.id),
    ebayItemId: String(input.task.ebay_item_id),
    currentImages, assets,
    finalOrder: orderedIntentForManifest({ task: input.task,
      currentImages, assets }),
    productTruthDigest: String(input.task.product_truth_digest),
    sourceImageSetDigest: String(input.task.source_image_set_digest),
  })
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
  const publicUrl = input.supabase.storage.from(PUBLIC_BUCKET)
    .getPublicUrl(publicPath).data.publicUrl
  const approvalQa = { ...record(asset.qa_result),
    humanReview: { decision: "APPROVE", checks: input.humanQa,
      reviewedBy: input.actorUserId } }
  let manifest
  try {
    manifest = await manifestForApproval({ supabase: input.supabase, task,
      asset: { id: String(asset.id), mayel_output_role: role,
        output_sha256: String(asset.output_sha256) }, publicUrl })
    await reconcilePublicUpload({ supabase: input.supabase, path: publicPath,
      bytes, outputSha256: asset.output_sha256 })
  } finally {
    bytes.fill(0)
  }
  const { data: promotion, error: promotionError } = await input.supabase.rpc(
    "promote_ebay_mayel_visual_asset_v1", {
      p_account_key: input.accountKey,
      p_actor_user_id: input.actorUserId,
      p_task_id: input.taskId,
      p_asset_id: input.assetId,
      p_public_path: publicPath,
      p_public_url: publicUrl,
      p_qa_result: approvalQa,
      p_manifest: manifest,
      p_manifest_digest: manifest.visualManifestDigest,
    })
  if (promotionError || !promotion) {
    await removeUncommittedPublicUpload({ supabase: input.supabase,
      path: publicPath })
    throw new Error("MAYEL_VISUAL_APPROVAL_PERSIST_FAILED")
  }
  const result = record(promotion)
  const approved = record(result.asset)
  if (!uuid(approved.id) || approved.status !== "approved") {
    throw new Error("MAYEL_VISUAL_APPROVAL_READBACK_FAILED")
  }
  return { asset: approved, manifest: record(result.manifest),
    idempotent: result.idempotent === true }
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
    .limit(input.ownerView ? 50 : 50)
  if (!input.ownerView) query = query.eq("assigned_operator_user_id",
    input.actorUserId)
  const { data: taskRows, error } = await query
  if (error) throw new Error("MAYEL_VISUAL_WORKSTATION_READ_FAILED")
  const typedTaskRows = (taskRows ?? []) as JsonRecord[]
  const taskIds = typedTaskRows.map((task) => String(task.id))
    .filter(Boolean)
  const assetColumns =
    "id,mayel_visual_task_id,status,mayel_output_role,source_sha256,output_sha256,source_width,source_height,output_width,output_height,output_bytes,qa_result,mayel_approval_status,owner_approval_status,output_storage_path,public_url,created_at,approved_at"
  const assetRead = taskIds.length
    ? await input.supabase.from("ebay_listing_image_assets")
      .select(assetColumns).in("mayel_visual_task_id", taskIds)
      .order("mayel_visual_task_id", { ascending: true })
      .order("position", { ascending: true })
    : { data: [], error: null }
  if (assetRead.error) throw new Error("MAYEL_VISUAL_OUTPUT_READ_FAILED")
  const outputsByTaskId = new Map<string, JsonRecord[]>()
  for (const output of (assetRead.data ?? []) as JsonRecord[]) {
    const taskId = String(output.mayel_visual_task_id ?? "")
    if (!taskId) continue
    outputsByTaskId.set(taskId,
      [...(outputsByTaskId.get(taskId) ?? []), output])
  }
  const tasks = []
  for (const task of typedTaskRows) {
    const outputRows = outputsByTaskId.get(String(task.id)) ?? []
    const outputs = []
    for (const output of outputRows) {
      let previewUrl = httpsUrl(output.public_url)
      let previewExpiresInSeconds: number | null = null
      const outputStoragePath = text(output.output_storage_path, 500)
      if (!previewUrl && output.status === "pending_review" &&
          outputStoragePath) {
        const signed = await input.supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(outputStoragePath, 300)
        previewUrl = signed.error ? null : signed.data.signedUrl
        previewExpiresInSeconds = previewUrl ? 300 : null
      }
      outputs.push({ ...output, previewUrl, previewExpiresInSeconds })
    }
    const { evidence, prompt: promptContract, storedMatchesCanonical } =
      canonicalPromptForTask(task)
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
      prompt: promptContract.text,
      promptSlots: promptContract.slots,
      promptReconciliationRequired: !storedMatchesCanonical,
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
  return { contractVersion: "MAYEL_VISUAL_WORKSTATION_READ_MODEL_V2",
    tasks, counts: { visualTasks: tasks.length,
      separatePrompts: tasks.length,
      databaseReadCount: taskIds.length ? 2 : 1,
      outputAssetReadStrategy: "BULK_TASK_SCOPE",
      openAiTextCalls: 0, openAiImageCalls: 0, marketplaceWrites: 0 },
    safety: { chatGptUiAutomation: false, chatGptCredentialStorage: false,
      localFileDirectToEbay: false, canonicalAssetRequired: true,
      autoPublish: false, phaseAEbayWriteCapability: false } }
}
