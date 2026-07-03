import {
  getCompleteListingPackage,
} from "./complete-listing-package-builder"

type WorkspaceOptions = {
  slug?: string | null
  productId?: string | null
}

type ReviewRecord = Record<string, unknown>

function asRecord(input: unknown): ReviewRecord {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return input as ReviewRecord
  }

  return {}
}

function readBoolean(
  record: ReviewRecord,
  key: string,
  fallback: boolean
) {
  return typeof record[key] === "boolean"
    ? record[key]
    : fallback
}

function checklistItem(
  id: string,
  label: string,
  status: string,
  input: ReviewRecord,
  requiredBeforeDraft = true,
  requiredBeforePublication = true
) {
  return {
    id,
    label,
    status:
      typeof input[id] === "string"
        ? input[id]
        : status,
    requiredBeforeDraft,
    requiredBeforePublication,
  }
}

export function buildApprovalChecklist(input?: unknown) {
  const record =
    asRecord(input)

  return [
    checklistItem(
      "product_facts_reviewed",
      "Product facts reviewed in Products",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "title_reviewed",
      "Title reviewed",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "description_reviewed",
      "Description reviewed",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "item_specifics_reviewed",
      "Item specifics reviewed",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "category_confirmed",
      "Category confirmed",
      "BLOCKED_UNTIL_CONFIRMED",
      record
    ),
    checklistItem(
      "price_confirmed",
      "Price confirmed",
      "BLOCKED_UNTIL_CONFIRMED",
      record
    ),
    checklistItem(
      "shipping_policy_confirmed",
      "Shipping policy confirmed",
      "BLOCKED_UNTIL_CONFIRMED",
      record
    ),
    checklistItem(
      "return_policy_confirmed",
      "Return policy confirmed",
      "BLOCKED_UNTIL_CONFIRMED",
      record
    ),
    checklistItem(
      "catalog_image_source_confirmed",
      "Catalog image source confirmed",
      "BLOCKED_UNTIL_CONFIRMED",
      record
    ),
    checklistItem(
      "main_image_qa_approved",
      "Main image QA approved",
      "BLOCKED_UNTIL_APPROVED",
      record
    ),
    checklistItem(
      "secondary_image_plan_approved",
      "Secondary image plan approved",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "image_generation_completed",
      "Image generation completed",
      "BLOCKED_NOT_ALLOWED_IN_THIS_LOOP",
      record
    ),
    checklistItem(
      "image_upload_ready",
      "Image upload ready",
      "BLOCKED_NOT_ALLOWED_IN_THIS_LOOP",
      record
    ),
    checklistItem(
      "compliance_review_completed",
      "Compliance review completed",
      "BLOCKED_UNTIL_COMPLETED",
      record
    ),
    checklistItem(
      "vero_review_completed",
      "VeRO review completed",
      "BLOCKED_UNTIL_COMPLETED",
      record
    ),
    checklistItem(
      "draft_payload_reviewed",
      "Draft payload dry run reviewed",
      "PENDING_REVIEW",
      record
    ),
    checklistItem(
      "human_approval_granted",
      "Human approval granted",
      readBoolean(
        record,
        "humanApprovalGranted",
        false
      )
        ? "GRANTED"
        : "NOT_GRANTED",
      record
    ),
    checklistItem(
      "ebay_connection_authorized",
      "eBay connection authorized",
      "BLOCKED_NOT_AUTHORIZED",
      record
    ),
  ]
}

export function getListingReviewApprovalWorkspaceSummary() {
  return {
    workspaceVersion:
      "EBAY_LISTING_REVIEW_APPROVAL_WORKSPACE_V1",
    workspaceStatus:
      "LISTING_REVIEW_APPROVAL_WORKSPACE_READY",
    reviewStatus:
      "READY_FOR_HUMAN_REVIEW_INTERNAL_ONLY",
    approvalStatus:
      "HUMAN_APPROVAL_REQUIRED_NOT_GRANTED",
    internalModuleStatus:
      "LISTING_INTERNAL_MODULE_READY_FOR_REVIEW",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    internalReviewOnly:
      true,
    readyForExternalEbayIntegration:
      false,
  }
}

