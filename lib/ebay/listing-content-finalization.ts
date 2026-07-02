import firstListingContentFinalization from "../../tools/fixtures/ebay-first-listing-content-finalization-v1.json"

const KEYWORD_POLICY =
  "USE_MARKET_INTELLIGENCE_DO_NOT_COPY_CONTENT"

export function getFirstListingContentFinalizationSummary() {
  return {
    contentStatus:
      firstListingContentFinalization.contentStatus,
    contentDecision:
      firstListingContentFinalization.contentDecision,
    keywordPolicy:
      KEYWORD_POLICY,
    contentReady:
      false,
    draftReady:
      false,
    blocked:
      true,
    sectionCount:
      firstListingContentFinalization.contentSections.length,
    blockedBecause:
      firstListingContentFinalization.blockedBecause,
    nextAction:
      firstListingContentFinalization.nextRecommendedAction,
  }
}

export function getKeywordIntelligencePolicySummary() {
  return {
    keywordPolicy:
      KEYWORD_POLICY,
    policyStatus:
      firstListingContentFinalization.keywordIntelligencePolicy
        .policyStatus,
    coreRule:
      firstListingContentFinalization.keywordIntelligencePolicy
        .coreRule,
    allowed:
      firstListingContentFinalization.keywordIntelligencePolicy
        .allowed,
    blocked:
      firstListingContentFinalization.keywordIntelligencePolicy
        .blocked,
    trafficKeywordsAllowedWhenGenericRelevantAndTrue:
      firstListingContentFinalization.safetyFlags
        .trafficKeywordsAllowedWhenGenericRelevantAndTrue,
    portexFactsRequiredForTechnicalClaims:
      firstListingContentFinalization.safetyFlags
        .portexFactsRequiredForTechnicalClaims,
  }
}

export function getBlockedContentFinalizationResponse() {
  return {
    ok:
      false,
    blocked:
      true,
    contentReady:
      false,
    draftReady:
      false,
    keywordPolicy:
      KEYWORD_POLICY,
    contentStatus:
      firstListingContentFinalization.contentStatus,
    draftImpact:
      firstListingContentFinalization.draftImpact,
    publicationImpact:
      firstListingContentFinalization.publicationImpact,
    blockedBecause:
      firstListingContentFinalization.blockedBecause,
    requiredHumanActions:
      firstListingContentFinalization.requiredHumanActions,
    nextAction:
      firstListingContentFinalization.nextRecommendedAction,
  }
}
