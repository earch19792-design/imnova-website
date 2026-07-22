import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import type {
  ResolvedLunaCatalogSourceAsset,
} from "./luna-catalog-original-source-resolver"

const AUTHORIZED_NATIVE_HOST = "m.media-amazon.com"
const MAX_NATIVE_IMAGE_BYTES = 15 * 1024 * 1024

export const AUTHORIZED_CATALOG_NATIVE_MEDIA_VERSION =
  "AUTHORIZED_CATALOG_NATIVE_MEDIA_V1_2026_07_22"

export type AuthorizedCatalogNativeMediaDefinition = {
  id: string
  sourceImageId: "MAIN" | "SIDE"
  sourceAngle: "FRONT" | "SIDE"
  sourceUrl: string
  expectedSha256: string
  nativeWidth: number
  nativeHeight: number
  supplierProductId: string
  supplierVariantId: string
  authorizationStatus: "AUTHORIZED_CATALOG_NATIVE_HIGH_RES"
  excludedSourceSha256s: string[]
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function assertAuthorizedNativeUrl(value: unknown) {
  let url: URL
  try {
    url = new URL(text(value))
  } catch {
    throw new Error("AUTHORIZED_CATALOG_NATIVE_URL_INVALID")
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !==
      AUTHORIZED_NATIVE_HOST || url.username || url.password ||
      (url.port && url.port !== "443") || url.search || url.hash ||
      !/^\/images\/I\/[A-Za-z0-9+_-]+[.]_SL1500_[.]jpg$/.test(url.pathname)) {
    throw new Error("AUTHORIZED_CATALOG_NATIVE_URL_INVALID")
  }
  return url.toString()
}

async function readBoundedImage(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_NATIVE_IMAGE_BYTES || !response.body) {
    throw new Error("AUTHORIZED_CATALOG_NATIVE_IMAGE_TOO_LARGE")
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      if (total + value.byteLength > MAX_NATIVE_IMAGE_BYTES) {
        await reader.cancel("AUTHORIZED_CATALOG_NATIVE_IMAGE_TOO_LARGE")
          .catch(() => undefined)
        throw new Error("AUTHORIZED_CATALOG_NATIVE_IMAGE_TOO_LARGE")
      }
      chunks.push(Buffer.from(value))
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (!total) throw new Error("AUTHORIZED_CATALOG_NATIVE_IMAGE_EMPTY")
  return Buffer.concat(chunks, total)
}

export async function loadAuthorizedCatalogNativeMedia(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  listingPackageId: string
  candidateId: string
  supplierProductId: string
  supplierVariantId: string
}) {
  const { data, error } = await input.supabase
    .from("ebay_authorized_catalog_native_media")
    .select("id,source_image_id,source_angle,source_url,expected_sha256,native_width,native_height,supplier_product_id,supplier_variant_id,authorization_status,excluded_source_sha256s")
    .eq("marketplace_account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .eq("listing_package_id", input.listingPackageId)
    .eq("candidate_id", input.candidateId)
    .eq("supplier_product_id", input.supplierProductId)
    .eq("supplier_variant_id", input.supplierVariantId)
    .eq("authorization_status", "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
    .order("source_image_id", { ascending: true })
  if (error) throw new Error("AUTHORIZED_CATALOG_NATIVE_MEDIA_LOOKUP_FAILED")
  const rows = Array.isArray(data) ? data : []
  const definitions = rows.map((row): AuthorizedCatalogNativeMediaDefinition => ({
    id: text(row.id, 40),
    sourceImageId: text(row.source_image_id, 20) as "MAIN" | "SIDE",
    sourceAngle: text(row.source_angle, 20) as "FRONT" | "SIDE",
    sourceUrl: assertAuthorizedNativeUrl(row.source_url),
    expectedSha256: text(row.expected_sha256, 64),
    nativeWidth: Number(row.native_width),
    nativeHeight: Number(row.native_height),
    supplierProductId: text(row.supplier_product_id, 30),
    supplierVariantId: text(row.supplier_variant_id, 30),
    authorizationStatus: text(row.authorization_status, 80) as
      "AUTHORIZED_CATALOG_NATIVE_HIGH_RES",
    excludedSourceSha256s: Array.isArray(row.excluded_source_sha256s)
      ? row.excluded_source_sha256s.map((value) => text(value, 64)) : [],
  }))
  const sourceIds = definitions.map((definition) => definition.sourceImageId)
  const excluded = definitions[0]?.excludedSourceSha256s ?? []
  if (definitions.length !== 2 || new Set(sourceIds).size !== 2 ||
    !sourceIds.includes("MAIN") || !sourceIds.includes("SIDE") ||
    definitions.some((definition) =>
      !/^[0-9a-f]{64}$/.test(definition.expectedSha256) ||
      definition.nativeWidth < 1_200 || definition.nativeHeight < 1 ||
      definition.authorizationStatus !==
        "AUTHORIZED_CATALOG_NATIVE_HIGH_RES" ||
      definition.excludedSourceSha256s.length !== 5 ||
      definition.excludedSourceSha256s.some((hash) =>
        !/^[0-9a-f]{64}$/.test(hash)) ||
      definition.excludedSourceSha256s.some((hash) =>
        definitions.some((candidate) => candidate.expectedSha256 === hash)) ||
      JSON.stringify(definition.excludedSourceSha256s) !== JSON.stringify(excluded))) {
    throw new Error("AUTHORIZED_CATALOG_NATIVE_MEDIA_CONTRACT_INVALID")
  }
  return definitions
}

export async function resolveAuthorizedCatalogNativeMedia(input: {
  definitions: AuthorizedCatalogNativeMediaDefinition[]
  fetchImpl?: typeof fetch
}) {
  const fetchImpl = input.fetchImpl ?? fetch
  const assets: ResolvedLunaCatalogSourceAsset[] = []
  try {
    for (const definition of input.definitions) {
      const response = await fetchImpl(definition.sourceUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "image/jpeg" },
      })
      if ([301, 302, 303, 307, 308].includes(response.status) ||
        response.url && response.url !== definition.sourceUrl) {
        throw new Error("AUTHORIZED_CATALOG_NATIVE_REDIRECT_BLOCKED")
      }
      if (!response.ok || (response.headers.get("content-type") ?? "")
        .split(";")[0].toLowerCase() !== "image/jpeg") {
        throw new Error("AUTHORIZED_CATALOG_NATIVE_FETCH_FAILED")
      }
      const buffer = await readBoundedImage(response)
      const metadata = await sharp(buffer, {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      }).metadata()
      if (metadata.format !== "jpeg" ||
        metadata.width !== definition.nativeWidth ||
        metadata.height !== definition.nativeHeight ||
        sha256(buffer) !== definition.expectedSha256) {
        buffer.fill(0)
        throw new Error("AUTHORIZED_CATALOG_NATIVE_IMMUTABILITY_FAILED")
      }
      assets.push({
        sourceImageId: definition.sourceImageId,
        sourceAngle: definition.sourceAngle,
        productId: definition.supplierProductId,
        variantId: definition.supplierVariantId,
        sourceUrl: definition.sourceUrl,
        nativeWidth: definition.nativeWidth,
        nativeHeight: definition.nativeHeight,
        contentType: "image/jpeg",
        sha256: definition.expectedSha256,
        viewClassification: definition.sourceImageId === "MAIN"
          ? "PRIMARY" : "ALTERNATE_AUTHORIZED_ANGLE",
        qualityTier: "NATIVE_HIGH_RES",
        selectedForSlots: definition.sourceImageId === "MAIN"
          ? ["MAIN_WHITE_BACKGROUND"] : [],
        authorizationStatus: "AUTHORIZED_CATALOG_NATIVE_HIGH_RES",
        enhancedDerivative: false,
        sourceSha256: definition.expectedSha256,
        enhancedSha256: null,
        effectiveWidth: definition.nativeWidth,
        effectiveHeight: definition.nativeHeight,
        excludedSourceSha256s: [...definition.excludedSourceSha256s],
        nativeBuffer: buffer,
        buffer,
      })
    }
    return assets
  } catch (error) {
    for (const asset of assets) asset.buffer.fill(0)
    throw error
  }
}
