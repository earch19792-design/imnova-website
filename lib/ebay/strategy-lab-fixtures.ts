import type {
  ComparableInput,
  EconomicsPolicy,
  EvidenceInput,
  HumanConclusion,
  OfferScenarioInput,
  StrategyLabCaseInput,
} from "./strategy-lab-engine"

export const STRATEGY_LAB_FIXTURE_VERSION =
  "STRATEGY_LAB_GOLDEN_CASES_V1_2026_07_28" as const

export const STRATEGY_LAB_ECONOMICS_POLICY: EconomicsPolicy = {
  version: "STRATEGY_LAB_ECONOMICS_V1_2026_07_28",
  feeRate: 0.153,
  fixedOrderFee: 0.40,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
  minimumProfit: 5,
  minimumMarginPercent: 20,
  minimumRoiPercent: 30,
}

export type GoldenStrategyLabCase = {
  fixtureVersion: typeof STRATEGY_LAB_FIXTURE_VERSION
  fixtureStatus: "SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE"
  input: StrategyLabCaseInput
  expectedHumanConclusion: HumanConclusion
}

const OBSERVED_AT = "2026-07-28T12:00:00.000Z"

function evidence(
  input: Omit<EvidenceInput, "observedAt">,
): EvidenceInput {
  return { ...input, observedAt: OBSERVED_AT }
}

function comparable(
  input: Pick<
    ComparableInput,
    | "itemId"
    | "title"
    | "sourceKind"
    | "identityMatch"
    | "offerScenario"
    | "packQuantity"
    | "variantComposition"
    | "itemPrice"
  > & Partial<ComparableInput>,
): ComparableInput {
  return {
    sourceReference: `fixture://ebay/${input.itemId}`,
    observedAt: OBSERVED_AT,
    identityMatchBasis: input.identityMatch === "EXACT"
      ? ["HUMAN_VERIFIED"]
      : ["TEXT_ONLY"],
    identityConflicts: [],
    buyerShipping: 0,
    currency: "USD",
    saleConfirmed: input.sourceKind === "EBAY_SOLD",
    confirmedSoldQuantity: input.sourceKind === "EBAY_SOLD" ? 1 : null,
    estimatedSoldQuantity: input.sourceKind === "EBAY_ESTIMATED" ? 1 : null,
    ...input,
  }
}

function soldComparables(input: {
  idPrefix: string
  title: string
  prices: number[]
  offerScenario: ComparableInput["offerScenario"]
  packQuantity: number
  variantComposition: string[]
}) {
  return input.prices.map((itemPrice, index) =>
    comparable({
      itemId: `${input.idPrefix}${index + 1}`,
      title: input.title,
      sourceKind: "EBAY_SOLD",
      identityMatch: "EXACT",
      offerScenario: input.offerScenario,
      packQuantity: input.packQuantity,
      variantComposition: input.variantComposition,
      itemPrice,
    })
  )
}

function activeComparables(input: {
  idPrefix: string
  title: string
  prices: number[]
  offerScenario: ComparableInput["offerScenario"]
  packQuantity: number
  variantComposition: string[]
}) {
  return input.prices.map((itemPrice, index) =>
    comparable({
      itemId: `${input.idPrefix}${index + 1}`,
      title: input.title,
      sourceKind: "EBAY_ACTIVE",
      identityMatch: "EXACT",
      offerScenario: input.offerScenario,
      packQuantity: input.packQuantity,
      variantComposition: input.variantComposition,
      itemPrice,
    })
  )
}

