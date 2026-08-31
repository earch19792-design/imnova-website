import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

const gatewayUrl = moduleUrl(`
  export async function readEbayPromotionRecommendationReadonlyV1() {
    throw new Error("NOT_USED_BY_PURE_TEST")
  }
`)
const adapterUrl = moduleUrl(`
  export function projectSellerOsCanonicalLunaStockReadModelV1() {
    return { stock: null, supplierLinkageStatus: "UNPROVEN" }
  }
`)
const policyUrl = moduleUrl(`
  export const DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY = {
    version: "SELLER_OS_POST_PUBLICATION_DIAGNOSTICS_V1",
    marginRiskBelowPercent: 20,
  }
`)
const source = readFileSync(new URL(
  "./ebay-promotion-recommendation-safe-execution-v1.ts",
  import.meta.url,
), "utf8")
  .replace(/import \{ readEbayPromotionRecommendationReadonlyV1, type[\s\S]*?"\.\/ebay-marketing-promotion-readonly-v1"/, `import { readEbayPromotionRecommendationReadonlyV1 } from "${gatewayUrl}"`)
  .replace(/import \{ projectSellerOsCanonicalLunaStockReadModelV1 \} from[\s\S]*?"\.\/ebay-luna-canonical-stock-read-model-adapter-v1"/, `import { projectSellerOsCanonicalLunaStockReadModelV1 } from "${adapterUrl}"`)
  .replace(/import \{ DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY \} from[\s\S]*?"\.\.\/marketplace\/post-publication-optimization-domain"/, `import { DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY } from "${policyUrl}"`)
const { buildEbayPromotionRecommendationDecisionV1 } = await import(
  moduleUrl(source),
)

function recommendation(rate = 5) {
  return {
    status: "AVAILABLE",
    recommendationAvailable: true,
    recommendationType: "AD_RATE",
    recommendedAdRatePercent: rate,
    recommendedDiscountPercent: null,
    adRateBasis: "TRENDING",
    promoteWithAd: "RECOMMENDED",
    priceDiscountRecommendation: "SEPARATE_CAPABILITY_NOT_RETURNED",
    authority: "EBAY_SELL_RECOMMENDATION_API_AD_READONLY",
    limitationCode: null,
    observedAt: "2026-08-30T12:00:00.000Z",
    marketplaceId: "EBAY_US",
  }
}

function economics(overrides = {}) {
  return {
    contractVersion: "SELLER_OS_LIVE_PRE_SALE_ECONOMICS_V1_2026_08_30",
    status: "AVAILABLE",
    feeEvidenceClass: "PROVEN_RATE_PRE_SALE_FEE_MODEL",
    ebayItemId: "366582586826",
    revenueUsd: 71.99,
    supplierTotalUsd: 51.19,
    profitUsd: 5.57,
    marginPercent: 7.7372,
    economicsNonNegative: true,
    nextBlocker: null,
    baseFees: { officialFinalValueFeeRatePercent: 13.6,
      perOrderFixedFeeUsd: 0.4 },
    officialModifiers: { conservativeMutuallyExclusiveBoundPercent: 7 },
    ...overrides,
  }
}

function decision(overrides = {}) {
  return buildEbayPromotionRecommendationDecisionV1({
    ebayItemId: "366582586826",
    recommendation: recommendation(),
    economics: economics(),
    productTruthExact: true,
    liveIdentityExact: true,
    stockGuardSafe: true,
    noConflictingExperiment: true,
    ...overrides,
  })
}

test("ITEM5810 is nonnegative but cannot spend promotion budget below the existing 20 percent floor", () => {
  const result = decision()
  assert.equal(result.economicsGuard.currentProfitUsd, 5.57)
  assert.equal(result.economicsGuard.currentMarginPercent, 7.7372)
  assert.equal(result.economicsGuard.marginFloorPolicy.valuePercent, 20)
  assert.equal(result.economicsGuard.maxSafeAdRatePercent, 0)
  assert.equal(result.economicsGuard.maxSafePriceDiscountPercent, 0)
  assert.equal(result.promotionDecision, "DO_NOT_PROMOTE")
  assert.equal(result.decisionReason,
    "CURRENT_MARGIN_BELOW_EXISTING_FLOOR")
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("a proven recommendation applies or caps only against the existing policy", () => {
  const profitable = economics({ revenueUsd: 100, supplierTotalUsd: 49.2,
    profitUsd: 30, marginPercent: 30 })
  const apply = decision({ economics: profitable,
    recommendation: recommendation(5) })
  assert.equal(apply.economicsGuard.maxSafeAdRatePercent, 10)
  assert.equal(apply.promotionDecision, "APPLY")
  const cap = decision({ economics: profitable,
    recommendation: recommendation(15) })
  assert.equal(cap.promotionDecision, "CAP_TO_SAFE_LEVEL")
  assert.equal(cap.economicsGuard.maxSafeAdRatePercent, 10)
})

test("no recommendation and unavailable evidence remain semantically distinct", () => {
  const none = decision({ recommendation: {
    ...recommendation(), recommendationAvailable: false,
    recommendationType: "NONE", recommendedAdRatePercent: null,
    adRateBasis: null, promoteWithAd: "UNDETERMINED",
  } })
  assert.equal(none.promotionDecision, "NO_RECOMMENDATION")
  const blocked = decision({ stockGuardSafe: false })
  assert.equal(blocked.promotionDecision, "BLOCKED")
  assert.equal(blocked.decisionReason, "STOCK_GUARD_SAFE_REQUIRED")
})

test("future execution stays bounded, explicit, readback-audited, and disabled in this canary", () => {
  const result = decision()
  assert.deepEqual(result.executionContract.path, ["RECOMMENDATION",
    "ECONOMICS_GUARD", "PROMOTION_WRITE", "EBAY_READBACK", "AUDIT"])
  assert.equal(result.executionContract.ownerApprovalRequired, false)
  assert.equal(result.executionContract.explicitSellerOsOperatorActionRequired,
    true)
  assert.equal(result.executionContract.marketplaceWriteEnabledInThisCanary,
    false)
  assert.equal(result.executionContract.readbackRequired, true)
  assert.equal(result.executionContract.auditRequired, true)
})

test("Command Center exposes human copy and the bounded readonly action", () => {
  const page = readFileSync(new URL(
    "../../app/admin/ebay/listing-optimization/page.tsx", import.meta.url),
  "utf8")
  assert.match(page, /Qué recomienda eBay y cuánto considera seguro Seller OS/)
  assert.match(page, /Revisar recomendación de eBay/)
  assert.match(page, /Beneficio después/)
  assert.match(page, /Máximo permitido/)
  assert.match(page, /PROMOTION_RECOMMENDATION_READONLY/)
})
