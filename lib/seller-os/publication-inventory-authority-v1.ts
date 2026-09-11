import { createHash } from "node:crypto"
import { keywordRecord as record } from "./keyword-intelligence-handoff-v1"

// Availability describes the supplier. The existing package review separately
// authorizes listing exposure; it never proves supplier quantity.
export function publicationInventoryAuthorityV1(input: {
  availability: unknown; numericStock: unknown; exactBinding: boolean; now: Date;
  packageId: string; sku: string; productId: string; variantId: string;
  quantityReview?: unknown; currentQuantityMaterial?: unknown;
}) {
  const f = record(input.availability), stock = record(input.numericStock)
  const evidence = (v: Record<string, unknown>) => ["PROVEN", "STALE"].includes(String(v.EVIDENCE_STATUS)) &&
    v.CONTRADICTION === false && v.SEMANTIC_CLASS === "FACT" &&
    ["SUPPLIER", "OWNER"].includes(String(v.SOURCE_AUTHORITY)) &&
    Boolean(v.EVIDENCE_ID && v.SOURCE_LOCATOR_OR_FIELD)
  const observedAt = Date.parse(String(f.OBSERVED_AT ?? f.CAPTURED_AT))
  const expires = Date.parse(String(f.FRESH_UNTIL))
  const valid = input.exactBinding && evidence(f) && Number.isFinite(observedAt) && observedAt <= input.now.getTime()
  const availability = valid && [true, "AVAILABLE", "IN_STOCK"].includes(f.VALUE as string | boolean) ? "IN_STOCK" :
    valid && [false, "UNAVAILABLE", "OUT_OF_STOCK"].includes(f.VALUE as string | boolean) ? "OUT_OF_STOCK" : "UNKNOWN"
  const freshness = valid && Number.isFinite(expires) && expires > observedAt ?
    expires > input.now.getTime() ? "FRESH" : "STALE" : "UNKNOWN"
  const numericFresh = evidence(stock) && Date.parse(String(stock.FRESH_UNTIL)) > input.now.getTime() &&
    Date.parse(String(stock.OBSERVED_AT ?? stock.CAPTURED_AT)) <= input.now.getTime()
  const supplierQuantity = input.exactBinding && numericFresh && typeof stock.VALUE === "number" &&
    Number.isInteger(stock.VALUE) && stock.VALUE >= 0 ? stock.VALUE : null
  const review = record(input.quantityReview), material = record(input.currentQuantityMaterial)
  const lineage = record(material.exactProductLineage), reviewedLineage = record(review.exactProductLineage)
  const materialDigest = `sha256:${createHash("sha256").update(JSON.stringify(material)).digest("hex")}`
  const quantity = review.authorizedQuantity
  const policyValid = review.contractVersion === "QUICK_PICK_REMOTE_OWNER_REVIEW_V1" &&
    review.status === "CONFIRMED" && Boolean(review.reviewedBy) &&
    Date.parse(String(review.reviewedAt)) <= input.now.getTime() &&
    review.materialPackageDigestVersion === "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1" &&
    review.materialPackageChangeInvalidatesAuthorization === true &&
    material.contractVersion === "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1" &&
    review.reviewedPackageDigest === materialDigest &&
    review.authorizedPackageId === input.packageId && material.listingPackageId === input.packageId &&
    review.authorizedSku === input.sku && lineage.supplierSku === input.sku && reviewedLineage.supplierSku === input.sku &&
    lineage.lunaProductId === input.productId && reviewedLineage.lunaProductId === input.productId &&
    lineage.lunaVariantId === input.variantId && reviewedLineage.lunaVariantId === input.variantId &&
    /^sha256:[a-f0-9]{64}$/.test(String(lineage.productTruthDigest)) &&
    lineage.productTruthDigest === reviewedLineage.productTruthDigest &&
    typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0 && material.quantity === quantity
  const contradictory = supplierQuantity !== null && (availability === "IN_STOCK" && supplierQuantity === 0 ||
    availability === "OUT_OF_STOCK" && supplierQuantity > 0)
  const ready = input.exactBinding && availability === "IN_STOCK" && freshness === "FRESH" &&
    !contradictory && policyValid && (supplierQuantity === null || supplierQuantity >= Number(quantity))
  const reason = contradictory ? "CONTRADICTORY_STOCK_EVIDENCE" : freshness === "STALE" ? "WAITING_FOR_REFRESH" :
    freshness !== "FRESH" || availability === "UNKNOWN" ? "AVAILABILITY_EVIDENCE_PENDING" :
    availability === "OUT_OF_STOCK" ? "OUT_OF_STOCK" : !policyValid ? "LISTING_QUANTITY_POLICY_REVALIDATION_REQUIRED" :
    !ready ? "LISTING_QUANTITY_EXCEEDS_PROVEN_CAPACITY" : null
  return { contractVersion: "LUNA_AVAILABILITY_WITH_SEPARATE_PACKAGE_EXPOSURE_V1", availability, freshness,
    supplierNumericQuantityRequired: false, supplierQuantity, supplierAvailabilityAuthorityValid: valid && availability !== "UNKNOWN",
    listingQuantity: policyValid ? quantity as number : null, inventoryReady: ready, reason,
    quantityPolicy: { source: "QUICK_PICK_REMOTE_OWNER_REVIEW_V1", valid: policyValid,
      reference: policyValid ? materialDigest : null, supplierQuantityInferred: false },
    observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null,
    freshUntil: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
    reference: typeof f.EVIDENCE_ID === "string" ? f.EVIDENCE_ID : null }
}
