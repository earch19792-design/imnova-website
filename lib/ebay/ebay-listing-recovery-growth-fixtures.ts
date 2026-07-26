import type {
  ListingRecoveryInput,
  OrganicTrafficMetrics,
  PaidTrafficMetrics,
} from "./ebay-listing-recovery-growth-domain.ts"

const OBSERVED_AT = "2026-07-26T18:00:00.000Z"

function organic(
  overrides: Partial<OrganicTrafficMetrics> = {},
): OrganicTrafficMetrics {
  return {
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    scope: "sell.analytics.readonly",
    capturedAt: "2026-07-26T17:55:00.000Z",
    lastUpdatedDate: "2026-07-26T17:00:00.000Z",
    timezone: "America/New_York",
    windowStart: "2026-07-19",
    windowEnd: "2026-07-25",
    completeness: "COMPLETE",
    reconciliation: "RECONCILED",
    impressions: 150,
    searchImpressions: 120,
    storeImpressions: 10,
    views: 35,
    searchViews: 28,
    directViews: 2,
    externalViews: 2,
    otherEbayViews: 2,
    storeViews: 1,
    ctrPercent: 23.33,
    salesConversionRatePercent: 0,
    transactions: 0,
    ...overrides,
  }
}

function paid(overrides: Partial<PaidTrafficMetrics> = {}): PaidTrafficMetrics {
  return {
    source: "EBAY_SELL_MARKETING_AD_REPORT",
    scope: "sell.marketing.readonly",
    capturedAt: "2026-07-26T17:50:00.000Z",
    lastUpdatedDate: "2026-07-23T17:00:00.000Z",
    windowStart: "2026-07-16",
    windowEnd: "2026-07-22",
    completeness: "COMPLETE",
    reconciliation: "RECONCILED",
    fundingModel: "COST_PER_SALE",
    campaignStatus: "INACTIVE",
    campaignId: null,
    adGroupId: null,
    impressions: 0,
    clicks: 0,
    ctrPercent: 0,
    attributedSales: 0,
    salesConversionRatePercent: 0,
    adFees: 0,
    costPerClick: null,
    roas: null,
    ...overrides,
  }
}

