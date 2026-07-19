import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import {
  fetchAuthorizedImageSource,
} from "./ebay-image-optimization-service"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
} from "./ebay-image-storage-cleanup"
import {
  buildSafeOpenAiBackgroundPlatePlan,
  EBAY_LISTING_IMAGE_SET_VERSION,
  EBAY_LISTING_IMAGE_SLOTS,
  getListingImageFactoryConfiguration,
  requestSafeOpenAiBackgroundPlate,
} from "./ebay-listing-image-factory"
import {
  buildSameDayImagePackagePlan,
  disposeTransientSameDayImageAssets,
  generateTransientSameDayImagePackage,
} from "./ebay-same-day-image-package-service"

const OUTPUT_BUCKET = "ebay-listing-images"
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
    : "SAME_DAY_IMAGE_PACKAGE_RUNTIME_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  return text(record(error).message, 1_000).match(/[A-Z][A-Z0-9_]{5,}/)?.[0]
    ?? fallback
}

function candidatePath(candidateKey: string) {
  return sha256(candidateKey).slice(0, 24)
}

function exactSixAssetIds(value: unknown) {
  if (!Array.isArray(value)) return []
  const ids = [...new Set(value.map(uuid).filter(Boolean))]
  return ids.length === 6 ? ids : []
}

function currentHandoffPackage(candidate: JsonRecord) {
  const summary = record(candidate.manual_handoff_package)
  const handoffPackage = record(summary.package)
  const packageHash = text(summary.packageHash, 64)
  if (!Object.keys(handoffPackage).length || !/^[0-9a-f]{64}$/.test(packageHash)) {
    throw new Error("SAME_DAY_IMAGE_HANDOFF_CHECKPOINT_MISSING")
  }
  return { summary, handoffPackage, packageHash }
}

function currentFactsBinding(candidate: JsonRecord) {
  const summary = record(candidate.product_facts_summary)
  const factsPackage = record(summary.authoritativeFactsPackage)
  const factRunId = uuid(summary.factRunId)
  const factPackageHash = text(factsPackage.factPackageHash, 80)
  if (summary.currentRunBound !== true || !factRunId ||
    !/^sha256:[0-9a-f]{64}$/.test(factPackageHash)) {
    throw new Error("SAME_DAY_IMAGE_CURRENT_FACT_BINDING_MISSING")
  }
  return { summary, factsPackage, factRunId, factPackageHash }
}

function authorizationReference(candidate: JsonRecord) {
  const economics = record(candidate.economics_summary)
  if (economics.imageRightsConfirmed !== true ||
    economics.openAiImageSpendApproved !== true ||
    Number(economics.openAiImageMaximumCallsApproved) !== 1) {
    throw new Error("SAME_DAY_IMAGE_OPERATOR_AUTHORIZATION_REQUIRED")
  }
  const confirmedAt = text(economics.imageRightsConfirmedAt, 40)
  if (!Number.isFinite(Date.parse(confirmedAt))) {
    throw new Error("SAME_DAY_IMAGE_RIGHTS_ATTESTATION_INVALID")
  }
  return `SAME_DAY_OPERATOR_ATTESTATION:${text(candidate.id, 40)}:${confirmedAt}`
}

async function exactListingPackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  candidate: JsonRecord
  handoffPackage: JsonRecord
}) {
  const opportunityId = uuid(input.candidate.opportunity_id)
  const candidateKey = text(input.candidate.candidate_key, 300)
  if (!opportunityId || !candidateKey || !uuid(input.actorId)) {
    throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_SCOPE_INVALID")
  }
  const read = () => input.supabase.from("ebay_listing_packages").select("*")
    .eq("account_key", input.accountKey)
    .eq("opportunity_id", opportunityId)
    .maybeSingle()
  let { data, error } = await read()
  if (error) throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_READ_FAILED")
  if (!data) {
    const inserted = await input.supabase.from("ebay_listing_packages").insert({
      account_key: input.accountKey,
      opportunity_id: opportunityId,
      candidate_key: candidateKey,
      status: "draft",
      package_data: {
        ...input.handoffPackage,
        sameDayPilot: { runId: input.runId, candidateId: input.candidate.id },
      },
      readiness: 0,
      source_observed_at: new Date().toISOString(),
      created_by: input.actorId,
    }).select("*").single()
    if (inserted.error) {
      const raced = await read()
      if (raced.error || !raced.data) {
        throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_CREATE_FAILED")
      }
      data = raced.data
    } else data = inserted.data
  }
  if (text(data.account_key) !== input.accountKey ||
    uuid(data.created_by) !== input.actorId ||
    uuid(data.opportunity_id) !== opportunityId ||
    text(data.candidate_key, 300) !== candidateKey || data.status === "archived") {
    throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_OWNERSHIP_INVALID")
  }
  return record(data)
}