export function getFinalListingInternalModuleStatus() {
  return {
    listingInternalModuleComplete:
      true,
    readyForHumanReview:
      true,
    readyForExternalEbayIntegration:
      false,
    nextPhaseRequired:
      true,
    nextPhase:
      "eBay Sandbox / Real Image Execution / External Integration",
  }
}

export async function getListingReviewApprovalWorkspace(
  options: WorkspaceOptions = {}
) {
  const completePackage =
    await getCompleteListingPackage(options)

  const approvalChecklist =
    buildApprovalChecklist()

  const blockingIssues = [
    "human_approval_not_granted",
    "ebay_connection_not_authorized",
    "image_generation_not_completed",
    "image_upload_not_allowed",
    "category_not_confirmed",
    "price_not_confirmed",
    "shipping_policy_not_confirmed",
    "return_policy_not_confirmed",
    "compliance_not_completed",
    "vero_review_not_completed",
    "draft_creation_blocked",
    "publication_blocked",
  ]

  return {
    workspaceVersion:
      "EBAY_LISTING_REVIEW_APPROVAL_WORKSPACE_V1",
    workspaceStatus:
      "LISTING_REVIEW_APPROVAL_WORKSPACE_READY",
    reviewStatus:
      "READY_FOR_HUMAN_REVIEW_INTERNAL_ONLY",
    approvalStatus:
      "HUMAN_APPROVAL_REQUIRED_NOT_GRANTED",
    internalModuleStatus:
      "LISTING_INTERNAL_MODULE_READY_FOR_REVIEW",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    sourcePackageVersion:
      completePackage.packageVersion,
    reviewSections: {
      selectedProductReview:
        completePackage.selectedProduct,
      generatedListingContentReview:
        completePackage.generatedListingContent,
      catalogImagePackageReview:
        completePackage.catalogImagePackage,
      secondaryImagePromptsReview:
        completePackage.secondaryImagePrompts,
      draftPayloadDryRunReview:
        completePackage.draftPayloadDryRun,
      missingFactsReview:
        completePackage.missingFacts,
      blockedFieldsReview:
        completePackage.blockedFields,
      readinessGatesReview:
        completePackage.readinessGates,
      complianceReview: {
        status:
          "REQUIRES_HUMAN_REVIEW",
        complianceCompleted:
          false,
        veroCompleted:
          false,
      },
      finalApprovalReview: {
        status:
          "HUMAN_APPROVAL_REQUIRED_NOT_GRANTED",
        persisted:
          false,
      },
    },
    approvalChecklist,
    blockingIssues,
    readinessSummary: {
      canReviewInternalListing:
        true,
      canApproveInternally:
        false,
      canGenerateImagePrompts:
        true,
      canGenerateRealImages:
        false,
      canBuildLocalDraftPayload:
        true,
      canSubmitPayloadToEbay:
        false,
      canCreateEbayDraft:
        false,
      canPublishToEbay:
        false,
      listingInternalReadinessLabel:
        "Internal listing package ready for human review",
      externalReadinessLabel:
        "External eBay actions blocked",
    },
    finalModuleDefinition:
      getFinalListingInternalModuleStatus(),
    safetyFlags: {
      internalReviewOnly:
        true,
      listingInternalModuleComplete:
        true,
      humanApprovalRequired:
        true,
      humanApprovalGranted:
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
      listingMutated:
        false,
    },
  }
}

export function getBlockedListingApprovalResponse() {
  return {
    workspaceStatus:
      "LISTING_REVIEW_APPROVAL_WORKSPACE_READY",
    reviewStatus:
      "READY_FOR_HUMAN_REVIEW_INTERNAL_ONLY",
    approvalStatus:
      "HUMAN_APPROVAL_REQUIRED_NOT_GRANTED",
    internalModuleStatus:
      "LISTING_INTERNAL_MODULE_READY_FOR_REVIEW",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    internalReviewOnly:
      true,
    listingInternalModuleComplete:
      true,
    humanApprovalRequired:
      true,
    humanApprovalGranted:
      false,
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
    realDraftCreated:
      false,
    publishedToEbay:
      false,
  }
}
