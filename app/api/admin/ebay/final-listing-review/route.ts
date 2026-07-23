export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const STAGING_OUTPUT_BUCKET = "ebay-listing-image-staging"

type JsonRecord = Record<string, unknown>

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function uuid(value: unknown) {
  const normalized = String(value ?? "").trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:-]+$/.test(value)
    ? value
    : "FINAL_LISTING_REVIEW_READ_FAILED"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json({
      success: false,
      error: validation.error ?? "admin_forbidden",
    }, { status: validation.status || 403 })
  }

  try {
    const attemptId = uuid(new URL(req.url).searchParams.get("attemptId"))
    if (!attemptId) {
      return NextResponse.json({
        success: false,
        error: "FINAL_LISTING_REVIEW_ATTEMPT_REQUIRED",
      }, { status: 400 })
    }
    const supabase = getSupabaseAdminClient()
    const { data: review, error } = await supabase
      .from("ebay_reference_guided_final_listing_review_previews")
      .select("*")
      .eq("attempt_id", attemptId)
      .eq("created_by", validation.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error("FINAL_LISTING_REVIEW_READ_FAILED")
    if (!review) {
      return NextResponse.json({
        success: false,
        error: "FINAL_LISTING_REVIEW_NOT_FOUND",
      }, { status: 404 })
    }

    const snapshot = object(review.preview_snapshot)
    const selectedImages = Array.isArray(snapshot.selectedImages)
      ? snapshot.selectedImages.map(object)
      : []
    if (selectedImages.length !== 7) {
      throw new Error("FINAL_LISTING_REVIEW_IMAGE_SET_INVALID")
    }
    const signedImages = await Promise.all(selectedImages.map(async (asset) => {
      const position = Number(asset.position)
      const storagePath = String(asset.storagePath ?? "")
      const sha256 = String(asset.sha256 ?? "")
      const assetRole = String(asset.assetRole ?? "")
      if (!Number.isInteger(position) || position < 0 || position > 6
        || !storagePath || !/^[0-9a-f]{64}$/.test(sha256)
        || !assetRole) {
        throw new Error("FINAL_LISTING_REVIEW_IMAGE_BINDING_INVALID")
      }
      const { data, error: signedError } = await supabase.storage
        .from(STAGING_OUTPUT_BUCKET)
        .createSignedUrl(storagePath, 600)
      if (signedError || !data?.signedUrl) {
        throw new Error("FINAL_LISTING_REVIEW_SIGNED_PREVIEW_FAILED")
      }
      return {
        position,
        assetRole,
        status: String(asset.status ?? ""),
        sha256,
        storagePath,
        signedPreviewUrl: data.signedUrl,
      }
    }))
    signedImages.sort((left, right) => left.position - right.position)
    if (signedImages[0]?.assetRole !== "PRIMARY_MAIN") {
      throw new Error("FINAL_LISTING_REVIEW_PRIMARY_ORDER_INVALID")
    }

    const { data: currentPackage, error: packageError } = await supabase
      .from("ebay_listing_packages")
      .select("updated_at")
      .eq("id", review.listing_package_id)
      .eq("created_by", validation.userId)
      .maybeSingle()
    if (packageError || !currentPackage) {
      throw new Error("FINAL_LISTING_REVIEW_PACKAGE_READ_FAILED")
    }

    return NextResponse.json({
      success: true,
      review: {
        id: review.id,
        revisionId: review.revision_id,
        attemptId: review.attempt_id,
        listingPackageId: review.listing_package_id,
        previewHash: review.preview_hash,
        snapshot,
        gates: review.gates,
        blockers: review.blockers,
        visualPhase: review.visual_phase,
        finalVisualSetLocked: review.final_visual_set_locked,
        generationControlsHidden: review.generation_controls_hidden,
        readyForUnpublishedOfferAuthorization:
          review.ready_for_unpublished_offer_authorization,
        authorizationEnabled: review.authorization_enabled,
        inventoryItemCreated: review.inventory_item_created,
        offerCreated: review.offer_created,
        offerStatus: review.offer_status,
        ebayWrites: review.ebay_writes,
        productionChanged: review.production_changed,
        providerCalls: review.provider_calls_snapshot,
        userFieldsPreserved:
          currentPackage.updated_at === review.listing_package_updated_at,
        createdAt: review.created_at,
      },
      signedImages,
      cache: {
        signedUrlTtlSeconds: 600,
        refreshedOnEveryGet: true,
      },
      safety: {
        readOnly: true,
        authorizationEnabled: false,
        inventoryItemCreated: false,
        offerCreated: false,
        ebayWrites: 0,
        productionChanged: false,
      },
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    })
  } catch (error) {
    const code = safeCode(error)
    const status = /NOT_FOUND/.test(code) ? 404
      : /INVALID|REQUIRED/.test(code) ? 409 : 502
    return NextResponse.json({
      success: false,
      error: code,
      safety: {
        readOnly: true,
        inventoryItemCreated: false,
        offerCreated: false,
        ebayWrites: 0,
        productionChanged: false,
      },
    }, { status })
  }
}
