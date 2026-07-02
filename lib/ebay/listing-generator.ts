import listingGeneratorDryRun from "../../tools/fixtures/ebay-listing-generator-service-dry-run-v1.json"

const KEYWORD_POLICY =
  "USE_MARKET_INTELLIGENCE_DO_NOT_COPY_CONTENT"

export function getEbayListingGeneratorDryRunSummary() {
  return {
    generatorStatus:
      listingGeneratorDryRun.generatorStatus,
    generatorDecision:
      listingGeneratorDryRun.generatorDecision,
    dryRunMode:
      listingGeneratorDryRun.dryRunMode,
    dryRunOnly:
      true,
    structuredPlanGenerated:
      true,
    finalContentGenerated:
      false,
    blocked:
      true,
    readyForDraft:
      false,
    readyForPublication:
      false,
    keywordPolicy:
      KEYWORD_POLICY,
    blockedBecause:
      listingGeneratorDryRun.blockedBecause,
  }
}

export function getEbayListingGeneratorArchitecturePolicy() {
  return {
    ...listingGeneratorDryRun.architecturePolicy,
    keywordPolicy:
      KEYWORD_POLICY,
  }
}

export function getBlockedEbayListingGeneratorResponse() {
  return {
    ok:
      false,
    blocked:
      true,
    dryRunOnly:
      true,
    structuredPlanGenerated:
      true,
    finalContentGenerated:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
    keywordPolicy:
      KEYWORD_POLICY,
    generatorStatus:
      listingGeneratorDryRun.generatorStatus,
    outputStatus:
      listingGeneratorDryRun.outputStatus,
    draftImpact:
      listingGeneratorDryRun.draftImpact,
    publicationImpact:
      listingGeneratorDryRun.publicationImpact,
    requiredHumanActions:
      listingGeneratorDryRun.requiredHumanActions,
    nextRecommendedLoop:
      listingGeneratorDryRun.nextRecommendedLoop.loop,
  }
}
