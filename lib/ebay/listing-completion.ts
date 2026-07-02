import listingCompletionWorkspace from "../../tools/fixtures/ebay-listing-completion-workspace-v1.json"
import draftMappingDryRun from "../../tools/fixtures/ebay-draft-mapping-dry-run-v1.json"

export function getListingCompletionSummary() {
  return {
    workspaceStatus:
      listingCompletionWorkspace.workspaceStatus,
    workspaceDecision:
      listingCompletionWorkspace.workspaceDecision,
    readyForDraft:
      false,
    readyForPublication:
      false,
    blocked:
      true,
    missingCriticalInputs:
      listingCompletionWorkspace.missingCriticalInputs,
    blockingSections:
      listingCompletionWorkspace.readinessSections
        .filter((section) => section.blocking)
        .map((section) => ({
          sectionId:
            section.sectionId,
          label:
            section.label,
          status:
            section.status,
        })),
    nextAction:
      listingCompletionWorkspace.nextRecommendedAction,
  }
}

export function getDraftMappingDryRunSummary() {
  return {
    mappingStatus:
      draftMappingDryRun.mappingStatus,
    mappingDecision:
      draftMappingDryRun.mappingDecision,
    readyForDraft:
      false,
    readyForPublication:
      false,
    blocked:
      true,
    plannedFieldCount:
      draftMappingDryRun.plannedEbayDraftFields.length,
    mappedFieldCount:
      draftMappingDryRun.plannedEbayDraftFields.filter(
        (field) => field.mapped
      ).length,
    plannedFields:
      draftMappingDryRun.plannedEbayDraftFields.map((field) => ({
        fieldId:
          field.fieldId,
        label:
          field.label,
        mapped:
          field.mapped,
        sourceReady:
          field.sourceReady,
      })),
    blockedBecause:
      draftMappingDryRun.blockedBecause,
    nextAction:
      draftMappingDryRun.dryRunDecision.nextAction,
  }
}

export function getBlockedDraftReadinessResponse() {
  return {
    ok:
      false,
    blocked:
      true,
    readyForDraft:
      false,
    readyForPublication:
      false,
    draftImpact:
      listingCompletionWorkspace.draftImpact,
    publicationImpact:
      listingCompletionWorkspace.publicationImpact,
    missingCriticalInputs:
      listingCompletionWorkspace.missingCriticalInputs,
    blockedBecause:
      draftMappingDryRun.blockedBecause,
    nextAction:
      listingCompletionWorkspace.nextRecommendedAction,
  }
}
