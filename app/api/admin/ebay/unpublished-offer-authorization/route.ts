export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { createHash, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import sharp from "sharp"

import {
  ebayDraftOnlyRuntimeStatus,
  preflightEbayDraftDependencies,
  preflightEbayDraftOnlyMobile,
} from "@/lib/ebay/ebay-draft-only-gateway"
import {
  approvalExpiresAt,
  buildEbayDraftOnlyPayload,
  expectedEbayDraftOnlySku,
  hashEbayDraftOnlyPayload,
  type JsonRecord,
} from "@/lib/ebay/ebay-draft-only-readiness"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import {
  packageWithV3PublicationAssets,
  resolveV3UnpublishedAuthorizationPreflight,
  V3_PUBLICATION_BUCKET,
  V3_PUBLICATION_SOURCE_BUCKET,
  buildV3UnpublishedAuthorizationIdempotencyKey,
  V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION,
  V3_UNPUBLISHED_CONFIRMATION,
  v3AuthorizationHash,
  validateV3PublicationAssets,
  withV3FinalSetAuthorization,
  type V3PublicationAsset,
} from "@/lib/ebay/ebay-v3-unpublished-offer-authorization"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const EXPECTED_REVISION = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const EXPECTED_ATTEMPT = "f166b395-8d3a-4921-b273-1a62a6032707"
const EXPECTED_PREVIEW = "d6827d6697310771eeedb8ff40d223bfb3c413444eb92fcf6774bc5d993a2bd0"
const EXPECTED_TITLE =
  "Calypso Basics by Reston Lloyd 1.5 Qt Powder Coated Enamel Colander White"
const EXPECTED_ROLES = [
  "PRIMARY_MAIN",
  "SECONDARY_MATERIAL_DETAIL",
  "SECONDARY_PACKAGE_CONTENTS",
  "SECONDARY_SCALE_CAPACITY",
  "SECONDARY_USE_CONTEXT",
  "SECONDARY_ASPIRATIONAL_LIFESTYLE",
  "SECONDARY_HUMAN_CONTEXT",
]

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function jsonType(value: unknown) {
  return Array.isArray(value) ? "array" : (value && typeof value === "object" ? "object" : typeof value)
}

function diffJsonPaths(oldValue: unknown, newValue: unknown, prefix = ""): string[] {
  const oldType = jsonType(oldValue)
  const newType = jsonType(newValue)
  if (oldType !== newType) return prefix ? [prefix] : []
  if (oldType !== "object" && oldType !== "array") {
    return Object.is(oldValue, newValue) ? [] : (prefix ? [prefix] : [])
  }
  if (oldType === "array") {
    const oldItems = Array.isArray(oldValue) ? oldValue : []
    const newItems = Array.isArray(newValue) ? newValue : []
    const length = Math.max(oldItems.length, newItems.length)
    const paths: string[] = []
    for (let index = 0; index < length; index += 1) {
      const childPrefix = `${prefix}[${index}]`
      paths.push(...diffJsonPaths(oldItems[index], newItems[index], childPrefix))
    }
    return paths
  }
  const oldObject = record(oldValue)
  const newObject = record(newValue)
  const keys = [...new Set([...Object.keys(oldObject), ...Object.keys(newObject)])].sort()
  const paths: string[] = []
  for (const key of keys) {
    const childPrefix = prefix ? `${prefix}.${key}` : key
    paths.push(...diffJsonPaths(oldObject[key], newObject[key], childPrefix))
  }
  return paths
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:-]+$/.test(value)
    ? value
    : "EBAY_V3_UNPUBLISHED_AUTHORIZATION_FAILED"
}

function responseError(error: unknown, status = 409) {
  return NextResponse.json({
    success: false,
    error: safeCode(error),
    safety: {
      inventoryItemCreated: false,
      offerCreated: false,
      publishOfferCalled: false,
      ebayWrites: 0,
      productionChanged: false,
    },
  }, { status })
}

async function authenticate(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return {
      actor: "",
      serviceRole: false,
      response: responseError(
        new Error(validation.error ?? "ADMIN_FORBIDDEN"),
        validation.status || 403,
      ),
    }
  }
  return {
    actor: validation.userId ?? "",
    serviceRole: validation.authenticationMode === "service_role",
    response: null,
  }
}

function imageSourcePath(asset: JsonRecord) {
  const storagePath = text(asset.storagePath)
  const sha = text(asset.sha256)
  if (!storagePath.endsWith(`/${sha}.png`)) {
    throw new Error("EBAY_V3_SELECTED_IMAGE_PATH_INVALID")
  }
  return storagePath
}

async function inspectPng(bytes: ArrayBuffer, expectedSha: string) {
  const buffer = Buffer.from(bytes)
  const sha256 = createHash("sha256").update(buffer).digest("hex")
  const metadata = await sharp(buffer, { failOn: "error" }).metadata()
  if (
    sha256 !== expectedSha
    || metadata.format !== "png"
    || metadata.width !== 1600
    || metadata.height !== 1600
  ) throw new Error("EBAY_V3_PUBLICATION_IMAGE_ROUNDTRIP_INVALID")
  return { buffer, sha256, bytes: buffer.byteLength }
}

