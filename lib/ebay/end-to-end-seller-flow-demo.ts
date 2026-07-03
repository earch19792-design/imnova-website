const sellerFlowSteps = [
  {
    step:
      1,
    stage:
      "Market Radar",
    label:
      "Find opportunity signal",
    status:
      "DEMO_READY",
    responsibility:
      "Detect market/product signals.",
  },
  {
    step:
      2,
    stage:
      "eBay Pipeline",
    label:
      "Validate if worth selling",
    status:
      "DEMO_READY",
    responsibility:
      "Evaluate profitability, demand, competition and risk.",
  },
  {
    step:
      3,
    stage:
      "Products",
    label:
      "Confirm product truth",
    status:
      "DEMO_READY",
    responsibility:
      "Confirm what the product is.",
  },
  {
    step:
      4,
    stage:
      "Listing",
    label:
      "Prepare how it sells",
    status:
      "DEMO_READY",
    responsibility:
      "Generate internal listing package, content, image plan and payload dry run.",
  },
  {
    step:
      5,
    stage:
      "Review/Gates",
    label:
      "Approve or block advancement",
    status:
      "DEMO_READY",
    responsibility:
      "Human review and safety gates before any external action.",
  },
]

export function getSellerFlowSteps() {
  return sellerFlowSteps
}

export function getDemoPipelineCommercialSignal() {
  return {
    signalMode:
      "PIPELINE_DECISION_BY_REFERENCE",
    source:
      "eBay Winner Pipeline",
    pipelineDecision:
      "candidate_for_listing",
    profitStatus:
      "needs_final_price_cost_confirmation",
    winnerScore:
      82,
    riskStatus:
      "review_required",
    listingUsesPipelineDecisionByReference:
      true,
    listingDuplicatesProfitabilityTruth:
      false,
    listingRecalculatesProfitability:
      false,
    missingPipelineData: [
      "final_cost",
      "shipping_cost",
      "return_policy",
      "confirmed_sell_through_rate",
    ],
    pipelineRecommendation:
      "Prepare listing internally, but keep publication blocked until commercial facts and gates are approved.",
  }
}

export function getEndToEndDemoReadiness() {
  return {
    internalSellerFlowReady:
      true,
    completeListingPackageAvailable:
      true,
    secondaryImagePromptCount:
      6,
    draftPayloadDryRunAvailable:
      true,
    readyForInternalHumanReview:
      true,
    readyForRealImageExecution:
      true,
    readyForEbaySandbox:
      false,
    readyForDraftCreation:
      false,
    readyForPublication:
      false,
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
  }
}

export function getEndToEndSellerFlowDemo() {
  return {
    demoVersion:
      "EBAY_END_TO_END_SELLER_FLOW_DEMO_V1",
    caseId:
      "SELLER-FLOW-DEMO-001",
    marketplace:
      "ebay_us",
    language:
      "en",
    demoStatus:
      "END_TO_END_INTERNAL_SELLER_FLOW_READY",
    flowMode:
      "INTERNAL_READ_ONLY_DEMO",
    flowLabel:
      "Market Radar to Listing Review",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    demoSummary:
      "This demo validates the internal seller flow from opportunity discovery to listing review. It does not create drafts, publish listings, generate images, upload images or call eBay. It shows how a candidate product moves from Market Radar/eBay Pipeline into Products, Listing Package and Review/Gates.",
    sellerFlowSteps:
      getSellerFlowSteps(),
    demoProductCandidate: {
      source:
        "safe_demo_candidate",
      productName:
        "Storage Organizer",
      supplier:
        "Portex",
      productSlug:
        "storage-organizer-demo",
      catalogImageSource:
        "Luna Portex catalog image required",
      productMutationUsed:
        false,
    },
    pipelineCommercialSignal:
      getDemoPipelineCommercialSignal(),
    productsConfirmation: {
      productsRule:
        "Products confirms what the product is.",
      productConfirmedForDemo:
        true,
      factsConfirmed: [
        "product_name",
        "supplier",
      ],
      factsStillMissing: [
        "dimensions",
        "weight",
        "material",
        "price",
        "shipping_policy",
        "return_policy",
      ],
      productFactsDuplicatedAsTruth:
        false,
    },
    listingPackageResult: {
      listingRule:
        "Listing prepares how the product sells on eBay.",
      completeListingPackageAvailable:
        true,
      titlePreviewAvailable:
        true,
      descriptionPreviewAvailable:
        true,
      secondaryImagePromptsAvailable:
        true,
      secondaryImagePromptCount:
        6,
      draftPayloadDryRunAvailable:
        true,
      realImagesGenerated:
        false,
      imageUploadUsed:
        false,
      draftPayloadSubmitted:
        false,
    },
    reviewGateResult: {
      reviewRule:
        "Review and Gates approve whether the listing can advance.",
      readyForInternalHumanReview:
        true,
      readyForRealImageExecution:
        true,
      readyForEbaySandbox:
        false,
      readyForDraftCreation:
        false,
      readyForPublication:
        false,
      humanApprovalRequired:
        true,
      blockingIssues: [
        "real_images_not_generated",
        "image_qa_not_approved",
        "price_not_confirmed",
        "shipping_policy_not_confirmed",
        "return_policy_not_confirmed",
        "ebay_sandbox_not_authorized",
        "oauth_not_configured",
        "draft_creation_blocked",
        "publication_blocked",
      ],
    },
    whatWorksNow: [
      "Market Radar to Pipeline conceptual flow is visible.",
      "Pipeline to Listing intake is available as read-only context pass-through.",
      "Complete Listing Package can be generated internally.",
      "6 secondary image prompts can be prepared.",
      "Draft payload dry run can be built locally.",
      "Review/Gates can show blockers.",
    ],
    whatStillBlocksEbay: [
      "Real Luna Portex catalog image execution.",
      "Real image generation and QA.",
      "Price, cost, shipping and return policy confirmation.",
      "eBay Developer/Sandbox authorization.",
      "OAuth and tokens.",
      "Real eBay draft creation.",
      "Publication approval.",
    ],
    nextRecommendedPhase: {
      phase:
        "PHASE 2 — Real Image Execution from Luna Portex Catalog",
      goal:
        "Generate the actual 7-image listing package from a Luna Portex catalog source image for one selected product before eBay Sandbox.",
      firstStep:
        "Select one Luna Portex product with catalog image and run image generation/QA outside eBay.",
      then:
        "Only after image QA and business gates pass, proceed to eBay Sandbox integration.",
    },
    safetyFlags: {
      internalDemoOnly:
        true,
      readOnly:
        true,
      pipelineDecisionByReference:
        true,
      listingDuplicatesProfitabilityTruth:
        false,
      productMutationUsed:
        false,
      listingMutationUsed:
        false,
      ebayApiUsed:
        false,
      oauthUsed:
        false,
      tokensUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      imageGenerationUsed:
        false,
      imageUploadUsed:
        false,
      supabaseWriteUsed:
        false,
      migrationCreated:
        false,
    },
  }
}

export function getBlockedEndToEndSellerFlowResponse() {
  return {
    demoVersion:
      "EBAY_END_TO_END_SELLER_FLOW_DEMO_V1",
    demoStatus:
      "END_TO_END_INTERNAL_SELLER_FLOW_READY",
    flowMode:
      "INTERNAL_READ_ONLY_DEMO",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
    canGenerateRealImages:
      false,
    canUploadImages:
      false,
  }
}
