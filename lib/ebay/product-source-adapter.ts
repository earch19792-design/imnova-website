const productSelectorContract = {
  selectorMode: "READ_ONLY_SELECTOR_CONTRACT",
  selectionStatus: "NO_LIVE_PRODUCT_SELECTED",
  selectedProductId: "PRODUCT-SOURCE-DRYRUN-001",
  selectedProductSource: "SAFE_DRY_RUN_PRODUCT_REFERENCE",
  usesProductFactsByReference: true,
  productFactsDuplicatedAsTruth: false,
  generatorCanGeneratePreview: true,
  generatorCanGenerateFinalContent: false,
  readyForDraft: false,
  readyForPublication: false,
}

const selectedProductPreviewContract = {
  previewMode: "SAFE_DRY_RUN_PRODUCT_REFERENCE",
  productId: "PRODUCT-SOURCE-DRYRUN-001",
  productName: "Storage Organizer",
  productType: "storage organizer",
  condition: "New",
  packageQuantity: "1 Pack",
  supplier: "Portex",
  liveProductReadEnabled: false,
  usesProductFactsByReference: true,
  productFactsDuplicatedAsTruth: false,
}

export function getProductSourceAdapterSummary() {
  return {
    adapterVersion:
      "EBAY_PRODUCT_SOURCE_ADAPTER_SELECTOR_V1",
    readOnly: true,
    sourceAdapterOnly: true,
    productSelectorContractCreated: true,
    liveProductReadEnabled: false,
    sourceOfTruth:
      "PRODUCTS_MODULE_IS_SOURCE_OF_TRUTH",
    usesProductFactsByReference: true,
    productFactsDuplicatedAsTruth: false,
    generatorCanGeneratePreview: true,
    generatorCanGenerateFinalContent: false,
    readyForDraft: false,
    readyForPublication: false,
  }
}

export function getProductSelectorContract() {
  return {
    ...productSelectorContract,
  }
}

export function getSelectedProductPreviewContract() {
  return {
    ...selectedProductPreviewContract,
  }
}

export function getBlockedProductSourceAdapterResponse() {
  return {
    blocked: true,
    readOnly: true,
    sourceAdapterOnly: true,
    productSelectorContractCreated: true,
    liveProductReadEnabled: false,
    usesProductFactsByReference: true,
    productFactsDuplicatedAsTruth: false,
    unconfirmedFactsBlocked: true,
    generatorCanGeneratePreview: true,
    generatorCanGenerateFinalContent: false,
    readyForDraft: false,
    readyForPublication: false,
    draftImpact: "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact: "DO_NOT_PUBLISH",
  }
}