const bottleEvidence: EvidenceInput[] = [
  evidence({
    id: "bottle-capacity-supplier",
    field: "capacity",
    label: "Capacity",
    rawValue: "1000 mL",
    normalizedValue: 1000,
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/bottle/capacity",
    conflictKey: "bottle-capacity-ml",
    requiredFor: ["CREATIVE"],
  }),
  evidence({
    id: "bottle-capacity-visual",
    field: "capacity",
    label: "Capacity",
    rawValue: "32 oz",
    normalizedValue: 946.35,
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
    sourceReference: "fixture://manual/bottle/approved-main",
    conflictKey: "bottle-capacity-ml",
    requiredFor: ["CREATIVE"],
    humanReviewed: true,
  }),
  evidence({
    id: "bottle-variant-black",
    field: "variant_black",
    label: "Black variant",
    rawValue: "Black",
    normalizedValue: "BLACK",
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/bottle/black",
    requiredFor: ["IDENTITY", "CREATIVE"],
  }),
  evidence({
    id: "bottle-variant-blue-purple",
    field: "variant_blue_purple",
    label: "Blue-Purple variant",
    rawValue: "Blue-Purple",
    normalizedValue: "BLUE_PURPLE",
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/bottle/blue-purple",
    requiredFor: ["IDENTITY", "CREATIVE"],
  }),
  evidence({
    id: "bottle-unit-cost",
    field: "supplier_unit_cost",
    label: "Supplier unit cost",
    rawValue: 8.40,
    normalizedValue: 8.40,
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/bottle/cost",
    requiredFor: ["ECONOMICS"],
  }),
]

const bottleSingleSold = soldComparables({
  idPrefix: "11000000000",
  title: "Motivational water bottle single",
  prices: [15.99, 17.49, 18.99, 20.49],
  offerScenario: "SINGLE",
  packQuantity: 1,
  variantComposition: ["BLACK"],
})
const bottleMixedSold = soldComparables({
  idPrefix: "12000000000",
  title: "Motivational water bottle mixed two pack",
  prices: [35.99, 38.49, 41.99],
  offerScenario: "MIXED_VARIANT_BUNDLE",
  packQuantity: 2,
  variantComposition: ["BLACK", "BLUE_PURPLE"],
})

const bottleComparables: ComparableInput[] = [
  ...bottleSingleSold,
  {
    ...bottleSingleSold[1],
    itemId: `v1|${bottleSingleSold[1].itemId}|0`,
    sourceReference: "fixture://ebay/bottle-single-duplicate",
  },
  ...activeComparables({
    idPrefix: "13000000000",
    title: "Motivational water bottle single active",
    prices: [18.49, 21.49],
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["BLACK"],
  }),
  comparable({
    itemId: "140000000001",
    title: "Motivational bottle estimated activity",
    sourceKind: "EBAY_ESTIMATED",
    identityMatch: "EXACT",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["BLACK"],
    itemPrice: 16.99,
    estimatedSoldQuantity: 27,
  }),
  comparable({
    itemId: "140000000002",
    title: "Similar competitor bottle with unverified claims",
    sourceKind: "EBAY_SOLD",
    identityMatch: "SIMILAR",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["OTHER"],
    itemPrice: 14.99,
  }),
  ...bottleMixedSold,
  ...activeComparables({
    idPrefix: "15000000000",
    title: "Motivational bottle Black and Blue-Purple active bundle",
    prices: [39.99],
    offerScenario: "MIXED_VARIANT_BUNDLE",
    packQuantity: 2,
    variantComposition: ["BLACK", "BLUE_PURPLE"],
  }),
]

