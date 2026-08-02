// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION, HUMAN_VISUAL_REVIEW_CONTRACT_VERSION, LUNA_SOURCE_CONTRACT_VERSION, PRODUCT_CASE_EVIDENCE_FIELDS, PRODUCT_CASE_PARSER_VERSION, PRODUCT_CASE_RUNNER_VERSION, PRODUCT_CASE_ZERO_EFFECTS, buildProductCaseRunnerOutput, buildStrategyLabAdapterPreview, emptyGeneralProductComparableResearch, type ProductCaseDocument, type ProductCaseEvidence, type ProductCaseEvidenceField, type ProductCaseHumanComparableCandidate, type ProductCaseHumanIdentityReview, type ProductCaseImageApproval, type ProductCaseListingOperations, type ProductCaseScenarioDraft, type ProductCaseWorkspaceState } from "./product-case-runner.ts"

export const GOLF_SWING_TRAINER_PRODUCT_NAME =
  "Smart Inflatable Golf Ball Swing Trainer — Black"

function fixtureVisualRaw(input: {
  imageId: string
  sourceReference: string
  observedProductType?: string
  visibleFeatures: string[]
  visibleText?: string[]
  visibleBrands?: string[]
  visibleColors: string[]
  visibleQuantity: number
  observedVariant?: string
  possibleConflicts: string[]
  confidence: string
  humanDecision: string
  humanReason: string
  sourceUrl?: string
}) {
  return {
    imageId: input.imageId,
    sourceUrl: input.sourceUrl ?? "",
    sourceReference: input.sourceReference,
    observedProductType: input.observedProductType ?? "",
    visibleFeatures: input.visibleFeatures.join("\n"),
    visibleText: (input.visibleText ?? []).join("\n"),
    visibleBrands: (input.visibleBrands ?? []).join("\n"),
    visibleColors: input.visibleColors.join("\n"),
    visibleQuantity: String(input.visibleQuantity),
    observedVariant: input.observedVariant ?? "",
    possibleConflicts: input.possibleConflicts.join("\n"),
    confidence: input.confidence,
    humanDecision: input.humanDecision,
    humanReason: input.humanReason,
  }
}

export const GOLF_SWING_TRAINER_LUNA_URL =
  "https://lunaportex.com/products/smart-inflatable-golf-ball-swing-trainer-black"

export const ELECTRIC_RAZOR_INVENTORY_FIRST_SANITIZED_SNAPSHOT =
  `643 units available
Sale
$29.99
Add to cart
Add to Wishlist
Pay over time
Electric Razor for Men,Shavers for Men Electric Razor Wet Dry`

export const LUNA_CONCATENATED_PRICES_SANITIZED_SNAPSHOT =
  "Regular price$14.50 USD Sale price$11.56 USDSale"

export const ELECTRIC_RAZOR_LUNA_CONTRACT_SANITIZED_SNAPSHOT =
  `643 units available
Regular price$14.50 USD Sale price$11.56 USDSale
Electric Razor for Men,Shavers for Men Electric Razor Wet Dry
A cordless wet and dry electric razor promoted for everyday home and travel use.
Close shave
Floating heads are promoted as following facial contours for a close shave and a comfortable routine.
Easy to clean
The washable body is presented as making rinsing easier and safer after use.
Pop-up sideburns
The pop-up trimmer is promoted for shaping sideburns and beard edges.
Dry and wet shaving
The supplier says it can be used for dry shaving or with water and shaving foam.
Fast charging and durable
The supplier promotes fast charging and says one charge can support up to one month of typical use.
More information
Shave time per charge: 99 mins
Waterproof rated: IPX6
Rated power: 5W
How to use: use while charging or use cordless
Charging: Equipped with USB data cable
(DO NOT including transformer/adapter/charger)
Packing Include:
1 * men electric razor
1 * USB charging cable(Type-C charging interface)
1 * Clean brush
1 * User manual`

export const GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT =
  "{\"sourceType\":\"LUNA_PUBLIC_PRODUCT_CARD\",\"productName\":\"Smart Inflatable Golf Ball Swing Trainer Black\",\"supplierPrice\":{\"amount\":8,\"currency\":\"USD\"},\"placement\":\"New Arrivals & Restocks\",\"accessStatus\":\"AUTHENTICATED_SOURCE_REQUIRED\"}"

export const GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256 =
  "sha256:3f9463cea836b28625741634bef985f2b709e9d91da4e2f8c8f8ec14e0e4e618"

export const GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT =
  "{\"sourceType\":\"LUNA_AUTHENTICATED_MANUAL_CAPTURE\",\"availability\":50000,\"description\":\"Smart inflatable golf swing trainer for golf swing practice.\",\"productType\":\"INFLATABLE_GOLF_SWING_TRAINER\",\"material\":\"PVC cloth\",\"availableColors\":[\"BLACK\",\"GREY\"],\"weight\":\"0.12kg\",\"intendedPurpose\":\"golf swing practice\",\"intendedUsers\":\"beginners and seasoned players\",\"selectedVariant\":\"BLACK\",\"variantIds\":{\"BLACK\":null,\"GREY\":null},\"marketingClaims\":[\"ultimate swing trainer\",\"state-of-the-art\",\"enhance your golf skills\",\"take your game to the next level\",\"longevity and resilience\",\"ideal for running sports\",\"fitness training\",\"sports protective gear accessories\"]}"

export const GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256 =
  "sha256:2727758b610b5bac47efda1320213a6e56b32da1e3e299ab77fb08684484bb65"

export const GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT =
  "{\"sourceType\":\"HUMAN_VISUAL_REVIEW\",\"reviewedAt\":\"2026-07-28T19:00:00.000Z\",\"observations\":[{\"imageId\":\"supplier-image-1\",\"result\":\"SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION\"},{\"imageId\":\"supplier-image-2\",\"result\":\"REJECT_FOR_EBAY_HANDOFF\",\"reasons\":[\"THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST\",\"PROMOTIONAL_COMPOSITE\",\"PRODUCT_FUNCTION_NOT_VERIFIED\"]},{\"imageId\":\"supplier-image-3\",\"result\":\"SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION\"}]}"

export const GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256 =
  "sha256:7e0deffabab1347e052c3ba8f2ed060703f064f761b7c06e9bb5a29d3297512a"

const CAPTURED_AT = "2026-07-28T18:00:00.000Z"
const REVIEWED_AT = "2026-07-28T19:00:00.000Z"
const CASE_ID = "product-case-golf-swing-trainer-black-v1"
const IDENTITY_CONFLICT_KEY = "product-identity-function:PRODUCT"

type EvidenceSeed = {
  field: ProductCaseEvidenceField
  rawValue: unknown
  normalizedValue: unknown
  sourceType: ProductCaseEvidence["sourceType"]
  contentHash: string
  extractionPath: string
  extractionMethod: ProductCaseEvidence["extractionMethod"]
  sourceEvidenceClass?: ProductCaseEvidence["sourceEvidenceClass"]
  humanVerdict?: ProductCaseEvidence["humanVerdict"]
  humanReason?: string | null
  conflictKey?: string | null
  variantKey?: string | null
  availabilityPurpose?: ProductCaseEvidence["availabilityPurpose"]
  demandEvidence?: ProductCaseEvidence["demandEvidence"]
}

function evidenceFromSeed(seed: EvidenceSeed, index: number):
  ProductCaseEvidence {
  const sourceEvidenceClass = seed.sourceEvidenceClass ?? "SUPPLIER_STATED"
  const humanVerdict = seed.humanVerdict ?? "ACCEPT"
  const missing = sourceEvidenceClass === "MISSING"
  const conflicted = seed.conflictKey === IDENTITY_CONFLICT_KEY
  return {
    id: `golf-evidence-${String(index + 1).padStart(2, "0")}-${seed.field}`,
    field: seed.field,
    label: seed.field.replaceAll("_", " "),
    variantKey: seed.variantKey ?? null,
    sourceType: seed.sourceType,
    sourceUrl: GOLF_SWING_TRAINER_LUNA_URL,
    capturedAt: seed.sourceType === "LUNA_PUBLIC_PREFLIGHT"
      ? CAPTURED_AT
      : REVIEWED_AT,
    contentHash: seed.contentHash,
    extractionPath: seed.extractionPath,
    extractionMethod: seed.extractionMethod,
    rawValue: seed.rawValue,
    normalizedValue: seed.normalizedValue,
    evidenceClass: missing
      ? "MISSING"
      : conflicted ? "CONFLICTED" : sourceEvidenceClass,
    sourceEvidenceClass,
    evidenceStatus: missing
      ? "MISSING"
      : conflicted
      ? "CONFLICTED"
      : humanVerdict === "REJECT"
        ? "REJECTED"
        : humanVerdict === "NEEDS_MORE_EVIDENCE"
          ? "NEEDS_MORE_EVIDENCE"
          : "ACCEPTED",
    humanVerdict,
    humanReason: seed.humanReason ?? null,
    originalValue: seed.rawValue,
    correctedValue: null,
    conflictKey: seed.conflictKey ?? null,
    availabilityPurpose: seed.availabilityPurpose ?? null,
    demandEvidence: seed.demandEvidence ?? null,
  }
}

