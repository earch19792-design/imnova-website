import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { parseEbayUsNoStoreFvfPolicyV1, resolveEbayUsNoStoreFvfPolicyV1,
  evaluateEbayUsNoStoreFvfAtBasisV1, assessEbayUsNoStoreFvfAmountV1,
  resolveEbaySellerLevelSurchargeV1,
  assessOwnerObservedServiceMetricsWindowV1 } =
  await import("./ebay-us-no-store-fvf-policy-v1.ts")

const now = new Date("2026-09-23T20:40:00Z")
const account = "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12"
const marginal = (a, b, threshold) =>
  `${a}% on total amount of the sale up to $${threshold} calculated per item ${b}% on the portion of the sale over $${threshold}`
const whole = (a, b, threshold) =>
  `${a}% if total amount of the sale is $${threshold} or less, calculated per item ${b}% if total amount of the sale is over $${threshold}, calculated per item`
const rows = [
  ["Most categories, including eBay Motors > Parts & Accessories, Automotive Tools & Supplies, and Safety & Security Accessories. For vehicles, see our Motors fees .", marginal(13.6, 2.35, "7,500")],
  ["Books & Magazines Movies & TV (except Movie NFTs) Music (except Vinyl Records and Music NFTs categories)", marginal(15.3, 2.35, "7,500")],
  ["Coins & Paper Money (except Bullion)", marginal(13.25, 2.35, "7,500")],
  ["Coins & Paper Money > Bullion", whole(13.6, 7, "7,500")],
  ["Clothing, Shoes & Accessories > Women > Women's Bags & Handbags", whole(15, 9, "2,000")],
  ["Select Collectibles categories: Comic Books & Memorabilia Non-Sport Trading Cards Sports Mem, Cards & Fan Shop > Sports Trading Cards Toys & Hobbies > Collectible Card Games", marginal(13.25, 2.35, "7,500")],
  ["Jewelry & Watches (except Watches, Parts & Accessories)", whole(15, 9, "5,000")],
  ["Jewelry & Watches > Watches, Parts & Accessories", "15% on total amount of the sale up to $1,000 calculated per item 6.5% on the portion of the sale over $1,000 up to $7,500 calculated per item 3% on the portion of the sale over $7,500"],
  ["The following NFT categories: Art NFTs CCG NFTs Emerging NFTs Movie NFTs Music NFTs Non-Sport Trading Card NFTs Sport Trading Card NFTs", "5% on total amount of the sale"],
  ["Select Business & Industrial categories: Heavy Equipment Parts & Attachments > Heavy Equipment Printing & Graphic Arts > Commercial Printing Presses Restaurant & Food Service > Food Trucks, Trailers & Carts", marginal(3, 0.5, "15,000")],
  ["Musical Instruments & Gear > Guitars & Basses", marginal(6.7, 2.35, "7,500")],
  ["Select Clothing, Shoes & Accessories categories: Men > Men's Shoes > Athletic Shoes Women > Women's Shoes > Athletic Shoes", "8% if total amount of the sale is $150 or more. The per order fee is not charged 13.6% if total amount of the sale is less than $150"],
]
function html(data = rows) {
  const table = `<table><tr><th>Category</th><th>Insertion fee</th><th>Final value fee % + per order fee</th></tr>${data.map(([label, fee]) =>
    `<tr><td>${label}</td><td>n/a</td><td>${fee}</td></tr>`).join("")}</table>`
  return `Basic fees for most categories For orders $10.00 or less the per order fee is $0.30, for orders over $10.00 the per order fee is $0.40. ${table} Sellers not meeting performance expectations ${"x".repeat(5_000)}`
}
const policy = parseEbayUsNoStoreFvfPolicyV1(html(), now)
function ancestry(path, id = "123") {
  return { status: "PROVEN", source: "EBAY_TAXONOMY_EXACT_CATEGORY_ANCESTRY_V1",
    marketplace: "EBAY_US", categoryId: id, treeVersion: "test-tree",
    digest: "a".repeat(64), path, ancestorIds: ["1", "2"],
    observedAt: "2026-09-23T20:00:00Z", freshUntil: "2026-09-23T23:00:00Z" }
}
const resolved = (path, change = {}) => resolveEbayUsNoStoreFvfPolicyV1({
  accountKey: account, categoryId: "123", categoryAuthority: ancestry(path),
  policy, now, ...change })