const bottleScenarios: OfferScenarioInput[] = [
  {
    id: "bottle-single",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["BLACK"],
    costLines: [{
      variantKey: "BLACK",
      quantity: 1,
      unitCost: 8.40,
      evidenceId: "bottle-unit-cost",
    }],
    packagingCost: 0,
    itemPrice: 18.49,
    buyerShippingCharge: 0,
    outboundShippingCost: 6.99,
    requiredEvidence: [
      { field: "supplier_unit_cost", blockerCode: "SUPPLIER_COST_MISSING" },
      { field: "variant_black", blockerCode: "BLACK_VARIANT_MISSING" },
    ],
    requiresExactSoldEvidence: true,
    creativeSeed: {
      positioning: "ONE BOTTLE, ONE ROUTINE",
      heroComposition: "One real Black bottle with a simple daily routine.",
      proofEvidenceFields: ["variant_black", "capacity"],
      requiredEvidenceFields: ["variant_black"],
      forbiddenTerms: [],
    },
  },
  {
    id: "bottle-mixed-two-pack",
    offerScenario: "MIXED_VARIANT_BUNDLE",
    packQuantity: 2,
    variantComposition: ["BLACK", "BLUE_PURPLE"],
    costLines: [
      {
        variantKey: "BLACK",
        quantity: 1,
        unitCost: 8.40,
        evidenceId: "bottle-unit-cost",
      },
      {
        variantKey: "BLUE_PURPLE",
        quantity: 1,
        unitCost: 8.40,
        evidenceId: "bottle-unit-cost",
      },
    ],
    packagingCost: 0,
    itemPrice: 39.99,
    buyerShippingCharge: 0,
    outboundShippingCost: null,
    hypothesisEvidenceClass: "HUMAN_HYPOTHESIS",
    requiredEvidence: [
      { field: "supplier_unit_cost", blockerCode: "SUPPLIER_COST_MISSING" },
      { field: "variant_black", blockerCode: "BLACK_VARIANT_MISSING" },
      {
        field: "variant_blue_purple",
        blockerCode: "BLUE_PURPLE_VARIANT_MISSING",
      },
    ],
    requiresExactSoldEvidence: true,
    creativeSeed: {
      positioning: "TWO BOTTLES, TWO ROUTINES",
      heroComposition:
        "Exactly two real bottles: Black for one routine and Blue-Purple for the other.",
      proofEvidenceFields: [
        "variant_black",
        "variant_blue_purple",
        "capacity",
      ],
      requiredEvidenceFields: ["variant_black", "variant_blue_purple"],
      forbiddenTerms: [],
    },
  },
]

const bottleCase: GoldenStrategyLabCase = {
  fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
  fixtureStatus: "SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE",
  input: {
    fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
    caseId: "motivational-bottle",
    productLabel: "Botella motivacional",
    evaluatedAt: OBSERVED_AT,
    currency: "USD",
    economicsPolicy: STRATEGY_LAB_ECONOMICS_POLICY,
    evidence: bottleEvidence,
    comparables: bottleComparables,
    scenarios: bottleScenarios,
  },
  expectedHumanConclusion: {
    preferredScenario: "MIXED_VARIANT_BUNDLE",
    commercialDirection: "EVALUATE_TWO_PACK",
    releaseGate: "HOLD_EVIDENCE_INCOMPLETE",
    blockers: [
      "CONSOLIDATED_SHIPPING_MISSING:MIXED_VARIANT_BUNDLE",
    ],
    nextAction: "CONFIRM_CONSOLIDATED_SHIPPING",
    positioning: "TWO BOTTLES, TWO ROUTINES",
  },
}

const posiEvidence: EvidenceInput[] = [
  evidence({
    id: "posi-sku",
    field: "luna_sku",
    label: "Luna SKU",
    rawValue: "ITEM3411",
    normalizedValue: "ITEM3411",
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/posi/sku",
    requiredFor: ["IDENTITY"],
  }),
  evidence({
    id: "posi-product-type",
    field: "product_type",
    label: "Product type",
    rawValue: "Pressure balance replacement cartridge",
    normalizedValue: "PRESSURE_BALANCE_REPLACEMENT_CARTRIDGE",
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/posi/type",
    requiredFor: ["IDENTITY"],
  }),
  evidence({
    id: "posi-unit-cost",
    field: "supplier_unit_cost",
    label: "Supplier unit cost",
    rawValue: 5.75,
    normalizedValue: 5.75,
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/posi/cost",
    requiredFor: ["ECONOMICS"],
  }),
  evidence({
    id: "posi-fitment",
    field: "fitment",
    label: "Verified fitment",
    rawValue: null,
    normalizedValue: null,
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
    sourceReference: "fixture://manual/posi/fitment-pending",
    requiredFor: ["COMPATIBILITY", "CREATIVE"],
  }),
  evidence({
    id: "posi-dimensions",
    field: "dimensions",
    label: "Verified dimensions",
    rawValue: null,
    normalizedValue: null,
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
    sourceReference: "fixture://manual/posi/dimensions-pending",
    requiredFor: ["COMPATIBILITY", "CREATIVE"],
  }),
  evidence({
    id: "posi-compatibility-hypothesis",
    field: "compatibility_hypothesis",
    label: "Compatibility hypothesis",
    rawValue: "Posi-Temp",
    normalizedValue: "POSI_TEMP",
    scope: "STRATEGY",
    sourceKind: "HUMAN_REVIEW",
    sourceReference: "fixture://human/posi/hypothesis",
    requiredFor: ["COMPATIBILITY"],
    humanReviewed: true,
  }),
]