const ACCEPTED_SEEDS: EvidenceSeed[] = [
  {
    field: "title",
    rawValue: "Smart Inflatable Golf Ball Swing Trainer Black",
    normalizedValue: "Smart Inflatable Golf Ball Swing Trainer Black",
    sourceType: "LUNA_PUBLIC_PREFLIGHT",
    contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
    extractionPath: "public.productCard.productName",
    extractionMethod: "PUBLIC_SNAPSHOT",
  },
  {
    field: "supplier_price",
    rawValue: "USD 8.00",
    normalizedValue: 8,
    sourceType: "LUNA_PUBLIC_PREFLIGHT",
    contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
    extractionPath: "public.productCard.supplierPrice.amount",
    extractionMethod: "PUBLIC_SNAPSHOT",
  },
  {
    field: "currency",
    rawValue: "USD",
    normalizedValue: "USD",
    sourceType: "LUNA_PUBLIC_PREFLIGHT",
    contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
    extractionPath: "public.productCard.supplierPrice.currency",
    extractionMethod: "PUBLIC_SNAPSHOT",
  },
  {
    field: "supplier_merchandising_signal",
    rawValue: "New Arrivals & Restocks",
    normalizedValue: "NEW_ARRIVALS_AND_RESTOCKS",
    sourceType: "LUNA_PUBLIC_PREFLIGHT",
    contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
    extractionPath: "public.collectionPlacement",
    extractionMethod: "PUBLIC_SNAPSHOT",
    sourceEvidenceClass: "SUPPLIER_MERCHANDISING_SIGNAL",
  },
  {
    field: "visible_stock",
    rawValue: 50000,
    normalizedValue: 50000,
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.availability",
    extractionMethod: "JSON_PATH",
    availabilityPurpose: "INVENTORY_SIGNAL",
    demandEvidence: "NONE",
  },
  {
    field: "description",
    rawValue: "Smart inflatable golf swing trainer for golf swing practice.",
    normalizedValue:
      "Smart inflatable golf swing trainer for golf swing practice.",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.description",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "product_type",
    rawValue: "INFLATABLE_GOLF_SWING_TRAINER",
    normalizedValue: "INFLATABLE_GOLF_SWING_TRAINER",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.productType",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "material",
    rawValue: "PVC cloth",
    normalizedValue: "PVC cloth",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.material",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "available_colors",
    rawValue: ["BLACK", "GREY"],
    normalizedValue: ["BLACK", "GREY"],
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.availableColors",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "weight",
    rawValue: "0.12kg",
    normalizedValue: "0.12kg",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.weight",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "intended_purpose",
    rawValue: "golf swing practice",
    normalizedValue: "golf swing practice",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.intendedPurpose",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "intended_users",
    rawValue: "beginners and seasoned players",
    normalizedValue: "beginners and seasoned players",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.intendedUsers",
    extractionMethod: "JSON_PATH",
  },
  {
    field: "selected_variant",
    rawValue: "BLACK",
    normalizedValue: "BLACK",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: "json.selectedVariant",
    extractionMethod: "JSON_PATH",
    variantKey: "BLACK",
  },
  ...[
    "ultimate swing trainer",
    "state-of-the-art",
    "enhance your golf skills",
    "take your game to the next level",
    "longevity and resilience",
    "ideal for running sports",
    "fitness training",
    "sports protective gear accessories",
  ].map((claim, index): EvidenceSeed => ({
    field: "marketing_claim",
    rawValue: claim,
    normalizedValue: claim,
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: `json.marketingClaims[${index}]`,
    extractionMethod: "JSON_PATH",
    sourceEvidenceClass: "SUPPLIER_MARKETING_CLAIM",
  })),
  {
    field: "visual_observation",
    rawValue: "Image 1: round black object, lanyard and hooks; product identity remains ambiguous.",
    normalizedValue:
      "ROUND_BLACK_OBJECT_WITH_LANYARD_AND_HOOKS_IDENTITY_AMBIGUOUS",
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
    extractionPath: "humanVisualReview.image[1]",
    extractionMethod: "HUMAN_STRUCTURED_REVIEW",
    sourceEvidenceClass: "HUMAN_VISUAL_REVIEW",
    humanVerdict: "NEEDS_MORE_EVIDENCE",
    humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
  },
  {
    field: "visual_observation",
    rawValue: "Image 2: pouch, storage compartments and zippers with visible Titleist branding.",
    normalizedValue:
      "POUCH_STORAGE_ZIPPERS_VISIBLE_TITLEIST_BRANDING",
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
    extractionPath: "humanVisualReview.image[2]",
    extractionMethod: "HUMAN_STRUCTURED_REVIEW",
    sourceEvidenceClass: "HUMAN_VISUAL_REVIEW",
    humanVerdict: "REJECT",
    humanReason:
      "REJECT_FOR_EBAY_HANDOFF:THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST;PROMOTIONAL_COMPOSITE;PRODUCT_FUNCTION_NOT_VERIFIED",
  },
  {
    field: "visual_observation",
    rawValue: "Image 3: round black object, lanyard and hooks; product identity remains ambiguous.",
    normalizedValue:
      "ROUND_BLACK_OBJECT_WITH_LANYARD_AND_HOOKS_IDENTITY_AMBIGUOUS",
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
    extractionPath: "humanVisualReview.image[3]",
    extractionMethod: "HUMAN_STRUCTURED_REVIEW",
    sourceEvidenceClass: "HUMAN_VISUAL_REVIEW",
    humanVerdict: "NEEDS_MORE_EVIDENCE",
    humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
  },
]

const PRESENT_FIELDS = new Set(ACCEPTED_SEEDS.map((entry) => entry.field))
const MISSING_SEEDS: EvidenceSeed[] = PRODUCT_CASE_EVIDENCE_FIELDS
  .filter((field) => !PRESENT_FIELDS.has(field))
  .map((field) => ({
    field,
    rawValue: null,
    normalizedValue: null,
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    extractionPath: `missing.${field}`,
    extractionMethod: "MISSING",
    sourceEvidenceClass: "MISSING",
    humanVerdict: "UNREVIEWED",
    availabilityPurpose: field === "visible_stock"
      ? "INVENTORY_SIGNAL"
      : null,
    demandEvidence: field === "visible_stock" ? "NONE" : null,
  }))

const GOLF_SWING_TRAINER_EVIDENCE = [
  ...ACCEPTED_SEEDS,
  ...MISSING_SEEDS,
].map(evidenceFromSeed)

function comparableCandidate(input: {
  title: string | null
  ebayItemId?: string | null
  ebayUrl?: string | null
  observedAt: string
  listingStatus: ProductCaseHumanComparableCandidate["listingStatus"]
  price: number
  shipping: number | null
  soldSignal: number | null
  condition: string
  endedAt: string | null
  cohort: "SIMILAR_NOT_EXACT" | "REJECTED"
  decision: "KEEP_NOT_VALIDATED" | "REJECT"
  reason: string
  reasonCodes: string[]
  sourceReference: string
  competitorDimensions?: string | null
  competitorWeight?: string | null
}): ProductCaseHumanComparableCandidate {
  return {
    sourceType: "HUMAN_SUPPLIED_COMPARABLE_CANDIDATE",
    comparisonClass: "EXACT_PRODUCT_MATCH",
    validationStatus: "NOT_VALIDATED",
    ebayItemId: input.ebayItemId ?? null,
    ebayUrl: input.ebayUrl ?? null,
    listingStatus: input.listingStatus,
    observedTitle: input.title,
    observedPriceApprox: input.price,
    observedShippingApprox: input.shipping,
    currency: "USD",
    visibleSoldSignal: input.soldSignal,
    confirmedSoldQuantity: null,
    condition: input.condition,
    endedAt: input.endedAt,
    competitorDimensions: input.competitorDimensions ?? null,
    competitorWeight: input.competitorWeight ?? null,
    sourceReference: input.sourceReference,
    observedAt: input.observedAt,
    identityValidated: false,
    variantValidated: false,
    contentsValidated: false,
    packQuantityValidated: false,
    eligibleForStrategyLab: false,
    eligibleForSoldExact: false,
    canBecomeProductFact: false,
    provisionalCohort: input.cohort,
    review: {
      decision: input.decision,
      reason: input.reason,
      reviewer: "HUMAN_SELLER_HUB_REVIEWER",
      reviewedAt: input.observedAt,
      validatedTitle: null,
      validatedPackQuantity: null,
      validatedVariantComposition: [],
      buyerShipping: null,
      reasonCodes: [...input.reasonCodes],
    },
    validationBlockers: [
      ...(input.ebayItemId ? [] : ["EBAY_ITEM_ID_MISSING"]),
      "EXACT_IDENTITY_NOT_VALIDATED",
      "VARIANT_NOT_VALIDATED",
      "CONTENTS_NOT_VALIDATED",
      "PACK_QUANTITY_NOT_VALIDATED",
      ...(input.soldSignal === null
        ? []
        : ["VISIBLE_SOLD_SIGNAL_IS_NOT_CONFIRMED_SOLD_EVIDENCE"]),
    ],
  }
}

