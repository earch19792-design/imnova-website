export const EBAY_LUNA_IDENTITY_COMPARISON_VERSION =
  "EBAY-LUNA-IDENTITY-COMPARISON-V1"

export type LunaIdentityReference = {
  productName?: string | null
  productTitle?: string | null
  variantTitle?: string | null
  supplierSku?: string | null
  handle?: string | null
  productUrl?: string | null
}

export type EbayIdentityChecklist = {
  sameProductAndBrand: boolean
  sameVariantSizeOrPack: boolean
  compatibleReference: boolean
}

export type LunaEbayIdentityComparisonInput = {
  lunaCandidate?: LunaIdentityReference | null
  ebayListingUrl?: string | null
  ebayObservedTitle?: string | null
  ebayReferenceOpened?: boolean
  checklist?: Partial<EbayIdentityChecklist>
  confirmationRecorded?: boolean
}

export function getSafeEbayListingUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const ebayHost =
      url.hostname === "ebay.com" || url.hostname.endsWith(".ebay.com")
    const listingPath = /(^|\/)itm(\/|$)/i.test(url.pathname)
    return url.protocol === "https:" && ebayHost && listingPath
      ? url.href
      : null
  } catch {
    return null
  }
}

export function buildEbayIdentitySearchUrl(
  candidate: LunaIdentityReference | null | undefined
) {
  const query =
    candidate?.productName ?? candidate?.productTitle ?? candidate?.handle ?? ""
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`
}

export function buildLunaEbayIdentityComparison(
  input: LunaEbayIdentityComparisonInput
) {
  const lunaCandidate = input.lunaCandidate ?? null
  const safeEbayListingUrl = getSafeEbayListingUrl(input.ebayListingUrl)
  const ebayObservedTitle = input.ebayObservedTitle?.trim() ?? ""
  const checklist: EbayIdentityChecklist = {
    sameProductAndBrand: input.checklist?.sameProductAndBrand === true,
    sameVariantSizeOrPack: input.checklist?.sameVariantSizeOrPack === true,
    compatibleReference: input.checklist?.compatibleReference === true,
  }
  const checklistComplete = Object.values(checklist).every(Boolean)
  const canConfirmSameProduct = Boolean(
    lunaCandidate &&
      safeEbayListingUrl &&
      ebayObservedTitle &&
      input.ebayReferenceOpened &&
      checklistComplete
  )
  const identityComparisonComplete = Boolean(
    canConfirmSameProduct && input.confirmationRecorded
  )

  return {
    identityComparisonVersion: EBAY_LUNA_IDENTITY_COMPARISON_VERSION,
    comparisonSources: ["LUNA_PORTEX_CANDIDATE", "EBAY_LISTING_REFERENCE"],
    lunaIdentity: lunaCandidate
      ? {
          productName:
            lunaCandidate.productName ?? lunaCandidate.productTitle ?? null,
          variantTitle: lunaCandidate.variantTitle ?? null,
          supplierSku: lunaCandidate.supplierSku ?? null,
          handle: lunaCandidate.handle ?? null,
          productUrl: lunaCandidate.productUrl ?? null,
        }
      : null,
    ebayIdentity: {
      listingUrl: safeEbayListingUrl,
      observedTitle: ebayObservedTitle || null,
      referenceOpened: input.ebayReferenceOpened === true,
    },
    checklist,
    checklistComplete,
    canConfirmSameProduct,
    confirmationRecorded: input.confirmationRecorded === true,
    identityComparisonComplete,
    confirmationSource: identityComparisonComplete
      ? "HUMAN_LUNA_EBAY_COMPARISON"
      : null,
    pendingGuards: identityComparisonComplete
      ? []
      : ["NEED_EBAY_IDENTITY_REFERENCE"],
    canProceedToB2RunPreflight: false,
    canPublish: false,
    ebayApiUsed: false,
    ebayWriteUsed: false,
  }
}
