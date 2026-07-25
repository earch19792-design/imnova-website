import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript tests need the explicit extension.
import { EBAY_IMAGE_SOURCE_BUCKET } from "./ebay-image-storage-cleanup.ts"
import type {
  AuthorizedCatalogSourcePack,
  ResolvedLunaCatalogSourceAsset,
} from "./luna-catalog-original-source-resolver"

type JsonRecord = Record<string, unknown>

function uuid(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function storageObjectAlreadyExists(error: unknown) {
  const row = error && typeof error === "object"
    ? error as JsonRecord
    : {}
  const status = Number(row.statusCode ?? row.status ?? 0)
  const message = typeof row.message === "string" ? row.message : ""
  return status === 409 || /already exists|duplicate|resource exists/i
    .test(message)
}

async function persistContentAddressedObject(input: {
  supabase: SupabaseClient
  path: string
  bytes: Buffer
  contentType: string
  expectedSha256: string
}) {
  if (sha256(input.bytes) !== input.expectedSha256) {
    throw new Error("LUNA_CATALOG_SOURCE_PACK_SOURCE_HASH_INVALID")
  }
  const bucket = input.supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET)
  const upload = await bucket.upload(input.path, input.bytes, {
    contentType: input.contentType,
    upsert: false,
  })
  if (!upload.error) return { created: true }
  if (!storageObjectAlreadyExists(upload.error)) {
    throw new Error("LUNA_CATALOG_SOURCE_PACK_STORAGE_FAILED")
  }

  // Content-addressed retries are legitimate only when the existing object is
  // byte-identical. Never overwrite or trust a path collision blindly.
  const existing = await bucket.download(input.path)
  if (existing.error || !existing.data ||
    existing.data.size !== input.bytes.length) {
    throw new Error("LUNA_CATALOG_SOURCE_PACK_STORAGE_HASH_MISMATCH")
  }
  const existingBytes = Buffer.from(await existing.data.arrayBuffer())
  try {
    if (sha256(existingBytes) !== input.expectedSha256) {
      throw new Error("LUNA_CATALOG_SOURCE_PACK_STORAGE_HASH_MISMATCH")
    }
  } finally {
    existingBytes.fill(0)
  }
  return { created: false }
}

function catalogAssetEvidence(asset: ResolvedLunaCatalogSourceAsset) {
  return {
    sourceImageId: asset.sourceImageId,
    sourceAngle: asset.sourceAngle,
    productId: asset.productId,
    variantId: asset.variantId,
    sourceUrl: asset.sourceUrl,
    nativeWidth: asset.nativeWidth,
    nativeHeight: asset.nativeHeight,
    contentType: asset.contentType,
    sha256: asset.sha256,
    viewClassification: asset.viewClassification,
    qualityTier: asset.qualityTier,
    selectedForSlots: asset.selectedForSlots,
    authorizationStatus: asset.authorizationStatus,
    enhancedDerivative: asset.enhancedDerivative,
    sourceSha256: asset.sourceSha256,
    enhancedSha256: asset.enhancedSha256,
    effectiveWidth: asset.effectiveWidth,
    effectiveHeight: asset.effectiveHeight,
    excludedSourceSha256s: asset.excludedSourceSha256s,
    foregroundIdentityEvidence: asset.foregroundIdentityEvidence,
  }
}

