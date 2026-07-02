import productListingBridge from "../../tools/fixtures/ebay-product-to-listing-bridge-draft-preview-v1.json"

export function getProductToEbayListingBridgeSummary() {
  return {
    bridgeStatus:
      productListingBridge.bridgeStatus,
    bridgeDecision:
      productListingBridge.bridgeDecision,
    previewStatus:
      productListingBridge.previewStatus,
    dryRunOnly:
      true,
    bridgeReady:
      true,
    previewGenerated:
      true,
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    unconfirmedFactsBlocked:
      true,
    readyForDraft:
      false,
    readyForPublication:
      false,
    readinessScore:
      productListingBridge.gateResult.readinessScore,
  }
}

export function getGeneratedListingDraftPreviewDryRun() {
  return {
    dryRunOnly:
      true,
    previewGenerated:
      true,
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    titleCandidate:
      productListingBridge.generatedListingDraftPreview.titleCandidate,
    descriptionDraft:
      productListingBridge.generatedListingDraftPreview.descriptionDraft,
    itemSpecificsDraft:
      productListingBridge.generatedListingDraftPreview.itemSpecificsDraft,
    blockedUnconfirmedFacts:
      productListingBridge.blockedUnconfirmedFacts,
  }
}

export function getBlockedProductToListingBridgeResponse() {
  return {
    ok:
      false,
    blocked:
      true,
    dryRunOnly:
      true,
    bridgeReady:
      true,
    previewGenerated:
      true,
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    unconfirmedFactsBlocked:
      true,
    readyForDraft:
      false,
    readyForPublication:
      false,
    draftImpact:
      productListingBridge.draftImpact,
    publicationImpact:
      productListingBridge.publicationImpact,
    gateResult:
      productListingBridge.gateResult,
    requiredHumanActions:
      productListingBridge.requiredHumanActions,
  }
}
