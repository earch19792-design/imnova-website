import { createHash } from "node:crypto"

export const CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION =
  "CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1" as const

export const CURRENT_COMMERCIAL_CANDIDATE_MARKETPLACE = "EBAY_US" as const
export const CURRENT_COMMERCIAL_CANDIDATE_SUPPLIER_AUTHORITY =
  "LUNAPORTEX" as const

type CurrentCommercialCandidateIdentityInputV1 = Readonly<{
  accountKey: string
  productId: string
  variantId: string
  supplierSku: string
  marketplaceId?: typeof CURRENT_COMMERCIAL_CANDIDATE_MARKETPLACE
  supplierAuthority?: typeof CURRENT_COMMERCIAL_CANDIDATE_SUPPLIER_AUTHORITY
}>

function exactIdentityText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`CURRENT_COMMERCIAL_CANDIDATE_${name}_INVALID`)
  }
  return value
}

function lengthPrefixed(value: string) {
  return `${Buffer.byteLength(value, "utf8")}:${value}`
}

/**
 * Stable CURRENT commercial identity. Evidence lineage (Radar family, research
 * digest, freshness, batch order and Shipping receipts) is intentionally not
 * part of this key: those authorities may change without changing the exact
 * supplier product/variant/SKU under one marketplace account.
 */
export function deriveCurrentCommercialCandidateIdentityV1(
  input: CurrentCommercialCandidateIdentityInputV1,
) {
  const accountKey = exactIdentityText(input.accountKey, "ACCOUNT_SCOPE", 200)
  const marketplaceId = exactIdentityText(input.marketplaceId ??
    CURRENT_COMMERCIAL_CANDIDATE_MARKETPLACE, "MARKETPLACE_SCOPE", 32)
  const supplierAuthority = exactIdentityText(input.supplierAuthority ??
    CURRENT_COMMERCIAL_CANDIDATE_SUPPLIER_AUTHORITY, "SUPPLIER_AUTHORITY", 32)
  const productId = exactIdentityText(input.productId, "PRODUCT_ID", 80)
  const variantId = exactIdentityText(input.variantId, "VARIANT_ID", 80)
  const supplierSku = exactIdentityText(input.supplierSku, "SUPPLIER_SKU", 200)
  const preimage = [CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION, accountKey,
    marketplaceId, supplierAuthority, productId, variantId, supplierSku]
    .map(lengthPrefixed).join("\n")
  const canonicalCandidateId = `sha256:${createHash("sha256")
    .update(preimage, "utf8").digest("hex")}`
  return Object.freeze({
    contractVersion: CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION,
    canonicalCandidateId,
    accountKey,
    marketplaceId,
    supplierAuthority,
    productId,
    variantId,
    supplierSku,
  })
}

