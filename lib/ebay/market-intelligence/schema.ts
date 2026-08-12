import { z } from "zod"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { EVIDENCE_LEVELS, SECONDARY_IMAGE_CATEGORIES } from "./types.ts"

export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS)

const nullableNonNegative = z.number().finite().nonnegative().nullable().default(null)
const nullableBoolean = z.boolean().nullable().default(null)
const score = z.number().finite().min(0).max(100).nullable().optional()

export const mainImageAnalysisSchema = z.object({
  background: z.string().trim().max(80).nullable().optional(),
  productCoveragePercent: score,
  quantityClarity: score,
  textAmount: score,
  badgeUsage: z.boolean().nullable().optional(),
  shippingBadge: z.boolean().nullable().optional(),
  brandVisibility: score,
  imageSharpness: score,
  visualClutter: score,
  mobileReadability: score,
  trustScore: score,
  estimatedCtrScore: score,
}).strict()

export const competitorListingSchema = z.object({
  url: z.string().url().refine((value) => value.startsWith("https://"), "HTTPS_REQUIRED"),
  title: z.string().trim().min(1).max(300),
  price: z.number().finite().nonnegative(),
  shippingCost: z.number().finite().nonnegative().default(0),
  quantityIncluded: nullableNonNegative,
  totalUnitCount: nullableNonNegative,
  soldCountVisible: nullableNonNegative,
  watchersVisible: nullableNonNegative,
  sellerFeedbackPercent: z.number().finite().min(0).max(100).nullable().default(null),
  sellerFeedbackCount: nullableNonNegative,
  sellerLevel: z.string().trim().max(120).nullable().default(null),
  returnsAccepted: nullableBoolean,
  returnPeriodDays: nullableNonNegative,
  returnShippingPaidBy: z.enum(["seller", "buyer", "unknown"]).nullable().default(null),
  handlingTimeDays: nullableNonNegative,
  estimatedDelivery: z.string().trim().max(200).nullable().default(null),
  promotedVisible: nullableBoolean,
  mainImageUrl: z.string().url().nullable().default(null),
  secondaryImageUrls: z.array(z.string().url()).max(24).default([]),
  itemSpecifics: z.record(z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  description: z.string().max(100_000).nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  evidenceLevel: evidenceLevelSchema,
  fieldEvidence: z.record(z.string(), evidenceLevelSchema).default({}),
  condition: z.enum(["new", "used", "refurbished", "unknown"]).nullable().optional(),
  internationalShipping: nullableBoolean.optional(),
  additionalProductsIncluded: nullableBoolean.optional(),
  searchPosition: nullableNonNegative.optional(),
  reviewCount: nullableNonNegative.optional(),
  badges: z.array(z.string().trim().max(100)).max(30).optional(),
  listingQualityScore: score,
  bestOfferVisible: nullableBoolean.optional(),
  volumePricingVisible: nullableBoolean.optional(),
  mainImageAnalysis: mainImageAnalysisSchema.nullable().optional(),
  secondaryImageClassifications: z.array(z.enum(SECONDARY_IMAGE_CATEGORIES)).max(24).optional(),
}).strict()

export const ebayMarketIntelligenceInputSchema = z.object({
  productName: z.string().trim().min(1).max(300),
  productBrand: z.string().trim().min(1).max(150),
  productCategory: z.string().trim().min(1).max(200),
  unitsPerListing: z.number().int().positive().max(100_000),
  unitsPerPackage: z.number().int().positive().max(100_000),
  totalUnits: z.number().int().positive().max(10_000_000),
  sellerProductCost: z.number().finite().nonnegative(),
  packagingCost: z.number().finite().nonnegative(),
  shippingCost: z.number().finite().nonnegative(),
  expectedReturnCost: z.number().finite().nonnegative(),
  ebayFeePercent: z.number().finite().min(0).max(80),
  promotedListingPercent: z.number().finite().min(0).max(80),
  targetMarginPercent: z.number().finite().min(0).max(95),
  competitorListings: z.array(competitorListingSchema).min(1).max(10),
  sourceDate: z.string().date(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
}).strict().superRefine((input, context) => {
  const combinedRate = input.ebayFeePercent + input.promotedListingPercent + input.targetMarginPercent
  if (combinedRate >= 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetMarginPercent"],
      message: "FEES_AND_TARGET_MARGIN_MUST_BE_BELOW_100_PERCENT",
    })
  }
})

export type ValidatedMarketIntelligenceInput = z.infer<typeof ebayMarketIntelligenceInputSchema>
