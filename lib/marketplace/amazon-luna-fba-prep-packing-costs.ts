export const AMAZON_LUNA_FBA_PREP_PACKING_COSTS_VERSION =
  "AMAZON_LUNA_FBA_PREP_PACKING_COSTS_V1"

type CustomerType =
  | "LUNA_CLIENT"
  | "EXTERNAL_CLIENT"

type FulfillmentPath =
  | "FBA"
  | "FBM"
  | "UNKNOWN"

type CostStatus =
  | "READY"
  | "QUOTE_REQUIRED"
  | "NEED_UNIT_COST_INPUT"
  | "NEED_EXPECTED_MONTHLY_UNITS"

type BoxSize =
  | "SMALL"
  | "MEDIUM"
  | "LARGE"

type FbmMaterialRequirement = {
  materialKey?: string | null
  label?: string | null
  packQuantity?: number | null
  costPerPack?: number | null
  costStatus?: string | null
}

type OperationalCostEntry = {
  productKey?: string | null
  productTitle?: string | null
  fulfillmentPath?: string | null
  customerType?: string | null
  preparedAndSentToFbaWithLuna?: boolean | null
  fnSkuLabelingRequired?: boolean | null
  productRequiresPrep?: boolean | null
  bundleUnits?: number | null
  wrapUnits?: number | null
  boxRequired?: boolean | null
  boxSize?: string | null
  unitsPerBox?: number | null
  palletRequired?: boolean | null
  unitsPerPallet?: number | null
  fbmPackingMaterialType?: string | null
  expectedMonthlyUnits?: number | null
}

type LunaPrepFixture = {
  nextLoop?: string | null
  professionalSellerPlan?: {
    monthlyFee?: number | null
  } | null
  fbaPrepRules?: {
    inventoryReception?: {
      preparedAndSentToFbaWithLuna?: number | null
      notSentToFba?: number | null
    } | null
    fnSkuLabeling?: {
      lunaClient?: number | null
      externalClient?: number | null
    } | null
    bundlePreparation?: {
      lunaClient?: Record<string, number> | null
      externalClient?: Record<string, number> | null
    } | null
    bundleWrap?: {
      lunaClient?: Record<string, number> | null
      externalClient?: Record<string, number> | null
    } | null
    boxes?: {
      lunaClient?: Record<string, number> | null
      externalClient?: Record<string, number> | null
    } | null
    palletWrapping?: number | null
  } | null
  fbmMaterialRequirements?: FbmMaterialRequirement[] | null
  operationalCostAssessments?: OperationalCostEntry[] | null
}

const defaultProfessionalMonthlyFee =
  39.99

const defaultFixture: LunaPrepFixture = {
  nextLoop:
    "149G - Amazon Listing Package Builder",
  professionalSellerPlan:
    {
      monthlyFee:
        defaultProfessionalMonthlyFee,
    },
  fbaPrepRules:
    {
      inventoryReception:
        {
          preparedAndSentToFbaWithLuna:
            0,
          notSentToFba:
            0.2,
        },
      fnSkuLabeling:
        {
          lunaClient:
            0.5,
          externalClient:
            0.8,
        },
      bundlePreparation:
        {
          lunaClient:
            { "1": 0.6, "3": 0.8, "6": 1, "12": 1.25 },
          externalClient:
            { "1": 1, "3": 1.25, "6": 1.5, "12": 2 },
        },
      bundleWrap:
        {
          lunaClient:
            { "1": 1, "3": 1.25, "6": 1.75, "12": 2 },
          externalClient:
            { "1": 1.5, "3": 2, "6": 2.5, "12": 3 },
        },
      boxes:
        {
          lunaClient:
            { SMALL: 2, MEDIUM: 3, LARGE: 4 },
          externalClient:
            { SMALL: 3, MEDIUM: 4, LARGE: 5 },
        },
      palletWrapping:
        10,
    },
  fbmMaterialRequirements:
    [
      { materialKey: "shipping_labels_4x6", label: "Shipping labels 4x6", packQuantity: 100, costStatus: "NEED_UNIT_COST_INPUT" },
      { materialKey: "fnsku_labels_2x1", label: "FN-SKU labels 2x1", packQuantity: 100, costStatus: "NEED_UNIT_COST_INPUT" },
      { materialKey: "fbm_poly_mailer_14_5x19", label: "FBM Poly Mailers 14.5x19", packQuantity: 100, costStatus: "NEED_UNIT_COST_INPUT" },
      { materialKey: "fbm_poly_mailer_19x24", label: "FBM Poly Mailers 19x24", packQuantity: 60, costStatus: "NEED_UNIT_COST_INPUT" },
      { materialKey: "fbm_bubble_mailer_8_5x12", label: "FBM Bubble Mailers 8.5x12", packQuantity: 100, costStatus: "NEED_UNIT_COST_INPUT" },
    ],
}

