const productListSelectorContract = {
  mode: "READ_ONLY_PRODUCT_SELECTOR",
  recommendedReadFunction: "getProducts",
  liveProductReadEnabled: false,
  readOnly: true,
  productsRemainSourceOfTruth: true,
  listingUsesFactsByReference: true,
  productFactsDuplicatedAsTruth: false,
}

const selectedProductReadOnlyPreview = {
  previewMode: "READ_ONLY_SELECTED_PRODUCT_REFERENCE",
  productId: "PRODUCT-SOURCE-DRYRUN-001",
  source: "fixture_fallback_until_live_read_enabled",
  productName: "Storage Organizer",
  supplier: "Portex",
  liveProductReadEnabled: false,
  readyForDraft: false,
  readyForPublication: false,
}

export function getLiveProductSelectorSummary() {
  return {
    selectorVersion:
      "EBAY_LIVE_PRODUCT_SELECTOR_READ_ONLY_V1",
    readOnly: true,
    liveProductSelectorContractCreated: true,
    liveProductReadEnabled: false,
    productsRemainSourceOfTruth: true,
    listingUsesFactsByReference: true,
    productFactsDuplicatedAsTruth: false,
    productMutationAllowed: false,
    readyForDraft: false,
    readyForPublication: false,
  }
}

export function getProductListSelectorContract() {
  return {
    ...productListSelectorContract,
  }
}

export function getSelectedProductReadOnlyPreview() {
  return {
    ...selectedProductReadOnlyPreview,
  }
}

export function getBlockedLiveProductSelectorResponse() {
  return {
    blocked: true,
    readOnly: true,
    productsRemainSourceOfTruth: true,
    listingUsesFactsByReference: true,
    productFactsDuplicatedAsTruth: false,
    liveProductReadEnabled: false,
    productMutationAllowed: false,
    readyForDraft: false,
    readyForPublication: false,
    draftImpact: "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact: "DO_NOT_PUBLISH",
  }
}
