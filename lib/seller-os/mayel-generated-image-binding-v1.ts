import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveMaximumOfficialEbayImageV1 } from "../ebay/ebay-seller-os-visual-quality-v1"

export const MAYEL_ASSISTANT_IMAGE_SOURCE_V1 = "SELLER_OS_ASSISTANT_IMAGE_VARIANT" as const
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export function isMayelGeneratedSourceBoundV1(reference: unknown, generatedSource: string) {
  if (typeof reference !== "string") return false
  return reference === generatedSource || resolveMaximumOfficialEbayImageV1(reference).analyzedUrl === generatedSource
}

// This is a reader of the certified generator's durable result, never a new
// image producer. Neither a caller's QA assertion nor a supplied URL is trusted.
export function validateMayelGeneratedImageV1(input: {
  accountKey: string; itemId: string; experimentId: string; assetId: string; row: unknown
}) {
  const row = object(input.row)
  const visual = object(object(row.baseline_evidence_ref).sellerOsVisualVariant)
  const variants = Array.isArray(visual.variants) ? visual.variants.map(object) : []
  const matches = variants.filter(v => v.assetId === input.assetId)
  const variant = matches[0] ?? {}
  const path = variant.outputStoragePath
  if (!uuid(input.experimentId) || !uuid(input.assetId) || !/^\d{9,20}$/.test(input.itemId) ||
      row.account_key !== input.accountKey || row.marketplace !== "EBAY_US" || row.ebay_item_id !== input.itemId ||
      row.experiment_id !== input.experimentId || row.experiment_type !== "HERO_VISUAL_VARIANT" ||
      !["DRAFT", "READY"].includes(String(row.lifecycle_status)) ||
      visual.contractVersion !== "SELLER_OS_VISUAL_VARIANT_V1_2026_08_29" || visual.experimentId !== input.experimentId || visual.ebayItemId !== input.itemId ||
      matches.length !== 1 || variant.status !== "EXPERIMENT_READY" || variant.variantRejected !== false ||
      variant.productTruthPreserved !== true || variant.protectedLayerRoundtripExact !== true ||
      variant.sourceImageFullResolutionCertified !== true || object(variant.backgroundQa).passed !== true ||
      !/^[0-9a-f]{64}$/.test(String(variant.outputSha256)) || !/^[0-9a-f]{64}$/.test(String(visual.sourceHash)) ||
      typeof visual.sourceImageUrl !== "string" || !visual.sourceImageUrl.startsWith("https://") ||
      typeof path !== "string" || !["a", "b"].some(letter => path === `seller-os-visual-variants/${input.itemId}/${input.experimentId}/variant-${letter}.png`)) {
    throw Error("MAYEL_GENERATED_IMAGE_BINDING_OR_QA_INVALID")
  }
  return { experimentId: input.experimentId, assetId: input.assetId, itemId: input.itemId,
    outputStoragePath: path, outputSha256: String(variant.outputSha256),
    sourceImageUrl: visual.sourceImageUrl, sourceHash: String(visual.sourceHash),
    generatedAt: typeof row.created_at === "string" ? row.created_at : null,
    sourceType: MAYEL_ASSISTANT_IMAGE_SOURCE_V1 }
}

export async function readMayelGeneratedImageV1(input: {
  supabase: SupabaseClient; accountKey: string; itemId: string; experimentId: string; assetId: string
}) {
  const read = await input.supabase.from("ebay_listing_experiments_v1")
    .select("experiment_id,account_key,marketplace,ebay_item_id,experiment_type,lifecycle_status,baseline_evidence_ref,created_at")
    .eq("account_key", input.accountKey).eq("ebay_item_id", input.itemId).eq("experiment_id", input.experimentId).maybeSingle()
  if (read.error || !read.data) throw Error("MAYEL_GENERATED_IMAGE_NOT_FOUND")
  return validateMayelGeneratedImageV1({ ...input, row: read.data })
}

export function assertMayelGeneratedBytesV1(bytes: Buffer, expectedHash: string) {
  if (!bytes.length || bytes.length > 12 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== expectedHash)
    throw Error("MAYEL_GENERATED_IMAGE_BYTES_MISMATCH")
}

export function replaceMayelHeroIntentV1<T extends { kind: "CURRENT_OFFICIAL" | "MAYEL_ASSET"; publicUrl?: string | null; assetId?: string | null }>(order: readonly T[], assetId: string) {
  if (!order.length) throw Error("MAYEL_CURRENT_GALLERY_REQUIRED")
  // The preview explicitly replaces only the main image. Preserve the ordered
  // secondary gallery, including other previously approved presentation assets.
  return [{ kind: "MAYEL_ASSET" as const, assetId }, ...order.slice(1).filter(entry => entry.assetId !== assetId)]
}