const posiTwoPackSold = soldComparables({
  idPrefix: "21000000000",
  title: "Pressure balance cartridge two pack",
  prices: [33.49, 34.99, 35.99, 37.49],
  offerScenario: "TWO_PACK",
  packQuantity: 2,
  variantComposition: ["STANDARD", "STANDARD"],
})

const posiComparables: ComparableInput[] = [
  ...posiTwoPackSold,
  {
    ...posiTwoPackSold[1],
    itemId: `v1|${posiTwoPackSold[1].itemId}|0`,
    sourceReference: "fixture://ebay/posi-two-pack-duplicate",
  },
  ...activeComparables({
    idPrefix: "22000000000",
    title: "Pressure balance cartridge two pack active",
    prices: [34.49, 38.49],
    offerScenario: "TWO_PACK",
    packQuantity: 2,
    variantComposition: ["STANDARD", "STANDARD"],
  }),
  comparable({
    itemId: "230000000001",
    title: "Pressure balance cartridge estimated activity",
    sourceKind: "EBAY_ESTIMATED",
    identityMatch: "EXACT",
    offerScenario: "TWO_PACK",
    packQuantity: 2,
    variantComposition: ["STANDARD", "STANDARD"],
    itemPrice: 31.99,
    estimatedSoldQuantity: 18,
  }),
  comparable({
    itemId: "230000000002",
    title: "Pressure balance cartridge single sold",
    sourceKind: "EBAY_SOLD",
    identityMatch: "EXACT",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["STANDARD"],
    itemPrice: 19.99,
  }),
  comparable({
    itemId: "230000000003",
    title: "OEM Genuine Universal competitor cartridge",
    sourceKind: "EBAY_SOLD",
    identityMatch: "SIMILAR",
    offerScenario: "TWO_PACK",
    packQuantity: 2,
    variantComposition: ["OTHER", "OTHER"],
    itemPrice: 29.99,
  }),
]

const posiScenario: OfferScenarioInput = {
  id: "posi-two-pack",
  offerScenario: "TWO_PACK",
  packQuantity: 2,
  variantComposition: ["STANDARD", "STANDARD"],
  costLines: [{
    variantKey: "STANDARD",
    quantity: 2,
    unitCost: 5.75,
    evidenceId: "posi-unit-cost",
  }],
  packagingCost: 0,
  itemPrice: 34.99,
  buyerShippingCharge: 0,
  outboundShippingCost: 6.99,
  hypothesisEvidenceClass: "HUMAN_HYPOTHESIS",
  requiredEvidence: [
    { field: "supplier_unit_cost", blockerCode: "SUPPLIER_COST_MISSING" },
  ],
  requiresExactSoldEvidence: true,
  creativeSeed: {
    positioning: "INSTALL_ONE_KEEP_ONE",
    heroComposition:
      "Show two replacement cartridges, verified fitment evidence, measured dimensions, and one stored as the spare.",
    proofEvidenceFields: ["product_type", "fitment", "dimensions"],
    requiredEvidenceFields: ["fitment", "dimensions"],
    forbiddenTerms: ["OEM", "Genuine", "Universal"],
  },
}

const posiCase: GoldenStrategyLabCase = {
  fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
  fixtureStatus: "SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE",
  input: {
    fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
    caseId: "posi-temp-cartridge",
    productLabel: "Cartucho Posi-Temp",
    evaluatedAt: OBSERVED_AT,
    currency: "USD",
    economicsPolicy: STRATEGY_LAB_ECONOMICS_POLICY,
    evidence: posiEvidence,
    comparables: posiComparables,
    scenarios: [posiScenario],
    compatibility: {
      required: true,
      requirements: [
        { field: "fitment", blockerCode: "FITMENT_NOT_VERIFIED" },
        { field: "dimensions", blockerCode: "DIMENSIONS_MISSING" },
      ],
    },
  },
  expectedHumanConclusion: {
    preferredScenario: "TWO_PACK",
    commercialDirection: "EVALUATE_TWO_PACK",
    releaseGate: "HOLD_COMPATIBILITY",
    blockers: ["FITMENT_NOT_VERIFIED", "DIMENSIONS_MISSING"],
    nextAction: "VALIDATE_FITMENT_AND_DIMENSIONS",
    positioning: "INSTALL_ONE_KEEP_ONE",
  },
}

