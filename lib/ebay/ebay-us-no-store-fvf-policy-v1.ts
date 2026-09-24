import { createHash } from "node:crypto"
import ownerStore from "../../docs/ebay-us-no-store-owner-attestation-v1.json" with { type: "json" }
import ownerPerformance from "../../docs/ebay-fee-owner-performance-attestation-v1.json" with { type: "json" }
import officialCapture from "../../docs/ebay-us-no-store-fvf-official-capture-v1.json" with { type: "json" }
import ownerConservativeFeePolicy from "../../docs/ebay-prelisting-owner-conservative-fee-policy-v1.json" with { type: "json" }
import { currentCategoryAncestryV1 } from "./ebay-package-category-fee-binding-v1"
import { currentOwnerConfirmedDraftCategoryReceiptV1 } from
  "./ebay-owner-confirmed-draft-category-v1"

export const EBAY_US_NO_STORE_FVF_POLICY_V1 = "EBAY_US_NO_STORE_FVF_POLICY_V1" as const
export const EBAY_US_NO_STORE_FVF_SOURCE =
  "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822" as const
// Pinned normalized official-table capture. Updating this value requires a
// manual source review and a new snapshot/revalidation record.
const EBAY_US_NO_STORE_FVF_CAPTURE_DIGEST_V1 =
  "sha256:d037560297cef3e2a85eb06b59dc9a71721b8db6095ddf4f9f46ce52cc555022" as const
type R = Record<string, unknown>
const record = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const hash = (v: string) => `sha256:${createHash("sha256").update(v).digest("hex")}`
const clean = (v: string) => v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim()
const roundUp = (v: number) => Math.ceil((v - 1e-9) * 100) / 100
const fresh = (observed: unknown, until: unknown, now: Date) => {
  const a = Date.parse(String(observed ?? "")), b = Date.parse(String(until ?? ""))
  return Number.isFinite(a) && Number.isFinite(b) && a <= now.getTime() && b > now.getTime()
}

const groups = [
  ["MOST_CATEGORIES", /^Most categories, including eBay Motors > Parts & Accessories, Automotive Tools & Supplies, and Safety & Security Accessories\. For vehicles, see our Motors fees\s*\.$/, "MARGINAL", 2, 1],
  ["BOOKS_MOVIES_MUSIC", /^Books & Magazines Movies & TV \(except Movie NFTs\) Music \(except Vinyl Records and Music NFTs categories\)$/, "MARGINAL", 2, 1],
  ["COINS_EXCEPT_BULLION", /^Coins & Paper Money \(except Bullion\)$/, "MARGINAL", 2, 1],
  ["COINS_BULLION", /^Coins & Paper Money > Bullion$/, "WHOLE_AMOUNT", 2, 1],
  ["WOMENS_BAGS", /^Clothing, Shoes & Accessories > Women > Women's Bags & Handbags$/, "WHOLE_AMOUNT", 2, 1],
  ["SELECT_COLLECTIBLES", /^Select Collectibles categories: Comic Books & Memorabilia Non-Sport Trading Cards Sports Mem, Cards & Fan Shop > Sports Trading Cards Toys & Hobbies > Collectible Card Games$/, "MARGINAL", 2, 1],
  ["JEWELRY_EXCEPT_WATCHES", /^Jewelry & Watches \(except Watches, Parts & Accessories\)$/, "WHOLE_AMOUNT", 2, 1],
  ["WATCHES", /^Jewelry & Watches > Watches, Parts & Accessories$/, "MARGINAL", 3, 2],
  ["NFT", /^The following NFT categories: Art NFTs CCG NFTs Emerging NFTs Movie NFTs Music NFTs Non-Sport Trading Card NFTs Sport Trading Card NFTs$/, "FLAT", 1, 0],
  ["SELECT_BUSINESS_INDUSTRIAL", /^Select Business & Industrial categories: Heavy Equipment Parts & Attachments > Heavy Equipment Printing & Graphic Arts > Commercial Printing Presses Restaurant & Food Service > Food Trucks, Trailers & Carts$/, "MARGINAL", 2, 1],
  ["GUITARS_BASSES", /^Musical Instruments & Gear > Guitars & Basses$/, "MARGINAL", 2, 1],
  ["ATHLETIC_SHOES", /^Select Clothing, Shoes & Accessories categories: Men > Men's Shoes > Athletic Shoes Women > Women's Shoes > Athletic Shoes$/, "ATHLETIC", 2, 1],
] as const

/** All twelve basic-table classes are required. A changed or partial table
 * cannot silently fall back to the general rate. No legal effective date is
 * manufactured from an observation timestamp. */
export function parseEbayUsNoStoreFvfPolicyV1(html: string, now = new Date()) {
  if (html.length < 5_000 || html.length > 2_000_000 ||
      !html.includes("Basic fees for most categories") ||
      !html.includes("Sellers not meeting performance expectations")) return null
  const fixed = clean(html).match(/For orders \$([\d,.]+) or less the per order fee is \$([\d.]+), for orders over \$([\d,.]+) the per order fee is \$([\d.]+)\./)
  if (!fixed || fixed[1] !== fixed[3]) return null
  const threshold = Number(fixed[1].replaceAll(",", ""))
  const low = Number(fixed[2]), high = Number(fixed[4])
  if (![threshold, low, high].every(Number.isFinite) || threshold <= 0 || low < 0 || high < 0) return null
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 100)
    .map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => clean(c[1])))
  const first = rows.findIndex((row) => row[0] === "Category" &&
    row.some((cell) => cell.includes("Final value fee")))
  if (first < 0 || rows.length < first + 13) return null
  const rules = groups.map(([id, label, method, rateCount, thresholdCount], i) => {
    const row = rows[first + i + 1], category = row?.[0] ?? ""
    const feeText = row?.at(-1) ?? ""
    const rates = [...feeText.matchAll(/(\d+(?:\.\d+)?)%/g)]
      .map((match) => Number(match[1]))
    const limits = [...new Set([...feeText.matchAll(/\$([\d,.]+)/g)]
      .map((match) => Number(match[1].replaceAll(",", ""))))]
    const shape = method === "MARGINAL" ? feeText.includes("portion of the sale") :
      method === "WHOLE_AMOUNT" ? feeText.includes("if total amount of the sale") :
        method === "ATHLETIC" ? feeText.includes("per order fee is not charged") :
          feeText.includes("on total amount of the sale")
    if (!label.test(category) || rates.length !== rateCount ||
        limits.length !== thresholdCount || !shape ||
        rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100) ||
        limits.some((limit) => !Number.isFinite(limit) || limit <= 0)) return null
    return { id, ruleClass: id === "MOST_CATEGORIES" ? "MOST_CATEGORIES" : "CATEGORY_EXCEPTION",
      method, percentageTiers: rates.map((ratePct, index) => ({
        ratePct, upTo: limits[index] ?? null })), categoryLabel: category,
      sourceFeeTextDigest: hash(feeText) }
  })
  if (rules.some((rule) => rule === null)) return null
  const normalized = { perOrderFeeRule: { threshold, atOrBelow: low, above: high }, rules }
  return Object.freeze({ policyVersion: EBAY_US_NO_STORE_FVF_POLICY_V1,
    sourceUrl: EBAY_US_NO_STORE_FVF_SOURCE,
    sourceAuthority: "EBAY_OFFICIAL_HELP" as const,
    marketplace: "EBAY_US" as const, storeTier: "NO_STORE" as const,
    ...normalized, capturedAt: now.toISOString(),
    revalidateAfter: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    sourceDigest: hash(clean(html)), normalizedScheduleDigest: hash(JSON.stringify(normalized)),
    sourceEffectiveDate: null,
    sourceEffectiveDateStatus: "NOT_PUBLISHED_IN_RETRIEVED_PAGE" as const })
}

