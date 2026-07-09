export const AMAZON_REFERRAL_FEE_SCHEDULE_VERSION =
  "AMAZON_REFERRAL_FEE_SCHEDULE_CATEGORY_RESOLVER_V1"

type FeeRuleType =
  | "SIMPLE_PERCENT"
  | "PRICE_BAND_PERCENT"
  | "TIERED_PORTION_PERCENT"
  | "SPECIAL_CASE"
  | "UNKNOWN_CATEGORY_FALLBACK"

type CategoryConfidence =
  | "HIGH"
  | "MEDIUM"
  | "LOW"

type PriceBand = {
  minExclusive?: number | null
  max?: number | null
  percent: number
}

type Tier = {
  upTo?: number | null
  above?: number | null
  percent: number
}

type SpecialCase = {
  match: string
  percent: number
}

type ReferralFeeRule = {
  categoryLabel: string
  ruleType: FeeRuleType
  percent?: number | null
  bands?: PriceBand[] | null
  tiers?: Tier[] | null
  specialCases?: SpecialCase[] | null
  minimumFeeAmount?: number | null
}

type ReferralFeeScheduleFixture = {
  categories?: ReferralFeeRule[] | null
  sellerCentralVerified?: boolean | null
  spApiVerified?: boolean | null
  nextLoop?: string | null
}

const fallbackCategory =
  "Everything Else"

const categoryAliases: Record<string, string> = {
  "cleaning household": "Home and Kitchen",
  "cleaning": "Home and Kitchen",
  "household": "Home and Kitchen",
  "dishwasher cleaner": "Home and Kitchen",
  "detergent booster": "Home and Kitchen",
  "electrical": "Tools and Home Improvement",
  "outlet adapter": "Tools and Home Improvement",
  "wall tap": "Tools and Home Improvement",
  "aerosol paint": "Everything Else",
  "aerosol spray paint": "Everything Else",
}