export function recoveryFixture(
  overrides: Partial<ListingRecoveryInput> = {},
): ListingRecoveryInput {
  const base: ListingRecoveryInput = {
    marketplaceAccountKey: "imnova-ebay-us",
    marketplace: "EBAY_US",
    listingId: "100000000001",
    sku: "IMN-REC-001",
    offerId: "offer-rec-001",
    itemId: "100000000001",
    dossierId: "dossier-rec-001",
    observedAt: OBSERVED_AT,
    listing: {
      status: "ACTIVE",
      publishedAt: "2026-07-01T18:00:00.000Z",
      categoryId: "180112",
      condition: "NEW",
      pack: "1",
      productType: "pressure-washer-accessory",
      priceBand: "20-40",
      activeVerified: true,
      inventoryItemVerified: true,
      offerVerified: true,
      itemIdVerified: true,
      categoryValid: true,
      requiredAspectsComplete: true,
      policiesResolved: true,
      stockPositive: true,
      indexationIssueCodes: [],
    },
    metrics: { organic: organic(), paid: null },
    baseline: {
      version: "ACCOUNT_COHORT_180112_V1",
      source: "ACCOUNT_COHORT",
      categoryId: "180112",
      condition: "NEW",
      priceBand: "20-40",
      listingAgeBand: "15-30_DAYS",
      productType: "pressure-washer-accessory",
      pack: "1",
      trafficMode: "ORGANIC",
      sampleSize: 20,
      minimumImpressions: 100,
      minimumViews: 30,
      minimumCtrPercent: 2,
      minimumConversionPercent: 2,
    },
    evidence: {
      level: "E4",
      confidence: 0.95,
      fresh: true,
      complete: true,
      salesClassification: "SOLD_CONFIRMED",
      confirmedUnitsSold: 0,
      profitableConfirmedUnits: 0,
      sourceRefs: ["traffic:100000000001:2026-07-19..2026-07-25"],
    },
    economics: {
      source: "EBAY_UNIT_ECONOMICS_V1",
      policyVersion: "EBAY_UNIT_ECONOMICS_POLICY_V1",
      calculationHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      costsComplete: true,
      currentPrice: 29.99,
      landedPrice: 29.99,
      safeFloor: 24.5,
      currentContribution: 8.2,
      currentMarginPercent: 27.34,
      currentRoiPercent: 45,
      stockAvailable: 12,
      stockFresh: true,
      costObservedAt: "2026-07-26T17:30:00.000Z",
      paidAdFeesIncluded: true,
      returnReserveIncluded: true,
      priceTestScenario: {
        proposedPrice: 29.09,
        projectedContribution: 7.3,
        projectedMarginPercent: 25.09,
        projectedRoiPercent: 40,
      },
    },
    promotionEligibility: {
      evidenceLevel: "E4",
      salesClassification: "SOLD_CONFIRMED",
      confirmedSalesSource: "EBAY_SELL_FULFILLMENT_COMPLETED_CHECKOUT_ORDERS",
      confirmedUnitsSold: 1,
      costsComplete: true,
      economicsPassesProfitGate: true,
      expectedNetProfit: 8.2,
      minimumNetProfit: 5,
      expectedMarginPercent: 27.34,
      minimumMarginPercent: 20,
      expectedRoiPercent: 45,
      minimumRoiPercent: 30,
      safetyReservePercent: 3,
      configuredMaximumRatePercent: 2,
      stockAvailable: 12,
      stockEvidenceFresh: true,
      evidenceFresh: true,
      configurationVersion: "COMMERCIAL_POLICY_V1",
    },
    interestedBuyerEligibility: {
      status: "UNAVAILABLE",
      source: "UNAVAILABLE",
      capturedAt: null,
      negotiationImplemented: false,
    },
    comparables: [],
    history: {
      completedActionLevels: [],
      activeExperiment: false,
      experimentCount: 0,
      lastExperimentAt: null,
      previousMainImageHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      previousTitleHash:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  }
  return {
    ...base,
    ...overrides,
    listing: { ...base.listing, ...(overrides.listing ?? {}) },
    metrics: {
      ...base.metrics,
      ...(overrides.metrics ?? {}),
      organic: overrides.metrics && "organic" in overrides.metrics
        ? overrides.metrics.organic ?? null
        : base.metrics.organic,
      paid: overrides.metrics && "paid" in overrides.metrics
        ? overrides.metrics.paid ?? null
        : base.metrics.paid,
    },
    evidence: { ...base.evidence, ...(overrides.evidence ?? {}) },
    economics: { ...base.economics, ...(overrides.economics ?? {}) },
    interestedBuyerEligibility: {
      ...base.interestedBuyerEligibility,
      ...(overrides.interestedBuyerEligibility ?? {}),
    },
    history: { ...base.history, ...(overrides.history ?? {}) },
  }
}

export function fiveListingRecoveryFixtures(): ListingRecoveryInput[] {
  return [
    recoveryFixture({
      listingId: "100000000001",
      sku: "IMN-REC-001",
      metrics: {
        organic: organic({
          impressions: 0,
          searchImpressions: 0,
          storeImpressions: 0,
          views: 0,
          searchViews: 0,
          directViews: 0,
          externalViews: 0,
          otherEbayViews: 0,
          storeViews: 0,
          ctrPercent: 0,
        }),
        paid: null,
      },
    }),
    recoveryFixture({
      listingId: "100000000002",
      sku: "IMN-REC-002",
      metrics: {
        organic: organic({ impressions: 500, views: 2, ctrPercent: 0.4 }),
        paid: null,
      },
    }),
    recoveryFixture({
      listingId: "100000000003",
      sku: "IMN-REC-003",
      evidence: {
        level: "E1",
        confidence: 0.9,
        fresh: true,
        complete: true,
        salesClassification: "ACTIVE_ONLY",
        confirmedUnitsSold: 0,
        profitableConfirmedUnits: 0,
        sourceRefs: ["active-only:100000000003"],
      },
    }),
    recoveryFixture({
      listingId: "100000000004",
      sku: "IMN-REC-004",
      metrics: {
        organic: organic(),
        paid: paid({
          fundingModel: "COST_PER_CLICK",
          campaignStatus: "ACTIVE",
          impressions: 800,
          clicks: 40,
          adFees: 18,
          attributedSales: 0,
          costPerClick: 0.45,
          roas: 0,
        }),
      },
    }),
    recoveryFixture({
      listingId: "100000000005",
      sku: "IMN-REC-005",
      evidence: {
        level: "E5",
        confidence: 1,
        fresh: true,
        complete: true,
        salesClassification: "SOLD_CONFIRMED",
        confirmedUnitsSold: 2,
        profitableConfirmedUnits: 2,
        sourceRefs: ["orders:100000000005:confirmed"],
      },
      metrics: {
        organic: organic({ transactions: 2, salesConversionRatePercent: 5.71 }),
        paid: null,
      },
    }),
  ]
}