/** Runtime uses a pinned, manually revalidated official-source capture.
 * The digest covers the normalized basic FVF table, not eBay's raw HTML.
 * CAPTCHA or a network failure cannot silently change the fee policy. */
export async function readEbayUsNoStoreFvfPolicyV1(now = new Date()) {
  const capture = officialCapture
  const normalized = { perOrderFeeRule: capture.perOrderFeeRule,
    rules: capture.rules }
  if (capture.contractVersion !== "EBAY_US_NO_STORE_FVF_OFFICIAL_CAPTURE_V1" ||
      capture.policyVersion !== EBAY_US_NO_STORE_FVF_POLICY_V1 ||
      capture.sourceUrl !== EBAY_US_NO_STORE_FVF_SOURCE ||
      capture.sourceAuthority !== "EBAY_OFFICIAL_HELP" ||
      capture.marketplace !== "EBAY_US" || capture.storeTier !== "NO_STORE" ||
      capture.sourceDigestScope !== "NORMALIZED_OFFICIAL_BASIC_FVF_TABLE_NOT_RAW_HTML" ||
      capture.sourceDigest !== EBAY_US_NO_STORE_FVF_CAPTURE_DIGEST_V1 ||
      capture.sourceDigest !== hash(JSON.stringify(normalized)) ||
      !fresh(capture.capturedAt, capture.revalidateAfter, now) ||
      capture.rules.length !== groups.length ||
      capture.rules.some((rule, index) => rule.id !== groups[index][0] ||
        !Array.isArray(rule.percentageTiers) || !rule.percentageTiers.length ||
        rule.percentageTiers.some((tier) => !Number.isFinite(tier.ratePct) ||
          tier.ratePct < 0 || tier.ratePct > 100 ||
          tier.upTo !== null && (!Number.isFinite(tier.upTo) || tier.upTo <= 0)))) return null
  const rules = capture.rules.map((rule) => ({ ...rule,
    sourceFeeTextDigest: hash(JSON.stringify(rule)) }))
  return Object.freeze({ policyVersion: EBAY_US_NO_STORE_FVF_POLICY_V1,
    sourceUrl: EBAY_US_NO_STORE_FVF_SOURCE,
    sourceAuthority: "EBAY_OFFICIAL_HELP" as const,
    marketplace: "EBAY_US" as const, storeTier: "NO_STORE" as const,
    perOrderFeeRule: capture.perOrderFeeRule, rules,
    capturedAt: capture.capturedAt, revalidateAfter: capture.revalidateAfter,
    sourceDigest: capture.sourceDigest,
    sourceDigestScope: capture.sourceDigestScope,
    normalizedScheduleDigest: hash(JSON.stringify({ perOrderFeeRule: capture.perOrderFeeRule,
      rules })), sourceEffectiveDate: null,
    sourceEffectiveDateStatus: "NOT_PUBLISHED_IN_RETRIEVED_PAGE" as const })
}

const starts = (path: string[], prefix: string[]) =>
  prefix.length <= path.length && prefix.every((part, index) => path[index] === part)