async function controlRow(
  supabase: SupabaseClient,
  controlId: string,
  actorId: string,
) {
  const { data, error } = await supabase
    .from("ebay_same_day_pilot_image_package_runs")
    .select("*")
    .eq("id", controlId)
    .eq("created_by", actorId)
    .maybeSingle()
  if (error || !data) throw new Error("SAME_DAY_IMAGE_CONTROL_READ_FAILED")
  return record(data)
}

async function reusableCompletedSet(input: {
  supabase: SupabaseClient
  control: JsonRecord
  accountKey: string
  actorId: string
  listingPackageId: string
}) {
  if (!["PENDING_REVIEW", "APPROVED"].includes(text(input.control.status))) return null
  const assetIds = exactSixAssetIds(input.control.asset_ids)
  if (!assetIds.length) throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_INVALID")
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("id,transformation,status,position")
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .eq("listing_package_id", input.listingPackageId)
    .in("id", assetIds)
    .in("status", ["pending_review", "approved"])
  if (error || data?.length !== 6) {
    throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_ASSETS_MISSING")
  }
  const slots = new Set(data.map((asset) => text(record(asset.transformation).slot)))
  if (EBAY_LISTING_IMAGE_SLOTS.some((slot) => !slots.has(slot))) {
    throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_SLOTS_INVALID")
  }
  return {
    listingPackageId: input.listingPackageId,
    controlId: text(input.control.id),
    assetIds,
    openAiCalls: Number(input.control.openai_calls) === 1 ? 1 : 0,
    generationMode: text(input.control.generation_mode),
    reused: true,
  }
}

