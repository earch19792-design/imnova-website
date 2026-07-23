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
  V3_PUBLICATION_BUCKET,
  V3_PUBLICATION_SOURCE_BUCKET,
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
  const transport = await ensurePublicationTransport(context)
  const assets = validateV3PublicationAssets(transport.assets)
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
  const binding = {
    version: "EBAY_V3_FINAL_SET_UNPUBLISHED_AUTHORIZATION_V1",
    authorizationPreviewId,
    revisionId: review.revision_id,
    attemptId: review.attempt_id,
    finalPreviewId: review.id,
    finalPreviewHash: review.preview_hash,
    imageTransportId: transport.id,
    imageTransportHash: transport.transport_hash,
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
    image_transport_id: transport.id,
    image_transport_hash: transport.transport_hash,
    target: runtime.target,
    account_fingerprint: preflight.identity.accountFingerprint,
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
  if (!persisted) {
    const { data: existing } = await supabase
      .from("ebay_v3_unpublished_offer_authorization_previews")
      .select("*")
      .eq("preview_hash", review.preview_hash)
      .eq("payload_hash", payloadHash)
      .maybeSingle()
    if (!existing) throw new Error("EBAY_V3_UNPUBLISHED_AUTHORIZATION_READ_FAILED")
    return existing
  }
  return persisted
}

function publicPreview(row: JsonRecord) {
  const payload = record(row.exact_payload)
  const inventory = record(payload.inventoryItemPayload)
  const product = record(inventory.product)
  const offer = record(payload.offerPayload)
  return {
    id: row.id,
    status: row.status,
    target: row.target,
    targetAccount: {
      status: "BOUND",
      fingerprint: row.account_fingerprint,
    },
    previewHash: row.preview_hash,
    payloadHash: row.payload_hash,
    sku: row.sku,
    listingQuantity: row.listing_quantity,
    title: product.title,
    price: record(record(offer.pricingSummary).price),
    categoryId: offer.categoryId,
    marketplaceId: offer.marketplaceId,
    format: offer.format,
    policies: offer.listingPolicies,
    merchantLocationKey: offer.merchantLocationKey,
    itemSpecifics: product.aspects,
    description: product.description,
    images: validateV3PublicationAssets(
      record(record(payload.compliance).v3FinalSetAuthorization).selectedAssets
        ? record(record(payload.compliance).v3FinalSetAuthorization).selectedAssets
        : [],
    ),
    exactPayload: payload,
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

async function authorizeAndPrepareExecution(actor: string, body: JsonRecord) {
  const authorizationId = text(body.authorizationPreviewId)
  const previewHash = text(body.previewHash)
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
    .eq("preview_hash", previewHash)
    .eq("payload_hash", payloadHash)
    .eq("status", "READY_FOR_HUMAN_AUTHORIZATION")
    .maybeSingle()
  if (error || !prepared) throw new Error("EBAY_V3_AUTHORIZATION_PREVIEW_NOT_CURRENT")
  if (Date.parse(prepared.preflight_snapshot_expires_at) <= Date.now()) {
    throw new Error("EBAY_V3_AUTHORIZATION_PREFLIGHT_EXPIRED")
  }
  await loadFinalReview(actor, EXPECTED_ATTEMPT, previewHash)
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
  const approvalKey = `v3-unpublished:${previewHash.slice(0, 24)}`
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
    const row = await latest(auth.actor, attemptId)
    return NextResponse.json({
      success: true,
      authorization: row ? publicPreview(row as JsonRecord) : null,
      safety: {
        readOnly: true,
        inventoryItemCreated: false,
        offerCreated: false,
        publishOfferCalled: false,
        ebayWrites: 0,
        productionChanged: false,
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } })
  } catch (error) {
    return responseError(error)
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
        authorization: publicPreview(prepared as JsonRecord),
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