function exceptionId(path: string[]) {
  const root = path[0], leaf = path.at(-1)
  if (["Art NFTs", "CCG NFTs", "Emerging NFTs", "Movie NFTs", "Music NFTs",
    "Non-Sport Trading Card NFTs", "Sport Trading Card NFTs"].includes(leaf ?? "")) return "NFT"
  if (root === "Coins & Paper Money") return path[1] === "Bullion" ? "COINS_BULLION" : "COINS_EXCEPT_BULLION"
  if (starts(path, ["Clothing, Shoes & Accessories", "Women", "Women's Bags & Handbags"])) return "WOMENS_BAGS"
  if (starts(path, ["Clothing, Shoes & Accessories", "Men", "Men's Shoes", "Athletic Shoes"]) ||
      starts(path, ["Clothing, Shoes & Accessories", "Women", "Women's Shoes", "Athletic Shoes"])) return "ATHLETIC_SHOES"
  if (starts(path, ["Collectibles", "Comic Books & Memorabilia"]) ||
      starts(path, ["Collectibles", "Non-Sport Trading Cards"]) ||
      starts(path, ["Sports Mem, Cards & Fan Shop", "Sports Trading Cards"]) ||
      starts(path, ["Toys & Hobbies", "Collectible Card Games"])) return "SELECT_COLLECTIBLES"
  if (root === "Jewelry & Watches") return path[1] === "Watches, Parts & Accessories" ? "WATCHES" : "JEWELRY_EXCEPT_WATCHES"
  if (starts(path, ["Business & Industrial", "Heavy Equipment Parts & Attachments", "Heavy Equipment"]) ||
      starts(path, ["Business & Industrial", "Printing & Graphic Arts", "Commercial Printing Presses"]) ||
      starts(path, ["Business & Industrial", "Restaurant & Food Service", "Food Trucks, Trailers & Carts"])) return "SELECT_BUSINESS_INDUSTRIAL"
  if (starts(path, ["Musical Instruments & Gear", "Guitars & Basses"])) return "GUITARS_BASSES"
  if (root === "Books & Magazines" || root === "Movies & TV" && !path.includes("Movie NFTs") ||
      root === "Music" && !path.includes("Vinyl Records") && !path.includes("Music NFTs")) return "BOOKS_MOVIES_MUSIC"
  return "MOST_CATEGORIES"
}

export function resolveEbayUsNoStoreFvfPolicyV1(input: Readonly<{
  accountKey: string; categoryId: string | null; categoryAuthority: unknown
  policy: Awaited<ReturnType<typeof readEbayUsNoStoreFvfPolicyV1>>
  productId?: string; variantId?: string; supplierSku?: string
  storeAuthority?: unknown; now?: Date
}>) {
  const now = input.now ?? new Date(), policy = input.policy
  const store = record(input.storeAuthority ?? ownerStore)
  const accountReady = store.marketplaceAccountKey === input.accountKey &&
    store.marketplace === "EBAY_US" && store.storeTier === "NO_STORE" &&
    (store.source === "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION" &&
      store.contractVersion === "EBAY_US_NO_STORE_OWNER_ATTESTATION_V1" &&
      fresh(store.capturedAt, store.revalidateAfter, now) ||
      store.status === "PROVEN" && store.source === "EBAY_ACCOUNT_OFFICIAL_READONLY" &&
      fresh(store.observedAt, store.freshUntil, now))
  const suppliedCategory = record(input.categoryAuthority)
  const ownerDraftReady = Boolean(input.categoryId && input.productId &&
    input.variantId && input.supplierSku &&
    currentOwnerConfirmedDraftCategoryReceiptV1(suppliedCategory, {
      marketplaceAccountKey: input.accountKey,
      productId: input.productId ?? "", variantId: input.variantId ?? "",
      supplierSku: input.supplierSku ?? "", categoryId: input.categoryId ?? "",
      now }))
  const category = ownerDraftReady
    ? record(suppliedCategory.officialCategoryAuthority) : suppliedCategory
  const categoryReady = Boolean(input.categoryId) &&
    currentCategoryAncestryV1(category, input.categoryId, now) &&
    category.path?.toString().split(":").every(Boolean) &&
    (suppliedCategory.status !== "OWNER_CONFIRMED" || ownerDraftReady)
  const policyReady = Boolean(policy && policy.policyVersion === EBAY_US_NO_STORE_FVF_POLICY_V1 &&
    policy.sourceUrl === EBAY_US_NO_STORE_FVF_SOURCE &&
    policy.sourceAuthority === "EBAY_OFFICIAL_HELP" &&
    policy.storeTier === "NO_STORE" && policy.rules.length === groups.length &&
    policy.normalizedScheduleDigest === hash(JSON.stringify({ perOrderFeeRule: policy.perOrderFeeRule,
      rules: policy.rules })) &&
    /^sha256:[a-f0-9]{64}$/.test(policy.sourceDigest) &&
    fresh(policy.capturedAt, policy.revalidateAfter, now))
  const path = categoryReady ? String(category.path).split(":") : []
  const ruleId = categoryReady ? exceptionId(path) : null
  const rule = policyReady && ruleId ? policy!.rules.find((entry) => entry?.id === ruleId) : null
  const supported = categoryReady && !["Real Estate", "Specialty Services"].includes(path[0]) &&
    !(path[0] === "eBay Motors" && path[1] !== "Parts & Accessories")
  const stalePolicy = Boolean(policy && policy.policyVersion === EBAY_US_NO_STORE_FVF_POLICY_V1 &&
    Date.parse(policy.revalidateAfter) <= now.getTime())
  const status = accountReady && categoryReady && supported && stalePolicy
    ? "STALE" as const :
    !accountReady || !categoryReady || !supported || !rule ? "MISSING" as const : "PROVEN" as const
  return Object.freeze({ status, policyVersion: policy?.policyVersion ?? null,
    sourceUrl: policy?.sourceUrl ?? EBAY_US_NO_STORE_FVF_SOURCE,
    sourceAuthority: policy?.sourceAuthority ?? "EBAY_OFFICIAL_HELP",
    marketplace: "EBAY_US" as const, marketplaceAccountKey: input.accountKey,
    storeTier: accountReady ? "NO_STORE" as const : null,
    storeAuthoritySource: accountReady ? store.source : null,
    categoryId: categoryReady ? input.categoryId : null,
    categoryBindingStatus: categoryReady
      ? ownerDraftReady ? "OWNER_CONFIRMED" as const : "PROVEN" as const
      : "MISSING" as const,
    ownerDraftReceiptDigest: ownerDraftReady ? suppliedCategory.receiptDigest : null,
    categoryPath: categoryReady ? category.path : null,
    categoryAuthorityDigest: categoryReady ? category.digest : null,
    categoryTreeVersion: categoryReady ? category.treeVersion : null,
    categoryAncestorIds: categoryReady ? category.ancestorIds : null,
    ruleClass: status === "PROVEN" ? rule!.ruleClass : null,
    ruleId: status === "PROVEN" ? rule!.id : null,
    method: status === "PROVEN" ? rule!.method : null,
    percentageTiers: status === "PROVEN" ? rule!.percentageTiers : null,
    perOrderFeeRule: status === "PROVEN" ? policy!.perOrderFeeRule : null,
    priceApplicability: status === "PROVEN" ? "TOTAL_AMOUNT_OF_SALE" : null,
    capturedAt: policy?.capturedAt ?? null, revalidateAfter: policy?.revalidateAfter ?? null,
    sourceDigest: policy?.sourceDigest ?? null,
    sourceDigestScope: record(policy).sourceDigestScope ??
      "RAW_OFFICIAL_PAGE_TEXT_OR_UNSPECIFIED",
    normalizedScheduleDigest: policy?.normalizedScheduleDigest ?? null,
    sourceEffectiveDate: null,
    blocker: !accountReady ? "NO_STORE_ACCOUNT_AUTHORITY_MISSING" :
      !categoryReady ? "EXACT_EBAY_CATEGORY_AUTHORITY_MISSING" :
        !supported ? "CATEGORY_OUTSIDE_BASIC_FVF_SCOPE" :
          !policyReady ? "OFFICIAL_FEE_SOURCE_MISSING_OR_STALE" :
            !rule ? "CATEGORY_RULE_MISSING" : null })
}