export async function persistAuthorizedCatalogSourcePack(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  listingPackageId: string
  candidateId: string
  marketRadarProductId: string
  supplierVariantId: string
  factPackageHash?: string
  pack: AuthorizedCatalogSourcePack
  sourcePackVersion?: string
  policyVersion?: string
  reconciliationReason?: string
}) {
  const sourceEvidence = input.pack.sourceAssets.map(catalogAssetEvidence)
  const sourcePackHash = sha256(JSON.stringify({
    resolverVersion: input.pack.resolverVersion,
    productId: input.pack.productId,
    productIdentityHash: input.pack.productIdentityHash,
    productUrl: input.pack.productUrl,
    authorizationEvidenceHash: input.pack.authorizationEvidenceHash,
    sourceAssets: sourceEvidence,
    precheck: input.pack.precheck,
  }))
  const sourcePackVersion = input.sourcePackVersion ??
    `${input.pack.resolverVersion}_${sourcePackHash.slice(0, 16)}`
  const { data: existing, error: existingError } = await input.supabase
    .from("luna_catalog_authorized_source_packs")
    .select("id,source_pack_hash")
    .eq("marketplace_account_key", input.accountKey)
    .eq("listing_package_id", input.listingPackageId)
    .eq("source_pack_hash", sourcePackHash)
    .maybeSingle()
  if (existingError) throw new Error("LUNA_CATALOG_SOURCE_PACK_LOOKUP_FAILED")
  const existingPackId = uuid(existing?.id)
  if (existingPackId) return { packId: existingPackId, sourcePackHash }

  const packId = randomUUID()
  const uploadedPaths: string[] = []
  try {
    const persistedAssets: JsonRecord[] = []
    for (const asset of input.pack.sourceAssets) {
      const nativeExtension = asset.contentType === "image/png"
        ? "png" : asset.contentType === "image/webp" ? "webp" : "jpg"
      const storagePath = `${input.actorId}/catalog-source-packs/content-addressed/${asset.sourceSha256}-native.${nativeExtension}`
      const nativeUpload = await persistContentAddressedObject({
        supabase: input.supabase,
        path: storagePath,
        bytes: asset.nativeBuffer,
        contentType: asset.contentType,
        expectedSha256: asset.sourceSha256,
      })
      if (nativeUpload.created) uploadedPaths.push(storagePath)
      let enhancedStoragePath: string | null = null
      if (asset.enhancedDerivative && asset.enhancedSha256) {
        enhancedStoragePath = `${input.actorId}/catalog-source-packs/content-addressed/${asset.enhancedSha256}-enhanced.jpg`
        const enhancedUpload = await persistContentAddressedObject({
          supabase: input.supabase,
          path: enhancedStoragePath,
          bytes: asset.buffer,
          contentType: "image/jpeg",
          expectedSha256: asset.enhancedSha256,
        })
        if (enhancedUpload.created) uploadedPaths.push(enhancedStoragePath)
      }
      persistedAssets.push({
        ...catalogAssetEvidence(asset),
        storagePath,
        enhancedStoragePath,
      })
    }
    const dossierFields = input.factPackageHash
      ? { authoritative_fact_package_hash: input.factPackageHash }
      : {}
    const { error } = await input.supabase
      .from("luna_catalog_authorized_source_packs")
      .insert({
        id: packId,
        marketplace_account_key: input.accountKey,
        created_by: input.actorId,
        listing_package_id: input.listingPackageId,
        candidate_id: input.candidateId,
        product_id: input.marketRadarProductId,
        supplier_product_id: input.pack.productId,
        supplier_variant_id: input.supplierVariantId,
        product_identity_hash: input.pack.productIdentityHash,
        ...dossierFields,
        product_url: input.pack.productUrl,
        source_assets: persistedAssets,
        source_asset_count: persistedAssets.length,
        largest_native_width: input.pack.largestNativeWidth,
        largest_native_height: input.pack.largestNativeHeight,
        gallery_coverage: input.pack.galleryCoverage,
        available_view_types: input.pack.availableViewTypes,
        authorization_evidence_hash: input.pack.authorizationEvidenceHash,
        resolver_version: input.pack.resolverVersion,
        source_pack_hash: sourcePackHash,
        precheck: input.pack.precheck,
        openai_calls: 0,
        ebay_writes: 0,
        production_changed: false,
        source_pack_version: sourcePackVersion,
        policy_version: input.policyVersion ?? "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
        manifest_hash: sourcePackHash,
        reconciliation_reason: input.reconciliationReason ?? null,
        verified_at: new Date().toISOString(),
      })
    if (error) {
      // Another retry may have committed the same immutable manifest after
      // our initial lookup. Re-read by the content hash and accept only that
      // exact row; every other insert failure remains closed.
      const { data: raced, error: racedError } = await input.supabase
        .from("luna_catalog_authorized_source_packs")
        .select("id,source_pack_hash")
        .eq("marketplace_account_key", input.accountKey)
        .eq("listing_package_id", input.listingPackageId)
        .eq("source_pack_hash", sourcePackHash)
        .maybeSingle()
      const racedPackId = uuid(raced?.id)
      if (!racedError && racedPackId) {
        return { packId: racedPackId, sourcePackHash }
      }
      throw new Error("LUNA_CATALOG_SOURCE_PACK_SAVE_FAILED")
    }
    return { packId, sourcePackHash }
  } catch (error) {
    if (uploadedPaths.length) {
      await input.supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET)
        .remove(uploadedPaths).catch(() => undefined)
    }
    throw error
  }
}