export const GOLF_SWING_TRAINER_COMPARABLE_CANDIDATES:
  ProductCaseHumanComparableCandidate[] = [
    comparableCandidate({
      title: null,
      ebayItemId: "187697800648",
      ebayUrl: "https://www.ebay.com/itm/187697800648",
      observedAt: REVIEWED_AT,
      listingStatus: "ACTIVE_VISIBLE",
      price: 24.99,
      shipping: null,
      soldSignal: 9,
      condition: "UNKNOWN",
      endedAt: null,
      cohort: "SIMILAR_NOT_EXACT",
      decision: "KEEP_NOT_VALIDATED",
      reason:
        "ACTIVE_URL_CANDIDATE_REQUIRES_EXACT_IDENTITY_VARIANT_CONTENTS_AND_PACK_REVIEW",
      reasonCodes: [
        "EXACT_IDENTITY_NOT_VALIDATED",
        "ACTIVE_VISIBLE_SOLD_SIGNAL_IS_NOT_SOLD_EXACT",
      ],
      sourceReference:
        "https://www.ebay.com/itm/187697800648",
    }),
    comparableCandidate({
      title: null,
      ebayItemId: "376837929124",
      ebayUrl: "https://www.ebay.com/itm/376837929124",
      observedAt: REVIEWED_AT,
      listingStatus: "ACTIVE_VISIBLE",
      price: 24.76,
      shipping: null,
      soldSignal: null,
      condition: "UNKNOWN",
      endedAt: null,
      cohort: "SIMILAR_NOT_EXACT",
      decision: "KEEP_NOT_VALIDATED",
      reason:
        "ACTIVE_URL_CANDIDATE_REQUIRES_EXACT_IDENTITY_VARIANT_CONTENTS_AND_PACK_REVIEW",
      reasonCodes: ["EXACT_IDENTITY_NOT_VALIDATED"],
      sourceReference:
        "https://www.ebay.com/itm/376837929124",
      competitorDimensions: "28 cm",
      competitorWeight: "0.16 kg",
    }),
    comparableCandidate({
      title:
        "Golf Training Aid, Smart Ball for Golf Swing Trainer, Inflatable & Portable",
      observedAt: "2026-05-30T00:00:00.000Z",
      listingStatus: "SOLD_AUCTION_VISIBLE",
      price: 3.99,
      shipping: 5.73,
      soldSignal: 1,
      condition: "UNKNOWN",
      endedAt: "2026-05-30T00:00:00.000Z",
      cohort: "SIMILAR_NOT_EXACT",
      decision: "KEEP_NOT_VALIDATED",
      reason: "NO_ITEM_ID_AND_EXACT_PRODUCT_IDENTITY_NOT_ESTABLISHED",
      reasonCodes: ["NOT_EXACT_LUNA_PRODUCT"],
      sourceReference: "human-supplied://seller-hub-observation/1",
    }),
    comparableCandidate({
      title:
        "Tour Striker Smart Ball — Golf Training Aid Used Inflatable W/Lanyard",
      observedAt: "2026-07-17T00:00:00.000Z",
      listingStatus: "SOLD_USED_VISIBLE",
      price: 20,
      shipping: 0,
      soldSignal: 1,
      condition: "USED",
      endedAt: "2026-07-17T00:00:00.000Z",
      cohort: "REJECTED",
      decision: "REJECT",
      reason:
        "BRANDED_TOUR_STRIKER; CONDITION_USED; PRODUCT_TYPE_MISMATCH; NOT_EXACT_LUNA_PRODUCT",
      reasonCodes: [
        "BRANDED_TOUR_STRIKER",
        "CONDITION_USED",
        "PRODUCT_TYPE_MISMATCH",
        "NOT_EXACT_LUNA_PRODUCT",
      ],
      sourceReference: "human-supplied://seller-hub-observation/2",
    }),
    comparableCandidate({
      title:
        "Tour Striker Smart Ball — Golf Training Aid Used Inflatable W/Lanyard",
      observedAt: "2026-07-08T00:00:00.000Z",
      listingStatus: "SOLD_USED_VISIBLE",
      price: 24.99,
      shipping: 7.38,
      soldSignal: 1,
      condition: "USED",
      endedAt: "2026-07-08T00:00:00.000Z",
      cohort: "REJECTED",
      decision: "REJECT",
      reason:
        "BRANDED_TOUR_STRIKER; CONDITION_USED; PRODUCT_TYPE_MISMATCH; NOT_EXACT_LUNA_PRODUCT",
      reasonCodes: [
        "BRANDED_TOUR_STRIKER",
        "CONDITION_USED",
        "PRODUCT_TYPE_MISMATCH",
        "NOT_EXACT_LUNA_PRODUCT",
      ],
      sourceReference: "human-supplied://seller-hub-observation/3",
    }),
  ]

export const GOLF_SWING_TRAINER_REQUIRED_MISSING_FIELDS:
  ProductCaseEvidenceField[] = [
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
    "product_dimensions",
    "package_dimensions",
    "contents",
    "inflation_mechanism",
    "accessories",
    "included_quantity",
    "pack_quantity",
    "source_image_url",
    "fulfillment_quote",
    "supplier_unit_cost",
    "packaging_cost",
    "outbound_shipping_cost",
  ]

export const GOLF_SWING_TRAINER_EXACT_BLOCKERS = [
  "PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT",
  "BLACK_VARIANT_ID_MISSING",
  "GREY_VARIANT_ID_MISSING",
  "VARIANT_IMAGE_MAPPING_MISSING",
  "INFLATED_DIAMETER_MISSING",
  "PACKAGE_DIMENSIONS_MISSING",
  "INFLATION_VALVE_NOT_VISIBLE",
  "PUMP_INCLUDED_STATUS_MISSING",
  "LANYARD_LENGTH_MISSING",
  "PACKAGE_CONTENTS_MISSING",
  "OUTBOUND_SHIPPING_MISSING",
  "SOLD_EXACT_COHORT_MISSING",
] as const

export const EMPTY_PRODUCT_CASE_LISTING_OPERATIONS:
  ProductCaseListingOperations = {
    title: null,
    categoryId: null,
    categoryName: null,
    conditionId: null,
    conditionDescription: null,
    itemSpecifics: {},
    requiredItemSpecifics: [],
    description: null,
    listingPrice: null,
    quantity: null,
    totalInvestment: null,
    estimatedProfit: null,
    marginPercent: null,
    roiPercent: null,
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
    shippingPolicySummary: null,
    returnPolicySummary: null,
    handlingTimeDays: null,
    itemLocation: {
      country: null,
      postalCode: null,
      city: null,
      stateOrProvince: null,
    },
    imageEvidenceOrder: [],
    supportingEvidenceIds: [],
    evidenceLinks: {
      title: [],
      category: [],
      condition: [],
      itemSpecifics: {},
      description: [],
      listingPrice: [],
      quantity: [],
      economics: [],
      policies: [],
      itemLocation: [],
    },
    assumptions: [],
    blockers: [...GOLF_SWING_TRAINER_EXACT_BLOCKERS],
    differences: [],
    supplierAvailabilityStatus: "CONFIRMED_AVAILABLE",
    brandIpClaimsReview: {
      status: "REJECTED",
      reviewer: "HUMAN_VISUAL_REVIEWER",
      reviewedAt: REVIEWED_AT,
      reason:
        "VISIBLE_TITLEIST_BRANDING_AND_PRODUCT_FUNCTION_CONFLICT",
    },
    explicitHumanApproval: {
      approved: false,
      reviewer: null,
      reviewedAt: null,
      reason: null,
    },
    humanOverride: {
      applied: false,
      reviewer: null,
      reviewedAt: null,
      reason: null,
      overriddenBlockers: [],
    },
    candidateKey: null,
  }