/** One price, one rule. This is policy arithmetic on a stated sale basis,
 * NOT an authoritative final fee: buyer tax and order context may be missing. */
export function evaluateEbayUsNoStoreFvfAtBasisV1(authority: ReturnType<typeof resolveEbayUsNoStoreFvfPolicyV1>,
  totalSaleBasis: number) {
  if (authority.status !== "PROVEN" || !Number.isFinite(totalSaleBasis) || totalSaleBasis < 0 ||
      !authority.percentageTiers || !authority.perOrderFeeRule || !authority.method) return null
  const tiers = authority.percentageTiers
  let variable = 0, ratePct = 0, previous = 0
  if (authority.method === "MARGINAL") {
    for (const tier of tiers) {
      const end = tier.upTo === null ? totalSaleBasis : Math.min(totalSaleBasis, tier.upTo)
      variable += Math.max(0, end - previous) * tier.ratePct / 100
      if (end > previous) ratePct = tier.ratePct
      previous = end
      if (end >= totalSaleBasis) break
    }
  } else {
    const selected = authority.method === "ATHLETIC"
      ? totalSaleBasis >= Number(tiers[0].upTo) ? tiers[0] : tiers[1]
      : tiers.find((tier) => tier.upTo === null || totalSaleBasis <= tier.upTo) ?? tiers.at(-1)!
    ratePct = selected.ratePct
    variable = totalSaleBasis * ratePct / 100
  }
  const fixed = authority.method === "ATHLETIC" &&
    totalSaleBasis >= Number(tiers[0].upTo) ? 0 :
    totalSaleBasis <= authority.perOrderFeeRule.threshold
      ? authority.perOrderFeeRule.atOrBelow : authority.perOrderFeeRule.above
  return Object.freeze({ status: "POLICY_ARITHMETIC_ONLY" as const,
    totalSaleBasis, applicablePercentageRate: ratePct,
    variableFee: roundUp(variable), perOrderFee: fixed,
    subtotal: roundUp(variable + fixed),
    finalFeeAmountAuthority: "INCOMPLETE" as const })
}

/** Account-wide seller level is independent of category-rate authority.
 * An official contradictory current profile must not be overridden by the
 * OWNER's earlier UI observation. This only proves the observed account
 * state, never the fee amount for a future sale. */
export function resolveEbaySellerLevelSurchargeV1(input: Readonly<{
  accountKey: string; performance?: unknown; ownerAttestation?: unknown; now?: Date
}>) {
  const now = input.now ?? new Date(), p = record(input.performance)
  const standards = record(p.standards), observed = Date.parse(String(p.observedAt ?? ""))
  const officialCurrent = p.accountBindingExact === true &&
    Number.isFinite(observed) && observed <= now.getTime() &&
    observed + 6 * 3600_000 > now.getTime() &&
    standards.status === "AVAILABLE" &&
    record(standards.evaluation).evaluationType === "CURRENT"
  if (officialCurrent) {
    if (["TOP_RATED", "ABOVE_STANDARD"].includes(String(standards.standardsLevel)))
      return Object.freeze({ status: "PROVEN" as const, applicable: false,
        ratePct: 0, source: standards.source ?? "EBAY_SELLER_STANDARDS_PROFILE",
        scope: "CURRENT_ACCOUNT_PROFILE", reason: null })
    return Object.freeze({ status: "UNKNOWN" as const, applicable: null,
      ratePct: null, source: standards.source ?? "EBAY_SELLER_STANDARDS_PROFILE",
      scope: "CURRENT_ACCOUNT_PROFILE",
      reason: "BELOW_STANDARD_MONTH_STREAK_UNPROVEN" })
  }
  const owner = record(input.ownerAttestation ?? ownerPerformance)
  const levels = record(owner.sellerLevel)
  const ownerCurrent = owner.contractVersion === "EBAY_FEE_OWNER_PERFORMANCE_ATTESTATION_V1" &&
    owner.source === "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION" &&
    owner.marketplace === "EBAY_US" && owner.marketplaceAccountKey === input.accountKey &&
    fresh(owner.recordedAt, owner.revalidateAfter, now) &&
    levels.current === "ABOVE_STANDARD" &&
    levels.ifEvaluatedToday === "ABOVE_STANDARD" &&
    levels.previous === "ABOVE_STANDARD"
  return Object.freeze(ownerCurrent
    ? { status: "PROVEN" as const, applicable: false, ratePct: 0,
      source: "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION",
      scope: "OWNER_OBSERVED_CURRENT_ACCOUNT_STATE",
      recordedAt: owner.recordedAt, revalidateAfter: owner.revalidateAfter,
      reason: null }
    : { status: "UNKNOWN" as const, applicable: null, ratePct: null,
      source: null, scope: null, reason: "CURRENT_SELLER_LEVEL_UNPROVEN" })
}

