import { createHash } from "node:crypto"

import {
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  fetchAuthorizedImageSource,
  optimizeAuthorizedEbayMainImage,
} from "./ebay-image-optimization-service"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
  enqueueEbayImageStorageCleanup,
} from "./ebay-image-storage-cleanup"
import {
  automaticLunaImageQaResultV1,
  evaluateLunaImageAutomaticHappyPathV1,
  LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1,
  resolveInheritedLunaSupplierImageRightsV1,
} from "./luna-supplier-image-rights-authority-v1"
import { getSupabaseAdminClient } from "../supabase-admin"

const OUTPUT_BUCKET = "ebay-listing-images"
const SOURCE_BUCKET = EBAY_IMAGE_SOURCE_BUCKET
const STAGING_BUCKET = EBAY_IMAGE_STAGING_BUCKET
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024

type JsonRecord = Record<string, unknown>
type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>

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
    : "LUNA_IMAGE_AUTOMATIC_PIPELINE_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  const message = text(record(error).message, 1_000)
  return message.match(/[A-Z][A-Z0-9_]+/)?.[0] ?? fallback
}

function candidatePath(candidateKey: string) {
  return createHash("sha256").update(candidateKey).digest("hex").slice(0, 24)
}

async function exactLunaSupplierImageContext(
  supabase: SupabaseAdmin,
  packageRow: JsonRecord,
) {
  const opportunityId = uuid(packageRow.opportunity_id)
  if (!opportunityId) throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_INVALID")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment")
    .eq("id", opportunityId)
    .maybeSingle()
  if (opportunityError || !opportunity) {
    throw new Error("LUNA_SUPPLIER_IMAGE_OPPORTUNITY_NOT_FOUND")
  }
  const supplierProductId = text(opportunity.supplier_product_id, 100)
  const supplierVariantId = text(opportunity.supplier_variant_id, 100)
  const supplierSku = text(opportunity.supplier_sku, 100)
  const candidate = record(record(opportunity.assessment).candidate)
  const officialImageUrls = Array.isArray(candidate.imageUrls)
    ? candidate.imageUrls.map((value) => text(value, 2_000)).filter(Boolean)
    : []
  if (
    !supplierProductId || !supplierVariantId || !supplierSku ||
    text(candidate.supplierProductId, 100) !== supplierProductId ||
    text(candidate.supplierVariantId, 100) !== supplierVariantId ||
    text(candidate.sku, 100) !== supplierSku ||
    officialImageUrls.length < 1
  ) throw new Error("LUNA_SUPPLIER_IMAGE_OPPORTUNITY_IDENTITY_INCOMPLETE")
  const { data: catalog, error: catalogError } = await supabase
    .from("market_radar_latest_variants")
    .select("source_key,supplier_product_id,supplier_variant_id,sku")
    .eq("supplier_product_id", supplierProductId)
    .eq("supplier_variant_id", supplierVariantId)
    .eq("sku", supplierSku)
    .limit(1)
    .maybeSingle()
  if (catalogError || !catalog) {
    throw new Error("LUNA_SUPPLIER_IMAGE_CATALOG_IDENTITY_NOT_FOUND")
  }
  const opportunityIdentity = {
    supplierProductId,
    supplierVariantId,
    supplierSku,
  }
  return {
    opportunityId,
    opportunityCandidateKey: text(opportunity.candidate_key, 300),
    opportunityIdentity,
    catalogIdentity: {
      supplierProductId: text(catalog.supplier_product_id, 100),
      supplierVariantId: text(catalog.supplier_variant_id, 100),
      supplierSku: text(catalog.sku, 100),
    },
    catalogSourceKey: text(catalog.source_key, 100),
    officialImageUrls: [...new Set(officialImageUrls)].slice(0, 24),
  }
}

