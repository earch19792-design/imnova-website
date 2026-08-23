import { createHash } from "node:crypto"

import {
  SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
  createSellerOsCanonicalLunaServerReadResolverV1,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-luna-automation-prerequisites-v1.ts"
import {
  fetchPublicLunaProductForActiveListingMonitor,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-targeted-active-listing-luna-monitor.ts"

export const SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1 =
  "LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK" as const

type CertifiedLinkage = Parameters<
  typeof createSellerOsCanonicalLunaServerReadResolverV1
>[0]["loadLinkageById"] extends
  (linkageId: string) => Promise<infer T> ? Exclude<T, null> : never

type PublicVariantEvidence = Readonly<{
  id: string
  sku: string
  available: boolean | null
  availabilityMarker?: "SOLD_OUT" | "OUT_OF_STOCK" | "IN_STOCK" |
    "AVAILABLE" | null
  sourceInventoryQuantity?: number | null
  sourceInventoryQuantityExplicit?: boolean
  sourceUnitPrice?: number | null
}>

type PublicProductEvidence = Readonly<{
  productId: string
  canonicalUrl: string
  variants: readonly PublicVariantEvidence[]
  sourceMode?: "PUBLIC_READ_ONLY_PRODUCT_PAGE" | "AUTHENTICATED_SERVER_HTTP" |
    "AUTHENTICATED_WEB_SESSION"
  sourceParserVersion?: string
}>

export type SellerOsLunaPublicExactStockObservationV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION
  source: typeof SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1
  sourceStatus: "AVAILABLE" | "SOURCE_UNAVAILABLE" | "IDENTITY_MISMATCH" |
    "MALFORMED_EVIDENCE"
  linkageId: string
  componentIdentityId: string
  lunaProductId: string
  lunaVariantId: string | null
  lunaSku: string
  supplierQuantityRequired: number
  stockState: "CERTIFIED_OOS" | "IN_STOCK" | "STOCK_UNKNOWN"
  supplierStatedAvailability: boolean | null
  observedSupplierQuantity: number | null
  quantityExplicit: boolean
  safeSalesCapacity: number | null
  certifiedOos: boolean
  observedAt: string
  evidenceDigest: string
  limitationCode: string | null
  rawHtmlIncluded: false
  authenticationUsed: false
  sessionMaterialIncluded: false
  arbitraryUrlAccepted: false
  databaseWrites: 0
  ebayWrites: 0
  lunaWrites: 0
}>

function digest(value: unknown) {
  return `${SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1.toLowerCase()}:sha256:${
    createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function unknownObservation(input: Readonly<{
  target: Awaited<ReturnType<ReturnType<
    typeof createSellerOsCanonicalLunaServerReadResolverV1
  >>>
  observedAt: string
  sourceStatus: SellerOsLunaPublicExactStockObservationV1["sourceStatus"]
  limitationCode: string
}>): SellerOsLunaPublicExactStockObservationV1 {
  const evidence = {
    linkageId: input.target.linkageId,
    componentIdentityId: input.target.componentIdentityId,
    lunaProductId: input.target.lunaProductId,
    lunaVariantId: input.target.lunaVariantId,
    lunaSku: input.target.lunaSku,
    sourceStatus: input.sourceStatus,
    limitationCode: input.limitationCode,
    observedAt: input.observedAt,
  }
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
    source: SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1,
    sourceStatus: input.sourceStatus,
    linkageId: input.target.linkageId,
    componentIdentityId: input.target.componentIdentityId,
    lunaProductId: input.target.lunaProductId,
    lunaVariantId: input.target.lunaVariantId,
    lunaSku: input.target.lunaSku,
    supplierQuantityRequired: input.target.supplierQuantityRequired,
    stockState: "STOCK_UNKNOWN",
    supplierStatedAvailability: null,
    observedSupplierQuantity: null,
    quantityExplicit: false,
    safeSalesCapacity: null,
    certifiedOos: false,
    observedAt: input.observedAt,
    evidenceDigest: digest(evidence),
    limitationCode: input.limitationCode,
    rawHtmlIncluded: false,
    authenticationUsed: false,
    sessionMaterialIncluded: false,
    arbitraryUrlAccepted: false,
    databaseWrites: 0,
    ebayWrites: 0,
    lunaWrites: 0,
  })
}

function classifyVariant(input: Readonly<{
  variant: PublicVariantEvidence
  supplierQuantityRequired: number
}>) {
  const explicit = input.variant.sourceInventoryQuantityExplicit === true
  const quantity = explicit ? input.variant.sourceInventoryQuantity : null
  if (explicit && (!Number.isSafeInteger(quantity) || Number(quantity) < 0)) {
    return null
  }
  const boundedQuantity = explicit ? Number(quantity) : null
  const marker = input.variant.availabilityMarker ??
    (input.variant.available === false ? "OUT_OF_STOCK" :
      input.variant.available === true ? "IN_STOCK" : null)
  const explicitOos = marker === "SOLD_OUT" || marker === "OUT_OF_STOCK"
  const explicitInStock = marker === "IN_STOCK" || marker === "AVAILABLE"
  if ((explicitOos && (input.variant.available === true ||
      (boundedQuantity !== null && boundedQuantity > 0))) ||
      (explicitInStock && (input.variant.available === false ||
        boundedQuantity === 0))) {
    return null
  }
  if (explicitOos || boundedQuantity === 0) {
    return Object.freeze({
      stockState: "CERTIFIED_OOS" as const,
      supplierStatedAvailability: false,
      observedSupplierQuantity: boundedQuantity,
      quantityExplicit: explicit,
      safeSalesCapacity: 0,
      certifiedOos: true,
    })
  }
  if (boundedQuantity !== null) {
    return Object.freeze({
      stockState: "IN_STOCK" as const,
      supplierStatedAvailability: true,
      observedSupplierQuantity: boundedQuantity,
      quantityExplicit: true,
      safeSalesCapacity: Math.floor(
        boundedQuantity / input.supplierQuantityRequired,
      ),
      certifiedOos: false,
    })
  }
  if (explicitInStock || input.variant.available === true) {
    return Object.freeze({
      stockState: "IN_STOCK" as const,
      supplierStatedAvailability: true,
      observedSupplierQuantity: null,
      quantityExplicit: false,
      safeSalesCapacity: null,
      certifiedOos: false,
    })
  }
  return Object.freeze({
    stockState: "STOCK_UNKNOWN" as const,
    supplierStatedAvailability: null,
    observedSupplierQuantity: null,
    quantityExplicit: false,
    safeSalesCapacity: null,
    certifiedOos: false,
  })
}

function sourceFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (/CLOUDFLARE|CAPTCHA/.test(code)) return "CLOUDFLARE_CHALLENGE"
  if (/LOGIN|AUTH_REQUIRED|REAUTH/.test(code)) return "LOGIN_REQUIRED"
  if (/REDIRECT|FETCH_3\d\d/.test(code)) return "REDIRECT_REJECTED"
  if (/INVALID|MALFORMED|VARIANT_REQUIRED|PRODUCT_REQUIRED/.test(code)) {
    return "MALFORMED_PUBLIC_PRODUCT"
  }
  return "PUBLIC_SOURCE_UNAVAILABLE"
}

/**
 * Bounded public stock authority. The caller supplies no URL: the exact Luna
 * URL and product/variant identity are resolved from a certified linkage.
 */
export function createSellerOsLunaPublicExactStockAuthorityV1(input: Readonly<{
  loadLinkageById: (linkageId: string) => Promise<CertifiedLinkage | null>
  readFixedProduct?: (canonicalSourceUrl: string) => Promise<PublicProductEvidence>
  now?: () => string
}>) {
  const resolveTarget = createSellerOsCanonicalLunaServerReadResolverV1({
    loadLinkageById: input.loadLinkageById,
  })
  const readFixedProduct = input.readFixedProduct ??
    ((canonicalSourceUrl: string) =>
      fetchPublicLunaProductForActiveListingMonitor(canonicalSourceUrl))
  return async function read(request: Readonly<{
    linkageId: string
    componentIdentityId: string
  }>): Promise<SellerOsLunaPublicExactStockObservationV1> {
    const target = await resolveTarget(request)
    const observedAt = input.now?.() ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(observedAt))) {
      throw new Error("LUNA_PUBLIC_EXACT_STOCK_CLOCK_INVALID")
    }
    let product: PublicProductEvidence
    try {
      product = await readFixedProduct(target.canonicalSourceUrl)
    } catch (error) {
      const limitationCode = sourceFailureCode(error)
      return unknownObservation({
        target,
        observedAt: new Date(observedAt).toISOString(),
        sourceStatus: limitationCode === "MALFORMED_PUBLIC_PRODUCT"
          ? "MALFORMED_EVIDENCE" : "SOURCE_UNAVAILABLE",
        limitationCode,
      })
    }
    if (!product || product.sourceMode !== "PUBLIC_READ_ONLY_PRODUCT_PAGE" ||
        product.productId !== target.lunaProductId ||
        product.canonicalUrl !== target.canonicalSourceUrl ||
        !Array.isArray(product.variants) || product.variants.length > 500) {
      return unknownObservation({
        target,
        observedAt: new Date(observedAt).toISOString(),
        sourceStatus: "IDENTITY_MISMATCH",
        limitationCode: "EXACT_PRODUCT_IDENTITY_MISMATCH",
      })
    }
    const exactVariants = product.variants.filter((candidate) =>
      candidate.sku === target.lunaSku &&
      (target.lunaVariantId === null || candidate.id === target.lunaVariantId))
    if (exactVariants.length !== 1) {
      return unknownObservation({
        target,
        observedAt: new Date(observedAt).toISOString(),
        sourceStatus: "IDENTITY_MISMATCH",
        limitationCode: "EXACT_VARIANT_IDENTITY_MISMATCH",
      })
    }
    const variant = exactVariants[0]
    const classified = classifyVariant({
      variant,
      supplierQuantityRequired: target.supplierQuantityRequired,
    })
    if (!classified) {
      return unknownObservation({
        target,
        observedAt: new Date(observedAt).toISOString(),
        sourceStatus: "MALFORMED_EVIDENCE",
        limitationCode: "PUBLIC_STOCK_EVIDENCE_CONFLICT_OR_MALFORMED",
      })
    }
    const evidence = {
      linkageId: target.linkageId,
      componentIdentityId: target.componentIdentityId,
      lunaProductId: target.lunaProductId,
      lunaVariantId: target.lunaVariantId,
      lunaSku: target.lunaSku,
      available: classified.supplierStatedAvailability,
      quantity: classified.observedSupplierQuantity,
      stockState: classified.stockState,
      parserVersion: product.sourceParserVersion ?? null,
      observedAt: new Date(observedAt).toISOString(),
    }
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
      source: SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1,
      sourceStatus: "AVAILABLE",
      linkageId: target.linkageId,
      componentIdentityId: target.componentIdentityId,
      lunaProductId: target.lunaProductId,
      lunaVariantId: target.lunaVariantId,
      lunaSku: target.lunaSku,
      supplierQuantityRequired: target.supplierQuantityRequired,
      ...classified,
      observedAt: evidence.observedAt,
      evidenceDigest: digest(evidence),
      limitationCode: classified.stockState === "IN_STOCK" &&
        classified.safeSalesCapacity === null
        ? "NUMERIC_SAFE_CAPACITY_UNPROVEN" :
        classified.stockState === "STOCK_UNKNOWN"
          ? "PUBLIC_STOCK_MARKER_MISSING_OR_AMBIGUOUS" : null,
      rawHtmlIncluded: false,
      authenticationUsed: false,
      sessionMaterialIncluded: false,
      arbitraryUrlAccepted: false,
      databaseWrites: 0,
      ebayWrites: 0,
      lunaWrites: 0,
    })
  }
}

export function evaluateSellerOsLunaPublicExactBundleCapacityV1(
  components: readonly Readonly<{
    componentIdentityId: string
    mandatory: boolean
    observation: SellerOsLunaPublicExactStockObservationV1
  }>[],
) {
  if (!Array.isArray(components) || !components.length ||
      components.some((component) => !component.componentIdentityId ||
        component.mandatory !== true || !component.observation)) {
    throw new Error("LUNA_PUBLIC_EXACT_BUNDLE_COMPONENTS_INVALID")
  }
  const outOfStock = components.filter((component) =>
    component.mandatory && component.observation.certifiedOos &&
    component.observation.safeSalesCapacity === 0)
  if (outOfStock.length) {
    return Object.freeze({
      bundleStockState: "CERTIFIED_OOS" as const,
      safeSalesCapacity: 0,
      certifiedOos: true,
      limitingComponentIdentityIds: Object.freeze(
        outOfStock.map((component) => component.componentIdentityId).sort(),
      ),
      databaseWrites: 0 as const,
      ebayWrites: 0 as const,
      lunaWrites: 0 as const,
    })
  }
  const capacities = components.map((component) =>
    component.observation.safeSalesCapacity)
  const capacityProven = capacities.every((capacity) =>
    Number.isSafeInteger(capacity) && Number(capacity) >= 0)
  return Object.freeze({
    bundleStockState: components.every((component) =>
      component.observation.stockState === "IN_STOCK")
      ? "IN_STOCK" as const : "STOCK_UNKNOWN" as const,
    safeSalesCapacity: capacityProven
      ? Math.min(...capacities.map(Number)) : null,
    certifiedOos: false,
    limitingComponentIdentityIds: Object.freeze([] as string[]),
    databaseWrites: 0 as const,
    ebayWrites: 0 as const,
    lunaWrites: 0 as const,
  })
}