/** Proves only the OWNER-observed INAD result for its displayed evaluation
 * window. The fee charged in a calendar month depends on a different,
 * specifically dated evaluation and is never inferred from this window. */
export function assessOwnerObservedServiceMetricsWindowV1(input: Readonly<{
  accountKey: string; supplierSku: string | null; now?: Date
  ownerAttestation?: unknown
}>) {
  const now = input.now ?? new Date(), owner = record(input.ownerAttestation ?? ownerPerformance)
  const exactAccount = owner.contractVersion === "EBAY_FEE_OWNER_PERFORMANCE_ATTESTATION_V1" &&
    owner.marketplace === "EBAY_US" && owner.marketplaceAccountKey === input.accountKey &&
    owner.source === "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION"
  const currentFresh = exactAccount &&
    fresh(owner.serviceEvidenceRecordedAt, owner.serviceRevalidateAfter, now)
  const matches = exactAccount && Array.isArray(owner.serviceMetrics)
    ? owner.serviceMetrics.map(record).filter((entry) =>
      entry.ownerObservedSku === input.supplierSku &&
      entry.metric === "ITEM_NOT_AS_DESCRIBED") : []
  const metric = matches.length === 1 ? matches[0] : {}
  const window = record(metric.currentDisplayedWindow)
  const month = (value: unknown) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ""))
  const validWindow = month(window.fromMonth) && month(window.throughMonth) &&
    String(window.fromMonth) <= String(window.throughMonth)
  const observedZero = currentFresh && matches.length === 1 && validWindow &&
    metric.observedRatePct === 0 && metric.inadCases === 0 &&
    Number.isSafeInteger(metric.totalTransactions) && Number(metric.totalTransactions) > 0
  const path = Array.isArray(metric.listingUiCategoryPath)
    ? metric.listingUiCategoryPath : []
  const exactOwnerPath = observedZero &&
    metric.skuBindingStatus === "OWNER_EXACT_LISTING_UI_PATH_OBSERVED" &&
    path.length >= 2 && path.length <= 8 && path[0] === metric.categoryFamily &&
    path.every((part) => typeof part === "string" && part.length > 0)
  const pastWindow = record(metric.pastWindow)
  const pastEvidence = record(metric.pastWindowEvidence)
  const pastFresh = exactAccount &&
    fresh(owner.pastEvidenceRecordedAt, owner.pastRevalidateAfter, now) &&
    month(pastWindow.fromMonth) && month(pastWindow.throughMonth) &&
    String(pastWindow.fromMonth) <= String(pastWindow.throughMonth)
  const pastZero = pastFresh && pastEvidence.status === "OBSERVED_RATE" &&
    pastEvidence.observedRatePct === 0 && pastEvidence.inadCases === 0 &&
    Number.isSafeInteger(pastEvidence.totalTransactions) &&
    Number(pastEvidence.totalTransactions) > 0
  const pastNoData = pastFresh && pastEvidence.status === "NO_DATA" &&
    pastEvidence.observedRatePct === null &&
    pastEvidence.totalTransactions === null && pastEvidence.inadCases === null &&
    pastEvidence.evaluatedRating === null &&
    pastEvidence.uiMessage === "You don't have any data available for this selection."
  return Object.freeze({
    displayedWindowStatus: exactOwnerPath ? "PROVEN_ZERO" as const :
      observedZero ? "FAMILY_ZERO_SKU_CATEGORY_UNBOUND" as const : "MISSING" as const,
    pastWindowEvidenceStatus: pastZero ? "PROVEN_ZERO_FAMILY" as const :
      pastNoData ? "NO_DATA" as const : "MISSING" as const,
    pastWindow: pastZero || pastNoData ? pastWindow : null,
    pastObservedRatePct: pastZero ? 0 : null,
    pastTotalTransactions: pastZero ? pastEvidence.totalTransactions : null,
    pastInadCases: pastZero ? 0 : null,
    pastEvaluatedRating: null,
    conditionalSeptemberStatusIfExactCategoryBound: pastZero
      ? "PROVEN_ZERO" as const : "UNKNOWN" as const,
    applicableCurrentFeeMonthSurchargeStatus: "UNKNOWN" as const,
    source: observedZero || pastZero || pastNoData
      ? "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION" : null,
    accountKey: input.accountKey, supplierSku: input.supplierSku,
    categoryFamily: observedZero ? metric.categoryFamily : null,
    listingUiCategoryPath: exactOwnerPath ? path : null,
    exactEbayCategoryId: null,
    observedRatePct: observedZero ? 0 : null,
    totalTransactions: observedZero ? metric.totalTransactions : null,
    inadCases: observedZero ? 0 : null,
    displayedWindow: observedZero ? window : null,
    evaluatedOn: null, applicableFeeMonth: null,
    reason: pastNoData ? "NO_DATA_DOES_NOT_PROVE_NO_EVALUATION" :
      pastZero ? "EXACT_SKU_CATEGORY_BINDING_NOT_PROVEN" :
      exactOwnerPath ? "APPLICABLE_FEE_MONTH_EVALUATION_NOT_PROVEN" :
      observedZero ? "EXACT_SKU_CATEGORY_BINDING_NOT_PROVEN" :
        "OWNER_SERVICE_METRICS_EVIDENCE_MISSING_OR_STALE",
  })
}

