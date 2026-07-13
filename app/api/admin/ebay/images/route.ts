export const runtime = "nodejs"
export const maxDuration = 60

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import {
  EBAY_IMAGE_MAX_SOURCE_BYTES,
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  fetchAuthorizedImageSource,
  optimizeAuthorizedEbayMainImage,
  validateImageRightsEvidence,
} from "@/lib/ebay/ebay-image-optimization-service"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const OUTPUT_BUCKET = "ebay-listing-images"
const SOURCE_BUCKET = "ebay-listing-image-sources"
const STAGING_BUCKET = "ebay-listing-image-staging"
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : "EBAY_IMAGE_PIPELINE_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  const message = text(record(error).message, 1_000)
  return message.match(/EBAY_[A-Z0-9_]+/)?.[0] ?? fallback
}

function candidatePath(candidateKey: string) {
  return createHash("sha256").update(candidateKey).digest("hex").slice(0, 24)
}

function supportedUpload(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    && file.size > 0
    && file.size <= EBAY_IMAGE_MAX_SOURCE_BYTES
}

async function parseBody(req: Request) {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData()
    const file = form.get("file")
    return {
      action: text(form.get("action"), 40),
      candidateKey: text(form.get("candidateKey"), 300),
      opportunityId: text(form.get("opportunityId"), 40),
      listingPackageId: text(form.get("listingPackageId"), 40),
      assetRole: text(form.get("assetRole"), 30),
      rightsBasis: text(form.get("rightsBasis"), 40),
      authorizationReference: text(form.get("authorizationReference"), 500),
      rightsEvidenceConfirmed: form.get("rightsEvidenceConfirmed") === "true",
      file: file instanceof File ? file : null,
    }
  }
  return record(await req.json())
}

