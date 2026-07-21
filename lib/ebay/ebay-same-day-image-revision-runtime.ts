import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import { fetchAuthorizedImageSource } from "./ebay-image-optimization-service"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
} from "./ebay-image-storage-cleanup"
import {
  EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
  EBAY_IMAGE_TEXT_RENDERER_VERSION,
  EBAY_LISTING_IMAGE_SET_VERSION,
  EBAY_LISTING_IMAGE_SLOTS,
  getListingImageFactoryConfiguration,
} from "./ebay-listing-image-factory"
import {
  disposeTransientSameDayImageAssets,
  generateTransientSameDayImagePackage,
} from "./ebay-same-day-image-package-service"

const OUTPUT_BUCKET = "ebay-listing-images"
const REVISION_VERSION = "EBAY_LISTING_IMAGE_REVISION_V2_VERIFIED_ACTIVE_HANDOFF_COMPAT"
const VERIFIED_ACTIVE_HISTORICAL_HANDOFF_VERSION =
  "SELLER_HUB_FACTS_ONLY_V7_2026_07_20"
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : "SAME_DAY_IMAGE_REVISION_RUNTIME_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  const row = record(error)
  for (const field of [row.message, row.details, row.hint, row.code]) {
    const appCode = text(field, 2_000)
      .match(/\b(?:EBAY|SAME_DAY)_[A-Z0-9_]{3,}\b/)?.[0]
    if (appCode) return appCode
  }
  const postgresCode = text(row.code, 20)
  return /^[A-Z0-9]{5}$/.test(postgresCode)
    ? `${fallback}:${postgresCode}`
    : fallback
}

function candidatePath(candidateKey: string) {
  return sha256(candidateKey).slice(0, 24)
}

function exactSixIds(value: unknown) {
  if (!Array.isArray(value)) return []
  const ids = value.map(uuid).filter(Boolean)
  return ids.length === 6 && new Set(ids).size === 6 ? ids : []
}

async function cleanupObjects(
  supabase: SupabaseClient,
  objects: Array<{ bucket: string; path: string }>,
) {
  const grouped = new Map<string, string[]>()
  for (const object of objects) {
    grouped.set(object.bucket, [...(grouped.get(object.bucket) ?? []), object.path])
  }
  await Promise.all([...grouped].map(([bucket, paths]) =>
    supabase.storage.from(bucket).remove(paths).catch(() => undefined)))
}