const nozzleEvidence: EvidenceInput[] = [
  evidence({
    id: "nozzle-model",
    field: "model",
    label: "Model",
    rawValue: "80144",
    normalizedValue: "80144",
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
    sourceReference: "fixture://manual/80144/model",
    requiredFor: ["IDENTITY"],
    humanReviewed: true,
  }),
  evidence({
    id: "nozzle-luna-sku",
    field: "luna_sku",
    label: "Luna SKU",
    rawValue: "ITEM5126",
    normalizedValue: "ITEM5126",
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/80144/sku",
    requiredFor: ["IDENTITY"],
  }),
  evidence({
    id: "nozzle-unit-cost",
    field: "supplier_unit_cost",
    label: "Supplier unit cost",
    rawValue: 9.20,
    normalizedValue: 9.20,
    scope: "PRODUCT",
    sourceKind: "SUPPLIER_CATALOG",
    sourceReference: "fixture://luna/80144/cost",
    requiredFor: ["ECONOMICS"],
  }),
  evidence({
    id: "nozzle-three-pack-hypothesis",
    field: "three_pack_hypothesis",
    label: "Three-pack hypothesis",
    rawValue: "Evaluate three units",
    normalizedValue: "THREE_PACK",
    scope: "STRATEGY",
    sourceKind: "HUMAN_REVIEW",
    sourceReference: "fixture://human/80144/three-pack",
    humanReviewed: true,
  }),
  evidence({
    id: "nozzle-real-visual-source",
    field: "real_visual_source",
    label: "Real visual source",
    rawValue: null,
    normalizedValue: null,
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
    sourceReference: "fixture://manual/80144/visual-pending",
    requiredFor: ["CREATIVE"],
  }),
]

const nozzleActive = activeComparables({
  idPrefix: "31000000000",
  title: "80144 pressure washer nozzle single active",
  prices: [18.99, 20.99, 21.99, 22.95, 24.99, 27.99],
  offerScenario: "SINGLE",
  packQuantity: 1,
  variantComposition: ["80144"],
})

const nozzleComparables: ComparableInput[] = [
  ...nozzleActive,
  {
    ...nozzleActive[2],
    itemId: `v1|${nozzleActive[2].itemId}|0`,
    sourceReference: "fixture://ebay/80144-active-duplicate",
    estimatedSoldQuantity: 12,
  },
  comparable({
    itemId: "320000000001",
    title: "80144 single estimated activity",
    sourceKind: "EBAY_ESTIMATED",
    identityMatch: "EXACT",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["80144"],
    itemPrice: 23.49,
    estimatedSoldQuantity: 31,
  }),
  comparable({
    itemId: "320000000002",
    title: "Similar pressure washer nozzle sold",
    sourceKind: "EBAY_SOLD",
    identityMatch: "SIMILAR",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["OTHER"],
    itemPrice: 19.49,
  }),
  comparable({
    itemId: "330000000001",
    title: "80144 three-pack estimated activity",
    sourceKind: "EBAY_ESTIMATED",
    identityMatch: "EXACT",
    offerScenario: "THREE_PACK",
    packQuantity: 3,
    variantComposition: ["80144", "80144", "80144"],
    itemPrice: 49.99,
    estimatedSoldQuantity: 7,
  }),
  comparable({
    itemId: "330000000002",
    title: "Similar three nozzle bundle",
    sourceKind: "EBAY_SOLD",
    identityMatch: "SIMILAR",
    offerScenario: "THREE_PACK",
    packQuantity: 3,
    variantComposition: ["OTHER", "OTHER", "OTHER"],
    itemPrice: 44.99,
  }),
  comparable({
    itemId: "330000000003",
    title: "Rejected three-pack identity",
    sourceKind: "EBAY_ACTIVE",
    identityMatch: "REJECTED",
    offerScenario: "THREE_PACK",
    packQuantity: 3,
    variantComposition: ["80144", "80144", "80144"],
    itemPrice: 54.99,
    identityConflicts: ["MODEL_MISMATCH"],
  }),
]

