import firstListingDraftPreview from "../../tools/fixtures/ebay-first-listing-draft-preview-v1.json"

export function getFirstEbayListingDraftPreviewSummary() {
  return {
    draftPreviewStatus:
      firstListingDraftPreview.draftPreviewStatus,
    draftPreviewDecision:
      firstListingDraftPreview.draftPreviewDecision,
    previewMode:
      firstListingDraftPreview.previewMode,
    dryRunOnly:
      true,
    previewGenerated:
      true,
    titleCandidate:
      "Storage Organizer, New, 1 Pack",
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    unconfirmedFactsBlocked:
      true,
    readyForDraftPayload:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
    readinessScore:
      35,
  }
}

export function getFirstEbayListingDraftPreview() {
  return {
    dryRunOnly:
      true,
    previewGenerated:
      true,
    titleCandidate:
      "Storage Organizer, New, 1 Pack",
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    unconfirmedFactsBlocked:
      true,
    readyForDraftPayload:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
    readinessScore:
      35,
    generatedListingPreview:
      firstListingDraftPreview.generatedListingPreview,
    blockedFields:
      firstListingDraftPreview.blockedFields,
    missingInputs:
      firstListingDraftPreview.missingInputs,
  }
}

export function getBlockedFirstEbayListingDraftPreviewResponse() {
  return {
    ok:
      false,
    blocked:
      true,
    dryRunOnly:
      true,
    previewGenerated:
      true,
    titleCandidate:
      "Storage Organizer, New, 1 Pack",
    publishable:
      false,
    finalContentGenerated:
      false,
    usesConfirmedFactsOnly:
      true,
    unconfirmedFactsBlocked:
      true,
    readyForDraftPayload:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
    readinessScore:
      35,
    draftImpact:
      firstListingDraftPreview.draftImpact,
    publicationImpact:
      firstListingDraftPreview.publicationImpact,
    gateResult:
      firstListingDraftPreview.gateResult,
    requiredHumanActions:
      firstListingDraftPreview.requiredHumanActions,
  }
}