export function assessEbayUsNoStoreFvfAmountV1(input: Readonly<{
  policyAuthority: ReturnType<typeof resolveEbayUsNoStoreFvfPolicyV1>
  itemPrice: number | null; buyerShipping: number | null; handling: number | null
  supplierSku?: string | null; performance?: unknown; now?: Date
}>) {
  const p = record(input.performance), service = record(p.serviceMetrics)
  const category = input.policyAuthority
  const now = input.now ?? new Date()
  const observed = Date.parse(String(p.observedAt ?? ""))
  const current = category.status === "PROVEN" && p.accountBindingExact === true &&
    Number.isFinite(observed) && observed <= now.getTime() &&
    observed + 6 * 3600_000 > now.getTime()
  const sellerLevel = resolveEbaySellerLevelSurchargeV1({
    accountKey: category.marketplaceAccountKey, performance: input.performance, now })
  const scopedCategoryIds = [category.categoryId,
    ...(Array.isArray(category.categoryAncestorIds) ? category.categoryAncestorIds : [])]
  const matches = Array.isArray(service.categories) ? service.categories.map(record).filter((entry) =>
    scopedCategoryIds.includes(entry.categoryId)) : []
  const owner = record(ownerPerformance)
  const ownerMetric = category.status === "PROVEN" &&
    owner.marketplaceAccountKey === category.marketplaceAccountKey &&
    fresh(owner.serviceEvidenceRecordedAt, owner.serviceRevalidateAfter, now) &&
    Array.isArray(owner.serviceMetrics)
    ? owner.serviceMetrics.map(record).find((entry) =>
      entry.categoryFamily === String(category.categoryPath).split(":")[0] &&
      entry.metric === "ITEM_NOT_AS_DESCRIBED" && entry.observedRatePct === 0)
    : null
  const serviceMetrics = current && service.status === "AVAILABLE" &&
    record(service.evaluation).evaluationType === "CURRENT" && matches.length === 1 &&
    ["LOW", "AVERAGE", "HIGH", "NOT_APPLICABLE"].includes(String(matches[0].rating))
    ? { status: "PROVEN" as const, applicable: false, ratePct: 0,
      source: service.source ?? "EBAY_CURRENT_CATEGORY_SERVICE_METRICS",
      ownerObservedRatePct: ownerMetric ? 0 : null, reason: null }
    : { status: "UNKNOWN" as const, applicable: null, ratePct: null,
      source: ownerMetric ? "OWNER_DIRECT_SELLER_ACCOUNT_UI_CONFIRMATION" : null,
      ownerObservedRatePct: ownerMetric ? 0 : null,
      reason: current && matches.length === 1 && matches[0].rating === "VERY_HIGH"
        ? "VERY_HIGH_MONTH_STREAK_UNPROVEN" : ownerMetric
          ? "OWNER_ZERO_RATE_WITHOUT_APPLICABLE_EVALUATION_PERIOD"
          : "CURRENT_EXACT_CATEGORY_SERVICE_METRICS_UNPROVEN" }
  const basisReady = [input.itemPrice, input.buyerShipping, input.handling]
    .every((value) => value !== null && Number.isFinite(value) && value >= 0)
  const knownPreListingBasis = basisReady
    ? Number(input.itemPrice) + Number(input.buyerShipping) + Number(input.handling) : null
  const policyArithmetic = knownPreListingBasis !== null
    ? evaluateEbayUsNoStoreFvfAtBasisV1(category, knownPreListingBasis) : null
  return Object.freeze({ status: "INCOMPLETE" as const,
    feePolicyStatus: category.status,
    knownPreListingBasis, policyArithmetic,
    sellerLevelSurcharge: sellerLevel,
    serviceMetricsSurcharge: serviceMetrics,
    ownerObservedServiceMetricsWindow: assessOwnerObservedServiceMetricsWindowV1({
      accountKey: category.marketplaceAccountKey,
      supplierSku: input.supplierSku ?? null, now }),
    buyerDependentComponents: {
      salesTax: { status: "UNKNOWN" as const, amountUsd: null },
      internationalFee: { status: "UNKNOWN" as const, amountUsd: null },
      currencyConversion: { status: "UNKNOWN" as const, amountUsd: null },
      otherApplicableFees: { status: "UNKNOWN" as const, amountUsd: null },
    },
    calculatedFee: null, finalFeeAmountAuthority: "INCOMPLETE" as const,
    priceAuthorized: false as const })
}

/** OWNER-approved prelisting reserves, never realized fees or buyer tax.
 * The 2.5% buyer-dependent reserve subsumes tax-driven FVF and order-fee
 * uncertainty; no separate tax/threshold amount is added. */