test("full official basic fee table must parse or fail closed", () => {
  assert.ok(policy)
  assert.equal(policy.rules.length, 12)
  assert.equal(policy.sourceAuthority, "EBAY_OFFICIAL_HELP")
  assert.match(policy.sourceDigest, /^sha256:[a-f0-9]{64}$/)
  assert.match(policy.normalizedScheduleDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(policy.sourceEffectiveDate, null)
  assert.equal(parseEbayUsNoStoreFvfPolicyV1(html(rows.slice(0, 11)), now), null)
  const changed = rows.map((row) => [...row]); changed[10][0] = "Unknown fee class"
  assert.equal(parseEbayUsNoStoreFvfPolicyV1(html(changed), now), null)
  const addedException = rows.map((row) => [...row]); addedException[5][0] += " New Collectibles Class"
  assert.equal(parseEbayUsNoStoreFvfPolicyV1(html(addedException), now), null)
})

test("ordinary exact taxonomy path uses MOST_CATEGORIES at both order-fee thresholds", () => {
  const rule = resolved("Home & Garden:Home Décor:Frames")
  assert.equal(rule.status, "PROVEN")
  assert.equal(rule.ruleClass, "MOST_CATEGORIES")
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(rule, 50).applicablePercentageRate, 13.6)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(rule, 50).perOrderFee, 0.4)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(rule, 10).perOrderFee, 0.3)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(rule, 10.01).perOrderFee, 0.4)
})

test("every official exception has precedence over general class", () => {
  for (const [path, expected] of [
    ["Books & Magazines:Books", "BOOKS_MOVIES_MUSIC"],
    ["Coins & Paper Money:Bullion", "COINS_BULLION"],
    ["Clothing, Shoes & Accessories:Women:Women's Bags & Handbags:Totes", "WOMENS_BAGS"],
    ["Collectibles:Comic Books & Memorabilia:Modern Age", "SELECT_COLLECTIBLES"],
    ["Jewelry & Watches:Fashion Jewelry:Jewelry Sets", "JEWELRY_EXCEPT_WATCHES"],
    ["Jewelry & Watches:Watches, Parts & Accessories:Watches", "WATCHES"],
    ["Music:Music NFTs", "NFT"],
    ["Business & Industrial:Heavy Equipment Parts & Attachments:Heavy Equipment", "SELECT_BUSINESS_INDUSTRIAL"],
    ["Musical Instruments & Gear:Guitars & Basses:Electric Guitars", "GUITARS_BASSES"],
    ["Clothing, Shoes & Accessories:Men:Men's Shoes:Athletic Shoes", "ATHLETIC_SHOES"],
  ]) assert.equal(resolved(path).ruleId, expected, path)
  assert.equal(resolved("Music:Vinyl Records").ruleId, "MOST_CATEGORIES")
})

test("missing category, stale taxonomy, wrong store or legacy estimate cannot become policy", () => {
  assert.equal(resolved("Home & Garden:Frames", { categoryId: null }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { categoryAuthority: null }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { storeAuthority: {
    marketplaceAccountKey: account, marketplace: "EBAY_US", storeTier: "BASIC" } }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { policy: null }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { policy: {
    status: "ESTIMATED", variableFeeRate: 0.153, fixedFee: 0.4,
  } }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { accountKey: "another-account" }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { policy: {
    ...policy, normalizedScheduleDigest: "sha256:" + "0".repeat(64) } }).status, "MISSING")
  assert.equal(resolved("Home & Garden:Frames", { now: new Date("2026-09-25T20:30:00Z"),
    categoryAuthority: { ...ancestry("Home & Garden:Frames"),
      freshUntil: "2026-09-26T23:00:00Z" } }).status, "STALE")
})

test("percentage tiers and special thresholds are recalculated for every price", () => {
  const general = resolved("Home & Garden:Frames")
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(general, 7_500).applicablePercentageRate, 13.6)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(general, 7_500.01).applicablePercentageRate, 2.35)
  const shoe = resolved("Clothing, Shoes & Accessories:Men:Men's Shoes:Athletic Shoes")
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(shoe, 149.99).perOrderFee, 0.4)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(shoe, 150).perOrderFee, 0)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(shoe, 150).applicablePercentageRate, 8)
  const candidates = Array.from({ length: 50 }, (_, i) => (9_50 + i * 5) / 100)
  const floor = candidates.find((price) => price - 7.7 -
    evaluateEbayUsNoStoreFvfAtBasisV1(general, price).subtotal >= 0.8)
  assert.ok(floor > 10)
  assert.equal(evaluateEbayUsNoStoreFvfAtBasisV1(general, floor).perOrderFee, 0.4)
})

