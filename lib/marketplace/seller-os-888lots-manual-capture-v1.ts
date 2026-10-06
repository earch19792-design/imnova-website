import type { SupabaseClient } from "@supabase/supabase-js"

import { writeGoldenReceiptV1, type GoldenContext } from
  "../ebay/commercial-golden-path-runtime-v1"
import { persistSellerOsCommercialMemoryDocumentV1 } from
  "../ebay/seller-os-commercial-opportunity-memory-v1"
import { build888LotsCommercialMemoryV1,
  preview888LotsDualMarketplaceSourcingV1,
  SELLER_OS_888LOTS_SOURCE_KEY } from
  "./seller-os-888lots-supplier-onboarding-v1"

export const SELLER_OS_888LOTS_MANUAL_CAPTURE_V1 =
  "SELLER_OS_888LOTS_MANUAL_DUAL_MARKET_CAPTURE_V1" as const

type Evaluation = ReturnType<typeof preview888LotsDualMarketplaceSourcingV1>

async function persistCanonicalSupplierObservationV1(
  supabase: SupabaseClient,
  evaluation: Evaluation,
) {
  const candidate = evaluation.candidate
  const source = await supabase.from("market_radar_sources")
    .select("id").eq("key", SELLER_OS_888LOTS_SOURCE_KEY).limit(1).maybeSingle()
  if (source.error || !source.data) {
    throw new Error("SELLER_OS_888LOTS_CANONICAL_SOURCE_UNAVAILABLE")
  }
  const identity = candidate.candidate
  if (!identity.supplierProductId || !identity.supplierVariantId ||
    !identity.canonicalSku || !identity.title) {
    throw new Error("SELLER_OS_888LOTS_CANONICAL_IDENTITY_REQUIRED")
  }
  const product = await supabase.from("market_radar_products").upsert({
    source_id: source.data.id,
    supplier_product_id: identity.supplierProductId,
    handle: identity.canonicalSku.toLowerCase(),
    title: identity.title,
    vendor: identity.brand,
    product_type: identity.category,
    tags: ["888lots", "owner-manual-capture"],
    product_url: identity.productUrl,
    featured_image_url: identity.imageUrls[0] ?? null,
    image_urls: identity.imageUrls,
    updated_at_source: candidate.inventory.sourceUpdatedAt,
    last_seen_at: candidate.inventory.capturedAt,
    last_snapshot_at: candidate.inventory.capturedAt,
    is_active: (candidate.inventory.availableQuantity ?? 0) > 0,
    metadata: { contractVersion: SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
      canonicalSku: identity.canonicalSku, asin: identity.asin,
      upc: identity.upc, ean: identity.ean,
      captureMode: "OWNER_MANUAL_PUBLIC_CATALOG" },
  }, { onConflict: "source_id,supplier_product_id" })
    .select("id").single()
  if (product.error || !product.data) {
    throw new Error("SELLER_OS_888LOTS_CANONICAL_PRODUCT_WRITE_FAILED")
  }
  const existing = await supabase.from("market_radar_snapshots")
    .select("id").eq("source_id", source.data.id)
    .eq("product_id", product.data.id)
    .eq("supplier_variant_id", identity.supplierVariantId)
    .eq("captured_at", candidate.inventory.capturedAt)
    .limit(1).maybeSingle()
  if (existing.error) {
    throw new Error("SELLER_OS_888LOTS_CANONICAL_SNAPSHOT_READ_FAILED")
  }
  let snapshotId = existing.data?.id ?? null
  let replay = Boolean(snapshotId)
  if (!snapshotId) {
    const snapshot = await supabase.from("market_radar_snapshots").insert({
      source_id: source.data.id,
      product_id: product.data.id,
      supplier_variant_id: identity.supplierVariantId,
      variant_title: identity.title,
      sku: identity.canonicalSku,
      price: candidate.costs.unitCostUsd,
      compare_at_price: null,
      available: (candidate.inventory.availableQuantity ?? 0) > 0,
      inventory_quantity: candidate.inventory.availableQuantity,
      collections: identity.category ? [identity.category] : [],
      raw: { contractVersion: SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
        captureDigest: evaluation.evidenceDigest,
        supplier: candidate,
        safety: { supplierPurchases: 0, marketplaceWrites: 0 } },
      captured_at: candidate.inventory.capturedAt,
    }).select("id").single()
    if (snapshot.error || !snapshot.data) {
      throw new Error("SELLER_OS_888LOTS_CANONICAL_SNAPSHOT_WRITE_FAILED")
    }
    snapshotId = snapshot.data.id
    replay = false
  }
  return { sourceId: source.data.id, productId: product.data.id,
    snapshotId, replay, ledger: "MARKET_RADAR_PRODUCTS_AND_SNAPSHOTS" }
}

export async function capture888LotsManualDualMarketV1(input: {
  supabase: SupabaseClient
  accountKey: string
  accountAlias: string
  ownerUserId: string
  evaluation: Evaluation
  now: Date
}) {
  const candidate = input.evaluation.candidate
  if (!candidate.candidate.supplierProductId ||
    !candidate.candidate.supplierVariantId ||
    !candidate.candidate.canonicalSku || !candidate.candidate.title ||
    !candidate.inventory.availableQuantity ||
    candidate.inventory.availableQuantity < 1) {
    throw new Error("SELLER_OS_888LOTS_CAPTURE_REQUIRED_FIELDS_MISSING")
  }
  const observedAt = candidate.inventory.capturedAt
  const supplierObservation = await persistCanonicalSupplierObservationV1(
    input.supabase, input.evaluation)
  const ctx: GoldenContext = { supabase: input.supabase,
    accountKey: input.accountKey, accountAlias: input.accountAlias,
    principal: { ownerUserId: input.ownerUserId,
      commandClientId: "seller-os-888lots-manual-ui", scopes: [] },
    now: input.now, invocationSource: "OWNER_ADMIN_UI" }
  const receipt = await writeGoldenReceiptV1(ctx, "EVALUATION", {
    contractVersion: SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    evaluation: input.evaluation,
    supplierObservation,
    decision: input.evaluation.sourcing.decision,
    evidenceDigest: input.evaluation.evidenceDigest,
    observedAt,
    safety: { supplierPurchases: 0, ebayWrites: 0, amazonWrites: 0,
      publications: 0, repricing: 0 },
  })
  const memory = build888LotsCommercialMemoryV1({
    evaluation: input.evaluation,
    evaluationReceiptId: receipt.durableReceipt.receiptId,
    evaluationReceiptDigest: receipt.durableReceipt.evidenceDigest,
    observedAt,
  })
  const storedMemory = await persistSellerOsCommercialMemoryDocumentV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    principal: { ownerUserId: input.ownerUserId },
    now: input.now,
  }, memory)
  return { contractVersion: SELLER_OS_888LOTS_MANUAL_CAPTURE_V1,
    supplierObservation, evaluationReceipt: receipt.durableReceipt,
    commercialMemory: storedMemory,
    safety: { internalDatabaseWrites: true, supplierPurchases: 0,
      ebayWrites: 0, amazonWrites: 0, publications: 0, repricing: 0 } }
}