async function packageForActor(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  packageId: string,
  actor: string,
) {
  const { data, error } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", packageId)
    .eq("created_by", actor)
    .maybeSingle()
  if (error || !data) throw new Error("EBAY_IMAGE_PACKAGE_NOT_FOUND")
  return data as JsonRecord
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const url = new URL(req.url)
    const packageId = uuid(url.searchParams.get("packageId"))
    const candidateKey = text(url.searchParams.get("candidateKey"), 300)
    const supabase = getSupabaseAdminClient()
    let query = supabase
      .from("ebay_listing_image_assets")
      .select("*")
      .eq("created_by", validation.userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50)
    if (packageId) query = query.eq("listing_package_id", packageId)
    else if (candidateKey) query = query.eq("candidate_key", candidateKey)
    else return NextResponse.json({ success: false, error: "EBAY_IMAGE_SCOPE_REQUIRED" }, { status: 400 })
    const { data, error } = await query
    if (error) throw new Error("EBAY_IMAGE_ASSET_LIST_FAILED")
    const assets = await Promise.all((data ?? []).map(async (asset) => {
      const reviewable = asset.status !== "rejected"
      const [sourcePreview, outputPreview] = await Promise.all([
        reviewable && asset.source_storage_path
          ? supabase.storage.from(SOURCE_BUCKET)
            .createSignedUrl(asset.source_storage_path, 300)
          : Promise.resolve({ data: null }),
        asset.status === "pending_review" && asset.output_storage_path
          ? supabase.storage.from(STAGING_BUCKET)
            .createSignedUrl(asset.output_storage_path, 300)
          : Promise.resolve({ data: null }),
      ])
      return {
        ...asset,
        source_preview_url: sourcePreview.data?.signedUrl
          ?? (reviewable ? asset.source_url : null),
        output_preview_url: asset.public_url
          ?? outputPreview.data?.signedUrl
          ?? null,
      }
    }))
    return NextResponse.json({
      success: true,
      assets,
      capabilities: {
        deterministicWhiteBackground: true,
        ownedUpload: true,
        authorizedUrl: true,
        humanApprovalRequired: true,
        pendingOutputsPrivate: true,
        generativeAiEnabled: false,
        output: "1600x1600 JPEG",
      },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  const actor = validation.userId
  try {
    const body = await parseBody(req)
    const action = text(body.action, 40)
    const supabase = getSupabaseAdminClient()

    if (action === "optimize_url" || action === "optimize_upload") {
      const candidateKey = text(body.candidateKey, 300)
      if (!candidateKey) {
        return NextResponse.json({ success: false, error: "EBAY_IMAGE_CANDIDATE_REQUIRED" }, { status: 400 })
      }
      const packageId = uuid(body.listingPackageId)
      const opportunityId = uuid(body.opportunityId)
      if (!packageId) {
        return NextResponse.json(
          { success: false, error: "EBAY_IMAGE_PACKAGE_REQUIRED" },
          { status: 400 },
        )
      }
      const rights = validateImageRightsEvidence(body)
      const assetRole = ["main", "detail", "packaging", "label", "lifestyle"]
        .includes(text(body.assetRole, 30)) ? text(body.assetRole, 30) : "main"
      const packageRow = await packageForActor(supabase, packageId, actor)
      if (text(packageRow.candidate_key, 300) !== candidateKey) {
        throw new Error("EBAY_IMAGE_PACKAGE_CANDIDATE_MISMATCH")
      }
      const packageOpportunityId = uuid(packageRow.opportunity_id)
      if (!packageOpportunityId) {
        throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_INVALID")
      }
      if (opportunityId && packageOpportunityId !== opportunityId) {
        throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_MISMATCH")
      }

      let sourceBuffer: Buffer
      let sourceUrl: string | null = null
      let sourceContentType = "image/jpeg"
      let sourceKind: "authorized_url" | "owned_upload"
      if (action === "optimize_url") {
        const fetched = await fetchAuthorizedImageSource(body.sourceUrl)
        sourceBuffer = fetched.buffer
        sourceUrl = fetched.sourceUrl
        sourceContentType = fetched.contentType
        sourceKind = "authorized_url"
      } else {
        const file = body.file
        if (!(file instanceof File) || !supportedUpload(file)) {
          return NextResponse.json({ success: false, error: "EBAY_IMAGE_UPLOAD_INVALID" }, { status: 400 })
        }
        sourceBuffer = Buffer.from(await file.arrayBuffer())
        sourceContentType = file.type
        sourceKind = "owned_upload"
      }

      const optimized = await optimizeAuthorizedEbayMainImage(sourceBuffer)
      const duplicateQuery = supabase
        .from("ebay_listing_image_assets")
        .select("*")
        .eq("created_by", actor)
        .eq("candidate_key", candidateKey)
        .eq("output_sha256", optimized.outputSha256)
        .eq("listing_package_id", packageId)
        .in("status", ["pending_review", "approved"])
      const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle()
      if (duplicateError) throw new Error("EBAY_IMAGE_DUPLICATE_CHECK_FAILED")
      if (duplicate) return NextResponse.json({ success: true, created: false, asset: duplicate })

      const assetId = crypto.randomUUID()
      const basePath = `${actor}/${candidatePath(candidateKey)}/${assetId}`
      const outputPath = `${basePath}-optimized.jpg`
      const sourceExtension = sourceContentType === "image/png" ? "png" : sourceContentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${basePath}-source.${sourceExtension}`
      const { error: sourceUploadError } = await supabase.storage
        .from(SOURCE_BUCKET)
        .upload(sourcePath, sourceBuffer, { contentType: sourceContentType, upsert: false })
      if (sourceUploadError) throw new Error("EBAY_IMAGE_SOURCE_STORAGE_FAILED")
      const { error: outputUploadError } = await supabase.storage
        .from(STAGING_BUCKET)
        .upload(outputPath, optimized.output, { contentType: "image/jpeg", upsert: false })
      if (outputUploadError) {
        await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
        throw new Error("EBAY_IMAGE_OUTPUT_STORAGE_FAILED")
      }
      const { data: createdAssets, error: insertError } = await supabase.rpc(
        "ebay_create_pending_listing_image",
        {
          p_package_id: packageId,
          p_actor: actor,
          p_opportunity_id: packageOpportunityId,
          p_candidate_key: candidateKey,
          p_asset: {
            id: assetId,
            asset_role: assetRole,
            source_kind: sourceKind,
            source_url: sourceUrl,
            source_storage_path: sourcePath,
            output_storage_path: outputPath,
            source_sha256: optimized.sourceSha256,
            output_sha256: optimized.outputSha256,
            source_width: optimized.source.width,
            source_height: optimized.source.height,
            output_width: optimized.outputMetadata.width,
            output_height: optimized.outputMetadata.height,
            output_bytes: optimized.outputMetadata.bytes,
            rights_basis: rights.rightsBasis,
            authorization_reference: rights.authorizationReference,
            rights_evidence_confirmed: rights.rightsEvidenceConfirmed,
            transformation_version: EBAY_IMAGE_TRANSFORMATION_VERSION,
            transformation: optimized.transformation,
            qa_result: optimized.qa,
          },
        },
      )
      const asset = Array.isArray(createdAssets)
        ? record(createdAssets[0])
        : record(createdAssets)
      if (insertError || !asset.id) {
        const { data: concurrentDuplicate } = await supabase
          .from("ebay_listing_image_assets")
          .select("*")
          .eq("created_by", actor)
          .eq("candidate_key", candidateKey)
          .eq("output_sha256", optimized.outputSha256)
          .eq("listing_package_id", packageId)
          .in("status", ["pending_review", "approved"])
          .maybeSingle()
        if (concurrentDuplicate) {
          const rpcCommittedThisAsset = concurrentDuplicate.id === assetId
          if (!rpcCommittedThisAsset) {
            await supabase.storage.from(STAGING_BUCKET).remove([outputPath])
            await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
          }
          return NextResponse.json({
            success: true,
            created: rpcCommittedThisAsset,
            asset: concurrentDuplicate,
          })
        }
        await supabase.storage.from(STAGING_BUCKET).remove([outputPath])
        await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
        throw new Error(databaseErrorCode(insertError, "EBAY_IMAGE_ASSET_SAVE_FAILED"))
      }
      return NextResponse.json({ success: true, created: true, asset })
    }

    if (action === "approve" || action === "reject") {
      const assetId = uuid(body.assetId)
      const packageId = uuid(body.listingPackageId)
      if (!assetId || !packageId) {
        return NextResponse.json(
          { success: false, error: "EBAY_IMAGE_REVIEW_SCOPE_REQUIRED" },
          { status: 400 },
        )
      }
      const { data: reviewAsset, error: reviewAssetError } = await supabase
        .from("ebay_listing_image_assets")
        .select("*")
        .eq("id", assetId)
        .eq("listing_package_id", packageId)
        .eq("created_by", actor)
        .eq("status", "pending_review")
        .maybeSingle()
      if (reviewAssetError || !reviewAsset) {
        throw new Error("EBAY_IMAGE_ASSET_NOT_REVIEWABLE")
      }

      let publicUrl: string | null = null
      let publishedPath: string | null = null
      if (action === "approve") {
        const stagingPath = text(reviewAsset.output_storage_path, 1_000)
        if (!stagingPath) throw new Error("EBAY_IMAGE_STAGING_ASSET_MISSING")
        const { data: stagedBlob, error: stagingDownloadError } = await supabase.storage
          .from(STAGING_BUCKET)
          .download(stagingPath)
        if (stagingDownloadError || !stagedBlob) {
          throw new Error("EBAY_IMAGE_STAGING_DOWNLOAD_FAILED")
        }
        const stagedOutput = Buffer.from(await stagedBlob.arrayBuffer())
        if (
          !stagedOutput.length
          || stagedOutput.length > MAX_OUTPUT_BYTES
          || stagedOutput.length !== Number(reviewAsset.output_bytes)
          || createHash("sha256").update(stagedOutput).digest("hex")
            !== text(reviewAsset.output_sha256, 64)
        ) {
          throw new Error("EBAY_IMAGE_STAGING_INTEGRITY_FAILED")
        }
        const reviewCandidateKey = text(reviewAsset.candidate_key, 300)
        if (!reviewCandidateKey) throw new Error("EBAY_IMAGE_CANDIDATE_REQUIRED")
        publishedPath = `${actor}/${candidatePath(reviewCandidateKey)}/${assetId}.jpg`
        const { error: publishError } = await supabase.storage
          .from(OUTPUT_BUCKET)
          .upload(publishedPath, stagedOutput, {
            contentType: "image/jpeg",
            upsert: false,
          })
        if (publishError) {
          // The storage upload and SQL review cannot be one cross-service
          // transaction. A prior request may therefore have uploaded these
          // exact bytes and stopped before committing the review. Reuse only
          // a byte-for-byte/hash-identical object; never overwrite a conflict.
          const { data: existingPublishedBlob, error: existingPublishedError } =
            await supabase.storage.from(OUTPUT_BUCKET).download(publishedPath)
          if (existingPublishedError || !existingPublishedBlob) {
            throw new Error("EBAY_IMAGE_PUBLICATION_STORAGE_FAILED")
          }
          const existingPublished = Buffer.from(
            await existingPublishedBlob.arrayBuffer(),
          )
          if (
            existingPublished.length !== stagedOutput.length ||
            createHash("sha256").update(existingPublished).digest("hex") !==
              text(reviewAsset.output_sha256, 64)
          ) {
            throw new Error("EBAY_IMAGE_PUBLICATION_CONFLICT")
          }
        }
        publicUrl = supabase.storage.from(OUTPUT_BUCKET)
          .getPublicUrl(publishedPath).data.publicUrl
      }

      const { data: reviewData, error: reviewError } = await supabase.rpc(
        "ebay_review_listing_image_and_attach",
        {
          p_package_id: packageId,
          p_asset_id: assetId,
          p_actor: actor,
          p_decision: action,
          p_public_url: publicUrl,
          p_published_storage_path: publishedPath,
        },
      )
      let resolvedReviewData: unknown = reviewData
      if (reviewError || !resolvedReviewData) {
        const { data: reconciledAsset } = await supabase
          .from("ebay_listing_image_assets")
          .select("*")
          .eq("id", assetId)
          .eq("listing_package_id", packageId)
          .eq("created_by", actor)
          .maybeSingle()
        const reviewCommitted = action === "approve"
          ? reconciledAsset?.status === "approved"
            && reconciledAsset.published_storage_path === publishedPath
            && reconciledAsset.public_url === publicUrl
          : reconciledAsset?.status === "rejected"
        if (reviewCommitted && reconciledAsset) {
          const reconciledPackage = await packageForActor(supabase, packageId, actor)
          resolvedReviewData = {
            asset: reconciledAsset,
            package: {
              imageUrls: record(reconciledPackage.package_data).imageUrls ?? [],
            },
          }
        } else {
          // Keep an exact public promotion while its database row is still
          // pending: it is the idempotency record for a safe retry and another
          // concurrent approval may be about to commit it. Delete only after
          // the asset has definitively disappeared or been rejected.
          if (
            publishedPath &&
            (!reconciledAsset || reconciledAsset.status === "rejected")
          ) {
            await supabase.storage.from(OUTPUT_BUCKET).remove([publishedPath])
          }
          throw new Error(databaseErrorCode(
            reviewError,
            "EBAY_IMAGE_ASSET_REVIEW_FAILED",
          ))
        }
      }
      let cleanupPending = false
      if (action === "approve") {
        const cleanupPaths = [text(reviewAsset.output_storage_path, 1_000)]
          .filter(Boolean)
        const { error: cleanupError } = await supabase.storage
          .from(STAGING_BUCKET)
          .remove(cleanupPaths)
        cleanupPending = Boolean(cleanupError)
      } else {
        const stagingPath = text(reviewAsset.output_storage_path, 1_000)
        const sourcePath = text(reviewAsset.source_storage_path, 1_000)
        const [stagingCleanup, sourceCleanup] = await Promise.all([
          stagingPath
            ? supabase.storage.from(STAGING_BUCKET).remove([stagingPath])
            : Promise.resolve({ error: null }),
          sourcePath
            ? supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
            : Promise.resolve({ error: null }),
        ])
        cleanupPending = Boolean(stagingCleanup.error || sourceCleanup.error)
      }
      const result = record(resolvedReviewData)
      const packageResult = record(result.package)
      const imageUrls = Array.isArray(packageResult.imageUrls)
        ? packageResult.imageUrls.filter(
          (value): value is string => typeof value === "string",
        )
        : []
      return NextResponse.json({
        success: true,
        asset: record(result.asset),
        imageUrls,
        storageCleanupPending: cleanupPending,
      })
    }

    if (action === "reorder") {
      const packageId = uuid(body.listingPackageId)
      const orderedAssetIds = Array.isArray(body.orderedAssetIds)
        ? body.orderedAssetIds.map(uuid).filter(Boolean).slice(0, 24)
        : []
      if (!packageId || !orderedAssetIds.length) {
        return NextResponse.json({ success: false, error: "EBAY_IMAGE_ORDER_REQUIRED" }, { status: 400 })
      }
      if (new Set(orderedAssetIds).size !== orderedAssetIds.length) {
        throw new Error("EBAY_IMAGE_ORDER_OWNERSHIP_MISMATCH")
      }
      const { data, error } = await supabase.rpc(
        "ebay_reorder_listing_images_and_attach",
        {
          p_package_id: packageId,
          p_actor: actor,
          p_ordered_asset_ids: orderedAssetIds,
        },
      )
      if (error || !data) {
        throw new Error(databaseErrorCode(error, "EBAY_IMAGE_ORDER_SAVE_FAILED"))
      }
      const result = record(data)
      const imageUrls = Array.isArray(result.imageUrls)
        ? result.imageUrls.filter(
          (value): value is string => typeof value === "string",
        )
        : []
      return NextResponse.json({ success: true, imageUrls })
    }

    return NextResponse.json({ success: false, error: "EBAY_IMAGE_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    const code = safeError(error)
    const status = /CAP_REACHED|NOT_REVIEWABLE|PENDING_REVIEW_BLOCKS_REORDER|STAGING_INTEGRITY/.test(code)
      ? 409
      : /REQUIRED|INVALID|NOT_ALLOWED|BELOW_500PX|MANUAL_REMOVAL|MISMATCH/.test(code)
      ? 400
      : /NOT_FOUND/.test(code) ? 404 : 502
    return NextResponse.json({ success: false, error: code }, { status })
  }
}
