import "server-only"

import { createHash, randomBytes, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  normalizeLunaChromeShippingDestinationV1,
  normalizeLunaChromeShippingJobV1,
  type LunaChromeShippingJobV1,
} from "./ebay-luna-chrome-shipping-capture-v1"
import { EBAY_LUNA_BOCA_RATON_LOCATION } from
  "./ebay-merchant-location-one-shot-gateway"

export const LUNA_SHIPPING_CANARY_CANDIDATE_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function money(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null
}

function exactKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
}

function candidateId(familyId: string, productId: string,
  variantId: string, sku: string) {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    familyId, productId, variantId, sku,
  })).digest("hex")}`
}

const canonicalAddress = EBAY_LUNA_BOCA_RATON_LOCATION.location.address
const destinationFingerprintInput = Object.freeze({
  profileId: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
  country: canonicalAddress.country,
  province: canonicalAddress.stateOrProvince,
  postalCode: canonicalAddress.postalCode,
})
const CANONICAL_DESTINATION = normalizeLunaChromeShippingDestinationV1({
  profileId: "LUNA_BOCA_RATON_US",
  profileDigest: `sha256:${createHash("sha256")
    .update(JSON.stringify(destinationFingerprintInput)).digest("hex")}`,
  country: "US",
  province: canonicalAddress.stateOrProvince,
  postalCode: canonicalAddress.postalCode,
})

export async function resolveLunaChromeShippingJobsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateIds?: readonly string[]
}>) : Promise<readonly LunaChromeShippingJobV1[]> {
  const frontierResult = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    })
  if (frontierResult.error) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_EVIDENCE_READ_FAILED")
  }
  const exactCandidates = records(record(frontierResult.data).frontiers)
    .flatMap((outer) => {
      const frontier = record(outer.frontier)
      const familyId = text(frontier.familyId, 120)
      const lunaProductId = text(frontier.lunaProductId, 30)
      const lunaVariantId = text(frontier.lunaVariantId, 30)
      const supplierSku = text(frontier.lunaSku, 160)
      if (!familyId || !/^market-family-v1:sha256:[0-9a-f]{64}$/.test(familyId) ||
          !lunaProductId || !lunaVariantId || !supplierSku ||
          frontier.productFit !== "STRONG" ||
          frontier.economicClassification === "ECONOMICALLY_DEAD") return []
      return [Object.freeze({ familyId, lunaProductId, lunaVariantId,
        supplierSku, frontier,
        candidateId: candidateId(familyId, lunaProductId, lunaVariantId,
          supplierSku) })]
    })
  const requested = input.candidateIds?.length
    ? [...new Set(input.candidateIds)]
    : [LUNA_SHIPPING_CANARY_CANDIDATE_ID,
      ...exactCandidates.map((candidate) => candidate.candidateId)
        .filter((candidateId) => candidateId !== LUNA_SHIPPING_CANARY_CANDIDATE_ID)]
      .slice(0, 2)
  if (!requested.length || requested.length > LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH ||
      requested.some((candidateId) => !/^sha256:[0-9a-f]{64}$/.test(candidateId))) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_SCOPE_INVALID")
  }
  const selected = requested.map((requestedId) => exactCandidates.find((candidate) =>
    candidate.candidateId === requestedId)).filter((candidate) => Boolean(candidate))
  if (selected.length !== requested.length) {
    throw new Error("LUNA_SHIPPING_EXTENSION_EXACT_CANDIDATE_NOT_FOUND")
  }
  const productIds = selected.map((candidate) => candidate!.lunaProductId)
  const catalogResult = await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,price,product_url,captured_at")
      .eq("source_key", "lunaportex").in("supplier_product_id", productIds)
      .order("captured_at", { ascending: false }).limit(100)
  if (catalogResult.error) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_EVIDENCE_READ_FAILED")
  }
  const catalogByIdentity = new Map(records(catalogResult.data).flatMap((row) => {
    const productId = text(row.supplier_product_id, 30)
    const variantId = text(row.supplier_variant_id, 30)
    const sku = text(row.sku, 160)
    return productId && variantId && sku
      ? [[exactKey(productId, variantId, sku), row] as const] : []
  }))
  return Object.freeze(selected.map((candidate) => {
    const exact = candidate!
    const catalog = catalogByIdentity.get(exactKey(exact.lunaProductId,
      exact.lunaVariantId, exact.supplierSku)) ?? {}
    const frontier = exact.frontier
    const supplierProductId = text(catalog.supplier_product_id, 30)
    const supplierVariantId = text(catalog.supplier_variant_id, 30)
    const supplierSku = text(catalog.sku, 160)
    const canonicalProductUrl = text(catalog.product_url, 500)
    const supplierCostUsd = money(frontier.lunaUnitCost ?? catalog.price)
    const salePriceUsd = money(frontier.marketPriceMedian)
    const productName = text(catalog.title, 200)
    if (!supplierProductId || !supplierVariantId || !supplierSku ||
        supplierProductId !== exact.lunaProductId ||
        supplierVariantId !== exact.lunaVariantId ||
        supplierSku !== exact.supplierSku || !canonicalProductUrl ||
        supplierCostUsd === null || salePriceUsd === null || !productName) {
      throw new Error("LUNA_SHIPPING_EXTENSION_AUTHORITATIVE_FACTS_UNPROVEN")
    }
    return normalizeLunaChromeShippingJobV1({
      contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
      captureSessionId: randomUUID(),
      nonce: randomBytes(32).toString("base64url"),
      identity: {
        candidateId: exact.candidateId,
        canonicalProductUrl,
        lunaProductId: supplierProductId,
        lunaVariantId: supplierVariantId,
        supplierSku,
        quantity: 1,
      },
      destination: CANONICAL_DESTINATION,
      salePriceUsd,
      supplierCostUsd,
      productName,
    })
  }))
}