async function loadFinalReview(
  actor: string,
  attemptId = EXPECTED_ATTEMPT,
  previewHash = EXPECTED_PREVIEW,
) {
  const supabase = getSupabaseAdminClient()
  let reviewQuery = supabase
    .from("ebay_reference_guided_final_listing_review_previews")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("preview_hash", previewHash)
  if (actor) reviewQuery = reviewQuery.eq("created_by", actor)
  const { data: review, error } = await reviewQuery.maybeSingle()
  if (error || !review) throw new Error("EBAY_V3_FINAL_PREVIEW_NOT_FOUND")
  const snapshot = record(review.preview_snapshot)
  const gates = record(review.gates)
  const selected = Array.isArray(snapshot.selectedImages)
    ? snapshot.selectedImages.map(record).sort((left, right) =>
        Number(left.position) - Number(right.position))
    : []
  const selectedValid = selected.length === 7
    && selected.every((asset, index) =>
      Number(asset.position) === index
      && text(asset.assetRole) === EXPECTED_ROLES[index]
      && asset.status === "PASSED"
      && /^[0-9a-f]{64}$/.test(text(asset.sha256))
    )
  if (
    review.revision_id !== EXPECTED_REVISION
    || review.attempt_id !== EXPECTED_ATTEMPT
    || review.preview_hash !== EXPECTED_PREVIEW
    || review.final_visual_set_locked !== true
    || review.ready_for_unpublished_offer_authorization !== true
    || review.provider_calls_snapshot !== 8
    || Array.isArray(review.blockers) && review.blockers.length > 0
    || Object.values(gates).some((value) => value !== true)
    || !selectedValid
  ) throw new Error("EBAY_V3_FINAL_PREVIEW_GATE_INVALID")
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", review.listing_package_id)
    .eq("created_by", review.created_by)
    .maybeSingle()
  if (packageError || !listingPackage) throw new Error("EBAY_V3_LISTING_PACKAGE_NOT_FOUND")
  const finalListing = record(snapshot.listing)
  const currentPackage = record(listingPackage.package_data)
  const currentDraft = record(currentPackage.draftConfiguration)
  const currentPolicies = record(currentDraft.businessPolicies)
  const finalPolicies = record(finalListing.businessPolicies)
  if (
    text(currentPackage.title) !== text(finalListing.title)
    || text(currentPackage.categoryId) !== text(finalListing.categoryId)
    || v3AuthorizationHash(currentPackage.aspects)
      !== v3AuthorizationHash(finalListing.itemSpecifics)
    || Number(record(currentPackage.pricing).targetPrice)
      !== Number(record(finalListing.pricing).targetPrice)
    || Number(currentDraft.quantity) !== Number(finalListing.quantity)
    || text(currentDraft.condition).toUpperCase() !== "NEW"
    || text(currentDraft.merchantLocationKey)
      !== text(finalListing.merchantLocationKey)
    || text(currentPolicies.fulfillmentPolicyId)
      !== text(finalPolicies.fulfillmentPolicyId)
    || text(currentPolicies.paymentPolicyId)
      !== text(finalPolicies.paymentPolicyId)
    || text(currentPolicies.returnPolicyId)
      !== text(finalPolicies.returnPolicyId)
  ) throw new Error("EBAY_V3_FINAL_PREVIEW_PACKAGE_CHANGED")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", listingPackage.opportunity_id)
    .maybeSingle()
  if (opportunityError || !opportunity) throw new Error("EBAY_V3_OPPORTUNITY_NOT_FOUND")
  return { supabase, review, snapshot, selected, listingPackage, opportunity }
}

async function ensurePublicationTransport(
  context: Awaited<ReturnType<typeof loadFinalReview>>,
) {
  const { supabase, review, selected } = context
  const { data: existing, error: existingError } = await supabase
    .from("ebay_v3_publication_image_transports")
    .select("*")
    .eq("attempt_id", review.attempt_id)
    .eq("preview_hash", review.preview_hash)
    .maybeSingle()
  if (existingError) throw new Error("EBAY_V3_PUBLICATION_TRANSPORT_READ_FAILED")
  if (existing) {
    validateV3PublicationAssets(existing.assets)
    return existing
  }

  const createdPaths: string[] = []
  try {
    const assets: V3PublicationAsset[] = []
    for (const source of selected) {
      const position = Number(source.position)
      const assetRole = text(source.assetRole)
      const sha256 = text(source.sha256)
      const sourceStoragePath = imageSourcePath(source)
      const publicationStoragePath =
        `${context.review.created_by}/publication/v3/${review.attempt_id}/${position}-${assetRole.toLowerCase()}/${sha256}.png`
      const { data: sourceBlob, error: sourceError } = await supabase.storage
        .from(V3_PUBLICATION_SOURCE_BUCKET)
        .download(sourceStoragePath)
      if (sourceError || !sourceBlob) {
        throw new Error("EBAY_V3_PUBLICATION_SOURCE_DOWNLOAD_FAILED")
      }
      const sourceInspection = await inspectPng(await sourceBlob.arrayBuffer(), sha256)
      const { error: uploadError } = await supabase.storage
        .from(V3_PUBLICATION_BUCKET)
        .upload(publicationStoragePath, sourceInspection.buffer, {
          contentType: "image/png",
          upsert: false,
        })
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        throw new Error("EBAY_V3_PUBLICATION_COPY_FAILED")
      }
      if (!uploadError) createdPaths.push(publicationStoragePath)
      const { data: roundtripBlob, error: roundtripError } = await supabase.storage
        .from(V3_PUBLICATION_BUCKET)
        .download(publicationStoragePath)
      if (roundtripError || !roundtripBlob) {
        throw new Error("EBAY_V3_PUBLICATION_ROUNDTRIP_FAILED")
      }
      const roundtrip = await inspectPng(await roundtripBlob.arrayBuffer(), sha256)
      const publicUrl = supabase.storage
        .from(V3_PUBLICATION_BUCKET)
        .getPublicUrl(publicationStoragePath).data.publicUrl
      if (!/^https:\/\//.test(publicUrl) || publicUrl.includes("?")) {
        throw new Error("EBAY_V3_PUBLICATION_URL_NOT_STABLE")
      }
      assets.push({
        position,
        assetRole,
        sha256,
        sourceStoragePath,
        publicationStoragePath,
        url: publicUrl,
        mime: "image/png",
        width: 1600,
        height: 1600,
        bytes: roundtrip.bytes,
      })
    }
    validateV3PublicationAssets(assets)
    const transportHash = v3AuthorizationHash({
      version: "EBAY_V3_PUBLICATION_IMAGE_TRANSPORT_V1",
      previewHash: review.preview_hash,
      assets,
    })
    const { data: inserted, error: insertError } = await supabase
      .from("ebay_v3_publication_image_transports")
      .insert({
        revision_id: review.revision_id,
        attempt_id: review.attempt_id,
        listing_package_id: review.listing_package_id,
        final_preview_id: review.id,
        preview_hash: review.preview_hash,
        source_bucket: V3_PUBLICATION_SOURCE_BUCKET,
        publication_bucket: V3_PUBLICATION_BUCKET,
        assets,
        transport_hash: transportHash,
        image_count: 7,
        scope: "EBAY_US_UNPUBLISHED_OFFER_ONLY",
        status: "READY",
        created_by: review.created_by,
      })
      .select("*")
      .single()
    if (insertError || !inserted) {
      throw new Error("EBAY_V3_PUBLICATION_TRANSPORT_PERSIST_FAILED")
    }
    return inserted
  } catch (error) {
    if (createdPaths.length) {
      await supabase.storage.from(V3_PUBLICATION_BUCKET).remove(createdPaths)
    }
    throw error
  }
}