export function evaluateEbayUsNoStoreConservativeFeeV1(input: Readonly<{
  policyAuthority: ReturnType<typeof resolveEbayUsNoStoreFvfPolicyV1>
  itemPrice: number | null; buyerShipping: number | null; handling: number | null
  otherBuyerCharges: number | null; otherSellerFeesAuthority?: unknown
  serviceMetricsAuthority?: unknown; boundPolicy?: unknown; performance?: unknown
  domesticScenarioAuthority?: unknown; now?: Date
}>) {
  const now = input.now ?? new Date()
  const owner = record(input.boundPolicy ?? ownerConservativeFeePolicy)
  const servicePolicy = record(owner.serviceMetricsSurcharge)
  const buyerPolicy = record(owner.buyerDependentFeeReserve)
  const ownerScoped = owner.contractVersion === "EBAY_PRELISTING_OWNER_CONSERVATIVE_FEE_POLICY_V1" &&
    owner.marketplace === "EBAY_US" && owner.marketplaceAccountKey ===
      input.policyAuthority.marketplaceAccountKey &&
    owner.source === "OWNER_EXPLICIT_P0_2_OPERATIONAL_CLOSURE_2026_09_23" &&
    owner.officialFeeSourceUrl === EBAY_US_NO_STORE_FVF_SOURCE &&
    fresh(owner.recordedAt, owner.revalidateAfter, now)
  const basisReady = [input.itemPrice, input.buyerShipping, input.handling,
    input.otherBuyerCharges]
    .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
  const basis = basisReady ? Number(input.itemPrice) + Number(input.buyerShipping) +
    Number(input.handling) + Number(input.otherBuyerCharges) : null
  const otherSeller = record(input.otherSellerFeesAuthority)
  const otherSellerReady = otherSeller.marketplaceAccountKey ===
      input.policyAuthority.marketplaceAccountKey &&
    otherSeller.categoryId === input.policyAuthority.categoryId &&
    otherSeller.baseFvfIncluded === false &&
    otherSeller.perOrderFeeIncluded === false &&
    otherSeller.serviceMetricsFeeIncluded === false &&
    otherSeller.buyerDependentFeeIncluded === false &&
    typeof otherSeller.source === "string" && otherSeller.source.length > 0 &&
    fresh(otherSeller.observedAt, otherSeller.freshUntil, now) &&
    (otherSeller.status === "NOT_APPLICABLE" && otherSeller.amountUsd === 0 ||
      otherSeller.status === "PROVEN_EXACT" &&
      typeof otherSeller.amountUsd === "number" &&
      Number.isFinite(otherSeller.amountUsd) && otherSeller.amountUsd >= 0)
  const service = record(input.serviceMetricsAuthority)
  const exactServiceContext =
    service.marketplaceAccountKey === input.policyAuthority.marketplaceAccountKey &&
    service.categoryId === input.policyAuthority.categoryId &&
    fresh(service.observedAt, service.freshUntil, now) &&
    service.source === "EBAY_CURRENT_CATEGORY_SERVICE_METRICS"
  const provenZero = exactServiceContext && service.status === "PROVEN_ZERO" &&
    service.ratePct === 0
  const provenSurcharge = exactServiceContext && service.status === "PROVEN_EXACT" &&
    (service.ratePct === 5 || service.ratePct === 6)
  const ownerServiceBound = ownerScoped &&
    servicePolicy.status === "CONSERVATIVE_BOUND" &&
    servicePolicy.rateFraction === 0.06 &&
    servicePolicy.approvedByOwner === true &&
    servicePolicy.notRealizedFee === true &&
    servicePolicy.appliesWhenExactCurrentEvaluationUnknown === true &&
    servicePolicy.basis === "KNOWN_PRETAX_SALE_BASIS" &&
    servicePolicy.officialRationale ===
      "VERY_HIGH_FOUR_OR_MORE_CONSECUTIVE_MONTHS_ADDITIONAL_FVF_MAX_6_PERCENT"
  const serviceStatus = provenZero ? "PROVEN_ZERO" as const :
    provenSurcharge ? "PROVEN_EXACT" as const :
    ownerServiceBound ? "CONSERVATIVE_BOUND" as const :
    "UNKNOWN" as const
  const buyerReady = ownerScoped &&
    buyerPolicy.contractVersion === "BUYER_DEPENDENT_FEE_RESERVE_V1" &&
    buyerPolicy.status === "CONSERVATIVE_BOUND" &&
    buyerPolicy.rateFraction === 0.025 &&
    buyerPolicy.approvedByOwner === true &&
    buyerPolicy.notSalesTaxEstimate === true &&
    buyerPolicy.notRealizedFee === true &&
    buyerPolicy.basis === "KNOWN_PRETAX_SALE_BASIS" &&
    buyerPolicy.scope === "US_DOMESTIC_PRELISTING_SCENARIO" &&
    buyerPolicy.includesTaxDrivenFvfUncertainty === true &&
    buyerPolicy.includesPerOrderThresholdUncertainty === true
  const buyerStatus = buyerReady ? "CONSERVATIVE_BOUND" as const : "UNKNOWN" as const
  const sellerLevel = resolveEbaySellerLevelSurchargeV1({
    accountKey: input.policyAuthority.marketplaceAccountKey,
    performance: input.performance, now })
  const sellerLevelZero = sellerLevel.status === "PROVEN" &&
    sellerLevel.ratePct === 0 && sellerLevel.applicable === false
  const domestic = record(input.domesticScenarioAuthority)
  const domesticReady = domestic.status === "PROVEN_EXACT" &&
    domestic.marketplaceAccountKey === input.policyAuthority.marketplaceAccountKey &&
    domestic.marketplace === "EBAY_US" &&
    domestic.buyerRegisteredCountry === "US" &&
    domestic.deliveryCountry === "US" &&
    domestic.internationalFeeStatus === "NOT_APPLICABLE" &&
    typeof domestic.source === "string" && domestic.source.length > 0 &&
    fresh(domestic.observedAt, domestic.freshUntil, now)
  const blockers = [
    input.policyAuthority.status !== "PROVEN" ? "OFFICIAL_CATEGORY_FVF_POLICY_UNPROVEN" : null,
    basis === null ? "PRETAX_SALE_BASIS_UNPROVEN" : null,
    serviceStatus === "UNKNOWN" ? "SERVICE_METRICS_SURCHARGE_UNKNOWN" : null,
    !sellerLevelZero ? "SELLER_LEVEL_SURCHARGE_UNKNOWN" : null,
    !otherSellerReady ? "OTHER_SELLER_FEES_UNPROVEN" : null,
    buyerStatus === "UNKNOWN" ? "OWNER_BUYER_DEPENDENT_FEE_RESERVE_UNPROVEN" : null,
    !domesticReady ? "US_DOMESTIC_BUYER_AND_DELIVERY_UNPROVEN" : null,
  ].filter((value): value is string => value !== null)
  const preTax = basis === null ? null :
    evaluateEbayUsNoStoreFvfAtBasisV1(input.policyAuthority, basis)
  const officialCategoryFvf = preTax?.variableFee ?? null
  const perOrderFee = preTax?.perOrderFee ?? null
  const buyerDependentReserve = buyerReady && basis !== null ?
    roundUp(basis * Number(buyerPolicy.rateFraction)) : null
  const serviceMetricsReserve = serviceStatus === "PROVEN_ZERO" ? 0 :
    serviceStatus === "PROVEN_EXACT" && basis !== null ?
      roundUp(basis * Number(service.ratePct) / 100) :
      serviceStatus === "CONSERVATIVE_BOUND" && basis !== null ?
        roundUp(basis * Number(servicePolicy.rateFraction)) :
      null
  const totalConservativeFee = !blockers.length && preTax &&
    serviceMetricsReserve !== null && buyerDependentReserve !== null ?
    roundUp(preTax.variableFee + preTax.perOrderFee + serviceMetricsReserve +
      buyerDependentReserve + Number(otherSeller.amountUsd)) : null
  return Object.freeze({ status: totalConservativeFee === null ? "UNKNOWN" as const :
      "CONSERVATIVE_BOUND" as const,
    source: "EBAY_OFFICIAL_HELP_AND_OWNER_SCOPED_BOUNDS" as const,
    policyVersion: input.policyAuthority.policyVersion,
    policySourceDigest: input.policyAuthority.sourceDigest,
    ownerBoundPolicyVersion: ownerScoped ? owner.policyVersion : null,
    ownerBoundRevalidateAfter: ownerScoped ? owner.revalidateAfter : null,
    categoryId: input.policyAuthority.categoryId,
    marketplaceAccountKey: input.policyAuthority.marketplaceAccountKey,
    itemPrice: input.itemPrice,
    knownPreListingBasis: basis,
    officialCategoryFvf, perOrderFee,
    sellerLevelSurcharge: { status: sellerLevelZero ? "PROVEN_ZERO" as const :
      "UNKNOWN" as const, amountUsd: sellerLevelZero ? 0 : null,
      source: sellerLevelZero ? sellerLevel.source : null },
    otherSellerFees: { status: otherSellerReady ? otherSeller.status : "UNKNOWN",
      amountUsd: otherSellerReady ? otherSeller.amountUsd : null,
      source: otherSellerReady ? otherSeller.source : null },
    serviceMetricsAuthority: { status: serviceStatus,
      rateFraction: serviceStatus === "PROVEN_EXACT" ? Number(service.ratePct) / 100 :
        serviceStatus === "PROVEN_ZERO" ? 0 :
          serviceStatus === "CONSERVATIVE_BOUND" ? Number(servicePolicy.rateFraction) : null,
      source: provenZero || provenSurcharge ? service.source :
        serviceStatus === "CONSERVATIVE_BOUND" ? owner.source : null,
      realizedSurchargeExact: false },
    serviceMetricsReserve,
    buyerDependentFeeReserve: { status: buyerStatus,
      rateFraction: buyerReady ? Number(buyerPolicy.rateFraction) : null,
      amountUsd: buyerDependentReserve,
      source: buyerReady ? owner.source : null,
      includesTaxDrivenFvfUncertainty: buyerReady,
      includesPerOrderThresholdUncertainty: buyerReady,
      realizedFeeExact: false },
    totalConservativeFee,
    realizedFeeExact: null,
    blockers })
}