async function loadBaseContext(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  baseControlId: string
}) {
  const { data: baseData, error: baseError } = await input.supabase
    .from("ebay_same_day_pilot_image_package_runs")
    .select("*")
    .eq("id", input.baseControlId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .eq("status", "APPROVED")
    .maybeSingle()
  if (baseError || !baseData) {
    throw new Error("SAME_DAY_IMAGE_REVISION_BASE_NOT_APPROVED")
  }
  const base = record(baseData)
  const candidateId = uuid(base.candidate_id)
  const handoffId = uuid(base.handoff_id)
  const listingPackageId = uuid(base.listing_package_id)
  if (!candidateId || !handoffId || !listingPackageId ||
    exactSixIds(base.asset_ids).length !== 6) {
    throw new Error("SAME_DAY_IMAGE_REVISION_BASE_INVALID")
  }
  const [candidateRead, handoffRead, packageRead] = await Promise.all([
    input.supabase.from("ebay_same_day_pilot_candidates").select("*")
      .eq("id", candidateId).eq("run_id", base.run_id).maybeSingle(),
    input.supabase.from("ebay_same_day_pilot_handoffs").select("*")
      .eq("id", handoffId).eq("candidate_id", candidateId).maybeSingle(),
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("id", listingPackageId).eq("account_key", input.accountKey)
      .eq("created_by", input.actorId).neq("status", "archived").maybeSingle(),
  ])
  if (candidateRead.error || !candidateRead.data || handoffRead.error ||
    !handoffRead.data || packageRead.error || !packageRead.data) {
    throw new Error("SAME_DAY_IMAGE_REVISION_SCOPE_READ_FAILED")
  }
  const candidate = record(candidateRead.data)
  const handoff = record(handoffRead.data)
  const factsSummary = record(candidate.product_facts_summary)
  const factsPackage = record(factsSummary.authoritativeFactsPackage)
  const factRunId = uuid(factsSummary.factRunId)
  const factPackageHash = text(factsPackage.factPackageHash, 80)
  if (factsSummary.currentRunBound !== true || factRunId !== uuid(base.fact_run_id)
    || !/^sha256:[0-9a-f]{64}$/.test(factPackageHash)
    || uuid(handoff.fact_run_id) !== factRunId
    || text(handoff.package_hash, 64) !== text(base.handoff_hash, 64)) {
    throw new Error("SAME_DAY_IMAGE_REVISION_FACT_BINDING_INVALID")
  }
  const handoffPackage = record(handoff.package_data)
  const candidateKey = text(candidate.candidate_key, 300)
  const opportunityId = uuid(candidate.opportunity_id)
  let allowVerifiedActiveHistoricalHandoff = false
  if (text(handoffPackage.version, 100) ===
    VERIFIED_ACTIVE_HISTORICAL_HANDOFF_VERSION) {
    const safety = record(handoffPackage.safety)
    const images = record(handoffPackage.images)
    const historicalBindingValid = candidate.state === "VERIFIED_ACTIVE"
      && candidate.machine_state === "VERIFIED_ACTIVE"
      && text(handoffPackage.candidateId, 40) === candidateId
      && text(handoffPackage.factRunId, 40) === factRunId
      && safety.factsOnly === true
      && Number(safety.openAiCalls) === 0
      && Number(safety.ebayWrites) === 0
      && safety.competitorContentUsed === false
      && text(safety.authoritativeFactPackageHash, 80) === factPackageHash
      && images.source === "LUNA_AUTHORIZED_CATALOG"
      && Number(images.competitorImages) === 0
      && Number.isInteger(Number(images.count))
      && Number(images.count) > 0
      && Boolean(candidateKey)
      && Boolean(opportunityId)
    if (!historicalBindingValid) {
      throw new Error("SAME_DAY_IMAGE_HANDOFF_STALE")
    }
    const { data: manualLink, error: manualLinkError } = await input.supabase
      .from("ebay_manual_listing_links")
      .select("connector_listing_id,ebay_item_id")
      .eq("account_key", input.accountKey)
      .eq("opportunity_id", opportunityId)
      .eq("candidate_key", candidateKey)
      .eq("verification_status", "verified")
      .eq("connector_listing_status", "active")
      .maybeSingle()
    if (manualLinkError || !manualLink) {
      throw new Error(
        "SAME_DAY_IMAGE_REVISION_VERIFIED_ACTIVE_EVIDENCE_REQUIRED",
      )
    }
    const connectorListingId = uuid(manualLink.connector_listing_id)
    const ebayItemId = text(manualLink.ebay_item_id, 20)
    if (!connectorListingId || !/^\d{9,20}$/.test(ebayItemId)) {
      throw new Error(
        "SAME_DAY_IMAGE_REVISION_VERIFIED_ACTIVE_EVIDENCE_REQUIRED",
      )
    }
    const { data: activeListing, error: activeListingError } = await input.supabase
      .from("ebay_active_listings")
      .select("id")
      .eq("id", connectorListingId)
      .eq("account_key", input.accountKey)
      .eq("ebay_item_id", ebayItemId)
      .eq("listing_status", "active")
      .maybeSingle()
    if (activeListingError || !activeListing) {
      throw new Error(
        "SAME_DAY_IMAGE_REVISION_VERIFIED_ACTIVE_EVIDENCE_REQUIRED",
      )
    }
    allowVerifiedActiveHistoricalHandoff = true
  }
  const sourceValues = Array.isArray(record(handoffPackage.images).urls)
    ? record(handoffPackage.images).urls as unknown[]
    : []
  const sourceUrls = [...new Set(sourceValues.map((value) => text(value, 2_000))
    .filter((value) => value.startsWith("https://")))].slice(0, 3)
  if (!sourceUrls.length) {
    throw new Error("SAME_DAY_IMAGE_REVISION_AUTHORIZED_SOURCE_MISSING")
  }
  return {
    base,
    candidate,
    handoffPackage,
    factsPackage,
    factRunId,
    factPackageHash,
    allowVerifiedActiveHistoricalHandoff,
    sourceUrls,
    listingPackageId,
    candidateId,
    candidateKey,
    opportunityId,
  }
}

export async function getSameDayImageRevision(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  revisionId: string
}) {
  const { data, error } = await input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("*")
    .eq("id", input.revisionId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .maybeSingle()
  if (error || !data) throw new Error("SAME_DAY_IMAGE_REVISION_NOT_FOUND")
  const revision = record(data)
  const assetIds = exactSixIds(revision.asset_ids)
  if (!assetIds.length) return { revision, assets: [] }
  const { data: assetData, error: assetError } = await input.supabase
    .from("ebay_listing_image_assets")
    .select("id,status,asset_role,position,output_storage_path,public_url,output_sha256,transformation,qa_result")
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .eq("listing_package_id", revision.listing_package_id)
    .in("id", assetIds)
  if (assetError || assetData?.length !== 6) {
    throw new Error("SAME_DAY_IMAGE_REVISION_ASSETS_MISSING")
  }
  const byId = new Map(assetData.map((asset) => [asset.id, asset]))
  const manifest = Array.isArray(revision.asset_manifest)
    ? revision.asset_manifest.map(record)
    : []
  const assets = await Promise.all(manifest.map(async (entry) => {
    const asset = byId.get(uuid(entry.assetId))
    if (!asset) throw new Error("SAME_DAY_IMAGE_REVISION_ASSETS_MISSING")
    let previewUrl = asset.status === "approved"
      ? text(asset.public_url, 2_000)
      : ""
    if (!previewUrl && asset.status === "pending_review") {
      const path = text(asset.output_storage_path, 1_000)
      const { data: signed } = path
        ? await input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET)
          .createSignedUrl(path, 300)
        : { data: null }
      previewUrl = text(signed?.signedUrl, 2_000)
    }
    return {
      id: asset.id,
      status: asset.status,
      role: asset.asset_role,
      slot: text(entry.slot, 80),
      layoutId: text(entry.layoutId, 120),
      outputSha256: asset.output_sha256,
      reusedFromHistory: entry.reused === true,
      previewUrl: previewUrl || null,
      previewExpiresInSeconds: asset.status === "pending_review" ? 300 : null,
    }
  }))
  return { revision, assets }
}

