import { createHash } from "node:crypto"

import {
  SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
  createSellerOsCanonicalLunaServerReadResolverV1,
} from "./ebay-luna-automation-prerequisites-v1"

type CanonicalProductRead = Readonly<{
  productId: string
  variants: readonly Readonly<{
    id: string
    sku: string
    available: boolean | null
    sourceInventoryQuantity: number | null
    sourceInventoryQuantityExplicit: boolean
  }>[]
  sourceMode: "AUTHENTICATED_SERVER_HTTP"
  sourceSessionHealth: "SESSION_OK"
  sourceParserVersion: string
  sourceEvidenceFingerprint: string
}>

type CertifiedLinkage = Parameters<
  typeof createSellerOsCanonicalLunaServerReadResolverV1
>[0]["loadLinkageById"] extends
  (linkageId: string) => Promise<infer T> ? Exclude<T, null> : never

function evidenceDigest(value: unknown) {
  return `luna-canonical-server-read-v1:sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

/**
 * Inert factory for the future gated runtime. Only a linkage id and component
 * identity cross the caller boundary. The fixed URL and exact variant come
 * from P2-I01 repository evidence, and the authenticated reader is supplied
 * by server composition rather than by the caller.
 */
export function createSellerOsLunaCanonicalServerReadV1(input: Readonly<{
  loadLinkageById: (linkageId: string) => Promise<CertifiedLinkage | null>
  readFixedProduct: (canonicalSourceUrl: string) => Promise<CanonicalProductRead>
  now?: () => string
}>) {
  const resolveTarget = createSellerOsCanonicalLunaServerReadResolverV1({
    loadLinkageById: input.loadLinkageById,
  })
  return async function read(request: Readonly<{
    linkageId: string
    componentIdentityId: string
  }>) {
    const target = await resolveTarget(request)
    const product = await input.readFixedProduct(target.canonicalSourceUrl)
    if (!product || product.sourceMode !== "AUTHENTICATED_SERVER_HTTP" ||
        product.sourceSessionHealth !== "SESSION_OK" ||
        !Array.isArray(product.variants) || product.variants.length > 500 ||
        typeof product.sourceParserVersion !== "string" ||
        product.sourceParserVersion.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(product.sourceParserVersion) ||
        !/^luna_authenticated_[a-f0-9]{40}$/.test(
          product.sourceEvidenceFingerprint,
        )) {
      throw new Error("LUNA_PARSE_CONTRACT_CHANGED")
    }
    if (product.productId !== target.lunaProductId) {
      throw new Error("LUNA_PRODUCT_NOT_FOUND")
    }
    const variant = target.lunaVariantId
      ? product.variants.find((candidate) =>
          candidate.id === target.lunaVariantId &&
          candidate.sku === target.lunaSku)
      : product.variants.length === 1 &&
          product.variants[0]?.sku === target.lunaSku
        ? product.variants[0] : null
    if (!variant) throw new Error("LUNA_VARIANT_NOT_FOUND")
    if (![true, false, null].includes(variant.available) ||
        typeof variant.sourceInventoryQuantityExplicit !== "boolean" ||
        (variant.sourceInventoryQuantityExplicit &&
          (!Number.isSafeInteger(variant.sourceInventoryQuantity) ||
            Number(variant.sourceInventoryQuantity) < 0))) {
      throw new Error("LUNA_PARSE_CONTRACT_CHANGED")
    }
    const quantity = variant.sourceInventoryQuantityExplicit &&
      Number.isSafeInteger(variant.sourceInventoryQuantity) &&
      Number(variant.sourceInventoryQuantity) >= 0
      ? Number(variant.sourceInventoryQuantity) : null
    const observedAt = input.now?.() ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(observedAt))) {
      throw new Error("LUNA_CANONICAL_SERVER_READ_CLOCK_INVALID")
    }
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
      linkageId: target.linkageId,
      componentIdentityId: target.componentIdentityId,
      lunaProductId: target.lunaProductId,
      lunaVariantId: target.lunaVariantId,
      lunaSku: target.lunaSku,
      supplierQuantityRequired: target.supplierQuantityRequired,
      source: "LUNA_PORTEX" as const,
      sourceStatus: "AVAILABLE" as const,
      supplierStatedAvailability: variant.available,
      observedSupplierQuantity: quantity,
      evidenceClass: "SUPPLIER_STATED" as const,
      evidenceDigest: evidenceDigest({
        linkageId: target.linkageId,
        componentIdentityId: target.componentIdentityId,
        productId: target.lunaProductId,
        variantId: target.lunaVariantId,
        sku: target.lunaSku,
        available: variant.available,
        quantity,
        sourceEvidenceFingerprint: product.sourceEvidenceFingerprint,
        observedAt,
      }),
      acquisitionMethod: "CANONICAL_SERVER_READ" as const,
      observedAt: new Date(observedAt).toISOString(),
      parserVersion: product.sourceParserVersion,
      productionObservationPersisted: false as const,
      certifiedOos: false as const,
      safeSalesCapacity: null,
      rawHtmlIncluded: false as const,
      sessionMaterialIncluded: false as const,
      limitations: Object.freeze([
        "LUNA_PORTEX_STOCK_IS_SUPPLIER_STATED_EVIDENCE",
        "BOUNDED_PREFLIGHT_IS_NOT_PRODUCTION_OBSERVATION",
        "OBSERVED_OUT_OF_STOCK_IS_NOT_CERTIFIED_OOS",
      ] as const),
    })
  }
}