const defaultSchedule: ReferralFeeRule[] = [
  { categoryLabel: "Amazon Device Accessories", ruleType: "SIMPLE_PERCENT", percent: 0.45, minimumFeeAmount: 0.3 },
  { categoryLabel: "Appliances - Compact", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 300, percent: 0.15 }, { above: 300, percent: 0.08 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Appliances - Full-size", ruleType: "SIMPLE_PERCENT", percent: 0.08, minimumFeeAmount: 0.3 },
  { categoryLabel: "Automotive and Powersports", ruleType: "SIMPLE_PERCENT", percent: 0.12, minimumFeeAmount: 0.3 },
  { categoryLabel: "Base Equipment Power Tools", ruleType: "SIMPLE_PERCENT", percent: 0.12, minimumFeeAmount: 0.3 },
  { categoryLabel: "Baby Products", ruleType: "PRICE_BAND_PERCENT", bands: [{ max: 10, percent: 0.08 }, { minExclusive: 10, percent: 0.15 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Beauty, Health, and Personal Care", ruleType: "PRICE_BAND_PERCENT", bands: [{ max: 10, percent: 0.08 }, { minExclusive: 10, percent: 0.15 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Business, Industrial, and Scientific Supplies", ruleType: "SIMPLE_PERCENT", percent: 0.12, minimumFeeAmount: 0.3 },
  { categoryLabel: "Clothing and Accessories", ruleType: "PRICE_BAND_PERCENT", bands: [{ max: 15, percent: 0.05 }, { minExclusive: 15, max: 20, percent: 0.1 }, { minExclusive: 20, percent: 0.17 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Computers", ruleType: "SIMPLE_PERCENT", percent: 0.08, minimumFeeAmount: 0.3 },
  { categoryLabel: "Consumer Electronics", ruleType: "SIMPLE_PERCENT", percent: 0.08, minimumFeeAmount: 0.3 },
  { categoryLabel: "Electronics Accessories", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 100, percent: 0.15 }, { above: 100, percent: 0.08 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Eyewear", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Fine Art", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 100, percent: 0.2 }, { upTo: 1000, percent: 0.15 }, { upTo: 5000, percent: 0.1 }, { above: 5000, percent: 0.05 }], minimumFeeAmount: 1 },
  { categoryLabel: "Footwear", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Furniture", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 200, percent: 0.15 }, { above: 200, percent: 0.1 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Gift Cards", ruleType: "SIMPLE_PERCENT", percent: 0.2, minimumFeeAmount: null },
  { categoryLabel: "Grocery and Gourmet", ruleType: "PRICE_BAND_PERCENT", bands: [{ max: 15, percent: 0.08 }, { minExclusive: 15, percent: 0.15 }], minimumFeeAmount: null },
  { categoryLabel: "Home and Kitchen", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Jewelry", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 250, percent: 0.2 }, { above: 250, percent: 0.05 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Lawn and Garden", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Lawn Mowers and Snow Throwers", ruleType: "PRICE_BAND_PERCENT", bands: [{ max: 500, percent: 0.15 }, { minExclusive: 500, percent: 0.08 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Mattresses", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Media - Books, DVD, Music, Software, Video", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: null },
  { categoryLabel: "Merchant Fulfilled Services", ruleType: "SIMPLE_PERCENT", percent: 0.2, minimumFeeAmount: 0.3 },
  { categoryLabel: "Musical Instruments and AV Production", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Office Products", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Pet Supplies", ruleType: "SPECIAL_CASE", percent: 0.15, specialCases: [{ match: "veterinary diet", percent: 0.22 }], minimumFeeAmount: 0.3 },
  { categoryLabel: "Sports and Outdoors", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Tires", ruleType: "SIMPLE_PERCENT", percent: 0.1, minimumFeeAmount: 0.3 },
  { categoryLabel: "Tools and Home Improvement", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Toys and Games", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
  { categoryLabel: "Video Games and Gaming Accessories", ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: null },
  { categoryLabel: "Video Game Consoles", ruleType: "SIMPLE_PERCENT", percent: 0.08, minimumFeeAmount: null },
  { categoryLabel: "Watches", ruleType: "TIERED_PORTION_PERCENT", tiers: [{ upTo: 1500, percent: 0.16 }, { above: 1500, percent: 0.03 }], minimumFeeAmount: 0.3 },
  { categoryLabel: fallbackCategory, ruleType: "SIMPLE_PERCENT", percent: 0.15, minimumFeeAmount: 0.3 },
]

function money(value: number) {
  return Number(value.toFixed(2))
}

function percent(value: number) {
  return Number(value.toFixed(2))
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normalizeLoop(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().split(" ")[0]
    : fallback
}

function findCategoryAliasInText(value: unknown) {
  const normalized =
    normalizeKey(value)

  return Object.entries(categoryAliases).find(([alias]) => normalized.includes(alias))?.[1] ?? null
}

export function buildAmazonReferralFeeSchedule(
  fixture?: ReferralFeeScheduleFixture | null,
) {
  const categories =
    Array.isArray(fixture?.categories) && fixture.categories.length > 0
      ? fixture.categories
      : defaultSchedule

  return categories.map(rule => ({
    ...rule,
    categoryKey:
      normalizeAmazonReferralFeeCategory(rule.categoryLabel).categoryKey,
    sellerCentralVerified:
      false,
    spApiVerified:
      false,
  }))
}

export function normalizeAmazonReferralFeeCategory(category: unknown) {
  const normalized =
    normalizeKey(category)
  const alias =
    categoryAliases[normalized]

  return {
    categoryKey:
      normalizeKey(alias || category || fallbackCategory),
    normalizedInput:
      normalized,
    mappedCategoryLabel:
      alias || null,
    categoryConfidence:
      !normalized
        ? "LOW"
        : alias
          ? "MEDIUM"
          : "HIGH",
  }
}

export function findAmazonReferralFeeRule(
  schedule: ReturnType<typeof buildAmazonReferralFeeSchedule>,
  category: unknown,
) {
  const normalized =
    normalizeAmazonReferralFeeCategory(category)
  const directMatch =
    schedule.find(rule => rule.categoryKey === normalized.categoryKey)
  const fallback =
    schedule.find(rule => rule.categoryLabel === fallbackCategory) || schedule[schedule.length - 1]
  const categoryMatched =
    Boolean(directMatch)
  const rule =
    directMatch || fallback
  const warnings =
    []

  if (!categoryMatched) {
    warnings.push("Referral fee category not found; using Everything Else fallback.")
  }

  if (normalized.categoryConfidence !== "HIGH") {
    warnings.push("Referral fee category is inferred and must be verified later.")
  }

  return {
    rule:
      {
        ...rule,
        ruleType:
          categoryMatched ? rule.ruleType : "UNKNOWN_CATEGORY_FALLBACK" as FeeRuleType,
      },
    categoryMatched,
    categoryConfidence:
      (categoryMatched ? normalized.categoryConfidence : "LOW") as CategoryConfidence,
    warnings,
  }
}

export function calculateSimpleReferralFee(rule: ReferralFeeRule, salePrice: number) {
  return money(salePrice * (rule.percent ?? 0))
}

export function calculatePriceBandReferralFee(rule: ReferralFeeRule, salePrice: number) {
  const band =
    (rule.bands ?? []).find(entry =>
      salePrice > (entry.minExclusive ?? -Infinity) &&
      salePrice <= (entry.max ?? Infinity),
    )

  return money(salePrice * (band?.percent ?? rule.percent ?? 0))
}

export function calculateTieredPortionReferralFee(rule: ReferralFeeRule, salePrice: number) {
  let previousLimit =
    0
  let total =
    0

  for (const tier of rule.tiers ?? []) {
    if (typeof tier.upTo === "number") {
      const tierAmount =
        Math.max(0, Math.min(salePrice, tier.upTo) - previousLimit)
      total += tierAmount * tier.percent
      previousLimit =
        tier.upTo
    } else if (typeof tier.above === "number" && salePrice > tier.above) {
      total += (salePrice - tier.above) * tier.percent
    }
  }

  return money(total)
}

export function applyReferralFeeMinimum(
  referralFeeAmount: number,
  minimumFeeAmount?: number | null,
) {
  if (typeof minimumFeeAmount !== "number") {
    return {
      referralFeeAmount:
        money(referralFeeAmount),
      minimumFeeApplied:
        false,
      minimumFeeAmount:
        null,
    }
  }

  const minimumFeeApplied =
    referralFeeAmount < minimumFeeAmount

  return {
    referralFeeAmount:
      money(Math.max(referralFeeAmount, minimumFeeAmount)),
    minimumFeeApplied,
    minimumFeeAmount:
      money(minimumFeeAmount),
  }
}

export function calculateAmazonReferralFee(values: {
  rule: ReferralFeeRule
  salePrice: number
  productContext?: string | null
}) {
  const productContext =
    normalizeKey(values.productContext)
  const specialCase =
    values.rule.ruleType === "SPECIAL_CASE"
      ? (values.rule.specialCases ?? []).find(entry => productContext.includes(normalizeKey(entry.match)))
      : null
  const rawFee =
    specialCase
      ? values.salePrice * specialCase.percent
      : values.rule.ruleType === "PRICE_BAND_PERCENT"
        ? calculatePriceBandReferralFee(values.rule, values.salePrice)
        : values.rule.ruleType === "TIERED_PORTION_PERCENT"
          ? calculateTieredPortionReferralFee(values.rule, values.salePrice)
          : calculateSimpleReferralFee(values.rule, values.salePrice)

  return applyReferralFeeMinimum(
    Number(rawFee),
    values.rule.minimumFeeAmount,
  )
}

export function buildAmazonReferralFeeEstimate(values: {
  category?: string | null
  salePrice: number
  productContext?: string | null
  scheduleFixture?: ReferralFeeScheduleFixture | null
}) {
  const schedule =
    buildAmazonReferralFeeSchedule(values.scheduleFixture)
  const categoryFromContext =
    findCategoryAliasInText(values.productContext)
  const inferredFromContext =
    !values.category && Boolean(categoryFromContext)
  const resolved =
    findAmazonReferralFeeRule(schedule, values.category || categoryFromContext)
  const calculated =
    calculateAmazonReferralFee({
      rule:
        resolved.rule,
      salePrice:
        values.salePrice,
      productContext:
        values.productContext,
    })
  const referralFeeAmount =
    calculated.referralFeeAmount
  const warnings =
    [
      ...resolved.warnings,
      ...(inferredFromContext ? ["Referral fee category was inferred from product context and must be verified later."] : []),
    ]

  return {
    referralFeeScheduleVersion:
      AMAZON_REFERRAL_FEE_SCHEDULE_VERSION,
    categoryKey:
      resolved.rule.categoryKey,
    categoryLabel:
      resolved.rule.categoryLabel,
    salePrice:
      money(values.salePrice),
    feeRuleType:
      resolved.rule.ruleType,
    referralFeeAmount,
    effectiveReferralFeePercent:
      values.salePrice > 0
        ? percent((referralFeeAmount / values.salePrice) * 100)
        : 0,
    minimumFeeApplied:
      calculated.minimumFeeApplied,
    minimumFeeAmount:
      calculated.minimumFeeAmount,
    categoryMatched:
      resolved.categoryMatched,
    categoryConfidence:
      inferredFromContext ? "MEDIUM" : resolved.categoryConfidence,
    sellerCentralVerified:
      false,
    spApiVerified:
      false,
    warnings:
      warnings,
  }
}

export function buildAmazonReferralFeeAssessmentQueue(fixture: ReferralFeeScheduleFixture & {
  feeAssessments?: Array<{
    productKey?: string | null
    category?: string | null
    salePrice?: number | null
    productContext?: string | null
  }> | null
}) {
  const assessments =
    (fixture.feeAssessments ?? []).map(entry => ({
      productKey:
        entry.productKey ?? "unknown-product",
      ...buildAmazonReferralFeeEstimate({
        category:
          entry.category,
        salePrice:
          typeof entry.salePrice === "number" ? entry.salePrice : 0,
        productContext:
          entry.productContext ?? entry.category,
        scheduleFixture:
          fixture,
      }),
    }))

  return {
    referralFeeScheduleVersion:
      AMAZON_REFERRAL_FEE_SCHEDULE_VERSION,
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
      normalizeLoop(fixture.nextLoop, "149G"),
  }
}

export function summarizeAmazonReferralFeeSchedule(
  fixture: ReferralFeeScheduleFixture & {
    feeAssessments?: Array<{
      productKey?: string | null
      category?: string | null
      salePrice?: number | null
      productContext?: string | null
    }> | null
  },
) {
  const schedule =
    buildAmazonReferralFeeSchedule(fixture)
  const queue =
    buildAmazonReferralFeeAssessmentQueue(fixture)
  const dm0628n =
    queue.assessments.find(entry => entry.productKey === "dm0628n")

  return {
    referralFeeScheduleBuilt:
      true,
    categoriesLoaded:
      schedule.length,
    simplePercentRules:
      schedule.filter(rule => rule.ruleType === "SIMPLE_PERCENT").length,
    priceBandRules:
      schedule.filter(rule => rule.ruleType === "PRICE_BAND_PERCENT").length,
    tieredPortionRules:
      schedule.filter(rule => rule.ruleType === "TIERED_PORTION_PERCENT").length,
    specialCaseRules:
      schedule.filter(rule => rule.ruleType === "SPECIAL_CASE").length,
    minimumFeeCategories:
      schedule.filter(rule => typeof rule.minimumFeeAmount === "number").length,
    noMinimumFeeCategories:
      schedule.filter(rule => typeof rule.minimumFeeAmount !== "number").length,
    feeAssessmentsBuilt:
      queue.assessments.length,
    unknownCategoryFallbacks:
      queue.assessments.filter(entry => !entry.categoryMatched).length,
    uncertainCategoryWarnings:
      queue.assessments.filter(entry => entry.categoryConfidence !== "HIGH").length,
    dm0628nReferralFeeCategory:
      dm0628n?.categoryLabel ?? null,
    dm0628nSalePrice:
      dm0628n?.salePrice ?? 0,
    dm0628nReferralFeeAmount:
      dm0628n?.referralFeeAmount ?? 0,
    dm0628nEffectiveReferralFeePercent:
      dm0628n?.effectiveReferralFeePercent ?? 0,
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

export function getAmazonReferralFeeScheduleChecklist() {
  return [
    "Use only the user-provided local referral fee baseline.",
    "Resolve category by exact match, alias, or Everything Else fallback.",
    "Support simple percent, price band, tiered portion, and special case rules.",
    "Apply minimum referral fee only when configured.",
    "Mark Seller Central and SP-API verification as false.",
    "Keep this loop local: no Amazon API, no SP-API, no Seller Central write, no scraper, no publication.",
  ]
}