export async function generateAndPersistSameDayImageRevision(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  baseControlId: string
  requestKey?: string
}) {
  const actorId = uuid(input.actorId)
  const baseControlId = uuid(input.baseControlId)
  const requestKey = input.requestKey ? uuid(input.requestKey) : ""
  if (!actorId || !baseControlId || (input.requestKey && !requestKey)) {
    throw new Error("SAME_DAY_IMAGE_REVISION_SCOPE_INVALID")
  }
  const { data: pendingRevision, error: pendingRevisionError } = await input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("id")
    .eq("marketplace_account_key", input.accountKey)
    .eq("created_by", actorId)
    .eq("base_control_id", baseControlId)
    .eq("status", "PENDING_REVIEW")
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (pendingRevisionError) {
    throw new Error("SAME_DAY_IMAGE_REVISION_PENDING_LOOKUP_FAILED")
  }
  const pendingRevisionId = uuid(pendingRevision?.id)
  if (pendingRevisionId) {
    const current = await getSameDayImageRevision({
      supabase: input.supabase,
      accountKey: input.accountKey,
      actorId,
      revisionId: pendingRevisionId,
    })
    return { ...current, reused: true }
  }
  const context = await loadBaseContext({ ...input, actorId, baseControlId })
  if (!context.candidateKey || !context.opportunityId) {
    throw new Error("SAME_DAY_IMAGE_REVISION_CANDIDATE_INVALID")
  }
  const configuration = getListingImageFactoryConfiguration()
  if (configuration.deterministicComposition !== "READY") {
    throw new Error("SAME_DAY_IMAGE_REVISION_FACTORY_BLOCKED")
  }
  const idempotencyKeyHash = sha256([
    input.accountKey,
    actorId,
    baseControlId,
    REVISION_VERSION,
    EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
    requestKey || "DEFAULT_DIVERSIFIED_REVISION",
  ].join(":"))
  const leaseToken = randomUUID()
  const { data: claimData, error: claimError } = await input.supabase.rpc(
    "claim_ebay_same_day_pilot_image_revision",
    {
      p_account_key: input.accountKey,
      p_actor: actorId,
      p_base_control_id: baseControlId,
      p_idempotency_key_hash: idempotencyKeyHash,
      p_lease_token: leaseToken,
    },
  )
  if (claimError) throw new Error(databaseErrorCode(
    claimError,
    "SAME_DAY_IMAGE_REVISION_CLAIM_FAILED",
  ))
  const claim = record(claimData)
  const revisionId = uuid(claim.revisionId)
  if (!revisionId) throw new Error("SAME_DAY_IMAGE_REVISION_ID_INVALID")
  if (claim.claimed !== true) {
    const current = await getSameDayImageRevision({
      supabase: input.supabase,
      accountKey: input.accountKey,
      actorId,
      revisionId,
    })
    if (["PENDING_REVIEW", "APPROVED", "REJECTED", "FAILED_FINAL"]
      .includes(text(current.revision.status))) {
      return { ...current, reused: true }
    }
    throw new Error("SAME_DAY_IMAGE_REVISION_BUSY")
  }

  let sources: Array<Awaited<ReturnType<typeof fetchAuthorizedImageSource>>> = []
  let generated: Awaited<ReturnType<typeof generateTransientSameDayImagePackage>> | null = null
  const uploaded: Array<{ bucket: string; path: string; requestedId: string }> = []
  const createdAssetIds: string[] = []
  let completed = false
  try {
    sources = await Promise.all(context.sourceUrls.map((url) =>
      fetchAuthorizedImageSource(url)))
    const sourceDetails = await Promise.all(sources.map(async (source) => ({
      source,
      sourceSha256: sha256(source.buffer),
      metadata: await sharp(source.buffer).metadata(),
    })))
    const uniqueSources = [...new Map(sourceDetails.map((entry) =>
      [entry.sourceSha256, entry])).values()].slice(0, 3)
    generated = await generateTransientSameDayImagePackage({
      handoffPackage: context.handoffPackage,
      authoritativeFactsPackage: context.factsPackage,
      currentBinding: {
        candidateId: context.candidateId,
        factRunId: context.factRunId,
        factPackageHash: context.factPackageHash,
      },
      rightsEvidence: {
        rightsBasis: "supplier_authorized",
        authorizationReference: `APPROVED_IMAGE_CONTROL:${baseControlId}`,
        rightsEvidenceConfirmed: true,
      },
      aiContext: { enabled: false },
      allowVerifiedActiveHistoricalHandoff:
        context.allowVerifiedActiveHistoricalHandoff,
      source: uniqueSources.map((entry) => entry.source.buffer),
    })
    const generatedSlots = generated.transientAssets.map((asset) => asset.slot)
    const generatedLayouts = generated.transientAssets.map((asset) =>
      text(record(asset.transformation).layoutId, 120))
    const generatedHashes = generated.transientAssets.map((asset) =>
      text(asset.outputSha256, 64))
    const generatedContracts = generated.transientAssets.map((asset) =>
      text(record(asset.transformation).compositorContractVersion, 120))
    const generatedTextEvidence = generated.transientAssets
      .filter((asset) => asset.slot !== "MAIN_WHITE_BACKGROUND")
      .every((asset) =>
        record(asset.transformation).textRendererVersion ===
          EBAY_IMAGE_TEXT_RENDERER_VERSION &&
        record(asset.qa).textGlyphsValidated === true)
    if (generated.transientAssets.length !== 6
      || new Set(generatedSlots).size !== 6
      || EBAY_LISTING_IMAGE_SLOTS.some((slot) => !generatedSlots.includes(slot))
      || generatedLayouts.some((layout) => !layout)
      || new Set(generatedLayouts).size !== 6
      || generatedHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))
      || new Set(generatedHashes).size !== 6
      || generatedContracts.some((contract) =>
        contract !== EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION)
      || !generatedTextEvidence) {
      throw new Error("SAME_DAY_IMAGE_REVISION_EXACT_SIX_INVALID")
    }
    const roleBySlot: Record<string, string> = {
      MAIN_WHITE_BACKGROUND: "main",
      PACK_AND_COUNT: "detail",
      KEY_FEATURES: "detail",
      SIZE_AND_CONTENT: "label",
      USE_CONTEXT: "lifestyle",
      PACKAGE_CONTENTS: "packaging",
    }
    const requestedAssets: JsonRecord[] = []
    const uploadedById = new Map<string, Array<{ bucket: string; path: string }>>()
    for (const composition of generated.transientAssets) {
      const selected = uniqueSources.find((entry) =>
        entry.sourceSha256 === composition.sourceSha256)
      if (!selected) throw new Error("SAME_DAY_IMAGE_REVISION_SOURCE_MISMATCH")
      const layoutId = text(record(composition.transformation).layoutId, 120)
      if (!layoutId) throw new Error("SAME_DAY_IMAGE_REVISION_LAYOUT_MISSING")
      const assetId = randomUUID()
      const base = `${actorId}/${candidatePath(context.candidateKey)}/${assetId}`
      const extension = selected.source.contentType === "image/png"
        ? "png" : selected.source.contentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${base}-source.${extension}`
      const outputPath = `${base}-optimized.jpg`
      const sourceUpload = await input.supabase.storage
        .from(EBAY_IMAGE_SOURCE_BUCKET).upload(sourcePath, selected.source.buffer, {
          contentType: selected.source.contentType,
          upsert: false,
        })
      if (sourceUpload.error) throw new Error("SAME_DAY_IMAGE_REVISION_SOURCE_UPLOAD_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_SOURCE_BUCKET, path: sourcePath, requestedId: assetId })
      const outputUpload = await input.supabase.storage
        .from(EBAY_IMAGE_STAGING_BUCKET).upload(outputPath, composition.output, {
          contentType: "image/jpeg",
          upsert: false,
        })
      if (outputUpload.error) throw new Error("SAME_DAY_IMAGE_REVISION_OUTPUT_UPLOAD_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_STAGING_BUCKET, path: outputPath, requestedId: assetId })
      uploadedById.set(assetId, [
        { bucket: EBAY_IMAGE_SOURCE_BUCKET, path: sourcePath },
        { bucket: EBAY_IMAGE_STAGING_BUCKET, path: outputPath },
      ])
      requestedAssets.push({
        id: assetId,
        asset_role: roleBySlot[composition.slot],
        source_kind: "authorized_url",
        source_url: selected.source.sourceUrl,
        source_storage_path: sourcePath,
        output_storage_path: outputPath,
        source_sha256: composition.sourceSha256,
        output_sha256: composition.outputSha256,
        source_width: selected.metadata.width,
        source_height: selected.metadata.height,
        output_width: composition.width,
        output_height: composition.height,
        output_bytes: composition.bytes,
        rights_basis: "supplier_authorized",
        authorization_reference: `APPROVED_IMAGE_CONTROL:${baseControlId}`,
        rights_evidence_confirmed: true,
        transformation_version: EBAY_LISTING_IMAGE_SET_VERSION,
        transformation: {
          ...composition.transformation,
          sameDayImageRevisionId: revisionId,
          baseSameDayImageControlId: baseControlId,
          authoritativeFactPackageHash: context.factPackageHash,
        },
        qa_result: composition.qa,
      })
    }
    const { data: savedData, error: savedError } = await input.supabase.rpc(
      "create_ebay_same_day_image_revision_asset_set",
      {
        p_revision_id: revisionId,
        p_account_key: input.accountKey,
        p_actor: actorId,
        p_lease_token: leaseToken,
        p_opportunity_id: context.opportunityId,
        p_candidate_key: context.candidateKey,
        p_assets: requestedAssets,
      },
    )
    const saved = (Array.isArray(savedData) ? savedData : savedData ? [savedData] : [])
      .map(record)
    if (savedError || saved.length !== 6) {
      throw new Error(databaseErrorCode(
        savedError,
        "SAME_DAY_IMAGE_REVISION_ASSET_SAVE_FAILED",
      ))
    }
    const savedByHash = new Map(saved.map((asset) => [
      text(asset.output_sha256, 64),
      asset,
    ]))
    const assetIds: string[] = []
    const manifest: JsonRecord[] = []
    for (const requested of requestedAssets) {
      const savedAsset = savedByHash.get(text(requested.output_sha256, 64))
      const savedId = uuid(savedAsset?.id)
      const requestedId = uuid(requested.id)
      if (!savedId || !requestedId) {
        throw new Error("SAME_DAY_IMAGE_REVISION_ASSET_BINDING_FAILED")
      }
      const reused = savedId !== requestedId
      if (reused) await cleanupObjects(input.supabase, uploadedById.get(requestedId) ?? [])
      else createdAssetIds.push(savedId)
      assetIds.push(savedId)
      const transformation = record(requested.transformation)
      manifest.push({
        assetId: savedId,
        slot: text(transformation.slot, 80),
        layoutId: text(transformation.layoutId, 120),
        authorizedSourceIndex: Number(transformation.authorizedSourceIndex),
        sourceSha256: text(requested.source_sha256, 64),
        outputSha256: text(requested.output_sha256, 64),
        compositorContractVersion: text(
          transformation.compositorContractVersion,
          120,
        ),
        presentationMode: text(transformation.presentationMode, 120),
        reused,
      })
    }
    if (assetIds.length !== 6 || new Set(assetIds).size !== 6 ||
      EBAY_LISTING_IMAGE_SLOTS.some((slot) =>
        !manifest.some((entry) => entry.slot === slot))) {
      throw new Error("SAME_DAY_IMAGE_REVISION_EXACT_SIX_INVALID")
    }
    const { data: completion, error: completionError } = await input.supabase.rpc(
      "complete_ebay_same_day_image_revision",
      {
        p_revision_id: revisionId,
        p_actor: actorId,
        p_lease_token: leaseToken,
        p_asset_ids: assetIds,
        p_asset_manifest: manifest,
      },
    )
    if (completionError) {
      throw new Error(databaseErrorCode(
        completionError,
        "SAME_DAY_IMAGE_REVISION_COMPLETION_FAILED",
      ))
    }
    if (!completion) {
      throw new Error("SAME_DAY_IMAGE_REVISION_COMPLETION_EMPTY")
    }
    completed = true
    return {
      revisionId,
      revisionNumber: Number(claim.revisionNumber),
      status: "PENDING_REVIEW",
      assetIds,
      reusedAssetCount: manifest.filter((entry) => entry.reused === true).length,
      authorizedSourceCount: uniqueSources.length,
      ebayWrites: 0,
      reused: false,
    }
  } catch (error) {
    if (!completed) {
      if (createdAssetIds.length) {
        await input.supabase.from("ebay_listing_image_assets").delete()
          .eq("account_key", input.accountKey)
          .eq("created_by", actorId)
          .eq("listing_package_id", context.listingPackageId)
          .in("id", createdAssetIds)
      }
      await cleanupObjects(input.supabase, uploaded)
      const { error: failureRecordError } = await input.supabase.rpc(
        "fail_ebay_same_day_image_revision",
        {
        p_revision_id: revisionId,
        p_actor: actorId,
        p_lease_token: leaseToken,
        p_error_code: safeError(error),
        },
      )
      if (!failureRecordError) {
        try {
          const failed = await getSameDayImageRevision({
            supabase: input.supabase,
            accountKey: input.accountKey,
            actorId,
            revisionId,
          })
          if (["FAILED_RETRYABLE", "FAILED_FINAL"].includes(
            text(failed.revision.status, 40),
          )) {
            return { ...failed, reused: false, generationFailed: true }
          }
        } catch {
          // Preserve the sanitized generation error when reconciliation fails.
        }
      }
    }
    throw error
  } finally {
    if (generated) disposeTransientSameDayImageAssets(generated.transientAssets)
    for (const source of sources) source.buffer.fill(0)
  }
}

async function verifiedPublication(input: {
  supabase: SupabaseClient
  actorId: string
  candidateKey: string
  asset: JsonRecord
}) {
  const assetId = uuid(input.asset.id)
  if (input.asset.status === "approved") {
    const publicUrl = text(input.asset.public_url, 2_000)
    const publishedPath = text(input.asset.published_storage_path, 1_000)
    if (!assetId || !publicUrl.startsWith("https://") || !publishedPath) {
      throw new Error("SAME_DAY_IMAGE_REVISION_APPROVED_ASSET_INVALID")
    }
    return { asset_id: assetId, public_url: publicUrl, published_storage_path: publishedPath }
  }
  const stagingPath = text(input.asset.output_storage_path, 1_000)
  if (!assetId || !stagingPath) {
    throw new Error("SAME_DAY_IMAGE_REVISION_STAGING_ASSET_INVALID")
  }
  const { data: blob, error } = await input.supabase.storage
    .from(EBAY_IMAGE_STAGING_BUCKET).download(stagingPath)
  if (error || !blob) throw new Error("SAME_DAY_IMAGE_REVISION_STAGING_DOWNLOAD_FAILED")
  const bytes = Buffer.from(await blob.arrayBuffer())
  try {
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES
      || bytes.length !== Number(input.asset.output_bytes)
      || sha256(bytes) !== text(input.asset.output_sha256, 64)) {
      throw new Error("SAME_DAY_IMAGE_REVISION_STAGING_INTEGRITY_FAILED")
    }
    const publishedPath = `${input.actorId}/${candidatePath(input.candidateKey)}/${assetId}.jpg`
    const uploaded = await input.supabase.storage.from(OUTPUT_BUCKET)
      .upload(publishedPath, bytes, { contentType: "image/jpeg", upsert: false })
    if (uploaded.error) {
      const existing = await input.supabase.storage.from(OUTPUT_BUCKET)
        .download(publishedPath)
      if (existing.error || !existing.data) {
        throw new Error("SAME_DAY_IMAGE_REVISION_PUBLICATION_FAILED")
      }
      const existingBytes = Buffer.from(await existing.data.arrayBuffer())
      try {
        if (existingBytes.length !== bytes.length || sha256(existingBytes) !== sha256(bytes)) {
          throw new Error("SAME_DAY_IMAGE_REVISION_PUBLICATION_CONFLICT")
        }
      } finally {
        existingBytes.fill(0)
      }
    }
    const publicUrl = input.supabase.storage.from(OUTPUT_BUCKET)
      .getPublicUrl(publishedPath).data.publicUrl
    return { asset_id: assetId, public_url: publicUrl, published_storage_path: publishedPath }
  } finally {
    bytes.fill(0)
  }
}

export async function reviewSameDayImageRevision(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  revisionId: string
  decision: "APPROVE" | "REJECT"
}) {
  const actorId = uuid(input.actorId)
  const revisionId = uuid(input.revisionId)
  if (!actorId || !revisionId) {
    throw new Error("SAME_DAY_IMAGE_REVISION_REVIEW_SCOPE_INVALID")
  }
  const current = await getSameDayImageRevision({ ...input, actorId, revisionId })
  const revision = current.revision
  const assetIds = exactSixIds(revision.asset_ids)
  const candidateId = uuid(revision.candidate_id)
  if (!assetIds.length || !candidateId) {
    throw new Error("SAME_DAY_IMAGE_REVISION_REVIEW_SET_INVALID")
  }
  const { data: candidate, error: candidateError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .select("candidate_key")
    .eq("id", candidateId)
    .eq("run_id", revision.run_id)
    .maybeSingle()
  const candidateKey = text(candidate?.candidate_key, 300)
  if (candidateError || !candidateKey) {
    throw new Error("SAME_DAY_IMAGE_REVISION_CANDIDATE_NOT_FOUND")
  }
  const { data: assetData, error: assetError } = await input.supabase
    .from("ebay_listing_image_assets").select("*")
    .eq("account_key", input.accountKey).eq("created_by", actorId)
    .eq("listing_package_id", revision.listing_package_id).in("id", assetIds)
  if (assetError || assetData?.length !== 6) {
    throw new Error("SAME_DAY_IMAGE_REVISION_ASSETS_MISSING")
  }
  const byId = new Map(assetData.map((asset) => [asset.id, record(asset)]))
  const ordered = assetIds.map((id) => byId.get(id)).filter(Boolean) as JsonRecord[]
  const pendingAssets = ordered.filter((asset) => asset.status === "pending_review")
  let publicationManifest: JsonRecord[] = []
  if (input.decision === "APPROVE") {
    publicationManifest = await Promise.all(ordered.map((asset) =>
      verifiedPublication({
        supabase: input.supabase,
        actorId,
        candidateKey,
        asset,
      })))
  }
  const { data: reviewData, error: reviewError } = await input.supabase.rpc(
    "review_ebay_same_day_image_revision",
    {
      p_revision_id: revisionId,
      p_account_key: input.accountKey,
      p_actor: actorId,
      p_decision: input.decision,
      p_confirmed: true,
      p_publication_manifest: publicationManifest,
    },
  )
  if (reviewError || !reviewData) throw new Error(databaseErrorCode(
    reviewError,
    "SAME_DAY_IMAGE_REVISION_REVIEW_FAILED",
  ))
  await cleanupObjects(input.supabase, pendingAssets.flatMap((asset) => [
    { bucket: EBAY_IMAGE_STAGING_BUCKET, path: text(asset.output_storage_path, 1_000) },
    { bucket: EBAY_IMAGE_SOURCE_BUCKET, path: text(asset.source_storage_path, 1_000) },
  ].filter((entry) => Boolean(entry.path))))
  return record(reviewData)
}