function money(value: number) {
  return Number(value.toFixed(2))
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean"
    ? value
    : fallback
}

function normalizeLoop(value: unknown, fallback: string) {
  const text =
    normalizeText(value)

  return text?.split(" ")[0] ?? fallback
}

function customerRateKey(customerType: CustomerType) {
  return customerType === "LUNA_CLIENT"
    ? "lunaClient"
    : "externalClient"
}

function quoteAwareTableCost(table: Record<string, number> | null | undefined, units: number) {
  if (units <= 0) {
    return {
      amount:
        0,
      status:
        "READY" as CostStatus,
    }
  }

  if (units > 12) {
    return {
      amount:
        0,
      status:
        "QUOTE_REQUIRED" as CostStatus,
    }
  }

  const exactUnits =
    [1, 3, 6, 12].find(value => units <= value) ?? 12

  return {
    amount:
      money(table?.[String(exactUnits)] ?? 0),
    status:
      "READY" as CostStatus,
  }
}

export function buildLunaFbaPrepPackingCostSchedule(fixture?: LunaPrepFixture | null) {
  const source =
    fixture ?? defaultFixture

  return {
    lunaPrepPackingVersion:
      AMAZON_LUNA_FBA_PREP_PACKING_COSTS_VERSION,
    professionalSellerPlanMonthlyFee:
      money(normalizeNumber(source.professionalSellerPlan?.monthlyFee, defaultProfessionalMonthlyFee)),
    fbaPrepRules:
      source.fbaPrepRules ?? defaultFixture.fbaPrepRules,
    fbmMaterialRequirements:
      source.fbmMaterialRequirements ?? defaultFixture.fbmMaterialRequirements ?? [],
    sellerCentralVerified:
      false,
    spApiVerified:
      false,
    nextLoop:
      normalizeLoop(source.nextLoop, "149G"),
  }
}

export function normalizeLunaPrepCustomerType(value: unknown): CustomerType {
  return normalizeText(value)?.toUpperCase() === "EXTERNAL_CLIENT"
    ? "EXTERNAL_CLIENT"
    : "LUNA_CLIENT"
}