test("unknown performance and buyer context cannot mint final fee amount", () => {
  const rule = resolved("Home & Garden:Frames")
  const missing = assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
    itemPrice: 50, buyerShipping: 0, handling: 0, now })
  assert.equal(missing.sellerLevelSurcharge.status, "UNKNOWN")
  assert.equal(missing.serviceMetricsSurcharge.status, "UNKNOWN")
  assert.equal(missing.buyerDependentComponents.salesTax.status, "UNKNOWN")
  assert.equal(missing.finalFeeAmountAuthority, "INCOMPLETE")
  assert.equal(missing.calculatedFee, null)
  const profile = { accountBindingExact: true, observedAt: now.toISOString(),
    standards: { status: "AVAILABLE", standardsLevel: "ABOVE_STANDARD",
      evaluation: { evaluationType: "CURRENT" } },
    serviceMetrics: { status: "AVAILABLE", evaluation: { evaluationType: "CURRENT" },
      categories: [{ categoryId: "123", rating: "LOW" }] } }
  const zero = assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
    itemPrice: 50, buyerShipping: 0, handling: 0, performance: profile, now })
  assert.equal(zero.sellerLevelSurcharge.status, "PROVEN")
  assert.equal(zero.sellerLevelSurcharge.ratePct, 0)
  assert.equal(zero.serviceMetricsSurcharge.status, "PROVEN")
  assert.equal(zero.serviceMetricsSurcharge.ratePct, 0)
  assert.equal(zero.finalFeeAmountAuthority, "INCOMPLETE")
  const wrongCategory = assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
    itemPrice: 50, buyerShipping: 0, handling: 0, performance: {
      ...profile, serviceMetrics: { ...profile.serviceMetrics,
        categories: [{ categoryId: "999", rating: "LOW" }] } }, now })
  assert.equal(wrongCategory.serviceMetricsSurcharge.status, "UNKNOWN")
  const elevated = assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
    itemPrice: 50, buyerShipping: 0, handling: 0, performance: {
      ...profile, standards: { ...profile.standards, standardsLevel: "BELOW_STANDARD" },
      serviceMetrics: { ...profile.serviceMetrics,
        categories: [{ categoryId: "123", rating: "VERY_HIGH" }] } }, now })
  assert.equal(elevated.sellerLevelSurcharge.status, "UNKNOWN")
  assert.equal(elevated.sellerLevelSurcharge.reason, "BELOW_STANDARD_MONTH_STREAK_UNPROVEN")
  assert.equal(elevated.serviceMetricsSurcharge.status, "UNKNOWN")
  assert.equal(elevated.serviceMetricsSurcharge.reason, "VERY_HIGH_MONTH_STREAK_UNPROVEN")
  assert.equal(assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
    itemPrice: 50, buyerShipping: null, handling: null, now }).knownPreListingBasis, null)
})

test("OWNER ABOVE_STANDARD proves only current account-wide zero seller-level surcharge", () => {
  const current = new Date("2026-09-23T21:00:00Z")
  const seller = resolveEbaySellerLevelSurchargeV1({ accountKey: account, now: current })
  assert.equal(seller.status, "PROVEN")
  assert.equal(seller.applicable, false)
  assert.equal(seller.ratePct, 0)
  assert.equal(seller.scope, "OWNER_OBSERVED_CURRENT_ACCOUNT_STATE")
  assert.equal(resolveEbaySellerLevelSurchargeV1({ accountKey: "wrong-account", now: current }).status,
    "UNKNOWN")
  assert.equal(resolveEbaySellerLevelSurchargeV1({ accountKey: account,
    now: new Date("2026-09-25T21:00:00Z") }).status, "UNKNOWN")
  const conflicting = resolveEbaySellerLevelSurchargeV1({ accountKey: account, now: current,
    performance: { accountBindingExact: true, observedAt: current.toISOString(),
      standards: { status: "AVAILABLE", standardsLevel: "BELOW_STANDARD",
        evaluation: { evaluationType: "CURRENT" } } } })
  assert.equal(conflicting.status, "UNKNOWN")
  assert.equal(conflicting.reason, "BELOW_STANDARD_MONTH_STREAK_UNPROVEN")
})

test("OWNER zero family rates do not prove exact-category service surcharge or final fee", () => {
  const current = new Date("2026-09-23T21:25:00Z")
  for (const path of ["Clothing, Shoes & Accessories:Men:Men's Shirts",
    "Health & Beauty:Fragrances:Perfumes"]) {
    // Synthetic taxonomy ancestry only; neither real SKU gains category authority here.
    const rule = resolved(path, { now: current })
    const assessed = assessEbayUsNoStoreFvfAmountV1({ policyAuthority: rule,
      itemPrice: 50, buyerShipping: null, handling: null, now: current })
    assert.equal(assessed.sellerLevelSurcharge.status, "PROVEN")
    assert.equal(assessed.serviceMetricsSurcharge.status, "UNKNOWN")
    assert.equal(assessed.serviceMetricsSurcharge.ownerObservedRatePct, 0)
    assert.equal(assessed.serviceMetricsSurcharge.reason,
      "OWNER_ZERO_RATE_WITHOUT_APPLICABLE_EVALUATION_PERIOD")
    assert.equal(assessed.finalFeeAmountAuthority, "INCOMPLETE")
    assert.equal(assessed.priceAuthorized, false)
  }
  const unrelated = assessEbayUsNoStoreFvfAmountV1({
    policyAuthority: resolved("Home & Garden:Frames", { now: current }),
    itemPrice: 50, buyerShipping: null, handling: null, now: current })
  assert.equal(unrelated.serviceMetricsSurcharge.ownerObservedRatePct, null)
  const missingCategory = assessEbayUsNoStoreFvfAmountV1({
    policyAuthority: resolved("Health & Beauty:Fragrances:Perfumes",
      { now: current, categoryId: null }),
    itemPrice: 50, buyerShipping: null, handling: null, now: current })
  assert.equal(missingCategory.sellerLevelSurcharge.status, "PROVEN")
  assert.equal(missingCategory.serviceMetricsSurcharge.status, "UNKNOWN")
  assert.equal(missingCategory.serviceMetricsSurcharge.ownerObservedRatePct, null)
})

