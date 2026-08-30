import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
}

const promotionSource = readFileSync(
  new URL("./ebay-marketing-promotion-readonly-v1.ts", import.meta.url),
  "utf8",
)
const promotionModuleUrl = moduleUrl(promotionSource)
const {
  parseEbayPromotionStateReadonlyV1,
  readEbayPromotionStateReadonlyV1,
} = await import(promotionModuleUrl)
const economicsSource = readFileSync(
  new URL("./ebay-live-presale-economics-v1.ts", import.meta.url),
  "utf8",
).replace(
  'from "./ebay-marketing-promotion-readonly-v1"',
  `from "${promotionModuleUrl}"`,
)
const { buildLiveListingPreSaleEconomicsV1 } = await import(
  moduleUrl(economicsSource)
)

const inactivePromotion = parseEbayPromotionStateReadonlyV1({
  campaignsPayload: { campaigns: [] },
  adsByCampaignId: {},
  ebayItemId: "366582586826",
  now: new Date("2026-08-30T12:00:00.000Z"),
})

function item5810(overrides = {}) {
  return {
    ebayItemId: "366582586826",
    marketplaceId: "EBAY_US",
    categoryId: "94861",
    storeSubscriptionLevel: "NO_STORE",
    livePriceUsd: 71.99,
    supplierCostUsd: 44.2,
    supplierShippingUsd: 6.99,
    buyerShippingChargeUsd: 0,
    buyerShippingChargeStatus: "AVAILABLE",
    baseFinalValueFeeRatePercent: 13.6,
    perOrderFixedFeeUsd: 0.4,
    promotion: inactivePromotion,
    observedAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  }
}

test("no active CPS campaign is official evidence of inactive promoted-listings state", () => {
  assert.equal(inactivePromotion.status, "AVAILABLE")
  assert.equal(inactivePromotion.promotionState, "INACTIVE")
  assert.equal(inactivePromotion.promotionType, "NONE")
  assert.equal(inactivePromotion.adRatePercent, null)
  assert.equal(inactivePromotion.promotionFeeBasis, "NONE")
})

test("one active exact CPS ad uses the listing override rate", () => {
  const promotion = parseEbayPromotionStateReadonlyV1({
    campaignsPayload: { campaigns: [{
      campaignId: "campaign-1",
      campaignStatus: "RUNNING",
      marketplaceId: "EBAY_US",
      fundingStrategy: {
        fundingModel: "COST_PER_SALE",
        bidPercentage: "5.0",
      },
    }] },
    adsByCampaignId: { "campaign-1": { ads: [{
      listingId: "366582586826",
      bidPercentage: "7.0",
    }] } },
    ebayItemId: "366582586826",
  })
  assert.equal(promotion.promotionState, "ACTIVE")
  assert.equal(promotion.adRatePercent, 7)
  assert.equal(promotion.promotionFeeBasis, "FINAL_SALES_PRICE")
})

test("ambiguous or missing exact listing ad remains unproven", () => {
  const promotion = parseEbayPromotionStateReadonlyV1({
    campaignsPayload: { campaigns: [{
      campaignId: "campaign-1",
      campaignStatus: "RUNNING",
      marketplaceId: "EBAY_US",
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "5.0" },
    }] },
    adsByCampaignId: { "campaign-1": { ads: [] } },
    ebayItemId: "366582586826",
  })
  assert.equal(promotion.status, "UNPROVEN")
  assert.equal(promotion.limitationCode,
    "EBAY_PROMOTION_EXACT_LISTING_AD_UNPROVEN")
})