const fixtureDocument = {
  version: PRODUCT_CASE_RUNNER_VERSION,
  caseId: CASE_ID,
  productLabel: GOLF_SWING_TRAINER_PRODUCT_NAME,
  sourceUrl: GOLF_SWING_TRAINER_LUNA_URL,
  createdAt: CAPTURED_AT,
  sourceAccess: {
    status: "AUTHENTICATED_SOURCE_REQUIRED",
    canonicalUrl: GOLF_SWING_TRAINER_LUNA_URL,
    checkedAt: CAPTURED_AT,
    reason: "AUTHENTICATED_SOURCE_REQUIRED",
    httpStatus: null,
    redirectsFollowed: 0,
    credentialsUsed: false,
  },
  supplierSourceCapture: {
    supplierUrl: GOLF_SWING_TRAINER_LUNA_URL,
    rawVisibleSourceText: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT,
    sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
    sourceCaptureMethod: "MANUAL_AUTHENTICATED_PASTE",
    capturedAt: REVIEWED_AT,
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    parserVersion: PRODUCT_CASE_PARSER_VERSION,
    sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
    parseHealth: "PARSED_OK",
    stockState: "IN_STOCK_SIGNAL",
    extractionWarnings: [],
    evidenceCandidates: GOLF_SWING_TRAINER_EVIDENCE.filter((entry) =>
      entry.contentHash ===
        GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256 &&
      entry.evidenceStatus !== "MISSING"
    ),
    missingFields: PRODUCT_CASE_EVIDENCE_FIELDS.filter((field) =>
      !GOLF_SWING_TRAINER_EVIDENCE.some((entry) =>
        entry.contentHash ===
          GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256 &&
        entry.field === field &&
        entry.evidenceStatus !== "MISSING"
      )
    ),
    fullHtmlAccepted: false,
    sensitiveContentAssessment: "NO_SENSITIVE_PATTERN_DETECTED",
    humanVisibleProductTextConfirmed: true,
  },
  captures: [
    {
      sourceType: "LUNA_PUBLIC_PREFLIGHT",
      sourceUrl: GOLF_SWING_TRAINER_LUNA_URL,
      capturedAt: CAPTURED_AT,
      contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
      parserVersion: PRODUCT_CASE_PARSER_VERSION,
      sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
      parseHealth: "PARSED_OK",
      stockState: "STOCK_UNKNOWN",
      format: "JSON",
      byteLength: 235,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    {
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
      sourceUrl: GOLF_SWING_TRAINER_LUNA_URL,
      capturedAt: REVIEWED_AT,
      contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
      parserVersion: PRODUCT_CASE_PARSER_VERSION,
      sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
      parseHealth: "PARSED_OK",
      stockState: "IN_STOCK_SIGNAL",
      format: "JSON",
      byteLength: 661,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    {
      sourceType: "HUMAN_VISUAL_OBSERVATION",
      sourceUrl: GOLF_SWING_TRAINER_LUNA_URL,
      capturedAt: REVIEWED_AT,
      contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
      parserVersion: null,
      sourceContractVersion: null,
      parseHealth: null,
      stockState: null,
      format: "JSON",
      byteLength: 440,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
  ],
  evidence: GOLF_SWING_TRAINER_EVIDENCE,
  marketEvidence: {
    runStatus: "INSUFFICIENT",
    soldExact: "MISSING",
    activeExact: "MISSING",
    marketCeiling: "MISSING",
    soldExactCount: 0,
    referenceMedian: null,
    comparables: [],
    humanSuppliedComparableCandidates:
      GOLF_SWING_TRAINER_COMPARABLE_CANDIDATES,
    generalProductComparableResearch:
      emptyGeneralProductComparableResearch(),
    observedAt: "2026-07-17T00:00:00.000Z",
  },
  imageAnalysis: {
    imageAnalysisCapability: "HUMAN_ASSISTED_ONLY",
    machineVisionStatus: "NOT_IMPLEMENTED",
    openAiVisionUsed: false,
    humanReviewRequired: true,
    visualEvidenceStatus: "HUMAN_REVIEWED",
    conflictDetectedFrom: [
      "SUPPLIER_TEXT",
      "HUMAN_VISUAL_REVIEW",
    ],
    observations: [
      {
        contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
        imageId: "supplier-image-1",
        evidenceId: "golf-evidence-22-visual_observation",
        contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
        sourceUrl: null,
        sourceReference: "human review of supplier image 1",
        sourceType: "SUPPLIER_IMAGE",
        verificationStatus: "SOURCE_IMAGE_OBSERVED",
        physicalProductVerified: false,
        captureMethod: "HUMAN_VISUAL_REVIEW",
        reviewerType: "HUMAN",
        observedProductType: null,
        visibleFeatures: ["round black object", "lanyard", "hooks"],
        visibleText: [],
        visibleBrands: [],
        visibleColors: ["BLACK"],
        visibleQuantity: 1,
        observedVariant: null,
        possibleConflicts: ["PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT"],
        contradictsEvidenceIds: [
          "golf-evidence-01-title",
          "golf-evidence-06-description",
          "golf-evidence-07-product_type",
        ],
        confidence: "LOW",
        humanDecision: "NEEDS_MORE_EVIDENCE",
        humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
        reviewedAt: REVIEWED_AT,
        rawHumanInput: fixtureVisualRaw({
          imageId: "supplier-image-1",
          sourceReference: "human review of supplier image 1",
          visibleFeatures: ["round black object", "lanyard", "hooks"],
          visibleColors: ["BLACK"],
          visibleQuantity: 1,
          possibleConflicts: ["PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT"],
          confidence: "LOW",
          humanDecision: "NEEDS_MORE_EVIDENCE",
          humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
        }),
      },
      {
        contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
        imageId: "supplier-image-2",
        evidenceId: "golf-evidence-23-visual_observation",
        contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
        sourceUrl: null,
        sourceReference: "human review of supplier image 2",
        sourceType: "SUPPLIER_IMAGE",
        verificationStatus: "SOURCE_IMAGE_OBSERVED",
        physicalProductVerified: false,
        captureMethod: "HUMAN_VISUAL_REVIEW",
        reviewerType: "HUMAN",
        observedProductType: "POUCH_OR_STORAGE_ACCESSORY",
        visibleFeatures: ["pouch", "storage compartments", "zippers"],
        visibleText: ["Titleist"],
        visibleBrands: ["Titleist"],
        visibleColors: ["BLACK"],
        visibleQuantity: 1,
        observedVariant: null,
        possibleConflicts: [
          "PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT",
          "VISIBLE_THIRD_PARTY_BRAND_IP",
        ],
        contradictsEvidenceIds: [
          "golf-evidence-01-title",
          "golf-evidence-06-description",
          "golf-evidence-07-product_type",
        ],
        confidence: "HIGH",
        humanDecision: "REJECT_FOR_EBAY_HANDOFF",
        humanReason:
          "THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST; PROMOTIONAL_COMPOSITE; PRODUCT_FUNCTION_NOT_VERIFIED",
        reviewedAt: REVIEWED_AT,
        rawHumanInput: fixtureVisualRaw({
          imageId: "supplier-image-2",
          sourceReference: "human review of supplier image 2",
          observedProductType: "POUCH_OR_STORAGE_ACCESSORY",
          visibleFeatures: ["pouch", "storage compartments", "zippers"],
          visibleText: ["Titleist"],
          visibleBrands: ["Titleist"],
          visibleColors: ["BLACK"],
          visibleQuantity: 1,
          possibleConflicts: [
            "PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT",
            "VISIBLE_THIRD_PARTY_BRAND_IP",
          ],
          confidence: "HIGH",
          humanDecision: "REJECT_FOR_EBAY_HANDOFF",
          humanReason:
            "THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST; PROMOTIONAL_COMPOSITE; PRODUCT_FUNCTION_NOT_VERIFIED",
        }),
      },
      {
        contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
        imageId: "supplier-image-3",
        evidenceId: "golf-evidence-24-visual_observation",
        contentHash: GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
        sourceUrl: null,
        sourceReference: "human review of supplier image 3",
        sourceType: "SUPPLIER_IMAGE",
        verificationStatus: "SOURCE_IMAGE_OBSERVED",
        physicalProductVerified: false,
        captureMethod: "HUMAN_VISUAL_REVIEW",
        reviewerType: "HUMAN",
        observedProductType: null,
        visibleFeatures: ["round black object", "lanyard", "hooks"],
        visibleText: [],
        visibleBrands: [],
        visibleColors: ["BLACK"],
        visibleQuantity: 1,
        observedVariant: null,
        possibleConflicts: ["PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT"],
        contradictsEvidenceIds: [
          "golf-evidence-01-title",
          "golf-evidence-06-description",
          "golf-evidence-07-product_type",
        ],
        confidence: "LOW",
        humanDecision: "NEEDS_MORE_EVIDENCE",
        humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
        reviewedAt: REVIEWED_AT,
        rawHumanInput: fixtureVisualRaw({
          imageId: "supplier-image-3",
          sourceReference: "human review of supplier image 3",
          visibleFeatures: ["round black object", "lanyard", "hooks"],
          visibleColors: ["BLACK"],
          visibleQuantity: 1,
          possibleConflicts: ["PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT"],
          confidence: "LOW",
          humanDecision: "NEEDS_MORE_EVIDENCE",
          humanReason: "SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION",
        }),
      },
    ],
  },
  identityReview: {
    status: "CONFLICTED",
    confidence: "LOW",
    physicalProductVerified: false,
    physicalVerificationEvidenceIds: [],
    conflictHistory: ["TITLE_VS_VISUAL"],
    currentConflict: "SUPPLIER_DESCRIPTION_VS_PROMOTIONAL_IMAGE",
    supplierEvidenceIds: [
      "golf-evidence-01-title",
      "golf-evidence-06-description",
      "golf-evidence-07-product_type",
    ],
    humanObservationEvidenceIds: [
      "golf-evidence-22-visual_observation",
      "golf-evidence-23-visual_observation",
      "golf-evidence-24-visual_observation",
    ],
    blockers: [...GOLF_SWING_TRAINER_EXACT_BLOCKERS],
    nextAction: "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT",
  },
  supplierCatalogLimitation: {
    activeAttestation: null,
    historicalAttestations: [],
  },
  humanReview: {
    conclusion: {
      scenario: null,
      conclusion: "HOLD_IDENTITY",
      reason: "PHYSICAL_PRODUCT_AND_VARIANT_MUST_BE_VERIFIED",
      reviewedAt: REVIEWED_AT,
      reviewer: "HUMAN_PILOT_REVIEWER",
    },
    proposedRuleObservation:
      "TITLE_CANNOT_OVERRIDE_CONTRADICTORY_VISUAL_EVIDENCE",
    learningStatus: "HUMAN_REVIEW_DRAFT",
    canChangeEngineRules: false,
    canPublishAutomatically: false,
    canLinkListing: false,
  },
  safety: PRODUCT_CASE_ZERO_EFFECTS,
  economicsPolicy: null,
  scenarioDraft: null,
} satisfies ProductCaseDocument & {
  economicsPolicy: null
  scenarioDraft: null
}

export const GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE = {
  fixtureVersion:
    "SMART_INFLATABLE_GOLF_BALL_SWING_TRAINER_REVIEWED_CASE_V2_2026_07_28",
  fixtureClass: "VERSIONED_HUMAN_REVIEWED_PILOT_FIXTURE",
  liveMarketEvidence: false,
  linkedToOwnEbayListing: false,
  document: fixtureDocument,
  publicSnapshot: {
    content: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT,
    contentHash: GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
    byteLength: 235,
    hashAlgorithm: "SHA-256",
    hashVerifiedAgainstExactUtf8Snapshot: true,
  },
  authenticatedSnapshot: {
    content: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT,
    contentHash: GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
    byteLength: 661,
    hashAlgorithm: "SHA-256",
    hashVerifiedAgainstExactUtf8Snapshot: true,
    credentialsStored: false,
  },
  requiredMissingFields: GOLF_SWING_TRAINER_REQUIRED_MISSING_FIELDS,
  exactBlockers: GOLF_SWING_TRAINER_EXACT_BLOCKERS,
  prohibitedInferences: [
    "DO_NOT_INFER_FROM_IMAGE_FILENAME_ALT_OR_URL",
    "DO_NOT_INFER_PUMP_INCLUDED",
    "DO_NOT_INFER_VALVE",
    "DO_NOT_INFER_ACCESSORIES",
    "DO_NOT_INFER_PACK_QUANTITY",
    "DO_NOT_INFER_PRODUCT_OR_PACKAGE_DIMENSIONS",
    "DO_NOT_INFER_WEIGHT_FROM_COMPETITOR",
    "DO_NOT_INFER_PRODUCT_FACTS_FROM_COMPETITOR",
    "DO_NOT_TREAT_SUPPLIER_STOCK_AS_DEMAND",
    "DO_NOT_TREAT_VISIBLE_SOLD_SIGNAL_AS_CONFIRMED_SOLD",
  ],
  claimPolicy: {
    mode: "SUPPLIER_MARKETING_CLAIMS_EXCLUDED",
    supplierDescriptionIsVerifiedSpecification: false,
    merchandisingPlacementIsDemandEvidence: false,
    supplierAvailabilityIsDemandEvidence: false,
  },
  listingOperations: EMPTY_PRODUCT_CASE_LISTING_OPERATIONS,
  imageApprovals: [],
  initialStatus: {
    identity: "CONFLICTED",
    identityConfidence: "LOW",
    productFactsReadiness: "NOT_READY",
    supplier: "PARTIAL",
    market: "INSUFFICIENT",
    soldExactCount: 0,
    referenceMedian: null,
    economics: "MISSING_INPUT",
    strategy: "HOLD_IDENTITY",
    listingPackageStatus: "NOT_GENERATED_IDENTITY_HOLD",
    manualHandoffAllowed: false,
    nextAction: "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT",
  },
} as const

const SANITIZED_SOURCE_URL =
  "https://lunaportex.com/products/sanitized-deterministic-product"
const SANITIZED_CAPTURED_AT = "2026-07-28T20:00:00.000Z"
const SANITIZED_CAPTURE_HASH =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const SANITIZED_VISUAL_HASH =
  "sha256:339bc5b8564f1259db8ef3f1e2d0a5f4a3367d6fb5749c31d16145268b4bb170"
const SANITIZED_VISUAL_EVIDENCE_ID =
  "visual-339bc5b8564f-sanitized-main"
const SANITIZED_IMAGE_URL =
  "https://lunaportex.com/cdn/sanitized-deterministic-main.jpg"
const SANITIZED_VISUAL_RAW = fixtureVisualRaw({
  imageId: "sanitized-main",
  sourceUrl: SANITIZED_IMAGE_URL,
  sourceReference: "sanitized deterministic source image",
  observedProductType: "SANITIZED_PRODUCT",
  visibleFeatures: ["sanitized feature"],
  visibleColors: ["BLACK"],
  visibleQuantity: 1,
  observedVariant: "SANITIZED-VARIANT-BLACK",
  possibleConflicts: [],
  confidence: "HIGH",
  humanDecision: "ACCEPT_FOR_ANALYSIS",
  humanReason: "SANITIZED_IMAGE_MATCH_CONFIRMED",
})
const SANITIZED_VISUAL_RECORD = {
  contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
  imageId: "sanitized-main",
  sourceUrl: SANITIZED_IMAGE_URL,
  sourceReference: "sanitized deterministic source image",
  reviewerType: "HUMAN" as const,
  observedProductType: "SANITIZED_PRODUCT",
  visibleFeatures: ["sanitized feature"],
  visibleText: [],
  visibleBrands: [],
  visibleColors: ["BLACK"],
  visibleQuantity: 1,
  observedVariant: "SANITIZED-VARIANT-BLACK",
  possibleConflicts: [],
  contradictsEvidenceIds: [],
  confidence: "HIGH" as const,
  humanDecision: "ACCEPT_FOR_ANALYSIS" as const,
  humanReason: "SANITIZED_IMAGE_MATCH_CONFIRMED",
  reviewedAt: SANITIZED_CAPTURED_AT,
  rawHumanInput: SANITIZED_VISUAL_RAW,
}
const SANITIZED_IDENTITY_EVIDENCE_IDS:
  ProductCaseHumanIdentityReview["evidenceIds"] = [
  "san-brand",
  "san-color",
  "san-model",
  "san-mpn",
  "san-pack",
  "san-product-id",
  "san-product-type",
  "san-sku",
  "san-title",
  "san-variant-id",
  SANITIZED_VISUAL_EVIDENCE_ID,
]
const SANITIZED_PHYSICAL_IDENTITY_EVIDENCE_IDS:
  ProductCaseHumanIdentityReview["physicalVerificationEvidenceIds"] = [
  "san-brand",
  "san-color",
  "san-model",
  "san-mpn",
  "san-pack",
  "san-product-id",
  "san-sku",
  "san-variant-id",
]
const SANITIZED_IDENTITY_RAW_INPUT = {
  reviewer: "SANITIZED_IDENTITY_REVIEWER",
  decision: "IDENTITY_CONFIRMED",
  confidence: "HIGH",
  humanReason:
    "Independent sanitized physical evidence confirms the exact identity.",
  evidenceIds: SANITIZED_IDENTITY_EVIDENCE_IDS,
  sameGeneralProductTypeConfirmed: true,
  productType: "SANITIZED_PRODUCT",
  exactIdentityConfirmed: true,
  brandConfirmed: true,
  brand: "SANITIZED BRAND",
  model: "SAN-MODEL-001",
  mpn: "SAN-MPN-001",
  supplierProductId: "SANITIZED-PRODUCT-001",
  supplierSku: "SAN-SKU-001",
  variantId: "SANITIZED-VARIANT-BLACK",
  color: "BLACK",
  packQuantity: "1",
  physicalProductVerified: true,
  physicalVerificationEvidenceIds:
    SANITIZED_PHYSICAL_IDENTITY_EVIDENCE_IDS,
}

function sanitizedIdentityProvenanceReference(input: {
  evidenceId: string
  field: ProductCaseEvidenceField
  sourceType?: ProductCaseEvidence["sourceType"]
  evidenceClass?: ProductCaseEvidence["evidenceClass"]
  contentHash?: `sha256:${string}`
  variantKey?: string | null
}) {
  const evidenceClass = input.evidenceClass ?? "PRODUCT_VERIFIED"
  return {
    evidenceId: input.evidenceId,
    field: input.field,
    sourceType: input.sourceType ?? "HUMAN_PRODUCT_INSPECTION",
    evidenceClass,
    sourceEvidenceClass: evidenceClass,
    contentHash: input.contentHash ?? SANITIZED_CAPTURE_HASH,
    variantKey: input.variantKey ?? null,
  }
}

const SANITIZED_SELECTED_IDENTITY_PROVENANCE = [
  sanitizedIdentityProvenanceReference({ evidenceId: "san-brand", field: "brand" }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-color", field: "color" }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-model", field: "model" }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-mpn", field: "mpn" }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-pack", field: "pack_quantity" }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-product-id", field: "supplier_product_id" }),
  sanitizedIdentityProvenanceReference({
    evidenceId: "san-product-type",
    field: "product_type",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    evidenceClass: "SUPPLIER_STATED",
  }),
  sanitizedIdentityProvenanceReference({ evidenceId: "san-sku", field: "supplier_sku" }),
  sanitizedIdentityProvenanceReference({
    evidenceId: "san-title",
    field: "title",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    evidenceClass: "SUPPLIER_STATED",
  }),
  sanitizedIdentityProvenanceReference({
    evidenceId: "san-variant-id",
    field: "variant_id",
    variantKey: "BLACK",
  }),
  sanitizedIdentityProvenanceReference({
    evidenceId: SANITIZED_VISUAL_EVIDENCE_ID,
    field: "visual_observation",
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    evidenceClass: "HUMAN_VISUAL_REVIEW",
    contentHash: SANITIZED_VISUAL_HASH,
  }),
]
const SANITIZED_IDENTITY_HASH =
  "sha256:0995fb19118c99f8261db9b17a86b8176d9a938d807e9ffd2a7966d25cd3c360"
const SANITIZED_IDENTITY_REVIEW = {
  contractVersion: HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
  reviewId: "identity-review-0995fb19118c99f8",
  contentHash: SANITIZED_IDENTITY_HASH,
  reviewer: "SANITIZED_IDENTITY_REVIEWER",
  reviewedAt: SANITIZED_CAPTURED_AT,
  decision: "IDENTITY_CONFIRMED",
  status: "READY",
  confidence: "HIGH",
  humanReason:
    "Independent sanitized physical evidence confirms the exact identity.",
  evidenceIds: SANITIZED_IDENTITY_EVIDENCE_IDS,
  sameGeneralProductTypeConfirmed: true,
  productType: "SANITIZED_PRODUCT",
  exactIdentityConfirmed: true,
  brandConfirmed: true,
  brand: "SANITIZED BRAND",
  model: "SAN-MODEL-001",
  mpn: "SAN-MPN-001",
  supplierProductId: "SANITIZED-PRODUCT-001",
  supplierSku: "SAN-SKU-001",
  variantId: "SANITIZED-VARIANT-BLACK",
  color: "BLACK",
  packQuantity: 1,
  provenance: {
    selectedEvidence: SANITIZED_SELECTED_IDENTITY_PROVENANCE,
    productType: [
      sanitizedIdentityProvenanceReference({
        evidenceId: "san-product-type",
        field: "product_type",
        sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
        evidenceClass: "SUPPLIER_STATED",
      }),
      sanitizedIdentityProvenanceReference({
        evidenceId: "san-title",
        field: "title",
        sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
        evidenceClass: "SUPPLIER_STATED",
      }),
      sanitizedIdentityProvenanceReference({
        evidenceId: SANITIZED_VISUAL_EVIDENCE_ID,
        field: "visual_observation",
        sourceType: "HUMAN_VISUAL_OBSERVATION",
        evidenceClass: "HUMAN_VISUAL_REVIEW",
        contentHash: SANITIZED_VISUAL_HASH,
      }),
    ],
    packQuantity: [sanitizedIdentityProvenanceReference({
      evidenceId: "san-pack",
      field: "pack_quantity",
    })],
  },
  availableFields: [
    "product_type",
    "brand",
    "model",
    "mpn",
    "supplier_product_id",
    "supplier_sku",
    "variant_id",
    "color",
    "pack_quantity",
  ],
  missingFields: [],
  physicalProductVerified: true,
  physicalVerificationEvidenceIds:
    SANITIZED_PHYSICAL_IDENTITY_EVIDENCE_IDS,
  rawHumanInput: SANITIZED_IDENTITY_RAW_INPUT,
} satisfies ProductCaseHumanIdentityReview

function sanitizedEvidence(input: {
  id: string
  field: ProductCaseEvidenceField
  value: unknown
  evidenceClass?: ProductCaseEvidence["evidenceClass"]
  sourceType?: ProductCaseEvidence["sourceType"]
  contentHash?: string
  extractionMethod?: ProductCaseEvidence["extractionMethod"]
  extractionPath?: string
  humanReason?: string | null
}): ProductCaseEvidence {
  const evidenceClass = input.evidenceClass ?? "PRODUCT_VERIFIED"
  const human = input.sourceType === "HUMAN_CORRECTION"
  const sourceType = input.sourceType ??
    (evidenceClass === "PRODUCT_VERIFIED"
      ? "HUMAN_PRODUCT_INSPECTION"
      : "LUNA_AUTHENTICATED_MANUAL_CAPTURE")
  return {
    id: input.id,
    field: input.field,
    label: input.field.replaceAll("_", " "),
    variantKey: ["variant_id", "supplier_unit_cost"].includes(input.field)
      ? "BLACK"
      : null,
    sourceType,
    sourceUrl: SANITIZED_SOURCE_URL,
    capturedAt: SANITIZED_CAPTURED_AT,
    contentHash: input.contentHash ?? SANITIZED_CAPTURE_HASH,
    extractionPath: input.extractionPath ?? `sanitized.${input.field}`,
    extractionMethod: input.extractionMethod ??
      (sourceType === "HUMAN_PRODUCT_INSPECTION"
        ? "HUMAN_STRUCTURED_REVIEW"
        : "JSON_PATH"),
    rawValue: input.value,
    normalizedValue: input.value,
    evidenceClass,
    sourceEvidenceClass: evidenceClass,
    evidenceStatus: human ? "CORRECTED" : "ACCEPTED",
    humanVerdict: human ? "CORRECT" : "ACCEPT",
    humanReason: input.humanReason ??
      (human ? "SANITIZED_HUMAN_REVIEW" : null),
    originalValue: input.value,
    correctedValue: human ? input.value : null,
    conflictKey: null,
    availabilityPurpose: input.field === "visible_stock"
      ? "INVENTORY_SIGNAL"
      : null,
    demandEvidence: input.field === "visible_stock" ? "NONE" : null,
  }
}

const SANITIZED_EVIDENCE: ProductCaseEvidence[] = [
  sanitizedEvidence({
    id: "san-title",
    field: "title",
    value: "Sanitized Deterministic Product",
    evidenceClass: "SUPPLIER_STATED",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  }),
  sanitizedEvidence({
    id: "san-ebay-title",
    field: "ebay_optimized_title",
    value: "Sanitized Deterministic Product",
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-product-type",
    field: "product_type",
    value: "SANITIZED_PRODUCT",
    evidenceClass: "SUPPLIER_STATED",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  }),
  sanitizedEvidence({
    id: "san-brand",
    field: "brand",
    value: "SANITIZED BRAND",
  }),
  sanitizedEvidence({
    id: "san-model",
    field: "model",
    value: "SAN-MODEL-001",
  }),
  sanitizedEvidence({
    id: "san-mpn",
    field: "mpn",
    value: "SAN-MPN-001",
  }),
  sanitizedEvidence({
    id: "san-product-id",
    field: "supplier_product_id",
    value: "SANITIZED-PRODUCT-001",
  }),
  sanitizedEvidence({
    id: "san-sku",
    field: "supplier_sku",
    value: "SAN-SKU-001",
  }),
  sanitizedEvidence({
    id: "san-variant-id",
    field: "variant_id",
    value: "SANITIZED-VARIANT-BLACK",
  }),
  sanitizedEvidence({ id: "san-color", field: "color", value: "BLACK" }),
  sanitizedEvidence({ id: "san-pack", field: "pack_quantity", value: 1 }),
  sanitizedEvidence({ id: "san-stock", field: "visible_stock", value: 25 }),
  sanitizedEvidence({
    id: "san-unit-cost",
    field: "supplier_unit_cost",
    value: 10,
  }),
  sanitizedEvidence({
    id: "san-packaging",
    field: "packaging_cost",
    value: 1,
  }),
  sanitizedEvidence({
    id: "san-outbound",
    field: "outbound_shipping_cost",
    value: 5,
  }),
  sanitizedEvidence({
    id: "san-listing-price",
    field: "listing_price",
    value: 35,
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-buyer-shipping",
    field: "buyer_shipping_charge",
    value: 0,
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-product-dimensions",
    field: "product_dimensions",
    value: "10 x 5 x 2 in",
  }),
  sanitizedEvidence({
    id: "san-package-dimensions",
    field: "package_dimensions",
    value: "11 x 6 x 3 in",
  }),
  sanitizedEvidence({ id: "san-weight", field: "weight", value: "1 lb" }),
  sanitizedEvidence({
    id: "san-source-image",
    field: "source_image_url",
    value: SANITIZED_IMAGE_URL,
  }),
  sanitizedEvidence({
    id: "san-category",
    field: "ebay_category",
    value: { id: "12345", name: "Sanitized Category" },
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-condition",
    field: "ebay_condition",
    value: { id: "1000", description: "New" },
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-specific-color",
    field: "ebay_item_specific",
    value: { name: "Color", values: ["BLACK"] },
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-listing-description",
    field: "listing_description",
    value: "Sanitized deterministic product.",
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-listing-quantity",
    field: "listing_quantity",
    value: 1,
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-policy-bundle",
    field: "listing_policy_bundle",
    value: {
      fulfillmentPolicyId: "SAN-FULFILLMENT",
      paymentPolicyId: "SAN-PAYMENT",
      returnPolicyId: "SAN-RETURN",
      shippingPolicySummary: "Sanitized shipping policy",
      returnPolicySummary: "Sanitized 30-day returns",
      handlingTimeDays: 1,
    },
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: "san-item-location",
    field: "item_location",
    value: {
      country: "US",
      postalCode: "33101",
      city: "Miami",
      stateOrProvince: "FL",
    },
    evidenceClass: "HUMAN_HYPOTHESIS",
    sourceType: "HUMAN_CORRECTION",
  }),
  sanitizedEvidence({
    id: SANITIZED_VISUAL_EVIDENCE_ID,
    field: "visual_observation",
    value: SANITIZED_VISUAL_RECORD,
    evidenceClass: "HUMAN_VISUAL_REVIEW",
    sourceType: "HUMAN_VISUAL_OBSERVATION",
    contentHash: SANITIZED_VISUAL_HASH,
    extractionMethod: "HUMAN_STRUCTURED_REVIEW",
    extractionPath: "humanVisualReview.sanitized-main",
    humanReason: "SANITIZED_IMAGE_MATCH_CONFIRMED",
  }),
]

const SANITIZED_COMPARABLES:
  ProductCaseDocument["marketEvidence"]["comparables"] = Array.from(
    { length: 5 },
    (_, index) => ({
      itemId: `SAN-SOLD-${String(index + 1).padStart(3, "0")}`,
      title: `Sanitized Deterministic Product ${index + 1}`,
      sourceKind: "EBAY_SOLD",
      sourceReference: `urn:sanitized:sold:${index + 1}`,
      observedAt: SANITIZED_CAPTURED_AT,
      identityMatch: "EXACT",
      identityMatchBasis: ["HUMAN_VERIFIED"],
      offerScenario: "SINGLE",
      packQuantity: 1,
      variantComposition: ["BLACK"],
      itemPrice: 40 + index,
      buyerShipping: 0,
      currency: "USD",
      saleConfirmed: true,
      confirmedSoldQuantity: 1,
      estimatedSoldQuantity: null,
    }),
  )

const SANITIZED_DOCUMENT = {
  version: PRODUCT_CASE_RUNNER_VERSION,
  caseId: "sanitized-deterministic-complete-case-v1",
  productLabel: "Sanitized Deterministic Product",
  sourceUrl: SANITIZED_SOURCE_URL,
  createdAt: SANITIZED_CAPTURED_AT,
  sourceAccess: {
    status: "PUBLIC_ACCESSIBLE",
    canonicalUrl: SANITIZED_SOURCE_URL,
    checkedAt: SANITIZED_CAPTURED_AT,
    reason: null,
    httpStatus: 200,
    redirectsFollowed: 0,
    credentialsUsed: false,
  },
  supplierSourceCapture: null,
  captures: [
    {
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
      sourceUrl: SANITIZED_SOURCE_URL,
      capturedAt: SANITIZED_CAPTURED_AT,
      contentHash: SANITIZED_CAPTURE_HASH,
      parserVersion: PRODUCT_CASE_PARSER_VERSION,
      sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
      parseHealth: "PARSED_OK",
      stockState: "IN_STOCK_SIGNAL",
      format: "JSON",
      byteLength: 1024,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    {
      sourceType: "HUMAN_PRODUCT_INSPECTION",
      sourceUrl: SANITIZED_SOURCE_URL,
      capturedAt: SANITIZED_CAPTURED_AT,
      contentHash: SANITIZED_CAPTURE_HASH,
      parserVersion: null,
      sourceContractVersion: null,
      parseHealth: null,
      stockState: null,
      format: "JSON",
      byteLength: 1024,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    {
      sourceType: "HUMAN_CORRECTION",
      sourceUrl: SANITIZED_SOURCE_URL,
      capturedAt: SANITIZED_CAPTURED_AT,
      contentHash: SANITIZED_CAPTURE_HASH,
      parserVersion: null,
      sourceContractVersion: null,
      parseHealth: null,
      stockState: null,
      format: "JSON",
      byteLength: 1024,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
    {
      sourceType: "HUMAN_VISUAL_OBSERVATION",
      sourceUrl: SANITIZED_SOURCE_URL,
      capturedAt: SANITIZED_CAPTURED_AT,
      contentHash: SANITIZED_VISUAL_HASH,
      parserVersion: null,
      sourceContractVersion: null,
      parseHealth: null,
      stockState: null,
      format: "JSON",
      byteLength: 1150,
      fullContentStored: false,
      scriptsExecuted: false,
      resourcesLoaded: false,
    },
  ],
  evidence: SANITIZED_EVIDENCE,
  marketEvidence: {
    runStatus: "COMPLETE",
    soldExact: "AVAILABLE",
    activeExact: "MISSING",
    marketCeiling: "AVAILABLE",
    soldExactCount: 5,
    referenceMedian: 42,
    comparables: SANITIZED_COMPARABLES,
    humanSuppliedComparableCandidates: [],
    generalProductComparableResearch:
      emptyGeneralProductComparableResearch(),
    observedAt: SANITIZED_CAPTURED_AT,
  },
  imageAnalysis: {
    imageAnalysisCapability: "HUMAN_ASSISTED_ONLY",
    machineVisionStatus: "NOT_IMPLEMENTED",
    openAiVisionUsed: false,
    humanReviewRequired: true,
    visualEvidenceStatus: "HUMAN_REVIEWED",
    conflictDetectedFrom: [],
    observations: [{
      contractVersion: HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
      imageId: "sanitized-main",
      evidenceId: SANITIZED_VISUAL_EVIDENCE_ID,
      contentHash: SANITIZED_VISUAL_HASH,
      sourceUrl: SANITIZED_IMAGE_URL,
      sourceReference: "sanitized deterministic source image",
      sourceType: "SUPPLIER_IMAGE",
      verificationStatus: "SOURCE_IMAGE_OBSERVED",
      physicalProductVerified: false,
      captureMethod: "HUMAN_VISUAL_REVIEW",
      reviewerType: "HUMAN",
      observedProductType: "SANITIZED_PRODUCT",
      visibleFeatures: ["sanitized feature"],
      visibleText: [],
      visibleBrands: [],
      visibleColors: ["BLACK"],
      visibleQuantity: 1,
      observedVariant: "SANITIZED-VARIANT-BLACK",
      possibleConflicts: [],
      contradictsEvidenceIds: [],
      confidence: "HIGH",
      humanDecision: "ACCEPT_FOR_ANALYSIS",
      humanReason: "SANITIZED_IMAGE_MATCH_CONFIRMED",
      reviewedAt: SANITIZED_CAPTURED_AT,
      rawHumanInput: SANITIZED_VISUAL_RAW,
    }],
  },
  identityReview: {
    status: "READY",
    confidence: "HIGH",
    physicalProductVerified: true,
    physicalVerificationEvidenceIds:
      SANITIZED_PHYSICAL_IDENTITY_EVIDENCE_IDS,
    conflictHistory: [],
    currentConflict: null,
    supplierEvidenceIds: ["san-product-type", "san-title"],
    humanObservationEvidenceIds: [SANITIZED_VISUAL_EVIDENCE_ID],
    blockers: [],
    nextAction: "REVIEW_MARKET_EVIDENCE",
    humanReview: SANITIZED_IDENTITY_REVIEW,
  },
  supplierCatalogLimitation: {
    activeAttestation: null,
    historicalAttestations: [],
  },
  humanReview: {
    conclusion: {
      scenario: "SINGLE",
      conclusion: "GO_SINGLE",
      reason: "SANITIZED_HUMAN_STRATEGY_APPROVAL",
      reviewedAt: SANITIZED_CAPTURED_AT,
      reviewer: "SANITIZED_REVIEWER",
    },
    proposedRuleObservation: null,
    learningStatus: "HUMAN_REVIEW_DRAFT",
    canChangeEngineRules: false,
    canPublishAutomatically: false,
    canLinkListing: false,
  },
  safety: PRODUCT_CASE_ZERO_EFFECTS,
} satisfies ProductCaseDocument

const SANITIZED_ECONOMICS_POLICY = {
  version: "SANITIZED_POLICY_V1",
  feeRate: 0.13,
  fixedOrderFee: 0.3,
  returnsReserveRate: 0.03,
  promotedListingsReserveRate: 0.02,
  minimumProfit: 5,
  minimumMarginPercent: 10,
  minimumRoiPercent: 25,
}

const SANITIZED_SCENARIO_DRAFT = {
  id: "sanitized-single",
  offerScenario: "SINGLE",
  variantComposition: ["BLACK"],
  packQuantityEvidenceId: "san-pack",
  costLines: [{
    variantKey: "BLACK",
    quantity: 1,
    unitCostEvidenceId: "san-unit-cost",
  }],
  packagingCostEvidenceId: "san-packaging",
  outboundShippingCostEvidenceId: "san-outbound",
  listingPriceEvidenceId: "san-listing-price",
  buyerShippingChargeEvidenceId: "san-buyer-shipping",
  requiredIdentityFields: [
    "title",
    "supplier_product_id",
    "variant_id",
  ],
  requiredDimensionFields: [
    "product_dimensions",
    "package_dimensions",
    "weight",
  ],
  requiresExactSoldEvidence: true,
  creativeSeed: {
    positioning: "Sanitized deterministic positioning",
    heroComposition: "One verified sanitized product",
    proofEvidenceFields: ["color", "product_dimensions"],
    requiredEvidence: [],
    forbiddenTerms: ["unverified"],
  },
} satisfies ProductCaseScenarioDraft

const SANITIZED_LISTING_OPERATIONS = {
  title: "Sanitized Deterministic Product",
  categoryId: "12345",
  categoryName: "Sanitized Category",
  conditionId: "1000",
  conditionDescription: "New",
  itemSpecifics: { Color: ["BLACK"] },
  requiredItemSpecifics: ["Color"],
  description: "Sanitized deterministic product.",
  listingPrice: 35,
  quantity: 1,
  totalInvestment: 16,
  estimatedProfit: 12.4,
  marginPercent: 35.43,
  roiPercent: 77.5,
  fulfillmentPolicyId: "SAN-FULFILLMENT",
  paymentPolicyId: "SAN-PAYMENT",
  returnPolicyId: "SAN-RETURN",
  shippingPolicySummary: "Sanitized shipping policy",
  returnPolicySummary: "Sanitized 30-day returns",
  handlingTimeDays: 1,
  itemLocation: {
    country: "US",
    postalCode: "33101",
    city: "Miami",
    stateOrProvince: "FL",
  },
  imageEvidenceOrder: ["image-01"],
  supportingEvidenceIds: SANITIZED_EVIDENCE.map((entry) => entry.id),
  evidenceLinks: {
    title: ["san-ebay-title"],
    category: ["san-category"],
    condition: ["san-condition"],
    itemSpecifics: { Color: ["san-specific-color"] },
    description: ["san-listing-description"],
    listingPrice: ["san-listing-price"],
    quantity: ["san-listing-quantity"],
    economics: ["san-unit-cost", "san-packaging", "san-outbound"],
    policies: ["san-policy-bundle"],
    itemLocation: ["san-item-location"],
  },
  assumptions: [],
  blockers: [],
  differences: [],
  supplierAvailabilityStatus: "CONFIRMED_AVAILABLE",
  brandIpClaimsReview: {
    status: "APPROVED",
    reviewer: "SANITIZED_REVIEWER",
    reviewedAt: SANITIZED_CAPTURED_AT,
    reason: "SANITIZED_BRAND_IP_CLAIMS_REVIEW_COMPLETE",
  },
  explicitHumanApproval: {
    approved: true,
    reviewer: "SANITIZED_REVIEWER",
    reviewedAt: SANITIZED_CAPTURED_AT,
    reason: "SANITIZED_MANUAL_HANDOFF_APPROVED",
  },
  humanOverride: {
    applied: false,
    reviewer: null,
    reviewedAt: null,
    reason: null,
    overriddenBlockers: [],
  },
  candidateKey: "sanitized-deterministic-candidate",
} satisfies ProductCaseListingOperations

const SANITIZED_IMAGE_APPROVALS = [{
  evidenceId: "san-source-image",
  sourceKind: "ORIGINAL_SUPPLIER",
  sourceUrl: SANITIZED_IMAGE_URL,
  assetHash:
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  purpose: "SANITIZED_MAIN",
  role: "MAIN",
  order: 1,
  variantId: "SANITIZED-VARIANT-BLACK",
  packQuantity: 1,
  humanNotes: "Sanitized main image approved.",
  status: "APPROVED",
  reviewer: "SANITIZED_REVIEWER",
  reviewedAt: SANITIZED_CAPTURED_AT,
  reason: "SANITIZED_IMAGE_QA_COMPLETE",
  qa: {
    productAndVariantMatch: true,
    packQuantityMatch: true,
    logosAndIpReviewed: true,
    claimsReviewed: true,
    ebayRoleCoherent: true,
  },
}] satisfies ProductCaseImageApproval[]

const SANITIZED_ADAPTER = buildStrategyLabAdapterPreview({
  document: SANITIZED_DOCUMENT,
  evaluatedAt: SANITIZED_CAPTURED_AT,
  economicsPolicy: SANITIZED_ECONOMICS_POLICY,
  scenarioDraft: SANITIZED_SCENARIO_DRAFT,
})

export const SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT =
  buildProductCaseRunnerOutput({
    document: SANITIZED_DOCUMENT,
    adapter: SANITIZED_ADAPTER,
    imageApprovals: SANITIZED_IMAGE_APPROVALS,
    listingOperations: SANITIZED_LISTING_OPERATIONS,
    generatedAt: SANITIZED_CAPTURED_AT,
  })

export const SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE = {
  fixtureClass: "SANITIZED_DETERMINISTIC",
  liveMarketEvidence: false,
  linkedToOwnEbayListing: false,
  workspaceState: {
    document: SANITIZED_DOCUMENT,
    economicsPolicy: SANITIZED_ECONOMICS_POLICY,
    scenarioDraft: SANITIZED_SCENARIO_DRAFT,
    listingOperations: SANITIZED_LISTING_OPERATIONS,
    imageApprovals: SANITIZED_IMAGE_APPROVALS,
    imageObservations: SANITIZED_DOCUMENT.imageAnalysis.observations,
    evaluatedAt: SANITIZED_CAPTURED_AT,
    generatedAt: SANITIZED_CAPTURED_AT,
  } satisfies ProductCaseWorkspaceState,
  adapter: SANITIZED_ADAPTER,
  output: SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT,
} as const

export const PRODUCT_CASE_RUNNER_FIXTURES = [
  GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE,
] as const