test("OWNER current displayed window proves zero only for exact ITEM-8058 UI path", () => {
  const observed = new Date("2026-09-23T21:25:00Z")
  const clothing = assessOwnerObservedServiceMetricsWindowV1({ accountKey: account,
    supplierSku: "ITEM-8058-RED-LU-DE", now: observed })
  assert.equal(clothing.displayedWindowStatus, "PROVEN_ZERO")
  assert.equal(clothing.categoryFamily, "Clothing, Shoes & Accessories")
  assert.equal(clothing.totalTransactions, 2)
  assert.equal(clothing.inadCases, 0)
  assert.deepEqual(clothing.displayedWindow,
    { fromMonth: "2025-09", throughMonth: "2026-08" })
  assert.equal(clothing.exactEbayCategoryId, null)
  assert.equal(clothing.pastWindowEvidenceStatus, "NO_DATA")
  assert.equal(clothing.pastObservedRatePct, null)
  assert.equal(clothing.pastTotalTransactions, null)
  assert.equal(clothing.conditionalSeptemberStatusIfExactCategoryBound, "UNKNOWN")
  assert.equal(clothing.reason, "NO_DATA_DOES_NOT_PROVE_NO_EVALUATION")
  assert.equal(clothing.applicableCurrentFeeMonthSurchargeStatus, "UNKNOWN")
  assert.equal(assessOwnerObservedServiceMetricsWindowV1({ accountKey: "wrong-account",
    supplierSku: "ITEM-8058-RED-LU-DE", now: observed }).displayedWindowStatus, "MISSING")
  assert.equal(assessOwnerObservedServiceMetricsWindowV1({ accountKey: account,
    supplierSku: "unrelated-sku", now: observed }).displayedWindowStatus, "MISSING")
  assert.equal(assessOwnerObservedServiceMetricsWindowV1({ accountKey: account,
    supplierSku: "ITEM-8058-RED-LU-DE",
    now: new Date("2026-09-25T21:15:00Z") }).displayedWindowStatus, "MISSING")
})

test("ITEM5674 family zero remains unbound to exact category and no SKU gets current fee zero", () => {
  const observed = new Date("2026-09-23T21:25:00Z")
  const fragrance = assessOwnerObservedServiceMetricsWindowV1({ accountKey: account,
    supplierSku: "ITEM5674", now: observed })
  assert.equal(fragrance.displayedWindowStatus, "FAMILY_ZERO_SKU_CATEGORY_UNBOUND")
  assert.equal(fragrance.categoryFamily, "Health & Beauty")
  assert.equal(fragrance.totalTransactions, 1)
  assert.equal(fragrance.inadCases, 0)
  assert.equal(fragrance.pastWindowEvidenceStatus, "PROVEN_ZERO_FAMILY")
  assert.equal(fragrance.pastObservedRatePct, 0)
  assert.equal(fragrance.pastTotalTransactions, 1)
  assert.equal(fragrance.pastInadCases, 0)
  assert.equal(fragrance.conditionalSeptemberStatusIfExactCategoryBound, "PROVEN_ZERO")
  assert.equal(fragrance.listingUiCategoryPath, null)
  assert.equal(fragrance.applicableCurrentFeeMonthSurchargeStatus, "UNKNOWN")
  for (const sku of ["ITEM-8058-RED-LU-DE", "ITEM5674"]) {
    const assessed = assessEbayUsNoStoreFvfAmountV1({
      policyAuthority: resolved("Health & Beauty:Fragrances",
        { categoryId: null, now: observed }),
      supplierSku: sku, itemPrice: 40, buyerShipping: null, handling: null,
      now: observed })
    assert.equal(assessed.serviceMetricsSurcharge.status, "UNKNOWN")
    assert.equal(assessed.priceAuthorized, false)
    assert.equal(assessed.finalFeeAmountAuthority, "INCOMPLETE")
  }
})