const nozzleScenarios: OfferScenarioInput[] = [
  {
    id: "80144-single",
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["80144"],
    costLines: [{
      variantKey: "80144",
      quantity: 1,
      unitCost: 9.20,
      evidenceId: "nozzle-unit-cost",
    }],
    packagingCost: 0,
    itemPrice: 22.47,
    buyerShippingCharge: 0,
    outboundShippingCost: 6.99,
    requiredEvidence: [
      { field: "model", blockerCode: "MODEL_MISSING" },
      { field: "supplier_unit_cost", blockerCode: "SUPPLIER_COST_MISSING" },
    ],
    requiresExactSoldEvidence: false,
    creativeSeed: {
      positioning: "ONE VERIFIED 80144",
      heroComposition: "Show one real, verified product without invented claims.",
      proofEvidenceFields: ["model"],
      requiredEvidenceFields: ["model"],
      forbiddenTerms: [],
    },
  },
  {
    id: "80144-three-pack",
    offerScenario: "THREE_PACK",
    packQuantity: 3,
    variantComposition: ["80144", "80144", "80144"],
    costLines: [{
      variantKey: "80144",
      quantity: 3,
      unitCost: 9.20,
      evidenceId: "nozzle-unit-cost",
    }],
    packagingCost: 0,
    itemPrice: 49.99,
    buyerShippingCharge: 0,
    outboundShippingCost: null,
    hypothesisEvidenceClass: "HUMAN_HYPOTHESIS",
    requiredEvidence: [
      { field: "model", blockerCode: "MODEL_MISSING" },
      { field: "supplier_unit_cost", blockerCode: "SUPPLIER_COST_MISSING" },
      {
        field: "real_visual_source",
        blockerCode: "REAL_VISUAL_SOURCE_MISSING",
      },
    ],
    requiresExactSoldEvidence: true,
    creativeSeed: {
      positioning: "THREE-PACK WORKING HYPOTHESIS",
      heroComposition:
        "Only after a real source exists, show exactly three identical verified units.",
      proofEvidenceFields: ["model", "real_visual_source"],
      requiredEvidenceFields: ["real_visual_source"],
      forbiddenTerms: [],
    },
  },
]

const nozzleCase: GoldenStrategyLabCase = {
  fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
  fixtureStatus: "SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE",
  input: {
    fixtureVersion: STRATEGY_LAB_FIXTURE_VERSION,
    caseId: "pressure-washer-nozzle-80144",
    productLabel: "Boquilla 80144",
    evaluatedAt: OBSERVED_AT,
    currency: "USD",
    economicsPolicy: STRATEGY_LAB_ECONOMICS_POLICY,
    evidence: nozzleEvidence,
    comparables: nozzleComparables,
    scenarios: nozzleScenarios,
  },
  expectedHumanConclusion: {
    preferredScenario: "THREE_PACK",
    commercialDirection: "EVALUATE_THREE_PACK",
    releaseGate: "HOLD_EVIDENCE_INCOMPLETE",
    blockers: [
      "REAL_VISUAL_SOURCE_MISSING",
      "SOLD_EXACT_COHORT_MISSING:THREE_PACK",
      "CONSOLIDATED_SHIPPING_MISSING:THREE_PACK",
      "MARKET_CEILING_MISSING:THREE_PACK",
    ],
    nextAction: "COLLECT_EXACT_SOLD_COHORT",
    positioning: "THREE-PACK WORKING HYPOTHESIS",
  },
}

export const STRATEGY_LAB_GOLDEN_CASES: GoldenStrategyLabCase[] = [
  bottleCase,
  posiCase,
  nozzleCase,
]