/** Post-sale accounting selection. An exact official order-fee receipt
 * supersedes, never adds to, the prelisting reserves. This does not claim
 * that a realized fee receipt is currently available for an unsold item. */
export function selectEbayFeeAmountAuthorityV1(input: Readonly<{
  prelisting: ReturnType<typeof evaluateEbayUsNoStoreConservativeFeeV1>
  realizedFeeReceipt?: unknown
  marketplaceAccountKey: string; supplierSku: string; categoryId: string
}>) {
  const receipt = record(input.realizedFeeReceipt)
  const exact = receipt.status === "PROVEN_EXACT" &&
    receipt.source === "EBAY_OFFICIAL_ORDER_FEE_RECEIPT" &&
    receipt.marketplace === "EBAY_US" && receipt.currency === "USD" &&
    receipt.marketplaceAccountKey === input.marketplaceAccountKey &&
    receipt.supplierSku === input.supplierSku &&
    receipt.categoryId === input.categoryId &&
    typeof receipt.orderId === "string" && receipt.orderId.length > 0 &&
    typeof receipt.itemId === "string" && receipt.itemId.length > 0 &&
    typeof receipt.receiptId === "string" && receipt.receiptId.length > 0 &&
    typeof receipt.observedAt === "string" &&
    Number.isFinite(Date.parse(receipt.observedAt)) &&
    typeof receipt.buyerSalesTaxUsd === "number" &&
    Number.isFinite(receipt.buyerSalesTaxUsd) &&
    receipt.buyerSalesTaxUsd >= 0 &&
    typeof receipt.amountUsd === "number" &&
    Number.isFinite(receipt.amountUsd) && receipt.amountUsd >= 0
  return exact ? Object.freeze({ status: "PROVEN_EXACT" as const,
    feeAmountUsd: receipt.amountUsd as number,
    source: receipt.source as string, realizedFeeExact: true,
    prelistingReserveApplied: false,
    buyerSalesTaxUsd: receipt.buyerSalesTaxUsd as number,
    receiptId: receipt.receiptId as string }) :
    Object.freeze({ status: input.prelisting.status,
      feeAmountUsd: input.prelisting.totalConservativeFee,
      source: input.prelisting.source, realizedFeeExact: false,
      prelistingReserveApplied: input.prelisting.status === "CONSERVATIVE_BOUND",
      buyerSalesTaxUsd: null,
      receiptId: null })
}