function aspectValidation(
  taxonomy: Awaited<ReturnType<typeof getEbayTaxonomyListingIntelligence>>,
) {
  return {
    validated: taxonomy.status === "AVAILABLE",
    validatedAt: taxonomy.observedAt,
    categoryId: taxonomy.categoryId,
    categoryTreeId: taxonomy.categoryTreeId,
    categoryTreeVersion: taxonomy.categoryTreeVersion,
    requiredAspects: taxonomy.requiredAspects.map((aspect) => aspect.name),
    aspectConstraints: taxonomy.aspects,
    constraintSnapshotStatus: taxonomy.status === "AVAILABLE"
      ? "AVAILABLE"
      : "UNAVAILABLE",
    source: taxonomy.source,
  }
}

async function prepare(actor: string) {
  const context = await loadFinalReview(actor)
  const { review, snapshot, listingPackage, opportunity, supabase } = context
  const resolvedActor = text(review.created_by)
  if (!resolvedActor) throw new Error("EBAY_V3_PREVIEW_ACTOR_INVALID")
  const currentPreview = await latest(resolvedActor, EXPECTED_ATTEMPT)
  const { data: activeApproval, error: activeApprovalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("id,status,expires_at,approved_at,consumed_at,revoked_at,payload_hash,approved_payload,approval_idempotency_key")
    .eq("listing_package_id", review.listing_package_id)
    .eq("actor_user_id", resolvedActor)
    .eq("status", "approved")
    .maybeSingle()
  if (activeApprovalError) {
    throw new Error("EBAY_V3_APPROVAL_STATE_READ_FAILED")
  }
  const activeApprovalFresh = Boolean(
    activeApproval
    && Number.isFinite(Date.parse(text(activeApproval.expires_at)))
    && Date.parse(text(activeApproval.expires_at)) > Date.now()
    && !activeApproval.consumed_at
    && !activeApproval.revoked_at,
  )
  const currentPreviewFresh = Boolean(
    currentPreview
    && Number.isFinite(
      Date.parse(text(currentPreview.preflight_snapshot_expires_at)),
    )
    && Date.parse(text(currentPreview.preflight_snapshot_expires_at))
      > Date.now(),
  )
  if (
    currentPreview
    && activeApproval
    && activeApprovalFresh
    && currentPreviewFresh
    && text(currentPreview.preview_hash) === text(review.preview_hash)
    && text(activeApproval.payload_hash) === text(currentPreview.payload_hash)
  ) {
    return {
      authorization: currentPreview,
      authorizationMode: "resume_existing_authorization" as const,
      approval: {
        id: activeApproval.id,
        status: activeApproval.status,
        expires_at: activeApproval.expires_at,
        approved_at: activeApproval.approved_at,
        consumed_at: activeApproval.consumed_at,
        revoked_at: activeApproval.revoked_at,
        payload_hash: activeApproval.payload_hash,
        approval_idempotency_key: activeApproval.approval_idempotency_key,
      },
      reconciliation: null,
    }
  }
  const transport = await ensurePublicationTransport(context)
  const assets = validateV3PublicationAssets(transport.assets)
  const persistedPackageData = record(listingPackage.package_data)
  const persistedUrls = Array.isArray(persistedPackageData.imageUrls)
    ? persistedPackageData.imageUrls.map(text)
    : []
  if (
    persistedUrls.length !== 7
    || persistedUrls.some((url, index) => url !== assets[index].url)
  ) throw new Error("EBAY_V3_FINAL_PREVIEW_IMAGE_TRANSPORT_CHANGED")
  const listing = record(snapshot.listing)
  const policies = record(listing.businessPolicies)
  const packageData = record(listingPackage.package_data)
  const runtime = ebayDraftOnlyRuntimeStatus()
  if (
    runtime.target !== "PRODUCTION"
    || !runtime.configured
    || !runtime.identityBound
    || text(listing.title) !== EXPECTED_TITLE
    || text(listing.categoryId) !== "20636"
    || text(record(listing.productIdentifiers).gtin) !== "036588083005"
    || Number(listing.quantity) !== 1
    || Number(record(listing.pricing).targetPrice) !== 21.39
    || text(listing.condition) !== "New"
    || text(listing.merchantLocationKey) !== "luna-boca-raton-fl"
  ) throw new Error("EBAY_V3_UNPUBLISHED_PAYLOAD_IDENTITY_INVALID")

  const preflight = await preflightEbayDraftOnlyMobile({
    fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
    paymentPolicyId: text(policies.paymentPolicyId),
    returnPolicyId: text(policies.returnPolicyId),
    merchantLocationKey: text(listing.merchantLocationKey),
  })
  if (
    preflight.identity.status !== "BOUND"
    || preflight.target !== "PRODUCTION"
    || !preflight.snapshot
    || preflight.snapshotStatus !== "READY"
    || !preflight.selectionComplete
  ) throw new Error("EBAY_V3_TARGET_ACCOUNT_PREFLIGHT_BLOCKED")
  const accountIdentity = {
    environment: "PRODUCTION",
    marketplaceId: "EBAY_US",
    registrationMarketplaceId:
      preflight.identity.registrationMarketplaceId || "EBAY_US",
    accountType: preflight.identity.accountType || "SELLER",
    maskedSellerAccountId: preflight.identity.maskedSellerAccountId,
    status: preflight.identity.status,
  }
  if (
    !accountIdentity.maskedSellerAccountId
    || accountIdentity.registrationMarketplaceId !== "EBAY_US"
  ) throw new Error("EBAY_V3_TARGET_ACCOUNT_HUMAN_IDENTITY_UNAVAILABLE")
  const taxonomy = await getEbayTaxonomyListingIntelligence(
    EXPECTED_TITLE,
    "20636",
    { allowTitleSuggestionFallback: false },
  )
  if (taxonomy.status !== "AVAILABLE") {
    throw new Error("EBAY_V3_TAXONOMY_PREFLIGHT_BLOCKED")
  }
  const publicationPackage = packageWithV3PublicationAssets(
    listingPackage as JsonRecord,
    assets,
  )
  const publicationPackageData = record(publicationPackage.package_data)
  publicationPackage.package_data = {
    ...publicationPackageData,
    title: EXPECTED_TITLE,
    description: listing.description,
    categoryId: "20636",
    conditionId: "1000",
    aspects: listing.itemSpecifics,
    pricing: listing.pricing,
  }
  const draftConfiguration = {
    sku: expectedEbayDraftOnlySku(listingPackage as JsonRecord),
    quantity: 1,
    condition: "NEW",
    merchantLocationKey: "luna-boca-raton-fl",
    businessPolicies: {
      fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
      paymentPolicyId: text(policies.paymentPolicyId),
      returnPolicyId: text(policies.returnPolicyId),
    },
    packageWeightAndSize: {},
    imageAuthorization: {
      approved: true,
      approvedAt: review.created_at,
      approvedBy: resolvedActor,
      approvedImageUrls: assets.map((asset) => asset.url),
      protectedManifestVerified: true,
      protectedManifestAssetCount: 7,
      rightsBasis: "supplier_authorized",
      source: "luna",
    },
    aspectValidation: aspectValidation(taxonomy),
    skuCollisionCheck: {
      sku: expectedEbayDraftOnlySku(listingPackage as JsonRecord),
      serverPreflightRequiredAtExecution: true,
    },
    ebayPreflightSnapshot: preflight.snapshot,
  }
  const sameDayAuthorization = record(record(packageData.evidenceSnapshot)
    .sameDayPilotAuthorization)
  const authorizationPreviewId = randomUUID()
  const authoritySnapshot = {
    version: "CALYPSO_UNPUBLISHED_SCREEN_AUTHORITY_V1",
    sourceFinalPreviewHash: review.preview_hash,
    title: EXPECTED_TITLE,
    categoryId: "20636",
    condition: "NEW",
    gtin: "036588083005",
    itemSpecifics: listing.itemSpecifics,
    price: { value: "21.39", currency: "USD" },
    quantity: 1,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    businessPolicies: draftConfiguration.businessPolicies,
    merchantLocationKey: "luna-boca-raton-fl",
    accountIdentity,
    images: assets.map((asset) => ({
      position: asset.position,
      assetRole: asset.assetRole,
      sha256: asset.sha256,
      url: asset.url,
    })),
  }
  const exactPreviewHash = v3AuthorizationHash(authoritySnapshot)
  const binding = {
    version: "EBAY_V3_FINAL_SET_UNPUBLISHED_AUTHORIZATION_V1",
    authorizationPreviewId,
    revisionId: review.revision_id,
    attemptId: review.attempt_id,
    finalPreviewId: review.id,
    finalPreviewHash: review.preview_hash,
    exactPreviewHash,
    imageTransportId: transport.id,
    imageTransportHash: transport.transport_hash,
    accountIdentity,
    selectedAssets: assets,
  }
  const exactPayload = withV3FinalSetAuthorization(
    buildEbayDraftOnlyPayload(
      publicationPackage,
      opportunity as JsonRecord,
      draftConfiguration,
      runtime.target,
      preflight.identity.accountFingerprint,
      {},
      sameDayAuthorization,
    ),
    binding,
  )
  const payloadHash = hashEbayDraftOnlyPayload(exactPayload)
  const gates = {
    targetEbayAccountBound: true,
    previewHashVerified: true,
    allSevenPassed: true,
    permanentImageTransportReady: true,
    allSevenImageUrlsStable: true,
    imageUrlsBoundToSelectedHashes: true,
    primaryMainFirst: true,
    titleFinal: true,
    priceFinal: true,
    categoryAndSpecificsValid: true,
    policiesAndLocationValid: true,
    unpublishedOnly: true,
    publishOfferProhibited: true,
  }
  const row = {
    id: authorizationPreviewId,
    revision_id: review.revision_id,
    attempt_id: review.attempt_id,
    listing_package_id: review.listing_package_id,
    final_preview_id: review.id,
    preview_hash: review.preview_hash,
    exact_preview_hash: exactPreviewHash,
    image_transport_id: transport.id,
    image_transport_hash: transport.transport_hash,
    target: runtime.target,
    account_fingerprint: preflight.identity.accountFingerprint,
    account_identity: accountIdentity,
    authority_snapshot: authoritySnapshot,
    sku: exactPayload.sku,
    listing_quantity: 1,
    exact_payload: exactPayload,
    payload_hash: payloadHash,
    preflight_snapshot_expires_at: preflight.snapshotExpiresAt,
    confirmation_phrase: V3_UNPUBLISHED_CONFIRMATION,
    gates,
    blockers: [],
    status: "READY_FOR_HUMAN_AUTHORIZATION",
    provider_calls_snapshot: 8,
    created_by: resolvedActor,
  }
  const { data: persisted, error } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_previews")
    .insert(row)
    .select("*")
    .single()
  if (error && error.code !== "23505") {
    throw new Error("EBAY_V3_UNPUBLISHED_AUTHORIZATION_PERSIST_FAILED")
  }
  const prepared = persisted ?? await (async () => {
    const { data: existing } = await supabase
      .from("ebay_v3_unpublished_offer_authorization_previews")
      .select("*")
      .eq("preview_hash", review.preview_hash)
      .eq("payload_hash", payloadHash)
      .maybeSingle()
    return existing ?? null
  })()
  if (!prepared) {
    throw new Error("EBAY_V3_UNPUBLISHED_AUTHORIZATION_READ_FAILED")
  }
  const { data: priorRows, error: priorError } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_previews")
    .select("id,exact_preview_hash,payload_hash")
    .eq("attempt_id", review.attempt_id)
    .eq("created_by", resolvedActor)
    .neq("id", prepared.id)
  if (priorError) {
    throw new Error("EBAY_V3_PRIOR_AUTHORIZATION_READ_FAILED")
  }
  if (priorRows?.length) {
    const invalidations = priorRows.map((prior) => ({
      authorization_preview_id: prior.id,
      attempt_id: review.attempt_id,
      old_exact_preview_hash: prior.exact_preview_hash,
      old_payload_hash: prior.payload_hash,
      successor_authorization_preview_id: prepared.id,
      successor_exact_preview_hash: exactPreviewHash,
      successor_payload_hash: payloadHash,
      reason: "SCREEN_AND_PAYLOAD_AUTHORITY_RECONCILIATION",
      created_by: resolvedActor,
    }))
    const { error: invalidationError } = await supabase
      .from("ebay_v3_unpublished_offer_authorization_invalidations")
      .upsert(invalidations, {
        onConflict: "authorization_preview_id",
        ignoreDuplicates: true,
      })
    if (invalidationError) {
      throw new Error("EBAY_V3_PRIOR_AUTHORIZATION_INVALIDATION_FAILED")
    }
  }
  let authorizationMode: "new_authorization" | "resume_existing_authorization" =
    "new_authorization"
  let reconciliation: JsonRecord | null = null
  let reusableApproval: JsonRecord | null = null
  if (activeApproval) {
    if (activeApproval.payload_hash === payloadHash && activeApprovalFresh) {
      authorizationMode = "resume_existing_authorization"
      reusableApproval = {
        id: activeApproval.id,
        status: activeApproval.status,
        expires_at: activeApproval.expires_at,
        approved_at: activeApproval.approved_at,
        consumed_at: activeApproval.consumed_at,
        revoked_at: activeApproval.revoked_at,
        payload_hash: activeApproval.payload_hash,
        approval_idempotency_key: activeApproval.approval_idempotency_key,
      }
    } else {
      const changedFields = diffJsonPaths(activeApproval.approved_payload, exactPayload)
      const { error: reconcileError } = await supabase
        .rpc("reconcile_ebay_draft_only_approval_conflict", {
          p_listing_package_id: review.listing_package_id,
          p_actor_user_id: resolvedActor,
          p_current_preview_hash: exactPreviewHash,
          p_current_payload_hash: payloadHash,
          p_target_account_fingerprint: preflight.identity.accountFingerprint,
          p_action_version: V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION,
        })
      if (reconcileError) {
        throw new Error("EBAY_V3_RECONCILIATION_FAILED")
      }
      reconciliation = {
        approvalId: activeApproval.id,
        oldPayloadHash: activeApproval.payload_hash,
        newPayloadHash: payloadHash,
        reason: "PAYLOAD_CHANGED_AFTER_LUNA_RECONFIRMATION",
      changedFields,
      }
    }
  }
  const response: JsonRecord = {
    authorization: prepared,
    authorizationMode,
    approval: reusableApproval,
    reconciliation,
  }
  return response
}

function publicPreview(row: JsonRecord) {
  const payload = record(row.exact_payload)
  const inventory = record(payload.inventoryItemPayload)
  const product = record(inventory.product)
  const offer = record(payload.offerPayload)
  const authority = record(row.authority_snapshot)
  const targetAccount = {
    status: "BOUND",
    ...record(row.account_identity),
  }
  const images = validateV3PublicationAssets(
    record(record(payload.compliance).v3FinalSetAuthorization).selectedAssets
      ? record(record(payload.compliance).v3FinalSetAuthorization).selectedAssets
      : [],
  )
  const aspectValue = (name: string) => {
    const value = record(product.aspects)[name]
    return Array.isArray(value) ? text(value[0]) : text(value)
  }
  const policies = record(offer.listingPolicies)
  const authorityPolicies = record(authority.businessPolicies)
  const checks = {
    account: v3AuthorizationHash(targetAccount)
      === v3AuthorizationHash(authority.accountIdentity),
    title: text(product.title) === text(authority.title),
    size: aspectValue("Size") === text(record(authority.itemSpecifics).Size),
    price: v3AuthorizationHash(record(record(offer.pricingSummary).price))
      === v3AuthorizationHash(authority.price),
    quantity: Number(offer.availableQuantity) === Number(authority.quantity)
      && Number(row.listing_quantity) === Number(authority.quantity),
    policies: v3AuthorizationHash(policies)
      === v3AuthorizationHash(authorityPolicies),
    images: v3AuthorizationHash(images.map((asset) => ({
      position: asset.position,
      assetRole: asset.assetRole,
      sha256: asset.sha256,
      url: asset.url,
    }))) === v3AuthorizationHash(authority.images),
  }
  return {
    id: row.id,
    status: row.status,
    target: row.target,
    targetAccount,
    previewHash: row.exact_preview_hash,
    sourceFinalPreviewHash: row.preview_hash,
    payloadHash: row.payload_hash,
    sku: row.sku,
    listingQuantity: row.listing_quantity,
    title: product.title,
    price: record(record(offer.pricingSummary).price),
    categoryId: offer.categoryId,
    marketplaceId: offer.marketplaceId,
    format: offer.format,
    policies,
    merchantLocationKey: offer.merchantLocationKey,
    itemSpecifics: product.aspects,
    description: product.description,
    images,
    exactPayload: payload,
    authoritySnapshot: authority,
    screenConsistency: {
      ...checks,
      all: Object.values(checks).every(Boolean),
    },
    gates: row.gates,
    confirmationPhrase: row.confirmation_phrase,
    expiresAt: row.preflight_snapshot_expires_at,
    safety: {
      inventoryItemCreated: false,
      offerCreated: false,
      publishOfferCalled: false,
      ebayWrites: 0,
      productionChanged: false,
      providerCalls: 8,
    },
  }
}

async function latest(actor: string, attemptId: string) {
  const supabase = getSupabaseAdminClient()
  const { data, error } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_previews")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("created_by", actor)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("EBAY_V3_UNPUBLISHED_AUTHORIZATION_READ_FAILED")
  return data
}

async function readOnlyPreflight(actor: string, attemptId: string) {
  const context = await loadFinalReview(actor, attemptId, EXPECTED_PREVIEW)
  const { review, supabase } = context
  const authorization = await latest(actor, attemptId)
  const { data: approvalRows, error: approvalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("id,listing_package_id,status,target,account_fingerprint,payload_hash,approved_payload,approved_at,expires_at,consumed_at,revoked_at,approval_idempotency_key,created_at")
    .eq("listing_package_id", review.listing_package_id)
    .eq("actor_user_id", actor)
    .order("created_at", { ascending: false })
    .limit(10)
  if (approvalError) {
    throw new Error("EBAY_V3_APPROVAL_STATE_READ_FAILED")
  }
  const approval = approvalRows?.find((row) => row.status === "approved")
    ?? approvalRows?.[0]
    ?? null
  const { data: invalidation, error: invalidationError } = authorization
    ? await supabase
      .from("ebay_v3_unpublished_offer_authorization_invalidations")
      .select("authorization_preview_id")
      .eq("authorization_preview_id", authorization.id)
      .limit(1)
      .maybeSingle()
    : { data: null, error: null }
  if (invalidationError) {
    throw new Error("EBAY_V3_AUTHORIZATION_INVALIDATION_READ_FAILED")
  }
  const runtime = ebayDraftOnlyRuntimeStatus()
  let authorizationView: ReturnType<typeof publicPreview> | null = null
  let exactPayloadHashValid = false
  let authoritySnapshotHashValid = false
  if (authorization) {
    authorizationView = publicPreview(authorization as JsonRecord)
    exactPayloadHashValid =
      hashEbayDraftOnlyPayload(record(authorization.exact_payload))
        === text(authorization.payload_hash)
    authoritySnapshotHashValid =
      v3AuthorizationHash(record(authorization.authority_snapshot))
        === text(authorization.exact_preview_hash)
  }
  const approvedPayloadHashValid = !approval || (
    hashEbayDraftOnlyPayload(record(approval.approved_payload))
      === text(approval.payload_hash)
  )
  const runtimeReady = runtime.enabled
    && runtime.configured
    && runtime.environmentAllowed
    && runtime.identityBound
    && runtime.identityConfigurationConsistent
    && runtime.target === "PRODUCTION"
  const preflight = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview: authorization ? {
      listingPackageId: text(authorization.listing_package_id),
      revisionId: text(authorization.revision_id),
      finalPreviewId: text(authorization.final_preview_id),
      status: text(authorization.status),
      invalidated: Boolean(invalidation),
      sourcePreviewHash: text(authorization.preview_hash),
      exactPreviewHash: text(authorization.exact_preview_hash),
      payloadHash: text(authorization.payload_hash),
      target: text(authorization.target),
      accountFingerprint: text(authorization.account_fingerprint),
      preflightExpiresAt:
        text(authorization.preflight_snapshot_expires_at) || null,
      exactPayloadHashValid,
      authoritySnapshotHashValid,
      screenConsistencyValid:
        authorizationView?.screenConsistency.all === true,
    } : null,
    approval: approval ? {
      id: text(approval.id),
      listingPackageId: text(approval.listing_package_id),
      status: text(approval.status),
      payloadHash: text(approval.payload_hash),
      target: text(approval.target),
      accountFingerprint: text(approval.account_fingerprint),
      expiresAt: text(approval.expires_at) || null,
      consumedAt: text(approval.consumed_at) || null,
      revokedAt: text(approval.revoked_at) || null,
      approvedPayloadHashValid,
    } : null,
    expectedListingPackageId: text(review.listing_package_id),
    expectedRevisionId: text(review.revision_id),
    expectedFinalPreviewId: text(review.id),
    expectedSourcePreviewHash: text(review.preview_hash),
    runtimeTarget: runtime.target,
    runtimeAccountFingerprint: runtime.accountFingerprint || "",
    runtimeReady,
  })
  return {
    authorization,
    approval: approval ? {
      id: approval.id,
      status: approval.status,
      target: approval.target,
      payload_hash: approval.payload_hash,
      approved_at: approval.approved_at,
      expires_at: approval.expires_at,
      consumed_at: approval.consumed_at,
      revoked_at: approval.revoked_at,
      approval_idempotency_key: approval.approval_idempotency_key,
    } : null,
    preflight,
    runtime: {
      ready: runtimeReady,
      target: runtime.target,
      enabled: runtime.enabled,
      configured: runtime.configured,
      environmentAllowed: runtime.environmentAllowed,
      identityBound: runtime.identityBound,
      identityConfigurationConsistent:
        runtime.identityConfigurationConsistent,
    },
  }
}

