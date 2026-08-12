import { z } from "zod"

const nullableText = z.string().trim().max(500).nullable().default(null)
const nullablePositive = z.number().finite().positive().nullable().default(null)
const stringList = z.array(z.string().trim().min(1).max(500)).max(100).default([])

const marketReportSchema = z.object({
  reportVersion: z.literal("EBAY_MARKET_INTELLIGENCE_LOOP_V1"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  marketRange: z.object({
    medianLandedPrice: z.number().finite().positive(),
    medianPricePerUnit: z.number().finite().nonnegative(),
    weightedMarketPrice: z.number().finite().positive(),
    competitorCountUsed: z.number().int().positive().max(10),
    competitorCountExcluded: z.number().int().nonnegative(),
  }).passthrough(),
  competitorTable: z.array(z.object({ url: z.string().url(), title: z.string() }).passthrough()).max(10),
  recommendedPrice: z.object({ salePrice: z.number().finite().positive() }).passthrough(),
  minimumSafePrice: z.object({ salePrice: z.number().finite().positive() }).passthrough(),
  confidenceScore: z.number().min(0).max(100),
}).passthrough()

export const productFactsSchema = z.object({
  brand: z.string().trim().min(1).max(150),
  productName: z.string().trim().min(1).max(300),
  productType: z.string().trim().min(1).max(200),
  quantityIncluded: z.number().int().positive(),
  unitsPerPackage: z.number().int().positive(),
  totalUnits: z.number().int().positive(),
  scent: nullableText,
  condition: z.string().trim().min(1).max(100),
  upc: z.string().trim().regex(/^\d{8,14}$/).nullable().default(null),
  manufacturerPartNumber: nullableText,
  epaRegistrationNumber: nullableText,
  packageContents: stringList,
  dimensions: z.object({
    length: z.number().positive(), width: z.number().positive(), height: z.number().positive(),
    unit: z.enum(["in", "cm"]),
  }).nullable().default(null),
  weight: z.object({ value: z.number().positive(), unit: z.enum(["oz", "lb", "g", "kg"]) }).nullable().default(null),
  permittedClaims: stringList,
  prohibitedClaims: stringList,
  verifiedUseCases: stringList,
  verifiedCompatibility: stringList,
  shippingOrigin: nullableText,
  handlingTime: z.number().int().nonnegative().max(30).nullable().default(null),
  returnPolicy: nullableText,
}).strict()

export const sellerProfileSchema = z.object({
  accountAge: z.number().int().nonnegative(),
  sellerFeedbackPercent: z.number().min(0).max(100).nullable().default(null),
  sellerFeedbackCount: z.number().int().nonnegative(),
  topRatedStatus: z.boolean(),
  freeShipping: z.boolean(),
  sellerPaidReturns: z.boolean(),
  promotedListingPercent: z.number().min(0).max(30),
  targetMarginPercent: z.number().min(0).max(95),
}).strict()

export const listingDraftSchema = z.object({
  title: z.string().max(300),
  subtitle: z.string().max(300).nullable().default(null),
  price: z.number().finite().positive(),
  quantity: z.number().int().positive(),
  category: z.string().trim().max(200),
  itemSpecifics: z.record(z.string(), z.string()).default({}),
  description: z.string().max(100_000),
  shippingPolicy: z.string().max(2_000),
  returnPolicy: z.string().max(2_000),
  bestOfferEnabled: z.boolean(),
  immediatePaymentEnabled: z.boolean(),
  volumePricing: z.array(z.object({
    minimumQuantity: z.number().int().min(2),
    discountPercent: z.number().positive().max(50),
  })).max(10).default([]),
  images: z.array(z.string()).max(24).default([]),
}).strict()

export const imageAssetSchema = z.object({
  id: z.string().trim().min(1).max(200),
  url: z.string().url(),
  status: z.enum(["pending", "approved", "rejected"]),
  observedText: stringList,
  observedQuantity: z.number().int().positive().nullable().default(null),
  observedTotalUnits: z.number().int().positive().nullable().default(null),
  medicalTextDetected: z.boolean().default(false),
  background: nullableText,
  productCoveragePercent: z.number().min(0).max(100).nullable().default(null),
  imageSharpness: z.number().min(0).max(100).nullable().default(null),
  mobileReadability: z.number().min(0).max(100).nullable().default(null),
  factsDepicted: stringList,
}).strict()

export const listingOptimizationInputSchema = z.object({
  marketIntelligenceReport: marketReportSchema,
  productFacts: productFactsSchema,
  sellerProfile: sellerProfileSchema,
  listingDraft: listingDraftSchema,
  imageAssets: z.array(imageAssetSchema).max(24),
  regulatoryData: z.object({
    confirmedEpaRegistrationNumber: nullableText,
    confirmedRegulatoryClaims: stringList,
    brandUsageAuthorized: z.boolean().nullable().default(null),
    madeInUsaConfirmed: z.boolean().default(false),
    usaSellerConfirmed: z.boolean().default(false),
    tsaApprovedConfirmed: z.boolean().default(false),
  }).strict(),
  platformConstraints: z.object({
    maximumTitleLength: z.number().int().min(40).max(200).default(80),
    maximumImages: z.number().int().min(1).max(24).default(12),
    prohibitedTerms: stringList,
    minimumPrice: nullablePositive,
    maximumPrice: nullablePositive,
  }).strict(),
}).strict()

export type ValidatedListingOptimizationInput = z.infer<typeof listingOptimizationInputSchema>