async function cleanupUploaded(
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

export async function generateAndPersistSameDayImagePackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  candidate: JsonRecord
}) {
  const runId = uuid(input.runId)
  const candidateId = uuid(input.candidate.id)
  const actorId = uuid(input.actorId)
  if (!runId || !candidateId || !actorId) {
    throw new Error("SAME_DAY_IMAGE_RUNTIME_SCOPE_INVALID")
  }
  const { handoffPackage, packageHash } = currentHandoffPackage(input.candidate)
  const facts = currentFactsBinding(input.candidate)
  const rightsReference = authorizationReference(input.candidate)
  const listingPackage = await exactListingPackage({
    ...input,
    actorId,
    runId,
    handoffPackage,
  })
  const listingPackageId = uuid(listingPackage.id)
  if (!listingPackageId) throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_ID_INVALID")
  const { data: handoff, error: handoffError } = await input.supabase
    .from("ebay_same_day_pilot_handoffs")
    .select("id,fact_run_id,package_hash,package_data,status")
    .eq("run_id", runId)
    .eq("candidate_id", candidateId)
    .eq("fact_run_id", facts.factRunId)
    .eq("package_hash", packageHash)
    .eq("status", "AWAITING_IMAGE_APPROVAL")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (handoffError || !handoff || !uuid(handoff.id)) {
    throw new Error("SAME_DAY_IMAGE_DURABLE_HANDOFF_MISSING")
  }
  const imageUrls = Array.isArray(record(handoffPackage.images).urls)
    ? record(handoffPackage.images).urls as unknown[]
    : []
  const sourceUrl = imageUrls.map((value) => text(value, 2_000))
    .find(Boolean)
  if (!sourceUrl) throw new Error("SAME_DAY_IMAGE_AUTHORIZED_SOURCE_MISSING")

  const configuration = getListingImageFactoryConfiguration()
  if (configuration.deterministicComposition !== "READY") {
    throw new Error("SAME_DAY_IMAGE_COMPOSITION_ENVIRONMENT_BLOCKED")
  }
  const aiEnabled = configuration.aiGeneration === "READY"
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() ?? ""
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""
  const plan = buildSameDayImagePackagePlan({
    handoffPackage,
    authoritativeFactsPackage: facts.factsPackage,
    currentBinding: {
      candidateId,
      factRunId: facts.factRunId,
      factPackageHash: facts.factPackageHash,
    },
    rightsEvidence: {
      rightsBasis: "supplier_authorized",
      authorizationReference: rightsReference,
      rightsEvidenceConfirmed: true,
    },
    aiContext: aiEnabled ? { enabled: true, model } : { enabled: false },
  })
  const generationMode = aiEnabled
    ? "OPENAI_CONTEXT_PLATE"
    : "DETERMINISTIC_ONLY"
  const requestHash = plan.backgroundPlatePlan?.requestHash ?? "deterministic"
  const idempotencyKeyHash = sha256([
    input.accountKey, actorId, runId, candidateId, listingPackageId,
    facts.factRunId, packageHash, requestHash,
  ].join(":"))
  const leaseToken = randomUUID()
  const { data: claimData, error: claimError } = await input.supabase.rpc(
    "claim_ebay_same_day_pilot_image_package_run",
    {
      p_account_key: input.accountKey,
      p_actor: actorId,
      p_run_id: runId,
      p_candidate_id: candidateId,
      p_listing_package_id: listingPackageId,
      p_fact_run_id: facts.factRunId,
      p_handoff_id: handoff.id,
      p_handoff_hash: packageHash,
      p_generation_mode: generationMode,
      p_idempotency_key_hash: idempotencyKeyHash,
      p_lease_token: leaseToken,
    },
  )
  if (claimError) throw new Error(databaseErrorCode(
    claimError,
    "SAME_DAY_IMAGE_CONTROL_CLAIM_FAILED",
  ))
  const claim = record(claimData)
  const controlId = uuid(claim.controlId ?? claim.runId ?? claim.id)
  if (!controlId) throw new Error("SAME_DAY_IMAGE_CONTROL_ID_INVALID")
  if (claim.claimed !== true) {
    const control = await controlRow(input.supabase, controlId, actorId)
    const reused = await reusableCompletedSet({
      supabase: input.supabase,
      control,
      accountKey: input.accountKey,
      actorId,
      listingPackageId,
    })
    if (reused) return { ...reused, aiConfiguration: configuration.aiGeneration }
    throw new Error("SAME_DAY_IMAGE_CONTROL_NOT_CLAIMED")
  }

  let providerDispatched = false
  let providerRequestId: string | null = null
  let source: Awaited<ReturnType<typeof fetchAuthorizedImageSource>> | null = null
  let generated: Awaited<ReturnType<typeof generateTransientSameDayImagePackage>> | null = null
  const uploaded: Array<{ bucket: string; path: string }> = []
  const persistedAssetIds: string[] = []
  try {
    source = await fetchAuthorizedImageSource(sourceUrl)
    const sourceMetadata = await sharp(source.buffer).metadata()
    generated = await generateTransientSameDayImagePackage({
      handoffPackage,
      authoritativeFactsPackage: facts.factsPackage,
      currentBinding: {
        candidateId,
        factRunId: facts.factRunId,
        factPackageHash: facts.factPackageHash,
      },
      rightsEvidence: {
        rightsBasis: "supplier_authorized",
        authorizationReference: rightsReference,
        rightsEvidenceConfirmed: true,
      },
      aiContext: aiEnabled ? { enabled: true, model } : { enabled: false },
      source: source.buffer,
      requestBackgroundPlate: aiEnabled ? async (safePlan) => {
        providerDispatched = true
        const plate = await requestSafeOpenAiBackgroundPlate({
          plan: safePlan,
          apiKey,
        })
        providerRequestId = plate.providerRequestId
        return plate
      } : undefined,
    })
    const roleBySlot: Record<string, string> = {
      MAIN_WHITE_BACKGROUND: "main",
      PACK_AND_COUNT: "detail",
      KEY_FEATURES: "detail",
      SIZE_AND_CONTENT: "label",
      USE_CONTEXT: "lifestyle",
      PACKAGE_CONTENTS: "packaging",
    }
    const pendingAssets: JsonRecord[] = []
    for (const composition of generated.transientAssets) {
      const assetId = randomUUID()
      const base = `${actorId}/${candidatePath(text(input.candidate.candidate_key, 300))}/${assetId}`
      const sourceExtension = source.contentType === "image/png"
        ? "png" : source.contentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${base}-source.${sourceExtension}`
      const outputPath = `${base}-optimized.jpg`
      const sourceUpload = await input.supabase.storage
        .from(EBAY_IMAGE_SOURCE_BUCKET)
        .upload(sourcePath, source.buffer, {
          contentType: source.contentType,
          upsert: false,
        })
      if (sourceUpload.error) throw new Error("SAME_DAY_IMAGE_SOURCE_STORAGE_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_SOURCE_BUCKET, path: sourcePath })
      const outputUpload = await input.supabase.storage
        .from(EBAY_IMAGE_STAGING_BUCKET)
        .upload(outputPath, composition.output, {
          contentType: "image/jpeg",
          upsert: false,
        })
      if (outputUpload.error) throw new Error("SAME_DAY_IMAGE_OUTPUT_STORAGE_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_STAGING_BUCKET, path: outputPath })
      pendingAssets.push({
        id: assetId,
        asset_role: roleBySlot[composition.slot],
        source_kind: "authorized_url",
        source_url: source.sourceUrl,
        source_storage_path: sourcePath,
        output_storage_path: outputPath,
        source_sha256: composition.sourceSha256,
        output_sha256: composition.outputSha256,
        source_width: sourceMetadata.width,
        source_height: sourceMetadata.height,
        output_width: composition.width,
        output_height: composition.height,
        output_bytes: composition.bytes,
        rights_basis: "supplier_authorized",
        authorization_reference: rightsReference,
        rights_evidence_confirmed: true,
        transformation_version: EBAY_LISTING_IMAGE_SET_VERSION,
        transformation: {
          ...composition.transformation,
          sameDayPilotRunId: runId,
          sameDayPilotCandidateId: candidateId,
          sameDayImageControlId: controlId,
          authoritativeFactPackageHash: facts.factPackageHash,
        },
        qa_result: composition.qa,
      })
    }
    const { data: saved, error: saveError } = await input.supabase.rpc(
      "ebay_create_pending_listing_image_set",
      {
        p_package_id: listingPackageId,
        p_account_key: input.accountKey,
        p_actor: actorId,
        p_opportunity_id: input.candidate.opportunity_id,
        p_candidate_key: input.candidate.candidate_key,
        p_assets: pendingAssets,
      },
    )
    const savedRows = (Array.isArray(saved) ? saved : saved ? [saved] : [])
      .map(record)
    persistedAssetIds.push(...savedRows.map((row) => uuid(row.id)).filter(Boolean))
    if (saveError || persistedAssetIds.length !== 6) {
      throw new Error(databaseErrorCode(
        saveError,
        "SAME_DAY_IMAGE_ASSET_SET_SAVE_FAILED",
      ))
    }
    const { data: completed, error: completionError } = await input.supabase.rpc(
      "complete_ebay_same_day_pilot_image_package_run",
      {
        p_control_id: controlId,
        p_actor: actorId,
        p_lease_token: leaseToken,
        p_asset_ids: persistedAssetIds,
        p_openai_calls: generated.counters.openAiCalls,
        p_provider_request_id: providerRequestId,
      },
    )
    if (completionError || !completed) {
      throw new Error(databaseErrorCode(
        completionError,
        "SAME_DAY_IMAGE_CONTROL_COMPLETION_FAILED",
      ))
    }
    return {
      listingPackageId,
      controlId,
      assetIds: persistedAssetIds,
      openAiCalls: generated.counters.openAiCalls,
      generationMode,
      aiConfiguration: configuration.aiGeneration,
      reused: false,
    }
  } catch (error) {
    const code = safeError(error)
    if (persistedAssetIds.length) {
      await input.supabase.from("ebay_listing_image_assets").delete()
        .eq("account_key", input.accountKey)
        .eq("created_by", actorId)
        .eq("listing_package_id", listingPackageId)
        .in("id", persistedAssetIds)
    }
    await cleanupUploaded(input.supabase, uploaded)
    const knownRejectedRequest = /^EBAY_IMAGE_OPENAI_HTTP_(429|5[0-9]{2})$/.test(code)
    await input.supabase.rpc("fail_ebay_same_day_pilot_image_package_run", {
      p_control_id: controlId,
      p_actor: actorId,
      p_lease_token: leaseToken,
      p_error_code: code,
      p_openai_call_made: providerDispatched && !knownRejectedRequest,
    })
    throw error
  } finally {
    if (generated) disposeTransientSameDayImageAssets(generated.transientAssets)
    source?.buffer.fill(0)
  }
}

async function verifiedStagedPublication(input: {
  supabase: SupabaseClient
  actorId: string
  candidateKey: string
  asset: JsonRecord
}) {
  const assetId = uuid(input.asset.id)
  const stagingPath = text(input.asset.output_storage_path, 1_000)
  if (!assetId || !stagingPath) throw new Error("SAME_DAY_IMAGE_STAGING_ASSET_INVALID")
  const { data: blob, error } = await input.supabase.storage
    .from(EBAY_IMAGE_STAGING_BUCKET)
    .download(stagingPath)
  if (error || !blob) throw new Error("SAME_DAY_IMAGE_STAGING_DOWNLOAD_FAILED")
  const bytes = Buffer.from(await blob.arrayBuffer())
  try {
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES ||
      bytes.length !== Number(input.asset.output_bytes) ||
      sha256(bytes) !== text(input.asset.output_sha256, 64)) {
      throw new Error("SAME_DAY_IMAGE_STAGING_INTEGRITY_FAILED")
    }
    const publishedPath = `${input.actorId}/${candidatePath(input.candidateKey)}/${assetId}.jpg`
    const uploaded = await input.supabase.storage.from(OUTPUT_BUCKET)
      .upload(publishedPath, bytes, { contentType: "image/jpeg", upsert: false })
    if (uploaded.error) {
      const existing = await input.supabase.storage.from(OUTPUT_BUCKET)
        .download(publishedPath)
      if (existing.error || !existing.data) {
        throw new Error("SAME_DAY_IMAGE_PUBLICATION_STORAGE_FAILED")
      }
      const existingBytes = Buffer.from(await existing.data.arrayBuffer())
      try {
        if (existingBytes.length !== bytes.length || sha256(existingBytes) !== sha256(bytes)) {
          throw new Error("SAME_DAY_IMAGE_PUBLICATION_CONFLICT")
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

export async function reviewSameDayImagePackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  candidate: JsonRecord
  decision: "APPROVE" | "REJECT"
}) {
  const actorId = uuid(input.actorId)
  const candidateId = uuid(input.candidate.id)
  const candidateKey = text(input.candidate.candidate_key, 300)
  const summary = record(input.candidate.image_package_summary)
  const controlId = uuid(summary.controlId)
  const listingPackageId = uuid(summary.listingPackageId)
  const assetIds = exactSixAssetIds(summary.assetIds)
  if (!actorId || !candidateId || !candidateKey || !controlId ||
    !listingPackageId || !assetIds.length) {
    throw new Error("SAME_DAY_IMAGE_REVIEW_SET_SCOPE_INVALID")
  }
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("*")
    .eq("account_key", input.accountKey)
    .eq("created_by", actorId)
    .eq("listing_package_id", listingPackageId)
    .in("id", assetIds)
    .in("status", input.decision === "REJECT"
      ? ["pending_review", "rejected"]
      : ["pending_review", "approved"])
    .order("position", { ascending: true })
  if (error || data?.length !== 6) throw new Error("SAME_DAY_IMAGE_REVIEW_SET_MISSING")
  const assets = data.map(record)
  const slots = new Set(assets.map((asset) => text(record(asset.transformation).slot)))
  if (EBAY_LISTING_IMAGE_SLOTS.some((slot) => !slots.has(slot))) {
    throw new Error("SAME_DAY_IMAGE_REVIEW_SET_SLOTS_INVALID")
  }
  let manifest: JsonRecord[] = []
  if (input.decision === "APPROVE") {
    manifest = await Promise.all(assets.map(async (asset) => {
      if (asset.status === "approved") {
        return {
          asset_id: asset.id,
          public_url: asset.public_url,
          published_storage_path: asset.published_storage_path,
        }
      }
      return verifiedStagedPublication({
        supabase: input.supabase,
        actorId,
        candidateKey,
        asset,
      })
    }))
  }
  const { data: reviewed, error: reviewError } = await input.supabase.rpc(
    "review_ebay_same_day_pilot_image_package_set",
    {
      p_control_id: controlId,
      p_actor: actorId,
      p_decision: input.decision,
      p_confirmed: true,
      p_publication_manifest: manifest,
    },
  )
  if (reviewError || !reviewed) throw new Error(databaseErrorCode(
    reviewError,
    "SAME_DAY_IMAGE_SET_REVIEW_FAILED",
  ))
  const result = record(reviewed)
  const urls = Array.isArray(result.publicUrls)
    ? result.publicUrls.map((value) => text(value, 2_000)).filter((value) => value.startsWith("https://"))
    : manifest.map((entry) => text(entry.public_url, 2_000)).filter((value) => value.startsWith("https://"))
  if (input.decision === "APPROVE" && urls.length !== 6) {
    throw new Error("SAME_DAY_IMAGE_APPROVED_URL_SET_INVALID")
  }
  await Promise.all(assets.map(async (asset) => {
    const paths = [text(asset.output_storage_path, 1_000), text(asset.source_storage_path, 1_000)]
    await Promise.all([
      paths[0] ? input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET).remove([paths[0]]) : null,
      paths[1] ? input.supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET).remove([paths[1]]) : null,
    ])
  }))
  return {
    controlId,
    listingPackageId,
    assetIds,
    approved: input.decision === "APPROVE",
    publicUrls: input.decision === "APPROVE" ? urls : [],
    ebayWrites: 0,
  }
}