async function authorizeAndPrepareExecution(actor: string, body: JsonRecord) {
  const authorizationId = text(body.authorizationPreviewId)
  const exactPreviewHash = text(body.previewHash)
  const payloadHash = text(body.payloadHash)
  if (
    text(body.confirmation) !== V3_UNPUBLISHED_CONFIRMATION
    || body.confirmWritesButNoPublication !== true
    || body.confirmExactPayload !== true
    || body.confirmNoAutomaticRetry !== true
  ) throw new Error("EBAY_V3_EXPLICIT_HUMAN_CONFIRMATION_REQUIRED")
  const supabase = getSupabaseAdminClient()
  const { data: prepared, error } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_previews")
    .select("*")
    .eq("id", authorizationId)
    .eq("created_by", actor)
    .eq("exact_preview_hash", exactPreviewHash)
    .eq("payload_hash", payloadHash)
    .eq("status", "READY_FOR_HUMAN_AUTHORIZATION")
    .maybeSingle()
  if (error || !prepared) throw new Error("EBAY_V3_AUTHORIZATION_PREVIEW_NOT_CURRENT")
  const { data: latestPrepared, error: latestError } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_previews")
    .select("id")
    .eq("attempt_id", prepared.attempt_id)
    .eq("created_by", actor)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: invalidation, error: invalidationError } = await supabase
    .from("ebay_v3_unpublished_offer_authorization_invalidations")
    .select("id")
    .eq("authorization_preview_id", prepared.id)
    .maybeSingle()
  if (
    latestError
    || invalidationError
    || !latestPrepared
    || latestPrepared.id !== prepared.id
    || invalidation
  ) throw new Error("EBAY_V3_AUTHORIZATION_SUPERSEDED")
  if (Date.parse(prepared.preflight_snapshot_expires_at) <= Date.now()) {
    throw new Error("EBAY_V3_AUTHORIZATION_PREFLIGHT_EXPIRED")
  }
  const reconciledPreview = publicPreview(prepared as JsonRecord)
  if (
    reconciledPreview.screenConsistency.all !== true
    || v3AuthorizationHash(prepared.authority_snapshot)
      !== prepared.exact_preview_hash
  ) throw new Error("EBAY_V3_SCREEN_PAYLOAD_MISMATCH")
  await loadFinalReview(actor, EXPECTED_ATTEMPT, text(prepared.preview_hash))
  const payload = record(prepared.exact_payload)
  if (hashEbayDraftOnlyPayload(payload) !== payloadHash) {
    throw new Error("EBAY_V3_AUTHORIZATION_PAYLOAD_HASH_MISMATCH")
  }
  const dependencies = await preflightEbayDraftDependencies({
    merchantLocationKey: text(record(payload.offerPayload).merchantLocationKey),
    fulfillmentPolicyId: text(record(record(payload.offerPayload).listingPolicies)
      .fulfillmentPolicyId),
    paymentPolicyId: text(record(record(payload.offerPayload).listingPolicies)
      .paymentPolicyId),
    returnPolicyId: text(record(record(payload.offerPayload).listingPolicies)
      .returnPolicyId),
    preflightSnapshot: text(record(payload.compliance).ebayPreflightSnapshot),
  })
  if (!dependencies.safe) {
    throw new Error(dependencies.blocker ?? "EBAY_V3_DEPENDENCY_PREFLIGHT_FAILED")
  }
  const { data: activeApproval, error: activeApprovalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("id,payload_hash,status,approval_idempotency_key,expires_at,approved_at,consumed_at,revoked_at")
    .eq("listing_package_id", prepared.listing_package_id)
    .eq("actor_user_id", actor)
    .eq("status", "approved")
    .maybeSingle()
  if (activeApprovalError) {
    throw new Error("EBAY_V3_APPROVAL_STATE_READ_FAILED")
  }
  const activeApprovalFresh = Boolean(
    activeApproval
    && Number.isFinite(Date.parse(text(activeApproval.expires_at)))
    && Date.parse(text(activeApproval.expires_at)) > Date.now()
    && !activeApproval.consumed_at
    && !activeApproval.revoked_at,
  )
  if (
    activeApproval
    && activeApproval.payload_hash === payloadHash
    && activeApprovalFresh
  ) {
    return { approval: activeApproval, idempotentReplay: true }
  }
  if (activeApproval && activeApproval.payload_hash !== payloadHash) {
    const { error: reconcileError } = await supabase
      .rpc("reconcile_ebay_draft_only_approval_conflict", {
        p_listing_package_id: prepared.listing_package_id,
        p_actor_user_id: actor,
        p_current_preview_hash: exactPreviewHash,
        p_current_payload_hash: payloadHash,
        p_target_account_fingerprint: prepared.account_fingerprint,
        p_action_version: V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION,
      })
    if (reconcileError) {
      throw new Error("EBAY_V3_RECONCILIATION_FAILED")
    }
    throw new Error("EBAY_V3_AUTHORIZATION_SUPERSEDED")
  }
  const approvalActionVersion = activeApproval && !activeApprovalFresh
    ? `${V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION}_RENEW_${
      v3AuthorizationHash(activeApproval.id).slice(0, 12)
    }`
    : V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION
  const approvalKey = buildV3UnpublishedAuthorizationIdempotencyKey({
    listingPackageId: prepared.listing_package_id,
    previewHash: exactPreviewHash,
    payloadHash,
    targetAccountFingerprint: prepared.account_fingerprint,
    actionVersion: approvalActionVersion,
  })
  const { data: approval, error: approvalError } = await supabase
    .rpc("approve_ebay_draft_only_package", {
      p_listing_package_id: prepared.listing_package_id,
      p_opportunity_id: record(payload.sourceEvidence).opportunityId,
      p_candidate_key: record(payload.sourceEvidence).candidateKey,
      p_actor_user_id: actor,
      p_payload_hash: payloadHash,
      p_approved_payload: payload,
      p_idempotency_key: approvalKey,
      p_expires_at: approvalExpiresAt(),
      p_target: prepared.target,
      p_account_fingerprint: prepared.account_fingerprint,
    })
    .single()
  if (approvalError || !approval) {
    const { data: existing } = await supabase
      .from("ebay_draft_only_approvals")
      .select("id,status,payload_hash,expires_at")
      .eq("approval_idempotency_key", approvalKey)
      .eq("actor_user_id", actor)
      .maybeSingle()
    if (!existing || existing.payload_hash !== payloadHash) {
      throw new Error("EBAY_V3_UNPUBLISHED_APPROVAL_FAILED")
    }
    return { approval: existing, idempotentReplay: true }
  }
  return { approval, idempotentReplay: false }
}