async function approveAutomaticAsset(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  actor: string
  packageId: string
  asset: JsonRecord
}>) {
  const assetId = uuid(input.asset.id)
  const candidateKey = text(input.asset.candidate_key, 300)
  const qa = record(input.asset.qa_result)
  if (!assetId || !candidateKey || input.asset.status !== "pending_review" ||
      qa.automaticStatus !== "PASSED" ||
      qa.approvalMode !== "AUTOMATIC_DETERMINISTIC" ||
      qa.imageReadiness !== "IMAGE_READY_AUTO_PASS" ||
      record(qa.rightsAuthority).version !==
        LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1.version ||
      input.asset.rights_evidence_confirmed !== true) {
    throw new Error("LUNA_IMAGE_AUTOMATIC_APPROVAL_EVIDENCE_INVALID")
  }
  const stagingPath = text(input.asset.output_storage_path, 1_000)
  const outputSha256 = text(input.asset.output_sha256, 64)
  if (!stagingPath || !/^[0-9a-f]{64}$/.test(outputSha256)) {
    throw new Error("LUNA_IMAGE_AUTOMATIC_STAGING_EVIDENCE_INVALID")
  }
  const download = await input.supabase.storage.from(STAGING_BUCKET)
    .download(stagingPath)
  if (download.error || !download.data) {
    throw new Error("EBAY_IMAGE_STAGING_DOWNLOAD_FAILED")
  }
  const output = Buffer.from(await download.data.arrayBuffer())
  if (!output.length || output.length > MAX_OUTPUT_BYTES ||
      output.length !== Number(input.asset.output_bytes) ||
      createHash("sha256").update(output).digest("hex") !== outputSha256) {
    output.fill(0)
    throw new Error("EBAY_IMAGE_STAGING_INTEGRITY_FAILED")
  }
  const publishedPath = `${input.actor}/${candidatePath(candidateKey)}/${assetId}.jpg`
  const upload = await input.supabase.storage.from(OUTPUT_BUCKET)
    .upload(publishedPath, output, { contentType: "image/jpeg", upsert: false })
  let publicObjectCreated = !upload.error
  if (upload.error) {
    const existing = await input.supabase.storage.from(OUTPUT_BUCKET)
      .download(publishedPath)
    if (existing.error || !existing.data) {
      output.fill(0)
      throw new Error("EBAY_IMAGE_PUBLICATION_STORAGE_FAILED")
    }
    const existingBytes = Buffer.from(await existing.data.arrayBuffer())
    const exactExisting = existingBytes.length === output.length &&
      createHash("sha256").update(existingBytes).digest("hex") === outputSha256
    existingBytes.fill(0)
    if (!exactExisting) {
      output.fill(0)
      throw new Error("EBAY_IMAGE_PUBLICATION_CONFLICT")
    }
    publicObjectCreated = false
  }
  output.fill(0)
  const publicUrl = input.supabase.storage.from(OUTPUT_BUCKET)
    .getPublicUrl(publishedPath).data.publicUrl
  const reviewed = await input.supabase.rpc(
    "ebay_review_listing_image_and_attach",
    {
      p_package_id: input.packageId,
      p_account_key: input.accountKey,
      p_asset_id: assetId,
      p_actor: input.actor,
      p_decision: "approve",
      p_public_url: publicUrl,
      p_published_storage_path: publishedPath,
    },
  )
  if (reviewed.error || !reviewed.data) {
    const { data: reconciled } = await input.supabase
      .from("ebay_listing_image_assets")
      .select("*")
      .eq("id", assetId)
      .eq("listing_package_id", input.packageId)
      .eq("account_key", input.accountKey)
      .eq("created_by", input.actor)
      .maybeSingle()
    const committed = reconciled?.status === "approved" &&
      reconciled.published_storage_path === publishedPath &&
      reconciled.public_url === publicUrl
    if (!committed) {
      if (publicObjectCreated) {
        const compensation = await input.supabase.storage.from(OUTPUT_BUCKET)
          .remove([publishedPath])
        if (compensation.error) {
          throw new Error("PUBLIC_STORAGE_COMPENSATION_FAILED")
        }
      }
      throw new Error(databaseErrorCode(
        reviewed.error,
        "LUNA_IMAGE_AUTOMATIC_APPROVAL_FAILED",
      ))
    }
  }
  const cleanup = await input.supabase.storage.from(STAGING_BUCKET)
    .remove([stagingPath])
  if (cleanup.error) {
    await enqueueEbayImageStorageCleanup(input.supabase, {
      accountKey: input.accountKey,
      assetId,
      packageId: input.packageId,
      cleanupKind: "approved_staging",
      bucketId: STAGING_BUCKET,
      storageKey: stagingPath,
      expectedSha256: outputSha256,
      requestedBy: input.actor,
    })
  }
  const { data: approved, error: approvedError } = await input.supabase
    .from("ebay_listing_image_assets")
    .select("*")
    .eq("id", assetId)
    .eq("status", "approved")
    .maybeSingle()
  if (approvedError || !approved) {
    throw new Error("LUNA_IMAGE_AUTOMATIC_APPROVAL_READBACK_FAILED")
  }
  return approved as JsonRecord
}

