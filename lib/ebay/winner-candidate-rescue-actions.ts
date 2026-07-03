import {
  buildMultiPackListingStrategy,
  simulatePackOptions,
} from "./pack-profit-simulator"

const rescueActions = [
  {
    actionId:
      "evaluate_pack",
    label:
      "Evaluar pack",
    status:
      "AVAILABLE_INTERNAL_SIMULATION_ONLY",
    description:
      "Simulate pack x3, x6 and x12 before deciding if the product can become a listing.",
    mutationImpact:
      "DO_NOT_MUTATE",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
  },
  {
    actionId:
      "find_better_supplier",
    label:
      "Buscar mejor proveedor",
    status:
      "AVAILABLE_SOURCING_REVIEW_ONLY",
    description:
      "Route the candidate to sourcing if Luna Portex cost cannot compete.",
    resultingStatus:
      "SOURCING_REQUIRED",
    mutationImpact:
      "DO_NOT_MUTATE",
  },
  {
    actionId:
      "do_not_list",
    label:
      "No listar",
    status:
      "AVAILABLE_RECOMMENDATION_ONLY",
    description:
      "Keep the product out of active listing flow when unit and pack are not profitable.",
    resultingStatus:
      "DO_NOT_LIST_RECOMMENDED",
    mutationImpact:
      "DO_NOT_MUTATE",
  },
]

export function getDustOffRescueDemo() {
  return {
    productName:
      "Dust Off Electronics Duster",
    supplier:
      "Luna Portex",
    unitDecision:
      "UNIT_NOT_PROFITABLE",
    unitListingAllowed:
      false,
    blockedReason:
      "Unit form is not competitive enough to list now.",
    rescueAllowed:
      true,
    recommendedActions:
      [
        "evaluate_pack",
        "find_better_supplier",
        "do_not_list",
      ],
    packScenarios:
      simulatePackOptions({}),
    multiPackListingStrategy:
      buildMultiPackListingStrategy({}),
  }
}

export function getRescueActionsForCandidate(
  input?: unknown
) {
  const candidate =
    input &&
    typeof input === "object"
      ? input as {
          unitListingAllowed?: boolean | null
          state?: string | null
        }
      : {}

  if (candidate.unitListingAllowed === true) {
    return {
      rescueAllowed:
        false,
      reason:
        "Unit can already move to internal review. Rescue is not required.",
      actions:
        [],
    }
  }

  return {
    rescueAllowed:
      true,
    reason:
      "Candidate cannot advance in current unit form. Review pack, sourcing or no-list options.",
    actions:
      rescueActions,
  }
}

export function getWinnerCandidateRescueActions() {
  return {
    rescueVersion:
      "EBAY_WINNER_CANDIDATE_RESCUE_ACTIONS_V1",
    rescueStatus:
      "WINNER_CANDIDATE_RESCUE_ACTIONS_READY",
    flowMode:
      "INTERNAL_READ_ONLY_RESCUE_SIMULATION",
    candidateStatus:
      "BLOCKED_CURRENT_FORM_CAN_BE_RESCUED",
    unitDecision:
      "UNIT_NOT_PROFITABLE_DO_NOT_LIST_AS_UNIT",
    packEvaluationStatus:
      "PACK_REVIEW_AVAILABLE_PACKING_FEE_REQUIRED",
    rescueActions,
    dustOffDemo:
      getDustOffRescueDemo(),
    multiPackListingPolicy: {
      sameProductCanHaveMultiplePackListingCandidates:
        true,
      listingVariantsAreSeparateOffers:
        true,
      eachPackMustPassOwnGates:
        true,
      supportedPackListings:
        [
          "PACK_X3",
          "PACK_X6",
          "PACK_X12",
        ],
      unitNotProfitableCanStillEvaluatePacks:
        true,
      doNotPublishAutomatically:
        true,
    },
    gateRules: {
      unitCanAdvanceToListing:
        false,
      packCanAdvanceToListingWithoutPackingFee:
        false,
      packCanAdvanceToListingWithoutMargin:
        false,
      betterSupplierCanAdvanceWithoutProductsConfirmation:
        false,
      doNotListCanAdvanceToListing:
        false,
      eBayActionsBlocked:
        true,
    },
    safetyFlags: {
      internalRescueOnly:
        true,
      readOnly:
        true,
      packSimulationOnly:
        true,
      packingFeeEditableButNotPersisted:
        true,
      pipelineMutationUsed:
        false,
      productMutationUsed:
        false,
      listingMutationUsed:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
    },
  }
}

export function getBlockedWinnerCandidateRescueResponse() {
  return {
    rescueStatus:
      "WINNER_CANDIDATE_RESCUE_BLOCKED",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    reason:
      "Rescue actions are advisory and read-only until Products and Gates confirm the selected path.",
  }
}
