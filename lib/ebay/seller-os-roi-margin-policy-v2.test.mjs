import assert from "node:assert/strict"
import test from "node:test"

import { calculateSellerOsPolicyLimitsV2,
  evaluateSellerOsRoiMarginPolicyV2,
  sellerOsRoiMarginPolicyContractV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2.ts"

test("shared policy requires ROI 30 and contribution margin 15 together", () => {
  const pass = evaluateSellerOsRoiMarginPolicyV2({ revenueUsd: 100,
    investmentBase: "AMAZON_INVENTORY_INVESTMENT", investmentBaseUsd: 50,
    costs: [{ key: "all_costs", amountUsd: 80, authority: "TEST",
      state: "KNOWN" }] })
  assert.equal(pass.estimatedRoiPercent, 40)
  assert.equal(pass.contributionMarginPercent, 20)
  assert.equal(pass.passesPolicy, true)

  const marginFail = evaluateSellerOsRoiMarginPolicyV2({ revenueUsd: 200,
    investmentBase: "EBAY_LUNA_ORDER_INVESTMENT", investmentBaseUsd: 40,
    costs: [{ key: "all_costs", amountUsd: 174, authority: "TEST",
      state: "KNOWN" }] })
  assert.equal(marginFail.estimatedRoiPercent, 65)
  assert.equal(marginFail.contributionMarginPercent, 13)
  assert.equal(marginFail.passesPolicy, false)
  assert(marginFail.blockerCodes.includes(
    "CONTRIBUTION_MARGIN_BELOW_15_PERCENT"))
})

test("unknown cost never becomes zero", () => {
  const result = evaluateSellerOsRoiMarginPolicyV2({ revenueUsd: 50,
    investmentBase: "AMAZON_INVENTORY_INVESTMENT", investmentBaseUsd: 20,
    costs: [
      { key: "supplier", amountUsd: 10, authority: "TEST", state: "KNOWN" },
      { key: "inbound", amountUsd: null, authority: "MISSING",
        state: "UNKNOWN" },
    ] })
  assert.equal(result.evidenceComplete, false)
  assert.equal(result.contributionUsd, null)
  assert.equal(result.estimatedRoiPercent, null)
  assert.equal(result.passesPolicy, false)
  assert.deepEqual(result.unknownCostKeys, ["inbound"])
})

test("policy limits have no monetary profit floor", () => {
  const policy = sellerOsRoiMarginPolicyContractV2()
  assert.equal(policy.minimumMonetaryProfitUsd, null)
  const limits = calculateSellerOsPolicyLimitsV2({ revenueUsd: 40,
    purchaseCostUsd: 10, otherFixedCostUsd: 8, variableCostRate: 0.2,
    investmentBaseAdditionalUsd: 8 })
  assert.equal(limits.maximumPurchasePriceUsd, 16.62)
  assert.equal(limits.minimumViablePriceUsd, 29.25)
})

test("investment bases remain marketplace-specific", () => {
  const ebay = evaluateSellerOsRoiMarginPolicyV2({ revenueUsd: 60,
    investmentBase: "EBAY_LUNA_ORDER_INVESTMENT", investmentBaseUsd: 30,
    costs: [{ key: "all", amountUsd: 45, authority: "TEST",
      state: "KNOWN" }] })
  const amazon = evaluateSellerOsRoiMarginPolicyV2({ revenueUsd: 60,
    investmentBase: "AMAZON_INVENTORY_INVESTMENT", investmentBaseUsd: 20,
    costs: [{ key: "all", amountUsd: 45, authority: "TEST",
      state: "KNOWN" }] })
  assert.equal(ebay.estimatedRoiPercent, 50)
  assert.equal(amazon.estimatedRoiPercent, 75)
  assert.notEqual(ebay.investmentBase, amazon.investmentBase)
})
