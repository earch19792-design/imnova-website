export const SELLER_OS_COMMERCIAL_DECISION_LOOP_VERSION =
  "SELLER_OS_COMMERCIAL_DECISION_LOOP_V1_1" as const

export type CommercialDecisionLoopStateV1_1 = "ANALYZING" | "REJECT" |
  "HOLD" | "APPROVED_FOR_PUBLICATION" | "LISTING_PACKAGE_READY" |
  "PREPUBLISH_CHECK" | "PUBLISHED" | "READBACK_VERIFIED"

export type CommercialPublicationReadinessInputV1_1 = Readonly<{
  analysisComplete: boolean
  finalDecision: string | null
  productTruthSufficient: boolean
  safeClaimsPresent: boolean
  stockValid: boolean
  shippingQty1Fresh: boolean
  marketAuthoritySufficient: boolean
  pricingAuthoritySufficient: boolean
  economicsPass: boolean
  primaryKeywordComplete: boolean
  titleComplete: boolean
  itemSpecificsComplete: boolean
  imagesValid: boolean
  complianceClear: boolean
  ipClear: boolean
  listingPackageId?: string | null
  autoPublish?: boolean
}>

const REQUIREMENTS = Object.freeze([
  ["PRODUCT_TRUTH_SUFFICIENT", "productTruthSufficient"],
  ["SAFE_CLAIMS_PRESENT", "safeClaimsPresent"],
  ["STOCK_VALID", "stockValid"],
  ["SHIPPING_QTY1_FRESH", "shippingQty1Fresh"],
  ["MARKET_AUTHORITY_SUFFICIENT", "marketAuthoritySufficient"],
  ["PRICING_AUTHORITY_SUFFICIENT", "pricingAuthoritySufficient"],
  ["ECONOMICS_PASS", "economicsPass"],
  ["PRIMARY_KEYWORD_COMPLETE", "primaryKeywordComplete"],
  ["TITLE_COMPLETE", "titleComplete"],
  ["ITEM_SPECIFICS_COMPLETE", "itemSpecificsComplete"],
  ["IMAGES_VALID", "imagesValid"],
  ["COMPLIANCE_CLEAR", "complianceClear"],
  ["IP_CLEAR", "ipClear"],
] as const)

export function buildCommercialDecisionLoopSnapshotV1_1(
  input: CommercialPublicationReadinessInputV1_1,
) {
  const checks = REQUIREMENTS.map(([code, field]) => Object.freeze({
    code, passed: input[field] === true,
  }))
  const blockers = checks.filter((entry) => !entry.passed)
    .map((entry) => entry.code)
  let state: CommercialDecisionLoopStateV1_1 = "ANALYZING"
  if (input.analysisComplete) {
    if (String(input.finalDecision ?? "").startsWith("REJECT")) state = "REJECT"
    else if (String(input.finalDecision ?? "").startsWith("HOLD") ||
        input.finalDecision !== "ADVANCE_TO_OWNER_COMMERCIAL_REVIEW" ||
        blockers.length > 0) state = "HOLD"
    else state = "LISTING_PACKAGE_READY"
  }
  return Object.freeze({
    version: SELLER_OS_COMMERCIAL_DECISION_LOOP_VERSION,
    state,
    previousStates: Object.freeze(state === "LISTING_PACKAGE_READY"
      ? ["ANALYZING", "APPROVED_FOR_PUBLICATION"] as const
      : ["ANALYZING"] as const),
    checks: Object.freeze(checks), blockers: Object.freeze(blockers),
    autoPublish: input.autoPublish === true,
    listingPackageId: input.listingPackageId ?? null,
    ownerCta: state === "LISTING_PACKAGE_READY" && input.autoPublish !== true
      ? Object.freeze({ label: "Publicar producto",
          href: input.listingPackageId
            ? `/admin/ebay/publish?listingPackageId=${encodeURIComponent(input.listingPackageId)}`
            : "/admin/ebay/publish" }) : null,
    publicationWritesPerformed: 0,
    ebayWritesPerformed: 0,
    purchaseAllowed: false,
  })
}

export async function executeCommercialDecisionLoopV1_1(input:
  CommercialPublicationReadinessInputV1_1 & Readonly<{
    publicationWritesEnabled: boolean
    preflight: () => Promise<Readonly<{ passed: boolean; reason?: string }>>
    publish: () => Promise<Readonly<{ itemId: string }>>
    readback: (itemId: string) => Promise<Readonly<{ verified: boolean }>>
  }>) {
  const snapshot = buildCommercialDecisionLoopSnapshotV1_1(input)
  if (snapshot.state !== "LISTING_PACKAGE_READY" || !snapshot.autoPublish) {
    return snapshot
  }
  const preflight = await input.preflight()
  if (!preflight.passed) return Object.freeze({ ...snapshot, state: "HOLD" as const,
    previousStates: Object.freeze([...snapshot.previousStates,
      "LISTING_PACKAGE_READY", "PREPUBLISH_CHECK"] as const),
    blockers: Object.freeze([...snapshot.blockers,
      preflight.reason || "PREPUBLISH_CHECK_FAILED"]) })
  if (!input.publicationWritesEnabled) return Object.freeze({ ...snapshot,
    state: "HOLD" as const,
    previousStates: Object.freeze([...snapshot.previousStates,
      "LISTING_PACKAGE_READY", "PREPUBLISH_CHECK"] as const),
    blockers: Object.freeze([...snapshot.blockers,
      "PUBLICATION_WRITES_DISABLED"]) })
  const publication = await input.publish()
  const readback = await input.readback(publication.itemId)
  return Object.freeze({ ...snapshot,
    state: readback.verified ? "READBACK_VERIFIED" as const
      : "PUBLISHED" as const,
    previousStates: Object.freeze([...snapshot.previousStates,
      "LISTING_PACKAGE_READY", "PREPUBLISH_CHECK", "PUBLISHED"] as const),
    itemId: publication.itemId,
    publicationWritesPerformed: 1,
    ebayWritesPerformed: 1,
    readbackVerified: readback.verified,
  })
}