test("promotion reader uses OAuth plus bounded official GETs only", async () => {
  const previous = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    refreshToken: process.env.EBAY_SELLER_REFRESH_TOKEN,
  }
  process.env.EBAY_CLIENT_ID = "client-id"
  process.env.EBAY_CLIENT_SECRET = "client-secret"
  process.env.EBAY_SELLER_REFRESH_TOKEN = "refresh-token"
  const calls = []
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.pathname === "/identity/v1/oauth2/token") {
      assert.match(String(init.body), /sell.marketing.readonly/)
      return new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url.pathname.endsWith("find_campaign_by_ad_reference")) {
      assert.equal(url.searchParams.get("listing_id"), "366582586826")
      return new Response(JSON.stringify({ campaigns: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error("UNEXPECTED_CALL")
  }
  try {
    const result = await readEbayPromotionStateReadonlyV1(
      "366582586826",
      fakeFetch,
    )
    assert.equal(result.promotionState, "INACTIVE")
    assert.deepEqual(calls.map((call) => call.init.method ?? "GET"),
      ["POST", "GET"])
    assert.equal(calls.some((call) => /create|update|delete|pause|resume/.test(
      call.url.pathname,
    )), false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const name = key === "clientId" ? "EBAY_CLIENT_ID"
        : key === "clientSecret" ? "EBAY_CLIENT_SECRET"
          : "EBAY_SELLER_REFRESH_TOKEN"
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test("ITEM5810 pre-sale model remains distinct from realized fees and proves a conservative positive result", () => {
  const result = buildLiveListingPreSaleEconomicsV1(item5810())
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.feeEvidenceClass,
    "PROVEN_RATE_PRE_SALE_FEE_MODEL")
  assert.equal(result.economicsEvidenceClass,
    "PROVEN_RATE_PRE_SALE_MODEL")
  assert.equal(result.preSaleBaseFeeModelUsd, 10.19)
  assert.equal(result.officialModifiers.conservativeMutuallyExclusiveBoundUsd,
    5.04)
  assert.equal(result.preSalePromotionFeeModelUsd, 0)
  assert.equal(result.preSaleTotalEbayFeeModelUsd, 15.23)
  assert.equal(result.preSaleProfitUsd, 5.57)
  assert.equal(result.preSaleMarginPercent, 7.7372)
  assert.equal(result.economicsNonNegative, true)
  assert.equal(result.realizedFee, null)
  assert.equal(result.feeBasis.salesTaxClassification,
    "CONDITIONAL_POST_SALE")
  assert.equal(result.officialModifiers.internationalFeeApplicability,
    "CONDITIONAL_POST_SALE")
})

test("active promotion is included separately from base fees", () => {
  const promotion = parseEbayPromotionStateReadonlyV1({
    campaignsPayload: { campaigns: [{
      campaignId: "campaign-1", campaignStatus: "RUNNING",
      marketplaceId: "EBAY_US",
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "5.0" },
    }] },
    adsByCampaignId: { "campaign-1": { ads: [{
      listingId: "366582586826", bidPercentage: "5.0",
    }] } },
    ebayItemId: "366582586826",
  })
  const result = buildLiveListingPreSaleEconomicsV1(item5810({ promotion }))
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.preSaleBaseFeeModelUsd, 10.19)
  assert.equal(result.preSalePromotionFeeModelUsd, 3.6)
  assert.equal(result.promotion.type, "PROMOTED_LISTINGS_CPS")
})

test("unknown buyer shipping or promotion returns one exact blocker and never zero", () => {
  const shipping = buildLiveListingPreSaleEconomicsV1(item5810({
    buyerShippingChargeUsd: null,
    buyerShippingChargeStatus: "UNPROVEN",
  }))
  assert.equal(shipping.status, "UNPROVEN")
  assert.equal(shipping.nextBlocker, "BUYER_SHIPPING_CHARGE_UNPROVEN")
  assert.equal(shipping.profitUsd, null)
  const promotion = buildLiveListingPreSaleEconomicsV1(item5810({
    promotion: { ...inactivePromotion, status: "UNPROVEN",
      promotionState: "UNPROVEN",
      limitationCode: "PROMOTION_STATE_READONLY_SCOPE_REQUIRED" },
  }))
  assert.equal(promotion.nextBlocker,
    "PROMOTION_STATE_READONLY_SCOPE_REQUIRED")
})

test("implementation is read-only and never aliases the model as REALIZED_FEE", () => {
  assert.doesNotMatch(promotionSource,
    /fetchImpl\([^\n]*ad_campaign[^\n]*\{[\s\S]{0,160}method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/)
  assert.match(economicsSource, /REALIZED_FEE/)
  assert.match(economicsSource, /PROVEN_RATE_PRE_SALE_FEE_MODEL/)
  assert.match(economicsSource, /modelWillNotBeRelabeledAsRealized/)
})