export async function ensureAutomaticLunaSupplierImagesV1(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  actor: string
  packageRow: JsonRecord
}>) {
  const packageId = uuid(input.packageRow.id)
  const packageCandidateKey = text(input.packageRow.candidate_key, 300)
  if (!packageId || !packageCandidateKey) {
    throw new Error("EBAY_IMAGE_PACKAGE_IDENTITY_INVALID")
  }
  const context = await exactLunaSupplierImageContext(
    input.supabase,
    input.packageRow,
  )
  const accepted: JsonRecord[] = []
  const excluded: Array<{ ordinal: number; reason: string }> = []
  for (const [index, sourceUrl] of context.officialImageUrls.entries()) {
    let sourceBuffer: Buffer | null = null
    let optimizedOutput: Buffer | null = null
    try {
      const rights = resolveInheritedLunaSupplierImageRightsV1({
        packageCandidateKey,
        opportunityCandidateKey: context.opportunityCandidateKey,
        opportunityIdentity: context.opportunityIdentity,
        catalogIdentity: context.catalogIdentity,
        catalogSourceKey: context.catalogSourceKey,
        officialImageUrls: context.officialImageUrls,
        sourceUrl,
      })
      const fetched = await fetchAuthorizedImageSource(sourceUrl)
      sourceBuffer = fetched.buffer
      const optimized = await optimizeAuthorizedEbayMainImage(sourceBuffer)
      optimizedOutput = optimized.output
      const automatic = evaluateLunaImageAutomaticHappyPathV1({
        sourceSha256: optimized.sourceSha256,
        outputSha256: optimized.outputSha256,
        transformationVersion: EBAY_IMAGE_TRANSFORMATION_VERSION,
        transformation: optimized.transformation,
        qa: optimized.qa,
      })
      if (!automatic.passed) {
        excluded.push({
          ordinal: index + 1,
          reason: automatic.blockers[0] ?? "IMAGE_AUTOMATIC_QA_NOT_PASSED",
        })
        continue
      }
      const qaResult = automaticLunaImageQaResultV1({
        qa: optimized.qa,
        rights,
        automatic,
      })
      const duplicate = await input.supabase
        .from("ebay_listing_image_assets")
        .select("*")
        .eq("account_key", input.accountKey)
        .eq("created_by", input.actor)
        .eq("candidate_key", packageCandidateKey)
        .eq("output_sha256", optimized.outputSha256)
        .eq("listing_package_id", packageId)
        .in("status", ["pending_review", "approved"])
        .maybeSingle()
      if (duplicate.error) throw new Error("EBAY_IMAGE_DUPLICATE_CHECK_FAILED")
      if (duplicate.data) {
        const duplicateQa = record(duplicate.data.qa_result)
        if (duplicateQa.approvalMode !== "AUTOMATIC_DETERMINISTIC" ||
            record(duplicateQa.rightsAuthority).version !==
              LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1.version) {
          throw new Error("LUNA_IMAGE_EXISTING_ASSET_AUTHORITY_CONFLICT")
        }
        accepted.push(duplicate.data.status === "approved"
          ? duplicate.data
          : await approveAutomaticAsset({
            ...input,
            packageId,
            asset: duplicate.data,
          }))
        continue
      }
      const assetId = crypto.randomUUID()
      const basePath = `${input.actor}/${candidatePath(packageCandidateKey)}/${assetId}`
      const sourceExtension = fetched.contentType === "image/png"
        ? "png" : fetched.contentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${basePath}-source.${sourceExtension}`
      const outputPath = `${basePath}-optimized.jpg`
      const sourceUpload = await input.supabase.storage.from(SOURCE_BUCKET)
        .upload(sourcePath, sourceBuffer, {
          contentType: fetched.contentType,
          upsert: false,
        })
      if (sourceUpload.error) throw new Error("EBAY_IMAGE_SOURCE_STORAGE_FAILED")
      const outputUpload = await input.supabase.storage.from(STAGING_BUCKET)
        .upload(outputPath, optimizedOutput, {
          contentType: "image/jpeg",
          upsert: false,
        })
      if (outputUpload.error) {
        await input.supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
        throw new Error("EBAY_IMAGE_OUTPUT_STORAGE_FAILED")
      }
      const created = await input.supabase.rpc(
        "ebay_create_pending_listing_image",
        {
          p_package_id: packageId,
          p_account_key: input.accountKey,
          p_actor: input.actor,
          p_opportunity_id: context.opportunityId,
          p_candidate_key: packageCandidateKey,
          p_asset: {
            id: assetId,
            asset_role: index === 0 ? "main" : "detail",
            source_kind: "authorized_url",
            source_url: rights.sourceUrl,
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
            transformation: {
              ...optimized.transformation,
              supplierRightsAuthorityVersion: rights.authority.version,
              supplierImageIdentityDigest: rights.identityDigest,
              supplierImageSourceBindingDigest: rights.sourceBindingDigest,
            },
            qa_result: qaResult,
          },
        },
      )
      const asset = Array.isArray(created.data)
        ? record(created.data[0]) : record(created.data)
      if (created.error || !uuid(asset.id)) {
        await Promise.all([
          input.supabase.storage.from(STAGING_BUCKET).remove([outputPath]),
          input.supabase.storage.from(SOURCE_BUCKET).remove([sourcePath]),
        ])
        throw new Error(databaseErrorCode(
          created.error,
          "EBAY_IMAGE_ASSET_SAVE_FAILED",
        ))
      }
      accepted.push(await approveAutomaticAsset({
        ...input,
        packageId,
        asset,
      }))
    } catch (error) {
      excluded.push({ ordinal: index + 1, reason: safeError(error) })
    } finally {
      sourceBuffer?.fill(0)
      optimizedOutput?.fill(0)
    }
  }
  if (accepted.length < 1) {
    throw new Error("LUNA_IMAGE_VALID_COMPLIANT_COUNT_ZERO")
  }
  const acceptedIds = new Set(accepted.map((asset) => uuid(asset.id)).filter(Boolean))
  const approvedAssets = await input.supabase
    .from("ebay_listing_image_assets")
    .select("id,status")
    .eq("listing_package_id", packageId)
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actor)
    .eq("status", "approved")
  if (approvedAssets.error || (approvedAssets.data ?? []).some((asset) =>
    !acceptedIds.has(uuid(asset.id)))) {
    throw new Error("LUNA_IMAGE_EXISTING_ASSET_AUTHORITY_CONFLICT")
  }
  const refreshed = await input.supabase.from("ebay_listing_packages")
    .select("*")
    .eq("id", packageId)
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actor)
    .maybeSingle()
  if (refreshed.error || !refreshed.data) {
    throw new Error("LUNA_IMAGE_PACKAGE_READBACK_FAILED")
  }
  const packageData = record(refreshed.data.package_data)
  const draftConfiguration = record(packageData.draftConfiguration)
  const authority = LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1
  const nextPackageData = {
    ...packageData,
    draftConfiguration: {
      ...draftConfiguration,
      imageAuthorization: {
        ...record(draftConfiguration.imageAuthorization),
        rightsBasis: "supplier_authorized",
        source: "luna",
        authorityType: authority.authorityType,
        authorityProvenance: authority.authorityProvenance,
        authorityVersion: authority.version,
        supplier: authority.supplier,
        scope: authority.scope,
        status: authority.status,
        documentedLicense: false,
        operatorAttested: true,
        inheritedAutomatically: true,
        perProductReconfirmationRequired: false,
        perImageReconfirmationRequired: false,
      },
    },
    supplierImageReadiness: {
      version: "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1",
      authorityVersion: authority.version,
      imageRights: "PASS_INHERITED",
      imageOptimization: "AUTO_PASS",
      imageReady: true,
      humanImageActionRequired: false,
      officialImageCount: context.officialImageUrls.length,
      validCompliantImageCount: acceptedIds.size,
      excludedImageCount: excluded.length,
      automaticApprovedAt: new Date().toISOString(),
      identity: context.opportunityIdentity,
    },
  }
  const saved = await input.supabase.rpc("ebay_save_listing_package_guarded", {
    p_package_id: packageId,
    p_account_key: input.accountKey,
    p_actor: input.actor,
    p_opportunity_id: context.opportunityId,
    p_candidate_key: packageCandidateKey,
    p_operation: "save",
    p_package_patch: nextPackageData,
    p_status: refreshed.data.status,
    p_readiness: refreshed.data.readiness,
    p_source_observed_at: refreshed.data.source_observed_at,
    p_expected_updated_at: refreshed.data.updated_at,
  })
  const listingPackage = Array.isArray(saved.data)
    ? record(saved.data[0]) : record(saved.data)
  if (saved.error || !uuid(listingPackage.id)) {
    throw new Error(databaseErrorCode(
      saved.error,
      "LUNA_IMAGE_AUTHORITY_PACKAGE_SAVE_FAILED",
    ))
  }
  const savedPackageData = record(listingPackage.package_data)
  return {
    listingPackage,
    imageUrls: Array.isArray(savedPackageData.imageUrls)
      ? savedPackageData.imageUrls : [],
    authority,
    officialImageCount: context.officialImageUrls.length,
    validCompliantImageCount: acceptedIds.size,
    excludedImageCount: excluded.length,
    excluded,
    imageRights: "PASS_INHERITED" as const,
    imageOptimization: "AUTO_PASS" as const,
    imageReady: true as const,
    humanImageActionRequired: false as const,
  }
}