export function calculateInventoryReceptionCost(values: {
  preparedAndSentToFbaWithLuna?: boolean | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  const rules =
    values.schedule?.fbaPrepRules?.inventoryReception ?? defaultFixture.fbaPrepRules?.inventoryReception

  return money(
    values.preparedAndSentToFbaWithLuna
      ? normalizeNumber(rules?.preparedAndSentToFbaWithLuna, 0)
      : normalizeNumber(rules?.notSentToFba, 0.2),
  )
}

export function calculateFnSkuLabelingCost(values: {
  customerType?: string | null
  fnSkuLabelingRequired?: boolean | null
  productRequiresPrep?: boolean | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  if (!values.fnSkuLabelingRequired || values.productRequiresPrep) {
    return 0
  }

  const customerType =
    normalizeLunaPrepCustomerType(values.customerType)
  const rules =
    values.schedule?.fbaPrepRules?.fnSkuLabeling ?? defaultFixture.fbaPrepRules?.fnSkuLabeling

  return money(normalizeNumber(rules?.[customerRateKey(customerType)], customerType === "LUNA_CLIENT" ? 0.5 : 0.8))
}

export function calculateBundlePreparationCost(values: {
  customerType?: string | null
  bundleUnits?: number | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  const customerType =
    normalizeLunaPrepCustomerType(values.customerType)
  const rules =
    values.schedule?.fbaPrepRules?.bundlePreparation?.[customerRateKey(customerType)]

  return quoteAwareTableCost(rules, Math.max(0, Math.round(normalizeNumber(values.bundleUnits, 0))))
}

export function calculateBundleWrapCost(values: {
  customerType?: string | null
  wrapUnits?: number | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  const customerType =
    normalizeLunaPrepCustomerType(values.customerType)
  const rules =
    values.schedule?.fbaPrepRules?.bundleWrap?.[customerRateKey(customerType)]

  return quoteAwareTableCost(rules, Math.max(0, Math.round(normalizeNumber(values.wrapUnits, 0))))
}

export function calculateBoxCost(values: {
  customerType?: string | null
  boxRequired?: boolean | null
  boxSize?: string | null
  unitsPerBox?: number | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  if (!values.boxRequired) {
    return 0
  }

  const customerType =
    normalizeLunaPrepCustomerType(values.customerType)
  const size =
    (normalizeText(values.boxSize)?.toUpperCase() ?? "SMALL") as BoxSize
  const rawCost =
    normalizeNumber(values.schedule?.fbaPrepRules?.boxes?.[customerRateKey(customerType)]?.[size], 0)
  const unitsPerBox =
    Math.max(1, normalizeNumber(values.unitsPerBox, 1))

  return money(rawCost / unitsPerBox)
}

export function calculatePalletCost(values: {
  palletRequired?: boolean | null
  schedule?: ReturnType<typeof buildLunaFbaPrepPackingCostSchedule> | null
}) {
  return values.palletRequired
    ? money(normalizeNumber(values.schedule?.fbaPrepRules?.palletWrapping, 10))
    : 0
}

export function calculatePalletCostAllocation(values: {
  palletCost?: number | null
  unitsPerPallet?: number | null
}) {
  const unitsPerPallet =
    Math.max(1, normalizeNumber(values.unitsPerPallet, 1))

  return money(normalizeNumber(values.palletCost, 0) / unitsPerPallet)
}

export function buildFbaPrepRequirementAssessment(entry: OperationalCostEntry, schedule = buildLunaFbaPrepPackingCostSchedule()) {
  const customerType =
    normalizeLunaPrepCustomerType(entry.customerType)
  const bundlePreparation =
    calculateBundlePreparationCost({ customerType, bundleUnits: entry.bundleUnits, schedule })
  const bundleWrap =
    calculateBundleWrapCost({ customerType, wrapUnits: entry.wrapUnits, schedule })
  const palletCost =
    calculatePalletCost({ palletRequired: entry.palletRequired, schedule })
  const palletCostAllocatedPerUnit =
    calculatePalletCostAllocation({ palletCost, unitsPerPallet: entry.unitsPerPallet })

  return {
    customerType,
    inventoryReceptionCost:
      calculateInventoryReceptionCost({
        preparedAndSentToFbaWithLuna:
          entry.preparedAndSentToFbaWithLuna,
        schedule,
      }),
    fnSkuLabelingCost:
      calculateFnSkuLabelingCost({
        customerType,
        fnSkuLabelingRequired:
          entry.fnSkuLabelingRequired,
        productRequiresPrep:
          entry.productRequiresPrep,
        schedule,
      }),
    bundlePreparationCost:
      bundlePreparation.amount,
    bundlePreparationStatus:
      bundlePreparation.status,
    bundleWrapCost:
      bundleWrap.amount,
    bundleWrapStatus:
      bundleWrap.status,
    boxCost:
      calculateBoxCost({
        customerType,
        boxRequired:
          entry.boxRequired,
        boxSize:
          entry.boxSize,
        unitsPerBox:
          entry.unitsPerBox,
        schedule,
      }),
    palletCost,
    palletCostAllocatedPerUnit,
  }
}

export function buildFbmPackingMaterialRequirement(
  materialKey?: string | null,
  schedule = buildLunaFbaPrepPackingCostSchedule(),
) {
  const key =
    normalizeText(materialKey) ?? "unknown_fbm_material"
  const requirement =
    schedule.fbmMaterialRequirements.find(entry => entry.materialKey === key) ?? {
      materialKey:
        key,
      label:
        key,
      costStatus:
        "NEED_UNIT_COST_INPUT",
    }

  return {
    materialKey:
      requirement.materialKey ?? key,
    label:
      requirement.label ?? key,
    packQuantity:
      typeof requirement.packQuantity === "number" ? requirement.packQuantity : null,
    costPerPack:
      typeof requirement.costPerPack === "number" ? requirement.costPerPack : null,
    costStatus:
      (requirement.costStatus ?? "NEED_UNIT_COST_INPUT") as CostStatus,
  }
}

export function calculateFbmPackingMaterialCost(requirement: ReturnType<typeof buildFbmPackingMaterialRequirement>) {
  if (typeof requirement.costPerPack !== "number" || typeof requirement.packQuantity !== "number" || requirement.packQuantity <= 0) {
    return {
      costPerUnit:
        0,
      costStatus:
        "NEED_UNIT_COST_INPUT" as CostStatus,
    }
  }

  return {
    costPerUnit:
      money(requirement.costPerPack / requirement.packQuantity),
    costStatus:
      "READY" as CostStatus,
  }
}

export function buildAmazonProfessionalSellerPlanFeeAllocation(values: {
  expectedMonthlyUnits?: number | null
  monthlyFee?: number | null
}) {
  const monthlyFee =
    money(normalizeNumber(values.monthlyFee, defaultProfessionalMonthlyFee))
  const expectedMonthlyUnits =
    Math.max(0, Math.round(normalizeNumber(values.expectedMonthlyUnits, 0)))

  return {
    amazonProfessionalPlanMonthlyFee:
      monthlyFee,
    expectedMonthlyUnits,
    professionalPlanFeePerUnit:
      expectedMonthlyUnits > 0 ? money(monthlyFee / expectedMonthlyUnits) : 0,
    status:
      expectedMonthlyUnits > 0 ? "READY" as CostStatus : "NEED_EXPECTED_MONTHLY_UNITS" as CostStatus,
  }
}

export function buildAmazonOperationalCostStack(
  entry: OperationalCostEntry,
  schedule = buildLunaFbaPrepPackingCostSchedule(),
) {
  const fulfillmentPath =
    (normalizeText(entry.fulfillmentPath)?.toUpperCase() ?? "UNKNOWN") as FulfillmentPath
  const fbaPrep =
    buildFbaPrepRequirementAssessment(entry, schedule)
  const fbmMaterial =
    buildFbmPackingMaterialRequirement(entry.fbmPackingMaterialType, schedule)
  const fbmMaterialCost =
    fulfillmentPath === "FBM"
      ? calculateFbmPackingMaterialCost(fbmMaterial)
      : { costPerUnit: 0, costStatus: "READY" as CostStatus }
  const professionalPlan =
    buildAmazonProfessionalSellerPlanFeeAllocation({
      expectedMonthlyUnits:
        entry.expectedMonthlyUnits,
      monthlyFee:
        schedule.professionalSellerPlanMonthlyFee,
    })
  const totalLunaPrepPackingCost =
    money(
      fbaPrep.inventoryReceptionCost +
      fbaPrep.fnSkuLabelingCost +
      fbaPrep.bundlePreparationCost +
      fbaPrep.bundleWrapCost +
      fbaPrep.boxCost +
      fbaPrep.palletCostAllocatedPerUnit,
    )
  const totalOperationalCostAddOn =
    money(
      totalLunaPrepPackingCost +
      fbmMaterialCost.costPerUnit +
      professionalPlan.professionalPlanFeePerUnit,
    )
  const warnings =
    [
      professionalPlan.status === "NEED_EXPECTED_MONTHLY_UNITS" ? "NEED_EXPECTED_MONTHLY_UNITS" : "",
      fbaPrep.bundlePreparationStatus === "QUOTE_REQUIRED" ? "Bundle preparation quote required for more than 12 units." : "",
      fbaPrep.bundleWrapStatus === "QUOTE_REQUIRED" ? "Bundle wrap quote required for more than 12 units." : "",
      fbmMaterialCost.costStatus === "NEED_UNIT_COST_INPUT" ? "FBM packing material unit cost input is required; no cost was invented." : "",
    ].filter(Boolean)

  return {
    productKey:
      normalizeText(entry.productKey) ?? "unknown-product",
    productTitle:
      normalizeText(entry.productTitle) ?? "Untitled operational cost candidate",
    fulfillmentPath,
    customerType:
      fbaPrep.customerType,
    inventoryReceptionCost:
      fbaPrep.inventoryReceptionCost,
    fnSkuLabelingCost:
      fbaPrep.fnSkuLabelingCost,
    bundlePreparationCost:
      fbaPrep.bundlePreparationCost,
    bundleWrapCost:
      fbaPrep.bundleWrapCost,
    boxCost:
      fbaPrep.boxCost,
    palletCost:
      fbaPrep.palletCost,
    palletCostAllocatedPerUnit:
      fbaPrep.palletCostAllocatedPerUnit,
    fbmPackingMaterialType:
      fbmMaterial.materialKey,
    fbmPackingMaterialCostPerUnit:
      fbmMaterialCost.costPerUnit,
    fbmPackingMaterialCostStatus:
      fbmMaterialCost.costStatus,
    amazonProfessionalPlanMonthlyFee:
      professionalPlan.amazonProfessionalPlanMonthlyFee,
    expectedMonthlyUnits:
      professionalPlan.expectedMonthlyUnits,
    professionalPlanFeePerUnit:
      professionalPlan.professionalPlanFeePerUnit,
    totalLunaPrepPackingCost,
    totalOperationalCostAddOn,
    warnings,
  }
}

export function buildAmazonOperationalCostAssessmentQueue(fixture?: LunaPrepFixture | null) {
  const schedule =
    buildLunaFbaPrepPackingCostSchedule(fixture)
  const source =
    fixture ?? defaultFixture
  const assessments =
    (source.operationalCostAssessments ?? []).map(entry =>
      buildAmazonOperationalCostStack(entry, schedule),
    )

  return {
    lunaPrepPackingVersion:
      AMAZON_LUNA_FBA_PREP_PACKING_COSTS_VERSION,
    assessments,
    sellerCentralVerified:
      false,
    spApiVerified:
      false,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      schedule.nextLoop,
  }
}

export function summarizeAmazonLunaFbaPrepPackingCosts(fixture?: LunaPrepFixture | null) {
  const schedule =
    buildLunaFbaPrepPackingCostSchedule(fixture)
  const queue =
    buildAmazonOperationalCostAssessmentQueue(fixture)
  const dm0628n =
    queue.assessments.find(entry => entry.productKey === "dm0628n")
  const fbaRules =
    schedule.fbaPrepRules
  const fbmMaterialRequirements =
    schedule.fbmMaterialRequirements

  return {
    lunaPrepPackingScheduleBuilt:
      true,
    fbaPrepCostRulesLoaded:
      [
        fbaRules?.inventoryReception,
        fbaRules?.fnSkuLabeling,
        fbaRules?.bundlePreparation,
        fbaRules?.bundleWrap,
        fbaRules?.boxes,
        fbaRules?.palletWrapping,
      ].filter(Boolean).length,
    fbmMaterialRequirementsLoaded:
      fbmMaterialRequirements.length,
    professionalSellerPlanFeeModeled:
      schedule.professionalSellerPlanMonthlyFee === defaultProfessionalMonthlyFee,
    operationalCostAssessmentsBuilt:
      queue.assessments.length,
    lunaClientCostRules:
      4,
    externalClientCostRules:
      4,
    quoteRequiredRules:
      queue.assessments.filter(entry => entry.warnings.some(warning => warning.includes("quote required"))).length,
    fbmMaterialsNeedingUnitCostInput:
      fbmMaterialRequirements.filter(entry => entry.costStatus === "NEED_UNIT_COST_INPUT").length,
    dm0628nFulfillmentPath:
      dm0628n?.fulfillmentPath ?? "UNKNOWN",
    dm0628nFnSkuLabelingCost:
      dm0628n?.fnSkuLabelingCost ?? 0,
    dm0628nProfessionalPlanFeePerUnit:
      dm0628n?.professionalPlanFeePerUnit ?? 0,
    dm0628nTotalOperationalCostAddOn:
      dm0628n?.totalOperationalCostAddOn ?? 0,
    sellerCentralVerified:
      false,
    spApiVerified:
      false,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      queue.nextLoop,
  }
}

export function getAmazonLunaFbaPrepPackingCostChecklist() {
  return [
    "Model Luna Warehouse FBA prep and packing costs separately from Amazon FBA fulfillment fees.",
    "Allocate Amazon Professional seller monthly plan fee by expected monthly units.",
    "Keep FBM packing materials as requirements when pack costs are missing.",
    "Require quote status for bundle preparation above 12 units.",
    "Keep the module local and pure: no API, no scraper, no Seller Central write, no publication.",
  ]
}