export async function GET(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  if (auth.serviceRole || !auth.actor) {
    return responseError(new Error("EBAY_V3_HUMAN_ADMIN_REQUIRED"), 403)
  }
  try {
    const attemptId = text(new URL(req.url).searchParams.get("attemptId"))
    if (attemptId !== EXPECTED_ATTEMPT) {
      return responseError(new Error("EBAY_V3_ATTEMPT_INVALID"), 400)
    }
    const state = await readOnlyPreflight(auth.actor, attemptId)
    const preflightFailed = state.preflight.result === "ERROR"
    return NextResponse.json({
      success: !preflightFailed,
      error: preflightFailed ? state.preflight.reason : undefined,
      preflightResult: state.preflight.result,
      preflightReason: state.preflight.reason,
      preflight: state.preflight,
      runtime: state.runtime,
      authorization: state.authorization
        ? publicPreview(state.authorization as JsonRecord)
        : null,
      approval: state.approval,
      safety: {
        readOnly: true,
        inventoryItemCreated: false,
        offerCreated: false,
        publishOfferCalled: false,
        ebayWrites: 0,
        productionChanged: false,
      },
    }, {
      status: preflightFailed ? 409 : 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const response = responseError(error)
    const payload = await response.json() as JsonRecord
    return NextResponse.json({
      ...payload,
      preflightResult: "ERROR",
      preflightReason: payload.error,
    }, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  try {
    const body = record(await req.json())
    if (body.action === "prepare") {
      if (
        text(body.attemptId) !== EXPECTED_ATTEMPT
        || text(body.previewHash) !== EXPECTED_PREVIEW
      ) throw new Error("EBAY_V3_PREPARE_INPUT_INVALID")
      const prepared = await prepare(auth.actor)
      return NextResponse.json({
        success: true,
        authorization: publicPreview(record(prepared.authorization)),
        authorizationMode: text(prepared.authorizationMode),
        approval: prepared.approval ?? null,
        reconciliation: prepared.reconciliation ?? null,
        idempotent: true,
        safety: {
          inventoryItemCreated: false,
          offerCreated: false,
          publishOfferCalled: false,
          ebayWrites: 0,
          productionChanged: false,
        },
      }, { status: 201 })
    }
    if (body.action === "authorize") {
      if (auth.serviceRole || !auth.actor) {
        throw new Error("EBAY_V3_HUMAN_ADMIN_REQUIRED")
      }
      const result = await authorizeAndPrepareExecution(auth.actor, body)
      return NextResponse.json({
        success: true,
        approval: result.approval,
        idempotentReplay: result.idempotentReplay,
        execution: {
          endpoint: "/api/admin/ebay/draft-only",
          action: "execute",
          approvalId: record(result.approval).id,
          idempotencyKey:
            `v3-unpublished-execute:${text(body.previewHash).slice(0, 24)}`,
        },
        safety: {
          authorizedOperations: [
            "createOrReplaceInventoryItem",
            "createOffer",
          ],
          publishOfferCalled: false,
          canPublish: false,
          automaticRetry: false,
        },
      }, { status: 201 })
    }
    return responseError(new Error("EBAY_V3_AUTHORIZATION_ACTION_INVALID"), 400)
  } catch (error) {
    return responseError(error)
  }
}
